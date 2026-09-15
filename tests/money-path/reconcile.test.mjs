// Conciliación con Mercado Pago (api/_lib/reconcile.js, cron ?action=reconcile-mp).
// Dos tiendas con la MISMA cuenta de MP (mismo token y mp_user_id), como LuminaLabs e
// INDATROPIC en producción. Casos reales del 2026-09-15: fantasmas, preapproval
// equivocado, clienta que paga marcada cancelada, renovaciones sin registrar.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  createWorld, loadApi, subscriber, capsulasPlan, luminaMerchant, mpPayment, mpPreapproval,
  MID, MP_TOKEN, VARIANT_ID, VARIANT_PRICE, PLAN_ID,
} from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet, rawList, stats, resetStats } from "../helpers/fake-firestore.mjs";
import { createFakeShopify } from "../helpers/fakes.mjs";

const { runReconcile, pickTruePreapproval, desiredStatus } = await loadApi("api/_lib/reconcile.js");
const { default: cron } = await loadApi("api/cron.js");

const OTRA = "zzz_indatropic";
const OTRA_SHOP = "indatropic-test.myshopify.com";
const DAY = 24 * 60 * 60 * 1000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
let W, otra;

beforeEach(() => {
  W = createWorld();
  seedDoc(`merchants/${OTRA}`, luminaMerchant({ store_name: "INDATROPIC", shopify_shop: OTRA_SHOP, shopify_token: "shpat_indatropic" }));
  seedDoc(`merchants/${OTRA}/plans/${PLAN_ID}`, capsulasPlan());
  otra = createFakeShopify(W.router, { shop: OTRA_SHOP, token: "shpat_indatropic", variants: { [VARIANT_ID]: VARIANT_PRICE }, name: "INDATROPIC" });
});
afterEach(() => { W.router.assertClean(); delete process.env.RECONCILE_DRY_RUN; });

const otraSub = (id) => rawGet(`merchants/${OTRA}/subscribers/${id}`);
const seedOtra = (id, data) => seedDoc(`merchants/${OTRA}/subscribers/${id}`, data);
const pre = (o, ext = null) => ({ ...mpPreapproval(o), external_reference: ext });
const writesOutsideSummary = () => stats.writeLog.map(w => w.path).filter(p => p !== "system/reconcile_last");
const ghost = (extra = {}) => subscriber({
  customer_email: "fantasma@cliente.test", mp_preapproval_plan_id: "plan_adhoc_fantasma", mp_preapproval_id: null,
  last_charge_at: null, shopify_orders: [], next_charge_at: null, created_at: ago(10 * DAY), ...extra,
});

test("fantasma: activa sin preapproval, sin cobros y con > 72 h → pending (con auditoría); una nueva no se toca", async () => {
  seedOtra("sub_fantasma", ghost());
  seedOtra("sub_nueva", ghost({ mp_preapproval_plan_id: "plan_adhoc_nueva", created_at: ago(2 * 60 * 60 * 1000) }));

  const s = await runReconcile();
  const g = otraSub("sub_fantasma");
  assert.equal(g.status, "pending");
  assert.ok(g.status_fixed_at);
  assert.equal(g.status_fix_reason, "reconcile:ghost_active_to_pending");
  const log = rawList(`merchants/${OTRA}/reconcile_log`).map(d => d.data);
  assert.equal(log.length, 1);
  assert.equal(log[0].subscriber_id, "sub_fantasma");
  assert.equal(log[0].to_status, "pending");
  assert.equal(otraSub("sub_nueva").status, "active", "una sub de 2 h no es fantasma todavía");
  assert.equal(s.merchants[OTRA].ghosts_to_pending, 1);
  assert.deepEqual(s.changed, [{ mid: OTRA, sid: "sub_fantasma", reason: "ghost_active_to_pending" }]);
  assert.deepEqual(rawGet("system/reconcile_last").changed, s.changed);
});

