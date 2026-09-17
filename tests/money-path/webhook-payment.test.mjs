// (a)(b)(c) Webhook de MP → orden Shopify. Camino del dinero de Lumina:
// MP cobra → POST /api/mp/webhook → fulfillCharge → orden PAGA en Shopify.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createWorld, loadApi, subscriber, snapshot, mpPayment, mpPreapproval, mpWebhookReq, noteMap,
  MID, SHOP, MP_TOKEN, PLAN_ID, VARIANT_ID, PRODUCT_TITLE, APP, luminaMerchant,
} from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";
import { createFakeShopify } from "../helpers/fakes.mjs";

const { default: webhook } = await loadApi("api/mp/webhook.js");
const { generatePortalToken } = await loadApi("api/public.js");
const { merchantProfile } = await loadApi("shared/platform/profile.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const deliver = (pid, opts) => invoke(webhook, mpWebhookReq(pid, opts));

test("Lumina (sin campos de perfil) es físico + Shopify + Mercado Pago", () => {
  const p = merchantProfile(W.merchant());
  assert.equal(p.businessType, "physical");
  assert.equal(p.channel, "shopify");
  assert.equal(p.paymentProvider, "mercadopago");
  assert.equal(p.caps.requireAddress, true);
});

test("(a) renovación aprobada → UNA orden Shopify con el payload correcto + cobro registrado", async () => {
  W.seedSub("sub_ana", subscriber({
    quantity: 2,
    plan_snapshot: snapshot({ qty: 2, methodName: "Envío a domicilio (Andreani / Flex) — Prioritario", methodCode: "ANDREANI-PRIO" }),
  }));
  const pay = W.mp.addPayment(mpPayment({ id: 1310000002, amount: 23100, preapprovalId: "pre_ana", dateCreated: "2026-09-15T10:00:00.000-03:00" }), MP_TOKEN);

  const res = await deliver(pay.id);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });

  // Una sola orden, en la tienda de Lumina, con el token de Lumina.
  assert.equal(W.shopify.orderPosts.length, 1);
  const o = W.shopify.orderPosts[0].order;
  assert.deepEqual(o.line_items, [{ variant_id: VARIANT_ID, quantity: 2, price: "10800.00" }]);
  assert.deepEqual(o.shipping_lines, [{ title: "Envío a domicilio (Andreani / Flex) — Prioritario", price: "1500.00", code: "ANDREANI-PRIO" }]);
  assert.equal(o.tags, "RECURRENTE");
  assert.equal(o.financial_status, "paid");
  assert.deepEqual(o.transactions, [{ kind: "sale", status: "success", amount: "23100.00", currency: "ARS", gateway: "Mercado Pago" }]);
  assert.equal(o.currency, "ARS");
  assert.equal(o.taxes_included, true);
  assert.equal(o.source_name, "Recurrentes");
  assert.equal(o.send_receipt, true);
  assert.equal(o.inventory_behaviour, "decrement_ignoring_policy");
  assert.equal(o.note, "Suscripción Recurrentes · Charge #2\nDNI: 30123456");
  const expectedAddr = {
    address1: "Av. Siempreviva 742", address2: "3B", city: "CABA", province: "Buenos Aires", country_code: "AR",
    zip: "1414", first_name: "Ana", last_name: "Pérez", phone: "1155550000", company: "30123456",
  };
  assert.deepEqual(o.shipping_address, expectedAddr);
  assert.deepEqual(o.billing_address, expectedAddr);
  const notes = noteMap(o);
  assert.equal(notes.recurrentes_subscriber_id, "sub_ana");
  assert.equal(notes.recurrentes_plan_id, PLAN_ID);
  assert.equal(notes.recurrentes_charge_number, "2");
  assert.equal(notes.mp_payment_id, "1310000002");
  assert.equal(notes.mp_fee_real, "1386");
  assert.equal(notes.DNI, "30123456");
  assert.equal(notes.tax_id_kind, "DNI");

  // Cliente Shopify creado (no existía) con el DNI como tag, y la orden a su nombre.
  assert.equal(W.shopify.customers.length, 1);
  const c = W.shopify.customers[0];
  assert.deepEqual({ email: c.email, first_name: c.first_name, last_name: c.last_name, phone: c.phone, tags: c.tags },
    { email: "ana@cliente.test", first_name: "Ana", last_name: "Pérez", phone: "1155550000", tags: "recurrentes-subscriber, DNI:30123456" });
  assert.deepEqual(o.customer, { id: c.id });

  // Cobro registrado bajo charges/{payment.id}.
  const created = W.shopify.orders[0];
  const ch = W.charge("1310000002");
  assert.equal(ch.subscriber_id, "sub_ana");
  assert.equal(ch.mp_payment_id, "1310000002");
  assert.equal(ch.amount_ars, 23100);
  assert.equal(ch.status, "approved");
  assert.equal(ch.shopify_order_id, created.id);
  assert.equal(ch.shopify_order_status_url, created.order_status_url);
  assert.equal(ch.error, null);
  assert.equal(W.charges().length, 1);

  // Suscriptor: sigue activo, orden sumada y last_charge_at = fecha de aprobación de MP.
  const s = W.sub("sub_ana");
  assert.equal(s.status, "active");
  assert.deepEqual(s.shopify_orders, [5550001, created.id]);
  assert.equal(s.last_charge_at, pay.date_approved);
  assert.equal(s.last_shopify_order_status_url, created.order_status_url);

  // Renovación: sin mail transaccional, sin tocar el preapproval.
  assert.equal(W.resend.sent.length, 0);
  assert.equal(W.mp.preapprovalUpdates.length, 0);
  // Todas las llamadas a Shopify con el token de Lumina.
  assert.ok(W.shopifyCalls().every(c2 => c2.headers["x-shopify-access-token"] === "shpat_test_lumina"));
});

