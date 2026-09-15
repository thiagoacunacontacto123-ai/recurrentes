// Chequeos del propio andamiaje (Firestore en memoria + router de fetch). Si esto
// falla, el resto de los tests no significa nada.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeDb as db, FieldValue, Timestamp, resetFirestore, rawGet, stats, transactionStats } from "../helpers/fake-firestore.mjs";
import { createFetchRouter } from "../helpers/fetch-router.mjs";
import { loadApi } from "../helpers/world.mjs";

beforeEach(() => resetFirestore());

test("los módulos de api/ usan el Firestore en memoria (mock inyectado)", async () => {
  const fb = await loadApi("api/_lib/firebase.js");
  assert.equal(fb.__isTestMock, true);
  assert.equal(fb.db(), db);
  const fs = await import("firebase-admin/firestore");
  assert.equal(fs.FieldValue, FieldValue);
});

test("transacciones serializables: dos read-modify-write en paralelo no pierden escrituras", async () => {
  const ref = db.collection("c").doc("x");
  await ref.set({ n: 0 });
  const bumpN = () => db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    await new Promise(r => setImmediate(r));
    tx.set(ref, { n: s.data().n + 1 });
  });
  const before = transactionStats.retries;
  await Promise.all([bumpN(), bumpN(), bumpN()]);
  assert.equal(rawGet("c/x").n, 3);
  assert.ok(transactionStats.retries > before, "hubo conflicto y reintento");
});

test("undefined en un write lanza (como production sin ignoreUndefinedProperties)", async () => {
  await assert.rejects(db.collection("c").doc("y").set({ a: 1, b: undefined }), /undefined/);
  await assert.rejects(db.collection("c").doc("y").update({ a: 1 }), (e) => e.code === 5);
  await db.collection("c").doc("z").create({ a: 1 });
  await assert.rejects(db.collection("c").doc("z").create({ a: 2 }), (e) => e.code === 6);
});

test("FieldValue + update con dotted paths + set merge profundo", async () => {
  const ref = db.collection("c").doc("f");
  await ref.set({ list: [1], n: 1, m: { a: 1, b: 2 }, gone: true });
  await ref.update({ list: FieldValue.arrayUnion(1, 2), n: FieldValue.increment(2), "m.a": 9, gone: FieldValue.delete() });
  assert.deepEqual(rawGet("c/f"), { list: [1, 2], n: 3, m: { a: 9, b: 2 } });
  await ref.set({ m: { c: 3 } }, { merge: true });
  assert.deepEqual(rawGet("c/f").m, { a: 9, b: 2, c: 3 });
  await ref.update({ m: { only: 1 } });
  assert.deepEqual(rawGet("c/f").m, { only: 1 }, "update de un mapa reemplaza el campo");
  assert.equal(Timestamp.fromMillis(1500).toMillis(), 1500);
});

test("queries: != excluye docs sin el campo, rango solo mismo tipo, orderBy/limit/count", async () => {
  const c = db.collection("q");
  await c.doc("a").set({ t: "x", n: 1 });
  await c.doc("b").set({ n: 2 });
  await c.doc("c").set({ t: "", n: "3" });
  assert.deepEqual((await c.where("t", "!=", "").get()).docs.map(d => d.id), ["a"]);
  assert.deepEqual((await c.where("n", ">=", 1).get()).docs.map(d => d.id), ["a", "b"]);
  assert.deepEqual((await c.orderBy("t", "desc").limit(1).get()).docs.map(d => d.id), ["a"]);
  assert.equal((await c.count().get()).data().count, 3);
  const before = stats.readOps;
  await c.doc("a").get();
  assert.equal(stats.readOps, before + 1);
});

test("router de fetch: bloquea hosts no permitidos y registra llamadas sin stub", async () => {
  const r = createFetchRouter().install();
  await assert.rejects(fetch("https://graph.facebook.com/v19.0/x"), /host no permitido/);
  const res = await fetch("https://api.mercadopago.com/v1/payments/1");
  assert.equal(res.status, 404);
  assert.equal(r.unexpected.length, 2);
  assert.throws(() => r.assertClean());
});
