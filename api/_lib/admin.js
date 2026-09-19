// Panel de super-admin de Recurrentes (#/admin) — para Thiago y quien esté en
// ADMIN_EMAILS. Vive en GET/POST /api/stats?action=admin-* (sin función
// serverless nueva). CADA request pasa por requireAdmin (_lib/firebase.js):
// token de Firebase verificado + email en ADMIN_EMAILS + email_verified === true.
// Nada de esto toca el camino del cobro (webhook / sync / widget / checkout).
//
//   GET  ?action=admin-overview[&fresh=1]
//   GET  ?action=admin-merchants&q=&filter=todos|pagan|free|beta|activar|sin_conectar
//                               &sort=recientes|mrr|subs|actividad&page=1&limit=25[&fresh=1]
//   GET  ?action=admin-merchant&id=<merchantId>
//   POST ?action=admin-set-plan { merchant_id, plan: "starter"|"growth"|"scale"|"pro"|"unlimited"|"beta"|"none" }
//   POST ?action=admin-note     { merchant_id, text }
//   POST ?action=admin-view-as  { merchant_id }  → registra el inicio del "ver como". El header
//        X-Admin-As lo valida requireMerchant en cada request (solo admins, solo lectura).
//
// Datos (todo lo interno queda FUERA de merchants/*, porque el comercio puede
// leer su propio doc y subcolecciones con el SDK web; las rules cierran el resto):
//   admin_audit/{auto}          { action, merchant_id, admin_uid, admin_email, detail, at }
//   admin_merchants/{mid}       { notes: [{ id, text, at, by }], updated_at }
//   admin_cache/merchant_stats  { at, stats: { [mid]: { subs, active, mrr, ch30_count,
//                                 ch30_amount, ch_days:{YYYY-MM-DD: ARS}, last_charge_at, at } } }
// En merchants/{mid} solo se escribe el plan (plan_activated / plan), lo mismo
// que antes se hacía a mano desde la consola.
//
// COSTO (lecturas de Firestore):
//   · Resumen / lista: 1 lectura por comercio (merchants con select(): solo los
//     campos que se muestran, no los caches ni settings pesados) + 1 del cache de
//     números. Todo queda 60 s en memoria de la instancia caliente.
//   · Números por comercio (suscriptores, MRR, cobros 30 d) cacheados 6 h en
//     admin_cache. Por request se recalculan como mucho STALE_BATCH comercios
//     (los más viejos): count() de suscriptores que facturan (1 lectura cada
//     1.000) + suscriptores ACTIVOS con select() (1 por activa, para el MRR) +
//     cobros de 30 días con select() (1 por cobro) + 1 si no hubo cobros.
//     NUNCA se leen todos los suscriptores de todos los comercios en cada request.
//   · Ficha: su doc + recálculo de sus números + notas + registro (≤ 300).
import { getAuth } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { db, requireAdmin } from "./firebase.js";
import { acquisitionSummary, ownPixel } from "./acquisition.js";
import { merchantProfile, CHANNELS, PAYMENT_PROVIDERS, BUSINESS_TYPES } from "../../shared/platform/profile.js";
import { PRICING_TIERS, TIER_BY_ID, BILLABLE_STATUSES, tierRank } from "../../shared/platform/pricing.js";
import { buildBilling, activatedTierId, isBeta, isInternal, PLAN_BY_ID } from "./plans_saas.js";
import { adminEmails } from "./adminAuth.js";
import { klaviyoEnabled } from "./klaviyo.js";
import { waUsageMonth } from "../../shared/platform/whatsapp.js";

// WhatsApp del número de Recurrentes: lo que hay que cobrarle a cada comercio este mes.
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const waOf = (data, id) => { const x = data?.wa?.merchants?.[id] || {}; return { wa_sent: Number(x.wa_sent) || 0, wa_cost_usd: r6(x.wa_cost_usd) }; };
const waTotals = (data) => {
  const w = data?.wa || {};
  return { month: w.month || waUsageMonth(), sent: Number(w.wa_sent) || 0, cost_usd: r6(w.wa_cost_usd), meta_cost_usd: r6(w.wa_meta_cost_usd), merchants: Object.keys(w.merchants || {}).length };
};

const DAY_MS = 86400000;
const AR_OFFSET_MS = 3 * 3600 * 1000;
const STATS_TTL_MS = 6 * 3600 * 1000;
const STALE_BATCH = 20;
const FRESH_BATCH = 60;
const LIST_CACHE_MS = 60 * 1000;
const MAX_NOTE = 2000;

const statsRef = () => db().collection("admin_cache").doc("merchant_stats");

