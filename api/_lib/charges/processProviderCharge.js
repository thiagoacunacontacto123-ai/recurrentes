// Procesa eventos NORMALIZADOS de pasarelas alternativas (Mobbex, Stripe, Whop).
//
// Cada adapter (api/_lib/providers/*.js) traduce su webhook a eventos:
//   { type: "charge_approved"|"charge_failed"|"subscription_cancelled"|"subscription_paused"|"subscription_resumed",
//     providerSubscriptionId, subscriberRef, paymentId, amount, currency, date, raw }
// y acá los aplicamos reusando las MISMAS piezas del camino de Mercado Pago:
//   · claimCharge (chargeclaim.js) → un solo proceso cumple cada cobro,
//   · fulfillCharge (sync.js)      → orden Shopify o comprobante interno rec_<id>,
//   · charges/{id}, last_charge_at, shopify_orders[], status del subscriber,
//   · notifyActivation / notifyRenewal / applyPaymentFailed (mails, Meta, Klaviyo, flujos),
//   · emitFlowEvent para cancelada / pausada / reactivada.
//
// El camino de Mercado Pago (mp/webhook.js, sync.js) NO pasa por acá.
//
// Id del cobro: "<pasarela>_<paymentId>" (ej. mobbex_abc123). Es el id del doc en
// charges/ y ocupa el campo mp_payment_id (nombre histórico) → la dedup de
// chargeclaim y la de shopify.js (note_attributes) funcionan igual y nunca chocan
// con un id numérico de Mercado Pago.
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../firebase.js";
import { claimCharge } from "../chargeclaim.js";
import { fulfillCharge, notifyActivation, notifyRenewal, applyPaymentFailed } from "../sync.js";
import { emitFlowEvent } from "../flows.js";

const nowIso = () => new Date().toISOString();
const DAY = 86400000;

export function providerChargeId(providerId, paymentId) {
  const safe = String(paymentId ?? "").replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 200);
  return `${String(providerId)}_${safe}`;
}

const isoOr = (d, fallback) => {
  const t = d ? Date.parse(d) : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
};

/**
 * Encuentra el subscriber del evento. Solo acepta subs creadas por ESA pasarela
 * (payment_provider === providerId): un evento de Mobbex nunca toca una sub de MP.
 *   1) subscriberRef "mid:sid" (o "sid") — el que mandamos como reference al crear.
 *   2) provider_subscription_id guardado en el sub.
 * @returns {Promise<{ref, data}|null>}
 */
export async function resolveProviderSubscriber(merchantId, providerId, ev) {
  const subs = db().collection("merchants").doc(merchantId).collection("subscribers");
  const ref0 = String(ev?.subscriberRef || "").trim();
  if (ref0) {
    let sid = ref0;
    if (ref0.includes(":")) {
      const [mid, s] = ref0.split(":");
      sid = mid === merchantId ? s : "";
    }
    if (sid && /^[A-Za-z0-9_-]{1,200}$/.test(sid)) {
      const snap = await subs.doc(sid).get();
      if (snap.exists && snap.data().payment_provider === providerId) return { ref: snap.ref, data: snap.data() };
    }
  }
  const psid = String(ev?.providerSubscriptionId || "").trim();
  if (psid) {
    const q = await subs.where("provider_subscription_id", "==", psid).limit(3).get();
    const hit = q.docs.find((d) => d.data().payment_provider === providerId);
    if (hit) return { ref: hit.ref, data: hit.data() };
  }
  return null;
}

