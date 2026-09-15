// Motor de flujos de email (definición en shared/platform/flows.js).
//
//   emitFlowEvent(mid, merchant, trigger, subId, sub, { key })
//     Cuando pasa algo (activación, pago rechazado, checkout…) crea una "corrida"
//     por cada flujo ACTIVO con ese disparador. Costo cero si la tienda no tiene
//     flujos activos para ese disparador: mira merchant.flows_active_triggers
//     antes de leer nada. NUNCA lanza (los callers están en el camino del cobro).
//   runFlowsForMerchant(mid, merchant, { deadline })  — cron ?action=run-flows
//     Avanza las corridas vencidas: una espera programa el próximo paso; antes de
//     cada mail relee la suscripción (¿sigue en el flujo?) y respeta la baja; manda
//     con Resend y registra en email_log (type "flow"). Además, 2 veces por hora,
//     mete en los flujos de "Próximo cobro" a las activas que cobran en N días.
//
// Datos:
//   merchants/{mid}/flows/{flowId}      { name, trigger, active, steps[], days_before?, stats{entered,sent,completed,exited,converted} }
//   merchants/{mid}/flow_runs/{runId}   { flow_id, flow_name, trigger, subscriber_id, email, steps (copia al entrar),
//                                         step, next_at, status: waiting|completed|exited|error, exit_reason, sent }
//   runId = flujo + sub (o mail) + evento → el mismo evento no entra dos veces (create()).
//   Las corridas guardan su copia de los pasos: editar un flujo aplica a los que entran después.
//   next_at solo existe mientras la corrida espera (las terminadas no aparecen en el query del cron).
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { appBaseUrl } from "./config.js";
import { sha256hex } from "./token.js";
import { emailFlowStep, effectiveBrand } from "./email.js";
import { logEmail } from "./emaillog.js";
import { isUnsubscribed } from "./unsub.js";
import { computeRecoverUrl } from "./abandoned.js";
import { TRIGGER_BY_ID, FLOW_VARIABLES, renderVars, waitMs } from "../../shared/platform/flows.js";

const H = 3600e3, D = 24 * H;
const nowIso = () => new Date().toISOString();
const flowsCol = (mid) => db().collection("merchants").doc(mid).collection("flows");
const runsCol = (mid) => db().collection("merchants").doc(mid).collection("flow_runs");
const shortHash = (s) => sha256hex(String(s || "")).slice(0, 16);
const PAYING = new Set(["active", "paused", "payment_failed"]);
const ALREADY_EXISTS = 6;

export function flowsWanted(merchant, trigger) {
  const t = merchant?.flows_active_triggers;
  return Array.isArray(t) && t.includes(trigger);
}

// ── Entrada ────────────────────────────────────────────────────────
export async function emitFlowEvent(merchantId, merchant, trigger, subscriberId, sub, { key } = {}) {
  if (!merchantId || !subscriberId || !sub?.customer_email || !flowsWanted(merchant, trigger)) return;
  try {
    const snap = await flowsCol(merchantId).where("trigger", "==", trigger).where("active", "==", true).get();
    for (const d of snap.docs) await enterFlow(merchantId, d.id, d.data(), subscriberId, sub, key);
  } catch (e) {
    console.warn(`[flows] emit ${trigger} ${merchantId}/${subscriberId}:`, e.message);
  }
}

async function enterFlow(mid, flowId, flow, subscriberId, sub, key) {
  const trig = TRIGGER_BY_ID[flow.trigger];
  if (!trig || !Array.isArray(flow.steps) || !flow.steps.length) return false;
  const email = String(sub.customer_email || "").trim().toLowerCase();
  // Checkout sin pagar y win-back: una corrida por mail y flujo por mes (no por cada intento).
  const who = trig.marketing ? `e${shortHash(email)}` : String(subscriberId);
  const evt = trig.marketing ? nowIso().slice(0, 7) : (key || nowIso());
  const runId = `${flowId}__${who}__${shortHash(evt)}`.slice(0, 180);
  const now = nowIso();
  try {
    await runsCol(mid).doc(runId).create({
      flow_id: flowId, flow_name: flow.name || "", trigger: flow.trigger,
      subscriber_id: String(subscriberId), email, steps: flow.steps,
      step: 0, sent: 0, status: "waiting", next_at: now, created_at: now, updated_at: now,
    });
  } catch (e) {
    if (e.code === ALREADY_EXISTS || /already exists/i.test(e.message || "")) return false;
    throw e;
  }
  await flowsCol(mid).doc(flowId).update({ "stats.entered": FieldValue.increment(1) }).catch(() => {});
  return true;
}

