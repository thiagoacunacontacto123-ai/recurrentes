import React, { useState, useEffect } from "react";
import { sendPasswordResetEmail, signOut } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import * as api from "../lib/api.js";
import * as Dash from "./Dashboard.jsx";
import WidgetDesigner from "./WidgetDesigner.jsx";
import {
  BtnPrimary, BtnSecondary, BtnDanger, InputStyle,
  AsyncButton, appConfirm, appAlert, toast as uiToast,
} from "../ui/components.jsx";

const { apiGet, apiPost } = api;

// ─────────────────────────────────────────────────────────────────
// Configuración — pantalla estilo "settings": nav a la izquierda,
// una sección por vez. Portado del ConfigScreen de Growith.
//   cuenta    → email, contraseña, eliminar cuenta
//   tiendas   → tiendas del perfil (crear / renombrar / activar / eliminar)
//   equipo    → miembros con acceso por secciones (solo owner)
//   operacion → OperationalSettingsCard del Dashboard (si está exportado)
// ─────────────────────────────────────────────────────────────────

export const CFG_SECS = ["cuenta", "tiendas", "equipo", "widget", "operacion"];

export const TEAM_SECTIONS = [
  { id: "inicio",        label: "Inicio" },
  { id: "planes",        label: "Planes" },
  { id: "suscriptores",  label: "Suscriptores" },
  { id: "cobros",        label: "Cobros" },
  { id: "abandonados",   label: "Abandonados" },
  { id: "actividad",     label: "Actividad" },
  { id: "integraciones", label: "Integraciones" },
  { id: "configuracion", label: "Configuración" },
];

export const STORE_COLORS = ["#10b981", "#6366f1", "#0ea5e9", "#f97316", "#a855f7", "#ef4444", "#eab308", "#14b8a6"];

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
  if (Array.isArray(s)) return s.filter(id => TEAM_SECTIONS.some(t => t.id === id));
  if (s && typeof s === "object") return TEAM_SECTIONS.map(t => t.id).filter(id => s[id] === true);
  return [];
}

