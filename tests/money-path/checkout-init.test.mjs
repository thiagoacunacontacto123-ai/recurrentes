// (e) POST /api/checkout/init para el merchant legacy (Lumina): arma el plan
// ad-hoc de MP (preapproval_plan) con el monto calculado SERVER-SIDE, back_url y
// notification_url desde APP_BASE_URL, y deja el suscriptor en pending.
// Nota: el código crea un `preapproval_plan` por sub (flujo de plan), no un
// `preapproval` directo; MP crea el preapproval cuando el cliente confirma.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, PRODUCT_ID, VARIANT_ID, PRODUCT_TITLE, MP_TOKEN, APP, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { verifyPortalToken } = await loadApi("api/public.js");
const { DEFAULT_CHECKOUT_SHIPPING_RATES } = await loadApi("api/widget.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const STANDARD = DEFAULT_CHECKOUT_SHIPPING_RATES[0];   // Lumina: estándar $0
const PRIORITY = DEFAULT_CHECKOUT_SHIPPING_RATES[1];   // Lumina: prioritario $5900

const body = (over = {}) => ({
  merchant_id: MID,
  plan_id: PLAN_ID,
  customer: { email: "  Dani@Cliente.Test ", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
  shipping_address: { ...ADDRESS },
  ...over,
});
const post = (b) => invoke(init, { method: "POST", query: {}, body: b, headers: { "x-forwarded-for": "190.1.2.3" } });

test("(e) Lumina (modelo tema): precio validado contra Shopify, plan MP con monto/back_url/notification_url correctos y sub pending", async () => {
  const res = await post(body({ quantity: 3, frequency_days: 90, base_price: 30000, sub_discount: 10, shipping_method: { name: STANDARD.name, code: "" } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const { subscriber_id: sid, init_point, preapproval_plan_id, portal_token } = res.body;
  assert.equal(res.body.ok, true);
  assert.ok(sid);

  // Precio de lista leído de Shopify (no se confía en el body) y cacheado.
  const vcalls = W.router.find({ host: "lumina-test.myshopify.com", path: /\/variants\/4001\.json$/ });
  assert.equal(vcalls.length, 1);
  assert.equal(rawGet(`merchants/${MID}/variant_prices/${VARIANT_ID}`).price, 12000);

  // Plan ad-hoc en MP: base 30000 × (1 − 10%) = 27000, envío estándar $0, cada 90 días.
  assert.equal(W.mp.plansCreated.length, 1);
  const created = W.mp.plansCreated[0];
  assert.equal(created.token, MP_TOKEN);
  assert.deepEqual(created.body, {
    reason: `${PRODUCT_TITLE} × 3 — cada 90 días`,
    auto_recurring: { frequency: 90, frequency_type: "days", transaction_amount: 27000, currency_id: "ARS" },
    back_url: `${APP}/#/checkout-success?sub=${sid}&token=${encodeURIComponent(portal_token)}`,
    notification_url: `${APP}/api/mp/webhook?mid=${MID}&sid=${sid}`,
    payment_methods_allowed: { payment_types: [{ id: "credit_card" }, { id: "debit_card" }, { id: "account_money" }], payment_methods: [] },
  });
  assert.equal(preapproval_plan_id, created.id);
  assert.equal(init_point, `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${created.id}`);

  // Token del portal: firmado para ESTA sub de ESTE merchant.
  const payload = verifyPortalToken(portal_token);
  assert.equal(payload.mid, MID);
  assert.equal(payload.sid, sid);

  // Suscriptor pending con todo lo que necesita la orden Shopify futura.
  const s = W.sub(sid);
  assert.equal(s.status, "pending");
  assert.equal(s.capture, false);
  assert.equal(s.customer_email, "dani@cliente.test");
  assert.equal(s.customer_name, "Dani Gómez");
  assert.equal(s.customer_phone, "1144440000");
  assert.equal(s.customer_tax_id, "20301234567");
  assert.equal(s.customer_tax_id_kind, "CUIT");
  assert.deepEqual(s.shipping_address, { ...ADDRESS, address2: "3B", first_name: "Dani", last_name: "Gómez", phone: "1144440000" });
  assert.equal(s.plan_id, PLAN_ID);
  assert.equal(s.quantity, 3);
  assert.equal(s.mp_preapproval_plan_id, created.id);
  assert.equal(s.mp_init_point, init_point);
  assert.equal(s.portal_token, portal_token);
  assert.deepEqual(s.shopify_orders, []);
  assert.ok(s.created_at && s.checkout_started_at);
  const ps = s.plan_snapshot;
  assert.equal(ps.shopify_variant_id, VARIANT_ID);
  assert.equal(ps.shopify_product_id, PRODUCT_ID);
  assert.equal(ps.product_title, PRODUCT_TITLE);
  assert.equal(ps.business_type, "physical");
  assert.equal(ps.channel, "shopify");
  assert.equal(ps.frequency_days, 90);
  assert.equal(ps.units_per_shipment, 3);
  assert.equal(ps.subtotal_ars, 27000);
  assert.equal(ps.shipping_price_ars, 0);
  assert.equal(ps.shipping_method_name, STANDARD.name);
  assert.equal(ps.total_per_charge_ars, 27000);
  assert.match(s.recover_path, /qty=3/);
  assert.match(s.recover_path, /freq_days=90/);
  assert.match(s.recover_path, /base=30000/);

  assert.equal(W.resend.sent.length, 0);
  assert.equal(W.shopify.orderPosts.length, 0);
});

test("(e) por unidad + envío prioritario legacy de Lumina: el precio del envío sale del server, no del body", async () => {
  const res = await post(body({ quantity: 2, shipping_method: { name: PRIORITY.name, code: "", price: 0 } }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const created = W.mp.plansCreated[0].body;
  assert.equal(created.auto_recurring.transaction_amount, 10800 * 2 + 5900);
  assert.equal(created.auto_recurring.frequency, 30);
  const ps = W.sub(res.body.subscriber_id).plan_snapshot;
  assert.equal(ps.shipping_price_ars, 5900);
  assert.equal(ps.shipping_method_name, PRIORITY.name);
  assert.equal(ps.total_per_charge_ars, 27500);
});

test("(e) reintento del mismo checkout: reusa la sub y el plan MP; si cambia el monto crea otro y guarda el anterior", async () => {
  const r1 = await post(body({ quantity: 1 }));
  const r2 = await post(body({ quantity: 1 }));
  assert.equal(r2.body.reused, true);
  assert.equal(r2.body.subscriber_id, r1.body.subscriber_id);
  assert.equal(r2.body.init_point, r1.body.init_point);
  assert.equal(W.mp.plansCreated.length, 1, "no hay que crear un plan MP nuevo por cada clic");

  const r3 = await post(body({ quantity: 2 }));
  assert.equal(r3.body.subscriber_id, r1.body.subscriber_id);
  assert.equal(W.mp.plansCreated.length, 2);
  const s = W.sub(r1.body.subscriber_id);
  assert.equal(s.mp_preapproval_plan_id, r3.body.preapproval_plan_id);
  assert.equal(s.mp_preapproval_plan_id_prev, r1.body.preapproval_plan_id, "sync necesita el plan previo para no dejar huérfano un pago");
  assert.equal(W.subs().length, 1);
});

test("(e) validaciones server-side: sin CP / sin DNI / precio adulterado → 400 y NO se llama a MP", async () => {
  const noZip = await post(body({ shipping_address: { ...ADDRESS, zip: "" } }));
  assert.equal(noZip.statusCode, 400);
  assert.match(noZip.body.error, /código postal/);

  const noTax = await post(body({ customer: { email: "x@cliente.test", name: "X Y", phone: "11", tax_id: "" } }));
  assert.equal(noTax.statusCode, 400);
  assert.match(noTax.body.error, /DNI/);

  const cheap = await post(body({ quantity: 3, base_price: 1000, sub_discount: 10 }));
  assert.equal(cheap.statusCode, 400);
  assert.match(cheap.body.error, /precio del pack/);

  const tooMuchOff = await post(body({ quantity: 1, sub_discount: 80, base_price: 12000 }));
  assert.equal(tooMuchOff.statusCode, 200);
  // Sin envío: con tienda conectada el `shipping_price_ars` del plan ya no se
  // cobra (21-sept). Acá no se eligió ninguna tarifa real, así que el cobro es
  // solo el producto. Lo que prueba esta línea es el tope de descuento.
  assert.equal(W.mp.plansCreated.at(-1).body.auto_recurring.transaction_amount, Math.round(12000 * 0.9), "el descuento se capea al del plan (10%)");

  assert.equal(W.mp.plansCreated.length, 1);
  assert.equal(W.subs().length, 1);
});

test("(e) MP rechaza payment_methods_allowed: cae en cascada hasta el plan sin restricción", async () => {
  W.router.failNext("POST", "api.mercadopago.com", /^\/preapproval_plan$/, { status: 400, json: { message: "invalid payment_methods_allowed", status: 400 } }, 2);
  const res = await post(body({ quantity: 1 }));
  assert.equal(res.statusCode, 200);
  const posts = W.router.find({ method: "POST", path: /^\/preapproval_plan$/ });
  assert.equal(posts.length, 3);
  assert.equal(posts[0].json.payment_methods_allowed.payment_types.length, 3);
  assert.equal(posts[1].json.payment_methods_allowed.payment_types.length, 2);
  assert.equal(posts[2].json.payment_methods_allowed, undefined);
});

test("(e) MP caído: 502 con mensaje para el comprador, sub en error y aviso al merchant", async () => {
  W.router.failNext("POST", "api.mercadopago.com", /^\/preapproval_plan$/, { status: 500, json: { message: "internal_error", status: 500 } }, 3);
  const res = await post(body({ quantity: 1 }));
  assert.equal(res.statusCode, 502);
  assert.doesNotMatch(res.body.error, /internal_error/, "no exponer el error crudo de MP al comprador");
  const [s] = W.subs();
  assert.equal(s.data.status, "error");
  assert.ok(W.merchant().mp_last_error);
});

// ─── Un plan, muchas variantes (22-sept-2026, Thiago) ────────────────────
// "No tenemos ningún plan si tiene muchos sabores, muchas variables". Un plan
// cubre TODAS las variantes del producto: la que se factura es la que el
// cliente eligió en la página, no la que quedó fija en el plan.
test("(e) se suscribe a la variante que eligió, no a la del plan", async () => {
  const otra = "99887766554";
  const res = await post(body({ shopify_variant_id: otra }));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(sub.plan_snapshot.shopify_variant_id, otra, "va la del selector");
  assert.notEqual(sub.plan_snapshot.shopify_variant_id, String(VARIANT_ID), "no la del plan");
});

test("(e) sin variante en el body sigue usando la del plan", async () => {
  const res = await post(body({}));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  assert.equal(String(sub.plan_snapshot.shopify_variant_id), String(VARIANT_ID));
});

test("(e) una variante con forma inválida se ignora", async () => {
  for (const basura of ["", "abc", "12", "'; DROP TABLE--", "9".repeat(40)]) {
    const res = await post(body({ shopify_variant_id: basura }));
    assert.equal(res.statusCode, 200, `${basura}: ${JSON.stringify(res.body)}`);
    const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
    assert.equal(String(sub.plan_snapshot.shopify_variant_id), String(VARIANT_ID), `con "${basura}" tiene que caer a la del plan`);
  }
});
