// (e) Envíos de apps externas (Envialo, Andreani…): el checkout recotiza contra
// Shopify y la orden sale con el `code` y el `source` del carrier, que son los
// que su app necesita para despachar (el code termina en el id de la sucursal).
// Antes mandábamos el nombre del método como `code` y sin `source`: la app no
// podía procesar la orden y las suscripciones quedaban sin despachar.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, VARIANT_ID, ADDRESS, SHOP, SHOP_TOKEN } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { decodeRateHandle, shQuoteShippingRates } = await loadApi("api/_lib/shopify.js");

let W;
beforeEach(() => { W = createWorld(); });
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

test("(e) code de carrier que ya no existe: cae al envío del plan, no inventa uno", async () => {
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
