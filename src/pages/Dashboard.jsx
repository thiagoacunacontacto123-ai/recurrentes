import React, { useState, useEffect, useMemo, useCallback } from "react";
import { apiGet, apiPost, apiPatch, apiDelete, apiSend, setActiveMerchantId } from "../lib/api.js";
import { auth } from "../lib/firebase.js";
import { sendEmailVerification } from "firebase/auth";
import { DS, useTheme } from "../ui/theme.js";
import { ToastContainer, PageView, toast, ErrorBoundary } from "../ui/components.jsx";
import { Sidebar, AppTopbar, MobileBottomNav, NewStoreModal, ManageStoreModal, NAV } from "../ui/Shell.jsx";
import SettingsPage from "./Settings.jsx";
import OnboardingWizard from "./Onboarding.jsx";
import PacksEditor, { packsFromPlan, serializePacks, validatePacks, pricingModeOf } from "./PacksEditor.jsx";
import WidgetDesigner from "./WidgetDesigner.jsx";

// Dashboard del comerciante — shell de Growith (sidebar + switcher de tiendas +
// topbar) con branding verde. La lógica de cada tab vive más abajo, intacta.
export default function Dashboard({ user, onLogout }) {
  const { T, darkMode, setDarkMode } = useTheme();
  const [tab, setTab] = useState(() => {
    try { const h = window.location.hash.replace(/^#\/?/, "").split("?")[0]; const t = h.split("/")[1]; return NAV.some(n => n.id === t) ? t : "inicio"; } catch (_) { return "inicio"; }
  });
  const [merchant, setMerchant] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [loading, setLoading] = useState(true);
  const [unverified, setUnverified] = useState(false);
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem("rec_sidebar_collapsed") === "1"; } catch (_) { return false; } });
  const [newStoreOpen, setNewStoreOpen] = useState(false);
  const [manageStoreId, setManageStoreId] = useState(null);
  const [onbDoneTick, setOnbDoneTick] = useState(0);

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
  // Onboarding: mientras falte Shopify o MP y no lo haya cerrado para esta tienda.
  const onbDone = useMemo(() => { try { return localStorage.getItem("rec_onb_done_" + merchantId) === "1"; } catch (_) { return false; } }, [merchantId, onbDoneTick]);
  const showOnboarding = !!merchant && !integrationsReady && !onbDone;
  const finishOnboarding = () => { try { localStorage.setItem("rec_onb_done_" + merchantId, "1"); } catch (_) {} setOnbDoneTick(t => t + 1); };

  if (unverified) return <><VerifyEmailScreen user={user} onLogout={onLogout} onRetry={reloadMerchant}/><ToastContainer T={T}/></>;

  const navItem = NAV.find(n => n.id === tab) || NAV[0];
  const shellProps = { T, nav: NAV, activeTab: tab, onTab: goTab, user, merchant, workspace: effectiveWorkspace, onSwitchStore: switchStore, onCreateStore: () => setNewStoreOpen(true), onManageStore: (id) => setManageStoreId(id), darkMode, setDarkMode, onLogout, alerts: {} };

  return (
    <div style={{minHeight:"100vh",display:"flex",background:T.bg,color:T.text,fontFamily:"'Inter',system-ui,sans-serif"}}>
      <Sidebar {...shellProps} collapsed={collapsed} setCollapsed={setCollapsed}/>

      <div className="main-content" style={{flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>
        <AppTopbar T={T} section={navItem.label} sectionId={navItem.id}>
          {effectiveWorkspace?.stores?.length > 1 && (
            <span className="hide-mobile" style={{fontSize:11,color:T.textSm,whiteSpace:"nowrap",padding:"0 4px"}}>
              Tienda: <strong style={{color:T.textMd}}>{(effectiveWorkspace.stores.find(s=>s.id===effectiveWorkspace.active_merchant_id)||effectiveWorkspace.stores[0]).name}</strong>
            </span>
          )}
        </AppTopbar>

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
              ) : tab === "inicio" ? (
                showOnboarding
                  ? <OnboardingWizard T={T} DS={DS} merchant={merchant} goTab={goTab} onDone={finishOnboarding}/>
                  : integrationsReady
                    ? <HomeTab onGoSubscribers={()=>goTab("suscriptores")} onGoCarts={()=>goTab("carritos")}/>
                    : <FirstStepsTab merchant={merchant} onGo={()=>goTab("integraciones")}/>
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
  );
}

// ─── Tab: Inicio (KPIs) ─────────────────────────────────────────

function HomeTab({ onGoSubscribers, onGoCarts }) {
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

  if (loading) return <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando métricas…</div>;
  if (err) return <div style={{color:"var(--red)",fontSize:13}}>Error: {err}</div>;
  if (!stats) return null;

  const totals = stats.totals || {};
  const revenue = stats.revenue || {};
  const growth = stats.growth || {};
  const deltaPct = revenue.delta_pct;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Inicio</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>Resumen del negocio recurrente.</p>
        </div>
        <button onClick={load} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>↻ Refrescar</button>
      </div>

      {/* KPIs principales (4 cards grandes) — basados SOLO en active/paused.
          Los carritos (pending/cancelled/payment_failed) no entran acá: son
          intentos abandonados y los gestionás desde el tab "Carritos". */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:12,marginBottom:14}}>
        <KpiBig label="MRR" value={`$${stats.mrr.toLocaleString("es-AR")}`} sub="ingresos mensuales recurrentes" highlight/>
        <KpiBig label="Suscriptores activos" value={totals.active||0} sub={`${totals.paused||0} pausados`}/>
        <KpiBig label="Cobrado este mes" value={`$${(revenue.this_month?.amount||0).toLocaleString("es-AR")}`} sub={`${revenue.this_month?.count||0} cobros`} delta={deltaPct}/>
        <KpiBig label="Churn 30d" value={`${growth.churn_rate_pct||0}%`} sub={`${growth.cancelled_30d||0} cancelaciones`} negative={(growth.churn_rate_pct||0)>5}/>
      </div>

      {/* Funnel: solo nuevos activos. Los cancelados/payment_failed los
          ves en el tab "Carritos". */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,marginBottom:24}}>
        <KpiSmall label="Nuevos últimos 7d" value={growth.new_7d||0} positive/>
        <KpiSmall label="Nuevos últimos 30d" value={growth.new_30d||0} positive/>
      </div>

      {/* Próximos cobros */}
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"20px 22px",marginBottom:14}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,gap:10}}>
          <div>
            <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:4}}>Próximos 7 días</div>
            <div style={{fontSize:16,fontWeight:700}}>Cobros que MP va a procesar</div>
          </div>
          {stats.upcoming_charges?.length > 0 && (
            <button onClick={onGoSubscribers} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"6px 11px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>Ver suscriptores →</button>
          )}
        </div>
        {stats.upcoming_charges?.length > 0 ? (
          <div>
            {stats.upcoming_charges.map(c => (
              <div key={c.subscriber_id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 0",borderBottom:"1px solid var(--border)",gap:10,fontSize:13}}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.customer_name || c.customer_email}</div>
                  <div style={{fontSize:10,color:"var(--text-sm)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.product_title}</div>
                </div>
                <div style={{textAlign:"right",flexShrink:0}}>
                  <div style={{fontWeight:700,color:"var(--accent)"}}>${(c.amount_ars||0).toLocaleString("es-AR")}</div>
                  <div style={{fontSize:10,color:"var(--text-sm)",marginTop:2}}>{c.date ? new Date(c.date).toLocaleDateString("es-AR",{day:"2-digit",month:"short"}) : "—"}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{fontSize:12,color:"var(--text-sm)",padding:"20px",textAlign:"center"}}>
            No hay cobros programados en los próximos 7 días.
          </div>
        )}
      </div>

      {/* Snapshot de la cuenta — SOLO subs vivas (active + paused). Los
          cancelled/pending/payment_failed se ven en el tab "Carritos". */}
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"20px 22px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,gap:10,flexWrap:"wrap"}}>
          <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>Suscripciones operativas</div>
          {((totals.pending||0) + (totals.cancelled||0) + (totals.payment_failed||0)) > 0 && (
            <button onClick={onGoCarts} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"6px 11px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
              Ver {(totals.pending||0) + (totals.cancelled||0) + (totals.payment_failed||0)} carritos →
            </button>
          )}
        </div>
        <div style={{display:"flex",gap:18,flexWrap:"wrap",fontSize:12}}>
          <StateBadge label="Activos" value={totals.active||0} color="var(--accent)"/>
          <StateBadge label="Pausados" value={totals.paused||0} color="var(--yellow)"/>
          <StateBadge label="Cancelados" value={totals.cancelled||0} color="var(--red)"/>
        </div>
      </div>
    </div>
  );
}

function KpiBig({ label, value, sub, delta, highlight, negative }) {
  return (
    <div style={{
      position:"relative", overflow:"hidden",
      background: highlight ? "linear-gradient(160deg, rgba(16,185,129,0.10), rgba(16,185,129,0.015) 55%, var(--card))" : "var(--card)",
      border:`1px solid ${highlight?"rgba(16,185,129,0.45)":"var(--border)"}`,
      borderRadius:16, padding:"18px 20px",
      boxShadow: highlight ? "0 10px 26px -16px rgba(16,185,129,0.45)" : "0 2px 12px -8px rgba(0,0,0,0.35)",
    }}>
      {highlight && <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:"linear-gradient(90deg,var(--accent),transparent 85%)"}}/>}
      <div style={{fontSize:10.5,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.6,marginBottom:9}}>{label}</div>
      <div style={{fontSize:29,fontWeight:800,letterSpacing:-0.7,color:highlight?"var(--accent)":negative?"var(--red)":"var(--text)",lineHeight:1,fontVariantNumeric:"tabular-nums"}}>{value}</div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:9,fontSize:11,color:"var(--text-sm)"}}>
        <span>{sub}</span>
        {typeof delta === "number" && (
          <span style={{padding:"1px 7px",borderRadius:5,background:delta>=0?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:delta>=0?"var(--accent)":"var(--red)",fontWeight:700,letterSpacing:0.3}}>
            {delta>=0?"↑":"↓"} {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}

function KpiSmall({ label, value, positive, negative }) {
  return (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"13px 15px"}}>
      <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:5}}>{label}</div>
      <div style={{fontSize:19,fontWeight:800,color:positive?"var(--accent)":negative?"var(--red)":"var(--text)",fontVariantNumeric:"tabular-nums"}}>{value}</div>
    </div>
  );
}

function StateBadge({ label, value, color }) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:6}}>
      <span style={{width:8,height:8,borderRadius:"50%",background:color}}/>
      <span style={{color:"var(--text-md)"}}>{label}: <strong style={{color:"var(--text)"}}>{value}</strong></span>
    </div>
  );
}

function FirstStepsTab({ merchant, onGo }) {
  const shopifyOk = Boolean(merchant?.shopify_token);
  const mpOk = Boolean(merchant?.mp_access_token);
  const done = (shopifyOk?1:0) + (mpOk?1:0);
  return (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Bienvenido a Recurrentes</h1>
      <p style={{fontSize:13,color:"var(--text-sm)",margin:"0 0 24px",lineHeight:1.55}}>
        Tres pasos para que tu tienda Shopify acepte suscripciones recurrentes con Mercado Pago.
      </p>

      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"22px 24px",marginBottom:16}}>
        <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:14}}>Progreso · {done}/3</div>

        {[
          { id:"shopify", label:"Conectar Shopify", desc:"Autorizá Recurrentes a leer productos y crear órdenes en tu tienda.", done: shopifyOk },
          { id:"mp",      label:"Conectar Mercado Pago", desc:"Pegá tu Access Token para procesar cobros recurrentes.", done: mpOk },
          { id:"plan",    label:"Crear tu primer plan", desc:"Convertí un producto Shopify en suscripción.", done: false },
        ].map(s => (
          <div key={s.id} style={{display:"flex",alignItems:"flex-start",gap:14,padding:"14px 0",borderBottom:"1px solid var(--border)"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:s.done?"var(--accent)":"var(--surface)",border:s.done?"none":"1px solid var(--border)",color:s.done?"#fff":"var(--text-sm)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,flexShrink:0}}>
              {s.done ? "✓" : ""}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:3,color:s.done?"var(--accent)":"var(--text)"}}>{s.label}</div>
              <div style={{fontSize:11,color:"var(--text-sm)",lineHeight:1.5}}>{s.desc}</div>
            </div>
          </div>
        ))}

        <button onClick={onGo} style={{marginTop:14,background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px 18px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>
          {done === 0 ? "Empezar →" : done === 1 ? "Continuar setup →" : "Falta poco →"}
        </button>
      </div>
    </div>
  );
}

// ─── Tab: Integraciones ─────────────────────────────────────────

