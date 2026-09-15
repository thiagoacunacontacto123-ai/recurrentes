// Cobros sin orden: el reintento NUNCA duplica una orden y el aviso sale una sola vez.
// Shopify, Mercado Pago y Resend son falsos (fetch stub). Firestore en memoria.
// Uso: node tests/reliability/fulfillretry.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Recurrentes <hola@recurrentesapp.com>";
process.env.PLATFORM_ALERT_EMAIL = "alertas@recurrentesapp.com";
delete process.env.FULFILL_RETRY_ENABLED;

// ── Mundo falso ────────────────────────────────────────────────────
const SHOP = "lumina.myshopify.com";
const W = {
  customers: [], orders: [], posts: 0, mails: [],
  payments: {},               // id → payment (MP)
  onPaymentGet: null,         // hook (simula carreras)
  customerOrdersStatus: 200,  // 500 → Shopify no deja verificar
  orderPostStatus: 201,       // 422 → Shopify rechaza la orden
  resendStatus: 200,
};
let nextId = 9000;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(String(url));
  const method = (opts.method || "GET").toUpperCase();
  if (u.host === "api.resend.com") {
    if (W.resendStatus !== 200) return json({ message: "boom" }, W.resendStatus);
    W.mails.push(JSON.parse(opts.body)); return json({ id: "em_" + W.mails.length });
  }
  if (u.host === "api.mercadopago.com") {
    const m = u.pathname.match(/^\/v1\/payments\/(\w+)$/);
    if (m && method === "GET") {
      if (W.onPaymentGet) await W.onPaymentGet(m[1]);
      const p = W.payments[m[1]]; return p ? json(p) : json({ message: "not found" }, 404);
    }
    throw new Error("MP inesperado " + method + " " + u.pathname);
  }
  if (u.host === SHOP) {
    const p = u.pathname.replace(/^\/admin\/api\/[\d-]+/, "");
    if (p === "/customers/search.json") {
      const email = decodeURIComponent(u.searchParams.get("query") || "").replace(/^email:/, "");
      return json({ customers: W.customers.filter(c => c.email === email) });
    }
    let m = p.match(/^\/customers\/(\d+)\/orders\.json$/);
    if (m) {
      if (W.customerOrdersStatus !== 200) return json({ errors: "Internal Server Error" }, W.customerOrdersStatus);
      return json({ orders: W.orders.filter(o => String(o.customer_id) === m[1]) });
    }
    m = p.match(/^\/customers\/(\d+)\.json$/);
    if (m && method === "PUT") return json({ customer: W.customers.find(c => String(c.id) === m[1]) });
    if (p === "/customers.json" && method === "POST") {
      const c = { id: ++nextId, ...JSON.parse(opts.body).customer }; W.customers.push(c); return json({ customer: c }, 201);
    }
    if (p === "/orders.json" && method === "GET") return json({ orders: W.orders.slice(-50) });
    if (p === "/orders.json" && method === "POST") {
      W.posts++;
      if (W.orderPostStatus !== 201) return json({ errors: { line_items: ["variant no longer exists"] } }, W.orderPostStatus);
      const b = JSON.parse(opts.body).order;
      const o = { id: ++nextId, customer_id: b.customer.id, note_attributes: b.note_attributes, order_status_url: `https://${SHOP}/o/${nextId}` };
      W.orders.push(o); return json({ order: o }, 201);
    }
  }
  throw new Error("fetch inesperado " + method + " " + url);
};

const R = new URL("../../", import.meta.url).href;
const { db } = await import(`${R}api/_lib/firebase.js`);
const FR = await import(`${R}api/_lib/fulfillretry.js`);
const { watchMerchant, BACKOFF_MS, MAX_ATTEMPTS } = FR;

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const MIN = 60 * 1000;
const T0 = Date.now();
const iso = (t) => new Date(t).toISOString();

