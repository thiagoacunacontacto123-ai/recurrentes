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

// Host limpio (lowercase, sin esquema ni path) o "".
const cleanHost = (h) => String(h || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();

// Datos de la tienda (UN solo GET a shop.json con `fields=`). Se usan para no
// pedirle al merchant lo que Shopify ya sabe: nombre, mail, moneda, país,
// dominio propio, zona horaria. LANZA si Shopify falla (el caller decide si es
// best-effort). `domains` = hosts únicos (myshopify + dominio primario).
export const SHOP_INFO_FIELDS = "name,email,customer_email,currency,country_code,money_format,iana_timezone,domain,myshopify_domain,primary_domain,phone";
// Permisos REALES del token, preguntandoselos a Shopify (22-sept-2026).
// Caso Wellfresh: el OAuth termino "bien" pero Shopify devolvio el token con
// scope VACIO, y lo guardamos igual. La tienda quedaba conectada y sin poder
// leer productos ni crear ordenes: el error recien aparecia al usar el panel.
// Devuelve [] si no se puede consultar (no rompe: el caller decide).
export async function shAccessScopes(shop, token) {
  try {
    // Va FUERA del path versionado (/admin/oauth/...), por eso no usa call().
    const r = await fetchRetry(`https://${shop}/admin/oauth/access_scopes.json`, {
      headers: { "X-Shopify-Access-Token": token, "Accept": "application/json" },
    }, { ms: 10000 });
    if (!r.ok) return [];
    const data = await r.json().catch(() => null);
    return (data?.access_scopes || []).map(x => String(x.handle || "").trim().toLowerCase()).filter(Boolean);
  } catch (e) {
    console.warn("[shopify/scopes]", e.message);
    return [];
  }
}

export async function shGetShopInfo(shop, token) {
  const data = await call(shop, token, "GET", `/shop.json?fields=${SHOP_INFO_FIELDS}`);
  const s = data?.shop || {};
  const primaryHost = cleanHost(s.primary_domain?.host);
  const domains = new Set([cleanHost(shop)]);
  for (const h of [s.domain, s.myshopify_domain, primaryHost]) { const host = cleanHost(h); if (host) domains.add(host); }
  return {
    name: String(s.name || "").trim(),
    email: String(s.email || "").trim().toLowerCase(),
    customer_email: String(s.customer_email || "").trim().toLowerCase(),
    currency: String(s.currency || "").trim().toUpperCase(),
    country_code: String(s.country_code || "").trim().toUpperCase(),
    money_format: String(s.money_format || ""),
    iana_timezone: String(s.iana_timezone || ""),
    domain: cleanHost(s.domain),
    myshopify_domain: cleanHost(s.myshopify_domain) || cleanHost(shop),
    primary_domain: primaryHost ? { host: primaryHost, ssl_enabled: s.primary_domain?.ssl_enabled !== false } : null,
    phone: String(s.phone || "").trim(),
    domains: [...domains].filter(Boolean),
  };
}

// Hosts (lowercase) que pertenecen a la tienda: el myshopify + el dominio
// principal (shop.json). Sirve para validar URLs de recupero. Fallo → [shop].
export async function shGetShopDomains(shop, token) {
  try {
    const info = await shGetShopInfo(shop, token);
    return info.domains.length ? info.domains : [cleanHost(shop)].filter(Boolean);
  } catch (_) {
    return [cleanHost(shop)].filter(Boolean);
  }
}

// Patch de Firestore (merge) con los datos de la tienda, respetando lo que el
// merchant cargó a mano. Pura: recibe el doc actual + el info de shGetShopInfo.
//   · store_domain: solo si no estaba o si ya venía de Shopify (store_domain_source
//     "shopify"). Un store_domain preexistente sin source se considera "shopify"
//     si coincide con el dominio de la tienda, "manual" si no (nunca se pisa).
//   · store_name: solo si estaba vacío (el merchant lo puede renombrar).
//   · shop_*: siempre se actualizan (son el espejo crudo de Shopify).
export function buildShopInfoPatch(merchant, info, nowIso = new Date().toISOString()) {
  const m = merchant || {};
  const shopHost = info.primary_domain?.host || info.domain || "";
  const patch = {
    shopify_domains: info.domains,
    shopify_domains_at: nowIso,
    shop_name: info.name || null,
    shop_email: info.email || info.customer_email || null,
    shop_currency: info.currency || null,
    shop_country: info.country_code || null,
    shop_timezone: info.iana_timezone || null,
    shop_info_at: nowIso,
  };
  const current = cleanHost(m.store_domain);
  const source = m.store_domain_source === "manual" || m.store_domain_source === "shopify" ? m.store_domain_source : null;
  if (!current) {
    if (shopHost) { patch.store_domain = shopHost; patch.store_domain_source = "shopify"; }
  } else if (source === "shopify") {
    if (shopHost) patch.store_domain = shopHost;
  } else if (!source) {
    // Legacy sin source: inferimos. Coincide con Shopify → "shopify"; si no, manual.
    patch.store_domain_source = (shopHost && current === shopHost) || (info.domains || []).includes(current) ? "shopify" : "manual";
  }
  if (!String(m.store_name || "").trim() && info.name) patch.store_name = info.name.slice(0, 60);
  return patch;
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
// `allZones: true` ignora el filtro de país (importación al panel cuando la
// tienda no tiene zona Argentina). Cada tarifa incluye `id` (id de Shopify).
// ─── Tarifas REALES de los carriers (Envialo, Andreani, Correo…) ────────────
// `shipping_zones.json` solo devuelve las tarifas MANUALES del comerciante. Las
// que calcula una app de envíos (CarrierService) no están ahí: hay que pedirle a
// Shopify que cotice, y eso es lo que hace `draftOrderCalculate` — una mutation
// que NO persiste nada (no crea borradores ni carritos).
//
// El `handle` que devuelve es un JWT sin firmar-para-nosotros cuyo payload trae
// exactamente lo que la app de envíos necesita ver en la orden:
//   { title, code: "envialo:andreani:andreani_pickup:ship:12218", source: "Envialo", price }
// El `code` lleva el id de la sucursal al final: sin él, la app no puede despachar.
export function decodeRateHandle(handle) {
  try {
    const part = String(handle || "").split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(b64 + "=".repeat((4 - (b64.length % 4)) % 4), "base64").toString("utf8");
    const p = JSON.parse(json);
    return {
      title: String(p.title || "").trim(),
      code: String(p.code || "").trim(),
      source: String(p.source || "").trim(),
      price: Number(p.price ?? p.price_presentment ?? 0) || 0,
      currency: String(p.currency || p.currency_presentment || "").trim(),
    };
  } catch (_) { return null; }
}

export async function shopifyGraphql(shop, token, query, variables = {}) {
  const url = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;
  const r = await fetchRetry(url, {
    method: "POST",
    headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({ query, variables }),
  }, { ms: 12000, retries: 2 });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Shopify GraphQL: HTTP ${r.status}`);
  if (data.errors?.length) throw new Error(`Shopify GraphQL: ${data.errors.map(e => e.message).join("; ")}`);
  return data.data || {};
}

// Handle (slug de la URL) de un producto → para abrir su página desde el panel
// ("Activar en mi tienda"). null si el producto ya no existe.
export async function shGetProductHandle(shop, token, productId) {
  try {
    const data = await call(shop, token, "GET", `/products/${encodeURIComponent(String(productId))}.json?fields=handle,status`);
    return data.product?.handle || null;
  } catch (e) {
    if (/\b404\b|Not Found/i.test(e.message || "")) return null;
    throw e;
  }
}

// Códigos de descuento ACTIVOS de la tienda (Configuración → Descuentos → "Traer los de
// Shopify"). GraphQL codeDiscountNodes (el REST price_rules está deprecado). Requiere el
// permiso opcional read_discounts: sin él Shopify responde "Access denied" y el llamador
// lo traduce a "reconectá con el permiso". Devuelve los nodos crudos; el mapeo a nuestro
// formato vive en _lib/discountImport.js (testeable sin red).
const DISCOUNTS_QUERY = `query($after: String) {
  codeDiscountNodes(first: 50, after: $after, query: "status:active") {
    pageInfo { hasNextPage endCursor }
    nodes { codeDiscount { __typename
      ... on DiscountCodeBasic { title status
        codes(first: 50) { nodes { code } }
        customerGets { value { __typename
          ... on DiscountPercentage { percentage }
          ... on DiscountAmount { amount { amount currencyCode } } } } }
      ... on DiscountCodeBxgy { title codes(first: 50) { nodes { code } } }
      ... on DiscountCodeFreeShipping { title codes(first: 50) { nodes { code } } }
      ... on DiscountCodeApp { title codes(first: 50) { nodes { code } } }
    } }
  }
}`;
export async function shListDiscountNodes(shop, token, { maxPages = 4 } = {}) {
  const out = [];
  let after = null;
  for (let i = 0; i < maxPages; i++) {
    const data = await shopifyGraphql(shop, token, DISCOUNTS_QUERY, { after });
    const conn = data.codeDiscountNodes || {};
    out.push(...(conn.nodes || []));
    if (!conn.pageInfo?.hasNextPage || !conn.pageInfo?.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  return out;
}

const QUOTE_MUTATION = `mutation($input: DraftOrderInput!) {
  draftOrderCalculate(input: $input) {
    calculatedDraftOrder { availableShippingRates { handle title price { amount currencyCode } } }
    userErrors { field message }
  }
}`;

/**
 * Cotiza envío como lo haría el checkout de Shopify: mismas opciones, mismos
 * precios y — lo importante — los mismos `code`/`source` del carrier, para que
 * la app de envíos procese la orden igual que una venta suelta.
 *
 * Devuelve [] si la tienda no tiene carriers, si falta la dirección o si Shopify
 * no pudo cotizar. El llamador cae a las tarifas manuales en ese caso.
 */
export async function shQuoteShippingRates(shop, token, { variantId, quantity = 1, address = {} } = {}) {
  if (!variantId) return [];
  const zip = String(address.zip || "").trim();
  const city = String(address.city || "").trim();
  if (!zip && !city) return [];   // sin destino no hay cotización posible
  const input = {
    lineItems: [{ variantId: `gid://shopify/ProductVariant/${String(variantId).replace(/\D/g, "")}`, quantity: Math.max(1, parseInt(quantity, 10) || 1) }],
    shippingAddress: {
      address1: String(address.address1 || "").trim() || city || "-",
      city: city || "-",
      zip,
      province: String(address.province || "").trim() || undefined,
      countryCode: String(address.country_code || "AR").toUpperCase(),
    },
  };
  let data;
  try { data = await shopifyGraphql(shop, token, QUOTE_MUTATION, { input }); }
  catch (e) { console.warn("[shopify/quote]", e.message); return []; }
  const errs = data?.draftOrderCalculate?.userErrors || [];
  if (errs.length) { console.warn("[shopify/quote] userErrors:", JSON.stringify(errs).slice(0, 300)); return []; }
  const list = data?.draftOrderCalculate?.calculatedDraftOrder?.availableShippingRates || [];
  const out = [];
  for (const r of list) {
    const dec = decodeRateHandle(r.handle) || {};
    const name = String(r.title || dec.title || "").trim();
    if (!name) continue;
    out.push({
      name: name.slice(0, 250),
      price: Math.max(0, Math.round(Number(r.price?.amount ?? dec.price ?? 0) || 0)),
      code: (dec.code || "").slice(0, 250),
      source: (dec.source || "").slice(0, 100),
      carrier: true,
    });
  }
  return out;
}

export async function shGetShippingRates(shop, token, { province = "", subtotal = 0, allZones = false } = {}) {
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
    if (!cubreAR && !allZones) continue;
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
      out.push({ name, price, free: price === 0, id: r.id != null ? String(r.id) : undefined });
    };
    for (const r of (z.price_based_shipping_rates || [])) push(r, "price");
    for (const r of (z.weight_based_shipping_rates || [])) push(r, "weight");
  }
  // Gratis primero, después por precio ascendente.
  out.sort((a, b) => a.price - b.price);
  return out;
}

