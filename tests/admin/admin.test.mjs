// Tests del panel de super-admin con Firestore y Auth en memoria (sin red ni base real).
//   node tests/admin/admin.test.mjs
// Carga el _lib/firebase.js REAL (requireMerchant / requireAdmin) con firebase-admin mockeado.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

process.env.FIREBASE_PROJECT_ID = "test-project";
process.env.FIREBASE_CLIENT_EMAIL = "test@test.iam";
process.env.FIREBASE_PRIVATE_KEY = "test-key";
process.env.ADMIN_EMAILS = " Thiago@Recurrentes.test , socio@recurrentes.test ";
globalThis.fetch = async (u) => { throw new Error("fetch inesperado " + u); };

// Reloj fijo (después del corte beta 2026-09-13).
const NOW = Date.parse("2026-10-20T15:00:00.000Z");
Date.now = () => NOW;
const ago = (days, hours = 0) => new Date(NOW - days * 86400000 - hours * 3600000).toISOString();

const src = (p) => new URL(`../../${p}`, import.meta.url).href;
const { __store, __reads } = await import("./mock-firestore.mjs");
const { __tokens, __users } = await import("./mock-auth.mjs");
const fb = await import(src("api/_lib/firebase.js"));
const admin = await import(src("api/_lib/admin.js"));
const stats = (await import(src("api/stats.js"))).default;
const merchantApi = (await import(src("api/merchant.js"))).default;

let fails = 0;
const ok = (c, msg, extra) => { console.log((c ? "✓ " : "✗ ") + msg + (!c && extra !== undefined ? "  → " + JSON.stringify(extra) : "")); if (!c) fails++; };
const doc = (p) => __store.get(p);
const docsOf = (col) => [...__store.entries()].filter(([p]) => p.startsWith(col + "/") && !p.slice(col.length + 1).includes("/")).map(([p, d]) => ({ id: p.split("/").pop(), ...d }));

