// Ramal ADMIN del número de Recurrentes: avisos internos a Thiago (el equipo).
//
//   notifyAdmin(event, { merchantId, store, detail, key })
//     event: "signup" (alguien dejó su número al registrarse) · "plan_paid" ·
//            "plan_cancelled" · "plan_grace" · "plan_last_call" · "plan_blocked".
//     · Destinatarios: env ADMIN_WHATSAPP (uno o varios, separados por coma) o,
//       si falta, el `owner_whatsapp` de las cuentas cuyo mail está en
//       ADMIN_EMAILS (lo carga en Configuración → Avisos para vos). Sin ninguno
//       de los dos → vuelve sin leer nada.
//     · Una sola plantilla genérica (`aviso_admin`: qué pasó · tienda · detalle · link).
//     · Dedup: system/admin_alerts/log/{event}:{mid}:{key} con create().
//     · Sin WhatsApp (o si falla) sale por mail a ADMIN_EMAILS / ADMIN_EMAIL.
//     · No suma uso a ningún comercio: el costo es de Recurrentes.
//     · NUNCA lanza: corre en el camino del registro, del webhook de Stripe y del
//       cobro. Un aviso que falla no puede romper nada de eso.
import { db } from "./firebase.js";
import { adminEmails } from "./adminAuth.js";
import { appBaseUrl } from "./config.js";
import { platformWaConfig, sendTemplate, bodyComponents, recordPlatformError, scrub } from "./whatsapp.js";
import { emailAdminAlert } from "./email.js";
import { normalizePhoneAR, maskPhone, alertParams, renderMerchantAlert, WA_ADMIN_TEMPLATE } from "../../shared/platform/whatsapp.js";

const nowIso = () => new Date().toISOString();
const arDay = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
const emailReady = () => Boolean(String(process.env.RESEND_API_KEY || "").trim());

// Qué dice cada evento en el mensaje (variable {{1}}).
export const ADMIN_EVENT_LABEL = {
  signup: "Nuevo registro con WhatsApp",
  plan_paid: "Pagó el plan",
  plan_cancelled: "Canceló el plan",
  plan_grace: "Entró en gracia (pasó los 10 sin pagar)",
  plan_last_call: "Al borde del bloqueo (14–15 sin pagar)",
  plan_blocked: "Bloqueada (16+ sin pagar)",
};
export const ADMIN_EVENTS = Object.keys(ADMIN_EVENT_LABEL);

export const adminLogId = (event, mid, key) => `${event}:${mid}:${key}`.replace(/[^A-Za-z0-9_:.@+-]/g, "_").slice(0, 300);

// Teléfonos del admin. Cache 10 min en memoria (la función serverless vive un rato).
let phoneCache = { at: 0, phones: null };
export async function adminPhones() {
  const fromEnv = String(process.env.ADMIN_WHATSAPP || "").split(",").map(v => normalizePhoneAR(v.trim())).filter(Boolean);
  if (fromEnv.length) return [...new Set(fromEnv)];
  const mails = adminEmails();
  if (!mails.length) return [];
  if (phoneCache.phones && Date.now() - phoneCache.at < 10 * 60 * 1000) return phoneCache.phones;
  const phones = [];
  try {
    const snap = await db().collection("merchants").where("email", "in", mails.slice(0, 30)).get();
    for (const d of snap.docs) { const p = normalizePhoneAR(d.data()?.owner_whatsapp); if (p) phones.push(p); }
  } catch (e) { console.warn("[admin-alerts] phones:", scrub(e?.message)); }
  phoneCache = { at: Date.now(), phones: [...new Set(phones)] };
  return phoneCache.phones;
}
export const _resetAdminPhoneCache = () => { phoneCache = { at: 0, phones: null }; };

export async function notifyAdmin(event, { merchantId, store, detail, key } = {}) {
  if (!ADMIN_EVENT_LABEL[event] || !merchantId) return null;
  const mails = adminEmails();
  const hasEnvPhone = !!String(process.env.ADMIN_WHATSAPP || "").trim();
  if (!mails.length && !hasEnvPhone) return null;               // nadie a quién avisar: cero lecturas
  if (!platformWaConfig() && !emailReady()) return null;        // nada con qué mandar
  try {
    const k = String(key ?? "").trim() || arDay();
    const ref = db().collection("system").doc("admin_alerts").collection("log").doc(adminLogId(event, merchantId, k));
    try {
      await ref.create({ event, merchant_id: String(merchantId), key: k, status: "sending", created_at: nowIso() });
    } catch (e) {
      if (e?.code === 6 || /already exists/i.test(e?.message || "")) return { ok: false, skipped: true, reason: "duplicate" };
      throw e;
    }
    const values = {
      evento: ADMIN_EVENT_LABEL[event],
      tienda: String(store || merchantId).slice(0, 80),
      detalle: String(detail || "-").slice(0, 300),
      link_panel: `${appBaseUrl().replace(/\/$/, "")}/#/dashboard/admin`,
    };
    const out = { ok: false, whatsapp: [], email: null };

    const wa = platformWaConfig();
    const phones = wa ? await adminPhones() : [];
    if (wa && phones.length) {
      const sender = { mode: "platform", phone_number_id: wa.phone_number_id, token: wa.token };
      for (const to of phones) {
        const r = await sendTemplate({ sender, to, template: WA_ADMIN_TEMPLATE.name, lang: WA_ADMIN_TEMPLATE.lang, components: bodyComponents(alertParams("admin", values)) });
        out.whatsapp.push(r.ok ? { ok: true, to: maskPhone(to), id: r.id || null } : { ok: false, to: maskPhone(to), error: scrub(r.error || "error"), code: r.code ?? null });
        if (!r.ok) await recordPlatformError(r);
      }
    }
    const waOk = out.whatsapp.some(w => w.ok);
    // Mail: respaldo si el WhatsApp no salió (sin número, sin teléfono del admin, plantilla sin aprobar…).
    if (!waOk && emailReady() && mails.length) {
      const r = await emailAdminAlert({ to: mails, event: values.evento, text: renderMerchantAlert("admin", values), storeName: values.tienda, panelUrl: values.link_panel });
      out.email = r?.ok ? { ok: true, to: mails } : { ok: false, error: String(r?.error || "mail").slice(0, 200) };
    }
    out.ok = waOk || out.email?.ok === true;
    await ref.set({ status: out.ok ? "sent" : "error", whatsapp: out.whatsapp, email: out.email, updated_at: nowIso() }, { merge: true }).catch(() => {});
    return out;
  } catch (e) {
    console.warn(`[admin-alerts] ${event} ${merchantId}:`, scrub(e?.message));
    return { ok: false, error: scrub(e?.message) };
  }
}
