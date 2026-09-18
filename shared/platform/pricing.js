// Planes del SaaS Recurrentes — lo que le cobramos al COMERCIANTE (no a sus
// clientes). Fuente ÚNICA compartida por api/_lib/plans_saas.js y el panel
// (Billing.jsx, Landing.jsx).
//
// El precio sale de la cantidad de SUSCRIPTORES ACTIVOS de la tienda (no se
// elige): los primeros 10 son gratis y después sube por tramos. La instalación
// es gratis siempre. Todo lo demás está incluido en todos los planes.
//
// Suscriptor activo = sub con status "active" o "payment_failed" (MP sigue
// reintentando el cobro). Pausados, cancelados y los que nunca pagaron no cuentan.
//
// Escala del 16-sept-2026 (Thiago). Por suscriptor, piso → tope del tramo:
//   11–50 → 4,45 → 0,98 · 51–100 → 1,94 → 0,99 · 101–300 → 1,97 → 0,66
//   301–1000 → 1,16 → 0,35 · 1001–2000 → 0,50 → 0,25 · 2001–5000 → 0,37 → 0,15
//   5001–10000 → 0,20 → 0,10 · 10001–20000 → 0,20 → 0,10 · +20000 → 0,15 → ↓

export const BILLABLE_STATUSES = ["active", "payment_failed"];
export const FREE_SUBSCRIBERS = 10;
export const INSTALL_USD = 0; // la instalación es gratis, siempre

// max null = sin techo. Los tramos son contiguos: min del siguiente = max + 1.
// Los ids viejos (starter/growth/scale/pro/unlimited) se conservan para que
// `plan_activated` de cuentas existentes siga resolviendo.
export const PRICING_TIERS = [
  { id: "free",       label: "Free",       usd: 0,    min: 0,     max: 10 },
  { id: "starter",    label: "Starter",    usd: 49,   min: 11,    max: 50 },
  { id: "growth",     label: "Growth",     usd: 99,   min: 51,    max: 100 },
  { id: "scale",      label: "Scale",      usd: 199,  min: 101,   max: 300 },
  { id: "pro",        label: "Pro",        usd: 349,  min: 301,   max: 1000 },
  { id: "business",   label: "Business",   usd: 499,  min: 1001,  max: 2000 },
  { id: "enterprise", label: "Enterprise", usd: 749,  min: 2001,  max: 5000 },
  { id: "max",        label: "Max",        usd: 999,  min: 5001,  max: 10000 },
  { id: "unlimited",  label: "Unlimited",  usd: 1999, min: 10001, max: 20000 },
  { id: "ultra",      label: "Ultra",      usd: 2999, min: 20001, max: null },
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

// ── WhatsApp desde el número de Recurrentes (costo variable) ──────────
// Meta cobra cada plantilla de UTILIDAD entregada. Se le pasa al comerciante
// con este recargo (+50%, Thiago 18-sept-2026) y se suma a su plan a fin de mes:
// tanto los mensajes a SUS clientes como los avisos a él mismo (altas, bajas,
// límite del plan). Solo los avisos al admin los paga Recurrentes.
// Con su propio número paga él directo a Meta (costo 0 para Recurrentes).
export const WHATSAPP_MARKUP = 1.50;
// USD por plantilla de utilidad entregada a un número de Argentina. Fuente
// (consultada 2026-09-15): la tabla oficial de Meta
// (developers.facebook.com/docs/whatsapp/pricing → "USD rates" CSV, vigente
// desde 2026-07-01; Argentina bajó utilidad y autenticación el 2025-10-01)
// solo se descarga en CSV; el valor 0,0120 sale de ominiflow.com/whatsapp-api-pricing/argentina
// (actualizado 2026-09-12, cita a Meta). NO confirmado contra el CSV: el backend
// lo pisa con la env WHATSAPP_PRICE_USD_UTILITY.
export const WHATSAPP_PRICE_USD_UTILITY_DEFAULT = 0.012;
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
