// (p) Abono + comisión (30-sept-2026, Thiago). Lo que protege:
//   · que el % sea el del tramo y el descuento de por vida toque SOLO el abono;
//   · que la base sea lo que de verdad entró (aprobado menos devuelto);
//   · que un ciclo no se facture dos veces aunque el cron corra de nuevo;
//   · que sin cotización del dólar NO se cobre nada (mejor no cobrar que inventar);
//   · que lo que no llega al mínimo de Stripe viaje al ciclo siguiente.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";

const { billFor, commissionPct, planFor, SAAS_BASE_USD } = await loadApi("shared/platform/pricing.js");
const { billCommissionForMerchant, ciclosCerrados, gmvDelCiclo, MIN_COMISION_USD } = await loadApi("api/_lib/commission.js");
const { db } = await loadApi("api/_lib/firebase.js");

const ACTIVADO = "2026-09-01T00:00:00.000Z";
const AHORA = Date.parse("2026-10-05T12:00:00.000Z");   // un ciclo cerrado (1-sept a 1-oct)
const RATE = 1560;

let W, llamadas;
beforeEach(() => {
  W = createWorld();
  llamadas = [];
  process.env.USD_RATE_MANUAL = String(RATE);
});
afterEach(() => { delete process.env.USD_RATE_MANUAL; W.router.assertClean(); });

const stripeFalso = async (method, path, params) => { llamadas.push({ method, path, params }); return { id: "ii_" + llamadas.length }; };
const cobro = (id, monto, fecha, status = "approved") =>
  seedDoc(`merchants/${MID}/charges/${id}`, { status, amount_ars: monto, created_at: fecha, mp_payment_id: id });
const tienda = (o = {}) => ({ plan_activated_at: ACTIVADO, saas_stripe_customer_id: "cus_1", saas_status: "active", plan_activated: "starter", ...o });
const facturar = (merchant, subs = 5) => billCommissionForMerchant({
  db, merchantId: MID, merchant, stripeCall: stripeFalso, countActive: async () => subs, nowMs: AHORA,
});

// ── 1. La cuenta ────────────────────────────────────────────────────────────
test("(p) el % sale del tramo y el descuento de por vida toca SOLO el abono", () => {
  assert.equal(commissionPct(300), 1.8);
  assert.equal(commissionPct(301), 1.5);
  assert.equal(commissionPct(1001), 1.3);
  assert.equal(planFor(0).label, "Starter");

  const lista = billFor({ merchant: {}, subs: 50, gmvArs: 1560000, usdRate: RATE });
  assert.equal(lista.base_usd, SAAS_BASE_USD);
  assert.equal(lista.gmv_usd, 1000);
  assert.equal(lista.commission_usd, 18, "1,8% de US$ 1.000");
  assert.equal(lista.total_usd, 117);

  // Wellfresh: mitad de abono, MISMA comisión.
  const mitad = billFor({ merchant: { legacy_pricing: 0.5 }, subs: 50, gmvArs: 1560000, usdRate: RATE });
  assert.equal(mitad.base_usd, 49.5);
  assert.equal(mitad.commission_usd, 18, "el descuento no se toca la comisión");
});

test("(p) los ciclos son de 30 días desde la activación y el que está en curso no se factura", () => {
  const c = ciclosCerrados(ACTIVADO, AHORA);
  assert.equal(c.length, 1, "del 1-sept al 1-oct: uno cerrado, el de octubre sigue abierto");
  assert.equal(c[0].id, "2026-09-01");
  assert.equal(ciclosCerrados(null, AHORA).length, 0, "sin activación no hay nada que facturar");
});

