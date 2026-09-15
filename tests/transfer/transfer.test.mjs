// Transferir tienda a otra cuenta — de punta a punta contra el handler real
// /api/merchant con Firestore en memoria, auth falsa y Resend stubbeado.
// Correr: node tests/transfer/transfer.test.mjs
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

process.env.FIREBASE_PROJECT_ID = "test";
process.env.FIREBASE_CLIENT_EMAIL = "test@test.iam";
process.env.FIREBASE_PRIVATE_KEY = "x";
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Recurrentes <hola@recurrentesapp.com>";

const sent = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("resend")) { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: "em_" + sent.length }), { status: 200 }); }
  throw new Error("fetch inesperado " + url);
};
const tokens = globalThis.__authTokens = new Map();
const login = (uid, email, verified = true) => { tokens.set("tok_" + uid, { uid, email, email_verified: verified }); return "tok_" + uid; };

const { __store } = await import("./mock-firestore.mjs");
const fb = await import("../../api/_lib/firebase.js");
const { default: handler } = await import("../../api/merchant.js");
const { db, clearMerchantCache, resolveMerchantAccess, getOrCreateMerchant } = fb;

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log("✗ " + msg); } if (c && process.env.VERBOSE) console.log("✓ " + msg); };
const section = (s) => console.log("\n— " + s);

