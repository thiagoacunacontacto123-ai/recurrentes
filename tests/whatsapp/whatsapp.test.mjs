// WhatsApp Cloud API: normalización, envío (payload), errores, sanitizeFlow, motor de
// flujos, conexión del comerciante y webhook. Firestore en memoria y fetch falso:
// ninguna llamada real a Meta.   node tests/whatsapp/whatsapp.test.mjs
import { register } from "node:module";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
delete process.env.WHATSAPP_GRAPH_VERSION;
delete process.env.RESEND_API_KEY;             // los mails no salen (skipped); acá miramos WhatsApp
process.env.WHATSAPP_VERIFY_TOKEN = "verify-env-123";
const TOKEN = "EAAtesttokenABCDEFGHIJKLMNOP1234567890";
const APP_SECRET = "0123456789abcdef0123456789abcdef";

// ── fetch falso de la Graph API ──
const calls = [];
let nextError = null;       // { status, body } para el próximo POST /messages
let wamidN = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
  if (u.includes("/messages") && opts.method === "POST") {
    if (nextError) { const e = nextError; nextError = null; if (e.throw) throw e.throw; return json(e.body, e.status); }
    const b = JSON.parse(opts.body);
    return json({ messaging_product: "whatsapp", contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: `wamid.TEST${++wamidN}`, message_status: "accepted" }] });
  }
  if (/\/111222333444\?fields=/.test(u)) return json({ id: "111222333444", display_phone_number: "+54 9 11 5555-0000", verified_name: "LuminaLabs", quality_rating: "GREEN", code_verification_status: "VERIFIED" });
  if (/\/999888777\/phone_numbers/.test(u)) return json({ data: [{ id: "111222333444", display_phone_number: "+54 9 11 5555-0000" }] });
  if (/\/555000555\/phone_numbers/.test(u)) return json({ data: [{ id: "000000001" }] });
  if (/\/message_templates/.test(u)) return json({ data: [
    { name: "aviso_proximo_cobro", language: "es_AR", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, el {{2}} se renueva." }, { type: "FOOTER", text: "Respondé BAJA" }] },
    { name: "promo_con_imagen", language: "es_AR", status: "APPROVED", category: "MARKETING", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "Hola {{1}}" }] },
  ] });
  if (/\/404404\?fields=/.test(u)) return json({ error: { message: "Unsupported get request.", type: "GraphMethodException", code: 100, error_subcode: 33, fbtrace_id: "x" } }, 400);
  return json({ error: { message: "no mockeado " + u, code: 100 } }, 400);
};

// Nada de tokens en la consola.
const logged = [];
for (const k of ["log", "warn", "error"]) { const orig = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(" ")); if (k === "log") orig(...a); }; }

