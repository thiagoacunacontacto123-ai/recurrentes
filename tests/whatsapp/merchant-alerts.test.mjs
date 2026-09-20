// Avisos al COMERCIANTE (api/_lib/merchantAlerts.js): alta / pausa / baja / pago rechazado
// por WhatsApp desde el número de Recurrentes, con mail de respaldo. Firestore en memoria,
// MP / Shopify / Resend falsos y Graph API de Meta falsa: ninguna llamada real.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, mpPayment, mpPreapproval, mpWebhookReq, luminaMerchant, MID, MP_TOKEN, PRODUCT_TITLE } from "../helpers/world.mjs";
import { invoke, mockReq, mockRes } from "../helpers/http.mjs";
import { stats, resetStats, seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";
import { waChargeUsd, WHATSAPP_PRICE_USD_UTILITY_DEFAULT as UTIL } from "../../shared/platform/pricing.js";

const PID = "700800900100";
const TOKEN = "EAAplatformTOKEN1234567890abcdefXYZ";
function waEnv(on) {
  if (on) { process.env.WHATSAPP_PHONE_NUMBER_ID = PID; process.env.WHATSAPP_ACCESS_TOKEN = TOKEN; }
  else { delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_ACCESS_TOKEN; }
}
delete process.env.WHATSAPP_PRICE_USD_UTILITY;
delete process.env.WHATSAPP_GRAPH_VERSION;
const RESEND = process.env.RESEND_API_KEY;

const alerts = await loadApi("api/_lib/merchantAlerts.js");
const sync = await loadApi("api/_lib/sync.js");
const { default: webhook } = await loadApi("api/mp/webhook.js");
const pub = await loadApi("api/public.js");
const { default: subsHandler } = await loadApi("api/subscribers.js");
const SW = await loadApi("shared/platform/whatsapp.js");

const OWNER_PHONE = "+5491164117974";
const withAlerts = (o = {}) => luminaMerchant({ alerts_whatsapp_enabled: true, owner_whatsapp: OWNER_PHONE, contact_email: "thiago@lumina.test", ...o });
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;

let W, wa;
beforeEach(() => {
  W = createWorld();
  waEnv(true);
  process.env.RESEND_API_KEY = RESEND;
  wa = [];
  const routerFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const u = typeof input === "string" ? input : input?.url || String(input);
    if (u.startsWith("https://graph.facebook.com/")) {
      const body = init.body ? JSON.parse(init.body) : null;
      wa.push({ url: u, headers: init.headers || {}, body, params: (body?.template?.components?.[0]?.parameters || []).map(p => p.text) });
      return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: body?.to }], messages: [{ id: `wamid.T${wa.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return routerFetch(input, init);
  };
});
afterEach(() => { W.router.assertClean(); waEnv(false); process.env.RESEND_API_KEY = RESEND; });

const tpl = (name) => wa.filter(c => c.body?.template?.name === name);
const alertMails = () => W.resend.byType("merchant_alert");

// ── Apagado: cero lecturas ─────────────────────────────────────────
test("todo apagado (mail y WhatsApp): los eventos no leen ni escriben nada y no llaman a nadie", async () => {
  const m = { ...W.merchant(), alerts_email: false };
  resetStats();
  for (const ev of SW.ALERT_EVENT_IDS) await alerts.notifyMerchantWhatsApp(ev, MID, m, "sub_ana", subscriber(), { key: "k" });
  await alerts.notifyMerchantStatusChange(MID, m, "sub_ana", "active", "cancelled", subscriber());
  assert.equal(stats.readOps, 0);
  assert.equal(stats.writeOps, 0);
  assert.equal(wa.length, 0);
  assert.equal(W.router.calls.length, 0);
});

test("prendido pero sin WhatsApp ni Resend, o con el evento apagado: tampoco lee nada", async () => {
  waEnv(false);
  delete process.env.RESEND_API_KEY;
  resetStats();
  await alerts.notifyMerchantWhatsApp("subscribed", MID, withAlerts(), "sub_ana", subscriber());
  process.env.RESEND_API_KEY = RESEND;
  waEnv(true);
  await alerts.notifyMerchantWhatsApp("paused", MID, withAlerts({ alerts_events: { paused: false } }), "sub_ana", subscriber());
  await alerts.notifyMerchantWhatsApp("subscribed", MID, withAlerts({ alerts_whatsapp_enabled: "true", alerts_email: false }), "sub_ana", subscriber());
  assert.equal(stats.readOps, 0);
  assert.equal(stats.writeOps, 0);
  assert.equal(wa.length, 0);
});

test("webhook completo de Lumina con los defaults: alta y rechazo avisan al dueño POR MAIL, nunca por Meta", async () => {
  W.seedSub("sub_bruno", subscriber({ customer_email: "bruno@cliente.test", status: "pending", mp_preapproval_id: "pre_bruno", last_charge_at: null, shopify_orders: [] }));
  W.mp.addPayment(mpPayment({ id: 1410000200, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1410000201, status: "rejected", amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);
  for (const id of [1410000200, 1410000201]) await invoke(webhook, mpWebhookReq(id));
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.sub("sub_bruno").status, "payment_failed");
  assert.equal(wa.length, 0, "WhatsApp apagado por defecto");
  assert.equal(alertMails().length, 2, "alta + rechazo → 2 mails al dueño");
  assert.equal(rawList(`merchants/${MID}/alert_log`).length, 2);
});

test("webhook completo de Lumina con el mail apagado: nunca toca alert_log ni Meta", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ alerts_email: false }));
  W.seedSub("sub_bruno", subscriber({ customer_email: "bruno@cliente.test", status: "pending", mp_preapproval_id: "pre_bruno", last_charge_at: null, shopify_orders: [] }));
  W.mp.addPayment(mpPayment({ id: 1410000200, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1410000201, status: "rejected", amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);
  resetStats();
  for (const id of [1410000200, 1410000201]) await invoke(webhook, mpWebhookReq(id));
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.sub("sub_bruno").status, "payment_failed");
  assert.deepEqual(stats.readLog.filter(r => /alert_log/.test(r.path)), []);
  assert.equal(rawList(`merchants/${MID}/alert_log`).length, 0);
  assert.equal(wa.length, 0);
  assert.equal(alertMails().length, 0);
});

// ── Alta ───────────────────────────────────────────────────────────
test("alta: un solo WhatsApp (webhook + sync + otra llamada) con nombre de pila, producto, monto y link; uso con recargo", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_bruno", subscriber({ status: "pending", mp_preapproval_plan_id: "plan_adhoc_bruno", mp_preapproval_id: "pre_bruno", last_charge_at: null, shopify_orders: [] }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_bruno", planId: "plan_adhoc_bruno" }), MP_TOKEN);
  const pay = W.mp.addPayment(mpPayment({ id: 1410000300, amount: 12300, preapprovalId: "pre_bruno" }), MP_TOKEN);

  await invoke(webhook, mpWebhookReq(1410000300));
  await sync.syncSubscriber(MID, "sub_bruno");
  await sync.notifyActivation(MID, W.merchant(), "sub_bruno", W.sub("sub_bruno"), pay, "sync");

  assert.equal(W.shopify.orderPosts.length, 1);
  const sent = tpl("aviso_comercio_alta");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `https://graph.facebook.com/v25.0/${PID}/messages`);
  assert.equal(sent[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(sent[0].body.to, OWNER_PHONE.slice(1));
  assert.equal(sent[0].body.template.language.code, "es_AR");
  assert.deepEqual(sent[0].params, ["LuminaLabs", "Ana", PRODUCT_TITLE, "$12.300", SW.ALERTS_PANEL_URL]);
  assert.equal(alertMails().length, 0, "sin 'también por mail' y con WhatsApp OK: no sale mail");

  const month = SW.waUsageMonth();
  const u = rawGet(`merchants/${MID}/usage/${month}`);
  assert.equal(u.wa_sent, 1);
  assert.equal(u.wa_alerts_sent, 1);
  assert.equal(u.wa_platform_sent, 1);
  assert.ok(near(u.wa_cost_usd, waChargeUsd(UTIL)), `precio × 1,50 (${u.wa_cost_usd})`);
  const au = rawGet(`admin_usage/${month}`);
  assert.ok(near(au.merchants[MID].wa_cost_usd, waChargeUsd(UTIL)) && au.merchants[MID].wa_alerts_sent === 1);
  const log = rawList(`merchants/${MID}/message_log`).map(d => d.data).find(l => l.type === "merchant_alert");
  assert.equal(log?.status, "sent");
  assert.equal(log.to.includes("••••"), true, "el teléfono queda enmascarado");
  assert.equal(rawList(`merchants/${MID}/alert_log`).length, 1);
});

test("alta con 'también por mail' (por defecto): sale WhatsApp y mail", async () => {
  const m = withAlerts();
  await alerts.notifyMerchantWhatsApp("subscribed", MID, m, "sub_x", subscriber({ customer_name: "maría luz gómez" }), { key: "first", amount: 9480 });
  assert.equal(tpl("aviso_comercio_alta").length, 1);
  assert.equal(tpl("aviso_comercio_alta")[0].params[1], "María");
  assert.equal(alertMails().length, 1);
  assert.deepEqual(alertMails()[0].to, ["thiago@lumina.test"]);
});

// ── Pago rechazado ─────────────────────────────────────────────────
test("renovación rechazada: un aviso aunque llegue dos veces por webhook y después por sync; el reintento rechazado no repite", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_ana", subscriber());
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1410000400, status: "rejected", amount: 12300, preapprovalId: "pre_ana", dateCreated: "2026-09-15T10:00:00.000-03:00" }), MP_TOKEN);
  await invoke(webhook, mpWebhookReq(1410000400));
  await invoke(webhook, mpWebhookReq(1410000400));
  await sync.syncSubscriber(MID, "sub_ana");
  assert.equal(W.sub("sub_ana").status, "payment_failed");
  // Reintento de MP también rechazado: la sub ya estaba en payment_failed → sin aviso nuevo.
  W.mp.addPayment(mpPayment({ id: 1410000401, status: "rejected", amount: 12300, preapprovalId: "pre_ana", dateCreated: "2026-09-18T10:00:00.000-03:00" }), MP_TOKEN);
  await invoke(webhook, mpWebhookReq(1410000401));
  const sent = tpl("aviso_comercio_pago_rechazado");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params, ["LuminaLabs", "Ana", PRODUCT_TITLE, "$12.300", SW.ALERTS_PANEL_URL]);
  assert.equal(W.resend.byType("payment_failed").length, 2, "los mails al cliente siguen saliendo como siempre");
});

