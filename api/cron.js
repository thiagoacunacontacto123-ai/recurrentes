// /api/cron — endpoint para Vercel Cron Jobs (vercel.json: cada 2 min).
//
// ?action=sync-all-pending — por cada merchant con MP conectado, en este ORDEN
// (las activas primero: son las que tienen plata en juego):
//   0) refresh de token OAuth MP si vence en < 7 días (best effort)
//   1) activas con next_charge_at vencido + payment_failed con backoff (> 6h desde el último sync)
//   2) activas sin orden de las últimas 72h
//   3) pendings del flujo de plan (con mp_preapproval_plan_id, sin capture) de < 72h, máx 40
//   4) canceladas de 90 días: solo en corridas cuyo minuto es múltiplo de 30
//   5) planes MP huérfanos (> 14 días sin autorizar): solo 1 vez por hora (minuto < 2)
//   (6, retirado 2026-09-13: los mails de carrito abandonado propios se
//    reemplazaron por eventos a Klaviyo, ver _lib/klaviyo.js)
// ?action=run-flows — flujos de email propios (cada 5 min): corridas vencidas de las
//   tiendas con flujos activos (_lib/flows.js). Aparte del sync: si falla, no lo toca.
// ?action=retry-fulfillment — cobros aprobados sin orden (cada 10 min): aviso al
//   comerciante + reintento con backoff si FULFILL_RETRY_ENABLED=1 (_lib/fulfillretry.js).
// ?action=health — chequeo de configuración (solo booleanos), ver _lib/health.js.
// ?action=reconcile-mp — conciliación con MP cada hora (_lib/reconcile.js): relinkea
//   preapprovals, corrige estados, fantasmas → pending y renovaciones sin registrar.
//
//   7) pausas por oferta de retención con resume_at vencido → status authorized en
//      MP + active local (best effort, máx 20 por merchant y corrida, 3 intentos)
// Presupuesto: 240s; si se agota devolvemos parcial. Los merchants rotan por
// corrida (offset = minuto % N) para que ninguno se quede sin turno.
//
// Auth: header `Authorization: Bearer <CRON_SECRET>` (Vercel Cron lo inyecta).
// En producción CRON_SECRET es OBLIGATORIO (fail closed). `?token=` sigue
// aceptado por compatibilidad con crons externos, pero está deprecado.
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./_lib/firebase.js";
import { syncSubscriber } from "./_lib/sync.js";
import { isProd } from "./_lib/config.js";
import { timingSafeEqualStr } from "./_lib/token.js";
import { runFlowsForMerchant } from "./_lib/flows.js";
import { mpCancelPreapprovalPlan, mpUpdatePreapproval, mpGetPreapproval, isMpAuthError } from "./_lib/mp.js";
import { refreshMpTokenIfNeeded } from "./_lib/mpOauth.js";
// ?action=health (auth propia: CRON_SECRET o admin de ADMIN_EMAILS) + heartbeat de cada cron.
import { healthHandler, cronHeartbeat } from "./_lib/health.js";
// ?action=retry-fulfillment (cada 10 min): aviso + reintento de cobros sin orden.
import { fulfillmentCron } from "./_lib/fulfillretry.js";
// ?action=reconcile-mp (cada hora, minuto 17): conciliación con MP (_lib/reconcile.js).
import { runReconcile } from "./_lib/reconcile.js";

export const config = { maxDuration: 300 };

const BUDGET_MS = 240 * 1000;
const H = 60 * 60 * 1000;
const D = 24 * H;
const MAX_PENDINGS_PER_MERCHANT = 40;
const MAX_CANCELLED_PER_MERCHANT = 60;
const MAX_ORPHAN_PLANS_PER_MERCHANT = 30;
const MAX_RESUMES_PER_MERCHANT = 20;
const MAX_RESUME_ATTEMPTS = 3;
const nowIso = () => new Date().toISOString();
const ms = (s) => { const t = s ? Date.parse(s) : NaN; return Number.isFinite(t) ? t : 0; };

