// shared/bundle/templates.js
//
// 10 diseños del selector de packs. `renderBundle(vm, state)` devuelve
// { html, css }: strings puros, sin JS embebido. El host (widget.js) inyecta
// el CSS una vez y swapea el HTML por innerHTML en cada click, delegando por
// `data-rc-action` ("mode" | "pack" | "cta") + `data-rc-value`.
//
// Reglas:
//  - CSS scopeado en `.rc-bundle[data-variant="vXX"]`; !important sólo para
//    resetear temas agresivos (box-sizing, margin de botones).
//  - Tipografía heredada del tema (font-family: inherit). Colores derivados
//    del acento con tintes calculados acá (mix con blanco/negro + alpha).
//  - Todo dato (labels, badges, textos) pasa por esc().
//  - Semántica: role="radiogroup" / role="radio" + aria-checked.
//  - Corre igual en Node y navegador (sin process/require).

import { fmtARS } from "./viewmodel.js";

export const BUNDLE_VARIANTS = [
  { id: "v01", name: "Clásico",          description: "Cards apiladas estilo Lumina, ribbon en el pack recomendado y caja de suscripción punteada." },
  { id: "v02", name: "Lista",            description: "Filas tipo radio con el precio a la derecha y pestañas Compra única / Suscripción arriba. El formato más usado por suplementos de USA." },
  { id: "v03", name: "Compacto",         description: "Pills de cantidad, precio grande abajo y switch de suscripción. Ocupa poco alto." },
  { id: "v04", name: "Tabla",            description: "Comparativa por pack: una columna Una vez y otra Suscripción. Se elige tocando la celda." },
  { id: "v05", name: "Tarjetas grandes", description: "Una card por pack, una debajo de otra, con etiqueta de ahorro lateral y segmentado de modo arriba." },
  { id: "v06", name: "Minimal",          description: "Líneas finas, sin fondos, tipografía protagonista. Para tiendas con estética limpia." },
  { id: "v07", name: "Segmentado",       description: "Control segmentado de packs y una card de precio con chips de modo." },
  { id: "v08", name: "Oscuro premium",   description: "Fondo oscuro, acento brillante y CTA con degradado. Para marcas premium." },
  { id: "v09", name: "Pastel",           description: "Fondos suaves, esquinas bien redondeadas y tiles de pack en grilla." },
  { id: "v10", name: "Editorial",        description: "Dos columnas: packs a la izquierda y resumen del pedido sticky a la derecha. En mobile se apila." },
];

// ─── utils ───────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

