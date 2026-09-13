import React, { useState, useEffect, useMemo, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, apiSend, setActiveMerchantId } from "../lib/api.js";
import { auth } from "../lib/firebase.js";
import { sendEmailVerification } from "firebase/auth";
import { DS, useTheme } from "../ui/theme.js";
import { ToastContainer, PageView, toast, ErrorBoundary } from "../ui/components.jsx";
import { Sidebar, AppTopbar, MobileBottomNav, NewStoreModal, ManageStoreModal, NAV } from "../ui/Shell.jsx";
import SettingsPage from "./Settings.jsx";
import OnboardingWizard, { PlanDeAccionCard, OnbEmpty, PackTip, MpTokenTip, ShopifyAppTip } from "./Onboarding.jsx";
import GuidePage from "./Guide.jsx";
import { useOnboarding, OnboardingContext, TIPS } from "../lib/onboarding.js";
import PacksEditor, { packsFromPlan, serializePacks, validatePacks, pricingModeOf } from "./PacksEditor.jsx";
import WidgetDesigner, { DevHelpCard } from "./WidgetDesigner.jsx";
import { PlanPage, TrialBanner, PlanWall } from "./Billing.jsx";

// Dashboard del comerciante — shell de Growith (sidebar + switcher de tiendas +
// topbar) con branding verde. La lógica de cada tab vive más abajo, intacta.
export default function Dashboard({ user, onLogout }) {
  const { T, darkMode, setDarkMode } = useTheme();
  const [tab, setTab] = useState(() => {
    // #/dashboard/<tab> · #/config/<sección> abre Configuración (Settings lee la sección del hash).
    try { const h = window.location.hash.replace(/^#\/?/, "").split("?")[0]; if (h.split("/")[0] === "config") return "configuracion"; const t = h.split("/")[1]; return NAV.some(n => n.id === t) ? t : "inicio"; } catch (_) { return "inicio"; }
  });
  const [merchant, setMerchant] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unverified, setUnverified] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("rec_sidebar_collapsed") === "1"; } catch (_) { return false; } });
  const [newStoreOpen, setNewStoreOpen] = useState(false);
  const [manageStoreId, setManageStoreId] = useState(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => { try { localStorage.setItem("rec_sidebar_collapsed", collapsed ? "1" : "0"); } catch (_) {} }, [collapsed]);

  // Tab ↔ hash (#/dashboard/<tab>) para que el back del navegador y los links
  // internos funcionen. No se rompe el manejo de ?mp=ok / ?shopify_ok de abajo.
  const goTab = useCallback((id) => {
    setTab(id);
    try { window.history.replaceState(null, "", window.location.pathname + "#/dashboard/" + id); } catch (_) {}
    try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) {}
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
      if (d?.error && !d?.merchant) {
        // 403/500: no es una cuenta vacía, es un error. Mostramos reintentar.
        setLoadError(d.error);
        setMerchant(null);
        setLoading(false);
        return;
      }
      setMerchant(d?.merchant || null);
      setLoading(false);
      reloadWorkspace();
    } catch (e) {
      setLoadError(e?.message || "No se pudo cargar tu cuenta");
      setLoading(false);
    }
  }

  useEffect(() => { reloadMerchant(); }, []);

  // Volvimos de OAuth (MP: ?mp=ok|error · Shopify: ?shopify_ok=1) → aviso + limpiar URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const mp = q.get("mp");
    const shopifyOk = q.get("shopify_ok");
    if (!mp && !shopifyOk) return;
    if (mp === "ok") toast("Mercado Pago conectado", "success");
    else if (mp === "error") toast("No se pudo conectar Mercado Pago: " + (q.get("msg") || "error desconocido"), "error", 7000);
    else if (shopifyOk) toast("Shopify conectado", "success");
    window.history.replaceState(null, "", window.location.pathname + "#/dashboard/integraciones");
    setTab("integraciones");
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
        window.history.replaceState(null, "", window.location.pathname + "#/dashboard/integraciones");
        setTab("integraciones");
        reloadMerchant();
      } else if (d?.error) {
        toast("Error conectando Shopify: " + d.error, "error", 7000);
      }
    });
  }, []);

  // ── Multi-tienda ──────────────────────────────────────────────────────
  const merchantId = merchant?.id || workspace?.active_merchant_id || user?.uid || null;
  // Sin workspace (backend viejo / error) → una sola tienda armada desde el merchant.
  const effectiveWorkspace = useMemo(() => {
    // La tienda activa que se muestra es SIEMPRE la que estamos consultando
    // (merchantId), no la que el perfil tenga guardada desde otro dispositivo.
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

  const integrationsReady = Boolean(merchant?.shopify_token && merchant?.mp_access_token);

  // ── Plan de acción / onboarding (src/lib/onboarding.js) ──────────────
  // 8 pasos calculados desde merchant + /api/plans + flags manuales. El
  // wizard de bienvenida se abre solo la primera vez que entra a una tienda
  // con pasos pendientes; después queda en Inicio → "Ver guía".
  const onb = useOnboarding({ merchant, user, goTab });
  const onbCtx = useMemo(() => ({ ...onb, openWizard: () => setWizardOpen(true) }), [onb]);
  useEffect(() => {
    if (!merchant || !onb.ready || onb.seen) return;
    if (onb.pending > 0) setWizardOpen(true); else onb.markSeen();
    // eslint-disable-next-line
  }, [merchant?.id, onb.ready]);
  const closeWizard = useCallback(() => { setWizardOpen(false); onb.markSeen(); }, [onb.markSeen]);
  const pendientesSidebar = useMemo(() => onb.pendingSteps.filter(s => !s.locked).map(s => ({ key: s.id, n: s.n, label: s.title, onClick: () => onb.goStep(s) })), [onb.pendingSteps, onb.goStep]);

  if (unverified) return <><VerifyEmailScreen user={user} onLogout={onLogout} onRetry={reloadMerchant}/><ToastContainer T={T}/></>;

  const navItem = NAV.find(n => n.id === tab) || NAV[0];
  const shellProps = { T, nav: NAV, activeTab: tab, onTab: goTab, user, merchant, workspace: effectiveWorkspace, onSwitchStore: switchStore, onCreateStore: () => setNewStoreOpen(true), onManageStore: (id) => setManageStoreId(id), darkMode, setDarkMode, onLogout, alerts: { onboarding: onb.ready ? onb.pending : 0 }, pendientes: pendientesSidebar, onVerPlan: () => goTab("inicio") };

  // Prueba de 7 días vencida (plan trial): el panel queda detrás del wall de
  // planes, con el sidebar visible. Solo el dashboard — widget, checkout,
  // webhooks y cron siguen operando normalmente.
  if (merchant?.billing?.locked) return (
    <div style={{minHeight:"100vh",display:"flex",background:T.bg,color:T.text,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <Sidebar {...shellProps} collapsed={collapsed} setCollapsed={setCollapsed}/>
      <div className="main-content" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
        <AppTopbar T={T} section="Plan" sectionId="plan" icon={NAV.find(n=>n.id==="plan")?.icon}/>
        <PlanWall T={T} DS={DS} merchant={merchant} reloadMerchant={reloadMerchant} onLogout={onLogout}/>
      </div>
      <MobileBottomNav {...shellProps}/>
      <ToastContainer T={T}/>
    </div>
  );

  return (
    <OnboardingContext.Provider value={onbCtx}>
    <div style={{minHeight:"100vh",display:"flex",background:T.bg,color:T.text,fontFamily:"'Inter',system-ui,sans-serif"}}>
      {wizardOpen && merchant && <OnboardingWizard T={T} DS={DS} merchant={merchant} onb={onb} goTab={goTab} onClose={closeWizard}/>}
      <Sidebar {...shellProps} collapsed={collapsed} setCollapsed={setCollapsed}/>

      <div className="main-content" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
        <AppTopbar T={T} section={navItem.label} sectionId={navItem.id} icon={navItem.icon}>
          {effectiveWorkspace?.stores?.length > 1 && (
            <span className="hide-mobile" style={{fontSize:11,color:T.textSm,whiteSpace:"nowrap",padding:"0 4px"}}>
              Tienda: <strong style={{color:T.textMd}}>{(effectiveWorkspace.stores.find(s=>s.id===effectiveWorkspace.active_merchant_id)||effectiveWorkspace.stores[0]).name}</strong>
            </span>
          )}
        </AppTopbar>

        {!loading && merchant?.billing && tab !== "plan" && <TrialBanner T={T} billing={merchant.billing} onGo={()=>goTab("plan")}/>}

        <PageView pageKey={tab} T={T}>
          <ErrorBoundary T={T}>
            <main style={{padding:"28px 32px 48px",maxWidth:1200,width:"100%"}} className="pad-mobile">
              {loading ? (
                <div style={{color:T.textSm,fontSize:14}}>Cargando…</div>
              ) : loadError ? (
                <div style={{maxWidth:520,margin:"40px auto",textAlign:"center"}}>
                  <div style={{fontSize:17,fontWeight:700,color:T.text,marginBottom:8}}>No pudimos cargar tu cuenta</div>
                  <div style={{fontSize:13,color:T.textSm,marginBottom:18}}>{String(loadError)}</div>
                  <div style={{display:"flex",gap:10,justifyContent:"center",flexWrap:"wrap"}}>
                    <button onClick={()=>{setLoading(true);reloadMerchant();}} style={{background:T.accentSolid,color:"#fff",border:"none",borderRadius:10,padding:"10px 16px",fontWeight:600,cursor:"pointer"}}>Reintentar</button>
                    <button onClick={()=>{setActiveMerchantId(user?.uid,null);window.location.reload();}} style={{background:"transparent",color:T.textMd,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 16px",fontWeight:600,cursor:"pointer"}}>Volver a mi tienda principal</button>
                  </div>
                </div>
              ) : tab === "plan" ? (
                <PlanPage T={T} DS={DS} merchant={merchant} reloadMerchant={reloadMerchant}/>
              ) : tab === "inicio" ? (
                <HomeTab onGoSubscribers={()=>goTab("suscriptores")} onGoCarts={()=>goTab("carritos")} onOpenGuide={()=>setWizardOpen(true)}/>
              ) : tab === "guia" ? (
                <GuidePage merchant={merchant} goTab={goTab}/>
              ) : tab === "integraciones" ? (
                <IntegrationsTab merchant={merchant} onChange={reloadMerchant}/>
              ) : tab === "planes" ? (
                integrationsReady
                  ? <PlansTab merchant={merchant} onMerchantChange={reloadMerchant}/>
                  : <NeedsIntegrations title="Planes" onGo={()=>goTab("integraciones")}/>
              ) : tab === "suscriptores" ? (
                integrationsReady
                  ? <SubscribersTab mode="active" devMode={merchant?.dev_mode === true}/>
                  : <NeedsIntegrations title="Suscriptores activos" onGo={()=>goTab("integraciones")}/>
              ) : tab === "carritos" ? (
                integrationsReady
                  ? <SubscribersTab mode="carts" devMode={merchant?.dev_mode === true}/>
                  : <NeedsIntegrations title="Carritos de suscripción" onGo={()=>goTab("integraciones")}/>
              ) : tab === "abandonados" ? (
                integrationsReady
                  ? <AbandonedTab/>
                  : <NeedsIntegrations title="Abandonados" onGo={()=>goTab("integraciones")}/>
              ) : tab === "actividad" ? (
                integrationsReady
                  ? <ActivityTab/>
                  : <NeedsIntegrations title="Actividad" onGo={()=>goTab("integraciones")}/>
              ) : tab === "cobros" ? (
                integrationsReady
                  ? <ChargesTab/>
                  : <NeedsIntegrations title="Cobros" onGo={()=>goTab("integraciones")}/>
              ) : tab === "configuracion" ? (
                <SettingsPage T={T} DS={DS} user={user} merchant={merchant} workspace={effectiveWorkspace} reloadMerchant={reloadMerchant} toast={toast} goTab={goTab}/>
              ) : null}
            </main>
          </ErrorBoundary>
        </PageView>
      </div>

      <MobileBottomNav {...shellProps}/>
      {newStoreOpen && <NewStoreModal T={T} onClose={()=>setNewStoreOpen(false)} onCreate={createStore}/>}
      {manageStore && <ManageStoreModal T={T} store={manageStore} totalStores={effectiveWorkspace?.stores?.length||1} onClose={()=>setManageStoreId(null)} onSave={saveStore} onDelete={deleteStore}/>}
      <ToastContainer T={T}/>
    </div>
    </OnboardingContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tabs del dashboard — capa visual portada al DS de Growith (acento verde).
// La lógica (llamadas a la API, estados, textos funcionales) es la misma;
// cada tab toma el tema con useT() y usa los componentes de ui/components.
// ═══════════════════════════════════════════════════════════════════
import { useT } from "../ui/theme.js";
import * as UI from "../ui/components.jsx";
const {
  Card, KPI, StatCard, Btn, BtnPrimary, BtnSecondary, BtnDanger, BtnSolid, DSEmpty, DSBadge, Modal, Field, InputStyle,
  AsyncButton, Spinner, DSTable, CellStack, PageHeader, SectionTitle, CardHeader, SubTabs, Callout, Hint, Loading, CheckLine,
  Divider, appConfirm, appAlert, appPrompt,
} = UI;

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtDateShort = (iso) => { try { return new Date(iso).toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }); } catch (_) { return "—"; } };
const fmtDateOnly = (iso) => { try { return new Date(iso).toLocaleDateString("es-AR"); } catch (_) { return "—"; } };
const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString("es-AR"); } catch (_) { return "—"; } };

// Estado de una suscripción → color del DS.
function subStatusMeta(T, status, orderCount = 0) {
  const cancelledLabel = orderCount > 0 ? `Cancelada · ${orderCount} cobro${orderCount > 1 ? "s" : ""} OK` : "Cancelada";
  return ({
    active:         { label:"Activa",        color:T.green },
    paused:         { label:"Pausada",       color:T.yellow },
    pending:        { label:"Pendiente",     color:T.blue },
    cancelled:      { label:cancelledLabel,  color:orderCount > 0 ? T.green : T.textSm },
    payment_failed: { label:"Pago falló",    color:T.red },
  })[status] || { label: status || "—", color: T.textSm };
}

function StatusBadge({ status, orderCount = 0, size = "sm" }) {
  const T = useT();
  const m = subStatusMeta(T, status, orderCount);
  return <DSBadge T={T} color={m.color} size={size}>{m.label}</DSBadge>;
}

// Título de bloque dentro de un formulario/modal (con línea arriba).
function FormSection({ T, title, right, children, first }) {
  return (
    <div style={{ marginTop: first ? 0 : 16, paddingTop: first ? 0 : 14, borderTop: first ? "none" : `1px solid ${T.borderL}` }}>
      {(title || right) && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Panel gris (surface) para agrupar datos de solo lectura.
function SurfaceBox({ T, title, right, children, style = {} }) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px", ...style }}>
      {(title || right) && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:8 }}>
          <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.bold, letterSpacing:0.5 }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Tab: Inicio (KPIs) ─────────────────────────────────────────

function HomeTab({ onGoSubscribers, onGoCarts, onOpenGuide }) {
  const T = useT();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    const d = await apiGet("stats");
    if (d?.error) setErr(d.error);
    else { setStats(d); setErr(""); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const s = stats || {};
  const totals = s.totals || {};
  const revenue = s.revenue || {};
  const growth = s.growth || {};
  const deltaPct = revenue.delta_pct;
  const churn = growth.churn_rate_pct || 0;
  const cartsTotal = (totals.pending||0) + (totals.cancelled||0) + (totals.payment_failed||0);

  return (
    <div>
      <PageHeader T={T} title="Inicio" subtitle="Resumen del negocio recurrente."
        right={<>
          <Btn T={T} variant="secondary" size="sm" onClick={onOpenGuide}>Ver guía</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>
        </>}/>

      {/* Plan de acción (8 pasos) — se oculta solo cuando está todo listo y el usuario lo cierra */}
      <PlanDeAccionCard onOpenGuide={onOpenGuide}/>

      {err && !loading && (
        <Callout T={T} tone="danger" title="No pudimos cargar las métricas" style={{ marginBottom:16 }} right={<Btn T={T} variant="secondary" size="sm" onClick={load}>Reintentar</Btn>}>{err}</Callout>
      )}

      {/* KPIs principales — basados SOLO en active/paused. Los carritos
          (pending/cancelled/payment_failed) no entran acá. */}
      <div className="kpi-grid gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp.md }}>
        <KPI T={T} label="MRR" value={fmtARS(s.mrr)} sub="ingresos mensuales recurrentes" accent color={T.accent} loading={loading}/>
        <KPI T={T} label="Suscriptores activos" value={totals.active||0} sub={`${totals.paused||0} pausados`} color={T.text} loading={loading} onClick={onGoSubscribers}/>
        <KPI T={T} label="Cobrado este mes" value={fmtARS(revenue.this_month?.amount)} color={T.text} loading={loading}
          sub={<span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>{revenue.this_month?.count||0} cobros
            {typeof deltaPct === "number" && <DSBadge T={T} color={deltaPct >= 0 ? T.green : T.red} size="sm">{deltaPct >= 0 ? "↑" : "↓"} {Math.abs(deltaPct)}%</DSBadge>}
          </span>}/>
        <KPI T={T} label="Churn 30d" value={`${churn}%`} sub={`${growth.cancelled_30d||0} cancelaciones`} color={churn > 5 ? T.red : T.text} loading={loading}/>
      </div>

      {/* Funnel: solo nuevos activos. */}
      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp["2xl"] }}>
        <KPI T={T} compact label="Nuevos últimos 7d" value={growth.new_7d||0} color={T.green} loading={loading}/>
        <KPI T={T} compact label="Nuevos últimos 30d" value={growth.new_30d||0} color={T.green} loading={loading}/>
      </div>

      {/* Próximos cobros */}
      <Card T={T} style={{ marginBottom:DS.sp.lg }}>
        <SectionTitle T={T} sub={<span style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text }}>Cobros que MP va a procesar</span>}
          right={s.upcoming_charges?.length > 0 && <Btn T={T} variant="secondary" size="sm" onClick={onGoSubscribers}>Ver suscriptores →</Btn>}>
          Próximos 7 días
        </SectionTitle>
        {loading ? <Loading T={T} text="Cargando cobros…"/> : s.upcoming_charges?.length > 0 ? (
          <div>
            {s.upcoming_charges.map((c, i) => (
              <div key={c.subscriber_id} className="gh-list-item" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, gap:10, fontSize:DS.font.base }}>
                <CellStack T={T} main={c.customer_name || c.customer_email} sub={c.product_title}/>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <div style={{ fontWeight:DS.w.bold, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</div>
                  <div style={{ fontSize:DS.font.xs, color:T.textSm, marginTop:2 }}>{c.date ? new Date(c.date).toLocaleDateString("es-AR", { day:"2-digit", month:"short" }) : "—"}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize:DS.font.md, color:T.textSm, padding:"18px 0 6px", textAlign:"center" }}>No hay cobros programados en los próximos 7 días.</div>
        )}
      </Card>

      {/* Snapshot — SOLO subs vivas (active + paused). */}
      <Card T={T}>
        <SectionTitle T={T} right={cartsTotal > 0 && <Btn T={T} variant="secondary" size="sm" onClick={onGoCarts}>Ver {cartsTotal} carritos →</Btn>}>Suscripciones operativas</SectionTitle>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          <DSBadge T={T} color={T.green}>● Activos · {totals.active||0}</DSBadge>
          <DSBadge T={T} color={T.yellow}>● Pausados · {totals.paused||0}</DSBadge>
          <DSBadge T={T} color={T.textSm}>● Cancelados · {totals.cancelled||0}</DSBadge>
        </div>
      </Card>
    </div>
  );
}

// (FirstStepsTab reemplazado por PlanDeAccionCard — src/pages/Onboarding.jsx)

// ─── Tab: Integraciones ─────────────────────────────────────────

function IntegrationCard({ T, icon, title, ok, statusLabel, description, children, optional }) {
  return (
    <Card T={T} style={{ borderColor: ok ? T.accentSolid + "66" : T.border, boxShadow: ok ? `0 4px 24px ${T.accentSolid}14, 0 1px 3px rgba(0,0,0,0.07)` : undefined }}>
      <CardHeader T={T} icon={icon} title={<>{title}{optional && <span style={{ fontSize:DS.font.sm, fontWeight:DS.w.medium, color:T.textSm, marginLeft:6 }}>(opcional)</span>}</>}
        badge={<DSBadge T={T} color={ok ? T.green : T.textSm} size="sm">{ok ? "✓ " : ""}{statusLabel}</DSBadge>}
        sub={description}/>
      {children}
    </Card>
  );
}

function IntegrationsTab({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const shopifyOk = Boolean(merchant?.shopify_token);
  const mpOk = Boolean(merchant?.mp_access_token);
  const [shopifyShop, setShopifyShop] = useState("");
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
      <PageHeader T={T} title="Integraciones" subtitle="Conectá tu tienda Shopify y tu cuenta de Mercado Pago. Necesitás ambas para crear planes y cobrar suscripciones."/>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:DS.sp.lg, alignItems:"start" }}>
        <IntegrationCard T={T} icon="🛍️" title="Shopify" ok={shopifyOk} statusLabel={shopifyOk ? merchant.shopify_shop : "Sin conectar"} description="Para leer productos, crear órdenes y manejar clientes.">
          {shopifyOk ? (
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Btn T={T} variant="secondary" onClick={()=>{setShopifyShop("");setShopifyClientId("");setShopifyClientSecret("");onChange?.();}}>Reconectar</Btn>
              <Btn T={T} variant="ghost" onClick={disconnectShopify} style={{ color:T.textSm }}>Desconectar</Btn>
            </div>
          ) : (
            <>
              <Field T={T} label="Dominio Shopify">
                <input value={shopifyShop} onChange={e=>setShopifyShop(e.target.value)} placeholder="mitienda.myshopify.com" style={iS}/>
              </Field>
              {envApp && <Hint T={T}>Recurrentes ya tiene su app de Shopify: con el dominio alcanza. Client ID/Secret son opcionales (solo si querés usar una app propia).</Hint>}
              <Field T={T} label={<>Client ID <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(ID de cliente{envApp ? ", opcional" : ""})</span></>}>
                <input value={shopifyClientId} onChange={e=>setShopifyClientId(e.target.value)} placeholder="b4ca9a62b9e9bf0bd79deba391333d22" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }}/>
              </Field>
              <Field T={T} label={<>Client Secret <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(Secreto)</span></>}>
                <input type="password" value={shopifyClientSecret} onChange={e=>setShopifyClientSecret(e.target.value)} placeholder="•••••••••••••••••••••••••••••••••" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }}/>
              </Field>
              <Btn T={T} variant="solid" onClick={connectShopify} disabled={!shopifyFormOk||shopifyBusy} style={{ width:"100%" }}>
                {shopifyBusy ? <><Spinner size={13}/> Conectando…</> : "Conectar tienda →"}
              </Btn>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <button onClick={()=>setShopifyGuide(g=>!g)} style={{ flex:1, background:"transparent", border:"none", color:T.textSm, padding:"8px 4px 0", fontSize:DS.font.sm, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>
                  {shopifyGuide ? "Ocultar guía" : "¿Cómo creo la app y obtengo Client ID + Secret? (5 min)"}
                </button>
                <ShopifyAppTip T={T}/>
              </div>
              {shopifyGuide && <ShopifyGuide/>}
            </>
          )}
        </IntegrationCard>

        <IntegrationCard T={T} icon="💳" title="Mercado Pago" ok={mpOk} statusLabel={mpOk ? `Conectada (${merchant.mp_user_id || "MP"})` : "Sin conectar"} description="Para crear suscripciones y procesar cobros recurrentes.">
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
          {mpOk && merchant?.mp_method && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:10 }}>Método: {merchant.mp_method === "oauth" ? "OAuth" : "token pegado"}</div>}
        </IntegrationCard>
      </div>

      {shopifyOk && mpOk && (
        <Callout T={T} tone="success" title="✓ Todo listo" style={{ marginTop:DS.sp["2xl"] }}>
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

      <div style={{ marginTop:DS.sp["2xl"] }}><WidgetSettingsCard merchant={merchant} onChange={onChange}/></div>
      <div style={{ marginTop:DS.sp["2xl"] }}><OperationalSettingsCard merchant={merchant} onChange={onChange}/></div>
    </div>
  );
}

