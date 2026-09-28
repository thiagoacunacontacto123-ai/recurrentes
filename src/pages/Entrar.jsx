// #/entrar?m=<tienda>&k=<clave> — login único (28-sept-2026). Es la "App URL" que se
// pega en la app privada de Shopify: desde el admin de Shopify, tocar Recurrentes abre
// el panel ya logueado. Canjea la clave por un token de Firebase y entra como el dueño.
import React, { useEffect, useState } from "react";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import { apiPost, setActiveMerchantId } from "../lib/api.js";
import { AppLoader } from "../ui/components.jsx";
import { useTheme } from "../ui/theme.js";

export default function EntrarPage() {
  const { T } = useTheme();
  const [err, setErr] = useState("");
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const q = new URLSearchParams((window.location.hash.split("?")[1] || window.location.search.slice(1)) || "");
        const m = q.get("m") || "", k = q.get("k") || "";
        if (!m || !k) throw new Error("Al link le falta la clave. Pedí uno nuevo desde Integraciones → Shopify.");
        const r = await apiPost("public", { m, k }, { action: "app-login" });
        if (!r || r.error || !r.token) throw new Error(r?.error || "No se pudo entrar.");
        const cred = await signInWithCustomToken(auth, r.token);
        try { setActiveMerchantId(cred.user.uid, r.merchant_id); } catch (_) {}
        // Sin la clave en la URL: que no quede en el historial del navegador.
        window.location.replace(window.location.pathname + "#/dashboard/analiticas");
      } catch (e) { if (vivo) setErr(e.message || "No se pudo entrar."); }
    })();
    return () => { vivo = false; };
  }, []);
  if (!err) return <AppLoader/>;
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: T.bg, color: T.text, fontFamily: "'Inter',system-ui,sans-serif", padding: 24 }}>
      <div style={{ maxWidth: 420, background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "24px 22px" }}>
        <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>No pudimos entrar</h1>
        <p style={{ fontSize: 14, color: T.textMd, lineHeight: 1.5, margin: "0 0 16px" }}>{err}</p>
        <a href="#/login" style={{ color: T.accent, fontWeight: 600, fontSize: 14 }}>Entrar con mail y contraseña</a>
      </div>
    </div>
  );
}
