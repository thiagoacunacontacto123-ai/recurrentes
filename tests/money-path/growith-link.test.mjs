// (t) Vinculación con Growith (api/_lib/growith.js; public.js growith-*; merchant.js growith-code/unlink).
//
// Lo que protege: que el código sea de UNA tienda y venza; que la api_key nunca quede
// en claro ni salga por el GET del merchant; que Growith solo lea cobros (con la
// comisión real) y nada del cliente; que desvincular de cualquier lado corte el acceso;
// y que sin vincular no cambie nada (Lumina arranca desvinculada).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID } from "../helpers/world.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";
import { invoke } from "../helpers/http.mjs";

const { default: publicApi } = await loadApi("api/public.js");
const { default: merchantApi } = await loadApi("api/merchant.js");
const owner = { authorization: `Bearer test:${MID}` };

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => W.router.assertClean());

async function vincular() {
  const c = await invoke(merchantApi, { method: "GET", query: { action: "growith-code", tid: "gh_uid_1", name: "Lumina en Growith" }, headers: owner });
  assert.equal(c.statusCode, 200, JSON.stringify(c.body));
  const u = new URL(c.body.url);
  assert.equal(u.origin, "https://www.growithapp.com");
  assert.equal(u.searchParams.get("recurrentes_merchant"), MID);
  const code = u.searchParams.get("recurrentes_code");
  const r = await invoke(publicApi, { method: "POST", query: { action: "growith-link" }, body: { code, tenant_id: "gh_uid_1", store_name: "Lumina en Growith" } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  return r.body;
}

test("(t) Lumina arranca SIN vincular: el merchant dice growith_linked:false", async () => {
  const me = await invoke(merchantApi, { method: "GET", query: {}, headers: owner });
  assert.equal(me.body.merchant.growith_linked, false);
});

test("(t) vincular: código de la tienda → api_key; queda hasheada y el panel ve 'vinculado' sin la clave", async () => {
  const b = await vincular();
  assert.match(b.api_key, /^rk_[a-f0-9]{48}$/);
  assert.equal(b.merchant.id, MID);
  const m = rawGet(`merchants/${MID}`);
  assert.equal(m.growith_tenant_id, "gh_uid_1");
  assert.ok(m.growith_api_key_hash && m.growith_api_key_hash !== b.api_key, "solo el hash");
  const me = await invoke(merchantApi, { method: "GET", query: {}, headers: owner });
  assert.equal(me.body.merchant.growith_linked, true);
  assert.equal(me.body.merchant.growith_store_name, "Lumina en Growith");
  assert.equal(JSON.stringify(me.body).includes(b.api_key), false, "la api_key no viaja al panel");
});

test("(t) un código usado, inventado o de otro tipo no vincula", async () => {
  const c = await invoke(merchantApi, { method: "GET", query: { action: "growith-code" }, headers: owner });
  const code = new URL(c.body.url).searchParams.get("recurrentes_code");
  const r1 = await invoke(publicApi, { method: "POST", query: { action: "growith-link" }, body: { code: code + "x", tenant_id: "gh" } });
  assert.equal(r1.statusCode, 400);
  const { signToken } = await loadApi("api/_lib/token.js");
  const r2 = await invoke(publicApi, { method: "POST", query: { action: "growith-link" }, body: { code: signToken({ t: "portal", m: MID }, 600), tenant_id: "gh" } });
  assert.equal(r2.statusCode, 400, "otro tipo de token no sirve");
  const r3 = await invoke(publicApi, { method: "POST", query: { action: "growith-link" }, body: { code, tenant_id: "" } });
  assert.equal(r3.statusCode, 400, "sin tenant no");
});

test("(t) con la api_key Growith lee los cobros con su comisión real y nada del cliente", async () => {
  const { api_key } = await vincular();
  seedDoc(`merchants/${MID}/charges/pre1-1`, { subscriber_id: "s1", mp_payment_id: "9001", amount_ars: 12300, mp_fee_real: 1010.5, status: "approved", shopify_order_id: "5001", created_at: "2026-09-20T12:00:00.000Z" });
  seedDoc(`merchants/${MID}/charges/pre1-2`, { subscriber_id: "s1", mp_payment_id: "9002", amount_ars: 12300, status: "approved", shopify_order_id: "5002", created_at: "2026-09-25T12:00:00.000Z" });
  seedDoc(`merchants/${MID}/charges/viejo`, { subscriber_id: "s1", mp_payment_id: "8000", amount_ars: 9000, status: "approved", created_at: "2026-06-01T12:00:00.000Z" });
  const r = await invoke(publicApi, { method: "GET", query: { action: "growith-charges", from: "2026-09-01", to: "2026-09-30" }, headers: { authorization: `Bearer ${api_key}` } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const ids = r.body.charges.map((c) => c.payment_id).sort();
  assert.deepEqual(ids, ["9001", "9002"], "solo el período");
  const c1 = r.body.charges.find((c) => c.payment_id === "9001");
  assert.equal(c1.fee, 1010.5);
  assert.equal(c1.order_id, "5001");
  assert.equal(r.body.charges.find((c) => c.payment_id === "9002").fee, null, "cobro viejo sin fee → null, Growith cae a su cruce");
  assert.equal(JSON.stringify(r.body).includes("customer_email"), false);
  const me = await invoke(publicApi, { method: "GET", query: { action: "growith-me" }, headers: { authorization: `Bearer ${api_key}` } });
  assert.equal(me.body.merchant.id, MID);
});

test("(t) sin api_key o con una inventada: 401", async () => {
  const r = await invoke(publicApi, { method: "GET", query: { action: "growith-charges" }, headers: { authorization: "Bearer rk_" + "a".repeat(48) } });
  assert.equal(r.statusCode, 401);
  const r2 = await invoke(publicApi, { method: "GET", query: { action: "growith-charges" } });
  assert.equal(r2.statusCode, 401);
});

test("(t) desvincular desde Recurrentes corta la clave de Growith; desde Growith también", async () => {
  const { api_key } = await vincular();
  const u = await invoke(merchantApi, { method: "PATCH", query: { action: "growith-unlink" }, headers: owner, body: {} });
  assert.equal(u.statusCode, 200);
  assert.equal((await invoke(publicApi, { method: "GET", query: { action: "growith-me" }, headers: { authorization: `Bearer ${api_key}` } })).statusCode, 401);
  assert.equal((await invoke(merchantApi, { method: "GET", query: {}, headers: owner })).body.merchant.growith_linked, false);

  const { api_key: k2 } = await vincular();
  const g = await invoke(publicApi, { method: "POST", query: { action: "growith-unlink" }, headers: { authorization: `Bearer ${k2}` } });
  assert.equal(g.statusCode, 200);
  assert.equal(rawGet(`merchants/${MID}`).growith_api_key_hash, undefined);
});
