import { useState, useEffect, useMemo } from "react";
import { apiGet, apiPost } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { KPI, Btn, DSBadge, Spinner, DSTable, CellStack, PageHeader, SubTabs, Loading, appConfirm, toast } from "../ui/components.jsx";
import { OnbEmpty } from "./Onboarding.jsx";
import { TIPS } from "../lib/onboarding.js";
import { MONO, fmtARS, fmtDateTime, fmtDateOnly, ExtLink, mpPaymentUrl, shopifyOrderUrl, orderLabel, weekBucket, hashQuery } from "./_shared.jsx";

// ─── Próximos cobros: GET /api/charges?view=upcoming con fallback a los subs
// activos (next_charge_at ≤ 30 días) si el backend todavía no lo tiene.
export async function fetchUpcoming() {
  const d = await apiGet("charges", { view: "upcoming" });
  const list = d && !d.error ? (Array.isArray(d.upcoming) ? d.upcoming : (Array.isArray(d.items) ? d.items : null)) : null;
  if (list) return list;
  const s = await apiGet("subscribers", { status: "active" });
  const limit = new Date(Date.now() + 30 * 86400000).toISOString();
  return (s?.subscribers || [])
    .filter(x => x.next_charge_at && x.next_charge_at <= limit)
    .map(x => ({ subscriber_id: x.id, email: x.customer_email, name: x.customer_name, plan_title: x.plan_snapshot?.product_title || "—", amount_ars: x.plan_snapshot?.total_per_charge_ars || ((x.plan_snapshot?.subscription_price_ars || 0) * (x.quantity || 1)), next_charge_at: x.next_charge_at }))
    .sort((a, b) => String(a.next_charge_at).localeCompare(String(b.next_charge_at)));
}

// ─── Cobros con error: GET /api/charges?view=errors con fallback al listado.
export async function fetchErrors(processed = null) {
  const d = await apiGet("charges", { view: "errors" });
  if (d && !d.error && Array.isArray(d.charges)) return d.charges;
  const list = processed || (await apiGet("charges", { limit: 200 }))?.charges || [];
  return list.filter(c => c.error);
}

