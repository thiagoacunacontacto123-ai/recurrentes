// GET /api/charges?subscriber_id=<opt>&limit=<opt>&cursor=<opt>
//
// Historial de cobros (charges) del merchant. Cada vez que MP procesa un
// payment de una sub, se guarda un charge con el monto + orden Shopify
// asociada. Sirve para auditoría y resolución de problemas.
// Paginado: orderBy created_at desc, limit (≤200) + cursor (= created_at del
// último). Devuelve `error` del charge para mostrarlo en el dashboard.
import { db, requireMerchant } from "./_lib/firebase.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { merchantId } = ctx;

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const merchantRef = db().collection("merchants").doc(merchantId);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 200);
  let q = merchantRef.collection("charges");
  if (req.query.subscriber_id) {
    q = q.where("subscriber_id", "==", String(req.query.subscriber_id));
  }
  q = q.orderBy("created_at", "desc");
  if (req.query.cursor) q = q.startAfter(String(req.query.cursor));
  q = q.limit(limit + 1);

  try {
    let snap;
    try {
      snap = await q.get();
    } catch (e) {
      // Sin índice compuesto (subscriber_id + created_at) Firestore tira
      // FAILED_PRECONDITION: caemos a la query sin orderBy y ordenamos acá.
      if (!req.query.subscriber_id || !/FAILED_PRECONDITION|index/i.test(e.message || "")) throw e;
      console.warn("[charges] sin índice compuesto, fallback en memoria:", e.message.slice(0, 120));
      const all = await merchantRef.collection("charges").where("subscriber_id", "==", String(req.query.subscriber_id)).get();
      const docs = all.docs.sort((a, b) => String(b.data().created_at || "").localeCompare(String(a.data().created_at || "")));
      const start = req.query.cursor ? docs.findIndex(d => String(d.data().created_at || "") < String(req.query.cursor)) : 0;
      snap = { docs: docs.slice(Math.max(0, start), Math.max(0, start) + limit + 1) };
    }
    let charges = snap.docs.map(d => ({ id: d.id, ...d.data(), error: d.data().error || null }));
    const hasMore = charges.length > limit;
    charges = charges.slice(0, limit);
    const nextCursor = hasMore && charges.length ? (charges[charges.length - 1].created_at || null) : null;

    // Sumamos datos derivados (totales) para el header del panel — de la página actual.
    const totalAmount = charges.reduce((s, c) => s + (c.error ? 0 : (c.amount_ars || 0)), 0);
    const okCount = charges.filter(c => !c.error && c.shopify_order_id).length;
    const failedCount = charges.length - okCount;

    return res.json({
      charges,
      next_cursor: nextCursor,
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
