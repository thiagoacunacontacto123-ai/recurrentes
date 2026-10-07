// "Armá tu pack" + frecuencias a elegir (7-oct-2026, G4U). El pack se llena con
// productos DISTINTOS de la tienda y el comprador elige cada cuánto le llega. Lo
// que protege: el precio sale del PLAN (nunca del body), la suma de cantidades es
// la del pack, la orden lleva un renglón por producto con el cobro repartido en
// proporción, y un plan sin `mix` sigue exactamente igual que antes.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, snapshot, mpPayment, mpWebhookReq, MID, PLAN_ID, MP_TOKEN, VARIANT_ID, capsulasPlan, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { normalizeMix, resolvePack, resolveMixSelection, mixTitle, normalizeFrequencyOptions, pickFrequency } from "../../api/_lib/packs.js";
import { buildBundlePayload } from "../../api/widget.js";
import { cartBodyHtml } from "../../shared/bundle/cart.js";
import * as vmod from "../../shared/bundle/viewmodel.js";

const { default: webhook } = await loadApi("api/mp/webhook.js");
const { default: init } = await loadApi("api/checkout/init.js");
const { default: pub } = await loadApi("api/public.js");

// Pan de molde $12.000 (la ficha) + tortilla $9.000 + grisines $6.000. Packs x1 / x4, 15 %.
const MIX_PLAN = () => capsulasPlan({
  pricing_mode: "packs", discount_pct: 15, base_price_ars: 12000, frequency_days: 30, frequency_scales_with_qty: false,
  packs: [{ qty: 1, price_ars: 12000 }, { qty: 4, price_ars: 48000, badge: "Más elegido", default: true }],
  mix: { enabled: true, items: [
    { shopify_product_id: "7002", shopify_variant_id: "4002", title: "Tortilla", price_ars: 9000 },
    { shopify_product_id: "7003", shopify_variant_id: "4003", title: "Grisines", price_ars: 6000 },
  ] },
  frequency_options: [15, 30, 60],
});
const ITEMS = [{ variant_id: VARIANT_ID, qty: 2 }, { variant_id: "4002", qty: 1 }, { variant_id: "4003", qty: 1 }];
const PACK_ITEMS = [
  { shopify_variant_id: VARIANT_ID, shopify_product_id: "7001", title: "Cápsulas LuminaLabs", image: "https://cdn.shopify.test/capsulas.jpg", qty: 2, price_ars: 12000 },
  { shopify_variant_id: "4002", shopify_product_id: "7002", title: "Tortilla", image: null, qty: 1, price_ars: 9000 },
  { shopify_variant_id: "4003", shopify_product_id: "7003", title: "Grisines", image: null, qty: 1, price_ars: 6000 },
];
const pagar = (body) => invoke(init, { method: "POST", query: {}, body: {
  merchant_id: MID, plan_id: PLAN_ID, pack_index: 1,
  customer: { email: "mica@cliente.test", name: "Mica López", phone: "1144440000", tax_id: "30123456" },
  shipping_address: { ...ADDRESS }, ...body,
}, headers: { "x-forwarded-for": "190.1.2.3" } });

let W;
beforeEach(() => { W = createWorld({ plan: MIX_PLAN() }); W.shopify.variants["4002"] = 9000; W.shopify.variants["4003"] = 6000; });
afterEach(() => { W.router.assertClean(); });