// Tarifas de envío de Shopify listas para el panel (sin escribir). Zona
// Argentina; si la tienda no tiene zona AR, todas las zonas. Dedup por nombre.
// [] = la tienda usa tarifas dinámicas (carrier service) → cargar a mano.
export const SHOPIFY_RATES_EMPTY_NOTE = "Tu tienda usa tarifas dinámicas (carrier). Cargalas a mano.";
export async function shopifyRatesForPanel(merchant) {
  if (!merchant?.shopify_token || !merchant?.shopify_shop) return { rates: [], error: "Conectá Shopify primero" };
  let raw = await shGetShippingRates(merchant.shopify_shop, merchant.shopify_token, {});
  if (!raw.length) raw = await shGetShippingRates(merchant.shopify_shop, merchant.shopify_token, { allZones: true });
  const seen = new Set();
  const rates = [];
  for (const r of raw) {
    const name = String(r.name || "").trim().slice(0, 250);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    rates.push({ name, price: Math.max(0, Math.round(Number(r.price) || 0)), code: name.slice(0, 50), source: "shopify" });
  }
  return rates.length ? { rates } : { rates: [], note: SHOPIFY_RATES_EMPTY_NOTE };
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
    shipping_price, shipping_method_name, shipping_method_code, shipping_method_source,
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
  // La app de envíos (Envialo, Andreani…) lee `code` y `source` para saber qué
  // servicio y qué sucursal despachar: el `code` del carrier termina en el id del
  // punto de retiro (`envialo:andreani:andreani_pickup:ship:12218`). Sin esos dos
  // campos la orden le llega como un texto suelto y no la puede procesar, que es
  // lo que pasaba con las suscripciones. `source` se manda solo si vino del
  // cotizador; si Shopify lo rechaza, reintentamos sin él (ver abajo).
  const shippingLines = [{
    title: shippingTitle,
    price: shippingPriceStr,
    code: (shipping_method_code && String(shipping_method_code).trim()) || shippingTitle.slice(0, 50),
    ...(shipping_method_source && String(shipping_method_source).trim()
      ? { source: String(shipping_method_source).trim().slice(0, 100) }
      : {}),
  }];

  // CRÍTICO: setear `price` en cada line_item con el precio REAL que cobró MP
  // (no el precio normal del variant). Sin esto Shopify toma el precio del
  // variant catálogo y queda un monto inflado — el merchant termina pagando
  // comisión de Shopify sobre un monto inexistente. Calculamos:
  //   subtotal_items = total_cobrado - envío
  //   price_por_unidad = subtotal_items / sum(quantity de todos los items)
  const subtotalItemsAll = r2(totalNum - shippingPriceNum);
  // Ítems con `price` propio (los extras del checkout) se facturan a ese precio; el resto
  // del cobro se reparte entre los ítems sin precio (el producto del plan), como siempre.
  const pricedItems = (line_items || []).filter(li => li.extra === true && Number(li.price) > 0).map(li => ({ variant_id: li.variant_id, quantity: Number(li.quantity) || 1, price: r2(li.price).toFixed(2) }));
  const pricedTotal = r2(pricedItems.reduce((a, li) => a + Number(li.price) * li.quantity, 0));
  const subtotalItems = r2(subtotalItemsAll - pricedTotal);
  const items = (line_items || []).filter(li => !(li.extra === true && Number(li.price) > 0)).map(li => ({ variant_id: li.variant_id, quantity: Number(li.quantity) || 1 }));
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
  const useDiscountCode = !!(discount_code && discAmt > 0 && listUnit > 0 && r2(listUnit * totalQty) > subtotalItems && !pricedItems.length);

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
      line_items: [...adjustedLineItems, ...pricedItems],
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
    // Shopify puede rechazar `source` con valores que no reconoce. En ese caso la
    // orden tiene que existir igual (el cobro ya se hizo): reintentamos sin
    // `source`, conservando `code`, que es lo que identifica servicio y sucursal.
    if (/source/i.test(e.message) && body.order.shipping_lines?.[0]?.source) {
      console.warn("[shopify] Shopify rechazó shipping_lines.source; reintento sin él:", e.message.slice(0, 200));
      const { source, ...sinSource } = body.order.shipping_lines[0];
      body.order.shipping_lines = [sinSource];
      const data = await call(shop, token, "POST", "/orders.json", body);
      return data.order;
    }
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

// ¿Existe YA una orden para este pago de MP? Solo lectura. Busca entre las órdenes
// del CLIENTE (mail exacto; en Shopify el mail de cliente es único) la que tenga
// note_attributes.mp_payment_id = paymentId. No depende del volumen de la tienda
// (a diferencia de findRecentOrderByPaymentId, que mira las últimas 50 de 48h).
//   { verified:true, order:{id, order_status_url}|null } · { verified:false, reason }
// verified:false = no se pudo confirmar → quien llama NO debe crear la orden.
export async function shFindOrderForPayment(shop, token, email, paymentId) {
  const emailNorm = String(email || "").trim().toLowerCase();
  if (!emailNorm) return { verified: false, reason: "sin mail del cliente" };
  const want = String(paymentId);
  try {
    const search = await call(shop, token, "GET", `/customers/search.json?query=email:${encodeURIComponent(emailNorm)}&fields=id,email&limit=50`);
    const all = search.customers || [];
    const matches = all.filter(c => String(c.email || "").toLowerCase() === emailNorm);
    if (!matches.length) return all.length >= 50 ? { verified: false, reason: "búsqueda de clientes incompleta" } : { verified: true, order: null, customer: false };
    for (const c of matches) {
      const data = await call(shop, token, "GET", `/customers/${encodeURIComponent(String(c.id))}/orders.json?status=any&limit=250&fields=id,order_status_url,note_attributes`);
      const orders = data.orders || [];
      const hit = orders.find(o => (o.note_attributes || []).some(a => a.name === "mp_payment_id" && String(a.value) === want));
      if (hit) return { verified: true, order: { id: hit.id, order_status_url: hit.order_status_url || null } };
      if (orders.length >= 250) return { verified: false, reason: "el cliente tiene demasiadas órdenes para verificar" };
    }
    return { verified: true, order: null, customer: true };
  } catch (e) {
    return { verified: false, reason: String(e.message || e).slice(0, 200) };
  }
}
