// Embudo a Meta (API de Conversiones) desde el checkout de Recurrentes:
// AddToCart al abrir, InitiateCheckout al dejar el mail (lead) y al tocar Pagar (mismo
// event_id → Meta deduplica), Purchase al activar (ya cubierto en webhook-payment).
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createWorld, loadApi, MID, PLAN_ID, ADDRESS } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { computeRecoverUrl } = await loadApi("api/_lib/abandoned.js");
const { default: widget, DEFAULT_CHECKOUT_SHIPPING_RATES } = await loadApi("api/widget.js");
const STANDARD = DEFAULT_CHECKOUT_SHIPPING_RATES[0];
const PIXEL = "1418108886870502", TOKEN = "EAAmetaTOKEN";
const sha = (v) => crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex");

let W, meta;
beforeEach(() => {
  W = createWorld();
  meta = [];
  W.router.on("POST", "graph.facebook.com", /\/events$/, (call) => { meta.push(call); return { json: { events_received: 1 } }; });
});
afterEach(() => { W.router.assertClean(); });

const FB = { fbp: "fb.1.1700000000.111", fbc: "fb.1.1700000000.AbC", event_source_url: "https://lumina.test/products/capsulas", user_agent: "UA-test" };
const post = (b) => invoke(init, { method: "POST", query: {}, body: b, headers: { "x-forwarded-for": "190.1.2.3" } });
const evs = () => meta.map(c => c.json.data[0]);

test("sin Meta conectado: el checkout no le habla a Meta en ningún paso", async () => {
  await post({ event: "view", merchant_id: MID, plan_id: PLAN_ID, view_id: "v1", fb: FB });
  await post({ merchant_id: MID, plan_id: PLAN_ID, capture: true, customer: { email: "dani@cliente.test", name: "Dani Gómez" }, fb: FB });
  assert.equal(meta.length, 0);
});

test("carrito (view) → AddToCart con fbp/fbc/IP/UA y event_id del view", async () => {
  seedDoc(`merchants/${MID}`, { ...W.merchant(), meta_pixel_id: PIXEL, meta_capi_token: TOKEN });
  const r = await post({ event: "view", merchant_id: MID, plan_id: PLAN_ID, view_id: "abc-123!", value: 12300, fb: FB });
  assert.equal(r.statusCode, 200);
  assert.equal(meta.length, 1);
  assert.ok(meta[0].url.startsWith(`https://graph.facebook.com/v21.0/${PIXEL}/events?access_token=${TOKEN}`));
  const e = evs()[0];
  assert.equal(e.event_name, "AddToCart");
  assert.equal(e.event_id, "rec_atc_abc-123");
  assert.equal(e.custom_data.value, 12300);
  assert.equal(e.user_data.fbp, FB.fbp); assert.equal(e.user_data.fbc, FB.fbc);
  assert.equal(e.user_data.client_ip_address, "190.1.2.3"); assert.equal(e.user_data.client_user_agent, "UA-test");
  assert.equal(e.event_source_url, FB.event_source_url);
  assert.equal(e.user_data.em, undefined, "sin mail todavía");
  assert.equal(W.subs().length, 0, "el view no guarda nada");
});

test("pago iniciado: el lead manda InitiateCheckout con el mail hasheado; Pagar repite el MISMO event_id", async () => {
  seedDoc(`merchants/${MID}`, { ...W.merchant(), meta_pixel_id: PIXEL, meta_capi_token: TOKEN });
  const lead = await post({ merchant_id: MID, plan_id: PLAN_ID, capture: true, quantity: 1, customer: { email: "Dani@Cliente.Test", name: "Dani Gómez", phone: "1144440000" }, fb: FB });
  assert.equal(lead.statusCode, 200);
  assert.equal(meta.length, 1);
  const e = evs()[0];
  assert.equal(e.event_name, "InitiateCheckout");
  assert.deepEqual(e.user_data.em, [sha("dani@cliente.test")]);
  assert.deepEqual(e.user_data.fn, [sha("Dani")]);
  assert.equal(e.user_data.fbc, FB.fbc);
  assert.equal(e.event_id, "rec_ic_" + lead.body.lead_id);
  assert.ok(e.custom_data.value > 0, "lleva el monto");
  const leadDoc = W.sub(lead.body.lead_id);
  assert.equal(leadDoc.fb_data.fbp, FB.fbp, "el lead guarda la atribución por si paga después");

  const pay = await post({ merchant_id: MID, plan_id: PLAN_ID, quantity: 1, customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20-30123456-7" }, shipping_address: { ...ADDRESS }, shipping_method: { name: STANDARD.name, code: "" }, fb: FB });
  assert.equal(pay.statusCode, 200, JSON.stringify(pay.body));
  assert.equal(pay.body.subscriber_id, lead.body.lead_id, "Pagar reusa el lead");
  const ic = evs().filter(x => x.event_name === "InitiateCheckout");
  assert.equal(ic.length, 2);
  assert.equal(ic[1].event_id, ic[0].event_id, "mismo event_id → Meta deduplica");
  assert.equal(W.sub(pay.body.subscriber_id).fb_data.client_ip_address, "190.1.2.3");
});

test("widget.js: las URLs al checkout llevan fbp/fbc/src para la atribución", async () => {
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(res.body.includes("function fbCheckoutQs()"));
  assert.equal((res.body.match(/\+ fbCheckoutQs\(\)/g) || []).length, 3, "packs, clásico y Tiendanube");
});

test("link de 'carrito sin pagar': siempre con merchant y plan (modo clásico), también para subs viejas sin merchant", async () => {
  const lead = await post({ merchant_id: MID, plan_id: PLAN_ID, capture: true, quantity: 2, frequency_days: 30, customer: { email: "dani@cliente.test", name: "Dani" } });
  const sub = W.sub(lead.body.lead_id);
  const rp = new URLSearchParams(sub.recover_path.split("?")[1]);
  assert.equal(rp.get("merchant"), MID); assert.equal(rp.get("plan"), PLAN_ID); assert.equal(rp.get("qty"), "2");
  const url = computeRecoverUrl(W.merchant(), sub, { merchantId: MID });
  assert.ok(url.startsWith("https://www.recurrentesapp.com/#/checkout?"), url);
  assert.equal(new URLSearchParams(url.split("?")[1]).get("merchant"), MID);
  // Sub guardada antes del fix: recover_path sin merchant → se completa igual.
  const old = { ...sub, recover_path: `/#/checkout?plan=${PLAN_ID}&qty=1&freq_days=30` };
  const fixed = computeRecoverUrl({ ...W.merchant(), id: MID }, old, { merchantId: MID, code: "VUELVE10", email: "dani@cliente.test" });
  const q = new URLSearchParams(fixed.split("?")[1]);
  assert.equal(q.get("merchant"), MID); assert.equal(q.get("plan"), PLAN_ID); assert.ok(q.get("rc"), "cupón firmado");
});
