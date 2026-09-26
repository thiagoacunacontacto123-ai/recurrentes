// Planes del SaaS Recurrentes — lo que le cobramos al COMERCIANTE (no a sus
// clientes). Fuente ÚNICA compartida por api/_lib/plans_saas.js y el panel
// (Billing.jsx, Landing.jsx).
//
// El precio sale de la cantidad de SUSCRIPTORES ACTIVOS de la tienda (no se
// elige): los primeros 10 son gratis y después sube por tramos. La instalación
// NO es gratis (ver INSTALL_USD abajo). Todo lo demás está incluido en todos
// los planes.
//
// Suscriptor activo = sub con status "active" o "payment_failed" (MP sigue
// reintentando el cobro). Pausados, cancelados y los que nunca pagaron no cuentan.
//
// Escala del 22-sept-2026: los precios se DUPLICARON (Thiago). La escala
// anterior (49/99/199/349/499/749/999/1999/2999) sigue valiendo para las
// tiendas que entraron antes, vía `legacy_pricing` (ver abajo).
// Por suscriptor, piso → tope del tramo:
//   11–50 → 4,45 → 0,98 · 51–100 → 1,94 → 0,99 · 101–300 → 1,97 → 0,66
//   301–1000 → 1,16 → 0,35 · 1001–2000 → 0,50 → 0,25 · 2001–5000 → 0,37 → 0,15
//   5001–10000 → 0,20 → 0,10 · 10001–20000 → 0,20 → 0,10 · +20000 → 0,15 → ↓

export const BILLABLE_STATUSES = ["active", "payment_failed"];
export const FREE_SUBSCRIBERS = 10;
// La instalación (dejar el widget andando en la tienda) se cobra aparte desde el
// 22-sept-2026: lleva trabajo real y no se promete más como gratis. Desde el
// 25-sept-2026 es OBLIGATORIA y con precio a la vista (Thiago: "son 100 dólares,
// sí o sí"): las dos tiendas que funcionan salieron las dos con él haciendo la
// integración a mano, así que la venta pasa a ser demo + puesta en marcha.
// En ningún lado puede volver a decir que la instalación es gratis.
export const INSTALL_USD = 100;

// max null = sin techo. Los tramos son contiguos: min del siguiente = max + 1.
// Los ids viejos (starter/growth/scale/pro/unlimited) se conservan para que
// `plan_activated` de cuentas existentes siga resolviendo.
export const PRICING_TIERS = [
  { id: "free",       label: "Free",       usd: 0,    min: 0,     max: 10 },
  { id: "starter",    label: "Starter",    usd: 99,   min: 11,    max: 50 },
  { id: "growth",     label: "Growth",     usd: 199,  min: 51,    max: 100 },
  { id: "scale",      label: "Scale",      usd: 399,  min: 101,   max: 300 },
  { id: "pro",        label: "Pro",        usd: 699,  min: 301,   max: 1000 },
  { id: "business",   label: "Business",   usd: 999,  min: 1001,  max: 2000 },
  { id: "enterprise", label: "Enterprise", usd: 1499, min: 2001,  max: 5000 },
  { id: "max",        label: "Max",        usd: 1999, min: 5001,  max: 10000 },
  { id: "unlimited",  label: "Unlimited",  usd: 3999, min: 10001, max: 20000 },
  { id: "ultra",      label: "Ultra",      usd: 5999, min: 20001, max: null },
];

// ── Precio heredado (22-sept-2026, Thiago) ───────────────────────────────
// Los precios se duplicaron. Las tiendas que ya estaban antes del aumento
// pagan la MITAD del precio nuevo: es lo que les habíamos prometido cuando
// entraron, y no se les cambia el trato de un día para el otro.
//
// Se marca con `legacy_pricing: 0.5` en el doc del merchant (o cualquier
// factor entre 0 y 1). Sin el campo, paga el precio de lista.
export const LEGACY_FACTOR_DEFAULT = 0.5;

/** Factor de precio de una tienda: 1 = lista, 0.5 = mitad. */
export function priceFactor(merchant) {
  const f = Number(merchant?.legacy_pricing);
  return Number.isFinite(f) && f > 0 && f <= 1 ? f : 1;
}