function call(method, action, { as, body, headers = {}, query = {} } = {}) {
  return new Promise((resolve) => {
    const h = { ...headers };
    if (as) h.authorization = "Bearer " + as;
    const req = { method, query: { ...(action ? { action } : {}), ...query }, headers: h, body: body || {}, socket: { remoteAddress: "1.2.3.4" } };
    const res = { _s: 200, headersSent: false, status(c) { this._s = c; return this; }, json(o) { this.headersSent = true; resolve({ ...o, status: this._s, body: o }); }, end() { resolve({ status: this._s, body: {} }); } };
    handler(req, res);
  });
}
const M = (id) => db().collection("merchants").doc(id);
const doc = async (path) => __store.get(path) ? JSON.parse(JSON.stringify(__store.get(path))) : undefined;
const sansCache = (d) => { const c = { ...d }; delete c.billing_cache; return c; };
const lastMailTo = (to) => [...sent].reverse().find(m => (m.to || []).includes(to));
const tokenFromMail = (m) => (String(m?.html || "").match(/#\/transferir\?t=([A-Za-z0-9_-]+)/) || [])[1];

// ─── Datos ────────────────────────────────────────────────────────────────
// Lumina: doc clásico SIN campos multi-tienda (el caso de producción).
const LUMINA = { email: "lumina@lumina.com", plan: "free", created_at: "2026-06-01T00:00:00.000Z", store_name: "LuminaLabs", shopify_shop: "lumina.myshopify.com", shopify_token: "shpat_lumina", mp_access_token: "APP_USR-lumina", widget_color: "#10b981" };
await M("uidL").set(LUMINA);
await M("uidL").collection("plans").doc("pl1").set({ product_title: "Cápsulas", active: true });
await M("uidL").collection("subscribers").doc("sl1").set({ status: "active", customer_email: "c@x.com" });
const LUMINA_BEFORE = await doc("merchants/uidL");

// Ana: tienda principal ESTILO LUMINA (sin ownerUid) + una miembro (Mica) + una tienda extra.
await M("uidA").set({
  email: "ana@x.com", plan: "free", created_at: "2026-07-01T00:00:00.000Z", store_name: "Tienda Ana",
  shopify_shop: "ana.myshopify.com", shopify_token: "shpat_ana", mp_access_token: "APP_USR-ana", plan_activated: "starter",
  teamUids: ["uidM"], teamMembers: { uidM: { email: "mica@x.com", name: "Mica", role: "member", secciones: { cobros: true }, since: "2026-07-02" } },
  stores: [{ id: "uidA", name: "Tienda Ana", role: "owner" }, { id: "m_extra", name: "Extra", role: "owner" }],
  active_merchant_id: "uidA",
});
await M("uidA").collection("plans").doc("pa1").set({ product_title: "Café", active: true });
await M("uidA").collection("subscribers").doc("sa1").set({ status: "active", customer_email: "cli@x.com", mp_preapproval_id: "pre_1" });
await M("uidA").collection("charges").doc("ca1").set({ amount_ars: 1000, shopify_order_id: "o1" });
await M("m_extra").set({ is_store: true, store_name: "Extra", email: "ana@x.com", ownerUid: "uidA", ownerEmail: "ana@x.com", teamUids: ["uidA"], teamMembers: { uidA: { email: "ana@x.com", role: "owner", secciones: {} } }, plan: "free", created_at: "2026-07-05T00:00:00.000Z" });

const A = login("uidA", "ana@x.com"), B = login("uidB", "bruno@x.com"), C = login("uidC", "carla@x.com"), Mi = login("uidM", "mica@x.com"), L = login("uidL", "lumina@lumina.com");
const Bunver = "tok_uidB_unverified"; tokens.set(Bunver, { uid: "uidB", email: "bruno@x.com", email_verified: false });

// ─── 1. Lumina sin tocar ─────────────────────────────────────────────────
section("Lumina (doc clásico) sigue resolviendo igual");
{
  const acc = await resolveMerchantAccess("uidL", "uidL");
  ok(acc.ok && acc.role === "owner", "resolveMerchantAccess(uidL, uidL) → owner");
  const me = await call("GET", undefined, { as: L });
  ok(me.status === 200 && me.merchant?.id === "uidL" && me.merchant.role === "owner" && me.merchant.is_primary === true, `GET /api/merchant sin header → su doc, dueño, principal (${me.status})`);
  const ws = await call("GET", "workspace", { as: L });
  const s = ws.stores?.[0];
  ok(ws.ok && ws.stores.length === 1 && s.id === "uidL" && s.is_primary && s.can_transfer === true && s.transfer_pending === null && ws.active_merchant_id === "uidL", "workspace: una tienda principal, activa, sin transferencia pendiente");
  const g = await getOrCreateMerchant("uidL", "otro@mail.com");
  ok(g.email === "lumina@lumina.com" && !g.ownerUid, "getOrCreateMerchant no pisa ni agrega campos");
  ok(JSON.stringify(sansCache(await doc("merchants/uidL"))) === JSON.stringify(LUMINA_BEFORE), "el doc de Lumina no cambió (fuera del cache de billing de siempre)");
}

// ─── 2. Iniciar ──────────────────────────────────────────────────────────
section("Iniciar la transferencia (solo el dueño)");
let tokB;
{
  const r0 = await call("POST", "transfer-start", { as: Mi, body: { merchant_id: "uidA", email: "bruno@x.com", keep_access: false } });
  ok(r0.status === 403, `una miembro no puede transferir (${r0.status})`);
  const r1 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "ana@x.com" } });
  ok(r1.status === 400, "no se puede transferir al propio email");
  const r2 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "no-es-mail" } });
  ok(r2.status === 400, "email inválido → 400");
  const r3 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "Bruno@X.com", keep_access: false } });
  ok(r3.status === 200 && r3.ok && r3.mail === "enviado" && !r3.accept_url, `el dueño la inicia y sale el mail (${r3.status} ${r3.error || ""})`);
  const mail = lastMailTo("bruno@x.com");
  tokB = tokenFromMail(mail);
  ok(!!tokB && String(mail.html).includes("https://www.recurrentesapp.com/#/transferir?t="), "el mail trae el link https://www.recurrentesapp.com/#/transferir?t=…");
  ok(mail.reply_to === "ana@x.com", "reply-to al dueño");
  const d = await doc("merchants/uidA");
  ok(d.transfer_pending?.to_email === "bruno@x.com" && d.transfer_pending.keep_access === false && !JSON.stringify(d).includes(tokB), "pendiente en la tienda, sin el token crudo");
  const days = (Date.parse(d.transfer_pending.expires_at) - Date.parse(d.transfer_pending.created_at)) / 86400000;
  ok(Math.round(days) === 7, "vence en 7 días");
  ok(!JSON.stringify([...__store.entries()].filter(([k]) => k.startsWith("store_transfers/"))).includes(tokB), "store_transfers no guarda el token crudo");
  const r4 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "carla@x.com" } });
  ok(r4.status === 409 && r4.code === "transfer_pending", "solo una activa por tienda (409)");
  const ws = await call("GET", "workspace", { as: A });
  const s = ws.stores.find(x => x.id === "uidA");
  ok(s?.transfer_pending?.to_email === "bruno@x.com" && s.transfer_pending.expired === false, "el dueño la ve pendiente en workspace");
  const audits = [...__store.entries()].filter(([k, v]) => k.startsWith("audit_log/") && v.type === "transfer_started");
  ok(audits.length === 1 && audits[0][1].actor_uid === "uidA", "queda en audit_log");
}

