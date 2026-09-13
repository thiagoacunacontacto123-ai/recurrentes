// Componentes base del sistema de diseño de Recurrentes — copia mecánica de
// los de Growith (dependen solo de T/DS/React) recoloreados a verde.
import React from "react";
import ReactDOM from "react-dom";
import { DS } from "./theme.js";
import "./globalStyles.js";

const F = "'Inter',system-ui,sans-serif";

// ─── (?) de ayuda: nubecita al tocar ───────────────────────────────────
export function GhTip({ T, text }) {
  const [open,setOpen]=React.useState(false); const [pos,setPos]=React.useState({top:0,left:0,w:280});
  const ref=React.useRef(null); const ddRef=React.useRef(null);
  React.useEffect(()=>{ if(!open) return; const onDoc=e=>{ if(ref.current&&!ref.current.contains(e.target)&&!(ddRef.current&&ddRef.current.contains(e.target))) setOpen(false); }; const onKey=e=>{ if(e.key==="Escape") setOpen(false); }; document.addEventListener("mousedown",onDoc); document.addEventListener("keydown",onKey); return ()=>{ document.removeEventListener("mousedown",onDoc); document.removeEventListener("keydown",onKey); }; },[open]);
  const toggle=e=>{ e.stopPropagation(); e.preventDefault(); if(!open&&ref.current){ const r=ref.current.getBoundingClientRect(); const w=Math.min(300,window.innerWidth-20); setPos({top:r.bottom+8,left:Math.max(10,Math.min(r.left-8,window.innerWidth-w-10)),w}); } setOpen(o=>!o); };
  return (<>
    <span ref={ref} role="button" tabIndex={0} aria-label={text} onClick={toggle} onKeyDown={e=>{ if(e.key==="Enter"||e.key===" ") toggle(e); }} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", border: `1px solid ${open?T.accent:T.textSm}`, background: open?T.accent+"22":"transparent", color: open?T.accent:T.textSm, fontSize: 9, fontWeight: 800, marginLeft: 5, cursor: "pointer", flexShrink: 0, verticalAlign: "middle", userSelect: "none" }}>?</span>
    {open&&ReactDOM.createPortal(
      <div ref={ddRef} className="gh-dropdown" style={{position:"fixed",top:pos.top,left:pos.left,width:pos.w,zIndex:1200,background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px",fontSize:12,fontWeight:400,color:T.textMd,lineHeight:1.55,boxShadow:"0 12px 32px rgba(0,0,0,.4)",fontFamily:F,textAlign:"left",whiteSpace:"normal"}}>{text}</div>,
      document.body)}
  </>);
}

// ─── Card / Skeleton / KPI ─────────────────────────────────────────────
export function Card({T, children, hoverable, onClick, style={}, padding="lg", className}) {
  const [hover, setHover] = React.useState(false);
  const padMap = {sm:"10px 12px", md:"14px 16px", lg:"18px 20px", xl:"24px 28px"};
  return (
    <div onClick={onClick} className={className}
      onMouseEnter={()=>hoverable&&setHover(true)}
      onMouseLeave={()=>setHover(false)}
      style={{
        background: T.card,
        border: `1px solid ${hover&&hoverable ? T.accentSolid+"66" : T.border}`,
        borderRadius: DS.r.xl,
        padding: padMap[padding]||padMap.lg,
        transition: `all 0.2s ${DS.ease}`,
        cursor: onClick?"pointer":"default",
        boxShadow: hover&&hoverable
          ? `0 8px 32px rgba(0,0,0,0.18), 0 0 0 1px ${T.accentSolid}18`
          : "0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)",
        transform: hover&&hoverable ? "translateY(-2px)" : "translateY(0)",
        ...style,
      }}>
      {children}
    </div>
  );
}

export function Skeleton({T, width="72%", height=22, radius=6, style={}}) {
  return <div style={{width,height,borderRadius:radius,background:T?T.surface:"#1e1e2e",position:"relative",overflow:"hidden",...style}}><div style={{position:"absolute",inset:0,background:"linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.07) 50%,transparent 100%)",backgroundSize:"200% 100%",animation:"skeleton 1.4s ease infinite"}}/></div>;
}

export function KPI({T, label, value, sub, color, icon, accent, onClick, compact, loading}) {
  const c = color||T.accentSolid;
  return (
    <Card T={T} hoverable={!!onClick} onClick={onClick} padding={compact?"md":"lg"}
      style={{
        borderColor: accent ? c+"66" : T.border,
        boxShadow: accent ? `0 4px 24px ${c}20, 0 1px 3px rgba(0,0,0,0.07)` : "0 1px 3px rgba(0,0,0,0.07)",
      }}>
      <div style={{display:"flex",alignItems:"flex-start",gap:DS.sp.md}}>
        {icon&&<div style={{fontSize:compact?16:18,flexShrink:0,opacity:loading?0.3:0.9}}>{icon}</div>}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:DS.font.xs,textTransform:"uppercase",color:T.textSm,fontWeight:DS.w.semibold,letterSpacing:0.5,marginBottom:5}}>{label}</div>
          {loading
            ? <Skeleton T={T} height={compact?18:24} width="65%" style={{marginBottom:6}}/>
            : <div key={String(value)} className="gh-kpi-value" style={{fontSize:compact?DS.font["2xl"]:DS.font["3xl"],fontWeight:DS.w.black,color:c,letterSpacing:-0.6,lineHeight:1}}>{value}</div>
          }
          {loading
            ? <Skeleton T={T} height={11} width="45%" style={{marginTop:6}}/>
            : sub&&<div style={{fontSize:DS.font.xs,color:T.textSm,marginTop:4}}>{sub}</div>
          }
        </div>
      </div>
    </Card>
  );
}

