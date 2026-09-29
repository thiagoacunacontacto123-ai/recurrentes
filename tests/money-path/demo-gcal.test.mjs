// (t) Reserva de la demo directo en Google Calendar, sin Calendly
// (api/_lib/gcal.js, shared/platform/demoSlots.js, public.js demo-slots / demo-book).
//
// Lo que protege: que los horarios respeten la franja, los ocupados del calendario
// y las 2 h de anticipación; que reservar cree el evento con Meet e invite al
// cliente; que el lead quede igual que con Calendly (meeting_at / meeting_url) para
// que el recordatorio de 2 h siga andando; y que sin env todo diga "apagado" en vez
// de romper.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";
import { invoke } from "../helpers/http.mjs";

const { default: handler } = await loadApi("api/public.js");
const G = await loadApi("api/_lib/gcal.js");
const S = await loadApi("shared/platform/demoSlots.js");

const TEST_KEY = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpgIBAAKCAQEA0/F2z5yzabnUJNnQqEyBmIrPN+cCscL7DlrtSMrXDVstbrYE\n38R3rZ6JPdwxElt/K18V4e8obCElqjQnVa7AKBKSpN0kYrxkL/tad0RAME3j1r97\nA8xcEL/mqEFSYVDc6Ft8a4NmpIJKYocw5/Re9yTEn0/Z2gTAy40NiuYrj+mfNX6w\n6cfZHCWkJX/XHnr7OkkqRtIYJvcsPpGm26gyB9ri3v1EHMfAOneBjcFSgnCNdCqL\n5N/utJf/MECfn0km8tS51IgXWpdVa/GSCuda6AeDgCeJGqdhTmaG2CHQ0awkFic1\nVv79cdZE6BCinhpjfxr077XktHfAub+8Yl/wzQIDAQABAoIBAQClelUaei22samK\ncCozDTDuSgrKieqXojXkmmfDuuO3gOXzF9isYbhTbYGYM/B4dcnPsjjio5j6+9Jt\nlrTTeFJ9tyqZ4DPFh3Pt5qFWl4pKbLYkeHJyn7+OMFbGLeJFKx6fqLZ3NywP685q\nKUWtBSaUbje6b10XlTh2dRYKyfVfMUu+OfrdPnsmg05Y5GJ5ZSxm2AZsZI2QYRPw\nXqhcfImdx/XkXT1dDDE9gZOikDyxITsjA9wFLgxKh2HzMkeizJkux0JyxUvsliCd\n71tWROwGBRoEJ1cPV40md71DkmZKnlK6MqFgTfR9B8raOd2EsPyh6kBQlBbNlh9p\nV3fQPdp9AoGBAPRlXrWpnXXI+UV7pkbJ3BU1THoUG9P3nrQ7a8H42FBYw5bh3g3k\nxpOFH/GNtz4ZtMjhOTfLA9NJFRaNHY5WyiVKx0Egq4wdG5eAo/tkAAyw8jew5/KU\nVjWjOwmCz6IQvBD5v1iZNIzSw6Fha8Wlwrb857Mx+I8p0k6uaL/T7GE7AoGBAN4B\noZwG4REOG/XmKF/q1qIeR74MpOBDyOUw8BFeAIunv6kQQLp7f2eV5NejSKqVTQO0\nu7Dcqtrc7TnIktDmGGoZCfAvTXGcOHCqxOY8rYyRdlg+7eHoKxM2twU5WIRj8sto\n8fzvqhD9EX0Y++g6p7SotYjXDtJS4gRlRRR2XlWXAoGBAOYbH545cfj5XcHPFxJl\ncuNBCJ2Um1LrPTEDFYVPkBOuT5GbXmCEe3dgC2B6hwJgX7gXXrEqY5Kmp8VQ3ngr\nPS75hjvKz9ofeeAejcbfM7C/VX+b//eFNNpRsv9Ue7xitz/gdgmsTi8dLnae7ELu\nvDNgUaOFtDrPLKVKT3P1zAULAoGBAKsC0K1ysx5DIxCpCULRkCHzd0oTTVIfhPnf\nV53ZLkxlnIKrrWC4zuxJD6137vrP5TJMnyPe55GOCwKu2UEnbXkU7o3gsiQotWU8\ndk3wQbN9PY8+clnJUJ0NUbApe2EH6Lf9kCJJr1REzJrziuBZhmPobWYKWzVyeP3v\n0GWxxHrjAoGBAJz/WIPGXG67jtKFwe9xOl7OCpBnuDBeuMKonfSVT8O6N7lfXiuu\nDcdbLWiicxeFKnERfOQeKktN+OxXMhToq3AlaKU417DEqoxhds7htVFcjbvzkvHZ\nXgY6Ama9TdAmiebNN/xUC+t4JTbzhYKuyxcJvsO6iVlwhVR9b/M/PrrI\n-----END RSA PRIVATE KEY-----\n";
// Lunes 28-sept-2026 10:00 AR (13:00Z).
const AHORA = Date.parse("2026-09-28T13:00:00.000Z");
const enMin = (m) => new Date(AHORA + m * 60000).toISOString();
// El reloj queda clavado en AHORA: los horarios de este archivo son fijos y sin
// esto la suite empezaba a fallar sola al día siguiente (las 2 h de anticipación).
const RELOJ_REAL = Date.now;

