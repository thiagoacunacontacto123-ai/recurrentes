// Adapter Tiendanube (Nuvemshop) — canal de venta "tiendanube".
//
// Doc oficial: https://tiendanube.github.io/api-documentation/ (intro, authentication,
// product, product-variant, order, script, webhook). Resumen de lo que usamos:
//   · OAuth: el comerciante autoriza en https://www.tiendanube.com/apps/{app_id}/authorize?state=…
//     (o en el admin de su tienda: https://{tienda}.mitiendanube.com/admin/apps/{app_id}/authorize).
//     Tiendanube vuelve a la "URL de redirección" de la app (Partners) con ?code=… (vale 5 min).
//     POST https://www.tiendanube.com/apps/authorize/token {client_id, client_secret,
//     grant_type:"authorization_code", code} → {access_token, token_type:"bearer", scope, user_id}.
//     user_id = id de la tienda (store_id). El token NO vence: solo deja de valer si se
//     pide otro o si desinstalan la app.
//   · API: https://api.tiendanube.com/{versión}/{store_id}/… con "Authorization: Bearer <token>"
//     (versión 2025-03; la legacy v1 usa "Authentication: bearer <token>") y un User-Agent con
//     el nombre de la app + mail o link de contacto (sin él → 400). Rate limit: balde de 40
//     requests que se vacía a 2/s (429 si se pasa).
//   · Órdenes: POST /orders acepta payment_status "paid", products[{variant_id, quantity, price}],
//     shipping_address / billing_address, costo de envío, owner_note, `extra` (JSON libre),
//     send_confirmation_email / send_fulfillment_email, inventory_behaviour "claim"|"bypass".
//     Diferencias con Shopify (documentadas en el reporte): no hay tags de orden (usamos
//     owner_note + extra), el gateway solo puede ser "offline" o "not-provided" (no
//     "Mercado Pago"), y no hay URL pública de estado de la orden.
//   · Scripts: el JS se sube en el portal de Partners; por API se asocia a cada tienda con
//     POST /scripts {script_id, query_params} (scope write_scripts).
//   · Webhooks: firmados con HMAC-SHA256 (hex) del body crudo con el client secret de la app,
//     header x-linkedstore-hmac-sha256.
import crypto from "node:crypto";
import { fetchWithTimeout } from "./http.js";
import { timingSafeEqualStr } from "./token.js";
import { internalFulfillmentId } from "../../shared/platform/profile.js";

const API_HOST = "https://api.tiendanube.com";
export const TN_AUTH_BASE = "https://www.tiendanube.com";

// Versión de la API (fecha). Se puede forzar la legacy con TIENDANUBE_API_VERSION=v1.
export const tnApiVersion = () => String(process.env.TIENDANUBE_API_VERSION || "2025-03").trim() || "2025-03";

// ¿Está creada la app de Partner? (sin esto el canal sigue "Próximamente").
export const tnConfigured = () => !!(process.env.TIENDANUBE_APP_ID && process.env.TIENDANUBE_CLIENT_SECRET);

// User-Agent obligatorio: "App (contacto)". El contacto sale de TIENDANUBE_CONTACT_EMAIL.
export function tnUserAgent() {
  const contact = String(process.env.TIENDANUBE_CONTACT_EMAIL || "").trim();
  return `Recurrentes (${contact || "https://www.recurrentesapp.com"})`;
}

