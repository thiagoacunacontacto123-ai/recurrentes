// WhatsApp Business Cloud API (oficial de Meta) — envío de plantillas a clientes finales.
//
//   sendTemplate({ merchant, to, template, lang, components })
//     POST https://graph.facebook.com/{v}/{phone-number-id}/messages con el token del
//     comerciante. Fuera de la ventana de 24 h solo se pueden mandar PLANTILLAS
//     aprobadas por Meta; los avisos de Recurrentes siempre van como plantilla.
//     → { ok:true, id (wamid), wa_id } | { ok:false, skipped?, reason?, code, error, retryable, reconnect }
//   waValidateCredentials({ phone_number_id, waba_id, token }) — llamadas de solo lectura
//     (datos del número + números de la WABA) para validar antes de guardar.
//   waListTemplates(merchant) — plantillas de la WABA (para el editor de flujos).
//   runWhatsappFlowStep(...) — lo usa el motor de flujos (api/_lib/flows.js).
//
// Conexión por comerciante (merchant doc, nunca se devuelve el token):
//   whatsapp_phone_number_id, whatsapp_waba_id, whatsapp_access_token (token permanente
//   de un usuario del sistema), whatsapp_app_secret? (firma del webhook si usa su propia
//   app de Meta), whatsapp_verify_token, whatsapp_display_phone, whatsapp_verified_name,
//   whatsapp_quality, whatsapp_connected_at, whatsapp_last_error(_at).
// Registro: merchants/{mid}/message_log/{sha(wamid) | auto}  (canal "whatsapp"; ver logWaMessage)
// Bajas:    merchants/{mid}/wa_optouts/{sha256(E.164)}      (respondió BAJA, o sub.whatsapp_optout)
//
// NUNCA loguear tokens: los errores se guardan ya mapeados y pasados por scrub().
import crypto from "node:crypto";
import { db } from "./firebase.js";
import { sha256hex, timingSafeEqualStr } from "./token.js";
import {
  normalizePhoneAR, maskPhone, templateParams, WA_DEFAULT_LANG, WA_TEMPLATE_NAME_RE, WA_LANG_RE,
} from "../../shared/platform/whatsapp.js";

const GRAPH = "https://graph.facebook.com";
// v25.0 (vigente hasta 2028-07). WHATSAPP_GRAPH_VERSION permite subirla sin deploy de código.
const DEFAULT_VERSION = "v25.0";
export const graphVersion = () => {
  const v = String(process.env.WHATSAPP_GRAPH_VERSION || "").trim();
  return /^v\d{1,2}\.\d$/.test(v) ? v : DEFAULT_VERSION;
};

export const whatsappEnabled = (m) => Boolean(m && m.whatsapp_phone_number_id && m.whatsapp_access_token);

// Campos para GET /api/merchant (sin token ni app secret).
export function whatsappSafe(m) {
  const on = whatsappEnabled(m);
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
  };
}

