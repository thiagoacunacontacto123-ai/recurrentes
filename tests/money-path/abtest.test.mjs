// (q) Prueba A/B del widget (30-sept-2026, pedido de Wellfresh). Lo que protege:
//   · que la variante viaje del widget al checkout y quede guardada en la sub;
//   · que el sorteo NO pise un ?rec_modo= puesto a propósito;
//   · que no se declare ganadora con cuatro suscripciones.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";

const { sanitizeAbTest, resolveAbTest, abVariant, abResultado, AB_MINIMO } = await loadApi("shared/platform/abtest.js");
const { default: widget } = await loadApi("api/widget.js");
const { default: init } = await loadApi("api/checkout/init.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const PRUEBA = { on: true, cambio: "mode_default", valor: "once" };

test("(q) la prueba se sanea: sin `on` no hay prueba, y un cambio inventado se rechaza", () => {
  assert.deepEqual(sanitizeAbTest(null), { ab_test: null });
  assert.deepEqual(sanitizeAbTest({ on: false }), { ab_test: null }, "apagarla la borra");
  assert.ok(sanitizeAbTest({ on: true, cambio: "color", valor: "x" }).error);
  assert.ok(sanitizeAbTest({ on: true, cambio: "mode_default", valor: "verde" }).error);
  const ok = sanitizeAbTest(PRUEBA).ab_test;
  assert.equal(ok.valor, "once");
  assert.ok(ok.started_at, "queda la fecha: el resultado se cuenta desde ahí");
});

test("(q) el widget sortea 50/50 y se acuerda, pero NO pisa un ?rec_modo del link", async () => {
  W = createWorld({ merchant: luminaMerchant({ ab_test: PRUEBA }) });
  const js = (await invoke(widget, { method: "GET", query: { merchant: MID } })).body;
  assert.match(js, /rec_ab_/, "guarda la variante por tienda en el navegador");
  assert.match(js, /AB_VAR = Math\.random\(\) < 0\.5/, "la moneda es 50/50");
  assert.match(js, /if \(AB && !MODE_LINK\)/, "con ?rec_modo no se sortea: ese link ya pidió un modo");
  assert.match(js, /if \(AB_VAR\) q \+= "&ab=" \+ AB_VAR/, "la variante viaja al checkout");
});

test("(q) sin prueba corriendo el widget no sortea nada", async () => {
  const js = (await invoke(widget, { method: "GET", query: { merchant: MID } })).body;
  assert.match(js, /var AB = null/);
});

test("(q) la variante queda guardada en el suscriptor", async () => {
  const res = await invoke(init, { method: "POST", query: {}, body: {
    merchant_id: MID, plan_id: PLAN_ID, quantity: 1, frequency_days: 30, base_price: 12000, sub_discount: 10,
    customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
    shipping_address: { ...ADDRESS }, ab: "b",
  }, headers: { "x-forwarded-for": "190.1.2.3" } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(W.sub(res.body.subscriber_id).ab_variant, "b");
});

test("(q) lo que manda el navegador no se cree de más", () => {
  assert.equal(abVariant("B"), "b");
  assert.equal(abVariant("c"), null);
  assert.equal(abVariant("<script>"), null);
  assert.equal(abVariant(undefined), null);
});

test("(q) con pocas suscripciones NO se declara ganadora", () => {
  const poco = abResultado({ a: 5, b: 9 });
  assert.equal(poco.suficiente, false);
  assert.equal(poco.ganadora, null, "con 14 en total cualquier diferencia es ruido");
  const mucho = abResultado({ a: 20, b: 30 });
  assert.equal(mucho.suficiente, true);
  assert.equal(mucho.ganadora, "b");
  assert.equal(mucho.dif_pct, 50);
  assert.equal(AB_MINIMO, 40);
});

test("(q) resolveAbTest ignora una prueba a medio guardar", () => {
  assert.equal(resolveAbTest({}), null);
  assert.equal(resolveAbTest({ ab_test: { on: true, cambio: "mode_default" } }), null, "sin valor no corre");
  assert.equal(resolveAbTest({ ab_test: PRUEBA }).valor, "once");
});
