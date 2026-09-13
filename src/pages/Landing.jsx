import React from "react";
import { DS } from "../ui/theme.js";
import { BtnSolid, BtnSecondary } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";

const F = "'Inter',system-ui,sans-serif";

// Landing pública de Recurrentes (tema T, marca verde). Los botones llevan a
// #/registro y #/login — el login vive en Auth.jsx.
export default function Landing({ T, darkMode, onToggleDark, onLogin, onRegister }) {
  const irRegistro = () => { if (onRegister) onRegister(); else window.location.hash = "#/registro"; };
  const irLogin = () => { if (onLogin) onLogin(); else window.location.hash = "#/login"; };
  const irComo = () => { try { document.getElementById("rec-como-funciona")?.scrollIntoView({ behavior: "smooth" }); } catch (_) {} };

  const FEATURES = [
    { icon:"M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15", t:"Cobros recurrentes automáticos", d:"Mercado Pago cobra cada N días con la tarjeta o el dinero en cuenta del cliente. Vos no hacés nada." },
    { icon:"M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12", t:"Órdenes Shopify por cada cobro", d:"Cada cobro aprobado genera una orden en tu Shopify, lista para empaquetar, con stock descontado." },
    { icon:"M9 22a1 1 0 100-2 1 1 0 000 2zM20 22a1 1 0 100-2 1 1 0 000 2zM1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6", t:"Widget en tu producto", d:"Tus clientes eligen Compra única o Suscripción en la misma página de producto. Sin apps pesadas ni themes rotos." },
    { icon:"M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z", t:"Portal del suscriptor", d:"Tus clientes pausan, cambian la dirección o cancelan solos desde un link. Menos mails de soporte." },
    { icon:"M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z", t:"Recupero de carritos", d:"Secuencia de mails con cupones para las suscripciones que quedaron a medio camino." },
    { icon:"M22 12h-4l-3 9L9 3l-3 9H2", t:"Actividad y cobros en vivo", d:"Panel con suscriptores activos, próximos cobros, rechazos y reintentos. Todo en un solo lugar." },
  ];
  const PASOS = [
    { n:"1", t:"Conectá Shopify y Mercado Pago", d:"Autorizás Recurrentes en tu tienda y vinculás tu cuenta de Mercado Pago. Diez minutos, sin código." },
    { n:"2", t:"Creá tus planes", d:"Elegís un producto, la frecuencia (cada 30, 60, 90 días…) y el descuento por suscribirse. Pegás el widget en la página de producto." },
    { n:"3", t:"Cobrá y despachá en piloto automático", d:"Cada cobro recurrente crea una orden Shopify. Vos solo empaquetás. Tus clientes gestionan su suscripción desde el portal." },
  ];

  return (
    <div style={{fontFamily:F,background:T.bg,minHeight:"100vh",color:T.text}}>
      <style>{`
        .rec-land-hero{display:grid;grid-template-columns:1.1fr 0.9fr;gap:48px;align-items:center;}
        .rec-land-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-pasos{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        .rec-land-card{transition:transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;}
        .rec-land-card:hover{transform:translateY(-3px);box-shadow:0 14px 34px rgba(0,0,0,0.18);}
        .rec-land-wrap{max-width:1100px;margin:0 auto;padding:0 24px;}
        @keyframes recLandFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
        @media(max-width:900px){ .rec-land-hero{grid-template-columns:1fr!important;gap:32px;} .rec-land-grid{grid-template-columns:repeat(2,1fr)!important;} }
        @media(max-width:640px){ .rec-land-grid{grid-template-columns:1fr!important;} .rec-land-pasos{grid-template-columns:1fr!important;} .rec-land-h1{font-size:34px!important;} .rec-land-wrap{padding:0 16px;} .hide-mobile{display:none!important;} }
      `}</style>

      {/* Nav */}
      <nav style={{position:"sticky",top:0,zIndex:20,background:T.bg+"e6",backdropFilter:"blur(10px)",WebkitBackdropFilter:"blur(10px)",borderBottom:`1px solid ${T.border}`}}>
        <div className="rec-land-wrap" style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:60}}>
          <a href="#/" style={{display:"flex",alignItems:"center",gap:10,textDecoration:"none",color:T.text}}>
            <RecLogo size={30}/>
            <span style={{fontWeight:800,fontSize:18,letterSpacing:-0.3}}>Recurrentes</span>
          </a>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <button onClick={irComo} className="hide-mobile" style={{background:"transparent",border:"none",color:T.textMd,fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:F,padding:"6px 10px"}}>Cómo funciona</button>
            <button onClick={onToggleDark} title={darkMode?"Modo claro":"Modo oscuro"} style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMd,cursor:"pointer",padding:"6px 8px",display:"flex",alignItems:"center"}}>
              {darkMode
                ?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
                :<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
            </button>
            <button onClick={irLogin} style={{...BtnSecondary(T),padding:"7px 14px",fontSize:13,fontWeight:600}}>Iniciar sesión</button>
            <button onClick={irRegistro} className="hide-mobile" style={{...BtnSolid(T),padding:"8px 16px",fontSize:13}}>Probar la beta gratis</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="rec-land-wrap" style={{paddingTop:72,paddingBottom:64}}>
        <div className="rec-land-hero">
          <div>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"5px 12px",borderRadius:20,background:T.accentSolid+"16",border:`1px solid ${T.accentSolid}44`,color:T.accent,fontSize:11,fontWeight:700,letterSpacing:0.4,marginBottom:20,textTransform:"uppercase"}}>
              <span style={{width:7,height:7,borderRadius:99,background:T.accentSolid,boxShadow:`0 0 0 3px ${T.accentSolid}33`}}/>
              Beta abierta · Shopify + Mercado Pago
            </div>
            <h1 className="rec-land-h1" style={{fontSize:50,fontWeight:800,lineHeight:1.06,margin:"0 0 18px",letterSpacing:-1.6,color:T.text}}>
              Suscripciones para tu tienda Shopify con cobro recurrente por <span style={{background:`linear-gradient(135deg, ${T.accentSolid}, #34d399)`,WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>Mercado Pago</span>
            </h1>
            <p style={{fontSize:17,color:T.textMd,lineHeight:1.6,margin:"0 0 28px",maxWidth:520}}>
              Tus clientes eligen <strong style={{color:T.text}}>Compra única</strong> o <strong style={{color:T.text}}>Suscripción</strong> en cada producto. Mercado Pago cobra cada N días y Recurrentes genera la orden en Shopify. Vos solo despachás.
            </p>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
              <button onClick={irRegistro} style={{...BtnSolid(T),padding:"13px 22px",fontSize:15}}>
                Probar la beta gratis
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
              <button onClick={irComo} style={{...BtnSecondary(T),padding:"12px 18px",fontSize:14}}>Ver cómo funciona</button>
            </div>
            <div style={{display:"flex",gap:18,flexWrap:"wrap",marginTop:22,fontSize:12,color:T.textSm}}>
              {["Sin tarjeta","Setup en 10 minutos","Cancelás cuando quieras"].map(t=>(
                <span key={t} style={{display:"inline-flex",alignItems:"center",gap:6}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>{t}
                </span>
              ))}
            </div>
          </div>

          {/* Mock del widget + panel */}
          <div style={{position:"relative"}} className="hide-mobile">
            <div style={{position:"absolute",inset:-40,background:`radial-gradient(circle at 60% 40%, ${T.accentSolid}22 0%, transparent 60%)`,filter:"blur(30px)",pointerEvents:"none"}}/>
            <div style={{position:"relative",background:T.card,border:`1px solid ${T.border}`,borderRadius:18,padding:20,boxShadow:"0 24px 60px rgba(0,0,0,0.25)",animation:"recLandFloat 6s ease-in-out infinite"}}>
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
                    <div style={{fontSize:18,fontWeight:800,color:c,letterSpacing:-0.5,marginTop:3}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                {[["Cobro aprobado · Orden #1042 creada",T.accent],["Cobro aprobado · Orden #1041 creada",T.accent],["Reintento programado · Tarjeta rechazada",T.yellow]].map(([t,c],i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:11,color:T.textMd}}>
                    <span style={{width:6,height:6,borderRadius:99,background:c,flexShrink:0}}/>{t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={{background:T.surface,borderTop:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,padding:"56px 0"}}>
        <div className="rec-land-wrap">
          <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px"}}>Todo lo que necesitás para vender por suscripción</h2>
          <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:560,margin:"0 auto 32px",lineHeight:1.6}}>Pensado para comerciantes de Argentina que venden productos que se compran una y otra vez: suplementos, café, cosmética, alimentos para mascotas.</p>
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
        </div>
      </section>

      {/* Cómo funciona */}
      <section id="rec-como-funciona" className="rec-land-wrap" style={{padding:"64px 24px"}}>
        <h2 style={{fontSize:28,fontWeight:800,letterSpacing:-0.7,textAlign:"center",margin:"0 0 10px"}}>Cómo funciona</h2>
        <p style={{fontSize:14,color:T.textSm,textAlign:"center",maxWidth:520,margin:"0 auto 32px",lineHeight:1.6}}>Tres pasos y tu tienda acepta suscripciones.</p>
        <div className="rec-land-pasos">
          {PASOS.map(p=>(
            <div key={p.n} className="rec-land-card" style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.xl,padding:"20px 20px 22px",position:"relative"}}>
              <div style={{width:34,height:34,borderRadius:99,background:`linear-gradient(135deg, ${T.accentSolid}, #059669)`,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:14,marginBottom:14,boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>{p.n}</div>
              <div style={{fontSize:15,fontWeight:700,marginBottom:6}}>{p.t}</div>
              <div style={{fontSize:13,color:T.textSm,lineHeight:1.6}}>{p.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="rec-land-wrap" style={{paddingBottom:72}}>
        <div style={{background:`linear-gradient(135deg, ${T.accentSolid}22, ${T.card})`,border:`1px solid ${T.accentSolid}44`,borderRadius:20,padding:"40px 28px",textAlign:"center"}}>
          <RecLogo size={40} style={{marginBottom:14}}/>
          <h2 style={{fontSize:26,fontWeight:800,letterSpacing:-0.6,margin:"0 0 8px"}}>Empezá a cobrar por suscripción hoy</h2>
          <p style={{fontSize:14,color:T.textMd,margin:"0 auto 22px",maxWidth:460,lineHeight:1.6}}>La beta es gratis. Conectás tu tienda, creás un plan y ves el primer cobro recurrente entrar solo.</p>
          <button onClick={irRegistro} style={{...BtnSolid(T),padding:"13px 24px",fontSize:15}}>Probar la beta gratis</button>
          <div style={{fontSize:12,color:T.textSm,marginTop:12}}>¿Ya tenés cuenta? <button onClick={irLogin} style={{background:"none",border:"none",color:T.accent,fontWeight:600,cursor:"pointer",fontFamily:F,fontSize:12,padding:0}}>Iniciá sesión</button></div>
        </div>
      </section>

      <footer style={{borderTop:`1px solid ${T.border}`,padding:"20px 24px",fontSize:11,color:T.textSm,textAlign:"center"}}>
        Recurrentes — suscripciones para ecommerce · <a href="#/terminos" style={{color:T.textSm}}>Términos</a> · <a href="#/privacidad" style={{color:T.textSm}}>Privacidad</a>
      </footer>
    </div>
  );
}
