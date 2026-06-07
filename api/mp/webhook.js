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
import { db } from "../_lib/firebase.js";
import { mpGetPayment, mpGetPreapproval, mpResolvePaymentLike } from "../_lib/mp.js";
import { shFindOrCreateCustomer, shCreatePaidOrder } from "../_lib/shopify.js";
import { emailSubscriptionActivated, emailPaymentFailed } from "../_lib/email.js";

export default async function handler(req, res) {
  // MP a veces hace HEAD/GET de healthcheck — siempre 200.
  if (req.method !== "POST") return res.status(200).json({ ok: true });

  const body = req.body || {};
  const type = body.type || body.topic || req.query.type || req.query.topic || "";
  const id = body.data?.id || body.id || req.query.id || req.query["data.id"] || "";

  // LOG VERBOSE — para diagnosticar exactamente qué nos manda MP.
  console.log("[mp-webhook] received", JSON.stringify({
    type, id,
    query: req.query,
    body_keys: Object.keys(body),
    body: body,
  }));

  const hintMid = String(req.query.mid || "");
  const hintSid = String(req.query.sid || "");

  // ATAJO DEFINITIVO: si tenemos hint mid + sid via query string del
  // notification_url, vamos directo al sub local y procesamos sin necesidad
  // de resolver el payment_id de MP. Buscamos el preapproval, leemos su
  // summarized.charged_quantity y creamos la orden Shopify.
  if (hintMid && hintSid && (type === "payment" || type === "subscription_authorized_payment" || type === "payment.created" || type === "payment.updated")) {
    try {
      console.log(`[mp-webhook] atajo directo via ?mid=${hintMid}&sid=${hintSid}`);
      const { syncSubscriber } = await import("../_lib/sync.js");
      const result = await syncSubscriber(hintMid, hintSid);
      console.log(`[mp-webhook] sync directo result:`, JSON.stringify(result));
      return res.status(200).json({ ok: true, via: "direct_sync" });
    } catch (e) {
      console.error("[mp-webhook] atajo directo falló:", e.message);
      // Fallthrough al flow normal abajo.
    }
  }

  try {
    if (type === "payment" || type === "payment.created" || type === "payment.updated") {
      await handlePayment(id, hintMid);
    } else if (type === "preapproval" || type === "subscription_preapproval") {
      await handlePreapproval(id, hintMid);
    } else if (type === "subscription_authorized_payment") {
      await handlePayment(id, hintMid);
    } else if (type === "chargebacks" || type === "chargeback") {
      // Contracargo: cliente disputa el cobro. Pausamos la sub para que MP no
      // cobre más mientras se resuelve.
      await handleDispute(id, "chargeback");
    } else if (type === "claim" || type === "claims") {
      // Reclamo del cliente. Igual: pausar sub.
      await handleDispute(id, "claim");
    } else if (type === "fraud_alert" || type === "fraud") {
      // MP detectó fraude. Cancelar sub.
      await handleDispute(id, "fraud");
    } else {
      console.log("[mp-webhook] tipo no manejado:", type);
    }
  } catch (e) {
    console.error("[mp-webhook] error procesando:", e.message);
    // Igual ACK — si devolvemos error MP reintenta y duplicamos órdenes.
  }

  return res.status(200).json({ ok: true });
}

// ─── Handlers ────────────────────────────────────────────────

