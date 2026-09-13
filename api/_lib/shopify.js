// Helpers Shopify Admin API. Cada merchant tiene su `shopify_shop` (myshopify
// domain) + `shopify_token` (access token de la app instalada).
import { fetchRetry } from "./http.js";

// Versión REST vigente. subscribers.js la importa para no hardcodearla.
export const API_VERSION = "2025-07";

async function call(shop, token, method, path, body = null) {
  const url = `https://${shop}/admin/api/${API_VERSION}${path}`;
  // Timeout 10s + 2 reintentos en 429/5xx (respeta Retry-After).
  const r = await fetchRetry(url, {
    method,
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  }, { ms: 10000, retries: 2 });
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

// Normaliza teléfonos argentinos a E.164 (+549…) para que Shopify los acepte.
// El problema: el prefijo viejo de celular "15" hace que Shopify rechace el número
// ("phone is invalid"). Regla: el "15" se cambia por el código de área (11 para
// BsAs) o se quita si va después del área. NUNCA dejamos el teléfono vacío si vino
// un número — solo lo arreglamos.
function normalizeArPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  d = d.replace(/^00/, "");
  if (d.startsWith("549")) d = d.slice(3);       // ya venía con país + 9 (móvil)
  else if (d.startsWith("54")) d = d.slice(2);   // país sin el 9
  d = d.replace(/^0/, "");                         // sacar 0 de larga distancia
  // "15" al inicio con 10 dígitos = BsAs escrito como 15+8 → área 11.
  if (d.length === 10 && d.startsWith("15")) d = "11" + d.slice(2);
  // "15" justo después del código de área (2-4 díg) → sacarlo (ej. 351-15-xxxxxx).
  else d = d.replace(/^(\d{2,4})15(\d{6,8})$/, "$1$2");
  if (!d) return "";
  return "+549" + d; // móvil AR en E.164
}

// Lista de productos con sus variantes — usado en el plan creator para que
// el merchant elija cuál convertir en suscribible. Paginamos hasta 250.
export async function shListProducts(shop, token) {
  const data = await call(shop, token, "GET", "/products.json?limit=250&fields=id,title,handle,image,variants,status");
  return data.products || [];
}

// Precio de lista actual de una variante (Number) o null si falla. Lo usa el
// checkout para calcular server-side y no confiar en el precio del body.
export async function shGetVariantPrice(shop, token, variantId) {
  try {
    const data = await call(shop, token, "GET", `/variants/${encodeURIComponent(String(variantId))}.json?fields=id,price`);
    const p = Number(data?.variant?.price);
    return Number.isFinite(p) ? p : null;
  } catch (_) { return null; }
}

