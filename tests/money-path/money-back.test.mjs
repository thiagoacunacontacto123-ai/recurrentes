// Aviso de "te devolvieron un cobro" (api/_lib/moneyBack.js), 27-sept-2026.
//
// Lo que protege: que el comerciante se entere de que una orden PAGA en su
// tienda ya no está paga. Nosotros no podemos cancelarla, así que el aviso es
// todo lo que tiene entre enterarse y despachar plata que perdió.
//
// Y sobre todo: que esto NUNCA rompa el camino del cobro. Cuelga del webhook de
// Mercado Pago; si falla, falla solo.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet, rawPaths } from "../helpers/fake-firestore.mjs";

const MB = await loadApi("api/_lib/moneyBack.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { try { W.restore?.(); } catch (_) {} });

// Un cobro que ya generó su orden en la tienda.
const cobro = (paymentId, orderId = "8105502146758") =>
  seedDoc(`merchants/${MID}/charges/pre-1`, {
    subscriber_id: "sub_1", mp_payment_id: String(paymentId), amount_ars: 40491,
    status: "approved", shopify_order_id: orderId, created_at: "2026-09-27T15:30:30.000Z",
  });
const sub = { customer_name: "Ana Díaz", customer_email: "ana@cliente.test", plan_snapshot: { product_title: "Café de especialidad 250 g" } };

test("un contracargo deja el aviso con la orden que hay que cancelar", async () => {
  cobro("181148741548");
  await MB.flagMoneyBack(MID, { paymentId: "181148741548", kind: "chargeback", subscriberId: "sub_1", amount: 40491, sub });

  const d = rawGet(`merchants/${MID}/money_back/181148741548`);
  assert.equal(d.kind, "chargeback");
  assert.equal(d.status, "open");
  assert.equal(d.shopify_order_id, "8105502146758", "sin el id de orden el aviso no sirve para nada");
  assert.equal(d.customer_name, "Ana Díaz");
  assert.equal(d.product_title, "Café de especialidad 250 g");
  assert.equal(d.amount_ars, 40491);
});

test("el webhook de MP repite el evento: el comerciante ve UN aviso, no tres", async () => {
  cobro("999");
  for (let i = 0; i < 3; i++) await MB.flagMoneyBack(MID, { paymentId: "999", kind: "refunded", subscriberId: "sub_1", sub });
  const avisos = rawPaths().filter(p => p.startsWith(`merchants/${MID}/money_back/`));
  assert.equal(avisos.length, 1);
});

test("un reclamo que termina en contracargo sube de motivo; nunca baja", async () => {
  cobro("1000");
  await MB.flagMoneyBack(MID, { paymentId: "1000", kind: "claim", subscriberId: "sub_1", sub });
  assert.equal(rawGet(`merchants/${MID}/money_back/1000`).kind, "claim");

  await MB.flagMoneyBack(MID, { paymentId: "1000", kind: "chargeback", subscriberId: "sub_1", sub });
  assert.equal(rawGet(`merchants/${MID}/money_back/1000`).kind, "chargeback", "lo peor manda");

  await MB.flagMoneyBack(MID, { paymentId: "1000", kind: "refunded", subscriberId: "sub_1", sub });
  assert.equal(rawGet(`merchants/${MID}/money_back/1000`).kind, "chargeback", "no vuelve atrás");
});

test("lo que ya resolvió no se vuelve a levantar solo", async () => {
  cobro("1001");
  await MB.flagMoneyBack(MID, { paymentId: "1001", kind: "chargeback", subscriberId: "sub_1", sub });
  await MB.resolveMoneyBack(MID, "1001");
  assert.equal(rawGet(`merchants/${MID}/money_back/1001`).status, "done");

  // MP vuelve a mandar el mismo evento una semana después.
  await MB.flagMoneyBack(MID, { paymentId: "1001", kind: "chargeback", subscriberId: "sub_1", sub });
  assert.equal(rawGet(`merchants/${MID}/money_back/1001`).status, "done", "no le reaparece el cartel");
  assert.equal((await MB.listMoneyBack(MID)).length, 0);
});

test("la lista trae solo los abiertos, los nuevos primero", async () => {
  seedDoc(`merchants/${MID}/money_back/a`, { payment_id: "a", kind: "refunded", status: "open", created_at: "2026-09-20T10:00:00.000Z" });
  seedDoc(`merchants/${MID}/money_back/b`, { payment_id: "b", kind: "chargeback", status: "open", created_at: "2026-09-26T10:00:00.000Z" });
  seedDoc(`merchants/${MID}/money_back/c`, { payment_id: "c", kind: "claim", status: "done", created_at: "2026-09-27T10:00:00.000Z" });
  const items = await MB.listMoneyBack(MID);
  assert.deepEqual(items.map(i => i.payment_id), ["b", "a"]);
});

test("un cobro sin orden (tienda sin Shopify) igual avisa: la plata volvió lo mismo", async () => {
  await MB.flagMoneyBack(MID, { paymentId: "2000", kind: "refunded", subscriberId: "sub_1", amount: 12000, sub });
  const d = rawGet(`merchants/${MID}/money_back/2000`);
  assert.equal(d.shopify_order_id, null);
  assert.equal(d.amount_ars, 12000);
});

test("qué estado de MP cuenta como plata que volvió", () => {
  assert.equal(MB.kindFromPaymentStatus("charged_back"), "chargeback");
  assert.equal(MB.kindFromPaymentStatus("refunded"), "refunded");
  // Un rechazo NO es plata que volvió: nunca se cobró ni se creó la orden.
  assert.equal(MB.kindFromPaymentStatus("rejected"), null);
  assert.equal(MB.kindFromPaymentStatus("approved"), null);
  assert.equal(MB.kindFromPaymentStatus("cancelled"), null);
  assert.equal(MB.kindFromPaymentStatus(undefined), null);
});

test("nunca rompe el camino del cobro: datos basura no lanzan", async () => {
  // Cuelga del webhook de MP. Si esto tira, se cae el procesamiento del pago.
  assert.equal(await MB.flagMoneyBack(MID, { paymentId: "", kind: "chargeback" }), null);
  assert.equal(await MB.flagMoneyBack(MID, { paymentId: "3000", kind: "inventado" }), null);
  assert.equal(await MB.flagMoneyBack(null, { paymentId: "3000", kind: "refunded" }), null);
  assert.equal(await MB.flagMoneyBack(MID, {}), null);
  assert.equal(rawGet(`merchants/${MID}/money_back/3000`), undefined);
});

test("resolver algo que no existe avisa, no explota", async () => {
  const r = await MB.resolveMoneyBack(MID, "no-existe");
  assert.match(r.error, /ya no existe/i);
});
