// Panel de super-admin (#/admin) — solo para quienes estén en ADMIN_EMAILS.
// El server lo valida en CADA request (/api/stats?action=admin-*); el menú y
// la ruta solo se muestran si GET /api/merchant devolvió is_admin: true.
// Estilo Growith: KPIs con sparkline, altas por día, repartos, "para activar
// plan", tabla de comercios con búsqueda y filtros, y ficha lateral con
// WhatsApp, plan del SaaS, notas internas, registro y "Ver como este comercio".
import React, { useState, useEffect, useCallback, useRef } from "react";
import { FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";
import ReactDOM from "react-dom";
import { apiGet, apiPost, getAdminAs, setAdminAs } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, DSTable, PageHeader, Callout, Loading, InputStyle, CellStack, toast, appConfirm } from "../ui/components.jsx";
import { KpiCard, Segmented, Panel, BarList, AreaChart } from "../ui/charts.jsx";
import { fmtARS, fmtAgo, fmtDateOnly, fmtDateTime, copyText } from "./_shared.jsx";
import { CHANNELS, PAYMENT_PROVIDERS, BUSINESS_TYPES } from "../../shared/platform/profile.js";
import { PRICING_TIERS, TIER_BY_ID } from "../../shared/platform/pricing.js";

const F = "'Inter',system-ui,sans-serif";
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtUsd = (n) => "US$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtUsd2 = (n) => "US$ " + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDM = (key) => { const p = String(key || "").split("-"); return p.length === 3 ? `${Number(p[2])}/${Number(p[1])}` : String(key || ""); };
const ago = (iso) => (iso ? fmtAgo(iso) : "—");
const sum = (a = []) => a.reduce((t, n) => t + (Number(n) || 0), 0);
const lastN = (a, n) => (Array.isArray(a) ? a.slice(-n) : []);
const labelOf = (cat, id) => cat[id]?.label || id || "—";
const planText = (v) => v === "beta" ? "Beta" : v === "none" ? "Sin plan activado" : (TIER_BY_ID[v]?.label || v);

const FILTERS = [
  { id:"todos", label:"Todos" },
  { id:"pagan", label:"Pagan" },
  { id:"free", label:"Free" },
  { id:"beta", label:"Beta" },
  { id:"activar", label:"A activar" },
  { id:"sin_conectar", label:"Sin conectar" },
  // Mis tiendas (Lumina y las demos): no cuentan en los números del negocio.
  { id:"mias", label:"Mías" },
];
const SORTS = [["recientes","Más nuevos"], ["mrr","Mayor MRR"], ["subs","Más suscriptores"], ["actividad","Actividad reciente"]];
const PLAN_OPTIONS = [
  ["beta", "Beta (sin cargo)"],
  ["none", "Sin plan activado"],
  ...PRICING_TIERS.filter(t => t.usd > 0).map(t => [t.id, `${t.label} · US$ ${t.usd}/mes`]),
];
const AUDIT_LABEL = { set_plan:"Cambió el plan", note:"Agregó una nota", view_as_start:"Entró a ver como", view_as_request:"Miró el panel como el comercio" };
const WA_PATH = "M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z";
const WA_GREEN = "#16a34a";

function PlanBadge({ T, r }) {
  if (r.beta) return <DSBadge T={T} color={T.blue} size="sm">Beta</DSBadge>;
  if (r.plan_activated) return <DSBadge T={T} color={T.green} size="sm">{TIER_BY_ID[r.plan_activated]?.label || r.plan_activated}</DSBadge>;
  if (r.needs_activation) return <DSBadge T={T} color={T.yellow} size="sm">{TIER_BY_ID[r.tier]?.label || r.tier} · activar</DSBadge>;
  return <DSBadge T={T} color={T.textSm} size="sm">Free</DSBadge>;
}

function ConnPills({ T, c = {} }) {
  const items = [["Shopify", c.shopify], ["MP", c.mp], ["Flujos", c.flows]];
  return (
    <span style={{ display:"inline-flex", gap:4, flexWrap:"wrap" }}>
      {items.map(([l, on]) => (
        <span key={l} title={`${l}: ${on ? "conectado" : "no conectado"}`}
          style={{ fontSize:10, fontWeight:700, padding:"2px 6px", borderRadius:5, whiteSpace:"nowrap", background: on ? T.green + "1c" : "transparent", color: on ? T.green : T.textSm, border:`1px solid ${on ? T.green + "44" : T.border}`, opacity: on ? 1 : 0.7 }}>{l}</span>
      ))}
    </span>
  );
}