// Hosts (lowercase) que pertenecen a la tienda: el myshopify + el dominio
// principal (shop.json). Sirve para validar URLs de recupero. Fallo → [shop].
export async function shGetShopDomains(shop, token) {
  const out = new Set([String(shop || "").toLowerCase()]);
  try {
    const data = await call(shop, token, "GET", "/shop.json?fields=domain,myshopify_domain,primary_domain");
    const s = data?.shop || {};
    for (const h of [s.domain, s.myshopify_domain, s.primary_domain?.host]) {
      const host = String(h || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (host) out.add(host);
    }
  } catch (_) {}
  return [...out].filter(Boolean);
}

// ¿El cliente (por email) tiene una orden PAGA reciente en Shopify? Se usa para
// NO mandar el flujo de abandono a quien YA compró — sea suscripción o COMPRA
// ÚNICA (one-time). Si no puede consultar, devuelve false (mejor no bloquear).
export async function shHasRecentPaidOrder(shop, token, email, days = 14) {
  if (!email) return false;
  const emailNorm = String(email).trim().toLowerCase();
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const data = await call(shop, token, "GET",
      `/orders.json?email=${encodeURIComponent(emailNorm)}&status=any&financial_status=paid&created_at_min=${encodeURIComponent(since)}&limit=50&fields=id,email`);
    // `?email=` no está documentado: confirmamos en memoria que el mail sea EXACTO.
    return (data.orders || []).some(o => String(o.email || "").toLowerCase() === emailNorm);
  } catch (_) { return false; }
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
  const emailNorm = String(email || "").trim().toLowerCase();
  try {
    const search = await call(shop, token, "GET", `/customers/search.json?query=email:${encodeURIComponent(emailNorm)}`);
    // El search puede matchear parcial: nos quedamos con el email EXACTO.
    const existing = (search.customers || []).find(c => String(c.email || "").toLowerCase() === emailNorm);
    if (existing) {
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
    email: emailNorm || email,
    first_name: first_name || "",
    last_name: last_name || "",
    phone: phone || null,
    tags,
    ...(companyTax ? { note: `Identificador fiscal: ${companyTax}` } : {}),
  };
  try {
    // Primero SIEMPRE con el teléfono TAL CUAL lo puso el cliente.
    const created = await call(shop, token, "POST", "/customers.json", { customer: customerBody });
    return created.customer;
  } catch (e) {
    if (!(/phone/i.test(e.message) && phone)) throw e;
    // SOLO si Shopify lo rechaza ("phone is invalid"), lo normalizamos (15→11) y
    // reintentamos.
    try {
      const created = await call(shop, token, "POST", "/customers.json", { customer: { ...customerBody, phone: normalizeArPhone(phone) || phone } });
      return created.customer;
    } catch (e2) {
      // 3er intento: "phone has already been taken" (otro customer ya lo tiene).
      // El customer se crea sin phone; el teléfono igual viaja en shipping_address.
      if (/phone/i.test(e2.message)) {
        const created = await call(shop, token, "POST", "/customers.json", { customer: { ...customerBody, phone: null } });
        return created.customer;
      }
      throw e2;
    }
  }
}

// Redondeo a centavos sin drift de float.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ¿Ya existe una orden con este mp_payment_id (creada en las últimas 48h)?
// Evita la orden duplicada cuando la función murió después del POST y antes
// de guardar el charge. Devuelve la orden o null. Fallo → null (se crea igual).
async function findRecentOrderByPaymentId(shop, token, mpPaymentId) {
  try {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const data = await call(shop, token, "GET",
      `/orders.json?status=any&created_at_min=${encodeURIComponent(since)}&fields=id,order_status_url,note_attributes&limit=50`);
    const want = String(mpPaymentId);
    return (data.orders || []).find(o =>
      (o.note_attributes || []).some(a => a.name === "mp_payment_id" && String(a.value) === want)
    ) || null;
  } catch (_) { return null; }
}

// Crear orden PAGA con los items del plan. Marcada como `financial_status:
// paid` para que aparezca en el panel del merchant lista para empaquetar.
// note_attributes guarda referencias a Recurrentes (subscriber_id, plan_id,
// charge_number) para trazabilidad.
//
// Params opcionales nuevos (todos con default = comportamiento anterior):
//   simulated            → orden de prueba: sin mails, tag SIMULADA, pending.
//   discount_code +
//   discount_amount +
//   list_price_per_unit  → items a precio de lista + discount_codes fixed_amount.
export async function shCreatePaidOrder(shop, token, params) {
  const {
    customer_id, line_items, shipping_address, billing_address,
    subscriber_id, plan_id, charge_number, mp_payment_id, total_price,
    shipping_price, shipping_method_name, shipping_method_code,
    tax_id, tax_id_kind,
    mp_fee_real, // comisión REAL que cobró MP (fee_details del pago). Se guarda en
                 // la orden para que herramientas de márgenes usen el fee exacto.
    simulated = false,
    discount_code, discount_amount, list_price_per_unit,
  } = params;

  // Dedup: si ya hay una orden con este mp_payment_id, la devolvemos en vez
  // de crear otra (la función pudo morir antes de persistir el charge).
  if (mp_payment_id && !simulated) {
    const prev = await findRecentOrderByPaymentId(shop, token, mp_payment_id);
    if (prev) {
      console.warn(`[shopify] orden ${prev.id} ya existía para mp_payment_id=${mp_payment_id}; no se crea otra`);
      return { id: prev.id, order_status_url: prev.order_status_url || null, reused: true };
    }
  }

  // shipping_lines: Shopify rechaza `source` con valores no estándar. Solo
  // mandamos title + price + code, que es lo que necesita para mostrar bien.
  const shippingTitle = (shipping_method_name || "Envío a domicilio").trim() || "Envío a domicilio";
  const totalNum = r2(total_price);
  let shippingPriceNum = r2(shipping_price);
  // Guard: si el cobro no cubre el envío (cupón fijo, snapshot viejo), la orden
  // sale con envío $0 en vez de abortar y dejar al cliente sin pedido.
  if (shippingPriceNum > 0 && totalNum < shippingPriceNum) {
    console.warn(`[shopify] total ${totalNum} < envío ${shippingPriceNum} (sub ${subscriber_id}); se usa envío 0`);
    shippingPriceNum = 0;
  }
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
  const subtotalItems = r2(totalNum - shippingPriceNum);
  const items = (line_items || []).map(li => ({ variant_id: li.variant_id, quantity: Number(li.quantity) || 1 }));
  const totalQty = items.reduce((acc, li) => acc + li.quantity, 0) || 1;

  // GUARD: si los datos son incoherentes (subtotal <= 0), ABORTAMOS la creación
  // de orden. Evita órdenes basura con $0 producto.
  if (subtotalItems <= 0) {
    throw new Error(`Datos incoherentes: total=${totalNum}, shipping=${shippingPriceNum}, qty=${totalQty}. Orden NO creada.`);
  }

  // Modo cupón: items a precio de lista + discount_codes. Solo si vino el
  // precio de lista (si no, no cierra la cuenta y seguimos con precio neto).
  const listUnit = r2(list_price_per_unit);
  const discAmt = r2(discount_amount);
  const useDiscountCode = !!(discount_code && discAmt > 0 && listUnit > 0 && r2(listUnit * totalQty) > subtotalItems);

  let adjustedLineItems;
  let discountCodes;
  if (useDiscountCode) {
    adjustedLineItems = items.map(li => ({ ...li, price: listUnit.toFixed(2) }));
    // El descuento cierra EXACTO contra lo cobrado (absorbe centavos).
    const exactDisc = r2(listUnit * totalQty - subtotalItems);
    discountCodes = [{ code: String(discount_code).slice(0, 40), amount: exactDisc.toFixed(2), type: "fixed_amount" }];
  } else {
    // Centavos: unidad truncada a 2 decimales; el residuo va al primer item.
    const unit = Math.floor((subtotalItems / totalQty) * 100) / 100;
    const residue = r2(subtotalItems - unit * totalQty);
    adjustedLineItems = items.map(li => ({ ...li, price: unit.toFixed(2) }));
    if (residue !== 0 && adjustedLineItems.length) {
      const first = adjustedLineItems[0];
      if (first.quantity === 1) {
        first.price = r2(unit + residue).toFixed(2);
      } else {
        // qty>1: 1 unidad con el ajuste + el resto al precio unitario.
        adjustedLineItems.splice(0, 1,
          { variant_id: first.variant_id, quantity: 1, price: r2(unit + residue).toFixed(2) },
          { variant_id: first.variant_id, quantity: first.quantity - 1, price: unit.toFixed(2) },
        );
      }
    }
  }

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

  const totalPriceStr = totalNum.toFixed(2);
  const baseTags = (cleanShipping.address1 && cleanShipping.city) ? "RECURRENTE" : "RECURRENTE, FALTA-DIRECCION";

  const body = {
    order: {
      customer: { id: customer_id },
      line_items: adjustedLineItems,
      ...(discountCodes ? { discount_codes: discountCodes } : {}),
      shipping_address: cleanShipping,
      billing_address: billing_address ? {
        ...cleanShipping, ...billing_address,
      } : cleanShipping,
      shipping_lines: shippingLines,
      // Simulada: queda pendiente de pago (sin transacción), no es plata real.
      financial_status: simulated ? "pending" : "paid",
      fulfillment_status: null,
      // Que Shopify mande los mails como en una venta normal:
      //  · send_receipt → mail de CONFIRMACIÓN de compra al crear la orden.
      //  · send_fulfillment_receipt → mail de SEGUIMIENTO cuando se despacha/fulfilla.
      // (El cliente recibe la misma experiencia de mails que una compra común.)
      // En simuladas NO se manda nada al cliente.
      send_receipt: !simulated,
      send_fulfillment_receipt: !simulated,
      // Descontar stock aunque la variante no permita sobreventa: el cobro ya
      // se hizo, la orden tiene que existir sí o sí.
      inventory_behaviour: "decrement_ignoring_policy",
      // Precios AR incluyen IVA.
      taxes_included: true,
      currency: "ARS",
      // Identifica el origen del pedido en Shopify Admin (filtro "Source").
      source_name: "Recurrentes",
      // Tag visible — el merchant filtra fácilmente en Shopify Admin.
      // Si la dirección está vacía sumamos FALTA-DIRECCION para que el
      // merchant pueda filtrar "tag:FALTA-DIRECCION" desde Shopify y
      // cargar las direcciones de esas órdenes desde Recurrentes.
      tags: simulated ? `${baseTags}, SIMULADA` : baseTags,
      ...(simulated ? {} : {
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
      }),
      note: `Suscripción Recurrentes · Charge #${charge_number || 1}` + (simulated ? " · SIMULADA (prueba, sin cobro)" : "") + (tax_id ? `\n${tax_id_kind || "DNI"}: ${tax_id}` : ""),
      note_attributes: [
        { name: "recurrentes_subscriber_id", value: String(subscriber_id) },
        { name: "recurrentes_plan_id",       value: String(plan_id) },
        { name: "recurrentes_charge_number", value: String(charge_number || 1) },
        { name: "mp_payment_id",             value: String(mp_payment_id) },
        ...(simulated ? [{ name: "recurrentes_simulated", value: "true" }] : []),
        ...(discountCodes ? [{ name: "recurrentes_discount_code", value: discountCodes[0].code }] : []),
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
    // Primero con el teléfono TAL CUAL vino en la dirección.
    const data = await call(shop, token, "POST", "/orders.json", body);
    return data.order;
  } catch (e) {
    // SOLO si Shopify rechaza el teléfono, lo normalizamos (15→11) y reintentamos.
    // El teléfono sigue viajando (nunca vacío).
    if (/phone/i.test(e.message)) {
      const fixed = normalizeArPhone(body.order.shipping_address?.phone) || body.order.shipping_address?.phone || "";
      body.order.shipping_address = { ...body.order.shipping_address, phone: fixed };
      if (body.order.billing_address) body.order.billing_address = { ...body.order.billing_address, phone: fixed };
      const data = await call(shop, token, "POST", "/orders.json", body);
      return data.order;
    }
    throw e;
  }
}
