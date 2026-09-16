import React from "react";
import { widgetSnippet } from "./WidgetDesigner.jsx";
import { CopyRow } from "./ShopifyConnect.jsx";
import { apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, Field, InputStyle, Spinner, Hint, CheckLine, DSBadge, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { MONO, SurfaceBox } from "./_shared.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";

// ─── Ajustes del checkout y de prueba ────────────────────────────
//   DiscountCodesCard → Configuración → Checkout (junto a los envíos).
//   WidgetThemeCard   → cómo sigue el cliente después de tocar "Suscribirme" en el
//                       widget pegado a mano en Shopify. Provisorio: con la app
//                       nativa de Shopify esto se resuelve solo.
//   DevModeCard       → herramientas de prueba (Avanzado).
// Guardan PARCIAL con merchant?action=save-settings; los códigos con save-discount-codes.

export const CHECKOUT_PAGE_PATH_DEFAULT = "/pages/suscripcion-form";

async function saveSettings(body, okMsg, onChange) {
  const d = await apiPatch("merchant", body, { action: "save-settings" });
  if (d?.error) { toast("Error: " + d.error, "error", 6000); return false; }
  toast(okMsg || "Guardado", "success");
  onChange?.();
  return true;
}

const XBtn = ({ T, onClick, title = "Quitar" }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:14, padding:"4px 6px", fontFamily:"inherit", lineHeight:1 }}
    onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
);
const Dirty = ({ T }) => <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>;

// ── Códigos de descuento ──────────────────────────────────────────
export function DiscountCodesCard({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const [codes, setCodes] = React.useState(Array.isArray(m.discount_codes) ? m.discount_codes : []);
  const [busy, setBusy] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { setCodes(Array.isArray(m.discount_codes) ? m.discount_codes : []); setDirty(false); }, [m.discount_codes]);

  async function save() {
    setBusy(true);
    const d = await apiPatch("merchant", { discount_codes: codes }, { action: "save-discount-codes" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Códigos guardados", "success");
    setDirty(false);
    onChange?.();
  }
  const upd = (i, k, v) => { setCodes(cs => cs.map((c, j) => j === i ? { ...c, [k]: v } : c)); setDirty(true); };
  const inl = { ...iS, padding:"7px 10px", fontSize:DS.font.md, marginBottom:0 };
  const chk = { width:14, height:14, accentColor:T.accentSolid };
  const active = codes.filter(c => c.active !== false && c.code).length;

  return (
    <Panel T={T} title="Códigos de descuento"
      sub={<>El cliente los escribe en el checkout de suscripción. <strong style={{ color:T.textMd }}>Solo 1er cobro</strong>: las renovaciones se cobran a precio pleno.{codes.length ? ` · ${active} activo${active === 1 ? "" : "s"}` : ""}</>}
      right={<>
        {dirty && <Dirty T={T}/>}
        <Btn T={T} variant="secondary" size="sm" type="button" onClick={() => { setCodes(cs => [...cs, { code:"", type:"percent", value:10, active:true, recovery_only:false, first_charge_only:false }]); setDirty(true); }}>+ Agregar</Btn>
      </>}>
      {codes.length === 0 && <SurfaceBox T={T} style={{ marginBottom:12 }}><div style={{ fontSize:DS.font.sm, color:T.textSm }}>Todavía no hay códigos. Agregá uno (ej. BIENVENIDA10) para usarlo en el checkout de suscripción.</div></SurfaceBox>}
      {codes.map((c, i) => (
        <div key={i} style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6, flexWrap:"wrap", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10, padding:"6px 8px" }}>
          <input value={c.code} onChange={e=>upd(i, "code", e.target.value.toUpperCase())} aria-label="Código" style={{ ...inl, fontFamily:MONO, flex:"1 1 130px", minWidth:0 }} placeholder="CODIGO"/>
          <select value={c.type || "percent"} onChange={e=>upd(i, "type", e.target.value)} aria-label="Tipo de descuento" style={{ ...inl, flex:"0 1 100px" }}>
            <option value="percent">% off</option>
            <option value="fixed">$ fijo</option>
          </select>
          <input type="number" min="0" value={c.value} onChange={e=>upd(i, "value", e.target.value)} aria-label="Valor" style={{ ...inl, flex:"0 1 80px" }}/>
          <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.active !== false} onChange={e=>upd(i, "active", e.target.checked)}/>Activo</label>
          <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.first_charge_only === true} onChange={e=>upd(i, "first_charge_only", e.target.checked)}/>Solo 1er cobro</label>
          <span style={{ marginLeft:"auto" }}><XBtn T={T} onClick={() => { setCodes(cs => cs.filter((_, j) => j !== i)); setDirty(true); }} title={`Quitar ${c.code || "código"}`}/></span>
        </div>
      ))}
      <div style={{ marginTop:8 }}>
        <Btn T={T} variant="primary" onClick={save} disabled={busy || !dirty}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar códigos"}</Btn>
      </div>
    </Panel>
  );
}

