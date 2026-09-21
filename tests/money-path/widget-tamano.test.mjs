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
