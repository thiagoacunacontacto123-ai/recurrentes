// Ramal ADMIN del número de Recurrentes (api/_lib/adminAlerts.js): avisos internos a
// Thiago por WhatsApp (plantilla aviso_admin) con respaldo por mail. Firestore en
// memoria (helpers/world) y Meta falsa: ninguna llamada real.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";

process.env.ADMIN_EMAILS = "admin@recurrentes.test";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1319380847922196";
process.env.WHATSAPP_WABA_ID = "1377371627894423";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAtesttokenABCDEFGHIJKLMNOP1234567890";
delete process.env.ADMIN_WHATSAPP;
delete process.env.RESEND_API_KEY;

const adminAlerts = await loadApi("api/_lib/adminAlerts.js");
const { notifyAdmin, adminPhones, _resetAdminPhoneCache } = adminAlerts;
const { WA_ADMIN_TEMPLATE, WA_ALL_TEMPLATES } = await loadApi("shared/platform/whatsapp.js");
const { templateCreatePayload } = await loadApi("api/_lib/waTemplates.js");

// Meta falsa: registra cada POST /messages.
let sent = [];
let failNext = null;
function fakeGraph() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
    if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
    if (u.includes("/messages") && opts.method === "POST") {
      const body = JSON.parse(opts.body);
      if (failNext) { const e = failNext; failNext = null; return json(e, 400); }
      sent.push({ url: u, body });
      return json({ messaging_product: "whatsapp", contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.ADM${sent.length}`, message_status: "accepted" }] });
    }
    return json({ error: { message: "no mockeado " + u, code: 100 } }, 400);
  };
}

let W;
beforeEach(() => {
  W = createWorld({ merchant: luminaMerchant() });
  // La cuenta admin (login de Thiago) con su WhatsApp cargado en "Avisos para vos".
  seedDoc("merchants/admin_uid", { email: "admin@recurrentes.test", owner_whatsapp: "+5491164117974", store_name: "Recurrentes" });
  sent = []; failNext = null; _resetAdminPhoneCache();
  fakeGraph();
});

test("(p) el teléfono del admin sale de la cuenta cuyo mail está en ADMIN_EMAILS", async () => {
  assert.deepEqual(await adminPhones(), ["+5491164117974"]);
});

test("(p) ADMIN_WHATSAPP en env manda sobre la cuenta", async () => {
  process.env.ADMIN_WHATSAPP = "11 5555 0000, +5491166660000";
  try { assert.deepEqual(await adminPhones(), ["+5491155550000", "+5491166660000"]); }
  finally { delete process.env.ADMIN_WHATSAPP; _resetAdminPhoneCache(); }
});

test("(p) plan_paid → UNA plantilla aviso_admin al WhatsApp del admin con los 4 datos", async () => {
  const r = await notifyAdmin("plan_paid", { merchantId: MID, store: "LuminaLabs", detail: "Starter · USD 49 · primer pago", key: "cs_1" });
  assert.equal(r.ok, true);
  assert.equal(sent.length, 1);
  const b = sent[0].body;
  assert.equal(b.to, "5491164117974");
  assert.equal(b.template.name, WA_ADMIN_TEMPLATE.name);
  assert.equal(b.template.language.code, "es_AR");
  const params = b.template.components[0].parameters.map(p => p.text);
  assert.deepEqual(params, ["Pagó el plan", "LuminaLabs", "Starter · USD 49 · primer pago", "https://www.recurrentesapp.com/#/dashboard/admin"]);
  assert.match(sent[0].url, /\/1319380847922196\/messages$/, "sale por el número de Recurrentes");
  // Sin uso cargado a ningún comercio: el costo es de Recurrentes.
  assert.equal(rawList(`merchants/${MID}/usage`).length, 0);
});

test("(p) el mismo evento con la misma clave no se manda dos veces", async () => {
  await notifyAdmin("signup", { merchantId: "m_new", store: "Tienda Nueva", detail: "WhatsApp +549… · x@y.test", key: "first" });
  const dup = await notifyAdmin("signup", { merchantId: "m_new", store: "Tienda Nueva", detail: "…", key: "first" });
  assert.equal(sent.length, 1);
  assert.deepEqual(dup, { ok: false, skipped: true, reason: "duplicate" });
  const log = rawGet("system/admin_alerts/log/signup:m_new:first");
  assert.equal(log.status, "sent");
});

test("(p) evento desconocido o sin merchant → no hace nada", async () => {
  assert.equal(await notifyAdmin("otra_cosa", { merchantId: MID }), null);
  assert.equal(await notifyAdmin("plan_paid", {}), null);
  assert.equal(sent.length, 0);
});

test("(p) sin ADMIN_EMAILS ni ADMIN_WHATSAPP → cero lecturas y cero envíos", async () => {
  const prev = process.env.ADMIN_EMAILS; process.env.ADMIN_EMAILS = "";
  try {
    assert.equal(await notifyAdmin("plan_paid", { merchantId: MID, key: "k" }), null);
    assert.equal(sent.length, 0);
    assert.equal(rawList("system/admin_alerts/log").length, 0);
  } finally { process.env.ADMIN_EMAILS = prev; }
});

test("(p) si Meta rechaza (plantilla sin aprobar) NUNCA lanza y queda el error en el log", async () => {
  failNext = { error: { message: "Template name does not exist in the translation", code: 132001 } };
  const r = await notifyAdmin("plan_cancelled", { merchantId: MID, store: "LuminaLabs", detail: "Baja", key: "sub_1" });
  assert.equal(r.ok, false, "sin mail configurado no hay respaldo");
  assert.equal(r.whatsapp[0].ok, false);
  assert.equal(r.whatsapp[0].code, 132001);
  assert.equal(rawGet(`system/admin_alerts/log/plan_cancelled:${MID}:sub_1`).status, "error");
});

test("(p) la plantilla aviso_admin cumple las reglas de Meta y va en la lista para crear por API", () => {
  const vars = [...WA_ADMIN_TEMPLATE.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => +m[1]);
  assert.deepEqual(vars, [1, 2, 3, 4], "variables secuenciales y sin repetir");
  assert.equal(WA_ADMIN_TEMPLATE.samples.length, 4, "un ejemplo por variable (Meta lo exige)");
  assert.ok(!/^\{\{/.test(WA_ADMIN_TEMPLATE.body) && !/\}\}$/.test(WA_ADMIN_TEMPLATE.body.trim()), "no empieza ni termina con variable");
  assert.ok(WA_ALL_TEMPLATES.some(t => t.name === "aviso_admin"));
  const payload = templateCreatePayload(WA_ADMIN_TEMPLATE);
  assert.equal(payload.category, "UTILITY");
  assert.equal(payload.language, "es_AR");
  assert.deepEqual(payload.components[0].example.body_text, [WA_ADMIN_TEMPLATE.samples]);
  assert.equal(payload.components[1].type, "FOOTER");
});

test("(p) todas las plantillas de Recurrentes tienen ejemplos, variables secuenciales y nombres válidos", () => {
  const names = new Set();
  for (const t of WA_ALL_TEMPLATES) {
    assert.match(t.name, /^[a-z0-9_]+$/, t.name);
    assert.ok(!names.has(t.name), `nombre repetido: ${t.name}`); names.add(t.name);
    const vars = [...t.body.matchAll(/\{\{(\d+)\}\}/g)].map(m => +m[1]);
    const uniq = [...new Set(vars)];
    assert.deepEqual(uniq, uniq.map((_, i) => i + 1), `${t.name}: variables secuenciales`);
    assert.equal(vars.length, uniq.length, `${t.name}: sin variables repetidas (Meta las rechaza)`);
    assert.equal((t.samples || []).length, uniq.length, `${t.name}: un ejemplo por variable`);
  }
  assert.equal(WA_ALL_TEMPLATES.length, 13, "4 a clientes + 5 a comercios + 3 del plan + 1 admin");
});
