// Sincronización manual de un subscriber con MP.
//
// Por qué existe: el flow `preapproval_plan` (estilo GreenDog) hace que MP
// cree el preapproval automáticamente cuando el cliente confirma — no
// nosotros. Como NO creamos el preapproval explícitamente, no podemos
// inyectarle `notification_url`. MP solo envía webhook si está configurado
// a nivel CUENTA del merchant (lo cual requiere setup manual).
//
// Para no depender de esa config manual, este helper busca proactivamente
// el preapproval en MP por `external_reference` cada vez que el frontend
// (CheckoutSuccess.jsx) hace polling, y procesa todo localmente como si
// hubiera llegado un webhook.
//
// También lo puede usar el webhook handler como fallback si llega un evento
// sin contexto suficiente.
import { db } from "./firebase.js";
import { FieldValue } from "firebase-admin/firestore";
import {
  mpGetPayment, mpGetPreapproval, mpUpdatePreapproval,
  mpSearchPreapprovalsByPlan, mpSearchPreapprovals, mpSearchPayments, mpSearchAuthorizedPayments,
  isMpAuthError,
} from "./mp.js";
import { shFindOrCreateCustomer, shCreatePaidOrder } from "./shopify.js";
import { emailSubscriptionActivated, emailPaymentFailed } from "./email.js";
import { sendMetaPurchase } from "./meta.js";
import { logEmail } from "./emaillog.js";
import { claimCharge } from "./chargeclaim.js";
import { appBaseUrl } from "./config.js";
import { klaviyoEnabled, klaviyoLifecycle, klaviyoPlacedOrder, KLAVIYO_METRICS } from "./klaviyo.js";
import { merchantProfile, internalFulfillmentId } from "../../shared/platform/profile.js";
import { emitFlowEvent } from "./flows.js";
import { sendDigitalDelivery } from "./delivery.js";

/**
 * Cumple un cobro según el canal del merchant (shared/platform/profile.js).
 * Mismo contrato que createShopifyOrderForSub: { shopifyOrderId, orderStatusUrl, shopifyError }.
 *   · shopify → crea la orden PAGA en Shopify (comportamiento histórico, sin cambios).
 *   · none    → sin tienda (servicios, link de pago): no hay orden que crear; el cobro
 *               queda cumplido con el comprobante interno "rec_<payment_id>", que ocupa
 *               el lugar del id de orden para que chargeclaim, shopify_orders[] y
 *               last_charge_at funcionen igual.
 *   · resto   → canal todavía no implementado: error visible (el panel no lo deja elegir).
 */
export async function fulfillCharge(merchant, subscriberId, sub, params, tag = "sync") {
  const { channel, channelInfo } = merchantProfile(merchant);
  if (channel === "shopify") return createShopifyOrderForSub(merchant, subscriberId, sub, params, tag);
  if (channel === "none") {
    if (params?.requireAddress && !(sub.shipping_address?.address1 && sub.shipping_address?.city)) {
      return { shopifyOrderId: null, orderStatusUrl: null, shopifyError: "Faltan datos: shipping_address.address1/city" };
    }
    return { shopifyOrderId: internalFulfillmentId(params.payment_id), orderStatusUrl: null, shopifyError: null };
  }
  const shopifyError = `El canal ${channelInfo?.label || channel} todavía no crea órdenes`;
  console.error(`[${tag}] ${shopifyError} (sub=${subscriberId})`);
  return { shopifyOrderId: null, orderStatusUrl: null, shopifyError };
}

const nowIso = () => new Date().toISOString();
// Date.parse tolerante: MP manda fechas con offset (-04:00) y nosotros en Z.
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };
const byDateDesc = (a, b) => ms(b?.date_created) - ms(a?.date_created);

// URL del portal del cliente (token firmado si lo tiene).
export function portalUrlFor(sub) {
  const base = appBaseUrl();
  return sub?.portal_token ? `${base}/#/portal?token=${encodeURIComponent(sub.portal_token)}` : `${base}/#/portal`;
}

// Comisión REAL que cobró MP en el pago (fee del vendedor, sin financing_fee del comprador).
const mpFeeReal = (payment) =>
  (payment?.fee_details || []).filter(fd => fd.fee_payer !== "payer").reduce((s, fd) => s + (parseFloat(fd.amount) || 0), 0) || null;

// ─── Helpers compartidos (los usa también api/mp/webhook.js) ─────────────────

/**
 * Crea la orden Shopify PAGA de un cobro. Devuelve { shopifyOrderId, orderStatusUrl, shopifyError }.
 * REGLA: si pagó, SIEMPRE crear orden aunque falte dirección (tag FALTA-DIRECCION
 * lo pone shopify.js). `requireAddress` solo lo usa el simulador.
 * `extra` se mergea en los params de shCreatePaidOrder (ej. simulated:true).
 */
