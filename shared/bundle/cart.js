// Carrito propio de la suscripción (drawer del widget) — fuente única para el widget
// (api/widget.js inyecta estas funciones tal cual en el JS del cliente) y el panel
// (Catálogo → Carrito: editor con vista previa). 25-sept-2026, Thiago: "el editor de
// absolutamente todo lo que sale en el carrito, para todas las marcas".
//
// REGLAS para las funciones render*/cartCss: viajan al navegador de la tienda con
// Function.prototype.toString → sin imports, sin closures del módulo, sin sintaxis
// moderna rara (ES2017 ok), sin backticks ni "${" (van dentro de un template literal).

export const CART_TEXT_DEFAULTS = Object.freeze({
  title: "Tu suscripción",
  item_sub: "{{qty}} · te llega {{freq}}",          // {{qty}} = "3 unidades", {{freq}} = "cada mes"
  gift_once: "Solo en tu primer envío",
  gift_always: "",                                  // vacío = sin aclaración
  row_subtotal: "Subtotal",
  row_save: "Ahorrás en cada envío",
  row_ship: "Envío",
  ship_value: "Se calcula en el siguiente paso",
  row_total: "Total por envío",
  note: "Se renueva solo {{freq}}. Pausás, cambiás la dirección o cancelás cuando quieras desde tu portal. Pago seguro con Mercado Pago.",
  cta: "Finalizar suscripción · {{total}}",
  more: "Seguir viendo",
  footer: "🔒 Pago 100% seguro con Mercado Pago",
});
export const CART_TOGGLE_DEFAULTS = Object.freeze({
  show_gifts: true, show_compare: true, show_save: true, show_ship: true, show_note: true, show_footer: true,
  use_checkout_theme: true, // colores del checkout de la tienda; false = los de abajo
});
export const CART_COLOR_DEFAULTS = Object.freeze({ color: "", bg: "", text: "" });
const HEX = /^#[0-9a-fA-F]{6}$/;
const LIMITS = { title: 40, item_sub: 80, gift_once: 60, gift_always: 60, row_subtotal: 30, row_save: 40, row_ship: 30, ship_value: 60, row_total: 30, note: 300, cta: 60, more: 30, footer: 80 };

// Sanea lo que manda el panel: solo claves conocidas y topes. Parcial (lo que se tocó).
// "x" sola en un texto = apagarlo (misma convención que el widget).
export function sanitizeCartSettings(input) {
  if (input == null) return { settings: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "cart_settings debe ser un objeto" };
  const out = {};
  const texts = {};
  const t = input.texts && typeof input.texts === "object" ? input.texts : {};
  for (const k of Object.keys(LIMITS)) {
    if (!(k in t)) continue;
    const v = String(t[k] ?? "").replace(/\s+/g, " ").trim().slice(0, LIMITS[k]);
    if (v !== "") texts[k] = v;
  }
  if (Object.keys(texts).length) out.texts = texts;
  for (const k of Object.keys(CART_TOGGLE_DEFAULTS)) if (k in input && typeof input[k] === "boolean") out[k] = input[k];
  for (const k of Object.keys(CART_COLOR_DEFAULTS)) {
    if (!(k in input)) continue;
    const v = String(input[k] ?? "").trim();
    if (v === "") continue;
    if (!HEX.test(v)) return { error: `${k}: color inválido (usá #RRGGBB)` };
    out[k] = v.toLowerCase();
  }
  return { settings: out };
}

