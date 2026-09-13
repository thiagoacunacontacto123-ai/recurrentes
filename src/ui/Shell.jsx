// Shell de Recurrentes — Sidebar + StoreSwitcher + modales de tienda +
// AppTopbar + nav inferior mobile. Adaptado del shell de Growith (podado a
// las secciones de Recurrentes) con branding verde.
import React from "react";
import ReactDOM from "react-dom";
import { DS } from "./theme.js";
import { BtnPrimary, BtnSecondary, BtnDanger, ModalCloseBtn, SECTION_ICONS, toast } from "./components.jsx";

const F = "'Inter',system-ui,sans-serif";

// ─── NAV: los 8 tabs del dashboard + Configuración ─────────────────────
export const NAV = [
  { id:"inicio",        label:"Inicio",                  short:"Inicio",   icon:SECTION_ICONS.inicio },
  { id:"integraciones", label:"Integraciones",           short:"Integrar", icon:SECTION_ICONS.integraciones },
  { id:"planes",        label:"Planes",                  short:"Planes",   icon:SECTION_ICONS.planes },
  { id:"suscriptores",  label:"Suscriptores activos",    short:"Suscript.",icon:SECTION_ICONS.suscriptores, alertKey:"suscriptores" },
  { id:"carritos",      label:"Carritos de suscripción", short:"Carritos", icon:SECTION_ICONS.carritos },
  { id:"abandonados",   label:"Abandonados",             short:"Abandon.", icon:SECTION_ICONS.abandonados, alertKey:"abandonados", badge:"orange" },
  { id:"actividad",     label:"Actividad",               short:"Actividad",icon:SECTION_ICONS.actividad },
  { id:"cobros",        label:"Cobros",                  short:"Cobros",   icon:SECTION_ICONS.cobros, alertKey:"cobros", badge:"red" },
  { id:"plan",          label:"Plan",                    short:"Plan",     icon:"M1 6a2 2 0 012-2h18a2 2 0 012 2v12a2 2 0 01-2 2H3a2 2 0 01-2-2zM1 10h22M5 15h4" },
  { id:"configuracion", label:"Configuración",           short:"Config",   icon:SECTION_ICONS.configuracion },
];

// ─── Logo: círculo verde con flecha circular ↻ + wordmark ──────────────
export function RecLogo({size=28, withText=false, color="#10b981", textColor, style={}}) {
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:Math.round(size*0.36),flexShrink:0,...style}}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-label="Recurrentes" style={{display:"block",flexShrink:0}}>
        <defs>
          <linearGradient id="recLogoGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399"/>
            <stop offset="100%" stopColor="#059669"/>
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="16" fill={color==="#10b981"?"url(#recLogoGrad)":color}/>
        <path d="M22.5 13.2A7.2 7.2 0 1 0 23.2 18" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/>
        <path d="M22.9 8.6v5.1h-5.1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      {withText && <span style={{fontWeight:800,fontSize:Math.round(size*0.62),letterSpacing:-0.4,color:textColor||"inherit",fontFamily:F,lineHeight:1}}>Recurrentes</span>}
    </span>
  );
}

// Redimensiona una imagen a un cuadrado (data URL) para la foto de la tienda.
export function resizeImage(file, size = 160) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) return reject(new Error("Elegí una imagen (JPG, PNG o WebP)."));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        const c = document.createElement("canvas"); c.width = size; c.height = size;
        c.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, size, size);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", 0.85));
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No pude leer la imagen.")); };
    img.src = url;
  });
}

const STORE_COLORS = (T) => ["#10b981","#0ea5e9","#8b5cf6","#ec4899",T.orange,T.yellow,T.blue,T.red];

// Avatar de tienda: foto o cuadrado redondeado con la inicial sobre el color
export function StoreAvatar({T, store, size=22}) {
  const initialOf = (name) => (name||"?").trim().charAt(0).toUpperCase() || "?";
  return store?.photo ? (
    <img src={store.photo} alt="" style={{width:size,height:size,borderRadius:Math.max(4, size/4.5),objectFit:"cover",flexShrink:0,display:"block"}}/>
  ) : (
    <span style={{width:size,height:size,borderRadius:Math.max(4, size/4.5),background:store?.color||T.accentSolid,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:DS.w.bold,fontSize:Math.round(size*0.5),flexShrink:0,letterSpacing:0.3,boxShadow:"inset 0 -1px 0 rgba(0,0,0,0.15)"}}>
      {initialOf(store?.name)}
    </span>
  );
}