// Paleta derivada del acento. Se expone como variables CSS en el root del
// widget, así el preview puede pisarlas sin regenerar todo el CSS.
// AUTOCONTENIDA a propósito (helpers adentro): el preview la inyecta con
// `.toString()` para recalcular la paleta en vivo en el navegador.
export function paletteVars(accent) {
  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = "10b981";
    var n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbStr(rgb) { return "rgb(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + ")"; }
  // mezcla `t` (0..1) de `to` sobre `rgb`
  function mix(rgb, to, t) {
    return [0, 1, 2].map(function (i) { return Math.round(rgb[i] + (to[i] - rgb[i]) * t); });
  }
  function luminance(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  var a = hexToRgb(accent);
  var W = [255, 255, 255], K = [0, 0, 0];
  var onA = luminance(a) > 0.45 ? "#111111" : "#ffffff";
  var alpha = function (t) { return "rgba(" + a[0] + "," + a[1] + "," + a[2] + "," + t + ")"; };
  return {
    "--rc-a": rgbStr(a),
    "--rc-a-h": rgbStr(mix(a, K, 0.12)),      // hover
    "--rc-a-d": rgbStr(mix(a, K, 0.28)),      // degradado / oscuro
    "--rc-a-t": rgbStr(mix(a, K, 0.55)),      // texto sobre fondo claro
    "--rc-a-b": rgbStr(mix(a, W, 0.18)),      // brillante (sobre fondo oscuro)
    "--rc-a-l1": rgbStr(mix(a, W, 0.93)),     // fondo muy claro
    "--rc-a-l2": rgbStr(mix(a, W, 0.84)),     // fondo claro
    "--rc-a-l3": rgbStr(mix(a, W, 0.70)),     // borde claro sólido
    "--rc-a-25": alpha(0.25),
    "--rc-a-40": alpha(0.4),
    "--rc-a-12": alpha(0.12),
    "--rc-on-a": onA,
  };
}
function varsCss(vars) {
  return Object.keys(vars).map(function (k) { return k + ":" + vars[k]; }).join(";");
}

var SVG_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
var SVG_LOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
var SVG_REPEAT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

// ─── contexto compartido por variante ────────────────────────────────
function buildCtx(vm, state) {
  var packs = Array.isArray(vm.packs) ? vm.packs : [];
  var mode = state && state.mode === "once" ? "once" : "sub";
  var idx = state && Number.isInteger(state.selectedIdx) ? state.selectedIdx : (vm.defaultIdx || 0);
  if (idx < 0 || idx >= packs.length) idx = 0;
  var t = vm.texts || {};
  var sel = packs[idx] || null;
  var view = sel ? sel[mode] : { price: 0, compare: 0, savingsArs: 0, savingsPct: 0, perUnit: 0 };
  var S = '.rc-bundle[data-variant="' + vm.variant + '"]';
  var modes = vm.modeOrder === "once_first" ? ["once", "sub"] : ["sub", "once"];
  var ctx = {
    vm: vm, t: t, packs: packs, mode: mode, idx: idx, sel: sel, view: view, S: S, modes: modes,
    disc: vm.discountPct || 0,
    showCompare: vm.showCompare !== false,
    showPerUnit: vm.showPerUnit !== false,
  };
  ctx.v = function (p, m) { return p[m || mode]; };
  ctx.savings = function (p, m) {
    var vv = ctx.v(p, m); if (!vv.savingsPct) return "";
    return String(t.savings_label || "Ahorrás {pct}%").replace("{pct}", String(vv.savingsPct));
  };
  ctx.perUnit = function (p, m) {
    if (!ctx.showPerUnit) return "";
    var vv = ctx.v(p, m);
    return String(t.per_unit_label || "{price} c/u").replace("{price}", fmtARS(vv.perUnit));
  };
  ctx.compareHtml = function (p, m, cls) {
    var vv = ctx.v(p, m);
    if (!ctx.showCompare || !vv.compare) return "";
    return '<s class="' + (cls || "rc-old") + '">' + esc(fmtARS(vv.compare)) + "</s>";
  };
  ctx.modeLabel = function (m, withDisc) {
    var base = m === "sub" ? (t.sub_label || "Suscripción") : (t.once_label || "Compra única");
    if (m === "sub" && withDisc && ctx.disc > 0) return esc(base) + ' <em class="rc-disc">−' + ctx.disc + "%</em>";
    return esc(base);
  };
  ctx.freqText = function (p) {
    p = p || sel;
    if (mode !== "sub") return "Compra por única vez · sin renovación automática";
    var fl = p && p.freqLabel ? p.freqLabel : "";
    return (t.freq_prefix || "Te llega cada") + (fl ? " " + fl : "") + " · pausás o cancelás cuando quieras";
  };
  ctx.ctaText = function () {
    var lbl = mode === "sub" ? (t.cta_sub || "Suscribirme") : (t.cta_once || "Agregar al carrito");
    return esc(lbl) + ' <span class="rc-cta-price">· ' + esc(fmtARS(view.price)) + "</span>";
  };
  ctx.radioAttrs = function (i) {
    var on = i === idx;
    return ' role="radio" aria-checked="' + (on ? "true" : "false") + '" tabindex="' + (on ? "0" : "-1") + '" data-rc-action="pack" data-rc-value="' + i + '"';
  };
  ctx.modeAttrs = function (m) {
    var on = m === mode;
    return ' type="button" role="radio" aria-checked="' + (on ? "true" : "false") + '" data-rc-action="mode" data-rc-value="' + m + '"';
  };
  ctx.on = function (cond, cls) { return cond ? " " + (cls || "is-on") : ""; };
  ctx.trust = function (cls) {
    // Las líneas de confianza ("Cancelás cuando quieras", "Envío a todo el país")
    // hablan de la suscripción: en compra única no aplican y confunden. Ahí queda
    // solo el candado de pago seguro.
    var lines = mode === "sub" && Array.isArray(t.trust_lines) ? t.trust_lines : [];
    var items = lines.map(function (l) { return '<li><span class="rc-tick">' + SVG_CHECK + "</span>" + esc(l) + "</li>"; }).join("");
    items += '<li><span class="rc-tick">' + SVG_LOCK + "</span>Pago seguro con Mercado Pago</li>";
    return '<ul class="' + (cls || "rc-trust") + '">' + items + "</ul>";
  };
  ctx.cta = function (cls) {
    return '<button type="button" class="' + (cls || "rc-cta") + '" data-rc-action="cta" data-rc-mode="' + mode + '">' + ctx.ctaText() + "</button>";
  };
  ctx.freqLine = function (cls) {
    return '<p class="' + (cls || "rc-freq") + '"><span class="rc-freq-ic">' + SVG_REPEAT + "</span>" + esc(ctx.freqText()) + "</p>";
  };
  ctx.wrap = function (inner, extraAttrs) {
    return '<div class="rc-bundle" data-variant="' + esc(vm.variant) + '" data-mode="' + mode + '" data-selected="' + idx + '"' + (extraAttrs || "") + ">" + inner + "</div>";
  };
  return ctx;
}

// CSS común a todas las variantes (reset + variables). `${S}` es el scope.
function baseCss(S, vm) {
  var vars = varsCss(paletteVars(vm.accent)) + ";--rc-r:" + (Number.isFinite(vm.radius) ? vm.radius : 14) + "px";
  return (
    S + "{" + vars + ";font-family:inherit;color:#161616;line-height:1.35;margin:14px 0;text-align:left;position:relative;container-type:inline-size;-webkit-font-smoothing:antialiased}" +
    S + "," + S + " *," + S + " *::before," + S + " *::after{box-sizing:border-box !important}" +
    S + " button{font-family:inherit;margin:0 !important;-webkit-appearance:none;appearance:none;line-height:inherit;letter-spacing:inherit;text-transform:none;font-size:inherit;color:inherit;background:none;border:0;padding:0;min-height:0;min-width:0;width:auto;box-shadow:none}" +
    S + " [data-rc-action]{cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none}" +
    S + " [data-rc-action]:focus{outline:none}" +
    S + " [data-rc-action]:focus-visible{outline:2px solid var(--rc-a);outline-offset:2px}" +
    S + " p," + S + " ul," + S + " h3{margin:0;padding:0;list-style:none;font-weight:inherit}" +
    S + " s{text-decoration:line-through}" +
    S + " em{font-style:normal}" +
    S + " .rc-tick svg{display:inline-block;vertical-align:middle}" +
    S + " .rc-cta{display:block;width:100%;padding:15px 16px;font-size:16px;font-weight:800;letter-spacing:.2px;color:var(--rc-on-a);background:var(--rc-a);border-radius:var(--rc-r);text-align:center;transition:background .18s,transform .12s,box-shadow .18s;box-shadow:0 6px 18px var(--rc-a-25)}" +
    S + " .rc-cta:hover{background:var(--rc-a-h)}" +
    S + " .rc-cta:active{transform:scale(.985)}" +
    S + " .rc-cta[disabled]{opacity:.7;cursor:wait}" +
    S + " .rc-cta-price{font-weight:600;opacity:.92}" +
    S + " .rc-freq{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;color:#4b4b4b;line-height:1.4}" +
    S + " .rc-freq-ic{color:var(--rc-a);flex-shrink:0;margin-top:2px;display:inline-flex}" +
    S + " .rc-trust{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#5a5a5a;margin-top:12px}" +
    S + " .rc-trust li{display:inline-flex;align-items:center;gap:5px}" +
    S + " .rc-trust .rc-tick{color:var(--rc-a);display:inline-flex}" +
    S + " .rc-disc{font-weight:800;color:var(--rc-a-t)}" +
    S + " .rc-err{display:none;margin-top:10px;padding:9px 12px;border-radius:calc(var(--rc-r) * .6);background:#fdecec;color:#a11d1d;font-size:12.5px;font-weight:600}" +
    S + " .rc-err.is-on{display:block}" +
    "@container (max-width:359px){" + S + " .rc-cta{font-size:14.5px;padding:14px 10px}" + S + " .rc-trust{font-size:11.5px;gap:5px 10px}" + "}"
  );
}

// ═════════════════════════════════════════════════════════════════════
// v01 — Clásico (estilo Lumina)
// ═════════════════════════════════════════════════════════════════════
function v01(c) {
  var S = c.S, t = c.t;
  var packs = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    return '<div class="rc-pack' + c.on(on) + c.on(!!p.badge, "has-badge") + '"' + c.radioAttrs(i) + ">" +
      (p.badge ? '<span class="rc-ribbon">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-radio" aria-hidden="true"><i></i></span>' +
      '<span class="rc-qty" aria-hidden="true">×' + p.qty + "</span>" +
      '<span class="rc-info"><b class="rc-name">' + esc(p.label) + "</b>" +
        '<small class="rc-meta">' + esc([p.qty === 1 ? "1 unidad" : p.qty + " unidades", c.perUnit(p)].filter(Boolean).join(" · ")) + "</small>" +
        (c.savings(p) ? '<span class="rc-save">' + esc(c.savings(p)) + "</span>" : "") +
      "</span>" +
      '<span class="rc-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</span>" +
      "</div>";
  }).join("");

  var modes = c.modes.map(function (m) {
    var on = m === c.mode;
    var price = c.sel ? fmtARS(c.sel[m].price) : "";
    var sub = m === "sub"
      ? (t.freq_prefix || "Te llega cada") + " " + (c.sel ? c.sel.freqLabel : "") + " · pausás o cancelás cuando quieras"
      : "Sin renovación automática";
    return '<button class="rc-mode' + c.on(on) + '"' + c.modeAttrs(m) + ">" +
      '<span class="rc-check" aria-hidden="true">' + SVG_CHECK + "</span>" +
      "<span class=\"rc-mode-txt\"><b>" + c.modeLabel(m, true) + "</b><small>" + esc(sub) + "</small></span>" +
      '<b class="rc-mode-price">' + esc(price) + "</b></button>";
  }).join("");

  var html = c.wrap(
    '<div class="rc-head"><h3>' + esc(t.headline) + "</h3></div>" +
    '<div class="rc-packs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + packs + "</div>" +
    '<div class="rc-modes" role="radiogroup" aria-label="Modo de compra">' + modes + "</div>" +
    c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );

  var css =
    S + " .rc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}" +
    S + " .rc-head::before," + S + " .rc-head::after{content:'';flex:1;height:1px;background:#e4e4e4}" +
    S + " .rc-head h3{font-size:12.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}" +
    S + " .rc-pack{position:relative;display:grid;grid-template-columns:24px 44px minmax(0,1fr) auto;align-items:center;gap:0 10px;padding:14px;margin-bottom:12px;background:#fff;border:1.5px solid #e3e3e3;border-radius:var(--rc-r);transition:border-color .2s,background .2s,box-shadow .2s,transform .15s}" +
    S + " .rc-pack.has-badge{margin-top:18px}" +
    S + " .rc-pack:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-pack.is-on{border:2px solid var(--rc-a);background:var(--rc-a-l1);box-shadow:0 6px 22px var(--rc-a-25);transform:translateY(-1px);padding:13.5px}" +
    S + " .rc-ribbon{position:absolute;top:0;right:14px;transform:translateY(-50%);background:linear-gradient(110deg,var(--rc-a) 40%,var(--rc-a-b) 50%,var(--rc-a) 60%);background-size:200% 100%;animation:rc01-shine 3.2s linear infinite;color:var(--rc-on-a);font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:4px 11px;border-radius:6px;box-shadow:0 2px 8px var(--rc-a-40);white-space:nowrap;max-width:70%;overflow:hidden;text-overflow:ellipsis}" +
    "@keyframes rc01-shine{0%{background-position:200% 0}100%{background-position:-200% 0}}" +
    S + " .rc-radio{width:22px;height:22px;border:2px solid #cfcfcf;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:border-color .2s;background:#fff}" +
    S + " .rc-radio i{width:0;height:0;background:var(--rc-a);border-radius:50%;transition:width .22s cubic-bezier(.5,1.8,.6,1),height .22s cubic-bezier(.5,1.8,.6,1)}" +
    S + " .rc-pack.is-on .rc-radio{border-color:var(--rc-a)}" +
    S + " .rc-pack.is-on .rc-radio i{width:11px;height:11px}" +
    S + " .rc-qty{width:44px;height:44px;border-radius:calc(var(--rc-r) * .7);background:var(--rc-a-l2);color:var(--rc-a-t);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:17px;letter-spacing:-.3px}" +
    S + " .rc-pack.is-on .rc-qty{background:var(--rc-a);color:var(--rc-on-a)}" +
    S + " .rc-info{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-name{font-size:15px;font-weight:900;letter-spacing:.1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
    S + " .rc-meta{font-size:12px;color:#666;font-weight:600}" +
    S + " .rc-save{align-self:flex-start;font-size:10.5px;font-weight:800;color:var(--rc-a-t);background:var(--rc-a-l2);border:1px solid var(--rc-a-l3);border-radius:20px;padding:2px 8px;margin-top:3px;text-transform:uppercase;letter-spacing:.3px}" +
    S + " .rc-price{text-align:right;display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}" +
    S + " .rc-price b{font-size:18px;font-weight:900;white-space:nowrap}" +
    S + " .rc-price s{font-size:12px;color:#a3a3a3;margin-top:2px;white-space:nowrap}" +
    // margin-bottom acá y no solo en el botón: hay temas (morelia en Tiendanube)
    // que resetean los márgenes de <button> con !important y el CTA quedaba pegado
    // a la última tarjeta de modo. El margen de un <div> nuestro no lo tocan.
    S + " .rc-modes{margin-top:16px;margin-bottom:14px;display:flex;flex-direction:column;gap:8px}" +
    S + " .rc-mode{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:0 12px;width:100%;padding:12px 14px;text-align:left;border:2px dashed #d4d4d4;border-radius:var(--rc-r);background:#fff;transition:border-color .2s,background .2s}" +
    S + " .rc-mode:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-mode.is-on{border-style:solid;border-color:var(--rc-a);background:var(--rc-a-l1)}" +
    S + " .rc-check{width:28px;height:28px;border:2px solid #cfcfcf;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--rc-on-a);background:#fff;transition:all .2s}" +
    S + " .rc-check svg{opacity:0;transform:scale(.4);transition:all .18s}" +
    S + " .rc-mode.is-on .rc-check{border-color:var(--rc-a);background:var(--rc-a)}" +
    S + " .rc-mode.is-on .rc-check svg{opacity:1;transform:scale(1)}" +
    S + " .rc-mode-txt{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-mode-txt b{font-size:15px;font-weight:900}" +
    S + " .rc-mode-txt small{font-size:12px;color:#666;font-weight:600;line-height:1.35}" +
    S + " .rc-mode-price{font-size:15px;font-weight:900;white-space:nowrap}" +
    S + " .rc-mode.is-on .rc-mode-price{color:var(--rc-a-t)}" +
    S + " .rc-cta{margin-top:14px !important;padding:17px 14px;font-size:17px}" +
    S + " .rc-trust{justify-content:center;margin-top:14px}" +
    "@container (max-width:379px){" +
      S + " .rc-pack{grid-template-columns:20px 38px minmax(0,1fr) auto;gap:0 8px;padding:12px 10px}" +
      S + " .rc-pack.is-on{padding:11.5px 9.5px}" +
      S + " .rc-qty{width:38px;height:38px;font-size:15px}" +
      S + " .rc-name{font-size:14px}" + S + " .rc-price b{font-size:16px}" +
      S + " .rc-mode{grid-template-columns:26px minmax(0,1fr) auto;gap:0 9px;padding:11px 10px}" +
      S + " .rc-mode-txt b{font-size:14px}" + S + " .rc-mode-price{font-size:14px}" +
    "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v02 — Lista (filas radio, precio a la derecha, tabs arriba)
// ═════════════════════════════════════════════════════════════════════
function v02(c) {
  var S = c.S, t = c.t;
  var tabs = c.modes.map(function (m) {
    return '<button class="rc-tab' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var rows = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    var meta = [c.perUnit(p), c.mode === "sub" ? "cada " + p.freqLabel : ""].filter(Boolean).join(" · ");
    return '<div class="rc-row' + c.on(on) + '"' + c.radioAttrs(i) + ">" +
      '<span class="rc-dot" aria-hidden="true"></span>' +
      '<span class="rc-row-main"><span class="rc-row-top"><b>' + esc(p.label) + "</b>" + (p.badge ? '<span class="rc-tag">' + esc(p.badge) + "</span>" : "") + "</span>" +
        (meta ? "<small>" + esc(meta) + "</small>" : "") + "</span>" +
      '<span class="rc-row-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + (c.savings(p) ? "<em>" + esc(c.savings(p)) + "</em>" : "") + "</span>" +
      "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-top"><h3>' + esc(t.headline) + "</h3>" +
    '<div class="rc-tabs" role="radiogroup" aria-label="Modo de compra">' + tabs + "</div></div>" +
    '<div class="rc-rows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + " .rc-top{margin-bottom:12px}" +
    S + " .rc-top h3{font-size:14px;font-weight:800;margin-bottom:10px}" +
    S + " .rc-tabs{display:grid;grid-template-columns:1fr 1fr;background:#f1f1f1;border-radius:calc(var(--rc-r) * .75);padding:4px;gap:4px}" +
    S + " .rc-tab{padding:9px 6px;border-radius:calc(var(--rc-r) * .55);font-size:13px;font-weight:700;color:#555;text-align:center;transition:background .18s,color .18s,box-shadow .18s;line-height:1.25}" +
    S + " .rc-tab:hover{color:#161616}" +
    S + " .rc-tab.is-on{background:#fff;color:#161616;box-shadow:0 1px 4px rgba(0,0,0,.12)}" +
    S + " .rc-tab .rc-disc{margin-left:4px;background:var(--rc-a);color:var(--rc-on-a);border-radius:20px;padding:1px 6px;font-size:11px}" +
    S + " .rc-rows{border:1px solid #e2e2e2;border-radius:var(--rc-r);overflow:hidden;background:#fff}" +
    S + " .rc-row{display:grid;grid-template-columns:20px minmax(0,1fr) auto;align-items:center;gap:0 12px;padding:14px;border-top:1px solid #ececec;transition:background .18s,box-shadow .18s;position:relative}" +
    S + " .rc-row:first-child{border-top:0}" +
    S + " .rc-row:hover{background:#fafafa}" +
    S + " .rc-row.is-on{background:var(--rc-a-l1);box-shadow:inset 3px 0 0 var(--rc-a)}" +
    S + " .rc-dot{width:18px;height:18px;border-radius:50%;border:2px solid #c9c9c9;background:#fff;transition:all .18s}" +
    S + " .rc-row.is-on .rc-dot{border:6px solid var(--rc-a)}" +
    S + " .rc-row-main{min-width:0;display:flex;flex-direction:column;gap:3px}" +
    S + " .rc-row-top{display:flex;align-items:center;gap:7px;flex-wrap:wrap}" +
    S + " .rc-row-top b{font-size:14.5px;font-weight:800}" +
    S + " .rc-tag{font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--rc-on-a);background:var(--rc-a);border-radius:4px;padding:2px 6px}" +
    S + " .rc-row-main small{font-size:12px;color:#6b6b6b}" +
    S + " .rc-row-price{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15;text-align:right}" +
    S + " .rc-row-price b{font-size:16px;font-weight:800;white-space:nowrap}" +
    S + " .rc-row-price s{font-size:11.5px;color:#a3a3a3;white-space:nowrap;margin-top:2px}" +
    S + " .rc-row-price em{font-size:11px;font-weight:800;color:var(--rc-a-t);margin-top:2px;white-space:nowrap}" +
    S + " .rc-freq{margin:12px 2px}" +
    S + " .rc-trust{margin-top:12px}" +
    "@container (max-width:359px){" + S + " .rc-row{padding:12px 10px;gap:0 9px}" + S + " .rc-row-top b{font-size:13.5px}" + S + " .rc-row-price b{font-size:15px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v03 — Compacto (pills de cantidad + precio grande + switch)
// ═════════════════════════════════════════════════════════════════════
function v03(c) {
  var S = c.S, t = c.t;
  var pills = c.packs.map(function (p, i) {
    var v = c.v(p);
    return '<div class="rc-pill' + c.on(i === c.idx) + '"' + c.radioAttrs(i) + '><b>' + p.qty + "</b>" +
      (v.savingsPct ? "<small>−" + v.savingsPct + "%</small>" : "<small>&nbsp;</small>") +
      (p.badge ? '<span class="rc-pill-badge">' + esc(p.badge) + "</span>" : "") + "</div>";
  }).join("");
  var other = c.mode === "sub" ? "once" : "sub";
  var switchHtml =
    '<div class="rc-sw-row">' +
      '<button type="button" class="rc-sw' + c.on(c.mode === "sub") + '" role="switch" aria-checked="' + (c.mode === "sub" ? "true" : "false") + '" aria-label="' + esc(t.sub_label) + '" data-rc-action="mode" data-rc-value="' + other + '"><i></i></button>' +
      '<span class="rc-sw-txt"><b>' + c.modeLabel("sub", true) + (c.disc > 0 ? " extra" : "") + "</b><small>" +
        esc(c.mode === "sub" ? c.freqText() : "Activalo y te llega solo, " + (c.sel ? "cada " + c.sel.freqLabel : "") + (c.disc > 0 ? " con " + c.disc + "% off" : "")) +
      "</small></span></div>";
  var meta = [c.perUnit(c.sel || { sub: {}, once: {} }), c.savings(c.sel || {})].filter(Boolean);
  var html = c.wrap(
    '<div class="rc-top"><span class="rc-lbl">' + esc(t.headline) + '</span><span class="rc-mode-lbl">' + c.modeLabel(c.mode) + "</span></div>" +
    '<div class="rc-pills" role="radiogroup" aria-label="' + esc(t.headline) + '">' + pills + "</div>" +
    '<div class="rc-price-block"><span class="rc-big">' + esc(fmtARS(c.view.price)) + "</span>" + c.compareHtml(c.sel || { sub: {}, once: {} }) +
      (meta.length ? '<span class="rc-meta">' + meta.map(function (m, k) { return k === 1 ? '<em class="rc-save">' + esc(m) + "</em>" : esc(m); }).join(" · ") + "</span>" : "") + "</div>" +
    switchHtml + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + "{padding:16px;border:1px solid #e4e4e4;border-radius:calc(var(--rc-r) * 1.2);background:#fff}" +
    S + " .rc-top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px}" +
    S + " .rc-lbl{font-size:12px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:#444}" +
    S + " .rc-mode-lbl{font-size:12px;font-weight:700;color:var(--rc-a-t)}" +
    S + " .rc-pills{display:grid;grid-template-columns:repeat(auto-fit,minmax(64px,1fr));gap:8px}" +
    S + " .rc-pill{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 6px 8px;border:1.5px solid #dedede;border-radius:calc(var(--rc-r) * .8);background:#fff;transition:all .18s;line-height:1.1}" +
    S + " .rc-pill:hover{border-color:var(--rc-a-l3);background:var(--rc-a-l1)}" +
    S + " .rc-pill.is-on{border-color:var(--rc-a);background:var(--rc-a);color:var(--rc-on-a);box-shadow:0 4px 14px var(--rc-a-40)}" +
    S + " .rc-pill b{font-size:20px;font-weight:900}" +
    S + " .rc-pill small{font-size:11px;font-weight:700;color:var(--rc-a-t);margin-top:3px}" +
    S + " .rc-pill.is-on small{color:var(--rc-on-a);opacity:.9}" +
    S + " .rc-pill-badge{position:absolute;top:-9px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:20px;background:#161616;color:#fff;white-space:nowrap;max-width:96%;overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-pills{padding-top:8px}" +
    S + " .rc-price-block{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px;margin:16px 0 12px}" +
    S + " .rc-big{font-size:32px;font-weight:900;letter-spacing:-.8px;line-height:1}" +
    S + " .rc-old{font-size:15px;color:#a3a3a3}" +
    S + " .rc-meta{flex-basis:100%;font-size:12.5px;color:#666;font-weight:600}" +
    S + " .rc-save{color:var(--rc-a-t);font-weight:800}" +
    S + " .rc-sw-row{display:flex;align-items:center;gap:12px;padding:12px;border-radius:var(--rc-r);background:var(--rc-a-l1);border:1px solid var(--rc-a-l2);margin-bottom:12px}" +
    S + " .rc-sw{position:relative;flex-shrink:0;width:46px;height:27px;border-radius:30px;background:#cfcfcf;transition:background .2s}" +
    S + " .rc-sw i{position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}" +
    S + " .rc-sw.is-on{background:var(--rc-a)}" +
    S + " .rc-sw.is-on i{transform:translateX(19px)}" +
    S + " .rc-sw-txt{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-sw-txt b{font-size:14px;font-weight:800}" +
    S + " .rc-sw-txt small{font-size:12px;color:#555;line-height:1.35}" +
    S + " .rc-trust{margin-top:12px}" +
    "@container (max-width:359px){" + S + " .rc-pill-badge{font-size:8px;letter-spacing:.2px;padding:2px 5px;max-width:calc(100% + 14px)}" + S + " .rc-big{font-size:28px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v04 — Tabla comparativa (una vez vs suscripción por pack)
// ═════════════════════════════════════════════════════════════════════
function v04(c) {
  var S = c.S, t = c.t;
  var cols = c.modes;
  var thead = '<tr><th class="rc-th-pack" scope="col">Pack</th>' + cols.map(function (m) {
    return '<th scope="col"><button class="rc-th' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button></th>";
  }).join("") + "</tr>";
  var tbody = c.packs.map(function (p, i) {
    var on = i === c.idx;
    return '<tr class="rc-tr' + c.on(on) + '"' + c.radioAttrs(i) + '><th scope="row" class="rc-td-pack"><span class="rc-dot" aria-hidden="true"></span><span><b>' + esc(p.label) + "</b>" +
      (p.badge ? '<small class="rc-badge">' + esc(p.badge) + "</small>" : "") + "</span></th>" +
      cols.map(function (m) {
        var v = p[m], cur = on && m === c.mode;
        return '<td class="rc-td' + c.on(cur, "is-cur") + c.on(m === c.mode, "is-col") + '" data-rc-action="mode" data-rc-value="' + m + '"><b>' + esc(fmtARS(v.price)) + "</b>" +
          (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") +
          (m === "sub" ? "<small>cada " + esc(p.freqLabel) + "</small>" : (c.showPerUnit ? "<small>" + esc(c.perUnit(p, m)) + "</small>" : "")) + "</td>";
      }).join("") + "</tr>";
  }).join("");
  var summary = c.sel
    ? '<div class="rc-sum"><span><b>' + esc(c.sel.label) + "</b> · " + c.modeLabel(c.mode) + "</span><span class=\"rc-sum-price\">" + c.compareHtml(c.sel) + "<b>" + esc(fmtARS(c.view.price)) + "</b></span></div>"
    : "";
  var html = c.wrap(
    '<h3 class="rc-h">' + esc(t.headline) + "</h3>" +
    '<div class="rc-scroll"><table class="rc-table" role="radiogroup" aria-label="' + esc(t.headline) + '"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table></div>" +
    summary + c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + " .rc-h{font-size:14px;font-weight:800;margin-bottom:10px}" +
    S + " .rc-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}" +
    S + " .rc-table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e2e2;border-radius:var(--rc-r);overflow:hidden;background:#fff;table-layout:fixed;margin:0;font-size:13px}" +
    S + " .rc-table th," + S + " .rc-table td{padding:0;border:0;vertical-align:middle;font-weight:inherit}" +
    S + " .rc-table thead th{background:#f7f7f7;border-bottom:1px solid #e2e2e2;padding:0}" +
    S + " .rc-th-pack{padding:10px 12px;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:#777;width:38%;text-align:left}" +
    S + " .rc-th{display:block;width:100%;padding:10px 4px;font-size:12px;font-weight:800;text-align:center;color:#555;border-bottom:3px solid transparent;transition:all .18s;line-height:1.2}" +
    S + " .rc-th:hover{color:#161616}" +
    S + " .rc-th.is-on{color:var(--rc-a-t);border-bottom-color:var(--rc-a);background:var(--rc-a-l1)}" +
    S + " .rc-th .rc-disc{display:block;font-size:10.5px}" +
    S + " .rc-tr{transition:background .18s}" +
    S + " .rc-tr:hover{background:#fafafa}" +
    S + " .rc-tr.is-on{background:var(--rc-a-l1)}" +
    S + " .rc-tr .rc-td-pack{padding:12px;border-top:1px solid #ececec;display:flex;align-items:center;gap:8px;line-height:1.2;text-align:left}" +
    S + " .rc-tr:first-child .rc-td-pack{border-top:0}" +
    S + " .rc-td-pack b{font-size:13.5px;font-weight:800;display:block}" +
    S + " .rc-badge{display:inline-block;margin-top:3px;font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--rc-a-t);background:var(--rc-a-l2);border-radius:4px;padding:2px 5px}" +
    S + " .rc-dot{flex-shrink:0;width:16px;height:16px;border-radius:50%;border:2px solid #c9c9c9;background:#fff;transition:all .18s}" +
    S + " .rc-tr.is-on .rc-dot{border:5px solid var(--rc-a)}" +
    S + " .rc-td{padding:10px 6px;text-align:center;border-top:1px solid #ececec;border-left:1px solid #ececec;line-height:1.2;transition:background .18s,box-shadow .18s}" +
    S + " .rc-tr:first-child .rc-td{border-top:0}" +
    S + " .rc-td.is-col{background:var(--rc-a-12)}" +
    S + " .rc-td.is-cur{background:var(--rc-a);color:var(--rc-on-a);box-shadow:inset 0 0 0 2px var(--rc-a-d)}" +
    S + " .rc-td b{display:block;font-size:14px;font-weight:800;white-space:nowrap}" +
    S + " .rc-td em{display:inline-block;font-size:10.5px;font-weight:800;color:var(--rc-a-t);margin-top:2px}" +
    S + " .rc-td.is-cur em{color:var(--rc-on-a);opacity:.9}" +
    S + " .rc-td small{display:block;font-size:10.5px;color:#777;margin-top:2px;white-space:nowrap}" +
    S + " .rc-td.is-cur small{color:var(--rc-on-a);opacity:.85}" +
    S + " .rc-sum{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin:14px 2px 8px;font-size:13.5px}" +
    S + " .rc-sum-price{display:flex;align-items:baseline;gap:8px}" +
    S + " .rc-sum-price s{color:#a3a3a3;font-size:12.5px}" +
    S + " .rc-sum-price b{font-size:20px;font-weight:900}" +
    S + " .rc-freq{margin:0 2px 12px}" +
    "@container (max-width:359px){" + S + " .rc-table{font-size:12px}" + S + " .rc-td b{font-size:13px}" + S + " .rc-td-pack b{font-size:12.5px}" + S + " .rc-th-pack{width:34%}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v05 — Tarjetas grandes con etiqueta lateral de ahorro
// ═════════════════════════════════════════════════════════════════════
function v05(c) {
  var S = c.S, t = c.t;
  var seg = c.modes.map(function (m) {
    return '<button class="rc-seg' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var cards = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    var meta = [c.perUnit(p), c.mode === "sub" ? (t.freq_prefix || "Te llega cada") + " " + p.freqLabel : ""].filter(Boolean).join(" · ");
    return '<div class="rc-card' + c.on(on) + '"' + c.radioAttrs(i) + ">" +
      '<div class="rc-side' + c.on(!v.savingsPct, "is-empty") + '">' + (v.savingsPct ? "<span>Ahorrás</span><b>" + v.savingsPct + "%</b>" : "<b>×" + p.qty + "</b>") + "</div>" +
      '<div class="rc-body"><div class="rc-card-top"><b class="rc-card-name">' + esc(p.label) + "</b>" + (p.badge ? '<span class="rc-badge">' + esc(p.badge) + "</span>" : "") + "</div>" +
        '<div class="rc-card-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</div>" +
        (meta ? "<small>" + esc(meta) + "</small>" : "") + "</div>" +
      '<span class="rc-tick2" aria-hidden="true">' + SVG_CHECK + "</span>" +
      "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-top"><h3>' + esc(t.headline) + "</h3>" +
    '<div class="rc-segs" role="radiogroup" aria-label="Modo de compra">' + seg + "</div></div>" +
    '<div class="rc-cards" role="radiogroup" aria-label="' + esc(t.headline) + '">' + cards + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + " .rc-top{margin-bottom:12px}" +
    S + " .rc-top h3{font-size:15px;font-weight:900;margin-bottom:10px;letter-spacing:-.2px}" +
    S + " .rc-segs{display:inline-flex;border:1.5px solid #dcdcdc;border-radius:40px;padding:3px;max-width:100%}" +
    S + " .rc-seg{padding:8px 14px;border-radius:40px;font-size:13px;font-weight:700;color:#555;transition:all .18s;white-space:nowrap}" +
    S + " .rc-seg:hover{color:#161616}" +
    S + " .rc-seg.is-on{background:#161616;color:#fff}" +
    S + " .rc-seg .rc-disc{color:var(--rc-a-b);margin-left:3px}" +
    S + " .rc-seg:not(.is-on) .rc-disc{color:var(--rc-a-t)}" +
    S + " .rc-cards{display:flex;flex-direction:column;gap:10px}" +
    S + " .rc-card{position:relative;display:grid;grid-template-columns:64px minmax(0,1fr) 28px;align-items:center;gap:0 14px;border:1.5px solid #e2e2e2;border-radius:var(--rc-r);background:#fff;overflow:hidden;min-height:84px;transition:border-color .2s,box-shadow .2s,transform .15s}" +
    S + " .rc-card:hover{border-color:var(--rc-a-l3);transform:translateY(-1px)}" +
    S + " .rc-card.is-on{border-color:var(--rc-a);box-shadow:0 8px 24px var(--rc-a-25)}" +
    S + " .rc-side{align-self:stretch;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--rc-a-l2);color:var(--rc-a-t);line-height:1;padding:10px 4px}" +
    S + " .rc-side span{font-size:9.5px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;margin-bottom:3px}" +
    S + " .rc-side b{font-size:20px;font-weight:900;letter-spacing:-.5px}" +
    S + " .rc-card.is-on .rc-side{background:var(--rc-a);color:var(--rc-on-a)}" +
    S + " .rc-body{min-width:0;padding:12px 0}" +
    S + " .rc-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}" +
    S + " .rc-card-name{font-size:15px;font-weight:900}" +
    S + " .rc-badge{font-size:10px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:#161616;background:#ffe872;border-radius:4px;padding:2px 7px}" +
    S + " .rc-card-price{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}" +
    S + " .rc-card-price b{font-size:22px;font-weight:900;letter-spacing:-.4px}" +
    S + " .rc-card-price s{font-size:13px;color:#a3a3a3}" +
    S + " .rc-body small{display:block;font-size:12px;color:#666;margin-top:3px}" +
    S + " .rc-tick2{width:22px;height:22px;border-radius:50%;border:2px solid #d4d4d4;display:flex;align-items:center;justify-content:center;color:var(--rc-on-a);margin-right:12px;transition:all .18s}" +
    S + " .rc-tick2 svg{opacity:0;transform:scale(.4);transition:all .18s}" +
    S + " .rc-card.is-on .rc-tick2{background:var(--rc-a);border-color:var(--rc-a)}" +
    S + " .rc-card.is-on .rc-tick2 svg{opacity:1;transform:scale(1)}" +
    S + " .rc-freq{margin:14px 2px 12px}" +
    "@container (max-width:359px){" + S + " .rc-card{grid-template-columns:54px minmax(0,1fr) 24px;gap:0 10px}" + S + " .rc-side b{font-size:17px}" + S + " .rc-card-price b{font-size:19px}" + S + " .rc-tick2{margin-right:8px;width:20px;height:20px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v06 — Minimal (líneas finas, tipografía protagonista)
// ═════════════════════════════════════════════════════════════════════
function v06(c) {
  var S = c.S, t = c.t;
  var links = c.modes.map(function (m) {
    return '<button class="rc-link' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join('<span class="rc-sep" aria-hidden="true">/</span>');
  var rows = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    return '<div class="rc-mrow' + c.on(on) + '"' + c.radioAttrs(i) + '><span class="rc-mark" aria-hidden="true"></span>' +
      '<span class="rc-mname"><b>' + esc(p.label) + "</b>" + (p.badge ? "<em>" + esc(p.badge) + "</em>" : "") + "</span>" +
      '<span class="rc-mprice">' + c.compareHtml(p) + "<b>" + esc(fmtARS(v.price)) + "</b></span></div>";
  }).join("");
  var detail = c.sel ? [c.perUnit(c.sel), c.savings(c.sel)].filter(Boolean).join(" · ") : "";
  var html = c.wrap(
    '<div class="rc-mhead"><span class="rc-eyebrow">' + esc(t.headline) + '</span><div class="rc-links" role="radiogroup" aria-label="Modo de compra">' + links + "</div></div>" +
    '<div class="rc-mrows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div>" +
    (detail ? '<p class="rc-mdetail">' + esc(detail) + "</p>" : "") +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + "{color:#111}" +
    S + " .rc-mhead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;padding-bottom:10px;border-bottom:1px solid #111}" +
    S + " .rc-eyebrow{font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase}" +
    S + " .rc-links{display:flex;align-items:baseline;gap:8px;font-size:12.5px}" +
    S + " .rc-link{color:#888;font-weight:600;padding:2px 0;border-bottom:1.5px solid transparent;transition:color .18s,border-color .18s;white-space:nowrap}" +
    S + " .rc-link:hover{color:#111}" +
    S + " .rc-link.is-on{color:#111;border-bottom-color:#111}" +
    S + " .rc-link .rc-disc{color:var(--rc-a-t);font-weight:800}" +
    S + " .rc-sep{color:#bbb}" +
    S + " .rc-mrow{display:grid;grid-template-columns:14px minmax(0,1fr) auto;align-items:center;gap:0 14px;padding:16px 2px;border-bottom:1px solid #e6e6e6;transition:padding-left .18s,background .18s}" +
    S + " .rc-mrow:hover{background:#fafafa}" +
    S + " .rc-mark{width:10px;height:10px;border-radius:50%;border:1.5px solid #bbb;transition:all .18s}" +
    S + " .rc-mrow.is-on .rc-mark{background:var(--rc-a);border-color:var(--rc-a);box-shadow:0 0 0 4px var(--rc-a-25)}" +
    S + " .rc-mname{min-width:0;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}" +
    S + " .rc-mname b{font-size:17px;font-weight:500;letter-spacing:-.2px}" +
    S + " .rc-mrow.is-on .rc-mname b{font-weight:700}" +
    S + " .rc-mname em{font-size:10.5px;letter-spacing:.8px;text-transform:uppercase;color:var(--rc-a-t);font-weight:700}" +
    S + " .rc-mprice{display:flex;align-items:baseline;gap:8px;white-space:nowrap}" +
    S + " .rc-mprice s{font-size:12.5px;color:#aaa}" +
    S + " .rc-mprice b{font-size:18px;font-weight:500;letter-spacing:-.3px}" +
    S + " .rc-mrow.is-on .rc-mprice b{font-weight:800}" +
    S + " .rc-mdetail{margin:12px 2px 0;font-size:12.5px;color:#555}" +
    S + " .rc-freq{margin:8px 2px 16px;color:#555}" +
    S + " .rc-cta{border-radius:calc(var(--rc-r) * .3);background:#111;color:#fff;box-shadow:none;letter-spacing:.6px;text-transform:uppercase;font-size:13.5px;padding:16px}" +
    S + " .rc-cta:hover{background:var(--rc-a)}" +
    S + " .rc-trust{justify-content:center;color:#777;margin-top:12px}" +
    S + " .rc-trust .rc-tick{color:#111}" +
    "@container (max-width:359px){" + S + " .rc-mname b{font-size:15px}" + S + " .rc-mprice b{font-size:16px}" + S + " .rc-mrow{gap:0 10px;padding:14px 2px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v07 — Segmentado (control de packs + card de precio)
// ═════════════════════════════════════════════════════════════════════
function v07(c) {
  var S = c.S, t = c.t;
  var segs = c.packs.map(function (p, i) {
    var v = c.v(p);
    return '<div class="rc-seg' + c.on(i === c.idx) + '"' + c.radioAttrs(i) + "><b>" + p.qty + "</b><small>" + esc(p.qty === 1 ? "unidad" : "unidades") + "</small>" +
      (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") + (p.badge ? '<span class="rc-flag">' + esc(p.badge) + "</span>" : "") + "</div>";
  }).join("");
  var chips = c.modes.map(function (m) {
    return '<button class="rc-chip' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var html = c.wrap(
    '<h3 class="rc-h">' + esc(t.headline) + "</h3>" +
    '<div class="rc-segs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + segs + "</div>" +
    '<div class="rc-pcard">' +
      '<div class="rc-chips" role="radiogroup" aria-label="Modo de compra">' + chips + "</div>" +
      '<div class="rc-pcard-row"><span class="rc-pcard-name">' + esc(c.sel ? c.sel.label : "") + '</span><span class="rc-pcard-price">' + c.compareHtml(c.sel || { sub: {}, once: {} }) + "<b>" + esc(fmtARS(c.view.price)) + "</b></span></div>" +
      '<div class="rc-pcard-meta">' + [c.perUnit(c.sel || { sub: {}, once: {} }) ? "<span>" + esc(c.perUnit(c.sel)) + "</span>" : "", c.savings(c.sel || {}) ? '<span class="rc-save">' + esc(c.savings(c.sel)) + "</span>" : ""].filter(Boolean).join("") + "</div>" +
      c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' +
    "</div>" + c.trust()
  );
  var css =
    S + " .rc-h{font-size:14px;font-weight:800;margin-bottom:10px}" +
    S + " .rc-segs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;border:1.5px solid #dadada;border-radius:var(--rc-r);overflow:visible;background:#f6f6f6;padding:4px;gap:4px;margin-top:10px}" +
    S + " .rc-seg{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:10px 4px 8px;border-radius:calc(var(--rc-r) * .7);line-height:1.05;transition:all .18s;min-width:0}" +
    S + " .rc-seg:hover{background:#fff}" +
    S + " .rc-seg.is-on{background:#fff;box-shadow:0 2px 8px rgba(0,0,0,.12),inset 0 0 0 2px var(--rc-a)}" +
    S + " .rc-seg b{font-size:22px;font-weight:900;letter-spacing:-.5px}" +
    S + " .rc-seg small{font-size:10.5px;color:#777;font-weight:600;margin-top:2px}" +
    S + " .rc-seg em{font-size:10.5px;font-weight:800;color:var(--rc-a-t);margin-top:4px;background:var(--rc-a-l2);border-radius:20px;padding:1px 7px}" +
    S + " .rc-flag{position:absolute;top:-10px;left:50%;transform:translateX(-50%);font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;padding:2px 7px;border-radius:20px;background:var(--rc-a);color:var(--rc-on-a);white-space:nowrap;max-width:96%;overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-pcard{margin-top:12px;padding:14px;border:1.5px solid #e4e4e4;border-radius:var(--rc-r);background:#fff}" +
    S + " .rc-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}" +
    S + " .rc-chip{padding:6px 12px;border:1.5px solid #dcdcdc;border-radius:30px;font-size:12.5px;font-weight:700;color:#555;transition:all .18s}" +
    S + " .rc-chip:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-chip.is-on{border-color:var(--rc-a);background:var(--rc-a-l1);color:var(--rc-a-t)}" +
    S + " .rc-pcard-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}" +
    S + " .rc-pcard-name{font-size:14px;font-weight:800}" +
    S + " .rc-pcard-price{display:flex;align-items:baseline;gap:8px;white-space:nowrap}" +
    S + " .rc-pcard-price s{font-size:13px;color:#a3a3a3}" +
    S + " .rc-pcard-price b{font-size:26px;font-weight:900;letter-spacing:-.5px}" +
    S + " .rc-pcard-meta{display:flex;gap:10px;flex-wrap:wrap;font-size:12.5px;color:#666;font-weight:600;margin:4px 0 10px}" +
    S + " .rc-save{color:var(--rc-a-t);font-weight:800}" +
    S + " .rc-freq{margin-bottom:12px}" +
    S + " .rc-trust{margin-top:12px}" +
    "@container (max-width:359px){" + S + " .rc-seg b{font-size:19px}" + S + " .rc-pcard-price b{font-size:22px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v08 — Oscuro premium
// ═════════════════════════════════════════════════════════════════════
function v08(c) {
  var S = c.S, t = c.t;
  var pills = c.modes.map(function (m) {
    return '<button class="rc-mp' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var cards = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    return '<div class="rc-dc' + c.on(on) + '"' + c.radioAttrs(i) + ">" +
      (p.badge ? '<span class="rc-dbadge">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-dring" aria-hidden="true"><i></i></span>' +
      '<span class="rc-dinfo"><b>' + esc(p.label) + "</b><small>" + esc([p.qty === 1 ? "1 unidad" : p.qty + " unidades", c.perUnit(p)].filter(Boolean).join(" · ")) + "</small></span>" +
      '<span class="rc-dprice"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") + "</span>" +
      "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-dtop"><h3>' + esc(t.headline) + '</h3><div class="rc-mps" role="radiogroup" aria-label="Modo de compra">' + pills + "</div></div>" +
    '<div class="rc-dcs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + cards + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + "{background:#0c0e13;color:#f3f4f6;padding:18px;border-radius:calc(var(--rc-r) * 1.3);border:1px solid rgba(255,255,255,.07);box-shadow:0 20px 50px rgba(0,0,0,.35)}" +
    S + " .rc-dtop{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}" +
    S + " .rc-dtop h3{font-size:14px;font-weight:800;letter-spacing:.2px}" +
    S + " .rc-mps{display:inline-flex;background:#171a22;border:1px solid rgba(255,255,255,.08);border-radius:40px;padding:3px}" +
    S + " .rc-mp{padding:7px 12px;border-radius:40px;font-size:12px;font-weight:700;color:#9aa0ab;transition:all .18s;white-space:nowrap}" +
    S + " .rc-mp:hover{color:#fff}" +
    S + " .rc-mp.is-on{background:var(--rc-a);color:var(--rc-on-a);box-shadow:0 0 18px var(--rc-a-40)}" +
    S + " .rc-mp .rc-disc{color:var(--rc-a-b)}" +
    S + " .rc-mp.is-on .rc-disc{color:var(--rc-on-a);opacity:.9}" +
    S + " .rc-dcs{display:flex;flex-direction:column;gap:10px}" +
    S + " .rc-dc{position:relative;display:grid;grid-template-columns:22px minmax(0,1fr) auto;align-items:center;gap:0 12px;padding:14px;background:#141720;border:1px solid rgba(255,255,255,.08);border-radius:var(--rc-r);transition:border-color .2s,box-shadow .2s,background .2s}" +
    S + " .rc-dc:hover{border-color:rgba(255,255,255,.2)}" +
    S + " .rc-dc.is-on{border-color:var(--rc-a-b);background:#171b26;box-shadow:0 0 0 1px var(--rc-a-b),0 0 28px var(--rc-a-25)}" +
    S + " .rc-dbadge{position:absolute;top:-9px;right:12px;font-size:9.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;padding:3px 8px;border-radius:20px;background:var(--rc-a);color:var(--rc-on-a);box-shadow:0 0 14px var(--rc-a-40)}" +
    S + " .rc-dring{width:20px;height:20px;border-radius:50%;border:1.5px solid #3a3f4b;display:flex;align-items:center;justify-content:center;transition:border-color .18s}" +
    S + " .rc-dring i{width:0;height:0;border-radius:50%;background:var(--rc-a-b);box-shadow:0 0 10px var(--rc-a-b);transition:all .2s}" +
    S + " .rc-dc.is-on .rc-dring{border-color:var(--rc-a-b)}" +
    S + " .rc-dc.is-on .rc-dring i{width:10px;height:10px}" +
    S + " .rc-dinfo{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-dinfo b{font-size:15px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-dinfo small{font-size:12px;color:#9aa0ab}" +
    S + " .rc-dprice{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}" +
    S + " .rc-dprice b{font-size:18px;font-weight:900;color:#fff;white-space:nowrap}" +
    S + " .rc-dc.is-on .rc-dprice b{color:var(--rc-a-b)}" +
    S + " .rc-dprice s{font-size:11.5px;color:#6b7280;white-space:nowrap}" +
    S + " .rc-dprice em{font-size:10.5px;font-weight:800;color:var(--rc-a-b);margin-top:2px}" +
    S + " .rc-freq{margin:14px 2px 12px;color:#c3c7cf}" +
    S + " .rc-freq-ic{color:var(--rc-a-b)}" +
    S + " .rc-cta{background:linear-gradient(135deg,var(--rc-a-b),var(--rc-a-d));box-shadow:0 8px 28px var(--rc-a-40);padding:16px}" +
    S + " .rc-cta:hover{background:linear-gradient(135deg,var(--rc-a),var(--rc-a-d));filter:brightness(1.08)}" +
    S + " .rc-trust{color:#9aa0ab;justify-content:center}" +
    S + " .rc-trust .rc-tick{color:var(--rc-a-b)}" +
    S + " .rc-err{background:#3a1414;color:#ffb4b4}" +
    "@container (max-width:359px){" + S + "{padding:14px}" + S + " .rc-dc{padding:12px 10px;gap:0 9px}" + S + " .rc-dinfo b{font-size:14px}" + S + " .rc-dprice b{font-size:16px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v09 — Pastel (tiles suaves en grilla)
// ═════════════════════════════════════════════════════════════════════
function v09(c) {
  var S = c.S, t = c.t;
  var toggle = c.modes.map(function (m) {
    return '<button class="rc-pt' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var tiles = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    return '<div class="rc-tile' + c.on(on) + '"' + c.radioAttrs(i) + ">" +
      (v.savingsPct ? '<span class="rc-bubble">−' + v.savingsPct + "%</span>" : "") +
      '<span class="rc-tqty">' + p.qty + "</span><span class=\"rc-tlbl\">" + esc(p.label) + "</span>" +
      '<span class="rc-tprice">' + esc(fmtARS(v.price)) + "</span>" + c.compareHtml(p, null, "rc-told") +
      (p.badge ? '<span class="rc-tbadge">' + esc(p.badge) + "</span>" : "") +
      "</div>";
  }).join("");
  var detail = c.sel ? [c.perUnit(c.sel), c.savings(c.sel)].filter(Boolean).join(" · ") : "";
  var html = c.wrap(
    '<h3 class="rc-h">' + esc(t.headline) + "</h3>" +
    '<div class="rc-pts" role="radiogroup" aria-label="Modo de compra">' + toggle + "</div>" +
    '<div class="rc-tiles" role="radiogroup" aria-label="' + esc(t.headline) + '">' + tiles + "</div>" +
    (detail ? '<p class="rc-detail">' + esc(detail) + "</p>" : "") +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust()
  );
  var css =
    S + "{background:var(--rc-a-l1);padding:18px;border-radius:calc(var(--rc-r) * 1.8);color:#2a2a2a}" +
    S + " .rc-h{font-size:17px;font-weight:900;letter-spacing:-.3px;margin-bottom:12px;color:#1d1d1d}" +
    S + " .rc-pts{display:grid;grid-template-columns:1fr 1fr;gap:6px;background:#fff;border-radius:40px;padding:5px;margin-bottom:14px;box-shadow:0 2px 10px rgba(0,0,0,.05)}" +
    S + " .rc-pt{padding:10px 6px;border-radius:40px;font-size:13px;font-weight:700;color:#666;transition:all .2s;line-height:1.2}" +
    S + " .rc-pt:hover{color:#1d1d1d}" +
    S + " .rc-pt.is-on{background:var(--rc-a-l2);color:var(--rc-a-t)}" +
    S + " .rc-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(96px,1fr));gap:10px;padding-top:10px}" +
    S + " .rc-tile{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding:16px 8px 14px;background:#fff;border-radius:calc(var(--rc-r) * 1.4);border:2px solid transparent;transition:all .2s;line-height:1.15}" +
    S + " .rc-tile:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(0,0,0,.06)}" +
    S + " .rc-tile.is-on{border-color:var(--rc-a);box-shadow:0 10px 26px var(--rc-a-25)}" +
    S + " .rc-bubble{position:absolute;top:-10px;right:-6px;background:var(--rc-a);color:var(--rc-on-a);font-size:11px;font-weight:900;padding:4px 8px;border-radius:20px;box-shadow:0 3px 10px var(--rc-a-40)}" +
    S + " .rc-tqty{width:44px;height:44px;border-radius:50%;background:var(--rc-a-l2);color:var(--rc-a-t);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:900;margin-bottom:8px}" +
    S + " .rc-tile.is-on .rc-tqty{background:var(--rc-a);color:var(--rc-on-a)}" +
    S + " .rc-tlbl{font-size:12px;font-weight:700;color:#555;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
    S + " .rc-tprice{font-size:16px;font-weight:900;color:#1d1d1d;white-space:nowrap}" +
    S + " .rc-told{font-size:11px;color:#aaa;margin-top:2px}" +
    S + " .rc-tbadge{margin-top:8px;font-size:9.5px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;color:var(--rc-a-t);background:var(--rc-a-l1);border-radius:12px;padding:3px 8px;max-width:100%;line-height:1.2}" +
    S + " .rc-detail{margin:14px 2px 6px;font-size:13px;font-weight:700;color:var(--rc-a-t);text-align:center}" +
    S + " .rc-freq{justify-content:center;margin:0 2px 14px;color:#555}" +
    S + " .rc-cta{border-radius:40px;padding:16px}" +
    S + " .rc-trust{justify-content:center;margin-top:12px;color:#666}" +
    S + " .rc-trust li{background:#fff;border-radius:30px;padding:5px 10px}" +
    "@container (max-width:359px){" + S + "{padding:14px}" + S + " .rc-tiles{grid-template-columns:repeat(auto-fit,minmax(76px,1fr));gap:8px}" + S + " .rc-tile{padding:14px 6px 12px}" + S + " .rc-tqty{width:38px;height:38px;font-size:17px}" + S + " .rc-tprice{font-size:14px}" + S + " .rc-pt{font-size:12px;padding:9px 4px}" + "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v10 — Editorial (dos columnas, resumen sticky)
// ═════════════════════════════════════════════════════════════════════
function v10(c) {
  var S = c.S, t = c.t, sel = c.sel;
  var tabs = c.modes.map(function (m) {
    return '<button class="rc-etab' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var rows = c.packs.map(function (p, i) {
    var v = c.v(p), on = i === c.idx;
    return '<div class="rc-erow' + c.on(on) + '"' + c.radioAttrs(i) + '><span class="rc-edot" aria-hidden="true"></span>' +
      '<span class="rc-ename"><b>' + esc(p.label) + "</b>" + (p.badge ? "<em>" + esc(p.badge) + "</em>" : "") + (c.showPerUnit ? "<small>" + esc(c.perUnit(p)) + "</small>" : "") + "</span>" +
      '<span class="rc-eprice"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</span></div>";
  }).join("");
  var lines = "";
  if (sel) {
    var list = sel.compareAt > sel.priceOnce ? sel.compareAt : 0;
    if (c.showCompare && list) lines += '<div class="rc-line"><span>Precio de lista</span><s>' + esc(fmtARS(list)) + "</s></div>";
    if (c.showCompare && list && list - sel.priceOnce > 0) lines += '<div class="rc-line"><span>Descuento pack</span><b>−' + esc(fmtARS(list - sel.priceOnce)) + "</b></div>";
    if (c.mode === "sub" && sel.priceOnce - sel.priceSub > 0) lines += '<div class="rc-line rc-line-a"><span>' + esc(t.sub_label) + (c.disc ? " −" + c.disc + "%" : "") + "</span><b>−" + esc(fmtARS(sel.priceOnce - sel.priceSub)) + "</b></div>";
    lines += '<div class="rc-total"><span>Total' + (c.mode === "sub" ? " por envío" : "") + "</span><b>" + esc(fmtARS(c.view.price)) + "</b></div>";
  }
  var html = c.wrap(
    '<div class="rc-ed">' +
      '<div class="rc-ed-l"><h3 class="rc-eh">' + esc(t.headline) + "</h3>" +
        '<div class="rc-etabs" role="radiogroup" aria-label="Modo de compra">' + tabs + "</div>" +
        '<div class="rc-erows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div></div>" +
      '<aside class="rc-ed-r"><div class="rc-sum">' +
        '<small class="rc-sum-eyebrow">Tu pedido</small>' +
        '<b class="rc-sum-title">' + esc(sel ? sel.label : "") + (sel && c.savings(sel) ? ' <em class="rc-sum-save">' + esc(c.savings(sel)) + "</em>" : "") + "</b>" +
        '<div class="rc-lines">' + lines + "</div>" +
        c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() +
      "</div></aside>" +
    "</div>"
  );
  var css =
    S + " .rc-ed{display:flex;flex-direction:column;gap:16px}" +
    S + " .rc-ed-l{min-width:0}" +
    S + " .rc-eh{font-size:22px;font-weight:800;letter-spacing:-.5px;line-height:1.1;margin-bottom:12px}" +
    S + " .rc-etabs{display:flex;gap:18px;border-bottom:1px solid #e2e2e2;margin-bottom:4px}" +
    S + " .rc-etab{padding:8px 0 10px;font-size:13px;font-weight:700;color:#777;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .18s,border-color .18s;white-space:nowrap}" +
    S + " .rc-etab:hover{color:#161616}" +
    S + " .rc-etab.is-on{color:#161616;border-bottom-color:var(--rc-a)}" +
    S + " .rc-etab .rc-disc{color:var(--rc-a-t)}" +
    S + " .rc-erow{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;gap:0 12px;padding:13px 4px;border-bottom:1px solid #eee;transition:background .18s}" +
    S + " .rc-erow:hover{background:#fafafa}" +
    S + " .rc-edot{width:16px;height:16px;border-radius:50%;border:2px solid #c9c9c9;transition:all .18s}" +
    S + " .rc-erow.is-on .rc-edot{border:5px solid var(--rc-a)}" +
    S + " .rc-ename{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-ename b{font-size:14.5px;font-weight:700}" +
    S + " .rc-erow.is-on .rc-ename b{font-weight:800}" +
    S + " .rc-ename em{font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--rc-a-t)}" +
    S + " .rc-ename small{font-size:11.5px;color:#777}" +
    S + " .rc-eprice{display:flex;flex-direction:column;align-items:flex-end;line-height:1.15}" +
    S + " .rc-eprice b{font-size:15px;font-weight:800;white-space:nowrap}" +
    S + " .rc-eprice s{font-size:11.5px;color:#aaa}" +
    S + " .rc-ed-r{min-width:0}" +
    S + " .rc-sum{background:#fafafa;border:1px solid #e6e6e6;border-radius:var(--rc-r);padding:16px}" +
    S + " .rc-sum-eyebrow{display:block;font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:#888;margin-bottom:4px}" +
    S + " .rc-sum-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:16px;font-weight:800;margin-bottom:12px}" +
    S + " .rc-sum-save{font-size:10.5px;font-weight:800;color:var(--rc-on-a);background:var(--rc-a);border-radius:4px;padding:2px 6px;text-transform:uppercase;letter-spacing:.3px}" +
    S + " .rc-lines{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#555;padding-bottom:12px;border-bottom:1px dashed #ddd;margin-bottom:12px}" +
    S + " .rc-line{display:flex;justify-content:space-between;gap:10px}" +
    S + " .rc-line s{color:#aaa}" +
    S + " .rc-line-a{color:var(--rc-a-t);font-weight:700}" +
    S + " .rc-total{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:4px;color:#161616;font-size:14px;font-weight:800}" +
    S + " .rc-total b{font-size:24px;font-weight:900;letter-spacing:-.5px}" +
    S + " .rc-freq{margin-bottom:12px}" +
    S + " .rc-trust{margin-top:12px;flex-direction:column;gap:6px}" +
    "@container (min-width:520px){" +
      S + " .rc-ed{flex-direction:row;align-items:flex-start;gap:20px}" +
      S + " .rc-ed-l{flex:1 1 55%}" +
      S + " .rc-ed-r{flex:0 0 42%;position:sticky;top:16px}" +
    "}";
  return { html: html, css: css };
}

var RENDERERS = { v01: v01, v02: v02, v03: v03, v04: v04, v05: v05, v06: v06, v07: v07, v08: v08, v09: v09, v10: v10 };

// ─── API ─────────────────────────────────────────────────────────────
export function renderBundle(vm, state) {
  vm = vm && typeof vm === "object" ? vm : {};
  if (!RENDERERS[vm.variant]) vm = Object.assign({}, vm, { variant: "v01" });
  var c = buildCtx(vm, state || {});
  if (!c.packs.length) {
    return { html: c.wrap(""), css: baseCss(c.S, vm) };
  }
  var out = RENDERERS[vm.variant](c);
  return { html: out.html, css: baseCss(c.S, vm) + out.css };
}

export default renderBundle;