test("modelo: normalizeMix valida y resolveMixSelection cobra Σ(lista × cantidad) con el descuento del plan", () => {
  assert.ok(normalizeMix({ enabled: true, items: [] }).error, "prendido sin productos → error");
  assert.ok(normalizeMix({ enabled: true, items: [{ shopify_variant_id: "x", title: "T", price_ars: 1 }] }).error, "variante inválida → error");
  assert.equal(normalizeMix(null).mix, null);
  const ok = normalizeMix({ enabled: true, items: [{ shopify_variant_id: "4002", shopify_product_id: "7002", title: "Tortilla", price_ars: "9000" }, { shopify_variant_id: "4002", title: "Repetida", price_ars: 1 }] });
  assert.equal(ok.mix.items.length, 1, "la variante repetida se descarta");
  const plan = MIX_PLAN(), pack = resolvePack(plan, 1);
  const sel = resolveMixSelection(plan, pack, ITEMS);
  assert.equal(sel.listTotal, 39000); assert.equal(sel.subTotal, 33150); assert.equal(sel.qty, 4);
  assert.equal(mixTitle(sel.items, sel.qty), "Pack ×4 · Cápsulas LuminaLabs ×2, Tortilla ×1, Grisines ×1");
  assert.match(resolveMixSelection(plan, pack, ITEMS.slice(0, 2)).error, /4 unidades y elegiste 3/);
  assert.match(resolveMixSelection(plan, pack, [{ variant_id: "9999", qty: 4 }]).error, /no está disponible/);
  // El navegador calcula lo mismo (shared/bundle/viewmodel.js).
  const vsel = vmod.resolveMixSelection(plan, vmod.resolvePack(plan, 1), vmod.parseMixItemsParam("4001:2,4002:1,4003:1"));
  assert.equal(vsel.subTotal, 33150);
  // Frecuencias: la pedida solo si el plan la ofrece.
  assert.deepEqual(normalizeFrequencyOptions("15, 30, 60, 30").options, [15, 30, 60]);
  assert.ok(normalizeFrequencyOptions([0]).error);
  assert.equal(pickFrequency(plan, pack, "60"), 60);
  assert.equal(pickFrequency(plan, pack, 45), 30, "45 no está en las opciones → la del pack");
});

test("checkout/init: guarda pack_items con el precio del server, el título del pack y la frecuencia elegida", async () => {
  const res = await pagar({ pack_items: ITEMS, frequency_days: 60 });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = W.sub(res.body.subscriber_id);
  assert.deepEqual(sub.pack_items, PACK_ITEMS);
  assert.equal(sub.plan_snapshot.subtotal_ars, 33150);
  assert.equal(sub.plan_snapshot.subscription_price_ars, 33150);
  assert.equal(sub.plan_snapshot.frequency_days, 60);
  assert.equal(sub.plan_snapshot.mix, true);
  assert.equal(sub.quantity, 4);
  assert.equal(sub.plan_snapshot.product_title, "Pack ×4 · Cápsulas LuminaLabs ×2, Tortilla ×1, Grisines ×1");
  assert.match(sub.recover_path, /items=4001%3A2%2C4002%3A1%2C4003%3A1/);
  assert.match(sub.recover_path, /freq_days=60/);
  // El plan ad-hoc de MP cobra el total del pack mixto cada 60 días.
  const mpPlan = [...W.mp.plans.values()].at(-1);
  assert.equal(mpPlan.auto_recurring.frequency, 60);
  assert.equal(mpPlan.auto_recurring.transaction_amount, sub.plan_snapshot.total_per_charge_ars);
  assert.ok(mpPlan.auto_recurring.transaction_amount >= 33150);
});

test("checkout/init: cantidades que no suman el pack o un producto ajeno → 400; frecuencia no ofrecida → la del pack", async () => {
  const r1 = await pagar({ pack_items: ITEMS.slice(0, 2) });
  assert.equal(r1.statusCode, 400); assert.match(r1.body.error, /4 unidades/);
  const r2 = await pagar({ pack_items: [{ variant_id: "9999", qty: 4 }] });
  assert.equal(r2.statusCode, 400); assert.match(r2.body.error, /no está disponible/);
  const r3 = await pagar({ pack_items: ITEMS, frequency_days: 45 });
  assert.equal(r3.statusCode, 200, JSON.stringify(r3.body));
  assert.equal(W.sub(r3.body.subscriber_id).plan_snapshot.frequency_days, 30);
  // Sin pack_items (widget viejo en caché): el pack se llena con el producto de la ficha, nada se rompe.
  const r4 = await pagar({});
  assert.equal(r4.statusCode, 200, JSON.stringify(r4.body));
  const s4 = W.sub(r4.body.subscriber_id);
  assert.equal(s4.pack_items.length, 1); assert.equal(s4.pack_items[0].qty, 4); assert.equal(s4.plan_snapshot.subtotal_ars, 40800);
});

