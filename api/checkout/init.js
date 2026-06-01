// POST /api/checkout/init { merchant_id, plan_id, customer, shipping_address, quantity }
//
// Endpoint PÚBLICO (sin auth) que llama el widget en la storefront del
// comerciante. Crea un `preapproval_plan` ad-hoc en MP con el monto ajustado
// por cantidad, y devuelve la URL del checkout del PLAN (no del preapproval).
//
// ─── ¿Por qué el flow de preapproval_plan y no de preapproval directo? ────
// MP tiene 2 flows para suscripciones:
//
//   A) /checkout/v1/subscription/redirect/{preapproval_id}
//      Lo que usábamos antes. El cliente ve TODOS los métodos (saldo MP,
//      débito, crédito). El filtro `payment_methods_allowed` se ignora.
//
//   B) /subscriptions/checkout?preapproval_plan_id={PLAN_ID}
//      El que usa GreenDog y demás SaaS de suscripciones serias. MP respeta
//      `payment_methods_allowed` del plan, oculta saldo + débito, y el cliente
//      ve solo tarjetas de crédito. Mucho más limpio.
//
// Como cada subscriber puede elegir qty 1-10, creamos un plan ad-hoc por sub
// con el monto ya multiplicado. MP no cobra por plans, así que escala bien.
// El external_reference se propaga del checkout al preapproval que MP crea
// al confirmar, así el webhook puede resolver el subscriber correcto.
import { db } from "../_lib/firebase.js";
import { mpCreatePreapprovalPlan } from "../_lib/mp.js";
import { generatePortalToken, verifyPortalToken } from "../public.js";
import { syncSubscriber } from "../_lib/sync.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // GET /api/checkout/init?sub=<id>&token=<jwt>&payment_id=<id?>
  // Sync público (sin auth Firebase) que CheckoutSuccess llama en polling.
  // Si MP nos dio collection_id en la URL del redirect, lo pasamos como
  // payment_id hint — el sync hace GET directo a /v1/payments/X (más rápido
  // y confiable que search). Si no hay hint, sync hace el flow normal.
  if (req.method === "GET") {
    const subId = String(req.query.sub || "");
    const token = String(req.query.token || "");
    const paymentHint = String(req.query.payment_id || "");
    const payload = verifyPortalToken(token);
    if (!payload || payload.sid !== subId) return res.status(403).json({ error: "Token inválido" });
    try {
      // Si hay payment_id hint, hacemos link directo PRIMERO (más rápido).
      // Si no funciona, caemos al sync normal.
      if (paymentHint) {
        const { linkPaymentToSubscriber } = await import("../_lib/sync.js");
        try {
          const linkResult = await linkPaymentToSubscriber(payload.mid, subId, paymentHint);
          if (linkResult.status === "linked" || linkResult.status === "already_linked") {
            return res.json({ ok: true, ...linkResult });
          }
        } catch (_) { /* fallback al sync normal */ }
      }
      const r = await syncSubscriber(payload.mid, subId);
      return res.json({ ok: true, ...r });
    } catch (e) {
      console.error("[checkout/sync] error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { merchant_id, plan_id, customer, shipping_address, quantity } = req.body || {};
  if (!merchant_id || !plan_id) return res.status(400).json({ error: "Faltan merchant_id o plan_id" });
  if (!customer?.email) return res.status(400).json({ error: "Falta customer.email" });

  // Cantidad de paquetes que eligió el cliente. Capada entre 1 y 10 para
  // evitar abusos / errores. Si no viene, usamos units_per_shipment del plan.
  const qty = Math.max(1, Math.min(10, parseInt(quantity) || 0));

  // Cargar merchant + plan
  const merchantSnap = await db().collection("merchants").doc(merchant_id).get();
  if (!merchantSnap.exists) return res.status(404).json({ error: "Merchant no encontrado" });
  const merchant = merchantSnap.data();
  if (!merchant.mp_access_token) return res.status(400).json({ error: "El comerciante no conectó MP" });

  const planSnap = await db().collection("merchants").doc(merchant_id).collection("plans").doc(plan_id).get();
  if (!planSnap.exists) return res.status(404).json({ error: "Plan no encontrado" });
  const plan = planSnap.data();
  if (!plan.active) return res.status(400).json({ error: "Plan inactivo" });

  // Cantidad final: elección del cliente, o units_per_shipment del plan como default.
  const finalQty = qty || plan.units_per_shipment || 1;
  const unitPrice = plan.subscription_price_ars || 0;

  // Aplicar descuento por cantidad si corresponde. Los tiers están ordenados
  // por min_qty asc — buscamos el último tier cuyo min_qty <= finalQty.
  const tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
  let qtyDiscountPct = 0;
  for (const t of tiers) if (finalQty >= t.min_qty) qtyDiscountPct = t.discount_pct;

  const subtotal = Math.round(unitPrice * finalQty * (1 - qtyDiscountPct / 100));

  // Envío: si subtotal >= free_shipping_from_ars (y >0), gratis. Si no, costo fijo.
  const freeShippingFrom = plan.free_shipping_from_ars || 0;
  const shippingPrice = plan.shipping_price_ars || 0;
  const shippingCost = (freeShippingFrom > 0 && subtotal >= freeShippingFrom) ? 0 : shippingPrice;

  const totalPerCharge = subtotal + shippingCost;

  // Crear subscriber en estado pending. Si el pago no se confirma, queda
  // huérfano hasta limpieza periódica (cron F3).
  const subRef = db().collection("merchants").doc(merchant_id).collection("subscribers").doc();
  const subscriberId = subRef.id;
  // Sanitizar tax_id: solo dígitos. DNI (7-8) o CUIL/CUIT (11). Es obligatorio
  // para facturación AR — lo guardamos en el subscriber + lo pasamos a la
  // orden Shopify (note_attributes + customer tag) cuando se cree.
  const taxIdClean = String(customer.tax_id || "").replace(/[^0-9]/g, "");
  if (!taxIdClean || !(taxIdClean.length === 7 || taxIdClean.length === 8 || taxIdClean.length === 11)) {
    return res.status(400).json({ error: "DNI o CUIL/CUIT inválido (debe ser 7-8 dígitos para DNI, 11 para CUIL/CUIT)" });
  }
  const taxIdKind = taxIdClean.length === 11 ? "CUIT" : "DNI";

  await subRef.set({
    customer_email: customer.email,
    customer_name: customer.name || "",
    customer_phone: customer.phone || "",
    customer_tax_id: taxIdClean,
    customer_tax_id_kind: taxIdKind, // "DNI" | "CUIT"
    shipping_address: shipping_address || null,
    plan_id,
    quantity: finalQty,
    plan_snapshot: {
      shopify_variant_id: plan.shopify_variant_id,
      shopify_product_id: plan.shopify_product_id,
      product_title: plan.product_title,
      frequency_days: plan.frequency_days,
      subscription_price_ars: unitPrice,
      units_per_shipment: finalQty,
      // Desglose snapshot — los uso para mostrar al cliente y para crear orden
      // Shopify con shipping_lines acorde. Si el plan cambia después, este
      // snapshot preserva el cobro original del subscriber.
      subtotal_ars: subtotal,
      shipping_price_ars: shippingCost,
      shipping_method_name: plan.shipping_method_name || "Envío a domicilio",
      qty_discount_pct: qtyDiscountPct,
      total_per_charge_ars: totalPerCharge,
    },
    status: "pending",
    created_at: new Date().toISOString(),
    shopify_orders: [],
  });

  // JWT del portal — vive 365 días, le permite al cliente gestionar la sub
  // (ver detalle, pausar, cancelar) sin loguearse en Firebase Auth. Va en
  // back_url para que CheckoutSuccess pueda linkear al portal directamente.
  const portalToken = generatePortalToken(merchant_id, subscriberId, 365);

  const baseUrl = process.env.APP_BASE_URL || "";
  const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.");
  const backUrl = isLocalhost
    ? `https://recurrentes.app/checkout-success?sub=${subscriberId}`
    : `${baseUrl}/#/checkout-success?sub=${subscriberId}&token=${encodeURIComponent(portalToken)}`;
  // notification_url: a dónde MP nos avisa cuando haya un cobro. Incluimos
  // ?mid=X&sid=Y como query params para que el webhook handler sepa DIRECTO
  // a qué merchant pertenece sin iterar todos los merchants intentando
  // mpGetPayment con cada token (el approach viejo fallaba con MP 404).
  const notificationUrl = isLocalhost
    ? undefined
    : `${baseUrl}/api/mp/webhook?mid=${encodeURIComponent(merchant_id)}&sid=${encodeURIComponent(subscriberId)}`;

  // Crear preapproval_plan AD-HOC en MP, específico para esta sub.
  // payment_methods_allowed: solo credit_card → MP filtra dinero+débito en el
  // checkout. external_reference se hereda al preapproval que MP cree cuando
  // el cliente confirme — el webhook lo usa para resolver subscriber.
  // start_date: 5 segundos EN EL PASADO. MP solo cobra inmediato si start_date
  // ya pasó. Sin start_date (o con start_date futuro) MP calcula
  // "next_payment = ahora + frequency" → ej 30 días para el primer cobro,
  // la sub queda authorized sin payment hasta dentro de 1 mes. Con start_date
  // en el pasado, MP procesa el primer cobro en segundos.
  const startDate = new Date(Date.now() - 5 * 1000).toISOString();

  const planBody = {
    reason: `${plan.product_title} × ${finalQty} — cada ${plan.frequency_days} días`,
    auto_recurring: {
      frequency: plan.frequency_days,
      frequency_type: "days",
      start_date: startDate,
      transaction_amount: totalPerCharge,
      currency_id: "ARS",
    },
    back_url: backUrl,
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    external_reference: `${merchant_id}:${subscriberId}`,
    payment_methods_allowed: {
      payment_types: [{ id: "credit_card" }],
      payment_methods: [],
    },
  };

  let adhocPlan;
  try {
    adhocPlan = await mpCreatePreapprovalPlan(merchant.mp_access_token, planBody);
  } catch (e) {
    await subRef.update({ status: "error", error: e.message });
    return res.status(502).json({ error: `MP: ${e.message}` });
  }

  // Construir URL del checkout del plan. Es la URL pública de MP que respeta
  // payment_methods_allowed (a diferencia del init_point del preapproval).
  // Pasamos external_reference, payer_email y back_url por query para que MP
  // los herede al preapproval que cree al confirmar.
  const checkoutUrl = `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${encodeURIComponent(adhocPlan.id)}&external_reference=${encodeURIComponent(`${merchant_id}:${subscriberId}`)}&payer_email=${encodeURIComponent(customer.email)}&back_url=${encodeURIComponent(backUrl)}`;

  await subRef.update({
    mp_adhoc_plan_id: adhocPlan.id,
    mp_init_point: checkoutUrl,
    portal_token: portalToken,
  });

  return res.json({
    ok: true,
    subscriber_id: subscriberId,
    init_point: checkoutUrl,
    adhoc_plan_id: adhocPlan.id,
    portal_token: portalToken,
  });
}

