import React from "react";
import { DS } from "../ui/theme.js";
import { BtnSolid, BtnSecondary } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { PricingTable } from "./Billing.jsx";
import { FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";
import { SectionsStyle, ProblemSection, DeepDivesSection, TrustSection, FaqSection, BigFooter, VideoSection, ComparisonSection, ReviewsSection } from "./LandingSections.jsx";
import { LANDING_VIDEO_URL, LANDING_VIDEO_POSTER, LANDING_VIDEO_DURATION, LANDING_VIDEO_SOURCES } from "../lib/landingMedia.js";

const F = "'Inter',system-ui,sans-serif";

// Landing pública de Recurrentes (tema T, marca verde). Comunicación en modo
// Argentina, para tiendas online: Shopify y Tiendanube hoy; el resto en camino.
// Orden AIDA (Thiago, 17-sept): Atención (hero) → Interés (integraciones + video)
// → Deseo (dolor → solución → comparativa → confianza → precios) → Acción (CTA).
// Los botones llevan a #/registro y #/login — el login vive en Auth.jsx.

// ─── Mapa "todo se conecta": tiendas → pasarelas → panel ─────────────────
// Estados honestos (ver CLAUDE.md → Integraciones evaluadas): live = ya
// funciona · soon = en desarrollo · radar = evaluando. Los descartados (Stripe
// en AR, pasarelas sin cobro recurrente) no aparecen.
const FLOW_STORES = [
  { n:"Shopify", s:"live" },
  { n:"Tiendanube", s:"live" },
  { n:"Impultienda", s:"soon" },
  { n:"WooCommerce", s:"soon" },
  { n:"Empretienda", s:"soon" },
  { n:"Link de pago", s:"live" },
];
const FLOW_PAYMENTS = [
  { n:"Mercado Pago", s:"live" },
  { n:"Mobbex", s:"soon" },
  { n:"Stripe", s:"soon" },
  { n:"Whop", s:"soon" },
];
const FLOW_ACTIONS = [
  { t:"Cobro aprobado · $ 40.500", short:"Cobro aprobado · $ 40.500", s:"live" },
  { t:"Orden #1042 creada en tu negocio", short:"Orden #1042 en tu tienda", s:"live" },
  { t:"Flujo de mails · aviso de próximo cobro", short:"Mail de próximo cobro", s:"live" },
  { t:"WhatsApp · le avisa al cliente antes de cada cobro", short:"WhatsApp al cliente", s:"soon" },
];
const FLOW_STATUS = { live:"Disponible", soon:"Próximamente", radar:"En el radar" };
const FLOW_ITEM_H = 44;
const FLOW_ITEM_H_SM = 30;   // versión chica: el mapa dentro del panel del hero

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

function FlowItem({ T, it, compact }) {
  const live = it.s === "live", soon = it.s === "soon";
  const c = live ? T.accentSolid : soon ? T.yellow : T.textSm;
  return (
    <div title={compact ? FLOW_STATUS[it.s] : undefined}
      style={{height:compact ? FLOW_ITEM_H_SM : FLOW_ITEM_H,display:"flex",alignItems:"center",gap:compact ? 6 : 8,padding:compact ? "0 9px" : "0 12px",borderRadius:compact ? 8 : 10,background:T.card,
      border:`${compact ? 1 : 1.5}px ${live ? "solid" : "dashed"} ${live ? T.accentSolid : c + "88"}`,minWidth:0}}>
      <span style={{width:compact ? 6 : 7,height:compact ? 6 : 7,borderRadius:99,background:c,flexShrink:0}}/>
      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:compact ? 11.5 : 13,fontWeight:700,color:live ? T.text : T.textMd}}>
        {it.n}{it.d && <span style={{fontWeight:500,color:T.textSm}}> · {it.d}</span>}
      </span>
      {!compact && <span style={{fontSize:10,fontWeight:700,color:c,whiteSpace:"nowrap",textTransform:"uppercase",letterSpacing:0.3}}>{FLOW_STATUS[it.s]}</span>}
    </div>
  );
}

