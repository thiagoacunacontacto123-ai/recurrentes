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
import { mpCreatePreapproval } from "../_lib/mp.js";
import { generatePortalToken, verifyPortalToken } from "../public.js";
import { syncSubscriber } from "../_lib/sync.js";
import { sendMetaInitiateCheckout } from "../_lib/meta.js";

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

  const { merchant_id, plan_id, customer, shipping_address, quantity, shipping_method, frequency_days, base_price, sub_discount } = req.body || {};
  if (!merchant_id || !plan_id) return res.status(400).json({ error: "Faltan merchant_id o plan_id" });
  if (!customer?.email) return res.status(400).json({ error: "Falta customer.email" });

  // VALIDACIÓN ESTRICTA — bloqueamos avance a MP si falta cualquier dato de
  // contacto/dirección. Esto previene que un cliente complete el pago y
  // después la orden Shopify quede sin dirección (caso real: orden #4319 de
  // Alberto perez 7-jun-2026). El widget ya valida en JS, pero si el cliente
  // tiene cache vieja del widget, JS bloqueado, o entra por un flow raro,
  // necesitamos defensa server-side igual.
  const customerName = String(customer.name || "").trim();
  const customerPhone = String(customer.phone || "").trim();
  if (!customerName) return res.status(400).json({ error: "Falta nombre del cliente" });
  if (!customerPhone) return res.status(400).json({ error: "Falta teléfono del cliente" });

  const addr = shipping_address || {};
  const addrMissing = [];
  if (!String(addr.address1 || "").trim()) addrMissing.push("calle + número");
  if (!String(addr.city || "").trim()) addrMissing.push("ciudad");
  if (!String(addr.province || "").trim()) addrMissing.push("provincia");
  if (!String(addr.zip || "").trim()) addrMissing.push("código postal");
  if (addrMissing.length > 0) {
    return res.status(400).json({
      error: `Falta dirección de envío. Cargá: ${addrMissing.join(", ")}. No se puede procesar el pago sin estos datos.`,
    });
  }

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

  // Frecuencia efectiva. El bundle puede mandar frequency_days (ej. "N potes cada
  // N×2 meses" → 60·qty días). Si viene y es válida, MANDA sobre la del plan.
  // Rango 1..365 para no romper el preapproval de MP.
  const freqParsed = parseInt(frequency_days);
  const freqDays = (Number.isFinite(freqParsed) && freqParsed >= 1 && freqParsed <= 365)
    ? freqParsed
    : (plan.frequency_days || 30);

  // ── Precio de la suscripción ──────────────────────────────────────────
  // Modelo BUNDLE (el que usa Lumina): el bundle manda el precio del PACK
  // (compra única) en `base_price` + el % de descuento de suscripción en
  // `sub_discount`. La suscripción cobra pack × (1 − descuento). Descuento fijo
  // por bundle (ej. 15% en 1/2/3 potes), sin depender del precio por unidad.
  //   → sub_discount: si no viene, usa plan.discount_pct.
  // Modelo por-unidad (legacy / sin bundle): precio_1_pote × cantidad × tier.
  const basePrice = Math.round(parseFloat(base_price) || 0);
  const subOffParsed = parseFloat(sub_discount);
  const subOff = Number.isFinite(subOffParsed) ? Math.max(0, Math.min(90, subOffParsed)) : (parseFloat(plan.discount_pct) || 0);
  let subtotal, qtyDiscountPct;
  if (basePrice > 0) {
    qtyDiscountPct = subOff;
    subtotal = Math.round(basePrice * (1 - subOff / 100));
  } else {
    const tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
    qtyDiscountPct = 0; let _bestMin = -1;
    for (const t of tiers) { const mq = parseInt(t && t.min_qty) || 0; if (finalQty >= mq && mq > _bestMin) { _bestMin = mq; qtyDiscountPct = parseFloat(t.discount_pct) || 0; } }
    subtotal = Math.round(unitPrice * finalQty * (1 - qtyDiscountPct / 100));
  }

  // Envío. Si el checkout mandó un método elegido (shipping_method, traído de los
  // envíos configurados en Shopify), se usa ESE precio y nombre. Si no, se cae al
  // envío del plan (fijo + regla de envío gratis desde $X) — compat hacia atrás.
  const freeShippingFrom = plan.free_shipping_from_ars || 0;
  let shippingCost, shippingName;
  if (shipping_method && typeof shipping_method === "object" && shipping_method.name) {
    shippingCost = Math.max(0, Math.round(Number(shipping_method.price) || 0));
    shippingName = String(shipping_method.name).slice(0, 60);
  } else {
    const shippingPrice = plan.shipping_price_ars || 0;
    shippingCost = (freeShippingFrom > 0 && subtotal >= freeShippingFrom) ? 0 : shippingPrice;
    shippingName = plan.shipping_method_name || "Envío a domicilio";
  }

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
    // Shipping address sanitizada — usamos el objeto validado arriba (addr),
    // garantizando que address1/city/province/zip nunca sean undefined o ""
    // (la validación previa rechazaría el request). first_name/last_name/phone
    // los rellenamos del nombre/teléfono del customer para que la orden
    // Shopify quede con todos los campos.
    shipping_address: {
      address1:   String(addr.address1).trim(),
      address2:   String(addr.address2 || "").trim(),
      city:       String(addr.city).trim(),
      province:   String(addr.province).trim(),
      zip:        String(addr.zip).trim(),
      country:    String(addr.country || "Argentina").trim(),
      first_name: customerName.split(" ")[0] || "",
      last_name:  customerName.split(" ").slice(1).join(" ") || "",
      phone:      customerPhone,
    },
    plan_id,
    quantity: finalQty,
    plan_snapshot: {
      shopify_variant_id: plan.shopify_variant_id,
      shopify_product_id: plan.shopify_product_id,
      product_title: plan.product_title,
      frequency_days: freqDays,
      subscription_price_ars: unitPrice,
      units_per_shipment: finalQty,
      // Desglose snapshot — los uso para mostrar al cliente y para crear orden
      // Shopify con shipping_lines acorde. Si el plan cambia después, este
      // snapshot preserva el cobro original del subscriber.
      subtotal_ars: subtotal,
      shipping_price_ars: shippingCost,
      shipping_method_name: shippingName,
      qty_discount_pct: qtyDiscountPct,
      total_per_charge_ars: totalPerCharge,
    },
    status: "pending",
    created_at: new Date().toISOString(),
    shopify_orders: [],
    // Datos de atribución de Meta capturados en el navegador (fbc/fbp/UA/URL).
    // Se usan en el evento Purchase de CAPI para atribuir la venta al anuncio.
    fb_data: (req.body.fb && typeof req.body.fb === "object") ? {
      fbc: String(req.body.fb.fbc || "").slice(0, 255),
      fbp: String(req.body.fb.fbp || "").slice(0, 255),
      event_source_url: String(req.body.fb.event_source_url || "").slice(0, 500),
      user_agent: String(req.body.fb.user_agent || "").slice(0, 500),
    } : null,
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

  // Suscripción DIRECTA (preapproval, no preapproval_plan). El init_point de este
  // flujo (redirect) muestra TODOS los métodos de pago: tarjeta de crédito,
  // tarjeta de DÉBITO y DINERO EN CUENTA — y redirige SOLO a back_url al terminar
  // (la página de agradecimiento). A propósito NO restringimos payment_methods_allowed
  // para habilitar débito + saldo. (Ojo: con débito/saldo la renovación puede fallar
  // si no hay fondos, igual que una tarjeta rechazada — es la elección del cliente.)
  const preapprovalBody = {
    reason: `${plan.product_title} × ${finalQty} — cada ${freqDays} días`,
    external_reference: `${merchant_id}:${subscriberId}`,
    payer_email: customer.email,
    auto_recurring: {
      frequency: freqDays,
      frequency_type: "days",
      start_date: startDate,
      transaction_amount: totalPerCharge,
      currency_id: "ARS",
    },
    back_url: backUrl,
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    status: "pending",
  };

  let preapproval;
  try {
    preapproval = await mpCreatePreapproval(merchant.mp_access_token, preapprovalBody);
  } catch (e) {
    await subRef.update({ status: "error", error: e.message });
    return res.status(502).json({ error: `MP: ${e.message}` });
  }

  const checkoutUrl = preapproval.init_point;
  if (!checkoutUrl) {
    await subRef.update({ status: "error", error: "MP no devolvió init_point" });
    return res.status(502).json({ error: "MP no devolvió el link de pago" });
  }

  await subRef.update({
    mp_preapproval_id: preapproval.id,
    mp_init_point: checkoutUrl,
    portal_token: portalToken,
  });

  // Meta CAPI — "InitiateCheckout" (pago iniciado): el cliente completó el checkout
  // y se va a MP a pagar. Best-effort (no rompe el flujo). El "Purchase" lo dispara
  // sync.js cuando MP confirma el cobro, con el mismo fb_data guardado en el sub.
  if (merchant.meta_pixel_id && merchant.meta_capi_token) {
    try {
      const fb = (req.body.fb && typeof req.body.fb === "object") ? req.body.fb : {};
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || undefined;
      await sendMetaInitiateCheckout({
        pixelId: merchant.meta_pixel_id, token: merchant.meta_capi_token,
        value: totalPerCharge, currency: "ARS",
        email: customer.email, phone: customerPhone,
        firstName: customerName.split(" ")[0] || "", lastName: customerName.split(" ").slice(1).join(" ") || "",
        city: addr.city, zip: addr.zip,
        eventId: `${subscriberId}-ic`,
        eventSourceUrl: fb.event_source_url || undefined,
        fbc: fb.fbc || undefined, fbp: fb.fbp || undefined,
        clientIp: ip, clientUa: fb.user_agent || req.headers["user-agent"] || undefined,
      });
    } catch (_) {}
  }

  return res.json({
    ok: true,
    subscriber_id: subscriberId,
    init_point: checkoutUrl,
    preapproval_id: preapproval.id,
    portal_token: portalToken,
  });
}

