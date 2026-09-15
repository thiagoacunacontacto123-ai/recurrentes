// Acciones de conexión (api/_lib/providers/stripeWhopApi.js, enganchadas en merchant.js):
// flags del panel, Stripe Connect start/callback/disconnect y Whop save/disconnect.
// Firestore en memoria + fetch falso. Correr: node tests/providers/connect.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

const R = new URL("../../", import.meta.url).pathname;
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.PORTAL_SECRET = "test-portal-secret";
process.env.STRIPE_ENABLED = "1";
process.env.STRIPE_SECRET_KEY = "sk_test_platform";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test";
process.env.WHOP_ENABLED = "1";

const calls = [];
let whopStatus = 200;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body || "" });
  if (u === "https://connect.stripe.com/oauth/token") {
    const p = new URLSearchParams(opts.body);
    if (p.get("code") !== "ac_good") return json({ error: "invalid_grant", error_description: "Authorization code expired" }, 400);
    return json({ stripe_user_id: "acct_9", livemode: false, scope: "read_write", token_type: "bearer" });
  }
  if (u === "https://api.stripe.com/v1/accounts/acct_9") return json({ id: "acct_9", email: "yo@llc.com", country: "US", default_currency: "usd", charges_enabled: true, business_profile: { name: "Mi LLC" } });
  if (u === "https://connect.stripe.com/oauth/deauthorize") return json({ stripe_user_id: "acct_9" });
  if (u.startsWith("https://api.whop.com/api/v1/products?")) return whopStatus === 200 ? json({ data: [{ company: { title: "Mi Academia" } }] }) : json({ error: { message: "unauthorized" } }, whopStatus);
  throw new Error("fetch inesperado " + u);
};

