// (t) Recordatorio de la demo, 2 h antes (api/_lib/demoReminder.js).
//
// Lo que protege: que salga UNA sola vez (con el cron cada 10 min, un flag mal
// puesto son 12 mails al mismo cliente), que no le llegue a alguien cuya
// llamada ya pasó, y que sin CALENDLY_TOKEN todo siga andando sin recordatorio
// en vez de romperse.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const R = await loadApi("api/_lib/demoReminder.js");

const AHORA = Date.parse("2026-09-28T13:00:00.000Z");
const enMin = (m) => new Date(AHORA + m * 60000).toISOString();
const lead = (id, extra = {}) => seedDoc(`demo_leads/${id}`, {
  id, nombre: "Ana Díaz", marca: "Glow Derm", email: "ana@glowderm.test",
  status: "agendado", created_at: enMin(-600), ...extra,
});

let W;
beforeEach(() => { W = createWorld(); delete process.env.CALENDLY_TOKEN; });
afterEach(() => { W.router.assertClean(); delete process.env.CALENDLY_TOKEN; });

test("(t) manda el recordatorio de la demo que es en 90 minutos", async () => {
  lead("dl_1", { meeting_at: enMin(90), meeting_url: "https://meet.google.com/abc-defg-hij" });
  const r = await R.enviarRecordatorios({ now: AHORA });
  assert.equal(r.enviados, 1, JSON.stringify(r));
  const m = W.resend.toCustomer().at(-1);
  assert.match(m.subject, /Nos vemos hoy a las/);
  assert.ok(m.html.includes("meet.google.com/abc-defg-hij"), "lleva el link del Meet");
  assert.ok(m.html.includes("Ana"), "lo saluda por su nombre");
  assert.ok(rawGet("demo_leads/dl_1").reminder_sent_at, "queda marcado");
});

test("(t) no se manda dos veces aunque el cron pase de nuevo", async () => {
  lead("dl_2", { meeting_at: enMin(80) });
  await R.enviarRecordatorios({ now: AHORA });
  const despues = W.resend.toCustomer().length;
  const r2 = await R.enviarRecordatorios({ now: AHORA + 600000 });
  assert.equal(r2.enviados, 0, "la segunda corrida no manda nada");
  assert.equal(W.resend.toCustomer().length, despues);
});

test("(t) todavía no: la demo es mañana", async () => {
  lead("dl_3", { meeting_at: enMin(60 * 20) });
  const r = await R.enviarRecordatorios({ now: AHORA });
  assert.equal(r.enviados, 0);
  assert.equal(rawGet("demo_leads/dl_3").reminder_sent_at, undefined);
});

test("(t) una llamada que ya pasó hace rato no recibe 'nos vemos en un rato'", async () => {
  // Si el cron estuvo caído, al volver no puede mandar recordatorios de ayer.
  lead("dl_4", { meeting_at: enMin(-90) });
  const r = await R.enviarRecordatorios({ now: AHORA });
  assert.equal(r.enviados, 0);
});

test("(t) si el mail falla igual se marca: nunca 12 reintentos al mismo cliente", async () => {
  W.resend.failNext?.();
  lead("dl_5", { meeting_at: enMin(45) });
  await R.enviarRecordatorios({ now: AHORA });
  assert.ok(rawGet("demo_leads/dl_5").reminder_sent_at, "queda marcado aunque no haya salido");
});

test("(t) la hora se muestra en horario de Argentina, no en UTC", () => {
  // 13:00 UTC = 10:00 en Buenos Aires. Mostrar UTC sería mandarlo a hacer la cuenta.
  assert.equal(R.horaAR("2026-09-28T13:00:00.000Z"), "10:00");
  assert.equal(R.horaAR("nada"), "");
});

test("(t) sin CALENDLY_TOKEN no se resuelve la hora, pero no se rompe nada", async () => {
  assert.equal(await R.leerEventoCalendly("https://api.calendly.com/scheduled_events/abc123"), null);
});

test("(t) con token, lee la hora y el link del Meet; un URI raro se ignora", async () => {
  process.env.CALENDLY_TOKEN = "tok";
  const fetchImpl = async (u, o) => {
    assert.equal(o.headers.Authorization, "Bearer tok");
    return { ok: true, json: async () => ({ resource: { start_time: "2026-09-28T16:00:00.000Z", location: { join_url: "https://meet.google.com/xyz" } } }) };
  };
  const ev = await R.leerEventoCalendly("https://api.calendly.com/scheduled_events/abc123", { fetchImpl });
  assert.deepEqual({ s: ev.startsAt, m: ev.meetUrl }, { s: "2026-09-28T16:00:00.000Z", m: "https://meet.google.com/xyz" });

  // Un URI que no sea de Calendly no se consulta: sería mandarle el token a otro.
  let llamado = false;
  await R.leerEventoCalendly("https://evil.test/scheduled_events/abc", { fetchImpl: async () => { llamado = true; return { ok: true, json: async () => ({}) }; } });
  assert.equal(llamado, false, "no se llama a un dominio que no sea la API de Calendly");
});
