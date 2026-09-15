// Health: auth (401/403/200), nunca devuelve valores de env, APP_BASE_URL canónica,
// Firestore y heartbeat de los crons. Pasa por el handler REAL de api/cron.js.
// Uso: node tests/reliability/health.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

// Valores "secretos" reconocibles: ninguno puede aparecer en la respuesta.
const SENT = {
  APP_BASE_URL: "https://sentinel-app-url.example",
  CRON_SECRET: "SENTINEL_cron_secret_123",
  PORTAL_SECRET: "SENTINEL_portal_secret",
  FIREBASE_PROJECT_ID: "SENTINEL_project",
  FIREBASE_CLIENT_EMAIL: "sentinel-sa@sentinel.iam.gserviceaccount.com",
  FIREBASE_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nSENTINELKEYDATA\\n-----END PRIVATE KEY-----\\n",
  MP_WEBHOOK_SECRET: "SENTINEL_mp_webhook",
  MP_APP_ID: "SENTINEL_mp_app",
  MP_CLIENT_SECRET: "SENTINEL_mp_client_secret",
  SHOPIFY_API_KEY: "SENTINEL_shopify_key",
  SHOPIFY_API_SECRET: "SENTINEL_shopify_secret",
  RESEND_API_KEY: "re_SENTINEL_resend",
  EMAIL_FROM: "Sentinel <sentinel-from@example.com>",
  TIENDANUBE_APP_ID: "SENTINEL_tn_app",
  TIENDANUBE_CLIENT_SECRET: "SENTINEL_tn_secret",
  MOBBEX_API_KEY: "SENTINEL_mobbex",
  STRIPE_SECRET_KEY: "sk_SENTINEL_stripe",
  WHOP_API_KEY: "SENTINEL_whop",
  WHATSAPP_TOKEN: "SENTINEL_whatsapp",
  ADMIN_EMAILS: "Admin@Recurrentes.test, otro@recurrentes.test",
  PLATFORM_ALERT_EMAIL: "sentinel-alerts@example.com",
};
Object.assign(process.env, SENT);
delete process.env.FULFILL_RETRY_ENABLED;
globalThis.__ID_TOKENS = {
  tok_admin: { uid: "u1", email: "admin@recurrentes.test", email_verified: true },
  tok_admin_unverified: { uid: "u2", email: "otro@recurrentes.test", email_verified: false },
  tok_merchant: { uid: "u3", email: "dueno@tienda.com", email_verified: true },
};