test("evento de pago rechazado apagado: no avisa (y no lee alert_log)", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_events: { payment_failed: false } }));
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1410000450, status: "rejected", amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);
  await invoke(webhook, mpWebhookReq(1410000450));
  assert.equal(W.sub("sub_ana").status, "payment_failed");
  assert.equal(wa.length, 0);
  assert.equal(rawList(`merchants/${MID}/alert_log`).length, 0);
});

// ── Pausa / baja ───────────────────────────────────────────────────
test("pausa desde el portal: un aviso; el webhook de preapproval que llega después no lo repite", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_ana", subscriber({ resume_at: null }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana", status: "paused" }), MP_TOKEN);
  const token = pub.generatePortalToken(MID, "sub_ana", 180);
  const r = await invoke(pub.default, { method: "POST", query: { action: "sub", token }, body: { action: "pause" } });
  assert.equal(r.statusCode, 200);
  await invoke(webhook, mpWebhookReq("pre_ana", { type: "preapproval" }));
  await sync.syncSubscriber(MID, "sub_ana");
  const sent = tpl("aviso_comercio_pausa");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].params, ["LuminaLabs", "Ana", PRODUCT_TITLE, SW.ALERTS_PANEL_URL]);
});

test("baja desde el panel: un aviso", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_ana", subscriber());
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana", status: "cancelled" }), MP_TOKEN);
  const r = await invoke(subsHandler, { method: "PATCH", query: { id: "sub_ana" }, body: { action: "cancel" }, headers: { authorization: `Bearer test:${MID}` } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(W.sub("sub_ana").status, "cancelled");
  await invoke(webhook, mpWebhookReq("pre_ana", { type: "preapproval" }));
  assert.equal(tpl("aviso_comercio_baja").length, 1);
});

test("baja del lado de MP (webhook de preapproval): un aviso, sin repetir en reentregas ni en el sync", async () => {
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_caro", subscriber({ customer_name: "Carolina Díaz", mp_preapproval_id: "pre_caro", mp_preapproval_plan_id: "plan_adhoc_caro" }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_caro", planId: "plan_adhoc_caro", status: "cancelled" }), MP_TOKEN);
  await invoke(webhook, mpWebhookReq("pre_caro", { type: "preapproval" }));
  await invoke(webhook, mpWebhookReq("pre_caro", { type: "preapproval" }));
  await sync.syncSubscriber(MID, "sub_caro");
  assert.equal(W.sub("sub_caro").status, "cancelled");
  const sent = tpl("aviso_comercio_baja");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params[1], "Carolina");
});

