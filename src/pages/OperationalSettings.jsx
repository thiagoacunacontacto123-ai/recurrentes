import React from "react";
import { apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, Field, InputStyle, Spinner, CardHeader, Hint, CheckLine, toast } from "../ui/components.jsx";
import { MONO, SurfaceBox } from "./_shared.jsx";

// ─── Configuración → Avanzado ────────────────────────────────────
// Flujo del checkout del widget, ruta de la página de checkout, selector CSS a
// ocultar, códigos de descuento y modo desarrollador. Guarda PARCIAL por card
// con merchant?action=save-settings (solo lo que se manda); los códigos con
// save-discount-codes. Tienda/envíos → StoreSettings.jsx · mails → Portal del cliente.

export const CHECKOUT_PAGE_PATH_DEFAULT = "/pages/suscripcion-form";

export function AdvancedSettingsCard({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const [devMode, setDevMode]   = React.useState(m.dev_mode === true);
  const [hideSel, setHideSel]   = React.useState(m.widget_hide_selector || "");
  const [flow, setFlow]         = React.useState(m.widget_checkout_flow || "redirect");
  const [pagePath, setPagePath] = React.useState(m.widget_checkout_page_path || "");
  const [codes, setCodes]       = React.useState(Array.isArray(m.discount_codes) ? m.discount_codes : []);
  const [busy, setBusy]         = React.useState("");

  React.useEffect(() => {
    setDevMode(m.dev_mode === true); setHideSel(m.widget_hide_selector || ""); setFlow(m.widget_checkout_flow || "redirect"); setPagePath(m.widget_checkout_page_path || "");
    setCodes(Array.isArray(m.discount_codes) ? m.discount_codes : []);
    // eslint-disable-next-line
  }, [merchant]);

  async function save(section, body) {
    setBusy(section);
    const d = await apiPatch("merchant", body, { action: "save-settings" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Guardado", "success");
    onChange?.();
  }
  async function saveCodes() {
    setBusy("codes");
    const d = await apiPatch("merchant", { discount_codes: codes }, { action: "save-discount-codes" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Códigos guardados", "success");
    onChange?.();
  }
  const updCode = (i, k, v) => setCodes(cs => cs.map((c, j) => j === i ? { ...c, [k]: v } : c));
  const inl = { ...iS, padding:"7px 10px", fontSize:DS.font.md, marginBottom:0 };
  const xBtn = (onClick, title="Quitar") => (
    <button type="button" onClick={onClick} title={title} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:14, padding:"4px 6px", fontFamily:"inherit", lineHeight:1 }}
      onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
  );
  const saveBtn = (section, body, label="Guardar") => (
    <Btn T={T} variant="primary" onClick={()=>save(section, body)} disabled={!!busy} style={{ marginTop:4 }}>{busy===section ? <><Spinner size={12} color={T.accent}/> Guardando…</> : label}</Btn>
  );
  const chk = { width:14, height:14, accentColor:T.accentSolid };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      {/* Checkout del widget */}
      <Card T={T}>
        <CardHeader T={T} title="Checkout de suscripción" sub="Cómo pasa el cliente del selector al formulario de suscripción en tu tienda."/>
        <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 14px" }}>
          <Field T={T} label="Flujo del checkout">
            <select value={flow} onChange={e=>setFlow(e.target.value)} style={iS}>
              <option value="redirect">Redirigir a la página de checkout</option>
              <option value="inline">Inline (formulario en el producto)</option>
            </select>
          </Field>
          <Field T={T} label="Ruta de la página de checkout">
            <input value={pagePath} onChange={e=>setPagePath(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder={CHECKOUT_PAGE_PATH_DEFAULT}/>
          </Field>
        </div>
        <Hint T={T}>Vacío = <code style={{ fontFamily:MONO }}>{CHECKOUT_PAGE_PATH_DEFAULT}</code> (la página de tu Shopify donde pegaste el bloque del checkout). Tiene que empezar con <code style={{ fontFamily:MONO }}>/</code>.</Hint>
        <Field T={T} label="Selector CSS a ocultar en modo suscripción">
          <input value={hideSel} onChange={e=>setHideSel(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder=".product-form__buttons, .shopify-payment-button"/>
        </Field>
        <Hint T={T}>Opcional: elementos del tema (botón de compra, Shop Pay) que se esconden cuando el cliente elige Suscripción. Separá varios con coma.</Hint>
        {saveBtn("checkout", { widget_checkout_page_path: pagePath, widget_checkout_flow: flow, widget_hide_selector: hideSel })}
      </Card>

      {/* Códigos de descuento */}
      <Card T={T}>
        <CardHeader T={T} title="Códigos de descuento" sub={<>Se aplican en el checkout de suscripción. "Solo 1er cobro" = las renovaciones van a precio pleno.</>}
          right={<Btn T={T} variant="secondary" size="sm" onClick={()=>setCodes(cs=>[...cs,{code:"",type:"percent",value:10,active:true,recovery_only:false,first_charge_only:false}])} type="button">+ Agregar</Btn>}/>
        {codes.length === 0 && <SurfaceBox T={T} style={{ marginBottom:12 }}><div style={{ fontSize:DS.font.sm, color:T.textSm }}>Todavía no hay códigos. Agregá uno para usarlo en el checkout de suscripción.</div></SurfaceBox>}
        {codes.map((c, i) => (
          <div key={i} style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.md, padding:"6px 8px" }}>
            <input value={c.code} onChange={e=>updCode(i,"code",e.target.value.toUpperCase())} style={{ ...inl, fontFamily:MONO, flex:"1 1 130px" }} placeholder="CODIGO"/>
            <select value={c.type || "percent"} onChange={e=>updCode(i,"type",e.target.value)} style={{ ...inl, flex:"0 1 100px" }}>
              <option value="percent">% off</option>
              <option value="fixed">$ fijo</option>
            </select>
            <input type="number" min="0" value={c.value} onChange={e=>updCode(i,"value",e.target.value)} style={{ ...inl, flex:"0 1 80px" }}/>
            <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.active !== false} onChange={e=>updCode(i,"active",e.target.checked)}/>Activo</label>
            <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.first_charge_only === true} onChange={e=>updCode(i,"first_charge_only",e.target.checked)}/>Solo 1er cobro</label>
            <span style={{ marginLeft:"auto" }}>{xBtn(()=>setCodes(cs=>cs.filter((_,j)=>j!==i)))}</span>
          </div>
        ))}
        <div style={{ marginTop:8 }}>
          <Btn T={T} variant="primary" onClick={saveCodes} disabled={!!busy}>{busy==="codes" ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar códigos"}</Btn>
        </div>
      </Card>

      {/* Dev */}
      <Card T={T}>
        <CardHeader T={T} title="Modo desarrollador" sub="Herramientas de prueba para validar el flujo sin cobrar."/>
        <CheckLine T={T} checked={devMode} onChange={setDevMode} style={{ color:T.text, marginBottom:12 }}>
          Habilitar herramientas de prueba (ej. "Simular próximo cobro": crea una orden Shopify SIMULADA, sin cobro ni mails)
        </CheckLine>
        {saveBtn("dev", { dev_mode: devMode })}
      </Card>
    </div>
  );
}
