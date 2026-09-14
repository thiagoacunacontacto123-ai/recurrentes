import { useState, useEffect, useMemo } from "react";
import { apiGet, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSBadge, DSToggle, Spinner, DSTable, CellStack, PageHeader, CardHeader, Callout, Field, InputStyle, Hint, StatCard, Loading, toast } from "../ui/components.jsx";
import { goConfigSection } from "../lib/onboarding.js";
import { fmtARS, fmtDateOnly, fmtPct, SurfaceBox, copyText, portalUrl } from "./_shared.jsx";
import { fetchAnalytics } from "./Analytics.jsx";
import { performSubAction, StatusBadge } from "./Subscriptions.jsx";

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

// ─── Página: Retención ─────────────────────────────────────────────
export function RetentionPage({ merchant, reloadMerchant, goTab }) {
  const T = useT();
  const [analytics, setAnalytics] = useState(null);
  const [failed, setFailed] = useState([]);
  const [unpaidCount, setUnpaidCount] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
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

  return (
    <div>
      <PageHeader T={T} title="Retención" subtitle="Menos bajas, más pagos recuperados. Acá configurás qué pasa cuando un cliente quiere cancelar, qué hacemos cuando falla un cobro y cómo seguir a los que no terminaron de pagar."
        right={<Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>}/>

      <CancelFlowCard T={T} merchant={merchant} reloadMerchant={reloadMerchant} analytics={analytics} loading={loading}/>
      <FailedPaymentsCard T={T} merchant={merchant} analytics={analytics} failed={failed} loading={loading} reload={load} goTab={goTab}/>
      <UnpaidCard T={T} merchant={merchant} count={unpaidCount} loading={loading} goTab={goTab}/>
    </div>
  );
}

