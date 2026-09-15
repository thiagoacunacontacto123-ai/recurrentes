// Dos tiendas que cobran con la MISMA cuenta de Mercado Pago (caso real: LuminaLabs e
// INDATROPIC, 2026-09): el token de cualquiera de las dos lee el pago/preapproval, así
// que "el primero que lo lee" no dice de qué tienda es. Antes del arreglo, las
// renovaciones de la segunda tienda se descartaban ("no encontramos subscriber") y el
// sync no encontraba los preapprovals viejos (búsqueda por external_reference vacía).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createWorld, loadApi, subscriber, capsulasPlan, luminaMerchant, mpPayment, mpPreapproval, mpWebhookReq, noteMap,
  MID, MP_TOKEN, VARIANT_ID, VARIANT_PRICE, PLAN_ID,
} from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";
import { createFakeShopify } from "../helpers/fakes.mjs";

const { default: webhook } = await loadApi("api/mp/webhook.js");
const { syncSubscriber } = await loadApi("api/_lib/sync.js");

// Ordena DESPUÉS de Lumina: el webhook prueba primero con Lumina (mismo mp_user_id).
const OTRA = "zzz_indatropic";
const OTRA_SHOP = "indatropic-test.myshopify.com";
let W, otra;
beforeEach(() => {
  W = createWorld();
  seedDoc(`merchants/${OTRA}`, luminaMerchant({ store_name: "INDATROPIC", shopify_shop: OTRA_SHOP, shopify_token: "shpat_indatropic" }));
  seedDoc(`merchants/${OTRA}/plans/${PLAN_ID}`, capsulasPlan());
  otra = createFakeShopify(W.router, { shop: OTRA_SHOP, token: "shpat_indatropic", variants: { [VARIANT_ID]: VARIANT_PRICE }, name: "INDATROPIC" });
});
afterEach(() => { W.router.assertClean(); });

const otraSub = (id) => rawGet(`merchants/${OTRA}/subscribers/${id}`);
const deliver = (id, opts) => invoke(webhook, mpWebhookReq(id, opts));

test("renovación de la OTRA tienda (external_reference mid:sid) → la orden sale en ESA tienda", async () => {
  seedDoc(`merchants/${OTRA}/subscribers/sub_indi`, subscriber({ customer_email: "indi@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_indi" }));
  W.mp.addPayment(mpPayment({ id: 1310000200, amount: 12300, preapprovalId: "pre_indi", externalReference: `${OTRA}:sub_indi`, dateCreated: "2026-08-31T10:00:00.000-03:00" }), MP_TOKEN);

  const res = await deliver(1310000200);
  assert.equal(res.statusCode, 200);
  assert.equal(W.shopify.orderPosts.length, 0, "no tiene que crear la orden en Lumina");
  assert.equal(otra.orderPosts.length, 1, "la renovación de INDATROPIC quedó sin orden");
  assert.equal(noteMap(otra.orderPosts[0].order).recurrentes_subscriber_id, "sub_indi");
  const ch = rawGet(`merchants/${OTRA}/charges/1310000200`);
  assert.ok(ch?.shopify_order_id, "falta el cobro registrado en la otra tienda");
  assert.equal(rawGet(`merchants/${MID}/charges/1310000200`), undefined);
  assert.equal(otraSub("sub_indi").shopify_orders.length, 2);

  await deliver(1310000200); // reentrega: nada nuevo
  assert.equal(otra.orderPosts.length, 1);
});

test("renovación de la otra tienda SIN external_reference → la encuentra por el mismo mp_user_id", async () => {
  seedDoc(`merchants/${OTRA}/subscribers/sub_indi2`, subscriber({ customer_email: "indi2@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_indi2" }));
  W.mp.addPayment(mpPayment({ id: 1310000201, amount: 12300, preapprovalId: "pre_indi2" }), MP_TOKEN);

  await deliver(1310000201);
  assert.equal(W.shopify.orderPosts.length, 0);
  assert.equal(otra.orderPosts.length, 1);
  assert.ok(rawGet(`merchants/${OTRA}/charges/1310000201`)?.shopify_order_id);
});

test("un pago de Lumina sigue yendo a Lumina aunque haya otra tienda con la misma cuenta", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000202, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);
  await deliver(1310000202);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(otra.orderPosts.length, 0);
});

test("baja en MP de una suscripción de la otra tienda → se marca cancelada en ESA tienda", async () => {
  seedDoc(`merchants/${OTRA}/subscribers/sub_indi3`, subscriber({ customer_email: "indi3@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_indi3" }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_indi3", planId: null, status: "cancelled" }), MP_TOKEN);

  const res = await deliver("pre_indi3", { type: "subscription_preapproval" });
  assert.equal(res.statusCode, 200);
  const s = otraSub("sub_indi3");
  assert.equal(s.status, "cancelled", "la baja de la otra tienda no se registró");
  assert.ok(s.cancelled_at);
});

test("sync de una suscripción vieja (sin plan ad-hoc) cuyo preapproval no aparece en la búsqueda → usa el id guardado y crea la orden", async () => {
  W.seedSub("sub_vieja", subscriber({
    customer_email: "vieja@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_vieja",
    next_charge_at: "2026-08-31T13:00:00.000Z", last_charge_at: "2026-08-01T13:00:00.000Z", shopify_orders: [5550001],
  }));
  // external_reference null en el preapproval: la búsqueda por external_reference no lo encuentra (como pasa en MP).
  W.mp.addPreapproval(mpPreapproval({ id: "pre_vieja", planId: null, nextPaymentDate: "2026-09-30T10:00:00.000-03:00" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000210, amount: 12300, preapprovalId: "pre_vieja", externalReference: `${MID}:sub_vieja`, dateCreated: "2026-08-31T10:00:00.000-03:00" }), MP_TOKEN);

  const r = await syncSubscriber(MID, "sub_vieja");
  assert.equal(r.status, "active");
  assert.equal(r.orders_created, 1, "la renovación del 31/8 quedó sin orden");
  assert.equal(W.shopify.orderPosts.length, 1);
  const s = W.sub("sub_vieja");
  assert.equal(s.next_charge_at, "2026-09-30T10:00:00.000-03:00");
  assert.equal(s.shopify_orders.length, 2);

  const r2 = await syncSubscriber(MID, "sub_vieja"); // idempotente
  assert.equal(r2.orders_created, 0);
  assert.equal(W.shopify.orderPosts.length, 1);
});

test("tienda ARCHIVADA (tienda muerta): su renovación no crea orden en ningún lado ni la toca el sync", async () => {
  seedDoc(`merchants/${OTRA}`, luminaMerchant({ store_name: "INDATROPIC", shopify_shop: OTRA_SHOP, shopify_token: "shpat_indatropic", archived_at: "2026-09-15T20:00:00.000Z" }));
  seedDoc(`merchants/${OTRA}/subscribers/sub_muerta`, subscriber({ customer_email: "muerta@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_muerta" }));
  W.mp.addPayment(mpPayment({ id: 1310000230, amount: 12300, preapprovalId: "pre_muerta", externalReference: `${OTRA}:sub_muerta` }), MP_TOKEN);
  await deliver(1310000230);
  assert.equal(otra.orderPosts.length, 0, "no tiene que crear órdenes en la tienda archivada");
  assert.equal(W.shopify.orderPosts.length, 0, "tampoco en Lumina");
  const r = await syncSubscriber(OTRA, "sub_muerta");
  assert.equal(r.error, "merchant_archived");
  assert.equal(otra.orderPosts.length, 0);
});
