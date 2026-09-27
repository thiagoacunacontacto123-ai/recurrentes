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
      [data-reveal].is-in{opacity:1;transform:none;}
      [data-reveal-delay="1"]{transition-delay:.08s}[data-reveal-delay="2"]{transition-delay:.16s}[data-reveal-delay="3"]{transition-delay:.24s}[data-reveal-delay="4"]{transition-delay:.32s}
      /* Parallax suave con scroll-driven animations donde exista (Chrome/Edge). */
      @supports (animation-timeline: view()) {
        .lm-float{animation:lmFloat linear both;animation-timeline:view();animation-range:entry 0% exit 100%;}
        @keyframes lmFloat{from{transform:translateY(28px)}to{transform:translateY(-28px)}}
      }
      /* ── Bloque fijo manejado por el scroll (desktop) ── */
      .lm-pin{position:relative;}
      .lm-pin-inner{position:sticky;top:0;height:100vh;height:100svh;display:flex;flex-direction:column;justify-content:center;overflow:hidden;}
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
        .lm-pin-inner{position:static;height:auto;display:block;overflow:visible;}
        .lm-track{transform:none!important;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:4px 16px 18px;margin:0 -16px;scrollbar-width:none;}
        .lm-track::-webkit-scrollbar{display:none;}
        .lm-track > *{scroll-snap-align:center;}
        .lm-progress{display:none;}
        .lm-wrap{padding:0 16px;}
      }
      @media (prefers-reduced-motion: reduce){
        [data-reveal]{opacity:1;transform:none;transition:none;}
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
    const els = Array.from(root.querySelectorAll("[data-reveal]"));
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) { els.forEach(e => e.classList.add("is-in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
    }, { threshold: 0.18, rootMargin: "0px 0px -8% 0px" });
    els.forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [rootRef]);
}

// Progreso 0..1 de un bloque fijo: 0 cuando llega arriba, 1 cuando se destraba.
// Se escribe en la CSS var --p del propio bloque (sin re-render de React).
function useScrollProgress(ref, { enabled = true } = {}) {
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
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [ref, enabled]);
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

// El widget del hero: loop que muestra al comprador eligiendo pack y pasando a
// suscripción, con un cursor que va hasta el control antes de cada cambio.
const HERO_MERCHANT = { widget_variant: "v13", widget_color: "#10b981", widget_radius: 14, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: true,
  widget_texts: { headline: "Elegí tu pack", sub_label: "Suscribirme y ahorrar", sub_hint: "Te llega solo cada mes · pausás o cancelás cuando quieras" } };
