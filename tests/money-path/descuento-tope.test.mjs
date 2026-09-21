// (e) El precio que ve el comprador tiene que ser EL QUE SE COBRA.
//
// 21-sept-2026, caso real de Glowtherm: código GROWITH del 99 % sobre un pack de
// $59.492. El checkout mostraba "Total cada 120 días $595" y Mercado Pago le
// cobraba $5.949. El comprador se enteraba DESPUÉS de tocar Pagar, ya en MP.
//
// Causa: el tope de descuento estaba escrito a mano en los dos lados y no
// coincidía — el server capeaba en 90 %, el navegador en 100 %. Ahora la cuenta
// sale de shared/platform/discounts.js, el mismo módulo en los dos.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID, PLAN_ID, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { MAX_DISCOUNT_PCT, clampDiscountPct, discountAmountFor } = await loadApi("shared/platform/discounts.js");

let W;
beforeEach(() => { W = createWorld({ merchant: luminaMerchant() }); });

const post = (over = {}) => invoke(init, {
  method: "POST", query: {}, headers: { "x-forwarded-for": "190.1.2.3" },
  body: {
    merchant_id: MID, plan_id: PLAN_ID,
    customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" },
    shipping_address: { ...ADDRESS },
    ...over,
  },
});

test("(e) el tope es uno solo y vale para los dos lados", () => {
  assert.equal(MAX_DISCOUNT_PCT, 90);
  assert.equal(clampDiscountPct(99), 90, "un código del 99 % se capea a 90");
  assert.equal(clampDiscountPct(50), 50);
  assert.equal(clampDiscountPct(-5), 0);
  assert.equal(clampDiscountPct("abc"), 0);
});

test("(e) GLOWTHERM: código del 99 % — el navegador y el server dan el MISMO número", () => {
  const subtotal = 59492;
  const code = { type: "percent", value: 99 };
  // Lo que pinta el checkout hosteado.
  const enPantalla = subtotal - discountAmountFor(subtotal, code);
  // Con el bug: el navegador capeaba en 100 y mostraba 595; el server cobraba 5949.
  assert.equal(enPantalla, 5949, "se muestra lo que realmente se cobra");
  assert.notEqual(enPantalla, 595, "el número viejo, el que mentía");
});

test("(e) un código del 99 % cobra el 10 %, no el 1 %", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({
    discount_codes: [{ code: "GROWITH", type: "percent", value: 99, active: true }],
  }));
  const res = await post({ quantity: 1, discount_code: "GROWITH" });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const sub = rawGet(`merchants/${MID}/subscribers/${res.body.subscriber_id}`);
  const snap = sub.plan_snapshot;
  // El plan de prueba cobra 12000 con 10 % de descuento del plan = 10800.
  // El código del 99 % se capea a 90 → 1080.
  assert.equal(snap.discount_code, "GROWITH");
  assert.equal(snap.discount_code_pct, 90, "el % guardado es el capeado, no el 99 que pidieron");
  assert.equal(snap.subtotal_ars, 1080);
  // Y eso es exactamente lo que se le manda a Mercado Pago.
  assert.equal(W.mp.plansCreated.at(-1).body.auto_recurring.transaction_amount, snap.total_per_charge_ars);
});

test("(e) un código de $ fijo no puede dejar el total en negativo", () => {
  assert.equal(discountAmountFor(5000, { type: "fixed", value: 99999 }), 5000);
  assert.equal(discountAmountFor(0, { type: "fixed", value: 100 }), 0);
  assert.equal(discountAmountFor(5000, null), 0);
});
