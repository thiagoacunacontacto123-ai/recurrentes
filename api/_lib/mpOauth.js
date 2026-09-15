// OAuth de Mercado Pago (authorization code + PKCE S256): el comerciante conecta
// su cuenta en un clic, sin pegar el Access Token.
//
// Docs oficiales (revisadas 2026-09-15):
//   https://www.mercadopago.com.ar/developers/es/docs/security/oauth/creation
//   https://www.mercadopago.com.ar/developers/es/reference/oauth/_oauth_token/post
//   - code de autorización: vale 10 min · access_token: 180 días (expires_in 15552000)
//   - refresh (grant_type=refresh_token) ROTA el refresh_token: hay que guardarlo de nuevo
//   - PKCE: se activa en la app (Detalles → Editar); con PKCE activo MP EXIGE
//     code_challenge + code_challenge_method y después code_verifier en el canje.
//   - Errores del canje: invalid_grant (code/refresh vencido, usado o revocado, o
//     redirect_uri distinta), invalid_client, unauthorized_client, invalid_request, 429.
//
// Flujo:
//   1) merchant?action=mp-oauth-start (dueño logueado) → startMpOauth(): guarda
//      nonce + code_verifier en oauth_states/{nonce} (colección cerrada por las
//      rules; el doc del merchant lo puede leer el cliente) y firma el state
//      {p:"mp_oauth", mid, uid, n} con vencimiento de 10 min.
//   2) MP redirige a /api/mp/oauth-callback → handleMpOauthCallback(): valida firma,
//      vencimiento y propósito, consume el nonce (un solo uso, mismo mid/uid), canjea
//      el code con el code_verifier, lee /users/me y guarda la conexión.
//   3) cron paso 0 → refreshMpTokenIfNeeded(): renueva 7 días antes de vencer. Si MP
//      contesta invalid_grant (el vendedor revocó el permiso o venció), marca
//      mp_reconnect_required_at y el panel muestra "Reconectar".
// Nunca se loguean tokens, codes ni el code_verifier.
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { signToken, verifyToken } from "./token.js";
import { appBaseUrl, isProd } from "./config.js";
import { fetchWithTimeout } from "./http.js";
import { mpMe, mpRefreshToken } from "./mp.js";

const AUTH_URL = "https://auth.mercadopago.com.ar/authorization";
const TOKEN_URL = "https://api.mercadopago.com/oauth/token";
const STATES = "oauth_states";
const STATE_PURPOSE = "mp_oauth";
const STATE_TTL_SEC = 600;                 // = vida del code de MP
const H = 60 * 60 * 1000;
const D = 24 * H;
export const MP_TOKEN_DEFAULT_TTL_SEC = 15552000; // 180 días (doc)
const REFRESH_BEFORE_MS = 7 * D;           // renovar 7 días antes de vencer
const REFRESH_RETRY_MS = 1 * H;            // tras un error transitorio, reintentar en 1 h
const SOFT_ERROR_WINDOW_MS = 3 * D;        // 401/403 recientes → aviso en el panel

// Orígenes a los que volvemos después de autorizar (el login de Firebase es por
// origen: si arrancó en recurrentess.vercel.app, vuelve ahí y no en www).
const KNOWN_ORIGINS = ["https://www.recurrentesapp.com", "https://recurrentesapp.com", "https://recurrentess.vercel.app"];

const iso = (t) => new Date(t).toISOString();
const tsMs = (v) => {
  if (!v) return 0;
  if (typeof v.toDate === "function") return v.toDate().getTime();
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};