function authHeader(token) {
  return tnApiVersion() === "v1" ? { Authentication: `bearer ${token}` } : { Authorization: `Bearer ${token}` };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Llamada a la API de la tienda. Reintenta 429 siempre (el pedido no se procesó) y 5xx
 * solo si `retry5xx` (NO en POST /orders: un 5xx después de crear la orden la duplicaría).
 * @returns {Promise<{data:any, status:number}>}
 */
async function call(storeId, token, method, path, body = null, { retry5xx = method === "GET", retries = 2 } = {}) {
  const url = `${API_HOST}/${tnApiVersion()}/${encodeURIComponent(String(storeId))}${path}`;
  const opts = {
    method,
    headers: {
      ...authHeader(token),
      "User-Agent": tnUserAgent(),
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  };
  let r;
  for (let i = 0; i <= retries; i++) {
    r = await fetchWithTimeout(url, opts, 10000);
    const retryable = r.status === 429 || (retry5xx && r.status >= 500);
    if (!retryable || i === retries) break;
    const resetMs = parseFloat(r.headers?.get?.("x-rate-limit-reset") || "0");
    await sleep(Math.min(4000, resetMs > 0 ? resetMs : 500 * Math.pow(2, i)));
  }
  const text = await r.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!r.ok) {
    const d = data && typeof data === "object" ? data : {};
    const raw = d.description || d.message || d.error || (Object.keys(d).length ? d : `HTTP ${r.status}`);
    const detail = typeof raw === "string" ? raw : JSON.stringify(raw);
    const err = new Error(`Tiendanube ${method} ${path.split("?")[0]}: ${detail}`.slice(0, 500));
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return { data, status: r.status };
}

// Campos multi-idioma ({es, pt, en}) → string (español primero).
export function tnText(v) {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (typeof v === "object") {
    for (const k of ["es", "es_AR", "es_MX", "pt", "en"]) if (v[k]) return String(v[k]);
    const first = Object.values(v).find(Boolean);
    return first ? String(first) : "";
  }
  return "";
}

// ─── OAuth ───────────────────────────────────────────────────────────────────

// Host limpio de lo que pegó el comerciante ("https://mitienda.mitiendanube.com/admin" → "mitienda.mitiendanube.com").
export function normalizeStoreUrl(raw) {
  const h = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(h) ? h : "";
}

// Subdominios propios de Tiendanube/Nuvemshop: ahí existe /admin/apps/{id}/authorize.
const TN_STORE_HOST_RE = /^[a-z0-9][a-z0-9-]*\.(mitiendanube\.com|lojavirtualnuvem\.com\.br)$/;

/** URL de autorización. Con el subdominio de la tienda va directo a su admin; si no, la global. */
export function tnAuthorizeUrl(state, storeUrl = "") {
  const appId = encodeURIComponent(String(process.env.TIENDANUBE_APP_ID || ""));
  const host = normalizeStoreUrl(storeUrl);
  const base = TN_STORE_HOST_RE.test(host)
    ? `https://${host}/admin/apps/${appId}/authorize`
    : `${TN_AUTH_BASE}/apps/${appId}/authorize`;
  return `${base}?state=${encodeURIComponent(state)}`;
}

/** code → { access_token, store_id, scope }. LANZA si Tiendanube rechaza. */
export async function tnExchangeCode(code) {
  const r = await fetchWithTimeout(`${TN_AUTH_BASE}/apps/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": tnUserAgent() },
    body: JSON.stringify({
      client_id: process.env.TIENDANUBE_APP_ID,
      client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: String(code || ""),
    }),
  }, 10000);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error || !d.access_token || !d.user_id) {
    throw new Error(`Tiendanube no aceptó la autorización: ${d.error_description || d.error || `HTTP ${r.status}`}`);
  }
  return { access_token: String(d.access_token), store_id: String(d.user_id), scope: String(d.scope || "") };
}

// ─── Tienda / catálogo ──────────────────────────────────────────────────────

/** Datos de la tienda (GET /store) normalizados. LANZA si falla. */
export async function tnGetStore(storeId, token) {
  const { data: s } = await call(storeId, token, "GET", "/store");
  const domains = (Array.isArray(s?.domains) ? s.domains : []).map(d => normalizeStoreUrl(d)).filter(Boolean);
  const original = normalizeStoreUrl(s?.original_domain);
  const host = domains[0] || original;
  return {
    id: String(s?.id || storeId),
    name: tnText(s?.name).trim(),
    email: String(s?.email || s?.contact_email || "").trim().toLowerCase(),
    url: host ? `https://${host}` : "",
    original_domain: original,
    domains: [...new Set([original, ...domains].filter(Boolean))],
    currency: String(s?.main_currency || "").toUpperCase(),
    country: String(s?.country || "").toUpperCase(),
  };
}

// Precio de venta de una variante: el promocional si está vigente (menor al de lista).
export function tnVariantPrice(v) {
  const price = parseFloat(v?.price);
  const promo = parseFloat(v?.promotional_price);
  if (Number.isFinite(promo) && promo > 0 && (!Number.isFinite(price) || promo < price)) return promo;
  return Number.isFinite(price) ? price : 0;
}

/** Producto de Tiendanube → mismo formato que GET /api/shopify?action=products. */
export function tnNormalizeProduct(p) {
  return {
    id: String(p.id),
    title: tnText(p.name) || `Producto ${p.id}`,
    handle: tnText(p.handle),
    status: p.published === false ? "draft" : "active",
    image: (Array.isArray(p.images) && p.images[0]?.src) || null,
    variants: (Array.isArray(p.variants) ? p.variants : []).map(v => ({
      id: String(v.id),
      // Sin atributos (talle, color…) la variante es única: mismo texto que Shopify.
      title: (Array.isArray(v.values) ? v.values.map(tnText).filter(Boolean).join(" / ") : "") || "Default Title",
      price: tnVariantPrice(v),
      sku: v.sku || "",
      inventory_quantity: v.stock ?? null, // null = stock infinito
    })),
  };
}

/** Todos los productos (hasta 1000: 5 páginas de 200). */
export async function tnListProducts(storeId, token, { maxPages = 5 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    let data;
    try {
      ({ data } = await call(storeId, token, "GET", `/products?per_page=200&page=${page}&fields=id,name,handle,images,variants,published`));
    } catch (e) {
      if (e.status === 404 && page > 1) break; // página vacía después de la última
      throw e;
    }
    const arr = Array.isArray(data) ? data : [];
    out.push(...arr);
    if (arr.length < 200) break;
  }
  return out.map(tnNormalizeProduct);
}

// Handle y URL pública de un producto → para abrirlo desde el panel ("Activar en mi
// tienda"). null si no existe.
export async function tnGetProductHandle(storeId, token, productId) {
  try {
    const { data } = await call(storeId, token, "GET", `/products/${encodeURIComponent(String(productId))}?fields=id,handle,canonical_url`);
    return { handle: tnText(data?.handle) || null, canonical_url: data?.canonical_url || null };
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

// Cupones de la tienda (Configuración → Descuentos → "Traer los de Tiendanube").
// GET /coupons (scope read_coupons): [{ id, code, type: "percentage"|"absolute"|"shipping",
// value, valid, start_date, end_date, max_uses, used, … }]. Devuelve los cupones crudos;
// el mapeo a nuestro formato vive en _lib/discountImport.js. 401/403 = la app no tiene el
// permiso → el llamador lo traduce.
export async function tnListCoupons(storeId, token, { maxPages = 3 } = {}) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    let data;
    try {
      ({ data } = await call(storeId, token, "GET", `/coupons?per_page=200&page=${page}`));
    } catch (e) {
      if (e.status === 404 && page > 1) break;
      throw e;
    }
    const arr = Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [];
    out.push(...arr);
    if (arr.length < 200) break;
  }
  return out;
}

// ─── Scripts (widget sin pegar código) ──────────────────────────────────────

const scriptList = (data) => (Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : []);

/**
 * Asocia el script de la app (creado en Partners) a la tienda con los query_params del
 * merchant. Si ya estaba asociado, actualiza los params (PUT) en vez de duplicarlo.
 */
export async function tnInstallScript(storeId, token, { scriptId, params = {} }) {
  if (!scriptId) throw new Error("Falta TIENDANUBE_SCRIPT_ID");
  let existing = null;
  try {
    const { data } = await call(storeId, token, "GET", "/scripts");
    existing = scriptList(data).find(s => String(s.id) === String(scriptId)) || null;
  } catch (_) { /* sin listado: probamos crear */ }
  const body = { script_id: Number(scriptId) || scriptId, query_params: JSON.stringify(params) };
  const { data } = existing
    ? await call(storeId, token, "PUT", `/scripts/${encodeURIComponent(String(scriptId))}`, body, { retry5xx: true })
    : await call(storeId, token, "POST", "/scripts", body, { retry5xx: true });
  return data;
}

export async function tnUninstallScript(storeId, token, scriptId) {
  if (!scriptId) return null;
  const { data } = await call(storeId, token, "DELETE", `/scripts/${encodeURIComponent(String(scriptId))}`, null, { retry5xx: true });
  return data;
}

// ─── Webhooks ────────────────────────────────────────────────────────────────

/** Crea el webhook (event → url) si la tienda todavía no lo tiene. */
export async function tnEnsureWebhook(storeId, token, event, url) {
  try {
    const { data } = await call(storeId, token, "GET", "/webhooks");
    const list = Array.isArray(data) ? data : [];
    const found = list.find(w => w.event === event && w.url === url);
    if (found) return found;
  } catch (e) {
    if (e.status !== 404) throw e;
  }
  const { data } = await call(storeId, token, "POST", "/webhooks", { event, url }, { retry5xx: true });
  return data;
}

/** HMAC del body crudo (hex, como el ejemplo PHP de la doc). */
export function tnWebhookSignature(raw, secret) {
  return crypto.createHmac("sha256", secret).update(raw).digest("hex");
}

/** ¿La firma x-linkedstore-hmac-sha256 es válida? Acepta hex (doc) o base64, en tiempo constante. */
export function tnVerifyWebhook(raw, header, secret = process.env.TIENDANUBE_CLIENT_SECRET) {
  const given = String(header || "").trim();
  if (!secret || !given || raw == null) return false;
  const digest = crypto.createHmac("sha256", secret).update(raw).digest();
  return timingSafeEqualStr(digest.toString("hex"), given.toLowerCase()) || timingSafeEqualStr(digest.toString("base64"), given);
}

// ─── Órdenes ─────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * "Av. San Martín 1234 piso 3 dto B" → { address:"Av. San Martín", number:"1234", floor:"piso 3 dto B" }.
 * Tiendanube pide calle y número por separado; nosotros guardamos una sola línea.
 * Sin número → "S/N". address2 se suma a floor.
 */
export function splitStreetNumber(address1, address2 = "") {
  const line = String(address1 || "").trim().replace(/\s+/g, " ");
  const cut = line.search(/,|\b(piso|dto|dpto|depto|departamento|of|oficina|pb|casa|lote|torre)\b/i);
  const head = (cut > 0 ? line.slice(0, cut) : line).trim();
  const tail = (cut > 0 ? line.slice(cut) : "").replace(/^,\s*/, "").trim();
  const m = head.match(/^(.*\S)\s+(\d{1,6}[a-zA-Z]?)$/);
  const address = (m ? m[1] : head).trim();
  const number = m ? m[2] : "S/N";
  const floor = [tail, String(address2 || "").trim()].filter(Boolean).join(" · ");
  return { address, number, floor };
}

const countryCode = (raw) => {
  const c = String(raw || "Argentina").trim();
  if (/^ar$/i.test(c) || /argentin/i.test(c)) return "AR";
  return c.length === 2 ? c.toUpperCase() : "AR";
};

/**
 * Body de POST /orders para un cobro. Espejo de shCreatePaidOrder (api/_lib/shopify.js):
 * precio real cobrado repartido en los ítems (centavos al primero), envío como costo al
 * cliente, orden PAGA con los mails de la tienda, trazabilidad en owner_note + extra.
 * LANZA si el total no cubre los ítems (mismo guard que Shopify).
 */
export function buildTiendanubeOrderPayload(sub, params) {
  const {
    variant_id, quantity = 1, total_price, shipping_price = 0, shipping_method_name,
    subscriber_id, plan_id, charge_number, mp_payment_id, mp_fee_real = null,
    tax_id = null, tax_id_kind = "DNI", simulated = false,
  } = params || {};
  const totalNum = r2(total_price);
  let shippingNum = r2(shipping_price);
  // Mismo guard que Shopify: si el cobro no cubre el envío, la orden sale con envío $0.
  if (shippingNum > 0 && totalNum < shippingNum) shippingNum = 0;
  const subtotalItems = r2(totalNum - shippingNum);
  const qty = Math.max(1, parseInt(quantity, 10) || 1);
  if (subtotalItems <= 0) {
    throw new Error(`Datos incoherentes: total=${totalNum}, shipping=${shippingNum}, qty=${qty}. Orden NO creada.`);
  }
  const vid = Number(variant_id) || variant_id;
  const unit = Math.floor((subtotalItems / qty) * 100) / 100;
  const residue = r2(subtotalItems - unit * qty);
  const products = residue !== 0
    ? (qty === 1
      ? [{ variant_id: vid, quantity: 1, price: r2(unit + residue) }]
      : [{ variant_id: vid, quantity: 1, price: r2(unit + residue) }, { variant_id: vid, quantity: qty - 1, price: unit }])
    : [{ variant_id: vid, quantity: qty, price: unit }];

  const name = String(sub?.customer_name || "").trim();
  const [first, ...rest] = name.split(" ");
  const addr = sub?.shipping_address || {};
  const hasAddress = !!(addr.address1 && addr.city);
  const street = splitStreetNumber(addr.address1, addr.address2);
  const phone = String(addr.phone || sub?.customer_phone || "").slice(0, 30);
  const address = {
    first_name: String(addr.first_name || first || "").slice(0, 50),
    last_name: String(addr.last_name || rest.join(" ") || "").slice(0, 50),
    address: (street.address || (hasAddress ? "" : "A completar")).slice(0, 255),
    number: street.number.slice(0, 20),
    floor: street.floor.slice(0, 100),
    locality: "",
    city: String(addr.city || "").slice(0, 100),
    province: String(addr.province || "").slice(0, 100),
    zipcode: String(addr.zip || "").slice(0, 20),
    country: countryCode(addr.country),
    phone,
  };

  const tags = ["RECURRENTE", ...(hasAddress ? [] : ["FALTA-DIRECCION"]), ...(simulated ? ["SIMULADA"] : [])];
  const ownerNote = [
    tags.join(" · "),
    `Suscripción Recurrentes · Cobro #${charge_number || 1}${simulated ? " · SIMULADA (prueba, sin cobro)" : ""}`,
    `Cobrado por Mercado Pago · mp_payment_id=${mp_payment_id}`,
    ...(tax_id ? [`${tax_id_kind || "DNI"}: ${tax_id}`] : []),
  ].join("\n");

  const extra = {
    recurrentes: true,
    tags: tags.join(", "),
    recurrentes_subscriber_id: String(subscriber_id || ""),
    recurrentes_plan_id: String(plan_id || ""),
    recurrentes_charge_number: String(charge_number || 1),
    mp_payment_id: String(mp_payment_id),
    ...(mp_fee_real != null && Number.isFinite(Number(mp_fee_real)) ? { mp_fee_real: String(r2(mp_fee_real)) } : {}),
    ...(tax_id ? { tax_id: String(tax_id), tax_id_kind: String(tax_id_kind || "DNI") } : {}),
    ...(simulated ? { recurrentes_simulated: "true" } : {}),
  };

  const shipMethod = String(shipping_method_name || "Envío a domicilio").trim() || "Envío a domicilio";
  return {
    customer: {
      name: name || String(sub?.customer_email || "").split("@")[0] || "Cliente",
      email: String(sub?.customer_email || "").trim().toLowerCase(),
      ...(phone ? { phone } : {}),
      ...(tax_id ? { document: String(tax_id) } : {}),
    },
    products,
    shipping_address: address,
    billing_address: address,
    shipping_pickup_type: hasAddress ? "ship" : "pickup",
    shipping: hasAddress ? "table" : "not-provided",
    shipping_option: shipMethod.slice(0, 100),
    shipping_cost_customer: shippingNum,
    // El cobro lo hizo Mercado Pago, afuera de Tiendanube: "offline" = pago manual/externo.
    gateway: "offline",
    // Simulada: queda pendiente (no es plata real), igual que en Shopify.
    payment_status: simulated ? "pending" : "paid",
    total: totalNum,
    currency: "ARS",
    // Descontar stock; si no hay, tnCreatePaidOrder reintenta con "bypass" (la orden va sí o sí).
    inventory_behaviour: "claim",
    send_confirmation_email: !simulated,
    send_fulfillment_email: !simulated,
    owner_note: ownerNote,
    extra,
  };
}

// ¿Ya existe una orden de este mp_payment_id (últimas 48 h)? Evita duplicar si la función
// murió después del POST y antes de guardar el charge. Fallo → null (se crea igual).
async function tnFindOrderByPaymentId(storeId, token, mpPaymentId, email) {
  const want = String(mpPaymentId);
  try {
    const q = new URLSearchParams({
      created_at_min: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      per_page: "50",
      fields: "id,number,owner_note,extra",
    });
    if (email) q.set("q", String(email).trim().toLowerCase());
    const { data } = await call(storeId, token, "GET", `/orders?${q.toString()}`);
    return (Array.isArray(data) ? data : []).find(o =>
      String(o?.extra?.mp_payment_id ?? "") === want || String(o?.owner_note || "").includes(`mp_payment_id=${want}`)
    ) || null;
  } catch (_) { return null; } // 404 = sin resultados
}

const STOCK_RE = /stock|inventor|estoque|sin existencias|out of/i;

/**
 * Crea la orden PAGA. Devuelve { id, number, reused? }. LANZA si Tiendanube la rechaza.
 */
// ─── Descripción de un producto (para el bloque de suscripción) ─────────────
// Tiendanube guarda la descripción por idioma: { es: "...", pt: null }. Leemos y
// escribimos respetando el idioma que ya tenía, así una tienda en portugués no
// termina con la descripción en la clave equivocada.
// ─── Métodos de envío de la tienda ─────────────────────────────────────────
// GET /shipping_carriers: los medios de envío que el comerciante tiene activos
// (Correo Argentino, Andreani, OCA, retiro en local, envío propio…). Los usa el
// checkout para mostrar los MISMOS envíos que el cliente vería comprando normal.
//
// Ojo con el precio: Tiendanube cotiza por destino y acá no tenemos el CP, así
// que `price` queda en 0 salvo que el carrier declare un costo fijo. El nombre
// y el code sí sirven, que es lo que necesita la orden para despacharse.
// Requiere el scope `read_shipping`.
export async function tnShippingRates(storeId, token) {
  let data;
  try { ({ data } = await call(storeId, token, "GET", "/shipping_carriers")); }
  catch (e) {
    console.warn(`[tiendanube] /shipping_carriers falló (${storeId}):`, e.message);
    return [];
  }
  const carriers = Array.isArray(data) ? data : [];
  const out = [];
  const seen = new Set();
  for (const c of carriers) {
    if (c?.active === false) continue;
    // Cada carrier puede exponer varias opciones (domicilio, sucursal…).
    const opciones = Array.isArray(c?.options) && c.options.length ? c.options : [{ name: c?.name, code: c?.code }];
    for (const o of opciones) {
      // Una opción apagada dentro de un carrier prendido (ej: Correo con
      // "a sucursal" desactivado) no la tiene que ver el comprador.
      if (o?.active === false) continue;
      const name = tnText(o?.name ?? c?.name).trim().slice(0, 250);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // OJO con el precio: Tiendanube NO cotiza por destino en esta API. Los
      // medios con precio propio (retiro, envío propio) vienen con el suyo; los
      // que se cotizan por CP (Correo Argentino, OCA, sucursales) vienen SIN
      // precio, y antes salían como $0 = envío gratis regalado. Ahora se
      // marcan `unpriced` para que el checkout no los ofrezca a $0.
      // 22-sept-2026, Thiago.
      const crudo = o?.price ?? o?.cost;
      const tienePrecio = crudo !== undefined && crudo !== null && crudo !== "" && Number.isFinite(Number(crudo));
      out.push({
        name,
        price: tienePrecio ? Math.max(0, Math.round(Number(crudo))) : 0,
        code: String(o?.code || c?.code || "").trim().slice(0, 50),
        source: "tiendanube",
        ...(tienePrecio ? {} : { unpriced: true }),
      });
    }
  }
  out.sort((a, b) => a.price - b.price);
  return out;
}

export async function tnGetProductDescription(storeId, token, productId) {
  const { data } = await call(storeId, token, "GET", `/products/${productId}?fields=id,description`);
  const d = data?.description;
  if (d && typeof d === "object") {
    const lang = Object.keys(d).find(k => typeof d[k] === "string" && d[k]) || Object.keys(d)[0] || "es";
    return { html: String(d[lang] || ""), lang };
  }
  return { html: String(d || ""), lang: "es" };
}

export async function tnSetProductDescription(storeId, token, productId, html, lang = "es") {
  await call(storeId, token, "PUT", `/products/${productId}`, { description: { [lang]: String(html || "") } }, { retry5xx: false });
  return true;
}

// ─── Envío en la orden: el fulfillment order ────────────────────────────────
// Tiendanube guarda el envío en una entidad aparte (Fulfillment Order), NO en la
// orden: `POST /orders` acepta `shipping_option` (un nombre) y descarta el resto
// — verificado contra la API: ni el código del servicio ni el costo quedan.
// Lo que la app de envíos necesita ver vive en `shipping.option.code` /
// `.reference` y en `shipping.carrier`, y eso solo se puede escribir por PATCH.
//
// Contrato descubierto probando la API (no está documentado):
//  · `shipping.carrier` tiene que ser un objeto no vacío CON `carrier_id` string.
//  · `shipping.carrier.code` es un enum: custom | api | locale | international |
//    native | default | draft | fallback | any.
//  · con `code: "api"` valida el carrier_id contra los instalados → "Carrier not
//    found"; con `code: "any"` acepta el que le pases y guarda todo.
//  · `consumer_cost` sí persiste por acá (por `POST /orders` no).
const TN_CARRIER_CODES = new Set(["custom", "api", "locale", "international", "native", "default", "draft", "fallback", "any"]);

export function buildFulfillmentShipping({ option_name, option_code, option_reference, carrier_id, carrier_code, carrier_name, shipping_price = 0, pickup = false } = {}) {
  const code = TN_CARRIER_CODES.has(String(carrier_code || "").trim()) ? String(carrier_code).trim() : "any";
  const shipping = {
    type: pickup ? "pickup" : "ship",
    carrier: {
      carrier_id: String(carrier_id || "recurrentes").slice(0, 64),
      code,
      ...(carrier_name ? { name: String(carrier_name).slice(0, 100) } : {}),
    },
    option: {
      ...(option_name ? { name: String(option_name).slice(0, 250) } : {}),
      code: String(option_code || "").slice(0, 100),
      ...(option_reference ? { reference: String(option_reference).slice(0, 100) } : {}),
    },
    consumer_cost: { value: r2(shipping_price), currency: "ARS" },
  };
  return shipping;
}

/**
 * Completa el envío de una orden recién creada. Best-effort: si falla, la orden
 * ya existe y está paga (el cobro se hizo), así que NUNCA lanza — devuelve el
 * error para que quien llama lo registre y avise.
 */
export async function tnSetFulfillmentShipping(storeId, token, orderId, shipping) {
  try {
    const { data } = await call(storeId, token, "GET", `/orders/${orderId}?aggregates=fulfillment_orders`);
    const fo = (data?.fulfillment_orders || [])[0];
    if (!fo?.id) return { ok: false, error: "la orden no tiene fulfillment order" };
    await call(storeId, token, "PATCH", `/orders/${orderId}/fulfillment-orders/${fo.id}`, { shipping }, { retry5xx: false });
    return { ok: true, fulfillment_order_id: fo.id };
  } catch (e) {
    return { ok: false, error: String(e.message).slice(0, 300) };
  }
}

export async function tnCreatePaidOrder(storeId, token, sub, params) {
  if (params.mp_payment_id && !params.simulated) {
    const prev = await tnFindOrderByPaymentId(storeId, token, params.mp_payment_id, sub?.customer_email);
    if (prev) {
      console.warn(`[tiendanube] orden ${prev.id} ya existía para mp_payment_id=${params.mp_payment_id}; no se crea otra`);
      return { id: prev.id, number: prev.number ?? null, reused: true };
    }
  }
  const body = buildTiendanubeOrderPayload(sub, params);
  let data;
  try {
    ({ data } = await call(storeId, token, "POST", "/orders", body, { retry5xx: false }));
  } catch (e) {
    // Sin stock: el cobro ya se hizo, la orden tiene que existir → sin reservar stock.
    if (e.status !== 422 || !STOCK_RE.test(e.message)) throw e;
    body.inventory_behaviour = "bypass";
    body.owner_note += "\nSIN-STOCK: la orden se creó sin descontar stock.";
    ({ data } = await call(storeId, token, "POST", "/orders", body, { retry5xx: false }));
  }
  if (!data?.id) throw new Error("Tiendanube no devolvió el id de la orden");
  return { id: data.id, number: data.number ?? null };
}

/**
 * fulfillCharge (api/_lib/sync.js) → canal "tiendanube". Mismo contrato que
 * createShopifyOrderForSub: { shopifyOrderId, orderStatusUrl, shopifyError }. El id de la
 * orden de Tiendanube va en el lugar de shopifyOrderId → chargeclaim, shopify_orders[] y
 * last_charge_at funcionan igual que con Shopify.
 *
 * El id de variante del plan viaja en plan_snapshot.shopify_variant_id (campo histórico:
 * es el "id de variante de la tienda", sea Shopify o Tiendanube; ver plans.js item_source).
 */
export async function createTiendanubeOrderForSub(merchant, subscriberId, sub, { payment_id, total_price, charge_number, mp_fee_real = null, requireAddress = false, extra = {} }, tag = "sync") {
  const out = { shopifyOrderId: null, orderStatusUrl: null, shopifyError: null };
  const addrOk = !!(sub.shipping_address?.address1 && sub.shipping_address?.city);
  // Plan manual (creado sin catálogo, antes de pasar a Tiendanube): no hay variante que
  // ordenar → comprobante interno, igual que el canal "none".
  if (sub.plan_snapshot?.item_source === "manual") {
    if (requireAddress && !addrOk) return { ...out, shopifyError: "Faltan datos: shipping_address.address1/city" };
    return { ...out, shopifyOrderId: internalFulfillmentId(payment_id) };
  }
  const variantId = sub.plan_snapshot?.tiendanube_variant_id || sub.plan_snapshot?.shopify_variant_id;
  if (merchant.tiendanube_token && merchant.tiendanube_store_id && variantId && (!requireAddress || addrOk)) {
    try {
      const order = await tnCreatePaidOrder(merchant.tiendanube_store_id, merchant.tiendanube_token, sub, {
        variant_id: variantId,
        quantity: sub.quantity || sub.plan_snapshot?.units_per_shipment || 1,
        total_price,
        shipping_price: sub.plan_snapshot?.shipping_price_ars ?? 0,
        shipping_method_name: sub.plan_snapshot?.shipping_method_name || "Envío a domicilio",
        subscriber_id: subscriberId,
        plan_id: sub.plan_id,
        charge_number,
        mp_payment_id: String(payment_id),
        mp_fee_real,
        tax_id: sub.customer_tax_id || null,
        tax_id_kind: sub.customer_tax_id_kind || "DNI",
        simulated: extra?.simulated === true,
      });
      out.shopifyOrderId = order.id;

      // El envío no entra por `POST /orders`: se completa acá, sobre el
      // fulfillment order, para que la app de envíos del comerciante vea el
      // servicio, la referencia y el costo igual que en una venta del checkout.
      // Best-effort: la orden ya está paga, así que un fallo acá se registra y
      // se avisa, pero nunca deshace ni bloquea el cobro.
      const snap = sub.plan_snapshot || {};
      if (!order.reused && (snap.shipping_method_code || snap.shipping_method_name)) {
        const ship = buildFulfillmentShipping({
          option_name: snap.shipping_method_name || "Envío a domicilio",
          option_code: snap.shipping_method_code || "",
          option_reference: snap.shipping_method_reference || "",
          carrier_id: snap.shipping_carrier_id || "recurrentes",
          carrier_code: snap.shipping_carrier_code || "any",
          carrier_name: snap.shipping_method_source || "",
          shipping_price: snap.shipping_price_ars ?? 0,
          pickup: String(snap.shipping_pickup_type || "") === "pickup",
        });
        const r = await tnSetFulfillmentShipping(merchant.tiendanube_store_id, merchant.tiendanube_token, order.id, ship);
        if (!r.ok) {
          out.shippingWarning = r.error;
          console.warn(`[${tag}] orden ${order.id} creada pero no pude completar el envío sub=${subscriberId}: ${r.error}`);
        }
      }
    } catch (e) {
      out.shopifyError = e.message;
      console.error(`[${tag}] error creando orden Tiendanube sub=${subscriberId}:`, e.message);
    }
  } else {
    const missing = [];
    if (!merchant.tiendanube_token) missing.push("tiendanube_token");
    if (!merchant.tiendanube_store_id) missing.push("tiendanube_store_id");
    if (!variantId) missing.push("plan_snapshot.shopify_variant_id");
    if (requireAddress && !addrOk) missing.push("shipping_address.address1/city");
    out.shopifyError = `Faltan datos: ${missing.join(", ")}`;
  }
  return out;
}
