import { useState, useEffect, useMemo } from "react";
import { useTabRefresh } from "../lib/tabs.js";
import { apiGet, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, DSToggle, Spinner, DSTable, CellStack, PageHeader, Callout, Field, InputStyle, Hint, Loading, toast } from "../ui/components.jsx";
import { KpiCard, Segmented, BarList, Panel } from "../ui/charts.jsx";
import { goConfigSection } from "../lib/onboarding.js";
import { fmtARS, fmtDateOnly, fmtAgo, copyText, portalUrl, hashQuery } from "./_shared.jsx";
import { fetchAnalytics, REASON_LABELS } from "./Analytics.jsx";
import { performSubAction, StatusBadge } from "./Subscriptions.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";

// Solo de respaldo: el GET del merchant siempre trae retention.reasons.
const DEFAULT_REASONS = [
  { code:"precio",  label:"Me resulta caro" },
  { code:"stock",   label:"Todavía tengo producto" },
  { code:"no_uso",  label:"Ya no lo uso" },
  { code:"calidad", label:"No me convenció el producto" },
  { code:"otro",    label:"Otro motivo" },
];
const MAX_REASONS = 8;
const slug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 32) || "motivo";
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);

// Secciones (píldoras): #/dashboard/retencion?sec=fallidos|sinpagar
const SECS = ["cancelacion", "fallidos", "sinpagar"];
const readSec = () => { const s = hashQuery().get("sec"); return SECS.includes(s) ? s : "cancelacion"; };

