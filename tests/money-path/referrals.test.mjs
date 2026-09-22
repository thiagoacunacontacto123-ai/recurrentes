// (r) Afiliados (api/_lib/referrals.js): código por cuenta, vínculo ?ref=, comisión del
// 15% del precio de lista por cada pago del plan del referido (idempotente) y crédito
// que va al saldo de Stripe cuando el referente tiene customer.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, luminaMerchant, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";
// El 15% sale del precio REAL del tramo: si cambian los precios, el test sigue
// valiendo (22-sept-2026: los precios se duplicaron y esto estaba a mano).
const { TIER_BY_ID } = await loadApi("shared/platform/pricing.js");
const COM = (tier) => Math.round(TIER_BY_ID[tier].usd * 0.15 * 100) / 100;
const COM_STARTER = COM("starter"), COM_GROWTH = COM("growth");


const R = await loadApi("api/_lib/referrals.js");

let W, stripeCalls;
const stripeFake = async (method, path, params) => { stripeCalls.push({ method, path, params }); return { id: "cbtxn_1" }; };
beforeEach(() => {
  W = createWorld({ merchant: luminaMerchant() });
  stripeCalls = [];
  // Referente (cuenta con código) y cuenta nueva.
  seedDoc("merchants/ref_uid", { email: "ref@x.test", ref_code: "ABCD2345", created_at: "2026-01-01T00:00:00.000Z" });
  seedDoc("merchants/new_uid", { email: "new@x.test", created_at: new Date().toISOString() });
});

test("(r) ensureRefCode crea un código único y no lo cambia después", async () => {
  const c1 = await R.ensureRefCode("new_uid");
  assert.match(c1, R.REF_CODE_RE);
  assert.equal(await R.ensureRefCode("new_uid"), c1);
});

test("(r) claim: vincula una cuenta nueva; rechaza propio, inexistente, vieja y repetido", async () => {
  assert.deepEqual(await R.claimReferral("new_uid", "abcd2345"), { ok: true });
  assert.equal(rawGet("merchants/new_uid").ref_by, "ref_uid");
  assert.deepEqual(await R.claimReferral("new_uid", "ABCD2345"), { ok: true, already: true });
  assert.equal((await R.claimReferral("ref_uid", "ABCD2345")).error, "codigo_propio");
  assert.equal((await R.claimReferral("new_uid", "x")).error, "codigo_invalido");
  seedDoc("merchants/otra", { email: "o@x.test", created_at: new Date().toISOString() });
  assert.equal((await R.claimReferral("otra", "ZZZZ9999")).error, "codigo_inexistente");
  seedDoc("merchants/vieja", { email: "v@x.test", created_at: "2026-01-01T00:00:00.000Z" });
  assert.equal((await R.claimReferral("vieja", "ABCD2345")).error, "cuenta_no_nueva");
});

test("(r) comisión: 15% del precio de lista del tramo, una vez por pago, y va al saldo de Stripe si hay customer", async () => {
  await R.claimReferral("new_uid", "ABCD2345");
  seedDoc("merchants/ref_uid", { ...rawGet("merchants/ref_uid"), saas_stripe_customer_id: "cus_ref" });
  const r = await R.creditCommission({ mid: "new_uid", merchant: rawGet("merchants/new_uid"), tierId: "starter", key: "cs_1", kind: "primer_pago", stripeCall: stripeFake });
  assert.equal(r.ok, true);
  assert.equal(r.usd, COM_STARTER, "15% del Starter");
  assert.equal(r.pushed, COM_STARTER);
  const ref = rawGet("merchants/ref_uid");
  assert.equal(ref.ref_earned_usd, COM_STARTER);
  assert.equal(ref.ref_credit_pending_usd, 0);
  assert.equal(ref.ref_credit_applied_usd, COM_STARTER);
  assert.equal(stripeCalls.length, 1);
  assert.equal(stripeCalls[0].path, "/v1/customers/cus_ref/balance_transactions");
  assert.equal(stripeCalls[0].params.amount, Math.round(COM_STARTER * -100), "saldo a favor en centavos");
  // El mismo pago otra vez → nada.
  const dup = await R.creditCommission({ mid: "new_uid", merchant: rawGet("merchants/new_uid"), tierId: "starter", key: "cs_1", stripeCall: stripeFake });
  assert.equal(dup.skipped, true);
  assert.equal(rawGet("merchants/ref_uid").ref_earned_usd, COM_STARTER);
  assert.equal(stripeCalls.length, 1);
});

test("(r) sin customer en Stripe el crédito queda pendiente y se empuja al activar el plan", async () => {
  await R.claimReferral("new_uid", "ABCD2345");
  const r = await R.creditCommission({ mid: "new_uid", merchant: rawGet("merchants/new_uid"), tierId: "growth", key: "in_1", kind: "renovacion", stripeCall: stripeFake });
  assert.equal(r.usd, COM_GROWTH, "15% del Growth");
  assert.equal(r.pushed, 0);
  assert.equal(rawGet("merchants/ref_uid").ref_credit_pending_usd, COM_GROWTH);
  assert.equal(stripeCalls.length, 0);
  // El referente activa su plan → tiene customer → se empuja todo lo pendiente.
  seedDoc("merchants/ref_uid", { ...rawGet("merchants/ref_uid"), saas_stripe_customer_id: "cus_ref" });
  const p = await R.pushPendingCredit("ref_uid", stripeFake);
  assert.equal(p.pushed, COM_GROWTH);
  assert.equal(stripeCalls[0].params.amount, Math.round(COM_GROWTH * -100));
  assert.equal(rawGet("merchants/ref_uid").ref_credit_pending_usd, 0);
});

test("(r) la tienda extra comisiona al referente de su DUEÑO; sin ref_by no pasa nada", async () => {
  await R.claimReferral("new_uid", "ABCD2345");
  seedDoc("merchants/m_extra", { store_name: "Sucursal", ownerUid: "new_uid", created_at: new Date().toISOString() });
  const r = await R.creditCommission({ mid: "m_extra", merchant: rawGet("merchants/m_extra"), tierId: "starter", key: "cs_9", stripeCall: stripeFake });
  assert.equal(r.usd, COM_STARTER);
  assert.equal(rawList("merchants/ref_uid/ref_ledger")[0].data.from_store, "Sucursal");
  seedDoc("merchants/solo", { email: "s@x.test", created_at: new Date().toISOString() });
  assert.equal(await R.creditCommission({ mid: "solo", merchant: rawGet("merchants/solo"), tierId: "starter", key: "cs_10", stripeCall: stripeFake }), null);
});

test("(r) overview: link, código, ganado, referidos y movimientos", async () => {
  await R.claimReferral("new_uid", "ABCD2345");
  await R.creditCommission({ mid: "new_uid", merchant: rawGet("merchants/new_uid"), tierId: "starter", key: "cs_1", stripeCall: stripeFake });
  const o = await R.referralsOverview("ref_uid", { baseUrl: "https://www.recurrentesapp.com" });
  assert.equal(o.code, "ABCD2345");
  assert.equal(o.link, "https://www.recurrentesapp.com/?ref=ABCD2345");
  assert.equal(o.pct, 15);
  assert.equal(o.earned_usd, COM_STARTER);
  assert.equal(o.referidos.length, 1);
  assert.equal(o.referidos[0].email_masked, "ne…@x.test");
  assert.equal(o.ledger[0].usd, COM_STARTER);
});
