// POST /api/mp/webhook  — endpoint PÚBLICO que recibe IPN/Webhook de MP.
// MP envía diferentes tipos: payment, preapproval, subscription_preapproval,
// authorized_payment. Para suscripciones, los importantes son:
//   - type=preapproval (estado del preapproval cambió: authorized / paused / cancelled)
//   - type=payment + topic=authorized_payment (un cobro recurrente se procesó)
//
// Para cada payment exitoso, generamos una orden Shopify del subscriber
// correspondiente (matching por external_reference o por preapproval_id).
//
// Doc: https://www.mercadopago.com.ar/developers/es/docs/your-integrations/notifications/webhooks
import crypto from "crypto";
import { db } from "../_lib/firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import { mpGetPayment, mpGetPreapproval, mpResolvePaymentLike, mpUpdatePreapproval, mpSearchPayments, isMpAuthError } from "../_lib/mp.js";
import { claimCharge } from "../_lib/chargeclaim.js";
import { timingSafeEqualStr } from "../_lib/token.js";
import { fetchWithTimeout } from "../_lib/http.js";
import {
  syncSubscriber, createShopifyOrderForSub, notifyActivation, applyPaymentFailed, repriceAfterFirstCharge,
} from "../_lib/sync.js";

// Vercel Pro: crear una orden puede llevar varias llamadas a Shopify + MP.
export const config = { maxDuration: 60 };

const nowIso = () => new Date().toISOString();
const PAYMENT_TYPES = new Set(["payment", "payment.created", "payment.updated", "subscription_authorized_payment"]);

