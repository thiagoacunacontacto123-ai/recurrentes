// Tests del OAuth de Mercado Pago: inicio, callback (state válido / inválido /
// vencido / reusado, cancelación, fallas del canje) y renovación del cron
// (éxito, invalid_grant, error transitorio, carreras). Firestore en memoria y
// fetch falso: nunca toca MP ni la base real.
//   node tests/mp-oauth/mp-oauth.test.mjs      (VERBOSE=1 para ver los logs)
import { register } from "node:module";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.MP_APP_ID = "1234567890";
process.env.MP_CLIENT_SECRET = "secret_de_prueba";
process.env.PORTAL_SECRET = "portal_secret_test";
process.env.CRON_SECRET = "cron_test";
delete process.env.MP_REDIRECT_URI;
delete process.env.MP_OAUTH_PKCE;
delete process.env.VERCEL_ENV;

// Logs capturados: al final verificamos que ningún token/code/secret aparezca.
const logs = [];
for (const k of ["log", "info", "warn", "error"]) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { logs.push(a.map(String).join(" ")); if (process.env.VERBOSE) orig(...a); };
}
const out = (s) => process.stdout.write(s + "\n");

// ── fetch falso ──
const calls = [];
let tokenReply = () => ({ status: 500, json: { message: "sin configurar" } });
let meReply = () => ({ status: 200, json: { id: 777, email: "tienda@mp.com", country_id: "AR", nickname: "TIENDA" } });
const tokenCalls = () => calls.filter(c => c.url === "https://api.mercadopago.com/oauth/token");
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, body: opts.body ? JSON.parse(opts.body) : null });
  const reply = u === "https://api.mercadopago.com/oauth/token" ? tokenReply(JSON.parse(opts.body))
    : u.startsWith("https://api.mercadopago.com/users/me") ? meReply() : null;
  if (!reply) throw new Error("fetch inesperado " + u);
  if (reply instanceof Error) throw reply;
  return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
};

const R = new URL("../../", import.meta.url).pathname;
const { db } = await import(`${R}api/_lib/firebase.js`);
const oauth = await import(`${R}api/_lib/mpOauth.js`);
const { signToken, verifyToken } = await import(`${R}api/_lib/token.js`);
const callback = (await import(`${R}api/mp/oauth-callback.js`)).default;
const cron = (await import(`${R}api/cron.js`)).default;
const { mpOauthReturnToast } = await import(`${R}src/lib/mpOauth.js`);

let fails = 0;
const ok = (c, msg) => { out((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const D = 86400000;
const iso = (t) => new Date(t).toISOString();
const M = (id) => db().collection("merchants").doc(id);
const mdoc = async (id) => (await M(id).get()).data();
const stateDoc = async (n) => (await db().collection("oauth_states").doc(n).get());

const hit = (query) => new Promise((resolve) => {
  const res = {
    writeHead(s, h) { this.s = s; this.h = h; },
    end() {
      const loc = new URL(this.h.Location.replace("/#/dashboard?", "/?"));
      resolve({ status: this.s, headers: this.h, q: Object.fromEntries(loc.searchParams), origin: loc.origin });
    },
  };
  callback({ query }, res);
});
const runCron = () => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); } };
  cron({ method: "GET", headers: { authorization: "Bearer cron_test" }, query: { action: "sync-all-pending" } }, res);
});
const start = async (returnTo = "https://recurrentess.vercel.app", mid = "m1", uid = "u1") => {
  const s = await oauth.startMpOauth({ mid, uid, returnTo });
  const u = new URL(s.url);
  const state = u.searchParams.get("state");
  return { url: u, state, n: verifyToken(state)?.n };
};
const okToken = (over = {}) => (b) => ({ status: 200, json: {
  access_token: "APP_USR-access-1", token_type: "bearer", expires_in: 15552000, scope: "offline_access read write",
  user_id: 777, refresh_token: "TG-refresh-1", public_key: "APP_USR-pub-1", live_mode: true, ...over,
} });

await M("m1").set({ email: "dueno@x.com", store_name: "Lumina", mp_token_invalid_at: iso(Date.now() - D), mp_token_error: "x: HTTP 401", mp_reconnect_required_at: iso(Date.now() - D) });