// ── ¿Sigue en el flujo? ────────────────────────────────────────────
async function stillIn(mid, trig, run) {
  const snap = await db().collection("merchants").doc(mid).collection("subscribers").doc(run.subscriber_id).get();
  if (!snap.exists) return { ok: false, reason: "La suscripción ya no existe" };
  const sub = snap.data() || {};
  const st = sub.status || "";
  if (trig.keep && !trig.keep.includes(st)) {
    const converted = (trig.goal === "paid" && PAYING.has(st)) || (trig.goal === "recovered" && st === "active") || (trig.goal === "winback" && PAYING.has(st));
    return { ok: false, converted, reason: converted ? "Objetivo cumplido (pagó / se recuperó)" : `La suscripción pasó a ${st || "otro estado"}` };
  }
  if (trig.avoid && trig.avoid.includes(st)) return { ok: false, reason: `La suscripción pasó a ${st}` };
  // Checkout sin pagar / win-back: si el mismo mail ya tiene otra suscripción que cobra, sale.
  if (trig.goal === "paid" || trig.goal === "winback") {
    const others = await db().collection("merchants").doc(mid).collection("subscribers").where("customer_email", "==", sub.customer_email || run.email).limit(10).get().catch(() => ({ docs: [] }));
    if (others.docs.some(d => d.id !== snap.id && PAYING.has(d.data()?.status))) return { ok: false, converted: true, reason: "Ya tiene otra suscripción activa" };
  }
  return { ok: true, sub };
}

// ── Variables del mail ─────────────────────────────────────────────
function portalUrlOf(sub) {
  const base = appBaseUrl();
  return sub?.portal_token ? `${base}/#/portal?token=${encodeURIComponent(sub.portal_token)}` : `${base}/#/portal`;
}
const fmtArs = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
function fmtDay(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  try { return new Date(t).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }); }
  catch (_) { return new Date(t).toISOString().slice(0, 10); }
}
export function flowVars(merchant, mid, sub) {
  const ps = sub?.plan_snapshot || {};
  const amount = ps.total_per_charge_ars || ((ps.subscription_price_ars || 0) * (sub?.quantity || 1));
  let checkout = "";
  try { checkout = computeRecoverUrl(merchant, sub, { merchantId: mid }) || ""; } catch (_) {}
  return {
    nombre: String(sub?.customer_name || "").trim().split(/\s+/)[0] || "",
    producto: ps.product_title || "tu suscripción",
    monto: amount ? fmtArs(amount) : "",
    marca: effectiveBrand(merchant) || "",
    proximo_cobro: fmtDay(sub?.next_charge_at),
    link_portal: portalUrlOf(sub),
    link_checkout: checkout,
  };
}

function renderStep(step, vars) {
  const ctaUrl = step.cta === "portal" ? vars.link_portal : step.cta === "checkout" ? vars.link_checkout : "";
  return {
    subject: renderVars(step.subject, vars).replace(/\s+/g, " ").trim().slice(0, 180) || "(sin asunto)",
    bodyText: renderVars(step.body, vars),
    ctaLabel: step.cta !== "none" && ctaUrl ? renderVars(step.cta_label, vars) : "",
    ctaUrl: step.cta !== "none" ? ctaUrl : "",
  };
}

// ── Runner ─────────────────────────────────────────────────────────
export async function runFlowsForMerchant(mid, merchant, { deadline = Date.now() + 60e3, limit = 60 } = {}) {
  const out = { processed: 0, sent: 0, scheduled: 0, completed: 0, exited: 0, entered: 0, errors: 0 };
  const flowsSnap = await flowsCol(mid).get();
  const flows = Object.fromEntries(flowsSnap.docs.map(d => [d.id, d.data()]));
  try { out.entered += await scanUpcoming(mid, flows); }
  catch (e) { out.errors++; console.warn(`[flows] upcoming ${mid}:`, e.message); }

  const due = await runsCol(mid).where("next_at", "<=", nowIso()).orderBy("next_at").limit(limit).get();
  for (const doc of due.docs) {
    if (Date.now() > deadline) break;
    out.processed++;
    try { await advanceRun(mid, merchant, flows, doc, out); }
    catch (e) {
      out.errors++;
      console.error(`[flows] run ${mid}/${doc.id}:`, e.message);
      await doc.ref.update({ status: "error", last_error: String(e.message || e).slice(0, 300), next_at: FieldValue.delete(), updated_at: nowIso() }).catch(() => {});
    }
  }
  return out;
}

