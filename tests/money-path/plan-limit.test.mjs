// (o) Límite del plan gratis (shared/platform/enforcement.js + los candados):
//   1–10 gratis · 11–15 gracia (avisa pero vende) · 16+ bloqueado (no vende).
// Lo más importante que prueba: bloquear NO corta los cobros de las suscripciones
// que ya están activas. Si eso se rompe, el que pierde plata es el cliente final
// del comerciante y no se puede revertir.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { enforcementFor, enforcementCopy, GRACE_LIMIT } = await loadApi("shared/platform/enforcement.js");
const plansSaas = await loadApi("api/_lib/plans_saas.js");
const { buildBilling, planAlertEventFor, enforcementOf } = plansSaas;
const { default: widget } = await loadApi("api/widget.js");

const nueva = (o = {}) => ({ created_at: "2026-09-20T00:00:00.000Z", ...o });

// Tienda creada DESPUÉS del corte: las de antes son beta y nunca se bloquean.
const tiendaNueva = (o = {}) => luminaMerchant({ created_at: "2026-09-20T00:00:00.000Z", ...o });
// Deja la tienda con N suscriptores ya contados (el cache que miran widget y checkout).
const conSubs = (n, o = {}) => {
  seedDoc(`merchants/${MID}`, tiendaNueva({ billing_cache: { subs: n, at: new Date().toISOString() }, ...o }));
};

let W;
beforeEach(() => { W = createWorld({ merchant: tiendaNueva() }); });

test("(o) los tres tramos: gratis vende, gracia vende y avisa, 16 bloquea", () => {
  assert.equal(enforcementFor({ activeSubscribers: 10 }).state, "ok");
  assert.equal(enforcementFor({ activeSubscribers: 11 }).state, "grace");
  assert.equal(enforcementFor({ activeSubscribers: 15 }).state, "grace");
  assert.equal(enforcementFor({ activeSubscribers: 16 }).state, "blocked");
  // En gracia SIGUE vendiendo: son 5 de regalo, no un bloqueo blando.
  assert.equal(enforcementFor({ activeSubscribers: 15 }).sell, true, "con 15 todavía vende");
  assert.equal(enforcementFor({ activeSubscribers: 16 }).sell, false, "con 16 se corta la venta nueva");
  assert.equal(GRACE_LIMIT, 15);
});

test("(o) el que paga no ve nada, aunque tenga 500 suscriptores", () => {
  const e = enforcementFor({ activeSubscribers: 500, paid: true });
  assert.equal(e.state, "ok");
  assert.equal(e.sell, true);
  assert.equal(enforcementCopy(e), null, "sin plan pago no hay cartel");
});

test("(o) tarjeta rebotada con 12 suscriptores: cae en gracia, NO se bloquea", () => {
  // Un rechazo del banco no puede dejar a nadie sin vender de un día para el otro.
  const b = buildBilling(nueva({ plan_activated: "starter", saas_status: "past_due" }), 12, {});
  assert.equal(b.enforcement, "grace");
  assert.equal(b.can_sell, true, "sigue vendiendo mientras arregla la tarjeta");
  assert.equal(b.locked, false);
});

test("(o) contrato para el panel: locked, can_sell y el copy del cartel", () => {
  const libre = buildBilling(nueva(), 5, {});
  assert.equal(libre.enforcement, "ok");
  assert.equal(libre.must_pay, false);
  assert.equal(libre.enforcement_copy, null);

  const gracia = buildBilling(nueva(), 12, {});
  assert.equal(gracia.can_sell, true);
  assert.equal(gracia.locked, false);
  assert.equal(gracia.must_pay, true);
  assert.equal(gracia.grace_left, 3);
  assert.match(gracia.enforcement_copy.title, /3 suscriptores/);
  // El copy SIEMPRE aclara que lo que ya cobra sigue cobrando.
  assert.match(gracia.enforcement_copy.keeps, /se siguen cobrando/i);

  const bloq = buildBilling(nueva(), 16, {});
  assert.equal(bloq.can_sell, false);
  assert.equal(bloq.locked, true);
  assert.equal(bloq.panel_mode, "readonly");
  assert.match(bloq.enforcement_copy.keeps, /siguen cobr/i);
});