// ─── Settings UX del widget (orden + default + color + textos) ──
function WidgetSettingsCard({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const [order, setOrder]                 = React.useState(merchant?.widget_mode_order   || "sub_first");
  const [def, setDef]                     = React.useState(merchant?.widget_mode_default || "sub");
  const [color, setColor]                 = React.useState(merchant?.widget_color || "#10b981");
  const [subTitle, setSubTitle]           = React.useState(merchant?.widget_sub_title || "Suscripción");
  const [subSubtitle, setSubSubtitle]     = React.useState(merchant?.widget_sub_subtitle || "");
  const [onceTitle, setOnceTitle]         = React.useState(merchant?.widget_once_title || "Compra única");
  const [onceSubtitle, setOnceSubtitle]   = React.useState(merchant?.widget_once_subtitle || "Comprá una vez al precio normal.");
  const [disclaimerText, setDisclaimerText] = React.useState(merchant?.widget_disclaimer_text || "");
  const [saving, setSaving]               = React.useState(false);
  const [saved, setSaved]                 = React.useState(false);

  React.useEffect(() => {
    setOrder(merchant?.widget_mode_order || "sub_first");
    setDef(merchant?.widget_mode_default || "sub");
    setColor(merchant?.widget_color || "#10b981");
    setSubTitle(merchant?.widget_sub_title || "Suscripción");
    setSubSubtitle(merchant?.widget_sub_subtitle || "");
    setOnceTitle(merchant?.widget_once_title || "Compra única");
    setOnceSubtitle(merchant?.widget_once_subtitle || "Comprá una vez al precio normal.");
    setDisclaimerText(merchant?.widget_disclaimer_text || "");
  }, [merchant?.widget_mode_order, merchant?.widget_mode_default, merchant?.widget_color, merchant?.widget_sub_title, merchant?.widget_sub_subtitle, merchant?.widget_once_title, merchant?.widget_once_subtitle, merchant?.widget_disclaimer_text]);

  async function save() {
    setSaving(true);
    const d = await apiPatch("merchant", {
      widget_mode_order: order,
      widget_mode_default: def,
      widget_color: color,
      widget_sub_title: subTitle,
      widget_sub_subtitle: subSubtitle,
      widget_once_title: onceTitle,
      widget_once_subtitle: onceSubtitle,
      widget_disclaimer_text: disclaimerText,
    }, { action: "save-widget-settings" });
    setSaving(false);
    if (d?.error) { toast("Error: " + d.error, "error", 6000); return; }
    setSaved(true);
    toast("Apariencia del widget guardada", "success");
    setTimeout(() => setSaved(false), 2200);
    onChange?.();
  }

  return (
    <Card T={T}>
      <CardHeader T={T} title="Apariencia del widget" sub="Personalizá cómo se ve el widget de suscripción en tu tienda. Aplica a todos los planes."/>
      <Callout T={T} tone="info" style={{ marginBottom:DS.sp.lg }}
        right={<a href="#/dashboard/planes?designer=1" onClick={()=>{ try { window.location.hash = "#/dashboard/planes?designer=1"; window.location.reload(); } catch (_) {} }} style={{ ...BtnSecondary(T), textDecoration:"none", padding:"6px 12px", fontSize:DS.font.sm }}>Abrir diseñador →</a>}>
        El <strong style={{ color:T.text }}>selector de packs</strong> (diseño, textos, tachado, por unidad) se configura en Planes → Diseño del selector.
      </Callout>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 14px" }}>
        <Field T={T} label="Cuál aparece primero">
          <select value={order} onChange={e=>setOrder(e.target.value)} style={iS}>
            <option value="sub_first">Suscripción primero</option>
            <option value="once_first">Compra única primero</option>
          </select>
        </Field>
        <Field T={T} label="Cuál está seleccionada por default">
          <select value={def} onChange={e=>setDef(e.target.value)} style={iS}>
            <option value="sub">Suscripción</option>
            <option value="once">Compra única</option>
          </select>
        </Field>
      </div>

      <Field T={T} label="Color principal del widget">
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{ width:46, height:38, border:`1px solid ${T.inputBorder}`, borderRadius:DS.r.md, padding:2, background:T.input, cursor:"pointer" }}/>
          <input type="text" value={color} onChange={e=>setColor(e.target.value)} style={{ ...iS, maxWidth:130, fontFamily:MONO, fontSize:DS.font.md }} placeholder="#10b981"/>
          <div style={{ flex:1, height:38, borderRadius:DS.r.md, background:`linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow:"0 2px 8px rgba(0,0,0,0.15)" }}/>
        </div>
      </Field>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 14px" }}>
        <Field T={T} label="Título del modo Suscripción (en el toggle)">
          <input type="text" value={subTitle} onChange={e=>setSubTitle(e.target.value)} style={iS} placeholder="Suscripción" maxLength={60}/>
        </Field>
        <Field T={T} label="Título del modo Compra única (en el toggle)">
          <input type="text" value={onceTitle} onChange={e=>setOnceTitle(e.target.value)} style={iS} placeholder="Compra única" maxLength={60}/>
        </Field>
      </div>

      <Field T={T} label="Subtítulo del modo Suscripción (debajo del título)">
        <input type="text" value={subSubtitle} onChange={e=>setSubSubtitle(e.target.value)} style={iS} placeholder="Recibilo cada X días. Cancelá cuando quieras." maxLength={120}/>
      </Field>
      <Hint T={T}>Dejá vacío para usar texto automático con la frecuencia de cada plan.</Hint>

      <Field T={T} label="Subtítulo del modo Compra única">
        <input type="text" value={onceSubtitle} onChange={e=>setOnceSubtitle(e.target.value)} style={iS} placeholder="Comprá una vez al precio normal." maxLength={120}/>
      </Field>

      <Field T={T} label="Texto del banner informativo (debajo del botón Suscribirme)">
        <textarea value={disclaimerText} onChange={e=>setDisclaimerText(e.target.value)} style={{ ...iS, minHeight:90, resize:"vertical", lineHeight:1.5 }} placeholder="Dejá vacío para usar el texto automático sobre cómo funciona la suscripción..." maxLength={800}/>
      </Field>
      <Hint T={T}>Texto explicativo que ve el cliente al final del widget. Dejá vacío para usar el texto default con frecuencia + crédito-only + cancelación.</Hint>

      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <Btn T={T} variant="primary" onClick={save} disabled={saving}>{saving ? <><Spinner size={12} color={T.accent}/> Guardando…</> : saved ? "✓ Guardado" : "Guardar"}</Btn>
        <span style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>Cambios visibles en la tienda en ~5 minutos (caché del widget). Forzá refresh con Cmd+Shift+R.</span>
      </div>
    </Card>
  );
}

// ─── Guía Shopify Custom App ────────────────────────────────────

function ShopifyGuide() {
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

// ─── Tab: Planes ─────────────────────────────────────────────────

function PlansTab({ merchant, onMerchantChange }) {
  const T = useT();
  const [plans, setPlans] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [embedFor, setEmbedFor] = useState(null);
  // "plans" | "designer" — el diseñador del selector de packs vive acá adentro
  // (#/dashboard/planes?designer=1 lo abre directo).
  const [view, setView] = useState(() => { try { return /designer=1/.test(window.location.hash) ? "designer" : "plans"; } catch (_) { return "plans"; } });

  async function loadAll() {
    setLoading(true);
    const [p, pr] = await Promise.all([apiGet("plans"), apiGet("shopify", { action: "products" })]);
    setPlans(p?.plans || []);
    setProducts(pr?.products || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  // Repreciar TODAS las subs activas del plan al mismo monto (PUT preapproval en MP).
  async function repricePlan(p) {
    const suggested = (p.subscription_price_ars || 0) + (p.shipping_price_ars || 0);
    const v = await appPrompt(
      `Nuevo monto TOTAL por cobro (producto + envío, 1 paquete) que MP va a cobrar a TODAS las subs activas de este plan.\n⚠ Si tenés subs con varios paquetes, repreciarlas una por una desde el detalle del suscriptor.`,
      String(suggested || ""),
      { title: `Repreciar suscriptores de "${p.product_title}"`, placeholder: "Monto en $", okLabel: "Continuar" }
    );
    if (v === null) return;
    const amount = Math.round(Number(v));
    if (!(amount > 0)) return toast("Monto inválido", "warning");
    const ok = await appConfirm(`¿Confirmás repreciar a ${fmtARS(amount)} por cobro? Aplica desde el próximo cobro.`, { title:"Repreciar suscriptores", okLabel:"Sí, repreciar" });
    if (!ok) return;
    const d = await apiPost("subscribers", { plan_id: p.id, new_amount: amount }, { action: "reprice" });
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    appAlert(`✓ Repreciadas: ${d.updated} de ${d.total}` + (d.failed?.length ? `\n✗ Fallaron ${d.failed.length}:\n` + d.failed.slice(0, 5).map(f => `· ${f.id}: ${f.error}`).join("\n") : ""), { title:"Resultado del repricing" });
  }

  async function deactivatePlan(p) {
    const ok = await appConfirm(`Queda inactivo (no se muestra en la storefront) pero los suscriptores actuales siguen cobrando.`, { title:`¿Desactivar plan "${p.product_title}"?`, okLabel:"Desactivar" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id });
    toast("Plan desactivado", "warning");
    loadAll();
  }
  async function hardDeletePlan(p) {
    const ok = await appConfirm(`Esto NO se puede deshacer. El plan se elimina de Firestore.\n\nNota: el preapproval_plan en MP queda intacto — si querés que las subs existentes paren de cobrar, cancelalas también en mercadopago.com.ar/subscriptions.`, { title:`⚠️ Borrar definitivamente el plan "${p.product_title}"`, danger:true, okLabel:"Borrar definitivamente" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id, hard: "1" });
    toast("Plan borrado", "warning");
    loadAll();
  }

  if (view === "designer") {
    return (
      <div>
        <PageHeader T={T} back="Volver a planes" onBack={()=>setView("plans")} title="Diseño del selector de packs"
          subtitle="Cómo se ve el selector 1·2·3 en la página de producto. Aplica a todos los planes en modo packs."/>
        {loading ? <Loading T={T}/> : <WidgetDesigner merchant={merchant} plans={plans} onSaved={onMerchantChange} onPlansChanged={setPlans}/>}
      </div>
    );
  }

  const iconBtn = { padding:"6px 9px", fontSize:DS.font.sm };

  return (
    <div>
      <PageHeader T={T} title="Planes de suscripción" subtitle="Convertí cualquier producto Shopify en suscripción recurrente."
        right={<>
          <PackTip T={T}/>
          <Btn T={T} variant="secondary" onClick={()=>setView("designer")}>🎨 Diseño del selector</Btn>
          <Btn T={T} variant="solid" onClick={()=>setCreating(true)}>+ Nuevo plan</Btn>
        </>}/>

      <Callout T={T} tone="warning" style={{ marginBottom:DS.sp.lg }}>
        Cambiar el precio de un plan <strong>no</strong> afecta a las suscripciones existentes (MP mantiene el monto autorizado). Usá <strong>💲 Repreciar</strong> en el plan para actualizarlas.
      </Callout>

      {loading ? (
        <Loading T={T}/>
      ) : plans.length === 0 ? (
        <DSEmpty T={T} icon="🎯" title="Todavía no creaste planes" subtitle="Un plan convierte un producto de tu Shopify en suscripción recurrente." action={<Btn T={T} variant="solid" onClick={()=>setCreating(true)}>+ Nuevo plan</Btn>}/>
      ) : (
        <div className="gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(330px, 1fr))", gap:DS.sp.lg }}>
          {plans.map(p => (
            <Card key={p.id} T={T} hoverable className="gh-card-enter" padding="md">
              <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
                {p.product_image
                  ? <img src={p.product_image} alt="" style={{ width:52, height:52, borderRadius:DS.r.lg, objectFit:"cover", border:`1px solid ${T.borderL}`, flexShrink:0 }}/>
                  : <div style={{ width:52, height:52, borderRadius:DS.r.lg, background:T.surface, border:`1px solid ${T.borderL}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>📦</div>}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.product_title}>{p.product_title}</div>
                  <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>Cada {p.frequency_days} días · {p.discount_pct||0}% OFF</div>
                  <div style={{ marginTop:6, display:"flex", gap:6, flexWrap:"wrap" }}>
                    {pricingModeOf(p) === "packs"
                      ? <span title="Recurrentes arma el selector de packs en tu tienda"><DSBadge T={T} color={T.accent} size="sm">Packs: {(p.packs||[]).map(k=>k.qty).join("·") || "—"}</DSBadge></span>
                      : <span title="El precio, la cantidad y la frecuencia salen de tu tema"><DSBadge T={T} color={T.textSm} size="sm">Precio del tema</DSBadge></span>}
                    {p.active === false && <DSBadge T={T} color={T.yellow} size="sm">Inactivo</DSBadge>}
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"10px 0", borderTop:`1px solid ${T.borderL}`, borderBottom:`1px solid ${T.borderL}` }}>
                <div>
                  <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.semibold, letterSpacing:0.4 }}>Precio sub</div>
                  <div style={{ fontSize:18, fontWeight:DS.w.black, color:T.accent, letterSpacing:-0.4, fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.subscription_price_ars)}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.semibold, letterSpacing:0.4 }}>Precio normal</div>
                  <div style={{ fontSize:DS.font.base, color:T.textMd, textDecoration:"line-through", fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.base_price_ars)}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>setEditing(p)} style={{ flex:1 }}>✏️ Editar</Btn>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>setEmbedFor(p)} style={{ flex:1 }}>📋 Snippet</Btn>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>repricePlan(p)} title="Repreciar suscriptores de este plan" style={iconBtn}>💲</Btn>
                {/* Desactivar (soft): el plan deja de mostrarse pero las subs ya creadas siguen vivas. */}
                <Btn T={T} variant="secondary" size="sm" onClick={()=>deactivatePlan(p)} title="Desactivar (mantiene historial)" style={{ ...iconBtn, color:T.yellow, borderColor:T.yellow+"66" }}>⏸</Btn>
                {/* Borrar definitivamente (hard): elimina el plan de Firestore. El preapproval_plan en MP queda allá. */}
                <Btn T={T} variant="danger" size="sm" onClick={()=>hardDeletePlan(p)} title="Borrar definitivamente" style={iconBtn}>🗑</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Ayuda de los devs (misma card que al final del diseñador del selector). */}
      {!loading && <DevHelpCard merchant={merchant} context="plans"/>}

      {creating && <NewPlanModal products={products} onClose={()=>{setCreating(false); loadAll();}}/>}
      {editing && <NewPlanModal products={products} editPlan={editing} onClose={()=>{setEditing(null); loadAll();}}/>}
      {embedFor && <EmbedSnippetModal plan={embedFor} merchant={merchant} onClose={()=>setEmbedFor(null)}/>}
    </div>
  );
}