// `label` solo se ve en mobile (en desktop los títulos van en la fila de arriba;
// un elemento display:none no ocupa lugar en el flex, así no corre las curvas).
// Sin `gap`: con ítems de alto fijo y space-around, el centro del ítem i queda
// exacto en (i + 0.5) / N del alto, que es donde FlowConnector dibuja cada curva.
const FLOW_MLABEL = new Map([[FLOW_STORES, "1 · Tu negocio"], [FLOW_PAYMENTS, "2 · Tu pasarela"]]);
function FlowColumn({ T, items, label = FLOW_MLABEL.get(items), compact }) {
  const h = compact ? FLOW_ITEM_H_SM : FLOW_ITEM_H;
  return (
    <div style={{display:"flex",flexDirection:"column",justifyContent:"space-around",height:"100%",minHeight:items.length * (h + (compact ? 7 : 12)),minWidth:0}}>
      {label && <div className="rec-flow-mlabel" style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.6,textTransform:"uppercase"}}>{label}</div>}
      {items.map(it => <FlowItem key={it.n} T={T} it={it} compact={compact}/>)}
    </div>
  );
}

// Tiendas → pasarelas → panel de Recurrentes con las acciones de cada cobro.
function FlowMap({ T, compact }) {
  const head = (n, t, sub) => (
    <div>
      <div style={{fontSize:compact ? 9.5 : 11,fontWeight:800,color:T.accent,letterSpacing:0.5,textTransform:"uppercase"}}>{n} · {t}</div>
      {!compact && <div style={{fontSize:12,color:T.textSm,marginTop:2}}>{sub}</div>}
    </div>
  );
  return (
    <div className={compact ? "rec-flow-sm" : undefined}>
      <div className="rec-flow-grid rec-flow-head">
        {head(1, "Tu negocio", "Donde vendés")}<span/>
        {head(2, "Tu pasarela", "Con qué cobrás")}<span/>
        {head(3, "Tu panel", "Lo que pasa en cada cobro")}
      </div>
      <div className="rec-flow-grid">
        <FlowColumn T={T} items={FLOW_STORES} compact={compact}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_STORES} right={FLOW_PAYMENTS} mode="hub"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <FlowColumn T={T} items={FLOW_PAYMENTS} compact={compact}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_PAYMENTS} mode="merge"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <div style={{alignSelf:"center",background:T.card,border:`1.5px solid ${T.accentSolid}`,borderRadius:compact ? 13 : 16,padding:compact ? 12 : 16,boxShadow:`0 18px 44px ${T.accentSolid}22`,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:compact ? 9 : 12}}>
            <RecLogo size={compact ? 18 : 22}/><span style={{fontSize:compact ? 12 : 14,fontWeight:800,color:T.text}}>Recurrentes</span>
            <span style={{marginLeft:"auto",fontSize:compact ? 8.5 : 10,fontWeight:700,color:T.accent,background:T.accentSolid+"18",borderRadius:99,padding:"2px 7px"}}>EN VIVO</span>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:compact ? 6 : 8,marginBottom:compact ? 9 : 12}}>
            {[["Suscriptores","128"],["MRR","$ 5,2M"]].map(([l,v])=>(
              <div key={l} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:compact ? 8 : 10,padding:compact ? "6px 8px" : "8px 10px"}}>
                <div style={{fontSize:compact ? 8 : 9,color:T.textSm,textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>{l}</div>
                <div style={{fontSize:compact ? 14 : 17,fontWeight:800,color:T.text,letterSpacing:-0.4,fontVariantNumeric:"tabular-nums"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:compact ? 8.5 : 10,fontWeight:700,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase",marginBottom:compact ? 5 : 6}}>Acciones automáticas</div>
          <div style={{display:"flex",flexDirection:"column",gap:compact ? 5 : 7}}>
            {(compact ? FLOW_ACTIONS.map(a => ({ ...a, t: a.short || a.t })) : FLOW_ACTIONS).map(a => (
              <div key={a.t} style={{display:"flex",alignItems:compact ? "flex-start" : "center",gap:7,fontSize:compact ? 10.5 : 12,lineHeight:1.4,color:a.s === "live" ? T.textMd : T.textSm}}>
                <span style={{width:5,height:5,borderRadius:99,background:a.s === "live" ? T.accentSolid : T.yellow,flexShrink:0,marginTop:compact ? 4 : 0}}/>
                <span style={{flex:1,minWidth:0}}>{a.t}</span>
                {a.s !== "live" && <span style={{fontSize:compact ? 8 : 9.5,fontWeight:700,color:T.yellow,whiteSpace:"nowrap"}}>PRONTO</span>}
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

  const PASOS = [
    { n:"1", t:"Conectá tu tienda y Mercado Pago", d:"Tiendanube en un clic, Shopify en dos pasos, Mercado Pago en un clic. Diez minutos, sin código." },
    { n:"2", t:"Creá tus planes", d:"Elegís el producto, cada cuántos días se cobra, el descuento y los packs. En Tiendanube el widget se pone solo; en Shopify es una línea en el tema." },
    { n:"3", t:"Cobrá y despachá en piloto automático", d:"Cada cobro crea la orden en tu negocio. Tus clientes gestionan su suscripción desde el portal." },
  ];

  return (
    <div style={{fontFamily:F,background:T.bg,minHeight:"100vh",color:T.text}}>
      <style>{`
        .rec-land-hero{display:grid;grid-template-columns:1fr 1.06fr;gap:36px;align-items:center;}
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
            {[["Integraciones","rec-tiendas"],["Video","rec-video"],["Funciones","rec-funciones"],["Comparar","rec-comparar"],["Precios","rec-precios"],["Reseñas","rec-resenas"]].map(([l,id])=>(
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

      {/* Hero + panel de conectores (id rec-tiendas: el nav apunta acá) */}
      <section id="rec-tiendas" className="rec-land-wrap" style={{paddingTop:72,paddingBottom:56}}>
        <style>{`
          .rec-flow-grid{display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr) 72px minmax(0,1.2fr);column-gap:10px;align-items:stretch;}
          /* Versión chica: el mismo mapa (curvas punteadas incluidas) dentro del panel del hero. */
          .rec-flow-sm .rec-flow-grid{grid-template-columns:minmax(0,0.78fr) 26px minmax(0,0.72fr) 26px minmax(0,1.32fr);column-gap:4px;}
          .rec-flow-sm .rec-flow-head{margin-bottom:9px;}
          .rec-flow-head{margin-bottom:14px;align-items:end;}
          .rec-flow-connwrap{position:relative;min-width:0;}
          .rec-flow-mobile-arrow,.rec-flow-mlabel{display:none;}
          .rec-flow-live{animation:recFlow 1.1s linear infinite;}
          @keyframes recFlow{to{stroke-dashoffset:-12;}}
          @media (prefers-reduced-motion: reduce){ .rec-flow-live{animation:none;} }
          @media(max-width:900px){
            .rec-flow-grid{grid-template-columns:1fr;row-gap:10px;}
            .rec-flow-head,.rec-flow-connwrap{display:none;}
            .rec-flow-sm .rec-flow-mobile-arrow{font-size:16px;}
            .rec-flow-mobile-arrow{display:block;text-align:center;font-size:22px;font-weight:800;color:${T.accentSolid};line-height:1;}
            .rec-flow-mlabel{display:block;}
          }
        `}</style>
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
              Tu Shopify, tu Tiendanube o tu curso: el cliente se suscribe una vez, <strong style={{color:T.text}}>Mercado Pago cobra solo</strong> cada período y Recurrentes crea la orden en tu tienda con el envío de siempre. Vos te ocupás de vender.
            </p>
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

          {/* Panel de conectores: la explicación y el mapa visual, todo junto.
              Reemplaza a la sección "Todo se conecta" que estaba más abajo
              (Thiago, 17-sept): así el video pasa a ser lo segundo que se ve. */}
          <div style={{position:"relative"}}>
            <div style={{position:"absolute",inset:-36,background:`radial-gradient(circle at 60% 35%, ${T.accentSolid}26 0%, transparent 62%)`,filter:"blur(30px)",pointerEvents:"none"}}/>
            <div style={{position:"relative",background:T.card,border:`1px solid ${T.border}`,borderRadius:20,padding:"18px 18px 16px",boxShadow:"0 26px 64px rgba(0,0,0,0.28)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:14}}>
                <div style={{fontSize:11,fontWeight:800,color:T.textSm,letterSpacing:0.6,textTransform:"uppercase"}}>Todo se conecta</div>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,fontSize:10,fontWeight:800,color:T.accent,background:T.accentSolid+"18",borderRadius:99,padding:"3px 9px",letterSpacing:0.4}}>
                  <span style={{width:6,height:6,borderRadius:99,background:T.accentSolid}}/>EN VIVO
                </span>
              </div>
              <FlowMap T={T} compact/>
              <div style={{marginTop:14,paddingTop:12,borderTop:`1px solid ${T.borderL || T.border}`,display:"flex",gap:"6px 14px",flexWrap:"wrap",fontSize:11,color:T.textSm}}>
                {[["Disponible",T.accentSolid],["Próximamente",T.yellow],["En el radar",T.textSm]].map(([l,c])=>(
                  <span key={l} style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:7,height:7,borderRadius:99,background:c}}/>{l}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Interés: el video (panel por dentro, en la tienda, precios). */}
      <SectionsStyle T={T}/>
      <VideoSection T={T} url={LANDING_VIDEO_URL} sources={LANDING_VIDEO_SOURCES} poster={LANDING_VIDEO_POSTER} duration={LANDING_VIDEO_DURATION}/>

      {/* Comparativa justo debajo del video (Thiago, 17-sept). */}
      <ComparisonSection T={T}/>

      {/* Deseo: dolor → solución. (Rubros, mes de ejemplo, calculadora y extras
          siguen en LandingSections.jsx, fuera de la home para que sea más corta.) */}
      <ProblemSection T={T}/>
      <DeepDivesSection T={T}/>

      {/* Empezá en tres pasos */}
      <section id="rec-como-funciona" style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"72px 0"}}>
        <div className="rec-land-wrap">
          <h2 style={{fontSize:32,fontWeight:800,letterSpacing:-0.9,textAlign:"center",margin:"0 0 12px",textWrap:"balance"}}>Empezá en tres pasos</h2>
          <p style={{fontSize:15,color:T.textSm,textAlign:"center",maxWidth:520,margin:"0 auto 32px",lineHeight:1.6}}>En unos 10 minutos tu negocio acepta suscripciones. Sin código.</p>
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

      <TrustSection T={T}/>

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

      {/* Reseñas: entre precios y preguntas (Thiago, 17-sept). */}
      <ReviewsSection T={T}/>

      <FaqSection T={T}/>

      {/* CTA final */}
      <section className="rec-land-wrap" style={{paddingTop:72,paddingBottom:72}}>
        <div style={{background:`linear-gradient(135deg, ${T.accentSolid}22, ${T.card})`,border:`1px solid ${T.accentSolid}44`,borderRadius:20,padding:"44px 28px",textAlign:"center"}}>
          <RecLogo size={40} style={{marginBottom:14}}/>
          <h2 style={{fontSize:30,fontWeight:800,letterSpacing:-0.8,margin:"0 0 10px",textWrap:"balance"}}>Que te compren todos los meses sin tener que pedírselo</h2>
          <p style={{fontSize:14,color:T.textMd,margin:"0 auto 22px",maxWidth:480,lineHeight:1.6}}>Los primeros {FREE_SUBSCRIBERS} suscriptores son gratis. Conectás tu negocio, creás un plan y ves el primer cobro recurrente entrar solo.</p>
          <button onClick={irRegistro} style={{...BtnSolid(T),padding:"13px 24px",fontSize:15}}>Empezar gratis</button>
          <div style={{fontSize:12,color:T.textSm,marginTop:12}}>¿Ya tenés cuenta? <button onClick={irLogin} style={{background:"none",border:"none",color:T.accent,fontWeight:600,cursor:"pointer",fontFamily:F,fontSize:12,padding:0}}>Iniciá sesión</button></div>
        </div>
      </section>

      <BigFooter T={T} onGo={(id) => ir(id)()} onRegister={irRegistro}/>
    </div>
  );
}
