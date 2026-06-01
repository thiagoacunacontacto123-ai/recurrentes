import React, { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.js";

// Dashboard del comerciante — Integraciones, Planes, Suscriptores, Cobros.
export default function Dashboard({ user, onLogout }) {
  const [tab, setTab] = useState("inicio");
  const [merchant, setMerchant] = useState(null);
  const [loading, setLoading] = useState(true);

  async function reloadMerchant() {
    const d = await apiGet("merchant");
    setMerchant(d?.merchant || null);
    setLoading(false);
  }

  useEffect(() => { reloadMerchant(); }, []);

  // Si volvimos de OAuth Shopify (callback nos puso ?shopify_pending=<state>),
  // reclamamos el token para asociarlo al uid actual y limpiamos la URL.
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const pending = q.get("shopify_pending");
    if (!pending) return;
    apiPost("shopify/claim-pending", { state: pending }).then(d => {
      if (d?.ok) {
        window.history.replaceState(null, "", window.location.pathname + "#/dashboard");
        reloadMerchant();
      } else if (d?.error) {
        alert("Error conectando Shopify: " + d.error);
      }
    });
  }, []);

  const integrationsReady = Boolean(merchant?.shopify_token && merchant?.mp_access_token);

  return (
    <div style={{minHeight:"100vh",display:"flex",background:"var(--bg)"}}>
      <aside style={{width:230,background:"var(--surface)",borderRight:"1px solid var(--border)",display:"flex",flexDirection:"column",position:"sticky",top:0,height:"100vh"}}>
        <div style={{padding:"18px 18px 14px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",gap:9}}>
          <div style={{width:30,height:30,borderRadius:8,background:"linear-gradient(135deg, var(--green), var(--green-dark))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🔁</div>
          <span style={{fontWeight:800,fontSize:16,letterSpacing:-0.3}}>Recurrentes</span>
        </div>
        <nav style={{flex:1,padding:8,display:"flex",flexDirection:"column",gap:2}}>
          {NAV.map(item => (
            <button key={item.id} onClick={()=>setTab(item.id)} style={{
              display:"flex",alignItems:"center",gap:9,padding:"9px 11px",border:"none",borderRadius:8,cursor:"pointer",
              background: tab === item.id ? "rgba(16,185,129,0.12)" : "transparent",
              color: tab === item.id ? "var(--accent)" : "var(--text-md)",
              fontWeight: tab === item.id ? 700 : 500,
              fontSize:13,fontFamily:"inherit",textAlign:"left",
            }}>
              <span style={{fontSize:15}}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div style={{padding:12,borderTop:"1px solid var(--border)"}}>
          <div style={{fontSize:11,color:"var(--text-sm)",marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
          <button onClick={onLogout} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:6,padding:"5px 10px",fontSize:11,width:"100%",cursor:"pointer",fontFamily:"inherit"}}>Salir</button>
        </div>
      </aside>

      <main style={{flex:1,padding:"28px 32px",maxWidth:1200}}>
        {loading ? (
          <div style={{color:"var(--text-sm)",fontSize:14}}>Cargando…</div>
        ) : tab === "inicio" ? (
          integrationsReady
            ? <HomeTab onGoSubscribers={()=>setTab("suscriptores")}/>
            : <FirstStepsTab merchant={merchant} onGo={()=>setTab("integraciones")}/>
        ) : tab === "integraciones" ? (
          <IntegrationsTab merchant={merchant} onChange={reloadMerchant}/>
        ) : tab === "planes" ? (
          integrationsReady
            ? <PlansTab merchant={merchant}/>
            : <NeedsIntegrations title="Planes" onGo={()=>setTab("integraciones")}/>
        ) : tab === "suscriptores" ? (
          integrationsReady
            ? <SubscribersTab/>
            : <NeedsIntegrations title="Suscriptores" onGo={()=>setTab("integraciones")}/>
        ) : tab === "cobros" ? (
          integrationsReady
            ? <ChargesTab/>
            : <NeedsIntegrations title="Cobros" onGo={()=>setTab("integraciones")}/>
        ) : null}
      </main>
    </div>
  );
}

const NAV = [
  { id:"inicio",        label:"Inicio",        icon:"📊" },
  { id:"integraciones", label:"Integraciones", icon:"🔌" },
  { id:"planes",        label:"Planes",        icon:"🎯" },
  { id:"suscriptores",  label:"Suscriptores",  icon:"👥" },
  { id:"cobros",        label:"Cobros",        icon:"💸" },
];

// ─── Tab: Inicio (KPIs) ─────────────────────────────────────────

function HomeTab({ onGoSubscribers }) {
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

      {/* KPIs principales (4 cards grandes) */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(220px, 1fr))",gap:12,marginBottom:14}}>
        <KpiBig label="MRR" value={`$${stats.mrr.toLocaleString("es-AR")}`} sub="ingresos mensuales recurrentes" highlight/>
        <KpiBig label="Suscriptores activos" value={totals.active||0} sub={`${totals.paused||0} pausados`}/>
        <KpiBig label="Cobrado este mes" value={`$${(revenue.this_month?.amount||0).toLocaleString("es-AR")}`} sub={`${revenue.this_month?.count||0} cobros`} delta={deltaPct}/>
        <KpiBig label="Churn 30d" value={`${growth.churn_rate_pct||0}%`} sub={`${growth.cancelled_30d||0} cancelaciones`} negative={(growth.churn_rate_pct||0)>5}/>
      </div>

      {/* Funnel: nuevos vs cancelados */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,marginBottom:24}}>
        <KpiSmall label="Nuevos últimos 7d" value={growth.new_7d||0} positive/>
        <KpiSmall label="Nuevos últimos 30d" value={growth.new_30d||0} positive/>
        <KpiSmall label="Cancelados 30d" value={growth.cancelled_30d||0} negative/>
        <KpiSmall label="Pago falló" value={totals.payment_failed||0} negative={(totals.payment_failed||0)>0}/>
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

      {/* Snapshot de la cuenta */}
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"20px 22px"}}>
        <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:12}}>Estado de la cuenta</div>
        <div style={{display:"flex",gap:18,flexWrap:"wrap",fontSize:12}}>
          <StateBadge label="Activos" value={totals.active||0} color="var(--accent)"/>
          <StateBadge label="Pausados" value={totals.paused||0} color="var(--yellow)"/>
          <StateBadge label="Cancelados" value={totals.cancelled||0} color="var(--text-sm)"/>
          <StateBadge label="Pendientes" value={totals.pending||0} color="var(--text-md)"/>
          {totals.payment_failed > 0 && <StateBadge label="Pago falló" value={totals.payment_failed} color="var(--red)"/>}
        </div>
      </div>
    </div>
  );
}

