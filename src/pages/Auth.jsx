import { FREE_SUBSCRIBERS } from "../../shared/platform/pricing.js";
// Sitio público de Recurrentes: Landing + AuthScreen (login / registro /
// recuperar contraseña). Adaptado de la AuthScreen de Growith. NO escribe
// Firestore desde el cliente: el doc del merchant se crea en el primer GET
// a /api/merchant.
import React, { useState, useEffect } from "react";
import { auth } from "../lib/firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, updateProfile,
} from "firebase/auth";
import { useTheme } from "../ui/theme.js";
import { InputStyle, BtnSolid, BtnSecondary, Spinner } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import Landing from "./Landing.jsx";
import { apiPost } from "../lib/api.js";
import { savePendingSignup, readPendingSignup, normalizeWhatsapp, EMAIL_RE } from "../lib/signup.js";

import { captureAttribution, readAttribution, pixelTrack } from "../lib/attribution.js";
const F = "'Inter',system-ui,sans-serif";
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
// Navegadores dentro de apps (Instagram, Facebook, TikTok…): Google bloquea el login ahí (disallowed_useragent).
const IN_APP_BROWSER = typeof navigator !== "undefined" && /Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly/i.test(navigator.userAgent || "");

// El registro self-serve está CERRADO (26-sept-2026, Thiago: "las cuentas las
// creo yo desde mi admin, lo mismo que las integraciones"). #/registro redirige
// a #/demo.
//
// Única excepción: la instalación desde la tienda de apps de Tiendanube vuelve
// al panel con ?tn_claim= y necesita una cuenta para asociarse. Sin esta puerta,
// el día que aprueben la app esa instalación se rompe y nadie se entera.
export function registroPermitido() {
  try {
    const h = window.location.hash || "", q = window.location.search || "";
    return /[?&]tn_claim=/.test(h) || /[?&]tn_claim=/.test(q);
  } catch (_) { return false; }
}

