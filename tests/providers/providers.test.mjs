// Tests de pasarelas alternativas (registro + Mobbex + cobro agnóstico + webhook + checkout).
// Firestore en memoria (mock-firebase.mjs) y fetch falso: NUNCA llama APIs reales.
//   node tests/providers/providers.test.mjs
import { register } from "node:module";
import { existsSync } from "node:fs";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.PORTAL_SECRET = "test-portal-secret";
for (const k of ["MOBBEX_ENABLED", "MOBBEX_API_KEY", "MOBBEX_TEST", "STRIPE_ENABLED", "WHOP_ENABLED", "RESEND_API_KEY", "PROVIDER_WEBHOOK_SECRET"]) delete process.env[k];

// ── fetch falso ─────────────────────────────────────────────────────
const calls = [];
const counters = { shopifyOrders: 0, mp: 0, mobbex: 0 };
let mobbexSubscriberRef = "m1:s1";
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  let body = null;
  try { body = opts.body ? JSON.parse(opts.body) : null; } catch (_) { body = opts.body; }
  calls.push({ u, method, headers: opts.headers || {}, body });
  if (u.startsWith("https://api.mobbex.com/")) {
    counters.mobbex++;
    const p = u.slice("https://api.mobbex.com/p".length);
    if (method === "GET" && p.startsWith("/subscriptions?page=0")) {
      return opts.headers?.["x-access-token"] === "good-token" ? J({ result: true, data: { docs: [] } }) : J({ result: false, error: "Unauthorized" }, 401);
    }
    if (method === "POST" && p === "/subscriptions") return J({ result: true, data: { uid: "SUB1", url: "https://mbbx.co/s/SUB1" } });
    if (method === "POST" && p === "/subscriptions/SUB1/subscriber") return J({ result: true, data: { uid: "SUBR1", reference: body?.reference, sourceUrl: "https://mobbex.com/p/subscriptions/SUB1/subscriber/SUBR1/source" } });
    if (method === "GET" && p === "/subscriptions/SUB1/subscriber/SUBR1") return J({ result: true, data: { subscriber: { uid: "SUBR1", reference: mobbexSubscriberRef, status: 1 }, subscription: { uid: "SUB1" } } });
    if (method === "GET" && p.startsWith("/subscriptions/SUB1/subscriber/")) return J({ result: false, error: "Not found" }, 404);
    if (p.startsWith("/subscriptions/SUB1/subscriber/SUBR1/action/")) return J({ result: true, data: {} });
    return J({ result: false, error: "ruta mobbex no mockeada " + method + " " + p }, 400);
  }
  if (u.includes(".myshopify.com/")) {
    if (method === "GET" && u.includes("/customers/search.json")) return J({ customers: [] });
    if (method === "POST" && u.includes("/customers.json")) return J({ customer: { id: 111 } });
    if (method === "PUT" && u.includes("/customers/")) return J({ customer: { id: 111 } });
    if (method === "GET" && u.includes("/orders.json")) return J({ orders: [] });
    if (method === "POST" && u.includes("/orders.json")) { counters.shopifyOrders++; return J({ order: { id: 5000 + counters.shopifyOrders, order_status_url: `https://tienda.myshopify.com/o/${5000 + counters.shopifyOrders}` } }); }
    return J({});
  }
  if (u.startsWith("https://api.mercadopago.com/")) {
    counters.mp++;
    if (method === "POST" && u.endsWith("/preapproval_plan")) return J({ id: "PLAN1", init_point: "https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=PLAN1" });
    return J({ message: "mp no mockeado" }, 400);
  }
  throw new Error(`fetch inesperado ${method} ${u}`);
};