// ─── 1) Inicio ───────────────────────────────────────────────────────────────
{
  const { url, state, n } = await start();
  ok(url.origin + url.pathname === "https://auth.mercadopago.com.ar/authorization", "URL de autorización de MP Argentina");
  ok(url.searchParams.get("client_id") === "1234567890" && url.searchParams.get("response_type") === "code" && url.searchParams.get("platform_id") === "mp", "client_id + response_type=code + platform_id=mp");
  ok(url.searchParams.get("redirect_uri") === "https://www.recurrentesapp.com/api/mp/oauth-callback", "sin MP_REDIRECT_URI, la redirect sale de APP_BASE_URL");
  const p = verifyToken(state);
  ok(p?.p === "mp_oauth" && p.mid === "m1" && p.uid === "u1" && p.exp - Math.floor(Date.now() / 1000) <= 600, "state firmado con propósito, tienda, login y 10 min de vida");
  const sd = (await stateDoc(n)).data();
  const challenge = crypto.createHash("sha256").update(sd.code_verifier).digest("base64url");
  ok(url.searchParams.get("code_challenge_method") === "S256" && url.searchParams.get("code_challenge") === challenge, "PKCE S256: el challenge es el sha256 del verifier guardado");
  ok(sd.code_verifier.length >= 43 && sd.code_verifier.length <= 128 && !url.href.includes(sd.code_verifier), "el verifier (43–128) no viaja en la URL");
  ok(sd.mid === "m1" && sd.uid === "u1" && sd.return_to === "https://recurrentess.vercel.app", "nonce guardado del lado del server con tienda, login y dominio de vuelta");
  const evil = await start("https://evil.example.com");
  ok((await stateDoc(evil.n)).data().return_to === "https://www.recurrentesapp.com", "un dominio ajeno como vuelta se reemplaza por APP_BASE_URL");
  process.env.MP_REDIRECT_URI = "https://www.recurrentesapp.com/api/mp/oauth-callback?x=1";
  ok((await start()).url.searchParams.get("redirect_uri") === process.env.MP_REDIRECT_URI, "MP_REDIRECT_URI manda si está seteada");
  delete process.env.MP_REDIRECT_URI;
  delete process.env.MP_CLIENT_SECRET;
  const nc = await oauth.startMpOauth({ mid: "m1", uid: "u1" });
  ok(Boolean(nc.error) && !oauth.mpOauthConfigured(), "sin MP_CLIENT_SECRET no se ofrece OAuth");
  process.env.MP_CLIENT_SECRET = "secret_de_prueba";
}

// ─── 2) Callback con state válido ────────────────────────────────────────────
let firstState;
{
  const { state, n } = await start();
  firstState = state;
  const verifier = (await stateDoc(n)).data().code_verifier;
  let body = null;
  tokenReply = (b) => { body = b; return okToken()(b); };
  const t0 = Date.now();
  const r = await hit({ code: "TG-code-1", state });
  ok(r.status === 302 && r.q.mp === "ok" && !r.q.warn, `vuelve al panel con mp=ok (${JSON.stringify(r.q)})`);
  ok(r.origin === "https://recurrentess.vercel.app", "vuelve al mismo dominio donde arrancó (login de Firebase por origen)");
  ok(r.headers["Cache-Control"] === "no-store", "redirect sin caché");
  ok(body?.grant_type === "authorization_code" && body.code === "TG-code-1" && body.code_verifier === verifier
    && body.redirect_uri === "https://www.recurrentesapp.com/api/mp/oauth-callback" && body.client_secret === "secret_de_prueba", "canje: code + code_verifier + redirect_uri idéntica");
  const d = await mdoc("m1");
  ok(d.mp_access_token === "APP_USR-access-1" && d.mp_refresh_token === "TG-refresh-1" && d.mp_public_key === "APP_USR-pub-1", "guarda access, refresh y public key");
  ok(d.mp_user_id === "777" && d.mp_live_mode === true && d.mp_method === "oauth" && d.mp_scope.includes("offline_access"), "guarda user_id, live_mode, scope y método oauth");
  const exp = Date.parse(d.mp_token_expires_at) - t0;
  ok(exp > 179 * D && exp < 181 * D, "vence en 180 días");
  ok(d.mp_email === "tienda@mp.com" && d.mp_country === "AR", "mail y país desde /users/me");
  ok(!d.mp_reconnect_required_at && !d.mp_token_invalid_at && !d.mp_token_error, "limpia los avisos de reconexión viejos");
  ok(!(await stateDoc(n)).exists, "el nonce se consume");
}

