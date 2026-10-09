// Recetas de instalación (7-oct-2026, Thiago: "un configurador de G4U en el admin,
// las variables, los productos, todo lo más automatizado posible").
//
// Una receta dice QUÉ planes crear (los productos de la tienda, los packs, el
// descuento, la frecuencia) y CÓMO dejar el widget y el checkout. Admin → Puesta
// en marcha la aplica con un botón: crea los planes que falten (apagados, como
// nacen todos), actualiza los que ya existan y guarda los ajustes de la tienda.
// Fuente única para api/_lib/admin.js (aplica) y src/pages/AdminOnboarding.jsx (edita).

export const RECETAS = [
  {
    id: "g4u",
    nombre: "G4U · panificados proteicos",
    tienda: "g4u-ar.com",
    // Handles de Shopify (se cruzan con el catálogo real al aplicar). Los 9 sueltos, sin los combos.
    productos: [
      "pan-de-molde-proteico",
      "tortilla-proteica-low-carb-sin-azucar-apto-keto-10-unidades",
      "pan-arabe-proteico-low-carb-sin-azucar-apto-keto-4-unidades",
      "pan-hamburguesa-proteico",
      "pan-ciabatta-proteico-low-carb-sin-azucar-apto-keto-4-unidades-copia",
      "grisin-queso-proteico-low-carb-sin-azucar-apto-keto",
      "marineras-semillas-proteico-low-carb-sin-azucar-apto-keto",
      "tostaditas-semillas-proteico-low-carb-sin-azucar-apto-keto",
      "tostaditas-cebolla-proteico-low-carb-sin-azucar-apto-keto",
    ],
    // Como su app de bundles: 1 / 4 / 8, el de 8 "Más elegido".
    packs: [{ qty: 1 }, { qty: 4 }, { qty: 8, badge: "Más elegido", default: true }],
    discount_pct: 15,
    frequency_days: 30,
    frequency_options: [15, 30, 60],   // el cliente elige: cada 15 días / cada mes / cada 2 meses
    frequency_scales_with_qty: false,  // 4 panes cada 30 días, no cada 120
    mix: true,                         // cada plan deja mezclar con los otros productos de la receta
    widget: { color: "#500322", mode_default: "once", cart_drawer: true },
    checkout: { color: "#500322" },
    upsells: true,                     // "Sumá a tu suscripción" con los otros planes
    // 9-oct-2026 (Thiago: "que cuando configure G4U ya estén los mails"): mail de atención,
    // marca, flujos de mail prendidos y plantillas de WhatsApp. El mail lo da la tienda.
    comunicacion: { reply_to: "", brand: "G4U", flujos: ["upcoming_charge", "checkout_started"], upcoming_days_before: 2, whatsapp: true, wa_templates: ["aviso_proximo_cobro", "carrito_sin_pagar", "sin_stock", "pago_rechazado", "pedido_modificado"] },
    pendientes: [
      "Logística → Envíos: \"Poner todos gratis\" con gratis desde $95.000 (como su tienda).",
      "Activar los planes cuando el widget esté pegado (nacen apagados).",
      "Pegar el snippet en layout/theme.liquid y \"Activar en mi tienda\".",
      "Menú y home: \"Suscripción\" → su página de suscripción; botón \"Suscribite y ahorrá 15%\" con ?rec_modo=sub en la ficha.",
    ],
  },
];

// Receta en blanco para una tienda nueva: packs x1/x2/x3, 15 %, cada 30 días.
export const RECETA_VACIA = {
  id: "", nombre: "A medida", tienda: "",
  productos: [],
  packs: [{ qty: 1 }, { qty: 2 }, { qty: 3, badge: "Más elegido", default: true }],
  discount_pct: 15, frequency_days: 30, frequency_options: [], frequency_scales_with_qty: false,
  mix: false,
  widget: { color: "", mode_default: "sub", cart_drawer: true },
  checkout: { color: "" },
  upsells: true,
  comunicacion: { reply_to: "", brand: "", flujos: ["upcoming_charge", "checkout_started"], upcoming_days_before: 3, whatsapp: false, wa_templates: ["aviso_proximo_cobro", "carrito_sin_pagar"] },
  pendientes: [],
};

