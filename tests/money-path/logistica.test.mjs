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
import { invoke } from "../helpers/http.mjs";

const { fulfillCharge } = await loadApi("api/_lib/sync.js");
const { resolveCheckoutShippingRates } = await loadApi("api/widget.js");
const { sanitizeStockPolicy, resolveStockPolicy, stockCheckNeeded, sanitizeShippingOff, offeredRates, rateKey, rateLabel, sanitizeShippingPrices, subRatePrice, subscriptionRates } = await loadApi("shared/platform/logistics.js");

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
test("(e) de fábrica NO se cobra lo que no se puede entregar", async () => {
  // 28-sept-2026, Thiago: "la idea es nunca cobrar para no entregar". Sin tocar
  // nada, una tienda sin stock deja de cobrar esa renovación.
  const merchant = luminaMerchant();
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId, "la orden de ESTE cobro igual se crea: la plata ya entró");
  assert.equal(out.stock.paused, true, "y se pausa para que no salga la próxima");
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "paused");
});

test("(e) el que prefiere cobrar igual lo elige y nada lo frena", async () => {
  const merchant = luminaMerchant({ stock_policy: { on_missing: "charge" } });
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan());
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const out = await cobrar(merchant);
  assert.ok(out.shopifyOrderId);
  assert.equal(out.stock, undefined, "ni consulta el inventario");
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "active");
  assert.equal(W.mp.preapprovalUpdates.length, 0);
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

// ── Precio del envío en la suscripción (29-sept-2026, Thiago) ──────────────
const CON_ENVIOS = { checkout_shipping_rates: [{ name: "A domicilio", price: 4500, code: "dom" }, { name: "A sucursal", price: 2800, code: "suc" }] };

test("(e) sin tocar nada, el que se suscribe paga lo mismo que en la tienda", () => {
  const r = resolveCheckoutShippingRates(luminaMerchant(CON_ENVIOS), 99999);
  assert.deepEqual(r.map(x => [x.name, x.price]), [["A domicilio", 4500], ["A sucursal", 2800]]);
  assert.ok(!r.some(x => "price_store" in x), "sin cambios no hay nada que tachar");
});

test("(e) 'todos gratis en la suscripción': el checkout cobra 0 y la tienda sigue cobrando lo suyo", () => {
  const m = luminaMerchant({ ...CON_ENVIOS, shipping_prices: { dom: { price: 0 }, suc: { price: 0 } } });
  const r = resolveCheckoutShippingRates(m, 0);
  assert.deepEqual(r.map(x => [x.name, x.price, x.price_store]), [["A domicilio", 0, 4500], ["A sucursal", 0, 2800]]);
  // La lista de la tienda no se toca: el precio del comercio sigue intacto.
  assert.equal(m.checkout_shipping_rates[0].price, 4500);
});

test("(e) otro precio y 'gratis desde': se cobra según el subtotal de ese cobro", () => {
  const m = luminaMerchant({ ...CON_ENVIOS, shipping_prices: { dom: { price: 1500, free_from: 40000 } } });
  assert.equal(subRatePrice(m.checkout_shipping_rates[0], m, 39999), 1500);
  assert.equal(subRatePrice(m.checkout_shipping_rates[0], m, 40000), 0, "llegó al corte");
  assert.equal(subRatePrice(m.checkout_shipping_rates[1], m, 0), 2800, "el que no tocó sigue igual");
});

test("(e) el precio propio también pisa lo que Shopify cotiza en vivo, y apagado + precio conviven", () => {
  const m = luminaMerchant({ shipping_off: ["a sucursal"], shipping_prices: { "a domicilio": { price: 0 } } });
  const live = [{ name: "A domicilio", price: 5200 }, { name: "A sucursal", price: 3100 }];
  assert.deepEqual(subscriptionRates(live, m, 0).map(x => [x.name, x.price]), [["A domicilio", 0]]);
});

test("(e) los precios de la suscripción se sanean y lo vacío no ocupa lugar", () => {
  assert.deepEqual(sanitizeShippingPrices({ dom: { price: "0" }, suc: { price: -5 }, x: {}, y: null }),
    { shipping_prices: { dom: { price: 0 } } }, "precio inválido o vacío = se cae al de la tienda");
  assert.deepEqual(sanitizeShippingPrices({ dom: { free_from: 30000 } }), { shipping_prices: { dom: { free_from: 30000 } } });
  assert.deepEqual(sanitizeShippingPrices({}), { shipping_prices: null });
  assert.ok(sanitizeShippingPrices([]).error, "tiene que ser un objeto");
});

