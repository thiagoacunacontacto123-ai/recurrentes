import React from "react";
import { DS } from "../ui/theme.js";
import { BtnSolid, BtnSecondary } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { PricingTable } from "./Billing.jsx";
import { FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";

const F = "'Inter',system-ui,sans-serif";

// Landing pública de Recurrentes (tema T, marca verde). Comunicación en modo
// Argentina, para tiendas online: Shopify hoy; Tiendanube e Impultienda (ebooks)
// muy pronto. Los botones llevan a #/registro y #/login — el login vive en Auth.jsx.

// ─── Mapa "todo se conecta": tiendas → pasarelas → panel ─────────────────
// Estados honestos (ver CLAUDE.md → Integraciones evaluadas): live = ya
// funciona · soon = en desarrollo · radar = evaluando. Los descartados (Stripe
// en AR, pasarelas sin cobro recurrente) no aparecen.
const FLOW_STORES = [
  { n:"Shopify", s:"live" },
  { n:"Tiendanube", s:"soon" },
  { n:"Impultienda", s:"soon" },
  { n:"Empretienda", s:"radar" },
  { n:"Link de suscripción", s:"live" },
];
const FLOW_PAYMENTS = [
  { n:"Mercado Pago", s:"live" },
  { n:"Mobbex", s:"soon" },
  { n:"Stripe", s:"radar" },
  { n:"Whop", s:"radar" },
];
const FLOW_ACTIONS = [
  { t:"Cobro aprobado · $ 40.500", s:"live" },
  { t:"Orden #1042 creada en tu negocio", s:"live" },
  { t:"Klaviyo · Subscription Renewed", s:"live" },
  { t:"Factura B emitida en ARCA", s:"soon" },
  { t:"WhatsApp · aviso de tarjeta rechazada", s:"soon" },
];
const FLOW_STATUS = { live:"Disponible", soon:"Próximamente", radar:"En el radar" };
const FLOW_ITEM_H = 44;

// Curvas entre columnas en % del alto (los ítems tienen alto fijo y la columna
// usa space-around → el centro del ítem i está en (i + 0.5) / N).
//   mode "hub":   cada ítem de la izquierda → centro → cada ítem de la derecha
//   mode "merge": cada ítem de la izquierda → centro de la derecha
function FlowConnector({ T, left, right, mode }) {
  const y = (i, n) => ((i + 0.5) / n) * 100;
  const col = (s) => s === "live" ? T.accentSolid : s === "soon" ? T.yellow : T.textSm;
  const paths = [];
  if (mode === "hub") {
    left.forEach((it, i) => paths.push({ d:`M0,${y(i, left.length)} C25,${y(i, left.length)} 25,50 50,50`, s:it.s }));
    right.forEach((it, j) => paths.push({ d:`M50,50 C75,50 75,${y(j, right.length)} 100,${y(j, right.length)}`, s:it.s }));
  } else {
    left.forEach((it, i) => paths.push({ d:`M0,${y(i, left.length)} C50,${y(i, left.length)} 50,50 100,50`, s:it.s }));
  }
  return (
    <svg className="rec-flow-conn" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" style={{width:"100%",height:"100%",display:"block",overflow:"visible"}}>
      {paths.map((p, k) => (
        // Líneas de puntitos: guion 0 + extremo redondo = un punto cada 6px.
        // Las disponibles avanzan (animación en .rec-flow-live), el resto queda quieto y tenue.
        <path key={k} d={p.d} fill="none" stroke={col(p.s)} strokeOpacity={p.s === "live" ? 0.95 : 0.5} strokeWidth={p.s === "live" ? 2.6 : 2.2}
          strokeLinecap="round" strokeDasharray="0 6" vectorEffect="non-scaling-stroke"
          className={p.s === "live" ? "rec-flow-live" : undefined}/>
      ))}
      {mode === "hub" && <circle cx="50" cy="50" r="1.6" fill={T.accentSolid}/>}
    </svg>
  );
}

function FlowItem({ T, it }) {
  const live = it.s === "live", soon = it.s === "soon";
  const c = live ? T.accentSolid : soon ? T.yellow : T.textSm;
  return (
    <div style={{height:FLOW_ITEM_H,display:"flex",alignItems:"center",gap:8,padding:"0 12px",borderRadius:10,background:T.card,
      border:`1.5px ${live ? "solid" : "dashed"} ${live ? T.accentSolid : c + "88"}`,minWidth:0}}>
      <span style={{width:7,height:7,borderRadius:99,background:c,flexShrink:0}}/>
      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:13,fontWeight:700,color:live ? T.text : T.textMd}}>
        {it.n}{it.d && <span style={{fontWeight:500,color:T.textSm}}> · {it.d}</span>}
      </span>
      <span style={{fontSize:10,fontWeight:700,color:c,whiteSpace:"nowrap",textTransform:"uppercase",letterSpacing:0.3}}>{FLOW_STATUS[it.s]}</span>
    </div>
  );
}

