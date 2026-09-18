// Cobro del uso de WhatsApp (número de Recurrentes) — Thiago, 18-sept-2026.
//
// El uso se registra en merchants/{mid}/usage/{AAAA-MM} (wa_cost_usd = precio de Meta × recargo,
// ver recordWaUsage). Acá se convierte en plata:
//   · Con plan pago (saas_stripe_customer_id): cada mes CERRADO se agrega como ítem de la
//     próxima factura del plan en Stripe (POST /v1/invoiceitems). Cron diario `bill-wa-usage`.
//     Al activar el plan se facturan los meses pendientes; al darse de baja se factura TODO
//     (mes en curso incluido) y se emite la factura en el momento.
//   · Sin plan pago: el uso se acumula en merchant.wa_unbilled_usd; al llegar a WA_FREE_CAP_USD
//     se pone wa_paused_for_billing y el número deja de mandar por esa tienda (waSender → null,
//     avisos al comercio → solo mail) hasta que active un plan. Aviso por mail una sola vez.
// El recargo NUNCA se muestra al comercio (solo el precio final).
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { emailMerchantAlert } from "./email.js";
import { waUsageMonth, BILLING_PANEL_URL } from "../../shared/platform/whatsapp.js";

export const WA_FREE_CAP_USD = 5;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const cents = (usd) => Math.round((Number(usd) || 0) * 100);
export function waMonthLabel(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ""));
  if (!m) return String(ym || "");
  const names = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  return `${names[Number(m[2]) - 1] || m[2]} ${m[1]}`;
}

// Meses con uso pendiente de facturar. includeCurrent → también el mes en curso.
export async function unbilledWaMonths(mid, { includeCurrent = false, now = new Date() } = {}) {
  const cur = waUsageMonth(now);
  const snap = await db().collection("merchants").doc(mid).collection("usage").get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(u => /^\d{4}-\d{2}$/.test(u.id) && !u.billed_at && cents(u.wa_cost_usd) >= 1 && (includeCurrent || u.id < cur))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function unbilledWaTotal(mid, now = new Date()) {
  const all = await unbilledWaMonths(mid, { includeCurrent: true, now });
  return round2(all.reduce((t, u) => t + (Number(u.wa_cost_usd) || 0), 0));
}

// Un ítem de factura por mes pendiente. Devuelve { billed, total_usd }.
export async function billWaUsage(mid, merchant, stripeCall, { includeCurrent = false, finalizeNow = false, now = new Date() } = {}) {
  const customer = merchant?.saas_stripe_customer_id;
  if (!customer) return { billed: 0, total_usd: 0, skipped: "no_customer" };
  const ref = db().collection("merchants").doc(mid);
  const months = await unbilledWaMonths(mid, { includeCurrent, now });
  let billed = 0, total = 0;
  for (const u of months) {
    const uref = ref.collection("usage").doc(u.id);
    // Reclamo del mes: otra corrida en la última hora ya lo está facturando → no duplicar.
    const claim = Date.parse(u.billing_at || "") || 0;
    if (claim && now.getTime() - claim < 3600e3) continue;
    await uref.set({ billing_at: now.toISOString() }, { merge: true });
    const amount = cents(u.wa_cost_usd);
    const sent = Number(u.wa_sent) || 0;
    const item = await stripeCall("POST", "/v1/invoiceitems", {
      customer, currency: "usd", amount,
      description: `WhatsApp · ${waMonthLabel(u.id)} · ${sent} mensaje${sent === 1 ? "" : "s"}`,
      "metadata[merchant_id]": mid, "metadata[month]": u.id, "metadata[kind]": "whatsapp_usage",
    });
    await uref.set({ billed_at: now.toISOString(), billed_usd: amount / 100, stripe_invoice_item_id: item?.id || null, billing_at: FieldValue.delete() }, { merge: true });
    billed++; total += amount / 100;
  }
  const remaining = await unbilledWaTotal(mid, now);
  await ref.set({ wa_unbilled_usd: remaining, ...(billed ? { wa_last_billed_at: now.toISOString() } : {}), wa_paused_for_billing: FieldValue.delete(), wa_paused_at: FieldValue.delete() }, { merge: true });
  if (finalizeNow && billed) {
    // Baja del plan: no va a haber próxima factura → se emite una ahora con lo pendiente.
    try { await stripeCall("POST", "/v1/invoices", { customer, auto_advance: "true", collection_method: "charge_automatically", "metadata[kind]": "whatsapp_usage_final" }); }
    catch (e) { console.warn(`[waBilling] factura final ${mid}:`, e.message); }
  }
  return { billed, total_usd: round2(total) };
}

// Plan gratis: al pasar el tope se pausa WhatsApp y se avisa por mail (una vez). Nunca lanza.
export async function checkWaFreeCap(mid, merchant, unbilledUsd) {
  try {
    if (!mid || !merchant || merchant.saas_stripe_customer_id || merchant.wa_paused_for_billing === true) return false;
    if ((Number(unbilledUsd) || 0) < WA_FREE_CAP_USD) return false;
    const now = new Date().toISOString();
    await db().collection("merchants").doc(mid).set({ wa_paused_for_billing: true, wa_paused_at: now }, { merge: true });
    const to = merchant.contact_email || merchant.email || "";
    if (to) {
      await emailMerchantAlert({
        to, event: "wa_paused", storeName: merchant.store_name || merchant.email_brand_effective || "",
        text: `Tus mensajes de WhatsApp llegaron al tope de US$ ${WA_FREE_CAP_USD} del plan gratis, así que los pausamos.\n\nPara que vuelvan a salir, activá un plan de Recurrentes: el uso de WhatsApp se cobra junto con el plan, a fin de mes, y solo pagás los mensajes que se mandan.\n\nMientras tanto, los avisos a tus clientes y a vos siguen saliendo por mail.`,
        panelUrl: BILLING_PANEL_URL,
      }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.warn(`[waBilling] tope gratis ${mid}:`, e.message);
    return false;
  }
}

// Cron diario: factura los meses cerrados de todas las tiendas con plan pago y uso pendiente.
export async function billAllWaUsage(stripeCall, { now = new Date() } = {}) {
  const snap = await db().collection("merchants").where("wa_unbilled_usd", ">", 0).get();
  const out = { merchants: 0, billed: 0, total_usd: 0, errors: 0 };
  for (const d of snap.docs) {
    const m = d.data() || {};
    if (!m.saas_stripe_customer_id) continue;
    out.merchants++;
    try { const r = await billWaUsage(d.id, m, stripeCall, { now }); out.billed += r.billed; out.total_usd = round2(out.total_usd + r.total_usd); }
    catch (e) { out.errors++; console.warn(`[waBilling] ${d.id}:`, e.message); }
  }
  return out;
}