// Campos del doc del comercio que usa el panel. Los tokens se leen solo para
// saber si está conectado: nunca salen en la respuesta.
const LIST_FIELDS = [
  "email", "store_name", "shop_name", "shopify_shop", "owner_name", "owner_whatsapp", "contact_email",
  "created_at", "is_store", "ownerUid", "deleted", "teamUids", "archived_at", "internal", "ownerEmail",
  "plan", "plan_activated", "plan_activated_at", "plan_requested", "plan_requested_at",
  "billing_cache", "business_type", "channel", "payment_provider",
  "shopify_token", "mp_access_token", "mp_email", "klaviyo_api_key", "flows_enabled", "flows_active_triggers",
  "dev_mode", "analytics_cache.data.mrr",
  "acquisition", // de qué anuncio vino + pasos (registro → tienda → plan → pago), _lib/acquisition.js
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const arDay = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t - AR_OFFSET_MS).toISOString().slice(0, 10) : ""; };
function dayKeys(n, nowMs) { const out = []; for (let i = n - 1; i >= 0; i--) out.push(arDay(new Date(nowMs - i * DAY_MS).toISOString())); return out; }
const maxIso = (...xs) => xs.filter(Boolean).sort().pop() || null;
const toIso = (s) => { const t = Date.parse(s || ""); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const sum = (a) => a.reduce((t, n) => t + (Number(n) || 0), 0);
const cleanId = (v) => { const s = String(v || "").trim(); return s && s.length <= 128 && !/[\/.~*\[\]`]/.test(s) ? s : ""; };

// wa.me necesita el número internacional sin signos. Números argentinos de 10
// dígitos (11 5555-5555) → 549…; 54 sin el 9 de celular → 549….
export function whatsappUrl(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "549" + d;
  if (d.length === 12 && d.startsWith("54") && d[2] !== "9") d = "549" + d.slice(2);
  return d.length >= 10 && d.length <= 15 ? `https://wa.me/${d}` : null;
}

const storeName = (m) => m.store_name || m.shop_name || (m.shopify_shop ? String(m.shopify_shop).replace(/\.myshopify\.com$/, "") : "") || m.owner_name || m.email || m.id;

const connections = (m) => ({
  shopify: !!m.shopify_token,
  shopify_shop: m.shopify_shop || null,
  mp: !!m.mp_access_token,
  klaviyo: klaviyoEnabled(m),
  flows: m.flows_enabled === true || (Array.isArray(m.flows_active_triggers) && m.flows_active_triggers.length > 0),
});

// Mismo criterio que stats.js (Inicio / Analíticas del comercio).
const perChargeOf = (s) => { const qty = s.quantity || s.plan_snapshot?.units_per_shipment || 1; return s.plan_snapshot?.total_per_charge_ars || ((s.plan_snapshot?.subscription_price_ars || 0) * qty); };
const mrrOfSub = (s) => perChargeOf(s) * (30 / (s.plan_snapshot?.frequency_days || 30));
const isSimCharge = (id, c) => c.simulated === true || String(c.mp_payment_id || "").startsWith("SIM-") || /-SIM$/.test(String(id));
const chargeOk = (id, c) => !c.error && (!c.status || c.status === "approved") && !isSimCharge(id, c);

// Números de UN comercio (ver "COSTO" arriba).
export async function computeMerchantStats(mid, nowMs = Date.now(), prev = null) {
  const ref = db().collection("merchants").doc(mid);
  const cutoff = new Date(nowMs - 30 * DAY_MS).toISOString();
  const [billAgg, activeSnap, chSnap] = await Promise.all([
    ref.collection("subscribers").where("status", "in", BILLABLE_STATUSES).count().get(),
    ref.collection("subscribers").where("status", "==", "active")
      .select("quantity", "plan_snapshot.total_per_charge_ars", "plan_snapshot.subscription_price_ars", "plan_snapshot.units_per_shipment", "plan_snapshot.frequency_days").get(),
    ref.collection("charges").where("created_at", ">=", cutoff).orderBy("created_at", "desc").limit(5000)
      .select("amount_ars", "status", "error", "simulated", "mp_payment_id", "created_at").get(),
  ]);
  let mrr = 0;
  for (const d of activeSnap.docs) mrr += mrrOfSub(d.data() || {});
  let count = 0, amount = 0, last = null;
  const days = {};
  for (const d of chSnap.docs) {
    const c = d.data() || {};
    if (c.created_at && (!last || c.created_at > last)) last = c.created_at;
    if (!chargeOk(d.id, c)) continue;
    const amt = Number(c.amount_ars) || 0;
    count++; amount += amt;
    const k = arDay(c.created_at);
    if (k) days[k] = Math.round((days[k] || 0) + amt);
  }
  if (!last) {
    const lastSnap = await ref.collection("charges").orderBy("created_at", "desc").limit(1).select("created_at").get();
    last = lastSnap.docs[0]?.data()?.created_at || prev?.last_charge_at || null;
  }
  return {
    subs: Number(billAgg.data().count) || 0,
    active: activeSnap.docs.length,
    mrr: Math.round(mrr),
    ch30_count: count,
    ch30_amount: Math.round(amount),
    ch_days: days,
    last_charge_at: last,
    at: new Date(nowMs).toISOString(),
  };
}

// Pisa stats.<mid> entero (update con field path: ch_days viejos no quedan colgados).
async function saveStats(byId) {
  const ids = Object.keys(byId);
  if (!ids.length) return;
  const at = new Date().toISOString();
  const upd = { at };
  for (const id of ids) upd[`stats.${id}`] = byId[id];
  try { await statsRef().update(upd); }
  catch (_) { await statsRef().set({ at, stats: byId }, { merge: true }); } // primera vez: el doc no existe
}

// ─── Carga de todos los comercios (+ recálculo acotado) ─────────────────────
let _cache = null; // { at, merchants, stats, pending }
export function __resetAdminCache() { _cache = null; }

async function loadAll({ fresh = false, nowMs = Date.now() } = {}) {
  if (!fresh && _cache && nowMs - _cache.at < LIST_CACHE_MS) return _cache;
  const [mSnap, cSnap, waSnap] = await Promise.all([
    db().collection("merchants").select(...LIST_FIELDS).get(),
    statsRef().get(),
    // WhatsApp desde el número de Recurrentes: uso del mes (1 doc, lo escribe _lib/whatsapp.js).
    db().collection("admin_usage").doc(waUsageMonth(new Date(nowMs))).get().catch(() => null),
  ]);
  const merchants = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const stats = { ...((cSnap.exists && cSnap.data()?.stats) || {}) };
  const age = (id) => nowMs - (Date.parse(stats[id]?.at || "") || 0);
  const stale = merchants
    .filter(m => m.deleted !== true && cleanId(m.id) && (!stats[m.id] || age(m.id) > STATS_TTL_MS))
    .sort((a, b) => age(b.id) - age(a.id));
  const batch = stale.slice(0, fresh ? FRESH_BATCH : STALE_BATCH);
  const updated = {};
  for (let i = 0; i < batch.length; i += 5) {
    const chunk = batch.slice(i, i + 5);
    const out = await Promise.all(chunk.map(m => computeMerchantStats(m.id, nowMs, stats[m.id]).catch(e => { console.warn("[admin] stats", m.id, e.message); return null; })));
    chunk.forEach((m, k) => { if (out[k]) { stats[m.id] = out[k]; updated[m.id] = out[k]; } });
  }
  try { await saveStats(updated); } catch (e) { console.warn("[admin] cache:", e.message); }
  const wa = (waSnap?.exists && waSnap.data()) || {};
  _cache = { at: nowMs, merchants, stats, pending: Math.max(0, stale.length - Object.keys(updated).length), wa: { month: waUsageMonth(new Date(nowMs)), ...wa } };
  return _cache;
}

const ownerEmailMap = (merchants) => Object.fromEntries(merchants.filter(m => m.email).map(m => [m.id, m.email]));

// Primer fecha ≥ hoy en pasos de 30 días desde la activación del plan.
function nextSaasPaymentAt(activatedAt) {
  const t0 = Date.parse(activatedAt || "");
  if (!t0) return null;
  const step = 30 * 86400000, now = Date.now();
  const k = Math.max(1, Math.ceil((now - t0) / step));
  return new Date(t0 + k * step).toISOString();
}

// Fila de la tabla / base de la ficha. Sin tokens ni datos sensibles.
function rowOf(m, s, ownerEmails = {}) {
  const prof = merchantProfile(m);
  const subs = s ? s.subs : (Number(m.billing_cache?.subs) || 0);
  const billing = buildBilling(m, subs);
  const panelAt = m.billing_cache?.at || null; // se renueva cuando el comercio abre su panel (cache de 5 min)
  const lastCharge = s?.last_charge_at || null;
  return {
    id: m.id,
    name: storeName(m),
    // Tienda propia (Lumina, demos): gratis siempre y fuera de los números del negocio.
    internal: isInternal(m, adminEmails()),
    owner_name: m.owner_name || "",
    owner_whatsapp: m.owner_whatsapp || "",
    whatsapp_url: whatsappUrl(m.owner_whatsapp),
    contact_email: m.contact_email || "",
    email: m.email || ownerEmails[m.ownerUid] || null,
    owner_uid: m.ownerUid || m.id,
    is_store: m.is_store === true,
    created_at: m.created_at || null,
    business_type: prof.businessType,
    channel: prof.channel,
    payment_provider: prof.paymentProvider,
    profile_explicit: prof.explicit,
    ready: prof.ready,
    missing: prof.missing,
    connections: connections(m),
    subs,
    active: s ? s.active : null,
    mrr: s ? s.mrr : (Number(m.analytics_cache?.data?.mrr) || 0),
    ch30_count: s ? s.ch30_count : null,
    ch30_amount: s ? s.ch30_amount : null,
    stats_at: s?.at || null,
    plan: billing.plan,
    plan_label: billing.plan_label,
    tier: billing.tier,
    beta: billing.plan === "beta",
    plan_activated: activatedTierId(m),
    plan_activated_at: m.plan_activated_at || null,
    tier_usd: billing.plan_usd,
    tier_label: billing.plan_label,
    // Próximo pago a Recurrentes: cada 30 días desde el PRIMER pago (la activación
    // del plan), no desde el alta gratis. Null si nunca activó (free/beta o pendiente).
    next_saas_payment_at: nextSaasPaymentAt(m.plan_activated_at),
    needs_activation: billing.needs_activation,
    plan_requested: billing.plan_requested,
    plan_requested_at: billing.plan_requested_at,
    panel_seen_at: panelAt,
    last_charge_at: lastCharge,
    last_activity_at: maxIso(panelAt, lastCharge),
    dev_mode: m.dev_mode === true,
    mp_email: m.mp_email || null,
  };
}

// Firebase Auth: email de login, verificado y último acceso (sin costo de Firestore).
function authInfo(u) {
  return {
    email: u.email || null,
    email_verified: u.emailVerified === true,
    disabled: u.disabled === true,
    created_at: toIso(u.metadata?.creationTime),
    last_login_at: toIso(u.metadata?.lastSignInTime),
    last_seen_at: toIso(u.metadata?.lastRefreshTime) || toIso(u.metadata?.lastSignInTime),
    providers: (u.providerData || []).map(p => p.providerId).filter(Boolean),
  };
}
async function authUsers(uids) {
  const out = {};
  const ids = [...new Set(uids.filter(Boolean))].slice(0, 100);
  if (!ids.length) return out;
  try {
    const r = await getAuth().getUsers(ids.map(uid => ({ uid })));
    for (const u of r.users || []) out[u.uid] = authInfo(u);
  } catch (e) { console.warn("[admin] getUsers:", e.message); }
  return out;
}
function withAuth(row, a) {
  if (!a) return row;
  return { ...row, login_email: a.email, email_verified: a.email_verified, last_login_at: a.last_login_at, last_seen_at: a.last_seen_at, last_activity_at: maxIso(row.last_activity_at, a.last_seen_at) };
}

// ─── Filtros y orden de la lista ─────────────────────────────────────────────
export const FILTERS = {
  todos: () => true,
  pagan: r => !r.beta && !!r.plan_activated,
  free: r => !r.beta && !r.plan_activated,
  beta: r => r.beta,
  activar: r => r.needs_activation,
  sin_conectar: r => !r.ready,
};
const SORTS = {
  recientes: (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")),
  mrr: (a, b) => (b.mrr || 0) - (a.mrr || 0),
  subs: (a, b) => (b.subs || 0) - (a.subs || 0),
  actividad: (a, b) => String(b.last_activity_at || "").localeCompare(String(a.last_activity_at || "")),
};
function matches(r, needle) {
  const hay = [r.name, r.owner_name, r.email, r.contact_email, r.connections.shopify_shop, r.id].filter(Boolean).join(" ").toLowerCase();
  if (hay.includes(needle)) return true;
  const digits = needle.replace(/\D/g, "");
  return digits.length >= 4 && String(r.owner_whatsapp || "").replace(/\D/g, "").includes(digits);
}
// Vivas = no borradas y no archivadas. Una archivada (INDATROPIC) sigue cobrando en
// MP pero Recurrentes la ignora: no es un comercio del negocio.
const liveRows = (data) => {
  const owners = ownerEmailMap(data.merchants);
  const mails = adminEmails();
  return data.merchants
    .filter(m => m.deleted !== true && !m.archived_at)
    .map(m => {
      // El mail del dueño puede vivir en el doc del login, no en la tienda extra.
      const withOwner = m.email || m.ownerEmail ? m : { ...m, ownerEmail: owners[m.ownerUid] || null };
      return { ...rowOf(m, data.stats[m.id], owners), internal: isInternal(withOwner, mails) };
    });
};
// Comercios del negocio: sin las tiendas internas (las mías).
const clientRows = (data) => liveRows(data).filter(r => !r.internal);

// ─── GET admin-overview ──────────────────────────────────────────────────────
async function overview(query) {
  const nowMs = Date.now();
  const data = await loadAll({ fresh: query.fresh === "1", nowMs });
  // Tiendas archivadas (ej. INDATROPIC: sigue cobrando en MP pero Recurrentes la
  // ignora) no cuentan en ningún agregado: inflaban "suscripciones activas" y el
  // MRR total con números de una tienda muerta.
  const allRows = liveRows(data);
  // Los agregados (comercios, MRR, suscripciones, MRR del SaaS) miran SOLO comercios
  // de clientes: las tiendas internas (las mías) quedan fuera para no inflar nada.
  const rows = allRows.filter(r => !r.internal);
  const internalRows = allRows.filter(r => r.internal);
  const internalIds = new Set(internalRows.map(r => r.id));
  // Altas por día siguen contando logins (una tienda extra no es un alta nueva).
  const accounts = data.merchants.filter(m => m.deleted !== true && m.is_store !== true && !m.archived_at && !internalIds.has(m.id));

  // Altas por día (hora AR, 90 días). Solo logins: las tiendas extra no son altas.
  const keys = dayKeys(90, nowMs);
  const pos = new Map(keys.map((k, i) => [k, i]));
  const perDay = keys.map(() => 0);
  let before = 0;
  for (const m of accounts) {
    const k = arDay(m.created_at);
    if (pos.has(k)) perDay[pos.get(k)]++;
    else if (!k || k < keys[0]) before++;
  }
  const cumulative = [];
  let run = before;
  for (const n of perDay) { run += n; cumulative.push(run); }

  // Cobros de 30 días (aprobados, sin simulados), sumados del cache por comercio.
  const keys30 = keys.slice(-30);
  const pos30 = new Map(keys30.map((k, i) => [k, i]));
  const amounts = keys30.map(() => 0);
  let chCount = 0, chAmount = 0;
  for (const r of rows) {
    const s = data.stats[r.id];
    if (!s) continue;
    chCount += s.ch30_count || 0;
    chAmount += s.ch30_amount || 0;
    for (const [k, v] of Object.entries(s.ch_days || {})) if (pos30.has(k)) amounts[pos30.get(k)] += Number(v) || 0;
  }

  const dist = (key, catalog) => {
    const acc = {};
    for (const r of rows) acc[r[key]] = (acc[r[key]] || 0) + 1;
    return Object.entries(acc).map(([id, count]) => ({ id, label: catalog[id]?.label || id, count })).sort((a, b) => b.count - a.count);
  };
  const byTier = [
    { id: "beta", label: "Beta (sin cargo)", usd: 0, count: rows.filter(r => r.beta).length, activated: 0 },
    ...PRICING_TIERS.map(t => ({
      id: t.id, label: t.usd ? `${t.label} · US$ ${t.usd}` : t.label, usd: t.usd,
      count: rows.filter(r => !r.beta && r.tier === t.id).length,
      activated: rows.filter(r => !r.beta && r.plan_activated === t.id).length,
    })),
  ].filter(x => x.count > 0 || x.activated > 0);
  const paying = rows.filter(r => !r.beta && r.plan_activated);

  return {
    generated_at: new Date(nowMs).toISOString(),
    merchants: {
      total: rows.length,
      // Lo que se muestra como "Comercios": cada tienda viva es un comercio (Lumina es
      // tienda extra de un login cuyo doc principal está archivado; contarla es lo correcto).
      accounts: rows.length,
      stores_extra: rows.length - accounts.length,
      deleted: data.merchants.length - rows.length,
      new_30d: sum(perDay.slice(-30)),
      new_prev_30d: sum(perDay.slice(-60, -30)),
    },
    signups: { dates: keys, counts: perDay, cumulative },
    subs: {
      active: sum(rows.map(r => r.subs)),
      mrr: Math.round(sum(rows.map(r => r.mrr))),
      merchants_with_subs: rows.filter(r => r.subs > 0).length,
    },
    charges_30d: { count: chCount, amount: Math.round(chAmount), dates: keys30, amounts: amounts.map(Math.round) },
    by_channel: dist("channel", CHANNELS),
    by_provider: dist("payment_provider", PAYMENT_PROVIDERS),
    by_business_type: dist("business_type", BUSINESS_TYPES),
    by_tier: byTier,
    whatsapp: waTotals(data),
    // Adquisición (Meta Ads propio): registros → conectaron → plan → pagan, por anuncio.
    acquisition: (() => {
      const usdById = Object.fromEntries(paying.map(r => [r.id, TIER_BY_ID[r.plan_activated]?.usd || 0]));
      return { pixel: !!ownPixel(), d30: acquisitionSummary(accounts, usdById, { days: 30, nowMs }), d90: acquisitionSummary(accounts, usdById, { days: 90, nowMs }), all: acquisitionSummary(accounts, usdById, { days: null, nowMs }) };
    })(),
    // Mis tiendas, aparte: para verlas sin que ensucien los números del negocio.
    internal: { count: internalRows.length, subs: sum(internalRows.map(r => r.subs)), mrr: Math.round(sum(internalRows.map(r => r.mrr))), names: internalRows.map(r => r.name) },
    saas: { paying: paying.length, usd_month: sum(paying.map(r => TIER_BY_ID[r.plan_activated]?.usd || 0)), beta: rows.filter(r => r.beta).length },
    needs_activation: rows.filter(r => r.needs_activation).sort((a, b) => b.subs - a.subs).map(r => ({
      id: r.id, name: r.name, tier: r.tier, tier_label: TIER_BY_ID[r.tier]?.label || r.tier, tier_usd: TIER_BY_ID[r.tier]?.usd || 0,
      subs: r.subs, plan_requested: r.plan_requested, plan_requested_at: r.plan_requested_at,
      whatsapp_url: r.whatsapp_url, email: r.contact_email || r.email,
    })),
    stats_pending: data.pending,
  };
}

// ─── GET admin-merchants (paginado, con búsqueda) ────────────────────────────
async function merchantsList(query) {
  const data = await loadAll({ fresh: query.fresh === "1" });
  // Por defecto la tabla muestra comercios de clientes. `?internal=1` trae las mías.
  let rows = query.internal === "1" ? liveRows(data).filter(r => r.internal) : clientRows(data);
  const counts = Object.fromEntries(Object.entries(FILTERS).map(([k, fn]) => [k, rows.filter(fn).length]));
  const filter = FILTERS[query.filter] ? query.filter : "todos";
  const sort = SORTS[query.sort] ? query.sort : "recientes";
  const needle = String(query.q || "").trim().toLowerCase().slice(0, 100);
  rows = rows.filter(FILTERS[filter]);
  if (needle) rows = rows.filter(r => matches(r, needle));
  rows.sort(SORTS[sort]);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 25));
  const pages = Math.max(1, Math.ceil(rows.length / limit));
  const page = Math.min(pages, Math.max(1, parseInt(query.page) || 1));
  const slice = rows.slice((page - 1) * limit, page * limit);
  const auth = await authUsers(slice.map(r => r.owner_uid));
  return {
    rows: slice.map(r => ({ ...withAuth(r, auth[r.owner_uid]), ...waOf(data, r.id) })),
    whatsapp: waTotals(data),
    total: rows.length, page, pages, limit, filter, sort, counts,
    stats_pending: data.pending,
    generated_at: new Date(data.at).toISOString(),
  };
}

// ─── GET admin-merchant (ficha) ──────────────────────────────────────────────
async function merchantDetail(req, res) {
  const id = cleanId(req.query?.id);
  if (!id) return res.status(400).json({ error: "Falta el id del comercio." });
  const ref = db().collection("merchants").doc(id);
  const [snap, cacheSnap, notesSnap, auditSnap] = await Promise.all([
    ref.get(),
    statsRef().get(),
    db().collection("admin_merchants").doc(id).get(),
    db().collection("admin_audit").where("merchant_id", "==", id).limit(300).get(),
  ]);
  if (!snap.exists) return res.status(404).json({ error: "Ese comercio no existe." });
  const m = { id, ...snap.data() };
  let stats = (cacheSnap.exists && cacheSnap.data()?.stats?.[id]) || null;
  try {
    const fresh = await computeMerchantStats(id, Date.now(), stats);
    stats = fresh;
    await saveStats({ [id]: fresh });
    if (_cache) _cache.stats[id] = fresh;
  } catch (e) { console.warn("[admin] stats", id, e.message); }
  const ownerUid = m.ownerUid || id;
  const auth = (await authUsers([ownerUid]))[ownerUid] || null;
  const row = withAuth(rowOf(m, stats), auth);
  const notes = ((notesSnap.exists && notesSnap.data()?.notes) || []).slice().sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const audit = auditSnap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => String(b.at || "").localeCompare(String(a.at || ""))).slice(0, 40);
  return res.json({
    merchant: {
      ...row,
      beta_reason: String(m.plan || "").trim().toLowerCase() === "beta" ? "manual" : (row.beta ? "fecha" : null),
      plan_raw: m.plan || null,
      plan_activated_at: m.plan_activated_at || null,
      billing: buildBilling(m, row.subs),
      shop_name: m.shop_name || null,
      shop_email: m.shop_email || null,
      store_domain: m.store_domain || null,
      shopify_connected_at: m.shopify_connected_at || null,
      mp_connected_at: m.mp_connected_at || null,
      klaviyo_connected_at: m.klaviyo_connected_at || null,
      // WhatsApp este mes (número de Recurrentes a cobrar + propio a costo 0). 1 lectura.
      whatsapp_usage: await (async () => {
        const month = waUsageMonth();
        const u = (await ref.collection("usage").doc(month).get().catch(() => null))?.data?.() || {};
        return { month, wa_sent: Number(u.wa_sent) || 0, wa_cost_usd: r6(u.wa_cost_usd), wa_platform_sent: Number(u.wa_platform_sent) || 0, wa_own_sent: Number(u.wa_own_sent) || 0, platform_enabled: m.whatsapp_platform_enabled === true };
      })(),
      team_count: Array.isArray(m.teamUids) ? m.teamUids.length : 0,
      stores: Array.isArray(m.stores) ? m.stores.map(s => ({ id: s.id, name: s.name || "" })) : [],
      requires_email_verification: m.requires_email_verification === true,
      deleted: m.deleted === true,
    },
    stats,
    auth,
    notes,
    audit,
  });
}

