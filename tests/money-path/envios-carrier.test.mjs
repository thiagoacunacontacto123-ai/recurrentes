// (e) Envíos de apps externas (Envialo, Andreani…): el checkout recotiza contra
// Shopify y la orden sale con el `code` y el `source` del carrier, que son los
// que su app necesita para despachar (el code termina en el id de la sucursal).
// Antes mandábamos el nombre del método como `code` y sin `source`: la app no
// podía procesar la orden y las suscripciones quedaban sin despachar.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID, VARIANT_ID, ADDRESS, SHOP, SHOP_TOKEN } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { decodeRateHandle, shQuoteShippingRates } = await loadApi("api/_lib/shopify.js");

let W;
// `shipping_live_quotes` prendido: es lo que hace un comerciante que ya probó su
// app de envíos. Apagado (el default) hay un test aparte más abajo.
beforeEach(() => { W = createWorld({ merchant: luminaMerchant({ shipping_live_quotes: true }) }); });
afterEach(() => { W.router.assertClean(); });

// Igual que lo que devuelve Shopify de verdad: el handle es un JWT cuyo payload
// trae title/code/source/price (verificado contra la tienda de Lumina).
const handleFor = (payload) =>
  "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".firma";

const SUCURSAL = {
  title: "Andreani Punto de Retiro — PUNTO ANDREANI HOP RIOBAMBA 1081",
  code: "envialo:andreani:andreani_pickup:ship:12413",
  source: "Envialo", price: "0.0", currency: "ARS",
};
const DOMICILIO = {
  title: 'Andreani Estándar "Envío a domicilio"',
  code: "envialo:andreani:andreani_home:ship:10012",
  source: "Envialo", price: "2900.0", currency: "ARS",
};

const stubQuote = (rates = [SUCURSAL, DOMICILIO]) =>
  W.router.on("POST", /\.myshopify\.com$/, /\/graphql\.json$/, () => ({
    status: 200,
    json: {
      data: {
        draftOrderCalculate: {
          calculatedDraftOrder: {
            availableShippingRates: rates.map(p => ({
              handle: handleFor(p), title: p.title,
              price: { amount: p.price, currencyCode: p.currency },
            })),
          },
          userErrors: [],
        },
      },
    },
  }));

const post = (over = {}) => invoke(init, {
  method: "POST", query: {}, headers: { "x-forwarded-for": "190.1.2.3" },
  body: {
    merchant_id: MID, plan_id: PLAN_ID,
    customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
    shipping_address: { ...ADDRESS },
    ...over,
  },
});

test("decodeRateHandle saca code y source del handle de Shopify", () => {
  const d = decodeRateHandle(handleFor(SUCURSAL));
  assert.equal(d.code, "envialo:andreani:andreani_pickup:ship:12413");
  assert.equal(d.source, "Envialo");
  assert.equal(d.price, 0);
  assert.ok(d.title.includes("RIOBAMBA"));
  assert.equal(decodeRateHandle("basura"), null);
});

test("el cotizador devuelve las opciones del carrier con su código", async () => {
  stubQuote();
  const rates = await shQuoteShippingRates(SHOP, SHOP_TOKEN, {
    variantId: VARIANT_ID, quantity: 1, address: { zip: "1043", city: "CABA", province: "Buenos Aires" },
  });
  assert.equal(rates.length, 2);
  assert.equal(rates[0].code, SUCURSAL.code);
  assert.equal(rates[0].source, "Envialo");
  assert.equal(rates[1].price, 2900);
});

test("sin variante no cotiza (cero llamadas a Shopify)", async () => {
  const rates = await shQuoteShippingRates(SHOP, SHOP_TOKEN, { address: { zip: "1043" } });
  assert.deepEqual(rates, []);
  assert.equal(W.router.find({ path: /graphql/ }).length, 0);
});

