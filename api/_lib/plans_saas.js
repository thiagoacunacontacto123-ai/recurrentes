// Billing del SaaS Recurrentes: lo que le cobramos al COMERCIANTE (no a sus
// clientes). Los tramos y precios viven en shared/platform/pricing.js (fuente
// única para api/ y el panel): el precio sale de los SUSCRIPTORES ACTIVOS.
//
// Sin cobro automático todavía: el merchant "activa" el plan que le corresponde
// (POST merchant?action=plan-request) y lo confirmamos a mano seteando
// `plan_activated: "<tier>"` en merchants/{mid}. Nada se corta si no lo activa.
import { PRICING_TIERS, TIER_BY_ID, FREE_SUBSCRIBERS, tierFor, nextTier, tierRank } from "../../shared/platform/pricing.js";

// Merchants creados antes de esta fecha (o sin created_at) sin plan pago
// explícito son "beta": sin cargo y sin tramo. Lumina está acá. Se CALCULA en
// cada request, no se migra nada en Firestore.
export const LEGACY_CUTOFF = "2026-09-13";

// Planes que se pueden pedir/activar (plan-request) = tramos pagos.
export const PLAN_BY_ID = Object.fromEntries(PRICING_TIERS.filter(t => t.usd > 0).map(t => [t.id, t]));

// Compat: la prueba de 7 días se retiró (2026-09-14, entró el tramo gratis de 5
// suscriptores). Se deja la función para imports viejos.
export const TRIAL_DAYS = 7;
export function trialEndFrom(createdAtIso) {
  const t = Date.parse(createdAtIso || "");
  const base = Number.isFinite(t) ? t : Date.now();
  return new Date(base + TRIAL_DAYS * 86400000).toISOString();
}

// Plan activado (pago confirmado a mano). Acepta el campo nuevo `plan_activated`
// y, por compat, un `plan` pago del modelo viejo (starter/growth/pro).
export function activatedTierId(m = {}) {
  if (TIER_BY_ID[m.plan_activated] && m.plan_activated !== "free") return m.plan_activated;
  const raw = String(m.plan || "").trim().toLowerCase();
  if (TIER_BY_ID[raw] && raw !== "free") return raw;
  return null;
}

// Tiendas internas (las de Thiago: Lumina y las demos). Nunca pagan plan y no
// cuentan en el MRR ni en los comercios del Admin, así los números del negocio son
// solo de clientes reales (Thiago, 17-sept). Se marcan con `internal: true` en el
// doc, o automáticamente si el mail del dueño está en ADMIN_EMAILS.
export function isInternal(m = {}, adminEmails = []) {
  if (m.internal === true) return true;
  const mails = (Array.isArray(adminEmails) ? adminEmails : []).map(e => String(e || "").trim().toLowerCase()).filter(Boolean);
  if (!mails.length) return false;
  for (const v of [m.email, m.ownerEmail, m.contact_email]) {
    if (v && mails.includes(String(v).trim().toLowerCase())) return true;
  }
  return false;
}

// Beta = `plan: "beta"` explícito, o cuenta vieja (antes del corte) sin plan pago.
export function isBeta(m = {}) {
  if (m.internal === true) return true;   // tienda propia: siempre sin cargo
  const raw = String(m.plan || "").trim().toLowerCase();
  if (raw === "beta") return true;
  if (activatedTierId(m)) return false;
  const created = String(m.created_at || "").slice(0, 10);
  return !created || created < LEGACY_CUTOFF;
}

// Contrato `billing` que devuelve GET /api/merchant. Solo informa al dashboard:
// widget, checkout, webhooks y cron NUNCA miran esto (y no hay bloqueo: locked=false).
// Ciclo de cobro del SaaS: cada 30 días desde el primer pago (plan_activated_at).
// Ese día se cobra el tramo que corresponda a los suscriptores activos en ese
// momento; nunca se cobran diferenciales a mitad de ciclo. Con Stripe, el fin de
// período real viene del webhook (saas_current_period_end).
export const SAAS_CYCLE_DAYS = 30;
export function nextSaasPaymentAt(m = {}, now = Date.now()) {
  const end = Date.parse(m.saas_current_period_end || "");
  if (Number.isFinite(end) && end > now) return new Date(end).toISOString();
  const start = Date.parse(m.plan_activated_at || "");
  if (!Number.isFinite(start)) return null;
  let t = start;
  while (t <= now) t += SAAS_CYCLE_DAYS * 86400000;
  return new Date(t).toISOString();
}

export function buildBilling(m = {}, activeSubscribers = 0, { stripeAvailable = false } = {}) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  const beta = isBeta(m);
  const tier = tierFor(n);
  const next = nextTier(tier.id);
  const activated = activatedTierId(m);
  return {
    // Fechas del ciclo (solo informativo para el panel).
    plan_activated_at: m.plan_activated_at || null,
    last_paid_at: m.saas_last_paid_at || m.plan_activated_at || null,
    next_payment_at: activated ? nextSaasPaymentAt(m) : null,
    cycle_days: SAAS_CYCLE_DAYS,
    billing_method: m.saas_stripe_subscription_id ? "stripe" : (activated ? "manual" : null),
    saas_status: m.saas_status || (activated ? "active" : null),   // active | past_due | cancelled
    stripe_available: !!stripeAvailable,
    plan: beta ? "beta" : tier.id,
    plan_label: beta ? "Beta" : tier.label,
    plan_usd: beta ? 0 : tier.usd,
    tier: tier.id,
    tier_min: tier.min,
    tier_max: tier.max,
    next_tier: next ? { id: next.id, label: next.label, usd: next.usd, min: next.min } : null,
    active_subscribers: n,
    free_subscribers: FREE_SUBSCRIBERS,
    activated_plan: activated,
    // Le corresponde un tramo pago más alto que el que tiene activado → mostrar aviso.
    needs_activation: !beta && tier.usd > 0 && tierRank(activated || "free") < tierRank(tier.id),
    locked: false,
    plan_requested: PLAN_BY_ID[m.plan_requested] ? m.plan_requested : null,
    plan_requested_at: m.plan_requested_at || null,
  };
}
