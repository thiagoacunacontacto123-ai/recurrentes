// Avisos al COMERCIANTE (el dueño de la tienda), no al cliente final.
//
// Cuando un cliente de la tienda se suscribe, pausa, cancela o le rechazan el pago de una
// renovación, Recurrentes le avisa al dueño por WhatsApp desde el NÚMERO DE RECURRENTES
// (env WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_ACCESS_TOKEN; no hace falta que la tienda haya
// prendido los avisos a clientes) y, si no hay WhatsApp o falla, por mail (Resend).
//
//   notifyMerchantWhatsApp(event, mid, merchant, sid, sub, { key, amount })
//     event: "subscribed" | "paused" | "cancelled" | "payment_failed".
//     · merchant.alerts_whatsapp_enabled !== true, evento apagado, o nada con qué mandar
//       (sin WhatsApp de Recurrentes ni RESEND_API_KEY) → vuelve SIN leer ni escribir nada
//       (camino del cobro de Lumina intacto).
//     · Dedup: merchants/{mid}/alert_log/{event}:{sid}:{key} con create(). El mismo aviso que
//       llega por webhook + sync + cron sale una sola vez. key por defecto: "first" (alta) o
//       el día en hora de Argentina (pausa / baja).
//     · NUNCA lanza.
//   notifyMerchantStatusChange(mid, merchant, sid, prevStatus, nextStatus, sub)
//     Para los cambios de estado: solo avisa si PASA a pausada / cancelada desde un estado
//     que cobra (una alta que nunca pagó y se cancela no es una baja).
//
// Destinatario: alerts_whatsapp de la tienda > owner_whatsapp de la tienda > owner_whatsapp del
// login dueño (merchants/{ownerUid}, tiendas extra). Mail: contact_email de la tienda > del
// dueño > email de la tienda > del dueño.
// Uso: cada WhatsApp OK suma en merchants/{mid}/usage/{AAAA-MM} (precio × WHATSAPP_MARKUP, se
// cobra con el plan) con wa_alerts_sent aparte. Registro: message_log (type "merchant_alert").
//
// API (vía /api/merchant, sin funciones nuevas; solo el dueño):
//   POST ?action=alerts-save { enabled, whatsapp, events:{subscribed,paused,cancelled,payment_failed}, email }
//   POST ?action=alerts-test { whatsapp?, email? } → aviso de prueba (10 por día)
import { db } from "./firebase.js";
import {
  platformWaConfig, sendTemplate, bodyComponents, logWaMessage, recordWaUsage, recordPlatformError,
  messageLogId, scrub, waPriceUsd,
} from "./whatsapp.js";
import { emailMerchantAlert, effectiveBrand } from "./email.js";
import { rateLimit } from "./ratelimit.js";
import {
  normalizePhoneAR, maskPhone, ALERT_EVENT_IDS, ALERTS_PANEL_URL, WA_MERCHANT_TEMPLATE_BY_EVENT,
  alertEventsOf, alertFirstName, alertParams, renderMerchantAlert,
} from "../../shared/platform/whatsapp.js";
import { waChargeUsd } from "../../shared/platform/pricing.js";

const EMAIL_RE = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const nowIso = () => new Date().toISOString();
const arDay = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const emailReady = () => Boolean(String(process.env.RESEND_API_KEY || "").trim());
const validEmail = (e) => { const s = String(e || "").trim().toLowerCase(); return EMAIL_RE.test(s) ? s : ""; };
const fmtArs = (n) => { const v = Number(n); return Number.isFinite(v) && v > 0 ? `$${Math.round(v).toLocaleString("es-AR")}` : ""; };

// ¿Esta tienda quiere este aviso? Sin lecturas: solo mira el doc que ya tiene el caller.
export function alertsWanted(merchant, event) {
  return merchant?.alerts_whatsapp_enabled === true && ALERT_EVENT_IDS.includes(event) && alertEventsOf(merchant)[event] === true;
}

// Id del registro de dedup (ids de Firestore sin "/").
export const alertLogId = (event, sid, key) => `${event}:${sid}:${key}`.replace(/[^A-Za-z0-9_:.@+-]/g, "_").slice(0, 300);

// Cambio de estado → evento de aviso (o null).
export function statusChangeEvent(prev, next) {
  if (next === "cancelled" && ["active", "payment_failed", "paused"].includes(prev)) return "cancelled";
  if (next === "paused" && ["active", "payment_failed"].includes(prev)) return "paused";
  return null;
}

// Datos del aviso: marca, nombre de pila, producto, monto, link al panel.
export function alertValues(merchant, sub, extra = {}) {
  return {
    marca: effectiveBrand(merchant) || merchant?.shopify_shop || "",
    nombre: alertFirstName(sub?.customer_name),
    producto: sub?.plan_snapshot?.product_title || "",
    monto: fmtArs(extra?.amount ?? sub?.plan_snapshot?.total_per_charge_ars),
    link_panel: ALERTS_PANEL_URL,
  };
}

