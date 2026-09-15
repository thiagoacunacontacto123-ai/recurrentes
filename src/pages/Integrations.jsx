import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, Field, InputStyle, Spinner, PageHeader, Callout, Hint, CheckLine, appConfirm, toast } from "../ui/components.jsx";
import { BrandIcon } from "../ui/brands.jsx";
import { MpTokenTip } from "./Onboarding.jsx";
import { WidgetThemeCard } from "./OperationalSettings.jsx";
import { MONO, fmtDateShort } from "./_shared.jsx";
import { CHANNELS, PAYMENT_PROVIDERS, merchantProfile } from "../../shared/platform/profile.js";

// ─── Integraciones (Configuración → Integraciones) — estilo Growith ──────
// Una tarjeta con filas agrupadas (Tienda · Pasarelas · Publicidad · Emails):
// logo en cuadro blanco (anillo del color de la marca si está conectado), estado
// en píldora, Conectar / Desvincular y "Ajustes" que despliega el detalle.
// Conectar abre un modal guiado (pasos + campos). Los endpoints no cambian.
// embedded=true: sin PageHeader (Configuración ya pone el título).

const F = "'Inter',system-ui,sans-serif";
const BRAND = { shopify:"#95BF47", tiendanube:"#00a0e3", impultienda:"#111827", link:"#10b981", mercadopago:"#00B1EA", mobbex:"#6f2cf5", stripe:"#635BFF", whop:"#FA4616", meta:"#1877F2", klaviyo:"#232426" };
const SHOPIFY_SCOPES = "read_products,write_orders,read_orders,read_customers,write_customers,write_draft_orders";

// Dominio de Shopify: completa .myshopify.com y detecta si pegaron el dominio propio.
function parseShop(raw) {
  const v = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!v) return { shop:"", ok:false, own:false };
  const shop = v.includes(".") ? v : `${v}.myshopify.com`;
  const ok = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop);
  return { shop, ok, own: !ok && v.includes(".") && !v.endsWith(".myshopify.com"), completed: !v.includes(".") };
}

// ── Piezas ─────────────────────────────────────────────────────────
const Pill = ({ T, c, dot, caps, children }) => (
  <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize: caps ? 9 : 10, fontWeight: caps ? 800 : 700, letterSpacing: caps ? 0.5 : 0, textTransform: caps ? "uppercase" : "none", color:c, background:c + (caps ? "22" : "14"), borderRadius:99, padding:"2px 8px", whiteSpace:"nowrap" }}>
    {dot && <span style={{ width:6, height:6, borderRadius:"50%", background:c, boxShadow:`0 0 6px ${c}` }}/>}{children}
  </span>
);

function btnStyles(T) {
  const base = { fontSize:12, padding:"7px 14px", borderRadius:8, fontWeight:600, cursor:"pointer", fontFamily:F, flexShrink:0, whiteSpace:"nowrap" };
  return {
    solid: { ...base, border:"none", background:T.accentSolid, color:"#fff", fontWeight:700, padding:"7px 16px" },
    red:   { ...base, border:`1px solid ${T.red}44`, background:"transparent", color:T.red },
    ghost: { ...base, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd },
    soft:  { ...base, border:`1px solid ${T.borderL}`, background:T.bg, color:T.textSm, cursor:"not-allowed" },
  };
}

function Row({ T, id, label, sub, connected, soon, required, error, optional, ready, onConnect, onDisconnect, connectLabel = "Conectar", open, onToggle, action, children }) {
  const b = btnStyles(T);
  const brand = BRAND[id] || T.accentSolid;
  return (
    <div style={{ borderBottom:`1px solid ${T.borderL}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 4px", opacity: soon ? 0.75 : 1, flexWrap:"wrap" }}>
        <div style={{ width:42, height:42, borderRadius:11, background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1px solid ${T.borderL}`, boxShadow: connected || ready ? `0 0 0 2px ${brand}33` : "none" }}>
          <BrandIcon name={id} size={26}/>
        </div>
        <div style={{ flex:"1 1 200px", minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:T.text, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            {label}
            {optional && <span style={{ fontSize:11, fontWeight:500, color:T.textSm }}>opcional</span>}
            {connected && <Pill T={T} c={T.green} dot>Conectado</Pill>}
            {ready && <Pill T={T} c={T.green}>Listo</Pill>}
            {error && <Pill T={T} c={T.red}>Con error</Pill>}
            {required && !connected && <Pill T={T} c={T.red}>Necesaria</Pill>}
            {soon && <Pill T={T} c={T.yellow} caps>Próximamente</Pill>}
          </div>
          <div style={{ fontSize:11.5, color:T.textSm, marginTop:3, lineHeight:1.45, overflowWrap:"anywhere" }}>{sub}</div>
        </div>
        <div style={{ display:"flex", gap:8, marginLeft:"auto", flexWrap:"wrap", justifyContent:"flex-end" }}>
          {action}
          {connected && onToggle && <button type="button" style={b.ghost} aria-expanded={!!open} onClick={onToggle}>Ajustes {open ? "▴" : "▾"}</button>}
          {connected
            ? (onDisconnect && <button type="button" style={b.red} onClick={onDisconnect}>Desvincular</button>)
            : soon ? <button type="button" disabled style={b.soft}>Conectar</button>
            : onConnect ? <button type="button" style={b.solid} onClick={onConnect}>{connectLabel}</button> : null}
        </div>
      </div>
      {open && children && (
        <div className="gh-accordion" style={{ margin:"0 4px 14px", padding:"14px 16px", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10 }}>{children}</div>
      )}
    </div>
  );
}

const GroupTitle = ({ T, first, children }) => (
  <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.9, color:T.textSm, margin: first ? "6px 0 2px" : "22px 0 2px" }}>{children}</div>
);

