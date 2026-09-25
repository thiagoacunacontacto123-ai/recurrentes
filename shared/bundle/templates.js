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
  { id: "v01", name: "Clásico",          description: "Cards apiladas estilo Lumina, ribbon en el pack recomendado y caja de suscripción punteada. Muestra la foto del pack si la cargaste." },
  { id: "v02", name: "Lista",            description: "Filas tipo radio con el precio a la derecha y pestañas Compra única / Suscripción arriba. El formato más usado por suplementos de USA." },
  { id: "v03", name: "Compacto",         description: "Pills de cantidad con la foto del pack arriba, precio grande abajo y switch de suscripción. Ocupa poco alto." },
  { id: "v04", name: "Tabla",            description: "Comparativa por pack: una columna Una vez y otra Suscripción. Se elige tocando la celda." },
  { id: "v05", name: "Tarjetas grandes", description: "Una card por pack con la foto al lado, etiqueta de ahorro lateral y segmentado de modo arriba." },
  { id: "v06", name: "Minimal",          description: "Líneas finas, sin fondos, tipografía protagonista. Para tiendas con estética limpia." },
  { id: "v07", name: "Segmentado",       description: "Control segmentado de packs y una card de precio con chips de modo." },
  { id: "v08", name: "Oscuro premium",   description: "Fondo oscuro, acento brillante y CTA con degradado. Para marcas premium." },
  { id: "v09", name: "Pastel",           description: "Fondos suaves, esquinas bien redondeadas y tiles de pack en grilla, con la foto dentro del círculo." },
  { id: "v10", name: "Editorial",        description: "Dos columnas: packs a la izquierda y resumen del pedido sticky a la derecha. En mobile se apila." },
  { id: "v11", name: "Foto",             description: "Una fila por pack con la foto que subís vos, cinta en el recomendado y switch de suscripción antes del botón. El formato de los bundles que más venden." },
  { id: "v12", name: "Foto + regalos",   description: "Como Foto, y además cada pack muestra los regalos que incluye, con su imagen y el precio tachado. Para bundles con bonus." },
  { id: "v13", name: "Foto + check",     description: "Como Foto, pero la suscripción se activa con un cuadrado de tilde sobre un recuadro punteado, en vez del switch. El punteado la separa de los packs y se lee como un extra que se agrega." },
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

// Marquito de foto del respaldo (v11/v12): montaña + sol, el ícono universal
// de "acá va una imagen".
var SVG_PHOTO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>';
var SVG_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5"/></svg>';
var SVG_LOCK = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
var SVG_REPEAT = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

