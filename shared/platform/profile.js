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
  digital: {
    id: "digital",
    label: "Productos digitales",
    short: "Digitales",
    emoji: "📚",
    desc: "Ebooks, cursos, plantillas, audios o contenido exclusivo. Sin envío.",
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
    status: "soon",
    types: ["physical", "digital"],
    catalog: true, orders: true, widget: true,
    desc: "Tus productos de Tiendanube como suscripción, con una orden por cobro.",
  },
  impultienda: {
    id: "impultienda",
    label: "Impultienda",
    emoji: "📖",
    status: "soon",
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
  stripe: {
    id: "stripe",
    label: "Stripe",
    emoji: "🌎",
    status: "soon",
    currency: "USD",
    region: "Fuera de Argentina",
    desc: "Para tiendas de otros países: Stripe no opera con comercios argentinos.",
  },
  // Whop: API con planes recurrentes, webhooks y cuentas conectadas. Encaja con
  // digitales vendidos al exterior en USD (Impultienda); no cobra en pesos a
  // compradores locales y su soporte de físicos está verde (verificado 2026-09-14).
  whop: {
    id: "whop",
    label: "Whop",
    emoji: "🎟️",
    status: "soon",
    currency: "USD",
    region: "Exterior",
    desc: "Membresías y productos digitales cobrados en dólares a compradores de afuera.",
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

  const channelConnected = channel === "none" ? true : channel === "shopify" ? !!doc.shopify_token : false;
  const paymentConnected = paymentProvider === "mercadopago" ? !!doc.mp_access_token : false;

  const missing = [];
  if (!channelConnected) missing.push(channelInfo.label);
  if (!paymentConnected) missing.push(providerInfo.label);

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
      packs: channelInfo.widget,        // selector de packs x1·x2·x3 (solo en el widget)
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
    if (!isAvailable(ch)) return { error: `${ch.label} todavía no está disponible` };
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
