// Conciliación con Mercado Pago (cron `/api/cron?action=reconcile-mp`, cada hora al minuto 17).
//
// Objetivo: que Recurrentes "diga la verdad" respecto de MP. Hallazgos reales (2026-09-15):
// suscripciones activas "fantasma" (sin preapproval ni cobros), mp_preapproval_id guardado
// que apuntaba a uno cancelado mientras el real estaba autorizado, una clienta que paga
// marcada cancelada y renovaciones aprobadas en MP sin registrar.
//
// Cómo (en esta cuenta de MP la búsqueda de pagos por preapproval_id y la de preapprovals
// por external_reference devuelven vacío):
//   1) Tiendas agrupadas por mp_user_id (varias tiendas pueden cobrar con la MISMA cuenta);
//      se saltean las archivadas (`archived_at`), borradas o sin token.
//   2) Por grupo: se listan TODOS los preapprovals de la cuenta UNA vez (/preapproval/search
//      paginado) y se cruzan localmente con cada suscriptor: id guardado, external_reference
//      `mid:sid`, preapproval_plan_id (actual y _prev). Preapproval "verdadero":
//      authorized > paused > pending > cancelled, después el más nuevo.
//   3) Correcciones conservadoras (cada una en una transacción que relee el sub y aborta si
//      cambió en el medio; deja status_fixed_at / status_fix_reason + reconcile_log):
//        · id guardado equivocado → relink (solo si el verdadero tiene MEJOR estado).
//        · estado distinto: authorized → active (solo con cobros previos y nunca desde
//          payment_failed), paused → paused, cancelled → cancelled (+ cancelled_at).
//        · activa/pausada/payment_failed SIN ningún candidato, sin cobros y con > 72 h →
//          pending (solo si el listado de MP vino completo).
//   4) Renovaciones perdidas: pagos `recurring_payment` de los últimos 45 días (NUNCA los
//      pagos sueltos de la tienda); aprobado + sub conocido + sin charges/{paymentId} →
//      syncSubscriber (crea la orden con la idempotencia de siempre) y, si igual no quedó
//      registrado, linkPaymentToSubscriber (verifica pertenencia y monto). Máx 20 por corrida.
//   5) Resumen sin datos personales en system/reconcile_last (lo muestra el health / Admin).
//
// RECONCILE_DRY_RUN=1 → solo informa: no toca ningún sub ni cobro (escribe solo el resumen).
// Presupuesto de tiempo (200 s por defecto) y pedidos a MP secuenciales; ante 429 o falta de
// tiempo corta y deja el resumen como parcial.
import { db } from "./firebase.js";
import { mpSearchPreapprovals, mpSearchPayments, mpGetPreapproval, isMpAuthError } from "./mp.js";
import { syncSubscriber, linkPaymentToSubscriber } from "./sync.js";

const H = 60 * 60 * 1000;
const D = 24 * H;
export const RECONCILE_DEFAULTS = {
  budgetMs: 200 * 1000,
  maxMissedPerRun: 20,
  paymentsLookbackDays: 45,
  ghostMinAgeMs: 72 * H,
  pageSize: 100,
  maxPreapprovalPages: 50,   // 5.000 preapprovals por cuenta
  maxPaymentPages: 20,       // 2.000 cobros recurrentes en 45 días
  maxDirectGets: 50,         // GET /preapproval/{id} de ids guardados que no aparecen en el listado
};
const LIVE = new Set(["active", "paused", "payment_failed"]);
const RANK = { authorized: 4, paused: 3, pending: 2, cancelled: 1 };
const rank = (p) => RANK[p?.status] || 0;
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };
const nowIso = () => new Date().toISOString();
const isRateLimit = (e) => e?.status === 429;
const is404 = (e) => e?.status === 404;
export const isDryRun = (env = process.env) => env.RECONCILE_DRY_RUN === "1";

