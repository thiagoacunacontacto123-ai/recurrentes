// Integración con Klaviyo (reemplaza al sistema propio de mails de carrito
// abandonado, retirado el 2026-09-13). Cada merchant pega su Private API Key;
// Recurrentes le manda EVENTOS con el perfil del cliente y el merchant arma sus
// flujos (recupero de carrito, bienvenida, dunning, winback) del lado de Klaviyo.
//
// API: revisión 2024-10-15.
//   POST /api/events/    → 202 (crea el evento + upsert del perfil por email)
//   GET  /api/accounts/  → valida la clave y devuelve el nombre de la organización
//
// ENFOQUE: el lead queda en Klaviyo EXACTAMENTE como un carrito común de Shopify
// para que los flujos/campañas existentes del comerciante lo traten igual.
//
// Métricas (nombres EXACTOS: el merchant las usa como disparadores de flujo):
//   "Checkout Started"              capture de lead + Pagar. Payload imita al de
//                                   la integración Shopify ($value, $event_id, extra.
//                                   checkout_url / line_items, Items, ItemNames,
//                                   CheckoutURL, Categories).
//   "Placed Order"                  OPCIONAL (merchant.klaviyo_send_orders === true).
//                                   Por defecto NO: la orden se crea en Shopify y la
//                                   integración nativa Shopify→Klaviyo ya la manda
//                                   (y corta el flujo de abandono sola).
//   "Subscription Activated"        primer cobro con orden
//   "Subscription Renewed"          cobros siguientes con orden
//   "Subscription Payment Failed"   renovación rechazada
//   "Subscription Cancelled" / "Subscription Paused" / "Subscription Resumed"
//
// ⚠️ Klaviyo separa métricas por integración: "Checkout Started" de Shopify y
// "Checkout Started" de Recurrentes (API) son DOS métricas distintas. El
// comerciante tiene que clonar su flujo de abandono (o agregar una 2ª entrada)
// con disparador "Checkout Started" (API). La UI se lo explica.
//
// Perfil: en cada evento se actualizan propiedades custom (profile.properties del
// mismo POST; Klaviyo las mergea) para segmentar campañas:
//   recurrentes_status ("checkout_started"|"subscriber"|"payment_failed"|"paused"|"cancelled"),
//   recurrentes_subscriber (bool), recurrentes_plan, recurrentes_frequency_days,
//   recurrentes_next_charge_at, recurrentes_first_charge_at, recurrentes_orders_count.
//
// Reglas:
//  · klaviyoTrack NUNCA lanza: devuelve { ok, status, error } y loguea warn.
//  · unique_id idempotente → reintentos de webhook/cron/polling no duplican.
//  · Teléfono en E.164 (+549...); si no se puede normalizar se OMITE (Klaviyo
//    rechaza el evento entero con un phone inválido).
//  · Cada intento queda en merchants/{mid}/klaviyo_log (tab Actividad).
import { db } from "./firebase.js";
import { fetchWithTimeout } from "./http.js";
import { appBaseUrl } from "./config.js";

const BASE = "https://a.klaviyo.com/api";
const REVISION = "2024-10-15";
const DEFAULT_TIMEOUT_MS = 8000;

export const KLAVIYO_METRICS = {
  CHECKOUT_STARTED: "Checkout Started",
  PLACED_ORDER: "Placed Order",
  ACTIVATED: "Subscription Activated",
  RENEWED: "Subscription Renewed",
  PAYMENT_FAILED: "Subscription Payment Failed",
  CANCELLED: "Subscription Cancelled",
  PAUSED: "Subscription Paused",
  RESUMED: "Subscription Resumed",
};
const CATEGORY = "Suscripción";

const nowIso = () => new Date().toISOString();
const normEmail = (e) => String(e || "").trim().toLowerCase();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(num(n) * 100) / 100;

// Klaviyo retirado (Thiago, 2026-09-15): los mails los manda Recurrentes (Resend + Flujos
// de email). Interruptor único: todos los envíos a Klaviyo quedan como no-op.
export function klaviyoEnabled(merchant) { // eslint-disable-line no-unused-vars
  return false;
}

