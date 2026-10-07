// Arma TODA la demo de G4U en versión suscripción (7-oct-2026, Thiago):
//   public/demos/g4u.html            → el catálogo (el "link madre"): sus 9 productos sueltos, en el
//                                      orden de más vendidos, con precio de suscripción; cada uno lleva a…
//   public/demos/g4u-<producto>.html → la ficha de ese producto en versión suscripción (la misma
//                                      plantilla del pan de molde: packs, frecuencia, carrito, checkout, portal).
//   node demos/plantilla-tienda/g4u.armar.mjs
// Datos: g4u.assets.json (logo, íconos, testimonios) + g4u.productos.json (lo que releva g4u.relevar.mjs).
import fs from "node:fs";

const dir = new URL("./", import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, dir), "utf8");
const base = JSON.parse(read("g4u.assets.json"));
const productos = JSON.parse(read("g4u.productos.json"));
const tpl = read("template.html");
const catTpl = read("g4u.catalogo.template.html");
const OUT = new URL("../../public/demos/", dir);
// `</script>` adentro de un texto de reseña rompería la página: se escapa el cierre.
const json = (o) => JSON.stringify(o).replace(/<\//g, "<\\/");

// La frase del bloque bordó ("El pan de siempre, con beneficios reales."), por producto: la de
// la plantilla hablaba del pan de molde y en las tortillas quedaba mal el género y el número.
const IWT = {
  "pan-de-molde": "Pan de molde proteico, low-carb y sin azúcar. Con la suscripción te llega recién hecho cada vez que lo necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "tortilla": "Tortillas proteicas, low-carb y sin azúcar. Con la suscripción te llegan recién hechas cada vez que las necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "pan-arabe": "Pan árabe proteico, low-carb y sin azúcar. Con la suscripción te llega recién hecho cada vez que lo necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "pan-hamburguesa": "Pan de hamburguesa proteico, low-carb y sin azúcar. Con la suscripción te llega recién hecho cada vez que lo necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "pan-ciabatta": "Pan ciabatta proteico, low-carb y sin azúcar. Con la suscripción te llega recién hecho cada vez que lo necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "grisin-queso": "Grisines de queso proteicos, low-carb y sin azúcar. Con la suscripción te llegan recién hechos cada vez que los necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "marineras-semillas": "Marineras de semillas proteicas, low-carb y sin azúcar. Con la suscripción te llegan recién hechas cada vez que las necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "tostaditas-semillas": "Tostaditas de semillas proteicas, low-carb y sin azúcar. Con la suscripción te llegan recién hechas cada vez que las necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
  "tostaditas-cebolla": "Tostaditas de cebolla proteicas, low-carb y sin azúcar. Con la suscripción te llegan recién hechas cada vez que las necesitás, con 15% de descuento en cada envío y sin volver a hacer el pedido.",
};

// El selector de "armá tu pack" ofrece los 9 productos con el precio de hoy (los packs/combos no entran).
const items = productos.map((p) => ({ h: p.handle, title: p.nombre, sub: p.sub, price: p.price, img: p.img }));

for (const p of productos) {
  const A = {
    logo: base.logo, icons: base.icons, testimonials: base.testimonials,
    items, main: p.handle, title: p.title, price: p.price, gallery: p.gallery, mismo: p.mismo,
    reviews: p.reviews, review_summary: p.review_summary,
    iwt_text: IWT[p.slug] || IWT["pan-de-molde"],
    catalog_url: "g4u.html",
    page_title: `Suscripción G4U · ${p.nombre}`,
  };
  fs.writeFileSync(new URL(`g4u-${p.slug}.html`, OUT), tpl.replace("__ASSETS__", json(A)));
  console.log("ok →", `public/demos/g4u-${p.slug}.html`, `($${p.price}, ${p.reviews.length} reseñas)`);
}

// El catálogo reusa la hoja de estilos de la ficha (header, marquesina, intro, pie, sello) para
// que las dos pantallas sean una sola tienda.
const style = tpl.match(/<style>[\s\S]*?<\/style>/)[0];
const D = { logo: base.logo, productos: productos.map((p) => ({ slug: p.slug, title: p.title, price: p.price, img: p.gallery[0].replace("width=900", "width=600"), available: p.available })) };
fs.writeFileSync(new URL("g4u.html", OUT), catTpl.replace("__STYLE__", style).replace("__DATA__", json(D)));
console.log("ok →", "public/demos/g4u.html (catálogo,", productos.length, "productos)");
