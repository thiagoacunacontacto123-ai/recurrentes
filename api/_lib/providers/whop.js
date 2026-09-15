// Adapter de Whop — membresías y digitales cobrados en USD a compradores de afuera.
//
// Modelo MVP: el comerciante pega en Integraciones
//   · su Company API key (panel de Whop → Developer → Company API keys),
//   · su Company ID (biz_…, está en la URL de su panel),
//   · el secreto del webhook (ws_…) que crea apuntando a la URL que le mostramos.
// Nosotros creamos el producto (1 vez por plan) y, por cada checkout, una
// checkout configuration con un plan "renewal" inline (billing_period en días,
// renewal_price en dólares) y metadata { merchantId, subscriberId, planId } que
// Whop hereda en el pago y la membresía.
//
// API: https://api.whop.com/api/v1 · Bearer <api key>.
// Webhooks: Standard Webhooks — HMAC-SHA256 base64 de `${webhook-id}.${webhook-timestamp}.${body}`
// con el secreto ws_… TAL CUAL (sin sacar el prefijo ni decodificarlo).
//
// Env (solo nombres):
//   WHOP_ENABLED          1/true para prender la pasarela
//   WHOP_WEBHOOK_SECRET   (opcional) secreto de un webhook a nivel APP de Whop; si el
//                         merchant cargó el suyo, se usa ese.
import crypto from "crypto";
import { fetchWithTimeout } from "../http.js";
import { timingSafeEqualStr } from "../token.js";
import { readRawBody, envOn, toIso } from "./rawBody.js";

const API = "https://api.whop.com/api/v1";
const CHECKOUT_BASE = "https://whop.com";
export const WHOP_TOLERANCE_SEC = 300;

async function whopFetch(apiKey, method, path, { body, query } = {}) {
  if (!apiKey) throw new Error("Falta la API key de Whop");
  let url = `${API}${path}`;
  if (query) {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)])).toString();
    if (qs) url += `?${qs}`;
  }
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetchWithTimeout(url, { method, headers, body: body ? JSON.stringify(body) : undefined }, 10000);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || (typeof data?.error === "string" ? data.error : "") || `Whop HTTP ${r.status}`;
    const e = new Error(msg);
    e.status = r.status;
    throw e;
  }
  return data;
}

function credsOf(merchant) {
  const apiKey = merchant?.whop_api_key;
  const companyId = merchant?.whop_company_id;
  if (!apiKey || !companyId) throw new Error("Conectá tu cuenta de Whop en Configuración → Integraciones");
  return { apiKey, companyId };
}

const absoluteUrl = (u) => {
  const s = String(u || "");
  if (!s) return null;
  return /^https?:\/\//.test(s) ? s : `${CHECKOUT_BASE}${s.startsWith("/") ? "" : "/"}${s}`;
};

// ─── Firma (Standard Webhooks) ─────────────────────────────────────────────
const header = (headers, name) => {
  const h = headers || {};
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * Verifica webhook-id / webhook-timestamp / webhook-signature ("v1,<b64> v1,<b64>").
 * La clave del HMAC es el secreto ws_… tal cual. Si alguien pega un secreto
 * "whsec_<base64>" (formato Standard Webhooks genérico), probamos también la
 * variante decodificada. Varios secretos admitidos (merchant + app).
 */
export function verifyWhopSignature(rawBody, headers, secrets, { toleranceSec = WHOP_TOLERANCE_SEC, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const list = (Array.isArray(secrets) ? secrets : [secrets]).map((s) => String(s || "").trim()).filter(Boolean);
  if (!list.length) return { ok: false, reason: "no_secret" };
  const id = header(headers, "webhook-id");
  const ts = header(headers, "webhook-timestamp");
  const sig = header(headers, "webhook-signature");
  if (!id || !ts || !sig || !/^\d+$/.test(String(ts))) return { ok: false, reason: "bad_header" };
  const given = String(sig).split(" ").map((p) => p.split(",")).filter(([v, s]) => v === "v1" && s).map(([, s]) => s);
  if (!given.length) return { ok: false, reason: "bad_header" };
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""));
  const signed = Buffer.concat([Buffer.from(`${id}.${ts}.`), raw]);
  const keys = [];
  for (const s of list) {
    keys.push(Buffer.from(s, "utf8"));
    if (s.startsWith("whsec_")) keys.push(Buffer.from(s.slice(6), "base64"));
  }
  const match = keys.some((k) => {
    const expected = crypto.createHmac("sha256", k).update(signed).digest("base64");
    return given.some((g) => timingSafeEqualStr(expected, g));
  });
  if (!match) return { ok: false, reason: "bad_signature" };
  const tol = Number(toleranceSec) > 0 ? Number(toleranceSec) : WHOP_TOLERANCE_SEC;
  if (Math.abs(nowSec - Number(ts)) > tol) return { ok: false, reason: "timestamp_out_of_tolerance" };
  return { ok: true, webhookId: String(id), timestamp: Number(ts) };
}

