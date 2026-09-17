// (h) Lecturas del cron sync-all-pending (cada 2 min).
//
// Por qué: traer TODAS las activas de cada tienda en cada corrida es lo que hace
// escalar la factura de Firestore (100 tiendas × 200 activas ≈ 14 M lecturas/día).
// activesForRun trae solo las que el loop puede llegar a tocar — y tiene que traer
// EXACTAMENTE las mismas que antes, o un cobro se queda sin procesar.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, MID } from "../helpers/world.mjs";
import { db } from "../helpers/mock-firebase.mjs";
import { stats, resetStats } from "../helpers/fake-firestore.mjs";

const { activesForRun } = await loadApi("api/cron.js");

const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();
const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const subsCol = () => db().collection("merchants").doc(MID).collection("subscribers");

let W;
beforeEach(() => { W = createWorld(); });

test("(h) trae la activa con el cobro vencido y la recién creada sin orden", async () => {
  W.seedSub("vencida", subscriber({ status: "active", next_charge_at: iso(NOW - 2 * H), created_at: iso(NOW - 40 * 24 * H) }));
  W.seedSub("sin_orden", subscriber({ status: "active", next_charge_at: iso(NOW + 20 * 24 * H), created_at: iso(NOW - 3 * H), shopify_orders: [] }));
  // Al día y vieja: el loop la descartaría igual, así que NO hace falta leerla.
  W.seedSub("al_dia", subscriber({ status: "active", next_charge_at: iso(NOW + 20 * 24 * H), created_at: iso(NOW - 40 * 24 * H), shopify_orders: ["4001"] }));

  const r = await activesForRun(subsCol(), NOW);
  const ids = r.docs.map(d => d.id).sort();

  assert.deepEqual(ids, ["sin_orden", "vencida"]);
});

test("(h) no duplica la que entra por las dos condiciones a la vez", async () => {
  W.seedSub("ambas", subscriber({ status: "active", next_charge_at: iso(NOW - 2 * H), created_at: iso(NOW - 3 * H) }));

  const r = await activesForRun(subsCol(), NOW);

  assert.deepEqual(r.docs.map(d => d.id), ["ambas"]);
});

test("(h) las activas viejas sin next_charge_at entran en la corrida horaria", async () => {
  W.seedSub("sin_fecha", subscriber({ status: "active", next_charge_at: null, created_at: iso(NOW - 40 * 24 * H), shopify_orders: ["4001"] }));

  const enMinuto30 = await activesForRun(subsCol(), Date.parse("2026-09-17T12:30:00.000Z"));
  assert.deepEqual(enMinuto30.docs.map(d => d.id), [], "en una corrida normal no se leen");

  const enMinuto00 = await activesForRun(subsCol(), Date.parse("2026-09-17T13:00:00.000Z"));
  assert.deepEqual(enMinuto00.docs.map(d => d.id), ["sin_fecha"], "una vez por hora sí");
});

test("(h) no toca subs de otros estados", async () => {
  W.seedSub("cancelada", subscriber({ status: "cancelled", next_charge_at: iso(NOW - 2 * H) }));
  W.seedSub("pendiente", subscriber({ status: "pending", created_at: iso(NOW - 3 * H) }));

  const r = await activesForRun(subsCol(), NOW);

  assert.deepEqual(r.docs.map(d => d.id), []);
});

test("(h) lee MUCHO menos que traer toda la colección", async () => {
  for (let i = 0; i < 60; i++) {
    W.seedSub(`vieja_${i}`, subscriber({ status: "active", next_charge_at: iso(NOW + 20 * 24 * H), created_at: iso(NOW - 40 * 24 * H), shopify_orders: ["4001"] }));
  }
  W.seedSub("vencida", subscriber({ status: "active", next_charge_at: iso(NOW - 2 * H), created_at: iso(NOW - 40 * 24 * H) }));

  resetStats();
  const r = await activesForRun(subsCol(), NOW);

  assert.deepEqual(r.docs.map(d => d.id), ["vencida"]);
  assert.ok(stats.docReads <= 5, `leyó ${stats.docReads} docs de 61 activas`);
});