// Borra cualquier cosa con forma de token de Meta (EAA…) o "access_token=…" de un texto.
export const scrub = (s) => String(s || "")
  .replace(/EAA[A-Za-z0-9]{10,}/g, "EAA•••")
  .replace(/(access_token=)[^&\s"]+/gi, "$1•••")
  .slice(0, 400);

// ── HTTP a la Graph API ────────────────────────────────────────────
async function graph(path, { token, method = "GET", body, timeoutMs = 8000 } = {}) {
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

export async function sendTemplate({ merchant, to, template, lang = WA_DEFAULT_LANG, components = [], timeoutMs = 8000 } = {}) {
  if (!whatsappEnabled(merchant)) return { ok: false, skipped: true, reason: "not_connected", error: "WhatsApp no está conectado" };
  const e164 = normalizePhoneAR(to);
  if (!e164) return { ok: false, skipped: true, reason: "no_phone", error: "El cliente no tiene un teléfono válido" };
  const name = String(template || "").trim();
  if (!WA_TEMPLATE_NAME_RE.test(name)) return { ok: false, code: "template", error: "Nombre de plantilla inválido" };
  const code = WA_LANG_RE.test(String(lang || "")) ? lang : WA_DEFAULT_LANG;
  const payload = buildTemplatePayload({ to: e164.slice(1), template: name, lang: code, components });
  const r = await graph(`${encodeURIComponent(merchant.whatsapp_phone_number_id)}/messages`, {
    token: merchant.whatsapp_access_token, method: "POST", body: payload, timeoutMs,
  });
  if (r.ok) {
    const m = r.data?.messages?.[0] || {};
    return { ok: true, id: m.id || null, message_status: m.message_status || null, wa_id: r.data?.contacts?.[0]?.wa_id || null, to: e164 };
  }
  const err = mapWaError(r.status, r.data);
  console.warn(`[whatsapp] envío ${name} → ${maskPhone(e164)}: ${err.code} ${err.detail || err.error}`);
  return { ...err, to: e164 };
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
const phoneKey = (e164) => sha256hex(String(e164 || "").replace(/\D/g, ""));

export async function isWhatsappOptedOut(mid, e164, sub) {
  if (sub?.whatsapp_optout === true || sub?.whatsapp_optin === false) return true;
  if (!mid || !e164) return false;
  try { return (await optoutsCol(mid).doc(phoneKey(e164)).get()).exists; }
  catch (_) { return false; }
}

export async function setWhatsappOptOut(mid, e164, { optout = true, reason = "respuesta" } = {}) {
  if (!mid || !e164) return false;
  const ref = optoutsCol(mid).doc(phoneKey(e164));
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
export async function recordWaError(mid, merchant, err) {
  if (!mid) return;
  try {
    const ref = db().collection("merchants").doc(mid);
    if (err && err.reconnect) await ref.set({ whatsapp_last_error: scrub(err.error), whatsapp_last_error_at: new Date().toISOString() }, { merge: true });
    else if (!err && merchant?.whatsapp_last_error) await ref.set({ whatsapp_last_error: null, whatsapp_last_error_at: null }, { merge: true });
  } catch (_) {}
}

// ── Paso de flujo ──────────────────────────────────────────────────
// Manda la plantilla del paso si: WhatsApp conectado + teléfono válido + sin baja.
// Nunca lanza. → { ok } | { skipped, reason } | { ok:false, error }
export async function runWhatsappFlowStep({ mid, merchant, sub, subscriberId, step, vars, flowId, flowName, stepNo }) {
  try {
    if (!whatsappEnabled(merchant)) return { ok: false, skipped: true, reason: "not_connected" };
    const phone = normalizePhoneAR(sub?.customer_phone || sub?.shipping_address?.phone);
    const base = {
      type: "flow", flow_id: flowId, flow_name: flowName, step: stepNo, subscriber_id: subscriberId,
      customer_name: sub?.customer_name, product_title: sub?.plan_snapshot?.product_title,
      template: step?.template, lang: step?.lang,
    };
    if (!phone) {
      await logWaMessage(mid, { ...base, status: "skipped", reason: "Sin teléfono" });
      return { ok: false, skipped: true, reason: "no_phone" };
    }
    if (await isWhatsappOptedOut(mid, phone, sub)) {
      await logWaMessage(mid, { ...base, to: phone, status: "skipped", reason: "Se dio de baja de WhatsApp" });
      return { ok: false, skipped: true, reason: "optout" };
    }
    const params = templateParams(step?.vars || {}, vars || {});
    const r = await sendTemplate({ merchant, to: phone, template: step.template, lang: step.lang, components: bodyComponents(params) });
    await logWaMessage(mid, {
      ...base, to: phone, status: r.ok ? "sent" : "error", error: r.ok ? null : r.error, error_code: r.ok ? null : r.code, provider_id: r.ok ? r.id : null,
    });
    await recordWaError(mid, merchant, r.ok ? null : r);
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
