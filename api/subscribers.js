// /api/subscribers — CRUD de suscriptores del merchant logueado.
//
//   GET                                  → lista de subs (con filtros opcionales)
//   GET /api/subscribers?id=<subId>      → detalle de un sub
//   PATCH /api/subscribers?id=<subId>    → actualizar estado (pause | resume | cancel)
//
// Las acciones pause/cancel se reflejan en MP via mpUpdatePreapproval.
import { db, requireAuth } from "./_lib/firebase.js";
import { mpUpdatePreapproval, mpGetPreapproval } from "./_lib/mp.js";
import { syncSubscriber } from "./_lib/sync.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const merchantRef = db().collection("merchants").doc(uid);
  const subsCol = merchantRef.collection("subscribers");

  // POST ?action=sync&id=X — sincronización MANUAL de UN sub específico. Solo
  // se usa como escape hatch desde el modal de detalle (botón "⟳ Sincronizar"),
  // para el caso raro en que el webhook MP haya fallado. El trigger normal de
  // activación de subs es siempre el webhook MP a nivel cuenta del merchant.
  if (req.method === "POST" && req.query.action === "sync" && req.query.id) {
    try {
      const r = await syncSubscriber(uid, String(req.query.id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST ?action=link-payment&id=SUB&payment_id=PID
  // Escape hatch para cuando MP indexa mal y el sync no encuentra el payment
  // pero el merchant lo ve en su panel. Pega el ID y procesamos directo.
  if (req.method === "POST" && req.query.action === "link-payment" && req.query.id) {
    const { payment_id } = req.body || {};
    if (!payment_id) return res.status(400).json({ error: "Falta payment_id" });
    try {
      const { linkPaymentToSubscriber } = await import("./_lib/sync.js");
      const r = await linkPaymentToSubscriber(uid, String(req.query.id), String(payment_id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    const id = req.query.id;
    if (id) {
      const snap = await subsCol.doc(String(id)).get();
      if (!snap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
      // Traemos también el historial de cargos del subscriber
      const chargesSnap = await merchantRef.collection("charges")
        .where("subscriber_id", "==", String(id))
        .get();
      const charges = chargesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return res.json({ subscriber: { id: snap.id, ...snap.data() }, charges });
    }
    // Listar con filtros: status, plan_id, email
    let q = subsCol;
    if (req.query.status) q = q.where("status", "==", String(req.query.status));
    if (req.query.plan_id) q = q.where("plan_id", "==", String(req.query.plan_id));
    const snap = await q.get();
    let subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (req.query.email) {
      const emailQ = String(req.query.email).toLowerCase();
      subs = subs.filter(s => (s.customer_email || "").toLowerCase().includes(emailQ));
    }
    subs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return res.json({ subscribers: subs });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const { action } = req.body || {};
    if (!["pause", "resume", "cancel"].includes(action)) {
      return res.status(400).json({ error: "action debe ser pause | resume | cancel" });
    }

    const subRef = subsCol.doc(String(id));
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
    const sub = subSnap.data();

    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};
    if (!merchant.mp_access_token) return res.status(400).json({ error: "MP no conectado" });
    if (!sub.mp_preapproval_id) return res.status(400).json({ error: "Subscriber sin preapproval MP" });

    const mpStatusMap = { pause: "paused", resume: "authorized", cancel: "cancelled" };
    const newMpStatus = mpStatusMap[action];

    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: newMpStatus });
    } catch (e) {
      return res.status(502).json({ error: `MP: ${e.message}` });
    }

    const localStatus = action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "active";
    await subRef.update({
      status: localStatus,
      updated_at: new Date().toISOString(),
      ...(action === "cancel" ? { cancelled_at: new Date().toISOString() } : {}),
    });
    return res.json({ ok: true, status: localStatus });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
