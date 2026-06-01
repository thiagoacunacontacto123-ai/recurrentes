// GET /api/charges?subscriber_id=<opt>&limit=<opt>
//
// Historial de cobros (charges) del merchant. Cada vez que MP procesa un
// payment de una sub, se guarda un charge con el monto + orden Shopify
// asociada. Sirve para auditoría y resolución de problemas.
import { db, requireAuth } from "./_lib/firebase.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const uid = await requireAuth(req, res);
  if (!uid) return;

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const merchantRef = db().collection("merchants").doc(uid);
  let q = merchantRef.collection("charges");
  if (req.query.subscriber_id) {
    q = q.where("subscriber_id", "==", String(req.query.subscriber_id));
  }

  try {
    const snap = await q.get();
    let charges = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    charges.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    charges = charges.slice(0, limit);

    // Sumamos datos derivados (totales) para el header del panel
    const totalAmount = charges.reduce((s, c) => s + (c.amount_ars || 0), 0);
    const okCount = charges.filter(c => !c.error && c.shopify_order_id).length;
    const failedCount = charges.length - okCount;

    return res.json({
      charges,
      totals: {
        amount_ars: totalAmount,
        ok: okCount,
        failed: failedCount,
        total: charges.length,
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
