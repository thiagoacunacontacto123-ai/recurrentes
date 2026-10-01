// Endpoints de flujos de email, vía /api/merchant (no suma funciones serverless):
//   GET  ?action=flows        → { flows:[{ id, …, running }], max_flows }
//   POST ?action=flow-save    { flow:{ id?, name, trigger, active, steps[], days_before? } } → { ok, flow }
//   POST ?action=flow-delete  { id } → las corridas en espera salen solas (flujo inexistente)
//   POST ?action=flow-test    { trigger, step } → ese mail, con datos de ejemplo, al mail del login (20/día)
// Después de guardar/borrar se recalcula merchant.flows_active_triggers (syncFlowsIndex),
// que es lo único que mira emitFlowEvent en el camino del cobro.
import { db, resolveMerchantAccess } from "./firebase.js";
import { rateLimit } from "./ratelimit.js";
import { sanitizeFlow, defaultFlow, sanitizeAutoEmails, AUTO_EMAIL_BY_ID, AUTO_EMAIL_TRIGGER, autoFlowId, autoFlowSystem, FLOW_MAX_FLOWS } from "../../shared/platform/flows.js";
import { syncFlowsIndex, sendFlowTest } from "./flows.js";

const flowsCol = (mid) => db().collection("merchants").doc(mid).collection("flows");