test("preapproval equivocado: clienta que paga marcada cancelada → relink al autorizado (external_reference) y vuelve a active", async () => {
  seedOtra("sub_real", subscriber({
    customer_email: "real@cliente.test", status: "cancelled", cancelled_at: ago(5 * DAY),
    mp_preapproval_plan_id: null, mp_preapproval_id: "pre_viejo", mp_preapproval_status: "cancelled",
  }));
  W.mp.addPreapproval(pre({ id: "pre_viejo", planId: null, status: "cancelled", dateCreated: ago(60 * DAY) }), MP_TOKEN);
  W.mp.addPreapproval(pre({ id: "pre_bueno", planId: null, status: "authorized", dateCreated: ago(40 * DAY), nextPaymentDate: "2026-10-01T10:00:00.000-03:00" }, `${OTRA}:sub_real`), MP_TOKEN);
  // Relink por plan ad-hoc en Lumina: activa, apunta a uno cancelado, el real está autorizado.
  W.seedSub("sub_bea", subscriber({ customer_email: "bea@cliente.test", mp_preapproval_plan_id: "plan_adhoc_bea", mp_preapproval_id: "pre_bea_viejo" }));
  W.mp.addPreapproval(pre({ id: "pre_bea_viejo", planId: "plan_adhoc_otro", status: "cancelled", dateCreated: ago(30 * DAY) }), MP_TOKEN);
  W.mp.addPreapproval(pre({ id: "pre_bea", planId: "plan_adhoc_bea", status: "authorized", dateCreated: ago(20 * DAY) }), MP_TOKEN);

  const s = await runReconcile();
  const r = otraSub("sub_real");
  assert.equal(r.mp_preapproval_id, "pre_bueno");
  assert.equal(r.mp_preapproval_id_prev, "pre_viejo");
  assert.equal(r.mp_preapproval_status, "authorized");
  assert.equal(r.next_charge_at, "2026-10-01T10:00:00.000-03:00");
  assert.equal(r.status, "active", "la clienta que paga sigue cancelada");
  assert.equal(r.status_fix_reason, "reconcile:relink+status_cancelled_to_active");
  const b = W.sub("sub_bea");
  assert.equal(b.mp_preapproval_id, "pre_bea");
  assert.equal(b.status, "active");
  assert.equal(b.status_fix_reason, "reconcile:relink");
  assert.equal(s.merchants[OTRA].relinked, 1);
  assert.equal(s.merchants[OTRA].status_fixed, 1);
  assert.equal(s.merchants[MID].relinked, 1);
  assert.equal(s.merchants[MID].status_fixed, 0);
  assert.equal(W.mp.preapprovalUpdates.length, 0, "la conciliación nunca modifica nada en MP");
});