let W, gcal;
beforeEach(() => {
  W = createWorld();
  Date.now = () => AHORA;
  G._resetGcalCache();
  process.env.GCAL_IMPERSONATE = "thiago@recurrentesapp.com";
  process.env.GCAL_CLIENT_EMAIL = "sa@test.iam.gserviceaccount.com";
  process.env.GCAL_PRIVATE_KEY = TEST_KEY;
  delete process.env.DEMO_HOURS;
  gcal = { tokens: 0, busy: [], events: [] };
  W.router.on("POST", "oauth2.googleapis.com", /\/token$/, (call) => {
    gcal.tokens++;
    const params = new URLSearchParams(call.body);
    const jwt = params.get("assertion");
    const payload = JSON.parse(Buffer.from(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    gcal.lastJwt = payload;
    return { json: { access_token: "ya29.test", expires_in: 3600 } };
  });
  W.router.on("POST", "www.googleapis.com", /\/calendar\/v3\/freeBusy$/, (call) => {
    gcal.freeBusyReq = call.json;
    return { json: { calendars: { "thiago@recurrentesapp.com": { busy: gcal.busy } } } };
  });
  W.router.on("POST", "www.googleapis.com", /\/calendar\/v3\/calendars\/[^/]+\/events$/, (call) => {
    gcal.events.push(call);
    return { json: { id: "ev_1", htmlLink: "https://calendar.google.com/event?eid=1", hangoutLink: "https://meet.google.com/abc-defg-hij" } };
  });
});
afterEach(() => {
  Date.now = RELOJ_REAL;
  W.router.assertClean();
  for (const k of ["GCAL_IMPERSONATE", "GCAL_CLIENT_EMAIL", "GCAL_PRIVATE_KEY", "DEMO_HOURS"]) delete process.env[k];
});

const lead = (id = "dl_abc123", extra = {}) => seedDoc(`demo_leads/${id}`, {
  id, nombre: "Ana Díaz", marca: "Glow Derm", email: "ana@glowderm.test", whatsapp: "+5492664006599",
  pedidos: "5_15", objetivo: "recompra", recurrencia: "25_50", status: "nuevo", created_at: enMin(-5), ...extra,
});

test("(t) horarios: lunes a viernes de 10 a 18, cada 15, sin los ocupados ni los de las próximas 2 h", () => {
  const busy = [{ start: "2026-09-28T16:00:00.000Z", end: "2026-09-28T16:30:00.000Z" }]; // 13:00–13:30 AR
  const slots = S.availableSlots({ now: AHORA, busy, horizonDays: 2 });
  assert.ok(slots.length > 0);
  assert.ok(!slots.includes("2026-09-28T13:00:00.000Z"), "ahora mismo no");
  assert.ok(!slots.includes("2026-09-28T14:45:00.000Z"), "menos de 2 h: no");
  assert.ok(slots.includes("2026-09-28T15:00:00.000Z"), "12:00 AR sí (2 h justas)");
  assert.ok(!slots.includes("2026-09-28T16:00:00.000Z") && !slots.includes("2026-09-28T16:15:00.000Z"), "ocupado 13:00–13:30 AR");
  assert.ok(slots.includes("2026-09-28T15:45:00.000Z"), "12:45 termina justo a las 13:00: entra");
  assert.ok(slots.includes("2026-09-28T16:30:00.000Z"), "13:30 AR libre");
  assert.ok(slots.includes("2026-09-28T20:45:00.000Z"), "17:45 AR es el último del día");
  assert.ok(!slots.includes("2026-09-28T21:00:00.000Z"), "18:00 AR ya no");
  assert.ok(!slots.includes("2026-09-28T12:00:00.000Z"), "antes de las 10 AR no");
  assert.ok(slots.includes("2026-09-29T13:00:00.000Z"), "martes 10:00 AR sí");
});

test("(t) la franja se lee de DEMO_HOURS y el fin de semana queda afuera", () => {
  const rules = S.parseHours("1-5:10-13,6:10-12");
  const sab = Date.parse("2026-10-03T12:00:00.000Z"); // sábado 09:00 AR
  const slots = S.availableSlots({ now: sab, rules, horizonDays: 3 });
  assert.ok(slots.includes("2026-10-03T14:00:00.000Z"), "sábado 11:00 AR sí");
  assert.ok(!slots.includes("2026-10-03T15:00:00.000Z"), "sábado 12:00 AR ya no");
  assert.ok(!slots.some((s) => s.startsWith("2026-10-04")), "domingo nada");
  assert.ok(slots.includes("2026-10-05T13:00:00.000Z"), "lunes 10:00 AR sí");
  const dias = S.groupSlotsByDay(slots);
  assert.equal(dias[0].date, "2026-10-03");
  assert.equal(dias[0].slots[0].label, "11:00");
});

test("(t) demo-slots devuelve los libres con un token firmado en nombre de Thiago", async () => {
  const res = await invoke(handler, { method: "GET", query: { action: "demo-slots" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, true);
  assert.ok(res.body.slots.length > 10);
  assert.equal(res.body.duration_min, 15);
  assert.equal(gcal.lastJwt.sub, "thiago@recurrentesapp.com", "impersona al dueño del calendario");
  assert.equal(gcal.lastJwt.iss, "sa@test.iam.gserviceaccount.com");
  assert.equal(gcal.freeBusyReq.items[0].id, "thiago@recurrentesapp.com");
});

test("(t) sin GCAL_IMPERSONATE: enabled:false y ninguna llamada a Google", async () => {
  delete process.env.GCAL_IMPERSONATE;
  const res = await invoke(handler, { method: "GET", query: { action: "demo-slots" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, false);
  assert.equal(gcal.tokens, 0);
});

test("(t) demo-book crea el evento con Meet, invita al cliente y deja el lead como lo dejaba Calendly", async () => {
  lead();
  const { slots } = (await invoke(handler, { method: "GET", query: { action: "demo-slots" } })).body;
  const start = slots[0];
  const res = await invoke(handler, { method: "POST", query: { action: "demo-book" }, body: { lead_id: "dl_abc123", start } });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.meeting_at, start);
  assert.equal(res.body.meeting_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(gcal.events.length, 1);
  const ev = gcal.events[0];
  assert.equal(ev.query.conferenceDataVersion, "1");
  assert.equal(ev.query.sendUpdates, "all", "Google le manda la invitación al cliente");
  assert.equal(ev.json.attendees[0].email, "ana@glowderm.test");
  assert.equal(ev.json.conferenceData.createRequest.conferenceSolutionKey.type, "hangoutsMeet");
  assert.equal(ev.json.start.dateTime, start);
  assert.equal(Date.parse(ev.json.end.dateTime) - Date.parse(start), 15 * 60000);
  assert.match(ev.json.summary, /Glow Derm/);
  const l = rawGet("demo_leads/dl_abc123");
  assert.equal(l.status, "agendado");
  assert.equal(l.meeting_at, start, "misma clave que usa el recordatorio de 2 h");
  assert.equal(l.meeting_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(l.gcal_event_id, "ev_1");
  assert.ok(l.booked_at);
  assert.equal(gcal.tokens, 1, "el token se cachea entre llamadas");
});

test("(t) un horario ocupado o inventado se rechaza con 409 y no crea nada", async () => {
  lead();
  gcal.busy = [{ start: "2026-09-29T13:00:00.000Z", end: "2026-09-29T13:30:00.000Z" }];
  const r1 = await invoke(handler, { method: "POST", query: { action: "demo-book" }, body: { lead_id: "dl_abc123", start: "2026-09-29T13:00:00.000Z" } });
  assert.equal(r1.statusCode, 409);
  assert.equal(r1.body.field, "horario");
  const r2 = await invoke(handler, { method: "POST", query: { action: "demo-book" }, body: { lead_id: "dl_abc123", start: "2026-09-29T13:07:00.000Z" } });
  assert.equal(r2.statusCode, 409, "fuera de la grilla de 15");
  assert.equal(gcal.events.length, 0);
  assert.equal(rawGet("demo_leads/dl_abc123").booked_at, undefined);
});

test("(t) un horario que otro lead ya reservó no se ofrece aunque Google todavía no lo muestre ocupado", async () => {
  lead("dl_otro", { status: "agendado", booked_at: enMin(-1), meeting_at: "2026-09-29T13:00:00.000Z" });
  const { slots } = (await invoke(handler, { method: "GET", query: { action: "demo-slots" } })).body;
  assert.ok(!slots.includes("2026-09-29T13:00:00.000Z"));
  assert.ok(slots.includes("2026-09-29T13:15:00.000Z"));
});

test("(t) reservar dos veces el mismo lead no crea un segundo evento", async () => {
  lead("dl_yaagendado", { booked_at: enMin(-1), status: "agendado", meeting_at: "2026-09-29T13:00:00.000Z", meeting_url: "https://meet.google.com/x" });
  const res = await invoke(handler, { method: "POST", query: { action: "demo-book" }, body: { lead_id: "dl_yaagendado", start: "2026-09-29T14:00:00.000Z" } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ya, true);
  assert.equal(gcal.events.length, 0);
});

test("(t) si Google no responde, demo-slots dice apagado (el navegador cae a Calendly) y demo-book no marca nada", async () => {
  lead();
  W.router.failNext("POST", "www.googleapis.com", /freeBusy$/, { status: 500, json: { error: { message: "boom" } } }, 2);
  const r1 = await invoke(handler, { method: "GET", query: { action: "demo-slots" } });
  assert.equal(r1.body.enabled, false);
  assert.equal(r1.body.error, "calendar_unavailable");
  const r2 = await invoke(handler, { method: "POST", query: { action: "demo-book" }, body: { lead_id: "dl_abc123", start: "2026-09-29T13:00:00.000Z" } });
  assert.equal(r2.statusCode, 503);
  assert.equal(rawGet("demo_leads/dl_abc123").booked_at, undefined);
});