// ─── contexto compartido por variante ────────────────────────────────
function buildCtx(vm, state) {
  var todos = Array.isArray(vm.packs) ? vm.packs : [];
  var mode = state && state.mode === "once" ? "once" : "sub";
  // Packs visibles EN ESTE MODO (22-sept-2026, Thiago): 3 bloques en compra
  // unica y 2 en suscripcion, por ejemplo. Al tocar el toggle se vuelve a
  // pintar con la otra lista. Se filtra aca, asi lo heredan las 13 variantes.
  var packs = todos.filter(function (p) { return mode === "once" ? !p.hideOnce : !p.hideSub; });
  if (!packs.length) packs = todos;   // nunca dejar el widget sin packs
  // `idx` es el indice REAL en plan.packs (con el que cobra el checkout), no la
  // posicion en la lista visible. Si el pack elegido no existe en este modo, se
  // cae al primero visible.
  var idx = state && Number.isInteger(state.selectedIdx) ? state.selectedIdx : (vm.defaultIdx || 0);
  var visible = false;
  for (var vi = 0; vi < packs.length; vi++) if (packs[vi].idx === idx) { visible = true; break; }
  if (!visible) idx = packs.length ? packs[0].idx : 0;
  var t = vm.texts || {};
  var sel = null;
  for (var si = 0; si < packs.length; si++) if (packs[si].idx === idx) { sel = packs[si]; break; }
  if (!sel) sel = packs[0] || null;
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
  // Los textos vienen ya saneados: "" significa que el comerciante lo apagó con
  // una "x" y esa sección no se dibuja (21-sept-2026). `undefined` es otra cosa
  // —nunca se guardó— y ahí sí va el default de siempre.
  var apagado = function (v) { return v === ""; };
  // El título, listo para pegar. Vacío (apagado con "x") = no se dibuja ni el
  // contenedor, así no queda un hueco arriba del widget.
  ctx.headHtml = function (cls) {
    if (!t.headline) return "";
    return '<div class="' + (cls || "rc-head") + '"><h3>' + esc(t.headline) + "</h3></div>";
  };
  ctx.savings = function (p, m) {
    var vv = ctx.v(p, m); if (!vv.savingsPct) return "";
    if (apagado(t.savings_label)) return "";
    return String(t.savings_label || "Ahorrás {pct}%").replace("{pct}", String(vv.savingsPct));
  };
  ctx.perUnit = function (p, m) {
    if (!ctx.showPerUnit || apagado(t.per_unit_label)) return "";
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
    // La pildora sale de `disc_label` ({pct} = el %). Vacia = no se pinta.
    if (m === "sub" && withDisc && ctx.disc > 0) {
      var lbl = t.disc_label === undefined ? "\u2212{pct}%" : t.disc_label;
      if (!lbl) return esc(base);
      return esc(base) + ' <em class="rc-disc">' + esc(String(lbl).replace(/\{pct\}/g, ctx.disc)) + "</em>";
    }
    return esc(base);
  };
  // Prefijo de la línea de frecuencia para UN pack. Si el comerciante escribió
  // el suyo en el diseñador, se respeta; si no, lleva la cantidad del pack.
  ctx.freqPrefix = function (p) {
    if (t.freq_prefix) return t.freq_prefix;
    return (p && p.qty > 1) ? "Te llegan " + p.qty + " cada" : "Te llega cada";
  };
  ctx.freqText = function (p) {
    p = p || sel;
    if (mode !== "sub") return "Compra por única vez · sin renovación automática";
    var fl = p && p.freqLabel ? p.freqLabel : "";
    // "Te llegan 2 cada 12 meses", no "Te llega cada 12 meses" (21-sept-2026,
    // Thiago): sin la cantidad el comprador no sabe QUÉ le llega en cada envío.
    // Solo cuando el pack trae más de uno y el comerciante no cambió el prefijo:
    // si lo escribió él, se respeta tal cual.
    return ctx.freqPrefix(p) + (fl ? " " + fl : "") + " · pausás o cancelás cuando quieras";
  };
  // Botón (25-sept-2026, Thiago: "Suscribirme · $X cada mes, y abajo Ahorrás $Y"):
  // en suscripción lleva la frecuencia y, si hay tachado, el ahorro por envío.
  ctx.ctaText = function () {
    var lbl = mode === "sub" ? (t.cta_sub || "Suscribirme") : (t.cta_once || "Agregar al carrito");
    var fl = mode === "sub" && sel && sel.freqLabel ? " cada " + sel.freqLabel : "";
    var html = esc(lbl) + ' <span class="rc-cta-price">· ' + esc(fmtARS(view.price)) + esc(fl) + "</span>";
    if (mode === "sub" && view.savingsArs > 0 && !apagado(t.savings_label)) html += '<span class="rc-cta-sub">Ahorrás ' + esc(fmtARS(view.savingsArs)) + " en cada envío</span>";
    return html;
  };
  // Acepta el pack o la posicion. Con el pack usa su indice REAL en plan.packs,
  // que es lo que el checkout necesita para cobrar el correcto cuando hay packs
  // escondidos en este modo.
  ctx.radioAttrs = function (p) {
    var real = (p && typeof p === "object" && Number.isInteger(p.idx)) ? p.idx : p;
    var on = real === idx;
    return ' role="radio" aria-checked="' + (on ? "true" : "false") + '" tabindex="' + (on ? "0" : "-1") + '" data-rc-action="pack" data-rc-value="' + real + '"';
  };
  ctx.modeAttrs = function (m) {
    var on = m === mode;
    return ' type="button" role="radio" aria-checked="' + (on ? "true" : "false") + '" data-rc-action="mode" data-rc-value="' + m + '"';
  };
  ctx.on = function (cond, cls) { return cond ? " " + (cls || "is-on") : ""; };
  // Franja de regalos del pack (22-sept-2026, Thiago: "siempre se deben agregar
  // al bloque de ese pack tal cual en los widgets"). Antes solo la dibujaba v12
  // y en el resto el regalo cargado no aparecia en ningun lado.
  // Renglon del cuadro de suscripcion. Con `sub_hint` cargado manda ese texto;
  // vacio, se arma solo como siempre. 22-sept-2026, Thiago.
  ctx.subHint = function () {
    // Lo que escribe el comerciante manda SIEMPRE, tildado o no (25-sept-2026,
    // Thiago: "acá escribo y no cambia nada"). Antes, con el cuadro tildado se
    // salía por freqText() sin mirar `sub_hint`, así que el campo solo servía
    // con el cuadro apagado: parecía roto.
    if (t.sub_hint) return t.sub_hint;
    if (mode === "sub") return ctx.freqText();
    return "Activalo y te llega solo" +
      (sel && sel.freqLabel ? ", cada " + sel.freqLabel : "") +
      (ctx.disc > 0 ? ", con " + ctx.disc + "% off" : "");
  };

  ctx.giftsHtml = function (p) {
    var gs = (p && Array.isArray(p.gifts)) ? p.gifts : [];
    if (!gs.length) return "";
    return gs.map(function (g) {
      var gi = g && g.image
        ? '<img src="' + esc(g.image) + '" alt="" loading="lazy">'
        : '<span class="rc-gi-x" aria-hidden="true">\uD83C\uDF81</span>';
      var old = g && g.compareAt ? '<s class="rc-gold">' + esc(fmtARS(g.compareAt)) + "</s>" : "";
      // Regalo ficticio (ebook, sorteo): no viaja en la caja, se aclara.
      var nota = g && g.note ? '<small class="rc-gn">' + esc(g.note) + "</small>" : "";
      return '<span class="rc-gift' + (g && g.virtual ? " is-virtual" : "") + '">' + gi +
        '<span class="rc-gt">' + esc(g && g.title ? g.title : "Regalo") + nota + "</span>" + old + "</span>";
    }).join("");
  };

  ctx.trust = function (cls) {
    // Cada modo tiene SUS líneas (21-sept-2026, Thiago). Las de suscripción
    // ("Cancelás cuando quieras") no aplican a una compra suelta y confundían.
    // trust_lines_once viene vacía por defecto: sin cargarla, compra única se ve
    // igual que siempre (solo el candado).
    var src = mode === "sub" ? t.trust_lines : t.trust_lines_once;
    var lines = Array.isArray(src) ? src : [];
    var items = lines.map(function (l) { return '<li><span class="rc-tick">' + SVG_CHECK + "</span>" + esc(l) + "</li>"; }).join("");
    items += '<li><span class="rc-tick">' + SVG_LOCK + "</span>Pago seguro con Mercado Pago</li>";
    return '<ul class="' + (cls || "rc-trust") + '">' + items + "</ul>";
  };
  // Nota libre debajo del bloque, distinta por modo. "" = no se pinta nada.
  ctx.note = function (cls) {
    var txt = mode === "sub" ? t.note_sub : t.note_once;
    if (!txt || !String(txt).trim()) return "";
    return '<p class="' + (cls || "rc-note") + '">' + esc(String(txt).trim()) + "</p>";
  };
  ctx.cta = function (cls) {
    return '<button type="button" class="' + (cls || "rc-cta") + '" data-rc-action="cta" data-rc-mode="' + mode + '">' + ctx.ctaText() + "</button>";
  };
  // Texto propio de UN pack (21-sept-2026, Thiago): "tratamiento bimensual",
  // "tratamiento ultra". Antes el único texto de ese renglón era freq_prefix,
  // igual para todos los packs, así que no se podía diferenciar uno del otro.
  // Vacío = no se pinta nada y el pack queda como antes.
  ctx.packNote = function (p, cls) {
    if (!p) return "";
    // Cada modo muestra SOLO su texto (24-sept-2026, Thiago). Antes, en compra
    // única sin `note_once` se caía al de suscripción, así que un texto como
    // "Prueba inicial" —escrito para el bloque de suscripción— aparecía también
    // en compra única. Vacío ahora es vacío: no se pinta nada.
    var txt = mode === "once" ? p.noteOnce : p.note;
    if (!txt) return "";
    return '<small class="' + (cls || "rc-pnote") + '">' + esc(txt) + "</small>";
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
  // Tamaño (21-sept-2026). 100 = exactamente como se veía antes.
  //  · --rc-fs  escala la LETRA. Va como font-size de la raíz y todo el CSS de
  //    las variantes está en px, así que además se aplica un zoom tipográfico
  //    sobre los textos que heredan (los px siguen firmes donde hace falta).
  //  · --rc-bs  escala el ALTO de las tarjetas (padding), sin tocar la letra.
  //  · --rc-mx  el aire a los costados: 0 = pegado a los bordes.
  var fs = Math.max(80, Math.min(120, Number(vm.scale) || 100)) / 100;
  var bs = Math.max(80, Math.min(120, Number(vm.boxes) || 100)) / 100;
  var bw = Math.max(100, Math.min(300, Number(vm.borders) || 100)) / 100;
  vars += ";--rc-fs:" + fs + ";--rc-bs:" + bs + ";--rc-bw:" + bw;
  return (
    S + "{" + vars + ";font-family:inherit;color:#161616;line-height:1.35;margin:14px 0;text-align:left;position:relative;container-type:inline-size;-webkit-font-smoothing:antialiased}" +
    S + "," + S + " *," + S + " *::before," + S + " *::after{box-sizing:border-box !important}" +
    // Franja de regalos del pack: fondo del color del widget, pegada abajo del
    // bloque (22-sept-2026). Compartida: antes vivia solo dentro de v12.
    S + " .rc-gift{display:flex;align-items:center;gap:11px;background:var(--rc-a-l1);border-top:1px solid var(--rc-a-l2);padding:10px 16px}" +
    S + " .rc-gift img{width:44px;height:44px;border-radius:6px;object-fit:cover;flex:none;background:#fff}" +
    S + " .rc-gi-x{width:44px;height:44px;border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none}" +
    S + " .rc-gt{flex:1;font-size:14px;font-weight:600;line-height:1.3}" +
    S + " .rc-gn{display:block;font-size:11px;color:#6b6b6b;font-weight:600;line-height:1.3;margin-top:1px}" +
    S + " .rc-gold{font-size:13px;color:#8a8a8a;white-space:nowrap}" +
    S + " .rc-mrow .rc-gift," + S + " .rc-erow .rc-gift{flex:0 0 100%;margin:8px -14px -10px;border-radius:0 0 var(--rc-r) var(--rc-r)}" +
    S + " .rc-trg td{padding:0}" +
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
    S + " .rc-cta:active{filter:brightness(.92)}" +
    S + " .rc-cta[disabled]{opacity:.7;cursor:wait}" +
    S + " .rc-cta-price{font-weight:600;opacity:.92}" +
    S + " .rc-cta-sub{display:block;font-size:12px;font-weight:500;opacity:.85;margin-top:3px;letter-spacing:0}" +
    S + " .rc-freq{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;color:#4b4b4b;line-height:1.4}" +
    S + " .rc-freq-ic{color:var(--rc-a);flex-shrink:0;margin-top:2px;display:inline-flex}" +
    S + " .rc-trust{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:#5a5a5a;margin-top:12px}" +
    // Nota libre del comerciante, distinta por modo. Solo existe si la cargó.
    S + " .rc-note{font-size:12px;line-height:1.5;color:#6a6a6a;margin-top:10px}" +
    // Texto propio de cada pack, debajo de su nombre.
    S + " .rc-pnote{display:block;font-size:11.5px;line-height:1.4;color:#7a7a7a;font-weight:500;margin-top:2px}" +
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
    var v = c.v(p), on = p.idx === c.idx;
    return '<div class="rc-pack' + c.on(on) + c.on(!!p.badge, "has-badge") + '"' + c.radioAttrs(p) + ">" +
      (p.badge ? '<span class="rc-ribbon">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-radio" aria-hidden="true"><i></i></span>' +
      (p.image
        ? '<span class="rc-qty rc-qty-img" aria-hidden="true"><img src="' + esc(p.image) + '" alt="" loading="lazy"><b>×' + p.qty + "</b></span>"
        : '<span class="rc-qty" aria-hidden="true">×' + p.qty + "</span>") +
      '<span class="rc-info"><b class="rc-name">' + esc(p.label) + "</b>" + c.packNote(p) +
        '<small class="rc-meta">' + esc([p.qty === 1 ? "1 unidad" : p.qty + " unidades", c.perUnit(p)].filter(Boolean).join(" · ")) + "</small>" +
        (c.savings(p) ? '<span class="rc-save">' + esc(c.savings(p)) + "</span>" : "") +
      "</span>" +
      '<span class="rc-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</span>" +
      c.giftsHtml(p) + "</div>";
  }).join("");

  var modes = c.modes.map(function (m) {
    var on = m === c.mode;
    var price = c.sel ? fmtARS(c.sel[m].price) : "";
    var sub = m === "sub"
      ? c.freqPrefix(c.sel) + " " + (c.sel ? c.sel.freqLabel : "") + " · pausás o cancelás cuando quieras"
      : "Sin renovación automática";
    return '<button class="rc-mode' + c.on(on) + '"' + c.modeAttrs(m) + ">" +
      '<span class="rc-check" aria-hidden="true">' + SVG_CHECK + "</span>" +
      "<span class=\"rc-mode-txt\"><b>" + c.modeLabel(m, true) + "</b><small>" + esc(sub) + "</small></span>" +
      '<b class="rc-mode-price">' + esc(price) + "</b></button>";
  }).join("");

  var html = c.wrap(
    c.headHtml() +
    '<div class="rc-packs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + packs + "</div>" +
    '<div class="rc-modes" role="radiogroup" aria-label="Modo de compra">' + modes + "</div>" +
    c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    // Con foto: el recuadro la muestra y la cantidad baja a una chapita en la esquina.
    S + " .rc-qty-img{position:relative;overflow:visible;background:#fff;border:1px solid #e6e6e6;padding:2px}" +
    S + " .rc-pack.is-on .rc-qty-img{background:#fff;border-color:var(--rc-a)}" +
    S + " .rc-qty-img img{width:100%;height:100%;object-fit:contain;border-radius:calc(var(--rc-r) * .5);display:block}" +
    S + " .rc-qty-img b{position:absolute;right:-5px;bottom:-5px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:var(--rc-a);color:var(--rc-on-a);font-size:10.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}" +
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
    var v = c.v(p), on = p.idx === c.idx;
    var meta = [c.perUnit(p), c.mode === "sub" ? "cada " + p.freqLabel : ""].filter(Boolean).join(" · ");
    return '<div class="rc-row' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      '<span class="rc-dot" aria-hidden="true"></span>' +
      '<span class="rc-row-main"><span class="rc-row-top"><b>' + esc(p.label) + "</b>" + (p.badge ? '<span class="rc-tag">' + esc(p.badge) + "</span>" : "") + "</span>" + c.packNote(p) +
        (meta ? "<small>" + esc(meta) + "</small>" : "") + "</span>" +
      '<span class="rc-row-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + (c.savings(p) ? "<em>" + esc(c.savings(p)) + "</em>" : "") + "</span>" +
      c.giftsHtml(p) + "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-top">' + (t.headline ? "<h3>" + esc(t.headline) + "</h3>" : "") +
    '<div class="rc-tabs" role="radiogroup" aria-label="Modo de compra">' + tabs + "</div></div>" +
    '<div class="rc-rows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
// v03 · Compacto: píldoras chicas con la cantidad y el precio. Es la única
// variante SIN el texto propio del pack (packNote): no entra en una píldora de
// 64px sin romper la grilla. Quien lo necesite tiene las otras once.
function v03(c) {
  var S = c.S, t = c.t;
  var pills = c.packs.map(function (p, i) {
    var v = c.v(p);
    return '<div class="rc-pill' + c.on(p.idx === c.idx) + '"' + c.radioAttrs(p) + ">" +
      (p.image ? '<img class="rc-pill-img" src="' + esc(p.image) + '" alt="" loading="lazy">' : "") +
      "<b>" + p.qty + "</b>" +
      (v.savingsPct ? "<small>−" + v.savingsPct + "%</small>" : "<small>&nbsp;</small>") +
      (p.badge ? '<span class="rc-pill-badge">' + esc(p.badge) + "</span>" : "") + c.giftsHtml(p) + "</div>";
  }).join("");
  var other = c.mode === "sub" ? "once" : "sub";
  var switchHtml =
    '<div class="rc-sw-row">' +
      '<button type="button" class="rc-sw' + c.on(c.mode === "sub") + '" role="switch" aria-checked="' + (c.mode === "sub" ? "true" : "false") + '" aria-label="' + esc(t.sub_label) + '" data-rc-action="mode" data-rc-value="' + other + '"><i></i></button>' +
      '<span class="rc-sw-txt"><b>' + c.modeLabel("sub", true) + (c.disc > 0 ? " extra" : "") + "</b><small>" +
        esc(c.subHint()) +
      "</small></span></div>";
  var meta = [c.perUnit(c.sel || { sub: {}, once: {} }), c.savings(c.sel || {})].filter(Boolean);
  var html = c.wrap(
    '<div class="rc-top">' + (t.headline ? '<span class="rc-lbl">' + esc(t.headline) + "</span>" : "") + '<span class="rc-mode-lbl">' + c.modeLabel(c.mode) + "</span></div>" +
    '<div class="rc-pills" role="radiogroup" aria-label="' + esc(t.headline) + '">' + pills + "</div>" +
    '<div class="rc-price-block"><span class="rc-big">' + esc(fmtARS(c.view.price)) + "</span>" + c.compareHtml(c.sel || { sub: {}, once: {} }) +
      (meta.length ? '<span class="rc-meta">' + meta.map(function (m, k) { return k === 1 ? '<em class="rc-save">' + esc(m) + "</em>" : esc(m); }).join(" · ") + "</span>" : "") + "</div>" +
    switchHtml + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    // Foto del pack arriba del número: la pastilla se agranda sola.
    S + " .rc-pill-img{width:100%;max-width:46px;height:34px;object-fit:contain;display:block;margin:0 auto 4px;border-radius:5px;background:#fff}" +
    S + " .rc-pill.is-on .rc-pill-img{background:#fff;padding:1px}" +
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
    var on = p.idx === c.idx;
    return '<tr class="rc-tr' + c.on(on) + '"' + c.radioAttrs(p) + '><th scope="row" class="rc-td-pack"><span class="rc-dot" aria-hidden="true"></span><span><b>' + esc(p.label) + "</b>" + c.packNote(p) +
      (p.badge ? '<small class="rc-badge">' + esc(p.badge) + "</small>" : "") + "</span></th>" +
      cols.map(function (m) {
        var v = p[m], cur = on && m === c.mode;
        return '<td class="rc-td' + c.on(cur, "is-cur") + c.on(m === c.mode, "is-col") + '" data-rc-action="mode" data-rc-value="' + m + '"><b>' + esc(fmtARS(v.price)) + "</b>" +
          (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") +
          (m === "sub" ? "<small>cada " + esc(p.freqLabel) + "</small>" : (c.showPerUnit ? "<small>" + esc(c.perUnit(p, m)) + "</small>" : "")) + "</td>";
      }).join("") + "</tr>" +
      (c.giftsHtml(p) ? '<tr class="rc-trg"' + c.radioAttrs(p) + '><td colspan="' + (cols.length + 1) + '">' + c.giftsHtml(p) + "</td></tr>" : "");
  }).join("");
  var summary = c.sel
    ? '<div class="rc-sum"><span><b>' + esc(c.sel.label) + "</b> · " + c.modeLabel(c.mode) + "</span><span class=\"rc-sum-price\">" + c.compareHtml(c.sel) + "<b>" + esc(fmtARS(c.view.price)) + "</b></span></div>"
    : "";
  var html = c.wrap(
    (t.headline ? '<h3 class="rc-h">' + esc(t.headline) + "</h3>" : "") +
    '<div class="rc-scroll"><table class="rc-table" role="radiogroup" aria-label="' + esc(t.headline) + '"><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table></div>" +
    summary + c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    var v = c.v(p), on = p.idx === c.idx;
    var meta = [c.perUnit(p), c.mode === "sub" ? c.freqPrefix(p) + " " + p.freqLabel : ""].filter(Boolean).join(" · ");
    return '<div class="rc-card' + c.on(on) + c.on(!!p.image, "has-img") + '"' + c.radioAttrs(p) + ">" +
      '<div class="rc-side' + c.on(!v.savingsPct || !c.savings(p), "is-empty") + '">' + (v.savingsPct && c.savings(p) ? "<span>Ahorrás</span><b>" + v.savingsPct + "%</b>" : "<b>×" + p.qty + "</b>") + "</div>" +
      (p.image ? '<img class="rc-card-img" src="' + esc(p.image) + '" alt="" loading="lazy">' : "") +
      '<div class="rc-body"><div class="rc-card-top"><b class="rc-card-name">' + esc(p.label) + "</b>" + (p.badge ? '<span class="rc-badge">' + esc(p.badge) + "</span>" : "") + "</div>" + c.packNote(p) +
        '<div class="rc-card-price"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</div>" +
        (meta ? "<small>" + esc(meta) + "</small>" : "") + "</div>" +
      '<span class="rc-tick2" aria-hidden="true">' + SVG_CHECK + "</span>" +
      c.giftsHtml(p) + "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-top">' + (t.headline ? "<h3>" + esc(t.headline) + "</h3>" : "") +
    '<div class="rc-segs" role="radiogroup" aria-label="Modo de compra">' + seg + "</div></div>" +
    '<div class="rc-cards" role="radiogroup" aria-label="' + esc(t.headline) + '">' + cards + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    // Foto del pack entre la franja de ahorro y el texto.
    S + " .rc-card-img{width:56px;height:56px;object-fit:cover;flex:none;align-self:center;border-radius:9px;background:#f4f4f4;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}" +
    S + " .rc-card.has-img{grid-template-columns:64px 56px minmax(0,1fr) 28px}" +
    S + " .rc-card .rc-gift{grid-column:1/-1}" +
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
    "@container (max-width:359px){" + S + " .rc-card{grid-template-columns:54px minmax(0,1fr) 24px;gap:0 10px}" + S + " .rc-card.has-img{grid-template-columns:54px 48px minmax(0,1fr) 24px}" + S + " .rc-card-img{width:48px;height:48px}" + S + " .rc-side b{font-size:17px}" + S + " .rc-card-price b{font-size:19px}" + S + " .rc-tick2{margin-right:8px;width:20px;height:20px}" + "}";
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
    var v = c.v(p), on = p.idx === c.idx;
    return '<div class="rc-mrow' + c.on(on) + '"' + c.radioAttrs(p) + '><span class="rc-mark" aria-hidden="true"></span>' +
      '<span class="rc-mname"><b>' + esc(p.label) + "</b>" + (p.badge ? "<em>" + esc(p.badge) + "</em>" : "") + c.packNote(p) + "</span>" +
      '<span class="rc-mprice">' + c.compareHtml(p) + "<b>" + esc(fmtARS(v.price)) + "</b></span>" + c.giftsHtml(p) + "</div>";
  }).join("");
  var detail = c.sel ? [c.perUnit(c.sel), c.savings(c.sel)].filter(Boolean).join(" · ") : "";
  var html = c.wrap(
    '<div class="rc-mhead">' + (t.headline ? '<span class="rc-eyebrow">' + esc(t.headline) + "</span>" : "") + '<div class="rc-links" role="radiogroup" aria-label="Modo de compra">' + links + "</div></div>" +
    '<div class="rc-mrows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div>" +
    (detail ? '<p class="rc-mdetail">' + esc(detail) + "</p>" : "") +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    return '<div class="rc-seg' + c.on(p.idx === c.idx) + '"' + c.radioAttrs(p) + "><b>" + p.qty + "</b><small>" + esc(p.qty === 1 ? "unidad" : "unidades") + "</small>" +
      (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") + (p.badge ? '<span class="rc-flag">' + esc(p.badge) + "</span>" : "") + c.giftsHtml(p) + "</div>";
  }).join("");
  var chips = c.modes.map(function (m) {
    return '<button class="rc-chip' + c.on(m === c.mode) + '"' + c.modeAttrs(m) + ">" + c.modeLabel(m, true) + "</button>";
  }).join("");
  var html = c.wrap(
    (t.headline ? '<h3 class="rc-h">' + esc(t.headline) + "</h3>" : "") +
    '<div class="rc-segs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + segs + "</div>" +
    '<div class="rc-pcard">' +
      '<div class="rc-chips" role="radiogroup" aria-label="Modo de compra">' + chips + "</div>" +
      '<div class="rc-pcard-row"><span class="rc-pcard-name">' + esc(c.sel ? c.sel.label : "") + (c.sel ? c.packNote(c.sel) : "") + '</span><span class="rc-pcard-price">' + c.compareHtml(c.sel || { sub: {}, once: {} }) + "<b>" + esc(fmtARS(c.view.price)) + "</b></span></div>" +
      '<div class="rc-pcard-meta">' + [c.perUnit(c.sel || { sub: {}, once: {} }) ? "<span>" + esc(c.perUnit(c.sel)) + "</span>" : "", c.savings(c.sel || {}) ? '<span class="rc-save">' + esc(c.savings(c.sel)) + "</span>" : ""].filter(Boolean).join("") + "</div>" +
      c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' +
    "</div>" + c.trust() + c.note()
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
    var v = c.v(p), on = p.idx === c.idx;
    return '<div class="rc-dc' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      (p.badge ? '<span class="rc-dbadge">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-dring" aria-hidden="true"><i></i></span>' +
      '<span class="rc-dinfo"><b>' + esc(p.label) + "</b><small>" + esc([p.qty === 1 ? "1 unidad" : p.qty + " unidades", c.perUnit(p)].filter(Boolean).join(" · ")) + "</small>" + c.packNote(p) + "</span>" +
      '<span class="rc-dprice"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + (v.savingsPct ? "<em>−" + v.savingsPct + "%</em>" : "") + "</span>" +
      c.giftsHtml(p) + "</div>";
  }).join("");
  var html = c.wrap(
    '<div class="rc-dtop">' + (t.headline ? "<h3>" + esc(t.headline) + "</h3>" : "") + '<div class="rc-mps" role="radiogroup" aria-label="Modo de compra">' + pills + "</div></div>" +
    '<div class="rc-dcs" role="radiogroup" aria-label="' + esc(t.headline) + '">' + cards + "</div>" +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    var v = c.v(p), on = p.idx === c.idx;
    return '<div class="rc-tile' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      (v.savingsPct ? '<span class="rc-bubble">−' + v.savingsPct + "%</span>" : "") +
      (p.image
        ? '<span class="rc-tqty rc-tqty-img"><img src="' + esc(p.image) + '" alt="" loading="lazy"><b>' + p.qty + "</b></span>"
        : '<span class="rc-tqty">' + p.qty + "</span>") +
      '<span class="rc-tlbl">' + esc(p.label) + c.packNote(p) + "</span>" +
      '<span class="rc-tprice">' + esc(fmtARS(v.price)) + "</span>" + c.compareHtml(p, null, "rc-told") +
      (p.badge ? '<span class="rc-tbadge">' + esc(p.badge) + "</span>" : "") +
      c.giftsHtml(p) + "</div>";
  }).join("");
  var detail = c.sel ? [c.perUnit(c.sel), c.savings(c.sel)].filter(Boolean).join(" · ") : "";
  var html = c.wrap(
    (t.headline ? '<h3 class="rc-h">' + esc(t.headline) + "</h3>" : "") +
    '<div class="rc-pts" role="radiogroup" aria-label="Modo de compra">' + toggle + "</div>" +
    '<div class="rc-tiles" role="radiogroup" aria-label="' + esc(t.headline) + '">' + tiles + "</div>" +
    (detail ? '<p class="rc-detail">' + esc(detail) + "</p>" : "") +
    c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
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
    // Con foto: el círculo la muestra y la cantidad queda como chapita.
    S + " .rc-tqty-img{position:relative;overflow:visible;background:#fff;border:1.5px solid var(--rc-a-l2);padding:3px}" +
    S + " .rc-tile.is-on .rc-tqty-img{background:#fff;border-color:var(--rc-a)}" +
    S + " .rc-tqty-img img{width:100%;height:100%;object-fit:contain;border-radius:50%;display:block}" +
    S + " .rc-tqty-img b{position:absolute;right:-4px;bottom:-4px;min-width:19px;height:19px;padding:0 5px;border-radius:10px;background:var(--rc-a);color:var(--rc-on-a);font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}" +
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
    var v = c.v(p), on = p.idx === c.idx;
    return '<div class="rc-erow' + c.on(on) + '"' + c.radioAttrs(p) + '><span class="rc-edot" aria-hidden="true"></span>' +
      '<span class="rc-ename"><b>' + esc(p.label) + "</b>" + (p.badge ? "<em>" + esc(p.badge) + "</em>" : "") + (c.showPerUnit ? "<small>" + esc(c.perUnit(p)) + "</small>" : "") + c.packNote(p) + "</span>" +
      '<span class="rc-eprice"><b>' + esc(fmtARS(v.price)) + "</b>" + c.compareHtml(p) + "</span>" + c.giftsHtml(p) + "</div>";
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
      '<div class="rc-ed-l">' + (t.headline ? '<h3 class="rc-eh">' + esc(t.headline) + "</h3>" : "") +
        '<div class="rc-etabs" role="radiogroup" aria-label="Modo de compra">' + tabs + "</div>" +
        '<div class="rc-erows" role="radiogroup" aria-label="' + esc(t.headline) + '">' + rows + "</div></div>" +
      '<aside class="rc-ed-r"><div class="rc-sum">' +
        '<small class="rc-sum-eyebrow">Tu pedido</small>' +
        '<b class="rc-sum-title">' + esc(sel ? sel.label : "") + (sel && c.savings(sel) ? ' <em class="rc-sum-save">' + esc(c.savings(sel)) + "</em>" : "") + "</b>" +
        '<div class="rc-lines">' + lines + "</div>" +
        c.freqLine() + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note() +
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

// Respaldo cuando el pack todavía no tiene foto: en vez de un "×3" gigante,
// dibujamos un marquito de imagen por unidad (hasta 3) y, si el pack es más
// grande, un "+N". Así se entiende de una que ahí va una foto y cuántas
// unidades trae el pack.
function phFallback(qty) {
  // UN marco con el ícono de imagen y la cantidad como chapita en la esquina.
  // Antes se repetía un marquito por unidad y se leía como "este pack trae 2
  // fotos" en vez de "acá va la foto del pack de 2".
  return '<span class="rc-ph rc-ph-x" aria-hidden="true">' + SVG_PHOTO +
    '<b class="rc-ph-q">×' + (qty || 1) + "</b></span>";
}

// ═════════════════════════════════════════════════════════════════════
// v11 — Foto (packs con imagen + switch de suscripción)
// Formato de los bundles que usan las tiendas de performance (Kaching y
// compañía): una fila por pack con la FOTO que sube el comerciante, cinta
// arriba a la derecha, precio por unidad en pill y el total a la derecha.
// El switch de suscripción va ENTRE los packs y el CTA, y arranca en el modo
// que tenga configurado la tienda (por defecto compra única).
// ═════════════════════════════════════════════════════════════════════
function v11(c) {
  var S = c.S, t = c.t;

  var packs = c.packs.map(function (p, i) {
    var v = c.v(p), on = p.idx === c.idx;
    var img = p.image
      ? '<span class="rc-ph"><img src="' + esc(p.image) + '" alt="" loading="lazy"></span>'
      : phFallback(p.qty);
    var freq = c.mode === "sub" && p.freqLabel
      ? '<span class="rc-fq">' + esc(c.freqPrefix(p) + " " + p.freqLabel) + "</span>"
      : "";
    return '<div class="rc-fp' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      (p.badge ? '<span class="rc-ribbon">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-fp-row">' + img +
        '<span class="rc-fp-mid"><b class="rc-fp-name">' + esc(p.label) + "</b>" + c.packNote(p) +
          '<span class="rc-chips">' +
            (c.perUnit(p) ? '<span class="rc-pill">' + esc(c.perUnit(p)) + "</span>" : "") + freq +
          "</span>" +
          (c.savings(p) ? '<span class="rc-fp-save">' + esc(c.savings(p)) + "</span>" : "") +
        "</span>" +
        '<span class="rc-fp-price">' + c.compareHtml(p) + "<b>" + esc(fmtARS(v.price)) + "</b></span>" +
      "</span>" + c.giftsHtml(p) + "</div>";
  }).join("");

  var other = c.mode === "sub" ? "once" : "sub";
  var sw =
    '<button type="button" class="rc-swrow' + c.on(c.mode === "sub") + '" role="switch" aria-checked="' +
      (c.mode === "sub" ? "true" : "false") + '" data-rc-action="mode" data-rc-value="' + other + '">' +
      '<span class="rc-sw" aria-hidden="true"><i></i></span>' +
      '<span class="rc-sw-txt"><b>' + c.modeLabel("sub", true) + "</b><small>" +
        esc(c.subHint()) +
      "</small></span></button>";

  var html = c.wrap(
    c.headHtml() +
    '<div class="rc-fps" role="radiogroup" aria-label="' + esc(t.headline || "Elegí tu pack") + '">' + packs + "</div>" +
    sw + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
  );

  var css =
    S + " .rc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}" +
    S + " .rc-head::before," + S + " .rc-head::after{content:'';flex:1;height:1px;background:#e4e4e4}" +
    S + " .rc-head h3{font-size:13px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}" +
    S + " .rc-fps{display:flex;flex-direction:column;gap:26px;margin-bottom:18px}" +
    S + " .rc-fp{position:relative;border:1.5px solid #e1e1e1;border-radius:var(--rc-r);background:#fff;cursor:pointer;transition:border-color .2s,box-shadow .2s}" +
    S + " .rc-fp:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-fp.is-on{border:2.5px solid var(--rc-a);box-shadow:0 2px 10px var(--rc-a-l2)}" +
    S + " .rc-ribbon{position:absolute;top:-14px;right:12px;background:var(--rc-a);color:var(--rc-on-a);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:7px;white-space:nowrap;max-width:calc(100% - 24px);overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-fp-row{display:flex;align-items:center;gap:13px;padding:18px 16px}" +
    S + " .rc-ph{width:96px;flex:none;display:flex;align-items:center;justify-content:center}" +
    S + " .rc-ph img{width:84px;height:84px;max-width:100%;object-fit:cover;display:block;border-radius:10px;background:#f4f4f4;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}" +
    S + " .rc-ph-x{position:relative;width:64px;height:64px;border-radius:9px;border:1.5px dashed var(--rc-a-l3);background:var(--rc-a-l1);color:var(--rc-a-t);display:flex;align-items:center;justify-content:center;margin:0 auto}" +
    S + " .rc-ph-x svg{width:24px;height:24px;display:block;opacity:.85}" +
    S + " .rc-ph-q{position:absolute;right:-5px;bottom:-5px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--rc-a);color:var(--rc-on-a);font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}" +
    S + " .rc-fp-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}" +
    S + " .rc-fp-name{font-size:18px;font-weight:800;line-height:1.2}" +
    S + " .rc-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}" +
    S + " .rc-pill{background:#f3f3f3;font-size:13px;padding:5px 11px;border-radius:20px;font-weight:600}" +
    S + " .rc-fq{background:var(--rc-a-l1);color:var(--rc-a-t);border:1px solid var(--rc-a-l2);font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:20px}" +
    S + " .rc-fp-save{font-size:13px;font-weight:800;color:var(--rc-ok);margin-top:7px}" +
    S + " .rc-gn{display:block;font-size:11px;color:#6b6b6b;font-weight:600;line-height:1.3;margin-top:1px}" +
    S + " .rc-fp-price{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px}" +
    S + " .rc-fp-price b{font-size:22px;font-weight:800;white-space:nowrap}" +
    S + " .rc-fp-price .rc-old{font-size:13px}" +
    S + " .rc-swrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:2px solid #e1e1e1;border-radius:var(--rc-r);background:#fff;padding:13px 15px;margin-bottom:6px;transition:border-color .2s,background .2s}" +
    S + " .rc-swrow.is-on{border-color:var(--rc-a);background:var(--rc-a-l1)}" +
    S + " .rc-sw{position:relative;flex-shrink:0;width:46px;height:27px;border-radius:30px;background:#cfcfcf;transition:background .2s}" +
    S + " .rc-sw i{position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}" +
    S + " .rc-swrow.is-on .rc-sw{background:var(--rc-a)}" +
    S + " .rc-swrow.is-on .rc-sw i{transform:translateX(19px)}" +
    S + " .rc-sw-txt{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-sw-txt b{font-size:14.5px;font-weight:800}" +
    S + " .rc-sw-txt small{font-size:12px;color:#555;line-height:1.35}" +
    S + " .rc-cta{margin-top:12px !important;padding:18px 14px;font-size:18px}" +
    "@container (max-width:379px){" +
      S + " .rc-fp-row{gap:10px;padding:15px 12px}" +
      S + " .rc-ph{width:70px}" + S + " .rc-ph img{width:64px;height:64px}" +
      S + " .rc-fp-name{font-size:16px}" + S + " .rc-fp-price b{font-size:19px}" +
    "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v13 — Foto + check (22-sept-2026, Thiago)
// Igual que v11 (una fila por pack con la foto), pero la suscripción NO se
// activa con un switch: es un cuadrado de tilde como el de v01, dentro de un
// recuadro de línea punteada. El punteado lo despega de los packs y lo hace
// leer como algo que se AGREGA, no como una opción más de la lista.
// ═════════════════════════════════════════════════════════════════════
function v13(c) {
  var S = c.S, t = c.t;

  var packs = c.packs.map(function (p, i) {
    var v = c.v(p), on = p.idx === c.idx;
    var img = p.image
      ? '<span class="rc-ph"><img src="' + esc(p.image) + '" alt="" loading="lazy"></span>'
      : phFallback(p.qty);
    var freq = c.mode === "sub" && p.freqLabel
      ? '<span class="rc-fq">' + esc(c.freqPrefix(p) + " " + p.freqLabel) + "</span>"
      : "";
    return '<div class="rc-fp' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      (p.badge ? '<span class="rc-ribbon">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-fp-row">' + img +
        '<span class="rc-fp-mid"><b class="rc-fp-name">' + esc(p.label) + "</b>" + c.packNote(p) +
          '<span class="rc-chips">' +
            (c.perUnit(p) ? '<span class="rc-pill">' + esc(c.perUnit(p)) + "</span>" : "") + freq +
          "</span>" +
          (c.savings(p) ? '<span class="rc-fp-save">' + esc(c.savings(p)) + "</span>" : "") +
        "</span>" +
        '<span class="rc-fp-price">' + c.compareHtml(p) + "<b>" + esc(fmtARS(v.price)) + "</b></span>" +
      "</span>" + c.giftsHtml(p) + "</div>";
  }).join("");

  // El cuadrado de tilde: mismo gesto que v01, pero cuadrado y punteado.
  var other = c.mode === "sub" ? "once" : "sub";
  var sub =
    '<button type="button" class="rc-subbox' + c.on(c.mode === "sub") + '" role="checkbox" aria-checked="' +
      (c.mode === "sub" ? "true" : "false") + '" data-rc-action="mode" data-rc-value="' + other + '">' +
      '<span class="rc-sqr" aria-hidden="true">' + SVG_CHECK + "</span>" +
      '<span class="rc-sub-txt"><b>' + c.modeLabel("sub", true) + "</b><small>" +
        esc(c.subHint()) +
      "</small></span></button>";

  var html = c.wrap(
    c.headHtml() +
    '<div class="rc-fps" role="radiogroup" aria-label="' + esc(t.headline || "Elegí tu pack") + '">' + packs + "</div>" +
    sub + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
  );

  var css =
    S + " .rc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}" +
    S + " .rc-head::before," + S + " .rc-head::after{content:'';flex:1;height:1px;background:#e4e4e4}" +
    S + " .rc-head h3{font-size:13px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}" +
    S + " .rc-fps{display:flex;flex-direction:column;gap:26px;margin-bottom:18px}" +
    S + " .rc-fp{position:relative;border:1.5px solid #e1e1e1;border-radius:var(--rc-r);background:#fff;cursor:pointer;transition:border-color .2s,box-shadow .2s}" +
    S + " .rc-fp:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-fp.is-on{border:2.5px solid var(--rc-a);box-shadow:0 2px 10px var(--rc-a-l2)}" +
    S + " .rc-ribbon{position:absolute;top:-14px;right:12px;background:var(--rc-a);color:var(--rc-on-a);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:7px;white-space:nowrap;max-width:calc(100% - 24px);overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-fp-row{display:flex;align-items:center;gap:13px;padding:18px 16px}" +
    S + " .rc-ph{width:96px;flex:none;display:flex;align-items:center;justify-content:center}" +
    S + " .rc-ph img{width:84px;height:84px;max-width:100%;object-fit:cover;display:block;border-radius:10px;background:#f4f4f4;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}" +
    S + " .rc-ph-x{position:relative;width:64px;height:64px;border-radius:9px;border:1.5px dashed var(--rc-a-l3);background:var(--rc-a-l1);color:var(--rc-a-t);display:flex;align-items:center;justify-content:center;margin:0 auto}" +
    S + " .rc-ph-x svg{width:24px;height:24px;display:block;opacity:.85}" +
    S + " .rc-ph-q{position:absolute;right:-5px;bottom:-5px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--rc-a);color:var(--rc-on-a);font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}" +
    S + " .rc-fp-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:0}" +
    S + " .rc-fp-name{font-size:18px;font-weight:800;line-height:1.2}" +
    S + " .rc-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}" +
    S + " .rc-pill{background:#f3f3f3;font-size:13px;padding:5px 11px;border-radius:20px;font-weight:600}" +
    S + " .rc-fq{background:var(--rc-a-l1);color:var(--rc-a-t);border:1px solid var(--rc-a-l2);font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:20px}" +
    S + " .rc-fp-save{font-size:13px;font-weight:800;color:var(--rc-ok);margin-top:7px}" +
    S + " .rc-fp-price{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px}" +
    S + " .rc-fp-price b{font-size:22px;font-weight:800;white-space:nowrap}" +
    S + " .rc-fp-price .rc-old{font-size:13px}" +
    // El recuadro punteado + el cuadrado de tilde.
    S + " .rc-subbox{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:2px dashed #cbcbcb;border-radius:var(--rc-r);background:#fff;padding:14px 15px;margin-bottom:6px;cursor:pointer;transition:border-color .2s,background .2s}" +
    S + " .rc-subbox:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-subbox.is-on{border-color:var(--rc-a);background:var(--rc-a-l1)}" +
    S + " .rc-sqr{width:26px;height:26px;flex-shrink:0;border:2px solid #cfcfcf;border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--rc-on-a);background:#fff;transition:all .2s}" +
    S + " .rc-sqr svg{opacity:0;transform:scale(.4);transition:all .18s}" +
    S + " .rc-subbox.is-on .rc-sqr{border-color:var(--rc-a);background:var(--rc-a)}" +
    S + " .rc-subbox.is-on .rc-sqr svg{opacity:1;transform:scale(1)}" +
    S + " .rc-sub-txt{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-sub-txt b{font-size:14.5px;font-weight:800}" +
    S + " .rc-sub-txt small{font-size:12px;color:#555;line-height:1.35}" +
    S + " .rc-cta{margin-top:12px !important;padding:18px 14px;font-size:18px}" +
    "@container (max-width:379px){" +
      S + " .rc-fp-row{gap:10px;padding:15px 12px}" +
      S + " .rc-ph{width:70px}" + S + " .rc-ph img{width:64px;height:64px}" +
      S + " .rc-fp-name{font-size:16px}" + S + " .rc-fp-price b{font-size:19px}" +
    "}";
  return { html: html, css: css };
}

// ═════════════════════════════════════════════════════════════════════
// v12 — Foto + regalos (v11 con la franja de bonus debajo de cada pack)
// Igual que v11, pero cada pack puede mostrar los regalos que incluye
// (pack.gifts: [{ title, image, compare_at_ars }]). Es el formato de los
// bundles con "+ GRATIS ..." que usan las tiendas de suplementos.
// ═════════════════════════════════════════════════════════════════════
function v12(c) {
  var S = c.S, t = c.t;

  var packs = c.packs.map(function (p, i) {
    var v = c.v(p), on = p.idx === c.idx;
    var img = p.image
      ? '<span class="rc-ph"><img src="' + esc(p.image) + '" alt="" loading="lazy"></span>'
      : phFallback(p.qty);
    var freq = c.mode === "sub" && p.freqLabel
      ? '<span class="rc-fq">' + esc(c.freqPrefix(p) + " " + p.freqLabel) + "</span>"
      : "";
    var gifts = (Array.isArray(p.gifts) ? p.gifts : []).map(function (g) {
      var gi = g && g.image
        ? '<img src="' + esc(g.image) + '" alt="" loading="lazy">'
        : '<span class="rc-gi-x" aria-hidden="true">🎁</span>';
      var old = g && g.compareAt ? '<s class="rc-gold">' + esc(fmtARS(g.compareAt)) + "</s>" : "";
      // Regalo ficticio (ebook, sorteo): no es un producto que viaje en la caja,
      // asi que se aclara debajo para no prometer un envio que no existe.
      var nota = g && g.note ? '<small class="rc-gn">' + esc(g.note) + "</small>" : "";
      return '<span class="rc-gift' + (g && g.virtual ? " is-virtual" : "") + '">' + gi +
        '<span class="rc-gt">' + esc(g && g.title ? g.title : "Regalo") + nota + "</span>" + old + "</span>";
    }).join("");
    return '<div class="rc-fp' + c.on(on) + '"' + c.radioAttrs(p) + ">" +
      (p.badge ? '<span class="rc-ribbon">' + esc(p.badge) + "</span>" : "") +
      '<span class="rc-fp-row">' + img +
        '<span class="rc-fp-mid"><b class="rc-fp-name">' + esc(p.label) + "</b>" + c.packNote(p) +
          '<span class="rc-chips">' +
            (c.perUnit(p) ? '<span class="rc-pill">' + esc(c.perUnit(p)) + "</span>" : "") + freq +
          "</span>" +
          (c.savings(p) ? '<span class="rc-fp-save">' + esc(c.savings(p)) + "</span>" : "") +
        "</span>" +
        '<span class="rc-fp-price">' + c.compareHtml(p) + "<b>" + esc(fmtARS(v.price)) + "</b></span>" +
      "</span>" + gifts + "</div>";
  }).join("");

  var other = c.mode === "sub" ? "once" : "sub";
  var sw =
    '<button type="button" class="rc-swrow' + c.on(c.mode === "sub") + '" role="switch" aria-checked="' +
      (c.mode === "sub" ? "true" : "false") + '" data-rc-action="mode" data-rc-value="' + other + '">' +
      '<span class="rc-sw" aria-hidden="true"><i></i></span>' +
      '<span class="rc-sw-txt"><b>' + c.modeLabel("sub", true) + "</b><small>" +
        esc(c.subHint()) +
      "</small></span></button>";

  var html = c.wrap(
    c.headHtml() +
    '<div class="rc-fps" role="radiogroup" aria-label="' + esc(t.headline || "Elegí tu pack") + '">' + packs + "</div>" +
    sw + c.cta() + '<div class="rc-err" role="alert"></div>' + c.trust() + c.note()
  );

  var css =
    S + " .rc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}" +
    S + " .rc-head::before," + S + " .rc-head::after{content:'';flex:1;height:1px;background:#e4e4e4}" +
    S + " .rc-head h3{font-size:13px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap}" +
    S + " .rc-fps{display:flex;flex-direction:column;gap:26px;margin-bottom:18px}" +
    S + " .rc-fp{position:relative;border:1.5px solid #e1e1e1;border-radius:var(--rc-r);background:#fff;cursor:pointer;overflow:hidden;transition:border-color .2s,box-shadow .2s}" +
    S + " .rc-fp:hover{border-color:var(--rc-a-l3)}" +
    S + " .rc-fp.is-on{border:2.5px solid var(--rc-a);box-shadow:0 2px 10px var(--rc-a-l2)}" +
    S + " .rc-ribbon{position:absolute;top:-14px;right:12px;background:var(--rc-a);color:var(--rc-on-a);font-size:12.5px;font-weight:700;padding:6px 14px;border-radius:7px;white-space:nowrap;z-index:1;max-width:calc(100% - 24px);overflow:hidden;text-overflow:ellipsis}" +
    S + " .rc-fp-row{display:flex;align-items:center;gap:13px;padding:18px 16px}" +
    S + " .rc-ph{width:96px;flex:none;display:flex;align-items:center;justify-content:center}" +
    S + " .rc-ph img{width:84px;height:84px;max-width:100%;object-fit:cover;display:block;border-radius:10px;background:#f4f4f4;box-shadow:inset 0 0 0 1px rgba(0,0,0,.06)}" +
    S + " .rc-ph-x{position:relative;width:64px;height:64px;border-radius:9px;border:1.5px dashed var(--rc-a-l3);background:var(--rc-a-l1);color:var(--rc-a-t);display:flex;align-items:center;justify-content:center;margin:0 auto}" +
    S + " .rc-ph-x svg{width:24px;height:24px;display:block;opacity:.85}" +
    S + " .rc-ph-q{position:absolute;right:-5px;bottom:-5px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:var(--rc-a);color:var(--rc-on-a);font-size:11.5px;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px #fff}" +
    S + " .rc-fp-mid{flex:1;min-width:0;display:flex;flex-direction:column}" +
    S + " .rc-fp-name{font-size:18px;font-weight:800;line-height:1.2}" +
    S + " .rc-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}" +
    S + " .rc-pill{background:#f3f3f3;font-size:13px;padding:5px 11px;border-radius:20px;font-weight:600}" +
    S + " .rc-fq{background:var(--rc-a-l1);color:var(--rc-a-t);border:1px solid var(--rc-a-l2);font-size:12.5px;font-weight:700;padding:5px 11px;border-radius:20px}" +
    S + " .rc-fp-save{font-size:13px;font-weight:800;color:var(--rc-ok);margin-top:7px}" +
    S + " .rc-fp-price{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:2px}" +
    S + " .rc-fp-price b{font-size:22px;font-weight:800;white-space:nowrap}" +
    S + " .rc-fp-price .rc-old{font-size:13px}" +
    S + " .rc-gift{display:flex;align-items:center;gap:11px;background:var(--rc-a-l1);border-top:1px solid var(--rc-a-l2);padding:10px 16px}" +
    S + " .rc-gift img{width:44px;height:44px;border-radius:6px;object-fit:cover;flex:none;background:#fff}" +
    S + " .rc-gi-x{width:44px;height:44px;border-radius:6px;background:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;flex:none}" +
    S + " .rc-gt{flex:1;font-size:14px;font-weight:600;line-height:1.3}" +
    S + " .rc-gold{font-size:13px;color:#8a8a8a;white-space:nowrap}" +
    S + " .rc-swrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:2px solid #e1e1e1;border-radius:var(--rc-r);background:#fff;padding:13px 15px;margin-bottom:6px;transition:border-color .2s,background .2s}" +
    S + " .rc-swrow.is-on{border-color:var(--rc-a);background:var(--rc-a-l1)}" +
    S + " .rc-sw{position:relative;flex-shrink:0;width:46px;height:27px;border-radius:30px;background:#cfcfcf;transition:background .2s}" +
    S + " .rc-sw i{position:absolute;top:3px;left:3px;width:21px;height:21px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}" +
    S + " .rc-swrow.is-on .rc-sw{background:var(--rc-a)}" +
    S + " .rc-swrow.is-on .rc-sw i{transform:translateX(19px)}" +
    S + " .rc-sw-txt{min-width:0;display:flex;flex-direction:column;gap:2px}" +
    S + " .rc-sw-txt b{font-size:14.5px;font-weight:800}" +
    S + " .rc-sw-txt small{font-size:12px;color:#555;line-height:1.35}" +
    S + " .rc-cta{margin-top:12px !important;padding:18px 14px;font-size:18px}" +
    "@container (max-width:379px){" +
      S + " .rc-fp-row{gap:10px;padding:15px 12px}" +
      S + " .rc-ph{width:70px}" + S + " .rc-ph img{width:64px;height:64px}" +
      S + " .rc-fp-name{font-size:16px}" + S + " .rc-fp-price b{font-size:19px}" +
      S + " .rc-gt{font-size:13px}" +
    "}";
  return { html: html, css: css };
}

var RENDERERS = { v01: v01, v02: v02, v03: v03, v04: v04, v05: v05, v06: v06, v07: v07, v08: v08, v09: v09, v10: v10, v11: v11, v12: v12, v13: v13 };

// ─── API ─────────────────────────────────────────────────────────────
// Ajustes de tamaño del comerciante (21-sept-2026, Thiago).
//
// El CSS de las variantes está escrito en px y el MISMO selector tiene medidas
// distintas en cada una (.rc-cta es 16px en v01 y 18px en v05). Listar las
// clases a mano quedaba desincronizado en cuanto alguien tocara una variante,
// así que en vez de enumerar se reescribe el CSS ya generado: cada `font-size`
// en px pasa a calc(<los px de siempre> * var(--rc-fs)), y lo mismo el padding
// de las tarjetas con --rc-bs. Cada variante conserva sus proporciones.
//
// Con los ajustes en su valor por defecto NO se toca nada y el CSS servido
// queda idéntico byte a byte: ninguna tienda cambia de aspecto sola.
var RX_FS = /font-size:\s*([0-9.]+)px/g;
var RX_PAD = /padding:\s*([0-9.]+)px\s+([0-9.]+)px/g;
// Grosor del borde de las tarjetas (22-sept-2026, Thiago). Cubre `border:` y
// `border-top/right/bottom/left:` con la forma "Npx solid ...". Se multiplica
// por --rc-bw, que vale 1 cuando el comerciante no lo toca.
var RX_BW = /border(-top|-right|-bottom|-left)?:\s*([0-9.]+)px\s+solid/g;

function escalarCss(css, fs, bs, bw) {
  var out = css;
  if (bw !== 1) {
    out = out.replace(RX_BW, function (_, lado, px) {
      return "border" + (lado || "") + ":calc(" + px + "px * var(--rc-bw)) solid";
    });
  }
  if (fs !== 1) out = out.replace(RX_FS, function (_, px) { return "font-size:calc(" + px + "px * var(--rc-fs))"; });
  if (bs !== 1) {
    // Solo el padding de dos valores (vertical horizontal): el vertical escala,
    // el horizontal queda igual para no deformar el ancho de las tarjetas.
    out = out.replace(RX_PAD, function (_, v, h) { return "padding:calc(" + v + "px * var(--rc-bs)) " + h + "px"; });
  }
  return out;
}

function edgeCss(S, vm) {
  // Pegado a los bordes del contenedor de la tienda, sin aire a los costados.
  return vm.edge === true ? S + "{margin-left:0;margin-right:0;width:100%}" : "";
}

export function renderBundle(vm, state) {
  vm = vm && typeof vm === "object" ? vm : {};
  if (!RENDERERS[vm.variant]) vm = Object.assign({}, vm, { variant: "v01" });
  var c = buildCtx(vm, state || {});
  var fs = Math.max(80, Math.min(120, Number(vm.scale) || 100)) / 100;
  var bs = Math.max(80, Math.min(120, Number(vm.boxes) || 100)) / 100;
  // 100 = el grosor de siempre, asi que ninguna tienda cambia sola.
  var bw = Math.max(100, Math.min(300, Number(vm.borders) || 100)) / 100;
  if (!c.packs.length) {
    return { html: c.wrap(""), css: escalarCss(baseCss(c.S, vm), fs, bs, bw) + edgeCss(c.S, vm) };
  }
  var out = RENDERERS[vm.variant](c);
  return { html: out.html, css: escalarCss(baseCss(c.S, vm) + out.css, fs, bs, bw) + edgeCss(c.S, vm) };
}

export default renderBundle;
