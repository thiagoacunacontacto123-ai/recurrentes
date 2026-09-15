// Endpoints de flujos de email, vía /api/merchant (no suma funciones serverless):
//   GET  ?action=flows        → { flows:[{ id, …, running }], max_flows }
//   POST ?action=flow-save    { flow:{ id?, name, trigger, active, steps[], days_before? } } → { ok, flow }
//   POST ?action=flow-delete  { id } → las corridas en espera salen solas (flujo inexistente)
//   POST ?action=flow-test    { trigger, step } → ese mail, con datos de ejemplo, al mail del login (20/día)
// Después de guardar/borrar se recalcula merchant.flows_active_triggers (syncFlowsIndex),
// que es lo único que mira emitFlowEvent en el camino del cobro.
import { db, resolveMerchantAccess } from "./firebase.js";
import { rateLimit } from "./ratelimit.js";
import { sanitizeFlow, FLOW_MAX_FLOWS } from "../../shared/platform/flows.js";
import { syncFlowsIndex, sendFlowTest } from "./flows.js";

const flowsCol = (mid) => db().collection("merchants").doc(mid).collection("flows");
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
      const snap = await flowsCol(mid).get();
      const flows = await Promise.all(snap.docs.map(async (d) => {
        let running = 0;
        try { running = (await runsCol(mid).where("flow_id", "==", d.id).where("status", "==", "waiting").count().get()).data().count; } catch (_) {}
        return { id: d.id, ...d.data(), running };
      }));
      flows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      return res.json({ flows, max_flows: FLOW_MAX_FLOWS });
    }

    if (action === "flow-save") {
      const input = req.body?.flow || {};
      const { flow, error } = sanitizeFlow(input);
      if (error) return res.status(400).json({ error });
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
