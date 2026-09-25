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

export const VARIANT_IDS = ["v01", "v02", "v03", "v04", "v05", "v06", "v07", "v08", "v09", "v10", "v11", "v12", "v13"];

export const TEXT_DEFAULTS = Object.freeze({
  headline: "Elegí tu pack",
  once_label: "Compra única",
  sub_label: "Suscripción",
  cta_once: "Agregar al carrito",
  cta_sub: "Suscribirme",
  savings_label: "Ahorrás {pct}%",
  per_unit_label: "{price} c/u",
  // "" a propósito (21-sept-2026): vacío = el widget arma "Te llegan 2 cada…"
  // con la cantidad del pack. Si el comerciante escribe algo acá, manda lo suyo.
  freq_prefix: "",
  trust_lines: ["Cancelás cuando quieras", "Envío a todo el país"],
  // 21-sept-2026 (Thiago): textos propios de COMPRA ÚNICA. Hasta hoy las
  // trust_lines eran solo de suscripción y en compra única no aparecía nada
  // más que el candado. Vacías por defecto = el widget queda igual que antes.
  trust_lines_once: [],
  // Nota libre debajo de cada modo. "" = no se pinta nada (sin cambio visual).
  note_sub: "",
  note_once: "",
  // Renglon chico del cuadro de suscripcion, cuando esta APAGADO (22-sept-2026,
  // Thiago). "" = el widget lo arma solo: "Activalo y te llega solo, cada 45
  // dias, con 15% off". Si escribe algo, manda lo suyo.
  sub_hint: "",
  // La pildora de descuento al lado de "Suscripcion". {pct} = el % del plan.
  // Una "x" la apaga (esApagado), como el resto de los textos.
  disc_label: "−{pct}%",
  // El precio dentro del boton ("· $65.990 cada 60 dias"). Una "x" lo apaga y
  // el boton queda solo con su etiqueta. 25-sept-2026, Thiago.
  cta_price: "· {price}{freq}",
  // La pildora de frecuencia DENTRO de cada pack ("Te llegan 2 cada 60 dias").
  // Una "x" la apaga. Vacio = como siempre.
  pack_freq: "{prefix} {freq}",
  // Apagar el "c/u" en UN solo modo con una "x". Vacio = se muestra.
  per_unit_sub: "",
  per_unit_once: "",
});