// `label` solo se ve en mobile (en desktop los títulos van en la fila de arriba;
// un elemento display:none no ocupa lugar en el flex, así no corre las curvas).
// Sin `gap`: con ítems de alto fijo y space-around, el centro del ítem i queda
// exacto en (i + 0.5) / N del alto, que es donde FlowConnector dibuja cada curva.
const FLOW_MLABEL = new Map([[FLOW_STORES, "1 · Tu negocio"], [FLOW_PAYMENTS, "2 · Tu pasarela"]]);
function FlowColumn({ T, items, label = FLOW_MLABEL.get(items) }) {
  return (
    <div style={{display:"flex",flexDirection:"column",justifyContent:"space-around",height:"100%",minHeight:items.length * (FLOW_ITEM_H + 12),minWidth:0}}>
      {label && <div className="rec-flow-mlabel" style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.6,textTransform:"uppercase"}}>{label}</div>}
      {items.map(it => <FlowItem key={it.n} T={T} it={it}/>)}
    </div>
  );
}

// Tiendas → pasarelas → panel de Recurrentes con las acciones de cada cobro.
function FlowMap({ T }) {
  const head = (n, t, sub) => (
    <div>
      <div style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.6,textTransform:"uppercase"}}>{n} · {t}</div>
      <div style={{fontSize:12,color:T.textSm,marginTop:2}}>{sub}</div>
    </div>
  );
  return (
    <div>
      <div className="rec-flow-grid rec-flow-head">
        {head(1, "Tu negocio", "Donde vendés")}<span/>
        {head(2, "Tu pasarela", "Con qué cobrás")}<span/>
        {head(3, "Tu panel", "Lo que pasa en cada cobro")}
      </div>
      <div className="rec-flow-grid">
        <FlowColumn T={T} items={FLOW_STORES}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_STORES} right={FLOW_PAYMENTS} mode="hub"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <FlowColumn T={T} items={FLOW_PAYMENTS}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_PAYMENTS} mode="merge"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <div style={{alignSelf:"center",background:T.card,border:`1.5px solid ${T.accentSolid}`,borderRadius:16,padding:16,boxShadow:`0 18px 44px ${T.accentSolid}22`,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
            <RecLogo size={22}/><span style={{fontSize:14,fontWeight:800,color:T.text}}>Recurrentes</span>
            <span style={{marginLeft:"auto",fontSize:10,fontWeight:700,color:T.accent,background:T.accentSolid+"18",borderRadius:99,padding:"2px 8px"}}>EN VIVO</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            {[["Suscriptores","128"],["MRR","$ 5,2M"]].map(([l,v])=>(
              <div key={l} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 10px"}}>
                <div style={{fontSize:9,color:T.textSm,textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>{l}</div>
                <div style={{fontSize:17,fontWeight:800,color:T.text,letterSpacing:-0.4,fontVariantNumeric:"tabular-nums"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:10,fontWeight:700,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase",marginBottom:6}}>Acciones automáticas</div>
          <div style={{display:"flex",flexDirection:"column",gap:7}}>
            {FLOW_ACTIONS.map(a => (
              <div key={a.t} style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:a.s === "live" ? T.textMd : T.textSm}}>
                <span style={{width:6,height:6,borderRadius:99,background:a.s === "live" ? T.accentSolid : T.yellow,flexShrink:0}}/>
                <span style={{flex:1,minWidth:0}}>{a.t}</span>
                {a.s !== "live" && <span style={{fontSize:9.5,fontWeight:700,color:T.yellow,whiteSpace:"nowrap"}}>PRONTO</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Etiqueta del hero: "Para ___" con los rubros donde sirve Recurrentes ──
// Rota cada 1,8 s. El ancho se reserva con todas las palabras apiladas e
// invisibles en la misma celda (la etiqueta no salta). Sin animación si el
// usuario pidió reducir movimiento.
const BUSINESS_WORDS = [
  "tiendas online", "cursos", "membresías", "clubes", "gimnasios", "yoga y pilates",
  "academias", "comunidades", "newsletters", "cajas de suscripción", "clubes de vino",
  "café de especialidad", "suplementos", "alimento para mascotas", "ebooks",
  "software", "coworkings", "mentorías", "podcasts",
];
function RotatingWords({ T }) {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) {}
    if (reduce) return;
    const id = setInterval(() => setI(n => (n + 1) % BUSINESS_WORDS.length), 1800);
    return () => clearInterval(id);
  }, []);
  return (
    <span style={{display:"inline-flex",alignItems:"baseline",gap:5}}>
      <style>{`@keyframes recWordIn{from{opacity:0;transform:translateY(70%)}to{opacity:1;transform:none}} .rec-word{animation:recWordIn .38s cubic-bezier(.2,.8,.2,1) both} @media (prefers-reduced-motion: reduce){.rec-word{animation:none}}`}</style>
      <span style={{opacity:0.75}}>Para</span>
      <span aria-hidden="true" style={{display:"inline-grid",overflow:"hidden"}}>
        {BUSINESS_WORDS.map(w => <span key={w} style={{gridArea:"1 / 1",visibility:"hidden",whiteSpace:"nowrap"}}>{w}</span>)}
        <span key={i} className="rec-word" style={{gridArea:"1 / 1",whiteSpace:"nowrap",color:T.accent}}>{BUSINESS_WORDS[i]}</span>
      </span>
      <span style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap"}}>tiendas online, cursos, membresías, clubes, gimnasios y más</span>
    </span>
  );
}

export default function Landing({ T, darkMode, onToggleDark, onLogin, onRegister }) {
  const irRegistro = () => { if (onRegister) onRegister(); else window.location.hash = "#/registro"; };
  const irLogin = () => { if (onLogin) onLogin(); else window.location.hash = "#/login"; };
  const ir = (id) => () => { try { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); } catch (_) {} };

  const FEATURES = [
    { icon:"M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15", t:"Cobros recurrentes automáticos", d:"Mercado Pago cobra cada N días con la tarjeta del cliente. La plata entra en tu cuenta, sin intermediarios." },
    { icon:"M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12", t:"Una orden por cada cobro", d:"Cada cobro aprobado crea la orden en tu negocio, con dirección, envío y stock descontado. Vos empaquetás." },
    { icon:"M9 22a1 1 0 100-2 1 1 0 000 2zM20 22a1 1 0 100-2 1 1 0 000 2zM1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6", t:"Widget con packs", d:"Compra única o Suscripción en la misma página de producto, con packs x1, x2, x3 y 10 diseños para elegir." },
    { icon:"M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z", t:"Portal del suscriptor", d:"Tus clientes pausan, cambian la dirección o cancelan solos desde un link. Menos mensajes de soporte." },
    { icon:"M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z", t:"Pagos fallidos y retención", d:"Avisos cuando una tarjeta rebota y ofertas de pausa antes de que alguien cancele." },
    { icon:"M18 20V10M12 20V4M6 20v-6M2 20h20", t:"Métricas, Klaviyo y Meta", d:"MRR, churn y próximos cobros en el panel. Eventos a Klaviyo y ventas reportadas a Meta para tus campañas." },
  ];
  const PASOS = [
    { n:"1", t:"Conectá tu negocio y Mercado Pago", d:"Autorizás Recurrentes en tu negocio y vinculás la cuenta de Mercado Pago que cobra. Diez minutos, sin código." },
    { n:"2", t:"Creá tus planes", d:"Elegís el producto, cada cuántos días se cobra, el descuento y los packs. Pegás el widget en la página de producto." },
    { n:"3", t:"Cobrá y despachá en piloto automático", d:"Cada cobro crea la orden en tu negocio. Tus clientes gestionan su suscripción desde el portal." },
  ];

  return (
    <div style={{fontFamily:F,background:T.bg,minHeight:"100vh",color:T.text}}>
      <style>{`
        .rec-land-hero{display:grid;grid-template-columns:1.1fr 0.9fr;gap:48px;align-items:center;}
        .rec-land-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-pasos{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-stores{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-card{transition:transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;}
        .rec-land-card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,0.18);}
        .rec-land-wrap{max-width:1100px;margin:0 auto;padding:0 24px;}
        @media (prefers-reduced-motion: reduce){ .rec-land-card{transition:none;} .rec-land-card:hover{transform:none;} }
        @media(max-width:900px){ .rec-land-hero{grid-template-columns:1fr!important;gap:32px;} .rec-land-grid,.rec-land-stores{grid-template-columns:repeat(2,1fr)!important;} }
        @media(max-width:640px){ .rec-land-grid,.rec-land-stores,.rec-land-pasos{grid-template-columns:1fr!important;} .rec-land-h1{font-size:34px!important;} .rec-land-wrap{padding:0 16px;} .hide-mobile{display:none!important;} }
      `}</style>

      {/* Nav */}
      <nav style={{position:"sticky",top:0,zIndex:20,background:T.bg+"e6",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",borderBottom:`1px solid ${T.border}`}}>
        <div className="rec-land-wrap" style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:60,gap:8}}>
          <a href="#/" style={{display:"flex",alignItems:"center",gap:10,textDecoration:"none",color:T.text}}>
            <RecLogo size={30}/>
            <span style={{fontWeight:800,fontSize:18,letterSpacing:-0.3}}>Recurrentes</span>
          </a>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {[["Cómo funciona","rec-como-funciona"],["Integraciones","rec-tiendas"],["Precios","rec-precios"]].map(([l,id])=>(
              <button key={id} onClick={ir(id)} className="hide-mobile" style={{background:"transparent",border:"none",color:T.textMd,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:F,padding:"6px 10px"}}>{l}</button>
            ))}
            <button onClick={onToggleDark} title={darkMode?"Modo claro":"Modo oscuro"} aria-label={darkMode?"Modo claro":"Modo oscuro"} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMd,cursor:"pointer",padding:"6px 8px",display:"flex",alignItems:"center"}}>
              {darkMode
                ?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                :<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            </button>
            <button onClick={irLogin} style={{...BtnSecondary(T),padding:"7px 14px",fontSize:13,fontWeight:600}}>Iniciar sesión</button>
            <button onClick={irRegistro} className="hide-mobile" style={{...BtnSolid(T),padding:"8px 16px",fontSize:13}}>Empezar gratis</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="rec-land-wrap" style={{paddingTop:72,paddingBottom:64}}>
        <div className="rec-land-hero">
          <div>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:20,background:T.accentSolid+"16",border:`1px solid ${T.accentSolid}44`,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:0.4,marginBottom:20,textTransform:"uppercase"}}>
              <span style={{width:7,height:7,borderRadius:99,background:T.accentSolid,boxShadow:`0 0 0 3px ${T.accentSolid}33`}}/>
              <RotatingWords T={T}/>
            </div>
            <h1 className="rec-land-h1" style={{fontSize:50,fontWeight:800,lineHeight:1.06,margin:"0 0 18px",letterSpacing:-1.6,color:T.text,textWrap:"balance"}}>
              Vendé por <span style={{background:`linear-gradient(135deg, ${T.accentSolid}, #34d399)`,WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>suscripción</span> en tu negocio online desde hoy mismo
            </h1>
            <p style={{fontSize:17,color:T.textMd,lineHeight:1.6,margin:"0 0 22px",maxWidth:520}}>
              Tu tienda online o tu curso: el cliente se suscribe una vez, <strong style={{color:T.text}}>Mercado Pago cobra solo</strong> cada período y Recurrentes crea la orden en tu negocio o te muestra quién está al día. Vos te ocupás de vender.
            </p>
            {/* Mismas plataformas y estados que el mapa de abajo (FLOW_STORES / FLOW_PAYMENTS). */}
            <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:26}}>
              {[["Vendé en", FLOW_STORES], ["Cobrá con", FLOW_PAYMENTS]].map(([label, list]) => (
                <div key={label} style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                  <span style={{fontSize:11,fontWeight:800,color:T.textSm,textTransform:"uppercase",letterSpacing:0.6,minWidth:74}}>{label}</span>
                  {list.map(it => {
                    const c = it.s === "live" ? T.accentSolid : it.s === "soon" ? T.yellow : T.textSm;
                    return (
                      <span key={it.n} style={{display:"inline-flex",alignItems:"center",gap:7,padding:"5px 9px 5px 11px",borderRadius:9,background:T.card,
                        border:`1px ${it.s === "live" ? "solid" : "dashed"} ${it.s === "live" ? T.accentSolid + "88" : T.border}`,fontSize:12.5,fontWeight:700,color:it.s === "radar" ? T.textMd : T.text}}>
                        {it.n}
                        <span style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:10,fontWeight:700,color:c,whiteSpace:"nowrap"}}>
                          <span style={{width:5,height:5,borderRadius:99,background:c}}/>{FLOW_STATUS[it.s]}
                        </span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <button onClick={irRegistro} style={{...BtnSolid(T),padding:"13px 22px",fontSize:15}}>
                Empezar gratis
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button onClick={ir("rec-como-funciona")} style={{...BtnSecondary(T),padding:"12px 18px",fontSize:14}}>Ver cómo funciona</button>
            </div>
            <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:22,fontSize:12,color:T.textSm}}>
              {[`Gratis hasta ${FREE_SUBSCRIBERS} suscriptores`,"Listo en 10 minutos","Cancelás cuando quieras"].map(t=>(
                <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{t}
                </span>
              ))}
            </div>
          </div>

          {/* Mock del widget + panel */}
          <div style={{position:"relative"}} className="hide-mobile">
            <div style={{position:"absolute",inset:-40,background:`radial-gradient(circle at 60% 40%, ${T.accentSolid}22 0%, transparent 60%)`,filter:"blur(30px)",pointerEvents:"none"}}/>
            <div style={{position:"relative",background:T.card,border:`1px solid ${T.border}`,borderRadius:18,padding:20,boxShadow:"0 24px 60px rgba(0,0,0,0.25)"}}>
              <div style={{fontSize:11,fontWeight:700,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase",marginBottom:10}}>En tu página de producto</div>
              <div style={{border:`1.5px solid ${T.border}`,borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8,color:T.textMd}}>
                <div><div style={{fontSize:13,fontWeight:600,color:T.text}}>Compra única</div><div style={{fontSize:11,color:T.textSm}}>Comprá una vez al precio normal.</div></div>
                <div style={{fontSize:13,fontWeight:700}}>$ 45.000</div>
              </div>
              <div style={{border:`1.5px solid ${T.accentSolid}`,background:T.accentSolid+"12",borderRadius:12,padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div><div style={{fontSize:13,fontWeight:700,color:T.text,display:"flex",alignItems:"center",gap:8}}>Suscripción <span style={{fontSize:10,background:T.accentSolid,color:"#fff",borderRadius:99,padding:"2px 8px",fontWeight:800}}>-10%</span></div><div style={{fontSize:11,color:T.textSm}}>Te llega cada 30 días. Pausás o cancelás cuando quieras.</div></div>
                <div style={{fontSize:13,fontWeight:800,color:T.accent}}>$ 40.500</div>
              </div>
              <div style={{height:1,background:T.border,margin:"4px 0 14px"}}/>
              <div style={{fontSize:11,fontWeight:700,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase",marginBottom:10}}>En tu panel</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
                {[["Suscriptores","128",T.accent],["MRR","$ 5,2M",T.text],["Próx. cobros","31",T.text]].map(([l,v,c])=>(
                  <div key={l} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
                    <div style={{fontSize:9,color:T.textSm,textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>{l}</div>
                    <div style={{fontSize:18,fontWeight:800,color:c,letterSpacing:-0.5,marginTop:3,fontVariantNumeric:"tabular-nums"}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                {[["Cobro aprobado · Orden #1042 creada",T.accent],["Cobro aprobado · Orden #1041 creada",T.accent],["Pago rechazado · Aviso enviado al cliente",T.yellow]].map(([t,c],i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:T.textMd}}>
                    <span style={{width:6,height:6,borderRadius:99,background:c,flexShrink:0}}/>{t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Todo se conecta: tiendas → pasarelas → panel de Recurrentes */}
      <section id="rec-tiendas" style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"56px 0"}}>
        <style>{`
          .rec-flow-grid{display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr) 72px minmax(0,1.2fr);column-gap:10px;align-items:stretch;}
          .rec-flow-head{margin-bottom:14px;align-items:end;}
          .rec-flow-connwrap{position:relative;min-width:0;}
          .rec-flow-mobile-arrow,.rec-flow-mlabel{display:none;}
          .rec-flow-live{animation:recFlow 1.1s linear infinite;}
          @keyframes recFlow{to{stroke-dashoffset:-12;}}
          @media (prefers-reduced-motion: reduce){ .rec-flow-live{animation:none;} }
          @media(max-width:900px){
            .rec-flow-grid{grid-template-columns:1fr;row-gap:10px;}
            .rec-flow-head,.rec-flow-connwrap{display:none;}
            .rec-flow-mobile-arrow{display:block;text-align:center;font-size:22px;font-weight:800;color:${T.accentSolid};line-height:1;}
            .rec-flow-mlabel{display:block;}
          }
        `}</style>
        <div className="rec-land-wrap">
          <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px",textWrap:"balance"}}>Todo se conecta con Recurrentes</h2>
          <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:600,margin:"0 auto 32px",lineHeight:1.6}}>Tu negocio vende, tu pasarela cobra y Recurrentes hace el resto: cobra cada período, crea la orden y te muestra todo en un panel. Arrancamos con Shopify y Mercado Pago, y vamos sumando las plataformas que usan los negocios online.</p>
          <FlowMap T={T}/>
          <div style={{marginTop:22,display:"flex",justifyContent:"center",gap:"8px 18px",flexWrap:"wrap",fontSize:12,color:T.textSm}}>
            {[["Disponible",T.accentSolid],["Próximamente",T.yellow],["En el radar",T.textSm]].map(([l,c])=>(
              <span key={l} style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:99,background:c}}/>{l}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="rec-land-wrap" style={{padding:"64px 24px"}}>
        <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px",textWrap:"balance"}}>Todo lo que necesitás para vender por suscripción</h2>
        <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:560,margin:"0 auto 32px",lineHeight:1.6}}>Pensado para negocios argentinos que venden algo que se compra una y otra vez: suplementos, café, cosmética, alimento para mascotas, ebooks y cursos.</p>
        <div className="rec-land-grid">
          {FEATURES.map(f=>(
            <div key={f.t} className="rec-land-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.xl,padding:"18px 18px 20px"}}>
              <div style={{width:36,height:36,borderRadius:10,background:T.accentSolid+"18",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={f.icon}/></svg>
              </div>
              <div style={{fontSize:14,fontWeight:700,marginBottom:6}}>{f.t}</div>
              <div style={{fontSize:12.5,color:T.textSm,lineHeight:1.6}}>{f.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="rec-como-funciona" style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"56px 0"}}>
        <div className="rec-land-wrap">
          <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px"}}>Cómo funciona</h2>
          <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:520,margin:"0 auto 32px",lineHeight:1.6}}>Tres pasos y tu negocio acepta suscripciones.</p>
          <div className="rec-land-pasos">
            {PASOS.map(p=>(
              <div key={p.n} className="rec-land-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.xl,padding:"20px 20px 22px"}}>
                <div style={{width:34,height:34,borderRadius:99,background:`linear-gradient(135deg, ${T.accentSolid}, #059669)`,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,marginBottom:14,boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>{p.n}</div>
                <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{p.t}</div>
                <div style={{fontSize:13,color:T.textSm,lineHeight:1.6}}>{p.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section id="rec-precios" className="rec-land-wrap" style={{padding:"64px 24px"}}>
        <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px",textWrap:"balance"}}>Pagás según tus suscriptores</h2>
        <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:560,margin:"0 auto 12px",lineHeight:1.6}}>Los primeros {FREE_SUBSCRIBERS} suscriptores son gratis. Después, el plan sube solo según cuántos clientes tenés cobrando. Todo lo demás está incluido.</p>
        <div style={{display:"flex",justifyContent:"center",marginBottom:28}}>
          <span style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:20,background:T.accentSolid+"16",border:`1px solid ${T.accentSolid}44`,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            Gratis hasta {FREE_SUBSCRIBERS} suscriptores
          </span>
        </div>
        <PricingTable T={T}/>
        <p style={{fontSize:12,color:T.textSm,textAlign:"center",margin:"22px auto 0",maxWidth:600,lineHeight:1.6}}>Precios en dólares · sin contrato, cancelás cuando quieras · suscriptor activo = cliente con su suscripción cobrando (los pausados y cancelados no cuentan).</p>
      </section>

      {/* CTA final */}
      <section className="rec-land-wrap" style={{paddingBottom:72}}>
        <div style={{background:`linear-gradient(135deg, ${T.accentSolid}22, ${T.card})`,border:`1px solid ${T.accentSolid}44`,borderRadius:20,padding:"40px 28px",textAlign:"center"}}>
          <RecLogo size={40} style={{marginBottom:14}}/>
          <h2 style={{fontSize:26,fontWeight:800,letterSpacing:-0.6,margin:"0 0 8px",textWrap:"balance"}}>Empezá a vender por suscripción hoy</h2>
          <p style={{fontSize:14,color:T.textMd,margin:"0 auto 22px",maxWidth:480,lineHeight:1.6}}>Los primeros {FREE_SUBSCRIBERS} suscriptores son gratis. Conectás tu negocio, creás un plan y ves el primer cobro recurrente entrar solo.</p>
          <button onClick={irRegistro} style={{...BtnSolid(T),padding:"13px 24px",fontSize:15}}>Empezar gratis</button>
          <div style={{fontSize:12,color:T.textSm,marginTop:12}}>¿Ya tenés cuenta? <button onClick={irLogin} style={{background:"none",border:"none",color:T.accent,fontWeight:600,cursor:"pointer",fontFamily:F,fontSize:12,padding:0}}>Iniciá sesión</button></div>
        </div>
      </section>

      <footer style={{borderTop:`1px solid ${T.border}`,padding:"20px 24px",fontSize:11,color:T.textSm,textAlign:"center"}}>
        Recurrentes — suscripciones para negocios online · <a href="#/terminos" style={{color:T.textSm}}>Términos</a> · <a href="#/privacidad" style={{color:T.textSm}}>Privacidad</a>
      </footer>
    </div>
  );
}