// ─── (a) Cancelación ───────────────────────────────────────────────
function CancelFlowCard({ T, merchant, reloadMerchant, analytics, loading }) {
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
  const topReasons = useMemo(() => [...(a.cancel_reasons || [])].sort((x, y) => (y.count || 0) - (x.count || 0)).slice(0, 3), [a.cancel_reasons]);
  const labelOf = (code) => reasons.find(r => r.code === code)?.label || DEFAULT_REASONS.find(r => r.code === code)?.label || code || "Sin motivo";
  const saved30 = a.saved_30d ?? a.retention?.saved_30d ?? a.retention_saved_30d ?? null;

  return (
    <Card T={T} style={{ marginBottom:DS.sp.lg }}>
      <CardHeader T={T} icon="🛑" title="Cancelación" sub="Antes de dejar cancelar, preguntamos el motivo y ofrecemos alternativas. Es lo que más bajas evita."
        right={<Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>}/>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.3fr) minmax(0,1fr)", gap:DS.sp.xl, alignItems:"start" }}>
        <div>
          <ToggleRow T={T} active={enabled} onToggle={mark(() => setEnabled(!enabled))} title="Preguntar motivo y ofrecer pausa antes de cancelar" desc="El cliente elige un motivo en el portal y ve las alternativas antes del botón final."/>

          <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none" }}>
            <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", color:T.textSm, fontWeight:DS.w.semibold, letterSpacing:0.6, margin:"16px 0 8px" }}>Motivos ({reasons.length}/{MAX_REASONS})</div>
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {reasons.map((r, i) => (
                <div key={r.code + i} style={{ display:"flex", alignItems:"center", gap:6 }}>
                  <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Subir" style={arrowBtn(T, i === 0)}>▲</button>
                    <button onClick={() => move(i, 1)} disabled={i === reasons.length - 1} title="Bajar" style={arrowBtn(T, i === reasons.length - 1)}>▼</button>
                  </div>
                  <input value={r.label} onChange={e => editLabel(i, e.target.value)} maxLength={60} style={{ ...iS, flex:1, padding:"7px 10px", fontSize:DS.font.md }}/>
                  <code style={{ fontSize:DS.font.xs, color:T.textSm, minWidth:90, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.code}>{r.code}</code>
                  <button onClick={() => remove(i)} title="Quitar" style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:15, padding:"2px 6px" }}>✕</button>
                </div>
              ))}
            </div>
            {reasons.length < MAX_REASONS && (
              <div style={{ display:"flex", gap:6, marginTop:8 }}>
                <input value={newLabel} onChange={e => setNewLabel(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }} placeholder="Nuevo motivo (ej. “Me mudo”)" maxLength={60} style={{ ...iS, flex:1, padding:"7px 10px", fontSize:DS.font.md }}/>
                <Btn T={T} variant="secondary" size="sm" onClick={add} disabled={!newLabel.trim()}>+ Agregar</Btn>
              </div>
            )}

            <div style={{ marginTop:18 }}>
              <ToggleRow T={T} active={offerPause} onToggle={mark(() => setOfferPause(!offerPause))} title="Ofrecer pausar en vez de cancelar" desc="Le proponemos saltear los próximos ciclos y seguir después."
                right={offerPause && (
                  <select value={pauseCycles} onChange={e => { setPauseCycles(Number(e.target.value)); setDirty(true); }} style={{ ...iS, width:"auto", padding:"5px 8px", fontSize:DS.font.sm }}>
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
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.md }}>
          <CancelPreview T={T} enabled={enabled} reasons={reasons} offerPause={offerPause} pauseCycles={pauseCycles} discount={Number(discount) || 0} brand={merchant?.email_brand_effective || merchant?.store_name || "Tu marca"} color={merchant?.widget_color || T.accentSolid}/>
          <SurfaceBox T={T} title="Últimos 30 días">
            {loading ? <Loading T={T}/> : (
              <>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:8 }}>
                  <StatCard T={T} label="Canceladas" value={a.cancelled_30d ?? 0} color={T.red}/>
                  <StatCard T={T} label="Salvadas" value={saved30 == null ? "—" : saved30} color={T.green} sub={saved30 == null ? "cuando el portal lo reporte" : "pausaron o aceptaron descuento"}/>
                </div>
                <div style={{ fontSize:DS.font.xs, textTransform:"uppercase", color:T.textSm, fontWeight:DS.w.bold, letterSpacing:0.5, margin:"6px 0 4px" }}>Top motivos</div>
                {topReasons.length === 0 ? <div style={{ fontSize:DS.font.sm, color:T.textSm }}>Sin motivos registrados todavía.</div> : topReasons.map(r => (
                  <div key={r.code} style={{ display:"flex", justifyContent:"space-between", fontSize:DS.font.md, padding:"4px 0", borderTop:`1px solid ${T.borderL}` }}><span>{labelOf(r.code)}</span><strong>{r.count}</strong></div>
                ))}
              </>
            )}
          </SurfaceBox>
        </div>
      </div>
    </Card>
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
    <div style={{ border:`1px solid ${T.border}`, borderRadius:DS.r.xl, overflow:"hidden", background:T.bg }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:T.surface, borderBottom:`1px solid ${T.borderL}` }}>
        <span style={{ fontSize:DS.font.xs, color:T.textSm, fontWeight:DS.w.bold, textTransform:"uppercase", letterSpacing:0.5 }}>Vista previa · portal</span>
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
function FailedPaymentsCard({ T, merchant, analytics, failed, loading, reload, goTab }) {
  const [busy, setBusy] = useState(null);
  const rec = analytics?.recovery || null;
  const klaviyo = Boolean(merchant?.klaviyo_connected);
  const run = (s, action) => performSubAction(s, action, { setBusy: (id) => setBusy(id ? s.id : null), refresh: reload });
  return (
    <Card T={T} style={{ marginBottom:DS.sp.lg }}>
      <CardHeader T={T} icon="💳" title="Pagos fallidos" sub="Qué pasa cuando Mercado Pago no puede cobrar una renovación."/>
      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start", marginBottom:DS.sp.lg }}>
        <SurfaceBox T={T} title="Cómo funciona">
          <ol style={{ margin:0, paddingLeft:18, fontSize:DS.font.md, color:T.textMd, lineHeight:1.6 }}>
            <li><strong style={{ color:T.text }}>Mercado Pago reintenta solo</strong> el cobro varias veces durante los días siguientes (hasta ~4 intentos). No hace falta que hagas nada.</li>
            <li>Al primer rechazo, la suscripción pasa a <StatusBadge status="payment_failed"/> y <strong style={{ color:T.text }}>Recurrentes le manda un mail al cliente</strong> con el link del portal para actualizar la tarjeta.</li>
            <li>{klaviyo ? <>También disparamos el evento <code style={{ color:T.text }}>Subscription Payment Failed</code> en tu Klaviyo (trae <code>portal_url</code>) para que sigas con tu flow.</> : <>Si conectás Klaviyo, además disparamos el evento <code style={{ color:T.text }}>Subscription Payment Failed</code> para que armes tu propio flow (mail + SMS).</>}</li>
            <li>Cuando MP logra cobrar, la suscripción vuelve a activa sola y se crea la orden en Shopify. Si pasan los reintentos sin éxito, MP la cancela.</li>
          </ol>
        </SurfaceBox>
        <div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <StatCard T={T} label="Fallidos 30d" value={loading ? undefined : (rec?.failed_30d ?? failed.length)} color={T.red}/>
            <StatCard T={T} label="Recuperados 30d" value={loading ? undefined : (rec?.recovered_30d ?? "—")} color={T.green} sub={rec?.failed_30d ? fmtPct((rec.recovered_30d / rec.failed_30d) * 100, 0) + " de recupero" : undefined}/>
            <StatCard T={T} label="En pago fallido hoy" value={loading ? undefined : failed.length} color={failed.length ? T.yellow : undefined}/>
          </div>
          {!klaviyo && <Callout T={T} tone="info" style={{ marginTop:12 }} right={<Btn T={T} variant="secondary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Configurar Klaviyo</Btn>}>Con Klaviyo podés mandar recordatorios con tu marca y por SMS.</Callout>}
        </div>
      </div>

      <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", color:T.textSm, fontWeight:DS.w.semibold, letterSpacing:0.6, marginBottom:8 }}>Suscripciones con pago fallido</div>
      {loading ? <Loading T={T}/> : failed.length === 0 ? (
        <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"10px 0" }}>Ninguna. Cuando MP rechace un cobro, aparece acá.</div>
      ) : (
        <DSTable T={T} rows={failed} rowKey={s => s.id} dense minWidth={640} columns={[
          { key:"cliente", label:"Cliente", render: s => <CellStack T={T} main={s.customer_name || s.customer_email} sub={s.customer_name ? s.customer_email : ""}/> },
          { key:"plan", label:"Plan", hideMobile:true, render: s => <span style={{ color:T.textMd }}>{s.plan_snapshot?.product_title || "—"}</span> },
          { key:"monto", label:"Monto", align:"right", nowrap:true, render: s => <span style={{ fontWeight:DS.w.bold }}>{fmtARS(s.plan_snapshot?.total_per_charge_ars || s.plan_snapshot?.subscription_price_ars)}</span> },
          { key:"desde", label:"Falló", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateOnly(s.payment_failed_at || s.updated_at)}</span> },
          { key:"acc", label:"", align:"right", nowrap:true, render: s => (
            <div style={{ display:"inline-flex", gap:6 }}>
              <Btn T={T} variant="secondary" size="sm" disabled={busy === s.id} onClick={() => run(s, "sync")} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>{busy === s.id ? <Spinner size={10} color={T.textMd}/> : "⟳ Sincronizar"}</Btn>
              <Btn T={T} variant="secondary" size="sm" disabled={!portalUrl(s)} onClick={() => copyText(portalUrl(s), "Link del portal copiado")} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>🔗 Link del portal</Btn>
            </div>) },
        ]}/>
      )}
    </Card>
  );
}

