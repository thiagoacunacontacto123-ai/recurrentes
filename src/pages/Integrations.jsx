import React, { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSBadge, Field, InputStyle, Spinner, PageHeader, SectionTitle, CardHeader, Callout, Hint, CheckLine, Divider, appConfirm, appPrompt, toast } from "../ui/components.jsx";
import { MpTokenTip, ShopifyAppTip } from "./Onboarding.jsx";
import { MONO, fmtDateShort } from "./_shared.jsx";

// ─── Integraciones (vive en Configuración → Integraciones) ──────
// embedded=true: sin PageHeader (Configuración ya pone el título).

export function IntegrationCard({ T, icon, title, ok, statusLabel, description, children, optional }) {
  return (
    <Card T={T} style={{ borderColor: ok ? T.accentSolid + "66" : T.border, boxShadow: ok ? `0 4px 24px ${T.accentSolid}14, 0 1px 3px rgba(0,0,0,0.07)` : undefined }}>
      <CardHeader T={T} icon={icon} title={<>{title}{optional && <span style={{ fontSize:DS.font.sm, fontWeight:DS.w.medium, color:T.textSm, marginLeft:6 }}>(opcional)</span>}</>}
        badge={<DSBadge T={T} color={ok ? T.green : T.textSm} size="sm">{ok ? "✓ " : ""}{statusLabel}</DSBadge>}
        sub={description}/>
      {children}
    </Card>
  );
}

