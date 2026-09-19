import React, { useState } from "react";
import ReactDOM from "react-dom";
import { apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, Field, InputStyle, Hint, Spinner } from "../ui/components.jsx";
import { normalizeWhatsapp, EMAIL_RE } from "../lib/signup.js";

import { readAttribution } from "../lib/attribution.js";
// "Completá tus datos": nombre, WhatsApp y email de contacto del dueño del login.
// Aparece una vez si faltan (entró con Google desde "Iniciar sesión", o verificó el
// mail en otro dispositivo y se perdieron los datos del paso 1 del registro).
export function OwnerInfoModal({ T, user, merchant, onSaved }) {
  const iS = InputStyle(T);
  const [name, setName] = useState(merchant?.owner_name || user?.displayName || "");
  const [wa, setWa] = useState(merchant?.owner_whatsapp || "");
  const [email, setEmail] = useState(merchant?.contact_email || user?.email || "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const owner_whatsapp = normalizeWhatsapp(wa);
    if (name.trim().length < 2) return setErr("Ingresá tu nombre.");
    if (!owner_whatsapp) return setErr("Ingresá tu WhatsApp con código de área (ej: 11 6411 7974).");
    if (!EMAIL_RE.test(email.trim())) return setErr("Ingresá un email de contacto válido.");
    setSaving(true); setErr("");
    const d = await apiPost("merchant", { owner_name: name.trim(), owner_whatsapp, contact_email: email.trim().toLowerCase(), attribution: readAttribution() }, { action: "save-owner" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (d?.error) return setErr(d.error);
    onSaved?.(d);
  }

  return ReactDOM.createPortal(
    <div role="dialog" aria-modal="true" aria-label="Completá tus datos" style={{ position:"fixed", inset:0, zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)", padding:16 }}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, width:"100%", maxWidth:440, padding:"24px 26px", boxSizing:"border-box", fontFamily:"'Inter',system-ui,sans-serif" }}>
        <div style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>Completá tus datos</div>
        <div style={{ fontSize:DS.font.md, color:T.textSm, marginTop:4, marginBottom:16, lineHeight:1.5 }}>Es para ayudarte a dejar todo andando y avisarte si algo falla con tus cobros. No lo compartimos con nadie.</div>
        <Field T={T} label="Tu nombre"><input value={name} onChange={e => setName(e.target.value)} autoComplete="name" style={iS} autoFocus/></Field>
        <Field T={T} label="WhatsApp"><input value={wa} onChange={e => setWa(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="11 6411 7974" style={iS}/></Field>
        <Hint T={T}>Con código de área, sin el 0 ni el 15. Si no sos de Argentina, poné el + y el código de tu país.</Hint>
        <Field T={T} label="Email de contacto"><input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" style={iS} onKeyDown={e => { if (e.key === "Enter") save(); }}/></Field>
        {err && <div style={{ background:T.redBg, border:`1px solid ${T.red}55`, borderRadius:8, padding:"9px 12px", fontSize:13, color:T.red, marginBottom:12, lineHeight:1.45 }}>{err}</div>}
        <Btn T={T} variant="solid" onClick={save} disabled={saving} style={{ width:"100%", justifyContent:"center" }}>{saving ? <><Spinner size={12}/> Guardando…</> : "Guardar y seguir"}</Btn>
      </div>
    </div>,
    document.body
  );
}
