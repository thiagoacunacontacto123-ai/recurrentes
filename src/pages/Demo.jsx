// #/demo — pedir una demo. La puerta de entrada desde el 25-sept-2026 (Thiago).
//
// No crea cuenta: junta con quién estamos hablando, cuánto vende y si acepta
// pagar la puesta en marcha, y termina en WhatsApp. El registro self-serve sigue
// existiendo en #/registro, pero acá es donde queremos que caiga la pauta.
// Ver shared/platform/demoLead.js para el porqué y para las preguntas.
import React, { useState } from "react";
import { useTheme } from "../ui/theme.js";
import { InputStyle, BtnSolid, Spinner } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { apiPost } from "../lib/api.js";
import { normalizeWhatsapp, EMAIL_RE } from "../../shared/platform/contact.js";
import { readAttribution, pixelTrack } from "../lib/attribution.js";
import {
  DEMO_PEDIDOS, DEMO_OBJETIVO, DEMO_RECURRENCIA, DEMO_CONFIRMACIONES, sanitizeDemoLead,
} from "../../shared/platform/demoLead.js";

const WA_THIAGO = "5491164117974";

export default function DemoPage() {
  const { T } = useTheme();
  const iS = InputStyle(T);
  const [f, setF] = useState({ nombre: "", marca: "", whatsapp: "", email: "", pedidos: "", objetivo: "", recurrencia: "" });
  const [oks, setOks] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [listo, setListo] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const label = { display: "block", fontSize: 13, fontWeight: 600, color: T.textMd, marginBottom: 6, lineHeight: 1.4 };
  const campo = { marginBottom: 15 };

  async function enviar() {
    setError("");
    // Se valida con la MISMA función que el backend: un solo lugar donde están
    // las reglas, y el visitante ve el error antes de mandar.
    const { value, error: err } = sanitizeDemoLead({ ...f, ...oks }, { emailRe: EMAIL_RE, normalizeWhatsapp });
    if (err) return setError(err);
    setLoading(true);
    // apiPost NO lanza: devuelve { error } (ver src/lib/api.js).
    const r = await apiPost("public", { ...value, attribution: readAttribution() }, { action: "demo-lead" });
    setLoading(false);
    if (r?.error) return setError(r.error);
    // El pixel del navegador con el MISMO nombre que manda el servidor: Meta
    // deduplica por event_id y el que tenga el navegador bloqueado igual cuenta.
    pixelTrack("RegistroCalificado", {}, r?.id ? `acq_qualified_${r.id}` : null);
    setListo(true);
    window.scrollTo(0, 0);
  }

  const wa = `https://wa.me/${WA_THIAGO}?text=${encodeURIComponent(`Hola! Soy ${f.nombre || ""} de ${f.marca || ""}. Acabo de pedir la demo de Recurrentes.`)}`;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'Inter',system-ui,sans-serif" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "28px 18px 60px" }}>
        <a href="#/" style={{ display: "inline-flex", textDecoration: "none", marginBottom: 26 }} aria-label="Volver al inicio"><RecLogo T={T}/></a>

        {listo ? (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: "28px 22px" }}>
            <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 10 }}>Listo, {f.nombre.split(" ")[0]}.</div>
            <p style={{ fontSize: 14.5, color: T.textMd, lineHeight: 1.6, margin: "0 0 18px" }}>
              Ya tenemos tus datos. Te escribimos por WhatsApp al <strong style={{ color: T.text }}>{normalizeWhatsapp(f.whatsapp)}</strong> para
              coordinar la llamada. Si querés adelantarla, escribinos vos ahora mismo.
            </p>
            <a href={wa} target="_blank" rel="noopener noreferrer"
              style={{ ...BtnSolid(T), display: "inline-block", padding: "13px 22px", fontSize: 15, textDecoration: "none" }}>
              Escribir por WhatsApp
            </a>
          </div>
        ) : (
          <>
            <h1 style={{ fontSize: 27, fontWeight: 800, lineHeight: 1.2, margin: "0 0 10px" }}>
              Pedí tu demo
            </h1>
            <p style={{ fontSize: 15, color: T.textMd, lineHeight: 1.6, margin: "0 0 8px" }}>
              Te mostramos cómo quedaría la suscripción en <strong style={{ color: T.text }}>tu</strong> tienda,
              con tus productos y tus precios. Son 20 minutos por videollamada.
            </p>
            {/* Arriba NO va el precio (25-sept-2026, Thiago): va lo que hacemos,
                para que el que llega frío entienda qué está pidiendo. Los USD 100
                están abajo, en la casilla que tiene que marcar sí o sí. */}
            <div style={{ margin: "0 0 24px", padding: "14px 16px", background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: T.textSm, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 10 }}>Qué te dejamos andando</div>
              {[
                "El botón de suscribirse en tu página de producto, con tus packs, tus descuentos y el diseño de tu tienda.",
                "Mercado Pago le cobra solo a tu cliente cada período, y cada cobro crea la orden en tu tienda, lista para despachar.",
                "Tu panel con ingresos recurrentes, próximos cobros y bajas, más los mails y WhatsApp automáticos con tu marca.",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: i === 2 ? 0 : 8 }}>
                  <span style={{ color: T.accent, fontWeight: 800, fontSize: 13, lineHeight: 1.55, flexShrink: 0 }}>✓</span>
                  <span style={{ fontSize: 13.5, color: T.textMd, lineHeight: 1.55 }}>{t}</span>
                </div>
              ))}
            </div>

            <div style={campo}>
              <label style={label}>Tu nombre</label>
              <input style={iS} value={f.nombre} onChange={(e) => set("nombre", e.target.value)} placeholder="Nombre y apellido" autoComplete="name"/>
            </div>
            <div style={campo}>
              <label style={label}>¿Cuál es tu marca?</label>
              <input style={iS} value={f.marca} onChange={(e) => set("marca", e.target.value)} placeholder="Nombre de la marca o link de tu tienda"/>
            </div>
            <div style={campo}>
              <label style={label}>WhatsApp</label>
              <input style={iS} value={f.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} placeholder="11 6411 7974" inputMode="tel" autoComplete="tel"/>
            </div>
            <div style={campo}>
              <label style={label}>Email</label>
              <input style={iS} value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="vos@tumarca.com" inputMode="email" autoComplete="email"/>
            </div>

            <div style={campo}>
              <label style={label}>¿Cuántos pedidos vendés por día?</label>
              <select style={iS} value={f.pedidos} onChange={(e) => set("pedidos", e.target.value)}>
                <option value="">Elegí una opción</option>
                {DEMO_PEDIDOS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div style={campo}>
              <label style={label}>¿Cuál es tu tasa de clientes recurrentes hoy?</label>
              <select style={iS} value={f.recurrencia} onChange={(e) => set("recurrencia", e.target.value)}>
                <option value="">Elegí una opción</option>
                {DEMO_RECURRENCIA.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>
            <div style={campo}>
              <label style={label}>¿Qué querés lograr con las suscripciones?</label>
              <select style={iS} value={f.objetivo} onChange={(e) => set("objetivo", e.target.value)}>
                <option value="">Elegí una opción</option>
                {DEMO_OBJETIVO.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </div>

            {/* Las dos casillas SON el filtro, no letra chica: el que no las
                marca no manda el formulario y no nos come una llamada. */}
            <div style={{ margin: "22px 0 18px", display: "grid", gap: 12 }}>
              {DEMO_CONFIRMACIONES.map((c) => (
                <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                  padding: "13px 14px", borderRadius: 12, background: T.surface,
                  border: `1.5px solid ${oks[c.id] ? T.accentSolid : T.borderL}`, transition: "border-color .15s" }}>
                  <input type="checkbox" checked={!!oks[c.id]} onChange={(e) => setOks((p) => ({ ...p, [c.id]: e.target.checked }))}
                    style={{ width: 17, height: 17, marginTop: 2, flexShrink: 0, accentColor: T.accentSolid, cursor: "pointer" }}/>
                  <span style={{ fontSize: 12.5, color: T.textMd, lineHeight: 1.5 }}>{c.text}</span>
                </label>
              ))}
            </div>

            {error && (
              <div style={{ background: T.redBg, border: `1.5px solid ${T.red}55`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.red, marginBottom: 14, lineHeight: 1.45 }}>{error}</div>
            )}
            <button onClick={enviar} disabled={loading} style={{ ...BtnSolid(T), width: "100%", padding: 14, fontSize: 15.5, opacity: loading ? 0.7 : 1 }}>
              {loading ? <Spinner size={16}/> : "Reservar mi llamada →"}
            </button>
            <div style={{ textAlign: "center", marginTop: 18, fontSize: 13, color: T.textMd, lineHeight: 1.7 }}>
              ¿Ya tenés cuenta? <a href="#/login" style={{ color: T.accent, fontWeight: 600 }}>Iniciá sesión</a>
              <br/>
              <a href="#/registro" style={{ color: T.textSm }}>Prefiero crear la cuenta y probar solo</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
