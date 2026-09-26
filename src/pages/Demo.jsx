// #/demo — pedir una demo. La puerta de entrada desde el 25-sept-2026 (Thiago).
//
// No crea cuenta: junta con quién estamos hablando, cuánto vende y si acepta
// pagar la puesta en marcha, y termina en WhatsApp. El registro self-serve sigue
// existiendo en #/registro, pero acá es donde queremos que caiga la pauta.
// Ver shared/platform/demoLead.js para el porqué y para las preguntas.
//
// Diseño (25-sept-2026, Thiago: "dejarlo bastante linda"): dos columnas en compu
// —a la izquierda qué te dejamos andando y reseñas de tiendas, a la derecha el
// formulario en una tarjeta fija—; en celular el formulario va primero y las
// reseñas debajo. Mismas reseñas que la landing (LandingSections → REVIEWS).
import React, { useState, useEffect, useMemo } from "react";
import { useTheme } from "../ui/theme.js";
import { InputStyle, BtnSolid, Spinner } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { apiPost } from "../lib/api.js";
import { normalizeWhatsapp, EMAIL_RE } from "../../shared/platform/contact.js";
import { readAttribution, pixelTrack } from "../lib/attribution.js";
import { AGENDA_URL, waLink, agendaUrl } from "../lib/contacto.js";
import { DEMO_PREGUNTAS, DEMO_CONFIRMACIONES, sanitizeDemoLead } from "../../shared/platform/demoLead.js";
import { REVIEWS, ReviewCard, Stars } from "./LandingSections.jsx";

const F = "'Inter',system-ui,sans-serif";
const FD = "'Manrope','Inter',system-ui,sans-serif";

