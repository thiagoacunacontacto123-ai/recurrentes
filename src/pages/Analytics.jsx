import { useState, useEffect, useMemo } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, KPI, Btn, DSBadge, Spinner, DSTable, PageHeader, SubTabs, CardHeader, Loading, Tip, Callout } from "../ui/components.jsx";
import { OnbEmpty } from "./Onboarding.jsx";
import { fmtARS, fmtPct, downloadCsv } from "./_shared.jsx";

// GET /api/stats?action=analytics&months=N. Si el backend todavía no lo tiene,
// armamos lo básico desde GET /api/stats (sin mensual ni motivos).
export async function fetchAnalytics(months = 6) {
  const d = await apiGet("stats", { action: "analytics", months });
  if (d && !d.error && (d.monthly || d.mrr != null)) return { ...d, _fallback: false };
  const s = await apiGet("stats");
  if (!s || s.error) return null;
  return {
    _fallback: true,
    mrr: s.mrr || 0, mrr_prev_month: null,
    active: s.totals?.active || 0, paused: s.totals?.paused || 0, payment_failed: s.totals?.payment_failed || 0,
    new_30d: s.growth?.new_30d || 0, cancelled_30d: s.growth?.cancelled_30d || 0, churn_30d_pct: s.growth?.churn_rate_pct || 0,
    ltv_avg: null, avg_charges_per_sub: null,
    next_30d: null, monthly: [], cancel_reasons: [], recovery: null,
  };
}

const MONTH_LABEL = (ym) => { try { const [y, m] = String(ym).split("-").map(Number); return new Date(y, (m || 1) - 1, 1).toLocaleDateString("es-AR", { month:"short" }).replace(".", ""); } catch (_) { return ym; } };
const REASON_LABELS = { sin_motivo:"Sin motivo", precio:"Me resulta caro", stock:"Todavía tengo producto", no_uso:"Ya no lo uso", calidad:"No me convenció", otro:"Otro motivo", too_expensive:"Muy caro", too_much:"Tengo de sobra", quality:"No me gustó el producto", shipping:"Problemas con el envío", switching:"Cambio a otra marca", temporary:"Es temporal", other:"Otro" };

function Delta({ T, cur, prev, invert = false, suffix = "" }) {
  if (typeof cur !== "number" || typeof prev !== "number" || !prev) return <span style={{ color:T.textSm }}>sin mes anterior</span>;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  const good = invert ? pct <= 0 : pct >= 0;
  return <DSBadge T={T} color={good ? T.green : T.red} size="sm">{pct >= 0 ? "↑" : "↓"} {Math.abs(pct)}%{suffix} vs mes anterior</DSBadge>;
}