// A quién: { phone (E.164 | null), email ("" si no hay) }. Lee el login dueño solo si hace falta.
export async function alertRecipients(merchantId, merchant) {
  const m = merchant || {};
  let phone = normalizePhoneAR(m.alerts_whatsapp) || normalizePhoneAR(m.owner_whatsapp);
  let email = validEmail(m.contact_email);
  const ownerUid = m.ownerUid && String(m.ownerUid) !== String(merchantId) ? String(m.ownerUid) : null;
  let owner = null;
  if (ownerUid && (!phone || !email)) {
    try { owner = (await db().collection("merchants").doc(ownerUid).get()).data() || null; } catch (_) { owner = null; }
  }
  if (!phone && owner) phone = normalizePhoneAR(owner.owner_whatsapp);
  if (!email) email = validEmail(owner?.contact_email) || validEmail(m.email) || validEmail(owner?.email) || validEmail(m.shop_email);
  return { phone: phone || null, email: email || "" };
}

// Manda un aviso (WhatsApp y/o mail). Sin dedup: eso lo hace notifyMerchantWhatsApp.
async function deliver({ merchantId, merchant, event, subscriberId, values, test = false }) {
  const wa = platformWaConfig();
  const wantEmail = merchant?.alerts_email !== false;
  const rcpt = await alertRecipients(merchantId, merchant);
  const tpl = WA_MERCHANT_TEMPLATE_BY_EVENT[event];
  const out = { ok: false, whatsapp: null, email: null };

  if (wa && rcpt.phone && tpl) {
    const sender = { mode: "platform", phone_number_id: wa.phone_number_id, token: wa.token };
    const r = await sendTemplate({ sender, to: rcpt.phone, template: tpl.name, lang: tpl.lang, components: bodyComponents(alertParams(event, values)) });
    out.whatsapp = r.ok
      ? { ok: true, to: maskPhone(rcpt.phone), id: r.id || null }
      : { ok: false, to: maskPhone(rcpt.phone), error: scrub(r.error || "error"), code: r.code ?? null };
    await logWaMessage(merchantId, {
      type: test ? "merchant_alert_test" : "merchant_alert", sender: "platform", subscriber_id: subscriberId || null,
      to: rcpt.phone, customer_name: values.nombre || null, product_title: values.producto || null,
      template: tpl.name, lang: tpl.lang, status: r.ok ? "sent" : "error",
      error: r.ok ? null : r.error, error_code: r.ok ? null : (r.code ?? null), provider_id: r.ok ? (r.id || null) : null,
    });
    if (r.ok) {
      await recordWaUsage(merchantId, "platform", { type: "merchant_alert" });
      // Índice wamid → tienda: el webhook actualiza la entrega en message_log.
      if (r.id) await db().collection("wa_platform_msgs").doc(messageLogId(r.id)).set({ mid: merchantId, kind: "merchant_alert", created_at: nowIso() }).catch(() => {});
    } else {
      await recordPlatformError(r);
    }
  } else {
    out.whatsapp = { ok: false, skipped: true, reason: !wa ? "not_available" : "no_phone" };
  }

  const waOk = out.whatsapp.ok === true;
  // Mail: si la casilla "también por mail" está prendida, o de respaldo si el WhatsApp no salió.
  if ((wantEmail || !waOk) && emailReady() && rcpt.email) {
    const r = await emailMerchantAlert({
      to: rcpt.email, event, text: renderMerchantAlert(event, values), storeName: values.marca,
      customerName: values.nombre, panelUrl: ALERTS_PANEL_URL, test,
    });
    out.email = r?.ok ? { ok: true, to: rcpt.email } : { ok: false, to: rcpt.email, error: String(r?.error || "No se pudo enviar el mail").slice(0, 300) };
  } else {
    out.email = { ok: false, skipped: true, reason: !(wantEmail || !waOk) ? "off" : !emailReady() ? "not_configured" : "no_email" };
  }
  out.ok = waOk || out.email.ok === true;
  return out;
}

export async function notifyMerchantWhatsApp(event, merchantId, merchant, subscriberId, sub, extra = {}) {
  if (!alertsWanted(merchant, event) || !merchantId || !subscriberId) return null;
  if (!platformWaConfig() && !emailReady()) return null;
  try {
    const key = String(extra?.key ?? "").trim() || (event === "subscribed" ? "first" : arDay());
    const ref = db().collection("merchants").doc(merchantId).collection("alert_log").doc(alertLogId(event, subscriberId, key));
    try {
      await ref.create({ event, subscriber_id: String(subscriberId), key, status: "sending", created_at: nowIso() });
    } catch (e) {
      if (e?.code === 6 || /already exists/i.test(e?.message || "")) return { ok: false, skipped: true, reason: "duplicate" };
      throw e;
    }
    const values = alertValues(merchant, sub, extra);
    const out = await deliver({ merchantId, merchant, event, subscriberId: String(subscriberId), values });
    await ref.set({ status: out.ok ? "sent" : "error", whatsapp: out.whatsapp, email: out.email, customer_first_name: values.nombre || null, updated_at: nowIso() }, { merge: true }).catch(() => {});
    return out;
  } catch (e) {
    console.warn(`[alerts] ${event} ${merchantId}/${subscriberId}:`, scrub(e?.message));
    return { ok: false, error: scrub(e?.message) };
  }
}

