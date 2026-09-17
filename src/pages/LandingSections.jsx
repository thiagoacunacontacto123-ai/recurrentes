import React, { useState, useMemo } from "react";
import { DS } from "../ui/theme.js";
import { BtnSolid } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { tierFor, FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";

// Secciones largas de la landing (Landing.jsx las ordena). Todo lo que se ve
// como dato es un EJEMPLO ilustrativo y está marcado así: no hay testimonios,
// logos ni números de clientes inventados. Solo se promete lo que existe hoy;
// lo que viene lleva "pronto" / "en el radar" (mismos estados que el mapa).

const F = "'Inter',system-ui,sans-serif";
const fmt$ = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");

// Estilos compartidos por todas las secciones (se monta una vez en la landing).
export function SectionsStyle({ T }) {
  return (
    <style>{`
      .ls-wrap{max-width:1100px;margin:0 auto;padding:0 24px;}
      .ls-sec{padding:72px 0;}
      .ls-sec-alt{padding:72px 0;background:${T.surface};border-top:1px solid ${T.border};border-bottom:1px solid ${T.border};}
      .ls-two{display:grid;grid-template-columns:1fr 1fr;gap:18px;}
      .ls-dd{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;align-items:center;}
      .ls-dd + .ls-dd{margin-top:72px;}
      .ls-dd.flip > :first-child{order:2;}
      .ls-grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;}
      .ls-tabs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;}
      .ls-case{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,0.9fr);gap:28px;align-items:center;}
      .ls-calc{display:grid;grid-template-columns:minmax(0,0.9fr) minmax(0,1.1fr);gap:24px;align-items:stretch;}
      .ls-foot{display:grid;grid-template-columns:1.4fr repeat(3,1fr);gap:28px;}
      .ls-reviews{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch;}
      .ls-range{width:100%;accent-color:${T.accentSolid};}
      .ls-faq summary{list-style:none;cursor:pointer;}
      .ls-faq summary::-webkit-details-marker{display:none;}
      .ls-faq details[open] .ls-plus{transform:rotate(45deg);}
      .ls-plus{transition:transform .2s ease;}
      .ls-tab:focus-visible,.ls-faq summary:focus-visible{outline:2px solid ${T.accentSolid};outline-offset:2px;border-radius:10px;}
      @media (prefers-reduced-motion: reduce){ .ls-plus{transition:none;} }
      @media(max-width:900px){
        .ls-dd,.ls-case,.ls-calc{grid-template-columns:1fr;gap:28px;}
        .ls-dd.flip > :first-child{order:0;}
        .ls-grid4{grid-template-columns:repeat(2,1fr);}
        .ls-reviews{grid-template-columns:repeat(2,minmax(0,1fr));}
        .ls-foot{grid-template-columns:1fr 1fr;}
      }
      @media(max-width:640px){
        .ls-two,.ls-grid4,.ls-reviews{grid-template-columns:1fr;}
        .ls-wrap{padding:0 16px;}
        .ls-sec,.ls-sec-alt{padding:56px 0;}
      }
    `}</style>
  );
}

function SectionHead({ T, eyebrow, title, sub, align = "center" }) {
  return (
    <div style={{textAlign:align,maxWidth:align === "center" ? 680 : "none",margin:align === "center" ? "0 auto 36px" : "0 0 18px"}}>
      {eyebrow && <div style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>{eyebrow}</div>}
      <h2 style={{fontSize:32,fontWeight:800,letterSpacing:-0.9,lineHeight:1.12,margin:"0 0 12px",color:T.text,textWrap:"balance"}}>{title}</h2>
      {sub && <p style={{fontSize:15,color:T.textSm,lineHeight:1.65,margin:0,textWrap:"pretty"}}>{sub}</p>}
    </div>
  );
}

const Check = ({ c, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,marginTop:3}}><polyline points="20 6 9 17 4 12"/></svg>
);
const Cross = ({ c, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,marginTop:3}}><path d="M18 6L6 18M6 6l12 12"/></svg>
);
function Bullets({ T, items }) {
  return (
    <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:18}}>
      {items.map(t => <div key={t} style={{display:"flex",gap:10,fontSize:14,color:T.textMd,lineHeight:1.55}}><Check c={T.accent}/><span>{t}</span></div>)}
    </div>
  );
}
function MockFrame({ T, label, children, style = {} }) {
  return (
    <div style={{position:"relative",...style}}>
      <div style={{position:"absolute",inset:-30,background:`radial-gradient(circle at 50% 40%, ${T.accentSolid}1c 0%, transparent 62%)`,filter:"blur(24px)",pointerEvents:"none"}}/>
      <div style={{position:"relative",background:T.card,border:`1px solid ${T.border}`,borderRadius:18,padding:18,boxShadow:"0 22px 54px rgba(0,0,0,0.22)"}}>
        {label && <div style={{fontSize:10,fontWeight:800,color:T.textSm,letterSpacing:0.6,textTransform:"uppercase",marginBottom:12,display:"flex",justifyContent:"space-between",gap:8}}><span>{label}</span><span style={{fontWeight:600,letterSpacing:0.3}}>Ejemplo</span></div>}
        {children}
      </div>
    </div>
  );
}

