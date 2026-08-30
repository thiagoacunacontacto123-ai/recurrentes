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

  if (req.query.action === "activity") return activity(uid, res);

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

// GET /api/stats?action=activity — 3 tablas para el dashboard:
//   mails  → cada email enviado (abandono paso 1/2/3, activación, cancelación, pago fallido)
//   envios → cada orden Shopify generada por un cobro
//   cobros → cada cobro MP (facturación) con totales hoy / mes
async function activity(uid, res) {
  try {
    const mRef = db().collection("merchants").doc(uid);
    const [mSnap, subsSnap, chargesSnap, mailsSnap] = await Promise.all([
      mRef.get(),
      mRef.collection("subscribers").get(),
      mRef.collection("charges").get(),
      mRef.collection("email_log").get(),
    ]);
    const merchant = mSnap.data() || {};
    const shop = merchant.shopify_shop || null;
    // Mapa sub → datos de cliente (para nombrar cobros/envíos)
    const subMap = {};
    subsSnap.docs.forEach(d => { const s = d.data(); subMap[d.id] = { name: s.customer_name || "", email: s.customer_email || "", product: s.plan_snapshot?.product_title || "" }; });

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // ── MAILS ──
    const mails = mailsSnap.docs.map(d => { const m = d.data(); return {
      id: d.id, type: m.type, step: m.step || null, coupon: m.coupon || null,
      to: m.to, customer_name: m.customer_name || subMap[m.subscriber_id]?.name || "",
      product_title: m.product_title || subMap[m.subscriber_id]?.product || "",
      status: m.status || "sent", created_at: m.created_at || "",
    }; }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const mailSummary = { total: 0, abandoned_1: 0, abandoned_2: 0, abandoned_3: 0, activation: 0, cancellation: 0, payment_failed: 0 };
    for (const m of mails) {
      if (m.status === "error") continue;
      mailSummary.total++;
      if (m.type === "abandoned") {
        // Solo pasos reales de mail (1/2/3). Cualquier otro valor (ej. 99 = comprador
        // salteado) se cuenta como paso 1 para no romper el resumen.
        const st = (m.step === 2 || m.step === 3) ? m.step : 1;
        mailSummary["abandoned_" + st]++;
      } else if (mailSummary[m.type] !== undefined) mailSummary[m.type]++;
    }

    // ── COBROS (facturación) + ENVÍOS (órdenes) ──
    const cobros = [];
    const envios = [];
    let todayCount = 0, todayAmount = 0, monthCount = 0, monthAmount = 0, allAmount = 0;
    for (const d of chargesSnap.docs) {
      const c = d.data();
      const cust = subMap[c.subscriber_id] || {};
      const ts = c.created_at || "";
      const ok = !c.error && c.status !== "rejected";
      cobros.push({
        id: d.id, amount: c.amount_ars || 0, status: c.error ? "error" : (c.status || "approved"),
        customer_name: cust.name || "", customer_email: cust.email || "",
        product_title: cust.product || "", order_id: c.shopify_order_id || null,
        error: c.error || null, created_at: ts,
      });
      if (ok) {
        allAmount += c.amount_ars || 0;
        if (ts >= startToday) { todayCount++; todayAmount += c.amount_ars || 0; }
        if (ts >= startMonth) { monthCount++; monthAmount += c.amount_ars || 0; }
      }
      if (c.shopify_order_id) {
        envios.push({
          id: d.id, order_id: c.shopify_order_id,
          order_url: shop ? `https://${shop}/admin/orders/${c.shopify_order_id}` : null,
          customer_name: cust.name || "", customer_email: cust.email || "",
          product_title: cust.product || "", created_at: ts,
        });
      }
    }
    cobros.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    envios.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));

    const envioMonth = envios.filter(e => (e.created_at || "") >= startMonth).length;

    return res.json({
      mails: mails.slice(0, 200),
      mail_summary: mailSummary,
      envios: envios.slice(0, 200),
      envio_summary: { total: envios.length, this_month: envioMonth },
      cobros: cobros.slice(0, 200),
      cobro_summary: {
        today: { count: todayCount, amount: Math.round(todayAmount) },
        this_month: { count: monthCount, amount: Math.round(monthAmount) },
        all_time: Math.round(allAmount),
      },
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
