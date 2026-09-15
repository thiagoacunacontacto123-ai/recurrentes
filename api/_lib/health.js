// GET /api/cron?action=health — chequeo de configuración para "sellar" un deploy.
//
// Auth (propia, se evalúa ANTES de la auth del cron):
//   · Authorization: Bearer <CRON_SECRET>  (el mismo secreto que usan los crons de Vercel)
//   · Authorization: Bearer <Firebase ID token> de un mail VERIFICADO listado en
//     ADMIN_EMAILS (separados por coma).
//   Sin token → 401 · token inválido → 401 · usuario que no es admin → 403.
//
// Devuelve SOLO booleanos / fechas / nombres de variables: nunca un valor de env.
//
// Heartbeat: cada acción del cron llama a cronHeartbeat(action, resumen) al
// terminar → system/cron_heartbeat { [action]: { last_run_at, last_ok_at, ok,
// elapsed_ms, partial, errors } }. El health lo lee y marca los crons atrasados.
import { getAuth } from "firebase-admin/auth";
import { db, initAdmin } from "./firebase.js";
import { timingSafeEqualStr } from "./token.js";
import { log, logWarn } from "./log.js";

export const CANONICAL_BASE_URL = "https://www.recurrentesapp.com";
const HEARTBEAT_DOC = ["system", "cron_heartbeat"];

// Crons conocidos y cada cuánto deberían correr (vercel.json). Un cron está
// "atrasado" si su último OK tiene más de `stale_after_min`.
export const EXPECTED_CRONS = {
  "sync-all-pending": { every_min: 2, stale_after_min: 10 },
  "run-flows": { every_min: 5, stale_after_min: 20 },
  "retry-fulfillment": { every_min: 10, stale_after_min: 40 },
};

// Variables por integración. `required`: sin eso la plataforma no funciona
// (cuenta para `ok`). El resto se informa como configurada o no.
// `prefix`: además se listan (solo el NOMBRE) todas las env que empiecen así.
export const ENV_GROUPS = [
  { id: "core", label: "Base", required: true, vars: ["APP_BASE_URL", "CRON_SECRET"], anyOf: [["PORTAL_SECRET", "MP_WEBHOOK_SECRET"]] },
  { id: "firebase", label: "Firebase", required: true, vars: ["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"] },
  { id: "firebase_web", label: "Firebase (panel web)", required: false, vars: ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_AUTH_DOMAIN", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"], note: "Se usan en el build; en runtime pueden figurar vacías." },
  { id: "mercadopago", label: "Mercado Pago (webhooks)", required: false, vars: ["MP_WEBHOOK_SECRET", "MP_WEBHOOK_SIGNING_SECRET"] },
  { id: "mercadopago_oauth", label: "Mercado Pago (conexión OAuth)", required: false, vars: ["MP_APP_ID", "MP_CLIENT_SECRET", "MP_REDIRECT_URI"] },
  { id: "shopify", label: "Shopify (app)", required: false, vars: ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_SCOPES", "SHOPIFY_REDIRECT_URI"] },
  { id: "email", label: "Email (Resend)", required: false, vars: ["RESEND_API_KEY", "EMAIL_FROM"] },
  { id: "tiendanube", label: "Tiendanube", required: false, vars: ["TIENDANUBE_APP_ID", "TIENDANUBE_CLIENT_SECRET"], prefix: "TIENDANUBE_" },
  { id: "mobbex", label: "Mobbex", required: false, vars: [], prefix: "MOBBEX_" },
  { id: "stripe", label: "Stripe", required: false, vars: [], prefix: "STRIPE_" },
  { id: "whop", label: "Whop", required: false, vars: [], prefix: "WHOP_" },
  { id: "whatsapp", label: "WhatsApp", required: false, vars: [], prefix: "WHATSAPP_" },
  { id: "admin", label: "Admin y alertas", required: false, vars: ["ADMIN_EMAILS", "ADMIN_EMAIL", "PLATFORM_ALERT_EMAIL"] },
];

