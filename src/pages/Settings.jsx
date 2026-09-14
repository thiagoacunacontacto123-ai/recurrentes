import React, { useState, useEffect } from "react";
import { sendPasswordResetEmail, signOut } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import * as api from "../lib/api.js";
import { NewStoreModal, ManageStoreModal, StoreAvatar } from "../ui/Shell.jsx";
import { IntegrationsTab } from "./Integrations.jsx";
import StoreSettings from "./StoreSettings.jsx";
import { PlanPage } from "./Billing.jsx";
import { AdvancedSettingsCard } from "./OperationalSettings.jsx";
import GuidePage from "./Guide.jsx";
import BusinessProfileSection from "./BusinessProfile.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";
import {
  BtnPrimary, BtnSecondary, BtnDanger, InputStyle,
  AsyncButton, appConfirm, appAlert, toast as uiToast,
  Card, SectionTitle, DSBadge, Loading, Btn,
} from "../ui/components.jsx";

const { apiGet, apiPost } = api;

// ─────────────────────────────────────────────────────────────────
// Configuración — nav a la izquierda, una sección por vez (#/config/<sec>).
//   cuenta        → email, contraseña, eliminar cuenta
//   negocio       → qué vende, dónde y con qué cobra (BusinessProfile.jsx)
//   tiendas       → tiendas del perfil (crear / gestionar / activar / eliminar)
//   equipo        → miembros con acceso por secciones (solo owner)
//   integraciones → tienda (según el negocio), Mercado Pago, Meta, Klaviyo (Integrations.jsx)
//   tienda        → datos de la tienda + envíos del checkout (StoreSettings.jsx)
//   facturacion   → tu plan de Recurrentes (Billing.jsx)
//   avanzado      → checkout del widget, códigos de descuento, modo dev (OperationalSettings.jsx)
//   ayuda         → Guía escrita (Guide.jsx) embebida
// ─────────────────────────────────────────────────────────────────

export const CFG_SECS = ["cuenta", "negocio", "tiendas", "equipo", "integraciones", "tienda", "facturacion", "avanzado", "ayuda"];
// Secciones viejas → nuevas (links guardados / plan de acción viejo).
const CFG_ALIASES = { operacion: "avanzado", widget: "__planes_widget__" };

export const TEAM_SECTIONS = [
  { id: "inicio",        label: "Inicio" },
  { id: "suscripciones", label: "Suscripciones" },
  { id: "cobros",        label: "Cobros" },
  { id: "planes",        label: "Planes" },
  { id: "retencion",     label: "Retención" },
  { id: "portal",        label: "Portal del cliente" },
  { id: "analiticas",    label: "Analíticas" },
  { id: "configuracion", label: "Configuración" },
];
// Permisos guardados con ids viejos → nuevos (mismo mapa que el backend).
const LEGACY_SEC = { suscriptores: "suscripciones", carritos: "suscripciones", abandonados: "suscripciones", actividad: "portal", integraciones: "configuracion", plan: "configuracion", guia: "configuracion" };

// Tema de respaldo si el shell todavía no pasa T (usa las CSS vars de index.css).
const FALLBACK_T = {
  isDark: true, bg: "var(--bg)", surface: "var(--surface)", card: "var(--card)",
  border: "var(--border)", borderL: "var(--border-light)", text: "var(--text)",
  textMd: "var(--text-md)", textSm: "var(--text-sm)", accent: "#10b981", accentSolid: "#10b981",
  green: "#10b981", greenBg: "rgba(16,185,129,0.12)", yellow: "#f59e0b", yellowBg: "rgba(245,158,11,0.12)",
  red: "#ef4444", redBg: "rgba(239,68,68,0.10)", blue: "#60a5fa", blueBg: "rgba(96,165,250,0.12)",
  input: "var(--surface)", inputBorder: "var(--border-light)",
};
const FALLBACK_DS = {
  sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, "3xl": 32 },
  r: { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 16, full: 9999 },
  font: { xs: 10, sm: 11, md: 12, base: 13, lg: 14, xl: 16, "2xl": 20, "3xl": 26 },
  w: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Llama a /api/merchant?action=<action> y tira si el backend devolvió error.
