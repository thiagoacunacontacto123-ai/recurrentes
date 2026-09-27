// Tarjeta dentro de NUESTRO checkout (Checkout API de Mercado Pago), detrás de
// la bandera `mp_checkout_api` (26-sept-2026, Thiago).
//
// Lo que protege este archivo, en orden de gravedad:
//   1. Con la bandera APAGADA no cambia UNA COMA: ni una llamada de más a MP.
//      Lumina y todas las tiendas que ya venden siguen exactamente igual.
//   2. Si MP rechaza la tarjeta, el comprador NO queda colgado: le sigue
//      llegando el init_point y paga en Mercado Pago como siempre.
//   3. La public key sale al navegador SOLO con la bandera prendida. El access
//      token no sale NUNCA.
//   4. El preapproval se crea contra el MISMO plan ad-hoc, así el webhook, el
//      cron y la conciliación lo resuelven igual que una sub que vino por el
//      redirect.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, MP_TOKEN, ADDRESS, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { default: pub } = await loadApi("api/public.js");
const { default: merchantApi } = await loadApi("api/merchant.js");

const PK = "APP_USR-0000aaaa-1111-2222-3333-444455556666";

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { W.router.assertClean(); });

const body = (over = {}) => ({
  merchant_id: MID,
  plan_id: PLAN_ID,
  customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
  shipping_address: { ...ADDRESS },
  quantity: 1,
  ...over,
});
const post = (b) => invoke(init, { method: "POST", query: {}, body: b, headers: { "x-forwarded-for": "190.1.2.3" } });
const verPlan = () => invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, plan: PLAN_ID, checkout: "1" } });
const guardar = (b) => invoke(merchantApi, { method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` }, body: b });

// Tienda con la bandera prendida y la public key cargada (la deja el OAuth de MP).
function tiendaConTarjeta(extra = {}) {
  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_checkout_api: true, mp_public_key: PK, ...extra }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
}

test("bandera apagada: ni una llamada de más a MP, aunque el body traiga un token", async () => {
  // Lo importante no es que ignore el token: es que el camino sea EL MISMO.
  const r = await post(body({ card_token_id: "tok_de_una_tarjeta" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.authorized, undefined, "no dice que está autorizada");
  assert.ok(r.body.init_point, "sigue devolviendo el init_point de siempre");
  assert.equal(W.mp.preapprovalsCreated.length, 0, "no se llamó a POST /preapproval");
  assert.equal(W.mp.plansCreated.length, 1, "un solo plan ad-hoc, como siempre");
  assert.equal(rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`).mp_preapproval_id, undefined);
});

test("bandera prendida pero el comprador eligió Mercado Pago (sin token): camino de siempre", async () => {
  tiendaConTarjeta();
  const r = await post(body());
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.authorized, undefined);
  assert.ok(r.body.init_point);
  assert.equal(W.mp.preapprovalsCreated.length, 0);
});

