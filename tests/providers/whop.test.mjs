// Adapter de Whop: firma Standard Webhooks, mapeo de eventos, checkout,
// cancel/pause/resume y testCredentials. Sin red: fetch falso.
// Correr: node tests/providers/whop.test.mjs
import crypto from "node:crypto";

const R = new URL("../../", import.meta.url).pathname;
process.env.WHOP_ENABLED = "1";
delete process.env.WHOP_WEBHOOK_SECRET;

const calls = [];
let productsStatus = 200;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body });
  if (u === "https://api.whop.com/api/v1/products" && opts.method === "POST") return json({ id: "prod_new" });
  if (u.startsWith("https://api.whop.com/api/v1/products?")) return productsStatus === 200 ? json({ data: [{ id: "prod_1", company: { id: "biz_1", title: "Mi Academia" } }], page_info: {} }) : json({ error: { message: "nope" } }, productsStatus);
  if (u === "https://api.whop.com/api/v1/checkout_configurations") return json({ id: "ch_1", purchase_url: "/checkout/ch_1/", plan: { id: "plan_1" } });
  const m = u.match(/\/memberships\/(mem_\w+)\/(cancel|pause|resume)$/);
  if (m) return json({ id: m[1], status: m[2] === "cancel" ? "canceling" : "active" });
  throw new Error("fetch inesperado " + u);
};

