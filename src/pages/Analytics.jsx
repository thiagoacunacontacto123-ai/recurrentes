import { useState, useEffect, useMemo } from "react";
import { useTabRefresh } from "../lib/tabs.js";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, KPI, Btn, DSBadge, Spinner, DSTable, PageHeader, SubTabs, CardHeader, Loading, Tip, Callout } from "../ui/components.jsx";
import { KpiCard, Segmented, AreaChart, BarList, Panel } from "../ui/charts.jsx";
import DateRangePicker, { PRESETS_MESES, rangoDePreset, hoyAR } from "../ui/DateRangePicker.jsx";
import { OnbEmpty } from "./Onboarding.jsx";
import { fetchErrors } from "./Charges.jsx";
import { fmtARS, fmtPct, downloadCsv } from "./_shared.jsx";

// GET /api/stats?action=analytics&months=N. Si el backend todavía no lo tiene,
// armamos lo básico desde GET /api/stats (sin mensual ni motivos).
export async function fetchAnalytics(range = 6) {
  const params = typeof range === "object" && range ? { action: "analytics", since: range.since, until: range.until } : { action: "analytics", months: range };
  const d = await apiGet("stats", params);
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
export const REASON_LABELS = { sin_motivo:"Sin motivo", precio:"Me resulta caro", stock:"Todavía tengo producto", no_uso:"Ya no lo uso", calidad:"No me convenció", otro:"Otro motivo", too_expensive:"Muy caro", too_much:"Tengo de sobra", quality:"No me gustó el producto", shipping:"Problemas con el envío", switching:"Cambio a otra marca", temporary:"Es temporal", other:"Otro" };

// Período del calendario (Growith-style) con atajos de meses. Default: últimos 6 meses.
const RANGE_KEY = "rec_analytics_range";
const readRange = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) || "null");
    if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.since) && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) {
      if (r.preset) { const p = PRESETS_MESES.find(x => x.id === r.preset); if (p) { const [s, u] = rangoDePreset(p); return { since: s, until: u, preset: p.id }; } }
      // Rango fijo guardado (de un preset viejo o de antes): si ya venció, no sirve
      // mostrar un período que terminó hace semanas. Se recalcula al default.
      if (r.until >= hoyAR()) return r;
    }
  } catch (_) {}
  const [since, until] = rangoDePreset(PRESETS_MESES.find(p => p.id === "6m"));
  return { since, until, preset: "6m" };
};
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtDM = (iso) => { try { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; } catch (_) { return ""; } };
const monthTick = (ym) => `${MONTH_LABEL(ym)} ${String(ym).slice(2, 4)}`;

// ─── Página: Analíticas — estilo Growith: KPIs con sparkline mensual,
// gráfico con pestañas, próximos 30 días por semana, motivos de baja y mes a mes.
export function AnalyticsPage({ merchant, goTab }) {
  const T = useT();
  const [range, setRange] = useState(readRange);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [chargeErrors, setChargeErrors] = useState(null); // cobros OK sin orden creada (antes vivía en Cobros)

  async function load(r = range, { silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const [d, ce] = await Promise.all([fetchAnalytics(r), fetchErrors().catch(() => null)]);
      if (Array.isArray(ce)) setChargeErrors(ce.length);
      if (!d) setErr("No pudimos cargar las métricas"); else { setData(d); setErr(""); }
    } catch (e) { setErr(e.message || "Error"); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(range); /* eslint-disable-next-line */ }, [range.since, range.until]);
  useTabRefresh("analiticas", () => load(range, { silent: true }));
  const pickRange = (since, until, preset) => { const r = { since, until, preset: preset || null }; setRange(r); try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch (_) {} };

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
    downloadCsv(`analiticas-${range.since}_${range.until}.csv`, ["mes", "cobrado_ars", "nuevas", "canceladas", "activas_cierre"], monthly.map(m => [m.month, Math.round(m.revenue_ars || 0), m.new || 0, m.cancelled || 0, m.active_end || 0]));
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
          <DateRangePicker T={T} since={range.since} until={range.until} onChange={pickRange} presets={PRESETS_MESES}/>
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
          <div className="kpi-grid kpi-grid-4" style={{ display:"grid", gap:10, marginBottom:10 }}>
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
          <div className="kpi-grid" style={{ display:"grid", gap:10, marginBottom:18 }}>
            <KpiCard T={T} loading={first} label={kpiLabel("Pago fallido", "Suscripciones que hoy tienen el último cobro rechazado. Mercado Pago reintenta solo y nosotros le avisamos al cliente para que cambie la tarjeta.")}
              value={fmtN(a.payment_failed)} hint="MP reintenta solo" color={T.red} valueColor={(a.payment_failed || 0) > 0 ? T.red : T.text}
              onClick={() => goTab?.("suscripciones", "status=payment_failed")}/>
            <KpiCard T={T} loading={first} label={kpiLabel("Con error", "Cobros que Mercado Pago aprobó pero cuya orden no se pudo crear en tu tienda. Desde Cobros → Con error se reintenta con un clic.")}
              value={chargeErrors == null ? "—" : fmtN(chargeErrors)} hint={chargeErrors ? "Cobrados sin orden creada" : "Todo en orden"} color={T.red} valueColor={chargeErrors ? T.red : T.text}
              onClick={() => goTab?.("cobros", "view=errors")}/>
            <KpiCard T={T} loading={first} label={kpiLabel("Bajas 30 días", "Suscripciones canceladas en los últimos 30 días. El % compara este mes con el anterior; menos es mejor.")}
              value={fmtN(a.cancelled_30d)} curr={curMonth ? Number(curMonth.cancelled) : null} prev={prevMonth ? Number(prevMonth.cancelled) : null} invert
              hint={`Churn ${(Number(a.churn_30d_pct) || 0).toLocaleString("es-AR", { maximumFractionDigits:1 })}% · línea: bajas por mes`} spark={series("cancelled")} color={T.textSm}
              onClick={() => goTab?.("suscripciones", "status=cancelled")}/>
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
              <AreaChart T={T} title={`Evolución · ${a.months ? `${a.months} ${a.months === 1 ? "mes" : "meses"}` : "período"}`} tabs={chartTabs} dates={monthly.map(m => m.month)} fmtDate={monthTick} height={220}
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
