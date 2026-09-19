// (h2) Cron sync-all-pending en MODO GLOBAL (escala a cientos de tiendas).
//
// Por qué: el recorrido tienda por tienda hace ~5 consultas por tienda cada 2 min y
// con ~250 tiendas ya no entra en los 4 min de presupuesto. El modo global trae con
// una tanda de collectionGroup SOLO las suscripciones con algo que hacer, en todas
// las tiendas a la vez, y tiene que hacer EXACTAMENTE lo mismo que el recorrido:
// activar la pendiente que pagó, reactivar la pausa vencida y saltear archivadas.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, mpPayment, mpPreapproval, MID, MP_TOKEN } from "../helpers/world.mjs";
import { seedDoc, rawGet, stats, resetStats } from "../helpers/fake-firestore.mjs";
import { db } from "../helpers/mock-firebase.mjs";

process.env.CRON_SECRET = "cs_test";
const { default: cron, collectDueGlobal } = await loadApi("api/cron.js");

const H = 3600_000;
const ago = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const run = (action = "sync-all-pending") => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, setHeader() {}, json(o) { resolve({ status: this._s, body: o }); } };
  cron({ method: "GET", headers: { authorization: "Bearer cs_test" }, query: { action } }, res);
});
const cronLast = async () => (await db().collection("system").doc("cron_last").get()).data();

