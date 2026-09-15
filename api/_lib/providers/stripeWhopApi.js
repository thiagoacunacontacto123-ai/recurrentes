// Conexión de Stripe (Connect OAuth) y Whop (API key) desde Configuración → Integraciones.
// Enganchado en api/merchant.js, sin funciones serverless nuevas:
//   GET  ?action=stripe-connect-callback   PÚBLICO (Stripe redirige acá tras autorizar;
//                                          el merchant sale del `state` firmado, nunca de la query)
//   POST ?action=stripe-connect-start      → { url } de autorización de Stripe (solo dueño)
//   POST ?action=disconnect-stripe         (solo dueño)
//   POST ?action=save-whop  { api_key?, company_id?, webhook_secret? } (solo dueño)
//   POST ?action=disconnect-whop           (solo dueño)
// providerFlags(merchant) suma al GET /api/merchant los flags del panel (NUNCA claves).
//
// Campos en merchants/{id}:
//   stripe_account_id, stripe_livemode, stripe_scope, stripe_account_email, stripe_account_name,
//   stripe_country, stripe_default_currency, stripe_charges_enabled, stripe_connected_at, stripe_disconnected_at
//   whop_api_key, whop_company_id, whop_company_title, whop_webhook_secret, whop_connected_at, whop_disconnected_at
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase.js";
import { signToken, verifyToken } from "../token.js";
import { appBaseUrl } from "../config.js";
import stripe, { stripeConnectAvailable, connectAuthorizeUrl, connectExchangeCode, connectDeauthorize } from "./stripe.js";
import whop from "./whop.js";

export const PROVIDER_CONNECT_ACTIONS = new Set(["stripe-connect-start", "disconnect-stripe", "save-whop", "disconnect-whop"]);
export const STRIPE_CALLBACK_ACTION = "stripe-connect-callback";

// Tiene que coincidir EXACTO con una Redirect URI cargada en Stripe → Connect → Onboarding options → OAuth.
export const stripeRedirectUri = () => process.env.STRIPE_CONNECT_REDIRECT_URI || `${appBaseUrl()}/api/merchant?action=${STRIPE_CALLBACK_ACTION}`;

// Webhooks: ruta del registro de pasarelas (/api/public?action=provider-webhook&p=<id>…).
// Stripe usa UN endpoint para todas las cuentas conectadas (lo autentica su firma).
export const stripeWebhookUrl = () => `${appBaseUrl()}/api/public?action=provider-webhook&p=stripe`;
// Whop: cada merchant crea su webhook con esta URL. Si el registro trae webhookToken.js
// usamos su URL con token (?mid=&t=); si no, sin token (la firma de Whop igual autentica).
let tokenModP = null;
const loadTokenMod = () => (tokenModP ||= import("./webhookToken.js").catch(() => null));
export async function whopWebhookUrl(merchantId) {
  const base = appBaseUrl();
  const mod = await loadTokenMod();
  if (mod?.providerWebhookUrl) return mod.providerWebhookUrl(base, "whop", merchantId);
  return `${base}/api/public?${new URLSearchParams({ action: "provider-webhook", p: "whop", mid: String(merchantId) })}`;
}

const on = (fn) => { try { return !!fn(); } catch (_) { return false; } };

// Flags para el panel. Nunca devuelve la API key de Whop ni su secreto.
export async function providerFlags(merchant) {
  const m = merchant || {};
  const stripeOn = on(() => stripe.isEnabled());
  const whopOn = on(() => whop.isEnabled());
  const out = {
    stripe_enabled: stripeOn,
    stripe_connect_available: stripeOn && stripeConnectAvailable(),
    stripe_connected: !!m.stripe_account_id,
    stripe_account_id: m.stripe_account_id || null,
    stripe_account_email: m.stripe_account_email || null,
    stripe_account_name: m.stripe_account_name || null,
    stripe_country: m.stripe_country || null,
    stripe_default_currency: m.stripe_default_currency || null,
    stripe_charges_enabled: m.stripe_charges_enabled === true,
    stripe_livemode: m.stripe_livemode === true,
    stripe_connected_at: m.stripe_connected_at || null,
    whop_enabled: whopOn,
    whop_connected: !!(m.whop_api_key && m.whop_company_id),
    whop_company_id: m.whop_company_id || null,
    whop_company_title: m.whop_company_title || null,
    whop_webhook_secret_set: !!m.whop_webhook_secret,
    whop_connected_at: m.whop_connected_at || null,
    whop_webhook_url: null,
  };
  if (whopOn && m.id) {
    try { out.whop_webhook_url = await whopWebhookUrl(m.id); } catch (_) { /* sin URL: el panel lo avisa */ }
  }
  return out;
}