function call(handler, { method = "GET", query = {}, body = null, token = null, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sin respuesta: ${method} ${JSON.stringify(query)}`)), 3000);
    const req = { method, query, body, url: "/api/x?" + new URLSearchParams(query), headers: { ...(token ? { authorization: "Bearer " + token } : {}), ...headers } };
    const res = {
      _s: 200,
      status(c) { this._s = c; return this; },
      setHeader() { return this; },
      json(o) { clearTimeout(t); resolve({ status: this._s, body: o }); return this; },
      send(o) { clearTimeout(t); resolve({ status: this._s, body: o }); return this; },
      end() { clearTimeout(t); resolve({ status: this._s, body: null }); return this; },
    };
    Promise.resolve(handler(req, res)).catch(e => { clearTimeout(t); reject(e); });
  });
}
// requireMerchant directo: devuelve { ctx, status, body }.
async function rm(token, headers = {}, method = "GET") {
  let status = 200, body = null;
  const res = { status(c) { status = c; return this; }, json(o) { body = o; return this; } };
  const ctx = await fb.requireMerchant({ method, query: {}, url: "/api/merchant", headers: { authorization: "Bearer " + token, ...headers } }, res);
  return { ctx, status, body };
}

// ─── Datos de ejemplo ────────────────────────────────────────────────────────
const put = (p, d) => __store.set(p, JSON.parse(JSON.stringify(d)));
const sub = (m, id, d) => put(`merchants/${m}/subscribers/${id}`, d);
const charge = (m, id, d) => put(`merchants/${m}/charges/${id}`, d);

__tokens.set("t-admin", { uid: "u_admin", email: "thiago@recurrentes.test", email_verified: true });
__tokens.set("t-admin-caps", { uid: "u_admin", email: "THIAGO@Recurrentes.TEST", email_verified: true });
__tokens.set("t-admin-unverified", { uid: "u_socio", email: "socio@recurrentes.test", email_verified: false });
__tokens.set("t-lumina", { uid: "lumina", email: "lumina@x.com", email_verified: true });
const user = (uid, email) => __users.set(uid, {
  uid, email, emailVerified: true, providerData: [{ providerId: "password" }],
  metadata: { creationTime: new Date(NOW - 100 * 86400000).toUTCString(), lastSignInTime: new Date(NOW - 2 * 86400000).toUTCString(), lastRefreshTime: new Date(NOW - 3600000).toUTCString() },
});
user("lumina", "lumina@x.com"); user("newbie", "newbie@x.com"); user("payer", "payer@x.com"); user("old", "old@x.com");

// Lumina: cuenta vieja (beta por fecha), Shopify + MP + flujos (tiene una clave vieja de Klaviyo: retirado, cuenta como no conectado).
put("merchants/lumina", { email: "lumina@x.com", store_name: "LuminaLabs", owner_name: "Lucía", owner_whatsapp: "11 5555-4444", contact_email: "hola@lumina.com", created_at: "2026-06-01T12:00:00.000Z", plan: "free", shopify_shop: "lumina.myshopify.com", shopify_token: "shpat_SECRET", mp_access_token: "APP_USR-SECRET", klaviyo_api_key: "pk_SECRET", flows_enabled: true, billing_cache: { subs: 4, at: ago(0, 2) } });
sub("lumina", "s1", { status: "active", plan_snapshot: { total_per_charge_ars: 10000, frequency_days: 30 } });   // 10.000
sub("lumina", "s2", { status: "active", plan_snapshot: { total_per_charge_ars: 5000, frequency_days: 15 } });    // 10.000
sub("lumina", "s3", { status: "active", quantity: 2, plan_snapshot: { subscription_price_ars: 2000, frequency_days: 30 } }); // 4.000
sub("lumina", "s4", { status: "payment_failed", plan_snapshot: { total_per_charge_ars: 9999 } });
sub("lumina", "s5", { status: "cancelled" });
sub("lumina", "s6", { status: "pending" });
charge("lumina", "c1", { amount_ars: 10000, status: "approved", created_at: ago(2) });
charge("lumina", "c2", { amount_ars: 5000, status: "approved", created_at: ago(10) });
charge("lumina", "c3", { amount_ars: 7000, status: "approved", error: "shopify 500", created_at: ago(3) });
charge("lumina", "c4", { amount_ars: 999, status: "approved", simulated: true, created_at: ago(1) });
charge("lumina", "c5", { amount_ars: 3000, status: "approved", created_at: ago(45) });
charge("lumina", "c6", { amount_ars: 4000, status: "rejected", created_at: ago(5) });
const luminaSeed = JSON.stringify(doc("merchants/lumina"));

// Newbie: gimnasio sin tienda, 15 activas → le toca Starter (11–50), lo pidió.
put("merchants/newbie", { email: "newbie@x.com", store_name: "Gym Norte", owner_name: "Nico", owner_whatsapp: "+54 9 11 2222-3333", created_at: ago(3), plan: "free", business_type: "service", channel: "none", mp_access_token: "APP_USR-y", plan_requested: "starter", plan_requested_at: ago(1) });
for (let i = 0; i < 15; i++) sub("newbie", `n${i}`, { status: "active", plan_snapshot: { total_per_charge_ars: 1000, frequency_days: 30 } });
charge("newbie", "k1", { amount_ars: 1000, status: "approved", created_at: ago(1) });

// Payer: Growth activado, 60 activas (51–100).
put("merchants/payer", { email: "payer@x.com", store_name: "Payer Store", created_at: ago(40), plan: "free", plan_activated: "growth", shopify_token: "t", mp_access_token: "t" });
for (let i = 0; i < 60; i++) sub("payer", `p${i}`, { status: "active", plan_snapshot: { total_per_charge_ars: 2000, frequency_days: 30 } });

put("merchants/m_extra", { store_name: "Payer 2", is_store: true, ownerUid: "payer", created_at: ago(3), plan: "free" });
put("merchants/gone", { email: "gone@x.com", created_at: ago(2), deleted: true });
put("merchants/old", { email: "old@x.com", created_at: ago(35), plan: "free" });

// ─── 1) Acceso ───────────────────────────────────────────────────────────────
{
  let r = await call(stats, { query: { action: "admin-overview" } });
  ok(r.status === 401, "sin token → 401");
  r = await call(stats, { query: { action: "admin-overview" }, token: "t-lumina" });
  ok(r.status === 403 && r.body.code === "admin_forbidden", "comercio común → 403 admin_forbidden", r);
  r = await call(stats, { query: { action: "admin-overview" }, token: "t-admin-unverified" });
  ok(r.status === 403 && r.body.code === "admin_forbidden", "email en ADMIN_EMAILS pero sin verificar → 403", r);
  r = await call(stats, { method: "POST", query: { action: "admin-set-plan" }, body: { merchant_id: "newbie", plan: "starter" }, token: "t-lumina" });
  ok(r.status === 403 && !doc("merchants/newbie").plan_activated, "no-admin no puede activar planes (403, nada cambia)");
  r = await call(stats, { method: "POST", query: { action: "admin-note" }, body: { merchant_id: "newbie", text: "x" }, token: "t-admin-unverified" });
  ok(r.status === 403 && !doc("admin_merchants/newbie"), "admin sin verificar no puede anotar");
  const saved = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "";
  r = await call(stats, { query: { action: "admin-overview" }, token: "t-admin" });
  ok(r.status === 403, "ADMIN_EMAILS vacía → nadie es admin (sin lista de respaldo)");
  process.env.ADMIN_EMAILS = saved;
  r = await call(stats, { query: { action: "admin-nada" }, token: "t-admin" });
  ok(r.status === 400, "action admin desconocida → 400");
}

// ─── 2) Resumen ──────────────────────────────────────────────────────────────
{
  admin.__resetAdminCache();
  const r = await call(stats, { query: { action: "admin-overview" }, token: "t-admin-caps" });
  ok(r.status === 200, "admin (email con mayúsculas) → 200", r.body);
  const o = r.body;
  ok(o.merchants.accounts === 4 && o.merchants.total === 5 && o.merchants.stores_extra === 1 && o.merchants.deleted === 1, "comercios: 4 cuentas + 1 tienda extra, 1 eliminado aparte", o.merchants);
  ok(o.merchants.new_30d === 1 && o.merchants.new_prev_30d === 2, "altas 30 d = 1 · 30 d anteriores = 2", o.merchants);
  ok(o.signups.dates.length === 90 && o.signups.counts.reduce((a, b) => a + b, 0) === 3 && o.signups.cumulative.at(-1) === 4, "serie de altas de 90 días (3 en ventana, acumulado 4)", o.signups.counts.reduce((a, b) => a + b, 0));
  ok(o.subs.active === 47, "suscripciones que facturan = 4 + 8 + 35", o.subs);
  ok(o.subs.mrr === 102000, "MRR total = 24.000 + 8.000 + 70.000", o.subs);
  ok(o.charges_30d.count === 3 && o.charges_30d.amount === 16000, "cobros 30 d: solo aprobados, sin error ni simulados ni viejos (3 / $16.000)", o.charges_30d);
  ok(o.charges_30d.amounts.reduce((a, b) => a + b, 0) === 16000 && o.charges_30d.dates.length === 30, "serie diaria de cobros suma lo mismo");
  const byId = (a) => Object.fromEntries(a.map(x => [x.id, x.count]));
  ok(JSON.stringify(byId(o.by_channel)) === JSON.stringify({ shopify: 4, none: 1 }), "reparto por canal", o.by_channel);
  ok(byId(o.by_provider).mercadopago === 5, "reparto por pasarela");
  ok(byId(o.by_business_type).physical === 4 && byId(o.by_business_type).service === 1, "reparto por tipo de negocio");
  const tier = Object.fromEntries(o.by_tier.map(x => [x.id, x]));
  ok(tier.beta?.count === 1 && tier.free?.count === 2 && tier.starter?.count === 1 && tier.growth?.count === 1 && tier.growth?.activated === 1, "reparto por plan del SaaS (beta 1 · free 2 · starter 1 · growth 1 pagando)", o.by_tier);
  ok(o.saas.paying === 1 && o.saas.usd_month === 99 && o.saas.beta === 1, "pagan 1 (US$ 99/mes), beta 1", o.saas);
  ok(o.needs_activation.length === 1 && o.needs_activation[0].id === "newbie" && o.needs_activation[0].tier === "starter" && o.needs_activation[0].plan_requested === "starter", "para activar: Gym Norte → Starter (lo pidió)", o.needs_activation);
  ok(o.stats_pending === 0, "todos los números calculados");
  const cache = doc("admin_cache/merchant_stats");
  ok(cache?.stats?.lumina?.mrr === 24000 && cache.stats.lumina.subs === 4 && cache.stats.lumina.active === 3 && !cache.stats.gone, "cache de números por comercio (sin el eliminado)", cache?.stats?.lumina);
  ok(JSON.stringify(doc("merchants/lumina")) === luminaSeed, "el resumen no escribe nada en merchants/*");
  const r0 = __reads();
  await call(stats, { query: { action: "admin-overview" }, token: "t-admin" });
  ok(__reads() === r0, "segundo resumen en menos de 60 s: 0 lecturas de Firestore");
  ok(!JSON.stringify(o).includes("SECRET"), "el resumen no expone tokens");
}

// ─── 3) Lista de comercios ───────────────────────────────────────────────────
{
  const list = (query) => call(stats, { query: { action: "admin-merchants", ...query }, token: "t-admin" }).then(r => r.body);
  let l = await list({});
  ok(JSON.stringify(l.counts) === JSON.stringify({ todos: 5, pagan: 1, free: 3, beta: 1, activar: 1, sin_conectar: 2 }), "contadores de filtros", l.counts);
  ok(l.total === 5 && l.rows[0].id === "newbie", "orden por defecto: más nuevos primero", l.rows.map(r => r.id));
  const lum = l.rows.find(r => r.id === "lumina");
  ok(lum.whatsapp_url === "https://wa.me/5491155554444" && lum.contact_email === "hola@lumina.com" && lum.owner_name === "Lucía", "WhatsApp como link wa.me + contacto", lum);
  ok(lum.login_email === "lumina@x.com" && lum.last_seen_at && lum.connections.shopify && lum.connections.mp && lum.connections.klaviyo === false && lum.connections.flows, "login, último acceso y conexiones", lum);
  ok(lum.subs === 4 && lum.mrr === 24000 && lum.beta === true && lum.plan_label === "Beta", "números y plan de la fila", lum);
  ok(l.rows.find(r => r.id === "m_extra")?.email === "payer@x.com", "tienda extra muestra el email del dueño");
  ok(!JSON.stringify(l).includes("SECRET"), "la lista no expone tokens");
  l = await list({ filter: "pagan" }); ok(l.rows.map(r => r.id).join() === "payer", "filtro pagan", l.rows.map(r => r.id));
  l = await list({ filter: "sin_conectar" }); ok(l.rows.map(r => r.id).sort().join() === "m_extra,old", "filtro sin conectar", l.rows.map(r => r.id));
  l = await list({ filter: "beta" }); ok(l.rows.map(r => r.id).join() === "lumina", "filtro beta");
  l = await list({ q: "lumi" }); ok(l.rows.map(r => r.id).join() === "lumina", "búsqueda por nombre");
  l = await list({ q: "2222" }); ok(l.rows.map(r => r.id).join() === "newbie", "búsqueda por WhatsApp");
  l = await list({ q: "PAYER@x" }); ok(l.rows.map(r => r.id).sort().join() === "m_extra,payer", "búsqueda por email (sin mayúsculas)", l.rows.map(r => r.id));
  l = await list({ limit: 2, page: 2 }); ok(l.rows.length === 2 && l.pages === 3 && l.page === 2, "paginado (2 por página → 3 páginas)", { n: l.rows.length, pages: l.pages });
  l = await list({ sort: "mrr" }); ok(l.rows[0].id === "payer", "orden por MRR");
}

// ─── 4) Ficha ────────────────────────────────────────────────────────────────
{
  let r = await call(stats, { query: { action: "admin-merchant", id: "newbie" }, token: "t-admin" });
  const m = r.body.merchant;
  ok(r.status === 200 && m.tier === "starter" && m.needs_activation && m.auth === undefined && r.body.auth?.email === "newbie@x.com", "ficha: tramo, aviso de activación y datos de login", r.body.auth);
  ok(r.body.stats?.subs === 8 && r.body.stats?.mrr === 8000 && m.whatsapp_url === "https://wa.me/5491122223333", "ficha: números recalculados + WhatsApp");
  r = await call(stats, { query: { action: "admin-merchant", id: "lumina" }, token: "t-admin" });
  ok(r.body.merchant.beta_reason === "fecha" && !JSON.stringify(r.body).includes("SECRET"), "ficha de Lumina: beta por fecha, sin tokens");
  r = await call(stats, { query: { action: "admin-merchant", id: "nope" }, token: "t-admin" });
  ok(r.status === 404, "ficha de un comercio que no existe → 404");
  r = await call(stats, { query: { action: "admin-merchant", id: "../x" }, token: "t-admin" });
  ok(r.status === 400, "id inválido → 400");
}

// ─── 5) Acciones ─────────────────────────────────────────────────────────────
{
  const post = (action, body) => call(stats, { method: "POST", query: { action }, body, token: "t-admin" });
  let r = await post("admin-set-plan", { merchant_id: "newbie", plan: "gold" });
  ok(r.status === 400, "plan inválido → 400");
  r = await post("admin-set-plan", { merchant_id: "nope", plan: "starter" });
  ok(r.status === 404, "comercio inexistente → 404");
  r = await post("admin-set-plan", { merchant_id: "newbie", plan: "starter" });
  const nb = doc("merchants/newbie");
  ok(r.body.ok && nb.plan_activated === "starter" && nb.plan_activated_at && !("plan_requested" in nb) && !("plan_requested_at" in nb), "activar Starter: plan_activated + borra el pedido", nb);
  ok(r.body.billing.needs_activation === false && r.body.plan_activated === "starter", "después de activar ya no pide activación", r.body.billing);
  const o = (await call(stats, { query: { action: "admin-overview" }, token: "t-admin" })).body;
  ok(o.needs_activation.length === 0 && o.saas.paying === 2 && o.saas.usd_month === 98, "el resumen se actualiza al toque (cache invalidado)", o.saas);
  r = await post("admin-set-plan", { merchant_id: "old", plan: "beta" });
  ok(doc("merchants/old").plan === "beta" && r.body.beta === true, "marcar beta → plan: \"beta\"");
  r = await post("admin-set-plan", { merchant_id: "old", plan: "none" });
  ok(doc("merchants/old").plan === "free" && !doc("merchants/old").plan_activated && r.body.beta === false, "sin plan → vuelve a free");
  r = await post("admin-set-plan", { merchant_id: "lumina", plan: "none" });
  ok(r.body.beta === true, "Lumina sin plan sigue beta por fecha");
  r = await post("admin-note", { merchant_id: "newbie", text: "  Le escribí por WhatsApp  " });
  ok(r.body.ok && doc("admin_merchants/newbie")?.notes?.length === 1 && doc("admin_merchants/newbie").notes[0].text === "Le escribí por WhatsApp" && !("notes" in doc("merchants/newbie")), "nota interna guardada FUERA del doc del comercio");
  r = await post("admin-note", { merchant_id: "newbie", text: "   " });
  ok(r.status === 400, "nota vacía → 400");
  const aud = docsOf("admin_audit");
  ok(aud.some(a => a.action === "set_plan" && a.merchant_id === "newbie" && a.admin_email === "thiago@recurrentes.test" && a.detail?.to === "starter"), "registro de auditoría del cambio de plan", aud);
  ok(aud.some(a => a.action === "note" && a.merchant_id === "newbie"), "registro de auditoría de la nota");
  r = await call(stats, { query: { action: "admin-merchant", id: "newbie" }, token: "t-admin" });
  ok(r.body.notes.length === 1 && r.body.audit.some(a => a.action === "set_plan"), "la ficha muestra notas y registro");
  r = await call(stats, { method: "GET", query: { action: "admin-set-plan" }, token: "t-admin" });
  ok(r.status === 400, "acciones solo por POST");
}

// ─── 6) "Ver como" (X-Admin-As en requireMerchant) ───────────────────────────
{
  let r = await rm("t-lumina", { "x-admin-as": "newbie" });
  ok(r.ctx === null && r.status === 403 && r.body.code === "admin_forbidden", "no-admin con X-Admin-As → 403", r.body);
  r = await rm("t-admin-unverified", { "x-admin-as": "newbie" });
  ok(r.ctx === null && r.status === 403, "admin sin email verificado con X-Admin-As → 403");
  const before = docsOf("admin_audit").filter(a => a.action === "view_as_request").length;
  r = await rm("t-admin", { "x-admin-as": "newbie" });
  ok(r.ctx?.merchantId === "newbie" && r.ctx.admin_view === true && r.ctx.is_admin === true && r.ctx.role === "owner", "admin GET con X-Admin-As → opera sobre ese comercio", r.ctx);
  await new Promise(res => setImmediate(res));
  ok(docsOf("admin_audit").filter(a => a.action === "view_as_request" && a.merchant_id === "newbie").length === before + 1, "queda registrado en admin_audit");
  r = await rm("t-admin", { "x-admin-as": "newbie" }, "POST");
  ok(r.ctx === null && r.status === 403 && r.body.code === "admin_read_only", "admin con X-Admin-As no puede escribir (solo lectura)", r.body);
  r = await rm("t-admin", { "x-admin-as": "nope" });
  ok(r.ctx === null && r.status === 404, "X-Admin-As a un comercio inexistente → 404");
  r = await rm("t-lumina");
  ok(r.ctx?.merchantId === "lumina" && r.ctx.is_admin === false && !r.ctx.admin_view, "comercio normal sin header: igual que siempre, is_admin false");
  r = await rm("t-lumina", { "x-merchant-id": "payer" });
  ok(r.ctx === null && r.status === 403 && r.body.code === "merchant_forbidden", "X-Merchant-Id ajeno sigue rechazado");
  r = await rm("t-admin");
  ok(r.ctx?.merchantId === "u_admin" && r.ctx.is_admin === true, "admin sin header: su propia cuenta, is_admin true");
}

// ─── 7) GET /api/merchant (is_admin / admin_view) + inicio del "ver como" ────
{
  let r = await call(merchantApi, { token: "t-admin", headers: { "x-admin-as": "newbie" } });
  ok(r.status === 200 && r.body.merchant?.id === "newbie" && r.body.merchant.is_admin === true && r.body.merchant.admin_view === true, "GET merchant con ver-como: datos del comercio + is_admin + admin_view", r.body?.merchant && { id: r.body.merchant.id, is_admin: r.body.merchant.is_admin });
  r = await call(merchantApi, { token: "t-lumina" });
  ok(r.status === 200 && r.body.merchant?.is_admin === false && r.body.merchant.admin_view === false, "GET merchant de un comercio: is_admin false");
  const nbBefore = JSON.stringify(doc("merchants/newbie"));
  r = await call(merchantApi, { method: "PATCH", query: { action: "save-settings" }, body: { email_brand: "HACK" }, token: "t-admin", headers: { "x-admin-as": "newbie" } });
  ok(r.status === 403 && r.body.code === "admin_read_only" && JSON.stringify(doc("merchants/newbie")) === nbBefore, "PATCH en modo ver-como → 403 y no cambia nada");
  r = await call(merchantApi, { token: "t-lumina", headers: { "x-admin-as": "newbie" } });
  ok(r.status === 403, "GET merchant de no-admin con X-Admin-As → 403");
  r = await call(stats, { method: "POST", query: { action: "admin-view-as" }, body: { merchant_id: "newbie" }, token: "t-admin" });
  ok(r.body.ok && r.body.merchant?.name === "Gym Norte" && docsOf("admin_audit").some(a => a.action === "view_as_start" && a.merchant_id === "newbie"), "POST admin-view-as registra el inicio");
  r = await call(stats, { method: "POST", query: { action: "admin-view-as" }, body: { merchant_id: "newbie" }, token: "t-lumina" });
  ok(r.status === 403, "admin-view-as de no-admin → 403");
}

// ─── 8) WhatsApp ─────────────────────────────────────────────────────────────
{
  const w = admin.whatsappUrl;
  ok(w("11 5555-4444") === "https://wa.me/5491155554444", "AR sin código de país");
  ok(w("+54 11 5555 4444") === "https://wa.me/5491155554444", "54 sin el 9 de celular");
  ok(w("+54 9 351 555-1234") === "https://wa.me/5493515551234", "internacional completo");
  ok(w("011 5555-4444") === "https://wa.me/5491155554444", "con 0 adelante");
  ok(w("+1 415 555 0100") === "https://wa.me/14155550100", "otro país");
  ok(w("abc") === null && w("") === null, "vacío o inválido → null");
}

console.log(fails ? `\n${fails} test(s) fallaron` : "\nTodo OK");
process.exit(fails ? 1 : 0);
