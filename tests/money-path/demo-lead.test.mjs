// (r) Pedido de demo (api/public.js ?action=demo-lead) — la puerta de entrada
// desde el 25-sept-2026.
//
// Lo que protege: que el formulario sea de verdad un filtro (sin aceptar los
// USD 100 no entra nada), que el lead quede guardado aunque el aviso falle, y
// que cada envío mande RegistroCalificado a NUESTRO pixel con el anuncio del
// que vino. Ese evento es por el que se optimiza la pauta: si deja de salir, la
// campaña se queda sin conversión que perseguir.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet, rawPaths } from "../helpers/fake-firestore.mjs";

const handler = (await loadApi("api/public.js")).default;
const { sanitizeDemoLead, DEMO_CONFIRMACIONES, DEMO_PREGUNTAS, resumenDemoLead } = await loadApi("shared/platform/demoLead.js");
const { normalizeWhatsapp, EMAIL_RE } = await loadApi("shared/platform/contact.js");

const OK = {
  nombre: "Ana Díaz", marca: "Glow Derm", whatsapp: "2664 006599", email: "ana@glowderm.test",
  pedidos: "5_15", objetivo: "recompra", recurrencia: "25_50",
  confirma_llamada: true, confirma_pago: true,
};
const post = (body) => invoke(handler, { method: "POST", query: { action: "demo-lead" }, body });
const leads = () => rawPaths().filter((p) => p.startsWith("demo_leads/"));

let W, meta;
beforeEach(() => {
  W = createWorld();
  meta = [];
  W.router.on("POST", "graph.facebook.com", /\/events$/, (call) => { meta.push(call); return { json: { events_received: 1 } }; });
  process.env.META_PIXEL_ID = "px_rec"; process.env.META_CAPI_TOKEN = "tok_rec";
});
afterEach(() => { delete process.env.META_PIXEL_ID; delete process.env.META_CAPI_TOKEN; W.router.assertClean(); });

