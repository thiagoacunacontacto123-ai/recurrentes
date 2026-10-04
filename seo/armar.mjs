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
import { SITIO, PAGINAS as BASE } from "./paginas.mjs";
import { EXTRA } from "./paginas-extra.mjs";
// Las dos listas son lo mismo: están separadas solo por tamaño del archivo.
const PAGINAS = [...BASE, ...EXTRA];

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(RAIZ, "public");

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Los estilos van EN LA PÁGINA, no en un css aparte: son pocas reglas y así la
// página se ve bien en el primer render, sin pedir otro archivo.
const CSS = `
:root{--bg:#0a0f0d;--surface:#11171a;--card:#161e22;--bd:#1f2a30;--tx:#f0f4f5;--md:#c1cbd1;--sm:#7e8a93;--ac:#34d399;--acs:#10b981;--mono:'IBM Plex Mono',ui-monospace,monospace}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--tx);font:16px/1.65 'Inter',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--ac)}
img{max-width:100%;display:block}
.wrap{max-width:1120px;margin:0 auto;padding:0 24px}
.narrow{max-width:820px}
header{border-bottom:1px solid var(--bd);position:sticky;top:0;background:rgba(10,15,13,.9);backdrop-filter:blur(10px);z-index:9}
header .wrap{display:flex;align-items:center;justify-content:space-between;height:60px}
.logo{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--tx);font-weight:800;font-size:18px;letter-spacing:-.3px}
.logo img{width:30px;height:30px}
.cta{background:var(--acs);color:#fff;text-decoration:none;font-weight:700;padding:10px 18px;border-radius:12px;font-size:14px;white-space:nowrap;display:inline-flex;align-items:center;gap:8px;box-shadow:0 12px 30px -10px rgba(16,185,129,.6)}
.cta.big{padding:15px 26px;font-size:16px;border-radius:14px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:2.2px;text-transform:uppercase;color:var(--ac);margin:0 0 14px}
.hero{padding:64px 0 40px;position:relative}
.hero .bg{position:absolute;inset:-40px 0 0;pointer-events:none;background-image:linear-gradient(var(--bd) 1px,transparent 1px),linear-gradient(90deg,var(--bd) 1px,transparent 1px);background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 30%,transparent 100%);mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 30%,transparent 100%);opacity:.55}
.hero .wrap{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,.9fr);gap:44px;align-items:center}
h1{font-family:'Manrope','Inter',sans-serif;font-size:clamp(32px,4.4vw,54px);line-height:1.04;letter-spacing:-.04em;margin:0 0 18px;text-wrap:balance}
h2{font-family:'Manrope','Inter',sans-serif;font-size:clamp(26px,3.2vw,38px);line-height:1.08;letter-spacing:-.03em;margin:0 0 12px;text-wrap:balance}
h3{font-family:'Manrope','Inter',sans-serif;font-size:18px;margin:0 0 6px;letter-spacing:-.2px}
p{color:var(--md);margin:0 0 14px}
.lead{font-size:18px;color:var(--md);max-width:560px}
.badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:18px}
.badge{display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:99px;border:1px solid var(--bd);background:var(--card);font-size:12px;font-weight:700;color:var(--tx)}
.badge i{width:20px;height:20px;border-radius:5px;background:#fff;display:grid;place-items:center}
.badge i img{width:14px;height:14px;object-fit:contain}
.badge small{font-weight:600;color:var(--sm)}
.shot{border-radius:22px;overflow:hidden;border:1px solid var(--bd);background:var(--card);box-shadow:0 30px 70px -30px rgba(0,0,0,.6)}
.shot .bar{display:flex;align-items:center;gap:8px;padding:9px 14px;border-bottom:1px solid var(--bd);background:var(--surface);font-family:var(--mono);font-size:11.5px;color:var(--sm)}
.shot .bar i{width:8px;height:8px;border-radius:99px;display:inline-block}
.shot img{width:100%;aspect-ratio:16/9.4;object-fit:cover;object-position:top left}
.shot.photo img{aspect-ratio:1/1;object-fit:cover}
section{padding:56px 0}
section.alt{background:var(--surface);border-top:1px solid var(--bd);border-bottom:1px solid var(--bd)}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:22px;padding:24px;position:relative;overflow:hidden}
.card::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,.04),transparent 38%)}
.card .n{font-family:var(--mono);font-size:12px;color:var(--ac);margin-bottom:10px;display:block}
.card p{margin:0;font-size:15px}
.vs{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--bd);border-radius:18px;overflow:hidden;background:var(--card);font-size:14px}
.vs th,.vs td{padding:13px 16px;text-align:left;border-bottom:1px solid var(--bd);vertical-align:top}
.vs tr:last-child td{border-bottom:none}
.vs th{font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--sm);font-weight:800}
.vs td.rec{background:rgba(16,185,129,.08);color:var(--ac);font-weight:700}
.vs th.rec{color:var(--ac);border-top:3px solid var(--acs)}
.vs small{display:block;color:var(--sm);font-weight:500;font-size:12px;margin-top:2px}
.vs-wrap{overflow-x:auto}
.box{background:#0C1A18;border:1px solid rgba(255,255,255,.08);border-radius:28px;padding:56px 28px;text-align:center;position:relative;overflow:hidden}
.box::before{content:"";position:absolute;inset:-40%;background:radial-gradient(circle at 50% 30%,rgba(16,185,129,.35) 0%,transparent 45%);pointer-events:none}
.box>*{position:relative}
.box h2{color:#fff}
.box p{color:#A9C3B9;max-width:520px;margin:0 auto 24px}
details{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:0 18px;margin-bottom:8px}
summary{cursor:pointer;padding:16px 0;font-weight:700;list-style:none;display:flex;justify-content:space-between;gap:14px}
summary::after{content:"+";color:var(--ac);font-size:22px;line-height:1}
details[open] summary::after{content:"−"}
details p{margin:0 0 16px;font-size:14px}
.otras{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.otras a{display:block;padding:14px 16px;border:1px solid var(--bd);border-radius:14px;text-decoration:none;color:var(--md);font-size:14px;background:var(--card)}
.otras a:hover{color:var(--tx);border-color:rgba(16,185,129,.5)}
footer{border-top:1px solid var(--bd);background:var(--surface);padding:48px 0 28px;color:var(--sm);font-size:13px}
footer .cols{display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:28px}
footer h4{margin:0 0 12px;font-size:11px;letter-spacing:.6px;text-transform:uppercase;color:var(--tx)}
footer a{display:block;color:var(--sm);text-decoration:none;padding:4px 0}
footer .bottom{border-top:1px solid var(--bd);margin-top:32px;padding-top:18px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px}
footer .soc{display:inline-flex;gap:14px}
footer .soc a{color:var(--ac);display:inline-flex;align-items:center;gap:6px;padding:0}
@media(max-width:900px){.hero .wrap{grid-template-columns:1fr;gap:28px}.grid,.grid3,.otras{grid-template-columns:1fr}footer .cols{grid-template-columns:1fr 1fr}footer .cols>:first-child{grid-column:1/-1}.hero{padding:40px 0 28px}section{padding:44px 0}.wrap{padding:0 16px}}
`.trim();