/** Aplica UN evento normalizado. Nunca lanza por errores de negocio; devuelve { status, ... }. */
export async function processProviderEvent(merchantId, merchant, providerId, ev) {
  const tag = `provider-${providerId}`;
  const type = String(ev?.type || "");
  const found = await resolveProviderSubscriber(merchantId, providerId, ev);
  if (!found) {
    console.warn(`[${tag}] ${type}: sin subscriber (ref=${ev?.subscriberRef || "-"} psid=${ev?.providerSubscriptionId || "-"})`);
    return { status: "no_subscriber", type };
  }
  const { ref: subRef, data: sub } = found;
  const subscriberId = subRef.id;
  const date = isoOr(ev.date, nowIso());

  if (type === "charge_approved") return chargeApproved(merchantId, merchant, providerId, subRef, sub, ev, date, tag);

  if (type === "charge_failed") {
    if (ev.paymentId == null || ev.paymentId === "") return { status: "ignored", type, reason: "sin paymentId" };
    const payment = { id: providerChargeId(providerId, ev.paymentId), status: "rejected", date_created: date, transaction_amount: Number(ev.amount) || null, currency_id: ev.currency || null };
    const marked = await applyPaymentFailed(merchantId, merchant, subRef, sub, payment, tag);
    return { status: marked ? "payment_failed" : "ignored", type, subscriberId };
  }

  if (type === "subscription_cancelled") {
    if (sub.status === "cancelled") return { status: "noop", type, subscriberId };
    const upd = { status: "cancelled", provider_status: "cancelled", cancelled_at: nowIso(), cancelled_by: `provider:${providerId}`, resume_at: FieldValue.delete(), updated_at: nowIso() };
    await subRef.update(upd);
    await emitFlowEvent(merchantId, merchant, "cancelled", subscriberId, { ...sub, ...upd, resume_at: null }, { key: `${providerId}:cancel:${ev.providerSubscriptionId || subscriberId}` });
    return { status: "cancelled", type, subscriberId };
  }

  if (type === "subscription_paused") {
    if (sub.status === "paused" || sub.status === "cancelled") return { status: "noop", type, subscriberId };
    const upd = { status: "paused", provider_status: "paused", paused_at: nowIso(), updated_at: nowIso() };
    await subRef.update(upd);
    await emitFlowEvent(merchantId, merchant, "paused", subscriberId, { ...sub, ...upd }, { key: `${providerId}:pause:${date}` });
    return { status: "paused", type, subscriberId };
  }

  if (type === "subscription_resumed") {
    // Solo reactiva una pausada: un aviso tardío no revive una cancelada.
    if (sub.status !== "paused") return { status: "noop", type, subscriberId };
    const upd = { status: "active", provider_status: "active", resume_at: FieldValue.delete(), updated_at: nowIso() };
    await subRef.update(upd);
    await emitFlowEvent(merchantId, merchant, "resumed", subscriberId, { ...sub, ...upd, resume_at: null }, { key: `${providerId}:resume:${date}` });
    return { status: "active", type, subscriberId };
  }

  return { status: "ignored", type, subscriberId };
}