function IntegrationsTab({ merchant, onChange }) {
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
      alert("Ingresá el dominio .myshopify.com (ej: mitienda.myshopify.com)");
      return;
    }
    if (!envApp && !shopifyClientId.trim()) { alert("Pegá el Client ID (ID de cliente)"); return; }
    if (!envApp && !shopifyClientSecret.trim()) { alert("Pegá el Client Secret (Secreto)"); return; }
    setShopifyBusy(true);
    // 1) Guardamos las creds del merchant en Firestore
    const d = await apiPost("shopify", { shop, client_id: shopifyClientId.trim(), client_secret: shopifyClientSecret.trim() }, { action: "save-creds" });
    if (d?.error) {
      setShopifyBusy(false);
      alert("Error: " + d.error);
      return;
    }
    // 2) oauth-start (autenticado) devuelve la URL de consent de Shopify.
    const o = await apiGet("shopify", { action: "oauth-start" });
    if (!o?.url) { setShopifyBusy(false); alert("Error: " + (o?.error || "no se pudo iniciar OAuth")); return; }
    window.location.href = o.url;
  }

  async function disconnectShopify() {
    if (!window.confirm("¿Desconectar Shopify? Se borra el token de acceso; las suscripciones siguen en MP pero no se van a generar órdenes hasta reconectar.")) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-shopify" });
    if (d?.error) alert("Error: " + d.error); else onChange?.();
  }

  async function connectMPOauth() {
    const d = await apiPost("merchant", {}, { action: "mp-oauth-start" });
    if (d?.url) window.location.href = d.url;
    else alert("Error: " + (d?.error || "OAuth MP no disponible"));
  }

  async function disconnectMP() {
    if (!window.confirm("¿Desconectar Mercado Pago? Se borra el token de nuestra base. Las suscripciones siguen cobrándose en MP, pero no vamos a poder procesarlas hasta reconectar.")) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-mp" });
    if (d?.error) alert("Error: " + d.error); else onChange?.();
  }

  async function connectMP() {
    const token = window.prompt("Pegá tu Access Token de Mercado Pago (Producción o TEST):\n\nLo conseguís en mercadopago.com.ar/developers → tu cuenta → Credenciales.");
    if (!token?.trim()) return;
    const d = await apiPatch("merchant", { access_token: token.trim() }, { action: "save-mp-token" });
    if (d?.error) alert("Error: " + d.error);
    else onChange?.();
  }

  async function connectMeta() {
    const pixel = window.prompt("Pegá tu Pixel ID de Meta (solo números):\n\nMeta Business Suite → Administrador de eventos → tu pixel → arriba, 'Copiar identificador'.");
    if (pixel === null) return;
    const token = window.prompt("Ahora pegá el token de la API de Conversiones (CAPI):\n\nEn el mismo pixel → Configuración → API de conversiones → Generar token de acceso.");
    if (token === null) return;
    const d = await apiPatch("merchant", { meta_pixel_id: pixel.trim(), meta_capi_token: token.trim() }, { action: "save-meta" });
    if (d?.error) alert("Error: " + d.error);
    else onChange?.();
  }

  async function disconnectMeta() {
    if (!window.confirm("¿Desconectar Meta? Las suscripciones dejarán de reportarse a Meta.")) return;
    const d = await apiPatch("merchant", { meta_pixel_id: "", meta_capi_token: "" }, { action: "save-meta" });
    if (d?.error) alert("Error: " + d.error);
    else onChange?.();
  }
  const metaOk = Boolean(merchant?.meta_connected);

  return (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Integraciones</h1>
      <p style={{fontSize:13,color:"var(--text-sm)",margin:"0 0 24px",lineHeight:1.55}}>
        Conectá tu tienda Shopify y tu cuenta de Mercado Pago. Necesitás ambas para crear planes y cobrar suscripciones.
      </p>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div style={{background:"var(--card)",border:`1px solid ${shopifyOk ? "rgba(16,185,129,0.4)" : "var(--border)"}`,borderRadius:14,padding:"20px 22px"}}>
          <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
            <div style={{width:42,height:42,borderRadius:10,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>🛍️</div>
            <div>
              <div style={{fontSize:15,fontWeight:700}}>Shopify</div>
              <div style={{fontSize:11,padding:"2px 7px",borderRadius:4,background:shopifyOk?"rgba(16,185,129,0.15)":"var(--surface)",color:shopifyOk?"var(--accent)":"var(--text-sm)",display:"inline-block",marginTop:4,fontWeight:600,letterSpacing:0.3}}>
                {shopifyOk ? `✓ ${merchant.shopify_shop}` : "Sin conectar"}
              </div>
            </div>
          </div>
          <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.55,marginBottom:14}}>
            Para leer productos, crear órdenes y manejar clientes.
          </div>

          {shopifyOk ? (
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>{setShopifyShop("");setShopifyClientId("");setShopifyClientSecret("");onChange?.();}} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                Reconectar
              </button>
              <button onClick={disconnectShopify} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-sm)",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Desconectar</button>
            </div>
          ) : (
            <>
              <label style={lblSmall}>Dominio Shopify</label>
              <input value={shopifyShop} onChange={e=>setShopifyShop(e.target.value)}
                placeholder="mitienda.myshopify.com"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:13,marginBottom:10,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>

              {envApp && <div style={{fontSize:11,color:"var(--text-sm)",marginBottom:10,lineHeight:1.5}}>Recurrentes ya tiene su app de Shopify: con el dominio alcanza. Client ID/Secret son opcionales (solo si querés usar una app propia).</div>}
              <label style={lblSmall}>Client ID <span style={{color:"var(--text-sm)",fontWeight:400}}>(ID de cliente{envApp ? ", opcional" : ""})</span></label>
              <input value={shopifyClientId} onChange={e=>setShopifyClientId(e.target.value)}
                placeholder="b4ca9a62b9e9bf0bd79deba391333d22"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:12,marginBottom:10,outline:"none",fontFamily:"'Cascadia Code',monospace",boxSizing:"border-box"}}/>

              <label style={lblSmall}>Client Secret <span style={{color:"var(--text-sm)",fontWeight:400}}>(Secreto)</span></label>
              <input type="password" value={shopifyClientSecret} onChange={e=>setShopifyClientSecret(e.target.value)}
                placeholder="•••••••••••••••••••••••••••••••••"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:12,marginBottom:12,outline:"none",fontFamily:"'Cascadia Code',monospace",boxSizing:"border-box"}}/>

              <button onClick={connectShopify} disabled={!shopifyFormOk||shopifyBusy} style={{width:"100%",background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:(shopifyFormOk&&!shopifyBusy)?"pointer":"not-allowed",fontFamily:"inherit",opacity:(shopifyFormOk&&!shopifyBusy)?1:0.5,marginBottom:10}}>
                {shopifyBusy ? "Conectando…" : "Conectar tienda →"}
              </button>

              <button onClick={()=>setShopifyGuide(g=>!g)} style={{width:"100%",background:"transparent",border:"none",color:"var(--text-sm)",padding:"6px",fontSize:11,cursor:"pointer",fontFamily:"inherit",textDecoration:"underline"}}>
                {shopifyGuide ? "Ocultar guía" : "❓ ¿Cómo creo la app y obtengo Client ID + Secret? (5 min)"}
              </button>
              {shopifyGuide && <ShopifyGuide/>}
            </>
          )}
        </div>

        <div style={{background:"var(--card)",border:`1px solid ${mpOk ? "rgba(16,185,129,0.4)" : "var(--border)"}`,borderRadius:14,padding:"20px 22px"}}>
          <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
            <div style={{width:42,height:42,borderRadius:10,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>💳</div>
            <div>
              <div style={{fontSize:15,fontWeight:700}}>Mercado Pago</div>
              <div style={{fontSize:11,padding:"2px 7px",borderRadius:4,background:mpOk?"rgba(16,185,129,0.15)":"var(--surface)",color:mpOk?"var(--accent)":"var(--text-sm)",display:"inline-block",marginTop:4,fontWeight:600,letterSpacing:0.3}}>
                {mpOk ? `✓ Conectada (${merchant.mp_user_id || "MP"})` : "Sin conectar"}
              </div>
            </div>
          </div>
          <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.55,marginBottom:14}}>
            Para crear suscripciones y procesar cobros recurrentes.
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {merchant?.mp_oauth_available && (
              <button onClick={connectMPOauth} style={{background:mpOk?"transparent":"linear-gradient(135deg, var(--green), var(--green-dark))",border:mpOk?"1px solid var(--border)":"none",color:mpOk?"var(--text-md)":"#fff",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
                {mpOk ? "Reconectar con OAuth" : "Conectar Mercado Pago (OAuth)"}
              </button>
            )}
            <button onClick={connectMP} style={{background:(mpOk||merchant?.mp_oauth_available)?"transparent":"linear-gradient(135deg, var(--green), var(--green-dark))",border:(mpOk||merchant?.mp_oauth_available)?"1px solid var(--border)":"none",color:(mpOk||merchant?.mp_oauth_available)?"var(--text-md)":"#fff",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
              {mpOk ? "Cambiar Access Token" : "Pegar Access Token"}
            </button>
            {mpOk && <button onClick={disconnectMP} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-sm)",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Desconectar</button>}
          </div>
          {mpOk && merchant?.mp_method && <div style={{fontSize:10,color:"var(--text-sm)",marginTop:8}}>Método: {merchant.mp_method === "oauth" ? "OAuth" : "token pegado"}</div>}
        </div>
      </div>

      {shopifyOk && mpOk && (
        <div style={{marginTop:24,padding:"16px 18px",background:"rgba(16,185,129,0.08)",border:"1px solid rgba(16,185,129,0.3)",borderRadius:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--accent)",marginBottom:4}}>✓ Todo listo</div>
          <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.55}}>
            Ahora andá a <strong>Planes</strong> y creá tu primer plan de suscripción a partir de un producto Shopify.
          </div>
        </div>
      )}

      {/* Meta Ads (opcional): reportar la primera venta de cada suscripción a Meta */}
      <div style={{marginTop:24,background:"var(--card)",border:`1px solid ${metaOk ? "rgba(16,185,129,0.4)" : "var(--border)"}`,borderRadius:14,padding:"20px 22px"}}>
        <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:14}}>
          <div style={{width:42,height:42,borderRadius:10,background:"var(--surface)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22}}>📊</div>
          <div style={{flex:1}}>
            <div style={{fontSize:15,fontWeight:700}}>Meta Ads <span style={{fontSize:11,fontWeight:500,color:"var(--text-sm)"}}>(opcional)</span></div>
            <div style={{fontSize:11,padding:"2px 7px",borderRadius:4,background:metaOk?"rgba(16,185,129,0.15)":"var(--surface)",color:metaOk?"var(--accent)":"var(--text-sm)",display:"inline-block",marginTop:4,fontWeight:600,letterSpacing:0.3}}>
              {metaOk ? `✓ Conectado (pixel ${merchant.meta_pixel_id})` : "Sin conectar"}
            </div>
          </div>
        </div>
        <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.6,marginBottom:14}}>
          Reportá a Meta la <strong>primera venta</strong> de cada suscripción (por la API de Conversiones, server-side) para que tus campañas la cuenten y optimicen mejor. <strong>Las renovaciones NO se reportan</strong> — así no inflás la atribución. Necesitás tu <strong>Pixel ID</strong> + el <strong>token de la API de Conversiones</strong>.
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={connectMeta} style={{background:metaOk?"transparent":"linear-gradient(135deg, var(--green), var(--green-dark))",border:metaOk?"1px solid var(--border)":"none",color:metaOk?"var(--text-md)":"#fff",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {metaOk ? "Cambiar credenciales" : "Conectar Meta"}
          </button>
          {metaOk && <button onClick={disconnectMeta} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-sm)",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Desconectar</button>}
        </div>
      </div>

      <WidgetSettingsCard merchant={merchant} onChange={onChange}/>
      <OperationalSettingsCard merchant={merchant} onChange={onChange}/>
    </div>
  );
}

// ─── Settings UX del widget (orden + default + color + textos) ──
function WidgetSettingsCard({ merchant, onChange }) {
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
    if (d?.error) { alert("Error: " + d.error); return; }
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
    onChange?.();
  }

  return (
    <div style={{marginTop:24,padding:"18px 22px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Apariencia del widget</div>
      <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.55,marginBottom:10}}>
        Personalizá cómo se ve el widget de suscripción en tu tienda. Aplica a todos los planes.
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",padding:"10px 12px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,marginBottom:14,fontSize:12,color:"var(--text-md)"}}>
        <span style={{flex:1,minWidth:200}}>🎨 El <strong style={{color:"var(--text)"}}>selector de packs</strong> (diseño, textos, tachado, por unidad) se configura en Planes → Diseño del selector.</span>
        <a href="#/dashboard/planes?designer=1" onClick={()=>{ try { window.location.hash = "#/dashboard/planes?designer=1"; window.location.reload(); } catch (_) {} }} style={{...btnSec,textDecoration:"none",padding:"6px 12px",fontSize:11}}>Abrir diseñador →</a>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div>
          <label style={lbl}>Cuál aparece primero</label>
          <select value={order} onChange={e=>setOrder(e.target.value)} style={inp}>
            <option value="sub_first">Suscripción primero</option>
            <option value="once_first">Compra única primero</option>
          </select>
        </div>
        <div>
          <label style={lbl}>Cuál está seleccionada por default</label>
          <select value={def} onChange={e=>setDef(e.target.value)} style={inp}>
            <option value="sub">Suscripción</option>
            <option value="once">Compra única</option>
          </select>
        </div>
      </div>

      <label style={lbl}>Color principal del widget</label>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <input type="color" value={color} onChange={e=>setColor(e.target.value)} style={{width:46,height:36,border:"1px solid var(--border)",borderRadius:7,padding:2,background:"transparent",cursor:"pointer"}}/>
        <input type="text" value={color} onChange={e=>setColor(e.target.value)} style={{...inp,marginBottom:0,maxWidth:120,fontFamily:"monospace",fontSize:12}} placeholder="#10b981"/>
        <div style={{flex:1,height:36,borderRadius:7,background:`linear-gradient(135deg, ${color}, ${color}cc)`,boxShadow:"0 2px 8px rgba(0,0,0,0.2)"}}/>
      </div>

      <label style={lbl}>Título del modo Suscripción (en el toggle)</label>
      <input type="text" value={subTitle} onChange={e=>setSubTitle(e.target.value)} style={inp} placeholder="Suscripción" maxLength={60}/>

      <label style={lbl}>Subtítulo del modo Suscripción (debajo del título)</label>
      <input type="text" value={subSubtitle} onChange={e=>setSubSubtitle(e.target.value)} style={inp} placeholder="Recibilo cada X días. Cancelá cuando quieras." maxLength={120}/>
      <div style={{fontSize:10,color:"var(--text-sm)",marginTop:-12,marginBottom:14,lineHeight:1.4}}>
        Dejá vacío para usar texto automático con la frecuencia de cada plan.
      </div>

      <label style={lbl}>Título del modo Compra única (en el toggle)</label>
      <input type="text" value={onceTitle} onChange={e=>setOnceTitle(e.target.value)} style={inp} placeholder="Compra única" maxLength={60}/>

      <label style={lbl}>Subtítulo del modo Compra única</label>
      <input type="text" value={onceSubtitle} onChange={e=>setOnceSubtitle(e.target.value)} style={inp} placeholder="Comprá una vez al precio normal." maxLength={120}/>

      <label style={lbl}>Texto del banner informativo (debajo del botón Suscribirme)</label>
      <textarea value={disclaimerText} onChange={e=>setDisclaimerText(e.target.value)} style={{...inp,fontFamily:"inherit",minHeight:90,resize:"vertical"}} placeholder="Dejá vacío para usar el texto automático sobre cómo funciona la suscripción..." maxLength={800}/>
      <div style={{fontSize:10,color:"var(--text-sm)",marginTop:-12,marginBottom:14,lineHeight:1.4}}>
        Texto explicativo que ve el cliente al final del widget. Dejá vacío para usar el texto default con frecuencia + crédito-only + cancelación.
      </div>

      <button onClick={save} disabled={saving} style={{background:saved?"var(--green-dark)":"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"9px 18px",borderRadius:9,fontSize:13,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"inherit",opacity:saving?0.7:1}}>
        {saving ? "Guardando…" : saved ? "✓ Guardado" : "Guardar"}
      </button>
      <div style={{fontSize:11,color:"var(--text-sm)",marginTop:10,lineHeight:1.5}}>
        Cambios visibles en la tienda en ~5 minutos (caché del widget). Forzá refresh con Cmd+Shift+R.
      </div>
    </div>
  );
}

