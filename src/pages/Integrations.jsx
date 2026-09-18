import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, Field, InputStyle, Spinner, PageHeader, Callout, Hint, CheckLine, appConfirm, toast } from "../ui/components.jsx";
import { BrandIcon } from "../ui/brands.jsx";
import { MpTokenTip } from "./Onboarding.jsx";
import { WidgetThemeCard } from "./OperationalSettings.jsx";
import { MONO, fmtDateShort } from "./_shared.jsx";
import { MP_RECONNECT_COPY, MP_LAST_ERROR_COPY } from "../lib/mpOauth.js";
import { CHANNELS, PAYMENT_PROVIDERS, merchantProfile, channelAvailable } from "../../shared/platform/profile.js";
import { ShopifyConnectSteps, ShopifyTroubleshoot, ShopifyScopeNotice, TutorialVideo, shopifyCredsWarning } from "./ShopifyConnect.jsx";
import { WhatsAppRow } from "./WhatsAppIntegration.jsx";
import { UsdProviderRows } from "./UsdProviders.jsx";

// ─── Integraciones (Configuración → Integraciones) — estilo Growith ──────
// Una tarjeta con filas agrupadas (Tienda · Pasarelas · Publicidad · Emails):
// logo en cuadro blanco (anillo del color de la marca si está conectado), estado
// en píldora, Conectar / Desvincular y "Ajustes" que despliega el detalle.
// Conectar abre un modal guiado (pasos + campos). Los endpoints no cambian.
// embedded=true: sin PageHeader (Configuración ya pone el título).

const F = "'Inter',system-ui,sans-serif";
const BRAND = { shopify:"#95BF47", tiendanube:"#00a0e3", impultienda:"#111827", link:"#10b981", mercadopago:"#00B1EA", mobbex:"#6f2cf5", stripe:"#635BFF", whop:"#FA4616", meta:"#1877F2", klaviyo:"#232426" };

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

