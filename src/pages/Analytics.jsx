import { useState, useEffect, useMemo } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, KPI, Btn, DSBadge, Spinner, DSTable, PageHeader, SubTabs, CardHeader, Loading, Tip, Callout } from "../ui/components.jsx";
import { KpiCard, Segmented, AreaChart } from "../ui/charts.jsx";
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

const MONTHS_KEY = "rec_analytics_months";
const PERIODS = [{ id:6, label:"6 meses" }, { id:12, label:"12 meses" }];
const readMonths = () => { try { const m = parseInt(localStorage.getItem(MONTHS_KEY)); return [6, 12].includes(m) ? m : 6; } catch (_) { return 6; } };
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtDM = (iso) => { try { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; } catch (_) { return ""; } };
const monthTick = (ym) => `${MONTH_LABEL(ym)} ${String(ym).slice(2, 4)}`;

// Barras horizontales (como "Mejores días" de Growith): etiqueta · barra · valor.
function BarList({ T, rows, color, fmt = fmtN, empty }) {
  if (!rows.length) return <div style={{ fontSize:DS.font.sm, color:T.textSm, padding:"6px 0 2px" }}>{empty}</div>;
  const max = Math.max(1, ...rows.map(r => Number(r.value) || 0));
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
      {rows.map(r => (
        <div key={r.key} style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(60px,120px) auto", alignItems:"center", gap:10, fontSize:DS.font.sm }}>
          <span style={{ color:T.textMd, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.label}>{r.label}</span>
          <span style={{ height:6, background:T.border, borderRadius:99, overflow:"hidden" }}>
            <span style={{ display:"block", height:"100%", width:`${Math.round(((Number(r.value) || 0) / max) * 100)}%`, background:color, borderRadius:99 }}/>
          </span>
          <span style={{ fontWeight:700, color:T.text, fontVariantNumeric:"tabular-nums", textAlign:"right", minWidth:70, whiteSpace:"nowrap" }}>
            {fmt(r.value)}{r.extra != null && <span style={{ color:T.textSm, fontWeight:500 }}> · {r.extra}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

// Panel de sección: título + bajada + contenido (flush = tabla pegada a los bordes).
function Panel({ T, title, sub, right, children, flush }) {
  return (
    <section style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"14px 16px 10px" }}>
        <div style={{ flex:1, minWidth:0 }}>
          <h3 style={{ margin:0, fontSize:14, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>{title}</h3>
          {sub && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.45 }}>{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ padding: flush ? 0 : "2px 16px 16px" }}>{children}</div>
    </section>
  );
}

// ─── Página: Analíticas — estilo Growith: KPIs con sparkline mensual,
// gráfico con pestañas, próximos 30 días por semana, motivos de baja y mes a mes.
export function AnalyticsPage({ merchant }) {
  const T = useT();
  const [months, setMonths] = useState(readMonths);
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
  const pickMonths = (m) => { setMonths(m); try { localStorage.setItem(MONTHS_KEY, String(m)); } catch (_) {} };

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
  const series = (key) => monthly.map(m => Number(m[key]) || 0);
  const first = loading && !data;

  function exportCsv() {
    downloadCsv(`analiticas-${months}m-${new Date().toISOString().slice(0, 10)}.csv`, ["mes", "cobrado_ars", "nuevas", "canceladas", "activas_cierre"], monthly.map(m => [m.month, Math.round(m.revenue_ars || 0), m.new || 0, m.cancelled || 0, m.active_end || 0]));
  }

  const kpiLabel = (text, tip) => <span style={{ display:"inline-flex", alignItems:"center" }}>{text}<Tip T={T} text={tip}/></span>;
  const chartTabs = [
    { id:"cobrado", label:"Cobrado", series:[{ key:"rev", label:"Cobrado por mes", color:T.accentSolid, values: series("revenue_ars"), fmt: fmtARS }] },
    { id:"activas", label:"Activas", series:[{ key:"act", label:"Activas al cierre", color:T.blue, values: series("active_end"), fmt: fmtN }] },
    { id:"altas", label:"Altas y bajas", series:[
      { key:"new", label:"Altas", color:T.green, values: series("new"), fmt: fmtN },
      { key:"can", label:"Bajas", color:T.red, values: series("cancelled"), fmt: fmtN },
    ] },
  ];
  const sum = (key) => series(key).reduce((x, y) => x + y, 0);
  const weekRows = (a.next_30d?.by_week || []).map(w => ({ key:"w" + w.week, label:`Semana ${w.week} · ${fmtDM(w.from)} al ${fmtDM(w.to)}`, value:w.amount_ars, extra:`${w.count} cobro${w.count === 1 ? "" : "s"}` }));
  const reasonRows = [...reasons].sort((x, y) => (y.count || 0) - (x.count || 0)).map(r => ({
    key: r.code || "sin", label: reasonLabel(r.code), value: Number(r.count) || 0,
    extra: `${totalReasons ? Math.round(((r.count || 0) / totalReasons) * 100) : 0}%${r.saved ? ` · ${r.saved} salvada${r.saved === 1 ? "" : "s"}` : ""}`,
  }));

  return (
    <div>
      <PageHeader T={T} title="Analíticas" subtitle="Cómo viene el negocio recurrente: ingresos, base de suscriptores, churn y recupero."
        right={<>
          <Segmented T={T} options={PERIODS} value={months} onChange={pickMonths} ariaLabel="Período"/>
          <Btn T={T} variant="secondary" size="sm" onClick={exportCsv} disabled={monthly.length === 0} style={{ height:34 }}>⬇ CSV mensual</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={() => load()} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>
        </>}/>

      {err && !loading && <Callout T={T} tone="danger" title="No pudimos cargar las métricas" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={() => load()}>Reintentar</Btn>}>{err}</Callout>}
      {a._fallback && !loading && <Callout T={T} tone="info" style={{ marginBottom:16 }}>El histórico mensual y los motivos de cancelación se habilitan cuando el backend de analíticas esté publicado. Mientras tanto ves las métricas básicas.</Callout>}

      {!loading && data && !hasData ? (
        <OnbEmpty section="analiticas" icon="📈" title="Todavía no hay datos para analizar" desc="Cuando tengas suscripciones activas y cobros, acá ves MRR, churn, LTV y la evolución mes a mes."/>
      ) : (
        <>
          {/* KPIs principales: delta vs mes anterior + sparkline mensual */}
          <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap:10, marginBottom:10 }}>
            <KpiCard T={T} hero loading={first} label={kpiLabel("MRR", "Ingresos mensuales recurrentes: suma de lo que cobra cada suscripción activa, normalizado a 30 días. Incluye envío y cantidad.")}
              value={fmtARS(a.mrr)} curr={a.mrr} prev={a.mrr_prev_month || null} valueColor={T.accent} color={T.accentSolid}
              hint="vs. cierre del mes pasado · línea: cobrado por mes" spark={series("revenue_ars")}/>
            <KpiCard T={T} hero loading={first} label={kpiLabel("Activas", "Suscripciones en estado activo hoy. Las pausadas y con pago fallido no cuentan.")}
              value={fmtN(a.active)} curr={curMonth ? Number(curMonth.active_end) : null} prev={prevMonth ? Number(prevMonth.active_end) : null} color={T.green}
              hint={`${fmtN(a.paused)} pausadas · ${fmtN(a.payment_failed)} con pago fallido`} spark={series("active_end")}/>
            <KpiCard T={T} hero loading={first} label={kpiLabel("Altas 30 días", "Suscripciones que se activaron en los últimos 30 días. El % compara este mes con el anterior.")}
              value={fmtN(a.new_30d)} curr={curMonth ? Number(curMonth.new) : null} prev={prevMonth ? Number(prevMonth.new) : null} color={T.accentSolid}
              hint="este mes vs. el anterior" spark={series("new")}/>
            <KpiCard T={T} hero loading={first} label={kpiLabel("Churn 30 días", "Canceladas en 30 días ÷ (activas + pausadas + con pago fallido + canceladas del período). Menos es mejor.")}
              value={`${(Number(a.churn_30d_pct) || 0).toLocaleString("es-AR", { maximumFractionDigits:1 })}%`} valueColor={(a.churn_30d_pct || 0) > 5 ? T.red : T.text} color={T.red}
              hint={`${fmtN(a.cancelled_30d)} baja${a.cancelled_30d === 1 ? "" : "s"} · línea: bajas por mes`} spark={series("cancelled")}/>
          </div>
          <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap:10, marginBottom:18 }}>
            <KpiCard T={T} loading={first} label={kpiLabel("LTV promedio", "Lo que cobró en promedio cada suscriptor a lo largo de su vida (total cobrado ÷ suscriptores con al menos un cobro).")}
              value={a.ltv_avg != null ? fmtARS(a.ltv_avg) : "—"} hint="por suscriptor" color={T.accentSolid}/>
            <KpiCard T={T} loading={first} label={kpiLabel("Cobros por suscriptor", "Promedio de cobros OK por suscriptor. Sube con la retención.")}
              value={a.avg_charges_per_sub != null ? Number(a.avg_charges_per_sub).toLocaleString("es-AR", { maximumFractionDigits:1 }) : "—"} hint="promedio de renovaciones" color={T.blue}/>
            <KpiCard T={T} loading={first} label={kpiLabel("Próximos 30 días", "Lo que Mercado Pago tiene programado cobrar en los próximos 30 días según el ciclo de cada suscripción activa.")}
              value={fmtARS(a.next_30d?.amount_ars)} hint={`${fmtN(a.next_30d?.count)} cobros programados`} color={T.accentSolid}/>
            <KpiCard T={T} loading={first} label={kpiLabel("Recupero de fallidos", "De los cobros que MP rechazó en 30 días, cuántos terminaron cobrándose (reintento de MP o tarjeta actualizada).")}
              value={a.recovery ? `${a.recovery.recovered_30d || 0}/${a.recovery.failed_30d || 0}` : "—"}
              hint={a.recovery?.failed_30d ? fmtPct((a.recovery.recovered_30d / a.recovery.failed_30d) * 100, 0) + " recuperado" : "sin pagos fallidos"} color={T.yellow}/>
          </div>

          {/* Evolución mensual */}
          <div style={{ marginBottom:18 }}>
            {first ? <Loading T={T}/> : (
              <AreaChart T={T} title={`Evolución · últimos ${months} meses`} tabs={chartTabs} dates={monthly.map(m => m.month)} fmtDate={monthTick} height={220}
                total={(tab) => tab.id === "cobrado" ? fmtARS(sum("revenue_ars")) : tab.id === "activas" ? `${fmtN(curMonth?.active_end)} activas` : `+${fmtN(sum("new"))} · −${fmtN(sum("cancelled"))}`}/>
            )}
          </div>

          <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.15fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
            {/* Mes a mes */}
            <Panel T={T} title="Mes a mes" sub="Lo cobrado, las altas, las bajas y las activas al cierre de cada mes." flush>
              <DSTable T={T} rows={[...monthly].reverse()} rowKey={m => m.month} dense minWidth={420} style={{ border:"none", borderRadius:0, boxShadow:"none", borderTop:`1px solid ${T.border}` }} emptyText="Sin histórico todavía" columns={[
                { key:"mes", label:"Mes", nowrap:true, render: m => <span style={{ fontWeight:DS.w.semibold, textTransform:"capitalize" }}>{MONTH_LABEL(m.month)} {String(m.month).slice(0, 4)}{m === curMonth && <span style={{ color:T.textSm, fontWeight:500, textTransform:"none" }}> (en curso)</span>}</span> },
                { key:"rev", label:"Cobrado", align:"right", nowrap:true, render: m => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(m.revenue_ars)}</span> },
                { key:"new", label:"Altas", align:"right", nowrap:true, render: m => <span style={{ color: m.new ? T.green : T.textSm, fontVariantNumeric:"tabular-nums" }}>+{m.new || 0}</span> },
                { key:"can", label:"Bajas", align:"right", nowrap:true, render: m => <span style={{ color: m.cancelled ? T.red : T.textSm, fontVariantNumeric:"tabular-nums" }}>−{m.cancelled || 0}</span> },
                { key:"act", label:"Activas", align:"right", nowrap:true, render: m => <span style={{ color:T.textMd, fontVariantNumeric:"tabular-nums" }}>{m.active_end ?? "—"}</span> },
              ]}/>
            </Panel>

            <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg, minWidth:0 }}>
              <Panel T={T} title="Próximos 30 días por semana" sub="Lo que Mercado Pago tiene programado cobrar. Las fechas pueden moverse 1-2 días.">
                <BarList T={T} rows={weekRows} color={T.accentSolid} fmt={fmtARS} empty="No hay cobros programados en los próximos 30 días."/>
              </Panel>
              <Panel T={T} title="Motivos de cancelación" sub="Lo que eligen tus clientes al cancelar desde el portal.">
                <BarList T={T} rows={reasonRows} color={T.red} empty="Todavía no hay cancelaciones con motivo. Activá la encuesta en Retención."/>
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