export const mpOauthConfigured = () => Boolean(process.env.MP_APP_ID && process.env.MP_CLIENT_SECRET);
export const mpRedirectUri = () => (process.env.MP_REDIRECT_URI || "").trim() || `${appBaseUrl()}/api/mp/oauth-callback`;
// PKCE activo salvo MP_OAUTH_PKCE=off (tiene que coincidir con el switch de la app en MP).
export const mpPkceEnabled = () => !/^(0|off|false|no)$/i.test(String(process.env.MP_OAUTH_PKCE || "").trim());

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString("base64url"); // 64 caracteres (43–128)
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function safeReturnOrigin(raw) {
  const base = appBaseUrl();
  let origin = "";
  try { origin = new URL(String(raw || "")).origin; } catch (_) { return base; }
  if (!isProd() && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  const allowed = new Set(KNOWN_ORIGINS);
  try { if (base) allowed.add(new URL(base).origin); } catch (_) {}
  return allowed.has(origin) ? origin : base;
}

// 1) URL de autorización. `mid` = tienda activa, `uid` = login que la inicia (dueño).
export async function startMpOauth({ mid, uid, returnTo }) {
  if (!mpOauthConfigured()) return { error: "La conexión automática con Mercado Pago no está disponible. Pegá tu Access Token." };
  if (!mid || !uid) return { error: "Falta la tienda" };
  const n = crypto.randomBytes(16).toString("hex");
  const pkce = mpPkceEnabled() ? pkcePair() : null;
  const now = Date.now();
  await db().collection(STATES).doc(n).set({
    provider: "mercadopago",
    mid: String(mid),
    uid: String(uid),
    code_verifier: pkce ? pkce.verifier : null,
    return_to: safeReturnOrigin(returnTo),
    created_at: iso(now),
    expire_at: new Date(now + STATE_TTL_SEC * 1000), // Date → sirve para una política TTL de Firestore
  });
  const state = signToken({ p: STATE_PURPOSE, mid: String(mid), uid: String(uid), n }, STATE_TTL_SEC);
  const q = new URLSearchParams({
    client_id: process.env.MP_APP_ID,
    response_type: "code",
    platform_id: "mp",
    state,
    redirect_uri: mpRedirectUri(),
  });
  if (pkce) { q.set("code_challenge", pkce.challenge); q.set("code_challenge_method", "S256"); }
  return { url: `${AUTH_URL}?${q.toString()}` };
}

// Solo para elegir el mensaje: un state con firma inválida nunca se usa para nada más.
function stateLooksExpired(state) {
  try {
    const body = JSON.parse(Buffer.from(String(state).split(".")[0], "base64url").toString("utf8"));
    return Boolean(body?.exp && body.exp < Math.floor(Date.now() / 1000));
  } catch (_) { return false; }
}

function tokenErrorReason(status, data) {
  const code = String(data?.error || "").toLowerCase();
  const text = `${code} ${String(data?.message || "").toLowerCase()}`;
  if (status === 429) return "rate_limited";
  if (/verifier|challenge|pkce/.test(text)) return "pkce";
  if (code === "invalid_grant") return "code_expired";
  if (code === "invalid_client" || code === "unauthorized_client" || code === "unsupported_grant_type") return "config";
  if (status >= 500) return "mp_down";
  return "exchange";
}

// Canje del code. Lanza Error con `reason` (para el panel), `status` y `mp_error`.
export async function exchangeMpCode(code, verifier) {
  const body = {
    client_id: process.env.MP_APP_ID,
    client_secret: process.env.MP_CLIENT_SECRET,
    grant_type: "authorization_code",
    code: String(code),
    redirect_uri: mpRedirectUri(),
  };
  if (verifier) body.code_verifier = verifier;
  let r;
  try {
    r = await fetchWithTimeout(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
    }, 10000);
  } catch (e) {
    const err = new Error(`red: ${e?.message || e}`);
    err.reason = "network";
    throw err;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.access_token) {
    const err = new Error(`HTTP ${r.status} ${data?.error || ""} ${String(data?.message || "").slice(0, 150)}`.trim());
    err.reason = tokenErrorReason(r.status, data);
    err.status = r.status;
    err.mp_error = data?.error || null;
    throw err;
  }
  return data;
}