export async function createShopifyOrderForSub(merchant, subscriberId, sub, { payment_id, total_price, charge_number, mp_fee_real = null, requireAddress = false, extra = {} }, tag = "sync") {
  const out = { shopifyOrderId: null, orderStatusUrl: null, shopifyError: null };
  const addrOk = !!(sub.shipping_address?.address1 && sub.shipping_address?.city);
  if (merchant.shopify_token && merchant.shopify_shop && sub.plan_snapshot?.shopify_variant_id && (!requireAddress || addrOk)) {
    try {
      const customer = await shFindOrCreateCustomer(merchant.shopify_shop, merchant.shopify_token, {
        email: sub.customer_email,
        first_name: (sub.customer_name || "").split(" ")[0] || "",
        last_name: (sub.customer_name || "").split(" ").slice(1).join(" ") || "",
        phone: sub.customer_phone,
        address: sub.shipping_address,
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
      });
      const itemQty = sub.quantity || sub.plan_snapshot?.units_per_shipment || 1;
      const order = await shCreatePaidOrder(merchant.shopify_shop, merchant.shopify_token, {
        customer_id: customer.id,
        line_items: [{ variant_id: sub.plan_snapshot.shopify_variant_id, quantity: itemQty }],
        shipping_address: toShopifyAddress(sub.shipping_address, sub.customer_name, sub.customer_phone),
        subscriber_id: subscriberId,
        plan_id: sub.plan_id,
        charge_number,
        // mp_payment_id: shopify.js lo usa para buscar una orden previa (dedup) antes de crear.
        mp_payment_id: String(payment_id),
        total_price,
        mp_fee_real,
        shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
        shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
        shipping_method_code: sub.plan_snapshot?.shipping_method_code || "",
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
        ...extra,
      });
      out.shopifyOrderId = order.id;
      out.orderStatusUrl = order.order_status_url || null;
    } catch (e) {
      out.shopifyError = e.message;
      console.error(`[${tag}] error creando orden Shopify sub=${subscriberId}:`, e.message);
    }
  } else {
    const missing = [];
    if (!merchant.shopify_token) missing.push("shopify_token");
    if (!merchant.shopify_shop) missing.push("shopify_shop");
    if (!sub.plan_snapshot?.shopify_variant_id) missing.push("plan_snapshot.shopify_variant_id");
    if (requireAddress && !addrOk) missing.push("shipping_address.address1/city");
    out.shopifyError = `Faltan datos: ${missing.join(", ")}`;
  }
  return out;
}

/**
 * Primera venta confirmada (orden creada): Meta CAPI Purchase + email de activación.
 * Best-effort. eventId estable por sub → Meta deduplica entre webhook/sync/link.
 * `value`/`amount` = payment.transaction_amount (lo que realmente cobró MP).
 */
export async function notifyActivation(merchantId, merchant, subscriberId, sub, payment, tag = "sync", { shopifyOrderId = null } = {}) {
  const amount = Number(payment?.transaction_amount) || 0;
  if (merchant.meta_pixel_id && merchant.meta_capi_token) {
    try {
      const partes = String(sub.customer_name || "").trim().split(" ");
      const r = await sendMetaPurchase({
        pixelId: merchant.meta_pixel_id,
        token: merchant.meta_capi_token,
        value: amount,
        currency: payment?.currency_id || "ARS",
        email: sub.customer_email,
        phone: sub.customer_phone,
        firstName: partes[0] || "",
        lastName: partes.slice(1).join(" ") || "",
        city: sub.shipping_address?.city || "",
        zip: sub.shipping_address?.zip || "",
        // Atribución al anuncio: fbc/fbp/UA/IP capturados en el checkout.
        fbc: sub.fb_data?.fbc || undefined,
        fbp: sub.fb_data?.fbp || undefined,
        clientUa: sub.fb_data?.user_agent || undefined,
        clientIp: sub.fb_data?.client_ip_address || undefined,
        eventId: "rec_sub_" + subscriberId,
        eventSourceUrl: sub.fb_data?.event_source_url || sub.plan_snapshot?.product_url || (merchant.shopify_shop ? `https://${merchant.shopify_shop}` : undefined),
      });
      console.log(`[${tag}] Meta CAPI Purchase sub=${subscriberId}: ${r.ok ? "ok" : "FALLO " + r.error}`);
    } catch (e) {
      console.warn(`[${tag}] Meta CAPI falló:`, e.message);
    }
  }
  if (sub.customer_email) {
    try {
      const er = await emailSubscriptionActivated({
        to: sub.customer_email,
        customerName: sub.customer_name,
        productTitle: sub.plan_snapshot?.product_title || "Suscripción",
        frequencyDays: sub.plan_snapshot?.frequency_days || 30,
        amount,
        portalUrl: portalUrlFor(sub),
        merchant, // email.js lo usa para brandear (from/brand)
      });
      if (!er?.skipped) await logEmail(merchantId, {
        type: "activation", subscriber_id: subscriberId, to: sub.customer_email,
        customer_name: sub.customer_name, product_title: sub.plan_snapshot?.product_title,
        status: er?.error ? "error" : "sent", error: er?.error || null,
      });
    } catch (e) {
      console.warn(`[${tag}] email activación falló:`, e.message);
    }
  }
  // Entrega digital (link del plan por mail). No-op para negocios con envío (Lumina); nunca lanza.
  await sendDigitalDelivery(merchantId, merchant, subscriberId, sub, payment, "activation", { tag, portalUrl: portalUrlFor(sub) });
  // Klaviyo: "Subscription Activated" (+ "Placed Order" solo si el merchant lo pidió;
  // por defecto la integración Shopify→Klaviyo ya manda la orden). Best-effort.
  if (klaviyoEnabled(merchant)) {
    try {
      const firstChargeAt = payment?.date_approved || nowIso();
      const ordersCount = (sub.shopify_orders || []).length + (shopifyOrderId ? 1 : 0);
      await klaviyoLifecycle(merchant, merchantId, KLAVIYO_METRICS.ACTIVATED, subscriberId, sub, { payment, orderId: shopifyOrderId, firstChargeAt, ordersCount });
      await klaviyoPlacedOrder(merchant, merchantId, subscriberId, sub, { payment, orderId: shopifyOrderId, chargeNumber: 1, firstChargeAt, ordersCount });
    } catch (e) { console.warn(`[${tag}] klaviyo activación falló:`, e.message); }
  }
  // Flujos de email propios ("Nueva suscripción"). No hace nada si la tienda no tiene flujos activos.
  await emitFlowEvent(merchantId, merchant, "activated", subscriberId, sub, { key: payment?.id || "first" });
}

/**
 * Cobro N>1 con orden creada: Klaviyo "Subscription Renewed" (+ "Placed Order" opcional).
 * Best-effort; idempotente por payment id / order id (unique_id).
 */
