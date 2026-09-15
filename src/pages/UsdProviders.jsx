import React, { useState, useEffect } from "react";
import { apiPost } from "../lib/api.js";
import { Btn, Field, InputStyle, Spinner, Callout, Hint, appConfirm, toast } from "../ui/components.jsx";
import { DS } from "../ui/theme.js";
import { MONO, fmtDateShort } from "./_shared.jsx";

// ─── Stripe y Whop (cobros en dólares) — Configuración → Integraciones ─────
// Solo se pueden conectar si su flag de entorno está prendido (STRIPE_ENABLED /
// WHOP_ENABLED → m.stripe_enabled / m.whop_enabled del GET /api/merchant). Si no,
// Integrations.jsx los sigue mostrando como "Próximamente".
// Las piezas visuales (Row, Modal, Steps…) vienen de Integrations.jsx por `ui`,
// así se ven idénticas al resto de las filas.
export function UsdProviderRows({ T, m, onChange, open, toggle, ui }) {
  const { Row, Modal, Steps, CopyCode, S } = ui;
  const iS = InputStyle(T);
  const [busy, setBusy] = useState("");
  const [whopModal, setWhopModal] = useState(false);
  const [whopKey, setWhopKey] = useState("");
  const [whopBiz, setWhopBiz] = useState("");
  const [whopSecret, setWhopSecret] = useState("");
  const stripeOk = Boolean(m.stripe_connected);
  const whopOk = Boolean(m.whop_connected);

  // Volvimos del OAuth de Stripe: #/config/integraciones?stripe=ok|error&msg=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const st = q.get("stripe");
    if (!st) return;
    if (st === "ok") toast("Stripe conectado", "success");
    else toast("No se pudo conectar Stripe: " + (q.get("msg") || "error desconocido"), "error", 8000);
    window.history.replaceState(null, "", window.location.pathname + "#/config/integraciones");
    onChange?.();
  }, []);

  // ── Stripe ──
  async function connectStripe() {
    if (!m.stripe_connect_available) return toast("La conexión con Stripe todavía no está configurada. Escribinos y la activamos.", "warning", 7000);
    setBusy("stripe");
    const d = await apiPost("merchant", {}, { action: "stripe-connect-start" });
    if (d?.url) window.location.href = d.url;
    else { setBusy(""); toast("Error: " + (d?.error || "no se pudo abrir Stripe"), "error", 7000); }
  }
  async function disconnectStripe() {
    const ok = await appConfirm("Dejamos de tener acceso a tu cuenta de Stripe. Las suscripciones que ya existen siguen cobrándose allá, pero no vamos a registrar esos cobros hasta que vuelvas a conectar.", { title:"¿Desvincular Stripe?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-stripe" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Stripe desvinculado", "warning"); onChange?.(); }
  }

  // ── Whop ──
  const bizOk = /^biz_[A-Za-z0-9]+$/.test(whopBiz.trim());
  const canSaveWhop = bizOk && (whopOk || whopKey.trim().length > 0) && busy !== "whop";
  const openWhop = () => { setWhopKey(""); setWhopBiz(m.whop_company_id || ""); setWhopSecret(""); setWhopModal(true); };
  const closeWhop = () => { if (busy !== "whop") setWhopModal(false); };
  async function saveWhop() {
    if (!bizOk) return toast("El Company ID empieza con biz_", "warning");
    if (!whopOk && !whopKey.trim()) return toast("Pegá tu API key de Whop", "warning");
    setBusy("whop");
    const d = await apiPost("merchant", { api_key: whopKey.trim() || undefined, company_id: whopBiz.trim(), webhook_secret: whopSecret.trim() || undefined }, { action: "save-whop" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    setWhopModal(false);
    toast(`Whop conectado${d.whop_company_title ? ` (${d.whop_company_title})` : ""}`, "success");
    if (!d.whop_webhook_secret_set) toast("Falta el secreto del webhook: sin eso no nos enteramos de los cobros.", "warning", 8000);
    onChange?.();
  }
  async function disconnectWhop() {
    const ok = await appConfirm("Se borran tus claves de Whop. Las membresías que ya existen siguen cobrándose en Whop, pero no vamos a registrar esos cobros hasta que vuelvas a conectar.", { title:"¿Desvincular Whop?", danger:true, okLabel:"Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "disconnect-whop" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("Whop desvinculado", "warning"); onChange?.(); }
  }

  const line = { fontSize:DS.font.md, color:T.textMd, lineHeight:1.6, marginBottom:12 };
  const code = (t) => <code style={{ fontFamily:MONO, fontSize:DS.font.sm, color:T.text }}>{t}</code>;

  return (
    <>
      {m.stripe_enabled && (
        <Row T={T} id="stripe" label="Stripe" optional connected={stripeOk} open={open === "stripe"} onToggle={() => toggle("stripe")}
          sub={stripeOk
            ? `${m.stripe_account_name || m.stripe_account_email || m.stripe_account_id} · cobra en dólares en tu cuenta de Stripe`
            : "Cobrá en dólares a clientes de afuera (ebooks, cursos, membresías). Necesitás una cuenta de Stripe fuera de Argentina."}
          onConnect={connectStripe} connectLabel={busy === "stripe" ? "Abriendo Stripe…" : "Conectar con Stripe"} onDisconnect={disconnectStripe}>
          <div style={line}>
            Cuenta: {code(m.stripe_account_id || "—")}{m.stripe_country ? ` · ${m.stripe_country}` : ""}{m.stripe_default_currency ? ` · moneda ${m.stripe_default_currency}` : ""}<br/>
            {m.stripe_livemode ? "Cobros reales" : "Modo de prueba"}{m.stripe_connected_at ? ` · conectada el ${fmtDateShort(m.stripe_connected_at)}` : ""}
          </div>
          {!m.stripe_charges_enabled && (
            <Callout T={T} tone="warning" title="Stripe todavía no habilitó los cobros" style={{ marginBottom:12 }}>
              Terminá la verificación de tu cuenta en el panel de Stripe (datos de la empresa y cuenta bancaria). Hasta entonces el checkout no va a poder cobrar.
            </Callout>
          )}
          <Hint T={T} style={{ marginBottom:0 }}>La plata de cada cobro entra directo a tu cuenta de Stripe. Los reembolsos y los reclamos los manejás desde tu panel de Stripe.</Hint>
        </Row>
      )}

      {m.whop_enabled && (
        <Row T={T} id="whop" label="Whop" optional connected={whopOk} error={whopOk && !m.whop_webhook_secret_set} open={open === "whop"} onToggle={() => toggle("whop")}
          sub={whopOk
            ? `${m.whop_company_title || m.whop_company_id} · membresías y digitales cobrados en dólares`
            : "Membresías y productos digitales cobrados en dólares a compradores de afuera."}
          onConnect={openWhop} onDisconnect={disconnectWhop}>
          <div style={line}>
            Empresa: {code(m.whop_company_id || "—")}{m.whop_connected_at ? ` · conectada el ${fmtDateShort(m.whop_connected_at)}` : ""}
          </div>
          {!m.whop_webhook_secret_set && (
            <Callout T={T} tone="danger" title="Falta el webhook" style={{ marginBottom:12 }}>
              Sin el webhook no nos enteramos de los cobros. Crealo en Whop con la URL de abajo y pegá el secreto en "Cambiar claves".
            </Callout>
          )}
          {m.whop_webhook_url && <div style={{ fontSize:DS.font.sm, color:T.textSm }}>URL del webhook:<CopyCode T={T} text={m.whop_webhook_url}/></div>}
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:12 }}>
            <button type="button" onClick={openWhop} style={{ fontSize:12, padding:"7px 14px", borderRadius:8, fontWeight:600, cursor:"pointer", border:`1px solid ${T.border}`, background:"transparent", color:T.textMd }}>Cambiar claves</button>
          </div>
        </Row>
      )}

      {whopModal && (
        <Modal T={T} title={whopOk ? "Cambiar las claves de Whop" : "Conectar Whop"} busy={busy === "whop"} onClose={closeWhop}
          sub="Cobrás en dólares con tu cuenta de Whop. Te guiamos para sacar las 3 claves (5 minutos)."
          footer={<>
            <Btn T={T} variant="secondary" onClick={closeWhop} disabled={busy === "whop"}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={saveWhop} disabled={!canSaveWhop}>{busy === "whop" ? <><Spinner size={12}/> Validando…</> : "Conectar"}</Btn>
          </>}>
          <Steps T={T} title="Qué necesitás de tu panel de Whop">
            <li>Entrá a tu panel de Whop → <S T={T}>Developer</S> → <S T={T}>Company API keys</S> → <S T={T}>Create</S>. Dejala con permisos de administrador (o, si preferís, solo productos, planes, checkout, pagos y miembros) y copiala.</li>
            <li>Tu <S T={T}>Company ID</S> empieza con <S T={T}>biz_</S>: lo ves en la dirección (URL) de tu panel.</li>
            <li>En <S T={T}>Developer → Webhooks</S> tocá <S T={T}>Create webhook</S>, pegá esta URL y marcá <S T={T}>payment.succeeded</S>, <S T={T}>payment.failed</S> y <S T={T}>membership.deactivated</S>:
              {m.whop_webhook_url ? <CopyCode T={T} text={m.whop_webhook_url}/> : <div style={{ color:T.red, marginTop:4 }}>No pudimos armar la URL: recargá la página.</div>}
              Después copiá el <S T={T}>secreto</S> que te muestra (empieza con ws_).</li>
          </Steps>
          <Field T={T} label={whopOk ? "API key (dejala vacía para no cambiarla)" : "1 · API key"}>
            <input type="password" value={whopKey} onChange={e => setWhopKey(e.target.value)} placeholder="••••••••••••••••" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} autoFocus disabled={busy === "whop"}/>
          </Field>
          <Field T={T} label={whopOk ? "Company ID" : "2 · Company ID"}>
            <input value={whopBiz} onChange={e => setWhopBiz(e.target.value.trim())} placeholder="biz_XXXXXXXX" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "whop"}/>
          </Field>
          {whopBiz.trim() && !bizOk && <Hint T={T} style={{ color:T.red }}>El Company ID empieza con biz_ (solo letras y números después).</Hint>}
          <Field T={T} label={m.whop_webhook_secret_set ? "Secreto del webhook (dejalo vacío para no cambiarlo)" : "3 · Secreto del webhook"}>
            <input type="password" value={whopSecret} onChange={e => setWhopSecret(e.target.value)} placeholder="ws_…" style={{ ...iS, fontFamily:MONO, fontSize:DS.font.md }} disabled={busy === "whop"}/>
          </Field>
          <Hint T={T}>Validamos la clave contra tu cuenta de Whop y nunca la mostramos de vuelta.</Hint>
        </Modal>
      )}
    </>
  );
}
