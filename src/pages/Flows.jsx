import React, { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, DSToggle, Spinner, PageHeader, Callout, Field, InputStyle, Hint, Loading, appConfirm, toast } from "../ui/components.jsx";
import { KpiCard, Panel } from "../ui/charts.jsx";
import { RowMenu } from "./_shared.jsx";
import { FLOW_TRIGGERS, TRIGGER_BY_ID, FLOW_VARIABLES, CTA_OPTIONS, WAIT_UNIT_LABEL, FLOW_MAX_STEPS, defaultFlow, sanitizeFlow, flowSummary, fmtWait, renderVars, newStepId } from "../../shared/platform/flows.js";
// Paso "whatsapp" (plantillas aprobadas de la Cloud API de Meta): solo si la tienda lo conectó.
import { WA_FLOW_SUGGESTION, defaultWhatsappFlow } from "../../shared/platform/flows.js";
import { WA_DEFAULT_LANG, WA_TEMPLATES } from "../../shared/platform/whatsapp.js";
import { appPrompt } from "../ui/components.jsx";
import { WaStepCard, WhatsAppPreview, WA_GREEN } from "./FlowsWhatsApp.jsx";

// ─── Flujos de email ───────────────────────────────────────────────
// Lista (métricas + activar/pausar) y editor en línea de tiempo (esperar / mail),
// con vista previa del mail y "Enviarme una prueba". El motor: api/_lib/flows.js.
const F = "'Inter',system-ui,sans-serif";
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
const total = (flows, k) => flows.reduce((a, f) => a + (Number(f.stats?.[k]) || 0), 0);
const RECOMMENDED = ["checkout_started", "payment_failed", "upcoming_charge", "cancelled"];