function WaLink({ T, url, children = "WhatsApp", big }) {
  if (!url) return big ? null : <span style={{ color:T.textSm, fontSize:DS.font.sm }}>—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
      style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize: big ? 12.5 : 11.5, fontWeight:700, color:WA_GREEN, textDecoration:"none", background:WA_GREEN + "14", border:`1px solid ${WA_GREEN}44`, borderRadius:DS.r.md, padding: big ? "6px 11px" : "3px 8px", whiteSpace:"nowrap", fontFamily:F }}>
      <svg width={big ? 14 : 12} height={big ? 14 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={WA_PATH}/></svg>
      {children}
    </a>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────
export function AdminPage() {
  const T = useT();
  const [ov, setOv] = useState(null);
  const [ovErr, setOvErr] = useState("");
  const [range, setRange] = useState(30);
  const [list, setList] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [q, setQ] = useState("");
  const [qDeb, setQDeb] = useState("");
  const [filter, setFilter] = useState("todos");
  const [sort, setSort] = useState("subs");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const tableRef = useRef(null);

  const loadOverview = useCallback(async (fresh) => {
    const d = await apiGet("stats", { action: "admin-overview", ...(fresh ? { fresh: "1" } : {}) });
    if (!d || d.error) { setOvErr(d?.error || "No pudimos cargar el resumen."); return; }
    setOvErr(""); setOv(d);
  }, []);
  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const d = await apiGet("stats", { action: "admin-merchants", q: qDeb, filter: filter === "mias" ? "todos" : filter, sort, page, limit: 25, ...(filter === "mias" ? { internal: "1" } : {}) });
      if (d && !d.error) setList(d); else toast(d?.error || "No pudimos cargar los comercios", "error");
    } catch (e) { toast(e.message || "No pudimos cargar los comercios", "error"); }
    finally { setListLoading(false); }
  }, [qDeb, filter, sort, page]);

  useEffect(() => { loadOverview(false); }, [loadOverview]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { const t = setTimeout(() => { setQDeb(q.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [q]);

  async function refreshAll() {
    setRefreshing(true);
    try { await loadOverview(true); await loadList(); toast("Números actualizados", "success"); }
    finally { setRefreshing(false); }
  }
  const reloadAll = useCallback(() => { loadOverview(false); loadList(); }, [loadOverview, loadList]);
  const goFilter = (f) => { setFilter(f); setPage(1); try { tableRef.current?.scrollIntoView({ behavior:"smooth", block:"start" }); } catch (_) {} };

  async function activate(r) {
    if (!await appConfirm(`¿Activar el plan ${r.tier_label} (US$ ${r.tier_usd}/mes) para ${r.name}? Hacelo cuando ya te pagó.`, { title:"Activar plan", okLabel:`Activar ${r.tier_label}` })) return;
    const d = await apiPost("stats", { merchant_id: r.id, plan: r.tier }, { action: "admin-set-plan" });
    if (!d || d.error) { toast(d?.error || "No se pudo activar", "error"); return; }
    toast(`${r.tier_label} activado para ${r.name}`, "success");
    reloadAll();
  }

  const o = ov || {};
  const sig = o.signups || { dates: [], counts: [], cumulative: [] };
  const needs = o.needs_activation || [];
  const kpiGrid = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))", gap:12, marginBottom:12 };

  const columns = [
    { key:"name", label:"Comercio", render: r => (
      <div style={{ minWidth:0, maxWidth:260 }}>
        <CellStack T={T} main={<>{r.name}{r.is_store && <span style={{ marginLeft:6 }}><DSBadge T={T} color={T.blue} size="sm">Tienda extra</DSBadge></span>}</>} sub={r.owner_name || r.login_email || r.email || r.id}/>
      </div>
    ) },
    { key:"subs", label:"Suscriptores", align:"right", nowrap:true, render: r => <span style={{ fontWeight:700, fontVariantNumeric:"tabular-nums" }}>{fmtN(r.subs)}</span> },
    { key:"plan", label:"Plan que le toca", nowrap:true, render: r => <PlanBadge T={T} r={r}/> },
    // Próximo pago del comercio a Recurrentes: cada 30 días desde su PRIMER pago
    // (la activación del plan), no desde el alta gratis; al tramo que le toque ese
    // día por sus suscriptores. Beta y Free no pagan.
    { key:"next_pay", label:"Próximo pago", nowrap:true, render: r => r.beta
        ? <span style={{ color:T.textSm }}>beta · sin cargo</span>
        : !r.tier_usd
          ? <span style={{ color:T.textSm }}>free</span>
          : r.next_saas_payment_at
            ? <CellStack T={T} main={fmtDateOnly(r.next_saas_payment_at)} sub={`US$ ${r.tier_usd} · ${r.tier_label || r.plan_label || ""}`}/>
            : <span style={{ color:T.yellow, fontWeight:600 }}>activar · US$ {r.tier_usd}</span> },
    { key:"contact", label:"Contacto", render: r => (
      <div style={{ display:"flex", flexDirection:"column", gap:4, alignItems:"flex-start" }}>
        <WaLink T={T} url={r.whatsapp_url}/>
        {(r.contact_email || r.login_email || r.email) && <span style={{ fontSize:DS.font.xs, color:T.textSm, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.contact_email || r.login_email || r.email}</span>}
      </div>
    ) },
    { key:"act", label:"Últ. actividad", nowrap:true, hideMobile:true, render: r => <span title={r.last_activity_at ? fmtDateTime(r.last_activity_at) : ""} style={{ color:T.textSm, fontSize:DS.font.sm }}>{ago(r.last_activity_at)}</span> },
    { key:"channel", label:"Canal · pasarela", hideMobile:true, render: r => <CellStack T={T} main={`${labelOf(CHANNELS, r.channel)} · ${labelOf(PAYMENT_PROVIDERS, r.payment_provider)}`} sub={labelOf(BUSINESS_TYPES, r.business_type)}/> },
    { key:"conn", label:"Conexiones", hideMobile:true, render: r => <ConnPills T={T} c={r.connections}/> },
    { key:"wa", label:"WhatsApp mes", align:"right", nowrap:true, hideMobile:true, render: r => r.wa_sent ? <CellStack T={T} main={fmtUsd2(r.wa_cost_usd)} sub={`${fmtN(r.wa_sent)} avisos`}/> : <span style={{ color:T.textSm }}>—</span> },
    { key:"alta", label:"Alta", nowrap:true, hideMobile:true, render: r => <span title={r.created_at ? fmtDateTime(r.created_at) : ""} style={{ color:T.textMd, fontSize:DS.font.sm }}>{r.created_at ? fmtDateOnly(r.created_at) : "—"}</span> },
  ];

  return (
    <div style={{ fontFamily:F }}>
      <PageHeader T={T} title="Admin de Recurrentes" subtitle="Todos los comercios: altas, planes, suscripciones y cobros. Solo lo ves vos."
        right={<Btn T={T} variant="secondary" size="sm" onClick={refreshAll} disabled={refreshing}>{refreshing ? "Actualizando…" : "Actualizar números"}</Btn>}/>

      <WaTemplatesCard T={T}/>

      {ovErr && <Callout T={T} tone="danger" title="No pudimos cargar el resumen" style={{ marginBottom:14 }}>{ovErr}</Callout>}
      {ov?.stats_pending > 0 && (
        <Callout T={T} tone="info" style={{ marginBottom:14 }} right={<Btn T={T} variant="secondary" size="sm" onClick={refreshAll} disabled={refreshing}>Calcular ahora</Btn>}>
          Faltan los números de {fmtN(ov.stats_pending)} comercio{ov.stats_pending === 1 ? "" : "s"} (suscriptores, MRR y cobros). Se completan solos de a poco.
        </Callout>
      )}

      {/* Lo primero: cuántos comercios tengo y cuánto me pagan. Lo demás, abajo. */}
      <div style={kpiGrid}>
        <KpiCard T={T} hero loading={!ov} label="Comercios" value={fmtN(o.merchants?.accounts)} color={T.accentSolid}
          hint={`+${fmtN(o.merchants?.new_30d)} en 30 días${o.merchants?.stores_extra ? ` · ${fmtN(o.merchants.stores_extra)} tiendas extra` : ""}`} spark={lastN(sig.cumulative, 30)}/>
        <KpiCard T={T} hero loading={!ov} label="Tu MRR" value={fmtUsd(o.saas?.usd_month)} color={T.green}
          hint={`${fmtN(o.saas?.paying)} pagan · ${fmtN(o.saas?.beta)} beta sin cargo · por tramo de suscriptores`} onClick={() => goFilter("pagan")}/>
        <KpiCard T={T} hero loading={!ov} label="A activar plan" value={fmtN(needs.length)} valueColor={needs.length ? T.yellow : T.text}
          hint={needs.length ? "les toca un tramo pago y no lo activaste" : "nadie pendiente"} color={T.yellow} onClick={() => goFilter("activar")}/>
      </div>

      {needs.length > 0 && (
        <Panel T={T} title={`Para activar plan (${needs.length})`} sub={`Tienen más de ${FREE_SUBSCRIBERS} suscriptores activos y todavía no les activaste el plan que les toca. Escribiles y, cuando paguen, activalo acá.`} style={{ marginBottom:16 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {needs.map(r => (
              <div key={r.id} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"9px 12px", background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:10 }}>
                <div style={{ flex:"1 1 220px", minWidth:0 }}>
                  <CellStack T={T} main={r.name} sub={`${fmtN(r.subs)} suscriptores · le toca ${r.tier_label} (US$ ${r.tier_usd}/mes)${r.plan_requested ? ` · lo pidió ${ago(r.plan_requested_at)}` : " · todavía no lo pidió"}`}/>
                </div>
                <WaLink T={T} url={r.whatsapp_url}/>
                <Btn T={T} variant="secondary" size="sm" onClick={() => setOpenId(r.id)}>Ver ficha</Btn>
                <Btn T={T} variant="solid" size="sm" onClick={() => activate(r)}>Activar {r.tier_label}</Btn>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div ref={tableRef} style={{ scrollMarginTop:80 }}>
        <Panel T={T} flush title="Comercios"
          sub={list ? `${fmtN(list.total)} ${list.total === 1 ? "comercio" : "comercios"}${list.filter !== "todos" || qDeb ? " con este filtro" : ""}` : "Cargando…"}
          right={
            <select aria-label="Ordenar" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} style={{ ...InputStyle(T), width:"auto", padding:"7px 10px", fontSize:12 }}>
              {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          }>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", alignItems:"center", padding:"0 16px 12px" }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por tienda, dueño, email, WhatsApp o ID" aria-label="Buscar comercios"
              style={{ ...InputStyle(T), flex:"1 1 240px", maxWidth:360, padding:"8px 12px" }}/>
            <div className="no-scrollbar" style={{ overflowX:"auto", maxWidth:"100%" }}>
              <Segmented T={T} ariaLabel="Filtrar comercios" value={filter} onChange={(v) => { setFilter(v); setPage(1); }}
                options={FILTERS.map(f => ({ ...f, count: f.id === "mias" ? ov?.internal?.count : list?.counts?.[f.id] }))}/>
            </div>
          </div>
          <DSTable T={T} columns={columns} rows={list?.rows || []} rowKey={r => r.id} onRowClick={r => setOpenId(r.id)} minWidth={1000}
            emptyText={listLoading ? "Cargando…" : "No hay comercios con este filtro."}
            style={{ border:"none", borderTop:`1px solid ${T.border}`, borderRadius:0, boxShadow:"none", opacity: listLoading && list ? 0.6 : 1 }}
            footer={list && list.pages > 1 ? (
              <>
                <span>Página {list.page} de {list.pages}</span>
                <span style={{ display:"flex", gap:6 }}>
                  <Btn T={T} variant="secondary" size="sm" disabled={list.page <= 1 || listLoading} onClick={() => setPage(p => Math.max(1, p - 1))}>← Anterior</Btn>
                  <Btn T={T} variant="secondary" size="sm" disabled={list.page >= list.pages || listLoading} onClick={() => setPage(p => p + 1)}>Siguiente →</Btn>
                </span>
              </>
            ) : null}/>
        </Panel>
      </div>

      {/* Métricas de operación, altas y distribuciones: útiles, pero no son lo que
          se mira todos los días. Plegadas para que arriba quede solo lo que importa. */}
      <div style={{ marginTop:16 }}>
        <Btn T={T} variant="secondary" size="sm" onClick={() => setShowMore(v => !v)}>{showMore ? "Ocultar más métricas ▴" : "Más métricas: cobros, altas, canales, WhatsApp, salud ▾"}</Btn>
      </div>
      {showMore && (
        <div style={{ marginTop:14 }}>
      <div style={{ ...kpiGrid, marginBottom:16 }}>
        <KpiCard T={T} loading={!ov} label="Cobros 30 días" value={fmtN(o.charges_30d?.count)} hint={`${fmtARS(o.charges_30d?.amount)} cobrados`} spark={o.charges_30d?.amounts} color={T.blue}/>
        <KpiCard T={T} loading={!ov} label="Pagan Recurrentes" value={fmtN(o.saas?.paying)} hint={`${fmtUsd(o.saas?.usd_month)} por mes`} color={T.green} onClick={() => goFilter("pagan")}/>
        <KpiCard T={T} loading={!ov} label="Beta" value={fmtN(o.saas?.beta)} hint="cuentas viejas, sin cargo" color={T.blue} onClick={() => goFilter("beta")}/>
        <KpiCard T={T} loading={!ov} label="WhatsApp este mes" value={fmtUsd2(o.whatsapp?.cost_usd)} color={T.green}
          hint={`${fmtN(o.whatsapp?.sent)} avisos en ${fmtN(o.whatsapp?.merchants)} comercio${o.whatsapp?.merchants === 1 ? "" : "s"} · a cobrar (Meta: ${fmtUsd2(o.whatsapp?.meta_cost_usd)})`}/>
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:8 }}>
        <Segmented T={T} ariaLabel="Período de altas" value={range} onChange={setRange} options={[{ id:30, label:"30 días" }, { id:90, label:"90 días" }]}/>
      </div>
      <div style={{ marginBottom:16 }}>
        <AreaChart T={T} title="Altas de comercios" total={`${fmtN(sum(lastN(sig.counts, range)))} en ${range} días`} dates={lastN(sig.dates, range)} fmtDate={fmtDM}
          tabs={[
            { id:"dia", label:"Por día", series:[{ key:"altas", label:"Altas", color:T.accentSolid, values:lastN(sig.counts, range), fmt:fmtN }] },
            { id:"total", label:"Acumulado", series:[{ key:"total", label:"Comercios", color:T.blue, values:lastN(sig.cumulative, range), fmt:fmtN }] },
          ]}/>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))", gap:12, marginBottom:16 }}>
        <Panel T={T} title="Por canal"><BarList T={T} color={T.accentSolid} empty="Sin datos todavía." rows={(o.by_channel || []).map(x => ({ key:x.id, label:x.label, value:x.count }))}/></Panel>
        <Panel T={T} title="Por pasarela"><BarList T={T} color={T.blue} empty="Sin datos todavía." rows={(o.by_provider || []).map(x => ({ key:x.id, label:x.label, value:x.count }))}/></Panel>
        <Panel T={T} title="Por tipo de negocio"><BarList T={T} color={T.orange} empty="Sin datos todavía." rows={(o.by_business_type || []).map(x => ({ key:x.id, label:x.label, value:x.count }))}/></Panel>
        <Panel T={T} title="Por plan de Recurrentes" sub="Plan que les toca por suscriptores · cuántos lo pagan">
          <BarList T={T} color={T.green} empty="Sin datos todavía." rows={(o.by_tier || []).map(x => ({ key:x.id, label:x.label, value:x.count, extra: x.activated ? `${x.activated} paga${x.activated === 1 ? "" : "n"}` : null }))}/>
        </Panel>
      </div>

          <AcquisitionPanel T={T} acq={o.acquisition}/>
          <HealthPanel T={T}/>
        </div>
      )}

      {openId && <MerchantPanel id={openId} onClose={() => setOpenId(null)} onChanged={reloadAll}/>}
    </div>
  );
}

// Etiquetas de lo que responde el comerciante al registrarse.
const LEAD_VOL = {
  sin_ventas: "Todavía no vende", "1_50": "Hasta 50 pedidos/mes", "50_200": "50 a 200 pedidos/mes",
  "200_1000": "200 a 1.000 pedidos/mes", "1000_mas": "Más de 1.000 pedidos/mes",
};
const LEAD_OBJ = {
  recompra: "Que vuelvan a comprar solos", ingreso_fijo: "Ingreso fijo mensual",
  ticket: "Vender packs más grandes", dejar_manual: "Dejar de perseguir la recompra", mirando: "Todavía mirando",
};

// ─── Adquisición: registros → conectaron → plan → pagan, por anuncio (Meta Ads propio) ───
// Lo que Meta no puede ver: el pago llega 1 a 3 meses después del clic. Sale de
// merchants/{uid}.acquisition (_lib/acquisition.js); el anuncio es el utm_content del link.
function AcquisitionPanel({ T, acq }) {
  const [range, setRange] = useState("d30");
  const d = acq?.[range] || { totals: {}, by_ad: [] };
  const t = d.totals || {};
  const cols = [
    { key:"ad", label:"Anuncio", render: r => <CellStack T={T} main={r.ad} sub={[r.campaign, r.source].filter(Boolean).join(" · ") || null}/> },
    { key:"registered", label:"Registros", align:"right", nowrap:true, render: r => <b>{fmtN(r.registered)}</b> },
    { key:"store_connected", label:"Conectaron tienda", align:"right", nowrap:true, render: r => `${fmtN(r.store_connected)} · ${r.pct_connected}%` },
    { key:"first_plan", label:"Crearon plan", align:"right", nowrap:true, render: r => fmtN(r.first_plan) },
    { key:"paid", label:"Pagan", align:"right", nowrap:true, render: r => `${fmtN(r.paid)} · ${r.pct_paid}%` },
    { key:"usd_month", label:"US$/mes", align:"right", nowrap:true, render: r => fmtUsd(r.usd_month) },
  ];
  const sub = acq?.pixel
    ? "Registros → conectaron la tienda → crearon plan → pagan, por anuncio (utm_content del link). Eventos al pixel propio por servidor: activo."
    : "Falta el pixel propio: cargá META_PIXEL_ID, META_CAPI_TOKEN y VITE_META_PIXEL_ID en Vercel (TAREAS_THIAGO.md). La tabla igual se arma con los UTM de los links.";
  return (
    <Panel T={T} title="Adquisición · Meta Ads" sub={sub} style={{ marginBottom:16 }}
      right={<Segmented T={T} ariaLabel="Período de adquisición" value={range} onChange={setRange} options={[{ id:"d30", label:"30 días" }, { id:"d90", label:"90 días" }, { id:"all", label:"Todo" }]}/>}>
      <div style={{ display:"flex", gap:18, flexWrap:"wrap", padding:"0 16px 12px", fontSize:DS.font.sm, color:T.textMd }}>
        <span><b style={{ color:T.text }}>{fmtN(t.registered)}</b> registros</span>
        <span><b style={{ color:T.text }}>{fmtN(t.store_connected)}</b> conectaron ({t.pct_connected || 0}%)</span>
        <span><b style={{ color:T.text }}>{fmtN(t.first_plan)}</b> crearon plan</span>
        <span><b style={{ color:T.text }}>{fmtN(t.paid)}</b> pagan ({t.pct_paid || 0}%) · {fmtUsd(t.usd_month)} por mes</span>
      </div>
      <div style={{ padding:"0 16px 16px" }}>
        <DSTable T={T} dense columns={cols} rows={d.by_ad || []} rowKey={r => r.ad} minWidth={680}
          emptyText="Todavía no entró nadie con UTM. Los links de los anuncios tienen que llevar utm_source, utm_campaign y utm_content."/>
      </div>
    </Panel>
  );
}

// ─── Salud del sistema (/api/cron?action=health: solo admins, nunca valores) ───
function HealthPanel({ T }) {
  const [h, setH] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet("cron", { action: "health" });
      if (!d || d.error) { setH(null); setErr(d?.error ? `No pudimos revisar la salud (${d.error}). ¿Tu mail está en ADMIN_EMAILS?` : "No pudimos revisar la salud."); }
      else { setErr(""); setH(d); }
    } catch (e) { setErr(e.message || "No pudimos revisar la salud."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const fails = h?.summary?.required_failed || [];
  const warns = h?.summary?.warnings || [];
  const tone = !h ? T.textSm : fails.length ? T.red : warns.length ? T.yellow : T.green;
  const status = !h ? (err ? "Sin datos" : "Revisando…") : fails.length ? "Falta configurar algo" : warns.length ? "Anda, con avisos" : "Todo en orden";
  const card = { border:`1px solid ${T.borderL}`, borderRadius:10, padding:"8px 10px", background:T.bg };
  const head = { display:"flex", justifyContent:"space-between", gap:8, fontSize:DS.font.sm, fontWeight:700, color:T.text };
  const small = { fontSize:DS.font.xs, color:T.textSm, marginTop:3, wordBreak:"break-word" };
  return (
    <Panel T={T} title="Salud del sistema" style={{ marginBottom:16 }}
      sub={h ? `Revisado ${fmtDateTime(h.checked_at)} · variables de Vercel, base de datos y procesos automáticos` : "Variables de Vercel, base de datos y procesos automáticos"}
      right={<div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <DSBadge T={T} color={tone}>{status}</DSBadge>
        <Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? "Revisando…" : "Revisar"}</Btn>
      </div>}>
      {err && <div style={{ color:T.red, fontSize:DS.font.sm }}>{err}</div>}
      {h && (<>
        {[...fails.map(t => [T.red, "✕", t]), ...warns.map(t => [T.yellow, "!", t])].map(([c, i, t]) => (
          <div key={t} style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:DS.font.sm, color:T.text, padding:"3px 0" }}>
            <span style={{ color:c, fontWeight:800, width:14, textAlign:"center", flexShrink:0 }}>{i}</span><span>{t}</span>
          </div>
        ))}
        {!fails.length && !warns.length && <div style={{ fontSize:DS.font.sm, color:T.textMd }}>Variables, base de datos y procesos automáticos: todo bien.</div>}
        <div style={{ fontSize:DS.font.sm, color: h.reconcile && (!h.reconcile.ok || h.reconcile.errors) ? T.yellow : T.textMd, marginTop:6 }}>
          Conciliación con Mercado Pago: {h.reconcile
            ? `hace ${h.reconcile.minutes_since ?? "?"} min · ${h.reconcile.corrections} ${h.reconcile.corrections === 1 ? "corrección" : "correcciones"}${h.reconcile.partial ? " · parcial" : ""}${h.reconcile.dry_run ? " · modo prueba" : ""}${h.reconcile.errors ? ` · ${h.reconcile.errors} con error` : ""}`
            : "todavía no corrió"}
        </div>
        <button type="button" onClick={() => setOpen(o => !o)} style={{ marginTop:8, background:"none", border:"none", color:T.accentSolid, cursor:"pointer", padding:0, fontSize:DS.font.sm, fontWeight:600 }}>
          {open ? "Ocultar detalle" : "Ver detalle por integración"}
        </button>
        {open && (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:8, marginTop:10 }}>
            {Object.entries(h.env || {}).map(([id, g]) => {
              const missing = Object.entries(g.vars || {}).filter(([, v]) => !v).map(([k]) => k);
              return (
                <div key={id} style={card}>
                  <div style={head}><span>{g.label}</span><span style={{ color: g.configured ? T.green : g.required ? T.red : T.textSm }}>{g.configured ? "✓" : g.required ? "Falta" : "Apagado"}</span></div>
                  {!g.configured && missing.length > 0 && <div style={small}>Falta: {missing.join(", ")}</div>}
                </div>
              );
            })}
            <div style={card}>
              <div style={head}><span>Base de datos</span><span style={{ color: h.firestore?.reachable ? T.green : T.red }}>{h.firestore?.reachable ? "✓" : "No responde"}</span></div>
              {h.firestore?.latency_ms != null && <div style={small}>Respondió en {h.firestore.latency_ms} ms</div>}
            </div>
            {Object.entries(h.crons || {}).map(([name, c]) => (
              <div key={`cron-${name}`} style={card}>
                <div style={head}><span>Proceso {name}</span><span style={{ color: c.stale ? T.red : T.green }}>{c.stale ? "Atrasado" : "✓"}</span></div>
                <div style={small}>{c.minutes_since_ok == null ? "Todavía no corrió desde que se publicó" : `Último OK hace ${c.minutes_since_ok} min`}</div>
              </div>
            ))}
          </div>
        )}
      </>)}
    </Panel>
  );
}