// ─── 3) State inválido / vencido / reusado / con otro propósito ─────────────
{
  const before = tokenCalls().length;
  const snapBefore = JSON.stringify(await mdoc("m1"));
  const r1 = await hit({ code: "TG-code-2", state: firstState });
  ok(r1.q.mp === "error" && r1.q.reason === "state_used", `state reusado → state_used (${r1.q.reason})`);
  const tampered = firstState.slice(0, -4) + (firstState.endsWith("AAAA") ? "BBBB" : "AAAA");
  const r2 = await hit({ code: "TG-code-2", state: tampered });
  ok(r2.q.reason === "state" && r2.origin === "https://www.recurrentesapp.com", "firma alterada → state (vuelve a APP_BASE_URL)");
  ok((await hit({ code: "TG-code-2", state: "hola" })).q.reason === "state", "state basura → state");
  ok((await hit({ code: "TG-code-2" })).q.reason === "state", "sin state → state");
  const expired = signToken({ p: "mp_oauth", mid: "m1", uid: "u1", n: "zz" }, -30);
  ok((await hit({ code: "TG-code-2", state: expired })).q.reason === "expired", "state vencido → expired");
  const portal = signToken({ mid: "m1", sid: "s1" }, 3600);
  ok((await hit({ code: "TG-code-2", state: portal })).q.reason === "state", "un token del portal no sirve como state");
  const shop = signToken({ uid: "u1", mid: "m1", shop: "x.myshopify.com" }, 600);
  ok((await hit({ code: "TG-code-2", state: shop })).q.reason === "state", "el state de Shopify no sirve como state de MP");
  const forged = signToken({ p: "mp_oauth", mid: "m1", uid: "u1", n: "no-existe" }, 600);
  ok((await hit({ code: "TG-code-2", state: forged })).q.reason === "state_used", "nonce que no existe → state_used");
  const { state: s2, n: n2 } = await start();
  await db().collection("oauth_states").doc(n2).update({ uid: "otro" });
  ok((await hit({ code: "TG-code-2", state: s2 })).q.reason === "state_used", "nonce de otro login → rechazado");
  ok(tokenCalls().length === before, "ningún state malo llega a canjear el code");
  ok(JSON.stringify(await mdoc("m1")) === snapBefore, "la conexión existente no se toca");
}

// ─── 4) Cancelación y errores de MP ─────────────────────────────────────────
{
  const before = tokenCalls().length;
  const { state, n } = await start();
  const r = await hit({ error: "access_denied", error_description: "The user denied", state });
  ok(r.q.reason === "cancelled" && r.origin === "https://recurrentess.vercel.app", "el comerciante canceló → cancelled");
  ok(!(await stateDoc(n)).exists && tokenCalls().length === before, "cancelar consume el nonce y no canjea nada");
  ok((await hit({ state: (await start()).state })).q.reason === "cancelled", "vuelve sin code → cancelled");
  const other = await hit({ error: "server_error", error_description: "boom", state: (await start()).state });
  ok(other.q.reason === "mp_error" && other.q.msg === "boom", "otro error de MP → mp_error con detalle");
}
{
  const snapBefore = JSON.stringify(await mdoc("m1"));
  const cases = [
    [{ status: 400, json: { error: "invalid_grant", message: "invalid authorization code" } }, "code_expired"],
    [{ status: 400, json: { error: "invalid_client", message: "invalid client_id or client_secret" } }, "config"],
    [{ status: 400, json: { error: "invalid_request", message: "code_verifier is invalid" } }, "pkce"],
    [{ status: 429, json: { error: "local_rate_limited" } }, "rate_limited"],
    [{ status: 502, json: {} }, "mp_down"],
    [new Error("socket hang up"), "network"],
    [{ status: 200, json: { message: "sin token" } }, "exchange"],
  ];
  for (const [reply, reason] of cases) {
    tokenReply = () => reply;
    const r = await hit({ code: "TG-code-bad", state: (await start()).state });
    ok(r.q.mp === "error" && r.q.reason === reason, `falla del canje ${reply.status || "red"} ${reply.json?.error || ""} → ${reason} (${r.q.reason})`);
  }
  ok(JSON.stringify(await mdoc("m1")) === snapBefore, "si el canje falla, la conexión anterior queda intacta");
}

