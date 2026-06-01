import React, { useState } from "react";
import { auth } from "../lib/firebase.js";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";

// Landing pública + form de login/signup. Estilo limpio verde — al loguearse
// el state de App.jsx detecta el user vía onAuthStateChanged y rendea Dashboard.
export default function Landing({ onLogin }) {
  const [mode, setMode] = useState("signup"); // signup | login
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      if (mode === "signup") await createUserWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithEmailAndPassword(auth, email.trim(), password);
      onLogin?.();
    } catch (ex) {
      const code = ex.code || "";
      const map = {
        "auth/invalid-email": "Email inválido",
        "auth/email-already-in-use": "Ya existe una cuenta con ese email — proba 'Iniciar sesión'",
        "auth/weak-password": "La clave necesita 6+ caracteres",
        "auth/user-not-found": "No encontramos esa cuenta",
        "auth/wrong-password": "Clave incorrecta",
        "auth/invalid-credential": "Email o clave incorrecto",
      };
      setErr(map[code] || ex.message || "Error inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"linear-gradient(180deg, var(--bg) 0%, #0d1311 100%)"}}>
      {/* Nav */}
      <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 28px",borderBottom:"1px solid var(--border)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg, var(--green), var(--green-dark))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:"0 2px 8px rgba(16,185,129,0.3)"}}>🔁</div>
          <span style={{fontWeight:800,fontSize:18,letterSpacing:-0.3}}>Recurrentes</span>
        </div>
        <button onClick={()=>setMode(m => m === "signup" ? "login" : "signup")} style={{background:"transparent",border:"1px solid var(--border)",color:"var(--text-md)",padding:"7px 14px",borderRadius:8,fontSize:13,fontWeight:600}}>
          {mode === "signup" ? "Ya tengo cuenta" : "Crear cuenta"}
        </button>
      </nav>

      <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 380px",gap:48,maxWidth:1100,margin:"0 auto",padding:"60px 28px",width:"100%",alignItems:"center"}}>
        {/* Hero */}
        <div>
          <div style={{display:"inline-block",padding:"4px 10px",borderRadius:20,background:"var(--green-bg)",color:"var(--green-dark)",fontSize:11,fontWeight:700,letterSpacing:0.3,marginBottom:18,textTransform:"uppercase"}}>Beta · Shopify + Mercado Pago</div>
          <h1 style={{fontSize:46,fontWeight:800,lineHeight:1.1,margin:"0 0 18px",letterSpacing:-1.2}}>
            Suscripciones recurrentes para tu tienda <span style={{background:"linear-gradient(135deg, var(--green), #34d399)",WebkitBackgroundClip:"text",backgroundClip:"text",WebkitTextFillColor:"transparent"}}>Shopify</span>
          </h1>
          <p style={{fontSize:16,color:"var(--text-md)",lineHeight:1.55,margin:"0 0 28px",maxWidth:480}}>
            Tus clientes eligen <strong style={{color:"var(--text)"}}>Compra única</strong> o <strong style={{color:"var(--text)"}}>Suscripción</strong> en cada producto. Mercado Pago cobra cada N días, y nosotros generamos la orden en Shopify automáticamente.
          </p>
          <div style={{display:"flex",flexDirection:"column",gap:10,maxWidth:420}}>
            {[
              ["⚡","Setup en 10 min — conectás Shopify + MP y listo"],
              ["🔁","Cobros recurrentes automáticos en Mercado Pago"],
              ["📦","Cada cobro genera una orden Shopify lista para empaquetar"],
              ["⏸","Tus clientes pueden pausar o cancelar cuando quieran"],
            ].map(([icon, txt]) => (
              <div key={txt} style={{display:"flex",alignItems:"center",gap:10,fontSize:14,color:"var(--text-md)"}}>
                <span style={{fontSize:16}}>{icon}</span>
                <span>{txt}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Auth card */}
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:"28px 26px"}}>
          <div style={{fontSize:18,fontWeight:700,marginBottom:6}}>
            {mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
          </div>
          <div style={{fontSize:12,color:"var(--text-sm)",marginBottom:18,lineHeight:1.5}}>
            {mode === "signup"
              ? "Sin tarjeta. Probás con tu tienda Shopify y conectás MP cuando quieras."
              : "Bienvenido de vuelta."}
          </div>
          <form onSubmit={submit}>
            <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text-md)",marginBottom:5,textTransform:"uppercase",letterSpacing:0.4}}>Email</label>
            <input type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="vos@tutienda.com.ar"
              style={inputStyle}/>

            <label style={{display:"block",fontSize:11,fontWeight:600,color:"var(--text-md)",marginBottom:5,marginTop:14,textTransform:"uppercase",letterSpacing:0.4}}>Clave</label>
            <input type="password" required minLength={6} value={password} onChange={e=>setPassword(e.target.value)} placeholder="6+ caracteres"
              style={inputStyle}/>

            {err && (
              <div style={{marginTop:14,padding:"9px 12px",background:"rgba(239,68,68,0.1)",border:"1px solid rgba(239,68,68,0.3)",color:"#fca5a5",borderRadius:8,fontSize:12,lineHeight:1.45}}>
                {err}
              </div>
            )}

            <button type="submit" disabled={busy || !email || password.length < 6}
              style={{...btnStyle,width:"100%",marginTop:18,opacity:(busy||!email||password.length<6)?0.6:1,cursor:(busy||!email||password.length<6)?"not-allowed":"pointer"}}>
              {busy ? "Cargando…" : (mode === "signup" ? "Crear cuenta gratis" : "Entrar")}
            </button>

            <div style={{fontSize:11,color:"var(--text-sm)",marginTop:12,textAlign:"center"}}>
              {mode === "signup" ? "¿Ya tenés cuenta?" : "¿No tenés cuenta?"}{" "}
              <button type="button" onClick={()=>{setMode(m => m === "signup" ? "login" : "signup");setErr("");}} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",padding:0,fontSize:11,fontWeight:600,textDecoration:"underline"}}>
                {mode === "signup" ? "Iniciar sesión" : "Creá una"}
              </button>
            </div>
          </form>
        </div>
      </div>

      <footer style={{padding:"20px 28px",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--text-sm)",textAlign:"center"}}>
        Recurrentes — gestión de suscripciones para ecommerce
      </footer>
    </div>
  );
}

const inputStyle = {
  width:"100%",
  background:"var(--surface)",
  border:"1px solid var(--border)",
  color:"var(--text)",
  borderRadius:10,
  padding:"11px 14px",
  fontSize:14,
  outline:"none",
  fontFamily:"inherit",
};

const btnStyle = {
  background:"linear-gradient(135deg, var(--green), var(--green-dark))",
  border:"none",
  color:"#fff",
  padding:"11px 18px",
  borderRadius:10,
  fontSize:14,
  fontWeight:700,
  boxShadow:"0 4px 12px rgba(16,185,129,0.3)",
};