test("dedup: dos procesos que ven el mismo cambio a la vez mandan un solo aviso; una alta que nunca pagó no es una baja", async () => {
  const m = withAlerts({ alerts_email: false });
  await Promise.all([
    alerts.notifyMerchantStatusChange(MID, m, "sub_z", "active", "cancelled", subscriber()),
    alerts.notifyMerchantStatusChange(MID, m, "sub_z", "active", "cancelled", subscriber()),
  ]);
  await alerts.notifyMerchantStatusChange(MID, m, "sub_lead", "pending", "cancelled", subscriber());
  await alerts.notifyMerchantStatusChange(MID, m, "sub_z", "paused", "active", subscriber());
  assert.equal(wa.length, 1);
});

// ── Mail de respaldo ───────────────────────────────────────────────
test("sin WhatsApp de Recurrentes: el aviso sale por mail (aunque 'también por mail' esté apagado), con el pie de siempre", async () => {
  waEnv(false);
  seedDoc(`merchants/${MID}`, withAlerts({ alerts_email: false }));
  W.seedSub("sub_ana", subscriber({ resume_at: null }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  const token = pub.generatePortalToken(MID, "sub_ana", 180);
  const r = await invoke(pub.default, { method: "POST", query: { action: "sub", token }, body: { action: "cancel" } });
  assert.equal(r.statusCode, 200);
  assert.equal(wa.length, 0);
  const mails = alertMails();
  assert.equal(mails.length, 1);
  assert.deepEqual(mails[0].to, ["thiago@lumina.test"]);
  assert.equal(mails[0].subject, "Suscripción cancelada de Ana · LuminaLabs");
  assert.match(mails[0].html, /Se canceló una suscripción en LuminaLabs: la de Ana a Cápsulas LuminaLabs\./);
  assert.match(mails[0].html, /mail automático, por favor no lo respondas/);
  const log = rawList(`merchants/${MID}/alert_log`)[0].data;
  assert.equal(log.status, "sent");
  assert.equal(log.whatsapp.reason, "not_available");
  assert.equal(rawGet(`merchants/${MID}/usage/${SW.waUsageMonth()}`), undefined, "sin WhatsApp no se cobra uso");
});

// ── Destinatario ───────────────────────────────────────────────────
test("tienda extra sin WhatsApp propio: usa el owner_whatsapp y el mail del login dueño", async () => {
  seedDoc("merchants/owner_uid", { email: "login@dueno.test", owner_whatsapp: "11 6411-7974", contact_email: "dueno@tienda.test" });
  const store = { ownerUid: "owner_uid", store_name: "Tienda Extra", alerts_whatsapp_enabled: true };
  seedDoc("merchants/m_extra", store);
  const out = await alerts.notifyMerchantWhatsApp("subscribed", "m_extra", store, "s1", { customer_name: "Juan Gómez", plan_snapshot: { product_title: "Café", total_per_charge_ars: 5000 } });
  assert.equal(out.ok, true);
  assert.equal(wa.length, 1);
  assert.equal(wa[0].body.to, "5491164117974");
  assert.deepEqual(wa[0].params, ["Tienda Extra", "Juan", "Café", "$5.000", SW.ALERTS_PANEL_URL]);
  assert.deepEqual(alertMails()[0].to, ["dueno@tienda.test"]);
  assert.equal(rawGet(`merchants/m_extra/usage/${SW.waUsageMonth()}`).wa_alerts_sent, 1);
  // alerts_whatsapp de la tienda gana sobre el del dueño.
  const own = await alerts.alertRecipients("m_extra", { ...store, alerts_whatsapp: "+5493515551234" });
  assert.equal(own.phone, "+5493515551234");
});

// ── API del panel ──────────────────────────────────────────────────
async function api(action, body, ctx = { merchantId: MID, uid: MID, role: "owner" }) {
  const res = mockRes();
  await alerts.merchantAlertsApi(ctx, action, mockReq({ method: "POST", body }), res);
  return res;
}

test("alerts-save / alerts-test: solo el dueño, normaliza el número y la prueba sale", async () => {
  const member = await api("alerts-save", { enabled: true }, { merchantId: MID, uid: "u2", role: "member" });
  assert.equal(member.statusCode, 403);
  const bad = await api("alerts-save", { enabled: true, whatsapp: "123" });
  assert.equal(bad.statusCode, 400);
  const ok = await api("alerts-save", { enabled: true, whatsapp: "11 5555-0000", events: { paused: false }, email: false });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const m = W.merchant();
  assert.equal(m.alerts_whatsapp_enabled, true);
  assert.equal(m.alerts_whatsapp, "+5491155550000");
  assert.deepEqual(m.alerts_events, { subscribed: true, paused: false, cancelled: true, payment_failed: true, renewed: true });
  assert.equal(m.alerts_email, false);
  assert.equal(ok.body.alerts_whatsapp_available, true);

  const t = await api("alerts-test", {});
  assert.equal(t.statusCode, 200, JSON.stringify(t.body));
  assert.equal(wa.length, 1);
  assert.equal(wa[0].body.to, "5491155550000");
  assert.equal(wa[0].body.template.name, "aviso_comercio_alta");
  assert.equal(rawList(`merchants/${MID}/alert_log`).length, 0, "la prueba no deja registro de dedup");
});

// ── Plantillas ─────────────────────────────────────────────────────
test("plantillas del comercio: utilidad es_AR, ejemplos completos, sin variables al borde ni pegadas, aparte de las de clientes", () => {
  assert.equal(SW.WA_MERCHANT_TEMPLATES.length, 5);   // alta, pausa, baja, pago rechazado y cobro
  for (const t of SW.WA_MERCHANT_TEMPLATES) {
    const n = SW.templateVarCount(t.body);
    assert.equal(t.category, "UTILITY");
    assert.equal(t.lang, "es_AR");
    assert.equal(n, Object.keys(t.vars).length, t.name);
    assert.equal(t.samples.length, n, t.name);
    assert.ok(!/^\s*\{\{/.test(t.body) && !/\}\}\s*$/.test(t.body), `${t.name}: no empieza ni termina con variable`);
    assert.ok(!/\}\}\s*\{\{/.test(t.body), `${t.name}: sin variables pegadas`);
    assert.ok(Object.values(t.vars).includes("marca") && Object.values(t.vars).includes("link_panel"));
    assert.ok(!SW.WA_TEMPLATES.some(c => c.name === t.name), "no aparecen en el editor de flujos de clientes");
  }
});