// El recupero de carritos viene PRENDIDO de fábrica en toda tienda nueva: es el
// flujo que más plata devuelve y nadie lo prende solo (27-sept-2026, Thiago).
//
// Se siembra UNA vez por tienda (`flows_seeded_at`): si el comerciante después
// lo pausa o lo borra, no se lo volvemos a meter. Y solo sale ACTIVO si tiene
// cargado el mail de atención al cliente — sin eso, el mail saldría sin a quién
// responderle, que es la regla de todos los flujos.
async function sembrarFlujosPorDefecto(mid) {
  try {
    const mRef = db().collection("merchants").doc(mid);
    const m = (await mRef.get()).data() || {};
    if (m.flows_seeded_at) return;
    const now = new Date().toISOString();
    // Tienda que ya armó algo: no le tocamos nada, solo marcamos que ya pasamos.
    if (!(await flowsCol(mid).limit(1).get()).empty) { await mRef.set({ flows_seeded_at: now }, { merge: true }); return; }

    const puedeMandar = EMAIL_RE.test(String(m.email_reply_to || m.shop_email || "").trim());
    const { flow } = sanitizeFlow({ ...defaultFlow("checkout_started"), active: puedeMandar });
    if (!flow) { await mRef.set({ flows_seeded_at: now }, { merge: true }); return; }
    await flowsCol(mid).add({ ...flow, created_at: now, updated_at: now, seeded: true });
    await mRef.set({ flows_seeded_at: now }, { merge: true });
    if (puedeMandar) await syncFlowsIndex(mid);
  } catch (e) {
    // Sembrar es una comodidad: si falla, la tienda abre Flujos igual.
    console.warn("[flows] no pude sembrar el flujo por defecto:", e?.message || e);
  }
}
const runsCol = (mid) => db().collection("merchants").doc(mid).collection("flow_runs");
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function flowsApi(ctx, action, req, res) {
  const mid = ctx.merchantId;
  // Permiso de equipo "flujos": /api/merchant no pide sección, así que lo exigimos
  // acá. Un miembro sin esa sección no ve, edita ni prueba flujos. Dueños sin cambios.
  if (ctx.role === "member") {
    const acc = await resolveMerchantAccess(ctx.uid, mid, "flujos");
    if (!acc.ok) return res.status(acc.code || 403).json({ error: acc.error, code: "merchant_forbidden" });
  }
  try {
    if (action === "flows") {
      await sembrarFlujosPorDefecto(mid);
      const snap = await flowsCol(mid).get();
      const flows = await Promise.all(snap.docs.map(async (d) => {
        let running = 0;
        try { running = (await runsCol(mid).where("flow_id", "==", d.id).where("status", "==", "waiting").count().get()).data().count; } catch (_) {}
        return { id: d.id, ...d.data(), running };
      }));
      flows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return res.json({ flows, max_flows: FLOW_MAX_FLOWS });
    }

    // Guardar un mail automático: el texto del mail AL INSTANTE y, si le colgó
    // mails para más tarde, el flujo de sistema que los manda. Los dos en una
    // sola llamada: para el comerciante es una sola pantalla.
    if (action === "auto-email-save") {
      const id = String(req.body?.id || "").trim();
      const def = AUTO_EMAIL_BY_ID[id];
      if (!def) return res.status(400).json({ error: "Ese mail automático no existe" });

      const mRef = db().collection("merchants").doc(mid);
      const m = (await mRef.get()).data() || {};

      // 1) El texto del mail al instante (parcial; null lo devuelve al de fábrica).
      const propio = req.body?.email === null ? null : {
        ...(m.auto_emails || {}),
        [id]: { subject: req.body?.email?.subject, body: req.body?.email?.body, cta_label: req.body?.email?.cta_label },
      };
      if (propio === null) {
        const resto = Object.fromEntries(Object.entries(m.auto_emails || {}).filter(([k]) => k !== id));
        await mRef.set({ auto_emails: Object.keys(resto).length ? resto : null }, { merge: true });
      } else {
        const r = sanitizeAutoEmails(propio);
        if (r.error) return res.status(400).json({ error: r.error });
        await mRef.set({ auto_emails: r.auto_emails }, { merge: true });
      }

      // 2) Los mails de después. Sin pasos, se borra el flujo.
      const pasos = Array.isArray(req.body?.steps) ? req.body.steps : [];
      const ref = flowsCol(mid).doc(autoFlowId(id));
      const now = new Date().toISOString();
      if (!pasos.length) {
        await ref.delete().catch(() => {});
      } else {
        // Igual que cualquier flujo: sin mail de atención al cliente no sale.
        if (!EMAIL_RE.test(String(m.email_reply_to || "").trim())) {
          return res.status(400).json({ error: "Antes de agregar mails más tarde, cargá el mail de atención al cliente de tu tienda (arriba, en Flujos de email).", code: "support_email_required" });
        }
        const { flow, error } = sanitizeFlow({
          name: def.name, trigger: AUTO_EMAIL_TRIGGER[id], active: true, system: autoFlowSystem(id), steps: pasos,
        });
        if (error) return res.status(400).json({ error });
        const existe = (await ref.get()).exists;
        await ref.set({ ...flow, updated_at: now, ...(existe ? {} : { created_at: now }) }, { merge: true });
      }
      await syncFlowsIndex(mid);
      return res.json({ ok: true });
    }

    if (action === "flow-save") {
      const input = req.body?.flow || {};
      const { flow, error } = sanitizeFlow(input);
      if (error) return res.status(400).json({ error });
      // Los mails salen de una dirección que no recibe respuestas: al pie va el mail de
      // atención al cliente de la tienda (email_reply_to). Sin él no se activa un flujo.
      if (flow.active) {
        const m = (await db().collection("merchants").doc(mid).get()).data() || {};
        if (!EMAIL_RE.test(String(m.email_reply_to || "").trim())) {
          return res.status(400).json({ error: "Antes de activar un flujo, cargá el mail de atención al cliente de tu tienda (arriba, en Flujos de email).", code: "support_email_required" });
        }
      }
      const now = new Date().toISOString();
      const id = String(input.id || "").trim();
      let ref;
      if (id) {
        if (!ID_RE.test(id)) return res.status(400).json({ error: "id inválido" });
        ref = flowsCol(mid).doc(id);
        if (!(await ref.get()).exists) return res.status(404).json({ error: "Ese flujo ya no existe" });
        await ref.set({ ...flow, updated_at: now }, { merge: true });
      } else {
        const count = (await flowsCol(mid).count().get()).data().count;
        if (count >= FLOW_MAX_FLOWS) return res.status(400).json({ error: `Máximo ${FLOW_MAX_FLOWS} flujos por tienda` });
        ref = flowsCol(mid).doc();
        await ref.set({ ...flow, stats: { entered: 0, sent: 0, completed: 0, exited: 0, converted: 0 }, created_at: now, updated_at: now, created_by: ctx.uid || null });
      }
      await syncFlowsIndex(mid);
      const saved = await ref.get();
      return res.json({ ok: true, flow: { id: ref.id, ...saved.data() } });
    }

    if (action === "flow-delete") {
      const id = String(req.body?.id || "").trim();
      if (!ID_RE.test(id)) return res.status(400).json({ error: "id inválido" });
      await flowsCol(mid).doc(id).delete();
      await syncFlowsIndex(mid);
      return res.json({ ok: true });
    }

    // Prueba de un mail automático con el texto que está editando (sin guardar).
    if (action === "auto-email-test") {
      const to = String(ctx.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Tu cuenta no tiene un mail para mandarte la prueba" });
      const rl = await rateLimit(`flowtest:${mid}`, { limit: 20, windowSec: 86400 });
      if (!rl.ok) return res.status(429).json({ error: "Tope de 20 mails de prueba por día alcanzado" });
      const merchant = (await db().collection("merchants").doc(mid).get()).data() || {};
      const { sendAutoEmailTest } = await import("./flows.js");
      const r = await sendAutoEmailTest(mid, merchant, {
        id: String(req.body?.id || ""), subject: req.body?.subject, body: req.body?.body, cta_label: req.body?.cta_label, to,
      });
      if (r?.skipped) return res.status(503).json({ error: "El envío de mails no está configurado todavía (falta RESEND_API_KEY)" });
      if (!r?.ok) return res.status(502).json({ error: r?.error || "No se pudo enviar el mail de prueba" });
      return res.json({ ok: true, to });
    }

    if (action === "flow-test") {
      const { flow, error } = sanitizeFlow({ trigger: req.body?.trigger, steps: [req.body?.step || {}] });
      if (error) return res.status(400).json({ error });
      const step = flow.steps.find(s => s.type === "email");
      const to = String(ctx.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(to)) return res.status(400).json({ error: "Tu cuenta no tiene un mail para mandarte la prueba" });
      const rl = await rateLimit(`flowtest:${mid}`, { limit: 20, windowSec: 86400 });
      if (!rl.ok) return res.status(429).json({ error: "Tope de 20 mails de prueba por día alcanzado" });
      const merchant = (await db().collection("merchants").doc(mid).get()).data() || {};
      const r = await sendFlowTest(mid, merchant, { step, to });
      if (r?.skipped) return res.status(503).json({ error: "El envío de mails no está configurado todavía (falta RESEND_API_KEY)" });
      if (!r?.ok) return res.status(502).json({ error: r?.error || "No se pudo enviar el mail de prueba" });
      return res.json({ ok: true, to });
    }

    return res.status(400).json({ error: "action de flujos no reconocida" });
  } catch (e) {
    console.error(`[flows-api] ${action} ${mid}:`, e.message);
    return res.status(500).json({ error: e.message });
  }
}
