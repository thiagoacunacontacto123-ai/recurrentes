// POST /api/checkout/init { merchant_id, plan_id, customer, shipping_address, quantity | pack_index }
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
//
// SEGURIDAD (auditoría 2026-09-12): el server NO confía en el cliente para el
// precio. `base_price` (modelo bundle) se valida contra el precio de lista de la
// variante en Shopify, `sub_discount` se capea al del plan, el envío se toma de
// la tarifa configurada por el merchant y la frecuencia sólo si el plan lo permite.
//
// PACKS (shared/bundle/SPEC.md, _lib/packs.js): si el plan está en
// `pricing_mode: "packs"`, el body SOLO manda `pack_index`. qty / subtotal /
// frecuencia salen del pack del plan (server-side); `base_price`, `sub_discount`,
// `frequency_days` y `quantity` del body se ignoran (se loguea si vinieron
// distintos). Sin pack_index → 400 "Elegí un pack". Planes "theme" (Lumina, el
// tema manda base/sub_off/freq_days por URL) siguen el flujo de computeSubtotal.
import { db } from "../_lib/firebase.js";
import { mpCreatePreapprovalPlan, mpReason } from "../_lib/mp.js";
import { generatePortalToken, verifyPortalToken, merchantStoreUrl } from "../public.js";
import { syncSubscriber } from "../_lib/sync.js";
import { verifyToken } from "../_lib/token.js";
import { rateLimit, clientIp } from "../_lib/ratelimit.js";
// Namespace import: shGetVariantPrice / shGetShopDomains los agrega otro agente.
// Si todavía no existen, el módulo carga igual y caemos al precio del plan.
import * as shopifyLib from "../_lib/shopify.js";
import { resolveCheckoutShippingRates, PLAN_SHIPPING_CODE } from "../widget.js";
import { isPacksPlan, resolvePack, parsePackIndex, defaultPackIndex } from "../_lib/packs.js";
import { klaviyoEnabled, klaviyoCheckoutStarted, klaviyoUpsertProfile, checkoutKeyFor, splitName } from "../_lib/klaviyo.js";
import { emitFlowEvent } from "../_lib/flows.js";
import { metaFunnel } from "../_lib/meta.js";
import { computeRecoverUrl } from "../_lib/abandoned.js";
import { merchantProfile, hostedCheckoutUrl } from "../../shared/platform/profile.js";
import { clampDiscountPct, discountAmountFor } from "../../shared/platform/discounts.js";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// Subs que ya son cliente: su perfil en Klaviyo no se degrada a "checkout_started".
const BLOCKING_STATUS = new Set(["active", "paused", "payment_failed"]);

