// Entrega digital + registro de canales, con Firestore en memoria y Resend/MP falsos.
// Correr:  node tests/delivery/delivery.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Recurrentes <hola@recurrentes.app>";

// ── fetch falso: Resend (captura) y MP (crear plan). Nada sale a internet. ──
const sent = [];
let resendFail = false;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes("api.resend.com")) {
    if (resendFail) return new Response(JSON.stringify({ message: "boom" }), { status: 500 });
    sent.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ id: "em_" + sent.length }), { status: 200 });
  }
  if (u.includes("api.mercadopago.com") && u.includes("preapproval_plan")) {
    return new Response(JSON.stringify({ id: "mpplan_" + Date.now() }), { status: 201, headers: { "content-type": "application/json" } });
  }
  throw new Error("fetch inesperado " + u);
};

const R = new URL("../../", import.meta.url).href;
const { db, __reads } = await import(`${R}api/_lib/firebase.js`);
const { notifyActivation, notifyRenewal } = await import(`${R}api/_lib/sync.js`);
const { sendDigitalDelivery, deliveryKey } = await import(`${R}api/_lib/delivery.js`);
const { emailDigitalDelivery } = await import(`${R}api/_lib/email.js`);
const { normalizeDigitalDelivery, shouldDeliver, deliveryApplies } = await import(`${R}shared/platform/delivery.js`);
const { merchantProfile, CHANNELS } = await import(`${R}shared/platform/profile.js`);
const channels = await import(`${R}api/_lib/channels/index.js`);
const plansHandler = (await import(`${R}api/plans.js`)).default;

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const deliveries = () => sent.filter(s => s.tags?.some(t => t.name === "type" && t.value === "delivery"));
const logOf = async (mid, type) => (await db().collection("merchants").doc(mid).collection("email_log").get()).docs.map(d => d.data()).filter(e => !type || e.type === type);
const coll = async (mid, c) => (await db().collection("merchants").doc(mid).collection(c).get()).docs.map(d => ({ id: d.id, ...d.data() }));

// ── Datos ───────────────────────────────────────────────────────────────
const DIG = db().collection("merchants").doc("dig");
await DIG.set({ email: "ana@ebooks.com", business_type: "digital", channel: "none", mp_access_token: "APP_USR-x", store_name: "Ebooks de Ana", widget_color: "#7c3aed" });
await DIG.collection("plans").doc("p1").set({ product_title: "Club de lectura", item_source: "manual", digital_delivery: { enabled: true, url: "https://drive.google.com/club", message: "Entrás con tu mail.\n<script>x</script>", send_on: ["activation"] } });
await DIG.collection("plans").doc("p2").set({ product_title: "Curso mensual", item_source: "manual", digital_delivery: { enabled: true, url: "https://cursos.com/mes", message: "", send_on: ["activation", "renewal"] } });
await DIG.collection("plans").doc("p3").set({ product_title: "Sin entrega", item_source: "manual" });
await DIG.collection("plans").doc("p4").set({ product_title: "Apagada", item_source: "manual", digital_delivery: { enabled: false, url: "https://x.com/a", send_on: ["activation", "renewal"] } });
const subD = (planId, extra = {}) => ({ customer_email: "lector@x.com", customer_name: "Lucía Gómez", plan_id: planId, status: "active", portal_token: "tok", plan_snapshot: { product_title: "Club de lectura", frequency_days: 30 }, ...extra });

const LUM = db().collection("merchants").doc("lum");
await LUM.set({ email: "hola@lumina.com", shopify_shop: "lumina.myshopify.com", shopify_token: "shpat_x", mp_access_token: "APP_USR-y", store_name: "LuminaLabs" });
await LUM.collection("plans").doc("pl").set({ product_title: "Cápsulas", shopify_variant_id: "1", digital_delivery: { enabled: true, url: "https://x.com/no", send_on: ["activation", "renewal"] } });
const subL = { customer_email: "cliente@x.com", customer_name: "Beto", plan_id: "pl", status: "active", plan_snapshot: { product_title: "Cápsulas", shopify_variant_id: "1" } };

// ── 1) Validación compartida ─────────────────────────────────────────────
{
  const a = normalizeDigitalDelivery({ enabled: true, url: "drive.google.com/abc", send_on: ["renewal", "otra"] });
  ok(a.value?.url === "https://drive.google.com/abc" && JSON.stringify(a.value.send_on) === '["renewal"]', "agrega https:// y filtra send_on");
  ok(!!normalizeDigitalDelivery({ enabled: true, url: "javascript:alert(1)" }).error, "rechaza links javascript:");
  ok(!!normalizeDigitalDelivery({ enabled: true, url: "" }).error, "activa sin link → error");
  ok(!!normalizeDigitalDelivery({ enabled: true, url: "https://a.com", message: "x".repeat(501) }).error, "mensaje de más de 500 → error");
  ok(JSON.stringify(normalizeDigitalDelivery({ enabled: true, url: "https://a.com" }).value.send_on) === '["activation"]', "activa sin send_on → activation");
  ok(normalizeDigitalDelivery({ enabled: false, url: "" }).value.enabled === false, "apagada sin link → válida");
  ok(normalizeDigitalDelivery(null).value === null, "null → sin entrega");
  ok(shouldDeliver(normalizeDigitalDelivery({ enabled: true, url: "https://a.com", send_on: ["activation"] }).value, "renewal") === false, "shouldDeliver respeta send_on");
  ok(deliveryApplies(merchantProfile({})) === false, "Lumina (perfil histórico) no usa entrega digital");
  ok(deliveryApplies(merchantProfile({ business_type: "service" })) === true, "servicios sí");
  ok(deliveryKey("s1", { id: 123 }, "renewal") === "pay_123" && deliveryKey("s1", null, "renewal") === null, "clave de dedupe por pago");
}

