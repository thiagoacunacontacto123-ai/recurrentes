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
  const created = await call(shop, token, "POST", "/customers.json", {
    customer: {
      email,
      first_name: first_name || "",
      last_name: last_name || "",
      phone: phone || null,
      tags,
      ...(companyTax ? { note: `Identificador fiscal: ${companyTax}` } : {}),
    },
  });
  return created.customer;
}

// Crear orden PAGA con los items del plan. Marcada como `financial_status:
// paid` para que aparezca en el panel del merchant lista para empaquetar.
// note_attributes guarda referencias a Recurrentes (subscriber_id, plan_id,
// charge_number) para trazabilidad.
export async function shCreatePaidOrder(shop, token, params) {
  const {
    customer_id, line_items, shipping_address, billing_address,
    subscriber_id, plan_id, charge_number, mp_payment_id, total_price,
    shipping_price, shipping_method_name,
    tax_id, tax_id_kind,
  } = params;

  // shipping_lines: Shopify rechaza `source` con valores no estándar. Solo
  // mandamos title + price + code, que es lo que necesita para mostrar bien.
  const shippingTitle = (shipping_method_name || "Envío a domicilio").trim() || "Envío a domicilio";
  const shippingPriceNum = Number(shipping_price || 0);
  const shippingPriceStr = shippingPriceNum.toFixed(2);
  const shippingLines = [{
    title: shippingTitle,
    price: shippingPriceStr,
    code: shippingTitle.slice(0, 30),
  }];

  // CRÍTICO: setear `price` en cada line_item con el precio REAL que cobró MP
  // (no el precio normal del variant). Sin esto Shopify toma el precio del
  // variant catálogo y queda un monto inflado — el merchant termina pagando
  // comisión de Shopify sobre un monto inexistente. Calculamos:
  //   subtotal_items = total_cobrado - envío
  //   price_por_unidad = subtotal_items / sum(quantity de todos los items)
  const totalNum = Number(total_price || 0);
  const subtotalItems = Math.max(0, totalNum - shippingPriceNum);
  const totalQty = (line_items || []).reduce((acc, li) => acc + (Number(li.quantity) || 1), 0) || 1;
  const pricePerUnit = subtotalItems / totalQty;
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
  const cleanShipping = {
    address1: String(shipping_address?.address1 || "").slice(0, 255),
    address2: String(shipping_address?.address2 || "").slice(0, 255),
    city: String(shipping_address?.city || "").slice(0, 100),
    province: String(shipping_address?.province || "").slice(0, 100),
    country: String(shipping_address?.country || "Argentina").slice(0, 50),
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
      send_receipt: false,
      send_fulfillment_receipt: false,
      currency: "ARS",
      // Identifica el origen del pedido en Shopify Admin (filtro "Source").
      source_name: "Recurrentes",
      // Tag visible — el merchant filtra fácilmente en Shopify Admin.
      tags: "RECURRENTE",
      transactions: [{
        kind: "sale",
        status: "success",
        amount: totalPriceStr,
        currency: "ARS",
        gateway: "manual",
      }],
      note: `Suscripción Recurrentes · Charge #${charge_number || 1}` + (tax_id ? `\n${tax_id_kind || "DNI"}: ${tax_id}` : ""),
      note_attributes: [
        { name: "recurrentes_subscriber_id", value: String(subscriber_id) },
        { name: "recurrentes_plan_id",       value: String(plan_id) },
        { name: "recurrentes_charge_number", value: String(charge_number || 1) },
        { name: "mp_payment_id",             value: String(mp_payment_id) },
        ...(tax_id ? [
          { name: tax_id_kind || "DNI", value: String(tax_id) },
          { name: "tax_id",             value: String(tax_id) },
          { name: "tax_id_kind",        value: String(tax_id_kind || "DNI") },
        ] : []),
      ],
    },
  };
  const data = await call(shop, token, "POST", "/orders.json", body);
  return data.order;
}
