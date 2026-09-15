// Lecturas acotadas del cron (mismo resultado, menos documentos) + fallback sin
// índice + field mask + log sin PII. Uso: node tests/reliability/cost.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";

const R = new URL("../../", import.meta.url).href;
const { db, __reads, __resetReads, __setMissingIndex } = await import(`${R}api/_lib/firebase.js`);
const { pendingsForRun, recentCancelled } = await import(`${R}api/cron.js`);
const { failedCharges } = await import(`${R}api/_lib/fulfillretry.js`);
const { __cleanForTest } = await import(`${R}api/_lib/log.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const now = Date.now();
const iso = (t) => new Date(t).toISOString();
const H = 3600e3, D = 24 * H;
const M = db().collection("merchants").doc("mc");
const subs = M.collection("subscribers");

// 300 pending viejos (leads acumulados) + 3 recientes (uno lead viejo con checkout nuevo).
for (let i = 0; i < 300; i++) await subs.doc("old" + i).set({ status: "pending", created_at: iso(now - 20 * D), updated_at: iso(now - 19 * D), mp_preapproval_plan_id: "pl" + i });
await subs.doc("new1").set({ status: "pending", created_at: iso(now - 2 * H), updated_at: iso(now - 2 * H), mp_preapproval_plan_id: "x1" });
await subs.doc("new2").set({ status: "pending", created_at: iso(now - 70 * H), updated_at: iso(now - 70 * H), mp_preapproval_plan_id: "x2" });
await subs.doc("lead").set({ status: "pending", created_at: iso(now - 10 * D), checkout_started_at: iso(now - 1 * H), updated_at: iso(now - 1 * H), mp_preapproval_plan_id: "x3" });
for (let i = 0; i < 200; i++) await subs.doc("c" + i).set({ status: "cancelled", created_at: iso(now - (100 + i) * D) });
for (let i = 0; i < 5; i++) await subs.doc("rc" + i).set({ status: "cancelled", created_at: iso(now - (10 + i) * D) });

// El filtro EXACTO del paso 3 del cron (copiado de api/cron.js).
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };
const step3 = (docs) => docs.filter(subDoc => {
  const d = subDoc.data();
  if (d.capture === true || !d.mp_preapproval_plan_id) return false;
  const created = ms(d.checkout_started_at || d.created_at);
  if (!created || now - created < 60 * 1000) return false;
  return now - created < 72 * H;
}).map(d => d.id).sort();

__resetReads();
const bounded = await pendingsForRun(subs, false, now);
const boundedReads = __reads();
__resetReads();
const full = await pendingsForRun(subs, true, now);
const fullReads = __reads();
ok(JSON.stringify(step3(bounded.docs)) === JSON.stringify(step3(full.docs)), "pendings acotados → mismos candidatos del paso 3 que la lectura completa");
ok(step3(bounded.docs).includes("lead"), "incluye el lead viejo que empezó el checkout hace 1h (created_at viejo)");
ok(boundedReads === 3 && fullReads === 303, `lecturas: ${boundedReads} en vez de ${fullReads}`);

__setMissingIndex((col, f) => f.some(([k]) => k === "updated_at"));
const fb = await pendingsForRun(subs, false, now);
__setMissingIndex(null);
ok(fb.size === 303, "sin índice (status, updated_at) → cae a la lectura completa, no rompe");

__resetReads();
const rc = await recentCancelled(subs, now);
ok(rc.size === 5 && __reads() === 5, "canceladas: solo las de 90 días (5 lecturas en vez de 205)");
__setMissingIndex((col, f) => f.some(([k]) => k === "created_at"));
ok((await recentCancelled(subs, now)).size === 205, "sin índice (status, created_at) → lectura completa");
__setMissingIndex(null);

// Charges fallidos: índice compuesto y fallback dan lo mismo.
const ch = M.collection("charges");
for (let i = 0; i < 40; i++) await ch.doc("ok" + i).set({ mp_payment_id: "ok" + i, status: "approved", shopify_order_id: 1000 + i, error: null, created_at: iso(now - i * H) });
await ch.doc("f1").set({ mp_payment_id: "f1", status: "approved", shopify_order_id: null, error: "x", created_at: iso(now - 5 * H) });
await ch.doc("f2").set({ mp_payment_id: "f2", status: "approved", shopify_order_id: null, error: "y", created_at: iso(now - 80 * H) }); // fuera de 72h
await ch.doc("pre-1").set({ mp_payment_id: "zz", status: "approved", shopify_order_id: null, error: "legacy", created_at: iso(now - 1 * H) }); // clave legacy
await ch.doc("claim").set({ mp_payment_id: "claim", claim_at: iso(now), created_at: iso(now) }); // en curso, sin campo de orden
__resetReads();
const a = (await failedCharges(M, now)).map(d => d.id);
const aReads = __reads();
__setMissingIndex((col, f) => f.some(([k]) => k === "shopify_order_id"));
__resetReads();
const b = (await failedCharges(M, now)).map(d => d.id);
const bReads = __reads();
__setMissingIndex(null);
ok(JSON.stringify(a) === JSON.stringify(["f1"]) && JSON.stringify(b) === JSON.stringify(["f1"]), "failedCharges: solo aprobados con error, en 72h, con clave = payment id");
ok(aReads < bReads, `con índice lee ${aReads} docs; sin índice ${bReads}`);

// Field mask (stats activity): solo los 3 campos.
await subs.doc("full").set({ status: "active", customer_name: "Ana", customer_email: "a@x.com", customer_phone: "11", plan_snapshot: { product_title: "Café", shopify_variant_id: 1 } });
const masked = (await subs.select("customer_name", "customer_email", "plan_snapshot.product_title").get()).docs.find(d => d.id === "full").data();
ok(JSON.stringify(masked) === JSON.stringify({ customer_name: "Ana", customer_email: "a@x.com", plan_snapshot: { product_title: "Café" } }), "select() devuelve solo los campos del mapa de clientes");

// Log estructurado sin PII ni secretos.
const cl = __cleanForTest({ merchantId: "m1", paymentId: "123", email: "a@x.com", customer_name: "Ana", access_token: "APP_USR", error: "fallo para ana@x.com", nested: { phone: "11", orderId: 5 } });
ok(cl.merchantId === "m1" && cl.paymentId === "123" && cl.nested.orderId === 5, "log conserva ids");
ok(!("email" in cl) && !("customer_name" in cl) && !("access_token" in cl) && !("phone" in cl.nested) && !/ana@x\.com/.test(cl.error), "log descarta mails, nombres, teléfonos y tokens (también mails dentro de textos)");

// Handler REAL del cron: las acciones siguen respondiendo y dejan heartbeat.
{
  globalThis.fetch = async (u) => { throw new Error("fetch inesperado " + u); };
  process.env.CRON_SECRET = "cs_test";
  const { default: cron } = await import(`${R}api/cron.js`);
  await db().collection("merchants").doc("me2").set({ mp_access_token: "APP_USR-x", email: "d@x.com" });
  const run = (action, auth = "Bearer cs_test") => new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, setHeader() {}, json(o) { resolve({ status: this._s, body: o }); } };
    cron({ method: "GET", headers: { authorization: auth }, query: { action } }, res);
  });
  ok((await run("retry-fulfillment", "Bearer nope")).status === 401, "retry-fulfillment exige la auth del cron");
  const s1 = await run("sync-all-pending");
  const s2 = await run("run-flows");
  const s3 = await run("retry-fulfillment");
  ok(s1.body.ok && s2.body.ok && s3.body.ok && s3.body.retry_enabled === false, "sync-all-pending / run-flows / retry-fulfillment responden ok");
  const hb = (await db().collection("system").doc("cron_heartbeat").get()).data() || {};
  ok(["sync-all-pending", "run-flows", "retry-fulfillment"].every(k => hb[k]?.last_ok_at), "las 3 acciones dejan heartbeat en system/cron_heartbeat");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
