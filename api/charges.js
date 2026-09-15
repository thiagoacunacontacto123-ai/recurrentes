// GET /api/charges?subscriber_id=<opt>&limit=<opt>&cursor=<opt>
//
// Historial de cobros (charges) del merchant. Cada vez que MP procesa un
// payment de una sub, se guarda un charge con el monto + orden Shopify
// asociada. Sirve para auditoría y resolución de problemas.
// Paginado: orderBy created_at desc, limit (≤200) + cursor (= created_at del
// último). Devuelve `error` del charge para mostrarlo en el dashboard.
//
// Vistas:
//   ?view=upcoming → { upcoming:[{subscriber_id,email,name,plan_title,amount_ars,next_charge_at}],
//                      count, amount_ars }  — subs activas con next_charge_at en los próximos
//                      30 días (?days=1..90), ordenadas por fecha.
//   ?view=errors   → { charges:[…], count } — charges con `error` (orden Shopify que falló)
//                      de los últimos 60 días (?days=1..180), más recientes primero.
import { db, requireMerchant } from "./_lib/firebase.js";

const subAmount = (s) => {
  const qty = s.quantity || s.plan_snapshot?.units_per_shipment || 1;
  return Math.round(s.plan_snapshot?.total_per_charge_ars || ((s.plan_snapshot?.subscription_price_ars || 0) * qty));
};

async function viewUpcoming(merchantRef, req, res) {
  const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 90);
  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + days * 86400000).toISOString();
  let docs;
  try {
    // Índice compuesto status + next_charge_at (firestore.indexes.json).
    docs = (await merchantRef.collection("subscribers").where("status", "==", "active").where("next_charge_at", "<=", untilIso).get()).docs;
  } catch (e) {
    if (!/FAILED_PRECONDITION|index/i.test(e.message || "")) throw e;
    docs = (await merchantRef.collection("subscribers").where("status", "==", "active").get()).docs;
  }
  const upcoming = docs
    .map(d => ({ id: d.id, ...d.data() }))
    // Vencidas de hace más de 1 día no son "próximas" (el cron las está persiguiendo).
    .filter(s => s.next_charge_at && s.next_charge_at <= untilIso && s.next_charge_at >= new Date(Date.now() - 86400000).toISOString())
    .map(s => ({
      subscriber_id: s.id,
      email: s.customer_email || null,
      name: s.customer_name || null,
      plan_title: s.plan_snapshot?.product_title || null,
      amount_ars: subAmount(s),
      next_charge_at: s.next_charge_at,
      overdue: s.next_charge_at < nowIso,
    }))
    .sort((a, b) => a.next_charge_at.localeCompare(b.next_charge_at));
  return res.json({ upcoming, count: upcoming.length, amount_ars: upcoming.reduce((t, u) => t + u.amount_ars, 0), days });
}

async function viewErrors(merchantRef, req, res) {
  const days = Math.min(Math.max(parseInt(req.query.days) || 60, 1), 180);
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();
  const col = merchantRef.collection("charges");
  let snap;
  try {
    // Solo los charges SIN orden (todo charge con error tiene shopify_order_id:null
    // explícito). Índice shopify_order_id + created_at desc; sin él, como antes.
    snap = await col.where("shopify_order_id", "==", null).where("created_at", ">=", sinceIso).orderBy("created_at", "desc").limit(2000).get();
  } catch (e) {
    if (!/FAILED_PRECONDITION|index/i.test(e.message || "")) throw e;
    snap = await col.where("created_at", ">=", sinceIso).orderBy("created_at", "desc").limit(2000).get();
  }
  const charges = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => c.error)
    .map(c => ({ ...c, kind: "shopify_error" }));
  return res.json({ charges, count: charges.length, days, since: sinceIso });
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res, "cobros");
  if (!ctx) return;
  const { merchantId } = ctx;

  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const merchantRef = db().collection("merchants").doc(merchantId);
  const view = String(req.query.view || "");
  if (view === "upcoming" || view === "errors") {
    try { return await (view === "upcoming" ? viewUpcoming : viewErrors)(merchantRef, req, res); }
    catch (e) { return res.status(500).json({ error: e.message }); }
  }
  if (view) return res.status(400).json({ error: "view debe ser upcoming | errors" });
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
