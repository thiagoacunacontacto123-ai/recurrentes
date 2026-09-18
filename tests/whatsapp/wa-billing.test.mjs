// Cobro del uso de WhatsApp (api/_lib/waBilling.js): ítems en la factura de Stripe por mes
// cerrado, tope de US$ 5 en el plan gratis (pausa), destrabe al activar, factura final al
// darse de baja. Firestore en memoria, Stripe y Meta falsos.  node tests/whatsapp/wa-billing.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
delete process.env.RESEND_API_KEY;
process.env.WHATSAPP_PHONE_NUMBER_ID = "1319380847922196";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAplatformTOKEN1234567890abcdef";
process.env.WHATSAPP_PRICE_USD_UTILITY = "0.012";

globalThis.fetch = async (u) => { throw new Error("fetch inesperado " + u); };
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { db } = await import(`${R}/api/_lib/firebase.js`);
const wa = await import(`${R}/api/_lib/whatsapp.js`);
const wb = await import(`${R}/api/_lib/waBilling.js`);
const { waChargeUsd } = await import(`${R}/shared/platform/pricing.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const M = (id) => db().collection("merchants").doc(id);
const mdoc = async (id) => (await M(id).get()).data() || {};
const stripeCalls = [];
const stripe = async (method, path, params) => { stripeCalls.push({ method, path, params }); return { id: `${path.includes("invoiceitems") ? "ii" : "in"}_${stripeCalls.length}` }; };
const NOW = new Date("2026-09-18T12:00:00Z");

// ── Con plan pago: meses cerrados → ítems; el mes en curso espera ──
await M("pago").set({ store_name: "Paga", whatsapp_platform_enabled: true, saas_stripe_customer_id: "cus_1", saas_stripe_subscription_id: "sub_1", wa_unbilled_usd: 1.2 });
await M("pago").collection("usage").doc("2026-07").set({ month: "2026-07", wa_sent: 40, wa_cost_usd: 0.72 });
await M("pago").collection("usage").doc("2026-08").set({ month: "2026-08", wa_sent: 10, wa_cost_usd: 0.18 });
await M("pago").collection("usage").doc("2026-09").set({ month: "2026-09", wa_sent: 17, wa_cost_usd: 0.306 });
{
  const r = await wb.billWaUsage("pago", await mdoc("pago"), stripe, { now: NOW });
  ok(r.billed === 2 && r.total_usd === 0.9, "factura julio y agosto (0,72 + 0,18), septiembre todavía no");
  const items = stripeCalls.filter(c => c.path === "/v1/invoiceitems");
  ok(items.length === 2 && items[0].params.customer === "cus_1" && items[0].params.amount === 72 && items[0].params.currency === "usd", "ítem en centavos al customer del plan");
  ok(/WhatsApp · julio 2026 · 40 mensajes/.test(items[0].params.description) && items[1].params["metadata[month]"] === "2026-08", "descripción legible + metadata del mes");
  ok(!items.some(c => JSON.stringify(c.params).includes("1.5") || /recargo|markup/i.test(JSON.stringify(c.params))), "el recargo no viaja a Stripe");
  const u7 = (await M("pago").collection("usage").doc("2026-07").get()).data();
  ok(u7.billed_at && u7.stripe_invoice_item_id === "ii_1" && u7.billing_at === undefined, "el mes queda marcado como facturado");
  const m = await mdoc("pago");
  ok(m.wa_unbilled_usd === 0.31 && m.wa_last_billed_at, "queda pendiente solo el mes en curso (0,31)");
  const r2 = await wb.billWaUsage("pago", m, stripe, { now: NOW });
  ok(r2.billed === 0 && stripeCalls.length === 2, "segunda corrida: nada nuevo, sin llamadas a Stripe");
}
// ── Baja del plan: se factura TODO ahora ──
{
  const before = stripeCalls.length;
  const r = await wb.billWaUsage("pago", await mdoc("pago"), stripe, { now: NOW, includeCurrent: true, finalizeNow: true });
  ok(r.billed === 1 && r.total_usd === 0.31, "con includeCurrent factura el mes en curso");
  const inv = stripeCalls.slice(before).find(c => c.path === "/v1/invoices");
  ok(inv && inv.params.customer === "cus_1" && inv.params.auto_advance === "true", "y emite la factura en el momento (auto_advance)");
  ok((await mdoc("pago")).wa_unbilled_usd === 0, "no queda nada pendiente");
}
// ── Sin customer: no se factura ──
{
  await M("gratis").set({ store_name: "Gratis", email: "dueno@gratis.test", whatsapp_platform_enabled: true });
  await M("gratis").collection("usage").doc("2026-08").set({ month: "2026-08", wa_sent: 5, wa_cost_usd: 0.09 });
  const before = stripeCalls.length;
  const r = await wb.billWaUsage("gratis", await mdoc("gratis"), stripe, { now: NOW });
  ok(r.skipped === "no_customer" && stripeCalls.length === before, "sin plan pago: nada a Stripe");
}
// ── Tope del plan gratis: acumula y pausa en US$ 5 ──
{
  const cost = waChargeUsd(0.012);
  const n = Math.ceil(5 / cost);
  for (let i = 0; i < n - 1; i++) await wa.recordWaUsage("gratis", "platform", { now: NOW, merchant: await mdoc("gratis") });
  let m = await mdoc("gratis");
  ok(m.wa_paused_for_billing !== true && m.wa_unbilled_usd > 4.9 && m.wa_unbilled_usd < 5, `a ${n - 1} mensajes (${m.wa_unbilled_usd.toFixed(3)}) sigue andando`);
  ok(wa.waSender(m)?.mode === "platform", "antes del tope el número manda");
  await wa.recordWaUsage("gratis", "platform", { now: NOW, merchant: m });
  m = await mdoc("gratis");
  ok(m.wa_paused_for_billing === true && m.wa_paused_at, `al mensaje ${n} llega a US$ 5 y se pausa`);
  ok(wa.waSender(m) === null, "pausado: waSender no devuelve el número de Recurrentes");
  ok(wa.waSender({ ...m, whatsapp_phone_number_id: "111", whatsapp_access_token: "EAAownTOKEN1234567890abcdef" })?.mode === "own", "con número propio sigue mandando (Meta le cobra a él)");
  // Activa un plan → se facturan los meses cerrados y se destraba.
  const before = stripeCalls.length;
  await M("gratis").set({ saas_stripe_customer_id: "cus_2" }, { merge: true });
  const r = await wb.billWaUsage("gratis", await mdoc("gratis"), stripe, { now: NOW });
  m = await mdoc("gratis");
  ok(r.billed === 0 && r.skipped === "below_minimum" && stripeCalls.length === before, "solo tarjeta y agosto son 9 centavos: por debajo del mínimo de Stripe no se factura todavía");
  ok(m.wa_paused_for_billing === undefined && wa.waSender(m)?.mode === "platform", "pero WhatsApp se destraba igual (hay tarjeta)");
  ok(m.wa_unbilled_usd > 4.9 && m.wa_unbilled_usd <= 5.1, "septiembre queda pendiente para fin de mes");
  // Fin de mes (octubre): solo tarjeta → ítems + factura propia cobrada a la tarjeta.
  const OCT = new Date("2026-10-02T12:00:00Z");
  const b2 = stripeCalls.length;
  const r2 = await wb.billWaUsage("gratis", await mdoc("gratis"), stripe, { now: OCT });
  const news = stripeCalls.slice(b2);
  ok(r2.billed === 2 && r2.total_usd > 4.9, "en octubre factura agosto + septiembre juntos");
  ok(news.filter(c => c.path === "/v1/invoiceitems").length === 2 && news.some(c => c.path === "/v1/invoices" && c.params.customer === "cus_2" && c.params.auto_advance === "true"), "sin plan: emite la factura y se cobra a la tarjeta");
  ok((await mdoc("gratis")).wa_unbilled_usd === 0, "nada pendiente");
}
// ── Con plan (suscripción): los ítems van a la factura del plan, sin factura propia ──
{
  await M("plan2").set({ store_name: "Plan", saas_stripe_customer_id: "cus_9", saas_stripe_subscription_id: "sub_9", wa_unbilled_usd: 0.2 });
  await M("plan2").collection("usage").doc("2026-08").set({ month: "2026-08", wa_sent: 2, wa_cost_usd: 0.2 });
  const b = stripeCalls.length;
  const r = await wb.billWaUsage("plan2", await mdoc("plan2"), stripe, { now: NOW });
  ok(r.billed === 1 && !stripeCalls.slice(b).some(c => c.path === "/v1/invoices"), "con suscripción no hay mínimo ni factura aparte: el ítem espera la factura del plan");
}
// ── Checkout de tarjeta (modo setup) ──
{
  const sb = await import(`${R}/api/_lib/saasBilling.js`);
  process.env.STRIPE_SAAS_SECRET_KEY = "sk_test_x";
  const seen = [];
  globalThis.fetch = async (url, opts = {}) => { seen.push({ url: String(url), body: String(opts.body || "") }); return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" }), { status: 200, headers: { "Content-Type": "application/json" } }); };
  const url = await sb.createWaCardSetup({ merchantId: "gratis", merchant: { email: "dueno@gratis.test" }, email: "dueno@gratis.test", returnOrigin: "https://www.recurrentesapp.com" });
  const body = decodeURIComponent(seen[0].body);
  ok(url.startsWith("https://checkout.stripe.com/") && seen[0].url.endsWith("/v1/checkout/sessions"), "abre un Checkout de Stripe");
  ok(/mode=setup/.test(body) && /client_reference_id=gratis/.test(body) && /tarjeta=ok/.test(body) && /customer_email=dueno@gratis.test/.test(body) && !/line_items/.test(body), "modo setup: guarda la tarjeta, sin cobrar ni plan");
  delete process.env.STRIPE_SAAS_SECRET_KEY;
}
// ── Con plan: nunca se pausa ──
{
  await M("pago").set({ wa_unbilled_usd: 40 }, { merge: true });
  const paused = await wb.checkWaFreeCap("pago", await mdoc("pago"), 40);
  ok(paused === false && (await mdoc("pago")).wa_paused_for_billing === undefined, "con plan pago el tope no aplica");
}
// ── Cron ──
{
  await M("otra").set({ store_name: "Otra", saas_stripe_customer_id: "cus_3", saas_stripe_subscription_id: "sub_3", wa_unbilled_usd: 0.5 });
  await M("otra").collection("usage").doc("2026-08").set({ month: "2026-08", wa_sent: 3, wa_cost_usd: 0.5 });
  const before = stripeCalls.length;
  const r = await wb.billAllWaUsage(stripe, { now: NOW });
  ok(r.merchants >= 1 && r.billed >= 1 && stripeCalls.slice(before).some(c => c.params.customer === "cus_3" && c.params.amount === 50), "el cron factura a las tiendas con plan y uso pendiente");
  ok(!stripeCalls.slice(before).some(c => c.params.customer === undefined), "y saltea a las que no tienen customer");
}
console.log(fails ? `\n${fails} fallas` : "\nTodo OK");
if (fails) process.exit(1);