export const RECETA_FLUJOS = ["upcoming_charge", "checkout_started", "activated", "payment_failed", "cancelled"];
export const RECETA_WA = ["aviso_proximo_cobro", "carrito_sin_pagar", "sin_stock", "pago_rechazado", "suscripcion_activa", "renovacion_cobrada", "pedido_modificado"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function recetaPorId(id) {
  return RECETAS.find(r => r.id === id) || null;
}

const int = (v, min, max, dflt) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= min && n <= max ? n : dflt; };
const hex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : "";

// Lo que llega del Admin (editado a mano) → receta saneada o { error }.
export function normalizeReceta(input) {
  const r = input && typeof input === "object" ? input : {};
  const productos = Array.isArray(r.productos) ? [...new Set(r.productos.map(x => String(x || "").trim()).filter(Boolean))].slice(0, 40) : [];
  if (!productos.length) return { error: "Elegí al menos un producto." };
  const packsRaw = Array.isArray(r.packs) ? r.packs : [];
  const packs = []; const seen = new Set();
  for (const p of packsRaw) {
    const qty = int(p?.qty, 1, 50, null);
    if (qty == null || seen.has(qty)) continue;
    seen.add(qty);
    packs.push({ qty, badge: String(p?.badge || "").trim().slice(0, 48), default: p?.default === true });
  }
  if (!packs.length) return { error: "Poné al menos un pack (por ejemplo 1, 4, 8)." };
  packs.sort((a, b) => a.qty - b.qty);
  if (!packs.some(p => p.default)) packs[packs.length - 1].default = true;
  const discount_pct = int(r.discount_pct, 0, 80, 15);
  const frequency_days = int(r.frequency_days, 1, 365, 30);
  const foRaw = Array.isArray(r.frequency_options) ? r.frequency_options : String(r.frequency_options || "").split(/[,\s]+/);
  const frequency_options = [...new Set(foRaw.map(v => int(v, 1, 365, null)).filter(v => v != null))].sort((a, b) => a - b).slice(0, 6);
  const c = r.comunicacion && typeof r.comunicacion === "object" ? r.comunicacion : {};
  const reply_to = String(c.reply_to || "").trim().toLowerCase();
  if (reply_to && !EMAIL_RE.test(reply_to)) return { error: "El mail de atención al cliente no es válido." };
  const comunicacion = {
    reply_to,
    brand: String(c.brand || "").trim().slice(0, 40),
    flujos: [...new Set((Array.isArray(c.flujos) ? c.flujos : []).map(String).filter(f => RECETA_FLUJOS.includes(f)))],
    upcoming_days_before: int(c.upcoming_days_before, 1, 14, 3),
    whatsapp: c.whatsapp === true,
    wa_templates: [...new Set((Array.isArray(c.wa_templates) ? c.wa_templates : []).map(String).filter(t => RECETA_WA.includes(t)))],
  };
  return {
    receta: {
      id: String(r.id || "").slice(0, 40),
      productos, packs, discount_pct, frequency_days, frequency_options,
      comunicacion,
      frequency_scales_with_qty: r.frequency_scales_with_qty === true,
      mix: r.mix === true,
      widget: { color: hex(r.widget?.color), mode_default: r.widget?.mode_default === "once" ? "once" : "sub", cart_drawer: r.widget?.cart_drawer !== false },
      checkout: { color: hex(r.checkout?.color) },
      upsells: r.upsells !== false,
    },
  };
}

