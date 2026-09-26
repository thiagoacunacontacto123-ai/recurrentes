import React from "react";
import { DS } from "../ui/theme.js";
import { BtnSolid, BtnSecondary } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { PricingTable } from "./Billing.jsx";
import { FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";
import { SectionsStyle, ProblemSection, DeepDivesSection, TrustSection, FaqSection, BigFooter, VideoSection, ComparisonSection, ReviewsSection, WhatsAppSection } from "./LandingSections.jsx";
import { LANDING_VIDEOS } from "../lib/landingMedia.js";

const F = "'Inter',system-ui,sans-serif";
// Display (25-sept-2026, Thiago: "bien zarpado, estético"): Manrope apretada para los
// títulos, Inter para leer. Es la combinación de las landings de producto que se ven
// caras (Linear, Vercel, Recharge): título grande y ajustado, cuerpo tranquilo.
const FD = "'Manrope','Inter',system-ui,sans-serif";

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
  { n:"Link de pago", s:"live" },
  { n:"Tu propia web", s:"live" },
  { n:"WooCommerce", d:null, s:"soon" },
  { n:"Empretienda", s:"soon" },
  { n:"VTEX", s:"soon" },
];
const FLOW_PAYMENTS = [
  { n:"Mercado Pago", s:"live" },
  { n:"Mobbex", s:"soon" },
];
// Dos ítems, no cuatro (Thiago, 18-sept): la suscripción cobrada y creada en la
// tienda, y la confirmación al cliente. Más aire abajo del panel de conectores.
const FLOW_ACTIONS = [
  { t:"Suscripción · pago n.º 3 aprobado · creada en tu tienda", short:"Suscripción · pago n.º 3 aprobado · creada en tu tienda", s:"live" },
  { t:"Mail y WhatsApp de confirmación de pedido", short:"Mail y WhatsApp de confirmación de pedido", s:"live" },
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
      style={{height:compact ? FLOW_ITEM_H_SM : FLOW_ITEM_H,display:"flex",alignItems:"center",gap:compact ? 6 : 8,padding:compact ? "0 8px" : "0 12px",borderRadius:compact ? 8 : 10,background:T.card,
      border:`${compact ? 1 : 1.5}px ${live ? "solid" : "dashed"} ${live ? T.accentSolid : c + "88"}`,minWidth:0}}>
      <span style={{width:compact ? 6 : 7,height:compact ? 6 : 7,borderRadius:99,background:c,flexShrink:0}}/>
      <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:compact ? 11 : 13,fontWeight:700,color:live ? T.text : T.textMd}}>
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
    <div className="rec-flow-col" style={{display:"flex",flexDirection:"column",justifyContent:"space-around",height:"100%",minHeight:items.length * (h + (compact ? 7 : 12)),minWidth:0}}>
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
        {head(2, "Nuestras pasarelas", "Con qué cobrás")}<span/>
        {head(3, "Tu panel", "Lo que pasa en cada cobro")}
      </div>
      <div className="rec-flow-grid">
        <FlowColumn T={T} items={FLOW_STORES} compact={compact}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_STORES} right={FLOW_PAYMENTS} mode="hub"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <FlowColumn T={T} items={FLOW_PAYMENTS} compact={compact}/>
        <div className="rec-flow-connwrap"><FlowConnector T={T} left={FLOW_PAYMENTS} mode="merge"/></div>
        <div className="rec-flow-mobile-arrow" aria-hidden="true">↓</div>
        <div style={{alignSelf:compact ? "stretch" : "center",display:"flex",flexDirection:"column",background:T.card,border:`1.5px solid ${T.accentSolid}`,borderRadius:compact ? 13 : 16,padding:compact ? 13 : 16,boxShadow:`0 18px 44px ${T.accentSolid}22`,minWidth:0}}>
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
          <div style={{fontSize:compact ? 8.5 : 10,fontWeight:700,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase",marginBottom:compact ? 6 : 6}}>Acciones automáticas</div>
          <div style={{display:"flex",flexDirection:"column",gap:compact ? 7 : 7,flex:compact ? 1 : "none",justifyContent:compact ? "space-around" : "flex-start"}}>
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
  "tiendas online", "suplementos", "café de especialidad", "alimento para mascotas",
  "cosmética", "cuidado de la piel", "cajas de suscripción", "clubes de vino",
  "cerveza artesanal", "yerba mate", "productos de limpieza", "pañales",
  "vitaminas", "snacks saludables", "flores", "aceite de oliva",
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
      <span style={{position:"absolute",width:1,height:1,overflow:"hidden",clip:"rect(0 0 0 0)",whiteSpace:"nowrap"}}>tiendas online de suplementos, café, cosmética, mascotas y más</span>
    </span>
  );
}

