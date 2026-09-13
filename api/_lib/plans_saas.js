// Planes del SaaS Recurrentes: lo que le cobramos al COMERCIANTE (no a sus
// clientes). Sin Stripe todavía — el merchant "pide" un plan y lo activamos a
// mano seteando `plan` en merchants/{mid}.
//
// Espejo en src/pages/Billing.jsx (duplicado a propósito: el front no importa
// nada de api/). Si tocás precios/límites acá, tocalos allá también.

export const TRIAL_DAYS = 7;

// Merchants creados antes de esta fecha (o sin created_at) que no tengan un
// plan pago explícito se tratan como "beta": ilimitado y sin wall. Lumina está
// acá. Se CALCULA en cada request, no se migra nada en Firestore.
export const LEGACY_CUTOFF = "2026-09-13";

export const PLANS = [
  {
    id: "starter", label: "Starter", usd: 29, orders_limit: 20,
    tagline: "Para arrancar con las primeras suscripciones.",
    features: [
      "Hasta 20 pedidos de suscripción por mes",
      "Widget de suscripción en tu Shopify",
      "Cobros automáticos con Mercado Pago",
      "Una orden Shopify por cada cobro",
      "Portal del suscriptor",
      "Recupero de carritos por mail",
    ],
  },
  {
    id: "growth", label: "Growth", usd: 69, orders_limit: 100, featured: true,
    tagline: "Para tiendas que ya venden por suscripción todos los días.",
    features: [
      "Hasta 100 pedidos de suscripción por mes",
      "Todo lo de Starter",
      "Varias tiendas en un solo login",
      "Equipo con permisos por sección",
      "Meta Conversions API",
      "Soporte prioritario",
    ],
  },
  {
    id: "pro", label: "Pro", usd: 99, orders_limit: null,
    tagline: "Más de 100 pedidos por mes, sin techo.",
    features: [
      "Pedidos de suscripción ilimitados",
      "Todo lo de Growth",
      "Onboarding asistido 1 a 1",
      "Soporte por WhatsApp",
    ],
  },
];

export const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.id, p]));
export const PAID_PLAN_IDS = PLANS.map(p => p.id);

export function planLabel(id) {
  if (PLAN_BY_ID[id]) return PLAN_BY_ID[id].label;
  if (id === "beta") return "Beta";
  return "Prueba gratis";
}

// Plan EFECTIVO del merchant (lo que manda en el dashboard):
//   starter/growth/pro/beta explícitos → ese.
//   free/trial/vacío + created_at < cutoff (o sin fecha) → "beta" (legado).
//   free/trial/vacío + created_at >= cutoff → "trial".
export function effectivePlan(m = {}) {
  const raw = String(m.plan || "").trim().toLowerCase();
  if (PLAN_BY_ID[raw] || raw === "beta") return raw;
  const created = String(m.created_at || "").slice(0, 10);
  if (!created || created < LEGACY_CUTOFF) return "beta";
  return "trial";
}

export function trialEndFrom(createdAtIso) {
  const t = Date.parse(createdAtIso || "");
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + TRIAL_DAYS * 86400000).toISOString();
}

// trial_end guardado o derivado de created_at (+7 días).
export function trialEndOf(m = {}) {
  if (m.trial_end && Number.isFinite(Date.parse(m.trial_end))) return new Date(Date.parse(m.trial_end)).toISOString();
  return trialEndFrom(m.created_at);
}

// Mes calendario en hora Argentina (UTC-3). `start`/`end` son ISO UTC para
// comparar contra `created_at` (string ISO) de los charges: start <= x < end.
const ART_OFFSET_MS = -3 * 3600 * 1000;
export function monthRange(now = new Date()) {
  const local = new Date(now.getTime() + ART_OFFSET_MS);
  const y = local.getUTCFullYear(), mo = local.getUTCMonth();
  return {
    key: `${y}-${String(mo + 1).padStart(2, "0")}`,
    start: new Date(Date.UTC(y, mo, 1) - ART_OFFSET_MS).toISOString(),
    end: new Date(Date.UTC(y, mo + 1, 1) - ART_OFFSET_MS).toISOString(),
  };
}

// Contrato `billing` que devuelve GET /api/merchant. `locked` SOLO afecta el
// dashboard: widget, checkout, webhooks y cron nunca miran esto.
export function buildBilling(m = {}, ordersThisMonth = 0, now = new Date()) {
  const plan = effectivePlan(m);
  const paid = PLAN_BY_ID[plan] || null;
  const trialEnd = plan === "trial" ? trialEndOf(m) : null;
  const msLeft = trialEnd ? Date.parse(trialEnd) - now.getTime() : null;
  const trial_days_left = trialEnd ? Math.max(0, Math.ceil(msLeft / 86400000)) : null;
  const trial_expired = trialEnd ? msLeft <= 0 : false;
  const orders_limit = paid ? paid.orders_limit : null;
  const count = Math.max(0, Math.floor(Number(ordersThisMonth) || 0));
  return {
    plan,
    plan_label: planLabel(plan),
    plan_usd: paid ? paid.usd : 0,
    trial_end: trialEnd,
    trial_days_left,
    trial_expired,
    month: monthRange(now).key,
    orders_this_month: count,
    orders_limit,
    limit_reached: orders_limit != null && count >= orders_limit,
    locked: plan === "trial" && trial_expired,
    plan_requested: PLAN_BY_ID[m.plan_requested] ? m.plan_requested : null,
    plan_requested_at: m.plan_requested_at || null,
  };
}
