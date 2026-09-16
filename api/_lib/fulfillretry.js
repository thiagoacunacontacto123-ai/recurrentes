// Cobros APROBADOS cuya orden no se creó (Shopify caído, token revocado, variante
// borrada…): aviso al comerciante y, opcionalmente, reintento con backoff.
//
// Qué pasaba antes (investigado 2026-09-15):
//   · webhook.js / sync.js escriben charges/{payment_id} con shopify_order_id:null + error.
//     La sub queda active, sin orden nueva en shopify_orders ni last_charge_at nuevo.
//   · Reintento: solo si el cron vuelve a sincronizar ESA sub (primer cobro: cada 2 min
//     durante 72h, sin backoff; renovación: casi nunca, porque la sync que falló ya
//     movió next_charge_at al ciclo siguiente) o si el comerciante toca "Reintentar orden".
//   · Aviso: solo el cartel del Inicio. Ningún mail.
//
// Este módulo corre en el cron ?action=retry-fulfillment (cada 10 min):
//   1) charges con shopify_order_id == null de las últimas 72h (índice
//      shopify_order_id + created_at), aprobados y con error.
//   2) Estado propio en merchants/{mid}/fulfill_issues/{payment_id}: webhook/sync
//      reescriben el charge entero, este doc no lo toca nadie más.
//   3) AVISO (siempre activo): si a los 10 min de detectado sigue sin orden → 1 mail
//      al comerciante + 1 a PLATFORM_ALERT_EMAIL (si está). Una sola vez por cobro
//      (claim transaccional en el issue; hasta 3 intentos si Resend falla).
//   4) REINTENTO (solo con FULFILL_RETRY_ENABLED=1) por el MISMO camino idempotente
//      (claimCharge → fulfillCharge → charge.set), máx 5 intentos, backoff
//      10m / 30m / 2h / 6h / 12h. Barreras contra la orden duplicada:
//        a. calma: nadie escribió el charge en los últimos 10 min;
//        b. el pago sigue "approved" en MP (no reintenta reembolsos / contracargos);
//        c. busca en Shopify, entre las órdenes del cliente, una con note
//           mp_payment_id = el pago: si existe se ADOPTA (no se crea); si Shopify no
//           deja verificar, no se intenta;
//        d. claimCharge (transacción): si otro proceso la tiene o ya tiene orden → nada;
//        e. marca in_flight antes de crear: si un intento murió a mitad, ese cobro no
//           se reintenta más solo (queda "needs_review" + aviso);
//        f. shCreatePaidOrder vuelve a buscar la orden por mp_payment_id (48h).
//      Apagado por defecto: shopify.js reintenta el POST /orders.json ante timeout/5xx
//      (fetchRetry), un riesgo previo que este módulo no puede cerrar.
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { claimCharge } from "./chargeclaim.js";
import { fulfillCharge, notifyActivation, notifyRenewal } from "./sync.js";
import { mpGetPayment, isMpAuthError } from "./mp.js";
import { shFindOrderForPayment } from "./shopify.js";
import { emailOrderFailedAlert } from "./email.js";
import { appBaseUrl } from "./config.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { cronHeartbeat } from "./health.js";
import { log, logWarn, logError } from "./log.js";

const MIN = 60 * 1000;
const H = 60 * MIN;
export const WINDOW_MS = 72 * H;
export const ALERT_AFTER_MS = 10 * MIN;
export const QUIET_MS = 10 * MIN;
export const IN_FLIGHT_STALE_MS = 5 * MIN;
export const BACKOFF_MS = [10 * MIN, 30 * MIN, 2 * H, 6 * H, 12 * H];
export const MAX_ATTEMPTS = BACKOFF_MS.length;
export const MAX_ALERT_ATTEMPTS = 3;
const MAX_CHARGES_PER_MERCHANT = 50;
const NOT_RETRYABLE = /todavía no crea órdenes/i; // canal sin adapter: reintentar no sirve

export const retryEnabled = () => process.env.FULFILL_RETRY_ENABLED === "1";
const iso = (t) => new Date(t).toISOString();
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };
const isSim = (id, c) => c.simulated === true || String(c.mp_payment_id || "").startsWith("SIM-") || /-SIM$/.test(String(id));
const mpFeeReal = (p) => (p?.fee_details || []).filter(fd => fd.fee_payer !== "payer").reduce((s, fd) => s + (parseFloat(fd.amount) || 0), 0) || null;

