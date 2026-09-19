// Perfil del negocio — qué vende el comerciante, dónde lo vende y con qué cobra.
//
// Fuente ÚNICA compartida por el backend (api/*) y el panel (src/*). De acá sale:
//   · qué pasos pide el onboarding y qué secciones necesitan qué conexión,
//   · qué datos pide el checkout (dirección, teléfono, DNI),
//   · si cada cobro genera una orden en una tienda o queda como cobro registrado,
//   · el vocabulario de la UI (producto / membresía, suscriptor / socio, …).
//
// Tres ejes independientes, guardados en el doc del merchant:
//   business_type    physical | digital | service
//   channel          shopify | tiendanube | impultienda | none   (dónde vende)
//   payment_provider mercadopago | stripe                         (quién cobra)
//
// Merchants históricos (sin ninguno de los tres campos) = productos físicos +
// Shopify + Mercado Pago: exactamente el comportamiento de siempre.
//
// Canales/pasarelas con status "soon" se muestran en el panel como "Próximamente"
// y NO se pueden elegir (validateProfilePatch los rechaza).

export const BUSINESS_TYPES = {
  physical: {
    id: "physical",
    label: "Productos físicos",
    short: "Físicos",
    emoji: "📦",
    desc: "Productos que se envían: cosmética, suplementos, café, alimento para mascotas…",
    shipping: true,
    vocab: {
      item: "producto", items: "productos",
      customer: "suscriptor", customers: "suscriptores",
      delivery: "orden", deliveries: "órdenes",
      next: "Próximo envío",
    },
  },
  // Retirado el 19-sept-2026 (Thiago): una suscripción digital no necesita órdenes nuevas,
  // así que Recurrentes no aporta nada. Queda en el modelo por compatibilidad, no se ofrece.
  digital: {
    id: "digital",
    retired: true,
    label: "Productos digitales",
    short: "Digitales",
    emoji: "📚",
    desc: "Contenido sin envío.",
    shipping: false,
    vocab: {
      item: "producto digital", items: "productos digitales",
      customer: "suscriptor", customers: "suscriptores",
      delivery: "entrega", deliveries: "entregas",
      next: "Próxima entrega",
    },
  },
  service: {
    id: "service",
    label: "Servicios y membresías",
    short: "Servicios",
    emoji: "🏋️",
    desc: "Gimnasios, clases, estudios, clubes, academias: una cuota que se cobra sola.",
    shipping: false,
    vocab: {
      item: "membresía", items: "membresías",
      customer: "socio", customers: "socios",
      delivery: "cuota", deliveries: "cuotas",
      next: "Próximo cobro",
    },
  },
};

export const CHANNELS = {
  shopify: {
    id: "shopify",
    label: "Shopify",
    emoji: "🛍️",
    status: "available",
    types: ["physical", "digital"],
    catalog: true,   // los productos salen de la tienda
    orders: true,    // cada cobro crea una orden en la tienda
    widget: true,    // se vende desde la página de producto (snippet)
    desc: "Leemos tu catálogo y creamos una orden en Shopify con cada cobro.",
  },
  tiendanube: {
    id: "tiendanube",
    label: "Tiendanube",
    emoji: "☁️",
    status: "soon", // se habilita solo: ver channelAvailable()
    types: ["physical", "digital"],
    catalog: true, orders: true, widget: true,
    packs: true,     // el selector de packs; en Tiendanube el CTA de suscripción va al checkout de Recurrentes con la cantidad del pack y la compra única postea a /comprar/ como el tema
    desc: "Tus productos de Tiendanube como suscripción, con una orden por cobro.",
  },
  impultienda: { // retirado 19-sept-2026 (solo digitales): no se muestra en ningún lado
    id: "impultienda",
    label: "Impultienda",
    emoji: "📖",
    status: "retired",
    types: ["digital"],
    catalog: true, orders: true, widget: true,
    desc: "Tu tienda de ebooks: cada cobro libera el acceso al contenido.",
  },
  none: {
    id: "none",
    label: "Sin tienda online",
    emoji: "🔗",
    status: "available",
    types: ["physical", "digital", "service"],
    catalog: false, orders: false, widget: false,
    desc: "Creás los planes acá y compartís un link de suscripción: Instagram, WhatsApp, tu web o un QR en el mostrador.",
  },
};

