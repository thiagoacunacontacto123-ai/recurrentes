// (g) Motor de flujos: el enganche en el camino del cobro NO puede costar nada
// para una tienda sin flujos (Lumina): cero lecturas de Firestore, cero red.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, mpPayment, mpPreapproval, mpWebhookReq, luminaMerchant, MID, MP_TOKEN } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { stats, resetStats, seedDoc, rawList } from "../helpers/fake-firestore.mjs";

const { emitFlowEvent } = await loadApi("api/_lib/flows.js");
const { FLOW_TRIGGERS, defaultFlow } = await loadApi("shared/platform/flows.js");
const { default: webhook } = await loadApi("api/mp/webhook.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const SUB = { customer_email: "ana@cliente.test", customer_name: "Ana", status: "active", plan_snapshot: { product_title: "Cápsulas" } };
const touchesFlows = () => stats.readLog.filter(r => /\/(flows|flow_runs)$/.test(r.path) || /\/(flows|flow_runs)\//.test(r.path));

test("(g) sin merchant.flows_active_triggers: emitFlowEvent hace CERO lecturas y CERO escrituras para todos los disparadores", async () => {
  const m = W.merchant();
  assert.equal("flows_active_triggers" in m, false);
  resetStats();
  for (const t of FLOW_TRIGGERS) await emitFlowEvent(MID, m, t.id, "sub_ana", SUB, { key: "k1" });
  assert.equal(stats.readOps, 0);
  assert.equal(stats.writeOps, 0);
  assert.equal(W.router.calls.length, 0);
});

test("(g) con otros disparadores activos pero no este: tampoco lee nada", async () => {
  const m = { ...W.merchant(), flows_active_triggers: ["payment_failed"], flows_enabled: true };
  resetStats();
  await emitFlowEvent(MID, m, "activated", "sub_ana", SUB, { key: "k1" });
  await emitFlowEvent(MID, m, "renewed", "sub_ana", SUB, { key: "k2" });
  assert.equal(stats.readOps, 0);
});

test("(g) control positivo: con el disparador activo SÍ entra al flujo (el contador de lecturas funciona)", async () => {
  seedDoc(`merchants/${MID}/flows/f_act`, { ...defaultFlow("activated"), active: true });
  const m = { ...W.merchant(), flows_active_triggers: ["activated"], flows_enabled: true };
  resetStats();
  await emitFlowEvent(MID, m, "activated", "sub_ana", SUB, { key: "pay1" });
  assert.ok(stats.readOps > 0);
  const runs = rawList(`merchants/${MID}/flow_runs`);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].data.trigger, "activated");
});

test("(g) webhook completo (activación + renovación + rechazo) de Lumina: nunca lee flows ni flow_runs", async () => {
  W.seedSub("sub_bruno", subscriber({ customer_email: "bruno@cliente.test", status: "pending", mp_preapproval_plan_id: "plan_adhoc_bruno", mp_preapproval_id: null, last_charge_at: null, shopify_orders: [] }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_bruno", planId: "plan_adhoc_bruno" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000200, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000201, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000202, status: "rejected", amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-10-14T10:00:00.000-03:00" }), MP_TOKEN);
  resetStats();
  for (const id of [1310000200, 1310000201, 1310000202]) await invoke(webhook, mpWebhookReq(id));
  assert.equal(W.shopify.orderPosts.length, 2);
  assert.equal(W.sub("sub_bruno").status, "payment_failed");
  assert.deepEqual(touchesFlows(), []);
  assert.equal(rawList(`merchants/${MID}/flow_runs`).length, 0);
});

test("(g) con flujos activos, el webhook engancha notifyActivation / notifyRenewal / pago rechazado", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ flows_active_triggers: ["activated", "renewed", "payment_failed"], flows_enabled: true }));
  for (const t of ["activated", "renewed", "payment_failed"]) seedDoc(`merchants/${MID}/flows/f_${t}`, { ...defaultFlow(t), active: true });
  W.seedSub("sub_bruno", subscriber({ customer_email: "bruno@cliente.test", status: "pending", mp_preapproval_id: "pre_bruno", last_charge_at: null, shopify_orders: [] }));
  W.mp.addPayment(mpPayment({ id: 1310000210, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000211, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000212, status: "rejected", amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-10-14T10:00:00.000-03:00" }), MP_TOKEN);

  for (const id of [1310000210, 1310000211, 1310000212]) await invoke(webhook, mpWebhookReq(id));
  const triggers = rawList(`merchants/${MID}/flow_runs`).map(r => r.data.trigger).sort();
  assert.deepEqual(triggers, ["activated", "payment_failed", "renewed"]);
  // Los mails transaccionales de siempre siguen saliendo aparte.
  assert.equal(W.resend.byType("activation").length, 1);
  assert.equal(W.resend.byType("payment_failed").length, 1);
});