const isSet = (name) => String(process.env[name] ?? "").trim() !== "";
const minutesSince = (iso, now) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? Math.round((now - t) / 60000) : null; };

// Lista de admins (lowercase). Vacía = nadie entra por login (solo CRON_SECRET).
export function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "").split(/[,;\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function envReport(env = process.env) {
  const groups = {};
  for (const g of ENV_GROUPS) {
    const vars = {};
    for (const v of g.vars) vars[v] = isSet(v);
    if (g.prefix) for (const k of Object.keys(env)) if (k.startsWith(g.prefix) && isSet(k)) vars[k] = true;
    const anyOk = (g.anyOf || []).every(list => list.some(isSet));
    for (const list of g.anyOf || []) for (const v of list) vars[v] = isSet(v);
    const listed = Object.values(vars);
    const configured = g.vars.length ? g.vars.every(isSet) && anyOk : listed.some(Boolean);
    groups[g.id] = { label: g.label, required: g.required, configured, vars, ...(g.note ? { note: g.note } : {}) };
  }
  const pk = String(env.FIREBASE_PRIVATE_KEY || "");
  groups.firebase.private_key_format_ok = pk ? /BEGIN [A-Z ]*PRIVATE KEY/.test(pk.replace(/\\n/g, "\n")) : false;
  groups.flags = {
    label: "Interruptores", required: false, configured: true,
    vars: { FULFILL_RETRY_ENABLED: env.FULFILL_RETRY_ENABLED === "1" },
  };
  return groups;
}

export function appBaseUrlReport(env = process.env) {
  const raw = String(env.APP_BASE_URL || "");
  return {
    set: raw.trim() !== "",
    canonical: raw === CANONICAL_BASE_URL,
    trailing_slash: /\/$/.test(raw),
    https: /^https:\/\//.test(raw),
  };
}

// ── Heartbeat ───────────────────────────────────────────────────────
// Nunca lanza. `summary.ok === false` → registra la corrida pero no mueve last_ok_at.
export async function cronHeartbeat(action, summary = {}) {
  try {
    const at = new Date().toISOString();
    const ok = summary.ok !== false;
    const entry = {
      last_run_at: at,
      ok,
      elapsed_ms: Number(summary.elapsed_ms) || 0,
      partial: summary.partial === true,
      errors: Number(summary.errors) || 0,
      ...(ok ? { last_ok_at: at } : { last_error_at: at }),
    };
    await db().collection(HEARTBEAT_DOC[0]).doc(HEARTBEAT_DOC[1]).set({ [action]: entry, updated_at: at }, { merge: true });
  } catch (e) {
    logWarn("cron.heartbeat.fail", { action, error: e.message });
  }
}

// ── Informe ─────────────────────────────────────────────────────────
export async function buildHealth({ now = Date.now() } = {}) {
  const env = envReport();
  const base = appBaseUrlReport();

  // Firestore: UNA lectura (el doc del heartbeat, que además usamos abajo).
  const firestore = { reachable: false, latency_ms: null };
  let hb = {}, cronLast = null;
  const t0 = Date.now();
  try {
    const [hbSnap, lastSnap] = await Promise.all([
      db().collection(HEARTBEAT_DOC[0]).doc(HEARTBEAT_DOC[1]).get(),
      db().collection("system").doc("cron_last").get(),
    ]);
    firestore.reachable = true;
    firestore.latency_ms = Date.now() - t0;
    hb = hbSnap.exists ? (hbSnap.data() || {}) : {};
    cronLast = lastSnap.exists ? (lastSnap.data() || null) : null;
  } catch (e) {
    firestore.error_code = /credenciales|FIREBASE_/i.test(e.message || "") ? "no_credentials"
      : String(e.code || "").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "error";
  }

  const crons = {};
  const names = new Set([...Object.keys(EXPECTED_CRONS), ...Object.keys(hb).filter(k => hb[k] && typeof hb[k] === "object" && "last_run_at" in hb[k])]);
  for (const name of names) {
    const exp = EXPECTED_CRONS[name] || null;
    const h = hb[name] || {};
    let lastOk = h.last_ok_at || null;
    // Antes del heartbeat, sync-all-pending ya dejaba system/cron_last.
    if (!lastOk && name === "sync-all-pending" && cronLast?.ok && cronLast.at) lastOk = cronLast.at;
    const since = minutesSince(lastOk, now);
    crons[name] = {
      last_ok_at: lastOk,
      last_run_at: h.last_run_at || (name === "sync-all-pending" ? cronLast?.at || null : null),
      last_run_ok: typeof h.ok === "boolean" ? h.ok : null,
      minutes_since_ok: since,
      expected_every_min: exp?.every_min ?? null,
      stale: exp ? (since == null || since > exp.stale_after_min) : false,
    };
  }

  const failedRequired = [];
  const warnings = [];
  for (const [id, g] of Object.entries(env)) {
    if (g.required && !g.configured) failedRequired.push(`Faltan variables de ${g.label}`);
  }
  if (!env.firebase.private_key_format_ok && env.firebase.vars.FIREBASE_PRIVATE_KEY) failedRequired.push("FIREBASE_PRIVATE_KEY no parece una clave privada");
  if (!base.canonical) failedRequired.push(`APP_BASE_URL no es exactamente ${CANONICAL_BASE_URL}`);
  if (!firestore.reachable) failedRequired.push("Firestore no responde");
  for (const [name, c] of Object.entries(crons)) if (c.stale) warnings.push(`El cron ${name} no corrió bien hace ${c.minutes_since_ok == null ? "(nunca)" : c.minutes_since_ok + " min"}`);
  if (!env.email.configured) warnings.push("Resend/EMAIL_FROM sin configurar: no salen mails");
  if (!env.mercadopago.vars.MP_WEBHOOK_SIGNING_SECRET) warnings.push("MP_WEBHOOK_SIGNING_SECRET sin configurar: la firma de los webhooks de MP no se valida");
  if (!env.admin.vars.PLATFORM_ALERT_EMAIL) warnings.push("PLATFORM_ALERT_EMAIL sin configurar: las órdenes que no se crean solo se avisan al comerciante");
  if (!env.admin.vars.ADMIN_EMAILS) warnings.push("ADMIN_EMAILS vacío: este chequeo solo se puede abrir con CRON_SECRET");

  return {
    ok: failedRequired.length === 0 && !Object.values(crons).some(c => c.stale),
    checked_at: new Date(now).toISOString(),
    summary: { required_failed: failedRequired, warnings },
    app_base_url: base,
    env,
    firestore,
    crons,
    fulfillment: { retry_enabled: process.env.FULFILL_RETRY_ENABLED === "1", platform_alerts: isSet("PLATFORM_ALERT_EMAIL") },
    runtime: { production: process.env.VERCEL_ENV === "production" },
  };
}

// ── Auth + handler ──────────────────────────────────────────────────
// { ok:true, via } | { ok:false, code }
export async function healthAuth(req) {
  const bearer = String(req.headers?.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return { ok: false, code: 401 };
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && timingSafeEqualStr(bearer, cronSecret)) return { ok: true, via: "cron" };
  let decoded;
  try {
    initAdmin();
    decoded = await getAuth().verifyIdToken(bearer);
  } catch (_) {
    return { ok: false, code: 401 };
  }
  const email = String(decoded?.email || "").toLowerCase();
  if (!email || decoded.email_verified !== true || !adminEmails().includes(email)) return { ok: false, code: 403 };
  return { ok: true, via: "admin" };
}

export async function healthHandler(req, res) {
  const auth = await healthAuth(req);
  if (!auth.ok) {
    logWarn("health.denied", { code: auth.code });
    return res.status(auth.code).json({ error: auth.code === 401 ? "Unauthorized" : "Forbidden" });
  }
  res.setHeader?.("Cache-Control", "no-store");
  const report = await buildHealth();
  log("health.check", { via: auth.via, ok: report.ok, failed: report.summary.required_failed.length, warnings: report.summary.warnings.length });
  return res.status(200).json({ ...report, via: auth.via });
}
