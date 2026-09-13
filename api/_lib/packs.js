// Packs (bundles) de un plan — modelo de datos y cálculo compartido.
// Ver shared/bundle/SPEC.md. Sin dependencias: lo importan plans.js (validación),
// public.js (respuesta) y checkout/init.js (precio server-side).
//
//   plan.pricing_mode: "packs" | "theme"
//     · "theme" (default histórico, Lumina): el tema manda base/sub_off/freq_days
//       por URL y el checkout los valida contra Shopify (computeSubtotal).
//     · "packs": el merchant define los packs en el dashboard; el checkout SOLO
//       acepta `pack_index` y toma qty/precio/frecuencia del pack.
//   plan.packs: [{ qty, price_ars, compare_at_ars, label, badge, frequency_days, sub_price_ars, default }]
//   plan.frequency_scales_with_qty: bool (default true) → freq = plan.frequency_days × qty

export const MAX_PACKS = 6;

const isInt = (n) => Number.isInteger(n);
const toInt = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

export function planPacks(plan) {
  return Array.isArray(plan?.packs) ? plan.packs : [];
}

// "packs" | "theme". Sin pricing_mode explícito: "packs" si hay packs.
export function planPricingMode(plan) {
  const m = String(plan?.pricing_mode || "").toLowerCase();
  if (m === "packs" || m === "theme") return m;
  return planPacks(plan).length > 0 ? "packs" : "theme";
}

export function isPacksPlan(plan) {
  return planPricingMode(plan) === "packs" && planPacks(plan).length > 0;
}

// Índice del pack default (o el primero). -1 si no hay packs.
export function defaultPackIndex(plan) {
  const packs = planPacks(plan);
  if (!packs.length) return -1;
  const i = packs.findIndex(p => p && p.default === true);
  return i >= 0 ? i : 0;
}

// Parsea un pack_index del body/URL: entero ≥ 0 (número o string numérico).
// Devuelve null si no es válido.
export function parsePackIndex(v) {
  if (v === "" || v == null || typeof v === "boolean") return null;
  const s = String(v).trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  return parseInt(s, 10);
}

// Resuelve un pack → precios/frecuencia efectivos. null si idx inválido.
//   qty      = pack.qty
//   price    = pack.price_ars (compra única)
//   subPrice = pack.sub_price_ars ?? round(price_ars × (1 − discount_pct/100))
//   compareAt = pack.compare_at_ars ?? base_price_ars × qty ?? price(pack qty 1) × qty ?? null
//   freq     = pack.frequency_days ?? (frequency_scales_with_qty !== false ? plan.frequency_days × qty : plan.frequency_days)
export function resolvePack(plan, idx) {
  const packs = planPacks(plan);
  const i = parsePackIndex(idx);
  if (i == null || i < 0 || i >= packs.length) return null;
  const pack = packs[i] || {};
  const qty = Math.max(1, toInt(pack.qty) ?? 1);
  const price = Math.max(0, Math.round(Number(pack.price_ars) || 0));
  const discountPct = Math.max(0, Math.min(90, Number(plan?.discount_pct) || 0));
  const subOverride = toInt(pack.sub_price_ars);
  const subPrice = subOverride != null && subOverride >= 1 ? subOverride : Math.round(price * (1 - discountPct / 100));

  const basePrice = Number(plan?.base_price_ars) || 0;
  const unitPack = packs.find(p => toInt(p?.qty) === 1);
  const unitRef = basePrice > 0 ? basePrice : (unitPack ? (Number(unitPack.price_ars) || 0) : 0);
  const compareOverride = toInt(pack.compare_at_ars);
  const compareAt = compareOverride != null && compareOverride >= price ? compareOverride
    : (unitRef > 0 ? Math.round(unitRef * qty) : null);

  const planFreq = Math.max(1, parseInt(plan?.frequency_days, 10) || 30);
  const freqOverride = toInt(pack.frequency_days);
  const freq = freqOverride != null && freqOverride >= 1 && freqOverride <= 365
    ? freqOverride
    : (plan?.frequency_scales_with_qty !== false ? planFreq * qty : planFreq);

  // Descuento efectivo de la sub vs referencia (informativo).
  const ref = compareAt && compareAt > 0 ? compareAt : price;
  const savingsPct = ref > 0 && subPrice < ref ? Math.round(((ref - subPrice) / ref) * 100) : 0;

  return {
    idx: i, qty, price, subPrice, compareAt, freq, savingsPct,
    label: typeof pack.label === "string" ? pack.label : "",
    badge: typeof pack.badge === "string" && pack.badge ? pack.badge : null,
    isDefault: pack.default === true,
  };
}

// Valida y normaliza `packs` que vienen del dashboard.
// Devuelve { packs } o { error }. [] es válido (= sin packs).
export function normalizePacks(input) {
  if (input == null) return { packs: [] };
  if (!Array.isArray(input)) return { error: "packs debe ser un array" };
  if (input.length > MAX_PACKS) return { error: `Máximo ${MAX_PACKS} packs` };
  const out = [];
  const seenQty = new Set();
  let defaults = 0;
  for (let n = 0; n < input.length; n++) {
    const p = input[n];
    const at = `pack #${n + 1}`;
    if (!p || typeof p !== "object") return { error: `${at}: inválido` };
    const qty = toInt(p.qty);
    if (qty == null || qty < 1 || qty > 50) return { error: `${at}: qty debe ser un entero entre 1 y 50` };
    if (seenQty.has(qty)) return { error: `${at}: ya hay un pack de ${qty} unidad${qty === 1 ? "" : "es"}` };
    seenQty.add(qty);
    const price_ars = toInt(p.price_ars);
    if (price_ars == null || price_ars < 1) return { error: `${at}: price_ars debe ser un entero ≥ 1` };
    let compare_at_ars = null;
    if (p.compare_at_ars != null && p.compare_at_ars !== "") {
      compare_at_ars = toInt(p.compare_at_ars);
      if (compare_at_ars == null || compare_at_ars < price_ars) return { error: `${at}: compare_at_ars debe ser un entero ≥ price_ars (o null)` };
    }
    const label = String(p.label ?? "").trim().slice(0, 40);
    let badge = null;
    if (p.badge != null && String(p.badge).trim()) badge = String(p.badge).trim().slice(0, 24);
    let frequency_days = null;
    if (p.frequency_days != null && p.frequency_days !== "") {
      frequency_days = toInt(p.frequency_days);
      if (frequency_days == null || frequency_days < 1 || frequency_days > 365) return { error: `${at}: frequency_days debe ser un entero entre 1 y 365 (o null)` };
    }
    let sub_price_ars = null;
    if (p.sub_price_ars != null && p.sub_price_ars !== "") {
      sub_price_ars = toInt(p.sub_price_ars);
      if (sub_price_ars == null || sub_price_ars < 1) return { error: `${at}: sub_price_ars debe ser un entero ≥ 1 (o null)` };
    }
    const isDefault = p.default === true;
    if (isDefault) defaults++;
    if (defaults > 1) return { error: "Solo un pack puede ser el default" };
    out.push({ qty, price_ars, compare_at_ars, label, badge, frequency_days, sub_price_ars, default: isDefault });
  }
  out.sort((a, b) => a.qty - b.qty);
  return { packs: out };
}

// Campos de packs con defaults, para devolver el plan siempre con la misma forma.
export function withPackDefaults(plan) {
  const packs = planPacks(plan);
  return {
    ...plan,
    packs,
    pricing_mode: planPricingMode(plan),
    frequency_scales_with_qty: plan?.frequency_scales_with_qty !== false,
  };
}
