// (i) Cache del Inicio (GET /api/stats sin action).
//
// Por qué: cada apertura del panel leía TODAS las suscripciones de la tienda.
// Con 500 subs son ~10.000 lecturas de Firestore por día por tienda solo en
// mirar los números. Ahora el resultado se guarda 3 minutos en el doc del
// merchant y se invalida cuando una sub cambia de estado.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, mpPayment, mpPreapproval, MID, MP_TOKEN } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { stats, resetStats, rawGet } from "../helpers/fake-firestore.mjs";

const { default: statsHandler } = await loadApi("api/stats.js");
const { syncSubscriber } = await loadApi("api/_lib/sync.js");
const auth = { authorization: `Bearer test:${MID}` };
const inicio = (query = {}) => invoke(statsHandler, { method: "GET", query, headers: auth });

let W;
beforeEach(() => {
  W = createWorld();
  for (let i = 0; i < 40; i++) W.seedSub(`s_${i}`, subscriber({ status: "active", customer_email: `c${i}@t.test` }));
});
afterEach(() => { W.router.assertClean(); });

test("(i) la primera vez calcula y lee todas las subs; la segunda sale del cache con 1 lectura", async () => {
  resetStats();
  const a = await inicio();
  assert.equal(a.statusCode, 200);
  assert.equal(a.body.cached, false);
  assert.equal(a.body.totals.active, 40);
  const primera = stats.docReads;
  assert.ok(primera >= 40, `la primera lee las 40 subs (leyó ${primera})`);

  resetStats();
  const b = await inicio();
  assert.equal(b.body.cached, true);
  assert.equal(b.body.totals.active, 40, "mismos numeros");
  assert.ok(stats.docReads <= 2, `la segunda lee solo el doc del merchant (leyó ${stats.docReads})`);
});

test("(i) ?fresh=1 saltea el cache y recalcula", async () => {
  await inicio();
  W.seedSub("s_nueva", subscriber({ status: "active", customer_email: "nueva@t.test" }));
  const cacheada = await inicio();
  assert.equal(cacheada.body.totals.active, 40, "sin fresh sigue el cache viejo");
  const fresca = await inicio({ fresh: "1" });
  assert.equal(fresca.body.cached, false);
  assert.equal(fresca.body.totals.active, 41);
});

test("(i) otro periodo es otra clave: no mezcla los numeros de 7 dias con los de 30", async () => {
  const d30 = await inicio({ days: "30" });
  const d7 = await inicio({ days: "7" });
  assert.equal(d30.body.cached, false);
  assert.equal(d7.body.cached, false, "periodo distinto → recalcula");
  const c = rawGet(`merchants/${MID}`).home_cache;
  assert.equal(c.key, "d:7", "queda guardado el ultimo");
});

test("(i) cuando una sub cambia de estado el cache cae solo (los numeros del Inicio no quedan viejos)", async () => {
  await inicio();
  assert.ok(rawGet(`merchants/${MID}`).home_cache, "hay cache");

  // Una sub pendiente que MP acaba de cobrar: sync la activa → refreshPlanLimit.
  W.seedSub("sub_carla", subscriber({ status: "pending", mp_preapproval_plan_id: "plan_adhoc_carla", mp_preapproval_id: null, last_charge_at: null, shopify_orders: [] }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_carla", planId: "plan_adhoc_carla" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310009001, amount: 12300, preapprovalId: "pre_carla" }), MP_TOKEN);
  const r = await syncSubscriber(MID, "sub_carla");
  assert.equal(r.status, "active");

  assert.equal(rawGet(`merchants/${MID}`).home_cache, undefined, "el cache se borro");
  const d = await inicio();
  assert.equal(d.body.cached, false);
  assert.equal(d.body.totals.active, 41, "y el Inicio ya muestra la nueva");
});