// ─── 3. Abrir el link ────────────────────────────────────────────────────
section("La cuenta destino abre el link");
{
  const anon = await call("GET", "transfer-info", { query: { t: tokB } });
  ok(anon.status === 200 && anon.body.status === "pending" && anon.store_name === "Tienda Ana" && anon.to_email === "br***@x.com" && anon.logged_in === false, `sin sesión: datos + email enmascarado (${anon.to_email})`);
  const bad = await call("GET", "transfer-info", { query: { t: "x".repeat(43) } });
  ok(bad.status === 404 && bad.code === "invalid", "token inexistente → 404 invalid");
  const bad2 = await call("GET", "transfer-info", { query: { t: "<script>" } });
  ok(bad2.status === 404, "token mal formado → 404");
  const other = await call("GET", "transfer-info", { as: C, query: { t: tokB } });
  ok(other.email_match === false && other.to_email === "br***@x.com", "logueado con otro mail: email_match false");
  const mine = await call("GET", "transfer-info", { as: B, query: { t: tokB } });
  ok(mine.email_match === true && mine.to_email === "bruno@x.com" && mine.email_verified === true, "logueado con el mail correcto");
}

// ─── 4. Aceptar: rechazos ────────────────────────────────────────────────
section("Aceptar: validaciones");
{
  const r1 = await call("POST", "transfer-accept", { as: C, body: { t: tokB } });
  ok(r1.status === 403 && r1.code === "email_mismatch", `otro email → 403 email_mismatch (${r1.code})`);
  const r2 = await call("POST", "transfer-accept", { as: Bunver, body: { t: tokB } });
  ok(r2.status === 403 && r2.code === "email_unverified", `email sin verificar → 403 (${r2.code})`);
  const r3 = await call("POST", "transfer-accept", { as: B, body: { t: "y".repeat(43) } });
  ok(r3.status === 404 && r3.code === "invalid", "token inválido → 404");
  const r4 = await call("POST", "transfer-accept", { body: { t: tokB } });
  ok(r4.status === 401, "sin sesión → 401");
  ok((await doc("merchants/uidA")).ownerUid === undefined, "nada cambió todavía");
}