function authViewFromHash() {
  const h = (typeof window !== "undefined" ? window.location.hash : "").toLowerCase().replace(/^#\/?/, "").split("?")[0];
  if (h === "login") return "login";
  if (h === "registro" || h === "register" || h === "signup") return "register";
  if (h === "recuperar" || h === "reset") return "reset";
  return "landing";
}

// Afiliados: el código del link (recurrentesapp.com/?ref=CODIGO) se guarda ANTES del
// registro y se reclama con la primera sesión (Dashboard → ref-claim).
try {
  const _ref = new URLSearchParams(window.location.search).get("ref");
  if (_ref && /^[A-Za-z0-9]{6,12}$/.test(_ref)) localStorage.setItem("rec_ref", _ref.toUpperCase());
} catch (_) {}
// Meta Ads propio: de qué anuncio vino (utm_* / fbclid), primer toque gana (src/lib/attribution.js).
captureAttribution();

// Rutea #/login · #/registro · #/recuperar; por defecto la Landing.
export function PublicSite() {
  const { T, darkMode, toggleDark } = useTheme();
  const [view, setView] = useState(authViewFromHash);
  useEffect(() => {
    const onHash = () => { setView(authViewFromHash()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Quien llegue a #/registro (link viejo, mail guardado, la URL tipeada) va a
  // pedir la demo. La cuenta la crea Thiago desde el Admin después de la llamada.
  useEffect(() => {
    if (view === "register" && !registroPermitido()) { try { window.location.hash = "#/demo"; } catch (_) {} }
  }, [view]);
  const go = (v) => { try { window.location.hash = v === "landing" ? "#/" : `#/${v === "register" ? "registro" : v === "reset" ? "recuperar" : "login"}`; } catch (_) {} setView(v); window.scrollTo(0, 0); };
  if (view === "landing") return <Landing T={T} darkMode={darkMode} onToggleDark={toggleDark} onLogin={() => go("login")} onRegister={() => go("register")}/>;
  return <AuthScreen T={T} darkMode={darkMode} onToggleDark={toggleDark} mode={view} setMode={go} onBackToLanding={() => go("landing")}/>;
}

export default PublicSite;

const ERR = {
  "auth/user-not-found": "No existe una cuenta con ese email.",
  "auth/wrong-password": "Contraseña incorrecta.",
  "auth/email-already-in-use": "Ya existe una cuenta con ese email. Probá iniciar sesión.",
  "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
  "auth/invalid-email": "El email no es válido.",
  "auth/invalid-credential": "Email o contraseña incorrectos.",
  "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos y probá de nuevo.",
  "auth/network-request-failed": "Sin conexión. Revisá tu internet e intentá de nuevo.",
  "auth/popup-closed-by-user": "Cerraste la ventana de Google antes de terminar.",
  "auth/cancelled-popup-request": "Se canceló la ventana de Google. Probá de nuevo.",
  "auth/popup-blocked": "El navegador bloqueó la ventana de Google. Permití popups para este sitio.",
  "auth/account-exists-with-different-credential": "Ese email ya está registrado con otro método. Entrá con email y contraseña.",
  "auth/operation-not-allowed": "Ese método de acceso no está habilitado.",
  "auth/user-disabled": "Esta cuenta está deshabilitada.",
  "auth/missing-password": "Ingresá tu contraseña.",
  "auth/unauthorized-domain": "El acceso con Google todavía no está habilitado en este sitio. Mientras tanto entrá con tu email y contraseña.",
  "auth/web-storage-unsupported": "Tu navegador bloquea el inicio de sesión (cookies desactivadas o modo privado estricto). Probá con otro navegador.",
  "auth/internal-error": "Google no respondió bien. Probá de nuevo en unos segundos.",
};
const errMsg = (e) => ERR[e?.code] || e?.message || "Ocurrió un error. Intentá de nuevo.";

export function AuthScreen({ T, darkMode, onToggleDark, mode = "login", setMode, onBackToLanding }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nombre, setNombre] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  // Registro en 2 pasos: "datos" (nombre, WhatsApp, email de contacto) → "acceso" (Google o contraseña).
  const [step, setStep] = useState("datos");
  const [acepta, setAcepta] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const iS = InputStyle(T);
  const isLogin = mode === "login", isRegister = mode === "register", isReset = mode === "reset";

  useEffect(() => { setError(""); setInfo(""); setStep("datos"); }, [mode]);
  // Vuelta de signInWithRedirect (cuando el navegador bloqueó la ventana): si falló, mostramos el error.
  useEffect(() => { getRedirectResult(auth).catch(e => setError(errMsg(e))); }, []);

  // Calificación en el alta (23-sept-2026, Thiago): saber con qué volumen
  // viene, qué busca y si quiere que se lo instalemos. Sirve para priorizar a
  // quién llamar y para no perder tiempo con curiosos.
  const [volumen, setVolumen] = useState("");
  const [objetivo, setObjetivo] = useState("");
  const [instala, setInstala] = useState("");

  const changeMode = (m) => { if (setMode) setMode(m); };

  // Paso 1 → 2: los datos quedan en el navegador y el panel los guarda apenas hay sesión
  // (con Google enseguida; con contraseña, después de verificar el mail).
  function goAcceso() {
    const wa = normalizeWhatsapp(whatsapp);
    if (!nombre.trim()) return setError("Ingresá tu nombre.");
    if (!wa) return setError("Ingresá tu WhatsApp con código de área (ej: 11 6411 7974).");
    if (!EMAIL_RE.test(email.trim())) return setError("Ingresá un email de contacto válido.");
    if (!volumen) return setError("Contanos cuánto vende tu tienda hoy.");
    if (!objetivo) return setError("Contanos qué buscás con las suscripciones.");
    if (!instala) return setError("Elegí cómo querés hacer la instalación.");
    if (!acepta) return setError("Tenés que aceptar los Términos y la Política de privacidad.");
    savePendingSignup({
      owner_name: nombre.trim(), owner_whatsapp: wa, contact_email: email.trim().toLowerCase(),
      lead_volumen: volumen, lead_objetivo: objetivo, lead_instalacion: instala,
    });
    setError(""); setStep("acceso");
  }

  async function handleGoogle() {
    if (isRegister && !acepta) return setError("Tenés que aceptar los Términos y la Política de privacidad.");
    if (IN_APP_BROWSER) return setError("Google no deja entrar desde el navegador de Instagram o Facebook. Abrí esta página en Chrome o Safari (menú ⋯ → Abrir en el navegador).");
    setLoading(true); setError("");
    try {
      await signInWithPopup(auth, googleProvider);
      // App detecta el user vía onAuthStateChanged; el merchant se crea en el primer GET /api/merchant.
    } catch (e) {
      // Ventana bloqueada: probamos en la misma pestaña (vuelve con getRedirectResult).
      if (e?.code === "auth/popup-blocked") {
        try { await signInWithRedirect(auth, googleProvider); return; } catch (e2) { setError(errMsg(e2)); }
      } else setError(errMsg(e));
    }
    setLoading(false);
  }

  async function handleEmail() {
    const em = email.trim();
    if (isReset) {
      if (!em) return setError("Ingresá tu email.");
      setLoading(true); setError(""); setInfo("");
      try {
        await sendPasswordResetEmail(auth, em);
        setInfo(`Te mandamos un mail a ${em} con el link para crear una contraseña nueva. Revisá spam si no llega.`);
      } catch (e) { setError(e?.code === "auth/user-not-found" ? "No existe una cuenta con ese email." : errMsg(e)); }
      setLoading(false);
      return;
    }
    if (!em || !password) return setError("Completá email y contraseña.");
    if (isRegister && !nombre.trim()) return setError("Ingresá tu nombre.");
    if (isRegister && !acepta) return setError("Tenés que aceptar los Términos y la Política de privacidad.");
    setLoading(true); setError("");
    try {
      if (isRegister) {
        const cred = await createUserWithEmailAndPassword(auth, em, password);
        try { await updateProfile(cred.user, { displayName: nombre.trim() }); } catch (_) {}
        // Datos del paso 1 al servidor YA (aunque el mail no esté verificado): así no se
        // piden de nuevo desde otro dispositivo, y salen el aviso al admin y la bienvenida.
        try {
          const pend = readPendingSignup();
          let ref = null; try { ref = localStorage.getItem("rec_ref"); } catch (_) {}
          if (pend) await apiPost("merchant", { owner_name: pend.owner_name, owner_whatsapp: pend.owner_whatsapp, contact_email: pend.contact_email, lead_volumen: pend.lead_volumen, lead_objetivo: pend.lead_objetivo, lead_instalacion: pend.lead_instalacion, ...(ref ? { ref_code: ref } : {}), attribution: readAttribution() }, { action: "save-owner" });
          // El mismo evento desde el navegador con el MISMO event_id que el servidor: Meta deduplica.
          pixelTrack("CompleteRegistration", { content_name: "registro" }, `acq_registered_${cred.user.uid}`);
        } catch (_) {}
        // Sin mail de verificación: se entra directo al panel (Thiago, 19-sept-2026).
      } else {
        await signInWithEmailAndPassword(auth, em, password);
      }
    } catch (e) { setError(errMsg(e)); }
    setLoading(false);
  }

  const title = isLogin ? "Iniciá sesión" : isRegister ? "Creá tu cuenta" : "Recuperar contraseña";
  const subtitle = isLogin ? "Entrá a tu panel de suscripciones." : isRegister ? `Gratis hasta ${FREE_SUBSCRIBERS} suscriptores · sin comisión por venta · conectás tu tienda y Mercado Pago en minutos.` : "Te mandamos un link por mail para elegir una contraseña nueva.";
  const label = { display:"block", fontSize:12, fontWeight:600, color:T.textMd, marginBottom:5, textTransform:"uppercase", letterSpacing:0.5 };
  const onFocus = e => e.target.style.borderColor = T.accent, onBlur = e => e.target.style.borderColor = T.inputBorder;
  const linkBtn = { background:"none", border:"none", color:T.accent, fontWeight:600, cursor:"pointer", fontFamily:F, fontSize:13, padding:0 };
  const stepLabel = { fontSize:11, fontWeight:700, color:T.accent, letterSpacing:0.5, textTransform:"uppercase" };
  const termsBox = (
    <label style={{display:"flex",alignItems:"flex-start",gap:9,fontSize:12,color:T.textMd,lineHeight:1.5,marginBottom:16,cursor:"pointer"}}>
      <input type="checkbox" checked={acepta} onChange={e=>setAcepta(e.target.checked)} style={{marginTop:2,accentColor:T.accentSolid,width:15,height:15,flexShrink:0}}/>
      <span>Acepto los <a href="#/terminos" target="_blank" rel="noreferrer" style={{color:T.accent}}>Términos y condiciones</a> y la <a href="#/privacidad" target="_blank" rel="noreferrer" style={{color:T.accent}}>Política de privacidad</a>.</span>
    </label>
  );
  const step1 = (
    <>
      <div style={{...stepLabel,marginBottom:14}}>Paso 1 de 2 · Tus datos</div>
      <div style={{marginBottom:12}}>
        <label style={label}>Nombre</label>
        <input style={iS} placeholder="Tu nombre" value={nombre} onChange={e=>setNombre(e.target.value)} onFocus={onFocus} onBlur={onBlur} autoComplete="name" autoFocus/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={label}>WhatsApp</label>
        <input style={iS} placeholder="11 6411 7974" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)} onFocus={onFocus} onBlur={onBlur} autoComplete="tel" inputMode="tel"/>
      </div>
      <div style={{marginBottom:16}}>
        <label style={label}>Email de contacto</label>
        <input style={iS} type="email" placeholder="vos@tunegocio.com" value={email} onChange={e=>setEmail(e.target.value)} onFocus={onFocus} onBlur={onBlur} autoComplete="email" onKeyDown={e=>e.key==="Enter"&&goAcceso()}/>
      </div>
      <div style={{marginBottom:12}}>
        <label style={label}>¿Cuánto vende tu tienda hoy?</label>
        <select style={iS} value={volumen} onChange={e=>setVolumen(e.target.value)}>
          <option value="">Elegí una opción</option>
          <option value="sin_ventas">Todavía no vendo / recién arranco</option>
          <option value="1_50">Hasta 50 pedidos por mes</option>
          <option value="50_200">Entre 50 y 200 pedidos por mes</option>
          <option value="200_1000">Entre 200 y 1.000 pedidos por mes</option>
          <option value="1000_mas">Más de 1.000 pedidos por mes</option>
        </select>
      </div>
      <div style={{marginBottom:12}}>
        <label style={label}>¿Qué buscás con las suscripciones?</label>
        <select style={iS} value={objetivo} onChange={e=>setObjetivo(e.target.value)}>
          <option value="">Elegí una opción</option>
          <option value="recompra">Que mis clientes vuelvan a comprar solos</option>
          <option value="ingreso_fijo">Tener un ingreso fijo todos los meses</option>
          <option value="ticket">Vender packs más grandes (más plata por venta)</option>
          <option value="dejar_manual">Dejar de perseguir la recompra a mano</option>
          <option value="mirando">Todavía estoy viendo si me sirve</option>
        </select>
      </div>
      {/* La instalación asistida (23-sept-2026, Thiago): además de ser un
          servicio que se cobra, marca quién tiene intención real de arrancar. */}
      <div style={{marginBottom:16}}>
        <label style={label}>¿Querés que dejemos la conexión y el widget hechos por nosotros?</label>
        <select style={iS} value={instala} onChange={e=>setInstala(e.target.value)}>
          <option value="">Elegí una opción</option>
          <option value="solo">No, lo hago yo con los tutoriales</option>
          <option value="asistida">Sí, quiero instalación con widget a medida y llamada (USD 100, se paga una vez esté integrado y funcional)</option>
        </select>
        {instala === "asistida" && (
          <div style={{fontSize:12,color:T.textSm,marginTop:6,lineHeight:1.45}}>
            Widget 100% personalizado para tu tienda, llamada explicativa y los cambios que necesites.
            Los <strong style={{color:T.textMd}}>USD 100 se pagan una vez esté integrado y funcional</strong>.
          </div>
        )}
      </div>
      {termsBox}
      {error && <div style={{background:T.redBg,border:`1.5px solid ${T.red}55`,borderRadius:8,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:14,lineHeight:1.45}}>{error}</div>}
      <button onClick={goAcceso} style={{...BtnSolid(T),width:"100%",padding:"13px",fontSize:15}}>Continuar →</button>
      <div style={{textAlign:"center",marginTop:18,fontSize:13,color:T.textMd,lineHeight:1.8}}>¿Ya tenés cuenta? <button onClick={()=>changeMode("login")} style={linkBtn}>Iniciá sesión</button></div>
    </>
  );

  return (
    <div style={{fontFamily:F,background:T.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:"56px 20px 32px",color:T.text}}>
      <button onClick={onToggleDark} style={{position:"fixed",top:16,right:16,background:"transparent",border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 10px",fontSize:11,color:T.textSm,cursor:"pointer",fontFamily:F,zIndex:5}}>{darkMode?"Claro":"Oscuro"}</button>
      {onBackToLanding&&<button onClick={onBackToLanding} style={{position:"fixed",top:16,left:16,background:"transparent",border:`1px solid ${T.border}`,borderRadius:7,padding:"5px 12px",fontSize:11,color:T.textSm,cursor:"pointer",fontFamily:F,zIndex:5}}>← Volver al sitio</button>}
      <div className="gh-page" style={{width:"100%",maxWidth:420}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:12,marginBottom:14}}>
            <RecLogo size={44}/>
            <div style={{fontSize:30,fontWeight:800,color:T.text,letterSpacing:-1,lineHeight:1}}>Recurrentes</div>
          </div>
          <div style={{fontSize:20,fontWeight:700,color:T.text,letterSpacing:-0.4}}>{title}</div>
          <div style={{fontSize:13,color:T.textSm,marginTop:6,lineHeight:1.55}}>{subtitle}</div>
        </div>

        <div style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:26,boxShadow:"0 1px 2px rgba(0,0,0,0.06), 0 12px 40px rgba(0,0,0,0.10)"}}>
          {isRegister && step === "datos" ? step1 : (<>
          {isRegister && (
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,background:T.surface,border:`1px solid ${T.borderL}`,borderRadius:10,padding:"10px 12px",marginBottom:16,fontSize:13,color:T.textMd}}>
              <span style={{minWidth:0,overflow:"hidden",textOverflow:"ellipsis"}}><span style={{...stepLabel,display:"block",marginBottom:2}}>Paso 2 de 2 · Tu acceso</span><strong style={{color:T.text}}>{nombre}</strong> · {email}</span>
              <button onClick={()=>{ setError(""); setStep("datos"); }} style={{...linkBtn,fontSize:12,flexShrink:0}}>Cambiar</button>
            </div>
          )}
          {!isReset && (
            <>
              <button onClick={handleGoogle} disabled={loading} style={{...BtnSecondary(T),width:"100%",justifyContent:"center",padding:"12px",fontSize:14,fontWeight:600,marginBottom:18,background:T.surface,color:T.text}}>
                <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                {isRegister ? "Registrarme con Google" : "Continuar con Google"}
              </button>
              {isLogin && <div style={{fontSize:11,color:T.textSm,textAlign:"center",margin:"-10px 0 16px",lineHeight:1.5}}>Si es tu primera vez, al continuar con Google aceptás los <a href="#/terminos" target="_blank" rel="noreferrer" style={{color:T.textSm}}>Términos</a> y la <a href="#/privacidad" target="_blank" rel="noreferrer" style={{color:T.textSm}}>Privacidad</a>.</div>}
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:18}}>
                <div style={{flex:1,height:1,background:T.border}}/>
                <span style={{fontSize:12,color:T.textSm}}>{isRegister ? "o creá una contraseña" : "o con email"}</span>
                <div style={{flex:1,height:1,background:T.border}}/>
              </div>
            </>
          )}

          <div style={{marginBottom:12}}>
            <label style={label}>Email</label>
            <input style={iS} type="email" placeholder="vos@tutienda.com.ar" value={email} onChange={e=>setEmail(e.target.value)} onFocus={onFocus} onBlur={onBlur} autoComplete="email" onKeyDown={e=>e.key==="Enter"&&isReset&&handleEmail()}/>
          </div>
          {!isReset && (
            <div style={{marginBottom:isLogin?8:16}}>
              <label style={label}>Contraseña</label>
              <input style={iS} type="password" placeholder={isRegister?"6+ caracteres":"••••••••"} value={password} onChange={e=>setPassword(e.target.value)} onFocus={onFocus} onBlur={onBlur} autoComplete={isRegister?"new-password":"current-password"} onKeyDown={e=>e.key==="Enter"&&handleEmail()}/>
            </div>
          )}
          {isLogin && (
            <div style={{textAlign:"right",marginBottom:16}}>
              <button type="button" onClick={()=>changeMode("reset")} style={{...linkBtn,fontSize:12,fontWeight:500,color:T.textSm}}>¿Olvidaste tu contraseña?</button>
            </div>
          )}
          {error && <div style={{background:T.redBg,border:`1.5px solid ${T.red}55`,borderRadius:8,padding:"10px 14px",fontSize:13,color:T.red,marginBottom:14,lineHeight:1.45}}>{error}</div>}
          {info && <div style={{background:T.accentSolid+"14",border:`1.5px solid ${T.accentSolid}55`,borderRadius:8,padding:"10px 14px",fontSize:13,color:T.accent,marginBottom:14,lineHeight:1.45}}>{info}</div>}

          <button onClick={handleEmail} disabled={loading} style={{...BtnSolid(T),width:"100%",padding:"13px",fontSize:15,opacity:loading?0.7:1}}>
            {loading ? <><Spinner size={14}/> Cargando…</> : isLogin ? "Iniciar sesión" : isRegister ? "Crear cuenta gratis" : "Enviarme el link"}
          </button>

          <div style={{textAlign:"center",marginTop:18,fontSize:13,color:T.textMd,lineHeight:1.8}}>
            {isLogin && <>¿No tenés cuenta? <button onClick={()=>changeMode("register")} style={linkBtn}>Registrate gratis</button></>}
            {isRegister && <>¿Ya tenés cuenta? <button onClick={()=>changeMode("login")} style={linkBtn}>Iniciá sesión</button></>}
            {isReset && <><button onClick={()=>changeMode("login")} style={linkBtn}>← Volver a iniciar sesión</button></>}
          </div>
          </>)}
        </div>

        <div style={{textAlign:"center",marginTop:18,fontSize:11,color:T.textSm}}>
          <a href="#/terminos" style={{color:T.textSm,textDecoration:"underline"}}>Términos</a>
          <span style={{margin:"0 8px"}}>·</span>
          <a href="#/privacidad" style={{color:T.textSm,textDecoration:"underline"}}>Privacidad</a>
        </div>
      </div>
    </div>
  );
}
