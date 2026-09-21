// shared/bundle/viewmodel.js
//
// ViewModel del widget de packs (bundle). Convierte { plan, merchant } (docs
// crudos de Firestore o la respuesta de GET /api/public?action=plan) en un
// objeto saneado y listo para renderizar con `renderBundle` (templates.js).
//
// Corre igual en Node y en el navegador: sin `process`, sin `require`, sin
// dependencias. Todo número sale entero >= 0 y todo string recortado a 60.
//
// Contrato (ver SPEC.md):
//   buildBundleVM({ plan, merchant }) → vm
//   fmtARS(n)      → "$44.990"  (punto de miles, sin decimales)
//   freqLabel(d)   → "mes" | "2 meses" | "semana" | "2 semanas" | "N días"
//   resolvePack(plan, idx) → pack crudo resuelto (precios/frecuencia) — sin
//                    dependencias externas, se puede serializar con .toString()
//   planHasPacks(plan) → bool (pricing_mode "packs" o packs.length > 0)

export const VARIANT_IDS = ["v01", "v02", "v03", "v04", "v05", "v06", "v07", "v08", "v09", "v10", "v11", "v12"];

export const TEXT_DEFAULTS = Object.freeze({
  headline: "Elegí tu pack",
  once_label: "Compra única",
  sub_label: "Suscripción",
  cta_once: "Agregar al carrito",
  cta_sub: "Suscribirme",
  savings_label: "Ahorrás {pct}%",
  per_unit_label: "{price} c/u",
  freq_prefix: "Te llega cada",
  trust_lines: ["Cancelás cuando quieras", "Envío a todo el país"],
});

export const MAX_PACKS = 6;
const MAX_STR = 60;
const MAX_TRUST = 6;

// ─── Helpers de saneo ────────────────────────────────────────────────
function int(v, fallback) {
  const n = Math.round(Number(v));
  if (!isFinite(n) || n < 0) return fallback;
  return n;
}
function str(v, fallback, max) {
  if (typeof v !== "string") return fallback;
  const s = v.replace(/\s+/g, " ").trim().slice(0, max || MAX_STR);
  return s || fallback;
}
function bool(v, fallback) {
  return typeof v === "boolean" ? v : fallback;
}