// ── 2. La base: lo que de verdad entró ──────────────────────────────────────
test("(p) la base son los cobros aprobados del ciclo, menos lo que se devolvió", async () => {
  cobro("p1", 100000, "2026-09-05T10:00:00.000Z");
  cobro("p2", 50000, "2026-09-20T10:00:00.000Z");
  cobro("p3", 30000, "2026-09-21T10:00:00.000Z", "rejected");          // rechazado: no entró
  cobro("p4", 70000, "2026-10-02T10:00:00.000Z");                       // del ciclo siguiente
  seedDoc(`merchants/${MID}/money_back/p2`, { kind: "refunded", status: "open" });   // devuelto

  const r = await gmvDelCiclo(db, MID, { from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" });
  assert.equal(r.bruto_ars, 150000, "solo los aprobados del ciclo");
  assert.equal(r.devuelto_ars, 50000);
  assert.equal(r.gmv_ars, 100000, "no le cobramos comisión por una venta que perdió");
});

// ── 3. La factura ───────────────────────────────────────────────────────────
test("(p) se factura el ciclo cerrado como ítem en dólares, con todo lo que hace falta para auditarlo", async () => {
  cobro("p1", 1560000, "2026-09-10T10:00:00.000Z");
  const r = await facturar(tienda(), 50);
  assert.equal(r.billed, 1);
  assert.equal(r.total_usd, 18, "1,8% de US$ 1.000");

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].path, "/v1/invoiceitems");
  assert.equal(llamadas[0].params.amount, 1800, "en centavos");
  assert.equal(llamadas[0].params.currency, "usd");
  assert.match(llamadas[0].params.description, /1\.8%/);

  const doc = rawGet(`merchants/${MID}/commissions/2026-09-01`);
  assert.equal(doc.gmv_ars, 1560000);
  assert.equal(doc.usd_rate, RATE, "queda la cotización usada, no la de hoy");
  assert.equal(doc.pct, 1.8);
  assert.ok(doc.billed_at && doc.stripe_invoice_item_id);
});

test("(p) el cron puede correr dos veces: el ciclo NO se factura de nuevo", async () => {
  cobro("p1", 1560000, "2026-09-10T10:00:00.000Z");
  const m = tienda();
  await facturar(m, 50);
  const segunda = await facturar({ ...m, ...rawGet(`merchants/${MID}`) }, 50);
  assert.equal(segunda.billed, 0, "ya estaba facturado");
  assert.equal(llamadas.length, 1, "un solo ítem en Stripe");
});

test("(p) sin cotización del dólar no se cobra nada y el ciclo queda para mañana", async () => {
  delete process.env.USD_RATE_MANUAL;
  // Las dos fuentes caídas.
  W.router.on("GET", "dolarapi.com", /\/blue$/, () => ({ status: 500, json: {} }));
  W.router.on("GET", "api.bluelytics.com.ar", /\/latest$/, () => ({ status: 500, json: {} }));
  cobro("p1", 1560000, "2026-09-10T10:00:00.000Z");
  const r = await facturar(tienda(), 50);
  assert.equal(r.billed, 0);
  assert.equal(llamadas.length, 0, "preferimos no cobrar a cobrar con un número inventado");
  assert.equal(rawList(`merchants/${MID}/commissions`).length, 0, "no queda el reclamo: se reintenta");
});

test("(p) una comisión chiquita no se cobra: viaja al ciclo siguiente", async () => {
  cobro("p1", 10000, "2026-09-10T10:00:00.000Z");   // 1,8% de US$ 6,41 = US$ 0,12
  const r = await facturar(tienda(), 5);
  assert.equal(r.billed, 0);
  assert.equal(llamadas.length, 0);
  assert.ok(r.carry_usd > 0 && r.carry_usd < MIN_COMISION_USD);
  assert.equal(rawGet(`merchants/${MID}`).commission_carry_usd, r.carry_usd, "queda anotado para el mes que viene");
});

// 30-sept-2026 (Thiago): el comercio tiene que poder ver cuánto le va a venir
// en la próxima factura, no enterarse el día del cobro.
test("(p) el ciclo en curso dice cuánto va de comisión hasta ahora", async () => {
  const { cicloEnCurso } = await loadApi("api/_lib/commission.js");
  // Ciclo abierto: del 1-oct en adelante (la activación fue el 1-sept).
  cobro("p1", 780000, "2026-10-02T10:00:00.000Z");
  cobro("p2", 780000, "2026-10-04T10:00:00.000Z");
  cobro("p3", 500000, "2026-09-10T10:00:00.000Z");   // del ciclo anterior: no cuenta
  const c = await cicloEnCurso(db, MID, tienda(), { nowMs: AHORA, subs: 50, rate: RATE });
  assert.equal(c.cobros, 2);
  assert.equal(c.gmv_ars, 1560000);
  assert.equal(c.pct, 1.8);
  assert.equal(c.commission_usd, 18, "1,8% de US$ 1.000");
  assert.equal(c.base_usd, SAAS_BASE_USD);
  assert.equal(c.total_usd, 117);
});

test("(p) sin plan activado todavía no hay ciclo que mostrar", async () => {
  const { cicloEnCurso } = await loadApi("api/_lib/commission.js");
  assert.equal(await cicloEnCurso(db, MID, { }, { nowMs: AHORA, subs: 5, rate: RATE }), null);
});