function NewPlanModal({ products, onClose, editPlan }) {
  const T = useT();
  const iS = InputStyle(T);
  const isEdit = !!editPlan;
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [frequency, setFrequency] = useState(editPlan?.frequency_days ?? 30);
  const [discount, setDiscount] = useState(editPlan?.discount_pct ?? 15);
  const [units, setUnits] = useState(editPlan?.units_per_shipment ?? 1);
  // En edición, el precio base es editable (no depende de re-elegir variante).
  const [editBasePrice, setEditBasePrice] = useState(editPlan?.base_price_ars ?? 0);
  // Envío
  const [shippingPrice, setShippingPrice] = useState(editPlan?.shipping_price_ars ?? 0);
  const [freeShipFrom, setFreeShipFrom] = useState(editPlan?.free_shipping_from_ars ?? 0);
  const [shippingName, setShippingName] = useState(editPlan?.shipping_method_name ?? "Envío a domicilio");
  // Descuentos por cantidad — array de { min_qty, discount_pct }
  const [qtyTiers, setQtyTiers] = useState(editPlan?.qty_discount_tiers ? editPlan.qty_discount_tiers.map(t=>({min_qty:t.min_qty,discount_pct:t.discount_pct})) : []);
  const [allowCustomFreq, setAllowCustomFreq] = useState(editPlan?.allow_custom_frequency === true);
  const [maxPackDisc, setMaxPackDisc] = useState(editPlan?.max_pack_discount_pct ?? 35);
  // Precios y packs (shared/bundle/SPEC.md). Plan nuevo → packs (recomendado).
  const [pricingMode, setPricingMode] = useState(isEdit ? pricingModeOf(editPlan) : "packs");
  const [packs, setPacks] = useState(() => packsFromPlan(editPlan));
  const [freqScales, setFreqScales] = useState(editPlan ? editPlan.frequency_scales_with_qty !== false : true);
  const [saving, setSaving] = useState(false);

  const product = products.find(p => p.id === productId);
  const variant = product?.variants.find(v => v.id === variantId);
  // Precio base: en edición sale del campo editable; en creación, de la variante.
  const basePrice = isEdit ? (parseFloat(editBasePrice) || 0) : (variant?.price || 0);
  const subPrice = Math.round(basePrice * (1 - discount/100));

  // Campos de packs que van en el POST/PATCH de planes.
  function packsPayload() {
    return {
      pricing_mode: pricingMode,
      packs: serializePacks(packs),
      frequency_scales_with_qty: freqScales !== false,
    };
  }

  function addTier() {
    // Default sugerido: si hay tier previo agrega +1 al min_qty y +5% al discount
    const last = qtyTiers[qtyTiers.length - 1];
    const nextMin = last ? last.min_qty + 1 : 2;
    const nextDisc = last ? Math.min(50, last.discount_pct + 5) : 5;
    setQtyTiers([...qtyTiers, { min_qty: nextMin, discount_pct: nextDisc }]);
  }
  function updateTier(i, field, val) {
    const next = [...qtyTiers];
    next[i] = { ...next[i], [field]: parseInt(val) || 0 };
    setQtyTiers(next);
  }
  function removeTier(i) {
    setQtyTiers(qtyTiers.filter((_, j) => j !== i));
  }

  async function save() {
    const tiers = qtyTiers
      .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
      .sort((a, b) => a.min_qty - b.min_qty);
    if (pricingMode === "packs") {
      const perr = validatePacks(packs);
      if (perr) return toast(perr, "warning", 5000);
    }
    if (isEdit) {
      // Editar: solo se cambian los términos del plan (precio, descuento, envío,
      // frecuencia, niveles). El producto/variante y el id de MP no se tocan.
      if (!(parseFloat(editBasePrice) > 0)) return toast("El precio base tiene que ser mayor a 0", "warning");
      setSaving(true);
      const d = await apiPatch("plans", {
        ...packsPayload(),
        frequency_days: parseInt(frequency),
        discount_pct: parseInt(discount),
        units_per_shipment: parseInt(units),
        base_price_ars: parseFloat(editBasePrice) || 0,
        shipping_price_ars: parseFloat(shippingPrice) || 0,
        free_shipping_from_ars: parseFloat(freeShipFrom) || 0,
        shipping_method_name: shippingName.trim() || "Envío a domicilio",
        qty_discount_tiers: tiers,
        allow_custom_frequency: allowCustomFreq,
        max_pack_discount_pct: parseInt(maxPackDisc) || 0,
      }, { id: editPlan.id });
      setSaving(false);
      if (d.error) toast("Error: " + d.error, "error", 6000);
      else { toast("Plan guardado", "success"); if (d.note) await appAlert(d.note, { title:"Aviso" }); onClose(); }
      return;
    }
    if (!productId || !variantId) return toast("Elegí producto y variante", "warning");
    setSaving(true);
    const d = await apiPost("plans", {
      ...packsPayload(),
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      product_title: product.title + (variant.title !== "Default Title" ? ` — ${variant.title}` : ""),
      product_image: product.image,
      frequency_days: parseInt(frequency),
      discount_pct: parseInt(discount),
      units_per_shipment: parseInt(units),
      base_price_ars: basePrice,
      shipping_price_ars: parseFloat(shippingPrice) || 0,
      free_shipping_from_ars: parseFloat(freeShipFrom) || 0,
      shipping_method_name: shippingName.trim() || "Envío a domicilio",
      qty_discount_tiers: tiers,
      allow_custom_frequency: allowCustomFreq,
      max_pack_discount_pct: parseInt(maxPackDisc) || 0,
    });
    setSaving(false);
    if (d.error) toast("Error: " + d.error, "error", 6000);
    else { toast("Plan creado", "success"); onClose(); }
  }

  const canSave = !saving && (isEdit || !!variantId);
  const smallNum = { ...iS, padding:"6px 8px", fontSize:DS.font.md, width:64 };

  return (
    <Modal T={T} open onClose={onClose} title={isEdit ? "Editar plan" : "Nuevo plan"} width={pricingMode === "packs" ? 700 : 540}
      subtitle={isEdit ? editPlan.product_title : "Convertí un producto Shopify en suscripción recurrente."}
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose}>Cancelar</Btn>
        <Btn T={T} variant="solid" onClick={save} disabled={!canSave}>{saving ? <><Spinner size={13}/> {isEdit ? "Guardando…" : "Creando…"}</> : (isEdit ? "Guardar cambios" : "Crear plan")}</Btn>
      </>}>

      {isEdit ? (
        <>
          <Field T={T} label="Producto">
            <div style={{ ...iS, display:"flex", alignItems:"center", background:T.surface, color:T.textMd, cursor:"default" }}>{editPlan.product_title}</div>
          </Field>
          <Hint T={T}>El producto/variante no se cambia acá — editás precio, descuento, envío y niveles. Para cambiar el producto, creá un plan nuevo.</Hint>
          <Field T={T} label="Precio normal ($)">
            <input type="number" min="0" value={editBasePrice} onChange={e=>setEditBasePrice(e.target.value)} style={iS} placeholder="0"/>
          </Field>
        </>
      ) : (
        <>
          <Field T={T} label="Producto Shopify" required>
            <select value={productId} onChange={e=>{setProductId(e.target.value); setVariantId("");}} style={iS}>
              <option value="">— Elegí —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          {product && (
            <Field T={T} label="Variante" required>
              <select value={variantId} onChange={e=>setVariantId(e.target.value)} style={iS}>
                <option value="">— Elegí —</option>
                {product.variants.map(v => <option key={v.id} value={v.id}>{v.title} — ${v.price.toLocaleString("es-AR")}</option>)}
              </select>
            </Field>
          )}
        </>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        <Field T={T} label="Frecuencia (días)">
          <input type="number" min="1" value={frequency} onChange={e=>setFrequency(e.target.value)} style={iS}/>
        </Field>
        <Field T={T} label="Descuento (%)">
          <input type="number" min="0" max="80" value={discount} onChange={e=>setDiscount(e.target.value)} style={iS}/>
        </Field>
      </div>

      {/* ─── Precios y packs (modo packs | tema) ──────────────────── */}
      <PacksEditor
        mode={pricingMode} onModeChange={setPricingMode}
        packs={packs} onPacksChange={setPacks}
        basePrice={basePrice} discountPct={discount} frequencyDays={frequency}
        freqScales={freqScales} onFreqScalesChange={setFreqScales}
      />

      {pricingMode === "theme" && (
        <FormSection T={T} title="Comportamiento del widget">
          <Field T={T} label="Unidades por envío (default cuando el cliente abre)">
            <input type="number" min="1" value={units} onChange={e=>setUnits(e.target.value)} style={iS}/>
          </Field>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px", alignItems:"end" }}>
            <CheckLine T={T} checked={allowCustomFreq} onChange={setAllowCustomFreq} style={{ marginBottom:14 }}>El cliente puede elegir otra frecuencia</CheckLine>
            <Field T={T} label="Tope de descuento por pack (%)">
              <input type="number" min="0" max="80" value={maxPackDisc} onChange={e=>setMaxPackDisc(e.target.value)} style={iS}/>
            </Field>
          </div>
        </FormSection>
      )}

      {/* ─── Envío ─────────────────────────────────────────────── */}
      <FormSection T={T} title="Envío">
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
          <Field T={T} label="Costo de envío ($)">
            <input type="number" min="0" value={shippingPrice} onChange={e=>setShippingPrice(e.target.value)} style={iS} placeholder="0"/>
          </Field>
          <Field T={T} label="Envío gratis desde ($)">
            <input type="number" min="0" value={freeShipFrom} onChange={e=>setFreeShipFrom(e.target.value)} style={iS} placeholder="0 = nunca gratis"/>
          </Field>
        </div>
        <Field T={T} label="Nombre del método (lo que ve el cliente en Shopify)">
          <input type="text" value={shippingName} onChange={e=>setShippingName(e.target.value)} style={iS} placeholder="Envío a domicilio"/>
        </Field>
      </FormSection>

      {/* ─── Descuentos por cantidad (solo modo tema: en packs cada pack ya tiene su precio) ── */}
      {pricingMode === "theme" && (
        <FormSection T={T} title="Descuentos por cantidad" right={<Btn T={T} variant="secondary" size="sm" onClick={addTier} type="button">+ Agregar nivel</Btn>}>
          {qtyTiers.length === 0 ? (
            <SurfaceBox T={T}><div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>Sin descuentos por cantidad. Agregá un nivel para premiar a clientes que pidan más paquetes (ej: desde 3 paquetes, 10% off extra).</div></SurfaceBox>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {qtyTiers.map((t, i) => (
                <div key={i} style={{ display:"flex", gap:8, alignItems:"center", background:T.surface, border:`1px solid ${T.borderL}`, padding:"7px 10px", borderRadius:DS.r.md, flexWrap:"wrap" }}>
                  <span style={{ fontSize:DS.font.sm, color:T.textSm, whiteSpace:"nowrap" }}>Desde</span>
                  <input type="number" min="2" max="10" value={t.min_qty} onChange={e=>updateTier(i, "min_qty", e.target.value)} style={smallNum}/>
                  <span style={{ fontSize:DS.font.sm, color:T.textSm, whiteSpace:"nowrap" }}>paquetes → descuento</span>
                  <input type="number" min="1" max="80" value={t.discount_pct} onChange={e=>updateTier(i, "discount_pct", e.target.value)} style={{ ...smallNum, width:56 }}/>
                  <span style={{ fontSize:DS.font.sm, color:T.textSm }}>%</span>
                  <button onClick={()=>removeTier(i)} type="button" title="Quitar" style={{ marginLeft:"auto", background:"transparent", border:"none", color:T.textSm, fontSize:14, cursor:"pointer", padding:"0 4px", fontFamily:"inherit" }}
                    onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
                </div>
              ))}
            </div>
          )}
        </FormSection>
      )}

      {(variant || (isEdit && basePrice > 0)) && pricingMode === "theme" && (
        <SurfaceBox T={T} style={{ marginTop:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:DS.font.md }}>
            <span style={{ color:T.textSm }}>Precio normal:</span>
            <span style={{ fontWeight:DS.w.semibold, color:T.text }}>{fmtARS(basePrice)}</span>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", fontSize:DS.font.md }}>
            <span style={{ color:T.accent, fontWeight:DS.w.bold }}>Precio suscripción base:</span>
            <span style={{ fontWeight:DS.w.black, color:T.accent, fontSize:DS.font.lg }}>{fmtARS(subPrice)} cada {frequency} días</span>
          </div>
        </SurfaceBox>
      )}
    </Modal>
  );
}