// 12 = 6 por columna (22-sept-2026): los packs de compra unica y los de
// suscripcion son bloques distintos y conviven en la misma lista.
export const MAX_PACKS = 12;
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
// SIEMPRE en dias (22-sept-2026, Thiago): antes 30 decia "mes" y 45 "45 dias",
// asi que en el mismo widget convivian "te llegan 2 cada mes" y "te llegan 3
// cada 45 dias". Queda mejor dicho —y comparable— con la misma unidad en todos
// los packs. Se mantiene "dia" en singular para el caso de 1.
// `unidad`: "dias" (default) o "meses". Thiago, 24-sept-2026: Wellfresh lo
// necesita en días y Lumina en meses, así que cada bloque lo elige.
export function freqLabel(days, unidad) {
  var d = Math.round(Number(days) || 0);
  if (d <= 0) return "";
  if (unidad === "meses") {
    var m = Math.round(d / 30);
    if (m >= 1) return m === 1 ? "mes" : m + " meses";
  }
  if (d === 1) return "día";
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
  // Texto propio del pack: "tratamiento bimensual", "dura 4 meses"… Vacío = no
  // se pinta nada y el widget queda como antes.
  var note = typeof raw.note === "string" ? raw.note.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  // El mismo renglón, distinto según el modo. Sin cargar = se usa el de
  // suscripción, así los packs que ya tenían texto siguen igual.
  var noteOnce = typeof raw.note_once === "string" ? raw.note_once.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  // Foto del pack (la usan v11/v12). Solo https: evita contenido mixto y javascript:.
  var image = typeof raw.image === "string" && /^(https:\/\/|data:image\/)/i.test(raw.image) ? raw.image : null;
  // Cantidad propia para suscripcion (22-sept-2026): el pack de 3 sueltos puede
  // entregar 4 al suscribirse. Vacio = la misma cantidad.
  var subQtyRaw = toInt(raw.sub_qty);
  var subQty = subQtyRaw != null && subQtyRaw >= 1 && subQtyRaw <= 50 ? subQtyRaw : qty;

  return {
    idx: idx, qty: qty, label: label || (qty === 1 ? "1 unidad" : qty + " unidades"), badge: badge, note: note, noteOnce: noteOnce,
    priceOnce: priceOnce, priceSub: priceSub, compareAt: compareAt, freqDays: freqDays,
    image: image,
    // En que modo se muestra. Un pack viejo no tiene ninguno de los dos: sale
    // en los dos modos, como siempre.
    hideOnce: raw.hide_once === true,
    hideSub: raw.hide_sub === true,
    subQty: subQty,
    // "meses" muestra "cada 2 meses"; vacío o "dias" = "cada 60 días".
    freqUnit: raw.freq_unit === "meses" ? "meses" : "dias",
    gifts: Array.isArray(raw.gifts) ? raw.gifts.slice(0, 3).map(function (g) {
      return {
        title: String(g && g.title || "").slice(0, 80),
        image: g && typeof g.image === "string" && /^(https:\/\/|data:image\/)/i.test(g.image) ? g.image : null,
        compareAt: Number(g && g.compare_at_ars) > 0 ? Number(g.compare_at_ars) : null,
        // Regalo que no es un producto de la tienda (ebook, sorteo).
        virtual: g && g.virtual === true,
        note: String(g && g.note || "").slice(0, 120),
        // "once" = solo en el primer envio; "always" (default) = en todos.
        every: g && g.every === "once" ? "once" : "always",
        // Producto de la tienda vinculado: el widget lo agrega al carrito.
        variantId: g && g.shopify_variant_id != null && /^\d{1,20}$/.test(String(g.shopify_variant_id)) ? String(g.shopify_variant_id) : null,
        discountCode: g && typeof g.discount_code === "string" && /^[A-Z0-9_-]{1,40}$/.test(g.discount_code) ? g.discount_code : null,
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

// Una "x" sola en un campo = APAGAR ese texto (21-sept-2026, Thiago). Dejarlo
// vacío no alcanza: el widget cae al default y el texto vuelve a aparecer. Con
// la x el campo queda en "" y la sección entera desaparece (los helpers que lo
// pintan ya devuelven "" y las variantes saben no dibujar el bloque).
// Se acepta "x" o "X", sola y sin nada más, para que nadie apague un texto sin querer.
export const esApagado = (v) => typeof v === "string" && /^\s*[xX]\s*$/.test(v);

function sanitizeTexts(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const k of Object.keys(TEXT_DEFAULTS)) {
    if (k === "trust_lines" || k === "trust_lines_once") continue;
    out[k] = esApagado(t[k]) ? "" : str(t[k], TEXT_DEFAULTS[k]);
  }
  const limpiar = (arr, fallback) => {
    const src = Array.isArray(arr) ? arr : fallback;
    // Una línea en "x" se borra de la lista, igual que si estuviera vacía.
    return src.filter((l) => typeof l === "string" && l.trim() && !esApagado(l)).map((l) => str(l, "")).filter(Boolean).slice(0, MAX_TRUST);
  };
  out.trust_lines = limpiar(t.trust_lines, TEXT_DEFAULTS.trust_lines);
  out.trust_lines_once = limpiar(t.trust_lines_once, TEXT_DEFAULTS.trust_lines_once);
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
  //  · borders 100…300 → grosor del borde de las tarjetas (100 = como siempre)
  const borders = Math.max(100, Math.min(300, int(merchant.widget_border_scale, 100)));
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
      // OJO: idx es el indice REAL en plan.packs, no la posicion en la lista
      // visible. El checkout cobra por ese indice, asi que esconder un pack en
      // un modo no puede correr los demas. 22-sept-2026.
      idx: i,
      hideOnce: r.hideOnce,
      hideSub: r.hideSub,
      subQty: r.subQty,
      qty: r.qty,
      label: r.label,
      note: r.note,
      noteOnce: r.noteOnce,
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
      freqLabel: freqLabel(r.freqDays, r.freqUnit),
      freqUnit: r.freqUnit,
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
    borders,
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
