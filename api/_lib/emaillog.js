// Registro liviano de cada email transaccional enviado, para la tabla de
// actividad del dashboard. Best-effort: nunca tira (si falla, el mail igual salió).
//
// Doc: merchants/{uid}/email_log/{autoId}
//   type: "abandoned" | "activation" | "cancellation" | "payment_failed"
//   subscriber_id, to, customer_name, product_title, step (solo abandoned),
//   coupon, status ("sent"|"skipped"|"error"), error (detalle, string),
//   provider_id (id que devuelve Resend), created_at
import { db } from "./firebase.js";

// Error a string corto (Resend devuelve objetos; no guardamos blobs enormes).
function errStr(e) {
  if (!e) return null;
  const s = typeof e === "string" ? e : (e.message || (() => { try { return JSON.stringify(e); } catch (_) { return String(e); } })());
  return String(s).slice(0, 500);
}

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
      error: errStr(entry.error),
      provider_id: entry.provider_id || null,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[emaillog] no se pudo loguear ${entry?.type || "?"} → ${entry?.to || "?"}:`, e.message);
  }
}

// Stats rápidas para el dashboard: { total, by_status: {sent,error,skipped},
// by_type: { abandoned: {sent,error,skipped}, ... } }. Acepta docs o data().
export function summarizeEmailLog(entries) {
  const out = { total: 0, by_status: { sent: 0, error: 0, skipped: 0 }, by_type: {} };
  for (const raw of entries || []) {
    const e = raw && typeof raw.data === "function" ? raw.data() : raw;
    if (!e) continue;
    const type = e.type || "other";
    const status = ["sent", "error", "skipped"].includes(e.status) ? e.status : "sent";
    out.total++;
    out.by_status[status]++;
    if (!out.by_type[type]) out.by_type[type] = { sent: 0, error: 0, skipped: 0 };
    out.by_type[type][status]++;
  }
  return out;
}