// Klaviyo "Checkout Started" (mismo shape que un carrito de Shopify). Best-effort:
// nunca rompe ni demora de más el checkout (timeout 5s). No se repite por el mismo
// sub salvo que cambie el pack/qty/frecuencia (klaviyo_checkout_key; Klaviyo además
// dedupa por unique_id). Si ya salió con el lead, en Pagar solo completamos el
// perfil (nombre / teléfono / dirección) sin generar otro evento.
async function trackCheckoutStarted(merchantId, merchant, subRef, sub, existing, { stage, plan, blocking }) {
  if (!klaviyoEnabled(merchant)) return;
  try {
    const key = checkoutKeyFor(sub);
    if (existing?.klaviyo_checkout_key === key) {
      if (stage === "checkout") {
        const { firstName, lastName } = splitName(sub.customer_name);
        await klaviyoUpsertProfile(merchant, { email: sub.customer_email, phone: sub.customer_phone, firstName, lastName, address: sub.shipping_address, timeoutMs: 5000 });
      }
      return;
    }
    const recoverUrl = computeRecoverUrl(merchant, sub, { merchantId });
    const r = await klaviyoCheckoutStarted(merchant, merchantId, subRef.id, sub, {
      recoverUrl, imageUrl: plan?.product_image || null, stage, skipProfileStatus: blocking, timeoutMs: 5000,
    });
    if (r?.ok) await subRef.update({ klaviyo_checkout_key: key, klaviyo_checkout_at: new Date().toISOString() }).catch(() => {});
  } catch (e) { console.warn("[checkout/init] klaviyo Checkout Started falló:", e.message); }
}
const normEmail = (e) => String(e || "").trim().toLowerCase();
// Tope duro para lecturas a Shopify dentro del checkout: si tarda más, seguimos
// con el fallback (precio del plan / dominios cacheados). Pagar no depende de Shopify.
const withDeadline = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} > ${ms}ms`)), ms)),
]);
const normHost = (h) => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

// Precio de lista de la variante en Shopify, cacheado 10 min en
// merchants/{uid}/variant_prices/{variantId} para no pegarle a Shopify por checkout.
async function getVariantUnitPrice(merchantId, merchant, variantId) {
  if (!variantId || !merchant.shopify_shop || !merchant.shopify_token) return null;
  const ref = db().collection("merchants").doc(merchantId).collection("variant_prices").doc(String(variantId));
  try {
    const snap = await ref.get();
    if (snap.exists) {
      const c = snap.data();
      const age = Date.now() - new Date(c.fetched_at || 0).getTime();
      if (Number(c.price) > 0 && age < 10 * 60 * 1000) return Number(c.price);
    }
  } catch (_) {}
  if (typeof shopifyLib.shGetVariantPrice !== "function") return null;
  try {
    const p = Number(await withDeadline(shopifyLib.shGetVariantPrice(merchant.shopify_shop, merchant.shopify_token, String(variantId)), 4000, "shGetVariantPrice"));
    if (Number.isFinite(p) && p > 0) {
      await ref.set({ price: p, fetched_at: new Date().toISOString() }, { merge: true }).catch(() => {});
      return p;
    }
  } catch (e) { console.warn("[checkout/init] shGetVariantPrice falló:", e.message); }
  return null;
}

// Hosts confiables del merchant (myshopify + dominio primario). Cache 24h en
// merchant.shopify_domains / shopify_domains_at; se refresca si no matchea.
async function getShopDomains(merchantId, merchant, { force = false } = {}) {
  const cached = (Array.isArray(merchant.shopify_domains) ? merchant.shopify_domains : []).map(normHost).filter(Boolean);
  const at = new Date(merchant.shopify_domains_at || 0).getTime();
  const ageMs = Date.now() - at;
  if (cached.length && ageMs < 24 * 3600 * 1000 && !force) return cached;
  if (force && ageMs < 10 * 60 * 1000) return cached; // no refrescar más de 1 vez cada 10 min
  if (!merchant.shopify_shop || !merchant.shopify_token || typeof shopifyLib.shGetShopDomains !== "function") return cached;
  try {
    const list = ((await withDeadline(shopifyLib.shGetShopDomains(merchant.shopify_shop, merchant.shopify_token), 4000, "shGetShopDomains")) || []).map(normHost).filter(Boolean);
    // (#13) Si Shopify falló y solo volvió el myshopify, no cacheamos: así el
    // dominio primario se reintenta en el próximo checkout.
    const onlyMyshopify = list.length <= 1 && list.every(h => h.endsWith(".myshopify.com"));
    if (list.length && !onlyMyshopify) {
      const now = new Date().toISOString();
      await db().collection("merchants").doc(merchantId).set({ shopify_domains: list, shopify_domains_at: now }, { merge: true });
      merchant.shopify_domains = list; merchant.shopify_domains_at = now;
    }
    if (list.length) return list;
  } catch (e) { console.warn("[checkout/init] shGetShopDomains falló:", e.message); }
  return cached;
}

// event_source_url del navegador: sólo se guarda si el host es de la tienda
// (evita que un tercero use nuestros mails de abandono para phishing).
async function safeEventSourceUrl(merchantId, merchant, raw) {
  const url = String(raw || "").slice(0, 500);
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase(); } catch (_) { return null; }
  const shop = normHost(merchant.shopify_shop);
  const matches = (list) =>
    (shop && (host === shop || host.endsWith("." + shop))) ||
    list.some(d => host === d || host.endsWith("." + d));
  if (matches(await getShopDomains(merchantId, merchant))) return url;
  if (matches(await getShopDomains(merchantId, merchant, { force: true }))) return url;
  console.warn("[checkout/init] event_source_url rechazada:", host, "merchant", merchantId);
  return null;
}

// Subtotal del producto calculado server-side.
//  · Modelo BUNDLE (Lumina): el cliente manda `base_price` (precio del pack) +
//    `sub_discount`. Aceptamos base_price sólo si está dentro de la banda
//    [ref × (1 − max_pack_discount_pct), ref × 1.05], con ref = precio de lista
//    de la variante en Shopify × qty (o plan.base_price_ars × qty si Shopify falla).
//    sub_discount nunca supera plan.discount_pct.
//  · Modelo por unidad: subscription_price_ars × qty × tier por cantidad.
// Devuelve { subtotal, qtyDiscountPct, basePrice, subOff } o { error }.
async function computeSubtotal({ merchantId, merchant, plan, qty, base_price, sub_discount, variantId }) {
  const maxOff = Math.max(0, Math.min(90, parseFloat(plan.discount_pct) || 0));
  const subOffParsed = parseFloat(sub_discount);
  const subOff = Number.isFinite(subOffParsed) ? Math.max(0, Math.min(maxOff, subOffParsed)) : maxOff;
  const basePrice = Math.round(parseFloat(base_price) || 0);

  if (basePrice > 0) {
    // Referencias posibles: precio de lista de la variante en Shopify × qty y
    // plan.base_price_ars × qty. Alcanza con que la banda cierre contra UNA (si
    // el merchant baja el precio en Shopify en una promo, el plan sigue cubriendo).
    const refs = [];
    const unit = await getVariantUnitPrice(merchantId, merchant, variantId);
    if (unit > 0) refs.push({ ref: unit * qty, src: "shopify" });
    if ((parseFloat(plan.base_price_ars) || 0) > 0) refs.push({ ref: parseFloat(plan.base_price_ars) * qty, src: "plan" });
    if (!refs.length) {
      console.warn("[checkout/init] precio no verificable", { merchantId, planId: plan.id, variantId, basePrice, qty });
      return { error: "No pudimos verificar el precio del producto. Recargá la página e intentá de nuevo." };
    }
    // Default 50%: los packs reales (ej. Lumina 3 potes) descuentan hasta ~45%
    // sobre unidad × qty. El merchant puede ajustarlo por plan.
    const maxPackOff = Math.max(0, Math.min(90, parseFloat(plan.max_pack_discount_pct ?? 50) || 0));
    const okAgainst = refs.find(({ ref }) => basePrice >= Math.floor(ref * (1 - maxPackOff / 100)) && basePrice <= Math.ceil(ref * 1.05));
    if (!okAgainst) {
      console.warn("[checkout/init] base_price RECHAZADO", { merchantId, planId: plan.id, variantId, basePrice, qty, refs, maxPackOff });
      return { error: "El precio del pack no coincide con el de la tienda. Recargá la página e intentá de nuevo." };
    }
    return { subtotal: Math.round(basePrice * (1 - subOff / 100)), qtyDiscountPct: subOff, basePrice, subOff };
  }

  const unitPrice = parseFloat(plan.subscription_price_ars) || 0;
  const tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
  let qtyDiscountPct = 0, bestMin = -1;
  for (const t of tiers) {
    const mq = parseInt(t && t.min_qty) || 0;
    if (qty >= mq && mq > bestMin) { bestMin = mq; qtyDiscountPct = Math.max(0, Math.min(90, parseFloat(t.discount_pct) || 0)); }
  }
  return { subtotal: Math.round(unitPrice * qty * (1 - qtyDiscountPct / 100)), qtyDiscountPct, basePrice: 0, subOff: 0 };
}

// Frecuencia: la del cliente sólo si el plan lo permite, coincide con la del
// plan, o es un múltiplo entero (1..12×) de la del plan (modelo bundle: el pack
// de N unidades se cobra cada N × frecuencia; Lumina manda qty × 60).
function resolveFrequency(plan, frequency_days) {
  const planFreq = parseInt(plan.frequency_days) || 30;
  const f = parseInt(frequency_days);
  const valid = Number.isFinite(f) && f >= 1 && f <= 365;
  if (!valid) return planFreq;
  if (plan.allow_custom_frequency === true || f === planFreq) return f;
  if (f % planFreq === 0 && f / planFreq <= 12) return f;
  return planFreq;
}

// Tarifas de envío del checkout del merchant: configuradas > default histórico
// (solo merchants legacy, anteriores al corte) > [] (merchants nuevos: el envío
// sale del plan, code PLAN). Misma resolución que usa el embed (widget.js).
function merchantShippingRates(merchant) {
  return resolveCheckoutShippingRates(merchant);
}

// Path (sin host) para volver al checkout con el mismo pack. abandoned.js le
// antepone el dominio confiable de la tienda.
//  · Modo packs (extra.pack_index): ?merchant=&product=&variant=&plan=&pack= — sin
//    base/sub_off/qty/freq_days (el embed los resuelve desde el plan).
//  · Modo theme: como siempre (qty + freq_days + base/sub_off).
function buildRecoverPath(merchant, plan, planId, qty, extra = {}) {
  // Un solo checkout (el de Recurrentes): el path es del hash del SPA. abandoned.js
  // lo cuelga de APP_BASE_URL y mete el ?rc= dentro del hash.
  const base = "/#/checkout";
  const sp = new URLSearchParams();
  if (extra.merchant_id) sp.set("merchant", String(extra.merchant_id));
  if (extra.pack_index != null) {
    sp.set("product", String(plan.shopify_product_id || ""));
    sp.set("variant", String(plan.shopify_variant_id || ""));
    sp.set("plan", String(planId));
    sp.set("pack", String(extra.pack_index));
    return `${base}?${sp.toString()}`;
  }
  sp.set("plan", String(planId));
  sp.set("qty", String(qty));
  if (extra.freq_days) sp.set("freq_days", String(extra.freq_days));
  if (extra.base > 0) { sp.set("base", String(extra.base)); sp.set("sub_off", String(extra.sub_off || 0)); }
  return `${base}?${sp.toString()}`;
}

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
    let storeUrl = null;
    try {
      const mSnap = await db().collection("merchants").doc(payload.mid).get();
      storeUrl = merchantStoreUrl(mSnap.exists ? mSnap.data() : null);
    } catch (_) {}
    try {
      // Si hay payment_id hint, hacemos link directo PRIMERO (más rápido).
      // Rate limit por sub (10/h): la verificación fuerte del pago la hace sync.js.
      if (paymentHint) {
        const rl = await rateLimit(`link:${subId}`, { limit: 10, windowSec: 3600 });
        if (rl.ok) {
          const { linkPaymentToSubscriber } = await import("../_lib/sync.js");
          try {
            const linkResult = await linkPaymentToSubscriber(payload.mid, subId, paymentHint);
            if (linkResult.status === "linked" || linkResult.status === "already_linked") {
              return res.json({ ok: true, merchant_store_url: storeUrl, ...linkResult });
            }
          } catch (_) { /* fallback al sync normal */ }
        }
      }
      const r = await syncSubscriber(payload.mid, subId);
      return res.json({ ok: true, merchant_store_url: storeUrl, ...r });
    } catch (e) {
      console.error("[checkout/sync] error:", e.message);
      return res.status(500).json({ error: "No pudimos verificar el pago todavía. Probá de nuevo en unos segundos.", merchant_store_url: storeUrl });
    }
  }

  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { merchant_id, plan_id, customer, shipping_address, quantity, shipping_method, frequency_days, base_price, sub_discount, discount_code, recovery_token } = req.body || {};
  if (!merchant_id || !plan_id) return res.status(400).json({ error: "Faltan merchant_id o plan_id" });
  const merchantId = String(merchant_id);
  const ip = clientIp(req);
  // Datos de atribución de Meta que capturó el navegador (fbp/fbc/URL del producto/UA).
  const fbIn = (req.body.fb && typeof req.body.fb === "object") ? {
    fbc: String(req.body.fb.fbc || "").slice(0, 255),
    fbp: String(req.body.fb.fbp || "").slice(0, 255),
    event_source_url: String(req.body.fb.event_source_url || "").slice(0, 500),
    user_agent: String(req.body.fb.user_agent || "").slice(0, 500),
  } : null;

  // ── "CARRITO" (Meta AddToCart): el checkout se abrió. Sin mail todavía. ──────────
  // Lo llama Checkout.jsx apenas carga el plan. Solo le avisa a Meta si la tienda tiene
  // el pixel conectado; no guarda nada en Firestore. Best-effort, siempre 200.
  if (req.body.event === "view") {
    const rlV = await rateLimit(`view:${merchantId}:${ip}`, { limit: 120, windowSec: 3600 });
    if (!rlV.ok) return res.json({ ok: false });
    try {
      const mSnap = await db().collection("merchants").doc(merchantId).get();
      const mData = mSnap.exists ? mSnap.data() : null;
      if (mData?.meta_pixel_id && mData?.meta_capi_token) {
        const viewId = String(req.body.view_id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64) || `${Date.now()}`;
        await metaFunnel(mData, "AddToCart", { fb: fbIn, clientIp: ip, value: Math.max(0, Number(req.body.value) || 0), eventId: "rec_atc_" + viewId, tag: "checkout/view" });
      }
    } catch (e) { console.warn("[checkout/init] view:", e.message); }
    return res.json({ ok: true });
  }

  if (!customer?.email) return res.status(400).json({ error: "Falta customer.email" });
  // Email normalizado (trim + lowercase) en TODOS los caminos.
  const email = normEmail(customer.email);
  if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: "Email inválido" });

  // Cantidad capada 1..10 (0 = usar units_per_shipment del plan).
  const qtyReq = Math.max(0, Math.min(10, parseInt(quantity) || 0));

  // Cargar merchant + plan (plan tiene que existir y estar activo, también para leads).
  const merchantRef = db().collection("merchants").doc(merchantId);
  const merchantSnap = await merchantRef.get();
  if (!merchantSnap.exists) return res.status(404).json({ error: "Merchant no encontrado" });
  const merchant = merchantSnap.data();

  // Límite del plan gratis: con más de 15 suscriptores activos y sin plan al día
  // NO entran suscripciones nuevas (ni leads: no tiene sentido guardar carritos de
  // una tienda que no puede vender). El widget ya no se pinta, pero esto cierra
  // también el endpoint directo. Las suscripciones que YA cobran no se tocan.
  try {
    const { enforcementOf } = await import("../_lib/plans_saas.js");
    const cached = Number(merchant?.billing_cache?.subs);
    // Sin cache no bloqueamos: nunca cortamos una venta por una duda nuestra.
    if (Number.isFinite(cached) && !enforcementOf(merchant, cached).sell) {
      return res.status(402).json({ error: "Esta tienda no está recibiendo suscripciones nuevas en este momento.", code: "plan_required" });
    }
  } catch (e) { console.warn("[checkout] enforcement:", e.message); }

  const planSnap = await merchantRef.collection("plans").doc(String(plan_id)).get();
  if (!planSnap.exists) return res.status(404).json({ error: "Plan no encontrado" });
  const plan = { id: planSnap.id, ...planSnap.data() };
  if (!plan.active) return res.status(400).json({ error: "Plan inactivo" });
  const subsCol = merchantRef.collection("subscribers");

  // ── Packs (bundle) ────────────────────────────────────────────────────────
  // Plan en modo packs: el body manda `pack_index`; qty/precio/frecuencia salen
  // del pack. Sin pack_index → 400 en Pagar; en capture (lead) usamos el default
  // para no perder el carrito.
  const packsMode = isPacksPlan(plan);
  let pack = null;
  if (packsMode) {
    let idx = parsePackIndex(req.body.pack_index);
    if (idx == null) {
      if (req.body.capture !== true) return res.status(400).json({ error: "Elegí un pack" });
      idx = defaultPackIndex(plan);
    }
    pack = resolvePack(plan, idx);
    if (!pack) return res.status(400).json({ error: "Pack inválido" });
    // Este endpoint SOLO crea suscripciones (la compra unica va por el carrito
    // del tema). Si el comerciante escondio este pack en suscripcion, no se
    // puede suscribir a el ni mandando el indice a mano. 22-sept-2026.
    if (pack.hideSub) return res.status(400).json({ error: "Ese pack no está disponible para suscripción" });
    // Campos del modelo "theme" que puedan venir en el body: se IGNORAN.
    const ignored = {};
    if (quantity != null && quantity !== "" && (parseInt(quantity) || 0) !== pack.subQty) ignored.quantity = quantity;
    if (base_price != null && base_price !== "" && Math.round(parseFloat(base_price) || 0) !== pack.price) ignored.base_price = base_price;
    if (sub_discount != null && sub_discount !== "") ignored.sub_discount = sub_discount;
    if (frequency_days != null && frequency_days !== "" && (parseInt(frequency_days) || 0) !== pack.freq) ignored.frequency_days = frequency_days;
    if (Object.keys(ignored).length) console.warn("[checkout/init] modo packs: campos del body ignorados", { merchantId, planId: plan.id, pack_index: pack.idx, ignored });
  }
  // Precio del pack (server-side): subtotal = sub_price del pack; qtyDiscountPct
  // = ahorro efectivo vs precio tachado (informativo). Misma forma que computeSubtotal.
  const packPricing = () => ({
    subtotal: pack.subPrice,
    qtyDiscountPct: pack.savingsPct,
    basePrice: pack.price,
    subOff: Math.max(0, Math.min(90, parseFloat(plan.discount_pct) || 0)),
  });
  // merchant_id SIEMPRE: el checkout de Recurrentes lo exige y sin él el link de
  // "carrito sin pagar" (mail/WhatsApp) caía en "Faltan datos" (bug 18-sept, modo clásico).
  const recoverExtra = (pr) => pack
    ? { pack_index: pack.idx, merchant_id: merchantId }
    : { merchant_id: merchantId, freq_days: freqDays, base: pr.basePrice, sub_off: pr.subOff };
  const packSnapshot = pack ? { pricing_mode: "packs", pack_index: pack.idx, pack_label: pack.label || null } : {};

  // pack.subQty = la cantidad de suscripcion (por defecto, la misma que la de
  // compra unica). Como acá solo se crean suscripciones, es la que manda.
  const finalQty = pack ? pack.subQty : (qtyReq || parseInt(plan.units_per_shipment) || 1);
  const freqDays = pack ? pack.freq : resolveFrequency(plan, frequency_days);
  // La variante que se factura es la que ELIGIÓ el cliente en la página del
  // producto (22-sept-2026, Thiago: "no tenemos ningún plan si tiene muchos
  // sabores"). Un plan cubre todas las variantes del producto: el widget manda
  // la del selector y esa es la que va a la orden, así el que compra frutilla
  // recibe frutilla.
  //
  // Solo se acepta si es un id de variante con forma válida; si viene vacío o
  // raro, se usa la del plan. El precio se valida igual contra Shopify más
  // abajo (getVariantUnitPrice), así que una variante inventada no sirve para
  // pagar menos: se cobra lo que Shopify diga que vale.
  const variantPedida = String(req.body.shopify_variant_id || "").trim();
  const variantId = /^\d{6,20}$/.test(variantPedida)
    ? variantPedida
    : String(plan.shopify_variant_id || "");

  // ── CAPTURA DE LEAD (carrito abandonado ANTES de tocar Pagar) ────────────────
  // El widget llama esto apenas el cliente escribe un email válido en el checkout.
  // Guardamos un subscriber "pending" liviano (capture:true) con lo que haya + el
  // path de recupero (server-side). Así, si NO paga, el flujo de carrito abandonado
  // lo levanta igual. NO crea plan MP ni exige dirección/teléfono. Reusa el lead del
  // mismo mail para no duplicar por cada tecla. Si ya hay un checkout "real" (con
  // plan MP) de ese mail, no hace nada.
  if (req.body.capture === true) {
    // Honeypot: campo oculto "rc_hp_9" — si viene lleno es un bot. 200 sin guardar.
    if (String(req.body.rc_hp_9 || "").trim()) return res.json({ ok: true });
    // Rate limit por IP y por merchant → 429 silencioso (200 ok:false).
    const rlIp = await rateLimit(`capture:${merchantId}:${ip}`, { limit: 60, windowSec: 3600 });
    if (!rlIp.ok) return res.json({ ok: false });
    const rlM = await rateLimit(`capture:${merchantId}`, { limit: 600, windowSec: 3600 });
    if (!rlM.ok) return res.json({ ok: false });
    try {
      // Buscar subs pending del mismo mail (query 1 campo → sin índice compuesto).
      const q = await subsCol.where("customer_email", "==", email).get();
      let leadRef = null, leadData = null, hasReal = false, hasBlocking = false;
      q.forEach(d => {
        const x = d.data();
        if (BLOCKING_STATUS.has(x.status)) hasBlocking = true;
        if (x.status !== "pending") return;
        if (x.mp_preapproval_plan_id) hasReal = true;   // ya arrancó checkout real
        else if (x.capture === true && !leadRef) { leadRef = d.ref; leadData = x; }
      });
      if (hasReal) return res.json({ ok: true, skipped: "already_in_checkout" });

      // Precio para el mail de abandono: misma validación que Pagar; si no pasa,
      // caemos al precio del plan (el lead no cobra nada).
      let pr;
      if (pack) pr = packPricing();
      else {
        pr = await computeSubtotal({ merchantId, merchant, plan, qty: finalQty, base_price, sub_discount, variantId });
        if (pr.error) pr = await computeSubtotal({ merchantId, merchant, plan, qty: finalQty, base_price: 0, sub_discount, variantId });
      }
      const totalCapture = pr.subtotal || 0;
      const eventUrl = await safeEventSourceUrl(merchantId, merchant, req.body.fb?.event_source_url);

      const data = {
        customer_email: email,
        customer_name: String(customer.name || "").trim().slice(0, 120),
        customer_phone: String(customer.phone || "").trim().slice(0, 40),
        plan_id: plan.id,
        quantity: finalQty,
        plan_snapshot: {
          shopify_variant_id: variantId || plan.shopify_variant_id || null,
          shopify_product_id: plan.shopify_product_id || null,
          product_title: plan.product_title || "Suscripción",
          frequency_days: freqDays,
          total_per_charge_ars: totalCapture,
          ...packSnapshot,
        },
        status: "pending",
        capture: true,
        fb_data: (eventUrl || fbIn) ? { event_source_url: eventUrl || null, fbc: fbIn?.fbc || "", fbp: fbIn?.fbp || "", user_agent: fbIn?.user_agent || "", client_ip_address: ip || null } : null,
        recover_path: buildRecoverPath(merchant, plan, plan.id, finalQty, recoverExtra(pr)),
        updated_at: new Date().toISOString(),
      };
      let ref = leadRef, out;
      if (leadRef) { await leadRef.update(data); out = { ok: true, lead_id: leadRef.id, updated: true }; }
      else {
        ref = subsCol.doc();
        await ref.set({ ...data, created_at: new Date().toISOString(), shopify_orders: [] });
        out = { ok: true, lead_id: ref.id, created: true };
      }
      // Klaviyo "Checkout Started" (igual que un carrito de Shopify) con el link para retomar.
      await trackCheckoutStarted(merchantId, merchant, ref, data, leadData, { stage: "lead", plan, blocking: hasBlocking });
      // Flujos de email propios ("Checkout sin pagar"). No-op sin flujos activos.
      await emitFlowEvent(merchantId, merchant, "checkout_started", ref.id, data, { key: ref.id });
      // Meta "pago iniciado": dejó el mail. Mismo event_id que en Pagar → Meta deduplica.
      await metaFunnel(merchant, "InitiateCheckout", { fb: fbIn, clientIp: ip, value: totalCapture, email, phone: data.customer_phone, firstName: splitName(data.customer_name).firstName, lastName: splitName(data.customer_name).lastName, eventId: "rec_ic_" + ref.id, tag: "checkout/lead" });
      return res.json(out);
    } catch (e) {
      console.error("[checkout/init] capture error:", e.message);
      return res.status(500).json({ error: "No se pudo registrar el carrito" });
    }
  }

  // ── PAGAR ───────────────────────────────────────────────────────────────────
  const rlInit = await rateLimit(`init:${merchantId}:${ip}`, { limit: 30, windowSec: 3600 });
  if (!rlInit.ok) return res.status(429).json({ error: "Demasiados intentos. Esperá unos minutos y volvé a intentar." });
  // Pasarela alternativa (api/_lib/providers): solo si el merchant tiene payment_provider ≠
  // mercadopago Y el flag de esa pasarela está prendido. Sin el campo (Lumina) → null, sin cargar nada.
  const altProvider = (merchant.payment_provider && merchant.payment_provider !== "mercadopago")
    ? await (await import("../_lib/providers/index.js")).checkoutProviderFor(merchant)
    : null;
  if (!altProvider && !merchant.mp_access_token) return res.status(400).json({ error: "El comerciante no conectó MP" });

  // VALIDACIÓN ESTRICTA — bloqueamos avance a MP si falta cualquier dato de
  // contacto/dirección. Esto previene que un cliente complete el pago y
  // después la orden Shopify quede sin dirección (caso real: orden #4319 de
  // Alberto perez 7-jun-2026). El widget ya valida en JS, pero si el cliente
  // tiene cache vieja del widget, JS bloqueado, o entra por un flow raro,
  // necesitamos defensa server-side igual.
  // Perfil del negocio (shared/platform/profile.js): sin envío (servicios, digitales)
  // no pedimos dirección y teléfono / DNI son opcionales. Merchants históricos son
  // "físicos": exactamente las mismas validaciones de siempre.
  const profile = merchantProfile(merchant);
  const caps = profile.caps;
  const customerName = String(customer.name || "").trim();
  const customerPhone = String(customer.phone || "").trim();
  if (!customerName) return res.status(400).json({ error: "Falta nombre del cliente" });
  if (caps.requirePhone && !customerPhone) return res.status(400).json({ error: "Falta teléfono del cliente" });

  const addr = shipping_address || {};
  if (caps.requireAddress) {
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
  }

  // Sanitizar tax_id: solo dígitos. DNI (7-8) o CUIL/CUIT (11). Con envío es
  // obligatorio para facturación AR — lo guardamos en el subscriber + lo pasamos a
  // la orden Shopify (note_attributes + customer tag) cuando se cree. Sin envío es
  // opcional, pero si viene tiene que ser válido.
  const taxIdClean = String(customer.tax_id || "").replace(/[^0-9]/g, "");
  const taxIdValid = taxIdClean.length === 7 || taxIdClean.length === 8 || taxIdClean.length === 11;
  if (caps.requireTaxId ? !taxIdValid : (taxIdClean && !taxIdValid)) {
    return res.status(400).json({ error: "DNI o CUIL/CUIT inválido (debe ser 7-8 dígitos para DNI, 11 para CUIL/CUIT)" });
  }
  const taxIdKind = taxIdClean ? (taxIdClean.length === 11 ? "CUIT" : "DNI") : null;

  const unitPrice = parseFloat(plan.subscription_price_ars) || 0;

  // ── Precio de la suscripción (server-side, ver computeSubtotal) ────────────
  const pr = pack ? packPricing() : await computeSubtotal({ merchantId, merchant, plan, qty: finalQty, base_price, sub_discount, variantId });
  if (pr.error) return res.status(400).json({ error: pr.error });
  let subtotal = pr.subtotal;
  const qtyDiscountPct = pr.qtyDiscountPct;
  const subtotalBeforeCode = subtotal;

  // ── Código de descuento (opcional) ────────────────────────────────────────
  // Los códigos los define el comerciante (merchant.discount_codes). Se validan
  // SIEMPRE server-side y aplican sobre el subtotal del producto (no el envío).
  //  · `recovery_only:true` → sólo con `recovery_token` (rc firmado del mail de
  //    abandono, atado a merchant + email), nunca por ?code= en claro.
  //  · `first_charge_only:true` → guardamos el precio pleno para que sync lo
  //    suba después del primer cobro.
  let discountCodeApplied = null, discountCodePct = 0, discountFirstOnly = false;
  let rawCode = String(discount_code || "").trim().toUpperCase().slice(0, 40);
  let viaRecovery = false;
  if (recovery_token) {
    const rc = verifyToken(String(recovery_token));
    if (!rc || rc.m !== merchantId || !rc.c) {
      return res.status(400).json({ error: "El link de recupero venció o no es válido. Podés continuar sin el cupón." });
    }
    if (normEmail(rc.e) !== email) {
      return res.status(400).json({ error: "El cupón de recupero es para otro email. Usá el mismo email al que te llegó el mail." });
    }
    rawCode = String(rc.c).trim().toUpperCase().slice(0, 40);
    viaRecovery = true;
  }
  if (rawCode) {
    const codes = Array.isArray(merchant.discount_codes) ? merchant.discount_codes : [];
    const hit = codes.find(c => String(c.code || "").trim().toUpperCase() === rawCode && c.active !== false);
    if (hit && (!hit.recovery_only || viaRecovery)) {
      // Misma cuenta que hace el checkout en el navegador (módulo compartido):
      // si difieren, el comprador ve un precio y Mercado Pago le cobra otro.
      const type = hit.type || "percent";
      if (type === "percent") discountCodePct = clampDiscountPct(hit.value);
      subtotal = Math.max(0, subtotal - discountAmountFor(subtotal, hit));
      discountCodeApplied = rawCode;
      discountFirstOnly = false; // 19-sept-2026 (Thiago): el descuento vale para toda la suscripción; nunca se reprecia el preapproval
    } else if (hit && hit.recovery_only) {
      console.warn("[checkout/init] código recovery_only sin rc:", rawCode, merchantId);
    }
  }

  // ── Envío ─────────────────────────────────────────────────────────────────
  // El método viene del body sólo como NOMBRE/CODE: el precio se toma SIEMPRE de
  // la tarifa configurada del merchant (checkout_shipping_rates o el default legacy).
  // code PLAN (o sin match) → envío del plan (fijo + envío gratis desde $X), con
  // el MISMO nombre que muestra el embed (plan.shipping_method_name || "Envío a domicilio").
  const freeShippingFrom = parseFloat(plan.free_shipping_from_ars) || 0;
  let shippingCost, shippingName, shippingCode = "", shippingSource = "";
  let matchedRate = null;
  if (caps.shipping && shipping_method && typeof shipping_method === "object" && (shipping_method.name || shipping_method.code)) {
    const wantName = String(shipping_method.name || "").trim().toLowerCase();
    const wantCode = String(shipping_method.code || "").trim();
    const wantsPlanRate = wantCode === PLAN_SHIPPING_CODE;

    // Las tarifas de una app de envíos traen un code estructurado
    // (`envialo:andreani:andreani_pickup:ship:12218`); las manuales del
    // comerciante, un nombre o nada. Solo recotizamos en el primer caso, así las
    // tiendas sin app de envíos no pagan una llamada extra a Shopify.
    const looksCarrier = wantCode.includes(":");
    // Mismo interruptor que el endpoint de tarifas: sin `shipping_live_quotes` no
    // cotizamos nada y el envío se resuelve como siempre. Ver api/shopify.js.
    // Siempre que haya Shopify conectado y variante: sin interruptor, igual que una venta común.
    const puedeCotizar = !!(merchant.shopify_shop && merchant.shopify_token && plan.shopify_variant_id);

    // 1) Opción de una app de envíos: RE-COTIZAMOS contra Shopify y usamos su
    //    precio, nunca el que mandó el navegador. Así la orden sale con el `code`
    //    (que lleva el id de la sucursal) y el `source` del carrier, y su app la
    //    despacha igual que una venta del checkout.
    if (!wantsPlanRate && looksCarrier && puedeCotizar) {
      try {
        const quoted = await shopifyLib.shQuoteShippingRates(merchant.shopify_shop, merchant.shopify_token, {
          variantId: plan.shopify_variant_id,
          quantity: finalQty,
          address: { zip: addr.zip, city: addr.city, province: addr.province, address1: addr.address1 },
        });
        matchedRate = quoted.find(r => wantCode && String(r.code || "").trim() === wantCode)
          || quoted.find(r => wantName && String(r.name || "").trim().toLowerCase() === wantName)
          || null;
        if (matchedRate) shippingSource = String(matchedRate.source || "");
      } catch (e) {
        console.warn("[checkout/init] no pude recotizar el envío:", e.message);
      }
    }

    // 2) Tarifas manuales del comerciante (tiendas sin app de envíos).
    if (!matchedRate && !wantsPlanRate) {
      const rates = merchantShippingRates(merchant);
      matchedRate = rates.find(r => wantCode && String(r.code || "").trim() && String(r.code).trim() === wantCode)
        || rates.find(r => wantName && String(r.name || "").trim().toLowerCase() === wantName)
        || null;
      if (!matchedRate && rates.length) console.warn("[checkout/init] shipping_method sin match, uso envío del plan:", { merchantId, name: wantName, code: wantCode, bodyPrice: shipping_method.price });
    }

    // 3) Último intento: el comerciante tiene app de envíos pero el navegador
    //    mandó solo el nombre (embed viejo, o tarifa importada sin code).
    if (!matchedRate && !wantsPlanRate && !looksCarrier && puedeCotizar) {
      try {
        const quoted = await shopifyLib.shQuoteShippingRates(merchant.shopify_shop, merchant.shopify_token, {
          variantId: plan.shopify_variant_id,
          quantity: finalQty,
          address: { zip: addr.zip, city: addr.city, province: addr.province, address1: addr.address1 },
        });
        matchedRate = quoted.find(r => wantName && String(r.name || "").trim().toLowerCase() === wantName) || null;
        if (matchedRate) shippingSource = String(matchedRate.source || "");
      } catch (e) {
        console.warn("[checkout/init] no pude recotizar el envío por nombre:", e.message);
      }
    }
  }
  if (!caps.shipping) {
    // Sin envío (servicios, digitales): el cobro es solo el plan.
    shippingCost = 0;
    shippingName = "";
  } else if (matchedRate) {
    shippingCost = Math.max(0, Math.round(Number(matchedRate.price) || 0));
    // Nombre EXACTO de la tarifa (hasta 250 = límite de Shopify). Las apps de
    // envío como Envialo matchean el método por nombre + code exacto.
    shippingName = String(matchedRate.name).slice(0, 250);
    shippingCode = String(matchedRate.code || "").slice(0, 250);
    shippingSource = String(matchedRate.source || shippingSource || "").slice(0, 100);
  } else if (merchant.shopify_shop || merchant.tiendanube_store_id) {
    // Tienda conectada: el envío SIEMPRE sale de la tienda (21-sept, Thiago).
    // Si llegamos acá es que no pudimos matchear ninguna tarifa real (el
    // comprador mandó una que ya no existe, o la cotización falló). Cobrar acá
    // la tarifa vieja del plan es peor que no cobrar envío: le saldría un precio
    // que su tienda no cobra, y la orden iría con un método que su app de envíos
    // no sabe despachar. Preferimos envío en 0 y que lo resuelva al despachar.
    if (parseFloat(plan.shipping_price_ars) > 0) {
      console.warn("[checkout/init] sin tarifa real, ignoro el envío del plan:", { merchantId, planShipping: plan.shipping_price_ars });
    }
    shippingCost = 0;
    shippingName = String(shipping_method?.name || "").trim().slice(0, 250) || "Envío";
  } else {
    // Sin tienda (ítem manual / venta por link): el envío del plan es lo único que hay.
    const shippingPrice = parseFloat(plan.shipping_price_ars) || 0;
    shippingCost = (freeShippingFrom > 0 && subtotal >= freeShippingFrom) ? 0 : shippingPrice;
    shippingName = plan.shipping_method_name || "Envío a domicilio";
  }

  // Subtotal 0 o menor al envío (cupón fijo) → MP cobraría algo que Shopify no
  // puede facturar. Rechazamos.
  if (!(subtotal > 0) || subtotal <= shippingCost) {
    console.warn("[checkout/init] subtotal inválido", { merchantId, subtotal, shippingCost, code: discountCodeApplied });
    return res.status(400).json({ error: "El total de la suscripción no es válido con ese descuento. Sacá el cupón e intentá de nuevo." });
  }

  // ── Extras ("Sumá a tu suscripción", 25-sept-2026) ─────────────────────────
  // El comprador puede sumar otros planes de la tienda (los que ella eligió en
  // Configuración → Checkout). Precio y variante salen del PLAN en el server, nunca
  // del body: el body solo trae { plan_id, qty }. Van al cobro de MP y a cada orden.
  const extraItems = [];
  {
    const allowed = new Set(Array.isArray(merchant.checkout_upsells) ? merchant.checkout_upsells : []);
    const raw = Array.isArray(req.body.extras) ? req.body.extras.slice(0, 4) : [];
    for (const e of raw) {
      const pid = String(e?.plan_id || "").trim(), q = Math.max(1, Math.min(5, parseInt(e?.qty, 10) || 1));
      if (!pid || pid === plan.id || !allowed.has(pid)) continue;
      const ps = await db().collection("merchants").doc(merchantId).collection("plans").doc(pid).get();
      if (!ps.exists || ps.data().active === false) continue;
      const pd = ps.data(); const price = Math.round(Number(pd.subscription_price_ars) || 0);
      if (!(price > 0)) continue;
      extraItems.push({ plan_id: pid, shopify_variant_id: pd.shopify_variant_id ? String(pd.shopify_variant_id) : null, shopify_product_id: pd.shopify_product_id || null, product_title: pd.product_title || "Producto", qty: q, price_ars: price });
    }
  }
  const extrasTotal = extraItems.reduce((a, x) => a + x.price_ars * x.qty, 0);
  const giftItems = pack && Array.isArray(pack.gifts)
    ? pack.gifts.filter(g => g && !g.virtual && g.shopify_variant_id).map(g => ({ shopify_variant_id: String(g.shopify_variant_id), shopify_product_id: g.shopify_product_id || null, title: String(g.title || "Regalo").slice(0, 80), every: g.every === "once" ? "once" : "always" }))
    : [];

  const totalPerCharge = subtotal + shippingCost + extrasTotal;
  const fullPricePerCharge = subtotalBeforeCode + shippingCost + extrasTotal;

  // ── Subscriber pending ────────────────────────────────────────────────────
  // Reuso (en este orden), para no duplicar carritos ni planes MP:
  //  1) sub REAL pending del mismo mail + plan, sin cobro, creada hace < 24h con
  //     plan MP → mismo doc (regeneramos el plan MP si cambió monto/frecuencia y
  //     guardamos el anterior en mp_preapproval_plan_id_prev).
  //  2) lead (capture:true) del mismo mail → se convierte en sub real.
  //  3) doc nuevo.
  // Siempre update() (o set merge): NO pisamos created_at / abandoned_step /
  // abandoned_step_at para no reiniciar la secuencia de abandono.
  let subRef = null, existing = null, isNew = false, hasBlocking = false;
  try {
    const dq = await subsCol.where("customer_email", "==", email).get();
    let real = null, lead = null;
    dq.forEach(d => {
      const x = d.data();
      if (BLOCKING_STATUS.has(x.status)) hasBlocking = true;
      if (x.status !== "pending") return;
      if (x.mp_preapproval_plan_id) {
        const ageMs = Date.now() - new Date(x.created_at || 0).getTime();
        // Solo reusamos intentos que NUNCA llegaron a autorizar en MP: si ya hay
        // preapproval (o forzamos cobro), ese doc tiene que seguir su vida sola.
        const untouched = !x.mp_preapproval_id && x.mp_preapproval_status !== "authorized" && !x.sync_force_attempted;
        if (untouched && x.plan_id === plan.id && !x.last_charge_at && ageMs < 24 * 3600 * 1000 && (!real || (x.created_at || "") > (real.data.created_at || ""))) real = { ref: d.ref, data: x };
      } else if (x.capture === true && !lead) lead = { ref: d.ref, data: x };
    });
    if (real) { subRef = real.ref; existing = real.data; }
    else if (lead) { subRef = lead.ref; existing = lead.data; }
  } catch (_) {}
  if (!subRef) { subRef = subsCol.doc(); isNew = true; }
  const subscriberId = subRef.id;

  const eventUrl = await safeEventSourceUrl(merchantId, merchant, req.body.fb?.event_source_url);
  const nowIso = new Date().toISOString();
  const subData = {
    // WhatsApp: solo si el checkout mostró la casilla (tienda con WhatsApp prendido). Sin el
    // campo en el body (widget de Lumina) el doc queda exactamente igual que antes.
    ...(typeof req.body?.whatsapp_optin === "boolean" ? { whatsapp_optin: req.body.whatsapp_optin, whatsapp_optin_at: nowIso } : {}),
    customer_email: email,
    customer_name: customerName.slice(0, 120),
    customer_phone: customerPhone.slice(0, 40),
    customer_tax_id: taxIdClean || null,
    customer_tax_id_kind: taxIdKind, // "DNI" | "CUIT" | null (opcional en negocios sin envío)
    // Shipping address sanitizada — con envío, la validación previa garantiza que
    // address1/city/province/zip nunca sean undefined o "". Sin envío: null.
    shipping_address: caps.requireAddress ? {
      address1:   String(addr.address1).trim(),
      address2:   String(addr.address2 || "").trim(),
      city:       String(addr.city).trim(),
      province:   String(addr.province).trim(),
      zip:        String(addr.zip).trim(),
      country:    String(addr.country || "Argentina").trim(),
      first_name: customerName.split(" ")[0] || "",
      last_name:  customerName.split(" ").slice(1).join(" ") || "",
      phone:      customerPhone,
    } : null,
    // Sin tienda (link de suscripción): a dónde vuelve el cliente para retomar el
    // checkout (abandoned.js recoverTarget → evento "Checkout Started" de Klaviyo).
    hosted_checkout_url: caps.link && process.env.APP_BASE_URL ? hostedCheckoutUrl(process.env.APP_BASE_URL.replace(/\/+$/, ""), merchantId, plan.id) : null,
    plan_id: plan.id,
    quantity: finalQty,
    plan_snapshot: {
      shopify_variant_id: variantId || plan.shopify_variant_id || null,
      shopify_product_id: plan.shopify_product_id || null,
      product_title: plan.product_title || "Suscripción",
      // Perfil del negocio al momento de suscribirse (para reportes y soporte).
      business_type: profile.businessType,
      channel: profile.channel,
      item_source: plan.item_source || (plan.shopify_variant_id ? "shopify" : "manual"),
      frequency_days: freqDays,
      subscription_price_ars: pack ? pack.subPrice : unitPrice,
      units_per_shipment: finalQty,
      ...packSnapshot,
      // Desglose snapshot — se usa para mostrar al cliente y para crear la orden
      // Shopify con shipping_lines acorde. Si el plan cambia después, este
      // snapshot preserva el cobro original del subscriber.
      subtotal_ars: subtotal,
      shipping_price_ars: shippingCost,
      shipping_method_name: shippingName,
      shipping_method_code: shippingCode,
      shipping_method_source: shippingSource,
      qty_discount_pct: qtyDiscountPct,
      discount_code: discountCodeApplied,
      discount_code_pct: discountCodePct,
      extras_total_ars: extrasTotal,
      total_per_charge_ars: totalPerCharge,
    },
    // Extras sumados en el checkout: van a cada orden (sync.js) con su precio.
    ...(extraItems.length ? { extra_items: extraItems } : {}),
    // Regalos del pack vinculados a un producto de la tienda: van a la orden a $0
    // (sync.js); "once" = solo en la primera orden.
    ...(giftItems.length ? { gift_items: giftItems } : {}),
    // Cupón sólo primer cobro: sync sube el monto a full_price_per_charge_ars después.
    discount_first_charge_only: discountFirstOnly,
    full_price_per_charge_ars: discountFirstOnly ? fullPricePerCharge : null,
    status: "pending",
    capture: false, // deja de ser lead
    checkout_started_at: nowIso, // reloj del cron (created_at se preserva del lead)
    recover_path: buildRecoverPath(merchant, plan, plan.id, finalQty, recoverExtra(pr)),
    updated_at: nowIso,
    // Datos de atribución de Meta capturados en el navegador (fbc/fbp/UA/URL).
    // Se usan en el evento Purchase de CAPI para atribuir la venta al anuncio.
    fb_data: fbIn ? { fbc: fbIn.fbc, fbp: fbIn.fbp, event_source_url: eventUrl, user_agent: fbIn.user_agent, client_ip_address: ip || null } : (existing?.fb_data || null),
  };
  if (isNew) {
    await subRef.set({ ...subData, created_at: nowIso, shopify_orders: [] });
  } else {
    // Preserva created_at / abandoned_step / abandoned_step_at del doc original.
    await subRef.set({ ...subData, ...(existing?.created_at ? {} : { created_at: nowIso }), ...(Array.isArray(existing?.shopify_orders) ? {} : { shopify_orders: [] }) }, { merge: true });
  }

  // Token del portal — 180 días, le permite al cliente gestionar la sub
  // (ver detalle, pausar, cancelar) sin loguearse en Firebase Auth. Va en
  // back_url para que CheckoutSuccess pueda linkear al portal directamente.
  const portalToken = generatePortalToken(merchantId, subscriberId, 180);

  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.");
  const backUrl = isLocalhost
    ? `https://recurrentes.app/checkout-success?sub=${subscriberId}`
    : `${baseUrl}/#/checkout-success?sub=${subscriberId}&token=${encodeURIComponent(portalToken)}`;
  // notification_url: a dónde MP nos avisa cuando haya un cobro. Incluimos
  // ?mid=X&sid=Y como query params para que el webhook handler sepa DIRECTO
  // a qué merchant pertenece sin iterar todos los merchants.
  const notificationUrl = isLocalhost
    ? undefined
    : `${baseUrl}/api/mp/webhook?mid=${encodeURIComponent(merchantId)}&sid=${encodeURIComponent(subscriberId)}`;

  // Pasarela alternativa: mismo subscriber pending (validación, precio, envío y cupón
  // de arriba), pero el link de pago lo da el adapter. Para MP no entra nunca.
  if (altProvider) {
    const { startProviderCheckout } = await import("../_lib/providers/checkout.js");
    return startProviderCheckout(altProvider, {
      res, merchantRef, merchantId, merchant, subRef, subData, plan, pack, finalQty, freqDays, totalPerCharge, portalToken, backUrl, baseUrl,
      track: (s) => trackCheckoutStarted(merchantId, merchant, subRef, s, existing, { stage: "checkout", plan, blocking: hasBlocking }),
    });
  }

  // Si reusamos una sub real con el MISMO monto y frecuencia, reusamos también su
  // plan MP (no creamos otro).
  const prevPlanId = existing?.mp_preapproval_plan_id || null;
  // En modo packs también tiene que ser el MISMO pack (otro pack = otro plan MP).
  const sameCharge = !!(prevPlanId && existing?.mp_init_point
    && Number(existing?.plan_snapshot?.total_per_charge_ars) === totalPerCharge
    && Number(existing?.plan_snapshot?.frequency_days) === freqDays
    && (existing?.plan_snapshot?.pack_index ?? null) === (pack ? pack.idx : null));
  if (sameCharge) {
    await subRef.update({ portal_token: portalToken });
    await trackCheckoutStarted(merchantId, merchant, subRef, { ...subData, portal_token: portalToken, mp_init_point: existing.mp_init_point }, existing, { stage: "checkout", plan, blocking: hasBlocking });
    return res.json({
      ok: true,
      subscriber_id: subscriberId,
      init_point: existing.mp_init_point,
      preapproval_plan_id: prevPlanId,
      portal_token: portalToken,
      reused: true,
    });
  }

  // ── Flujo de PLAN (preapproval_plan) — MP pide el mail en SU pantalla ───────
  // MP no permite tener "dinero en cuenta" (solo lo da el preapproval directo) Y
  // a la vez liberar el mail (el directo EXIGE payer_email y obliga a que coincida
  // → "tu email no coincide con la suscripción"). Como muchos clientes no recuerdan
  // el mail de su cuenta MP o pagan con la de otra persona, priorizamos que TODOS
  // puedan pagar: en el flujo de plan MP pide el login en su pantalla y toma el mail
  // de esa cuenta. El mail del checkout queda SOLO para seguimiento (orden Shopify +
  // emails), NO viaja a MP. El monto ya viene multiplicado por qty → un plan ad-hoc
  // por sub escala bien.
  const planBodyBase = {
    // Idem: 60 chars. Con un titulo largo esto tiraba 400 y NADIE se podia
    // suscribir (89 chars en el caso Wellfresh). 22-sept-2026.
    reason: pack && pack.label
      ? mpReason(plan.product_title, ` — ${pack.label} (×${finalQty}) — cada ${freqDays} días`)
      : mpReason(plan.product_title, ` × ${finalQty} — cada ${freqDays} días`),
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
  // 3) sin restricción (crédito). Nos quedamos con el PRIMERO que MP acepte.
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
  if (!preapprovalPlan || !preapprovalPlan.id) {
    // No exponemos el error crudo de MP al comprador: lo logueamos y lo dejamos
    // en el merchant para que lo vea en el dashboard.
    const detail = lastPlanErr?.message || "MP no devolvió el plan";
    console.error("[checkout/init] MP preapproval_plan falló:", { merchantId, subscriberId, detail });
    await subRef.update({ status: "error", error: detail }).catch(() => {});
    await merchantRef.set({ mp_last_error: String(detail).slice(0, 500), mp_last_error_at: new Date().toISOString() }, { merge: true }).catch(() => {});
    return res.status(502).json({ error: "La tienda tiene un problema con Mercado Pago. Avisale al vendedor e intentá más tarde." });
  }

  // URL del checkout del plan. NO adjuntamos payer_email → MP usa el mail de la
  // cuenta logueada del cliente.
  // ⚠️ NO agregar &external_reference a esta URL: MP devuelve 404 cuando el
  // checkout de plan lleva parámetros extra. El sub se resuelve por el
  // mp_preapproval_plan_id ÚNICO. Usamos el init_point tal cual.
  const checkoutUrl = preapprovalPlan.init_point
    || `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${encodeURIComponent(preapprovalPlan.id)}`;

  await subRef.update({
    mp_preapproval_plan_id: preapprovalPlan.id,
    mp_init_point: checkoutUrl,
    portal_token: portalToken,
    ...(prevPlanId && prevPlanId !== preapprovalPlan.id ? { mp_preapproval_plan_id_prev: prevPlanId } : {}),
  });

  // Meta "pago iniciado" (InitiateCheckout): si el lead ya lo mandó al dejar el mail,
  // lleva el mismo event_id y Meta lo deduplica. El "Purchase" sale server-side
  // (sync/webhook) cuando MP confirma el cobro.
  await metaFunnel(merchant, "InitiateCheckout", { fb: fbIn || existing?.fb_data || null, clientIp: ip, value: totalPerCharge, email, phone: subData.customer_phone, firstName: splitName(subData.customer_name).firstName, lastName: splitName(subData.customer_name).lastName, eventId: "rec_ic_" + subRef.id, tag: "checkout/pay" });

  // Klaviyo "Checkout Started" (si no salió ya con el lead: completa el perfil).
  await trackCheckoutStarted(merchantId, merchant, subRef, { ...subData, portal_token: portalToken, mp_init_point: checkoutUrl }, existing, { stage: "checkout", plan, blocking: hasBlocking });
  await emitFlowEvent(merchantId, merchant, "checkout_started", subRef.id, { ...subData, portal_token: portalToken, mp_init_point: checkoutUrl }, { key: subRef.id });

  return res.json({
    ok: true,
    subscriber_id: subscriberId,
    init_point: checkoutUrl,
    preapproval_plan_id: preapprovalPlan.id,
    portal_token: portalToken,
  });
}
