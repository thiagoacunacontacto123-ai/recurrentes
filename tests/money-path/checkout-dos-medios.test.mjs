// Los DOS medios de pago, de punta a punta (5-oct-2026, Thiago: "quiero estar
// seguro que ninguno de los dos presenta errores").
//
// En el checkout el comprador elige: la tarjeta adentro de nuestra página
// (Checkout API) o su cuenta de Mercado Pago (redirección). Los dos tienen que
// terminar en lo mismo: suscripción enganchada, cobro y UNA orden paga en la
// tienda, con los datos del COMPRADOR.
//
// Lo que más protege este archivo: el documento. Desde el 5-oct son DOS datos
// distintos — el DNI del que compra (va al pedido) y el del titular de la
// tarjeta (va sólo al token de MP, porque la tarjeta puede ser del padre). Acá
// se prueba que el que viaja a la orden es SIEMPRE el del comprador, con
// cualquiera de los dos medios.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createWorld, loadApi, mpPayment, mpWebhookReq, noteMap,
  MID, PLAN_ID, MP_TOKEN, ADDRESS, luminaMerchant, capsulasPlan,
} from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { default: webhook } = await loadApi("api/mp/webhook.js");

const PK = "APP_USR-0000aaaa-1111-2222-3333-444455556666";
const DNI_COMPRADOR = "30111222";          // el que escribe en Contacto
const DOC_TITULAR  = "27999888777";        // el del dueño de la tarjeta (el padre)

let W;
beforeEach(() => {
  W = createWorld();
  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_checkout_api: true, mp_public_key: PK }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
});
afterEach(() => { W.router.assertClean(); });

const body = (over = {}) => ({
  merchant_id: MID,
  plan_id: PLAN_ID,
  // tax_id = SIEMPRE el del comprador. El del titular de la tarjeta no llega
  // hasta acá: queda en el navegador, adentro del token de Mercado Pago.
  customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: DNI_COMPRADOR },
  shipping_address: { ...ADDRESS },
  quantity: 1,
  ...over,
});
const post = (b) => invoke(init, { method: "POST", query: {}, body: b, headers: { "x-forwarded-for": "190.1.2.3" } });

// Cobra la suscripción reción creada y devuelve la orden que quedó en la tienda.
async function cobrarYDespachar(r, monto) {
  const sub = rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`);
  const pay = W.mp.addPayment(mpPayment({
    id: 1310000900 + Math.floor(Math.random() * 1000),
    amount: monto,
    preapprovalId: sub.mp_preapproval_id || r.body.preapproval_id || "pre_redirect",
    externalReference: `${MID}:${r.body.subscriber_id}`,
  }), MP_TOKEN);
  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  return W.shopify.orderPosts;
}

// ── 1. Cuenta de Mercado Pago (redirección) ────────────────────────────────
test("(a) cuenta de Mercado Pago: init_point, nada de tarjeta, y la orden sale con el DNI del comprador", async () => {
  const r = await post(body());
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.init_point, "lo mandamos a pagar a Mercado Pago");
  assert.equal(r.body.authorized, undefined);
  assert.equal(W.mp.preapprovalsCreated.length, 0, "sin tarjeta no se crea el preapproval acá");

  const sub = rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`);
  assert.equal(sub.customer_tax_id, DNI_COMPRADOR);
  assert.equal(sub.customer_tax_id_kind, "DNI");

  const [orden] = await cobrarYDespachar(r, 12300);
  assert.ok(orden, "se creó la orden en la tienda");
  const notas = noteMap(orden.order);
  assert.ok(JSON.stringify(orden.order).includes(DNI_COMPRADOR), "el DNI del comprador viaja al pedido");
  assert.ok(!JSON.stringify(orden.order).includes(DOC_TITULAR), "el del titular no tiene nada que hacer en el pedido");
  assert.ok(notas, "la orden lleva sus note_attributes");
});

// ── 2. Tarjeta adentro de nuestro checkout ─────────────────────────────────
test("(b) tarjeta en nuestro checkout: queda autorizada y la orden sale con el MISMO DNI del comprador", async () => {
  const r = await post(body({ card_token_id: "tok_abc123", device_id: "armor.9744fe1c" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.authorized, true, "cobra sin pantalla intermedia");
  assert.equal(W.mp.preapprovalsCreated.length, 1);

  const sub = rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`);
  assert.equal(sub.customer_tax_id, DNI_COMPRADOR, "el del pedido sigue siendo el del comprador");
  assert.equal(sub.mp_paid_with_card_form, true);

  const [orden] = await cobrarYDespachar(r, 12300);
  assert.ok(JSON.stringify(orden.order).includes(DNI_COMPRADOR));
});

// ── 3. La separación de los dos documentos ─────────────────────────────────
test("(c) el documento del titular NO llega al servidor ni al pedido: queda en el token de MP", async () => {
  const r = await post(body({ card_token_id: "tok_abc123" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));

  // Lo único que viaja a MP de la tarjeta es el token: el documento del titular
  // ya está adentro, tokenizado en el navegador.
  const { body: enviado } = W.mp.preapprovalsCreated[0];
  assert.equal(enviado.card_token_id, "tok_abc123");
  const comoTexto = JSON.stringify(enviado) + JSON.stringify(rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`));
  assert.ok(!comoTexto.includes(DOC_TITULAR), "nunca guardamos ni reenviamos el documento del titular");
});

test("(d) un DNI inválido se rechaza con los dos medios, antes de tocar Mercado Pago", async () => {
  for (const extra of [{}, { card_token_id: "tok_abc123" }]) {
    W = createWorld();
    seedDoc(`merchants/${MID}`, luminaMerchant({ mp_checkout_api: true, mp_public_key: PK }));
    seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
    const r = await post(body({ customer: { email: "dani@cliente.test", name: "Dani", phone: "1144440000", tax_id: "123" }, ...extra }));
    assert.equal(r.statusCode, 400, JSON.stringify(r.body));
    assert.match(r.body.error, /DNI/i);
    assert.equal(W.mp.preapprovalsCreated.length, 0, "no se le pide nada a MP con datos mal");
  }
});

// ── 4. Los dos cobran lo mismo ─────────────────────────────────────────────
test("(e) los dos medios cobran el MISMO monto y dejan UNA sola orden", async () => {
  const conMp = await post(body());
  const planMp = W.mp.plansCreated.at(-1);

  W = createWorld();
  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_checkout_api: true, mp_public_key: PK }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
  const conTarjeta = await post(body({ card_token_id: "tok_abc123" }));
  const planTarjeta = W.mp.plansCreated.at(-1);

  assert.equal(conMp.statusCode, 200);
  assert.equal(conTarjeta.statusCode, 200);
  assert.equal(
    planTarjeta.body.auto_recurring.transaction_amount,
    planMp.body.auto_recurring.transaction_amount,
    "elegir tarjeta no puede cambiar el precio",
  );
  const ordenes = await cobrarYDespachar(conTarjeta, planTarjeta.body.auto_recurring.transaction_amount);
  assert.equal(ordenes.length, 1, "una sola orden por cobro");
});
