// Adapter de Stripe — cobros recurrentes en USD (digitales / ventas al exterior).
//
// Modelo: Stripe Connect con cuentas STANDARD conectadas por OAuth. El comerciante
// ya tiene (o crea) su propia cuenta de Stripe fuera de Argentina (p. ej. una LLC
// de EE.UU. con Stripe Atlas) y la conecta en 1 clic. Cobramos con "direct charges":
// la plataforma llama a la API con SU clave (STRIPE_SECRET_KEY) + header
// `Stripe-Account: acct_…` del comerciante. La plata, las disputas y los
// reembolsos quedan en la cuenta del comerciante.
//
// Sin SDK: fetch plano a https://api.stripe.com/v1 (form-urlencoded).
//
// Env (solo nombres, valores en Vercel):
//   STRIPE_ENABLED            1/true para prender la pasarela
//   STRIPE_SECRET_KEY         clave secreta de la cuenta PLATAFORMA (sk_live_… / sk_test_…)
//   STRIPE_CONNECT_CLIENT_ID  client_id de Connect (ca_…) para el OAuth
//   STRIPE_WEBHOOK_SECRET     secreto(s) whsec_… del endpoint de webhooks (separados por coma
//                             si hay dos endpoints: "tu cuenta" y "cuentas conectadas")
//   STRIPE_CONNECT_REDIRECT_URI (opcional) si no, ${APP_BASE_URL}/api/merchant?action=stripe-connect-callback
//
// Eventos que escuchamos (endpoint "Cuentas conectadas"):
//   checkout.session.completed · invoice.paid · invoice.payment_failed ·
//   customer.subscription.deleted · customer.subscription.updated
import crypto from "crypto";
import { fetchWithTimeout } from "../http.js";
import { timingSafeEqualStr } from "../token.js";
import { readRawBody, envOn, toIso } from "./rawBody.js";

const API = "https://api.stripe.com/v1";
const CONNECT = "https://connect.stripe.com";
export const STRIPE_TOLERANCE_SEC = 300; // 5 min, igual que las librerías oficiales

// Monedas sin decimales (el monto va en unidades, no en centavos).
const ZERO_DECIMAL = new Set(["BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX", "VND", "VUV", "XAF", "XOF", "XPF"]);
export const toMinor = (amount, currency) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return NaN;
  return ZERO_DECIMAL.has(String(currency).toUpperCase()) ? Math.round(n) : Math.round(n * 100);
};
export const fromMinor = (minor, currency) => {
  const n = Number(minor) || 0;
  return ZERO_DECIMAL.has(String(currency).toUpperCase()) ? n : Math.round(n) / 100;
};

// ─── HTTP ──────────────────────────────────────────────────────────────────
// Objeto anidado → form-urlencoded estilo Stripe (a[b][0][c]=…). null/undefined se omiten.
export function formEncode(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") formEncode(item, `${key}[${i}]`, out);
        else if (item !== undefined && item !== null) out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === "object") formEncode(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function stripeFetch(method, path, { params, account, key } = {}) {
  const secret = key || process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe no está configurado (falta STRIPE_SECRET_KEY)");
  const headers = { Authorization: `Bearer ${secret}` };
  if (account) headers["Stripe-Account"] = account;
  let url = `${API}${path}`;
  let body;
  if (params && (method === "GET" || method === "DELETE")) {
    const qs = formEncode(params).toString();
    if (qs) url += `?${qs}`;
  } else if (params) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = formEncode(params).toString();
  }
  const r = await fetchWithTimeout(url, { method, headers, body }, 10000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data?.error?.message || `Stripe HTTP ${r.status}`);
    e.status = r.status;
    e.code = data?.error?.code || null;
    throw e;
  }
  return data;
}