// ─── (c) Carritos sin pagar ────────────────────────────────────────
function UnpaidCard({ T, merchant, count, loading, goTab }) {
  const klaviyo = Boolean(merchant?.klaviyo_connected);
  return (
    <Card T={T}>
      <CardHeader T={T} icon="🛒" title="Checkouts sin pagar" sub="Clientes que iniciaron la suscripción y no terminaron el pago en Mercado Pago."
        right={<Btn T={T} variant="secondary" size="sm" onClick={() => { goTab?.("suscripciones"); setTimeout(() => { try { window.location.hash = "#/dashboard/suscripciones?status=unpaid"; } catch (_) {} }, 0); }}>Ver en Suscripciones →</Btn>}/>
      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"200px minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        <StatCard T={T} label="Sin pagar · 30 días" value={loading ? undefined : (count == null ? "—" : count)} color={count ? T.yellow : undefined}/>
        <Callout T={T} tone={klaviyo ? "success" : "info"} title={klaviyo ? "Klaviyo conectado: recibe “Checkout Started”" : "Recuperalos con Klaviyo"}
          right={<Btn T={T} variant={klaviyo ? "secondary" : "solid"} size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>{klaviyo ? "Ver integración" : "Configurar Klaviyo"}</Btn>}>
          Cada checkout de suscripción se manda a Klaviyo como <strong style={{ color:T.text }}>Checkout Started</strong> con el link para retomar. Usalo como disparador de tu flow de carrito abandonado; cuando paga, la orden entra a Shopify y el flow se corta solo.
        </Callout>
      </div>
      {!!count && <div style={{ marginTop:10, fontSize:DS.font.sm, color:T.textSm }}><DSBadge T={T} color={T.yellow} size="sm">{count} sin pagar</DSBadge> en los últimos 30 días.</div>}
    </Card>
  );
}
