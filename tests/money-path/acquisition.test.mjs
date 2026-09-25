// (q) Adquisición propia (api/_lib/acquisition.js): de qué anuncio vino cada cuenta y los
// 4 pasos (registro → tienda → plan → pago) a NUESTRO pixel de Meta por servidor.
// Una vez por paso y por cuenta; PII hasheada; internas y admins afuera; sin env no manda.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";
// Precio real del tramo: el test no se rompe si cambian los precios.
const { TIER_BY_ID } = await loadApi("shared/platform/pricing.js");
const STARTER = TIER_BY_ID.starter.usd;


const A = await loadApi("api/_lib/acquisition.js");
const HEX64 = /^[0-9a-f]{64}$/;
const req = { headers: { "x-forwarded-for": "200.1.2.3, 10.0.0.1", "user-agent": "Mozilla/5.0 (test)" } };

let W, meta;
beforeEach(() => {
  W = createWorld();
  meta = [];
  W.router.on("POST", "graph.facebook.com", /\/events$/, (call) => { meta.push(call); return { json: { events_received: 1 } }; });
  process.env.META_PIXEL_ID = "px_rec"; process.env.META_CAPI_TOKEN = "tok_rec"; delete process.env.META_TEST_EVENT_CODE;
  seedDoc("merchants/new_uid", { email: "nueva@tienda.test", owner_name: "Ana Pérez", owner_whatsapp: "+5491155550000", created_at: new Date().toISOString() });
});
afterEach(() => { delete process.env.META_PIXEL_ID; delete process.env.META_CAPI_TOKEN; W.router.assertClean(); });
const ev = (i = 0) => meta[i].json.data[0];

test("(q) guarda el anuncio de origen (solo claves conocidas) y manda CompleteRegistration hasheado, una sola vez", async () => {
  const saved = await A.recordAttribution("new_uid", { utm_source: "meta", utm_medium: "paid", utm_campaign: "lanzamiento", utm_content: "RC-A1-H2", fbclid: "abc123", fbp: "fb.1.1700000000.999", junk: "<script>", landing: "/?utm_source=meta" }, { req });
  const acq = rawGet("merchants/new_uid").acquisition;
  assert.equal(acq.utm_content, "RC-A1-H2");
  assert.equal(acq.junk, undefined, "no guarda claves desconocidas");
  assert.ok(acq.fbc.startsWith("fb.1.") && acq.fbc.endsWith(".abc123"), "arma el fbc a partir del fbclid");
  assert.equal(acq.ip, "200.1.2.3");
  assert.ok(acq.first_seen_at);
  assert.equal(saved.utm_campaign, "lanzamiento");

  const r = await A.trackAcquisition("new_uid", "registered", { req });
  assert.deepEqual({ ok: r.ok, sent: r.sent }, { ok: true, sent: true });
  assert.equal(meta.length, 1);
  assert.ok(meta[0].url.startsWith("https://graph.facebook.com/v21.0/px_rec/events?access_token=tok_rec"));
  const e = ev();
  assert.equal(e.event_name, "CompleteRegistration");
  assert.equal(e.event_id, "acq_registered_new_uid");
  assert.match(e.user_data.em[0], HEX64, "el mail va hasheado");
  assert.notEqual(e.user_data.em[0], "nueva@tienda.test");
  assert.match(e.user_data.ph[0], HEX64);
  assert.equal(e.user_data.fbp, "fb.1.1700000000.999");
  assert.equal(e.user_data.client_ip_address, "200.1.2.3");
  assert.equal(e.custom_data.currency, "USD");
  assert.equal(e.custom_data.ad_name, "RC-A1-H2");
  assert.equal(e.event_source_url, "https://www.recurrentesapp.com/?utm_source=meta");
  assert.ok(rawGet("merchants/new_uid").acquisition.registered_at);
  assert.equal(rawGet("merchants/new_uid").acquisition.meta_registered, "ok");

  const again = await A.trackAcquisition("new_uid", "registered", { req });
  assert.equal(again.skipped, "dup");
  assert.equal(meta.length, 1, "el mismo paso no se manda dos veces");
});

