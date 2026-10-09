// Stock por producto en packs armados (9-oct-2026, G4U + Thiago: "si pido pan 1 y pan 2
// y de pan 2 no hay, que me cobre y mande solo pan 1 hasta que vuelva"). Lo que protege:
// falta uno → sale solo ese (MP baja, mail "stock_hold", queda en espera); vuelve el
// stock → vuelve solo (MP sube, mail "stock_restored"); faltan todos → pausa como
// siempre; el cliente puede soltar lo que espera desde el portal.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, snapshot, mpPreapproval, MID, PLAN_ID, MP_TOKEN, VARIANT_ID, capsulasPlan, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { mpPayment, mpWebhookReq } from "../helpers/world.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";
import { planPackStock } from "../../api/_lib/packStock.js";

const { stockWatchForMerchant, applyStockPolicy } = await loadApi("api/_lib/stock.js");
const { db } = await loadApi("api/_lib/firebase.js");
const { fulfillCharge } = await loadApi("api/_lib/sync.js");
const pub = await loadApi("api/public.js");
const { default: webhook } = await loadApi("api/mp/webhook.js");

const MIX_PLAN = () => capsulasPlan({
  pricing_mode: "packs", discount_pct: 15, base_price_ars: 12000, frequency_days: 7, frequency_scales_with_qty: false,
  packs: [{ qty: 1, price_ars: 12000 }, { qty: 4, price_ars: 48000, default: true }],
  mix: { enabled: true, items: [
    { shopify_product_id: "7002", shopify_variant_id: "4002", title: "Tortilla", price_ars: 9000 },
    { shopify_product_id: "7003", shopify_variant_id: "4003", title: "Grisines", price_ars: 6000 },
  ] },
});
const PACK_ITEMS = [
  { shopify_variant_id: VARIANT_ID, shopify_product_id: "7001", title: "Cápsulas LuminaLabs", image: null, qty: 2, price_ars: 12000 },
  { shopify_variant_id: "4002", shopify_product_id: "7002", title: "Tortilla", image: null, qty: 1, price_ars: 9000 },
  { shopify_variant_id: "4003", shopify_product_id: "7003", title: "Grisines", image: null, qty: 1, price_ars: 6000 },
];
const SID = "sub_mica";
const AHORA = Date.parse("2026-10-10T10:00:00.000Z");
// Pack ×4: 39.000 → 33.150 + envío 1.500 = 34.650. Cobro en 2 h (dentro de la ventana del cron).
const SUB = (over = {}) => subscriber({
  quantity: 4, pack_items: PACK_ITEMS, mp_preapproval_id: "pre_ana", customer_email: "mica@cliente.test", customer_name: "Mica López",
  next_charge_at: new Date(AHORA + 2 * 3600e3).toISOString(),
  plan_snapshot: { ...snapshot({ qty: 4 }), subtotal_ars: 33150, subscription_price_ars: 33150, total_per_charge_ars: 34650, mix: true, product_title: "Pack ×4 · Cápsulas LuminaLabs ×2, Tortilla ×1, Grisines ×1", frequency_days: 7 },
  ...over,
});
const vigilar = (subs) => stockWatchForMerchant({ db, merchant: W.merchant(), merchantId: MID, subs, nowMs: AHORA, tag: "test" });

let W;
beforeEach(() => {
  W = createWorld({ plan: MIX_PLAN() });
  W.shopify.variants["4002"] = 9000; W.shopify.variants["4003"] = 6000;
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana", amount: 34650, frequency: 7 }), MP_TOKEN);
  W.seedSub(SID, SUB());
});
afterEach(() => { W.router.assertClean(); });

test("modelo: lo que falta sale (o baja a lo que hay), lo que espera vuelve cuando alcanza; sin nada queda allOut", () => {
  const sub = SUB();
  let p = planPackStock(sub, new Map([[VARIANT_ID, 10], ["4002", 0], ["4003", 10]]));
  assert.deepEqual(p.active.map(i => [i.shopify_variant_id, i.qty]), [[VARIANT_ID, 2], ["4003", 1]]);
  assert.deepEqual(p.held.map(i => [i.shopify_variant_id, i.qty]), [["4002", 1]]);
  assert.equal(p.removed.length, 1); assert.equal(p.changed, true); assert.equal(p.allOut, false);
  // Baja a lo que hay: pedía 2 cápsulas y queda 1.
  p = planPackStock(sub, new Map([[VARIANT_ID, 1], ["4002", 5], ["4003", 5]]));
  assert.deepEqual(p.active.map(i => [i.shopify_variant_id, i.qty]), [[VARIANT_ID, 1], ["4002", 1], ["4003", 1]]);
  assert.deepEqual(p.held, [{ ...PACK_ITEMS[0], qty: 1 }]);
  // Sin seguimiento de inventario (null) = infinito.
  assert.equal(planPackStock(sub, new Map([[VARIANT_ID, null], ["4002", null], ["4003", null]])).changed, false);
  // Vuelve: lo que esperaba + lo que lleva tiene que caber.
  const conEspera = SUB({ pack_items: PACK_ITEMS.filter(i => i.shopify_variant_id !== "4002"), pack_held_items: [{ ...PACK_ITEMS[1] }] });
  p = planPackStock(conEspera, new Map([[VARIANT_ID, 10], ["4002", 3], ["4003", 10]]));
  assert.deepEqual(p.restored, [{ title: "Tortilla", qty: 1, shopify_variant_id: "4002" }]); assert.deepEqual(p.held, []);
  assert.equal(planPackStock(SUB(), new Map([[VARIANT_ID, 0], ["4002", 0], ["4003", 0]])).allOut, true);
});

