// (s) Puesta en marcha (shared/platform/setup.js): la checklist del Admin y el
// pedido de accesos que se le manda al cliente.
//
// Lo que protege: que un paso ya hecho NO se vuelva a pedir (quedar como el que
// pide dos veces la misma clave es lo que hace perder una venta), que un
// permiso faltante se nombre con el id exacto de Shopify, y que la lista de
// scopes salga de la MISMA fuente que el OAuth y no de una copia.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApi } from "../helpers/world.mjs";

const S = await loadApi("shared/platform/setup.js");
const { SHOPIFY_REQUIRED_SCOPE_IDS } = await loadApi("shared/platform/shopify.js");

const TODOS = SHOPIFY_REQUIRED_SCOPE_IDS.join(",");
const listo = {
  owner_whatsapp: "+5492664006599", contact_email: "ana@glowderm.test",
  shopify_token: "shpat_x", shopify_scopes: TODOS, mp_access_token: "APP_USR-x",
  widget_verified_at: "2026-09-20T10:00:00Z", email_reply_to: "hola@glowderm.test",
};

test("(s) una cuenta vacía no tiene ningún paso hecho", () => {
  const r = S.buildSetup({});
  assert.equal(r.done, 0);
  assert.ok(r.total >= 8, "la checklist tiene todos los pasos que cuentan");
  assert.ok(!r.steps.find(s => s.id === "meta").opcional === false, "el pixel de Meta es opcional");
});

test("(s) los pasos ya hechos se tildan solos, sin que nadie los toque", () => {
  const r = S.buildSetup(listo, { ctx: { planes_activos: 2, subs: 5 } });
  const by = Object.fromEntries(r.steps.map(s => [s.id, s.done]));
  assert.deepEqual(
    { contacto: by.contacto, tienda: by.tienda, permisos: by.permisos, mp: by.mp, plan: by.plan, widget: by.widget, marca: by.marca, cobro: by.cobro },
    { contacto: true, tienda: true, permisos: true, mp: true, plan: true, widget: true, marca: true, cobro: true });
  // El pago de la instalación es a mano: no se puede detectar y no se inventa.
  assert.equal(by.pago, false);
  assert.equal(r.done, r.total - 1, "solo falta el que se tilda a mano");
});

test("(s) un permiso que falta se nombra con el id exacto de Shopify", () => {
  const sinOrders = { ...listo, shopify_scopes: SHOPIFY_REQUIRED_SCOPE_IDS.filter(x => x !== "write_orders").join(",") };
  const r = S.buildSetup(sinOrders, { ctx: { planes_activos: 1, subs: 1 } });
  assert.deepEqual(r.faltan_scopes, ["write_orders"]);
  assert.equal(r.steps.find(s => s.id === "permisos").done, false);
  // Y el texto que se le pide sale de la fuente del OAuth, no de una copia.
  assert.ok(r.steps.find(s => s.id === "permisos").pide.includes("write_orders"));
});

test("(s) una conexión vieja sin scopes guardados no inventa que falta algo", () => {
  // Antes de guardar shopify_scopes había tiendas conectadas y andando: marcarles
  // permisos faltantes las mandaría a reconectar sin motivo.
  const vieja = { ...listo, shopify_scopes: "" };
  assert.deepEqual(S.scopesFaltantes(vieja), []);
  assert.equal(S.buildSetup(vieja, { ctx: { planes_activos: 1, subs: 1 } }).steps.find(s => s.id === "permisos").done, true);
});

test("(s) los pasos manuales se tildan y se destildan", () => {
  const r = S.buildSetup(listo, { manual: ["pago"], ctx: { planes_activos: 1, subs: 1 } });
  assert.equal(r.steps.find(s => s.id === "pago").done, true);
  assert.equal(r.done, r.total, "con el pago cobrado queda completa");
});

test("(s) el pedido de accesos trae SOLO lo que falta", () => {
  const r = S.buildSetup({ owner_whatsapp: "+549", contact_email: "a@b.test" });
  const txt = S.pedidoDeAccesos(r, { nombre: "Ana Díaz" });
  assert.ok(txt.startsWith("Hola Ana!"), "usa el nombre de pila");
  assert.match(txt, /Acceso a tu tienda/);
  assert.match(txt, /Conectar tu Mercado Pago/);
  // Los datos de contacto ya los tenemos: pedirlos otra vez queda pésimo.
  assert.ok(!/Tu nombre, tu WhatsApp/.test(txt), "no vuelve a pedir lo que ya dio");
  // El widget y el primer cobro no son cosas que el cliente pueda "dar": no
  // tienen `mensaje`, así que nunca entran al pedido.
  assert.ok(!/[Ww]idget/.test(txt));
  assert.ok(!/primer cobro/i.test(txt));
  // Ni los opcionales ni los que se tildan a mano.
  assert.ok(!/Pixel/.test(txt));
  assert.ok(!/USD 100/.test(txt));
});

test("(s) el pedido está escrito AL cliente, no copiado de la checklist interna", () => {
  // El bug que esto evita: los textos de la ficha están en tercera persona
  // ("que entre a su cuenta de Mercado Pago") porque los lee Thiago. Pegados
  // tal cual en un WhatsApp al cliente se leen como un machete interno.
  const r = S.buildSetup({});
  const txt = S.pedidoDeAccesos(r, { nombre: "Ana" });
  for (const frase of ["Que te sume", "que entre a su", "si prefiere pegarlo", "Qué producto vende", "quiere que le respondan", "Su Pixel ID"]) {
    assert.ok(!txt.includes(frase), `el pedido no puede traer el texto interno: "${frase}"`);
  }
  // Y cada paso que se le pide al cliente tiene su versión en segunda persona.
  for (const st of r.steps) {
    if (st.mensaje) assert.ok(st.mensaje !== st.pide, `${st.id}: el mensaje al cliente no puede ser el texto interno`);
  }
});

test("(s) con todo listo, el pedido dice que no hace falta nada", () => {
  const r = S.buildSetup(listo, { ctx: { planes_activos: 1, subs: 1 } });
  assert.match(S.pedidoDeAccesos(r), /Ya tengo todo lo que necesito/);
});

test("(s) los permisos que se muestran son los mismos que pide el OAuth", () => {
  // Si alguien agrega un scope en shopify.js y esta lista no lo trae, el
  // instructivo del Admin manda a pedir permisos incompletos.
  const ids = S.SHOPIFY_PERMISOS.map(p => p.id);
  for (const id of SHOPIFY_REQUIRED_SCOPE_IDS) assert.ok(ids.includes(id), `falta ${id} en SHOPIFY_PERMISOS`);
  assert.ok(S.SHOPIFY_PERMISOS.every(p => p.why), "cada permiso explica para qué es");
});
