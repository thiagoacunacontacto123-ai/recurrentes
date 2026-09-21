// (j) Diseños del widget con foto: v11 (Foto) y v12 (Foto + regalos).
//
// Son los dos diseños que imitan a los bundles de las apps de performance
// (Kaching y compañía): una fila por pack con la imagen que sube el comercio,
// y el interruptor de suscripción entre los packs y el botón.
//
// Lo que protegen: que la foto y los regalos que carga el comercio lleguen al
// HTML, que NADA de lo que escribe termine sin escapar (es texto de un tercero
// dentro de la tienda de otro), y que un link que no sea https no se pinte.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBundle, BUNDLE_VARIANTS } from "../../shared/bundle/templates.js";
import { buildBundleVM, VARIANT_IDS } from "../../shared/bundle/viewmodel.js";
import { normalizePacks, resolvePack } from "../../api/_lib/packs.js";

const FOTO = "https://cdn.tienda.test/pack-3.webp";
const GIFT = "https://cdn.tienda.test/guia.png";

const plan = (packs) => ({
  pricing_mode: "packs", frequency_days: 30, discount_pct: 15,
  base_price_ars: 27500, product_title: "Gotas", packs,
});
const PACKS = [
  { qty: 2, price_ars: 54900, label: "LLEVE 2", image: FOTO, default: true },
  { qty: 3, price_ars: 65990, label: "LLEVE 3", badge: "Más elegido", image: FOTO,
    gifts: [{ title: 'Guía "Mal aliento"', image: GIFT, compare_at_ars: 18600 }] },
];

test("(j) v11 y v12 están registrados y se pueden elegir desde el panel", () => {
  for (const v of ["v11", "v12"]) {
    assert.ok(VARIANT_IDS.includes(v), `${v} en VARIANT_IDS`);
    assert.ok(BUNDLE_VARIANTS.some(x => x.id === v), `${v} en el catálogo del panel`);
    const r = renderBundle(buildBundleVM({ merchant: { widget_variant: v }, plan: plan(PACKS) }), {});
    assert.ok(r.html.length > 100 && r.css.includes(v), `${v} renderiza`);
  }
});

test("(j) v11: pinta la foto del pack y el interruptor de suscripción", () => {
  const vm = buildBundleVM({ merchant: { widget_variant: "v11" }, plan: plan(PACKS) });
  const { html } = renderBundle(vm, { mode: "once" });
  assert.ok(html.includes(FOTO), "la foto del pack está en el HTML");
  assert.ok(html.includes('role="switch"'), "hay interruptor, no dos botones");
  assert.ok(html.includes('aria-checked="false"'), "arranca apagado en compra única");
});

test("(j) v12: además muestra el regalo con su foto y el valor tachado", () => {
  const vm = buildBundleVM({ merchant: { widget_variant: "v12" }, plan: plan(PACKS) });
  const { html } = renderBundle(vm, { mode: "sub" });
  assert.ok(html.includes(GIFT), "la foto del regalo");
  assert.ok(html.includes("Mal aliento"), "el nombre del regalo");
  assert.ok(/18\.600/.test(html), "el valor tachado del regalo");
  assert.ok(html.includes('aria-checked="true"'), "en modo sub el interruptor está encendido");
});

test("(j) un pack sin foto no rompe: cae al recuadro con la cantidad", () => {
  const vm = buildBundleVM({ merchant: { widget_variant: "v11" }, plan: plan([{ qty: 2, price_ars: 54900, label: "LLEVE 2" }]) });
  const { html } = renderBundle(vm, {});
  assert.ok(!html.includes("<img"), "no pinta una imagen vacía");
  assert.ok(html.includes("rc-ph-x"), "usa el recuadro de respaldo");
});

