// (e) Los envíos de la tienda entran SOLOS (21-sept-2026, Thiago).
//
// Antes: importar los envíos era un botón en Configuración → Checkout. El que no
// lo apretaba (Glowtherm) quedaba sin tarifas y el checkout cobraba el
// `shipping_price_ars` que hubiera quedado en el plan — un precio que su tienda
// no cobra. Ahora se importan al conectar, y el cron los trae para las que ya
// estaban conectadas.
//
// Lo que NO puede pasar: pisarle las tarifas a un comerciante que las eligió a mano.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, SHOP, SHOP_TOKEN } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { autoImportShippingRates } = await loadApi("api/_lib/shippingImport.js");

let W;
beforeEach(() => { W = createWorld({ merchant: luminaMerchant() }); });
afterEach(() => { W.router.assertClean(); });

// shipping_zones.json tal como lo devuelve Shopify.
const stubZones = (zones) =>
  W.router.on("GET", /\.myshopify\.com$/, /\/shipping_zones\.json$/, () => ({
    status: 200, json: { shipping_zones: zones },
  }));

const ZONA_AR = {
  countries: [{ code: "AR", name: "Argentina", provinces: [] }],
  price_based_shipping_rates: [
    { id: 1, name: "Envío a domicilio", price: "2900.00" },
    { id: 2, name: "Retiro en local", price: "0.00" },
  ],
  weight_based_shipping_rates: [],
};

test("(e) al conectar, los envíos de la tienda quedan cargados solos", async () => {
  stubZones([ZONA_AR]);
  const m = luminaMerchant();
  delete m.checkout_shipping_rates;
  seedDoc(`merchants/${MID}`, m);

  const r = await autoImportShippingRates(MID, { ...m, shopify_shop: SHOP, shopify_token: SHOP_TOKEN });
  assert.equal(r.imported, 2, JSON.stringify(r));
  const guardado = rawGet(`merchants/${MID}`);
  assert.equal(guardado.checkout_shipping_rates.length, 2);
  // Gratis primero (así los ordena shGetShippingRates).
  assert.equal(guardado.checkout_shipping_rates[0].name, "Retiro en local");
  assert.equal(guardado.checkout_shipping_rates[0].price, 0);
  assert.equal(guardado.checkout_shipping_rates[1].price, 2900);
  assert.equal(guardado.checkout_shipping_rates_source, "shopify");
});

test("(e) NO le pisa las tarifas al que ya las eligió a mano", async () => {
  const mias = [{ name: "Mi moto", price: 1200 }];
  const m = luminaMerchant({ checkout_shipping_rates: mias });
  seedDoc(`merchants/${MID}`, m);

  const r = await autoImportShippingRates(MID, m);
  assert.equal(r.skipped, "ya tiene tarifas");
  assert.deepEqual(rawGet(`merchants/${MID}`).checkout_shipping_rates, mias, "las del comerciante quedan intactas");
  // Cero llamadas a Shopify: ni se molesta en preguntar.
  assert.equal(W.router.find({ path: /shipping_zones/ }).length, 0);
});

test("(e) tarifas dinámicas (app de envíos): no escribe nada y no es un error", async () => {
  stubZones([]);   // la tienda cotiza con carrier, no tiene tarifas fijas
  const m = luminaMerchant();
  delete m.checkout_shipping_rates;
  seedDoc(`merchants/${MID}`, m);

  const r = await autoImportShippingRates(MID, { ...m, shopify_shop: SHOP, shopify_token: SHOP_TOKEN });
  assert.equal(r.skipped, "tarifas dinámicas");
  assert.equal(rawGet(`merchants/${MID}`).checkout_shipping_rates, undefined, "no inventa tarifas");
});

test("(e) si Shopify se cae, la conexión NO se rompe", async () => {
  W.router.on("GET", /\.myshopify\.com$/, /\/shipping_zones\.json$/, () => ({ status: 500, json: { errors: "boom" } }));
  const m = luminaMerchant();
  delete m.checkout_shipping_rates;
  seedDoc(`merchants/${MID}`, m);

  const r = await autoImportShippingRates(MID, { ...m, shopify_shop: SHOP, shopify_token: SHOP_TOKEN });
  assert.ok(r.skipped, "devuelve skipped, no lanza: " + JSON.stringify(r));
  assert.equal(rawGet(`merchants/${MID}`).checkout_shipping_rates, undefined);
});