test("antes del cobro: falta la tortilla → sale solo ella, MP baja a 27.000, mail 'stock_hold' y queda en espera", async () => {
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  const r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.deepEqual(r, { revisadas: 1, pausadas: 0, reactivadas: 0, ajustadas: 1 });
  const s = W.sub(SID);
  assert.equal(s.status, "active", "NO se pausa: hay con qué armar el pedido");
  assert.deepEqual(s.pack_items.map(i => [i.shopify_variant_id, i.qty]), [[VARIANT_ID, 2], ["4003", 1]]);
  assert.deepEqual(s.pack_held_items.map(i => [i.shopify_variant_id, i.qty]), [["4002", 1]]);
  assert.equal(s.quantity, 3);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 27000, "30.000 → 25.500 + envío 1.500");
  assert.equal(s.plan_snapshot.product_title, "Pack ×3 · Cápsulas LuminaLabs ×2, Grisines ×1");
  assert.ok(s.stock_hold_at);
  const u = W.mp.preapprovalUpdates.at(-1);
  assert.equal(u.body.auto_recurring.transaction_amount, 27000);
  assert.equal(u.body.reason, "Pack x3 - Capsulas LuminaLabs x2, Grisines x1 - cada 7 dias");
  assert.equal(s.pack_changes.at(-1).by, "stock");
  assert.match(s.pack_changes.at(-1).note, /sin stock: Tortilla ×1/);
  const mails = W.resend.byType("stock_hold");
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /sin stock/);
  assert.match(mails[0].text || mails[0].html, /Tortilla ×1/);
  assert.match(mails[0].text || mails[0].html, /\$27\.000/);
  assert.equal(W.resend.byType("out_of_stock").length, 0, "no es el mail de 'no te cobramos'");
});

test("sigue sin stock: no repite el mail ni toca MP; vuelve el stock → vuelve la tortilla, MP sube y mail 'stock_restored'", async () => {
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  await vigilar([{ id: SID, ...W.sub(SID) }]);
  const upd = W.mp.preapprovalUpdates.length;
  // Segunda pasada, todavía sin stock y con el cobro lejos: igual se mira (hay algo en espera) y no pasa nada.
  W.seedSub(SID, { ...W.sub(SID), next_charge_at: new Date(AHORA + 5 * 86400e3).toISOString() });
  let r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.equal(r.ajustadas, undefined); assert.equal(W.mp.preapprovalUpdates.length, upd);
  assert.equal(W.resend.byType("stock_hold").length, 1);
  // Repusieron.
  W.shopify.stock["4002"] = 8;
  r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.equal(r.ajustadas, 1);
  const s = W.sub(SID);
  assert.deepEqual(s.pack_items.map(i => [i.shopify_variant_id, i.qty]).sort(), [[VARIANT_ID, 2], ["4002", 1], ["4003", 1]].sort());
  assert.deepEqual(s.pack_held_items, []);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 34650);
  assert.equal(s.quantity, 4);
  assert.equal(s.stock_hold_at, null);
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.auto_recurring.transaction_amount, 34650);
  const mails = W.resend.byType("stock_restored");
  assert.equal(mails.length, 1);
  assert.match(mails[0].subject, /Volvió Tortilla ×1/);
});