// ─── 5. Aceptar la tienda PRINCIPAL (sin quedarse) ───────────────────────
section("Aceptar la tienda principal (el dueño anterior pierde el acceso)");
{
  const before = await doc("merchants/uidA");
  const r = await call("POST", "transfer-accept", { as: B, body: { t: tokB } });
  ok(r.status === 200 && r.ok && r.merchant_id === "uidA", `acepta (${r.status} ${r.error || ""})`);
  const d = await doc("merchants/uidA");
  ok(d.ownerUid === "uidB" && d.ownerEmail === "bruno@x.com" && d.email === "bruno@x.com", "ownerUid / ownerEmail / email = cuenta nueva");
  ok(d.teamUids.includes("uidB") && d.teamUids.includes("uidM") && !d.teamUids.includes("uidA"), "teamUids: nuevo dueño + miembros, sin el anterior");
  ok(JSON.stringify(d.teamMembers.uidM) === JSON.stringify(before.teamMembers.uidM), "la miembro queda igual (mismos permisos)");
  ok(!d.teamMembers.uidA && d.teamMembers.uidB?.role === "owner", "el anterior no figura; el nuevo es owner");
  ok(d.is_store === true && d.transfer_pending === undefined && d.stores === undefined && d.active_merchant_id === undefined, "deja de ser 'principal'; sin pendiente; sin campos de perfil del anterior");
  ok(d.shopify_token === "shpat_ana" && d.mp_access_token === "APP_USR-ana" && d.plan_activated === "starter" && d.created_at === before.created_at, "tokens de Shopify/MP, plan y fecha de alta quedan en la tienda");
  ok(!!(await doc("merchants/uidA/plans/pa1")) && !!(await doc("merchants/uidA/subscribers/sa1")) && !!(await doc("merchants/uidA/charges/ca1")), "planes, suscriptores y cobros siguen en el mismo id");
  const p = await doc("profiles/uidA");
  ok(p && p.stores.length === 1 && p.stores[0].id === "m_extra" && p.active_merchant_id === null && p.primary_transferred?.to_email === "bruno@x.com", "el perfil del anterior se mudó a profiles/uidA");
  const tr = [...__store.entries()].find(([k, v]) => k.startsWith("store_transfers/") && v.merchant_id === "uidA")?.[1];
  ok(tr?.status === "accepted" && tr.accepted_by_uid === "uidB", "store_transfers: accepted");
  ok(!!lastMailTo("ana@x.com") && /Transferiste/.test(lastMailTo("ana@x.com").subject), "aviso por mail al dueño anterior");
  ok((await doc("merchants/uidB"))?.active_merchant_id === "uidA", "la tienda recibida queda activa para la cuenta nueva (en SU doc)");

  // Accesos
  const accA = await resolveMerchantAccess("uidA", "uidA");
  ok(!accA.ok && accA.transferred === true, "resolveMerchantAccess(uidA, uidA) → denegado (transferred)");
  const meA = await call("GET", undefined, { as: A });
  ok(meA.status === 403 && meA.reason === "store_transferred" && meA.code === "merchant_forbidden", `GET sin header como el dueño anterior → 403 store_transferred (${meA.status})`);
  const meA2 = await call("GET", undefined, { as: A, headers: { "x-merchant-id": "uidA" } });
  ok(meA2.status === 403 && meA2.reason === "store_transferred", "con X-Merchant-Id viejo → 403 store_transferred (el front resetea)");
  const subsA = await new Promise(res => { import("../../api/subscribers.js").then(m => m.default({ method: "GET", query: {}, headers: { authorization: "Bearer " + A }, body: {} }, { _s: 200, status(c) { this._s = c; return this; }, json(o) { res({ status: this._s, ...o }); }, setHeader() {}, end() { res({ status: this._s }); } })); });
  ok(subsA.status === 403, `otro endpoint (/api/subscribers) también le niega al anterior (${subsA.status})`);
  const meB = await call("GET", undefined, { as: B, headers: { "x-merchant-id": "uidA" } });
  ok(meB.status === 200 && meB.merchant.role === "owner" && meB.merchant.is_primary === false && meB.merchant.owner_uid === "uidB", "la cuenta nueva entra como dueña");
  const meM = await call("GET", undefined, { as: Mi, headers: { "x-merchant-id": "uidA" } });
  ok(meM.status === 200 && meM.merchant.role === "member", "la miembro sigue entrando como miembro");

  // Workspace del anterior (sin tienda principal) y del nuevo
  const wsA = await call("GET", "workspace", { as: A });
  ok(wsA.status === 200 && wsA.stores.every(s => s.id !== "uidA") && wsA.stores.some(s => s.id === "m_extra") && wsA.primary_transferred?.to_email === "bruno@x.com" && wsA.active_merchant_id === "m_extra", "workspace del anterior: sin la transferida, con su tienda extra");
  const wsB = await call("GET", "workspace", { as: B });
  const sB = wsB.stores.find(s => s.id === "uidA");
  ok(sB?.role === "owner" && sB.can_transfer === true && sB.is_primary === false && wsB.active_merchant_id === "uidA", "workspace del nuevo: la tienda como dueño, activa");

  // getOrCreateMerchant NO recrea ni pisa el doc del uid viejo
  const snapBefore = JSON.stringify(sansCache(await doc("merchants/uidA")));
  const g = await getOrCreateMerchant("uidA", "ana@x.com");
  ok(g.ownerUid === "uidB" && JSON.stringify(sansCache(await doc("merchants/uidA"))) === snapBefore, "getOrCreateMerchant(uidA) no recrea ni pisa el doc transferido");

  // Acciones de perfil del anterior: nunca escriben el doc ajeno
  const rn = await call("POST", "store-rename", { as: A, body: { merchant_id: "uidA", name: "Hackeada" } });
  ok(rn.status === 403 && (await doc("merchants/uidA")).store_name === "Tienda Ana", "el anterior no puede renombrarla");
  const t2 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "carla@x.com" } });
  ok(t2.status === 403, "el anterior no puede volver a transferirla");
  const cr = await call("POST", "store-create", { as: A, body: { name: "Nueva de Ana", color: "#123456" } });
  ok(cr.status === 200 && cr.store?.id?.startsWith("m_"), `el anterior puede crear una tienda nueva (${cr.status} ${cr.error || ""})`);
  const newId = cr.store.id;
  ok((await doc("merchants/" + newId)).ownerUid === "uidA", "la tienda nueva es del anterior");
  ok(JSON.stringify(sansCache(await doc("merchants/uidA"))) === snapBefore, "crear tienda no tocó el doc transferido");
  const pA = await doc("profiles/uidA");
  ok(pA.active_merchant_id === newId && pA.stores.some(s => s.id === newId) && !pA.stores.some(s => s.id === "uidA"), "el cache/tienda activa del anterior viven en profiles/uidA");
  const act = await call("POST", "store-activate", { as: A, body: { merchant_id: "m_extra" } });
  ok(act.status === 200 && (await doc("profiles/uidA")).active_merchant_id === "m_extra", "store-activate sin tienda principal escribe en profiles");
  const actBad = await call("POST", "store-activate", { as: A, body: { merchant_id: "uidA" } });
  ok(actBad.status === 403, "no puede activar la tienda transferida");
  const again = await call("POST", "transfer-accept", { as: B, body: { t: tokB } });
  ok(again.status === 409 && again.code === "accepted", "el mismo link no se puede usar dos veces");
  const infoAfter = await call("GET", "transfer-info", { query: { t: tokB } });
  ok(infoAfter.status === 200 && infoAfter.body.status === "accepted", `info del link usado → accepted (${infoAfter.body.status})`);
}

