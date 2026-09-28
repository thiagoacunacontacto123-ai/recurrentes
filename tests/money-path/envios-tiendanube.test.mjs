// (e) Tiendanube: el pedido tiene que salir con el TRANSPORTISTA de la tienda
// (28-sept-2026, caso Vidativa: Tiendanube + app de envíos Southpost).
//
// La app de envíos del comerciante no mira el nombre del método: mira el
// carrier y el código del servicio que quedan en el fulfillment order. Si no se
// los mandamos, el pedido le entra pago pero sin transportista y lo tiene que
// despachar a mano — que es justo lo que no podemos ofrecerle a un cliente.
//
// La cadena que estos tests protegen, eslabón por eslabón:
//   API de Tiendanube → tarifas del comercio → snapshot de la suscripción → orden.
// Si se corta en cualquiera de los cuatro, el carrier llega vacío y la orden
// sale a nombre de "recurrentes".
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet, seedDoc } from "../helpers/fake-firestore.mjs";

const { tnShippingRates } = await loadApi("api/_lib/tiendanube.js");
const { autoImportShippingRates, normalizeRate } = await loadApi("api/_lib/shippingImport.js");
const { default: init } = await loadApi("api/checkout/init.js");
const { default: merchantApi } = await loadApi("api/merchant.js");

const TN_STORE = "9100";
const TN_TOKEN = "tn-token";
let W;
beforeEach(() => { W = createWorld({ merchant: luminaMerchant() }); });
afterEach(() => { W.router.assertClean(); });

const stubCarriers = (carriers) =>
  W.router.on("GET", "api.tiendanube.com", /\/shipping_carriers$/, () => ({ status: 200, json: carriers }));

// Un carrier de app de envíos, como se lo ve en una tienda real.
const SOUTHPOST = [{
  id: 4321, name: "Southpost", code: "southpost", active: true,
  options: [{ name: "Envío a domicilio", code: "southpost_home", price: 4500, reference: "SP-DOM" }],
}];

// ── 1. La API ───────────────────────────────────────────────────────────────
test("(e) la tarifa trae el carrier de la tienda, no uno inventado por nosotros", async () => {
  stubCarriers(SOUTHPOST);
  const [r] = await tnShippingRates(TN_STORE, TN_TOKEN);
  assert.equal(r.name, "Envío a domicilio");
  assert.equal(r.carrier_id, "4321", "el id del transportista instalado en la tienda");
  assert.equal(r.code, "southpost_home");
  assert.equal(r.reference, "SP-DOM");
  // "any" es el único valor del enum que Tiendanube acepta con un carrier_id
  // propio; con "api" responde "Carrier not found".
  assert.equal(r.carrier_code, "any");
});

test("(e) un carrier sin id no inventa uno: mejor sin transportista que con uno falso", async () => {
  stubCarriers([{ name: "Envío propio", code: "propio", active: true, options: [{ name: "Envío propio", price: 0 }] }]);
  const [r] = await tnShippingRates(TN_STORE, TN_TOKEN);
  assert.ok(!("carrier_id" in r));
});

test("(e) retiro en sucursal se marca: la orden no puede salir como envío a domicilio", async () => {
  stubCarriers([{ id: 7, name: "Retiro", code: "pickup", types: "pickup", active: true, options: [{ name: "Retiro en local", code: "pickup", price: 0 }] }]);
  const [r] = await tnShippingRates(TN_STORE, TN_TOKEN);
  assert.equal(r.pickup, true);
});

// ── 2. El importador y el panel ─────────────────────────────────────────────
test("(e) al guardar las tarifas no se pierde el transportista", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ shopify_shop: null, shopify_token: null, tiendanube_store_id: TN_STORE, tiendanube_token: TN_TOKEN }));
  stubCarriers(SOUTHPOST);
  const r = await autoImportShippingRates(MID, { tiendanube_store_id: TN_STORE, tiendanube_token: TN_TOKEN });
  assert.equal(r.imported, 1, JSON.stringify(r));
  const guardada = rawGet(`merchants/${MID}`).checkout_shipping_rates[0];
  assert.equal(guardada.carrier_id, "4321", "sin esto la orden sale sin transportista");
  assert.equal(guardada.carrier_code, "any");
  assert.equal(guardada.reference, "SP-DOM");
});