// ─── Página: Cobros ────────────────────────────────────────────────
export function ChargesPage({ shop = null }) {
  const T = useT();
  const [view, setView] = useState(() => { const v = hashQuery().get("view"); return ["processed", "upcoming", "errors"].includes(v) ? v : "processed"; });
  const [charges, setCharges] = useState([]);
  const [totals, setTotals] = useState({ amount_ars:0, ok:0, failed:0, total:0 });
  const [upcoming, setUpcoming] = useState([]);
  const [errors, setErrors] = useState([]);
  const [thisMonth, setThisMonth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [retrying, setRetrying] = useState(null);

  async function loadProcessed(more = false) {
    const params = { limit: 200 };
    if (more && cursor) params.cursor = cursor;
    const d = await apiGet("charges", params);
    const list = d?.charges || [];
    setCharges(prev => more ? [...prev, ...list] : list);
    setCursor(d?.next_cursor || null);
    if (!more) setTotals(d?.totals || { amount_ars:0, ok:0, failed:0, total:0 });
    return list;
  }
  async function loadAll() {
    setLoading(true);
    try {
      const [list, up, st] = await Promise.all([loadProcessed(false), fetchUpcoming().catch(() => []), apiGet("stats").catch(() => null)]);
      setUpcoming(up);
      setErrors(await fetchErrors(list).catch(() => []));
      if (st && !st.error) setThisMonth(st.revenue?.this_month || null);
      else {
        const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
        const m = list.filter(c => !c.error && (c.created_at || "") >= start);
        setThisMonth({ count: m.length, amount: m.reduce((a, c) => a + (c.amount_ars || 0), 0) });
      }
    } finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  // Reintenta la orden Shopify de un charge que quedó con error (mismo payment_id).
  async function retryOrder(c) {
    if (!c.subscriber_id || !c.mp_payment_id) return toast("Este cobro no tiene suscriptor o payment_id asociado.", "warning");
    const ok = await appConfirm(`Se vuelve a intentar crear la orden con el mismo payment_id.`, { title:`¿Reintentar la orden Shopify del cobro MP ${c.mp_payment_id}?`, okLabel:"Reintentar" });
    if (!ok) return;
    setRetrying(c.id);
    try {
      const d = await apiPost("subscribers", { id: c.subscriber_id, payment_id: String(c.mp_payment_id) }, { action: "retry-order" });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.shopify_order_id) toast(`Orden Shopify #${d.shopify_order_id} creada`, "success");
      else toast(`No se pudo crear la orden: ${d.shopify_error || d.error || d.status || "sin detalle"}`, "error", 7000);
      loadAll();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setRetrying(null); }
  }

  const upcomingTotal = useMemo(() => upcoming.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0), [upcoming]);
  const weeks = useMemo(() => {
    const map = new Map();
    for (const u of upcoming) {
      const { idx, label } = weekBucket(u.next_charge_at);
      if (!map.has(idx)) map.set(idx, { idx, label, items: [], total: 0 });
      const w = map.get(idx); w.items.push(u); w.total += Number(u.amount_ars) || 0;
    }
    return [...map.values()].sort((a, b) => a.idx - b.idx);
  }, [upcoming]);

  const customerCell = (c) => <CellStack T={T} main={c.customer_name || c.name || c.customer_email || c.email || (c.subscriber_id ? `Sub ${String(c.subscriber_id).slice(0, 8)}…` : "—")} sub={(c.customer_name || c.name) ? (c.customer_email || c.email) : (c.plan_title || c.product_title || "")}/>;

  const processedCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateTime(c.created_at)}</span> },
    { key:"cliente", label:"Cliente", render: customerCell },
    { key:"monto", label:"Monto", nowrap:true, align:"right", render: c => <span style={{ fontWeight:DS.w.black, fontSize:DS.font.lg, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</span> },
    { key:"mp", label:"Pago MP", nowrap:true, hideMobile:true, render: c => c.mp_payment_id ? <ExtLink T={T} href={mpPaymentUrl(c.mp_payment_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{c.mp_payment_id}</ExtLink> : <span style={{ color:T.textSm }}>—</span> },
    { key:"orden", label:"Orden", nowrap:true, render: c => c.shopify_order_id
        ? <ExtLink T={T} href={shopifyOrderUrl(shop, c.shopify_order_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{orderLabel(c.shopify_order_id)}</ExtLink>
        : <span style={{ color:T.textSm }}>—</span> },
    { key:"estado", label:"Estado", render: c => c.error ? (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:5, maxWidth:320 }}>
        <span title={c.error} style={{ cursor:"help" }}><DSBadge T={T} color={T.red} size="sm">✗ Falló</DSBadge></span>
        <span style={{ fontSize:DS.font.sm, color:T.red, lineHeight:1.35, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }} title={c.error}>{c.error}</span>
      </div>
    ) : <DSBadge T={T} color={T.green} size="sm">✓ OK</DSBadge> },
  ];

  const errorCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateTime(c.created_at)}</span> },
    { key:"cliente", label:"Cliente", render: customerCell },
    { key:"monto", label:"Monto", nowrap:true, align:"right", render: c => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</span> },
    { key:"mp", label:"Pago MP", nowrap:true, hideMobile:true, render: c => c.mp_payment_id ? <ExtLink T={T} href={mpPaymentUrl(c.mp_payment_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{c.mp_payment_id}</ExtLink> : <span style={{ color:T.textSm }}>—</span> },
    { key:"error", label:"Error", render: c => <span style={{ fontSize:DS.font.sm, color:T.red, lineHeight:1.35, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden", maxWidth:360 }} title={c.error}>{c.error || "—"}</span> },
    { key:"accion", label:"", align:"right", nowrap:true, render: c => c.shopify_order_id
        ? <ExtLink T={T} href={shopifyOrderUrl(shop, c.shopify_order_id)}>{orderLabel(c.shopify_order_id)}</ExtLink>
        : <Btn T={T} variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); retryOrder(c); }} disabled={retrying === c.id} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>{retrying === c.id ? <><Spinner size={10} color={T.textMd}/> Reintentando…</> : "↻ Reintentar orden"}</Btn> },
  ];

  const upcomingCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: u => <span style={{ color:T.text }}>{fmtDateOnly(u.next_charge_at)}</span> },
    { key:"cliente", label:"Cliente", render: u => <CellStack T={T} main={u.name || u.email} sub={u.name ? u.email : ""}/> },
    { key:"plan", label:"Plan", hideMobile:true, render: u => <span style={{ color:T.textMd }}>{u.plan_title || "—"}</span> },
    { key:"monto", label:"Monto", align:"right", nowrap:true, render: u => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(u.amount_ars)}</span> },
  ];

  const tabs = [
    { id:"processed", label:"Procesados", count: totals.total || (charges.length || undefined) },
    { id:"upcoming",  label:"Próximos",   count: upcoming.length },
    { id:"errors",    label:"Con error",  count: errors.length },
  ];
  const first = loading && charges.length === 0;

  return (
    <div>
      <PageHeader T={T} title="Cobros" subtitle="Lo que Mercado Pago cobró, lo que viene y lo que falló. Cada cobro OK genera una orden en Shopify."
        right={<Btn T={T} variant="secondary" size="sm" onClick={loadAll} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>}/>

      <div className="kpi-grid gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp.xl }}>
        <KPI T={T} compact label="Cobrado este mes" value={fmtARS(thisMonth?.amount)} sub={`${thisMonth?.count || 0} cobros · histórico ${fmtARS(totals.amount_ars)}`} accent color={T.accent} loading={first}/>
        <KPI T={T} compact label="Próximos 30 días" value={fmtARS(upcomingTotal)} sub={`${upcoming.length} cobro${upcoming.length === 1 ? "" : "s"} programado${upcoming.length === 1 ? "" : "s"}`} color={T.text} loading={first} onClick={() => setView("upcoming")}/>
        <KPI T={T} compact label="Con error" value={errors.length} sub={errors.length ? "órdenes sin crear en Shopify" : "todo en orden"} color={errors.length ? T.red : T.text} loading={first} onClick={() => setView("errors")}/>
      </div>

      <div style={{ marginBottom:DS.sp.lg }}>
        <SubTabs T={T} tabs={tabs} active={view} onChange={setView}/>
      </div>

      {first ? <Loading T={T}/> : view === "processed" ? (
        charges.length === 0 ? (
          <OnbEmpty section="cobros" icon="💸" title="Todavía no tenés cobros" desc="Aparecen acá cuando Mercado Pago procesa el primer pago de una suscripción, y después cada renovación." tip={TIPS.chargesEmpty}/>
        ) : (
          <DSTable T={T} columns={processedCols} rows={charges} rowKey={c => c.id} minWidth={820}
            footer={<>
              <span>{charges.length} cobro{charges.length === 1 ? "" : "s"} · {totals.ok} OK · {totals.failed} con error</span>
              {cursor && <Btn T={T} variant="secondary" size="sm" onClick={() => loadProcessed(true)} disabled={loading}>{loading ? <><Spinner size={11} color={T.textMd}/> Cargando…</> : "Cargar más"}</Btn>}
            </>}/>
        )
      ) : view === "upcoming" ? (
        upcoming.length === 0 ? (
          <OnbEmpty section="cobros" icon="📅" title="No hay cobros programados" desc="Cuando tengas suscripciones activas, acá ves qué va a cobrar Mercado Pago en los próximos 30 días, semana por semana."/>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
            {weeks.map(w => (
              <div key={w.idx}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, marginBottom:8, padding:"0 2px" }}>
                  <div style={{ fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{w.label} <span style={{ color:T.textSm, fontWeight:DS.w.medium }}>· {w.items.length} cobro{w.items.length === 1 ? "" : "s"}</span></div>
                  <div style={{ fontSize:DS.font.base, fontWeight:DS.w.black, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(w.total)}</div>
                </div>
                <DSTable T={T} columns={upcomingCols} rows={w.items} rowKey={(u, i) => (u.subscriber_id || "u") + "-" + i} dense minWidth={560}/>
              </div>
            ))}
            <div style={{ fontSize:DS.font.sm, color:T.textSm, padding:"0 2px" }}>Las fechas las define Mercado Pago según el ciclo de cada suscripción; pueden moverse 1-2 días.</div>
          </div>
        )
      ) : (
        errors.length === 0 ? (
          <OnbEmpty section="cobros" icon="✅" title="Sin cobros con error" desc="Si un cobro de MP no logra crear la orden en Shopify, aparece acá con el botón para reintentar."/>
        ) : (
          <DSTable T={T} columns={errorCols} rows={errors} rowKey={c => c.id} minWidth={760}
            footer={<span>{errors.length} cobro{errors.length === 1 ? "" : "s"} con error</span>}/>
        )
      )}
    </div>
  );
}

// Compat con el nombre anterior.
export const ChargesTab = ChargesPage;
