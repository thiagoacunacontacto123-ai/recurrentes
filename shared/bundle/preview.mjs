#!/usr/bin/env node
// shared/bundle/preview.mjs
//
// Genera shared/bundle/preview.html: las 10 variantes del selector de packs
// lado a lado (grilla de 2 columnas, cada una en una columna de producto
// simulada de 420px), con datos de ejemplo (Lumina) y controles para cambiar
// el acento / radio / ancho en vivo. Autocontenido: sin fetch ni recursos
// externos. Cada widget es interactivo con la MISMA delegación por
// data-rc-action que usa api/widget.js (el HTML de cada estado viene
// precalculado acá, igual que en producción).
//
//   node shared/bundle/preview.mjs   →  shared/bundle/preview.html

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildBundleVM } from "./viewmodel.js";
import { renderBundle, BUNDLE_VARIANTS, paletteVars, esc } from "./templates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "preview.html");

// ─── Datos de ejemplo (Lumina) ───────────────────────────────────────
const SAMPLE_PLAN = {
  id: "plan_demo",
  product_title: "Cápsulas LuminaLabs",
  pricing_mode: "packs",
  frequency_days: 60,
  frequency_scales_with_qty: true,
  discount_pct: 10,
  base_price_ars: 69990,
  packs: [
    { qty: 1, price_ars: 44990, compare_at_ars: 69990,  label: "Pack 2 meses", badge: null,          frequency_days: null, sub_price_ars: null, default: false },
    { qty: 2, price_ars: 59990, compare_at_ars: 89980,  label: "Pack 4 meses", badge: "Más elegido", frequency_days: null, sub_price_ars: null, default: true },
    { qty: 3, price_ars: 74990, compare_at_ars: 134970, label: "Pack 6 meses", badge: "Mejor precio", frequency_days: null, sub_price_ars: null, default: false },
  ],
};
const ACCENT = "#10b981";
const SAMPLE_MERCHANT = {
  widget_color: ACCENT,
  widget_mode_default: "sub",
  widget_mode_order: "sub_first",
  widget_radius: 14,
  widget_show_compare: true,
  widget_show_per_unit: true,
  // widget_texts: sin definir → defaults del SPEC
};
const INITIAL = { mode: "sub", selectedIdx: 1 };
const PALETTES = [
  { name: "Esmeralda", hex: "#10b981" },
  { name: "Rosa Lumina", hex: "#b06571" },
  { name: "Azul", hex: "#2563eb" },
  { name: "Negro", hex: "#111111" },
];

// ─── Precalcular estados por variante ───────────────────────────────
const data = {};
let allCss = "";
for (const v of BUNDLE_VARIANTS) {
  const vm = buildBundleVM({ plan: SAMPLE_PLAN, merchant: { ...SAMPLE_MERCHANT, widget_variant: v.id } });
  const states = {};
  let css = "";
  for (const mode of ["once", "sub"]) {
    for (const p of vm.packs) {
      const r = renderBundle(vm, { mode, selectedIdx: p.idx });
      states[`${mode}:${p.idx}`] = r.html;
      css = r.css;
    }
  }
  allCss += css + "\n";
  data[v.id] = { states, packs: vm.packs.map((p) => ({ idx: p.idx, qty: p.qty })) };
}

const cells = BUNDLE_VARIANTS.map((v, i) => `
    <section class="pv-cell" data-v="${v.id}">
      <header class="pv-cell-head">
        <span class="pv-num">${String(i + 1).padStart(2, "0")}</span>
        <div><h2>${esc(v.name)} <code>${v.id}</code></h2><p>${esc(v.description)}</p></div>
      </header>
      <div class="pv-col"><div class="pv-mount" data-v="${v.id}">${data[v.id].states[`${INITIAL.mode}:${INITIAL.selectedIdx}`]}</div></div>
    </section>`).join("");

