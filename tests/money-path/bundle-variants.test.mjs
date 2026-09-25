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

test("(j) un pack sin foto muestra UN marco de imagen con la cantidad", () => {
  const vm = buildBundleVM({ merchant: { widget_variant: "v11" },
    plan: plan([{ qty: 1, price_ars: 8900 }, { qty: 2, price_ars: 17800 }, { qty: 5, price_ars: 44500 }]) });
  const { html } = renderBundle(vm, {});
  assert.ok(!html.includes("<img"), "no pinta una imagen vacía");

  const bloques = html.split('class="rc-ph rc-ph-x"').slice(1).map(b => b.slice(0, b.indexOf("</span>")));
  assert.equal(bloques.length, 3, "un marco por pack");
  // UN solo marco por pack: repetirlo se leía como "este pack trae N fotos".
  bloques.forEach((b, i) => {
    assert.equal((b.match(/<svg/g) || []).length, 1, `pack ${i + 1}: un solo ícono`);
  });
  assert.ok(/>×1</.test(bloques[0]) && /×2</.test(bloques[1]) && /×5</.test(bloques[2]),
    "la cantidad va como chapita, incluso arriba de 3");
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

// ── La foto del pack también en los diseños sin foto de origen ──────────────
// Clásico, Compacto, Tarjetas grandes y Pastel tenían un cuadradito con el
// número: ahora muestran la foto si el comercio la cargó, y siguen igual que
// siempre si no la cargó.
const CON_FOTO = ["v01", "v03", "v05", "v09", "v11", "v12"];

test("(j) los diseños con lugar para foto la pintan cuando el pack la tiene", () => {
  const conFoto = plan([{ qty: 1, price_ars: 8900, image: FOTO }, { qty: 2, price_ars: 17800, image: FOTO }]);
  for (const v of CON_FOTO) {
    const { html } = renderBundle(buildBundleVM({ merchant: { widget_variant: v }, plan: conFoto }), {});
    assert.ok(html.includes(FOTO), `${v} muestra la foto`);
  }
});

test("(j) sin foto, los 12 diseños siguen andando y no dejan una imagen vacía", () => {
  const sinFoto = plan([{ qty: 1, price_ars: 8900 }, { qty: 2, price_ars: 17800 }]);
  for (const v of VARIANT_IDS) {
    const { html } = renderBundle(buildBundleVM({ merchant: { widget_variant: v }, plan: sinFoto }), {});
    assert.ok(html.length > 100, `${v} renderiza`);
    assert.ok(!html.includes("<img"), `${v} no deja un <img> sin src`);
  }
});

// ─── Packs distintos en cada modo (22-sept-2026, Thiago) ──────────────────
// Wellfresh vende 1/3/5 sueltos, pero por suscripción solo quiere ofrecer
// algunos, y con otra cantidad. Al tocar el toggle se repinta con la otra
// lista. Lo que NO puede pasar: que esconder un pack corra los índices y el
// cliente termine pagando otro pack (el checkout cobra por `pack_index`).
const PLAN_MIXTO = plan([
  { qty: 1, price_ars: 10000, label: "1u", hide_sub: true },
  { qty: 3, price_ars: 27000, label: "3u", default: true },
  { qty: 5, price_ars: 42000, label: "5u", hide_sub: true },
  { qty: 2, price_ars: 19000, label: "2u sub", hide_once: true, sub_qty: 4 },
]);
const indices = (html) => [...html.matchAll(/data-rc-action="pack" data-rc-value="(\d+)"/g)].map(m => Number(m[1]));

test("(j) cada modo muestra sus propios packs", () => {
  const vm = buildBundleVM({ plan: PLAN_MIXTO, merchant: { widget_variant: "v01" } });
  // normalizePacks ordena por qty, así que los índices salen de esa lista.
  const once = indices(renderBundle(vm, { mode: "once" }).html);
  const sub = indices(renderBundle(vm, { mode: "sub" }).html);
  assert.equal(once.length, 3, "compra única: 1u, 3u y 5u");
  assert.equal(sub.length, 2, "suscripción: solo 2 de los 4");
  for (const i of sub) assert.ok(!vm.packs.find(p => p.idx === i)?.hideSub);
  for (const i of once) assert.ok(!vm.packs.find(p => p.idx === i)?.hideOnce);
});

test("(j) esconder un pack NO corre el índice con el que se cobra", () => {
  const vm = buildBundleVM({ plan: PLAN_MIXTO, merchant: { widget_variant: "v01" } });
  const sub = indices(renderBundle(vm, { mode: "sub" }).html);
  // El índice que manda el widget tiene que resolver al MISMO pack en el server.
  for (const i of sub) {
    const p = resolvePack(PLAN_MIXTO, i);
    assert.ok(p, `idx ${i} tiene que existir en el server`);
    assert.equal(p.hideSub, false, `idx ${i} no puede estar escondido en sub`);
    const vmPack = vm.packs.find(x => x.idx === i);
    assert.equal(p.price, vmPack.priceOnce, `idx ${i}: el precio del server y el del widget son el mismo`);
  }
});

test("(j) la cantidad de suscripción puede diferir de la de compra única", () => {
  const packs = normalizePacks(PLAN_MIXTO.packs).packs;
  const dosSub = packs.findIndex(p => p.sub_qty === 4);
  assert.ok(dosSub >= 0, "se guardó sub_qty");
  const r = resolvePack({ ...PLAN_MIXTO, packs }, dosSub);
  assert.equal(r.qty, 2, "suelto: 2 unidades");
  assert.equal(r.subQty, 4, "suscripto: entrega 4");
  // Sin sub_qty, las dos cantidades son la misma (planes de siempre).
  const tres = packs.findIndex(p => p.qty === 3);
  assert.equal(resolvePack({ ...PLAN_MIXTO, packs }, tres).subQty, 3);
});

test("(j) un pack no puede quedar escondido en los dos modos", () => {
  const r = normalizePacks([{ qty: 1, price_ars: 100, hide_once: true, hide_sub: true }]);
  assert.ok(r.error, "tiene que rechazarlo");
});

test("(j) regalo ficticio: se guarda, se muestra y aclara que no es un producto", () => {
  const r = normalizePacks([{ qty: 1, price_ars: 10000, gifts: [
    { title: "Ebook de recetas", virtual: true, note: "Te llega por mail" },
  ] }]);
  assert.equal(r.error, undefined);
  assert.equal(r.packs[0].gifts[0].virtual, true);
  assert.equal(r.packs[0].gifts[0].note, "Te llega por mail");
  const vm = buildBundleVM({ plan: plan(r.packs), merchant: { widget_variant: "v12" } });
  const { html } = renderBundle(vm, { mode: "sub" });
  assert.ok(html.includes("Ebook de recetas"), "el regalo se pinta");
  assert.ok(html.includes("Te llega por mail"), "y su aclaración");
});

test("(j) los planes de siempre no cambian: sin los campos nuevos, todo igual", () => {
  const viejo = plan([
    { qty: 1, price_ars: 27500, label: "1", default: true },
    { qty: 2, price_ars: 50000, label: "2" },
  ]);
  const vm = buildBundleVM({ plan: viejo, merchant: { widget_variant: "v02" } });
  assert.equal(indices(renderBundle(vm, { mode: "once" }).html).length, 2);
  assert.equal(indices(renderBundle(vm, { mode: "sub" }).html).length, 2);
  for (let i = 0; i < 2; i++) {
    const r = resolvePack(viejo, i);
    assert.equal(r.subQty, r.qty, "la cantidad de suscripción es la de siempre");
    assert.equal(r.hideSub, false);
    assert.equal(r.hideOnce, false);
  }
});

// ─── Guardar un diseño nuevo no puede fallar por una lista escrita a mano ──
// 22-sept-2026: al agregar v13 el panel tiraba "widget_variant debe ser
// v01..v12" y no se podía guardar. La validación estaba hardcodeada en
// api/merchant.js en vez de salir de VARIANT_IDS.
test("(j) todos los diseños de la galería son guardables", async () => {
  const src = await import("node:fs").then(fs => fs.readFileSync("api/merchant.js", "utf8"));
  assert.ok(!/const WIDGET_VARIANT_RE = \/\^v\(/.test(src),
    "la validación no puede ser un regex escrito a mano: se desactualiza");
  assert.ok(/VARIANT_IDS/.test(src), "tiene que salir de VARIANT_IDS");
  // Y la galería y la lista de ids no se pueden separar.
  assert.deepEqual(BUNDLE_VARIANTS.map(v => v.id), VARIANT_IDS,
    "la galería y VARIANT_IDS tienen que tener los mismos diseños");
});

// ─── La misma cantidad puede estar en las dos listas ──────────────────────
// 22-sept-2026: con las listas separadas, un bloque de 2 en compra única y
// otro de 2 en suscripción (a otro precio) son bloques DISTINTOS. La
// validación los contaba juntos y tiraba "ya hay otro pack con cantidad 2".
test("(j) un bloque de 2 en cada lista es válido", () => {
  const r = normalizePacks([
    { qty: 2, price_ars: 54900, hide_sub: true },    // 2 suelto
    { qty: 2, price_ars: 93330, hide_once: true },   // 2 suscripto, otro precio
  ]);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.packs.length, 2);
  // Y cada índice conserva SU precio (es lo que cobra el checkout).
  const plan2 = plan(r.packs);
  const precios = r.packs.map((_, i) => resolvePack(plan2, i).price).sort((a, b) => a - b);
  assert.deepEqual(precios, [54900, 93330]);
});

test("(j) pero dos bloques de 2 en la MISMA lista se rechazan", () => {
  const r = normalizePacks([
    { qty: 2, price_ars: 100, hide_sub: true },
    { qty: 2, price_ars: 200, hide_sub: true },
  ]);
  assert.ok(r.error, "tiene que rechazarlo");
  assert.match(r.error, /compra única/);
});

// ─── Un bloque de SOLO suscripción no se puede perder al guardar ──────────
// 22-sept-2026, Thiago: "sigo poniendo envío gratis de un lado y se va
// copiando al otro". No se copiaba: el bloque de suscripción se descartaba al
// guardar (su precio vive en sub_price_ars y el filtro exigía price_ars), así
// que al recargar volvía UN pack compartido, visible en las dos columnas —y
// editar su badge cambiaba los dos, porque era el mismo dato.
test("(j) un pack de solo suscripción sobrevive al guardado", () => {
  const r = normalizePacks([
    { qty: 2, price_ars: 54900, badge: "Envío Gratis", hide_sub: true },
    { qty: 2, price_ars: 46665, sub_price_ars: 46665, badge: "Solo suscripción", hide_once: true },
  ]);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.packs.length, 2, "los dos bloques tienen que quedar");
  const once = r.packs.find(p => p.hide_sub === true);
  const sub = r.packs.find(p => p.hide_once === true);
  assert.equal(once.badge, "Envío Gratis");
  assert.equal(sub.badge, "Solo suscripción", "cada bloque con SU badge, no el del otro");
  assert.ok(sub.price_ars >= 1, "el backend exige price_ars >= 1 incluso en los de solo suscripción");
});

// ─── La píldora de descuento es texto del comerciante ─────────────────────
test("(j) el «−15%» se puede cambiar y apagar", () => {
  const p = plan([{ qty: 1, price_ars: 27500, default: true }]);
  const html = (texts) => renderBundle(buildBundleVM({ plan: p, merchant: { widget_variant: "v13", widget_texts: texts } }), { mode: "once" }).html;
  assert.match(html(undefined), /−15%/, "por defecto, como siempre");
  assert.match(html({ disc_label: "{pct}% OFF" }), /15% OFF/);
  assert.ok(!/rc-disc/.test(html({ disc_label: "x" })), "una x la apaga");
});

// ─── Grosor de los bordes (22-sept-2026, Thiago) ──────────────────────────
// Los 43 bordes del CSS están escritos a mano con grosores distintos (1, 1.5,
// 2, 2.5, 5, 6 px). En vez de enumerarlos, se multiplican por --rc-bw en el
// post-procesador, igual que el tamaño de letra.
test("(j) en 100 el CSS es idéntico: ninguna tienda cambia sola", () => {
  const p = plan([{ qty: 1, price_ars: 27500, default: true }]);
  const base = renderBundle(buildBundleVM({ plan: p, merchant: { widget_variant: "v13" } }), { mode: "sub" }).css;
  const cien = renderBundle(buildBundleVM({ plan: p, merchant: { widget_variant: "v13", widget_border_scale: 100 } }), { mode: "sub" }).css;
  assert.equal(cien, base);
});

test("(j) subiendo el grosor, los bordes se multiplican en las 13 variantes", () => {
  const p = plan([{ qty: 1, price_ars: 27500, default: true }]);
  for (const v of VARIANT_IDS) {
    const { css } = renderBundle(buildBundleVM({ plan: p, merchant: { widget_variant: v, widget_border_scale: 200 } }), { mode: "sub" });
    assert.match(css, /--rc-bw:2/, `${v}: la variable tiene que valer 2`);
    assert.ok(!/border:\s*[0-9.]+px\s+solid/.test(css), `${v}: no puede quedar un borde sin escalar`);
  }
});

// ─── Un regalo puede ir solo en el primer envío ───────────────────────────
// 25-sept-2026, Wellfresh: el raspador es un regalo FÍSICO y lo mandan una
// sola vez, no en cada renovación. La guía (un ebook) sí va siempre.
test("(j) el regalo elige si va en todos los envíos o solo en el primero", () => {
  const r = normalizePacks([{ qty: 3, price_ars: 65990, gifts: [
    { title: "Guía del mal aliento", virtual: true },
    { title: "Raspador de lengua", every: "once" },
  ] }]);
  assert.equal(r.error, undefined, r.error);
  const gs = r.packs[0].gifts;
  assert.equal(gs[0].every, "always", "sin el campo: en todos (como era antes)");
  assert.equal(gs[1].every, "once");

  // En suscripción se avisa; en compra única no tiene sentido (no hay renovación).
  const vm = buildBundleVM({ plan: plan(r.packs), merchant: { widget_variant: "v13" } });
  assert.match(renderBundle(vm, { mode: "sub" }).html, /Solo en tu primer envío/);
  assert.ok(!/Solo en tu primer envío/.test(renderBundle(vm, { mode: "once" }).html));
});
