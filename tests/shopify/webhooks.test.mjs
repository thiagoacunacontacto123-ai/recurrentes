// Test de api/shopify/webhooks.js con Firestore en memoria y Shopify falso.
// Correr: node tests/shopify/webhooks.test.mjs
import { register } from "node:module";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

delete process.env.SHOPIFY_API_SECRET;
// Shopify falso: estado del token según el token (alive → 200, dead → 401, boom → error de red).
const tokenStatus = {};
const fetched = [];
globalThis.fetch = async (url, opts = {}) => {
  const tok = opts.headers?.["X-Shopify-Access-Token"];
  fetched.push({ url: String(url), tok });
  if (!String(url).includes("/shop.json")) throw new Error("fetch inesperado " + url);
  const st = tokenStatus[tok] || "dead";
  if (st === "boom") throw new Error("network down");
  return new Response(JSON.stringify(st === "alive" ? { shop: { id: 1 } } : { errors: "Invalid API key" }), { status: st === "alive" ? 200 : st === "5xx" ? 502 : 401 });
};

const { db, __store, __reads } = await import(new URL("./mock-firebase.mjs", import.meta.url).href);
const { default: handler } = await import(new URL("../../api/shopify/webhooks.js", import.meta.url).href);
const shared = await import(new URL("../../shared/platform/shopify.js", import.meta.url).href);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const sign = (secret, body) => crypto.createHmac("sha256", secret).update(body).digest("base64");
const send = (topic, payload, { secret, shop, hmac } = {}) => new Promise((resolve) => {
  const body = Buffer.from(JSON.stringify(payload));
  const headers = { "x-shopify-topic": topic };
  if (shop !== null) headers["x-shopify-shop-domain"] = shop ?? payload.shop_domain ?? payload.myshopify_domain;
  headers["x-shopify-hmac-sha256"] = hmac ?? (secret ? sign(secret, body) : "");
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); }, end() { resolve({ status: this._s }); } };
  handler({ method: "POST", headers, body }, res);
});
const M = (id) => db().collection("merchants").doc(id);
const get = async (path) => { const parts = path.split("/"); let r = db().collection(parts[0]).doc(parts[1]); for (let i = 2; i < parts.length; i += 2) r = r.collection(parts[i]).doc(parts[i + 1]); return (await r.get()).data(); };
const dump = () => JSON.stringify([...__store.entries()].sort());
const gdpr = async (mid) => (await M(mid).collection("gdpr_requests").get()).docs.map(d => ({ id: d.id, ...d.data() }));

// ── Datos ──
const addr = { address1: "Calle 123", city: "CABA", province: "CABA", zip: "1000" };
await M("m1").set({ shopify_shop: "lumina.myshopify.com", shopify_client_secret: "sec_m1", shopify_token: "tok_m1", shopify_scope: "read_products,write_orders" });
await M("m1").collection("subscribers").doc("s1").set({ customer_email: "ana@x.com", customer_name: "Ana", customer_phone: "+54911", shipping_address: addr, status: "active", mp_preapproval_id: "pre1", plan_id: "p1" });
await M("m1").collection("subscribers").doc("s2").set({ customer_email: "bob@x.com", customer_name: "Bob", status: "active" });
await M("m1").collection("charges").doc("c1").set({ subscriber_id: "s1", amount_ars: 100, customer_email: "ana@x.com", payer_email: "ana@mp.com", shopify_order_id: "o1" });
await M("m1").collection("charges").doc("c2").set({ subscriber_id: "s2", amount_ars: 100, shopify_order_id: "o2" });
await M("m1").collection("email_log").doc("e1").set({ subscriber_id: "s1", to: "ana@x.com", customer_name: "Ana", type: "activation" });
// Otro merchant con el MISMO email de cliente (no se toca nunca).
await M("m2").set({ shopify_shop: "otra.myshopify.com", shopify_client_secret: "sec_m2", shopify_token: "tok_m2" });
await M("m2").collection("subscribers").doc("s1").set({ customer_email: "ana@x.com", customer_name: "Ana Otra", shipping_address: addr });
// Otra cuenta conectada a la MISMA tienda con OTRA app (no se toca con la firma de m1).
await M("m3").set({ shopify_shop: "lumina.myshopify.com", shopify_client_secret: "sec_m3", shopify_token: "tok_m3" });
await M("m3").collection("subscribers").doc("s9").set({ customer_email: "ana@x.com", customer_name: "Ana M3" });
// Tienda que se fue (token muerto): un sub de Shopify y uno de link.
await M("m4").set({ shopify_shop: "cerrada.myshopify.com", shopify_client_secret: "sec_m4", shopify_token: "tok_m4", store_name: "Cerrada" });
await M("m4").collection("subscribers").doc("a").set({ customer_email: "carla@x.com", customer_name: "Carla", shipping_address: addr, status: "cancelled" });
await M("m4").collection("subscribers").doc("b").set({ customer_email: "dani@x.com", customer_name: "Dani", status: "active", plan_snapshot: { channel: "none" } });
tokenStatus.tok_m1 = "alive"; tokenStatus.tok_m3 = "alive"; tokenStatus.tok_m4 = "dead";