// ─── Frecuencia ────────────────────────────────────────────────────────────
// frequency_days → recurring { interval, interval_count }. Stripe permite como
// máximo 3 años entre cobros (3 años, 36 meses, 156 semanas → 1095 días).
// 30 días = 1 mes calendario (lo que el comerciante entiende por "mensual").
export function recurringFromDays(days) {
  const d = Math.round(Number(days));
  if (!Number.isFinite(d) || d < 1) throw new Error("Frecuencia inválida para Stripe");
  if (d % 365 === 0 && d / 365 <= 3) return { interval: "year", interval_count: d / 365 };
  if (d % 30 === 0 && d / 30 <= 36) return { interval: "month", interval_count: d / 30 };
  if (d % 7 === 0 && d / 7 <= 156) return { interval: "week", interval_count: d / 7 };
  if (d <= 1095) return { interval: "day", interval_count: d };
  throw new Error("Stripe permite como máximo 3 años entre cobros");
}

// "mid:sid" (mismo formato que el external_reference de MP).
function parseRef(ref) {
  const [merchantId, subscriberId] = String(ref || "").split(":");
  return { merchantId: merchantId || null, subscriberId: subscriberId || null };
}

// ─── Firma de webhooks ─────────────────────────────────────────────────────
/**
 * Verifica el header Stripe-Signature ("t=…,v1=…,v1=…"): HMAC-SHA256 hex de
 * `${t}.${rawBody}` con el secreto del endpoint. Solo esquema v1 (v0 se ignora).
 * Acepta varios secretos (rotación / dos endpoints). Rechaza timestamps fuera de
 * la tolerancia (replay).
 */