function headersFor(key) {
  return {
    Authorization: `Klaviyo-API-Key ${String(key || "").trim()}`,
    revision: REVISION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// "Juan Pérez García" → { firstName: "Juan", lastName: "Pérez García" }
export function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

// Normaliza a E.164. Sin prefijo internacional asume Argentina (+54) y agrega el
// 9 de celular. Devuelve null si no se puede normalizar con confianza.
export function toE164(phone) {
  const raw = String(phone || "").trim();
  if (!raw) return null;
  let intl = raw.startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (!intl && d.startsWith("00")) { d = d.slice(2); intl = true; }
  const valid = (s) => /^[1-9]\d{7,14}$/.test(s) ? "+" + s : null;
  if (intl) return valid(d);
  // 54 + 10 dígitos (fijo) o 549 + 10 (celular) ya escritos sin "+".
  if (d.startsWith("54") && (d.length === 12 || d.length === 13)) return valid(d);
  if (d.startsWith("0")) d = d.slice(1);                 // 011…, 0351…, 02966…
  // "15" local de celular después del código de área (2-4 dígitos): 11 15 xxxx-xxxx
  if (d.length === 12) {
    for (const pos of [2, 3, 4]) {
      if (d.slice(pos, pos + 2) === "15") { d = d.slice(0, pos) + d.slice(pos + 2); break; }
    }
  }
  if (d.length === 10) return valid("549" + d);          // área + número, sin 9
  if (d.length === 11 && d.startsWith("9")) return valid("54" + d);
  return null;
}

// Dirección del sub → location de Klaviyo. País "AR" por defecto (Argentina).
function toLocation(address) {
  const a = address && typeof address === "object" ? address : null;
  if (!a) return undefined;
  const country = String(a.country || "").trim();
  const iso = /^[A-Z]{2}$/i.test(country) ? country.toUpperCase() : (/argentin/i.test(country) || !country ? "AR" : undefined);
  const loc = {};
  if (a.address1) loc.address1 = String(a.address1).slice(0, 255);
  if (a.address2) loc.address2 = String(a.address2).slice(0, 255);
  if (a.city) loc.city = String(a.city).slice(0, 120);
  if (a.province || a.region) loc.region = String(a.province || a.region).slice(0, 120);
  if (a.zip) loc.zip = String(a.zip).slice(0, 20);
  if (iso) loc.country = iso;
  return Object.keys(loc).length ? loc : undefined;
}

// Sin undefined/null/"" (Klaviyo guarda "" como valor; mejor no mandarlo).
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

async function writeLog(merchantId, entry) {
  if (!merchantId) return;
  try {
    await db().collection("merchants").doc(merchantId).collection("klaviyo_log").add({
      metric: entry.metric || null,
      email: entry.email || null,
      subscriber_id: entry.subscriber_id || null,
      status: entry.status || "sent",
      http_status: entry.http_status ?? null,
      error: entry.error ? String(entry.error).slice(0, 500) : null,
      unique_id: entry.unique_id || null,
      created_at: nowIso(),
    });
  } catch (e) {
    console.warn(`[klaviyo] no se pudo loguear ${entry?.metric || "?"} → ${entry?.email || "?"}:`, e.message);
  }
}

// Marca el último error en el merchant (para que el dashboard avise si la clave
// se revocó). Solo en fallo: no gastamos una escritura por evento OK.
async function markMerchantError(merchantId, error, httpStatus) {
  if (!merchantId) return;
  try {
    await db().collection("merchants").doc(merchantId).set({
      klaviyo_last_error: String(error || "error").slice(0, 300),
      klaviyo_last_error_at: nowIso(),
      klaviyo_last_error_status: httpStatus ?? null,
    }, { merge: true });
  } catch (_) {}
}

// Mensaje corto de error a partir de la respuesta JSON:API de Klaviyo.
async function errorFromResponse(r) {
  let body = null;
  try { body = await r.json(); } catch (_) { try { body = await r.text(); } catch (_) {} }
  const first = body && Array.isArray(body.errors) ? body.errors[0] : null;
  const detail = first ? [first.title, first.detail].filter(Boolean).join(": ") : (typeof body === "string" ? body.slice(0, 200) : "");
  return `HTTP ${r.status}${detail ? " — " + detail : ""}`;
}

/**
 * Valida una Private API Key contra GET /accounts/.
 * @returns {Promise<{ok:boolean, organization?:string, account_id?:string, status?:number, error?:string}>}
 */
export async function klaviyoValidateKey(key) {
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "Falta la API key" };
  if (!/^pk_[A-Za-z0-9]+$/.test(k)) return { ok: false, error: "Tiene que ser una Private API Key (empieza con pk_)" };
  try {
    const r = await fetchWithTimeout(`${BASE}/accounts/`, { headers: headersFor(k) }, DEFAULT_TIMEOUT_MS);
    if (!r.ok) {
      const error = await errorFromResponse(r);
      if (r.status === 401 || r.status === 403) return { ok: false, status: r.status, error: "Klaviyo rechazó la clave. Verificá que sea una Private API Key con permisos Accounts: Read, Events: Write y Profiles: Write." };
      return { ok: false, status: r.status, error };
    }
    const j = await r.json().catch(() => ({}));
    const acc = Array.isArray(j?.data) ? j.data[0] : null;
    const organization = acc?.attributes?.contact_information?.organization_name || acc?.attributes?.contact_information?.default_sender_name || "";
    return { ok: true, status: r.status, organization: String(organization || "").slice(0, 120), account_id: acc?.id || null };
  } catch (e) {
    return { ok: false, error: `No se pudo contactar a Klaviyo: ${e.message}` };
  }
}

/**
 * Manda un evento a Klaviyo. NUNCA lanza.
 * @param merchant  doc del merchant (usa klaviyo_api_key)
 * @param opts { merchantId, metric, email, phone, firstName, lastName, externalId, address,
 *               properties, profileProperties, value, time, uniqueId, subscriberId, timeoutMs }
 * @returns {Promise<{ok:boolean, status?:number, error?:string, skipped?:string}>}
 */
export async function klaviyoTrack(merchant, opts = {}) {
  const merchantId = opts.merchantId || merchant?.id || merchant?.uid || null;
  const metric = String(opts.metric || "").trim();
  const email = normEmail(opts.email);
  try {
    if (!klaviyoEnabled(merchant)) return { ok: false, skipped: "not_enabled" };
    if (!metric) return { ok: false, skipped: "no_metric" };
    if (!email || !EMAIL_RE.test(email)) return { ok: false, skipped: "no_email" };

    const phone = toE164(opts.phone);
    const profileProps = compact(opts.profileProperties || {});
    const profileAttrs = compact({
      email,
      phone_number: phone || undefined,
      first_name: opts.firstName ? String(opts.firstName).slice(0, 120) : undefined,
      last_name: opts.lastName ? String(opts.lastName).slice(0, 120) : undefined,
      external_id: opts.externalId ? String(opts.externalId).slice(0, 120) : undefined,
      location: toLocation(opts.address),
      properties: Object.keys(profileProps).length ? profileProps : undefined,
    });
    const value = Number(opts.value);
    const hasValue = Number.isFinite(value) && value >= 0;
    const uniqueId = String(opts.uniqueId || `${metric}:${opts.subscriberId || email}:${Date.now()}`).slice(0, 255);
    const body = {
      data: {
        type: "event",
        attributes: compact({
          properties: opts.properties && typeof opts.properties === "object" ? opts.properties : {},
          time: opts.time || nowIso(),
          value: hasValue ? round2(value) : undefined,
          value_currency: hasValue ? "ARS" : undefined,
          unique_id: uniqueId,
          metric: { data: { type: "metric", attributes: { name: metric } } },
          profile: { data: { type: "profile", attributes: profileAttrs } },
        }),
      },
    };

    let r;
    try {
      r = await fetchWithTimeout(`${BASE}/events/`, {
        method: "POST", headers: headersFor(merchant.klaviyo_api_key), body: JSON.stringify(body),
      }, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    } catch (e) {
      const error = `fetch: ${e.message}`;
      console.warn(`[klaviyo] ${metric} → ${email} falló:`, error);
      await writeLog(merchantId, { metric, email, subscriber_id: opts.subscriberId, status: "error", error, unique_id: uniqueId });
      await markMerchantError(merchantId, error, null);
      return { ok: false, error };
    }
    if (r.status === 202 || r.ok) {
      await writeLog(merchantId, { metric, email, subscriber_id: opts.subscriberId, status: "sent", http_status: r.status, unique_id: uniqueId });
      return { ok: true, status: r.status };
    }
    const error = await errorFromResponse(r);
    console.warn(`[klaviyo] ${metric} → ${email} rechazado:`, error);
    await writeLog(merchantId, { metric, email, subscriber_id: opts.subscriberId, status: "error", http_status: r.status, error, unique_id: uniqueId });
    await markMerchantError(merchantId, error, r.status);
    return { ok: false, status: r.status, error };
  } catch (e) {
    // Último recurso: jamás romper el flujo del caller.
    console.warn(`[klaviyo] ${metric || "?"} error inesperado:`, e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Upsert del perfil SIN evento (POST /api/profile-import/: crea o actualiza por
 * email). Se usa cuando el "Checkout Started" ya salió con el lead y en Pagar
 * recién tenemos nombre / teléfono / dirección. NUNCA lanza.
 */
export async function klaviyoUpsertProfile(merchant, opts = {}) {
  const email = normEmail(opts.email);
  try {
    if (!klaviyoEnabled(merchant)) return { ok: false, skipped: "not_enabled" };
    if (!email || !EMAIL_RE.test(email)) return { ok: false, skipped: "no_email" };
    const props = compact(opts.properties || {});
    const attributes = compact({
      email,
      phone_number: toE164(opts.phone) || undefined,
      first_name: opts.firstName ? String(opts.firstName).slice(0, 120) : undefined,
      last_name: opts.lastName ? String(opts.lastName).slice(0, 120) : undefined,
      location: toLocation(opts.address),
      properties: Object.keys(props).length ? props : undefined,
    });
    const r = await fetchWithTimeout(`${BASE}/profile-import/`, {
      method: "POST", headers: headersFor(merchant.klaviyo_api_key),
      body: JSON.stringify({ data: { type: "profile", attributes } }),
    }, opts.timeoutMs || DEFAULT_TIMEOUT_MS);
    if (r.ok) return { ok: true, status: r.status };
    const error = await errorFromResponse(r);
    console.warn(`[klaviyo] profile-import → ${email} rechazado:`, error);
    return { ok: false, status: r.status, error };
  } catch (e) {
    console.warn(`[klaviyo] profile-import → ${email} falló:`, e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Helpers de shape (Shopify-like) ─────────────────────────────────────────

// URL del portal del cliente (misma regla que sync.portalUrlFor; duplicada acá
// para no importar sync.js y crear un ciclo sync → klaviyo → sync).
function portalUrl(sub) {
  const base = appBaseUrl();
  return sub?.portal_token ? `${base}/#/portal?token=${encodeURIComponent(sub.portal_token)}` : `${base}/#/portal`;
}

// Imagen del producto: la del plan (1 lectura, best-effort, cacheada por llamada).
async function productImageFor(merchantId, sub, given) {
  if (given !== undefined) return given || null;
  if (!merchantId || !sub?.plan_id) return null;
  try {
    const p = await db().collection("merchants").doc(merchantId).collection("plans").doc(String(sub.plan_id)).get();
    return p.exists ? (p.data().product_image || null) : null;
  } catch (_) { return null; }
}

// line_items con el mismo shape que la integración Shopify de Klaviyo.
function lineItemsFor(sub, imageUrl) {
  const ps = sub?.plan_snapshot || {};
  const qty = Math.max(1, parseInt(sub?.quantity || ps.units_per_shipment || 1, 10) || 1);
  const total = num(ps.total_per_charge_ars ?? ps.subscription_price_ars);
  const shipping = num(ps.shipping_price_ars);
  const linePrice = ps.subtotal_ars != null ? num(ps.subtotal_ars) : Math.max(0, total - shipping);
  return [{
    product_id: ps.shopify_product_id ? String(ps.shopify_product_id) : null,
    variant_id: ps.shopify_variant_id ? String(ps.shopify_variant_id) : null,
    title: ps.product_title || "Suscripción",
    quantity: qty,
    price: round2(qty ? linePrice / qty : linePrice),
    line_price: round2(linePrice),
    sku: null,
    image_url: imageUrl || null,
  }];
}

function subscriptionInfo(sub) {
  const ps = sub?.plan_snapshot || {};
  return compact({ plan_id: sub?.plan_id || undefined, pack_label: ps.pack_label || undefined, frequency_days: Number(ps.frequency_days) || undefined });
}

// Propiedades custom del perfil (recurrentes_*). Solo las que se conocen: las que
// se omiten NO se pisan (Klaviyo mergea).
function profilePropsFor(sub, status, extra = {}) {
  const ps = sub?.plan_snapshot || {};
  const orders = Array.isArray(sub?.shopify_orders) ? sub.shopify_orders.length : undefined;
  return compact({
    recurrentes_status: status || undefined,
    recurrentes_subscriber: status ? ["subscriber", "payment_failed", "paused"].includes(status) : undefined,
    recurrentes_plan: ps.product_title || undefined,
    recurrentes_frequency_days: Number(ps.frequency_days) || undefined,
    recurrentes_next_charge_at: extra.nextChargeAt !== undefined ? extra.nextChargeAt : (sub?.next_charge_at || undefined),
    recurrentes_first_charge_at: extra.firstChargeAt || undefined,
    recurrentes_orders_count: extra.ordersCount !== undefined ? extra.ordersCount : orders,
  });
}

function baseProfile(sub) {
  const { firstName, lastName } = splitName(sub?.customer_name);
  return {
    email: sub?.customer_email,
    phone: sub?.customer_phone || sub?.shipping_address?.phone,
    firstName, lastName,
    address: sub?.shipping_address,
  };
}

// Clave del "carrito" actual: si cambia el pack/qty/frecuencia se vuelve a mandar
// Checkout Started; si no, no se repite por el mismo sub.
export function checkoutKeyFor(sub) {
  const ps = sub?.plan_snapshot || {};
  if (ps.pack_index != null) return `pack${ps.pack_index}`;
  return `q${sub?.quantity || ps.units_per_shipment || 1}-f${ps.frequency_days || 0}`;
}

/**
 * "Checkout Started" con payload Shopify-like. Devuelve el resultado de klaviyoTrack
 * (+ `key`, para que el caller la persista y no repita).
 * @param extra { recoverUrl, imageUrl, stage: "lead"|"checkout", skipProfileStatus, timeoutMs, test }
 */
export async function klaviyoCheckoutStarted(merchant, merchantId, subscriberId, sub, extra = {}) {
  if (!klaviyoEnabled(merchant) || !sub) return { ok: false, skipped: "not_enabled" };
  const ps = sub.plan_snapshot || {};
  const title = ps.product_title || "Suscripción";
  const total = extra.test ? 1 : num(ps.total_per_charge_ars ?? ps.subscription_price_ars);
  const key = checkoutKeyFor(sub);
  const recoverUrl = extra.recoverUrl || null;
  const imageUrl = await productImageFor(merchantId, sub, extra.imageUrl);
  const properties = {
    $value: round2(total),
    $event_id: extra.test ? `test:${Date.now()}` : subscriberId,
    Items: [title],
    ItemNames: [title],
    CheckoutURL: recoverUrl,
    Categories: [CATEGORY],
    extra: compact({
      checkout_url: recoverUrl,
      currency: "ARS",
      line_items: lineItemsFor(sub, imageUrl),
      subscription: subscriptionInfo(sub),
      stage: extra.stage || undefined,
      subscriber_id: subscriberId,
      test: extra.test ? true : undefined,
    }),
  };
  const r = await klaviyoTrack(merchant, {
    merchantId, subscriberId,
    metric: KLAVIYO_METRICS.CHECKOUT_STARTED,
    ...baseProfile(sub),
    properties, value: total,
    // Un suscriptor activo que abre otro checkout NO se degrada a "checkout_started".
    // El evento de prueba no toca el perfil del merchant.
    profileProperties: extra.test ? {} : (extra.skipProfileStatus ? profilePropsFor(sub, null) : profilePropsFor(sub, "checkout_started", { nextChargeAt: undefined })),
    uniqueId: extra.test ? `${KLAVIYO_METRICS.CHECKOUT_STARTED}:test:${Date.now()}` : `${KLAVIYO_METRICS.CHECKOUT_STARTED}:${subscriberId}:${key}`,
    timeoutMs: extra.timeoutMs,
  });
  return { ...r, key };
}

/**
 * "Placed Order" (solo si merchant.klaviyo_send_orders === true). Mismo shape que Shopify.
 * @param extra { payment, orderId, chargeNumber, firstChargeAt }
 */
export async function klaviyoPlacedOrder(merchant, merchantId, subscriberId, sub, extra = {}) {
  if (!klaviyoEnabled(merchant) || merchant.klaviyo_send_orders !== true || !sub) return { ok: false, skipped: "orders_disabled" };
  const orderId = extra.orderId != null ? String(extra.orderId) : null;
  if (!orderId) return { ok: false, skipped: "no_order" };
  const ps = sub.plan_snapshot || {};
  const title = ps.product_title || "Suscripción";
  const payment = extra.payment || null;
  const total = num(payment?.transaction_amount ?? ps.total_per_charge_ars);
  const imageUrl = await productImageFor(merchantId, sub, extra.imageUrl);
  const properties = {
    $value: round2(total),
    $event_id: orderId,
    OrderId: orderId,
    Items: [title],
    ItemNames: [title],
    Categories: [CATEGORY],
    extra: compact({
      currency: "ARS",
      line_items: lineItemsFor(sub, imageUrl),
      subscription: subscriptionInfo(sub),
      charge_number: extra.chargeNumber || undefined,
      mp_payment_id: payment?.id != null ? String(payment.id) : undefined,
      subscriber_id: subscriberId,
    }),
  };
  return klaviyoTrack(merchant, {
    merchantId, subscriberId,
    metric: KLAVIYO_METRICS.PLACED_ORDER,
    ...baseProfile(sub),
    properties, value: total,
    time: payment?.date_approved || undefined,
    profileProperties: profilePropsFor(sub, "subscriber", { firstChargeAt: extra.firstChargeAt, ordersCount: extra.ordersCount }),
    uniqueId: `${KLAVIYO_METRICS.PLACED_ORDER}:${subscriberId}:${orderId}`,
  });
}

// Estado de perfil que implica cada métrica de ciclo de vida.
const LIFECYCLE_STATUS = {
  [KLAVIYO_METRICS.ACTIVATED]: "subscriber",
  [KLAVIYO_METRICS.RENEWED]: "subscriber",
  [KLAVIYO_METRICS.RESUMED]: "subscriber",
  [KLAVIYO_METRICS.PAYMENT_FAILED]: "payment_failed",
  [KLAVIYO_METRICS.PAUSED]: "paused",
  [KLAVIYO_METRICS.CANCELLED]: "cancelled",
};

/**
 * Eventos de ciclo de vida que Shopify no tiene (Activated / Renewed / Payment
 * Failed / Cancelled / Paused / Resumed). Actualiza recurrentes_* del perfil.
 * @param extra { payment, orderId, uniqueSuffix, properties, nextChargeAt, firstChargeAt, ordersCount }
 */
export async function klaviyoLifecycle(merchant, merchantId, metric, subscriberId, sub, extra = {}) {
  if (!klaviyoEnabled(merchant) || !sub) return { ok: false, skipped: "not_enabled" };
  const ps = sub.plan_snapshot || {};
  const title = ps.product_title || "Suscripción";
  const payment = extra.payment || null;
  const amount = num(payment?.transaction_amount ?? ps.total_per_charge_ars ?? ps.subscription_price_ars);
  const suffix = payment?.id != null ? String(payment.id) : String(extra.uniqueSuffix || Date.now());
  const properties = compact({
    $value: round2(amount),
    $event_id: `${subscriberId}:${suffix}`,
    Items: [title],
    ItemNames: [title],
    Categories: [CATEGORY],
    subscriber_id: subscriberId,
    plan_id: sub.plan_id || undefined,
    plan_title: title,
    pack_label: ps.pack_label || undefined,
    qty: Number(sub.quantity || ps.units_per_shipment || 1) || 1,
    amount_ars: round2(amount),
    frequency_days: Number(ps.frequency_days) || undefined,
    next_charge_at: extra.nextChargeAt !== undefined ? extra.nextChargeAt : (sub.next_charge_at || undefined),
    portal_url: portalUrl(sub),
    mp_payment_id: payment?.id != null ? String(payment.id) : undefined,
    mp_payment_status: payment?.status || undefined,
    order_id: extra.orderId != null ? String(extra.orderId) : undefined,
    ...(extra.properties || {}),
  });
  return klaviyoTrack(merchant, {
    merchantId, subscriberId, metric,
    ...baseProfile(sub),
    properties, value: amount,
    profileProperties: profilePropsFor(sub, LIFECYCLE_STATUS[metric] || undefined, {
      nextChargeAt: extra.nextChargeAt, firstChargeAt: extra.firstChargeAt, ordersCount: extra.ordersCount,
    }),
    uniqueId: `${metric}:${subscriberId}:${suffix}`,
  });
}