export async function notifyRenewal(merchantId, merchant, subscriberId, sub, payment, tag = "sync", { shopifyOrderId = null } = {}) {
  // Flujos de email propios ("Renovación cobrada"). No-op sin flujos activos.
  await emitFlowEvent(merchantId, merchant, "renewed", subscriberId, sub, { key: payment?.id || shopifyOrderId || undefined });
  // Entrega digital en renovaciones (si el plan lo pide). No-op con envío; nunca lanza.
  await sendDigitalDelivery(merchantId, merchant, subscriberId, sub, payment, "renewal", { tag, portalUrl: portalUrlFor(sub) });
  if (!klaviyoEnabled(merchant)) return;
  try {
    const ordersCount = (sub.shopify_orders || []).length + (shopifyOrderId ? 1 : 0);
    await klaviyoLifecycle(merchant, merchantId, KLAVIYO_METRICS.RENEWED, subscriberId, sub, { payment, orderId: shopifyOrderId, ordersCount });
    await klaviyoPlacedOrder(merchant, merchantId, subscriberId, sub, { payment, orderId: shopifyOrderId, chargeNumber: ordersCount, ordersCount });
  } catch (e) { console.warn(`[${tag}] klaviyo renovación falló:`, e.message); }
}

// Email de pago rechazado (una sola vez por payment id: el caller dedupa con last_payment_failed_id)
// + evento Klaviyo "Subscription Payment Failed".
export async function sendPaymentFailedEmail(merchantId, merchant, subscriberId, sub, tag = "sync", payment = null) {
  // Flujos de email propios ("Pago rechazado"). No-op sin flujos activos.
  await emitFlowEvent(merchantId, merchant, "payment_failed", subscriberId, sub, { key: sub.last_payment_failed_id || payment?.id || undefined });
  if (klaviyoEnabled(merchant)) {
    try {
      await klaviyoLifecycle(merchant, merchantId, KLAVIYO_METRICS.PAYMENT_FAILED, subscriberId, sub, {
        payment, uniqueSuffix: sub.last_payment_failed_id || undefined,
      });
    } catch (e) { console.warn(`[${tag}] klaviyo payment_failed falló:`, e.message); }
  }
  if (!sub.customer_email) return;
  try {
    const er = await emailPaymentFailed({
      to: sub.customer_email,
      customerName: sub.customer_name,
      productTitle: sub.plan_snapshot?.product_title || "Suscripción",
      portalUrl: portalUrlFor(sub),
      merchant,
    });
    if (!er?.skipped) await logEmail(merchantId, {
      type: "payment_failed", subscriber_id: subscriberId, to: sub.customer_email,
      customer_name: sub.customer_name, product_title: sub.plan_snapshot?.product_title,
      status: er?.error ? "error" : "sent", error: er?.error || null,
    });
  } catch (e) { console.warn(`[${tag}] email payment_failed falló:`, e.message); }
}

/**
 * Marca un sub como payment_failed por un pago rechazado/cancelado + email. Dedup por
 * payment id. Solo para subs RECURRENTES (ya tuvieron cobro/orden): el primer pago
 * fallido de un lead lo dejamos pending (sin spam). No pisa cancelled/paused.
 * @returns {Promise<boolean>} true si marcó.
 */
export async function applyPaymentFailed(merchantId, merchant, subRef, sub, payment, tag = "sync") {
  const pid = String(payment?.id || "");
  if (!pid || sub.last_payment_failed_id === pid) return false;
  if (sub.status === "cancelled" || sub.status === "paused") return false;
  const isRecurring = !!(sub.last_charge_at || (sub.shopify_orders || []).length > 0);
  if (!isRecurring) return false;
  await subRef.update({
    status: "payment_failed",
    last_payment_failed_id: pid,
    last_payment_failed_at: payment.date_created || nowIso(),
    updated_at: nowIso(),
  });
  await sendPaymentFailedEmail(merchantId, merchant, subRef.id, sub, tag, payment);
  return true;
}

/**
 * Descuento solo en el primer cobro (`discount_first_charge_only`): después del PRIMER
 * pago aprobado, subimos el transaction_amount del preapproval al precio full.
 * Idempotente por `repriced_after_first_charge`. Nunca bloquea la orden.
 */
export async function repriceAfterFirstCharge(token, subRef, sub, preId, tag = "sync") {
  if (!sub?.discount_first_charge_only || sub.repriced_after_first_charge) return null;
  const full = Number(sub.full_price_per_charge_ars);
  if (!(full > 0) || !preId || !token) return null;
  try {
    await mpUpdatePreapproval(token, preId, { auto_recurring: { transaction_amount: full, currency_id: "ARS" } });
    await subRef.update({
      "plan_snapshot.total_per_charge_ars": full,
      repriced_after_first_charge: true,
      repriced_at: nowIso(),
      reprice_error: FieldValue.delete(),
    });
    console.log(`[${tag}] repriced sub=${subRef.id} preapproval=${preId} → $${full}`);
    return { ok: true };
  } catch (e) {
    console.error(`[${tag}] reprice falló sub=${subRef.id}:`, e.message);
    await subRef.update({ reprice_error: String(e.message || e).slice(0, 300) }).catch(() => {});
    return { ok: false, error: e.message };
  }
}

/**
 * Sincroniza un subscriber con MP. Busca el preapproval por plan ad-hoc (o
 * external_reference), trae payments asociados, crea orden Shopify y charges no
 * procesados, detecta rechazos de renovación.
 *
 * Idempotente: si ya está sincronizado, no duplica nada.
 *
 * @returns { status, mp_preapproval_id, mp_preapproval_status, payments_found, payments_approved,
 *            shopify_order_status_url, charges_processed, shopify_errors, error }
 */
