// Adapter de Stripe: firma de webhooks, payload del checkout, mapeo de eventos,
// cancel/pause/resume y testCredentials. Sin red: fetch falso.
// Correr: node tests/providers/stripe.test.mjs
import crypto from "node:crypto";
import { Readable } from "node:stream";

const R = new URL("../../", import.meta.url).pathname;
process.env.STRIPE_ENABLED = "1";
process.env.STRIPE_SECRET_KEY = "sk_test_platform";
process.env.STRIPE_CONNECT_CLIENT_ID = "ca_test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_old, whsec_current";

const calls = [];
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body || "" });
  if (u === "https://api.stripe.com/v1/checkout/sessions") return json({ id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1", subscription: null, expires_at: 1700000000 });
  if (u.startsWith("https://api.stripe.com/v1/subscriptions/sub_1")) return json({ id: "sub_1", status: opts.method === "DELETE" ? "canceled" : "active" });
  if (u === "https://api.stripe.com/v1/accounts/acct_1") return json({ id: "acct_1", email: "yo@llc.com", country: "US", default_currency: "usd", charges_enabled: true, details_submitted: true, business_profile: { name: "Mi LLC" } });
  if (u === "https://api.stripe.com/v1/accounts/acct_bad") return json({ error: { message: "No such account" } }, 404);
  throw new Error("fetch inesperado " + u);
};

const mod = await import(`${R}api/_lib/providers/stripe.js`);
const { default: stripe, verifyStripeSignature, mapStripeEvent, recurringFromDays, formEncode } = mod;

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? "" : ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`}`);
const now = () => Math.floor(Date.now() / 1000);
const sign = (body, secret, t = now()) => `t=${t},v1=${crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

// ── Interfaz del registro ──
const KEYS = ["id", "label", "currency", "isEnabled", "createSubscriptionCheckout", "parseWebhook", "cancel", "pause", "resume", "testCredentials"];
ok(KEYS.every(k => k in stripe), "expone todas las claves del adapter");
ok(stripe.id === "stripe" && stripe.currency === "USD", "id stripe, moneda USD");
ok(stripe.isEnabled() === true, "isEnabled con STRIPE_ENABLED=1 + clave");
process.env.STRIPE_ENABLED = ""; ok(stripe.isEnabled() === false, "isEnabled apagado sin flag"); process.env.STRIPE_ENABLED = "1";

// ── Firma ──
{
  const body = JSON.stringify({ id: "evt_1", type: "invoice.paid" });
  ok(verifyStripeSignature(body, sign(body, "whsec_current"), process.env.STRIPE_WEBHOOK_SECRET).ok, "firma válida (2do secreto de la lista)");
  ok(verifyStripeSignature(Buffer.from(body), sign(body, "whsec_old"), ["whsec_old"]).ok, "firma válida con Buffer");
  eq(verifyStripeSignature(body.replace("evt_1", "evt_2"), sign(body, "whsec_current"), "whsec_current").reason, "bad_signature", "body adulterado → bad_signature");
  eq(verifyStripeSignature(body, sign(body, "whsec_otro"), "whsec_current").reason, "bad_signature", "otro secreto → bad_signature");
  eq(verifyStripeSignature(body, sign(body, "whsec_current", now() - 301), "whsec_current").reason, "timestamp_out_of_tolerance", "timestamp viejo (301s) → rechazado");
  ok(verifyStripeSignature(body, sign(body, "whsec_current", now() - 290), "whsec_current").ok, "timestamp de 290s → aceptado");
  eq(verifyStripeSignature(body, sign(body, "whsec_current", now() - 1000), "whsec_current", { toleranceSec: 0 }).reason, "timestamp_out_of_tolerance", "tolerancia 0 no desactiva el chequeo");
  const t = now();
  const v0only = `t=${t},v0=${crypto.createHmac("sha256", "whsec_current").update(`${t}.${body}`).digest("hex")}`;
  eq(verifyStripeSignature(body, v0only, "whsec_current").reason, "bad_header", "solo v0 → rechazado (downgrade)");
  const multi = `t=${t},v1=deadbeef,v1=${crypto.createHmac("sha256", "whsec_current").update(`${t}.${body}`).digest("hex")}`;
  ok(verifyStripeSignature(body, multi, "whsec_current").ok, "varias v1, una correcta → ok");
  eq(verifyStripeSignature(body, sign(body, "x"), "").reason, "no_secret", "sin secreto → no_secret");
  eq(verifyStripeSignature(body, "", "whsec_current").reason, "bad_header", "sin header → bad_header");
}

// ── Frecuencia ──
eq(recurringFromDays(30), { interval: "month", interval_count: 1 }, "30 días → 1 mes");
eq(recurringFromDays(90), { interval: "month", interval_count: 3 }, "90 días → 3 meses");
eq(recurringFromDays(7), { interval: "week", interval_count: 1 }, "7 días → 1 semana");
eq(recurringFromDays(14), { interval: "week", interval_count: 2 }, "14 días → 2 semanas");
eq(recurringFromDays(15), { interval: "day", interval_count: 15 }, "15 días → 15 días");
eq(recurringFromDays(365), { interval: "year", interval_count: 1 }, "365 días → 1 año");
{ let threw = false; try { recurringFromDays(1200); } catch (_) { threw = true; } ok(threw, "más de 3 años → error"); }
eq(formEncode({ a: { b: [{ c: 1 }] }, x: null, e: "" }).toString(), "a%5Bb%5D%5B0%5D%5Bc%5D=1&e=", "formEncode anidado estilo Stripe");

// ── Checkout ──
{
  calls.length = 0;
  const merchant = { stripe_account_id: "acct_1" };
  const r = await stripe.createSubscriptionCheckout({
    merchant, merchantId: "m1", subscriberId: "s1", sub: { plan_id: "p1", customer_email: "ana@mail.com" },
    plan: { id: "p1", product_title: "Curso de fotografía", frequency_days: 30 },
    amount: 19.99, currency: "USD", frequencyDays: 30,
    backUrl: "https://www.recurrentesapp.com/#/checkout-success?merchant=m1&sub=s1",
    customer: { email: "ana@mail.com" },
  });
  const c = calls[0];
  const p = new URLSearchParams(c.body);
  ok(c.method === "POST" && c.url.endsWith("/v1/checkout/sessions"), "POST /v1/checkout/sessions");
  ok(c.headers["Stripe-Account"] === "acct_1", "cobra en la cuenta conectada (Stripe-Account)");
  ok(c.headers.Authorization === "Bearer sk_test_platform", "con la clave de la plataforma");
  eq(p.get("mode"), "subscription", "mode=subscription");
  eq(p.get("line_items[0][price_data][currency]"), "usd", "currency usd");
  eq(p.get("line_items[0][price_data][unit_amount]"), "1999", "unit_amount en centavos (1999)");
  eq(p.get("line_items[0][price_data][recurring][interval]"), "month", "recurring month");
  eq(p.get("line_items[0][price_data][recurring][interval_count]"), "1", "interval_count 1");
  eq(p.get("line_items[0][price_data][product_data][name]"), "Curso de fotografía", "nombre del producto");
  eq(p.get("client_reference_id"), "m1:s1", "client_reference_id mid:sid");
  eq(p.get("metadata[merchantId]"), "m1", "metadata.merchantId");
  eq(p.get("metadata[subscriberId]"), "s1", "metadata.subscriberId");
  eq(p.get("subscription_data[metadata][subscriberId]"), "s1", "subscription_data.metadata.subscriberId (llega a cada factura)");
  eq(p.get("customer_email"), "ana@mail.com", "customer_email");
  ok(p.get("success_url").endsWith("&provider=stripe&session_id={CHECKOUT_SESSION_ID}"), "success_url con {CHECKOUT_SESSION_ID} literal");
  eq(p.get("cancel_url"), "https://www.recurrentesapp.com/#/checkout-success?merchant=m1&sub=s1", "cancel_url = backUrl");
  eq(r.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_1", "devuelve checkoutUrl");
  ok(r.providerSubscriptionId === null && r.providerPlanId === null, "sin suscripción hasta pagar");
  eq(r.raw.session_id, "cs_test_1", "raw.session_id");
  let threw = false; try { await stripe.createSubscriptionCheckout({ merchant: {}, merchantId: "m1", subscriberId: "s1", amount: 10, frequencyDays: 30, backUrl: "https://x" }); } catch (_) { threw = true; }
  ok(threw, "sin cuenta conectada → error claro");
  threw = false; try { await stripe.createSubscriptionCheckout({ merchant, merchantId: "m1", subscriberId: "s1", amount: 0, frequencyDays: 30, backUrl: "https://x" }); } catch (_) { threw = true; }
  ok(threw, "monto 0 → error");
}

// ── Mapeo de eventos ──
const meta = { merchantId: "m1", subscriberId: "s1", planId: "p1" };
{
  const basil = { id: "evt_a", type: "invoice.paid", account: "acct_1", created: 1757900000, data: { object: {
    id: "in_1", object: "invoice", amount_paid: 1999, amount_due: 1999, currency: "usd", billing_reason: "subscription_create", customer_email: "ana@mail.com",
    status_transitions: { paid_at: 1757900100 }, parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: meta } } } } };
  const r = mapStripeEvent(basil);
  eq(r.merchantId, "m1", "invoice.paid (basil) → merchantId de la metadata");
  const e = r.events[0];
  ok(r.events.length === 1 && e.type === "charge_approved", "invoice.paid → charge_approved");
  eq([e.providerSubscriptionId, e.subscriberRef, e.paymentId, e.amount, e.currency], ["sub_1", "s1", "in_1", 19.99, "USD"], "sub, suscriptor, id de pago, monto y moneda");
  eq(e.date, new Date(1757900100 * 1000).toISOString(), "fecha = paid_at");
  ok(e.raw.first_charge === true && e.raw.account === "acct_1", "raw: primer cobro + cuenta");

  const legacy = { id: "evt_b", type: "invoice.paid", data: { object: { id: "in_2", amount_paid: 500, currency: "usd", subscription: "sub_1", subscription_details: { metadata: meta }, billing_reason: "subscription_cycle" } } };
  const l = mapStripeEvent(legacy).events[0];
  eq([l.type, l.providerSubscriptionId, l.subscriberRef, l.amount, l.raw.first_charge], ["charge_approved", "sub_1", "s1", 5, false], "invoice.paid (forma vieja) también mapea");

  const lineMeta = { id: "evt_c", type: "invoice.paid", data: { object: { id: "in_3", amount_paid: 100, currency: "usd", subscription: "sub_1", lines: { data: [{ metadata: meta }] } } } };
  eq(mapStripeEvent(lineMeta).events[0].subscriberRef, "s1", "metadata desde la línea de la factura como último recurso");

  eq(mapStripeEvent({ type: "invoice.paid", data: { object: { id: "in_0", amount_paid: 0, currency: "usd", parent: { subscription_details: { subscription: "sub_1", metadata: meta } } } } }).events, [], "factura en $0 → sin eventos");
  eq(mapStripeEvent({ type: "invoice.paid", data: { object: { id: "in_x", amount_paid: 900, currency: "usd" } } }).events, [], "factura suelta (sin suscripción) → sin eventos");

  const failed = mapStripeEvent({ type: "invoice.payment_failed", created: 1757900200, data: { object: { id: "in_4", amount_due: 1999, currency: "usd", attempt_count: 2, next_payment_attempt: 1758000000, parent: { subscription_details: { subscription: "sub_1", metadata: meta } } } } }).events[0];
  eq([failed.type, failed.paymentId, failed.amount, failed.currency], ["charge_failed", "in_4:2", 19.99, "USD"], "invoice.payment_failed → charge_failed (id por intento)");

  const jpy = mapStripeEvent({ type: "invoice.paid", data: { object: { id: "in_j", amount_paid: 1500, currency: "jpy", subscription: "sub_1", subscription_details: { metadata: meta } } } }).events[0];
  eq([jpy.amount, jpy.currency], [1500, "JPY"], "moneda sin decimales (JPY) no se divide por 100");

  const del = mapStripeEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1", status: "canceled", metadata: meta } } });
  eq([del.merchantId, del.events[0].type, del.events[0].providerSubscriptionId, del.events[0].subscriberRef], ["m1", "subscription_cancelled", "sub_1", "s1"], "subscription.deleted → subscription_cancelled");

  const paused = mapStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", pause_collection: { behavior: "void" }, metadata: meta }, previous_attributes: { pause_collection: null } } });
  eq(paused.events.map(e => e.type), ["subscription_paused"], "updated con pause_collection nuevo → paused");
  const resumed = mapStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", pause_collection: null, metadata: meta }, previous_attributes: { pause_collection: { behavior: "void" } } } });
  eq(resumed.events.map(e => e.type), ["subscription_resumed"], "updated sin pause_collection → resumed");
  eq(mapStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "active", metadata: meta }, previous_attributes: { items: {} } } }).events, [], "otro cambio → sin eventos");
  eq(mapStripeEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1", status: "canceled", metadata: meta }, previous_attributes: { status: "active" } } }).events.map(e => e.type), ["subscription_cancelled"], "updated a canceled → cancelled");

  const cs = mapStripeEvent({ type: "checkout.session.completed", data: { object: { id: "cs_1", mode: "subscription", client_reference_id: "m1:s1", subscription: "sub_1", payment_status: "paid", customer_details: { email: "ana@mail.com" } } } });
  eq([cs.merchantId, cs.events.length, cs.link.subscriberRef, cs.link.providerSubscriptionId], ["m1", 0, "s1", "sub_1"], "checkout.session.completed → link (sin cobro: llega por invoice.paid)");
  eq(mapStripeEvent({ type: "charge.refunded", data: { object: {} } }).events, [], "evento no escuchado → sin eventos");
}

// ── parseWebhook de punta a punta ──
{
  const event = { id: "evt_w", type: "invoice.paid", account: "acct_1", data: { object: { id: "in_9", amount_paid: 2500, currency: "usd", parent: { subscription_details: { subscription: "sub_1", metadata: meta } } } } };
  const body = JSON.stringify(event);
  const req = (b, sig, extra = {}) => ({ headers: { "stripe-signature": sig }, rawBody: b, query: {}, ...extra });
  const getMerchant = async (id) => (id === "m1" ? { id: "m1", stripe_account_id: "acct_1" } : null);

  const r = await stripe.parseWebhook(req(body, sign(body, "whsec_current")), { getMerchant });
  ok(r.ok && r.merchantId === "m1" && r.events.length === 1 && r.events[0].amount === 25 && r.eventId === "evt_w", "webhook válido → ok + evento");

  const stream = Readable.from([Buffer.from(body)]);
  stream.headers = { "stripe-signature": sign(body, "whsec_current") };
  stream.query = {};
  ok((await stripe.parseWebhook(stream, { getMerchant })).ok, "lee el body crudo del stream (Vercel)");

  const bad = await stripe.parseWebhook(req(body.replace("2500", "250000"), sign(body, "whsec_current")), { getMerchant });
  ok(!bad.ok && bad.status === 400 && bad.events.length === 0, "body adulterado → rechazado, sin eventos");

  const old = await stripe.parseWebhook(req(body, sign(body, "whsec_current", now() - 600)), { getMerchant });
  ok(!old.ok && /timestamp/.test(old.error), "replay viejo → rechazado");

  const other = await stripe.parseWebhook(req(body, sign(body, "whsec_current")), { getMerchant: async () => ({ id: "m1", stripe_account_id: "acct_OTRO" }) });
  ok(!other.ok && other.events.length === 0, "cuenta del evento ≠ cuenta del merchant → rechazado");

  const missing = await stripe.parseWebhook(req(body, sign(body, "whsec_current")), { getMerchant: async () => null });
  ok(!missing.ok && missing.events.length === 0, "merchant inexistente → sin eventos");

  const saved = process.env.STRIPE_WEBHOOK_SECRET; delete process.env.STRIPE_WEBHOOK_SECRET;
  const nosec = await stripe.parseWebhook(req(body, sign(body, "whsec_current")), { getMerchant });
  ok(!nosec.ok && nosec.status === 500, "sin STRIPE_WEBHOOK_SECRET → falla cerrado");
  process.env.STRIPE_WEBHOOK_SECRET = saved;
}

// ── cancel / pause / resume / testCredentials ──
{
  const merchant = { stripe_account_id: "acct_1" };
  calls.length = 0;
  const c = await stripe.cancel(merchant, "sub_1");
  ok(calls[0].method === "DELETE" && calls[0].url.endsWith("/v1/subscriptions/sub_1") && calls[0].headers["Stripe-Account"] === "acct_1" && c.status === "canceled", "cancel → DELETE /subscriptions/sub_1 en la cuenta conectada");
  calls.length = 0;
  await stripe.pause(merchant, "sub_1");
  eq(decodeURIComponent(calls[0].body), "pause_collection[behavior]=void", "pause → pause_collection[behavior]=void");
  calls.length = 0;
  await stripe.resume(merchant, "sub_1");
  eq(calls[0].body, "pause_collection=", "resume → pause_collection vacío");
  let threw = false; try { await stripe.cancel({}, "sub_1"); } catch (_) { threw = true; }
  ok(threw, "cancel sin cuenta conectada → error");

  const t = await stripe.testCredentials({ stripe_account_id: "acct_1" });
  ok(t.ok && t.account.country === "US" && t.account.default_currency === "USD" && t.account.name === "Mi LLC" && t.account.charges_enabled, "testCredentials → resumen de la cuenta");
  ok(!(await stripe.testCredentials({ stripe_account_id: "acct_bad" })).ok, "testCredentials con cuenta inexistente → ok:false");
  ok(!(await stripe.testCredentials({})).ok, "testCredentials sin datos → ok:false");
}

// ── Connect ──
{
  const url = new URL(mod.connectAuthorizeUrl({ state: "st", redirectUri: "https://www.recurrentesapp.com/api/merchant?action=stripe-connect-callback", email: "a@b.com" }));
  ok(url.origin + url.pathname === "https://connect.stripe.com/oauth/authorize", "URL de autorización de Connect");
  eq([url.searchParams.get("client_id"), url.searchParams.get("scope"), url.searchParams.get("response_type"), url.searchParams.get("state"), url.searchParams.get("stripe_user[email]")], ["ca_test", "read_write", "code", "st", "a@b.com"], "params del OAuth");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