async function merchantAction(action, body = {}) {
  const d = await apiPost("merchant", body, { action });
  if (d?.error) throw new Error(typeof d.error === "string" ? d.error : "Error del servidor");
  return d;
}

// El backend puede devolver secciones como array ["inicio",…] o como objeto {inicio:true}.
// Normalizamos a array de ids para la UI; al guardar mandamos array.
function normSecs(s) {
  const ids = Array.isArray(s) ? s : (s && typeof s === "object" ? Object.keys(s).filter(k => s[k] === true) : []);
  return [...new Set(ids.map(id => LEGACY_SEC[id] || id))].filter(id => TEAM_SECTIONS.some(t => t.id === id));
}

function readHashSec() {
  try {
    const h = (window.location.hash || "").replace(/^#\/?/, "").split("?")[0].split("/");
    if (h[0] !== "config") return null;
    if (CFG_SECS.includes(h[1])) return h[1];
    if (CFG_ALIASES[h[1]]) return CFG_ALIASES[h[1]];
  } catch (_) {}
  return null;
}

export default function SettingsPage({ T: Tp, DS: DSp, user, merchant, workspace, reloadMerchant, toast: toastProp, goTab }) {
  const T = Tp || FALLBACK_T;
  const DS = DSp || FALLBACK_DS;
  const toast = toastProp || uiToast;
  const isOwner = (merchant?.role || "owner") === "owner";

  const [sec, setSec] = useState(() => { const s = readHashSec(); return s && s !== "__planes_widget__" ? s : "cuenta"; });

  // #/config/widget (viejo) → el diseño ahora vive en Planes → Widget.
  const goPlanesWidget = React.useCallback(() => {
    try { goTab?.("planes"); } catch (_) {}
    try { setTimeout(() => { window.location.hash = "#/dashboard/planes?sub=widget"; }, 0); } catch (_) {}
  }, [goTab]);
  useEffect(() => { if (readHashSec() === "__planes_widget__") goPlanesWidget(); /* eslint-disable-line */ }, []);

  // Si la URL ya está en #/config/…, la mantenemos sincronizada (sin pisar otras rutas del shell).
  useEffect(() => {
    try {
      if ((window.location.hash || "").startsWith("#/config")) {
        window.history.replaceState(null, "", `${window.location.pathname}#/config/${sec}`);
      }
    } catch (_) {}
  }, [sec]);
  useEffect(() => {
    const onHash = () => {
      const s = readHashSec();
      if (s === "__planes_widget__") return goPlanesWidget();
      if (s && s !== sec) setSec(s);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [sec, goPlanesWidget]);

  // Perfil del negocio: descripciones de las secciones según qué vende y dónde.
  const profile = merchantProfile(merchant);
  const withStore = profile.channel !== "none";
  const NAVS = [
    { id: "cuenta",        l: "Cuenta",        d: "Email, contraseña y baja",   icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" },
    { id: "negocio",       l: "Negocio",       d: profile.explicit ? `${profile.type.emoji} ${profile.type.short} · ${profile.channelInfo.label}` : "Qué vendés, dónde y cómo cobrás", icon: "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01" },
    { id: "tiendas",       l: "Tiendas",       d: "Tus tiendas y cuál está activa", icon: "M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6" },
    ...(isOwner ? [{ id: "equipo", l: "Equipo", d: "Quién entra y qué ve", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" }] : []),
    { id: "integraciones", l: "Integraciones", d: withStore ? `${profile.channelInfo.label}, ${profile.providerInfo.label}, Meta, Klaviyo` : `${profile.providerInfo.label}, Meta, Klaviyo`, icon: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" },
    { id: "tienda",        l: withStore ? "Tienda" : "Datos",        d: profile.caps.shipping ? (withStore ? "Datos de la tienda y envíos del checkout" : "Datos del negocio y envíos") : "Nombre y datos del negocio", icon: "M3 9l1-5h16l1 5M3 9h18v11H3zM3 9a3 3 0 006 0 3 3 0 006 0 3 3 0 006 0" },
    { id: "facturacion",   l: "Facturación",   d: "Tu plan de Recurrentes", icon: "M1 6a2 2 0 012-2h18a2 2 0 012 2v12a2 2 0 01-2 2H3a2 2 0 01-2-2zM1 10h22M5 15h4" },
    { id: "avanzado",      l: "Avanzado",      d: "Checkout, cupones y modo dev", icon: "M12 20a8 8 0 100-16 8 8 0 000 16zM12 14a2 2 0 100-4 2 2 0 000 4zM12 2v2M12 20v2M2 12h2M20 12h2" },
    { id: "ayuda",         l: "Ayuda",         d: "Guía paso a paso y soporte", icon: "M12 22a10 10 0 100-20 10 10 0 000 20zM9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01" },
  ];
  const HEAD = {
    cuenta:        ["Cuenta", "Tu acceso a Recurrentes: email de inicio de sesión, contraseña y eliminación de la cuenta."],
    negocio:       ["Negocio", "Qué vendés, dónde lo vendés y con qué cobrás. El panel, el onboarding y el checkout se adaptan a esto."],
    tiendas:       ["Tiendas", "Un mismo login puede manejar varias tiendas. Cada tienda tiene su propia conexión a Shopify y Mercado Pago, sus planes y sus suscriptores."],
    equipo:        ["Equipo", "Invitá a gente de tu equipo con su propio login. Ven solo las secciones que les habilites."],
    integraciones: ["Integraciones", withStore
      ? `Conectá tu ${profile.channelInfo.label} y tu ${profile.providerInfo.label} (necesarios) y, si querés, Meta Ads y Klaviyo.`
      : `Conectá tu ${profile.providerInfo.label} (necesario) y, si querés, Meta Ads y Klaviyo. Sin tienda online no hay nada más que conectar.`],
    tienda:        [withStore ? "Tienda" : "Datos", withStore
      ? "Nombre, dominio, moneda y mail salen de tu Shopify; la cuenta de cobro, de Mercado Pago. Y los envíos que el cliente elige al suscribirse."
      : `Nombre del negocio, dominio (opcional) y la cuenta de ${profile.providerInfo.label}.${profile.caps.shipping ? " Y los envíos que el cliente elige al suscribirse." : ""}`],
    facturacion:   ["Facturación", "Tu plan de Recurrentes: qué incluye, cuántos pedidos llevás este mes y cómo cambiarlo."],
    avanzado:      ["Avanzado", "Flujo del checkout del widget, selector CSS a ocultar, códigos de descuento y modo desarrollador."],
    ayuda:         ["Ayuda", "La guía completa de Recurrentes: conectar Shopify y Mercado Pago, crear planes con packs, pegar el snippet y probar. Y el WhatsApp de soporte."],
  };
  const H = HEAD[sec] || ["", ""];
  const cur = NAVS.some(n => n.id === sec) ? sec : "cuenta";

  return (
    <div style={{ fontFamily: "inherit", color: T.text }}>
      <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "210px minmax(0,1fr)", gap: 28, alignItems: "start" }}>
        {/* Navegación lateral */}
        <nav style={{ position: "sticky", top: 16, display: "flex", flexDirection: "column", gap: 2 }}>
          {NAVS.map(n => {
            const act = cur === n.id;
            return (
              <button key={n.id} onClick={() => { setSec(n.id); try { window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) {} }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: DS.r.lg, border: "none", textAlign: "left", cursor: "pointer", width: "100%",
                  background: act ? T.accentSolid + "18" : "transparent", color: act ? T.accent : T.textMd, fontFamily: "inherit", transition: "background .12s" }}
                onMouseEnter={e => { if (!act) e.currentTarget.style.background = T.card; }}
                onMouseLeave={e => { if (!act) e.currentTarget.style.background = "transparent"; }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={act ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: act ? 1 : 0.7 }}><path d={n.icon} /></svg>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: DS.font.base, fontWeight: act ? DS.w.bold : DS.w.semibold, lineHeight: 1.2 }}>{n.l}</span>
                  <span style={{ display: "block", fontSize: 10.5, color: T.textSm, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.d}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div style={{ minWidth: 0 }}>
          <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: `1px solid ${T.borderL}` }}>
            <div style={{ fontSize: DS.font["2xl"], fontWeight: DS.w.black, color: T.text, letterSpacing: -0.4 }}>{H[0]}</div>
            <div style={{ fontSize: 12.5, color: T.textSm, marginTop: 4, lineHeight: 1.5 }}>{H[1]}</div>
          </div>

          {cur === "cuenta"        && <CuentaSection T={T} DS={DS} user={user} merchant={merchant} toast={toast} />}
          {cur === "negocio"       && <BusinessProfileSection merchant={merchant} onChange={reloadMerchant} />}
          {cur === "tiendas"       && <TiendasSection T={T} DS={DS} user={user} merchant={merchant} workspace={workspace} reloadMerchant={reloadMerchant} toast={toast} />}
          {cur === "equipo"        && isOwner && <MiembrosCuentaCard T={T} DS={DS} user={user} merchant={merchant} toast={toast} />}
          {cur === "integraciones" && <IntegrationsTab merchant={merchant} onChange={reloadMerchant} embedded />}
          {cur === "tienda"        && <StoreSettings merchant={merchant} onChange={reloadMerchant} />}
          {cur === "facturacion"   && <PlanPage T={T} DS={DS} merchant={merchant} reloadMerchant={reloadMerchant} />}
          {cur === "avanzado"      && <AdvancedSettingsCard merchant={merchant} onChange={reloadMerchant} />}
          {cur === "ayuda"         && <GuidePage merchant={merchant} goTab={goTab} embedded />}
        </div>
      </div>
    </div>
  );
}

// ─── Cuenta ──────────────────────────────────────────────────────
function CuentaSection({ T, DS, user, merchant, toast }) {
  const iS = InputStyle(T);
  const email = user?.email || merchant?.email || "";
  const hasPassword = !!user?.providerData?.some(p => p.providerId === "password");
  const googleOnly  = !!user?.providerData?.some(p => p.providerId === "google.com") && !hasPassword;
  const [showEliminar, setShowEliminar] = useState(false);
  const [confirmTxt, setConfirmTxt] = useState("");
  const [eliminando, setEliminando] = useState(false);

  async function cambiarPassword() {
    if (!email) throw new Error("No encontramos tu email");
    await sendPasswordResetEmail(auth, email);
    toast(`Te mandamos un mail a ${email} con el link para cambiar la contraseña`, "success", 6000);
  }

  async function eliminarCuenta() {
    if (confirmTxt !== "ELIMINAR") return;
    setEliminando(true);
    try {
      await merchantAction("account-delete", { confirm: "ELIMINAR" });
      try { await signOut(auth); } catch (_) {}
      appAlert("Tu cuenta fue eliminada. Los datos quedan ocultos 30 días y después se borran definitivamente.");
      setTimeout(() => { window.location.hash = ""; window.location.reload(); }, 600);
    } catch (e) {
      appAlert("No se pudo eliminar: " + e.message);
      setEliminando(false);
    }
  }

  return (
    <>
      <Panel T={T} DS={DS} title="Acceso">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          {user?.photoURL
            ? <img src={user.photoURL} alt="" style={{ width: 44, height: 44, borderRadius: "50%", border: `2px solid ${T.border}`, flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: "50%", background: T.accentSolid + "22", color: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>{(email || "?").charAt(0).toUpperCase()}</div>}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: DS.w.bold, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user?.displayName || email}</div>
            <div style={{ fontSize: DS.font.md, color: T.textSm, marginTop: 2 }}>
              {email}{googleOnly ? " · entrás con Google" : hasPassword ? " · email y contraseña" : ""}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {googleOnly ? (
            <div style={{ fontSize: DS.font.sm, color: T.textSm, lineHeight: 1.5 }}>Entrás con tu cuenta de Google, así que la contraseña la manejás desde Google.</div>
          ) : (
            <AsyncButton onClick={cambiarPassword} style={{ ...BtnSecondary(T), fontSize: DS.font.md }}>Cambiar contraseña por mail</AsyncButton>
          )}
          <button onClick={() => signOut(auth)} style={{ ...BtnSecondary(T), fontSize: DS.font.md, color: T.red, border: `1px solid ${T.red}33` }}>Cerrar sesión</button>
        </div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 12, lineHeight: 1.5 }}>
          El tema claro/oscuro se cambia desde el menú lateral.
        </div>
      </Panel>

      <Panel T={T} DS={DS} title="Zona peligrosa" style={{ borderColor: T.red + "44" }}>
        {!showEliminar ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 220, fontSize: DS.font.md, color: T.textMd, lineHeight: 1.5 }}>
              Elimina tu login y <strong style={{ color: T.text }}>todas tus tiendas</strong>: planes, suscriptores, historial de cobros y las conexiones a Shopify y Mercado Pago. Las suscripciones ya activas siguen cobrándose en tu cuenta de MP; pausalas antes si no querés eso.
            </div>
            <Btn T={T} variant="danger" onClick={() => setShowEliminar(true)}>Eliminar mi cuenta</Btn>
          </div>
        ) : (
          <div style={{ background: T.red + "10", border: `1px solid ${T.red}33`, borderRadius: DS.r.lg, padding: "12px 14px" }}>
            <div style={{ fontSize: DS.font.md, fontWeight: DS.w.bold, color: T.text, marginBottom: 4 }}>Eliminar mi cuenta y todas mis tiendas</div>
            <div style={{ fontSize: DS.font.sm, color: T.textMd, marginBottom: 8, lineHeight: 1.5 }}>
              Tus datos quedan ocultos 30 días (por si te arrepentís, escribinos) y después se borran <strong>definitivamente</strong>. Escribí <strong>ELIMINAR</strong> para confirmar.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <input value={confirmTxt} onChange={e => setConfirmTxt(e.target.value)} placeholder="ELIMINAR" style={{ ...iS, marginBottom: 0, flex: "0 1 160px", fontFamily: "monospace" }} />
              <button onClick={eliminarCuenta} disabled={eliminando || confirmTxt !== "ELIMINAR"} style={{ ...BtnDanger(T), fontSize: DS.font.md, padding: "8px 14px", background: T.red, color: "#fff", opacity: (eliminando || confirmTxt !== "ELIMINAR") ? 0.6 : 1 }}>{eliminando ? "Eliminando…" : "Eliminar definitivamente"}</button>
              <button onClick={() => { setShowEliminar(false); setConfirmTxt(""); }} disabled={eliminando} style={{ ...BtnSecondary(T), fontSize: DS.font.md, padding: "8px 12px" }}>Cancelar</button>
            </div>
          </div>
        )}
      </Panel>
    </>
  );
}

// ─── Tiendas ─────────────────────────────────────────────────────
// Un solo formulario de nombre/color/foto: el ManageStoreModal del shell
// (misma paleta que el switcher). Crear → NewStoreModal del shell.
function TiendasSection({ T, DS, user, merchant, workspace, reloadMerchant, toast }) {
  const iS = InputStyle(T);
  const stores = Array.isArray(workspace?.stores) ? workspace.stores : [];
  const activeId = workspace?.active_merchant_id || merchant?.id || null;
  const [manageId, setManageId] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState("");

  async function activar(store) {
    if (store.id === activeId) return;
    setBusyId(store.id);
    try {
      await merchantAction("store-activate", { merchant_id: store.id });
      try { api.setActiveMerchantId?.(user?.uid, store.id); } catch (_) {}
      await reloadMerchant?.();
      toast(`Ahora estás en ${store.name || "la tienda"}`, "success");
    } catch (e) { toast("No se pudo cambiar de tienda: " + e.message, "error"); }
    setBusyId("");
  }

  // onSave del ManageStoreModal: { ...store, name, color, photo? } → true si guardó.
  async function guardar(store) {
    try {
      await merchantAction("store-rename", { merchant_id: store.id, name: store.name, color: store.color, ...(store.photo !== undefined ? { photo: store.photo } : {}) });
      await reloadMerchant?.();
      toast("Tienda guardada ✓", "success");
      return true;
    } catch (e) { toast("No se pudo guardar: " + e.message, "error"); return false; }
  }
  // onDelete del ManageStoreModal (ya confirmó adentro).
  async function eliminar(id) {
    try {
      await merchantAction("store-delete", { merchant_id: id });
      toast("Tienda eliminada", "success");
      if (id === activeId) { try { api.setActiveMerchantId?.(user?.uid, null); } catch (_) {} setTimeout(() => window.location.reload(), 300); }
      else await reloadMerchant?.();
      return true;
    } catch (e) { toast("No se pudo eliminar: " + e.message, "error"); return false; }
  }
  // onCreate del NewStoreModal: { name, color } → true si creó (entra a la nueva).
  async function crear({ name, color }) {
    try {
      const d = await merchantAction("store-create", { name, color });
      const id = d?.store?.id || d?.merchant_id || d?.id || null;
      if (id) {
        try { await merchantAction("store-activate", { merchant_id: id }); } catch (_) {}
        try { api.setActiveMerchantId?.(user?.uid, id); } catch (_) {}
      }
      await reloadMerchant?.();
      toast(`Tienda "${name}" creada. Conectá su Shopify y Mercado Pago desde Configuración → Integraciones.`, "success", 6000);
      return true;
    } catch (e) { toast("No se pudo crear: " + e.message, "error"); return false; }
  }

  const activa = stores.find(s => s.id === activeId);
  const manageStore = manageId ? stores.find(s => s.id === manageId) : null;

  return (
    <>
      <Panel T={T} DS={DS} title="Tienda activa">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <StoreAvatar T={T} store={activa || { name: merchant?.store_name || merchant?.store_domain || "Mi tienda", color: merchant?.store_color }} size={40} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: DS.w.bold, color: T.text }}>{activa?.name || merchant?.store_name || merchant?.store_domain || "Mi tienda"}</div>
            <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 2 }}>
              {activa?.shopify_shop || merchant?.shopify_shop || "Shopify sin conectar"} · {(activa?.mp_connected ?? !!merchant?.mp_access_token) ? "Mercado Pago conectado" : "Mercado Pago sin conectar"}
            </div>
          </div>
          {stores.length > 1 && (
            <select value={activeId || ""} onChange={e => { const s = stores.find(x => x.id === e.target.value); if (s) activar(s); }} disabled={!!busyId}
              style={{ ...iS, width: "auto", minWidth: 180, marginBottom: 0, fontSize: DS.font.md }}>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
            </select>
          )}
        </div>
      </Panel>

      <Panel T={T} DS={DS} title={`Tus tiendas · ${stores.length || 1}`}
        right={<Btn T={T} variant="secondary" size="sm" onClick={() => setShowCreate(true)}>+ Nueva tienda</Btn>}>
        {stores.length === 0 && (
          <div style={{ fontSize: DS.font.md, color: T.textSm }}>Todavía no cargamos la lista de tiendas de este perfil.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          {stores.map((s, i) => {
            const isActive = s.id === activeId;
            const isOwner = (s.role || "owner") === "owner";
            return (
              <div key={s.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, padding: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <StoreAvatar T={T} store={s} size={34} />
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: DS.font.base, fontWeight: DS.w.bold, color: T.text }}>{s.name || "Sin nombre"}</span>
                      {s.is_primary && <Pill T={T} color={T.accent}>Principal</Pill>}
                      {isActive && <Pill T={T} color={T.green}>Activa</Pill>}
                      <Pill T={T} color={T.textSm}>{isOwner ? "Dueño" : "Miembro"}</Pill>
                    </div>
                    <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 2 }}>
                      {s.shopify_shop || "Shopify sin conectar"} · {s.mp_connected ? "MP conectado" : "MP sin conectar"}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    {!isActive && <button onClick={() => activar(s)} disabled={!!busyId} style={{ ...BtnSecondary(T), fontSize: DS.font.sm, padding: "5px 10px" }}>{busyId === s.id ? "…" : "Activar"}</button>}
                    {isOwner && <button onClick={() => setManageId(s.id)} style={{ ...BtnSecondary(T), fontSize: DS.font.sm, padding: "5px 10px" }}>Gestionar</button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 10, lineHeight: 1.5 }}>
          Nombre, color y foto se editan desde "Gestionar" (lo mismo que ves en el selector del menú). Cada tienda nueva arranca vacía: conectá su Shopify y Mercado Pago desde Configuración → Integraciones.
        </div>
      </Panel>

      {showCreate && <NewStoreModal T={T} onClose={() => setShowCreate(false)} onCreate={crear} />}
      {manageStore && <ManageStoreModal T={T} store={manageStore} totalStores={stores.length || 1} onClose={() => setManageId(null)} onSave={guardar} onDelete={manageStore.is_primary && stores.length <= 1 ? null : eliminar} />}
    </>
  );
}