test("faltan TODOS los productos → se pausa como siempre (mail sin stock) y vuelve cuando hay alguno, con el resto en espera", async () => {
  W.shopify.stock[VARIANT_ID] = 0; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 0;
  let r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.deepEqual(r, { revisadas: 1, pausadas: 1, reactivadas: 0 });
  let s = W.sub(SID);
  assert.equal(s.status, "paused"); assert.equal(s.paused_reason, "sin_stock");
  assert.deepEqual(s.pack_items.map(i => i.shopify_variant_id), [VARIANT_ID, "4002", "4003"], "el pack queda entero para cuando vuelva");
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.status, "paused");
  assert.equal(W.resend.byType("out_of_stock").length, 1);
  // Vuelve solo el grisín: se reactiva con el grisín y el resto espera.
  W.shopify.stock["4003"] = 5;
  r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.equal(r.reactivadas, 1);
  s = W.sub(SID);
  assert.equal(s.status, "active");
  assert.deepEqual(s.pack_items.map(i => [i.shopify_variant_id, i.qty]), [["4003", 1]]);
  assert.deepEqual(s.pack_held_items.map(i => [i.shopify_variant_id, i.qty]), [[VARIANT_ID, 2], ["4002", 1]]);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 5100 + 1500);
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.auto_recurring.transaction_amount, 6600);
});

test("después del cobro: la orden se crea con lo que llevaba y recién después se ajusta el pack para el próximo", async () => {
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  const out = await fulfillCharge(W.merchant(), SID, W.sub(SID), { payment_id: 9001, total_price: 34650, charge_number: 2, merchantId: MID }, "test");
  assert.ok(out.shopifyOrderId, "la orden de ESTE cobro se crea igual: la plata ya entró");
  assert.deepEqual(W.shopify.orderPosts[0].order.line_items.map(li => [li.variant_id, li.quantity]), [[VARIANT_ID, 2], ["4002", 1], ["4003", 1]]);
  assert.equal(out.stock.paused, false); assert.equal(out.stock.pack.changed, true);
  const s = W.sub(SID);
  assert.equal(s.status, "active");
  assert.deepEqual(s.pack_held_items.map(i => i.shopify_variant_id), ["4002"]);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 27000);
});

test("portal: ve lo que falta y con 'Cambiarlo por otro' deja de esperarlo (drop_held)", async () => {
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  await vigilar([{ id: SID, ...W.sub(SID) }]);
  const TOKEN = pub.generatePortalToken(MID, SID, 180);
  const g = await invoke(pub.default, { method: "GET", query: { action: "sub", token: TOKEN } });
  assert.deepEqual(g.body.pack.held.map(h => [h.title, h.qty]), [["Tortilla", 1]]);
  // Reemplaza la tortilla por un grisín más y suelta la espera.
  const r = await invoke(pub.default, { method: "POST", query: { action: "sub", token: TOKEN }, body: { action: "update-pack", drop_held: true, items: [{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4003", qty: 2 }] } });
  assert.equal(r.statusCode, 200);
  const s = W.sub(SID);
  assert.deepEqual(s.pack_held_items, []);
  assert.equal(s.quantity, 4);
  assert.equal(s.plan_snapshot.total_per_charge_ars, Math.round(36000 * 0.85) + 1500);
  // Repusieron la tortilla: ya no vuelve sola, el cliente la reemplazó.
  W.shopify.stock["4002"] = 8;
  const r2 = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.equal(r2.ajustadas, undefined);
  assert.equal(W.sub(SID).pack_items.some(i => i.shopify_variant_id === "4002"), false);
});

test("si MP no acepta el monto, no se toca nada local (ni espera, ni mail)", async () => {
  W.seedSub(SID, SUB({ mp_preapproval_id: "pre_inexistente" }));
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  const r = await vigilar([{ id: SID, ...W.sub(SID) }]);
  assert.equal(r.ajustadas, undefined);
  const s = W.sub(SID);
  assert.equal(s.pack_items.length, 3); assert.equal(s.pack_held_items, undefined);
  assert.equal(W.resend.byType("stock_hold").length, 0);
});

test("con un producto en espera, la renovación que cobra MP arma la orden SIN ese producto y por el monto nuevo", async () => {
  W.shopify.stock[VARIANT_ID] = 10; W.shopify.stock["4002"] = 0; W.shopify.stock["4003"] = 10;
  await vigilar([{ id: SID, ...W.sub(SID) }]);           // tortilla en espera, MP en 27.000
  const pay = W.mp.addPayment(mpPayment({ id: 1410000051, amount: 27000, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  const o = W.shopify.orderPosts.at(-1).order;
  // 25.500 de productos repartidos: 24.000/30.000 → 20.400 (2 × 10.200), 6.000/30.000 → 5.100.
  assert.deepEqual(o.line_items, [{ variant_id: VARIANT_ID, quantity: 2, price: "10200.00" }, { variant_id: "4003", quantity: 1, price: "5100.00" }]);
  assert.equal(o.shipping_lines[0].price, "1500.00");
  assert.equal(W.sub(SID).pack_held_items.length, 1, "la tortilla sigue esperando");
});