let W;
beforeEach(() => {
  delete process.env.CRON_GLOBAL;
  W = createWorld();
  // Pendiente que ya pagó en MP: el cron la tiene que activar.
  W.seedSub("sub_carla", subscriber({
    status: "pending", mp_preapproval_plan_id: "plan_adhoc_carla", mp_preapproval_id: null, mp_preapproval_status: null,
    next_charge_at: null, last_charge_at: null, shopify_orders: [],
    created_at: ago(10 * 60_000), updated_at: ago(10 * 60_000),
  }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_carla", planId: "plan_adhoc_carla" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000200, amount: 12300, preapprovalId: "pre_carla" }), MP_TOKEN);
  // Pausada desde el portal con fecha de vuelta ya vencida: la tiene que reactivar.
  W.seedSub("sub_pausa", subscriber({
    status: "paused", mp_preapproval_id: "pre_pausa", mp_preapproval_plan_id: "plan_adhoc_pausa", mp_preapproval_status: "paused",
    resume_at: ago(2 * H), created_at: ago(40 * 24 * H), updated_at: ago(20 * 24 * H),
  }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_pausa", planId: "plan_adhoc_pausa", status: "paused" }), MP_TOKEN);
  // Tienda ARCHIVADA con una activa vencida: nadie la toca.
  seedDoc("merchants/archivada", { email: "a@x.test", mp_access_token: "APP_USR-arch", archived_at: ago(5 * 24 * H) });
  seedDoc("merchants/archivada/subscribers/s_arch", subscriber({ status: "active", next_charge_at: ago(3 * H) }));
  // Tienda SIN Mercado Pago con una pendiente: tampoco.
  seedDoc("merchants/sin_mp", { email: "b@x.test" });
  seedDoc("merchants/sin_mp/subscribers/s_sinmp", subscriber({ status: "pending", mp_preapproval_id: null, mp_preapproval_plan_id: "plan_x", created_at: ago(10 * 60_000), updated_at: ago(10 * 60_000) }));
});
afterEach(() => { W.router.assertClean(); });

test("(h2) collectDueGlobal trae solo lo que tiene algo que hacer, de todas las tiendas", async () => {
  const due = await collectDueGlobal(Date.now(), 15);
  const ids = (docs) => docs.map(d => `${d.ref.parent.parent.id}/${d.id}`).sort();
  assert.deepEqual(ids(due.pendings), [`${MID}/sub_carla`, "sin_mp/s_sinmp"]);
  assert.deepEqual(ids(due.resumes), [`${MID}/sub_pausa`]);
  assert.deepEqual(ids(due.vencidas), ["archivada/s_arch"]);
  assert.deepEqual(due.cancelled, [], "canceladas solo cada 30 min");
  assert.deepEqual(due.orphans, [], "huérfanos solo en la corrida horaria");
});

test("(h2) modo global: activa la que pagó, reactiva la pausa vencida y saltea archivadas y sin MP", async () => {
  const r = await run();
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, "global");
  assert.equal((await cronLast()).mode, "global");

  const carla = W.sub("sub_carla");
  assert.equal(carla.status, "active");
  assert.equal(carla.mp_preapproval_id, "pre_carla");
  assert.equal(carla.shopify_orders.length, 1, "la orden de Shopify se creó igual que en el recorrido por tienda");

  const pausa = W.sub("sub_pausa");
  assert.equal(pausa.status, "active");
  assert.equal(pausa.resumed_by, "cron_retention");
  assert.equal(pausa.resume_at, undefined);
  assert.ok(W.mp.preapprovalUpdates.some(u => u.id === "pre_pausa" && u.body.status === "authorized"), "le pidió a MP volver a autorizar");

  assert.equal(rawGet("merchants/archivada/subscribers/s_arch").last_sync_at, undefined, "la archivada no se sincroniza");
  assert.equal(rawGet("merchants/sin_mp/subscribers/s_sinmp").status, "pending", "sin token de MP no hay nada que sincronizar");
  // Solo la tienda con trabajo real cuenta como procesada.
  assert.equal(r.body.merchants_processed, 1);
});

test("(h2) CRON_GLOBAL=0 vuelve al recorrido por tienda con el mismo resultado", async () => {
  process.env.CRON_GLOBAL = "0";
  const r = await run();
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, "per-merchant");
  assert.equal(W.sub("sub_carla").status, "active");
  assert.equal(W.sub("sub_pausa").status, "active");
  assert.equal(W.sub("sub_pausa").resumed_by, "cron_retention");
  assert.equal(rawGet("merchants/archivada/subscribers/s_arch").last_sync_at, undefined);
});

test("(h2) si falta un índice de collectionGroup, cae al recorrido por tienda sin fallar", async () => {
  const orig = db().collectionGroup;
  db().collectionGroup = () => { throw Object.assign(new Error("9 FAILED_PRECONDITION: The query requires a COLLECTION_GROUP_ASC index"), { code: 9 }); };
  try {
    const r = await run();
    assert.equal(r.body.ok, true);
    assert.equal(r.body.mode, "per-merchant");
    assert.equal(W.sub("sub_carla").status, "active");
  } finally { db().collectionGroup = orig; }
});

test("(h2) el costo no crece con las tiendas que no tienen nada que hacer", async () => {
  // 40 tiendas al día (activas con el cobro lejos): en modo global NO se leen sus docs.
  for (let i = 0; i < 40; i++) {
    seedDoc(`merchants/quieta_${i}`, { email: `q${i}@x.test`, mp_access_token: `APP_USR-q${i}` });
    seedDoc(`merchants/quieta_${i}/subscribers/s`, subscriber({ status: "active", next_charge_at: new Date(Date.now() + 20 * 24 * H).toISOString(), created_at: ago(40 * 24 * H) }));
  }
  resetStats();
  const r = await run();
  assert.equal(r.body.mode, "global");
  // La única consulta a `merchants` es la de tokens por vencer (filtrada, no la lista entera).
  const merchantQueries = stats.readLog.filter(x => x.op === "query" && x.path === "merchants").length;
  assert.ok(merchantQueries <= 1, `hizo ${merchantQueries} consultas a merchants`);
  const subQueries = stats.readLog.filter(x => x.op === "query" && /subscribers$/.test(x.path) && !x.path.startsWith("**")).length;
  assert.equal(subQueries, 0, `hizo ${subQueries} consultas por tienda a subscribers (tenían que ser 0)`);
  const quietas = stats.readLog.filter(x => String(x.path).startsWith("merchants/quieta_")).length;
  assert.equal(quietas, 0, `leyó ${quietas} docs de tiendas sin nada que hacer`);
});

// ─── run-flows en modo global ────────────────────────────────────────────────
const FLOW = { name: "Bienvenida", trigger: "activated", active: true, steps: [{ type: "email", subject: "Hola {{nombre}}", body: "Gracias por suscribirte a {{producto}}." }] };
const waitingRun = (email, subId) => ({
  flow_id: "f1", flow_name: FLOW.name, trigger: "activated", subscriber_id: subId, email, steps: FLOW.steps,
  step: 0, sent: 0, status: "waiting", next_at: ago(5 * 60_000), created_at: ago(6 * 60_000), updated_at: ago(6 * 60_000),
});
async function seedFlows() {
  await db().collection("merchants").doc(MID).set({ email_reply_to: "atencion@lumina.test", flows_active_triggers: ["activated"], flows_enabled: true }, { merge: true });
  seedDoc(`merchants/${MID}/flows/f1`, FLOW);
  W.seedSub("sub_ana", subscriber({ customer_email: "ana@cliente.test", status: "active" }));
  seedDoc(`merchants/${MID}/flow_runs/r1`, waitingRun("ana@cliente.test", "sub_ana"));
  // Corrida ya terminada: no tiene que volver a salir.
  seedDoc(`merchants/${MID}/flow_runs/r_done`, { ...waitingRun("otra@cliente.test", "sub_x"), status: "completed", next_at: null });
  // Tienda archivada con una corrida vencida: no se manda nada.
  seedDoc("merchants/archivada/flows/f1", FLOW);
  seedDoc("merchants/archivada/flows_enabled_marker", {});
  seedDoc("merchants/archivada/flow_runs/r_arch", waitingRun("arch@cliente.test", "s_arch"));
}

test("(h2) run-flows global: manda el mail de la corrida vencida y saltea la tienda archivada", async () => {
  await seedFlows();
  const r = await run("run-flows");
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, "global");
  assert.equal(r.body.processed, 1, "solo la corrida vencida de la tienda viva");
  assert.equal(r.body.sent, 1);
  assert.equal(rawGet(`merchants/${MID}/flow_runs/r1`).status, "completed");
  assert.equal(rawGet(`merchants/${MID}/flow_runs/r_done`).status, "completed");
  assert.equal(rawGet("merchants/archivada/flow_runs/r_arch").status, "waiting", "la archivada queda como estaba");
  const mails = W.resend.sent.filter(m => (m.to || []).includes("ana@cliente.test"));
  assert.equal(mails.length, 1);
  assert.equal(mails[0].subject, "Hola Ana");
});

test("(h2) run-flows con CRON_GLOBAL=0: mismo resultado por el recorrido de siempre", async () => {
  await seedFlows();
  process.env.CRON_GLOBAL = "0";
  const r = await run("run-flows");
  assert.equal(r.body.mode, "per-merchant");
  assert.equal(r.body.sent, 1);
  assert.equal(rawGet(`merchants/${MID}/flow_runs/r1`).status, "completed");
});

// ─── retry-fulfillment en modo global ────────────────────────────────────────
const failedCharge = (sid) => ({
  subscriber_id: sid, mp_payment_id: "9001", amount_ars: 12300, status: "approved",
  shopify_order_id: null, shopify_order_status_url: null, error: "Shopify POST /orders.json: variant no longer exists", created_at: ago(20 * 60_000),
});

test("(h2) retry-fulfillment global: abre el issue del cobro sin orden y saltea la archivada", async () => {
  delete process.env.FULFILL_RETRY_ENABLED;
  seedDoc(`merchants/${MID}/charges/9001`, failedCharge("sub_pausa"));
  seedDoc("merchants/archivada/charges/9001", failedCharge("s_arch"));
  const r = await run("retry-fulfillment");
  assert.equal(r.body.ok, true);
  assert.equal(r.body.mode, "global");
  assert.equal(r.body.merchants, 1);
  assert.equal(r.body.failed_charges, 1);
  const issue = rawGet(`merchants/${MID}/fulfill_issues/9001`);
  assert.equal(issue?.status, "open");
  assert.equal(rawGet("merchants/archivada/fulfill_issues/9001"), undefined);
  assert.equal(r.body.alerts, 0, "recién detectado: todavía no avisa");
});

test("(h2) retry-fulfillment con CRON_GLOBAL=0 abre el mismo issue", async () => {
  delete process.env.FULFILL_RETRY_ENABLED;
  process.env.CRON_GLOBAL = "0";
  seedDoc(`merchants/${MID}/charges/9001`, failedCharge("sub_pausa"));
  const r = await run("retry-fulfillment");
  assert.equal(r.body.mode, "per-merchant");
  assert.equal(rawGet(`merchants/${MID}/fulfill_issues/9001`)?.status, "open");
});