async function handlePayment(paymentId, hintMerchantId) {
  if (!paymentId) return;

  // ─── Resolución del merchant ─────────────────────────────────
  // 1. Hint via query string del notification_url (?mid=X) — el más rápido
  //    porque lo seteamos al crear el preapproval, no requiere iterar.
  // 2. Fallback iterando merchants y probando GET /v1/payments con cada
  //    access_token (lento, falla si MP devuelve 401/404 a todos).
  let resolved = null;

  if (hintMerchantId) {
    const mSnap = await db().collection("merchants").doc(hintMerchantId).get();
    if (mSnap.exists) {
      const merchant = mSnap.data();
      if (merchant.mp_access_token) {
        const payment = await mpResolvePaymentLike(merchant.mp_access_token, paymentId);
        if (payment?.id) {
          resolved = { merchantId: hintMerchantId, merchant, payment };
        } else {
          console.warn(`[mp-webhook] hint mid=${hintMerchantId} no resolvió payment ${paymentId} (probó /v1/payments y /authorized_payments)`);
        }
      }
    }
  }

  // Fallback: iterar todos los merchants probando ambos endpoints.
  if (!resolved) {
    const merchantsSnap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
    console.log(`[mp-webhook] iterando ${merchantsSnap.size} merchants para payment ${paymentId}`);
    for (const m of merchantsSnap.docs) {
      const merchant = m.data();
      const payment = await mpResolvePaymentLike(merchant.mp_access_token, paymentId);
      if (payment?.id) {
        resolved = { merchantId: m.id, merchant, payment };
        break;
      }
    }
  }

  if (!resolved) {
    console.warn(`[mp-webhook] no encontramos merchant para payment ${paymentId}`);
    return;
  }
  await processPaymentForMerchant(resolved.merchantId, resolved.merchant, resolved.payment);
}

async function processPaymentForMerchant(merchantId, merchant, payment) {
  if (payment.status !== "approved") {
    // Payment rechazado o en proceso → marcar sub como payment_failed y
    // mandar email al cliente (solo si es un cobro recurrente; el primer
    // pago fallido lo deja como "pending" sin spam).
    if (payment.status === "rejected" || payment.status === "cancelled") {
      await markPaymentFailed(merchantId, payment);
    }
    console.log(`[mp-webhook] payment ${payment.id} status=${payment.status} — skip order creation`);
    return;
  }

  // Resolver el subscriber. Primero por external_reference, después por preapproval_id.
  let subscriberId = null;
  const extRef = payment.external_reference || "";
  if (extRef.includes(":")) {
    const [mid, sid] = extRef.split(":");
    if (mid === merchantId) subscriberId = sid;
  }
  if (!subscriberId) {
    const preapprovalId = payment.preapproval_id || payment.metadata?.preapproval_id;
    if (preapprovalId) {
      const q = await db().collection("merchants").doc(merchantId).collection("subscribers")
        .where("mp_preapproval_id", "==", preapprovalId).limit(1).get();
      if (!q.empty) subscriberId = q.docs[0].id;
    }
  }
  if (!subscriberId) {
    console.warn(`[mp-webhook] no encontramos subscriber para payment ${payment.id}`);
    return;
  }

  const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;
  const sub = subSnap.data();

  // Idempotencia: si ya procesamos este payment, no duplicamos.
  const chargeRef = db().collection("merchants").doc(merchantId).collection("charges").doc(String(payment.id));
  if ((await chargeRef.get()).exists) {
    console.log(`[mp-webhook] payment ${payment.id} ya procesado — skip`);
    return;
  }

  // Crear orden Shopify si tenemos token + dirección + variant.
  let shopifyOrderId = null;
  let shopifyError = null;
  let orderStatusUrl = null; // URL pública de Thank You de Shopify (sin login).
  // Guard ESTRICTO: no basta con que shipping_address EXISTA. Tiene que tener
  // al menos address1 (calle+nº) y city. Sin eso, Shopify acepta la orden
  // pero queda como "No se proporcionó dirección de envío" y el merchant no
  // puede empaquetar. Preferimos NO crear orden y registrar error → el
  // merchant ve el problema en dashboard y carga la dirección con el botón
  // "Editar dirección" del modal del subscriber.
  const addrOk = !!(sub.shipping_address?.address1 && sub.shipping_address?.city);
  if (!addrOk) {
    console.warn(`[mp-webhook] sub ${subscriberId} sin address1/city → NO se crea orden Shopify`);
  }
  if (merchant.shopify_token && merchant.shopify_shop && addrOk && sub.plan_snapshot?.shopify_variant_id) {
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
      // Cantidad de items: prioridad a sub.quantity (lo que eligió el cliente),
      // fallback a plan_snapshot.units_per_shipment, último recurso 1.
      const itemQty = sub.quantity || sub.plan_snapshot?.units_per_shipment || 1;
      const order = await shCreatePaidOrder(merchant.shopify_shop, merchant.shopify_token, {
        customer_id: customer.id,
        line_items: [{
          variant_id: sub.plan_snapshot.shopify_variant_id,
          quantity: itemQty,
        }],
        shipping_address: shopifyAddress(sub.shipping_address, sub.customer_name, sub.customer_phone),
        subscriber_id: subscriberId,
        plan_id: sub.plan_id,
        charge_number: (sub.shopify_orders || []).length + 1,
        mp_payment_id: payment.id,
        total_price: payment.transaction_amount,
        // Shipping: viene del snapshot del subscriber (precio + nombre custom
        // que el merchant configuró en el plan). Si snapshot no lo tiene
        // (subscribers creados antes del fix), default a "Envío a domicilio" $0.
        shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
        shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
      });
      shopifyOrderId = order.id;
      orderStatusUrl = order.order_status_url || null;
    } catch (e) {
      shopifyError = e.message;
      console.error("[mp-webhook] error creando orden Shopify:", e.message);
    }
  } else {
    shopifyError = "Faltan datos para crear orden Shopify";
  }
  await chargeRef.set({
    subscriber_id: subscriberId,
    mp_payment_id: payment.id,
    amount_ars: payment.transaction_amount,
    status: payment.status,
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    error: shopifyError,
    created_at: new Date().toISOString(),
  });
  const wasFirstCharge = !sub.last_charge_at;
  await subRef.update({
    status: "active",
    last_charge_at: new Date().toISOString(),
    shopify_orders: [...(sub.shopify_orders || []), shopifyOrderId].filter(Boolean),
    last_shopify_order_status_url: orderStatusUrl || sub.last_shopify_order_status_url || null,
  });

  // Email solo en el PRIMER cobro (activación). Los recurrentes posteriores
  // no spamean — el cliente ya sabe que tiene sub activa.
  if (wasFirstCharge && sub.customer_email) {
    const portalUrl = sub.portal_token
      ? `${process.env.APP_BASE_URL}/#/portal?token=${encodeURIComponent(sub.portal_token)}`
      : `${process.env.APP_BASE_URL}/#/portal`;
    try {
      await emailSubscriptionActivated({
        to: sub.customer_email,
        customerName: sub.customer_name,
        productTitle: sub.plan_snapshot?.product_title || "Suscripción",
        frequencyDays: sub.plan_snapshot?.frequency_days || 30,
        amount: sub.plan_snapshot?.subscription_price_ars || payment.transaction_amount,
        portalUrl,
      });
    } catch (e) {
      console.warn("[mp-webhook] email activación falló:", e.message);
    }
  }

  console.log(`[mp-webhook] OK payment ${payment.id} → order ${shopifyOrderId || "ERROR"}`);
}

