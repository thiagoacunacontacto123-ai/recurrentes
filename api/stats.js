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
// Sin cache — recalcula en cada request. Charges acotados a los últimos 400
// (o al rango ?from&to): revenue.all_time es "de esa ventana", no histórico.
//
// GET /api/stats?action=analytics&months=6[&fresh=1] → analíticas de retención
// (MRR, churn, LTV, próximos cobros, serie mensual, motivos de baja, recupero).
// Cache 10 min en merchants/{mid}.analytics_cache { at, months, data }.
import { db, requireMerchant } from "./_lib/firebase.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { merchantId } = ctx;

  if (req.query.action === "activity") return activity(merchantId, req, res);
  if (req.query.action === "analytics") return analytics(merchantId, req, res);

  try {
    const merchantRef = db().collection("merchants").doc(merchantId);

    // Subs completos + charges acotados: por rango (?from&to) o últimos 400.
    // Requiere índice charges (created_at desc) — ver firestore.indexes.json.
    const chargesQ = chargesRange(merchantRef.collection("charges"), req.query);
    const [subsSnap, chargesSnap] = await Promise.all([
      merchantRef.collection("subscribers").get(),
      chargesQ.get(),
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
//   mails  → cada email enviado (activación, cancelación, pago fallido; abandono = histórico)
//   klaviyo_events → últimos 200 eventos mandados a Klaviyo (+ klaviyo_summary {sent,error})
//   envios → cada orden Shopify generada por un cobro
//   cobros → cada cobro MP (facturación) con totales hoy / mes
async function activity(merchantId, req, res) {
  try {
    const mRef = db().collection("merchants").doc(merchantId);
    // Lecturas acotadas: charges por rango o últimos 400, mails últimos 200.
    const [mSnap, subsSnap, chargesSnap, mailsSnap, klaviyoSnap] = await Promise.all([
      mRef.get(),
      mRef.collection("subscribers").get(),
      chargesRange(mRef.collection("charges"), req.query).get(),
      mRef.collection("email_log").orderBy("created_at", "desc").limit(200).get(),
      // Eventos mandados a Klaviyo (best-effort: si falla la query, tabla vacía).
      mRef.collection("klaviyo_log").orderBy("created_at", "desc").limit(200).get().catch(e => { console.warn("[stats] klaviyo_log:", e.message); return { docs: [] }; }),
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
      status: m.status || "sent", error: m.error || null, created_at: m.created_at || "",
    }; }).sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const mailSummary = { total: 0, abandoned_1: 0, abandoned_2: 0, abandoned_3: 0, activation: 0, cancellation: 0, payment_failed: 0, error: 0 };
    for (const m of mails) {
      // Errores de envío: columna aparte, no se cuentan como mandados.
      if (m.status === "error") { mailSummary.error++; continue; }
      mailSummary.total++;
      if (m.type === "abandoned") {
        // Solo pasos reales de mail (1/2/3). Cualquier otro valor (ej. 99 = comprador
        // salteado) se cuenta como paso 1 para no romper el resumen.
        const st = (m.step === 2 || m.step === 3) ? m.step : 1;
        mailSummary["abandoned_" + st]++;
      } else if (mailSummary[m.type] !== undefined) mailSummary[m.type]++;
    }

    // ── EVENTOS KLAVIYO ──
    const klaviyoEvents = klaviyoSnap.docs.map(d => { const k = d.data(); return {
      id: d.id, metric: k.metric || "", email: k.email || "", subscriber_id: k.subscriber_id || null,
      customer_name: subMap[k.subscriber_id]?.name || "",
      status: k.status || "sent", http_status: k.http_status ?? null, error: k.error || null, created_at: k.created_at || "",
    }; });
    const klaviyoSummary = { sent: 0, error: 0 };
    for (const k of klaviyoEvents) { if (k.status === "error") klaviyoSummary.error++; else klaviyoSummary.sent++; }

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
          // rec_<payment_id> = cobro sin tienda (servicios / link de pago): no hay orden que linkear.
          order_url: shop && !String(c.shopify_order_id).startsWith("rec_") ? `https://${shop}/admin/orders/${c.shopify_order_id}` : null,
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
      klaviyo_events: klaviyoEvents,
      klaviyo_summary: klaviyoSummary,
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

// Charges acotados: si vienen ?from=YYYY-MM-DD&to=YYYY-MM-DD filtra por
// created_at (ISO string, comparación lexicográfica); si no, últimos 400.
function chargesRange(col, query = {}) {
  const from = String(query.from || "").slice(0, 10);
  const to = String(query.to || "").slice(0, 10);
  let q = col.orderBy("created_at", "desc");
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) q = q.where("created_at", ">=", from);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) q = q.where("created_at", "<=", to + "T23:59:59.999Z");
  return q.limit(from || to ? 2000 : 400);
}


// ─── GET ?action=analytics&months=N ─────────────────────────────────────────
// Lecturas acotadas: subs completos (ya se leen en el Home) + charges de los
// últimos N meses por rango de created_at (índice simple) + cancellations (≤ 500).
// Respuesta (todos los montos en ARS enteros):
//   { mrr, mrr_prev_month, active, paused, payment_failed, new_30d, cancelled_30d,
//     churn_30d_pct, ltv_avg, avg_charges_per_sub,
//     next_30d: { count, amount_ars, by_week:[{week, from, to, count, amount_ars}×4] },
//     monthly: [{ month:"YYYY-MM", revenue_ars, charges, new, cancelled, active_end }] (N, viejo→nuevo),
//     cancel_reasons: [{ code, count, saved }], recovery: { failed_30d, recovered_30d, recovery_pct },
//     months, generated_at, cached }
const ANALYTICS_CACHE_MS = 10 * 60 * 1000;
const isSimCharge = (id, c) => c.simulated === true || String(c.mp_payment_id || "").startsWith("SIM-") || /-SIM$/.test(String(id));
const monthKey = (iso) => String(iso || "").slice(0, 7);

async function analytics(merchantId, req, res) {
  const months = Math.min(Math.max(parseInt(req.query.months) || 6, 1), 24);
  const fresh = req.query.fresh === "1";
  const mRef = db().collection("merchants").doc(merchantId);
  try {
    const mSnap = await mRef.get();
    const merchant = mSnap.data() || {};
    const c = merchant.analytics_cache;
    if (!fresh && c && c.months === months && c.data && c.at && Date.now() - Date.parse(c.at) < ANALYTICS_CACHE_MS) {
      return res.json({ ...c.data, cached: true });
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const windowStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const windowStartIso = windowStart.toISOString();
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const cutoff90 = new Date(Date.now() - 90 * 86400000).toISOString();

    const [subsSnap, chargesSnap, cancelSnap] = await Promise.all([
      mRef.collection("subscribers").get(),
      mRef.collection("charges").where("created_at", ">=", windowStartIso).orderBy("created_at", "desc").limit(5000).get(),
      mRef.collection("cancellations").orderBy("created_at", "desc").limit(500).get().catch(e => { console.warn("[analytics] cancellations:", e.message); return { docs: [] }; }),
    ]);
    const subs = subsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const charges = chargesSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(ch => !isSimCharge(ch.id, ch));
    const approved = charges.filter(ch => !ch.status || ch.status === "approved");

    // Monto por ciclo y MRR (mismo criterio que el Home: total_per_charge normalizado a 30 días).
    const perCharge = (s) => {
      const qty = s.quantity || s.plan_snapshot?.units_per_shipment || 1;
      return s.plan_snapshot?.total_per_charge_ars || ((s.plan_snapshot?.subscription_price_ars || 0) * qty);
    };
    const mrrOf = (s) => perCharge(s) * (30 / (s.plan_snapshot?.frequency_days || 30));
    // ¿Estaba "viva" (cobrando) en el instante T? Aproximación por fechas del sub:
    // alta (created_at) ≤ T y no cancelada antes de T. Los pending (leads) no cuentan.
    const startedBy = (s, tIso) => (s.first_charge_at || s.activated_at || s.created_at || "") <= tIso;
    const cancelledBy = (s, tIso) => s.status === "cancelled" && (s.cancelled_at || s.updated_at || "") <= tIso;
    // "Alguna vez cobró": last_charge_at, órdenes, o un status operativo (subs viejas
    // activadas por webhooks que no guardaban last_charge_at).
    const everCharged = (s) => !!s.last_charge_at || (Array.isArray(s.shopify_orders) && s.shopify_orders.length > 0) || ["active", "paused", "payment_failed"].includes(s.status);
    const aliveAt = (s, tIso) => s.status !== "pending" && everCharged(s) && startedBy(s, tIso) && !cancelledBy(s, tIso);

    let mrr = 0, mrrPrev = 0;
    const counts = { active: 0, paused: 0, payment_failed: 0, cancelled: 0, pending: 0 };
    const prevMonthEndIso = new Date(startOfThisMonth.getTime() - 1).toISOString();
    for (const s of subs) {
      if (counts[s.status] !== undefined) counts[s.status]++;
      if (s.status === "active") mrr += mrrOf(s);
      if (aliveAt(s, prevMonthEndIso) && s.status !== "paused") mrrPrev += mrrOf(s);
    }

    // Altas / bajas 30 días + churn.
    const new30 = subs.filter(s => s.status !== "pending" && (s.created_at || "") >= cutoff30).length;
    const cancelled30 = subs.filter(s => s.status === "cancelled" && (s.cancelled_at || s.updated_at || "") >= cutoff30).length;
    const churnDenom = counts.active + counts.paused + counts.payment_failed + cancelled30;
    const churn30 = churnDenom > 0 ? (cancelled30 / churnDenom) * 100 : 0;

    // Cobros por sub (ventana) + LTV. Total cobrado por sub = charges aprobados en la
    // ventana; si la sub tiene más órdenes que charges en ventana (historia previa),
    // se estima orders × monto por ciclo. Universo LTV: canceladas o activas > 90 días.
    const chargedBySub = {};
    const chargeCountBySub = {};
    for (const ch of approved) {
      const sid = ch.subscriber_id || "";
      chargedBySub[sid] = (chargedBySub[sid] || 0) + (Number(ch.amount_ars) || 0);
      chargeCountBySub[sid] = (chargeCountBySub[sid] || 0) + 1;
    }
    const totalChargedOf = (s) => {
      const orders = Array.isArray(s.shopify_orders) ? s.shopify_orders.length : 0;
      const inWindow = chargeCountBySub[s.id] || 0;
      if (orders > inWindow) return Math.max(chargedBySub[s.id] || 0, orders * perCharge(s));
      return chargedBySub[s.id] || 0;
    };
    const ltvUniverse = subs.filter(s => (s.status === "cancelled" && s.last_charge_at) || (s.status === "active" && (s.created_at || "") <= cutoff90));
    const ltvAvg = ltvUniverse.length ? ltvUniverse.reduce((t, s) => t + totalChargedOf(s), 0) / ltvUniverse.length : 0;
    const withCharges = subs.filter(s => s.status !== "pending" && (s.last_charge_at || (s.shopify_orders || []).length));
    const chargesPerSub = withCharges.map(s => Math.max((s.shopify_orders || []).length, chargeCountBySub[s.id] || 0));
    const avgCharges = chargesPerSub.length ? chargesPerSub.reduce((t, n) => t + n, 0) / chargesPerSub.length : 0;

    // Próximos 30 días por semana (0-7, 7-14, 14-21, 21-30).
    const in30 = new Date(Date.now() + 30 * 86400000).toISOString();
    const byWeek = [0, 7, 14, 21].map((from, i) => ({
      week: i + 1,
      from: new Date(Date.now() + from * 86400000).toISOString(),
      to: new Date(Date.now() + (i === 3 ? 30 : from + 7) * 86400000).toISOString(),
      count: 0, amount_ars: 0,
    }));
    let nextCount = 0, nextAmount = 0;
    for (const s of subs) {
      if (s.status !== "active" || !s.next_charge_at || s.next_charge_at > in30) continue;
      const amt = perCharge(s);
      nextCount++; nextAmount += amt;
      const w = byWeek.find(b => s.next_charge_at < b.to) || byWeek[0]; // vencidas → semana 1
      w.count++; w.amount_ars += amt;
    }
    byWeek.forEach(b => { b.amount_ars = Math.round(b.amount_ars); });

    // Serie mensual (viejo → nuevo).
    const monthly = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const endIso = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
      const mCharges = approved.filter(ch => monthKey(ch.created_at) === key);
      monthly.push({
        month: key,
        revenue_ars: Math.round(mCharges.reduce((t, ch) => t + (Number(ch.amount_ars) || 0), 0)),
        charges: mCharges.length,
        new: subs.filter(s => s.status !== "pending" && monthKey(s.created_at) === key).length,
        cancelled: subs.filter(s => s.status === "cancelled" && monthKey(s.cancelled_at || s.updated_at) === key).length,
        active_end: subs.filter(s => aliveAt(s, endIso < nowIso ? endIso : nowIso)).length,
      });
    }

    // Motivos de baja (cancellations) + cuántas se salvaron con la oferta de pausa.
    const reasons = {};
    for (const d of cancelSnap.docs) {
      const x = d.data() || {};
      const code = String(x.reason_code || "sin_motivo");
      reasons[code] = reasons[code] || { code, count: 0, saved: 0 };
      reasons[code].count++;
      if (x.saved === true) reasons[code].saved++;
    }
    const cancelReasons = Object.values(reasons).sort((a, b) => b.count - a.count);
    const saved30 = cancelSnap.docs.filter(d => { const x = d.data() || {}; return x.saved === true && String(x.saved_at || x.created_at || "") >= cutoff30; }).length;

    // Recupero de pagos rechazados: fallaron en 30d vs. de esas, hoy activas con cobro posterior.
    const failed30 = subs.filter(s => (s.last_payment_failed_at || "") >= cutoff30);
    const recovered30 = failed30.filter(s => s.status === "active" && (s.last_charge_at || "") > (s.last_payment_failed_at || ""));

    const data = {
      mrr: Math.round(mrr),
      mrr_prev_month: Math.round(mrrPrev),
      active: counts.active,
      paused: counts.paused,
      payment_failed: counts.payment_failed,
      cancelled: counts.cancelled,
      new_30d: new30,
      cancelled_30d: cancelled30,
      churn_30d_pct: Math.round(churn30 * 10) / 10,
      ltv_avg: Math.round(ltvAvg),
      ltv_subs: ltvUniverse.length,
      avg_charges_per_sub: Math.round(avgCharges * 10) / 10,
      next_30d: { count: nextCount, amount_ars: Math.round(nextAmount), by_week: byWeek },
      monthly,
      cancel_reasons: cancelReasons,
      saved_30d: saved30,
      recovery: {
        failed_30d: failed30.length,
        recovered_30d: recovered30.length,
        recovery_pct: failed30.length ? Math.round((recovered30.length / failed30.length) * 1000) / 10 : 0,
      },
      months,
      charges_in_window: charges.length,
      generated_at: nowIso,
    };
    mRef.set({ analytics_cache: { at: nowIso, months, data } }, { merge: true }).catch(e => console.warn("[analytics] cache:", e.message));
    return res.json({ ...data, cached: false });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