export default async function handler(req, res) {
  // Chequeo de configuración: auth propia (Bearer CRON_SECRET o Firebase ID token de
  // un mail de ADMIN_EMAILS). Va ANTES de la auth del cron para que entre el admin.
  if (String(req.query.action || "") === "health") return healthHandler(req, res);
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    if (isProd()) {
      // Transitorio: sin CRON_SECRET solo aceptamos al cron propio de Vercel
      // (user-agent vercel-cron/*). Cualquier otro origen → 401. Cargar la env
      // en Vercel cierra esto del todo.
      const ua = String(req.headers["user-agent"] || "");
      if (!/^vercel-cron\//i.test(ua)) {
        console.error("[cron] CRON_SECRET no seteado en producción: rechazado origen externo");
        return res.status(401).json({ error: "CRON_SECRET requerido: configuralo en Vercel → Environment Variables" });
      }
      console.warn("[cron] CRON_SECRET no seteado: aceptando solo vercel-cron (configurar la env)");
    } else {
      console.warn("[cron] CRON_SECRET no seteado (dev): sin auth");
    }
  } else {
    const bearer = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const headerOk = timingSafeEqualStr(bearer, cronSecret);
    const queryOk = !headerOk && timingSafeEqualStr(String(req.query.token || ""), cronSecret);
    if (queryOk) console.warn("[cron] auth por ?token= está DEPRECADA: usar header Authorization: Bearer");
    if (!headerOk && !queryOk) return res.status(401).json({ error: "Unauthorized" });
  }

  const action = String(req.query.action || "sync-all-pending");
  if (action === "run-flows") return runFlowsCron(res);
  if (action === "retry-fulfillment") return fulfillmentCron(res);
  if (action === "reconcile-mp") return reconcileCron(res);
  if (action === "sync-saas-tiers") {
    // Diario: la suscripción de Stripe de cada comercio pasa al tramo que le corresponde hoy (sin prorrateo).
    const { syncSaasTiers } = await import("./_lib/saasBilling.js");
    const { activeSubscribers } = await import("./merchant.js");
    const r = await syncSaasTiers({ countActive: activeSubscribers });
    return res.json({ ok: true, ...r });
  }
  if (action === "bill-wa-usage") {
    // Diario: los meses cerrados de WhatsApp de cada tienda con plan pago → ítems en su próxima factura de Stripe.
    const { stripeRequest, saasStripeAvailable } = await import("./_lib/saasBilling.js");
    if (!saasStripeAvailable()) return res.json({ ok: true, skipped: "no_stripe" });
    const { billAllWaUsage } = await import("./_lib/waBilling.js");
    return res.json({ ok: true, ...(await billAllWaUsage(stripeRequest)) });
  }
  if (action !== "sync-all-pending") {
    return res.status(400).json({ error: "action no reconocida" });
  }

  // Declaradas FUERA del try: el catch global las usa en la respuesta.
  const start = Date.now();
  const minute = new Date(start).getMinutes();
  let merchantsSnap = null;
  let merchantsProcessed = 0, subsProcessed = 0, activated = 0, errors = 0;
  let tokensRefreshed = 0, plansCancelled = 0, resumed = 0, tokensReconnect = 0;
  let partial = false;
  const outOfTime = () => (Date.now() - start) > BUDGET_MS;

  try {
    merchantsSnap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
    const now = Date.now();

    // Rotar merchants por corrida para que ninguno quede siempre último.
    const all = merchantsSnap.docs;
    const offset = all.length ? minute % all.length : 0;
    const merchants = [...all.slice(offset), ...all.slice(0, offset)];

    // sync con contabilidad común
    const runSync = async (mid, sid, label, countActivatedBy = "status") => {
      try {
        const r = await syncSubscriber(mid, sid);
        subsProcessed += 1;
        if (r?.status === "error") errors += 1;
        if (countActivatedBy === "status" ? r?.status === "active" : (r?.charges_processed > 0)) activated += 1;
        return r;
      } catch (e) {
        errors += 1;
        console.error(`[cron] sync ${label} ${mid}/${sid}:`, e.message);
        return null;
      }
    };

    for (const m of merchants) {
      if (outOfTime()) { partial = true; break; }
      const md = m.data();
      if (md.archived_at) continue; // tienda archivada: fuera del sync (MP puede seguir cobrando)
      try {
        merchantsProcessed += 1;
        const merchantSubs = db().collection("merchants").doc(m.id).collection("subscribers");

        // 0) REFRESH TOKEN OAUTH MP — 7 días antes de vencer. Best effort (_lib/mpOauth.js):
        //    backoff de 1 h tras un error; invalid_grant (el vendedor quitó el permiso o
        //    venció) → el panel pide "Reconectar" y no se reintenta. El access_token
        //    actual se sigue usando mientras valga.
        const rf = await refreshMpTokenIfNeeded(m.ref, md, now).catch(e => ({ status: "error", error: e.message }));
        if (rf.status === "refreshed") {
          tokensRefreshed += 1;
          console.log(`[cron] token MP refrescado para ${m.id}`);
        } else if (rf.status === "reconnect") {
          tokensReconnect += 1;
          console.warn(`[cron] token MP de ${m.id}: MP rechazó el refresh (${rf.error}) → reconectar`);
        } else if (rf.status === "error") {
          console.error(`[cron] refresh token MP ${m.id} falló: ${rf.error}`);
        }

        // 1) + 2) ACTIVAS.
        //   A: cobro recurrente vencido (next_charge_at + 5 min de margen): MP debería
        //      haber cobrado y el webhook no llegó → procesar cobro + orden Shopify.
        //   B: activa SIN ORDEN reciente (72h): el preapproval quedó authorized pero
        //      el webhook de pago no creó la orden.
        // Se leen SOLO las que pueden entrar (activesForRun): traer todas las activas
        // cada 2 min es lo que hace escalar el costo de Firestore (100 tiendas × 200
        // activas ≈ 14 M lecturas/día). Sin los índices, cae a la lectura completa.
        const actives = await activesForRun(merchantSubs, now);
        const vencidas = [], sinOrden = [];
        for (const subDoc of actives.docs) {
          const d = subDoc.data();
          const created = ms(d.checkout_started_at || d.created_at);
          if (created && now - created < 60 * 1000) continue; // muy nueva, esperar al próximo tick
          const nextChargeMs = ms(d.next_charge_at);
          if (nextChargeMs && nextChargeMs <= now - 5 * 60 * 1000) { vencidas.push(subDoc); continue; }
          // Activas SIN next_charge_at (activadas por webhook viejo que no lo guardaba):
          // sincronizar 1 vez por día hasta completarlo, máx 10 por corrida, para que
          // el cron pueda detectar sus renovaciones y el Inicio muestre próximos cobros.
          if (!nextChargeMs && (d.mp_preapproval_plan_id || d.mp_preapproval_id) && (!d.last_sync_at || now - ms(d.last_sync_at) > 24 * H)) {
            if (vencidas.filter(x => !ms(x.data().next_charge_at)).length < 10) { vencidas.push(subDoc); continue; }
          }
          if ((d.shopify_orders || []).length === 0 && created && now - created < 72 * H) sinOrden.push(subDoc);
        }
        // payment_failed con backoff: re-verificar cada > 6h (MP reintenta el cobro solo).
        const failed = await merchantSubs.where("status", "==", "payment_failed").get();
        for (const subDoc of failed.docs) {
          const d = subDoc.data();
          if (!d.last_sync_at || now - ms(d.last_sync_at) > 6 * H) vencidas.push(subDoc);
        }
        for (const subDoc of vencidas) {
          if (outOfTime()) { partial = true; break; }
          await runSync(m.id, subDoc.id, "active-vencida", "charges");
        }
        for (const subDoc of sinOrden) {
          if (outOfTime()) { partial = true; break; }
          await runSync(m.id, subDoc.id, "active-sin-orden", "charges");
        }
        if (partial) break;

        // 3) PENDINGS del flujo de plan — la primera activación. Excluimos leads
        //    de captura (capture===true) y subs sin plan MP; solo < 72h; máx 40 por
        //    corrida, los menos recién sincronizados primero.
        const pendings = await pendingsForRun(merchantSubs, minute < 2, now);
        const pendCandidates = pendings.docs.filter(subDoc => {
          const d = subDoc.data();
          if (d.capture === true || !d.mp_preapproval_plan_id) return false;
          // created_at se preserva del lead (secuencia de abandono); el reloj del
          // checkout real es checkout_started_at.
          const created = ms(d.checkout_started_at || d.created_at);
          if (!created || now - created < 60 * 1000) return false;
          return now - created < 72 * H;
        }).sort((a, b) => {
          const da = a.data(), dbb = b.data();
          return String(da.last_sync_at || da.updated_at || "").localeCompare(String(dbb.last_sync_at || dbb.updated_at || ""));
        }).slice(0, MAX_PENDINGS_PER_MERCHANT);
        for (const subDoc of pendCandidates) {
          if (outOfTime()) { partial = true; break; }
          await runSync(m.id, subDoc.id, "pending", "status");
        }
        if (partial) break;

        // 4) CANCELADAS (self-heal, últimos 90 días) — solo cada 30 min. Bugs viejos
        //    dejaron clientas que PAGAN marcadas "cancelled"; syncSubscriber re-chequea
        //    la verdad en MP (si MP la tiene cancelada, sigue cancelada).
        if (minute % 30 === 0) {
          const cancelled = await recentCancelled(merchantSubs, now);
          let n = 0;
          for (const subDoc of cancelled.docs) {
            if (outOfTime()) { partial = true; break; }
            if (n >= MAX_CANCELLED_PER_MERCHANT) break;
            const d = subDoc.data();
            const created = ms(d.created_at);
            if (!created || now - created > 90 * D || now - created < 60 * 1000) continue;
            n += 1;
            await runSync(m.id, subDoc.id, "cancelled", "status");
          }
          if (partial) break;
        }

        // 5) PLANES MP HUÉRFANOS — leads que crearon un preapproval_plan ad-hoc y
        //    nunca autorizaron (> 14 días): cancelamos el plan en MP para no
        //    acumular basura. Solo 1 vez por hora, máx 30 por merchant, hasta 3
        //    intentos. Nunca planes de subs con preapproval, cobro u órdenes.
        if (minute < 2 && md.mp_access_token) {
          let n = 0;
          for (const subDoc of pendings.docs) {
            if (outOfTime()) { partial = true; break; }
            if (n >= MAX_ORPHAN_PLANS_PER_MERCHANT) break;
            const d = subDoc.data();
            if (!d.mp_preapproval_plan_id || d.mp_preapproval_id || d.last_charge_at || d.mp_plan_cancelled_at) continue;
            if ((d.shopify_orders || []).length > 0) continue;
            if ((d.mp_plan_cancel_attempts || 0) >= 3) continue;
            const created = ms(d.created_at);
            if (!created || now - created < 14 * D) continue;
            n += 1;
            try {
              await mpCancelPreapprovalPlan(md.mp_access_token, d.mp_preapproval_plan_id);
              await subDoc.ref.update({ mp_plan_cancelled_at: nowIso() });
              plansCancelled += 1;
            } catch (e) {
              console.warn(`[cron] cancelar plan huérfano ${d.mp_preapproval_plan_id} (${m.id}/${subDoc.id}):`, e.message);
              await subDoc.ref.update({
                mp_plan_cancel_error: String(e.message || e).slice(0, 300),
                mp_plan_cancel_attempts: (d.mp_plan_cancel_attempts || 0) + 1,
              }).catch(() => {});
              if (isMpAuthError(e)) break; // token roto: no insistir con el resto
            }
          }
          if (partial) break;
        }

        // 7) REACTIVAR PAUSAS POR RETENCIÓN — subs pausadas desde el portal con
        //    `resume_at` (oferta "pausá N ciclos") ya vencido: MP → authorized, local →
        //    active. Best effort: un fallo no corta el cron; 3 intentos y se deja pausada.
        //    Query por resume_at solo (índice simple): el campo se borra al reactivar.
        if (md.mp_access_token) {
          try {
            const due = await merchantSubs.where("resume_at", "<=", nowIso()).limit(MAX_RESUMES_PER_MERCHANT).get();
            for (const subDoc of due.docs) {
              if (outOfTime()) { partial = true; break; }
              const d = subDoc.data();
              // Ya no está pausada (la reactivó/canceló alguien a mano): limpiar y seguir.
              if (d.status !== "paused" || !d.mp_preapproval_id) {
                await subDoc.ref.update({ resume_at: FieldValue.delete() }).catch(() => {});
                continue;
              }
              try {
                try {
                  await mpUpdatePreapproval(md.mp_access_token, d.mp_preapproval_id, { status: "authorized" });
                } catch (e) {
                  if (isMpAuthError(e)) throw e;
                  if (!/already|authorized preapproval|same status/i.test(String(e.message || ""))) throw e;
                }
                let pre = null;
                try { pre = await mpGetPreapproval(md.mp_access_token, d.mp_preapproval_id); } catch (_) {}
                if (pre && pre.status && pre.status !== "authorized") {
                  // MP no la dejó activa (ej. cancelada por el cliente en MP): no forzamos.
                  await subDoc.ref.update({ resume_at: FieldValue.delete(), resume_error: `mp_status=${pre.status}`, resume_error_at: nowIso(), mp_preapproval_status: pre.status }).catch(() => {});
                  continue;
                }
                await subDoc.ref.update({
                  status: "active",
                  mp_preapproval_status: "authorized",
                  next_charge_at: pre?.next_payment_date || d.next_charge_at || null,
                  resume_at: FieldValue.delete(),
                  resumed_at: nowIso(),
                  resumed_by: "cron_retention",
                  resume_error: FieldValue.delete(),
                  resume_attempts: FieldValue.delete(),
                  updated_at: nowIso(),
                });
                resumed += 1;
                console.log(`[cron] sub ${m.id}/${subDoc.id} reactivada tras pausa por retención`);
              } catch (e) {
                const attempts = (d.resume_attempts || 0) + 1;
                console.warn(`[cron] reactivar ${m.id}/${subDoc.id} falló (intento ${attempts}):`, e.message);
                await subDoc.ref.update({
                  resume_attempts: attempts,
                  resume_error: String(e.message || e).slice(0, 300),
                  resume_error_at: nowIso(),
                  // Tras 3 intentos dejamos de insistir: queda pausada y visible en el panel.
                  ...(attempts >= MAX_RESUME_ATTEMPTS ? { resume_at: FieldValue.delete(), resume_gave_up_at: nowIso() } : {}),
                }).catch(() => {});
                if (isMpAuthError(e)) break; // token roto: no insistir con el resto
              }
            }
          } catch (e) {
            console.warn(`[cron] query resume_at ${m.id}:`, e.message);
          }
          if (partial) break;
        }

        await m.ref.set({ last_cron_at: nowIso() }, { merge: true }).catch(() => {});
      } catch (e) {
        // Un merchant que rompe (token roto, query que falla, etc.) NO tumba el cron
        // entero — se loguea y se sigue con el resto.
        errors += 1;
        console.error(`[cron] merchant ${m.id} fallo:`, e.message);
      }
    }

    const elapsed = Date.now() - start;
    const summary = {
      ok: true,
      partial,
      merchants_processed: merchantsProcessed,
      merchants_total: merchantsSnap.size,
      subs_processed: subsProcessed,
      activated,
      errors,
      tokens_refreshed: tokensRefreshed,
      tokens_reconnect: tokensReconnect,
      plans_cancelled: plansCancelled,
      resumed,
      elapsed_ms: elapsed,
    };
    console.log(`[cron] sync-all-pending: ${merchantsProcessed}/${merchantsSnap.size} merchants, ${subsProcessed} subs, ${activated} activadas, ${errors} errores${partial ? " (PARCIAL: presupuesto agotado)" : ""} (${elapsed}ms)`);
    await db().collection("system").doc("cron_last").set({ ...summary, at: nowIso() }, { merge: true }).catch(() => {});
    await cronHeartbeat("sync-all-pending", summary);
    return res.json(summary);
  } catch (e) {
    // NUNCA devolver 500: cron-job.org desactiva el job tras varios fallos. Si algo
    // rompe a nivel global (ej. la query inicial de merchants), respondemos 200 con
    // el error adentro para que el cron siga vivo y reintente el próximo tick.
    console.error("[cron] error global:", e.message);
    const out = {
      ok: false, error: e.message, partial,
      merchants_processed: merchantsProcessed, merchants_total: merchantsSnap ? merchantsSnap.size : null,
      subs_processed: subsProcessed, activated, errors: errors + 1, elapsed_ms: Date.now() - start,
    };
    await db().collection("system").doc("cron_last").set({ ...out, at: nowIso() }, { merge: true }).catch(() => {});
    await cronHeartbeat("sync-all-pending", out);
    return res.status(200).json(out);
  }
}