const json = JSON.stringify({ data, initial: INITIAL }).replace(/<\//g, "<\\/");

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Recurrentes · Preview de variantes del selector de packs</title>
<style>
  :root { --pv-bg:#f4f4f5; --pv-ink:#161616; --pv-mute:#6b7280; --pv-line:#e5e7eb; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--pv-bg); color:var(--pv-ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased; }
  .pv-top { position:sticky; top:0; z-index:10; background:rgba(255,255,255,.92); backdrop-filter:blur(8px); border-bottom:1px solid var(--pv-line); }
  .pv-top-in { max-width:1180px; margin:0 auto; padding:14px 20px; display:flex; align-items:center; gap:18px; flex-wrap:wrap; }
  .pv-top h1 { font-size:16px; margin:0; letter-spacing:-.2px; }
  .pv-top h1 small { display:block; font-size:12px; font-weight:500; color:var(--pv-mute); margin-top:2px; }
  .pv-ctl { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--pv-mute); }
  .pv-ctl b { color:var(--pv-ink); font-weight:600; }
  .pv-sw { width:26px; height:26px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px #d1d5db; cursor:pointer; padding:0; }
  .pv-sw.is-on { box-shadow:0 0 0 2px var(--pv-ink); }
  .pv-ctl input[type=color] { width:30px; height:26px; border:0; padding:0; background:none; cursor:pointer; }
  .pv-ctl input[type=range] { width:90px; }
  .pv-seg { display:inline-flex; border:1px solid #d1d5db; border-radius:8px; overflow:hidden; }
  .pv-seg button { border:0; background:#fff; padding:5px 10px; font-size:12px; cursor:pointer; color:var(--pv-mute); }
  .pv-seg button.is-on { background:var(--pv-ink); color:#fff; }
  .pv-grid { max-width:1180px; margin:0 auto; padding:24px 20px 60px; display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:26px; }
  @media (max-width: 960px) { .pv-grid { grid-template-columns:1fr; } }
  .pv-cell { background:#fff; border:1px solid var(--pv-line); border-radius:16px; padding:18px 18px 22px; display:flex; flex-direction:column; gap:14px; }
  .pv-cell-head { display:flex; gap:12px; align-items:flex-start; }
  .pv-num { flex-shrink:0; width:30px; height:30px; border-radius:8px; background:var(--pv-ink); color:#fff; font-size:12px; font-weight:700; display:flex; align-items:center; justify-content:center; }
  .pv-cell-head h2 { margin:0; font-size:15px; }
  .pv-cell-head code { font-size:11px; color:var(--pv-mute); font-weight:500; background:#f3f4f6; padding:1px 6px; border-radius:4px; margin-left:4px; }
  .pv-cell-head p { margin:3px 0 0; font-size:12.5px; color:var(--pv-mute); line-height:1.4; }
  /* columna de producto simulada */
  .pv-col { width:var(--pv-w, 420px); max-width:100%; margin:0 auto; border:1px dashed #d1d5db; border-radius:10px; padding:14px; background:#fff; font-family:inherit; }
  .pv-toast { position:fixed; left:50%; bottom:24px; transform:translateX(-50%) translateY(20px); background:var(--pv-ink); color:#fff; font-size:13px; padding:10px 16px; border-radius:10px; opacity:0; transition:all .25s; pointer-events:none; z-index:20; max-width:92vw; }
  .pv-toast.is-on { opacity:1; transform:translateX(-50%) translateY(0); }
  .pv-note { max-width:1180px; margin:0 auto; padding:0 20px; font-size:12.5px; color:var(--pv-mute); }
</style>
<style id="pv-bundle-css">
${allCss}
</style>
</head>
<body>
  <div class="pv-top"><div class="pv-top-in">
    <h1>Selector de packs · 10 variantes<small>Datos de ejemplo: 3 packs ($44.990 / $59.990 / $74.990), suscripción 10% off, frecuencia 60 días × cantidad. Estado inicial: suscripción, pack 2.</small></h1>
    <div class="pv-ctl"><b>Acento</b>
      ${PALETTES.map((p) => `<button class="pv-sw${p.hex === ACCENT ? " is-on" : ""}" title="${esc(p.name)}" data-hex="${p.hex}" style="background:${p.hex}"></button>`).join("")}
      <input type="color" id="pv-color" value="${ACCENT}" title="Color custom">
    </div>
    <div class="pv-ctl"><b>Radio</b><input type="range" id="pv-radius" min="0" max="28" value="14"><span id="pv-radius-v">14px</span></div>
    <div class="pv-ctl"><b>Ancho</b><span class="pv-seg" id="pv-width"><button data-w="420" class="is-on">420</button><button data-w="360">360</button><button data-w="320">320</button></span></div>
    <div class="pv-ctl"><b>Modo</b><span class="pv-seg" id="pv-mode"><button data-m="sub" class="is-on">Suscripción</button><button data-m="once">Una vez</button></span></div>
  </div></div>

  <div class="pv-grid">${cells}
  </div>
  <p class="pv-note">Los widgets son interactivos (packs, modo, teclado). El CTA muestra un aviso en lugar de navegar. Tipografía heredada del contenedor, como en el tema de la tienda.</p>
  <div class="pv-toast" id="pv-toast"></div>
  <style id="pv-pal"></style>

<script>
(function(){
  var PV = ${json};
  var paletteVars = ${paletteVars.toString()};
  var mounts = {};
  Array.prototype.forEach.call(document.querySelectorAll(".pv-mount"), function(m){
    var id = m.getAttribute("data-v");
    mounts[id] = { el: m, state: { mode: PV.initial.mode, idx: PV.initial.selectedIdx }, data: PV.data[id] };
  });
  function paint(mt){ mt.el.innerHTML = mt.data.states[mt.state.mode + ":" + mt.state.idx] || ""; }
  var toastT;
  function toast(msg){ var t = document.getElementById("pv-toast"); t.textContent = msg; t.classList.add("is-on"); clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("is-on"); }, 2600); }

  // Misma delegación que api/widget.js (mountBundle): se aplican TODAS las
  // acciones anidadas del click (pack + mode en la variante Tabla).
  function handle(mt, el, viaKeyboard){
    var changed = false, cta = false, lastAct = "";
    for (var n = el; n && n !== mt.el; n = n.parentNode) {
      var act = n.getAttribute && n.getAttribute("data-rc-action"); if (!act) continue;
      var v = n.getAttribute("data-rc-value");
      if (act === "pack") { var i = parseInt(v, 10); if (i >= 0 && mt.data.states[mt.state.mode + ":" + i] !== undefined && i !== mt.state.idx) { mt.state.idx = i; changed = true; } lastAct = lastAct || act; }
      else if (act === "mode") { if ((v === "sub" || v === "once") && v !== mt.state.mode) { mt.state.mode = v; changed = true; } lastAct = lastAct || act; }
      else if (act === "cta") cta = true;
    }
    if (changed) { paint(mt); if (viaKeyboard) { var f = mt.el.querySelector('[data-rc-action="' + lastAct + '"][aria-checked="true"]'); if (f) f.focus(); } }
    if (cta) {
      var qty = 1; (mt.data.packs || []).forEach(function(p){ if (p.idx === mt.state.idx) qty = p.qty; });
      toast(mt.state.mode === "sub"
        ? "→ Iría a /pages/suscripcion-form?plan=plan_demo&pack=" + mt.state.idx
        : "→ POST /cart/add.js { id: <variant>, quantity: " + qty + " } y abre /cart");
    }
  }
  document.addEventListener("click", function(e){
    var m = e.target.closest ? e.target.closest(".pv-mount") : null; if (!m) return;
    var el = e.target.closest("[data-rc-action]"); if (!el) return;
    handle(mounts[m.getAttribute("data-v")], el, false);
  });
  document.addEventListener("keydown", function(e){
    if (e.key !== "Enter" && e.key !== " ") return;
    var m = e.target.closest ? e.target.closest(".pv-mount") : null; if (!m) return;
    var el = e.target.closest("[data-rc-action]"); if (!el || el.tagName === "BUTTON") return;
    e.preventDefault(); handle(mounts[m.getAttribute("data-v")], el, true);
  });

  // Acento / radio en vivo: una regla con la misma especificidad que la del
  // template, más abajo en el documento → gana.
  var radius = 14, hex = ${JSON.stringify(ACCENT)};
  function applyPal(){
    var vars = paletteVars(hex);
    var s = Object.keys(vars).map(function(k){ return k + ":" + vars[k]; }).join(";");
    document.getElementById("pv-pal").textContent = ".rc-bundle[data-variant]{" + s + ";--rc-r:" + radius + "px}";
    Array.prototype.forEach.call(document.querySelectorAll(".pv-sw"), function(b){ b.classList.toggle("is-on", b.getAttribute("data-hex") === hex); });
    document.getElementById("pv-color").value = hex;
  }
  Array.prototype.forEach.call(document.querySelectorAll(".pv-sw"), function(b){ b.addEventListener("click", function(){ hex = b.getAttribute("data-hex"); applyPal(); }); });
  document.getElementById("pv-color").addEventListener("input", function(e){ hex = e.target.value; applyPal(); });
  document.getElementById("pv-radius").addEventListener("input", function(e){ radius = parseInt(e.target.value, 10) || 0; document.getElementById("pv-radius-v").textContent = radius + "px"; applyPal(); });
  document.getElementById("pv-width").addEventListener("click", function(e){
    var b = e.target.closest("button"); if (!b) return;
    document.documentElement.style.setProperty("--pv-w", b.getAttribute("data-w") + "px");
    Array.prototype.forEach.call(e.currentTarget.querySelectorAll("button"), function(x){ x.classList.toggle("is-on", x === b); });
  });
  document.getElementById("pv-mode").addEventListener("click", function(e){
    var b = e.target.closest("button"); if (!b) return;
    var m = b.getAttribute("data-m");
    Object.keys(mounts).forEach(function(k){ mounts[k].state.mode = m; paint(mounts[k]); });
    Array.prototype.forEach.call(e.currentTarget.querySelectorAll("button"), function(x){ x.classList.toggle("is-on", x === b); });
  });
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, html, "utf8");
console.log(`preview generado: ${OUT} (${(html.length / 1024).toFixed(1)} KB, ${BUNDLE_VARIANTS.length} variantes × ${Object.keys(data.v01.states).length} estados)`);
