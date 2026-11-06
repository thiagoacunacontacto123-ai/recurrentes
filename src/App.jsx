import { AppLoader } from "./ui/components.jsx";
import React, { useState, useEffect, Suspense } from "react";
import { auth, onAuthStateChanged } from "./lib/firebase.js";
import { signOut } from "firebase/auth";
import "./ui/globalStyles.js";
import { DARK, LIGHT, readStoredDark } from "./ui/theme.js";
import PublicSite from "./pages/Auth.jsx";
// El panel del comerciante va en su propio paquete: la landing (que entra por pauta y desde
// el celular) no tiene que bajar el Dashboard entero para mostrarse.
const Dashboard = React.lazy(() => import("./pages/Dashboard.jsx"));
// Cada página pública pesada en su propio paquete: la home carga solo lo suyo.
const Portal = React.lazy(() => import("./pages/Portal.jsx"));
const CheckoutSuccess = React.lazy(() => import("./pages/CheckoutSuccess.jsx"));
const Checkout = React.lazy(() => import("./pages/Checkout.jsx"));
const LegalPage = React.lazy(() => import("./pages/Legal.jsx"));
const SoportePage = React.lazy(() => import("./pages/Legal.jsx").then(m => ({ default: m.SoportePage })));
const TransferAcceptPage = React.lazy(() => import("./pages/Transfer.jsx").then(m => ({ default: m.TransferAcceptPage })));
const EntrarPage = React.lazy(() => import("./pages/Entrar.jsx"));

// Routing simple hash-based.
// Rutas PÚBLICAS (ignoran si hay user logueado o no):
//   #/portal?token=...           → Portal del cliente final
//   #/checkout?...               → Checkout de suscripción
//   #/checkout-success?sub=...   → Pantalla de gracias post-MP
//   #/terminos · #/privacidad    → páginas legales
//   #/soporte                    → soporte público (lo pide la ficha de Tiendanube)
// Rutas privadas:
//   sin user → PublicSite (#/login · #/recuperar). Landing y demo: fuera (6-nov-2026).
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
    // Sin captación no hay nada que medir (6-nov-2026): el pixel de Meta y la
    // etiqueta de Google Ads no se cargan más. El panel de un comercio no
    // tiene por qué avisarle a Meta que su dueño entró a trabajar.
    const onHash = () => { setRoute(parseRoute()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Rutas públicas: NO esperan auth, se renderean al toque.
  const L = (el) => <Suspense fallback={<AppLoader/>}>{el}</Suspense>;
  if (route === "portal") return L(<Portal/>);
  if (route === "checkout") return L(<Checkout/>);
  if (route === "checkout-success") return L(<CheckoutSuccess/>);
  if (route === "terminos") return L(<LegalPage kind="terminos" T={readStoredDark() ? DARK : LIGHT}/>);
  if (route === "privacidad") return L(<LegalPage kind="privacidad" T={readStoredDark() ? DARK : LIGHT}/>);
  if (route === "soporte") return L(<SoportePage T={readStoredDark() ? DARK : LIGHT}/>);
  // Login único desde la app de Shopify: canjea la clave del link y entra al panel.
  if (route === "entrar") return L(<EntrarPage/>);
  // Aceptar una tienda transferida: anda con o sin sesión (maneja el login adentro).
  if (route === "transferir") return L(<TransferAcceptPage user={user} authReady={authReady}/>);

  if (!authReady) {
    return (
      <AppLoader/>
    );
  }

  if (!user) return <PublicSite/>;
  return <Suspense fallback={<AppLoader/>}><Dashboard user={user} onLogout={() => signOut(auth)}/></Suspense>;
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
  if (path === "entrar") return "entrar";
  return "default";
}