test("(e) sin tienda conectada no hace nada", async () => {
  const m = luminaMerchant();
  delete m.shopify_shop; delete m.shopify_token; delete m.checkout_shipping_rates;
  seedDoc(`merchants/${MID}`, m);
  const r = await autoImportShippingRates(MID, m);
  assert.equal(r.skipped, "sin tienda conectada");
});

test("(e) force:1 reimporta aunque ya tenga (para arreglar una tienda puntual)", async () => {
  stubZones([ZONA_AR]);
  const m = luminaMerchant({ checkout_shipping_rates: [{ name: "Viejo", price: 9999 }] });
  seedDoc(`merchants/${MID}`, m);

  const r = await autoImportShippingRates(MID, { ...m, shopify_shop: SHOP, shopify_token: SHOP_TOKEN }, { force: true });
  assert.equal(r.imported, 2);
  const nombres = rawGet(`merchants/${MID}`).checkout_shipping_rates.map(x => x.name);
  assert.ok(!nombres.includes("Viejo"), "con force sí se reemplazan");
});

// ─── Tiendanube: sus medios de envío, no un envío inventado ────────────────
// 21-sept-2026 (Thiago: "¿por qué con Tiendanube no se traen los envíos?").
// public.js mandaba shipping_from_store solo para Shopify, así que el checkout
// de una tienda TN ni preguntaba y caía al envío del plan.
const { tnShippingRates } = await loadApi("api/_lib/tiendanube.js");
const TN_STORE = "1234567";
const TN_TOKEN = "tn-token";

const stubCarriers = (carriers) =>
  W.router.on("GET", "api.tiendanube.com", /\/shipping_carriers$/, () => ({ status: 200, json: carriers }));

test("(e) Tiendanube: lee los medios de envío activos con su code", async () => {
  stubCarriers([
    { id: 1, name: "Correo Argentino", code: "correo-argentino", active: true,
      options: [{ name: "A domicilio", code: "ca-domicilio", price: 3500 }, { name: "A sucursal", code: "ca-sucursal", price: 2800 }] },
    { id: 2, name: "Retiro en local", code: "pickup", active: true, options: [] },
    { id: 3, name: "OCA (apagado)", code: "oca", active: false, options: [] },
  ]);
  const rates = await tnShippingRates(TN_STORE, TN_TOKEN);
  const nombres = rates.map(r => r.name);
  assert.ok(nombres.includes("A domicilio"), JSON.stringify(rates));
  assert.ok(nombres.includes("A sucursal"));
  assert.ok(nombres.includes("Retiro en local"));
  assert.ok(!nombres.some(n => n.includes("OCA")), "el carrier apagado no se ofrece");
  // Gratis primero, después por precio.
  assert.equal(rates[0].price, 0);
  assert.equal(rates.find(r => r.name === "A domicilio").code, "ca-domicilio");
  assert.equal(rates.find(r => r.name === "A domicilio").source, "tiendanube");
});

test("(e) Tiendanube: una opción apagada de un carrier prendido no se ofrece", async () => {
  // El filtro miraba solo el carrier: un Correo Argentino activo con "a sucursal"
  // desactivado le mostraba igual la sucursal al comprador. 22-sept-2026.
  stubCarriers([
    { id: 1, name: "Correo Argentino", code: "correo-argentino", active: true,
      options: [
        { name: "A domicilio", code: "ca-domicilio", price: 3500 },
        { name: "A sucursal", code: "ca-sucursal", price: 2800, active: false },
      ] },
  ]);
  const rates = await tnShippingRates(TN_STORE, TN_TOKEN);
  const nombres = rates.map(r => r.name);
  assert.ok(nombres.includes("A domicilio"), JSON.stringify(rates));
  assert.ok(!nombres.includes("A sucursal"), "la opción apagada no se ofrece");
});