// Charges aprobados, con error y sin orden, de la ventana. Sin el índice compuesto
// cae a la lectura por created_at (índice simple) y filtra en memoria.
export async function failedCharges(merchantRef, now = Date.now()) {
  const since = iso(now - WINDOW_MS);
  const col = merchantRef.collection("charges");
  let docs;
  try {
    docs = (await col.where("shopify_order_id", "==", null).where("created_at", ">=", since)
      .orderBy("created_at", "desc").limit(MAX_CHARGES_PER_MERCHANT).get()).docs;
  } catch (e) {
    if (!/FAILED_PRECONDITION|index/i.test(e.message || "")) throw e;
    logWarn("fulfill.query.fallback", { merchantId: merchantRef.id, reason: "sin índice shopify_order_id+created_at" });
    docs = (await col.where("created_at", ">=", since).orderBy("created_at", "desc").limit(500).get()).docs;
  }
  return docs.filter(d => {
    const c = d.data() || {};
    // Solo charges con clave = payment id (las legacy `{pre}-N` no pasan por claimCharge).
    return c.error && !c.shopify_order_id && c.status === "approved" && !isSim(d.id, c) && String(c.mp_payment_id) === d.id;
  });
}

async function getOrCreateIssue(issuesCol, pid, c, now) {
  const ref = issuesCol.doc(pid);
  const snap = await ref.get();
  if (snap.exists) return { ref, issue: snap.data() || {} };
  const issue = {
    mp_payment_id: pid,
    subscriber_id: c.subscriber_id || null,
    amount_ars: c.amount_ars ?? null,
    status: "open",
    attempts: 0,
    first_seen_at: iso(now),
    first_error: String(c.error || "").slice(0, 500),
    last_error: String(c.error || "").slice(0, 500),
    next_retry_at: iso(now + BACKOFF_MS[0]),
    created_at: iso(now),
    updated_at: iso(now),
  };
  try { await ref.create(issue); return { ref, issue }; }
  catch (_) { const again = await ref.get(); return { ref, issue: again.data() || issue }; }
}

// Intento que no llegó a crear nada (MP caído, Shopify sin verificar…): cuenta igual
// para que el reintento tenga techo.
async function bump(ref, issue, now, reason) {
  const attempts = (Number(issue.attempts) || 0) + 1;
  const upd = { attempts, last_attempt_at: iso(now), last_error: String(reason).slice(0, 500), updated_at: iso(now) };
  if (attempts >= MAX_ATTEMPTS) Object.assign(upd, { status: "gave_up", gave_up_at: iso(now) });
  else upd.next_retry_at = iso(now + BACKOFF_MS[attempts]);
  await ref.set(upd, { merge: true });
  return upd.status || "open";
}

/**
 * Reintenta crear la orden de UN charge fallido. Devuelve el resultado:
 *  fixed | adopted | disabled | closed | not_retryable | in_flight | needs_review | backoff |
 *  quiet | gave_up | sub_missing | mp_error | not_approved | unverified | already | claimed_elsewhere | failed
 */