// ── Widget en el tema de Shopify (provisorio hasta la app nativa) ──
// bare: sin borde de tarjeta (va adentro de Integraciones → Shopify → Ajustes).
export function WidgetThemeCard({ merchant, onChange, bare = false }) {
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const [flow, setFlow] = React.useState(m.widget_checkout_flow || "redirect");
  const [pagePath, setPagePath] = React.useState(m.widget_checkout_page_path || "");
  const [hideSel, setHideSel] = React.useState(m.widget_hide_selector || "");
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const reset = () => { setFlow(m.widget_checkout_flow || "redirect"); setPagePath(m.widget_checkout_page_path || ""); setHideSel(m.widget_hide_selector || ""); };
  // eslint-disable-next-line
  React.useEffect(reset, [m.widget_checkout_flow, m.widget_checkout_page_path, m.widget_hide_selector]);

  async function save() {
    setBusy(true);
    const ok = await saveSettings({ widget_checkout_flow: flow, widget_checkout_page_path: pagePath.trim(), widget_hide_selector: hideSel.trim() }, "Widget guardado", onChange);
    setBusy(false);
    if (ok) setOpen(false);
  }
  const path = (m.widget_checkout_page_path || "").trim() || CHECKOUT_PAGE_PATH_DEFAULT;
  const savedFlow = m.widget_checkout_flow || "redirect";
  const savedHide = (m.widget_hide_selector || "").trim();
  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"2px 0 8px" };
  const Option = ({ id, title, desc }) => {
    const on = flow === id;
    return (
      <label style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"11px 12px", borderRadius:12, cursor:"pointer", border:`1px solid ${on ? T.accentSolid + "66" : T.border}`, background: on ? T.accentSolid + "0f" : T.surface }}>
        <input type="radio" name="widget-flow" checked={on} onChange={() => setFlow(id)} style={{ accentColor:T.accentSolid, marginTop:2 }}/>
        <span style={{ minWidth:0 }}>
          <span style={{ display:"block", fontSize:DS.font.base, fontWeight:700, color:T.text }}>{title}</span>
          <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.45 }}>{desc}</span>
        </span>
      </label>
    );
  };

  const Wrap = bare ? BareWrap : Panel;
  return (
    <Wrap T={T} title="Widget en tu tema de Shopify"
      sub="Qué pasa después de que el cliente toca Suscribirme. Solo aplica al widget pegado a mano; con la integración nativa de Shopify se va a configurar solo."
      right={!open && <Btn T={T} variant="secondary" size="sm" onClick={() => setOpen(true)}>Cambiar</Btn>}>
      {/* El snippet vive acá (Configuración → Shopify), no en Planes: en Planes
          confundía porque parecía un paso por plan, y es uno solo por tienda. */}
      <div style={{ marginBottom:14 }}>
        <div style={label}>Snippet para tu tema (una sola vez)</div>
        <CopyRow T={T} text={widgetSnippet(m)} label="Copiar"/>
        <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:6, lineHeight:1.5 }}>
          Online Store → Themes → Personalizar → plantilla de producto → bloque <strong style={{ color:T.text }}>Liquid personalizado</strong>. El widget aparece solo en los productos con plan activo. Paso a paso en Configuración → Ayuda.
        </div>
      </div>
      {/* Envíos: el checkout cotiza con el proveedor de envíos de la tienda, así el
          cliente ve los mismos métodos y precios que en una venta normal y la orden le
          llega al carrier con su código. Apagado = envío por defecto del plan. Se
          prende acá y no en Descuentos porque es parte de la conexión con la tienda. */}
      <div style={{ marginBottom:14, padding:"10px 12px", border:`1px solid ${(m.shipping_live_quotes !== false) ? T.accentSolid + "55" : T.border}`, borderRadius:DS.r.lg, background:T.surface, display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:DS.font.md, fontWeight:700, color:T.text }}>Envíos: los mismos que en tu tienda {(m.shipping_live_quotes !== false) && <DSBadge T={T} color={T.accentSolid} size="sm" style={{ marginLeft:6 }}>Activo</DSBadge>}</div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.5 }}>El cliente elige entre los métodos y sucursales de tu proveedor de envíos, al precio del momento, y la orden le llega igual que una venta suelta. <strong style={{ color:T.text }}>Probalo con una suscripción tuya antes de dejarlo prendido.</strong></div>
        </div>
        <Btn T={T} variant={(m.shipping_live_quotes !== false) ? "secondary" : "primary"} size="sm" disabled={busy}
          onClick={async () => { setBusy(true); await saveSettings({ shipping_live_quotes: !(m.shipping_live_quotes !== false) }, (m.shipping_live_quotes !== false) ? "Volvimos al envío por defecto del plan" : "El checkout ya cotiza con tu proveedor de envíos", onChange); setBusy(false); }}>
          {(m.shipping_live_quotes !== false) ? "Desactivar" : "Activar"}
        </Btn>
      </div>
      {!open ? (
        <ul style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:6, fontSize:DS.font.md, color:T.textMd, lineHeight:1.5 }}>
          <li>{savedFlow === "inline" ? "El formulario se abre en la misma página del producto." : <>El formulario se abre en una página aparte de tu tienda: <code style={{ fontFamily:MONO, color:T.text }}>{path}</code></>}</li>
          <li>{savedHide ? <>Además escondemos del tema: <code style={{ fontFamily:MONO, color:T.text }}>{savedHide}</code></> : "Cuando elige Suscripción escondemos el botón de compra normal del tema (lo estándar)."}</li>
        </ul>
      ) : (
        <>
          <div style={label}>¿Dónde completa sus datos el cliente?</div>
          <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:12 }}>
            <Option id="redirect" title="En una página aparte (recomendado)" desc="Va a la página de tu tienda donde pegaste el bloque del checkout."/>
            <Option id="inline" title="En la misma página del producto" desc="El formulario se abre ahí mismo, debajo del selector."/>
          </div>
          {flow === "redirect" && (
            <>
              <Field T={T} label="Dirección de esa página">
                <input value={pagePath} onChange={e => setPagePath(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder={CHECKOUT_PAGE_PATH_DEFAULT}/>
              </Field>
              <Hint T={T}>Lo que va después de tu dominio, empezando con <code style={{ fontFamily:MONO }}>/</code>. Si la dejás vacía usamos <code style={{ fontFamily:MONO }}>{CHECKOUT_PAGE_PATH_DEFAULT}</code>.</Hint>
            </>
          )}
          <Field T={T} label="Botones del tema a esconder (opcional)">
            <input value={hideSel} onChange={e => setHideSel(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder=".product-form__buttons, .shopify-payment-button"/>
          </Field>
          <Hint T={T}>Solo si al elegir Suscripción todavía se ve el botón de compra normal o Shop Pay. Pegá el selector CSS de esos botones (varios separados por coma) o escribinos por WhatsApp y lo vemos con vos.</Hint>
          <div style={{ display:"flex", gap:8, marginTop:6 }}>
            <Btn T={T} variant="primary" onClick={save} disabled={busy}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar"}</Btn>
            <Btn T={T} variant="ghost" onClick={() => { reset(); setOpen(false); }} style={{ color:T.textSm }}>Cancelar</Btn>
          </div>
        </>
      )}
    </Wrap>
  );
}