test("(j) lo que escribe el comercio va escapado (no se puede inyectar HTML)", () => {
  const malo = [{ qty: 2, price_ars: 54900, label: '<img src=x onerror=alert(1)>', badge: '"><script>alert(2)</script>',
    image: FOTO, gifts: [{ title: '<b>regalo</b>' }] }];
  const { html } = renderBundle(buildBundleVM({ merchant: { widget_variant: "v12" }, plan: plan(malo) }), {});
  // Lo que importa es que no queden ETIQUETAS vivas: el texto escapado puede
  // contener la palabra "onerror", pero como &lt;img…&gt; el navegador lo pinta
  // como texto y no ejecuta nada.
  assert.ok(!html.includes("<script>"), "sin etiqueta script");
  assert.ok(!/<img [^>]*onerror/i.test(html), "sin img con onerror vivo");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "el label sale escapado");
  assert.ok(html.includes("&lt;b&gt;regalo&lt;/b&gt;"), "el regalo sale escapado");
  // La única <img> real es la foto del pack, con la URL que cargó el comercio.
  const imgs = html.match(/<img [^>]*>/g) || [];
  assert.ok(imgs.every(t => t.includes("https://cdn.tienda.test/")), "solo imágenes de la foto cargada");
});

test("(j) al guardar: la foto tiene que ser https y los regalos tienen tope", () => {
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, image: "javascript:alert(1)" }]).error, "rechaza javascript:");
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, image: "http://x.test/a.png" }]).error, "rechaza http");
  assert.equal(normalizePacks([{ qty: 1, price_ars: 100, image: FOTO }]).packs[0].image, FOTO, "acepta https");

  const cuatro = [{ title: "a" }, { title: "b" }, { title: "c" }, { title: "d" }];
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, gifts: cuatro }]).error, "máximo 3 regalos");
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, gifts: [{ title: "" }] }]).error, "el regalo necesita nombre");
});

test("(j) los planes que ya existen siguen igual: sin foto ni regalos", () => {
  const r = resolvePack(plan([{ qty: 2, price_ars: 54900 }]), 0);
  assert.equal(r.image, null);
  assert.deepEqual(r.gifts, []);
  // Y los 10 diseños viejos siguen renderizando.
  for (const v of ["v01","v02","v03","v04","v05","v06","v07","v08","v09","v10"]) {
    const out = renderBundle(buildBundleVM({ merchant: { widget_variant: v }, plan: plan(PACKS) }), {});
    assert.ok(out.html.length > 100, `${v} sigue andando`);
  }
});

// ── Fotos subidas desde el panel ────────────────────────────────────────────
// El comercio ya no tiene que conseguir un link: elige el archivo y el panel lo
// achica y lo manda como data URL. Firestore corta el doc en 1 MB, así que el
// tamaño tiene tope; y solo se aceptan imágenes, nunca un data: de otra cosa.
const DATA_OK = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";

test("(j) foto subida: acepta data:image, la guarda y la pinta", () => {
  const r = normalizePacks([{ qty: 1, price_ars: 100, image: DATA_OK }]);
  assert.equal(r.packs[0].image, DATA_OK, "se guarda tal cual");

  const { html } = renderBundle(
    buildBundleVM({ merchant: { widget_variant: "v11" }, plan: plan([{ qty: 1, price_ars: 100, image: DATA_OK }]) }), {});
  assert.ok(html.includes(DATA_OK), "llega al HTML del widget");
});

test("(j) foto subida: rechaza lo que no sea una imagen y lo que pese de más", () => {
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, image: "data:text/html;base64,PHNjcmlwdD4=" }]).error,
    "data: que no es imagen");
  const gorda = "data:image/jpeg;base64," + "A".repeat(200001);
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, image: gorda }]).error, "imagen demasiado pesada");
});

test("(j) el regalo también puede tener foto subida", () => {
  const r = normalizePacks([{ qty: 1, price_ars: 100, gifts: [{ title: "Guía", image: DATA_OK }] }]);
  assert.equal(r.packs[0].gifts[0].image, DATA_OK);
  assert.ok(normalizePacks([{ qty: 1, price_ars: 100, gifts: [{ title: "x", image: "javascript:alert(1)" }] }]).error,
    "el regalo tampoco acepta javascript:");
});