test("(r) un pedido completo queda guardado y manda RegistroCalificado con el anuncio", async () => {
  const res = await post({ ...OK, attribution: { utm_source: "meta", utm_content: "VIDEO_1", fbclid: "abc123" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(/^dl_/.test(res.body.id), "devuelve el id del lead");

  const lead = rawGet(`demo_leads/${res.body.id}`);
  assert.equal(lead.marca, "Glow Derm");
  assert.equal(lead.whatsapp, "+5492664006599", "el WhatsApp se normaliza igual que en el registro");
  assert.equal(lead.pedidos, "5_15");
  assert.equal(lead.status, "nuevo");
  assert.equal(lead.acquisition.utm_content, "VIDEO_1");
  assert.ok(lead.acquisition.fbc.endsWith(".abc123"), "arma el fbc con el fbclid, como la landing");

  assert.equal(meta.length, 1, "un solo evento");
  const ev = meta[0].json.data[0];
  assert.equal(ev.event_name, "RegistroCalificado");
  assert.equal(ev.event_id, `acq_qualified_${res.body.id}`, "mismo id que manda el navegador: Meta deduplica");
  assert.equal(ev.custom_data.ad_name, "VIDEO_1", "sin esto no se puede comparar creativo contra creativo");
  // PII hasheada, nunca en claro.
  assert.ok(/^[0-9a-f]{64}$/.test(ev.user_data.em[0]));
  assert.ok(/^[0-9a-f]{64}$/.test(ev.user_data.ph[0]));
  assert.ok(!JSON.stringify(ev).includes("ana@glowderm.test"));
});

test("(r) sin aceptar los USD 100 no entra: ni lead, ni evento", async () => {
  const res = await post({ ...OK, confirma_pago: false });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /casillas/);
  assert.equal(meta.length, 0, "no se manda conversión de alguien que no calificó");
  assert.deepEqual(leads(), [], "no se guarda nada de quien no aceptó");
});

test("(r) la misma validación corre en el navegador y en el servidor", () => {
  // Si se separan, el visitante ve un formulario que el backend rechaza.
  const args = { emailRe: EMAIL_RE, normalizeWhatsapp };
  assert.ok(sanitizeDemoLead(OK, args).value);
  assert.match(sanitizeDemoLead({ ...OK, email: "no-es-mail" }, args).error, /email/i);
  assert.match(sanitizeDemoLead({ ...OK, pedidos: "" }, args).error, /pedidos/i);
  assert.match(sanitizeDemoLead({ ...OK, recurrencia: "cualquiera" }, args).error, /clientes recurrentes/i);
  assert.match(sanitizeDemoLead({ ...OK, whatsapp: "123" }, args).error, /WhatsApp/);
  assert.match(sanitizeDemoLead({ ...OK, marca: "" }, args).error, /marca/i);
  assert.equal(DEMO_CONFIRMACIONES.length, 2, "las dos casillas son el filtro entero");
});

test("(r) el aviso repite cada pregunta con su respuesta, en una sola línea", () => {
  // Thiago las lee por WhatsApp, y Meta APLASTA los saltos de línea dentro de
  // una variable de plantilla: si el resumen los usara como separador, le
  // llegaría todo pegado y sin poder distinguir qué contestó a qué.
  const r = resumenDemoLead({ ...OK, objetivo: "ticket" });
  assert.ok(!/[\r\n\t]/.test(r), "sin saltos de línea: no sobreviven a la plantilla");
  for (const q of DEMO_PREGUNTAS) assert.ok(r.includes(q.label), `falta la pregunta: ${q.label}`);
  assert.match(r, /¿Cuántos pedidos vendés por día\? Entre 5 y 15 por día/);
  assert.match(r, /¿Cuál es tu tasa de clientes recurrentes hoy\? Entre el 25% y el 50%/);
  assert.match(r, /¿Qué querés lograr con las suscripciones\? Vender packs más grandes/);
  assert.match(r, /USD 100 de la integración\? SÍ/);
  // Entra en el tope de la variable de plantilla de Meta (1024) con lugar de sobra.
  assert.ok(r.length < 400, `el resumen quedó largo: ${r.length}`);
});

test("(r) si el aviso a Thiago falla, el lead NO se pierde", async () => {
  // Sin WhatsApp de plataforma ni Resend configurados, notifyAdmin no manda nada.
  // El endpoint tiene que responder ok igual: perder el aviso es malo, perder el
  // lead es peor (es alguien que ya dijo que paga).
  const res = await post({ ...OK, email: "otra@marca.test" });
  assert.equal(res.statusCode, 200);
  assert.ok(rawGet(`demo_leads/${res.body.id}`), "el lead quedó guardado");
});

test("(r) sin pixel configurado el lead entra igual (no se pierde por falta de env)", async () => {
  delete process.env.META_PIXEL_ID; delete process.env.META_CAPI_TOKEN;
  const res = await post(OK);
  assert.equal(res.statusCode, 200);
  assert.ok(rawGet(`demo_leads/${res.body.id}`));
  assert.equal(meta.length, 0);
});

test("(r) GET no crea nada", async () => {
  const res = await invoke(handler, { method: "GET", query: { action: "demo-lead" } });
  assert.equal(res.statusCode, 405);
  assert.equal(meta.length, 0);
});

// ─── Agendó: el embed de Calendly avisa y se marca el lead ────────────────
// 26-sept-2026. El calendario quedó DENTRO de #/demo, así que cuando alguien
// elige horario el navegador nos avisa. Sin esto no había forma de saber quién
// llenó el formulario y no reservó — que es justo la gente a la que hay que
// escribirle.
const booked = (body) => invoke(handler, { method: "POST", query: { action: "demo-booked" }, body });

test("(r) al agendar, el lead queda marcado y sale DemoAgendada", async () => {
  const res = await post({ ...OK, attribution: { utm_source: "meta", utm_content: "VIDEO_1" } });
  const id = res.body.id;
  meta.length = 0;

  const b = await booked({ lead_id: id });
  assert.equal(b.statusCode, 200);
  const lead = rawGet(`demo_leads/${id}`);
  assert.equal(lead.status, "agendado");
  assert.ok(lead.booked_at);
  assert.equal(meta.length, 1);
  assert.equal(meta[0].json.data[0].event_name, "DemoAgendada");
  assert.equal(meta[0].json.data[0].event_id, `acq_booked_${id}`, "id propio: no se pisa con el del formulario");
  assert.equal(meta[0].json.data[0].custom_data.ad_name, "VIDEO_1", "se sabe qué anuncio trajo la reserva");
});

test("(r) avisar dos veces no cuenta la reserva dos veces", async () => {
  const res = await post({ ...OK, email: "otra2@marca.test" });
  meta.length = 0;
  await booked({ lead_id: res.body.id });
  const dup = await booked({ lead_id: res.body.id });
  assert.equal(dup.statusCode, 200);
  assert.equal(dup.body.ya, true);
  assert.equal(meta.length, 1, "un solo evento a Meta");
});

test("(r) un lead_id inventado no crea nada", async () => {
  meta.length = 0;
  assert.equal((await booked({ lead_id: "dl_noexiste123" })).statusCode, 404);
  assert.equal((await booked({ lead_id: "../../merchants/lumina" })).statusCode, 400);
  assert.equal((await booked({})).statusCode, 400);
  assert.equal(meta.length, 0);
});