// Barra fija de abajo con "Empezar gratis". Aparece cuando el visitante ya
// bajó una pantalla y media, y se esconde al llegar al pie (ahí ya está el CTA
// grande y taparlo sería redundante).
function StickyCta({ T, onRegister, onToggle }) {
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    let ticking = false;
    const mirar = () => {
      ticking = false;
      const y = window.scrollY;
      const alFinal = y + window.innerHeight > document.body.scrollHeight - 700;
      setVisible(y > window.innerHeight * 1.4 && !alFinal);
    };
    const onScroll = () => { if (!ticking) { ticking = true; requestAnimationFrame(mirar); } };
    window.addEventListener("scroll", onScroll, { passive: true });
    mirar();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  // El aviso va aparte: setVisible ya corta solo cuando el valor no cambia, así
  // que esto corre una vez por transición y no en cada scroll.
  const avisar = React.useRef(onToggle); avisar.current = onToggle;
  React.useEffect(() => { avisar.current?.(visible); }, [visible]);
  return (
    <div aria-hidden={!visible} style={{
      position:"fixed", left:0, right:0, bottom:0, zIndex:85,
      transform: visible ? "translateY(0)" : "translateY(110%)",
      transition:"transform .28s cubic-bezier(.4,0,.2,1)",
      pointerEvents: visible ? "auto" : "none",
      background:T.card, borderTop:`1px solid ${T.border}`,
      boxShadow:"0 -8px 28px rgba(0,0,0,0.22)",
      padding:"11px 16px calc(11px + env(safe-area-inset-bottom))",
    }}>
      <div style={{maxWidth:1100, margin:"0 auto", display:"flex", alignItems:"center", gap:14}}>
        <div className="rec-sticky-txt" style={{flex:1, minWidth:0}}>
          <div style={{fontSize:14, fontWeight:800, color:T.text, lineHeight:1.25}}>Vemos tu tienda con suscripción en 20 minutos</div>
          <div style={{fontSize:12, color:T.textSm, lineHeight:1.35, marginTop:1}}>Con tus productos y tus precios · 0% de comisión por venta.</div>
        </div>
        <button onClick={onRegister} style={{...BtnSolid(T), padding:"12px 22px", fontSize:14.5, whiteSpace:"nowrap", flexShrink:0}}>
          Pedir una demo
        </button>
      </div>
    </div>
  );
}

