// api/_lib/meta.js — API de Conversiones de Meta (CAPI, server-side): AddToCart al abrir
// el checkout, InitiateCheckout al dejar el mail y "Purchase" cuando se activa una suscripción. SOLO el primer cobro
// (la venta que trajo el ad) se reporta — las renovaciones NO, para no inflar
// la atribución. Best-effort: si falla, no rompe el webhook.
//
// Docs: https://developers.facebook.com/docs/marketing-api/conversions-api

import crypto from "crypto";

const GRAPH_VERSION = "v21.0";

// Meta exige la PII hasheada en SHA-256, minúsculas y sin espacios.
function hash(value) {
  if (!value) return undefined;
  const norm = String(value).trim().toLowerCase();
  if (!norm) return undefined;
  return crypto.createHash("sha256").update(norm).digest("hex");
}
// Teléfono: solo dígitos, con código de país si se puede (Meta lo pide E.164 sin +).
function hashPhone(phone) {
  if (!phone) return undefined;
  let digits = String(phone).replace(/\D/g, "");
  if (!digits) return undefined;
  // Argentina: si no arranca con 54, se lo anteponemos (heurística, no rompe si ya viene).
  if (!digits.startsWith("54") && digits.length <= 11) digits = "54" + digits;
  return crypto.createHash("sha256").update(digits).digest("hex");
}

/**
 * Manda un evento Purchase a Meta CAPI.
 * @param {object} o
 * @param {string} o.pixelId     - Pixel/Dataset ID del merchant
 * @param {string} o.token       - Token de la API de Conversiones del merchant
 * @param {number} o.value       - Monto de la venta
 * @param {string} [o.currency]  - Moneda (default ARS)
 * @param {string} [o.email]     - Email del comprador (se hashea)
 * @param {string} [o.phone]     - Teléfono del comprador (se hashea)
 * @param {string} [o.firstName] / {string} [o.lastName] / {string} [o.city] / {string} [o.zip]
 * @param {string} o.eventId     - ID único del evento (dedup con el pixel si lo hubiera)
 * @param {string} [o.eventSourceUrl]
 * @param {string} [o.clientIp]  / {string} [o.client_ip_address] / {string} [o.clientUa]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
// Emisor genérico de eventos CAPI. eventName = "Purchase" | "InitiateCheckout" | …
export async function sendMetaEvent(eventName, o) {
  if (!o?.pixelId || !o?.token) return { ok: false, error: "sin pixel/token" };
  const userData = {
    em: hash(o.email) ? [hash(o.email)] : undefined,
    ph: hashPhone(o.phone) ? [hashPhone(o.phone)] : undefined,
    fn: hash(o.firstName) ? [hash(o.firstName)] : undefined,
    ln: hash(o.lastName) ? [hash(o.lastName)] : undefined,
    ct: hash(o.city) ? [hash(o.city)] : undefined,
    zp: hash(o.zip) ? [hash(o.zip)] : undefined,
    country: hash("ar"),
    // fbc/fbp NO se hashean — son los IDs de click/navegador de Meta. Son EL
    // señalador más fuerte para atribuir la venta al anuncio correcto.
    fbc: o.fbc || undefined,
    fbp: o.fbp || undefined,
    // IP del cliente (viene de fb_data.client_ip_address capturada en el checkout).
    client_ip_address: o.clientIp || o.client_ip_address || undefined,
    client_user_agent: o.clientUa || undefined,
  };
  // Limpiar undefined
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

  const event = {
    event_name: eventName,
    event_time: Math.floor(Date.now() / 1000),
    action_source: "website",
    event_id: o.eventId ? String(o.eventId) : undefined,
    event_source_url: o.eventSourceUrl || undefined,
    user_data: userData,
    custom_data: {
      value: Number(o.value) || 0,
      currency: o.currency || "ARS",
    },
  };

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(o.pixelId)}/events?access_token=${encodeURIComponent(o.token)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event] }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d?.error?.message || `HTTP ${r.status}` };
    return { ok: true, received: d?.events_received };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── Embudo que le mandamos a Meta (Thiago, 18-sept) ──────────────────────────
//   AddToCart        → "carrito": el cliente tocó Suscribirse y se abrió el checkout.
//   InitiateCheckout → "pago iniciado": dejó su mail en el checkout (o tocó Pagar).
//   Purchase         → "compra": Mercado Pago confirmó el primer cobro.
// Las renovaciones NO se mandan. Cada evento lleva event_id estable para que Meta
// deduplique si el mismo paso se reporta dos veces (lead + Pagar, webhook + sync).
export async function sendMetaPurchase(o) { return sendMetaEvent("Purchase", o); }
export async function sendMetaInitiateCheckout(o) { return sendMetaEvent("InitiateCheckout", o); }
export async function sendMetaAddToCart(o) { return sendMetaEvent("AddToCart", o); }

// Manda un evento del embudo si la tienda tiene Meta conectado. Nunca lanza.
// `fb` = lo que capturó el navegador: { fbp, fbc, event_source_url, user_agent }.
export async function metaFunnel(merchant, eventName, { fb = null, clientIp = null, tag = "checkout", ...o } = {}) {
  if (!merchant?.meta_pixel_id || !merchant?.meta_capi_token) return null;
  try {
    const r = await sendMetaEvent(eventName, {
      pixelId: merchant.meta_pixel_id, token: merchant.meta_capi_token,
      fbc: fb?.fbc || undefined, fbp: fb?.fbp || undefined,
      clientUa: fb?.user_agent || undefined, clientIp: clientIp || fb?.client_ip_address || undefined,
      eventSourceUrl: fb?.event_source_url || undefined,
      ...o,
    });
    console.log(`[${tag}] Meta CAPI ${eventName} ${o.eventId || ""}: ${r.ok ? "ok" : "FALLO " + r.error}`);
    return r;
  } catch (e) {
    console.warn(`[${tag}] Meta CAPI ${eventName}:`, e.message);
    return { ok: false, error: e.message };
  }
}