// ─── 6. Vuelve a su login original (queda el que la tenía como miembro) ─
section("Transferir de vuelta al login original (keep_access = true)");
{
  const s = await call("POST", "transfer-start", { as: B, body: { merchant_id: "uidA", email: "ana@x.com", keep_access: true }, headers: { "x-merchant-id": "uidA" } });
  ok(s.status === 200, `el dueño nuevo la puede transferir (${s.status} ${s.error || ""})`);
  const tok = tokenFromMail(lastMailTo("ana@x.com"));
  const r = await call("POST", "transfer-accept", { as: A, body: { t: tok } });
  ok(r.status === 200, `Ana acepta (${r.status} ${r.error || ""})`);
  const d = await doc("merchants/uidA");
  ok(d.ownerUid === "uidA" && d.is_store === false, "vuelve a ser su principal");
  ok(d.teamMembers.uidB?.role === "member" && Object.keys(d.teamMembers.uidB.secciones).length === 9 && Object.values(d.teamMembers.uidB.secciones).every(v => v === true), "el que la entrega queda como miembro con TODAS las secciones");
  ok(d.teamUids.includes("uidB") && d.teamUids.includes("uidM") && d.teamUids.includes("uidA"), "teamUids con los dos + la miembro");
  ok(d.active_merchant_id === "m_extra" && Array.isArray(d.stores) && d.stores.some(x => x.id === "m_extra"), "recupera su tienda activa y cache desde profiles");
  ok((await doc("profiles/uidA")).primary_transferred === undefined, "profiles: se limpia la marca de transferida");
  const meA = await call("GET", undefined, { as: A });
  ok(meA.status === 200 && meA.merchant.role === "owner" && meA.merchant.is_primary === true, "Ana sin header → dueña de su principal otra vez");
  const meB = await call("GET", undefined, { as: B, headers: { "x-merchant-id": "uidA" } });
  ok(meB.status === 200 && meB.merchant.role === "member", "Bruno quedó como miembro");
  const tB = await call("POST", "transfer-start", { as: B, body: { merchant_id: "uidA", email: "carla@x.com" } });
  ok(tB.status === 403, "un miembro no puede transferir");
  const wsA = await call("GET", "workspace", { as: A });
  ok(wsA.stores[0].id === "uidA" && wsA.stores[0].is_self && wsA.primary_transferred === null, "workspace: vuelve a figurar como su tienda principal");
}

