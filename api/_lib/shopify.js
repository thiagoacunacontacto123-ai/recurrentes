// Helpers Shopify Admin API. Cada merchant tiene su `shopify_shop` (myshopify
// domain) + `shopify_token` (access token de la app instalada).

async function call(shop, token, method, path, body = null) {
  const url = `https://${shop}/admin/api/2024-10${path}`;
  const r = await fetch(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    // Reportamos el error de Shopify lo más detallado posible — incluye el
    // objeto completo (Shopify devuelve un map de campos → mensajes).
    const msg = data.errors || data.error || `HTTP ${r.status}`;
    const detail = typeof msg === "string" ? msg : JSON.stringify(msg);
    throw new Error(`Shopify ${method} ${path}: ${detail}`);
  }
  return data;
}

// Lista de productos con sus variantes — usado en el plan creator para que
// el merchant elija cuál convertir en suscribible. Paginamos hasta 250.
export async function shListProducts(shop, token) {
  const data = await call(shop, token, "GET", "/products.json?limit=250&fields=id,title,handle,image,variants,status");
  return data.products || [];
}

// Métodos de envío configurados en la tienda (los mismos de la venta común).
// Lee las shipping_zones y devuelve las tarifas que aplican a Argentina (o a la
// provincia pedida). Solo trae las tarifas EXPUESTAS por API (price_based y
// weight_based, o sea las fijas/por-monto que el merchant cargó a mano). Las
// tarifas calculadas en tiempo real por una app de correo (carrier service, ej.
// los puntos HOP dinámicos de Andreani) NO vienen acá — para esas el checkout
// cae al envío del plan. `subtotal` filtra las tarifas por monto (envío gratis
// desde $X) para no ofrecer una tarifa que no aplica a ese carrito.
export async function shGetShippingRates(shop, token, { province = "", subtotal = 0 } = {}) {
  let data;
  try { data = await call(shop, token, "GET", "/shipping_zones.json"); }
  catch (_) { return []; }
  const zones = data.shipping_zones || [];
  const provNorm = String(province || "").trim().toLowerCase();
  const out = [];
  const seen = new Set();
  for (const z of zones) {
    const countries = z.countries || [];
    const cubreAR = countries.some(c => {
      const code = String(c.code || "").toUpperCase();
      const name = String(c.name || "").toLowerCase();
      const esAR = code === "AR" || code === "*" || name.includes("argentina");
      if (!esAR) return false;
      // Si la zona limita por provincia y pedimos una, respetarla.
      if (provNorm && Array.isArray(c.provinces) && c.provinces.length) {
        return c.provinces.some(p => String(p.name || "").toLowerCase() === provNorm || String(p.code || "").toLowerCase() === provNorm);
      }
      return true;
    });
    if (!cubreAR) continue;
    const push = (r, kind) => {
      const price = Number(r.price || 0);
      const min = r.min_order_subtotal != null ? Number(r.min_order_subtotal) : null;
      const max = r.max_order_subtotal != null ? Number(r.max_order_subtotal) : null;
      if (kind === "price" && subtotal > 0) {
        if (min != null && subtotal < min) return;
        if (max != null && subtotal > max) return;
      }
      const name = String(r.name || "Envío").trim();
      const key = name + "|" + price;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ name, price, free: price === 0 });
    };
    for (const r of (z.price_based_shipping_rates || [])) push(r, "price");
    for (const r of (z.weight_based_shipping_rates || [])) push(r, "weight");
  }
  // Gratis primero, después por precio ascendente.
  out.sort((a, b) => a.price - b.price);
  return out;
}