// ─── 5) Avisos: otra cuenta, cuenta de prueba, otro país; PKCE apagado ───────
{
  tokenReply = okToken({ user_id: 999, live_mode: false, access_token: "TEST-access-9", refresh_token: "TG-refresh-9" });
  meReply = () => ({ status: 200, json: { id: 999, email: "otra@mp.com", country_id: "BR" } });
  const r = await hit({ code: "TG-code-3", state: (await start()).state });
  ok(r.q.mp === "ok" && r.q.warn === "changed,test,country", `avisa cuenta distinta, de prueba y de otro país (${r.q.warn})`);
  const t = mpOauthReturnToast(new URLSearchParams("mp=ok&warn=changed,test"));
  ok(t.tone === "warning" && t.text.includes("cuenta de prueba"), "el panel muestra los avisos");
  ok(mpOauthReturnToast(new URLSearchParams("mp=error&reason=cancelled")).tone === "warning", "cancelar se muestra como aviso, no como error");
  meReply = () => ({ status: 401, json: { message: "invalid token" } });
  tokenReply = okToken();
  const r2 = await hit({ code: "TG-code-4", state: (await start()).state });
  ok(r2.q.mp === "ok" && (await mdoc("m1")).mp_user_id === "777", "si /users/me falla igual conecta");
  meReply = () => ({ status: 200, json: { id: 777, email: "tienda@mp.com", country_id: "AR" } });
  process.env.MP_OAUTH_PKCE = "off";
  let body = null;
  tokenReply = (b) => { body = b; return okToken()(b); };
  const s = await start();
  ok(!s.url.searchParams.has("code_challenge"), "MP_OAUTH_PKCE=off → sin code_challenge");
  await hit({ code: "TG-code-5", state: s.state });
  ok(body && !("code_verifier" in body), "MP_OAUTH_PKCE=off → sin code_verifier en el canje");
  delete process.env.MP_OAUTH_PKCE;
}

// ─── 6) Cron: renovación ─────────────────────────────────────────────────────
{
  const now = Date.now();
  await M("m1").set({ mp_token_expires_at: iso(now + 150 * D) }, { merge: true });  // lejos de vencer
  await M("m2").set({ mp_access_token: "APP_USR-old-2", mp_refresh_token: "TG-r-old-2", mp_token_expires_at: iso(now + 3 * D), mp_method: "oauth", mp_connected_at: iso(now - 170 * D) });
  await M("m3").set({ mp_access_token: "APP_USR-old-3", mp_refresh_token: "TG-r-dead-3", mp_token_expires_at: iso(now + 2 * D), mp_method: "oauth", mp_connected_at: iso(now - 170 * D) });
  await M("m4").set({ mp_access_token: "APP_USR-old-4", mp_refresh_token: "TG-r-flaky-4", mp_token_expires_at: iso(now + 2 * D), mp_method: "oauth" });
  await M("m5").set({ mp_access_token: "APP_USR-manual-5", mp_refresh_token: "TG-r-leftover-5", mp_token_expires_at: iso(now + 1 * D), mp_method: "manual" });
  const seen = [];
  tokenReply = (b) => {
    seen.push(b.refresh_token);
    if (b.grant_type !== "refresh_token" || b.client_secret !== "secret_de_prueba") return { status: 400, json: { error: "invalid_request" } };
    if (b.refresh_token === "TG-r-old-2") return { status: 200, json: { access_token: "APP_USR-new-2", refresh_token: "TG-r-new-2", expires_in: 15552000, user_id: 777, public_key: "APP_USR-pub-2", live_mode: true } };
    if (b.refresh_token === "TG-r-dead-3") return { status: 400, json: { error: "invalid_grant", message: "invalid refresh_token" } };
    return { status: 503, json: { message: "unavailable" } };
  };
  const c1 = await runCron();
  ok(c1.ok && c1.tokens_refreshed === 1 && c1.tokens_reconnect === 1, `cron: 1 renovado, 1 a reconectar (${c1.tokens_refreshed}/${c1.tokens_reconnect})`);
  ok(!seen.includes("TG-refresh-1") && !seen.includes("TG-r-leftover-5"), "no renueva tokens lejos de vencer ni tokens pegados a mano");
  const d2 = await mdoc("m2");
  ok(d2.mp_access_token === "APP_USR-new-2" && d2.mp_refresh_token === "TG-r-new-2" && Date.parse(d2.mp_token_expires_at) > now + 179 * D && d2.mp_token_refreshed_at, "éxito: guarda el access y el refresh NUEVOS (MP los rota) y el vencimiento");
  const d3 = await mdoc("m3");
  ok(d3.mp_reconnect_required_at && d3.mp_reconnect_reason === "refresh_invalid" && !d3.mp_refresh_token, "invalid_grant: marca reconectar y descarta el refresh muerto");
  ok(d3.mp_access_token === "APP_USR-old-3", "invalid_grant: el access_token actual se sigue usando mientras valga");
  const st3 = oauth.mpConnectionStatus(d3);
  ok(st3.mp_reconnect_required && st3.mp_reconnect_reason === "refresh_invalid", "el panel recibe mp_reconnect_required");
  const d4 = await mdoc("m4");
  ok(d4.mp_token_refresh_error_at && !d4.mp_reconnect_required_at && d4.mp_refresh_token === "TG-r-flaky-4", "error 503: se anota y NO pide reconectar");
  const n1 = seen.length;
  const c2 = await runCron();
  ok(c2.ok && seen.length === n1, "segunda corrida: no insiste con el refresh muerto ni con el 503 (backoff 1 h)");
}