function EmbedSnippetModal({ plan, merchant, onClose }) {
  const T = useT();
  const base = window.location.origin;
  const snippet = `<script src="${base}/widget.js?merchant=${merchant.id}" defer></script>`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); toast("Snippet copiado", "success"); setTimeout(()=>setCopied(false),2000); } catch(_) { toast("No se pudo copiar — seleccioná el texto y copialo a mano", "warning"); }
  }

  return (
    <Modal T={T} open onClose={onClose} title="Código para tu tienda" subtitle={plan?.product_title} width={620}
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose}>Cerrar</Btn>
        <Btn T={T} variant="solid" onClick={copy}>{copied ? "✓ Copiado" : "📋 Copiar snippet"}</Btn>
      </>}>
      <div style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.6, marginBottom:14 }}>
        Pegá esto en el theme de tu Shopify, dentro de la página de producto (Online Store → Themes → Edit code → templates/product.json → al final del bloque buy_buttons o antes del cierre del form):
      </div>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:"12px 14px", fontSize:DS.font.md, fontFamily:MONO, overflowX:"auto", margin:0, color:T.accent, lineHeight:1.5 }}>{snippet}</pre>
      <Callout T={T} tone="info" style={{ marginTop:14 }}>
        El widget detecta automáticamente el producto que el cliente está viendo. Si hay plan activo para ese producto, muestra el toggle Compra única / Suscripción. Si no hay plan, no aparece nada.
      </Callout>
    </Modal>
  );
}