test("(e) Tiendanube: lo que se cotiza por CP no sale en $0, sale marcado", async () => {
  // TN no cotiza por destino en esta API: Correo Argentino / sucursales vienen
  // SIN precio y antes salían como $0 = envío gratis regalado. Ahora van con
  // `unpriced` y el checkout los descarta. 22-sept-2026, Thiago.
  stubCarriers([
    { id: 1, name: "Correo Argentino", code: "correo", active: true,
      options: [{ name: "A sucursal", code: "ca-suc" }] },          // sin price
    { id: 2, name: "Retiro en local", code: "pickup", active: true,
      options: [{ name: "Retiro en local", code: "pickup", price: 0 }] },  // price 0 REAL
    { id: 3, name: "Moto", code: "moto", active: true,
      options: [{ name: "Moto CABA", code: "moto", price: 3500 }] },
  ]);
  const rates = await tnShippingRates(TN_STORE, TN_TOKEN);
  const byName = Object.fromEntries(rates.map(r => [r.name, r]));
  assert.equal(byName["A sucursal"].unpriced, true, "sin precio => marcada");
  assert.ok(!("unpriced" in byName["Retiro en local"]), "gratis de verdad NO se marca");
  assert.ok(!("unpriced" in byName["Moto CABA"]), "con precio propio NO se marca");
  assert.equal(byName["Moto CABA"].price, 3500);
});

test("(e) Tiendanube: si la API falla devuelve [] y no rompe el checkout", async () => {
  W.router.on("GET", "api.tiendanube.com", /\/shipping_carriers$/, () => ({ status: 403, json: { description: "sin scope" } }));
  assert.deepEqual(await tnShippingRates(TN_STORE, TN_TOKEN), []);
});

test("(e) Tiendanube: nombres traducidos ({es: ...}) se leen igual", async () => {
  stubCarriers([{ id: 1, name: { es: "Envío a domicilio" }, code: "dom", active: true, options: [] }]);
  const rates = await tnShippingRates(TN_STORE, TN_TOKEN);
  assert.equal(rates.length, 1);
  assert.equal(rates[0].name, "Envío a domicilio");
});

// ─── El permiso que hacía falta para cotizar ───────────────────────────────
// 21-sept-2026, caso Glowtherm: el checkout no mostraba NINGÚN envío. Su tienda
// no tiene tarifas fijas (solo una app de envíos), así que dependía de la
// cotización en vivo — y Shopify la rechazaba:
//   "Access denied for draftOrderCalculate field.
//    Required access: `write_draft_orders` access scope."
// El scope estaba sacado a mano con el comentario "no se usa en ningún lado",
// escrito antes de que existiera shQuoteShippingRates. Este test es para que no
// se vuelva a sacar.
const { SHOPIFY_REQUIRED_SCOPE_IDS, SHOPIFY_SCOPES_STRING, oauthScopes, missingShopifyScopes } =
  await loadApi("shared/platform/shopify.js");

test("(e) write_draft_orders es obligatorio: sin él Shopify no cotiza los envíos", () => {
  assert.ok(SHOPIFY_REQUIRED_SCOPE_IDS.includes("write_draft_orders"),
    "draftOrderCalculate lo exige; sin esto el comprador se queda sin envíos");
  assert.ok(SHOPIFY_SCOPES_STRING.includes("write_draft_orders"), "tiene que estar en lo que se pega en Shopify");
  assert.ok(oauthScopes().includes("write_draft_orders"), "y en lo que pide el OAuth");
});

test("(e) al que conectó con el scope viejo el panel le avisa", () => {
  // Exactamente los scopes que tenía Glowtherm el 21-sept.
  const viejos = "read_customers,write_customers,read_discounts,read_orders,write_orders,read_products,read_shipping";
  const faltan = missingShopifyScopes(viejos);
  assert.deepEqual(faltan, ["write_draft_orders"], "el panel tiene que pedirle reconectar");
  // Con el permiso puesto no molesta más.
  assert.deepEqual(missingShopifyScopes(viejos + ",write_draft_orders"), []);
});