// ─── Mapeo de eventos ──────────────────────────────────────────────────────
// Nombres viejos (API v2/v5: `action` con guion bajo) → nombres v1 (`type`).
const ALIASES = {
  payment_succeeded: "payment.succeeded",
  app_payment_succeeded: "payment.succeeded",
  payment_failed: "payment.failed",
  app_payment_failed: "payment.failed",
  membership_went_valid: "membership.activated",
  "membership.went_valid": "membership.activated",
  membership_went_invalid: "membership.deactivated",
  "membership.went_invalid": "membership.deactivated",
  app_membership_went_invalid: "membership.deactivated",
};
const normType = (t) => ALIASES[String(t || "")] || String(t || "");

function metaOf(d) {
  return (d?.metadata && Object.keys(d.metadata).length ? d.metadata : null)
    || d?.membership?.metadata
    || d?.checkout_configuration?.metadata
    || {};
}
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Body de Whop (ya verificado) → { merchantId, companyId, events[] }. Puro, sin red.
 *  · payment.succeeded      → charge_approved (paymentId pay_…, monto `total` en la moneda del pago)
 *  · payment.failed         → charge_failed
 *  · membership.deactivated → subscription_cancelled (canceló, venció o quedó impaga)
 *  · membership.activated   → sin eventos (el 1er cobro llega como payment.succeeded)
 */
export function mapWhopEvent(body, { webhookId = null } = {}) {
  const type = normType(body?.type || body?.action);
  const d = body?.data || {};
  const meta = metaOf(d);
  const companyId = body?.account_id || body?.company_id || d?.company?.id || d?.company_id || null;
  const baseRaw = { event_id: body?.id || webhookId || null, event_type: type, company_id: companyId };
  const date = toIso(d.paid_at) || toIso(d.created_at) || toIso(body?.timestamp) || new Date().toISOString();

  let events = [];
  if (type === "payment.succeeded" || type === "payment.failed") {
    const currency = String(d.currency || "usd").toUpperCase();
    events = [{
      type: type === "payment.succeeded" ? "charge_approved" : "charge_failed",
      providerSubscriptionId: d.membership?.id || d.membership_id || null,
      subscriberRef: meta.subscriberId || null,
      paymentId: d.id ? String(d.id) : null,
      amount: num(d.total ?? d.subtotal ?? d.final_amount),
      currency,
      date: type === "payment.succeeded" ? date : (toIso(body?.timestamp) || date),
      raw: {
        ...baseRaw,
        status: d.status || null,
        substatus: d.substatus || null,
        billing_reason: d.billing_reason || null,
        first_charge: d.billing_reason === "subscription_create",
        usd_total: num(d.usd_total),
        amount_after_fees: num(d.amount_after_fees),
        failure_message: d.failure_message || null,
        customer_email: d.user?.email || null,
        customer_name: d.user?.name || null,
        plan_id: d.plan?.id || null,
      },
    }];
  } else if (type === "membership.deactivated") {
    events = [{
      type: "subscription_cancelled",
      providerSubscriptionId: d.id || null,
      subscriberRef: meta.subscriberId || null,
      paymentId: null,
      amount: null,
      currency: null,
      date: toIso(body?.timestamp) || new Date().toISOString(),
      raw: { ...baseRaw, status: d.status || null, customer_email: d.user?.email || null },
    }];
  }
  return { merchantId: meta.merchantId || null, companyId, events };
}

