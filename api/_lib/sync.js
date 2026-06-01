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
import { mpGetPayment, mpUpdatePreapproval } from "./mp.js";
import { shFindOrCreateCustomer, shCreatePaidOrder } from "./shopify.js";
import { emailSubscriptionActivated, emailPaymentFailed } from "./email.js";

const MP_BASE = "https://api.mercadopago.com";

async function mpFetch(token, path) {
  const r = await fetch(`${MP_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.json().catch(() => ({}));
}

/**
 * Sincroniza un subscriber con MP. Busca el preapproval por external_reference,
 * traer payments asociados, crear orden Shopify y charges no procesados.
 *
 * Idempotente: si ya está sincronizado, no duplica nada.
 *
 * @returns { status, mp_preapproval_id, shopify_order_status_url, charges_processed, error }
 */
export async function syncSubscriber(merchantId, subscriberId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();
  if (!merchant.mp_access_token) return { status: "error", error: "no_mp_token" };

  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { status: "error", error: "subscriber_not_found" };
  const sub = subSnap.data();

  // Buscar preapproval en MP por external_reference (mid:sid)
  const extRef = `${merchantId}:${subscriberId}`;
  const search = await mpFetch(merchant.mp_access_token, `/preapproval/search?external_reference=${encodeURIComponent(extRef)}`);
  const preapprovals = search?.results || [];
  if (preapprovals.length === 0) {
    return { status: sub.status || "pending", message: "preapproval_not_found_yet" };
  }
  // Tomamos el más reciente (a veces MP crea más de uno si el cliente reintenta)
  const pre = preapprovals.sort((a, b) => (b.date_created || "").localeCompare(a.date_created || ""))[0];

  // Update preliminar: solo actualizamos preapproval_id + next_charge_at.
  // El status del subscriber NO se cambia acá — depende de si hay payments
  // approved (ver más abajo). MP marca el preapproval como "authorized"
  // apenas la tarjeta es validada, antes incluso de que cobre — eso no
  // significa que se haya hecho cobro, así que no marcamos active todavía.
  const updates = {
    mp_preapproval_id: pre.id,
    next_charge_at: pre.next_payment_date || null,
    updated_at: new Date().toISOString(),
  };

  // SIEMPRE intentamos procesar payments aprobados — aunque la sub esté
  // cancelled, si hubo un cobro real que no se procesó como orden Shopify,
  // hay que crearla (el cliente pagó). MP no devuelve plata por cobros ya
  // procesados al cancelar la sub.

  // ─── Buscar payments del preapproval y procesarlos ───────────────
  // MP no garantiza que `preapproval_id` filtre todos los payments asociados
  // a la sub. Probamos 3 estrategias y unimos resultados sin duplicar:
  //   1) /v1/payments/search?preapproval_id=X
  //   2) /v1/payments/search?external_reference=mid:sid (lo más confiable)
  //   3) Si pre.summarized contiene IDs específicos, los traemos
  const paymentsMap = new Map(); // id → payment

  const tryQueries = [
    `/v1/payments/search?preapproval_id=${encodeURIComponent(pre.id)}`,
    `/v1/payments/search?external_reference=${encodeURIComponent(extRef)}`,
    `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(extRef)}`,
  ];
  for (const q of tryQueries) {
    try {
      const res = await mpFetch(merchant.mp_access_token, q);
      const results = res?.results || [];
      for (const p of results) {
        if (p?.id && !paymentsMap.has(p.id)) paymentsMap.set(p.id, p);
      }
    } catch (_) {}
  }

  // Además, /authorized_payments — endpoint específico de Subscriptions MP.
  // Cada item tiene un `payment` con id del cobro real. Estos APs aparecen
  // antes que el payment en /v1/payments/search cuando MP recién cobra.
  try {
    const aps = await mpFetch(merchant.mp_access_token, `/authorized_payments/search?preapproval_id=${encodeURIComponent(pre.id)}`);
    const apResults = aps?.results || [];
    for (const ap of apResults) {
      const pid = ap?.payment?.id;
      if (pid && !paymentsMap.has(pid)) {
        try {
          const p = await mpFetch(merchant.mp_access_token, `/v1/payments/${pid}`);
          if (p?.id) paymentsMap.set(p.id, p);
        } catch (_) {}
      }
    }
  } catch (_) {}

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
      const recent = await mpFetch(
        merchant.mp_access_token,
        `/v1/payments/search?range=date_created&begin_date=${encodeURIComponent(beginDate)}&end_date=${encodeURIComponent(endDate)}&sort=date_created&criteria=desc&limit=50`
      );
      const results = recent?.results || [];
      for (const p of results) {
        if (p?.external_reference === extRef && !paymentsMap.has(p.id)) {
          paymentsMap.set(p.id, p);
        }
      }
    } catch (_) {}
  }

  let allPayments = Array.from(paymentsMap.values());
  let approvedPayments = allPayments.filter(p => p.status === "approved");
  console.log(`[sync] sub ${subscriberId}: encontrados ${allPayments.length} payments (${approvedPayments.length} approved). preapproval=${pre.id} extRef=${extRef}`);

  // PLAN C — Si no encontramos NINGÚN payment via search PERO el preapproval
  // dice que cobró (summarized.charged_quantity > 0), confiamos en eso y
  // creamos payment(s) "virtuales" con los datos del summarized. MP no
  // devuelve payment_id en summarized pero sí amount y date — eso alcanza
  // para crear la orden Shopify. La idempotencia la garantiza el pseudo-id
  // que armamos como `${preapproval_id}-${charge_index}`.
  if (approvedPayments.length === 0 && pre.summarized?.charged_quantity > 0) {
    const charged = parseInt(pre.summarized.charged_quantity) || 0;
    const amount = parseFloat(pre.summarized.last_charged_amount) || (pre.auto_recurring?.transaction_amount) || 0;
    const lastDate = pre.summarized.last_charged_date || new Date().toISOString();
    console.log(`[sync] sub ${subscriberId}: usando summarized fallback (${charged} cobros × $${amount})`);
    // Creamos un payment "virtual" por cada cobro reportado. Idempotente:
    // si el chargeRef ya existe, el loop de procesamiento abajo lo salta.
    for (let i = 0; i < charged; i++) {
      const pseudoId = `${pre.id}-${i + 1}`;
      if (!paymentsMap.has(pseudoId)) {
        paymentsMap.set(pseudoId, {
          id: pseudoId,
          status: "approved",
          transaction_amount: amount,
          date_created: lastDate,
          external_reference: extRef,
          preapproval_id: pre.id,
          _synthetic: true, // marca interna — orden Shopify se crea igual
        });
      }
    }
    allPayments = Array.from(paymentsMap.values());
    approvedPayments = allPayments.filter(p => p.status === "approved");
    console.log(`[sync] tras fallback summarized: ${approvedPayments.length} approved`);
  }

  // Si el preapproval está authorized pero NO hay payments aprobados ni
  // pending, intentamos forzar el cobro inmediato actualizando el
  // next_payment_date del preapproval. Esto cubre el caso donde MP setea
  // start_date a 30 días por default cuando creamos el plan sin start_date.
  let forcedCharge = false;
  if (pre.status === "authorized" && approvedPayments.length === 0 && !sub.sync_force_attempted) {
    try {
      // Intentar adelantar el next_payment_date a 1 minuto en el futuro.
      const nowPlusOne = new Date(Date.now() + 60 * 1000).toISOString();
      await mpUpdatePreapproval(merchant.mp_access_token, pre.id, {
        auto_recurring: { ...pre.auto_recurring, start_date: nowPlusOne },
      });
      forcedCharge = true;
      // Marcamos en el sub que ya intentamos, para no spamear MP en cada sync.
      await subRef.update({ sync_force_attempted: true, sync_force_at: new Date().toISOString() });
    } catch (e) {
      console.warn(`[sync] no pude forzar primer cobro: ${e.message}`);
    }
  }

  let processed = 0;
  let orderStatusUrl = sub.last_shopify_order_status_url || null;
  const shopifyOrders = Array.from(sub.shopify_orders || []);
  let wasFirstCharge = !sub.last_charge_at;
  // Acumulamos errores de Shopify para devolverlos al caller — útil cuando el
  // pago se procesa OK pero la orden Shopify falla (DNI inválido, variant
  // borrado, etc). El sub queda active pero hay que arreglar y reintentar.
  const shopifyErrors = [];

  for (let idx = 0; idx < approvedPayments.length; idx++) {
    const payment = approvedPayments[idx];
    const chargeNumber = (sub.shopify_orders || []).length + idx + 1;

    // Idempotencia REAL: usamos `preapproval_id-chargeNumber` como ID del
    // charge en Firestore. Esto garantiza que el webhook (con payment real),
    // el cron (con pseudo summarized), y el polling de CheckoutSuccess (todos
    // diferentes triggers) creen el MISMO chargeRef — entonces el chequeo
    // de "ya existe" funciona y no se duplica la orden Shopify.
    const chargeKey = `${pre.id}-${chargeNumber}`;
    const chargeRef = merchantRef.collection("charges").doc(chargeKey);
    const existingCharge = await chargeRef.get();
    // Re-intentamos si el charge existe pero NO tiene shopify_order_id —
    // significa que el cobro se procesó OK pero la creación de orden Shopify
    // falló antes. Si ya tiene order_id, idempotente: skip.
    if (existingCharge.exists && existingCharge.data().shopify_order_id) continue;
    // También skip si OTRO charge tiene el mismo mp_payment_id ya procesado
    // (defensa adicional contra duplicación cross-key).
    if (payment.id) {
      const dup = await merchantRef.collection("charges")
        .where("mp_payment_id", "==", String(payment.id))
        .limit(1).get();
      if (!dup.empty && dup.docs[0].data().shopify_order_id) continue;
    }

    // Crear orden Shopify si tenemos todo
    let shopifyOrderId = null;
    let thisOrderStatusUrl = null;
    let shopifyError = null;
    // Validación estricta de address — Shopify acepta orden sin address pero
    // queda sin shipping. Mejor NO crear la orden si falta address1 + city,
    // así el merchant no tiene órdenes rotas y puede arreglar/recrear el sub.
    const addrOk = sub.shipping_address?.address1 && sub.shipping_address?.city;
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
        const itemQty = sub.quantity || sub.plan_snapshot?.units_per_shipment || 1;
        const order = await shCreatePaidOrder(merchant.shopify_shop, merchant.shopify_token, {
          customer_id: customer.id,
          line_items: [{ variant_id: sub.plan_snapshot.shopify_variant_id, quantity: itemQty }],
          shipping_address: toShopifyAddress(sub.shipping_address, sub.customer_name, sub.customer_phone),
          subscriber_id: subscriberId,
          plan_id: sub.plan_id,
          charge_number: chargeNumber,
          mp_payment_id: payment.id,
          total_price: payment.transaction_amount,
          shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
          shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
          tax_id: sub.customer_tax_id || null,
          tax_id_kind: sub.customer_tax_id_kind || "DNI",
        });
        shopifyOrderId = order.id;
        thisOrderStatusUrl = order.order_status_url || null;
      } catch (e) {
        shopifyError = e.message;
        console.error("[sync] error creando orden Shopify:", e.message);
      }
    } else {
      const missing = [];
      if (!merchant.shopify_token) missing.push("shopify_token");
      if (!merchant.shopify_shop) missing.push("shopify_shop");
      if (!sub.shipping_address?.address1) missing.push("shipping_address.address1");
      if (!sub.shipping_address?.city) missing.push("shipping_address.city");
      if (!sub.plan_snapshot?.shopify_variant_id) missing.push("plan_snapshot.shopify_variant_id");
      shopifyError = `Faltan datos: ${missing.join(", ")}`;
    }
    if (shopifyError) shopifyErrors.push(shopifyError);

    await chargeRef.set({
      subscriber_id: subscriberId,
      mp_payment_id: payment.id,
      amount_ars: payment.transaction_amount,
      status: payment.status,
      shopify_order_id: shopifyOrderId,
      shopify_order_status_url: thisOrderStatusUrl,
      error: shopifyError,
      created_at: new Date().toISOString(),
    });
    if (shopifyOrderId) shopifyOrders.push(shopifyOrderId);
    if (thisOrderStatusUrl) orderStatusUrl = thisOrderStatusUrl;
    processed += 1;
  }

  // Definir status final del subscriber según resultado.
  // - cancelled local → preservar (no pisar)
  // - hay payments approved → "active" (sub real con cobro confirmado)
  // - MP marca preapproval paused → "paused"
  // - MP marca preapproval cancelled → "cancelled"
  // - resto (authorized sin payments, pending, etc) → "pending"
  if (sub.status !== "cancelled") {
    if (approvedPayments.length > 0) {
      updates.status = "active";
    } else if (pre.status === "paused") {
      updates.status = "paused";
    } else if (pre.status === "cancelled") {
      updates.status = "cancelled";
    } else {
      updates.status = "pending";
    }
  }
  if (approvedPayments.length > 0) {
    updates.last_charge_at = new Date().toISOString();
    updates.shopify_orders = shopifyOrders;
    if (orderStatusUrl) updates.last_shopify_order_status_url = orderStatusUrl;
  }
  await subRef.update(updates);

  // Email de activación (solo en el primer charge procesado y si Resend está)
  if (wasFirstCharge && processed > 0 && sub.customer_email) {
    const portalUrl = sub.portal_token
      ? `${process.env.APP_BASE_URL}/#/portal?token=${encodeURIComponent(sub.portal_token)}`
      : `${process.env.APP_BASE_URL}/#/portal`;
    try {
      await emailSubscriptionActivated({
        to: sub.customer_email,
        customerName: sub.customer_name,
        productTitle: sub.plan_snapshot?.product_title || "Suscripción",
        frequencyDays: sub.plan_snapshot?.frequency_days || 30,
        amount: sub.plan_snapshot?.total_per_charge_ars || approvedPayments[0]?.transaction_amount || 0,
        portalUrl,
      });
    } catch (e) {
      console.warn("[sync] email activación falló:", e.message);
    }
  }

  return {
    status: updates.status || sub.status || "unknown",
    mp_preapproval_id: pre.id,
    mp_preapproval_status: pre.status,
    payments_found: allPayments.length,
    payments_approved: approvedPayments.length,
    forced_charge: forcedCharge,
    shopify_order_status_url: orderStatusUrl,
    charges_processed: processed,
    shopify_errors: shopifyErrors, // [] si todo OK
    shopify_order_id: shopifyOrders[shopifyOrders.length - 1] || null,
  };
}