function Modal({ T, title, sub, onClose, busy, children, footer, maxWidth = 560 }) {
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [busy, onClose]);
  return ReactDOM.createPortal(
    <div className="gh-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={() => !busy && onClose()}
      style={{ position:"fixed", inset:0, zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)", WebkitBackdropFilter:"blur(4px)", padding:16, fontFamily:F }}>
      <div onClick={e => e.stopPropagation()} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, width:"100%", maxWidth, maxHeight:"92vh", overflowY:"auto", padding:"22px 24px", boxSizing:"border-box" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:12, marginBottom:16 }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:700, color:T.text }}>{title}</div>
            {sub && <div style={{ fontSize:11.5, color:T.textSm, marginTop:3, lineHeight:1.5 }}>{sub}</div>}
          </div>
          <button type="button" onClick={() => !busy && onClose()} aria-label="Cerrar" style={{ width:30, height:30, borderRadius:8, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd, cursor:"pointer", fontSize:13, flexShrink:0, fontFamily:F }}>✕</button>
        </div>
        {children}
        {footer && <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:18, flexWrap:"wrap" }}>{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

const Steps = ({ T, title, children }) => (
  <div style={{ padding:"12px 14px", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10, marginBottom:16, fontSize:12, color:T.textMd, lineHeight:1.65 }}>
    {title && <div style={{ fontWeight:700, color:T.text, marginBottom:6 }}>{title}</div>}
    <ol style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:7 }}>{children}</ol>
  </div>
);
const CopyCode = ({ T, text }) => (
  <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:5 }}>
    <code style={{ flex:1, minWidth:0, background:T.bg, padding:"6px 8px", borderRadius:5, fontSize:10.5, color:T.accent, wordBreak:"break-all", fontFamily:MONO }}>{text}</code>
    <button type="button" onClick={() => { try { navigator.clipboard.writeText(text); toast("Copiado", "success"); } catch (_) {} }}
      style={{ fontSize:10.5, padding:"5px 9px", borderRadius:6, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd, cursor:"pointer", fontFamily:F, flexShrink:0 }}>Copiar</button>
  </div>
);
const A = ({ T, href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color:T.accent, textDecoration:"underline" }}>{children}</a>;
const S = ({ T, children }) => <strong style={{ color:T.text }}>{children}</strong>;