export function IntegrationsTab({ merchant, onChange, embedded = false }) {
  const T = useT();
  const iS = InputStyle(T);
  const shopifyOk = Boolean(merchant?.shopify_token);
  const mpOk = Boolean(merchant?.mp_access_token);
  const [shopifyShop, setShopifyShop] = useState("");
  // "Reconectar": muestra el formulario aunque ya haya token; se cierra solo al reconectar.
  const [reconnect, setReconnect] = useState(false);
  useEffect(() => { setReconnect(false); }, [merchant?.shopify_token, merchant?.shopify_shop]);
  const [shopifyClientId, setShopifyClientId] = useState("");
  const [shopifyClientSecret, setShopifyClientSecret] = useState("");
  const [shopifyBusy, setShopifyBusy] = useState(false);
  const [shopifyGuide, setShopifyGuide] = useState(false);

  // Con app única de Recurrentes (SHOPIFY_API_KEY en env) no hace falta app propia.
  const envApp = Boolean(merchant?.shopify_env_app);
  const shopifyFormOk = shopifyShop.trim() && (envApp || (shopifyClientId.trim() && shopifyClientSecret.trim()));

  async function connectShopify() {
    const shop = shopifyShop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!shop || !shop.endsWith(".myshopify.com")) {
      toast("Ingresá el dominio .myshopify.com (ej: mitienda.myshopify.com)", "warning");
      return;
    }
    if (!envApp && !shopifyClientId.trim()) { toast("Pegá el Client ID (ID de cliente)", "warning"); return; }
    if (!envApp && !shopifyClientSecret.trim()) { toast("Pegá el Client Secret (Secreto)", "warning"); return; }
    setShopifyBusy(true);
    // 1) Guardamos las creds del merchant en Firestore
    const d = await apiPost("shopify", { shop, client_id: shopifyClientId.trim(), client_secret: shopifyClientSecret.trim() }, { action: "save-creds" });
    if (d?.error) {
      setShopifyBusy(false);
      toast("Error: " + d.error, "error", 6000);
      return;
    }
    // 2) oauth-start (autenticado) devuelve la URL de consent de Shopify.
    const o = await apiGet("shopify", { action: "oauth-start" });
    if (!o?.url) { setShopifyBusy(false); toast("Error: " + (o?.error || "no se pudo iniciar OAuth"), "error", 6000); return; }
    window.location.href = o.url;
  }

  async function disconnectShopify() {
    const ok = await appConfirm("Se borra el token de acceso; las suscripciones siguen en MP pero no se van a generar órdenes hasta reconectar.", { title:"¿Desconectar Shopify?", danger:true, okLabel:"Desconectar" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-shopify" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Shopify desconectado", "warning"); onChange?.(); }
  }

  async function connectMPOauth() {
    const d = await apiPost("merchant", {}, { action: "mp-oauth-start" });
    if (d?.url) window.location.href = d.url;
    else toast("Error: " + (d?.error || "OAuth MP no disponible"), "error");
  }

  async function disconnectMP() {
    const ok = await appConfirm("Se borra el token de nuestra base. Las suscripciones siguen cobrándose en MP, pero no vamos a poder procesarlas hasta reconectar.", { title:"¿Desconectar Mercado Pago?", danger:true, okLabel:"Desconectar" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-mp" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Mercado Pago desconectado", "warning"); onChange?.(); }
  }

  async function connectMP() {
    const token = await appPrompt("Lo conseguís en mercadopago.com.ar/developers → tu cuenta → Credenciales.", "", { title:"Pegá tu Access Token de Mercado Pago (Producción o TEST)", placeholder:"APP_USR-… o TEST-…", okLabel:"Guardar" });
    if (!token?.trim()) return;
    const d = await apiPatch("merchant", { access_token: token.trim() }, { action: "save-mp-token" });
    if (d?.error) toast("Error: " + d.error, "error", 6000);
    else { toast("Mercado Pago conectado", "success"); onChange?.(); }
  }

  async function connectMeta() {
    const pixel = await appPrompt("Meta Business Suite → Administrador de eventos → tu pixel → arriba, 'Copiar identificador'.", merchant?.meta_pixel_id || "", { title:"Pegá tu Pixel ID de Meta (solo números)", placeholder:"1234567890", okLabel:"Siguiente" });
    if (pixel === null) return;
    const token = await appPrompt("En el mismo pixel → Configuración → API de conversiones → Generar token de acceso.", "", { title:"Ahora pegá el token de la API de Conversiones (CAPI)", placeholder:"EAAG…", okLabel:"Conectar" });
    if (token === null) return;
    const d = await apiPatch("merchant", { meta_pixel_id: pixel.trim(), meta_capi_token: token.trim() }, { action: "save-meta" });
    if (d?.error) toast("Error: " + d.error, "error", 6000);
    else { toast("Meta conectado", "success"); onChange?.(); }
  }

  async function disconnectMeta() {
    const ok = await appConfirm("Las suscripciones dejarán de reportarse a Meta.", { title:"¿Desconectar Meta?", danger:true, okLabel:"Desconectar" });
    if (!ok) return;
    const d = await apiPatch("merchant", { meta_pixel_id: "", meta_capi_token: "" }, { action: "save-meta" });
    if (d?.error) toast("Error: " + d.error, "error");
    else { toast("Meta desconectado", "warning"); onChange?.(); }
  }
  const metaOk = Boolean(merchant?.meta_connected);

  // ── Klaviyo: recupero de carritos + eventos de suscripción (reemplaza a la
  // secuencia propia de mails de abandono, retirada 2026-09-13).
  const klaviyoOk = Boolean(merchant?.klaviyo_connected);
  const [klaviyoKey, setKlaviyoKey] = useState("");
  const [klaviyoBusy, setKlaviyoBusy] = useState("");
  const [klaviyoEdit, setKlaviyoEdit] = useState(false);
  async function connectKlaviyo() {
    const key = klaviyoKey.trim();
    if (!key.startsWith("pk_")) { toast("Tiene que ser una Private API Key (empieza con pk_)", "warning"); return; }
    setKlaviyoBusy("save");
    const d = await apiPost("merchant", { api_key: key }, { action: "save-klaviyo" });
    setKlaviyoBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    setKlaviyoKey(""); setKlaviyoEdit(false);
    toast(`Klaviyo conectado${d.klaviyo_org ? ` (${d.klaviyo_org})` : ""}`, "success");
    onChange?.();
  }
  async function testKlaviyo() {
    setKlaviyoBusy("test");
    const d = await apiPost("merchant", {}, { action: "klaviyo-test" });
    setKlaviyoBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    toast(`Evento "Checkout Started" de prueba enviado a ${d.to}. Buscalo en Klaviyo → Profiles → tu mail (puede tardar 1 min).`, "success", 9000);
  }
  async function disconnectKlaviyo() {
    const ok = await appConfirm("Dejamos de mandar eventos a Klaviyo. Tus flujos y perfiles allá quedan como están.", { title:"¿Desconectar Klaviyo?", danger:true, okLabel:"Desconectar" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-klaviyo" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Klaviyo desconectado", "warning"); onChange?.(); }
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
  const klaviyoKeyForm = (
    <div style={{ marginTop: klaviyoOk ? 12 : 0 }}>
      <Field T={T} label={<>Private API Key <a href="https://www.klaviyo.com/settings/account/api-keys" target="_blank" rel="noreferrer" style={{ color:T.accent, fontWeight:DS.w.regular, textTransform:"none", marginLeft:6 }}>¿dónde la consigo? →</a></>}>
        <input type="password" value={klaviyoKey} onChange={e=>setKlaviyoKey(e.target.value)} placeholder="pk_…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }}/>
      </Field>
      <Hint T={T}>Creá una clave <strong>privada</strong> con permisos <strong>Accounts: Read</strong>, <strong>Events: Write</strong> y <strong>Profiles: Write</strong>. La validamos contra tu cuenta y nunca la mostramos de vuelta.</Hint>
      <Btn T={T} variant="solid" onClick={connectKlaviyo} disabled={!klaviyoKey.trim().startsWith("pk_") || klaviyoBusy==="save"} style={{ width:"100%" }}>
        {klaviyoBusy==="save" ? <><Spinner size={13}/> Validando…</> : (klaviyoOk ? "Guardar nueva clave" : "Conectar Klaviyo →")}
      </Btn>
    </div>
  );

  return (
    <div>
      {!embedded && <PageHeader T={T} title="Integraciones" subtitle="Conectá tu tienda Shopify y tu cuenta de Mercado Pago. Necesitás ambas para crear planes y cobrar suscripciones."/>}

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:DS.sp.lg, alignItems:"start" }}>
        <IntegrationCard T={T} icon="🛍️" title="Shopify" ok={shopifyOk} statusLabel={shopifyOk ? merchant.shopify_shop : "Sin conectar"} description="Para leer productos, crear órdenes y manejar clientes.">
          {shopifyOk && !reconnect ? (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Btn T={T} variant="secondary" onClick={()=>{setShopifyShop(merchant?.shopify_shop || "");setShopifyClientId("");setShopifyClientSecret("");setReconnect(true);}}>Reconectar</Btn>
              <Btn T={T} variant="ghost" onClick={disconnectShopify} style={{ color:T.textSm }}>Desconectar</Btn>
            </div>
          ) : (
            <>
              <Field T={T} label="Dominio Shopify">
                <input value={shopifyShop} onChange={e=>setShopifyShop(e.target.value)} placeholder="mitienda.myshopify.com" style={iS}/>
              </Field>
              {envApp ? (
                <Hint T={T}>Con el dominio alcanza: te llevamos a Shopify a autorizar la app de Recurrentes y volvés conectado.</Hint>
              ) : (
                <>
                  <Field T={T} label={<>Client ID <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(ID de cliente)</span></>}>
                    <input value={shopifyClientId} onChange={e=>setShopifyClientId(e.target.value)} placeholder="b4ca9a62b9e9bf0bd79deba391333d22" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }}/>
                  </Field>
                  <Field T={T} label={<>Client Secret <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(Secreto)</span></>}>
                    <input type="password" value={shopifyClientSecret} onChange={e=>setShopifyClientSecret(e.target.value)} placeholder="•••••••••••••••••••••••••••••••••" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }}/>
                  </Field>
                </>
              )}
              <Btn T={T} variant="solid" onClick={connectShopify} disabled={!shopifyFormOk||shopifyBusy} style={{ width:"100%" }}>
                {shopifyBusy ? <><Spinner size={13}/> Conectando…</> : "Conectar tienda →"}
              </Btn>
              {reconnect && <Btn T={T} variant="ghost" onClick={()=>setReconnect(false)} style={{ width:"100%", color:T.textSm }}>Cancelar</Btn>}
              {!envApp && (
                <>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    <button onClick={()=>setShopifyGuide(g=>!g)} style={{ flex:1, background:"transparent", border:"none", color:T.textSm, padding:"8px 4px 0", fontSize:DS.font.sm, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>
                      {shopifyGuide ? "Ocultar guía" : "¿Cómo creo la app y obtengo Client ID + Secret? (5 min)"}
                    </button>
                    <ShopifyAppTip T={T}/>
                  </div>
                  {shopifyGuide && <ShopifyGuide/>}
                </>
              )}
            </>
          )}
        </IntegrationCard>

        <IntegrationCard T={T} icon="💳" title="Mercado Pago" ok={mpOk} statusLabel={mpOk ? `Conectada${merchant.mp_email ? ` · ${merchant.mp_email}` : ""}` : "Sin conectar"} description="Para crear suscripciones y procesar cobros recurrentes.">
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {merchant?.mp_oauth_available && (
              <Btn T={T} variant={mpOk ? "secondary" : "solid"} onClick={connectMPOauth}>
                {mpOk ? "Reconectar con OAuth" : "Conectar Mercado Pago (OAuth)"}
              </Btn>
            )}
            <Btn T={T} variant={(mpOk || merchant?.mp_oauth_available) ? "secondary" : "solid"} onClick={connectMP}>
              {mpOk ? "Cambiar Access Token" : "Pegar Access Token"}
            </Btn>
            <MpTokenTip T={T}/>
            {mpOk && <Btn T={T} variant="ghost" onClick={disconnectMP} style={{ color:T.textSm }}>Desconectar</Btn>}
          </div>
          {mpOk && (merchant?.mp_email || merchant?.mp_method) && (
            <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:10 }}>
              {merchant.mp_email && <>Cuenta: <strong style={{ color:T.textMd }}>{merchant.mp_email}</strong>{merchant.mp_method ? " · " : ""}</>}
              {merchant.mp_method && <>Método: {merchant.mp_method === "oauth" ? "OAuth" : "token pegado"}</>}
            </div>
          )}
        </IntegrationCard>
      </div>

      {shopifyOk && mpOk && (
        <Callout T={T} tone="success" title="✓ Todo listo" style={{ marginTop:DS.sp["2xl"] }} right={<a href="#/dashboard/planes" style={{ color:T.accent, fontWeight:DS.w.bold, fontSize:DS.font.sm, textDecoration:"none" }}>Ir a Planes →</a>}>
          Ahora andá a <strong style={{ color:T.text }}>Planes</strong> y creá tu primer plan de suscripción a partir de un producto Shopify.
        </Callout>
      )}

      {/* Meta Ads (opcional): reportar la primera venta de cada suscripción a Meta */}
      <div style={{ marginTop:DS.sp["2xl"] }}>
        <IntegrationCard T={T} icon="📊" title="Meta Ads" optional ok={metaOk} statusLabel={metaOk ? `Conectado (pixel ${merchant.meta_pixel_id})` : "Sin conectar"}
          description={<>Reportá a Meta la <strong style={{ color:T.text }}>primera venta</strong> de cada suscripción (por la API de Conversiones, server-side) para que tus campañas la cuenten y optimicen mejor. <strong style={{ color:T.text }}>Las renovaciones NO se reportan</strong> — así no inflás la atribución. Necesitás tu <strong style={{ color:T.text }}>Pixel ID</strong> + el <strong style={{ color:T.text }}>token de la API de Conversiones</strong>.</>}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn T={T} variant={metaOk ? "secondary" : "solid"} onClick={connectMeta}>{metaOk ? "Cambiar credenciales" : "Conectar Meta"}</Btn>
            {metaOk && <Btn T={T} variant="ghost" onClick={disconnectMeta} style={{ color:T.textSm }}>Desconectar</Btn>}
          </div>
        </IntegrationCard>
      </div>

      {/* Klaviyo (opcional): recupero de carritos + eventos de suscripción */}
      <div style={{ marginTop:DS.sp["2xl"] }}>
        <IntegrationCard T={T} icon="✉️" title="Klaviyo" optional ok={klaviyoOk} statusLabel={klaviyoOk ? `Conectado${merchant?.klaviyo_org ? ` (${merchant.klaviyo_org})` : ""}` : "Sin conectar"}
          description={<>Cuando alguien deja su mail en el checkout de suscripción, lo mandamos a tu Klaviyo como <strong style={{ color:T.text }}>"Checkout Started"</strong> (igual que un carrito de Shopify) con el link para retomar. Cuando paga, la orden entra a Shopify y Klaviyo la ve como <strong style={{ color:T.text }}>"Placed Order"</strong>, así que tu flujo de carrito abandonado se corta solo.</>}>
          {klaviyoOk && merchant?.klaviyo_last_error && (
            <Callout T={T} tone="danger" title="Último error de Klaviyo" style={{ marginBottom:12 }}>
              {merchant.klaviyo_last_error}{merchant.klaviyo_last_error_at ? ` · ${fmtDateShort(merchant.klaviyo_last_error_at)}` : ""}. Si la clave fue revocada, cargá una nueva.
            </Callout>
          )}
          {klaviyoOk ? (
            <>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <Btn T={T} variant="secondary" onClick={testKlaviyo} disabled={!!klaviyoBusy}>{klaviyoBusy==="test" ? <><Spinner size={12} color={T.textMd}/> Enviando…</> : "Probar evento"}</Btn>
                <Btn T={T} variant="secondary" onClick={()=>setKlaviyoEdit(e=>!e)}>{klaviyoEdit ? "Cancelar" : "Cambiar clave"}</Btn>
                <Btn T={T} variant="ghost" onClick={disconnectKlaviyo} style={{ color:T.textSm }}>Desconectar</Btn>
              </div>
              {merchant?.klaviyo_connected_at && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:10 }}>Conectado el {fmtDateShort(merchant.klaviyo_connected_at)}</div>}
              {klaviyoEdit && klaviyoKeyForm}
              <CheckLine T={T} checked={Boolean(merchant?.klaviyo_send_orders)} onChange={toggleKlaviyoOrders} style={{ color:T.text, marginTop:14 }}>
                Mi Klaviyo NO está conectado a Shopify: enviar también "Placed Order" en cada cobro
              </CheckLine>
            </>
          ) : klaviyoKeyForm}

          <Callout T={T} tone="warning" title="Importante: una vez, 2 minutos" style={{ marginTop:14 }}>
            Klaviyo separa las métricas por integración: <strong style={{ color:T.text }}>"Checkout Started" de Shopify</strong> y <strong style={{ color:T.text }}>"Checkout Started" de Recurrentes (API)</strong> son dos métricas distintas. Para que tu flujo de abandono también atienda los checkouts de suscripción, cloná tu flujo y ponéle como disparador "Checkout Started" (API), o agregale una segunda entrada.
          </Callout>

          <Divider T={T}/>
          <SectionTitle T={T} sub="Usalos como disparador de flujos. Los nombres son exactos.">Eventos que enviamos</SectionTitle>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {KLAVIYO_EVENTS.map(([name, desc]) => (
              <div key={name} style={{ display:"flex", gap:10, alignItems:"baseline", flexWrap:"wrap", fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>
                <code style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:6, padding:"1px 7px", whiteSpace:"nowrap" }}>{name}</code>
                <span>{desc}</span>
              </div>
            ))}
            <div style={{ display:"flex", gap:10, alignItems:"baseline", flexWrap:"wrap", fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>
              <code style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.textMd, background:T.surface, border:`1px dashed ${T.border}`, borderRadius:6, padding:"1px 7px", whiteSpace:"nowrap" }}>Placed Order</code>
              <span>opcional (tilde de arriba): solo si tu Klaviyo no recibe las órdenes desde Shopify.</span>
            </div>
          </div>
          <Hint T={T} style={{ marginTop:12, marginBottom:0 }}>
            En cada evento también actualizamos el perfil con <code style={{ fontFamily:MONO }}>recurrentes_status</code> (checkout_started · subscriber · payment_failed · paused · cancelled), <code style={{ fontFamily:MONO }}>recurrentes_subscriber</code>, <code style={{ fontFamily:MONO }}>recurrentes_plan</code>, <code style={{ fontFamily:MONO }}>recurrentes_frequency_days</code>, <code style={{ fontFamily:MONO }}>recurrentes_next_charge_at</code>, <code style={{ fontFamily:MONO }}>recurrentes_first_charge_at</code> y <code style={{ fontFamily:MONO }}>recurrentes_orders_count</code>, para segmentar campañas.
          </Hint>
        </IntegrationCard>
      </div>

    </div>
  );
}

