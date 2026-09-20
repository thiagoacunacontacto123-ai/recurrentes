import { useState, useEffect, useMemo } from "react";
import { useTabRefresh } from "../lib/tabs.js";
import { apiGet, apiPost } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { KPI, Btn, InputStyle, DSBadge, Spinner, DSTable, CellStack, PageHeader, SubTabs, Loading, appConfirm, toast } from "../ui/components.jsx";
import { Segmented } from "../ui/charts.jsx";
import DateRangePicker, { PRESETS_DIAS, rangoDePreset, hoyAR } from "../ui/DateRangePicker.jsx";
import ChargesCalendar from "../ui/ChargesCalendar.jsx";
import { OnbEmpty } from "./Onboarding.jsx";
import { TIPS } from "../lib/onboarding.js";
import { MONO, fmtARS, fmtDateTime, ExtLink, mpPaymentUrl, shopifyOrderUrl, orderLabel, hashQuery } from "./_shared.jsx";

// ─── Próximos cobros: GET /api/charges?view=upcoming con fallback a los subs
// activos (next_charge_at ≤ 30 días) si el backend todavía no lo tiene.
export async function fetchUpcoming(days = 30) {
  const d = await apiGet("charges", { view: "upcoming", days });
  const list = d && !d.error ? (Array.isArray(d.upcoming) ? d.upcoming : (Array.isArray(d.items) ? d.items : null)) : null;
  if (list) return list;
  // Fallback sin backend: proyectamos igual con la frecuencia de cada plan.
  const s = await apiGet("subscribers", { status: "active" });
  const untilMs = Date.now() + days * 86400000;
  const out = [];
  for (const x of (s?.subscribers || [])) {
    let ms = Date.parse(x.next_charge_at);
    if (!Number.isFinite(ms)) continue;
    const freq = Math.min(Math.max(parseInt(x.plan_snapshot?.frequency_days, 10) || 30, 1), 365);
    const base = { subscriber_id: x.id, email: x.customer_email, name: x.customer_name, plan_title: x.plan_snapshot?.product_title || "—", amount_ars: x.plan_snapshot?.total_per_charge_ars || ((x.plan_snapshot?.subscription_price_ars || 0) * (x.quantity || 1)) };
    for (let n = 0; ms <= untilMs && n < 40; n++, ms += freq * 86400000) {
      out.push({ ...base, next_charge_at: new Date(ms).toISOString(), projected: n > 0 });
      if (days <= 45) break;
    }
  }
  return out.sort((a, b) => String(a.next_charge_at).localeCompare(String(b.next_charge_at)));
}

// ─── Cobros con error: GET /api/charges?view=errors con fallback al listado.
export async function fetchErrors(processed = null) {
  const d = await apiGet("charges", { view: "errors" });
  if (d && !d.error && Array.isArray(d.charges)) return d.charges;
  const list = processed || (await apiGet("charges", { limit: 200 }))?.charges || [];
  return list.filter(c => c.error);
}

