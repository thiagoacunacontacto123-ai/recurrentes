import { useState, useEffect, useMemo } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSBadge, Spinner, CellStack, PageHeader, SectionTitle, Callout, Loading } from "../ui/components.jsx";
import { KpiCard, AreaChart, Segmented } from "../ui/charts.jsx";
import { PlanDeAccionCard } from "./Onboarding.jsx";
import { fmtARS, fmtDayMonth } from "./_shared.jsx";
import { fetchUpcoming, fetchErrors } from "./Charges.jsx";
import DateRangePicker, { PRESETS_DIAS, rangoDePreset } from "../ui/DateRangePicker.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";

// ─── Inicio (estilo dashboard de Growith) ───────────────────────────────
//   · Período 7 / 30 / 90 días (se recuerda por navegador) + Actualizar.
//   · KPIs con delta vs el período anterior del mismo largo y sparkline diario
//     (GET /api/stats?days=N → period.kpis / period.series).
//   · Gráfico grande con pestañas: Cobrado · Activas · Altas y bajas.
//   · Próximos cobros (7 días) + Alertas.
// Período del calendario (mismo que Cobros). Default: últimos 30 días.
const RANGE_KEY = "rec_home_range";
const readRange = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) || "null");
    if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.since) && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) {
      if (r.preset) { const p = PRESETS_DIAS.find(x => x.id === r.preset); if (p) { const [s, u] = rangoDePreset(p); return { since: s, until: u, preset: p.id }; } }
      return r;
    }
  } catch (_) {}
  const [since, until] = rangoDePreset(PRESETS_DIAS.find(p => p.id === "30d"));
  return { since, until, preset: "30d" };
};
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtShortDate = (key) => { try { const [, m, d] = String(key).split("-"); return `${parseInt(d)}/${parseInt(m)}`; } catch (_) { return key; } };
const fmtTime = (d) => { try { return d.toLocaleTimeString("es-AR", { hour:"2-digit", minute:"2-digit" }); } catch (_) { return ""; } };

