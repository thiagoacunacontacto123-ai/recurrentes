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
  html,body{margin:0;background:#2A1419;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:1920px;margin:0 auto}
  .fit{position:relative;width:100%;padding-top:56.25%;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.08)}
  .fit > section{position:absolute;top:0;left:0;width:1920px;height:1080px;transform-origin:top left}
  section{overflow:hidden}
  @media print{.fit{page-break-after:always;border:0}}
</style>
</head><body>
<div class="wrap" id="w">
${slides.replace(/<section /g, '<div class="fit"><section ').replace(/<\/section>/g, "</section></div>")}
</div>
<script>
  // Dos escalas: la del slide al ancho de la pantalla, y -si una slide quedó
  // con más contenido del que entra en 1080- una interna para que NADA se corte.
  function ajustar(){
    var w = document.getElementById("w").clientWidth, s = w / 1920;
    document.querySelectorAll(".fit > section").forEach(function(el){
      var c = el.getAttribute("data-fit");
      if (c === null) {
        el.style.transform = "none";
        c = Math.min(1, 1080 / Math.max(1, el.scrollHeight));
        el.setAttribute("data-fit", c);
      }
      el.style.transform = "scale(" + (s * parseFloat(c)) + ")";
      el.style.width = (1920 / parseFloat(c)) + "px";
      el.style.height = (1080 / parseFloat(c)) + "px";
    });
  }
  addEventListener("resize", ajustar); ajustar();
</script>
</body></html>
`);
console.log("ok →", out, "·", deck.order.length, "slides");
