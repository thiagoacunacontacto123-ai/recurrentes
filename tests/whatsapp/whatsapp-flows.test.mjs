// Sección "Flujos de WhatsApp" (api/_lib/whatsappApi.js): cada plantilla a clientes es
// un flujo de sistema (wa_template) que el comercio prende/apaga sin editar textos.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawList, rawGet } from "../helpers/fake-firestore.mjs";

process.env.WHATSAPP_PHONE_NUMBER_ID = "1319380847922196";
process.env.WHATSAPP_WABA_ID = "1377371627894423";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAtesttokenABCDEFGHIJKLMNOP1234567890";

const { whatsappApi } = await loadApi("api/_lib/whatsappApi.js");
const ctx = { merchantId: MID, uid: MID, role: "owner" };
const call = (action, { method = "GET", body } = {}) => invoke((req, res) => whatsappApi(ctx, action, req, res), { method, body, query: { action } });

let W;
beforeEach(() => { W = createWorld({ merchant: luminaMerchant({ whatsapp_platform_enabled: true, whatsapp_platform_optin_at: "2026-09-18T00:00:00.000Z" }) }); });

test("(q) whatsapp-flows: las 4 plantillas a clientes, apagadas, con precio × 1,50 y uso del mes", async () => {
  const r = await call("whatsapp-flows");
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.sender, "platform");
  assert.deepEqual(r.body.templates.map(t => t.name), ["carrito_sin_pagar", "aviso_proximo_cobro", "pago_rechazado", "suscripcion_activa", "renovacion_cobrada"], "el carrito primero: es el que más se usa");
  assert.ok(r.body.templates.every(t => t.active === false && t.flow_id === null));
  assert.equal("markup" in r.body, false, "el recargo no se expone al panel");
  assert.equal("price_usd" in r.body, false, "ni el precio de Meta");
  assert.ok(Math.abs(r.body.charge_usd - 0.018) < 1e-6, "0,012 × 1,50");
  assert.equal(r.body.months.length, 3);
  assert.equal(r.body.usage.wa_sent, 0);
  // El texto de ejemplo lleva la marca de la tienda y no deja {{n}} sin reemplazar.
  const up = r.body.templates.find(t => t.name === "aviso_proximo_cobro");
  assert.match(up.preview, /LuminaLabs/);
  assert.ok(!/\{\{\d\}\}/.test(up.preview));
  assert.equal(up.days_before, 3);
  // El carrito es Marketing para Meta: cuesta más, y el panel lo dice por plantilla.
  const cart = r.body.templates[0];
  assert.ok(Math.abs(cart.charge_usd - 0.0618 * 1.5) < 1e-6, `carrito a precio marketing (${cart.charge_usd})`);
  assert.ok(Math.abs(up.charge_usd - 0.018) < 1e-6);
});

test("(q) prender una plantilla crea SU flujo de sistema (wa_template) activo y lo indexa", async () => {
  const r = await call("whatsapp-template-toggle", { method: "POST", body: { name: "pago_rechazado", active: true } });
  assert.equal(r.statusCode, 200);
  const t = r.body.templates.find(x => x.name === "pago_rechazado");
  assert.equal(t.active, true);
  assert.ok(t.flow_id);
  const flows = rawList(`merchants/${MID}/flows`);
  assert.equal(flows.length, 1);
  const f = flows[0].data;
  assert.equal(f.wa_template, "pago_rechazado");
  assert.equal(f.trigger, "payment_failed");
  assert.equal(f.active, true);
  assert.equal(f.steps.length, 1);
  assert.equal(f.steps[0].type, "whatsapp");
  assert.equal(f.steps[0].template, "pago_rechazado");
  // El índice del merchant sabe que ese disparador tiene flujo (emitFlowEvent lo mira sin leer flows).
  assert.ok((rawGet(`merchants/${MID}`).flows_active_triggers || []).includes("payment_failed"));
});

test("(q) el carrito espera 1 hora antes del WhatsApp (si paga en ese rato, el motor lo saca)", async () => {
  await call("whatsapp-template-toggle", { method: "POST", body: { name: "carrito_sin_pagar", active: true } });
  const f = rawList(`merchants/${MID}/flows`)[0].data;
  assert.equal(f.trigger, "checkout_started");
  assert.equal(f.steps.length, 2);
  assert.equal(f.steps[0].type, "wait");
  assert.equal(f.steps[1].type, "whatsapp");
  assert.equal(f.steps[1].template, "carrito_sin_pagar");
});

test("(q) apagar deja el flujo (con su historial) pero inactivo; prender de nuevo no duplica", async () => {
  await call("whatsapp-template-toggle", { method: "POST", body: { name: "renovacion_cobrada", active: true } });
  const off = await call("whatsapp-template-toggle", { method: "POST", body: { name: "renovacion_cobrada", active: false } });
  assert.equal(off.body.templates.find(x => x.name === "renovacion_cobrada").active, false);
  assert.equal(rawList(`merchants/${MID}/flows`).length, 1);
  assert.equal(rawList(`merchants/${MID}/flows`)[0].data.active, false);
  await call("whatsapp-template-toggle", { method: "POST", body: { name: "renovacion_cobrada", active: true } });
  assert.equal(rawList(`merchants/${MID}/flows`).length, 1, "no crea otro");
  assert.equal(rawList(`merchants/${MID}/flows`)[0].data.active, true);
});

test("(q) adopta el flujo viejo de 'próximo cobro' (creado por el interruptor, sin wa_template)", async () => {
  seedDoc(`merchants/${MID}/flows/old1`, { name: "Aviso de próximo cobro por WhatsApp", trigger: "upcoming_charge", days_before: 3, active: true, steps: [{ id: "s1", type: "whatsapp", template: "aviso_proximo_cobro", lang: "es_AR", vars: {} }], stats: { sent: 7 } });
  const r = await call("whatsapp-flows");
  const t = r.body.templates.find(x => x.name === "aviso_proximo_cobro");
  assert.equal(t.active, true);
  assert.equal(t.flow_id, "old1");
  assert.equal(t.sent, 7);
  await call("whatsapp-template-toggle", { method: "POST", body: { name: "aviso_proximo_cobro", active: false } });
  assert.equal(rawGet(`merchants/${MID}/flows/old1`).wa_template, "aviso_proximo_cobro", "queda marcado y el editor de mail deja de mostrarlo");
  assert.equal(rawList(`merchants/${MID}/flows`).length, 1);
});

test("(q) sin WhatsApp prendido: la vista lo dice y el toggle devuelve not_enabled", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant());   // sin whatsapp_platform_enabled
  const v = await call("whatsapp-flows");
  assert.equal(v.body.enabled, false);
  assert.equal(v.body.templates.length, 5, "igual muestra qué se puede prender");
  const r = await call("whatsapp-template-toggle", { method: "POST", body: { name: "pago_rechazado", active: true } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.code, "not_enabled");
  assert.equal(rawList(`merchants/${MID}/flows`).length, 0);
});

test("(q) plantilla desconocida → 400; miembro sin ser dueño → 403", async () => {
  const bad = await call("whatsapp-template-toggle", { method: "POST", body: { name: "otra", active: true } });
  assert.equal(bad.statusCode, 400);
  const member = await invoke((req, res) => whatsappApi({ ...ctx, role: "member" }, "whatsapp-template-toggle", req, res), { method: "POST", body: { name: "pago_rechazado", active: true } });
  assert.equal(member.statusCode, 403);
});
