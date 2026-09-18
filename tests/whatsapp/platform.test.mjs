// WhatsApp desde el NÚMERO DE RECURRENTES: a quién le toca mandar, cero lecturas si está
// apagado, plantillas de Recurrentes, opt-in / baja, uso del mes con recargo, interruptor
// del panel y webhook (entregas, BAJA/ALTA, respuesta automática una vez cada 24 h).
// Firestore en memoria y fetch falso: ninguna llamada real a Meta.
//   node tests/whatsapp/platform.test.mjs
import { register } from "node:module";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
delete process.env.RESEND_API_KEY;
delete process.env.WHATSAPP_GRAPH_VERSION;
delete process.env.WHATSAPP_PRICE_USD_UTILITY;
const PLATFORM_PID = "700800900100";
const PLATFORM_TOKEN = "EAAplatformTOKEN1234567890abcdefXYZ";
const OWN_PID = "111222333444";
const OWN_TOKEN = "EAAowntokenABCDEFGHIJKLMNOP1234567890";
const APP_SECRET = "abcdefabcdefabcdefabcdefabcdef12";
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
function platformEnv(on) {
  if (on) { process.env.WHATSAPP_PHONE_NUMBER_ID = PLATFORM_PID; process.env.WHATSAPP_ACCESS_TOKEN = PLATFORM_TOKEN; process.env.WHATSAPP_WABA_ID = "123123123"; }
  else { delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.WHATSAPP_ACCESS_TOKEN; delete process.env.WHATSAPP_WABA_ID; }
}
platformEnv(false);

// ── fetch falso de la Graph API ──
const calls = [];
let wamidN = 0;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });
  if (!u.startsWith("https://graph.facebook.com/")) throw new Error("fetch inesperado " + u);
  if (u.includes("/messages") && opts.method === "POST") {
    const b = JSON.parse(opts.body);
    return json({ messaging_product: "whatsapp", contacts: [{ input: b.to, wa_id: b.to }], messages: [{ id: `wamid.PLAT${++wamidN}` }] });
  }
  return json({ error: { message: "no mockeado " + u, code: 100 } }, 400);
};
const logged = [];
for (const k of ["log", "warn", "error"]) { const orig = console[k]; console[k] = (...a) => { logged.push(a.map(String).join(" ")); if (k === "log") orig(...a); }; }