// Los cuerpos de los planes a crear, a partir de la receta y del catálogo REAL de la
// tienda (lo que devuelve Shopify: id, handle, title, image, variants[{ id, price }]).
// Un producto por plan; la primera variante es la del plan (el widget manda la del
// selector al comprar). El precio de lista sale de la tienda, nunca de la receta.
export function planesDeReceta(receta, productos) {
  const elegidos = receta.productos.map(k => productos.find(p => String(p.handle) === k || String(p.id) === k)).filter(Boolean);
  const faltan = receta.productos.filter(k => !productos.some(p => String(p.handle) === k || String(p.id) === k));
  const base = (p) => Math.round(Number(p.variants?.[0]?.price) || 0);
  const planes = elegidos.filter(p => base(p) > 0 && p.variants?.[0]?.id).map(p => {
    const price = base(p);
    const otros = receta.mix ? elegidos.filter(o => o.id !== p.id && base(o) > 0 && o.variants?.[0]?.id).map(o => ({
      shopify_product_id: String(o.id), shopify_variant_id: String(o.variants[0].id), title: String(o.title || "").slice(0, 120), image: o.image || null, price_ars: base(o),
    })) : [];
    return {
      shopify_product_id: String(p.id),
      shopify_variant_id: String(p.variants[0].id),
      product_title: String(p.title || "").slice(0, 120),
      product_image: p.image || null,
      frequency_days: receta.frequency_days,
      discount_pct: receta.discount_pct,
      units_per_shipment: 1,
      base_price_ars: price,
      pricing_mode: "packs",
      packs: receta.packs.map(k => ({ qty: k.qty, price_ars: price * k.qty, label: k.qty === 1 ? "1 pack" : `${k.qty} pack`, badge: k.badge || null, default: k.default === true })),
      frequency_scales_with_qty: receta.frequency_scales_with_qty === true,
      frequency_options: receta.frequency_options,
      mix: receta.mix && otros.length ? { enabled: true, items: otros } : null,
      // Con tienda conectada el envío lo cotiza la tienda: el del plan queda en 0.
      shipping_price_ars: 0, free_shipping_from_ars: 0, shipping_method_name: "Envío a domicilio",
    };
  });
  return { planes, faltan, sinPrecio: elegidos.filter(p => !(base(p) > 0)).map(p => p.handle) };
}

// Resumen humano para el Admin antes de aplicar.
export function resumenReceta(receta, productos = []) {
  const { planes, faltan } = planesDeReceta(receta, productos);
  const packs = receta.packs.map(k => `x${k.qty}${k.badge ? ` (${k.badge})` : ""}`).join(" · ");
  const freq = receta.frequency_options.length ? `el cliente elige: ${receta.frequency_options.map(d => `cada ${d} días`).join(" / ")}` : `cada ${receta.frequency_days} días`;
  return [
    `${planes.length} plan${planes.length === 1 ? "" : "es"} (${planes.map(p => p.product_title.split("|")[0].trim()).join(", ") || "—"})`,
    `Packs ${packs} · ${receta.discount_pct}% en cada envío · ${freq}`,
    receta.mix ? "Armá tu pack: cada plan mezcla con los otros productos" : "Sin mezcla de productos",
    `Widget ${receta.widget.color || "color actual"} · arranca en ${receta.widget.mode_default === "once" ? "Compra única" : "Suscripción"} · carrito ${receta.widget.cart_drawer ? "prendido" : "apagado"}`,
    receta.comunicacion ? (receta.comunicacion.reply_to
      ? `Mails desde "${receta.comunicacion.brand || "la tienda"}", responder a ${receta.comunicacion.reply_to} · flujos: ${receta.comunicacion.flujos.join(", ") || "ninguno"}${receta.comunicacion.whatsapp ? ` · WhatsApp: ${receta.comunicacion.wa_templates.join(", ") || "sin plantillas"}` : " · sin WhatsApp"}`
      : "Sin mail de atención: los flujos de mail quedan creados pero APAGADOS (no pueden salir sin a quién responder)") : null,
    faltan.length ? `No encontré en la tienda: ${faltan.join(", ")}` : null,
  ].filter(Boolean);
}