export async function notifyMerchantStatusChange(merchantId, merchant, subscriberId, prevStatus, nextStatus, sub) {
  const event = statusChangeEvent(prevStatus, nextStatus);
  if (!event) return null;
  return notifyMerchantWhatsApp(event, merchantId, merchant, subscriberId, sub);
}

// ── Panel ──────────────────────────────────────────────────────────
// Campos para GET /api/merchant (ownerDoc = doc del login que mira el panel).
export function alertsSafe(merchant, ownerDoc = null) {
  const m = merchant || {};
  const o = ownerDoc || {};
  return {
    alerts_whatsapp_enabled: m.alerts_whatsapp_enabled === true,
    alerts_whatsapp: m.alerts_whatsapp || "",
    alerts_whatsapp_default: m.owner_whatsapp || o.owner_whatsapp || "",
    alerts_events: alertEventsOf(m),
    alerts_email: m.alerts_email !== false,
    alerts_email_to: [m.contact_email, o.contact_email, m.email, o.email].map(validEmail).find(Boolean) || "",
    alerts_whatsapp_available: Boolean(platformWaConfig()),
    alerts_email_available: emailReady(),
    alerts_charge_usd: waChargeUsd(waPriceUsd()),
  };
}

const sampleSub = { customer_name: "Ana Pérez", plan_snapshot: { product_title: "Producto de prueba", total_per_charge_ars: 9480 } };

export async function merchantAlertsApi(ctx, action, req, res) {
  if (ctx.role && ctx.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede configurar sus avisos." });
  const mid = ctx.merchantId;
  const ref = db().collection("merchants").doc(mid);
  const b = req.body || {};
  const phoneOf = (raw) => { const s = String(raw ?? "").trim(); return { raw: s, e164: s ? normalizePhoneAR(s) : null }; };
  const BAD_PHONE = "Revisá el WhatsApp: escribilo con código de área, por ejemplo 11 6411 7974.";
  try {
    if (action === "alerts-save") {
      const p = phoneOf(b.whatsapp);
      if (p.raw && !p.e164) return res.status(400).json({ error: BAD_PHONE });
      const ev = b.events && typeof b.events === "object" ? b.events : {};
      const upd = {
        alerts_whatsapp_enabled: b.enabled === true,
        alerts_whatsapp: p.e164,
        alerts_events: Object.fromEntries(ALERT_EVENT_IDS.map(id => [id, ev[id] !== false])),
        alerts_email: b.email !== false,
        alerts_updated_at: nowIso(),
        alerts_updated_by: ctx.uid || null,
      };
      await ref.set(upd, { merge: true });
      const merchant = (await ref.get()).data() || {};
      const rc = await alertRecipients(mid, merchant);
      return res.json({ ok: true, ...alertsSafe(merchant), recipient_phone: rc.phone ? maskPhone(rc.phone) : null, recipient_email: rc.email || null });
    }

    if (action === "alerts-test") {
      if (!platformWaConfig() && !emailReady()) return res.status(503).json({ error: "Los avisos todavía no están disponibles: faltan el WhatsApp y el mail de Recurrentes." });
      const p = phoneOf(b.whatsapp);
      if (p.raw && !p.e164) return res.status(400).json({ error: BAD_PHONE });
      const rl = await rateLimit(`alertstest:${mid}`, { limit: 10, windowSec: 86400 });
      if (!rl.ok) return res.status(429).json({ error: "Tope de 10 pruebas por día alcanzado." });
      const stored = (await ref.get()).data() || {};
      const merchant = { ...stored, ...(p.e164 ? { alerts_whatsapp: p.e164 } : {}), ...(typeof b.email === "boolean" ? { alerts_email: b.email } : {}) };
      const out = await deliver({ merchantId: mid, merchant, event: "subscribed", subscriberId: null, values: alertValues(merchant, sampleSub), test: true });
      if (!out.ok) {
        const why = out.whatsapp?.error || out.email?.error
          || (out.whatsapp?.reason === "no_phone" && !out.email?.to ? "No tenemos a qué WhatsApp ni a qué mail mandarte el aviso." : "No se pudo mandar la prueba.");
        return res.status(502).json({ error: why, whatsapp: out.whatsapp, email: out.email });
      }
      return res.json({ ok: true, whatsapp: out.whatsapp, email: out.email });
    }

    return res.status(400).json({ error: "action de avisos no reconocida" });
  } catch (e) {
    console.error(`[alerts-api] ${action} ${mid}:`, scrub(e?.message));
    return res.status(500).json({ error: "No se pudo guardar. Probá de nuevo en un rato." });
  }
}