// 2) Callback. Devuelve { reason: "ok"|<error>, returnTo, warn?: [], detail? }. Nunca lanza
//    por errores de MP; solo por fallas de Firestore (el handler lo convierte en "save").
export async function handleMpOauthCallback(query = {}) {
  const base = appBaseUrl();
  const { code, state, error, error_description } = query;
  const payload = state ? verifyToken(String(state)) : null;
  if (!payload || payload.p !== STATE_PURPOSE || !payload.mid || !payload.uid || !payload.n) {
    return { reason: state && stateLooksExpired(state) ? "expired" : "state", returnTo: base };
  }

  // Un solo uso: el nonce se borra apenas llega (salga bien o mal).
  const sref = db().collection(STATES).doc(String(payload.n));
  const ssnap = await sref.get();
  const pend = ssnap.exists ? ssnap.data() : null;
  if (pend) await sref.delete().catch(() => {});
  if (!pend || pend.provider !== "mercadopago" || pend.mid !== payload.mid || pend.uid !== payload.uid) {
    return { reason: "state_used", returnTo: base };
  }
  const returnTo = pend.return_to || base;
  if (tsMs(pend.expire_at) && tsMs(pend.expire_at) < Date.now()) return { reason: "expired", returnTo };

  if (error) {
    const txt = `${error} ${error_description || ""}`;
    if (/denied|cancel/i.test(txt)) return { reason: "cancelled", returnTo };
    return { reason: "mp_error", returnTo, detail: String(error_description || error).slice(0, 120) };
  }
  if (!code) return { reason: "cancelled", returnTo };
  if (!mpOauthConfigured()) return { reason: "config", returnTo };

  const mid = String(pend.mid);
  const mref = db().collection("merchants").doc(mid);
  const msnap = await mref.get();
  if (!msnap.exists) return { reason: "state", returnTo };
  const prev = msnap.data() || {};

  let tok;
  try {
    tok = await exchangeMpCode(code, pend.code_verifier || null);
  } catch (e) {
    // Sin tokens ni code en el log: solo status + código de error de MP.
    console.error(`[mp-oauth] canje falló (${mid}): ${e.reason} · ${e.message}`);
    return { reason: e.reason || "exchange", returnTo };
  }

  let me = null;
  try { me = await mpMe(tok.access_token); }
  catch (e) { console.warn(`[mp-oauth] /users/me falló (${mid}): HTTP ${e?.status || "-"}`); }

  const now = Date.now();
  const userId = tok.user_id != null ? String(tok.user_id) : (me?.id != null ? String(me.id) : null);
  const sameAccount = Boolean(prev.mp_user_id && userId && String(prev.mp_user_id) === userId);
  const del = FieldValue.delete();
  await mref.set({
    mp_access_token: tok.access_token,
    mp_refresh_token: tok.refresh_token || del,
    mp_token_expires_at: iso(now + (Number(tok.expires_in) || MP_TOKEN_DEFAULT_TTL_SEC) * 1000),
    mp_user_id: userId,
    mp_public_key: tok.public_key || del,
    mp_live_mode: typeof tok.live_mode === "boolean" ? tok.live_mode : null,
    mp_scope: tok.scope || null,
    mp_email: me?.email || (sameAccount ? prev.mp_email || null : null),
    mp_country: me?.country_id || (sameAccount ? prev.mp_country || null : null),
    mp_nickname: me?.nickname || null,
    mp_connected_at: iso(now),
    mp_method: "oauth",
    mp_disconnected_at: null,
    mp_token_refreshed_at: del,
    mp_token_invalid_at: del,
    mp_token_error: del,
    mp_token_refresh_error: del,
    mp_token_refresh_error_at: del,
    mp_reconnect_required_at: del,
    mp_reconnect_reason: del,
  }, { merge: true });

  const warn = [];
  if (prev.mp_user_id && userId && !sameAccount) warn.push("changed");
  if (tok.live_mode === false) warn.push("test");
  if (me?.country_id && me.country_id !== "AR") warn.push("country");
  if (!tok.refresh_token) warn.push("no_refresh");
  console.log(`[mp-oauth] conectado ${mid} → cuenta MP ${userId || "?"}${warn.length ? ` (avisos: ${warn.join(",")})` : ""}`);
  return { reason: "ok", returnTo, warn };
}