// ─── ?action=run-flows ─────────────────────────────────────────────
// Solo tiendas con flows_enabled (lo mantiene _lib/flowsApi al guardar). Presupuesto
// 200s; lo que no entra sigue en el próximo tick (las corridas quedan con next_at).
async function runFlowsCron(res) {
  const start = Date.now();
  const deadline = start + 200 * 1000;
  const tot = { merchants: 0, processed: 0, sent: 0, scheduled: 0, completed: 0, exited: 0, entered: 0, errors: 0 };
  try {
    const snap = await db().collection("merchants").where("flows_enabled", "==", true).get();
    for (const m of snap.docs) {
      if (Date.now() > deadline) break;
      tot.merchants += 1;
      try {
        const r = await runFlowsForMerchant(m.id, m.data(), { deadline });
        for (const k of Object.keys(r)) tot[k] = (tot[k] || 0) + r[k];
      } catch (e) { tot.errors += 1; console.error(`[cron] flows ${m.id}:`, e.message); }
    }
    const out = { ok: true, ...tot, elapsed_ms: Date.now() - start };
    if (tot.processed || tot.entered || tot.errors) console.log("[cron] run-flows:", JSON.stringify(out));
    await cronHeartbeat("run-flows", out);
    return res.json(out);
  } catch (e) {
    // Igual que sync-all-pending: nunca 500 (el cron sigue vivo y reintenta).
    console.error("[cron] run-flows error global:", e.message);
    const out = { ok: false, error: e.message, ...tot, elapsed_ms: Date.now() - start };
    await cronHeartbeat("run-flows", out);
    return res.status(200).json(out);
  }
}