export function verifyStripeSignature(rawBody, header, secrets, { toleranceSec = STRIPE_TOLERANCE_SEC, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const list = (Array.isArray(secrets) ? secrets : String(secrets || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
  if (!list.length) return { ok: false, reason: "no_secret" };
  let t = null;
  const v1 = [];
  for (const part of String(header || "").split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1" && v) v1.push(v);
  }
  if (!t || !/^\d+$/.test(t) || !v1.length) return { ok: false, reason: "bad_header" };
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""));
  const payload = Buffer.concat([Buffer.from(`${t}.`), raw]);
  const match = list.some((sec) => {
    const expected = crypto.createHmac("sha256", sec).update(payload).digest("hex");
    return v1.some((s) => timingSafeEqualStr(expected, s));
  });
  if (!match) return { ok: false, reason: "bad_signature" };
  const tol = Number(toleranceSec) > 0 ? Number(toleranceSec) : STRIPE_TOLERANCE_SEC; // nunca 0 (desactivaría el chequeo)
  if (Math.abs(nowSec - Number(t)) > tol) return { ok: false, reason: "timestamp_out_of_tolerance" };
  return { ok: true, timestamp: Number(t) };
}

// ─── Mapeo de eventos ──────────────────────────────────────────────────────
const idOf = (v) => (v && typeof v === "object" ? v.id : v) || null;

// La API 2025-03-31 (basil) movió invoice.subscription a invoice.parent.subscription_details.
// Soportamos las dos formas (la del evento depende de la versión del endpoint).
function invoiceSubscriptionId(inv) {
  const line = inv?.lines?.data?.[0];
  return idOf(inv?.parent?.subscription_details?.subscription)
    || idOf(inv?.subscription)
    || idOf(line?.parent?.subscription_item_details?.subscription)
    || idOf(line?.subscription)
    || null;
}
function invoiceSubMeta(inv) {
  const lineMeta = (inv?.lines?.data || []).map((l) => l?.metadata).find((m) => m && m.subscriberId);
  return inv?.parent?.subscription_details?.metadata
    || inv?.subscription_details?.metadata
    || lineMeta
    || inv?.metadata
    || {};
}

/**
 * Evento de Stripe (ya verificado) → { merchantId, events[], link? }. Puro, sin red.
 *  · invoice.paid (monto > 0)            → charge_approved (paymentId = id de la factura: estable ante reintentos)
 *  · invoice.payment_failed              → charge_failed   (paymentId = factura:intento)
 *  · customer.subscription.deleted       → subscription_cancelled
 *  · customer.subscription.updated       → paused / resumed (cambió pause_collection) o cancelled (status canceled)
 *  · checkout.session.completed          → sin eventos de cobro (el 1er cobro llega como invoice.paid);
 *                                          devuelve `link` para asociar la suscripción al suscriptor antes.
 */
export function mapStripeEvent(event) {
  const type = String(event?.type || "");
  const obj = event?.data?.object || {};
  const prev = event?.data?.previous_attributes || null;
  const baseRaw = { event_id: event?.id || null, event_type: type, account: event?.account || null, livemode: !!event?.livemode };
  const eventDate = toIso(event?.created) || new Date().toISOString();

  if (type === "checkout.session.completed") {
    const meta = obj.metadata || {};
    const ref = parseRef(obj.client_reference_id);
    if (obj.mode && obj.mode !== "subscription") return { merchantId: meta.merchantId || ref.merchantId || null, events: [] };
    return {
      merchantId: meta.merchantId || ref.merchantId || null,
      events: [],
      link: {
        subscriberRef: meta.subscriberId || ref.subscriberId || null,
        providerSubscriptionId: idOf(obj.subscription),
        customerEmail: obj.customer_details?.email || obj.customer_email || null,
        sessionId: obj.id || null,
        paymentStatus: obj.payment_status || null,
      },
    };
  }

  if (type === "invoice.paid" || type === "invoice.payment_failed") {
    const subId = invoiceSubscriptionId(obj);
    const meta = invoiceSubMeta(obj);
    if (!subId) return { merchantId: meta.merchantId || null, events: [] }; // factura suelta, no es de una suscripción
    const paid = type === "invoice.paid";
    const currency = String(obj.currency || "usd").toUpperCase();
    const minor = paid ? obj.amount_paid : (obj.amount_due ?? obj.amount_remaining);
    if (paid && !(Number(minor) > 0)) return { merchantId: meta.merchantId || null, events: [] }; // factura en $0 (cupón 100%)
    return {
      merchantId: meta.merchantId || null,
      events: [{
        type: paid ? "charge_approved" : "charge_failed",
        providerSubscriptionId: subId,
        subscriberRef: meta.subscriberId || null,
        paymentId: paid ? String(obj.id) : `${obj.id}:${obj.attempt_count || 1}`,
        amount: fromMinor(minor, currency),
        currency,
        date: paid ? (toIso(obj.status_transitions?.paid_at) || eventDate) : eventDate,
        raw: {
          ...baseRaw,
          invoice_id: obj.id || null,
          billing_reason: obj.billing_reason || null,
          first_charge: obj.billing_reason === "subscription_create",
          customer_email: obj.customer_email || null,
          customer_name: obj.customer_name || null,
          hosted_invoice_url: obj.hosted_invoice_url || null,
          attempt_count: obj.attempt_count ?? null,
          next_payment_attempt: toIso(obj.next_payment_attempt),
        },
      }],
    };
  }

  if (type === "customer.subscription.deleted" || type === "customer.subscription.updated") {
    const meta = obj.metadata || {};
    const common = { providerSubscriptionId: obj.id || null, subscriberRef: meta.subscriberId || null, paymentId: null, amount: null, currency: obj.currency ? String(obj.currency).toUpperCase() : null, date: eventDate };
    const raw = { ...baseRaw, status: obj.status || null, cancel_at_period_end: !!obj.cancel_at_period_end, cancellation_reason: obj.cancellation_details?.reason || null };
    let evType = null;
    if (type === "customer.subscription.deleted") evType = "subscription_cancelled";
    else if (obj.status === "canceled" && prev && "status" in prev) evType = "subscription_cancelled";
    else if (prev && "pause_collection" in prev) evType = obj.pause_collection ? "subscription_paused" : "subscription_resumed";
    return { merchantId: meta.merchantId || null, events: evType ? [{ type: evType, ...common, raw }] : [] };
  }

  return { merchantId: obj?.metadata?.merchantId || null, events: [] };
}

// ─── Connect (OAuth, cuentas Standard) ─────────────────────────────────────
export const stripeConnectAvailable = () => envOn("STRIPE_ENABLED") && !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_CONNECT_CLIENT_ID;

export function connectAuthorizeUrl({ state, redirectUri, email, url } = {}) {
  const q = new URLSearchParams({ response_type: "code", client_id: String(process.env.STRIPE_CONNECT_CLIENT_ID || ""), scope: "read_write", state: String(state || "") });
  if (redirectUri) q.set("redirect_uri", redirectUri);
  if (email) q.set("stripe_user[email]", email);
  if (url && /^https?:\/\//.test(url)) q.set("stripe_user[url]", url);
  return `${CONNECT}/oauth/authorize?${q.toString()}`;
}

// Canjea el code (vale 1 vez, 5 min) por el id de la cuenta conectada.
export async function connectExchangeCode(code) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Stripe no está configurado");
  const r = await fetchWithTimeout(`${CONNECT}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code: String(code || ""), client_secret: secret }).toString(),
  }, 10000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.stripe_user_id) throw new Error(d.error_description || d.error || `Stripe HTTP ${r.status}`);
  return { accountId: d.stripe_user_id, livemode: !!d.livemode, scope: d.scope || null };
}

// Desconecta la cuenta de la plataforma (best-effort al desvincular).
export async function connectDeauthorize(accountId) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret || !accountId) return { ok: false };
  const r = await fetchWithTimeout(`${CONNECT}/oauth/deauthorize`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: String(process.env.STRIPE_CONNECT_CLIENT_ID || ""), stripe_user_id: String(accountId) }).toString(),
  }, 10000);
  return { ok: r.ok };
}

function summarizeAccount(a) {
  return {
    id: a?.id || null,
    email: a?.email || null,
    name: a?.business_profile?.name || a?.settings?.dashboard?.display_name || null,
    country: a?.country || null,
    default_currency: a?.default_currency ? String(a.default_currency).toUpperCase() : null,
    charges_enabled: !!a?.charges_enabled,
    details_submitted: !!a?.details_submitted,
  };
}

function accountOf(merchant) {
  const acct = merchant?.stripe_account_id;
  if (!acct) throw new Error("Conectá tu cuenta de Stripe en Configuración → Integraciones");
  return acct;
}

// ─── Adapter ───────────────────────────────────────────────────────────────
const stripe = {
  id: "stripe",
  label: "Stripe",
  currency: "USD",

  isEnabled() {
    return envOn("STRIPE_ENABLED") && !!process.env.STRIPE_SECRET_KEY;
  },

  async createSubscriptionCheckout({ merchant, merchantId, subscriberId, sub, plan, amount, currency, frequencyDays, backUrl, customer } = {}) {
    const account = accountOf(merchant);
    if (!backUrl) throw new Error("Falta la URL de regreso del checkout");
    const cur = String(currency || plan?.currency || "USD").toUpperCase();
    const unit = toMinor(amount, cur);
    if (!(unit > 0)) throw new Error("Monto inválido para Stripe");
    const recurring = recurringFromDays(frequencyDays || plan?.frequency_days || 30);
    const name = String(plan?.product_title || plan?.name || plan?.title || "Suscripción").slice(0, 250);
    const planId = plan?.id || sub?.plan_id || "";
    const meta = { merchantId: String(merchantId || ""), subscriberId: String(subscriberId || ""), planId: String(planId), source: "recurrentes" };
    const email = customer?.email || sub?.customer_email || null;
    // {CHECKOUT_SESSION_ID} va literal (Stripe lo reemplaza): no pasar por URLSearchParams.
    const sep = String(backUrl).includes("?") ? "&" : "?";
    const successUrl = `${backUrl}${sep}provider=stripe&session_id={CHECKOUT_SESSION_ID}`;

    const params = {
      mode: "subscription",
      line_items: [{
        quantity: 1,
        price_data: { currency: cur.toLowerCase(), unit_amount: unit, recurring, product_data: { name } },
      }],
      success_url: successUrl,
      cancel_url: backUrl,
      client_reference_id: `${meta.merchantId}:${meta.subscriberId}`,
      customer_email: email || undefined,
      metadata: meta,
      subscription_data: { metadata: meta },
      locale: "auto",
    };
    const s = await stripeFetch("POST", "/checkout/sessions", { params, account });
    return {
      checkoutUrl: s.url,
      providerSubscriptionId: idOf(s.subscription), // null hasta que el cliente paga
      providerPlanId: null,                           // price_data ad-hoc: no hay plan reutilizable
      raw: { session_id: s.id, account, currency: cur, amount: fromMinor(unit, cur), amount_minor: unit, recurring, expires_at: toIso(s.expires_at) },
    };
  },

  /**
   * Verifica la firma con STRIPE_WEBHOOK_SECRET y mapea el evento. El merchant sale
   * de la metadata (la escribimos nosotros al crear el checkout; viene firmada por
   * Stripe). Si hay getMerchant, además exige que la cuenta conectada del evento
   * (`event.account`) sea la del merchant: un merchant no puede empujar eventos a otro.
   */
  async parseWebhook(req, { getMerchant } = {}) {
    let raw;
    try { raw = await readRawBody(req); } catch (e) { return { ok: false, status: 400, error: e.message, merchantId: null, events: [] }; }
    const v = verifyStripeSignature(raw, req?.headers?.["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
    if (!v.ok) return { ok: false, status: v.reason === "no_secret" ? 500 : 400, error: `Firma de Stripe inválida (${v.reason})`, merchantId: null, events: [] };
    let event;
    try { event = JSON.parse(raw.toString("utf8")); } catch (_) { return { ok: false, status: 400, error: "JSON inválido", merchantId: null, events: [] }; }

    const mapped = mapStripeEvent(event);
    const merchantId = mapped.merchantId || (req?.query?.mid ? String(req.query.mid) : null);
    const out = { ok: true, merchantId, events: mapped.events, eventId: event.id || null, stripeAccount: event.account || null };
    if (mapped.link) out.link = mapped.link;

    if (merchantId && typeof getMerchant === "function") {
      const m = await getMerchant(merchantId);
      if (!m) return { ok: false, status: 200, error: "merchant no encontrado", merchantId, events: [] };
      if (event.account && m.stripe_account_id && event.account !== m.stripe_account_id) {
        return { ok: false, status: 200, error: "la cuenta de Stripe del evento no es la del merchant", merchantId, events: [] };
      }
    }
    return out;
  },

  async cancel(merchant, providerSubscriptionId) {
    const s = await stripeFetch("DELETE", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { account: accountOf(merchant) });
    return { ok: true, status: s.status || null, raw: s };
  },

  // Pausa = dejar de cobrar (las facturas del período se anulan), sin cancelar.
  async pause(merchant, providerSubscriptionId) {
    const s = await stripeFetch("POST", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { account: accountOf(merchant), params: { pause_collection: { behavior: "void" } } });
    return { ok: true, status: s.status || null, raw: s };
  },

  async resume(merchant, providerSubscriptionId) {
    // pause_collection vacío = sacar la pausa.
    const s = await stripeFetch("POST", `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`, { account: accountOf(merchant), params: { pause_collection: "" } });
    return { ok: true, status: s.status || null, raw: s };
  },

  /**
   * creds: { stripe_account_id } (cuenta conectada por OAuth, se consulta con la clave
   * de la plataforma) o { secret_key } (clave propia pegada, alternativa manual).
   */
  async testCredentials(creds = {}) {
    try {
      if (creds.secret_key) {
        const a = await stripeFetch("GET", "/account", { key: String(creds.secret_key).trim() });
        return { ok: true, account: summarizeAccount(a) };
      }
      const acct = String(creds.stripe_account_id || creds.account_id || "").trim();
      if (!/^acct_[A-Za-z0-9]+$/.test(acct)) return { ok: false, error: "Falta la cuenta de Stripe (acct_…)" };
      const a = await stripeFetch("GET", `/accounts/${encodeURIComponent(acct)}`);
      return { ok: true, account: summarizeAccount(a) };
    } catch (e) {
      return { ok: false, error: e.status === 401 ? "Clave de Stripe inválida" : e.message };
    }
  },
};

export default stripe;