// ─── Acciones (POST) ─────────────────────────────────────────────────────────
async function audit(admin, action, merchantId, detail = null) {
  try {
    await db().collection("admin_audit").add({ action, merchant_id: merchantId || null, admin_uid: admin.uid, admin_email: admin.email, detail, at: new Date().toISOString() });
  } catch (e) { console.warn("[admin] audit:", e.message); }
}

async function existingMerchant(req, res) {
  const id = cleanId(req.body?.merchant_id);
  if (!id) { res.status(400).json({ error: "Falta merchant_id." }); return null; }
  const ref = db().collection("merchants").doc(id);
  const snap = await ref.get();
  if (!snap.exists) { res.status(404).json({ error: "Ese comercio no existe." }); return null; }
  return { id, ref, m: snap.data() || {} };
}

// plan: tramo pago → plan_activated (y deja de ser beta) · "beta" → plan:"beta" ·
// "none" → saca lo activado (una cuenta vieja sigue siendo beta por fecha).
async function setPlan(admin, req, res) {
  const plan = String(req.body?.plan || "").trim().toLowerCase();
  if (!PLAN_BY_ID[plan] && plan !== "beta" && plan !== "none") {
    return res.status(400).json({ error: "Plan inválido: usá beta, none o uno pago (starter, growth, scale, pro, unlimited)." });
  }
  const t = await existingMerchant(req, res);
  if (!t) return;
  const { id, ref, m } = t;
  const raw = String(m.plan || "").trim().toLowerCase();
  const now = new Date().toISOString();
  const patch = { plan_admin_updated_at: now };
  if (PLAN_BY_ID[plan]) {
    patch.plan_activated = plan;
    patch.plan_activated_at = now;
    if (raw === "beta") patch.plan = "free";
    if (m.plan_requested && tierRank(plan) >= tierRank(m.plan_requested)) {
      patch.plan_requested = FieldValue.delete();
      patch.plan_requested_at = FieldValue.delete();
    }
  } else if (plan === "beta") {
    patch.plan = "beta";
    patch.plan_activated = FieldValue.delete();
  } else {
    patch.plan_activated = FieldValue.delete();
    if (raw === "beta" || PLAN_BY_ID[raw]) patch.plan = "free";
  }
  await ref.set(patch, { merge: true });
  await audit(admin, "set_plan", id, { from: { plan: m.plan || null, plan_activated: m.plan_activated || null }, to: plan });
  _cache = null;
  const after = (await ref.get()).data() || {};
  const subs = Number(after.billing_cache?.subs) || 0;
  return res.json({ ok: true, plan, beta: isBeta(after), plan_activated: activatedTierId(after), billing: buildBilling(after, subs) });
}

