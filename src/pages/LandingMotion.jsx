// Landing con movimiento (26-sept-2026, Thiago: "que al bajar vaya revelando el
// producto por partes"). Todo CSS/SVG/DOM, sin dependencias nuevas:
//   · reveal al entrar en pantalla → IntersectionObserver (useReveal)
//   · secciones fijas manejadas por el scroll → progreso 0..1 en una CSS var
//     (`--p`) que calcula un listener pasivo (useScrollProgress); el CSS mueve
//     las piezas con calc(). Anda en todos los navegadores, en celular se
//     reemplaza por un carrusel horizontal con scroll-snap (nada de fijar la
//     pantalla en el teléfono).
//   · widgets REALES: el mismo render que usa la tienda (shared/bundle), con
//     distintos diseños y colores, y en el hero un loop que simula al comprador
//     eligiendo pack y activando la suscripción.
// prefers-reduced-motion: sin animación, todo queda visible y en su lugar.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { BtnSolid } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { buildBundleVM } from "../../shared/bundle/viewmodel.js";
import { renderBundle } from "../../shared/bundle/templates.js";
import { FREE_SUBSCRIBERS, INSTALL_USD, PRICING_TIERS } from "../../shared/platform/pricing.js";
import { COMPARE_ROWS, COMPARE_COLS, COMPARE_SOURCES, CompareCell, CompareMark, RecLogoMini } from "./LandingSections.jsx";

const F = "'Inter',system-ui,sans-serif";
const FD = "'Manrope','Inter',system-ui,sans-serif";
const MONO = "'IBM Plex Mono', ui-monospace, monospace";
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

// ─── Movimiento: estilos y hooks ─────────────────────────────────────────
export function MotionStyle({ T }) {
  return (
    <style>{`
      .lm-wrap{max-width:1120px;margin:0 auto;padding:0 24px;}
      .lm-eyebrow{font-family:${MONO};font-size:12px;letter-spacing:2.2px;text-transform:uppercase;color:${T.accent};margin-bottom:14px;}
      .lm-h2{font-family:${FD};font-size:clamp(30px,3.6vw,46px);font-weight:800;letter-spacing:-.035em;line-height:1.06;margin:0 0 14px;color:${T.text};text-wrap:balance;}
      .lm-sub{font-size:16.5px;color:${T.textSm};line-height:1.65;margin:0;max-width:640px;text-wrap:pretty;}
      /* Reveal al entrar en pantalla (IntersectionObserver pone .is-in). */
      [data-reveal]{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.22,1,.36,1),transform .7s cubic-bezier(.22,1,.36,1);}
      [data-reveal="left"]{transform:translateX(-32px);}
      [data-reveal="right"]{transform:translateX(32px);}
      [data-reveal="scale"]{transform:scale(.96);}
      /* 26-sept (Thiago: "medio falopa, cada sección distinta"): variantes de entrada. */
      [data-reveal="swing"]{transform:translate(48px,56px) rotate(5deg) scale(.94);transform-origin:100% 100%;transition-duration:.65s;}
      [data-reveal="flip"]{transform:perspective(900px) rotateX(-18deg) translateY(40px);transform-origin:50% 100%;}
      [data-reveal="pop"]{transform:scale(.72);transition-timing-function:cubic-bezier(.34,1.56,.64,1);transition-duration:.55s;}
      [data-reveal="tilt"]{transform:translateX(-56px) rotate(-3deg);transform-origin:0 100%;}
      [data-reveal="rise"]{transform:translateY(72px) scale(.98);transition-duration:.8s;}
      [data-reveal="wipe"]{transform:none;clip-path:inset(0 100% 0 0 round 22px);transition:clip-path .8s cubic-bezier(.22,1,.36,1),opacity .4s;}
      [data-reveal="spin"]{transform:translate(60px,60px) rotate(12deg) scale(.8);transform-origin:100% 100%;transition-duration:.7s;}
      [data-reveal].is-in{opacity:1;transform:none;}
      [data-reveal="wipe"].is-in{clip-path:inset(0 0 0 0 round 22px);}
      /* ── Hero: tres facetas que van pasando (widget café → widget vitamina → página) ── */
      /* La caja del hero SIEMPRE mide lo mismo (Thiago, 26-sept: "que ese cuadrado se
         mantenga del mismo tamaño"): el escenario tiene alto fijo y cada faceta lo llena. */
      .lm-stage{position:relative;perspective:1200px;min-width:0;max-width:100%;display:grid;}
      .lm-face{grid-area:1/1;min-width:0;max-width:100%;align-self:stretch;}
      .lm-face > .lm-card{height:100%;display:flex;flex-direction:column;}
      .lm-face .lm-hero-widget > div:last-child{flex:1;min-height:0;}
      .lm-face.is-hidden{visibility:hidden;pointer-events:none;}
      .lm-face.is-out{pointer-events:none;z-index:2;}
      .lm-hero-widget{min-width:0;max-width:100%;}
      .rec-land-hero > *{min-width:0;}
      .lm-in-flip{animation:lmInFlip .75s cubic-bezier(.22,1,.36,1) both;transform-origin:50% 50%;}
      .lm-out-flip{animation:lmOutFlip .75s cubic-bezier(.22,1,.36,1) both;transform-origin:50% 50%;}
      @keyframes lmInFlip{from{opacity:0;transform:rotateY(-70deg) translateX(60px)}to{opacity:1;transform:none}}
      @keyframes lmOutFlip{from{opacity:1;transform:none}to{opacity:0;transform:rotateY(60deg) translateX(-80px)}}
      .lm-in-zoom{animation:lmInZoom .8s cubic-bezier(.22,1,.36,1) both;}
      .lm-out-zoom{animation:lmOutZoom .6s ease both;}
      @keyframes lmInZoom{from{opacity:0;transform:scale(.6) translateY(80px);filter:blur(14px)}to{opacity:1;transform:none;filter:blur(0)}}
      @keyframes lmOutZoom{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:scale(1.15);filter:blur(10px)}}
      .lm-in-wipe{animation:lmInWipe .8s cubic-bezier(.22,1,.36,1) both;}
      .lm-out-wipe{animation:lmOutWipe .7s cubic-bezier(.22,1,.36,1) both;}
      @keyframes lmInWipe{from{clip-path:inset(100% 0 0 0 round 22px);transform:translateY(30px)}to{clip-path:inset(0 0 0 0 round 22px);transform:none}}
      @keyframes lmOutWipe{from{clip-path:inset(0 0 0 0 round 22px);opacity:1}to{clip-path:inset(0 0 100% 0 round 22px);opacity:.4}}
      .lm-dots{display:flex;gap:6px;justify-content:center;margin-top:14px;}
      .lm-dots > i{width:22px;height:4px;border-radius:99px;background:${T.border};overflow:hidden;position:relative;}
      .lm-dots > i.on::after{content:"";position:absolute;inset:0;background:${T.accentSolid};transform-origin:0 50%;animation:lmDot var(--dur,6s) linear both;}
      @keyframes lmDot{from{transform:scaleX(0)}to{transform:scaleX(1)}}
      /* ── Bloque apilado: la pantalla queda fija y el contenido cambia (Thiago: "como las marcas top") ── */
      .lm-stack-item{transition:opacity .35s,transform .35s;}
      .lm-stack-item:not(.on){opacity:.32;}
      .lm-stack-item.on{opacity:1;}
      .lm-stepper-n{font-family:${MONO};font-size:11px;font-weight:700;width:34px;height:30px;border-radius:9px;border:1px solid ${T.border};background:transparent;color:${T.textSm};cursor:pointer;transition:all .25s;}
      .lm-stepper-n.on{background:${T.accentSolid};border-color:${T.accentSolid};color:#fff;transform:scale(1.08);}
      .lm-stepper-n.done{color:${T.accent};border-color:${T.accentSolid}66;}
      .lm-stack-active{animation:lmStepIn .45s cubic-bezier(.22,1,.36,1) both;}
      @keyframes lmStepIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
      .lm-stack-panel{position:absolute;inset:0;opacity:0;transform:translateY(40px) scale(.96) rotate(1.5deg);transition:opacity .5s cubic-bezier(.22,1,.36,1),transform .6s cubic-bezier(.22,1,.36,1);pointer-events:none;}
      .lm-stack-panel.on{opacity:1;transform:none;pointer-events:auto;}
      .lm-stack-panel.was{opacity:0;transform:translateY(-40px) scale(.96) rotate(-1.5deg);}
      @media(max-width:640px){.lm-tour-side{display:none!important}.lm-tour-body{grid-template-columns:1fr!important}}
      /* ── Comparativa "arena" ── */
      .lm-arena{display:grid;grid-template-columns:1.25fr repeat(6,1fr);gap:0;align-items:stretch;}
      .lm-arena-h{padding:16px 14px 14px;font-size:13px;font-weight:800;}
      .lm-arena-c{padding:14px;font-size:13px;border-top:1px solid rgba(255,255,255,.07);display:flex;align-items:center;min-height:56px;}
      .lm-arena-rec{background:linear-gradient(180deg,${T.accentSolid}22,${T.accentSolid}08);position:relative;}
      .lm-arena-rec.lm-arena-h{border-radius:18px 18px 0 0;border-top:3px solid ${T.accentSolid};}
      .lm-arena-last.lm-arena-rec{border-radius:0 0 18px 18px;}
      .lm-arena-vs{display:none;}
      @media(max-width:900px){
        .lm-arena{grid-template-columns:1.1fr 1fr 1fr;}
        .lm-arena .lm-arena-oth:not(.pick){display:none!important;}
        .lm-arena-vs{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-bottom:16px;}
        .lm-arena-c{min-height:0;padding:12px 10px;font-size:12.5px;}
      }
      .lm-arena-pill{font-family:${F};font-size:12.5px;font-weight:700;padding:7px 12px;border-radius:99px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);color:#cfe3da;cursor:pointer;}
      .lm-arena-pill.on{background:#fff;color:#0C1A18;border-color:#fff;}
      .lm-hi{position:relative;color:${T.text};font-weight:700;background-image:linear-gradient(120deg,var(--c,${T.accentSolid})55,var(--c,${T.accentSolid})55);background-repeat:no-repeat;background-size:0% 42%;background-position:0 88%;transition:background-size .6s cubic-bezier(.22,1,.36,1);transition-delay:var(--d,0s);padding:0 2px;border-radius:3px;}
      .is-in .lm-hi{background-size:100% 42%;}
      /* ── Bloque "una suscripción para tu suscripción" ── */
      .lm-subs-row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;}
      .lm-subs-row > span{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:99px;background:${T.card};border:1px solid ${T.border};font-size:14px;font-weight:700;color:${T.text};}
      [data-reveal-delay="1"]{transition-delay:.08s}[data-reveal-delay="2"]{transition-delay:.16s}[data-reveal-delay="3"]{transition-delay:.24s}[data-reveal-delay="4"]{transition-delay:.32s}
      /* Parallax suave con scroll-driven animations donde exista (Chrome/Edge). */
      @supports (animation-timeline: view()) {
        .lm-float{animation:lmFloat linear both;animation-timeline:view();animation-range:entry 0% exit 100%;}
        @keyframes lmFloat{from{transform:translateY(28px)}to{transform:translateY(-28px)}}
      }
      /* ── Bloque fijo manejado por el scroll (desktop) ── */
      .lm-pin{position:relative;}
      .lm-pin-inner{position:sticky;top:0;height:100vh;height:100svh;display:flex;flex-direction:column;justify-content:center;overflow:hidden;box-sizing:border-box;padding:48px 0;}
      .lm-track{display:flex;gap:28px;will-change:transform;transform:translateX(calc(var(--p,0) * var(--travel,0px)));}
      .lm-progress{height:3px;border-radius:99px;background:${T.border};overflow:hidden;}
      .lm-progress > i{display:block;height:100%;width:calc(var(--p,0) * 100%);background:${T.accentSolid};transition:width .08s linear;}
      /* ── Marquee de integraciones ── */
      .lm-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);mask-image:linear-gradient(90deg,transparent,#000 10%,#000 90%,transparent);}
      .lm-marquee-row{display:flex;gap:14px;width:max-content;animation:lmMarquee 38s linear infinite;}
      .lm-marquee-row.rev{animation-direction:reverse;animation-duration:46s;}
      .lm-marquee:hover .lm-marquee-row{animation-play-state:paused;}
      @keyframes lmMarquee{to{transform:translateX(-50%)}}
      .lm-chip{display:inline-flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;background:${T.card};border:1px solid ${T.border};font-size:14px;font-weight:700;color:${T.text};white-space:nowrap;}
      .lm-chip small{font-weight:600;color:${T.textSm};font-size:12px;}
      /* ── Tarjetas ── */
      .lm-card{background:${T.card};border:1px solid ${T.border};border-radius:22px;position:relative;overflow:hidden;}
      .lm-card::after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(255,255,255,${T.isDark ? ".04" : ".55"}),transparent 38%);}
      /* ── Cursor falso del loop del hero ── */
      .lm-cursor{position:absolute;width:22px;height:22px;pointer-events:none;z-index:5;transition:left .65s cubic-bezier(.22,1,.36,1),top .65s cubic-bezier(.22,1,.36,1),transform .18s;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35));}
      .lm-cursor.is-click{transform:scale(.82);}
      .lm-hero-widget .rc-bundle{margin:0!important;}
      .lm-hero-widget [data-rc-action]{cursor:default!important;}
      /* ── Pasos horizontales ── */
      .lm-step{flex:0 0 min(560px,86vw);}
      .lm-step-n{font-family:${FD};font-size:clamp(54px,7vw,96px);font-weight:800;letter-spacing:-.06em;line-height:1;color:${T.accentSolid};opacity:.16;}
      /* ── Celular: nada fijo; carrusel con snap y todo apilado ── */
      @media(max-width:900px){
        .lm-pin:not(.lm-pin-all) .lm-pin-inner{position:static;height:auto;display:block;overflow:visible;}
        .lm-pin-all .lm-pin-inner{justify-content:center;padding:16px 0!important;}
        .lm-stepper{grid-auto-flow:column;gap:4px!important;}
        .lm-stepper-n{width:28px;height:24px;font-size:10px;}
        .lm-stack-grid > div:first-child{grid-template-columns:1fr!important;}
        .lm-stack-stage .lm-dots > i.on::after{transform:none;animation:none;}
        .lm-track{transform:none!important;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 16px 18px;margin:0 -16px;scrollbar-width:none;}
        .lm-track::-webkit-scrollbar{display:none;}
        .lm-track > *{scroll-snap-align:center;}
        .lm-progress{display:none;}
        .lm-wrap{padding:0 16px;}
      }
      @media (prefers-reduced-motion: reduce){
        .lm-stack-active{animation:none;}
        [data-reveal]{opacity:1;transform:none;transition:none;clip-path:none;}
        .lm-in-flip,.lm-out-flip,.lm-in-zoom,.lm-out-zoom,.lm-in-wipe,.lm-out-wipe{animation:none;}
        .lm-face.is-out{display:none;}
        .lm-dots > i.on::after{animation:none;transform:none;}
        .lm-stack-panel{position:relative;opacity:1;transform:none;pointer-events:auto;margin-bottom:16px;}
        .lm-stack-item:not(.on){opacity:1;}
        .lm-float{animation:none;}
        .lm-marquee-row{animation:none;flex-wrap:wrap;width:auto;justify-content:center;}
        .lm-marquee{-webkit-mask-image:none;mask-image:none;}
        .lm-cursor{display:none;}
        .lm-pin-inner{position:static;height:auto;display:block;overflow:visible;}
        .lm-track{transform:none!important;flex-wrap:wrap;justify-content:center;}
        .lm-progress{display:none;}
      }
    `}</style>
  );
}

