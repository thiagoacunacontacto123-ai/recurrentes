import React, { useState } from "react";
import { DS } from "../ui/theme.js";
import { Btn, Field, InputStyle, Hint, Spinner, Callout } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { FLOW_VARIABLES } from "../../shared/platform/flows.js";
import { WA_LANGS, WA_DEFAULT_LANG, WA_TEMPLATE_BY_NAME, templateVarCount, renderTemplateBody } from "../../shared/platform/whatsapp.js";

// ─── Paso de WhatsApp del editor de flujos (Flows.jsx) ───────────────
// Plantilla aprobada en Meta + idioma + qué dato del cliente va en cada {{n}}.
// El motor (api/_lib/whatsapp.js) solo la manda si hay WhatsApp conectado, el
// cliente tiene teléfono y no respondió BAJA.
const F = "'Inter',system-ui,sans-serif";
const MONO = "ui-monospace,Menlo,monospace";
export const WA_GREEN = "#25D366";

export function WaStepCard({ T, step, no, first, last, open, onToggle, onChange, onMove, onRemove, templates, connected, platform, testing, onTest }) {
  const iS = InputStyle(T);
  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6 };
  const ctrl = (disabled) => ({ width:26, height:26, borderRadius:7, border:`1px solid ${T.border}`, background:"transparent", color:T.textSm, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.35 : 1, fontSize:11, fontFamily:F, padding:0 });
  const chip = { fontSize:11, padding:"3px 9px", borderRadius:99, border:`1px dashed ${T.border}`, background:"transparent", color:T.textSm, cursor:"pointer", fontFamily:F };
  const vars = step.vars || {};
  const approved = (templates || []).filter(t => t.status === "APPROVED" && !t.unsupported);
  const current = approved.find(t => t.name === step.template && t.language === step.lang) || null;
  const known = WA_TEMPLATE_BY_NAME[step.template];
  const bodyCount = current ? current.var_count : known ? templateVarCount(known.body) : 0;
  const maxVar = Object.keys(vars).filter(k => /^\d{1,2}$/.test(k)).reduce((a, k) => Math.max(a, Number(k)), 0);
  const count = Math.max(maxVar, bodyCount);
  const fixedCount = Boolean(current || known);
  const [manual, setManual] = useState(() => !current);
  const fill = (n, patch = {}) => { const v = {}; for (let i = 1; i <= n; i++) v[String(i)] = patch[String(i)] ?? vars[String(i)] ?? ""; return v; };
  const pick = (val) => {
    if (val === "__other") { setManual(true); return; }
    setManual(false);
    const [name, language] = val.split("|");
    const t = approved.find(x => x.name === name && x.language === language);
    const k = WA_TEMPLATE_BY_NAME[name];
    const v = {};
    for (let i = 1; i <= (t?.var_count || 0); i++) v[String(i)] = k?.vars?.[String(i)] || "";
    onChange({ template: name, lang: language, vars: v });
  };
  const notApproved = connected && Array.isArray(templates) && step.template && !approved.some(t => t.name === step.template);
  return (
    <div style={{ border:`1px solid ${open ? WA_GREEN + "88" : T.border}`, borderRadius:12, marginBottom:6, background:T.surface, overflow:"hidden" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 12px", cursor:"pointer" }} onClick={onToggle}>
        <span style={{ ...label, flexShrink:0 }}>WhatsApp {no}</span>
        <span style={{ flex:1, minWidth:0, fontSize:DS.font.md, fontWeight:700, color: step.template ? T.text : T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", fontFamily: step.template ? MONO : F }}>{step.template || "(elegí una plantilla)"}</span>
        <span style={{ display:"flex", gap:4 }} onClick={e => e.stopPropagation()}>
          <button type="button" style={ctrl(first)} disabled={first} onClick={() => onMove(-1)} aria-label="Subir paso">▲</button>
          <button type="button" style={ctrl(last)} disabled={last} onClick={() => onMove(1)} aria-label="Bajar paso">▼</button>
          <button type="button" style={ctrl(false)} onClick={onRemove} aria-label="Quitar WhatsApp">✕</button>
        </span>
      </div>
      {open && (
        <div style={{ padding:"2px 12px 12px", borderTop:`1px solid ${T.borderL}` }}>
          {!connected && <Callout T={T} tone="warning" style={{ margin:"10px 0" }}>Los avisos por WhatsApp están apagados: este paso se saltea. <a href="#/config/integraciones" style={{ color:T.accent, fontWeight:700 }}>Prendelos en Integraciones → WhatsApp</a>.</Callout>}
          {connected && platform && <Hint T={T} style={{ margin:"10px 0" }}>Sale desde el número de Recurrentes, a nombre de tu tienda. Las plantillas son fijas: los datos de cada {"{{n}}"} los completa Recurrentes.</Hint>}
          {connected && templates === null && <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:DS.font.sm, color:T.textSm, margin:"10px 0" }}><Spinner size={11} color={T.textMd}/> Cargando tus plantillas de WhatsApp…</div>}
          {approved.length > 0 && (
            <Field T={T} label="Plantilla aprobada">
              <select value={current && !manual ? `${current.name}|${current.language}` : "__other"} onChange={e => pick(e.target.value)} style={iS}>
                {approved.map(t => <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>{t.name} · {t.language}{t.category === "MARKETING" ? " · marketing" : ""}</option>)}
                <option value="__other">Otra (escribir el nombre)</option>
              </select>
            </Field>
          )}
          {(manual || !approved.length) && (
            <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.4fr) minmax(0,1fr)", gap:"0 10px" }}>
              <Field T={T} label="Nombre de la plantilla en Meta">
                <input value={step.template} onChange={e => onChange({ template: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} maxLength={512} placeholder="aviso_proximo_cobro" style={{ ...iS, fontFamily:MONO }}/>
              </Field>
              <Field T={T} label="Idioma">
                <select value={step.lang || WA_DEFAULT_LANG} onChange={e => onChange({ lang: e.target.value })} style={iS}>
                  {WA_LANGS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </Field>
            </div>
          )}
          {notApproved && <Hint T={T} style={{ color:T.yellow }}>Esta plantilla no figura aprobada en tu cuenta de WhatsApp: hasta que Meta la apruebe, el envío falla. El texto sugerido está en Integraciones → WhatsApp.</Hint>}
          <div style={{ ...label, margin:"4px 0 6px" }}>Qué dato va en cada variable</div>
          {count === 0 && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginBottom:8 }}>Esta plantilla no tiene variables.</div>}
          {Array.from({ length: count }, (_, i) => String(i + 1)).map(n => (
            <div key={n} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <code style={{ width:44, flexShrink:0, fontSize:DS.font.sm, color:T.textMd, fontFamily:MONO }}>{`{{${n}}}`}</code>
              <select value={vars[n] || ""} onChange={e => onChange({ vars: fill(count, { [n]: e.target.value }) })} aria-label={`Dato para {{${n}}}`} style={{ ...iS, padding:"6px 8px", ...(vars[n] ? {} : { borderColor: T.yellow + "99" }) }}>
                <option value="">Elegí un dato…</option>
                {FLOW_VARIABLES.map(v => <option key={v.key} value={v.key}>{v.label} (ej: {v.sample})</option>)}
              </select>
            </div>
          ))}
          {!fixedCount && (
            <div style={{ display:"flex", gap:6, margin:"2px 0 10px" }}>
              <button type="button" onClick={() => onChange({ vars: fill(Math.min(10, count + 1)) })} style={chip}>+ Variable</button>
              {count > 0 && <button type="button" onClick={() => onChange({ vars: fill(count - 1) })} style={chip}>− Quitar la última</button>}
            </div>
          )}
          <Hint T={T} style={{ marginTop:4 }}>Solo se manda a clientes con teléfono cargado que no respondieron BAJA. Meta cobra cada plantilla entregada.</Hint>
          {connected && <Btn T={T} variant="secondary" size="sm" onClick={onTest} disabled={testing}>{testing ? <><Spinner size={11} color={T.textMd}/> Enviando…</> : "Enviarme una prueba"}</Btn>}
        </div>
      )}
    </div>
  );
}

// Cómo le llega el WhatsApp al cliente (texto de la plantilla con datos de ejemplo).
export function WhatsAppPreview({ T, merchant, step, templates }) {
  const brand = merchant?.email_brand_effective || merchant?.email_brand || merchant?.store_name || "Tu marca";
  const list = Array.isArray(templates) ? templates : [];
  const tpl = list.find(x => x.name === step.template && x.language === step.lang) || list.find(x => x.name === step.template) || null;
  const known = WA_TEMPLATE_BY_NAME[step.template];
  const body = tpl?.body || known?.body || "";
  const footer = tpl ? tpl.footer : (known?.footer || "");
  const sample = { ...Object.fromEntries(FLOW_VARIABLES.map(v => [v.key, v.sample])), marca: brand };
  const text = body ? renderTemplateBody(body, step.vars || {}, sample) : "";
  return (
    <Panel T={T} title="Vista previa" sub={<>WhatsApp a <strong style={{ color:T.textMd }}>+54 9 11 ••••-7974</strong> · con datos de ejemplo</>}>
      <div style={{ background:"#efeae2", borderRadius:10, padding:"14px 12px" }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#54656f", marginBottom:8, textAlign:"center", fontFamily:F }}>{merchant?.whatsapp_verified_name || brand}</div>
        {text ? (
          <div style={{ background:"#fff", borderRadius:"0 10px 10px 10px", padding:"8px 10px 6px", maxWidth:"94%", boxShadow:"0 1px 0.5px rgba(0,0,0,0.13)", fontSize:13, lineHeight:1.45, color:"#111b21", whiteSpace:"pre-line", overflowWrap:"anywhere", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>
            {text}
            {footer && <div style={{ fontSize:11.5, color:"#667781", marginTop:6 }}>{footer}</div>}
            <div style={{ textAlign:"right", fontSize:10, color:"#667781", marginTop:2 }}>9:41</div>
          </div>
        ) : (
          <div style={{ fontSize:12.5, color:"#54656f", textAlign:"center", padding:"12px 6px", fontFamily:F }}>
            {step.template ? "No tenemos el texto de esta plantilla: se completa con estos datos." : "Elegí una plantilla para ver cómo le llega."}
            {step.template && Object.keys(step.vars || {}).length > 0 && (
              <div style={{ marginTop:8, textAlign:"left", display:"inline-block" }}>
                {Object.entries(step.vars).map(([n, k]) => <div key={n}>{`{{${n}}}`} → {FLOW_VARIABLES.find(v => v.key === k)?.sample || "(sin elegir)"}</div>)}
              </div>
            )}
          </div>
        )}
      </div>
      {!tpl && known && (
        <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginTop:10 }}>
          Es la plantilla que sugiere Recurrentes. Tiene que estar <strong style={{ color:T.textMd }}>aprobada en Meta</strong> con este mismo texto: lo copiás desde Integraciones → WhatsApp.
        </div>
      )}
    </Panel>
  );
}