const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { db } = await import(`${R}/api/_lib/firebase.js`);
const wa = await import(`${R}/api/_lib/whatsapp.js`);
const { whatsappApi } = await import(`${R}/api/_lib/whatsappApi.js`);
const { handleWhatsappWebhook } = await import(`${R}/api/_lib/whatsappWebhook.js`);
const flows = await import(`${R}/api/_lib/flows.js`);
const { flowsApi } = await import(`${R}/api/_lib/flowsApi.js`);
const SF = await import(`${R}/shared/platform/flows.js`);
const SW = await import(`${R}/shared/platform/whatsapp.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const resObj = (resolve) => ({ _s: 200, _h: {}, status(c) { this._s = c; return this; }, setHeader(k, v) { this._h[k] = v; }, json(o) { resolve({ status: this._s, ...o }); }, end(t) { resolve({ status: this._s, text: String(t ?? "") }); } });
const api = (action, body = {}, ctx = { merchantId: "m1", uid: "m1", role: "owner", email: "dueno@tienda.com" }) => new Promise((resolve) => whatsappApi(ctx, action, { body, query: {} }, resObj(resolve)));
const fapi = (action, body) => new Promise((resolve) => flowsApi({ merchantId: "m1", uid: "m1", email: "dueno@tienda.com" }, action, { body, query: {} }, resObj(resolve)));
const M = db().collection("merchants").doc("m1");
const mdoc = async () => (await M.get()).data();
const logs = async () => (await M.collection("message_log").get()).docs.map(d => ({ id: d.id, ...d.data() }));
const runsPast = async () => { for (const d of (await M.collection("flow_runs").get()).docs) if (d.data().next_at) await d.ref.update({ next_at: "2000-01-01T00:00:00.000Z" }); };

// ── 1) Teléfonos ──
{
  const N = SW.normalizePhoneAR;
  const cases = [
    ["11 6411-7974", "+5491164117974"], ["011 15 6411 7974", "+5491164117974"], ["1115 6411 7974", "+5491164117974"],
    ["+54 9 11 6411 7974", "+5491164117974"], ["+54 11 6411 7974", "+5491164117974"], ["5491164117974", "+5491164117974"],
    ["0351 15 555-1234", "+5493515551234"], ["(0261) 15-555-1234", "+5492615551234"], ["00 54 9 351 555 1234", "+5493515551234"],
    ["+1 415 555 1234", "+14155551234"], ["+44 7911 123456", "+447911123456"], ["123", null], ["", null], [null, null],
  ];
  const bad = cases.filter(([i, o]) => N(i) !== o);
  ok(!bad.length, `normalizePhoneAR (${cases.length} casos)${bad.length ? " FALLAN: " + bad.map(([i, o]) => `${i}→${N(i)} (esperado ${o})`).join(", ") : ""}`);
  ok(SW.waRecipient("11 6411 7974") === "5491164117974" && SW.maskPhone("+5491164117974") === "+54911••••7974", "destinatario en dígitos y teléfono enmascarado");
}

// ── 2) Payload de envío ──
{
  const merchant = { whatsapp_phone_number_id: "111222333444", whatsapp_access_token: TOKEN };
  const r = await wa.sendTemplate({ merchant, to: "11 6411 7974", template: "aviso_proximo_cobro", lang: "es_AR", components: wa.bodyComponents(["Ana", "15 de octubre"]) });
  const c = calls.at(-1);
  ok(r.ok && r.id === "wamid.TEST1" && r.to === "+5491164117974", "sendTemplate ok → wamid");
  ok(c.url === "https://graph.facebook.com/v25.0/111222333444/messages" && c.method === "POST", `POST a /v25.0/{phone-number-id}/messages (${c.url})`);
  ok(c.headers.Authorization === `Bearer ${TOKEN}` && c.headers["Content-Type"] === "application/json", "token en el header Authorization (no en la URL)");
  ok(JSON.stringify(c.body) === JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: "5491164117974", type: "template",
    template: { name: "aviso_proximo_cobro", language: { code: "es_AR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "15 de octubre" }] }] } }), "cuerpo JSON de plantilla exacto");
  process.env.WHATSAPP_GRAPH_VERSION = "v26.0";
  await wa.sendTemplate({ merchant, to: "1164117974", template: "x_y" });
  ok(calls.at(-1).url.includes("/v26.0/") && !("components" in calls.at(-1).body.template), "WHATSAPP_GRAPH_VERSION cambia la versión; sin variables no manda components");
  delete process.env.WHATSAPP_GRAPH_VERSION;
  const n0 = calls.length;
  const s1 = await wa.sendTemplate({ merchant: {}, to: "1164117974", template: "x" });
  const s2 = await wa.sendTemplate({ merchant, to: "12", template: "x" });
  ok(s1.skipped && s1.reason === "not_connected" && s2.skipped && s2.reason === "no_phone" && calls.length === n0, "sin conexión o sin teléfono: no llama a Meta");
  ok(SW.waParamText("a\nb\t c      d") === "a b c   d" && SW.waParamText("") === "-", "parámetros sin saltos de línea, tabs ni 4+ espacios, nunca vacíos");
}

// ── 3) Errores ──
{
  const merchant = { whatsapp_phone_number_id: "111222333444", whatsapp_access_token: TOKEN };
  nextError = { status: 401, body: { error: { message: `Error validating access token: Session has expired. access_token=${TOKEN}`, type: "OAuthException", code: 190, fbtrace_id: "AbC" } } };
  const e1 = await wa.sendTemplate({ merchant, to: "1164117974", template: "x" });
  ok(!e1.ok && e1.code === 190 && e1.reconnect && /venció/.test(e1.error) && !String(e1.detail).includes(TOKEN), "190 → reconectar, mensaje en castellano, sin token en el detalle");
  nextError = { status: 400, body: { error: { message: "(#132001) Template name does not exist in the translation", code: 132001, error_data: { messaging_product: "whatsapp", details: "template name (x) does not exist in es_AR" } } } };
  const e2 = await wa.sendTemplate({ merchant, to: "1164117974", template: "x" });
  ok(e2.code === 132001 && /no existe|aprobada/.test(e2.error) && !e2.retryable, "132001 → plantilla no aprobada");
  nextError = { status: 400, body: { error: { message: "rate", code: 130429 } } };
  const e3 = await wa.sendTemplate({ merchant, to: "1164117974", template: "x" });
  nextError = { throw: new Error("socket hang up") };
  const e4 = await wa.sendTemplate({ merchant, to: "1164117974", template: "x" });
  ok(e3.retryable && e4.retryable && e4.code === "network", "límite de envío y caída de red → reintentable");
  const e5 = wa.mapWaError(503, {});
  ok(e5.retryable && e5.code === "http_503", "HTTP 5xx sin cuerpo → reintentable");
}

// ── 4) sanitizeFlow ──
{
  const keys = SF.FLOW_VARIABLES.map(v => v.key);
  const W = (x) => ({ type: "whatsapp", template: "aviso_proximo_cobro", lang: "es_AR", vars: { "1": "nombre", "2": "proximo_cobro" }, ...x });
  const a = SF.sanitizeFlow({ trigger: "upcoming_charge", steps: [W()] });
  ok(a.flow && a.flow.steps[0].type === "whatsapp" && a.flow.steps[0].vars["2"] === "proximo_cobro", "acepta un flujo solo con WhatsApp");
  ok(SF.sanitizeFlow({ trigger: "activated", steps: [{ type: "wait", amount: 1, unit: "days" }, W(), { type: "email", subject: "Hola", body: "x" }] }).flow?.steps.length === 3, "acepta mezclado con esperas y mails");
  ok(/plantilla/.test(SF.sanitizeFlow({ trigger: "activated", steps: [W({ template: "" })] }).error || ""), "rechaza sin plantilla");
  ok(/minúsculas/.test(SF.sanitizeFlow({ trigger: "activated", steps: [W({ template: "Aviso Cobro" })] }).error || ""), "rechaza nombre de plantilla inválido");
  ok(/dato/.test(SF.sanitizeFlow({ trigger: "activated", steps: [W({ vars: { "1": "password" } })] }).error || ""), "rechaza una variable que no existe");
  ok(/orden/.test(SF.sanitizeFlow({ trigger: "activated", steps: [W({ vars: { "1": "nombre", "3": "monto" } })] }).error || ""), "rechaza variables salteadas ({{1}}, {{3}})");
  ok(SF.sanitizeFlow({ trigger: "activated", steps: [W({ lang: "xx-yy" })] }).flow?.steps[0].lang === "es_AR" && SF.sanitizeFlow({ trigger: "activated", steps: [W({ lang: "es_MEX" })] }).flow?.steps[0].lang === "es_MEX", "idioma inválido → es_AR; es_MEX válido");
  ok(/Máximo/.test(SF.sanitizeFlow({ trigger: "activated", steps: [W(), W(), W(), W(), W()] }).error || ""), "máximo 4 WhatsApp por flujo");
  ok(/al menos un mail o un WhatsApp/.test(SF.sanitizeFlow({ trigger: "activated", steps: [{ type: "wait", amount: 1, unit: "days" }] }).error || ""), "sin mails ni WhatsApp → error");
  const d = SF.defaultWhatsappFlow();
  ok(d.trigger === "upcoming_charge" && d.days_before === 3 && SF.sanitizeFlow(d).flow && SF.flowSummary(d) === "1 WhatsApp · al instante", "sugerencia 'Aviso de próximo cobro por WhatsApp' válida");
  ok(SW.WA_TEMPLATES.every(t => (t.category === "UTILITY" || (t.name === "carrito_sin_pagar" && t.category === "MARKETING")) && SW.templateVarCount(t.body) === Object.keys(t.vars).length && !/^\s*\{\{/.test(t.body) && !/\}\}\s*[.!]?\s*$/.test(t.body) && !/\}\}\s*\{\{/.test(t.body) && SF.sanitizeFlow({ trigger: t.trigger, steps: [{ type: "whatsapp", template: t.name, lang: t.lang, vars: t.vars }] }).flow),
    "plantillas sugeridas: UTILITY (carrito: MARKETING), variables en orden, sin variable al inicio/fin ni pegadas");
  ok(keys.includes("link_portal") && keys.includes("proximo_cobro"), "las variables del flujo existen");
}

// ── 5) Conexión del comerciante ──
await M.set({ email: "dueno@tienda.com", store_name: "LuminaLabs", widget_color: "#10b981", email_reply_to: "atencion@tienda.com" });
{
  const noOpt = await api("whatsapp-save", { phone_number_id: "111222333444", waba_id: "999888777", access_token: TOKEN });
  ok(noOpt.status === 400 && /aceptaron/.test(noOpt.error), "sin confirmar el consentimiento de los clientes no conecta");
  const member = await api("whatsapp-save", { phone_number_id: "111222333444", waba_id: "999888777", access_token: TOKEN, optin_confirmed: true }, { merchantId: "m1", uid: "u2", role: "member" });
  ok(member.status === 403, "un miembro del equipo no puede conectar");
  const wrongWaba = await api("whatsapp-save", { phone_number_id: "111222333444", waba_id: "555000555", access_token: TOKEN, optin_confirmed: true });
  ok(wrongWaba.status === 400 && /no pertenece/.test(wrongWaba.error), "rechaza si el número no es de esa WABA");
  const badPid = await api("whatsapp-save", { phone_number_id: "404404", waba_id: "999888777", access_token: TOKEN, optin_confirmed: true });
  ok(badPid.status === 400 && /no encontró ese número/.test(badPid.error), "rechaza un Phone number ID que Meta no encuentra");
  const nPost = calls.filter(c => c.method === "POST").length;
  const saved = await api("whatsapp-save", { phone_number_id: "111222333444", waba_id: "999888777", access_token: TOKEN, app_secret: APP_SECRET, optin_confirmed: true });
  ok(saved.ok && saved.whatsapp_connected && saved.whatsapp_access_token === "•••••" && saved.whatsapp_display_phone === "+54 9 11 5555-0000", "conecta y responde enmascarado");
  ok(calls.filter(c => c.method === "POST").length === nPost, "validar credenciales no manda ningún mensaje (solo GET)");
  const m = await mdoc();
  ok(m.whatsapp_access_token === TOKEN && m.whatsapp_app_secret === APP_SECRET && m.whatsapp_verify_token && m.whatsapp_optin_confirmed_at, "token guardado del lado del servidor");
  const safe = wa.whatsappSafe(m);
  ok(safe.whatsapp_connected && !JSON.stringify(safe).includes(TOKEN) && !JSON.stringify(safe).includes(APP_SECRET) && safe.whatsapp_has_app_secret, "GET del merchant: sin token ni app secret");
  await db().collection("merchants").doc("m2").set({ email: "otra@x.com" });
  const dup = await api("whatsapp-save", { phone_number_id: "111222333444", waba_id: "999888777", access_token: TOKEN, optin_confirmed: true }, { merchantId: "m2", uid: "m2", role: "owner" });
  ok(dup.status === 409, "el mismo número no se conecta a dos tiendas");
  const tpl = await api("whatsapp-templates");
  ok(tpl.templates?.length === 2 && tpl.templates[0].var_count === 2 && tpl.templates[0].footer === "Respondé BAJA" && tpl.templates[1].unsupported === true, "lista plantillas (y marca las que tienen imagen)");
  const test = await api("whatsapp-test", { template: "aviso_proximo_cobro", lang: "es_AR", vars: { "1": "nombre", "2": "proximo_cobro" }, to: "11 6411 7974" });
  ok(test.ok && calls.at(-1).body.template.components[0].parameters.map(p => p.text).join("|") === "Ana|15 de octubre", "prueba con datos de ejemplo");
}

// ── 6) Motor de flujos ──
{
  const f = await fapi("flow-save", { flow: { name: "Aviso WA", trigger: "activated", active: true, steps: [
    { type: "whatsapp", template: "suscripcion_activa", lang: "es_AR", vars: SW.WA_TEMPLATE_BY_NAME.suscripcion_activa.vars },
    { type: "email", subject: "Hola {{nombre}}", body: "Bienvenida" },
  ] } });
  ok(f.ok, "guarda un flujo con paso de WhatsApp");
  const subs = M.collection("subscribers");
  const snap = { product_title: "Cápsulas", total_per_charge_ars: 9480 };
  await subs.doc("s1").set({ status: "active", customer_email: "ana@x.com", customer_name: "Ana Pérez", customer_phone: "11 6411-7974", next_charge_at: "2026-10-15T15:00:00.000Z", plan_snapshot: snap, portal_token: "tok1" });
  await subs.doc("s2").set({ status: "active", customer_email: "beto@x.com", customer_name: "Beto", plan_snapshot: snap });
  await subs.doc("s3").set({ status: "active", customer_email: "caro@x.com", customer_name: "Caro", customer_phone: "351 555 1234", plan_snapshot: snap });
  await subs.doc("s4").set({ status: "active", customer_email: "dani@x.com", customer_name: "Dani", customer_phone: "261 555 1234", whatsapp_optout: true, plan_snapshot: snap });
  await wa.setWhatsappOptOut("m1", "+5493515551234", { reason: "test" });

  // 6a) Sin WhatsApp conectado: no llama a Meta, el mail sigue.
  const off = { ...(await mdoc()) }; delete off.whatsapp_access_token; delete off.whatsapp_phone_number_id;
  await flows.emitFlowEvent("m1", off, "activated", "s1", { customer_email: "ana@x.com" }, { key: "p-off" });
  let n0 = calls.length;
  let out = await flows.runFlowsForMerchant("m1", off);
  const runOff = (await M.collection("flow_runs").get()).docs.map(d => d.data()).find(r => r.subscriber_id === "s1");
  ok(calls.length === n0 && !out.wa_sent && runOff.status === "completed" && runOff.last_skip === "not_connected", "sin WhatsApp conectado: se saltea el paso, sin llamar a Meta, y el flujo termina");
  ok(!(await logs()).some(l => l.type === "flow"), "no conectado: no ensucia message_log");

  // 6b) Conectado.
  const on = await mdoc();
  for (const [sid, email] of [["s1", "ana@x.com"], ["s2", "beto@x.com"], ["s3", "caro@x.com"], ["s4", "dani@x.com"]]) await flows.emitFlowEvent("m1", on, "activated", sid, { customer_email: email }, { key: "p-on" });
  n0 = calls.length;
  out = await flows.runFlowsForMerchant("m1", on);
  const sends = calls.slice(n0).filter(c => c.method === "POST");
  ok(sends.length === 1 && out.wa_sent === 1, `solo se manda a quien tiene teléfono y no pidió la baja (${sends.length} envío/s)`);
  const body = sends[0]?.body || {};
  const params = body.template?.components?.[0]?.parameters?.map(p => p.text) || [];
  ok(body.to === "5491164117974" && body.template?.name === "suscripcion_activa" && params[0] === "Ana" && params[1] === "Cápsulas" && params[2] === "LuminaLabs" && /^15 de octubre/.test(params[3]) && params[4].includes("/#/portal?token=tok1"),
    `variables del flujo en orden (${params.join(" | ")})`);
  const L = (await logs()).filter(l => l.type === "flow");
  const bySub = Object.fromEntries(L.map(l => [l.subscriber_id, l]));
  ok(bySub.s1?.status === "sent" && bySub.s1.provider_id?.startsWith("wamid.") && bySub.s1.to === "+54911••••7974" && bySub.s1.channel === "whatsapp" && bySub.s1.flow_name === "Aviso WA", "message_log: enviado, con wamid y teléfono enmascarado");
  ok(bySub.s2?.status === "skipped" && /teléfono/.test(bySub.s2.reason), "sin teléfono: registrado como salteado");
  ok(bySub.s3?.status === "skipped" && /baja/.test(bySub.s3.reason) && bySub.s4?.status === "skipped", "respeta la baja de WhatsApp (respondió BAJA o marcada en la suscripción)");
  const stats = (await M.collection("flows").doc(f.flow.id).get()).data().stats;
  ok(stats.wa_sent === 1, `métrica wa_sent del flujo (${stats.wa_sent})`);
  const runs = (await M.collection("flow_runs").get()).docs.map(d => d.data()).filter(r => r.status === "completed");
  ok(runs.length === 5, "todas las corridas siguen al paso de mail y terminan");
  const email = (await M.collection("email_log").get()).docs.map(d => d.data());
  ok(!email.some(e => e.type === "whatsapp"), "WhatsApp va a message_log, no a email_log");

  // 6c) Error de Meta → registrado + aviso en Integraciones.
  await flows.emitFlowEvent("m1", on, "activated", "s1", { customer_email: "ana@x.com" }, { key: "p-err" });
  nextError = { status: 401, body: { error: { message: "expired", code: 190 } } };
  await flows.runFlowsForMerchant("m1", on);
  const errLog = (await logs()).find(l => l.type === "flow" && l.status === "error");
  ok(errLog && errLog.error_code === 190 && /venció/.test((await mdoc()).whatsapp_last_error || ""), "token vencido: queda el error en el log y en el merchant");
}

// ── 7) Webhook ──
{
  const sign = (raw, secret = APP_SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const hook = (method, { body, headers = {}, query = {} } = {}) => new Promise((resolve) => {
    const raw = body ? Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) : Buffer.alloc(0);
    handleWhatsappWebhook({ method, query, headers, body: raw }, resObj(resolve));
  });
  const v1 = await hook("GET", { query: { "hub.mode": "subscribe", "hub.verify_token": "verify-env-123", "hub.challenge": "1158201444" } });
  const vt = (await mdoc()).whatsapp_verify_token;
  const v2 = await hook("GET", { query: { "hub.mode": "subscribe", "hub.verify_token": vt, "hub.challenge": "42", merchant: "m1" } });
  const v3 = await hook("GET", { query: { "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "42", merchant: "m1" } });
  ok(v1.text === "1158201444" && v2.text === "42" && v3.status === 403, "verificación GET: token global o de la tienda; otro → 403");

  const sent = (await logs()).find(l => l.type === "flow" && l.status === "sent");
  const wamid = sent.provider_id;
  const evt = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "999888777", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5491155550000", phone_number_id: "111222333444" }, ...value } }] }] });
  const st = (status, ts = "1790000000") => evt({ statuses: [{ id: wamid, status, timestamp: ts, recipient_id: "5491164117974", pricing: { billable: true, pricing_model: "PMP", category: "utility" } }] });
  const raw1 = JSON.stringify(st("read"));
  const bad = await hook("POST", { body: raw1, headers: { "x-hub-signature-256": sign(raw1, "f".repeat(32)) } });
  ok(bad.status === 401, "firma inválida → 401");
  const r1 = await hook("POST", { body: raw1, headers: { "x-hub-signature-256": sign(raw1) } });
  const raw2 = JSON.stringify(st("delivered"));
  await hook("POST", { body: raw2, headers: { "x-hub-signature-256": sign(raw2) } });
  const after = (await logs()).find(l => l.provider_id === wamid);
  ok(r1.status === 200 && after.status === "read" && after.read_at && after.pricing_category === "utility", "estado 'read' registrado y un 'delivered' tardío no lo pisa");
  const raw3 = JSON.stringify(evt({ contacts: [{ wa_id: "5493515559999" }], messages: [{ from: "5493515559999", id: "wamid.IN1", type: "text", text: { body: "BAJA" } }] }));
  const r3 = await hook("POST", { body: raw3, headers: { "x-hub-signature-256": sign(raw3) } });
  ok(r3.optouts === 1 && await wa.isWhatsappOptedOut("m1", "+5493515559999"), "responder BAJA da de baja ese teléfono");
  const raw4 = JSON.stringify(evt({ messages: [{ from: "5493515559999", id: "wamid.IN2", type: "button", button: { text: "ALTA", payload: "ALTA" } }] }));
  await hook("POST", { body: raw4, headers: { "x-hub-signature-256": sign(raw4) } });
  ok(!(await wa.isWhatsappOptedOut("m1", "+5493515559999")), "responder ALTA la vuelve a activar");
  ok(!SW.WA_OPTOUT_RE.test("quiero dar de baja la tarjeta y cambiarla") && SW.WA_OPTOUT_RE.test("Stop!"), "la baja reconoce BAJA/STOP sin confundir frases largas");
}

// ── 8) Desconectar + logs sin tokens ──
{
  const d = await api("whatsapp-disconnect");
  const m = await mdoc();
  ok(d.ok && !m.whatsapp_access_token && !m.whatsapp_phone_number_id && !wa.whatsappSafe(m).whatsapp_connected, "desconectar borra el token");
  ok(!logged.some(l => l.includes(TOKEN) || l.includes(APP_SECRET)), "ningún log de consola incluye el token ni el app secret");
}

console.log(fails ? `\n${fails} FALLA(S)` : "\nTODO OK");
process.exit(fails ? 1 : 0);