// ─── Calendario incrustado ───────────────────────────────────────────────────
// Calendly adentro de la página, no un salto a calendly.com (26-sept-2026,
// Thiago). Es un paso menos, no se va del sitio, y sobre todo: cuando la
// persona elige horario, Calendly avisa por postMessage y ahí marcamos el lead
// como agendado. Sin el embed eso no se puede saber sin el plan pago.
//
// El script y el widget son de Calendly; el plan gratis los permite.
function AgendaEmbed({ T, url, nombre, email, leadId, wa }) {
  const box = React.useRef(null);
  const [agendado, setAgendado] = useState(false);
  const avisado = React.useRef(false);

  // Parámetros de marca del embed. Calendly los quiere en hexa SIN el #, y
  // toma los colores del tema en el que esté el visitante, así no aparece un
  // calendario blanco dentro de una página oscura.
  //
  // hide_event_type_details y hide_gdpr_banner sacan el panel de Calendly de la
  // izquierda y el cartel de cookies: eso anda en el plan gratis. Los COLORES
  // solo los aplica Calendly en plan pago; acá van igual para que el día que se
  // pague quede con la marca sin tocar una línea de código.
  const hex = (c) => String(c || "").replace("#", "").slice(0, 6);
  const urlConMarca = useMemo(() => {
    const u = new URL(url);
    u.searchParams.set("hide_event_type_details", "1");
    u.searchParams.set("hide_gdpr_banner", "1");
    if (hex(T.card)) u.searchParams.set("background_color", hex(T.card));
    if (hex(T.text)) u.searchParams.set("text_color", hex(T.text));
    if (hex(T.accentSolid)) u.searchParams.set("primary_color", hex(T.accentSolid));
    return u.toString();
  }, [url, T.card, T.text, T.accentSolid]);

  useEffect(() => {
    let cancelado = false;
    const SRC = "https://assets.calendly.com/assets/external/widget.js";
    const montar = () => {
      if (cancelado || !box.current || !window.Calendly) return;
      box.current.innerHTML = "";
      window.Calendly.initInlineWidget({ url: urlConMarca, parentElement: box.current, prefill: { name: nombre, email } });
    };
    if (window.Calendly) montar();
    else {
      const ya = document.querySelector(`script[src="${SRC}"]`);
      if (ya) ya.addEventListener("load", montar);
      else {
        const sc = document.createElement("script");
        sc.src = SRC; sc.async = true; sc.onload = montar;
        document.head.appendChild(sc);
      }
    }
    return () => { cancelado = true; };
  }, [urlConMarca, nombre, email]);

  // Calendly avisa cada paso por postMessage; solo nos importa el agendado.
  useEffect(() => {
    const onMsg = async (e) => {
      if (!/calendly\.com$/.test(String(e.origin || "").replace(/^https?:\/\//, "")) ) return;
      if (e.data?.event !== "calendly.event_scheduled" || avisado.current) return;
      avisado.current = true;
      setAgendado(true);
      pixelTrack("DemoAgendada", {}, leadId ? `acq_booked_${leadId}` : null);
      if (leadId) { try { await apiPost("public", { lead_id: leadId }, { action: "demo-booked" }); } catch (_) {} }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [leadId]);

  return (
    <div style={{ maxWidth: 900, margin: "28px auto 60px" }}>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <h1 style={{ fontSize: "clamp(24px, 3.2vw, 32px)", fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 8px" }}>
          {agendado ? `Listo, ${String(nombre).split(" ")[0]}. Nos vemos.` : `Elegí tu horario, ${String(nombre).split(" ")[0]}`}
        </h1>
        <p style={{ fontSize: 15, color: T.textMd, lineHeight: 1.6, margin: 0 }}>
          {agendado
            ? <>Te llega la invitación con el link de Google Meet a <strong style={{ color: T.text }}>{email}</strong>.</>
            : <>Ya tenemos tus datos. Falta solo esto: te llega la invitación a <strong style={{ color: T.text }}>{email}</strong>.</>}
        </p>
      </div>
      {/* ALTO FIJO, no min-height: el iframe de Calendly se estira al alto del
          contenedor, y con min-height quedaba corto y abajo se veía una franja
          de nuestro fondo — parecía roto.

          Y el fondo va BLANCO: Calendly solo pinta el calendario con los
          colores de la marca en plan pago, así que en el gratis siempre llega
          claro. Poniendo la tarjeta blanca se lee como una tarjeta a propósito
          dentro de la página oscura, en vez de un recuadro ajeno mal pegado.
          El día que se pague el plan, los parámetros de color ya van en la URL
          y esto se cambia por T.card. */}
      <style>{`.rec-agenda{height:720px}@media(max-width:760px){.rec-agenda{height:1100px}}`}</style>
      <div ref={box} className="rec-agenda" style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 18, overflow: "hidden" }}/>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <a href={wa} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, color: T.textMd, fontWeight: 600 }}>
          ¿Ningún horario te sirve? Escribinos por WhatsApp
        </a>
      </div>
    </div>
  );
}

export default function DemoPage() {
  const { T } = useTheme();
  const iS = InputStyle(T);
  const [f, setF] = useState({ nombre: "", marca: "", whatsapp: "", email: "", pedidos: "", objetivo: "", recurrencia: "" });
  const [oks, setOks] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [listo, setListo] = useState(false);
  // Id del lead guardado: con eso marcamos "agendó" cuando Calendly avisa.
  const [leadId, setLeadId] = useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const label = { display: "block", fontSize: 12.5, fontWeight: 600, color: T.textMd, marginBottom: 6, lineHeight: 1.4 };
  const campo = { marginBottom: 14 };

  // El calendario con nombre, mail y el anuncio del que vino ya puestos: en
  // Calendly solo elige el horario, no vuelve a cargar los mismos datos.
  const agenda = agendaUrl({ nombre: f.nombre, email: f.email, attribution: readAttribution() });

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
    // El calendario aparece acá mismo, incrustado (26-sept-2026, Thiago: vio la
    // demo integrada de Talopay). Mejor que redirigir: es un paso menos, no se
    // va del sitio, y cuando elige horario Calendly nos avisa por JavaScript —
    // así sabemos quién llenó el formulario y NO reservó, que antes era un
    // agujero negro.
    if (agenda) { setLeadId(r?.id || null); setListo(true); window.scrollTo(0, 0); return; }
    // Sin Calendly cargado no hay a dónde mandarlo: ahí sí va la pantalla con
    // la salida por WhatsApp, que no puede quedar en la nada.
    setLeadId(r?.id || null);
    setListo(true);
    window.scrollTo(0, 0);
  }

  const wa = waLink(`Hola! Soy ${f.nombre || ""} de ${f.marca || ""}. Acabo de pedir la demo de Recurrentes.`);

  return (
    <div className="rec-demo" style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: F }}>
      <style>{`
        .rec-demo h1,.rec-demo h2,.rec-demo h3{font-family:${FD};}
        .rec-demo-wrap{max-width:1120px;margin:0 auto;padding:0 24px;}
        .rec-demo-form{position:sticky;top:84px;background:${T.card};border:1px solid ${T.border};border-radius:22px;padding:26px 24px 22px;box-shadow:0 30px 70px -30px rgba(0,0,0,.45);}
        .rec-demo-bg{position:absolute;inset:0 0 auto;height:520px;pointer-events:none;z-index:0;
          background-image:linear-gradient(${T.border} 1px,transparent 1px),linear-gradient(90deg,${T.border} 1px,transparent 1px);background-size:56px 56px;
          -webkit-mask-image:radial-gradient(ellipse 70% 60% at 30% 0%,#000 20%,transparent 100%);mask-image:radial-gradient(ellipse 70% 60% at 30% 0%,#000 20%,transparent 100%);opacity:.5;}
        .rec-demo-reviews{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;}
        .ls-card{background:${T.card};border:1px solid ${T.border};border-radius:20px;position:relative;overflow:hidden;}
        @media(max-width:960px){
          .rec-demo-reviews{grid-template-columns:1fr;}
          .rec-demo-wrap{padding:0 16px;}
        }
      `}</style>

      <nav style={{ position: "sticky", top: 0, zIndex: 20, background: T.bg + "e6", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)", borderBottom: `1px solid ${T.border}` }}>
        <div className="rec-demo-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <a href="#/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: T.text }}>
            <RecLogo size={30}/><span style={{ fontWeight: 800, fontSize: 18, letterSpacing: -0.3 }}>Recurrentes</span>
          </a>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 13.5 }}>
            <a href="#/" style={{ color: T.textMd, textDecoration: "none", fontWeight: 500 }}>← Volver</a>
            <a href="#/login" style={{ color: T.text, textDecoration: "none", fontWeight: 600 }}>Iniciar sesión</a>
          </div>
        </div>
      </nav>

      <div style={{ position: "relative" }}>
        <div className="rec-demo-bg" aria-hidden="true"/>
        <div className="rec-demo-wrap" style={{ position: "relative", zIndex: 1 }}>
          {listo ? (
            agenda ? (
              <AgendaEmbed T={T} url={agenda} nombre={f.nombre} email={f.email} leadId={leadId} wa={wa}/>
            ) : (
            <div style={{ maxWidth: 560, margin: "48px auto 80px", background: T.card, border: `1px solid ${T.border}`, borderRadius: 22, padding: "34px 28px", textAlign: "center", boxShadow: "0 30px 70px -30px rgba(0,0,0,.45)" }}>
              <div style={{ width: 56, height: 56, borderRadius: 99, margin: "0 auto 16px", background: T.accentSolid + "1a", border: `1px solid ${T.accentSolid}55`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 10px" }}>Listo, {f.nombre.split(" ")[0]}.</h1>
              <p style={{ fontSize: 15, color: T.textMd, lineHeight: 1.6, margin: "0 0 22px" }}>
                Ya tenemos tus datos. Te escribimos por WhatsApp al <strong style={{ color: T.text }}>{normalizeWhatsapp(f.whatsapp)}</strong> para coordinar la llamada. Si querés adelantarla, escribinos vos ahora mismo.
              </p>
              <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...BtnSolid(T), display: "inline-flex", alignItems: "center", gap: 8, padding: "14px 24px", fontSize: 15.5, textDecoration: "none", borderRadius: 14 }}>
                Escribir por WhatsApp
              </a>
            </div>
            )
          ) : (
            <>
              {/* Arriba: una explicación breve. Después, directo a los datos. Las
                  reseñas quedan al final (25-sept-2026, Thiago: "sin tanto choclo"). */}
              <div style={{ maxWidth: 640, margin: "36px auto 26px", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 12px", borderRadius: 20, background: T.accentSolid + "16", border: `1px solid ${T.accentSolid}44`, color: T.accent, fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", marginBottom: 16 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 99, background: T.accentSolid }}/>Demo de 15 minutos · por videollamada
                </div>
                <h1 style={{ fontSize: "clamp(30px, 4vw, 46px)", fontWeight: 800, lineHeight: 1.04, letterSpacing: "-0.04em", margin: "0 0 14px", textWrap: "balance" }}>
                  Mirá cómo venden por suscripción nuestras tiendas <span style={{ background: `linear-gradient(135deg, ${T.accentSolid}, #34d399 60%, #a7f3d0)`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>y cómo quedaría la tuya.</span>
                </h1>
                <p style={{ fontSize: 16.5, color: T.textMd, lineHeight: 1.6, margin: 0, textWrap: "pretty" }}>
                  Te mostramos en vivo cómo lo usan las tiendas que ya venden con Recurrentes y armamos juntos cómo llevarlo a la tuya, <strong style={{ color: T.text }}>de la manera que vos quieras</strong>. {AGENDA_URL ? "Dejanos tus datos y elegís el horario que te quede cómodo." : "Dejanos tus datos y coordinamos por WhatsApp."}
                </p>
              </div>

              <div className="rec-demo-form" style={{ position: "static", maxWidth: 560, margin: "0 auto" }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em", margin: "0 0 16px" }}>Tus datos</h2>

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

                {/* Las tres salen de DEMO_PREGUNTAS: el aviso que le llega a Thiago
                    repite EXACTAMENTE estas preguntas con la respuesta elegida. */}
                {DEMO_PREGUNTAS.map((q) => (
                  <div key={q.id} style={campo}>
                    <label style={label}>{q.label}</label>
                    <select style={iS} value={f[q.id]} onChange={(e) => set(q.id, e.target.value)}>
                      <option value="">Elegí una opción</option>
                      {q.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                  </div>
                ))}

                {/* Las dos casillas SON el filtro, no letra chica: el que no las
                    marca no manda el formulario y no nos come una llamada. */}
                <div style={{ margin: "18px 0 16px", display: "grid", gap: 10 }}>
                  {DEMO_CONFIRMACIONES.map((c) => (
                    <label key={c.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer",
                      padding: "12px 13px", borderRadius: 12, background: T.surface,
                      border: `1.5px solid ${oks[c.id] ? T.accentSolid : T.borderL}`, transition: "border-color .15s" }}>
                      <input type="checkbox" checked={!!oks[c.id]} onChange={(e) => setOks((p) => ({ ...p, [c.id]: e.target.checked }))}
                        style={{ width: 17, height: 17, marginTop: 2, flexShrink: 0, accentColor: T.accentSolid, cursor: "pointer" }}/>
                      <span style={{ fontSize: 12.5, color: T.textMd, lineHeight: 1.5 }}>{c.text}</span>
                    </label>
                  ))}
                </div>

                {error && (
                  <div role="alert" style={{ background: T.redBg, border: `1.5px solid ${T.red}55`, borderRadius: 10, padding: "10px 14px", fontSize: 13, color: T.red, marginBottom: 14, lineHeight: 1.45 }}>{error}</div>
                )}
                <button onClick={enviar} disabled={loading} style={{ ...BtnSolid(T), width: "100%", padding: 15, fontSize: 15.5, borderRadius: 14, opacity: loading ? 0.7 : 1 }}>
                  {loading ? <Spinner size={16}/> : "Reservar mi llamada →"}
                </button>
                <div style={{ textAlign: "center", marginTop: 14, fontSize: 12.5, color: T.textSm, lineHeight: 1.7 }}>
                  Sin compromiso hasta que la integración esté funcionando.
                </div>
              </div>

              {/* Reseñas al final */}
              <div style={{ margin: "64px 0 72px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 18 }}>
                  <Stars T={T} size={14}/>
                  <span style={{ fontSize: 13.5, color: T.textMd }}><strong style={{ color: T.text }}>4.9</strong> promedio de las tiendas que ya venden por suscripción</span>
                </div>
                <div className="rec-demo-reviews">
                  {REVIEWS.slice(0, 3).map((r, i) => <ReviewCard key={r.n} T={T} r={r} i={i} compact/>)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <footer style={{ borderTop: `1px solid ${T.border}`, padding: "22px 0", fontSize: 12.5, color: T.textSm }}>
        <div className="rec-demo-wrap" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>© {new Date().getFullYear()} Recurrentes</span>
          <span><a href="mailto:soporte@recurrentesapp.com" style={{ color: T.textSm }}>soporte@recurrentesapp.com</a> · <a href="#/terminos" style={{ color: T.textSm }}>Términos</a> · <a href="#/privacidad" style={{ color: T.textSm }}>Privacidad</a></span>
        </div>
      </footer>
    </div>
  );
}