export async function syncSubscriber(merchantId, subscriberId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();
  if (!merchant.mp_access_token) return { status: "error", error: "no_mp_token" };
  const token = merchant.mp_access_token;

  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { status: "error", error: "subscriber_not_found" };
  const sub = subSnap.data();

  // Error de MP (429/5xx/timeout/401): NO tocamos status. Grabamos el error en el
  // sub y, si es de credenciales, marcamos el merchant para que el dashboard avise.
  const failSync = async (where, e) => {
    const msg = `${where}: ${e?.message || e}`.slice(0, 500);
    console.warn(`[sync] sub ${subscriberId} ${msg}`);
    try { await subRef.update({ last_sync_error: msg, last_sync_at: nowIso() }); } catch (_) {}
    if (isMpAuthError(e)) {
      try { await merchantRef.set({ mp_token_invalid_at: nowIso(), mp_token_error: msg }, { merge: true }); } catch (_) {}
    }
    return { status: "error", error: msg, mp_auth_error: isMpAuthError(e) || undefined, payments_found: 0 };
  };

  // Buscar EL preapproval de ESTE subscriber en MP.
  // ⚠️ En el flujo de plan, MP NO propaga el external_reference de la URL al
  // preapproval → buscar por external_reference devuelve cualquiera (o la de otro
  // subscriber) y se cruzaban todas al mismo preapproval. FIX: cada sub crea su
  // PROPIO preapproval_plan ad-hoc (id único), así que matcheamos por
  // preapproval_plan_id — que sí es 1:1 con el subscriber. Fallback a
  // external_reference solo para subs viejos del flujo directo.
  const extRef = `${merchantId}:${subscriberId}`;
  let preapprovals = [];
  try {
    // Plan actual + plan previo (si el checkout regeneró el plan al cambiar de
    // monto): un preapproval autorizado sobre el plan viejo no puede quedar huérfano.
    const planIds = [sub.mp_preapproval_plan_id, sub.mp_preapproval_plan_id_prev].filter(Boolean);
    for (const pid of planIds) {
      const byPlan = await mpSearchPreapprovalsByPlan(token, pid);
      for (const p of (byPlan?.results || [])) if (!preapprovals.some(q => q.id === p.id)) preapprovals.push(p);
    }
    if (preapprovals.length === 0) {
      const byRef = await mpSearchPreapprovals(token, { external_reference: extRef });
      // Solo aceptamos matches por external_reference si el preapproval REALMENTE
      // trae ese external_reference (evita agarrar cualquiera si MP lo ignora).
      preapprovals = (byRef?.results || []).filter(p => p.external_reference === extRef);
    }
  } catch (e) {
    return failSync("preapproval_search", e);
  }
  if (preapprovals.length === 0) {
    try { await subRef.update({ last_sync_at: nowIso(), last_sync_error: null }); } catch (_) {}
    return { status: sub.status || "pending", message: "preapproval_not_found_yet", payments_found: 0, mp_preapproval_status: null };
  }
  // Preferimos el AUTHORIZED más reciente (es el que cobra); si no hay, el más reciente.
  const sorted = preapprovals.slice().sort(byDateDesc);
  const authorized = sorted.filter(p => p.status === "authorized");
  const pre = authorized[0] || sorted[0];
  // (10) Más de un preapproval autorizado sobre el mismo plan ad-hoc: el cliente
  // confirmó dos veces. NO cancelamos nada en MP automáticamente: alertamos y
  // procesamos los pagos de TODOS para que ningún cobro quede sin orden.
  const extraAuthorized = authorized.slice(1);
  if (extraAuthorized.length > 0) {
    console.warn(`[sync] sub ${subscriberId}: ${authorized.length} preapprovals AUTHORIZED para el plan ${sub.mp_preapproval_plan_id || "-"} (${authorized.map(p => p.id).join(", ")}) — revisar en MP`);
  }

  // Update preliminar: solo actualizamos preapproval_id + next_charge_at.
  // El status del subscriber NO se cambia acá — depende de si hay payments
  // approved (ver más abajo). MP marca el preapproval como "authorized"
  // apenas la tarjeta es validada, antes incluso de que cobre — eso no
  // significa que se haya hecho cobro, así que no marcamos active todavía.
  const updates = {
    mp_preapproval_id: pre.id,
    mp_preapproval_status: pre.status || null,
    next_charge_at: pre.next_payment_date || null,
    updated_at: nowIso(),
  };
  if (extraAuthorized.length > 0) {
    updates.mp_preapproval_ids_extra = extraAuthorized.map(p => p.id);
    updates.alert_multi_preapproval = true;
  } else if (sub.alert_multi_preapproval) {
    updates.alert_multi_preapproval = false;
  }

  // SIEMPRE intentamos procesar payments aprobados — aunque la sub esté
  // cancelled, si hubo un cobro real que no se procesó como orden Shopify,
  // hay que crearla (el cliente pagó). MP no devuelve plata por cobros ya
  // procesados al cancelar la sub.

  // ─── Buscar payments del/los preapproval(s) y procesarlos ───────────────
  // MP no garantiza que `preapproval_id` filtre todos los payments asociados
  // a la sub. Probamos varias estrategias y unimos resultados sin duplicar:
  //   1) /v1/payments/search?preapproval_id=X (por cada preapproval authorized)
  //   2) /v1/payments/search?external_reference=mid:sid
  //   3) /authorized_payments/search → payment.id → /v1/payments/{id}
  //   4) últimos pagos de la cuenta (2h) filtrados por external_reference
  // Las búsquedas 1 y 2 son "duras": si fallan, la sync devuelve error y no toca
  // status. Las 3 y 4 son "blandas": si fallan seguimos, pero marcamos
  // `searchIncomplete` → no forzamos cobro ni degradamos a pending.
  const paymentsMap = new Map(); // id → payment
  const addResults = (res) => { for (const p of (res?.results || [])) if (p?.id && !paymentsMap.has(p.id)) paymentsMap.set(p.id, p); };
  const preIds = [pre.id, ...extraAuthorized.map(p => p.id)];
  let searchIncomplete = false;
  try {
    for (const pid of preIds) addResults(await mpSearchPayments(token, { preapproval_id: pid }));
    addResults(await mpSearchPayments(token, { external_reference: extRef }));
    addResults(await mpSearchPayments(token, { sort: "date_created", criteria: "desc", external_reference: extRef }));
  } catch (e) {
    return failSync("payments_search", e);
  }

  // Además, /authorized_payments — endpoint específico de Subscriptions MP.
  // Cada item tiene un `payment` con id del cobro real. Estos APs aparecen
  // antes que el payment en /v1/payments/search cuando MP recién cobra.
  for (const pid of preIds) {
    try {
      const aps = await mpSearchAuthorizedPayments(token, pid);
      for (const ap of (aps?.results || [])) {
        const apPid = ap?.payment?.id;
        if (apPid && !paymentsMap.has(apPid)) {
          try {
            const p = await mpGetPayment(token, apPid);
            if (p?.id) paymentsMap.set(p.id, p);
          } catch (e) {
            if (isMpAuthError(e)) return failSync("payments_get", e);
            searchIncomplete = true;
            console.warn(`[sync] GET /v1/payments/${apPid} falló:`, e.message);
          }
        }
      }
    } catch (e) {
      if (isMpAuthError(e)) return failSync("authorized_payments_search", e);
      searchIncomplete = true;
      console.warn(`[sync] authorized_payments/search ${pid} falló:`, e.message);
    }
  }

  // FALLBACK ESCALADO — los queries por preapproval_id / external_reference de
  // MP search a veces NO devuelven el payment recién hecho (delay de indexación
  // que puede ser de minutos a horas). Como workaround, listamos los payments
  // RECIENTES (últimas 2 horas) de la cuenta MP y filtramos client-side por
  // external_reference matching. Si MP recién cobró, va a estar acá aunque
  // todavía no esté indexado en la búsqueda por external_reference.
  if (paymentsMap.size === 0) {
    try {
      const beginDate = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      const endDate = new Date(Date.now() + 60 * 1000).toISOString();
      const recent = await mpSearchPayments(token, {
        range: "date_created", begin_date: beginDate, end_date: endDate, sort: "date_created", criteria: "desc", limit: "50",
      });
      for (const p of (recent?.results || [])) {
        if (p?.external_reference === extRef && !paymentsMap.has(p.id)) paymentsMap.set(p.id, p);
      }
    } catch (e) {
      if (isMpAuthError(e)) return failSync("payments_recent_search", e);
      searchIncomplete = true;
      console.warn("[sync] búsqueda de pagos recientes falló:", e.message);
    }
  }

  const allPayments = Array.from(paymentsMap.values());
  // Aprobados en orden cronológico (charge_number coherente).
  const approvedPayments = allPayments.filter(p => p.status === "approved")
    .sort((a, b) => ms(a.date_approved || a.date_created) - ms(b.date_approved || b.date_created));
  // El pago más reciente de CUALQUIER estado: sirve para detectar rechazos de renovación.
  const latestPayment = allPayments.slice().sort(byDateDesc)[0] || null;
  console.log(`[sync] sub ${subscriberId}: encontrados ${allPayments.length} payments (${approvedPayments.length} approved, último=${latestPayment?.status || "-"}). preapproval=${pre.id} (${pre.status}) extRef=${extRef}${searchIncomplete ? " [búsqueda incompleta]" : ""}`);

  const hasOrders = (sub.shopify_orders || []).length > 0;

  // PLAN C — Fallback synthetic basado en `pre.summarized.charged_quantity`
  // DESHABILITADO permanentemente. Causó órdenes Shopify basura al procesar
  // subs viejas con datos incoherentes. Si MP no devuelve el payment via
  // search NI via authorized_payments, la sub queda en pending. El merchant
  // la procesa manual desde el dashboard si hace falta.

  // (6) Forzar el primer cobro adelantando start_date. Cubre el caso donde MP
  // agenda el primer cobro a "ahora + frecuencia". SOLO si: preapproval
  // authorized, CERO pagos de cualquier estado (un in_process/pending/rejected
  // reciente significa que MP ya intentó → forzar = cobrar doble), sin cobro ni
  // orden previa, búsqueda completa y nunca intentado antes. La bandera se graba
  // ANTES del PUT para que jamás se reintente dos veces (el webhook usa la misma).
  let forcedCharge = false;
  if (pre.status === "authorized" && allPayments.length === 0 && !searchIncomplete
      && !sub.last_charge_at && !hasOrders && !sub.sync_force_attempted) {
    let flagged = false;
    try {
      await subRef.update({ sync_force_attempted: true, sync_force_at: nowIso() });
      flagged = true;
    } catch (e) {
      console.warn(`[sync] no pude grabar sync_force_attempted: ${e.message}`);
    }
    if (flagged) {
      try {
        // Intentar adelantar el next_payment_date a 1 minuto en el futuro.
        const nowPlusOne = new Date(Date.now() + 60 * 1000).toISOString();
        await mpUpdatePreapproval(token, pre.id, {
          auto_recurring: { ...pre.auto_recurring, start_date: nowPlusOne },
        });
        forcedCharge = true;
      } catch (e) {
        console.warn(`[sync] no pude forzar primer cobro: ${e.message}`);
        updates.sync_force_error = String(e.message || e).slice(0, 300);
      }
    }
  }

  let processed = 0;
  const newOrderIds = [];
  let orderStatusUrl = sub.last_shopify_order_status_url || null;
  const wasFirstCharge = !sub.last_charge_at;
  let firstOrderPayment = null; // pago cuya orden se creó en esta corrida (para activación)
  const newOrderPayments = [];  // [{ payment, orderId }] órdenes creadas en esta corrida (Klaviyo)
  let lastOrderApprovedAt = 0;
  // Acumulamos errores de Shopify para devolverlos al caller — útil cuando el
  // pago se procesa OK pero la orden Shopify falla (DNI inválido, variant
  // borrado, etc). El sub queda active pero hay que arreglar y reintentar.
  const shopifyErrors = [];

  for (const payment of approvedPayments) {
    const chargeNumber = (sub.shopify_orders || []).length + newOrderIds.length + 1;

    // Idempotencia REAL por payment_id (globalmente único). Fallback al esquema
    // viejo `preapproval_id-N` solo si el payment no trae id (caso synthetic).
    let chargeRef;
    if (payment.id != null) {
      // Claim ATÓMICO sobre charges/{payment.id} (+ dedup cross-key legacy adentro):
      // evita que webhook + polling + self-heal creen DOS órdenes del mismo pago.
      const claim = await claimCharge(merchantRef, payment.id, { subscriber_id: subscriberId });
      chargeRef = claim.chargeRef;
      if (!claim.proceed) continue; // ya tiene orden / otro proceso la está creando ahora
    } else {
      const chargeRef0 = merchantRef.collection("charges").doc(`${pre.id}-${chargeNumber}`);
      const existingCharge = await chargeRef0.get();
      if (existingCharge.exists && existingCharge.data().shopify_order_id) continue;
      chargeRef = chargeRef0;
    }

    const { shopifyOrderId, orderStatusUrl: thisOrderStatusUrl, shopifyError } = await fulfillCharge(merchant, subscriberId, sub, {
      payment_id: payment.id,
      total_price: payment.transaction_amount,
      charge_number: chargeNumber,
      mp_fee_real: mpFeeReal(payment),
    }, "sync");
    if (shopifyError) shopifyErrors.push(shopifyError);

    await chargeRef.set({
      subscriber_id: subscriberId,
      mp_payment_id: String(payment.id),
      amount_ars: payment.transaction_amount,
      status: payment.status,
      shopify_order_id: shopifyOrderId,
      shopify_order_status_url: thisOrderStatusUrl,
      error: shopifyError,
      created_at: nowIso(),
    });
    if (shopifyOrderId) {
      newOrderIds.push(shopifyOrderId);
      newOrderPayments.push({ payment, orderId: shopifyOrderId });
      if (!firstOrderPayment) firstOrderPayment = payment;
      lastOrderApprovedAt = Math.max(lastOrderApprovedAt, ms(payment.date_approved || payment.date_created));
    }
    if (thisOrderStatusUrl) orderStatusUrl = thisOrderStatusUrl;
    processed += 1;
  }

  // Descuento solo en el primer cobro: con el primer pago aprobado, subimos el
  // preapproval al precio full. No bloquea nada.
  if (approvedPayments.length > 0) {
    await repriceAfterFirstCharge(token, subRef, sub, pre.id, "sync");
  }

  // (8) Rechazo de renovación: el pago MÁS RECIENTE está rejected/cancelled, es
  // posterior al último cobro (o ya hubo órdenes) y no lo avisamos todavía.
  const latestRejected = !!latestPayment && (latestPayment.status === "rejected" || latestPayment.status === "cancelled");
  let newFailedPayment = null;
  if (latestRejected && sub.last_payment_failed_id !== String(latestPayment.id)) {
    const after = sub.last_charge_at ? ms(latestPayment.date_created) > ms(sub.last_charge_at) : hasOrders;
    if (after) newFailedPayment = latestPayment;
  }

  // Definir status final SEGÚN LA VERDAD DE MERCADO PAGO (el preapproval manda):
  // 1. MP dice cancelled → cancelled (incluso si tuvo pagos antes).
  // 2. MP dice paused → paused.
  // 3. Renovación rechazada nueva → payment_failed (+ mail una sola vez).
  //    Si ya estaba payment_failed y el último pago sigue rechazado → sigue así
  //    (NO vuelve a active por pagos aprobados viejos).
  // 4. Hay pagos aprobados (y el último no es rechazo) → active. Recupera subs
  //    mal marcadas "cancelled" por bugs viejos que en MP siguen cobrando.
  // 5. Estaba cancelled local y MP no muestra ni pago ni cancel → sigue cancelled.
  // 6. Estaba active y tiene órdenes/cobro previo, o el preapproval sigue
  //    authorized, o la búsqueda fue incompleta → sigue active (NUNCA degradar
  //    una sub que cobra por un 429/indexación de MP).
  // 7. Resto (authorized sin pagos, pending) → pending.
  const protectActive = hasOrders || !!sub.last_charge_at;
  const newerApproved = approvedPayments.some(p => ms(p.date_approved || p.date_created) > ms(sub.last_payment_failed_at));
  if (pre.status === "cancelled") {
    updates.status = "cancelled";
    if (sub.status !== "cancelled") updates.cancelled_at = nowIso();
  } else if (pre.status === "paused") {
    updates.status = "paused";
  } else if (newFailedPayment && sub.status !== "cancelled") {
    updates.status = "payment_failed";
    updates.last_payment_failed_id = String(newFailedPayment.id);
    updates.last_payment_failed_at = newFailedPayment.date_created || nowIso();
  } else if (sub.status === "payment_failed" && (latestRejected || (sub.last_payment_failed_at && !newerApproved))) {
    // Sigue en payment_failed hasta que aparezca un aprobado POSTERIOR al rechazo
    // (el rechazo puede tardar en indexarse en la búsqueda de MP).
    updates.status = "payment_failed";
  } else if (approvedPayments.length > 0) {
    updates.status = "active";
  } else if (sub.status === "cancelled") {
    updates.status = "cancelled";
  } else if (sub.status === "active" && (protectActive || pre.status === "authorized" || searchIncomplete)) {
    updates.status = "active";
  } else if (sub.status === "payment_failed") {
    updates.status = "payment_failed";
  } else {
    updates.status = "pending";
  }
  // (13/14) last_charge_at solo avanza cuando se creó una orden nueva en esta corrida
  // (nunca se pisa en syncs sin cobro nuevo); shopify_orders siempre con arrayUnion.
  if (newOrderIds.length > 0) {
    updates.last_charge_at = new Date(Math.max(ms(sub.last_charge_at), lastOrderApprovedAt || Date.now())).toISOString();
    updates.shopify_orders = FieldValue.arrayUnion(...newOrderIds);
    if (orderStatusUrl) updates.last_shopify_order_status_url = orderStatusUrl;
  }
  updates.last_sync_at = nowIso();
  updates.last_sync_error = null;
  await subRef.update(updates);

  // Mail de pago rechazado — UNA sola vez por payment id (dedup por last_payment_failed_id).
  if (updates.status === "payment_failed" && newFailedPayment) {
    await sendPaymentFailedEmail(merchantId, merchant, subscriberId, sub, "sync", newFailedPayment);
  }

  // Primera venta con orden creada: Meta CAPI Purchase + email de activación
  // (solo primer charge; las renovaciones NO se reportan a Meta ni spamean).
  // Klaviyo: la primera → "Subscription Activated"; el resto → "Subscription Renewed".
  for (const { payment, orderId } of newOrderPayments) {
    if (wasFirstCharge && payment === firstOrderPayment) {
      await notifyActivation(merchantId, merchant, subscriberId, sub, payment, "sync", { shopifyOrderId: orderId });
    } else {
      await notifyRenewal(merchantId, merchant, subscriberId, sub, payment, "sync", { shopifyOrderId: orderId });
    }
  }

  return {
    status: updates.status || sub.status || "unknown",
    mp_preapproval_id: pre.id,
    mp_preapproval_status: pre.status,
    payments_found: allPayments.length,
    payments_approved: approvedPayments.length,
    forced_charge: forcedCharge,
    search_incomplete: searchIncomplete || undefined,
    shopify_order_status_url: orderStatusUrl,
    charges_processed: processed,
    orders_created: newOrderIds.length,
    shopify_errors: shopifyErrors, // [] si todo OK
    shopify_order_id: newOrderIds[newOrderIds.length - 1] || (sub.shopify_orders || []).slice(-1)[0] || null,
  };
}

