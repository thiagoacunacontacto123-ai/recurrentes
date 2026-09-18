// Importar los códigos de descuento de la tienda online a Configuración → Descuentos
// (`merchant.discount_codes`). POST /api/merchant?action=import-discounts.
//
//   Shopify    → codeDiscountNodes (GraphQL, permiso opcional read_discounts).
//   Tiendanube → GET /coupons (scope read_coupons de la app de Partner).
//
// Solo traemos lo que nuestro checkout sabe aplicar: % o $ fijo sobre el pedido. Lo demás
// (2x1, envío gratis, descuentos por app, por cantidad) se informa como "omitido". Los
// códigos que ya estaban NO se pisan (el comerciante pudo haberles cambiado el valor o
// las casillas); los nuevos entran con las mismas casillas que "+ Agregar".
import { db } from "./firebase.js";
import { shListDiscountNodes } from "./shopify.js";
import { tnListCoupons } from "./tiendanube.js";
import { missingShopifyScopes, SHOPIFY_DISCOUNTS_SCOPE } from "../../shared/platform/shopify.js";

export const MAX_DISCOUNT_CODES = 100;

// Misma limpieza que save-discount-codes: MAYÚSCULAS, ≤40 chars, valor > 0, ≤100 códigos.
const normalizeCode = (c) => ({
  code: String(c?.code || "").trim().toUpperCase().slice(0, 40),
  type: c?.type === "fixed" ? "fixed" : "percent",
  value: Math.max(0, parseFloat(c?.value) || 0),
  active: c?.active !== false,
  recovery_only: c?.recovery_only === true,
  first_charge_only: c?.first_charge_only === true,
});
const validCodes = (arr) => (Array.isArray(arr) ? arr : []).map(normalizeCode).filter(c => c.code && c.value > 0);
export function cleanDiscountCodes(arr) {
  return validCodes(arr).slice(0, MAX_DISCOUNT_CODES);
}

const round2 = (n) => Math.round(n * 100) / 100;

// Nodos de codeDiscountNodes → { codes:[{code,type,value,active}], skipped:[{code,reason}] }.
export function shopifyDiscountsToCodes(nodes) {
  const codes = [], skipped = [];
  for (const n of Array.isArray(nodes) ? nodes : []) {
    const d = n?.codeDiscount || {};
    const list = (d.codes?.nodes || []).map(x => String(x?.code || "").trim()).filter(Boolean);
    if (!list.length) continue;
    const reason = d.__typename === "DiscountCodeBxgy" ? "promo tipo 2x1"
      : d.__typename === "DiscountCodeFreeShipping" ? "envío gratis"
      : d.__typename === "DiscountCodeApp" ? "descuento de otra app"
      : d.__typename !== "DiscountCodeBasic" ? "tipo no soportado" : null;
    if (reason) { for (const code of list) skipped.push({ code, reason }); continue; }
    const v = d.customerGets?.value || {};
    let type = null, value = 0;
    if (v.__typename === "DiscountPercentage") { type = "percent"; value = round2(Number(v.percentage) * 100); }
    else if (v.__typename === "DiscountAmount") { type = "fixed"; value = round2(Number(v.amount?.amount)); }
    if (!type || !(value > 0)) { for (const code of list) skipped.push({ code, reason: "descuento por cantidad" }); continue; }
    for (const code of list) codes.push({ code, type, value, active: d.status ? d.status === "ACTIVE" : true });
  }
  return { codes, skipped };
}

// Cupones de GET /coupons → mismo formato. `today` = "AAAA-MM-DD" (inyectable en tests).
export function tiendanubeCouponsToCodes(coupons, today = new Date().toISOString().slice(0, 10)) {
  const codes = [], skipped = [];
  for (const c of Array.isArray(coupons) ? coupons : []) {
    const code = String(c?.code || "").trim();
    if (!code) continue;
    if (c.type === "shipping") { skipped.push({ code, reason: "envío gratis" }); continue; }
    const type = c.type === "percentage" ? "percent" : c.type === "absolute" ? "fixed" : null;
    const value = round2(Number(c.value));
    if (!type || !(value > 0)) { skipped.push({ code, reason: "tipo no soportado" }); continue; }
    const end = String(c.end_date || "").slice(0, 10);
    const expired = end && end < today;
    const exhausted = c.max_uses != null && Number(c.max_uses) > 0 && Number(c.used || 0) >= Number(c.max_uses);
    codes.push({ code, type, value, active: c.valid !== false && !expired && !exhausted });
  }
  return { codes, skipped };
}