// ─── Botones ───────────────────────────────────────────────────────────
// Sistema de botones unificado — visualmente idéntico a BtnPrimary/BtnSecondary/BtnDanger
export function Btn({T, variant="primary", size="md", icon, children, onClick, disabled, style={}, ...rest}) {
  const [hov, setHov] = React.useState(false);
  const variants = {
    primary:   {bg:"rgba(16,185,129,0.13)", color:T.accent, border:"rgba(16,185,129,0.55)", shadow:"0 0 0 1px #10b98115, 0 4px 20px #10b98120", shadowHov:"0 0 0 1px #10b98128, 0 6px 28px #10b98140"},
    solid:     {bg:T.accentSolid, color:"#fff", border:T.accentSolid, shadow:"0 4px 14px rgba(16,185,129,0.30)", shadowHov:"0 6px 22px rgba(16,185,129,0.42)"},
    secondary: {bg:"transparent", color:T.textMd, border:T.border, shadow:"none", shadowHov:`0 2px 12px rgba(0,0,0,0.12)`},
    ghost:     {bg:"transparent", color:T.textMd, border:"transparent", shadow:"none", shadowHov:"none"},
    danger:    {bg:T.redBg, color:T.red, border:T.red+"55", shadow:`0 0 0 1px ${T.red}15, 0 4px 16px ${T.red}22`, shadowHov:`0 0 0 1px ${T.red}28, 0 6px 24px ${T.red}40`},
    success:   {bg:"rgba(22,163,74,0.13)", color:T.green, border:"rgba(22,163,74,0.55)", shadow:"0 0 0 1px "+T.green+"15"+", 0 4px 20px "+T.green+"20", shadowHov:"0 0 0 1px "+T.green+"28"+", 0 6px 28px "+T.green+"40"},
  };
  const sizes = {
    sm: {padding:"5px 10px", fontSize:DS.font.sm, gap:5},
    md: {padding:"8px 14px", fontSize:DS.font.base, gap:6},
    lg: {padding:"10px 20px", fontSize:DS.font.lg, gap:8},
  };
  const v = variants[variant]||variants.primary;
  const s = sizes[size]||sizes.md;
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={()=>!disabled&&setHov(true)}
      onMouseLeave={()=>setHov(false)}
      {...rest}
      style={{
        background: disabled?T.surface:v.bg,
        color: disabled?T.textSm:v.color,
        border: `1px solid ${v.border==="transparent"?"transparent":v.border}`,
        borderRadius: DS.r.md,
        cursor: disabled?"not-allowed":"pointer",
        fontWeight: DS.w.semibold,
        fontFamily: F,
        letterSpacing:"0.01em",
        display:"inline-flex",alignItems:"center",justifyContent:"center",
        transition: `all 0.18s ${DS.ease}`,
        opacity: disabled?0.5:1,
        boxShadow: disabled?"none": hov?(v.shadowHov||v.shadow):v.shadow,
        ...s,
        ...style,
      }}>
      {icon&&<span style={{display:"inline-flex",alignItems:"center"}}>{icon}</span>}
      {children}
    </button>
  );
}