// ─── ?action=reconcile-mp ──────────────────────────────────────────
// Conciliación con Mercado Pago (api/_lib/reconcile.js): presupuesto 200s, resumen en
// system/reconcile_last. RECONCILE_DRY_RUN=1 → solo informa. Nunca 500.
async function reconcileCron(res) {
  const start = Date.now();
  try {
    const s = await runReconcile();
    const out = {
      ok: s.ok, partial: s.partial, dry_run: s.dry_run, groups: s.groups, corrections: s.corrections,
      totals: s.totals, errors: s.errors, elapsed_ms: s.elapsed_ms,
    };
    await cronHeartbeat("reconcile-mp", out);
    return res.json(out);
  } catch (e) {
    console.error("[cron] reconcile-mp error global:", e.message);
    const out = { ok: false, error: e.message, elapsed_ms: Date.now() - start };
    await cronHeartbeat("reconcile-mp", out);
    return res.status(200).json(out);
  }
}

// ─── Lecturas acotadas (costo Firestore) ───────────────────────────
// Paso 3: solo los pending tocados en las últimas 72h. Es SUPERCONJUNTO exacto del
// filtro del paso 3 (checkout_started_at || created_at de < 72h): el alta del lead y
// el inicio del checkout escriben updated_at en el mismo write y updated_at solo
// avanza. El paso 5 (planes huérfanos de > 14 días) necesita TODOS → `full` en su
// tick horario. Sin índice (status, updated_at) → lectura completa como antes.
export async function pendingsForRun(subsCol, full, now = Date.now()) {
  if (!full) {
    try {
      return await subsCol.where("status", "==", "pending").where("updated_at", ">=", new Date(now - 72 * H).toISOString()).get();
    } catch (e) {
      console.warn("[cron] pendings acotados sin índice (status+updated_at), lectura completa:", e.message);
    }
  }
  return subsCol.where("status", "==", "pending").get();
}