// ─── Tab: Suscriptores ──────────────────────────────────────────

function SubscribersTab({ mode = "active", devMode = false }) {
  const T = useT();
  const iS = InputStyle(T);
  // mode="active" → Tab "Suscriptores activos": solo status === "active"
  // mode="carts"  → Tab "Carritos de suscripción": el resto (pending,
  //                  cancelled, paused, payment_failed). Son intentos /
  //                  abandonos / cancelados, NO suscripciones operativas.
  const isCarts = mode === "carts";
  const cartStatuses = ["pending", "cancelled", "paused", "payment_failed"];

  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState(isCarts ? "all" : "active");
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null);

  async function load() {
    setLoading(true);
    const params = {};
    if (!isCarts) {
      // En modo "activos" forzamos siempre status=active (sin filter UI)
      params.status = "active";
    } else if (filter !== "all") {
      params.status = filter;
    }
    if (search.trim()) params.email = search.trim();
    const d = await apiGet("subscribers", params);
    let list = d?.subscribers || [];
    // En carts, si filter=all, filtramos client-side los no-active
    if (isCarts && filter === "all") {
      list = list.filter(s => cartStatuses.includes(s.status));
    }
    setSubs(list);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter, isCarts]);

  // CSV: fetch con Bearer (apiGet parsea JSON) → blob → descarga.
  async function exportCsv() {
    try {
      const token = await auth.currentUser?.getIdToken();
      const params = new URLSearchParams({ action: "export" });
      if (!isCarts) params.set("status", "active");
      else if (filter !== "all") params.set("status", filter);
      const r = await fetch(`/api/subscribers?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return toast("Error: " + (d.error || r.status), "error"); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `suscriptores-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("CSV exportado", "success");
    } catch (e) { toast("Error: " + e.message, "error"); }
  }

  const filtered = subs;
  const title = isCarts ? "Carritos de suscripción" : "Suscriptores activos";
  const subtitle = isCarts
    ? "Intentos abandonados, cancelados o con pago fallido. No cuentan como MRR ni aparecen en Inicio."
    : "Clientes con suscripción activa cobrando recurrentemente. Tocá una fila para gestionarla.";
  const emptyTitle = isCarts ? "No hay carritos" : "Todavía no tenés suscriptores activos";
  const emptyDesc = isCarts
    ? "Cuando un cliente abandone el checkout o cancele su sub, aparece acá."
    : "Cuando un cliente complete el pago MP, aparece acá automáticamente.";

  const columns = [
    { key:"cliente", label:"Cliente", render: s => <CellStack T={T} main={s.customer_name || s.customer_email} sub={s.customer_name ? s.customer_email : (s.customer_phone || "")}/> },
    { key:"plan", label:"Plan", render: s => <CellStack T={T} main={<>{s.plan_snapshot?.product_title || "—"}{s.quantity > 1 && <span style={{ color:T.accent }}> × {s.quantity}</span>}</>} sub={`cada ${s.plan_snapshot?.frequency_days||"-"} días`}/> },
    { key:"monto", label:"Por cobro", align:"right", nowrap:true, render: s => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(s.plan_snapshot?.total_per_charge_ars || s.plan_snapshot?.subscription_price_ars || 0)}</span> },
    { key:"ordenes", label:"Órdenes", align:"right", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textMd }}>{(s.shopify_orders||[]).length}</span> },
    { key:"estado", label:"Estado", nowrap:true, render: s => <StatusBadge status={s.status} orderCount={(s.shopify_orders||[]).length}/> },
    { key:"alta", label:"Alta", align:"right", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{s.created_at ? fmtDateOnly(s.created_at) : "—"}</span> },
  ];

  return (
    <div>
      <PageHeader T={T} title={title} subtitle={subtitle}
        right={<>
          {isCarts && (
            <select value={filter} onChange={e=>setFilter(e.target.value)} style={{ ...iS, width:"auto", padding:"7px 10px", fontSize:DS.font.md }}>
              <option value="all">Todos los carritos</option>
              <option value="pending">Pendientes</option>
              <option value="cancelled">Cancelados</option>
              <option value="paused">Pausados</option>
              <option value="payment_failed">Pago falló</option>
            </select>
          )}
          <input type="text" placeholder="Buscar email…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")load();}} style={{ ...iS, width:"auto", minWidth:190, padding:"7px 10px", fontSize:DS.font.md }}/>
          <Btn T={T} variant="secondary" size="sm" onClick={exportCsv}>⬇ Exportar CSV</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={load} title="Refrescar" disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"}</Btn>
        </>}/>

      {loading ? (
        <Loading T={T}/>
      ) : filtered.length === 0 ? (
        <OnbEmpty section={isCarts ? "carritos" : "suscriptores"} icon={isCarts ? "🛒" : "👥"} title={emptyTitle} desc={emptyDesc} tip={isCarts ? undefined : TIPS.subscribersEmpty}/>
      ) : (
        <DSTable T={T} columns={columns} rows={filtered} rowKey={s=>s.id} onRowClick={s=>setDetail(s)} minWidth={720}
          footer={<span>{filtered.length} {isCarts ? "carrito" : "suscriptor"}{filtered.length === 1 ? "" : (isCarts ? "s" : "es")}</span>}/>
      )}

      {detail && <SubscriberDetailModal sub={detail} devMode={devMode} onClose={()=>{setDetail(null); load();}}/>}
    </div>
  );
}