export function HomeTab({ merchant, onGo, onGoConfig, onOpenGuide }) {
  const T = useT();
  const [range, setRange] = useState(readRange);
  const [stats, setStats] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [errorsCount, setErrorsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  async function load(r = range) {
    setLoading(true);
    const [s, up, errs] = await Promise.all([apiGet("stats", { since: r.since, until: r.until }), fetchUpcoming().catch(() => []), fetchErrors().catch(() => [])]);
    if (s?.error) setErr(s.error);
    else { setStats(s); setErr(""); setUpdatedAt(new Date()); }
    setUpcoming(up);
    setErrorsCount(errs.length);
    setLoading(false);
  }
  useEffect(() => { load(range); /* eslint-disable-next-line */ }, [range.since, range.until]);
  const pickRange = (since, until, preset) => { const r = { since, until, preset: preset || null }; setRange(r); try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch (_) {} };

  const s = stats || {};
  const totals = s.totals || {};
  const p = s.period || null;
  const k = p?.kpis || {};
  const ser = p?.series || {};
  const upcomingTotal = upcoming.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0);
  const next7 = upcoming.filter(u => new Date(u.next_charge_at).getTime() - Date.now() <= 7 * 86400000);
  const pl = stats?.period?.days ? `${stats.period.days} días` : "período";
  const prevHint = `vs. los ${pl} anteriores`;

  // Alertas: cosas que requieren acción hoy.
  const profile = merchantProfile(merchant);
  const alerts = [];
  if (profile.channel === "shopify" && !merchant?.shopify_token) alerts.push({ tone:"warning", title:"Shopify no está conectado", desc:"Sin Shopify no se crean las órdenes de cada cobro.", cta:"Conectar", go: () => onGoConfig?.("integraciones") });
  if (!merchant?.mp_access_token) alerts.push({ tone:"warning", title:"Mercado Pago no está conectado", desc:"Es la cuenta que cobra las suscripciones.", cta:"Conectar", go: () => onGoConfig?.("integraciones") });
  if (merchant?.mp_access_token && merchant?.mp_reconnect_required) alerts.push({ tone:"danger", title:"Reconectá Mercado Pago", desc:"Mercado Pago cortó el acceso de Recurrentes a tu cuenta. Sin eso no podemos procesar los cobros.", cta:"Reconectar", go: () => onGoConfig?.("integraciones") });
  if ((totals.payment_failed || 0) > 0) alerts.push({ tone:"danger", title:`${totals.payment_failed} suscripci${totals.payment_failed === 1 ? "ón" : "ones"} con pago fallido`, desc:"MP reintenta solo; podés mandarles el link del portal para actualizar la tarjeta.", cta:"Ver", go: () => onGo?.("suscripciones", "status=payment_failed") });
  if (errorsCount > 0) alerts.push({ tone:"danger",
    title: profile.caps.orders ? `${errorsCount} cobro${errorsCount === 1 ? "" : "s"} sin orden en ${profile.channelInfo.label}` : `${errorsCount} cobro${errorsCount === 1 ? "" : "s"} con error`,
    desc: profile.caps.orders ? "Se cobró pero la orden no se creó. Reintentala desde Cobros." : "Se cobró pero no se pudo registrar. Reintentalo desde Cobros.",
    cta:"Ver", go: () => onGo?.("cobros", "view=errors") });

  const tabs = useMemo(() => [
    { id:"cobrado", label:"Cobrado", series:[{ key:"cobrado", label:"Cobrado", color:T.accentSolid, values: ser.cobrado || [], fmt: fmtARS }] },
    { id:"activas", label:"Activas", series:[{ key:"activas", label:"Suscripciones activas", color:T.blue || "#60a5fa", values: ser.activas || [], fmt: fmtN }] },
    { id:"altas", label:"Altas y bajas", series:[
      { key:"nuevas", label:"Altas", color:T.green, values: ser.nuevas || [], fmt: fmtN },
      { key:"bajas", label:"Bajas", color:T.red, values: ser.bajas || [], fmt: fmtN },
    ] },
  ], [T, ser.cobrado, ser.activas, ser.nuevas, ser.bajas]);

  return (
    <div>
      <PageHeader T={T} title="Inicio" subtitle="Tu negocio recurrente de un vistazo."
        right={<>
          <DateRangePicker T={T} since={range.since} until={range.until} onChange={pickRange}/>
          <Btn T={T} variant="secondary" size="sm" onClick={() => load(range)} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>
          <Btn T={T} variant="ghost" size="sm" onClick={onOpenGuide} style={{ height:34 }}>Guía</Btn>
        </>}/>
      {updatedAt && <div style={{ fontSize:11, color:T.textSm, textAlign:"right", margin:"-10px 0 12px" }}>{loading ? "actualizando…" : `act. ${fmtTime(updatedAt)}`}</div>}

      {/* Plan de acción — se oculta solo cuando está todo listo y el usuario lo cierra */}
      <PlanDeAccionCard onOpenGuide={onOpenGuide}/>

      {err && !loading && (
        <Callout T={T} tone="danger" title="No pudimos cargar las métricas" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={() => load(range)}>Reintentar</Btn>}>{err}</Callout>
      )}

      {/* Métricas principales */}
      <div style={{ display:"flex", alignItems:"center", gap:10, margin:"4px 0 10px" }}>
        <span style={{ fontSize:15, fontWeight:800, color:T.text, letterSpacing:-0.2 }}>Métricas principales</span>
        <DSBadge T={T} color={T.textSm} size="sm">Últimos {pl}</DSBadge>
      </div>
      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 220px), 1fr))", gap:10, marginBottom:10 }}>
        <KpiCard T={T} hero loading={loading && !p} label="Ingreso recurrente" value={fmtARS(k.mrr?.value ?? s.mrr)} curr={k.mrr?.value} prev={k.mrr?.prev}
          hint="MRR: lo que cobrás por mes" spark={ser.mrr} color={T.accentSolid} valueColor={T.accent} onClick={() => onGo?.("analiticas")}/>
        <KpiCard T={T} hero loading={loading && !p} label="Cobrado" value={fmtARS(k.cobrado?.value)} curr={k.cobrado?.value} prev={k.cobrado?.prev}
          hint={`${fmtN(k.cobros?.value)} cobros · ${prevHint}`} spark={ser.cobrado} color={T.blue || "#60a5fa"} onClick={() => onGo?.("cobros")}/>
        <KpiCard T={T} hero loading={loading && !p} label="Suscripciones activas" value={fmtN(k.activas?.value ?? totals.active)} curr={k.activas?.value} prev={k.activas?.prev}
          hint={`${fmtN(totals.paused)} pausadas`} spark={ser.activas} color={T.green} onClick={() => onGo?.("suscripciones")}/>
        <KpiCard T={T} hero loading={loading && !p} label="Altas" value={fmtN(k.nuevas?.value)} curr={k.nuevas?.value} prev={k.nuevas?.prev}
          hint={`Suscripciones nuevas · ${prevHint}`} spark={ser.nuevas} color={T.accentSolid}/>
      </div>
      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap:10, marginBottom:18 }}>
        <KpiCard T={T} loading={loading && !p} label="Bajas" value={fmtN(k.bajas?.value)} curr={k.bajas?.value} prev={k.bajas?.prev} invert
          hint="Cancelaciones" spark={ser.bajas} color={T.red} onClick={() => onGo?.("retencion")}/>
        <KpiCard T={T} loading={loading && !p} label="Pagos fallidos" value={fmtN(k.fallidos?.value)} curr={k.fallidos?.value} prev={k.fallidos?.prev} invert
          hint={`${fmtN(totals.payment_failed)} esperando reintento`} spark={ser.fallidos} color={T.yellow} onClick={() => onGo?.("suscripciones", "status=payment_failed")}/>
        <KpiCard T={T} loading={loading && !p} label="Churn del período" value={`${(k.churn_pct ?? 0).toLocaleString("es-AR")}%`}
          hint="Bajas sobre activas + altas" spark={ser.bajas} color={(k.churn_pct || 0) > 5 ? T.red : T.textSm} valueColor={(k.churn_pct || 0) > 5 ? T.red : T.text}/>
        <KpiCard T={T} loading={loading} label="Próximos 30 días" value={fmtARS(upcomingTotal)}
          hint={`${fmtN(upcoming.length)} cobro${upcoming.length === 1 ? "" : "s"} programado${upcoming.length === 1 ? "" : "s"}`} color={T.accentSolid} onClick={() => onGo?.("cobros", "view=upcoming")}/>
      </div>

      {/* Gráfico grande */}
      <div style={{ marginBottom:DS.sp["2xl"] }}>
        <AreaChart T={T} title={`Últimos ${pl}`} tabs={tabs} dates={ser.dates || []} fmtDate={fmtShortDate}
          total={(tab) => {
            if (tab.id === "cobrado") return fmtARS(k.cobrado?.value);
            if (tab.id === "activas") return `${fmtN(k.activas?.value)} activas`;
            return `${fmtN(k.nuevas?.value)} altas · ${fmtN(k.bajas?.value)} bajas`;
          }}/>
      </div>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        {/* Próximos cobros (7 días) */}
        <Card T={T}>
          <SectionTitle T={T} sub={<span style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text }}>Cobros que MP va a procesar</span>}
            right={upcoming.length > 0 && <Btn T={T} variant="secondary" size="sm" onClick={() => onGo?.("cobros", "view=upcoming")}>Ver los 30 días →</Btn>}>
            Próximos 7 días · {next7.length} cobro{next7.length === 1 ? "" : "s"} · {fmtARS(next7.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0))}
          </SectionTitle>
          {loading && !upcoming.length ? <Loading T={T} text="Cargando cobros…"/> : next7.length > 0 ? (
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
          {loading && !stats ? <Loading T={T}/> : alerts.length === 0 ? (
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