async function chargeApproved(merchantId, merchant, providerId, subRef, sub, ev, date, tag) {
  const subscriberId = subRef.id;
  if (ev.paymentId == null || ev.paymentId === "") return { status: "ignored", type: "charge_approved", reason: "sin paymentId" };
  const amount = Number(ev.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { status: "ignored", type: "charge_approved", reason: "monto inválido" };
  const currency = String(ev.currency || "ARS").toUpperCase();
  const chargeId = providerChargeId(providerId, ev.paymentId);
  const merchantRef = db().collection("merchants").doc(merchantId);

  // Claim ATÓMICO: si la pasarela reenvía el aviso (o llegan dos a la vez), un solo proceso cumple.
  const claim = await claimCharge(merchantRef, chargeId, { subscriber_id: subscriberId, provider: providerId });
  if (!claim.proceed) {
    console.log(`[${tag}] cobro ${chargeId} ${claim.existingOrderId ? "ya cumplido" : "lo está procesando otro"} — skip`);
    return { status: "duplicate", type: "charge_approved", subscriberId, orderId: claim.existingOrderId || null };
  }

  // Monto esperado (informativo: si pagó, se cumple igual; queda marcado para revisar).
  const expected = [sub.plan_snapshot?.total_per_charge_ars, sub.discount_first_charge_only ? sub.full_price_per_charge_ars : null]
    .filter((x) => x != null).map(Number);
  const amountMismatch = expected.length > 0 && !expected.some((a) => Math.abs(a - amount) < 1);
  if (amountMismatch) console.warn(`[${tag}] cobro ${chargeId} monto ${amount} ≠ esperado ${expected.join("/")} (sub=${subscriberId})`);

  const { shopifyOrderId, orderStatusUrl, shopifyError } = await fulfillCharge(merchant, subscriberId, sub, {
    payment_id: chargeId,
    total_price: amount,
    charge_number: (sub.shopify_orders || []).length + 1,
    mp_fee_real: null,
  }, tag);

  await claim.chargeRef.set({
    subscriber_id: subscriberId,
    mp_payment_id: chargeId,            // nombre histórico del campo (dedup cross-key de chargeclaim)
    provider: providerId,
    provider_payment_id: String(ev.paymentId),
    provider_subscription_id: ev.providerSubscriptionId ? String(ev.providerSubscriptionId) : null,
    amount_ars: currency === "ARS" ? amount : null,
    amount,
    currency,
    status: "approved",
    paid_at: date,
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    error: shopifyError,
    ...(amountMismatch ? { amount_mismatch: true, amount_expected: expected[0] } : {}),
    created_at: nowIso(),
  });

  const wasFirstCharge = !sub.last_charge_at;
  const upd = {
    // Un cobro tardío no revive una sub cancelada/pausada (igual que mp/webhook.js).
    status: (sub.status === "cancelled" || sub.status === "paused") ? sub.status : "active",
    provider_status: "active",
    updated_at: nowIso(),
  };
  if (ev.providerSubscriptionId && !sub.provider_subscription_id) upd.provider_subscription_id = String(ev.providerSubscriptionId);
  if (!shopifyError) {
    upd.last_charge_at = date;
    if (shopifyOrderId) upd.shopify_orders = FieldValue.arrayUnion(shopifyOrderId);
    if (orderStatusUrl) upd.last_shopify_order_status_url = orderStatusUrl;
    // Estimado: la pasarela cobra cada frequency_days desde este cobro.
    const freq = parseInt(sub.plan_snapshot?.frequency_days, 10);
    if (freq > 0) upd.next_charge_at = new Date(Date.parse(date) + freq * DAY).toISOString();
  }
  await subRef.update(upd);

  // Mismo "pago" que esperan los notify de sync.js (Meta usa transaction_amount/currency_id).
  const paymentLike = { id: chargeId, status: "approved", transaction_amount: amount, currency_id: currency, date_approved: date, date_created: date };
  if (!shopifyError) {
    if (wasFirstCharge) await notifyActivation(merchantId, merchant, subscriberId, sub, paymentLike, tag, { shopifyOrderId });
    else await notifyRenewal(merchantId, merchant, subscriberId, sub, paymentLike, tag, { shopifyOrderId });
  }
  console.log(`[${tag}] OK cobro ${chargeId} → ${shopifyOrderId || "ERROR " + shopifyError}`);
  return { status: shopifyError ? "fulfill_error" : "fulfilled", type: "charge_approved", subscriberId, chargeId, orderId: shopifyOrderId || null, error: shopifyError || null };
}

/**
 * Aplica una lista de eventos de UN merchant. Cada evento aislado (uno que falla
 * no frena al resto). Lanza solo si Firestore falla de forma inesperada y ningún
 * evento se pudo evaluar (para que la pasarela reintente).
 */
export async function processProviderEvents({ providerId, merchantId, merchant, events }) {
  const results = [];
  let thrown = null;
  for (const ev of Array.isArray(events) ? events : []) {
    try {
      results.push(await processProviderEvent(merchantId, merchant, providerId, ev));
    } catch (e) {
      console.error(`[provider-${providerId}] evento ${ev?.type} falló:`, e.message);
      thrown = thrown || e;
      results.push({ status: "error", type: ev?.type, error: e.message });
    }
  }
  if (thrown && results.every((r) => r.status === "error")) throw thrown;
  return results;
}