const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { db, __reads } = await import(`${R}/api/_lib/firebase.js`);
const wa = await import(`${R}/api/_lib/whatsapp.js`);
const { whatsappApi } = await import(`${R}/api/_lib/whatsappApi.js`);
const { handleWhatsappWebhook } = await import(`${R}/api/_lib/whatsappWebhook.js`);
const flows = await import(`${R}/api/_lib/flows.js`);
const SW = await import(`${R}/shared/platform/whatsapp.js`);
const P = await import(`${R}/shared/platform/pricing.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 1e-9;
const resObj = (resolve) => ({ _s: 200, _h: {}, status(c) { this._s = c; return this; }, setHeader(k, v) { this._h[k] = v; }, json(o) { resolve({ status: this._s, ...o }); }, end(t) { resolve({ status: this._s, text: String(t ?? "") }); } });
const owner = (mid) => ({ merchantId: mid, uid: mid, role: "owner", email: "dueno@tienda.com" });
const api = (action, body = {}, ctx = owner("mp1")) => new Promise((resolve) => whatsappApi(ctx, action, { body, query: {} }, resObj(resolve)));
const M = (id) => db().collection("merchants").doc(id);
const mdoc = async (id) => (await M(id).get()).data();
const posts = () => calls.filter(c => c.method === "POST");
const month = SW.waUsageMonth();
const STEP = { type: "whatsapp", template: "aviso_proximo_cobro", lang: "es_AR", vars: { "1": "monto" } };   // vars "equivocadas" a propósito
const sub = (o = {}) => ({ status: "active", customer_email: "ana@x.com", customer_name: "Ana Pérez", customer_phone: "11 6411-7974", next_charge_at: "2026-10-15T15:00:00.000Z", plan_snapshot: { product_title: "Cápsulas", total_per_charge_ars: 9480 }, portal_token: "tok1", ...o });
const run = (mid, merchant, s, step = STEP, sid = "s1") => wa.runWhatsappFlowStep({ mid, merchant, sub: s, subscriberId: sid, step, vars: flows.flowVars(merchant, mid, s), flowId: "f1", flowName: "Aviso", stepNo: 1 });

// ── 1) Quién manda: número propio > número de Recurrentes > nadie ──
{
  const own = { whatsapp_phone_number_id: OWN_PID, whatsapp_access_token: OWN_TOKEN };
  ok(wa.waSender({ whatsapp_platform_enabled: true }) === null && wa.whatsappSafe({ whatsapp_platform_enabled: true }).whatsapp_platform_available === false,
    "sin las env del número de Recurrentes: nadie manda aunque la tienda lo haya prendido");
  platformEnv(true);
  ok(wa.waSender({}) === null && wa.waSender({ whatsapp_platform_enabled: "true" }) === null, "con env pero sin prender (o prendido con otro tipo): nadie manda");
  const p = wa.waSender({ whatsapp_platform_enabled: true });
  ok(p?.mode === "platform" && p.phone_number_id === PLATFORM_PID && p.token === PLATFORM_TOKEN, "prendido + env: manda el número de Recurrentes");
  const o = wa.waSender({ ...own, whatsapp_platform_enabled: true });
  ok(o?.mode === "own" && o.phone_number_id === OWN_PID && o.token === OWN_TOKEN, "número propio conectado: tiene prioridad sobre el de Recurrentes");
  const safe = wa.whatsappSafe({ whatsapp_platform_enabled: true });
  const js = JSON.stringify(safe);
  ok(safe.whatsapp_platform_available === true && safe.whatsapp_platform_enabled === true && safe.whatsapp_sender === "platform" && !js.includes(PLATFORM_PID) && !js.includes(PLATFORM_TOKEN),
    "GET del merchant: solo booleanos del número de Recurrentes (nunca su id ni su token)");
  ok(near(safe.whatsapp_charge_usd, 0.018) && P.WHATSAPP_MARKUP === 1.5, `precio por aviso a clientes con +50% (${safe.whatsapp_charge_usd})`);
}

// ── 2) Apagado = cero lecturas y cero llamadas (camino del cobro intacto) ──
{
  const lumina = { email: "hola@lumina.test", store_name: "LuminaLabs" };
  const r0 = __reads(), c0 = calls.length;
  const a = await run("lum", lumina, sub());
  const b = await run("lum", { ...lumina, whatsapp_platform_enabled: false }, sub());
  await flows.emitFlowEvent("lum", lumina, "renewed", "s1", sub(), { key: "p1" });
  ok(a.skipped && a.reason === "not_connected" && b.skipped && __reads() === r0 && calls.length === c0, "tienda sin WhatsApp (Lumina): el paso se saltea sin leer Firestore ni llamar a Meta");
  ok(!(await db().collection("admin_usage").doc(month).get()).exists, "sin envíos no hay uso registrado");
}

// ── 3) Interruptor del panel ──
await M("mp1").set({ email: "dueno@uno.com", store_name: "Tienda Uno", email_reply_to: "hola@uno.com", widget_color: "#10b981" });
{
  const member = await api("whatsapp-platform", { enabled: true, optin_confirmed: true }, { merchantId: "mp1", uid: "u2", role: "member" });
  ok(member.status === 403, "un miembro del equipo no puede prenderlo");
  const noOpt = await api("whatsapp-platform", { enabled: true });
  ok(noOpt.status === 400 && /aceptaron/.test(noOpt.error), "sin la casilla de consentimiento no se prende");
  platformEnv(false);
  const noEnv = await api("whatsapp-platform", { enabled: true, optin_confirmed: true });
  platformEnv(true);
  ok(noEnv.status === 400 && /todavía no/.test(noEnv.error), "sin el número de Recurrentes configurado: 'todavía no está disponible'");
  const on = await api("whatsapp-platform", { enabled: true, optin_confirmed: true });
  const m = await mdoc("mp1");
  ok(on.ok && on.flow_created && on.whatsapp_sender === "platform" && m.whatsapp_platform_enabled === true && m.whatsapp_platform_optin_at, "prendido: guarda el consentimiento y responde whatsapp_sender=platform");
  const fl = (await M("mp1").collection("flows").get()).docs.map(d => d.data());
  ok(fl.length === 1 && fl[0].active === true && fl[0].trigger === "upcoming_charge" && fl[0].steps[0].type === "whatsapp" && fl[0].steps[0].template === "aviso_proximo_cobro"
    && m.flows_enabled === true && m.flows_active_triggers.includes("upcoming_charge"), "un solo interruptor: crea y activa 'Aviso de próximo cobro por WhatsApp'");
  const again = await api("whatsapp-platform", { enabled: true, optin_confirmed: true });
  ok(again.ok && !again.flow_created && (await M("mp1").collection("flows").get()).docs.length === 1, "prenderlo de nuevo no duplica el flujo");
  const tpl = await api("whatsapp-templates");
  ok(tpl.platform === true && tpl.templates.length === SW.WA_TEMPLATES.length && tpl.templates.every(t => t.status === "APPROVED"), "el editor de flujos recibe las plantillas de Recurrentes");
}

// ── 4) Envío desde el número de Recurrentes + uso con recargo ──
let firstWamid;
{
  const merchant = await mdoc("mp1");
  const n0 = posts().length;
  const r = await run("mp1", merchant, sub());
  const c = posts().at(-1);
  firstWamid = r.id;
  const params = c.body.template.components[0].parameters.map(p => p.text);
  ok(r.ok && posts().length === n0 + 1 && c.url === `https://graph.facebook.com/v25.0/${PLATFORM_PID}/messages` && c.headers.Authorization === `Bearer ${PLATFORM_TOKEN}`,
    "sale del número de Recurrentes con su token");
  ok(c.body.template.name === "aviso_proximo_cobro" && c.body.template.language.code === "es_AR" && params.length === 6 && params[0] === "Ana" && params[1] === "Tienda Uno" && /^15 de octubre/.test(params[2]) && params[3] === "Cápsulas" && params[4] === "$9.480" && params[5].includes("/#/portal?token=tok1"),
    `variables de la plantilla de Recurrentes (el nombre de la tienda siempre va): ${params.join(" | ")}`);
  const log = (await M("mp1").collection("message_log").get()).docs.map(d => d.data()).find(l => l.provider_id === r.id);
  ok(log?.sender === "platform" && log.status === "sent", "message_log: enviado desde el número de Recurrentes");
  const u = (await M("mp1").collection("usage").doc(month).get()).data();
  const au = (await db().collection("admin_usage").doc(month).get()).data();
  ok(u.wa_sent === 1 && u.wa_platform_sent === 1 && near(u.wa_cost_usd, 0.012 * 1.5), `uso del mes de la tienda: 1 aviso, US$ ${u.wa_cost_usd} (precio × 1,50)`);
  ok(au.merchants.mp1.wa_sent === 1 && near(au.merchants.mp1.wa_cost_usd, 0.018) && near(au.merchants.mp1.wa_meta_cost_usd, 0.012) && au.wa_sent === 1, "admin: uso por comercio y total del mes");
  const key = wa.phoneKey("+5491164117974");
  ok((await db().collection("wa_contacts").doc(key).get()).data()?.merchants?.mp1 && (await db().collection("wa_platform_msgs").doc(wa.messageLogId(r.id)).get()).data()?.mid === "mp1",
    "índices del número de Recurrentes: contacto → tienda y wamid → tienda");
  process.env.WHATSAPP_PRICE_USD_UTILITY = "0.02";
  await run("mp1", merchant, sub({ customer_phone: "351 555 1234" }), STEP, "s2");
  delete process.env.WHATSAPP_PRICE_USD_UTILITY;
  const u2 = (await M("mp1").collection("usage").doc(month).get()).data();
  ok(u2.wa_sent === 2 && near(u2.wa_cost_usd, 0.018 + 0.03), `WHATSAPP_PRICE_USD_UTILITY pisa el precio (acumulado US$ ${u2.wa_cost_usd})`);
  const n1 = posts().length;
  const custom = await run("mp1", merchant, sub(), { type: "whatsapp", template: "mi_plantilla_propia", lang: "es_AR", vars: {} });
  ok(custom.skipped && custom.reason === "template_not_platform" && posts().length === n1, "desde el número de Recurrentes solo salen plantillas de Recurrentes");
  const usage = await api("whatsapp-usage");
  ok(usage.usage?.wa_sent === 2 && usage.sender === "platform" && near(usage.charge_usd, 0.018), "GET whatsapp-usage para el panel");
}