/**
 * Linkea manualmente un payment_id específico al subscriber y procesa la
 * creación de orden Shopify. Útil cuando MP no indexa bien el payment en
 * /v1/payments/search pero el merchant lo ve en su panel.
 *
 * SEGURIDAD (12): el payment_id lo puede mandar el cliente (CheckoutSuccess con
 * su portal_token). Antes de tocar nada verificamos que el pago sea DE ESTE sub:
 * su preapproval pertenece al plan ad-hoc del sub (o es su preapproval), o su
 * external_reference es mid:sid; y el monto coincide con el plan.
 */
export async function linkPaymentToSubscriber(merchantId, subscriberId, paymentId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();
  if (!merchant.mp_access_token) return { status: "error", error: "no_mp_token" };
  const token = merchant.mp_access_token;

  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { status: "error", error: "subscriber_not_found" };
  const sub = subSnap.data();
  // ¿Es el PRIMER cobro? (antes de marcar last_charge_at más abajo). Se usa para
  // reportar el Purchase a Meta + mail de activación solo en la primera venta.
  const wasFirstCharge = !sub.last_charge_at;
  const extRef = `${merchantId}:${subscriberId}`;

  // Traer el payment directo por ID — es más confiable que /search.
  let payment;
  try {
    payment = await mpGetPayment(token, paymentId);
  } catch (e) {
    return { status: "error", error: `MP /v1/payments/${paymentId}: ${e.message}` };
  }
  if (!payment?.id) return { status: "error", error: "payment_not_found_in_mp" };
  if (payment.status !== "approved") return { status: "error", error: `payment_status=${payment.status} (no approved)` };

  // ── Verificación de pertenencia (sin tocar nada si no matchea) ──
  const preId = payment.preapproval_id
    || payment.metadata?.preapproval_id
    || payment.point_of_interaction?.transaction_data?.subscription_id
    || null;
  let pre = null;
  let owned = false;
  const planIdsOwned = [sub.mp_preapproval_plan_id, sub.mp_preapproval_plan_id_prev].filter(Boolean);
  if (preId) {
    try { pre = await mpGetPreapproval(token, preId); } catch (e) {
      console.warn(`[link] no pude traer preapproval ${preId}: ${e.message}`);
    }
    const okPlan = !!(pre?.preapproval_plan_id && planIdsOwned.includes(pre.preapproval_plan_id));
    const okId = !!(sub.mp_preapproval_id && pre?.id && pre.id === sub.mp_preapproval_id);
    owned = okPlan || okId || payment.external_reference === extRef;
  } else if (payment.external_reference === extRef) {
    owned = true;
  } else if (planIdsOwned.length) {
    // El pago no trae referencia al preapproval: buscamos los preapprovals del
    // plan ad-hoc del sub (1:1) y aceptamos si el pagador coincide.
    try {
      for (const pid of planIdsOwned) {
        const r = await mpSearchPreapprovalsByPlan(token, pid);
        const match = (r?.results || []).find(p => p.payer_id && payment.payer?.id && String(p.payer_id) === String(payment.payer.id));
        if (match) { pre = match; owned = true; break; }
      }
    } catch (e) { console.warn(`[link] búsqueda por plan falló: ${e.message}`); }
  }
  // Monto: debe coincidir con el plan del sub. Con `discount_first_charge_only` el
  // primer pago vale el precio con descuento (snapshot) y los siguientes el full.
  const validAmounts = [];
  if (sub.plan_snapshot?.total_per_charge_ars != null) validAmounts.push(Number(sub.plan_snapshot.total_per_charge_ars));
  if (sub.discount_first_charge_only && sub.full_price_per_charge_ars != null) validAmounts.push(Number(sub.full_price_per_charge_ars));
  const amountOk = validAmounts.length === 0 || validAmounts.some(a => Math.abs(Number(payment.transaction_amount) - a) < 1);
  if (!owned || !amountOk) {
    console.warn(`[link] payment ${payment.id} NO pertenece al sub ${subscriberId} (owned=${owned} amountOk=${amountOk})`);
    return { status: "error", error: "payment_not_owned" };
  }

  // Idempotencia ATÓMICA: reclama el charge para no duplicar la orden si el
  // webhook o el polling corren a la vez sobre el mismo pago.
  const claim = await claimCharge(merchantRef, payment.id, { subscriber_id: subscriberId });
  const chargeRef = claim.chargeRef;
  if (!claim.proceed) {
    return { status: "already_linked", shopify_order_id: claim.existingOrderId || null };
  }

  const { shopifyOrderId, orderStatusUrl, shopifyError } = await fulfillCharge(merchant, subscriberId, sub, {
    payment_id: payment.id,
    total_price: payment.transaction_amount,
    charge_number: (sub.shopify_orders || []).length + 1,
    mp_fee_real: mpFeeReal(payment),
  }, "link");

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
  await repriceAfterFirstCharge(token, subRef, sub, pre?.id || sub.mp_preapproval_id || null, "link");

  const update = { updated_at: nowIso() };
  if (pre?.id) {
    // Guardamos el preapproval real: sin esto el sub no se podía cancelar/pausar.
    update.mp_preapproval_id = pre.id;
    update.mp_preapproval_status = pre.status || null;
    update.next_charge_at = pre.next_payment_date || null;
  }
  // Solo si la orden se creó marcamos active + last_charge_at; si Shopify falló,
  // el charge queda con error y el próximo sync/webhook reintenta la orden.
  if (!shopifyError) {
    update.status = (sub.status === "cancelled" || sub.status === "paused") ? sub.status : "active";
    update.last_charge_at = payment.date_approved || nowIso();
    if (shopifyOrderId) update.shopify_orders = FieldValue.arrayUnion(shopifyOrderId);
    if (orderStatusUrl) update.last_shopify_order_status_url = orderStatusUrl;
  }
  await subRef.update(update);

  // (25) Primera venta con orden creada: Meta CAPI + mail de activación (mismo
  // eventId que webhook/sync → Meta deduplica).
  if (wasFirstCharge && !shopifyError) {
    await notifyActivation(merchantId, merchant, subscriberId, sub, payment, "link", { shopifyOrderId });
  } else if (!shopifyError) {
    await notifyRenewal(merchantId, merchant, subscriberId, sub, payment, "link", { shopifyOrderId });
  }

  return {
    status: "linked",
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    shopify_error: shopifyError,
    amount_ars: payment.transaction_amount,
  };
}

