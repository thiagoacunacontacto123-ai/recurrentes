// Transferir una tienda a OTRA cuenta (backend: api/_lib/transfer.js).
//   TransferStoreModal     → Configuración → Tiendas: el dueño la inicia.
//   PendingTransferNote    → aviso "transferencia pendiente" + Cancelar en la fila de la tienda.
//   TransferAcceptPage     → #/transferir?t=<token>: la cuenta destino acepta o rechaza
//                            (anda con o sin sesión; el login se hace acá mismo).
//   StoreTransferredScreen → el login cuya tienda principal fue transferida (sin tienda).
import React, { useState, useEffect, useCallback } from "react";
import { signOut, sendEmailVerification } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import { apiGet, apiPost, setActiveMerchantId } from "../lib/api.js";
import { useTheme, useT, DS } from "../ui/theme.js";
import { Modal, Btn, InputStyle, Callout, CheckLine, Spinner, toast as uiToast } from "../ui/components.jsx";
import { RecLogo, NewStoreModal, StoreAvatar } from "../ui/Shell.jsx";
import { AuthScreen } from "./Auth.jsx";

const F = "'Inter',system-ui,sans-serif";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const fmtDay = (iso) => {
  try { return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long" }); } catch (_) { return ""; }
};
async function post(action, body) {
  const d = await apiPost("merchant", body, { action });
  if (d?.error) throw Object.assign(new Error(typeof d.error === "string" ? d.error : "Error del servidor"), { code: d.code });
  return d;
}

// ─── Modal: iniciar la transferencia ─────────────────────────────────────
export function TransferStoreModal({ T, store, onClose, onDone }) {
  const iS = InputStyle(T);
  const [email, setEmail] = useState("");
  const [keep, setKeep] = useState(null); // true = sigo como miembro · false = pierdo el acceso
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [link, setLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const name = store?.name || "esta tienda";
  const valid = EMAIL_RE.test(email.trim()) && keep !== null && ok;

  async function enviar() {
    if (!valid || busy) return;
    setBusy(true); setErr("");
    try {
      const em = email.trim().toLowerCase();
      const d = await post("transfer-start", { merchant_id: store.id, email: em, keep_access: keep === true });
      onDone?.();
      if (d.mail === "enviado") {
        uiToast(`Le mandamos un mail a ${em}. Tiene 7 días para aceptar.`, "success", 7000);
        onClose();
        return;
      }
      setLink(d.accept_url || "");
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  async function copiar() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (_) {}
  }

  const Option = ({ value, title, desc }) => {
    const on = keep === value;
    return (
      <button type="button" onClick={() => setKeep(value)}
        style={{ flex: "1 1 200px", textAlign: "left", cursor: "pointer", fontFamily: F, padding: "10px 12px", borderRadius: DS.r.lg,
          border: `1.5px solid ${on ? T.accentSolid : T.border}`, background: on ? T.accentSolid + "14" : "transparent", color: T.text }}>
        <div style={{ fontSize: DS.font.base, fontWeight: DS.w.bold, color: on ? T.accent : T.text }}>{on ? "● " : "○ "}{title}</div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 3, lineHeight: 1.45 }}>{desc}</div>
      </button>
    );
  };

  if (link !== null) {
    return (
      <Modal T={T} open onClose={onClose} title="Transferencia creada" subtitle={name}
        footer={<Btn T={T} onClick={onClose}>Listo</Btn>}>
        <Callout T={T} tone="warning" title="No pudimos mandar el mail">
          Pasale este link a la otra persona (por WhatsApp, por ejemplo). Para aceptar tiene que entrar con <b>{email.trim().toLowerCase()}</b>. Vence en 7 días.
        </Callout>
        <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <input readOnly value={link} onFocus={e => e.target.select()} style={{ ...iS, flex: 1, minWidth: 200, fontFamily: "monospace", fontSize: 12 }} />
          <Btn T={T} variant="secondary" onClick={copiar}>{copied ? "Copiado ✓" : "Copiar"}</Btn>
        </div>
      </Modal>
    );
  }

  return (
    <Modal T={T} open onClose={busy ? () => {} : onClose} title={`Transferir ${name} a otra cuenta`} subtitle="La tienda pasa a otra persona, con otro email."
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Btn>
        <Btn T={T} onClick={enviar} disabled={!valid || busy}>{busy ? <><Spinner size={12} color={T.accent} /> Enviando…</> : "Enviar transferencia"}</Btn>
      </>}>
      <div style={{ fontSize: 12, fontWeight: 600, color: T.textMd, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 }}>Email de la cuenta que la recibe</div>
      <input autoFocus type="email" placeholder="email@ejemplo.com" value={email} onChange={e => setEmail(e.target.value)} style={{ ...iS, marginBottom: 6 }} />
      <div style={{ fontSize: DS.font.sm, color: T.textSm, marginBottom: 16, lineHeight: 1.5 }}>Le mandamos un mail con un link. Si no tiene cuenta en Recurrentes, la crea con ese mismo email.</div>

      <div style={{ fontSize: 12, fontWeight: 600, color: T.textMd, marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>¿Y vos, qué hacés después?</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Option value={true} title="Sigo en el equipo" desc="Quedo como miembro, con acceso a todas las secciones. La otra persona me puede sacar cuando quiera." />
        <Option value={false} title="Pierdo el acceso" desc="Dejo de ver la tienda apenas la acepte." />
      </div>

      <Callout T={T} tone="info" title="Qué pasa cuando la acepte" style={{ marginBottom: 12 }}>
        <ul style={{ margin: "4px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
          <li>La tienda pasa a ser suya con todo: planes, suscriptores, cobros, historial y el plan de Recurrentes.</li>
          <li>Tus suscriptores no notan nada: el widget y los cobros siguen funcionando igual.</li>
          <li>Las conexiones con la tienda online y la pasarela quedan como están. <b>Si la pasarela conectada es tuya, la plata de los cobros sigue entrando a tu cuenta</b> hasta que la otra persona conecte el suyo.</li>
          <li>El resto del equipo sigue igual.</li>
          <li>Tiene 7 días para aceptar. Hasta entonces la podés cancelar.</li>
        </ul>
      </Callout>
      {store?.is_primary && (
        <Callout T={T} tone="warning" title="Es tu tienda principal" style={{ marginBottom: 12 }}>
          Tu login sigue existiendo, pero se queda sin esta tienda{keep === true ? " (la vas a ver como miembro del equipo)" : ""}. Vas a poder crear otra tienda cuando quieras.
        </Callout>
      )}
      <CheckLine T={T} checked={ok} onChange={setOk}>Entiendo que {name} deja de ser mía cuando la otra persona acepte.</CheckLine>
      {err && <div style={{ marginTop: 12, background: T.redBg, border: `1px solid ${T.red}55`, borderRadius: 8, padding: "9px 12px", fontSize: DS.font.md, color: T.red }}>{err}</div>}
    </Modal>
  );
}

// ─── Aviso de transferencia pendiente (fila de la tienda) ────────────────
export function PendingTransferNote({ T, store, onChange }) {
  const p = store?.transfer_pending;
  const [busy, setBusy] = useState(false);
  if (!p) return null;
  async function cancelar() {
    setBusy(true);
    try { await post("transfer-cancel", { merchant_id: store.id }); uiToast("Transferencia cancelada. La tienda sigue siendo tuya.", "success"); await onChange?.(); }
    catch (e) { uiToast("No se pudo cancelar: " + e.message, "error"); }
    setBusy(false);
  }
  const txt = p.expired
    ? `La transferencia a ${p.to_email} venció sin respuesta. La tienda sigue siendo tuya.`
    : `Transferencia pendiente a ${p.to_email}: tiene hasta el ${fmtDay(p.expires_at)} para aceptarla. ${p.keep_access ? "Vos quedás como miembro." : "Vos perdés el acceso."}`;
  return (
    <Callout T={T} tone={p.expired ? "warning" : "info"} style={{ marginTop: 10 }}
      right={store.can_transfer !== false && <Btn T={T} variant="secondary" size="sm" onClick={cancelar} disabled={busy}>{busy ? "…" : p.expired ? "Quitar aviso" : "Cancelar"}</Btn>}>
      {txt}
    </Callout>
  );
}

// ─── #/transferir?t=<token> ─────────────────────────────────────────────
function readToken() {
  try { return new URLSearchParams((window.location.hash || "").split("?")[1] || "").get("t") || ""; } catch (_) { return ""; }
}

const STATUS_TXT = {
  accepted: "Esta transferencia ya fue aceptada.",
  declined: "Esta transferencia fue rechazada.",
  cancelled: "El dueño de la tienda canceló esta transferencia.",
  expired: "Esta transferencia venció. Pedile al dueño de la tienda que te mande una nueva.",
};

export function TransferAcceptPage({ user, authReady }) {
  const { T, darkMode, toggleDark } = useTheme();
  const [token] = useState(readToken);
  const [info, setInfo] = useState(null);
  const [authMode, setAuthMode] = useState(null); // null | "login" | "register" | "reset"
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(null);
  const [confirmDecline, setConfirmDecline] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setInfo({ error: "El link está incompleto. Abrilo de nuevo desde el mail.", code: "invalid" }); return; }
    try { setInfo(await apiGet("merchant", { action: "transfer-info", t: token })); }
    catch (e) { setInfo({ error: e.message || "No pudimos cargar la transferencia." }); }
  }, [token]);
  useEffect(() => { if (authReady) load(); }, [authReady, user?.uid, load]);
  useEffect(() => { if (user) setAuthMode(null); }, [user]);

  async function aceptar() {
    setBusy("accept"); setErr("");
    try {
      const d = await post("transfer-accept", { t: token });
      setDone({ kind: "accepted", merchant_id: d.merchant_id, store_name: d.store_name });
    } catch (e) {
      setErr(e.message);
      if (["email_unverified", "email_mismatch", "cancelled", "expired", "accepted", "declined"].includes(e.code)) load();
    }
    setBusy("");
  }
  async function rechazar() {
    setBusy("decline"); setErr("");
    try { await post("transfer-decline", { t: token }); setDone({ kind: "declined" }); }
    catch (e) { setErr(e.message); load(); }
    setBusy(""); setConfirmDecline(false);
  }
  async function yaVerifique() {
    setBusy("verify"); setErr(""); setNote("");
    try { await auth.currentUser?.reload(); await auth.currentUser?.getIdToken(true); } catch (_) {}
    await load();
    setBusy("");
  }
  async function reenviar() {
    setBusy("resend"); setErr(""); setNote("");
    try { await sendEmailVerification(auth.currentUser); setNote(`Te mandamos el mail a ${user?.email}. Revisá spam si no llega.`); }
    catch (e) { setErr(e?.code === "auth/too-many-requests" ? "Ya te mandamos varios mails. Esperá unos minutos." : (e.message || "No se pudo mandar el mail.")); }
    setBusy("");
  }
  function irAlPanel() {
    if (done?.merchant_id && user?.uid) setActiveMerchantId(user.uid, done.merchant_id);
    window.location.hash = "#/dashboard/analiticas";
  }

  // Login / registro acá mismo (vuelve solo a esta pantalla al entrar).
  if (authMode && !user) {
    return (
      <div style={{ background: T.bg }}>
        <div style={{ padding: "56px 20px 0", textAlign: "center", fontFamily: F, fontSize: 13, color: T.textMd, lineHeight: 1.5 }}>
          Para responder la transferencia de <b style={{ color: T.text }}>{info?.store_name || "la tienda"}</b>, entrá con <b style={{ color: T.text }}>{info?.to_email || "el email que recibió el link"}</b>.
        </div>
        <AuthScreen T={T} darkMode={darkMode} onToggleDark={toggleDark} mode={authMode} setMode={setAuthMode} onBackToLanding={() => setAuthMode(null)} />
      </div>
    );
  }

  const card = (children) => (
    <div style={{ fontFamily: F, background: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", color: T.text }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20 }}>
          <RecLogo size={34} /><span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.6 }}>Recurrentes</span>
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 24, boxShadow: "0 12px 40px rgba(0,0,0,0.10)" }}>{children}</div>
      </div>
    </div>
  );
  const H = ({ children }) => <div style={{ fontSize: 19, fontWeight: 800, color: T.text, letterSpacing: -0.3, marginBottom: 8, lineHeight: 1.3 }}>{children}</div>;
  const P = ({ children, style }) => <div style={{ fontSize: 13.5, color: T.textMd, lineHeight: 1.6, ...style }}>{children}</div>;
  const home = <div style={{ marginTop: 18 }}><Btn T={T} variant="secondary" onClick={() => { window.location.hash = user ? "#/dashboard/analiticas" : "#/"; }}>{user ? "Ir a mi panel" : "Ir a Recurrentes"}</Btn></div>;

  if (!authReady || !info) return card(<div style={{ display: "flex", gap: 8, alignItems: "center", color: T.textSm }}><Spinner size={14} color={T.accent} /> Cargando la transferencia…</div>);
  if (done?.kind === "accepted") return card(<>
    <H>¡Listo! {done.store_name || "La tienda"} ya es tuya</H>
    <P>Ya podés entrar a su panel. Si el Mercado Pago conectado no es tuyo, conectá el tuyo desde Configuración → Integraciones para que los cobros entren a tu cuenta.</P>
    <div style={{ marginTop: 18 }}><Btn T={T} onClick={irAlPanel}>Ir al panel de la tienda</Btn></div>
  </>);
  if (done?.kind === "declined") return card(<>
    <H>Rechazaste la transferencia</H>
    <P>La tienda sigue siendo de {info.from_email || "su dueño"}. Le avisamos por mail.</P>{home}
  </>);
  if (info.error) return card(<><H>No encontramos esta transferencia</H><P>{info.error}</P>{home}</>);
  if (info.status !== "pending") return card(<><H>{info.store_name}</H><P>{STATUS_TXT[info.status] || "Esta transferencia ya no está disponible."}</P>{home}</>);

  const from = info.from_email || "El dueño";
  return card(<>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <StoreAvatar T={T} store={{ name: info.store_name, color: T.accentSolid }} size={42} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: T.textSm }}>Te quieren pasar una tienda</div>
        <div style={{ fontSize: 18, fontWeight: 800, color: T.text, overflow: "hidden", textOverflow: "ellipsis" }}>{info.store_name}</div>
      </div>
    </div>
    <P><b style={{ color: T.text }}>{from}</b> te quiere transferir esta tienda de Recurrentes. Si aceptás:</P>
    <ul style={{ margin: "8px 0 14px", paddingLeft: 18, fontSize: 13, color: T.textMd, lineHeight: 1.65 }}>
      <li>Pasa a ser tuya con sus planes, suscriptores, cobros y su plan de Recurrentes.</li>
      <li>Las conexiones con la tienda online y la pasarela quedan como están. Si la pasarela no es tuya, conectá la tuya para que los cobros entren a tu cuenta.</li>
      <li>{info.keep_access ? `${from} sigue en el equipo como miembro. Lo podés sacar cuando quieras desde Configuración → Equipo.` : `${from} deja de tener acceso.`}</li>
      <li>El resto del equipo de la tienda sigue igual.</li>
    </ul>
    {info.expires_at && <P style={{ fontSize: 12.5, color: T.textSm, marginBottom: 14 }}>Tenés hasta el {fmtDay(info.expires_at)} para responder.</P>}

    {!info.logged_in && (<>
      <Callout T={T} tone="info" style={{ marginBottom: 14 }}>Para responder, entrá con <b>{info.to_email}</b>. Si todavía no tenés cuenta, creala con ese mismo email.</Callout>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn T={T} onClick={() => setAuthMode("login")}>Iniciar sesión</Btn>
        <Btn T={T} variant="secondary" onClick={() => setAuthMode("register")}>Crear cuenta</Btn>
      </div>
    </>)}

    {info.logged_in && info.email_match === false && (<>
      <Callout T={T} tone="warning" title="Entraste con otra cuenta" style={{ marginBottom: 14 }}>
        Estás con <b>{info.your_email}</b>, pero esta transferencia es para <b>{info.to_email}</b>. Cerrá sesión y entrá con ese email.
      </Callout>
      <Btn T={T} variant="secondary" onClick={() => signOut(auth)}>Cerrar sesión y cambiar de cuenta</Btn>
    </>)}

    {info.logged_in && info.email_match === true && info.email_verified === false && (
      <Callout T={T} tone="warning" title="Verificá tu email" style={{ marginBottom: 14 }}>
        Antes de aceptar tenés que confirmar que <b>{info.your_email}</b> es tuyo. Abrí el link que te mandamos por mail y después tocá "Ya lo verifiqué".
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <Btn T={T} size="sm" onClick={yaVerifique} disabled={!!busy}>{busy === "verify" ? "Revisando…" : "Ya lo verifiqué"}</Btn>
          <Btn T={T} size="sm" variant="secondary" onClick={reenviar} disabled={!!busy}>{busy === "resend" ? "Enviando…" : "Reenviar el mail"}</Btn>
        </div>
      </Callout>
    )}

    {info.logged_in && info.email_match === true && (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {info.email_verified !== false && <Btn T={T} onClick={aceptar} disabled={!!busy}>{busy === "accept" ? <><Spinner size={12} color={T.accent} /> Aceptando…</> : "Aceptar la tienda"}</Btn>}
        {!confirmDecline
          ? <Btn T={T} variant="secondary" onClick={() => setConfirmDecline(true)} disabled={!!busy}>Rechazar</Btn>
          : <><span style={{ fontSize: 12.5, color: T.textMd }}>¿Seguro? La tienda sigue siendo de {from}.</span>
              <Btn T={T} variant="danger" size="sm" onClick={rechazar} disabled={!!busy}>{busy === "decline" ? "…" : "Sí, rechazar"}</Btn>
              <Btn T={T} variant="secondary" size="sm" onClick={() => setConfirmDecline(false)} disabled={!!busy}>No</Btn></>}
      </div>
    )}
    {note && <div style={{ marginTop: 12, fontSize: 12.5, color: T.accent }}>{note}</div>}
    {err && <div style={{ marginTop: 12, background: T.redBg, border: `1px solid ${T.red}55`, borderRadius: 8, padding: "9px 12px", fontSize: 13, color: T.red, lineHeight: 1.45 }}>{err}</div>}
  </>);
}

