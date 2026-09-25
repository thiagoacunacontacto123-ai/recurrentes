import React, { useState, useEffect, useMemo, useRef } from "react";
import { apiGet, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, InputStyle, Spinner, Callout, toast } from "../ui/components.jsx";
import { Panel, Segmented } from "../ui/charts.jsx";
import { CHECKOUT_THEME_DEFAULTS, CHECKOUT_FONTS, CHECKOUT_FONT_IDS, resolveCheckoutTheme } from "../../shared/platform/checkoutTheme.js";

// ─── Configuración → Checkout: el diseñador del checkout hosteado ─────────────
// (Thiago, 24-sept-2026: "que cada persona pueda cambiar su checkout: colores, textos,
// letra, si aparecen las políticas, el descuento… todo configurable").
// La vista previa es el checkout REAL en un iframe (#/checkout?preview=1) con el primer
// plan activo; cada cambio se le empuja por postMessage, sin recargar. Se guarda solo lo
// que el comerciante tocó (PATCH save-settings { checkout_theme }); sin personalizar, el
// acento es el color del widget.

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorRow({ T, label, hint, value, fallback, onChange }) {
  const v = HEX.test(value || "") ? value : fallback;
  return (
    <label style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 0", borderBottom:`1px solid ${T.borderL}` }}>
      <input type="color" value={v} onChange={e => onChange(e.target.value)} style={{ width:38, height:32, border:`1px solid ${T.border}`, borderRadius:8, padding:2, background:"transparent", cursor:"pointer", flexShrink:0 }}/>
      <span style={{ flex:1, minWidth:0 }}>
        <span style={{ display:"block", fontSize:DS.font.md, fontWeight:600, color:T.text }}>{label}</span>
        {hint ? <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:1 }}>{hint}</span> : null}
      </span>
      <span style={{ fontFamily:"ui-monospace,Menlo,monospace", fontSize:DS.font.sm, color:T.textSm }}>{v}</span>
    </label>
  );
}
function Toggle({ T, label, hint, on, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.borderL}`, cursor:"pointer" }}>
      <input type="checkbox" checked={!!on} onChange={e => onChange(e.target.checked)} style={{ width:18, height:18, marginTop:1, accentColor:T.accentSolid, flexShrink:0 }}/>
      <span style={{ minWidth:0 }}>
        <span style={{ display:"block", fontSize:DS.font.md, fontWeight:600, color:T.text }}>{label}</span>
        {hint ? <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:1, lineHeight:1.4 }}>{hint}</span> : null}
      </span>
    </label>
  );
}
const Lbl = ({ T, children }) => <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"14px 0 6px" }}>{children}</div>;

export default function CheckoutDesigner({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const saved = (m.checkout_theme && typeof m.checkout_theme === "object") ? m.checkout_theme : {};
  const base = useMemo(() => resolveCheckoutTheme(null, { widgetColor: m.widget_color }), [m.widget_color]);

  // Borrador = defaults resueltos + lo guardado. Se guarda solo lo que difiere del default.
  const [draft, setDraft] = useState(() => ({ ...base, ...saved }));
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState("desktop");
  const [plans, setPlans] = useState(null);
  const frame = useRef(null);
  useEffect(() => { setDraft({ ...base, ...saved }); /* eslint-disable-next-line */ }, [m.id, JSON.stringify(saved), base.color]);
  useEffect(() => { apiGet("plans").then(d => setPlans(d?.plans || [])).catch(() => setPlans([])); }, [m.id]);

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const diff = useMemo(() => {
    const out = {};
    for (const k of Object.keys(CHECKOUT_THEME_DEFAULTS)) if (draft[k] !== undefined && draft[k] !== base[k]) out[k] = draft[k];
    return out;
  }, [draft, base]);
  const dirty = JSON.stringify(diff) !== JSON.stringify(saved);

  const plan = useMemo(() => (plans || []).find(p => p.active !== false) || (plans || [])[0] || null, [plans]);
  const previewUrl = useMemo(() => {
    if (!plan) return "";
    const q = new URLSearchParams({ merchant: m.id, plan: plan.id, preview: "1", theme: JSON.stringify(diff) });
    if (plan.pricing_mode === "packs" || (Array.isArray(plan.packs) && plan.packs.length)) q.set("pack", "0");
    return `${window.location.origin}${window.location.pathname}#/checkout?${q.toString()}`;
    // La URL no cambia con el borrador: los cambios viajan por postMessage (sin recargar).
    // eslint-disable-next-line
  }, [plan, m.id]);
  useEffect(() => {
    try { frame.current?.contentWindow?.postMessage({ type: "rec-checkout-theme", theme: diff }, window.location.origin); } catch (_) {}
  }, [diff]);

  async function save(theme) {
    setSaving(true);
    const d = await apiPatch("merchant", { checkout_theme: theme }, { action: "save-settings" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(Object.keys(theme).length ? "Checkout guardado. Ya lo ven tus clientes." : "Volvió al diseño por defecto.");
    onChange?.();
  }

  const sec = { fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 };
  const fontOpts = CHECKOUT_FONT_IDS.map(id => ({ id, label: CHECKOUT_FONTS[id].label }));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      <Panel T={T} title="Diseño del checkout" sub="Lo que ve tu cliente al suscribirse. Si no tocás nada, sale con el color de tu widget."
        right={<div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Btn T={T} variant="secondary" size="sm" onClick={() => { setDraft({ ...base }); }} disabled={saving || !Object.keys(diff).length}>Volver al default</Btn>
          <Btn T={T} variant="solid" size="sm" onClick={() => save(diff)} disabled={saving || !dirty}>{saving ? <><Spinner size={12}/> Guardando…</> : "Guardar"}</Btn>
        </div>}>
        <div className="rc-ckd" style={{ display:"grid", gridTemplateColumns:"minmax(280px, 380px) minmax(0, 1fr)", gap:DS.sp.xl, padding:"0 16px 16px", alignItems:"start" }}>
          <style>{`@media(max-width:1000px){ .rc-ckd{grid-template-columns:1fr!important;} .rc-ckd-prev{position:static!important;} }`}</style>
          {/* Controles */}
          <div style={{ minWidth:0 }}>
            <div style={sec}>Colores</div>
            <ColorRow T={T} label="Color principal" hint="Botón de pagar, opciones elegidas y el logo que gira al cargar" value={draft.color} fallback={base.color} onChange={v => set("color", v)}/>
            <ColorRow T={T} label="Fondo del formulario" value={draft.bg} fallback={base.bg} onChange={v => set("bg", v)}/>
            <ColorRow T={T} label="Fondo del resumen" hint="La columna gris con el producto y el total" value={draft.summary_bg} fallback={base.summary_bg} onChange={v => set("summary_bg", v)}/>
            <ColorRow T={T} label="Texto" value={draft.text} fallback={base.text} onChange={v => set("text", v)}/>

            <div style={{ ...sec, marginTop:18 }}>Letra y forma</div>
            <Lbl T={T}>Tipografía</Lbl>
            <Segmented T={T} options={fontOpts} value={draft.font} onChange={v => set("font", v)} ariaLabel="Tipografía"/>
            <Lbl T={T}>Bordes redondeados · {draft.radius}px</Lbl>
            <input type="range" min={0} max={24} value={draft.radius} onChange={e => set("radius", Number(e.target.value))} style={{ width:"100%", accentColor:T.accentSolid }}/>

            <div style={{ ...sec, marginTop:18 }}>Textos</div>
            <Lbl T={T}>Arriba de todo</Lbl>
            <input value={draft.header_text} onChange={e => set("header_text", e.target.value)} placeholder={m.store_name || "Nombre de tu tienda"} maxLength={80} style={iS}/>
            <Lbl T={T}>Botón de pagar</Lbl>
            <input value={draft.cta_text} onChange={e => set("cta_text", e.target.value)} placeholder="Suscribirme y pagar {{total}}" maxLength={60} style={iS}/>
            <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:4 }}>{"{{total}}"} se reemplaza por el monto.</div>
            <Lbl T={T}>Debajo del total</Lbl>
            <textarea value={draft.footer_text} onChange={e => set("footer_text", e.target.value)} rows={3} maxLength={300} placeholder="Se cobra $X ahora y se renueva automáticamente. Podés pausar o cancelar cuando quieras." style={{ ...iS, resize:"vertical", lineHeight:1.45 }}/>

            <div style={{ ...sec, marginTop:18 }}>Qué se muestra</div>
            <Toggle T={T} label="Foto de la tienda" hint={m.store_photo ? "La que cargaste en Configuración → Tiendas" : "Cargá una foto en Configuración → Tiendas para verla acá"} on={draft.show_logo} onChange={v => set("show_logo", v)}/>
            <Toggle T={T} label="Código de descuento" hint="La caja para escribir un cupón" on={draft.show_discount} onChange={v => set("show_discount", v)}/>
            <Toggle T={T} label="Renglón de confianza" hint="“Pago seguro con Mercado Pago · Pausás o cancelás cuando quieras”" on={draft.show_trust} onChange={v => set("show_trust", v)}/>
            <Toggle T={T} label="Políticas" hint="Links a tus términos y política de privacidad debajo del botón" on={draft.show_policies} onChange={v => set("show_policies", v)}/>
            {draft.show_policies ? (
              <div style={{ paddingLeft:28 }}>
                <Lbl T={T}>Texto</Lbl>
                <input value={draft.policies_text} onChange={e => set("policies_text", e.target.value)} placeholder="Al pagar aceptás los términos y la política de privacidad." maxLength={200} style={iS}/>
                <Lbl T={T}>Link a términos y condiciones</Lbl>
                <input value={draft.terms_url} onChange={e => set("terms_url", e.target.value)} placeholder="https://tutienda.com/pages/terminos" style={iS}/>
                <Lbl T={T}>Link a política de privacidad</Lbl>
                <input value={draft.privacy_url} onChange={e => set("privacy_url", e.target.value)} placeholder="https://tutienda.com/pages/privacidad" style={iS}/>
              </div>
            ) : null}
            <Lbl T={T}>Resumen en celular</Lbl>
            <Segmented T={T} options={[{ id:"top", label:"Arriba, desplegable" }, { id:"before_pay", label:"Antes del botón" }]} value={draft.summary_mobile} onChange={v => set("summary_mobile", v)} ariaLabel="Resumen en celular"/>
          </div>

          {/* Vista previa */}
          <div className="rc-ckd-prev" style={{ position:"sticky", top:12, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" }}>
              <Segmented T={T} options={[{ id:"desktop", label:"Computadora" }, { id:"mobile", label:"Celular" }]} value={device} onChange={setDevice} ariaLabel="Dispositivo"/>
              <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Vista previa en vivo{plan ? ` · ${plan.product_title || plan.name || "tu plan"}` : ""}. No cobra.</span>
              {previewUrl ? <a href={previewUrl} target="_blank" rel="noopener" style={{ marginLeft:"auto", fontSize:DS.font.sm, color:T.accent, fontWeight:600 }}>Abrir en una pestaña</a> : null}
            </div>
            {plans === null ? <div style={{ padding:40, textAlign:"center", color:T.textSm }}><Spinner size={16}/></div>
              : !plan ? <Callout T={T} tone="info">Creá un plan en Planes para ver el checkout con un producto real.</Callout>
              : (
                <div style={{ display:"flex", justifyContent:"center", background:T.bg, border:`1px solid ${T.border}`, borderRadius:14, padding: device === "mobile" ? "16px 0" : 0, overflow:"hidden" }}>
                  <iframe ref={frame} title="Vista previa del checkout" src={previewUrl}
                    style={{ width: device === "mobile" ? 390 : "100%", maxWidth:"100%", height: device === "mobile" ? 780 : 820, border: device === "mobile" ? `10px solid #111` : "none", borderRadius: device === "mobile" ? 34 : 0, background:"#fff", display:"block" }}/>
                </div>
              )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