export function BtnPrimary(T) { return {border:"1.5px solid rgba(16,185,129,0.55)",borderRadius:8,padding:"9px 16px",fontSize:13,fontWeight:600,cursor:"pointer",fontFamily:F,transition:"all 0.18s cubic-bezier(0.4,0,0.2,1)",display:"inline-flex",alignItems:"center",gap:6,background:"rgba(16,185,129,0.13)",color:T.accent,letterSpacing:"0.01em",boxShadow:"0 0 0 1px #10b98115, 0 4px 20px #10b98120"}; }
// Variante sólida (CTA fuerte: landing, auth, onboarding)
export function BtnSolid(T) { return {border:"none",borderRadius:10,padding:"11px 18px",fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:F,transition:"all 0.18s cubic-bezier(0.4,0,0.2,1)",display:"inline-flex",alignItems:"center",justifyContent:"center",gap:8,background:`linear-gradient(135deg, ${T.accentSolid}, #059669)`,color:"#fff",letterSpacing:"0.01em",boxShadow:"0 4px 14px rgba(16,185,129,0.30)"}; }
export function BtnSecondary(T) { return {border:`1px solid ${T.border}`,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:F,transition:"all 0.18s cubic-bezier(0.4,0,0.2,1)",display:"inline-flex",alignItems:"center",gap:6,background:"transparent",color:T.textMd}; }
export function BtnDanger(T) { return {border:`1.5px solid ${T.red}55`,borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:500,cursor:"pointer",fontFamily:F,transition:"all 0.18s cubic-bezier(0.4,0,0.2,1)",display:"inline-flex",alignItems:"center",gap:6,background:T.redBg,color:T.red,boxShadow:`0 0 0 1px ${T.red}15, 0 4px 16px ${T.red}22`}; }
// Alias: en Recurrentes el "púrpura" de Growith es el verde de marca.
export const BtnPurple = BtnPrimary;

// ─── Estados vacíos / badges / toggles ────────────────────────────────
export function DSEmpty({T, icon="", title, subtitle, action}) {
  return (
    <Card T={T} padding="xl" className="gh-section" style={{textAlign:"center"}}>
      {icon?<div style={{fontSize:42,marginBottom:DS.sp.md,opacity:0.8}}>{icon}</div>:null}
      <div style={{fontSize:DS.font.lg,fontWeight:DS.w.bold,color:T.text,marginBottom:DS.sp.xs}}>{title}</div>
      {subtitle&&<div style={{fontSize:DS.font.md,color:T.textSm,marginBottom:action?DS.sp.lg:0,maxWidth:400,margin:"0 auto"}}>{subtitle}</div>}
      {action&&<div style={{marginTop:DS.sp.lg}}>{action}</div>}
    </Card>
  );
}