// ─── 7. Rechazar ─────────────────────────────────────────────────────────
section("Rechazar");
{
  const s = await call("POST", "transfer-start", { as: A, body: { merchant_id: "m_extra", email: "carla@x.com" } });
  ok(s.status === 200, "inicia m_extra → Carla");
  const tok = tokenFromMail(lastMailTo("carla@x.com"));
  const wrong = await call("POST", "transfer-decline", { as: B, body: { t: tok } });
  ok(wrong.status === 403 && wrong.code === "email_mismatch", "otro email no puede rechazar");
  const r = await call("POST", "transfer-decline", { as: C, body: { t: tok } });
  ok(r.status === 200, "Carla rechaza");
  const d = await doc("merchants/m_extra");
  ok(d.ownerUid === "uidA" && d.transfer_pending === undefined, "sigue siendo de Ana, sin pendiente");
  ok(/Rechazaron/.test(lastMailTo("ana@x.com").subject), "aviso por mail al dueño");
  const acc = await call("POST", "transfer-accept", { as: C, body: { t: tok } });
  ok(acc.status === 409 && acc.code === "declined", "no se puede aceptar después de rechazar");
}

// ─── 8. Cancelar ─────────────────────────────────────────────────────────
section("Cancelar");
{
  const s = await call("POST", "transfer-start", { as: A, body: { merchant_id: "m_extra", email: "carla@x.com" } });
  const tok = tokenFromMail(lastMailTo("carla@x.com"));
  ok(s.status === 200 && !!tok, "inicia otra vez");
  const cNo = await call("POST", "transfer-cancel", { as: C, body: { merchant_id: "m_extra" } });
  ok(cNo.status === 403, "solo el dueño cancela");
  const c = await call("POST", "transfer-cancel", { as: A, body: { merchant_id: "m_extra" } });
  ok(c.status === 200 && (await doc("merchants/m_extra")).transfer_pending === undefined, "el dueño cancela");
  const info = await call("GET", "transfer-info", { as: C, query: { t: tok } });
  ok(info.status === 200 && info.body.status === "cancelled" && info.store_name === "Extra", `info de una cancelada → cancelled (${info.body.status})`);
  const acc = await call("POST", "transfer-accept", { as: C, body: { t: tok } });
  ok(acc.status === 409 && acc.code === "cancelled", `aceptar una cancelada → 409 (${acc.code})`);
  const c2 = await call("POST", "transfer-cancel", { as: A, body: { merchant_id: "m_extra" } });
  ok(c2.status === 404, "cancelar sin pendiente → 404");
}

// ─── 9. Vencida ──────────────────────────────────────────────────────────
section("Vencida");
{
  const s = await call("POST", "transfer-start", { as: A, body: { merchant_id: "m_extra", email: "carla@x.com" } });
  const tok = tokenFromMail(lastMailTo("carla@x.com"));
  ok(s.status === 200, "inicia");
  const past = "2020-01-01T00:00:00.000Z";
  const pend = (await doc("merchants/m_extra")).transfer_pending;
  await M("m_extra").update({ transfer_pending: { ...pend, expires_at: past } });
  await db().collection("store_transfers").doc(pend.id).update({ expires_at: past });
  const info = await call("GET", "transfer-info", { as: C, query: { t: tok } });
  ok(info.status === 200 && info.body.status === "expired", `info de una vencida → expired (${info.body.status})`);
  const acc = await call("POST", "transfer-accept", { as: C, body: { t: tok } });
  ok(acc.status === 410 && acc.code === "expired", "aceptar vencida → 410");
  const ws = await call("GET", "workspace", { as: A });
  ok(ws.stores.find(x => x.id === "m_extra")?.transfer_pending?.expired === true, "el dueño la ve vencida");
  const s2 = await call("POST", "transfer-start", { as: A, body: { merchant_id: "m_extra", email: "carla@x.com", keep_access: true } });
  ok(s2.status === 200, "una vencida no bloquea iniciar otra");
  ok((await doc("store_transfers/" + pend.id)).status === "expired", "la vieja queda marcada expired");
}