function shopifyAddress(addr, name, phone) {
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

async function markPaymentFailed(merchantId, payment) {
  // Buscar el subscriber correspondiente y marcar payment_failed + email.
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
  if (!subscriberId) return;
  const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;
  const sub = subSnap.data();
  // Solo emailear si ya había tenido al menos un cobro previo (es recurrente)
  const isRecurring = Boolean(sub.last_charge_at);
  await subRef.update({ status: "payment_failed", updated_at: new Date().toISOString() });
  if (isRecurring && sub.customer_email) {
    const portalUrl = sub.portal_token ? `${process.env.APP_BASE_URL}/#/portal?token=${encodeURIComponent(sub.portal_token)}` : `${process.env.APP_BASE_URL}/#/portal`;
    try {
      await emailPaymentFailed({
        to: sub.customer_email,
        customerName: sub.customer_name,
        productTitle: sub.plan_snapshot?.product_title || "Suscripción",
        portalUrl,
      });
    } catch (e) { console.warn("[mp-webhook] email payment_failed falló:", e.message); }
  }
}

async function handlePreapproval(preapprovalId) {
  // Cuando el estado del preapproval cambia (authorized, paused, cancelled),
  // actualizamos el subscriber. La PRIMERA vez que llega este webhook puede
  // ser justo después de que MP creó el preapproval automáticamente (flow
  // checkout-del-plan): en ese caso el subscriber aún no tiene grabado
  // `mp_preapproval_id`, hay que resolverlo via external_reference que MP
  // heredó del plan ad-hoc al confirmar.
  if (!preapprovalId) return;
  const merchantsSnap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
  for (const m of merchantsSnap.docs) {
    let pre;
    try { pre = await mpGetPreapproval(m.data().mp_access_token, preapprovalId); } catch (_) { continue; }
    if (!pre?.id) continue; // este merchant no es el dueño del preapproval

    // Resolver subscriber: primero por mp_preapproval_id (ya conocido),
    // después por external_reference (primer webhook post-checkout).
    let subDoc = null;
    const q1 = await db().collection("merchants").doc(m.id).collection("subscribers")
      .where("mp_preapproval_id", "==", preapprovalId).limit(1).get();
    if (!q1.empty) subDoc = q1.docs[0];

    if (!subDoc && pre.external_reference?.includes(":")) {
      const [mid, sid] = pre.external_reference.split(":");
      if (mid === m.id) {
        const ref = db().collection("merchants").doc(m.id).collection("subscribers").doc(sid);
        const snap = await ref.get();
        if (snap.exists) subDoc = { ref, data: () => snap.data() };
      }
    }

    if (!subDoc) {
      console.warn(`[mp-webhook] preapproval ${preapprovalId} sin subscriber (extRef=${pre.external_reference})`);
      return;
    }

    const map = { authorized: "active", paused: "paused", cancelled: "cancelled", pending: "pending" };
    await subDoc.ref.update({
      mp_preapproval_id: preapprovalId, // grabamos por si era el primer webhook
      status: map[pre.status] || pre.status || "unknown",
      next_charge_at: pre.next_payment_date || null,
      updated_at: new Date().toISOString(),
    });
    console.log(`[mp-webhook] preapproval ${preapprovalId} → ${pre.status}`);
    return;
  }
}

// Reclamo / contracargo / fraude → pausamos o cancelamos la sub para parar
// los cobros recurrentes. El ID que MP nos manda puede ser de un payment o
// de un claim — intentamos resolver buscando el payment relacionado.
//
// Política:
//   - kind="claim" o "chargeback" → status="payment_failed" (pausa pero
//     queda recuperable si el reclamo se resuelve a favor del merchant)
//   - kind="fraud" → status="cancelled" (cero tolerancia)
async function handleDispute(disputeId, kind) {
  if (!disputeId) return;
  const merchantsSnap = await db().collection("merchants").where("mp_access_token", "!=", "").get();

  for (const m of merchantsSnap.docs) {
    const token = m.data().mp_access_token;
    if (!token) continue;

    // Intentamos resolver el payment via /v1/payments/{id}. Si el ID es de
    // un payment, devuelve OK. Si es de un claim/chargeback, MP devuelve la
    // info con payment_id adentro.
    let paymentId = disputeId;
    try {
      const direct = await mpGetPayment(token, disputeId);
      if (direct?.id) paymentId = direct.id;
    } catch (_) {
      // Es ID de claim — buscamos en endpoint de claims
      try {
        const r = await fetch(`https://api.mercadopago.com/v1/claims/${disputeId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const d = await r.json().catch(() => ({}));
        if (d?.resource_id) paymentId = d.resource_id;
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
      dispute_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Si es fraude o contracargo, además cancelamos en MP para que NO siga cobrando.
    if (kind === "fraud" || kind === "chargeback") {
      const subSnap = await subRef.get();
      const sub = subSnap.data();
      if (sub?.mp_preapproval_id) {
        try {
          const { mpUpdatePreapproval } = await import("../_lib/mp.js");
          await mpUpdatePreapproval(token, sub.mp_preapproval_id, { status: "cancelled" });
          update.cancelled_at = new Date().toISOString();
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