const CSS_EXTRA = `.meta{font-size:13px;color:var(--sm);margin:10px 0 0}.meta a{color:var(--ac);text-decoration:none}
.hub{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;margin-top:18px}.hub a{display:block;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:18px 18px 16px;color:inherit;text-decoration:none;transition:border-color .15s}.hub a:hover{border-color:var(--ac)}.hub .k{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--ac)}.hub h3{margin:8px 0 6px;font-size:17px;line-height:1.25}.hub p{margin:0;font-size:13.5px;color:var(--sm);line-height:1.5}.hub .d{display:block;margin-top:10px;font-size:12px;color:var(--sm)}`;
const LOGO = `<svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#059669"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#g)"/><path d="M22.5 13.2A7.2 7.2 0 1 0 23.2 18" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M22.9 8.6v5.1h-5.1" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const BADGES = `<div class="badges">
  <span class="badge"><i><img src="/brand/shopify-bag.svg" alt=""></i>Shopify <small>Partner</small></span>
  <span class="badge"><i><img src="/brand/tiendanube.png" alt=""></i>Tiendanube <small>Partner</small></span>
  <span class="badge"><i><img src="/brand/mercadopago.png" alt=""></i>Mercado Pago <small>Partner</small></span>
</div>`;
const shot = (src, label, photo = false) => `<figure class="shot${photo ? " photo" : ""}" style="margin:0"><div class="bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span>${esc(label)}</span></div><img src="${src}" alt="${esc(label)}" loading="lazy"></figure>`;