// ─── Formato ─────────────────────────────────────────────────────────
export function fmtARS(n) {
  var v = Math.round(Number(n) || 0);
  var neg = v < 0;
  var s = String(Math.abs(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (neg ? "-$" : "$") + s;
}

// Etiqueta humana de la frecuencia (sin el "cada"): se usa como
// "Te llega cada " + freqLabel(d).
export function freqLabel(days) {
  var d = Math.round(Number(days) || 0);
  if (d <= 0) return "";
  if (d === 1) return "día";
  if (d === 7) return "semana";
  if (d === 14) return "2 semanas";
  if (d === 30) return "mes";
  if (d % 30 === 0) return (d / 30) + " meses";
  return d + " días";
}

// ¿El plan se vende por packs? (SPEC: default "packs" si hay packs, salvo que
// pricing_mode diga "theme" explícitamente).
export function planHasPacks(plan) {
  if (!plan || typeof plan !== "object") return false;
  if (String(plan.pricing_mode || "").toLowerCase() === "theme") return false;
  return Array.isArray(plan.packs) && plan.packs.length > 0;
}

// Resuelve UN pack del plan aplicando los defaults del SPEC:
//   sub_price_ars   null → round(price_ars × (1 − discount_pct/100))
//   compare_at_ars  null → base_price_ars × qty  (o price del pack de qty 1 × qty)
//   frequency_days  null → frequency_scales_with_qty ? plan.frequency_days × qty : plan.frequency_days
// AUTOCONTENIDA a propósito (no usa nada del módulo): el embed de checkout la
// inyecta con `.toString()` para calcular el resumen en el navegador.
export function resolvePack(plan, idx) {
  // Misma fórmula que api/_lib/packs.js (resolvePack) — mantener en sincronía.
  var packs = (plan && Array.isArray(plan.packs)) ? plan.packs : [];
  var raw = packs[idx];
  if (!raw || typeof raw !== "object") return null;
  function toInt(v) { if (v === "" || v == null) return null; var n = Number(v); return Number.isInteger(n) ? n : null; }
  var qty = Math.max(1, toInt(raw.qty) != null ? toInt(raw.qty) : 1);
  var priceOnce = Math.max(0, Math.round(Number(raw.price_ars) || 0));
  var disc = Math.max(0, Math.min(90, Number(plan.discount_pct) || 0));
  var subOverride = toInt(raw.sub_price_ars);
  var priceSub = (subOverride != null && subOverride >= 1) ? subOverride : Math.round(priceOnce * (1 - disc / 100));
  var basePrice = Number(plan.base_price_ars) || 0;
  var unitPack = null;
  for (var i = 0; i < packs.length; i++) { if (packs[i] && toInt(packs[i].qty) === 1) { unitPack = packs[i]; break; } }
  var unitRef = basePrice > 0 ? basePrice : (unitPack ? (Number(unitPack.price_ars) || 0) : 0);
  var compareOverride = toInt(raw.compare_at_ars);
  // 0 = sin tachado (el backend devuelve null; acá usamos 0 para operar como número)
  var compareAt = (compareOverride != null && compareOverride >= priceOnce) ? compareOverride
    : (unitRef > 0 ? Math.round(unitRef * qty) : 0);
  var planFreq = Math.max(1, parseInt(plan.frequency_days, 10) || 30);
  var freqOverride = toInt(raw.frequency_days);
  var freqDays = (freqOverride != null && freqOverride >= 1 && freqOverride <= 365)
    ? freqOverride
    : (plan.frequency_scales_with_qty !== false ? planFreq * qty : planFreq);
  var label = typeof raw.label === "string" ? raw.label.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  var badge = typeof raw.badge === "string" ? raw.badge.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  // Foto del pack (la usan v11/v12). Solo https: evita contenido mixto y javascript:.
  var image = typeof raw.image === "string" && /^(https:\/\/|data:image\/)/i.test(raw.image) ? raw.image : null;
  return {
    idx: idx, qty: qty, label: label || (qty === 1 ? "1 unidad" : qty + " unidades"), badge: badge,
    priceOnce: priceOnce, priceSub: priceSub, compareAt: compareAt, freqDays: freqDays,
    image: image,
    gifts: Array.isArray(raw.gifts) ? raw.gifts.slice(0, 3).map(function (g) {
      return {
        title: String(g && g.title || "").slice(0, 80),
        image: g && typeof g.image === "string" && /^(https:\/\/|data:image\/)/i.test(g.image) ? g.image : null,
        compareAt: Number(g && g.compare_at_ars) > 0 ? Number(g.compare_at_ars) : null,
      };
    }).filter(function (g) { return g.title; }) : [],
    isDefault: raw.default === true,
  };
}

// Vista de un pack para un modo: precio a mostrar, tachado, ahorro, por unidad.
// El tachado siempre es el ancla más alta disponible (compare_at); si en
// suscripción no hay compare_at, se tacha el precio de compra única.
function modeView(p, mode) {
  var price = mode === "sub" ? p.priceSub : p.priceOnce;
  var compare = 0;
  if (p.compareAt > price) compare = p.compareAt;
  else if (mode === "sub" && p.priceOnce > price) compare = p.priceOnce;
  var savingsArs = compare ? compare - price : 0;
  var savingsPct = compare ? Math.round((1 - price / compare) * 100) : 0;
  return {
    price: price,
    compare: compare,
    savingsArs: savingsArs,
    savingsPct: Math.max(0, Math.min(99, savingsPct)),
    perUnit: Math.round(price / p.qty),
  };
}

function sanitizeTexts(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const k of Object.keys(TEXT_DEFAULTS)) {
    if (k === "trust_lines") continue;
    out[k] = str(t[k], TEXT_DEFAULTS[k]);
  }
  let lines = Array.isArray(t.trust_lines) ? t.trust_lines : TEXT_DEFAULTS.trust_lines;
  lines = lines.filter((l) => typeof l === "string" && l.trim()).map((l) => str(l, "")).filter(Boolean).slice(0, MAX_TRUST);
  out.trust_lines = lines;
  return out;
}

// ─── buildBundleVM ───────────────────────────────────────────────────
export function buildBundleVM({ plan, merchant } = {}) {
  plan = plan && typeof plan === "object" ? plan : {};
  merchant = merchant && typeof merchant === "object" ? merchant : {};

  const variant = VARIANT_IDS.includes(merchant.widget_variant) ? merchant.widget_variant : "v01";
  const accent = (typeof merchant.widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(merchant.widget_color.trim()))
    ? merchant.widget_color.trim().toLowerCase()
    : "#10b981";
  const radius = Math.min(40, int(merchant.widget_radius, 14));
  // Ajustes de tamaño (21-sept-2026, Thiago). Los tres son relativos a lo que
  // ya se veía: 100 = idéntico a antes, así que ninguna tienda cambia sola.
  //  · scale  80…120 → tamaño de letra (el widget usa em, así que mueve todo junto)
  //  · boxes  80…120 → alto/padding de las tarjetas, sin tocar la letra
  //  · edge   pegado a los bordes del contenedor (true) o con aire a los costados
  const scale = Math.max(80, Math.min(120, int(merchant.widget_scale, 100)));
  const boxes = Math.max(80, Math.min(120, int(merchant.widget_box_scale, 100)));
  const edge = bool(merchant.widget_edge_to_edge, false);
  const texts = sanitizeTexts(merchant.widget_texts);
  const showCompare = bool(merchant.widget_show_compare, true);
  const showPerUnit = bool(merchant.widget_show_per_unit, true);
  const modeDefault = merchant.widget_mode_default === "once" ? "once" : "sub";
  const modeOrder = merchant.widget_mode_order === "once_first" ? "once_first" : "sub_first";
  const discountPct = Math.min(90, int(plan.discount_pct, 0));

  const rawPacks = Array.isArray(plan.packs) ? plan.packs.slice(0, MAX_PACKS) : [];
  const packs = [];
  for (let i = 0; i < rawPacks.length; i++) {
    const r = resolvePack({ ...plan, packs: rawPacks }, i);
    if (!r) continue;
    const once = modeView(r, "once");
    const sub = modeView(r, "sub");
    packs.push({
      idx: packs.length,
      qty: r.qty,
      label: r.label,
      badge: r.badge,
      image: r.image || null,
      gifts: Array.isArray(r.gifts) ? r.gifts : [],
      priceOnce: r.priceOnce,
      priceSub: r.priceSub,
      compareAt: r.compareAt,
      savingsPct: sub.savingsPct,        // ahorro headline (suscripción vs. tachado)
      savingsPctOnce: once.savingsPct,
      perUnitSub: sub.perUnit,
      perUnitOnce: once.perUnit,
      freqDays: r.freqDays,
      freqLabel: freqLabel(r.freqDays),
      isDefault: r.isDefault,
      once,                               // { price, compare, savingsArs, savingsPct, perUnit }
      sub,
    });
  }

  // Pack seleccionado por defecto: el marcado default → el que tiene badge → el primero.
  let defaultIdx = packs.findIndex((p) => p.isDefault);
  if (defaultIdx < 0) defaultIdx = packs.findIndex((p) => p.badge);
  if (defaultIdx < 0) defaultIdx = 0;
  packs.forEach((p) => { p.isDefault = p.idx === defaultIdx; });

  return {
    variant,
    accent,
    radius,
    scale,
    boxes,
    edge,
    texts,
    showCompare,
    showPerUnit,
    modeDefault,
    modeOrder,
    discountPct,
    productTitle: str(plan.product_title, "", 120),
    packs,
    defaultIdx,
    currency: "ARS",
  };
}

export default buildBundleVM;