// Escenario aislado: merchant propio, cliente propio, pago propio.
let nScen = 0;
async function scenario({ pid, error = "Shopify POST /orders.json: {\"line_items\":[\"variant no longer exists\"]}", chargeAge = 20 * MIN, charge = {}, payment = {}, sub = {} } = {}) {
  const n = ++nScen;
  const mid = `m${n}`, sid = `s${n}`, email = `cli${n}@x.com`;
  const M = db().collection("merchants").doc(mid);
  await M.set({ email: `dueno${n}@tienda.com`, store_name: "LuminaLabs", shopify_shop: SHOP, shopify_token: "shpat_test", mp_access_token: "APP_USR-test" });
  await M.collection("subscribers").doc(sid).set({
    customer_email: email, customer_name: "Ana Pérez", status: "active", plan_id: "p1",
    plan_snapshot: { shopify_variant_id: 777, product_title: "Café", total_per_charge_ars: 10000, shipping_price_ars: 0, frequency_days: 30 },
    shipping_address: { address1: "Calle 1", city: "CABA", province: "CABA", zip: "1000" },
    shopify_orders: ["prev1"], last_charge_at: iso(T0 - 30 * 24 * 60 * MIN), ...sub,
  });
  await M.collection("charges").doc(pid).set({
    subscriber_id: sid, mp_payment_id: pid, amount_ars: 10000, status: "approved",
    shopify_order_id: null, shopify_order_status_url: null, error, created_at: iso(T0 - chargeAge), ...charge,
  });
  W.payments[pid] = { id: pid, status: "approved", transaction_amount: 10000, date_approved: iso(T0 - chargeAge), fee_details: [], ...payment };
  const cust = { id: 5000 + n, email }; W.customers.push(cust);
  const md = (await M.get()).data();
  return { mid, sid, email, M, md, cust, owner: `dueno${n}@tienda.com`, watch: (now) => watchMerchant(mid, md, { now }) };
}
const issueOf = async (s, pid) => (await s.M.collection("fulfill_issues").doc(pid).get()).data();
const chargeOf = async (s, pid) => (await s.M.collection("charges").doc(pid).get()).data();
const mailsTo = (to) => W.mails.filter(m => (m.to || []).includes(to));

// ═══ 1) Reintento APAGADO: solo aviso, una vez ═══
{
  const s = await scenario({ pid: "101" });
  const r1 = await s.watch(T0);
  ok(r1.failed_charges === 1 && r1.alerts === 0, "detecta el cobro sin orden; no avisa antes de 10 min");
  const iss = await issueOf(s, "101");
  ok(iss && iss.status === "open" && iss.first_seen_at === iso(T0), "crea fulfill_issues/{payment_id} con first_seen_at");
  // Dos corridas en paralelo a los 11 min → un solo aviso.
  const [a, b] = await Promise.all([s.watch(T0 + 11 * MIN), s.watch(T0 + 11 * MIN)]);
  ok(a.alerts + b.alerts === 1 && a.platform_alerts + b.platform_alerts === 1, "dos corridas simultáneas → 1 aviso al comerciante + 1 a la plataforma");
  await s.watch(T0 + 30 * MIN); await s.watch(T0 + 3 * 60 * MIN);
  ok(mailsTo("dueno1@tienda.com").length === 1 && mailsTo("alertas@recurrentesapp.com").length === 1, "más corridas → sigue habiendo 1 solo mail por destino (dedup por cobro)");
  const m = mailsTo("dueno1@tienda.com")[0];
  ok(/orden no se creó/.test(m.subject) && /variant no longer exists/.test(m.html) && /#\/dashboard\/cobros\?view=errors/.test(m.html), "el mail explica el motivo y linkea a Cobros con error");
  ok(!/Ana Pérez/.test(mailsTo("alertas@recurrentesapp.com")[0].html), "el aviso a la plataforma no lleva datos del cliente");
  ok(W.posts === 0, "con FULFILL_RETRY_ENABLED apagado no se crea ninguna orden");
}

process.env.FULFILL_RETRY_ENABLED = "1";

// ═══ 2) Reintento OK: exactamente 1 orden, luego nunca más ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "202" });
  await s.watch(T0);                                  // detecta (next_retry = +10 min)
  const r = await s.watch(T0 + 11 * MIN);            // reintenta
  ok(r.fixed === 1 && W.posts - before === 1, "reintento crea exactamente 1 orden");
  const ch = await chargeOf(s, "202");
  const iss = await issueOf(s, "202");
  const sub = (await s.M.collection("subscribers").doc(s.sid).get()).data();
  ok(ch.shopify_order_id && !ch.error && !ch.claim_at && ch.created_at === iso(T0 - 20 * MIN), "charge queda con orden, sin error, sin claim y conserva created_at");
  ok(iss.status === "resolved" && iss.resolved_by === "retry" && !iss.in_flight_at, "issue resuelto por el reintento (in_flight limpio)");
  ok(sub.shopify_orders.includes(ch.shopify_order_id) && sub.shopify_orders.length === 2, "la orden se suma a shopify_orders de la sub");
  const noteOk = W.orders.find(o => o.id === ch.shopify_order_id).note_attributes.some(a => a.name === "mp_payment_id" && a.value === "202");
  ok(noteOk, "la orden lleva mp_payment_id en las notas (dedup futuro)");
  for (const t of [20, 60, 600, 3000]) await s.watch(T0 + t * MIN);
  ok(W.posts - before === 1, "corridas posteriores → ninguna orden más");
  ok(mailsTo("dueno2@tienda.com").length === 0, "arreglado antes del aviso → el comerciante no recibe mail");
}

