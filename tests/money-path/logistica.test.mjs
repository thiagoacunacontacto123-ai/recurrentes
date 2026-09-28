// (e) Logística: qué envíos se ofrecen al suscribirse y qué hacer sin stock.
// 28-sept-2026 (Thiago, pedido de G4U).
//
// Lo que estos tests cuidan, en orden de gravedad:
//   1. Con la configuración de siempre NO cambia NADA: ni una llamada extra a
//      la tienda, ni una pausa, ni un cobro distinto.
//   2. El que pidió "pausar si no hay stock" no se queda sin la orden del cobro
//      que YA se hizo: la orden se crea igual y después se pausa.
//   3. Un envío apagado no se le ofrece al comprador.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID, VARIANT_ID, ADDRESS, MP_TOKEN } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { fulfillCharge } = await loadApi("api/_lib/sync.js");
const { resolveCheckoutShippingRates } = await loadApi("api/widget.js");
const { sanitizeStockPolicy, resolveStockPolicy, stockCheckNeeded, sanitizeShippingOff, offeredRates, rateKey, rateLabel } = await loadApi("shared/platform/logistics.js");

let W;
beforeEach(() => {
  W = createWorld();
  // La suscripción existe en Mercado Pago: sin esto el PUT de pausa da 404.
  W.mp.addPreapproval({ id: "PRE-1", status: "authorized", external_reference: `${MID}:${SID}` }, MP_TOKEN);
});
afterEach(() => { W.router.assertClean(); });

const SID = "s_stock";
const subConPlan = (over = {}) => ({
  customer_email: "ana@cliente.test", customer_name: "Ana Díaz", customer_phone: "1144440000",
  shipping_address: { ...ADDRESS },
  plan_id: PLAN_ID, status: "active", quantity: 2,
  mp_preapproval_id: "PRE-1",
  plan_snapshot: { shopify_variant_id: VARIANT_ID, units_per_shipment: 2, shipping_price_ars: 0, total_per_charge_ars: 10000 },
  shopify_orders: [],
  ...over,
});

const cobrar = (merchant) => fulfillCharge(merchant, SID, rawGet(`merchants/${MID}/subscribers/${SID}`), {
  payment_id: 9001, total_price: 10000, charge_number: 1, merchantId: MID,
}, "test");

// ── 1. Lo de siempre ────────────────────────────────────────────────────────
test("(e) con la configuración de siempre no se consulta el stock ni se pausa nada", async () => {
  const merchant = luminaMerchant();
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  W.shopify.stock[String(VARIANT_ID)] = 0;      // aunque no haya, no mira
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId, "la orden se crea");
  assert.equal(out.stock, undefined, "ni siquiera evalúa la política");
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "active");
  assert.equal(W.mp.preapprovalUpdates.length, 0, "no toca Mercado Pago");
});

test("(e) 'la suscripción no mira stock': tampoco consulta", () => {
  assert.equal(stockCheckNeeded(luminaMerchant({ stock_policy: { source: "own", on_missing: "pause" } })), false);
});

// ── 2. Pausar cuando falta ──────────────────────────────────────────────────
const PAUSAR = { stock_policy: { on_missing: "pause" } };

test("(e) sin stock: la orden del cobro se crea IGUAL y después se pausa", async () => {
  // Lo importante es el orden: el dinero ya entró, así que la orden existe sí o
  // sí. La pausa es para que NO se cobre la próxima.
  const merchant = luminaMerchant(PAUSAR);
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  W.shopify.stock[String(VARIANT_ID)] = 1;      // pide 2, hay 1
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId, "la orden de este cobro NO se pierde");
  assert.deepEqual(out.stock, { missing: true, paused: true, available: 1, needed: 2 });
  const sub = rawGet(`merchants/${MID}/subscribers/${SID}`);
  assert.equal(sub.status, "paused");
  assert.equal(sub.paused_reason, "sin_stock", "para poder explicárselo al comercio y al cliente");
  const upd = W.mp.preapprovalUpdates.at(-1);
  assert.equal(upd.id, "PRE-1");
  assert.equal(upd.body.status, "paused", "en MP también, si no el próximo cobro sale igual");
});

test("(e) con stock de sobra no pausa nada", async () => {
  const merchant = luminaMerchant(PAUSAR);
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  W.shopify.stock[String(VARIANT_ID)] = 10;
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId);
  assert.equal(out.stock, undefined);
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "active");
  assert.equal(W.mp.preapprovalUpdates.length, 0);
});