/**
 * Simula el próximo cobro recurrente — crea charge + orden Shopify como si
 * MP hubiera cobrado el siguiente mes. Útil para validar que cobros 2, 3, ...
 * funcionan bien sin esperar 30 días reales ni gastar plata.
 *
 * (19) SOLO con `merchant.dev_mode === true`. La orden va con `simulated: true`
 * (shopify.js: sin mail de recibo + tag SIMULADA) y sin send_receipt.
 */
export async function simulateNextCharge(merchantId, subscriberId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();
  if (merchant.dev_mode !== true) {
    return { status: "error", error: "simulate_disabled (activá dev_mode en el merchant)" };
  }

  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { status: "error", error: "subscriber_not_found" };
  const sub = subSnap.data();
  if (sub.status === "cancelled") return { status: "error", error: "sub_cancelled" };

  const chargeNumber = (sub.shopify_orders || []).length + 1;
  const chargeKey = `${sub.mp_preapproval_id || sub.mp_adhoc_plan_id || subscriberId}-${chargeNumber}-SIM`;
  const chargeRef = merchantRef.collection("charges").doc(chargeKey);
  if ((await chargeRef.get()).exists) {
    return { status: "error", error: `Ya existe charge simulado #${chargeNumber}. Borralo de Firestore antes de reintentar.` };
  }

  const amount = sub.plan_snapshot?.total_per_charge_ars || sub.plan_snapshot?.subscription_price_ars || 0;
  const shippingPrice = sub.plan_snapshot?.shipping_price_ars ?? 0;

  // Guard estricto: si los datos no son coherentes, abortamos el simulador.
  if (amount <= 0) {
    return { status: "error", error: `amount inválido: ${amount}. Recargá la sub.` };
  }
  if (shippingPrice >= amount) {
    return { status: "error", error: `shipping ($${shippingPrice}) >= total ($${amount}). Datos del plan_snapshot incoherentes.` };
  }

  const simId = `SIM-${Date.now()}`;
  const { shopifyOrderId, orderStatusUrl, shopifyError } = await fulfillCharge(merchant, subscriberId, sub, {
    payment_id: simId,
    total_price: amount,
    charge_number: chargeNumber,
    requireAddress: true,
    // Sin mails al cliente. shopify.js trata simulated:true como send_receipt false + tag SIMULADA.
    extra: { simulated: true, send_receipt: false, send_fulfillment_receipt: false },
  }, "simulate");

  await chargeRef.set({
    subscriber_id: subscriberId,
    mp_payment_id: simId,
    amount_ars: amount,
    status: "approved",
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    error: shopifyError,
    simulated: true,
    charge_number: chargeNumber,
    created_at: nowIso(),
  });

  if (shopifyOrderId) {
    await subRef.update({
      last_charge_at: nowIso(),
      shopify_orders: FieldValue.arrayUnion(shopifyOrderId),
      last_shopify_order_status_url: orderStatusUrl,
      updated_at: nowIso(),
    });
  }

  return {
    status: shopifyOrderId ? "ok" : "error",
    charge_number: chargeNumber,
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    amount_ars: amount,
    shopify_error: shopifyError,
  };
}

export function toShopifyAddress(addr, name, phone) {
  addr = addr || {}; // sub sin shipping_address no debe explotar (orden va con FALTA-DIRECCION)
  const [first, ...rest] = (name || "").split(" ");
  return {
    address1: addr.address1 || "",
    address2: addr.address2 || "",
    city: addr.city || "",
    province: addr.province || "",
    country: addr.country || "Argentina",
    zip: addr.zip || "",
    first_name: first || "",
    last_name: rest.join(" ") || "",
    phone: phone || "",
  };
}
