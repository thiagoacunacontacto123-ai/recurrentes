// Servicios falsos (con estado) montados sobre el router de fetch:
//   · Mercado Pago  (api.mercadopago.com)  — pagos, preapprovals, planes ad-hoc
//   · Shopify Admin (<tienda>.myshopify.com/admin/api/<versión>/…) — clientes, órdenes, variantes
//   · Resend        (api.resend.com/emails)
// Cada uno valida el token con el que lo llaman (como la API real) y guarda
// todo lo que recibió para que los tests asserteen el payload exacto.

const H_MP = "api.mercadopago.com";
const nowIso = () => new Date().toISOString();
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
const bearer = (call) => String(call.headers.authorization || "").replace(/^Bearer\s+/i, "");
const preIdOf = (p) => p?.preapproval_id || p?.metadata?.preapproval_id || p?.point_of_interaction?.transaction_data?.subscription_id || null;

// ─── Mercado Pago ───────────────────────────────────────────────────────────
export function createFakeMp(router) {
  const mp = {
    payments: new Map(),            // id → { ...payment, _token }
    preapprovals: new Map(),        // id → { ...preapproval, _token }
    authorizedPayments: new Map(),  // id → { ...ap, _token }
    plans: new Map(),               // preapproval_plan creados
    plansCreated: [],               // [{ token, body, id }]
    preapprovalUpdates: [],         // [{ id, token, body }]
    hiddenFromSearch: new Set(),    // ids de pago que la búsqueda de MP todavía no indexó
    nextPlan: 1,
    addPayment(p, token) { mp.payments.set(String(p.id), { ...clone(p), _token: token }); return p; },
    addPreapproval(p, token) { mp.preapprovals.set(String(p.id), { ...clone(p), _token: token }); return p; },
    addAuthorizedPayment(ap, token) { mp.authorizedPayments.set(String(ap.id), { ...clone(ap), _token: token }); return ap; },
    preapproval(id) { const p = mp.preapprovals.get(String(id)); return p && pub(p); },
  };
  const owns = (o, call) => !!o && o._token === bearer(call);
  const pub = (o) => { const { _token, ...rest } = o; return clone(rest); };
  const notFound = (what) => ({ status: 404, json: { message: `${what} not found`, error: "not_found", status: 404, cause: [] } });
  const byDate = (desc) => (a, b) => (Date.parse(a.date_created || 0) - Date.parse(b.date_created || 0)) * (desc ? -1 : 1);

  router.on("GET", H_MP, /^\/v1\/payments\/search$/, (call) => {
    const q = call.query;
    let list = [...mp.payments.values()].filter(p => owns(p, call) && !mp.hiddenFromSearch.has(String(p.id)));
    if (q.preapproval_id) list = list.filter(p => preIdOf(p) === q.preapproval_id);
    if (q.external_reference) list = list.filter(p => p.external_reference === q.external_reference);
    if (q.begin_date) list = list.filter(p => Date.parse(p.date_created) >= Date.parse(q.begin_date));
    if (q.end_date) list = list.filter(p => Date.parse(p.date_created) <= Date.parse(q.end_date));
    list.sort(byDate(q.criteria === "desc"));
    return { json: { results: list.map(pub), paging: { total: list.length, limit: 30, offset: 0 } } };
  });
  router.on("GET", H_MP, /^\/v1\/payments\/([^/]+)$/, (call, m) => {
    const p = mp.payments.get(m[1]);
    return owns(p, call) ? { json: pub(p) } : notFound("Payment");
  });
  router.on("GET", H_MP, /^\/authorized_payments\/search$/, (call) => {
    const list = [...mp.authorizedPayments.values()].filter(a => owns(a, call) && a.preapproval_id === call.query.preapproval_id);
    return { json: { results: list.map(pub), paging: { total: list.length } } };
  });
  router.on("GET", H_MP, /^\/authorized_payments\/([^/]+)$/, (call, m) => {
    const a = mp.authorizedPayments.get(m[1]);
    return owns(a, call) ? { json: pub(a) } : notFound("Authorized payment");
  });
  router.on("GET", H_MP, /^\/preapproval\/search$/, (call) => {
    const q = call.query;
    let list = [...mp.preapprovals.values()].filter(p => owns(p, call));
    if (q.preapproval_plan_id) list = list.filter(p => p.preapproval_plan_id === q.preapproval_plan_id);
    if (q.external_reference) list = list.filter(p => p.external_reference === q.external_reference);
    if (q.status) list = list.filter(p => p.status === q.status);
    return { json: { results: list.map(pub), paging: { total: list.length, limit: 20, offset: 0 } } };
  });
  router.on("GET", H_MP, /^\/preapproval\/([^/]+)$/, (call, m) => {
    const p = mp.preapprovals.get(m[1]);
    return owns(p, call) ? { json: pub(p) } : notFound("Preapproval");
  });
  router.on("PUT", H_MP, /^\/preapproval\/([^/]+)$/, (call, m) => {
    const p = mp.preapprovals.get(m[1]);
    if (!owns(p, call)) return notFound("Preapproval");
    const body = call.json || {};
    mp.preapprovalUpdates.push({ id: m[1], token: bearer(call), body: clone(body) });
    for (const [k, v] of Object.entries(body)) {
      p[k] = k === "auto_recurring" ? { ...(p.auto_recurring || {}), ...v } : clone(v);
    }
    if (body.status === "paused" || body.status === "cancelled") p.next_payment_date = body.status === "cancelled" ? null : p.next_payment_date;
    p.last_modified = nowIso();
    return { json: pub(p) };
  });
  router.on("POST", H_MP, /^\/preapproval_plan$/, (call) => {
    const id = `2c938084fake${String(mp.nextPlan++).padStart(8, "0")}`;
    const plan = { ...clone(call.json), id, status: "active", date_created: nowIso(), init_point: `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=${id}`, _token: bearer(call) };
    mp.plans.set(id, plan);
    mp.plansCreated.push({ token: bearer(call), body: clone(call.json), id });
    return { status: 201, json: pub(plan) };
  });
  router.on("PUT", H_MP, /^\/preapproval_plan\/([^/]+)$/, (call, m) => {
    const p = mp.plans.get(m[1]);
    if (!owns(p, call)) return notFound("Preapproval plan");
    Object.assign(p, clone(call.json || {}));
    return { json: pub(p) };
  });
  return mp;
}