// ── 2) Activación: manda UNA vez (webhook + sync + link sobre el mismo pago) ──
{
  await DIG.collection("subscribers").doc("s1").set(subD("p1"));
  const pay = { id: 111, transaction_amount: 5000 };
  await notifyActivation("dig", (await DIG.get()).data(), "s1", subD("p1"), pay, "test");
  await notifyActivation("dig", (await DIG.get()).data(), "s1", subD("p1"), pay, "test");
  const d = deliveries();
  ok(d.length === 1, `activación manda la entrega una sola vez (${d.length})`);
  const mail = d[0] || {};
  ok(/Acceder a tu contenido/.test(mail.html || "") && (mail.html || "").includes("https://drive.google.com/club"), "mail con botón 'Acceder a tu contenido' y el link");
  ok(!(mail.html || "").includes("<script>x</script>") && (mail.html || "").includes("&lt;script&gt;"), "el mensaje del comerciante va escapado");
  ok(String(mail.from || "").startsWith("Ebooks de Ana"), `remitente con la marca (${mail.from})`);
  ok(mail.subject === "Tu acceso a Club de lectura", `asunto (${mail.subject})`);
  const logs = await logOf("dig", "delivery");
  ok(logs.length === 1 && logs[0].status === "sent" && logs[0].subscriber_id === "s1", "email_log type delivery (1, sent)");
  const dv = await coll("dig", "deliveries");
  ok(dv.length === 1 && dv[0].id === "pay_111" && dv[0].status === "sent", "registro deliveries/pay_111");
  ok(sent.filter(s => s.tags?.some(t => t.name === "type" && t.value === "activation")).length === 2, "el mail de activación de siempre sigue saliendo (no se toca)");
}

// ── 3) Renovación respeta send_on ─────────────────────────────────────────
{
  const before = deliveries().length;
  await notifyRenewal("dig", (await DIG.get()).data(), "s1", subD("p1"), { id: 112 }, "test");
  ok(deliveries().length === before, "plan con send_on [activation]: la renovación NO manda");
  await DIG.collection("subscribers").doc("s2").set(subD("p2"));
  await notifyRenewal("dig", (await DIG.get()).data(), "s2", subD("p2"), { id: 222 }, "test");
  await notifyRenewal("dig", (await DIG.get()).data(), "s2", subD("p2"), { id: 222 }, "test");
  const r = deliveries().slice(before);
  ok(r.length === 1, `plan con renewal: manda una vez por pago (${r.length})`);
  ok(/de este período/.test(r[0]?.subject || ""), `asunto de renovación (${r[0]?.subject})`);
  await notifyRenewal("dig", (await DIG.get()).data(), "s2", subD("p2"), { id: 223 }, "test");
  ok(deliveries().length === before + 2, "otro pago de renovación → otra entrega");
  await notifyRenewal("dig", (await DIG.get()).data(), "s2", subD("p2"), null, "test");
  ok(deliveries().length === before + 2, "renovación sin id de pago → no manda (no se puede deduplicar)");
}

// ── 4) Sin entrega / apagada / sin mail ────────────────────────────────────
{
  const before = deliveries().length;
  const m = (await DIG.get()).data();
  const r3 = await sendDigitalDelivery("dig", m, "s3", subD("p3"), { id: 301 }, "activation");
  const r4 = await sendDigitalDelivery("dig", m, "s4", subD("p4"), { id: 401 }, "activation");
  const r5 = await sendDigitalDelivery("dig", m, "s5", subD("p1", { customer_email: "" }), { id: 501 }, "activation");
  ok(r3.skipped === "not_configured" && r4.skipped === "not_configured" && r5.skipped === "no_email" && deliveries().length === before, "plan sin entrega, apagada o sin mail → no hace nada");
}

// ── 5) Lumina (físico + Shopify): no-op total, cero lecturas ───────────────
{
  const m = (await LUM.get()).data();
  const before = deliveries().length;
  const r0 = __reads();
  const r = await sendDigitalDelivery("lum", m, "l1", subL, { id: 901 }, "activation");
  ok(r.skipped === "shipping" && __reads() === r0, "Lumina: sendDigitalDelivery no lee nada y no manda");
  await notifyRenewal("lum", m, "l1", subL, { id: 902 }, "test");
  ok(deliveries().length === before && (await coll("lum", "deliveries")).length === 0 && (await logOf("lum", "delivery")).length === 0, "Lumina: notifyRenewal sin entrega ni registros, aunque el plan tenga digital_delivery");
}

