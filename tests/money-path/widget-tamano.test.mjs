// (w) Ajustes de tamaño del widget (21-sept-2026, Thiago): letra y alto de los
// recuadros ±20 %, y si se pega a los bordes del contenedor.
//
// La regla que importa: con los valores por defecto el CSS servido tiene que
// quedar IDÉNTICO al de antes. Si esto se rompe, todas las tiendas que ya están
// vendiendo cambian de aspecto sin que nadie toque nada.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApi } from "../helpers/world.mjs";

const { buildBundleVM } = await loadApi("shared/bundle/viewmodel.js");
const { renderBundle } = await loadApi("shared/bundle/templates.js");

const PLAN = {
  pricing_mode: "packs", discount_pct: 15, frequency_days: 30,
  packs: [{ qty: 1, price_ars: 10000 }, { qty: 2, price_ars: 18000 }, { qty: 3, price_ars: 24000 }],
};
const css = (merchant = {}, variant = "v01") =>
  renderBundle(buildBundleVM({ plan: PLAN, merchant: { widget_variant: variant, ...merchant } }), {}).css;

test("(w) por defecto NO cambia nada: mismo CSS que antes de existir esto", () => {
  const base = css();
  assert.equal(css({ widget_scale: 100, widget_box_scale: 100, widget_edge_to_edge: false }), base,
    "los defaults tienen que ser un no-op byte a byte");
  assert.ok(!base.includes("var(--rc-fs)"), "sin tocar nada no se mete ni un calc()");
  assert.ok(!base.includes("var(--rc-bs)"));
  assert.ok(!base.includes("margin-left:0;margin-right:0"));
});

test("(w) la letra escala en las 12 variantes sin perder sus proporciones", () => {
  for (const v of ["v01","v02","v03","v04","v05","v06","v07","v08","v09","v10","v11","v12"]) {
    const chico = css({ widget_scale: 80 }, v);
    assert.ok(chico.includes("--rc-fs:0.8"), `${v}: falta la variable`);
    assert.ok(/font-size:calc\([0-9.]+px \* var\(--rc-fs\)\)/.test(chico), `${v}: no escaló ningún font-size`);
    // Ya no puede quedar ningún font-size en px suelto: todos pasan por calc().
    const sinCalc = chico.replace(/calc\([^)]*\)/g, "");
    assert.ok(!/font-size:\s*[0-9.]+px/.test(sinCalc), `${v}: quedó un font-size sin escalar`);
  }
});

test("(w) ±20 % y ni uno más: el tope se respeta", () => {
  assert.ok(css({ widget_scale: 80 }).includes("--rc-fs:0.8"));
  assert.ok(css({ widget_scale: 120 }).includes("--rc-fs:1.2"));
  // Valores fuera de rango se capean, no rompen el widget.
  assert.ok(css({ widget_scale: 500 }).includes("--rc-fs:1.2"), "500 se capea a 120");
  assert.ok(css({ widget_scale: 10 }).includes("--rc-fs:0.8"), "10 se capea a 80");
  assert.ok(css({ widget_scale: "abc" }).includes("--rc-fs:1") || css({ widget_scale: "abc" }) === css({}),
    "basura = default");
});

test("(w) el alto de los recuadros se mueve sin tocar la letra", () => {
  const c = css({ widget_box_scale: 120 });
  assert.ok(/padding:calc\([0-9.]+px \* var\(--rc-bs\)\)/.test(c), "el padding vertical escala");
  assert.ok(!c.includes("var(--rc-fs)"), "la letra NO se toca si solo movés los recuadros");
});

test("(w) pegado a los bordes ocupa todo el ancho", () => {
  const c = css({ widget_edge_to_edge: true });
  assert.ok(c.includes("margin-left:0;margin-right:0;width:100%"));
  assert.ok(!css({ widget_edge_to_edge: false }).includes("margin-left:0;margin-right:0"));
});

test("(w) los tres juntos conviven", () => {
  const c = css({ widget_scale: 120, widget_box_scale: 80, widget_edge_to_edge: true });
  assert.ok(c.includes("--rc-fs:1.2"));
  assert.ok(c.includes("--rc-bs:0.8"));
  assert.ok(c.includes("width:100%"));
});

test("(w) el widget sin packs tampoco se rompe", () => {
  const vacio = renderBundle(buildBundleVM({ plan: { pricing_mode: "packs", packs: [] }, merchant: { widget_scale: 120 } }), {});
  assert.ok(vacio.css.includes("--rc-fs:1.2"));
  assert.ok(typeof vacio.html === "string");
});