const { db } = await import(`${R}api/_lib/firebase.js`);
const api = await import(`${R}api/_lib/providers/stripeWhopApi.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const M = db().collection("merchants").doc("m1");
await M.set({ email: "dueno@tienda.com", store_name: "Academia" });
const mdoc = async () => (await M.get()).data();
const owner = { merchantId: "m1", uid: "m1", role: "owner", email: "dueno@tienda.com" };
const call = (action, body = {}, ctx = owner) => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); } };
  api.providerConnectAction(ctx, action, { body, query: { action } }, res);
});
const callback = (query) => new Promise((resolve) => {
  const res = { writeHead(code, h) { this.code = code; this.loc = h.Location; }, end() { resolve({ code: this.code, location: this.loc }); } };
  api.stripeConnectCallback({ query }, res);
});

// ── Flags ──
{
  const f = await api.providerFlags({ id: "m1", whop_api_key: "apik_SECRETA", whop_company_id: "biz_1", whop_webhook_secret: "ws_SECRETO" });
  ok(f.stripe_enabled && f.stripe_connect_available && !f.stripe_connected, "flags: Stripe prendido y conectable, sin conectar");
  ok(f.whop_enabled && f.whop_connected && f.whop_webhook_secret_set, "flags: Whop conectado con secreto");
  ok(!JSON.stringify(f).includes("SECRET"), "flags nunca incluyen la API key ni el secreto");
  const u = new URL(f.whop_webhook_url);
  ok(u.pathname === "/api/public" && u.searchParams.get("action") === "provider-webhook" && u.searchParams.get("p") === "whop" && u.searchParams.get("mid") === "m1", "URL del webhook de Whop del registro de pasarelas");
  process.env.STRIPE_ENABLED = ""; process.env.WHOP_ENABLED = "";
  const off = await api.providerFlags({ id: "m1" });
  ok(!off.stripe_enabled && !off.whop_enabled && off.whop_webhook_url === null, "flags apagados sin *_ENABLED");
  process.env.STRIPE_ENABLED = "1"; process.env.WHOP_ENABLED = "1";
  ok(api.PROVIDER_CONNECT_ACTIONS.has("save-whop") && api.STRIPE_CALLBACK_ACTION === "stripe-connect-callback", "acciones exportadas para merchant.js");
}

// ── Stripe Connect ──
let state;
{
  ok((await call("stripe-connect-start", {}, { ...owner, role: "member" })).status === 403, "miembro del equipo no puede conectar Stripe");
  const r = await call("stripe-connect-start");
  const u = new URL(r.url);
  state = u.searchParams.get("state");
  ok(u.origin === "https://connect.stripe.com" && u.searchParams.get("client_id") === "ca_test" && u.searchParams.get("scope") === "read_write", "start → URL de Connect OAuth");
  ok(u.searchParams.get("redirect_uri") === "https://www.recurrentesapp.com/api/merchant?action=stripe-connect-callback", "redirect_uri al callback en merchant.js");
  ok(u.searchParams.get("stripe_user[email]") === "dueno@tienda.com", "prellena el mail del dueño");

  const bad = await callback({ code: "ac_good", state: "falso.falso" });
  ok(bad.code === 302 && bad.location.includes("stripe=error") && !(await mdoc()).stripe_account_id, "state inválido → error, no guarda nada");
  const denied = await callback({ error: "access_denied", state });
  ok(denied.location.includes("stripe=error") && decodeURIComponent(denied.location).includes("Cancelaste"), "canceló en Stripe → aviso claro");
  const expired = await callback({ code: "ac_vencido", state });
  ok(expired.location.includes("stripe=error") && decodeURIComponent(expired.location).includes("expired"), "code vencido → error de Stripe");

  const good = await callback({ code: "ac_good", state });
  ok(good.code === 302 && good.location === "https://www.recurrentesapp.com/#/config/integraciones?stripe=ok", "callback OK → vuelve a Integraciones con stripe=ok");
  const d = await mdoc();
  ok(d.stripe_account_id === "acct_9" && d.stripe_country === "US" && d.stripe_default_currency === "USD" && d.stripe_charges_enabled === true && d.stripe_livemode === false && d.stripe_account_name === "Mi LLC", "guarda la cuenta conectada y sus datos");
  const f = await api.providerFlags({ id: "m1", ...d });
  ok(f.stripe_connected && f.stripe_account_id === "acct_9", "flags: Stripe conectado");

  calls.length = 0;
  const dis = await call("disconnect-stripe");
  const d2 = await mdoc();
  ok(dis.ok && !d2.stripe_account_id && !d2.stripe_country && d2.stripe_disconnected_at, "disconnect-stripe borra la conexión");
  ok(calls.some(c => c.url === "https://connect.stripe.com/oauth/deauthorize" && c.body.includes("stripe_user_id=acct_9")), "y la desautoriza en Stripe");
}

// ── Whop ──
{
  ok((await call("save-whop", { api_key: "k", company_id: "biz_1" }, { ...owner, role: "member" })).status === 403, "miembro no puede conectar Whop");
  const bad = await call("save-whop", { api_key: "apik_1", company_id: "biz_1", webhook_secret: "corto" });
  ok(bad.status === 400 && /incompleto/.test(bad.error), "secreto demasiado corto → 400");
  whopStatus = 401;
  const unauthorized = await call("save-whop", { api_key: "apik_mala", company_id: "biz_1" });
  ok(unauthorized.status === 400 && unauthorized.error === "La API key no es válida" && !(await mdoc()).whop_api_key, "API key inválida → 400, no guarda");
  whopStatus = 200;

  const r = await call("save-whop", { api_key: "apik_1", company_id: "biz_1", webhook_secret: "ws_secret_1234567890" });
  const d = await mdoc();
  ok(r.ok && r.whop_company_title === "Mi Academia" && r.whop_webhook_secret_set && r.whop_webhook_url.includes("p=whop"), "save-whop valida y responde flags");
  ok(!JSON.stringify(r).includes("apik_1") && !JSON.stringify(r).includes("ws_secret"), "la respuesta no devuelve claves");
  ok(d.whop_api_key === "apik_1" && d.whop_company_id === "biz_1" && d.whop_webhook_secret === "ws_secret_1234567890" && d.whop_connected_at, "guarda las claves en el merchant");

  calls.length = 0;
  const partial = await call("save-whop", { company_id: "biz_1", webhook_secret: "ws_nuevo_secreto_000" });
  ok(partial.ok && calls.length === 0 && (await mdoc()).whop_webhook_secret === "ws_nuevo_secreto_000" && (await mdoc()).whop_api_key === "apik_1", "cambiar solo el secreto no revalida ni pisa la clave");

  const dis = await call("disconnect-whop");
  const d2 = await mdoc();
  ok(dis.ok && !d2.whop_api_key && !d2.whop_webhook_secret && !d2.whop_company_id && d2.whop_disconnected_at, "disconnect-whop borra las claves");

  process.env.WHOP_ENABLED = "";
  ok((await call("save-whop", { api_key: "apik_1", company_id: "biz_1" })).status === 400, "con WHOP_ENABLED apagado no se puede conectar");
  process.env.WHOP_ENABLED = "1";
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
