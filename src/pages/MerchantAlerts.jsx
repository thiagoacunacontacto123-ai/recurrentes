import React, { useState } from "react";
import { apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, InputStyle, Spinner, Hint, CheckLine, DSToggle, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { ALERT_EVENTS, alertEventsOf, renderMerchantAlert, ALERTS_PANEL_URL } from "../../shared/platform/whatsapp.js";
import { fmtUsdSmall } from "./WhatsAppIntegration.jsx";

// ─── Configuración → Avisos para vos ─────────────────────────────────
// Avisos al DUEÑO de la tienda (no a sus clientes) cuando alguien se suscribe, pausa,
// cancela o le rechazan el pago de una renovación. Por MAIL vienen prendidos (gratis);
// por WHATSAPP desde el número de Recurrentes solo si el dueño lo prende (se cobra por
// aviso). Backend: api/_lib/merchantAlerts.js (POST /api/merchant?action=alerts-save |
// alerts-test). Solo el dueño.

export default function MerchantAlertsSection({ T, merchant, onChange }) {
  const m = merchant || {};
  const isOwner = (m.role || "owner") === "owner";
  const iS = InputStyle(T);
  const [enabled, setEnabled] = useState(m.alerts_whatsapp_enabled === true);   // WhatsApp
  const [phone, setPhone] = useState(m.alerts_whatsapp || m.alerts_whatsapp_default || "");
  const [events, setEvents] = useState(() => alertEventsOf(m));
  const [email, setEmail] = useState(m.alerts_email !== false);
  const [busy, setBusy] = useState("");
  const waOn = Boolean(m.alerts_whatsapp_available);
  const mailOn = Boolean(m.alerts_email_available);
  const mailTo = m.alerts_email_to || "";
  const small = { fontSize: DS.font.sm, color: T.textSm, lineHeight: 1.55 };
  const h = { fontSize: 12, fontWeight: 700, color: T.textMd, textTransform: "uppercase", letterSpacing: 0.4 };
  const box = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", marginBottom: 12 };

  if (!isOwner) return <Panel T={T} title="Avisos para vos"><Hint T={T} style={{ marginTop: 0 }}>Solo el dueño de la tienda configura estos avisos.</Hint></Panel>;

  async function save() {
    setBusy("save");
    const d = await apiPost("merchant", { enabled, whatsapp: phone, events, email }, { action: "alerts-save" }).catch(e => ({ error: e.message }));
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    if (d?.alerts_whatsapp) setPhone(d.alerts_whatsapp);
    const where = [email && d.recipient_email ? `mail ${d.recipient_email}` : "", enabled && waOn && d.recipient_phone ? `WhatsApp ${d.recipient_phone}` : ""].filter(Boolean).join(" y ");
    toast(where ? `Listo. Te avisamos por ${where}.` : "Guardado. Ojo: no te va a llegar ningún aviso (mail y WhatsApp apagados).", where ? "success" : "warning", 6000);
    onChange?.();
  }

  async function test() {
    setBusy("test");
    const d = await apiPost("merchant", { whatsapp: phone, email }, { action: "alerts-test" }).catch(e => ({ error: e.message }));
    setBusy("");
    if (d?.error) return toast("No salió la prueba: " + d.error, "error", 8000);
    const parts = [d.email?.ok ? `mail a ${d.email.to}` : "", d.whatsapp?.ok ? `WhatsApp a ${d.whatsapp.to}` : ""].filter(Boolean).join(" y ");
    toast(parts ? `Te mandamos la prueba por ${parts}.` : "No salió por ningún canal: guardá primero y fijate que haya un mail o WhatsApp.", parts ? "success" : "warning", 6000);
  }

  const example = renderMerchantAlert("subscribed", { marca: m.email_brand_effective || m.store_name || "tu tienda", nombre: "Ana", producto: "tu producto", monto: "$9.480", link_panel: ALERTS_PANEL_URL });

  return (
    <Panel T={T} title="Avisos para vos" sub="Te avisamos a vos (no a tus clientes) cuando pasa algo con una suscripción. Por mail es gratis y viene prendido.">
      <div style={{ ...h, margin: "2px 0 8px" }}>Avisame cuando…</div>
      <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
        {ALERT_EVENTS.map(ev => (
          <CheckLine key={ev.id} T={T} checked={events[ev.id] !== false} onChange={(v) => setEvents(s => ({ ...s, [ev.id]: Boolean(v) }))} style={{ color: T.text }}>
            {ev.label}
          </CheckLine>
        ))}
      </div>

      <div style={box}>
        <CheckLine T={T} checked={email} onChange={(v) => setEmail(Boolean(v))} style={{ color: T.text, marginBottom: 2 }}>
          <b>Por mail</b>{mailTo ? <> a <b>{mailTo}</b></> : null} <span style={{ color: T.green, fontSize: DS.font.sm, fontWeight: 700, marginLeft: 6 }}>Gratis</span>
        </CheckLine>
        <Hint T={T} style={{ marginTop: 0, marginLeft: 24 }}>{mailOn ? "Un mail por cada aviso, al instante." : "El mail de Recurrentes se está habilitando; en cuanto esté, salen solos."}</Hint>
      </div>

      <div style={{ ...box, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontSize: DS.font.base, color: T.text, fontWeight: 600 }}>Por WhatsApp <span style={{ ...small, fontWeight: 400 }}>· desde el número de Recurrentes</span></div>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: DS.font.sm, color: T.textMd }}>{enabled ? "Prendido" : "Apagado"}<DSToggle T={T} active={enabled} onToggle={() => setEnabled(v => !v)} /></span>
        </div>
        <div style={{ ...small, marginTop: 4 }}>
          {waOn
            ? <>Cada aviso cuesta <b style={{ color: T.text }}>{fmtUsdSmall(m.alerts_charge_usd)}</b> y se suma a tu plan a fin de mes. Si no sale ninguno, no pagás nada.</>
            : <>El WhatsApp de Recurrentes todavía se está habilitando. Mientras tanto, los avisos te llegan por mail.</>}
        </div>
        {enabled && (
          <div style={{ marginTop: 10 }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textMd, marginBottom: 6 }}>Tu WhatsApp</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="11 6411 7974" inputMode="tel" style={{ ...iS, maxWidth: 260, marginBottom: 0 }} />
            <Hint T={T} style={{ marginTop: 4 }}>Con código de área. Si lo dejás vacío, usamos el WhatsApp de tu cuenta.</Hint>
          </div>
        )}
      </div>

      <div style={{ ...small, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", whiteSpace: "pre-line", margin: "0 0 14px" }}>
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