async function addNote(admin, req, res) {
  const text = String(req.body?.text || "").trim().slice(0, MAX_NOTE);
  if (!text) return res.status(400).json({ error: "Escribí la nota." });
  const t = await existingMerchant(req, res);
  if (!t) return;
  const at = new Date().toISOString();
  const note = { id: `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, at, by: admin.email };
  await db().collection("admin_merchants").doc(t.id).set({ notes: FieldValue.arrayUnion(note), updated_at: at }, { merge: true });
  await audit(admin, "note", t.id, { length: text.length });
  return res.json({ ok: true, note });
}

async function viewAsStart(admin, req, res) {
  const t = await existingMerchant(req, res);
  if (!t) return;
  await audit(admin, "view_as_start", t.id, null);
  return res.json({ ok: true, merchant: { id: t.id, name: storeName({ id: t.id, ...t.m }) } });
}

// ─── Entrada (desde api/stats.js) ────────────────────────────────────────────
export async function adminHandler(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const action = String(req.query?.action || "");
  try {
    if (req.method === "GET") {
      if (action === "admin-overview") return res.json(await overview(req.query || {}));
      if (action === "admin-merchants") return res.json(await merchantsList(req.query || {}));
      if (action === "admin-merchant") return await merchantDetail(req, res);
      // Plantillas de WhatsApp de Recurrentes en Meta (estado por plantilla).
      if (action === "admin-wa-templates") return res.json(await (await import("./waTemplates.js")).listPlatformTemplates());
    } else if (req.method === "POST") {
      if (action === "admin-set-plan") return await setPlan(admin, req, res);
      // Crea en Meta las plantillas que faltan (quedan en revisión).
      if (action === "admin-wa-templates-sync") return res.json(await (await import("./waTemplates.js")).syncPlatformTemplates());
      // Registra el número de Recurrentes en la Cloud API (paso que WhatsApp Manager no hace:
      // error 133010 al enviar). PIN de 6 dígitos guardado en system/whatsapp_platform.pin,
      // hace falta el mismo si algún día hay que re-registrar. Idempotente.
      if (action === "admin-wa-register") {
        const { platformWaConfig, graphRequest, mapWaError } = await import("./whatsapp.js");
        const cfg = platformWaConfig();
        if (!cfg) return res.status(400).json({ error: "Faltan WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN en Vercel." });
        const ref = db().collection("system").doc("whatsapp_platform");
        const cur = (await ref.get()).data() || {};
        let pin = String(cur.pin || "");
        if (!/^[0-9]{6}$/.test(pin)) { pin = String(Math.floor(100000 + Math.random() * 900000)); await ref.set({ pin, pin_created_at: new Date().toISOString() }, { merge: true }); }
        // El registro en Meta tarda: dos intentos con 8 s cortaron por timeout. Hasta 45 s.
        const r = await graphRequest(`${encodeURIComponent(cfg.phone_number_id)}/register`, { token: cfg.token, method: "POST", body: { messaging_product: "whatsapp", pin }, timeoutMs: 45000 });
        if (r.ok) { await ref.set({ registered_at: new Date().toISOString(), phone_number_id: cfg.phone_number_id, last_error: null }, { merge: true }); return res.json({ ok: true, registered: true }); }
        const e = mapWaError(r.status, r.data);
        return res.status(502).json({ ok: false, error: e.error || "Meta rechazó el registro", code: r.data?.error?.code ?? null, detail: String(r.data?.error?.error_user_msg || r.data?.error?.message || "").slice(0, 300) });
      }
      // Diagnóstico: cómo tiene Meta configurado el webhook de la app (URL, campos, activo).
      // Usa el app access token (APP_ID|APP_SECRET), que solo existe en el servidor.
      if (action === "admin-wa-webhook-status") {
        const { graphVersion } = await import("./whatsapp.js");
        const appId = String(req.body?.app_id || process.env.WHATSAPP_APP_ID || "").trim();
        const secret = String(process.env.WHATSAPP_APP_SECRET || "").trim();
        if (!/^\d{5,25}$/.test(appId) || !secret) return res.status(400).json({ error: "Falta app_id o WHATSAPP_APP_SECRET." });
        const r = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(appId)}/subscriptions?access_token=${encodeURIComponent(appId + "|" + secret)}`);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return res.status(502).json({ error: String(d?.error?.message || "Meta no respondió").slice(0, 300) });
        const subs = (d.data || []).map(x => ({ object: x.object, callback_url: x.callback_url, active: x.active, fields: (x.fields || []).map(f => f.name) }));
        return res.json({ ok: true, subscriptions: subs });
      }
      // La WABA tiene que tener la app SUSCRIPTA para que Meta mande los webhooks (mensajes
      // entrantes, estados de entrega). Un número agregado desde WhatsApp Manager no lo
      // hace solo. Idempotente: si ya está, no hace nada.
      if (action === "admin-wa-subscribe") {
        const { platformWaConfig, graphRequest, mapWaError } = await import("./whatsapp.js");
        const cfg = platformWaConfig();
        if (!cfg?.waba_id) return res.status(400).json({ error: "Falta WHATSAPP_WABA_ID." });
        const g = await graphRequest(`${encodeURIComponent(cfg.waba_id)}/subscribed_apps`, { token: cfg.token });
        if (!g.ok) return res.status(502).json({ error: mapWaError(g.status, g.data).error, detail: String(g.data?.error?.message || "").slice(0, 300) });
        const before = (g.data?.data || []).map(a => a.whatsapp_business_api_data?.name || a.whatsapp_business_api_data?.id || "app");
        let subscribed = false;
        if (!before.length) {
          const r = await graphRequest(`${encodeURIComponent(cfg.waba_id)}/subscribed_apps`, { token: cfg.token, method: "POST", body: {} });
          if (!r.ok) return res.status(502).json({ error: mapWaError(r.status, r.data).error, detail: String(r.data?.error?.message || "").slice(0, 300) });
          subscribed = r.data?.success === true;
        }
        return res.json({ ok: true, was_subscribed: before.length > 0, apps_before: before, subscribed_now: subscribed });
      }
      // Perfil del número de Recurrentes en WhatsApp: foto (logo) + descripción + web.
      // La foto va por "resumable upload" de Meta: POST /{app_id}/uploads → POST /upload:{id}
      // con el binario → handle → POST /{phone_id}/whatsapp_business_profile.
      if (action === "admin-wa-profile") {
        const { platformWaConfig, graphRequest, mapWaError, graphVersion } = await import("./whatsapp.js");
        const { appBaseUrl } = await import("./config.js");
        const cfg = platformWaConfig();
        const appId = String(req.body?.app_id || process.env.WHATSAPP_APP_ID || "").trim();
        if (!cfg) return res.status(400).json({ error: "Faltan WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN." });
        if (!/^\d{5,25}$/.test(appId)) return res.status(400).json({ error: "Falta app_id (el ID de la app de Meta)." });
        const G = `https://graph.facebook.com/${graphVersion()}`;
        // 1) el logo, desde nuestro propio sitio
        const img = await fetch(`${appBaseUrl().replace(/\/$/, "")}/brand/recurrentes-512.png`);
        if (!img.ok) return res.status(502).json({ error: `No pude bajar el logo (${img.status})` });
        const buf = Buffer.from(await img.arrayBuffer());
        // 2) sesión de subida
        const up = await fetch(`${G}/${encodeURIComponent(appId)}/uploads?file_length=${buf.length}&file_type=image/png`, { method: "POST", headers: { Authorization: `Bearer ${cfg.token}` } });
        const upd = await up.json().catch(() => ({}));
        if (!up.ok || !upd.id) return res.status(502).json({ error: "Meta no abrió la subida", detail: String(upd?.error?.message || "").slice(0, 300) });
        // 3) el binario
        const fin = await fetch(`${G}/${upd.id}`, { method: "POST", headers: { Authorization: `OAuth ${cfg.token}`, file_offset: "0", "Content-Type": "image/png" }, body: buf });
        const find = await fin.json().catch(() => ({}));
        if (!fin.ok || !find.h) return res.status(502).json({ error: "Meta no aceptó la imagen", detail: String(find?.error?.message || "").slice(0, 300) });
        // 4) el perfil
        const body = {
          messaging_product: "whatsapp", profile_picture_handle: find.h,
          about: "Avisos automáticos de suscripciones",
          description: "Recurrentes: suscripciones con cobro recurrente en Mercado Pago para tiendas online de Argentina. Este número manda avisos automáticos a nombre de cada tienda.",
          websites: ["https://www.recurrentesapp.com"], vertical: "OTHER",
          ...(req.body?.email ? { email: String(req.body.email).slice(0, 128) } : {}),
        };
        const r = await graphRequest(`${encodeURIComponent(cfg.phone_number_id)}/whatsapp_business_profile`, { token: cfg.token, method: "POST", body, timeoutMs: 30000 });
        if (!r.ok) return res.status(502).json({ error: mapWaError(r.status, r.data).error || "Meta rechazó el perfil", detail: String(r.data?.error?.message || "").slice(0, 300) });
        await db().collection("system").doc("whatsapp_platform").set({ profile_set_at: new Date().toISOString() }, { merge: true });
        return res.json({ ok: true });
      }
      // Prueba del ramal admin: manda aviso_admin al WhatsApp del admin (sin dedup: clave única).
      if (action === "admin-wa-test") {
        const { notifyAdmin, adminPhones } = await import("./adminAlerts.js");
        const phones = await adminPhones();
        if (!phones.length) return res.status(400).json({ error: "No hay WhatsApp del admin: cargalo en Configuración → Avisos para vos (o env ADMIN_WHATSAPP)." });
        const r = await notifyAdmin("plan_paid", { merchantId: "prueba", store: "Prueba del ramal admin", detail: "Si leés esto, el número de Recurrentes ya te avisa a vos.", key: `test_${Date.now()}` });
        return res.json({ ok: r?.ok === true, result: r });
      }
      if (action === "admin-note") return await addNote(admin, req, res);
      if (action === "admin-view-as") return await viewAsStart(admin, req, res);
    } else {
      return res.status(405).json({ error: "Method not allowed" });
    }
    return res.status(400).json({ error: "action no reconocida" });
  } catch (e) {
    console.error("[admin]", action, e);
    return res.status(500).json({ error: e.message });
  }
}