// ─── Gráfico: barras de revenue + línea de activos (SVG puro) ──────────
function MonthlyChart({ T, monthly }) {
  const [hover, setHover] = useState(null);
  const W = 720, H = 240, padL = 56, padR = 44, padT = 16, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = monthly.length || 1;
  const maxRev = Math.max(1, ...monthly.map(m => Number(m.revenue_ars) || 0));
  const maxAct = Math.max(1, ...monthly.map(m => Number(m.active_end) || 0));
  const bw = Math.min(48, (iw / n) * 0.55);
  const xc = (i) => padL + (iw / n) * (i + 0.5);
  const yRev = (v) => padT + ih - (v / maxRev) * ih;
  const yAct = (v) => padT + ih - (v / maxAct) * ih;
  const line = monthly.map((m, i) => `${i === 0 ? "M" : "L"}${xc(i).toFixed(1)},${yAct(Number(m.active_end) || 0).toFixed(1)}`).join(" ");
  const ticks = [0, 0.5, 1];
  const fmtK = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`;
  const h = hover != null ? monthly[hover] : null;
  return (
    <div style={{ position:"relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display:"block", maxWidth:"100%", fontFamily:"'Inter',system-ui,sans-serif" }} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={yRev(maxRev * t)} y2={yRev(maxRev * t)} stroke={T.borderL} strokeDasharray={t === 0 ? "" : "3 4"}/>
            <text x={padL - 8} y={yRev(maxRev * t) + 4} textAnchor="end" fontSize="10" fill={T.textSm}>{fmtK(maxRev * t)}</text>
            <text x={W - padR + 8} y={yAct(maxAct * t) + 4} textAnchor="start" fontSize="10" fill={T.textSm}>{Math.round(maxAct * t)}</text>
          </g>
        ))}
        {monthly.map((m, i) => {
          const v = Number(m.revenue_ars) || 0; const y = yRev(v);
          const active = hover === i;
          return (
            <g key={m.month || i} onMouseEnter={() => setHover(i)}>
              <rect x={xc(i) - (iw / n) / 2} y={padT} width={iw / n} height={ih} fill="transparent"/>
              <rect x={xc(i) - bw / 2} y={y} width={bw} height={Math.max(0, padT + ih - y)} rx="5" fill={T.accentSolid} opacity={active ? 1 : 0.78}/>
              <text x={xc(i)} y={H - 10} textAnchor="middle" fontSize="11" fill={active ? T.text : T.textSm} fontWeight={active ? 700 : 500}>{MONTH_LABEL(m.month)}</text>
            </g>
          );
        })}
        {monthly.length > 1 && <path d={line} fill="none" stroke={T.blue} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>}
        {monthly.map((m, i) => <circle key={"c" + i} cx={xc(i)} cy={yAct(Number(m.active_end) || 0)} r={hover === i ? 5 : 3.5} fill={T.card} stroke={T.blue} strokeWidth="2.2" pointerEvents="none"/>)}
      </svg>
      {h && (
        <div style={{ position:"absolute", top:6, left:"50%", transform:"translateX(-50%)", background:T.card, border:`1px solid ${T.border}`, borderRadius:DS.r.md, padding:"6px 10px", fontSize:DS.font.sm, color:T.textMd, boxShadow:DS.shadow?.md || "0 4px 14px rgba(0,0,0,.2)", pointerEvents:"none", whiteSpace:"nowrap" }}>
          <strong style={{ color:T.text }}>{MONTH_LABEL(h.month)}</strong> · <span style={{ color:T.accent, fontWeight:700 }}>{fmtARS(h.revenue_ars)}</span> · <span style={{ color:T.blue, fontWeight:700 }}>{h.active_end ?? 0} activos</span> · +{h.new || 0} / −{h.cancelled || 0}
        </div>
      )}
      <div style={{ display:"flex", gap:14, justifyContent:"center", fontSize:DS.font.sm, color:T.textSm, marginTop:4 }}>
        <span><span style={{ display:"inline-block", width:10, height:10, borderRadius:3, background:T.accentSolid, marginRight:5, verticalAlign:-1 }}/>Cobrado por mes</span>
        <span><span style={{ display:"inline-block", width:10, height:3, borderRadius:2, background:T.blue, marginRight:5, verticalAlign:2 }}/>Activos al cierre</span>
      </div>
    </div>
  );
}

// ─── Página: Analíticas ────────────────────────────────────────────
export function AnalyticsPage({ merchant }) {
  const T = useT();
  const [months, setMonths] = useState(6);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load(m = months) {
    setLoading(true);
    try {
      const d = await fetchAnalytics(m);
      if (!d) setErr("No pudimos cargar las métricas"); else { setData(d); setErr(""); }
    } catch (e) { setErr(e.message || "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(months); /* eslint-disable-next-line */ }, [months]);

  const a = data || {};
  const monthly = Array.isArray(a.monthly) ? a.monthly : [];
  const reasons = Array.isArray(a.cancel_reasons) ? a.cancel_reasons : [];
  const reasonLabel = useMemo(() => {
    const map = { ...REASON_LABELS };
    for (const r of (merchant?.retention?.reasons || [])) if (r?.code) map[r.code] = r.label || r.code;
    return (code) => map[code] || code || "Sin motivo";
  }, [merchant]);
  const totalReasons = reasons.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const prevMonth = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
  const curMonth = monthly.length >= 1 ? monthly[monthly.length - 1] : null;
  const hasData = (a.active || 0) + (a.paused || 0) + (a.new_30d || 0) + monthly.reduce((s, m) => s + (Number(m.revenue_ars) || 0), 0) > 0;

  function exportCsv() {
    downloadCsv(`analiticas-${months}m-${new Date().toISOString().slice(0, 10)}.csv`, ["mes", "cobrado_ars", "nuevas", "canceladas", "activas_cierre"], monthly.map(m => [m.month, Math.round(m.revenue_ars || 0), m.new || 0, m.cancelled || 0, m.active_end || 0]));
  }

  const kpiLabel = (text, tip) => <span style={{ display:"inline-flex", alignItems:"center" }}>{text}<Tip T={T} text={tip}/></span>;

  return (
    <div>
      <PageHeader T={T} title="Analíticas" subtitle="Cómo viene el negocio recurrente: ingresos, base de suscriptores, churn y recupero."
        right={<>
          <SubTabs T={T} tabs={[{ id:6, label:"6 meses" }, { id:12, label:"12 meses" }]} active={months} onChange={setMonths}/>
          <Btn T={T} variant="secondary" size="sm" onClick={exportCsv} disabled={monthly.length === 0}>⬇ CSV mensual</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={() => load()} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"}</Btn>
        </>}/>

      {err && !loading && <Callout T={T} tone="danger" title="No pudimos cargar las métricas" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={() => load()}>Reintentar</Btn>}>{err}</Callout>}
      {a._fallback && !loading && <Callout T={T} tone="info" style={{ marginBottom:16 }}>El histórico mensual y los motivos de cancelación se habilitan cuando el backend de analíticas esté publicado. Mientras tanto ves las métricas básicas.</Callout>}

      {!loading && data && !hasData ? (
        <OnbEmpty section="analiticas" icon="📈" title="Todavía no hay datos para analizar" desc="Cuando tengas suscripciones activas y cobros, acá ves MRR, churn, LTV y la evolución mes a mes."/>
      ) : (
        <>
          {/* Fila 1: 4 KPIs con delta */}
          <div className="kpi-grid gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp.md }}>
            <KPI T={T} label={kpiLabel("MRR", "Ingresos mensuales recurrentes: suma de lo que cobra cada suscripción activa, normalizado a 30 días. Incluye envío y cantidad.")} value={fmtARS(a.mrr)} accent color={T.accent} loading={loading}
              sub={<Delta T={T} cur={a.mrr} prev={a.mrr_prev_month}/>}/>
            <KPI T={T} label={kpiLabel("Activos", "Suscripciones en estado activo hoy. Las pausadas y con pago fallido no cuentan.")} value={a.active ?? 0} color={T.text} loading={loading}
              sub={<span style={{ display:"inline-flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>{a.paused || 0} pausadas · {a.payment_failed || 0} con pago fallido {curMonth && prevMonth && <Delta T={T} cur={Number(curMonth.active_end)} prev={Number(prevMonth.active_end)}/>}</span>}/>
            <KPI T={T} label={kpiLabel("Nuevos 30d", "Suscripciones que se activaron en los últimos 30 días.")} value={a.new_30d ?? 0} color={T.green} loading={loading}
              sub={curMonth && prevMonth ? <Delta T={T} cur={Number(curMonth.new)} prev={Number(prevMonth.new)}/> : "últimos 30 días"}/>
            <KPI T={T} label={kpiLabel("Churn 30d", "Canceladas en 30 días ÷ (activas + canceladas del período). Menos es mejor.")} value={fmtPct(Number(a.churn_30d_pct) || 0)} color={(a.churn_30d_pct || 0) > 5 ? T.red : T.text} loading={loading}
              sub={<span style={{ display:"inline-flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>{a.cancelled_30d || 0} cancelaciones {curMonth && prevMonth && <Delta T={T} cur={Number(curMonth.cancelled)} prev={Number(prevMonth.cancelled)} invert/>}</span>}/>
          </div>
          {/* Fila 2 */}
          <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp["2xl"] }}>
            <KPI T={T} compact label={kpiLabel("LTV promedio", "Lo que cobró en promedio cada suscriptor a lo largo de su vida (total cobrado ÷ suscriptores con al menos un cobro).")} value={a.ltv_avg != null ? fmtARS(a.ltv_avg) : "—"} color={T.text} loading={loading}/>
            <KPI T={T} compact label={kpiLabel("Cobros por suscriptor", "Promedio de cobros OK por suscriptor. Sube con la retención.")} value={a.avg_charges_per_sub != null ? Number(a.avg_charges_per_sub).toFixed(1) : "—"} color={T.text} loading={loading}/>
            <KPI T={T} compact label={kpiLabel("Próximos 30 días", "Lo que Mercado Pago tiene programado cobrar en los próximos 30 días según el ciclo de cada suscripción activa.")} value={fmtARS(a.next_30d?.amount_ars)} sub={`${a.next_30d?.count || 0} cobros`} color={T.accent} loading={loading}/>
            <KPI T={T} compact label={kpiLabel("Recupero de pagos fallidos", "De los cobros que MP rechazó en 30 días, cuántos terminaron cobrándose (reintento de MP o tarjeta actualizada).")} value={a.recovery ? `${a.recovery.recovered_30d || 0}/${a.recovery.failed_30d || 0}` : "—"} sub={a.recovery?.failed_30d ? fmtPct((a.recovery.recovered_30d / a.recovery.failed_30d) * 100, 0) + " recuperado" : "sin fallidos"} color={T.text} loading={loading}/>
          </div>

          {/* Gráfico mensual */}
          <Card T={T} style={{ marginBottom:DS.sp.lg }}>
            <CardHeader T={T} title="Evolución mensual" sub={`Cobrado por mes (barras) y suscripciones activas al cierre (línea), últimos ${months} meses.`}/>
            {loading ? <Loading T={T}/> : monthly.length === 0 ? (
              <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"18px 0", textAlign:"center" }}>Sin histórico todavía.</div>
            ) : <MonthlyChart T={T} monthly={monthly}/>}
          </Card>

          <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
            {/* Tabla mensual */}
            <Card T={T} padding="sm" style={{ padding:0, overflow:"hidden" }}>
              <div style={{ padding:"14px 16px 6px" }}><CardHeader T={T} title="Mes a mes" style={{ marginBottom:0 }}/></div>
              <DSTable T={T} rows={[...monthly].reverse()} rowKey={m => m.month} dense minWidth={420} style={{ border:"none", borderRadius:0, boxShadow:"none" }} emptyText="Sin histórico" columns={[
                { key:"mes", label:"Mes", nowrap:true, render: m => <span style={{ fontWeight:DS.w.semibold, textTransform:"capitalize" }}>{MONTH_LABEL(m.month)} {String(m.month).slice(0, 4)}</span> },
                { key:"rev", label:"Cobrado", align:"right", nowrap:true, render: m => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(m.revenue_ars)}</span> },
                { key:"new", label:"Nuevas", align:"right", nowrap:true, render: m => <span style={{ color:T.green }}>+{m.new || 0}</span> },
                { key:"can", label:"Bajas", align:"right", nowrap:true, render: m => <span style={{ color: m.cancelled ? T.red : T.textSm }}>−{m.cancelled || 0}</span> },
                { key:"act", label:"Activas", align:"right", nowrap:true, render: m => <span style={{ color:T.textMd }}>{m.active_end ?? "—"}</span> },
              ]}/>
            </Card>

            {/* Motivos de cancelación */}
            <Card T={T} padding="sm" style={{ padding:0, overflow:"hidden" }}>
              <div style={{ padding:"14px 16px 6px" }}><CardHeader T={T} title="Motivos de cancelación" sub="Lo que eligen tus clientes al cancelar desde el portal." style={{ marginBottom:0 }}/></div>
              <DSTable T={T} rows={[...reasons].sort((x, y) => (y.count || 0) - (x.count || 0))} rowKey={r => r.code || "sin"} dense minWidth={360} style={{ border:"none", borderRadius:0, boxShadow:"none" }} emptyText="Todavía no hay cancelaciones con motivo. Activá la encuesta en Retención." columns={[
                { key:"motivo", label:"Motivo", render: r => <span style={{ fontWeight:DS.w.semibold }}>{reasonLabel(r.code)}</span> },
                { key:"n", label:"Cant.", align:"right", nowrap:true, render: r => <span style={{ fontVariantNumeric:"tabular-nums" }}>{r.count || 0}</span> },
                { key:"pct", label:"%", align:"right", nowrap:true, render: r => (
                  <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}>
                    <span style={{ width:70, height:6, background:T.border, borderRadius:99, overflow:"hidden", display:"inline-block" }}><span style={{ display:"block", height:"100%", width:`${totalReasons ? Math.round(((r.count || 0) / totalReasons) * 100) : 0}%`, background:T.red }}/></span>
                    <span style={{ fontVariantNumeric:"tabular-nums", color:T.textMd }}>{totalReasons ? Math.round(((r.count || 0) / totalReasons) * 100) : 0}%</span>
                  </span>) },
              ]}/>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