test("(a) el mismo pago entregado dos veces seguidas → sigue habiendo UNA orden", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000003, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);

  assert.equal((await deliver(1310000003)).statusCode, 200);
  assert.equal((await deliver(1310000003)).statusCode, 200);

  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.charges().length, 1);
  assert.equal(W.sub("sub_ana").shopify_orders.length, 2); // la previa + UNA nueva
});

test("(a) tres entregas EN PARALELO del mismo pago → UNA orden (claim atómico de chargeclaim)", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000004, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);
  // La búsqueda de órdenes de Shopify NO ve las recién creadas (peor caso): el
  // único freno a la orden duplicada es el claim de Firestore.
  W.shopify.searchSeesCreated = false;

  const results = await Promise.all([deliver(1310000004), deliver(1310000004), deliver(1310000004)]);
  assert.ok(results.every(r => r.statusCode === 200));
  assert.equal(W.shopify.orderPosts.length, 1, "se creó más de una orden para el mismo pago");
  assert.equal(W.sub("sub_ana").shopify_orders.length, 2);
  assert.ok(W.charge("1310000004").shopify_order_id);
});

test("(b) primer cobro → activa, crea la orden #1 y manda el mail de activación (una vez)", async () => {
  const portalToken = generatePortalToken(MID, "sub_bruno", 180);
  W.seedSub("sub_bruno", subscriber({
    customer_email: "bruno@cliente.test", customer_name: "Bruno Díaz", customer_phone: "1166660000",
    status: "pending", mp_preapproval_plan_id: "plan_adhoc_bruno", mp_preapproval_id: null, mp_preapproval_status: null,
    next_charge_at: null, last_charge_at: null, shopify_orders: [], portal_token: portalToken,
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_bruno", planId: "plan_adhoc_bruno" }), MP_TOKEN);
  const pay = W.mp.addPayment(mpPayment({ id: 1310000010, amount: 12300, preapprovalId: "pre_bruno" }), MP_TOKEN);

  const res = await deliver(pay.id);
  assert.equal(res.statusCode, 200);

  // Resolvió la sub por preapproval → preapproval_plan_id (el flujo de plan no manda external_reference).
  const s = W.sub("sub_bruno");
  assert.equal(s.status, "active");
  assert.equal(s.mp_preapproval_id, "pre_bruno");
  assert.equal(s.mp_preapproval_status, "authorized");
  assert.equal(s.next_charge_at, "2026-10-15T10:00:00.000-03:00");
  assert.equal(s.last_charge_at, pay.date_approved);
  assert.equal(s.shopify_orders.length, 1);

  assert.equal(W.shopify.orderPosts.length, 1);
  const o = W.shopify.orderPosts[0].order;
  assert.deepEqual(o.line_items, [{ variant_id: VARIANT_ID, quantity: 1, price: "10800.00" }]);
  assert.equal(o.shipping_lines[0].price, "1500.00");
  assert.equal(o.transactions[0].amount, "12300.00");
  assert.equal(noteMap(o).recurrentes_charge_number, "1");

  // Mail de activación (Resend) con la marca de la tienda y el link al portal.
  assert.equal(W.resend.sent.length, 1);
  const mail = W.resend.sent[0];
  assert.deepEqual(mail.to, ["bruno@cliente.test"]);
  assert.equal(mail.subject, `¡Suscripción activa — ${PRODUCT_TITLE}!`);
  assert.equal(mail.from, "LuminaLabs <hola@recurrentesapp.com>");
  assert.deepEqual(mail.tags, [{ name: "type", value: "activation" }]);
  assert.ok(mail.html.includes(`${APP}/#/portal?token=${encodeURIComponent(portalToken)}`), "el mail no trae el link al portal");
  assert.ok(mail.html.includes("12.300"), "el mail no muestra el monto cobrado");
  assert.ok(mail.text && mail.text.length > 20, "falta la versión texto");
  const log = W.emailLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].type, "activation");
  assert.equal(log[0].status, "sent");
  assert.equal(log[0].subscriber_id, "sub_bruno");

  // Reentrega del mismo pago: ni otra orden ni otro mail.
  await deliver(pay.id);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.resend.sent.length, 1);
});

