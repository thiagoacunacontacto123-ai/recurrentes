// api/_lib/meta.js — Envía el evento "Purchase" a la API de Conversiones de Meta
// (CAPI, server-side) cuando se activa una suscripción. SOLO el primer cobro
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
 * @param {string} [o.clientIp]  / {string} [o.clientUa]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function sendMetaPurchase(o) {
  if (!o?.pixelId || !o?.token) return { ok: false, error: "sin pixel/token" };
  const userData = {
    em: hash(o.email) ? [hash(o.email)] : undefined,
    ph: hashPhone(o.phone) ? [hashPhone(o.phone)] : undefined,
    fn: hash(o.firstName) ? [hash(o.firstName)] : undefined,
    ln: hash(o.lastName) ? [hash(o.lastName)] : undefined,
    ct: hash(o.city) ? [hash(o.city)] : undefined,
    zp: hash(o.zip) ? [hash(o.zip)] : undefined,
    client_ip_address: o.clientIp || undefined,
    client_user_agent: o.clientUa || undefined,
  };
  // Limpiar undefined
  Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

  const event = {
    event_name: "Purchase",
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
