// Tema del checkout hosteado (#/checkout), configurable por tienda (Thiago, 24-sept-2026:
// "quiero que cada persona pueda cambiar su checkout"). Fuente única para api/ (sanea y
// resuelve lo que se manda al comprador) y src/ (el diseñador del panel y el propio checkout).
//
// Guardado en merchants/{uid}.checkout_theme SOLO con lo que el comerciante tocó (parcial);
// `resolveCheckoutTheme` completa los defaults. Si nadie lo personalizó, el acento es el
// color del widget (`widget_color`), así el checkout ya sale del color de la tienda.

export const CHECKOUT_FONTS = {
  system: { label: "Sistema", stack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif", google: null },
  inter:  { label: "Inter",   stack: "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", google: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  serif:  { label: "Serif",   stack: "'Source Serif 4',Georgia,'Times New Roman',serif", google: "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;500;600;700&display=swap" },
};
export const CHECKOUT_FONT_IDS = Object.keys(CHECKOUT_FONTS);

export const CHECKOUT_THEME_DEFAULTS = Object.freeze({
  color: "#10b981",        // acento: botón de pago, radios, foco, links. Default = widget_color.
  bg: "#ffffff",           // fondo del formulario
  summary_bg: "#f5f5f5",   // fondo del resumen (columna derecha / acordeón en celular)
  text: "#1a1a1a",         // color del texto
  font: "system",          // system | inter | serif
  radius: 6,               // radio de campos y botones (0–24)
  header_text: "",         // "" → nombre de la tienda
  header_logo: "",         // logo arriba de todo en lugar del texto (data:image PNG/WebP/JPEG ≤ ~150 KB, o https). PNG transparente ok.
  footer_text: "",         // "" → "Se cobra $X ahora y se renueva…"
  cta_text: "",            // "" → "Suscribirme y pagar {{total}}"
  show_logo: true,         // foto de la tienda (store_photo) arriba
  show_discount: true,     // caja "Código de descuento"
  show_trust: true,        // renglón "Pago seguro · pausá o cancelá cuando quieras"
  show_policies: false,    // links a términos y privacidad debajo del botón
  policies_text: "",       // "" → "Al pagar aceptás los términos y la política de privacidad."
  terms_url: "",
  privacy_url: "",
  summary_mobile: "top",   // top (acordeón arriba) | before_pay (desplegado antes del botón)
});

const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_OK = /^https?:\/\/[^\s<>"']{3,300}$/i;
const LIMITS = { header_text: 80, footer_text: 300, cta_text: 60, policies_text: 200 };

// Sanea lo que viene del panel: solo claves conocidas, tipos y topes. Devuelve el objeto
// PARCIAL para guardar (sin defaults) o { error }. `{}` = borrar la personalización.
export function sanitizeCheckoutTheme(input) {
  if (input == null) return { theme: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "checkout_theme debe ser un objeto" };
  const out = {};
  for (const k of ["color", "bg", "summary_bg", "text"]) {
    if (!(k in input)) continue;
    const v = String(input[k] ?? "").trim();
    if (v === "") continue;
    if (!HEX.test(v)) return { error: `${k}: color inválido (usá #RRGGBB)` };
    out[k] = v.toLowerCase();
  }
  if ("font" in input) {
    const v = String(input.font || "").trim();
    if (v && !CHECKOUT_FONT_IDS.includes(v)) return { error: "font: usá system, inter o serif" };
    if (v) out.font = v;
  }
  if ("radius" in input && input.radius !== "" && input.radius != null) {
    const n = Math.round(Number(input.radius));
    if (!Number.isFinite(n)) return { error: "radius debe ser un número" };
    out.radius = Math.max(0, Math.min(24, n));
  }
  for (const k of Object.keys(LIMITS)) {
    if (!(k in input)) continue;
    const v = String(input[k] ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS[k]);
    if (v) out[k] = v;
  }
  for (const k of ["show_logo", "show_discount", "show_trust", "show_policies"]) {
    if (k in input && typeof input[k] === "boolean") out[k] = input[k];
  }
  for (const k of ["terms_url", "privacy_url"]) {
    if (!(k in input)) continue;
    const v = String(input[k] ?? "").trim();
    if (v === "") continue;
    if (!URL_OK.test(v)) return { error: `${k}: tiene que ser un link http(s) válido` };
    out[k] = v;
  }
  if ("header_logo" in input) {
    const v = String(input.header_logo ?? "").trim();
    if (v) {
      const okData = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 200000;
      if (!okData && !URL_OK.test(v)) return { error: "header_logo: subí un PNG, WebP o JPEG de hasta 150 KB" };
      out.header_logo = v;
    }
  }
  if ("summary_mobile" in input) {
    const v = String(input.summary_mobile || "");
    if (v && !["top", "before_pay"].includes(v)) return { error: "summary_mobile: top o before_pay" };
    if (v) out.summary_mobile = v;
  }
  return { theme: out };
}

// Tema completo para el comprador: defaults + lo guardado, con el color del widget como
// acento cuando no se eligió otro. `extra` puede traer `preview` (del diseñador) que pisa todo.
export function resolveCheckoutTheme(saved, { widgetColor, preview } = {}) {
  const base = { ...CHECKOUT_THEME_DEFAULTS };
  if (HEX.test(String(widgetColor || ""))) base.color = String(widgetColor).toLowerCase();
  const s = (saved && typeof saved === "object") ? saved : {};
  const p = (preview && typeof preview === "object") ? (sanitizeCheckoutTheme(preview).theme || {}) : {};
  const t = { ...base, ...pick(s), ...p };
  return { ...t, ...derivedColors(t) };
}
function pick(o) { const out = {}; for (const k of Object.keys(CHECKOUT_THEME_DEFAULTS)) if (o[k] !== undefined && o[k] !== null && o[k] !== "") out[k] = o[k]; return out; }

// ── Colores derivados (sin dependencias) ──
export function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return [16, 185, 129];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
export function shadeHex(hex, pct) {
  // pct −100..100: negativo oscurece, positivo aclara (mezcla con negro/blanco).
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255, k = Math.abs(pct) / 100;
  return "#" + toHex(r + (t - r) * k) + toHex(g + (t - g) * k) + toHex(b + (t - b) * k);
}
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function onColor(hex) { return luminance(hex) > 0.45 ? "#111111" : "#ffffff"; }
export function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }

function derivedColors(t) {
  const dark = luminance(t.bg) < 0.4;
  return {
    color_on: onColor(t.color),                 // texto del botón
    color_dark: shadeHex(t.color, -25),         // gradiente del loader / hover
    color_light: shadeHex(t.color, 65),         // gradiente claro del loader
    color_tint: rgba(t.color, dark ? 0.22 : 0.10),
    text_muted: dark ? rgba(t.text, 0.62) : "#6b6b6b",
    border: dark ? rgba(t.text, 0.22) : "#dedede",
    border_soft: dark ? rgba(t.text, 0.12) : "#e9e9e9",
    input_bg: dark ? rgba(t.text, 0.06) : "#ffffff",
    font_stack: (CHECKOUT_FONTS[t.font] || CHECKOUT_FONTS.system).stack,
    font_url: (CHECKOUT_FONTS[t.font] || CHECKOUT_FONTS.system).google,
    dark,
  };
}

export function ctaText(theme, totalTxt) {
  const raw = theme?.cta_text || "Pagar suscripción · {{total}}";
  return raw.includes("{{total}}") ? raw.replace(/\{\{\s*total\s*\}\}/g, totalTxt) : `${raw} ${totalTxt}`;
}
