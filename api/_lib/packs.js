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

// 12 = 6 por columna (22-sept-2026): los packs de compra unica y los de
// suscripcion son bloques distintos y conviven en la misma lista.
export const MAX_PACKS = 12;
// Regalos por pack (v12): lo que se anuncia como "+ GRATIS ...".
export const MAX_GIFTS = 3;

const isInt = (n) => Number.isInteger(n);

// Foto de un pack o de un regalo. Dos formas válidas:
//   · data:image/... → la subió el comerciante desde el panel (ya achicada en
//     el navegador). Tope 200 KB: Firestore corta el documento en 1 MB y un
//     plan puede tener 6 packs con 3 regalos cada uno.
//   · https://...    → la copió de su tienda. http:// queda afuera para no
//     romper la tienda con contenido mixto, y evita javascript:.
const MAX_IMG_CHARS = 200000;
function cleanImage(v, at, que) {
  const u = String(v).trim();
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(u)) {
    if (u.length > MAX_IMG_CHARS) return { error: `${at}: ${que} pesa demasiado, probá con una imagen más chica` };
    return { value: u };
  }
  if (/^https:\/\/[^\s"'<>]+$/i.test(u)) return { value: u.slice(0, 500) };
  return { error: `${at}: ${que} tiene que ser una imagen subida o un link https://` };
}
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

  // Cantidad que se manda en cada modo. subQty distinto = el pack de 3 sueltos
  // entrega 4 cuando se suscribe. Sin el campo, la misma de siempre.
  const subQtyRaw = toInt(pack.sub_qty);
  const subQty = subQtyRaw != null && subQtyRaw >= 1 && subQtyRaw <= 50 ? subQtyRaw : qty;

  return {
    idx: i, qty, price, subPrice, compareAt, freq, savingsPct, subQty,
    hideOnce: pack.hide_once === true,
    hideSub: pack.hide_sub === true,
    label: typeof pack.label === "string" ? pack.label : "",
    note: typeof pack.note === "string" ? pack.note : "",
    note_once: typeof pack.note_once === "string" ? pack.note_once : "",
    badge: typeof pack.badge === "string" && pack.badge ? pack.badge : null,
    // Foto del pack: subida (data:image) o link https. normalizePacks ya lo
    // valida al guardar; acá volvemos a filtrar por si un plan viejo o una
    // escritura a mano dejó otra cosa.
    image: typeof pack.image === "string" && /^(https:\/\/|data:image\/)/i.test(pack.image) ? pack.image : null,
    gifts: Array.isArray(pack.gifts) ? pack.gifts.filter(g => g && typeof g.title === "string" && g.title).slice(0, MAX_GIFTS) : [],
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
  // Una cantidad puede repetirse entre listas (un bloque de 2 en compra única y
  // otro de 2 en suscripción), pero no DENTRO de la misma. 22-sept-2026.
  const seenOnce = new Set(), seenSub = new Set();
  let defaults = 0;
  for (let n = 0; n < input.length; n++) {
    const p = input[n];
    const at = `pack #${n + 1}`;
    if (!p || typeof p !== "object") return { error: `${at}: inválido` };
    const qty = toInt(p.qty);
    if (qty == null || qty < 1 || qty > 50) return { error: `${at}: qty debe ser un entero entre 1 y 50` };
    const ocultoOnce = p.hide_once === true, ocultoSub = p.hide_sub === true;
    if (!ocultoOnce) {
      if (seenOnce.has(qty)) return { error: `${at}: ya hay un bloque de compra única de ${qty} unidad${qty === 1 ? "" : "es"}` };
      seenOnce.add(qty);
    }
    if (!ocultoSub) {
      if (seenSub.has(qty)) return { error: `${at}: ya hay un bloque de suscripción de ${qty} unidad${qty === 1 ? "" : "es"}` };
      seenSub.add(qty);
    }
    const price_ars = toInt(p.price_ars);
    if (price_ars == null || price_ars < 1) return { error: `${at}: price_ars debe ser un entero ≥ 1` };
    let compare_at_ars = null;
    if (p.compare_at_ars != null && p.compare_at_ars !== "") {
      compare_at_ars = toInt(p.compare_at_ars);
      if (compare_at_ars == null || compare_at_ars < price_ars) return { error: `${at}: compare_at_ars debe ser un entero ≥ price_ars (o null)` };
    }
    const label = String(p.label ?? "").trim().slice(0, 40);
    // Texto propio del pack (21-sept-2026, Thiago): "tratamiento bimensual",
    // "tratamiento ultra". Antes solo se podía escribir el mismo prefijo de
    // frecuencia para TODOS los packs, así que no se podía diferenciar uno.
    const note = String(p.note ?? "").trim().slice(0, 120);
    // Y el de compra única (21-sept-2026, Thiago): el mismo renglón dice otra
    // cosa según el modo. "Tratamiento 4 meses" cuando se suscribe, "4 potes"
    // cuando lo compra suelto. Vacío = se usa el de suscripción (`note`), así
    // los packs que ya tenían texto no cambian.
    const note_once = String(p.note_once ?? "").trim().slice(0, 120);
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
    // Foto del pack (v11/v12): el comerciante pega la URL de la imagen que ya
    // tiene en su tienda (la del bundle, el combo de 3 frascos, etc.). Solo
    // https:// para no romper la tienda con contenido mixto ni meter javascript:.
    let image = null;
    if (p.image != null && String(p.image).trim()) {
      const r = cleanImage(p.image, at, "la foto del pack");
      if (r.error) return { error: r.error };
      image = r.value;
    }
    // Regalos del pack (v12): lo que se anuncia como "+ GRATIS ...". Son de
    // MARKETING: se muestran en el widget y se listan en el mail, pero NO entran
    // como línea en la orden (eso lo maneja el comerciante al despachar).
    let gifts = [];
    if (p.gifts != null) {
      if (!Array.isArray(p.gifts)) return { error: `${at}: gifts debe ser un array` };
      if (p.gifts.length > MAX_GIFTS) return { error: `${at}: máximo ${MAX_GIFTS} regalos` };
      for (const g of p.gifts) {
        if (!g || typeof g !== "object") return { error: `${at}: regalo inválido` };
        const title = String(g.title ?? "").trim().slice(0, 80);
        if (!title) return { error: `${at}: cada regalo necesita un nombre` };
        let gimg = null;
        if (g.image != null && String(g.image).trim()) {
          const gr = cleanImage(g.image, at, "la foto del regalo");
          if (gr.error) return { error: gr.error };
          gimg = gr.value;
        }
        let gcmp = null;
        if (g.compare_at_ars != null && g.compare_at_ars !== "") {
          gcmp = toInt(g.compare_at_ars);
          if (gcmp == null || gcmp < 1) return { error: `${at}: el valor del regalo debe ser un entero ≥ 1 (o vacío)` };
        }
        // Regalo ficticio (22-sept-2026, Thiago): un ebook que se manda por
        // fuera, un sorteo, algo que NO es un producto de la tienda. Como los
        // regalos ya eran solo de marketing (no entran como linea en la orden),
        // alcanza con marcarlo para poder decirlo en el widget.
        const virtual = g.virtual === true;
        const note = String(g.note ?? "").trim().slice(0, 120);
        gifts.push({ title, image: gimg, compare_at_ars: gcmp, virtual, note });
      }
    }
    // En que modo se muestra este pack (22-sept-2026, Thiago): el comerciante
    // quiere 3 bloques en compra unica y solo 2 en suscripcion. Se guarda como
    // "se esconde en X" y no "se muestra en X" a proposito: asi un pack viejo,
    // que no tiene ninguno de los dos campos, sigue apareciendo en los dos
    // modos igual que siempre.
    const hide_once = p.hide_once === true;
    const hide_sub = p.hide_sub === true;
    if (hide_once && hide_sub) return { error: `${at}: tiene que mostrarse al menos en un modo` };
    // Cantidad propia para suscripcion: el pack de 3 sueltos puede mandar 4
    // cuando se suscribe. Vacio = la misma que en compra unica.
    let sub_qty = null;
    if (p.sub_qty != null && p.sub_qty !== "") {
      sub_qty = toInt(p.sub_qty);
      if (sub_qty == null || sub_qty < 1 || sub_qty > 50) return { error: `${at}: la cantidad en suscripción debe ser un entero entre 1 y 50` };
    }
    const isDefault = p.default === true;
    if (isDefault) defaults++;
    if (defaults > 1) return { error: "Solo un pack puede ser el default" };
    out.push({ qty, price_ars, compare_at_ars, label, note, note_once, badge, frequency_days, sub_price_ars, image, gifts, default: isDefault, hide_once, hide_sub, sub_qty });
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