// ─── 7) Carreras: otra corrida o una reconexión cambió el refresh ────────────
{
  const now = Date.now();
  await M("m6").set({ mp_access_token: "APP_USR-a-6", mp_refresh_token: "TG-r-2-6", mp_token_expires_at: iso(now + D), mp_method: "oauth" });
  tokenReply = () => ({ status: 400, json: { error: "invalid_grant" } });
  const r1 = await oauth.refreshMpTokenIfNeeded(M("m6"), { mp_refresh_token: "TG-r-1-6", mp_token_expires_at: iso(now + D), mp_method: "oauth" }, now);
  const d6 = await mdoc("m6");
  ok(r1.status === "raced" && !d6.mp_reconnect_required_at && d6.mp_refresh_token === "TG-r-2-6", "invalid_grant con un refresh viejo (otra corrida ya renovó) → no marca nada");
  tokenReply = () => ({ status: 200, json: { access_token: "APP_USR-stale", refresh_token: "TG-stale", expires_in: 100 } });
  const r2 = await oauth.refreshMpTokenIfNeeded(M("m6"), { mp_refresh_token: "TG-r-1-6", mp_token_expires_at: iso(now + D), mp_method: "oauth" }, now);
  ok(r2.status === "raced" && (await mdoc("m6")).mp_access_token === "APP_USR-a-6", "renovación que llega tarde no pisa una conexión más nueva");
}

// ─── 8) Estado de la conexión para el panel ─────────────────────────────────
{
  const now = Date.now();
  const s1 = oauth.mpConnectionStatus({ mp_access_token: "x", mp_method: "oauth", mp_token_expires_at: iso(now - 1000) }, now);
  ok(s1.mp_reconnect_required && s1.mp_reconnect_reason === "expired", "OAuth vencido → reconectar");
  const s2 = oauth.mpConnectionStatus({ mp_access_token: "x", mp_method: "manual", mp_token_expires_at: iso(now - 1000) }, now);
  ok(!s2.mp_reconnect_required && !s2.mp_last_error, "token pegado (Lumina) sin avisos → nada cambia");
  const s3 = oauth.mpConnectionStatus({ mp_access_token: "x", mp_connected_at: iso(now - 10 * D), mp_token_invalid_at: iso(now - D), mp_token_error: "payments_get: MP GET /v1/payments/1: HTTP 401 unauthorized" }, now);
  ok(!s3.mp_reconnect_required && s3.mp_last_error === "token_rejected", "401 reciente → aviso suave, no bloquea");
  const s4 = oauth.mpConnectionStatus({ mp_access_token: "x", mp_connected_at: iso(now - 10 * D), mp_token_invalid_at: iso(now - 5 * D), mp_token_error: "HTTP 401" }, now);
  ok(!s4.mp_last_error, "401 de hace 5 días → ya no se muestra");
  const s5 = oauth.mpConnectionStatus({ mp_access_token: "x", mp_connected_at: iso(now - 1000), mp_token_invalid_at: iso(now - D), mp_token_error: "HTTP 401" }, now);
  ok(!s5.mp_last_error, "401 anterior a la última conexión → no se muestra");
  ok(!oauth.mpConnectionStatus({ mp_reconnect_required_at: iso(now) }).mp_reconnect_required, "sin token conectado no hay nada que reconectar");
}

// ─── 9) Nunca se loguean tokens, codes, verifiers ni el secret ───────────────
{
  const secrets = ["APP_USR-access-1", "TG-refresh-1", "TG-code-", "TEST-access-9", "APP_USR-new-2", "TG-r-", "secret_de_prueba", "APP_USR-pub"];
  const leaked = logs.filter(l => secrets.some(s => l.includes(s)));
  ok(logs.length > 0 && leaked.length === 0, `logs sin secretos (${logs.length} líneas${leaked.length ? `; filtró: ${leaked[0]}` : ""})`);
}

out(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