function KpiBig({ label, value, sub, delta, highlight, negative }) {
  return (
    <div style={{background:"var(--card)",border:`1px solid ${highlight?"rgba(16,185,129,0.4)":"var(--border)"}`,borderRadius:14,padding:"18px 20px"}}>
      <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:8}}>{label}</div>
      <div style={{fontSize:28,fontWeight:800,letterSpacing:-0.6,color:highlight?"var(--accent)":negative?"var(--red)":"var(--text)",lineHeight:1}}>{value}</div>
      <div style={{display:"flex",alignItems:"center",gap:6,marginTop:8,fontSize:11,color:"var(--text-sm)"}}>
        <span>{sub}</span>
        {typeof delta === "number" && (
          <span style={{padding:"1px 6px",borderRadius:4,background:delta>=0?"rgba(16,185,129,0.15)":"rgba(239,68,68,0.15)",color:delta>=0?"var(--accent)":"var(--red)",fontWeight:700,letterSpacing:0.3}}>
            {delta>=0?"↑":"↓"} {Math.abs(delta)}%
          </span>
        )}
      </div>
    </div>
  );
}

function KpiSmall({ label, value, positive, negative }) {
  return (
    <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 14px"}}>
      <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:4}}>{label}</div>
      <div style={{fontSize:18,fontWeight:800,color:positive?"var(--accent)":negative?"var(--red)":"var(--text)"}}>{value}</div>
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

  async function connectShopify() {
    const shop = shopifyShop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!shop || !shop.endsWith(".myshopify.com")) {
      alert("Ingresá el dominio .myshopify.com (ej: mitienda.myshopify.com)");
      return;
    }
    if (!shopifyClientId.trim()) { alert("Pegá el Client ID (ID de cliente)"); return; }
    if (!shopifyClientSecret.trim()) { alert("Pegá el Client Secret (Secreto)"); return; }
    setShopifyBusy(true);
    // 1) Guardamos las creds del merchant en Firestore
    const d = await apiPost("shopify", { shop, client_id: shopifyClientId.trim(), client_secret: shopifyClientSecret.trim() }, { action: "save-creds" });
    if (d?.error) {
      setShopifyBusy(false);
      alert("Error: " + d.error);
      return;
    }
    // 2) Redirigimos al OAuth start con el uid del user (Shopify pide consent)
    const uid = (await import("../lib/firebase.js")).auth.currentUser?.uid;
    if (!uid) { setShopifyBusy(false); alert("Sesión expirada, recargá la página"); return; }
    window.location.href = `/api/shopify?action=oauth-start&uid=${encodeURIComponent(uid)}`;
  }

  async function connectMP() {
    const token = window.prompt("Pegá tu Access Token de Mercado Pago (Producción o TEST):\n\nLo conseguís en mercadopago.com.ar/developers → tu cuenta → Credenciales.");
    if (!token?.trim()) return;
    const d = await apiPatch("merchant", { access_token: token.trim() }, { action: "save-mp-token" });
    if (d?.error) alert("Error: " + d.error);
    else onChange?.();
  }

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
            <button onClick={()=>{setShopifyShop("");setShopifyClientId("");setShopifyClientSecret("");onChange?.();}} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
              Reconectar otra tienda
            </button>
          ) : (
            <>
              <label style={lblSmall}>Dominio Shopify</label>
              <input value={shopifyShop} onChange={e=>setShopifyShop(e.target.value)}
                placeholder="mitienda.myshopify.com"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:13,marginBottom:10,outline:"none",fontFamily:"inherit",boxSizing:"border-box"}}/>

              <label style={lblSmall}>Client ID <span style={{color:"var(--text-sm)",fontWeight:400}}>(ID de cliente)</span></label>
              <input value={shopifyClientId} onChange={e=>setShopifyClientId(e.target.value)}
                placeholder="b4ca9a62b9e9bf0bd79deba391333d22"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:12,marginBottom:10,outline:"none",fontFamily:"'Cascadia Code',monospace",boxSizing:"border-box"}}/>

              <label style={lblSmall}>Client Secret <span style={{color:"var(--text-sm)",fontWeight:400}}>(Secreto)</span></label>
              <input type="password" value={shopifyClientSecret} onChange={e=>setShopifyClientSecret(e.target.value)}
                placeholder="•••••••••••••••••••••••••••••••••"
                style={{width:"100%",background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:9,padding:"9px 12px",fontSize:12,marginBottom:12,outline:"none",fontFamily:"'Cascadia Code',monospace",boxSizing:"border-box"}}/>

              <button onClick={connectShopify} disabled={!shopifyShop.trim()||!shopifyClientId.trim()||!shopifyClientSecret.trim()||shopifyBusy} style={{width:"100%",background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:(shopifyShop.trim()&&shopifyClientId.trim()&&shopifyClientSecret.trim()&&!shopifyBusy)?"pointer":"not-allowed",fontFamily:"inherit",opacity:(shopifyShop.trim()&&shopifyClientId.trim()&&shopifyClientSecret.trim()&&!shopifyBusy)?1:0.5,marginBottom:10}}>
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
          <button onClick={connectMP} style={{background:mpOk?"transparent":"linear-gradient(135deg, var(--green), var(--green-dark))",border:mpOk?"1px solid var(--border)":"none",color:mpOk?"var(--text-md)":"#fff",padding:"9px 16px",borderRadius:9,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            {mpOk ? "Cambiar Access Token" : "Pegar Access Token"}
          </button>
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

      <WidgetSettingsCard merchant={merchant} onChange={onChange}/>
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
      <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.55,marginBottom:14}}>
        Personalizá cómo se ve el widget de suscripción en tu tienda. Aplica a todos los planes.
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

