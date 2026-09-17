// (n) Próximos cobros a un año (api/charges.js ?view=upcoming&days=370): el
// calendario necesita proyectar más allá del próximo cobro, porque MP solo
// confirma ese. Se repite cada frequency_days del plan y se marca projected.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, snapshot, MID } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";

const { default: charges } = await loadApi("api/charges.js");

const auth = { authorization: `Bearer test:${MID}` };
const get = (query = {}) => invoke(charges, { method: "GET", query, headers: auth });
const enDias = (n) => new Date(Date.now() + n * 86400000).toISOString();

let W;
beforeEach(() => { W = createWorld(); });

test("(n) 30 días: un solo cobro por sub y ninguno proyectado", async () => {
  W.seedSub("sub_ana", subscriber({ next_charge_at: enDias(5) }));
  const res = await get({ view: "upcoming" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.upcoming.length, 1);
  assert.equal(res.body.projected, false);
  assert.equal(res.body.upcoming[0].projected, false);
});

test("(n) un año: repite cada frequency_days y solo el primero es confirmado", async () => {
  W.seedSub("sub_ana", subscriber({ next_charge_at: enDias(3) }));
  const res = await get({ view: "upcoming", days: 370 });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.projected, true);
  const u = res.body.upcoming;
  // 3 + 30k ≤ 370 → k = 0..12 → 13 cobros de un plan de 30 días.
  assert.equal(u.length, 13, "proyecta el año completo con la frecuencia del plan");
  assert.equal(u[0].projected, false, "el próximo cobro es el que confirma MP");
  assert.ok(u.slice(1).every(x => x.projected === true), "el resto queda marcado como estimado");
  // Separación real de 30 días entre uno y el siguiente.
  const salto = Date.parse(u[1].next_charge_at) - Date.parse(u[0].next_charge_at);
  assert.equal(salto, 30 * 86400000);
  // El monto se repite: es lo que entra cada vez.
  assert.ok(u.every(x => x.amount_ars === u[0].amount_ars && x.amount_ars > 0));
  assert.equal(res.body.amount_ars, u[0].amount_ars * 13);
});

test("(n) la frecuencia del plan manda: una sub semanal llega al tope de 40", async () => {
  W.seedSub("sub_sem", subscriber({ next_charge_at: enDias(2), plan_snapshot: { ...snapshot({ qty: 1 }), frequency_days: 7 } }));
  const res = await get({ view: "upcoming", days: 370 });
  assert.equal(res.body.upcoming.length, 40, "acota la respuesta sin dejar el calendario vacío");
  assert.equal(Date.parse(res.body.upcoming[1].next_charge_at) - Date.parse(res.body.upcoming[0].next_charge_at), 7 * 86400000);
});

test("(n) solo suscripciones activas: pausadas y canceladas no proyectan", async () => {
  W.seedSub("sub_ok", subscriber({ next_charge_at: enDias(4) }));
  W.seedSub("sub_pause", subscriber({ next_charge_at: enDias(4), status: "paused" }));
  W.seedSub("sub_baja", subscriber({ next_charge_at: enDias(4), status: "cancelled" }));
  const res = await get({ view: "upcoming", days: 370 });
  assert.ok(res.body.upcoming.length > 0);
  assert.ok(res.body.upcoming.every(u => u.subscriber_id === "sub_ok"), "ninguna sub inactiva aparece en el calendario");
});

test("(n) una vencida de hace días no ensucia el año proyectado", async () => {
  W.seedSub("sub_vieja", subscriber({ next_charge_at: enDias(-9) }));
  const res = await get({ view: "upcoming", days: 370 });
  assert.equal(res.body.upcoming.length, 0, "la persigue el cron, no el calendario");
});

test("(n) days se topea en 400 y ordena por fecha", async () => {
  W.seedSub("sub_a", subscriber({ next_charge_at: enDias(20) }));
  W.seedSub("sub_b", subscriber({ next_charge_at: enDias(2) }));
  const res = await get({ view: "upcoming", days: 9999 });
  assert.equal(res.body.days, 400);
  const fechas = res.body.upcoming.map(u => u.next_charge_at);
  assert.deepEqual(fechas, [...fechas].sort(), "el calendario los recibe en orden");
});