export async function providerConnectAction(ctx, action, req, res) {
  if (ctx?.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
  const merchantId = ctx.merchantId;
  try {
    if (action === "stripe-connect-start") return await stripeConnectStart(ctx, res);
    if (action === "disconnect-stripe")    return await disconnectStripe(merchantId, res);
    if (action === "save-whop")            return await saveWhop(merchantId, req, res);
    if (action === "disconnect-whop")      return await disconnectWhop(merchantId, res);
    return res.status(400).json({ error: "action no reconocida" });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Stripe Connect ────────────────────────────────────────────────────────
async function stripeConnectStart(ctx, res) {
  if (!on(() => stripe.isEnabled())) return res.status(400).json({ error: "Stripe todavía no está disponible" });
  if (!stripeConnectAvailable()) return res.status(400).json({ error: "La conexión con Stripe no está configurada (falta STRIPE_CONNECT_CLIENT_ID)" });
  // `mid` = tienda activa al iniciar (multi-tienda). 10 minutos para completar.
  const state = signToken({ mid: ctx.merchantId, uid: ctx.uid, p: "stripe" }, 600);
  return res.json({ url: connectAuthorizeUrl({ state, redirectUri: stripeRedirectUri(), email: ctx.email || undefined }) });
}

// GET público. Siempre termina en un redirect al panel con ?stripe=ok|error.
export async function stripeConnectCallback(req, res) {
  const back = (qs) => { res.writeHead(302, { Location: `${appBaseUrl()}/#/config/integraciones?${qs}` }); res.end(); };
  const fail = (msg) => back(`stripe=error&msg=${encodeURIComponent(String(msg || "error").slice(0, 200))}`);
  const q = req.query || {};
  if (q.error) return fail(q.error === "access_denied" ? "Cancelaste la conexión en Stripe." : (q.error_description || q.error));
  if (!q.code || !q.state) return fail("Faltan parámetros");
  const payload = verifyToken(String(q.state));
  if (!payload?.mid || payload.p !== "stripe") return fail("El link venció. Volvé a tocar Conectar con Stripe.");
  if (!on(() => stripe.isEnabled())) return fail("Stripe todavía no está disponible");

  let tok;
  try { tok = await connectExchangeCode(String(q.code)); } catch (e) { return fail(e.message); }
  const t = await stripe.testCredentials({ stripe_account_id: tok.accountId }).catch(() => null);
  const a = t?.ok ? t.account : {};
  try {
    await db().collection("merchants").doc(String(payload.mid)).set({
      stripe_account_id: tok.accountId,
      stripe_livemode: !!tok.livemode,
      stripe_scope: tok.scope || null,
      stripe_account_email: a.email || null,
      stripe_account_name: a.name || null,
      stripe_country: a.country || null,
      stripe_default_currency: a.default_currency || null,
      stripe_charges_enabled: !!a.charges_enabled,
      stripe_connected_at: new Date().toISOString(),
      stripe_disconnected_at: null,
    }, { merge: true });
  } catch (e) {
    return fail(`Error guardando la conexión: ${e.message}`);
  }
  return back("stripe=ok");
}

async function disconnectStripe(merchantId, res) {
  const ref = db().collection("merchants").doc(merchantId);
  const snap = await ref.get();
  const acct = snap.exists ? snap.data()?.stripe_account_id : null;
  if (acct) { try { await connectDeauthorize(acct); } catch (_) { /* best-effort */ } }
  const del = FieldValue.delete();
  await ref.set({
    stripe_account_id: del, stripe_livemode: del, stripe_scope: del, stripe_account_email: del, stripe_account_name: del,
    stripe_country: del, stripe_default_currency: del, stripe_charges_enabled: del, stripe_connected_at: del,
    stripe_disconnected_at: new Date().toISOString(),
  }, { merge: true });
  return res.json({ ok: true });
}

// ─── Whop ──────────────────────────────────────────────────────────────────
// Parcial: si ya está conectado se puede mandar solo el webhook_secret.
async function saveWhop(merchantId, req, res) {
  if (!on(() => whop.isEnabled())) return res.status(400).json({ error: "Whop todavía no está disponible" });
  const b = req.body || {};
  const ref = db().collection("merchants").doc(merchantId);
  const snap = await ref.get();
  const cur = snap.exists ? (snap.data() || {}) : {};
  const apiKey = String(b.api_key || "").trim() || cur.whop_api_key || "";
  const companyId = String(b.company_id || "").trim() || cur.whop_company_id || "";
  const secret = String(b.webhook_secret || "").trim();
  if (!apiKey) return res.status(400).json({ error: "Pegá tu API key de Whop" });
  if (secret && secret.length < 10) return res.status(400).json({ error: "El secreto del webhook parece incompleto: copialo entero (empieza con ws_)" });

  const changedCreds = apiKey !== cur.whop_api_key || companyId !== cur.whop_company_id;
  let title = cur.whop_company_title || null;
  if (changedCreds) {
    const t = await whop.testCredentials({ api_key: apiKey, company_id: companyId });
    if (!t.ok) return res.status(400).json({ error: t.error });
    title = t.account?.title || null;
  }
  const patch = { whop_api_key: apiKey, whop_company_id: companyId, whop_company_title: title, whop_disconnected_at: null };
  if (changedCreds) patch.whop_connected_at = new Date().toISOString();
  if (secret) patch.whop_webhook_secret = secret;
  await ref.set(patch, { merge: true });
  return res.json({
    ok: true,
    whop_company_id: companyId,
    whop_company_title: title,
    whop_webhook_secret_set: !!(secret || cur.whop_webhook_secret),
    whop_webhook_url: await whopWebhookUrl(merchantId),
  });
}

async function disconnectWhop(merchantId, res) {
  const del = FieldValue.delete();
  await db().collection("merchants").doc(merchantId).set({
    whop_api_key: del, whop_company_id: del, whop_company_title: del, whop_webhook_secret: del, whop_connected_at: del,
    whop_disconnected_at: new Date().toISOString(),
  }, { merge: true });
  return res.json({ ok: true });
}
