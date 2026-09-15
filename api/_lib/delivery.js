// Entrega digital: manda por mail el link que el comerciante cargó en el plan
// (plan.digital_delivery, ver shared/platform/delivery.js) cuando se activa la
// suscripción y, si el plan lo pide, en cada renovación.
//
// Lo llaman notifyActivation / notifyRenewal de _lib/sync.js (cubre webhook, sync y link).
//
// Garantías:
//   · NO-OP sin ninguna lectura para negocios con envío (físicos, como Lumina):
//     el camino del cobro no cambia.
//   · Planes sin digital_delivery activa, o sin el evento en send_on → no hace nada.
//   · Una sola vez por pago: claim atómico en merchants/{mid}/deliveries/{key}
//     (create() falla si ya existe) → webhook + polling + link no duplican el mail.
//   · Nunca lanza: cualquier error se loguea y devuelve { error }.
//   · Queda en email_log con type "delivery" (tabla de actividad del panel).
import { db } from "./firebase.js";
import { emailDigitalDelivery } from "./email.js";
import { logEmail } from "./emaillog.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { normalizeDigitalDelivery, shouldDeliver, deliveryApplies } from "../../shared/platform/delivery.js";

const nowIso = () => new Date().toISOString();
const safeId = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);

// Clave de dedupe: por pago (único en MP). Sin id de pago solo se acepta la
// activación (una por suscripción); una renovación sin pago no se puede deduplicar.
export function deliveryKey(subscriberId, payment, event) {
  if (payment?.id != null && payment.id !== "") return `pay_${safeId(payment.id)}`;
  if (event === "activation") return `sub_${safeId(subscriberId)}_activation`;
  return null;
}

// Plan vivo (así un link corregido después aplica a las próximas entregas);
// si el plan ya no existe, lo que haya quedado en el snapshot de la suscripción.
async function loadDelivery(merchantId, sub) {
  let dd = null;
  if (sub?.plan_id) {
    const snap = await db().collection("merchants").doc(merchantId).collection("plans").doc(String(sub.plan_id)).get();
    if (snap.exists) dd = snap.data()?.digital_delivery ?? null;
  }
  if (dd == null) dd = sub?.plan_snapshot?.digital_delivery ?? null;
  return normalizeDigitalDelivery(dd).value;
}

/**
 * Manda la entrega digital de un cobro. event: "activation" | "renewal".
 * @returns {Promise<{status?:string, skipped?:string, error?:string}>}
 */
export async function sendDigitalDelivery(merchantId, merchant, subscriberId, sub, payment, event, { tag = "sync", portalUrl = null } = {}) {
  try {
    // Físicos (Lumina y cualquiera con envío): fuera, sin leer nada.
    if (!deliveryApplies(merchantProfile(merchant))) return { skipped: "shipping" };
    if (event !== "activation" && event !== "renewal") return { skipped: "event" };
    if (!merchantId || !subscriberId || !sub?.customer_email) return { skipped: "no_email" };

    const dd = await loadDelivery(merchantId, sub);
    if (!shouldDeliver(dd, event)) return { skipped: "not_configured" };

    const key = deliveryKey(subscriberId, payment, event);
    if (!key) return { skipped: "no_payment_id" };
    const ref = db().collection("merchants").doc(merchantId).collection("deliveries").doc(key);
    try {
      await ref.create({
        subscriber_id: subscriberId, plan_id: sub.plan_id || null, event,
        payment_id: payment?.id != null ? String(payment.id) : null,
        url: dd.url, status: "sending", created_at: nowIso(),
      });
    } catch (e) {
      if (e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message || ""))) return { skipped: "duplicate" };
      throw e;
    }

    const er = await emailDigitalDelivery({
      to: sub.customer_email,
      customerName: sub.customer_name,
      productTitle: sub.plan_snapshot?.product_title || "tu suscripción",
      url: dd.url,
      message: dd.message,
      event,
      portalUrl,
      merchant,
    });
    const status = er?.skipped ? "skipped" : er?.error ? "error" : "sent";
    await ref.set({ status, error: er?.error || null, provider_id: er?.id || null, sent_at: nowIso() }, { merge: true }).catch(() => {});
    if (!er?.skipped) {
      await logEmail(merchantId, {
        type: "delivery", subscriber_id: subscriberId, to: sub.customer_email,
        customer_name: sub.customer_name, product_title: sub.plan_snapshot?.product_title,
        status, error: er?.error || null, provider_id: er?.id || null,
      });
    }
    console.log(`[${tag}] entrega digital (${event}) sub=${subscriberId} key=${key}: ${status}`);
    return { status };
  } catch (e) {
    console.warn(`[${tag}] entrega digital falló sub=${subscriberId}:`, e?.message || e);
    return { error: String(e?.message || e) };
  }
}
