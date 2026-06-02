// GET /api/stats — métricas para el dashboard Home del merchant.
//
// Calcula on-the-fly desde subscribers + charges:
//   - MRR (monthly recurring revenue normalizado a 30 días)
//   - Suscriptores activos / pausados / cancelados / pending
//   - Cobros del mes en curso (count + $)
//   - Cobros del mes anterior (para % delta)
//   - Churn rate del último mes (cancelados / activos al inicio del mes)
//   - Próximos cobros estimados (subscribers active con next_charge_at en
//     los próximos 7 días)
//   - Subs nuevos en los últimos 7 / 30 días
//
// Sin cache — recalcula en cada request. Para merchants con miles de subs
// habría que indexar por status + cachear, pero MVP no necesita.
import { db, requireAuth } from "./_lib/firebase.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const uid = await requireAuth(req, res);
  if (!uid) return;

  try {
    const merchantRef = db().collection("merchants").doc(uid);

    // Traer todos los subs + charges en paralelo
    const [subsSnap, chargesSnap] = await Promise.all([
      merchantRef.collection("subscribers").get(),
      merchantRef.collection("charges").get(),
    ]);
    const subs = subsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const charges = chargesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // ── Conteos por status ──
    const byStatus = { active: 0, paused: 0, cancelled: 0, pending: 0, payment_failed: 0, other: 0 };
    for (const s of subs) {
      const k = s.status && byStatus[s.status] !== undefined ? s.status : "other";
      byStatus[k]++;
    }

    // ── MRR ── (suma plan_snapshot.total_per_charge_ars normalizado a 30 días)
    //
    // Usamos total_per_charge_ars (precio FINAL que MP cobra en cada ciclo —
    // incluye envío + multiplicador de cantidad) en vez de subscription_price_ars
    // (que es solo el precio del producto por unidad, sin envío ni qty).
    // El MRR debe reflejar lo que realmente entra a la cuenta MP del merchant.
    let mrr = 0;
    for (const s of subs) {
      if (s.status !== "active") continue;
      const qty = s.quantity || s.plan_snapshot?.units_per_shipment || 1;
      const total = s.plan_snapshot?.total_per_charge_ars
                    || ((s.plan_snapshot?.subscription_price_ars || 0) * qty);
      const freqDays = s.plan_snapshot?.frequency_days || 30;
      // monto por 30 días = total * (30 / freq_days). Suscripción cada 15d
      // genera 2 cobros de $X por mes → MRR = 2X. Cada 60d → 0.5X.
      mrr += total * (30 / freqDays);
    }
    mrr = Math.round(mrr);

    // ── Cobros del mes actual + mes anterior ──
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    let thisMonthCount = 0, thisMonthAmount = 0;
    let lastMonthCount = 0, lastMonthAmount = 0;
    let totalAmount = 0;
    for (const c of charges) {
      if (c.error) continue; // solo OK
      const ts = c.created_at || "";
      totalAmount += c.amount_ars || 0;
      if (ts >= startOfThisMonth) {
        thisMonthCount++;
        thisMonthAmount += c.amount_ars || 0;
      } else if (ts >= startOfLastMonth) {
        lastMonthCount++;
        lastMonthAmount += c.amount_ars || 0;
      }
    }

    // ── Subs nuevos últimos 7 / 30 días ──
    const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString();
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    let new7 = 0, new30 = 0;
    for (const s of subs) {
      const ts = s.created_at || "";
      if (ts >= cutoff7) new7++;
      if (ts >= cutoff30) new30++;
    }

    // ── Cancelados últimos 30 días + churn rate ──
    let cancelled30 = 0;
    for (const s of subs) {
      if (s.status !== "cancelled") continue;
      const ts = s.cancelled_at || s.updated_at || "";
      if (ts >= cutoff30) cancelled30++;
    }
    // Churn = cancelados / (activos + cancelados del periodo)
    const churnDenom = byStatus.active + cancelled30;
    const churnRate = churnDenom > 0 ? (cancelled30 / churnDenom) * 100 : 0;

    // ── Próximos cobros (subs active con next_charge_at en los próximos 7 días) ──
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString();
    const upcomingCharges = subs
      .filter(s => s.status === "active" && s.next_charge_at && s.next_charge_at <= nextWeek)
      .map(s => ({
        subscriber_id: s.id,
        customer_email: s.customer_email,
        customer_name: s.customer_name,
        product_title: s.plan_snapshot?.product_title || "—",
        amount_ars: s.plan_snapshot?.subscription_price_ars || 0,
        date: s.next_charge_at,
      }))
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""));

    return res.json({
      mrr,
      totals: {
        subscribers: subs.length,
        ...byStatus,
      },
      revenue: {
        all_time: Math.round(totalAmount),
        this_month: { count: thisMonthCount, amount: Math.round(thisMonthAmount) },
        last_month: { count: lastMonthCount, amount: Math.round(lastMonthAmount) },
        delta_pct: lastMonthAmount > 0 ? Math.round(((thisMonthAmount - lastMonthAmount) / lastMonthAmount) * 100) : null,
      },
      growth: { new_7d: new7, new_30d: new30, cancelled_30d: cancelled30, churn_rate_pct: Math.round(churnRate * 10) / 10 },
      upcoming_charges: upcomingCharges.slice(0, 10),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