export async function retryOne(mid, merchant, chargeDoc, issueRef, issue, { now = Date.now(), ctx = {} } = {}) {
  const c = chargeDoc.data() || {};
  const pid = chargeDoc.id;
  const base = { merchantId: mid, paymentId: pid, subscriberId: c.subscriber_id || null };
  if (!retryEnabled()) return "disabled";
  if (issue.status !== "open") return "closed";
  if (NOT_RETRYABLE.test(String(c.error || ""))) return "not_retryable";
  if (issue.in_flight_at) {
    if (now - ms(issue.in_flight_at) < IN_FLIGHT_STALE_MS) return "in_flight";
    // Un intento anterior se cortó entre "crear la orden" y "guardar el resultado":
    // puede existir la orden. Nunca reintentamos solos: queda para revisar.
    await issueRef.set({ status: "needs_review", review_reason: "Un reintento se cortó a mitad: revisá en Shopify si la orden existe antes de reintentar.", updated_at: iso(now) }, { merge: true });
    logWarn("fulfill.retry.needs_review", base);
    return "needs_review";
  }
  if ((Number(issue.attempts) || 0) >= MAX_ATTEMPTS) {
    await issueRef.set({ status: "gave_up", gave_up_at: iso(now), updated_at: iso(now) }, { merge: true });
    return "gave_up";
  }
  if (now < ms(issue.next_retry_at)) return "backoff";
  if (now - ms(c.created_at) < QUIET_MS) return "quiet"; // webhook/sync lo tocaron hace poco
  if (ctx.mpAuthBroken) return "mp_error";

  const merchantRef = db().collection("merchants").doc(mid);
  const sid = String(c.subscriber_id || "");
  const subRef = merchantRef.collection("subscribers").doc(sid || "_");
  const subSnap = sid ? await subRef.get() : { exists: false };
  if (!subSnap.exists) {
    await issueRef.set({ status: "gave_up", gave_up_at: iso(now), last_error: "La suscripción ya no existe", updated_at: iso(now) }, { merge: true });
    return "sub_missing";
  }
  const sub = subSnap.data() || {};

  // b. ¿El pago sigue aprobado en MP?
  let payment;
  try { payment = await mpGetPayment(merchant.mp_access_token, pid); }
  catch (e) {
    if (isMpAuthError(e)) ctx.mpAuthBroken = true;
    await bump(issueRef, issue, now, `Mercado Pago: ${e.message}`);
    logWarn("fulfill.retry.mp_error", { ...base, status: e.status || null });
    return "mp_error";
  }
  if (!payment?.id || payment.status !== "approved") {
    await issueRef.set({ status: "gave_up", gave_up_at: iso(now), last_error: `El pago ya no está aprobado en Mercado Pago (${payment?.status || "sin datos"})`, updated_at: iso(now) }, { merge: true });
    log("fulfill.retry.not_approved", { ...base, mpStatus: payment?.status || null });
    return "not_approved";
  }

  // c. ¿La orden ya existe en Shopify (timeout que sí la creó)?
  const { channel } = merchantProfile(merchant);
  let adopt = null;
  if (channel === "shopify" && merchant.shopify_token && merchant.shopify_shop) {
    const look = await shFindOrderForPayment(merchant.shopify_shop, merchant.shopify_token, sub.customer_email, pid);
    if (!look.verified) {
      await bump(issueRef, issue, now, `No se pudo verificar en Shopify si la orden ya existe (${look.reason || "sin detalle"})`);
      logWarn("fulfill.retry.unverified", base);
      return "unverified";
    }
    adopt = look.order || null;
  }

  // d. Claim atómico (mismo que webhook/sync).
  const claim = await claimCharge(merchantRef, pid, { subscriber_id: sid });
  if (!claim.proceed) {
    if (claim.existingOrderId) {
      await issueRef.set({ status: "resolved", resolved_at: iso(now), resolved_by: "sync", shopify_order_id: claim.existingOrderId, updated_at: iso(now) }, { merge: true });
      return "already";
    }
    return "claimed_elsewhere";
  }

  // e. Marca in_flight ANTES de crear la orden.
  const attempt = (Number(issue.attempts) || 0) + 1;
  await issueRef.set({ in_flight_at: iso(now), attempts: attempt, last_attempt_at: iso(now), updated_at: iso(now) }, { merge: true });

  const result = adopt
    ? { shopifyOrderId: adopt.id, orderStatusUrl: adopt.order_status_url || null, shopifyError: null }
    : await fulfillCharge(merchant, sid, sub, {
      payment_id: payment.id,
      total_price: payment.transaction_amount,
      charge_number: (sub.shopify_orders || []).length + 1,
      mp_fee_real: mpFeeReal(payment),
    }, "fulfill-retry");

  // Mismo formato que webhook/sync: set completo (libera el claim). created_at se conserva.
  await claim.chargeRef.set({
    subscriber_id: sid,
    mp_payment_id: String(payment.id),
    amount_ars: payment.transaction_amount,
    status: payment.status,
    shopify_order_id: result.shopifyOrderId || null,
    shopify_order_status_url: result.orderStatusUrl || null,
    error: result.shopifyError || null,
    created_at: c.created_at || iso(now),
    fulfill_retry_attempt: attempt,
    ...(adopt ? { fulfill_adopted: true } : {}),
  });

  const ok = !!result.shopifyOrderId && !result.shopifyError;
  const upd = { in_flight_at: FieldValue.delete(), updated_at: iso(now), last_error: ok ? null : String(result.shopifyError || "sin detalle").slice(0, 500) };
  if (ok) Object.assign(upd, { status: "resolved", resolved_at: iso(now), resolved_by: adopt ? "adopted" : "retry", shopify_order_id: String(result.shopifyOrderId) });
  else if (attempt >= MAX_ATTEMPTS) Object.assign(upd, { status: "gave_up", gave_up_at: iso(now) });
  else upd.next_retry_at = iso(now + BACKOFF_MS[attempt]);
  await issueRef.set(upd, { merge: true });

  if (!ok) {
    logWarn("fulfill.retry.failed", { ...base, attempt, error: result.shopifyError });
    return "failed";
  }
  // Igual que linkPaymentToSubscriber: orden → shopify_orders + last_charge_at, sin tocar status.
  const lastChargeAt = iso(Math.max(ms(sub.last_charge_at), ms(payment.date_approved) || now));
  await subRef.update({
    shopify_orders: FieldValue.arrayUnion(result.shopifyOrderId),
    last_charge_at: lastChargeAt,
    ...(sub.first_charge_at ? {} : { first_charge_at: lastChargeAt }),
    ...(result.orderStatusUrl ? { last_shopify_order_status_url: result.orderStatusUrl } : {}),
    updated_at: iso(now),
  }).catch(e => logError("fulfill.retry.sub_update", { ...base, error: e.message }));
  try {
    if (!sub.last_charge_at) await notifyActivation(mid, merchant, sid, sub, payment, "fulfill-retry", { shopifyOrderId: result.shopifyOrderId });
    else await notifyRenewal(mid, merchant, sid, sub, payment, "fulfill-retry", { shopifyOrderId: result.shopifyOrderId });
  } catch (e) { logWarn("fulfill.retry.notify", { ...base, error: e.message }); }
  log(adopt ? "fulfill.retry.adopted" : "fulfill.retry.ok", { ...base, attempt, orderId: result.shopifyOrderId });
  return adopt ? "adopted" : "fixed";
}

