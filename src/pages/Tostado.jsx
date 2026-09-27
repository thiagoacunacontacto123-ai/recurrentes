// Tienda de EJEMPLO "Tostado" (26-sept-2026, Thiago: "una landing de compra única
// con una marca inventada, que quede linda"). No es una tienda real ni un
// comercio: es la ficha de producto de una marca de café ficticia con el widget
// REAL de Recurrentes funcionando (se cambia el modo y el pack). El botón de
// "Suscribirme" muestra cómo sigue (checkout con la marca) y lleva a pedir demo.
import React, { useEffect, useState } from "react";
import { InteractiveWidget, SubPageMock, SAMPLE_PLANS, PRODUCT_ART, PartnerBadges } from "./LandingMotion.jsx";
import { RecLogo } from "../ui/Shell.jsx";

const F = "'Inter',system-ui,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const C = "#6b3f2a", CREAM = "#f6f1ea", INK = "#1f1511";
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const MERCHANT = { widget_variant: "v13", widget_color: C, widget_radius: 12, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: true,
  widget_texts: { headline: "Elegí tu pack", sub_label: "Suscribirme y ahorrar", sub_hint: "Te llega solo cada mes · pausás o cancelás cuando quieras", cta_once: "Agregar al carrito" } };
// Tema mínimo para SubPageMock (usa T.border / T.borderL).
const TT = { border: "#e8e2da", borderL: "#efe9e1", card: "#fff", isDark: false, text: INK, textSm: "#8a7b72", accent: C, accentSolid: C };

