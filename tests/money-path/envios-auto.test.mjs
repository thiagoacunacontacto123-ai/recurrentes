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