// Destino del aviso al comerciante: mail de alertas propio, el de la cuenta o el de Shopify.
export function merchantAlertTo(merchant) {
  if (merchant?.order_alerts_email === false) return null; // lo apagó
  const to = String(merchant?.alert_email || merchant?.email || merchant?.shop_email || "").trim();
  return /@/.test(to) ? to : null;
}

/** Aviso único por cobro. Devuelve { merchant:bool, platform:bool } (true = mandado ahora). */
export async function maybeAlert(mid, merchant, issueRef, issue, c, { now = Date.now(), sub = null } = {}) {
  const sent = { merchant: false, platform: false };
  if (issue.alert_done_at || issue.status === "resolved") return sent;
  if (now - ms(issue.first_seen_at) < ALERT_AFTER_MS) return sent;
  const claimed = await db().runTransaction(async (tx) => {
    const s = await tx.get(issueRef);
    const d = s.data() || {};
    if (d.alert_done_at || d.status === "resolved") return null;
    if (d.alert_claim_at && now - ms(d.alert_claim_at) < 5 * MIN) return null;
    tx.set(issueRef, { alert_claim_at: iso(now) }, { merge: true });
    return d;
  });
  if (!claimed) return sent;

  const panelUrl = `${appBaseUrl()}/#/dashboard/cobros?view=errors`;
  const retrying = retryEnabled() && claimed.status === "open" && !NOT_RETRYABLE.test(String(c.error || ""));
  const common = {
    merchant, merchantId: mid,
    customerName: sub?.customer_name || "",
    productTitle: sub?.plan_snapshot?.product_title || "",
    amount: c.amount_ars, paymentId: issueRef.id,
    error: c.error || claimed.last_error || "", panelUrl, retrying,
    needsReview: claimed.status === "needs_review",
  };
  const upd = { alert_claim_at: FieldValue.delete(), updated_at: iso(now) };
  let merchantDone = !!claimed.alert_merchant_at;
  if (!merchantDone) {
    const to = merchantAlertTo(merchant);
    if (!to) { merchantDone = true; upd.alert_merchant_status = "sin_destino"; upd.alert_merchant_at = iso(now); }
    else {
      const r = await emailOrderFailedAlert({ ...common, to });
      if (r?.ok || r?.skipped) { merchantDone = true; upd.alert_merchant_at = iso(now); upd.alert_merchant_status = r.ok ? "sent" : "skipped"; sent.merchant = !!r.ok; }
      else upd.alert_merchant_error = String(r?.error || "error").slice(0, 300);
    }
  }
  const platformTo = String(process.env.PLATFORM_ALERT_EMAIL || "").trim();
  let platformDone = !!claimed.alert_platform_at || !platformTo;
  if (!platformDone) {
    const r = await emailOrderFailedAlert({ ...common, to: platformTo, platform: true });
    if (r?.ok || r?.skipped) { platformDone = true; upd.alert_platform_at = iso(now); sent.platform = !!r.ok; }
  }
  const tries = (Number(claimed.alert_attempts) || 0) + 1;
  upd.alert_attempts = tries;
  if ((merchantDone && platformDone) || tries >= MAX_ALERT_ATTEMPTS) upd.alert_done_at = iso(now);
  await issueRef.set(upd, { merge: true });
  log("fulfill.alert", { merchantId: mid, paymentId: issueRef.id, merchantSent: sent.merchant, platformSent: sent.platform, attempt: tries });
  return sent;
}