// ─── Adapter ───────────────────────────────────────────────────────────────
const whop = {
  id: "whop",
  label: "Whop",
  currency: "USD",

  isEnabled() {
    return envOn("WHOP_ENABLED");
  },

  /**
   * Crea (si hace falta) el producto y una checkout configuration con plan renewal
   * inline. Si el plan no tenía producto en Whop, `raw.product_id` + `raw.product_created`
   * vienen para que quien llama lo guarde en el plan (`whop_product_id`) y no se cree otro.
   */
  async createSubscriptionCheckout({ merchant, merchantId, subscriberId, sub, plan, amount, currency, frequencyDays, backUrl } = {}) {
    const { apiKey, companyId } = credsOf(merchant);
    const cur = String(currency || plan?.currency || "USD").toUpperCase();
    const price = Math.round(Number(amount) * 100) / 100;
    if (!(price > 0)) throw new Error("Monto inválido para Whop");
    const days = Math.round(Number(frequencyDays || plan?.frequency_days || 30));
    if (!(days >= 1)) throw new Error("Frecuencia inválida para Whop");
    const title = String(plan?.product_title || plan?.name || plan?.title || "Suscripción").slice(0, 80);
    const planId = plan?.id || sub?.plan_id || "";

    // Producto guardado en el plan, solo si es de ESTA empresa (si cambió de cuenta de Whop, se crea otro).
    const sameCompany = !plan?.whop_product_company_id || plan.whop_product_company_id === companyId;
    let productId = (sameCompany && plan?.whop_product_id) || null;
    let productCreated = false;
    if (!productId) {
      const p = await whopFetch(apiKey, "POST", "/products", { body: { account_id: companyId, title } });
      productId = p?.id;
      productCreated = true;
      if (!productId) throw new Error("Whop no devolvió el producto");
    }

    const metadata = { merchantId: String(merchantId || ""), subscriberId: String(subscriberId || ""), planId: String(planId), source: "recurrentes" };
    const cfg = await whopFetch(apiKey, "POST", "/checkout_configurations", {
      body: {
        mode: "payment",
        plan: {
          company_id: companyId,
          product_id: productId,
          currency: cur.toLowerCase(),
          plan_type: "renewal",
          billing_period: days,
          renewal_price: price,
          title,
        },
        ...(backUrl ? { redirect_url: backUrl } : {}),
        metadata,
      },
    });
    const checkoutUrl = absoluteUrl(cfg?.purchase_url);
    if (!checkoutUrl) throw new Error("Whop no devolvió el link de pago");
    return {
      checkoutUrl,
      providerSubscriptionId: null,          // la membresía (mem_…) nace cuando paga
      providerPlanId: cfg?.plan?.id || null, // plan_… creado para este checkout
      raw: { checkout_configuration_id: cfg?.id || null, product_id: productId, product_created: productCreated, company_id: companyId, currency: cur, amount: price, billing_period: days },
    };
  },

  /**
   * Identifica el merchant (query ?mid= de la URL que le dimos, o metadata), verifica
   * la firma con SU secreto (o WHOP_WEBHOOK_SECRET) y mapea. Si el evento trae la
   * empresa de Whop, tiene que ser la del merchant.
   */
  async parseWebhook(req, { getMerchant } = {}) {
    let raw;
    try { raw = await readRawBody(req); } catch (e) { return { ok: false, status: 400, error: e.message, merchantId: null, events: [] }; }
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch (_) { return { ok: false, status: 400, error: "JSON inválido", merchantId: null, events: [] }; }

    const mapped = mapWhopEvent(body, { webhookId: header(req?.headers, "webhook-id") || null });
    const hinted = String(req?.query?.mid || req?.query?.merchant || "") || null;
    if (hinted && mapped.merchantId && hinted !== mapped.merchantId) {
      return { ok: false, status: 400, error: "el evento es de otro merchant", merchantId: null, events: [] };
    }
    const merchantId = hinted || mapped.merchantId;

    let merchant = null;
    if (merchantId && typeof getMerchant === "function") merchant = await getMerchant(merchantId);
    const secrets = [merchant?.whop_webhook_secret, process.env.WHOP_WEBHOOK_SECRET].filter(Boolean);
    const v = verifyWhopSignature(raw, req?.headers, secrets);
    if (!v.ok) return { ok: false, status: v.reason === "no_secret" ? 400 : 401, error: `Firma de Whop inválida (${v.reason})`, merchantId: null, events: [] };

    if (merchantId && typeof getMerchant === "function" && !merchant) return { ok: false, status: 200, error: "merchant no encontrado", merchantId, events: [] };
    if (merchant?.whop_company_id && mapped.companyId && mapped.companyId !== merchant.whop_company_id) {
      return { ok: false, status: 200, error: "la empresa de Whop del evento no es la del merchant", merchantId, events: [] };
    }
    return { ok: true, merchantId: merchantId || null, events: mapped.events, eventId: v.webhookId };
  },

  // Por defecto al final del período: no se cobra más y el cliente conserva el
  // acceso que ya pagó (igual que cancelar en MP). { mode: "immediate" } lo corta ya.
  async cancel(merchant, providerSubscriptionId, { mode = "at_period_end" } = {}) {
    const { apiKey } = credsOf(merchant);
    const m = await whopFetch(apiKey, "POST", `/memberships/${encodeURIComponent(providerSubscriptionId)}/cancel`, { body: { cancellation_mode: mode === "immediate" ? "immediate" : "at_period_end" } });
    return { ok: true, status: m?.status || null, raw: m };
  },

  async pause(merchant, providerSubscriptionId) {
    const { apiKey } = credsOf(merchant);
    const m = await whopFetch(apiKey, "POST", `/memberships/${encodeURIComponent(providerSubscriptionId)}/pause`, { body: { void_payments: false } });
    return { ok: true, status: m?.status || null, raw: m };
  },

  async resume(merchant, providerSubscriptionId) {
    const { apiKey } = credsOf(merchant);
    const m = await whopFetch(apiKey, "POST", `/memberships/${encodeURIComponent(providerSubscriptionId)}/resume`);
    return { ok: true, status: m?.status || null, raw: m };
  },

  // creds: { api_key, company_id } → lista 1 producto de la empresa para validar clave + permisos.
  async testCredentials(creds = {}) {
    const apiKey = String(creds.api_key || creds.whop_api_key || "").trim();
    const companyId = String(creds.company_id || creds.whop_company_id || "").trim();
    if (!apiKey) return { ok: false, error: "Pegá tu API key de Whop" };
    if (!/^biz_[A-Za-z0-9]+$/.test(companyId)) return { ok: false, error: "El Company ID empieza con biz_ (lo ves en la URL de tu panel de Whop)" };
    try {
      const d = await whopFetch(apiKey, "GET", "/products", { query: { account_id: companyId, first: 1 } });
      const first = Array.isArray(d?.data) ? d.data[0] : null;
      return { ok: true, account: { id: companyId, title: first?.company?.title || null } };
    } catch (e) {
      if (e.status === 401) return { ok: false, error: "La API key no es válida" };
      if (e.status === 403) return { ok: false, error: "A la API key le faltan permisos (necesita leer y crear productos, planes, checkouts y miembros)" };
      if (e.status === 404) return { ok: false, error: "No encontramos esa empresa en Whop: revisá el Company ID" };
      return { ok: false, error: e.message };
    }
  },
};

export default whop;