function readHashSec() {
  try {
    const h = (window.location.hash || "").replace(/^#\/?/, "").split("?")[0].split("/");
    if (h[0] === "config" && CFG_SECS.includes(h[1])) return h[1];
  } catch (_) {}
  return null;
}

export default function SettingsPage({ T: Tp, DS: DSp, user, merchant, workspace, reloadMerchant, toast: toastProp, goTab }) {
  const T = Tp || FALLBACK_T;
  const DS = DSp || FALLBACK_DS;
  const toast = toastProp || uiToast;
  const isOwner = (merchant?.role || "owner") === "owner";

  const [sec, setSec] = useState(() => readHashSec() || "cuenta");

  // Si la URL ya está en #/config/…, la mantenemos sincronizada (sin pisar otras rutas del shell).
  useEffect(() => {
    try {
      if ((window.location.hash || "").startsWith("#/config")) {
        window.history.replaceState(null, "", `${window.location.pathname}#/config/${sec}`);
      }
    } catch (_) {}
  }, [sec]);
  useEffect(() => {
    const onHash = () => { const s = readHashSec(); if (s && s !== sec) setSec(s); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [sec]);

  const NAVS = [
    { id: "cuenta",    l: "Cuenta",    d: "Email, contraseña y baja",   icon: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" },
    { id: "tiendas",   l: "Tiendas",   d: "Tus tiendas y cuál está activa", icon: "M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6" },
    ...(isOwner ? [{ id: "equipo", l: "Equipo", d: "Quién entra y qué ve", icon: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" }] : []),
    { id: "widget",    l: "Diseño del widget", d: "10 diseños del selector de packs, colores y textos", icon: "M4 4h16v16H4zM4 9h16M9 9v11" },
    { id: "operacion", l: "Operación", d: "Tienda, envíos, mails y abandono", icon: "M12 20a8 8 0 100-16 8 8 0 000 16zM12 14a2 2 0 100-4 2 2 0 000 4zM12 2v2M12 20v2M2 12h2M20 12h2" },
  ];
  const HEAD = {
    cuenta:    ["Cuenta", "Tu acceso a Recurrentes: email de inicio de sesión, contraseña y eliminación de la cuenta."],
    tiendas:   ["Tiendas", "Un mismo login puede manejar varias tiendas. Cada tienda tiene su propia conexión a Shopify y Mercado Pago, sus planes y sus suscriptores."],
    equipo:    ["Equipo", "Invitá a gente de tu equipo con su propio login. Ven solo las secciones que les habilites."],
    widget:    ["Diseño del widget", "Elegí cómo se ve el selector de packs en tu página de producto: 10 diseños con vista previa real, color, esquinas y textos. Los packs y precios se cargan en cada plan."],
    operacion: ["Operación", "Dominio de la tienda, envíos del checkout, códigos de descuento, remitente de mails, recupero de abandonados y modo desarrollador."],
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

          {cur === "cuenta"    && <CuentaSection T={T} DS={DS} user={user} merchant={merchant} toast={toast} />}
          {cur === "tiendas"   && <TiendasSection T={T} DS={DS} user={user} merchant={merchant} workspace={workspace} reloadMerchant={reloadMerchant} toast={toast} />}
          {cur === "equipo"    && isOwner && <MiembrosCuentaCard T={T} DS={DS} user={user} merchant={merchant} toast={toast} />}
          {cur === "widget"    && <WidgetSection merchant={merchant} reloadMerchant={reloadMerchant} />}
          {cur === "operacion" && <OperacionSection T={T} DS={DS} merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab} />}
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
            <button onClick={() => setShowEliminar(true)} style={{ ...BtnDanger(T), fontSize: DS.font.md, padding: "8px 12px" }}>Eliminar mi cuenta</button>
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
function TiendasSection({ T, DS, user, merchant, workspace, reloadMerchant, toast }) {
  const iS = InputStyle(T);
  const stores = Array.isArray(workspace?.stores) ? workspace.stores : [];
  const activeId = workspace?.active_merchant_id || merchant?.id || null;
  const [editing, setEditing] = useState(null);       // id de tienda en edición
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(STORE_COLORS[0]);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(STORE_COLORS[1]);
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

  function startEdit(store) {
    setEditing(store.id); setEditName(store.name || ""); setEditColor(store.color || STORE_COLORS[0]);
  }
  async function guardarEdit(store) {
    const name = editName.trim();
    if (!name) { toast("Poné un nombre", "warning"); return; }
    await merchantAction("store-rename", { merchant_id: store.id, name, color: editColor, photo: store.photo || null });
    setEditing(null);
    await reloadMerchant?.();
    toast("Tienda guardada ✓", "success");
  }

  async function crear() {
    const name = newName.trim();
    if (!name) { toast("Poné un nombre para la tienda", "warning"); return; }
    const d = await merchantAction("store-create", { name, color: newColor });
    const id = d?.store?.id || d?.merchant_id || d?.id || null;
    if (id) {
      try { await merchantAction("store-activate", { merchant_id: id }); } catch (_) {}
      try { api.setActiveMerchantId?.(user?.uid, id); } catch (_) {}
    }
    setShowCreate(false); setNewName("");
    await reloadMerchant?.();
    toast(`Tienda "${name}" creada. Conectá su Shopify y Mercado Pago desde Integraciones.`, "success", 6000);
  }

  async function eliminar(store) {
    if (store.is_primary) return;
    const ok = await appConfirm(
      `¿Eliminar la tienda "${store.name}"?\n\nSe borran sus planes, suscriptores, cobros y conexiones. Las suscripciones activas siguen en tu cuenta de Mercado Pago: pausalas antes si no querés que se sigan cobrando.`,
      { danger: true, okLabel: "Sí, eliminar tienda" },
    );
    if (!ok) return;
    setBusyId(store.id);
    try {
      await merchantAction("store-delete", { merchant_id: store.id });
      await reloadMerchant?.();
      toast("Tienda eliminada", "success");
    } catch (e) { toast("No se pudo eliminar: " + e.message, "error"); }
    setBusyId("");
  }

  const activa = stores.find(s => s.id === activeId);

  return (
    <>
      <Panel T={T} DS={DS} title="Tienda activa">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <StoreDot T={T} store={activa || { name: merchant?.name || merchant?.store_domain || "Mi tienda", color: STORE_COLORS[0] }} size={40} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ fontSize: 15, fontWeight: DS.w.bold, color: T.text }}>{activa?.name || merchant?.name || merchant?.store_domain || "Mi tienda"}</div>
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
        right={!showCreate && <button onClick={() => setShowCreate(true)} style={{ ...BtnSecondary(T), fontSize: DS.font.md, padding: "7px 14px" }}>+ Nueva tienda</button>}>
        {showCreate && (
          <div style={{ background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: DS.r.lg, padding: "12px 14px", marginBottom: 12 }}>
            <div style={{ fontSize: DS.font.md, fontWeight: DS.w.bold, color: T.text, marginBottom: 8 }}>Nueva tienda</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)} maxLength={60} placeholder='Ej. "Café del Sur"' style={{ ...iS, marginBottom: 0, flex: "1 1 220px" }} onKeyDown={e => { if (e.key === "Enter") crear(); }} />
              <ColorPicker T={T} value={newColor} onChange={setNewColor} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <AsyncButton onClick={crear} style={{ ...BtnPrimary(T), fontSize: DS.font.md, padding: "8px 16px" }}>Crear tienda</AsyncButton>
              <button onClick={() => setShowCreate(false)} style={{ ...BtnSecondary(T), fontSize: DS.font.md }}>Cancelar</button>
            </div>
          </div>
        )}

        {stores.length === 0 && (
          <div style={{ fontSize: DS.font.md, color: T.textSm }}>Todavía no cargamos la lista de tiendas de este perfil.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          {stores.map((s, i) => {
            const isActive = s.id === activeId;
            const isOwner = (s.role || "owner") === "owner";
            const enEdicion = editing === s.id;
            return (
              <div key={s.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, padding: "12px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <StoreDot T={T} store={s} size={34} />
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
                    {isOwner && !enEdicion && <button onClick={() => startEdit(s)} style={{ ...BtnSecondary(T), fontSize: DS.font.sm, padding: "5px 10px" }}>Editar</button>}
                    {isOwner && !s.is_primary && (
                      <button onClick={() => eliminar(s)} disabled={!!busyId} title="Eliminar tienda"
                        style={{ background: "transparent", border: "none", color: T.textSm, fontSize: 15, padding: "4px 6px", cursor: "pointer", lineHeight: 1, fontFamily: "inherit" }}
                        onMouseEnter={e => e.currentTarget.style.color = T.red} onMouseLeave={e => e.currentTarget.style.color = T.textSm}>✕</button>
                    )}
                  </div>
                </div>
                {enEdicion && (
                  <div style={{ marginTop: 10, background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: DS.r.lg, padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                      <input value={editName} onChange={e => setEditName(e.target.value)} maxLength={60} placeholder="Nombre de la tienda" style={{ ...iS, marginBottom: 0, flex: "1 1 220px" }} onKeyDown={e => { if (e.key === "Enter") guardarEdit(s); }} />
                      <ColorPicker T={T} value={editColor} onChange={setEditColor} />
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <AsyncButton onClick={() => guardarEdit(s)} style={{ ...BtnPrimary(T), fontSize: DS.font.md, padding: "7px 14px" }}>Guardar</AsyncButton>
                      <button onClick={() => setEditing(null)} style={{ ...BtnSecondary(T), fontSize: DS.font.md }}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 10, lineHeight: 1.5 }}>
          La tienda principal no se puede eliminar (para eso está "Eliminar mi cuenta" en Cuenta). Cada tienda nueva arranca vacía: conectá su Shopify y Mercado Pago desde Integraciones.
        </div>
      </Panel>
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
      right={!showForm && <button onClick={() => setShowForm(true)} style={{ ...BtnSecondary(T), fontSize: DS.font.md, padding: "7px 14px", flexShrink: 0 }}>+ Invitar</button>}>
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

      {data === null && <div style={{ fontSize: DS.font.md, color: T.textSm }}>Cargando…</div>}
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

// ─── Operación ───────────────────────────────────────────────────
function OperacionSection({ T, DS, merchant, reloadMerchant, goTab }) {
  // Si Dashboard.jsx exporta OperationalSettingsCard, lo rendereamos acá mismo.
  // Si no (hoy no está exportado), mandamos a Integraciones donde vive.
  const OpCard = Dash?.OperationalSettingsCard;
  if (typeof OpCard === "function") {
    return <OpCard merchant={merchant} onChange={reloadMerchant} />;
  }
  return (
    <Panel T={T} DS={DS} title="Configuración operativa">
      <div style={{ fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6, marginBottom: 14 }}>
        El dominio de tu tienda, los envíos del checkout, los códigos de descuento, el remitente de los mails, el recupero de carritos abandonados y el modo desarrollador se editan desde <strong style={{ color: T.text }}>Integraciones → Configuración operativa</strong>.
      </div>
      <button onClick={() => goTab?.("integraciones")} disabled={!goTab} style={{ ...BtnPrimary(T), fontSize: DS.font.md, opacity: goTab ? 1 : 0.6 }}>
        Ir a Integraciones → Configuración operativa
      </button>
    </Panel>
  );
}

// ─── Piezas chicas ───────────────────────────────────────────────
function Panel({ T, DS, title, sub, right, children, style = {} }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: DS.r.xl, padding: "18px 20px", marginBottom: 16, ...style }}>
      {(title || right) && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {title && <div style={{ fontSize: DS.font.sm, textTransform: "uppercase", color: T.textSm, fontWeight: DS.w.semibold, letterSpacing: 0.6 }}>{title}</div>}
            {sub && <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

function Pill({ T, color, children }) {
  return <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: color + "1a", color, border: `1px solid ${color}33`, whiteSpace: "nowrap" }}>{children}</span>;
}

function StoreDot({ T, store, size = 34 }) {
  const color = store?.color || STORE_COLORS[0];
  const inicial = (store?.name || "?").trim().charAt(0).toUpperCase();
  if (store?.photo) return <img src={store.photo} alt="" style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), objectFit: "cover", flexShrink: 0, border: `1px solid ${T.border}` }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.3), background: color + "22", color, border: `1px solid ${color}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: Math.round(size * 0.42), fontWeight: 800, flexShrink: 0 }}>{inicial}</div>
  );
}

function ColorPicker({ T, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {STORE_COLORS.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c} aria-label={`Color ${c}`}
          style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: value === c ? `3px solid ${T.text}` : `2px solid ${T.card}`, boxShadow: value === c ? `0 0 0 1px ${c}` : "none", cursor: "pointer", padding: 0 }} />
      ))}
    </div>
  );
}


// ─── Diseño del widget (galería de 10 variantes + personalización) ───
function WidgetSection({ merchant, reloadMerchant }) {
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    let alive = true;
    api.apiGet("plans").then(d => { if (alive) setPlans(Array.isArray(d?.plans) ? d.plans : (Array.isArray(d) ? d : [])); }).catch(() => { if (alive) setPlans([]); });
    return () => { alive = false; };
  }, [merchant?.id]);
  if (plans === null) return <div style={{ color: "var(--text-sm)", fontSize: 13 }}>Cargando…</div>;
  return <WidgetDesigner merchant={merchant} plans={plans} onSaved={reloadMerchant} />;
}
