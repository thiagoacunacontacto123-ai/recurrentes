// Planes del SaaS Recurrentes — lo que le cobramos al COMERCIANTE (no a sus
// clientes). Fuente ÚNICA compartida por api/_lib/plans_saas.js y el panel
// (Billing.jsx, Landing.jsx).
//
// El precio sale de la cantidad de SUSCRIPTORES ACTIVOS de la tienda (no se
// elige): los primeros 5 son gratis y después sube por tramos. Todo lo demás
// está incluido en todos los planes.
//
// Suscriptor activo = sub con status "active" o "payment_failed" (MP sigue
// reintentando el cobro). Pausados, cancelados y los que nunca pagaron no cuentan.

export const BILLABLE_STATUSES = ["active", "payment_failed"];
export const FREE_SUBSCRIBERS = 5;

// max null = sin techo. Los tramos son contiguos: min del siguiente = max + 1.
export const PRICING_TIERS = [
  { id: "free",      label: "Free",      usd: 0,   min: 0,    max: 5 },
  { id: "starter",   label: "Starter",   usd: 29,  min: 6,    max: 30 },
  { id: "growth",    label: "Growth",    usd: 69,  min: 31,   max: 100 },
  { id: "scale",     label: "Scale",     usd: 99,  min: 101,  max: 300 },
  { id: "pro",       label: "Pro",       usd: 149, min: 301,  max: 1000 },
  { id: "unlimited", label: "Unlimited", usd: 299, min: 1001, max: null },
];

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

// Incluido en TODOS los planes (el precio solo depende de los suscriptores).
export const PLAN_FEATURES = [
  "Widget de suscripción en tu página de producto",
  "Cobros automáticos con Mercado Pago",
  "Una orden en tu tienda por cada cobro",
  "Portal para que tus clientes pausen o cancelen",
  "Avisos de pago fallido y ofertas de retención",
  "Klaviyo y Meta Conversions API",
  "Varias tiendas y equipo con permisos",
  "Soporte por WhatsApp",
];
