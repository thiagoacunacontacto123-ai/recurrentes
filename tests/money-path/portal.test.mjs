// (f) Portal del cliente (api/public.js ?action=sub): pausar / reactivar /
// cancelar con un token de portal válido. Cambia el preapproval en MP (deja de
// cobrar) y el estado local.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createWorld, loadApi, subscriber, mpPreapproval, MID, MP_TOKEN, PRODUCT_TITLE, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const pub = await loadApi("api/public.js");
const handler = pub.default;

let W, TOKEN;
beforeEach(() => {
  W = createWorld();
  W.seedSub("sub_ana", subscriber({ resume_at: null }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana", nextPaymentDate: "2026-10-16T10:00:00.000-03:00" }), MP_TOKEN);
  TOKEN = pub.generatePortalToken(MID, "sub_ana", 180);
});
afterEach(() => { W.router.assertClean(); });

const action = (a, extra = {}, token = TOKEN) => invoke(handler, { method: "POST", query: { action: "sub", token }, body: { action: a, ...extra } });

test("(f) pausar: MP preapproval → paused y la sub queda paused", async () => {
  const res = await action("pause");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: "paused" });
  assert.deepEqual(W.mp.preapprovalUpdates.map(u => [u.id, u.token, u.body]), [["pre_ana", MP_TOKEN, { status: "paused" }]]);
  const s = W.sub("sub_ana");
  assert.equal(s.status, "paused");
  assert.equal(s.mp_preapproval_status, "paused");
  assert.equal(W.resend.toCustomer().length, 0);
});

test("(f) reactivar: MP preapproval → authorized, sub active y se borra la reactivación automática", async () => {
  W.seedSub("sub_ana", { ...W.sub("sub_ana"), status: "paused", resume_at: "2026-11-01T00:00:00.000Z" });
  const res = await action("resume");
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, "active");
  assert.deepEqual(W.mp.preapprovalUpdates.map(u => u.body), [{ status: "authorized" }]);
  const s = W.sub("sub_ana");
  assert.equal(s.status, "active");
  assert.equal("resume_at" in s, false);
  assert.equal(s.next_charge_at, "2026-10-16T10:00:00.000-03:00");
});

test("(f) cancelar con motivo: MP → cancelled, sub cancelled, registro de baja y mail de cancelación", async () => {
  const res = await action("cancel", { reason_code: "precio", reason: "Me resulta caro", comment: "Muy caro este mes" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, status: "cancelled", cancel_reason_code: "precio" });
  assert.deepEqual(W.mp.preapprovalUpdates.map(u => u.body), [{ status: "cancelled" }]);

  const s = W.sub("sub_ana");
  assert.equal(s.status, "cancelled");
  assert.equal(s.cancelled_by, "customer");
  assert.ok(s.cancelled_at);
  assert.equal(s.cancel_reason_code, "precio");
  assert.equal(s.cancel_comment, "Muy caro este mes");
  assert.equal(s.mp_preapproval_status, "cancelled");

  const c = rawGet(`merchants/${MID}/cancellations/sub_ana`);
  assert.equal(c.reason_code, "precio");
  assert.equal(c.saved, false);
  assert.equal(c.amount_ars, 12300);

  assert.equal(W.resend.toCustomer().length, 1);
  assert.equal(W.resend.toCustomer()[0].subject, `Tu suscripción a ${PRODUCT_TITLE} fue cancelada`);
  assert.deepEqual(W.resend.toCustomer()[0].to, ["ana@cliente.test"]);
  assert.equal(W.resend.byType("merchant_alert").length, 1, "la baja le avisa al dueño por mail (default)");
  const log = W.emailLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].type, "cancellation");
  assert.equal(log[0].status, "sent");
});

test("(f) token inválido o firmado con otro secreto → 403 sin tocar MP", async () => {
  const bad = await action("cancel", {}, "no-es-un-token");
  assert.equal(bad.statusCode, 403);
  const [p] = TOKEN.split(".");
  const forged = `${p}.${crypto.createHmac("sha256", "otro-secreto").update(p).digest("base64url")}`;
  const bad2 = await action("cancel", {}, forged);
  assert.equal(bad2.statusCode, 403);
  const expired = pub.generatePortalToken(MID, "sub_ana", -1);
  const bad3 = await action("cancel", {}, expired);
  assert.equal(bad3.statusCode, 403);
  assert.equal(W.router.calls.length, 0);
  assert.equal(W.sub("sub_ana").status, "active");
});