// ─── Ficha lateral de un comercio ────────────────────────────────────────────
function Section({ T, title, children }) {
  return (
    <div style={{ marginBottom:18 }}>
      <div style={{ fontSize:10.5, fontWeight:800, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, marginBottom:6 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ T, k, children }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, fontSize:12.5, padding:"6px 0", borderBottom:`1px solid ${T.borderL}` }}>
      <span style={{ color:T.textSm, flexShrink:0 }}>{k}</span>
      <span style={{ color:T.text, textAlign:"right", minWidth:0, overflowWrap:"anywhere" }}>{children}</span>
    </div>
  );
}
function Mini({ T, label, value, sub }) {
  return (
    <div style={{ background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:10, padding:"9px 11px", minWidth:0 }}>
      <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.4 }}>{label}</div>
      <div style={{ fontSize:17, fontWeight:800, color:T.text, fontVariantNumeric:"tabular-nums", marginTop:2 }}>{value}</div>
      {sub && <div style={{ fontSize:10.5, color:T.textSm }}>{sub}</div>}
    </div>
  );
}

function MerchantPanel({ id, onClose, onChanged }) {
  const T = useT();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [plan, setPlan] = useState("none");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const r = await apiGet("stats", { action: "admin-merchant", id });
    if (!r || r.error) { setErr(r?.error || "No pudimos cargar el comercio."); return; }
    setErr(""); setD(r);
    setPlan(r.merchant.plan_activated || (r.merchant.beta ? "beta" : "none"));
  }, [id]);
  useEffect(() => { setD(null); setErr(""); load(); }, [load]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const m = d?.merchant;
  const s = d?.stats;
  const a = d?.auth;
  const notes = d?.notes || [];
  const audit = d?.audit || [];
  const mailTo = m ? (m.contact_email || a?.email || m.email) : null;

  async function savePlan() {
    setBusy("plan");
    try {
      const r = await apiPost("stats", { merchant_id: id, plan }, { action: "admin-set-plan" });
      if (!r || r.error) throw new Error(r?.error || "No se pudo guardar");
      toast(`Plan guardado: ${planText(plan)}${r.beta && plan !== "beta" ? " (sigue como beta por fecha)" : ""}`, "success");
      await load(); onChanged?.();
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(""); }
  }
  async function saveNote() {
    if (!note.trim()) return;
    setBusy("note");
    try {
      const r = await apiPost("stats", { merchant_id: id, text: note.trim() }, { action: "admin-note" });
      if (!r || r.error) throw new Error(r?.error || "No se pudo guardar la nota");
      setNote(""); toast("Nota guardada", "success"); await load();
    } catch (e) { toast(e.message, "error"); }
    finally { setBusy(""); }
  }
  async function viewAs() {
    if (!await appConfirm(`Vas a ver el panel de ${m.name} tal como lo ve el comercio. Es solo lectura: no se puede guardar ni cambiar nada. Para volver, tocá "Salir" en la barra amarilla de arriba.`, { title:"Ver como este comercio", okLabel:"Ver como" })) return;
    const r = await apiPost("stats", { merchant_id: id }, { action: "admin-view-as" });
    if (!r || r.error) { toast(r?.error || "No se pudo entrar", "error"); return; }
    setAdminAs({ id, name: r.merchant?.name || m.name });
    window.location.hash = "#/dashboard/analiticas";
    window.location.reload();
  }

  const linkBtn = { display:"inline-flex", alignItems:"center", gap:5, fontSize:12.5, fontWeight:600, color:T.textMd, textDecoration:"none", border:`1px solid ${T.border}`, borderRadius:DS.r.md, padding:"6px 11px", whiteSpace:"nowrap", fontFamily:F };

  return ReactDOM.createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(0,0,0,0.45)", backdropFilter:"blur(2px)", display:"flex", justifyContent:"flex-end", fontFamily:F }}>
      <aside role="dialog" aria-modal="true" aria-label="Ficha del comercio"
        style={{ width:"min(520px, 100vw)", height:"100%", background:T.card, borderLeft:`1px solid ${T.border}`, boxShadow:"-20px 0 60px rgba(0,0,0,0.35)", display:"flex", flexDirection:"column" }}>
        <div style={{ padding:"16px 18px 12px", borderBottom:`1px solid ${T.border}`, flexShrink:0 }}>
          <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
            <div style={{ width:40, height:40, borderRadius:10, background:T.accentSolid + "22", color:T.accent, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:800, fontSize:17, flexShrink:0 }}>
              {String(m?.name || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:16, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m ? m.name : "Cargando…"}</div>
              <div style={{ fontSize:12, color:T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{m ? [m.owner_name, a?.email || m.email].filter(Boolean).join(" · ") : ""}</div>
              {m && (
                <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
                  <PlanBadge T={T} r={m}/>
                  {m.is_store && <DSBadge T={T} color={T.blue} size="sm">Tienda extra</DSBadge>}
                  {m.dev_mode && <DSBadge T={T} color={T.orange} size="sm">Modo prueba</DSBadge>}
                  {!m.ready && <DSBadge T={T} color={T.yellow} size="sm">Sin conectar</DSBadge>}
                  {m.deleted && <DSBadge T={T} color={T.red} size="sm">Eliminada</DSBadge>}
                </div>
              )}
            </div>
            <button onClick={onClose} aria-label="Cerrar" style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:8, width:32, height:32, fontSize:15, cursor:"pointer", color:T.textMd, flexShrink:0, padding:0 }}>✕</button>
          </div>
          {m && (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:12 }}>
              <WaLink T={T} url={m.whatsapp_url} big>Escribir por WhatsApp</WaLink>
              {mailTo && <a href={`mailto:${mailTo}`} style={linkBtn}>Mandar mail</a>}
              <Btn T={T} variant="solid" size="sm" onClick={viewAs}>Ver como este comercio</Btn>
            </div>
          )}
        </div>

        <div style={{ padding:"14px 18px 28px", overflowY:"auto", flex:1 }}>
          {err ? <Callout T={T} tone="danger" title="No pudimos cargar la ficha">{err}</Callout> : !m ? <Loading T={T}/> : (
            <>
              <Section T={T} title="Números">
                <div style={{ display:"grid", gridTemplateColumns:"repeat(2,minmax(0,1fr))", gap:8 }}>
                  <Mini T={T} label="Suscripciones" value={fmtN(m.subs)} sub="activas"/>
                  <Mini T={T} label="MRR" value={fmtARS(m.mrr)} sub={m.active != null ? `${fmtN(m.active)} activas` : ""}/>
                  <Mini T={T} label="Cobros 30 días" value={m.ch30_count != null ? fmtN(m.ch30_count) : "—"} sub={m.ch30_amount != null ? fmtARS(m.ch30_amount) : ""}/>
                  <Mini T={T} label="Último cobro" value={m.last_charge_at ? fmtDateOnly(m.last_charge_at) : "—"} sub={m.last_charge_at ? ago(m.last_charge_at) : "sin cobros"}/>
                  {m.whatsapp_usage && (m.whatsapp_usage.wa_sent > 0 || m.whatsapp_usage.platform_enabled) && (
                    <Mini T={T} label="WhatsApp este mes" value={fmtUsd2(m.whatsapp_usage.wa_cost_usd)}
                      sub={`${fmtN(m.whatsapp_usage.wa_platform_sent)} desde Recurrentes${m.whatsapp_usage.wa_own_sent ? ` · ${fmtN(m.whatsapp_usage.wa_own_sent)} con su número` : ""} · a cobrar`}/>
                  )}
                </div>
                {s?.at && <div style={{ fontSize:10.5, color:T.textSm, marginTop:6 }}>Calculado {ago(s.at)}.</div>}
              </Section>

              <Section T={T} title="Contacto">
                <Row T={T} k="Dueño">{m.owner_name || "—"}</Row>
                <Row T={T} k="WhatsApp">{m.owner_whatsapp || "—"}</Row>
                <Row T={T} k="Email de contacto">{m.contact_email || "—"}</Row>
                {/* Lo que respondió al registrarse (23-sept-2026): sirve para
                    priorizar a quién llamar y con qué argumento. */}
                {m.lead_volumen && <Row T={T} k="Vende hoy">{LEAD_VOL[m.lead_volumen] || m.lead_volumen}</Row>}
                {m.lead_objetivo && <Row T={T} k="Busca">{LEAD_OBJ[m.lead_objetivo] || m.lead_objetivo}</Row>}
                {m.lead_instalacion && (
                  <Row T={T} k="Instalación">
                    {m.lead_instalacion === "asistida"
                      ? <span style={{ color:T.green, fontWeight:700 }}>Quiere asistida · USD 100</span>
                      : "La hace solo"}
                  </Row>
                )}
              </Section>

              <Section T={T} title="Cuenta">
                {/* Sin cartel de verificado: la verificacion de mail se saco el
                    19-sept-2026 y nadie la hace, asi que "sin verificar" era un
                    aviso amarillo permanente que no significaba nada. */}
                <Row T={T} k="Login">{a?.email || m.email || "—"}</Row>
                <Row T={T} k="Alta">{m.created_at ? `${fmtDateOnly(m.created_at)} (${ago(m.created_at)})` : "—"}</Row>
                <Row T={T} k="Último login">{a?.last_login_at ? fmtDateTime(a.last_login_at) : "—"}</Row>
                <Row T={T} k="Último acceso">{ago(a?.last_seen_at)}</Row>
                <Row T={T} k="Abrió su panel">{ago(m.panel_seen_at)}</Row>
                {a?.providers?.length > 0 && <Row T={T} k="Entra con">{a.providers.map(p => p === "password" ? "email y contraseña" : p === "google.com" ? "Google" : p).join(", ")}</Row>}
                {m.team_count > 1 && <Row T={T} k="Equipo">{m.team_count} personas</Row>}
                {m.stores?.length > 1 && <Row T={T} k="Tiendas">{m.stores.map(x => x.name || x.id).join(", ")}</Row>}
                <Row T={T} k="ID">
                  <button onClick={() => copyText(m.id, "ID copiado")} title="Copiar ID" style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:6, color:T.textSm, cursor:"pointer", padding:"2px 8px", fontSize:11, fontFamily:"ui-monospace, Menlo, monospace" }}>{m.id}</button>
                </Row>
              </Section>

              <Section T={T} title="Negocio">
                <Row T={T} k="Tipo">{labelOf(BUSINESS_TYPES, m.business_type)}{!m.profile_explicit && <span style={{ color:T.textSm }}> (por defecto)</span>}</Row>
                <Row T={T} k="Canal">{labelOf(CHANNELS, m.channel)}</Row>
                <Row T={T} k="Pasarela">{labelOf(PAYMENT_PROVIDERS, m.payment_provider)}</Row>
                <Row T={T} k="Conexiones"><ConnPills T={T} c={m.connections}/></Row>
                {m.connections?.shopify_shop && <Row T={T} k="Shopify"><a href={`https://${m.connections.shopify_shop}/admin`} target="_blank" rel="noreferrer" style={{ color:T.accent, fontWeight:600, textDecoration:"none" }}>{m.connections.shopify_shop} ↗</a></Row>}
                {m.mp_email && <Row T={T} k="Cuenta de MP">{m.mp_email}</Row>}
                {!m.ready && m.missing?.length > 0 && <Callout T={T} tone="warning" style={{ marginTop:8 }}>Le falta conectar {m.missing.join(" y ")}.</Callout>}
              </Section>

              <Section T={T} title="Plan de Recurrentes">
                <Row T={T} k="Hoy"><PlanBadge T={T} r={m}/></Row>
                <Row T={T} k="Le toca por suscriptores">{TIER_BY_ID[m.tier]?.label || m.tier} ({fmtN(m.subs)})</Row>
                <Row T={T} k="Activado">{m.plan_activated ? `${planText(m.plan_activated)}${m.plan_activated_at ? ` · ${fmtDateOnly(m.plan_activated_at)}` : ""}` : "—"}</Row>
                {m.plan_requested && <Row T={T} k="Lo pidió">{planText(m.plan_requested)} · {ago(m.plan_requested_at)}</Row>}
                {m.beta_reason === "fecha" && <div style={{ fontSize:11.5, color:T.textSm, marginTop:6, lineHeight:1.5 }}>Cuenta creada antes del 13/09/2026: es beta por fecha. Si le activás un plan pago, deja de ser beta.</div>}
                <div style={{ display:"flex", gap:8, marginTop:10, alignItems:"center" }}>
                  <select aria-label="Plan" value={plan} onChange={e => setPlan(e.target.value)} style={{ ...InputStyle(T), flex:1, padding:"8px 10px", fontSize:12.5 }}>
                    {PLAN_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <Btn T={T} variant="primary" size="sm" disabled={busy === "plan"} onClick={savePlan}>{busy === "plan" ? "Guardando…" : "Guardar plan"}</Btn>
                </div>
              </Section>

              <Section T={T} title={`Notas internas (${notes.length})`}>
                <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} placeholder="Ej: le pasé el precio por WhatsApp, vuelve a escribir el lunes"
                  style={{ ...InputStyle(T), minHeight:64, resize:"vertical", fontSize:12.5 }}/>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, margin:"6px 0 10px" }}>
                  <span style={{ fontSize:11, color:T.textSm }}>Solo las ven los admins, nunca el comercio.</span>
                  <Btn T={T} variant="secondary" size="sm" disabled={!note.trim() || busy === "note"} onClick={saveNote}>{busy === "note" ? "Guardando…" : "Guardar nota"}</Btn>
                </div>
                {notes.map(n => (
                  <div key={n.id || n.at} style={{ background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
                    <div style={{ fontSize:12.5, color:T.text, whiteSpace:"pre-wrap", lineHeight:1.5 }}>{n.text}</div>
                    <div style={{ fontSize:10.5, color:T.textSm, marginTop:3 }}>{n.by} · {fmtDateTime(n.at)}</div>
                  </div>
                ))}
              </Section>

              <Section T={T} title="Registro de acciones">
                {audit.length === 0 ? <div style={{ fontSize:12, color:T.textSm }}>Todavía nada.</div> : audit.map(x => (
                  <div key={x.id} style={{ display:"flex", justifyContent:"space-between", gap:10, fontSize:12, padding:"6px 0", borderBottom:`1px solid ${T.borderL}` }}>
                    <span style={{ color:T.text }}>{AUDIT_LABEL[x.action] || x.action}{x.action === "set_plan" && x.detail?.to ? `: ${planText(x.detail.to)}` : ""}</span>
                    <span style={{ color:T.textSm, textAlign:"right", flexShrink:0 }}>{x.admin_email || "—"} · {fmtDateTime(x.at)}</span>
                  </div>
                ))}
              </Section>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

// ─── Barra de "ver como" (arriba del panel del comercio) ─────────────────────
export function AdminViewBanner({ T, merchant }) {
  const name = getAdminAs()?.name || merchant?.store_name || merchant?.shop_name || merchant?.id;
  const salir = () => { setAdminAs(null); window.location.hash = "#/admin"; window.location.reload(); };
  return (
    <div role="status" style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"9px 24px", background:T.yellow + "1f", borderBottom:`1px solid ${T.yellow}55`, color:T.text, fontSize:12.5, fontFamily:F }}>
      <span style={{ width:8, height:8, borderRadius:99, background:T.yellow, flexShrink:0 }}/>
      <span style={{ flex:1, minWidth:200 }}>Estás viendo el panel de <b>{name}</b> como admin. Es solo lectura: nada de lo que toques se guarda.</span>
      <Btn T={T} variant="secondary" size="sm" onClick={salir}>Salir de "ver como"</Btn>
    </div>
  );
}

