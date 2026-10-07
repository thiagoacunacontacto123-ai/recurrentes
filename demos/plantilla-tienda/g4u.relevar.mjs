// Releva la tienda de G4U (datos públicos, sin login) y arma g4u.productos.json: los 9
// productos sueltos en el orden de "más vendidos" de su colección, con precio de hoy,
// galería, y las reseñas de Revie TAL CUAL las muestra su ficha (el JSON viene en la
// página, en <script data-rvw2-list>). Los packs/combos no entran: no son de suscripción.
//   node demos/plantilla-tienda/g4u.relevar.mjs
// Correrlo de nuevo cuando cambien precios o fotos (7-oct-2026, Thiago: "después lo cambiamos").
import fs from "node:fs";

const TIENDA = "https://g4u-ar.com";
const CDN = "https://cdn.shopify.com/s/files/1/0988/5404/3729/files/";
// Orden de /collections/all?sort_by=best-selling el 7-oct-2026 (sin los 4 packs).
const ORDEN = [
  ["pan-de-molde-proteico", "pan-de-molde", "el mismo pan"],
  ["tortilla-proteica-low-carb-sin-azucar-apto-keto-10-unidades", "tortilla", "las mismas tortillas"],
  ["pan-arabe-proteico-low-carb-sin-azucar-apto-keto-4-unidades", "pan-arabe", "el mismo pan"],
  ["pan-hamburguesa-proteico", "pan-hamburguesa", "el mismo pan"],
  ["pan-ciabatta-proteico-low-carb-sin-azucar-apto-keto-4-unidades-copia", "pan-ciabatta", "el mismo pan"],
  ["grisin-queso-proteico-low-carb-sin-azucar-apto-keto", "grisin-queso", "los mismos grisines"],
  ["marineras-semillas-proteico-low-carb-sin-azucar-apto-keto", "marineras-semillas", "las mismas marineras"],
  ["tostaditas-semillas-proteico-low-carb-sin-azucar-apto-keto", "tostaditas-semillas", "las mismas tostaditas"],
  ["tostaditas-cebolla-proteico-low-carb-sin-azucar-apto-keto", "tostaditas-cebolla", "las mismas tostaditas"],
];
const UA = { "User-Agent": "Mozilla/5.0 (Macintosh) Recurrentes-demo" };
const limpio = (s) => String(s || "").replace(/\s+/g, " ").trim();
const titleCase = (s) => limpio(s).toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
const cdn = (u, w) => "https:" + String(u).replace(/^https?:/, "").replace(/\?v=\d+/, "") + `?width=${w}`;

const out = [];
for (const [handle, slug, mismo] of ORDEN) {
  const p = await fetch(`${TIENDA}/products/${handle}.js`, { headers: UA }).then((r) => r.json());
  const html = await fetch(`${TIENDA}/products/${handle}`, { headers: UA }).then((r) => r.text());
  const lista = html.match(/<script[^>]*data-rvw2-list[^>]*>([\s\S]*?)<\/script>/);
  const data = html.match(/<script[^>]*data-rvw2-data[^>]*>([\s\S]*?)<\/script>/);
  const rv = lista ? JSON.parse(lista[1]) : [];
  const rs = data ? JSON.parse(data[1]) : {};
  const [nombre, sub] = p.title.split("|").map(limpio);
  out.push({
    handle, slug,
    title: `${nombre} | ${sub}`,                 // como lo muestra su tienda
    nombre: titleCase(nombre),                   // "Pan De Molde": el nombre corto del selector
    sub: sub || "",
    mismo,                                       // "el mismo pan" / "las mismas tortillas" (línea bajo el título)
    price: Math.round(p.price / 100),
    available: p.available,
    gallery: p.images.map((u) => cdn(u, 900)),
    img: cdn(p.images[0], 240),
    review_summary: { count: rs.reviewCount || rv.length, avg: Math.round((rs.reviewAverageValue || 5) * 100) / 100 },
    // [nombre, estrellas, texto, fecha, foto|null] — el formato que lee la plantilla
    reviews: rv.map((r) => [limpio(r.customer?.firstName), r.stars, String(r.comment || "").trim(), String(r.createdAt || "").slice(0, 10), (r.images && r.images[0] && (r.images[0].src || r.images[0].url)) || null]),
  });
  console.log(slug.padEnd(20), "$" + out.at(-1).price, "| fotos:", p.images.length, "| reseñas:", rv.length, "| disponible:", p.available);
}
fs.writeFileSync(new URL("./g4u.productos.json", import.meta.url), JSON.stringify(out, null, 1));
console.log("ok →", out.length, "productos en g4u.productos.json");
