// Genera las páginas de SEO y el sitemap:  npm run seo
//
// Escribe HTML estático en public/, que Vite copia a dist/ y Vercel sirve ANTES
// que el catch-all de la SPA (el filesystem gana sobre los rewrites). Con
// "cleanUrls" en vercel.json, public/foo.html queda servido en /foo.
//
// El texto NO se edita acá: está en seo/paginas.mjs. Este archivo solo arma.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITIO, PAGINAS } from "./paginas.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(RAIZ, "public");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Los estilos van EN LA PÁGINA, no en un css aparte: son pocas reglas y así la
// página se ve bien en el primer render, sin pedir otro archivo.
const CSS = `
:root{--bg:#0b0f0e;--card:#121817;--bd:#1f2b28;--tx:#e8f0ee;--md:#9fb3ad;--sm:#6f857f;--ac:#10b981}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.65 'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--ac)}
.wrap{max-width:760px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--bd);position:sticky;top:0;background:rgba(11,15,14,.92);backdrop-filter:blur(10px);z-index:9}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
.logo{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--tx);font-weight:800;font-size:17px}
.dot{width:26px;height:26px;border-radius:99px;background:var(--ac);display:inline-block}
.cta{background:var(--ac);color:#04120d;text-decoration:none;font-weight:700;padding:9px 16px;border-radius:10px;font-size:14px;white-space:nowrap}
h1{font-size:clamp(28px,5vw,40px);line-height:1.12;letter-spacing:-.02em;margin:40px 0 14px}
h2{font-size:21px;line-height:1.25;letter-spacing:-.01em;margin:32px 0 8px}
h3{font-size:16px;margin:22px 0 4px}
p{color:var(--md);margin:0 0 14px}
.lead{font-size:18px;color:var(--md)}
.box{background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:22px;margin:32px 0}
.box p{margin:0 0 10px}
.box .cta{display:inline-block;margin-top:8px}
nav.otras{border-top:1px solid var(--bd);margin-top:40px;padding-top:20px}
nav.otras a{display:block;padding:6px 0;text-decoration:none;color:var(--md)}
nav.otras a:hover{color:var(--tx)}
footer{border-top:1px solid var(--bd);margin-top:40px;padding:22px 0 50px;color:var(--sm);font-size:13px}
`.trim();

function pagina(p, todas) {
  const url = `${SITIO}/${p.slug}`;
  const otras = todas.filter((x) => x.slug !== p.slug);
  // JSON-LD de las preguntas: es lo que hace que Google muestre el desplegable
  // de respuestas debajo del resultado.
  const faqLd = p.faq?.length ? {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  } : null;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="theme-color" content="#10b981">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="es_AR">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap">
<style>${CSS}</style>
${faqLd ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ""}
</head>
<body>
<header><div class="wrap">
  <a class="logo" href="/"><span class="dot"></span>Recurrentes</a>
  <a class="cta" href="/#/demo">Pedir demo</a>
</div></header>

<main class="wrap">
  <h1>${esc(p.h1)}</h1>
  <p class="lead">${esc(p.intro)}</p>

  ${p.bloques.map((b) => `<h2>${esc(b.h)}</h2>\n  <p>${esc(b.p)}</p>`).join("\n\n  ")}

  <div class="box">
    <p><strong>Te lo mostramos funcionando en 15 minutos.</strong></p>
    <p>Te mostramos tiendas que ya venden por suscripción y vemos cómo se aplicaría a tu catálogo. Gratis hasta 10 suscriptores activos y sin comisión por venta.</p>
    <a class="cta" href="/#/demo">Pedir una demo →</a>
  </div>

  ${p.faq?.length ? `<h2>Preguntas frecuentes</h2>\n  ${p.faq.map(([q, a]) => `<h3>${esc(q)}</h3>\n  <p>${esc(a)}</p>`).join("\n\n  ")}` : ""}

  <nav class="otras">
    ${otras.map((o) => `<a href="/${o.slug}">${esc(o.h1)}</a>`).join("\n    ")}
  </nav>
</main>

<footer class="wrap">
  © ${new Date().getFullYear()} Recurrentes · Suscripciones con cobro automático para tiendas online de Argentina ·
  <a href="mailto:soporte@recurrentesapp.com">soporte@recurrentesapp.com</a>
</footer>
</body>
</html>
`;
}

// ── Escribir ────────────────────────────────────────────────────────────────
fs.mkdirSync(PUBLIC, { recursive: true });
for (const p of PAGINAS) {
  fs.writeFileSync(path.join(PUBLIC, `${p.slug}.html`), pagina(p, PAGINAS));
  console.log("  página →", `public/${p.slug}.html`);
}

const hoy = new Date().toISOString().slice(0, 10);
const urls = [{ loc: SITIO + "/", pri: "1.0" }, ...PAGINAS.map((p) => ({ loc: `${SITIO}/${p.slug}`, pri: "0.8" }))];
fs.writeFileSync(path.join(PUBLIC, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${hoy}</lastmod><priority>${u.pri}</priority></url>`).join("\n")
  + `\n</urlset>\n`);
console.log("  sitemap →", "public/sitemap.xml");

// El panel y el checkout no tienen nada que hacer en Google: son privados o
// llevan tokens de un cliente en la URL.
fs.writeFileSync(path.join(PUBLIC, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /demos/\n\nSitemap: ${SITIO}/sitemap.xml\n`);
console.log("  robots  →", "public/robots.txt");
console.log(`\n${PAGINAS.length} páginas listas.`);