// ─── Página: Retención — estilo Growith: KPIs de 30 días arriba y las tres
// palancas (cancelación · pagos fallidos · checkouts sin pagar) en píldoras.
export function RetentionPage({ merchant, reloadMerchant, goTab }) {
  const T = useT();
  const profile = useMemo(() => merchantProfile(merchant), [merchant]);
  const [sec, setSec] = useState(readSec);
  const [analytics, setAnalytics] = useState(null);
  const [failed, setFailed] = useState([]);
  const [unpaidCount, setUnpaidCount] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    const [an, pf, un] = await Promise.all([
      fetchAnalytics(6).catch(() => null),
      apiGet("subscribers", { status: "payment_failed" }).catch(() => null),
      apiGet("subscribers", { status: "unpaid" }).catch(() => null),
    ]);
    setAnalytics(an);
    setFailed(pf?.subscribers || []);
    const list = un && !un.error ? (un.subscribers || un.items || un.unpaid || []) : null;
    setUnpaidCount(list ? (un.count ?? un.total ?? list.length) : null);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useTabRefresh("retencion", () => load({ silent: true }));
  const goSec = (id) => {
    setSec(id);
    try { window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/retencion${id === "cancelacion" ? "" : "?sec=" + id}`); } catch (_) {}
  };

  const a = analytics || {};
  const monthly = Array.isArray(a.monthly) ? a.monthly : [];
  const rec = a.recovery || null;
  const cancelled30 = Number(a.cancelled_30d) || 0;
  const saved30 = a.saved_30d ?? null;
  const attempts = saved30 != null ? cancelled30 + saved30 : null;
  const churn = Number(a.churn_30d_pct) || 0;
  const first = loading && !analytics;

  const tabs = [
    { id:"cancelacion", label:"Cancelación" },
    { id:"fallidos",    label:"Pagos fallidos", count: loading ? null : failed.length },
    { id:"sinpagar",    label:"Sin pagar",      count: loading || unpaidCount == null ? null : unpaidCount },
  ];

  return (
    <div>
      <PageHeader T={T} title="Retención" subtitle="Menos bajas, más pagos recuperados. Qué pasa cuando un cliente quiere cancelar, cuando falla un cobro y con los que no terminaron de pagar."
        right={<Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>}/>

      {/* KPIs de los últimos 30 días — tocás una y abre su sección */}
      <div className="kpi-grid" style={{ display:"grid", gap:10, marginBottom:16 }}>
        <KpiCard T={T} hero loading={first} label="Churn · 30 días" value={`${churn.toLocaleString("es-AR", { maximumFractionDigits:1 })}%`}
          valueColor={churn > 5 ? T.red : T.text} color={T.red} spark={monthly.map(m => Number(m.cancelled) || 0)}
          hint={`${fmtN(cancelled30)} baja${cancelled30 === 1 ? "" : "s"} · línea: bajas por mes`}/>
        <KpiCard T={T} hero loading={first} label="Bajas evitadas" value={saved30 == null ? "—" : fmtN(saved30)} valueColor={saved30 ? T.green : T.text} color={T.green}
          hint={attempts ? `${pctOf(saved30, attempts)}% de ${fmtN(attempts)} intentos de baja` : "pausaron o aceptaron descuento"} onClick={() => goSec("cancelacion")}/>
        <KpiCard T={T} hero loading={first} label="Pagos recuperados" value={rec ? `${fmtN(rec.recovered_30d)}/${fmtN(rec.failed_30d)}` : "—"} color={T.yellow}
          hint={rec?.failed_30d ? `${pctOf(rec.recovered_30d, rec.failed_30d)}% recuperado · ${fmtN(failed.length)} en pago fallido hoy` : "sin pagos fallidos en 30 días"} onClick={() => goSec("fallidos")}/>
        <KpiCard T={T} hero loading={loading && unpaidCount == null} label="Checkouts sin pagar" value={unpaidCount == null ? "—" : fmtN(unpaidCount)} valueColor={unpaidCount ? T.yellow : T.text} color={T.blue}
          hint="últimos 30 días" onClick={() => goSec("sinpagar")}/>
      </div>

      <div style={{ marginBottom:14, maxWidth:"100%", overflowX:"auto" }}>
        <Segmented T={T} options={tabs} value={sec} onChange={goSec} ariaLabel="Sección de retención"/>
      </div>

      {/* Las tres quedan montadas (solo se ocultan) para no perder cambios sin guardar del flujo de cancelación al cambiar de píldora. */}
      <div hidden={sec !== "cancelacion"}><CancelSection T={T} merchant={merchant} reloadMerchant={reloadMerchant} analytics={analytics} loading={loading}/></div>
      <div hidden={sec !== "fallidos"}><FailedSection T={T} merchant={merchant} profile={profile} failed={failed} loading={loading} reload={load} goTab={goTab}/></div>
      <div hidden={sec !== "sinpagar"}><UnpaidSection T={T} merchant={merchant} profile={profile} count={unpaidCount} loading={loading} goTab={goTab}/></div>
    </div>
  );
}

// ─── (a) Cancelación ───────────────────────────────────────────────
function CancelSection({ T, merchant, reloadMerchant, analytics, loading }) {
  const iS = InputStyle(T);
  const saved = merchant?.retention || {};
  const [enabled, setEnabled] = useState(saved.enabled !== false);
  const [offerPause, setOfferPause] = useState(saved.offer_pause !== false);
  const [pauseCycles, setPauseCycles] = useState(Number(saved.pause_cycles) || 1);
  const [discount, setDiscount] = useState(Number(saved.offer_discount_pct) || 0);
  const [reasons, setReasons] = useState(Array.isArray(saved.reasons) && saved.reasons.length ? saved.reasons : DEFAULT_REASONS);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const r = merchant?.retention || {};
    setEnabled(r.enabled !== false); setOfferPause(r.offer_pause !== false); setPauseCycles(Number(r.pause_cycles) || 1);
    setDiscount(Number(r.offer_discount_pct) || 0); setReasons(Array.isArray(r.reasons) && r.reasons.length ? r.reasons : DEFAULT_REASONS); setDirty(false);
  }, [merchant?.id, merchant?.retention]);

  const mark = (fn) => (...a) => { fn(...a); setDirty(true); };
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= reasons.length) return; const n = [...reasons]; [n[i], n[j]] = [n[j], n[i]]; setReasons(n); setDirty(true); };
  const editLabel = (i, label) => { const n = [...reasons]; n[i] = { ...n[i], label }; setReasons(n); setDirty(true); };
  const remove = (i) => { setReasons(reasons.filter((_, k) => k !== i)); setDirty(true); };
  const add = () => {
    const label = newLabel.trim(); if (!label) return;
    if (reasons.length >= MAX_REASONS) return toast(`Máximo ${MAX_REASONS} motivos`, "warning");
    let code = slug(label); if (reasons.some(r => r.code === code)) code = `${code}_${reasons.length + 1}`;
    setReasons([...reasons, { code, label }]); setNewLabel(""); setDirty(true);
  };

  async function save() {
    const clean = reasons.map(r => ({ code: slug(r.code || r.label), label: String(r.label || "").trim().slice(0, 60) })).filter(r => r.label);
    if (enabled && clean.length === 0) return toast("Agregá al menos un motivo", "warning");
    setSaving(true);
    try {
      const r = await apiPatch("merchant", { retention: { enabled, offer_pause: offerPause, pause_cycles: pauseCycles, offer_discount_pct: Math.max(0, Math.min(90, Math.round(Number(discount) || 0))), reasons: clean } }, { action: "save-settings" });
      if (r?.error) throw new Error(r.error);
      toast("Flujo de cancelación guardado", "success"); setDirty(false); reloadMerchant?.();
    } catch (e) { toast("No se pudo guardar: " + e.message, "error", 6000); }
    finally { setSaving(false); }
  }

  const a = analytics || {};
  const labelOf = (code) => reasons.find(r => r.code === code)?.label || DEFAULT_REASONS.find(r => r.code === code)?.label || REASON_LABELS[code] || code || "Sin motivo";
  const allReasons = Array.isArray(a.cancel_reasons) ? a.cancel_reasons : [];
  const totalReasons = allReasons.reduce((s, r) => s + (Number(r.count) || 0), 0);
  const reasonRows = [...allReasons].sort((x, y) => (y.count || 0) - (x.count || 0)).slice(0, 6).map(r => ({
    key: r.code || "sin", label: labelOf(r.code), value: Number(r.count) || 0,
    extra: `${pctOf(r.count || 0, totalReasons)}%${r.saved ? ` · ${r.saved} salvada${r.saved === 1 ? "" : "s"}` : ""}`,
  }));
  const sectionLabel = { fontSize:10, textTransform:"uppercase", color:T.textSm, fontWeight:700, letterSpacing:0.6, margin:"16px 0 8px" };

  return (
    <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.3fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
      <Panel T={T} title="Flujo de cancelación" sub="Antes de dejar cancelar, preguntamos el motivo y ofrecemos alternativas. Es lo que más bajas evita."
        right={<>
          {dirty && <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>}
          <Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>
        </>}>
        <ToggleRow T={T} active={enabled} onToggle={mark(() => setEnabled(!enabled))} title="Preguntar motivo y ofrecer pausa antes de cancelar" desc="El cliente elige un motivo en el portal y ve las alternativas antes del botón final."/>

        <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
          <div style={sectionLabel}>Motivos ({reasons.length}/{MAX_REASONS})</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {reasons.map((r, i) => (
              <div key={r.code + i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                  <button onClick={() => move(i, -1)} disabled={i === 0} title="Subir" aria-label={`Subir "${r.label}"`} style={arrowBtn(T, i === 0)}>▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === reasons.length - 1} title="Bajar" aria-label={`Bajar "${r.label}"`} style={arrowBtn(T, i === reasons.length - 1)}>▼</button>
                </div>
                <input value={r.label} onChange={e => editLabel(i, e.target.value)} maxLength={60} aria-label={`Motivo ${i + 1}`} style={{ ...iS, flex:1, minWidth:0, padding:"7px 10px", fontSize:DS.font.md }}/>
                <code className="hide-mobile" style={{ fontSize:DS.font.xs, color:T.textSm, width:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.code}>{r.code}</code>
                <button onClick={() => remove(i)} title="Quitar" aria-label={`Quitar "${r.label}"`} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:15, padding:"2px 6px" }}>✕</button>
              </div>
            ))}
          </div>
          {reasons.length < MAX_REASONS && (
            <div style={{ display:"flex", gap:6, marginTop:8 }}>
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Nuevo motivo (ej. “Me mudo”)" maxLength={60} aria-label="Nuevo motivo" style={{ ...iS, flex:1, minWidth:0, padding:"7px 10px", fontSize:DS.font.md }}/>
              <Btn T={T} variant="secondary" size="sm" onClick={add} disabled={!newLabel.trim()}>+ Agregar</Btn>
            </div>
          )}

          <div style={{ marginTop:18 }}>
            <ToggleRow T={T} active={offerPause} onToggle={mark(() => setOfferPause(!offerPause))} title="Ofrecer pausar en vez de cancelar" desc="Le proponemos saltear los próximos ciclos y seguir después."
              right={offerPause && (
                <select value={pauseCycles} onChange={e => { setPauseCycles(Number(e.target.value)); setDirty(true); }} aria-label="Ciclos de pausa" style={{ ...iS, width:"auto", padding:"5px 8px", fontSize:DS.font.sm }}>
                  <option value={1}>1 ciclo</option><option value={2}>2 ciclos</option><option value={3}>3 ciclos</option>
                </select>)}/>
          </div>
          <div style={{ marginTop:14, maxWidth:320 }}>
            <Field T={T} label="Descuento de retención (%)">
              <input type="number" min={0} max={90} value={discount} onChange={e => { setDiscount(e.target.value); setDirty(true); }} style={iS}/>
            </Field>
            <Hint T={T}>0 = no ofrecer. Si ponés 15, le proponemos 15% menos en el próximo cobro antes de que cancele. El descuento se aplica repreciando la suscripción en Mercado Pago.</Hint>
          </div>
        </div>
      </Panel>

      <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg, minWidth:0 }}>
        <CancelPreview T={T} enabled={enabled} reasons={reasons} offerPause={offerPause} pauseCycles={pauseCycles} discount={Number(discount) || 0} brand={merchant?.email_brand_effective || merchant?.store_name || "Tu marca"} color={merchant?.widget_color || T.accentSolid}/>
        <Panel T={T} title="Motivos de baja" sub="Lo que eligen tus clientes al cancelar desde el portal, y cuántas se salvaron con la pausa o el descuento.">
          {loading && !analytics ? <Loading T={T}/> : <BarList T={T} rows={reasonRows} color={T.red} empty="Sin motivos registrados todavía."/>}
        </Panel>
      </div>
    </div>
  );
}

const arrowBtn = (T, disabled) => ({ background:"transparent", border:`1px solid ${T.border}`, borderRadius:4, color:T.textSm, cursor: disabled ? "default" : "pointer", fontSize:8, lineHeight:1, padding:"2px 4px", opacity: disabled ? 0.35 : 1 });

function ToggleRow({ T, active, onToggle, title, desc, right }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:`1px solid ${T.borderL}` }}>
      <DSToggle T={T} active={active} onToggle={onToggle}/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text }}>{title}</div>
        {desc && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.45 }}>{desc}</div>}
      </div>
      {right}
    </div>
  );
}

// Mini mock de lo que ve el cliente en el portal al tocar "Cancelar".
function CancelPreview({ T, enabled, reasons, offerPause, pauseCycles, discount, brand, color }) {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState(null);
  const btn = (primary) => ({ width:"100%", padding:"8px 10px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border: primary ? "none" : `1px solid ${T.border}`, background: primary ? color : "transparent", color: primary ? "#fff" : T.textMd, fontFamily:"inherit", marginTop:6 });
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", background:T.bg }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:T.surface, borderBottom:`1px solid ${T.borderL}` }}>
        <span style={{ fontSize:10, color:T.textSm, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>Vista previa · portal</span>
        <span style={{ display:"flex", gap:4 }}>{[0, 1, 2].map(i => <span key={i} style={{ width:6, height:6, borderRadius:"50%", background: i === step ? color : T.border }}/>)}</span>
      </div>
      <div style={{ padding:14, minHeight:190 }}>
        <div style={{ fontSize:11, color:T.textSm, marginBottom:6 }}>{brand} · Mi suscripción</div>
        {!enabled ? (
          <>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:6 }}>¿Cancelar la suscripción?</div>
            <div style={{ fontSize:12, color:T.textMd, marginBottom:8 }}>Sin preguntas: el cliente cancela en un toque.</div>
            <button style={{ ...btn(false), color:T.red, borderColor:T.red + "55" }}>Cancelar suscripción</button>
          </>
        ) : step === 0 ? (
          <>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:8 }}>¿Por qué querés cancelar?</div>
            {reasons.slice(0, MAX_REASONS).map(r => (
              <label key={r.code} onClick={() => setPicked(r.code)} style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:T.textMd, padding:"4px 0", cursor:"pointer" }}>
                <span style={{ width:12, height:12, borderRadius:"50%", border:`2px solid ${picked === r.code ? color : T.border}`, background: picked === r.code ? color : "transparent", flexShrink:0 }}/>{r.label || "…"}
              </label>
            ))}
            <button style={btn(true)} onClick={() => setStep(offerPause || discount > 0 ? 1 : 2)}>Continuar</button>
          </>
        ) : step === 1 ? (
          <>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:6 }}>Antes de irte…</div>
            {offerPause && <button style={btn(true)} onClick={() => setStep(0)}>⏸ Pausar {pauseCycles} {pauseCycles === 1 ? "ciclo" : "ciclos"} sin cargo</button>}
            {discount > 0 && <button style={{ ...btn(!offerPause) }} onClick={() => setStep(0)}>🎁 Seguir con {discount}% de descuento</button>}
            <button style={{ ...btn(false), color:T.textSm }} onClick={() => setStep(2)}>No, quiero cancelar</button>
          </>
        ) : (
          <>
            <div style={{ fontSize:13, fontWeight:700, color:T.text, marginBottom:6 }}>Confirmar cancelación</div>
            <div style={{ fontSize:12, color:T.textMd, marginBottom:8 }}>No se te cobra más. Podés volver cuando quieras.</div>
            <button style={{ ...btn(false), color:T.red, borderColor:T.red + "55" }} onClick={() => setStep(0)}>Cancelar suscripción</button>
            <button style={{ ...btn(false) }} onClick={() => setStep(0)}>Volver</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── (b) Pagos fallidos ────────────────────────────────────────────
function FailedSection({ T, merchant, profile, failed, loading, reload, goTab }) {
  const [busy, setBusy] = useState(null);
  const run = (s, action) => performSubAction(s, action, { setBusy: (id) => setBusy(id ? s.id : null), refresh: reload });
  const failedAt = (s) => s.last_payment_failed_at || s.payment_failed_at || s.updated_at;
  const afterCharge = profile.caps.orders ? `se crea la orden en ${profile.channelInfo.label}` : "se registra el cobro";
  const steps = [
    <><strong style={{ color:T.text }}>Mercado Pago reintenta solo</strong> el cobro varias veces durante los días siguientes (hasta ~4 intentos). No hace falta que hagas nada.</>,
    <>Al primer rechazo, la suscripción pasa a <StatusBadge status="payment_failed"/> y <strong style={{ color:T.text }}>le mandamos un mail al cliente</strong> con el link del portal para actualizar la tarjeta.</>,
    <>Si activás el flujo <strong style={{ color:T.text }}>Pago rechazado</strong> en Flujos de email, le mandamos más recordatorios con tu marca hasta que actualice la tarjeta.</>,
    <>Cuando MP logra cobrar, la suscripción vuelve a activa sola y {afterCharge}. Si pasan los reintentos sin éxito, MP la cancela.</>,
  ];

  return (
    <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.5fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
      <Panel T={T} title="Suscripciones con pago fallido" sub="Mandales el link del portal para que actualicen la tarjeta, o sincronizá si ya pagaron." flush>
        {loading ? <div style={{ padding:16 }}><Loading T={T}/></div> : failed.length === 0 ? (
          <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"4px 16px 18px" }}>✅ Ninguna. Cuando MP rechace un cobro, aparece acá.</div>
        ) : (
          <DSTable T={T} rows={failed} rowKey={s => s.id} dense minWidth={620} style={{ border:"none", borderRadius:0, boxShadow:"none", borderTop:`1px solid ${T.border}` }} columns={[
            { key:"cliente", label:"Cliente", render: s => <CellStack T={T} main={s.customer_name || s.customer_email} sub={s.customer_name ? s.customer_email : ""}/> },
            { key:"plan", label:"Plan", hideMobile:true, render: s => <span style={{ color:T.textMd }}>{s.plan_snapshot?.product_title || "—"}</span> },
            { key:"desde", label:"Falló", nowrap:true, render: s => failedAt(s) ? <CellStack T={T} main={fmtDateOnly(failedAt(s))} sub={fmtAgo(failedAt(s))}/> : <span style={{ color:T.textSm }}>—</span> },
            { key:"monto", label:"Monto", align:"right", nowrap:true, render: s => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(s.plan_snapshot?.total_per_charge_ars || s.plan_snapshot?.subscription_price_ars)}</span> },
            { key:"acc", label:"", align:"right", nowrap:true, render: s => (
              <div style={{ display:"inline-flex", gap:6 }}>
                <Btn T={T} variant="secondary" size="sm" disabled={!portalUrl(s)} onClick={() => copyText(portalUrl(s), "Link del portal copiado")} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>🔗 Link del portal</Btn>
                <Btn T={T} variant="secondary" size="sm" disabled={busy === s.id} onClick={() => run(s, "sync")} title="Sincronizar con Mercado Pago" style={{ padding:"4px 9px", fontSize:DS.font.xs }}>{busy === s.id ? <Spinner size={10} color={T.textMd}/> : "⟳"}</Btn>
              </div>) },
          ]}/>
        )}
      </Panel>

      <Panel T={T} title="Cómo funciona" sub="Qué pasa cuando Mercado Pago no puede cobrar una renovación.">
        <ol style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:12 }}>
          {steps.map((s, i) => (
            <li key={i} style={{ display:"flex", gap:10, fontSize:DS.font.md, color:T.textMd, lineHeight:1.55 }}>
              <span aria-hidden="true" style={{ width:20, height:20, borderRadius:99, background:T.accentSolid + "22", color:T.accent, fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>{i + 1}</span>
              <span style={{ minWidth:0 }}>{s}</span>
            </li>
          ))}
        </ol>
        <Callout T={T} tone="info" style={{ marginTop:14 }} right={<Btn T={T} variant="secondary" size="sm" onClick={() => goTab?.("flujos")}>Ir a Flujos de email</Btn>}>Armá recordatorios automáticos con tu marca desde Flujos de email.</Callout>
      </Panel>
    </div>
  );
}

// ─── (c) Checkouts sin pagar ───────────────────────────────────────
function UnpaidSection({ T, merchant, profile, count, loading, goTab }) {
  const whenPaid = profile.caps.orders ? `la orden entra a ${profile.channelInfo.label}` : "el cobro queda registrado";
  const openUnpaid = () => { goTab?.("carritos"); };
  return (
    <Panel T={T} title="Checkouts sin pagar" sub="Clientes que iniciaron la suscripción y no terminaron el pago en Mercado Pago."
      right={<Btn T={T} variant="secondary" size="sm" onClick={openUnpaid}>Ver la lista en Suscripciones →</Btn>}>
      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,220px) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        <div style={{ border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 16px", background:T.bg }}>
          <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>Sin pagar · 30 días</div>
          <div style={{ fontSize:28, fontWeight:800, color: count ? T.yellow : T.text, letterSpacing:-1, fontVariantNumeric:"tabular-nums" }}>{loading && count == null ? "…" : count == null ? "—" : fmtN(count)}</div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:4 }}>{count ? "para recuperar" : "nada pendiente"}</div>
        </div>
        <Callout T={T} tone="info" title="Recuperalos con un flujo de email"
          right={<Btn T={T} variant="solid" size="sm" onClick={() => goTab?.("flujos")}>Ir a Flujos de email</Btn>}>
          Activá el flujo <strong style={{ color:T.text }}>Checkout sin pagar</strong>: le mandamos al cliente mails con el link para retomar su suscripción justo donde la dejó. Cuando paga, {whenPaid} y el flujo se corta solo.
        </Callout>
      </div>
    </Panel>
  );
}