test("(e) el checkout recotiza la sucursal elegida y guarda code + source en el snapshot", async () => {
  stubQuote();
  const res = await post({ shipping_method: { name: SUCURSAL.title, code: SUCURSAL.code, price: 99999 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shipping_method_code, SUCURSAL.code, "el code del carrier tiene que viajar entero");
  assert.equal(sub.plan_snapshot.shipping_method_source, "Envialo");
  assert.equal(sub.plan_snapshot.shipping_method_name, SUCURSAL.title);
  // El precio sale de la cotización, NUNCA del body (mandamos 99999 a propósito).
  assert.equal(sub.plan_snapshot.shipping_price_ars, 0);
});

test("(e) precio adulterado en una opción paga: manda el de Shopify", async () => {
  stubQuote();
  const res = await post({ shipping_method: { name: DOMICILIO.title, code: DOMICILIO.code, price: 1 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shipping_price_ars, 2900);
  assert.equal(sub.plan_snapshot.shipping_method_code, DOMICILIO.code);
});

test("(e) code de carrier que ya no existe: no inventa un método ni un precio", async () => {
  stubQuote([DOMICILIO]);   // la sucursal elegida ya no está entre las opciones
  const res = await post({ shipping_method: { name: SUCURSAL.title, code: SUCURSAL.code, price: 0 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shipping_method_code, "");
  assert.equal(sub.plan_snapshot.shipping_method_source, "");
});

// ─── La orden: lo que realmente ve la app de envíos ─────────────────────────
const { shCreatePaidOrder } = await loadApi("api/_lib/shopify.js");

const crearOrden = (over = {}) => shCreatePaidOrder(SHOP, SHOP_TOKEN, {
  line_items: [{ variant_id: VARIANT_ID, quantity: 1, price: "10000.00" }],
  shipping_address: { ...ADDRESS, first_name: "Dani", last_name: "Gómez" },
  subscriber_id: "S1", plan_id: PLAN_ID, charge_number: 1, mp_payment_id: "PAY1",
  total_price: 12900, shipping_price: 2900,
  shipping_method_name: DOMICILIO.title,
  shipping_method_code: DOMICILIO.code,
  shipping_method_source: "Envialo",
  ...over,
});

test("la orden lleva code y source del carrier (no el título repetido)", async () => {
  const o = await crearOrden();
  assert.ok(o?.id);
  const enviada = W.shopify.orderPosts.at(-1).order.shipping_lines[0];
  assert.equal(enviada.code, DOMICILIO.code, "el code es el del carrier, con el id del servicio");
  assert.equal(enviada.source, "Envialo");
  assert.equal(enviada.title, DOMICILIO.title);
  assert.equal(enviada.price, "2900.00");
});

test("si Shopify rechaza `source`, la orden se crea igual conservando el code", async () => {
  W.router.failNext("POST", /\.myshopify\.com$/, /\/orders\.json$/,
    { status: 422, json: { errors: { "shipping_lines.source": ["is not valid"] } } });
  const o = await crearOrden({ mp_payment_id: "PAY2" });
  assert.ok(o?.id, "el cobro ya se hizo: la orden tiene que existir igual");
  const enviada = W.shopify.orderPosts.at(-1).order.shipping_lines[0];
  assert.equal(enviada.source, undefined, "se reintenta sin source");
  assert.equal(enviada.code, DOMICILIO.code, "pero el code se conserva: es lo que identifica sucursal y servicio");
});

test("sin carrier (tarifa manual del comerciante) no se manda source", async () => {
  const o = await crearOrden({ mp_payment_id: "PAY3", shipping_method_source: "", shipping_method_code: "ANDREANI-PRIO" });
  assert.ok(o?.id);
  const enviada = W.shopify.orderPosts.at(-1).order.shipping_lines[0];
  assert.equal(enviada.source, undefined);
  assert.equal(enviada.code, "ANDREANI-PRIO");
});

// ─── Envíos de la tienda, siempre (21-sept-2026, Thiago) ───────────────────
// Caso Glowtherm: tienda conectada, con su app de envíos andando, pero el plan
// tenía cargado un `shipping_price_ars` viejo de cuando se creó. Ese número le
// ganaba a la tarifa real y el comprador terminaba pagando un envío que la
// tienda no cobra, con un método que la app de envíos no sabe despachar.
// Ahora: con tienda conectada el envío SALE DE LA TIENDA o no se cobra.
test("(e) GLOWTHERM: con tienda conectada, el envío viejo del plan NO se cobra", async () => {
  stubQuote([DOMICILIO]);
  // El comprador manda una tarifa que ya no existe → no matchea ninguna real.
  const res = await post({ shipping_method: { name: "Correo viejo", code: "no-existe:123", price: 5000 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  // El plan de prueba tiene shipping_price_ars: 1500. No se cobra.
  assert.equal(sub.plan_snapshot.shipping_price_ars, 0, "no se cobra la tarifa fantasma del plan");
  assert.equal(sub.plan_snapshot.shipping_method_code, "");
  assert.equal(sub.plan_snapshot.shipping_method_source, "");
});

test("(e) la tarifa real de la tienda sí se cobra, con su code", async () => {
  stubQuote([DOMICILIO]);
  const res = await post({ shipping_method: { name: DOMICILIO.title, code: DOMICILIO.code, price: 2900 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shipping_price_ars, 2900, "la de la tienda se cobra entera");
  assert.equal(sub.plan_snapshot.shipping_method_code, DOMICILIO.code);
});

// Sin tienda (ítem manual / venta por link) NO hay de dónde sacar el envío:
// ahí el del plan es lo único que existe y se tiene que seguir cobrando.
test("(e) sin tienda conectada, el envío del plan sigue siendo el que manda", async () => {
  const { seedDoc } = await import("../helpers/fake-firestore.mjs");
  const m = luminaMerchant();
  delete m.shopify_shop; delete m.shopify_token; delete m.tiendanube_store_id;
  seedDoc(`merchants/${MID}`, m);
  const res = await post({ shipping_method: { name: "Envío a domicilio", price: 1500 } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shipping_price_ars, 1500, "sin tienda, el envío del plan es lo único que hay");
});

// ─── Lo que cotiza la tienda es LO QUE VE EL COMPRADOR ────────────────────
// 22-sept-2026, Thiago: "si yo sacaba la sucursal en Shopify, o le ponía a mi
// empresa de envíos que muestre menos sucursales, salían todas igual en
// Recurrentes". Pasaba porque a la cotización en vivo le sumábamos encima las
// zonas manuales de shipping_zones.json. Si la cotización anduvo, mandamos eso
// solo: ni una opción más que las de su checkout.
const { default: shopifyApi } = await loadApi("api/shopify.js");

const getRates = (query = {}) => invoke(shopifyApi, {
  method: "GET",
  query: { action: "shipping-rates", merchant: MID, variant: VARIANT_ID, qty: "1", zip: "1043", city: "CABA", province: "Buenos Aires", ...query },
  headers: { "x-forwarded-for": "190.1.2.9" },
});

test("(e) si la cotización en vivo anduvo, NO se suman las zonas manuales", async () => {
  stubQuote([DOMICILIO]);            // el comerciante dejó UNA sola opción
  W.router.on("GET", /\.myshopify\.com$/, /\/shipping_zones\.json$/, () => ({
    status: 200,
    json: { shipping_zones: [{ countries: [{ code: "AR", name: "Argentina", provinces: [] }],
      price_based_shipping_rates: [{ name: "Sucursal vieja", price: "0.00" }] }] },
  }));
  const res = await getRates();
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const nombres = res.body.rates.map(r => r.name);
  assert.equal(res.body.rates.length, 1, JSON.stringify(nombres));
  assert.ok(!nombres.some(n => /sucursal vieja/i.test(n)), "no se cuela una opción que él ya sacó");
  assert.equal(W.router.find({ path: /shipping_zones/ }).length, 0, "ni siquiera se piden las zonas");
});

test("(e) sin cotización (sin CP), siguen las zonas manuales como respaldo", async () => {
  W.router.on("GET", /\.myshopify\.com$/, /\/shipping_zones\.json$/, () => ({
    status: 200,
    json: { shipping_zones: [{ countries: [{ code: "AR", name: "Argentina", provinces: [] }],
      price_based_shipping_rates: [{ name: "Envío estándar", price: "2500.00" }] }] },
  }));
  const res = await getRates({ zip: "", city: "" });   // sin destino no hay cotización
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.rates.map(r => r.name), ["Envío estándar"]);
});