// ─── Login cuya tienda principal fue transferida (sin tienda) ────────────
export function StoreTransferredScreen({ user, onLogout }) {
  const T = useT();
  const [ws, setWs] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    apiGet("merchant", { action: "workspace" }).then(d => setWs(d || {})).catch(() => setWs({}));
  }, []);
  const stores = Array.isArray(ws?.stores) ? ws.stores : [];
  const pt = ws?.primary_transferred || null;

  async function entrar(s) {
    setBusyId(s.id);
    try { await post("store-activate", { merchant_id: s.id }); setActiveMerchantId(user?.uid, s.id); window.location.reload(); }
    catch (e) { uiToast("No se pudo entrar: " + e.message, "error"); setBusyId(""); }
  }
  async function crear({ name, color }) {
    try {
      const d = await post("store-create", { name, color });
      const id = d?.store?.id;
      if (id) setActiveMerchantId(user?.uid, id);
      setTimeout(() => window.location.reload(), 200);
      return true;
    } catch (e) { uiToast("No se pudo crear: " + e.message, "error"); return false; }
  }

  return (
    <div style={{ fontFamily: F, background: T.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 20px", color: T.text }}>
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginBottom: 20 }}>
          <RecLogo size={34} /><span style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.6 }}>Recurrentes</span>
        </div>
        <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 24 }}>
          <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>Tu tienda fue transferida</div>
          <div style={{ fontSize: 13.5, color: T.textMd, lineHeight: 1.6 }}>
            Tu tienda principal pasó a {pt?.to_email ? <b style={{ color: T.text }}>{pt.to_email}</b> : "otra cuenta"}. Este login ({user?.email}) sigue existiendo, pero ya no tiene acceso a esa tienda.
          </div>
          {ws === null && <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center", color: T.textSm, fontSize: 13 }}><Spinner size={13} color={T.accent} /> Buscando tus otras tiendas…</div>}
          {stores.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSm, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>Podés seguir en</div>
              {stores.map(s => (
                <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderTop: `1px solid ${T.borderL}` }}>
                  <StoreAvatar T={T} store={s} size={28} />
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600 }}>{s.name}<span style={{ fontSize: 11.5, color: T.textSm, fontWeight: 500 }}> · {s.role === "owner" ? "Dueño" : "Miembro"}</span></div>
                  <Btn T={T} size="sm" variant="secondary" onClick={() => entrar(s)} disabled={!!busyId}>{busyId === s.id ? "…" : "Entrar"}</Btn>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18 }}>
            <Btn T={T} onClick={() => setCreating(true)}>Crear una tienda nueva</Btn>
            <Btn T={T} variant="secondary" onClick={onLogout}>Cerrar sesión</Btn>
          </div>
        </div>
      </div>
      {creating && <NewStoreModal T={T} onClose={() => setCreating(false)} onCreate={crear} />}
    </div>
  );
}