test("(b) después de activar, la renovación suma la orden y mueve last_charge_at (sin mail)", async () => {
  W.seedSub("sub_bruno", subscriber({
    customer_email: "bruno@cliente.test", customer_name: "Bruno Díaz",
    status: "pending", mp_preapproval_plan_id: "plan_adhoc_bruno", mp_preapproval_id: null,
    last_charge_at: null, shopify_orders: [],
  }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_bruno", planId: "plan_adhoc_bruno" }), MP_TOKEN);
  const first = W.mp.addPayment(mpPayment({ id: 1310000011, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-08-15T10:00:00.000-03:00" }), MP_TOKEN);
  const second = W.mp.addPayment(mpPayment({ id: 1310000012, amount: 12300, preapprovalId: "pre_bruno", dateCreated: "2026-09-14T10:00:00.000-03:00" }), MP_TOKEN);

  await deliver(first.id);
  const after1 = W.sub("sub_bruno");
  await deliver(second.id);
  const after2 = W.sub("sub_bruno");

  assert.equal(W.shopify.orderPosts.length, 2);
  assert.equal(noteMap(W.shopify.orderPosts[1].order).recurrentes_charge_number, "2");
  assert.equal(after2.shopify_orders.length, 2);
  assert.deepEqual(after2.shopify_orders.slice(0, 1), after1.shopify_orders);
  assert.equal(after1.last_charge_at, first.date_approved);
  assert.equal(after2.last_charge_at, second.date_approved);
  assert.equal(after2.status, "active");
  assert.equal(W.resend.byType("activation").length, 1, "la renovación no tiene que mandar otro mail de activación");
  assert.equal(W.resend.sent.length, 1);
});

test("(c) pago rechazado de una renovación → payment_failed + UN mail (dedup por payment id)", async () => {
  const portalToken = generatePortalToken(MID, "sub_ana", 180);
  W.seedSub("sub_ana", subscriber({ portal_token: portalToken }));
  const rej = W.mp.addPayment(mpPayment({ id: 1310000020, status: "rejected", amount: 12300, preapprovalId: "pre_ana", dateCreated: "2026-09-15T10:00:00.000-03:00" }), MP_TOKEN);

  await deliver(rej.id);
  await deliver(rej.id); // MP reentrega el mismo aviso

  const s = W.sub("sub_ana");
  assert.equal(s.status, "payment_failed");
  assert.equal(s.last_payment_failed_id, "1310000020");
  assert.equal(s.last_payment_failed_at, rej.date_created);
  assert.equal(s.last_charge_at, "2026-08-16T13:00:00.000Z", "un rechazo no mueve last_charge_at");

  assert.equal(W.resend.sent.length, 1);
  const mail = W.resend.sent[0];
  assert.deepEqual(mail.to, ["ana@cliente.test"]);
  assert.equal(mail.subject, `Hubo un problema con tu pago — ${PRODUCT_TITLE}`);
  assert.deepEqual(mail.tags, [{ name: "type", value: "payment_failed" }]);
  assert.ok(mail.html.includes(`${APP}/#/portal?token=${encodeURIComponent(portalToken)}`));
  const log = W.emailLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].type, "payment_failed");

  // Nada de Shopify ni cobros por un rechazo.
  assert.equal(W.shopifyCalls().length, 0);
  assert.equal(W.charges().length, 0);

  // MP reintenta y aprueba → vuelve a active, crea la orden y no manda mail de activación.
  const ok = W.mp.addPayment(mpPayment({ id: 1310000021, amount: 12300, preapprovalId: "pre_ana", dateCreated: "2026-09-17T10:00:00.000-03:00" }), MP_TOKEN);
  await deliver(ok.id);
  const s2 = W.sub("sub_ana");
  assert.equal(s2.status, "active");
  assert.equal(s2.shopify_orders.length, 2);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.resend.sent.length, 1);
});

test("(c) primer pago rechazado de un checkout nuevo → queda pending, sin mail (no spam a leads)", async () => {
  W.seedSub("sub_lead", subscriber({
    customer_email: "lead@cliente.test", status: "pending", mp_preapproval_id: "pre_lead",
    last_charge_at: null, shopify_orders: [],
  }));
  W.mp.addPayment(mpPayment({ id: 1310000022, status: "rejected", amount: 12300, preapprovalId: "pre_lead" }), MP_TOKEN);
  await deliver(1310000022);
  assert.equal(W.sub("sub_lead").status, "pending");
  assert.equal(W.resend.sent.length, 0);
  assert.equal(W.shopifyCalls().length, 0);
});

test("sin dirección: si pagó, la orden se crea IGUAL con tag FALTA-DIRECCION", async () => {
  W.seedSub("sub_sindir", subscriber({ customer_email: "sindir@cliente.test", shipping_address: null, mp_preapproval_id: "pre_sindir" }));
  W.mp.addPayment(mpPayment({ id: 1310000031, amount: 12300, preapprovalId: "pre_sindir" }), MP_TOKEN);
  await deliver(1310000031);
  assert.equal(W.shopify.orderPosts.length, 1);
  const o = W.shopify.orderPosts[0].order;
  assert.equal(o.tags, "RECURRENTE, FALTA-DIRECCION");
  assert.equal(o.shipping_address.address1, "");
  assert.equal(o.shipping_address.country_code, "AR");
  assert.equal(W.sub("sub_sindir").shopify_orders.length, 2);
});

test("cantidad 3 con centavos: la suma de los ítems + envío cierra EXACTO contra lo cobrado", async () => {
  W.seedSub("sub_tres", subscriber({ customer_email: "tres@cliente.test", mp_preapproval_id: "pre_tres", quantity: 3, plan_snapshot: { ...snapshot({ qty: 3, shipping: 0 }), total_per_charge_ars: 10000 } }));
  W.mp.addPayment(mpPayment({ id: 1310000032, amount: 10000, preapprovalId: "pre_tres" }), MP_TOKEN);
  await deliver(1310000032);
  const o = W.shopify.orderPosts[0].order;
  assert.deepEqual(o.line_items, [
    { variant_id: VARIANT_ID, quantity: 1, price: "3333.34" },
    { variant_id: VARIANT_ID, quantity: 2, price: "3333.33" },
  ]);
  const sum = o.line_items.reduce((a, li) => a + Number(li.price) * li.quantity, 0) + Number(o.shipping_lines[0].price);
  assert.equal(Math.round(sum * 100), 1000000);
  assert.equal(o.transactions[0].amount, "10000.00");
});

test("cobro tardío de una sub CANCELADA: crea la orden (el cliente pagó) pero no la revive", async () => {
  W.seedSub("sub_cancel", subscriber({ customer_email: "cancel@cliente.test", mp_preapproval_id: "pre_cancel", status: "cancelled", cancelled_at: "2026-09-10T00:00:00.000Z" }));
  W.mp.addPayment(mpPayment({ id: 1310000033, amount: 12300, preapprovalId: "pre_cancel" }), MP_TOKEN);
  await deliver(1310000033);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(W.sub("sub_cancel").status, "cancelled");
});

test("si Shopify falla, el cobro queda con error y la reentrega de MP crea la orden (mail de activación recién ahí)", async () => {
  W.seedSub("sub_bruno", subscriber({
    customer_email: "bruno@cliente.test", status: "pending", mp_preapproval_id: "pre_bruno", last_charge_at: null, shopify_orders: [],
  }));
  W.mp.addPayment(mpPayment({ id: 1310000040, amount: 12300, preapprovalId: "pre_bruno" }), MP_TOKEN);
  W.router.failNext("POST", SHOP, /\/orders\.json$/, { status: 422, json: { errors: { base: ["Variant is out of stock"] } } });

  await deliver(1310000040);
  const ch = W.charge("1310000040");
  assert.equal(ch.shopify_order_id, null);
  assert.match(ch.error, /Shopify POST \/orders\.json/);
  const s = W.sub("sub_bruno");
  assert.equal(s.last_charge_at, null, "sin orden no se marca el cobro");
  assert.deepEqual(s.shopify_orders, []);
  assert.equal(W.resend.sent.length, 0, "sin orden no sale el mail de activación");

  await deliver(1310000040);
  const ch2 = W.charge("1310000040");
  assert.ok(ch2.shopify_order_id);
  assert.equal(ch2.error, null);
  assert.equal(W.sub("sub_bruno").shopify_orders.length, 1);
  assert.equal(W.shopify.orders.length, 1);
  assert.equal(W.resend.byType("activation").length, 1);
});

test("la función murió después de crear la orden y antes de guardar el cobro: la reutiliza, no crea otra", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000050, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);
  W.shopify.searchSeesCreated = true;
  W.shopify.orders.push({ id: 5559999, created_at: new Date().toISOString(), order_status_url: "https://x/5559999", note_attributes: [{ name: "mp_payment_id", value: "1310000050" }] });

  await deliver(1310000050);
  assert.equal(W.shopify.orderPosts.length, 0);
  assert.equal(W.charge("1310000050").shopify_order_id, 5559999);
  assert.deepEqual(W.sub("sub_ana").shopify_orders, [5550001, 5559999]);
});

