// (g) DELETE /api/subscribers?id=X — borrar un suscriptor desde el panel.
//
// Lo que protege: borrar el suscriptor SIN haber cancelado el preapproval en MP
// deja a Mercado Pago cobrándole al cliente todos los meses, y sin el doc en
// Firestore ningún cobro puede convertirse en orden ni aparecer en el panel.
// Plata que entra sin que nadie la vea y cliente que paga sin recibir nada.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, subscriber, mpPreapproval, MID, MP_TOKEN } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";

const { default: subsHandler } = await loadApi("api/subscribers.js");
const auth = { authorization: `Bearer test:${MID}` };

let W;
beforeEach(() => {
  W = createWorld();
  W.seedSub("sub_ana", subscriber({ status: "active", mp_preapproval_id: "pre_ana" }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
});
afterEach(() => { W.router.assertClean(); });

const del = (query = {}) => invoke(subsHandler, { method: "DELETE", query: { id: "sub_ana", ...query }, headers: auth });

test("(g) borrar una sub activa: primero la cancela en MP y recién ahí borra", async () => {
  const res = await del();

  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    W.mp.preapprovalUpdates.map(u => [u.id, u.body.status]),
    [["pre_ana", "cancelled"]],
    "tiene que cancelar el preapproval en MP",
  );
  assert.equal(rawGet(`merchants/${MID}/subscribers/sub_ana`), undefined, "y recién ahí borrar el doc");
});

test("(g) si MP NO confirma la baja, la sub NO se borra (si no, seguiría cobrando invisible)", async () => {
  W.router.failNext("PUT", "api.mercadopago.com", /^\/preapproval\/pre_ana$/,
    { status: 500, json: { message: "internal_error", status: 500 } });

  const res = await del();

  assert.equal(res.statusCode, 502);
  assert.equal(res.body.code, "mp_cancel_failed");
  assert.ok(rawGet(`merchants/${MID}/subscribers/sub_ana`), "la sub sigue existiendo");
  assert.equal(rawGet(`merchants/${MID}/subscribers/sub_ana`).status, "active");
});

test("(g) ?force=1 borra igual: para subs viejas cuyo preapproval ya no existe en MP", async () => {
  W.router.failNext("PUT", "api.mercadopago.com", /^\/preapproval\/pre_ana$/,
    { status: 500, json: { message: "internal_error", status: 500 } });

  const res = await del({ force: "1" });

  assert.equal(res.statusCode, 200);
  assert.equal(rawGet(`merchants/${MID}/subscribers/sub_ana`), undefined);
});

test("(g) preapproval que ya no existe en MP (404): borra sin bloquear", async () => {
  W.router.failNext("PUT", "api.mercadopago.com", /^\/preapproval\/pre_ana$/,
    { status: 404, json: { message: "preapproval not found", status: 404 } });

  const res = await del();

  assert.equal(res.statusCode, 200);
  assert.equal(rawGet(`merchants/${MID}/subscribers/sub_ana`), undefined);
});