const HERO_SCRIPT = [ // [modo, pack, qué se "toca" antes]
  { mode: "once", idx: 1, act: null },
  { mode: "once", idx: 2, act: ["pack", 2] },
  { mode: "sub",  idx: 2, act: ["mode", "sub"] },
  { mode: "sub",  idx: 1, act: ["pack", 1] },
  { mode: "sub",  idx: 0, act: ["pack", 0] },
  { mode: "once", idx: 0, act: ["mode", "once"] },
];
export function HeroWidgetLoop({ T }) {
  const reduce = useReducedMotion();
  const vm = useMemo(() => safeVM(SAMPLE_PLANS.cafe, HERO_MERCHANT), []);
  const states = useMemo(() => {
    const o = {};
    if (!vm) return o;
    for (const m of ["once", "sub"]) for (const p of vm.packs) o[m + ":" + p.idx] = safeRender(vm, { mode: m, selectedIdx: p.idx }).html;
    return o;
  }, [vm]);
  const css = useMemo(() => safeRender(vm, { mode: "sub", selectedIdx: 1 }).css, [vm]);
  const [step, setStep] = useState(reduce ? 2 : 0);
  const [cursor, setCursor] = useState({ x: 70, y: 40, click: false, on: false });
  const boxRef = useRef(null);
  const cur = HERO_SCRIPT[step % HERO_SCRIPT.length];
  const html = states[cur.mode + ":" + cur.idx] || states["sub:1"] || "";

  useEffect(() => {
    if (reduce) return;
    let alive = true; let t1, t2;
    const next = HERO_SCRIPT[(step + 1) % HERO_SCRIPT.length];
    const go = () => {
      if (!alive) return;
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
    const t0 = setTimeout(go, step === 0 ? 900 : 1500);
    return () => { alive = false; clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [step, reduce]);

  return (
    <div className="lm-hero-widget" style={{ position: "relative" }}>
      <div style={{ position: "absolute", inset: -40, background: `radial-gradient(circle at 60% 30%, ${T.accentSolid}2e 0%, transparent 60%)`, filter: "blur(30px)", pointerEvents: "none" }}/>
      <div className="lm-card" style={{ position: "relative", padding: "16px 16px 14px", boxShadow: "0 30px 70px -30px rgba(0,0,0,.5)" }}>
        {/* Cabecera de "tienda": para que se entienda que es la ficha de producto */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, paddingBottom: 12, borderBottom: `1px solid ${T.borderL || T.border}` }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, background: "linear-gradient(135deg,#6b3f2a,#c08457)", flexShrink: 0 }}/>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FD, fontSize: 14.5, fontWeight: 800, color: T.text, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{SAMPLE_PLANS.cafe.product_title}</div>
            <div style={{ fontSize: 11.5, color: T.textSm }}>Tienda de ejemplo · así se ve en tu ficha de producto</div>
          </div>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 800, color: T.accent, background: T.accentSolid + "18", borderRadius: 99, padding: "3px 9px", letterSpacing: 0.4, whiteSpace: "nowrap" }}><span style={{ width: 6, height: 6, borderRadius: 99, background: T.accentSolid }}/>EN VIVO</span>
        </div>
        <div ref={boxRef} style={{ position: "relative", fontSize: 13.5, lineHeight: 1.35, color: "#161616" }}>
          <style>{css}</style>
          <div dangerouslySetInnerHTML={{ __html: html }}/>
          {!reduce && (
            <svg className={"lm-cursor" + (cursor.click ? " is-click" : "")} style={{ left: cursor.x, top: cursor.y, opacity: cursor.on ? 1 : 0 }} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3l14 8.5-6.2 1.6L10 20z" fill="#111" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>
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
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 26 }} data-reveal>
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
function MpStep({ T }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, color: "#111", fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <img src="/brand/mercadopago.png" alt="" style={{ width: 34, height: 34, objectFit: "contain", borderRadius: 8 }} onError={(e) => { e.currentTarget.style.display = "none"; }}/>
        <div><div style={{ fontWeight: 800, fontSize: 14 }}>Mercado Pago</div><div style={{ fontSize: 12, color: "#6b6b6b" }}>Suscripción · cobro automático</div></div>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, color: "#1f7a3e", background: "#e7f6ec", borderRadius: 99, padding: "3px 9px" }}>APROBADO</span>
      </div>
      {[["1 de mayo", "Pago n.º 1", fmtARS(42900)], ["1 de junio", "Pago n.º 2", fmtARS(42900)], ["1 de julio", "Pago n.º 3", fmtARS(42900)]].map(([d, l, v], i) => (
        <div key={l} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, padding: "9px 0", borderTop: i ? "1px solid #eee" : "none", fontSize: 13 }}>
          <span><b style={{ display: "block" }}>{l}</b><span style={{ color: "#6b6b6b", fontSize: 12 }}>{d} · tarjeta terminada en 4421</span></span>
          <b style={{ fontVariantNumeric: "tabular-nums" }}>{v}</b>
        </div>
      ))}
      <div style={{ marginTop: 12, fontSize: 12, color: "#6b6b6b", lineHeight: 1.45 }}>El cliente paga en el checkout de Mercado Pago. La plata entra en tu cuenta de MP, como cualquier venta.</div>
    </div>
  );
}
function OrderStep({ T }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, padding: 16, color: "#111", fontFamily: F }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div><div style={{ fontWeight: 800, fontSize: 14 }}>Pedido #1042</div><div style={{ fontSize: 12, color: "#6b6b6b" }}>Creado por Recurrentes · etiqueta RECURRENTE</div></div>
        <span style={{ fontSize: 11, fontWeight: 800, color: "#1f7a3e", background: "#e7f6ec", borderRadius: 99, padding: "3px 9px" }}>PAGADO</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "44px 1fr auto", gap: 10, alignItems: "center", padding: "10px 0", borderTop: "1px solid #eee", borderBottom: "1px solid #eee", fontSize: 13 }}>
        <span style={{ width: 44, height: 44, borderRadius: 10, background: "linear-gradient(135deg,#a78bfa,#6d28d9)" }}/>
        <span><b style={{ display: "block" }}>Cápsulas de magnesio × 3</b><span style={{ color: "#6b6b6b", fontSize: 12 }}>Pack 3 frascos · suscripción</span></span>
        <b>{fmtARS(42900)}</b>
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
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 24, alignItems: "end", marginBottom: 26 }} data-reveal>
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