/** Preapproval al que apunta un pago de suscripción. */
export function paymentSubscriptionId(p) {
  return p?.point_of_interaction?.transaction_data?.subscription_id || p?.metadata?.preapproval_id || p?.preapproval_id || null;
}

/** Mejor preapproval: authorized > paused > pending > cancelled, después el más nuevo. */
export function pickTruePreapproval(cands) {
  return cands.slice().sort((a, b) => (rank(b) - rank(a)) || (ms(b.date_created) - ms(a.date_created)))[0] || null;
}

/** Estado local que corresponde al del preapproval verdadero (null = no tocar). */
export function desiredStatus(sub, pre) {
  const cur = sub.status || "pending";
  const hasCharges = !!(sub.last_charge_at || (sub.shopify_orders || []).length > 0);
  if (pre.status === "cancelled") return cur === "cancelled" ? null : "cancelled";
  if (pre.status === "paused") return cur === "paused" ? null : "paused";
  if (pre.status === "authorized") {
    // payment_failed solo lo levanta un pago aprobado nuevo (lo hace sync). Un
    // pending/cancelado/pausado sin cobros previos tampoco: authorized ≠ cobró.
    if (cur === "active" || cur === "payment_failed" || !hasCharges) return null;
    return "active";
  }
  return null;
}

// ─── MP (secuencial, con presupuesto) ─────────────────────────────────────────
async function listAllPreapprovals(token, ctx, opts) {
  const out = new Map();
  let offset = 0, complete = false;
  for (let page = 0; page < opts.maxPreapprovalPages; page++) {
    if (ctx.outOfTime()) break;
    const r = await mpSearchPreapprovals(token, { offset: String(offset), limit: String(opts.pageSize) });
    const results = r?.results || [];
    for (const p of results) if (p?.id) out.set(String(p.id), p);
    offset += results.length;
    const total = Number(r?.paging?.total);
    if (!results.length || (Number.isFinite(total) ? offset >= total : results.length < opts.pageSize)) { complete = true; break; }
  }
  return { byId: out, complete };
}

async function listRecurringPayments(token, ctx, opts) {
  const out = [];
  const begin = new Date(ctx.now - opts.paymentsLookbackDays * D).toISOString();
  const end = new Date(ctx.now + 60 * 1000).toISOString();
  let offset = 0, complete = false;
  for (let page = 0; page < opts.maxPaymentPages; page++) {
    if (ctx.outOfTime()) break;
    const r = await mpSearchPayments(token, {
      operation_type: "recurring_payment", range: "date_created", begin_date: begin, end_date: end,
      sort: "date_created", criteria: "desc", limit: String(opts.pageSize), offset: String(offset),
    });
    const results = r?.results || [];
    // Defensa: si MP ignorara el filtro, nunca procesamos pagos sueltos de la tienda.
    for (const p of results) if (p?.id && (p.operation_type == null || p.operation_type === "recurring_payment")) out.push(p);
    offset += results.length;
    const total = Number(r?.paging?.total);
    if (!results.length || (Number.isFinite(total) ? offset >= total : results.length < opts.pageSize)) { complete = true; break; }
  }
  return { payments: out, complete };
}