test("(q) primer toque gana: una segunda atribución no pisa el anuncio original", async () => {
  await A.recordAttribution("new_uid", { utm_source: "meta", utm_content: "RC-A1-H2" });
  await A.recordAttribution("new_uid", { utm_source: "google", utm_content: "otro" });
  const acq = rawGet("merchants/new_uid").acquisition;
  assert.equal(acq.utm_source, "meta");
  assert.equal(acq.utm_content, "RC-A1-H2");
});

test("(q) el pago manda Purchase con el precio del tramo en USD", async () => {
  const r = await A.trackAcquisition("new_uid", "paid", { tier: "starter" });
  assert.equal(r.sent, true);
  const e = ev();
  assert.equal(e.event_name, "Purchase");
  assert.equal(e.custom_data.value, STARTER);
  assert.equal(e.custom_data.currency, "USD");
  assert.deepEqual(e.custom_data.content_ids, ["starter"]);
  assert.ok(rawGet("merchants/new_uid").acquisition.paid_at);
});

test("(q) una tienda extra le acredita el paso al login que la creó", async () => {
  seedDoc("merchants/store2", { is_store: true, ownerUid: "new_uid", email: "nueva@tienda.test", created_at: new Date().toISOString() });
  const r = await A.trackAcquisition("store2", "store_connected", { req });
  assert.equal(r.sent, true);
  assert.equal(ev().event_name, "Lead");
  assert.equal(ev().event_id, "acq_store_connected_new_uid");
  assert.ok(rawGet("merchants/new_uid").acquisition.store_connected_at);
  assert.equal(rawGet("merchants/store2").acquisition, undefined);
});

test("(q) tiendas internas y admins no cuentan; sin env se anota el paso pero no se manda nada", async () => {
  seedDoc("merchants/mia", { internal: true, email: "mia@x.test", created_at: new Date().toISOString() });
  assert.equal((await A.trackAcquisition("mia", "registered")).skipped, "internal");
  assert.equal(rawGet("merchants/mia").acquisition, undefined);
  assert.equal(meta.length, 0);

  delete process.env.META_PIXEL_ID;
  const r = await A.trackAcquisition("new_uid", "first_plan");
  assert.deepEqual({ ok: r.ok, sent: r.sent }, { ok: true, sent: false });
  assert.ok(rawGet("merchants/new_uid").acquisition.first_plan_at);
  assert.equal(meta.length, 0);
});

test("(q) resumen para el Admin: por anuncio, con % y filtro de días", () => {
  const now = Date.parse("2026-09-19T12:00:00Z");
  const d = (n) => new Date(now - n * 86400e3).toISOString();
  const accounts = [
    { id: "a", created_at: d(1),  acquisition: { utm_source: "meta", utm_campaign: "lanz", utm_content: "RC-A1-H2", store_connected_at: d(1), first_plan_at: d(1), paid_at: d(0) } },
    { id: "b", created_at: d(5),  acquisition: { utm_source: "meta", utm_campaign: "lanz", utm_content: "RC-A1-H2", store_connected_at: d(4) } },
    { id: "c", created_at: d(10), acquisition: { utm_source: "meta", utm_campaign: "lanz", utm_content: "RC-B1-H1" } },
    { id: "d", created_at: d(40), acquisition: { referrer: "https://instagram.com/" } },
    { id: "e", created_at: d(2) }, // directo, sin nada
  ];
  const s30 = A.acquisitionSummary(accounts, { a: STARTER }, { days: 30, nowMs: now });
  assert.equal(s30.totals.registered, 4, "la cuenta de hace 40 días queda fuera de 30 días");
  assert.equal(s30.totals.paid, 1);
  assert.equal(s30.totals.usd_month, STARTER);
  const a1 = s30.by_ad.find(x => x.ad === "RC-A1-H2");
  assert.deepEqual({ r: a1.registered, c: a1.store_connected, p: a1.paid, pc: a1.pct_connected, pp: a1.pct_paid }, { r: 2, c: 2, p: 1, pc: 100, pp: 50 });
  assert.ok(s30.by_ad.some(x => x.ad === "(sin anuncio)" && x.registered === 1));
  const all = A.acquisitionSummary(accounts, { a: 49 }, { days: null, nowMs: now });
  assert.equal(all.totals.registered, 5);
  assert.ok(all.by_source.some(x => x.source === "referido" && x.registered === 1));
  assert.ok(all.by_source.some(x => x.source === "directo" && x.registered === 1));
});