// ═══ 3) La orden YA existe en Shopify (timeout que sí la creó) → se adopta ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "303", error: "timeout 10000ms: https://lumina.myshopify.com/admin/api/2025-07/orders.json" });
  W.orders.push({ id: 7777, customer_id: s.cust.id, note_attributes: [{ name: "mp_payment_id", value: "303" }], order_status_url: "https://x/7777" });
  // Relleno: la tienda tiene muchas órdenes recientes (la búsqueda de 48h/50 no la vería).
  for (let i = 0; i < 60; i++) W.orders.push({ id: 100000 + i, customer_id: 1, note_attributes: [] });
  await s.watch(T0);
  const r = await s.watch(T0 + 11 * MIN);
  const ch = await chargeOf(s, "303");
  ok(r.fixed === 1 && W.posts === before && ch.shopify_order_id === 7777 && ch.fulfill_adopted === true, "orden existente del cliente → se ADOPTA, 0 POST");
  ok((await issueOf(s, "303")).resolved_by === "adopted", "issue resuelto como 'adopted'");
}

// ═══ 4) Otro proceso tiene el claim ahora mismo → nada ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "404", charge: { claim_at: new Date().toISOString() } });
  await s.watch(T0);
  await s.watch(T0 + 11 * MIN);
  ok(W.posts === before && !(await chargeOf(s, "404")).shopify_order_id, "claim vigente de webhook/sync → el reintento no crea nada");
}

// ═══ 5) Carrera: la sync crea la orden entre la consulta y el claim ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "505" });
  await s.watch(T0);
  W.onPaymentGet = async (id) => { if (id === "505") await s.M.collection("charges").doc("505").set({ shopify_order_id: "sync-order-1", error: null }, { merge: true }); };
  const r = await s.watch(T0 + 11 * MIN);
  W.onPaymentGet = null;
  const iss = await issueOf(s, "505");
  ok(W.posts === before && iss.status === "resolved" && iss.resolved_by === "sync" && r.fixed === 0, "la sync ganó → claimCharge lo ve y el reintento no crea otra");
}

// ═══ 6) Dos corridas de reintento en paralelo → 1 sola orden ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "606" });
  await s.watch(T0);
  await Promise.all([s.watch(T0 + 11 * MIN), s.watch(T0 + 11 * MIN), s.watch(T0 + 11 * MIN)]);
  ok(W.posts - before === 1, "3 corridas simultáneas → exactamente 1 POST de orden (transacción del claim)");
}

// ═══ 7) Intento anterior cortado a mitad (in_flight viejo) → nunca reintenta solo ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "707" });
  await s.watch(T0);
  await s.M.collection("fulfill_issues").doc("707").set({ in_flight_at: iso(T0 + 1 * MIN) }, { merge: true });
  const r = await s.watch(T0 + 11 * MIN);
  const iss = await issueOf(s, "707");
  ok(W.posts === before && iss.status === "needs_review" && r.needs_review === 1, "in_flight de hace > 5 min → needs_review, 0 POST");
  ok(mailsTo("dueno7@tienda.com").length === 1 && /revis|fijate/i.test(mailsTo("dueno7@tienda.com")[0].html), "aviso pide revisar en Shopify antes de reintentar");
  await s.watch(T0 + 5 * 60 * MIN);
  ok(W.posts === before, "sigue sin reintentar en corridas siguientes");
}

// ═══ 8) Shopify no deja verificar → no se intenta ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "808" });
  await s.watch(T0);
  W.customerOrdersStatus = 500;
  const r = await s.watch(T0 + 11 * MIN);
  W.customerOrdersStatus = 200;
  const iss = await issueOf(s, "808");
  ok(W.posts === before && iss.attempts === 1 && iss.status === "open" && /verificar/.test(iss.last_error), "sin poder verificar en Shopify → 0 POST, cuenta intento y agenda backoff");
  ok(Date.parse(iss.next_retry_at) === T0 + 11 * MIN + BACKOFF_MS[1], "backoff: el próximo intento es a los 30 min");
  const r2 = await s.watch(T0 + 12 * MIN);
  ok(W.posts === before && r2.fixed === 0, "antes del backoff no reintenta");
  const r3 = await s.watch(T0 + 42 * MIN);
  ok(r3.fixed === 1 && W.posts - before === 1, "pasado el backoff y con Shopify OK → 1 orden");
}