// ── 0) Scopes compartidos ──
// write_draft_orders volvió el 21-sept: draftOrderCalculate (la cotización de
// envíos en vivo) lo exige. Ver tests/money-path/envios-auto.test.mjs.
ok(shared.SHOPIFY_SCOPES_STRING === "read_products,read_orders,write_orders,read_customers,write_customers,read_shipping,write_draft_orders,read_discounts,write_discounts", "lista de scopes compartida (con read_shipping y write_draft_orders)");
ok(shared.oauthScopes("read_products, read_inventory") === shared.SHOPIFY_SCOPES_STRING + ",read_inventory", "la env solo SUMA scopes");
ok(shared.oauthScopes("") === shared.SHOPIFY_SCOPES_STRING, "sin env: lista compartida");
ok(JSON.stringify(shared.missingShopifyScopes("write_orders,write_customers,read_products")) === JSON.stringify(["read_shipping","write_draft_orders"]), "faltan read_shipping y write_draft_orders (write_X cubre read_X)");
ok(shared.missingShopifyScopes(null).length === 0, "sin dato de scopes: no se sugiere nada");

// ── 1) Firmas inválidas: 401 y nada cambia ──
let before = dump(), r0 = __reads();
let r = await send("customers/redact", { shop_domain: "lumina.myshopify.com", customer: { email: "ana@x.com" } }, { hmac: "" });
ok(r.status === 401 && dump() === before && __reads() === r0, "sin firma → 401, sin leer ni escribir Firestore");
r = await send("customers/redact", { shop_domain: "lumina.myshopify.com", customer: { email: "ana@x.com" } }, { secret: "cualquiera" });
ok(r.status === 401 && dump() === before, "firma con secret desconocido → 401, nada cambia");
r0 = __reads();
r = await send("customers/redact", { shop_domain: "no es un shop", customer: { email: "ana@x.com" } }, { secret: "x", shop: "no es un shop" });
ok(r.status === 401 && __reads() === r0, "shop inválido y firma inválida → 401 sin tocar Firestore");
// Webhook genuino de m2 al que le cambiaron el header para apuntar a lumina.
r = await send("customers/redact", { shop_domain: "otra.myshopify.com", customer: { email: "ana@x.com" } }, { secret: "sec_m2", shop: "lumina.myshopify.com" });
ok(r.status === 401 && dump() === before, "header de tienda cambiado (firma de otra app) → 401");
// Firmado por m1 pero el cuerpo dice otra tienda.
r = await send("customers/redact", { shop_domain: "otra.myshopify.com", customer: { email: "ana@x.com" } }, { secret: "sec_m1", shop: "lumina.myshopify.com" });
ok(r.status === 401 && dump() === before, "cuerpo firmado con otra tienda que el header → 401");