test("(e) el panel tampoco lo pierde al guardar", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant());
  const res = await invoke(merchantApi, {
    method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` },
    body: { checkout_shipping_rates: [{ name: "Envío a domicilio", price: 4500, code: "southpost_home", carrier_id: "4321", carrier_code: "any", reference: "SP-DOM" }] },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(rawGet(`merchants/${MID}`).checkout_shipping_rates[0].carrier_id, "4321");
});

test("(e) una tarifa sin transportista no inventa campos (Shopify sigue igual)", () => {
  assert.deepEqual(normalizeRate({ name: "Estándar", code: "std" }, 0), { name: "Estándar", price: 0, code: "std" });
});

// ── 3. El snapshot de la suscripción ────────────────────────────────────────
// El cobro #7 se hace meses después: la orden se arma con lo que quedó guardado
// acá, no con lo que diga la tienda ese día.
test("(e) el transportista queda en la suscripción, para todos los cobros que vengan", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({
    checkout_shipping_rates: [{ name: "Envío a domicilio", price: 4500, code: "southpost_home", carrier_id: "4321", carrier_code: "any", reference: "SP-DOM" }],
  }));
  const res = await invoke(init, {
    method: "POST", query: {}, headers: { "x-forwarded-for": "190.1.2.3" },
    body: {
      merchant_id: MID, plan_id: PLAN_ID,
      customer: { email: "ana@cliente.test", name: "Ana Díaz", phone: "1144440000", tax_id: "20301234567" },
      shipping_address: { ...ADDRESS },
      shipping_method: { name: "Envío a domicilio", code: "southpost_home" },
    },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const snap = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`).plan_snapshot;
  assert.equal(snap.shipping_method_code, "southpost_home");
  assert.equal(snap.shipping_carrier_id, "4321");
  assert.equal(snap.shipping_carrier_code, "any");
  assert.equal(snap.shipping_method_reference, "SP-DOM");
  assert.equal(snap.shipping_price_ars, 4500, "el precio sale de la tarifa del comercio, no del body");
});

test("(e) tarifa sin transportista: el snapshot queda como siempre (nada nuevo para Shopify)", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({
    checkout_shipping_rates: [{ name: "Estándar", price: 0, code: "std" }],
  }));
  const res = await invoke(init, {
    method: "POST", query: {}, headers: { "x-forwarded-for": "190.1.2.3" },
    body: {
      merchant_id: MID, plan_id: PLAN_ID,
      customer: { email: "ana@cliente.test", name: "Ana Díaz", phone: "1144440000", tax_id: "20301234567" },
      shipping_address: { ...ADDRESS },
      shipping_method: { name: "Estándar", code: "std" },
    },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const snap = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`).plan_snapshot;
  assert.equal(snap.shipping_method_code, "std");
  for (const k of ["shipping_carrier_id", "shipping_carrier_code", "shipping_method_reference", "shipping_pickup_type"]) {
    assert.ok(!(k in snap), `${k} no tiene que aparecer si la tarifa no lo trae`);
  }
});

// ── 4. El panel de precios ──────────────────────────────────────────────────
// Tiendanube no cotiza por CP, así que el comercio pone el precio de cada
// método a mano. Lo que NO puede pasar: que al tocar un precio se pierda el
// transportista y el pedido quede sin despachar.
test("(e) cambiar el precio a mano no le borra el transportista a la tarifa", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({
    checkout_shipping_rates: [{ name: "Envío a domicilio", price: 4500, code: "southpost_home", carrier_id: "4321", carrier_code: "any", reference: "SP-DOM" }],
  }));
  // Lo mismo que manda el panel al guardar: la tarifa entera con el precio nuevo.
  const res = await invoke(merchantApi, {
    method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` },
    body: { checkout_shipping_rates: [{ name: "Envío a domicilio", price: 6200, code: "southpost_home", carrier_id: "4321", carrier_code: "any", reference: "SP-DOM" }] },
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const r = rawGet(`merchants/${MID}`).checkout_shipping_rates[0];
  assert.equal(r.price, 6200, "el precio nuevo");
  assert.equal(r.carrier_id, "4321", "y el transportista sigue ahí");
  assert.equal(r.reference, "SP-DOM");
});