test("(o) internal:false explícito gana sobre el mail admin: la tienda de prueba se comporta como cliente", async () => {
  const { isInternal } = await loadApi("api/_lib/plans_saas.js");
  assert.equal(isInternal({ email: "admin@x.test" }, ["admin@x.test"]), true);
  assert.equal(isInternal({ email: "admin@x.test", internal: false }, ["admin@x.test"]), false);
  const b = buildBilling({ created_at: "2026-09-20T00:00:00Z", email: "admin@x.test", internal: false }, 14, {});
  assert.equal(b.enforcement, "grace");
  assert.equal(b.grace_left, 1);
});

test("(o) las tiendas internas y beta nunca se bloquean", () => {
  assert.equal(buildBilling({ internal: true }, 9999, {}).can_sell, true, "tienda propia");
  assert.equal(buildBilling({ created_at: "2026-01-01T00:00:00Z" }, 9999, {}).can_sell, true, "beta (Lumina)");
  assert.equal(buildBilling({ internal: true }, 9999, {}).locked, false);
});

test("(o) el widget no se sirve cuando está bloqueado, y sí cuando está en gracia", async () => {
  // Bloqueado: la página de producto queda como estaba antes de instalarnos.
  conSubs(16);
  const bloq = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.equal(bloq.statusCode, 200);
  assert.match(bloq.body, /Suscripciones en pausa/, "avisa por consola y no pinta nada");
  assert.ok(!/rec-widget|Suscribirme/.test(bloq.body), "no manda el widget");

  // En gracia el widget se sirve completo: no le cortamos la venta.
  conSubs(15);
  const gracia = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(gracia.body.length > 5000, "con 15 el widget sale completo");
  assert.ok(!/Suscripciones en pausa/.test(gracia.body));
});

test("(o) sin contador cacheado el widget NO bloquea (nunca cortamos por una duda nuestra)", async () => {
  seedDoc(`merchants/${MID}`, tiendaNueva());   // sin billing_cache
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(!/Suscripciones en pausa/.test(res.body), "sin dato, se sirve igual");
  assert.ok(res.body.length > 5000);
});

test("(o) el checkout rechaza suscripciones nuevas con 402 cuando está bloqueado", async () => {
  const { default: init } = await loadApi("api/checkout/init.js");
  conSubs(16);
  const res = await invoke(init, {
    method: "POST",
    query: {},
    body: { merchant_id: MID, plan_id: PLAN_ID, customer: { email: "ana@cliente.test", name: "Ana Pérez" } },
    headers: { origin: "https://lumina.test" },
  });
  assert.equal(res.statusCode, 402, "cierra el endpoint directo, no solo el widget");
  assert.equal(res.body.code, "plan_required");
});

test("(o) el checkout acepta normalmente en gracia", async () => {
  const { default: init } = await loadApi("api/checkout/init.js");
  conSubs(15);
  const res = await invoke(init, {
    method: "POST", query: {},
    body: { merchant_id: MID, plan_id: PLAN_ID, customer: { email: "ana@cliente.test", name: "Ana Pérez" }, capture: true },
    headers: { origin: "https://lumina.test" },
  });
  assert.notEqual(res.statusCode, 402, "con 15 todavía entra");
});

test("(o) canceló pero el período pagado sigue: mantiene el plan hasta que vence", () => {
  const { saasPaid } = plansSaas;
  const futuro = new Date(Date.now() + 10 * 86400000).toISOString();
  const pasado = new Date(Date.now() - 86400000).toISOString();
  assert.equal(saasPaid(nueva({ plan_activated: "starter", saas_status: "cancelled", saas_paid_until: futuro })), true, "pagó el 1, canceló el 20: plan hasta el 30");
  assert.equal(saasPaid(nueva({ plan_activated: "starter", saas_status: "cancelled", saas_paid_until: pasado })), false, "venció: vuelve a la regla por cantidad");
  assert.equal(buildBilling(nueva({ plan_activated: "starter", saas_status: "cancelled", saas_paid_until: futuro }), 16, {}).can_sell, true);
  assert.equal(buildBilling(nueva({ plan_activated: "starter", saas_status: "cancelled", saas_paid_until: pasado }), 16, {}).can_sell, false);
});