const { default: whop, verifyWhopSignature, mapWhopEvent } = await import(`${R}api/_lib/providers/whop.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? "" : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
const now = () => Math.floor(Date.now() / 1000);
const SECRET = "ws_test_secret_1234567890";
const sigOf = (key, id, ts, body) => crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
const headersFor = (body, { secret = SECRET, id = "msg_1", ts = now(), extra = "" } = {}) => ({ "webhook-id": id, "webhook-timestamp": String(ts), "webhook-signature": `${extra}v1,${sigOf(secret, id, ts, body)}`, "content-type": "application/json" });

// ── Interfaz ──
const KEYS = ["id", "label", "currency", "isEnabled", "createSubscriptionCheckout", "parseWebhook", "cancel", "pause", "resume", "testCredentials"];
ok(KEYS.every(k => k in whop), "expone todas las claves del adapter");
ok(whop.id === "whop" && whop.currency === "USD" && whop.isEnabled(), "id whop, USD, prendido con WHOP_ENABLED");
process.env.WHOP_ENABLED = "0"; ok(!whop.isEnabled(), "apagado con WHOP_ENABLED=0"); process.env.WHOP_ENABLED = "1";

// ── Firma ──
{
  const body = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_1" } });
  ok(verifyWhopSignature(body, headersFor(body), SECRET).ok, "firma válida (clave = ws_… tal cual)");
  eq(verifyWhopSignature(body.replace("pay_1", "pay_2"), headersFor(body), SECRET).reason, "bad_signature", "body adulterado → bad_signature");
  eq(verifyWhopSignature(body, headersFor(body), "ws_otro_secreto_000").reason, "bad_signature", "otro secreto → bad_signature");
  eq(verifyWhopSignature(body, headersFor(body, { ts: now() - 301 }), SECRET).reason, "timestamp_out_of_tolerance", "timestamp viejo → rechazado");
  ok(verifyWhopSignature(body, headersFor(body, { extra: "v1,AAAA " }), SECRET).ok, "varias firmas en el header, una correcta → ok");
  const h = headersFor(body); h["webhook-id"] = "msg_2";
  eq(verifyWhopSignature(body, h, SECRET).reason, "bad_signature", "webhook-id cambiado → bad_signature");
  eq(verifyWhopSignature(body, { "webhook-signature": "v1,x" }, SECRET).reason, "bad_header", "faltan headers → bad_header");
  eq(verifyWhopSignature(body, headersFor(body), []).reason, "no_secret", "sin secreto → no_secret");
  const std = Buffer.from("clave-estandar-123").toString("base64");
  ok(verifyWhopSignature(body, headersFor(body, { secret: Buffer.from("clave-estandar-123") }), `whsec_${std}`).ok, "secreto whsec_<base64> (Standard Webhooks genérico) también");
  ok(verifyWhopSignature(body, headersFor(body), ["ws_viejo_000000", SECRET]).ok, "lista de secretos (merchant + app)");
}

// ── Mapeo ──
const meta = { merchantId: "m1", subscriberId: "s1", planId: "p1" };
{
  const paid = { id: "msg_a", type: "payment.succeeded", account_id: "biz_1", timestamp: "2026-09-15T12:00:00.000Z", data: {
    id: "pay_1", status: "paid", substatus: "succeeded", total: 9.99, usd_total: 9.99, currency: "usd", paid_at: "2026-09-15T11:59:00.000Z",
    billing_reason: "subscription_create", membership: { id: "mem_1", status: "active" }, user: { email: "ana@mail.com" }, metadata: meta } };
  const r = mapWhopEvent(paid);
  eq([r.merchantId, r.companyId], ["m1", "biz_1"], "payment.succeeded → merchant y empresa");
  const e = r.events[0];
  eq([e.type, e.providerSubscriptionId, e.subscriberRef, e.paymentId, e.amount, e.currency, e.date], ["charge_approved", "mem_1", "s1", "pay_1", 9.99, "USD", "2026-09-15T11:59:00.000Z"], "payment.succeeded → charge_approved completo");
  ok(e.raw.first_charge === true && e.raw.customer_email === "ana@mail.com", "raw: primer cobro + mail");

  const failed = mapWhopEvent({ type: "payment.failed", data: { id: "pay_2", total: 9.99, currency: "usd", membership: { id: "mem_1" }, metadata: meta, failure_message: "card_declined" } }).events[0];
  eq([failed.type, failed.paymentId, failed.raw.failure_message], ["charge_failed", "pay_2", "card_declined"], "payment.failed → charge_failed");

  const deact = mapWhopEvent({ type: "membership.deactivated", data: { id: "mem_1", status: "canceled", metadata: meta } });
  eq([deact.merchantId, deact.events[0].type, deact.events[0].providerSubscriptionId, deact.events[0].subscriberRef], ["m1", "subscription_cancelled", "mem_1", "s1"], "membership.deactivated → subscription_cancelled");
  eq(mapWhopEvent({ type: "membership.activated", data: { id: "mem_1", metadata: meta } }).events, [], "membership.activated → sin eventos (el cobro llega aparte)");
  eq(mapWhopEvent({ action: "app_payment_succeeded", data: { id: "pay_3", final_amount: 5, currency: "usd", membership_id: "mem_9", membership: { metadata: meta } } }).events.map(e => [e.type, e.amount, e.providerSubscriptionId, e.subscriberRef]), [["charge_approved", 5, "mem_9", "s1"]], "nombres viejos (action) y metadata en la membresía");
  eq(mapWhopEvent({ type: "dispute.created", data: {} }).events, [], "evento no escuchado → sin eventos");
}

// ── parseWebhook ──
{
  const event = { id: "msg_w", type: "payment.succeeded", account_id: "biz_1", data: { id: "pay_9", total: 20, currency: "usd", membership: { id: "mem_1" }, metadata: meta } };
  const body = JSON.stringify(event);
  const merchant = { id: "m1", whop_company_id: "biz_1", whop_webhook_secret: SECRET };
  const getMerchant = async (id) => (id === "m1" ? merchant : null);
  const req = (b, headers, query = { mid: "m1" }) => ({ headers, rawBody: b, query });

  const r = await whop.parseWebhook(req(body, headersFor(body, { id: "msg_w" })), { getMerchant });
  ok(r.ok && r.merchantId === "m1" && r.events[0].amount === 20 && r.eventId === "msg_w", "webhook válido → ok + evento");
  ok((await whop.parseWebhook(req(body, headersFor(body), {}), { getMerchant })).ok, "sin ?mid, el merchant sale de la metadata");

  const bad = await whop.parseWebhook(req(body.replace('"total":20', '"total":2000'), headersFor(body)), { getMerchant });
  ok(!bad.ok && bad.status === 401 && bad.events.length === 0, "body adulterado → 401 sin eventos");

  const wrongMid = await whop.parseWebhook(req(body, headersFor(body), { mid: "m2" }), { getMerchant });
  ok(!wrongMid.ok && wrongMid.events.length === 0, "?mid de otro merchant que la metadata → rechazado");

  const otherCo = await whop.parseWebhook(req(body, headersFor(body)), { getMerchant: async () => ({ ...merchant, whop_company_id: "biz_OTRA" }) });
  ok(!otherCo.ok && otherCo.events.length === 0, "empresa del evento ≠ empresa del merchant → rechazado");

  const noSecret = await whop.parseWebhook(req(body, headersFor(body)), { getMerchant: async () => ({ id: "m1", whop_company_id: "biz_1" }) });
  ok(!noSecret.ok, "merchant sin secreto y sin WHOP_WEBHOOK_SECRET → rechazado");
  process.env.WHOP_WEBHOOK_SECRET = "ws_app_level_secret_99";
  const appLevel = await whop.parseWebhook(req(body, headersFor(body, { secret: "ws_app_level_secret_99" })), { getMerchant: async () => ({ id: "m1", whop_company_id: "biz_1" }) });
  ok(appLevel.ok, "secreto de app (WHOP_WEBHOOK_SECRET) como respaldo");
  delete process.env.WHOP_WEBHOOK_SECRET;

  const old = await whop.parseWebhook(req(body, headersFor(body, { ts: now() - 900 })), { getMerchant });
  ok(!old.ok, "replay viejo → rechazado");
}

// ── Checkout ──
{
  const merchant = { whop_api_key: "apik_1", whop_company_id: "biz_1" };
  const args = { merchant, merchantId: "m1", subscriberId: "s1", sub: { plan_id: "p1" }, plan: { id: "p1", product_title: "Club de lectura" }, amount: 9.99, currency: "USD", frequencyDays: 30, backUrl: "https://www.recurrentesapp.com/#/checkout-success?merchant=m1&sub=s1" };
  calls.length = 0;
  const r = await whop.createSubscriptionCheckout(args);
  ok(calls[0].url.endsWith("/products") && calls[0].body.account_id === "biz_1" && calls[0].body.title === "Club de lectura", "crea el producto en la empresa");
  const cfg = calls[1];
  ok(cfg.url.endsWith("/checkout_configurations") && cfg.headers.Authorization === "Bearer apik_1", "POST /checkout_configurations con la API key del merchant");
  eq(cfg.body.plan, { company_id: "biz_1", product_id: "prod_new", currency: "usd", plan_type: "renewal", billing_period: 30, renewal_price: 9.99, title: "Club de lectura" }, "plan renewal inline (días, USD)");
  eq(cfg.body.metadata, { merchantId: "m1", subscriberId: "s1", planId: "p1", source: "recurrentes" }, "metadata para identificar al suscriptor");
  eq(cfg.body.redirect_url, args.backUrl, "redirect_url = backUrl");
  eq([r.checkoutUrl, r.providerPlanId, r.providerSubscriptionId, r.raw.product_id, r.raw.product_created], ["https://whop.com/checkout/ch_1/", "plan_1", null, "prod_new", true], "checkoutUrl absoluto + producto nuevo para guardar");

  calls.length = 0;
  await whop.createSubscriptionCheckout({ ...args, plan: { ...args.plan, whop_product_id: "prod_1", whop_product_company_id: "biz_1" } });
  ok(calls.length === 1 && calls[0].body.plan.product_id === "prod_1", "reusa el producto guardado en el plan");
  calls.length = 0;
  await whop.createSubscriptionCheckout({ ...args, plan: { ...args.plan, whop_product_id: "prod_1", whop_product_company_id: "biz_VIEJA" } });
  ok(calls.length === 2 && calls[1].body.plan.product_id === "prod_new", "producto de otra empresa → crea uno nuevo");

  let threw = false; try { await whop.createSubscriptionCheckout({ ...args, merchant: {} }); } catch (_) { threw = true; }
  ok(threw, "sin claves → error claro");
}

// ── cancel / pause / resume ──
{
  const merchant = { whop_api_key: "apik_1", whop_company_id: "biz_1" };
  calls.length = 0;
  await whop.cancel(merchant, "mem_1");
  eq([calls[0].url.endsWith("/memberships/mem_1/cancel"), calls[0].body], [true, { cancellation_mode: "at_period_end" }], "cancel → al final del período");
  calls.length = 0;
  await whop.cancel(merchant, "mem_1", { mode: "immediate" });
  eq(calls[0].body, { cancellation_mode: "immediate" }, "cancel inmediato si se pide");
  calls.length = 0;
  await whop.pause(merchant, "mem_1");
  eq([calls[0].url.endsWith("/memberships/mem_1/pause"), calls[0].body], [true, { void_payments: false }], "pause → /pause");
  calls.length = 0;
  await whop.resume(merchant, "mem_1");
  ok(calls[0].url.endsWith("/memberships/mem_1/resume") && calls[0].method === "POST", "resume → /resume");
}

// ── testCredentials ──
{
  calls.length = 0;
  const t = await whop.testCredentials({ api_key: "apik_1", company_id: "biz_1" });
  ok(t.ok && t.account.id === "biz_1" && t.account.title === "Mi Academia", "clave válida → ok + nombre de la empresa");
  ok(calls[0].url.includes("account_id=biz_1"), "valida contra la empresa indicada");
  productsStatus = 401;
  eq((await whop.testCredentials({ api_key: "mala", company_id: "biz_1" })).error, "La API key no es válida", "401 → mensaje claro");
  productsStatus = 403;
  ok(/permisos/.test((await whop.testCredentials({ api_key: "x", company_id: "biz_1" })).error), "403 → faltan permisos");
  productsStatus = 200;
  calls.length = 0;
  ok(!(await whop.testCredentials({ api_key: "x", company_id: "123" })).ok && calls.length === 0, "Company ID sin biz_ → error sin llamar a Whop");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