// ── 5) Opt-in / baja ──
{
  const merchant = await mdoc("mp1");
  const n0 = posts().length;
  const a = await run("mp1", merchant, sub({ whatsapp_optin: false }));
  const b = await run("mp1", merchant, sub({ whatsapp_optout: true }));
  await wa.setPlatformOptOut("+5492615551234");
  const c = await run("mp1", merchant, sub({ customer_phone: "261 555 1234" }));
  ok(a.reason === "optout" && b.reason === "optout" && c.reason === "optout" && posts().length === n0, "respeta whatsapp_optin=false, whatsapp_optout y la baja del número de Recurrentes");
  const d = await run("mp1", merchant, sub({ whatsapp_optin: true }));
  ok(d.ok, "whatsapp_optin=true (casilla del checkout) → sale");
}

// ── 6) Número propio: se cuenta pero a costo 0 ──
{
  await M("mo1").set({ email: "o@own.com", store_name: "Tienda Propia", whatsapp_phone_number_id: OWN_PID, whatsapp_access_token: OWN_TOKEN, whatsapp_platform_enabled: true });
  const merchant = await mdoc("mo1");
  const r = await run("mo1", merchant, sub({ customer_phone: "261 555 1234" }));   // la baja del número de Recurrentes no aplica al propio
  const c = posts().at(-1);
  const u = (await M("mo1").collection("usage").doc(month).get()).data();
  const au = (await db().collection("admin_usage").doc(month).get()).data();
  ok(r.ok && c.url.includes(`/${OWN_PID}/messages`) && c.headers.Authorization === `Bearer ${OWN_TOKEN}`, "con número propio sale de su número y con su token");
  ok(u.wa_sent === 1 && u.wa_own_sent === 1 && u.wa_cost_usd === 0 && !au.merchants.mo1, "número propio: cuenta el aviso a costo 0 y no suma a lo que cobra Recurrentes");
}