// ── 2) customers/redact ──
const redactBody = { shop_domain: "lumina.myshopify.com", customer: { id: 77, email: "Ana@x.com" }, orders_to_redact: [1, 2] };
r = await send("customers/redact", redactBody, { secret: "sec_m1" });
ok(r.status === 200, "customers/redact firmado por la app de m1 → 200");
const s1 = await get("merchants/m1/subscribers/s1");
ok(/^redacted\+[0-9a-f]{16}@example\.invalid$/.test(s1.customer_email) && s1.customer_name === null && s1.shipping_address === null && s1.customer_phone === null, "sub anonimizado (email, nombre, teléfono, dirección)");
ok(s1.status === "active" && s1.mp_preapproval_id === "pre1" && s1.plan_id === "p1", "estado, plan e ids de MP intactos");
const c1 = await get("merchants/m1/charges/c1");
ok(c1.customer_email === s1.customer_email && c1.payer_email === null && c1.amount_ars === 100 && c1.shopify_order_id === "o1", "cobro anonimizado, montos y orden intactos");
ok((await get("merchants/m1/email_log/e1")).to === s1.customer_email, "email_log anonimizado");
ok((await get("merchants/m1/subscribers/s2")).customer_email === "bob@x.com", "otro cliente del mismo merchant intacto");
ok((await get("merchants/m2/subscribers/s1")).customer_name === "Ana Otra", "mismo email en OTRO merchant: intacto");
ok((await get("merchants/m3/subscribers/s9")).customer_name === "Ana M3", "misma tienda con OTRA app: intacto");
let g = await gdpr("m1");
ok(g.length === 1 && g[0].status === "done" && g[0].redacted_subscribers === 1 && g[0].email_hash && !g[0].customer_email, "pedido registrado (sin el email en claro)");
r = await send("customers/redact", redactBody, { secret: "sec_m1" });
ok(r.status === 200 && r.results?.[0] === "already_done" && (await gdpr("m1")).length === 1, "reintento de Shopify: no duplica ni rehace");

// ── 3) customers/data_request ──
r = await send("customers/data_request", { shop_domain: "lumina.myshopify.com", customer: { id: 88, email: "bob@x.com", phone: "+5491" }, orders_requested: [5], data_request: { id: 9 } }, { secret: "sec_m1" });
g = (await gdpr("m1")).find(x => x.topic === "customers/data_request");
ok(r.status === 200 && g?.status === "pending" && g.customer_email === "bob@x.com" && g.data_request_id === 9, "data_request queda pendiente con el cliente");
ok(JSON.stringify(g.refs?.subscribers) === '["s2"]' && JSON.stringify(g.refs?.charges) === '["c2"]', "referencia los subs y cobros de ese cliente");
ok(Math.abs(Date.parse(g.due_at) - Date.parse(g.created_at) - 30 * 86400000) < 1000, "vence a los 30 días");
ok(!(await gdpr("m3")).length && !(await gdpr("m2")).length, "no se registra en otros merchants");

// ── 4) app/uninstalled ──
r = await send("app/uninstalled", { id: 1, myshopify_domain: "lumina.myshopify.com", domain: "www.lumina.com" }, { secret: "sec_m1" });
ok(r.status === 503 && (await get("merchants/m1")).shopify_token === "tok_m1", "token todavía vivo → 503 (Shopify reintenta), no se borra");
tokenStatus.tok_m1 = "dead";
r = await send("app/uninstalled", { id: 1, myshopify_domain: "lumina.myshopify.com", domain: "www.lumina.com" }, { secret: "sec_m1" });
let m1 = await get("merchants/m1");
ok(r.status === 200 && m1.shopify_token === undefined && m1.shopify_scope === undefined && m1.shopify_uninstalled_at, "token revocado → se borra el token y se marca desinstalada");
ok((await get("merchants/m3")).shopify_token === "tok_m3", "la otra cuenta de la misma tienda conserva su token");