function SubscriberDetailModal({ sub, onClose, devMode = false }) {
  const T = useT();
  const [data, setData] = useState({ subscriber: sub, charges: [] });
  const [busyAction, setBusyAction] = useState(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("subscribers", { id: sub.id }).then(d => {
      if (d?.subscriber) setData(d);
      setLoading(false);
    });
  }, [sub.id]);

  async function refresh() {
    const refreshed = await apiGet("subscribers", { id: sub.id });
    if (refreshed?.subscriber) setData(refreshed);
  }

  async function doAction(action) {
    if (action === "delete") {
      const ok = await appConfirm(
        `Esto elimina el subscriber + todos sus charges de Firestore.\n` +
        `Intenta cancelar en MP (si todavía está activo); si MP da error lo ignora.\n\n` +
        `NO se puede deshacer.`,
        { title:"⚠️ ¿Borrar definitivamente este subscriber?", danger:true, okLabel:"Borrar definitivamente" }
      );
      if (!ok) return;
      setBusyAction("delete");
      try {
        const r = await apiDelete("subscribers", { id: sub.id });
        if (r?.error) {
          toast("Error: " + r.error, "error", 6000);
          setBusyAction(null);
        } else {
          toast(`Subscriber borrado · ${r.charges_deleted || 0} charges asociados eliminados`, "success", 5000);
          onClose();
        }
      } catch (e) {
        toast("Error: " + e.message, "error");
        setBusyAction(null);
      }
      return;
    }
    if (action === "reprice") {
      const cur = data.subscriber?.plan_snapshot?.total_per_charge_ars || 0;
      const v = await appPrompt(`Hoy paga ${fmtARS(cur)}. Se actualiza en Mercado Pago y aplica desde el próximo cobro.`, String(cur || ""), { title:"Nuevo monto TOTAL por cobro para este suscriptor", placeholder:"Monto en $", okLabel:"Repreciar" });
      if (v === null) return;
      const amount = Math.round(Number(v));
      if (!(amount > 0)) return toast("Monto inválido", "warning");
      setBusyAction("reprice");
      try {
        const d = await apiPost("subscribers", { id: sub.id, new_amount: amount }, { action: "reprice" });
        if (d?.error) toast("Error: " + d.error, "error", 6000);
        else if (d.failed?.length) toast("No se pudo repreciar: " + d.failed[0].error, "error", 6000);
        else toast(`Repreciado a ${fmtARS(amount)} por cobro`, "success");
        await refresh();
      } catch (e) { toast("Error: " + e.message, "error"); }
      finally { setBusyAction(null); }
      return;
    }
    if (action === "simulate-charge") {
      const ok = await appConfirm("Va a crear una orden Shopify nueva como si MP hubiera cobrado el siguiente mes, SIN cobrar plata real. Solo para testear que el flow de cobros recurrentes funciona.", { title:"¿Simular el próximo cobro recurrente?", okLabel:"Simular" });
      if (!ok) return;
      setBusyAction("simulate-charge");
      try {
        const d = await apiPost("subscribers", {}, { action: "simulate-charge", id: sub.id });
        if (d?.error) {
          toast("Error: " + d.error, "error", 6000);
        } else if (d.status === "ok") {
          await appAlert(`Cobro #${d.charge_number}\nOrden Shopify: #${d.shopify_order_id}\nMonto: ${fmtARS(d.amount_ars)}`, { title:"✓ Cobro simulado" });
        } else {
          toast(`Falló: ${d.shopify_error || d.error || "desconocido"}`, "error", 7000);
        }
        await refresh();
      } catch (e) {
        toast("Error: " + e.message, "error");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action === "link-payment") {
      // Pedimos el payment_id al merchant (lo saca del panel de MP del comprador).
      const paymentId = await appPrompt(
        "Lo ves en mercadopago.com.ar → Actividad → click sobre el cobro de este cliente.\n\nEsto crea la orden Shopify usando ese payment_id específico (escape hatch para cuando MP no nos devuelve el payment por search).",
        "", { title:"Pegá el ID del pago de MP (N.° de operación)", placeholder:"1234567890", okLabel:"Linkear" }
      );
      if (!paymentId || !paymentId.trim()) return;
      setBusyAction("link-payment");
      try {
        const d = await apiPost("subscribers", { payment_id: paymentId.trim() }, { action: "link-payment", id: sub.id });
        if (d?.error) {
          toast("Error: " + d.error, "error", 6000);
        } else if (d.status === "linked") {
          await appAlert(`Payment ${paymentId} linkeado.\nOrden Shopify: #${d.shopify_order_id || "(error)"}\nMonto: ${fmtARS(d.amount_ars)}` + (d.shopify_error ? `\n\n⚠️ Shopify: ${d.shopify_error}` : ""), { title:"✓ Payment linkeado" });
        } else if (d.status === "already_linked") {
          await appAlert(`Este payment ya estaba linkeado.\nOrden Shopify: #${d.shopify_order_id}`, { title:"Ya estaba linkeado" });
        } else {
          await appAlert(`Resultado: ${d.status || "?"}\n${d.error || ""}`, { title:"Resultado" });
        }
        await refresh();
      } catch (e) {
        toast("Error: " + e.message, "error");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action === "sync") {
      // Escape hatch: forzar lookup en MP para subs que quedaron pending
      // porque el webhook MP no llegó. NO debería usarse en operación normal.
      setBusyAction("sync");
      try {
        const d = await apiPost("subscribers", {}, { action: "sync", id: sub.id });
        if (d?.error) {
          toast("Error: " + d.error, "error", 6000);
        } else {
          // Mensaje detallado con info de qué encontró el sync
          let msg = "Estado del subscriber: " + (d.status || "?").toUpperCase();
          msg += `\nPreapproval MP: ${d.mp_preapproval_status || "?"}`;
          msg += `\nPayments encontrados: ${d.payments_found ?? 0} (${d.payments_approved ?? 0} aprobados)`;
          if (d.charges_processed > 0 && d.shopify_order_id) {
            msg += `\n\n✓ Orden Shopify creada: #${d.shopify_order_id}`;
          } else if (d.charges_processed > 0) {
            msg += `\n\n⚠ Se procesaron ${d.charges_processed} cobros pero la orden Shopify NO se pudo crear.`;
          } else if (d.forced_charge) {
            msg += "\n\n🚀 Forzamos a MP a cobrar AHORA. Esperá 1-3 min y volvé a sincronizar — el payment debería aparecer y se va a crear la orden Shopify automáticamente.";
          } else if (d.payments_approved === 0 && d.status === "pending") {
            msg += "\n\nMP todavía NO procesó el primer cobro. Esto a veces tarda 5-30 min después de pagar. Esperá y reintentá.";
          } else if (d.status === "active") {
            msg += "\n\n(sin cambios — todo procesado previamente)";
          }
          if (d.shopify_errors && d.shopify_errors.length > 0) {
            msg += "\n\n⚠️ Errores Shopify:\n" + d.shopify_errors.join("\n");
          }
          await appAlert(msg, { title:"Sincronización con MP" });
        }
        await refresh();
      } catch (e) {
        toast("Error de red: " + e.message, "error");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action === "resync") {
      // "Marcar como activa": fuerza local → active y best-effort linkea el
      // preapproval activo de MP. Confiamos en que el webhook de MP el día
      // del próximo cobro va a encontrar el sub por external_reference.
      setBusyAction("resync");
      try {
        const r = await apiPatch("subscribers", { action: "resync" }, { id: sub.id });
        if (r?.error) {
          toast("Error: " + r.error, "error", 6000);
        } else {
          let msg = "";
          if (r.mp_preapproval_linked) {
            msg += `Linkeada al preapproval MP: ${r.mp_preapproval_id}`;
            if (r.next_charge_at) {
              msg += `\nPróximo cobro: ${new Date(r.next_charge_at).toLocaleString("es-AR")}`;
            }
          } else {
            msg += "No encontramos preapproval activo en MP via search, pero igual está activa localmente. Cuando MP cobre el próximo mes, el webhook va a llegar con external_reference y va a crear la orden Shopify normal.";
          }
          await appAlert(msg, { title:"✓ Sub marcada como ACTIVA" });
          await refresh();
        }
      } catch (e) {
        toast("Error de red: " + e.message, "error");
      } finally {
        setBusyAction(null);
      }
      return;
    }
    const ok = await appConfirm({
      pause: "No se cobra más hasta reactivar.",
      resume: "Vuelve a cobrarse en la próxima fecha.",
      cancel: "No se puede deshacer.",
    }[action], {
      title: { pause:"¿Pausar esta suscripción?", resume:"¿Reactivar esta suscripción?", cancel:"¿Cancelar definitivamente esta suscripción?" }[action],
      danger: action === "cancel",
      okLabel: { pause:"Pausar", resume:"Reactivar", cancel:"Sí, cancelar" }[action],
    });
    if (!ok) return;
    setBusyAction(action);
    const r = await apiPatch("subscribers", { action }, { id: sub.id });
    setBusyAction(null);
    if (r?.error) {
      toast("Error: " + r.error, "error", 6000);
    } else {
      toast({ pause:"Suscripción pausada", resume:"Suscripción reactivada", cancel:"Suscripción cancelada" }[action], action === "cancel" ? "warning" : "success");
      await refresh();
    }
  }

  const s = data.subscriber;
  const charges = data.charges || [];
  const status = s?.status || "unknown";
  const plan = s?.plan_snapshot || {};
  const qty = s.quantity || plan.units_per_shipment || 1;
  const unit = plan.subscription_price_ars || 0;
  const total = plan.total_per_charge_ars || (unit * qty);
  const busy = !!busyAction;
  const act = ({ id, variant = "secondary", label, busyLabel, ...rest }) => (
    <Btn T={T} variant={variant} size="sm" onClick={()=>doAction(id)} disabled={busy} {...rest}>
      {busyAction === id ? <><Spinner size={11} color={variant === "solid" ? "#fff" : T.textMd}/> {busyLabel}</> : label}
    </Btn>
  );

  const chargeCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateTime(c.created_at)}</span> },
    { key:"monto", label:"Monto", nowrap:true, render: c => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</span> },
    { key:"orden", label:"Orden", nowrap:true, render: c => c.shopify_order_id ? <span style={{ fontFamily:MONO, fontSize:DS.font.sm, color:T.textMd }}>#{c.shopify_order_id}</span> : <span style={{ color:T.textSm }}>—</span> },
    { key:"estado", label:"Estado", align:"right", nowrap:true, render: c => <span title={c.error || ""} style={{ cursor:c.error?"help":"default" }}><DSBadge T={T} color={c.error ? T.red : T.green} size="sm">{c.error ? "✗ Error" : "✓ OK"}</DSBadge></span> },
  ];

  return (
    <Modal T={T} open onClose={onClose} width={660} title={s.customer_name || s.customer_email}
      subtitle={<>{s.customer_email}{s.customer_phone ? ` · ${s.customer_phone}` : ""}</>}>

      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <StatusBadge status={status} orderCount={(s?.shopify_orders||[]).length} size="md"/>
        <span style={{ fontSize:DS.font.sm, color:T.textSm }}>desde {s.created_at ? fmtDateOnly(s.created_at) : "—"}</span>
        {s.next_charge_at && status !== "cancelled" && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>· próximo cobro {fmtDateOnly(s.next_charge_at)}</span>}
      </div>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        <SurfaceBox T={T} title="Plan">
          <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text, marginBottom:6 }}>{plan.product_title || "—"}</div>
          <div style={{ fontSize:DS.font.sm, color:T.textMd, lineHeight:1.5 }}>
            <strong style={{ color:T.accent, fontSize:DS.font.base }}>{fmtARS(total)}</strong> cada {plan.frequency_days||"-"} días
            <div style={{ color:T.textSm }}>{qty} paquete{qty===1?"":"s"} × {fmtARS(unit)} c/u</div>
          </div>
        </SurfaceBox>
        <SurfaceBox T={T} title="Dirección de envío" right={<Btn T={T} variant="ghost" size="sm" onClick={()=>setEditingAddress(true)} style={{ padding:"2px 8px" }}>✏️ Editar</Btn>}>
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.5 }}>
            {s.shipping_address?.address1
              ? <>
                  {s.shipping_address.address1}{s.shipping_address.address2?", "+s.shipping_address.address2:""}<br/>
                  {s.shipping_address.city}{s.shipping_address.province?", "+s.shipping_address.province:""}{s.shipping_address.zip?" — CP "+s.shipping_address.zip:""}
                </>
              : <span style={{ color:T.red, fontWeight:DS.w.bold }}>⚠️ Sin dirección — editá para arreglar</span>
            }
          </div>
        </SurfaceBox>
      </div>
      {editingAddress && (
        <EditAddressModal
          sub={s}
          onClose={()=>setEditingAddress(false)}
          onSaved={async()=>{ setEditingAddress(false); await refresh(); }}
        />
      )}

      {/* Acciones */}
      <SectionTitle T={T}>Acciones</SectionTitle>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {status === "active" && act({ id: "pause", label: "⏸ Pausar", busyLabel: "Pausando…" })}
        {status === "paused" && act({ id: "resume", variant: "primary", label: "▶ Reactivar", busyLabel: "Reactivando…" })}
        {/* Sync manual: idempotente, intenta procesar todos los pagos aprobados
            que no tengan orden Shopify creada todavía. */}
        {act({ id: "sync", variant: "primary", label: "⟳ Sincronizar con MP", busyLabel: "Sincronizando…" })}
        {/* Marcar como activa: fuerza el sub local a "active". */}
        {(status === "cancelled" || status === "paused" || status === "pending") && act({ id: "resync", variant: "success", label: "✓ Marcar como activa (sigue en MP)", busyLabel: "Marcando…" })}
        {/* Link manual de payment ID — escape hatch. */}
        {act({ id: "link-payment", label: "🔗 Linkear payment ID", busyLabel: "Linkeando…" })}
        {(status === "active" || status === "paused") && act({ id: "reprice", label: "💲 Repreciar", busyLabel: "Repreciando…" })}
        {/* Solo en modo desarrollador: crea una orden SIMULADA (sin mails ni pago). */}
        {status === "active" && devMode && act({ id: "simulate-charge", label: "🧪 Simular próximo cobro", busyLabel: "Simulando…" })}
        {(status === "active" || status === "paused" || status === "payment_failed") && act({ id: "cancel", variant: "danger", label: "✕ Cancelar", busyLabel: "Cancelando…" })}
        {/* Borrar definitivamente — elimina el sub + charges de Firestore. */}
        {act({ id: "delete", variant: "danger", label: "🗑 Borrar definitivamente", busyLabel: "Borrando…", style: { background:T.red+"26", } })}
      </div>

      {/* Historial de cargos */}
      <SectionTitle T={T}>Historial de cobros</SectionTitle>
      {loading ? (
        <Loading T={T}/>
      ) : charges.length === 0 ? (
        <SurfaceBox T={T}><div style={{ fontSize:DS.font.md, color:T.textSm, textAlign:"center" }}>Sin cargos todavía</div></SurfaceBox>
      ) : (
        <DSTable T={T} columns={chargeCols} rows={charges} rowKey={c=>c.id} dense minWidth={420} style={{ boxShadow:"none" }}/>
      )}
    </Modal>
  );
}

// ─── Tab: Carritos abandonados ──────────────────────────────────
function AbandonedTab() {
  const T = useT();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const d = await apiGet("subscribers", { action: "abandoned" });
    setList(d?.abandoned || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function copyEmails() {
    const emails = list.map(x => x.email).filter(Boolean).join(", ");
    try { navigator.clipboard.writeText(emails); setCopied(true); toast(`${list.length} email${list.length===1?"":"s"} copiado${list.length===1?"":"s"}`, "success"); setTimeout(()=>setCopied(false), 1500); } catch (_) { toast("No se pudo copiar", "warning"); }
  }

  const ABANDON = "#8b5cf6";
  const columns = [
    { key:"cliente", label:"Cliente", render: a => <CellStack T={T} main={a.name || a.email} sub={<>{a.email}{a.phone ? ` · ${a.phone}` : ""}</>}/> },
    { key:"producto", label:"Producto", render: a => <CellStack T={T} main={<>{a.product_title || "—"}{a.quantity>1 ? <span style={{ color:T.accent }}> × {a.quantity}</span> : ""}</>} sub={a.capture ? "lead" : null}/> },
    { key:"valor", label:"Valor", align:"right", nowrap:true, render: a => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(a.value_ars)}</span> },
    { key:"fecha", label:"Abandonó", nowrap:true, hideMobile:true, render: a => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateShort(a.created_at)}</span> },
    { key:"recupero", label:"Recupero", nowrap:true, render: a => a.abandoned_step
        ? <span title={a.abandoned_step_at ? `Enviado ${fmtDateShort(a.abandoned_step_at)}` : ""}><DSBadge T={T} color={ABANDON} size="sm">📭 Mail paso {a.abandoned_step}</DSBadge></span>
        : <span style={{ color:T.textSm, fontSize:DS.font.sm }}>Sin mails enviados</span> },
    { key:"accion", label:"", align:"right", nowrap:true, render: a => a.recover_url
        ? <a href={a.recover_url} target="_blank" rel="noreferrer" title={a.recover_url} onClick={e=>e.stopPropagation()} style={{ ...BtnSecondary(T), textDecoration:"none", padding:"5px 10px", fontSize:DS.font.sm }}>Ver en la tienda →</a>
        : null },
  ];

  return (
    <div>
      <PageHeader T={T} title="Carritos abandonados" subtitle="Clientes que iniciaron el checkout de suscripción y no completaron el pago (+45 min). Base para el flujo de recupero."
        right={<>
          {list.length>0 && <Btn T={T} variant="secondary" size="sm" onClick={copyEmails}>{copied ? "✓ Copiado" : "📋 Copiar emails"}</Btn>}
          <Btn T={T} variant="secondary" size="sm" onClick={load} title="Refrescar" disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"}</Btn>
        </>}/>
      {loading ? (
        <Loading T={T}/>
      ) : list.length === 0 ? (
        <OnbEmpty section="abandonados" icon="📭" title="Todavía no hay carritos abandonados" desc="Cuando alguien inicie el checkout de suscripción y no pague, aparece acá a los 45 min con su link de recupero."/>
      ) : (
        <DSTable T={T} columns={columns} rows={list} rowKey={a=>a.id} minWidth={760}
          footer={<span>{list.length} recuperable{list.length===1?"":"s"}</span>}/>
      )}
    </div>
  );
}

