// Páginas del sitio público (26-sept-2026, Thiago: "páginas aparte que compartan
// nav y pie, como subsecciones"). Cada una arma su cabecera y reutiliza los
// bloques de la home (LandingMotion / LandingSections).
//   #/como-funciona · #/funciones · #/integraciones · #/precios (+ #/calculadora) · #/preguntas
import React from "react";
import { LandingShell, FlowMap } from "./Landing.jsx";
import { HorizontalSteps, StickyDesigns, FeatureStack, PriceWeapon, ComparisonArena, IntegrationsMarquee, ClosingCta, PanelTour, BuyJourney } from "./LandingMotion.jsx";
import { FaqSection, SectionHead } from "./LandingSections.jsx";
import { BtnSolid } from "../ui/components.jsx";

export const SITE_PAGES = new Set(["como-funciona", "funciones", "integraciones", "precios", "calculadora", "preguntas"]);

function PageHead({ T, eyebrow, title, sub, reveal = "swing" }) {
  return (
    <section className="rec-land-wrap rec-page-head" style={{ position: "relative" }}>
      <div className="rec-hero-bg" aria-hidden="true"/>
      <div data-reveal={reveal} style={{ position: "relative", zIndex: 1 }}>
        <div className="lm-eyebrow">{eyebrow}</div>
        <h1 style={{ color: T.text }}>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
    </section>
  );
}

const IR_DEMO = () => { try { window.location.hash = "#/demo"; } catch (_) {} };

export default function SitePage({ T, darkMode, onToggleDark, onLogin, page }) {
  const key = page === "calculadora" ? "precios" : page;
  // Con #/calculadora se baja solo a la calculadora al cargar.
  React.useEffect(() => {
    if (page !== "calculadora") return;
    const t = setTimeout(() => { try { document.getElementById("rec-calculadora")?.scrollIntoView({ behavior: "smooth" }); } catch (_) {} }, 350);
    return () => clearTimeout(t);
  }, [page]);
  return (
    <LandingShell T={T} darkMode={darkMode} onToggleDark={onToggleDark} onLogin={onLogin} active={key} sticky={key !== "preguntas"}>
      {key === "como-funciona" && <>
        <PageHead T={T} eyebrow="Cómo funciona" title={<>Tu cliente se suscribe una vez.<br/>Después, todo pasa solo.</>} sub="El widget en tu ficha, el cobro en Mercado Pago y el pedido en tu tienda. Vos solo despachás." reveal="tilt"/>
        <BuyJourney T={T}/>
        <HorizontalSteps T={T}/>
        <StickyDesigns T={T}/>
        <ClosingCta T={T} onDemo={IR_DEMO}/>
      </>}
      {key === "funciones" && <>
        <PageHead T={T} eyebrow="Funciones" title={<>Todo lo que la suscripción necesita,<br/>en un solo lugar</>} sub="Widget con tu marca, checkout con envíos en vivo, portal del cliente, avisos por WhatsApp y mail, panel con todo. Sin apps sueltas." reveal="flip"/>
        <FeatureStack T={T} hideHead/>
        <PanelTour T={T}/>
        <StickyDesigns T={T}/>
        <ClosingCta T={T} onDemo={IR_DEMO}/>
      </>}
      {key === "integraciones" && <>
        <PageHead T={T} eyebrow="Integraciones" title={<>Tu tienda, tu pasarela,<br/>tu panel. Todo conectado.</>} sub="Shopify y Tiendanube como tienda, Mercado Pago como pasarela. Los envíos se cotizan con los correos que ya tenés en tu tienda." reveal="spin"/>
        <section className="rec-land-wrap" style={{ padding: "24px 24px 64px" }} data-reveal="rise">
          <div className="lm-card" style={{ padding: 24 }}><FlowMap T={T}/></div>
        </section>
        <IntegrationsMarquee T={T}/>
        <section className="lm-wrap" style={{ padding: "80px 24px" }}>
          <SectionHead T={T} eyebrow="Tu plataforma no está" title="¿Vendés con *otra* plataforma?" sub="WooCommerce, Empretienda, VTEX o desarrollo propio: escribinos y lo conectamos a mano. El link de suscripción funciona con cualquier tienda desde hoy."/>
          <div style={{ textAlign: "center" }}><button onClick={IR_DEMO} style={{ ...BtnSolid(T), padding: "14px 24px", fontSize: 15, borderRadius: 14 }}>Pedir demo</button></div>
        </section>
        <ClosingCta T={T} onDemo={IR_DEMO}/>
      </>}
      {key === "precios" && <>
        <PageHead T={T} eyebrow="Precios" title={<>Un costo de instalación<br/>y un abono. Nada más.</>} sub="0% de comisión por venta. Gratis hasta los primeros suscriptores, después un tramo fijo que sabés de antemano." reveal="pop"/>
        <div id="rec-calculadora"/>
        <PriceWeapon T={T} onDemo={IR_DEMO} hideHead/>
        <ComparisonArena T={T} onDemo={IR_DEMO}/>
        <FaqSection T={T}/>
      </>}
      {key === "preguntas" && <>
        <PageHead T={T} eyebrow="Preguntas frecuentes" title={<>Lo que todos preguntan<br/>antes de empezar</>} sub="Si tu duda no está, escribinos por WhatsApp o pedí la demo: te la contestamos en la llamada." reveal="wipe"/>
        <FaqSection T={T}/>
        <ClosingCta T={T} onDemo={IR_DEMO}/>
      </>}
    </LandingShell>
  );
}
