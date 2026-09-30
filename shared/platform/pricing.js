// Planes del SaaS Recurrentes — lo que le cobramos al COMERCIANTE (no a sus
// clientes). Fuente ÚNICA compartida por api/_lib/plans_saas.js y el panel
// (Billing.jsx, Landing.jsx).
//
// El precio sale de la cantidad de SUSCRIPTORES ACTIVOS de la tienda (no se
// elige). La puesta en marcha está incluida: no se cobra aparte.
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
// La puesta en marcha NO se cobra más (30-sept-2026, Thiago): "ya cobro un fijo
// de 99 por mes; si están 5 meses son 500 dólares, la instalación ya está paga".
// Para usar la app hay que activar el plan igual, así que cobrarla aparte era
// un peaje de entrada que solo frenaba la venta. Las constantes quedan en 0
// para no romper lo que todavía las importe.
export const INSTALL_USD = 0;
export const INSTALL_USD_MAX = 0;
export const INSTALL_RANGE = "sin costo";

// max null = sin techo. Los tramos son contiguos: min del siguiente = max + 1.
// Los ids viejos (starter/growth/scale/pro/unlimited) se conservan para que
// `plan_activated` de cuentas existentes siga resolviendo.
export const PRICING_TIERS = [
  { id: "free",       label: "Inicial",       usd: 0,    min: 0,     max: 10 },
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

// ═══════════════════════════════════════════════════════════════════════════
// MODELO VIGENTE desde el 30-sept-2026 (Thiago): ABONO + COMISIÓN.
//
// Los tramos de acá arriba tenían un escalón brutal: pasar de 50 a 51
// suscriptores duplicaba el costo por suscriptor (el número 51 costaba US$ 100
// al mes). Una prospecta lo marcó y los números le daban la razón, así que el
// precio pasa a ser:
//
//   US$ 99 por mes  +  un % de TODO lo cobrado en esos 30 días
//
// El % baja con la cantidad de suscriptores activos:
//   hasta 300 → 1,8 %   ·   301 a 1000 → 1,5 %   ·   más de 1000 → 1,3 %
//
// Ciclo: el comercio paga los primeros US$ 99 cuando le dejamos el widget
// andando. A los 30 días paga los US$ 99 del mes que empieza MÁS el % de lo que
// se cobró en el mes que terminó (por eso la comisión siempre va vencida).
//
// El descuento de por vida (`legacy_pricing`) se aplica SOLO al abono, nunca al
// %: a Wellfresh se le prometió la mitad, o sea US$ 49,50 + 1,8 %.
//
// Ya no hay plan gratis. La única excepción son las tiendas que venían con el
// modelo viejo (`legacy_free_tier`): siguen sin pagar hasta 10 suscriptores y
// al llegar a 11 entran al modelo nuevo.
export const SAAS_BASE_USD = 99;

// max null = sin techo. Contiguos: el siguiente empieza en max + 1.
// Los tres planes se llaman distinto pero cuestan lo mismo: cambia solo el %.
// El comercio no elige: le toca el que corresponde a sus suscriptores activos.
export const COMMISSION_TIERS = [
  { id: "starter",  label: "Starter",      pct: 1.8, min: 0,    max: 300,  range: "Hasta 300 suscriptores" },
  { id: "estandar", label: "Estándar",     pct: 1.5, min: 301,  max: 1000, range: "301 a 1.000 suscriptores" },
  { id: "pro",      label: "Profesional",  pct: 1.3, min: 1001, max: null, range: "Más de 1.000 suscriptores" },
];

/** % de comisión que le toca a una tienda por su cantidad de suscriptores activos. */
/** El plan que le toca a una tienda por su cantidad de suscriptores activos. */
export function planFor(activeSubscribers) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  return COMMISSION_TIERS.find(x => x.max == null || n <= x.max) || COMMISSION_TIERS[COMMISSION_TIERS.length - 1];
}
export const commissionPct = (activeSubscribers) => planFor(activeSubscribers).pct;

/** "1,8 % de lo que cobrás" — para el panel y la landing. */
export const commissionLabel = (pct) => String(pct).replace(".", ",") + " %";

/** ¿Esta tienda conserva el plan gratis del modelo viejo? */
export const hasLegacyFreeTier = (merchant) => merchant?.legacy_free_tier === true;

/**
 * La factura de un ciclo. `gmv_ars` = todo lo cobrado (aprobado) en esos 30 días;
 * `usd_rate` = el blue venta del día del cierre. El abono lleva el descuento de
 * por vida de la tienda; la comisión NO.
 */
export function billFor({ merchant, subs, gmvArs = 0, usdRate = 0 } = {}) {
  const plan = planFor(subs);
  const pct = plan.pct;
  const baseUsd = Math.round(SAAS_BASE_USD * priceFactor(merchant) * 100) / 100;
  const ars = Math.max(0, Math.round(Number(gmvArs) || 0));
  const rate = Number(usdRate) > 0 ? Number(usdRate) : 0;
  const gmvUsd = rate ? Math.round((ars / rate) * 100) / 100 : 0;
  const commissionUsd = Math.round(gmvUsd * pct) / 100;
  return {
    plan: plan.id,
    plan_label: plan.label,
    base_usd: baseUsd,
    pct,
    gmv_ars: ars,
    usd_rate: rate,
    gmv_usd: gmvUsd,
    commission_usd: commissionUsd,
    total_usd: Math.round((baseUsd + commissionUsd) * 100) / 100,
  };
}

// ── Precio de por vida de una tienda (22-sept-2026 / 27-sept-2026, Thiago) ──
// `legacy_pricing` es el FACTOR que paga esa tienda sobre el precio de lista:
// 1 = lista, 0.5 = mitad. Nació cuando se duplicaron los precios (las tiendas
// anteriores al aumento pagan la mitad: es el trato que tenían), y ahora es
// también el descuento de por vida que Thiago promete a mano desde el Admin
// —a Glow Derm le prometió 50% para siempre en todos los planes—.
//
// Es de POR VIDA a propósito: se aplica a cualquier tramo, hoy y cuando crezca.
// Sin el campo, paga precio de lista.
export const LEGACY_FACTOR_DEFAULT = 0.5;
// Tope: un 100% de descuento no es un descuento, es una tienda gratis — para eso
// está `plan: "beta"` / `internal`, que además la sacan de los agregados.
export const MAX_DISCOUNT_PCT = 90;

/** Factor de precio de una tienda: 1 = lista, 0.5 = mitad. */
export function priceFactor(merchant) {
  const f = Number(merchant?.legacy_pricing);
  return Number.isFinite(f) && f > 0 && f <= 1 ? f : 1;
}

/** El mismo factor, como descuento en % para mostrar y para el Admin. 0 = sin descuento. */
export const discountPct = (merchant) => Math.round((1 - priceFactor(merchant)) * 100);
/** % → factor. 50 => 0.5. Fuera de rango o 0 => null (sin descuento, se borra el campo). */
export function factorFromPct(pct) {
  const n = Math.round(Number(pct) || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n > MAX_DISCOUNT_PCT) return undefined;   // inválido: lo rechaza el caller
  return Math.round((1 - n / 100) * 100) / 100;
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
