// "Activar en mi tienda": el beacon widget-seen con rendered/reason (api/public.js) y el
// link del producto + estado que lee el panel (api/_lib/widgetVerify.js).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, SHOP, PLAN_ID, PRODUCT_ID, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const pub = await loadApi("api/public.js");
const wv = await loadApi("api/_lib/widgetVerify.js");
const { default: widget } = await loadApi("api/widget.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const seen = (q) => invoke(pub.default, { method: "GET", query: { action: "widget-seen", merchant: MID, host: "lumina.test", ...q } });

test("widget.js: avisa visible 3 s (rendered=1) y los motivos por los que no se montó", async () => {
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  const js = res.body;
  assert.ok(js.includes('location.search.indexOf("rec_verify=1")'), "reconoce ?rec_verify=1 del panel");
  assert.ok(js.includes('"&rendered=" + (state === "ok" ? "1" : "0")'), "manda rendered=1/0");
  assert.ok(js.includes("visibleMs >= 3000"), "exige 3 s seguidos visible");
  for (const r of ['report("no_product")', 'report("no_form"', 'report("no_plan"', 'report("hidden"', 'report("removed"']) assert.ok(js.includes(r), `reporta ${r}`);
  assert.ok(js.includes('watchVisible(host, { product: productId, plan: plan.id, mode: "bundle" })') && js.includes('mode: "legacy"'), "mira el widget montado en packs y clásico");

  // Red de seguridad: nunca dejar el tema sin botón de compra.
  assert.ok(js.includes("function restoreTheme(reason)") && js.includes("function guarded(fn, where)"), "restoreTheme + guarded");
  for (const h of ['guarded(init, "init")', 'guarded(mountBundle, "packs")', 'guarded(mountLegacy, "clasico")', 'restoreTheme("hidden")', 'restoreTheme("removed")', 'restoreTheme("variante sin plan")', 'setSubMode = guarded(setSubMode, "modo")']) assert.ok(js.includes(h), `protegido: ${h}`);
  assert.ok(js.includes('querySelectorAll("[data-rec-prev-display]")') && js.includes('getElementById("rc-bundle-hide-style")'), "restaura display previo y saca el CSS que esconde el tema");
});

test("beacon rendered=1: guarda widget_verified_* (y sigue guardando widget_last_seen_*)", async () => {
  const r = await seen({ rendered: "1", v: "1", product: PRODUCT_ID, plan: PLAN_ID, path: "/products/capsulas", mode: "bundle", ms: "3000" });
  assert.equal(r.statusCode, 204);
  const m = W.merchant();
  assert.ok(m.widget_verified_at && m.widget_last_seen_at, "verified + seen");
  assert.equal(m.widget_verified_host, "lumina.test");
  assert.equal(m.widget_verified_product, PRODUCT_ID);
  assert.equal(m.widget_verified_path, "/products/capsulas");
  assert.equal(m.widget_verified_mode, "bundle");
  // Sin v=1 y a los pocos segundos: no reescribe (throttle 20 s).
  await seen({ rendered: "1", product: "999", path: "/products/otro" });
  assert.equal(W.merchant().widget_verified_product, PRODUCT_ID, "throttle: no pisa la verificación reciente");
  // Con v=1 (lo abrió el panel) sí.
  await seen({ rendered: "1", v: "1", product: "999", path: "/products/otro" });
  assert.equal(W.merchant().widget_verified_product, "999");
});

test("beacon rendered=0: guarda el motivo en widget_last_issue; motivos desconocidos se ignoran", async () => {
  await seen({ rendered: "0", reason: "no_form", v: "1", product: PRODUCT_ID, path: "/products/capsulas" });
  const m = W.merchant();
  assert.equal(m.widget_last_issue?.reason, "no_form");
  assert.equal(m.widget_last_issue?.product, PRODUCT_ID);
  assert.equal(m.widget_verified_at, undefined, "un problema no cuenta como verificado");
  await seen({ rendered: "0", reason: "<script>", v: "1" });
  assert.equal(W.merchant().widget_last_issue.reason, "no_form", "motivo inválido: no se guarda");
  await seen({ rendered: "0", reason: "hidden" });
  assert.equal(W.merchant().widget_last_issue.reason, "no_form", "throttle 60 s sin v=1");
  await seen({ rendered: "0", reason: "hidden", v: "1" });
  assert.equal(W.merchant().widget_last_issue.reason, "hidden");
});

test("widgetVerifyStatus: solo lo que pasó después de `since`", () => {
  const m = { widget_last_seen_at: "2026-09-18T10:00:05.000Z", widget_verified_at: "2026-09-18T10:00:08.000Z", widget_verified_host: "lumina.test", widget_last_issue: { at: "2026-09-18T09:00:00.000Z", reason: "no_form" } };
  const s = wv.widgetVerifyStatus(m, "2026-09-18T10:00:00.000Z");
  assert.equal(s.loaded, true);
  assert.equal(s.verified?.host, "lumina.test");
  assert.equal(s.issue, null, "el problema viejo no cuenta");
  const s2 = wv.widgetVerifyStatus(m, "2026-09-18T11:00:00.000Z");
  assert.equal(s2.loaded, false); assert.equal(s2.verified, null);
  assert.equal(s2.last_verified_at, "2026-09-18T10:00:08.000Z");
});

test("widgetVerifyUrl (Shopify): página del producto del plan con ?rec_verify=1", async () => {
  W.router.on("GET", SHOP, /\/products\/7001\.json$/, () => ({ json: { product: { handle: "capsulas-lumina", status: "active" } } }));
  const r = await wv.widgetVerifyUrl(MID, W.merchant(), PLAN_ID);
  assert.equal(r.url, `https://${SHOP}/products/capsulas-lumina?rec_verify=1`);
  assert.equal(r.channel, "shopify");
  assert.equal(r.plan_id, PLAN_ID);
  // Sin plan indicado: agarra el primer plan activo con producto.
  const r2 = await wv.widgetVerifyUrl(MID, W.merchant(), "");
  assert.equal(r2.plan_id, PLAN_ID);
  // Producto borrado en Shopify → error claro.
  W.router.on("GET", SHOP, /\/products\/555\.json$/, () => ({ status: 404, json: { errors: "Not Found" } }));
  seedDoc(`merchants/${MID}/plans/p2`, { active: true, shopify_product_id: "555", product_title: "Borrado" });
  const r3 = await wv.widgetVerifyUrl(MID, W.merchant(), "p2");
  assert.equal(r3.code, "no_product");
});

test("widgetVerifyUrl: sin plan de tienda o sin tienda → errores claros", async () => {
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, { active: true, item_source: "manual", product_title: "Cuota" });
  const r = await wv.widgetVerifyUrl(MID, W.merchant(), PLAN_ID);
  assert.equal(r.code, "no_plan");
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, { active: true, shopify_product_id: PRODUCT_ID });
  const r2 = await wv.widgetVerifyUrl(MID, luminaMerchant({ shopify_token: null, shopify_shop: null }), PLAN_ID);
  assert.equal(r2.code, "no_store");
});

test("widgetVerifyUrl (Tiendanube): canonical_url del producto", async () => {
  W.router.on("GET", "api.tiendanube.com", /\/products\/7001$/, () => ({ json: { id: 7001, handle: { es: "capsulas" }, canonical_url: "https://lumina.mitiendanube.com/productos/capsulas/" } }));
  const m = luminaMerchant({ shopify_token: null, shopify_shop: null, tiendanube_store_id: 4242, tiendanube_token: "tn_tok", tiendanube_store_url: "https://lumina.mitiendanube.com" });
  const r = await wv.widgetVerifyUrl(MID, m, PLAN_ID);
  assert.equal(r.url, "https://lumina.mitiendanube.com/productos/capsulas/?rec_verify=1");
  assert.equal(r.channel, "tiendanube");
  assert.ok(!W.router.find({ host: "api.tiendanube.com" })[0].url.includes("tn_tok"), "el token va en el header, no en la URL");
});