// Une lo importado con lo que ya había SIN pisar nada. Los nuevos entran con las
// casillas de "+ Agregar" (no solo recupero, no solo 1er cobro).
export function mergeDiscountCodes(existing, incoming) {
  const codes = cleanDiscountCodes(existing);
  const have = new Set(codes.map(c => c.code));
  let imported = 0, already = 0, dropped = 0;
  for (const c of validCodes((Array.isArray(incoming) ? incoming : []).map(x => ({ ...x, recovery_only: false, first_charge_only: false })))) {
    if (have.has(c.code)) { already++; continue; }
    if (codes.length >= MAX_DISCOUNT_CODES) { dropped++; continue; }
    have.add(c.code);
    codes.push(c);
    imported++;
  }
  return { codes, imported, already, dropped };
}

const SCOPE_MSG = {
  shopify: `A tu conexión con Shopify le falta el permiso ${SHOPIFY_DISCOUNTS_SCOPE}. En tu app de Shopify creá una versión nueva con la lista completa de permisos, tocá Release y volvé a conectar desde Integraciones. Mientras tanto podés cargar los códigos a mano.`,
  tiendanube: "La app de Recurrentes en Tiendanube todavía no tiene permiso para leer tus cupones. Desvinculá y volvé a conectar la tienda desde Integraciones; si sigue igual, escribinos por WhatsApp. Mientras tanto podés cargar los códigos a mano.",
};
const isDenied = (e) => /access denied|read_discounts|read_coupons|\b40[13]\b|unauthorized|forbidden/i.test(String(e?.message || "")) || e?.status === 401 || e?.status === 403;

export async function importDiscountsAction(merchantId, req, res) {
  try {
    const ref = db().collection("merchants").doc(merchantId);
    const m = (await ref.get()).data() || {};
    let source, result;
    if (m.shopify_token && m.shopify_shop) {
      source = "shopify";
      if (missingShopifyScopes(m.shopify_scope, [SHOPIFY_DISCOUNTS_SCOPE]).length) {
        return res.status(403).json({ error: SCOPE_MSG.shopify, code: "scope_missing", source });
      }
      let nodes;
      try { nodes = await shListDiscountNodes(m.shopify_shop, m.shopify_token); }
      catch (e) { return res.status(isDenied(e) ? 403 : 502).json({ error: isDenied(e) ? SCOPE_MSG.shopify : `Shopify no respondió: ${e.message}`, code: isDenied(e) ? "scope_missing" : "store_error", source }); }
      result = shopifyDiscountsToCodes(nodes);
    } else if (m.tiendanube_token && m.tiendanube_store_id) {
      source = "tiendanube";
      const sc = String(m.tiendanube_scope || "").toLowerCase();
      if (sc && !/\b(read|write)_coupons\b/.test(sc)) return res.status(403).json({ error: SCOPE_MSG.tiendanube, code: "scope_missing", source });
      let coupons;
      try { coupons = await tnListCoupons(m.tiendanube_store_id, m.tiendanube_token); }
      catch (e) { return res.status(isDenied(e) ? 403 : 502).json({ error: isDenied(e) ? SCOPE_MSG.tiendanube : `Tiendanube no respondió: ${e.message}`, code: isDenied(e) ? "scope_missing" : "store_error", source }); }
      result = tiendanubeCouponsToCodes(coupons);
    } else {
      return res.status(400).json({ error: "Conectá tu tienda (Shopify o Tiendanube) primero.", code: "no_store" });
    }
    const merged = mergeDiscountCodes(m.discount_codes, result.codes);
    if (merged.imported) {
      await ref.set({
        discount_codes: merged.codes,
        discount_codes_source: source,
        discount_codes_imported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { merge: true });
    }
    return res.json({
      ok: true, source, discount_codes: merged.codes,
      imported: merged.imported, already: merged.already, dropped: merged.dropped,
      found: result.codes.length, skipped: result.skipped.slice(0, 50),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
