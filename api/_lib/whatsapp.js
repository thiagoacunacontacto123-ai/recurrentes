// WhatsApp Business Cloud API (oficial de Meta) — envío de plantillas a clientes finales.
//
// DOS FORMAS DE MANDAR (waSender):
//   1) Número propio del comerciante (avanzado): whatsapp_phone_number_id + whatsapp_access_token
//      en su doc. Paga él directo a Meta.
//   2) Número de Recurrentes (por defecto): el comerciante solo prende "Avisos por WhatsApp"
//      (merchant.whatsapp_platform_enabled === true) y las env WHATSAPP_PHONE_NUMBER_ID +
//      WHATSAPP_ACCESS_TOKEN están cargadas. Solo plantillas de Recurrentes (WA_TEMPLATES,
//      llevan el nombre de la tienda). El costo de Meta × WHATSAPP_MARKUP se suma a su plan.
//   Prioridad: número propio > número de Recurrentes > no se manda nada.
//
//   sendTemplate({ merchant | sender, to, template, lang, components })
//     POST https://graph.facebook.com/{v}/{phone-number-id}/messages. Fuera de la ventana de
//     24 h solo se pueden mandar PLANTILLAS aprobadas por Meta.
//     → { ok:true, id (wamid), wa_id, mode } | { ok:false, skipped?, reason?, code, error, retryable, reconnect }
//   waValidateCredentials({ phone_number_id, waba_id, token }) — llamadas de solo lectura.
//   waListTemplates(merchant) — plantillas de la WABA propia (para el editor de flujos).
//   runWhatsappFlowStep(...) — lo usa el motor de flujos (api/_lib/flows.js).
//   recordWaUsage(mid, mode) — uso del mes (merchants/{mid}/usage/{YYYY-MM} + admin_usage/{YYYY-MM}).
//
// Conexión propia (merchant doc, nunca se devuelve el token):
//   whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token, whatsapp_app_secret?,
//   whatsapp_verify_token, whatsapp_display_phone, whatsapp_verified_name, whatsapp_quality,
//   whatsapp_connected_at, whatsapp_last_error(_at).
// Número de Recurrentes (merchant doc): whatsapp_platform_enabled, whatsapp_platform_optin_at.
// Registro: merchants/{mid}/message_log/{sha(wamid) | auto}  (canal "whatsapp"; ver logWaMessage)
// Bajas:    merchants/{mid}/wa_optouts/{sha256(E.164)}      (respondió BAJA, o sub.whatsapp_optout)
//           wa_platform_optouts/{sha256(E.164)}              (respondió BAJA al número de Recurrentes)
// Índices del número de Recurrentes (solo Admin SDK):
//   wa_platform_msgs/{sha(wamid)} { mid }        → el webhook sabe de qué tienda es cada estado
//   wa_contacts/{sha256(E.164)} { merchants:{mid:iso}, last_autoreply_at } → a quién le escribimos
//
// NUNCA loguear tokens: los errores se guardan ya mapeados y pasados por scrub().
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { sha256hex, timingSafeEqualStr } from "./token.js";
import {
  normalizePhoneAR, maskPhone, templateParams, WA_DEFAULT_LANG, WA_TEMPLATE_NAME_RE, WA_LANG_RE,
  WA_TEMPLATE_BY_NAME, waUsageMonth,
} from "../../shared/platform/whatsapp.js";
import { WHATSAPP_PRICE_USD_UTILITY_DEFAULT, WHATSAPP_PRICE_USD_MARKETING_DEFAULT, WHATSAPP_MARKUP, waChargeUsd } from "../../shared/platform/pricing.js";
import { checkWaFreeCap } from "./waBilling.js";

const GRAPH = "https://graph.facebook.com";
// v25.0 (vigente hasta 2028-07). WHATSAPP_GRAPH_VERSION permite subirla sin deploy de código.
const DEFAULT_VERSION = "v25.0";
export const graphVersion = () => {
  const v = String(process.env.WHATSAPP_GRAPH_VERSION || "").trim();
  return /^v\d{1,2}\.\d$/.test(v) ? v : DEFAULT_VERSION;
};

export const whatsappEnabled = (m) => Boolean(m && m.whatsapp_phone_number_id && m.whatsapp_access_token);