// Customer find-or-create — antes de crear la orden necesitamos un customer.
// Buscar por email primero; si no existe, crear con datos minimos. La
// dirección NO se setea en el customer create (Shopify a veces rechaza
// `addresses` por validaciones de province/country) — la dirección de envío
// va directa en la order.
//
// tax_id (DNI o CUIL/CUIT) se guarda como TAG ("DNI:12345678" o "CUIT:20...")
// para que el merchant pueda buscar clientes por documento desde Shopify Admin
// y exportarlo a facturadores.
export async function shFindOrCreateCustomer(shop, token, { email, first_name, last_name, phone, tax_id, tax_id_kind }) {
  const taxTag = tax_id ? `${tax_id_kind || "DNI"}:${tax_id}` : null;
  try {
    const search = await call(shop, token, "GET", `/customers/search.json?query=email:${encodeURIComponent(email)}`);
    if (search.customers?.length) {
      const existing = search.customers[0];
      // SIEMPRE actualizamos nombre + phone si vino info distinta — la última
      // suscripción es el dato más confiable. El nombre del customer Shopify
      // se usa también para shipping/billing address y la factura.
      const updates = { id: existing.id };
      let needsUpdate = false;
      if (first_name && first_name !== existing.first_name) { updates.first_name = first_name; needsUpdate = true; }
      if (last_name && last_name !== existing.last_name)    { updates.last_name = last_name; needsUpdate = true; }
      if (phone && phone !== existing.phone)                  { updates.phone = phone; needsUpdate = true; }

      if (taxTag) {
        const currentTags = (existing.tags || "").split(",").map(t => t.trim()).filter(Boolean);
        const hasTaxTag = currentTags.some(t => t.startsWith("DNI:") || t.startsWith("CUIT:"));
        if (!hasTaxTag) {
          updates.tags = [...currentTags, "recurrentes-subscriber", taxTag].filter((v, i, a) => a.indexOf(v) === i).join(", ");
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        try {
          const updated = await call(shop, token, "PUT", `/customers/${existing.id}.json`, { customer: updates });
          return updated.customer;
        } catch (_) { /* si falla update, devolvemos el existente igual */ }
      }
      return existing;
    }
  } catch (_) {}
  const tags = ["recurrentes-subscriber", taxTag].filter(Boolean).join(", ");
  // company en el customer principal — algunos themes / facturadores leen
  // de acá el identificador fiscal del cliente.
  const companyTax = tax_id ? `${tax_id_kind || "DNI"} ${tax_id}` : null;
  const customerBody = {
    email,
    first_name: first_name || "",
    last_name: last_name || "",
    phone: phone || null,
    tags,
    ...(companyTax ? { note: `Identificador fiscal: ${companyTax}` } : {}),
  };
  try {
    const created = await call(shop, token, "POST", "/customers.json", { customer: customerBody });
    return created.customer;
  } catch (e) {
    // Shopify rechaza algunos teléfonos (formato AR viejo con "15", números raros)
    // con "phone is invalid" → sin esto, la orden NUNCA se creaba aunque el cliente
    // haya PAGADO. El teléfono es opcional en el customer, así que reintentamos SIN
    // teléfono: el cliente + la orden se crean igual (el tel queda en la dirección
    // de envío y en la nota del pedido).
    if (/phone/i.test(e.message)) {
      const created = await call(shop, token, "POST", "/customers.json", { customer: { ...customerBody, phone: null } });
      return created.customer;
    }
    throw e;
  }
}

// Crear orden PAGA con los items del plan. Marcada como `financial_status:
// paid` para que aparezca en el panel del merchant lista para empaquetar.
// note_attributes guarda referencias a Recurrentes (subscriber_id, plan_id,
// charge_number) para trazabilidad.
export async function shCreatePaidOrder(shop, token, params) {
  const {
    customer_id, line_items, shipping_address, billing_address,
    subscriber_id, plan_id, charge_number, mp_payment_id, total_price,
    shipping_price, shipping_method_name, shipping_method_code,
    tax_id, tax_id_kind,
    mp_fee_real, // comisión REAL que cobró MP (fee_details del pago). Se guarda en
                 // la orden para que herramientas de márgenes usen el fee exacto.
  } = params;

  // shipping_lines: Shopify rechaza `source` con valores no estándar. Solo
  // mandamos title + price + code, que es lo que necesita para mostrar bien.
  const shippingTitle = (shipping_method_name || "Envío a domicilio").trim() || "Envío a domicilio";
  const shippingPriceNum = Number(shipping_price || 0);
  const shippingPriceStr = shippingPriceNum.toFixed(2);
  const shippingLines = [{
    title: shippingTitle,
    price: shippingPriceStr,
    // code = el código REAL de la tarifa del carrier (Envialo, etc.) para que la
    // app de envío reconozca el método/sucursal. Fallback al título si no vino.
    code: (shipping_method_code && String(shipping_method_code).trim()) || shippingTitle.slice(0, 50),
  }];

  // CRÍTICO: setear `price` en cada line_item con el precio REAL que cobró MP
  // (no el precio normal del variant). Sin esto Shopify toma el precio del
  // variant catálogo y queda un monto inflado — el merchant termina pagando
  // comisión de Shopify sobre un monto inexistente. Calculamos:
  //   subtotal_items = total_cobrado - envío
  //   price_por_unidad = subtotal_items / sum(quantity de todos los items)
  const totalNum = Number(total_price || 0);
  const subtotalItems = totalNum - shippingPriceNum;
  const totalQty = (line_items || []).reduce((acc, li) => acc + (Number(li.quantity) || 1), 0) || 1;
  const pricePerUnit = subtotalItems / totalQty;

  // GUARD: si los datos son incoherentes (shipping >= total, o pricePerUnit <= 0),
  // ABORTAMOS la creación de orden. Esto evita órdenes basura con $0 producto
  // + shipping inflado, que pueden aparecer cuando el plan_snapshot del sub
  // tiene shipping mal configurado o cuando el simulator usa datos corruptos.
  if (pricePerUnit <= 0 || subtotalItems <= 0) {
    throw new Error(`Datos incoherentes: total=${totalNum}, shipping=${shippingPriceNum}, qty=${totalQty}. pricePerUnit=${pricePerUnit}. Orden NO creada.`);
  }

  const adjustedLineItems = (line_items || []).map(li => ({
    variant_id: li.variant_id,
    quantity: li.quantity,
    price: pricePerUnit.toFixed(2),
  }));

  // Sanitizar shipping_address: aseguramos que no se mande con campos
  // ausentes o malformados que Shopify rechazaría.
  //
  // company: usamos este campo para el DNI/CUIT (solo el número, sin prefijo).
  // Shopify lo expone como "company" en la sección Customer + Shipping address
  // del pedido, que es donde los facturadores AR (Afip, Tango, etc) buscan el
  // identificador fiscal. La distinción DNI vs CUIT queda en note_attributes
  // y en el tag del customer ("DNI:12345678" vs "CUIT:20..."), no acá.
  const companyTax = tax_id ? String(tax_id) : "";
  // country_code: Shopify DROPEA toda la shipping_address (la deja null) si el
  // país/provincia vienen como nombre y no puede resolver el código. Mandando
  // country_code="AR" explícito, Shopify acepta la provincia por nombre y guarda
  // la dirección. Se deriva del country (default Argentina → AR).
  const countryRaw = String(shipping_address?.country || "Argentina").trim();
  const countryCode = /^ar$/i.test(countryRaw) || /argentin/i.test(countryRaw) ? "AR" : (countryRaw.length === 2 ? countryRaw.toUpperCase() : "AR");
  const cleanShipping = {
    address1: String(shipping_address?.address1 || "").slice(0, 255),
    address2: String(shipping_address?.address2 || "").slice(0, 255),
    city: String(shipping_address?.city || "").slice(0, 100),
    province: String(shipping_address?.province || "").slice(0, 100),
    country_code: countryCode,
    zip: String(shipping_address?.zip || "").slice(0, 20),
    first_name: String(shipping_address?.first_name || "").slice(0, 50),
    last_name: String(shipping_address?.last_name || "").slice(0, 50),
    phone: String(shipping_address?.phone || "").slice(0, 30),
    company: companyTax,
  };

  const totalPriceStr = String(total_price);

  const body = {
    order: {
      customer: { id: customer_id },
      line_items: adjustedLineItems,
      shipping_address: cleanShipping,
      billing_address: billing_address ? {
        ...cleanShipping, ...billing_address,
      } : cleanShipping,
      shipping_lines: shippingLines,
      financial_status: "paid",
      fulfillment_status: null,
      // Que Shopify mande los mails como en una venta normal:
      //  · send_receipt → mail de CONFIRMACIÓN de compra al crear la orden.
      //  · send_fulfillment_receipt → mail de SEGUIMIENTO cuando se despacha/fulfilla.
      // (El cliente recibe la misma experiencia de mails que una compra común.)
      send_receipt: true,
      send_fulfillment_receipt: true,
      currency: "ARS",
      // Identifica el origen del pedido en Shopify Admin (filtro "Source").
      source_name: "Recurrentes",
      // Tag visible — el merchant filtra fácilmente en Shopify Admin.
      // Si la dirección está vacía sumamos FALTA-DIRECCION para que el
      // merchant pueda filtrar "tag:FALTA-DIRECCION" desde Shopify y
      // cargar las direcciones de esas órdenes desde Recurrentes.
      tags: (cleanShipping.address1 && cleanShipping.city) ? "RECURRENTE" : "RECURRENTE, FALTA-DIRECCION",
      transactions: [{
        kind: "sale",
        status: "success",
        amount: totalPriceStr,
        currency: "ARS",
        // El cobro es real por Mercado Pago (suscripción). Marcamos el gateway
        // como "Mercado Pago" para que herramientas de márgenes (ej. Growith)
        // detecten el método de pago y le apliquen la comisión de MP, no una
        // genérica ni $0.
        gateway: "Mercado Pago",
      }],
      note: `Suscripción Recurrentes · Charge #${charge_number || 1}` + (tax_id ? `\n${tax_id_kind || "DNI"}: ${tax_id}` : ""),
      note_attributes: [
        { name: "recurrentes_subscriber_id", value: String(subscriber_id) },
        { name: "recurrentes_plan_id",       value: String(plan_id) },
        { name: "recurrentes_charge_number", value: String(charge_number || 1) },
        { name: "mp_payment_id",             value: String(mp_payment_id) },
        ...(mp_fee_real != null && isFinite(mp_fee_real) ? [
          { name: "mp_fee_real", value: String(Math.round(mp_fee_real * 100) / 100) },
        ] : []),
        ...(tax_id ? [
          { name: tax_id_kind || "DNI", value: String(tax_id) },
          { name: "tax_id",             value: String(tax_id) },
          { name: "tax_id_kind",        value: String(tax_id_kind || "DNI") },
        ] : []),
      ],
    },
  };
  try {
    const data = await call(shop, token, "POST", "/orders.json", body);
    return data.order;
  } catch (e) {
    // Si Shopify rechaza la orden por el teléfono (formato raro), reintentamos sin
    // teléfono en la dirección — la orden se crea igual (el tel queda en la nota).
    if (/phone/i.test(e.message)) {
      body.order.shipping_address = { ...body.order.shipping_address, phone: "" };
      if (body.order.billing_address) body.order.billing_address = { ...body.order.billing_address, phone: "" };
      const data = await call(shop, token, "POST", "/orders.json", body);
      return data.order;
    }
    throw e;
  }
}
