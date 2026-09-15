// (d) api/_lib/sync.js syncSubscriber — lo usan el polling de CheckoutSuccess, el
// panel, el cron y el atajo ?mid&sid del webhook (notification_url de cada sub).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createWorld, loadApi, subscriber, mpPayment, mpPreapproval, mpWebhookReq, noteMap,
  MID, MP_TOKEN, PRODUCT_TITLE,
} from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { syncSubscriber } = await loadApi("api/_lib/sync.js");
const { default: webhook } = await loadApi("api/mp/webhook.js");
const { generatePortalToken } = await loadApi("api/public.js");

let W;
beforeEach(() => {
  W = createWorld();
  W.seedSub("sub_carla", subscriber({
    customer_email: "carla@cliente.test", customer_name: "Carla Ruiz", customer_phone: "1177770000",
    status: "pending", mp_preapproval_plan_id: "plan_adhoc_carla", mp_preapproval_id: null, mp_preapproval_status: null,
    next_charge_at: null, last_charge_at: null, shopify_orders: [],
    portal_token: generatePortalToken(MID, "sub_carla", 180),
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_carla", planId: "plan_adhoc_carla" }), MP_TOKEN);
});
afterEach(() => { W.router.assertClean(); });

test("(d) happy path: encuentra el preapproval por el plan ad-hoc, crea la orden y activa", async () => {
  const pay = W.mp.addPayment(mpPayment({ id: 1310000100, amount: 12300, preapprovalId: "pre_carla" }), MP_TOKEN);

  const r = await syncSubscriber(MID, "sub_carla");
  assert.equal(r.status, "active");
  assert.equal(r.mp_preapproval_id, "pre_carla");
  assert.equal(r.mp_preapproval_status, "authorized");
  assert.equal(r.payments_approved, 1);
  assert.equal(r.charges_processed, 1);
  assert.equal(r.orders_created, 1);
  assert.deepEqual(r.shopify_errors, []);
  assert.equal(r.forced_charge, false);

  // Buscó el preapproval POR PLAN (1:1 con la sub), no por external_reference.
  const preSearch = W.router.find({ method: "GET", path: /^\/preapproval\/search$/ });
  assert.equal(preSearch.length, 1);
  assert.equal(preSearch[0].query.preapproval_plan_id, "plan_adhoc_carla");
  assert.ok(W.router.find({ method: "GET", path: /^\/v1\/payments\/search$/ }).some(c => c.query.preapproval_id === "pre_carla"));

  const s = W.sub("sub_carla");
  assert.equal(s.status, "active");
  assert.equal(s.mp_preapproval_id, "pre_carla");
  assert.equal(s.next_charge_at, "2026-10-15T10:00:00.000-03:00");
  assert.equal(s.last_charge_at, new Date(Date.parse(pay.date_approved)).toISOString());
  assert.equal(s.shopify_orders.length, 1);
  assert.equal(s.last_sync_error, null);

  assert.equal(W.shopify.orderPosts.length, 1);
  const o = W.shopify.orderPosts[0].order;
  assert.equal(o.tags, "RECURRENTE");
  assert.equal(noteMap(o).recurrentes_subscriber_id, "sub_carla");
  assert.equal(noteMap(o).mp_payment_id, "1310000100");
  assert.equal(noteMap(o).recurrentes_charge_number, "1");
  assert.equal(W.charge("1310000100").shopify_order_id, W.shopify.orders[0].id);

  assert.equal(W.resend.sent.length, 1);
  assert.equal(W.resend.sent[0].subject, `¡Suscripción activa — ${PRODUCT_TITLE}!`);
  assert.deepEqual(W.resend.sent[0].to, ["carla@cliente.test"]);

  // Idempotente: otra sync no crea nada nuevo.
  const r2 = await syncSubscriber(MID, "sub_carla");
  assert.equal(r2.status, "active");
  assert.equal(r2.orders_created, 0);
  assert.equal(r2.charges_processed, 0);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.resend.sent.length, 1);
  assert.equal(W.sub("sub_carla").shopify_orders.length, 1);
});

test("(d) webhook con ?mid&sid (notification_url de la sub) → atajo directo a syncSubscriber", async () => {
  W.mp.addPayment(mpPayment({ id: 1310000101, amount: 12300, preapprovalId: "pre_carla" }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(1310000101, { query: { mid: MID, sid: "sub_carla" } }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, via: "direct_sync" });
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.sub("sub_carla").status, "active");

  // Reentrega por el mismo camino: nada nuevo.
  await invoke(webhook, mpWebhookReq(1310000101, { query: { mid: MID, sid: "sub_carla" } }));
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.resend.sent.length, 1);
});

test("(d) preapproval autorizado sin ningún pago → fuerza el primer cobro UNA sola vez", async () => {
  const before = Date.now();
  const r = await syncSubscriber(MID, "sub_carla");
  assert.equal(r.forced_charge, true);
  assert.equal(r.status, "pending");
  assert.equal(W.mp.preapprovalUpdates.length, 1);
  const upd = W.mp.preapprovalUpdates[0];
  assert.equal(upd.id, "pre_carla");
  assert.equal(upd.body.auto_recurring.frequency, 30);
  assert.equal(upd.body.auto_recurring.transaction_amount, 12300);
  const start = Date.parse(upd.body.auto_recurring.start_date);
  assert.ok(start >= before && start <= Date.now() + 2 * 60_000, "start_date tiene que ser ~ahora + 1 minuto");
  assert.equal(W.sub("sub_carla").sync_force_attempted, true);
  assert.equal(W.shopify.orderPosts.length, 0);

  await syncSubscriber(MID, "sub_carla");
  await syncSubscriber(MID, "sub_carla");
  assert.equal(W.mp.preapprovalUpdates.length, 1, "nunca se fuerza el cobro dos veces");
});

test("(d) token de MP inválido (401): no toca el status y marca el merchant", async () => {
  W.router.failNext("GET", "api.mercadopago.com", /^\/preapproval\/search$/, { status: 401, json: { message: "invalid access token", error: "unauthorized", status: 401 } });
  const r = await syncSubscriber(MID, "sub_carla");
  assert.equal(r.status, "error");
  assert.equal(r.mp_auth_error, true);
  const s = W.sub("sub_carla");
  assert.equal(s.status, "pending");
  assert.match(s.last_sync_error, /preapproval_search/);
  assert.ok(W.merchant().mp_token_invalid_at);
  assert.equal(W.shopify.orderPosts.length, 0);
});

test("(d) renovación rechazada detectada por sync → payment_failed + un solo mail", async () => {
  W.seedSub("sub_carla", {
    ...W.sub("sub_carla"), status: "active", mp_preapproval_id: "pre_carla",
    last_charge_at: "2026-08-15T13:00:00.000Z", shopify_orders: [5550050],
  });
  // Cobro viejo ya procesado (con orden) + rechazo nuevo.
  W.mp.addPayment(mpPayment({ id: 1310000110, amount: 12300, preapprovalId: "pre_carla", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  seedDoc(`merchants/${MID}/charges/1310000110`, { subscriber_id: "sub_carla", mp_payment_id: "1310000110", amount_ars: 12300, status: "approved", shopify_order_id: 5550050, shopify_order_status_url: null, error: null, created_at: "2026-08-15T13:00:00.000Z" });
  W.mp.addPayment(mpPayment({ id: 1310000111, status: "rejected", amount: 12300, preapprovalId: "pre_carla", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);

  const r = await syncSubscriber(MID, "sub_carla");
  assert.equal(r.status, "payment_failed");
  await syncSubscriber(MID, "sub_carla");

  const s = W.sub("sub_carla");
  assert.equal(s.status, "payment_failed");
  assert.equal(s.last_payment_failed_id, "1310000111");
  assert.equal(W.shopify.orderPosts.length, 0);
  assert.equal(W.resend.byType("payment_failed").length, 1);
  assert.equal(W.resend.sent.length, 1);
});