test("renovación: la orden lleva un renglón por producto y el cobro se reparte en proporción al precio de lista", async () => {
  W.seedSub("sub_mica", subscriber({
    quantity: 4, pack_items: PACK_ITEMS,
    plan_snapshot: { ...snapshot({ qty: 4 }), subtotal_ars: 33150, subscription_price_ars: 33150, total_per_charge_ars: 34650, mix: true, product_title: "Pack ×4 · …" },
  }));
  const pay = W.mp.addPayment(mpPayment({ id: 1410000021, amount: 34650, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  const o = W.shopify.orderPosts[0].order;
  // 33.150 de productos: 24.000/39.000 → 20.400 (2 × 10.200), 9.000/39.000 → 7.650, 6.000/39.000 → 5.100.
  assert.deepEqual(o.line_items, [
    { variant_id: VARIANT_ID, quantity: 2, price: "10200.00" },
    { variant_id: "4002", quantity: 1, price: "7650.00" },
    { variant_id: "4003", quantity: 1, price: "5100.00" },
  ]);
  assert.equal(o.shipping_lines[0].price, "1500.00");
});

test("sin mix nada cambia: el plan de siempre cobra y arma la orden igual", async () => {
  W = createWorld();
  W.seedSub("sub_ana", subscriber({ quantity: 2, plan_snapshot: snapshot({ qty: 2 }) }));
  const pay = W.mp.addPayment(mpPayment({ id: 1410000022, amount: 23100, preapprovalId: "pre_ana" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(W.shopify.orderPosts[0].order.line_items, [{ variant_id: VARIANT_ID, quantity: 2, price: "10800.00" }]);
});

test("widget y carrito: el payload trae los productos del pack (la ficha primero) y las frecuencias; el carrito lista lo elegido", async () => {
  const payload = buildBundlePayload(MIX_PLAN(), { widget_variant: "v01", widget_color: "#500322" });
  assert.deepEqual(payload.mix.items.map(i => [i.variant_id, i.price, i.main]), [[VARIANT_ID, 12000, true], ["4002", 9000, false], ["4003", 6000, false]]);
  assert.deepEqual(payload.freq_options, [15, 30, 60]);
  assert.equal(payload.discount_pct, 15);
  // Un plan sin mix: el payload no cambia de forma (nada en el widget se entera).
  const plain = buildBundlePayload(capsulasPlan({ pricing_mode: "packs", packs: [{ qty: 1, price_ars: 12000 }] }), {});
  assert.equal(plain.mix, null); assert.deepEqual(plain.freq_options, []);
  const TXT = { title: "Tu carrito", row_subtotal: "Subtotal", row_save: "Ahorrás", row_total: "Total", show_ship: false, item_sub: "{{qty}} · {{freq}}" };
  const fmt = (n) => "$" + Math.round(n).toLocaleString("es-AR"), esc = (s) => String(s);
  const html = cartBodyHtml(payload.packs[1], TXT, fmt, esc, "", { rows: [{ title: "Cápsulas", qty: 2, price: 12000 }, { title: "Tortilla", qty: 1, price: 9000 }, { title: "Grisines", qty: 1, price: 6000 }], sub: 33150, list: 39000, freq_label: "2 meses" });
  assert.match(html, /2 × Cápsulas/); assert.match(html, /1 × Grisines/);
  assert.match(html, /\$33\.150/); assert.match(html, /\$39\.000/); assert.match(html, /cada 2 meses/);
  // public?action=plan (lo que lee el checkout) expone el catálogo del pack y las frecuencias.
  const res = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, plan: PLAN_ID, checkout: "1" } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.plan.mix.items.length, 3);
  assert.equal(res.body.plan.mix.items[0].main, true);
  assert.deepEqual(res.body.plan.frequency_options, [15, 30, 60]);
});
