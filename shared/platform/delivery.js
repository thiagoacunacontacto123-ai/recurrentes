// Entrega digital por plan — qué recibe el cliente cuando se activa (y opcionalmente
// en cada renovación) una suscripción a un producto digital o a un servicio.
//
// Fuente ÚNICA compartida por el backend (api/plans.js valida y guarda,
// api/_lib/delivery.js manda el mail) y el panel (PlanEditor: formulario + vista previa).
//
// Forma guardada en merchants/{mid}/plans/{planId}.digital_delivery:
//   { enabled: boolean, url: "https://…", message: "texto corto", send_on: ["activation","renewal"] }
//
// Solo aplica a negocios SIN envío (digital / servicio): para físicos (Lumina) el
// panel no muestra la sección y el backend no hace nada aunque el campo exista.

export const DELIVERY_SEND_ON = ["activation", "renewal"];
export const DELIVERY_SEND_ON_LABELS = {
  activation: "Cuando se activa la suscripción",
  renewal: "En cada renovación",
};
export const DELIVERY_URL_MAX = 1000;
export const DELIVERY_MESSAGE_MAX = 500;

// ¿El perfil del merchant usa entrega digital? (merchantProfile(m) de profile.js)
export const deliveryApplies = (profile) => !!profile && profile.caps?.shipping === false;

// Normaliza un link: agrega https:// si falta el esquema y solo acepta http(s).
// Devuelve el string normalizado o null si no es un link válido.
export function normalizeDeliveryUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!u.hostname || !u.hostname.includes(".")) return null;
  const out = u.toString();
  return out.length > DELIVERY_URL_MAX ? null : out;
}

/**
 * Valida y normaliza lo que manda el panel. Devuelve { value } o { error }.
 *   · enabled sin link válido → error.
 *   · desactivada: guarda el link/mensaje igual (para no perderlos al apagar y prender).
 *   · send_on vacío con la entrega activa → ["activation"].
 *   · null / undefined → { value: null } (sin entrega).
 */
export function normalizeDigitalDelivery(input) {
  if (input == null) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "digital_delivery inválido" };
  const enabled = input.enabled === true;
  const rawUrl = String(input.url || "").trim();
  const url = rawUrl ? normalizeDeliveryUrl(rawUrl) : null;
  if (rawUrl && !url) return { error: "El link de la entrega no es válido. Pegá un link completo, por ejemplo https://drive.google.com/…" };
  if (enabled && !url) return { error: "Pegá el link de lo que recibe tu cliente (curso, carpeta, ebook…)" };
  const message = String(input.message || "").replace(/\r\n/g, "\n").trim();
  if (message.length > DELIVERY_MESSAGE_MAX) return { error: `El mensaje de la entrega es muy largo (máximo ${DELIVERY_MESSAGE_MAX} caracteres)` };
  let sendOn = Array.isArray(input.send_on) ? DELIVERY_SEND_ON.filter(k => input.send_on.includes(k)) : [];
  if (enabled && sendOn.length === 0) sendOn = ["activation"];
  return { value: { enabled, url: url || "", message, send_on: sendOn } };
}

// ¿Hay que mandar la entrega en este evento ("activation" | "renewal")?
export function shouldDeliver(dd, event) {
  return !!(dd && dd.enabled === true && dd.url && Array.isArray(dd.send_on) && dd.send_on.includes(event));
}