// ── Mobbex (beta): solo aparece si el servidor tiene MOBBEX_ENABLED=1 (m.mobbex_available).
// Guarda API Key + Access Token (validados contra Mobbex) y el modo prueba. Nunca los muestra.
function MobbexRow({ T, m, profile, onChange, open, onToggle }) {
  const iS = InputStyle(T);
  const b = btnStyles(T);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [test, setTest] = useState(false);
  const ok = Boolean(m.mobbex_connected);
  const inUse = profile.paymentProvider === "mobbex" || m.payment_provider === "mobbex";
  const needKey = !m.mobbex_platform_key;
  const canSave = !!token.trim() && (!needKey || !!apiKey.trim());
  const openModal = () => { setToken(""); setApiKey(""); setTest(Boolean(m.mobbex_test)); setModal(true); };
  const close = () => { if (!busy) setModal(false); };
  async function save() {
    if (!canSave) return toast(needKey ? "Pegá la API Key y el Access Token de Mobbex" : "Pegá tu Access Token de Mobbex", "warning");
    setBusy(true);
    const d = await apiPost("merchant", { access_token: token.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}), test }, { action: "save-mobbex" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    toast(test ? "Mobbex conectado en modo prueba" : "Mobbex conectado", "success");
    setModal(false); onChange?.();
  }
  async function disconnect() {
    const yes = await appConfirm("Borramos tus claves de Mobbex. Las suscripciones que ya cobrás con Mobbex siguen en tu cuenta de Mobbex, pero no vas a poder pausarlas ni cancelarlas desde acá hasta que vuelvas a conectar.", { title:"¿Desvincular Mobbex?", danger:true, okLabel:"Desvincular" });
    if (!yes) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-mobbex" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Mobbex desvinculado", "warning"); onChange?.(); }
  }
  return (
    <>
      <Row T={T} id="mobbex" label={<>Mobbex <Pill T={T} c={T.accent} caps>Beta</Pill></>} optional connected={ok} error={ok && Boolean(m.mobbex_last_error)} open={open} onToggle={onToggle}
        sub={ok ? `${m.mobbex_test ? "Modo prueba · " : ""}${inUse ? "cobra tus suscripciones nuevas" : "conectado · por ahora seguís cobrando con Mercado Pago"}` : "Suscripciones con tarjeta guardada, en pesos. Mobbex cobra solo cada período."}
        onConnect={openModal} onDisconnect={disconnect}>
        <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:12 }}>
          {m.mobbex_test && <>Estás en <S T={T}>modo prueba</S>: los cobros no son reales.<br/></>}
          {inUse ? "Las suscripciones nuevas se cobran con Mobbex." : <>Para cobrar con Mobbex, elegilo como pasarela en <a href="#/config/negocio" style={{ color:T.accent }}>Configuración → Negocio</a>. Mientras tanto seguís cobrando con Mercado Pago.</>}
          {m.mobbex_connected_at ? ` Conectado el ${fmtDateShort(m.mobbex_connected_at)}.` : ""}
        </div>
        {m.mobbex_last_error && (
          <Callout T={T} tone="danger" title="Último error de Mobbex" style={{ marginBottom:12 }}>
            {m.mobbex_last_error}{m.mobbex_last_error_at ? ` · ${fmtDateShort(m.mobbex_last_error_at)}` : ""}
          </Callout>
        )}
        <button type="button" style={b.ghost} onClick={openModal}>Cambiar credenciales</button>
      </Row>
      {modal && (
        <Modal T={T} title={ok ? "Cambiar las credenciales de Mobbex" : "Conectar Mobbex"} busy={busy} onClose={close}
          sub="Es la cuenta de Mobbex que cobra las suscripciones. Cada cobro entra directo ahí."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={save} disabled={busy || !canSave}>{busy ? <><Spinner size={12}/> Validando…</> : "Conectar"}</Btn>
          </>}>
          <Steps T={T} title="Dónde están tus claves">
            <li>Entrá a tu cuenta de Mobbex con el usuario que va a cobrar.</li>
            <li>Buscá las credenciales para integrar por API. Mobbex lo explica en <A T={T} href="https://ayuda.mobbex.com/credenciales-para-integracion-a-traves-de-api">esta guía</A>.</li>
            <li>Copiá {needKey ? <><S T={T}>API Key</S> y <S T={T}>Access Token</S></> : <S T={T}>Access Token</S>} y pegalos acá abajo.</li>
          </Steps>
          {needKey && (
            <Field T={T} label="API Key">
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="Tu API Key de Mobbex" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy}/>
            </Field>
          )}
          <Field T={T} label="Access Token">
            <input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="Tu Access Token de Mobbex" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus={!needKey} disabled={busy}/>
          </Field>
          <CheckLine T={T} checked={test} onChange={v => setTest(v === true)} style={{ color:T.text, marginTop:4 }}>
            Modo prueba: los cobros no son reales (para probar antes de vender)
          </CheckLine>
          <Hint T={T} style={{ marginTop:12 }}>Las validamos contra tu cuenta de Mobbex y nunca las mostramos de vuelta.</Hint>
        </Modal>
      )}
    </>
  );
}

// Resumen del perfil del negocio (se cambia en Configuración → Negocio).
function ProfileStrip({ T, profile }) {
  const sep = <span aria-hidden="true" style={{ color:T.border }}>·</span>;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"10px 14px", marginBottom:12, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10, fontSize:DS.font.md, color:T.textMd }}>
      <span style={{ fontWeight:DS.w.bold, color:T.text }}>Tu negocio:</span>
      <span>{profile.type.emoji} {profile.type.label}</span>{sep}
      <span>{profile.channelInfo.emoji} {profile.channelInfo.label}</span>{sep}
      <span>{profile.providerInfo.emoji} {profile.providerInfo.label}</span>
      <a href="#/config/negocio" style={{ marginLeft:"auto", color:T.accent, fontWeight:DS.w.bold, fontSize:DS.font.sm, textDecoration:"none" }}>Cambiar →</a>
    </div>
  );
}