// ── Número de Recurrentes (env) ────────────────────────────────────
export function platformWaConfig() {
  const pid = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim();
  const token = String(process.env.WHATSAPP_ACCESS_TOKEN || "").trim();
  if (!/^\d{5,25}$/.test(pid) || token.length < 20) return null;
  return { phone_number_id: pid, token, waba_id: String(process.env.WHATSAPP_WABA_ID || "").trim() || null };
}
export const platformWaAvailable = () => Boolean(platformWaConfig());
export const isPlatformPhoneId = (pid) => { const c = platformWaConfig(); return Boolean(c && pid && String(pid) === c.phone_number_id); };

// Quién manda por esta tienda: número propio > número de Recurrentes > nadie (null).
export function waSender(m) {
  if (whatsappEnabled(m)) return { mode: "own", phone_number_id: String(m.whatsapp_phone_number_id), token: m.whatsapp_access_token };
  if (m && m.whatsapp_platform_enabled === true) {
    // Plan gratis que llegó al tope de uso (waBilling.js): el número no manda por esta tienda.
    if (m.wa_paused_for_billing === true) return null;
    const c = platformWaConfig();
    if (c) return { mode: "platform", phone_number_id: c.phone_number_id, token: c.token, waba_id: c.waba_id };
  }
  return null;
}

