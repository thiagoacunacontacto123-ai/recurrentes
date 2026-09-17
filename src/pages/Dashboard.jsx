import React, { useState, useEffect, useMemo, useCallback } from "react";
import { apiGet, apiPost, setActiveMerchantId } from "../lib/api.js";
import { StoreTransferredScreen } from "./Transfer.jsx";
import { auth } from "../lib/firebase.js";
import { sendEmailVerification } from "firebase/auth";
import { DS, useTheme, useT } from "../ui/theme.js";
import { Card, Btn, Spinner, PageHeader, Callout, ToastContainer, PageView, toast, ErrorBoundary, Modal, AppLoader } from "../ui/components.jsx";
import { Sidebar, AppTopbar, MobileBottomNav, NewStoreModal, ManageStoreModal, NAV, TAB_ALIASES } from "../ui/Shell.jsx";
import SettingsPage from "./Settings.jsx";
import OnboardingWizard from "./Onboarding.jsx";
import GuidePage from "./Guide.jsx";
import { useOnboarding, OnboardingContext } from "../lib/onboarding.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { BillingBanner } from "./Billing.jsx";
import { PlanLimitBar, PlanLimitModal, PlanBlockedView, isBlocked, showsPlanLimit } from "./PlanLimit.jsx";
import { HomeTab } from "./Home.jsx";
import { PlansTab, WidgetTab } from "./Plans.jsx";
import { SubscriptionsPage } from "./Subscriptions.jsx";
import { ChargesPage } from "./Charges.jsx";
import { AnalyticsPage } from "./Analytics.jsx";
import { RetentionPage } from "./Retention.jsx";
import { CustomerPortalPage } from "./CustomerPortal.jsx";
import { FlowsPage } from "./Flows.jsx";
import { OwnerInfoModal } from "./OwnerInfo.jsx";
import { readPendingSignup, clearPendingSignup } from "../lib/signup.js";
import { mpOauthReturnToast } from "../lib/mpOauth.js";
import { AdminPage, AdminViewBanner } from "./Admin.jsx";
import StoreStep2Modal from "./ShopifyStep2.jsx";

// Resuelve un id de tab (nuevo o viejo) a { tab, config?, query? }.
function resolveTab(id) {
  if (NAV.some(n => n.id === id)) return { tab: id };
  const a = TAB_ALIASES[id];
  if (!a) return { tab: "analiticas" };
  if (a.config) return { tab: "configuracion", config: a.config };
  return { tab: a.tab, query: a.query };
}