// 3) Renovación (cron paso 0). Muta md.mp_access_token/mp_refresh_token si renueva.
//   → { status: "skip" | "backoff" | "refreshed" | "reconnect" | "raced" | "error", error? }
// Solo conexiones OAuth: un token pegado a mano nunca se "renueva" con un refresh
// viejo que haya quedado en el doc.
export async function refreshMpTokenIfNeeded(ref, md, now = Date.now()) {
  if (!md?.mp_refresh_token || !md.mp_token_expires_at) return { status: "skip" };
  if (md.mp_method === "manual") return { status: "skip" };
  if (md.mp_reconnect_required_at) return { status: "skip" };
  if (tsMs(md.mp_token_expires_at) > now + REFRESH_BEFORE_MS) return { status: "skip" };
  const lastErr = tsMs(md.mp_token_refresh_error_at);
  if (lastErr && now - lastErr < REFRESH_RETRY_MS) return { status: "backoff" };

  const used = md.mp_refresh_token;
  let t;
  try {
    t = await mpRefreshToken(used);
  } catch (e) {
    const code = String(e?.mp_error || "").toLowerCase();
    const permanent = code === "invalid_grant" || code === "unauthorized_client";
    const msg = `HTTP ${e?.status || "-"} ${code || String(e?.message || e).slice(0, 120)}`.trim();
    let raced = false;
    // Si otra corrida (o una reconexión) ya cambió el refresh_token, este fallo es
    // por usar uno viejo: no marcamos nada.
    await db().runTransaction(async (tx) => {
      const cur = (await tx.get(ref)).data() || {};
      if (cur.mp_refresh_token !== used) { raced = true; return; }
      tx.set(ref, permanent
        ? { mp_reconnect_required_at: iso(now), mp_reconnect_reason: "refresh_invalid", mp_refresh_token: FieldValue.delete(), mp_token_refresh_error: msg, mp_token_refresh_error_at: iso(now) }
        : { mp_token_refresh_error: msg, mp_token_refresh_error_at: iso(now) }, { merge: true });
    });
    if (raced) return { status: "raced" };
    return { status: permanent ? "reconnect" : "error", error: msg };
  }

  const patch = {
    mp_access_token: t.access_token,
    mp_refresh_token: t.refresh_token || used,
    mp_token_expires_at: iso(now + (Number(t.expires_in) || MP_TOKEN_DEFAULT_TTL_SEC) * 1000),
    mp_token_refreshed_at: iso(now),
    mp_token_invalid_at: null,
    mp_token_error: null,
    mp_token_refresh_error: FieldValue.delete(),
    mp_token_refresh_error_at: FieldValue.delete(),
    ...(t.public_key ? { mp_public_key: t.public_key } : {}),
    ...(typeof t.live_mode === "boolean" ? { mp_live_mode: t.live_mode } : {}),
  };
  let raced = false;
  await db().runTransaction(async (tx) => {
    const cur = (await tx.get(ref)).data() || {};
    // Se reconectó mientras renovábamos: no pisar la conexión nueva con la vieja.
    if (cur.mp_refresh_token !== used) { raced = true; return; }
    tx.set(ref, patch, { merge: true });
  });
  if (raced) return { status: "raced" };
  md.mp_access_token = t.access_token;
  md.mp_refresh_token = patch.mp_refresh_token;
  return { status: "refreshed" };
}

// Estado de la conexión para el panel (GET /api/merchant). Sin tokens.
//   mp_reconnect_required: el acceso ya no sirve o está por dejar de servir
//     (refresh rechazado por MP, u OAuth vencido) → pastilla "Reconectar".
//   mp_last_error: MP rechazó el token hace poco (401/403 en un sync/webhook),
//     aviso suave: a veces es puntual.
export function mpConnectionStatus(m = {}, now = Date.now()) {
  const out = { mp_reconnect_required: false, mp_reconnect_reason: null, mp_last_error: null, mp_last_error_at: null };
  if (!m?.mp_access_token) return out;
  if (m.mp_reconnect_required_at) {
    out.mp_reconnect_required = true;
    out.mp_reconnect_reason = m.mp_reconnect_reason || "refresh_invalid";
  } else if (m.mp_method === "oauth" && m.mp_token_expires_at && tsMs(m.mp_token_expires_at) <= now) {
    out.mp_reconnect_required = true;
    out.mp_reconnect_reason = "expired";
  }
  const inv = tsMs(m.mp_token_invalid_at);
  if (!out.mp_reconnect_required && inv && now - inv < SOFT_ERROR_WINDOW_MS
      && inv >= tsMs(m.mp_connected_at) && inv >= tsMs(m.mp_token_refreshed_at)) {
    out.mp_last_error = /HTTP 401/.test(String(m.mp_token_error || "")) ? "token_rejected" : "forbidden";
    out.mp_last_error_at = iso(inv);
  }
  return out;
}