// ─── Equipo (portado de MiembrosCuentaCard de Growith) ──────────
export function MiembrosCuentaCard({ T: Tp, DS: DSp, user, merchant, toast: toastProp }) {
  const T = Tp || FALLBACK_T;
  const DS = DSp || FALLBACK_DS;
  const toast = toastProp || uiToast;
  const iS = InputStyle(T);
  const [data, setData] = useState(null); // {members, invites}
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [secs, setSecs] = useState(() => ["inicio", "suscriptores", "cobros"]);
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null); // key del miembro en edición

  async function cargar() {
    try {
      const d = await apiGet("merchant", { action: "members" });
      if (d?.error) throw new Error(d.error);
      setData({ members: d.members || [], invites: d.invites || [] });
    } catch (_) { setData({ members: [], invites: [] }); }
  }
  useEffect(() => { cargar(); /* eslint-disable-line */ }, [merchant?.id]);

  async function invitar() {
    const em = email.trim().toLowerCase();
    if (!EMAIL_RE.test(em)) { toast("Poné un email válido", "warning"); return; }
    if (!secs.length) { toast("Tildá al menos una sección", "warning"); return; }
    if (em === (user?.email || "").toLowerCase()) { toast("Ese es tu propio email", "warning"); return; }
    try {
      const r = await merchantAction("member-invite", { email: em, name: nombre.trim(), secciones: secs });
      toast(r?.mail === "enviado"
        ? `Le mandamos un mail a ${em} para que cree su cuenta. Cuando entre con ese mail, ve tu tienda con las secciones tildadas.`
        : `Invitación creada: cuando ${em} entre a Recurrentes con ese mail, ve tu tienda con las secciones tildadas.`, "success", 7000);
      setEmail(""); setNombre(""); setShowForm(false); cargar();
    } catch (e) { toast("No se pudo invitar: " + e.message, "warning"); }
  }
  async function toggleSecMiembro(m, secId) {
    const actuales = normSecs(m.secciones);
    const nuevas = actuales.includes(secId) ? actuales.filter(s => s !== secId) : [...actuales, secId];
    try { await merchantAction("member-update", { member_uid: m.uid, secciones: nuevas }); cargar(); }
    catch (e) { toast("No se pudo actualizar: " + e.message, "warning"); }
  }
  async function quitar(m) {
    const ok = await appConfirm(`¿Quitarle el acceso a ${m.name || m.email}? Deja de ver tu tienda al instante.`, { okLabel: "Quitar acceso", danger: true });
    if (!ok) return;
    try { await merchantAction("member-remove", m.uid ? { member_uid: m.uid } : { email: m.email }); cargar(); }
    catch (e) { toast("No se pudo quitar: " + e.message, "warning"); }
  }

  const Chip = ({ on, label, onClick }) => (
    <button onClick={onClick}
      style={{ padding: "4px 10px", fontSize: DS.font.sm, fontWeight: DS.w.semibold, borderRadius: 99, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${on ? T.accentSolid : T.border}`, background: on ? T.accentSolid + "22" : "transparent", color: on ? T.accent : T.textSm, transition: "all 0.12s" }}>
      {label}
    </button>
  );
  const lista = [
    ...(data?.members || []).map(m => ({ ...m, _estado: "activo" })),
    ...(data?.invites || []).map(i => ({ ...i, _estado: "pendiente" })),
  ];
  const secsTexto = (s) => { const on = normSecs(s).map(id => TEAM_SECTIONS.find(t => t.id === id)?.label).filter(Boolean); return on.length ? on.join(" · ") : "Sin secciones"; };
  const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#f97316", "#10b981", "#a855f7", "#ef4444"];

  return (
    <Panel T={T} DS={DS} title="Miembros con cuenta"
      sub="Entran con su propio login y ven solo las secciones que les habilites. No pueden invitar a otros ni eliminar la tienda."
      right={!showForm && <Btn T={T} variant="secondary" size="sm" onClick={() => setShowForm(true)}>+ Invitar</Btn>}>
      {showForm && (
        <div style={{ marginBottom: 12, background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: DS.r.lg, padding: "12px 14px" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            <input style={{ ...iS, marginBottom: 0, width: 160 }} placeholder="Nombre" value={nombre} onChange={e => setNombre(e.target.value)} />
            <input style={{ ...iS, marginBottom: 0, flex: 1, minWidth: 180 }} type="email" placeholder="email@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === "Enter") invitar(); }} />
          </div>
          <div style={{ fontSize: DS.font.sm, color: T.textSm, marginBottom: 6 }}>Secciones que va a ver:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            {TEAM_SECTIONS.map(s => <Chip key={s.id} on={secs.includes(s.id)} label={s.label} onClick={() => setSecs(p => p.includes(s.id) ? p.filter(x => x !== s.id) : [...p, s.id])} />)}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <AsyncButton onClick={invitar} style={{ ...BtnPrimary(T), fontSize: DS.font.md, padding: "8px 16px" }}>Enviar invitación</AsyncButton>
            <button onClick={() => setShowForm(false)} style={{ background: "transparent", border: "none", color: T.textSm, fontSize: DS.font.md, padding: "8px 12px", cursor: "pointer", fontFamily: "inherit", fontWeight: DS.w.semibold }}>Cancelar</button>
          </div>
        </div>
      )}

      {data === null && <Loading T={T}/>}
      {data !== null && lista.length === 0 && (
        <div style={{ fontSize: DS.font.md, color: T.textSm, lineHeight: 1.5 }}>Todavía no invitaste a nadie. Sumá a quien atienda suscriptores o cobros y dale acceso solo a eso.</div>
      )}

      {lista.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {lista.map((m, i) => {
            const key = (m.uid || m.email) + "_" + i;
            const inicial = (m.name || m.email || "?").trim().charAt(0).toUpperCase();
            const enEdicion = editando === key && m._estado === "activo";
            const col = AVATAR_COLORS[i % AVATAR_COLORS.length];
            return (
              <div key={key} style={{ borderTop: `1px solid ${T.borderL}`, padding: "10px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: "50%", background: col + "22", color: col, display: "flex", alignItems: "center", justifyContent: "center", fontSize: DS.font.base, fontWeight: DS.w.bold, flexShrink: 0 }}>{inicial}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: DS.font.base, fontWeight: DS.w.bold, color: T.text }}>{m.name || m.email}</span>
                      {m.name && <span style={{ fontSize: DS.font.sm, color: T.textSm, overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</span>}
                      {m._estado === "pendiente" && <span style={{ fontSize: DS.font.xs, fontWeight: DS.w.bold, padding: "1px 7px", borderRadius: 99, background: T.yellowBg, color: T.yellow, flexShrink: 0 }}>Pendiente</span>}
                    </div>
                    {!enEdicion && <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{secsTexto(m.secciones)}</div>}
                  </div>
                  {m._estado === "activo" && (
                    <button onClick={() => setEditando(enEdicion ? null : key)} style={{ background: "transparent", border: `1px solid ${T.border}`, color: enEdicion ? T.accent : T.textMd, borderRadius: DS.r.sm, padding: "4px 10px", fontSize: DS.font.sm, fontWeight: DS.w.semibold, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>{enEdicion ? "Listo" : "Editar"}</button>
                  )}
                  <button onClick={() => quitar(m)} title="Quitar acceso"
                    style={{ background: "transparent", border: "none", color: T.textSm, borderRadius: DS.r.sm, padding: "4px 6px", fontSize: 14, cursor: "pointer", fontFamily: "inherit", flexShrink: 0, lineHeight: 1 }}
                    onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.textSm}>✕</button>
                </div>
                {enEdicion && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, paddingLeft: 40 }}>
                    {TEAM_SECTIONS.map(s => <Chip key={s.id} on={normSecs(m.secciones).includes(s.id)} label={s.label} onClick={() => toggleSecMiembro(m, s.id)} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

// ─── Piezas chicas ───────────────────────────────────────────────
function Panel({ T, DS, title, sub, right, children, style = {} }) {
  return (
    <Card T={T} style={{ marginBottom: 16, ...style }}>
      {(title || right) && <SectionTitle T={T} sub={sub} right={right}>{title}</SectionTitle>}
      {children}
    </Card>
  );
}

function Pill({ T, color, children }) {
  return <DSBadge T={T} color={color} size="sm">{children}</DSBadge>;
}
