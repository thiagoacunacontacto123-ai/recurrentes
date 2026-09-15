// (h) api/widget.js: el JS embebible que Lumina tiene pegado en su tema. Tiene
// que servir JavaScript válido que le pegue a la API correcta (APP_BASE_URL).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createWorld, loadApi, MID, APP, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget, DEFAULT_CHECKOUT_SHIPPING_RATES } = await loadApi("api/widget.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const compiles = (src) => { new vm.Script(src, { filename: "widget.js" }); return true; };

test("(h) widget del producto: JavaScript válido con el API base y el merchant correctos", async () => {
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /^application\/javascript/);
  assert.equal(res.headers["access-control-allow-origin"], "*");
  const js = res.body;
  assert.equal(typeof js, "string");
  assert.ok(js.includes(`var API_BASE = ${JSON.stringify(APP)};`), "API_BASE no es APP_BASE_URL");
  assert.ok(js.includes(`var MERCHANT_ID = ${JSON.stringify(MID)};`));
  assert.ok(js.includes('API_BASE + "/api/checkout/init"'), "el widget ya no postea a /api/checkout/init");
  assert.ok(js.includes('API_BASE + "/api/public?action=plan&merchant="'));
  assert.ok(compiles(js));
  assert.equal(W.router.calls.length, 0, "servir el widget no llama a ninguna API externa");
});

test("(h) checkout on-store (?view=checkout): JS válido, mismo API base y tarifas legacy de Lumina", async () => {
  const res = await invoke(widget, { method: "GET", query: { merchant: MID, view: "checkout" } });
  assert.equal(res.statusCode, 200);
  const js = res.body;
  assert.ok(js.includes(`var API_BASE = ${JSON.stringify(APP)};`));
  assert.ok(js.includes(`var SHIPPING_RATES = ${JSON.stringify(DEFAULT_CHECKOUT_SHIPPING_RATES)};`), "Lumina (legacy) tiene que seguir viendo sus 2 tarifas");
  assert.ok(compiles(js));
});

test("(h) el color y los textos del merchant viajan en el JS", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_color: "#ff5500", widget_sub_title: "Suscribite y ahorrá" }));
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(res.body.includes('var WIDGET_COLOR = "#ff5500";'));
  assert.ok(res.body.includes('var SUB_TITLE = "Suscribite y ahorrá";'));
});

test("(h) el API base sale de APP_BASE_URL (ej. el alias viejo recurrentess.vercel.app)", async (t) => {
  const prev = process.env.APP_BASE_URL;
  process.env.APP_BASE_URL = "https://recurrentess.vercel.app";
  t.after(() => { process.env.APP_BASE_URL = prev; });
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(res.body.includes('var API_BASE = "https://recurrentess.vercel.app";'));
});

test("(h) sin ?merchant: devuelve un console.error (no rompe la tienda)", async () => {
  const res = await invoke(widget, { method: "GET", query: {} });
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /^console\.error\(/);
  assert.ok(compiles(res.body));
});