// ─── Página: Cobros — sin KPIs ni gráfico (viven en Analíticas desde 2026-09-19):
// período, estados en píldoras con contador,
// búsqueda y tabla densa. Mismas acciones que antes (reintentar orden).
// Período del calendario (Growith-style), persistido. Default: últimos 30 días.
const RANGE_KEY = "rec_charges_range";
const CAL_DAYS = 370;  // los 12 meses del calendario
const defaultRange = () => { const [since, until] = rangoDePreset(PRESETS_DIAS.find(p => p.id === "30d")); return { since, until }; };
const readRange = () => {
  try {
    const r = JSON.parse(localStorage.getItem(RANGE_KEY) || "null");
    if (r && /^\d{4}-\d{2}-\d{2}$/.test(r.since) && /^\d{4}-\d{2}-\d{2}$/.test(r.until)) {
      // Un preset relativo guardado ("Últimos 30 días") se recalcula a hoy.
      if (r.preset) { const p = PRESETS_DIAS.find(x => x.id === r.preset); if (p) { const [s, u] = rangoDePreset(p); return { since: s, until: u, preset: p.id }; } }
      // Rango fijo guardado (de un preset viejo o de antes): si ya venció, no sirve
      // mostrar un período que terminó hace semanas. Se recalcula al default.
      if (r.until >= hoyAR()) return r;
    }
  } catch (_) {}
  return { ...defaultRange(), preset: "30d" };
};
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const SearchIcon = ({ color }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.6"/><path d="M11 11l3.5 3.5" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export function ChargesPage({ shop = null }) {
  const T = useT();
  const iS = InputStyle(T);
  const [view, setView] = useState(() => { const v = hashQuery().get("view"); return ["processed", "upcoming", "errors"].includes(v) ? v : "processed"; });
  const [range, setRange] = useState(readRange);
  const [ready, setReady] = useState(false);
  const [search, setSearch] = useState("");
  const [charges, setCharges] = useState([]);
  const [totals, setTotals] = useState({ amount_ars:0, ok:0, failed:0, total:0 });
  const [upcoming, setUpcoming] = useState([]);
  // Próximos cobros: lista semana por semana o calendario a 12 meses.
  const [upYear, setUpYear] = useState([]);       // proyección a 1 año (solo para el calendario)
  const [upYearLoading, setUpYearLoading] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [retrying, setRetrying] = useState(null);

  async function loadProcessed(more = false, r = range) {
    const params = { limit: 200, since: r.since, until: r.until };
    if (more && cursor) params.cursor = cursor;
    const d = await apiGet("charges", params);
    const list = d?.charges || [];
    setCharges(prev => more ? [...prev, ...list] : list);
    setCursor(d?.next_cursor || null);
    if (!more) setTotals(d?.totals || { amount_ars:0, ok:0, failed:0, total:0 });
    return list;
  }
  async function loadAll({ silent = false } = {}) {
    if (!silent) { setLoading(true); setUpYear([]); }
    try {
      const [list, up] = await Promise.all([loadProcessed(false), fetchUpcoming().catch(() => [])]);
      setUpcoming(up);
      setErrors(await fetchErrors(list).catch(() => []));
    } finally { setLoading(false); setReady(true); }
  }
  useEffect(() => { loadAll(); }, []);
  useTabRefresh("cobros", () => loadAll({ silent: true }));
  // El año solo se pide cuando hace falta (vista Próximos + calendario).
  useEffect(() => {
    if (view !== "upcoming" || upYear.length || upYearLoading) return;
    setUpYearLoading(true);
    fetchUpcoming(CAL_DAYS).then(setUpYear).catch(() => {}).finally(() => setUpYearLoading(false));
    /* eslint-disable-next-line */
  }, [view]);
  // Cambiar el período recarga métricas y la lista de cobros procesados.
  useEffect(() => { if (ready) loadProcessed(false, range); /* eslint-disable-next-line */ }, [range.since, range.until]);
  const pickRange = (since, until, preset) => { const r = { since, until, preset: preset || null }; setRange(r); try { localStorage.setItem(RANGE_KEY, JSON.stringify(r)); } catch (_) {} };

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

  // Búsqueda por cliente, email, pago MP, orden o plan (en las tres vistas).
  const q = search.trim().toLowerCase();
  const match = (c) => !q || [c.customer_name, c.name, c.customer_email, c.email, c.mp_payment_id, c.shopify_order_id, c.plan_title, c.product_title]
    .some(v => String(v ?? "").toLowerCase().includes(q));
  const chargesF = useMemo(() => charges.filter(match), [charges, q]);
  const errorsF = useMemo(() => errors.filter(match), [errors, q]);
  const upYearF = useMemo(() => upYear.filter(match), [upYear, q]);


  const customerCell = (c) => <CellStack T={T} main={c.customer_name || c.name || c.customer_email || c.email || (c.subscriber_id ? `Sub ${String(c.subscriber_id).slice(0, 8)}…` : "—")} sub={(c.customer_name || c.name) ? (c.customer_email || c.email) : (c.plan_title || c.product_title || "")}/>;
  const dateCell = (iso) => <span style={{ color:T.textSm, fontSize:DS.font.sm, fontVariantNumeric:"tabular-nums" }}>{fmtDateTime(iso)}</span>;
  const mpCell = (c) => c.mp_payment_id ? <ExtLink T={T} href={mpPaymentUrl(c.mp_payment_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{c.mp_payment_id}</ExtLink> : <span style={{ color:T.textSm }}>—</span>;
  const amountCell = (v) => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(v)}</span>;

  const processedCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => dateCell(c.created_at) },
    { key:"cliente", label:"Cliente", render: customerCell },
    { key:"mp", label:"Pago MP", nowrap:true, hideMobile:true, render: mpCell },
    { key:"orden", label:"Orden", nowrap:true, render: c => c.shopify_order_id
        ? <ExtLink T={T} href={shopifyOrderUrl(shop, c.shopify_order_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{orderLabel(c.shopify_order_id)}</ExtLink>
        : <span style={{ color:T.textSm }}>—</span> },
    { key:"estado", label:"Estado", render: c => c.error ? (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:4, maxWidth:300 }}>
        <span title={c.error} style={{ cursor:"help" }}><DSBadge T={T} color={T.red} size="sm">✗ Falló</DSBadge></span>
        <span style={{ fontSize:DS.font.xs, color:T.red, lineHeight:1.35, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }} title={c.error}>{c.error}</span>
      </div>
    ) : <DSBadge T={T} color={T.green} size="sm">✓ Cobrado</DSBadge> },
    { key:"monto", label:"Monto", nowrap:true, align:"right", render: c => amountCell(c.amount_ars) },
  ];

  const errorCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => dateCell(c.created_at) },
    { key:"cliente", label:"Cliente", render: customerCell },
    { key:"mp", label:"Pago MP", nowrap:true, hideMobile:true, render: mpCell },
    { key:"error", label:"Error", render: c => <span style={{ fontSize:DS.font.sm, color:T.red, lineHeight:1.35, display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical", overflow:"hidden", maxWidth:340 }} title={c.error}>{c.error || "—"}</span> },
    { key:"monto", label:"Monto", nowrap:true, align:"right", render: c => amountCell(c.amount_ars) },
    { key:"accion", label:"", align:"right", nowrap:true, render: c => c.shopify_order_id
        ? <ExtLink T={T} href={shopifyOrderUrl(shop, c.shopify_order_id)}>{orderLabel(c.shopify_order_id)}</ExtLink>
        : <Btn T={T} variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); retryOrder(c); }} disabled={retrying === c.id} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>{retrying === c.id ? <><Spinner size={10} color={T.textMd}/> Reintentando…</> : "↻ Reintentar orden"}</Btn> },
  ];


  const tabs = [
    { id:"processed", label:"Procesados", count: totals.total || charges.length || undefined },
    { id:"upcoming",  label:"Próximos",   count: upcoming.length },
    { id:"errors",    label:"Con error",  count: errors.length },
  ];
  const first = loading && charges.length === 0;
  // En calendario el conteo es el del año proyectado, no el de los 30 días.
  const shown = view === "processed" ? chargesF.length : view === "upcoming" ? upYearF.length : errorsF.length;

  return (
    <div>
      <PageHeader T={T} title="Cobros" subtitle="Lo que Mercado Pago cobró, lo que viene y lo que falló. Cada cobro OK genera una orden en tu negocio."
        right={<>
          <DateRangePicker T={T} since={range.since} until={range.until} onChange={pickRange}/>
          <Btn T={T} variant="secondary" size="sm" onClick={loadAll} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>
        </>}/>

      {/* Barra: vista con contadores · búsqueda · conteo */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ maxWidth:"100%", overflowX:"auto" }}>
          <Segmented T={T} options={tabs} value={view} onChange={setView} ariaLabel="Vista de cobros"/>
        </div>
        <div style={{ position:"relative", flex:"0 1 260px", minWidth:170 }}>
          <span style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", display:"flex", pointerEvents:"none" }}><SearchIcon color={T.textSm}/></span>
          <input type="search" aria-label="Buscar cobros" placeholder="Buscar cliente, pago MP u orden…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...iS, width:"100%", height:34, borderRadius:99, fontSize:DS.font.md, boxSizing:"border-box", padding:"0 12px 0 30px" }}/>
        </div>
        <span style={{ marginLeft:"auto", fontSize:DS.font.sm, color:T.textSm, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
          {first ? "cargando…" : `${fmtN(shown)} ${view === "upcoming" ? "programado" : "cobro"}${shown === 1 ? "" : "s"}${q ? ` · "${search.trim()}"` : ""}`}
        </span>
      </div>

      {first ? <Loading T={T}/> : view === "processed" ? (
        charges.length === 0 ? (
          <OnbEmpty section="cobros" icon="💸" title="Todavía no tenés cobros" desc="Aparecen acá cuando Mercado Pago procesa el primer pago de una suscripción, y después cada renovación." tip={TIPS.chargesEmpty}/>
        ) : (
          <DSTable T={T} dense columns={processedCols} rows={chargesF} rowKey={c => c.id} minWidth={820} emptyText="Ningún cobro coincide con la búsqueda."
            footer={<>
              <span>{fmtN(chargesF.length)} cobro{chargesF.length === 1 ? "" : "s"} · {totals.ok} OK · {totals.failed} con error</span>
              {cursor && <Btn T={T} variant="secondary" size="sm" onClick={() => loadProcessed(true)} disabled={loading}>{loading ? <><Spinner size={11} color={T.textMd}/> Cargando…</> : "Cargar más"}</Btn>}
            </>}/>
        )
      ) : view === "upcoming" ? (
        upcoming.length === 0 ? (
          <OnbEmpty section="cobros" icon="📅" title="No hay cobros programados" desc="Cuando tengas suscripciones activas, acá ves qué va a cobrar Mercado Pago en los próximos 12 meses, día por día."/>
        ) : (
          upYearLoading && upYear.length === 0
            ? <Loading T={T}/>
            : <ChargesCalendar T={T} items={upYearF} months={12} fmtARS={fmtARS} loading={upYearLoading}/>
        )
      ) : (
        errors.length === 0 ? (
          <OnbEmpty section="cobros" icon="✅" title="Sin cobros con error" desc="Si un cobro de MP no logra registrar la orden, aparece acá con el botón para reintentar."/>
        ) : (
          <DSTable T={T} dense columns={errorCols} rows={errorsF} rowKey={c => c.id} minWidth={760} emptyText="Ningún cobro con error coincide con la búsqueda."
            footer={<span>{fmtN(errorsF.length)} cobro{errorsF.length === 1 ? "" : "s"} con error</span>}/>
        )
      )}
    </div>
  );
}

// Compat con el nombre anterior.
export const ChargesTab = ChargesPage;
