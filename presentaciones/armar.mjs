// Pasa un deck de slides (1920×1080, formato del artifact) a UNA página web que
// se puede mandar por link: recurrentesapp.com/presentaciones/<marca>.html
//   node presentaciones/armar.mjs <carpeta-del-deck> <salida.html>
// Saca las <aside> (notas de orador: NO van al cliente) y reemplaza los tags
// propios del editor (x-shape, x-icon) por HTML común.
import fs from "node:fs";
import path from "node:path";

const [, , dir, out] = process.argv;
const deck = JSON.parse(fs.readFileSync(path.join(dir, "project/deck.json"), "utf8"));

const ICONS = {
  Clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  Check: '<path d="M4 12.5l5 5L20 6.5"/>',
  Star:  '<path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 17l-5.6 3 1.3-6.2L3 9.5l6.3-.7z"/>',
};
const icon = (name, style) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="${style}">${ICONS[name] || ICONS.Check}</svg>`;

function limpiar(html) {
  return html
    .replace(/<aside>[\s\S]*?<\/aside>/g, "")                       // las notas NO se publican
    .replace(/<x-icon name="([^"]+)" style="([^"]*)"><\/x-icon>/g, (_, n, s) => icon(n, s))
    .replace(/<x-shape kind="arrow-right" style="([^"]*)"><\/x-shape>/g,
      (_, s) => `<svg viewBox="0 0 48 24" style="${s}" aria-hidden="true"><path d="M0 9h28V2l20 10-20 10v-7H0z" fill="currentColor"/></svg>`)
    .replace(/<x-shape kind="(?:rect|rounded)" style="([^"]*)"><\/x-shape>/g,
      (_, s) => `<div style="${s};border-radius:999px"></div>`)
    .replace(/<x-shape[^>]*><\/x-shape>/g, "")
    .replace(/ data-(?:transition|section|build-in|build-out)="[^"]*"/g, "");
}

const slides = deck.order
  .map(id => path.join(dir, `project/slides/${id}.html`))
  .filter(fs.existsSync)
  .map(f => limpiar(fs.readFileSync(f, "utf8")).trim())
  .join("\n");

const hrefs = Object.values(deck.faces || {}).map(f => f.href).filter(Boolean);
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

fs.writeFileSync(out, `<!doctype html>
<html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title)}</title>
<meta name="robots" content="noindex">
${hrefs.map(h => `<link rel="stylesheet" href="${esc(h)}">`).join("\n")}
<link rel="icon" href="/favicon.ico">
<style>
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:#2A1419;font-family:'Poppins',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:28px 20px 20px}
  /* Un poco más chica que la pantalla: se ve la slide entera sin pegarse a los bordes. */
  .stage{position:relative;width:min(1180px, 94vw, (100vh - 150px) * 1.7778);aspect-ratio:16/9;border-radius:14px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45)}
  .fit{position:absolute;inset:0;overflow:hidden;display:none}
  .fit.on{display:block;animation:entra .2s ease}
  @keyframes entra{from{opacity:0}to{opacity:1}}
  .fit > section{position:absolute;top:0;left:0;transform-origin:top left}
  .bar{display:flex;align-items:center;gap:18px;width:min(1180px, 94vw)}
  .bar .sp{flex:1}
  button{appearance:none;border:1px solid rgba(233,183,196,.35);background:rgba(255,255,255,.06);color:#F3DDE3;width:52px;height:52px;border-radius:50%;font-size:22px;cursor:pointer;transition:.15s;display:grid;place-items:center}
  button:hover:not(:disabled){background:#E9B7C4;color:#3B0218;border-color:#E9B7C4}
  button:disabled{opacity:.3;cursor:default}
  .n{color:#C9A3AE;font-size:15px;letter-spacing:1px;font-variant-numeric:tabular-nums}
  .dots{display:flex;gap:7px}
  .dots i{width:7px;height:7px;border-radius:50%;background:rgba(233,183,196,.3);cursor:pointer;transition:.15s}
  .dots i.on{background:#E9B7C4;transform:scale(1.35)}
  @media(max-width:720px){ .bar{gap:12px} button{width:46px;height:46px} .dots{display:none} }
</style>
</head><body>
<div class="stage" id="w">
${slides.replace(/<section /g, '<div class="fit"><section ').replace(/<\/section>/g, "</section></div>")}
</div>
<div class="bar">
  <button id="prev" aria-label="Anterior">&#8592;</button>
  <span class="n" id="n"></span>
  <span class="sp"></span>
  <span class="dots" id="dots"></span>
  <span class="sp"></span>
  <button id="next" aria-label="Siguiente">&#8594;</button>
</div>
<script>
  var fits = [].slice.call(document.querySelectorAll(".fit")), i = 0;
  document.getElementById("dots").innerHTML = fits.map(function(){ return "<i></i>"; }).join("");
  var dots = [].slice.call(document.querySelectorAll(".dots i"));
  dots.forEach(function(d, k){ d.onclick = function(){ ir(k); }; });
  function escalar(){
    var w = document.getElementById("w").clientWidth, s = w / 1920;
    fits.forEach(function(f){
      var el = f.querySelector("section"), c = el.getAttribute("data-fit");
      if (c === null) {
        f.style.display = "block"; f.style.visibility = "hidden";
        el.style.transform = "none"; el.style.width = "1920px"; el.style.height = "auto";
        c = Math.min(1, 1080 / Math.max(1, el.scrollHeight));
        el.setAttribute("data-fit", c);
        f.style.display = ""; f.style.visibility = "";
      }
      c = parseFloat(c);
      el.style.width = (1920 / c) + "px"; el.style.height = (1080 / c) + "px";
      el.style.transform = "scale(" + (s * c) + ")";
    });
  }
  function ir(k){
    i = Math.max(0, Math.min(fits.length - 1, k));
    fits.forEach(function(f, n){ f.classList.toggle("on", n === i); });
    dots.forEach(function(d, n){ d.classList.toggle("on", n === i); });
    document.getElementById("n").textContent = (i + 1) + " / " + fits.length;
    document.getElementById("prev").disabled = i === 0;
    document.getElementById("next").disabled = i === fits.length - 1;
  }
  document.getElementById("prev").onclick = function(){ ir(i - 1); };
  document.getElementById("next").onclick = function(){ ir(i + 1); };
  addEventListener("keydown", function(e){
    if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { ir(i + 1); e.preventDefault(); }
    if (e.key === "ArrowLeft" || e.key === "PageUp") { ir(i - 1); e.preventDefault(); }
  });
  addEventListener("resize", escalar);
  escalar(); ir(0);
</script>
</body></html>
`);
console.log("ok →", out, "·", deck.order.length, "slides");