export default function Landing({ T, darkMode, onToggleDark, onLogin, onRegister }) {
  // 25-sept-2026, Thiago: el camino principal es PEDIR DEMO, no "empezar gratis".
  // Las dos tiendas que funcionan salieron las dos de una integración hecha a
  // mano; el que se registra solo no conecta nada. El registro sigue existiendo
  // (lo necesita la instalación desde la app store de Tiendanube) pero como
  // segunda opción.
  const irDemo = () => { try { window.location.hash = "#/demo"; } catch (_) {} };
  const irRegistro = () => { if (onRegister) onRegister(); else window.location.hash = "#/registro"; };
  // Con la barra fija abajo, el botón de WhatsApp se corre para no taparla.
  const [stickyOn, setStickyOn] = React.useState(false);
  const irLogin = () => { if (onLogin) onLogin(); else window.location.hash = "#/login"; };
  const ir = (id) => () => { try { document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); } catch (_) {} };

  const PASOS = [
    { n:"1", t:"Conectá tu tienda y Mercado Pago", d:"Tiendanube en un clic, Shopify en dos pasos, Mercado Pago en un clic. Diez minutos, sin código." },
    { n:"2", t:"Creá tus planes", d:"Elegís el producto, cada cuántos días se cobra, el descuento y los packs. En Tiendanube el widget se pone solo; en Shopify es una línea en el tema." },
    { n:"3", t:"Cobrá y despachá en piloto automático", d:"Cada cobro crea la orden en tu negocio. Tus clientes gestionan su suscripción desde el portal." },
  ];

  return (
    <div className="rec-landing-root" style={{fontFamily:F,background:T.bg,minHeight:"100vh",color:T.text}}>
      <style>{`
        .rec-landing-root h1,.rec-landing-root h2,.rec-landing-root h3{font-family:${FD};}
        .rec-land-hero{display:grid;grid-template-columns:0.9fr 1.18fr;gap:44px;align-items:center;position:relative;}
        /* Fondo del hero: grilla fina que se desvanece + halo del acento. Es lo que hace
           que la primera pantalla se vea "de producto" y no de plantilla. */
        .rec-hero-bg{position:absolute;inset:-40px -24px 0;pointer-events:none;z-index:0;
          background-image:linear-gradient(${T.border} 1px,transparent 1px),linear-gradient(90deg,${T.border} 1px,transparent 1px);
          background-size:56px 56px;
          -webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 30%,transparent 100%);mask-image:radial-gradient(ellipse 70% 60% at 50% 0%,#000 30%,transparent 100%);opacity:.55;}
        .rec-hero-sec > *{position:relative;z-index:1;}
        .rec-nav-link{background:transparent;border:none;color:${T.textMd};font-size:13.5px;font-weight:500;cursor:pointer;font-family:${F};padding:7px 11px;border-radius:9px;transition:background .15s,color .15s;}
        .rec-nav-link:hover{background:${T.surface};color:${T.text};}
        .rec-stat{padding:22px 22px 20px;border-radius:18px;background:${T.card};border:1px solid ${T.border};position:relative;overflow:hidden;transition:transform .18s ease,border-color .18s ease;}
        .rec-stat::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,${T.isDark ? ".035" : ".6"}),transparent 40%);pointer-events:none;}
        .rec-stat:hover{transform:translateY(-3px);border-color:${T.accentSolid}66;}
        .rec-paso{position:relative;background:${T.card};border:1px solid ${T.border};border-radius:20px;padding:26px 24px 24px;overflow:hidden;}
        .rec-paso-n{font-family:${FD};font-size:64px;font-weight:800;line-height:1;letter-spacing:-3px;color:${T.accentSolid};opacity:.18;position:absolute;right:16px;top:8px;}
        .rec-cta-final{position:relative;overflow:hidden;background:#0C1A18;color:#fff;border:1px solid rgba(255,255,255,.08);border-radius:28px;padding:64px 28px;text-align:center;}
        .rec-cta-final::before{content:"";position:absolute;inset:-40%;background:radial-gradient(circle at 50% 30%,${T.accentSolid}55 0%,transparent 45%);pointer-events:none;}
        .rec-cta-final > *{position:relative;}
        .rec-btn-xl{display:inline-flex;align-items:center;gap:10px;padding:15px 26px;border-radius:14px;font-size:16px;font-weight:700;letter-spacing:-.1px;box-shadow:0 12px 30px -10px ${T.accentSolid}99;transition:transform .15s,box-shadow .15s;}
        .rec-btn-xl:hover{transform:translateY(-1px);box-shadow:0 16px 36px -10px ${T.accentSolid}aa;}
        .rec-land-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-pasos{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-stores{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-card{transition:transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;}
        .rec-land-card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,0.18);}
        .rec-land-wrap{max-width:1180px;margin:0 auto;padding:0 24px;}
        .rec-hero-sec{padding-top:56px;}
        @media(max-width:640px){ .rec-hero-sec{padding-top:28px!important;padding-bottom:28px!important;} }
        @media (prefers-reduced-motion: reduce){ .rec-land-card{transition:none;} .rec-land-card:hover{transform:none;} }
        @media(max-width:900px){ .rec-land-hero{grid-template-columns:1fr!important;gap:32px;} .rec-land-grid,.rec-land-stores{grid-template-columns:repeat(2,1fr)!important;} }
        @media(max-width:900px){ .rec-land-benefits{grid-template-columns:1fr!important;gap:18px!important;} }
        /* ── Celular (Thiago, 17-sept): la pauta entra por acá, así que todo tiene
           que leerse sin deslizar de costado. ── */
        @media(max-width:640px){
          .rec-land-hero{gap:22px!important;}
          .rec-land-h1{font-size:31px!important;letter-spacing:-1.1px!important;}
          .rec-nav-login{padding:6px 10px!important;font-size:12px!important;white-space:nowrap;}
          .rec-nav-cta{padding:7px 12px!important;font-size:12px!important;white-space:nowrap;}
          .rec-nav-login .rec-nav-login-long{display:none;}
        }
        @media(max-width:640px){ .rec-land-grid,.rec-land-stores,.rec-land-pasos{grid-template-columns:1fr!important;} .rec-land-h1{font-size:34px!important;} .rec-land-wrap{padding-left:16px;padding-right:16px;} .hide-mobile{display:none!important;} }
      `}</style>

      {/* Nav */}
      <nav style={{position:"sticky",top:0,zIndex:20,background:T.bg+"e6",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",borderBottom:`1px solid ${T.border}`}}>
        <div className="rec-land-wrap" style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:60,gap:8}}>
          <a href="#/" style={{display:"flex",alignItems:"center",gap:10,textDecoration:"none",color:T.text}}>
            <RecLogo size={30}/>
            <span style={{fontWeight:800,fontSize:18,letterSpacing:-0.3}}>Recurrentes</span>
          </a>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {[["Integraciones","rec-tiendas"],["Funciones","rec-funciones"],["Comparar","rec-comparar"],["Precios","rec-precios"],["Reseñas","rec-resenas"]].map(([l,id])=>(
              <button key={id} onClick={ir(id)} className="hide-mobile rec-nav-link">{l}</button>
            ))}
            <button onClick={onToggleDark} title={darkMode?"Modo claro":"Modo oscuro"} aria-label={darkMode?"Modo claro":"Modo oscuro"} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMd,cursor:"pointer",padding:"6px 8px",display:"flex",alignItems:"center"}}>
              {darkMode
                ?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                :<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            </button>
            <button onClick={irLogin} className="rec-nav-login" style={{...BtnSecondary(T),padding:"7px 14px",fontSize:13,fontWeight:600}}>Ingresar<span className="rec-nav-login-long"> a mi cuenta</span></button>
            <button onClick={irDemo} className="rec-nav-cta" style={{...BtnSolid(T),padding:"8px 16px",fontSize:13}}>Pedir demo</button>
          </div>
        </div>
      </nav>

      {/* Hero + panel de conectores (id rec-tiendas: el nav apunta acá) */}
      <section id="rec-tiendas" className="rec-land-wrap rec-hero-sec" style={{paddingBottom:24,position:"relative"}}>
        <div className="rec-hero-bg" aria-hidden="true"/>
        <style>{`
          .rec-flow-grid{display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr) 72px minmax(0,1.2fr);column-gap:10px;align-items:stretch;}
          /* Versión chica: el mismo mapa (curvas punteadas incluidas) dentro del panel del hero. */
          .rec-flow-sm .rec-flow-grid{grid-template-columns:minmax(0,0.8fr) 46px minmax(0,0.7fr) 46px minmax(0,1.24fr);column-gap:6px;}
          .rec-flow-sm .rec-flow-head{margin-bottom:9px;}
          .rec-flow-head{margin-bottom:14px;align-items:end;}
          .rec-flow-connwrap{position:relative;min-width:0;}
          .rec-flow-mobile-arrow,.rec-flow-mlabel{display:none;}
          .rec-flow-live{animation:recFlow 1.1s linear infinite;}
          @keyframes recFlow{to{stroke-dashoffset:-12;}}
          @media (prefers-reduced-motion: reduce){ .rec-flow-live{animation:none;} }
          @media(max-width:900px){
            .rec-flow-grid{grid-template-columns:1fr!important;row-gap:10px;}
            .rec-flow-head,.rec-flow-connwrap{display:none!important;}
            .rec-flow-sm .rec-flow-grid{grid-template-columns:1fr!important;column-gap:0!important;row-gap:8px;}
            /* Flechas al doble de largas (Thiago): 16→32 en el panel chico, 22→44 en el grande. */
            .rec-flow-sm .rec-flow-mobile-arrow{font-size:32px;margin:2px 0;}
            /* "1 · Tu negocio" / "2 · Tu pasarela" en su propia línea, arriba de los chips. */
            .rec-flow-mlabel{display:block!important;flex:0 0 100%!important;width:100%;margin:0 0 2px;}
            /* apilado: los chips van en fila horizontal que envuelve, no en columna alta */
            .rec-flow-sm .rec-flow-col{flex-direction:row!important;flex-wrap:wrap!important;gap:6px!important;height:auto!important;min-height:0!important;justify-content:flex-start!important;}
            .rec-flow-sm .rec-flow-col > div{height:auto!important;padding:7px 10px!important;}
            .rec-flow-mobile-arrow{display:block;text-align:center;font-size:44px;font-weight:800;color:${T.accentSolid};line-height:1;margin:2px 0;}
            .rec-flow-mlabel{display:block;}
          }
        `}</style>
        <div className="rec-land-hero">
          <div>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:20,background:T.accentSolid+"16",border:`1px solid ${T.accentSolid}44`,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:0.4,marginBottom:20,textTransform:"uppercase"}}>
              <span style={{width:7,height:7,borderRadius:99,background:T.accentSolid,boxShadow:`0 0 0 3px ${T.accentSolid}33`}}/>
              <RotatingWords T={T}/>
            </div>
            <h1 className="rec-land-h1" style={{fontSize:"clamp(36px, 4.6vw, 62px)",fontWeight:800,lineHeight:1.02,margin:"0 0 20px",letterSpacing:"-0.045em",color:T.text,textWrap:"balance"}}>
              Tu tienda vende<br/>todos los meses,<br/>
              <span style={{background:`linear-gradient(135deg, ${T.accentSolid}, #34d399 60%, #a7f3d0)`,WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>sin volver a vender.</span>
            </h1>
            <p style={{fontSize:18,color:T.textMd,lineHeight:1.6,margin:"0 0 26px",maxWidth:460,textWrap:"pretty"}}>
              Suscripciones para e-commerce con Mercado Pago. Tu cliente se suscribe una vez, elige cada cuánto recibirlo, y cada cobro crea el pedido en tu tienda. <strong style={{color:T.text}}>Vos solo despachás.</strong>
            </p>
            <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center"}}>
              <button onClick={irDemo} className="rec-btn-xl" style={{...BtnSolid(T)}}>
                Pedir una demo
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button onClick={ir("rec-como-funciona")} style={{...BtnSecondary(T),padding:"14px 20px",fontSize:15,borderRadius:14}}>Ver cómo funciona</button>
            </div>
            <div style={{marginTop:18,display:"flex",gap:"6px 16px",flexWrap:"wrap",fontSize:13,color:T.textSm}}>
              {["Shopify y Tiendanube","0% de comisión por venta","Demo de 20 minutos, con tus productos"].map(t => (
                <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6}}><span style={{width:5,height:5,borderRadius:99,background:T.accentSolid}}/>{t}</span>
              ))}
            </div>
            <button onClick={irRegistro} style={{marginTop:10,background:"none",border:"none",padding:0,color:T.textSm,fontSize:12.5,cursor:"pointer",fontFamily:F,textDecoration:"underline",textUnderlineOffset:3}}>Prefiero crear la cuenta y probar solo</button>
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
              {/* Los avisos del hero viven acá (Thiago, 17-sept): aprovecha el
                  espacio libre del panel y el texto de la izquierda queda limpio. */}
              <div style={{marginTop:14,paddingTop:13,borderTop:`1px solid ${T.borderL || T.border}`,display:"flex",gap:"8px 16px",flexWrap:"wrap",fontSize:12,fontWeight:600,color:T.textMd}}>
                {[`Gratis hasta ${FREE_SUBSCRIBERS} suscriptores`,"Listo en 10 minutos","Cancelás cuando quieras"].map(t=>(
                  <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6}}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}><polyline points="20 6 9 17 4 12"/></svg>{t}
                  </span>
                ))}
              </div>
              <div style={{marginTop:10,display:"flex",gap:"6px 14px",flexWrap:"wrap",fontSize:11,color:T.textSm}}>
                {[["Disponible",T.accentSolid],["Próximamente",T.yellow],["En el radar",T.textSm]].map(([l,c])=>(
                  <span key={l} style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:7,height:7,borderRadius:99,background:c}}/>{l}</span>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Tres beneficios a lo ancho, debajo del hero y del panel (Thiago, 17-sept). */}
        <div style={{marginTop:40,display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:14}} className="rec-land-benefits">
          {[
            ["0%", "de comisión por venta", "Lo que cobra tu cliente es tuyo. Pagás un plan según tus suscriptores, no un porcentaje de cada cobro."],
            ["10 min", "para estar vendiendo", "Conectás la tienda y Mercado Pago, creás el plan y el botón aparece solo en tu producto."],
            [`${FREE_SUBSCRIBERS}`, "suscriptores gratis", "Arrancás sin pagar el plan y recién pagás cuando la suscripción ya te está funcionando."],
          ].map(([v,l,d])=>(
            <div key={l} className="rec-stat">
              <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:8}}>
                <span style={{fontFamily:FD,fontSize:40,fontWeight:800,letterSpacing:-2,lineHeight:1,color:T.text}}>{v}</span>
                <span style={{fontSize:13.5,fontWeight:700,color:T.accent}}>{l}</span>
              </div>
              <div style={{fontSize:13.5,color:T.textSm,lineHeight:1.55}}>{d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Orden 22-sept-2026 (Thiago, sobre la estructura de Reval y Puentify):
          dolor → cómo funciona → qué incluye → prueba → precios → objeciones.
          La comparativa baja: antes iba segunda y se comparaba sin saber qué
          hacemos. Los precios suben: son nuestra ventaja (los otros no publican
          o arrancan en USD 99 + comisión). */}
      <SectionsStyle T={T}/>

      {/* 1 · El dolor: cada venta cuesta como la primera. */}
      {/* (rubros, mes de ejemplo y calculadora siguen fuera de la home) (Rubros, mes de ejemplo, calculadora y extras
          siguen en LandingSections.jsx, fuera de la home para que sea más corta.) */}
      <ProblemSection T={T}/>
      <DeepDivesSection T={T}/>
      {/* WhatsApp automático: un poco más abajo en la home (Thiago, 18-sept). */}
      <WhatsAppSection T={T}/>

      {/* Empezá en tres pasos */}
      <section id="rec-como-funciona" style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"72px 0"}}>
        <div className="rec-land-wrap">
          <div style={{fontFamily:"IBM Plex Mono, ui-monospace, monospace",fontSize:12,color:T.accent,letterSpacing:2.2,textTransform:"uppercase",textAlign:"center",marginBottom:14}}>Cómo funciona</div>
          <h2 style={{fontSize:"clamp(30px, 3.4vw, 42px)",fontWeight:800,letterSpacing:"-0.035em",lineHeight:1.08,textAlign:"center",margin:"0 0 12px",textWrap:"balance"}}>Tres pasos y tu tienda cobra sola</h2>
          <p style={{fontSize:16,color:T.textSm,textAlign:"center",maxWidth:520,margin:"0 auto 40px",lineHeight:1.6}}>En unos 10 minutos tu negocio acepta suscripciones. Sin código. Y si preferís, lo dejamos andando nosotros en la demo.</p>
          <div className="rec-land-pasos">
            {PASOS.map(p=>(
              <div key={p.n} className="rec-paso rec-land-card">
                <div className="rec-paso-n" aria-hidden="true">{p.n}</div>
                <div style={{width:36,height:36,borderRadius:12,background:T.accentSolid+"1a",border:`1px solid ${T.accentSolid}55`,color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,marginBottom:16,fontFamily:FD}}>{p.n}</div>
                <div style={{fontSize:17,fontWeight:700,marginBottom:8,letterSpacing:-0.3,fontFamily:FD}}>{p.t}</div>
                <div style={{fontSize:14,color:T.textSm,lineHeight:1.6}}>{p.d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Interés: el video (panel por dentro, en la tienda, precios). */}
      <SectionsStyle T={T}/>
      <VideoSection T={T} videos={LANDING_VIDEOS}/>

      <TrustSection T={T}/>

      {/* Precios */}
      <section id="rec-precios" className="rec-land-wrap" style={{padding:"64px 24px"}}>
        <div style={{fontFamily:"IBM Plex Mono, ui-monospace, monospace",fontSize:12,color:T.accent,letterSpacing:2.2,textTransform:"uppercase",textAlign:"center",marginBottom:14}}>Precios</div>
        <h2 style={{fontSize:"clamp(30px, 3.4vw, 42px)",fontWeight:800,letterSpacing:"-0.035em",lineHeight:1.08,textAlign:"center",margin:"0 0 12px",textWrap:"balance"}}>Pagás según tus suscriptores</h2>
        <p style={{fontSize:15,color:T.textSm,textAlign:"center",maxWidth:560,margin:"0 auto 12px",lineHeight:1.6}}>Los primeros {FREE_SUBSCRIBERS} suscriptores son gratis. Después, el plan sube solo según cuántos clientes tenés cobrando. Todo lo demás está incluido.</p>
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

      {/* La comparativa, DESPUÉS de precios: cierra objeciones de quien ya
          entendió qué hacemos y cuánto sale. */}
      <ComparisonSection T={T}/>

      <FaqSection T={T}/>

      {/* Barra fija con el CTA, como las de las tiendas de dropshipping: aparece
          al bajar un poco y acompaña el scroll (22-sept, Thiago). En celular es
          donde más rinde, pero se muestra en las dos. */}
      <StickyCta T={T} onRegister={irDemo} onToggle={setStickyOn}/>

      {/* WhatsApp de Thiago, abajo a la derecha: la gente toca y le habla (18-sept). */}
      <a href={`https://wa.me/5491164117974?text=${encodeURIComponent("Hola! Vi Recurrentes y quiero saber más para mi tienda.")}`} target="_blank" rel="noopener noreferrer" aria-label="Escribinos por WhatsApp"
        className="rec-wa-fab" style={{position:"fixed",right:18,bottom:stickyOn ? 92 : 18,zIndex:90,width:56,height:56,borderRadius:"50%",background:"#25D366",color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 10px 28px rgba(37,211,102,0.45)",textDecoration:"none"}}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.6c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2z"/></svg>
      </a>
      <style>{`.rec-wa-fab:hover{transform:translateY(-2px);transition:transform .15s ease} @media(max-width:640px){.rec-wa-fab{right:14px;width:52px;height:52px}
}
        .rec-wa-fab{transition:bottom .28s cubic-bezier(.4,0,.2,1),transform .15s ease}`}</style>

      {/* CTA final */}
      <section className="rec-land-wrap" style={{paddingTop:72,paddingBottom:72}}>
        <div className="rec-cta-final">
          <RecLogo size={44} style={{marginBottom:18}}/>
          <h2 style={{fontSize:"clamp(30px, 4vw, 48px)",fontWeight:800,letterSpacing:"-0.04em",lineHeight:1.04,margin:"0 auto 14px",maxWidth:720,color:"#fff",textWrap:"balance"}}>Que te compren todos los meses sin tener que pedírselo</h2>
          <p style={{fontSize:16,color:"#A9C3B9",margin:"0 auto 28px",maxWidth:500,lineHeight:1.6}}>En 20 minutos te mostramos cómo queda la suscripción en tu tienda, con tus productos y tus precios. Después, los primeros {FREE_SUBSCRIBERS} suscriptores son gratis.</p>
          <button onClick={irDemo} className="rec-btn-xl" style={{...BtnSolid(T)}}>Pedir una demo <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
          <div style={{fontSize:13,color:"#A9C3B9",marginTop:16}}>¿Ya tenés cuenta? <button onClick={irLogin} style={{background:"none",border:"none",color:"#fff",fontWeight:600,cursor:"pointer",fontFamily:F,fontSize:13,padding:0,textDecoration:"underline",textUnderlineOffset:3}}>Iniciá sesión</button></div>
        </div>
      </section>

      <BigFooter T={T} onGo={(id) => ir(id)()} onRegister={irDemo}/>
    </div>
  );
}
