// /api/plans  — CRUD de planes de suscripción del merchant logueado.
//
//   GET    → lista de planes del merchant
//   POST   → crear plan (+ crear preapproval_plan en MP)
//   PATCH  → update plan (active, descuento, etc)
//   DELETE → ?id=<planId>
//
// Packs (ver shared/bundle/SPEC.md y _lib/packs.js): `pricing_mode` ("packs"|"theme"),
// `packs` (≤ 6, validados y ordenados por qty) y `frequency_scales_with_qty`.
// Si vienen packs sin pricing_mode → "packs". Sin packs → "theme" (Lumina: el
// tema manda base/sub_off/freq_days por URL; ese flujo no cambia).
import { db, requireMerchant } from "./_lib/firebase.js";
import { mpCreatePreapprovalPlan } from "./_lib/mp.js";
import { appBaseUrl } from "./_lib/config.js";
import { normalizePacks, resolvePack, defaultPackIndex, withPackDefaults, planPricingMode } from "./_lib/packs.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res, "planes");
  if (!ctx) return;
  const { merchantId } = ctx;

  const merchantRef = db().collection("merchants").doc(merchantId);
  const plansCol = merchantRef.collection("plans");

  if (req.method === "GET") {
    const snap = await plansCol.orderBy("created_at", "desc").get();
    const plans = snap.docs.map(d => withPackDefaults({ id: d.id, ...d.data() }));
    return res.json({ plans });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const {
      shopify_product_id, shopify_variant_id, product_title, product_image,
      frequency_days, discount_pct, units_per_shipment, base_price_ars,
      // Nuevos: envío y descuentos por cantidad
      shipping_price_ars, free_shipping_from_ars, shipping_method_name,
      qty_discount_tiers, // [{ min_qty, discount_pct }]
      allow_custom_frequency, max_pack_discount_pct,
      // Packs (bundle)
      pricing_mode, packs, frequency_scales_with_qty,
    } = body;
    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};
    // Perfil del negocio (shared/platform/profile.js): con tienda, el plan sale de
    // un producto del catálogo; sin tienda (servicios, link de suscripción) es un
    // ítem cargado a mano (nombre + precio), sin packs y sin envío si no aplica.
    const profile = merchantProfile(merchant);
    const manualItem = !profile.caps.catalog;
    if (manualItem) {
      if (!String(product_title || "").trim()) return res.status(400).json({ error: "Poné un nombre al plan" });
      if (!(parseFloat(base_price_ars) > 0)) return res.status(400).json({ error: "El precio tiene que ser mayor a 0" });
    } else if (!shopify_product_id || !shopify_variant_id || !product_title) {
      return res.status(400).json({ error: "Faltan datos del producto" });
    }
    if (!frequency_days || frequency_days < 1)
      return res.status(400).json({ error: "frequency_days inválido" });

    // Packs: validar + resolver pricing_mode. Los packs viven en el widget de la
    // tienda: sin widget el plan es siempre precio simple ("theme").
    const pk = profile.caps.packs ? normalizePacks(packs) : { packs: [] };
    if (pk.error) return res.status(400).json({ error: pk.error });
    const modeRes = profile.caps.packs ? resolvePricingMode(pricing_mode, pk.packs) : { mode: "theme" };
    if (modeRes.error) return res.status(400).json({ error: modeRes.error });
    const packsMode = modeRes.mode === "packs";

    if (!merchant.mp_access_token) return res.status(400).json({ error: "Conectá MP primero" });

    // En modo packs, si no mandan base_price_ars lo tomamos del pack de 1 unidad
    // (o precio/qty del pack más chico): es la referencia del precio tachado.
    let basePriceNum = parseFloat(base_price_ars) || 0;
    if (packsMode && !(basePriceNum > 0)) basePriceNum = unitPriceFromPacks(pk.packs);
    const discountNum = parseInt(discount_pct) || 0;
    const subscription_price_ars = Math.round(basePriceNum * (1 - discountNum / 100));
    // Monto del plan "plantilla" en MP (el real se crea ad-hoc por sub en checkout/init).
    const planDraft = { packs: pk.packs, discount_pct: discountNum, base_price_ars: basePriceNum, frequency_days: parseInt(frequency_days), frequency_scales_with_qty: frequency_scales_with_qty !== false };
    const defPack = packsMode ? resolvePack(planDraft, defaultPackIndex(planDraft)) : null;
    const mpAmount = defPack ? defPack.subPrice : subscription_price_ars;
    if (!(mpAmount > 0)) return res.status(400).json({ error: "El precio de suscripción tiene que ser mayor a 0" });

    // Crear preapproval_plan en MP. MP exige back_url HTTPS: sale de APP_BASE_URL.
    const baseUrl = appBaseUrl();
    if (!/^https:\/\//.test(baseUrl)) return res.status(500).json({ error: "APP_BASE_URL debe ser https para crear planes en MP" });
    const backUrl = `${baseUrl}/#/checkout-success`;
    const planBody = {
      reason: `${product_title} — cada ${frequency_days} días`,
      auto_recurring: {
        frequency: parseInt(frequency_days),
        frequency_type: "days",
        transaction_amount: mpAmount,
        currency_id: "ARS",
      },
      back_url: backUrl,
      // SOLO credit_card. Débito y dinero en cuenta NO sirven para cobros
      // recurrentes en MP — el primer pago anda pero el segundo mes falla
      // porque débito requiere autorización del titular cada vez y el saldo
      // en cuenta no se renueva automáticamente. Sin este filtro MP muestra
      // todos los métodos en el checkout y los clientes que eligen débito
      // quedan con sub que cancela sola al primer cobro recurrente.
      payment_methods_allowed: {
        payment_types: [{ id: "credit_card" }],
        payment_methods: [],
      },
    };
    let mpPlan;
    try {
      mpPlan = await mpCreatePreapprovalPlan(merchant.mp_access_token, planBody);
    } catch (e) {
      return res.status(502).json({ error: `MP: ${e.message}` });
    }

    // Normalizar tiers de descuento por cantidad: array de { min_qty, discount_pct }
    // ordenado por min_qty ascendente. Si no viene array válido, queda [].
    const tiers = Array.isArray(qty_discount_tiers)
      ? qty_discount_tiers
          .map(t => ({
            min_qty: Math.max(2, parseInt(t.min_qty) || 0),
            discount_pct: Math.max(0, Math.min(100, parseInt(t.discount_pct) || 0)),
          }))
          .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
          .sort((a, b) => a.min_qty - b.min_qty)
      : [];

    const planRef = plansCol.doc();
    const data = {
      // Ítem manual (sin tienda): sin ids de Shopify; el checkout lo resuelve por plan id.
      shopify_product_id: manualItem ? null : String(shopify_product_id),
      shopify_variant_id: manualItem ? null : String(shopify_variant_id),
      item_source: manualItem ? "manual" : profile.channel,
      product_title: manualItem ? String(product_title).trim().slice(0, 120) : product_title,
      product_image: product_image || null,
      frequency_days: parseInt(frequency_days),
      discount_pct: discountNum,
      units_per_shipment: parseInt(units_per_shipment) || 1,
      base_price_ars: basePriceNum,
      subscription_price_ars,
      // Packs (bundle)
      pricing_mode: modeRes.mode,
      packs: pk.packs,
      frequency_scales_with_qty: frequency_scales_with_qty !== false,
      // Envío (sin envío en el perfil — servicios, digitales — queda en 0)
      shipping_price_ars: profile.caps.shipping ? Math.max(0, parseFloat(shipping_price_ars) || 0) : 0,
      free_shipping_from_ars: profile.caps.shipping ? Math.max(0, parseFloat(free_shipping_from_ars) || 0) : 0, // 0 = nunca gratis
      shipping_method_name: (shipping_method_name || "Envío a domicilio").trim().slice(0, 60),
      // Descuentos por cantidad
      qty_discount_tiers: tiers,
      // El cliente puede elegir otra frecuencia (default no) / tope de descuento por pack.
      allow_custom_frequency: allow_custom_frequency === true,
      max_pack_discount_pct: clampPct(max_pack_discount_pct, 35),
      mp_preapproval_plan_id: mpPlan.id,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await planRef.set(data);
    return res.json({ ok: true, plan: withPackDefaults({ id: planRef.id, ...data }) });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const ref = plansCol.doc(String(id));
    const cur = (await ref.get()).data();
    if (!cur) return res.status(404).json({ error: "Plan no encontrado" });
    const patch = req.body || {};
    // Campos que NO se editan por acá.
    delete patch.id; delete patch.mp_preapproval_plan_id; delete patch.created_at;
    // Normalizar numéricos si vienen.
    const num = (v, min = 0) => Math.max(min, parseFloat(v) || 0);
    const out = {};
    if (patch.product_title != null) out.product_title = String(patch.product_title);
    // Ítems manuales (sin tienda): la imagen se edita acá (en Shopify sale del catálogo).
    if (patch.product_image !== undefined && cur.item_source === "manual") {
      const img = String(patch.product_image || "").trim().slice(0, 500);
      out.product_image = /^https:\/\//i.test(img) ? img : null;
    }
    if (patch.frequency_days != null) out.frequency_days = Math.max(1, parseInt(patch.frequency_days) || cur.frequency_days || 30);
    if (patch.discount_pct != null) out.discount_pct = Math.max(0, Math.min(80, parseInt(patch.discount_pct) || 0));
    if (patch.units_per_shipment != null) out.units_per_shipment = Math.max(1, parseInt(patch.units_per_shipment) || 1);
    if (patch.base_price_ars != null) out.base_price_ars = num(patch.base_price_ars);
    if (patch.shipping_price_ars != null) out.shipping_price_ars = num(patch.shipping_price_ars);
    if (patch.free_shipping_from_ars != null) out.free_shipping_from_ars = num(patch.free_shipping_from_ars);
    if (patch.shipping_method_name != null) out.shipping_method_name = String(patch.shipping_method_name).trim().slice(0, 60) || "Envío a domicilio";
    if (patch.active != null) out.active = !!patch.active;
    if (patch.allow_custom_frequency != null) out.allow_custom_frequency = patch.allow_custom_frequency === true;
    if (patch.max_pack_discount_pct != null) out.max_pack_discount_pct = clampPct(patch.max_pack_discount_pct, 35);
    // Packs (bundle). `packs: []` vacía la lista y vuelve a "theme" salvo pricing_mode explícito.
    let packsChanged = false;
    if ("packs" in patch && patch.packs !== undefined) {
      const pk = normalizePacks(patch.packs);
      if (pk.error) return res.status(400).json({ error: pk.error });
      out.packs = pk.packs;
      packsChanged = JSON.stringify(pk.packs) !== JSON.stringify(Array.isArray(cur.packs) ? cur.packs : []);
    }
    if (patch.frequency_scales_with_qty != null) out.frequency_scales_with_qty = patch.frequency_scales_with_qty !== false;
    if (patch.pricing_mode != null || out.packs) {
      const effPacks = out.packs || (Array.isArray(cur.packs) ? cur.packs : []);
      // Sin pricing_mode explícito: derivar de los packs resultantes.
      const modeRes = resolvePricingMode(patch.pricing_mode != null ? patch.pricing_mode : undefined, effPacks);
      if (modeRes.error) return res.status(400).json({ error: modeRes.error });
      out.pricing_mode = modeRes.mode;
      if (out.pricing_mode !== planPricingMode(cur)) packsChanged = true;
    }
    if (Array.isArray(patch.qty_discount_tiers)) {
      out.qty_discount_tiers = patch.qty_discount_tiers
        .map(t => ({ min_qty: Math.max(2, parseInt(t.min_qty) || 0), discount_pct: Math.max(0, Math.min(100, parseInt(t.discount_pct) || 0)) }))
        .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
        .sort((a, b) => a.min_qty - b.min_qty);
    }
    // Recalcular precio sub si cambió base o descuento (o cualquiera de los dos).
    const base = out.base_price_ars != null ? out.base_price_ars : (cur.base_price_ars || 0);
    const disc = out.discount_pct != null ? out.discount_pct : (cur.discount_pct || 0);
    if (out.base_price_ars != null || out.discount_pct != null) {
      out.subscription_price_ars = Math.round(base * (1 - disc / 100));
    }
    out.updated_at = new Date().toISOString();
    await ref.update(out);
    const priceChanged = out.base_price_ars != null || out.discount_pct != null || packsChanged;
    return res.json({
      ok: true,
      plan: withPackDefaults({ id, ...cur, ...out }),
      note: packsChanged
        ? "Los cambios de precio no afectan suscripciones existentes"
        : (priceChanged ? "Los cambios de precio no afectan suscripciones existentes; usá Repreciar." : undefined),
    });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    // ?hard=1 → borrado REAL (remove del documento). Sin flag → soft delete
    // (active=false, mantiene historial para suscriptores que ya estaban en
    // este plan).
    if (req.query.hard === "1") {
      await plansCol.doc(String(id)).delete();
    } else {
      await plansCol.doc(String(id)).update({ active: false, updated_at: new Date().toISOString() });
    }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// pricing_mode: explícito ("packs"|"theme") o derivado de los packs.
// "packs" explícito sin packs → error (el checkout no tendría qué cobrar).
function resolvePricingMode(explicit, packs) {
  const has = Array.isArray(packs) && packs.length > 0;
  if (explicit == null || explicit === "") return { mode: has ? "packs" : "theme" };
  const m = String(explicit).toLowerCase();
  if (m !== "packs" && m !== "theme") return { error: 'pricing_mode debe ser "packs" o "theme"' };
  if (m === "packs" && !has) return { error: "Modo packs requiere al menos un pack" };
  return { mode: m };
}

// Precio unitario de referencia a partir de los packs (pack de 1 o precio/qty del más chico).
function unitPriceFromPacks(packs) {
  if (!Array.isArray(packs) || !packs.length) return 0;
  const one = packs.find(p => p.qty === 1);
  if (one) return one.price_ars;
  const min = packs[0];
  return Math.round(min.price_ars / Math.max(1, min.qty));
}

// Entero 0-80 con default.
function clampPct(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(80, n)) : def;
}