export function DSBadge({T, color, children, size="md"}) {
  const c = color||T.accent;
  return (
    <span style={{
      fontSize: size==="sm"?DS.font.xs:DS.font.sm,
      padding: size==="sm"?"2px 7px":"3px 9px",
      borderRadius: DS.r.sm,
      background: c+"20",
      color: c,
      fontWeight: DS.w.bold,
      border: `1px solid ${c}33`,
      display: "inline-flex", alignItems:"center", gap:4,
      lineHeight: 1.4,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

export function DSToggle({T, active, onToggle}) {
  return (
    <div onClick={onToggle} className="gh-toggle" style={{width:44,height:24,borderRadius:20,background:active?T.accentSolid:T.border,cursor:"pointer",position:"relative",transition:"background 0.2s",flexShrink:0}}>
      <div className="gh-toggle-thumb" style={{position:"absolute",top:3,left:active?22:3,width:18,height:18,borderRadius:"50%",background:"#fff",transition:"left 0.2s",boxShadow:"0 1px 4px rgba(0,0,0,0.3)"}}/>
    </div>
  );
}

export function Badge({T, colors, children, small}) {
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", gap:4,
      padding: small ? "2px 6px" : "2px 8px",
      borderRadius:5, fontSize:11, fontWeight:500,
      background:colors.bg, color:colors.text||colors.dot,
      border:`0.5px solid ${colors.dot}33`,
      whiteSpace:"nowrap", letterSpacing:"0.02em",
    }}>
      {children}
    </span>
  );
}

// ─── Toasts ────────────────────────────────────────────────────────────
let _toastSetters=[];
export function useToast(){
  const [toasts,setToasts]=React.useState([]);
  React.useEffect(()=>{_toastSetters.push(setToasts);return()=>{_toastSetters=_toastSetters.filter(s=>s!==setToasts);};},[]);
  return toasts;
}
export function toast(msg,type="success",duration=3000){
  const id=Date.now()+Math.random();
  _toastSetters.forEach(setter=>setter(prev=>[...prev,{id,msg:String(msg??""),type}]));
  setTimeout(()=>{_toastSetters.forEach(setter=>setter(prev=>prev.map(t=>t.id===id?{...t,closing:true}:t)));},Math.max(0,duration-200));
  setTimeout(()=>{_toastSetters.forEach(setter=>setter(prev=>prev.filter(t=>t.id!==id)));},duration);
}
export function ToastContainer({T}){
  const toasts=useToast();
  if(!toasts.length) return null;
  const cfgMap={
    success:{color:T.green, icon:<polyline points="20 6 9 17 4 12"/>},
    error:  {color:T.red,   icon:<><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>},
    warning:{color:T.yellow||T.orange, icon:<><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>},
    info:   {color:T.blue||T.accent, icon:<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>},
  };
  return(
    <div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",zIndex:9999,display:"flex",flexDirection:"column",gap:8,alignItems:"center",pointerEvents:"none",padding:"0 16px",width:"100%",maxWidth:560,boxSizing:"border-box"}}>
      {toasts.map(t=>{
        const cfg=cfgMap[t.type]||cfgMap.success;
        return(
          <div key={t.id} style={{
            background:T.card,
            border:`1px solid ${T.border}`,
            borderRadius:12,
            padding:"11px 16px 11px 13px",
            fontSize:13,fontWeight:500,color:T.text,
            fontFamily:F,
            letterSpacing:"-0.01em",lineHeight:1.45,
            boxShadow:"0 2px 6px rgba(0,0,0,0.12), 0 12px 40px rgba(0,0,0,0.24)",
            maxWidth:"100%",display:"flex",alignItems:"flex-start",gap:10,
            animation:t.closing?"rec-toast-out 0.2s ease both":"rec-toast-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
            backdropFilter:"blur(16px)",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,marginTop:2}}>{cfg.icon}</svg>
            <span style={{minWidth:0}}>{t.msg.replace(/\s*[✓✔]\s*$/, '')}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Spinner / wrappers animados ───────────────────────────────────────
export function Spinner({size=14,color="#fff",style={}}) {
  return (
    <span style={{display:"inline-block",width:size,height:size,border:`2px solid ${color}44`,borderTop:`2px solid ${color}`,borderRadius:"50%",animation:"rec-spin 0.7s linear infinite",flexShrink:0,...style}}/>
  );
}

// Animated page wrapper - triggers re-animation on key change
export function PageView({children, pageKey, T}) {
  return (
    <div key={pageKey} className="gh-page" style={{flex:1,position:"relative"}}>
      {/* Aurora clipeada en su propio contenedor para no romper position:sticky de los hijos */}
      <div aria-hidden style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",zIndex:0}}>
        <div style={{position:"absolute",top:-180,left:"50%",transform:"translateX(-50%)",width:1000,height:480,background:"radial-gradient(ellipse at center, rgba(16,185,129,0.10) 0%, transparent 65%)",filter:"blur(40px)"}}/>
        <div style={{position:"absolute",top:80,right:-120,width:420,height:420,background:"radial-gradient(circle, rgba(52,211,153,0.07) 0%, transparent 70%)",filter:"blur(60px)"}}/>
      </div>
      <div style={{position:"relative",zIndex:1,display:"flex",flexDirection:"column",minHeight:"100%"}}>
        {children}
      </div>
      {T && <AppPromptHost T={T}/>}
    </div>
  );
}

// Animated tab content wrapper
export function TabView({children, tabKey}) {
  return (
    <div key={tabKey} className="gh-tab-content">
      {children}
    </div>
  );
}

// ─── Íconos de sección (paths stroke 24x24) — ids de Recurrentes ───────
export const SECTION_ICONS = {
  inicio:        "M3 12l9-9 9 9M5 10v10a2 2 0 002 2h3M19 10v10a2 2 0 01-2 2h-3M9 22V12h6v10",
  integraciones: "M9 2v5M15 2v5M6 7h12v3a6 6 0 01-12 0zM12 16v6",
  planes:        "M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  suscriptores:  "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
  carritos:      "M9 22a1 1 0 100-2 1 1 0 000 2zM20 22a1 1 0 100-2 1 1 0 000 2zM1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6",
  abandonados:   "M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z",
  actividad:     "M22 12h-4l-3 9L9 3l-3 9H2",
  cobros:        "M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  configuracion: "M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1zM15 12a3 3 0 11-6 0 3 3 0 016 0z",
  cuenta:        "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z",
  tiendas:       "M3 21h18M5 21V7l8-4v18M19 21V11l-6-4",
  equipo:        "M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M12.5 7a4 4 0 11-8 0 4 4 0 018 0z",
};

// Cuadradito de ícono de sección (se reusa en topbars/cabeceras)
export function SectionIcon({T, id, path, size=32}) {
  const p = path || SECTION_ICONS[id];
  if(!p) return null;
  return (
    <div style={{width:size,height:size,borderRadius:DS.r.md,background:T.accentSolid+"18",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
      <svg width={Math.round(size*0.53)} height={Math.round(size*0.53)} viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={p}/></svg>
    </div>
  );
}

// Menú "⋯" del topbar para acciones terciarias
export function TopbarMoreMenu({T, items}) {
  const [open,setOpen]=React.useState(false);
  const [pos,setPos]=React.useState({top:0,right:0});
  const list=(items||[]).filter(Boolean);
  if(!list.length) return null;
  return (<>
    <div className="mobile-only" style={{display:"none",alignItems:"center",gap:6,flexShrink:0}}>
      {list.map((it,i)=>(
        <button key={i} disabled={it.disabled} onClick={it.disabled?undefined:()=>{it.onClick&&it.onClick();}}
          style={{...BtnSecondary(T),fontSize:12,padding:"7px 10px",opacity:it.disabled?0.5:1,whiteSpace:"nowrap"}}>
          {it.icon||null}{it.label}
        </button>
      ))}
    </div>
    <div className="hide-mobile" style={{position:"relative",flexShrink:0}}>
      <button title="Más acciones"
        onClick={e=>{const r=e.currentTarget.getBoundingClientRect();setPos({top:r.bottom+6,right:Math.max(10,window.innerWidth-r.right)});setOpen(o=>!o);}}
        style={{...BtnSecondary(T),fontSize:14,padding:"7px 10px",lineHeight:1,fontWeight:DS.w.bold,color:T.textMd}}>⋯</button>
      {open&&(<>
        <div onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:60}}/>
        <div className="gh-dropdown" style={{position:"fixed",top:pos.top,right:pos.right,zIndex:61,background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.lg,padding:6,minWidth:200,boxShadow:"0 12px 32px rgba(0,0,0,0.3)"}}>
          {list.map((it,i)=>(
            <button key={i} disabled={it.disabled} onClick={it.disabled?undefined:()=>{setOpen(false);it.onClick&&it.onClick();}}
              style={{display:"flex",alignItems:"center",gap:8,width:"100%",padding:"8px 10px",background:"transparent",border:"none",borderRadius:DS.r.md,cursor:it.disabled?"default":"pointer",opacity:it.disabled?0.5:1,textAlign:"left",fontFamily:F,fontSize:12,fontWeight:DS.w.semibold,color:T.text,whiteSpace:"nowrap"}}
              onMouseEnter={e=>{if(!it.disabled)e.currentTarget.style.background=T.surface;}}
              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
              {it.icon||null}{it.label}
            </button>
          ))}
        </div>
      </>)}
    </div>
  </>);
}

// Shared AppTabs - pill style
export function AppTabs({T, tabs, active, onChange, size="normal"}) {
  const isLarge = size==="large";
  return (
    <div className="no-scrollbar gh-apptabs" style={{background:T.surface,borderBottom:"1px solid "+T.border,padding:isLarge?"12px 24px":"10px 24px",position:"sticky",top:65,zIndex:20}}>
      <div style={{display:"inline-flex",background:T.bg,borderRadius:isLarge?12:10,padding:3,border:"1px solid "+T.border,gap:isLarge?3:2}}>
        {tabs.map(t=>{
          const isActive=active===t.id;
          return (
            <button key={t.id} onClick={()=>onChange(t.id)} className="gh-tab"
              onMouseEnter={e=>{if(!isActive)e.currentTarget.style.color=T.text;}}
              onMouseLeave={e=>{if(!isActive)e.currentTarget.style.color=T.textMd;}}
              style={{padding:isLarge?"10px 24px":"8px 18px",fontSize:isLarge?14:13,fontWeight:isActive?700:500,borderRadius:isLarge?10:8,border:"none",background:isActive?T.accent+"16":"transparent",color:isActive?T.accent:T.textMd,cursor:"pointer",fontFamily:F,display:"flex",alignItems:"center",gap:7,transition:"all 0.15s ease",boxShadow:isActive?`inset 0 0 0 1px ${T.accent}3a`:"none",whiteSpace:"nowrap"}}>
              {t.icon&&<svg width={isLarge?15:13} height={isLarge?15:13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:isActive?1:0.75}}><path d={t.icon}/></svg>}
              {t.label}
              {t.badge!=null&&t.badge>0&&<span style={{fontSize:10,fontWeight:700,background:t.badgeColor||T.red,color:"#fff",borderRadius:10,padding:"1px 7px"}}>{t.badge}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ─── Avatar / EmptyState / AsyncButton ─────────────────────────────────
export function Avatar({src, name, size=36, radius=10, T}) {
  const [err, setErr] = React.useState(false);
  const initials = (name||"?").split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase();
  const colors = ["#10b981",T.blue,"#059669",T.yellow,T.red,"#0d9488","#0891b2"];
  const color = colors[(name||"").charCodeAt(0)%colors.length] || colors[0];
  if(src&&!err) return (
    <img src={src} alt={name||""} onError={()=>setErr(true)}
      style={{width:size,height:size,borderRadius:radius,objectFit:"cover",border:`1.5px solid rgba(255,255,255,0.08)`,flexShrink:0,display:"block"}}/>
  );
  return (
    <div style={{width:size,height:size,borderRadius:radius,background:color+"22",border:`1.5px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontSize:size*0.35,fontWeight:700,color,letterSpacing:-0.5,fontFamily:F}}>
      {initials}
    </div>
  );
}

export function EmptyState({T, icon, title, description, action}) {
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 24px",textAlign:"center"}}>
      <div style={{width:64,height:64,borderRadius:16,background:T.surface,border:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:28,marginBottom:20}}>{icon}</div>
      <div style={{fontSize:17,fontWeight:700,color:T.text,marginBottom:8}}>{title}</div>
      {description&&<div style={{fontSize:14,color:T.textSm,maxWidth:320,lineHeight:1.6,marginBottom:action?20:0}}>{description}</div>}
      {action}
    </div>
  );
}

// AsyncButton - muestra spinner automáticamente mientras el onClick async procesa
export function AsyncButton({onClick, children, style, disabled, ...props}) {
  const [loading, setLoading] = React.useState(false);
  const handleClick = async (e) => {
    if(loading || disabled) return;
    setLoading(true);
    try { await onClick(e); }
    catch(err) {
      console.error(err);
      try { toast(String(err?.message||"Algo falló — probá de nuevo"),"error",6000); } catch(_) {}
    }
    finally { setLoading(false); }
  };
  const spinnerColor = style?.color || "#fff";
  return (
    <button {...props} onClick={handleClick} disabled={loading || disabled}
      style={{...style, opacity: loading ? 0.75 : (disabled ? 0.4 : 1), cursor: loading ? "wait" : (disabled ? "not-allowed" : "pointer")}}>
      {loading
        ? <><Spinner size={13} color={spinnerColor}/>{typeof children === "string" ? " " + children : children}</>
        : children}
    </button>
  );
}

// ─── Modal + piezas de formulario ──────────────────────────────────────
export function Modal({T, open, onClose, title, width, children, zIndex=1000}) {
  const [visible, setVisible] = React.useState(false);
  const [mounted, setMounted] = React.useState(open);
  const lastChildren = React.useRef(children);
  if(open) lastChildren.current = children;
  React.useEffect(()=>{
    let t;
    if(open) { setMounted(true); document.body.style.overflow='hidden'; requestAnimationFrame(()=>setVisible(true)); }
    else { document.body.style.overflow=''; setVisible(false); t=setTimeout(()=>setMounted(false),200); }
    return()=>{ if(t)clearTimeout(t); document.body.style.overflow=''; };
  },[open]);
  if(!mounted) return null;
  return ReactDOM.createPortal(
    <div onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,background:`rgba(0,0,0,${visible?0.65:0})`,backdropFilter:"blur(4px)",display:"flex",alignItems:"flex-start",justifyContent:"center",overflowY:"auto",zIndex:zIndex,padding:"24px 16px",transition:"background 0.2s ease",fontFamily:F}}>
      <div onMouseDown={e=>e.stopPropagation()} style={{background:T.card,borderRadius:16,width:"100%",maxWidth:width||560,maxHeight:"90vh",overflow:"hidden",boxShadow:"0 32px 80px rgba(0,0,0,0.45)",border:`1px solid ${T.border}`,display:"flex",flexDirection:"column",transform:visible?"translateY(0) scale(1)":"translateY(16px) scale(0.97)",opacity:visible?1:0,transition:"transform 0.22s cubic-bezier(0.34,1.26,0.64,1), opacity 0.18s ease"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"20px 24px 16px",borderBottom:`1px solid ${T.borderL}`,flexShrink:0}}>
          <div style={{margin:0,fontSize:17,fontWeight:700,color:T.text,fontFamily:F}}>{title}</div>
          <button onClick={onClose} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,width:32,height:32,fontSize:16,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",color:T.textMd}}>✕</button>
        </div>
        <div style={{padding:"18px 24px 24px",overflowY:"auto",flex:1}}>{open?children:lastChildren.current}</div>
      </div>
    </div>,
    document.body
  );
}

// Botón ✕ estándar para cerrar modales y drawers
export function ModalCloseBtn({T, onClick, disabled}) {
  return (
    <button onClick={onClick} disabled={disabled} aria-label="Cerrar" title="Cerrar" style={{background:"transparent",border:"none",color:T.textMd,cursor:disabled?"not-allowed":"pointer",fontSize:18,padding:"4px 6px",lineHeight:1,borderRadius:6,flexShrink:0,fontFamily:"inherit",display:"flex",alignItems:"center",justifyContent:"center",transition:"color 0.15s"}}
      onMouseEnter={e=>e.currentTarget.style.color=T.text}
      onMouseLeave={e=>e.currentTarget.style.color=T.textMd}>✕</button>
  );
}

export function Field({T, label, children, required}) {
  return (
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:6,letterSpacing:0.5,textTransform:"uppercase"}}>
        {label}{required&&<span style={{color:T.red,marginLeft:3}}>*</span>}
      </label>
      {children}
    </div>
  );
}

export function Divider({T}) { return <div style={{height:1,background:T.borderL,margin:"14px 0"}}/>; }

export function StatCard({T, label, value, color, sub}) {
  return (
    <div style={{background:T.card,border:`1px solid ${color&&color!==T.textMd?color+"33":T.border}`,borderRadius:12,padding:"14px 18px",flex:"1 1 110px",minWidth:110,position:"relative",overflow:"hidden",transition:"border-color 0.2s"}}>
      {color&&color!==T.textMd&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:color,borderRadius:"3px 0 0 3px"}}/>}
      <div style={{fontSize:26,fontWeight:800,color:color||T.text,letterSpacing:-0.5,lineHeight:1}}>{value??<Spinner size={14} color={color||T.accent}/>}</div>
      <div style={{fontSize:11,color:T.textSm,marginTop:6,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.05em"}}>{label}</div>
      {sub&&<div style={{fontSize:11,color:T.textSm,marginTop:3}}>{sub}</div>}
    </div>
  );
}

export function InputStyle(T) {
  return {
    width:"100%", padding:"10px 14px", borderRadius:8,
    border:`1px solid ${T.inputBorder}`, fontSize:13,
    fontFamily:F,
    outline:"none", boxSizing:"border-box",
    background:T.input, color:T.text,
    transition:"border-color 0.12s",
  };
}

// Ícono de estado para modales de resultado. NO recibe T (colores fijos).
export function StatusIcon({type="success", size=64}) {
  const cfg = {
    success: { bg:"linear-gradient(135deg,#22c55e,#16a34a)", glow:"#22c55e", ring:"#22c55e28", path:<polyline points="20 6 9 17 4 12" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/> },
    error:   { bg:"linear-gradient(135deg,#ef4444,#dc2626)", glow:"#ef4444", ring:"#ef444428", path:<><line x1="18" y1="6" x2="6" y2="18" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/><line x1="6" y1="6" x2="18" y2="18" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></> },
    warning: { bg:"linear-gradient(135deg,#f59e0b,#d97706)", glow:"#f59e0b", ring:"#f59e0b28", path:<><path d="M12 9v4M12 17h.01" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="#fff" strokeWidth="2" fill="none"/></> },
  };
  const c = cfg[type]||cfg.success;
  const r = Math.round(size*0.27);
  return (
    <div style={{display:"inline-flex",alignItems:"center",justifyContent:"center",width:size,height:size,borderRadius:r,background:c.bg,boxShadow:`0 0 0 ${Math.round(size*0.1)}px ${c.ring}, 0 12px 32px ${c.glow}55`,flexShrink:0,animation:"rec-bounceIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both"}}>
      <svg width={size*0.5} height={size*0.5} viewBox="0 0 24 24" fill="none">{c.path}</svg>
    </div>
  );
}

// ─── In-app confirm/alert/prompt (reemplaza window.confirm/alert/prompt) ─
let _appPromptState = null;
let _appPromptResolver = null;
const _appPromptListeners = new Set();
function _appPromptNotify() { _appPromptListeners.forEach(fn => fn()); }

export function appConfirm(message, opts = {}) {
  return new Promise(res => {
    _appPromptState = { kind:"confirm", message, title: opts.title || "Confirmar", danger: !!opts.danger, okLabel: opts.okLabel || "Confirmar", cancelLabel: opts.cancelLabel || "Cancelar" };
    _appPromptResolver = res;
    _appPromptNotify();
  });
}
export function appAlert(message, opts = {}) {
  return new Promise(res => {
    _appPromptState = { kind:"alert", message, title: opts.title || "Aviso", okLabel: opts.okLabel || "Entendido" };
    _appPromptResolver = res;
    _appPromptNotify();
  });
}
export function appPrompt(message, defaultValue = "", opts = {}) {
  return new Promise(res => {
    _appPromptState = {
      kind:"prompt", message, title: opts.title || "Ingresá un valor",
      okLabel: opts.okLabel || "Aceptar", cancelLabel: opts.cancelLabel || "Cancelar",
      defaultValue, placeholder: opts.placeholder || "",
    };
    _appPromptResolver = res;
    _appPromptNotify();
  });
}
function _appPromptClose(val) {
  const r = _appPromptResolver;
  _appPromptState = null;
  _appPromptResolver = null;
  _appPromptNotify();
  if (r) r(val);
}

export function AppPromptHost({ T }) {
  const [, force] = React.useState(0);
  React.useEffect(() => {
    const fn = () => force(n => n + 1);
    _appPromptListeners.add(fn);
    return () => _appPromptListeners.delete(fn);
  }, []);
  const s = _appPromptState;
  const [inputVal, setInputVal] = React.useState("");
  React.useEffect(() => { if (s?.kind === "prompt") setInputVal(s.defaultValue || ""); }, [s?.kind, s?.defaultValue]);
  const [closingState, setClosingState] = React.useState(null);
  const prevS = React.useRef(s);
  React.useEffect(() => {
    let t;
    if (!s && prevS.current) { setClosingState(prevS.current); t = setTimeout(() => setClosingState(null), 160); }
    prevS.current = s;
    return () => { if (t) clearTimeout(t); };
  });
  const shown = s || closingState;
  const closing = !s && !!closingState;
  if (!shown) return null;
  const isConfirm = shown.kind === "confirm";
  const isPromptInput = shown.kind === "prompt";
  const danger = shown.danger;
  const closeWith = (val) => { if (!closing) _appPromptClose(val); };
  return ReactDOM.createPortal(
    <div className={closing?"gh-overlay-closing":"gh-overlay"} style={{position:"fixed",inset:0,zIndex:99999,background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",display:"flex",alignItems:"center",justifyContent:"center",padding:20,fontFamily:F,pointerEvents:closing?"none":"auto"}}
      onClick={() => isConfirm ? closeWith(false) : (isPromptInput ? closeWith(null) : closeWith(true))}>
      <div onClick={e => e.stopPropagation()}
        style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,width:"100%",maxWidth:400,boxShadow:"0 24px 64px rgba(0,0,0,0.45)",animation:closing?"rec-scaleOut 0.16s ease both":"rec-modalIn 0.2s cubic-bezier(0.4,0,0.2,1) both",overflow:"hidden"}}>
        <div style={{padding:"20px 22px 18px"}}>
          <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:7,letterSpacing:"-0.01em"}}>{shown.title}</div>
          <div style={{fontSize:13,color:T.textMd,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{shown.message}</div>
          {isPromptInput && (
            <input autoFocus type="text" value={inputVal} onChange={e=>setInputVal(e.target.value)}
              placeholder={shown.placeholder||""}
              onKeyDown={e=>{ if(e.key==="Enter") closeWith(inputVal); if(e.key==="Escape") closeWith(null); }}
              style={{width:"100%",padding:"9px 12px",fontSize:13,borderRadius:8,border:`1px solid ${T.border}`,background:T.surface,color:T.text,fontFamily:F,marginTop:14,outline:"none",boxSizing:"border-box"}} />
          )}
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",padding:"12px 22px 16px",borderTop:`1px solid ${T.borderL||T.border}`}}>
          {(isConfirm || isPromptInput) && (
            <button onClick={() => closeWith(isPromptInput ? null : false)}
              style={{...BtnSecondary(T),fontSize:13,padding:"8px 16px"}}>{shown.cancelLabel}</button>
          )}
          <button autoFocus={!isPromptInput} onClick={() => closeWith(isPromptInput ? inputVal : true)}
            style={danger ? {...BtnDanger(T),fontSize:13,padding:"8px 18px",fontWeight:600} : {...BtnPrimary(T),fontSize:13,padding:"8px 18px"}}>{shown.okLabel}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Error Boundary: un crash de render en una sección muestra el error y un
// botón de recarga en vez de dejar la pantalla en blanco.
export class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state={err:null}; }
  static getDerivedStateFromError(err){ return {err}; }
  componentDidCatch(err, info){ try{ console.error("[recurrentes crash]", err, info?.componentStack); }catch(_){} }
  render(){
    if(!this.state.err) return this.props.children;
    const T=this.props.T||{};
    return (
      <div style={{minHeight:"60vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:14,padding:24,fontFamily:F,background:T.bg||"#0a0f0d",color:T.text||"#fff"}}>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div style={{fontSize:18,fontWeight:800}}>Algo se rompió en esta sección</div>
        <div style={{fontSize:12,color:T.textSm||"#9ca3af",maxWidth:560,textAlign:"center",wordBreak:"break-word",background:T.card||"#161e22",border:`1px solid ${T.border||"#1f2a30"}`,borderRadius:10,padding:"10px 14px",fontFamily:"monospace"}}>
          {String(this.state.err?.message||this.state.err).slice(0,300)}
        </div>
        <button onClick={()=>{ this.setState({err:null}); window.location.reload(); }}
          style={{padding:"10px 24px",fontSize:14,fontWeight:700,border:"none",borderRadius:10,background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:F}}>
          Recargar la app
        </button>
      </div>
    );
  }
}