/** Una tienda: detecta, cierra lo resuelto, reintenta (si está prendido) y avisa. */
export async function watchMerchant(mid, merchant, { now = Date.now(), deadline = Infinity } = {}) {
  const out = { failed_charges: 0, alerts: 0, platform_alerts: 0, retried: 0, fixed: 0, resolved: 0, needs_review: 0, gave_up: 0 };
  const merchantRef = db().collection("merchants").doc(mid);
  const issuesCol = merchantRef.collection("fulfill_issues");
  const failed = await failedCharges(merchantRef, now);
  out.failed_charges = failed.length;
  const failedIds = new Set(failed.map(d => d.id));

  // Issues abiertos cuyo charge ya no figura como fallido: lo arregló webhook/sync/panel.
  const openSnap = await issuesCol.where("status", "==", "open").limit(50).get();
  for (const d of openSnap.docs) {
    if (failedIds.has(d.id)) continue;
    const ch = await merchantRef.collection("charges").doc(d.id).get();
    const cd = ch.data() || {};
    if (cd.shopify_order_id) {
      await d.ref.set({ status: "resolved", resolved_at: iso(now), resolved_by: "sync", shopify_order_id: String(cd.shopify_order_id), in_flight_at: FieldValue.delete(), updated_at: iso(now) }, { merge: true });
      out.resolved++;
    } else if (!ch.exists || ms(cd.created_at) < now - WINDOW_MS) {
      await d.ref.set({ status: "expired", updated_at: iso(now) }, { merge: true });
    }
  }

  const ctx = {};
  for (const doc of failed) {
    if (Date.now() > deadline) break;
    const c = doc.data() || {};
    const { ref, issue } = await getOrCreateIssue(issuesCol, doc.id, c, now);
    let state = issue;
    if (state.status === "open" && retryEnabled()) {
      const r = await retryOne(mid, merchant, doc, ref, state, { now, ctx });
      if (!["disabled", "closed", "backoff", "quiet", "in_flight", "not_retryable"].includes(r)) out.retried++;
      if (r === "fixed" || r === "adopted") { out.fixed++; continue; }
      if (r === "needs_review") out.needs_review++;
      if (r === "gave_up") out.gave_up++;
      state = (await ref.get()).data() || state;
    }
    if (state.status === "resolved" || state.alert_done_at) continue;
    let sub = null;
    if (c.subscriber_id) {
      try { const s = await merchantRef.collection("subscribers").doc(String(c.subscriber_id)).get(); sub = s.exists ? s.data() : null; } catch (_) {}
    }
    const a = await maybeAlert(mid, merchant, ref, state, c, { now, sub });
    if (a.merchant) out.alerts++;
    if (a.platform) out.platform_alerts++;
  }
  return out;
}

// ─── Cron ?action=retry-fulfillment ─────────────────────────────────
export async function fulfillmentCron(res, { now, budgetMs = 150 * 1000 } = {}) {
  const start = Date.now();
  const deadline = start + budgetMs;
  const tot = { ok: true, retry_enabled: retryEnabled(), merchants: 0, failed_charges: 0, alerts: 0, platform_alerts: 0, retried: 0, fixed: 0, resolved: 0, needs_review: 0, gave_up: 0, errors: 0, partial: false };
  try {
    const snap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
    for (const m of snap.docs) {
      if (Date.now() > deadline) { tot.partial = true; break; }
      tot.merchants++;
      try {
        const r = await watchMerchant(m.id, m.data(), { now: now ?? Date.now(), deadline });
        for (const k of Object.keys(r)) tot[k] = (tot[k] || 0) + r[k];
      } catch (e) {
        tot.errors++;
        logError("fulfill.merchant.fail", { merchantId: m.id, error: e.message });
      }
    }
    tot.elapsed_ms = Date.now() - start;
    if (tot.failed_charges || tot.errors || tot.resolved) log("fulfill.cron", tot);
    await cronHeartbeat("retry-fulfillment", tot);
    return res.json(tot);
  } catch (e) {
    // Igual que el resto del cron: nunca 500 (el cron sigue vivo y reintenta).
    logError("fulfill.cron.fail", { error: e.message });
    const out = { ...tot, ok: false, error: e.message, elapsed_ms: Date.now() - start };
    await cronHeartbeat("retry-fulfillment", out);
    return res.status(200).json(out);
  }
}