// ─── 4. El precio como arma ──────────────────────────────────────────────
export function PriceWeapon({ T, onDemo }) {
  const [rev, setRev] = useState(2000000); // facturación mensual en suscripciones (ARS)
  const [rate, setRate] = useState(2);
  const fee = rev * rate / 100;
  const tiers = PRICING_TIERS.filter(t => t.usd > 0).slice(0, 3);
  const free = PRICING_TIERS[0];
  const inp = { fontFamily: F, fontSize: 15, fontWeight: 600, color: T.text, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 14px", width: "100%", outline: "none" };
  return (
    <section id="rec-precios" className="lm-wrap" style={{ padding: "104px 24px" }}>
      <div style={{ textAlign: "center", maxWidth: 760, margin: "0 auto 40px" }} data-reveal>
        <div className="lm-eyebrow">Precio</div>
        <h2 className="lm-h2">Un costo de instalación<br/>y un abono. <em style={{ fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif", fontWeight: 500 }}>Nada más.</em></h2>
        <p className="lm-sub" style={{ margin: "0 auto" }}>Las otras plataformas cobran un abono más un porcentaje de cada venta. Nosotros, 0% de comisión, siempre. Lo que cobra tu cliente es tuyo.</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }} className="lm-price-grid">
        <style>{`@media(max-width:900px){.lm-price-grid{grid-template-columns:1fr!important;}.lm-calc-grid{grid-template-columns:1fr!important;}}`}</style>
        <div className="lm-card" style={{ padding: 26 }} data-reveal="left">
          <div style={{ fontSize: 12, fontWeight: 800, color: T.textSm, letterSpacing: .6, textTransform: "uppercase", marginBottom: 14 }}>Los demás</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: T.text, lineHeight: 1.1 }}>Abono <span style={{ color: T.textSm }}>+</span> 1–2% de cada venta</div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: T.textMd, lineHeight: 1.5 }}>
            {["Cuanto más vendés, más pagás.", "El porcentaje se suma a la comisión de la pasarela.", "Nunca sabés cuánto te va a costar el mes."].map(t => <div key={t} style={{ display: "flex", gap: 8 }}><span style={{ color: T.red, fontWeight: 800 }}>×</span>{t}</div>)}
          </div>
        </div>
        <div className="lm-card" style={{ padding: 26, borderColor: T.accentSolid + "88", boxShadow: `0 24px 60px -30px ${T.accentSolid}88` }} data-reveal="right">
          <div style={{ fontSize: 12, fontWeight: 800, color: T.accent, letterSpacing: .6, textTransform: "uppercase", marginBottom: 14 }}>Recurrentes</div>
          <div style={{ fontFamily: FD, fontSize: 28, fontWeight: 800, letterSpacing: -0.8, color: T.text, lineHeight: 1.1 }}>USD {INSTALL_USD} una vez <span style={{ color: T.textSm }}>+</span> abono fijo</div>
          <div style={{ marginTop: 14, display: "grid", gap: 8, fontSize: 14, color: T.textMd, lineHeight: 1.5 }}>
            {[`Gratis hasta ${FREE_SUBSCRIBERS} suscriptores activos.`, "0% de comisión por venta. Siempre.", `La puesta en marcha se paga cuando ya está funcionando.`].map(t => <div key={t} style={{ display: "flex", gap: 8 }}><span style={{ color: T.accent, fontWeight: 800 }}>✓</span>{t}</div>)}
          </div>
        </div>
      </div>

      {/* Tramos reales (shared/platform/pricing.js) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, marginTop: 16 }} className="lm-tiers" data-reveal>
        <style>{`@media(max-width:900px){.lm-tiers{grid-template-columns:repeat(2,minmax(0,1fr))!important;}}`}</style>
        {[free, ...tiers].map((t, i) => (
          <div key={t.id} className="lm-card" style={{ padding: "16px 18px", borderColor: i === 0 ? T.accentSolid + "66" : T.border }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: T.textSm, letterSpacing: .5, textTransform: "uppercase" }}>{t.label}</div>
            <div style={{ fontFamily: FD, fontSize: 26, fontWeight: 800, letterSpacing: -1, color: i === 0 ? T.accent : T.text, marginTop: 4 }}>{t.usd === 0 ? "Gratis" : <>USD {t.usd}<span style={{ fontSize: 12, fontWeight: 600, color: T.textSm, letterSpacing: 0 }}>/mes</span></>}</div>
            <div style={{ fontSize: 12.5, color: T.textSm, marginTop: 4 }}>{t.max == null ? `Más de ${t.min - 1} suscriptores` : t.min <= 1 ? `Hasta ${t.max} suscriptores` : `${t.min} a ${t.max} suscriptores`}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: T.textSm, textAlign: "center", marginTop: 12 }}>Después sigue subiendo por tramos. Suscriptor activo = cliente con su suscripción cobrando. Precios en dólares, sin contrato.</div>

      {/* Calculadora: el argumento que se toca */}
      <div className="lm-card" style={{ marginTop: 40, padding: 26 }} data-reveal="scale">
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
              <div style={{ fontSize: 13, color: T.textMd, marginTop: 4 }}>{fmtARS(fee * 12)} al año que no son tuyos.</div>
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
  { n: "WooCommerce", s: "Próximamente", ok: false }, { n: "Mobbex", s: "Próximamente", ok: false },
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
      <div className="lm-wrap" style={{ textAlign: "center", marginBottom: 32 }} data-reveal>
        <div className="lm-eyebrow">Integraciones</div>
        <h2 className="lm-h2">Se conecta con lo que ya usás</h2>
        <p className="lm-sub" style={{ margin: "0 auto" }}>Shopify y Tiendanube como tienda, Mercado Pago como pasarela. Los envíos se cotizan con los correos que ya tenés configurados en tu tienda, y la orden sale lista para despachar.</p>
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