export const PAYMENT_PROVIDERS = {
  mercadopago: {
    id: "mercadopago",
    label: "Mercado Pago",
    emoji: "💳",
    status: "available",
    currency: "ARS",
    region: "Argentina",
    desc: "Cobros recurrentes en tu cuenta de Mercado Pago, en pesos.",
  },
  // Próximas pasarelas (investigación 2026-09-14, ver CLAUDE.md → Integraciones evaluadas).
  mobbex: {
    id: "mobbex",
    label: "Mobbex",
    emoji: "💠",
    status: "soon",
    currency: "ARS",
    region: "Argentina",
    desc: "Suscripciones con tarjeta guardada; ya la usan tiendas Shopify y Tiendanube.",
  },
  // Stripe y Whop (cobro a compradores del exterior, digitales): retirados el 19-sept-2026.
  // Recurrentes cobra en pesos con Mercado Pago (Mobbex en camino). Quedan por compatibilidad.
  stripe: {
    id: "stripe",
    label: "Stripe",
    emoji: "🌎",
    status: "retired",
    currency: "USD",
    region: "Exterior (USD)",
    desc: "Cobros en dólares a compradores del exterior.",
  },
  // Whop: API con planes recurrentes, webhooks y cuentas conectadas. Encaja con
  // digitales vendidos al exterior en USD (Impultienda); no cobra en pesos a
  // compradores locales y su soporte de físicos está verde (verificado 2026-09-14).
  whop: {
    id: "whop",
    label: "Whop",
    emoji: "🎟️",
    status: "retired",
    currency: "USD",
    region: "Exterior",
    desc: "Membresías cobradas en dólares a compradores de afuera.",
  },
};

const DEFAULT_TYPE = "physical";

// Canal por defecto para un tipo: servicios no tienen tienda; digitales sin
// Shopify conectado arrancan por link; físicos, Shopify (histórico).
function defaultChannelFor(typeId, m) {
  if (typeId === "service") return "none";
  if (typeId === "digital") return m?.shopify_token ? "shopify" : "none";
  return "shopify";
}

const isAvailable = (entry) => !!entry && entry.status === "available";

// Env del backend (en el navegador no hay `process`: devuelve "").
const envVar = (k) => { try { return String(globalThis.process?.env?.[k] || ""); } catch (_) { return ""; } };

/**
 * ¿Se puede elegir este canal? Los "available" siempre. Tiendanube se habilita sola
 * cuando existe la app de Partner (env TIENDANUBE_APP_ID + TIENDANUBE_CLIENT_SECRET en el backend; flag
 * `tiendanube_enabled` del GET /api/merchant en el panel) o si la cuenta ya la tiene
 * conectada. `m` = doc crudo del merchant o el `safe` del GET.
 */
export function channelAvailable(id, m) {
  const ch = CHANNELS[id];
  if (!ch) return false;
  if (isAvailable(ch)) return true;
  if (id === "tiendanube") return !!(m?.tiendanube_enabled || m?.tiendanube_token || (envVar("TIENDANUBE_APP_ID") && envVar("TIENDANUBE_CLIENT_SECRET")));
  return false;
}

/**
 * Perfil efectivo del merchant. Acepta el doc crudo (backend) o el `safe` del
 * GET /api/merchant (tokens enmascarados "•••••": alcanza con que sean truthy).
 */