/** Lo que paga ESA tienda por un tramo, con su descuento heredado aplicado. */
export function tierPriceFor(tier, merchant) {
  const base = Number(tier?.usd) || 0;
  if (!base) return 0;
  return Math.round(base * priceFactor(merchant));
}

export const TIER_BY_ID = Object.fromEntries(PRICING_TIERS.map(t => [t.id, t]));
export const PAID_TIER_IDS = PRICING_TIERS.filter(t => t.usd > 0).map(t => t.id);
export const tierRank = (id) => PRICING_TIERS.findIndex(t => t.id === id);

// Tramo que corresponde a N suscriptores activos.
export function tierFor(activeSubscribers) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  return PRICING_TIERS.find(t => n >= t.min && (t.max == null || n <= t.max)) || PRICING_TIERS[PRICING_TIERS.length - 1];
}

// Tramo siguiente (null si ya está en el último).
export function nextTier(id) {
  const i = tierRank(id);
  return i >= 0 && i < PRICING_TIERS.length - 1 ? PRICING_TIERS[i + 1] : null;
}

// "Hasta 5 suscriptores" · "6 a 30 suscriptores" · "Más de 1.000 suscriptores".
export function tierRangeLabel(t) {
  const f = (n) => Number(n).toLocaleString("es-AR");
  if (!t) return "";
  if (t.min === 0) return `Hasta ${f(t.max)} suscriptores`;
  if (t.max == null) return `Más de ${f(t.min - 1)} suscriptores`;
  return `${f(t.min)} a ${f(t.max)} suscriptores`;
}

// ── WhatsApp desde el número de Recurrentes (costo variable) ──────────
// Meta cobra cada plantilla de UTILIDAD entregada. Se le pasa al comerciante
// con este recargo (+50%, Thiago 18-sept-2026) y se suma a su plan a fin de mes:
// tanto los mensajes a SUS clientes como los avisos a él mismo (altas, bajas,
// límite del plan). Solo los avisos al admin los paga Recurrentes.
// Con su propio número paga él directo a Meta (costo 0 para Recurrentes).
export const WHATSAPP_MARKUP = 1.50;
// USD por plantilla de UTILIDAD entregada a un número de Argentina.
// 2026-09-20: corregido de 0,012 a 0,026. El 0,012 venía de un blog de terceros
// (ominiflow) y nunca se había confirmado contra Meta; la tarifa de la doc oficial
// para Argentina es 0,0260. Con el valor viejo le cobrábamos al comercio menos de
// la mitad de lo que nos cuesta el mensaje: cada aviso de utilidad daba pérdida.
// El backend lo puede pisar con la env WHATSAPP_PRICE_USD_UTILITY.
//
// OJO (oportunidad, no implementada): Meta NO cobra las plantillas de utilidad
// enviadas dentro de la ventana de servicio de 24 h (el cliente escribió primero),
// ni nada dentro de las 72 h de un anuncio Click-to-WhatsApp. Hoy cobramos todas
// por igual. Cuando se registre esa ventana, esos mensajes deberían ir a costo 0.
export const WHATSAPP_PRICE_USD_UTILITY_DEFAULT = 0.026;
// Plantillas de MARKETING (carrito sin pagar): Meta las cobra bastante más. Misma
// fuente (ominiflow, Argentina); el backend la pisa con WHATSAPP_PRICE_USD_MARKETING.
export const WHATSAPP_PRICE_USD_MARKETING_DEFAULT = 0.0618;
// Lo que paga el comerciante por aviso (precio de Meta × recargo), a 6 decimales.
export const waChargeUsd = (priceUsd) => Math.round((Number(priceUsd) || 0) * WHATSAPP_MARKUP * 1e6) / 1e6;

// Incluido en TODOS los planes (el precio solo depende de los suscriptores).
export const PLAN_FEATURES = [
  "Widget de suscripción en tu página de producto",
  "Cobros automáticos con Mercado Pago",
  "Una orden en tu negocio por cada cobro",
  "Portal para que tus clientes pausen o cancelen",
  "Avisos de pago fallido y ofertas de retención",
  "Flujos de email y Meta Conversions API",
  "Varios negocios y equipo con permisos",
  "Soporte por WhatsApp",
];