// ─── 10. Tienda extra con keep_access: el anterior queda como miembro ──
section("Tienda extra (m_) con keep_access");
{
  const tok = tokenFromMail(lastMailTo("carla@x.com"));
  const r = await call("POST", "transfer-accept", { as: C, body: { t: tok } });
  ok(r.status === 200, `Carla acepta m_extra (${r.status} ${r.error || ""})`);
  const d = await doc("merchants/m_extra");
  ok(d.ownerUid === "uidC" && d.teamMembers.uidC.role === "owner" && d.teamMembers.uidA.role === "member", "Carla dueña, Ana miembro");
  const meA = await call("GET", undefined, { as: A, headers: { "x-merchant-id": "m_extra" } });
  ok(meA.status === 200 && meA.merchant.role === "member", "Ana entra como miembro");
  const wsA = await call("GET", "workspace", { as: A });
  ok(wsA.stores.find(x => x.id === "m_extra")?.role === "member" && wsA.stores.find(x => x.id === "m_extra")?.can_transfer === false, "workspace de Ana: m_extra como miembro, sin transferir");
  const wsC = await call("GET", "workspace", { as: C });
  ok(wsC.stores.find(x => x.id === "m_extra")?.role === "owner", "workspace de Carla: m_extra como dueña");
  const del = await call("POST", "store-delete", { as: A, body: { merchant_id: "m_extra" } });
  ok(del.status === 403, "Ana ya no puede eliminarla");
}

// ─── 11. Principal transferida, el anterior se queda como miembro ────────
section("Principal con keep_access (el anterior entra sin header como miembro)");
{
  const s = await call("POST", "transfer-start", { as: A, body: { merchant_id: "uidA", email: "carla@x.com", keep_access: true } });
  ok(s.status === 200, "inicia uidA → Carla, Ana se queda");
  const tok = tokenFromMail(lastMailTo("carla@x.com"));
  const r = await call("POST", "transfer-accept", { as: C, body: { t: tok } });
  ok(r.status === 200, "Carla acepta");
  const meA = await call("GET", undefined, { as: A });
  ok(meA.status === 200 && meA.merchant.id === "uidA" && meA.merchant.role === "member", `Ana sin header → su ex principal como miembro (${meA.status} ${meA.error || ""})`);
  const wsA = await call("GET", "workspace", { as: A });
  ok(wsA.stores.some(x => x.id === "uidA" && x.role === "member"), "workspace: la ve como miembro");
  const rn = await call("POST", "store-rename", { as: A, body: { merchant_id: "uidA", name: "X" } });
  ok(rn.status === 403, "como miembro no la renombra");
}

// ─── 12. Rate limit ──────────────────────────────────────────────────────
section("Rate limit de transfer-start");
{
  await M("uidD").set({ email: "dani@x.com", plan: "free", created_at: "2026-08-01T00:00:00.000Z" });
  const D = login("uidD", "dani@x.com");
  let limited = 0, okCount = 0;
  for (let i = 0; i < 12; i++) {
    const r = await call("POST", "transfer-start", { as: D, body: { merchant_id: "uidD", email: `x${i}@x.com` } });
    if (r.status === 429) limited++; else if (r.status === 200) okCount++;
    await call("POST", "transfer-cancel", { as: D, body: { merchant_id: "uidD" } });
  }
  ok(okCount === 10 && limited === 2, `10 por día y después 429 (${okCount} ok, ${limited} limitadas)`);
}

// ─── 13. Lumina sigue intacta ────────────────────────────────────────────
section("Lumina al final");
{
  clearMerchantCache("uidL");
  const me = await call("GET", undefined, { as: L });
  ok(me.status === 200 && me.merchant.role === "owner" && me.merchant.is_primary === true, "Lumina sigue entrando igual");
  ok(JSON.stringify(sansCache(await doc("merchants/uidL"))) === JSON.stringify(LUMINA_BEFORE), "doc de Lumina idéntico");
  ok(!(await doc("profiles/uidL")), "Lumina no tiene profiles/");
}

console.log(`\n${passes} ok · ${fails} fallas`);
process.exit(fails ? 1 : 0);
