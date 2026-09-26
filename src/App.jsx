import { AppLoader } from "./ui/components.jsx";
import React, { useState, useEffect } from "react";
import { auth, onAuthStateChanged } from "./lib/firebase.js";
import { signOut } from "firebase/auth";
import "./ui/globalStyles.js";
import { DARK, LIGHT, readStoredDark } from "./ui/theme.js";
import PublicSite from "./pages/Auth.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Portal from "./pages/Portal.jsx";
import CheckoutSuccess from "./pages/CheckoutSuccess.jsx";
import Checkout from "./pages/Checkout.jsx";
import LegalPage, { SoportePage } from "./pages/Legal.jsx";
import { TransferAcceptPage } from "./pages/Transfer.jsx";
import DemoPage from "./pages/Demo.jsx";

import { initPixel, pixelPageView } from "./lib/attribution.js";
// Routing simple hash-based.
// Rutas PÚBLICAS (ignoran si hay user logueado o no):
//   #/portal?token=...           → Portal del cliente final
//   #/checkout?...               → Checkout de suscripción
//   #/checkout-success?sub=...   → Pantalla de gracias post-MP
//   #/terminos · #/privacidad    → páginas legales
//   #/soporte                    → soporte público (lo pide la ficha de Tiendanube)
//   #/demo                       → pedir demo (puerta de entrada principal, 25-sept-2026)
// Rutas privadas:
//   sin user → PublicSite (Landing · #/login · #/registro · #/recuperar)
//   con user → Dashboard (#/dashboard/<tab>)
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
    initPixel(); // pixel de Meta de Recurrentes (solo con VITE_META_PIXEL_ID)
    const onHash = () => { setRoute(parseRoute()); pixelPageView(); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Rutas públicas: NO esperan auth, se renderean al toque.
  if (route === "portal") return <Portal/>;
  if (route === "checkout") return <Checkout/>;
  if (route === "checkout-success") return <CheckoutSuccess/>;
  if (route === "terminos") return <LegalPage kind="terminos" T={readStoredDark() ? DARK : LIGHT}/>;
  if (route === "privacidad") return <LegalPage kind="privacidad" T={readStoredDark() ? DARK : LIGHT}/>;
  if (route === "soporte") return <SoportePage T={readStoredDark() ? DARK : LIGHT}/>;
  // Pedir demo: anda con o sin sesión (no crea cuenta, junta el lead y avisa).
  if (route === "demo") return <DemoPage/>;
  // Aceptar una tienda transferida: anda con o sin sesión (maneja el login adentro).
  if (route === "transferir") return <TransferAcceptPage user={user} authReady={authReady}/>;

  if (!authReady) {
    return (
      <AppLoader/>
    );
  }

  if (!user) return <PublicSite/>;
  return <Dashboard user={user} onLogout={() => signOut(auth)}/>;
}

// Devuelve el "nombre" de la ruta basado en el hash.
function parseRoute() {
  const hash = window.location.hash || "";
  const path = hash.replace(/^#/, "").split("?")[0].replace(/^\//, "").split("/")[0];
  if (path === "portal") return "portal";
  if (path === "checkout") return "checkout";
  if (path === "checkout-success") return "checkout-success";
  if (path === "terminos") return "terminos";
  if (path === "privacidad") return "privacidad";
  if (path === "soporte") return "soporte";
  if (path === "transferir") return "transferir";
  if (path === "demo") return "demo";
  return "default";
}