function PlansTab({ merchant }) {
  const [plans, setPlans] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [embedFor, setEmbedFor] = useState(null);

  async function loadAll() {
    setLoading(true);
    const [p, pr] = await Promise.all([apiGet("plans"), apiGet("shopify", { action: "products" })]);
    setPlans(p?.plans || []);
    setProducts(pr?.products || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Planes de suscripción</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>
            Convertí cualquier producto Shopify en suscripción recurrente.
          </p>
        </div>
        <button onClick={()=>setCreating(true)} style={{background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"10px 16px",borderRadius:10,fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"inherit",boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>
          + Nuevo plan
        </button>
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
                <button onClick={()=>setEmbedFor(p)} style={{flex:1,background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>📋 Snippet</button>
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
      {embedFor && <EmbedSnippetModal plan={embedFor} merchant={merchant} onClose={()=>setEmbedFor(null)}/>}
    </div>
  );
}

function NewPlanModal({ products, onClose }) {
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [frequency, setFrequency] = useState(30);
  const [discount, setDiscount] = useState(15);
  const [units, setUnits] = useState(1);
  // Envío
  const [shippingPrice, setShippingPrice] = useState(0);
  const [freeShipFrom, setFreeShipFrom] = useState(0);
  const [shippingName, setShippingName] = useState("Envío a domicilio");
  // Descuentos por cantidad — array de { min_qty, discount_pct }
  const [qtyTiers, setQtyTiers] = useState([]);
  const [saving, setSaving] = useState(false);

  const product = products.find(p => p.id === productId);
  const variant = product?.variants.find(v => v.id === variantId);
  const basePrice = variant?.price || 0;
  const subPrice = Math.round(basePrice * (1 - discount/100));

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
    if (!productId || !variantId) return alert("Elegí producto y variante");
    setSaving(true);
    const d = await apiPost("plans", {
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
      qty_discount_tiers: qtyTiers
        .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
        .sort((a, b) => a.min_qty - b.min_qty),
    });
    setSaving(false);
    if (d.error) alert("Error: " + d.error);
    else onClose();
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:16,zIndex:9999}} onClick={onClose}>
      <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:14,padding:"24px 26px",maxWidth:520,width:"100%",maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div style={{fontSize:17,fontWeight:700}}>Nuevo plan</div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:"var(--text-sm)",fontSize:20,cursor:"pointer"}}>✕</button>
        </div>

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

        <label style={lbl}>Unidades por envío (default cuando el cliente abre)</label>
        <input type="number" min="1" value={units} onChange={e=>setUnits(e.target.value)} style={inp}/>

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

        {/* ─── Descuentos por cantidad ───────────────────────────── */}
        <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid var(--border)"}}>
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
        </div>

        {variant && (
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

        <button onClick={save} disabled={saving || !variantId} style={{width:"100%",marginTop:18,background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"11px",borderRadius:10,fontSize:14,fontWeight:700,cursor:saving?"wait":"pointer",fontFamily:"inherit",opacity:(saving||!variantId)?0.6:1}}>
          {saving ? "Creando…" : "Crear plan"}
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

function SubscribersTab() {
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | active | paused | cancelled | pending | payment_failed
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState(null); // subscriber currently being viewed in modal

  async function load() {
    setLoading(true);
    // Solo leemos el estado actual de Firestore — el ÚNICO trigger que activa
    // un subscriber es el webhook MP (que confirma que MP procesó el pago).
    // Si una sub aparece como "Pendiente", o el webhook MP no llegó (falta
    // configurar webhook a nivel cuenta MP), o el cobro todavía no se procesó.
    const params = {};
    if (filter !== "all") params.status = filter;
    if (search.trim()) params.email = search.trim();
    const d = await apiGet("subscribers", params);
    setSubs(d?.subscribers || []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const filtered = subs;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18,gap:14,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,margin:"0 0 6px",letterSpacing:-0.5}}>Suscriptores</h1>
          <p style={{fontSize:13,color:"var(--text-sm)",margin:0,lineHeight:1.55}}>
            Tus clientes con suscripción activa. Click en uno para ver detalle y gestionar.
          </p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <select value={filter} onChange={e=>setFilter(e.target.value)} style={inp2}>
            <option value="all">Todos</option>
            <option value="active">Activos</option>
            <option value="paused">Pausados</option>
            <option value="cancelled">Cancelados</option>
            <option value="pending">Pendientes</option>
            <option value="payment_failed">Pago falló</option>
          </select>
          <input type="text" placeholder="🔍 Buscar email…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")load();}} style={{...inp2,minWidth:180}}/>
          <button onClick={load} style={{background:"var(--surface)",border:"1px solid var(--border)",color:"var(--text-md)",borderRadius:8,padding:"7px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>↻</button>
        </div>
      </div>

      {loading ? (
        <div style={{color:"var(--text-sm)",fontSize:13}}>Cargando…</div>
      ) : filtered.length === 0 ? (
        <div style={{background:"var(--card)",border:"1px dashed var(--border)",borderRadius:14,padding:"50px 30px",textAlign:"center"}}>
          <div style={{fontSize:36,marginBottom:10}}>👥</div>
          <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>{filter==="all"?"Todavía no hay suscriptores":"No hay suscriptores con ese filtro"}</div>
          <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.55,maxWidth:380,margin:"0 auto"}}>
            Cuando un cliente complete el checkout MP, aparece acá automáticamente.
          </div>
        </div>
      ) : (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(340px, 1fr))",gap:12}}>
          {filtered.map(s => (
            <button key={s.id} onClick={()=>setDetail(s)}
              style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",textAlign:"left",cursor:"pointer",fontFamily:"inherit",color:"var(--text)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:700,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{s.customer_name || s.customer_email}</div>
                <StatusBadge status={s.status}/>
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

      {detail && <SubscriberDetailModal sub={detail} onClose={()=>{setDetail(null); load();}}/>}
    </div>
  );
}

function StatusBadge({ status }) {
  const meta = {
    active:        { label:"Activa",    color:"var(--accent)",  bg:"rgba(16,185,129,0.15)" },
    pending:       { label:"Pendiente", color:"var(--yellow)",  bg:"rgba(245,158,11,0.15)" },
    paused:        { label:"Pausada",   color:"var(--yellow)",  bg:"rgba(245,158,11,0.15)" },
    cancelled:     { label:"Cancelada", color:"var(--text-sm)", bg:"rgba(126,138,147,0.15)" },
    payment_failed:{ label:"Pago falló",color:"var(--red)",     bg:"rgba(239,68,68,0.15)" },
  }[status] || { label: status || "—", color: "var(--text-sm)", bg: "rgba(126,138,147,0.15)" };
  return (
    <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:meta.bg,color:meta.color,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",flexShrink:0}}>
      {meta.label}
    </span>
  );
}

function SubscriberDetailModal({ sub, onClose }) {
  const [data, setData] = useState({ subscriber: sub, charges: [] });
  const [busyAction, setBusyAction] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("subscribers", { id: sub.id }).then(d => {
      if (d?.subscriber) setData(d);
      setLoading(false);
    });
  }, [sub.id]);

  async function doAction(action) {
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
          <StatusBadge status={status}/>
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

        {s.shipping_address && (
          <div style={{background:"var(--surface)",borderRadius:10,padding:"14px 16px",marginBottom:14}}>
            <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:8}}>Dirección de envío</div>
            <div style={{fontSize:12,color:"var(--text-md)",lineHeight:1.5}}>
              {s.shipping_address.address1}{s.shipping_address.address2?", "+s.shipping_address.address2:""}<br/>
              {s.shipping_address.city}{s.shipping_address.zip?" — CP "+s.shipping_address.zip:""}
            </div>
          </div>
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
          {/* Link manual de payment ID — escape hatch para cuando los endpoints
              search de MP están delayados y no devuelven el payment. */}
          <button onClick={()=>doAction("link-payment")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
            {busyAction==="link-payment"?"Linkeando…":"🔗 Linkear payment ID"}
          </button>
          {/* Simulador del próximo cobro recurrente — crea orden Shopify SIN
              pasar por MP. Útil para validar mes 2, 3, etc sin esperar 30 días. */}
          {status === "active" && (
            <button onClick={()=>doAction("simulate-charge")} disabled={busyAction} style={{...btnSec,opacity:busyAction?0.6:1}}>
              {busyAction==="simulate-charge"?"Simulando…":"🧪 Simular próximo cobro"}
            </button>
          )}
          {(status === "active" || status === "paused" || status === "payment_failed") && (
            <button onClick={()=>doAction("cancel")} disabled={busyAction} style={{...btnDan,opacity:busyAction?0.6:1}}>
              {busyAction==="cancel"?"Cancelando…":"✕ Cancelar"}
            </button>
          )}
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
                <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:c.error?"rgba(239,68,68,0.15)":"rgba(16,185,129,0.15)",color:c.error?"var(--red)":"var(--accent)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>
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

function ChargesTab() {
  const [charges, setCharges] = useState([]);
  const [totals, setTotals] = useState({ amount_ars:0, ok:0, failed:0, total:0 });
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const d = await apiGet("charges", { limit: 200 });
    setCharges(d?.charges || []);
    setTotals(d?.totals || { amount_ars:0, ok:0, failed:0, total:0 });
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

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
                <span title={c.error} style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:"rgba(239,68,68,0.15)",color:"var(--red)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase",cursor:"help"}}>✗ Falló</span>
              ) : (
                <span style={{fontSize:9,padding:"2px 7px",borderRadius:4,background:"rgba(16,185,129,0.15)",color:"var(--accent)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>✓ OK</span>
              )}
              <span style={{fontSize:10,color:"var(--text-sm)"}}>{c.status || ""}</span>
            </div>
          ))}
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
