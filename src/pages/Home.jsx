import { useState, useEffect } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, KPI, Btn, DSBadge, Spinner, CellStack, PageHeader, SectionTitle, Callout, Loading } from "../ui/components.jsx";
import { PlanDeAccionCard } from "./Onboarding.jsx";
import { fmtARS, fmtDayMonth } from "./_shared.jsx";
import { fetchUpcoming, fetchErrors } from "./Charges.jsx";

// ─── Tab: Inicio (KPIs + plan de acción + próximos 30 días + alertas) ─────
export function HomeTab({ merchant, onGo, onGoConfig, onOpenGuide }) {
  const T = useT();
  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [errorsCount, setErrorsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    const [d, up, errs] = await Promise.all([apiGet("stats"), fetchUpcoming().catch(() => []), fetchErrors().catch(() => [])]);
    if (d?.error) setErr(d.error);
    else { setStats(d); setErr(""); }
    setUpcoming(up);
    setErrorsCount(errs.length);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const s = stats || {};
  const totals = s.totals || {};
  const revenue = s.revenue || {};
  const growth = s.growth || {};
  const deltaPct = revenue.delta_pct;
  const churn = growth.churn_rate_pct || 0;
  const upcomingTotal = upcoming.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0);
  const next7 = upcoming.filter(u => new Date(u.next_charge_at).getTime() - Date.now() <= 7 * 86400000);

  // Alertas: cosas que requieren acción hoy.
  const alerts = [];
  if (!merchant?.shopify_token) alerts.push({ tone:"warning", title:"Shopify no está conectado", desc:"Sin Shopify no se crean las órdenes de cada cobro.", cta:"Conectar", go: () => onGoConfig?.("integraciones") });
  if (!merchant?.mp_access_token) alerts.push({ tone:"warning", title:"Mercado Pago no está conectado", desc:"Es la cuenta que cobra las suscripciones.", cta:"Conectar", go: () => onGoConfig?.("integraciones") });
  if ((totals.payment_failed || 0) > 0) alerts.push({ tone:"danger", title:`${totals.payment_failed} suscripci${totals.payment_failed === 1 ? "ón" : "ones"} con pago fallido`, desc:"MP reintenta solo; podés mandarles el link del portal para actualizar la tarjeta.", cta:"Ver", go: () => onGo?.("suscripciones", "status=payment_failed") });
  if (errorsCount > 0) alerts.push({ tone:"danger", title:`${errorsCount} cobro${errorsCount === 1 ? "" : "s"} sin orden en Shopify`, desc:"Se cobró pero la orden no se creó. Reintentala desde Cobros.", cta:"Ver", go: () => onGo?.("cobros", "view=errors") });
  if (merchant && !merchant.klaviyo_connected && (totals.active || 0) > 0) alerts.push({ tone:"info", title:"Klaviyo sin conectar", desc:"Recuperá checkouts sin pagar y mandá los mails con tu marca.", cta:"Configurar", go: () => onGoConfig?.("integraciones") });

  return (
    <div>
      <PageHeader T={T} title="Inicio" subtitle="Resumen del negocio recurrente."
        right={<>
          <Btn T={T} variant="secondary" size="sm" onClick={onOpenGuide}>Ver guía</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>
        </>}/>

      {/* Plan de acción (8 pasos) — se oculta solo cuando está todo listo y el usuario lo cierra */}
      <PlanDeAccionCard onOpenGuide={onOpenGuide}/>

      {err && !loading && (
        <Callout T={T} tone="danger" title="No pudimos cargar las métricas" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={load}>Reintentar</Btn>}>{err}</Callout>
      )}

      {/* KPIs principales — basados SOLO en active/paused. */}
      <div className="kpi-grid gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp.md }}>
        <KPI T={T} label="MRR" value={fmtARS(s.mrr)} sub="ingresos mensuales recurrentes" accent color={T.accent} loading={loading} onClick={() => onGo?.("analiticas")}/>
        <KPI T={T} label="Suscripciones activas" value={totals.active || 0} sub={`${totals.paused || 0} pausadas`} color={T.text} loading={loading} onClick={() => onGo?.("suscripciones")}/>
        <KPI T={T} label="Cobrado este mes" value={fmtARS(revenue.this_month?.amount)} color={T.text} loading={loading} onClick={() => onGo?.("cobros")}
          sub={<span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>{revenue.this_month?.count || 0} cobros
            {typeof deltaPct === "number" && <DSBadge T={T} color={deltaPct >= 0 ? T.green : T.red} size="sm">{deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct)}%</DSBadge>}
          </span>}/>
        <KPI T={T} label="Churn 30d" value={`${churn}%`} sub={`${growth.cancelled_30d || 0} cancelaciones`} color={churn > 5 ? T.red : T.text} loading={loading} onClick={() => onGo?.("retencion")}/>
      </div>

      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp["2xl"] }}>
        <KPI T={T} compact label="Nuevas últimos 7d" value={growth.new_7d || 0} color={T.green} loading={loading}/>
        <KPI T={T} compact label="Nuevas últimos 30d" value={growth.new_30d || 0} color={T.green} loading={loading}/>
        <KPI T={T} compact label="Próximos 30 días" value={fmtARS(upcomingTotal)} sub={`${upcoming.length} cobro${upcoming.length === 1 ? "" : "s"} programado${upcoming.length === 1 ? "" : "s"}`} color={T.accent} loading={loading} onClick={() => onGo?.("cobros", "view=upcoming")}/>
      </div>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        {/* Próximos cobros (7 días) */}
        <Card T={T}>
          <SectionTitle T={T} sub={<span style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text }}>Cobros que MP va a procesar</span>}
            right={upcoming.length > 0 && <Btn T={T} variant="secondary" size="sm" onClick={() => onGo?.("cobros", "view=upcoming")}>Ver los 30 días →</Btn>}>
            Próximos 7 días · {next7.length} cobro{next7.length === 1 ? "" : "s"} · {fmtARS(next7.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0))}
          </SectionTitle>
          {loading ? <Loading T={T} text="Cargando cobros…"/> : next7.length > 0 ? (
            <div>
              {next7.slice(0, 8).map((c, i) => (
                <div key={(c.subscriber_id || "u") + i} className="gh-list-item" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, gap:10, fontSize:DS.font.base }}>
                  <CellStack T={T} main={c.name || c.email} sub={c.plan_title}/>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <div style={{ fontWeight:DS.w.bold, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</div>
                    <div style={{ fontSize:DS.font.xs, color:T.textSm, marginTop:2 }}>{c.next_charge_at ? fmtDayMonth(c.next_charge_at) : "—"}</div>
                  </div>
                </div>
              ))}
              {next7.length > 8 && <div style={{ fontSize:DS.font.sm, color:T.textSm, paddingTop:8 }}>+{next7.length - 8} más en Cobros → Próximos</div>}
            </div>
          ) : (
            <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"18px 0 6px", textAlign:"center" }}>No hay cobros programados en los próximos 7 días.</div>
          )}
        </Card>

        {/* Alertas */}
        <Card T={T}>
          <SectionTitle T={T} sub={<span style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text }}>Alertas</span>}>Requieren tu atención</SectionTitle>
          {loading ? <Loading T={T}/> : alerts.length === 0 ? (
            <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"18px 0 6px", textAlign:"center" }}>✅ Todo en orden. Nada pendiente hoy.</div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {alerts.map((a, i) => <Callout key={i} T={T} tone={a.tone} title={a.title} right={<Btn T={T} variant="secondary" size="sm" onClick={a.go}>{a.cta} →</Btn>}>{a.desc}</Callout>)}
            </div>
          )}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:14, paddingTop:12, borderTop:`1px solid ${T.borderL}` }}>
            <DSBadge T={T} color={T.green}>● Activas · {totals.active || 0}</DSBadge>
            <DSBadge T={T} color={T.yellow}>● Pausadas · {totals.paused || 0}</DSBadge>
            <DSBadge T={T} color={T.red}>● Pago fallido · {totals.payment_failed || 0}</DSBadge>
            <DSBadge T={T} color={T.textSm}>● Canceladas · {totals.cancelled || 0}</DSBadge>
          </div>
        </Card>
      </div>
    </div>
  );
}
