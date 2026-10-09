// Vigilante (api/_lib/watchdog.js + errlog.js, 9-oct-2026): registro central de errores,
// un WhatsApp al admin cuando algo se rompe y otro cuando vuelve, y el resumen diario.
// Firestore en memoria, Meta falsa, sin red real.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, subscriber, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";

process.env.ADMIN_EMAILS = "admin@recurrentes.test";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1319380847922196";
process.env.WHATSAPP_WABA_ID = "1377371627894423";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAtesttokenABCDEFGHIJKLMNOP1234567890";
delete process.env.ADMIN_WHATSAPP;
delete process.env.RESEND_API_KEY;

const { logError, recentErrors, countByKind, withErrorLog, scrubMessage, pruneErrors } = await loadApi("api/_lib/errlog.js");
const { runWatchdog, checkErrorBursts, checkCrons, buildDailySummary, dailySummary, CHECKOUT_MIN } = await loadApi("api/_lib/watchdog.js");
const { ADMIN_EVENT_LABEL, _resetAdminPhoneCache } = await loadApi("api/_lib/adminAlerts.js");

let sent = [];
function fakeGraph() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
    if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
    if (u.includes("/messages") && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      sent.push(body);
      return json({ messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.W${sent.length}`, message_status: "accepted" }] });
    }
    return json({ error: { message: "no mockeado " + u, code: 100 } }, 400);
  };
}
// Texto del aviso: el evento ({{1}}) y el detalle ({{3}}) de la plantilla aviso_admin.
const textOf = (b) => (b.template?.components?.[0]?.parameters || []).map(p => p.text).join(" | ");

const NOW = Date.parse("2026-10-09T15:00:00.000Z");
const ago = (ms) => new Date(NOW - ms).toISOString();
const H = 3600e3;

beforeEach(() => {
  createWorld({ merchant: luminaMerchant() });
  seedDoc("merchants/admin_uid", { email: "admin@recurrentes.test", owner_whatsapp: "+5491164117974", store_name: "Recurrentes" });
  // Crons sanos: así el vigilante no se queja de ellos en los tests que miran otra cosa.
  seedDoc("system/cron_heartbeat", { "sync-all-pending": { last_ok_at: ago(60e3) }, "run-flows": { last_ok_at: ago(60e3) }, "retry-fulfillment": { last_ok_at: ago(60e3) }, "reconcile-mp": { last_ok_at: ago(60e3) } });
  sent = []; _resetAdminPhoneCache(); fakeGraph();
});

test("logError guarda el error sin secretos y recentErrors lo devuelve por tipo", async () => {
  await logError("checkout/init", new Error("MP 401 con token APP_USR-123456-abc"), { kind: "checkout", merchantId: MID, now: NOW });
  await logError("email", Object.assign(new Error("Resend 500"), { status: 500 }), { kind: "email", now: NOW - 60e3 });
  await logError("x", new Error("viejo"), { kind: "other", now: NOW - 3 * 86400e3 });
  const all = rawList("system_errors").map(d => d.data);
  assert.equal(all.length, 3);
  const co = all.find(e => e.kind === "checkout");
  assert.ok(!co.message.includes("APP_USR-123456"), "el token no queda en el registro");
  assert.ok(co.message.includes("[secreto]"));
  assert.equal(co.merchant_id, MID);
  const rec = await recentErrors({ now: NOW, sinceMs: 24 * H });
  assert.equal(rec.length, 2, "el de hace 3 días no entra en las 24 h");
  assert.equal(rec[0].kind, "checkout", "más nuevo primero");
  assert.deepEqual(countByKind(rec), { checkout: 1, email: 1 });
  assert.equal(scrubMessage("Bearer abc.def shpat_abcdef"), "[secreto] [secreto]");
});

test("withErrorLog: un throw en el handler queda registrado y el comprador recibe JSON 500, no un 500 pelado", async () => {
  const h = withErrorLog(async () => { throw new Error("boom"); }, { where: "checkout/init", kind: "checkout" });
  let status = 0, body = null;
  const res = { headersSent: false, status(c) { status = c; return this; }, json(o) { body = o; return this; } };
  await h({ method: "POST", body: { merchant_id: MID }, query: {} }, res);
  assert.equal(status, 500);
  assert.match(body.error, /Probá de nuevo/);
  const all = rawList("system_errors").map(d => d.data);
  assert.equal(all.length, 1);
  assert.equal(all[0].kind, "checkout"); assert.equal(all[0].merchant_id, MID); assert.equal(all[0].message, "boom");
});

test("ráfaga de errores de checkout → UN WhatsApp al admin; sigue roto → nada; se arregla → 'volvió'", async () => {
  for (let i = 0; i < CHECKOUT_MIN; i++) await logError("checkout/init", new Error("MP 500"), { kind: "checkout", merchantId: MID, now: NOW - i * 60e3 });
  const r1 = await runWatchdog({ now: NOW, minute: 10 });
  assert.equal(r1.ok, true);
  assert.deepEqual(r1.alerted, ["checkout_failing"]);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /Checkout fallando/);
  assert.match(textOf(sent[0]), /3 compradores/);
  const st = rawGet("system/watchdog");
  assert.ok(st.checkout_failing.alerted_at);

  // 5 min después sigue roto: no repite el aviso.
  const r2 = await runWatchdog({ now: NOW + 5 * 60e3, minute: 15 });
  assert.deepEqual(r2.alerted, []); assert.equal(sent.length, 1);

  // 20 min después ya no hay errores en los últimos 10 min: avisa que volvió y limpia el estado.
  seedDoc("system/cron_heartbeat", { "sync-all-pending": { last_ok_at: new Date(NOW + 19 * 60e3).toISOString() }, "run-flows": { last_ok_at: new Date(NOW + 19 * 60e3).toISOString() }, "retry-fulfillment": { last_ok_at: ago(60e3) }, "reconcile-mp": { last_ok_at: ago(60e3) } });
  const r3 = await runWatchdog({ now: NOW + 20 * 60e3, minute: 30 });
  assert.deepEqual(r3.recovered, ["checkout_failing"]);
  assert.equal(sent.length, 2);
  assert.match(textOf(sent[1]), /Volvió a andar/);
  assert.match(textOf(sent[1]), /Checkout fallando/);
  assert.equal(rawGet("system/watchdog").checkout_failing, undefined);
});

test("menos de 3 errores de checkout en 10 min no es ráfaga; mails y WhatsApps rebotando sí avisan a los 3 en 1 h", () => {
  const errs = [
    { kind: "checkout", at: ago(60e3), message: "a" }, { kind: "checkout", at: ago(30 * 60e3), message: "b" }, { kind: "checkout", at: ago(2 * 60e3), message: "c" },
    { kind: "email", at: ago(5 * 60e3), message: "Resend 500" }, { kind: "email", at: ago(40 * 60e3), message: "x" }, { kind: "email", at: ago(50 * 60e3), message: "y" },
    { kind: "whatsapp", at: ago(5 * 60e3), message: "190" }, { kind: "whatsapp", at: ago(6 * 60e3), message: "190" },
  ];
  const b = checkErrorBursts(errs, NOW);
  assert.deepEqual(b.map(x => x.key), ["email_failing"], "checkout: 2 en 10 min no alcanza; whatsapp: 2 en 1 h tampoco");
});

test("cron obligatorio atrasado → aviso; los 'soft' y los que nunca corrieron no", () => {
  const hb = { "sync-all-pending": { last_ok_at: ago(40 * 60e3) }, "run-flows": { last_ok_at: ago(60e3) }, "stock-watch": { last_ok_at: ago(5 * H) } };
  const b = checkCrons(hb, NOW);
  assert.deepEqual(b.map(x => x.key), ["cron_stale:sync-all-pending"]);
  assert.match(b[0].detail, /40 min/);
});

test("chequeos horarios: token de MP vencido y widget que no se ve hace 24 h avisan por tienda; internas, archivadas y pausadas no", async () => {
  seedDoc("merchants/t_tok", { store_name: "Tienda Token", mp_token_invalid_at: ago(2 * H) });
  seedDoc("merchants/t_widget", { store_name: "Tienda Widget", widget_verified_at: ago(10 * 86400e3), widget_last_seen_at: ago(30 * H) });
  seedDoc("merchants/t_widget_ok", { store_name: "Tienda OK", widget_verified_at: ago(10 * 86400e3), widget_last_seen_at: ago(2 * H) });
  seedDoc("merchants/t_interna", { store_name: "Demo", internal: true, widget_verified_at: ago(10 * 86400e3), widget_last_seen_at: ago(90 * H), mp_token_invalid_at: ago(H) });
  seedDoc("merchants/t_arch", { store_name: "Vieja", archived_at: ago(H), mp_token_invalid_at: ago(H) });
  seedDoc("merchants/t_pausa", { store_name: "Pausada", sales_paused: true, widget_verified_at: ago(10 * 86400e3), widget_last_seen_at: ago(90 * H) });
  const r = await runWatchdog({ now: NOW, hourly: true });
  assert.deepEqual(r.alerted.sort(), ["mp_token_invalid:t_tok", "widget_down:t_widget"]);
  assert.equal(sent.length, 2);
  const txt = sent.map(textOf).join("\n");
  assert.match(txt, /Tienda Token/); assert.match(txt, /Tienda Widget/);
  assert.ok(!/Demo|Vieja|Pausada|Tienda OK/.test(txt));

  // La pasada de 5 min (no horaria) NO cierra lo horario aunque no lo vuelva a mirar.
  const r2 = await runWatchdog({ now: NOW + 5 * 60e3, minute: 20 });
  assert.deepEqual(r2.recovered, []);
  assert.equal(r2.open, 2);

  // La tienda reconectó MP: la próxima pasada horaria avisa que volvió.
  seedDoc("merchants/t_tok", { store_name: "Tienda Token", mp_token_invalid_at: null });
  const r3 = await runWatchdog({ now: NOW + H, hourly: true });
  assert.deepEqual(r3.recovered, ["mp_token_invalid:t_tok"]);
  assert.match(textOf(sent[sent.length - 1]), /Volvió a andar/);
});

test("webhook de MP mudo 24 h con suscripciones activas → aviso; sin activas, no", async () => {
  seedDoc("system/webhooks_last", { mp: { last_at: ago(30 * H) } });
  let r = await runWatchdog({ now: NOW, hourly: true });
  assert.deepEqual(r.alerted, [], "sin suscripciones activas no hay nada que esperar");
  seedDoc(`merchants/${MID}/subscribers/s1`, subscriber({ status: "active" }));
  r = await runWatchdog({ now: NOW, hourly: true });
  assert.deepEqual(r.alerted, ["webhook_silent"]);
  assert.match(textOf(sent[0]), /30 h/);
});

test("el vigilante nunca lanza y todos sus eventos tienen etiqueta en el ramal admin", async () => {
  for (const ev of ["checkout_failing", "email_failing", "whatsapp_failing", "cron_stale", "webhook_silent", "mp_token_invalid", "widget_down", "order_failed", "recovered", "daily_summary"]) assert.ok(ADMIN_EVENT_LABEL[ev], ev);
  const r = await runWatchdog({ now: NaN, minute: 0 });
  assert.ok(r && typeof r.ok === "boolean");
});

test("resumen diario: cuenta los cobros, órdenes, altas y carritos de AYER sin las tiendas internas, y lo manda una vez", async () => {
  // NOW = 9-oct 12:00 AR → ayer = 8-oct (00:00–24:00 AR = 03:00Z del 8 a 03:00Z del 9).
  const ayer = (h) => new Date(Date.parse("2026-10-08T03:00:00.000Z") + h * H).toISOString();
  seedDoc(`merchants/${MID}/charges/p1`, { mp_payment_id: "p1", status: "approved", amount_ars: 10000, shopify_order_id: "o1", created_at: ayer(10) });
  seedDoc(`merchants/${MID}/charges/p2`, { mp_payment_id: "p2", status: "approved", amount_ars: 5000, shopify_order_id: null, error: "Shopify 500", created_at: ayer(12) });
  seedDoc(`merchants/${MID}/charges/p3`, { mp_payment_id: "p3", status: "rejected", amount_ars: 5000, created_at: ayer(13) });
  seedDoc(`merchants/${MID}/charges/p_hoy`, { mp_payment_id: "p4", status: "approved", amount_ars: 99999, shopify_order_id: "o4", created_at: ayer(25) });
  seedDoc(`merchants/${MID}/subscribers/a1`, subscriber({ status: "active", created_at: ayer(11) }));
  seedDoc(`merchants/${MID}/subscribers/c1`, subscriber({ status: "pending", created_at: ayer(15) }));
  seedDoc(`merchants/${MID}/subscribers/c_hoy`, subscriber({ status: "pending", created_at: ayer(26) }));
  seedDoc("merchants/demo_int", { store_name: "Demo", internal: true });
  seedDoc("merchants/demo_int/charges/d1", { mp_payment_id: "d1", status: "approved", amount_ars: 777777, shopify_order_id: "x", created_at: ayer(10) });
  await logError("webhook", new Error("x"), { kind: "webhook", now: Date.parse(ayer(5)) });
  const s = await buildDailySummary({ now: NOW });
  assert.equal(s.day, "2026-10-08");
  assert.equal(s.approved, 2); assert.equal(s.total, 15000); assert.equal(s.sin_orden, 1); assert.equal(s.rechazados, 1);
  assert.equal(s.altas, 1); assert.equal(s.carritos, 1); assert.equal(s.errors, 1);
  assert.match(s.text, /Ayer 08\/10: 2 cobros aprobados por \$15\.000/);
  assert.match(s.text, /SIN ORDEN 1/);
  assert.match(s.text, /altas 1 \(LuminaLabs 1\)/);
  assert.ok(!s.text.includes("777"), "la tienda interna no suma");
  assert.ok(s.text.length <= 900);

  const r = await dailySummary({ now: NOW });
  assert.equal(r.ok, true); assert.equal(r.sent, true);
  assert.equal(sent.length, 1);
  assert.match(textOf(sent[0]), /Resumen de ayer/);
  const r2 = await dailySummary({ now: NOW });
  assert.equal(sent.length, 1, "el mismo día no se manda dos veces");
  assert.equal(r2.ok, true);
});

test("pruneErrors borra solo lo de más de 30 días", async () => {
  await logError("a", new Error("viejo"), { now: NOW - 40 * 86400e3 });
  await logError("b", new Error("nuevo"), { now: NOW - 86400e3 });
  assert.equal(await pruneErrors(NOW), 1);
  assert.equal(rawList("system_errors").length, 1);
});
