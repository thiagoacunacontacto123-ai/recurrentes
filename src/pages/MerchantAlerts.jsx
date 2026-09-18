import React, { useState } from "react";
import { apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, InputStyle, Spinner, Hint, CheckLine, DSToggle, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { ALERT_EVENTS, renderMerchantAlert, ALERTS_PANEL_URL } from "../../shared/platform/whatsapp.js";
import { fmtUsdSmall } from "./WhatsAppIntegration.jsx";

// ─── Configuración → Avisos para vos ─────────────────────────────────
// Avisos al DUEÑO de la tienda (no a sus clientes) cuando alguien se suscribe, pausa,
// cancela o le rechazan el pago de una renovación. Salen por WhatsApp desde el número
// de Recurrentes y, si no hay WhatsApp o falla, por mail. Backend: api/_lib/merchantAlerts.js
// (POST /api/merchant?action=alerts-save | alerts-test). Solo el dueño.

export default function MerchantAlertsSection({ T, merchant, onChange }) {
  const m = merchant || {};
  const isOwner = (m.role || "owner") === "owner";
  const iS = InputStyle(T);
  const [enabled, setEnabled] = useState(m.alerts_whatsapp_enabled === true);
  const [phone, setPhone] = useState(m.alerts_whatsapp || m.alerts_whatsapp_default || "");
  const [events, setEvents] = useState(() => ({ subscribed: true, paused: true, cancelled: true, payment_failed: true, ...(m.alerts_events || {}) }));
  const [email, setEmail] = useState(m.alerts_email !== false);
  const [busy, setBusy] = useState("");
  const waOn = Boolean(m.alerts_whatsapp_available);
  const mailOn = Boolean(m.alerts_email_available);
  const mailTo = m.alerts_email_to || "";
  const small = { fontSize: DS.font.sm, color: T.textSm, lineHeight: 1.55 };

  if (!isOwner) return <Panel T={T} title="Avisos para vos"><Hint T={T} style={{ marginTop: 0 }}>Solo el dueño de la tienda configura estos avisos.</Hint></Panel>;

  async function save() {
    setBusy("save");
    const d = await apiPost("merchant", { enabled, whatsapp: phone, events, email }, { action: "alerts-save" }).catch(e => ({ error: e.message }));
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    if (d?.alerts_whatsapp) setPhone(d.alerts_whatsapp);
    const where = [d.recipient_phone && waOn ? `WhatsApp ${d.recipient_phone}` : "", d.recipient_email && (email || !waOn) ? d.recipient_email : ""].filter(Boolean).join(" y ");
    toast(enabled ? (where ? `Listo. Te avisamos a ${where}.` : "Guardado, pero no tenemos a qué WhatsApp ni a qué mail avisarte.") : "Avisos apagados", enabled && where ? "success" : "warning", 6000);
    onChange?.();
  }

  async function test() {
    setBusy("test");
    const d = await apiPost("merchant", { whatsapp: phone, email }, { action: "alerts-test" }).catch(e => ({ error: e.message }));
    setBusy("");
    if (d?.error) return toast("No salió la prueba: " + d.error, "error", 8000);
    const parts = [d.whatsapp?.ok ? `WhatsApp a ${d.whatsapp.to}` : "", d.email?.ok ? `mail a ${d.email.to}` : ""].filter(Boolean).join(" y ");
    toast(`Te mandamos la prueba por ${parts}.`, "success", 6000);
  }

  const status = waOn
    ? <>Te llegan por <b style={{ color: T.text }}>WhatsApp</b> desde el número de Recurrentes. Cada aviso cuesta <b style={{ color: T.text }}>{fmtUsdSmall(m.alerts_charge_usd)}</b> (lo que cobra Meta más 50%) y se suma a tu plan a fin de mes.</>
    : mailOn
      ? <>El WhatsApp de Recurrentes todavía se está habilitando: mientras tanto te llegan <b style={{ color: T.text }}>por mail</b>{mailTo ? <> a <b style={{ color: T.text }}>{mailTo}</b></> : null}.</>
      : <>Muy pronto: estamos terminando de habilitar el WhatsApp y el mail de Recurrentes.</>;

  const example = renderMerchantAlert("subscribed", { marca: m.email_brand_effective || m.store_name || "tu tienda", nombre: "Ana", producto: "tu producto", monto: "$9.480", link_panel: ALERTS_PANEL_URL });

  return (
    <Panel T={T} title="Avisos para vos"
      sub="Te avisamos a vos (no a tus clientes) cuando pasa algo con una suscripción."
      right={<span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: DS.font.sm, color: T.textMd }}>{enabled ? "Prendidos" : "Apagados"}<DSToggle T={T} active={enabled} onToggle={() => setEnabled(v => !v)} /></span>}>
      <div style={{ ...small, marginBottom: 14 }}>{status}</div>

      <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textMd, marginBottom: 6 }}>Tu WhatsApp</label>
      <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="11 6411 7974" inputMode="tel" style={{ ...iS, maxWidth: 260 }} />
      <Hint T={T} style={{ marginTop: 4 }}>Con código de área. Si lo dejás vacío, usamos el WhatsApp de tu cuenta.</Hint>

      <div style={{ fontSize: 12, fontWeight: 600, color: T.textMd, margin: "6px 0 8px" }}>Avisame cuando…</div>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        {ALERT_EVENTS.map(ev => (
          <CheckLine key={ev.id} T={T} checked={events[ev.id] !== false} onChange={(v) => setEvents(s => ({ ...s, [ev.id]: Boolean(v) }))} style={{ color: T.text }}>
            {ev.label}
          </CheckLine>
        ))}
      </div>

      <CheckLine T={T} checked={email} onChange={(v) => setEmail(Boolean(v))} style={{ color: T.text, marginBottom: 4 }}>
        También por mail{mailTo ? <> a <b>{mailTo}</b></> : null}
      </CheckLine>
      <Hint T={T} style={{ marginTop: 0, marginLeft: 24 }}>Si el WhatsApp no sale, te llega igual por mail.</Hint>

      <div style={{ ...small, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-line", margin: "4px 0 14px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textSm, marginBottom: 4 }}>Así se ve un aviso</div>
        {example}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Btn T={T} variant="solid" size="sm" onClick={save} disabled={!!busy}>{busy === "save" ? <><Spinner size={12} /> Guardando…</> : "Guardar"}</Btn>
        <Btn T={T} variant="secondary" size="sm" onClick={test} disabled={!!busy || (!waOn && !mailOn)}>{busy === "test" ? <><Spinner size={12} color={T.textMd} /> Mandando…</> : "Enviarme una prueba"}</Btn>
      </div>
    </Panel>
  );
}