export function merchantProfile(m) {
  const doc = m || {};
  const explicit = !!BUSINESS_TYPES[doc.business_type];
  const businessType = explicit ? doc.business_type : DEFAULT_TYPE;
  const type = BUSINESS_TYPES[businessType];

  const storedChannel = CHANNELS[doc.channel];
  const channel = storedChannel && storedChannel.types.includes(businessType) ? doc.channel : defaultChannelFor(businessType, doc);
  const channelInfo = CHANNELS[channel];

  const paymentProvider = isAvailable(PAYMENT_PROVIDERS[doc.payment_provider]) ? doc.payment_provider : "mercadopago";
  const providerInfo = PAYMENT_PROVIDERS[paymentProvider];

  const channelConnected = channel === "none" ? true : channel === "shopify" ? !!doc.shopify_token : channel === "tiendanube" ? !!doc.tiendanube_token : false;
  const paymentConnected = paymentProvider === "mercadopago" ? !!doc.mp_access_token : false;

  const missing = [];
  // Sin conectar, hablamos en genérico (Thiago, 19-sept): la app no es "Shopify + MP",
  // es tienda online + pasarela. Conectado, sí se nombra lo que hay.
  if (!channelConnected) missing.push("tu tienda online");
  if (!paymentConnected) missing.push("tu pasarela");

  return {
    businessType,
    channel,
    paymentProvider,
    explicit,            // el comerciante eligió su tipo de negocio (no es el default histórico)
    type,
    channelInfo,
    providerInfo,
    vocab: type.vocab,
    currency: providerInfo.currency,
    connected: { channel: channelConnected, payment: paymentConnected },
    ready: channelConnected && paymentConnected,
    missing,             // ["Shopify", "Mercado Pago"] — lo que falta conectar
    caps: {
      shipping: type.shipping,          // hay envío: dirección + tarifas + costo en el cobro
      requireAddress: type.shipping,
      requirePhone: type.shipping,
      requireTaxId: type.shipping,      // DNI/CUIT obligatorio (facturación de la orden)
      catalog: channelInfo.catalog,     // el producto se elige del catálogo de la tienda
      orders: channelInfo.orders,       // cada cobro crea una orden en la tienda
      widget: channelInfo.widget,       // se vende con el snippet en la página de producto
      link: !channelInfo.widget,        // se vende con el link de suscripción (checkout hosteado)
      packs: channelInfo.packs ?? channelInfo.widget, // selector de packs x1·x2·x3 (solo en el widget)
    },
  };
}

/**
 * Valida un cambio de perfil (PATCH save-settings). Las claves que no vienen se
 * toman del perfil actual. Si cambia el tipo y el canal actual no le sirve, el
 * canal pasa al default del tipo. Devuelve { value } o { error }.
 */
export function validateProfilePatch(current, patch) {
  const cur = merchantProfile(current);
  const b = patch || {};
  const typeId = "business_type" in b ? String(b.business_type || "") : cur.businessType;
  if (!BUSINESS_TYPES[typeId]) return { error: "business_type debe ser physical, digital o service" };

  let channelId;
  if ("channel" in b) {
    channelId = String(b.channel || "");
    const ch = CHANNELS[channelId];
    if (!ch) return { error: "channel inválido" };
    if (!channelAvailable(channelId, current)) return { error: `${ch.label} todavía no está disponible` };
    if (!ch.types.includes(typeId)) return { error: `${ch.label} no aplica a ${BUSINESS_TYPES[typeId].label.toLowerCase()}` };
  } else {
    channelId = CHANNELS[cur.channel].types.includes(typeId) ? cur.channel : defaultChannelFor(typeId, current);
  }

  const providerId = "payment_provider" in b ? String(b.payment_provider || "") : cur.paymentProvider;
  const pp = PAYMENT_PROVIDERS[providerId];
  if (!pp) return { error: "payment_provider inválido" };
  if (!isAvailable(pp)) return { error: `${pp.label} todavía no está disponible` };

  return { value: { business_type: typeId, channel: channelId, payment_provider: providerId } };
}

// ─── Cobros sin tienda ─────────────────────────────────────────────────────
// Sin canal con órdenes (servicios, link de pago) cada cobro queda "cumplido" con
// un comprobante interno que ocupa el lugar del id de orden: así la idempotencia
// (chargeclaim), shopify_orders[] y last_charge_at funcionan igual que con Shopify.
export const INTERNAL_FULFILLMENT_PREFIX = "rec_";
export const internalFulfillmentId = (paymentId) => `${INTERNAL_FULFILLMENT_PREFIX}${paymentId}`;
export const isInternalFulfillmentId = (id) => String(id || "").startsWith(INTERNAL_FULFILLMENT_PREFIX);

// Link público de suscripción (checkout hosteado por Recurrentes).
export function hostedCheckoutUrl(baseUrl, merchantId, planId) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const q = new URLSearchParams({ merchant: String(merchantId || ""), plan: String(planId || "") });
  return `${base}/#/checkout?${q.toString()}`;
}