// Marca .is-in cuando cada [data-reveal] entra en pantalla. Una sola vez.
export function useReveal(rootRef) {
  useEffect(() => {
    const root = rootRef?.current || document;
    if (!("IntersectionObserver" in window)) { root.querySelectorAll("[data-reveal]").forEach(e => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    const seen = new WeakSet();
    const scan = () => { root.querySelectorAll("[data-reveal]:not(.is-in)").forEach(e => { if (!seen.has(e)) { seen.add(e); io.observe(e); } }); };
    scan();
    // Las páginas del sitio cambian de contenido dentro del mismo shell
    // (#/precios → #/funciones): hay que mirar los [data-reveal] nuevos también.
    const mo = "MutationObserver" in window ? new MutationObserver(() => scan()) : null;
    mo?.observe(root === document ? document.body : root, { childList: true, subtree: true });
    // Red de seguridad: lo que ya quedó a la vista (o arriba) se muestra sí o sí,
    // aunque el observer no haya avisado (saltos de scroll, celular, pestaña oculta).
    let raf = 0;
    const sweep = () => {
      raf = 0;
      const vh = window.innerHeight || 1;
      root.querySelectorAll("[data-reveal]:not(.is-in)").forEach(e => { const r = e.getBoundingClientRect(); if (r.top < vh * 0.92 && r.bottom > -vh) e.classList.add("is-in"); });
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sweep); };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const t = setTimeout(sweep, 400);
    return () => { io.disconnect(); mo?.disconnect(); window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); clearTimeout(t); if (raf) cancelAnimationFrame(raf); };
  }, [rootRef]);
}

// Progreso 0..1 de un bloque fijo: 0 cuando llega arriba, 1 cuando se destraba.
// Se escribe en la CSS var --p del propio bloque (sin re-render de React).
function useScrollProgress(ref, { enabled = true, steps = 0 } = {}) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const total = Math.max(1, r.height - vh);
      const p = Math.min(1, Math.max(0, -r.top / total));
      el.style.setProperty("--p", p.toFixed(4));
      if (steps > 1) {
        const k = Math.min(steps - 1, Math.floor(p * steps));
        if (el.dataset.step !== String(k)) el.dataset.step = String(k);
      }
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [ref, enabled, steps]);
}

function useMedia(query) {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on(); mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, [query]);
  return m;
}
const useReducedMotion = () => useMedia("(prefers-reduced-motion: reduce)");
const useDesktop = () => useMedia("(min-width: 901px)");

// ─── Widgets reales (mismo render que la tienda) ─────────────────────────
// Planes de MUESTRA. Son datos de ejemplo para mostrar el producto, no tiendas reales.
// Fotos REALES de producto (Unsplash, licencia libre; créditos en
// public/landing/prod-credits.json), servidas desde nuestro dominio. El widget
// solo acepta https: o data:, por eso la URL absoluta. Thiago, 26-sept: "que no
// parezca fake": nada de dibujos.
const ART_BASE = "https://www.recurrentesapp.com/landing/";
export const PRODUCT_ART = { cafe: ART_BASE + "prod-cafe.jpg", skin: ART_BASE + "prod-skin.jpg", pet: ART_BASE + "prod-pet.jpg", mate: ART_BASE + "prod-mate.jpg", supl: ART_BASE + "prod-supl.jpg" };
const withArt = (key, plan) => ({ ...plan, packs: plan.packs.map(p => ({ ...p, image: PRODUCT_ART[key] })) });
const SAMPLE_PLANS = {
  cafe: { id: "s1", product_title: "Café de especialidad · 250 g", frequency_days: 30, frequency_scales_with_qty: false, discount_pct: 10, base_price_ars: 12900,
    packs: [ { qty: 1, price_ars: 12900, label: "1 bolsa", note: "250 g", frequency_days: 30, freq_unit: "meses" }, { qty: 2, price_ars: 23900, label: "2 bolsas", note: "500 g", badge: "Más elegido", frequency_days: 30, freq_unit: "meses", default: true }, { qty: 4, price_ars: 44900, label: "4 bolsas", note: "1 kg", badge: "Mejor precio", frequency_days: 30, freq_unit: "meses" } ] },
  skin: { id: "s2", product_title: "Sérum de vitamina C", frequency_days: 60, frequency_scales_with_qty: false, discount_pct: 15, base_price_ars: 28900,
    packs: [ { qty: 1, price_ars: 28900, label: "1 frasco", note: "Dura 2 meses", frequency_days: 60, freq_unit: "meses", default: true }, { qty: 2, price_ars: 52900, label: "2 frascos", note: "Dura 4 meses", badge: "Ahorrás más", frequency_days: 120, freq_unit: "meses" } ] },
  pet: { id: "s3", product_title: "Alimento premium para perros · 3 kg", frequency_days: 30, frequency_scales_with_qty: false, discount_pct: 10, base_price_ars: 21500,
    packs: [ { qty: 1, price_ars: 21500, label: "1 bolsa", note: "3 kg", frequency_days: 30, freq_unit: "meses" }, { qty: 2, price_ars: 40900, label: "2 bolsas", note: "6 kg", badge: "Más elegido", frequency_days: 30, freq_unit: "meses", default: true }, { qty: 3, price_ars: 58900, label: "3 bolsas", note: "9 kg", frequency_days: 30, freq_unit: "meses" } ] },
  mate: { id: "s4", product_title: "Yerba orgánica · 1 kg", frequency_days: 30, frequency_scales_with_qty: false, discount_pct: 12, base_price_ars: 9800,
    packs: [ { qty: 2, price_ars: 18900, label: "2 kg", note: "Para un mes", frequency_days: 30, freq_unit: "meses", default: true }, { qty: 4, price_ars: 35900, label: "4 kg", note: "Para dos meses", badge: "Mejor precio", frequency_days: 60, freq_unit: "meses" } ] },
  supl: { id: "s5", product_title: "Cápsulas de magnesio", frequency_days: 30, frequency_scales_with_qty: false, discount_pct: 10, base_price_ars: 15900,
    packs: [ { qty: 1, price_ars: 15900, label: "1 frasco", note: "30 días", frequency_days: 30, freq_unit: "meses", default: true }, { qty: 3, price_ars: 42900, label: "3 frascos", note: "90 días", badge: "Más elegido", frequency_days: 90, freq_unit: "meses" } ] },
};
for (const k of Object.keys(SAMPLE_PLANS)) SAMPLE_PLANS[k] = withArt(k, SAMPLE_PLANS[k]);
export { SAMPLE_PLANS };
function safeVM(plan, merchant) { try { return buildBundleVM({ plan, merchant }); } catch (_) { return null; } }
function safeRender(vm, state) { try { return vm ? renderBundle(vm, state) : { html: "", css: "" }; } catch (_) { return { html: "", css: "" }; } }

// Un widget real, estático, en un estado dado. `scale` achica todo (en em).
export function LiveWidget({ plan, merchant, mode = "sub", idx = 0, style = {} }) {
  const vm = useMemo(() => safeVM(plan, merchant), [plan, merchant]);
  const out = useMemo(() => safeRender(vm, { mode, selectedIdx: idx }), [vm, mode, idx]);
  return (
    <div style={{ fontSize: 14, lineHeight: 1.35, ...style }}>
      <style>{out.css}</style>
      <div dangerouslySetInnerHTML={{ __html: out.html }}/>
    </div>
  );
}

// Widget en loop: simula al comprador eligiendo pack y pasando a suscripción,
// con un cursor que va hasta el control antes de cada cambio. Al terminar el
// guion avisa (onDone) para que el hero pase a la faceta siguiente.
const HERO_MERCHANT = { widget_variant: "v13", widget_color: "#10b981", widget_radius: 14, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: true,
  widget_texts: { headline: "Elegí tu pack", sub_label: "Suscribirme y ahorrar", sub_hint: "Te llega solo cada mes · pausás o cancelás cuando quieras" } };