// ─── Shopify Admin ──────────────────────────────────────────────────────────
export function createFakeShopify(router, { shop, token, variants = {}, name = "LuminaLabs", primaryHost = "www.lumina.test" }) {
  const s = {
    shop, token,
    customers: [],
    orders: [],            // órdenes "existentes" en la tienda
    orderPosts: [],        // body de cada POST /orders.json (lo que mandó Recurrentes)
    variants: { ...variants },
    searchSeesCreated: false, // si true, GET /orders.json devuelve las órdenes creadas (dedup de shopify.js)
    nextOrderId: 5550100,
    nextCustomerId: 8880100,
  };
  const P = (tail) => new RegExp(`^/admin/api/[^/]+${tail}$`);
  const unauth = { status: 401, json: { errors: "[API] Invalid API key or access token (unrecognized login or wrong password)" } };
  const authed = (call) => call.headers["x-shopify-access-token"] === token;

  router.on("GET", shop, P("/customers/search\\.json"), (call) => {
    if (!authed(call)) return unauth;
    const email = String(call.query.query || "").replace(/^email:/, "").toLowerCase();
    return { json: { customers: clone(s.customers.filter(c => String(c.email).toLowerCase().includes(email))) } };
  });
  router.on("POST", shop, P("/customers\\.json"), (call) => {
    if (!authed(call)) return unauth;
    const c = { id: s.nextCustomerId++, ...clone(call.json.customer), created_at: nowIso() };
    s.customers.push(c);
    return { status: 201, json: { customer: clone(c) } };
  });
  router.on("PUT", shop, P("/customers/(\\d+)\\.json"), (call, m) => {
    if (!authed(call)) return unauth;
    const c = s.customers.find(x => String(x.id) === m[1]);
    if (!c) return { status: 404, json: { errors: "Not Found" } };
    Object.assign(c, clone(call.json.customer));
    return { json: { customer: clone(c) } };
  });
  router.on("GET", shop, P("/orders\\.json"), (call) => {
    if (!authed(call)) return unauth;
    const min = call.query.created_at_min ? Date.parse(call.query.created_at_min) : 0;
    const list = s.searchSeesCreated ? s.orders.filter(o => Date.parse(o.created_at) >= min) : [];
    return { json: { orders: clone(list.map(o => ({ id: o.id, order_status_url: o.order_status_url, note_attributes: o.note_attributes, email: o.email }))) } };
  });
  router.on("POST", shop, P("/orders\\.json"), (call) => {
    if (!authed(call)) return unauth;
    const o = call.json?.order || {};
    s.orderPosts.push(clone(call.json));
    const bad = (o.line_items || []).filter(li => !(String(li.variant_id) in s.variants));
    if (!(o.line_items || []).length || bad.length) return { status: 422, json: { errors: { line_items: ["is invalid"] } } };
    const id = s.nextOrderId++;
    const order = { ...clone(o), id, name: `#${id - 5550000}`, created_at: nowIso(), order_status_url: `https://${shop}/68000000/orders/tok${id}/authenticate?key=k${id}` };
    s.orders.push(order);
    return { status: 201, json: { order: clone(order) } };
  });
  router.on("GET", shop, P("/variants/(\\d+)\\.json"), (call, m) => {
    if (!authed(call)) return unauth;
    if (!(m[1] in s.variants)) return { status: 404, json: { errors: "Not Found" } };
    return { json: { variant: { id: Number(m[1]), price: Number(s.variants[m[1]]).toFixed(2) } } };
  });
  router.on("GET", shop, P("/shop\\.json"), (call) => {
    if (!authed(call)) return unauth;
    return { json: { shop: { name, email: "hola@lumina.test", customer_email: "hola@lumina.test", currency: "ARS", country_code: "AR", money_format: "${{amount}}", iana_timezone: "America/Argentina/Buenos_Aires", domain: primaryHost, myshopify_domain: shop, primary_domain: { host: primaryHost, ssl_enabled: true }, phone: "" } } };
  });
  return s;
}

// ─── Resend ─────────────────────────────────────────────────────────────────
export function createFakeResend(router) {
  const r = {
    sent: [],
    byType(type) { return r.sent.filter(e => (e.tags || []).some(t => t.name === "type" && t.value === type)); },
  };
  router.on("POST", "api.resend.com", /^\/emails$/, (call) => {
    if (bearer(call) !== process.env.RESEND_API_KEY) return { status: 401, json: { name: "validation_error", message: "API key is invalid" } };
    r.sent.push(clone(call.json));
    return { json: { id: `re_fake_${r.sent.length}` } };
  });
  return r;
}
