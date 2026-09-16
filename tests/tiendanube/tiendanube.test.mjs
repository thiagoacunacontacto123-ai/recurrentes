// Canal Tiendanube de punta a punta con Firestore en memoria y fetch falso (cero APIs reales).
// Correr: node tests/tiendanube/tiendanube.test.mjs
import { register } from "node:module";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.TIENDANUBE_APP_ID = "1234";
process.env.TIENDANUBE_CLIENT_SECRET = "tn_secret_test";
process.env.TIENDANUBE_CONTACT_EMAIL = "hola@recurrentesapp.com";
process.env.TIENDANUBE_SCRIPT_ID = "777";
process.env.PORTAL_SECRET = "test-signing-secret";
delete process.env.RESEND_API_KEY;
delete process.env.TIENDANUBE_API_VERSION;

// ─── fetch falso: registra cada llamada y responde por ruta ──────────────────
const calls = [];
let routes = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = opts.method || "GET";
  calls.push({ url: u, method, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  const r = routes.find(x => x.method === method && x.re.test(u));
  if (!r) throw new Error(`fetch inesperado ${method} ${u}`);
  const { status = 200, body = {} } = typeof r.reply === "function" ? r.reply(u, opts) : r.reply;
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
};
const route = (method, re, reply) => ({ method, re, reply });
const callsTo = (method, re) => calls.filter(c => c.method === method && re.test(c.url));

const ROOT = new URL("../../", import.meta.url).href;
const { db } = await import(ROOT + "api/_lib/firebase.js");
const tn = await import(ROOT + "api/_lib/tiendanube.js");
const { fulfillCharge, linkPaymentToSubscriber } = await import(ROOT + "api/_lib/sync.js");
const shopifyHandler = (await import(ROOT + "api/shopify.js")).default;
const { connectStore } = await import(ROOT + "api/_lib/tiendanubeApi.js");
const { signToken } = await import(ROOT + "api/_lib/token.js");
const { merchantProfile, channelAvailable, validateProfilePatch } = await import(ROOT + "shared/platform/profile.js");

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const section = (t) => console.log(`\n── ${t}`);

// req/res mínimos estilo Vercel. `raw` → req es un stream (para el HMAC de webhooks).
function call(handler, { method = "GET", query = {}, headers = {}, body, raw, ctx, url = "/api/shopify" } = {}) {
  return new Promise((resolve) => {
    const res = {
      _s: 200, _h: {},
      status(c) { this._s = c; return this; },
      setHeader(k, v) { this._h[k.toLowerCase()] = v; },
      json(o) { resolve({ status: this._s, json: o, headers: this._h }); },
      send(t) { resolve({ status: this._s, text: String(t), headers: this._h }); },
      writeHead(c, h = {}) { this._s = c; for (const [k, v] of Object.entries(h)) this._h[k.toLowerCase()] = v; },
      end() { resolve({ status: this._s, headers: this._h }); },
    };
    const req = raw != null ? new EventEmitter() : {};
    Object.assign(req, { method, query, headers, url, __ctx: ctx });
    if (body !== undefined) req.body = body;
    if (raw != null) setTimeout(() => { req.emit("data", Buffer.from(raw)); req.emit("end"); }, 0);
    handler(req, res);
  });
}
const M = (id) => db().collection("merchants").doc(id);
const data = async (ref) => (await ref.get()).data();

// ═══ 1) Perfil: el canal se habilita con la app de Partner ════════════════════
section("perfil / canal");
{
  ok(channelAvailable("tiendanube", {}) === true, "con TIENDANUBE_APP_ID en el backend, Tiendanube se puede elegir");
  const p = merchantProfile({ channel: "tiendanube", tiendanube_token: "x", mp_access_token: "y" });
  ok(p.channel === "tiendanube" && p.connected.channel && p.ready, "canal tiendanube + token = conectado y listo");
  ok(p.caps.orders && p.caps.catalog && p.caps.widget && p.caps.shipping && !p.caps.packs, "caps: órdenes, catálogo, widget y envío (sin packs por ahora)");
  ok(!!validateProfilePatch({}, { channel: "tiendanube" }).value, "save-settings acepta channel=tiendanube");
  const lumina = merchantProfile({ shopify_token: "t", mp_access_token: "m" });
  ok(lumina.channel === "shopify" && lumina.caps.packs === true && lumina.ready, "Lumina (histórico) sigue igual: Shopify + packs");
  const saved = process.env.TIENDANUBE_APP_ID; delete process.env.TIENDANUBE_APP_ID;
  ok(!!validateProfilePatch({}, { channel: "tiendanube" }).error, "sin la app de Partner, Tiendanube sigue 'Próximamente'");
  ok(channelAvailable("tiendanube", { tiendanube_enabled: true }), "el panel la habilita con el flag tiendanube_enabled del GET");
  ok(channelAvailable("tiendanube", { tiendanube_token: "•••••" }), "…o si la cuenta ya la tiene conectada");
  process.env.TIENDANUBE_APP_ID = saved;
}

// ═══ 2) Payload de la orden a partir de un suscriptor de ejemplo ═════════════
section("payload de la orden");
const SUB = {
  customer_email: "Ana@Example.com", customer_name: "Ana María Pérez", customer_phone: "11 5555-1234",
  customer_tax_id: "30111222", customer_tax_id_kind: "DNI",
  shipping_address: { address1: "Av. Corrientes 1234 piso 3 dto B", address2: "timbre 2", city: "CABA", province: "Buenos Aires", zip: "1043", country: "Argentina", first_name: "Ana", last_name: "María Pérez", phone: "11 5555-1234" },
  plan_id: "plan1", quantity: 3, status: "pending", mp_preapproval_plan_id: "pp1",
  plan_snapshot: { shopify_variant_id: "555", shopify_product_id: "111", item_source: "tiendanube", units_per_shipment: 3, shipping_price_ars: 1500, shipping_method_name: "Andreani a domicilio", total_per_charge_ars: 31501, product_title: "Café 1kg" },
};
{
  const params = { variant_id: "555", quantity: 3, total_price: 31501, shipping_price: 1500, shipping_method_name: "Andreani a domicilio", subscriber_id: "s1", plan_id: "plan1", charge_number: 2, mp_payment_id: "PAY1", mp_fee_real: 1234.567, tax_id: "30111222", tax_id_kind: "DNI" };
  const p = tn.buildTiendanubeOrderPayload(SUB, params);
  const itemsSum = p.products.reduce((s, x) => s + x.price * x.quantity, 0);
  ok(p.payment_status === "paid" && p.gateway === "offline", "orden PAGA (gateway offline: el cobro fue por Mercado Pago)");
  ok(Math.abs(itemsSum + p.shipping_cost_customer - 31501) < 0.001 && p.total === 31501, `ítems + envío = lo que cobró MP (${itemsSum.toFixed(2)} + ${p.shipping_cost_customer})`);
  ok(p.products.length === 2 && p.products[0].quantity === 1 && p.products[1].quantity === 2 && p.products.every(x => x.variant_id === 555), "centavos al primer ítem (qty 1 + qty 2), variante numérica");
  ok(p.customer.email === "ana@example.com" && p.customer.name === "Ana María Pérez" && p.customer.document === "30111222", "cliente: mail normalizado, nombre y DNI en document");
  const a = p.shipping_address;
  ok(a.address === "Av. Corrientes" && a.number === "1234" && a.floor === "piso 3 dto B · timbre 2", `calle/número/piso separados ("${a.address}" / "${a.number}" / "${a.floor}")`);
  ok(a.city === "CABA" && a.province === "Buenos Aires" && a.zipcode === "1043" && a.country === "AR" && a.first_name === "Ana", "resto de la dirección + país AR");
  ok(JSON.stringify(p.billing_address) === JSON.stringify(a), "facturación = envío (como Shopify)");
  ok(p.shipping_pickup_type === "ship" && p.shipping_option === "Andreani a domicilio" && p.shipping_cost_customer === 1500, "envío: método del plan y costo al cliente");
  ok(p.owner_note.startsWith("RECURRENTE") && p.owner_note.includes("mp_payment_id=PAY1") && p.owner_note.includes("Cobro #2") && p.owner_note.includes("DNI: 30111222"), "owner_note: tag RECURRENTE + cobro + pago MP + DNI");
  ok(p.extra.mp_payment_id === "PAY1" && p.extra.recurrentes_subscriber_id === "s1" && p.extra.mp_fee_real === "1234.57" && p.extra.tags === "RECURRENTE", "extra: trazabilidad (sub, pago, comisión real)");
  ok(p.send_confirmation_email === true && p.send_fulfillment_email === true && p.inventory_behaviour === "claim" && p.currency === "ARS", "mails de la tienda, descuenta stock, ARS");
  const sim = tn.buildTiendanubeOrderPayload(SUB, { ...params, simulated: true });
  ok(sim.payment_status === "pending" && sim.owner_note.includes("SIMULADA") && !sim.send_confirmation_email, "simulada: pendiente, tag SIMULADA y sin mails");
  const noAddr = tn.buildTiendanubeOrderPayload({ ...SUB, shipping_address: null }, params);
  ok(noAddr.owner_note.startsWith("RECURRENTE · FALTA-DIRECCION") && noAddr.shipping_pickup_type === "pickup", "sin dirección: igual se crea, con FALTA-DIRECCION");
  let threw = false; try { tn.buildTiendanubeOrderPayload(SUB, { ...params, total_price: 1500 }); } catch (_) { threw = true; }
  ok(threw, "total que no cubre los ítems → no se crea (mismo guard que Shopify)");
  ok(tn.splitStreetNumber("Calle 13 1234").number === "1234" && tn.splitStreetNumber("Sin número").number === "S/N", "número de calle: último número; sin número → S/N");
}

// ═══ 3) Webhooks: HMAC + tópicos ═════════════════════════════════════════════
section("webhooks + HMAC");
{
  const SECRET = process.env.TIENDANUBE_CLIENT_SECRET;
  const raw = JSON.stringify({ store_id: 9001, event: "app/uninstalled" });
  const hex = crypto.createHmac("sha256", SECRET).update(raw).digest("hex");
  ok(tn.tnVerifyWebhook(Buffer.from(raw), hex), "firma hex válida (como el ejemplo PHP de la doc)");
  ok(tn.tnVerifyWebhook(Buffer.from(raw), crypto.createHmac("sha256", SECRET).update(raw).digest("base64")), "firma base64 también aceptada");
  ok(!tn.tnVerifyWebhook(Buffer.from(raw + " "), hex), "body alterado → inválida");
  ok(!tn.tnVerifyWebhook(Buffer.from(raw), crypto.createHmac("sha256", "otro").update(raw).digest("hex")), "otro secret → inválida");
  ok(!tn.tnVerifyWebhook(Buffer.from(raw), ""), "sin header → inválida");

  await M("m_hook").set({ email: "d@x.com", tiendanube_store_id: "9001", tiendanube_token: "tok_old", channel: "tiendanube" });
  await M("m_hook").collection("subscribers").doc("sA").set({ customer_email: "ana@example.com", customer_name: "Ana", customer_phone: "11", shipping_address: { address1: "x" }, status: "active" });
  await M("m_hook").collection("charges").doc("c1").set({ subscriber_id: "sA", customer_email: "ana@example.com" });
  const sign = (body) => ({ "x-linkedstore-hmac-sha256": crypto.createHmac("sha256", SECRET).update(body).digest("hex") });

  const bad = await call(shopifyHandler, { method: "POST", query: { action: "tn-webhooks" }, raw, headers: { "x-linkedstore-hmac-sha256": "deadbeef" } });
  ok(bad.status === 401 && (await data(M("m_hook"))).tiendanube_token === "tok_old", "firma inválida → 401 y no toca nada");

  const redact = JSON.stringify({ store_id: 9001, customer: { id: 1, email: "ANA@example.com", phone: "11" }, orders_to_redact: [213] });
  const r1 = await call(shopifyHandler, { method: "POST", query: { action: "tn-webhooks", topic: "customers-redact" }, raw: redact, headers: sign(redact) });
  const sA = await data(M("m_hook").collection("subscribers").doc("sA"));
  ok(r1.status === 200 && sA.customer_email.startsWith("redacted+") && sA.customer_name === null && sA.shipping_address === null, "customers/redact → suscriptor anonimizado");
  ok((await data(M("m_hook").collection("charges").doc("c1"))).customer_email.startsWith("redacted+"), "…y sus cobros también");

  const dreq = JSON.stringify({ store_id: 9001, customer: { id: 1, email: "b@x.com" }, orders_requested: [1], checkouts_requested: [], data_request: { id: 456 } });
  await call(shopifyHandler, { method: "POST", query: { action: "tn-webhooks" }, raw: dreq, headers: sign(dreq) });
  const gd = (await M("m_hook").collection("gdpr_requests").get()).docs.map(d => d.data());
  ok(gd.some(g => g.topic === "customers/data_request" && g.data_request_id === 456 && g.status === "pending"), "customers/data_request (tópico inferido del payload) → pedido pendiente");

  const r3 = await call(shopifyHandler, { method: "POST", query: { action: "tn-webhooks" }, raw, headers: sign(raw) });
  const mh = await data(M("m_hook"));
  ok(r3.status === 200 && !mh.tiendanube_token && mh.tiendanube_uninstalled_at, "app/uninstalled → se borra el token");

  const sred = JSON.stringify({ store_id: 9001 });
  await call(shopifyHandler, { method: "POST", query: { action: "tn-webhooks", topic: "store-redact" }, raw: sred, headers: sign(sred) });
  ok(!!(await data(M("m_hook"))).tiendanube_redacted_at, "store/redact → datos de la tienda borrados");
  const viaPath = await call(shopifyHandler, { method: "POST", query: {}, url: "/api/tiendanube/webhooks", raw: sred, headers: sign(sred) });
  ok(viaPath.status === 200, "también responde en /api/tiendanube/webhooks (rewrite)");
}

// ═══ 4) OAuth: start + callback ══════════════════════════════════════════════
section("OAuth");
const owner = (mid) => ({ uid: mid, merchantId: mid, role: "owner", email: "d@x.com" });
function tnStoreRoutes(storeId, token) {
  return [
    route("POST", /tiendanube\.com\/apps\/authorize\/token$/, { body: { access_token: token, token_type: "bearer", scope: "read_products,write_orders,write_scripts", user_id: Number(storeId) } }),
    route("GET", new RegExp(`/2025-03/${storeId}/store$`), { body: { id: Number(storeId), name: { es: "Café del Sur", pt: "Café do Sul" }, email: "dueno@cafe.com", original_domain: "cafedelsur.mitiendanube.com", domains: ["www.cafedelsur.com.ar"], main_currency: "ARS", country: "AR" } }),
    route("GET", new RegExp(`/2025-03/${storeId}/webhooks$`), { body: [] }),
    route("POST", new RegExp(`/2025-03/${storeId}/webhooks$`), { status: 201, body: { id: 1, event: "app/uninstalled" } }),
    route("GET", new RegExp(`/2025-03/${storeId}/scripts$`), { body: { result: [], total: 0 } }),
    route("POST", new RegExp(`/2025-03/${storeId}/scripts$`), { status: 201, body: { id: 777, params: {} } }),
  ];
}
{
  await M("m_new").set({ email: "dueno@cafe.com" });
  const st = await call(shopifyHandler, { query: { action: "tn-oauth-start", store_url: "https://cafedelsur.mitiendanube.com/admin" }, ctx: owner("m_new") });
  const url = new URL(st.json.url);
  ok(st.status === 200 && url.host === "cafedelsur.mitiendanube.com" && url.pathname === "/admin/apps/1234/authorize", `oauth-start → admin de la tienda (${url.origin}${url.pathname})`);
  ok(!!url.searchParams.get("state") && /tn_oauth_state=/.test(st.headers["set-cookie"] || ""), "state firmado + cookie de respaldo");
  const glob = await call(shopifyHandler, { query: { action: "tn-oauth-start", store_url: "www.cafedelsur.com.ar" }, ctx: owner("m_new") });
  ok(glob.json.url.startsWith("https://www.tiendanube.com/apps/1234/authorize?state="), "dominio propio → URL global de autorización");
  const member = await call(shopifyHandler, { query: { action: "tn-oauth-start" }, ctx: { uid: "u2", merchantId: "m_new", role: "member" } });
  ok(member.status === 403, "un miembro del equipo no puede conectar");

  routes = tnStoreRoutes("9002", "tok_abc");
  calls.length = 0;
  const state = url.searchParams.get("state");
  const cb = await call(shopifyHandler, { query: { action: "tn-callback", code: "code123", state }, headers: { cookie: `tn_oauth_state=${encodeURIComponent(state)}` } });
  ok(cb.status === 302 && cb.headers.location === "https://www.recurrentesapp.com/#/config/integraciones?tiendanube=ok", "callback → vuelve a Integraciones con ?tiendanube=ok");
  const tokCall = callsTo("POST", /authorize\/token$/)[0];
  ok(tokCall?.body?.grant_type === "authorization_code" && tokCall.body.code === "code123" && tokCall.body.client_id === "1234" && tokCall.body.client_secret === "tn_secret_test", "canje del code con client_id/secret/grant_type");
  const m = await data(M("m_new"));
  ok(m.tiendanube_token === "tok_abc" && m.tiendanube_store_id === "9002" && m.tiendanube_store_name === "Café del Sur", "token + store_id + nombre de la tienda guardados");
  ok(m.tiendanube_store_url === "https://www.cafedelsur.com.ar" && m.store_name === "Café del Sur", "URL de la tienda (dominio propio) y store_name si estaba vacío");
  ok(m.channel === "tiendanube", "cuenta nueva sin Shopify → el canal pasa a Tiendanube");
  const api = callsTo("GET", /\/2025-03\/9002\/store$/)[0];
  ok(api?.headers?.Authorization === "Bearer tok_abc" && api.headers["User-Agent"] === "Recurrentes (hola@recurrentesapp.com)", "API: Authorization Bearer + User-Agent con mail de contacto");
  const hook = callsTo("POST", /\/9002\/webhooks$/)[0];
  ok(hook?.body?.event === "app/uninstalled" && hook.body.url === "https://www.recurrentesapp.com/api/tiendanube/webhooks", "registra el webhook app/uninstalled");
  const scr = callsTo("POST", /\/9002\/scripts$/)[0];
  ok(scr?.body?.script_id === 777 && JSON.parse(scr.body.query_params).merchant === "m_new" && !!m.tiendanube_script_installed_at, "instala el script del widget con merchant=<cuenta>");

  // Lumina-like: con Shopify conectado, el callback de Tiendanube NO conecta nada
  // (una tienda a la vez, decisión de Thiago 2026-09-15) y vuelve al panel con el motivo.
  await M("m_shop").set({ email: "l@x.com", shopify_token: "shpat_x", shopify_shop: "l.myshopify.com" });
  routes = tnStoreRoutes("9003", "tok_def");
  const s2 = signToken({ uid: "m_shop", mid: "m_shop", tn: 1 }, 600);
  const back = await call(shopifyHandler, { query: { action: "tn-callback", code: "c2", state: s2 } });
  const ms = await data(M("m_shop"));
  ok(!ms.tiendanube_token && !ms.channel && ms.shopify_token === "shpat_x", "con Shopify conectado el callback de Tiendanube no conecta nada y no toca Shopify");
  ok(back.status === 302 && /Desvincul/.test(decodeURIComponent(String(back.headers?.location || ""))), "vuelve al panel avisando que hay que desvincular Shopify");

  calls.length = 0;
  const bad = await call(shopifyHandler, { query: { action: "tn-callback", code: "c3", state: state.slice(0, -3) + "xyz" } });
  ok(bad.status === 302 && /tiendanube=error/.test(bad.headers.location) && callsTo("POST", /authorize\/token$/).length === 0, "state adulterado → error, sin canjear el code");
  const other = signToken({ uid: "m_new", mid: "m_new" }, 600); // token válido pero no de Tiendanube
  const bad2 = await call(shopifyHandler, { query: { action: "tn-callback", code: "c3", state: other } });
  ok(/tiendanube=error/.test(bad2.headers.location), "state firmado de otro flujo (sin tn) → rechazado");

  // Instalación desde la tienda de apps (sin state): queda pendiente y la reclama la cuenta logueada.
  routes = tnStoreRoutes("9004", "tok_app");
  const inst = await call(shopifyHandler, { query: { action: "tn-callback", code: "c4" } });
  const claim = new URLSearchParams(inst.headers.location.split("?")[1]).get("tn_claim");
  ok(inst.status === 302 && !!claim && (await db().collection("tiendanube_installs").doc("9004").get()).exists, "sin state → instalación pendiente + ?tn_claim=");
  await M("m_claim").set({ email: "c@x.com" });
  const cl = await call(shopifyHandler, { method: "POST", query: { action: "tn-claim" }, body: { claim }, ctx: owner("m_claim") });
  const mc = await data(M("m_claim"));
  ok(cl.status === 200 && mc.tiendanube_token === "tok_app" && mc.tiendanube_store_id === "9004" && !(await db().collection("tiendanube_installs").doc("9004").get()).exists, "tn-claim → la cuenta queda conectada y se borra la pendiente");
}

// ═══ 5) Productos ════════════════════════════════════════════════════════════
section("productos");
{
  routes = [route("GET", /\/2025-03\/9002\/products\?/, { body: [
    { id: 11, name: { es: "Café 1kg", pt: "Café 1kg" }, handle: { es: "cafe-1kg" }, published: true, images: [{ src: "https://img/cafe.jpg" }],
      variants: [{ id: 555, price: "12000.00", promotional_price: "10500.00", sku: "CAF1", stock: 20, values: [{ es: "Molido" }] }, { id: 556, price: "12000.00", promotional_price: null, stock: null, values: [{ es: "En grano" }] }] },
    { id: 12, name: { es: "Taza" }, handle: { es: "taza" }, published: false, images: [], variants: [{ id: 600, price: "5000", values: [] }] },
  ] })];
  const r = await call(shopifyHandler, { query: { action: "tn-products", fresh: "1" }, ctx: owner("m_new") });
  const [p1, p2] = r.json.products || [];
  ok(r.status === 200 && p1.title === "Café 1kg" && p1.image === "https://img/cafe.jpg" && p1.handle === "cafe-1kg", "producto: nombre/handle en español + imagen");
  ok(p1.variants[0].id === "555" && p1.variants[0].title === "Molido" && p1.variants[0].price === 10500 && p1.variants[0].inventory_quantity === 20, "variante: id, atributos, precio promocional vigente, stock");
  ok(p1.variants[1].price === 12000 && p2.variants[0].title === "Default Title" && p2.status === "draft", "sin promo → precio de lista; sin atributos → Default Title; no publicado → draft");
  const noTn = await call(shopifyHandler, { query: { action: "tn-products" }, ctx: owner("m_hook") });
  ok(noTn.status === 400, "sin Tiendanube conectada → 400 claro");
}

// ═══ 6) fulfillCharge rama tiendanube + idempotencia ═════════════════════════
section("fulfillCharge tiendanube + idempotencia");
{
  await M("m_tn").set({ email: "d@x.com", channel: "tiendanube", tiendanube_store_id: "9100", tiendanube_token: "tok_ful", mp_access_token: "APP_USR-test" });
  await M("m_tn").collection("subscribers").doc("s1").set({ ...SUB });
  let posted = 0;
  let existing = [];
  routes = [
    route("GET", /api\.mercadopago\.com\/v1\/payments\/111$/, { body: { id: 111, status: "approved", transaction_amount: 31501, currency_id: "ARS", preapproval_id: "pre1", date_approved: "2026-09-15T12:00:00.000-03:00", date_created: "2026-09-15T12:00:00.000-03:00", fee_details: [{ amount: 1200, fee_payer: "collector" }] } }),
    route("GET", /api\.mercadopago\.com\/preapproval\/pre1$/, { body: { id: "pre1", preapproval_plan_id: "pp1", status: "authorized", next_payment_date: "2026-10-15T12:00:00.000-03:00" } }),
    route("GET", /\/2025-03\/9100\/orders\?/, () => ({ body: existing })),
    route("POST", /\/2025-03\/9100\/orders$/, () => { posted++; return { status: 201, body: { id: 5550 + posted, number: 100 + posted } }; }),
  ];
  const l1 = await linkPaymentToSubscriber("m_tn", "s1", "111");
  const s1 = await data(M("m_tn").collection("subscribers").doc("s1"));
  const ch = await data(M("m_tn").collection("charges").doc("111"));
  ok(l1.status === "linked" && l1.shopify_order_id === 5551 && !l1.shopify_error, "cobro aprobado → orden Tiendanube creada (#5551)");
  ok(ch.shopify_order_id === 5551 && ch.mp_payment_id === "111" && ch.error === null, "charge guardado con el id de la orden (mismo campo que Shopify)");
  ok(s1.status === "active" && s1.shopify_orders.includes(5551) && !!s1.last_charge_at && s1.mp_preapproval_id === "pre1", "sub activa, orden en shopify_orders[], last_charge_at");
  const postBody = callsTo("POST", /\/9100\/orders$/)[0].body;
  ok(postBody.payment_status === "paid" && postBody.extra.mp_payment_id === "111" && postBody.extra.mp_fee_real === "1200" && postBody.products[0].variant_id === 555, "la orden lleva pago MP, comisión real y la variante del plan");
  const l2 = await linkPaymentToSubscriber("m_tn", "s1", "111");
  ok(l2.status === "already_linked" && l2.shopify_order_id === 5551 && posted === 1, "mismo pago otra vez → already_linked, NO se crea otra orden");

  // Dedup en la tienda: la función murió después del POST y antes de guardar el charge.
  existing = [{ id: 5551, number: 101, owner_note: "RECURRENTE\n…", extra: { mp_payment_id: "222" } }];
  const f1 = await fulfillCharge(await data(M("m_tn")), "s1", SUB, { payment_id: 222, total_price: 31501, charge_number: 2 }, "test");
  ok(f1.shopifyOrderId === 5551 && posted === 1, "orden previa con el mismo mp_payment_id en Tiendanube → se reutiliza");
  existing = [];

  // Sin stock: reintenta sin reservar stock (la orden tiene que existir).
  let n422 = 0;
  routes.splice(3, 1, route("POST", /\/2025-03\/9100\/orders$/, (u, o) => {
    const b = JSON.parse(o.body);
    if (b.inventory_behaviour === "claim") { n422++; return { status: 422, body: { code: 422, message: "Unprocessable Entity", description: "Sin stock suficiente para la variante 555" } }; }
    posted++; return { status: 201, body: { id: 7000, number: 200 } };
  }));
  const f2 = await fulfillCharge(await data(M("m_tn")), "s1", SUB, { payment_id: 333, total_price: 31501, charge_number: 3 }, "test");
  const retryBody = callsTo("POST", /\/9100\/orders$/).slice(-1)[0].body;
  ok(f2.shopifyOrderId === 7000 && n422 === 1 && retryBody.inventory_behaviour === "bypass" && retryBody.owner_note.includes("SIN-STOCK"), "422 sin stock → reintento con bypass + nota SIN-STOCK");

  const f3 = await fulfillCharge({ channel: "tiendanube", tiendanube_store_id: "9100" }, "s1", SUB, { payment_id: 444, total_price: 31501, charge_number: 4 }, "test");
  ok(f3.shopifyOrderId === null && /Faltan datos: tiendanube_token/.test(f3.shopifyError), "sin token → error visible (el charge queda para reintentar)");
  const f4 = await fulfillCharge(await data(M("m_tn")), "s1", { ...SUB, plan_snapshot: { ...SUB.plan_snapshot, item_source: "manual", shopify_variant_id: null } }, { payment_id: 555, total_price: 100, charge_number: 1 }, "test");
  ok(f4.shopifyOrderId === "rec_555" && !f4.shopifyError, "plan manual viejo → comprobante interno rec_<pago>");
  const f5 = await fulfillCharge({ shopify_token: "shpat", shopify_shop: "l.myshopify.com" }, "s1", { ...SUB, plan_snapshot: {} }, { payment_id: 666, total_price: 100, charge_number: 1 }, "test");
  ok(/Faltan datos: plan_snapshot\.shopify_variant_id/.test(f5.shopifyError || ""), "merchant histórico (Shopify) sigue yendo por la rama Shopify");

  // Charge fallido → el próximo intento lo reintenta (claim vencido) sin duplicar.
  const f6 = await fulfillCharge(await data(M("m_tn")), "s1", SUB, { payment_id: 777, total_price: 31501, charge_number: 5, extra: { simulated: true } }, "simulate");
  const simBody = callsTo("POST", /\/9100\/orders$/).slice(-1)[0].body;
  ok(!!f6.shopifyOrderId && simBody.payment_status === "pending" && simBody.send_confirmation_email === false, "simulador (dev_mode): orden pendiente sin mails");
}

// ── Una tienda a la vez: Shopify y Tiendanube se excluyen ──────────────────
{
  await M("m_shop").set({ email: "d@x.com", shopify_shop: "lumina.myshopify.com", shopify_token: "shpat_x" });
  routes = [];
  const st = await call(shopifyHandler, { query: { action: "tn-oauth-start", store_url: "cafedelsur.mitiendanube.com" }, ctx: owner("m_shop") });
  ok(st.status === 400 && /Desvinculá Shopify/.test(st.json?.error || ""), "con Shopify conectado no se puede empezar a conectar Tiendanube");

  const conn = await connectStore("m_shop", { store_id: "9100", access_token: "tn_tok", scope: "read_products" });
  ok(/Desvinculá Shopify/.test(conn.error || ""), "el callback y la instalación desde Tiendanube también se bloquean");

  await M("m_tn2").set({ email: "d@x.com", tiendanube_store_id: "9100", tiendanube_token: "tn_tok" });
  const sc = await call(shopifyHandler, { method: "POST", query: { action: "save-creds" }, body: { shop: "otra.myshopify.com", access_token: "shpat_nuevo" }, ctx: owner("m_tn2") });
  ok(sc.status === 400 && /Desvinculá Tiendanube/.test(sc.json?.error || ""), "con Tiendanube conectado no se puede conectar Shopify");
  ok(callsTo("GET", /myshopify\.com/).length === 0, "ni siquiera llama a Shopify cuando está bloqueado");
}

// ─── Envío en el fulfillment order ──────────────────────────────────────────
// El envío NO entra por POST /orders (Tiendanube lo descarta): va por PATCH al
// fulfillment order. Contrato verificado contra la API real.
section("envío en el fulfillment order");
{
  const sh = tn.buildFulfillmentShipping({
    option_name: 'Andreani Estándar "Envío a domicilio"',
    option_code: "andreani_home", option_reference: "10012",
    carrier_name: "Envíopack", shipping_price: 2900,
  });
  ok(sh.type === "ship", "tipo ship cuando hay domicilio");
  ok(sh.carrier.code === "any", "carrier.code cae a 'any' (enum cerrado de Tiendanube)");
  ok(typeof sh.carrier.carrier_id === "string" && sh.carrier.carrier_id.length > 0, "carrier_id siempre string no vacío (la API lo exige)");
  ok(sh.carrier.name === "Envíopack", "el nombre del proveedor va en carrier.name, no en code");
  ok(sh.option.code === "andreani_home" && sh.option.reference === "10012", "el código y la referencia del servicio viajan enteros");
  ok(sh.consumer_cost.value === 2900, "el costo al cliente se manda acá (POST /orders lo descarta)");

  const inventado = tn.buildFulfillmentShipping({ option_code: "x", carrier_code: "andreani" });
  ok(inventado.carrier.code === "any", "un code fuera del enum se normaliza a 'any' en vez de que la API tire 422");
  const retiro = tn.buildFulfillmentShipping({ option_code: "pickup", pickup: true });
  ok(retiro.type === "pickup", "retiro en sucursal se marca como pickup");
}

{
  // El PATCH es best-effort: si falla, la orden ya está paga y no se toca.
  routes = [
    route("GET", /\/orders\/555\?aggregates=fulfillment_orders$/, { body: { fulfillment_orders: [{ id: "FO1" }] } }),
    route("PATCH", /\/orders\/555\/fulfillment-orders\/FO1$/, { status: 500, body: { message: "boom" } }),
  ];
  const r = await tn.tnSetFulfillmentShipping("9002", "tok", 555, { type: "ship" });
  ok(r.ok === false && /boom|500/.test(r.error || ""), "si el PATCH falla devuelve el error en vez de lanzar");

  routes = [
    route("GET", /\/orders\/556\?aggregates=fulfillment_orders$/, { body: { fulfillment_orders: [] } }),
  ];
  const sinFo = await tn.tnSetFulfillmentShipping("9002", "tok", 556, { type: "ship" });
  ok(sinFo.ok === false && /fulfillment/.test(sinFo.error || ""), "orden sin fulfillment order: error claro, sin PATCH a ciegas");

  routes = [
    route("GET", /\/orders\/557\?aggregates=fulfillment_orders$/, { body: { fulfillment_orders: [{ id: "FO9" }] } }),
    route("PATCH", /\/orders\/557\/fulfillment-orders\/FO9$/, { body: { id: "FO9" } }),
  ];
  const bien = await tn.tnSetFulfillmentShipping("9002", "tok", 557, { type: "ship", option: { code: "andreani_home" } });
  ok(bien.ok === true && bien.fulfillment_order_id === "FO9", "camino feliz: devuelve el id del fulfillment order");
  const patch = callsTo("PATCH", /fulfillment-orders/).at(-1);
  ok(patch?.body?.shipping?.option?.code === "andreani_home", "el PATCH manda el envío dentro de `shipping`");
}

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
