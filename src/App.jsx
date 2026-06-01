import React, { useState, useEffect } from "react";
import { auth, onAuthStateChanged } from "./lib/firebase.js";
import { signOut } from "firebase/auth";
import Landing from "./pages/Landing.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Portal from "./pages/Portal.jsx";
import CheckoutSuccess from "./pages/CheckoutSuccess.jsx";

// Routing simple hash-based.
// Rutas PÚBLICAS (ignoran si hay user logueado o no):
//   #/portal?token=...           → Portal del cliente final
//   #/checkout-success?sub=...   → Pantalla de gracias post-MP
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
  if (route === "checkout-success") return <CheckoutSuccess/>;

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

// Devuelve el "nombre" de la ruta basado en el hash. Soporta:
//   #/portal?...     → "portal"
//   #/checkout-success?...   → "checkout-success"
//   cualquier otro   → "default"
function parseRoute() {
  const hash = window.location.hash || "";
  const path = hash.replace(/^#/, "").split("?")[0].replace(/^\//, "");
  if (path === "portal") return "portal";
  if (path === "checkout-success") return "checkout-success";
  return "default";
}