// ─── Plantillas de WhatsApp de Recurrentes en Meta ───────────────────────────
// Lista el estado de cada plantilla (clientes, comercios, límite del plan, admin)
// y las crea por API con un botón: nada de cargarlas a mano en WhatsApp Manager.
const WA_STATUS = { APPROVED: ["Aprobada", "green"], PENDING: ["En revisión", "yellow"], REJECTED: ["Rechazada", "red"], MISSING: ["Falta crear", "textSm"], PAUSED: ["Pausada", "red"], DISABLED: ["Deshabilitada", "red"] };
function WaTemplatesCard({ T }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function load() {
    setBusy(true); setErr(null);
    try { const d = await apiGet("stats", { action: "admin-wa-templates" }); if (d?.error) setErr(d.error); else setData(d); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  async function sync() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost("stats", {}, { action: "admin-wa-templates-sync" });
      if (r?.error) setErr(r.error);
      else toast(`Creadas ${r.created?.length || 0} · ya estaban ${r.skipped?.length || 0}${r.errors?.length ? ` · con error ${r.errors.length}` : ""}`, r.errors?.length ? "warning" : "success", 7000);
      if (r?.errors?.length) setErr(r.errors.map(e => `${e.name}: ${e.detail || e.error}`).join(" · "));
      await load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  // Manda aviso_admin a tu WhatsApp. Sirve para ver que llega apenas Meta apruebe la plantilla.
  async function testMe() {
    setBusy(true); setErr(null);
    try {
      const r = await apiPost("stats", {}, { action: "admin-wa-test" });
      if (r?.error) setErr(r.error);
      else if (r.ok) toast("Enviado. Mirá tu WhatsApp.", "success", 6000);
      else { const w = r.result?.whatsapp?.[0]; setErr(w?.error ? `Meta no lo mandó: ${w.error}` : (r.result?.email?.ok ? "WhatsApp no salió; te llegó por mail." : "No se pudo enviar.")); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  useEffect(() => { if (open && !data) load(); /* eslint-disable-next-line */ }, [open]);
  const missing = (data?.templates || []).filter(t => t.status === "MISSING").length;
  return (
    <Callout T={T} tone="info" style={{ marginBottom:14 }} title="Plantillas de WhatsApp en Meta"
      right={<div style={{ display:"flex", gap:8 }}>
        <Btn T={T} variant="secondary" size="sm" onClick={() => setOpen(o => !o)}>{open ? "Ocultar" : "Ver estado"}</Btn>
        {open && data?.available && <Btn T={T} variant="solid" size="sm" onClick={sync} disabled={busy || missing === 0}>{busy ? "Enviando a Meta…" : missing ? `Crear ${missing} en Meta` : "Todas creadas"}</Btn>}
        {open && data?.available && <Btn T={T} variant="secondary" size="sm" onClick={testMe} disabled={busy}>Enviarme una prueba</Btn>}
      </div>}>
      Los avisos a clientes, a comercios, del límite del plan y a vos salen con plantillas que Meta tiene que aprobar. Acá las creás por API y ves cómo van.
      {open && (
        <div style={{ marginTop:10 }}>
          {err && <div style={{ color:T.red, fontSize:DS.font.sm, marginBottom:8 }}>{err}</div>}
          {data && !data.available && <div style={{ color:T.textSm, fontSize:DS.font.sm }}>{data.reason}</div>}
          {busy && !data && <div style={{ color:T.textSm, fontSize:DS.font.sm }}>Consultando a Meta…</div>}
          {data?.available && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:6 }}>
              {data.templates.map(t => { const [lbl, col] = WA_STATUS[t.status] || [t.status, "textSm"]; return (
                <div key={t.name} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, padding:"6px 8px", border:`1px solid ${T.border}`, borderRadius:8, background:T.card }}>
                  <CellStack T={T} main={t.title} sub={t.name}/>
                  <span title={t.rejected_reason || ""}><DSBadge T={T} color={T[col] || T.textSm} size="sm">{lbl}</DSBadge></span>
                </div>
              ); })}
            </div>
          )}
        </div>
      )}
    </Callout>
  );
}
