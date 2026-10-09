// Cambiar el pedido de un pack armado desde el portal (9-oct-2026, G4U: "que el
// cliente saque un pan y se le cobre lo que corresponde"). Lo que protege: el precio
// sale del PLAN (nunca del body), Mercado Pago recibe el monto nuevo ANTES de tocar
// nada local (si MP dice que no, nada cambia), la próxima orden lleva los productos
// nuevos con el cobro repartido en proporción, y queda el rastro del cambio.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, snapshot, mpPayment, mpPreapproval, mpWebhookReq, MID, PLAN_ID, MP_TOKEN, VARIANT_ID, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";
import { planPackChange, packEditState, newTotal } from "../../api/_lib/packChange.js";

const { default: webhook } = await loadApi("api/mp/webhook.js");
const pub = await loadApi("api/public.js");

const MIX_PLAN = () => capsulasPlan({
  pricing_mode: "packs", discount_pct: 15, base_price_ars: 12000, frequency_days: 7, frequency_scales_with_qty: false,
  packs: [{ qty: 1, price_ars: 12000 }, { qty: 4, price_ars: 48000, badge: "Más elegido", default: true }],
  mix: { enabled: true, items: [
    { shopify_product_id: "7002", shopify_variant_id: "4002", title: "Tortilla", price_ars: 9000 },
    { shopify_product_id: "7003", shopify_variant_id: "4003", title: "Grisines", price_ars: 6000 },
  ] },
});
const PACK_ITEMS = [
  { shopify_variant_id: VARIANT_ID, shopify_product_id: "7001", title: "Cápsulas LuminaLabs", image: "https://cdn.shopify.test/capsulas.jpg", qty: 2, price_ars: 12000 },
  { shopify_variant_id: "4002", shopify_product_id: "7002", title: "Tortilla", image: null, qty: 1, price_ars: 9000 },
  { shopify_variant_id: "4003", shopify_product_id: "7003", title: "Grisines", image: null, qty: 1, price_ars: 6000 },
];
// Pack ×4: lista 39.000 → 33.150 con 15 % + envío 1.500 = 34.650.
const SUB = (over = {}) => subscriber({
  quantity: 4, pack_items: PACK_ITEMS,
  plan_snapshot: { ...snapshot({ qty: 4 }), subtotal_ars: 33150, subscription_price_ars: 33150, total_per_charge_ars: 34650, mix: true, product_title: "Pack ×4 · Cápsulas LuminaLabs ×2, Tortilla ×1, Grisines ×1", pack_index: 1, pricing_mode: "packs" },
  ...over,
});

let W, TOKEN;
beforeEach(() => {
  W = createWorld({ plan: MIX_PLAN() });
  W.shopify.variants["4002"] = 9000; W.shopify.variants["4003"] = 6000;
  W.seedSub("sub_mica", SUB());
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana", amount: 34650, frequency: 7 }), MP_TOKEN);
  TOKEN = pub.generatePortalToken(MID, "sub_mica", 180);
});
afterEach(() => { W.router.assertClean(); });

const portalGet = () => invoke(pub.default, { method: "GET", query: { action: "sub", token: TOKEN } });
const change = (items, token = TOKEN) => invoke(pub.default, { method: "POST", query: { action: "sub", token }, body: { action: "update-pack", items } });

