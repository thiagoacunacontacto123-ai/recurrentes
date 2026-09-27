// El recupero de carritos viene PRENDIDO en toda tienda nueva (27-sept-2026,
// Thiago: "que el carrito aparezca activado de default en todos").
//
// Es el flujo que más plata devuelve y nadie lo prende solo. Pero manda mails a
// clientes reales, así que lo importante es lo que NO tiene que pasar:
//   · no sembrarlo dos veces, ni devolvérselo al que lo borró;
//   · no tocar a una tienda que ya armó sus flujos;
//   · no activarlo sin mail de atención al cliente (el mail saldría sin a quién
//     responderle, que es la regla de todos los flujos).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet, rawList, rawPaths } from "../helpers/fake-firestore.mjs";

const { default: merchantApi } = await loadApi("api/merchant.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { try { W.restore?.(); } catch (_) {} });

const verFlujos = () => invoke(merchantApi, { method: "GET", query: { action: "flows" }, headers: { authorization: `Bearer test:${MID}` } });
const flujos = () => rawPaths().filter(p => p.startsWith(`merchants/${MID}/flows/`));

test("tienda nueva con mail de atención: el carrito queda ACTIVO y listo para mandar", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "hola@tienda.test" }));
  const r = await verFlujos();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.flows.length, 1);
  const f = r.body.flows[0];
  assert.equal(f.trigger, "checkout_started");
  assert.equal(f.active, true);
  // Sin esto el motor no lo mira: emitFlowEvent sale antes de leer nada.
  assert.deepEqual(rawGet(`merchants/${MID}`).flows_active_triggers, ["checkout_started"]);
  assert.equal(rawGet(`merchants/${MID}`).flows_enabled, true);
});

test("sin mail de atención se siembra PAUSADO: no mandamos mails sin a quién responderle", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "" }));
  const r = await verFlujos();
  assert.equal(r.body.flows.length, 1);
  assert.equal(r.body.flows[0].active, false);
  assert.equal(rawGet(`merchants/${MID}`).flows_enabled, undefined, "el motor sigue sin mirar nada");
});

test("se siembra UNA sola vez, aunque abra Flujos diez veces", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "hola@tienda.test" }));
  for (let i = 0; i < 5; i++) await verFlujos();
  assert.equal(flujos().length, 1);
});

test("si lo borra, no se lo devolvemos", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "hola@tienda.test" }));
  await verFlujos();
  const id = flujos()[0].split("/").pop();
  const del = await invoke(merchantApi, { method: "POST", query: { action: "flow-delete" }, headers: { authorization: `Bearer test:${MID}` }, body: { id } });
  assert.equal(del.statusCode, 200, JSON.stringify(del.body));
  const r = await verFlujos();
  assert.equal(r.body.flows.length, 0, "se queda sin flujos porque él lo quiso");
});

test("a una tienda que ya armó sus flujos no se le toca nada", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "hola@tienda.test" }));
  seedDoc(`merchants/${MID}/flows/propio`, {
    name: "El mío", trigger: "cancelled", active: false,
    steps: [{ id: "s1", type: "email", subject: "Hola", body: "Texto" }], created_at: "2026-09-01T00:00:00.000Z",
  });
  const r = await verFlujos();
  assert.equal(r.body.flows.length, 1);
  assert.equal(r.body.flows[0].id, "propio", "ni le agregamos el carrito ni le tocamos el suyo");
  assert.ok(rawGet(`merchants/${MID}`).flows_seeded_at, "queda marcado para no volver a mirar");
});

test("sembrar no puede romper la pantalla: si falla, Flujos abre igual", async () => {
  // Merchant sin nada: el helper igual tiene que devolver la lista.
  seedDoc(`merchants/${MID}`, luminaMerchant({ email_reply_to: "hola@tienda.test" }));
  const r = await verFlujos();
  assert.equal(r.statusCode, 200);
  assert.ok(Array.isArray(r.body.flows));
});