// ─── El evento por el que se pauta ────────────────────────────────────────
// 25-sept-2026, Thiago: "la conversión tiene que ser una creada por nosotros, de
// las marcas que ponen que venden". Optimizar por registro traía al que registra
// barato: de los 4 leads del primer creativo, 3 contestaron "sin ventas".
test("(q) califica el que ya vende 50+ pedidos o el que paga la instalación", () => {
  assert.equal(A.leadCalifica({ lead_volumen: "sin_ventas", lead_instalacion: "solo" }), false);
  assert.equal(A.leadCalifica({ lead_volumen: "1_50", lead_instalacion: "solo" }), false);
  assert.equal(A.leadCalifica({ lead_volumen: "50_200" }), true, "100 pedidos/mes entra acá");
  assert.equal(A.leadCalifica({ lead_volumen: "1000_mas" }), true);
  // La instalación paga alcanza sola: nadie pone USD 100 "a ver qué onda".
  assert.equal(A.leadCalifica({ lead_volumen: "sin_ventas", lead_instalacion: "asistida" }), true);
  assert.equal(A.leadCalifica(null), false);
  assert.equal(A.leadCalifica({}), false);
});

test("(q) el paso 'qualified' va a Meta como SubmitApplication y no se manda dos veces", async () => {
  seedDoc("merchants/cal_uid", { email: "duena@marca.test", owner_name: "Ana Diaz", created_at: new Date().toISOString(), acquisition: { utm_source: "meta", utm_content: "RC-A1-H2" } });

  const r = await A.trackAcquisition("cal_uid", "qualified", { req });
  assert.deepEqual({ ok: r.ok, sent: r.sent }, { ok: true, sent: true });
  assert.equal(ev(0).event_name, "SubmitApplication");
  assert.equal(ev(0).custom_data.ad_name, "RC-A1-H2", "el anuncio viaja para poder comparar creativos");
  assert.ok(rawGet("merchants/cal_uid").acquisition.qualified_at);

  const dup = await A.trackAcquisition("cal_uid", "qualified", { req });
  assert.deepEqual({ ok: dup.ok, skipped: dup.skipped }, { ok: true, skipped: "dup" });
  assert.equal(meta.length, 1, "el mismo lead no se cuenta dos veces");
});

test("(q) el resumen del Admin cuenta los calificados por anuncio", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const d = (n) => new Date(now - n * 86400e3).toISOString();
  const accounts = [
    { id: "a", created_at: d(1), acquisition: { utm_source: "meta", utm_content: "VIDEO_1", qualified_at: d(1), store_connected_at: d(1) } },
    { id: "b", created_at: d(1), acquisition: { utm_source: "meta", utm_content: "VIDEO_1" } },
    { id: "c", created_at: d(1), acquisition: { utm_source: "meta", utm_content: "VIDEO_1" } },
    { id: "e", created_at: d(1), acquisition: { utm_source: "meta", utm_content: "VIDEO_1" } },
  ];
  const s = A.acquisitionSummary(accounts, {}, { days: 30, nowMs: now });
  assert.equal(s.totals.qualified, 1);
  assert.equal(s.totals.pct_qualified, 25, "1 de 4: es el número que hay que mirar, no los registros");
});