// Precio de Meta por plantilla de utilidad (USD). Env WHATSAPP_PRICE_USD_UTILITY lo pisa.
export function waPriceUsd(category = "UTILITY") {
  const mk = String(category || "").toUpperCase() === "MARKETING";
  const n = Number(String((mk ? process.env.WHATSAPP_PRICE_USD_MARKETING : process.env.WHATSAPP_PRICE_USD_UTILITY) || "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 && n < 1 ? n : (mk ? WHATSAPP_PRICE_USD_MARKETING_DEFAULT : WHATSAPP_PRICE_USD_UTILITY_DEFAULT);
}
// Categoría de una plantilla de Recurrentes por nombre (para cobrarla al precio que corresponde).
export const waTemplateCategory = (name) => (WA_TEMPLATE_BY_NAME[name]?.category || "UTILITY");

// Campos para GET /api/merchant (sin token ni app secret, ni datos del número de Recurrentes).
export function whatsappSafe(m) {
  const on = whatsappEnabled(m);
  const price = waPriceUsd();
  return {
    whatsapp_connected: on,
    whatsapp_phone_number_id: on ? (m.whatsapp_phone_number_id || null) : null,
    whatsapp_waba_id: on ? (m.whatsapp_waba_id || null) : null,
    whatsapp_display_phone: on ? (m.whatsapp_display_phone || null) : null,
    whatsapp_verified_name: on ? (m.whatsapp_verified_name || null) : null,
    whatsapp_quality: on ? (m.whatsapp_quality || null) : null,
    whatsapp_connected_at: on ? (m.whatsapp_connected_at || null) : null,
    whatsapp_access_token: on ? "•••••" : null,
    whatsapp_has_app_secret: on && Boolean(m.whatsapp_app_secret),
    whatsapp_verify_token: on ? (m.whatsapp_verify_token || null) : null,
    whatsapp_optin_confirmed_at: on ? (m.whatsapp_optin_confirmed_at || null) : null,
    whatsapp_last_error: on ? (m.whatsapp_last_error || null) : null,
    whatsapp_last_error_at: on ? (m.whatsapp_last_error_at || null) : null,
    // Número de Recurrentes: solo booleanos + precio (nunca el id ni el token de la env).
    whatsapp_platform_available: platformWaAvailable(),
    whatsapp_platform_enabled: m?.whatsapp_platform_enabled === true,
    whatsapp_platform_optin_at: m?.whatsapp_platform_optin_at || null,
    whatsapp_sender: waSender(m)?.mode || null,            // "own" | "platform" | null
    whatsapp_price_usd: price,                              // lo que cobra Meta por aviso
    whatsapp_charge_usd: waChargeUsd(price),                // lo que paga la tienda (× WHATSAPP_MARKUP)
    whatsapp_markup: WHATSAPP_MARKUP,
  };
}

// Borra cualquier cosa con forma de token de Meta (EAA…) o "access_token=…" de un texto.
export const scrub = (s) => String(s || "")
  .replace(/EAA[A-Za-z0-9]{10,}/g, "EAA•••")
  .replace(/(access_token=)[^&\s"]+/gi, "$1•••")
  .slice(0, 400);

// ── HTTP a la Graph API ────────────────────────────────────────────
// Exportada como graphRequest para módulos que hablan con Meta fuera del envío
// (crear plantillas por API en waTemplates.js).
export async function graph(path, { token, method = "GET", body, timeoutMs = 8000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(`${GRAPH}/${graphVersion()}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const data = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok && !data?.error, data: data || {} };
  } catch (e) {
    const timeout = e?.name === "AbortError";
    return { status: 0, ok: false, data: { error: { code: timeout ? "timeout" : "network", message: timeout ? "Meta no respondió a tiempo" : e.message } } };
  } finally { clearTimeout(t); }
}

// ── Errores de Meta → mensaje claro en castellano ──────────────────
// reconnect: hay que cargar credenciales nuevas · retryable: probar más tarde sirve.
const ERRORS = {
  0:      ["El token de WhatsApp no es válido. Cargá uno nuevo en Integraciones.", { reconnect: true }],
  190:    ["El token de WhatsApp venció o fue revocado. Cargá uno nuevo (token permanente de usuario del sistema) en Integraciones.", { reconnect: true }],
  3:      ["El token no tiene permiso para esta acción (revisá los permisos del usuario del sistema).", { reconnect: true }],
  10:     ["El token no tiene permiso para mandar mensajes desde este número (whatsapp_business_messaging).", { reconnect: true }],
  200:    ["El token no tiene permiso sobre esta cuenta de WhatsApp Business.", { reconnect: true }],
  100:    ["Meta rechazó un dato del pedido (revisá el ID del número, la plantilla y las variables)."],
  4:      ["Meta limitó las llamadas de la app por un rato. Se reintenta más tarde.", { retryable: true }],
  80007:  ["Se alcanzó el límite de envíos de esta cuenta de WhatsApp. Se reintenta más tarde.", { retryable: true }],
  130429: ["Se alcanzó el límite de mensajes por segundo del número. Se reintenta más tarde.", { retryable: true }],
  131056: ["Demasiados mensajes seguidos al mismo cliente. Se reintenta más tarde.", { retryable: true }],
  131048: ["Meta frenó los envíos de este número por reportes de spam o baja calidad."],
  131026: ["No se pudo entregar: el número no tiene WhatsApp, o el cliente no aceptó las condiciones nuevas de WhatsApp."],
  131047: ["Pasaron más de 24 h desde el último mensaje del cliente: solo se pueden mandar plantillas aprobadas."],
  131051: ["Tipo de mensaje no soportado."],
  131021: ["El número del cliente es el mismo que el que manda los avisos."],
  131049: ["Meta retuvo el mensaje para no saturar al cliente. Se reintenta más tarde.", { retryable: true }],
  131037: ["Meta todavía no aprobó el nombre visible del número de WhatsApp."],
  131030: ["Ese número no está en la lista de destinatarios de prueba. Mientras la app de Meta esté en modo desarrollo, agregalo en WhatsApp → Configuración de la API."],
  131031: ["La cuenta de WhatsApp Business está bloqueada. Revisalo en WhatsApp Manager.", { reconnect: true }],
  131042: ["Falta un medio de pago válido en la cuenta de WhatsApp Business (Meta cobra por mensaje)."],
  131045: ["El número no está bien registrado en la Cloud API (certificado). Revisalo en WhatsApp Manager."],
  131008: ["Falta una variable que la plantilla necesita."],
  131009: ["Alguna variable tiene un valor que Meta no acepta."],
  131000: ["Error interno de WhatsApp. Se reintenta más tarde.", { retryable: true }],
  131016: ["WhatsApp no está disponible en este momento. Se reintenta más tarde.", { retryable: true }],
  132000: ["La cantidad de variables no coincide con la plantilla aprobada."],
  132001: ["La plantilla no existe en ese idioma o todavía no está aprobada por Meta."],
  132005: ["El texto de la plantilla con las variables puestas quedó demasiado largo."],
  132007: ["El contenido de la plantilla no cumple las políticas de WhatsApp."],
  132012: ["El formato de las variables no coincide con la plantilla."],
  132015: ["La plantilla está pausada por baja calidad. Revisala en WhatsApp Manager."],
  132016: ["La plantilla fue deshabilitada por Meta. Creá y aprobá otra."],
  133010: ["El número no está registrado en la Cloud API. Terminá el registro en WhatsApp Manager."],
  368:    ["Meta bloqueó temporalmente la cuenta por incumplir sus políticas."],
  timeout: ["Meta no respondió a tiempo. Se reintenta más tarde.", { retryable: true }],
  network: ["No pudimos comunicarnos con Meta. Se reintenta más tarde.", { retryable: true }],
};

export function mapWaError(status, data) {
  const e = data?.error || {};
  const code = e.code ?? (status ? `http_${status}` : "unknown");
  const [msg, flags = {}] = ERRORS[code] || [];
  const detail = scrub(e.error_data?.details || e.error_user_msg || e.message || "");
  const retryable = Boolean(flags.retryable || (!msg && (status >= 500 || status === 429)) || e.is_transient === true);
  return {
    ok: false,
    code,
    subcode: e.error_subcode ?? null,
    error: msg || (detail ? `WhatsApp: ${detail}` : `WhatsApp respondió con error (HTTP ${status || "sin respuesta"})`),
    detail,
    retryable,
    reconnect: Boolean(flags.reconnect),
    fbtrace_id: e.fbtrace_id || null,
  };
}

// ── Envío ──────────────────────────────────────────────────────────
// Cuerpo con parámetros de texto posicionales: {{1}}, {{2}}…
export const bodyComponents = (values) =>
  Array.isArray(values) && values.length ? [{ type: "body", parameters: values.map(text => ({ type: "text", text: String(text) })) }] : [];

export function buildTemplatePayload({ to, template, lang = WA_DEFAULT_LANG, components = [] }) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      ...(Array.isArray(components) && components.length ? { components } : {}),
    },
  };
}

export async function sendTemplate({ merchant, sender, to, template, lang = WA_DEFAULT_LANG, components = [], timeoutMs = 8000 } = {}) {
  const s = sender || waSender(merchant);
  if (!s) return { ok: false, skipped: true, reason: "not_connected", error: "WhatsApp no está conectado" };
  const e164 = normalizePhoneAR(to);
  if (!e164) return { ok: false, skipped: true, reason: "no_phone", error: "El cliente no tiene un teléfono válido" };
  const name = String(template || "").trim();
  if (!WA_TEMPLATE_NAME_RE.test(name)) return { ok: false, code: "template", error: "Nombre de plantilla inválido" };
  const code = WA_LANG_RE.test(String(lang || "")) ? lang : WA_DEFAULT_LANG;
  const payload = buildTemplatePayload({ to: e164.slice(1), template: name, lang: code, components });
  const r = await graph(`${encodeURIComponent(s.phone_number_id)}/messages`, {
    token: s.token, method: "POST", body: payload, timeoutMs,
  });
  if (r.ok) {
    const m = r.data?.messages?.[0] || {};
    return { ok: true, id: m.id || null, message_status: m.message_status || null, wa_id: r.data?.contacts?.[0]?.wa_id || null, to: e164, mode: s.mode };
  }
  const err = mapWaError(r.status, r.data);
  console.warn(`[whatsapp] envío ${name} (${s.mode}) → ${maskPhone(e164)}: ${err.code} ${err.detail || err.error}`);
  return { ...err, to: e164, mode: s.mode };
}

// Texto libre desde el número de Recurrentes (solo dentro de las 24 h que abre el cliente
// al escribir: es un mensaje de servicio, gratis). Lo usa la respuesta automática del webhook.
export async function sendPlatformText({ to, body, timeoutMs = 8000 } = {}) {
  const c = platformWaConfig();
  if (!c) return { ok: false, skipped: true, reason: "not_connected" };
  const e164 = normalizePhoneAR(to);
  if (!e164) return { ok: false, skipped: true, reason: "no_phone" };
  const r = await graph(`${encodeURIComponent(c.phone_number_id)}/messages`, {
    token: c.token, method: "POST", timeoutMs,
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: e164.slice(1), type: "text", text: { preview_url: false, body: String(body || "").slice(0, 4096) } },
  });
  if (r.ok) return { ok: true, id: r.data?.messages?.[0]?.id || null, to: e164 };
  const err = mapWaError(r.status, r.data);
  console.warn(`[whatsapp] respuesta automática → ${maskPhone(e164)}: ${err.code} ${err.detail || err.error}`);
  return err;
}

// ── Validación de credenciales (solo lectura) ──────────────────────
const ID_RE = /^\d{5,25}$/;
export async function waValidateCredentials({ phone_number_id, waba_id, token }) {
  const pid = String(phone_number_id || "").trim();
  const wid = String(waba_id || "").trim();
  const tok = String(token || "").trim();
  if (!ID_RE.test(pid)) return { ok: false, error: "El identificador del número (Phone number ID) son solo números" };
  if (!ID_RE.test(wid)) return { ok: false, error: "El identificador de la cuenta de WhatsApp Business (WABA ID) son solo números" };
  if (tok.length < 20 || /\s/.test(tok)) return { ok: false, error: "Pegá el token de acceso completo (empieza con EAA)" };

  const ph = await graph(`${pid}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, { token: tok });
  if (!ph.ok) {
    const e = mapWaError(ph.status, ph.data);
    return { ok: false, error: e.code === 100 ? "Meta no encontró ese número con este token. Revisá el Phone number ID y que el token tenga acceso a la cuenta." : e.error, code: e.code };
  }
  const nums = await graph(`${wid}/phone_numbers?fields=id,display_phone_number&limit=100`, { token: tok });
  if (!nums.ok) {
    const e = mapWaError(nums.status, nums.data);
    return { ok: false, error: e.code === 100 ? "Meta no encontró esa cuenta de WhatsApp Business con este token. Revisá el WABA ID." : e.error, code: e.code };
  }
  const list = Array.isArray(nums.data?.data) ? nums.data.data : [];
  if (!list.some(n => String(n.id) === pid)) return { ok: false, error: "Ese número no pertenece a esa cuenta de WhatsApp Business. Revisá los dos identificadores." };
  return {
    ok: true,
    display_phone_number: ph.data.display_phone_number || "",
    verified_name: ph.data.verified_name || "",
    quality_rating: ph.data.quality_rating || null,
    code_verification_status: ph.data.code_verification_status || null,
  };
}

// Plantillas de la WABA → [{ name, language, status, category, body, footer, var_count }]
export async function waListTemplates(merchant) {
  if (!whatsappEnabled(merchant) || !merchant.whatsapp_waba_id) return { ok: false, error: "WhatsApp no está conectado" };
  const r = await graph(`${encodeURIComponent(merchant.whatsapp_waba_id)}/message_templates?fields=name,language,status,category,components&limit=200`, { token: merchant.whatsapp_access_token });
  if (!r.ok) return mapWaError(r.status, r.data);
  const templates = (Array.isArray(r.data?.data) ? r.data.data : []).map(t => {
    const comps = Array.isArray(t.components) ? t.components : [];
    const body = comps.find(c => c.type === "BODY")?.text || "";
    const footer = comps.find(c => c.type === "FOOTER")?.text || "";
    const hasMediaHeader = comps.some(c => c.type === "HEADER" && c.format && c.format !== "TEXT");
    const headerVars = /\{\{\s*\d+\s*\}\}/.test(comps.find(c => c.type === "HEADER")?.text || "");
    const buttonVars = comps.some(c => c.type === "BUTTONS" && (c.buttons || []).some(b => /\{\{\s*\d+\s*\}\}/.test(b.url || "")));
    let var_count = 0;
    body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (_, n) => { var_count = Math.max(var_count, Number(n)); return ""; });
    return {
      name: t.name, language: t.language, status: t.status, category: t.category, body, footer, var_count,
      // Recurrentes solo completa variables del CUERPO: estas plantillas no se pueden usar tal cual.
      unsupported: hasMediaHeader || headerVars || buttonVars,
    };
  });
  return { ok: true, templates };
}

// ── Bajas (opt-out) ────────────────────────────────────────────────
const optoutsCol = (mid) => db().collection("merchants").doc(mid).collection("wa_optouts");
export const phoneKey = (e164) => sha256hex(String(e164 || "").replace(/\D/g, ""));

// { platform:true } → además mira la baja global del número de Recurrentes.
export async function isWhatsappOptedOut(mid, e164, sub, { platform = false } = {}) {
  if (sub?.whatsapp_optout === true || sub?.whatsapp_optin === false) return true;
  if (!mid || !e164) return false;
  try {
    if ((await optoutsCol(mid).doc(phoneKey(e164)).get()).exists) return true;
    if (platform && (await db().collection("wa_platform_optouts").doc(phoneKey(e164)).get()).exists) return true;
    return false;
  } catch (_) { return false; }
}

export async function setWhatsappOptOut(mid, e164, { optout = true, reason = "respuesta" } = {}) {
  if (!mid || !e164) return false;
  const ref = optoutsCol(mid).doc(phoneKey(e164));
  if (optout) await ref.set({ phone_masked: maskPhone(e164), reason, created_at: new Date().toISOString() }, { merge: true });
  else await ref.delete();
  return true;
}

// Baja global del número de Recurrentes (el cliente respondió BAJA a ese número).
export async function setPlatformOptOut(e164, { optout = true, reason = "respondió baja" } = {}) {
  if (!e164) return false;
  const ref = db().collection("wa_platform_optouts").doc(phoneKey(e164));
  if (optout) await ref.set({ phone_masked: maskPhone(e164), reason, created_at: new Date().toISOString() }, { merge: true });
  else await ref.delete();
  return true;
}

// ── Registro (message_log) ─────────────────────────────────────────
// Colección aparte de email_log a propósito: los resúmenes de mails del panel
// (stats?action=activity) cuentan todo lo de email_log como mails.
export const messageLogId = (wamid) => "wa_" + sha256hex(String(wamid)).slice(0, 40);
export async function logWaMessage(mid, entry) {
  if (!mid) return null;
  try {
    const col = db().collection("merchants").doc(mid).collection("message_log");
    const ref = entry.provider_id ? col.doc(messageLogId(entry.provider_id)) : col.doc();
    const now = new Date().toISOString();
    await ref.set({
      channel: "whatsapp",
      type: entry.type || "other",                 // "flow" | "test"
      sender: entry.sender || null,                // "own" | "platform"
      flow_id: entry.flow_id || null,
      flow_name: entry.flow_name || null,
      step: entry.step || null,
      subscriber_id: entry.subscriber_id || null,
      to: entry.to ? maskPhone(entry.to) : null,  // enmascarado: el completo está en la suscripción
      customer_name: entry.customer_name || null,
      product_title: entry.product_title || null,
      template: entry.template || null,
      lang: entry.lang || null,
      status: entry.status || "sent",             // sent | skipped | error → delivered | read | failed (webhook)
      reason: entry.reason || null,
      error: entry.error ? scrub(entry.error) : null,
      error_code: entry.error_code ?? null,
      provider_id: entry.provider_id || null,     // wamid
      created_at: now,
      updated_at: now,
    }, { merge: true });
    return ref.id;
  } catch (e) {
    console.warn(`[whatsapp] no se pudo registrar ${entry?.type || "?"}:`, e.message);
    return null;
  }
}

// Si Meta dice que hay que reconectar, lo dejamos a la vista en Integraciones.
// Solo para el número PROPIO: un error del número de Recurrentes no es culpa de la tienda.
export async function recordWaError(mid, merchant, err) {
  if (!mid) return;
  try {
    const ref = db().collection("merchants").doc(mid);
    if (err && err.reconnect) await ref.set({ whatsapp_last_error: scrub(err.error), whatsapp_last_error_at: new Date().toISOString() }, { merge: true });
    else if (!err && merchant?.whatsapp_last_error) await ref.set({ whatsapp_last_error: null, whatsapp_last_error_at: null }, { merge: true });
  } catch (_) {}
}
// Error del número de Recurrentes (token vencido, número bloqueado…): para Thiago.
export async function recordPlatformError(err) {
  if (!err || !err.reconnect) return;
  try { await db().collection("system").doc("whatsapp_platform").set({ last_error: scrub(err.error), last_error_code: err.code ?? null, last_error_at: new Date().toISOString() }, { merge: true }); }
  catch (_) {}
}

// ── Uso del mes (se cobra con el plan) ─────────────────────────────
// Número de Recurrentes: costo = precio de Meta × WHATSAPP_MARKUP. Número propio: se
// cuenta igual pero a costo 0 (lo paga la tienda a Meta). Increments atómicos.
// { type:"merchant_alert" } → aviso al comercio (merchantAlerts.js): se cobra igual y además
// se cuenta aparte en wa_alerts_sent / wa_alerts_cost_usd.
export async function recordWaUsage(mid, mode, { now = new Date(), type = null, category = "UTILITY", merchant = null } = {}) {
  if (!mid || (mode !== "own" && mode !== "platform")) return null;
  const month = waUsageMonth(now);
  const platform = mode === "platform";
  const alert = type === "merchant_alert";
  const price = platform ? waPriceUsd(category) : 0;
  // Al comercio se le cobra precio × recargo por TODO lo que sale por el número de
  // Recurrentes: mensajes a sus clientes y avisos a él mismo (Thiago, 18-sept-2026).
  // Los avisos al admin no pasan por acá (adminAlerts.js no registra uso).
  const cost = platform ? waChargeUsd(price) : 0;
  const at = now.toISOString();
  const inc = FieldValue.increment;
  try {
    await db().collection("merchants").doc(mid).collection("usage").doc(month).set({
      month, wa_sent: inc(1), wa_cost_usd: inc(cost),
      [platform ? "wa_platform_sent" : "wa_own_sent"]: inc(1), updated_at: at,
      ...(alert ? { wa_alerts_sent: inc(1), wa_alerts_cost_usd: inc(cost) } : {}),
    }, { merge: true });
    if (platform) {
      // Lo que falta facturar (waBilling.js) va PRIMERO: es lo que se cobra. En plan gratis,
      // al tope se pausa WhatsApp.
      await db().collection("merchants").doc(mid).set({ wa_unbilled_usd: inc(cost) }, { merge: true });
      if (merchant) await checkWaFreeCap(mid, merchant, (Number(merchant.wa_unbilled_usd) || 0) + cost);
      // Agregado del Admin (1 doc por mes para toda la plataforma): best-effort, si se
      // traba por contención no puede frenar el cobro de arriba.
      await db().collection("admin_usage").doc(month).set({
        month, wa_sent: inc(1), wa_cost_usd: inc(cost), wa_meta_cost_usd: inc(price), updated_at: at,
        ...(alert ? { wa_alerts_sent: inc(1) } : {}),
        merchants: { [mid]: { wa_sent: inc(1), wa_cost_usd: inc(cost), wa_meta_cost_usd: inc(price), ...(alert ? { wa_alerts_sent: inc(1) } : {}) } },
      }, { merge: true }).catch(e => console.warn(`[whatsapp] admin_usage ${month}:`, e.message));
    }
    return { month, cost };
  } catch (e) {
    console.warn(`[whatsapp] uso ${mid}:`, e.message);
    return null;
  }
}

export async function getWaUsage(mid, month = waUsageMonth()) {
  const empty = { month, wa_sent: 0, wa_cost_usd: 0, wa_platform_sent: 0, wa_own_sent: 0, wa_alerts_sent: 0 };
  if (!mid) return empty;
  const d = (await db().collection("merchants").doc(mid).collection("usage").doc(month).get()).data() || {};
  return {
    month,
    wa_sent: Number(d.wa_sent) || 0,
    wa_cost_usd: Math.round((Number(d.wa_cost_usd) || 0) * 1e6) / 1e6,
    wa_platform_sent: Number(d.wa_platform_sent) || 0,
    wa_own_sent: Number(d.wa_own_sent) || 0,
    wa_alerts_sent: Number(d.wa_alerts_sent) || 0,   // avisos al comercio (van incluidos en wa_sent)
  };
}

// Número de Recurrentes: recordar a quién le escribimos por qué tienda (el webhook
// resuelve con esto los estados de entrega, las bajas y la respuesta automática).
export async function rememberPlatformContact(mid, e164, wamid) {
  if (!mid || !e164) return;
  const at = new Date().toISOString();
  try {
    await db().collection("wa_contacts").doc(phoneKey(e164)).set({ phone_masked: maskPhone(e164), merchants: { [mid]: at }, last_mid: mid, last_sent_at: at }, { merge: true });
    if (wamid) await db().collection("wa_platform_msgs").doc(messageLogId(wamid)).set({ mid, created_at: at });
  } catch (e) { console.warn(`[whatsapp] contacto ${mid}:`, e.message); }
}

// Plantilla que efectivamente sale. Número de Recurrentes: solo plantillas de Recurrentes y
// con SU mapeo de variables (así el nombre de la tienda va siempre); número propio: la del paso.
export function resolveStepTemplate(sender, step) {
  if (sender?.mode === "platform") {
    const t = WA_TEMPLATE_BY_NAME[String(step?.template || "").trim().toLowerCase()];
    return t ? { template: t.name, lang: t.lang, vars: t.vars } : null;
  }
  return { template: step?.template, lang: step?.lang, vars: step?.vars || {} };
}

// Después de un envío: uso del mes, índices del número de Recurrentes y errores.
export async function afterWaSend(mid, merchant, sender, phone, r, { category = "UTILITY" } = {}) {
  if (r?.ok) {
    await recordWaUsage(mid, sender.mode, { category, merchant });
    if (sender.mode === "platform") await rememberPlatformContact(mid, phone, r.id);
  }
  if (sender.mode === "own") await recordWaError(mid, merchant, r?.ok ? null : r);
  else if (!r?.ok) await recordPlatformError(r);
}

// ── Paso de flujo ──────────────────────────────────────────────────
// Manda la plantilla del paso si: hay quien mande (número propio o de Recurrentes) +
// teléfono válido + sin baja. Sin quien mande: CERO lecturas. Nunca lanza.
// → { ok } | { skipped, reason } | { ok:false, error }
export async function runWhatsappFlowStep({ mid, merchant, sub, subscriberId, step, vars, flowId, flowName, stepNo }) {
  try {
    const sender = waSender(merchant);
    if (!sender) return { ok: false, skipped: true, reason: "not_connected" };
    const phone = normalizePhoneAR(sub?.customer_phone || sub?.shipping_address?.phone);
    const tpl = resolveStepTemplate(sender, step);
    const base = {
      type: "flow", sender: sender.mode, flow_id: flowId, flow_name: flowName, step: stepNo, subscriber_id: subscriberId,
      customer_name: sub?.customer_name, product_title: sub?.plan_snapshot?.product_title,
      template: tpl?.template || step?.template, lang: tpl?.lang || step?.lang,
    };
    if (!tpl) {
      await logWaMessage(mid, { ...base, status: "skipped", reason: "Esa plantilla no está disponible en el número de Recurrentes" });
      return { ok: false, skipped: true, reason: "template_not_platform" };
    }
    if (!phone) {
      await logWaMessage(mid, { ...base, status: "skipped", reason: "Sin teléfono" });
      return { ok: false, skipped: true, reason: "no_phone" };
    }
    if (await isWhatsappOptedOut(mid, phone, sub, { platform: sender.mode === "platform" })) {
      await logWaMessage(mid, { ...base, to: phone, status: "skipped", reason: "Se dio de baja de WhatsApp" });
      return { ok: false, skipped: true, reason: "optout" };
    }
    const params = templateParams(tpl.vars, vars || {});
    const r = await sendTemplate({ sender, to: phone, template: tpl.template, lang: tpl.lang, components: bodyComponents(params) });
    await logWaMessage(mid, {
      ...base, to: phone, status: r.ok ? "sent" : "error", error: r.ok ? null : r.error, error_code: r.ok ? null : r.code, provider_id: r.ok ? r.id : null,
    });
    await afterWaSend(mid, merchant, sender, phone, r, { category: waTemplateCategory(tpl.template) });
    return r;
  } catch (e) {
    console.warn(`[whatsapp] paso de flujo ${mid}/${subscriberId}:`, scrub(e.message));
    return { ok: false, error: scrub(e.message) };
  }
}

// ── Webhook: firma X-Hub-Signature-256 ─────────────────────────────
// "sha256=" + HMAC-SHA256(body crudo, app secret) en hex.
export function verifyWaSignature(raw, header, secrets) {
  const given = String(header || "").trim();
  if (!given.startsWith("sha256=") || !raw) return false;
  return (secrets || []).filter(Boolean).some(s =>
    timingSafeEqualStr("sha256=" + crypto.createHmac("sha256", s).update(raw).digest("hex"), given));
}
export const graphRequest = graph;