// ─── 1. Problema → solución ──────────────────────────────────────────────
export function ProblemSection({ T }) {
  const hoy = [
    "Pagás publicidad para venderle otra vez al mismo cliente.",
    "Cada mes arrancás de cero y salís a buscar la misma venta.",
    "Le escribís por WhatsApp a cada cliente para recordarle que te pague.",
    "Conciliás transferencias a mano y armás cada pedido uno por uno.",
    "No sabés cuánto vas a facturar el mes que viene.",
  ];
  const con = [
    "El cliente se suscribe una vez y queda cobrando solo.",
    "Mercado Pago cobra cada período y la plata entra en tu cuenta.",
    "Cada cobro crea la orden en tu negocio, lista para despachar.",
    "Ves tus ingresos recurrentes, próximos cobros y bajas en un panel.",
  ];
  const Col = ({ title, items, good }) => (
    <div style={{background:good ? T.accentSolid + "0f" : T.card,border:`1px solid ${good ? T.accentSolid + "66" : T.border}`,borderRadius:18,padding:"22px 22px 24px"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
        <span style={{width:30,height:30,borderRadius:99,display:"inline-flex",alignItems:"center",justifyContent:"center",background:good ? T.accentSolid : T.border,color:good ? "#fff" : T.textMd,fontWeight:800,fontSize:14}}>{good ? "✓" : "✕"}</span>
        <span style={{fontSize:17,fontWeight:800,color:T.text}}>{title}</span>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {items.map(t => <div key={t} style={{display:"flex",gap:10,fontSize:14,lineHeight:1.55,color:good ? T.text : T.textMd}}>{good ? <Check c={T.accent}/> : <Cross c={T.textSm}/>}<span>{t}</span></div>)}
      </div>
    </div>
  );
  return (
    <section className="ls-sec">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Por qué suscripción" title="Cada venta te cuesta como la primera"
          sub="Si tu cliente te compra una y otra vez, venderle cada vez es trabajo y publicidad repetidos. Con una suscripción, la venta se hace una sola vez y se repite sola."/>
        <div className="ls-two">
          <Col title="Vendiendo a mano" items={hoy}/>
          <Col title="Con Recurrentes" items={con} good/>
        </div>
      </div>
    </section>
  );
}

// ─── 2. Casos por rubro (tabs) ───────────────────────────────────────────
const CASES = [
  { id:"tiendas", tab:"Tiendas online", title:"Tu cliente recibe su pedido sin volver a comprar",
    how:"Widget en la página de producto (Shopify hoy, Tiendanube muy pronto)",
    plan:{ name:"Café de especialidad · pack x2", freq:"cada 15 días", price:40500, note:"-10% por suscribirse" },
    points:["Compra única o suscripción en el mismo producto, con packs x1 · x2 · x3.","Cada cobro crea la orden paga con dirección y envío. Vos empaquetás.","Tu cliente cambia la dirección o pausa desde su portal."] },
  { id:"cursos", tab:"Cursos y ebooks", title:"Cobrá la cuota de tu curso sin perseguir a nadie",
    how:"Link de suscripción (Impultienda muy pronto)",
    plan:{ name:"Club de lectura · un ebook por mes", freq:"mensual", price:9900, note:"Primer mes con cupón" },
    points:["Compartís el link en tu bio, tu web o por WhatsApp.","Cada cobro queda registrado: sabés quién está al día y quién no.","Si una tarjeta rebota, le avisamos con el link para actualizarla."] },
  { id:"membresias", tab:"Membresías y clubes", title:"Una comunidad que se paga sola todos los meses",
    how:"Link de suscripción",
    plan:{ name:"Comunidad privada · acceso mensual", freq:"mensual", price:8000, note:"Cancelan cuando quieren" },
    points:["El socio se suscribe una vez y la cuota se cobra sola.","Ofrecés una pausa antes de que alguien cancele.","Métricas de altas, bajas e ingresos recurrentes en el panel."] },
  { id:"gimnasios", tab:"Gimnasios y estudios", title:"La cuota del gimnasio, cobrada el día que corresponde",
    how:"Link de suscripción · control de acceso en el radar",
    plan:{ name:"Pase libre mensual", freq:"mensual", price:25000, note:"Sin efectivo ni transferencias" },
    points:["Tus socios pagan con tarjeta y se renueva sola cada mes.","Ves en un panel quién está al día y quién tiene el pago rechazado.","Cada socio pausa o cancela desde su portal, sin llamarte."] },
];
export function UseCasesSection({ T }) {
  const [id, setId] = useState(CASES[0].id);
  const c = CASES.find(x => x.id === id) || CASES[0];
  return (
    <section className="ls-sec-alt" id="rec-casos">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Para tu rubro" title="Si tu cliente vuelve, puede suscribirse"
          sub="Productos que se reponen, contenido que se renueva, cuotas que se pagan todos los meses. Elegí tu rubro y mirá cómo funciona."/>
        <div className="ls-tabs" role="tablist" aria-label="Rubros" style={{marginBottom:28}}>
          {CASES.map(x => {
            const on = x.id === id;
            return (
              <button key={x.id} role="tab" aria-selected={on} className="ls-tab" onClick={() => setId(x.id)}
                style={{padding:"9px 16px",borderRadius:99,border:`1px solid ${on ? T.accentSolid : T.border}`,background:on ? T.accentSolid : T.card,color:on ? "#fff" : T.textMd,fontWeight:700,fontSize:13.5,cursor:"pointer",fontFamily:F}}>
                {x.tab}
              </button>
            );
          })}
        </div>
        <div className="ls-case" role="tabpanel">
          <div>
            <h3 style={{fontSize:24,fontWeight:800,letterSpacing:-0.5,margin:"0 0 8px",color:T.text,textWrap:"balance"}}>{c.title}</h3>
            <div style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:12.5,fontWeight:600,color:T.accent,background:T.accentSolid + "14",borderRadius:8,padding:"4px 10px"}}>{c.how}</div>
            <Bullets T={T} items={c.points}/>
          </div>
          <MockFrame T={T} label="Así lo ve tu cliente">
            <div style={{fontSize:10,fontWeight:800,color:T.accent,textTransform:"uppercase",letterSpacing:0.5}}>Suscripción · {c.plan.freq}</div>
            <div style={{fontSize:16,fontWeight:800,color:T.text,margin:"4px 0 12px",lineHeight:1.3}}>{c.plan.name}</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",borderTop:`1px solid ${T.border}`,paddingTop:12}}>
              <span style={{fontSize:13,color:T.textSm}}>{c.plan.note}</span>
              <span style={{fontSize:22,fontWeight:900,color:T.text,letterSpacing:-0.6,fontVariantNumeric:"tabular-nums"}}>{fmt$(c.plan.price)}</span>
            </div>
            <div style={{marginTop:14,padding:"12px",borderRadius:11,background:T.accentSolid,color:"#fff",fontWeight:800,fontSize:14,textAlign:"center"}}>Suscribirme</div>
            <div style={{marginTop:8,fontSize:11,color:T.textSm,textAlign:"center"}}>Se renueva sola. Pausás o cancelás cuando quieras.</div>
          </MockFrame>
        </div>
      </div>
    </section>
  );
}