/**
 * Linkea manualmente un payment_id específico al subscriber y procesa la
 * creación de orden Shopify. Útil cuando MP no indexa bien el payment en
 * /v1/payments/search pero el merchant lo ve en su panel.
 */
export async function linkPaymentToSubscriber(merchantId, subscriberId, paymentId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();
  if (!merchant.mp_access_token) return { status: "error", error: "no_mp_token" };

  const subRef = merchantRef.collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return { status: "error", error: "subscriber_not_found" };
  const sub = subSnap.data();

  // Traer el payment directo por ID — es más confiable que /search.
  let payment;
  try {
    payment = await mpGetPayment(merchant.mp_access_token, paymentId);
  } catch (e) {
    return { status: "error", error: `MP /v1/payments/${paymentId}: ${e.message}` };
  }
  if (!payment?.id) return { status: "error", error: "payment_not_found_in_mp" };
  if (payment.status !== "approved") return { status: "error", error: `payment_status=${payment.status} (no approved)` };

  // Idempotencia: si ya existe charge con este payment_id, no duplicamos orden Shopify.
  const chargeRef = merchantRef.collection("charges").doc(String(payment.id));
  const existingCharge = await chargeRef.get();
  if (existingCharge.exists && existingCharge.data().shopify_order_id) {
    return { status: "already_linked", shopify_order_id: existingCharge.data().shopify_order_id };
  }

  let shopifyOrderId = null;
  let orderStatusUrl = null;
  let shopifyError = null;

  if (merchant.shopify_token && merchant.shopify_shop && sub.shipping_address && sub.plan_snapshot?.shopify_variant_id) {
    try {
      const customer = await shFindOrCreateCustomer(merchant.shopify_shop, merchant.shopify_token, {
        email: sub.customer_email,
        first_name: (sub.customer_name || "").split(" ")[0] || "",
        last_name: (sub.customer_name || "").split(" ").slice(1).join(" ") || "",
        phone: sub.customer_phone,
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
        charge_number: (sub.shopify_orders || []).length + 1,
        mp_payment_id: payment.id,
        total_price: payment.transaction_amount,
        shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
        shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
      });
      shopifyOrderId = order.id;
      orderStatusUrl = order.order_status_url || null;
    } catch (e) {
      shopifyError = e.message;
    }
  } else {
    const missing = [];
    if (!merchant.shopify_token) missing.push("shopify_token");
    if (!merchant.shopify_shop) missing.push("shopify_shop");
    if (!sub.shipping_address) missing.push("shipping_address");
    if (!sub.plan_snapshot?.shopify_variant_id) missing.push("plan_snapshot.shopify_variant_id");
    shopifyError = `Faltan datos: ${missing.join(", ")}`;
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

  const update = {
    status: sub.status === "cancelled" ? "cancelled" : "active",
    last_charge_at: new Date().toISOString(),
    shopify_orders: [...(sub.shopify_orders || []), shopifyOrderId].filter(Boolean),
    updated_at: new Date().toISOString(),
  };
  if (orderStatusUrl) update.last_shopify_order_status_url = orderStatusUrl;
  await subRef.update(update);

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
 * Reusa toda la lógica de creación de orden Shopify (customer, shipping,
 * facturación, tags, DNI en company, idempotencia por chargeKey).
 */
export async function simulateNextCharge(merchantId, subscriberId) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return { status: "error", error: "merchant_not_found" };
  const merchant = merchantSnap.data();

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
  let shopifyOrderId = null;
  let orderStatusUrl = null;
  let shopifyError = null;

  const addrOk = sub.shipping_address?.address1 && sub.shipping_address?.city;
  if (merchant.shopify_token && merchant.shopify_shop && addrOk && sub.plan_snapshot?.shopify_variant_id) {
    try {
      const customer = await shFindOrCreateCustomer(merchant.shopify_shop, merchant.shopify_token, {
        email: sub.customer_email,
        first_name: (sub.customer_name || "").split(" ")[0] || "",
        last_name: (sub.customer_name || "").split(" ").slice(1).join(" ") || "",
        phone: sub.customer_phone,
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
        charge_number: chargeNumber,
        mp_payment_id: `SIM-${Date.now()}`,
        total_price: amount,
        shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
        shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
      });
      shopifyOrderId = order.id;
      orderStatusUrl = order.order_status_url || null;
    } catch (e) {
      shopifyError = e.message;
    }
  } else {
    shopifyError = "Faltan datos del sub (address o variant)";
  }

  await chargeRef.set({
    subscriber_id: subscriberId,
    mp_payment_id: `SIM-${Date.now()}`,
    amount_ars: amount,
    status: "approved",
    shopify_order_id: shopifyOrderId,
    shopify_order_status_url: orderStatusUrl,
    error: shopifyError,
    simulated: true,
    charge_number: chargeNumber,
    created_at: new Date().toISOString(),
  });

  if (shopifyOrderId) {
    await subRef.update({
      last_charge_at: new Date().toISOString(),
      shopify_orders: [...(sub.shopify_orders || []), shopifyOrderId],
      last_shopify_order_status_url: orderStatusUrl,
      updated_at: new Date().toISOString(),
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

function toShopifyAddress(addr, name, phone) {
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