test("(e) el cobro sale con el envío de la suscripción, no con el de la tienda", async () => {
  // Lo que se cobra lo decide el SERVIDOR: aunque el navegador mande otra cosa,
  // el precio sale de lo que el comercio puso en Envíos.
  const { default: init } = await loadApi("api/checkout/init.js");
  const { DEFAULT_CHECKOUT_SHIPPING_RATES } = await loadApi("api/widget.js");
  const prioritario = DEFAULT_CHECKOUT_SHIPPING_RATES[1];   // $5.900 en la tienda
  W = createWorld({ merchant: luminaMerchant({ shipping_prices: { [prioritario.name.toLowerCase()]: { price: 0 } } }) });
  const res = await invoke(init, { method: "POST", query: {}, body: {
    merchant_id: MID, plan_id: PLAN_ID, quantity: 1, frequency_days: 30, base_price: 12000, sub_discount: 10,
    customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
    shipping_address: { ...ADDRESS },
    shipping_method: { name: prioritario.name, code: "", price: 5900 },
  }, headers: { "x-forwarded-for": "190.1.2.3" } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(W.mp.plansCreated[0].body.auto_recurring.transaction_amount, 10800, "10.800 del producto + 0 de envío");
  assert.equal(W.sub(res.body.subscriber_id).plan_snapshot.shipping_price_ars, 0);
});

test("(e) la lista de apagados se sanea (sin repetidos ni basura)", () => {
  assert.deepEqual(sanitizeShippingOff(["suc", "suc", "  ", "dom"]), { shipping_off: ["suc", "dom"] });
  assert.deepEqual(sanitizeShippingOff([]), { shipping_off: null }, "vacía = todo como siempre");
  assert.ok(sanitizeShippingOff("suc").error, "tiene que ser una lista");
});

// ── 4. Lo que se guarda ─────────────────────────────────────────────────────
test("(e) la configuración de stock se sanea y el default no ocupa lugar", () => {
  assert.deepEqual(sanitizeStockPolicy({ source: "store", on_missing: "pause" }), { stock_policy: null }, "igual al default = nada guardado");
  assert.deepEqual(sanitizeStockPolicy({ on_missing: "charge" }), { stock_policy: { on_missing: "charge" } });
  assert.ok(sanitizeStockPolicy({ on_missing: "borrar_todo" }).error, "no se acepta cualquier cosa");
  assert.deepEqual(resolveStockPolicy({}), { source: "store", on_missing: "pause" }, "de fábrica: no cobrar");
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

test("(e) el CRON real mira a la tienda que nunca tocó la configuración (el default no se guarda)", async () => {
  // 9-oct-2026: el cron buscaba `stock_policy.on_missing == "pause"` y como el default no
  // se escribe, no vigilaba a nadie: Wellfresh y Lumina nunca tuvieron la pausa previa.
  process.env.CRON_SECRET = "cs_test";
  const merchant = luminaMerchant();           // sin stock_policy
  assert.equal(merchant.stock_policy, undefined);
  seedDoc(`merchants/${MID}`, merchant);
  const now = Date.now();
  seedDoc(`merchants/${MID}/subscribers/${SID}`, subConPlan({ next_charge_at: new Date(now + 2 * 3600e3).toISOString() }));
  // Otra tienda que eligió cobrar igual: ni se le leen las suscripciones.
  seedDoc("merchants/cobra_igual", luminaMerchant({ stock_policy: { on_missing: "charge" } }));
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const { default: cron } = await loadApi("api/cron.js");
  const r = await new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, setHeader() {}, json(o) { resolve({ status: this._s, body: o }); } };
    cron({ method: "GET", headers: { authorization: "Bearer cs_test" }, query: { action: "stock-watch" } }, res);
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.comercios, 1, "solo la tienda con el default (la que cobra igual se saltea)");
  assert.equal(r.body.pausadas, 1);
  assert.equal(rawGet(`merchants/${MID}/subscribers/${SID}`).status, "paused");
  assert.equal(W.mp.preapprovalUpdates.at(-1).body.status, "paused");
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

test("(e) el vigilante también corre de fábrica: ese es el punto", async () => {
  const sub = { id: SID, ...subConPlan({ next_charge_at: "2026-09-17T14:00:00.000Z" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 0;
  const r = await vigilar(luminaMerchant(), [sub]);
  assert.deepEqual(r, { revisadas: 1, pausadas: 1, reactivadas: 0 });
});

test("(e) al pausar por stock sale el mail obligatorio que avisa que HOY no se cobró", async () => {
  const sub = { id: SID, ...subConPlan({ next_charge_at: "2026-09-17T14:00:00.000Z" }) };
  seedDoc(`merchants/${MID}/subscribers/${SID}`, sub);
  W.shopify.stock[String(VARIANT_ID)] = 0;
  await vigilar(luminaMerchant(), [sub]);
  const mail = W.resend.toCustomer().at(-1);
  assert.ok(mail, "el cliente tiene que enterarse: le corrimos la fecha de un cobro");
  assert.match(mail.subject, /queda para más adelante/i);
  assert.match(mail.html, /hoy no te cobramos/i);
  assert.ok(!/action=unsub/.test(mail.html), "es transaccional: sin link de baja");
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