/**
 * Pasos 1 y 2: las activas que el loop puede llegar a tocar, en vez de TODAS.
 * El filtro de abajo descarta el resto igual, así que el resultado es idéntico —
 * cambia lo que se factura.
 *   · cobro vencido      → (status, next_charge_at ≤ ahora − 5 min)
 *   · sin orden / sin next_charge_at → (status, created_at ≥ ahora − 72 h)
 * Se unen sin duplicar. Si algún índice no está, una sola lectura completa
 * (comportamiento anterior) para no dejar cobros sin procesar.
 */
export async function activesForRun(subsCol, now = Date.now()) {
  const base = subsCol.where("status", "==", "active");
  try {
    const [vencidas, recientes] = await Promise.all([
      base.where("next_charge_at", "<=", new Date(now - 5 * 60 * 1000).toISOString()).get(),
      base.where("created_at", ">=", new Date(now - 72 * H).toISOString()).get(),
    ]);
    const docs = [...vencidas.docs];
    const vistos = new Set(docs.map(d => d.id));
    for (const d of recientes.docs) if (!vistos.has(d.id)) { vistos.add(d.id); docs.push(d); }
    // Activas viejas SIN next_charge_at (activadas por webhooks viejos que no lo
    // guardaban): no las devuelve ninguna de las dos queries de arriba, y el loop las
    // sincroniza 1 vez por día. Se las busca una vez por hora para no volver a leer
    // toda la colección en cada corrida.
    if (new Date(now).getMinutes() < 2) {
      const sinFecha = await base.where("next_charge_at", "==", null).limit(50).get().catch(() => null);
      if (sinFecha) for (const d of sinFecha.docs) if (!vistos.has(d.id)) { vistos.add(d.id); docs.push(d); }
    }
    return { docs };
  } catch (e) {
    console.warn("[cron] activas acotadas sin índice, lectura completa:", e.message);
    return base.get();
  }
}

// Paso 4: canceladas creadas en los últimos 90 días (el mismo corte que aplica el
// loop). Índice (status, created_at). Sin índice → lectura completa como antes.
export async function recentCancelled(subsCol, now = Date.now()) {
  try {
    return await subsCol.where("status", "==", "cancelled").where("created_at", ">=", new Date(now - 90 * D).toISOString()).get();
  } catch (e) {
    console.warn("[cron] canceladas acotadas sin índice (status+created_at), lectura completa:", e.message);
    return subsCol.where("status", "==", "cancelled").get();
  }
}