const HERO_SCRIPT = [ // [modo, pack, qué se "toca" antes]
  { mode: "once", idx: 1, act: null },
  { mode: "once", idx: 2, act: ["pack", 2] },
  { mode: "sub",  idx: 2, act: ["mode", "sub"] },
  { mode: "sub",  idx: 1, act: ["pack", 1] },
];
const SKIN_MERCHANT = { widget_variant: "v05", widget_color: "#b06571", widget_radius: 18, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: false,
  widget_texts: { headline: "Tu rutina, en automático", sub_label: "Suscribirme", sub_hint: "Llega antes de que se te termine" } };
const SKIN_SCRIPT = [
  { mode: "once", idx: 0, act: null },
  { mode: "sub",  idx: 0, act: ["mode", "sub"] },
  { mode: "sub",  idx: 1, act: ["pack", 1] },
];
export function WidgetLoop({ T, plan = SAMPLE_PLANS.cafe, merchant = HERO_MERCHANT, script = HERO_SCRIPT, brand = "Tostado", brandColor = "#6b3f2a", art = PRODUCT_ART.cafe, onDone, fontSize = 13.5, active = true }) {
  const reduce = useReducedMotion();
  const vm = useMemo(() => safeVM(plan, merchant), [plan, merchant]);
  const states = useMemo(() => {
    const o = {};
    if (!vm) return o;
    for (const m of ["once", "sub"]) for (const p of vm.packs) o[m + ":" + p.idx] = safeRender(vm, { mode: m, selectedIdx: p.idx }).html;
    return o;
  }, [vm]);
  const css = useMemo(() => safeRender(vm, { mode: "sub", selectedIdx: 0 }).css, [vm]);
  const [step, setStep] = useState(reduce ? script.length - 1 : 0);
  const [cursor, setCursor] = useState({ x: 70, y: 40, click: false, on: false });
  const boxRef = useRef(null);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const cur = script[Math.min(step, script.length - 1)];
  const html = states[cur.mode + ":" + cur.idx] || Object.values(states)[0] || "";
  useEffect(() => { if (active && !reduce) { setStep(0); setCursor({ x: 70, y: 40, click: false, on: false }); } }, [active, reduce]);

  useEffect(() => {
    if (reduce || !active) return;
    let alive = true; let t1, t2;
    const isLast = step >= script.length - 1;
    const next = isLast ? null : script[step + 1];
    const go = () => {
      if (!alive) return;
      if (isLast) { doneRef.current?.(); return; }
      const box = boxRef.current;
      let target = null;
      if (box && next.act) {
        const [kind, v] = next.act;
        target = box.querySelector(`[data-rc-action="${kind}"][data-rc-value="${v}"]`);
      }
      if (target && box) {
        const br = box.getBoundingClientRect(), tr = target.getBoundingClientRect();
        setCursor({ x: tr.left - br.left + Math.min(tr.width * 0.35, 90), y: tr.top - br.top + tr.height / 2, click: false, on: true });
        t1 = setTimeout(() => { if (!alive) return; setCursor(c => ({ ...c, click: true })); t2 = setTimeout(() => { if (!alive) return; setCursor(c => ({ ...c, click: false })); setStep(s => s + 1); }, 160); }, 720);
      } else {
        t1 = setTimeout(() => alive && setStep(s => s + 1), 200);
      }
    };
    const t0 = setTimeout(go, step === 0 ? 900 : isLast ? 2200 : 1500);
    return () => { alive = false; clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [step, reduce, script, active]);

  return (
    <div className="lm-hero-widget lm-card" style={{ position: "relative", padding: "16px 16px 14px", boxShadow: "0 30px 70px -30px rgba(0,0,0,.5)" }}>
      {/* Cabecera de "tienda": para que se entienda que es la ficha de producto */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.borderL || T.border}` }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: brandColor + "22", flexShrink: 0, overflow: "hidden" }}><img src={art} alt="" width="38" height="38" style={{ display: "block", width: 38, height: 38, objectFit: "cover" }}/></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FD, fontSize: 14.5, fontWeight: 800, color: T.text, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{brand} · {plan.product_title}</div>
          <div style={{ fontSize: 11.5, color: T.textSm }}>Tienda de ejemplo · así se ve en tu ficha de producto</div>
        </div>
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, color: T.accent, background: T.accentSolid + "18", borderRadius: 99, padding: "3px 9px", letterSpacing: 0.4, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: 99, background: T.accentSolid }}/>EN VIVO</span>
      </div>
      <div ref={boxRef} style={{ position: "relative", fontSize, lineHeight: 1.35, color: "#161616" }}>
        <style>{css}</style>
        <div dangerouslySetInnerHTML={{ __html: html }}/>
        {!reduce && (
          <svg className={"lm-cursor" + (cursor.click ? " is-click" : "")} style={{ left: cursor.x, top: cursor.y, opacity: cursor.on ? 1 : 0 }} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 3l14 8.5-6.2 1.6L10 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </div>
  );
}

// Faceta 3: la página de suscripción (el checkout de Recurrentes con la marca de
// la tienda), con el botón a la tienda de ejemplo (#/tostado).
export function SubPageMock({ T, onDone, active = true }) {
  const reduce = useReducedMotion();
  const doneRef = useRef(onDone); doneRef.current = onDone;
  useEffect(() => { if (reduce || !active) return; const t = setTimeout(() => doneRef.current?.(), 5200); return () => clearTimeout(t); }, [reduce, active]);
  const c = "#6b3f2a";
  const row = (l, v, b) => <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: b ? "#111" : "#555", fontWeight: b ? 800 : 500 }}><span>{l}</span><span style={{ fontVariantNumeric: "tabular-nums" }}>{v}</span></div>;
  return (
    <div className="lm-card" style={{ padding: 0, boxShadow: "0 30px 70px -30px rgba(0,0,0,.5)", background: "#fff", color: "#111" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #eee" }}>
        <img src={PRODUCT_ART.cafe} alt="" width="26" height="26" style={{ borderRadius: 6, objectFit: "cover" }}/>
        <span style={{ fontFamily: "Georgia,serif", fontWeight: 700, fontSize: 16, color: c, letterSpacing: .5 }}>TOSTADO</span>
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#888" }}>Checkout seguro · Mercado Pago</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,.9fr)", gap: 0 }} className="lm-subpage-grid">
        <style>{`@media(max-width:640px){.lm-subpage-grid{grid-template-columns:1fr!important;}}`}</style>
        <div style={{ padding: 16, display: "grid", gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#888", letterSpacing: .6, textTransform: "uppercase" }}>Contacto</div>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "9px 11px", fontSize: 12.5, color: "#111" }}>ana@ejemplo.com</div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#888", letterSpacing: .6, textTransform: "uppercase", marginTop: 4 }}>Entrega</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "9px 11px", fontSize: 12.5 }}>Ana Pérez</div>
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "9px 11px", fontSize: 12.5 }}>CP 1425</div>
          </div>
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: "9px 11px", fontSize: 12.5 }}>Av. Santa Fe 3200 · Palermo, CABA</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `1.5px solid ${c}`, borderRadius: 10, padding: "9px 11px", fontSize: 12.5, background: c + "0d" }}><span><b>Andreani a domicilio</b><br/><span style={{ color: "#777", fontSize: 11 }}>2 a 4 días hábiles</span></span><b>{fmtARS(3900)}</b></div>
          <button type="button" style={{ marginTop: 4, background: c, color: "#fff", border: "none", borderRadius: 12, padding: "13px 14px", fontFamily: FD, fontWeight: 800, fontSize: 14, cursor: "default" }}>Pagar {fmtARS(27800)} · cada mes</button>
        </div>
        <div style={{ padding: 16, background: "#f6f3ef", borderLeft: "1px solid #eee", display: "grid", gap: 10, alignContent: "start" }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px 1fr", gap: 10, alignItems: "center" }}>
            <span style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", border: "1px solid #e8e2da" }}><img src={PRODUCT_ART.cafe} alt="" width="56" height="56" style={{ display: "block", objectFit: "cover" }}/></span>
            <span style={{ fontSize: 12.5, lineHeight: 1.4 }}><b>Café de especialidad · 2 bolsas</b><br/><span style={{ color: "#777" }}>Suscripción · te llega cada mes</span></span>
          </div>
          {row("Subtotal", fmtARS(25800))}
          {row("Ahorrás por suscribirte", "−" + fmtARS(1900))}
          {row("Envío", fmtARS(3900))}
          <div style={{ borderTop: "1px solid #e3ddd4", paddingTop: 8 }}>{row("Total por envío", fmtARS(27800), true)}</div>
          <a href="#/tostado" style={{ marginTop: 6, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "11px 12px", borderRadius: 10, border: `1.5px solid ${c}`, color: c, fontWeight: 800, fontSize: 12.5, textDecoration: "none", background: "#fff" }}>Ver la tienda de ejemplo <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></a>
        </div>
      </div>
    </div>
  );
}

// Las tres facetas del hero, cada pasaje con una transición distinta:
// café → vitamina: flip 3D · vitamina → página: zoom con desenfoque · página → café: cortina.
const FACETS = [
  { key: "cafe", trans: "flip", label: "Widget en la ficha · café" },
  { key: "skin", trans: "zoom", label: "Widget · skincare" },
  { key: "page", trans: "wipe", label: "Página de suscripción" },
];
export function HeroWidgetLoop({ T }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [prev, setPrev] = useState(null); // { i, trans } la faceta que sale
  const next = () => setI(cur => { const n = (cur + 1) % FACETS.length; setPrev({ i: cur, trans: FACETS[n].trans }); return n; });
  useEffect(() => { if (prev == null) return; const t = setTimeout(() => setPrev(null), 800); return () => clearTimeout(t); }, [prev]);
  // Las tres facetas están SIEMPRE montadas y apiladas: el escenario mide lo que la
  // más alta (Thiago: "que ese cuadrado se mantenga del mismo tamaño", sin cortar nada).
  const face = (k, active) => k === "cafe" ? <WidgetLoop T={T} active={active} onDone={active && !reduce ? next : undefined}/>
    : k === "skin" ? <WidgetLoop T={T} plan={SAMPLE_PLANS.skin} merchant={SKIN_MERCHANT} script={SKIN_SCRIPT} brand="Ámbar" brandColor="#b06571" art={PRODUCT_ART.skin} active={active} onDone={active && !reduce ? next : undefined}/>
    : <SubPageMock T={T} active={active} onDone={active && !reduce ? next : undefined}/>;
  const cur = FACETS[i];
  return (
    <div style={{ position: "relative" }}>
      <div style={{ position: "absolute", inset: -40, background: `radial-gradient(circle at 60% 30%, ${T.accentSolid}2e 0%, transparent 60%)`, filter: "blur(30px)", pointerEvents: "none" }}/>
      <div className="lm-stage">
        {FACETS.map((f, k) => {
          const isCur = k === i, isOut = prev != null && prev.i === k && !reduce;
          const cls = "lm-face " + (isCur ? (prev && !reduce ? "lm-in-" + cur.trans : "") : isOut ? "is-out lm-out-" + prev.trans : "is-hidden");
          return <div key={f.key} className={cls} aria-hidden={!isCur}>{face(f.key, isCur)}</div>;
        })}
      </div>
      <div className="lm-dots" aria-hidden="true">{FACETS.map((f, k) => <i key={f.key} className={k === i ? "on" : ""} style={{ "--dur": k === 2 ? "5.2s" : k === 1 ? "6.5s" : "8.5s" }}/>)}</div>
      <div style={{ textAlign: "center", fontSize: 12, color: T.textSm, marginTop: 6 }}>{cur.label} · datos de ejemplo</div>
    </div>
  );
}

// Widget REAL e interactivo (la tienda de ejemplo): se puede cambiar el modo y el pack.
export function InteractiveWidget({ plan, merchant, initialMode = "once", onCta, style = {} }) {
  const vm = useMemo(() => safeVM(plan, merchant), [plan, merchant]);
  const [mode, setMode] = useState(initialMode);
  const [idx, setIdx] = useState(() => { const d = vm?.packs?.find(p => p.isDefault) || vm?.packs?.[0]; return d ? d.idx : 0; });
  const out = useMemo(() => safeRender(vm, { mode, selectedIdx: idx }), [vm, mode, idx]);
  const onClick = (e) => {
    const el = e.target.closest("[data-rc-action]"); if (!el) return;
    const a = el.getAttribute("data-rc-action"), v = el.getAttribute("data-rc-value");
    if (a === "mode" && v) setMode(v);
    else if (a === "pack" && v != null) setIdx(Number(v));
    else if (a === "cta") onCta?.(mode, vm?.packs?.find(p => p.idx === idx) || null);
  };
  const onChange = (e) => { const el = e.target.closest("[data-rc-action]"); if (!el) return; const a = el.getAttribute("data-rc-action"), v = el.getAttribute("data-rc-value") ?? e.target.value; if (a === "pack" && v != null) setIdx(Number(v)); if (a === "mode" && v) setMode(v); };
  return (
    <div onClick={onClick} onChange={onChange} style={{ fontSize: 14, lineHeight: 1.35, ...style }}>
      <style>{out.css}</style>
      <div dangerouslySetInnerHTML={{ __html: out.html }}/>
    </div>
  );
}

// ─── Sellos de partner (Thiago, 26-sept: "somos partners, ponerlo por todos lados") ─
// Tenemos cuenta de Partner en Shopify (la app se crea desde el Partner
// Dashboard), app publicada en la tienda de apps de Tiendanube y aplicación en
// Mercado Pago Developers. Los nombres son de cada empresa; no usamos sus logos.
export const PARTNERS = [
  { n: "Shopify", t: "Partner", c: "#96bf48", logo: "/brand/shopify-bag.svg" },
  { n: "Tiendanube", t: "Partner", c: "#2c3ee6", logo: "/brand/tiendanube.png" },
  { n: "Mercado Pago", t: "Partner", c: "#009ee3", logo: "/brand/mercadopago.png" },
];
export function PartnerBadges({ T, compact = false, tone = "auto", style = {} }) {
  const dark = tone === "dark" || (tone === "auto" && T.isDark);
  return (
    <div style={{ display: "flex", gap: compact ? 8 : 10, flexWrap: "wrap", alignItems: "center", ...style }}>
      {PARTNERS.map(p => (
        <span key={p.n} title={`${p.n} ${p.t}`} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: compact ? "5px 10px" : "7px 12px", borderRadius: 99, border: `1px solid ${dark ? "rgba(255,255,255,.14)" : T.border}`, background: dark ? "rgba(255,255,255,.05)" : T.card, fontSize: compact ? 11.5 : 12.5, fontWeight: 700, color: dark ? "#EAF3EF" : T.text, whiteSpace: "nowrap" }}>
          <img src={p.logo} alt="" width={compact ? 16 : 18} height={compact ? 16 : 18} style={{ display: "block", objectFit: "contain", borderRadius: 3 }}/>
          {p.n} <span style={{ fontWeight: 600, color: dark ? "#A9C3B9" : T.textSm }}>{p.t}</span>
        </span>
      ))}
    </div>
  );
}

// ─── 2. Bloque fijo: distintos diseños y colores, pasando con el scroll ──
const DESIGNS = [
  { key: "cafe", brand: "Tostado", niche: "Café de especialidad", variant: "v13", color: "#10b981", radius: 14, ink: "#0f1a14", mode: "sub", idx: 1, texts: { headline: "Elegí tu pack" } },
  { key: "skin", brand: "Ámbar", niche: "Skincare", variant: "v05", color: "#b06571", radius: 18, ink: "#2a1418", mode: "sub", idx: 0, texts: { headline: "Tu rutina, en automático" } },
  { key: "pet",  brand: "Patitas", niche: "Alimento para mascotas", variant: "v11", color: "#2563eb", radius: 12, ink: "#0e1a33", mode: "sub", idx: 1, texts: { headline: "Que nunca falte" } },
  { key: "mate", brand: "Cebado", niche: "Yerba y mates", variant: "v08", color: "#f59e0b", radius: 16, ink: "#1a1408", mode: "sub", idx: 0, texts: { headline: "Elegí tu pack" } },
  { key: "supl", brand: "Nodo", niche: "Suplementos", variant: "v01", color: "#7c3aed", radius: 10, ink: "#160f2a", mode: "sub", idx: 1, texts: { headline: "Armá tu suscripción" } },
];
function DesignCard({ T, d }) {
  const merchant = useMemo(() => ({ widget_variant: d.variant, widget_color: d.color, widget_radius: d.radius, widget_mode_default: "sub", widget_show_per_unit: true, widget_texts: d.texts }), [d]);
  return (
    <div className="lm-step" style={{ flex: "0 0 min(440px, 86vw)" }}>
      <div className="lm-card" style={{ padding: 0 }}>
        {/* Barra de la "tienda" con el color de marca */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: d.color, color: "#fff" }}>
          <span style={{ fontFamily: FD, fontWeight: 800, fontSize: 15, letterSpacing: -0.2 }}>{d.brand}</span>
          <span style={{ fontSize: 11.5, opacity: .85 }}>{d.niche}</span>
          <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 700, opacity: .9, letterSpacing: .3, textTransform: "uppercase" }}>{d.variant === "v08" ? "Oscuro" : d.variant === "v05" ? "Tarjetas" : d.variant === "v11" ? "Foto" : d.variant === "v13" ? "Foto + check" : "Clásico"}</span>
        </div>
        <div style={{ padding: "14px 14px 12px", background: T.isDark ? "#fff" : "#fff", color: "#161616" }}>
          <LiveWidget plan={SAMPLE_PLANS[d.key]} merchant={merchant} mode={d.mode} idx={d.idx} style={{ fontSize: 12.5 }}/>
        </div>
      </div>
      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: T.textSm }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: d.color, boxShadow: `0 0 0 3px ${d.color}33` }}/>
        Color, letra, bordes y textos: todo de la tienda. Trece diseños para elegir.
      </div>
    </div>
  );
}
export function StickyDesigns({ T }) {
  const ref = useRef(null);
  const desktop = useDesktop();
  const reduce = useReducedMotion();
  useScrollProgress(ref, { enabled: desktop && !reduce });
  const n = DESIGNS.length;
  // Recorrido: el ancho del carril menos lo que entra en pantalla, en px de tarjeta.
  return (
    <section id="rec-disenos" ref={ref} className="lm-pin" style={{ height: desktop && !reduce ? `${n * 70 + 60}vh` : "auto", background: T.surface, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <div className="lm-pin-inner" style={{ padding: desktop ? 0 : "64px 0" }}>
        <div className="lm-wrap" style={{ width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 26 }} data-reveal="tilt">
            <div>
              <div className="lm-eyebrow">Se adapta a tu tienda</div>
              <h2 className="lm-h2">Un widget por marca,<br/>no una marca por widget</h2>
              <p className="lm-sub">El botón de suscripción toma tus colores, tu letra y tus textos. Estos son cinco de los trece diseños, con datos de ejemplo.</p>
            </div>
            <div className="lm-progress" style={{ width: 160, marginBottom: 10 }}><i/></div>
          </div>
        </div>
        <div className="lm-wrap" style={{ width: "100%", overflow: desktop ? "visible" : "hidden" }}>
          {/* --travel: cuánto se corre el carril de punta a punta (lo que sobra del ancho) */}
          <div className="lm-track" style={{ "--travel": `calc(-1 * ((min(440px, 86vw) + 28px) * ${n} - 100%))`, alignItems: "flex-start" }}>
            {DESIGNS.map((d) => <DesignCard key={d.key} T={T} d={d}/>)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── 3. Cómo funciona, horizontal ────────────────────────────────────────
function MiniWidgetStep({ T }) {
  const merchant = useMemo(() => ({ widget_variant: "v06", widget_color: T.accentSolid, widget_radius: 12, widget_mode_default: "sub", widget_show_per_unit: false, widget_texts: { headline: "Elegí tu pack" } }), [T.accentSolid]);
  return <div style={{ background: "#fff", borderRadius: 14, padding: 12, color: "#111" }}><LiveWidget plan={SAMPLE_PLANS.supl} merchant={merchant} mode="sub" idx={1} style={{ fontSize: 12 }}/></div>;
}
const BRAND_DEFAULT = { name: "Nodo", product: "Cápsulas de magnesio × 3", sub: "Pack 3 frascos · suscripción", price: 42900, art: null, color: "#7c3aed", freq: "cada mes" };
function MpStep({ T, b = BRAND_DEFAULT }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, color: "#111", fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <img src="/brand/mercadopago.png" alt="" style={{ width: 34, height: 34, objectFit: "contain", borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = "none"; }}/>
        <div><div style={{ fontWeight: 800, fontSize: 14 }}>Mercado Pago</div><div style={{ fontSize: 12, color: "#6b6b6b" }}>Suscripción de {b.name} · cobro automático</div></div>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#1f7a3e", background: "#e7f6ec", borderRadius: 99, padding: "3px 9px" }}>APROBADO</span>
      </div>
      {[["1 de mayo", "Pago n.º 1", fmtARS(b.price)], ["1 de junio", "Pago n.º 2", fmtARS(b.price)], ["1 de julio", "Pago n.º 3", fmtARS(b.price)]].map(([d, l, v], i) => (
        <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "9px 0", borderTop: i ? "1px solid #eee" : "none", fontSize: 13 }}>
          <span><b style={{ display: "block" }}>{l}</b><span style={{ color: "#6b6b6b", fontSize: 12 }}>{d} · tarjeta terminada en 4421</span></span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{v}</b>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 12, color: "#6b6b6b", lineHeight: 1.45 }}>El cliente paga en el checkout de Mercado Pago. La plata entra en tu cuenta de MP, como cualquier venta.</div>
    </div>
  );
}
function OrderStep({ T, b = BRAND_DEFAULT }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, color: "#111", fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div><div style={{ fontWeight: 800, fontSize: 14 }}>Pedido #1042 · {b.name}</div><div style={{ fontSize: 12, color: "#6b6b6b" }}>Creado por Recurrentes · etiqueta RECURRENTE</div></div>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#1f7a3e", background: "#e7f6ec", borderRadius: 99, padding: "3px 9px" }}>PAGADO</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid #eee", borderBottom: "1px solid #eee", fontSize: 13 }}>
        {b.art ? <img src={b.art} alt="" width="44" height="44" style={{ borderRadius: 10, objectFit: "cover" }}/> : <span style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg,#a78bfa,#6d28d9)" }}/>}
        <span><b style={{ display: "block" }}>{b.product}</b><span style={{ color: "#6b6b6b", fontSize: 12 }}>{b.sub}</span></span>
        <b>{fmtARS(b.price)}</b>
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 12, fontSize: 12.5, color: "#444" }}>
        <div>📦 Envío: Andreani a domicilio · Palermo, CABA</div>
        <div>👤 Cliente y dirección cargados · stock descontado</div>
        <div>✉️ Confirmación enviada · portal para pausar o cancelar</div>
      </div>
    </div>
  );
}
const STEPS = [
  { n: "01", t: "El cliente se suscribe", d: "En tu ficha de producto elige el pack y la frecuencia. Paga en el checkout de Recurrentes, con tu marca.", C: MiniWidgetStep },
  { n: "02", t: "Mercado Pago cobra cada período", d: "Sin que nadie haga nada. Si una tarjeta falla, se reintenta y le avisamos al cliente.", C: MpStep },
  { n: "03", t: "La orden aparece en tu tienda", d: "Con dirección, envío y stock descontado. Vos la ves como cualquier venta y la despachás.", C: OrderStep },
];
export function HorizontalSteps({ T }) {
  const ref = useRef(null);
  const desktop = useDesktop();
  const reduce = useReducedMotion();
  useScrollProgress(ref, { enabled: desktop && !reduce });
  const n = STEPS.length;
  return (
    <section id="rec-como-funciona" ref={ref} className="lm-pin" style={{ height: desktop && !reduce ? `${n * 80 + 40}vh` : "auto" }}>
      <div className="lm-pin-inner" style={{ padding: desktop ? 0 : "72px 0 48px" }}>
        <div className="lm-wrap" style={{ width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 26 }} data-reveal="swing">
            <div>
              <div className="lm-eyebrow">Cómo funciona</div>
              <h2 className="lm-h2">Tres pasos.<br/>Vos solo despachás.</h2>
            </div>
            <div className="lm-progress" style={{ width: 160, marginBottom: 10 }}><i/></div>
          </div>
        </div>
        <div className="lm-wrap" style={{ width: "100%" }}>
          <div className="lm-track" style={{ "--travel": `calc(-1 * ((min(560px, 86vw) + 28px) * ${n} - 100%))`, alignItems: "stretch" }}>
            {STEPS.map(({ n: num, t, d, C }, i) => (
              <div key={num} className="lm-step">
                <div className="lm-card" style={{ padding: 22, height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: FD, fontSize: 21, fontWeight: 800, letterSpacing: -0.4, color: T.text, lineHeight: 1.15 }}>{t}</div>
                      <div style={{ fontSize: 14, color: T.textSm, lineHeight: 1.55, marginTop: 6, maxWidth: 420 }}>{d}</div>
                    </div>
                    <div className="lm-step-n">{num}</div>
                  </div>
                  <C T={T}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Subrayado tipo marcador que se pinta cuando el bloque aparece (.is-in del ancestro).
function Hi({ T, d = 0, children }) {
  return <span className="lm-hi" style={{ "--d": `${0.35 + d * 0.35}s`, "--c": T.accentSolid }}>{children}</span>;
}

// ─── 4. El precio como arma ──────────────────────────────────────────────
export function PriceWeapon({ T, onDemo, hideHead = false }) {
  const [rev, setRev] = useState(2000000); // facturación mensual en suscripciones (ARS)
  const [rate, setRate] = useState(2);
  const fee = rev * rate / 100;
  const tiers = PRICING_TIERS.filter(t => t.usd > 0).slice(0, 3);
  const free = PRICING_TIERS[0];
  const inp = { fontFamily: F, fontSize: 15, fontWeight: 600, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", width: "100%", outline: "none" };
  return (
    <section id="rec-precios" className="lm-wrap" style={{ padding: hideHead ? "24px 24px 104px" : "104px 24px" }}>
      <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 28px" }} data-reveal="flip">
        {!hideHead && <><div className="lm-eyebrow">Precio</div>
        <h2 className="lm-h2">Un costo de instalación<br/>y un abono. <em style={{ fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 500 }}>Nada más.</em></h2></>}
        <p className="lm-sub" style={{ margin: "0 auto" }}>Las plataformas con comisión te sacan <Hi T={T} d={1}>un poquito</Hi> de cada venta. Un poquito, todos los meses, de todas las ventas. Al año son <Hi T={T} d={2}>miles de dólares</Hi> que se van sin que lo veas en ninguna factura. Acá pagás la instalación, el abono de tu tramo, <Hi T={T} d={3}>y listo</Hi>.</p>
      </div>
      <div data-reveal="pop" style={{ textAlign: "center", margin: "0 auto 44px", maxWidth: 760 }}>
        <div className="lm-subs-row">
          {[["Netflix", "abono fijo"], ["Tu app de running", "abono fijo"], ["Tu cliente con vos", "abono fijo"], ["Recurrentes", "abono fijo · 0% por venta"]].map(([n, d], i) => (
            <span key={n} style={i === 3 ? { borderColor: T.accentSolid, color: T.accent, background: T.accentSolid + "14" } : undefined}><span style={{ width: 8, height: 8, borderRadius: 99, background: i === 3 ? T.accentSolid : T.textSm, display: "inline-block" }}/>{n}<small style={{ fontWeight: 600, color: T.textSm }}>· {d}</small></span>
          ))}
        </div>
        <div style={{ fontSize: 14.5, color: T.textMd, marginTop: 16, lineHeight: 1.6, maxWidth: 620, marginLeft: "auto", marginRight: "auto" }}>Sí, leíste bien: <Hi T={T} d={1}>te cobramos una suscripción por vender suscripciones</Hi>. Lo sabemos, es redundante. Pero es <Hi T={T} d={2}>el mismo trato que vos le das a tu cliente</Hi>: un precio fijo, que sabés antes de que empiece el mes, y nadie metiendo la mano en cada venta.</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="lm-price-grid">
        <style>{`@media(max-width:900px){.lm-price-grid{grid-template-columns:1fr!important;}.lm-calc-grid{grid-template-columns:1fr!important;}}`}</style>
        <div className="lm-card" style={{ padding: 26 }} data-reveal="tilt">
          <div style={{ fontSize: 12, fontWeight: 800, color: T.textSm, letterSpacing: .6, textTransform: "uppercase", marginBottom: 14 }}>Los demás</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: T.text, lineHeight: 1.1 }}>Abono <span style={{ color: T.textSm }}>+</span> 1–2% de cada venta</div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: T.textMd, lineHeight: 1.5 }}>
            {["Cuanto más vendés, más pagás.", "El porcentaje se suma a la comisión de la pasarela.", "Nunca sabés cuánto te va a costar el mes."].map(t => <div key={t} style={{ display: "flex", gap: 8 }}><span style={{ color: T.red, fontWeight: 800 }}>×</span>{t}</div>)}
          </div>
        </div>
        <div className="lm-card" style={{ padding: 26, borderColor: T.accentSolid + "88", boxShadow: `0 24px 60px -30px ${T.accentSolid}88` }} data-reveal="swing">
          <div style={{ fontSize: 12, fontWeight: 800, color: T.accent, letterSpacing: .6, textTransform: "uppercase", marginBottom: 14 }}>Recurrentes</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: T.text, lineHeight: 1.1 }}>USD {INSTALL_USD} una vez <span style={{ color: T.textSm }}>+</span> abono fijo</div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: T.textMd, lineHeight: 1.5 }}>
            {[`Gratis hasta ${FREE_SUBSCRIBERS} suscriptores activos.`, "0% de comisión por venta. Siempre.", `La puesta en marcha se paga cuando ya está funcionando.`].map(t => <div key={t} style={{ display: "flex", gap: 8 }}><span style={{ color: T.accent, fontWeight: 800 }}>✓</span>{t}</div>)}
          </div>
        </div>
      </div>

      {/* Tramos reales (shared/platform/pricing.js) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 16 }} className="lm-tiers" data-reveal="rise">
        <style>{`@media(max-width:900px){.lm-tiers{grid-template-columns:repeat(2,minmax(0,1fr))!important;}}`}</style>
        {[free, ...tiers].map((t, i) => (
          <div key={t.id} className="lm-card" style={{ padding: "16px 18px", borderColor: i === 0 ? T.accentSolid + "66" : T.border }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textSm, letterSpacing: .5, textTransform: "uppercase" }}>{t.label}</div>
            <div style={{ fontFamily: FD, fontSize: 26, fontWeight: 800, letterSpacing: -1, color: i === 0 ? T.accent : T.text, marginTop: 4 }}>{t.usd === 0 ? "Gratis" : <>USD {t.usd}<span style={{ fontSize: 12, fontWeight: 600, color: T.textSm, letterSpacing: 0 }}>/mes</span></>}</div>
            <div style={{ fontSize: 12.5, color: T.textSm, marginTop: 4 }}>{t.max == null ? `Más de ${t.min - 1} suscriptores` : t.min <= 1 ? `Hasta ${t.max} suscriptores` : `${t.min} a ${t.max} suscriptores`}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: T.textSm, textAlign: "center", marginTop: 12, maxWidth: 720, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>Después sigue subiendo por tramos, y siempre pasa lo mismo: <b style={{ color: T.text }}>cuantos más clientes activos tenés, más barato te sale el plan por cada cliente</b>. Suscriptor activo = cliente con su suscripción cobrando. Precios en dólares, sin contrato.</div>

      {/* Calculadora: el argumento que se toca */}
      <div className="lm-card" style={{ marginTop: 40, padding: 26 }} data-reveal="wipe">
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 28, alignItems: "center" }} className="lm-calc-grid">
          <div>
            <div style={{ fontFamily: FD, fontSize: 22, fontWeight: 800, letterSpacing: -0.5, marginBottom: 6 }}>¿Cuánto te lleva una comisión?</div>
            <div style={{ fontSize: 14, color: T.textSm, lineHeight: 1.55, marginBottom: 18 }}>Poné cuánto facturás por mes en suscripciones y mirá cuánto se quedaría una plataforma con comisión por venta.</div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: T.textSm, textTransform: "uppercase", letterSpacing: .5, marginBottom: 6 }}>Facturación mensual en suscripciones</label>
            <input type="range" min={200000} max={20000000} step={100000} value={rev} onChange={e => setRev(Number(e.target.value))} style={{ width: "100%", accentColor: T.accentSolid, marginBottom: 10 }} aria-label="Facturación mensual"/>
            <input type="text" inputMode="numeric" value={fmtARS(rev)} onChange={e => { const n = Number(String(e.target.value).replace(/[^\d]/g, "")); if (Number.isFinite(n)) setRev(Math.min(50000000, Math.max(0, n))); }} style={inp} aria-label="Facturación mensual en pesos"/>
            <div style={{ display: "flex", gap: 8, marginTop: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, color: T.textSm }}>Comisión de los demás:</span>
              {[1, 2, 3].map(r => <button key={r} onClick={() => setRate(r)} style={{ fontFamily: F, fontSize: 13, fontWeight: 700, padding: "6px 12px", borderRadius: 99, cursor: "pointer", border: `1px solid ${rate === r ? T.accentSolid : T.border}`, background: rate === r ? T.accentSolid + "1a" : "transparent", color: rate === r ? T.accent : T.textMd }}>{r}%</button>)}
            </div>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ padding: "18px 20px", borderRadius: 16, background: T.red + "12", border: `1px solid ${T.red}44` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.red, letterSpacing: .5, textTransform: "uppercase" }}>Con {rate}% de comisión</div>
              <div style={{ fontFamily: FD, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, color: T.text, lineHeight: 1.1, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{fmtARS(fee)}<span style={{ fontSize: 14, fontWeight: 600, color: T.textSm, letterSpacing: 0 }}> /mes</span></div>
              <div style={{ fontSize: 13, color: T.textMd, marginTop: 4 }}>{fmtARS(fee * 12)} al año que se van sin que los veas en ninguna factura.</div>
            </div>
            <div style={{ padding: "18px 20px", borderRadius: 16, background: T.accentSolid + "14", border: `1px solid ${T.accentSolid}66` }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: T.accent, letterSpacing: .5, textTransform: "uppercase" }}>Con Recurrentes · 0%</div>
              <div style={{ fontFamily: FD, fontSize: 34, fontWeight: 800, letterSpacing: -1.2, color: T.text, lineHeight: 1.1, marginTop: 4 }}>$0</div>
              <div style={{ fontSize: 13, color: T.textMd, marginTop: 4 }}>Solo el abono de tu tramo. Te ahorrás {fmtARS(fee * 12)} por año.</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ textAlign: "center", marginTop: 28 }} data-reveal>
        <button onClick={onDemo} style={{ ...BtnSolid(T), padding: "14px 24px", fontSize: 15, borderRadius: 14 }}>Pedir demo</button>
      </div>
    </section>
  );
}

// ─── 5. Integraciones en movimiento ──────────────────────────────────────
const INTEG = [
  { n: "Shopify", s: "Tienda", ok: true }, { n: "Tiendanube", s: "Tienda", ok: true }, { n: "Mercado Pago", s: "Pasarela", ok: true },
  { n: "Andreani", s: "Envíos, vía tu tienda", ok: true }, { n: "OCA", s: "Envíos, vía tu tienda", ok: true }, { n: "Correo Argentino", s: "Envíos, vía tu tienda", ok: true },
  { n: "Meta Ads", s: "Conversions API", ok: true }, { n: "WhatsApp", s: "Avisos automáticos", ok: true }, { n: "Email", s: "Flujos con tu marca", ok: true },
  { n: "WooCommerce", s: "La conectamos a tu medida", ok: true }, { n: "Empretienda", s: "La conectamos a tu medida", ok: true }, { n: "VTEX", s: "La conectamos a tu medida", ok: true },
  { n: "Desarrollo propio", s: "La conectamos a tu medida", ok: true }, { n: "Mobbex", s: "Próximamente", ok: false },
];
function Chip({ T, it }) {
  return (
    <span className="lm-chip" style={{ borderStyle: it.ok ? "solid" : "dashed", opacity: it.ok ? 1 : .75 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: it.ok ? T.accentSolid : T.yellow, flexShrink: 0 }}/>
      {it.n}<small>· {it.s}</small>
    </span>
  );
}
export function IntegrationsMarquee({ T }) {
  const a = INTEG, b = [...INTEG].reverse();
  return (
    <section id="rec-tiendas" style={{ padding: "96px 0", background: T.surface, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <div className="lm-wrap" style={{ textAlign: "center", marginBottom: 32 }} data-reveal="spin">
        <div className="lm-eyebrow">Integraciones</div>
        <h2 className="lm-h2">Se conecta con lo que ya usás</h2>
        <p className="lm-sub" style={{ margin: "0 auto" }}>Shopify y Tiendanube como tienda, Mercado Pago como pasarela. Los envíos se cotizan con los correos que ya tenés configurados en tu tienda, y la orden sale lista para despachar.</p>
        <PartnerBadges T={T} style={{ justifyContent: "center", marginTop: 18 }}/>
      </div>
      <div className="lm-marquee" style={{ display: "grid", gap: 14 }}>
        <div className="lm-marquee-row">{[...a, ...a].map((it, i) => <Chip key={it.n + i} T={T} it={it}/>)}</div>
        <div className="lm-marquee-row rev">{[...b, ...b].map((it, i) => <Chip key={it.n + i} T={T} it={it}/>)}</div>
      </div>
    </section>
  );
}

// ─── Reseñas: PREPARADO, no se muestra hasta tener clientes reales ─────
// Cuando haya testimonios reales, completar RESENAS_REALES y montar
// <ReviewsBlock T={T}/> en Landing.jsx (está comentado ahí). Los datos de
// abajo son de EJEMPLO para ver el diseño; no representan clientes.
export const RESENAS_REALES = [
  // { q: "…", n: "Nombre A.", r: "Rubro de la tienda", p: "Shopify" },
];
const RESENAS_EJEMPLO = [
  { q: "Ejemplo de reseña: acá va lo que dijo el cliente, en sus palabras.", n: "Nombre A.", r: "Rubro · Ciudad", p: "Shopify" },
  { q: "Ejemplo de reseña: qué cambió en su negocio con la recompra automática.", n: "Nombre B.", r: "Rubro · Ciudad", p: "Tiendanube" },
  { q: "Ejemplo de reseña: cómo fue la instalación y el soporte.", n: "Nombre C.", r: "Rubro · Ciudad", p: "Shopify" },
];
export function ReviewsBlock({ T, items = RESENAS_REALES.length ? RESENAS_REALES : RESENAS_EJEMPLO, ejemplo = !RESENAS_REALES.length }) {
  return (
    <section id="rec-resenas" className="lm-wrap" style={{ padding: "96px 24px" }}>
      <div style={{ textAlign: "center", marginBottom: 32 }} data-reveal>
        <div className="lm-eyebrow">Lo que dicen</div>
        <h2 className="lm-h2">Tiendas que ya venden todos los meses</h2>
        {ejemplo && <p className="lm-sub" style={{ margin: "0 auto", color: T.yellow }}>Bloque preparado con datos de ejemplo. Se publica cuando haya clientes reales.</p>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 16 }} className="lm-tiers">
        {items.map((r, i) => (
          <figure key={i} className="lm-card" style={{ margin: 0, padding: 22, display: "flex", flexDirection: "column", gap: 12 }} data-reveal data-reveal-delay={String(i)}>
            <blockquote style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: T.text }}>“{r.q}”</blockquote>
            <figcaption style={{ marginTop: "auto", fontSize: 13, color: T.textSm }}><b style={{ color: T.text }}>{r.n}</b> · {r.r}{r.p ? ` · ${r.p}` : ""}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ─── Funciones: bloque CLAVADO (Thiago, 26-sept: "bajás y siempre estás en la
// misma parte"). La pantalla queda fija; a la izquierda la lista se va
// prendiendo y a la derecha cambia el panel, manejado por el scroll.
function CheckoutPanel({ T }) {
  const c = "#2563eb";
  return (
    <div style={{ background: "#fff", color: "#111", borderRadius: 16, overflow: "hidden", fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: "1px solid #eee", fontSize: 12 }}><img src={PRODUCT_ART.pet} alt="" width="22" height="22" style={{ borderRadius: 5, objectFit: "cover" }}/><b style={{ color: c, fontFamily: FD }}>Patitas</b><span style={{ marginLeft: "auto", color: "#888" }}>Checkout · Mercado Pago</span></div>
      <div style={{ padding: 14, display: "grid", gap: 8 }}>
        {["ana@ejemplo.com", "Ana Pérez · 11 5555 0000", "Av. Cabildo 2100 · Belgrano, CABA"].map(t => <div key={t} style={{ border: "1px solid #e5e5e5", borderRadius: 9, padding: "8px 10px", fontSize: 12 }}>{t}</div>)}
        <div style={{ display: "flex", justifyContent: "space-between", border: `1.5px solid ${c}`, background: c + "0d", borderRadius: 9, padding: "8px 10px", fontSize: 12 }}><b>OCA a domicilio</b><b>{fmtARS(4200)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555" }}><span>Cupón <b style={{ color: "#111" }}>PRIMERA10</b> aplicado</span><span>−{fmtARS(4090)}</span></div>
        <div style={{ background: c, color: "#fff", borderRadius: 10, padding: "11px", textAlign: "center", fontFamily: FD, fontWeight: 800, fontSize: 13 }}>Pagar {fmtARS(41010)} · cada mes</div>
      </div>
    </div>
  );
}
function PortalPanel({ T, b = null }) {
  return (
    <div style={{ background: "#fff", color: "#111", borderRadius: 16, padding: 16, fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}><img src={b ? b.art : PRODUCT_ART.mate} alt="" width="40" height="40" style={{ borderRadius: 8, objectFit: "cover" }}/><div><b style={{ fontSize: 14 }}>{b ? b.product : "Yerba orgánica · 2 kg"}</b><div style={{ fontSize: 12, color: "#666" }}>{b ? b.name : "Cebado"} · activa · próximo cobro 1 de julio</div></div><span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, color: "#1f7a3e", background: "#e7f6ec", borderRadius: 99, padding: "3px 9px" }}>ACTIVA</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {[["Pausar", "1, 2 o 3 meses"], ["Cambiar dirección", "el próximo sale a la nueva"], ["Cambiar tarjeta", "sin volver a suscribirse"], ["Cancelar", "cuando quiera, sin escribirte"]].map(([t, d]) => <div key={t} style={{ border: "1px solid #e5e5e5", borderRadius: 10, padding: "10px 12px" }}><b style={{ fontSize: 12.5, display: "block" }}>{t}</b><span style={{ fontSize: 11, color: "#777" }}>{d}</span></div>)}
      </div>
      <div style={{ marginTop: 12, fontSize: 11.5, color: "#666" }}>Historial: 1 de mayo · 1 de junio · pagos aprobados</div>
    </div>
  );
}
function WaPanel({ T, b = BRAND_DEFAULT }) {
  const bub = (t, me) => <div style={{ alignSelf: me ? "flex-end" : "flex-start", maxWidth: "88%", background: me ? "#d9fdd3" : "#fff", borderRadius: 12, padding: "8px 11px", fontSize: 12.5, lineHeight: 1.45, color: "#111", boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>{t}</div>;
  return (
    <div style={{ background: "#e5ddd5", borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 8, fontFamily: F }}>
      <div style={{ fontSize: 11, color: "#555", textAlign: "center" }}>Recurrentes, en nombre de {b.name}</div>
      {bub(<><b>{b.name}</b>: Hola Ana, mañana se cobra tu suscripción de {b.product} ({fmtARS(b.price)}). Si querés pausarla, entrá a tu portal.</>)}
      {bub(<><b>{b.name}</b>: Tu pago fue rechazado. Actualizá la tarjeta acá para no cortar la entrega: {b.name.toLowerCase()}.ar/portal</>)}
      {bub("Listo, ya la cambié. Gracias!", true)}
      {bub(<><b>{b.name}</b>: Pago aprobado. Tu pedido sale hoy por Andreani.</>)}
    </div>
  );
}
function PanelPanel({ T }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16, fontFamily: F }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}>
        {[["Suscriptores", "128"], ["MRR", "$ 5,2M"], ["Rechazos recuperados", "83%"]].map(([l, v]) => <div key={l} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px" }}><div style={{ fontSize: 9, color: T.textSm, textTransform: "uppercase", fontWeight: 700, letterSpacing: .5 }}>{l}</div><div style={{ fontFamily: FD, fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: -.4 }}>{v}</div></div>)}
      </div>
      {[["Ana P.", "Café · 2 bolsas", "activa", T.accent], ["Julián R.", "Sérum · 1 frasco", "pausada", T.yellow], ["Carla M.", "Alimento · 2 bolsas", "activa", T.accent], ["Diego S.", "Yerba · 4 kg", "rechazo · reintentando", T.red]].map(([n, p, st, c]) => (
        <div key={n} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr auto", gap: 8, padding: "8px 0", borderTop: `1px solid ${T.borderL || T.border}`, fontSize: 12.5, color: T.text }}><b>{n}</b><span style={{ color: T.textSm }}>{p}</span><span style={{ color: c, fontWeight: 700, fontSize: 11.5 }}>{st}</span></div>
      ))}
    </div>
  );
}
const FEATURES = [
  { t: "Widget en tu ficha, con tu marca", d: "Packs, descuento por suscribirse, regalos y frecuencia. Trece diseños, tus colores y tus fotos.", C: ({ T }) => <div style={{ background: "#fff", borderRadius: 16, padding: 14, color: "#111" }}><LiveWidget plan={SAMPLE_PLANS.pet} merchant={{ widget_variant: "v11", widget_color: "#2563eb", widget_radius: 12, widget_mode_default: "sub", widget_show_per_unit: true, widget_texts: { headline: "Que nunca falte" } }} mode="sub" idx={1} style={{ fontSize: 12.5 }}/></div> },
  { t: "Checkout propio, envíos en vivo", d: "Cotiza con los correos que ya tenés en tu tienda, acepta cupones y muestra todo con tus colores.", C: CheckoutPanel },
  { t: "Portal del cliente", d: "Pausa, cambia la dirección o la tarjeta y cancela sin escribirte. Menos WhatsApp para vos.", C: PortalPanel },
  { t: "Avisos por WhatsApp y mail", d: "Próximo cobro, pago rechazado con link para arreglar la tarjeta, pedido en camino. Con tu nombre.", C: WaPanel },
  { t: "Panel con todo lo que pasa", d: "Suscriptores, cobros, rechazos recuperados, carritos sin pagar. Y cada cobro creado como pedido en tu tienda.", C: PanelPanel },
];
function ScrollStack({ T, id, items, eyebrow, title, hideHead = false, panelMinH = 440 }) {
  const ref = useRef(null);
  const desktop = useDesktop();
  const reduce = useReducedMotion();
  const pinned = !reduce; // también en celular: la pantalla queda fija y cambia el panel
  useScrollProgress(ref, { enabled: pinned, steps: items.length });
  const [step, setStep] = useState(0);
  // El data-step lo escribe el listener del scroll; acá lo leemos para React.
  useEffect(() => {
    if (!pinned) return;
    const el = ref.current; if (!el) return;
    const mo = new MutationObserver(() => setStep(Number(el.dataset.step || 0)));
    mo.observe(el, { attributes: true, attributeFilter: ["data-step"] });
    return () => mo.disconnect();
  }, [pinned]);
  const n = items.length;
  const goTo = (i) => { const el = ref.current; if (!el) return; const r = el.getBoundingClientRect(); const total = r.height - window.innerHeight; window.scrollTo({ top: window.scrollY + r.top + total * ((i + 0.5) / n), behavior: "smooth" }); };
  const cur = items[Math.min(step, n - 1)];
  // Thiago, 26-sept: "lo seleccionado debe quedar perfecto en el centro". Solo se
  // ve el paso activo (grande) con un stepper de números; el panel, al lado.
  return (
    <section id={id} ref={ref} className="lm-pin lm-pin-all" style={{ height: pinned ? `${n * 75 + 40}vh` : "auto", background: T.surface, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
      <div className="lm-pin-inner" style={{ padding: pinned ? 0 : "72px 0" }}>
        <div className="lm-wrap" style={{ width: "100%" }}>
          {!hideHead && <div data-reveal="spin" style={{ marginBottom: desktop ? 26 : 18, paddingTop: pinned && !desktop ? 0 : 8 }}>
            <div className="lm-eyebrow">{eyebrow}</div>
            <h2 className="lm-h2" style={!desktop ? { fontSize: 26 } : undefined}>{title}</h2>
          </div>}
          {pinned ? (
            <div className="lm-stack-grid" style={{ display: "grid", gridTemplateColumns: desktop ? "minmax(0,.85fr) minmax(0,1.15fr)" : "1fr", gap: desktop ? 44 : 16, alignItems: "center" }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: desktop ? 18 : 12, alignItems: "center" }}>
                <div className="lm-stepper" style={{ display: "grid", gap: 6 }}>
                  {items.map((f, i) => <button key={f.t} type="button" aria-label={f.t} onClick={() => goTo(i)} className={"lm-stepper-n " + (i === step ? "on" : i < step ? "done" : "")}>{String(i + 1).padStart(2, "0")}</button>)}
                </div>
                <div key={cur.t} className="lm-stack-active">
                  <div style={{ fontFamily: FD, fontSize: desktop ? 30 : 21, fontWeight: 800, letterSpacing: -0.6, color: T.text, lineHeight: 1.12, textWrap: "balance" }}>{cur.t}</div>
                  <div style={{ fontSize: desktop ? 16 : 14, color: T.textSm, lineHeight: 1.55, marginTop: 10, maxWidth: 420 }}>{cur.d}</div>
                  <div style={{ marginTop: 14, fontSize: 12.5, color: T.textSm }}>{step + 1} de {n} · seguí bajando</div>
                </div>
              </div>
              <div className="lm-stack-stage" style={{ position: "relative", minHeight: desktop ? panelMinH : "min(58svh, 520px)" }}>
                {items.map((f, i) => <div key={f.t} className={"lm-stack-panel " + (i === step ? "on" : i < step ? "was" : "")} style={{ display: "grid", alignContent: "center" }}><div className="lm-card" style={{ padding: desktop ? 14 : 10, boxShadow: "0 30px 70px -30px rgba(0,0,0,.5)" }}><f.C T={T}/></div></div>)}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 24 }}>
              {items.map((f, i) => (
                <div key={f.t} data-reveal="swing">
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}><span style={{ fontFamily: MONO, fontSize: 12, color: T.accent }}>0{i + 1}</span><div><div style={{ fontFamily: FD, fontSize: 18, fontWeight: 800, color: T.text }}>{f.t}</div><div style={{ fontSize: 13.5, color: T.textSm, lineHeight: 1.5, marginTop: 3 }}>{f.d}</div></div></div>
                  <div style={{ marginTop: 12, maxWidth: 560 }}><f.C T={T}/></div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function FeatureStack({ T, hideHead = false }) {
  return <ScrollStack T={T} id="rec-funciones" items={FEATURES} eyebrow="Todo lo que hace" title={<>Todo lo que la suscripción necesita,<br/>en un solo lugar</>} hideHead={hideHead}/>;
}

// ─── El proceso de compra, manejado por el scroll (Thiago, 26-sept: "que cada
// parte del comprar se anime a medida que baja"). Widget REAL en cada estado,
// después el checkout con la marca, el cobro en MP, la orden y el aviso.
const JOURNEY_MERCHANT = { widget_variant: "v13", widget_color: "#6b3f2a", widget_radius: 12, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: true, widget_texts: { headline: "Elegí tu pack", sub_label: "Suscribirme y ahorrar", sub_hint: "Te llega solo cada mes · pausás o cancelás cuando quieras", cta_once: "Agregar al carrito" } };
const TOSTADO = { name: "Tostado", product: "Café de especialidad · 2 bolsas", sub: "Pack 2 bolsas · suscripción", price: 21510, art: PRODUCT_ART.cafe, color: "#6b3f2a", freq: "cada mes" };
const JW = ({ mode, idx }) => <div style={{ background: "#fff", borderRadius: 16, padding: 12, color: "#111" }}><LiveWidget plan={SAMPLE_PLANS.cafe} merchant={JOURNEY_MERCHANT} mode={mode} idx={idx} style={{ fontSize: 11.5 }}/></div>;
const JOURNEY = [
  { t: "Entra a tu ficha de producto", d: "El widget vive abajo del precio, con tus colores. Arranca en compra única, como siempre.", C: () => <JW mode="once" idx={1}/> },
  { t: "Toca “Suscribirme y ahorrar”", d: "Ve el descuento por suscribirse, cada cuánto le llega y que puede pausar o cancelar cuando quiera.", C: () => <JW mode="sub" idx={0}/> },
  { t: "Elige el pack", d: "Una, dos bolsas. Mejor precio por unidad y, si querés, un regalo en el primer envío.", C: () => <JW mode="sub" idx={1}/> },
  { t: "Paga en el checkout con tu marca", d: "Contacto, dirección, envío cotizado en vivo con tus correos y el resumen. Todo con tu color y tu logo.", C: ({ T }) => <SubPageMock T={{ ...T, card: "#fff" }}/> },
  { t: "Mercado Pago cobra hoy, y cada período", d: "Cada mes, cada dos, cada quince días: lo que eligió. La plata entra en tu cuenta de MP. Si una tarjeta falla se reintenta y avisamos.", C: ({ T }) => <MpStep T={T} b={TOSTADO}/> },
  { t: "La orden aparece en tu tienda", d: "Con dirección, envío y stock descontado. La despachás como cualquier venta.", C: ({ T }) => <OrderStep T={T} b={TOSTADO}/> },
  { t: "El cliente recibe el aviso", d: "Mail y WhatsApp con tu nombre: pedido en camino, próximo cobro, link a su portal.", C: ({ T }) => <WaPanel T={T} b={TOSTADO}/> },
  { t: "Y gestiona su suscripción desde su portal", d: "Pausa, cambia la dirección o la tarjeta, cancela. Sin escribirte. Vos lo ves todo en tu panel.", C: ({ T }) => <PortalPanel T={T} b={TOSTADO}/> },
];
export function BuyJourney({ T }) {
  return <ScrollStack T={T} id="rec-proceso" items={JOURNEY} eyebrow="Así compra tu cliente" title={<>Todo el proceso,<br/>a medida que bajás</>} panelMinH={540}/>;
}

// ─── El panel, pantalla por pantalla (Thiago, 26-sept: "sección por sección,
// en imagen, deslizable"). Maquetas del panel real con datos de ejemplo, en un
// carril horizontal con scroll-snap (compu y celular). Nada de capturas con
// datos de tiendas reales.
function Frame({ T, title, children }) {
  return (
    <div className="lm-card" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <span style={{ display: "inline-flex", gap: 5 }}>{["#ff5f57", "#febc2e", "#28c840"].map(c => <i key={c} style={{ width: 9, height: 9, borderRadius: 99, background: c, display: "block" }}/>)}</span>
        <span style={{ fontSize: 12, color: T.textSm, marginLeft: 6, fontFamily: MONO }}>recurrentesapp.com · {title}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "118px 1fr", minHeight: 250 }} className="lm-tour-body">
        <aside className="lm-tour-side" style={{ borderRight: `1px solid ${T.border}`, padding: "12px 10px", display: "grid", gap: 4, alignContent: "start", fontSize: 11.5, color: T.textSm }}>
          {["Inicio", "Ventas", "Catálogo", "Clientes", "Analíticas", "Configuración"].map(n => <span key={n} style={{ padding: "6px 8px", borderRadius: 8, background: title.startsWith(n) ? T.accentSolid + "1a" : "transparent", color: title.startsWith(n) ? T.accent : T.textSm, fontWeight: title.startsWith(n) ? 800 : 600 }}>{n}</span>)}
        </aside>
        <div style={{ padding: 14, minWidth: 0, fontSize: 12.5, color: T.text }}>{children}</div>
      </div>
    </div>
  );
}
const Kpi = ({ T, l, v, d }) => <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 11px" }}><div style={{ fontSize: 9.5, color: T.textSm, textTransform: "uppercase", fontWeight: 700, letterSpacing: .5 }}>{l}</div><div style={{ fontFamily: FD, fontSize: 19, fontWeight: 800, letterSpacing: -.5, color: T.text }}>{v}</div>{d && <div style={{ fontSize: 10.5, color: T.accent, fontWeight: 700 }}>{d}</div>}</div>;
const Row = ({ T, cols, c }) => <div style={{ display: "grid", gridTemplateColumns: cols.map(() => "1fr").join(" "), gap: 8, padding: "7px 0", borderTop: `1px solid ${T.borderL || T.border}`, fontSize: 12 }}>{cols.map((x, i) => <span key={i} style={{ color: i === cols.length - 1 && c ? c : i ? T.textSm : T.text, fontWeight: i ? 500 : 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x}</span>)}</div>;
const TOUR = [
  { t: "Inicio", d: "Lo que pasó hoy y el mes: suscriptores, ingresos recurrentes, cobros, rechazos recuperados.", C: ({ T }) => <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginBottom: 12 }}><Kpi T={T} l="Suscriptores" v="128" d="+9 este mes"/><Kpi T={T} l="MRR" v="$ 5,2M" d="+12%"/><Kpi T={T} l="Cobros hoy" v="14"/></div>
      <div style={{ height: 70, display: "flex", alignItems: "flex-end", gap: 4 }}>{[30, 42, 38, 55, 48, 62, 58, 70, 66, 78, 74, 88].map((h, i) => <i key={i} style={{ flex: 1, height: h + "%", background: i === 11 ? T.accentSolid : T.accentSolid + "55", borderRadius: 3, display: "block" }}/>)}</div>
      <div style={{ fontSize: 10.5, color: T.textSm, marginTop: 6 }}>Ingresos recurrentes por mes</div>
    </> },
  { t: "Ventas · Suscripciones", d: "Cada cliente con su plan, próximo cobro y estado. Pausás, cancelás o cambiás la dirección desde acá.", C: ({ T }) => <>
      <Row T={T} cols={["Ana P.", "Café · 2 bolsas", "1 jul", "activa"]} c={T.accent}/><Row T={T} cols={["Julián R.", "Sérum · 1 frasco", "3 jul", "pausada"]} c={T.yellow}/><Row T={T} cols={["Carla M.", "Alimento · 2 bolsas", "1 jul", "activa"]} c={T.accent}/><Row T={T} cols={["Diego S.", "Yerba · 4 kg", "hoy", "reintentando"]} c={T.red}/><Row T={T} cols={["Lucía F.", "Magnesio · 3", "12 jul", "activa"]} c={T.accent}/>
    </> },
  { t: "Ventas · Cobros", d: "Cada cobro de Mercado Pago con su pedido creado en la tienda. Si algo falla, lo ves y se reintenta.", C: ({ T }) => <>
      <Row T={T} cols={["Pago 1 jul", fmtARS(21510), "Pedido #1042", "aprobado"]} c={T.accent}/><Row T={T} cols={["Pago 1 jul", fmtARS(36810), "Pedido #1043", "aprobado"]} c={T.accent}/><Row T={T} cols={["Pago 1 jul", fmtARS(35900), "—", "rechazado · reintento en 2 días"]} c={T.red}/><Row T={T} cols={["Pago 30 jun", fmtARS(42900), "Pedido #1039", "aprobado"]} c={T.accent}/>
    </> },
  { t: "Catálogo · Planes", d: "Un plan por producto: packs, frecuencia, descuento, regalos. Y trece diseños de widget.", C: ({ T }) => <>
      {[["Café de especialidad · 250 g", "3 packs · cada 30 días · 10% off"], ["Sérum de vitamina C", "2 packs · cada 60 días · 15% off"], ["Alimento premium · 3 kg", "3 packs · cada 30 días · regalo en el 1.º"]].map(([a, b]) => <div key={a} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 0", borderTop: `1px solid ${T.borderL || T.border}` }}><span><b style={{ display: "block", fontSize: 12.5 }}>{a}</b><span style={{ fontSize: 11, color: T.textSm }}>{b}</span></span><span style={{ fontSize: 10.5, fontWeight: 800, color: T.accent, alignSelf: "center" }}>ACTIVO</span></div>)}
    </> },
  { t: "Clientes · Flujos", d: "Mails y WhatsApp automáticos: carrito sin pagar, próximo cobro, pago rechazado, bienvenida. Con tu marca.", C: ({ T }) => <>
      {[["Carrito sin pagar", "Mail a la 1 h · WhatsApp a las 24 h", true], ["Próximo cobro", "WhatsApp 2 días antes", true], ["Pago rechazado", "Mail + WhatsApp con link a la tarjeta", true], ["Bienvenida", "Mail al activar", false]].map(([a, b, on]) => <div key={a} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "9px 0", borderTop: `1px solid ${T.borderL || T.border}` }}><span><b style={{ display: "block", fontSize: 12.5 }}>{a}</b><span style={{ fontSize: 11, color: T.textSm }}>{b}</span></span><i style={{ width: 30, height: 17, borderRadius: 99, background: on ? T.accentSolid : T.border, position: "relative", flexShrink: 0 }}><b style={{ position: "absolute", top: 2, left: on ? 15 : 2, width: 13, height: 13, borderRadius: 99, background: "#fff" }}/></i></div>)}
    </> },
  { t: "Analíticas", d: "Retención, ticket promedio, churn y cuánto vale un suscriptor. Para decidir descuentos y packs.", C: ({ T }) => <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 10 }}><Kpi T={T} l="Retención a 3 meses" v="81%"/><Kpi T={T} l="Ticket promedio" v={fmtARS(31400)} d="+27% vs. compra única"/><Kpi T={T} l="Churn mensual" v="4,1%"/><Kpi T={T} l="Rechazos recuperados" v="83%"/></div>
    </> },
];
// Capturas REALES del panel: cuando estén en public/landing/panel-<n>.png (las
// manda Thiago desde la tienda RECURRENTES con casos simulados) se usan en vez
// de la maqueta. Hasta entonces, maqueta.
export const PANEL_SHOTS = {};
export function PanelTour({ T }) {
  const ref = useRef(null);
  const desktop = useDesktop();
  const reduce = useReducedMotion();
  useScrollProgress(ref, { enabled: desktop && !reduce });
  const n = TOUR.length;
  return (
    <section id="rec-panel" ref={ref} className="lm-pin" style={{ height: desktop && !reduce ? `${n * 60 + 40}vh` : "auto" }}>
      <div className="lm-pin-inner" style={{ padding: desktop ? 0 : "72px 0 40px" }}>
        <div className="lm-wrap" style={{ width: "100%" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 22 }} data-reveal="flip">
            <div>
              <div className="lm-eyebrow">El panel, por dentro</div>
              <h2 className="lm-h2">Pantalla por pantalla,<br/>así lo vas a usar</h2>
              <p className="lm-sub">Seguí bajando y el panel va pasando. Datos de ejemplo: en la demo lo ves con tus productos.</p>
            </div>
            <div className="lm-progress" style={{ width: 160, marginBottom: 10 }}><i/></div>
          </div>
        </div>
        <div className="lm-wrap" style={{ width: "100%" }}>
          <div className="lm-track" style={{ "--travel": `calc(-1 * ((min(640px, 86vw) + 28px) * ${n} - 100%))`, alignItems: "flex-start" }}>
            {TOUR.map((sc, i) => (
              <div key={sc.t} className="lm-tour-item" style={{ flex: "0 0 min(640px, 86vw)" }}>
                {PANEL_SHOTS[sc.t]
                  ? <img src={PANEL_SHOTS[sc.t]} alt={sc.t} style={{ display: "block", width: "100%", borderRadius: 18, border: `1px solid ${T.border}` }} loading="lazy"/>
                  : <Frame T={T} title={sc.t}><sc.C T={T}/></Frame>}
                <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "baseline" }}><span style={{ fontFamily: MONO, fontSize: 12, color: T.accent }}>0{i + 1}</span><div><div style={{ fontFamily: FD, fontSize: 16, fontWeight: 800, color: T.text }}>{sc.t}</div><div style={{ fontSize: 13, color: T.textSm, lineHeight: 1.5, marginTop: 2 }}>{sc.d}</div></div></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Comparativa "arena" (Thiago: "con mucho diseño") ────────────────────
// Los datos son los mismos de LandingSections (COMPARE_ROWS, verificados
// 21-sept-2026). Recurrentes en el centro, iluminada; en celular se elige
// contra quién comparar.
export function ComparisonArena({ T, onDemo }) {
  const [pick, setPick] = useState(1);
  const oth = COMPARE_COLS.slice(1);
  const dark = { text: "#EAF3EF", textMd: "#c5d6ce", textSm: "#8fa69c", accent: "#34d399", accentSolid: "#10b981", yellow: "#fbbf24", red: "#f87171", border: "rgba(255,255,255,.08)" };
  return (
    <section id="rec-comparar" className="ls-sec-dark" style={{ padding: "96px 0" }}>
      <div className="lm-wrap">
        <div data-reveal="flip" style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 36px" }}>
          <div className="lm-eyebrow">Comparativa</div>
          <h2 className="lm-h2" style={{ color: "#fff" }}>Lo mismo, sin comisión<br/>y con más funciones</h2>
          <p className="lm-sub" style={{ margin: "0 auto", color: "#A9C3B9" }}>Fácil Uno, Reval, Puentify, Recharge y Orquesty cobran un porcentaje de cada venta, además del abono. Nosotros no. Datos públicos de cada uno.</p>
        </div>
        <div className="lm-arena-vs">{oth.map((c, k) => <button key={c.key} type="button" className={"lm-arena-pill " + (pick === k + 1 ? "on" : "")} onClick={() => setPick(k + 1)}>vs {c.title}</button>)}</div>
        <div className="lm-arena" data-reveal="rise">
          <div className="lm-arena-h" style={{ color: "#8fa69c", fontSize: 11, letterSpacing: .6, textTransform: "uppercase", alignSelf: "end" }}>Qué mirar</div>
          <div className="lm-arena-h lm-arena-rec" style={{ color: "#fff", display: "flex", alignItems: "center", gap: 8, fontSize: 15 }}><RecLogoMini/> Recurrentes</div>
          {oth.map((c, k) => <div key={c.key} className={"lm-arena-h lm-arena-oth " + (pick === k + 1 ? "pick" : "")} style={{ color: "#c5d6ce", display: "flex", alignItems: "center", gap: 8 }}><CompareMark logo={c.logo}/>{c.title}</div>)}
          {COMPARE_ROWS.map(([label, ...vals], i) => {
            const last = i === COMPARE_ROWS.length - 1;
            return (
              <React.Fragment key={label}>
                <div className={"lm-arena-c " + (last ? "lm-arena-last" : "")} style={{ color: "#EAF3EF", fontWeight: 600, lineHeight: 1.4 }}>{label}</div>
                <div className={"lm-arena-c lm-arena-rec " + (last ? "lm-arena-last" : "")} style={{ borderTop: "1px solid rgba(52,211,153,.18)" }}><CompareCell T={dark} v={vals[0]}/></div>
                {oth.map((c, k) => <div key={c.key} className={"lm-arena-c lm-arena-oth " + (pick === k + 1 ? "pick" : "") + (last ? " lm-arena-last" : "")} style={{ color: "#c5d6ce" }}><CompareCell T={dark} v={vals[k + 1]}/></div>)}
              </React.Fragment>
            );
          })}
        </div>
        <p style={{ fontSize: 12, color: "#8fa69c", textAlign: "center", margin: "18px auto 0", maxWidth: 820, lineHeight: 1.6 }}>
          Datos verificados el 21 de septiembre de 2026 (Orquesty el 26) en la web pública de cada producto:{" "}
          {COMPARE_SOURCES.map((f, i) => <span key={f.t}>{i > 0 ? " · " : ""}<a href={f.u} target="_blank" rel="noopener noreferrer" style={{ color: "#c5d6ce", textDecoration: "underline" }}>{f.t}</a></span>)}. El setup y la comisión de Puentify no figuran en su web: salen de comercios que trabajan con ellos. Recharge compró Skio en abril de 2026. Los precios los pone cada empresa y pueden cambiar.
        </p>
        {onDemo && <div style={{ textAlign: "center", marginTop: 26 }}><button onClick={onDemo} style={{ ...BtnSolid(T), padding: "14px 24px", fontSize: 15, borderRadius: 14 }}>Pedir demo</button></div>}
      </div>
    </section>
  );
}

// ─── 6. Cierre ───────────────────────────────────────────────────────────
export function ClosingCta({ T, onDemo, onLogin }) {
  return (
    <section className="lm-wrap" style={{ padding: "48px 24px 96px" }}>
      <div data-reveal="pop" style={{ position: "relative", overflow: "hidden", background: "#0C1A18", color: "#fff", border: "1px solid rgba(255,255,255,.08)", borderRadius: 28, padding: "64px 28px", textAlign: "center" }}>
        <div style={{ position: "absolute", inset: "-40%", background: `radial-gradient(circle at 50% 30%, ${T.accentSolid}55 0%, transparent 45%)`, pointerEvents: "none" }}/>
        <div style={{ position: "relative" }}>
          <RecLogo size={44} style={{ marginBottom: 18 }}/>
          <h2 style={{ fontFamily: FD, fontSize: "clamp(30px, 4vw, 50px)", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.04, margin: "0 auto 14px", maxWidth: 760, color: "#fff", textWrap: "balance" }}>Que te compren todos los meses sin tener que pedírselo</h2>
          <p style={{ fontSize: 16, color: "#A9C3B9", margin: "0 auto 28px", maxWidth: 520, lineHeight: 1.6 }}>En una demo de 20 minutos te mostramos cómo lo usan las tiendas que ya venden con Recurrentes y armamos cómo llevarlo a la tuya. Gratis hasta {FREE_SUBSCRIBERS} suscriptores.</p>
          <button onClick={onDemo} style={{ ...BtnSolid(T), display: "inline-flex", alignItems: "center", gap: 10, padding: "15px 26px", fontSize: 16, borderRadius: 14 }}>Pedir demo <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
          <PartnerBadges T={T} tone="dark" compact style={{ justifyContent: "center", marginTop: 22 }}/>
          {onLogin && <div style={{ fontSize: 13, color: "#A9C3B9", marginTop: 16 }}>¿Ya tenés cuenta? <button onClick={onLogin} style={{ background: "none", border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontFamily: F, fontSize: 13, padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>Iniciá sesión</button></div>}
        </div>
      </div>
    </section>
  );
}