// ─── 6. Cierre ───────────────────────────────────────────────────────────
export function ClosingCta({ T, onDemo, onLogin }) {
  return (
    <section className="lm-wrap" style={{ padding: "48px 24px 96px" }}>
      <div data-reveal="scale" style={{ position: "relative", overflow: "hidden", background: "#0C1A18", color: "#fff", border: "1px solid rgba(255,255,255,.08)", borderRadius: 28, padding: "64px 28px", textAlign: "center" }}>
        <div style={{ position: "absolute", inset: "-40%", background: `radial-gradient(circle at 50% 30%, ${T.accentSolid}55 0%, transparent 45%)`, pointerEvents: "none" }}/>
        <div style={{ position: "relative" }}>
          <RecLogo size={44} style={{ marginBottom: 18 }}/>
          <h2 style={{ fontFamily: FD, fontSize: "clamp(30px, 4vw, 50px)", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1.04, margin: "0 auto 14px", maxWidth: 760, color: "#fff", textWrap: "balance" }}>Que te compren todos los meses sin tener que pedírselo</h2>
          <p style={{ fontSize: 16, color: "#A9C3B9", margin: "0 auto 28px", maxWidth: 520, lineHeight: 1.6 }}>En una demo de 20 minutos te mostramos cómo lo usan las tiendas que ya venden con Recurrentes y armamos cómo llevarlo a la tuya. Gratis hasta {FREE_SUBSCRIBERS} suscriptores.</p>
          <button onClick={onDemo} style={{ ...BtnSolid(T), display: "inline-flex", alignItems: "center", gap: 10, padding: "15px 26px", fontSize: 16, borderRadius: 14 }}>Pedir demo <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg></button>
          <div style={{ fontSize: 13, color: "#A9C3B9", marginTop: 16 }}>¿Ya tenés cuenta? <button onClick={onLogin} style={{ background: "none", border: "none", color: "#fff", fontWeight: 600, cursor: "pointer", fontFamily: F, fontSize: 13, padding: 0, textDecoration: "underline", textUnderlineOffset: 3 }}>Iniciá sesión</button></div>
        </div>
      </div>
    </section>
  );
}