// ─── Tab: Actividad (Mails / Envíos / Facturación) ─────────────────
function ActivityTab() {
  const T = useT();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("mails");

  async function load() {
    setLoading(true);
    const d = await apiGet("stats", { action: "activity" });
    setData(d || {});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const ABANDON = "#8b5cf6";
  const MAIL_LABEL = {
    activation:      { t:"Activación",     c:T.green,  e:"✅" },
    cancellation:    { t:"Cancelación",    c:T.red,    e:"🚫" },
    payment_failed:  { t:"Pago fallido",   c:T.yellow, e:"⚠️" },
  };
  const mailLabel = (m) => {
    if (m.type === "abandoned") return { t:`Abandono · Paso ${m.step||1} (histórico)`, c:ABANDON, e:"📭" };
    return MAIL_LABEL[m.type] || { t:m.type, c:T.textMd, e:"📧" };
  };

  const views = [
    { id:"mails",  label:"📧 Mails y eventos", count: data ? (data.mails?.length || 0) + (data.klaviyo_events?.length || 0) : undefined },
    { id:"envios", label:"📦 Envíos",       count: data?.envios?.length },
    { id:"cobros", label:"💵 Facturación",  count: data?.cobros?.length },
  ];

  const ms = data?.mail_summary || {};
  const ks = data?.klaviyo_summary || {};
  const cs = data?.cobro_summary || {};
  const es = data?.envio_summary || {};
  const dateCol = { key:"fecha", label:"Fecha", nowrap:true, render: r => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateShort(r.created_at)}</span> };
  const clientCol = (nameKey, mailKey) => ({ key:"cliente", label:"Cliente", render: r => <CellStack T={T} main={r[nameKey]||"—"} sub={r[mailKey]}/> });
  const prodCol = { key:"producto", label:"Producto", hideMobile:true, render: r => <span style={{ color:T.textSm }}>{r.product_title||"—"}</span> };

  return (
    <div>
      <PageHeader T={T} title="Actividad" subtitle="Mails que manda Recurrentes, eventos enviados a Klaviyo, envíos generados y facturación de las suscripciones."
        right={<Btn T={T} variant="secondary" size="sm" onClick={load} title="Refrescar" disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>}/>

      <div style={{ marginBottom:DS.sp.lg }}>
        <SubTabs T={T} tabs={views} active={view} onChange={setView}/>
      </div>

      {loading ? (
        <Loading T={T}/>
      ) : view === "mails" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
          <SectionTitle T={T} sub="Transaccionales que salen desde Recurrentes (activación, pago fallido, cancelación).">Mails</SectionTitle>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard T={T} label="Total enviados" value={ms.total||0}/>
            <StatCard T={T} label="Activación" value={ms.activation||0} color={T.green}/>
            <StatCard T={T} label="Pago fallido" value={ms.payment_failed||0} color={T.yellow}/>
            <StatCard T={T} label="Cancelación" value={ms.cancellation||0} color={T.red}/>
            {(ms.abandoned_1||ms.abandoned_2||ms.abandoned_3) ? <StatCard T={T} label="Abandono (histórico)" value={(ms.abandoned_1||0)+(ms.abandoned_2||0)+(ms.abandoned_3||0)} color={ABANDON}/> : null}
          </div>
          {(data?.mails||[]).length === 0 ? (
            <OnbEmpty section="actividad" icon="📭" title="Todavía no se envió ningún mail" desc="Aparecen acá a medida que Recurrentes los manda: activación, pago fallido, cancelación y recupero de abandonados."/>
          ) : (
            <DSTable T={T} rows={data.mails} rowKey={m=>m.id} minWidth={640} columns={[
              dateCol,
              { key:"tipo", label:"Tipo", nowrap:true, render: m => { const L = mailLabel(m); return (
                <span style={{ display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:L.c }}>{L.e} {L.t}</span>
                  {m.coupon ? <DSBadge T={T} color={T.textSm} size="sm">{m.coupon}</DSBadge> : null}
                  {m.status==="error" ? <DSBadge T={T} color={T.red} size="sm">error</DSBadge> : null}
                </span>); } },
              clientCol("customer_name", "to"),
              prodCol,
            ]}/>
          )}

          <SectionTitle T={T} sub="Lo que le mandamos a tu Klaviyo (últimos 200). El nombre es la métrica que usás como disparador de flujo." style={{ marginTop:DS.sp.md }}>Eventos Klaviyo</SectionTitle>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard T={T} label="Eventos enviados" value={ks.sent||0} color={T.green}/>
            <StatCard T={T} label="Con error" value={ks.error||0} color={ks.error ? T.red : undefined}/>
          </div>
          {(data?.klaviyo_events||[]).length === 0 ? (
            <DSEmpty T={T} icon="✉️" title="Todavía no se mandó ningún evento a Klaviyo" subtitle="Conectá Klaviyo en Integraciones: cada checkout y cada cobro de suscripción aparece acá."/>
          ) : (
            <DSTable T={T} rows={data.klaviyo_events} rowKey={k=>k.id} minWidth={640} columns={[
              dateCol,
              { key:"metrica", label:"Métrica", nowrap:true, render: k => <span style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text }}>{k.metric || "—"}</span> },
              { key:"email", label:"Email", render: k => <CellStack T={T} main={k.email||"—"} sub={k.customer_name||""}/> },
              { key:"estado", label:"Estado", nowrap:true, render: k => k.status === "error"
                  ? <span title={k.error||""}><DSBadge T={T} color={T.red} size="sm">✕ error{k.http_status ? ` ${k.http_status}` : ""}</DSBadge></span>
                  : <DSBadge T={T} color={T.green} size="sm">✓ enviado</DSBadge> },
            ]}/>
          )}
        </div>
      ) : view === "envios" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard T={T} label="Envíos totales" value={es.total||0}/>
            <StatCard T={T} label="Este mes" value={es.this_month||0} color={T.green}/>
          </div>
          {(data?.envios||[]).length === 0 ? (
            <OnbEmpty section="actividad" icon="📦" title="Todavía no se generó ninguna orden de envío" desc="Cada cobro aprobado crea una orden en Shopify con la dirección y el envío que eligió el cliente."/>
          ) : (
            <DSTable T={T} rows={data.envios} rowKey={e=>e.id} minWidth={640} columns={[
              dateCol,
              { key:"orden", label:"Orden", nowrap:true, render: e => e.order_url
                  ? <a href={e.order_url} target="_blank" rel="noreferrer" style={{ color:T.accent, fontWeight:DS.w.bold, textDecoration:"none" }}>#{e.order_id} →</a>
                  : <span style={{ fontWeight:DS.w.bold }}>#{e.order_id}</span> },
              clientCol("customer_name", "customer_email"),
              prodCol,
            ]}/>
          )}
        </div>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard T={T} label="Cobrado hoy" value={fmtARS(cs.today?.amount)} color={T.green}/>
            <StatCard T={T} label="Cobros hoy" value={cs.today?.count||0}/>
            <StatCard T={T} label="Este mes" value={fmtARS(cs.this_month?.amount)} color={T.green}/>
            <StatCard T={T} label="Cobros del mes" value={cs.this_month?.count||0}/>
            <StatCard T={T} label="Histórico" value={fmtARS(cs.all_time)}/>
          </div>
          {(data?.cobros||[]).length === 0 ? (
            <OnbEmpty section="actividad" icon="💵" title="Todavía no hay cobros registrados" desc="Aparecen acá cuando Mercado Pago procesa el primer pago de una suscripción."/>
          ) : (
            <DSTable T={T} rows={data.cobros} rowKey={c=>c.id} minWidth={680} columns={[
              dateCol,
              { key:"monto", label:"Monto", nowrap:true, render: c => <span style={{ fontWeight:DS.w.black, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount)}</span> },
              { key:"estado", label:"Estado", nowrap:true, render: c => { const okk = c.status!=="error" && c.status!=="rejected"; return <DSBadge T={T} color={okk?T.green:T.red} size="sm">{okk?"✓ aprobado":"✕ "+(c.status||"error")}</DSBadge>; } },
              clientCol("customer_name", "customer_email"),
              { key:"orden", label:"Orden", nowrap:true, hideMobile:true, render: c => <span style={{ color:T.textSm, fontFamily:MONO, fontSize:DS.font.sm }}>{c.order_id?`#${c.order_id}`:"—"}</span> },
            ]}/>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Cobros ─────────────────────────────────────────────────
function ChargesTab() {
  const T = useT();
  const [charges, setCharges] = useState([]);
  const [totals, setTotals] = useState({ amount_ars:0, ok:0, failed:0, total:0 });
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [retrying, setRetrying] = useState(null);

  async function load(more = false) {
    setLoading(true);
    const params = { limit: 200 };
    if (more && cursor) params.cursor = cursor;
    const d = await apiGet("charges", params);
    const list = d?.charges || [];
    setCharges(prev => more ? [...prev, ...list] : list);
    setCursor(d?.next_cursor || null);
    if (!more) setTotals(d?.totals || { amount_ars:0, ok:0, failed:0, total:0 });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Reintenta la orden Shopify de un charge que quedó con error (mismo payment_id).
  async function retryOrder(c) {
    if (!c.subscriber_id || !c.mp_payment_id) return toast("Este cobro no tiene suscriptor o payment_id asociado.", "warning");
    const ok = await appConfirm(`Se vuelve a intentar crear la orden con el mismo payment_id.`, { title:`¿Reintentar la orden Shopify del cobro MP ${c.mp_payment_id}?`, okLabel:"Reintentar" });
    if (!ok) return;
    setRetrying(c.id);
    try {
      const d = await apiPost("subscribers", { id: c.subscriber_id, payment_id: String(c.mp_payment_id) }, { action: "retry-order" });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.shopify_order_id) toast(`Orden Shopify #${d.shopify_order_id} creada`, "success");
      else toast(`No se pudo crear la orden: ${d.shopify_error || d.error || d.status || "sin detalle"}`, "error", 7000);
      load();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setRetrying(null); }
  }

  const columns = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateTime(c.created_at)}</span> },
    { key:"monto", label:"Monto", nowrap:true, render: c => <span style={{ fontWeight:DS.w.black, fontSize:DS.font.lg, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</span> },
    { key:"ids", label:"Referencias", hideMobile:true, render: c => (
      <div style={{ fontFamily:MONO, fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>
        <div>MP {c.mp_payment_id}</div>
        {c.shopify_order_id && <div>Shopify #{c.shopify_order_id}</div>}
      </div>) },
    { key:"estado", label:"Estado", render: c => c.error ? (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-start", gap:5, maxWidth:320 }}>
        <span title={c.error} style={{ cursor:"help" }}><DSBadge T={T} color={T.red} size="sm">✗ Falló</DSBadge></span>
        <span style={{ fontSize:DS.font.sm, color:T.red, lineHeight:1.35, overflow:"hidden", textOverflow:"ellipsis", display:"-webkit-box", WebkitLineClamp:2, WebkitBoxOrient:"vertical" }} title={c.error}>{c.error}</span>
        {!c.shopify_order_id && (
          <Btn T={T} variant="secondary" size="sm" onClick={(e)=>{ e.stopPropagation(); retryOrder(c); }} disabled={retrying===c.id} style={{ padding:"4px 9px", fontSize:DS.font.xs }}>{retrying===c.id ? <><Spinner size={10} color={T.textMd}/> Reintentando…</> : "↻ Reintentar orden"}</Btn>
        )}
      </div>
    ) : <DSBadge T={T} color={T.green} size="sm">✓ OK</DSBadge> },
    { key:"status", label:"MP", align:"right", nowrap:true, hideMobile:true, render: c => <span style={{ fontSize:DS.font.sm, color:T.textSm }}>{c.status || ""}</span> },
  ];

  return (
    <div>
      <PageHeader T={T} title="Cobros" subtitle="Historial de cobros recurrentes procesados por Mercado Pago."
        right={<Btn T={T} variant="secondary" size="sm" onClick={()=>load()} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Refrescar</Btn>}/>

      {/* KPIs */}
      <div className="kpi-grid gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:DS.sp.md, marginBottom:DS.sp.xl }}>
        <KPI T={T} compact label="Total recaudado" value={fmtARS(totals.amount_ars)} accent color={T.accent} loading={loading && charges.length===0}/>
        <KPI T={T} compact label="Cobros OK" value={totals.ok} color={T.text} loading={loading && charges.length===0}/>
        <KPI T={T} compact label="Cobros fallidos" value={totals.failed} color={totals.failed>0?T.red:T.text} loading={loading && charges.length===0}/>
        <KPI T={T} compact label="Total cobros" value={totals.total} color={T.text} loading={loading && charges.length===0}/>
      </div>

      {loading && charges.length === 0 ? (
        <Loading T={T}/>
      ) : charges.length === 0 ? (
        <OnbEmpty section="cobros" icon="💸" title="Todavía no tenés cobros" desc="Aparecen acá cuando Mercado Pago procesa el primer pago de una suscripción, y después cada renovación." tip={TIPS.chargesEmpty}/>
      ) : (
        <DSTable T={T} columns={columns} rows={charges} rowKey={c=>c.id} minWidth={720}
          footer={<>
            <span>{charges.length} cobro{charges.length===1?"":"s"} cargado{charges.length===1?"":"s"}</span>
            {cursor && <Btn T={T} variant="secondary" size="sm" onClick={()=>load(true)} disabled={loading}>{loading ? <><Spinner size={11} color={T.textMd}/> Cargando…</> : "Cargar más"}</Btn>}
          </>}/>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function PlaceholderTab({ title, desc, next }) {
  const T = useT();
  return (
    <div>
      <PageHeader T={T} title={title} subtitle={desc}/>
      <DSEmpty T={T} icon="🚧" title={next || "En construcción."}/>
    </div>
  );
}

function NeedsIntegrations({ title, onGo }) {
  const T = useT();
  return (
    <div>
      <PageHeader T={T} title={title}/>
      <Callout T={T} tone="warning" title="Falta conectar integraciones" right={<Btn T={T} variant="solid" size="sm" onClick={onGo}>Ir a Integraciones →</Btn>}>
        Necesitás conectar Shopify y Mercado Pago antes de usar esta sección.
      </Callout>
    </div>
  );
}

// ─── Modal para editar la dirección de un subscriber ──────────────
// Edita el shipping_address y propaga el cambio a TODAS las órdenes Shopify
// ya creadas + las que se generen en cobros recurrentes futuros.
const PROVINCIAS_AR = ["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];

function EditAddressModal({ sub, onClose, onSaved }) {
  const T = useT();
  const iS = InputStyle(T);
  const a = sub?.shipping_address || {};
  const [name, setName]         = React.useState(sub?.customer_name || "");
  const [phone, setPhone]       = React.useState(sub?.customer_phone || a.phone || "");
  const [taxId, setTaxId]       = React.useState(sub?.customer_tax_id || "");
  const [address1, setAddress1] = React.useState(a.address1 || "");
  const [address2, setAddress2] = React.useState(a.address2 || "");
  const [city, setCity]         = React.useState(a.city || "");
  const [province, setProvince] = React.useState(a.province || "");
  const [zip, setZip]           = React.useState(a.zip || "");
  const [saving, setSaving]     = React.useState(false);

  async function save() {
    if (!address1.trim()) return toast("Falta dirección (calle + número)", "warning");
    if (!city.trim())     return toast("Falta ciudad", "warning");
    if (!province)        return toast("Falta provincia", "warning");
    if (!zip.trim())      return toast("Falta código postal", "warning");
    const cleanTax = (taxId || "").replace(/[^0-9]/g, "");
    if (cleanTax && !(cleanTax.length === 7 || cleanTax.length === 8 || cleanTax.length === 11)) {
      return toast("DNI o CUIL/CUIT inválido. DNI son 7-8 dígitos, CUIL/CUIT son 11.", "warning", 5000);
    }
    setSaving(true);
    const r = await apiSend("subscribers", "PATCH",
      { address1, address2, city, province, zip, phone, customer_name: name, tax_id: cleanTax },
      { action: "update-address", id: sub.id }
    );
    setSaving(false);
    if (r?.error) { toast("Error: " + r.error, "error", 6000); return; }
    if (r.failed_orders?.length) {
      await appAlert(`Dirección actualizada en Recurrentes.` + (r.updated_orders?.length ? `\n📦 ${r.updated_orders.length} órdenes Shopify actualizadas.` : "") + `\n⚠️ ${r.failed_orders.length} órdenes Shopify fallaron al actualizar (verificá manual en Shopify Admin).`, { title:"Dirección guardada con avisos" });
    } else {
      toast("Dirección actualizada" + (r.updated_orders?.length ? ` · ${r.updated_orders.length} órdenes Shopify actualizadas` : ""), "success", 5000);
    }
    onSaved?.();
  }

  return (
    <Modal T={T} open onClose={onClose} title="Editar dirección" width={540} zIndex={1100}
      subtitle="Los cambios se aplican al sub y a todas las órdenes Shopify ya creadas + las que se generen en cobros futuros."
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn T={T} variant="solid" onClick={save} disabled={saving}>{saving ? <><Spinner size={13}/> Guardando…</> : "Guardar y sincronizar con Shopify"}</Btn>
      </>}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        <Field T={T} label="Nombre completo"><input type="text" value={name} onChange={e=>setName(e.target.value)} style={iS}/></Field>
        <Field T={T} label="Teléfono"><input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} style={iS}/></Field>
      </div>
      <Field T={T} label="DNI o CUIL / CUIT (solo números)">
        <input type="text" inputMode="numeric" value={taxId} onChange={e=>setTaxId(e.target.value.replace(/[^0-9]/g, ""))} style={iS} placeholder="12345678 ó 20123456789"/>
      </Field>
      <Hint T={T}>7-8 dígitos para DNI · 11 dígitos para CUIL/CUIT. Se guarda como "Company" en la orden Shopify para facturación.</Hint>
      <Field T={T} label="Dirección (calle + número)" required><input type="text" value={address1} onChange={e=>setAddress1(e.target.value)} style={iS} placeholder="Av. Corrientes 1234"/></Field>
      <Field T={T} label="Departamento / piso (opcional)"><input type="text" value={address2} onChange={e=>setAddress2(e.target.value)} style={iS} placeholder="Depto 4B"/></Field>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        <Field T={T} label="Ciudad" required><input type="text" value={city} onChange={e=>setCity(e.target.value)} style={iS}/></Field>
        <Field T={T} label="Código postal" required><input type="text" value={zip} onChange={e=>setZip(e.target.value)} style={iS}/></Field>
      </div>
      <Field T={T} label="Provincia" required>
        <select value={province} onChange={e=>setProvince(e.target.value)} style={iS}>
          <option value="">— Seleccioná —</option>
          {PROVINCIAS_AR.map(p=><option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
    </Modal>
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

// ─── Configuración operativa: mails, abandono, envíos del checkout, cupones, dev ──
// Guarda PARCIAL por sección con merchant?action=save-settings (solo lo que se manda).
export function OperationalSettingsCard({ merchant, onChange }) {
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const [emailFrom, setEmailFrom]     = React.useState(m.email_from || "");
  const [emailBrand, setEmailBrand]   = React.useState(m.email_brand || "");
  const [emailReply, setEmailReply]   = React.useState(m.email_reply_to || "");
  const [emailAccent, setEmailAccent] = React.useState(m.email_accent || "");
  const [storeDomain, setStoreDomain] = React.useState(m.store_domain || "");
  const [rates, setRates]             = React.useState(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []);
  const [devMode, setDevMode]         = React.useState(m.dev_mode === true);
  const [hideSel, setHideSel]         = React.useState(m.widget_hide_selector || "");
  const [flow, setFlow]               = React.useState(m.widget_checkout_flow || "redirect");
  const [pagePath, setPagePath]       = React.useState(m.widget_checkout_page_path || "");
  const [codes, setCodes]             = React.useState(Array.isArray(m.discount_codes) ? m.discount_codes : []);
  const [busy, setBusy]               = React.useState("");
  const [testTo, setTestTo]           = React.useState(m.email || "");

  React.useEffect(() => {
    setEmailFrom(m.email_from || ""); setEmailBrand(m.email_brand || ""); setEmailReply(m.email_reply_to || ""); setEmailAccent(m.email_accent || "");
    setStoreDomain(m.store_domain || ""); setRates(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []);
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
  async function sendTest() {
    if (!testTo.trim()) return toast("Ingresá el mail destino (tu mail de cuenta o uno del dominio del remitente)", "warning", 5000);
    setBusy("test");
    const d = await apiPost("merchant", { to: testTo.trim() }, { action: "test-email" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(`Mail de prueba (activación) enviado a ${testTo.trim()}. Quedan ${d.remaining ?? "?"} pruebas hoy.`, "success", 6000);
  }
  const updRate = (i, k, v) => setRates(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const updCode = (i, k, v) => setCodes(cs => cs.map((c, j) => j === i ? { ...c, [k]: v } : c));
  const inl = { ...iS, padding:"7px 10px", fontSize:DS.font.md };
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
      <div>
        <div style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 }}>Configuración operativa</div>
        <div style={{ fontSize:DS.font.md, color:T.textSm, lineHeight:1.55, marginTop:2 }}>Remitente de mails, tienda, envíos del checkout y cupones. El recupero de carritos vive en Klaviyo (Integraciones).</div>
      </div>

      {/* Tienda */}
      <Card T={T}>
        <CardHeader T={T} title="Tienda" sub="Dominio público y flujo del checkout de suscripción."/>
        <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 14px" }}>
          <Field T={T} label="Dominio público de la tienda (sin https://)">
            <input value={storeDomain} onChange={e=>setStoreDomain(e.target.value)} style={iS} placeholder="www.mitienda.com"/>
          </Field>
          <Field T={T} label="Ruta de la página de checkout de suscripción">
            <input value={pagePath} onChange={e=>setPagePath(e.target.value)} style={iS} placeholder="/pages/suscripcion-form"/>
          </Field>
          <Field T={T} label="Flujo del checkout del widget">
            <select value={flow} onChange={e=>setFlow(e.target.value)} style={iS}>
              <option value="redirect">Redirigir a la página de checkout</option>
              <option value="inline">Inline (formulario en el producto)</option>
            </select>
          </Field>
          <Field T={T} label="Selector CSS a ocultar en modo suscripción">
            <input value={hideSel} onChange={e=>setHideSel(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder=".product-form__buttons, ..."/>
          </Field>
        </div>
        {saveBtn("store", { store_domain: storeDomain, widget_checkout_page_path: pagePath, widget_checkout_flow: flow, widget_hide_selector: hideSel })}
      </Card>

      {/* Envíos del checkout */}
      <Card T={T}>
        <CardHeader T={T} title="Métodos de envío del checkout" sub="Lo que el cliente elige al suscribirse y queda en cada orden recurrente. Sin tarifas → se usa el envío del plan."
          right={rates.length < 6 && <Btn T={T} variant="secondary" size="sm" onClick={()=>setRates(rs=>[...rs,{name:"",price:0,code:""}])} type="button">+ Agregar</Btn>}/>
        {rates.length === 0 && <SurfaceBox T={T} style={{ marginBottom:12 }}><div style={{ fontSize:DS.font.sm, color:T.textSm }}>Sin métodos propios: el checkout usa el costo de envío configurado en cada plan.</div></SurfaceBox>}
        {rates.map((r, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:"2fr 1fr 1fr auto", gap:6, alignItems:"center", marginBottom:6 }}>
            <input value={r.name} onChange={e=>updRate(i,"name",e.target.value)} style={inl} placeholder="Nombre (ej. Andreani a domicilio)"/>
            <input type="number" min="0" value={r.price} onChange={e=>updRate(i,"price",e.target.value)} style={inl} placeholder="Precio $"/>
            <input value={r.code || ""} onChange={e=>updRate(i,"code",e.target.value)} style={inl} placeholder="Código (opcional)"/>
            {xBtn(()=>setRates(rs=>rs.filter((_,j)=>j!==i)))}
          </div>
        ))}
        <div style={{ marginTop:8 }}>{saveBtn("rates", { checkout_shipping_rates: rates.map(r => ({ name: r.name, price: parseInt(r.price, 10) || 0, code: r.code || "" })) })}</div>
      </Card>

      {/* Códigos de descuento */}
      <Card T={T}>
        <CardHeader T={T} title="Códigos de descuento" sub={<>"Solo recupero" = solo aplica con un link de recupero firmado (legado; el recupero de carritos ahora es por Klaviyo). "Solo 1er cobro" = las renovaciones van a precio pleno.</>}
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
            <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.recovery_only === true} onChange={e=>updCode(i,"recovery_only",e.target.checked)}/>Solo recupero</label>
            <label style={{ display:"flex", gap:5, alignItems:"center", whiteSpace:"nowrap", fontSize:DS.font.sm, color:T.textMd, cursor:"pointer" }}><input type="checkbox" style={chk} checked={c.first_charge_only === true} onChange={e=>updCode(i,"first_charge_only",e.target.checked)}/>Solo 1er cobro</label>
            <span style={{ marginLeft:"auto" }}>{xBtn(()=>setCodes(cs=>cs.filter((_,j)=>j!==i)))}</span>
          </div>
        ))}
        <div style={{ marginTop:8 }}>
          <Btn T={T} variant="primary" onClick={saveCodes} disabled={!!busy}>{busy==="codes" ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar códigos"}</Btn>
        </div>
      </Card>

      {/* Mails */}
      <Card T={T}>
        <CardHeader T={T} title="Mails a tus clientes" sub="El dominio del remitente tiene que estar verificado en Resend; si no, los mails salen con el remitente por defecto."/>
        <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 14px" }}>
          <Field T={T} label="Remitente (Nombre <mail@tudominio>)">
            <input value={emailFrom} onChange={e=>setEmailFrom(e.target.value)} style={iS} placeholder="Mi Tienda <hola@mitienda.com>"/>
          </Field>
          <Field T={T} label="Marca (título en los mails, máx 40)">
            <input value={emailBrand} onChange={e=>setEmailBrand(e.target.value)} style={iS} maxLength={40} placeholder="Mi Tienda"/>
          </Field>
          <Field T={T} label="Responder a">
            <input value={emailReply} onChange={e=>setEmailReply(e.target.value)} style={iS} placeholder="ayuda@mitienda.com"/>
          </Field>
          <Field T={T} label="Color de acento (#hex, vacío = color del widget)">
            <input value={emailAccent} onChange={e=>setEmailAccent(e.target.value)} style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} placeholder="#10b981"/>
          </Field>
        </div>
        {saveBtn("email", { email_from: emailFrom, email_brand: emailBrand, email_reply_to: emailReply, email_accent: emailAccent })}
        <Divider T={T}/>
        <SectionTitle T={T} sub="Manda el mail de activación con tu remitente y marca. Máx 10 por día · solo a tu mail o al dominio del remitente.">Probar los mails</SectionTitle>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <input value={testTo} onChange={e=>setTestTo(e.target.value)} style={{ ...inl, maxWidth:260 }} placeholder="mail de prueba"/>
          <Btn T={T} variant="secondary" size="sm" onClick={sendTest} disabled={!!busy}>{busy==="test" ? <><Spinner size={12} color={T.textMd}/> Enviando…</> : "Enviar mail de prueba"}</Btn>
        </div>
      </Card>

      {/* Recupero de carritos → Klaviyo (la secuencia propia se retiró el 2026-09-13) */}
      <Callout T={T} tone="info" title="Recupero de carritos abandonados">
        El recupero de carritos ahora se hace desde <strong style={{ color:T.text }}>Klaviyo → Integraciones</strong>: cada checkout de suscripción llega a tu cuenta como "Checkout Started" (igual que un carrito de Shopify) y la secuencia de mails la armás allá. La secuencia propia de 3 mails con cupones ya no se envía.
      </Callout>

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