test("(f) tokens viejos firmados con MP_WEBHOOK_SECRET (links ya enviados a clientes) siguen andando", async () => {
  const bodyB64 = Buffer.from(JSON.stringify({ mid: MID, sid: "sub_ana", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.MP_WEBHOOK_SECRET).update(bodyB64).digest("base64url");
  const legacy = `${bodyB64}.${sig}`;
  const res = await invoke(handler, { method: "GET", query: { action: "sub", token: legacy } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sub.id, "sub_ana");
  assert.equal(res.body.sub.status, "active");
  const pause = await action("pause", {}, legacy);
  assert.equal(pause.statusCode, 200);
});

test("(f) GET detalle: solo los cobros de ESTA sub", async () => {
  seedDoc(`merchants/${MID}/charges/1`, { subscriber_id: "sub_ana", amount_ars: 12300, status: "approved", created_at: "2026-08-16T13:00:00.000Z" });
  seedDoc(`merchants/${MID}/charges/2`, { subscriber_id: "otra_sub", amount_ars: 999, status: "approved", created_at: "2026-08-17T13:00:00.000Z" });
  const res = await invoke(handler, { method: "GET", query: { action: "sub", token: TOKEN } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.charges.map(c => c.id), ["1"]);
  assert.equal(res.body.sub.shopify_orders_count, 1);
});

test("(f) si MP falla, responde 502 y NO cambia el estado local", async () => {
  W.router.failNext("PUT", "api.mercadopago.com", /^\/preapproval\/pre_ana$/, { status: 500, json: { message: "internal_error", status: 500 } });
  const res = await action("cancel");
  assert.equal(res.statusCode, 502);
  assert.equal(W.sub("sub_ana").status, "active");
  assert.equal(W.resend.sent.length, 0);
});

test("(f) la tienda deshabilitó cancelar desde el portal → 403 sin tocar MP", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ portal: { allow_cancel: false } }));
  const res = await action("cancel");
  assert.equal(res.statusCode, 403);
  assert.equal(W.mp.preapprovalUpdates.length, 0);
});

// ── REGRESIÓN: una sub CANCELADA no se toca desde el portal ──────────────────
// El token del portal dura 180 días. Sin este corte, el link viejo de un cliente
// que ya se dio de baja servía para mandar "resume": Recurrentes le pedía a MP
// volver a autorizar el preapproval y le cobraban de nuevo.
test("(f) sub cancelada: reactivar desde el portal se rechaza y MP no se toca", async () => {
  W.seedSub("sub_ana", { ...W.sub("sub_ana"), status: "cancelled", cancelled_at: "2026-09-01T00:00:00.000Z" });

  const res = await action("resume");

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "sub_cancelled");
  assert.equal(W.sub("sub_ana").status, "cancelled", "la sub tiene que seguir cancelada");
  assert.deepEqual(W.mp.preapprovalUpdates, [], "no se puede tocar el preapproval en MP");
});

test("(f) sub cancelada: pausar y cancelar de nuevo también se rechazan", async () => {
  W.seedSub("sub_ana", { ...W.sub("sub_ana"), status: "cancelled" });
  for (const a of ["pause", "cancel"]) {
    const res = await action(a);
    assert.equal(res.statusCode, 409, `${a} tiene que dar 409`);
  }
  assert.deepEqual(W.mp.preapprovalUpdates, []);
  assert.equal(W.resend.sent.length, 0, "no se manda otro mail de cancelación");
});

test("(f) sub cancelada: tampoco se puede cambiar la dirección", async () => {
  W.seedSub("sub_ana", { ...W.sub("sub_ana"), status: "cancelled" });
  const res = await invoke(handler, {
    method: "POST", query: { action: "update-address", token: TOKEN },
    body: { shipping_address: { address1: "Calle Falsa 123", city: "CABA", province: "CABA", zip: "1414" }, customer_phone: "1155550000" },
  });
  assert.equal(res.statusCode, 409);
  assert.equal(W.sub("sub_ana").shipping_address.address1, "Av. Siempreviva 742", "la dirección no cambia");
});
