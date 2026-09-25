// Regalos vinculados a un producto de la tienda (25-sept-2026, Wellfresh): el raspador es
// un producto real y tiene que VIAJAR. En suscripción va a la orden de Shopify como renglón
// a $0 (y "once" solo en la primera orden); el widget lo agrega al carrito en compra única.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, snapshot, mpPayment, mpWebhookReq, MID, MP_TOKEN, VARIANT_ID, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { normalizePacks } from "../../api/_lib/packs.js";
import { buildBundlePayload } from "../../api/widget.js";

const { default: webhook } = await loadApi("api/mp/webhook.js");
let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const GIFTS = [
  { shopify_variant_id: "777001", title: "Guía", every: "always" },
  { shopify_variant_id: "777002", title: "Raspador", every: "once" },
];

test("renovación (charge #2): solo el regalo 'siempre' va a la orden, a $0, sin tocar el reparto del cobro", async () => {
  W.seedSub("sub_ana", subscriber({ quantity: 2, plan_snapshot: snapshot({ qty: 2 }), gift_items: GIFTS }));
  const pay = W.mp.addPayment(mpPayment({ id: 1310000011, amount: 23100, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  const o = W.shopify.orderPosts[0].order;
  assert.deepEqual(o.line_items, [
    { variant_id: VARIANT_ID, quantity: 2, price: "10800.00" },
    { variant_id: "777001", quantity: 1, price: "0.00" },
  ]);
});

test("primera orden: van los dos regalos (el 'solo en el primero' también)", async () => {
  W.seedSub("sub_ana", subscriber({ quantity: 2, plan_snapshot: snapshot({ qty: 2 }), gift_items: GIFTS, shopify_orders: [] }));
  const pay = W.mp.addPayment(mpPayment({ id: 1310000012, amount: 23100, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  const o = W.shopify.orderPosts[0].order;
  assert.deepEqual(o.line_items.slice(1), [
    { variant_id: "777001", quantity: 1, price: "0.00" },
    { variant_id: "777002", quantity: 1, price: "0.00" },
  ]);
});

test("normalizePacks guarda la variante del regalo (no si es virtual); el widget recibe modo y regalos por pack", () => {
  const r = normalizePacks([
    { qty: 2, price_ars: 100, hide_sub: true, gifts: [{ title: "Guía", virtual: true, shopify_variant_id: "1" }] },
    { qty: 3, price_ars: 200, hide_once: true, gifts: [{ title: "Raspador", shopify_variant_id: "777002", shopify_product_id: "88", every: "once" }] },
  ]);
  assert.equal(r.packs[0].gifts[0].shopify_variant_id, null, "virtual → sin variante");
  assert.equal(r.packs[1].gifts[0].shopify_variant_id, "777002");
  const payload = buildBundlePayload(capsulasPlan({ pricing_mode: "packs", packs: r.packs }), { widget_variant: "v12" });
  assert.deepEqual(payload.packs, [
    { idx: 0, qty: 2, freq_days: 60, hideOnce: false, hideSub: true, gifts: [] },
    { idx: 1, qty: 3, freq_days: 90, hideOnce: true, hideSub: false, gifts: [{ variant_id: "777002", every: "once" }] },
  ]);
});