// ─── Guía Shopify Custom App ────────────────────────────────────

function ShopifyGuide() {
  const redirectUrl = `${window.location.origin}/api/shopify/oauth-callback`;
  return (
    <div style={{marginTop:10,padding:"14px 16px",background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,fontSize:12,color:"var(--text-md)",lineHeight:1.55}}>
      <div style={{fontSize:11,fontWeight:700,color:"var(--text)",textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>📋 Cómo obtener Client ID + Secret (5 min)</div>
      <ol style={{paddingLeft:18,margin:0,display:"flex",flexDirection:"column",gap:8}}>
        <li>Entrá a <a href="https://dev.shopify.com/dashboard" target="_blank" rel="noopener noreferrer" style={{color:"var(--accent)"}}>dev.shopify.com/dashboard</a> con tu cuenta de Shopify.</li>
        <li>Click <strong>"Crear app"</strong> arriba a la derecha. Nombre: <code style={{background:"var(--bg)",padding:"1px 6px",borderRadius:4,fontSize:11}}>Recurrentes</code>. Click crear.</li>
        <li>En la sidebar izquierda de la app → <strong>"Configuración"</strong>.</li>
        <li>Buscá la sección <strong>"URLs"</strong> (o "URL de redirección") y agregá esta como Redirect URL permitida:
          <div style={{marginTop:6,padding:"8px 10px",background:"var(--bg)",borderRadius:6,fontFamily:"'Cascadia Code',monospace",fontSize:10,lineHeight:1.5,wordBreak:"break-all",color:"var(--accent)"}}>{redirectUrl}</div>
        </li>
        <li>Buscá la sección <strong>"Acceso a la API"</strong> o <strong>"Scopes / Permisos"</strong> y marcá:
          <div style={{marginTop:6,padding:"8px 10px",background:"var(--bg)",borderRadius:6,fontFamily:"'Cascadia Code',monospace",fontSize:10,lineHeight:1.7}}>
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
          <ul style={{marginTop:4,marginBottom:0,paddingLeft:14}}>
            <li><strong>ID de cliente</strong> — copialo y pegalo arriba en "Client ID"</li>
            <li><strong>Secreto</strong> — click el ojo 👁 para verlo, copialo y pegalo arriba en "Client Secret"</li>
          </ul>
        </li>
        <li>Pegá también tu dominio <code style={{background:"var(--bg)",padding:"1px 6px",borderRadius:4,fontSize:11}}>tu-tienda.myshopify.com</code> y click <strong>"Conectar tienda →"</strong>.</li>
        <li>Te redirige a Shopify para autorizar la app → click <strong>"Instalar app"</strong>. Volvés a Recurrentes y ya está conectada ✓.</li>
      </ol>
      <div style={{marginTop:12,padding:"8px 10px",background:"rgba(245,158,11,0.1)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:6,fontSize:11,color:"var(--text-md)"}}>
        ⚠ <strong>Importante</strong>: la Redirect URL que ponés en tu app de Shopify <strong>tiene que matchear exactamente</strong> la que te mostramos arriba (incluyendo http vs https). Si está mal, el OAuth falla.
      </div>
    </div>
  );
}

// ─── Tab: Planes ─────────────────────────────────────────────────

function PlansTab({ merchant, onMerchantChange }) {
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
    const v = window.prompt(
      `Repreciar suscriptores de "${p.product_title}"\n\nNuevo monto TOTAL por cobro (producto + envío, 1 paquete) que MP va a cobrar a TODAS las subs activas de este plan.\n⚠ Si tenés subs con varios paquetes, repreciarlas una por una desde el detalle del suscriptor.`,
      String(suggested || "")
    );
    if (v === null) return;
    const amount = Math.round(Number(v));
    if (!(amount > 0)) return alert("Monto inválido");
    if (!window.confirm(`¿Confirmás repreciar a $${amount.toLocaleString("es-AR")} por cobro? Aplica desde el próximo cobro.`)) return;
    const d = await apiPost("subscribers", { plan_id: p.id, new_amount: amount }, { action: "reprice" });
    if (d?.error) return alert("Error: " + d.error);
    alert(`✓ Repreciadas: ${d.updated} de ${d.total}` + (d.failed?.length ? `\n✗ Fallaron ${d.failed.length}:\n` + d.failed.slice(0, 5).map(f => `· ${f.id}: ${f.error}`).join("\n") : ""));
  }

  if (view === "designer") {
    return (
      <div>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
          <div>
            <button onClick={()=>setView("plans")} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:12,cursor:"pointer",fontFamily:"inherit",padding:0,marginBottom:6}}>← Volver a planes</button>
            <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Diseño del selector de packs</h1>
            <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>
              Cómo se ve el selector 1·2·3 en la página de producto. Aplica a todos los planes en modo packs.
            </p>
          </div>
        </div>
        {loading ? <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div> : <WidgetDesigner merchant={merchant} plans={plans} onSaved={onMerchantChange}/>}
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Planes de suscripción</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>
            Convertí cualquier producto Shopify en suscripción recurrente.
          </p>
          <p style={{fontSize:11,color:"var(--yellow)",margin:"6px 0 0",lineHeight:1.5}}>
            ⚠ Cambiar el precio de un plan NO afecta a las suscripciones existentes (MP mantiene el monto autorizado). Usá "Repreciar suscriptores" para actualizarlas.
          </p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={()=>setView("designer")} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",padding:"10px 14px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            🎨 Diseño del selector
          </button>
          <button onClick={()=>setCreating(true)} style={{background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>
            + Nuevo plan
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : plans.length === 0 ? (
        <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>🎯</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Todavía no creaste planes</div>
          <div style={{fontSize:12,color:"var(--text-sm)"}}>Tocá "+ Nuevo plan" para arrancar.</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(330px, 1fr))",gap:14}}>
          {plans.map(p => (
            <div key={p.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"16px 18px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:10,marginBottom:10}}>
                {p.product_image && <img src={p.product_image} alt="" style={{width:48,height:48,borderRadius:8,objectFit:"cover"}}/>}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.product_title}</div>
                  <div style={{fontSize:11,color:"var(--text-sm)",marginTop:2}}>Cada {p.frequency_days} días · {p.discount_pct||0}% OFF</div>
                  {pricingModeOf(p) === "packs" ? (
                    <span title="Recurrentes arma el selector de packs en tu tienda" style={{display:"inline-block",marginTop:6,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,background:"rgba(16,185,129,0.14)",color:"var(--accent)",letterSpacing:0.3}}>
                      Packs: {(p.packs||[]).map(k=>k.qty).join("·") || "—"}
                    </span>
                  ) : (
                    <span title="El precio, la cantidad y la frecuencia salen de tu tema" style={{display:"inline-block",marginTop:6,fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",letterSpacing:0.3}}>
                      Precio del tema
                    </span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"10px 0",borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)"}}>
                <div>
                  <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:600,letterSpacing:0.4}}>Precio sub</div>
                  <div style={{fontSize:17,fontWeight:800,color:"var(--accent)"}}>${(p.subscription_price_ars||0).toLocaleString("es-AR")}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:600,letterSpacing:0.4}}>Precio normal</div>
                  <div style={{fontSize:13,color:"var(--text-md)",textDecoration:"line-through"}}>${(p.base_price_ars||0).toLocaleString("es-AR")}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:6,marginTop:10}}>
                <button onClick={()=>setEditing(p)} style={{flex:1,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏️ Editar</button>
                <button onClick={()=>setEmbedFor(p)} style={{flex:1,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>📋 Snippet</button>
                <button onClick={()=>repricePlan(p)} title="Repreciar suscriptores de este plan" style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>💲</button>
                {/* Desactivar (soft): el plan deja de mostrarse pero las
                    subs ya creadas con ese plan siguen vivas. */}
                <button onClick={async()=>{
                  if (!window.confirm(`¿Desactivar plan "${p.product_title}"?\n\nQueda inactivo (no se muestra en la storefront) pero los suscriptores actuales siguen cobrando.`)) return;
                  await apiDelete("plans",{id:p.id});
                  loadAll();
                }} style={{background:"transparent",border:"1px solid rgba(245,158,11,0.4)",color:"var(--yellow)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} title="Desactivar (mantiene historial)">⏸</button>
                {/* Borrar definitivamente (hard): elimina el plan de Firestore.
                    El preapproval_plan en MP queda allá (hay que cancelarlo aparte). */}
                <button onClick={async()=>{
                  if (!window.confirm(`⚠️ BORRAR DEFINITIVAMENTE el plan "${p.product_title}"?\n\nEsto NO se puede deshacer. El plan se elimina de Firestore.\n\nNota: el preapproval_plan en MP queda intacto — si querés que las subs existentes paren de cobrar, cancelalas también en mercadopago.com.ar/subscriptions.`)) return;
                  await apiDelete("plans", { id: p.id, hard: "1" });
                  loadAll();
                }} style={{background:"transparent",border:"1px solid rgba(239,68,68,0.4)",color:"var(--red)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}} title="Borrar definitivamente">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && <NewPlanModal products={products} onClose={()=>{setCreating(false); loadAll();}}/>}
      {editing && <NewPlanModal products={products} editPlan={editing} onClose={()=>{setEditing(null); loadAll();}}/>}
      {embedFor && <EmbedSnippetModal plan={embedFor} merchant={merchant} onClose={()=>setEmbedFor(null)}/>}
    </div>
  );
}

function NewPlanModal({ products, onClose, editPlan }) {
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
    // Default sugerido: si hay tier previo agrega +2 al min_qty y +5% al discount
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
      if (perr) return alert(perr);
    }
    if (isEdit) {
      // Editar: solo se cambian los términos del plan (precio, descuento, envío,
      // frecuencia, niveles). El producto/variante y el id de MP no se tocan.
      if (!(parseFloat(editBasePrice) > 0)) return alert("El precio base tiene que ser mayor a 0");
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
      if (d.error) alert("Error: " + d.error);
      else { if (d.note) alert(d.note); onClose(); }
      return;
    }
    if (!productId || !variantId) return alert("Elegí producto y variante");
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
    if (d.error) alert("Error: " + d.error);
    else onClose();
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:9999}} onClick={onClose}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"24px 26px",maxWidth:pricingMode==="packs"?680:520,width:"100%",maxHeight:"90vh",overflowY:"auto",transition:"max-width 0.2s"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontSize:17,fontWeight:700}}>{isEdit ? "Editar plan" : "Nuevo plan"}</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        {isEdit ? (
          <>
            <label style={lbl}>Producto</label>
            <div style={{...inp,display:"flex",alignItems:"center",opacity:0.8,cursor:"default"}}>{editPlan.product_title}</div>
            <div style={{fontSize:11,color:"var(--text-sm)",margin:"-8px 0 12px"}}>El producto/variante no se cambia acá — editás precio, descuento, envío y niveles. Para cambiar el producto, creá un plan nuevo.</div>
            <label style={lbl}>Precio normal ($)</label>
            <input type="number" min="0" value={editBasePrice} onChange={e=>setEditBasePrice(e.target.value)} style={inp} placeholder="0"/>
          </>
        ) : (
          <>
            <label style={lbl}>Producto Shopify</label>
            <select value={productId} onChange={e=>{setProductId(e.target.value); setVariantId("");}} style={inp}>
              <option value="">— Elegí —</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>

            {product && (
              <>
                <label style={lbl}>Variante</label>
                <select value={variantId} onChange={e=>setVariantId(e.target.value)} style={inp}>
                  <option value="">— Elegí —</option>
                  {product.variants.map(v => <option key={v.id} value={v.id}>{v.title} — ${v.price.toLocaleString("es-AR")}</option>)}
                </select>
              </>
            )}
          </>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Frecuencia (días)</label>
            <input type="number" min="1" value={frequency} onChange={e=>setFrequency(e.target.value)} style={inp}/>
          </div>
          <div>
            <label style={lbl}>Descuento (%)</label>
            <input type="number" min="0" max="80" value={discount} onChange={e=>setDiscount(e.target.value)} style={inp}/>
          </div>
        </div>

        {/* ─── Precios y packs (modo packs | tema) ──────────────────── */}
        <PacksEditor
          mode={pricingMode} onModeChange={setPricingMode}
          packs={packs} onPacksChange={setPacks}
          basePrice={basePrice} discountPct={discount} frequencyDays={frequency}
          freqScales={freqScales} onFreqScalesChange={setFreqScales}
        />

        {pricingMode === "theme" && (
          <>
            <label style={lbl}>Unidades por envío (default cuando el cliente abre)</label>
            <input type="number" min="1" value={units} onChange={e=>setUnits(e.target.value)} style={inp}/>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,alignItems:"end"}}>
              <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text-md)",marginTop:12}}>
                <input type="checkbox" checked={allowCustomFreq} onChange={e=>setAllowCustomFreq(e.target.checked)}/>
                El cliente puede elegir otra frecuencia
              </label>
              <div>
                <label style={lbl}>Tope de descuento por pack (%)</label>
                <input type="number" min="0" max="80" value={maxPackDisc} onChange={e=>setMaxPackDisc(e.target.value)} style={inp}/>
              </div>
            </div>
          </>
        )}

        {/* ─── Envío ─────────────────────────────────────────────── */}
        <div style={{marginTop:18,paddingTop:14,borderTop:"1px solid var(--border)"}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:10}}>Envío</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={lbl}>Costo de envío ($)</label>
              <input type="number" min="0" value={shippingPrice} onChange={e=>setShippingPrice(e.target.value)} style={inp} placeholder="0"/>
            </div>
            <div>
              <label style={lbl}>Envío gratis desde ($)</label>
              <input type="number" min="0" value={freeShipFrom} onChange={e=>setFreeShipFrom(e.target.value)} style={inp} placeholder="0 = nunca gratis"/>
            </div>
          </div>
          <label style={lbl}>Nombre del método (lo que ve el cliente en Shopify)</label>
          <input type="text" value={shippingName} onChange={e=>setShippingName(e.target.value)} style={inp} placeholder="Envío a domicilio"/>
        </div>

        {/* ─── Descuentos por cantidad (solo modo tema: en packs cada pack ya tiene su precio) ── */}
        {pricingMode === "theme" && <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:"var(--text)"}}>Descuentos por cantidad</div>
            <button onClick={addTier} type="button" style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:7,padding:"5px 10px",fontSize:11,cursor:"pointer",fontFamily:"inherit",fontWeight:600}}>+ Agregar nivel</button>
          </div>
          {qtyTiers.length === 0 ? (
            <div style={{fontSize:11,color:"var(--text-sm)",padding:"10px 12px",background:"var(--surface)",borderRadius:8,lineHeight:1.5}}>
              Sin descuentos por cantidad. Agregá un nivel para premiar a clientes que pidan más paquetes (ej: desde 3 paquetes, 10% off extra).
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {qtyTiers.map((t, i) => (
                <div key={i} style={{display:"flex",gap:6,alignItems:"center",background:"var(--surface)",padding:"7px 10px",borderRadius:8}}>
                  <span style={{fontSize:11,color:"var(--text-sm)",whiteSpace:"nowrap"}}>Desde</span>
                  <input type="number" min="2" max="10" value={t.min_qty} onChange={e=>updateTier(i, "min_qty", e.target.value)} style={{...inp,marginBottom:0,padding:"6px 8px",width:60,fontSize:12}}/>
                  <span style={{fontSize:11,color:"var(--text-sm)",whiteSpace:"nowrap"}}>paquetes → descuento</span>
                  <input type="number" min="1" max="80" value={t.discount_pct} onChange={e=>updateTier(i, "discount_pct", e.target.value)} style={{...inp,marginBottom:0,padding:"6px 8px",width:50,fontSize:12}}/>
                  <span style={{fontSize:11,color:"var(--text-sm)"}}>%</span>
                  <button onClick={()=>removeTier(i)} type="button" style={{marginLeft:"auto",background:"transparent",border:"none",color:"var(--red)",fontSize:14,cursor:"pointer",padding:"0 4px"}} title="Quitar">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>}

        {(variant || (isEdit && basePrice > 0)) && pricingMode === "theme" && (
          <div style={{marginTop:14,padding:"12px 14px",background:"var(--surface)",borderRadius:10,fontSize:12}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
              <span style={{color:"var(--text-sm)"}}>Precio normal:</span>
              <span style={{fontWeight:600}}>${basePrice.toLocaleString("es-AR")}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span style={{color:"var(--accent)",fontWeight:700}}>Precio suscripción base:</span>
              <span style={{fontWeight:800,color:"var(--accent)",fontSize:14}}>${subPrice.toLocaleString("es-AR")} cada {frequency} días</span>
            </div>
          </div>
        )}

        <button onClick={save} disabled={saving || (!isEdit && !variantId)} style={{width:"100%",marginTop:18,background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"11px",borderRadius:10,fontSize:14,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"inherit",opacity:(saving||(!isEdit&&!variantId))?0.6:1}}>
          {saving ? (isEdit ? "Guardando…" : "Creando…") : (isEdit ? "Guardar cambios" : "Crear plan")}
        </button>
      </div>
    </div>
  );
}

function EmbedSnippetModal({ plan, merchant, onClose }) {
  const base = window.location.origin;
  const snippet = `<script src="${base}/widget.js?merchant=${merchant.id}" defer></script>`;
  const [copied, setCopied] = useState(false);

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:9999}} onClick={onClose}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"24px 26px",maxWidth:600,width:"100%"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontSize:17,fontWeight:700}}>Embed snippet</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{fontSize:13,color:"var(--text-md)",lineHeight:1.6,marginBottom:14}}>
          Pegá esto en el theme de tu Shopify, dentro de la página de producto (Online Store → Themes → Edit code → templates/product.json → al final del bloque buy_buttons o antes del cierre del form):
        </div>

        <pre style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px",fontSize:12,fontFamily:"'Cascadia Code',monospace",overflowX:"auto",margin:0}}>{snippet}</pre>

        <button onClick={async()=>{
          try { await navigator.clipboard.writeText(snippet); setCopied(true); setTimeout(()=>setCopied(false),2000); } catch(_) {}
        }} style={{width:"100%",marginTop:12,background:copied?"var(--green-dark)":"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
          {copied ? "✓ Copiado" : "📋 Copiar snippet"}
        </button>

        <div style={{marginTop:14,padding:"10px 12px",background:"var(--surface)",borderRadius:8,fontSize:11,color:"var(--text-sm)",lineHeight:1.55}}>
          El widget detecta automáticamente el producto que el cliente está viendo. Si hay plan activo para ese producto, muestra el toggle Compra única / Suscripción. Si no hay plan, no aparece nada.
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Suscriptores ──────────────────────────────────────────

function SubscribersTab({ mode = "active", devMode = false }) {
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
      if (!r.ok) { const d = await r.json().catch(() => ({})); return alert("Error: " + (d.error || r.status)); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `suscriptores-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) { alert("Error: " + e.message); }
  }

  const filtered = subs;
  const title = isCarts ? "Carritos de suscripción" : "Suscriptores activos";
  const subtitle = isCarts
    ? "Intentos abandonados, cancelados o con pago fallido. NO cuentan como MRR ni aparecen en Inicio."
    : "Clientes con suscripción activa cobrando recurrentemente. Click para gestionar.";
  const emptyTitle = isCarts ? "No hay carritos" : "Todavía no tenés suscriptores activos";
  const emptyDesc = isCarts
    ? "Cuando un cliente abandone el checkout o cancele su sub, aparece acá."
    : "Cuando un cliente complete el pago MP, aparece acá automáticamente.";

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>{title}</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>{subtitle}</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {isCarts && (
            <select value={filter} onChange={e=>setFilter(e.target.value)} style={inp2}>
              <option value="all">Todos los carritos</option>
              <option value="pending">Pendientes</option>
              <option value="cancelled">Cancelados</option>
              <option value="paused">Pausados</option>
              <option value="payment_failed">Pago falló</option>
            </select>
          )}
          <input type="text" placeholder="🔍 Buscar email…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")load();}} style={{...inp2,minWidth:180}}/>
          <button onClick={exportCsv} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>⬇ Exportar CSV</button>
          <button onClick={load} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>↻</button>
        </div>
      </div>

      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>{isCarts ? "🛒" : "👥"}</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>{emptyTitle}</div>
          <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.55,maxWidth:380,margin:"0 auto"}}>{emptyDesc}</div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))",gap:12}}>
          {filtered.map(s => (
            <button key={s.id} onClick={()=>setDetail(s)}
              style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",textAlign:"left",cursor:"pointer",fontFamily:"inherit",color:"var(--text)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{s.customer_name || s.customer_email}</div>
                <StatusBadge status={s.status} orderCount={(s.shopify_orders||[]).length}/>
              </div>
              <div style={{fontSize:11,color:"var(--text-sm)",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.customer_email}</div>
              <div style={{padding:"8px 10px",background:"var(--surface)",borderRadius:8,fontSize:11}}>
                <div style={{color:"var(--text-md)",fontWeight:600,marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  {s.plan_snapshot?.product_title || "—"}
                  {(s.quantity > 1) && <span style={{color:"var(--accent)"}}> × {s.quantity}</span>}
                </div>
                <div style={{color:"var(--text-sm)",display:"flex",justifyContent:"space-between"}}>
                  <span>${(s.plan_snapshot?.total_per_charge_ars || s.plan_snapshot?.subscription_price_ars || 0).toLocaleString("es-AR")} cada {s.plan_snapshot?.frequency_days||"-"}d</span>
                  <span>{(s.shopify_orders||[]).length} órden{(s.shopify_orders||[]).length===1?"":"es"}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {detail && <SubscriberDetailModal sub={detail} devMode={devMode} onClose={()=>{setDetail(null); load();}}/>}
    </div>
  );
}

function StatusBadge({ status, orderCount = 0 }) {
  // Si la sub está cancelled PERO tiene órdenes Shopify procesadas, lo
  // indicamos en el label para que el merchant no piense "el cliente no
  // pagó". Cancelled significa "no habrá más cobros" — pero los cobros
  // anteriores SÍ se hicieron y las órdenes existen.
  const cancelledLabel = orderCount > 0 ? `Cancelada · ${orderCount} cobro${orderCount>1?"s":""} OK` : "Cancelada";
  const meta = {
    active:        { label:"Activa",    color:"var(--accent)",  bg:"rgba(16,185,129,0.15)" },
    pending:       { label:"Pendiente", color:"var(--yellow)",  bg:"rgba(245,158,11,0.15)" },
    paused:        { label:"Pausada",   color:"var(--yellow)",  bg:"rgba(245,158,11,0.15)" },
    cancelled:     { label: cancelledLabel, color: orderCount > 0 ? "var(--green)" : "var(--text-sm)", bg: orderCount > 0 ? "rgba(16,185,129,0.10)" : "rgba(126,138,147,0.15)" },
    payment_failed:{ label:"Pago falló",color:"var(--red)",     bg:"rgba(239,68,68,0.15)" },
  }[status] || { label: status || "—", color: "var(--text-sm)", bg: "rgba(126,138,147,0.15)" };
  return (
    <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:meta.bg,color:meta.color,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",flexShrink:0}}>
      {meta.label}
    </span>
  );
}

function SubscriberDetailModal({ sub, onClose, devMode = false }) {
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

  async function doAction(action) {
    if (action === "delete") {
      const ok = window.confirm(
        `⚠️ BORRAR DEFINITIVAMENTE este subscriber?\n\n` +
        `Esto elimina el subscriber + todos sus charges de Firestore.\n` +
        `Intenta cancelar en MP (si todavía está activo); si MP da error lo ignora.\n\n` +
        `NO se puede deshacer. ¿Continuar?`
      );
      if (!ok) return;
      setBusyAction("delete");
      try {
        const r = await apiDelete("subscribers", { id: sub.id });
        if (r?.error) {
          alert("Error: " + r.error);
          setBusyAction(null);
        } else {
          alert(`✓ Subscriber borrado.\n${r.charges_deleted || 0} charges asociados eliminados.`);
          onClose();
        }
      } catch (e) {
        alert("Error: " + e.message);
        setBusyAction(null);
      }
      return;
    }
    if (action === "reprice") {
      const cur = data.subscriber?.plan_snapshot?.total_per_charge_ars || 0;
      const v = window.prompt(`Nuevo monto TOTAL por cobro para este suscriptor (hoy $${cur.toLocaleString("es-AR")}). Se actualiza en Mercado Pago y aplica desde el próximo cobro.`, String(cur || ""));
      if (v === null) return;
      const amount = Math.round(Number(v));
      if (!(amount > 0)) return alert("Monto inválido");
      setBusyAction("reprice");
      try {
        const d = await apiPost("subscribers", { id: sub.id, new_amount: amount }, { action: "reprice" });
        if (d?.error) alert("Error: " + d.error);
        else if (d.failed?.length) alert("No se pudo repreciar: " + d.failed[0].error);
        else alert(`✓ Repreciado a $${amount.toLocaleString("es-AR")} por cobro.`);
        const refreshed = await apiGet("subscribers", { id: sub.id });
        if (refreshed?.subscriber) setData(refreshed);
      } catch (e) { alert("Error: " + e.message); }
      finally { setBusyAction(null); }
      return;
    }
    if (action === "simulate-charge") {
      const ok = window.confirm("Simular el próximo cobro recurrente?\n\nVa a crear una orden Shopify nueva como si MP hubiera cobrado el siguiente mes, SIN cobrar plata real. Solo para testear que el flow de cobros recurrentes funciona.");
      if (!ok) return;
      setBusyAction("simulate-charge");
      try {
        const d = await apiPost("subscribers", {}, { action: "simulate-charge", id: sub.id });
        if (d?.error) {
          alert("Error: " + d.error);
        } else if (d.status === "ok") {
          alert(`✓ Simulado cobro #${d.charge_number}\nOrden Shopify: #${d.shopify_order_id}\nMonto: $${(d.amount_ars || 0).toLocaleString("es-AR")}`);
        } else {
          alert(`Falló: ${d.shopify_error || d.error || "desconocido"}`);
        }
        const refreshed = await apiGet("subscribers", { id: sub.id });
        if (refreshed?.subscriber) setData(refreshed);
      } catch (e) {
        alert("Error: " + e.message);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    if (action === "link-payment") {
      // Pedimos el payment_id al merchant (lo saca del panel de MP del comprador).
      const paymentId = window.prompt(
        "Pegá el ID del pago de MP (N.° de operación) — lo ves en mercadopago.com.ar → Actividad → click sobre el cobro de este cliente.\n\nEsto crea la orden Shopify usando ese payment_id específico (escape hatch para cuando MP no nos devuelve el payment por search)."
      );
      if (!paymentId || !paymentId.trim()) return;
      setBusyAction("link-payment");
      try {
        const d = await apiPost("subscribers", { payment_id: paymentId.trim() }, { action: "link-payment", id: sub.id });
        if (d?.error) {
          alert("Error: " + d.error);
        } else if (d.status === "linked") {
          alert(`✓ Payment ${paymentId} linkeado.\nOrden Shopify: #${d.shopify_order_id || "(error)"}\nMonto: $${(d.amount_ars || 0).toLocaleString("es-AR")}` + (d.shopify_error ? `\n\n⚠️ Shopify: ${d.shopify_error}` : ""));
        } else if (d.status === "already_linked") {
          alert(`Este payment ya estaba linkeado.\nOrden Shopify: #${d.shopify_order_id}`);
        } else {
          alert(`Resultado: ${d.status || "?"}\n${d.error || ""}`);
        }
        const refreshed = await apiGet("subscribers", { id: sub.id });
        if (refreshed?.subscriber) setData(refreshed);
      } catch (e) {
        alert("Error: " + e.message);
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
          alert("Error: " + d.error);
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
          alert(msg);
        }
        const refreshed = await apiGet("subscribers", { id: sub.id });
        if (refreshed?.subscriber) setData(refreshed);
      } catch (e) {
        alert("Error de red: " + e.message);
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
          alert("Error: " + r.error);
        } else {
          let msg = "✓ Sub marcada como ACTIVA";
          if (r.mp_preapproval_linked) {
            msg += `\n\nLinkeada al preapproval MP: ${r.mp_preapproval_id}`;
            if (r.next_charge_at) {
              msg += `\nPróximo cobro: ${new Date(r.next_charge_at).toLocaleString("es-AR")}`;
            }
          } else {
            msg += "\n\nNo encontramos preapproval activo en MP via search, pero igual está activa localmente. Cuando MP cobre el próximo mes, el webhook va a llegar con external_reference y va a crear la orden Shopify normal.";
          }
          alert(msg);
          const refreshed = await apiGet("subscribers", { id: sub.id });
          if (refreshed?.subscriber) setData(refreshed);
        }
      } catch (e) {
        alert("Error de red: " + e.message);
      } finally {
        setBusyAction(null);
      }
      return;
    }
    const ok = window.confirm({
      pause: "¿Pausar esta suscripción? No se cobra más hasta reactivar.",
      resume: "¿Reactivar esta suscripción?",
      cancel: "¿Cancelar definitivamente esta suscripción? No se puede deshacer.",
    }[action]);
    if (!ok) return;
    setBusyAction(action);
    const r = await apiPatch("subscribers", { action }, { id: sub.id });
    setBusyAction(null);
    if (r?.error) {
      alert("Error: " + r.error);
    } else {
      const refreshed = await apiGet("subscribers", { id: sub.id });
      if (refreshed?.subscriber) setData(refreshed);
    }
  }

  const s = data.subscriber;
  const charges = data.charges || [];
  const status = s?.status || "unknown";
  const plan = s?.plan_snapshot || {};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.65)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:9999}} onClick={onClose}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"24px 26px",maxWidth:620,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,gap:14}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,marginBottom:4}}>{s.customer_name || s.customer_email}</div>
            <div style={{fontSize:12,color:"var(--text-sm)"}}>{s.customer_email}{s.customer_phone?` · ${s.customer_phone}`:""}</div>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:18}}>
          <StatusBadge status={status} orderCount={(s?.shopify_orders||[]).length}/>
          <span style={{fontSize:11,color:"var(--text-sm)"}}>desde {s.created_at?new Date(s.created_at).toLocaleDateString("es-AR"):"—"}</span>
        </div>
        <div style={{background:"var(--surface)",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
          <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:8}}>Plan</div>
          <div style={{fontSize:13,fontWeight:600,marginBottom:6}}>{plan.product_title || "—"}</div>
          {(() => {
            const qty = s.quantity || plan.units_per_shipment || 1;
            const unit = plan.subscription_price_ars || 0;
            const total = plan.total_per_charge_ars || (unit * qty);
            return (
              <div style={{fontSize:11,color:"var(--text-md)"}}>
                <strong>${total.toLocaleString("es-AR")}</strong> cada {plan.frequency_days||"-"} días
                <span style={{color:"var(--text-sm)"}}> · {qty} paquete{qty===1?"":"s"} × ${unit.toLocaleString("es-AR")} c/u</span>
              </div>
            );
          })()}
        </div>

        <div style={{background:"var(--surface)",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>Dirección de envío</div>
            <button onClick={()=>setEditingAddress(true)} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:6,padding:"4px 10px",fontSize:10,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>✏️ Editar</button>
          </div>
          <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.5}}>
            {s.shipping_address?.address1
              ? <>
                  {s.shipping_address.address1}{s.shipping_address.address2?", "+s.shipping_address.address2:""}<br/>
                  {s.shipping_address.city}{s.shipping_address.province?", "+s.shipping_address.province:""}{s.shipping_address.zip?" — CP "+s.shipping_address.zip:""}
                </>
              : <span style={{color:"var(--red)",fontWeight:700}}>⚠️ Sin dirección — editá para arreglar</span>
            }
          </div>
        </div>
        {editingAddress && (
          <EditAddressModal
            sub={s}
            onClose={()=>setEditingAddress(false)}
            onSaved={async()=>{
              setEditingAddress(false);
              const refreshed = await apiGet("subscribers", { id: sub.id });
              if (refreshed?.subscriber) setData(refreshed);
            }}
          />
        )}

        {/* Acciones */}
        <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
          {status === "active" && (
            <button onClick={()=>doAction("pause")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
              {busyAction==="pause"?"Pausando…":"⏸ Pausar"}
            </button>
          )}
          {status === "paused" && (
            <button onClick={()=>doAction("resume")} disabled={busyAction} style={{...btnPri,opacity:busyAction?0.6:1}}>
              {busyAction==="resume"?"Reactivando…":"▶ Reactivar"}
            </button>
          )}
          {/* Sync manual: idempotente, intenta procesar todos los pagos
              aprobados que no tengan orden Shopify creada todavía. También
              sirve en subs cancelled para recuperar pagos hechos antes de
              cancelar. */}
          <button onClick={()=>doAction("sync")} disabled={busyAction} style={{...btnPri,opacity:busyAction?0.6:1}}>
            {busyAction==="sync"?"Sincronizando…":"⟳ Sincronizar con MP"}
          </button>
          {/* Marcar como activa: fuerza el sub local a "active". El merchant
              verificó manualmente en MP que la sub sigue cobrando — confiamos
              en eso. Best-effort linkea el preapproval si lo encontramos;
              cuando MP cobre el próximo mes, el webhook matchea por
              external_reference=mid:sid y crea la orden Shopify normal. */}
          {(status === "cancelled" || status === "paused" || status === "pending") && (
            <button onClick={()=>doAction("resync")} disabled={busyAction} style={{...btnPri,opacity:busyAction?0.6:1,background:"var(--green)",borderColor:"var(--green)"}}>
              {busyAction==="resync"?"Marcando…":"✓ Marcar como activa (sigue en MP)"}
            </button>
          )}
          {/* Link manual de payment ID — escape hatch para cuando los endpoints
              search de MP están delayados y no devuelven el payment. */}
          <button onClick={()=>doAction("link-payment")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
            {busyAction==="link-payment"?"Linkeando…":"🔗 Linkear payment ID"}
          </button>
          {/* Simulador del próximo cobro recurrente — crea orden Shopify SIN
              pasar por MP. Útil para validar mes 2, 3, etc sin esperar 30 días. */}
          {(status === "active" || status === "paused") && (
            <button onClick={()=>doAction("reprice")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
              {busyAction==="reprice"?"Repreciando…":"💲 Repreciar"}
            </button>
          )}
          {/* Solo en modo desarrollador (Integraciones → Configuración): crea una orden SIMULADA (sin mails ni pago). */}
          {status === "active" && devMode && (
            <button onClick={()=>doAction("simulate-charge")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
              {busyAction==="simulate-charge"?"Simulando…":"🧪 Simular próximo cobro"}
            </button>
          )}
          {(status === "active" || status === "paused" || status === "payment_failed") && (
            <button onClick={()=>doAction("cancel")} disabled={busyAction} style={{...btnDan,opacity:busyAction?0.6:1}}>
              {busyAction==="cancel"?"Cancelando…":"✕ Cancelar"}
            </button>
          )}
          {/* Borrar definitivamente — elimina el sub + charges de Firestore.
              Best effort para cancelar en MP si todavía está activo. Útil para
              limpiar tests basura que no quedaron bien sincronizados con MP. */}
          <button onClick={()=>doAction("delete")} disabled={busyAction} style={{...btnDan,opacity:busyAction?0.6:1,background:"rgba(239,68,68,0.15)"}}>
            {busyAction==="delete"?"Borrando…":"🗑 Borrar definitivamente"}
          </button>
        </div>

        {/* Historial de cargos */}
        <div>
          <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:10}}>Historial de cobros</div>
          {loading ? (
            <div style={{fontSize:12,color:"var(--text-sm)"}}>Cargando…</div>
          ) : charges.length === 0 ? (
            <div style={{fontSize:12,color:"var(--text-sm)",padding:"14px",background:"var(--surface)",borderRadius:8,textAlign:"center"}}>
              Sin cargos todavía
            </div>
          ) : charges.map(c => (
            <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderBottom:"1px solid var(--border)",fontSize:12}}>
              <div>
                <div style={{fontWeight:600}}>${(c.amount_ars||0).toLocaleString("es-AR")}</div>
                <div style={{fontSize:10,color:"var(--text-sm)",marginTop:2}}>{new Date(c.created_at).toLocaleString("es-AR")}</div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                {c.shopify_order_id && <span style={{fontSize:10,color:"var(--text-sm)",fontFamily:"'Cascadia Code',monospace"}}>orden #{c.shopify_order_id}</span>}
                <span title={c.error || ""} style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:c.error?"rgba(239,68,68,0.15)":"rgba(16,185,129,0.15)",color:c.error?"var(--red)":"var(--accent)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",cursor:c.error?"help":"default"}}>
                  {c.error?"✗ ERROR":"✓ OK"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Cobros ─────────────────────────────────────────────────

// ─── Tab: Carritos abandonados ──────────────────────────────────
function AbandonedTab() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const btnSec = {background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"};

  async function load() {
    setLoading(true);
    const d = await apiGet("subscribers", { action: "abandoned" });
    setList(d?.abandoned || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function copyEmails() {
    const emails = list.map(x => x.email).filter(Boolean).join(", ");
    try { navigator.clipboard.writeText(emails); setCopied(true); setTimeout(()=>setCopied(false), 1500); } catch (_) {}
  }
  const fmtDate = iso => { try { return new Date(iso).toLocaleString("es-AR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); } catch(e){ return "—"; } };

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Carritos abandonados</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>Clientas que iniciaron el checkout de suscripción y no completaron el pago (+45 min). Base para el flujo de recupero.</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          {list.length>0 && <button onClick={copyEmails} style={btnSec}>{copied ? "✓ Copiado" : "📋 Copiar emails"}</button>}
          <button onClick={load} style={btnSec}>↻</button>
        </div>
      </div>
      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : list.length === 0 ? (
        <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>📭</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>No hay carritos abandonados</div>
          <div style={{fontSize:12,color:"var(--text-sm)"}}>Cuando alguien inicie el checkout y no pague, aparece acá a los 45 min.</div>
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{fontSize:12,color:"var(--text-sm)"}}>{list.length} recuperable{list.length===1?"":"s"}</div>
          {list.map(a => (
            <div key={a.id} style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:14,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name || a.email}</div>
                <div style={{fontSize:12,color:"var(--text-sm)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.email}{a.phone ? ` · ${a.phone}` : ""}</div>
                <div style={{fontSize:12,color:"var(--text-md)",marginTop:4}}>{a.product_title || "—"}{a.quantity>1 ? ` × ${a.quantity}` : ""} · ${(a.value_ars||0).toLocaleString("es-AR")} · {fmtDate(a.created_at)}{a.capture ? " · lead" : ""}</div>
                <div style={{fontSize:11,color:a.abandoned_step ? "#8b5cf6" : "var(--text-sm)",marginTop:3}}>
                  {a.abandoned_step ? `📭 Mail paso ${a.abandoned_step} enviado ${a.abandoned_step_at ? fmtDate(a.abandoned_step_at) : ""}` : "Sin mails de recupero enviados"}
                </div>
              </div>
              {a.recover_url && <a href={a.recover_url} target="_blank" rel="noreferrer" style={{...btnSec,textDecoration:"none"}} title={a.recover_url}>Ver en la tienda →</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab: Actividad (Mails / Envíos / Facturación) ─────────────────
function ActivityTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("mails");
  const btnSec = {background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"};

  async function load() {
    setLoading(true);
    const d = await apiGet("stats", { action: "activity" });
    setData(d || {});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const fmtDate = iso => { try { return new Date(iso).toLocaleString("es-AR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}); } catch(e){ return "—"; } };
  const money = n => "$" + (n||0).toLocaleString("es-AR");

  const MAIL_LABEL = {
    activation:      { t:"Activación",     c:"#10b981", e:"✅" },
    cancellation:    { t:"Cancelación",    c:"#ef4444", e:"🚫" },
    payment_failed:  { t:"Pago fallido",   c:"#f59e0b", e:"⚠️" },
  };
  const mailLabel = (m) => {
    if (m.type === "abandoned") return { t:`Abandono · Paso ${m.step||1}`, c:"#8b5cf6", e:"📭" };
    return MAIL_LABEL[m.type] || { t:m.type, c:"var(--text-md)", e:"📧" };
  };

  const views = [
    { id:"mails",  label:"📧 Mails" },
    { id:"envios", label:"📦 Envíos" },
    { id:"cobros", label:"💵 Facturación" },
  ];

  const th = {textAlign:"left",fontSize:11,fontWeight:700,color:"var(--text-sm)",textTransform:"uppercase",letterSpacing:0.4,padding:"0 14px 8px"};
  const td = {fontSize:13,color:"var(--text-md)",padding:"11px 14px",borderTop:"1px solid var(--border)",verticalAlign:"top"};
  const chip = (label, val, col) => (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"12px 16px",minWidth:120}}>
      <div style={{fontSize:11,color:"var(--text-sm)",fontWeight:600,marginBottom:4}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,color:col||"var(--text)",letterSpacing:-0.5}}>{val}</div>
    </div>
  );
  const emptyBox = (emoji, txt) => (
    <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
      <div style={{fontSize:36,marginBottom:10}}>{emoji}</div>
      <div style={{fontSize:13,color:"var(--text-sm)"}}>{txt}</div>
    </div>
  );
  const tableWrap = (inner) => (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>{inner}</table></div>
    </div>
  );

  const ms = data?.mail_summary || {};
  const cs = data?.cobro_summary || {};
  const es = data?.envio_summary || {};

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Actividad</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>Resumen de los mails que manda Recurrentes, los envíos generados y la facturación de las suscripciones.</p>
        </div>
        <button onClick={load} style={btnSec}>↻</button>
      </div>

      <div style={{display:"flex",gap:6,marginBottom:18,flexWrap:"wrap"}}>
        {views.map(v => (
          <button key={v.id} onClick={()=>setView(v.id)} style={{
            padding:"8px 14px",borderRadius:9,border:"1px solid var(--border)",cursor:"pointer",fontFamily:"inherit",fontSize:13,
            fontWeight: view===v.id?700:500,
            background: view===v.id?"rgba(16,185,129,0.12)":"var(--surface)",
            color: view===v.id?"var(--accent)":"var(--text-md)",
          }}>{v.label}</button>
        ))}
      </div>

      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : view === "mails" ? (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {chip("Total enviados", ms.total||0)}
            {chip("Abandono P1", ms.abandoned_1||0, "#8b5cf6")}
            {chip("Abandono P2", ms.abandoned_2||0, "#8b5cf6")}
            {chip("Abandono P3", ms.abandoned_3||0, "#8b5cf6")}
            {chip("Activación", ms.activation||0, "#10b981")}
            {chip("Cancelación", ms.cancellation||0, "#ef4444")}
          </div>
          {(data?.mails||[]).length === 0 ? emptyBox("📭","Todavía no se envió ningún mail. Aparecen acá a medida que el sistema los manda.") : tableWrap(
            <><thead><tr><th style={th}>Fecha</th><th style={th}>Tipo</th><th style={th}>Cliente</th><th style={th}>Producto</th></tr></thead>
            <tbody>{data.mails.map(m => { const L = mailLabel(m); return (
              <tr key={m.id}>
                <td style={{...td,whiteSpace:"nowrap",color:"var(--text-sm)"}}>{fmtDate(m.created_at)}</td>
                <td style={td}><span style={{display:"inline-flex",alignItems:"center",gap:5,fontSize:12,fontWeight:700,color:L.c}}>{L.e} {L.t}</span>{m.coupon?<span style={{marginLeft:6,fontSize:11,fontWeight:700,color:"var(--text-sm)",border:"1px solid var(--border)",borderRadius:5,padding:"1px 5px"}}>{m.coupon}</span>:null}{m.status==="error"?<span style={{marginLeft:6,fontSize:11,color:"#ef4444"}}>error</span>:null}</td>
                <td style={td}><div style={{fontWeight:600}}>{m.customer_name||"—"}</div><div style={{fontSize:11,color:"var(--text-sm)"}}>{m.to}</div></td>
                <td style={{...td,color:"var(--text-sm)"}}>{m.product_title||"—"}</td>
              </tr>); })}</tbody></>
          )}
        </div>
      ) : view === "envios" ? (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {chip("Envíos totales", es.total||0)}
            {chip("Este mes", es.this_month||0, "#10b981")}
          </div>
          {(data?.envios||[]).length === 0 ? emptyBox("📦","Todavía no se generó ninguna orden de envío. Cada cobro aprobado crea una orden en Shopify.") : tableWrap(
            <><thead><tr><th style={th}>Fecha</th><th style={th}>Orden</th><th style={th}>Cliente</th><th style={th}>Producto</th></tr></thead>
            <tbody>{data.envios.map(e => (
              <tr key={e.id}>
                <td style={{...td,whiteSpace:"nowrap",color:"var(--text-sm)"}}>{fmtDate(e.created_at)}</td>
                <td style={td}>{e.order_url ? <a href={e.order_url} target="_blank" rel="noreferrer" style={{color:"var(--accent)",fontWeight:700,textDecoration:"none"}}>#{e.order_id} →</a> : <span style={{fontWeight:700}}>#{e.order_id}</span>}</td>
                <td style={td}><div style={{fontWeight:600}}>{e.customer_name||"—"}</div><div style={{fontSize:11,color:"var(--text-sm)"}}>{e.customer_email}</div></td>
                <td style={{...td,color:"var(--text-sm)"}}>{e.product_title||"—"}</td>
              </tr>))}</tbody></>
          )}
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {chip("Cobrado hoy", money(cs.today?.amount||0), "#10b981")}
            {chip("Cobros hoy", cs.today?.count||0)}
            {chip("Este mes", money(cs.this_month?.amount||0), "#10b981")}
            {chip("Cobros del mes", cs.this_month?.count||0)}
            {chip("Histórico", money(cs.all_time||0))}
          </div>
          {(data?.cobros||[]).length === 0 ? emptyBox("💵","Todavía no hay cobros registrados.") : tableWrap(
            <><thead><tr><th style={th}>Fecha</th><th style={th}>Monto</th><th style={th}>Estado</th><th style={th}>Cliente</th><th style={th}>Orden</th></tr></thead>
            <tbody>{data.cobros.map(c => { const okk = c.status!=="error" && c.status!=="rejected"; return (
              <tr key={c.id}>
                <td style={{...td,whiteSpace:"nowrap",color:"var(--text-sm)"}}>{fmtDate(c.created_at)}</td>
                <td style={{...td,fontWeight:800,fontVariantNumeric:"tabular-nums"}}>{money(c.amount)}</td>
                <td style={td}><span style={{fontSize:11,fontWeight:700,color:okk?"#10b981":"#ef4444"}}>{okk?"✓ aprobado":"✕ "+(c.status||"error")}</span></td>
                <td style={td}><div style={{fontWeight:600}}>{c.customer_name||"—"}</div><div style={{fontSize:11,color:"var(--text-sm)"}}>{c.customer_email}</div></td>
                <td style={{...td,color:"var(--text-sm)"}}>{c.order_id?`#${c.order_id}`:"—"}</td>
              </tr>); })}</tbody></>
          )}
        </div>
      )}
    </div>
  );
}

function ChargesTab() {
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
    if (!c.subscriber_id || !c.mp_payment_id) return alert("Este cobro no tiene suscriptor o payment_id asociado.");
    if (!window.confirm(`¿Reintentar la orden Shopify del cobro MP ${c.mp_payment_id}?`)) return;
    setRetrying(c.id);
    try {
      const d = await apiPost("subscribers", { id: c.subscriber_id, payment_id: String(c.mp_payment_id) }, { action: "retry-order" });
      if (d?.error) alert("Error: " + d.error);
      else if (d.shopify_order_id) alert(`✓ Orden Shopify #${d.shopify_order_id} creada.`);
      else alert(`No se pudo crear la orden: ${d.shopify_error || d.error || d.status || "sin detalle"}`);
      load();
    } catch (e) { alert("Error: " + e.message); }
    finally { setRetrying(null); }
  }

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Cobros</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>
            Historial de cobros recurrentes procesados por Mercado Pago.
          </p>
        </div>
        <button onClick={load} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>↻ Refrescar</button>
      </div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,marginBottom:18}}>
        <Kpi label="Total recaudado" value={`$${totals.amount_ars.toLocaleString("es-AR")}`} color="var(--accent)"/>
        <Kpi label="Cobros OK" value={totals.ok}/>
        <Kpi label="Cobros fallidos" value={totals.failed} color={totals.failed>0?"var(--red)":undefined}/>
        <Kpi label="Total cobros" value={totals.total}/>
      </div>

      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : charges.length === 0 ? (
        <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>💸</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>Sin cobros todavía</div>
          <div style={{fontSize:12,color:"var(--text-sm)"}}>Aparecen acá cuando MP procesa el primer pago de una suscripción.</div>
        </div>
      ) : (
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden"}}>
          {charges.map((c, i) => (
            <div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr auto auto auto",gap:14,alignItems:"center",padding:"12px 18px",borderBottom:i<charges.length-1?"1px solid var(--border)":"none",fontSize:12}}>
              <div style={{minWidth:0}}>
                <div style={{fontWeight:700,fontSize:14}}>${(c.amount_ars||0).toLocaleString("es-AR")}</div>
                <div style={{fontSize:10,color:"var(--text-sm)",marginTop:2}}>{new Date(c.created_at).toLocaleString("es-AR")}</div>
              </div>
              <div style={{fontSize:10,color:"var(--text-sm)",fontFamily:"'Cascadia Code',monospace",textAlign:"right"}}>
                <div>MP {c.mp_payment_id}</div>
                {c.shopify_order_id && <div>Shopify #{c.shopify_order_id}</div>}
              </div>
              {c.error ? (
                <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4,maxWidth:260}}>
                  <span title={c.error} style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:"rgba(239,68,68,0.15)",color:"var(--red)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",cursor:"help"}}>✗ Falló</span>
                  <span style={{fontSize:10,color:"var(--red)",textAlign:"right",lineHeight:1.3,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical"}} title={c.error}>{c.error}</span>
                  {!c.shopify_order_id && (
                    <button onClick={()=>retryOrder(c)} disabled={retrying===c.id} style={{...btnSec,padding:"4px 9px",fontSize:10,opacity:retrying===c.id?0.6:1}}>{retrying===c.id ? "Reintentando…" : "↻ Reintentar orden"}</button>
                  )}
                </div>
              ) : (
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"var(--accent)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>✓ OK</span>
              )}
              <span style={{fontSize:10,color:"var(--text-sm)"}}>{c.status || ""}</span>
            </div>
          ))}
          {cursor && (
            <div style={{padding:12,textAlign:"center"}}>
              <button onClick={()=>load(true)} disabled={loading} style={btnSec}>{loading ? "Cargando…" : "Cargar más"}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }) {
  return (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px"}}>
      <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>{label}</div>
      <div style={{fontSize:22,fontWeight:800,marginTop:6,letterSpacing:-0.4,color:color||"var(--text)"}}>{value}</div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function PlaceholderTab({ title, desc, next }) {
  return (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>{title}</h1>
      <p style={{fontSize:13,color:"var(--text-sm)",margin:"0 0 24px",lineHeight:1.55}}>{desc}</p>
      <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
        <div style={{fontSize:36,marginBottom:10}}>🚧</div>
        <div style={{fontSize:13,color:"var(--text-md)"}}>{next || "En construcción."}</div>
      </div>
    </div>
  );
}

function NeedsIntegrations({ title, onGo }) {
  return (
    <div>
      <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>{title}</h1>
      <div style={{marginTop:20,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:12,padding:"22px 24px"}}>
        <div style={{fontSize:13,fontWeight:700,color:"var(--yellow)",marginBottom:6}}>⚠ Falta conectar integraciones</div>
        <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.55,marginBottom:14}}>
          Necesitás conectar Shopify y Mercado Pago antes de usar esta sección.
        </div>
        <button onClick={onGo} style={{background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"8px 14px",borderRadius:8,fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
          Ir a Integraciones →
        </button>
      </div>
    </div>
  );
}

const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--text-md)", marginBottom:5, marginTop:12, textTransform:"uppercase", letterSpacing:0.4 };
const lblSmall = { display:"block", fontSize:11, fontWeight:600, color:"var(--text-md)", marginBottom:5, letterSpacing:0.3 };
const inp = { width:"100%", background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", borderRadius:9, padding:"9px 12px", fontSize:13, outline:"none", fontFamily:"inherit", boxSizing:"border-box" };
const inp2 = { background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", borderRadius:8, padding:"7px 11px", fontSize:12, outline:"none", fontFamily:"inherit" };
const btnPri = { border:"none", padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:"linear-gradient(135deg, var(--green), var(--green-dark))", color:"#fff" };
const btnSec = { border:"1px solid var(--border)", padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:"var(--surface)", color:"var(--text-md)" };
const btnDan = { border:"1px solid rgba(239,68,68,0.4)", padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", background:"transparent", color:"var(--red)" };

// ─── Modal para editar la dirección de un subscriber ──────────────
// Edita el shipping_address y propaga el cambio a TODAS las órdenes Shopify
// ya creadas + las que se generen en cobros recurrentes futuros.
function EditAddressModal({ sub, onClose, onSaved }) {
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
    if (!address1.trim()) return alert("Falta dirección (calle + número)");
    if (!city.trim())     return alert("Falta ciudad");
    if (!province)        return alert("Falta provincia");
    if (!zip.trim())      return alert("Falta código postal");
    const cleanTax = (taxId || "").replace(/[^0-9]/g, "");
    if (cleanTax && !(cleanTax.length === 7 || cleanTax.length === 8 || cleanTax.length === 11)) {
      return alert("DNI o CUIL/CUIT inválido. DNI son 7-8 dígitos, CUIL/CUIT son 11.");
    }
    setSaving(true);
    const r = await apiSend("subscribers", "PATCH",
      { address1, address2, city, province, zip, phone, customer_name: name, tax_id: cleanTax },
      { action: "update-address", id: sub.id }
    );
    setSaving(false);
    if (r?.error) { alert("Error: " + r.error); return; }
    let msg = "✓ Dirección actualizada en Recurrentes.";
    if (r.updated_orders?.length) msg += `\n📦 ${r.updated_orders.length} órdenes Shopify actualizadas.`;
    if (r.failed_orders?.length)  msg += `\n⚠️ ${r.failed_orders.length} órdenes Shopify fallaron al actualizar (verificá manual en Shopify Admin).`;
    alert(msg);
    onSaved?.();
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:99999}} onClick={onClose}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"24px 26px",maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div style={{fontSize:17,fontWeight:700}}>Editar dirección</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>
        <div style={{fontSize:11,color:"var(--text-sm)",marginBottom:14,lineHeight:1.5}}>
          Los cambios se aplican al sub Y a todas las órdenes Shopify ya creadas + las que se generen en cobros futuros.
        </div>

        <label style={lbl}>Nombre completo</label>
        <input type="text" value={name} onChange={e=>setName(e.target.value)} style={inp}/>

        <label style={lbl}>Teléfono</label>
        <input type="tel" value={phone} onChange={e=>setPhone(e.target.value)} style={inp}/>

        <label style={lbl}>DNI o CUIL / CUIT (solo números)</label>
        <input type="text" inputMode="numeric" value={taxId} onChange={e=>setTaxId(e.target.value.replace(/[^0-9]/g, ""))} style={inp} placeholder="12345678 ó 20123456789"/>
        <div style={{fontSize:10,color:"var(--text-sm)",marginTop:-12,marginBottom:14,lineHeight:1.4}}>
          7-8 dígitos para DNI · 11 dígitos para CUIL/CUIT. Se guarda como "Company" en la orden Shopify para facturación.
        </div>

        <label style={lbl}>Dirección (calle + número) *</label>
        <input type="text" value={address1} onChange={e=>setAddress1(e.target.value)} style={inp} placeholder="Av. Corrientes 1234"/>

        <label style={lbl}>Departamento / piso (opcional)</label>
        <input type="text" value={address2} onChange={e=>setAddress2(e.target.value)} style={inp} placeholder="Depto 4B"/>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Ciudad *</label>
            <input type="text" value={city} onChange={e=>setCity(e.target.value)} style={inp}/>
          </div>
          <div>
            <label style={lbl}>Código postal *</label>
            <input type="text" value={zip} onChange={e=>setZip(e.target.value)} style={inp}/>
          </div>
        </div>

        <label style={lbl}>Provincia *</label>
        <select value={province} onChange={e=>setProvince(e.target.value)} style={inp}>
          <option value="">— Seleccioná —</option>
          {["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"].map(p=>(
            <option key={p} value={p}>{p}</option>
          ))}
        </select>

        <button onClick={save} disabled={saving} style={{width:"100%",marginTop:18,background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"11px",borderRadius:10,fontSize:14,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"inherit",opacity:saving?0.6:1}}>
          {saving ? "Guardando…" : "Guardar y sincronizar con Shopify"}
        </button>
      </div>
    </div>
  );
}


// ─── Pantalla "Verificá tu email" (403 email_unverified del backend) ────────
function VerifyEmailScreen({ user, onLogout, onRetry }) {
  const [sent, setSent] = React.useState(() => { try { return sessionStorage.getItem("rec_verify_sent") === "1"; } catch (_) { return false; } });
  const [busy, setBusy] = React.useState(false);
  async function resend() {
    setBusy(true);
    try { await sendEmailVerification(auth.currentUser); setSent(true); try { sessionStorage.setItem("rec_verify_sent", "1"); } catch (_) {} }
    catch (e) { alert("No se pudo reenviar: " + (e.message || e.code)); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true);
    try { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); await onRetry?.(); }
    finally { setBusy(false); }
  }
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:"var(--bg)"}}>
      <div style={{maxWidth:440,width:"100%",background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:"28px 26px",textAlign:"center"}}>
        <div style={{fontSize:40,marginBottom:12}}>📬</div>
        <h1 style={{fontSize:20,fontWeight:800,margin:"0 0 8px"}}>Verificá tu email</h1>
        <p style={{fontSize:13,color:"var(--text-md)",lineHeight:1.55,margin:"0 0 18px"}}>
          {sent ? "Te mandamos un mail para verificar tu cuenta a " : "Para operar necesitamos verificar "}<strong style={{color:"var(--text)"}}>{user?.email}</strong>. Abrí el link del mail y después tocá "Ya verifiqué".
        </p>
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={check} disabled={busy} style={btnPri}>{busy ? "…" : "Ya verifiqué"}</button>
          <button onClick={resend} disabled={busy} style={btnSec}>Reenviar mail</button>
          <button onClick={onLogout} style={btnSec}>Salir</button>
        </div>
      </div>
    </div>
  );
}

// ─── Configuración operativa: mails, abandono, envíos del checkout, cupones, dev ──
// Guarda PARCIAL por sección con merchant?action=save-settings (solo lo que se manda).
export function OperationalSettingsCard({ merchant, onChange }) {
  const m = merchant || {};
  const [emailFrom, setEmailFrom]     = React.useState(m.email_from || "");
  const [emailBrand, setEmailBrand]   = React.useState(m.email_brand || "");
  const [emailReply, setEmailReply]   = React.useState(m.email_reply_to || "");
  const [emailAccent, setEmailAccent] = React.useState(m.email_accent || "");
  const [storeDomain, setStoreDomain] = React.useState(m.store_domain || "");
  const [rates, setRates]             = React.useState(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []);
  const [abandoned, setAbandoned]     = React.useState(m.abandoned_enabled === true);
  const [cp2, setCp2]                 = React.useState(m.abandoned_coupons?.step2?.code || "");
  const [cp3, setCp3]                 = React.useState(m.abandoned_coupons?.step3?.code || "");
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
    setAbandoned(m.abandoned_enabled === true); setCp2(m.abandoned_coupons?.step2?.code || ""); setCp3(m.abandoned_coupons?.step3?.code || "");
    setDevMode(m.dev_mode === true); setHideSel(m.widget_hide_selector || ""); setFlow(m.widget_checkout_flow || "redirect"); setPagePath(m.widget_checkout_page_path || "");
    setCodes(Array.isArray(m.discount_codes) ? m.discount_codes : []);
    // eslint-disable-next-line
  }, [merchant]);

  async function save(section, body) {
    setBusy(section);
    const d = await apiPatch("merchant", body, { action: "save-settings" });
    setBusy("");
    if (d?.error) return alert("Error: " + d.error);
    onChange?.();
  }
  async function saveCodes() {
    setBusy("codes");
    const d = await apiPatch("merchant", { discount_codes: codes }, { action: "save-discount-codes" });
    setBusy("");
    if (d?.error) return alert("Error: " + d.error);
    onChange?.();
  }
  async function sendTest(step) {
    if (!testTo.trim()) return alert("Ingresá el mail destino (tu mail de cuenta o uno del dominio del remitente)");
    setBusy("test");
    const d = await apiPost("merchant", { to: testTo.trim(), step }, { action: "test-email" });
    setBusy("");
    if (d?.error) return alert("Error: " + d.error);
    alert(`✓ Mail de prueba (paso ${step}) enviado a ${testTo.trim()}. Quedan ${d.remaining ?? "?"} pruebas hoy.`);
  }
  const updRate = (i, k, v) => setRates(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const updCode = (i, k, v) => setCodes(cs => cs.map((c, j) => j === i ? { ...c, [k]: v } : c));
  const activeCodes = codes.filter(c => c.code && c.active !== false);
  const sec = { marginTop:18, paddingTop:14, borderTop:"1px solid var(--border)" };
  const h = { fontSize:13, fontWeight:700, marginBottom:4 };
  const saveBtn = (section, body) => (
    <button onClick={()=>save(section, body)} disabled={!!busy} style={{...btnPri,marginTop:10,opacity:busy?0.6:1}}>{busy===section ? "Guardando…" : "Guardar"}</button>
  );

  return (
    <div style={{marginTop:24,padding:"18px 22px",background:"var(--card)",border:"1px solid var(--border)",borderRadius:12}}>
      <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>Configuración</div>
      <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.55}}>Remitente de mails, tienda, envíos del checkout, cupones y recupero de carritos.</div>

      {/* Tienda */}
      <div style={sec}>
        <div style={h}>Tienda</div>
        <label style={lbl}>Dominio público de la tienda (sin https://)</label>
        <input value={storeDomain} onChange={e=>setStoreDomain(e.target.value)} style={inp} placeholder="www.mitienda.com"/>
        <label style={lbl}>Ruta de la página de checkout de suscripción</label>
        <input value={pagePath} onChange={e=>setPagePath(e.target.value)} style={inp} placeholder="/pages/suscripcion-form"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Flujo del checkout del widget</label>
            <select value={flow} onChange={e=>setFlow(e.target.value)} style={inp}>
              <option value="redirect">Redirigir a la página de checkout</option>
              <option value="inline">Inline (formulario en el producto)</option>
            </select>
          </div>
          <div>
            <label style={lbl}>Selector CSS a ocultar en modo suscripción</label>
            <input value={hideSel} onChange={e=>setHideSel(e.target.value)} style={inp} placeholder=".product-form__buttons, ..."/>
          </div>
        </div>
        {saveBtn("store", { store_domain: storeDomain, widget_checkout_page_path: pagePath, widget_checkout_flow: flow, widget_hide_selector: hideSel })}
      </div>

      {/* Envíos del checkout */}
      <div style={sec}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={h}>Métodos de envío del checkout</div>
          {rates.length < 6 && <button type="button" onClick={()=>setRates(rs=>[...rs,{name:"",price:0,code:""}])} style={{...btnSec,padding:"5px 10px",fontSize:11}}>+ Agregar</button>}
        </div>
        <div style={{fontSize:11,color:"var(--text-sm)",lineHeight:1.5,marginBottom:8}}>Lo que el cliente elige al suscribirse y queda en cada orden recurrente. Sin tarifas → se usa el envío del plan.</div>
        {rates.map((r, i) => (
          <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr auto",gap:6,alignItems:"center",marginBottom:6}}>
            <input value={r.name} onChange={e=>updRate(i,"name",e.target.value)} style={{...inp,marginBottom:0}} placeholder="Nombre (ej. Andreani a domicilio)"/>
            <input type="number" min="0" value={r.price} onChange={e=>updRate(i,"price",e.target.value)} style={{...inp,marginBottom:0}} placeholder="Precio $"/>
            <input value={r.code || ""} onChange={e=>updRate(i,"code",e.target.value)} style={{...inp,marginBottom:0}} placeholder="Código (opcional)"/>
            <button type="button" onClick={()=>setRates(rs=>rs.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",color:"var(--red)",cursor:"pointer",fontSize:14}}>✕</button>
          </div>
        ))}
        {saveBtn("rates", { checkout_shipping_rates: rates.map(r => ({ name: r.name, price: parseInt(r.price, 10) || 0, code: r.code || "" })) })}
      </div>

      {/* Códigos de descuento */}
      <div style={sec}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={h}>Códigos de descuento</div>
          <button type="button" onClick={()=>setCodes(cs=>[...cs,{code:"",type:"percent",value:10,active:true,recovery_only:false,first_charge_only:false}])} style={{...btnSec,padding:"5px 10px",fontSize:11}}>+ Agregar</button>
        </div>
        <div style={{fontSize:11,color:"var(--text-sm)",lineHeight:1.5,marginBottom:8}}>"Solo recupero" = solo aplica desde el link del mail de abandono. "Solo 1er cobro" = las renovaciones van a precio pleno.</div>
        {codes.map((c, i) => (
          <div key={i} style={{display:"grid",gridTemplateColumns:"1.4fr 1fr 0.8fr auto auto auto auto",gap:6,alignItems:"center",marginBottom:6,fontSize:11}}>
            <input value={c.code} onChange={e=>updCode(i,"code",e.target.value.toUpperCase())} style={{...inp,marginBottom:0,fontFamily:"monospace"}} placeholder="CODIGO"/>
            <select value={c.type || "percent"} onChange={e=>updCode(i,"type",e.target.value)} style={{...inp,marginBottom:0}}>
              <option value="percent">% off</option>
              <option value="fixed">$ fijo</option>
            </select>
            <input type="number" min="0" value={c.value} onChange={e=>updCode(i,"value",e.target.value)} style={{...inp,marginBottom:0}}/>
            <label style={{display:"flex",gap:4,alignItems:"center",whiteSpace:"nowrap"}}><input type="checkbox" checked={c.active !== false} onChange={e=>updCode(i,"active",e.target.checked)}/>Activo</label>
            <label style={{display:"flex",gap:4,alignItems:"center",whiteSpace:"nowrap"}}><input type="checkbox" checked={c.recovery_only === true} onChange={e=>updCode(i,"recovery_only",e.target.checked)}/>Solo recupero</label>
            <label style={{display:"flex",gap:4,alignItems:"center",whiteSpace:"nowrap"}}><input type="checkbox" checked={c.first_charge_only === true} onChange={e=>updCode(i,"first_charge_only",e.target.checked)}/>Solo 1er cobro</label>
            <button type="button" onClick={()=>setCodes(cs=>cs.filter((_,j)=>j!==i))} style={{background:"transparent",border:"none",color:"var(--red)",cursor:"pointer",fontSize:14}}>✕</button>
          </div>
        ))}
        <button onClick={saveCodes} disabled={!!busy} style={{...btnPri,marginTop:10,opacity:busy?0.6:1}}>{busy==="codes" ? "Guardando…" : "Guardar códigos"}</button>
      </div>

      {/* Mails */}
      <div style={sec}>
        <div style={h}>Mails a tus clientes</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Remitente (Nombre &lt;mail@tudominio&gt;)</label>
            <input value={emailFrom} onChange={e=>setEmailFrom(e.target.value)} style={inp} placeholder="Mi Tienda <hola@mitienda.com>"/>
          </div>
          <div>
            <label style={lbl}>Marca (título en los mails, máx 40)</label>
            <input value={emailBrand} onChange={e=>setEmailBrand(e.target.value)} style={inp} maxLength={40} placeholder="Mi Tienda"/>
          </div>
          <div>
            <label style={lbl}>Responder a</label>
            <input value={emailReply} onChange={e=>setEmailReply(e.target.value)} style={inp} placeholder="ayuda@mitienda.com"/>
          </div>
          <div>
            <label style={lbl}>Color de acento (#hex, vacío = color del widget)</label>
            <input value={emailAccent} onChange={e=>setEmailAccent(e.target.value)} style={{...inp,fontFamily:"monospace"}} placeholder="#10b981"/>
          </div>
        </div>
        <div style={{fontSize:10,color:"var(--text-sm)",lineHeight:1.5,marginTop:-6}}>El dominio del remitente tiene que estar verificado en Resend; si no, los mails salen con el remitente por defecto.</div>
        {saveBtn("email", { email_from: emailFrom, email_brand: emailBrand, email_reply_to: emailReply, email_accent: emailAccent })}
        <div style={{display:"flex",gap:6,alignItems:"center",marginTop:10,flexWrap:"wrap"}}>
          <input value={testTo} onChange={e=>setTestTo(e.target.value)} style={{...inp,marginBottom:0,maxWidth:260}} placeholder="mail de prueba"/>
          {[1,2,3].map(st => <button key={st} onClick={()=>sendTest(st)} disabled={!!busy} style={{...btnSec,padding:"6px 10px",fontSize:11}}>Probar paso {st}</button>)}
          <span style={{fontSize:10,color:"var(--text-sm)"}}>Máx 10 por día · solo a tu mail o al dominio del remitente</span>
        </div>
      </div>

      {/* Abandono */}
      <div style={sec}>
        <div style={h}>Recupero de carritos abandonados</div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text)",marginTop:8}}>
          <input type="checkbox" checked={abandoned} onChange={e=>setAbandoned(e.target.checked)}/>
          Enviar la secuencia de 3 mails (15 min · 2 hs · 24 hs) a quienes no completan el pago
        </label>
        {abandoned && (
          <div style={{fontSize:11,color:"var(--yellow)",lineHeight:1.5,marginTop:6,padding:"8px 10px",background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.3)",borderRadius:8}}>
            ⚠ Al activarlo salen mails reales a tus clientes desde el remitente configurado arriba. Los pasos 2 y 3 son marketing con cupón: incluyen link de baja. Probá primero con "Probar paso N".
          </div>
        )}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div>
            <label style={lbl}>Cupón del paso 2 (2 hs)</label>
            <select value={cp2} onChange={e=>setCp2(e.target.value)} style={inp}>
              <option value="">Sin cupón</option>
              {activeCodes.map(c => <option key={c.code} value={c.code}>{c.code} ({c.type === "fixed" ? `$${c.value}` : `${c.value}%`})</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Cupón del paso 3 (24 hs)</label>
            <select value={cp3} onChange={e=>setCp3(e.target.value)} style={inp}>
              <option value="">Sin cupón</option>
              {activeCodes.map(c => <option key={c.code} value={c.code}>{c.code} ({c.type === "fixed" ? `$${c.value}` : `${c.value}%`})</option>)}
            </select>
          </div>
        </div>
        {saveBtn("abandoned", { abandoned_enabled: abandoned, abandoned_coupons: { step2: cp2 ? { code: cp2 } : null, step3: cp3 ? { code: cp3 } : null } })}
      </div>

      {/* Dev */}
      <div style={sec}>
        <div style={h}>Modo desarrollador</div>
        <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text)",marginTop:8}}>
          <input type="checkbox" checked={devMode} onChange={e=>setDevMode(e.target.checked)}/>
          Habilitar herramientas de prueba (ej. "Simular próximo cobro": crea una orden Shopify SIMULADA, sin cobro ni mails)
        </label>
        {saveBtn("dev", { dev_mode: devMode })}
      </div>
    </div>
  );
}