// Tab inicial desde el hash: #/dashboard/<tab> · #/config/<sección>.
function tabFromHash() {
  try {
    const h = window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
    if (h[0] === "config") return "configuracion";
    if (h[0] === "admin") return "admin"; // #/admin (super-admin; si no es admin, el guard de navList lo manda a Inicio)
    const r = resolveTab(h[1]);
    if (r.config) { window.history.replaceState(null, "", `${window.location.pathname}#/config/${r.config}${window.location.hash.includes("?") ? "?" + window.location.hash.split("?")[1] : ""}`); return "configuracion"; }
    if (r.query && h[1] !== r.tab) window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/${r.tab}?${r.query}`);
    return r.tab;
  } catch (_) { return "analiticas"; }
}

// Dashboard del comerciante — shell (sidebar + switcher de tiendas + topbar)
// con las 7 secciones + Configuración. Cada pantalla vive en su archivo.
export default function Dashboard({ user, onLogout }) {
  const { T, darkMode, setDarkMode } = useTheme();
  const [tab, setTab] = useState(tabFromHash);
  const [merchant, setMerchant] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unverified, setUnverified] = useState(false);
  const [noStore, setNoStore] = useState(false); // su tienda principal fue transferida y no tiene otra activa
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("rec_sidebar_collapsed") === "1"; } catch (_) { return false; } });
  const [newStoreOpen, setNewStoreOpen] = useState(false);
  const [manageStoreId, setManageStoreId] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  // Paso 2 obligatorio después de conectar Shopify: pegar el snippet y verificarlo.
  const [step2Channel, setStep2Channel] = useState(null); // "shopify" | null (Tiendanube no tiene paso 2: el widget se carga solo)
  const setShopifyStep2 = (on) => setStep2Channel(on ? "shopify" : null);
  // Tiendanube vuelve del OAuth a Integraciones, que nos manda a #/dashboard/planes?store_step2=tiendanube.
  useEffect(() => {
    const check = () => {
      const q = new URLSearchParams((window.location.hash || "").split("?")[1] || "");
      const ch = q.get("store_step2");
      if (ch === "shopify") {
        try { window.history.replaceState(null, "", window.location.pathname + "#/dashboard/planes"); } catch (_) {}
        setTab("planes");
        setStep2Channel(ch);
        reloadMerchant();
      }
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
    // eslint-disable-next-line
  }, []);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("rec_sidebar_collapsed", collapsed ? "1" : "0"); } catch (_) {} }, [collapsed]);

  // Tab ↔ hash (#/dashboard/<tab>[?query]). Acepta ids viejos (suscriptores,
  // carritos, actividad, plan, guia, integraciones) y los redirige.
  const goTab = useCallback((id, query) => {
    const r = resolveTab(id);
    setTab(r.tab);
    const q = query || r.query;
    try {
      if (r.config) window.location.hash = `#/config/${r.config}`;
      else window.history.replaceState(null, "", window.location.pathname + (r.tab === "admin" ? "#/admin" : "#/dashboard/" + r.tab) + (q ? `?${q}` : ""));
    } catch (_) {}
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) {}
  }, []);
  const goConfig = useCallback((sec) => { setTab("configuracion"); try { setTimeout(() => { window.location.hash = `#/config/${sec}`; }, 0); } catch (_) {} }, []);

  // Si alguien navega por hash a un tab viejo (#/dashboard/suscriptores) o a
  // #/config/…, seguimos el cambio.
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace(/^#\/?/, "").split("?")[0].split("/");
      if (h[0] === "config") { setTab("configuracion"); return; }
      if (h[0] === "admin") { setTab("admin"); return; }
      if (h[0] !== "dashboard") return;
      const r = resolveTab(h[1]);
      const qs = window.location.hash.includes("?") ? "?" + window.location.hash.split("?")[1] : "";
      if (r.config) { window.history.replaceState(null, "", `${window.location.pathname}#/config/${r.config}${qs}`); setTab("configuracion"); return; }
      if (h[1] !== r.tab) window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/${r.tab}${r.query ? "?" + r.query : ""}`);
      setTab(r.tab);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function reloadWorkspace() {
    try {
      const w = await apiGet("merchant", { action: "workspace" });
      if (w && Array.isArray(w.stores)) setWorkspace(w);
    } catch (_) {}
  }

  const [loadError, setLoadError] = useState(null);
  async function reloadMerchant() {
    setLoadError(null);
    try {
      const d = await apiGet("merchant");
      // Cuenta nueva sin verificar el mail → el backend responde 403 email_unverified.
      if (d?.code === "email_unverified") { setUnverified(true); setLoading(false); return; }
      setUnverified(false);
      if (d?.reason === "store_transferred") { setNoStore(true); setLoading(false); return; }
      if (d?.error && !d?.merchant) {
        setLoadError(d.error);
        setMerchant(null);
        setLoading(false);
        return;
      }
      setMerchant(d?.merchant || null);
      setLoading(false);
      // "Ver como" (admin): el workspace sería el del admin, no el del comercio.
      if (!d?.merchant?.admin_view) reloadWorkspace();
    } catch (e) {
      setLoadError(e?.message || "No se pudo cargar tu cuenta");
      setLoading(false);
    }
  }

  useEffect(() => { reloadMerchant(); }, []);

  // Datos del paso 1 del registro (nombre, WhatsApp, email de contacto): se mandan una vez
  // que hay sesión. Si faltan y no hay nada pendiente, se piden con OwnerInfoModal.
  const [ownerAsk, setOwnerAsk] = useState(false);
  useEffect(() => {
    if (!merchant) return;
    const pending = readPendingSignup();
    if (pending && merchant.owner_info_missing) {
      apiPost("merchant", { owner_name: pending.owner_name, owner_whatsapp: pending.owner_whatsapp, contact_email: pending.contact_email }, { action: "save-owner" })
        .then(d => { if (d?.ok) { clearPendingSignup(); setMerchant(m => m ? { ...m, owner_info_missing: false, owner_name: d.owner_name, owner_whatsapp: d.owner_whatsapp, contact_email: d.contact_email } : m); } else setOwnerAsk(true); })
        .catch(() => setOwnerAsk(true));
    } else {
      if (pending) clearPendingSignup();
      setOwnerAsk(!!merchant.owner_info_missing);
    }
    // eslint-disable-next-line
  }, [merchant?.id, merchant?.owner_info_missing]);

  // Volvimos de OAuth (MP: ?mp=ok|error · Shopify: ?shopify_ok=1) → aviso + Configuración → Integraciones.
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const mp = q.get("mp");
    const shopifyOk = q.get("shopify_ok");
    if (!mp && !shopifyOk) return;
    const mpToast = mpOauthReturnToast(q); // textos en src/lib/mpOauth.js
    if (mpToast) toast(mpToast.text, mpToast.tone, mpToast.ms);
    else if (shopifyOk) toast("Shopify conectado · falta el paso 2", "success");
    if (shopifyOk) {
      // No lo soltamos en Integraciones: Paso 2 (snippet) sí o sí.
      window.history.replaceState(null, "", window.location.pathname + "#/dashboard/planes");
      setTab("planes");
      setShopifyStep2(true);
    } else {
      window.history.replaceState(null, "", window.location.pathname + "#/config/integraciones");
      setTab("configuracion");
    }
    reloadMerchant();
  }, []);

  // Si volvimos de OAuth Shopify (callback nos puso ?shopify_pending=<state>),
  // reclamamos el token para asociarlo al uid actual y limpiamos la URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const pending = q.get("shopify_pending");
    if (!pending) return;
    apiPost("shopify/claim-pending", { state: pending }).then(d => {
      if (d?.ok) {
        window.history.replaceState(null, "", window.location.pathname + "#/dashboard/planes");
        setTab("planes");
        setShopifyStep2(true);
        reloadMerchant();
      } else if (d?.error) {
        toast("Error conectando Shopify: " + d.error, "error", 7000);
      }
    });
  }, []);

  // ── Multi-tienda ──────────────────────────────────────────────────────
  const merchantId = merchant?.id || workspace?.active_merchant_id || user?.uid || null;
  const effectiveWorkspace = useMemo(() => {
    if (workspace?.stores?.length) return { ...workspace, active_merchant_id: merchantId || workspace.active_merchant_id };
    if (!merchant) return null;
    return { stores: [{ id: merchantId, name: merchant.store_name || merchant.shopify_shop || "Mi tienda", color: merchant.store_color || "#10b981", role: merchant.role || "owner", is_primary: merchant.is_primary !== false, shopify_shop: merchant.shopify_shop || null }], active_merchant_id: merchantId };
  }, [workspace, merchant, merchantId]);

  async function switchStore(mid) {
    if (!mid || mid === merchantId) return;
    try {
      const r = await apiPost("merchant", { merchant_id: mid }, { action: "store-activate" });
      if (r?.error) throw new Error(r.error);
    } catch (e) { toast("No se pudo cambiar de tienda: " + e.message, "error"); return; }
    setActiveMerchantId(user.uid, mid);
    window.location.reload();
  }
  async function createStore({ name, color }) {
    try {
      const r = await apiPost("merchant", { name, color }, { action: "store-create" });
      if (!r?.ok || r?.error) throw new Error(r?.error || "No se pudo crear la tienda");
      const mid = r.store?.id;
      if (mid) { try { await apiPost("merchant", { merchant_id: mid }, { action: "store-activate" }); } catch (_) {} setActiveMerchantId(user.uid, mid); }
      toast("Tienda creada", "success");
      setTimeout(() => window.location.reload(), 300);
      return true;
    } catch (e) { toast(e.message, "error"); return false; }
  }
  async function saveStore(store) {
    try {
      const r = await apiPost("merchant", { merchant_id: store.id, name: store.name, color: store.color, ...(store.photo !== undefined ? { photo: store.photo } : {}) }, { action: "store-rename" });
      if (r?.error) throw new Error(r.error);
      toast("Tienda actualizada", "success");
      await reloadWorkspace();
      if (store.id === merchantId) reloadMerchant();
      return true;
    } catch (e) { toast(e.message, "error"); return false; }
  }
  async function deleteStore(mid) {
    try {
      const r = await apiPost("merchant", { merchant_id: mid }, { action: "store-delete" });
      if (r?.error) throw new Error(r.error);
      toast("Tienda eliminada", "warning");
      if (mid === merchantId) { setActiveMerchantId(user.uid, null); setTimeout(() => window.location.reload(), 300); }
      else await reloadWorkspace();
      return true;
    } catch (e) { toast(e.message, "error"); return false; }
  }
  const manageStore = manageStoreId ? (effectiveWorkspace?.stores || []).find(s => s.id === manageStoreId) : null;

  // Perfil del negocio: qué hace falta conectar depende de qué vende y dónde
  // (servicios / link de suscripción no necesitan tienda). Histórico: Shopify + MP.
  const profile = useMemo(() => merchantProfile(merchant), [merchant]);
  // Bloqueado (pasó los 15 sin pagar): se cierran las secciones donde CONFIGURA
  // la venta. Cobros, Suscripciones, Analíticas y Configuración quedan abiertas
  // en lectura, así puede seguir viendo su negocio y pagar (Thiago, 17-sept).
  const PLAN_BLOCKED_TABS = ["planes", "widget", "retencion", "flujos", "portal"];
  const blockedTab = (id) => isBlocked(merchant?.billing) && PLAN_BLOCKED_TABS.includes(id);
  const integrationsReady = profile.ready;
  const shop = merchant?.shopify_shop || null;
  const devMode = merchant?.dev_mode === true;

  // ── Plan de acción / onboarding (src/lib/onboarding.js) ──────────────
  const onb = useOnboarding({ merchant, user, goTab });
  const onbCtx = useMemo(() => ({ ...onb, openWizard: () => setWizardOpen(true) }), [onb]);
  // El paso a paso NO se abre solo al entrar: quedaba viejo y cada sección ya
  // avisa por su cuenta qué falta configurar antes de dejarte usarla. Sigue
  // disponible a pedido, desde la Guía y desde el botón de Inicio.
  const closeWizard = useCallback(() => { setWizardOpen(false); onb.markSeen(); }, [onb.markSeen]);
  const pendientesSidebar = useMemo(() => onb.pendingSteps.filter(s => !s.locked).map(s => ({ key: s.id, n: s.n, label: s.title, onClick: () => onb.goStep(s) })), [onb.pendingSteps, onb.goStep]);

  // Miembros del equipo con secciones limitadas: el menú muestra solo lo habilitado.
  // "Admin" (adminOnly) solo si GET /api/merchant devolvió is_admin (ADMIN_EMAILS, validado en el server).
  const isAdmin = merchant?.is_admin === true;
  const navList = useMemo(() => {
    const secs = merchant?.role === "member" && merchant?.member_secciones && Object.keys(merchant.member_secciones).length ? merchant.member_secciones : null;
    // Widget acompaña al permiso de Planes (los permisos guardados antes no lo conocen).
    const base = secs ? NAV.filter(n => n.id === "analiticas" || secs[n.id] === true || (n.id === "widget" && secs.planes === true) || n.adminOnly) : NAV;
    return base.filter(n => !n.adminOnly || isAdmin);
  }, [merchant?.role, merchant?.member_secciones, isAdmin]);
  useEffect(() => { if (loading) return; if (!navList.some(n => n.id === tab)) goTab("analiticas"); }, [navList, tab, goTab, loading]);

  if (unverified) return <><VerifyEmailScreen user={user} onLogout={onLogout} onRetry={reloadMerchant}/><ToastContainer T={T}/></>;
  if (noStore) return <><StoreTransferredScreen user={user} onLogout={onLogout}/><ToastContainer T={T}/></>;

  const navItem = NAV.find(n => n.id === tab) || NAV[0];
  const shellProps = { T, nav: navList, activeTab: tab, onTab: goTab, user, merchant, workspace: effectiveWorkspace, onSwitchStore: switchStore, onCreateStore: () => setNewStoreOpen(true), onManageStore: (id) => setManageStoreId(id), darkMode, setDarkMode, onLogout, alerts: { onboarding: onb.ready ? onb.pending : 0 }, pendientes: pendientesSidebar, onVerPlan: () => goTab("analiticas") };
  const needs = (title) => <NeedsIntegrations title={title} missing={profile.missing} onGo={() => goConfig("integraciones")}/>;

  return (
    <OnboardingContext.Provider value={onbCtx}>
    <div style={{minHeight:"100vh",display:"flex",background:T.bg,color:T.text,fontFamily:"'Inter',system-ui,sans-serif"}}>
      {step2Channel && merchant && <StoreStep2Modal channel={step2Channel} merchant={merchant} onDone={() => { setStep2Channel(null); reloadMerchant(); goTab("planes"); }}/>}
      {wizardOpen && merchant && <OnboardingWizard T={T} DS={DS} merchant={merchant} onb={onb} goTab={goTab} onClose={closeWizard} onMerchantChange={reloadMerchant}/>}
      <Sidebar {...shellProps} collapsed={collapsed} setCollapsed={setCollapsed}/>

      <div className="main-content" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
        <AppTopbar T={T} section={navItem.label} sectionId={navItem.id} icon={navItem.icon} onHelp={() => setGuideOpen(true)}>
          {effectiveWorkspace?.stores?.length > 1 && (
            <span className="hide-mobile" style={{fontSize:11,color:T.textSm,whiteSpace:"nowrap",padding:"0 4px"}}>
              Tienda: <strong style={{color:T.textMd}}>{(effectiveWorkspace.stores.find(s=>s.id===effectiveWorkspace.active_merchant_id)||effectiveWorkspace.stores[0]).name}</strong>
            </span>
          )}
        </AppTopbar>

        {!loading && merchant?.admin_view && <AdminViewBanner T={T} merchant={merchant}/>}
        {/* Límite del plan gratis: la barra roja manda y silencia el aviso amarillo
            (dos avisos apilados no se leen; el rojo es el que importa). */}
        {!loading && merchant?.billing && <PlanLimitBar T={T} billing={merchant.billing} onGo={()=>goConfig("facturacion")}/>}
        {!loading && merchant?.billing && !showsPlanLimit(merchant.billing) && <BillingBanner T={T} billing={merchant.billing} onGo={()=>goConfig("facturacion")}/>}

        <PageView pageKey={tab} T={T}>
          <ErrorBoundary T={T}>
            <main style={{padding:"28px 32px 48px",maxWidth:1200,width:"100%"}} className="pad-mobile">
              {loading ? (
                <AppLoader T={T} minHeight="60vh"/>
              ) : loadError ? (
                <div style={{maxWidth:520,margin:"40px auto",textAlign:"center"}}>
                  <div style={{fontSize:17,fontWeight:700,color:T.text,marginBottom:8}}>No pudimos cargar tu cuenta</div>
                  <div style={{fontSize:13,color:T.textSm,marginBottom:18}}>{String(loadError)}</div>
                  <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                    <button onClick={()=>{setLoading(true);reloadMerchant();}} style={{background:T.accentSolid,color:"#fff",border:"none",borderRadius:10,padding:"10px 16px",fontWeight:600,cursor:"pointer"}}>Reintentar</button>
                    <button onClick={()=>{setActiveMerchantId(user?.uid,null);window.location.reload();}} style={{background:"transparent",color:T.textMd,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 16px",fontWeight:600,cursor:"pointer"}}>Volver a mi tienda principal</button>
                  </div>
                </div>
              ) : blockedTab(tab) ? (
                <PlanBlockedView T={T} billing={merchant.billing} title={navItem.label} onGo={()=>goConfig("facturacion")} onGoCobros={()=>goTab("cobros")}/>
              ) : tab === "suscripciones" ? (
                integrationsReady ? <SubscriptionsPage devMode={devMode} shop={shop}/> : needs("Suscripciones")
              ) : tab === "cobros" ? (
                integrationsReady ? <ChargesPage shop={shop}/> : needs("Cobros")
              ) : tab === "planes" ? (
                integrationsReady ? <PlansTab merchant={merchant} onMerchantChange={reloadMerchant}/> : needs("Planes")
              ) : tab === "widget" ? (
                integrationsReady ? <WidgetTab merchant={merchant} onMerchantChange={reloadMerchant}/> : needs("Widget")
              ) : tab === "retencion" ? (
                integrationsReady ? <RetentionPage merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab}/> : needs("Retención")
              ) : tab === "flujos" ? (
                <FlowsPage merchant={merchant}/>
              ) : tab === "portal" ? (
                <CustomerPortalPage merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab}/>
              ) : tab === "analiticas" ? (
                // Pantalla de entrada. Con la tienda conectada, los datos; si todavía
                // falta conectar algo, la puesta en marcha (el viejo Inicio).
                integrationsReady ? <AnalyticsPage merchant={merchant}/> : <HomeTab merchant={merchant} onGo={goTab} onGoConfig={goConfig} onOpenGuide={()=>setWizardOpen(true)}/>
              ) : tab === "admin" ? (
                isAdmin ? <AdminPage/> : null
              ) : tab === "configuracion" ? (
                <SettingsPage T={T} DS={DS} user={user} merchant={merchant} workspace={effectiveWorkspace} reloadMerchant={reloadMerchant} toast={toast} goTab={goTab}/>
              ) : (
                <RedirectTo onGo={() => goTab(tab)}/>
              )}
            </main>
          </ErrorBoundary>
        </PageView>
      </div>

      <MobileBottomNav {...shellProps}/>
      {newStoreOpen && <NewStoreModal T={T} onClose={()=>setNewStoreOpen(false)} onCreate={createStore}/>}
      {manageStore && <ManageStoreModal T={T} store={manageStore} totalStores={effectiveWorkspace?.stores?.length||1} onClose={()=>setManageStoreId(null)} onSave={saveStore} onDelete={deleteStore}/>}
      {guideOpen && (
        <Modal T={T} open onClose={()=>setGuideOpen(false)} width={980} title="Guía de Recurrentes" subtitle="Paso a paso para dejar todo andando. También la tenés en Configuración → Ayuda."
          footer={<Btn T={T} variant="secondary" size="sm" onClick={()=>{ setGuideOpen(false); goConfig("ayuda"); }}>Abrir en Configuración → Ayuda</Btn>}>
          <GuidePage merchant={merchant} goTab={(id)=>{ setGuideOpen(false); goTab(id); }} embedded/>
        </Modal>
      )}
      {!loading && merchant?.billing && !merchant?.admin_view && <PlanLimitModal T={T} billing={merchant.billing} merchantId={merchant.id} onGo={()=>goConfig("facturacion")}/>}
      {ownerAsk && merchant && <OwnerInfoModal T={T} user={user} merchant={merchant} onSaved={(d) => { setOwnerAsk(false); setMerchant(m => m ? { ...m, owner_info_missing: false, owner_name: d.owner_name, owner_whatsapp: d.owner_whatsapp, contact_email: d.contact_email } : m); }}/>}
      <ToastContainer T={T}/>
    </div>
    </OnboardingContext.Provider>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

// Tab desconocido (id viejo que llegó por estado): redirige al destino nuevo.
function RedirectTo({ onGo }) {
  useEffect(() => { onGo?.(); /* eslint-disable-next-line */ }, []);
  return null;
}

function NeedsIntegrations({ title, missing = [], onGo }) {
  const T = useT();
  const what = missing.length ? missing.join(" y ") : "tus integraciones";
  return (
    <div>
      <PageHeader T={T} title={title}/>
      <Callout T={T} tone="warning" title="Falta conectar integraciones" right={<Btn T={T} variant="solid" size="sm" onClick={onGo}>Ir a Integraciones →</Btn>}>
        Necesitás conectar {what} antes de usar esta sección.
      </Callout>
    </div>
  );
}

// ─── Pantalla "Verificá tu email" (403 email_unverified del backend) ────────
function VerifyEmailScreen({ user, onLogout, onRetry }) {
  const T = useT();
  const [sent, setSent] = React.useState(() => { try { return sessionStorage.getItem("rec_verify_sent") === "1"; } catch (_) { return false; } });
  const [busy, setBusy] = React.useState(false);
  async function resend() {
    setBusy(true);
    try { await sendEmailVerification(auth.currentUser); setSent(true); try { sessionStorage.setItem("rec_verify_sent", "1"); } catch (_) {} toast("Mail de verificación reenviado", "success"); }
    catch (e) { toast("No se pudo reenviar: " + (e.message || e.code), "error", 6000); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true);
    try { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); await onRetry?.(); }
    finally { setBusy(false); }
  }
  return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", padding:24, background:T.bg, color:T.text, fontFamily:"'Inter',system-ui,sans-serif" }}>
      <Card T={T} padding="xl" className="gh-card-enter" style={{ maxWidth:460, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:40, marginBottom:12 }}>📬</div>
        <div style={{ fontSize:DS.font["2xl"], fontWeight:DS.w.black, margin:"0 0 8px", letterSpacing:-0.4 }}>Verificá tu email</div>
        <p style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.55, margin:"0 0 18px" }}>
          {sent ? "Te mandamos un mail para verificar tu cuenta a " : "Para operar necesitamos verificar "}<strong style={{ color:T.text }}>{user?.email}</strong>. Abrí el link del mail y después tocá "Ya verifiqué".
        </p>
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
          <Btn T={T} variant="solid" onClick={check} disabled={busy}>{busy ? <Spinner size={13}/> : "Ya verifiqué"}</Btn>
          <Btn T={T} variant="secondary" onClick={resend} disabled={busy}>Reenviar mail</Btn>
          <Btn T={T} variant="ghost" onClick={onLogout} style={{ color:T.textSm }}>Salir</Btn>
        </div>
      </Card>
    </div>
  );
}