// ─── Guía Shopify Custom App ────────────────────────────────────

export function ShopifyGuide() {
  const T = useT();
  const redirectUrl = `${window.location.origin}/api/shopify/oauth-callback`;
  const code = { background:T.bg, border:`1px solid ${T.borderL}`, padding:"1px 6px", borderRadius:4, fontSize:DS.font.sm, fontFamily:MONO, color:T.text };
  const block = { marginTop:6, padding:"8px 10px", background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:DS.r.sm, fontFamily:MONO, fontSize:DS.font.xs, lineHeight:1.7, wordBreak:"break-all", color:T.accent };
  return (
    <div className="gh-accordion" style={{ marginTop:12, padding:"14px 16px", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, fontSize:DS.font.md, color:T.textMd, lineHeight:1.55 }}>
      <SectionTitle T={T}>Cómo obtener Client ID + Secret (5 min)</SectionTitle>
      <ol style={{ paddingLeft:18, margin:0, display:"flex", flexDirection:"column", gap:8 }}>
        <li>Entrá a <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" style={{ color:T.accent }}>dev.shopify.com/dashboard</a> con tu cuenta de Shopify.</li>
        <li>Click <strong>"Crear app"</strong> arriba a la derecha. Nombre: <code style={code}>Recurrentes</code>. Click crear.</li>
        <li>En la sidebar izquierda de la app → <strong>"Configuración"</strong>.</li>
        <li>Buscá la sección <strong>"URLs"</strong> (o "URL de redirección") y agregá esta como Redirect URL permitida:
          <div style={block}>{redirectUrl}</div>
        </li>
        <li>Buscá la sección <strong>"Acceso a la API"</strong> o <strong>"Scopes / Permisos"</strong> y marcá:
          <div style={{ ...block, color:T.textMd }}>
            ✅ read_products<br/>
            ✅ write_orders<br/>
            ✅ read_orders<br/>
            ✅ read_customers<br/>
            ✅ write_customers<br/>
            ✅ write_draft_orders
          </div>
        </li>
        <li>Guardá los cambios.</li>
        <li>Volvé a Configuración → sección <strong>"Credenciales"</strong>. Vas a ver:
          <ul style={{ marginTop:4, marginBottom:0, paddingLeft:14 }}>
            <li><strong>ID de cliente</strong> — copialo y pegalo arriba en "Client ID"</li>
            <li><strong>Secreto</strong> — click el ojo 👁 para verlo, copialo y pegalo arriba en "Client Secret"</li>
          </ul>
        </li>
        <li>Pegá también tu dominio <code style={code}>tu-tienda.myshopify.com</code> y click <strong>"Conectar tienda →"</strong>.</li>
        <li>Te redirige a Shopify para autorizar la app → click <strong>"Instalar app"</strong>. Volvés a Recurrentes y ya está conectada ✓.</li>
      </ol>
      <Callout T={T} tone="warning" style={{ marginTop:12 }}>
        <strong>Importante</strong>: la Redirect URL que ponés en tu app de Shopify <strong>tiene que matchear exactamente</strong> la que te mostramos arriba (incluyendo http vs https). Si está mal, el OAuth falla.
      </Callout>
    </div>
  );
}