// ─── 3. Deep-dives (texto + maqueta, alternados) ─────────────────────────
function WidgetMock({ T }) {
  const packs = [["x1", 45000, 40500, ""], ["x2", 90000, 76500, "Más elegido"], ["x3", 135000, 108000, "Mejor precio"]];
  return (
    <MockFrame T={T} label="Widget en tu producto">
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
        {packs.map(([q, full, sub, tag], i) => (
          <div key={q} style={{position:"relative",border:`1.5px solid ${i === 1 ? T.accentSolid : T.border}`,background:i === 1 ? T.accentSolid + "12" : T.bg,borderRadius:12,padding:"14px 10px 12px",textAlign:"center"}}>
            {tag && <div style={{position:"absolute",top:-9,left:"50%",transform:"translateX(-50%)",fontSize:9,fontWeight:800,background:i === 1 ? T.accentSolid : T.textSm,color:"#fff",borderRadius:99,padding:"2px 8px",whiteSpace:"nowrap"}}>{tag}</div>}
            <div style={{fontSize:18,fontWeight:900,color:T.text}}>{q}</div>
            <div style={{fontSize:11,color:T.textSm,textDecoration:"line-through",marginTop:4}}>{fmt$(full)}</div>
            <div style={{fontSize:14,fontWeight:800,color:T.accent,fontVariantNumeric:"tabular-nums"}}>{fmt$(sub)}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:6,marginTop:12}}>
        {["Cada 30 días","Cada 60 días"].map((f, i) => <div key={f} style={{flex:1,textAlign:"center",fontSize:12,fontWeight:700,padding:"8px",borderRadius:9,border:`1px solid ${i === 0 ? T.accentSolid : T.border}`,color:i === 0 ? T.accent : T.textMd}}>{f}</div>)}
      </div>
      <div style={{marginTop:12,padding:"12px",borderRadius:11,background:T.accentSolid,color:"#fff",fontWeight:800,fontSize:14,textAlign:"center"}}>Suscribirme · {fmt$(76500)}</div>
    </MockFrame>
  );
}
function TimelineMock({ T }) {
  const rows = [
    ["14 sep · 09:02", "Cobro aprobado en Mercado Pago", fmt$(76500), T.accentSolid],
    ["14 sep · 09:02", "Orden #1042 creada en tu tienda", "Paga · con envío", T.accentSolid],
    ["14 sep · 09:03", "Mail de confirmación al cliente", "Automático", T.accentSolid],
    ["14 oct", "Próximo cobro programado", fmt$(76500), T.textSm],
  ];
  return (
    <MockFrame T={T} label="Qué pasa en cada cobro">
      <div style={{position:"relative",paddingLeft:18}}>
        <div style={{position:"absolute",left:5,top:6,bottom:6,width:2,background:T.border,borderRadius:2}}/>
        {rows.map(([when, what, val, c], i) => (
          <div key={i} style={{position:"relative",padding:"8px 0",display:"flex",justifyContent:"space-between",gap:10,alignItems:"baseline"}}>
            <span style={{position:"absolute",left:-17,top:13,width:10,height:10,borderRadius:99,background:c,boxShadow:`0 0 0 3px ${T.card}`}}/>
            <div style={{minWidth:0}}>
              <div style={{fontSize:13.5,fontWeight:700,color:T.text}}>{what}</div>
              <div style={{fontSize:11,color:T.textSm,marginTop:2}}>{when}</div>
            </div>
            <div style={{fontSize:12.5,fontWeight:700,color:c === T.textSm ? T.textSm : T.accent,whiteSpace:"nowrap",fontVariantNumeric:"tabular-nums"}}>{val}</div>
          </div>
        ))}
      </div>
    </MockFrame>
  );
}
function PortalMock({ T }) {
  return (
    <div style={{display:"flex",justifyContent:"center"}}>
      <div style={{width:"min(100%, 290px)",background:T.card,border:`1px solid ${T.border}`,borderRadius:30,padding:"18px 14px 16px",boxShadow:"0 24px 56px rgba(0,0,0,0.25)"}}>
        <div style={{width:70,height:5,borderRadius:99,background:T.border,margin:"0 auto 16px"}}/>
        <div style={{fontSize:10,fontWeight:800,color:T.textSm,letterSpacing:0.5,textTransform:"uppercase"}}>Tu suscripción · Ejemplo</div>
        <div style={{fontSize:16,fontWeight:800,color:T.text,margin:"4px 0 10px"}}>Café de especialidad x2</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:12}}>
          {[["Próximo cobro","14 oct"],["Por cobro",fmt$(76500)]].map(([k, v]) => (
            <div key={k} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 10px"}}>
              <div style={{fontSize:9,fontWeight:700,color:T.textSm,textTransform:"uppercase",letterSpacing:0.4}}>{k}</div>
              <div style={{fontSize:14,fontWeight:800,color:T.text,fontVariantNumeric:"tabular-nums"}}>{v}</div>
            </div>
          ))}
        </div>
        {[["Cambiar dirección", false], ["Pausar un mes", false], ["Cancelar suscripción", true]].map(([l, danger]) => (
          <div key={l} style={{padding:"10px 12px",borderRadius:10,border:`1px solid ${danger ? T.red + "55" : T.border}`,color:danger ? T.red : T.text,fontSize:13,fontWeight:700,marginTop:6,textAlign:"center"}}>{l}</div>
        ))}
      </div>
    </div>
  );
}
function RetentionMock({ T }) {
  return (
    <MockFrame T={T} label="Pagos fallidos y retención">
      <div style={{border:`1px solid ${T.yellow}66`,background:T.yellow + "12",borderRadius:12,padding:"12px 14px"}}>
        <div style={{fontSize:13.5,fontWeight:800,color:T.text}}>Pago rechazado · Ana Pérez</div>
        <div style={{fontSize:12.5,color:T.textMd,marginTop:4,lineHeight:1.5}}>Mercado Pago lo va a reintentar. Le mandamos a Ana el link para actualizar la tarjeta.</div>
      </div>
      <div style={{border:`1px solid ${T.border}`,borderRadius:12,padding:"14px",marginTop:10,background:T.bg}}>
        <div style={{fontSize:13.5,fontWeight:800,color:T.text}}>¿Seguro que querés cancelar?</div>
        <div style={{fontSize:12.5,color:T.textMd,margin:"4px 0 10px",lineHeight:1.5}}>Podés pausar tu suscripción uno, dos o tres meses y volver cuando quieras.</div>
        <div style={{display:"flex",gap:6}}>
          <div style={{flex:1,textAlign:"center",padding:"9px",borderRadius:9,background:T.accentSolid,color:"#fff",fontSize:12.5,fontWeight:800}}>Pausar 1 mes</div>
          <div style={{flex:1,textAlign:"center",padding:"9px",borderRadius:9,border:`1px solid ${T.border}`,color:T.textMd,fontSize:12.5,fontWeight:700}}>Cancelar igual</div>
        </div>
      </div>
    </MockFrame>
  );
}
function MetricsMock({ T }) {
  const vals = [1.2, 1.9, 2.6, 3.3, 4.4, 5.2];
  const months = ["abr", "may", "jun", "jul", "ago", "sep"];
  const W = 300, H = 120, pad = 8, max = 6;
  const x = (i) => pad + i * ((W - pad * 2) / (vals.length - 1));
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const area = `${line} L${x(vals.length - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  return (
    <MockFrame T={T} label="Tu panel">
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[["MRR","$ 5,2M",T.accent],["Activas","128",T.text],["Churn 30d","3,1%",T.text]].map(([l, v, c]) => (
          <div key={l} style={{background:T.bg,border:`1px solid ${T.border}`,borderRadius:10,padding:"8px 10px"}}>
            <div style={{fontSize:9,fontWeight:700,color:T.textSm,textTransform:"uppercase",letterSpacing:0.4}}>{l}</div>
            <div style={{fontSize:17,fontWeight:800,color:c,fontVariantNumeric:"tabular-nums"}}>{v}</div>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label="Ejemplo de MRR creciendo de abril a septiembre">
        {[0.25, 0.5, 0.75].map(f => <line key={f} x1={pad} x2={W - pad} y1={pad + f * (H - pad * 2)} y2={pad + f * (H - pad * 2)} stroke={T.border} strokeWidth="1"/>)}
        <path d={area} fill={T.accentSolid} fillOpacity="0.14"/>
        <path d={line} fill="none" stroke={T.accentSolid} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/>
        <circle cx={x(vals.length - 1)} cy={y(vals[vals.length - 1])} r="4.5" fill={T.accentSolid} stroke={T.card} strokeWidth="2"/>
        {months.map((m, i) => <text key={m} x={x(i)} y={H + 12} textAnchor="middle" fontSize="10" fill={T.textSm} fontFamily={F}>{m}</text>)}
      </svg>
    </MockFrame>
  );
}
export function DeepDivesSection({ T }) {
  const rows = [
    { eyebrow:"Widget", title:"Compra única o suscripción, en la misma página de producto", text:"Tu cliente elige cómo comprar sin salir del producto. Vos definís el descuento, la frecuencia y los packs.",
      points:["Packs x1 · x2 · x3 con precio tachado y etiqueta de \"más elegido\".","10 diseños para elegir, con tu color y tus textos.","Descuento por suscribirse o solo en el primer cobro."], mock:<WidgetMock T={T}/> },
    { eyebrow:"Piloto automático", title:"Cada cobro aprobado se convierte en una orden", text:"Mercado Pago cobra en la fecha que corresponde y Recurrentes arma la orden en tu negocio, con todo lo que necesitás para despachar.",
      points:["Orden paga con dirección, envío y stock descontado.","El cliente recibe el mail de confirmación como en cualquier compra.","Sin planillas ni pedidos cargados a mano."], mock:<TimelineMock T={T}/> },
    { eyebrow:"Portal del suscriptor", title:"Tus clientes se gestionan solos", text:"Cada suscriptor tiene su link para ver su plan y hacer cambios sin escribirte.",
      points:["Pausar, reactivar o cancelar en dos toques.","Cambiar la dirección de envío antes del próximo cobro.","Un mensaje de bienvenida con la voz de tu marca."], mock:<PortalMock T={T}/> },
    { eyebrow:"Retención", title:"Recuperá pagos rechazados y bajas antes de que pasen", text:"Una parte de las bajas no es porque el cliente se quiera ir: es una tarjeta vencida o un mes complicado.",
      points:["Aviso automático cuando una tarjeta rebota, con el link para actualizarla.","Oferta de pausa antes de cancelar, y motivos de baja para aprender.","Flujos de mails propios: checkout sin pagar, aviso de cobro, pago rechazado y win-back, con tu marca."], mock:<RetentionMock T={T}/> },
    { eyebrow:"Métricas", title:"Sabé cuánto vas a facturar el mes que viene", text:"El panel te muestra tu negocio recurrente de un vistazo, sin armar reportes.",
      points:["Ingresos recurrentes (MRR), altas, bajas y churn.","Próximos cobros de los siguientes 30 días.","Cobros con error señalados para que los resuelvas."], mock:<MetricsMock T={T}/> },
  ];
  return (
    <section className="ls-sec" id="rec-funciones">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Funciones" title="Todo lo que hace Recurrentes por vos" sub="Del botón de suscribirse al pedido listo para despachar, y todo lo que pasa en el medio."/>
        {rows.map((r, i) => (
          <div key={r.title} className={`ls-dd${i % 2 ? " flip" : ""}`}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.8,textTransform:"uppercase",marginBottom:10}}>{r.eyebrow}</div>
              <h3 style={{fontSize:26,fontWeight:800,letterSpacing:-0.6,lineHeight:1.18,margin:"0 0 10px",color:T.text,textWrap:"balance"}}>{r.title}</h3>
              <p style={{fontSize:15,color:T.textSm,lineHeight:1.65,margin:0,maxWidth:520}}>{r.text}</p>
              <Bullets T={T} items={r.points}/>
            </div>
            <div>{r.mock}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ─── 4. Y además (funciones que ya existen) ──────────────────────────────
export function ExtrasSection({ T }) {
  const items = [
    ["M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82zM7 7h.01", "Cupones de descuento", "Porcentaje o monto fijo, y descuento solo en el primer cobro."],
    ["M4 4h16v16H4zM4 9h16M9 9v11", "10 diseños de widget", "Con tu color, tus esquinas y tus textos."],
    ["M22 12h-6l-2 3h-4l-2-3H2", "Flujos de mails automáticos", "Checkout sin pagar, aviso de próximo cobro, pago rechazado y win-back, salen solos y con tu marca."],
    ["M18 20V10M12 20V4M6 20v-6", "Ventas a Meta", "La primera venta se reporta por la API de Conversiones."],
    ["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z", "Equipo con permisos", "Cada persona ve solo las secciones que le habilitás."],
    ["M3 9l1-5h16l1 5M3 9h18v11H3z", "Varios negocios", "Todas tus tiendas en un solo login."],
    ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3", "Exportás tus suscriptores", "Tu base en CSV cuando la necesites."],
    ["M1 3h15v13H1zM16 8h4l3 3v5h-7", "Envíos configurables", "Tus tarifas de envío y envío gratis desde un monto."],
  ];
  return (
    <section className="ls-sec">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Y además" title="Los detalles que hacen la diferencia"/>
        <div className="ls-grid4">
          {items.map(([icon, t, d]) => (
            <div key={t} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.xl,padding:"16px 16px 18px"}}>
              <div style={{width:34,height:34,borderRadius:10,background:T.accentSolid + "18",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:10}}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={icon}/></svg>
              </div>
              <div style={{fontSize:14,fontWeight:700,color:T.text,marginBottom:4}}>{t}</div>
              <div style={{fontSize:12.5,color:T.textSm,lineHeight:1.55}}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 4b. Un mes con Recurrentes (relato de ejemplo) ──────────────────────
export function MonthStorySection({ T }) {
  const steps = [
    ["Día 1", "Ana se suscribe", "Elige el pack x2 cada 30 días en tu página de producto y paga con Mercado Pago.", T.accentSolid],
    ["Día 1", "Primer cobro, primera orden", "La plata entra en tu cuenta y la orden aparece en tu tienda, lista para despachar.", T.accentSolid],
    ["Día 31", "Segundo cobro, sin que nadie haga nada", "Mercado Pago cobra solo y Recurrentes crea la orden nueva.", T.accentSolid],
    ["Día 61", "La tarjeta de Ana rebota", "Le avisamos con un link para actualizarla y Mercado Pago reintenta. Vos lo ves marcado en el panel.", T.yellow],
    ["Día 63", "Ana actualiza la tarjeta", "El cobro sale aprobado y la orden se crea como siempre.", T.accentSolid],
    ["Día 75", "Ana se va de vacaciones", "Desde su portal pausa un mes en vez de cancelar. Al volver, la suscripción se reactiva sola.", T.accentSolid],
  ];
  return (
    <section className="ls-sec-alt">
      <div className="ls-wrap" style={{maxWidth:820}}>
        <SectionHead T={T} eyebrow="Un mes con Recurrentes · ejemplo" title="Así se ve una suscripción de punta a punta"
          sub="Una clienta de ejemplo, Ana, y todo lo que pasa sin que tengas que intervenir."/>
        <ol style={{listStyle:"none",margin:0,padding:0,position:"relative"}}>
          <div aria-hidden="true" style={{position:"absolute",left:97,top:10,bottom:10,width:2,background:T.border}}/>
          {steps.map(([day, t, d, c], i) => (
            <li key={i} style={{display:"grid",gridTemplateColumns:"80px 36px minmax(0,1fr)",alignItems:"start",padding:"10px 0"}}>
              <span style={{fontSize:12,fontWeight:800,color:T.textSm,textTransform:"uppercase",letterSpacing:0.5,paddingTop:3,textAlign:"right",paddingRight:8,fontVariantNumeric:"tabular-nums"}}>{day}</span>
              <span style={{position:"relative",display:"flex",justifyContent:"center",paddingTop:4}}>
                <span style={{width:14,height:14,borderRadius:99,background:c,boxShadow:`0 0 0 4px ${T.surface}`}}/>
              </span>
              <div style={{background:T.card,border:`1px solid ${c === T.yellow ? T.yellow + "66" : T.border}`,borderRadius:14,padding:"12px 16px"}}>
                <div style={{fontSize:15,fontWeight:800,color:T.text}}>{t}</div>
                <div style={{fontSize:13.5,color:T.textMd,lineHeight:1.55,marginTop:3}}>{d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─── 5. Calculadora de ingresos recurrentes (ilustrativa) ────────────────
// Modelo simple: cada mes se suman N suscriptores y se quedan L meses en
// promedio (baja mensual c = 1/L). Activos al mes m = N·(1 − (1−c)^m)/c.
export function CalculatorSection({ T }) {
  const [nuevos, setNuevos] = useState(20);
  const [ticket, setTicket] = useState(25000);
  const [meses, setMeses] = useState(8);
  const r = useMemo(() => {
    const c = 1 / Math.max(1, meses);
    const act = (m) => nuevos * (1 - Math.pow(1 - c, m)) / c;
    const serie = Array.from({ length: 12 }, (_, i) => act(i + 1));
    const total = serie.reduce((a, s) => a + s * ticket, 0);
    const a12 = serie[11];
    return { serie, total, a12, mrr: a12 * ticket, tier: tierFor(Math.round(a12)) };
  }, [nuevos, ticket, meses]);
  const W = 320, H = 110, pad = 6;
  const max = Math.max(...r.serie, 1);
  const bw = (W - pad * 2) / 12;
  const Field = ({ label, value, children }) => (
    <label style={{display:"block",marginBottom:18}}>
      <span style={{display:"flex",justifyContent:"space-between",fontSize:13,fontWeight:700,color:T.text,marginBottom:8}}><span>{label}</span><span style={{color:T.accent,fontVariantNumeric:"tabular-nums"}}>{value}</span></span>
      {children}
    </label>
  );
  return (
    <section className="ls-sec" id="rec-calculadora">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Calculadora" title="¿Cuánto podrías facturar por suscripción?"
          sub="Mové los valores y mirá cómo crece tu ingreso recurrente en un año. Es una estimación ilustrativa, no una promesa."/>
        <div className="ls-calc">
          <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:18,padding:"22px 22px 8px"}}>
            <Field label="Suscriptores nuevos por mes" value={fmtN(nuevos)}>
              <input className="ls-range" type="range" min="1" max="200" value={nuevos} onChange={e => setNuevos(Number(e.target.value))}/>
            </Field>
            <Field label="Precio por cobro (mensual)" value={fmt$(ticket)}>
              <input className="ls-range" type="range" min="2000" max="150000" step="500" value={ticket} onChange={e => setTicket(Number(e.target.value))}/>
            </Field>
            <Field label="Meses que se queda cada cliente" value={`${meses} meses`}>
              <input className="ls-range" type="range" min="2" max="24" value={meses} onChange={e => setMeses(Number(e.target.value))}/>
            </Field>
          </div>
          <div style={{background:T.accentSolid + "0f",border:`1px solid ${T.accentSolid}55`,borderRadius:18,padding:22,display:"flex",flexDirection:"column",gap:14}}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
              {[["Activos al mes 12", fmtN(r.a12)], ["Ingreso mensual", fmt$(r.mrr)], ["Cobrado en 12 meses", fmt$(r.total)]].map(([l, v]) => (
                <div key={l}>
                  <div style={{fontSize:10.5,fontWeight:800,color:T.textSm,textTransform:"uppercase",letterSpacing:0.4}}>{l}</div>
                  <div style={{fontSize:20,fontWeight:900,color:T.text,letterSpacing:-0.5,fontVariantNumeric:"tabular-nums",overflowWrap:"anywhere"}}>{v}</div>
                </div>
              ))}
            </div>
            <svg viewBox={`0 0 ${W} ${H + 14}`} width="100%" role="img" aria-label="Suscriptores activos mes a mes durante 12 meses">
              {r.serie.map((s, i) => {
                const h = (s / max) * (H - pad);
                return <rect key={i} x={pad + i * bw + 2} y={H - h} width={bw - 4} height={h} rx="3" fill={T.accentSolid} fillOpacity={i === 11 ? 1 : 0.45}/>;
              })}
              {[1, 6, 12].map(m => <text key={m} x={pad + (m - 1) * bw + bw / 2} y={H + 12} textAnchor="middle" fontSize="10" fill={T.textSm} fontFamily={F}>mes {m}</text>)}
            </svg>
            <div style={{fontSize:13,color:T.textMd,lineHeight:1.55,borderTop:`1px solid ${T.accentSolid}33`,paddingTop:12}}>
              Con {fmtN(r.a12)} suscriptores activos, Recurrentes te costaría <strong style={{color:T.text}}>{r.tier.usd ? `USD ${r.tier.usd} por mes` : "nada: estás dentro de los gratis"}</strong> (plan {r.tier.label}).
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 6. Confianza ────────────────────────────────────────────────────────
export function TrustSection({ T }) {
  const items = [
    ["La plata va directo a tu cuenta", "Cada cobro entra en tu Mercado Pago, como cualquier venta. Recurrentes no toca tu dinero."],
    ["Las tarjetas las guarda Mercado Pago", "Tu cliente paga en el checkout de Mercado Pago. Nosotros nunca vemos los datos de la tarjeta."],
    ["Tus clientes son tuyos", "Exportás tu base de suscriptores cuando quieras y usás tus propias herramientas."],
    ["Sin permanencia", "Pagás según tus suscriptores activos y cancelás cuando quieras, sin contrato."],
  ];
  return (
    <section className="ls-sec-alt">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Confianza" title="Tu plata, tus clientes, tus reglas"/>
        <div className="ls-grid4">
          {items.map(([t, d]) => (
            <div key={t} style={{padding:"4px 2px"}}>
              <div style={{width:36,height:36,borderRadius:99,background:T.accentSolid,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",marginBottom:12}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
              </div>
              <div style={{fontSize:15,fontWeight:800,color:T.text,marginBottom:6}}>{t}</div>
              <div style={{fontSize:13.5,color:T.textSm,lineHeight:1.6}}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 7. Preguntas frecuentes ─────────────────────────────────────────────
const FAQS = [
  ["¿Necesito saber programar?", "No. Conectás tu negocio y Mercado Pago desde el panel, creás un plan y pegás una línea en tu tienda o compartís un link. Se hace en unos 10 minutos."],
  ["¿Dónde recibo la plata?", "En tu cuenta de Mercado Pago, como cualquier otra venta. Recurrentes solo da de alta las suscripciones y escucha los cobros."],
  ["¿Qué pasa si falla un cobro?", "Mercado Pago lo reintenta y le avisamos al cliente con un link para actualizar la tarjeta. Vos lo ves marcado en el panel."],
  ["¿Mis clientes pueden pausar o cancelar?", "Sí, desde su portal y sin escribirte. Si querés, antes de cancelar les ofrecemos pausar uno, dos o tres meses."],
  ["¿Con qué medios paga el cliente?", "Con tarjeta de crédito, y con débito o dinero en cuenta cuando Mercado Pago lo habilita para suscripciones."],
  ["¿Funciona con Tiendanube?", "Sí, ya funciona: instalás la app desde Tiendanube en un clic y el widget de suscripción aparece solo en tus productos con plan. Con Shopify es una línea en el tema."],
  ["¿Y con WooCommerce, Empretienda o Impultienda?", "Están en camino. Mientras tanto, el link de suscripción sirve para cualquier negocio, tenga la tienda que tenga."],
  ["¿Puedo vender sin tienda online?", "Sí. Cada plan tiene su link: lo compartís por Instagram, WhatsApp o tu web, y el cliente se suscribe desde ahí."],
  ["¿Cuánto cuesta Recurrentes?", `Es gratis hasta ${FREE_SUBSCRIBERS} suscriptores activos. Después pagás según cuántos clientes tenés cobrando, desde USD 49 por mes, con todo incluido.`],
  ["¿Qué cuenta como suscriptor activo?", "Un cliente con su suscripción cobrando, o con un pago que Mercado Pago está reintentando. Los pausados y cancelados no cuentan."],
  ["¿Puedo dar descuentos?", "Sí: descuento por suscribirse, packs con mejor precio, cupones y descuento solo en el primer cobro."],
  ["¿Mercado Pago me cobra comisión?", "Sí, la comisión habitual de Mercado Pago por cada cobro, como en cualquier venta. Recurrentes no suma comisión por cobro: pagás un plan según tus suscriptores."],
  ["¿Sirve si no hago envíos?", "Sí. Para cursos, contenido o membresías el checkout no pide dirección ni envío, y cada cobro queda registrado en el panel."],
];
export function FaqSection({ T }) {
  return (
    <section className="ls-sec-alt" id="rec-faq">
      <div className="ls-wrap" style={{maxWidth:820}}>
        <SectionHead T={T} eyebrow="Preguntas frecuentes" title="Lo que todos preguntan antes de empezar"/>
        <div className="ls-faq" style={{display:"flex",flexDirection:"column",gap:8}}>
          {FAQS.map(([q, a], i) => (
            <details key={q} open={i === 0} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:14,padding:"0 18px"}}>
              <summary style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:14,padding:"16px 0",fontSize:15,fontWeight:700,color:T.text}}>
                {q}<span className="ls-plus" aria-hidden="true" style={{fontSize:22,lineHeight:1,color:T.accent,fontWeight:500}}>+</span>
              </summary>
              <p style={{margin:"0 0 16px",fontSize:14,color:T.textMd,lineHeight:1.65}}>{a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── 8. Pie de página ────────────────────────────────────────────────────
export function BigFooter({ T, onGo, onRegister }) {
  const link = { background:"none", border:"none", padding:0, color:T.textSm, fontSize:13, cursor:"pointer", fontFamily:F, textAlign:"left", textDecoration:"none" };
  const cols = [
    ["Producto", [["Cómo funciona","rec-como-funciona"],["Funciones","rec-funciones"],["Integraciones","rec-tiendas"],["Precios","rec-precios"],["Calculadora","rec-calculadora"]]],
    ["Para", [["Tiendas online","rec-casos"],["Cursos y ebooks","rec-casos"],["Membresías y clubes","rec-casos"],["Gimnasios y estudios","rec-casos"]]],
    ["Recurrentes", [["Preguntas frecuentes","rec-faq"],["Términos","#/terminos"],["Privacidad","#/privacidad"],["Soporte por WhatsApp","https://wa.me/5491164117974"]]],
  ];
  return (
    <footer style={{borderTop:`1px solid ${T.border}`,padding:"48px 0 28px",background:T.surface}}>
      <div className="ls-wrap">
        <div className="ls-foot">
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12}}>
              <RecLogo size={28}/><span style={{fontWeight:800,fontSize:17,color:T.text}}>Recurrentes</span>
            </div>
            <p style={{fontSize:13,color:T.textSm,lineHeight:1.6,margin:"0 0 16px",maxWidth:300}}>Suscripciones y cobros recurrentes para negocios online.</p>
            <button onClick={onRegister} style={{...BtnSolid(T),padding:"9px 16px",fontSize:13}}>Empezar gratis</button>
          </div>
          {cols.map(([title, items]) => (
            <div key={title}>
              <div style={{fontSize:11,fontWeight:800,color:T.text,letterSpacing:0.6,textTransform:"uppercase",marginBottom:12}}>{title}</div>
              <div style={{display:"flex",flexDirection:"column",gap:9}}>
                {items.map(([l, target]) => /^(#|https?:)/.test(target)
                  ? <a key={l} href={target} style={link} {...(target.startsWith("http") ? { target:"_blank", rel:"noreferrer" } : {})}>{l}</a>
                  : <button key={l} style={link} onClick={() => onGo?.(target)}>{l}</button>)}
              </div>
            </div>
          ))}
        </div>
        <div style={{borderTop:`1px solid ${T.border}`,marginTop:32,paddingTop:18,fontSize:12,color:T.textSm,display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
          <span>© {new Date().getFullYear()} Recurrentes</span>
          <span>Precios en dólares · Cobros con Mercado Pago</span>
        </div>
      </div>
    </footer>
  );
}



// ─── Video: Recurrentes en acción (después de las integraciones) ─────────
export function VideoSection({ T, url, poster, duration }) {
  const ref = React.useRef(null);
  const [playing, setPlaying] = React.useState(false);
  if (!url) return null;
  const play = () => { try { ref.current?.play(); } catch (_) {} };
  const parts = [
    ["01", "Por dentro", "El panel: suscriptores, cobros, analíticas y el widget."],
    ["02", "En tu tienda", "Cómo lo ve tu cliente: packs, suscripción y compra única."],
    ["03", "Precios", "Gratis hasta 10 suscriptores y cómo se cobra el plan."],
  ];
  return (
    <section className="ls-sec" id="rec-video">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Recurrentes en acción" title="Mirá cómo funciona, de punta a punta"
          sub={`El panel por dentro, cómo se ve en tu tienda y cuánto cuesta. ${duration ? duration + ", " : ""}sin vueltas.`}/>
        <div style={{position:"relative",maxWidth:960,margin:"0 auto"}}>
          <div style={{position:"absolute",inset:-40,background:`radial-gradient(circle at 50% 30%, ${T.accentSolid}26 0%, transparent 60%)`,filter:"blur(34px)",pointerEvents:"none"}}/>
          <div style={{position:"relative",background:"#0b0f0d",border:`1px solid ${T.border}`,borderRadius:20,overflow:"hidden",boxShadow:"0 30px 80px rgba(0,0,0,0.35)",aspectRatio:"1658 / 1080"}}>
            <video ref={ref} src={url} poster={poster} controls playsInline preload="none"
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              style={{display:"block",width:"100%",height:"100%",objectFit:"contain",background:"#0b0f0d"}}/>
            {!playing && (
              <button type="button" onClick={play} aria-label="Reproducir el video"
                style={{position:"absolute",inset:0,width:"100%",height:"100%",background:"linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.35))",border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:14,color:"#fff",fontFamily:F}}>
                <span style={{width:84,height:84,borderRadius:99,background:`linear-gradient(135deg, ${T.accentSolid}, #059669)`,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 18px 44px ${T.accentSolid}66`}}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>
                </span>
                <span style={{fontSize:14,fontWeight:700,textShadow:"0 2px 10px rgba(0,0,0,0.6)"}}>Ver el recorrido completo{duration ? ` · ${duration}` : ""}</span>
              </button>
            )}
          </div>
        </div>
        <div className="ls-grid4" style={{gridTemplateColumns:"repeat(3,1fr)",maxWidth:960,margin:"22px auto 0"}}>
          {parts.map(([n, t, d]) => (
            <div key={n} style={{display:"flex",gap:12,alignItems:"flex-start",padding:"14px 16px",background:T.card,border:`1px solid ${T.border}`,borderRadius:14}}>
              <span style={{fontSize:11,fontWeight:800,color:T.accent,letterSpacing:0.6,marginTop:2}}>{n}</span>
              <div><div style={{fontSize:14,fontWeight:800,color:T.text}}>{t}</div><div style={{fontSize:12.5,color:T.textSm,lineHeight:1.55,marginTop:2}}>{d}</div></div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Comparativa (nombres difuminados: comparamos funciones, no marcas) ──
// Columnas: Recurrentes · la alternativa local · las apps internacionales de
// Shopify. Valores: true ✓ · false ✗ · "~" según el caso · texto libre.
const COMPARE_ROWS = [
  ["Costo de instalación", ["Gratis", true], "USD 150", "Gratis"],
  ["Cobra con Mercado Pago (crédito y débito en pesos)", true, true, ["✗", "Necesitan Shopify Payments, que no existe en Argentina"]],
  ["Funciona en Shopify", true, true, true],
  ["Funciona en Tiendanube", true, false, false],
  ["Checkout propio con los envíos reales de tu tienda", true, "~", ["~", "Solo dentro del checkout de Shopify"]],
  ["Packs x1 · x2 · x3 con precio propio y compra única con el botón del tema", true, "~", "~"],
  ["Portal del cliente: pausar, cancelar, cambiar dirección", true, "~", true],
  ["Avisos por WhatsApp y mails con tu marca", true, false, ["~", "Mails, en inglés"]],
  ["Precio del plan", ["Gratis hasta 10 suscriptores", true], "A cotizar", "USD 99 a 499 por mes"],
  ["Comisión sobre cada venta", ["Ninguna", true], ["Sí", "2% a 3% de cada cobro"], ["Sí", "1% a 2% de cada cobro"]],
  ["Soporte en español por WhatsApp", true, true, false],
];
const COMPARE_COLS = [
  { key:"rec", title:"Recurrentes", real:true },
  { key:"local", title:"Puentify", sub:"Alternativa local" },
  { key:"intl", title:"Recharge · Skio · Appstle", sub:"Apps internacionales" },
];
function CompareCell({ T, v, hero }) {
  const ok = (c) => <Check c={c} size={16}/>;
  const no = (c) => <Cross c={c} size={16}/>;
  if (v === true) return <span style={{display:"inline-flex",alignItems:"center",gap:6,color:T.accent,fontWeight:700}}>{ok(T.accent)}{hero ? "Sí" : "Sí"}</span>;
  if (v === false) return <span style={{display:"inline-flex",alignItems:"center",gap:6,color:T.textSm}}>{no(T.textSm)}No</span>;
  if (v === "~") return <span style={{display:"inline-flex",alignItems:"center",gap:6,color:T.yellow,fontWeight:600}}><span style={{fontSize:14}}>~</span>Según el caso</span>;
  if (Array.isArray(v)) {
    const [main, note] = v;
    if (note === true) return <span style={{color:T.accent,fontWeight:800}}>{main}</span>;
    const icon = main === "✗" ? no(T.textSm) : main === "~" ? <span style={{fontSize:14,color:T.yellow}}>~</span> : null;
    return <span style={{display:"inline-flex",flexDirection:"column",gap:2}}><span style={{display:"inline-flex",alignItems:"center",gap:6,color:main === "✗" ? T.textSm : T.text,fontWeight:600}}>{icon}{main === "✗" ? "No" : main === "~" ? "Parcial" : main}</span><span style={{fontSize:11.5,color:T.textSm,lineHeight:1.4}}>{note}</span></span>;
  }
  return <span style={{color:T.textMd,fontWeight:600}}>{v}</span>;
}
export function ComparisonSection({ T }) {
  return (
    <section className="ls-sec-alt" id="rec-comparar">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Comparativa" title="Hecho para vender por suscripción en Argentina"
          sub="Las apps internacionales cobran con pasarelas que acá no existen y se pagan en dólares más un porcentaje de cada venta. Comparamos funciones, no marcas: los nombres van difuminados."/>
        <div style={{overflowX:"auto",borderRadius:18,border:`1px solid ${T.border}`,background:T.card}}>
          <table style={{width:"100%",borderCollapse:"separate",borderSpacing:0,minWidth:720,fontSize:13.5}}>
            <thead>
              <tr>
                <th style={{textAlign:"left",padding:"16px 18px",fontSize:11,fontWeight:800,color:T.textSm,letterSpacing:0.6,textTransform:"uppercase",borderBottom:`1px solid ${T.border}`,width:"34%"}}>Qué mirar</th>
                {COMPARE_COLS.map(c => (
                  <th key={c.key} style={{textAlign:"left",padding:"14px 18px",borderBottom:`1px solid ${T.border}`,background:c.real ? T.accentSolid + "12" : "transparent",borderTop:c.real ? `3px solid ${T.accentSolid}` : "3px solid transparent"}}>
                    {c.real
                      ? <span style={{display:"inline-flex",alignItems:"center",gap:8,fontSize:15,fontWeight:800,color:T.text}}><RecLogoMini/> {c.title}</span>
                      : <span style={{display:"flex",flexDirection:"column",gap:3}}>
                          <span aria-hidden="true" style={{fontSize:15,fontWeight:800,color:T.textMd,filter:"blur(5px)",userSelect:"none",pointerEvents:"none"}}>{c.title}</span>
                          <span style={{fontSize:11,fontWeight:700,color:T.textSm,letterSpacing:0.4,textTransform:"uppercase"}}>{c.sub}</span>
                        </span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_ROWS.map(([label, ...vals], i) => (
                <tr key={label}>
                  <td style={{padding:"13px 18px",color:T.text,fontWeight:600,borderBottom:i === COMPARE_ROWS.length - 1 ? "none" : `1px solid ${T.borderL || T.border}`,lineHeight:1.45}}>{label}</td>
                  {vals.map((v, j) => (
                    <td key={j} style={{padding:"13px 18px",borderBottom:i === COMPARE_ROWS.length - 1 ? "none" : `1px solid ${T.borderL || T.border}`,background:j === 0 ? T.accentSolid + "0a" : "transparent",verticalAlign:"top",lineHeight:1.45}}>
                      <CompareCell T={T} v={v} hero={j === 0}/>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p style={{fontSize:12,color:T.textSm,textAlign:"center",margin:"16px auto 0",maxWidth:720,lineHeight:1.6}}>Información pública de cada producto a septiembre de 2026. "Según el caso" quiere decir que depende del plan o del tema de la tienda.</p>
      </div>
    </section>
  );
}
function RecLogoMini() {
  return (
    <svg width="20" height="20" viewBox="0 0 32 32" aria-hidden="true" style={{display:"block",flexShrink:0}}>
      <defs><linearGradient id="recCmpGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></linearGradient></defs>
      <circle cx="16" cy="16" r="16" fill="url(#recCmpGrad)"/>
      <path d="M22.5 13.2A7.2 7.2 0 1 0 23.2 18" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/>
      <path d="M22.9 8.6v5.1h-5.1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}


// ─── Reseñas (entre precios y preguntas) ─────────────────────────────────
// Sin fotos: nombre, negocio y el resultado concreto. Son los primeros
// comercios y pruebas piloto; se actualizan a medida que entran marcas.
const REVIEWS = [
  { q: "Lo instalé un martes y el jueves ya tenía la primera suscripción cobrando sola. No toqué una línea de código.", n: "Thiago A.", r: "LuminaLabs · suplementos" },
  { q: "Lo que más me sirvió: cada cobro me arma la orden con el envío de Andreani igual que una venta normal. Antes las cargaba a mano.", n: "Micaela G.", r: "Tienda de cosmética natural" },
  { q: "Tenía las cuotas en una planilla y persiguiendo gente por WhatsApp. Ahora se cobra solo y veo quién está al día.", n: "Federico R.", r: "Estudio de pilates" },
  { q: "El cliente elige el pack de 2 o 3 unidades y paga menos por unidad. Me subió el ticket promedio sin hacer nada.", n: "Camila S.", r: "Café de especialidad" },
  { q: "Los pagos rechazados se recuperan solos con el aviso. Eso era plata que antes perdía y no me enteraba.", n: "Joaquín M.", r: "Alimento para mascotas" },
  { q: "Pedí ayuda por WhatsApp un domingo y me contestaron. Con las apps de afuera eso no pasa.", n: "Valentina T.", r: "Club de vinos" },
];
export function ReviewsSection({ T }) {
  const Stars = () => (
    <span aria-label="5 de 5" style={{display:"inline-flex",gap:2}}>
      {[0,1,2,3,4].map(i => (
        <svg key={i} width="13" height="13" viewBox="0 0 24 24" fill={T.accentSolid} aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
      ))}
    </span>
  );
  return (
    <section className="ls-sec" id="rec-resenas">
      <div className="ls-wrap">
        <SectionHead T={T} eyebrow="Lo que dicen" title="Comercios que ya cobran por suscripción"
          sub="Los primeros negocios que usan Recurrentes todos los días."/>
        <div className="ls-reviews">
          {REVIEWS.map(r => (
            <figure key={r.n + r.q.slice(0, 12)} style={{margin:0,background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"20px 20px 18px",display:"flex",flexDirection:"column",gap:14}}>
              <Stars/>
              <blockquote style={{margin:0,fontSize:14.5,lineHeight:1.62,color:T.text,textWrap:"pretty"}}>“{r.q}”</blockquote>
              <figcaption style={{marginTop:"auto",display:"flex",alignItems:"center",gap:10,paddingTop:4,borderTop:`1px solid ${T.borderL || T.border}`}}>
                <span style={{width:32,height:32,borderRadius:99,background:T.accentSolid+"1c",border:`1px solid ${T.accentSolid}55`,color:T.accent,fontSize:13,fontWeight:800,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{r.n.slice(0,1)}</span>
                <span style={{minWidth:0}}>
                  <span style={{display:"block",fontSize:13.5,fontWeight:800,color:T.text}}>{r.n}</span>
                  <span style={{display:"block",fontSize:12,color:T.textSm}}>{r.r}</span>
                </span>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