// ─── El backend no acepta cualquier cosa ───────────────────────────────────
import { createWorld, luminaMerchant, MID } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";
const { default: merchantApi } = await loadApi("api/merchant.js");

// El diseñador guarda por save-settings (un solo Guardar para todo el diseño).
const guardar = (body) => invoke(merchantApi, {
  method: "PATCH", query: { action: "save-settings" },
  headers: { authorization: `Bearer test:${MID}` }, body,
});

test("(w) el server guarda los tres valores y rechaza los inválidos", async () => {
  createWorld({ merchant: luminaMerchant() });
  const ok = await guardar({ widget_scale: 120, widget_box_scale: 80, widget_edge_to_edge: true });
  assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
  const m = rawGet(`merchants/${MID}`);
  assert.equal(m.widget_scale, 120);
  assert.equal(m.widget_box_scale, 80);
  assert.equal(m.widget_edge_to_edge, true);

  for (const malo of [{ widget_scale: 200 }, { widget_scale: 50 }, { widget_scale: 100.5 }, { widget_box_scale: 0 }]) {
    const r = await guardar(malo);
    assert.equal(r.statusCode, 400, `tendría que rechazar ${JSON.stringify(malo)}`);
  }
  // Y no pisó lo que ya estaba bien guardado.
  assert.equal(rawGet(`merchants/${MID}`).widget_scale, 120);
});

// ─── Textos propios de cada modo (21-sept-2026, Thiago) ────────────────────
// "que todos los textos sean editables, tanto de compra única como de
// suscripción; que se dividan en dos el editor de textos".
// Antes: las líneas con tilde eran SOLO de suscripción y en compra única no
// aparecía nada más que el candado, sin forma de escribir nada ahí.
const { renderBundle: render2 } = await loadApi("shared/bundle/templates.js");
const html = (widget_texts, state = {}) =>
  render2(buildBundleVM({ plan: PLAN, merchant: { widget_variant: "v01", widget_texts } }), state).html;

test("(w) sin cargar nada, compra única se ve como siempre", () => {
  const base = html(undefined, { mode: "once" });
  assert.equal(html({}, { mode: "once" }), base);
  assert.ok(base.includes("Pago seguro con Mercado Pago"), "el candado sigue");
});

test("(w) cada modo muestra SUS líneas y no las del otro", () => {
  const t = { trust_lines: ["Cancelás cuando quieras"], trust_lines_once: ["Envío en 48 horas"] };
  const sub = html(t, { mode: "sub" }), once = html(t, { mode: "once" });
  assert.ok(sub.includes("Cancelás cuando quieras") && !sub.includes("Envío en 48 horas"));
  assert.ok(once.includes("Envío en 48 horas") && !once.includes("Cancelás cuando quieras"));
});

test("(w) el texto libre de cada modo se pinta solo en el suyo", () => {
  const t = { note_sub: "ZZTELLEGA", note_once: "QQUNAVEZ" };
  const sub = html(t, { mode: "sub" }), once = html(t, { mode: "once" });
  assert.ok(sub.includes("ZZTELLEGA") && !sub.includes("QQUNAVEZ"));
  assert.ok(once.includes("QQUNAVEZ") && !once.includes("ZZTELLEGA"));
  // Vacío = no se pinta el bloque.
  assert.ok(!html({ note_sub: "" }, { mode: "sub" }).includes('class="rc-note"'));
});

test("(w) los textos del comerciante se escapan (no se inyecta HTML)", () => {
  const malo = '<img src=x onerror=alert(1)>';
  for (const t of [{ note_sub: malo }, { trust_lines_once: [malo] }]) {
    const h = html(t, { mode: t.note_sub ? "sub" : "once" });
    assert.ok(!/<img [^>]*onerror/i.test(h), "no puede entrar un tag vivo");
  }
});