// Defaults + lo guardado. `checkoutTheme` = tema resuelto del checkout (colores base).
export function resolveCartSettings(saved, checkoutTheme) {
  const s = saved && typeof saved === "object" ? saved : {};
  const texts = { ...CART_TEXT_DEFAULTS, ...(s.texts && typeof s.texts === "object" ? s.texts : {}) };
  const toggles = {};
  for (const k of Object.keys(CART_TOGGLE_DEFAULTS)) toggles[k] = typeof s[k] === "boolean" ? s[k] : CART_TOGGLE_DEFAULTS[k];
  const ct = checkoutTheme || {};
  let theme = pickCartTheme(ct);
  if (!toggles.use_checkout_theme) {
    if (HEX.test(String(s.color || ""))) { theme.color = s.color; theme.on = onColorHex(s.color); theme.tint = rgbaHex(s.color, 0.10); }
    if (HEX.test(String(s.bg || ""))) { theme.bg = s.bg; const dark = lumHex(s.bg) < 0.4; theme.dark = dark; theme.soft = dark ? "rgba(255,255,255,0.12)" : "#e9e9e9"; theme.muted = dark ? "rgba(255,255,255,0.62)" : "#6b6b6b"; }
    if (HEX.test(String(s.text || ""))) { theme.text = s.text; if (theme.dark) theme.muted = rgbaHex(s.text, 0.62); }
  }
  return { texts, toggles, theme };
}
export function pickCartTheme(t) {
  return {
    color: t.color || "#10b981", on: t.color_on || "#ffffff", tint: t.color_tint || "rgba(16,185,129,0.10)",
    bg: t.bg || "#ffffff", text: t.text || "#161616", muted: t.text_muted || "#6b6b6b",
    border: t.border || "#dedede", soft: t.border_soft || "#e9e9e9", input: t.input_bg || "#ffffff",
    radius: Math.max(6, Math.min(20, Number(t.radius) || 6)),
    font: t.font_stack || "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", dark: !!t.dark,
  };
}
function hexRgb(h) { h = String(h).replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function lumHex(h) { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function onColorHex(h) { return lumHex(h) > 0.62 ? "#111111" : "#ffffff"; }
function rgbaHex(h, a) { const [r, g, b] = hexRgb(h); return "rgba(" + r + "," + g + "," + b + "," + a + ")"; }

// ─── Lo que viaja al navegador (se inyecta con .toString()) ───────────
export function cartCss(T) {
  var A = T.color, ON = T.on, BG = T.bg, TX = T.text, MU = T.muted, BD = T.soft, TINT = T.tint, RAD = T.radius + "px", FONT = T.font;
  return ".rc-cart-ov{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(17,17,17,.5);z-index:2147483000;display:none;opacity:0;transition:opacity .22s;font-family:" + FONT + ";color:" + TX + ";-webkit-font-smoothing:antialiased}" +
    ".rc-cart-ov.is-open{display:block}.rc-cart-ov.is-vis{opacity:1}" +
    ".rc-cart{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);background:" + BG + ";display:flex;flex-direction:column;transform:translateX(100%);transition:transform .3s cubic-bezier(.22,1,.36,1);box-shadow:-16px 0 50px -20px rgba(0,0,0,.4)}" +
    ".rc-cart *{box-sizing:border-box}.rc-cart-ov.is-vis .rc-cart{transform:translateX(0)}" +
    ".rc-cart-h{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid " + BD + ";font-size:17px;font-weight:800}" +
    ".rc-cart-x{width:32px;height:32px;border-radius:50%;border:1px solid " + BD + ";background:transparent;font-size:20px;line-height:1;color:" + MU + ";cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}" +
    ".rc-cart-b{flex:1;overflow-y:auto;padding:16px 18px}" +
    ".rc-cart-it{display:grid;grid-template-columns:68px minmax(0,1fr);gap:12px;align-items:center}" +
    ".rc-cart-it img{width:68px;height:68px;border-radius:" + RAD + ";object-fit:cover;border:1px solid " + BD + ";background:#fff}" +
    ".rc-cart-ph{width:68px;height:68px;border-radius:" + RAD + ";background:" + TINT + ";display:flex;align-items:center;justify-content:center;font-size:24px}" +
    ".rc-cart-it b{display:block;font-size:15px;font-weight:800;line-height:1.2}.rc-cart-it small{display:block;font-size:12.5px;color:" + MU + ";font-weight:600;margin-top:3px}" +
    ".rc-cart-pr{margin-top:5px;font-size:15px;font-weight:800}.rc-cart-pr s{color:" + MU + ";opacity:.8;font-weight:600;font-size:12.5px;margin-left:6px}" +
    ".rc-cart-g{display:flex;align-items:center;gap:9px;margin-top:10px;padding:8px 10px;border-radius:" + RAD + ";background:" + TINT + ";font-size:12.5px;font-weight:600}" +
    ".rc-cart-g img{width:32px;height:32px;border-radius:6px;object-fit:cover;flex:none;background:#fff}.rc-cart-g em{font-style:normal;color:" + MU + ";display:block;font-size:11.5px;font-weight:600}" +
    ".rc-cart-rows{margin-top:14px;border-top:1px solid " + BD + ";padding-top:10px}" +
    ".rc-cart-row{display:flex;justify-content:space-between;gap:10px;font-size:13.5px;color:" + MU + ";font-weight:600;padding:4px 0}" +
    ".rc-cart-row.is-tot{font-size:16.5px;font-weight:800;color:" + TX + ";margin-top:4px}.rc-cart-row .ok{color:" + A + ";font-weight:800}" +
    ".rc-cart-note{margin-top:12px;font-size:12px;color:" + MU + ";line-height:1.4}" +
    ".rc-cart-f{padding:12px 18px 16px;border-top:1px solid " + BD + ";background:" + BG + "}" +
    ".rc-cart-go{width:100%;background:" + A + ";color:" + ON + ";border:none;border-radius:" + RAD + ";padding:15px 12px;font-family:inherit;font-size:15.5px;font-weight:800;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent}" +
    ".rc-cart-go:active{filter:brightness(.92)}.rc-cart-go:disabled{opacity:.7;cursor:default}" +
    ".rc-cart-more{display:block;width:100%;margin-top:8px;background:none;border:none;color:" + MU + ";font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;text-decoration:underline;text-underline-offset:3px}" +
    ".rc-cart-safe{text-align:center;font-size:11.5px;color:" + MU + ";font-weight:600;margin-top:8px}" +
    "@media (max-width:520px){.rc-cart{width:min(420px,92%)}}";
}

// Esqueleto del drawer (título, cuerpo vacío, pie). El cuerpo lo llena cartBodyHtml.
export function cartShellHtml(TXT, esc) {
  return '<div class="rc-cart" role="dialog" aria-label="' + esc(TXT.title) + '">' +
    '<div class="rc-cart-h"><span>' + esc(TXT.title) + '</span><button type="button" class="rc-cart-x" aria-label="Cerrar">×</button></div>' +
    '<div class="rc-cart-b"></div>' +
    '<div class="rc-cart-f"><button type="button" class="rc-cart-go"></button><button type="button" class="rc-cart-more">' + esc(TXT.more) + "</button>" +
    (TXT.footer && TXT.show_footer !== false ? '<div class="rc-cart-safe">' + esc(TXT.footer) + "</div>" : "") + "</div>" +
  "</div>";
}

// Cuerpo del carrito para un pack. p = pack del payload del bundle
// { label, qty, sub_qty, price_sub, price_once, compare_at, freq_label, image, gifts[] }.
// TXT = textos + toggles (show_*); fmt = formateador de $; esc = escape HTML; fallbackImg = og:image.
export function cartBodyHtml(p, TXT, fmt, esc, fallbackImg) {
  var price = Number(p.price_sub) || 0, cmp = Number(p.compare_at) || 0;
  var save = cmp > price ? cmp - price : (Number(p.price_once) > price ? Number(p.price_once) - price : 0);
  var qty = p.sub_qty || p.qty || 1;
  var qtyTxt = qty + (qty === 1 ? " unidad" : " unidades");
  var freq = p.freq_label ? "cada " + p.freq_label : "";
  var img = p.image || fallbackImg || "";
  var sub = String(TXT.item_sub || "").replace(/\{\{qty\}\}/g, qtyTxt).replace(/\{\{freq\}\}/g, freq).replace(/\s*·\s*$/, "").trim();
  var gifts = "";
  if (TXT.show_gifts !== false) {
    gifts = (p.gifts || []).filter(function (g) { return g && g.title; }).map(function (g) {
      var extra = g.every === "once" ? TXT.gift_once : TXT.gift_always;
      return '<div class="rc-cart-g">' + (g.image ? '<img src="' + esc(g.image) + '" alt="">' : "") + "<span>" + esc(g.title) + (extra ? "<em>" + esc(extra) + "</em>" : "") + "</span></div>";
    }).join("");
  }
  var rows = '<div class="rc-cart-row"><span>' + esc(TXT.row_subtotal) + "</span><span>" + esc(fmt(price)) + "</span></div>";
  if (TXT.show_save !== false && save > 0) rows += '<div class="rc-cart-row"><span>' + esc(TXT.row_save) + '</span><span class="ok">' + esc(fmt(save)) + "</span></div>";
  if (TXT.show_ship !== false) rows += '<div class="rc-cart-row"><span>' + esc(TXT.row_ship) + "</span><span>" + esc(TXT.ship_value) + "</span></div>";
  rows += '<div class="rc-cart-row is-tot"><span>' + esc(TXT.row_total) + "</span><span>" + esc(fmt(price)) + "</span></div>";
  var note = "";
  if (TXT.show_note !== false && TXT.note) note = '<div class="rc-cart-note">' + esc(String(TXT.note).replace(/\{\{freq\}\}/g, freq).replace(/\s+\./g, ".")) + "</div>";
  return '<div class="rc-cart-it">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="rc-cart-ph">📦</div>') +
      "<div><b>" + esc(p.label || qtyTxt) + "</b>" + (sub ? "<small>" + esc(sub) + "</small>" : "") +
      '<div class="rc-cart-pr">' + esc(fmt(price)) + (TXT.show_compare !== false && cmp > price ? "<s>" + esc(fmt(cmp)) + "</s>" : "") + "</div></div></div>" +
    gifts + '<div class="rc-cart-rows">' + rows + "</div>" + note;
}
export function cartCtaText(TXT, totalTxt) {
  var raw = TXT.cta || "Finalizar suscripción · {{total}}";
  return raw.indexOf("{{total}}") >= 0 ? raw.replace(/\{\{total\}\}/g, totalTxt) : raw + " " + totalTxt;
}