export function IntegrationsTab({ merchant, onChange, embedded = false }) {
  const T = useT();
  const iS = InputStyle(T);
  const b = btnStyles(T);
  const m = merchant || {};
  const profile = merchantProfile(m);
  const shopifyOk = Boolean(m.shopify_token);
  const mpOk = Boolean(m.mp_access_token);
  const metaOk = Boolean(m.meta_connected);
  const klaviyoOk = Boolean(m.klaviyo_connected);
  // Con app única de Recurrentes (SHOPIFY_API_KEY en env) no hace falta app propia.
  const envApp = Boolean(m.shopify_env_app);

  const [open, setOpen] = useState(null);          // fila con "Ajustes" desplegado
  const [modal, setModal] = useState(null);        // "shopify" | "mp" | "meta" | "klaviyo"
  const [busy, setBusy] = useState("");
  const toggle = (id) => setOpen(o => o === id ? null : id);
  const close = () => { if (!busy) setModal(null); };

  // ── Shopify ──
  const [shopRaw, setShopRaw] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const shopP = parseShop(shopRaw);
  const openShopify = () => { setShopRaw(m.shopify_shop || ""); setClientId(""); setClientSecret(""); setModal("shopify"); };
  async function connectShopify() {
    if (!shopP.ok) return toast("Poné el dominio .myshopify.com de tu tienda", "warning");
    if (!envApp && (!clientId.trim() || !clientSecret.trim())) return toast("Pegá el Client ID y el Client Secret de tu app", "warning");
    setBusy("shopify");
    const d = await apiPost("shopify", { shop: shopP.shop, client_id: clientId.trim(), client_secret: clientSecret.trim() }, { action: "save-creds" });
    if (d?.error) { setBusy(""); return toast("Error: " + d.error, "error", 6000); }
    // oauth-start (autenticado) devuelve la URL de consentimiento de Shopify.
    const o = await apiGet("shopify", { action: "oauth-start" });
    if (!o?.url) { setBusy(""); return toast("Error: " + (o?.error || "no se pudo iniciar la autorización"), "error", 6000); }
    window.location.href = o.url;
  }
  async function disconnectShopify() {
    const ok = await appConfirm("Se borra el acceso a tu tienda. Las suscripciones siguen cobrándose en Mercado Pago, pero no se van a crear órdenes hasta que vuelvas a conectar.", { title:"¿Desvincular Shopify?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-shopify" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Shopify desvinculado", "warning"); setOpen(null); onChange?.(); }
  }

  // ── Mercado Pago ──
  const [mpToken, setMpToken] = useState("");
  const mpTokenOk = /^(APP_USR-|TEST-)/.test(mpToken.trim());
  async function connectMPOauth() {
    setBusy("mp-oauth");
    const d = await apiPost("merchant", {}, { action: "mp-oauth-start" });
    if (d?.url) window.location.href = d.url;
    else { setBusy(""); toast("Error: " + (d?.error || "La conexión automática con Mercado Pago no está disponible"), "error"); }
  }
  async function saveMpToken() {
    if (!mpTokenOk) return toast("El Access Token empieza con APP_USR- (o TEST- para pruebas)", "warning");
    setBusy("mp");
    const d = await apiPatch("merchant", { access_token: mpToken.trim() }, { action: "save-mp-token" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Mercado Pago conectado", "success"); setMpToken(""); setModal(null); onChange?.();
  }
  async function disconnectMP() {
    const ok = await appConfirm("Se borra el token de nuestra base. Las suscripciones siguen cobrándose en Mercado Pago, pero no vamos a poder procesarlas hasta que vuelvas a conectar.", { title:"¿Desvincular Mercado Pago?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-mp" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Mercado Pago desvinculado", "warning"); setOpen(null); onChange?.(); }
  }

  // ── Meta ──
  const [pixel, setPixel] = useState("");
  const [capi, setCapi] = useState("");
  const openMeta = () => { setPixel(m.meta_pixel_id || ""); setCapi(""); setModal("meta"); };
  async function saveMeta() {
    if (!/^\d{6,}$/.test(pixel.trim())) return toast("El Pixel ID son solo números", "warning");
    if (!capi.trim()) return toast("Pegá el token de la API de Conversiones", "warning");
    setBusy("meta");
    const d = await apiPatch("merchant", { meta_pixel_id: pixel.trim(), meta_capi_token: capi.trim() }, { action: "save-meta" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Meta conectado", "success"); setModal(null); onChange?.();
  }
  async function disconnectMeta() {
    const ok = await appConfirm("Las suscripciones nuevas dejan de reportarse a Meta.", { title:"¿Desvincular Meta?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPatch("merchant", { meta_pixel_id: "", meta_capi_token: "" }, { action: "save-meta" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Meta desvinculado", "warning"); setOpen(null); onChange?.(); }
  }

  // ── Klaviyo: recupero de checkouts + eventos de suscripción ──
  const [klaviyoKey, setKlaviyoKey] = useState("");
  async function connectKlaviyo() {
    const key = klaviyoKey.trim();
    if (!key.startsWith("pk_")) return toast("Tiene que ser una Private API Key (empieza con pk_)", "warning");
    setBusy("klaviyo");
    const d = await apiPost("merchant", { api_key: key }, { action: "save-klaviyo" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    setKlaviyoKey(""); setModal(null);
    toast(`Klaviyo conectado${d.klaviyo_org ? ` (${d.klaviyo_org})` : ""}`, "success");
    onChange?.();
  }
  async function testKlaviyo() {
    setBusy("klaviyo-test");
    const d = await apiPost("merchant", {}, { action: "klaviyo-test" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    toast(`Evento "Checkout Started" de prueba enviado a ${d.to}. Buscalo en Klaviyo → Profiles → tu mail (puede tardar 1 min).`, "success", 9000);
  }
  async function disconnectKlaviyo() {
    const ok = await appConfirm("Dejamos de mandar eventos a Klaviyo. Tus flujos y perfiles allá quedan como están.", { title:"¿Desvincular Klaviyo?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-klaviyo" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Klaviyo desvinculado", "warning"); setOpen(null); onChange?.(); }
  }
  async function toggleKlaviyoOrders(v) {
    const d = await apiPatch("merchant", { klaviyo_send_orders: v === true }, { action: "save-settings" });
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(v ? 'Vamos a mandar también "Placed Order" en cada cobro' : '"Placed Order" desactivado (lo manda Shopify)', "success");
    onChange?.();
  }
  const KLAVIYO_EVENTS = [
    ["Checkout Started", "dejó el mail o tocó Pagar · igual que un carrito de Shopify, con CheckoutURL para retomar"],
    ["Subscription Activated", "primer cobro aprobado y orden creada"],
    ["Subscription Renewed", "cada cobro siguiente"],
    ["Subscription Payment Failed", "renovación rechazada (trae portal_url para actualizar la tarjeta)"],
    ["Subscription Paused", "pausó desde el portal o vos desde el panel"],
    ["Subscription Resumed", "reactivó la suscripción"],
    ["Subscription Cancelled", "canceló la suscripción"],
  ];

  // Lo que viene (visible, no elegible).
  const soonChannels = Object.values(CHANNELS).filter(c => c.status !== "available" && c.id !== profile.channel && c.types.includes(profile.businessType));
  const soonProviders = Object.values(PAYMENT_PROVIDERS).filter(p => p.status !== "available");
  const reqTotal = profile.channel === "shopify" ? 2 : 1;
  const reqOk = (profile.channel === "shopify" ? Number(shopifyOk) : 0) + Number(mpOk);
  const code = (t) => <code style={{ fontFamily:MONO, fontSize:DS.font.sm, color:T.text }}>{t}</code>;

  return (
    <div>
      {!embedded && <PageHeader T={T} title="Integraciones" subtitle={profile.channel === "shopify"
        ? "Conectá tu tienda Shopify y tu cuenta de Mercado Pago. Necesitás ambas para crear planes y cobrar suscripciones."
        : `Conectá ${profile.providerInfo.label} para cobrar. Sin tienda online: vendés con links de suscripción.`}/>}

      <ProfileStrip T={T} profile={profile}/>

      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px 8px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", fontSize:11.5, color:T.textSm, lineHeight:1.5 }}>
          <Pill T={T} c={reqOk === reqTotal ? T.green : T.red} dot={reqOk === reqTotal}>{reqOk} de {reqTotal} necesaria{reqTotal === 1 ? "" : "s"}</Pill>
          <span style={{ flex:"1 1 260px" }}>{profile.channel === "shopify" ? `${profile.channelInfo.label} y ${profile.providerInfo.label} son necesarias para cobrar; el resto es opcional.` : `Solo ${profile.providerInfo.label} es necesaria para cobrar; el resto es opcional.`}</span>
          {profile.ready && <a href="#/dashboard/planes" style={{ color:T.accent, fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>Todo listo · Ir a Planes →</a>}
        </div>

        {/* ── Tienda ── */}
        <GroupTitle T={T} first>Tienda</GroupTitle>
        {profile.channel === "shopify" ? (
          <Row T={T} id="shopify" label="Shopify" required connected={shopifyOk} open={open === "shopify"} onToggle={() => toggle("shopify")}
            sub={shopifyOk ? `${m.shopify_shop} · lee tus productos y crea una orden con cada cobro` : "Para leer tus productos y crear una orden en tu tienda con cada cobro."}
            onConnect={openShopify} onDisconnect={disconnectShopify}>
            <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14 }}>
              <span style={{ fontSize:DS.font.md, color:T.textMd }}>Tienda: {code(m.shopify_shop || "—")}</span>
              <button type="button" style={b.ghost} onClick={openShopify}>Reconectar</button>
            </div>
            <div style={{ height:1, background:T.borderL, margin:"0 0 14px" }}/>
            <WidgetThemeCard merchant={m} onChange={onChange} bare/>
          </Row>
        ) : (
          <Row T={T} id="link" label={profile.channelInfo.label} ready
            sub="Vendés con links de suscripción a un checkout de Recurrentes. No hace falta conectar ninguna tienda."
            action={<a href="#/dashboard/planes" style={{ ...b.ghost, textDecoration:"none", display:"inline-block" }}>Ver mis links</a>}/>
        )}
        {soonChannels.map(c => <Row key={c.id} T={T} id={c.id} label={c.label} soon sub={c.desc}/>)}

        {/* ── Pasarelas ── */}
        <GroupTitle T={T}>Pasarelas de pago</GroupTitle>
        <Row T={T} id="mercadopago" label="Mercado Pago" required connected={mpOk} open={open === "mp"} onToggle={() => toggle("mp")}
          sub={mpOk ? `Cuenta ${m.mp_email || "conectada"}${m.mp_method ? ` · ${m.mp_method === "oauth" ? "conectada con OAuth" : "token pegado"}` : ""}` : "La cuenta que cobra las suscripciones y procesa cada renovación."}
          onConnect={() => { setMpToken(""); setModal("mp"); }} onDisconnect={disconnectMP}>
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:12 }}>
            {m.mp_email && <>Cuenta: <S T={T}>{m.mp_email}</S><br/></>}
            Método: {m.mp_method === "oauth" ? "conexión automática (OAuth)" : "Access Token pegado"}{m.mp_connected_at ? ` · desde ${fmtDateShort(m.mp_connected_at)}` : ""}
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {m.mp_oauth_available && <button type="button" style={b.ghost} onClick={connectMPOauth} disabled={busy === "mp-oauth"}>{busy === "mp-oauth" ? "Abriendo…" : "Reconectar con OAuth"}</button>}
            <button type="button" style={b.ghost} onClick={() => { setMpToken(""); setModal("mp"); }}>Cambiar Access Token</button>
          </div>
        </Row>
        {m.mobbex_available && <MobbexRow T={T} m={m} profile={profile} onChange={onChange} open={open === "mobbex"} onToggle={() => toggle("mobbex")}/>}
        {soonProviders.filter(p => !(p.id === "mobbex" && m.mobbex_available)).map(p => <Row key={p.id} T={T} id={p.id} label={p.label} soon sub={p.desc}/>)}

        {/* ── Publicidad ── */}
        <GroupTitle T={T}>Publicidad</GroupTitle>
        <Row T={T} id="meta" label="Meta Ads" optional connected={metaOk} open={open === "meta"} onToggle={() => toggle("meta")}
          sub={metaOk ? `Pixel ${m.meta_pixel_id} · reporta la primera venta de cada suscripción` : "Reportá a Meta la primera venta de cada suscripción para que tus campañas la cuenten."}
          onConnect={openMeta} onDisconnect={disconnectMeta}>
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:12 }}>
            Mandamos a Meta la <S T={T}>primera venta</S> de cada suscripción por la API de Conversiones (del lado del servidor). <S T={T}>Las renovaciones no se reportan</S>, así no inflás la atribución de tus campañas.
          </div>
          <button type="button" style={b.ghost} onClick={openMeta}>Cambiar credenciales</button>
        </Row>

        {/* ── Emails y marketing ── */}
        <GroupTitle T={T}>Emails y marketing</GroupTitle>
        <Row T={T} id="klaviyo" label="Klaviyo" optional connected={klaviyoOk} error={klaviyoOk && Boolean(m.klaviyo_last_error)} open={open === "klaviyo"} onToggle={() => toggle("klaviyo")}
          sub={klaviyoOk ? `${m.klaviyo_org || "Cuenta conectada"} · recibe los checkouts sin pagar y los eventos de cada suscripción` : "Mandá a tu Klaviyo los checkouts sin pagar y cada evento de suscripción para tus flows."}
          onConnect={() => { setKlaviyoKey(""); setModal("klaviyo"); }} onDisconnect={disconnectKlaviyo}>
          {m.klaviyo_last_error && (
            <Callout T={T} tone="danger" title="Último error de Klaviyo" style={{ marginBottom:12 }}>
              {m.klaviyo_last_error}{m.klaviyo_last_error_at ? ` · ${fmtDateShort(m.klaviyo_last_error_at)}` : ""}. Si la clave fue revocada, cargá una nueva.
            </Callout>
          )}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <button type="button" style={b.ghost} onClick={testKlaviyo} disabled={!!busy}>{busy === "klaviyo-test" ? "Enviando…" : "Probar evento"}</button>
            <button type="button" style={b.ghost} onClick={() => { setKlaviyoKey(""); setModal("klaviyo"); }}>Cambiar clave</button>
            {m.klaviyo_connected_at && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Conectado el {fmtDateShort(m.klaviyo_connected_at)}</span>}
          </div>
          <CheckLine T={T} checked={Boolean(m.klaviyo_send_orders)} onChange={toggleKlaviyoOrders} style={{ color:T.text, marginTop:14 }}>
            Mi Klaviyo NO está conectado a Shopify: enviar también "Placed Order" en cada cobro
          </CheckLine>
          <Callout T={T} tone="warning" title="Una vez, 2 minutos" style={{ marginTop:14 }}>
            Klaviyo separa las métricas por integración: <S T={T}>"Checkout Started" de Shopify</S> y <S T={T}>"Checkout Started" de Recurrentes (API)</S> son distintas. Para que tu flujo de abandono también atienda los checkouts de suscripción, clonalo con "Checkout Started" (API) como disparador, o sumale una segunda entrada.
          </Callout>
          <div style={{ fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:0.9, color:T.textSm, margin:"16px 0 8px" }}>Eventos que enviamos · usalos como disparador</div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {KLAVIYO_EVENTS.map(([name, desc]) => (
              <div key={name} style={{ display:"flex", gap:10, alignItems:"baseline", flexWrap:"wrap", fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>
                <code style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text, background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:6, padding:"1px 7px", whiteSpace:"nowrap" }}>{name}</code>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <Hint T={T} style={{ marginTop:12, marginBottom:0 }}>
            En cada evento también actualizamos el perfil con <code style={{ fontFamily:MONO }}>recurrentes_status</code>, <code style={{ fontFamily:MONO }}>recurrentes_plan</code>, <code style={{ fontFamily:MONO }}>recurrentes_next_charge_at</code> y más, para segmentar campañas.
          </Hint>
        </Row>
        <div style={{ height:8 }}/>
      </div>

      {/* ── Modales de conexión ── */}
      {modal === "shopify" && (
        <Modal T={T} title="Conectar Shopify" busy={busy === "shopify"} onClose={close}
          sub={envApp ? "Poné tu dominio .myshopify.com, tocá Autorizar y aceptá en Shopify. Listo." : "Creás una app en tu Shopify (5 minutos) y pegás las 2 claves. Te guiamos paso a paso."}
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "shopify"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={connectShopify} disabled={busy === "shopify" || !shopP.ok || (!envApp && (!clientId.trim() || !clientSecret.trim()))}>{busy === "shopify" ? <><Spinner size={12}/> Conectando…</> : "Autorizar en Shopify →"}</Btn>
          </>}>
          {!envApp && (
            <Steps T={T} title="Crear tu app en Shopify">
              <li>Entrá a <A T={T} href="https://dev.shopify.com/dashboard">dev.shopify.com/dashboard</A> → <S T={T}>Crear app</S> → nombre <S T={T}>Recurrentes</S>.</li>
              <li>En <S T={T}>Configuración → URLs</S> agregá esta URL de redirección:<CopyCode T={T} text={`${window.location.origin}/api/shopify/oauth-callback`}/></li>
              <li>En <S T={T}>Acceso a la API (scopes)</S> marcá estos permisos:<CopyCode T={T} text={SHOPIFY_SCOPES}/></li>
              <li>Guardá y andá a <S T={T}>Credenciales</S>: copiá el <S T={T}>ID de cliente</S> y el <S T={T}>Secreto</S> (tocá el ojito para verlo).</li>
              <li>Pegalos abajo con tu dominio y tocá <S T={T}>Autorizar</S>. En Shopify aceptá la instalación y volvés conectado.</li>
            </Steps>
          )}
          <Field T={T} label={envApp ? "Tu dominio Shopify" : "1 · Tu dominio Shopify"}>
            <input value={shopRaw} onChange={e => setShopRaw(e.target.value)} placeholder="tu-tienda.myshopify.com" style={iS} autoFocus disabled={busy === "shopify"}/>
          </Field>
          {shopRaw.trim() && (
            <div style={{ fontSize:11, margin:"-4px 0 10px", padding:"6px 10px", borderRadius:6, background:(shopP.ok ? T.green : T.red) + "14", border:`1px solid ${(shopP.ok ? T.green : T.red)}44`, color:T.text }}>
              {shopP.ok ? <>Se va a conectar <S T={T}>{shopP.shop}</S>{shopP.completed && <span style={{ color:T.textSm }}> (completamos el .myshopify.com)</span>}</>
                : shopP.own ? <>Ese es tu dominio propio. Necesitamos el de Shopify, que termina en <S T={T}>.myshopify.com</S>: lo ves en tu admin → Configuración → Dominios.</>
                : <>Revisá el dominio: solo letras, números y guiones, y termina en .myshopify.com.</>}
            </div>
          )}
          {!envApp && (
            <>
              <Field T={T} label="2 · Client ID (ID de cliente)">
                <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="b4ca9a62b9e9bf0bd79deba391333d22" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "shopify"}/>
              </Field>
              <Field T={T} label="3 · Client Secret (Secreto)">
                <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="••••••••••••••••••••••••••••••••" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "shopify"}/>
              </Field>
              <Hint T={T}>La URL de redirección de tu app tiene que ser exactamente la del paso 2; si no, Shopify rechaza la autorización.</Hint>
            </>
          )}
        </Modal>
      )}

      {modal === "mp" && (
        <Modal T={T} title={mpOk ? "Cambiar la cuenta de Mercado Pago" : "Conectar Mercado Pago"} busy={busy === "mp"} onClose={close}
          sub="Es la cuenta que cobra las suscripciones. Cada renovación entra directo ahí."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "mp"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={saveMpToken} disabled={busy === "mp" || !mpTokenOk}>{busy === "mp" ? <><Spinner size={12}/> Guardando…</> : "Guardar token"}</Btn>
          </>}>
          {m.mp_oauth_available && (
            <>
              <Btn T={T} variant="solid" onClick={connectMPOauth} disabled={busy === "mp-oauth"} style={{ width:"100%", justifyContent:"center" }}>{busy === "mp-oauth" ? "Abriendo Mercado Pago…" : "Conectar con Mercado Pago →"}</Btn>
              <div style={{ display:"flex", alignItems:"center", gap:10, margin:"14px 0", fontSize:11, color:T.textSm }}><span style={{ flex:1, height:1, background:T.borderL }}/>o pegá tu Access Token<span style={{ flex:1, height:1, background:T.borderL }}/></div>
            </>
          )}
          <Steps T={T} title="Dónde está tu Access Token">
            <li>Entrá a <A T={T} href="https://www.mercadopago.com.ar/developers/panel/app">mercadopago.com.ar/developers</A> con la cuenta que va a cobrar.</li>
            <li>Abrí tu aplicación (o creá una: tipo <S T={T}>Pagos online</S>, producto <S T={T}>Suscripciones</S>).</li>
            <li>En <S T={T}>Credenciales de producción</S> copiá el <S T={T}>Access Token</S> (empieza con APP_USR-). Para probar podés usar uno de prueba (TEST-).</li>
          </Steps>
          <Field T={T} label={<span style={{ display:"inline-flex", alignItems:"center", gap:8 }}>Access Token <MpTokenTip T={T} label=""/></span>}>
            <input type="password" value={mpToken} onChange={e => setMpToken(e.target.value)} placeholder="APP_USR-… o TEST-…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus={!m.mp_oauth_available} disabled={busy === "mp"}/>
          </Field>
          {mpToken.trim() && !mpTokenOk && <Hint T={T} style={{ color:T.red }}>Ese no parece un Access Token: empieza con APP_USR- (o TEST-).</Hint>}
          <Hint T={T}>Lo guardamos cifrado y nunca lo mostramos de vuelta.</Hint>
        </Modal>
      )}

      {modal === "meta" && (
        <Modal T={T} title={metaOk ? "Cambiar credenciales de Meta" : "Conectar Meta Ads"} busy={busy === "meta"} onClose={close}
          sub="Para reportar la primera venta de cada suscripción a tus campañas (API de Conversiones)."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "meta"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={saveMeta} disabled={busy === "meta" || !pixel.trim() || !capi.trim()}>{busy === "meta" ? <><Spinner size={12}/> Conectando…</> : "Conectar"}</Btn>
          </>}>
          <Steps T={T} title="Qué necesitás de tu Meta Business">
            <li><S T={T}>Pixel ID</S>: Administrador de eventos → tu pixel → arriba, <S T={T}>Copiar identificador</S>.</li>
            <li><S T={T}>Token de la API de Conversiones</S>: en el mismo pixel → Configuración → API de conversiones → <S T={T}>Generar token de acceso</S>.</li>
          </Steps>
          <Field T={T} label="Pixel ID (solo números)">
            <input value={pixel} onChange={e => setPixel(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="1234567890" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy === "meta"}/>
          </Field>
          <Field T={T} label="Token de la API de Conversiones">
            <input type="password" value={capi} onChange={e => setCapi(e.target.value)} placeholder="EAAG…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "meta"}/>
          </Field>
        </Modal>
      )}

      {modal === "klaviyo" && (
        <Modal T={T} title={klaviyoOk ? "Cambiar la clave de Klaviyo" : "Conectar Klaviyo"} busy={busy === "klaviyo"} onClose={close}
          sub="Mandamos a tu Klaviyo los checkouts sin pagar y cada evento de suscripción, para que armes tus flows."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "klaviyo"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={connectKlaviyo} disabled={busy === "klaviyo" || !klaviyoKey.trim().startsWith("pk_")}>{busy === "klaviyo" ? <><Spinner size={12}/> Validando…</> : "Conectar"}</Btn>
          </>}>
          <Steps T={T} title="Crear la clave (1 minuto)">
            <li>En Klaviyo andá a <A T={T} href="https://www.klaviyo.com/settings/account/api-keys">Configuración → API keys</A> → <S T={T}>Create Private API Key</S>.</li>
            <li>Dale permisos <S T={T}>Accounts: Read</S>, <S T={T}>Events: Write</S> y <S T={T}>Profiles: Write</S>.</li>
            <li>Copiala (empieza con pk_) y pegala acá abajo.</li>
          </Steps>
          <Field T={T} label="Private API Key">
            <input type="password" value={klaviyoKey} onChange={e => setKlaviyoKey(e.target.value)} placeholder="pk_…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy === "klaviyo"}/>
          </Field>
          <Hint T={T}>La validamos contra tu cuenta y nunca la mostramos de vuelta.</Hint>
        </Modal>
      )}
    </div>
  );
}