// ── 7) Webhook del número de Recurrentes ──
{
  const sign = (raw, secret = APP_SECRET) => "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const hook = (bodyObj, secret) => new Promise((resolve) => {
    const raw = Buffer.from(JSON.stringify(bodyObj));
    handleWhatsappWebhook({ method: "POST", query: {}, headers: { "x-hub-signature-256": sign(raw, secret) }, body: raw }, resObj(resolve));
  });
  const evt = (value) => ({ object: "whatsapp_business_account", entry: [{ id: "123123123", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "5491100000000", phone_number_id: PLATFORM_PID }, ...value } }] }] });
  const msg = (from, text) => evt({ messages: [{ from, id: "wamid.IN" + Math.random(), type: "text", text: { body: text } }] });

  const bad = await hook(evt({ statuses: [{ id: firstWamid, status: "delivered", timestamp: "1790000000" }] }), "f".repeat(32));
  ok(bad.status === 401, "firma inválida → 401");
  const st = await hook(evt({ statuses: [{ id: firstWamid, status: "delivered", timestamp: "1790000000", pricing: { billable: true, category: "utility" } }] }));
  const log = (await M("mp1").collection("message_log").doc(wa.messageLogId(firstWamid)).get()).data();
  ok(st.statuses === 1 && log.status === "delivered" && log.pricing_category === "utility", "estado de entrega: encuentra la tienda por el wamid");

  const n0 = posts().length;
  const a1 = await hook(msg("5491164117974", "hola, ¿cuándo llega mi pedido?"));
  const reply = posts().at(-1);
  ok(a1.autoreplies === 1 && posts().length === n0 + 1 && reply.url.includes(`/${PLATFORM_PID}/messages`) && reply.body.type === "text"
    && reply.body.text.body.includes("Tienda Uno") && reply.body.text.body.includes("hola@uno.com"), `respuesta automática con la tienda y su mail: "${reply.body.text?.body}"`);
  const a2 = await hook(msg("5491164117974", "hola?? respondan"));
  ok(a2.autoreplies === 0 && posts().length === n0 + 1, "segundo mensaje dentro de las 24 h: no se repite la respuesta");
  const realNow = Date.now;
  Date.now = () => realNow() + 25 * 3600e3;
  const a3 = await hook(msg("5491164117974", "sigo esperando"));
  Date.now = realNow;
  ok(a3.autoreplies === 1 && posts().length === n0 + 2, "pasadas 24 h: responde otra vez");

  const g1 = await hook(msg("5493410000000", "hola"));
  ok(g1.autoreplies === 1 && /tiendas que usan Recurrentes/.test(posts().at(-1).body.text.body), "teléfono que no conocemos: mensaje genérico");
  await wa.rememberPlatformContact("mp1", "+5493415550000", null);
  await wa.rememberPlatformContact("mo1", "+5493415550000", null);
  await hook(msg("5493415550000", "hola"));
  ok(/tiendas que usan Recurrentes/.test(posts().at(-1).body.text.body), "le escribieron varias tiendas (ambiguo): mensaje genérico");

  const nB = posts().length;
  const baja = await hook(msg("5491164117974", "BAJA"));
  ok(baja.optouts === 1 && baja.autoreplies === 0 && posts().length === nB && await wa.isWhatsappOptedOut("mp1", "+5491164117974", {}, { platform: true })
    && (await M("mp1").collection("wa_optouts").doc(wa.phoneKey("+5491164117974")).get()).exists, "BAJA al número de Recurrentes: baja global + en la tienda, sin respuesta automática");
  const skipped = await run("mp1", await mdoc("mp1"), sub());
  ok(skipped.reason === "optout", "después de BAJA no le sale ningún aviso");
  const alta = await hook(msg("5491164117974", "ALTA"));
  ok(alta.optins === 1 && !(await wa.isWhatsappOptedOut("mp1", "+5491164117974", {}, { platform: true })), "ALTA la vuelve a activar");
}

// ── 8) Apagar ──
{
  const off = await api("whatsapp-platform", { enabled: false });
  const m = await mdoc("mp1");
  const r = await run("mp1", m, sub());
  ok(off.ok && m.whatsapp_platform_enabled === false && r.reason === "not_connected", "apagado: no sale nada más (los flujos quedan, el paso se saltea)");
  ok(!logged.some(l => l.includes(PLATFORM_TOKEN) || l.includes(OWN_TOKEN) || l.includes(APP_SECRET)), "ningún log incluye tokens ni el app secret");
}

// ── 9) Plantillas: todas llevan el nombre de la tienda y el pie de baja ──
ok(SW.WA_TEMPLATES.every(t => Object.values(t.vars).includes("marca") && t.footer === "Respondé BAJA para no recibir más avisos." && t.category === "UTILITY" && t.samples.length === Object.keys(t.vars).length),
  "plantillas de Recurrentes: nombre de la tienda como variable, pie 'Respondé BAJA…', utilidad, ejemplos para Meta");

console.log(fails ? `\n${fails} FALLA(S)` : "\nTODO OK");
process.exit(fails ? 1 : 0);
