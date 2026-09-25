// "Hacerlo gratis en Shopify" (25-sept-2026, Wellfresh: el raspador se agregaba al carrito
// a $12.990). Crea en la tienda un descuento AUTOMÁTICO "Buy X get Y": quien compra ≥ qty
// del producto del plan se lleva 1 regalo al 100% off. Shopify lo aplica solo en el carrito
// y el checkout, sin código. Requiere el permiso opcional write_discounts.
//   POST /api/merchant?action=gift-free { plan_id, pack_index, gift_index }
import { db } from "./firebase.js";
import { shopifyGraphql } from "./shopify.js";
import { missingShopifyScopes, SHOPIFY_GIFT_SCOPE } from "../../shared/platform/shopify.js";

const SCOPE_MSG = "Falta el permiso write_discounts en tu app de Shopify. Agregalo en la configuración de la app (Scopes) y volvé a conectar Shopify desde Integraciones; después tocá de nuevo \"Hacerlo gratis\".";
const isDenied = (e) => /access denied|write_discounts|\b40[13]\b|unauthorized|forbidden/i.test(String(e?.message || ""));

const MUTATION = `mutation($d: DiscountAutomaticBxgyInput!) {
  discountAutomaticBxgyCreate(automaticBxgyDiscount: $d) {
    automaticDiscountNode { id }
    userErrors { field message }
  }
}`;

export function buildGiftDiscountInput({ title, planProductId, packQty, giftVariantId }) {
  return {
    title: String(title || "Regalo").slice(0, 255),
    startsAt: new Date().toISOString(),
    combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: true },
    usesPerOrderLimit: "1", // UnsignedInt64: Shopify lo exige como string
    customerBuys: {
      value: { quantity: String(Math.max(1, Number(packQty) || 1)) },
      items: { products: { productsToAdd: [`gid://shopify/Product/${planProductId}`] } },
    },
    customerGets: {
      value: { discountOnQuantity: { quantity: "1", effect: { percentage: 1.0 } } },
      items: { products: { productVariantsToAdd: [`gid://shopify/ProductVariant/${giftVariantId}`] } },
    },
  };
}

export async function giftFreeAction(merchantId, req, res) {
  const b = req.body || {};
  const planId = String(b.plan_id || "").trim();
  const pi = Number.isInteger(Number(b.pack_index)) ? Number(b.pack_index) : -1;
  const gi = Number.isInteger(Number(b.gift_index)) ? Number(b.gift_index) : -1;
  if (!planId || pi < 0 || gi < 0) return res.status(400).json({ error: "Faltan plan_id, pack_index o gift_index" });
  try {
    const mref = db().collection("merchants").doc(merchantId);
    const m = (await mref.get()).data() || {};
    if (!m.shopify_token || !m.shopify_shop) return res.status(400).json({ error: "Esto es solo para tiendas Shopify conectadas", code: "not_shopify" });
    if (missingShopifyScopes(m.shopify_scope, [SHOPIFY_GIFT_SCOPE]).length) return res.status(403).json({ error: SCOPE_MSG, code: "scope_missing" });
    const pref = mref.collection("plans").doc(planId);
    const plan = (await pref.get()).data();
    if (!plan) return res.status(404).json({ error: "Plan no encontrado" });
    const packs = Array.isArray(plan.packs) ? plan.packs : [];
    const pack = packs[pi]; const gift = pack && Array.isArray(pack.gifts) ? pack.gifts[gi] : null;
    if (!pack || !gift) return res.status(404).json({ error: "Ese regalo no está en el plan. Guardá el plan y probá de nuevo." });
    if (!gift.shopify_variant_id) return res.status(400).json({ error: "Primero vinculá el regalo a un producto de tu tienda (Elegir de mi tienda)" });
    if (!plan.shopify_product_id) return res.status(400).json({ error: "El plan no tiene producto de Shopify" });
    const title = `Regalo Recurrentes · ${String(gift.title || "").replace(/^\+?\s*GRATIS:?\s*/i, "").slice(0, 60)} (${pack.qty}+ ${String(plan.product_title || "").slice(0, 40)})`;
    const input = buildGiftDiscountInput({ title, planProductId: plan.shopify_product_id, packQty: pack.qty, giftVariantId: gift.shopify_variant_id });
    let data;
    try { data = await shopifyGraphql(m.shopify_shop, m.shopify_token, MUTATION, { d: input }); }
    catch (e) { return res.status(isDenied(e) ? 403 : 502).json({ error: isDenied(e) ? SCOPE_MSG : `Shopify no respondió: ${e.message}`, code: isDenied(e) ? "scope_missing" : "store_error" }); }
    const r = data.discountAutomaticBxgyCreate || {};
    if (r.userErrors?.length) return res.status(400).json({ error: "Shopify rechazó el descuento: " + r.userErrors.map(u => u.message).join("; "), code: "shopify_error" });
    const gid = r.automaticDiscountNode?.id || null;
    if (!gid) return res.status(502).json({ error: "Shopify no devolvió el descuento", code: "store_error" });
    const next = packs.map((p, i) => i !== pi ? p : { ...p, gifts: p.gifts.map((g, j) => j !== gi ? g : { ...g, discount_gid: gid }) });
    await pref.set({ packs: next, updated_at: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, discount_gid: gid, title });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