let warnedNoSigningSecret = false;
// (32) Firma de MP: x-signature "ts=...,v1=..." + x-request-id + data.id.
// manifest = "id:{data.id};request-id:{x-request-id};ts:{ts};" (partes ausentes se omiten),
// HMAC-SHA256 hex con MP_WEBHOOK_SIGNING_SECRET. Sin secret configurado: no validamos (warn 1 vez).
function verifyMpSignature(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    if (!warnedNoSigningSecret) { console.warn("[mp-webhook] MP_WEBHOOK_SIGNING_SECRET no seteado: firma NO validada"); warnedNoSigningSecret = true; }
    return true;
  }
  const sig = String(req.headers["x-signature"] || "");
  const reqId = String(req.headers["x-request-id"] || "");
  const parts = {};
  for (const kv of sig.split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  if (!parts.ts || !parts.v1) return false;
  let manifest = "";
  if (dataId) manifest += `id:${/^[a-z0-9]+$/i.test(String(dataId)) ? String(dataId).toLowerCase() : String(dataId)};`;
  if (reqId) manifest += `request-id:${reqId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  return timingSafeEqualStr(expected, parts.v1);
}

// (32) MP manda `user_id` (cuenta del vendedor) en los webhooks a nivel cuenta →
// resolvemos el merchant directo por mp_user_id sin iterar todos.
async function resolveMerchantByUserId(userId) {
  if (userId == null || userId === "") return null;
  const tries = [];
  const n = Number(userId);
  if (Number.isFinite(n)) tries.push(n);
  tries.push(String(userId));
  for (const v of tries) {
    try {
      const q = await db().collection("merchants").where("mp_user_id", "==", v).limit(1).get();
      if (!q.empty) return q.docs[0];
    } catch (e) { console.warn("[mp-webhook] query mp_user_id falló:", e.message); }
  }
  return null;
}

// Lista de merchants con MP a probar: primero el hint (mid o user_id), después el resto.
async function merchantsToTry(hintMid) {
  const all = await db().collection("merchants").where("mp_access_token", "!=", "").get();
  const docs = all.docs.slice();
  if (!hintMid) return docs;
  const i = docs.findIndex(d => d.id === hintMid);
  if (i > 0) { const [h] = docs.splice(i, 1); docs.unshift(h); }
  else if (i < 0) {
    const s = await db().collection("merchants").doc(hintMid).get();
    if (s.exists && s.data().mp_access_token) docs.unshift(s);
  }
  return docs;
}

export default async function handler(req, res) {
  // MP a veces hace HEAD/GET de healthcheck — siempre 200.
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const body = req.body || {};
  const type = body.type || body.topic || req.query.type || req.query.topic || "";
  // data.id de la query es el que firma MP; fallback al body.
  const queryDataId = req.query["data.id"] || req.query.id || "";
  const id = queryDataId || body.data?.id || body.id || "";

  // (39) Log sin PII: solo ids/estado.
  console.log("[mp-webhook] received", JSON.stringify({
    type, id, action: body.action || null, user_id: body.user_id ?? null, live_mode: body.live_mode ?? null,
    hint: { mid: req.query.mid || null, sid: req.query.sid || null },
  }));

  if (!verifyMpSignature(req, queryDataId || id)) {
    console.warn(`[mp-webhook] firma inválida (type=${type} id=${id})`);
    return res.status(401).json({ error: "invalid signature" });
  }

  let hintMid = String(req.query.mid || "");
  const hintSid = String(req.query.sid || "");
  // Sin hint por query → resolver merchant por user_id de MP.
  if (!hintMid && body.user_id != null) {
    const m = await resolveMerchantByUserId(body.user_id).catch(() => null);
    if (m) hintMid = m.id;
  }

  // ATAJO: con hint mid + sid via query string del notification_url vamos
  // directo al sub local: syncSubscriber busca el preapproval/pagos y crea la
  // orden. Si no procesó nada y el evento es de pago, chequeamos el pago por id
  // por si es un rechazo que todavía no está indexado en la búsqueda.
  if (hintMid && hintSid && PAYMENT_TYPES.has(type)) {
    try {
      console.log(`[mp-webhook] atajo directo via ?mid=${hintMid}&sid=${hintSid}`);
      const result = await syncSubscriber(hintMid, hintSid);
      console.log(`[mp-webhook] sync directo result:`, JSON.stringify({
        status: result?.status, charges_processed: result?.charges_processed, payments_found: result?.payments_found,
        mp_preapproval_status: result?.mp_preapproval_status, error: result?.error || null,
      }));
      if (id && result && result.status !== "error" && !(result.charges_processed > 0) && result.status !== "payment_failed") {
        await checkRejectedPaymentForSub(hintMid, hintSid, id).catch(e => console.warn("[mp-webhook] check rechazo falló:", e.message));
      }
      return res.status(200).json({ ok: true, via: "direct_sync" });
    } catch (e) {
      console.error("[mp-webhook] atajo directo falló:", e.message);
      // Fallthrough al flow normal abajo.
    }
  }

  try {
    if (PAYMENT_TYPES.has(type)) {
      await handlePayment(id, hintMid);
    } else if (type === "preapproval" || type === "subscription_preapproval") {
      await handlePreapproval(id, hintMid);
    } else if (type === "chargebacks" || type === "chargeback") {
      // Contracargo: cliente disputa el cobro. Pausamos la sub para que MP no
      // cobre más mientras se resuelve.
      await handleDispute(id, "chargeback", hintMid);
    } else if (type === "claim" || type === "claims") {
      // Reclamo del cliente. Igual: pausar sub.
      await handleDispute(id, "claim", hintMid);
    } else if (type === "fraud_alert" || type === "fraud") {
      // MP detectó fraude. Cancelar sub.
      await handleDispute(id, "fraud", hintMid);
    } else {
      console.log("[mp-webhook] tipo no manejado:", type);
    }
  } catch (e) {
    console.error("[mp-webhook] error procesando:", e.message);
    // Igual ACK — si devolvemos error MP reintenta y duplicamos órdenes.
  }

  return res.status(200).json({ ok: true });
}

// (8) Atajo mid/sid: si el evento de pago es un rechazo, marcar payment_failed
// (sync ya lo cubre cuando el pago aparece en la búsqueda; esto cubre el delay de indexación).
async function checkRejectedPaymentForSub(merchantId, subscriberId, paymentId) {
  const mRef = db().collection("merchants").doc(merchantId);
  const mSnap = await mRef.get();
  if (!mSnap.exists || !mSnap.data().mp_access_token) return;
  const merchant = mSnap.data();
  const payment = await mpResolvePaymentLike(merchant.mp_access_token, paymentId);
  if (!payment?.id) return;
  if (payment.status !== "rejected" && payment.status !== "cancelled") return;
  const subRef = mRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;
  const marked = await applyPaymentFailed(merchantId, merchant, subRef, subSnap.data(), payment, "mp-webhook");
  if (marked) console.log(`[mp-webhook] payment ${payment.id} ${payment.status} → sub ${subscriberId} payment_failed`);
}

// ─── Handlers ────────────────────────────────────────────────

async function handlePayment(paymentId, hintMerchantId) {
  if (!paymentId) return;

  // ─── Resolución del merchant ─────────────────────────────────
  // 1. Hint (?mid=X del notification_url, o body.user_id → mp_user_id).
  // 2. Fallback iterando merchants y probando GET /v1/payments con cada
  //    access_token (lento, falla si MP devuelve 401/404 a todos).
  let resolved = null;
  const docs = await merchantsToTry(hintMerchantId);
  if (!hintMerchantId) console.log(`[mp-webhook] iterando ${docs.length} merchants para payment ${paymentId}`);
  for (const m of docs) {
    const merchant = m.data();
    if (!merchant.mp_access_token) continue;
    try {
      const payment = await mpResolvePaymentLike(merchant.mp_access_token, paymentId);
      if (payment?.id) { resolved = { merchantId: m.id, merchant, payment }; break; }
      if (m.id === hintMerchantId) console.warn(`[mp-webhook] hint mid=${hintMerchantId} no resolvió payment ${paymentId}`);
    } catch (e) {
      if (isMpAuthError(e)) {
        // Token del merchant vencido/revocado: marcar para que el dashboard avise.
        await m.ref.set({ mp_token_invalid_at: nowIso(), mp_token_error: e.message.slice(0, 300) }, { merge: true }).catch(() => {});
      }
      console.warn(`[mp-webhook] merchant ${m.id} GET payment ${paymentId} falló: ${e.message}`);
    }
  }

  if (!resolved) {
    console.warn(`[mp-webhook] no encontramos merchant para payment ${paymentId}`);
    return;
  }
  await processPaymentForMerchant(resolved.merchantId, resolved.merchant, resolved.payment);
}

// Resuelve el subscriber de un pago: external_reference → mp_preapproval_id → preapproval_plan_id.
async function resolveSubscriberForPayment(merchantId, merchant, payment) {
  const subs = db().collection("merchants").doc(merchantId).collection("subscribers");
  const extRef = payment.external_reference || "";
  if (extRef.includes(":")) {
    const [mid, sid] = extRef.split(":");
    if (mid === merchantId && sid) return sid;
  }
  const preapprovalId = payment.preapproval_id || payment.metadata?.preapproval_id
    || payment.point_of_interaction?.transaction_data?.subscription_id;
  if (!preapprovalId) return null;
  const q = await subs.where("mp_preapproval_id", "==", preapprovalId).limit(1).get();
  if (!q.empty) return q.docs[0].id;
  // Flujo de plan: en el primer webhook el sub AÚN no tiene grabado
  // mp_preapproval_id (MP recién creó el preapproval). Y MP no propaga el
  // external_reference. Resolvemos via el preapproval → su preapproval_plan_id,
  // que es único por sub (cada sub crea su plan ad-hoc).
  try {
    const pre = await mpGetPreapproval(merchant.mp_access_token, preapprovalId);
    if (pre?.preapproval_plan_id) {
      const q2 = await subs.where("mp_preapproval_plan_id", "==", pre.preapproval_plan_id).limit(1).get();
      if (!q2.empty) {
        // Persistimos el preapproval resuelto: sin esto la sub activada solo por
        // webhook de pago queda sin mp_preapproval_id/next_charge_at (cron y portal ciegos).
        await q2.docs[0].ref.set({
          mp_preapproval_id: pre.id,
          mp_preapproval_status: pre.status || null,
          next_charge_at: pre.next_payment_date || null,
        }, { merge: true }).catch(() => {});
        return q2.docs[0].id;
      }
    }
  } catch (e) {
    console.warn(`[mp-webhook] no pude resolver preapproval ${preapprovalId}: ${e.message}`);
  }
  return null;
}

async function processPaymentForMerchant(merchantId, merchant, payment) {
  const subscriberId = await resolveSubscriberForPayment(merchantId, merchant, payment);
  if (payment.status !== "approved") {
    // Payment rechazado o en proceso → marcar sub como payment_failed y
    // mandar email al cliente (solo si es un cobro recurrente; el primer
    // pago fallido lo deja como "pending" sin spam).
    if ((payment.status === "rejected" || payment.status === "cancelled") && subscriberId) {
      await markPaymentFailed(merchantId, merchant, payment, subscriberId);
    }
    console.log(`[mp-webhook] payment ${payment.id} status=${payment.status} — skip order creation`);
    return;
  }
  if (!subscriberId) {
    console.warn(`[mp-webhook] no encontramos subscriber para payment ${payment.id}`);
    return;
  }

  const merchantRef = db().collection("merchants").doc(merchantId);
  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;
  const sub = subSnap.data();

  // Idempotencia: solo saltamos si el cobro YA tiene su orden Shopify. Si el
  // cobro existe pero SIN orden (la creación falló antes), NO lo bloqueamos —
  // dejamos que este webhook (o un reintento de MP) vuelva a crear la orden.
  // Claim ATÓMICO (+ dedup cross-key legacy): solo UN proceso crea la orden.
  const claim = await claimCharge(merchantRef, payment.id, { subscriber_id: subscriberId });
  const chargeRef = claim.chargeRef;
  if (!claim.proceed) {
    console.log(`[mp-webhook] payment ${payment.id} ${claim.existingOrderId ? "ya tiene orden" : "lo está creando otro proceso"} — skip`);
    return;
  }

  // REGLA: si el cliente pagó, SIEMPRE creamos la orden Shopify. Aunque falte
  // dirección (tag FALTA-DIRECCION → el merchant la completa desde Recurrentes).
  const addrOk = !!(sub.shipping_address?.address1 && sub.shipping_address?.city);
  if (!addrOk) console.warn(`[mp-webhook] sub ${subscriberId} sin address1/city → orden Shopify se crea con tag FALTA-DIRECCION`);
  const { shopifyOrderId, orderStatusUrl, shopifyError } = await createShopifyOrderForSub(merchant, subscriberId, sub, {
    payment_id: payment.id,
    total_price: payment.transaction_amount,
    charge_number: (sub.shopify_orders || []).length + 1,
    // Comisión REAL que cobró MP (fee del vendedor, sin financing_fee del comprador).
    mp_fee_real: (payment.fee_details || []).filter(fd => fd.fee_payer !== "payer").reduce((s, fd) => s + (parseFloat(fd.amount) || 0), 0) || null,
  }, "mp-webhook");

  await chargeRef.set({
    subscriber_id: subscriberId,
    mp_payment_id: String(payment.id),
    amount_ars: payment.transaction_amount,
    status: payment.status,
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    error: shopifyError,
    created_at: nowIso(),
  });

  // Descuento solo primer cobro → repreciar el preapproval (no bloquea).
  const preIdForReprice = payment.preapproval_id || payment.metadata?.preapproval_id || sub.mp_preapproval_id || null;
  await repriceAfterFirstCharge(merchant.mp_access_token, subRef, sub, preIdForReprice, "mp-webhook");

  const wasFirstCharge = !sub.last_charge_at;
  const upd = {
    // No pisar cancelled/paused (un cobro tardío no "revive" una sub cancelada).
    status: (sub.status === "cancelled" || sub.status === "paused") ? sub.status : "active",
    updated_at: nowIso(),
  };
  const payPreId = payment.preapproval_id || payment.metadata?.preapproval_id || payment.point_of_interaction?.transaction_data?.subscription_id;
  if (payPreId && !sub.mp_preapproval_id) upd.mp_preapproval_id = payPreId;
  if (!shopifyError) {
    upd.last_charge_at = payment.date_approved || nowIso();
    if (shopifyOrderId) upd.shopify_orders = FieldValue.arrayUnion(shopifyOrderId);
    if (orderStatusUrl) upd.last_shopify_order_status_url = orderStatusUrl;
  }
  await subRef.update(upd);

  // Primera venta con orden: Meta CAPI Purchase + email de activación (una vez;
  // eventId estable → Meta deduplica entre webhook/sync/link).
  if (wasFirstCharge && !shopifyError) {
    await notifyActivation(merchantId, merchant, subscriberId, sub, payment, "mp-webhook");
  }

  console.log(`[mp-webhook] OK payment ${payment.id} → order ${shopifyOrderId || "ERROR"}`);
}

async function markPaymentFailed(merchantId, merchant, payment, subscriberId) {
  const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;
  // Dedup por payment id + solo recurrentes + no pisa cancelled/paused (en sync.js).
  const marked = await applyPaymentFailed(merchantId, merchant, subRef, subSnap.data(), payment, "mp-webhook");
  if (marked) console.log(`[mp-webhook] payment ${payment.id} ${payment.status} → sub ${subscriberId} payment_failed`);
}

async function handlePreapproval(preapprovalId, hintMid) {
  // Cuando el estado del preapproval cambia (authorized, paused, cancelled),
  // actualizamos el subscriber. La PRIMERA vez que llega este webhook puede
  // ser justo después de que MP creó el preapproval automáticamente (flow
  // checkout-del-plan): en ese caso el subscriber aún no tiene grabado
  // `mp_preapproval_id`; se resuelve por external_reference o por el plan ad-hoc.
  if (!preapprovalId) return;
  const docs = await merchantsToTry(hintMid);
  for (const m of docs) {
    const token = m.data().mp_access_token;
    if (!token) continue;
    let pre;
    try { pre = await mpGetPreapproval(token, preapprovalId); } catch (e) {
      if (isMpAuthError(e)) await m.ref.set({ mp_token_invalid_at: nowIso(), mp_token_error: e.message.slice(0, 300) }, { merge: true }).catch(() => {});
      continue;
    }
    if (!pre?.id) continue; // este merchant no es el dueño del preapproval

    const subs = db().collection("merchants").doc(m.id).collection("subscribers");
    // Resolver subscriber: 1) mp_preapproval_id, 2) external_reference,
    // 3) (5) preapproval_plan_id — el flujo de plan solo se resuelve por acá.
    let subDoc = null;
    const q1 = await subs.where("mp_preapproval_id", "==", preapprovalId).limit(1).get();
    if (!q1.empty) subDoc = q1.docs[0];

    if (!subDoc && pre.external_reference?.includes(":")) {
      const [mid, sid] = pre.external_reference.split(":");
      if (mid === m.id && sid) {
        const ref = subs.doc(sid);
        const snap = await ref.get();
        if (snap.exists) subDoc = { ref, data: () => snap.data() };
      }
    }
    if (!subDoc && pre.preapproval_plan_id) {
      const q3 = await subs.where("mp_preapproval_plan_id", "==", pre.preapproval_plan_id).limit(1).get();
      if (!q3.empty) subDoc = q3.docs[0];
    }

    if (!subDoc) {
      console.warn(`[mp-webhook] preapproval ${preapprovalId} sin subscriber (plan=${pre.preapproval_plan_id || "-"} extRef=${pre.external_reference || "-"})`);
      return;
    }

    const sd = subDoc.data();
    const map = { authorized: "active", paused: "paused", cancelled: "cancelled", pending: "pending" };
    let nuevoStatus = map[pre.status] || pre.status || "unknown";
    // Un preapproval authorized NO limpia un rechazo de renovación: eso lo hace un pago aprobado nuevo.
    if (pre.status === "authorized" && sd.status === "payment_failed") nuevoStatus = "payment_failed";
    const upd = {
      mp_preapproval_id: preapprovalId, // grabamos por si era el primer webhook
      mp_preapproval_status: pre.status || null,
      status: nuevoStatus,
      next_charge_at: pre.next_payment_date || null,
      updated_at: nowIso(),
    };
    // Trackear la cancelación: sella cuándo se canceló (para churn/reportes) la
    // primera vez que pasa a cancelled. Sale de la lista de activos solo.
    if (nuevoStatus === "cancelled" && sd.status !== "cancelled") {
      upd.cancelled_at = nowIso();
    }

    // ── FORZAR EL PRIMER COBRO server-side ─────────────────────────────────
    // En el flujo de plan, MP AUTORIZA el preapproval pero NO cobra el primer
    // pago de una (lo agenda a "ahora + frecuencia"). Adelantamos el start_date
    // para que MP cobre YA → webhook de pago → orden Shopify. (6) Mismas
    // condiciones que sync: CERO pagos de cualquier estado (búsqueda rápida por
    // preapproval_id), sin cobro ni orden previa, nunca intentado. La bandera se
    // graba aunque el PUT falle: jamás se fuerza dos veces.
    if (pre.status === "authorized" && !sd.last_charge_at && (sd.shopify_orders || []).length === 0 && !sd.sync_force_attempted) {
      let noPayments = false;
      try {
        const found = await mpSearchPayments(token, { preapproval_id: pre.id });
        noPayments = (found?.results || []).length === 0;
      } catch (e) {
        console.warn(`[mp-webhook] no pude verificar pagos de ${preapprovalId} antes de forzar: ${e.message}`);
      }
      if (noPayments) {
        upd.sync_force_attempted = true;
        upd.sync_force_at = nowIso();
        try {
          // Grabar la bandera ANTES del PUT (si la función muere en el medio, no se repite).
          await subDoc.ref.update({ sync_force_attempted: true, sync_force_at: upd.sync_force_at });
          const nowPlusOne = new Date(Date.now() + 60 * 1000).toISOString();
          await mpUpdatePreapproval(token, preapprovalId, {
            auto_recurring: { ...pre.auto_recurring, start_date: nowPlusOne },
          });
          console.log(`[mp-webhook] forzado primer cobro de ${preapprovalId} (start_date ${nowPlusOne})`);
        } catch (e) {
          console.warn(`[mp-webhook] no pude forzar primer cobro ${preapprovalId}: ${e.message}`);
          upd.sync_force_error = String(e.message || e).slice(0, 300);
        }
      }
    }

    await subDoc.ref.update(upd);
    console.log(`[mp-webhook] preapproval ${preapprovalId} → ${pre.status}`);
    // Self-heal oportunista acotado a 1 sub ACTIVA SIN ORDEN reciente (el cron
    // corre cada 2 min y hace el resto; el webhook tiene que responder rápido).
    await healRecentActiveNoOrder(m.id, 1).catch(() => {});
    return;
  }
}

// Sincroniza hasta `limit` suscripciones ACTIVAS SIN ORDEN de las últimas 6h de un
// merchant. Best-effort y acotado para no exceder el timeout del webhook.
async function healRecentActiveNoOrder(merchantId, limit = 1) {
  try {
    const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const snap = await db().collection("merchants").doc(merchantId).collection("subscribers")
      .where("status", "==", "active").get();
    let done = 0;
    for (const doc of snap.docs) {
      if (done >= limit) break;
      const d = doc.data();
      if ((d.shopify_orders || []).length > 0) continue;    // ya tiene orden
      if (!d.created_at || d.created_at < cutoff) continue;  // solo recientes
      try { await syncSubscriber(merchantId, doc.id); done++; } catch (_) {}
    }
  } catch (_) {}
}

// Reclamo / contracargo / fraude → pausamos o cancelamos la sub para parar
// los cobros recurrentes. El ID que MP nos manda puede ser de un payment o
// de un claim — intentamos resolver buscando el payment relacionado.
//
// Política:
//   - kind="claim" o "chargeback" → status="payment_failed" (pausa pero
//     queda recuperable si el reclamo se resuelve a favor del merchant)
//   - kind="fraud" → status="cancelled" (cero tolerancia)
async function handleDispute(disputeId, kind, hintMid) {
  if (!disputeId) return;
  const docs = await merchantsToTry(hintMid);

  for (const m of docs) {
    const token = m.data().mp_access_token;
    if (!token) continue;

    // Intentamos resolver el payment via /v1/payments/{id}. Si el ID es de
    // un payment, devuelve OK. Si es de un claim/chargeback, MP devuelve la
    // info con payment_id adentro.
    let paymentId = disputeId;
    try {
      const direct = await mpGetPayment(token, disputeId);
      if (direct?.id) paymentId = direct.id;
    } catch (e) {
      if (isMpAuthError(e)) continue;
      // Es ID de claim — buscamos en endpoint de claims
      try {
        const r = await fetchWithTimeout(`https://api.mercadopago.com/v1/claims/${disputeId}`, {
          headers: { Authorization: `Bearer ${token}` },
        }, 10000);
        const d = await r.json().catch(() => ({}));
        if (r.ok && d?.resource_id) paymentId = d.resource_id;
        else continue;
      } catch (_) { continue; }
    }

    // Con el paymentId resolvemos el subscriber (via external_reference o
    // mp_preapproval_id, igual que en handlePayment).
    let payment;
    try { payment = await mpGetPayment(token, paymentId); } catch (_) { continue; }
    if (!payment?.id) continue;

    const merchantId = m.id;
    let subscriberId = null;
    const extRef = payment.external_reference || "";
    if (extRef.includes(":")) {
      const [mid, sid] = extRef.split(":");
      if (mid === merchantId) subscriberId = sid;
    }
    if (!subscriberId && payment.preapproval_id) {
      const q = await db().collection("merchants").doc(merchantId).collection("subscribers")
        .where("mp_preapproval_id", "==", payment.preapproval_id).limit(1).get();
      if (!q.empty) subscriberId = q.docs[0].id;
    }
    if (!subscriberId) continue;

    const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
    const newStatus = kind === "fraud" ? "cancelled" : "payment_failed";
    const update = {
      status: newStatus,
      dispute_kind: kind,
      dispute_id: disputeId,
      dispute_at: nowIso(),
      updated_at: nowIso(),
    };

    // Si es fraude o contracargo, además cancelamos en MP para que NO siga cobrando.
    if (kind === "fraud" || kind === "chargeback") {
      const subSnap = await subRef.get();
      const sub = subSnap.data();
      if (sub?.mp_preapproval_id) {
        try {
          await mpUpdatePreapproval(token, sub.mp_preapproval_id, { status: "cancelled" });
          update.cancelled_at = nowIso();
          update.cancelled_by = `auto:${kind}`;
        } catch (e) {
          console.warn(`[mp-webhook] no pude cancelar preapproval ${sub.mp_preapproval_id}: ${e.message}`);
        }
      }
    }

    await subRef.update(update);
    console.log(`[mp-webhook] dispute ${kind} ${disputeId} → sub ${subscriberId} marcado ${newStatus}`);
    return;
  }
}