test("(w) el server guarda los textos de los dos modos", async () => {
  createWorld({ merchant: luminaMerchant() });
  const r = await guardar({ widget_texts: {
    note_sub: "Te llega sola cada mes", note_once: "Sin renovación",
    trust_lines: ["Cancelás cuando quieras"], trust_lines_once: ["Envío en 48 horas"],
  } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const t = rawGet(`merchants/${MID}`).widget_texts;
  assert.equal(t.note_sub, "Te llega sola cada mes");
  assert.equal(t.note_once, "Sin renovación");
  assert.deepEqual(t.trust_lines_once, ["Envío en 48 horas"]);
  // Y el tipo equivocado se rechaza en vez de guardarse mal.
  const malo = await guardar({ widget_texts: { trust_lines_once: "no es un array" } });
  assert.equal(malo.statusCode, 400);
});

// ─── Texto propio de cada pack + cantidad en la frecuencia (21-sept) ──────
// Thiago: "en el pack de dos meses quiero poner tratamiento bimensual, en el
// de cuatro tratamiento ultra; hoy solo se puede cambiar todo generalizado".
// Y: "que diga te llegan X cada 12 meses, la cantidad de potes".
const PLAN_NOTAS = {
  pricing_mode: "packs", discount_pct: 15, frequency_days: 30, frequency_scales_with_qty: true,
  packs: [
    { qty: 1, price_ars: 10000, label: "1 pote" },
    { qty: 2, price_ars: 18000, label: "Pack 2", note: "Tratamiento bimensual" },
    { qty: 4, price_ars: 32000, label: "Pack 4", note: "Tratamiento ultra" },
  ],
};
const htmlNotas = (variant, state = {}, merchant = {}) =>
  render2(buildBundleVM({ plan: PLAN_NOTAS, merchant: { widget_variant: variant, ...merchant } }), state).html;

test("(w) cada pack muestra SU texto, no uno general", () => {
  // 11 de 12: v03 son píldoras de 64px y no le entra (está documentado).
  const conNota = ["v01","v02","v04","v05","v06","v08","v09","v10","v11","v12"];
  for (const v of conNota) {
    const h = htmlNotas(v);
    assert.ok(h.includes("Tratamiento bimensual"), `${v}: falta la nota del pack de 2`);
    assert.ok(h.includes("Tratamiento ultra"), `${v}: falta la nota del pack de 4`);
  }
  // Un pack sin nota no pinta el bloque vacío.
  const sinNota = render2(buildBundleVM({ plan: { ...PLAN_NOTAS, packs: [{ qty: 1, price_ars: 10000 }] }, merchant: { widget_variant: "v01" } }), {}).html;
  assert.ok(!sinNota.includes("rc-pnote"), "sin nota no se pinta nada");
});

test("(w) la nota del pack se escapa", () => {
  const h = render2(buildBundleVM({
    plan: { ...PLAN_NOTAS, packs: [{ qty: 1, price_ars: 10000, note: '<img src=x onerror=alert(1)>' }] },
    merchant: { widget_variant: "v01" },
  }), {}).html;
  assert.ok(!/<img [^>]*onerror/i.test(h));
});

test("(w) la frecuencia dice CUÁNTOS le llegan", () => {
  const dos = htmlNotas("v01", { mode: "sub", selectedIdx: 1 });
  assert.ok(dos.includes("Te llegan 2 cada"), "el pack de 2 tiene que decir la cantidad");
  // Con uno solo no tiene sentido "Te llegan 1".
  const uno = htmlNotas("v01", { mode: "sub", selectedIdx: 0 });
  assert.ok(uno.includes("Te llega cada") && !uno.includes("Te llegan 1"));
  // Si el comerciante escribió su prefijo, manda el suyo.
  const propio = htmlNotas("v01", { mode: "sub", selectedIdx: 1 }, { widget_texts: { freq_prefix: "Lo recibís cada" } });
  assert.ok(propio.includes("Lo recibís cada") && !propio.includes("Te llegan"));
});

test("(w) el server guarda la nota de cada pack", async () => {
  const { normalizePacks } = await loadApi("api/_lib/packs.js");
  const r = normalizePacks([
    { qty: 2, price_ars: 18000, label: "Pack 2", note: "  Tratamiento bimensual  " },
    { qty: 4, price_ars: 32000, label: "Pack 4" },
  ]);
  assert.ok(!r.error, r.error);
  assert.equal(r.packs[0].note, "Tratamiento bimensual", "se guarda con trim");
  assert.equal(r.packs[1].note, "", "sin nota queda vacía, no undefined");
  // Tope de largo: no puede reventar el doc ni el diseño.
  const largo = normalizePacks([{ qty: 1, price_ars: 100, note: "x".repeat(500) }]);
  assert.equal(largo.packs[0].note.length, 120);
});

// ─── Apagar un texto con una "x" (21-sept-2026, Thiago) ───────────────────
// Dejar el campo vacío no alcanza: el widget cae al texto por defecto y vuelve
// a aparecer. Con una "x" sola la sección entera desaparece.
const VARIANTES = ["v01","v02","v03","v04","v05","v06","v07","v08","v09","v10","v11","v12"];
const htmlX = (widget_texts, v = "v01", state = {}) =>
  render2(buildBundleVM({ plan: PLAN_NOTAS, merchant: { widget_variant: v, widget_texts } }), state).html;
// El aria-label del radiogroup conserva el título a propósito (accesibilidad):
// se mira solo lo que el comprador VE.
const visible = (h) => h.replace(/aria-label="[^"]*"/g, "");

test('(w) una "x" apaga el texto en las 12 variantes', () => {
  for (const v of VARIANTES) {
    assert.ok(/Elegí tu pack/.test(htmlX({}, v)), `${v}: el título tiene que estar sin la x`);
    assert.ok(!/Elegí tu pack/.test(visible(htmlX({ headline: "x" }, v))), `${v}: el título no se apagó`);
    assert.ok(!/c\/u/.test(htmlX({ per_unit_label: "x" }, v)), `${v}: el por-unidad no se apagó`);
    assert.ok(!/Ahorrás/.test(htmlX({ savings_label: "X" }, v, { mode: "sub" })), `${v}: el ahorro no se apagó`);
  }
});

test('(w) solo apaga una "x" SOLA, no un texto que la contenga', () => {
  assert.ok(htmlX({ headline: "xl" }).includes("xl"), '"xl" es un título válido');
  assert.ok(htmlX({ headline: "Pack x2" }).includes("Pack x2"));
  // Con espacios alrededor sí apaga: es el mismo tipeo.
  assert.ok(!visible(htmlX({ headline: " x " })).includes("Elegí tu pack"));
  assert.ok(!visible(htmlX({ headline: "X" })).includes("Elegí tu pack"));
});

test('(w) una línea de confianza en "x" se borra, las otras quedan', () => {
  const h = htmlX({ trust_lines: ["x", "Envío gratis"] }, "v01", { mode: "sub" });
  assert.ok(h.includes("Envío gratis"));
  assert.ok(!/>x</.test(h), "la línea apagada no se dibuja");
});

test('(w) la "x" sobrevive el guardado (el server no la borra)', async () => {
  createWorld({ merchant: luminaMerchant() });
  const r = await guardar({ widget_texts: { headline: "x", per_unit_label: "x" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const t = rawGet(`merchants/${MID}`).widget_texts;
  assert.equal(t.headline, "x", "se guarda la x, el sanitizer del widget la interpreta");
  assert.equal(t.per_unit_label, "x");
});

// ─── El texto del pack cambia según el modo (21-sept-2026, Thiago) ────────
// "Que aparezca lo que quiere que diga cuando está puesto suscripción y lo que
// diga cuando está puesto compra." Mismo renglón, distinto texto.
test("(w) cada pack tiene un texto para suscripción y otro para compra única", () => {
  const plan = {
    pricing_mode: "packs", discount_pct: 15, frequency_days: 30,
    packs: [
      { qty: 4, price_ars: 32000, label: "Pack 4", note: "Tratamiento 4 meses", note_once: "4 potes sueltos" },
      { qty: 1, price_ars: 10000, label: "1 pote", note: "Solo tiene el de sub" },
    ],
  };
  const h = (mode) => render2(buildBundleVM({ plan, merchant: { widget_variant: "v01" } }), { mode }).html;
  const sub = h("sub"), once = h("once");
  assert.ok(sub.includes("Tratamiento 4 meses"), "en suscripción va el suyo");
  assert.ok(!sub.includes("4 potes sueltos"), "y no el de compra única");
  assert.ok(once.includes("4 potes sueltos"), "en compra única va el suyo");
  assert.ok(!once.includes("Tratamiento 4 meses"));
  // 24-sept-2026 (Thiago, caso Wellfresh): cada modo muestra SOLO su texto.
  // Antes, sin `note_once` se caía al de suscripción, así que algo escrito
  // para el bloque de suscripción ("Prueba inicial") aparecía también en
  // compra única. Vacío es vacío: no se pinta nada.
  assert.ok(!once.includes("Solo tiene el de sub"), "sin note_once NO se pinta el de suscripción");
  assert.ok(sub.includes("Solo tiene el de sub"), "pero sí se muestra en suscripción");
});

test("(w) el server guarda los dos textos del pack", async () => {
  const { normalizePacks } = await loadApi("api/_lib/packs.js");
  const r = normalizePacks([{ qty: 4, price_ars: 32000, note: "  Tratamiento 4 meses ", note_once: "4 potes" }]);
  assert.ok(!r.error, r.error);
  assert.equal(r.packs[0].note, "Tratamiento 4 meses");
  assert.equal(r.packs[0].note_once, "4 potes");
  // Sin el segundo queda vacío (no undefined), que es lo que el widget lee para
  // decidir si cae al de suscripción.
  assert.equal(normalizePacks([{ qty: 1, price_ars: 100, note: "x" }]).packs[0].note_once, "");
});

// ─── Días o meses, por bloque (24-sept-2026, Thiago) ─────────────────────
// Wellfresh necesita "cada 60 días" y Lumina "cada 2 meses". Default: días.
test("(w) cada bloque elige si la frecuencia se muestra en días o en meses", async () => {
  const { freqLabel } = await import("../../shared/bundle/viewmodel.js");
  assert.equal(freqLabel(60), "60 días", "sin unidad, días");
  assert.equal(freqLabel(60, "meses"), "2 meses");
  assert.equal(freqLabel(30, "meses"), "mes", "singular");
  assert.equal(freqLabel(7, "meses"), "7 días", "menos de un mes cae a días");

  const { normalizePacks } = await loadApi("api/_lib/packs.js");
  const r = normalizePacks([
    { qty: 2, price_ars: 54900, freq_unit: "meses" },
    { qty: 3, price_ars: 65990 },
    { qty: 4, price_ars: 70000, freq_unit: "basura" },
  ]);
  assert.equal(r.error, undefined, r.error);
  assert.equal(r.packs.find(p => p.qty === 2).freq_unit, "meses");
  assert.equal(r.packs.find(p => p.qty === 3).freq_unit, "dias", "sin el campo: días");
  assert.equal(r.packs.find(p => p.qty === 4).freq_unit, "dias", "un valor inválido cae a días");
});

// ─── El renglón del cuadro de suscripción es editable en LOS DOS modos ────
// 25-sept-2026, Thiago: "acá escribo y no cambia nada". Con el cuadro TILDADO
// se salía por freqText() sin mirar `sub_hint`, así que el campo solo servía
// con el cuadro apagado y parecía roto.
test("(w) sub_hint manda tildado y destildado", () => {
  const plan = {
    pricing_mode: "packs", discount_pct: 10, frequency_days: 30,
    packs: [{ qty: 2, price_ars: 54900, default: true }],
  };
  const MIO = "Te llega solo, sin que hagas nada";
  const renglon = (texts, mode) => {
    const html = render2(buildBundleVM({ plan, merchant: { widget_variant: "v13", widget_texts: texts } }), { mode }).html;
    const i = html.indexOf("rc-sub-txt");
    const j = html.indexOf("<small", i);
    return html.slice(j, html.indexOf("</small>", j)).replace(/<[^>]*>/g, "");
  };
  assert.equal(renglon({ sub_hint: MIO }, "sub"), MIO, "tildado: el texto del comerciante");
  assert.equal(renglon({ sub_hint: MIO }, "once"), MIO, "apagado: el mismo");
  // Sin cargarlo, los automáticos de siempre (cada modo el suyo).
  assert.match(renglon({}, "sub"), /Te llegan 2 cada/);
  assert.match(renglon({}, "once"), /Activalo y te llega solo/);
});

// ─── Sacar el precio del botón y la pastilla de frecuencia ───────────────
// 25-sept-2026, pedido de Wellfresh: "compra única, sacarle el precio en el
// botón" y "lo que está tachado quiero sacarlo" (la pastilla del pack).
// Se apagan con una "x", igual que el resto de los textos.
test("(w) el precio del botón y la frecuencia del pack se pueden apagar", () => {
  const plan = {
    pricing_mode: "packs", discount_pct: 10, frequency_days: 30,
    packs: [{ qty: 2, price_ars: 54900, default: true }],
  };
  const h = (texts, mode) => render2(buildBundleVM({ plan, merchant: { widget_variant: "v13", widget_texts: texts } }), { mode }).html;

  // Sin tocar nada, como siempre.
  assert.match(h({}, "once"), /rc-cta-price/, "el botón trae el precio");
  assert.match(h({}, "sub"), /rc-fq/, "y el pack la pastilla");

  // Con la "x" se van, sin llevarse nada más.
  const sinPrecio = h({ cta_price: "x" }, "once");
  assert.ok(!/rc-cta-price/.test(sinPrecio), "x: el botón queda sin precio");
  assert.match(sinPrecio, /Agregar al carrito/, "pero conserva su etiqueta");

  const sinFreq = h({ pack_freq: "x" }, "sub");
  assert.ok(!/rc-fq/.test(sinFreq), "x: se va la pastilla de frecuencia");
});