test("(e) variante sin seguimiento de inventario: no se pausa a nadie por las dudas", async () => {
  // En Shopify, sin `inventory_management` el stock es infinito. Pausar ahí
  // sería cortarle la venta a alguien que nunca cargó inventario.
  const merchant = luminaMerchant(PAUSAR);
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  const out = await cobrar(merchant);           // sin W.shopify.stock
  assert.ok(out.shopifyOrderId);
  assert.equal(out.stock, undefined);
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "active");
});

test("(e) si no podemos pausar en Mercado Pago, la suscripción NO queda mintiendo", async () => {
  // Mejor un cobro de más que un estado local que dice "pausada" mientras MP
  // sigue cobrando.
  const merchant = luminaMerchant(PAUSAR);
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan({ mp_preapproval_id: "PRE-ROTA" }));
  W.shopify.stock[String(VARIANT_ID)] = 0;
  W.router.on("PUT", "api.mercadopago.com", /^\/preapproval\/PRE-ROTA$/, () => ({ status: 500, json: { message: "boom" } }));
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId);
  assert.equal(out.stock.paused, false);
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "active", "sigue activa: el estado no se toca");
});

// ── 3. Envíos que se ofrecen ────────────────────────────────────────────────
test("(e) por defecto se ofrecen TODOS: nadie se queda sin envíos por esto", () => {
  // Lo que pidió Thiago: que de fábrica quede como estaba antes de que esto
  // existiera. La lista de apagados vacía = todo igual.
  const rates = [{ name: "A domicilio", price: 4500, code: "dom" }, { name: "A sucursal", price: 2800, code: "suc" }];
  assert.deepEqual(offeredRates(rates, luminaMerchant()).map(r => r.name), ["A domicilio", "A sucursal"]);
  assert.deepEqual(resolveCheckoutShippingRates(luminaMerchant({ checkout_shipping_rates: rates })).map(r => r.name), ["A domicilio", "A sucursal"]);
});

test("(e) el que apaga las sucursales deja de ofrecerlas en la suscripción", () => {
  const m = luminaMerchant({
    checkout_shipping_rates: [{ name: "A domicilio", price: 4500, code: "dom" }, { name: "A sucursal", price: 2800, code: "suc" }],
    shipping_off: ["suc"],
  });
  assert.deepEqual(resolveCheckoutShippingRates(m).map(r => r.name), ["A domicilio"], "la sucursal queda solo para la compra única de la tienda");
});

test("(e) el mismo apagado sirve para lo que Shopify cotiza en vivo", () => {
  // Las tarifas en vivo no se guardan en ningún lado: se filtran por el mismo
  // code (o por el nombre, si la tarifa no trae code).
  const m = luminaMerchant({ shipping_off: ["a sucursal"] });
  const live = [{ name: "A domicilio", price: 5200 }, { name: "A sucursal", price: 3100 }];
  assert.deepEqual(offeredRates(live, m).map(r => r.name), ["A domicilio"]);
});

test("(e) la lista de apagados se sanea (sin repetidos ni basura)", () => {
  assert.deepEqual(sanitizeShippingOff(["suc", "suc", "  ", "dom"]), { shipping_off: ["suc", "dom"] });
  assert.deepEqual(sanitizeShippingOff([]), { shipping_off: null }, "vacía = todo como siempre");
  assert.ok(sanitizeShippingOff("suc").error, "tiene que ser una lista");
});

// ── 4. Lo que se guarda ─────────────────────────────────────────────────────
test("(e) la configuración de stock se sanea y el default no ocupa lugar", () => {
  assert.deepEqual(sanitizeStockPolicy({ source: "store", on_missing: "charge" }), { stock_policy: null }, "igual al default = nada guardado");
  assert.deepEqual(sanitizeStockPolicy({ on_missing: "pause" }), { stock_policy: { on_missing: "pause" } });
  assert.ok(sanitizeStockPolicy({ on_missing: "borrar_todo" }).error, "no se acepta cualquier cosa");
  assert.deepEqual(resolveStockPolicy({}), { source: "store", on_missing: "charge" });
});

// ── 5. Antes del cobro ──────────────────────────────────────────────────────
// Lo que pidió Thiago: el 15 se queda sin stock, el 17 toca la renovación → esa
// renovación NO sale. A MP no se le puede decir "esta vez no": hay que dejar el
// preapproval pausado ANTES de la fecha.
const { stockWatchForMerchant } = await loadApi("api/_lib/stock.js");
const { db } = await loadApi("api/_lib/firebase.js");