// ═══ 9) Período de calma y pago reembolsado ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "909", chargeAge: -5 * MIN }); // webhook/sync lo reescribió a T0+5
  await s.watch(T0);
  await s.watch(T0 + 11 * MIN);                      // reintento vencido, pero el charge tiene 6 min
  ok(W.posts === before && (await issueOf(s, "909")).attempts === 0, "charge tocado hace < 10 min → no reintenta (lo está manejando webhook/sync)");
  await s.watch(T0 + 16 * MIN);
  ok(W.posts - before === 1, "pasada la calma → reintenta (1 orden)");
  const s2 = await scenario({ pid: "910", payment: { status: "refunded" } });
  await s2.watch(T0);
  const b2 = W.posts;
  await s2.watch(T0 + 11 * MIN);
  ok(W.posts === b2 && (await issueOf(s2, "910")).status === "gave_up", "pago reembolsado en MP → no crea orden y deja de intentar");
}

// ═══ 10) Shopify rechaza siempre → máx 5 intentos, un solo aviso ═══
{
  const before = W.posts;
  W.orderPostStatus = 422;
  const s = await scenario({ pid: "1001" });
  let t = T0;
  await s.watch(t);
  for (let i = 0; i < 12; i++) { t += 13 * 60 * MIN; await s.watch(t); }
  W.orderPostStatus = 201;
  const iss = await issueOf(s, "1001");
  ok(W.posts - before === MAX_ATTEMPTS && iss.attempts === MAX_ATTEMPTS && iss.status === "gave_up", `falla siempre → exactamente ${MAX_ATTEMPTS} POST y queda gave_up`);
  ok(mailsTo(s.owner).length === 1, "un solo aviso al comerciante en todo el proceso");
  ok(!(await chargeOf(s, "1001")).claim_at, "cada intento fallido libera el claim (webhook/sync pueden seguir)");
}

// ═══ 11) Aviso: Resend falla → se reintenta el aviso, nunca se duplica ═══
{
  delete process.env.FULFILL_RETRY_ENABLED;
  const s = await scenario({ pid: "1111" });
  await s.watch(T0);
  W.resendStatus = 500;
  await s.watch(T0 + 11 * MIN);
  W.resendStatus = 200;
  ok(mailsTo(`dueno${nScen}@tienda.com`).length === 0, "Resend caído → el aviso no se marca como enviado");
  await s.watch(T0 + 20 * MIN);
  await s.watch(T0 + 40 * MIN);
  ok(mailsTo(`dueno${nScen}@tienda.com`).length === 1 && (await issueOf(s, "1111")).alert_attempts === 2, "próxima corrida lo manda; después no se repite");
  // Arreglado por fuera (panel / sync) → el issue se cierra solo.
  await s.M.collection("charges").doc("1111").set({ shopify_order_id: "manual-1", error: null }, { merge: true });
  const r = await s.watch(T0 + 60 * MIN);
  ok(r.resolved === 1 && (await issueOf(s, "1111")).status === "resolved", "charge arreglado por fuera → issue resuelto");
  process.env.FULFILL_RETRY_ENABLED = "1";
}

// ═══ 12) Lo que NO se toca ═══
{
  const before = W.posts;
  const s = await scenario({ pid: "1212", charge: { status: "rejected" } });
  const s2 = await scenario({ pid: "1213", charge: { simulated: true } });
  const s3 = await scenario({ pid: "1214", error: "El canal Tiendanube todavía no crea órdenes" });
  const r1 = await s.watch(T0); const r2 = await s2.watch(T0);
  await s3.watch(T0); await s3.watch(T0 + 11 * MIN);
  ok(r1.failed_charges === 0 && r2.failed_charges === 0, "cobros no aprobados o simulados se ignoran");
  ok(W.posts === before && (await issueOf(s3, "1214")).attempts === 0, "canal sin adapter → no se reintenta (solo aviso)");
  const off = await scenario({ pid: "1215", md: null });
  await off.M.set({ order_alerts_email: false }, { merge: true });
  const md = (await off.M.get()).data();
  await watchMerchant(off.mid, md, { now: T0 }); await watchMerchant(off.mid, md, { now: T0 + 11 * MIN });
  ok(mailsTo(`dueno${nScen}@tienda.com`).length === 0, "order_alerts_email:false → no se avisa al comerciante");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