const A = (p) => new URL(`../../api/${p}`, import.meta.url).href;
const { db, __reset } = await import(A("_lib/firebase.js"));
const reg = await import(A("_lib/providers/index.js"));
const mobbexMod = await import(A("_lib/providers/mobbex.js"));
const { providerWebhookToken, providerWebhookUrl, verifyProviderWebhookToken } = await import(A("_lib/providers/webhookToken.js"));
const { processProviderEvent, processProviderEvents, providerChargeId } = await import(A("_lib/charges/processProviderCharge.js"));
const { handleProviderWebhook } = await import(A("_lib/providers/webhook.js"));
const { saveMobbex, disconnectMobbex, mobbexSafeFields } = await import(A("_lib/providers/merchantActions.js"));

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const rejects = async (p, re) => { try { await p; return false; } catch (e) { return re ? re.test(String(e.message)) : true; } };
const fakeRes = () => { const r = { _s: 200, _j: null, headers: {}, status(c) { this._s = c; return this; }, json(o) { this._j = o; return this; }, setHeader(k, v) { this.headers[k] = v; }, end() { return this; } }; return r; };
const M = (id) => db().collection("merchants").doc(id);
const chargesOf = async (mid) => (await M(mid).collection("charges").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
const subOf = async (mid, sid) => (await M(mid).collection("subscribers").doc(sid).get()).data();
const quiet = async (fn) => { const w = console.warn, l = console.log, e = console.error; console.warn = console.log = console.error = () => {}; try { return await fn(); } finally { console.warn = w; console.log = l; console.error = e; } };

// ═══ 1. Registro con los flags apagados ═════════════════════════════
console.log("\n— Registro (flags apagados)");
{
  const mp = await reg.getProvider("mercadopago");
  ok(mp.id === "mercadopago" && mp.currency === "ARS" && mp.isEnabled() === true, "mercadopago: descriptor siempre prendido");
  ok(reg.missingAdapterKeys(mp).length === 0, "mercadopago cumple la interfaz completa");
  ok(await rejects(mp.createSubscriptionCheckout({}), /not used: MP path stays in checkout\/init/), "mercadopago.createSubscriptionCheckout lanza 'not used: MP path stays in checkout/init'");
  const mbx = await reg.getProvider("mobbex");
  ok(mbx && !mbx.placeholder && reg.missingAdapterKeys(mbx).length === 0, "mobbex: adapter real con todas las claves del contrato");
  ok(mbx.isEnabled() === false, "mobbex.isEnabled() = false sin MOBBEX_ENABLED");
  ok((await reg.getEnabledProvider("mobbex")) === null, "getEnabledProvider(mobbex) = null con el flag apagado");
  ok((await reg.checkoutProviderFor({})) === null, "checkoutProviderFor(merchant sin payment_provider) = null (Lumina)");
  ok((await reg.checkoutProviderFor({ payment_provider: "mobbex" })) === null, "checkoutProviderFor(payment_provider=mobbex) = null con el flag apagado");
  ok((await reg.checkoutProviderFor({ payment_provider: "mercadopago" })) === null, "checkoutProviderFor(mercadopago) = null (camino de siempre)");
  ok((await reg.getProvider("paypal")) === null, "pasarela desconocida → null");
  for (const id of ["stripe", "whop"]) {
    const a = await reg.getProvider(id);
    const installed = existsSync(new URL(`../../api/_lib/providers/${id}.js`, import.meta.url));
    ok(a && reg.missingAdapterKeys(a).length === 0, `${id}: el registro siempre devuelve un adapter con la interfaz completa`);
    if (!installed) ok(a.placeholder === true && a.isEnabled() === false && !(await a.testCredentials({})).ok, `${id}: sin archivo → placeholder apagado`);
    ok((await reg.getEnabledProvider(id)) === null, `getEnabledProvider(${id}) = null con el flag apagado`);
  }
  const list = await reg.listProviders();
  ok(list.length === 4 && list.find((p) => p.id === "mercadopago").enabled && !list.find((p) => p.id === "mobbex").enabled, "listProviders: 4 pasarelas, solo MP prendida");
  ok(reg.missingAdapterKeys({ id: "x", label: "X", currency: "ARS", isEnabled() {} }).includes("parseWebhook"), "missingAdapterKeys detecta un adapter incompleto");
  process.env.MOBBEX_ENABLED = "1";
  ok((await reg.checkoutProviderFor({ payment_provider: "mobbex" }))?.id === "mobbex", "con MOBBEX_ENABLED=1 checkoutProviderFor devuelve Mobbex");
  ok((await reg.checkoutProviderFor({})) === null, "con MOBBEX_ENABLED=1 un merchant sin campo sigue en MP");
  delete process.env.MOBBEX_ENABLED;
}

// ═══ 2. Mobbex: payload del checkout ════════════════════════════════
console.log("\n— Mobbex: crear checkout");
{
  const mbx = await reg.getProvider("mobbex");
  ok(mobbexMod.mobbexInterval(30) === "1m" && mobbexMod.mobbexInterval(7) === "7d" && mobbexMod.mobbexInterval(15) === "15d" && mobbexMod.mobbexInterval(60) === "2m" && mobbexMod.mobbexInterval(365) === "1y", "intervalos 7/15/30/60/365 → 7d/15d/1m/2m/1y");
  ok(mobbexMod.mobbexInterval(45) === null && mobbexMod.mobbexInterval(120) === null, "frecuencias sin equivalente → null");
  const merchant = { mobbex_api_key: "key-123", mobbex_access_token: "tok-456" };
  const notificationUrl = providerWebhookUrl(process.env.APP_BASE_URL, "mobbex", "m1");
  const args = {
    merchant, merchantId: "m1", subscriberId: "s1",
    sub: { quantity: 2, plan_snapshot: { product_title: "Café de especialidad" } },
    plan: { product_title: "Café" }, amount: 12345.5, currency: "ARS", frequencyDays: 30,
    backUrl: "https://www.recurrentesapp.com/#/checkout-success?sub=s1&token=abc", notificationUrl,
    customer: { email: "ana@x.com", name: "Ana Pérez", phone: "1155555555", tax_id: "30.111.222" },
  };
  calls.length = 0;
  const out = await mbx.createSubscriptionCheckout(args);
  const [c1, c2] = calls;
  ok(c1?.method === "POST" && c1.u === "https://api.mobbex.com/p/subscriptions", "1) POST /p/subscriptions");
  ok(c1?.headers["x-api-key"] === "key-123" && c1.headers["x-access-token"] === "tok-456" && c1.headers["content-type"] === "application/json", "headers x-api-key / x-access-token del merchant");
  ok(c1?.body.total === 12345.5 && c1.body.currency === "ARS" && c1.body.type === "dynamic" && c1.body.interval === "1m" && c1.body.limit === 0 && c1.body.test === false, "suscripción: total, ARS, dynamic, 1m, sin límite, test:false");
  ok(c1?.body.webhook === notificationUrl && c1.body.webhook.includes("action=provider-webhook") && c1.body.webhook.includes("p=mobbex") && c1.body.webhook.includes("mid=m1") && c1.body.webhook.includes("t="), "webhook = /api/public?action=provider-webhook&p=mobbex&mid=m1&t=<token>");
  ok(c1?.body.return_url === args.backUrl && c1.body.reference === "rec:m1:s1" && c1.body.features.includes("charge_on_first_source"), "return_url, reference rec:m1:s1 y charge_on_first_source");
  ok(c1?.body.description.includes("× 2") && c1.body.description.includes("cada 30 días"), `descripción legible ("${c1?.body.description}")`);
  ok(c2?.method === "POST" && c2.u === "https://api.mobbex.com/p/subscriptions/SUB1/subscriber", "2) POST /p/subscriptions/SUB1/subscriber");
  const exp = new Date(Date.now() + 30 * 86400000);
  ok(c2?.body.customer.identification === "30111222" && c2.body.customer.email === "ana@x.com" && c2.body.customer.name === "Ana Pérez", "suscriptor: DNI solo dígitos, email y nombre");
  ok(c2?.body.reference === "m1:s1" && c2.body.total === 12345.5 && c2.body.startDate.day === exp.getUTCDate() && c2.body.startDate.month === exp.getUTCMonth() + 1 && c2.body.startDate.year === exp.getUTCFullYear(), "suscriptor: reference m1:s1, total y startDate = hoy + frecuencia (2º cobro)");
  ok(out.checkoutUrl === "https://mobbex.com/p/subscriptions/SUB1/subscriber/SUBR1/source" && out.providerSubscriptionId === "SUB1:SUBR1" && out.providerPlanId === "SUB1", "devuelve sourceUrl + ids SUB1:SUBR1 / SUB1");
  calls.length = 0;
  await mbx.createSubscriptionCheckout({ ...args, merchant: { ...merchant, mobbex_test: true } });
  ok(calls[0]?.body.test === true && calls[1]?.body.test === true, "modo prueba del merchant → test:true en ambas llamadas");
  const e45 = await mbx.createSubscriptionCheckout({ ...args, frequencyDays: 45 }).catch((e) => e);
  ok(e45?.status === 400 && /frecuencia/.test(e45.userMessage), "frecuencia 45 días → 400 con mensaje claro");
  const eDni = await mbx.createSubscriptionCheckout({ ...args, customer: { ...args.customer, tax_id: "" } }).catch((e) => e);
  ok(eDni?.status === 400 && /DNI/.test(eDni.userMessage), "sin DNI → 400 'necesitamos tu DNI'");
  const eUsd = await mbx.createSubscriptionCheckout({ ...args, currency: "USD" }).catch((e) => e);
  ok(eUsd?.status === 400, "moneda USD → 400 (Mobbex solo ARS)");
  const eNoCreds = await mbx.createSubscriptionCheckout({ ...args, merchant: {} }).catch((e) => e);
  ok(eNoCreds?.status === 400 && /conectar Mobbex/.test(eNoCreds.userMessage), "sin credenciales → 400 'no terminó de conectar Mobbex'");
  const tc = await mbx.testCredentials({ api_key: "k", access_token: "good-token" });
  const tcBad = await mbx.testCredentials({ api_key: "k", access_token: "bad" });
  ok(tc.ok === true && tcBad.ok === false && /rechazó/.test(tcBad.error), "testCredentials: válidas → ok, inválidas → error claro");
}

// ═══ 3. Mobbex: webhook (parseo + autenticidad) ═════════════════════
console.log("\n— Mobbex: webhook");
const execBody = (code, extra = {}) => ({
  type: "subscription:execution",
  data: {
    result: true,
    payment: { id: "PAY1", status: { code: String(code), text: "x" }, total: 5000, currency: { code: "ARS" }, created: "2026-09-15T12:00:00.000Z" },
    subscription: { uid: "SUB1", reference: "rec:m1:s1" },
    subscriber: { uid: "SUBR1", reference: "m1:s1", period: 1 },
    execution: { uid: "EXE1" },
    ...extra,
  },
});
const flat = (obj, pre = "", out = {}) => { for (const [k, v] of Object.entries(obj)) { const key = pre ? `${pre}[${k}]` : k; if (v && typeof v === "object") flat(v, key, out); else out[key] = String(v); } return out; };
{
  __reset();
  await M("m1").set({ mobbex_api_key: "key-123", mobbex_access_token: "tok-456" });
  const getMerchant = async (mid) => (await M(mid).get()).data() || null;
  const mbx = await reg.getProvider("mobbex");
  const t = providerWebhookToken("mobbex", "m1");
  ok(verifyProviderWebhookToken("mobbex", "m1", t) && !verifyProviderWebhookToken("mobbex", "m2", t) && !verifyProviderWebhookToken("stripe", "m1", t), "token HMAC atado a (pasarela, merchant)");
  const bad = await mbx.parseWebhook({ query: { mid: "m1", t: "nope" }, body: execBody(200) }, { getMerchant });
  ok(bad.ok === false && bad.status === 401 && bad.events.length === 0, "token inválido → 401 sin eventos");
  const noTok = await mbx.parseWebhook({ query: { mid: "m1" }, body: execBody(200) }, { getMerchant });
  ok(noTok.ok === false && noTok.status === 401, "sin token → 401");
  calls.length = 0;
  const good = await mbx.parseWebhook({ query: { mid: "m1", t }, body: execBody(200) }, { getMerchant });
  const ev = good.events?.[0];
  ok(good.ok && good.merchantId === "m1" && ev?.type === "charge_approved", "execution 200 → charge_approved");
  ok(ev?.paymentId === "PAY1" && ev.amount === 5000 && ev.currency === "ARS" && ev.providerSubscriptionId === "SUB1:SUBR1" && ev.subscriberRef === "m1:s1" && ev.date === "2026-09-15T12:00:00.000Z", "evento normalizado: paymentId, monto, moneda, ids, ref, fecha");
  ok(calls.some((c) => c.method === "GET" && c.u === "https://api.mobbex.com/p/subscriptions/SUB1/subscriber/SUBR1"), "re-consulta el suscriptor en Mobbex con las credenciales del merchant");
  const form = await mbx.parseWebhook({ query: { mid: "m1", t }, body: flat(execBody(200)) }, { getMerchant });
  ok(form.ok && form.events[0]?.type === "charge_approved" && form.events[0].amount === 5000, "form-urlencoded ya parseado por Vercel (data[payment][id]) → mismo evento");
  const raw = new URLSearchParams(flat(execBody(200))).toString();
  const formRaw = await mbx.parseWebhook({ query: { mid: "m1", t }, body: raw }, { getMerchant });
  ok(formRaw.ok && formRaw.events[0]?.paymentId === "PAY1", "form-urlencoded crudo (string) → mismo evento");
  const rej = await mbx.parseWebhook({ query: { mid: "m1", t }, body: execBody(400) }, { getMerchant });
  ok(rej.events[0]?.type === "charge_failed", "execution 400 → charge_failed");
  const pend = await mbx.parseWebhook({ query: { mid: "m1", t }, body: execBody(2) }, { getMerchant });
  ok(pend.ok && pend.events.length === 0, "execution 2 (en proceso) → sin eventos");
  const liq = await mbx.parseWebhook({ query: { mid: "m1", t }, body: execBody(300) }, { getMerchant });
  ok(liq.ok && liq.events.length === 0, "execution 3xx (liquidación) → sin eventos");
  const testCur = execBody(200); testCur.data.payment.currency.code = "TEST";
  ok((await mbx.parseWebhook({ query: { mid: "m1", t }, body: testCur }, { getMerchant })).events[0]?.currency === "ARS", "moneda TEST (modo prueba) → ARS");
  const err = await mbx.parseWebhook({ query: { mid: "m1", t }, body: { type: "subscription:execution:error", data: execBody(0).data } }, { getMerchant });
  ok(err.events[0]?.type === "charge_failed", "subscription:execution:error → charge_failed");
  const susp = await mbx.parseWebhook({ query: { mid: "m1", t }, body: { type: "subscription:subscriber:suspended", data: { subscription: { uid: "SUB1" }, subscriber: { uid: "SUBR1", reference: "m1:s1" } } } }, { getMerchant });
  const act = await mbx.parseWebhook({ query: { mid: "m1", t }, body: { type: "subscription:subscriber:active", data: { subscription: { uid: "SUB1" }, subscriber: { uid: "SUBR1", reference: "m1:s1" } } } }, { getMerchant });
  ok(susp.events[0]?.type === "subscription_paused" && act.events[0]?.type === "subscription_resumed", "suspended → paused · active → resumed");
  const reg0 = await mbx.parseWebhook({ query: { mid: "m1", t }, body: { type: "subscription:registration", data: {} } }, { getMerchant });
  ok(reg0.ok && reg0.events.length === 0, "subscription:registration → ignorado (el cobro llega aparte)");
  mobbexSubscriberRef = "otro-merchant:s9";
  const spoof = await mbx.parseWebhook({ query: { mid: "m1", t }, body: execBody(200) }, { getMerchant });
  ok(spoof.ok === false && spoof.status === 401, "Mobbex dice que el suscriptor es de otro merchant → 401");
  mobbexSubscriberRef = "m1:s1";
  const ghost = execBody(200); ghost.data.subscriber.uid = "NOEXISTE";
  const g = await mbx.parseWebhook({ query: { mid: "m1", t }, body: ghost }, { getMerchant });
  ok(g.ok === false && g.status === 401, "suscriptor inexistente en la cuenta Mobbex → 401");
}

// ═══ 4. Cobro agnóstico: idempotencia ═══════════════════════════════
console.log("\n— processProviderCharge");
const approved = (pid, extra = {}) => ({ type: "charge_approved", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1", paymentId: pid, amount: 5000, currency: "ARS", date: "2026-09-15T12:00:00.000Z", raw: {}, ...extra });
{
  __reset();
  // Sin tienda (servicio): el cobro se cumple con el comprobante interno rec_<id>.
  const merchant = { business_type: "service", channel: "none", email: "dueno@gym.com" };
  await M("m1").set(merchant);
  const baseSub = { status: "pending", customer_email: "ana@x.com", customer_name: "Ana", payment_provider: "mobbex", provider_subscription_id: "SUB1:SUBR1", plan_snapshot: { product_title: "Pase libre", total_per_charge_ars: 5000, frequency_days: 30 }, shopify_orders: [] };
  await M("m1").collection("subscribers").doc("s1").set(baseSub);
  const r1 = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY1")));
  const r2 = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY1")));
  const ch = await chargesOf("m1");
  let s = await subOf("m1", "s1");
  ok(r1.status === "fulfilled" && r2.status === "duplicate", `mismo pago dos veces → fulfilled + duplicate (${r1.status}/${r2.status})`);
  ok(ch.length === 1 && ch[0].id === providerChargeId("mobbex", "PAY1") && ch[0].id === "mobbex_PAY1", "un solo charge: charges/mobbex_PAY1");
  ok(ch[0].shopify_order_id === "rec_mobbex_PAY1" && ch[0].provider === "mobbex" && ch[0].provider_payment_id === "PAY1" && ch[0].amount_ars === 5000 && ch[0].currency === "ARS" && ch[0].status === "approved", "charge con comprobante rec_mobbex_PAY1, pasarela, monto y estado");
  ok(s.status === "active" && s.shopify_orders.length === 1 && s.last_charge_at === "2026-09-15T12:00:00.000Z" && s.next_charge_at === "2026-10-15T12:00:00.000Z", "sub active, 1 orden, last_charge_at y next_charge_at (+30 días)");
  // Dos avisos del MISMO pago a la vez (transacciones serializadas como Firestore).
  const [a, b] = await quiet(() => Promise.all([processProviderEvent("m1", merchant, "mobbex", approved("PAY2")), processProviderEvent("m1", merchant, "mobbex", approved("PAY2"))]));
  s = await subOf("m1", "s1");
  ok([a.status, b.status].sort().join(",") === "duplicate,fulfilled" && s.shopify_orders.length === 2 && (await chargesOf("m1")).length === 2, "dos avisos simultáneos del mismo pago → una sola orden");
  // Monto distinto: se cumple igual (el cliente pagó) pero queda marcado.
  const r3 = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY3", { amount: 4000 })));
  const c3 = (await chargesOf("m1")).find((c) => c.id === "mobbex_PAY3");
  ok(r3.status === "fulfilled" && c3.amount_mismatch === true && c3.amount_expected === 5000, "monto distinto al del plan → se cumple y queda amount_mismatch");
  // Nunca toca subs de Mercado Pago.
  await M("m1").collection("subscribers").doc("mp1").set({ status: "active", customer_email: "b@x.com", mp_preapproval_id: "PRE1", shopify_orders: [] });
  const rMp = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY9", { subscriberRef: "m1:mp1", providerSubscriptionId: "ZZZ:YYY" })));
  ok(rMp.status === "no_subscriber" && !(await chargesOf("m1")).some((c) => c.id === "mobbex_PAY9"), "evento Mobbex apuntando a una sub de MP → no_subscriber, sin charge");
  // Resolución por provider_subscription_id cuando no viene reference.
  const rPs = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY4", { subscriberRef: null })));
  ok(rPs.status === "fulfilled" && rPs.subscriberId === "s1", "sin reference → resuelve por provider_subscription_id");
  // Pago rechazado de una sub recurrente → payment_failed una sola vez.
  const f1 = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "charge_failed", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1", paymentId: "PAYX", amount: 5000, currency: "ARS", date: "2026-10-15T12:00:00.000Z" }));
  const f2 = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "charge_failed", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1", paymentId: "PAYX", amount: 5000, currency: "ARS", date: "2026-10-15T12:00:00.000Z" }));
  s = await subOf("m1", "s1");
  ok(f1.status === "payment_failed" && f2.status === "ignored" && s.status === "payment_failed" && s.last_payment_failed_id === "mobbex_PAYX", "rechazo → payment_failed (dedup por id del cobro)");
  const rec = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY5")));
  ok(rec.status === "fulfilled" && (await subOf("m1", "s1")).status === "active", "cobro aprobado después del rechazo → vuelve a active");
  // Pausa / reactivación / cancelación.
  const ps = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "subscription_paused", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1" }));
  const rs = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "subscription_resumed", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1" }));
  const cn = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "subscription_cancelled", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1" }));
  const late = await quiet(() => processProviderEvent("m1", merchant, "mobbex", { type: "subscription_resumed", providerSubscriptionId: "SUB1:SUBR1", subscriberRef: "m1:s1" }));
  s = await subOf("m1", "s1");
  ok(ps.status === "paused" && rs.status === "active" && cn.status === "cancelled" && late.status === "noop" && s.status === "cancelled" && s.cancelled_by === "provider:mobbex", "pausa → reactiva → cancela; un 'resumed' tardío no revive la cancelada");
  const lateCharge = await quiet(() => processProviderEvent("m1", merchant, "mobbex", approved("PAY6")));
  ok(lateCharge.status === "fulfilled" && (await subOf("m1", "s1")).status === "cancelled", "cobro tardío sobre cancelada: se cumple (pagó) pero sigue cancelled");

  // Canal Shopify: el mismo pago dos veces crea UNA orden en Shopify.
  const m2 = { shopify_shop: "tienda.myshopify.com", shopify_token: "shpat_test" };
  await M("m2").set(m2);
  await M("m2").collection("subscribers").doc("s2").set({ status: "pending", customer_email: "c@x.com", customer_name: "Carla Gómez", customer_phone: "1155555555", payment_provider: "mobbex", provider_subscription_id: "SUB1:SUBR1", shipping_address: { address1: "Av. Siempreviva 742", city: "CABA", province: "Buenos Aires", zip: "1414" }, plan_id: "p1", plan_snapshot: { shopify_variant_id: "999", product_title: "Café", total_per_charge_ars: 5000, frequency_days: 30, shipping_price_ars: 0 }, shopify_orders: [] });
  const before = counters.shopifyOrders;
  const o1 = await quiet(() => processProviderEvent("m2", m2, "mobbex", approved("SHP1", { subscriberRef: "m2:s2" })));
  const o2 = await quiet(() => processProviderEvent("m2", m2, "mobbex", approved("SHP1", { subscriberRef: "m2:s2" })));
  const s2 = await subOf("m2", "s2");
  const orderPost = calls.filter((c) => c.method === "POST" && c.u.includes("/orders.json")).pop();
  ok(counters.shopifyOrders - before === 1 && o1.status === "fulfilled" && o2.status === "duplicate" && s2.shopify_orders.length === 1 && s2.shopify_orders[0] === o1.orderId, "Shopify: mismo pago dos veces → 1 orden");
  ok(orderPost?.body?.order?.note_attributes?.some((a) => a.name === "mp_payment_id" && a.value === "mobbex_SHP1"), "la orden Shopify lleva el id mobbex_SHP1 (dedup de shopify.js)");

  // processProviderEvents: un evento roto no frena al resto.
  const multi = await quiet(() => processProviderEvents({ providerId: "mobbex", merchantId: "m2", merchant: m2, events: [approved("SHP2", { subscriberRef: "m2:s2" }), { type: "charge_approved", subscriberRef: "m2:s2", paymentId: "", amount: 1 }] }));
  ok(multi.length === 2 && multi[0].status === "fulfilled" && multi[1].status === "ignored", "lote de eventos: cada uno aislado");
}

// ═══ 5. Webhook de punta a punta (public.js?action=provider-webhook) ═══
console.log("\n— Webhook provider-webhook");
{
  __reset();
  mobbexSubscriberRef = "m1:s1";
  const merchant = { business_type: "service", channel: "none", mobbex_api_key: "key-123", mobbex_access_token: "tok-456" };
  await M("m1").set(merchant);
  await M("m1").collection("subscribers").doc("s1").set({ status: "pending", customer_email: "ana@x.com", payment_provider: "mobbex", provider_subscription_id: "SUB1:SUBR1", plan_snapshot: { product_title: "Pase", total_per_charge_ars: 5000, frequency_days: 30 }, shopify_orders: [] });
  const t = providerWebhookToken("mobbex", "m1");
  const post = (query, body) => { const res = fakeRes(); return quiet(() => handleProviderWebhook({ method: "POST", query, body, headers: {} }, res)).then(() => res); };
  delete process.env.MOBBEX_ENABLED;
  const r1 = await post({ action: "provider-webhook", p: "mobbex", mid: "m1", t }, execBody(200));
  ok(r1._s === 200 && r1._j.processed === 1 && r1._j.results[0].status === "fulfilled", "flag APAGADO: el aviso de una sub ya creada se procesa igual (no queda un cobro sin orden)");
  const r2 = await post({ action: "provider-webhook", p: "mobbex", mid: "m1", t }, execBody(200));
  ok(r2._s === 200 && r2._j.results[0].status === "duplicate" && (await chargesOf("m1")).length === 1, "reintento de Mobbex → duplicate, sigue habiendo 1 charge");
  const r3 = await post({ action: "provider-webhook", p: "mobbex", mid: "m1", t: "falso" }, execBody(200));
  ok(r3._s === 401, "token falso → 401");
  const r4 = await post({ action: "provider-webhook", p: "mercadopago", mid: "m1", t }, execBody(200));
  ok(r4._s === 404, "p=mercadopago → 404 (MP sigue en /api/mp/webhook)");
  const r5 = await post({ action: "provider-webhook", p: "paypal", mid: "m1", t }, execBody(200));
  ok(r5._s === 404, "pasarela desconocida → 404");
  const installedStripe = existsSync(new URL("../../api/_lib/providers/stripe.js", import.meta.url));
  if (!installedStripe) ok((await post({ action: "provider-webhook", p: "stripe", mid: "m1", t }, {}))._s === 404, "stripe sin adapter instalado → 404");
  const hc = fakeRes(); await handleProviderWebhook({ method: "GET", query: { p: "mobbex" } }, hc);
  ok(hc._s === 200, "GET (healthcheck) → 200");
}

// ═══ 6. Credenciales del merchant (merchant.js ?action=save-mobbex) ═══
console.log("\n— save-mobbex / disconnect-mobbex");
{
  __reset();
  await M("m1").set({ email: "d@x.com" });
  const call = async (fn) => { const res = fakeRes(); await quiet(() => fn(res)); return res; };
  delete process.env.MOBBEX_ENABLED;
  const off = await call((res) => saveMobbex("m1", { body: { api_key: "k", access_token: "good-token" } }, res));
  ok(off._s === 400 && /no está disponible/.test(off._j.error), "flag apagado → 400 'Mobbex todavía no está disponible'");
  ok(mobbexSafeFields({}).mobbex_available === false, "GET merchant: mobbex_available=false con el flag apagado");
  process.env.MOBBEX_ENABLED = "1";
  const badc = await call((res) => saveMobbex("m1", { body: { api_key: "k", access_token: "bad" } }, res));
  ok(badc._s === 400 && /rechazó/.test(badc._j.error), "credenciales inválidas → 400 y no se guardan");
  ok(!(await M("m1").get()).data().mobbex_access_token, "…nada guardado");
  const noKey = await call((res) => saveMobbex("m1", { body: { access_token: "good-token" } }, res));
  ok(noKey._s === 400 && /API Key/.test(noKey._j.error), "sin API Key (y sin MOBBEX_API_KEY) → 400");
  const good = await call((res) => saveMobbex("m1", { body: { api_key: "k", access_token: "good-token", test: true } }, res));
  const md = (await M("m1").get()).data();
  const safe = mobbexSafeFields(md);
  ok(good._s === 200 && md.mobbex_access_token === "good-token" && md.mobbex_api_key === "k" && md.mobbex_test === true, "credenciales válidas → guardadas con modo prueba");
  ok(safe.mobbex_available && safe.mobbex_connected && safe.mobbex_test && !JSON.stringify(safe).includes("good-token") && !Object.keys(safe).some((k) => /token|api_key$/.test(k) && k !== "mobbex_platform_key"), "GET merchant: flags mobbex_connected/test, NUNCA las claves");
  process.env.MOBBEX_API_KEY = "platform-key";
  const plat = await call((res) => saveMobbex("m1", { body: { access_token: "good-token" } }, res));
  const md2 = (await M("m1").get()).data();
  ok(plat._s === 200 && !("mobbex_api_key" in md2) && mobbexSafeFields(md2).mobbex_platform_key === true && mobbexSafeFields(md2).mobbex_connected === true, "con MOBBEX_API_KEY de plataforma alcanza el Access Token");
  delete process.env.MOBBEX_API_KEY;
  delete process.env.MOBBEX_ENABLED;
  const dis = await call((res) => disconnectMobbex("m1", res));
  ok(dis._s === 200 && !mobbexSafeFields((await M("m1").get()).data()).mobbex_connected, "desvincular funciona aunque el flag esté apagado");
}

// ═══ 7. checkout/init.js: ruteo por pasarela (guardado) ═════════════
console.log("\n— checkout/init: MP intacto + Mobbex detrás del flag");
{
  __reset();
  const initMod = await import(A("checkout/init.js"));
  const handler = initMod.default;
  const plan = { active: true, item_source: "manual", product_title: "Pase libre", subscription_price_ars: 5000, frequency_days: 30, units_per_shipment: 1 };
  const service = { business_type: "service", channel: "none", email: "d@gym.com" };
  const post = async (mid, email) => {
    const res = fakeRes();
    await quiet(() => handler({ method: "POST", query: {}, headers: { "x-forwarded-for": "10.0.0." + Math.floor(Math.random() * 200) }, socket: {}, body: { merchant_id: mid, plan_id: "p1", customer: { email, name: "Ana Pérez", tax_id: "30111222" } } }, res));
    return res;
  };
  const subsOf = async (mid) => (await M(mid).collection("subscribers").get()).docs.map((d) => ({ id: d.id, ...d.data() }));

  // a) Lumina-like: sin payment_provider → Mercado Pago como siempre.
  await M("lum").set({ ...service, mp_access_token: "APP_USR-x" });
  await M("lum").collection("plans").doc("p1").set(plan);
  let mpBefore = counters.mp, mbxBefore = counters.mobbex;
  const rMp = await post("lum", "ana@x.com");
  const sMp = (await subsOf("lum"))[0];
  ok(rMp._s === 200 && rMp._j.init_point.includes("preapproval_plan_id=PLAN1") && counters.mp > mpBefore && counters.mobbex === mbxBefore, "sin payment_provider → plan MP (init_point de MP), cero llamadas a Mobbex");
  ok(sMp.mp_preapproval_plan_id === "PLAN1" && !("payment_provider" in sMp), "sub MP igual que siempre (mp_preapproval_plan_id, sin payment_provider)");

  // b) payment_provider=mobbex con el flag APAGADO → sigue por MP.
  await M("mbxoff").set({ ...service, payment_provider: "mobbex", mp_access_token: "APP_USR-x", mobbex_api_key: "k", mobbex_access_token: "t" });
  await M("mbxoff").collection("plans").doc("p1").set(plan);
  mbxBefore = counters.mobbex;
  const rOff = await post("mbxoff", "b@x.com");
  ok(rOff._s === 200 && rOff._j.init_point.includes("PLAN1") && counters.mobbex === mbxBefore, "payment_provider=mobbex + flag apagado → Mercado Pago, sin tocar Mobbex");

  // c) payment_provider=mobbex con MOBBEX_ENABLED=1 → link de Mobbex, sin tocar MP.
  process.env.MOBBEX_ENABLED = "1";
  await M("mbx").set({ ...service, payment_provider: "mobbex", mobbex_api_key: "k", mobbex_access_token: "t" });
  await M("mbx").collection("plans").doc("p1").set(plan);
  mpBefore = counters.mp;
  const rMbx = await post("mbx", "c@x.com");
  const sMbx = (await subsOf("mbx"))[0];
  ok(rMbx._s === 200 && rMbx._j.provider === "mobbex" && rMbx._j.init_point === "https://mobbex.com/p/subscriptions/SUB1/subscriber/SUBR1/source" && counters.mp === mpBefore, "MOBBEX_ENABLED=1 → init_point = sourceUrl de Mobbex, cero llamadas a MP");
  ok(sMbx.payment_provider === "mobbex" && sMbx.provider_subscription_id === "SUB1:SUBR1" && sMbx.provider_plan_id === "SUB1" && sMbx.status === "pending" && sMbx.plan_snapshot.total_per_charge_ars === 5000 && sMbx.portal_token, "sub pending con payment_provider, ids de Mobbex, total y portal_token");
  const subCall = calls.filter((c) => c.u === "https://api.mobbex.com/p/subscriptions" && c.method === "POST").pop();
  ok(subCall?.body.webhook.includes("mid=mbx") && subCall.body.return_url.includes(`sub=${sMbx.id}`) && subCall.body.total === 5000, "webhook con mid del merchant y return_url a checkout-success");

  // d) Sin DNI (servicio: opcional para MP) → Mobbex lo pide con 400 claro.
  const resNoDni = fakeRes();
  await quiet(() => handler({ method: "POST", query: {}, headers: { "x-forwarded-for": "10.9.9.9" }, socket: {}, body: { merchant_id: "mbx", plan_id: "p1", customer: { email: "d@x.com", name: "Dani" } } }, resNoDni));
  ok(resNoDni._s === 400 && /DNI/.test(resNoDni._j.error), "Mobbex sin DNI → 400 'necesitamos tu DNI o CUIT'");
  delete process.env.MOBBEX_ENABLED;
}

console.log(fails ? `\n✗ ${fails} fallaron` : "\n✓ todo OK");
process.exit(fails ? 1 : 0);