const AHORA = Date.parse("2026-09-17T10:00:00.000Z");
const vigilar = (merchant, subs) => stockWatchForMerchant({ db, merchant, merchantId: MID, subs, nowMs: AHORA, tag: "test" });

test("(e) sin stock y con el cobro cerca: se pausa ANTES, así ese cobro no sale", async () => {
  const merchant = luminaMerchant(PAUSAR);
  const sub = { id: SID, ...subConPlan({ next_charge_at: "2026-09-17T14:00:00.000Z" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const r = await vigilar(merchant, [sub]);
  assert.deepEqual(r, { revisadas: 1, pausadas: 1, reactivadas: 0 });
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.status, "paused", "en MP: es lo único que frena el cobro");
  const guardada = rawGet(`merchants/${MID}/subscribers/${SID}`);
  assert.equal(guardada.status, "paused");
  assert.equal(guardada.paused_reason, "sin_stock");
});

test("(e) el cobro todavía lejos: no se toca (el comercio tiene tiempo de reponer)", async () => {
  const merchant = luminaMerchant(PAUSAR);
  const sub = { id: SID, ...subConPlan({ next_charge_at: "2026-09-25T14:00:00.000Z" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const r = await vigilar(merchant, [sub]);
  assert.deepEqual(r, { revisadas: 0, pausadas: 0, reactivadas: 0 });
  assert.equal(W.mp.preapprovalUpdates.length, 0);
});

test("(e) cuando vuelve el stock, la suscripción se reactiva sola", async () => {
  // Si no volviera sola, "pausar por stock" sería una baja disfrazada.
  const merchant = luminaMerchant(PAUSAR);
  const sub = { id: SID, ...subConPlan({ status: "paused", paused_reason: "sin_stock" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 20;
  const r = await vigilar(merchant, [sub]);
  assert.deepEqual(r, { revisadas: 1, pausadas: 0, reactivadas: 1 });
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.status, "authorized");
  const guardada = rawGet(`merchants/${MID}/subscribers/${SID}`);
  assert.equal(guardada.status, "active");
  assert.equal(guardada.paused_reason, null);
});

test("(e) una pausa que puso el cliente NO se reactiva sola", async () => {
  const merchant = luminaMerchant(PAUSAR);
  const sub = { id: SID, ...subConPlan({ status: "paused" }) };   // sin paused_reason
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 20;
  const r = await vigilar(merchant, [sub]);
  assert.deepEqual(r, { revisadas: 0, pausadas: 0, reactivadas: 0 });
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "paused");
});

test("(e) con la configuración de siempre el vigilante no hace nada", async () => {
  const sub = { id: SID, ...subConPlan({ next_charge_at: "2026-09-17T14:00:00.000Z" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const r = await vigilar(luminaMerchant(), [sub]);
  assert.deepEqual(r, { revisadas: 0, pausadas: 0, reactivadas: 0 });
});

test("(e) las sucursales se agrupan por servicio: apagar una no puede depender del CP", () => {
  // Las apps de envío devuelven una fila por sucursal cercana al CP consultado
  // (`…:andreani_pickup:ship:12218`). Guardar esa sucursal suelta no serviría:
  // el que compra de otro barrio ve otras. 28-sept-2026, Thiago.
  const live = [
    { name: "Andreani Punto de Retiro — HOP PARAGUAY 4194", code: "envialo:andreani:andreani_pickup:ship:12218" },
    { name: "Andreani Punto de Retiro — HOP URIARTE 1128", code: "envialo:andreani:andreani_pickup:ship:99" },
    { name: 'Andreani Estándar "Envío a domicilio"', code: "envialo:andreani:andreani_home:ship:1" },
  ];
  assert.equal(rateKey(live[0]), rateKey(live[1]), "las dos sucursales son el mismo servicio");
  assert.notEqual(rateKey(live[0]), rateKey(live[2]), "el domicilio es otro");
  assert.equal(rateLabel(live[0]), "Andreani Punto de Retiro", "al comercio se le muestra el servicio, no la dirección");
  // Apagando el servicio se van TODAS las sucursales, incluidas las de otro CP.
  const m = luminaMerchant({ shipping_off: ["envialo:andreani:andreani_pickup:ship"] });
  assert.deepEqual(offeredRates(live, m).map(r => r.name), ['Andreani Estándar "Envío a domicilio"']);
});