// ─── Grupos ──────────────────────────────────────────────────────────────────
export function groupMerchants(docs) {
  const groups = new Map();
  const skipped = [];
  for (const d of docs) {
    const m = d.data() || {};
    if (!m.mp_access_token) { skipped.push({ mid: d.id, reason: "no_token" }); continue; }
    if (m.archived_at) { skipped.push({ mid: d.id, reason: "archived" }); continue; }
    if (m.deleted === true) { skipped.push({ mid: d.id, reason: "deleted" }); continue; }
    const key = m.mp_user_id != null && m.mp_user_id !== "" ? `u:${m.mp_user_id}` : `m:${d.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: d.id, ref: d.ref, data: m });
  }
  return { groups: [...groups.values()], skipped };
}

// ─── Corrección transaccional ────────────────────────────────────────────────
// Relee el sub dentro de la transacción: si alguien (webhook, sync, panel) cambió el
// estado o el preapproval desde que lo leímos, no pisamos nada.
async function applyFix(mid, sid, before, patch, audit) {
  const subRef = db().collection("merchants").doc(mid).collection("subscribers").doc(sid);
  const logRef = db().collection("merchants").doc(mid).collection("reconcile_log").doc();
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(subRef);
    if (!snap.exists) return false;
    const cur = snap.data();
    if ((cur.status || null) !== (before.status || null) || (cur.mp_preapproval_id || null) !== (before.mp_preapproval_id || null)) return false;
    tx.update(subRef, patch);
    tx.set(logRef, { subscriber_id: sid, ...audit, at: patch.status_fixed_at });
    return true;
  });
}

// ─── Un grupo (una cuenta de MP) ─────────────────────────────────────────────
export async function reconcileMerchantGroup(group, ctx, opts = RECONCILE_DEFAULTS) {
  const dry = ctx.dryRun;
  const per = {};
  const stat = (mid) => (per[mid] ||= { checked: 0, relinked: 0, status_fixed: 0, ghosts_to_pending: 0, missed_payments_found: 0, missed_payments_processed: 0, errors: 0 });
  group.forEach(m => stat(m.id));
  const res = { merchants: per, changed: [], missed: [], conflicts: 0, unmatched_payments: 0, partial: false, error: null };

  // 1) Listado de preapprovals con el primer token del grupo que funcione.
  let token = null, listing = null, lastErr = null;
  for (const m of group) {
    if (ctx.outOfTime()) { res.partial = true; return res; }
    try { listing = await listAllPreapprovals(m.data.mp_access_token, ctx, opts); token = m.data.mp_access_token; break; }
    catch (e) { lastErr = e; if (isRateLimit(e)) break; if (!isMpAuthError(e)) break; }
  }
  if (!listing) {
    res.error = `preapproval_search: ${String(lastErr?.message || "sin token válido").slice(0, 200)}`;
    res.partial = isRateLimit(lastErr) || ctx.outOfTime();
    for (const m of group) stat(m.id).errors += 1;
    return res;
  }
  if (!listing.complete) res.partial = true;
  const pres = listing.byId;

  // 2) Suscriptores de todas las tiendas del grupo (una lectura por tienda).
  const subs = []; // { mid, sid, d }
  for (const m of group) {
    try {
      const snap = await db().collection("merchants").doc(m.id).collection("subscribers").get();
      for (const s of snap.docs) subs.push({ mid: m.id, sid: s.id, d: s.data() || {} });
    } catch (e) { stat(m.id).errors += 1; console.warn(`[reconcile] subs ${m.id}: ${e.message}`); }
  }
  // Un plan de MP usado por más de un sub NO es ad-hoc (flujo viejo con plan compartido):
  // no sirve para identificar a nadie.
  const planUse = new Map();
  for (const s of subs) for (const pid of new Set([s.d.mp_preapproval_plan_id, s.d.mp_preapproval_plan_id_prev].filter(Boolean))) planUse.set(pid, (planUse.get(pid) || 0) + 1);
  const byExt = new Map(), byPlan = new Map();
  for (const p of pres.values()) {
    if (p.external_reference) byExt.set(String(p.external_reference), [...(byExt.get(String(p.external_reference)) || []), p]);
    if (p.preapproval_plan_id) byPlan.set(p.preapproval_plan_id, [...(byPlan.get(p.preapproval_plan_id) || []), p]);
  }

  // 3) Preapproval verdadero de cada sub.
  let directGets = 0;
  const rows = [];
  for (const s of subs) {
    const { d } = s;
    if (d.payment_provider && d.payment_provider !== "mercadopago") continue; // Mobbex/Stripe/Whop: no son de MP
    stat(s.mid).checked += 1;
    const cands = new Map();
    let storedUnknown = false;
    let stored = d.mp_preapproval_id ? pres.get(String(d.mp_preapproval_id)) || null : null;
    if (d.mp_preapproval_id && !stored) {
      // No vino en el listado: lo pedimos directo (puede ser de otra cuenta o no existir).
      if (directGets >= opts.maxDirectGets || ctx.outOfTime()) storedUnknown = true;
      else {
        directGets += 1;
        try { const p = await mpGetPreapproval(token, d.mp_preapproval_id); if (p?.id) { stored = p; pres.set(String(p.id), p); } }
        catch (e) {
          if (!is404(e)) storedUnknown = true;
          if (isRateLimit(e)) { res.partial = true; break; }
        }
      }
    }
    if (stored) cands.set(String(stored.id), stored);
    for (const p of byExt.get(`${s.mid}:${s.sid}`) || []) cands.set(String(p.id), p);
    for (const pid of new Set([d.mp_preapproval_plan_id, d.mp_preapproval_plan_id_prev].filter(Boolean))) {
      if (planUse.get(pid) > 1) continue;
      const list = byPlan.get(pid) || [];
      if (new Set(list.map(p => String(p.payer_id ?? ""))).size > 1) continue; // pagadores distintos: ambiguo
      for (const p of list) cands.set(String(p.id), p);
    }
    rows.push({ ...s, stored, storedUnknown, truePre: pickTruePreapproval([...cands.values()]), candCount: cands.size });
  }

  // Un mismo preapproval no puede ser "el verdadero" de dos subs: si pasa, no se relinkea.
  const claimedBy = new Map();
  for (const r of rows) if (r.truePre) claimedBy.set(String(r.truePre.id), (claimedBy.get(String(r.truePre.id)) || 0) + 1);
  for (const r of rows) if (r.d.mp_preapproval_id) claimedBy.set(`stored:${r.d.mp_preapproval_id}`, (claimedBy.get(`stored:${r.d.mp_preapproval_id}`) || 0) + 1);

  // 4) Correcciones.
  const preToSub = new Map(); // preapproval id → { mid, sid } (para los pagos)
  for (const r of rows) {
    if (ctx.outOfTime()) { res.partial = true; break; }
    const { mid, sid, d, truePre } = r;
    const st = stat(mid);
    const at = nowIso();
    let linkedId = d.mp_preapproval_id ? String(d.mp_preapproval_id) : null;
    try {
      if (truePre) {
        const tid = String(truePre.id);
        const patch = {};
        const reasons = [];
        const needsRelink = tid !== linkedId && (!r.stored ? !r.storedUnknown : rank(truePre) > rank(r.stored));
        const conflict = claimedBy.get(tid) > 1 || (tid !== linkedId && (claimedBy.get(`stored:${tid}`) || 0) > 0);
        if (needsRelink && conflict) {
          res.conflicts += 1;
        } else if (needsRelink) {
          Object.assign(patch, {
            mp_preapproval_id: tid,
            mp_preapproval_status: truePre.status || null,
            next_charge_at: truePre.next_payment_date || null,
          });
          if (linkedId) patch.mp_preapproval_id_prev = linkedId;
          reasons.push("relink");
        }
        const effective = needsRelink && !conflict ? truePre : (r.stored || null);
        const want = effective ? desiredStatus(d, effective) : null;
        if (want) {
          patch.status = want;
          patch.mp_preapproval_status = effective.status || null;
          if (want === "cancelled" && !d.cancelled_at) patch.cancelled_at = at;
          reasons.push(`status_${d.status || "none"}_to_${want}`);
        }
        if (reasons.length) {
          const reason = reasons.join("+");
          const audit = { action: reasons.includes("relink") ? "relink" : "status_fix", reason, from_status: d.status || null, to_status: patch.status || d.status || null, from_preapproval_id: linkedId, to_preapproval_id: patch.mp_preapproval_id || linkedId, mp_status: effective?.status || null, dry_run: dry };
          const done = dry ? true : await applyFix(mid, sid, d, { ...patch, status_fixed_at: at, status_fix_reason: `reconcile:${reason}`, updated_at: at }, audit);
          if (done) {
            if (reasons.includes("relink")) { st.relinked += 1; linkedId = tid; }
            if (patch.status) st.status_fixed += 1;
            res.changed.push({ mid, sid, reason });
          }
        }
        if (!conflict || tid === linkedId) preToSub.set(tid, { mid, sid });
      } else if (!r.storedUnknown && !res.partial && LIVE.has(d.status) && r.candCount === 0) {
        // Fantasma: activa sin preapproval en MP, sin cobros y con más de 72 h.
        const created = ms(d.checkout_started_at || d.created_at);
        const noLocalCharges = !d.last_charge_at && !(d.shopify_orders || []).length;
        if (noLocalCharges && created && ctx.now - created > opts.ghostMinAgeMs) {
          const ch = await db().collection("merchants").doc(mid).collection("charges").where("subscriber_id", "==", sid).limit(1).get();
          if (ch.empty) {
            const reason = `ghost_${d.status}_to_pending`;
            const audit = { action: "ghost", reason, from_status: d.status, to_status: "pending", from_preapproval_id: linkedId, to_preapproval_id: linkedId, mp_status: null, dry_run: dry };
            const done = dry ? true : await applyFix(mid, sid, d, { status: "pending", status_fixed_at: at, status_fix_reason: `reconcile:${reason}`, updated_at: at }, audit);
            if (done) { st.ghosts_to_pending += 1; res.changed.push({ mid, sid, reason }); }
          }
        }
      }
      if (linkedId && !preToSub.has(linkedId)) preToSub.set(linkedId, { mid, sid });
    } catch (e) {
      st.errors += 1;
      console.warn(`[reconcile] fix ${mid}/${sid}: ${e.message}`);
    }
  }

  // 5) Renovaciones cobradas en MP y no registradas.
  if (!ctx.outOfTime()) {
    let recurring;
    try { recurring = await listRecurringPayments(token, ctx, opts); }
    catch (e) {
      res.error = `payments_search: ${String(e.message).slice(0, 200)}`;
      if (isRateLimit(e)) res.partial = true;
      for (const m of group) stat(m.id).errors += 1;
    }
    if (recurring) {
      if (!recurring.complete) res.partial = true;
      const mids = new Set(group.map(m => m.id));
      const seen = new Set();
      for (const p of recurring.payments.slice().sort((a, b) => ms(a.date_created) - ms(b.date_created))) {
        if (p.status !== "approved" || seen.has(String(p.id))) continue;
        seen.add(String(p.id));
        let target = preToSub.get(String(paymentSubscriptionId(p) || ""));
        const ext = String(p.external_reference || "");
        if (!target && ext.includes(":") && mids.has(ext.split(":")[0])) {
          const [emid, esid] = ext.split(":");
          if (rows.some(r => r.mid === emid && r.sid === esid)) target = { mid: emid, sid: esid };
        }
        if (!target) { res.unmatched_payments += 1; continue; }
        const { mid, sid } = target;
        const st = stat(mid);
        const chargeRef = db().collection("merchants").doc(mid).collection("charges").doc(String(p.id));
        let exists;
        try { exists = (await chargeRef.get()).exists; } catch (e) { st.errors += 1; continue; }
        if (exists) continue; // registrado (con o sin orden: lo sin orden lo avisa retry-fulfillment)
        st.missed_payments_found += 1;
        const item = { mid, sid, payment_id: String(p.id), date: p.date_created || null, result: dry ? "dry_run" : "pending" };
        res.missed.push(item);
        if (dry) continue;
        if (ctx.missedBudget.used >= opts.maxMissedPerRun || ctx.outOfTime()) { item.result = "skipped_cap"; res.partial = true; continue; }
        ctx.missedBudget.used += 1;
        try {
          const r = await syncSubscriber(mid, sid);
          let ok = (await chargeRef.get()).exists;
          if (!ok) {
            // El sync no lo encontró (búsquedas de MP vacías en esta cuenta): lo linkeamos
            // directo; linkPaymentToSubscriber verifica pertenencia y monto antes de tocar nada.
            const l = await linkPaymentToSubscriber(mid, sid, String(p.id));
            ok = (await chargeRef.get()).exists;
            item.result = ok ? "linked" : `not_linked:${String(l?.error || l?.status || "").slice(0, 60)}`;
          } else {
            item.result = r?.status === "error" ? `sync_error:${String(r.error || "").slice(0, 60)}` : "synced";
          }
          if (ok) st.missed_payments_processed += 1; else st.errors += 1;
        } catch (e) {
          st.errors += 1;
          item.result = `error:${String(e.message).slice(0, 60)}`;
        }
      }
    }
  } else res.partial = true;
  return res;
}

// ─── Corrida completa ────────────────────────────────────────────────────────
export async function runReconcile({ now = Date.now(), dryRun = isDryRun(), budgetMs, opts: o = {} } = {}) {
  const opts = { ...RECONCILE_DEFAULTS, ...o };
  const start = Date.now();
  const deadline = start + (budgetMs ?? opts.budgetMs);
  const ctx = { now, dryRun, outOfTime: () => Date.now() > deadline, missedBudget: { used: 0 } };
  const merchants = {};
  const changed = [], missed = [];
  let partial = false, errors = 0, groupsDone = 0, conflicts = 0, unmatched = 0;
  const groupErrors = [];
  let skipped = [];
  let ok = true, fatal = null;
  try {
    const snap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
    const g = groupMerchants(snap.docs);
    skipped = g.skipped;
    for (const group of g.groups) {
      if (ctx.outOfTime()) { partial = true; break; }
      try {
        const r = await reconcileMerchantGroup(group, ctx, opts);
        groupsDone += 1;
        Object.assign(merchants, r.merchants);
        changed.push(...r.changed);
        missed.push(...r.missed);
        conflicts += r.conflicts; unmatched += r.unmatched_payments;
        if (r.partial) partial = true;
        if (r.error) groupErrors.push({ mids: group.map(m => m.id), error: r.error });
      } catch (e) {
        groupErrors.push({ mids: group.map(m => m.id), error: String(e.message).slice(0, 200) });
        console.error("[reconcile] grupo falló:", e.message);
      }
    }
  } catch (e) {
    ok = false; fatal = String(e.message || e).slice(0, 200);
    console.error("[reconcile] error global:", e.message);
  }
  for (const m of Object.values(merchants)) errors += m.errors;
  errors += groupErrors.filter(x => !x.mids.some(mid => merchants[mid]?.errors)).length;
  const totals = { checked: 0, relinked: 0, status_fixed: 0, ghosts_to_pending: 0, missed_payments_found: 0, missed_payments_processed: 0, errors: 0 };
  for (const m of Object.values(merchants)) for (const k of Object.keys(totals)) totals[k] += m[k] || 0;
  const corrections = totals.relinked + totals.status_fixed + totals.ghosts_to_pending + totals.missed_payments_processed;
  const summary = {
    ok, partial, dry_run: dryRun,
    at: new Date().toISOString(), elapsed_ms: Date.now() - start,
    groups: groupsDone, corrections, conflicts, unmatched_payments: unmatched,
    totals, merchants,
    skipped: skipped.slice(0, 50),
    changed: changed.slice(0, 100),
    changed_truncated: changed.length > 100,
    missed_payments: missed.slice(0, 100),
    group_errors: groupErrors.slice(0, 20),
    errors,
    ...(fatal ? { error: fatal } : {}),
  };
  try { await db().collection("system").doc("reconcile_last").set(summary); }
  catch (e) { console.warn("[reconcile] no pude guardar el resumen:", e.message); }
  if (corrections || totals.missed_payments_found || errors) console.log("[reconcile]", JSON.stringify({ ok, partial, dry_run: dryRun, corrections, totals }));
  return summary;
}