test("con tarjeta: se crea el preapproval autorizado contra el mismo plan ad-hoc", async () => {
  tiendaConTarjeta();
  const r = await post(body({ card_token_id: "tok_abc123" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(r.body.authorized, true);
  assert.ok(r.body.preapproval_id, "devuelve el id de la suscripción");

  assert.equal(W.mp.preapprovalsCreated.length, 1);
  const { token, body: enviado } = W.mp.preapprovalsCreated[0];
  assert.equal(token, MP_TOKEN, "se cobra con el token de la tienda");
  assert.equal(enviado.card_token_id, "tok_abc123");
  assert.equal(enviado.status, "authorized", "autorizada: MP cobra ya, sin pantalla intermedia");
  assert.equal(enviado.preapproval_plan_id, r.body.preapproval_plan_id, "mismo plan ad-hoc que el flujo con redirección");
  assert.equal(enviado.external_reference, `${MID}:${r.body.subscriber_id}`, "así lo resuelve el webhook");
  assert.equal(enviado.payer_email, "dani@cliente.test");
  // El monto y la frecuencia NO se repiten: ya viven en el plan. Mandarlos de
  // nuevo es pedirle a MP que los cruce y devuelva 400.
  assert.equal(enviado.auto_recurring, undefined);
  assert.equal(enviado.back_url, undefined);

  // El suscriptor queda enganchado por id, igual que cuando vuelve del redirect.
  const sub = rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`);
  assert.equal(sub.mp_preapproval_id, r.body.preapproval_id);
  assert.equal(sub.mp_preapproval_plan_id, r.body.preapproval_plan_id);
  assert.equal(sub.mp_paid_with_card_form, true);
});

test("va el Device ID en X-meli-session-id: sin eso MP rechaza tarjetas buenas por antifraude", async () => {
  tiendaConTarjeta();
  const r = await post(body({ card_token_id: "tok_abc123", device_id: "armor.9744fe1c-0e2b" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(W.mp.preapprovalsCreated[0].deviceId, "armor.9744fe1c-0e2b");
  assert.equal(W.mp.preapprovalsCreated[0].body.device_id, undefined, "va en el header, no en el body");
});

test("sin Device ID (navegador que no lo dejó) se manda igual, sin el header", async () => {
  tiendaConTarjeta();
  const r = await post(body({ card_token_id: "tok_abc123" }));
  assert.equal(r.statusCode, 200);
  assert.equal(W.mp.preapprovalsCreated[0].deviceId, null);
  assert.equal(r.body.authorized, true, "se crea igual: el header ayuda, no es obligatorio");
});

test("MP rechaza la tarjeta: se le DICE por qué y le queda Mercado Pago como salida", async () => {
  tiendaConTarjeta();
  W.mp.rejectCardToken = true;   // CC_VAL_433: el antifraude de MP
  const r = await post(body({ card_token_id: "tok_rechazado" }));
  assert.equal(r.statusCode, 200, "la respuesta es 200: el comprador tiene por dónde seguir");
  assert.equal(r.body.authorized, undefined, "no mentimos: no quedó autorizada");
  assert.equal(r.body.card_declined, true, "el checkout se entera de que rebotó");
  assert.match(r.body.card_error, /por seguridad/i, "y le dice el motivo, no 'error 400'");
  assert.match(r.body.card_error, /otra tarjeta|Mercado Pago/i, "siempre con una salida");
  assert.ok(!/CC_VAL|HTTP 400|preapproval/.test(r.body.card_error), "sin códigos internos de MP");
  assert.ok(/mercadopago\.com/.test(r.body.init_point), "le queda el checkout de MP");
  assert.ok(r.body.portal_token, "y su token de portal");
  const sub = rawGet(`merchants/${MID}/subscribers/${r.body.subscriber_id}`);
  assert.equal(sub.mp_preapproval_id, undefined, "sin id de suscripción fantasma");
  assert.equal(sub.status, "pending", "queda pendiente, no en error");
  // Un rechazo de tarjeta es del comprador, no de la tienda: no le ensucia el panel.
  assert.equal(rawGet(`merchants/${MID}`).mp_last_error, undefined);
});

test("la public key viaja al navegador SOLO con la bandera prendida; el access token nunca", async () => {
  // Apagada (Lumina hoy): no hay formulario de tarjeta.
  let r = await verPlan();
  assert.equal(r.body.checkout.card_form, null);

  tiendaConTarjeta();
  r = await verPlan();
  assert.deepEqual(r.body.checkout.card_form, { public_key: PK });
  const crudo = JSON.stringify(r.body);
  assert.ok(!crudo.includes(MP_TOKEN), "el access token de la tienda no sale al navegador");
});

test("bandera prendida sin public key: no se ofrece el formulario (sería un campo muerto)", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_checkout_api: true, mp_public_key: "" }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
  const r = await verPlan();
  assert.equal(r.body.checkout.card_form, null);
});

test("el panel no deja prenderlo sin la clave pública, y con la clave sí", async () => {
  // Una tienda que se conectó pegando el token a mano: esa conexión no trae public key.
  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_public_key: "" }));
  let r = await guardar({ mp_checkout_api: true });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /Public Key/i);
  assert.match(r.body.error, /Reconectá Mercado Pago/i, "dice qué hacer, no solo que falló");
  assert.equal(rawGet(`merchants/${MID}`).mp_checkout_api, undefined);

  seedDoc(`merchants/${MID}`, luminaMerchant({ mp_public_key: PK }));
  r = await guardar({ mp_checkout_api: true });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(rawGet(`merchants/${MID}`).mp_checkout_api, true);

  // Apagarlo siempre se puede (no pide clave).
  r = await guardar({ mp_checkout_api: false });
  assert.equal(r.statusCode, 200);
  assert.equal(rawGet(`merchants/${MID}`).mp_checkout_api, false);
});

test("cada rechazo de MP se traduce a algo que el comprador puede hacer", async () => {
  const casos = [
    ["cc_rejected_insufficient_amount", /fondos/i],
    ["cc_rejected_bad_filled_security_code", /código de seguridad/i],
    ["cc_rejected_bad_filled_date", /vencimiento/i],
    ["cc_rejected_call_for_authorize", /banco/i],
    ["cc_rejected_max_attempts", /límite de intentos/i],
    ["algo que nunca vimos", /Probá con otra/i],
  ];
  for (const [msgMp, espera] of casos) {
    W = createWorld();
    tiendaConTarjeta();
    W.mp.rejectCardToken = msgMp;
    const r = await post(body({ card_token_id: "tok_x" }));
    assert.equal(r.body.card_declined, true, msgMp);
    assert.match(r.body.card_error, espera, `${msgMp} → "${r.body.card_error}"`);
  }
});

test("token de tarjeta con basura: se limpia antes de mandarlo a MP", async () => {
  tiendaConTarjeta();
  const r = await post(body({ card_token_id: "tok_ok\n<script>alert(1)</script>" }));
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(W.mp.preapprovalsCreated[0].body.card_token_id, "tok_okscriptalert1script");
});