// ─── Store Switcher ────────────────────────────────────────────────────
// Pill abajo del sidebar con la tienda activa + ▾. Popover hacia arriba:
// card de la tienda activa (Gestionar), otras tiendas, "+ Nueva tienda".
export function StoreSwitcher({T, stores, activeStoreId, onSwitchStore, onCreateStore, onManageStore, collapsed}) {
  const [open, setOpen] = React.useState(false);
  const [dropPos, setDropPos] = React.useState({top:0,left:0,width:260});
  const btnRef = React.useRef(null);
  const dropRef = React.useRef(null);

  React.useEffect(()=>{
    if (!open) return;
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDropPos({top: r.top - 6, left: r.left, width: Math.max(260, r.width)});
    }
    const onClick = (e) => {
      if (btnRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onEsc);
    };
  },[open]);

  if (!Array.isArray(stores) || stores.length === 0) return null;
  const active = stores.find(o => o.id === activeStoreId) || stores[0];
  const others = stores.filter(o => o.id !== active.id);

  return (
    <div style={{padding:`${DS.sp.sm}px ${DS.sp.sm}px 0`,borderTop:`1px solid ${T.border}`,marginTop:DS.sp.sm}}>
      <button
        ref={btnRef}
        onClick={()=>setOpen(o=>!o)}
        title={collapsed?`Tienda: ${active.name}`:undefined}
        style={{
          width:"100%",display:"flex",alignItems:"center",gap:DS.sp.sm,
          padding:collapsed?"6px":"7px 10px",
          background:T.bg,border:`1px solid ${T.border}`,borderRadius:DS.r.md,
          color:T.text,cursor:"pointer",fontFamily:F,
        }}>
        <StoreAvatar T={T} store={active} size={20}/>
        {!collapsed && (
          <>
            <span style={{flex:1,minWidth:0,fontSize:DS.font.md,fontWeight:DS.w.semibold,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"left"}}>{active.name}</span>
            <span style={{fontSize:DS.font.sm,color:T.textSm,flexShrink:0,marginLeft:2}}>▾</span>
          </>
        )}
      </button>
      {open && ReactDOM.createPortal(
        <div ref={dropRef} className="gh-dropdown-up" style={{position:"fixed",bottom:`calc(100vh - ${dropPos.top}px)`,left:dropPos.left,width:dropPos.width,maxHeight:"calc(100vh - 80px)",overflowY:"auto",background:T.card,border:`1px solid ${T.border}`,borderRadius:DS.r.lg,padding:DS.sp.xs,zIndex:9998,boxShadow:"0 10px 40px rgba(0,0,0,0.55)",fontFamily:F}}>
          <div style={{display:"flex",alignItems:"center",gap:DS.sp.sm,padding:`${DS.sp.sm}px ${DS.sp.sm}px`,background:T.bg,borderRadius:DS.r.md,marginBottom:DS.sp.xs}}>
            <StoreAvatar T={T} store={active} size={34}/>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:DS.font.lg,fontWeight:DS.w.bold,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{active.name}</div>
              <div style={{fontSize:DS.font.xs,color:T.textSm,marginTop:1}}>{active.role==="member"?"Miembro del equipo":active.shopify_shop||"Tienda propia"}</div>
            </div>
            {active.role!=="member" && onManageStore && (
              <button onClick={()=>{ setOpen(false); onManageStore(active.id); }} title="Gestionar tienda" style={{display:"flex",alignItems:"center",gap:5,background:"transparent",border:`1px solid ${T.border}`,borderRadius:DS.r.md,color:T.textMd,padding:"6px 10px",fontSize:DS.font.sm,cursor:"pointer",fontFamily:F}}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d={SECTION_ICONS.configuracion}/></svg>
                Gestionar
              </button>
            )}
          </div>

          {others.length === 0 ? (
            <div style={{padding:"22px 14px",textAlign:"center",background:T.bg,borderRadius:DS.r.md,marginBottom:DS.sp.xs}}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{color:T.textSm,marginBottom:6,opacity:0.7}}>
                <path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/>
              </svg>
              <div style={{fontSize:DS.font.sm,color:T.textSm}}>No tenés otras tiendas todavía</div>
            </div>
          ) : (
            <div style={{marginBottom:DS.sp.xs}}>
              {others.map(store => (
                <button key={store.id}
                  onClick={()=>{ onSwitchStore(store.id); setOpen(false); }}
                  style={{display:"flex",alignItems:"center",gap:DS.sp.sm,width:"100%",padding:"8px 10px",border:"none",background:"transparent",borderRadius:DS.r.md,cursor:"pointer",color:T.text,fontFamily:F}}
                  onMouseEnter={e=>{e.currentTarget.style.background=T.bg;}}
                  onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
                  <StoreAvatar T={T} store={store} size={26}/>
                  <span style={{flex:1,minWidth:0,fontSize:DS.font.md,fontWeight:DS.w.medium,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",textAlign:"left"}}>{store.name}</span>
                  {store.role==="member"&&<span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:T.textSm+"22",color:T.textSm,fontWeight:DS.w.bold,letterSpacing:0.3,textTransform:"uppercase"}}>Equipo</span>}
                </button>
              ))}
            </div>
          )}

          {onCreateStore && (
            <button
              onClick={()=>{ setOpen(false); onCreateStore(); }}
              title="Crear otra tienda"
              style={{display:"flex",alignItems:"center",gap:DS.sp.sm,width:"100%",padding:"10px 12px",border:`1px solid ${T.border}`,background:T.bg,borderRadius:DS.r.md,cursor:"pointer",color:T.text,fontFamily:F}}>
              <span style={{width:26,height:26,borderRadius:DS.r.md,background:T.accentSolid+"22",color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:DS.w.bold,flexShrink:0,lineHeight:1}}>+</span>
              <span style={{flex:1,fontSize:DS.font.md,fontWeight:DS.w.semibold,textAlign:"left"}}>Nueva tienda</span>
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Modal "Nueva tienda" ──────────────────────────────────────────────
export function NewStoreModal({T, onClose, onCreate}) {
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState("#10b981");
  const [saving, setSaving] = React.useState(false);
  const COLORS = STORE_COLORS(T);

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const ok = await onCreate({ name: name.trim(), color });
    setSaving(false);
    if (ok) onClose();
  }

  return ReactDOM.createPortal(
    <div className="gh-overlay" style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",padding:16,fontFamily:F}} onClick={()=>!saving&&onClose()}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,width:"100%",maxWidth:440,padding:"24px 26px",boxShadow:DS.shadow.xl,animation:"rec-modalIn 0.22s cubic-bezier(0.22,1,0.36,1) both"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div>
            <div style={{fontSize:17,fontWeight:700,color:T.text}}>Nueva tienda</div>
            <div style={{fontSize:11,color:T.textSm,marginTop:2}}>Arranca vacía: conectás su Shopify y Mercado Pago desde Integraciones. Mismo login.</div>
          </div>
          <ModalCloseBtn T={T} onClick={onClose} disabled={saving} /></div>

        <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:5}}>Nombre</label>
        <input autoFocus value={name} onChange={e=>setName(e.target.value)} placeholder='Ej. "Mi Tienda" o "Mi Marca"'
          maxLength={40} onKeyDown={e=>e.key==="Enter"&&handleSave()}
          style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:10,padding:"10px 13px",fontSize:13,color:T.text,fontFamily:F,boxSizing:"border-box",marginBottom:16}}/>

        <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:8}}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:8}}>
          {COLORS.map(c => (
            <button key={c} onClick={()=>setColor(c)} title={c}
              style={{width:32,height:32,borderRadius:8,background:c,border:color===c?`2px solid ${T.text}`:`2px solid transparent`,cursor:"pointer",padding:0,outline:"none"}}/>
          ))}
        </div>

        <div style={{display:"flex",gap:8,marginTop:18}}>
          <button onClick={onClose} disabled={saving} style={{...BtnSecondary(T),flex:1,padding:"10px 14px",fontSize:13,borderRadius:10,justifyContent:"center"}}>Cancelar</button>
          <button onClick={handleSave} disabled={saving||!name.trim()} style={{...BtnPrimary(T),flex:1,padding:"10px 14px",fontSize:13,borderRadius:10,justifyContent:"center",opacity:saving||!name.trim()?0.6:1}}>{saving?"Creando...":"Crear y entrar"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Modal "Gestionar tienda" ──────────────────────────────────────────
export function ManageStoreModal({T, store, totalStores, onClose, onSave, onDelete}) {
  const [name, setName] = React.useState(store.name||"");
  const [color, setColor] = React.useState(store.color||"#10b981");
  const [photo, setPhoto] = React.useState(store.photo||null);
  const [photoDirty, setPhotoDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [confirmDel, setConfirmDel] = React.useState(false);
  async function elegirFoto(e){
    const f=e.target.files?.[0]; e.target.value="";
    if(!f) return;
    try{ setPhoto(await resizeImage(f,160)); setPhotoDirty(true); }catch(err){ toast(err.message||"No pude procesar la imagen","error"); }
  }
  const COLORS = STORE_COLORS(T);
  const canDelete = store.role !== "member" && !!onDelete;

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    const ok = await onSave({ ...store, name: name.trim(), color, ...(photoDirty ? { photo: photo || "" } : {}) });
    setSaving(false);
    if (ok) onClose();
  }
  async function handleDelete() {
    setSaving(true);
    const ok = await onDelete(store.id);
    setSaving(false);
    if (ok) onClose();
  }

  return ReactDOM.createPortal(
    <div className="gh-overlay" style={{position:"fixed",inset:0,zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,0.6)",backdropFilter:"blur(4px)",padding:16,fontFamily:F}} onClick={()=>!saving&&onClose()}>
      <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,width:"100%",maxWidth:440,padding:"24px 26px",boxShadow:DS.shadow.xl,animation:"rec-modalIn 0.22s cubic-bezier(0.22,1,0.36,1) both"}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontSize:17,fontWeight:700,color:T.text}}>Gestionar tienda</div>
          <ModalCloseBtn T={T} onClick={onClose} disabled={saving} /></div>

        <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:5}}>Nombre</label>
        <input value={name} onChange={e=>setName(e.target.value)} maxLength={40}
          style={{width:"100%",background:T.input,border:`1px solid ${T.inputBorder}`,borderRadius:10,padding:"10px 13px",fontSize:13,color:T.text,fontFamily:F,boxSizing:"border-box",marginBottom:16}}/>

        <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:8}}>Foto</label>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16}}>
          {photo
            ? <img src={photo} alt="" style={{width:48,height:48,borderRadius:12,objectFit:"cover",border:`1px solid ${T.border}`}}/>
            : <span style={{width:48,height:48,borderRadius:12,background:color,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:800,fontSize:20}}>{(name||"?").trim().charAt(0).toUpperCase()||"?"}</span>}
          <label style={{...BtnSecondary(T),fontSize:12,padding:"7px 12px",cursor:"pointer"}}>
            {photo?"Cambiar foto":"Subir foto"}
            <input type="file" accept="image/*" style={{display:"none"}} onChange={elegirFoto}/>
          </label>
          {photo && <button onClick={()=>{ setPhoto(null); setPhotoDirty(true); }} style={{background:"transparent",border:"none",color:T.textSm,fontSize:12,cursor:"pointer",fontFamily:F}}>Quitar</button>}
        </div>

        <label style={{display:"block",fontSize:12,fontWeight:600,color:T.textMd,marginBottom:8}}>Color</label>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
          {COLORS.map(c => (
            <button key={c} onClick={()=>setColor(c)} title={c}
              style={{width:32,height:32,borderRadius:8,background:c,border:color===c?`2px solid ${T.text}`:`2px solid transparent`,cursor:"pointer",padding:0}}/>
          ))}
        </div>

        {canDelete && (
          <div className="gh-accordion" style={{borderTop:`1px solid ${T.border}`,paddingTop:14,marginTop:8}}>
            {!confirmDel ? (
              <button onClick={()=>setConfirmDel(true)} disabled={saving} style={{...BtnDanger(T),fontSize:12,padding:"8px 12px",borderRadius:10}}>Eliminar tienda</button>
            ) : (
              <div style={{background:T.red+"10",border:`1px solid ${T.red}33`,borderRadius:10,padding:"12px 14px",boxShadow:`0 0 0 1px ${T.red}18, 0 4px 12px ${T.red}14`}}>
                <div style={{fontSize:12,color:T.text,fontWeight:700,marginBottom:4}}>¿Eliminar la tienda "{store.name}"?</div>
                <div style={{fontSize:11.5,color:T.textMd,lineHeight:1.5,marginBottom:8}}>Se borran sus planes, suscriptores, cobros y las vinculaciones con Shopify y Mercado Pago. Los cobros recurrentes de esta tienda dejan de ejecutarse.{store.is_primary&&totalStores>1?" Tu login sigue igual; pasás a otra de tus tiendas.":""}</div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={()=>setConfirmDel(false)} disabled={saving} style={{...BtnSecondary(T),flex:1,padding:"7px",fontSize:11,borderRadius:8,justifyContent:"center"}}>Cancelar</button>
                  <button onClick={handleDelete} disabled={saving} style={{...BtnDanger(T),flex:1,padding:"7px",fontSize:11,borderRadius:8,justifyContent:"center",background:T.red,color:"#fff",boxShadow:`0 2px 12px ${T.red}55`}}>{saving?"Borrando...":"Sí, borrar"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        <div style={{display:"flex",gap:8,marginTop:18}}>
          <button onClick={onClose} disabled={saving} style={{...BtnSecondary(T),flex:1,padding:"10px 14px",fontSize:13,borderRadius:10,justifyContent:"center"}}>Cancelar</button>
          <button onClick={handleSave} disabled={saving||!name.trim()} style={{...BtnPrimary(T),flex:1,padding:"10px 14px",fontSize:13,borderRadius:10,justifyContent:"center",opacity:saving||!name.trim()?0.6:1}}>{saving?"Guardando...":"Guardar"}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Sidebar ───────────────────────────────────────────────────────────
export function Sidebar({T, nav=NAV, activeTab, onTab, user, merchant, workspace, onSwitchStore, onCreateStore, onManageStore, collapsed, setCollapsed, darkMode, setDarkMode, onLogout, alerts={}}) {
  const items = nav.map(it=>it.alertKey?{...it,count:alerts[it.alertKey]}:it);
  const initial = (user?.displayName||user?.email||"?").charAt(0).toUpperCase();
  const W = collapsed ? 64 : 224;
  const stores = workspace?.stores || [];
  const activeStoreId = workspace?.active_merchant_id || merchant?.id || null;
  const role = merchant?.role || stores.find(s=>s.id===activeStoreId)?.role;

  const NavBtn = ({item}) => {
    const active = activeTab === item.id;
    const badgeColor = item.badge==="red" ? T.red : item.badge==="orange" ? T.orange : T.accent;
    return (
      <button onClick={()=>onTab(item.id)} title={collapsed?item.label:undefined}
        style={{display:"flex",alignItems:"center",gap:9,padding:collapsed?"10px 0":"8px 10px",
          background:active?T.accentSolid+"20":"transparent",border:"none",
          borderRadius:DS.r.md,cursor:"pointer",textAlign:"left",
          color:active?T.accent:T.textMd,fontWeight:active?DS.w.semibold:DS.w.medium,
          fontSize:DS.font.sm,fontFamily:F,
          transition:`all 0.12s ${DS.ease}`,justifyContent:collapsed?"center":"flex-start",
          position:"relative",width:"100%",letterSpacing:active?0:-0.1}}
        onMouseEnter={e=>{if(!active)e.currentTarget.style.background=T.card;}}
        onMouseLeave={e=>{if(!active)e.currentTarget.style.background="transparent";}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active?"2.2":"1.8"} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0,opacity:active?1:0.65}}><path d={item.icon}/></svg>
        {!collapsed&&<span style={{flex:1}}>{item.label}</span>}
        {!collapsed&&item.soon&&<span style={{fontSize:8,fontWeight:800,letterSpacing:0.5,background:T.yellow+"22",color:T.yellow,borderRadius:99,padding:"1px 6px"}}>PRONTO</span>}
        {!collapsed&&item.count>0&&<span style={{fontSize:10,fontWeight:DS.w.bold,padding:"1px 6px",borderRadius:DS.r.full,background:badgeColor+(active?"33":"22"),color:badgeColor,lineHeight:1.5,minWidth:18,textAlign:"center"}}>{item.count>99?"99+":item.count}</span>}
        {collapsed&&item.count>0&&<span style={{position:"absolute",top:6,right:8,width:6,height:6,borderRadius:DS.r.full,background:badgeColor}}/>}
      </button>
    );
  };

  return (
    <div style={{width:W,minWidth:W,height:"100vh",background:T.surface,borderRight:`1px solid ${T.border}`,
      display:"flex",flexDirection:"column",position:"sticky",top:0,
      transition:`width 0.22s ${DS.ease}, min-width 0.22s ${DS.ease}`,overflow:"hidden",zIndex:50,fontFamily:F,
    }} className="hide-mobile">
      {/* Logo */}
      {collapsed ? (
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,borderBottom:`1px solid ${T.border}`,height:60,padding:"0 4px"}}>
          <RecLogo size={22}/>
          <button onClick={()=>setCollapsed(false)} title="Expandir" style={{background:"transparent",border:`1px solid ${T.border}`,borderRadius:DS.r.sm,color:T.textSm,cursor:"pointer",padding:"2px 6px",display:"flex",alignItems:"center",justifyContent:"center",transition:`all 0.15s ${DS.ease}`,width:36}}
            onMouseEnter={e=>{e.currentTarget.style.background=T.card;e.currentTarget.style.color=T.text;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=T.textSm;}}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      ) : (
        <div style={{padding:DS.sp.lg,display:"flex",alignItems:"center",gap:10,borderBottom:`1px solid ${T.border}`,height:60}}>
          <RecLogo size={26}/>
          <span style={{fontWeight:DS.w.bold,fontSize:DS.font.xl,color:T.text,letterSpacing:-0.3}}>Recurrentes</span>
          <button onClick={()=>setCollapsed(true)} title="Colapsar" style={{marginLeft:"auto",background:"transparent",border:`1px solid ${T.border}`,borderRadius:DS.r.sm,color:T.textSm,cursor:"pointer",padding:"3px 5px",display:"flex",alignItems:"center",justifyContent:"center",transition:`all 0.15s ${DS.ease}`}}
            onMouseEnter={e=>{e.currentTarget.style.background=T.card;e.currentTarget.style.color=T.text;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=T.textSm;}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav style={{flex:1,padding:DS.sp.sm,display:"flex",flexDirection:"column",gap:2,overflowY:"auto"}}>
        {items.map((item,i)=>{
          if(item.group) {
            if(collapsed) return null;
            return (
              <div key={item.group+i} style={{padding:"10px 12px 3px",fontSize:DS.font.xs,fontWeight:DS.w.bold,color:T.textSm,letterSpacing:0.7,textTransform:"uppercase",opacity:0.55,userSelect:"none"}}>
                {item.group}
              </div>
            );
          }
          return <NavBtn key={item.id} item={item}/>;
        })}
      </nav>

      {/* Selector de tienda (abre hacia arriba) */}
      <StoreSwitcher T={T} stores={stores} activeStoreId={activeStoreId} onSwitchStore={onSwitchStore} onCreateStore={onCreateStore} onManageStore={onManageStore} collapsed={collapsed}/>

      {/* Bloque de cuenta */}
      <div className="gh-accordion" style={{padding:DS.sp.sm}}>
        {!collapsed&&(
          <button onClick={()=>onTab("configuracion")} title="Mi cuenta" style={{display:"flex",alignItems:"center",gap:DS.sp.md,padding:DS.sp.sm,width:"100%",background:"transparent",border:"none",cursor:"pointer",borderRadius:DS.r.md,fontFamily:F,marginBottom:DS.sp.xs}}>
            {user?.photoURL
              ?<img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{width:28,height:28,borderRadius:DS.r.full,border:`1px solid ${T.border}`,flexShrink:0}}/>
              :<div style={{width:28,height:28,borderRadius:DS.r.full,background:T.accentSolid+"33",color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:DS.w.bold,fontSize:DS.font.md,flexShrink:0}}>{initial}</div>
            }
            <div style={{flex:1,minWidth:0,textAlign:"left"}}>
              <div style={{fontSize:DS.font.md,fontWeight:DS.w.semibold,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user?.displayName||user?.email?.split("@")[0]}</div>
              <div style={{fontSize:DS.font.xs,color:T.textSm,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{role==="member"?"Miembro del equipo":"Beta gratis"}</div>
            </div>
          </button>
        )}
        <div style={{display:"flex",flexDirection:collapsed?"column":"row",gap:4}}>
          <button onClick={()=>setDarkMode(!darkMode)} title={darkMode?"Modo claro":"Modo oscuro"} style={{flex:collapsed?undefined:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:DS.r.md,color:T.textMd,cursor:"pointer",padding:"6px 8px",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontSize:DS.font.sm,fontFamily:F}}>
            {darkMode
              ?<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
              :<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            }
            {!collapsed&&(darkMode?"Claro":"Oscuro")}
          </button>
          <button onClick={onLogout} title="Cerrar sesión" style={{flex:collapsed?undefined:1,background:"transparent",border:`1px solid ${T.border}`,borderRadius:DS.r.md,color:T.textMd,cursor:"pointer",padding:"6px 8px",display:"flex",alignItems:"center",justifyContent:"center",gap:6,fontSize:DS.font.sm,fontFamily:F}}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            {!collapsed&&"Salir"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Topbar de sección ─────────────────────────────────────────────────
// ALTO FIJO 64px + 1px de borde: los sticky de abajo (AppTabs top:65) dependen de eso.
export function AppTopbar({T, section, sectionId, icon, onHelp, children, top=0}) {
  const iconPath = icon || (sectionId ? SECTION_ICONS[sectionId] : null);
  return (
    <div style={{borderBottom:`1px solid ${T.border}`,background:T.card+"e0",backdropFilter:"blur(8px)",WebkitBackdropFilter:"blur(8px)",padding:"0 24px 0 16px",position:"sticky",top,zIndex:30,fontFamily:F}}>
      <div className="gh-topbar-row" style={{display:"flex",alignItems:"center",justifyContent:"space-between",height:64,gap:16,maxWidth:"100%",margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,flexShrink:0,minWidth:0}}>
          {iconPath
            ? <div style={{width:32,height:32,borderRadius:DS.r.md,background:T.accentSolid+"18",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath}/></svg>
              </div>
            : <RecLogo size={22}/>}
          <span style={{fontWeight:DS.w.semibold,fontSize:14,color:T.text,letterSpacing:-0.2,whiteSpace:"nowrap",lineHeight:"18px"}}>{section}</span>
        </div>
        <div className="no-scrollbar gh-topbar-ctl" style={{display:"flex",alignItems:"center",gap:6,overflowX:"auto",WebkitOverflowScrolling:"touch",maxWidth:"100%",minWidth:0,padding:"3px 0"}}>
          {children}
          {onHelp&&(
            <button onClick={onHelp} title="¿Cómo funciona esta sección?"
              style={{width:34,height:34,borderRadius:DS.r.full,boxSizing:"border-box",border:`1px solid ${T.border}`,background:"transparent",color:T.textMd,fontSize:13,fontWeight:DS.w.bold,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:F,lineHeight:1,padding:0}}>?</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Nav inferior mobile (<768px) ──────────────────────────────────────
// 4 accesos directos + "Más" (hoja con el resto del menú, tiendas, tema y salir).
export function MobileBottomNav({T, nav=NAV, activeTab, onTab, workspace, merchant, onSwitchStore, onCreateStore, darkMode, setDarkMode, onLogout, alerts={}}) {
  const [open, setOpen] = React.useState(false);
  const primaryIds = ["inicio","planes","suscriptores","cobros"];
  const primary = primaryIds.map(id=>nav.find(n=>n.id===id)).filter(Boolean);
  const rest = nav.filter(n=>!primaryIds.includes(n.id));
  const stores = workspace?.stores || [];
  const activeStoreId = workspace?.active_merchant_id || merchant?.id || null;
  const restActive = rest.some(n=>n.id===activeTab);
  const Item = ({item, active, onClick}) => (
    <button onClick={onClick} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:3,padding:"8px 4px 6px",background:"transparent",border:"none",color:active?T.accent:T.textSm,fontFamily:F,fontSize:10,fontWeight:active?700:500,cursor:"pointer",position:"relative",minWidth:0}}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active?"2.2":"1.8"} strokeLinecap="round" strokeLinejoin="round"><path d={item.icon}/></svg>
      <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"100%"}}>{item.short||item.label}</span>
      {item.alertKey&&alerts[item.alertKey]>0&&<span style={{position:"absolute",top:6,right:"calc(50% - 16px)",width:7,height:7,borderRadius:99,background:T.red}}/>}
    </button>
  );
  return (
    <>
      <div className="mobile-only" style={{display:"none",position:"fixed",left:0,right:0,bottom:0,zIndex:80,background:T.card+"f2",backdropFilter:"blur(12px)",WebkitBackdropFilter:"blur(12px)",borderTop:`1px solid ${T.border}`,paddingBottom:"env(safe-area-inset-bottom)",fontFamily:F}}>
        {primary.map(item=><Item key={item.id} item={item} active={activeTab===item.id} onClick={()=>{ setOpen(false); onTab(item.id); }}/>)}
        <Item item={{id:"mas",label:"Más",short:"Más",icon:"M5 12h.01M12 12h.01M19 12h.01"}} active={open||restActive} onClick={()=>setOpen(o=>!o)}/>
      </div>
      {open && ReactDOM.createPortal(
        <div className="gh-overlay" onClick={()=>setOpen(false)} style={{position:"fixed",inset:0,zIndex:90,background:"rgba(0,0,0,0.55)",backdropFilter:"blur(3px)",display:"flex",alignItems:"flex-end",fontFamily:F}}>
          <div className="gh-panel-up" onClick={e=>e.stopPropagation()} style={{width:"100%",maxHeight:"80vh",overflowY:"auto",background:T.card,borderTop:`1px solid ${T.border}`,borderRadius:"18px 18px 0 0",padding:"10px 14px calc(76px + env(safe-area-inset-bottom))"}}>
            <div style={{width:40,height:4,borderRadius:99,background:T.border,margin:"2px auto 12px"}}/>
            <div style={{fontSize:10,fontWeight:800,color:T.textSm,letterSpacing:0.7,textTransform:"uppercase",padding:"4px 6px 6px"}}>Secciones</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:14}}>
              {rest.map(item=>{
                const active=activeTab===item.id;
                return (
                  <button key={item.id} onClick={()=>{ setOpen(false); onTab(item.id); }} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:6,padding:"12px 6px",background:active?T.accentSolid+"20":T.bg,border:`1px solid ${active?T.accentSolid+"55":T.border}`,borderRadius:12,color:active?T.accent:T.textMd,fontFamily:F,fontSize:11,fontWeight:600,cursor:"pointer"}}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon}/></svg>
                    <span style={{textAlign:"center",lineHeight:1.2}}>{item.short||item.label}</span>
                  </button>
                );
              })}
            </div>
            {stores.length>0 && (
              <>
                <div style={{fontSize:10,fontWeight:800,color:T.textSm,letterSpacing:0.7,textTransform:"uppercase",padding:"4px 6px 6px"}}>Tiendas</div>
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:14}}>
                  {stores.map(s=>{
                    const active=s.id===activeStoreId;
                    return (
                      <button key={s.id} onClick={()=>{ if(!active){ setOpen(false); onSwitchStore&&onSwitchStore(s.id);} }} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:active?T.accentSolid+"14":"transparent",border:`1px solid ${active?T.accentSolid+"44":T.border}`,borderRadius:10,color:T.text,fontFamily:F,fontSize:13,fontWeight:600,cursor:"pointer",textAlign:"left"}}>
                        <StoreAvatar T={T} store={s} size={26}/>
                        <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.name}</span>
                        {active&&<span style={{fontSize:10,color:T.accent,fontWeight:800}}>ACTIVA</span>}
                      </button>
                    );
                  })}
                  {onCreateStore && <button onClick={()=>{ setOpen(false); onCreateStore(); }} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 10px",background:"transparent",border:`1px dashed ${T.border}`,borderRadius:10,color:T.textMd,fontFamily:F,fontSize:13,fontWeight:600,cursor:"pointer"}}>
                    <span style={{width:26,height:26,borderRadius:8,background:T.accentSolid+"22",color:T.accent,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800}}>+</span> Nueva tienda
                  </button>}
                </div>
              </>
            )}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setDarkMode(!darkMode)} style={{...BtnSecondary(T),flex:1,justifyContent:"center",padding:"10px"}}>{darkMode?"Modo claro":"Modo oscuro"}</button>
              <button onClick={onLogout} style={{...BtnSecondary(T),flex:1,justifyContent:"center",padding:"10px"}}>Cerrar sesión</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
