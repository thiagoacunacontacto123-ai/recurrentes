// El link decide con qué modo arranca la ficha (27-sept-2026, Thiago).
//
// Wellfresh tiene Compra única por defecto. Para una campaña que vende la
// suscripción, mandar a ?rec_modo=sub hace que la ficha ya abra en Suscripción,
// sin cambiarle la configuración a la tienda ni armar una página aparte.
//
// Es solo cuál arranca ELEGIDA: el comprador puede cambiar de modo igual.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget } = await loadApi("api/widget.js");

beforeEach(() => {
  createWorld();
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
});

const script = async () => (await invoke(widget, { method: "GET", query: { merchant: MID } })).body;

// El widget corre en el navegador: acá se ejecuta el pedacito que lee la URL,
// que es exactamente lo que va en el script servido.
function modoConLink(modoTienda, search) {
  let MODE_DEFAULT = modoTienda;
  const location = { search };
  try {
    const _m = /[?&]rec_modo=(sub|once)(&|$)/i.exec(location.search || "");
    if (_m) MODE_DEFAULT = _m[1].toLowerCase();
  } catch (e) {}
  return MODE_DEFAULT;
}

test("el script que se sirve trae la lectura del link", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_mode_default: "once" }));
  const js = await script();
  assert.match(js, /var MODE_DEFAULT = "once"/, "arranca con el de la tienda");
  assert.match(js, /rec_modo=\(sub\|once\)/, "y después mira el link");
});

test("con Compra única por defecto, el link lo pasa a Suscripción", () => {
  assert.equal(modoConLink("once", "?rec_modo=sub"), "sub");
  assert.equal(modoConLink("once", "?utm_source=meta&rec_modo=sub"), "sub", "convive con los utm de la campaña");
  assert.equal(modoConLink("once", "?rec_modo=sub&variant=123"), "sub");
});

test("y al revés: una tienda con Suscripción por defecto puede mandar a Compra única", () => {
  assert.equal(modoConLink("sub", "?rec_modo=once"), "once");
});

test("sin el parámetro, manda lo que configuró la tienda", () => {
  assert.equal(modoConLink("once", ""), "once");
  assert.equal(modoConLink("sub", "?utm_source=meta"), "sub");
});

test("no se le hace caso a cualquier cosa", () => {
  assert.equal(modoConLink("once", "?rec_modo=otra"), "once", "un valor inventado no cambia nada");
  assert.equal(modoConLink("once", "?rec_modo="), "once", "vacío tampoco");
  assert.equal(modoConLink("once", "?x=rec_modo=sub"), "once", "tiene que ser un parámetro de verdad");
  assert.equal(modoConLink("once", "?xrec_modo=sub"), "once", "ni pegado a otro nombre");
});