// ── 6) Nunca lanza + errores de Resend quedan logueados ────────────────────
{
  const m = (await DIG.get()).data();
  const bad = subD("p1"); Object.defineProperty(bad, "plan_id", { get() { throw new Error("boom"); } });
  let threw = false, r;
  try { r = await sendDigitalDelivery("dig", m, "s6", bad, { id: 601 }, "activation"); } catch (_) { threw = true; }
  ok(!threw && r?.error === "boom", "error interno → no lanza, devuelve { error }");
  resendFail = true;
  const r7 = await sendDigitalDelivery("dig", m, "s7", subD("p1"), { id: 701 }, "activation");
  resendFail = false;
  const l7 = (await logOf("dig", "delivery")).find(e => e.subscriber_id === "s7");
  ok(r7.status === "error" && l7?.status === "error", "Resend falla → status error en email_log, sin lanzar");
  const e = await emailDigitalDelivery({ to: "a@x.com", url: "ftp://x", merchant: m });
  ok(e.ok === false, "el template se niega a mandar un link que no sea http(s)");
}

// ── 7) api/plans.js guarda y valida digital_delivery ───────────────────────
const call = (method, { body = {}, query = {} } = {}) => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); }, end() { resolve({ status: this._s }); } };
  plansHandler({ method, body, query, headers: {} }, res).catch(e => resolve({ status: 500, error: e.message }));
});
{
  globalThis.__ctx = { merchantId: "dig", uid: "dig", email: "ana@ebooks.com" };
  const bad = await call("POST", { body: { product_title: "Plan X", base_price_ars: 1000, frequency_days: 30, digital_delivery: { enabled: true, url: "nada" } } });
  ok(bad.status === 400 && /link/i.test(bad.error || ""), `POST valida el link antes de crear el plan en MP (${bad.status} ${bad.error})`);
  const good = await call("POST", { body: { product_title: "Plan X", base_price_ars: 1000, frequency_days: 30, digital_delivery: { enabled: true, url: "cursos.com/x", message: " Hola ", send_on: ["activation", "renewal"] } } });
  ok(good.status === 200 && good.plan?.digital_delivery?.url === "https://cursos.com/x" && good.plan.digital_delivery.message === "Hola", `POST guarda la entrega normalizada (${good.status} ${good.error || ""})`);
  const patch = await call("PATCH", { query: { id: "p3" }, body: { digital_delivery: { enabled: true, url: "https://nuevo.com/a", send_on: [] } } });
  const p3 = (await DIG.collection("plans").doc("p3").get()).data();
  ok(patch.status === 200 && p3.digital_delivery?.url === "https://nuevo.com/a" && p3.digital_delivery.send_on[0] === "activation", "PATCH guarda la entrega");
  const pbad = await call("PATCH", { query: { id: "p3" }, body: { digital_delivery: { enabled: true, message: "x".repeat(600), url: "https://a.com" } } });
  ok(pbad.status === 400, "PATCH rechaza mensaje largo");
  globalThis.__ctx = { merchantId: "lum", uid: "lum", email: "hola@lumina.com" };
  const lp = await call("POST", { body: { shopify_product_id: "9", shopify_variant_id: "1", product_title: "Cápsulas", base_price_ars: 1000, frequency_days: 30, digital_delivery: { enabled: true, url: "https://x.com" } } });
  ok(lp.status === 200 && lp.plan && !("digital_delivery" in lp.plan), `Lumina: POST de plan Shopify anda (import de merchantProfile) y no guarda entrega (${lp.status} ${lp.error || ""})`);
  globalThis.__ctx = null;
}

// ── 8) Registro de canales alineado con profile.js ─────────────────────────
{
  const ids = Object.keys(CHANNELS);
  ok(ids.every(id => channels.getChannelAdapter(id)) && Object.keys(channels.CHANNEL_ADAPTERS).every(id => CHANNELS[id]), "cada canal de profile.js tiene adapter y viceversa");
  ok(ids.every(id => (CHANNELS[id].status === "available") === (channels.CHANNEL_ADAPTERS[id].stage === "live")), "status available ⇔ stage live");
  ok(ids.every(id => CHANNELS[id].orders === (channels.CHANNEL_ADAPTERS[id].fulfillment === "order" || channels.CHANNEL_ADAPTERS[id].fulfillment === "access_grant")), "orders de profile.js ⇔ fulfillment del adapter");
  ok(channels.channelAdapterFor({ shopify_token: "x" }).id === "shopify" && channels.channelAdapterFor({ business_type: "service" }).id === "none", "channelAdapterFor usa el perfil efectivo");
  ok(channels.channelFulfillsCharges("shopify") && channels.channelFulfillsCharges("none") && !channels.channelFulfillsCharges("impultienda"), "solo shopify y none cumplen cobros hoy");
  ok(channels.channelsOverview().length === ids.length, "channelsOverview lista todos");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