// Tabla comparativa (solo en las páginas con `vs`). Datos de la web pública de cada uno,
// los mismos de la comparativa de la home (LandingSections.jsx → COMPARE_ROWS).
const vsTable = (vs) => `<div class="vs-wrap"><table class="vs">
<tr><th>Qué mirar</th><th class="rec">Recurrentes</th><th>${esc(vs.nombre)}</th></tr>
${vs.filas.map(([q, a, b]) => `<tr><td>${esc(q)}</td><td class="rec">${a}</td><td>${b}</td></tr>`).join("\n")}
</table></div>
<p style="font-size:12px;color:var(--sm);margin-top:12px">${esc(vs.fuente)}</p>`;

const hoy = new Date().toISOString().slice(0, 10);
const FECHA_BASE = "2026-09-26"; // cuando nacieron las primeras páginas
const fechaLarga = (iso) => new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));

function pagina(p, todas) {
  const url = `${SITIO}/${p.slug}`;
  const otras = todas.filter((x) => x.slug !== p.slug).slice(0, 9);
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Recurrentes", alternateName: "Recurrentes App",
    url: SITIO,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: "Suscripciones con cobro recurrente por Mercado Pago para tiendas Shopify y Tiendanube en Argentina. Cada cobro genera la orden en la tienda automáticamente.",
    inLanguage: "es-AR",
    areaServed: { "@type": "Country", name: "Argentina" },
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "US$ 99 por mes más una comisión de lo que cobrás, que baja a medida que crecés." },
    publisher: { "@type": "Organization", name: "Recurrentes", url: SITIO, email: "soporte@recurrentesapp.com", logo: `${SITIO}/icon-512.png`, sameAs: ["https://www.linkedin.com/company/recurrentes-app", "https://www.instagram.com/recurrentes.app/"] },
  };
  // Marcado de artículo con fecha y autor (Reval lo tiene; Google lo usa para el "Actualizado el…").
  const publicado = p.fecha || FECHA_BASE;
  const artLd = {
    "@context": "https://schema.org", "@type": "Article",
    headline: p.h1, description: p.description, inLanguage: "es-AR",
    mainEntityOfPage: url, image: `${SITIO}${p.imagen || "/landing/panel-analiticas.jpg"}`,
    datePublished: publicado, dateModified: hoy,
    author: { "@type": "Organization", name: "Recurrentes", url: SITIO },
    publisher: { "@type": "Organization", name: "Recurrentes", url: SITIO, logo: { "@type": "ImageObject", url: `${SITIO}/icon-512.png` } },
  };
  const faqLd = p.faq?.length ? { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) } : null;
  const crumbLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Recurrentes", item: SITIO + "/" }, { "@type": "ListItem", position: 2, name: p.h1, item: url }] };
  const heroImg = p.imagen || "/landing/panel-analiticas.jpg";
  const heroLabel = p.imagenLabel || "recurrentesapp.com · Analíticas";
  const capturas = p.capturas || [["/landing/panel-suscripciones.jpg", "Suscripciones"], ["/landing/panel-cobros.jpg", "Cobros"], ["/landing/panel-flujos-whatsapp.jpg", "Flujos de WhatsApp"]];

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title>
<meta name="description" content="${esc(p.description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#10b981">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta property="og:image" content="${SITIO}${heroImg}">
<meta property="og:site_name" content="Recurrentes">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(p.title)}">
<meta property="og:description" content="${esc(p.description)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="es_AR">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Manrope:wght@700;800&display=swap">
<style>${CSS}${CSS_EXTRA}</style>
<script type="application/ld+json">${JSON.stringify(orgLd)}</script>
<script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
<script type="application/ld+json">${JSON.stringify(artLd)}</script>
${faqLd ? `<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ""}
</head>
<body>
<header><div class="wrap">
  <a class="logo" href="/">${LOGO}Recurrentes</a>
  <a class="cta" href="/#/demo">Pedir demo</a>
</div></header>

<div class="hero"><div class="bg"></div><div class="wrap">
  <div>
    <p class="eyebrow">${esc(p.eyebrow || "Recurrentes · suscripciones para tu tienda")}</p>
    <h1>${esc(p.h1)}</h1>
    <p class="lead">${esc(p.intro)}</p>
    <p class="meta"><a href="/blog">Blog</a> · Publicado el ${fechaLarga(publicado)} · Actualizado el ${fechaLarga(hoy)}</p>
    <p style="margin-top:22px"><a class="cta big" href="/#/demo">Pedir una demo →</a></p>
    ${BADGES}
  </div>
  <div>${shot(heroImg, heroLabel, !!p.imagenFoto)}</div>
</div></div>

<section><div class="wrap">
  <div class="grid">
    ${p.bloques.map((b, i) => `<div class="card"><span class="n">0${i + 1}</span><h3>${esc(b.h)}</h3><p>${esc(b.p)}</p></div>`).join("\n    ")}
  </div>
</div></section>

${p.vs ? `<section class="alt"><div class="wrap">
  <p class="eyebrow">Comparativa</p>
  <h2>${esc(p.vs.titulo || `Recurrentes y ${p.vs.nombre}, lado a lado`)}</h2>
  <p class="lead" style="margin-bottom:26px">${esc(p.vs.intro || "Datos públicos de cada uno. Lo que el otro no documenta, no lo inventamos.")}</p>
  ${vsTable(p.vs)}
</div></section>` : `<section class="alt"><div class="wrap">
  <p class="eyebrow">El panel, por dentro</p>
  <h2>Así se ve cuando está andando</h2>
  <p class="lead" style="margin-bottom:26px">Capturas reales de nuestra tienda de pruebas: suscripciones, cobros con su pedido creado y los avisos por WhatsApp.</p>
  <div class="grid3">${capturas.map(([src, l]) => shot(src, "recurrentesapp.com · " + l)).join("\n    ")}</div>
</div></section>`}

<section><div class="wrap">
  <div class="box">
    <h2>Te lo mostramos funcionando en 15 minutos</h2>
    <p>Vemos tiendas que ya venden por suscripción con Recurrentes y qué se podría armar en la tuya. US$ 99 por mes más una comisión de lo que cobrás, que baja a medida que crecés.</p>
    <a class="cta big" href="/#/demo">Pedir una demo →</a>
  </div>
</div></section>

${p.faq?.length ? `<section class="alt"><div class="wrap narrow">
  <p class="eyebrow">Preguntas frecuentes</p>
  <h2 style="margin-bottom:22px">Lo que todos preguntan</h2>
  ${p.faq.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n  ")}
</div></section>` : ""}

<section><div class="wrap">
  <p class="eyebrow">Seguir leyendo</p>
  <div class="otras">
    ${otras.map((o) => `<a href="/${o.slug}">${esc(o.h1)}</a>`).join("\n    ")}
  </div>
</div></section>

<footer><div class="wrap">
  <div class="cols">
    <div><a class="logo" href="/" style="margin-bottom:12px">${LOGO}Recurrentes</a><p style="max-width:300px;font-size:13.5px">Suscripciones con Mercado Pago para tiendas online de Argentina. Cada cobro crea el pedido en tu tienda.</p><a class="cta" href="/#/demo" style="display:inline-flex">Pedir una demo</a></div>
    <div><h4>Producto</h4><a href="/">Inicio</a><a href="/#/como-funciona">Cómo funciona</a><a href="/#/funciones">Funciones</a><a href="/#/integraciones">Integraciones</a><a href="/#/precios">Precios</a><a href="/demos/tostado">Tienda de ejemplo</a><a href="/blog">Blog</a></div>
    <div><h4>Recurrentes</h4><a href="/#/preguntas">Preguntas frecuentes</a><a href="/#/demo">Pedir demo</a><a href="/#/terminos">Términos</a><a href="/#/privacidad">Privacidad</a><a href="https://wa.me/5491164117974" target="_blank" rel="noreferrer">Soporte por WhatsApp</a></div>
  </div>
  <div class="bottom">
    <span>© ${new Date().getFullYear()} Recurrentes · Desarrollado y codeado con <span style="color:var(--ac)">♥</span> en Buenos Aires, Argentina</span>
    <span class="soc"><a href="mailto:soporte@recurrentesapp.com">soporte@recurrentesapp.com</a><a href="https://www.linkedin.com/company/recurrentes-app" target="_blank" rel="noreferrer">LinkedIn</a><a href="https://www.instagram.com/recurrentes.app/" target="_blank" rel="noreferrer">Instagram</a></span>
  </div>
</div></footer>
</body>
</html>
`;
}

// ── /blog: el índice de todo lo publicado, agrupado por sección ─────────────
// (28-sept-2026: Reval tiene su /blog y /comparativas; sin un índice, Google y la
// gente llegan a una página y no saben que hay otras 30).
const SECCIONES = [
  ["guias", "Guías"], ["rubros", "Por rubro"], ["comparativas", "Comparativas"], ["plataformas", "Por plataforma"],
];
function seccionDe(p) {
  if (p.seccion) return p.seccion;
  if (p.vs || /^(alternativa-a-|puentify)/.test(p.slug)) return "comparativas";
  if (/^suscripcion-de-|^suscripcion-alimento|^suscripcion-cosmetica|club-de-vinos|yerba/.test(p.slug)) return "rubros";
  if (/shopify|tiendanube/.test(p.slug)) return "plataformas";
  return "guias";
}
function hub(todas) {
  const url = `${SITIO}/blog`;
  const grupos = SECCIONES.map(([id, nombre]) => [nombre, todas.filter((p) => seccionDe(p) === id)]).filter(([, l]) => l.length);
  const ld = { "@context": "https://schema.org", "@type": "CollectionPage", name: "Blog de Recurrentes", url, inLanguage: "es-AR",
    hasPart: todas.map((p) => ({ "@type": "Article", headline: p.h1, url: `${SITIO}/${p.slug}` })) };
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blog · Suscripciones y cobro recurrente para tiendas online en Argentina | Recurrentes</title>
<meta name="description" content="Guías, comparativas y casos por rubro para vender por suscripción con Mercado Pago en Shopify y Tiendanube. ${todas.length} artículos, escritos por el equipo de Recurrentes.">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#10b981">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
<meta property="og:site_name" content="Recurrentes"><meta property="og:type" content="website"><meta property="og:title" content="Blog de Recurrentes"><meta property="og:url" content="${url}"><meta property="og:image" content="${SITIO}/landing/panel-analiticas.jpg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&family=Manrope:wght@700;800&display=swap">
<style>${CSS}${CSS_EXTRA}</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<header><div class="wrap"><a class="logo" href="/">${LOGO}Recurrentes</a><a class="cta" href="/#/demo">Pedir demo</a></div></header>
<div class="hero"><div class="bg"></div><div class="wrap" style="grid-template-columns:1fr"><div>
  <p class="eyebrow">Blog de Recurrentes</p>
  <h1>Vender por suscripción en Argentina, explicado</h1>
  <p class="lead">Guías para armar tu suscripción, comparativas con datos públicos y cómo lo hacen las tiendas de cada rubro. Todo pensado para Shopify y Tiendanube con Mercado Pago.</p>
  ${BADGES}
</div></div></div>
${grupos.map(([nombre, lista]) => `<section><div class="wrap">
  <p class="eyebrow">${esc(nombre)}</p>
  <div class="hub">
    ${lista.map((p) => `<a href="/${p.slug}"><span class="k">${esc(p.eyebrow || nombre)}</span><h3>${esc(p.h1)}</h3><p>${esc(p.description)}</p><span class="d">Actualizado el ${fechaLarga(hoy)}</span></a>`).join("\n    ")}
  </div>
</div></section>`).join("\n")}
<section><div class="wrap"><div class="box"><h2>Te lo mostramos funcionando en 15 minutos</h2><p>Vemos tiendas que ya venden por suscripción con Recurrentes y qué se podría armar en la tuya.</p><a class="cta big" href="/#/demo">Pedir una demo →</a></div></div></section>
<footer><div class="wrap"><div class="bottom"><span>© ${new Date().getFullYear()} Recurrentes · Desarrollado y codeado con <span style="color:var(--ac)">♥</span> en Buenos Aires, Argentina</span><span class="soc"><a href="/">Inicio</a><a href="mailto:soporte@recurrentesapp.com">soporte@recurrentesapp.com</a><a href="https://www.linkedin.com/company/recurrentes-app" target="_blank" rel="noreferrer">LinkedIn</a><a href="https://www.instagram.com/recurrentes.app/" target="_blank" rel="noreferrer">Instagram</a></span></div></div></footer>
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
fs.writeFileSync(path.join(PUBLIC, "blog.html"), hub(PAGINAS));
console.log("  índice →", "public/blog.html");

const urls = [{ loc: SITIO + "/", pri: "1.0" }, { loc: SITIO + "/blog", pri: "0.9" }, ...PAGINAS.map((p) => ({ loc: `${SITIO}/${p.slug}`, pri: "0.8" }))];
fs.writeFileSync(path.join(PUBLIC, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
  + urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${hoy}</lastmod><priority>${u.pri}</priority></url>`).join("\n")
  + `\n</urlset>\n`);
console.log("  sitemap →", "public/sitemap.xml");

// El panel y el checkout no tienen nada que hacer en Google: son privados o
// llevan tokens de un cliente en la URL.
//
// Los rastreadores de IA van NOMBRADOS a propósito (26-sept-2026, Thiago:
// "que aparezca cuando me busquen en ChatGPT"). Con "User-agent: *" ya
// estarían permitidos, pero varios buscan su propia línea y muchos sitios los
// bloquean por defecto: dejarlo explícito es decir "sí, citen esto". Es una
// decisión, no un descuido: significa que este contenido puede usarse para
// entrenar y para responder preguntas. Para un SaaS que quiere ser
// recomendado, es lo que conviene.
const BOTS_IA = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended", "meta-externalagent"];
fs.writeFileSync(path.join(PUBLIC, "robots.txt"),
  `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /demos/\n\n`
  + BOTS_IA.map((b) => `User-agent: ${b}\nAllow: /\nDisallow: /api/\n`).join("\n")
  + `\nSitemap: ${SITIO}/sitemap.xml\n`);
console.log("  robots  →", "public/robots.txt");
console.log(`\n${PAGINAS.length} páginas listas.`);