test("payment_failed no baja a active aunque el preapproval esté autorizado; un plan compartido no identifica a nadie", async () => {
  W.seedSub("sub_rechazo", subscriber({ customer_email: "rech@cliente.test", status: "payment_failed", last_payment_failed_id: "999" }));
  W.mp.addPreapproval(pre({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  // Flujo viejo: dos subs con el MISMO plan de MP, sin preapproval guardado.
  W.seedSub("sub_c1", subscriber({ customer_email: "c1@cliente.test", status: "cancelled", mp_preapproval_plan_id: "plan_global", mp_preapproval_id: null }));
  W.seedSub("sub_c2", subscriber({ customer_email: "c2@cliente.test", status: "cancelled", mp_preapproval_plan_id: "plan_global", mp_preapproval_id: null }));
  W.mp.addPreapproval(pre({ id: "pre_de_alguien", planId: "plan_global" }), MP_TOKEN);
  resetStats();

  const s = await runReconcile();
  assert.equal(W.sub("sub_rechazo").status, "payment_failed");
  assert.equal(W.sub("sub_c1").status, "cancelled");
  assert.equal(W.sub("sub_c1").mp_preapproval_id, null);
  assert.equal(W.sub("sub_c2").mp_preapproval_id, null);
  assert.deepEqual(writesOutsideSummary(), []);
  assert.equal(s.corrections, 0);
});

test("renovación aprobada en MP sin registrar → exactamente una orden; la segunda corrida no crea nada", async () => {
  seedOtra("sub_renov", subscriber({ customer_email: "renov@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_renov" }));
  W.mp.addPreapproval(pre({ id: "pre_renov", planId: null }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000300, amount: 12300, preapprovalId: "pre_renov", dateCreated: ago(3 * DAY) }), MP_TOKEN);
  // Un rechazado y uno ya registrado: no se tocan.
  W.mp.addPayment(mpPayment({ id: 1310000301, status: "rejected", amount: 12300, preapprovalId: "pre_renov", dateCreated: ago(2 * DAY) }), MP_TOKEN);

  const s1 = await runReconcile();
  assert.equal(otra.orderPosts.length, 1, "la renovación quedó sin orden");
  assert.equal(W.shopify.orderPosts.length, 0, "no tiene que ir a Lumina");
  assert.ok(rawGet(`merchants/${OTRA}/charges/1310000300`)?.shopify_order_id);
  assert.deepEqual(s1.missed_payments.map(m => [m.mid, m.sid, m.payment_id, m.result]), [[OTRA, "sub_renov", "1310000300", "synced"]]);
  assert.equal(s1.merchants[OTRA].missed_payments_processed, 1);
  assert.equal(otraSub("sub_renov").shopify_orders.length, 2);

  const s2 = await runReconcile();
  assert.equal(otra.orderPosts.length, 1);
  assert.deepEqual(s2.missed_payments, []);
  assert.equal(s2.corrections, 0);
});

test("cuenta real: la búsqueda por preapproval_id devuelve vacío → el sync no lo ve y se linkea directo (una sola orden)", async () => {
  // Como en la cuenta de LuminaLabs/INDATROPIC: /v1/payments/search?preapproval_id= no trae nada.
  W.router.failNext("GET", "api.mercadopago.com", /^\/v1\/payments\/search$/, (call) => {
    const q = call.query;
    if (q.preapproval_id) return { json: { results: [], paging: { total: 0 } } };
    let list = [...W.mp.payments.values()].map(({ _token, ...p }) => p);
    if (q.external_reference) list = list.filter(p => p.external_reference === q.external_reference);
    if (q.begin_date) list = list.filter(p => Date.parse(p.date_created) >= Date.parse(q.begin_date));
    if (q.end_date) list = list.filter(p => Date.parse(p.date_created) <= Date.parse(q.end_date));
    return { json: { results: list, paging: { total: list.length } } };
  }, 1000);
  seedOtra("sub_vieja", subscriber({ customer_email: "vieja@cliente.test", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_vieja" }));
  W.mp.addPreapproval(pre({ id: "pre_vieja", planId: null }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000350, amount: 12300, preapprovalId: "pre_vieja", dateCreated: ago(4 * DAY) }), MP_TOKEN);

  const s1 = await runReconcile();
  assert.equal(otra.orderPosts.length, 1);
  assert.equal(s1.missed_payments[0].result, "linked");
  assert.ok(rawGet(`merchants/${OTRA}/charges/1310000350`)?.shopify_order_id);
  await runReconcile();
  assert.equal(otra.orderPosts.length, 1, "la segunda corrida no duplica");
});

test("una tienda archivada se saltea entera", async () => {
  seedDoc("merchants/archivada", luminaMerchant({ store_name: "Vieja", archived_at: ago(DAY) }));
  seedDoc("merchants/archivada/subscribers/sub_x", ghost());
  const s = await runReconcile();
  assert.equal(rawGet("merchants/archivada/subscribers/sub_x").status, "active");
  assert.ok(s.skipped.some(x => x.mid === "archivada" && x.reason === "archived"));
  assert.equal(s.merchants.archivada, undefined);
});

test("RECONCILE_DRY_RUN=1: informa todo y no escribe nada salvo el resumen", async () => {
  process.env.RECONCILE_DRY_RUN = "1";
  seedOtra("sub_fantasma", ghost());
  seedOtra("sub_real", subscriber({ customer_email: "real@cliente.test", status: "cancelled", mp_preapproval_plan_id: null, mp_preapproval_id: "pre_viejo" }));
  W.mp.addPreapproval(pre({ id: "pre_viejo", planId: null, status: "cancelled", dateCreated: ago(60 * DAY) }), MP_TOKEN);
  W.mp.addPreapproval(pre({ id: "pre_bueno", planId: null, dateCreated: ago(40 * DAY) }, `${OTRA}:sub_real`), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000400, amount: 12300, preapprovalId: "pre_bueno", dateCreated: ago(DAY) }), MP_TOKEN);
  resetStats();

  const s = await runReconcile();
  assert.deepEqual(writesOutsideSummary(), []);
  assert.equal(s.dry_run, true);
  assert.equal(s.totals.ghosts_to_pending, 1);
  assert.equal(s.totals.relinked, 1);
  assert.equal(s.totals.status_fixed, 1);
  assert.deepEqual(s.missed_payments.map(m => [m.sid, m.payment_id, m.result]), [["sub_real", "1310000400", "dry_run"]]);
  assert.equal(otra.orderPosts.length, 0);
  assert.equal(otraSub("sub_fantasma").status, "active");
  assert.equal(otraSub("sub_real").mp_preapproval_id, "pre_viejo");
  assert.equal(rawGet("system/reconcile_last").dry_run, true);
});

test("Lumina con todo en orden: cero escrituras, cero llamadas a Shopify", async () => {
  W.seedSub("sub_ana", subscriber());
  W.seedSub("sub_baja", subscriber({ customer_email: "baja@cliente.test", status: "cancelled", mp_preapproval_plan_id: "plan_adhoc_baja", mp_preapproval_id: "pre_baja" }));
  W.seedSub("sub_lead", subscriber({ customer_email: "lead@cliente.test", status: "pending", mp_preapproval_plan_id: "plan_adhoc_lead", mp_preapproval_id: null, last_charge_at: null, shopify_orders: [] }));
  W.mp.addPreapproval(pre({ id: "pre_ana", planId: "plan_adhoc_ana" }), MP_TOKEN);
  W.mp.addPreapproval(pre({ id: "pre_baja", planId: "plan_adhoc_baja", status: "cancelled" }), MP_TOKEN);
  W.mp.addPayment(mpPayment({ id: 1310000500, amount: 12300, preapprovalId: "pre_ana", dateCreated: ago(DAY) }), MP_TOKEN);
  seedDoc(`merchants/${MID}/charges/1310000500`, { subscriber_id: "sub_ana", mp_payment_id: "1310000500", status: "approved", shopify_order_id: 5550001 });
  resetStats();

  const s = await runReconcile();
  assert.deepEqual(writesOutsideSummary(), []);
  assert.equal(s.corrections, 0);
  assert.equal(s.merchants[MID].checked, 3);
  assert.equal(W.shopifyCalls().length, 0);
  assert.equal(W.router.find({ method: "PUT" }).length, 0);
});

test("cron ?action=reconcile-mp: exige la auth del cron y deja heartbeat", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    const no = await invoke(cron, { method: "GET", query: { action: "reconcile-mp" } });
    assert.equal(no.statusCode, 401);
    const yes = await invoke(cron, { method: "GET", query: { action: "reconcile-mp" }, headers: { authorization: "Bearer test-cron-secret" } });
    assert.equal(yes.statusCode, 200);
    assert.equal(yes.body.ok, true);
    assert.ok(rawGet("system/cron_heartbeat")?.["reconcile-mp"]?.last_ok_at);
    assert.ok(rawGet("system/reconcile_last")?.at);
  } finally { delete process.env.CRON_SECRET; }
});

test("reglas puras: prioridad del preapproval y estados que nunca se tocan", () => {
  const p = (id, status, d) => ({ id, status, date_created: d });
  assert.equal(pickTruePreapproval([p("a", "cancelled", "2026-09-01"), p("b", "authorized", "2026-01-01"), p("c", "paused", "2026-09-10")]).id, "b");
  assert.equal(pickTruePreapproval([p("a", "authorized", "2026-01-01"), p("b", "authorized", "2026-02-01")]).id, "b");
  assert.equal(desiredStatus({ status: "payment_failed", last_charge_at: "x" }, { status: "authorized" }), null);
  assert.equal(desiredStatus({ status: "pending" }, { status: "authorized" }), null, "authorized sin cobro previo no activa");
  assert.equal(desiredStatus({ status: "paused", shopify_orders: [1] }, { status: "authorized" }), "active");
  assert.equal(desiredStatus({ status: "payment_failed" }, { status: "cancelled" }), "cancelled");
});
