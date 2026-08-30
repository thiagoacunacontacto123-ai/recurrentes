// Registro liviano de cada email transaccional enviado, para la tabla de
// actividad del dashboard. Best-effort: nunca tira (si falla, el mail igual salió).
//
// Doc: merchants/{uid}/email_log/{autoId}
//   type: "abandoned" | "activation" | "cancellation" | "payment_failed"
//   subscriber_id, to, customer_name, product_title, step (solo abandoned),
//   coupon, status ("sent"|"skipped"|"error"), error, created_at
import { db } from "./firebase.js";

export async function logEmail(merchantId, entry) {
  if (!merchantId) return;
  try {
    await db().collection("merchants").doc(merchantId).collection("email_log").add({
      type: entry.type || "other",
      subscriber_id: entry.subscriber_id || null,
      to: entry.to || null,
      customer_name: entry.customer_name || null,
      product_title: entry.product_title || null,
      step: entry.step || null,
      coupon: entry.coupon || null,
      status: entry.status || "sent",
      error: entry.error || null,
      created_at: new Date().toISOString(),
    });
  } catch (_) { /* no romper el flujo por el log */ }
}