test("aviso sin user_id: itera merchants y crea la orden SOLO en la tienda dueña del pago", async () => {
  // Otra tienda que ordena antes que Lumina y con su propio MP/Shopify.
  seedDoc("merchants/aaa_otra_tienda", luminaMerchant({ mp_access_token: "APP_USR-otra", mp_user_id: 555, shopify_shop: "otra.myshopify.com", shopify_token: "shpat_otra", store_name: "Otra" }));
  const otra = createFakeShopify(W.router, { shop: "otra.myshopify.com", token: "shpat_otra", variants: { [VARIANT_ID]: 1 } });
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000060, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);

  const res = await deliver(1310000060, { userId: null });
  assert.equal(res.statusCode, 200);
  assert.equal(W.shopify.orderPosts.length, 1);
  assert.equal(otra.orderPosts.length, 0);
  // Probó primero con el token de la otra tienda (MP respondió 404) y después con el de Lumina.
  const gets = W.router.find({ host: "api.mercadopago.com", method: "GET", path: /^\/v1\/payments\/1310000060$/ });
  assert.deepEqual(gets.map(c => c.headers.authorization), ["Bearer APP_USR-otra", `Bearer ${MP_TOKEN}`]);
});

test("firma de MP: con MP_WEBHOOK_SIGNING_SECRET rechaza la firma inválida (401) y acepta la válida", async (t) => {
  process.env.MP_WEBHOOK_SIGNING_SECRET = "sig-secret-test";
  t.after(() => { delete process.env.MP_WEBHOOK_SIGNING_SECRET; });
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000070, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);

  const bad = await deliver(1310000070, { headers: { "x-signature": "ts=1700000000,v1=deadbeef", "x-request-id": "req-1" } });
  assert.equal(bad.statusCode, 401);
  assert.equal(W.router.calls.length, 0, "con firma inválida no se toca MP ni Shopify");

  const ts = "1757940000";
  const manifest = `id:1310000070;request-id:req-2;ts:${ts};`;
  const v1 = crypto.createHmac("sha256", "sig-secret-test").update(manifest).digest("hex");
  const good = await deliver(1310000070, { headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-2" } });
  assert.equal(good.statusCode, 200);
  assert.equal(W.shopify.orderPosts.length, 1);
});

test("GET/HEAD de healthcheck de MP → 200 sin hacer nada", async () => {
  const res = await invoke(webhook, { method: "GET", query: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(W.router.calls.length, 0);
});

// ── Sin firma configurada el webhook es público: tope por IP para el aviso que
// NO dice de qué tienda es (sin ?mid= ni user_id). Ese caso hace leer TODOS los
// merchants con MP y pegarle a MP con cada token: es la vía para quemar lecturas
// de Firestore y el rate limit de MP desde afuera.
test("sin firma ni hint de tienda: el aviso anónimo está limitado por IP", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPayment(mpPayment({ id: 1310000080, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);

  let last;
  for (let i = 0; i < 61; i++) {
    last = await invoke(webhook, mpWebhookReq(1310000080, {
      userId: null, headers: { "x-forwarded-for": "203.0.113.9" },
    }));
  }
  assert.equal(last.statusCode, 429, "pasado el tope, el aviso anónimo se rechaza");
});

test("el aviso legítimo de MP (con ?mid=&sid=) nunca entra al tope por IP", async () => {
  W.seedSub("sub_ana", subscriber());
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000081, amount: 12300, preapprovalId: "pre_ana" }), MP_TOKEN);

  // Muy por encima del tope por IP: el aviso que identifica la tienda no se limita.
  for (let i = 0; i < 70; i++) {
    const res = await invoke(webhook, mpWebhookReq(1310000081, {
      query: { mid: MID, sid: "sub_ana" }, headers: { "x-forwarded-for": "203.0.113.10" },
    }));
    assert.equal(res.statusCode, 200, `entrega ${i + 1} tiene que pasar`);
  }
  assert.equal(W.shopify.orderPosts.length, 1, "y sigue creando UNA sola orden");
});