test("modelo: el precio sale del plan, mínimo 1 unidad, el envío y los extras quedan como estaban", () => {
  const plan = MIX_PLAN(), sub = SUB();
  // Saca una tortilla y un grisín: 2 cápsulas = 24.000 → 20.400 + 1.500 = 21.900.
  const p = planPackChange(sub, plan, [{ variant_id: VARIANT_ID, qty: 2 }]);
  assert.equal(p.ok, true); assert.equal(p.units, 2); assert.equal(p.subtotal, 20400); assert.equal(p.total, 21900);
  // Agrega: 2 cápsulas + 3 tortillas = 51.000 → 43.350 + 1.500.
  assert.equal(planPackChange(sub, plan, [{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4002", qty: 3 }]).total, 44850);
  assert.match(planPackChange(sub, plan, []).error, /al menos un producto/);
  assert.match(planPackChange(sub, plan, [{ variant_id: "9999", qty: 1 }]).error, /no está disponible/);
  assert.match(planPackChange(sub, plan, [{ variant_id: VARIANT_ID, qty: 2, price_ars: 1 }]).error ?? "", /^$/, "un precio en el body se ignora");
  assert.equal(planPackChange(sub, plan, [{ variant_id: VARIANT_ID, qty: 2, price_ars: 1 }]).subtotal, 20400);
  assert.match(planPackChange({ ...sub, status: "cancelled" }, plan, [{ variant_id: VARIANT_ID, qty: 1 }]).error, /activa o pausada/);
  assert.match(planPackChange(subscriber(), plan, [{ variant_id: VARIANT_ID, qty: 1 }]).error, /no es de un pack armado/);
  // Cupón de % permanente del snapshot: se respeta sobre el subtotal nuevo.
  assert.equal(newTotal({ plan_snapshot: { shipping_price_ars: 1500, extras_total_ars: 0, discount_code_pct: 10 } }, 20400).total, 18360 + 1500);
  // Estado para el portal: catálogo con la ficha primero y lo que lleva hoy.
  const st = packEditState(sub, plan, { allowed: true });
  assert.deepEqual(st.catalog.map(c => [c.shopify_variant_id, c.price_ars]), [[VARIANT_ID, 12000], ["4002", 9000], ["4003", 6000]]);
  assert.equal(st.items.length, 3); assert.equal(st.editable, true); assert.equal(st.discount_pct, 15); assert.equal(st.shipping_price_ars, 1500);
  assert.equal(packEditState(subscriber(), plan), null, "una sub sin pack armado no tiene editor");
});

test("portal: el GET trae el pack editable; el POST cambia el monto en MP primero y después la sub, con rastro", async () => {
  const g = await portalGet();
  assert.equal(g.statusCode, 200);
  assert.equal(g.body.pack.editable, true);
  assert.equal(g.body.portal.allow_pack_edit, true);
  assert.deepEqual(g.body.pack.items.map(i => [i.shopify_variant_id, i.qty]), [[VARIANT_ID, 2], ["4002", 1], ["4003", 1]]);

  const r = await change([{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4003", qty: 1 }]);   // saca la tortilla
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.total, 25500 + 1500, "30.000 de lista → 25.500 + envío");
  assert.equal(r.body.product_title, "Pack ×3 · Cápsulas LuminaLabs ×2, Grisines ×1");
  assert.deepEqual(W.mp.preapprovalUpdates.map(u => [u.id, u.body]), [["pre_ana", { auto_recurring: { transaction_amount: 27000, currency_id: "ARS" } }]]);
  const s = W.sub("sub_mica");
  assert.equal(s.quantity, 3);
  assert.deepEqual(s.pack_items.map(i => [i.shopify_variant_id, i.qty, i.price_ars]), [[VARIANT_ID, 2, 12000], ["4003", 1, 6000]]);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 27000);
  assert.equal(s.plan_snapshot.subscription_price_ars, 25500);
  assert.equal(s.plan_snapshot.shipping_price_ars, 1500, "el envío no se toca");
  assert.equal(s.pack_changes.length, 1);
  assert.equal(s.pack_changes[0].by, "customer");
  assert.equal(s.pack_changes[0].from.total, 34650); assert.equal(s.pack_changes[0].to.total, 27000);
  assert.equal(s.status, "active");

  // Mismo pedido otra vez: no toca MP ni suma rastro.
  const r2 = await change([{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4003", qty: 1 }]);
  assert.equal(r2.body.unchanged, true);
  assert.equal(W.mp.preapprovalUpdates.length, 1);
  assert.equal(W.sub("sub_mica").pack_changes.length, 1);
});

test("si Mercado Pago rechaza el monto nuevo, NADA cambia (ni pack ni total)", async () => {
  // El preapproval no existe en MP → el PUT da 404, como cualquier rechazo.
  W.seedSub("sub_mica", SUB({ mp_preapproval_id: "pre_inexistente" }));
  const r = await change([{ variant_id: VARIANT_ID, qty: 1 }]);
  assert.equal(r.statusCode, 502);
  assert.match(r.body.error, /Mercado Pago/);
  const s = W.sub("sub_mica");
  assert.equal(s.quantity, 4);
  assert.equal(s.plan_snapshot.total_per_charge_ars, 34650);
  assert.equal(s.pack_changes, undefined);
});

test("después del cambio, la renovación crea la orden con los productos NUEVOS y el cobro repartido", async () => {
  await change([{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4003", qty: 1 }]);
  // MP cobra el monto nuevo (27.000) en la próxima renovación.
  const pay = W.mp.addPayment(mpPayment({ id: 1410000031, amount: 27000, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  const o = W.shopify.orderPosts[0].order;
  // 25.500 de productos: 24.000/30.000 → 20.400 (2 × 10.200), 6.000/30.000 → 5.100.
  assert.deepEqual(o.line_items, [
    { variant_id: VARIANT_ID, quantity: 2, price: "10200.00" },
    { variant_id: "4003", quantity: 1, price: "5100.00" },
  ]);
  assert.equal(o.shipping_lines[0].price, "1500.00");
});

test("la tienda puede apagar 'Cambiar el pedido' en el portal; una sub cancelada no cambia; el body sin items es 400", async () => {
  seedDoc(`merchants/${MID}`, { ...W.merchant(), portal: { allow_pack_edit: false } });
  let r = await change([{ variant_id: VARIANT_ID, qty: 1 }]);
  assert.equal(r.statusCode, 403);
  assert.equal((await portalGet()).body.pack.editable, false);
  seedDoc(`merchants/${MID}`, { ...W.merchant(), portal: {} });
  W.seedSub("sub_mica", SUB({ status: "cancelled" }));
  r = await change([{ variant_id: VARIANT_ID, qty: 1 }]);
  assert.equal(r.statusCode, 409);
  W.seedSub("sub_mica", SUB());
  r = await change([]);
  assert.equal(r.statusCode, 400);
  assert.equal(W.mp.preapprovalUpdates.length, 0);
});
