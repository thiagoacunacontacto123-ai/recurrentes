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
import { mpCreatePreapproval, mpCreatePreapprovalPlan } from "../_lib/mp.js";
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

  const { merchant_id, plan_id, customer, shipping_address, quantity, shipping_method, frequency_days, base_price, sub_discount, discount_code } = req.body || {};
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

  // ── Código de descuento (opcional) ────────────────────────────────────────
  // El cliente puede ingresar un código en el checkout (ej. HOLA5). Los códigos
  // los define el comerciante en su cuenta (merchant.discount_codes). Validamos
  // SIEMPRE server-side (no confiamos en el cliente) y aplicamos sobre el subtotal
  // del producto (no sobre el envío). Aplica a TODOS los cobros (queda en el monto
  // del preapproval de MP). Si el código no existe/está inactivo, se ignora.
  let discountCodeApplied = null, discountCodePct = 0;
  const rawCode = String(discount_code || "").trim().toUpperCase();
  if (rawCode) {
    const codes = Array.isArray(merchant.discount_codes) ? merchant.discount_codes : [];
    const hit = codes.find(c => String(c.code || "").trim().toUpperCase() === rawCode && c.active !== false);
    if (hit) {
      const type = hit.type || "percent";
      if (type === "percent") {
        const pct = Math.max(0, Math.min(90, parseFloat(hit.value) || 0));
        if (pct > 0) { discountCodePct = pct; subtotal = Math.round(subtotal * (1 - pct / 100)); }
      } else if (type === "fixed") {
        const off = Math.max(0, Math.round(parseFloat(hit.value) || 0));
        subtotal = Math.max(0, subtotal - off);
      }
      discountCodeApplied = rawCode;
    }
  }

  // Envío. Si el checkout mandó un método elegido (shipping_method, traído de los
  // envíos configurados en Shopify), se usa ESE precio y nombre. Si no, se cae al
  // envío del plan (fijo + regla de envío gratis desde $X) — compat hacia atrás.
  const freeShippingFrom = plan.free_shipping_from_ars || 0;
  let shippingCost, shippingName, shippingCode = "";
  if (shipping_method && typeof shipping_method === "object" && shipping_method.name) {
    shippingCost = Math.max(0, Math.round(Number(shipping_method.price) || 0));
    // Nombre EXACTO de la tarifa (hasta 250 = límite de Shopify). Las apps de
    // envío como Envialo matchean el método/sucursal por el nombre + code exacto;
    // si lo cortábamos a 60 no lo reconocían. Guardamos también el code original.
    shippingName = String(shipping_method.name).slice(0, 250);
    shippingCode = String(shipping_method.code || "").slice(0, 250);
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
      shipping_method_code: shippingCode,
      qty_discount_pct: qtyDiscountPct,
      discount_code: discountCodeApplied,
      discount_code_pct: discountCodePct,
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
  // ── Flujo de PLAN (preapproval_plan) — MP pide el mail en SU pantalla ───────
  // MP no permite tener "dinero en cuenta" (solo lo da el preapproval directo) Y
  // a la vez liberar el mail (el directo EXIGE payer_email y obliga a que coincida
  // → "tu email no coincide con la suscripción"). Comprobado: MP rechaza el
  // preapproval sin payer_email. Como muchos clientes no recuerdan el mail de su
  // cuenta MP o pagan con la de otra persona, priorizamos que TODOS puedan pagar:
  // en el flujo de plan MP pide el login en su pantalla y toma el mail de esa
  // cuenta. El mail del checkout queda SOLO para seguimiento (orden Shopify +
  // emails), NO viaja a MP. Costo: el checkout de plan no ofrece dinero en cuenta
  // (queda tarjeta crédito/débito), que igual es lo confiable para lo recurrente.
  // El monto ya viene multiplicado por qty → un plan ad-hoc por sub escala bien.
  // external_reference se propaga al preapproval que MP crea al confirmar, así el
  // sync/webhook resuelven el subscriber (primer cobro: polling de CheckoutSuccess).
  const planBodyBase = {
    reason: `${plan.product_title} × ${finalQty} — cada ${freqDays} días`,
    auto_recurring: {
      frequency: freqDays,
      frequency_type: "days",
      transaction_amount: totalPerCharge,
      currency_id: "ARS",
    },
    back_url: backUrl,
    ...(notificationUrl ? { notification_url: notificationUrl } : {}),
  };

  // Por defecto el checkout de plan sale SOLO crédito. Intentamos habilitar la
  // mayor cantidad de métodos con payment_methods_allowed, en CASCADA de más a
  // menos inclusivo: 1) crédito+débito+dinero en cuenta, 2) crédito+débito,
  // 3) sin restricción (crédito). Nos quedamos con el PRIMERO que MP acepte, así
  // sumamos dinero en cuenta si MP lo permite sin arriesgar perder débito. (MP
  // suele NO permitir dinero en cuenta para lo recurrente porque no puede
  // auto-debitar un saldo; si lo rechaza, cae solo a la opción siguiente.)
  const pmaAttempts = [
    { payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "account_money" }], payment_methods: [] },
    { payment_types: [{ id: "credit_card" }, { id: "debit_card" }], payment_methods: [] },
    null, // sin restricción
  ];
  let preapprovalPlan = null, lastPlanErr = null;
  for (const pma of pmaAttempts) {
    try {
      preapprovalPlan = await mpCreatePreapprovalPlan(
        merchant.mp_access_token,
        pma ? { ...planBodyBase, payment_methods_allowed: pma } : planBodyBase
      );
      break;
    } catch (e) { lastPlanErr = e; }
  }
  if (!preapprovalPlan) {
    await subRef.update({ status: "error", error: lastPlanErr?.message || "MP plan" });
    return res.status(502).json({ error: `MP: ${lastPlanErr?.message || "no se pudo crear el plan"}` });
  }
  if (!preapprovalPlan?.id) {
    await subRef.update({ status: "error", error: "MP no devolvió el plan" });
    return res.status(502).json({ error: "MP no devolvió el link de pago" });
  }

  // URL del checkout del plan. NO adjuntamos payer_email → MP usa el mail de la
  // cuenta logueada del cliente. external_reference linkea el preapproval al sub.
  const planBase = preapprovalPlan.init_point
    || `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${encodeURIComponent(preapprovalPlan.id)}`;
  const checkoutUrl = planBase + (planBase.indexOf("?") >= 0 ? "&" : "?")
    + "external_reference=" + encodeURIComponent(`${merchant_id}:${subscriberId}`);

  await subRef.update({
    mp_preapproval_plan_id: preapprovalPlan.id,
    mp_init_point: checkoutUrl,
    portal_token: portalToken,
  });

  // NOTA: el "InitiateCheckout" (pago iniciado) ahora se dispara del lado del
  // navegador APENAS CARGA el checkout (fbq en widget.js), no acá al tocar Pagar,
  // porque el evento correcto es "llegó al checkout". El "Purchase" se sigue
  // disparando server-side (sync/webhook) cuando MP confirma el cobro.

  return res.json({
    ok: true,
    subscriber_id: subscriberId,
    init_point: checkoutUrl,
    preapproval_plan_id: preapprovalPlan.id,
    portal_token: portalToken,
  });
}