async function advanceRun(mid, merchant, flows, doc, out) {
  const run = doc.data() || {};
  const flow = flows[run.flow_id];
  const trig = TRIGGER_BY_ID[run.trigger];
  const statRef = flowsCol(mid).doc(run.flow_id);
  const finish = async (status, extra = {}) => {
    const { converted, ...rest } = extra;
    await doc.ref.update({ status, next_at: FieldValue.delete(), updated_at: nowIso(), ...rest, ...(converted ? { converted: true } : {}) });
    await statRef.update({ [`stats.${status}`]: FieldValue.increment(1), ...(converted ? { "stats.converted": FieldValue.increment(1) } : {}) }).catch(() => {});
    out[status] = (out[status] || 0) + 1;
  };
  if (!flow || flow.active !== true || !trig) return finish("exited", { exit_reason: "El flujo se pausó o se borró" });

  const steps = Array.isArray(run.steps) ? run.steps : [];
  let i = Number(run.step) || 0;
  let sent = Number(run.sent) || 0;
  for (let guard = 0; guard < 20; guard++) {
    const step = steps[i];
    if (!step) return finish("completed", { step: i, sent });
    if (step.type === "wait") {
      await doc.ref.update({ step: i + 1, sent, next_at: new Date(Date.now() + waitMs(step)).toISOString(), updated_at: nowIso() });
      out.scheduled++;
      return;
    }
    if (step.type === "email") {
      const chk = await stillIn(mid, trig, run);
      if (!chk.ok) return finish("exited", { exit_reason: chk.reason, converted: !!chk.converted, step: i, sent });
      if (await isUnsubscribed(mid, run.email)) return finish("exited", { exit_reason: "Se dio de baja de los mails", step: i, sent });
      const sub = chk.sub;
      const r = renderStep(step, flowVars(merchant, mid, sub));
      const er = await emailFlowStep({ to: run.email, ...r, merchant, merchantId: mid, tags: { type: "flow", flow: run.flow_id } });
      if (!er?.skipped) await logEmail(mid, {
        type: "flow", flow_id: run.flow_id, flow_name: flow.name || run.flow_name, subscriber_id: run.subscriber_id,
        to: run.email, customer_name: sub.customer_name, product_title: sub.plan_snapshot?.product_title,
        step: i + 1, status: er?.error ? "error" : "sent", error: er?.error || null, provider_id: er?.id || null,
      });
      if (er?.ok) { sent++; out.sent++; await statRef.update({ "stats.sent": FieldValue.increment(1) }).catch(() => {}); }
      i++;
      // Se guarda el avance después de cada mail: si el proceso corta, no se reenvía.
      await doc.ref.update({ step: i, sent, updated_at: nowIso(), ...(er?.error ? { last_error: String(er.error).slice(0, 300) } : {}) });
      continue;
    }
    i++; // tipo desconocido: se saltea
  }
  await doc.ref.update({ step: i, sent, next_at: nowIso(), updated_at: nowIso() });
}

// Próximo cobro: 2 veces por hora (ticks :00 y :30 del cron cada 5 min), activas cuyo
// next_charge_at cae en [N días ± 12 h]. Dedup por fecha de cobro → una vez por ciclo.
async function scanUpcoming(mid, flows) {
  const list = Object.entries(flows).filter(([, f]) => f.active === true && f.trigger === "upcoming_charge");
  if (!list.length || new Date().getMinutes() % 30 >= 5) return 0;
  const subsCol = db().collection("merchants").doc(mid).collection("subscribers");
  let entered = 0;
  for (const [flowId, f] of list) {
    const days = Math.min(14, Math.max(1, Number(f.days_before) || 3));
    const from = new Date(Date.now() + days * D - 12 * H).toISOString();
    const to = new Date(Date.now() + days * D + 12 * H).toISOString();
    const snap = await subsCol.where("next_charge_at", ">=", from).where("next_charge_at", "<", to).limit(300).get();
    for (const d of snap.docs) {
      const s = d.data() || {};
      if (s.status !== "active" || !s.customer_email) continue;
      if (await enterFlow(mid, flowId, f, d.id, s, `nc_${String(s.next_charge_at).slice(0, 10)}`)) entered++;
    }
  }
  return entered;
}

// ── Índice en el merchant (lo lee emitFlowEvent sin tocar la colección) ──
export async function syncFlowsIndex(mid) {
  const snap = await flowsCol(mid).get();
  const triggers = [...new Set(snap.docs.map(d => d.data()).filter(f => f.active === true).map(f => f.trigger))];
  await db().collection("merchants").doc(mid).set({ flows_active_triggers: triggers, flows_enabled: triggers.length > 0 }, { merge: true });
  return triggers;
}

// ── Prueba desde el editor: el mail tal cual, con datos de ejemplo, al dueño ──
export async function sendFlowTest(mid, merchant, { step, to }) {
  const sample = Object.fromEntries(FLOW_VARIABLES.map(v => [v.key, v.sample]));
  let sub = null;
  try {
    const s = await db().collection("merchants").doc(mid).collection("subscribers").where("status", "==", "active").limit(1).get();
    if (!s.empty) sub = s.docs[0].data();
  } catch (_) {}
  const vars = sub ? { ...flowVars(merchant, mid, sub), nombre: sample.nombre } : { ...sample, marca: effectiveBrand(merchant) || sample.marca, link_portal: `${appBaseUrl()}/#/portal` };
  const r = renderStep(step, vars);
  return emailFlowStep({ to, ...r, subject: `[Prueba] ${r.subject}`, merchant, merchantId: mid, test: true, tags: { type: "flow_test" } });
}