// ── 5) shop/redact ──
r = await send("shop/redact", { shop_id: 3, shop_domain: "lumina.myshopify.com" }, { secret: "sec_m3" });
ok(r.status === 200 && (await get("merchants/m3")).shopify_token === "tok_m3" && (await get("merchants/m3/subscribers/s9")).customer_name === "Ana M3", "shop/redact con la tienda todavía conectada → no se borra nada");
ok((await gdpr("m3"))[0]?.status === "skipped_still_connected", "queda registrado como omitido");
tokenStatus.tok_m4 = "boom";
before = dump();
r = await send("shop/redact", { shop_id: 4, shop_domain: "cerrada.myshopify.com" }, { secret: "sec_m4" });
ok(r.status === 503 && dump() === before, "no se puede verificar el token (red caída) → 503 sin tocar nada");
tokenStatus.tok_m4 = "dead";
r = await send("shop/redact", { shop_id: 4, shop_domain: "cerrada.myshopify.com" }, { secret: "sec_m4" });
const m4 = await get("merchants/m4");
ok(r.status === 200 && m4.shopify_token === undefined && m4.shopify_client_secret === undefined && m4.shop_redacted_at && m4.store_name === "Cerrada", "shop/redact: borra token y secret, el merchant sigue existiendo");
const a = await get("merchants/m4/subscribers/a"), b = await get("merchants/m4/subscribers/b");
ok(a.customer_name === null && a.shipping_address === null && a.redacted_reason === "shop/redact", "cliente de Shopify anonimizado");
ok(b.customer_name === "Dani" && b.customer_email === "dani@x.com", "cliente del link de suscripción (no es de Shopify) intacto");
ok((await gdpr("m4")).some(x => x.status === "done" && x.redacted_subscribers === 1), "shop/redact registrado");
ok((await get("merchants/m2/subscribers/s1")).customer_name === "Ana Otra" && (await get("merchants/m2")).shopify_token === "tok_m2", "merchant m2 nunca se tocó");

// ── 6) App única (SHOPIFY_API_SECRET) ──
process.env.SHOPIFY_API_SECRET = "envsec";
await M("m5").set({ shopify_shop: "unica.myshopify.com", shopify_token: "tok_m5" });
await M("m5").collection("subscribers").doc("x").set({ customer_email: "eva@x.com", customer_name: "Eva" });
await M("m6").set({ shopify_shop: "unica.myshopify.com", shopify_client_secret: "sec_m6", shopify_token: "tok_m6" });
await M("m6").collection("subscribers").doc("y").set({ customer_email: "eva@x.com", customer_name: "Eva M6" });
r0 = __reads();
r = await send("customers/redact", { customer: { email: "eva@x.com" } }, { secret: "envsec", shop: "unica.myshopify.com" });
ok(r.status === 200 && r.ignored && __reads() === r0, "app única sin tienda en el cuerpo firmado → se ignora sin leer Firestore");
r = await send("customers/redact", { shop_domain: "unica.myshopify.com", customer: { email: "eva@x.com" } }, { secret: "envsec" });
ok(r.status === 200 && (await get("merchants/m5/subscribers/x")).customer_name === null, "app única: redacta al merchant sin app propia");
ok((await get("merchants/m6/subscribers/y")).customer_name === "Eva M6", "app única: NO toca al merchant que usa su propia app");
r = await send("customers/redact", { shop_domain: "sinmerchant.myshopify.com", customer: { email: "eva@x.com" } }, { secret: "envsec" });
ok(r.status === 200 && r.ignored, "tienda sin merchant → 200 ignorado");
ok(fetched.every(f => f.url.startsWith("https://") && f.url.includes(".myshopify.com/admin/api/")), "solo se consultó shop.json de Shopify (falso)");

console.log(fails ? `\n${fails} FALLARON` : "\nTodo OK");
process.exit(fails ? 1 : 0);
