// Arma una demo de "tienda en versión suscripción" a partir de la plantilla.
//   node demos/plantilla-tienda/armar.mjs <assets.json> <salida.html>
// assets.json: { logo, gallery:[urls], items:[{h,title,sub,price,img}], icons:[urls] }
// Para una tienda Shopify nueva: bajá /products/<handle>.js (galería) y /products.json
// (catálogo) y armá el json con URLs del CDN (?width=900 / ?width=240). Ver README.md.
import fs from "node:fs";
const [,, assets, out] = process.argv;
const t = fs.readFileSync(new URL("./template.html", import.meta.url), "utf8");
fs.writeFileSync(out, t.replace("__ASSETS__", fs.readFileSync(assets, "utf8")));
console.log("ok →", out);