// Plataformas sin conector propio todavía: se muestran como "Próximamente" con el
// botón de pedirlo por WhatsApp, y lo conectamos a mano.
const OTHER_PLATFORMS = [
  { id:"woocommerce", label:"WooCommerce", desc:"Tu WordPress con WooCommerce. Próximamente: te lo conectamos a mano, pedilo por WhatsApp." },
  { id:"empretienda", label:"Empretienda", desc:"Próximamente: te lo conectamos a mano, pedilo por WhatsApp." },
  { id:"vtex", label:"VTEX", desc:"Próximamente: te lo conectamos a mano, pedilo por WhatsApp." },
  { id:"custom", label:"Desarrollo propio", desc:"Tu web a medida. Próximamente: te lo conectamos a mano, pedilo por WhatsApp." },
];
function Row({ T, id, label, sub, connected, soon, required, error, warn, optional, ready, onConnect, onDisconnect, connectLabel = "Conectar", open, onToggle, action, children }) {
  const b = btnStyles(T);
  const brand = BRAND[id] || T.accentSolid;
  return (
    <div style={{ borderBottom:`1px solid ${T.borderL}` }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"13px 4px", flexWrap:"wrap" }}>
        <div style={{ width:42, height:42, borderRadius:11, background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, border:`1px solid ${T.borderL}`, boxShadow: connected || ready ? `0 0 0 2px ${brand}33` : "none" }}>
          <BrandIcon name={id} size={26}/>
        </div>
        <div style={{ flex:"1 1 200px", minWidth:0 }}>
          <div style={{ fontSize:13.5, fontWeight:700, color:T.text, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            {label}
            {optional && <span style={{ fontSize:11, fontWeight:500, color:T.textSm }}>opcional</span>}
            {connected && !warn && <Pill T={T} c={T.green} dot>Conectado</Pill>}
            {warn && <Pill T={T} c={T.red} dot>{warn}</Pill>}
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
            : soon ? <a href={`https://wa.me/5491164117974?text=${encodeURIComponent(`Hola! Quiero usar Recurrentes con ${label}. ¿Me lo pueden conectar?`)}`} target="_blank" rel="noopener noreferrer"
                style={{ display:"inline-flex", alignItems:"center", gap:7, padding:"8px 14px", borderRadius:10, border:`1px solid ${T.border}`, background:T.card, color:T.text, fontSize:12.5, fontWeight:700, textDecoration:"none", whiteSpace:"nowrap" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2z"/></svg>
                Pedirlo por WhatsApp
              </a>
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

// Sin MP en esta tienda pero con MP en otra tienda del mismo dueño (tiendas extra,
// demos): un botón y listo. La copia la hace el servidor (mp-reuse).
function ReuseMpBox({ T, m, b, onChange }) {
  const [others, setOthers] = useState(null);
  const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true;
    apiGet("merchant", { action: "workspace" }).then(d => {
      if (!alive) return;
      const list = (d?.stores || []).filter(s => s.id !== m.id && s.role === "owner" && s.mp_connected && !s.archived);
      setOthers(list);
    }).catch(() => { if (alive) setOthers([]); });
    return () => { alive = false; };
  }, [m.id]);
  if (!others || !others.length) return null;
  async function reuse(s) {
    setBusy(s.id);
    try {
      const d = await apiPatch("merchant", { from_merchant_id: s.id }, { action: "mp-reuse" });
      if (d?.error) throw new Error(d.error);
      toast(`Mercado Pago conectado con la cuenta de ${s.name || "tu otra tienda"}`, "success");
      onChange?.();
    } catch (e) { toast(e.message || "No se pudo copiar la conexión", "error", 6000); }
    finally { setBusy(""); }
  }
  return (
    <div style={{ margin:"-4px 0 14px", padding:"12px 14px", background:T.surface, border:`1px solid ${T.accentSolid}55`, borderRadius:10 }}>
      <div style={{ fontWeight:700, color:T.text, marginBottom:4 }}>¿Cobrás con la misma cuenta de Mercado Pago que otra de tus tiendas?</div>
      <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:10 }}>Un clic y esta tienda queda conectada con esa misma cuenta. Después la podés cambiar cuando quieras.</div>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        {others.map(s => (
          <button key={s.id} type="button" style={b.solid} disabled={!!busy} onClick={() => reuse(s)}>
            {busy === s.id ? "Conectando…" : `Usar la cuenta de ${s.name || s.id}`}
          </button>
        ))}
      </div>
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
  // Con app única de Recurrentes (SHOPIFY_API_KEY en env) no hace falta app propia.
  const envApp = Boolean(m.shopify_env_app);

  const [open, setOpen] = useState(null);          // fila con "Ajustes" desplegado
  const [modal, setModal] = useState(null);        // "shopify" | "mp" | "meta"
  const [busy, setBusy] = useState("");
  const toggle = (id) => setOpen(o => o === id ? null : id);
  const close = () => { if (!busy) setModal(null); };

  // ── Shopify ──
  const [shopRaw, setShopRaw] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const shopP = parseShop(shopRaw);
  const openShopify = () => { setShopRaw(m.shopify_shop || ""); setClientId(""); setClientSecret(""); setModal("shopify"); };
  // Reconectar con la app ya guardada (misma tienda, campos vacíos): no hace falta volver a pegar las claves.
  const reuseCreds = !envApp && Boolean(m.shopify_has_own_app) && shopP.ok && shopP.shop === m.shopify_shop && !clientId.trim() && !clientSecret.trim();
  const credsWarn = envApp ? "" : shopifyCredsWarning(clientId, clientSecret);
  async function connectShopify() {
    if (!shopP.ok) return toast("Poné el dominio .myshopify.com de tu tienda", "warning");
    if (!envApp && !reuseCreds && (!clientId.trim() || !clientSecret.trim())) return toast("Pegá el Client ID y el Client Secret de tu app", "warning");
    setBusy("shopify");
    const d = reuseCreds ? {} : await apiPost("shopify", { shop: shopP.shop, client_id: clientId.trim(), client_secret: clientSecret.trim() }, { action: "save-creds" });
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

  // ── Tiendanube (se habilita cuando existe la app de Partner o si ya está conectada) ──
  const tnEnabled = channelAvailable("tiendanube", m);
  const tnOk = Boolean(m.tiendanube_token);
  const [tnUrl, setTnUrl] = useState("");
  const openTn = () => { setTnUrl(m.tiendanube_store_url || ""); setModal("tiendanube"); };
  async function connectTiendanube() {
    setBusy("tiendanube");
    const d = await apiGet("shopify", { action: "tn-oauth-start", store_url: tnUrl.trim() });
    if (!d?.url) { setBusy(""); return toast("Error: " + (d?.error || "no se pudo iniciar la autorización"), "error", 6000); }
    window.location.href = d.url;
  }
  async function disconnectTiendanube() {
    const ok = await appConfirm("Se borra el acceso a tu tienda y sacamos el widget. Las suscripciones siguen cobrándose en Mercado Pago, pero no se van a crear órdenes hasta que vuelvas a conectar.", { title:"¿Desvincular Tiendanube?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("shopify", {}, { action: "tn-disconnect" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Tiendanube desvinculada", "warning"); setOpen(null); onChange?.(); }
  }
  async function installTnScript() {
    setBusy("tn-script");
    const d = await apiPost("shopify", {}, { action: "tn-install-script" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    toast("Listo: el widget ya se carga en tus páginas de producto", "success"); onChange?.();
  }
  async function switchToTiendanube() {
    const body = { channel: "tiendanube" };
    setBusy("tn-channel");
    let d = await apiPatch("merchant", body, { action: "save-settings" });
    if (d?.code === "confirm_channel_change") {
      setBusy("");
      const ok = await appConfirm(d.error, { title:"¿Pasar de Shopify a Tiendanube?", danger:true, okLabel:"Sí, cambiar" });
      if (!ok) return;
      setBusy("tn-channel");
      d = await apiPatch("merchant", { ...body, confirm_channel_change: true }, { action: "save-settings" });
    }
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    toast("Listo: cada cobro va a crear una orden en Tiendanube", "success"); onChange?.();
  }
  // Vuelta de la autorización (?tiendanube=ok|error) o instalación desde la tienda de apps (?tn_claim=).
  const tnReturnDone = React.useRef(false);
  useEffect(() => {
    if (tnReturnDone.current) return;
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const res = q.get("tiendanube"), claim = q.get("tn_claim");
    if (!res && !claim) return;
    tnReturnDone.current = true;
    const clean = () => { try { window.history.replaceState(null, "", window.location.pathname + "#/config/integraciones"); } catch (_) {} };
    // Tiendanube carga el widget solo: no hay paso 2. Directo a crear el primer plan.
    const goPlanes = () => { try { window.location.hash = "#/dashboard/planes"; } catch (_) {} };
    if (res === "ok") { toast("Tiendanube conectada · el widget ya está en tu tienda. Creá tu primer plan.", "success", 6000); onChange?.(); goPlanes(); return; }
    if (res === "error") { clean(); toast("No se pudo conectar Tiendanube: " + (q.get("msg") || "error desconocido"), "error", 8000); return; }
    apiPost("shopify", { claim }, { action: "tn-claim" }).then(d => {
      clean();
      if (d?.error) toast("No se pudo conectar Tiendanube: " + d.error, "error", 8000);
      else { toast(`Tiendanube conectada${d.store_name ? ` (${d.store_name})` : ""} · el widget ya está en tu tienda. Creá tu primer plan.`, "success", 6000); onChange?.(); goPlanes(); }
    });
    // eslint-disable-next-line
  }, []);

  // ── Mercado Pago ──
  const [mpToken, setMpToken] = useState("");
  const [mpPaste, setMpPaste] = useState(false);   // pegar el token (alternativa a la conexión automática)
  const mpTokenOk = /^(APP_USR-|TEST-)/.test(mpToken.trim());
  const mpOauth = m.mp_method === "oauth";
  const mpReconnect = mpOk && Boolean(m.mp_reconnect_required);
  const openMp = (paste = false) => { setMpToken(""); setMpPaste(paste || !m.mp_oauth_available); setModal("mp"); };
  async function connectMPOauth() {
    setBusy("mp-oauth");
    // return_origin: volver al mismo dominio donde estás logueado (el backend lo valida).
    const d = await apiPost("merchant", { return_origin: window.location.origin }, { action: "mp-oauth-start" });
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


  // Lo que viene (visible, no elegible).
  // Una tienda a la vez: con una plataforma conectada, las otras no se muestran.
  const storeConnected = shopifyOk || tnOk;
  const soonChannels = storeConnected ? [] : Object.values(CHANNELS).filter(c => !channelAvailable(c.id, m) && c.id !== profile.channel && c.types.includes(profile.businessType));
  // Tiendanube habilitada pero no es el canal elegido: fila opcional para conectarla.
  const tnOptional = tnEnabled && !shopifyOk && profile.channel !== "tiendanube" && CHANNELS.tiendanube.types.includes(profile.businessType);
  const soonProviders = Object.values(PAYMENT_PROVIDERS).filter(p => p.status !== "available" && !(p.id === "stripe" && m.stripe_enabled) && !(p.id === "whop" && m.whop_enabled));
  const storeRequired = profile.channel === "shopify" || profile.channel === "tiendanube";
  const reqTotal = storeRequired ? 2 : 1;
  const reqOk = (storeRequired ? Number(profile.connected.channel) : 0) + Number(mpOk);
  const code = (t) => <code style={{ fontFamily:MONO, fontSize:DS.font.sm, color:T.text }}>{t}</code>;
  // Fila de Tiendanube: necesaria si es el canal elegido; opcional si solo está habilitada.
  const tnRow = (required) => (
    <Row T={T} id="tiendanube" label="Tiendanube" required={required} optional={!required} connected={tnOk} open={open === "tiendanube"} onToggle={() => toggle("tiendanube")}
      sub={tnOk ? `${m.tiendanube_store_name || m.tiendanube_store_url || "Tienda conectada"} · lee tus productos y crea una orden con cada cobro` : "Para leer tus productos, mostrar el widget en tu tienda y crear una orden con cada cobro."}
      onConnect={openTn} onDisconnect={disconnectTiendanube}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:12 }}>
        <span style={{ fontSize:DS.font.md, color:T.textMd }}>Tienda: {code(m.tiendanube_store_url || m.tiendanube_store_id || "—")}</span>
        <button type="button" style={b.ghost} onClick={openTn}>Reconectar</button>
      </div>
      {m.tiendanube_script_installed
        ? <Hint T={T} style={{ marginBottom:0 }}>El widget de suscripción ya se carga solo en tus páginas de producto. No tenés que pegar código.</Hint>
        : m.tiendanube_script_configured
          ? <Callout T={T} tone="warning" title="El widget todavía no está en tu tienda" style={{ marginBottom:0 }}
              right={<button type="button" style={b.ghost} onClick={installTnScript} disabled={busy === "tn-script"}>{busy === "tn-script" ? "Instalando…" : "Instalar widget"}</button>}>
              {m.tiendanube_script_error ? `Tiendanube respondió: ${m.tiendanube_script_error}` : "Tocá Instalar widget para que aparezca en tus páginas de producto."}
            </Callout>
          : <Hint T={T} style={{ marginBottom:0 }}>Muy pronto el widget se va a instalar solo en tus páginas de producto.</Hint>}
      {profile.channel !== "tiendanube" && (
        <Callout T={T} tone="info" style={{ marginTop:12, marginBottom:0 }}
          right={<button type="button" style={b.solid} onClick={switchToTiendanube} disabled={busy === "tn-channel"}>{busy === "tn-channel" ? "Cambiando…" : "Usar Tiendanube como mi tienda"}</button>}>
          Hoy tus cobros {profile.channelInfo.orders ? `crean órdenes en ${profile.channelInfo.label}` : "quedan registrados en Recurrentes"}. Si vendés con Tiendanube, cambiala acá: cada cobro va a crear una orden en tu tienda.
        </Callout>
      )}
    </Row>
  );

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
            <ShopifyScopeNotice T={T} scope={m.shopify_scope} onReconnect={openShopify}/>
            <div style={{ height:1, background:T.borderL, margin:"0 0 14px" }}/>
            <WidgetThemeCard merchant={m} onChange={onChange} bare/>
          </Row>
        ) : profile.channel === "tiendanube" ? tnRow(true) : (
          <Row T={T} id="link" label={profile.channelInfo.label} ready
            sub="Vendés con links de suscripción a un checkout de Recurrentes. No hace falta conectar ninguna tienda."
            action={<a href="#/dashboard/planes" style={{ ...b.ghost, textDecoration:"none", display:"inline-block" }}>Ver mis links</a>}/>
        )}
        {tnOptional && tnRow(false)}
        {soonChannels.map(c => <Row key={c.id} T={T} id={c.id} label={c.label} soon sub={`${c.desc} Próximamente: mientras tanto te lo conectamos a mano, pedilo por WhatsApp.`}/>)}
        {/* Otras plataformas: todavía no hay conector, se hacen a mano (Thiago, 18-sept). */}
        {!storeConnected && OTHER_PLATFORMS.map(o => <Row key={o.id} T={T} id={o.id} label={o.label} soon sub={o.desc}/>)}

        {/* ── Pasarelas ── */}
        <GroupTitle T={T}>Pasarelas de pago</GroupTitle>
        <Row T={T} id="mercadopago" label="Mercado Pago" required connected={mpOk} open={open === "mp"} onToggle={() => toggle("mp")}
          warn={mpReconnect ? "Reconectar" : null} error={mpOk && !mpReconnect && Boolean(m.mp_last_error)}
          action={mpReconnect ? <button type="button" style={b.solid} onClick={() => openMp(false)}>Reconectar</button> : null}
          sub={mpOk ? `Cuenta ${m.mp_email || "conectada"} · ${mpOauth ? "conexión automática" : "Access Token pegado"}${m.mp_live_mode === false ? " · modo prueba" : ""}` : "La cuenta que cobra las suscripciones y procesa cada renovación."}
          onConnect={() => openMp(false)} onDisconnect={disconnectMP}>
          {mpReconnect && (
            <Callout T={T} tone="danger" title="Hay que reconectar Mercado Pago" style={{ marginBottom:12 }}>
              {MP_RECONNECT_COPY[m.mp_reconnect_reason] || MP_RECONNECT_COPY.refresh_invalid}
            </Callout>
          )}
          {!mpReconnect && m.mp_last_error && (
            <Callout T={T} tone="warning" title={`${MP_LAST_ERROR_COPY[m.mp_last_error] || "Mercado Pago rechazó un pedido"}${m.mp_last_error_at ? ` · ${fmtDateShort(m.mp_last_error_at)}` : ""}`} style={{ marginBottom:12 }}>
              A veces es algo puntual. Si los cobros nuevos no aparecen en Recurrentes, reconectá tu cuenta.
            </Callout>
          )}
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.7, marginBottom:12 }}>
            Cuenta: <S T={T}>{m.mp_email || (m.mp_user_id ? `ID ${m.mp_user_id}` : "—")}</S><br/>
            Cómo está conectada: <S T={T}>{mpOauth ? "conexión automática con Mercado Pago" : "Access Token pegado a mano"}</S>{m.mp_connected_at ? ` · desde el ${fmtDateShort(m.mp_connected_at)}` : ""}<br/>
            {mpOauth && m.mp_token_expires_at && !mpReconnect && <>El acceso se renueva solo: vence el {fmtDateShort(m.mp_token_expires_at)} y lo renovamos antes.<br/></>}
            {m.mp_live_mode === false && <span style={{ color:T.yellow }}>Es una cuenta de prueba: los cobros no son reales.<br/></span>}
            {m.mp_country && m.mp_country !== "AR" && <span style={{ color:T.yellow }}>La cuenta no es de Argentina: las suscripciones en pesos pueden no funcionar.<br/></span>}
          </div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {m.mp_oauth_available && <button type="button" style={mpReconnect ? b.solid : b.ghost} onClick={() => openMp(false)}>{mpOauth || mpReconnect ? "Reconectar con Mercado Pago" : "Pasar a conexión automática"}</button>}
            {!mpOauth && <button type="button" style={b.ghost} onClick={() => openMp(true)}>Cambiar Access Token</button>}
          </div>
        </Row>
        {/* Sin MP acá pero con MP en otra tienda del dueño: la fila cerrada no muestra hijos, va afuera. */}
        {!mpOk && <ReuseMpBox T={T} m={m} b={b} onChange={onChange}/>}
        {m.mobbex_available && <MobbexRow T={T} m={m} profile={profile} onChange={onChange} open={open === "mobbex"} onToggle={() => toggle("mobbex")}/>}
        {soonProviders.filter(p => !(p.id === "mobbex" && m.mobbex_available)).map(p => <Row key={p.id} T={T} id={p.id} label={p.label} soon sub={p.desc}/>)}
        <UsdProviderRows T={T} m={m} onChange={onChange} open={open} toggle={toggle} ui={{ Row, Modal, Steps, CopyCode, S }}/>{/* Stripe / Whop si su *_ENABLED está prendido */}

        {/* ── Publicidad ── */}
        <GroupTitle T={T}>Publicidad</GroupTitle>
        <Row T={T} id="meta" label="Meta Ads" optional connected={metaOk} open={open === "meta"} onToggle={() => toggle("meta")}
          sub={metaOk ? `Pixel ${m.meta_pixel_id} · le avisa a Meta cada primera venta de suscripción` : "Solo si hacés publicidad en Facebook o Instagram: que tus campañas cuenten las suscripciones como ventas."}
          onConnect={openMeta} onDisconnect={disconnectMeta}>
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:12 }}>
            Mandamos a Meta la <S T={T}>primera venta</S> de cada suscripción por la API de Conversiones (del lado del servidor). <S T={T}>Las renovaciones no se reportan</S>, así no inflás la atribución de tus campañas.
          </div>
          <button type="button" style={b.ghost} onClick={openMeta}>Cambiar credenciales</button>
        </Row>

        {/* ── Mensajes (WhatsApp Cloud API, WhatsAppIntegration.jsx) ── */}
        <GroupTitle T={T}>Mensajes</GroupTitle>
        <WhatsAppRow T={T} merchant={m} onChange={onChange} ui={{ Row, Modal, Steps, CopyCode, A, S, btnStyles }}/>
        <div style={{ height:8 }}/>
      </div>

      {/* ── Modales de conexión ── */}
      {modal === "shopify" && (
        <Modal T={T} title={shopifyOk ? "Reconectar Shopify" : "Conectar Shopify"} busy={busy === "shopify"} onClose={close} maxWidth={envApp ? 560 : 640}
          sub={envApp ? "Poné tu dominio .myshopify.com, tocá Autorizar y aceptá en Shopify. Listo." : "Creás tu app en Shopify (3 min) y pegás las 2 claves."}
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "shopify"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={connectShopify} disabled={busy === "shopify" || !shopP.ok || (!envApp && !reuseCreds && (!clientId.trim() || !clientSecret.trim()))}>{busy === "shopify" ? <><Spinner size={12}/> Conectando…</> : "Autorizar en Shopify →"}</Btn>
          </>}>
          {!envApp && (
            <>
              <TutorialVideo T={T}/>
              <ShopifyConnectSteps T={T}/>
            </>
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
          <div style={{ fontSize:10.5, color:T.textSm, margin:"-4px 0 12px", lineHeight:1.55 }}>
            Pegá el dominio <S T={T}>completo</S>, incluido el <code style={{ fontFamily:MONO, color:T.accent }}>.myshopify.com</code> (ej: <code style={{ fontFamily:MONO, color:T.accent }}>tu-tienda.myshopify.com</code>). Si escribís solo <code style={{ fontFamily:MONO }}>tu-tienda</code> también sirve: lo completamos nosotros.<br/>
            <strong style={{ color:T.red }}>NO uses tu dominio propio</strong> (ej: <code style={{ fontFamily:MONO, color:T.red }}>tutienda.com</code> / <code style={{ fontFamily:MONO, color:T.red }}>.com.ar</code>).<br/>
            ¿Dónde lo encontrás? En tu admin de Shopify → <S T={T}>Configuración → Dominios</S> → el que tiene el sello <S T={T}>"Predeterminado de Shopify"</S> (ese termina en .myshopify.com).
          </div>
          {!envApp && (
            <>
              <Field T={T} label="2 · Client ID">
                <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="8a3b6810ff78..." style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "shopify"}/>
              </Field>
              <Field T={T} label="3 · Client Secret">
                <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder="shpss_..." style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "shopify"}/>
              </Field>
              {reuseCreds && <Hint T={T} style={{ color:T.green }}>Ya tenemos guardadas las claves de tu app: dejá los campos vacíos para reconectar con las mismas, o pegá nuevas.</Hint>}
              {credsWarn && <Hint T={T} style={{ color:T.red }}>{credsWarn}</Hint>}
              <Hint T={T}>Se usa para autorizar y se guarda cifrado. Nunca se comparte.</Hint>
            </>
          )}
        </Modal>
      )}

      {modal === "tiendanube" && (
        <Modal T={T} title={tnOk ? "Reconectar Tiendanube" : "Conectar Tiendanube"} busy={busy === "tiendanube"} onClose={close}
          sub="Poné la dirección de tu tienda, tocá Autorizar y aceptá en Tiendanube. Listo."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "tiendanube"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={connectTiendanube} disabled={busy === "tiendanube"}>{busy === "tiendanube" ? <><Spinner size={12}/> Abriendo Tiendanube…</> : "Autorizar en Tiendanube →"}</Btn>
          </>}>
          <Steps T={T} title="Cómo es">
            <li>Entrá con la cuenta dueña de la tienda (si no estás adentro, Tiendanube te la pide).</li>
            <li>Tocá <S T={T}>Autorizar</S>: Tiendanube te muestra lo que pedimos (ver productos, crear órdenes y mostrar el widget).</li>
            <li>Aceptá y volvés acá conectado. El widget aparece solo en tus páginas de producto.</li>
          </Steps>
          <Field T={T} label="Dirección de tu tienda">
            <input value={tnUrl} onChange={e => setTnUrl(e.target.value)} placeholder="tutienda.mitiendanube.com" style={iS} autoFocus disabled={busy === "tiendanube"}/>
          </Field>
          <Hint T={T}>Si tenés dominio propio (tutienda.com.ar) también sirve. Si la dejás vacía, Tiendanube te pide elegir la tienda.</Hint>
        </Modal>
      )}

      {modal === "mp" && (
        <Modal T={T} title={mpReconnect ? "Reconectar Mercado Pago" : mpOk ? "Cambiar la cuenta de Mercado Pago" : "Conectar Mercado Pago"} busy={busy === "mp" || busy === "mp-oauth"} onClose={close}
          sub="Es la cuenta que cobra las suscripciones. Cada renovación entra directo ahí."
          footer={mpPaste ? <>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "mp"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={saveMpToken} disabled={busy === "mp" || !mpTokenOk}>{busy === "mp" ? <><Spinner size={12}/> Guardando…</> : "Guardar token"}</Btn>
          </> : null}>
          {mpOk && (
            <Callout T={T} tone="warning" title="Usá la misma cuenta que ya cobra" style={{ marginBottom:14 }}>
              Si conectás otra cuenta, las suscripciones que ya existen siguen cobrándose en la anterior y no las vamos a poder procesar.
            </Callout>
          )}
          {m.mp_oauth_available && (
            <>
              <button type="button" onClick={connectMPOauth} disabled={busy === "mp-oauth"}
                style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"center", gap:10, padding:"13px 18px", borderRadius:10, border:"none", background:BRAND.mercadopago, color:"#fff", fontSize:14.5, fontWeight:700, cursor: busy === "mp-oauth" ? "wait" : "pointer", fontFamily:F, boxShadow:"0 4px 14px rgba(0,177,234,0.30)" }}>
                <span style={{ width:26, height:26, borderRadius:7, background:"#fff", display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><BrandIcon name="mercadopago" size={20}/></span>
                {busy === "mp-oauth" ? "Abriendo Mercado Pago…" : "Conectar con Mercado Pago"}
              </button>
              <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.55, marginTop:9, textAlign:"center" }}>
                Te llevamos a Mercado Pago: entrás con la cuenta que cobra, tocás <S T={T}>Autorizar</S> y volvés acá conectado. No tenés que copiar nada.
              </div>
              {!mpPaste && (
                <div style={{ textAlign:"center", marginTop:16 }}>
                  <button type="button" onClick={() => setMpPaste(true)} style={{ background:"none", border:"none", padding:0, color:T.textMd, fontSize:DS.font.sm, textDecoration:"underline", cursor:"pointer", fontFamily:F }}>¿Preferís pegar el Access Token?</button>
                </div>
              )}
              {mpPaste && <div style={{ display:"flex", alignItems:"center", gap:10, margin:"16px 0 14px", fontSize:11, color:T.textSm }}><span style={{ flex:1, height:1, background:T.borderL }}/>o pegá tu Access Token<span style={{ flex:1, height:1, background:T.borderL }}/></div>}
            </>
          )}
          {mpPaste && <>
          <Steps T={T} title="Dónde está tu Access Token">
            <li>Entrá a <A T={T} href="https://www.mercadopago.com.ar/developers/panel/app">mercadopago.com.ar/developers</A> con la cuenta que va a cobrar.</li>
            <li>Abrí tu aplicación (o creá una: tipo <S T={T}>Pagos online</S>, producto <S T={T}>Suscripciones</S>).</li>
            <li>En <S T={T}>Credenciales de producción</S> copiá el <S T={T}>Access Token</S> (empieza con APP_USR-). Para probar podés usar uno de prueba (TEST-).</li>
          </Steps>
          <Field T={T} label={<span style={{ display:"inline-flex", alignItems:"center", gap:8 }}>Access Token <MpTokenTip T={T} label=""/></span>}>
            <input type="password" value={mpToken} onChange={e => setMpToken(e.target.value)} placeholder="APP_USR-… o TEST-…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy === "mp"}/>
          </Field>
          {mpToken.trim() && !mpTokenOk && <Hint T={T} style={{ color:T.red }}>Ese no parece un Access Token: empieza con APP_USR- (o TEST-).</Hint>}
          <Hint T={T}>Lo guardamos cifrado y nunca lo mostramos de vuelta.</Hint>
          </>}
        </Modal>
      )}

      {modal === "meta" && (
        <Modal T={T} title={metaOk ? "Cambiar credenciales de Meta" : "Conectar Meta Ads"} busy={busy === "meta"} onClose={close}
          sub="Solo si hacés publicidad en Facebook o Instagram. Si no, no hace falta."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy === "meta"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={saveMeta} disabled={busy === "meta" || !pixel.trim() || !capi.trim()}>{busy === "meta" ? <><Spinner size={12}/> Conectando…</> : "Conectar"}</Btn>
          </>}>
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.65, marginBottom:14, padding:"12px 14px", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10 }}>
            <div style={{ fontWeight:700, color:T.text, marginBottom:4 }}>Para qué sirve</div>
            Las suscripciones se pagan en el checkout de Recurrentes, no en tu tienda, así que <S T={T}>tu pixel de Meta no las ve</S>. Con esto, cada vez que alguien se suscribe por primera vez le avisamos a Meta que hubo una compra, con su monto, y tus campañas la cuentan como venta. Las renovaciones no se mandan, para no inflar los resultados.
          </div>
          <Steps T={T} title="Dos datos, los dos salen del Administrador de eventos de Meta">
            <li><S T={T}>1 · Pixel ID</S>. Entrá a <a href="https://business.facebook.com/events_manager2" target="_blank" rel="noopener noreferrer" style={{ color:T.accent, fontWeight:700 }}>business.facebook.com/events_manager2</a> → en la columna izquierda tocá tu pixel (“Orígenes de datos”). Debajo del nombre hay un <S T={T}>número largo de 15 o 16 dígitos</S>: ese es el Pixel ID. Copialo y pegalo abajo.</li>
            <li><S T={T}>2 · Token de la API de Conversiones</S>. Con el mismo pixel abierto, tocá la pestaña <S T={T}>Configuración</S> → bajá hasta la sección <S T={T}>API de conversiones</S> → <S T={T}>Generar token de acceso</S>. Te da un texto muy largo que empieza con <S T={T}>EAA</S>. Copialo entero (Meta lo muestra una sola vez; si lo perdés, generás otro).</li>
          </Steps>
          <Field T={T} label="Pixel ID (el número largo)">
            <input value={pixel} onChange={e => setPixel(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Ej.: 1234567890123456" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy === "meta"}/>
          </Field>
          <Field T={T} label="Token de la API de Conversiones (empieza con EAA)">
            <input type="password" value={capi} onChange={e => setCapi(e.target.value)} placeholder="EAAG…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "meta"}/>
          </Field>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginTop:4 }}>El token queda guardado solo en Recurrentes y se usa únicamente para avisarle a Meta las compras. Podés desconectarlo cuando quieras.</div>
        </Modal>
      )}

    </div>
  );
}
