// "Hacerlo gratis en Shopify": descuento automático Buy X get Y para el regalo (25-sept-2026).
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";
import { normalizePacks } from "../../api/_lib/packs.js";

const { default: merchantApi } = await loadApi("api/merchant.js");
// Import dinámico DESPUÉS de register.mjs: un import estático se resolvería antes del hook y traería el Firebase real.
const { buildGiftDiscountInput } = await import("../../api/_lib/giftDiscount.js");
beforeEach(() => { createWorld(); });
const call = (body) => invoke(merchantApi, { method: "POST", query: { action: "gift-free" }, headers: { authorization: `Bearer test:${MID}` }, body });

test("el input del descuento: comprá ≥ qty del producto del plan → 1 regalo al 100%", () => {
  const d = buildGiftDiscountInput({ title: "Regalo", planProductId: "7001", packQty: 3, giftVariantId: "777002" });
  assert.equal(d.customerBuys.value.quantity, "3");
  assert.deepEqual(d.customerBuys.items.products.productsToAdd, ["gid://shopify/Product/7001"]);
  assert.deepEqual(d.customerGets.items.products.productVariantsToAdd, ["gid://shopify/ProductVariant/777002"]);
  assert.equal(d.customerGets.value.discountOnQuantity.effect.percentage, 1.0);
  assert.equal(d.usesPerOrderLimit, 1);
});

test("sin write_discounts responde 403 scope_missing con el texto para reconectar; normalizePacks conserva discount_gid", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ shopify_scope: "read_products,write_orders" }));
  seedDoc(`merchants/${MID}/plans/p1`, capsulasPlan({ pricing_mode: "packs", packs: [{ qty: 3, price_ars: 100, gifts: [{ title: "Raspador", shopify_variant_id: "777002" }] }] }));
  const r = await call({ plan_id: "p1", pack_index: 0, gift_index: 0 });
  assert.equal(r.statusCode, 403, JSON.stringify(r.body)); assert.equal(r.body.code, "scope_missing"); assert.match(r.body.error, /write_discounts/);
  const n = normalizePacks([{ qty: 3, price_ars: 100, gifts: [{ title: "R", shopify_variant_id: "1", discount_gid: "gid://shopify/DiscountAutomaticNode/55" }, { title: "V", virtual: true, discount_gid: "gid://shopify/DiscountAutomaticNode/56" }] }]);
  assert.equal(n.packs[0].gifts[0].discount_gid, "gid://shopify/DiscountAutomaticNode/55");
  assert.equal(n.packs[0].gifts[1].discount_gid, null, "virtual no tiene descuento");
});
