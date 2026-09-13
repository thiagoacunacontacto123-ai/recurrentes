import React, { useState, useEffect } from "react";
import { auth, onAuthStateChanged } from "./lib/firebase.js";
import { signOut } from "firebase/auth";
import Landing from "./pages/Landing.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Portal from "./pages/Portal.jsx";
import CheckoutSuccess from "./pages/CheckoutSuccess.jsx";
import Checkout from "./pages/Checkout.jsx";

// Routing simple hash-based.
// Rutas PÚBLICAS (ignoran si hay user logueado o no):
//   #/portal?token=...           → Portal del cliente final
//   #/checkout-success?sub=...   → Pantalla de gracias post-MP
//   #/terminos · #/privacidad    → páginas legales (placeholder)
// Rutas privadas:
//   sin user → Landing (con login)
//   con user → Dashboard
export default function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [route, setRoute] = useState(() => parseRoute());

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Rutas públicas: NO esperan auth, se renderean al toque.
  if (route === "portal") return <Portal/>;
  if (route === "checkout") return <Checkout/>;
  if (route === "checkout-success") return <CheckoutSuccess/>;
  if (route === "terminos") return <LegalPage title="Términos y condiciones"/>;
  if (route === "privacidad") return <LegalPage title="Política de privacidad"/>;

  if (!authReady) {
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",color:"var(--text-sm)",fontSize:14}}>
        Cargando…
      </div>
    );
  }

  if (!user) return <Landing onLogin={() => {/* App detecta el user vía onAuthStateChanged */}}/>;
  return <Dashboard user={user} onLogout={() => signOut(auth)}/>;
}

// Placeholder legal: el contenido lo escribe el dueño.
function LegalPage({ title }) {
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",padding:"40px 20px"}}>
      <div style={{maxWidth:720,margin:"0 auto"}}>
        <a href="#/" style={{fontSize:12,color:"var(--accent)",textDecoration:"none"}}>← Volver a Recurrentes</a>
        <h1 style={{fontSize:26,fontWeight:800,margin:"18px 0 10px",letterSpacing:-0.5}}>{title}</h1>
        <p style={{fontSize:14,color:"var(--text-md)",lineHeight:1.6}}>En preparación.</p>
      </div>
    </div>
  );
}

// Devuelve el "nombre" de la ruta basado en el hash. Soporta:
//   #/portal?...     → "portal"
//   #/checkout-success?...   → "checkout-success"
//   cualquier otro   → "default"
function parseRoute() {
  const hash = window.location.hash || "";
  const path = hash.replace(/^#/, "").split("?")[0].replace(/^\//, "");
  if (path === "portal") return "portal";
  if (path === "checkout") return "checkout";
  if (path === "checkout-success") return "checkout-success";
  if (path === "terminos") return "terminos";
  if (path === "privacidad") return "privacidad";
  return "default";
}