// Pide el mail de atención al cliente de la tienda (se guarda como email_reply_to).
function SupportEmailCallout({ T, merchant, onSaved }) {
  const [v, setV] = useState(merchant?.shop_email || merchant?.email || "");
  const [saving, setSaving] = useState(false);
  async function save() {
    const email = v.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("Poné un mail válido", "error");
    setSaving(true);
    const r = await apiPatch("merchant", { email_reply_to: email }, { action: "save-settings" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (r?.error) return toast("No se pudo guardar: " + r.error, "error", 6000);
    toast("Listo: aparece al pie de cada mail", "success");
    onSaved(email);
  }
  return (
    <Callout T={T} tone="warning" title="¿A qué mail te escriben tus clientes?" style={{ marginBottom:16 }}>
      <div style={{ fontSize:DS.font.sm, lineHeight:1.5, marginBottom:10 }}>Los mails salen de una dirección automática que no recibe respuestas. Al pie de cada mail mostramos el mail de atención al cliente de tu tienda para que te escriban ahí. Lo necesitás para activar un flujo.</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <input type="email" value={v} onChange={e => setV(e.target.value)} placeholder="atencion@mitienda.com" aria-label="Mail de atención al cliente" style={{ ...InputStyle(T), flex:"1 1 240px", maxWidth:360 }} onKeyDown={e => { if (e.key === "Enter") save(); }}/>
        <Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Btn>
      </div>
    </Callout>
  );
}

export function FlowsPage({ merchant }) {
  const T = useT();
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState(null);   // flujo (nuevo o existente) abierto en el editor
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(null);
  // Mail de atención al cliente (email_reply_to): va al pie de cada mail. Sin él no se activan flujos.
  const [support, setSupport] = useState(merchant?.email_reply_to || "");
  const needSupport = !String(support || "").trim();

  async function load() {
    setLoading(true);
    const d = await apiGet("merchant", { action: "flows" }).catch(e => ({ error: e.message }));
    if (d?.error) setErr(d.error); else { setFlows(d.flows || []); setErr(""); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggle(f) {
    if (!f.active && needSupport) return toast("Antes de activar, cargá el mail de atención al cliente (el recuadro de arriba).", "warning", 6000);
    setBusy(f.id);
    const d = await apiPost("merchant", { flow: { ...f, active: !f.active } }, { action: "flow-save" });
    setBusy(null);
    if (d?.error) return toast(`No se pudo ${f.active ? "pausar" : "activar"}: ${d.error}`, "error", 6000);
    toast(f.active ? "Flujo pausado" : "Flujo activado: empieza a mandar mails", f.active ? "warning" : "success");
    setFlows(fs => fs.map(x => x.id === f.id ? { ...d.flow, running: f.active ? 0 : x.running } : x));
  }
  async function remove(f) {
    const ok = await appConfirm(`Se borra "${f.name}".${f.running ? ` Las ${f.running} personas que están en curso dejan de recibir sus mails.` : ""}`, { title: "¿Borrar el flujo?", danger: true, okLabel: "Borrar" });
    if (!ok) return;
    const d = await apiPost("merchant", { id: f.id }, { action: "flow-delete" });
    if (d?.error) return toast("Error: " + d.error, "error");
    toast("Flujo borrado", "warning");
    load();
  }

  if (editing) return <FlowEditor T={T} merchant={merchant} initial={editing} onBack={() => { setEditing(null); load(); }}/>;

  const active = flows.filter(f => f.active).length;
  const used = new Set(flows.map(f => f.trigger));
  const ideas = FLOW_TRIGGERS.filter(t => !used.has(t.id));
  // WhatsApp: sugerencia lista solo si la tienda tiene quién mande (número propio o de Recurrentes).
  const waOn = Boolean(merchant?.whatsapp_connected || merchant?.whatsapp_sender);
  const hasWaFlow = flows.some(f => (f.steps || []).some(s => s.type === "whatsapp"));

  return (
    <div>
      <PageHeader T={T} title="Flujos de email" subtitle="Mails que salen solos según lo que hace cada cliente: checkout sin pagar, bienvenida, aviso de cobro, pago rechazado, bajas y más."
        right={<>
          <Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>
          <Btn T={T} variant="solid" onClick={() => setPicking(true)}>+ Nuevo flujo</Btn>
        </>}/>

      {needSupport && <SupportEmailCallout T={T} merchant={merchant} onSaved={setSupport}/>}

      {err && !loading && <Callout T={T} tone="danger" title="No pudimos cargar los flujos" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={load}>Reintentar</Btn>}>{err}</Callout>}

      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap:10, marginBottom:12 }}>
        <KpiCard T={T} loading={loading && !flows.length} label="Flujos activos" value={`${active} de ${flows.length}`} color={T.accentSolid} hint={active ? "mandando mails" : "ninguno activo todavía"}/>
        <KpiCard T={T} loading={loading && !flows.length} label="Mails enviados" value={fmtN(total(flows, "sent"))} color={T.blue} hint="por todos tus flujos"/>
        <KpiCard T={T} loading={loading && !flows.length} label="En curso" value={fmtN(flows.reduce((a, f) => a + (Number(f.running) || 0), 0))} color={T.yellow} hint="esperando su próximo mail"/>
        <KpiCard T={T} loading={loading && !flows.length} label="Recuperados" value={fmtN(total(flows, "converted"))} valueColor={total(flows, "converted") ? T.green : T.text} color={T.green} hint="pagaron o actualizaron la tarjeta"/>
      </div>
      <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginBottom:16 }}>
        Aparte de estos flujos, Recurrentes sigue mandando los mails automáticos de <strong style={{ color:T.textMd }}>activación</strong>, <strong style={{ color:T.textMd }}>pago rechazado</strong> y <strong style={{ color:T.textMd }}>cancelación</strong>. Cada mail de un flujo trae el link para darse de baja.
      </div>
      {!waOn && (
        <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, margin:"-8px 0 16px" }}>
          ¿Querés avisar también por WhatsApp? <a href="#/config/integraciones" style={{ color:T.accent, fontWeight:700, textDecoration:"none" }}>Prendé los avisos en Integraciones → WhatsApp →</a>
        </div>
      )}

      {loading && !flows.length ? <Loading T={T}/> : flows.length === 0 ? (
        <Panel T={T} title="Empezá con uno de estos" sub="Vienen con los mails escritos: los revisás, los ajustás a tu marca y los activás.">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 230px), 1fr))", gap:10 }}>
            {RECOMMENDED.map(id => <TriggerCard key={id} T={T} trig={TRIGGER_BY_ID[id]} onPick={() => setEditing(defaultFlow(id))}/>)}
            {waOn && <TriggerCard T={T} trig={WA_FLOW_SUGGESTION} onPick={() => setEditing(defaultWhatsappFlow())}/>}
          </div>
          <button type="button" onClick={() => setPicking(true)} style={{ marginTop:12, background:"none", border:"none", color:T.accent, fontWeight:700, cursor:"pointer", fontFamily:F, fontSize:DS.font.md, padding:0 }}>Ver todos los disparadores →</button>
        </Panel>
      ) : (
        <>
          <Panel T={T} title="Tus flujos" sub="Activá o pausá cada uno. Los números son desde que lo creaste." flush>
            {flows.map(f => {
              const trig = TRIGGER_BY_ID[f.trigger] || {};
              const s = f.stats || {};
              return (
                <div key={f.id} style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 16px", borderTop:`1px solid ${T.borderL}`, flexWrap:"wrap" }}>
                  <div aria-hidden="true" style={{ width:40, height:40, borderRadius:11, background:T.surface, border:`1px solid ${T.borderL}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:19, flexShrink:0 }}>{trig.icon || "✉️"}</div>
                  <div style={{ flex:"1 1 220px", minWidth:0 }}>
                    <div style={{ fontSize:13.5, fontWeight:700, color:T.text, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      <button type="button" onClick={() => setEditing(f)} style={{ background:"none", border:"none", padding:0, color:T.text, font:"inherit", cursor:"pointer", textAlign:"left" }}>{f.name}</button>
                      {f.active
                        ? <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:10, fontWeight:700, color:T.green, background:T.green + "14", borderRadius:99, padding:"2px 8px" }}><span style={{ width:6, height:6, borderRadius:"50%", background:T.green, boxShadow:`0 0 6px ${T.green}` }}/>Activo</span>
                        : <span style={{ fontSize:10, fontWeight:700, color:T.textSm, background:T.textSm + "18", borderRadius:99, padding:"2px 8px" }}>Pausado</span>}
                    </div>
                    <div style={{ fontSize:11.5, color:T.textSm, marginTop:3 }}>{trig.label || f.trigger}{f.trigger === "upcoming_charge" && f.days_before ? ` (${f.days_before} días antes)` : ""} · {flowSummary(f)}</div>
                  </div>
                  <div style={{ display:"flex", gap:16, flexWrap:"wrap" }}>
                    <Stat T={T} v={s.entered} l="Entraron"/>
                    <Stat T={T} v={s.sent} l="Mails"/>
                    {Number(s.wa_sent) > 0 && <Stat T={T} v={s.wa_sent} l="WhatsApp"/>}
                    {trig.goal && <Stat T={T} v={s.converted} l="Recuperados" c={s.converted ? T.green : undefined}/>}
                    <Stat T={T} v={f.running} l="En curso"/>
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginLeft:"auto" }}>
                    {busy === f.id ? <Spinner size={14} color={T.textMd}/> : <DSToggle T={T} active={!!f.active} onToggle={() => toggle(f)}/>}
                    <Btn T={T} variant="secondary" size="sm" onClick={() => setEditing(f)}>Editar</Btn>
                    <RowMenu T={T} label={`Acciones de ${f.name}`} items={[
                      { label:"Duplicar", icon:"⧉", onClick: () => setEditing({ ...f, id: undefined, name: `${f.name} (copia)`, active: false, stats: undefined, running: undefined }) },
                      { label:"Borrar", icon:"🗑", danger:true, onClick: () => remove(f) },
                    ]}/>
                  </div>
                </div>
              );
            })}
          </Panel>
          {ideas.length > 0 && (
            <div style={{ marginTop:16 }}>
              <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.9, color:T.textSm, marginBottom:8 }}>Más ideas</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                {ideas.map(t => (
                  <button key={t.id} type="button" onClick={() => setEditing(defaultFlow(t.id))} title={t.desc}
                    style={{ display:"inline-flex", alignItems:"center", gap:6, height:32, padding:"0 12px", borderRadius:99, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd, cursor:"pointer", fontFamily:F, fontSize:12, fontWeight:600 }}>
                    <span aria-hidden="true">{t.icon}</span>{t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {waOn && !hasWaFlow && (
            <button type="button" onClick={() => setEditing(defaultWhatsappFlow())} title={WA_FLOW_SUGGESTION.desc}
              style={{ marginTop:10, display:"inline-flex", alignItems:"center", gap:6, height:32, padding:"0 12px", borderRadius:99, border:`1px solid ${WA_GREEN}66`, background:WA_GREEN + "12", color:T.text, cursor:"pointer", fontFamily:F, fontSize:12, fontWeight:600 }}>
              <span aria-hidden="true">{WA_FLOW_SUGGESTION.icon}</span>{WA_FLOW_SUGGESTION.label}
            </button>
          )}
        </>
      )}

      {picking && <TriggerPicker T={T} used={used} onClose={() => setPicking(false)} onPick={(id) => { setPicking(false); setEditing(defaultFlow(id)); }}/>}
    </div>
  );
}

const Stat = ({ T, v, l, c }) => (
  <div style={{ textAlign:"right", minWidth:56 }}>
    <div style={{ fontSize:14, fontWeight:800, color:c || T.text, fontVariantNumeric:"tabular-nums" }}>{fmtN(v)}</div>
    <div style={{ fontSize:9.5, color:T.textSm, textTransform:"uppercase", letterSpacing:0.4, fontWeight:700 }}>{l}</div>
  </div>
);

function TriggerCard({ T, trig, onPick, badge }) {
  return (
    <button type="button" onClick={onPick} style={{ textAlign:"left", display:"flex", gap:12, alignItems:"flex-start", padding:"14px", borderRadius:12, border:`1px solid ${T.border}`, background:T.surface, cursor:"pointer", fontFamily:F, color:T.text, width:"100%" }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = T.accentSolid + "88"; }} onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}>
      <span aria-hidden="true" style={{ fontSize:22, lineHeight:1 }}>{trig.icon}</span>
      <span style={{ minWidth:0 }}>
        <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:13.5, fontWeight:800 }}>{trig.label}{badge}</span>
        <span style={{ display:"block", fontSize:11.5, color:T.textSm, marginTop:3, lineHeight:1.45 }}>{trig.desc}</span>
      </span>
    </button>
  );
}

function TriggerPicker({ T, used, onClose, onPick }) {
  useEffect(() => { const k = (e) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return ReactDOM.createPortal(
    <div className="gh-overlay" role="dialog" aria-modal="true" aria-label="Elegí cuándo arranca el flujo" onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)", padding:16, fontFamily:F }}>
      <div onClick={e => e.stopPropagation()} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, width:"100%", maxWidth:720, maxHeight:"90vh", overflowY:"auto", padding:"22px 24px", boxSizing:"border-box" }}>
        <div style={{ display:"flex", justifyContent:"space-between", gap:12, marginBottom:14 }}>
          <div><div style={{ fontSize:16, fontWeight:700, color:T.text }}>¿Cuándo arranca el flujo?</div><div style={{ fontSize:11.5, color:T.textSm, marginTop:3 }}>Elegí el momento. El flujo viene con los mails escritos para que los ajustes.</div></div>
          <button type="button" onClick={onClose} aria-label="Cerrar" style={{ width:30, height:30, borderRadius:8, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd, cursor:"pointer", flexShrink:0 }}>✕</button>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap:10 }}>
          {FLOW_TRIGGERS.map(t => <TriggerCard key={t.id} T={T} trig={t} onPick={() => onPick(t.id)} badge={used.has(t.id) ? <DSBadge T={T} color={T.textSm} size="sm">ya tenés uno</DSBadge> : null}/>)}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Editor ─────────────────────────────────────────────────────────
const clone = (o) => JSON.parse(JSON.stringify(o));
const comparable = (f) => JSON.stringify({ name: f.name, trigger: f.trigger, active: !!f.active, days_before: f.days_before ?? null, steps: f.steps });

function FlowEditor({ T, merchant, initial, onBack }) {
  const iS = InputStyle(T);
  const [draft, setDraft] = useState(() => clone(initial));
  const [saved, setSaved] = useState(() => initial.id ? comparable(initial) : "");
  const dirty = comparable(draft) !== saved;
  const [sel, setSel] = useState(() => (initial.steps || []).find(s => s.type === "email")?.id || null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const focusRef = useRef(null);   // { stepId, field, el } último campo de texto tocado
  const trig = TRIGGER_BY_ID[draft.trigger] || FLOW_TRIGGERS[0];
  const steps = draft.steps || [];
  const selected = steps.find(s => s.id === sel && s.type === "email") || null;
  const emailNo = (id) => steps.filter(s => s.type === "email").findIndex(s => s.id === id) + 1;
  // WhatsApp: pasos y plantillas (de la WABA propia o las de Recurrentes; null = sin cargar).
  const waOn = Boolean(merchant?.whatsapp_connected || merchant?.whatsapp_sender);
  const selWa = steps.find(s => s.id === sel && s.type === "whatsapp") || null;
  const waNo = (id) => steps.filter(s => s.type === "whatsapp").findIndex(s => s.id === id) + 1;
  const [waTpls, setWaTpls] = useState(null);
  useEffect(() => {
    if (!waOn) return;
    let alive = true;
    apiGet("merchant", { action: "whatsapp-templates" })
      .then(d => { if (alive) setWaTpls(Array.isArray(d?.templates) ? d.templates : []); })
      .catch(() => { if (alive) setWaTpls([]); });
    return () => { alive = false; };
  }, [waOn]);

  const upd = (patch) => setDraft(d => ({ ...d, ...patch }));
  const updStep = (id, patch) => setDraft(d => ({ ...d, steps: d.steps.map(s => s.id === id ? { ...s, ...patch } : s) }));
  const move = (i, dir) => setDraft(d => { const n = [...d.steps]; const j = i + dir; if (j < 0 || j >= n.length) return d; [n[i], n[j]] = [n[j], n[i]]; return { ...d, steps: n }; });
  // Si se borra el mail que se estaba editando, pasa al primer mail que quede.
  const removeStep = (id) => {
    const rest = steps.filter(s => s.id !== id);
    setDraft(d => ({ ...d, steps: d.steps.filter(s => s.id !== id) }));
    if (sel === id) setSel(rest.find(s => s.type === "email")?.id || null);
  };
  const addStep = (type, at) => {
    if (steps.length >= FLOW_MAX_STEPS) return toast(`Máximo ${FLOW_MAX_STEPS} pasos por flujo`, "warning");
    if (type === "whatsapp") {
      // Arranca con la plantilla sugerida para este disparador (si hay una).
      const tpl = WA_TEMPLATES.find(t => t.trigger === draft.trigger);
      const w = { id:newStepId(), type:"whatsapp", template: tpl?.name || "", lang: tpl?.lang || WA_DEFAULT_LANG, vars: tpl ? { ...tpl.vars } : {} };
      setDraft(d => { const n = [...d.steps]; n.splice(at, 0, w); return { ...d, steps: n }; });
      setSel(w.id);
      return;
    }
    const s = type === "wait"
      ? { id:newStepId(), type:"wait", amount:1, unit:"days" }
      : { id:newStepId(), type:"email", subject:"", body:"", cta:trig.cta, cta_label: trig.cta === "portal" ? "Ir a mi portal" : "Retomar" };
    setDraft(d => { const n = [...d.steps]; n.splice(at, 0, s); return { ...d, steps: n }; });
    if (type === "email") setSel(s.id);
  };
  const onFocus = (stepId, field) => (e) => { focusRef.current = { stepId, field, el: e.target }; };
  const insertVar = (key) => {
    const f = focusRef.current;
    if (!f || !f.el) return toast("Tocá primero el asunto, el mensaje o el texto del botón", "info");
    const v = `{{${key}}}`;
    const el = f.el;
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? start;
    updStep(f.stepId, { [f.field]: el.value.slice(0, start) + v + el.value.slice(end) });
    requestAnimationFrame(() => { try { el.focus(); el.setSelectionRange(start + v.length, start + v.length); } catch (_) {} });
  };

  async function save() {
    const chk = sanitizeFlow(draft);
    if (chk.error) return toast(chk.error, "warning", 6000);
    setSaving(true);
    const d = await apiPost("merchant", { flow: { ...draft, id: draft.id } }, { action: "flow-save" });
    setSaving(false);
    if (d?.error) return toast("No se pudo guardar: " + d.error, "error", 7000);
    const f = d.flow;
    setDraft(clone(f));
    setSaved(comparable(f));
    toast(draft.id ? "Flujo guardado" : f.active ? "Flujo creado y activo" : "Flujo creado (pausado: activalo cuando quieras)", "success", 5000);
  }
  async function back() {
    if (dirty && !(await appConfirm("Tenés cambios sin guardar en este flujo.", { title:"¿Salir sin guardar?", okLabel:"Salir sin guardar", danger:true }))) return;
    onBack();
  }
  async function test(step) {
    const chk = sanitizeFlow({ trigger: draft.trigger, steps: [step] });
    if (chk.error) return toast(chk.error, "warning");
    setTesting(step.id);
    const d = await apiPost("merchant", { trigger: draft.trigger, step }, { action: "flow-test" });
    setTesting(null);
    if (d?.error) return toast(d.error, "error", 7000);
    toast(`Te mandamos la prueba a ${d.to}`, "success", 6000);
  }
  async function testWa(step) {
    const chk = sanitizeFlow({ trigger: draft.trigger, steps: [step] });
    if (chk.error) return toast(chk.error, "warning", 6000);
    const to = await appPrompt("Te mandamos la plantilla con datos de ejemplo. Tiene que estar aprobada por Meta.", merchant?.owner_whatsapp || "", { title:"¿A qué WhatsApp te mandamos la prueba?", okLabel:"Enviar prueba", placeholder:"11 6411 7974" });
    if (!to) return;
    setTesting(step.id);
    const d = await apiPost("merchant", { template: step.template, lang: step.lang, vars: step.vars, to }, { action: "whatsapp-test" });
    setTesting(null);
    if (d?.error) return toast(d.error, "error", 8000);
    toast(`Te mandamos la prueba a ${d.to}`, "success", 6000);
  }

  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6 };
  const ctrlBtn = (disabled) => ({ width:26, height:26, borderRadius:7, border:`1px solid ${T.border}`, background:"transparent", color:T.textSm, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, fontSize:11, fontFamily:F, padding:0 });
  const AddBar = ({ at }) => (
    <div style={{ display:"flex", gap:6, margin:"2px 0 10px" }}>
      <button type="button" onClick={() => addStep("wait", at)} style={{ fontSize:11, padding:"3px 9px", borderRadius:99, border:`1px dashed ${T.border}`, background:"transparent", color:T.textSm, cursor:"pointer", fontFamily:F }}>+ Esperar</button>
      <button type="button" onClick={() => addStep("email", at)} style={{ fontSize:11, padding:"3px 9px", borderRadius:99, border:`1px dashed ${T.border}`, background:"transparent", color:T.textSm, cursor:"pointer", fontFamily:F }}>+ Mail</button>
      {waOn && <button type="button" onClick={() => addStep("whatsapp", at)} style={{ fontSize:11, padding:"3px 9px", borderRadius:99, border:`1px dashed ${WA_GREEN}88`, background:"transparent", color:T.textSm, cursor:"pointer", fontFamily:F }}>+ WhatsApp</button>}
    </div>
  );
  // useMemo: si Node cambiara de identidad en cada render, React remontaría cada paso
  // y los campos de texto perderían el foco con cada tecla.
  const Node = React.useMemo(() => function FlowNode({ icon, color, last, children }) { return (
    <div style={{ display:"grid", gridTemplateColumns:"30px minmax(0,1fr)", gap:12 }}>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center" }}>
        <div aria-hidden="true" style={{ width:30, height:30, borderRadius:99, background:color + "22", color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:800, flexShrink:0 }}>{icon}</div>
        {!last && <div style={{ width:2, flex:1, background:T.border, minHeight:10 }}/>}
      </div>
      <div style={{ minWidth:0, paddingBottom:4 }}>{children}</div>
    </div>
  ); }, [T]);

  return (
    <div>
      {/* Barra superior */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:18 }}>
        <button type="button" onClick={back} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontFamily:F, fontSize:DS.font.md, fontWeight:600, padding:0 }}>← Flujos</button>
        <input value={draft.name} onChange={e => upd({ name: e.target.value })} aria-label="Nombre del flujo" maxLength={80}
          style={{ flex:"1 1 260px", minWidth:0, fontSize:20, fontWeight:800, color:T.text, background:"transparent", border:`1px solid transparent`, borderRadius:8, padding:"4px 8px", fontFamily:F, letterSpacing:-0.3 }}
          onFocus={e => { e.target.style.borderColor = T.border; }} onBlur={e => { e.target.style.borderColor = "transparent"; }}/>
        <label style={{ display:"inline-flex", alignItems:"center", gap:8, fontSize:DS.font.md, color: draft.active ? T.green : T.textSm, fontWeight:700, cursor:"pointer" }}>
          <DSToggle T={T} active={!!draft.active} onToggle={() => upd({ active: !draft.active })}/>{draft.active ? "Activo" : "Pausado"}
        </label>
        {dirty && <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>}
        <Btn T={T} variant="solid" onClick={save} disabled={saving || (!dirty && !!draft.id)}>{saving ? <><Spinner size={12}/> Guardando…</> : draft.id ? "Guardar" : "Crear flujo"}</Btn>
      </div>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.25fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        {/* Línea de tiempo */}
        <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"18px 18px 8px" }}>
          <Node icon="⚡" color={T.accentSolid}>
            <div style={{ border:`1px solid ${T.accentSolid}55`, background:T.accentSolid + "0d", borderRadius:12, padding:"12px 14px", marginBottom:10 }}>
              <div style={label}>Cuando</div>
              <div style={{ fontSize:14, fontWeight:800, color:T.text, marginTop:2 }}>{trig.icon} {trig.label}</div>
              <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:3, lineHeight:1.45 }}>{trig.desc}</div>
              {trig.days && (
                <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, fontSize:DS.font.md, color:T.textMd }}>
                  <input type="number" min={1} max={14} value={draft.days_before ?? 3} onChange={e => upd({ days_before: e.target.value })} aria-label="Días antes del cobro" style={{ ...iS, width:70, padding:"6px 8px" }}/>
                  días antes de cada cobro
                </div>
              )}
              <div style={{ fontSize:DS.font.sm, color:T.textMd, marginTop:10, lineHeight:1.45 }}><strong style={{ color:T.text }}>Sale del flujo:</strong> {trig.exit} También si se da de baja de los mails.</div>
            </div>
            <AddBar at={0}/>
          </Node>

          {steps.map((s, i) => (
            <Node key={s.id} icon={s.type === "wait" ? "⏱" : s.type === "whatsapp" ? "💬" : "✉"} color={s.type === "wait" ? T.yellow : s.type === "whatsapp" ? WA_GREEN : T.blue}>
              {s.type === "whatsapp" ? (
                <WaStepCard T={T} step={s} no={waNo(s.id)} first={i === 0} last={i === steps.length - 1} open={sel === s.id}
                  onToggle={() => setSel(sel === s.id ? null : s.id)} onChange={(patch) => updStep(s.id, patch)} onMove={(dir) => move(i, dir)} onRemove={() => removeStep(s.id)}
                  templates={waTpls} connected={waOn} platform={merchant?.whatsapp_sender === "platform"} testing={testing === s.id} onTest={() => testWa(s)}/>
              ) : s.type === "wait" ? (
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", border:`1px solid ${T.border}`, borderRadius:12, padding:"10px 12px", marginBottom:6, background:T.surface }}>
                  <span style={{ fontSize:DS.font.md, fontWeight:700, color:T.text }}>Esperar</span>
                  <input type="number" min={1} value={s.amount} onChange={e => updStep(s.id, { amount: e.target.value })} aria-label="Cantidad" style={{ ...iS, width:70, padding:"6px 8px" }}/>
                  <select value={s.unit} onChange={e => updStep(s.id, { unit: e.target.value })} aria-label="Unidad" style={{ ...iS, width:"auto", padding:"6px 8px" }}>
                    {Object.entries(WAIT_UNIT_LABEL).map(([u, [, many]]) => <option key={u} value={u}>{many}</option>)}
                  </select>
                  <span style={{ marginLeft:"auto", display:"flex", gap:4 }}>
                    <button type="button" style={ctrlBtn(i === 0)} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir paso">▲</button>
                    <button type="button" style={ctrlBtn(i === steps.length - 1)} disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Bajar paso">▼</button>
                    <button type="button" style={ctrlBtn(false)} onClick={() => removeStep(s.id)} aria-label="Quitar espera">✕</button>
                  </span>
                </div>
              ) : (
                <div style={{ border:`1px solid ${sel === s.id ? T.blue + "88" : T.border}`, borderRadius:12, marginBottom:6, background:T.surface, overflow:"hidden" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", cursor:"pointer" }} onClick={() => setSel(sel === s.id ? null : s.id)}>
                    <span style={{ ...label, flexShrink:0 }}>Mail {emailNo(s.id)}</span>
                    <span style={{ flex:1, minWidth:0, fontSize:DS.font.md, fontWeight:700, color: s.subject ? T.text : T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.subject || "(sin asunto)"}</span>
                    <span style={{ display:"flex", gap:4 }} onClick={e => e.stopPropagation()}>
                      <button type="button" style={ctrlBtn(i === 0)} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir paso">▲</button>
                      <button type="button" style={ctrlBtn(i === steps.length - 1)} disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="Bajar paso">▼</button>
                      <button type="button" style={ctrlBtn(false)} onClick={() => removeStep(s.id)} aria-label="Quitar mail">✕</button>
                    </span>
                  </div>
                  {sel === s.id && (
                    <div style={{ padding:"2px 12px 12px", borderTop:`1px solid ${T.borderL}` }}>
                      <Field T={T} label="Asunto">
                        <input value={s.subject} onChange={e => updStep(s.id, { subject: e.target.value })} onFocus={onFocus(s.id, "subject")} maxLength={150} placeholder="Ej: ¿Te quedó algo pendiente, {{nombre}}?" style={iS}/>
                      </Field>
                      <Field T={T} label="Mensaje">
                        <textarea value={s.body} onChange={e => updStep(s.id, { body: e.target.value })} onFocus={onFocus(s.id, "body")} rows={6} maxLength={5000} placeholder="Escribí como le hablarías a tu cliente. Dejá una línea en blanco entre párrafos." style={{ ...iS, resize:"vertical", minHeight:120, lineHeight:1.5 }}/>
                      </Field>
                      <div style={{ ...label, margin:"-2px 0 6px" }}>Insertar dato del cliente</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:12 }}>
                        {FLOW_VARIABLES.map(v => (
                          <button key={v.key} type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertVar(v.key)} title={`Se reemplaza por: ${v.sample}`}
                            style={{ fontSize:11, padding:"3px 9px", borderRadius:99, border:`1px solid ${T.border}`, background:T.bg, color:T.textMd, cursor:"pointer", fontFamily:F }}>{v.label}</button>
                        ))}
                      </div>
                      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 10px" }}>
                        <Field T={T} label="Botón">
                          <select value={s.cta} onChange={e => updStep(s.id, { cta: e.target.value })} style={iS}>
                            {CTA_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                          </select>
                        </Field>
                        {s.cta !== "none" && (
                          <Field T={T} label="Texto del botón">
                            <input value={s.cta_label} onChange={e => updStep(s.id, { cta_label: e.target.value })} onFocus={onFocus(s.id, "cta_label")} maxLength={40} style={iS}/>
                          </Field>
                        )}
                      </div>
                      <Hint T={T}>{s.cta === "portal" ? "Abre el portal del cliente con su suscripción (pausar, cambiar dirección, actualizar la tarjeta)." : s.cta === "checkout" ? "Lleva a la página de tu producto o al checkout para retomar o volver a suscribirse." : "El mail va sin botón."}</Hint>
                      <Btn T={T} variant="secondary" size="sm" onClick={() => test(s)} disabled={testing === s.id}>{testing === s.id ? <><Spinner size={11} color={T.textMd}/> Enviando…</> : "Enviarme una prueba"}</Btn>
                    </div>
                  )}
                </div>
              )}
              <AddBar at={i + 1}/>
            </Node>
          ))}

          <Node icon="✓" color={T.textSm} last>
            <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"6px 0 12px" }}>Fin del flujo</div>
          </Node>
        </div>

        {/* Vista previa */}
        <div style={{ position:"sticky", top:80 }}>
          {selWa ? <WhatsAppPreview T={T} merchant={merchant} step={selWa} templates={waTpls}/> : <EmailPreview T={T} merchant={merchant} step={selected}/>}
          <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginTop:10 }}>
            Los cambios aplican a quienes entren al flujo después de guardar. Pausar el flujo corta los mails pendientes.
          </div>
          {!waOn && (steps.some(s => s.type === "whatsapp")
            ? <Callout T={T} tone="warning" title="Los avisos por WhatsApp están apagados" style={{ marginTop:12 }}>Los pasos de WhatsApp de este flujo se saltean hasta que los prendas en <a href="#/config/integraciones" style={{ color:T.accent, fontWeight:700 }}>Integraciones → WhatsApp</a>.</Callout>
            : <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginTop:10 }}>¿Querés sumar avisos por WhatsApp? <a href="#/config/integraciones" style={{ color:T.accent, fontWeight:700, textDecoration:"none" }}>Prendelos en Integraciones → WhatsApp →</a></div>)}
        </div>
      </div>
    </div>
  );
}

// Cómo le llega el mail al cliente (colores fijos de mail, datos de ejemplo).
function EmailPreview({ T, merchant, step }) {
  const brand = merchant?.email_brand_effective || merchant?.email_brand || merchant?.store_name || "Tu marca";
  const accent = /^#[0-9a-f]{3,8}$/i.test(merchant?.widget_color || "") ? merchant.widget_color : "#10b981";
  const vars = { ...Object.fromEntries(FLOW_VARIABLES.map(v => [v.key, v.sample])), marca: brand };
  if (!step) {
    return (
      <Panel T={T} title="Vista previa">
        <div style={{ fontSize:DS.font.md, color:T.textSm, lineHeight:1.5 }}>Tocá un mail del flujo para ver cómo le llega al cliente.</div>
      </Panel>
    );
  }
  const subject = renderVars(step.subject, vars) || "(sin asunto)";
  const paras = renderVars(step.body, vars).split(/\n{2,}/).filter(p => p.trim());
  return (
    <Panel T={T} title="Vista previa" sub={<>Para: <strong style={{ color:T.textMd }}>ana@ejemplo.com</strong> · con datos de ejemplo</>}>
      <div style={{ background:"#f5f7f6", borderRadius:10, padding:14 }}>
        <div style={{ fontSize:12, color:"#374151", marginBottom:10, fontFamily:F }}><strong>Asunto:</strong> {subject}</div>
        <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
          <div style={{ padding:"14px 18px 10px", borderBottom:"1px solid #e5e7eb", fontSize:16, fontWeight:800, color:accent }}>{brand}</div>
          <div style={{ padding:"16px 18px" }}>
            <div style={{ fontSize:16, fontWeight:700, color:"#111827", marginBottom:10 }}>{subject}</div>
            {paras.length ? paras.map((p, i) => <p key={i} style={{ margin:"0 0 10px", fontSize:13, lineHeight:1.6, color:"#374151", whiteSpace:"pre-line", overflowWrap:"anywhere" }}>{p}</p>)
              : <p style={{ margin:0, fontSize:13, color:"#9ca3af" }}>(escribí el mensaje)</p>}
            {step.cta !== "none" && step.cta_label && <span style={{ display:"inline-block", marginTop:8, background:accent, color:"#fff", padding:"9px 18px", borderRadius:10, fontWeight:700, fontSize:13 }}>{renderVars(step.cta_label, vars)}</span>}
          </div>
        </div>
        <div style={{ textAlign:"center", marginTop:10, fontSize:10.5, color:"#9ca3af", fontFamily:F }}>{brand} · <u>No quiero recibir más estos mails</u><br/>Enviado con Recurrentes</div>
      </div>
    </Panel>
  );
}