test("(o) escalada del aviso por WhatsApp: tope (10) → gracia → último aviso → bloqueado", () => {
  const ev = (n) => planAlertEventFor(enforcementOf(nueva(), n));
  assert.equal(ev(9), null, "por debajo del tope no molestamos");
  assert.equal(ev(10), "plan_at_limit", "justo en 10: aviso previo");
  assert.equal(planAlertEventFor(enforcementOf(nueva({ plan_activated: "starter", saas_status: "active" }), 10)), null, "con plan pago, nada");
  assert.equal(ev(11), "plan_grace");
  assert.equal(ev(13), "plan_grace");
  assert.equal(ev(14), "plan_last_call", "queda 1: el aviso fuerte");
  assert.equal(ev(15), "plan_last_call");
  assert.equal(ev(16), "plan_blocked");
  assert.equal(planAlertEventFor(enforcementOf(nueva({ plan_activated: "starter", saas_status: "active" }), 500)), null, "al que paga no le avisamos nada");
});

// ─── Lo que NUNCA se corta ───────────────────────────────────────────────────
// Bloquear es "no entran ventas nuevas". Los cobros de las suscripciones que ya
// están activas siguen igual: si esto se rompe, el que pierde plata es el cliente
// final del comerciante (pagó y no recibe) y el daño no se puede revertir.
test("(o) BLOQUEADA: el cobro de una suscripción que ya existe sigue creando su orden", async () => {
  const { default: webhook } = await loadApi("api/mp/webhook.js");
  const { subscriber, snapshot, mpPayment, mpWebhookReq, MP_TOKEN, VARIANT_ID } = await import("../helpers/world.mjs");

  // Tienda pasada del límite y sin pagar: el widget está apagado.
  conSubs(40);
  assert.equal(enforcementOf(tiendaNueva(), 40).sell, false, "confirmado: no vende nuevas");

  W.seedSub("sub_ana", subscriber({ quantity: 2, plan_snapshot: snapshot({ qty: 2 }) }));
  const pay = W.mp.addPayment(mpPayment({ id: 1310009001, amount: 23100, preapprovalId: "pre_ana" }), MP_TOKEN);

  const res = await invoke(webhook, mpWebhookReq(pay.id));
  assert.equal(res.statusCode, 200, "el webhook de MP se procesa igual");

  // La orden se creó: su cliente recibe lo que pagó.
  assert.equal(W.shopify.orderPosts.length, 1, "la orden se crea aunque la tienda esté bloqueada");
  assert.deepEqual(W.shopify.orderPosts[0].order.line_items, [{ variant_id: VARIANT_ID, quantity: 2, price: "10800.00" }]);
  assert.equal(W.shopify.orderPosts[0].order.financial_status, "paid");

  // Y el cobro quedó registrado, con la sub activa.
  const charges = W.charges();
  assert.equal(charges.length, 1, "el cobro se registra");
  assert.equal(W.sub("sub_ana").status, "active", "la suscripción sigue activa");
});

test("(o) BLOQUEADA: el portal del cliente sigue andando (pausar/cancelar no se toca)", async () => {
  const pub = await loadApi("api/public.js");
  const { subscriber, MP_TOKEN, mpPreapproval } = await import("../helpers/world.mjs");
  conSubs(40);
  W.seedSub("sub_ana", subscriber({ resume_at: null }));
  W.mp.addPreapproval(mpPreapproval({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  const token = pub.generatePortalToken(MID, "sub_ana", 180);

  const res = await invoke(pub.default, { method: "POST", query: { action: "sub", token }, body: { action: "pause" } });
  assert.equal(res.statusCode, 200, "su cliente puede pausar igual");
  assert.equal(W.sub("sub_ana").status, "paused");
});