const R = new URL("../../", import.meta.url).href;
const { default: cron } = await import(`${R}api/cron.js`);
const { cronHeartbeat, CANONICAL_BASE_URL } = await import(`${R}api/_lib/health.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const call = (headers = {}, query = {}) => new Promise((resolve) => {
  const res = {
    _s: 200, _h: {},
    status(c) { this._s = c; return this; },
    setHeader(k, v) { this._h[k] = v; },
    json(o) { resolve({ status: this._s, body: o, headers: this._h }); },
  };
  cron({ method: "GET", headers, query: { action: "health", ...query } }, res);
});
const bearer = (t) => ({ authorization: `Bearer ${t}` });

// ── Auth ──
ok((await call()).status === 401, "sin token → 401");
ok((await call(bearer("cualquier-cosa"))).status === 401, "token inválido → 401");
ok((await call({}, { token: SENT.CRON_SECRET })).status === 401, "?token= (query) no sirve para health → 401");
ok((await call(bearer(SENT.CRON_SECRET + "x"))).status === 401, "CRON_SECRET casi igual → 401");
ok((await call(bearer("tok_merchant"))).status === 403, "login válido que no está en ADMIN_EMAILS → 403");
ok((await call(bearer("tok_admin_unverified"))).status === 403, "admin con mail SIN verificar → 403");
const asAdmin = await call(bearer("tok_admin"));
ok(asAdmin.status === 200 && asAdmin.body.via === "admin", "admin verificado (mail con mayúsculas en ADMIN_EMAILS) → 200 via admin");
const asCron = await call(bearer(SENT.CRON_SECRET));
ok(asCron.status === 200 && asCron.body.via === "cron", "Bearer CRON_SECRET → 200 via cron");
ok(asCron.headers["Cache-Control"] === "no-store", "respuesta no cacheable");

// ── Nunca valores ──
const txt = JSON.stringify(asAdmin.body) + JSON.stringify(asCron.body);
// Partes identificables de cada valor (las que llevan SENTINEL o son mails); palabras
// sueltas como "PRIVATE" también están en los NOMBRES de las variables.
const leaked = Object.entries(SENT).flatMap(([k, v]) => String(v).split(/[,<>\s]+|\\n/).filter(p => /sentinel|@/i.test(p)).filter(p => txt.toLowerCase().includes(p.toLowerCase())).map(p => `${k}:${p}`));
ok(leaked.length === 0, "ningún valor de env aparece en la respuesta" + (leaked.length ? " — FUGA: " + leaked.join(", ") : ""));
const b = asAdmin.body;
const allBool = (o) => Object.values(o).every(v => typeof v === "boolean");
ok(Object.values(b.env).every(g => allBool(g.vars)), "cada grupo de env tiene solo booleanos en vars");
ok(b.env.core.configured && b.env.firebase.configured && b.env.firebase.private_key_format_ok, "core + firebase configurados, clave con formato válido");
ok(b.env.tiendanube.configured && b.env.tiendanube.vars.TIENDANUBE_CLIENT_SECRET === true, "Tiendanube detectado");
ok(b.env.mobbex.vars.MOBBEX_API_KEY === true && b.env.stripe.vars.STRIPE_SECRET_KEY === true && b.env.whop.configured && b.env.whatsapp.configured, "Mobbex/Stripe/Whop/WhatsApp por prefijo (solo nombres)");
ok(b.env.klaviyo.configured === false && b.env.mercadopago_oauth.configured === false, "Klaviyo (sin env) y MP OAuth incompleto (falta MP_REDIRECT_URI) → false");
ok(b.env.flags.vars.FULFILL_RETRY_ENABLED === false && b.fulfillment.retry_enabled === false, "reintento de órdenes apagado por defecto");
ok(b.firestore.reachable === true, "Firestore alcanzable");

// ── APP_BASE_URL ──
ok(b.app_base_url.canonical === false && b.summary.required_failed.some(s => /APP_BASE_URL/.test(s)) && b.ok === false, "APP_BASE_URL distinta de la canónica → falla requerida");
process.env.APP_BASE_URL = CANONICAL_BASE_URL + "/";
ok((await call(bearer("tok_admin"))).body.app_base_url.canonical === false, "con barra final → no es canónica");
process.env.APP_BASE_URL = CANONICAL_BASE_URL;
let h = (await call(bearer("tok_admin"))).body;
ok(h.app_base_url.canonical === true && !h.summary.required_failed.some(s => /APP_BASE_URL/.test(s)), "exactamente https://www.recurrentesapp.com → canónica");

// ── Crons ──
ok(h.crons["sync-all-pending"].stale === true && h.crons["sync-all-pending"].last_ok_at === null && h.ok === false, "sin heartbeat → cron atrasado y ok=false");
await cronHeartbeat("sync-all-pending", { ok: true, elapsed_ms: 1200 });
await cronHeartbeat("run-flows", { ok: true });
await cronHeartbeat("retry-fulfillment", { ok: true });
h = (await call(bearer("tok_admin"))).body;
ok(Object.values(h.crons).every(c => c.stale === false && c.last_ok_at), "con heartbeat reciente → ningún cron atrasado");
ok(h.ok === true && h.summary.required_failed.length === 0, "todo en orden → ok=true");
await cronHeartbeat("run-flows", { ok: false, error: "boom" });
h = (await call(bearer("tok_admin"))).body;
ok(h.crons["run-flows"].last_run_ok === false && h.crons["run-flows"].last_ok_at, "corrida fallida: se ve, pero conserva el último OK");
await cronHeartbeat("otro-cron-nuevo", { ok: true });
h = (await call(bearer("tok_admin"))).body;
ok(h.crons["otro-cron-nuevo"] && h.crons["otro-cron-nuevo"].stale === false, "crons que agreguen otros (sin intervalo conocido) aparecen igual");

// ── Firestore caído / env faltante ──
globalThis.__FS_DOWN = true;
h = (await call(bearer(SENT.CRON_SECRET))).body;
globalThis.__FS_DOWN = false;
ok(h.firestore.reachable === false && h.firestore.error_code === "UNAVAILABLE" && h.ok === false, "Firestore caído → reachable=false (solo el código) y ok=false");
delete process.env.CRON_SECRET;
ok((await call(bearer(SENT.CRON_SECRET))).status === 401, "sin CRON_SECRET configurado, ese bearer ya no entra (fail closed)");
h = (await call(bearer("tok_admin"))).body;
ok(h.env.core.configured === false && h.summary.required_failed.some(s => /Base/.test(s)), "sin CRON_SECRET → grupo Base incompleto");

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