export default function TostadoStore() {
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(false);
  const [img, setImg] = useState(0);
  useEffect(() => {
    let prev = "";
    try { prev = document.title; document.title = "Tostado · Café de especialidad (tienda de ejemplo de Recurrentes)"; window.scrollTo(0, 0); } catch (_) {}
    return () => { try { if (prev) document.title = prev; } catch (_) {} };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);
  const onCta = (mode, pack) => {
    if (mode === "sub") setModal(true);
    else setToast(`Agregado al carrito · ${pack ? pack.label : "1 bolsa"} · ${fmtARS(pack ? pack.priceOnce : 12900)}`);
  };
  const gallery = [
    { art: "/landing/prod-cafe.jpg", cap: "Bolsa de 250 g con válvula" },
    { art: "/landing/prod-supl.jpg", cap: "Tueste medio · notas a chocolate y ciruela" },
    { art: "/landing/prod-mate.jpg", cap: "Molido a pedido o en grano" },
  ];
  return (
    <div style={{ fontFamily: F, background: CREAM, color: INK, minHeight: "100vh" }}>
      <style>{`
        .ts-wrap{max-width:1120px;margin:0 auto;padding:0 24px;}
        .ts-grid{display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,.95fr);gap:48px;align-items:start;}
        .ts-gal{position:sticky;top:76px;}
        .ts-nav a{color:${INK};text-decoration:none;font-size:13.5px;font-weight:600;opacity:.8;}
        .ts-nav a:hover{opacity:1;}
        .ts-thumb{width:64px;height:64px;border-radius:12px;border:2px solid transparent;cursor:pointer;display:grid;place-items:center;overflow:hidden;background:#fff;}
        .ts-thumb.on{border-color:${C};}
        .ts-feat{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
        .ts-rev{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;}
        @media(max-width:900px){.ts-grid{grid-template-columns:1fr;gap:24px;}.ts-gal{position:static;}.ts-feat,.ts-rev{grid-template-columns:1fr;}.ts-nav .ts-links{display:none!important;}.ts-wrap{padding:0 16px;}}
        @keyframes tsToast{from{opacity:0;transform:translate(-50%,16px)}to{opacity:1;transform:translate(-50%,0)}}
        @keyframes tsFade{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
      `}</style>

      {/* Franja de Recurrentes: que se entienda que es un ejemplo */}
      <div style={{ background: "#0C1A18", color: "#EAF3EF", fontSize: 12.5, padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
        <RecLogo size={16}/><span><b>Tienda de ejemplo de Recurrentes.</b> La marca es inventada; el widget es el real. Tocá los packs y el interruptor.</span>
        <a href="#/demo" style={{ color: "#34d399", fontWeight: 800, textDecoration: "none" }}>Quiero esto en mi tienda →</a>
      </div>

      {/* Nav de la marca */}
      <header className="ts-nav" style={{ position: "sticky", top: 0, zIndex: 10, background: CREAM + "f2", backdropFilter: "blur(10px)", borderBottom: "1px solid #e8e2da" }}>
        <div className="ts-wrap" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 60 }}>
          <a href="#/tostado" style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 22, letterSpacing: 2, color: C, textDecoration: "none" }}>TOSTADO</a>
          <nav className="ts-links" style={{ display: "flex", gap: 22 }}>{["Cafés", "Suscripción", "Equipos", "Nosotros"].map(l => <a key={l} href="#/tostado">{l}</a>)}</nav>
          <span style={{ fontSize: 13, fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 6 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 6h15l-1.5 9h-12z"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/><path d="M6 6L5 3H2"/></svg>Carrito</span>
        </div>
      </header>

      <main className="ts-wrap" style={{ padding: "28px 24px 72px" }}>
        <div style={{ fontSize: 12.5, color: "#8a7b72", marginBottom: 16 }}>Cafés · Especialidad · <span style={{ color: INK }}>Finca La Esperanza</span></div>
        <div className="ts-grid">
          {/* Galería */}
          <div className="ts-gal">
            <div key={img} style={{ borderRadius: 22, aspectRatio: "1 / 1", position: "relative", overflow: "hidden", animation: "tsFade .45s ease both", background: "#e8e2da" }}>
              <img src={gallery[img].art} alt="Café Tostado" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}/>
              <span style={{ position: "absolute", left: 16, bottom: 14, fontSize: 12.5, fontWeight: 700, color: INK, background: "rgba(255,255,255,.82)", padding: "6px 10px", borderRadius: 99 }}>{gallery[img].cap}</span>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              {gallery.map((g, i) => <button key={i} type="button" className={"ts-thumb " + (i === img ? "on" : "")} onClick={() => setImg(i)} aria-label={`Foto ${i + 1}`}><img src={g.art} alt="" width="64" height="64" style={{ objectFit: "cover", display: "block" }}/></button>)}
            </div>
          </div>

          {/* Ficha */}
          <div>
            <div style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700, color: C, marginBottom: 10 }}><span style={{ width: 6, height: 6, borderRadius: 99, background: C }}/>Tueste medio · Colombia, Huila</div>
            <h1 style={{ fontFamily: SERIF, fontSize: "clamp(30px,3.6vw,42px)", fontWeight: 700, lineHeight: 1.05, margin: "0 0 10px", letterSpacing: -0.5 }}>Finca La Esperanza<br/><span style={{ fontStyle: "italic", fontWeight: 400, fontSize: "0.72em" }}>café de especialidad, bolsa de 250 g</span></h1>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <span style={{ color: "#d4a018", letterSpacing: 1 }}>★★★★★</span><span style={{ fontSize: 13, color: "#8a7b72" }}>4,9 · 312 opiniones</span>
            </div>
            <p style={{ fontSize: 15.5, lineHeight: 1.65, color: "#4a3b34", margin: "0 0 22px", maxWidth: 520 }}>Notas a chocolate, ciruela y caramelo. Lo tostamos cada lunes y lo enviamos en la semana, así te llega en su punto justo. Elegí una compra o dejá que llegue solo todos los meses con descuento.</p>

            {/* El widget REAL de Recurrentes, interactivo */}
            <div style={{ background: "#fff", border: "1px solid #e8e2da", borderRadius: 18, padding: 16, boxShadow: "0 24px 60px -30px rgba(60,30,10,.35)" }}>
              <InteractiveWidget plan={SAMPLE_PLANS.cafe} merchant={MERCHANT} onCta={onCta} style={{ fontSize: 14 }}/>
            </div>
            <div style={{ display: "flex", gap: "8px 18px", flexWrap: "wrap", fontSize: 12.5, color: "#8a7b72", marginTop: 14 }}>
              {["Envío gratis desde $30.000", "Pagás con Mercado Pago", "Pausás o cancelás desde tu portal"].map(t => <span key={t} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><span style={{ color: C, fontWeight: 800 }}>✓</span>{t}</span>)}
            </div>

            <div className="ts-feat" style={{ marginTop: 28 }}>
              {[["Origen", "Huila, Colombia · 1.750 m"], ["Proceso", "Lavado · secado al sol"], ["Molienda", "Grano, filtro o espresso"]].map(([t, d]) => <div key={t} style={{ background: "#fff", border: "1px solid #e8e2da", borderRadius: 14, padding: "12px 14px" }}><div style={{ fontSize: 11, fontWeight: 800, color: "#8a7b72", letterSpacing: .6, textTransform: "uppercase" }}>{t}</div><div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 3 }}>{d}</div></div>)}
            </div>
          </div>
        </div>

        {/* Opiniones de la marca inventada (parte de la ficha de ejemplo) */}
        <section style={{ marginTop: 72 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, margin: "0 0 18px", letterSpacing: -0.4 }}>Lo que dicen los que ya lo reciben</h2>
          <div className="ts-rev">
            {[["Me llega el primero de cada mes y no tengo que pensar en comprar café nunca más.", "Sofía, suscriptora hace 8 meses"], ["Cambié de dirección cuando me mudé y el siguiente pedido llegó a la casa nueva. Sin escribir a nadie.", "Martín, pack de 2 bolsas"], ["Lo pausé un mes cuando me fui de viaje y volvió solo. Así tiene que ser.", "Lucía, 4 bolsas al mes"]].map(([q, n]) => (
              <figure key={n} style={{ margin: 0, background: "#fff", border: "1px solid #e8e2da", borderRadius: 16, padding: 20 }}><span style={{ color: "#d4a018", letterSpacing: 1, fontSize: 13 }}>★★★★★</span><blockquote style={{ margin: "8px 0 10px", fontSize: 14.5, lineHeight: 1.6 }}>“{q}”</blockquote><figcaption style={{ fontSize: 12.5, color: "#8a7b72" }}>{n} · ejemplo</figcaption></figure>
            ))}
          </div>
        </section>
      </main>

      {/* Cierre de Recurrentes */}
      <section style={{ background: "#0C1A18", color: "#fff", padding: "56px 16px", textAlign: "center" }}>
        <RecLogo size={40} style={{ marginBottom: 14 }}/>
        <h2 style={{ fontFamily: "'Manrope','Inter',system-ui,sans-serif", fontSize: "clamp(26px,3.6vw,42px)", fontWeight: 800, letterSpacing: "-0.04em", margin: "0 auto 12px", maxWidth: 680, lineHeight: 1.06 }}>Así se ve la suscripción en una tienda.<br/>Ahora imaginalo con tus productos.</h2>
        <p style={{ color: "#A9C3B9", fontSize: 15.5, maxWidth: 520, margin: "0 auto 24px", lineHeight: 1.6 }}>Widget con tu marca, checkout propio, cobro en tu Mercado Pago y el pedido creado en tu tienda. En una demo de 15 minutos te lo mostramos andando.</p>
        <a href="#/demo" style={{ display: "inline-flex", alignItems: "center", gap: 10, background: "#10b981", color: "#fff", fontWeight: 800, fontSize: 15.5, padding: "14px 24px", borderRadius: 14, textDecoration: "none" }}>Pedir demo <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
        <PartnerBadges T={{ isDark: true }} tone="dark" compact style={{ justifyContent: "center", marginTop: 22 }}/>
        <div style={{ marginTop: 16, fontSize: 13 }}><a href="#/" style={{ color: "#A9C3B9" }}>← Volver a Recurrentes</a></div>
      </section>

      {toast && <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", background: INK, color: "#fff", padding: "12px 18px", borderRadius: 99, fontSize: 13.5, fontWeight: 700, boxShadow: "0 18px 40px rgba(0,0,0,.35)", animation: "tsToast .3s ease both", zIndex: 50, whiteSpace: "nowrap", maxWidth: "calc(100% - 32px)", overflow: "hidden", textOverflow: "ellipsis" }}>{toast} · en tu tienda esto abre el carrito del tema</div>}

      {modal && (
        <div onClick={() => setModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(20,10,5,.55)", zIndex: 60, display: "grid", placeItems: "center", padding: 16, overflow: "auto" }}>
          <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: 720, animation: "tsFade .35s ease both" }}>
            <div style={{ color: "#fff", textAlign: "center", marginBottom: 12, fontSize: 14 }}>Al tocar <b>Suscribirme</b>, tu cliente pasa al checkout de Recurrentes con la marca de la tienda:</div>
            <SubPageMock T={TT}/>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, flexWrap: "wrap" }}>
              <a href="#/demo" style={{ background: "#10b981", color: "#fff", fontWeight: 800, fontSize: 14, padding: "12px 20px", borderRadius: 12, textDecoration: "none" }}>Quiero esto en mi tienda</a>
              <button type="button" onClick={() => setModal(false)} style={{ background: "rgba(255,255,255,.12)", color: "#fff", border: "1px solid rgba(255,255,255,.3)", fontWeight: 700, fontSize: 14, padding: "12px 20px", borderRadius: 12, cursor: "pointer", fontFamily: F }}>Seguir mirando</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