// Mismo contenido que Panel pero sin tarjeta (título, bajada y acción a la derecha).
function BareWrap({ T, title, sub, right, children }) {
  return (
    <div>
      <div style={{ display:"flex", alignItems:"flex-start", gap:10, marginBottom:10, flexWrap:"wrap" }}>
        <div style={{ flex:"1 1 220px", minWidth:0 }}>
          <div style={{ fontSize:13, fontWeight:800, color:T.text }}>{title}</div>
          {sub && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.45 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

// ── Modo de prueba ─────────────────────────────────────────────────
export function DevModeCard({ merchant, onChange }) {
  const T = useT();
  const m = merchant || {};
  const profile = merchantProfile(m);
  const [devMode, setDevMode] = React.useState(m.dev_mode === true);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { setDevMode(m.dev_mode === true); }, [m.dev_mode]);
  const dirty = devMode !== (m.dev_mode === true);
  async function save() { setBusy(true); await saveSettings({ dev_mode: devMode }, devMode ? "Modo de prueba activado" : "Modo de prueba desactivado", onChange); setBusy(false); }
  return (
    <Panel T={T} title="Modo de prueba" sub="Herramientas para validar el flujo completo sin cobrar." right={dirty && <Dirty T={T}/>}>
      <CheckLine T={T} checked={devMode} onChange={setDevMode} style={{ color:T.text, marginBottom:12 }}>
        Habilitar "Simular próximo cobro" en la ficha de cada suscripción: {profile.caps.orders ? `crea una orden SIMULADA en ${profile.channelInfo.label}` : "registra un cobro SIMULADO"}, sin cobrar ni mandar mails.
      </CheckLine>
      <Btn T={T} variant="primary" onClick={save} disabled={busy || !dirty}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar"}</Btn>
    </Panel>
  );
}

// Configuración → Avanzado: solo el modo de prueba. El widget en el tema vive en
// Integraciones → Shopify → Ajustes (hasta la integración nativa, que lo resuelve sola).
export function AdvancedSettingsCard({ merchant, onChange }) {
  return <DevModeCard merchant={merchant} onChange={onChange}/>;
}
