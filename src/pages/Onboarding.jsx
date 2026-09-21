import React, { useState, useEffect } from "react";
import { sendEmailVerification } from "firebase/auth";
import { auth } from "../lib/firebase.js";
import { DS as DS_, useT } from "../ui/theme.js";
import { BtnPrimary, BtnSecondary, Btn, Card, SectionIcon, Callout, DSEmpty, Tip, toast } from "../ui/components.jsx";
import { RecLogo } from "../ui/Shell.jsx";
import { STEP_ICONS, TIPS, SECTION_NEEDS, WHATSAPP_SOPORTE, useOnb, planHiddenKey, readFlag, writeFlag, goGuideSection, planExample } from "../lib/onboarding.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { SHOPIFY_SCOPE_IDS } from "../../shared/platform/shopify.js";
import BusinessProfileSection from "./BusinessProfile.jsx";

// ─────────────────────────────────────────────────────────────────
// Experiencia de usuario nuevo de Recurrentes — portada de Growith:
//   · OnboardingWizard   → modal a pantalla completa, estilo Growith
//                          (bienvenida → cómo funciona → un paso por
//                          pantalla con ícono, por qué, qué vas a
//                          necesitar, CTA y "lo hago después" → resumen).
//   · PlanDeAccionCard   → card "Tu plan de acción" (N/8) para Inicio.
//   · OnbEmpty           → estado vacío con "para que aparezcan: …" + CTA.
//   · PackTip / WidgetDesignTip / MpTokenTip / ShopifyAppTip → (?) listos
//                          para pegar en Planes / Diseño / Integraciones.
// El estado de los pasos viene de useOnboarding() (src/lib/onboarding.js).
// ─────────────────────────────────────────────────────────────────

const F = "'Inter',system-ui,sans-serif";

// ═══════════════════════════════════════════════════════════════════
// Wizard de bienvenida
// ═══════════════════════════════════════════════════════════════════
export default function OnboardingWizard({ T: Tp, DS: DSp, merchant, onb, onClose, goTab, onMerchantChange }) {
  const Tt = useT(); const T = Tp || Tt;
  const DS = DSp || DS_;
  const steps = onb?.steps || [];
  const { done = 0, total = steps.length || 8, nextStep = null, allDone = false } = onb || {};
  // Páginas: 0 bienvenida · 1 cómo funciona · 2..(1+N) un paso por pantalla · última resumen
  const FIRST_STEP_PAGE = 2;
  const SUMMARY = FIRST_STEP_PAGE + steps.length;
  const PAGES = SUMMARY + 1;
  const [paso, setPaso] = useState(0);
  const [busy, setBusy] = useState(false);

  // Esc cierra; bloquear scroll del fondo mientras está abierto.
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const go = (step) => { onClose?.(); onb?.goStep?.(step); };
  const goGuide = (sec) => { onClose?.(); onb?.goGuide?.(sec); };
  const pct = total ? Math.round((done / total) * 100) : 0;

  async function reenviarMail() {
    setBusy(true);
    try { await sendEmailVerification(auth.currentUser); toast("Mail de verificación reenviado", "success"); }
    catch (e) { toast("No se pudo reenviar: " + (e?.message || e?.code || "error"), "error", 6000); }
    finally { setBusy(false); }
  }

  // El recorrido se adapta al perfil del negocio (shared/platform/profile.js).
  const profile = merchantProfile(merchant);
  const COMO_FUNCIONA = profile.caps.widget ? [
    { id:"plan",     nombre:"Planes con packs",         desc:"Elegís un producto de tu Shopify, cada cuántos días se cobra, el descuento y los packs (x1, x2, x3) con su precio." },
    { id:"snippet",  nombre:"Widget en tu tienda",      desc: profile.channel === "tiendanube" ? "Se pone solo: Tiendanube carga el widget de Recurrentes y el selector de suscripción aparece en cada producto con plan activo. Sin pegar código." : "Una línea de código y el selector de suscripción aparece en la página de producto, con el diseño que elijas." },
    { id:"mp",       nombre:"Cobros automáticos",       desc:"El cliente paga en Mercado Pago. MP cobra solo cada período y Recurrentes crea la orden en Shopify para que despaches." },
    { id:"klaviyo",  nombre:"Recupero y mails",         desc:"Mails automáticos con tu marca: checkouts sin pagar, pago rechazado, aviso de próximo cobro y más, desde Flujos de email." },
  ] : [
    { id:"plan",     nombre:"Tus planes",               desc:`Cargás cada plan acá (ej: "${planExample(profile)}"): precio y cada cuántos días se cobra. No hace falta tienda.` },
    { id:"link",     nombre:"Link de suscripción",      desc:"Cada plan tiene su link. Lo compartís por Instagram, WhatsApp, tu web o un QR en el mostrador." },
    { id:"mp",       nombre:"Cobros automáticos",       desc:`Tu cliente paga una vez con ${profile.providerInfo.label} y después se cobra solo cada período. Cada cobro queda registrado en el panel.` },
    { id:"klaviyo",  nombre:"Avisos y retención",       desc:`Mails de activación y de pago fallido, un portal para que tus ${profile.vocab.customers} pausen o cancelen solos, y flujos de email con tu marca.` },
  ];
  // Bienvenida: Shopify (histórico) · negocio sin tienda ya elegido · todavía sin elegir.
  const welcome = profile.caps.widget && (profile.explicit || merchant?.shopify_token) ? {
    h: <>Suscripciones en tu Shopify,<br/>cobradas por Mercado Pago</>,
    p: "Recurrentes convierte cualquier producto de tu tienda en una suscripción: el cliente elige el pack y la frecuencia, paga en Mercado Pago y cada cobro genera solo la orden en Shopify. Vos solo despachás.",
    bullets: [
      "Cobros recurrentes en tu propia cuenta de MP, sin intermediarios",
      "Una orden en Shopify por cada cobro, con envío y dirección",
      "Widget con packs (x1, x2, x3) y más de 10 diseños para tu página de producto",
      "Mails automáticos para recuperar checkouts sin pagar",
    ],
  } : profile.explicit ? {
    h: <>Cobros recurrentes para tu negocio,<br/>sin tienda online</>,
    p: `Cargás tus planes, compartís el link y tus ${profile.vocab.customers} pagan con ${profile.providerInfo.label}. Después se cobra solo cada período y lo ves todo en el panel.`,
    bullets: [
      `Cobros recurrentes en tu propia cuenta de ${profile.providerInfo.label}, sin intermediarios`,
      "Un link de suscripción por plan: Instagram, WhatsApp, tu web o un QR",
      `Portal para que tus ${profile.vocab.customers} pausen o cancelen solos`,
      "Avisos automáticos de pago fallido y flujos de email",
    ],
  } : {
    h: <>Cobros recurrentes<br/>para cualquier negocio</>,
    p: "Tiendas online y servicios con cuota: tu cliente paga una vez y después se cobra solo, y cada cobro crea el pedido en tu tienda.",
    bullets: [
      "Tiendas con Shopify o Tiendanube",
      "Gimnasios, clases, clubes y membresías con cuota",
      "Cobros en tu propia cuenta de Mercado Pago",
    ],
  };

  const Header = ({ small }) => (
    <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom: small ? DS.sp.lg : DS.sp.xl }}>
      <RecLogo size={small ? 26 : 34}/>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", letterSpacing:0.7, color:T.textSm, fontWeight:DS.w.bold }}>Guía de inicio</div>
        <div style={{ height:5, borderRadius:99, background:T.border, overflow:"hidden", marginTop:5, maxWidth:260 }}>
          <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg, ${T.accentSolid}, ${T.green})`, borderRadius:99, transition:`width 0.4s ${DS.ease}` }}/>
        </div>
      </div>
      <span style={{ fontSize:DS.font.sm, color:T.textSm, fontWeight:DS.w.semibold, whiteSpace:"nowrap" }}>{done}/{total} listos</span>
      <button onClick={onClose} title="Cerrar" aria-label="Cerrar" style={{ background:"transparent", border:`1px solid ${T.border}`, borderRadius:DS.r.md, color:T.textSm, cursor:"pointer", width:30, height:30, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:16, lineHeight:1, fontFamily:F, flexShrink:0 }}>✕</button>
    </div>
  );

  const Nav = ({ cta = "Siguiente", onCta, secondary }) => (
    <div style={{ display:"flex", alignItems:"center", gap:DS.sp.md, marginTop:DS.sp["2xl"], flexWrap:"wrap" }}>
      {paso > 0 && <button onClick={() => setPaso(p => p - 1)} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:DS.font.lg, padding:"10px 6px", fontFamily:F }}>← Atrás</button>}
      <div style={{ flex:1, display:"flex", gap:5, justifyContent:"center", flexWrap:"wrap" }}>
        {Array.from({ length: PAGES }).map((_, i) => (
          <span key={i} onClick={() => setPaso(i)} style={{ width: i === paso ? 18 : 6, height:6, borderRadius:99, background: i === paso ? T.accentSolid : T.border, transition:`all 0.25s ${DS.ease}`, cursor:"pointer" }}/>
        ))}
      </div>
      {secondary}
      <button onClick={onCta || (() => setPaso(p => Math.min(PAGES - 1, p + 1)))} style={{ ...BtnPrimary(T), fontSize:DS.font.lg, padding:"10px 22px" }}>{cta}</button>
    </div>
  );

  const Check = ({ color }) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={color || T.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><polyline points="20 6 9 17 4 12"/></svg>
  );

  const stepIdx = paso - FIRST_STEP_PAGE;
  const s = stepIdx >= 0 && stepIdx < steps.length ? steps[stepIdx] : null;

  return (
    <div className="gh-overlay" style={{ position:"fixed", inset:0, background:T.bg, zIndex:9999, display:"flex", alignItems:"center", justifyContent:"center", padding:DS.sp.lg, overflowY:"auto", fontFamily:F }}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:DS.r["2xl"], padding:"28px 30px 22px", maxWidth:600, width:"100%", maxHeight:"92vh", overflowY:"auto", boxShadow:DS.shadow.xl }}>

        {/* 0 — Bienvenida */}
        {paso === 0 && (
          <div>
            <Header/>
            <div style={{ fontSize:DS.font["3xl"], fontWeight:DS.w.black, color:T.text, letterSpacing:-0.8, lineHeight:1.2, marginBottom:DS.sp.md }}>
              {welcome.h}
            </div>
            <div style={{ fontSize:DS.font.lg, color:T.textMd, lineHeight:1.6, marginBottom:DS.sp.xl }}>
              {welcome.p}
            </div>
            {welcome.bullets.map((b, i) => (
              <div key={i} style={{ display:"flex", gap:DS.sp.sm, alignItems:"center", marginBottom:DS.sp.sm }}>
                <Check/><span style={{ fontSize:DS.font.lg, color:T.text }}>{b}</span>
              </div>
            ))}
            <div style={{ marginTop:DS.sp.lg, padding:"12px 14px", background:T.accentSolid + "10", border:`1px solid ${T.accentSolid}33`, borderRadius:DS.r.lg, fontSize:DS.font.base, color:T.textMd, lineHeight:1.55 }}>
              Dejar todo andando lleva <strong style={{ color:T.text }}>unos 20 minutos</strong> en {total} pasos. Te vamos guiando uno por uno y podés retomar cuando quieras desde <strong style={{ color:T.text }}>Inicio → Tu plan de acción</strong>.
            </div>
            <Nav cta="Ver cómo funciona"/>
          </div>
        )}

        {/* 1 — Cómo funciona */}
        {paso === 1 && (
          <div>
            <Header small/>
            <div style={{ fontSize:DS.font["2xl"], fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.5, marginBottom:4 }}>Así funciona, de punta a punta</div>
            <div style={{ fontSize:DS.font.base, color:T.textSm, marginBottom:DS.sp.md }}>Cuatro piezas que se conectan solas una vez configuradas:</div>
            <div style={{ display:"flex", flexDirection:"column" }}>
              {COMO_FUNCIONA.map((f, i) => (
                <div key={f.id} style={{ display:"flex", gap:DS.sp.md, alignItems:"flex-start", padding:"10px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}` }}>
                  <SectionIcon T={T} path={STEP_ICONS[f.id]} size={36}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.semibold, color:T.text }}>{i + 1}. {f.nombre}</div>
                    <div style={{ fontSize:DS.font.base, color:T.textSm, marginTop:1, lineHeight:1.5 }}>{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
            <Nav cta="Empezar el plan de acción"/>
          </div>
        )}

        {/* 2..N — un paso por pantalla */}
        {s && (
          <div>
            <Header small/>
            <div style={{ display:"flex", gap:DS.sp.md, alignItems:"center", marginBottom:DS.sp.md }}>
              <div style={{ position:"relative", flexShrink:0 }}>
                <SectionIcon T={T} path={STEP_ICONS[s.id]} size={46}/>
                <span style={{ position:"absolute", top:-6, right:-6, width:20, height:20, borderRadius:"50%", background: s.done ? T.green : T.card, border:`1px solid ${s.done ? T.green : T.border}`, color: s.done ? "#fff" : T.textSm, fontSize:10, fontWeight:DS.w.bold, display:"flex", alignItems:"center", justifyContent:"center" }}>{s.done ? "✓" : s.n}</span>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:DS.font.sm, color:T.textSm, fontWeight:DS.w.semibold, textTransform:"uppercase", letterSpacing:0.6 }}>Paso {s.n} de {total}{s.optional ? " · opcional" : ""}</div>
                <div style={{ fontSize:DS.font["2xl"], fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.5, lineHeight:1.2 }}>{s.title}</div>
              </div>
            </div>

            {s.done ? (
              <Callout T={T} tone="success" title={s.later ? "Lo dejaste para más tarde" : "Listo ✓"} style={{ marginBottom:DS.sp.md }}>
                {s.later ? "Cuando quieras conectarlo, está en Integraciones." : "Este paso ya está hecho. Podés seguir con el siguiente."}
              </Callout>
            ) : s.locked ? (
              <Callout T={T} tone="warning" title="Todavía no" style={{ marginBottom:DS.sp.md }}>{s.lockedMsg}</Callout>
            ) : null}

            <p style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.65, margin:"0 0 12px" }}>{s.why}</p>

            {/* Tipo de negocio: se elige acá mismo (el canal y la pasarela toman el default del tipo). */}
            {s.id === "negocio" && (
              <div style={{ marginBottom:DS.sp.md }}>
                <BusinessProfileSection merchant={merchant} compact onChange={onMerchantChange}/>
              </div>
            )}

            <div style={{ background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px", marginBottom:DS.sp.md }}>
              <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", letterSpacing:0.6, color:T.textSm, fontWeight:DS.w.bold, marginBottom:8 }}>Qué vas a necesitar</div>
              {(s.needs || []).map((n, i) => (
                <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:DS.font.base, color:T.text, lineHeight:1.5, marginBottom: i < s.needs.length - 1 ? 6 : 0 }}>
                  <span style={{ width:6, height:6, borderRadius:"50%", background:T.accent, marginTop:7, flexShrink:0 }}/>{n}
                </div>
              ))}
            </div>

            {s.id === "shopify" && <StepHint T={T} DS={DS}>Los permisos exactos son {SHOPIFY_SCOPE_IDS.map(sc => <React.Fragment key={sc}><Code T={T}>{sc}</Code> </React.Fragment>)}. En Conectar Shopify los copiás con un botón.</StepHint>}
            {s.id === "mp" && <StepHint T={T} DS={DS}>Usá el token de <strong style={{ color:T.text }}>producción</strong> (empieza con <Code T={T}>APP_USR-</Code>). Con uno <Code T={T}>TEST-</Code> podés probar, pero nadie te va a poder pagar de verdad.</StepHint>}
            {s.id === "plan" && <StepHint T={T} DS={DS}>Un buen arranque: pack x1 al precio normal con 10% de descuento por suscribirse, y pack x2 o x3 un poco más barato por unidad.</StepHint>}
            {s.id === "snippet" && <StepHint T={T} DS={DS}>{merchantProfile(merchant).channel === "tiendanube" ? "En Tiendanube no se pega nada: el widget se carga solo. Aparece únicamente en los productos que tienen plan activo." : "Se pega una sola vez para toda la tienda. El widget solo aparece en los productos que tienen plan activo."}</StepHint>}

            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginTop:DS.sp.md }}>
              {s.id === "email" && !s.done ? (
                <button onClick={reenviarMail} disabled={busy} style={{ ...BtnPrimary(T), fontSize:DS.font.base, padding:"9px 18px", opacity: busy ? 0.6 : 1 }}>Reenviar mail de verificación</button>
              ) : (
                <button onClick={() => go(s)} disabled={s.locked && !s.done} style={{ ...(s.done ? BtnSecondary(T) : BtnPrimary(T)), fontSize:DS.font.base, padding:"9px 18px", opacity: (s.locked && !s.done) ? 0.5 : 1 }}>
                  {s.done ? "Volver a ver" : s.cta} →
                </button>
              )}
              {s.guideSec && <button onClick={() => goGuide(s.guideSec)} style={{ ...BtnSecondary(T), fontSize:DS.font.base, padding:"9px 14px" }}>Ver guía paso a paso</button>}
              {s.manual && !s.done && (
                <button onClick={() => { onb?.setManual?.(s, true); }} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:DS.font.md, padding:"8px 6px", fontFamily:F, textDecoration:"underline", textDecorationColor:T.border }}>{s.manualLabel}</button>
              )}
            </div>

            <Nav cta={stepIdx === steps.length - 1 ? "Ver resumen" : "Lo hago después"}/>
          </div>
        )}

        {/* Último — resumen del plan de acción */}
        {paso === SUMMARY && (
          <div>
            <Header small/>
            <div style={{ fontSize:DS.font["2xl"], fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.5, marginBottom:4 }}>{allDone ? "¡Está todo listo!" : "Tu plan de acción"}</div>
            <div style={{ fontSize:DS.font.base, color:T.textSm, marginBottom:DS.sp.md }}>
              {allDone ? "Tu tienda ya acepta suscripciones. Probá una compra de prueba y mirá cómo entra en Suscriptores." : `Te faltan ${total - done} pasos. Podés seguirlos desde Inicio cuando quieras.`}
            </div>
            <div style={{ border:`1px solid ${T.border}`, borderRadius:DS.r.xl, overflow:"hidden" }}>
              {steps.map((st, i) => (
                <button key={st.id} onClick={() => go(st)} disabled={st.locked && !st.done}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"10px 14px", background: st.id === nextStep?.id ? T.accentSolid + "0f" : "transparent", border:"none", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, cursor: st.locked && !st.done ? "default" : "pointer", textAlign:"left", fontFamily:F, opacity: st.locked && !st.done ? 0.55 : 1 }}>
                  <span style={{ width:24, height:24, borderRadius:"50%", background: st.done ? T.green : (st.id === nextStep?.id ? T.accentSolid + "22" : T.surface), border: st.done ? "none" : `1px solid ${T.border}`, color: st.done ? "#fff" : (st.id === nextStep?.id ? T.accent : T.textSm), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:DS.w.bold, flexShrink:0 }}>{st.done ? "✓" : st.n}</span>
                  <span style={{ flex:1, minWidth:0, fontSize:DS.font.base, fontWeight:DS.w.semibold, color: st.done ? T.textSm : T.text, textDecoration: st.done ? "line-through" : "none", textDecorationColor:T.border }}>{st.title}</span>
                  {st.id === nextStep?.id && <span style={{ fontSize:DS.font.xs, fontWeight:DS.w.bold, color:T.accent, background:T.accentSolid + "1a", borderRadius:99, padding:"2px 8px" }}>SIGUIENTE</span>}
                  {!st.done && !st.locked && <span style={{ color:T.textSm }}>→</span>}
                </button>
              ))}
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:DS.sp.md, marginTop:DS.sp.xl, flexWrap:"wrap" }}>
              <button onClick={() => setPaso(p => p - 1)} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:DS.font.lg, padding:"10px 6px", fontFamily:F }}>← Atrás</button>
              <a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer" style={{ fontSize:DS.font.md, color:T.textSm, textDecoration:"none" }}>¿Trabado? Escribinos por WhatsApp</a>
              <div style={{ flex:1 }}/>
              {nextStep && !allDone
                ? <button onClick={() => go(nextStep)} style={{ ...BtnPrimary(T), fontSize:DS.font.lg, padding:"10px 22px" }}>Ir al paso {nextStep.n} →</button>
                : <button onClick={onClose} style={{ ...BtnPrimary(T), fontSize:DS.font.lg, padding:"10px 22px" }}>Ir al panel →</button>}
            </div>
          </div>
        )}

        {/* Saltar la presentación */}
        {paso < SUMMARY && (
          <div style={{ textAlign:"center", marginTop:DS.sp.md }}>
            <button onClick={() => setPaso(SUMMARY)} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:DS.font.base, padding:DS.sp.xs, fontFamily:F }}>Saltar al resumen</button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepHint({ T, DS, children }) {
  return <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.55, padding:"9px 12px", borderLeft:`3px solid ${T.accentSolid}66`, background:T.accentSolid + "08", borderRadius:`0 ${DS.r.md}px ${DS.r.md}px 0` }}>{children}</div>;
}
export function Code({ T, children }) {
  return <code style={{ fontFamily:"ui-monospace, SFMono-Regular, Menlo, monospace", fontSize:12, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:4, padding:"1px 5px", color:T.text }}>{children}</code>;
}

// ═══════════════════════════════════════════════════════════════════
// Card "Tu plan de acción" (Inicio) — misma lista que el wizard, en línea.
// ═══════════════════════════════════════════════════════════════════
export function PlanDeAccionCard({ onOpenGuide }) {
  const T = useT();
  const DS = DS_;
  const onb = useOnb();
  const [open, setOpen] = useState(null);
  const [hidden, setHidden] = useState(() => readFlag(planHiddenKey(onb?.mid)));
  useEffect(() => { setHidden(readFlag(planHiddenKey(onb?.mid))); }, [onb?.mid]);
  if (!onb) return null;
  const { steps, done, total, nextStep, allDone } = onb;
  if (allDone && hidden) return null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const cur = open ?? nextStep?.id ?? null;

  return (
    <Card T={T} className="gh-card-enter" style={{ marginBottom:DS.sp.lg, border:`1px solid ${allDone ? T.green + "55" : T.accentSolid + "55"}` }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap", marginBottom:12 }}>
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ fontSize:15, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 }}>{allDone ? "🎉 Tu tienda ya acepta suscripciones" : "🎯 Tu plan de acción"}</div>
          <div style={{ fontSize:DS.font.md, color:T.textSm, marginTop:3, lineHeight:1.5 }}>
            {allDone ? `Completaste los ${total} pasos. Probá una suscripción para ver todo el circuito.` : `${done} de ${total} pasos listos · el siguiente es "${nextStep?.title}".`}
          </div>
        </div>
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
          <Btn T={T} variant="secondary" size="sm" onClick={onOpenGuide}>Ver guía</Btn>
          {allDone && <Btn T={T} variant="ghost" size="sm" onClick={() => { writeFlag(planHiddenKey(onb.mid), true); setHidden(true); }} style={{ color:T.textSm }}>Ocultar</Btn>}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
        <div style={{ flex:1, height:6, borderRadius:99, background:T.border, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, background:`linear-gradient(90deg, ${T.accentSolid}, ${T.green})`, borderRadius:99, transition:`width 0.4s ${DS.ease}` }}/>
        </div>
        <span style={{ fontSize:DS.font.sm, color:T.textSm, fontWeight:DS.w.bold, whiteSpace:"nowrap" }}>{done}/{total}</span>
      </div>

      <div style={{ display:"flex", flexDirection:"column" }}>
        {steps.map((s, i) => {
          const isOpen = cur === s.id;
          const isNext = nextStep?.id === s.id;
          return (
            <div key={s.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderL}` }}>
              <button onClick={() => setOpen(isOpen ? "" : s.id)} style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"10px 2px", background:"transparent", border:"none", cursor:"pointer", textAlign:"left", fontFamily:F, color:T.text }}>
                <div style={{ width:26, height:26, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:DS.font.sm, fontWeight:DS.w.bold,
                  background: s.done ? T.green : (isNext ? T.accentSolid + "22" : T.surface), color: s.done ? "#fff" : (isNext ? T.accent : T.textSm), border: s.done ? "none" : `1px solid ${isNext ? T.accentSolid + "66" : T.border}` }}>
                  {s.done ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> : s.n}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color: s.done ? T.textSm : T.text, textDecoration: s.done ? "line-through" : "none", textDecorationColor:T.border, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    {s.title}
                    {s.effort && <span style={{ fontSize:10, fontWeight:800, letterSpacing:0.4, textTransform:"uppercase", color: s.done ? T.textSm : T.accent, background: (s.done ? T.border : T.accentSolid) + "22", border:`1px solid ${(s.done ? T.border : T.accentSolid)}55`, borderRadius:99, padding:"1px 8px" }}>{s.effort}</span>}
                    {isNext && <span style={{ fontSize:DS.font.xs, fontWeight:DS.w.bold, color:T.accent, background:T.accentSolid + "1a", borderRadius:99, padding:"1px 7px" }}>SIGUIENTE</span>}
                    {s.later && <span style={{ fontSize:DS.font.xs, fontWeight:DS.w.bold, color:T.textSm, background:T.surface, border:`1px solid ${T.border}`, borderRadius:99, padding:"1px 7px" }}>MÁS TARDE</span>}
                  </div>
                  {!isOpen && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:1, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.done ? "Listo" : s.short}</div>}
                </div>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={T.textSm} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, transform: isOpen ? "rotate(180deg)" : "none", transition:"transform 0.2s" }}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {isOpen && (
                <div className="gh-accordion" style={{ padding:"0 2px 14px 38px" }}>
                  <div style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.6, marginBottom:8 }}>{s.why}</div>
                  {s.locked && !s.done && <div style={{ fontSize:DS.font.sm, color:T.yellow, marginBottom:8 }}>{s.lockedMsg}</div>}
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                    <button onClick={() => onb.goStep(s)} disabled={s.locked && !s.done} style={{ ...(s.done ? BtnSecondary(T) : BtnPrimary(T)), fontSize:DS.font.md, padding:"7px 14px", opacity: (s.locked && !s.done) ? 0.5 : 1 }}>{s.done ? "Volver a ver" : s.cta} →</button>
                    {s.guideSec && <button onClick={() => onb.goGuide(s.guideSec)} style={{ ...BtnSecondary(T), fontSize:DS.font.md, padding:"7px 12px" }}>Guía</button>}
                    {s.manual && (
                      <label style={{ display:"inline-flex", alignItems:"center", gap:7, fontSize:DS.font.md, color:T.textMd, cursor:"pointer", userSelect:"none" }}>
                        <input type="checkbox" checked={readFlag(s.manualKey)} onChange={e => onb.setManual(s, e.target.checked)} style={{ width:15, height:15, accentColor:T.accentSolid }}/>
                        {s.manualLabel}
                      </label>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Estado vacío con plan: "Todavía no tenés X. Para que aparezcan: …"
//   section: clave de SECTION_NEEDS · icon/title/desc · extra (nodo opcional)
// ═══════════════════════════════════════════════════════════════════
export function OnbEmpty({ section, icon, title, desc, tip, extraAction }) {
  const T = useT();
  const DS = DS_;
  const onb = useOnb();
  const needIds = SECTION_NEEDS[section] || [];
  const missing = (onb?.steps || []).filter(s => needIds.includes(s.id) && !s.done);
  const first = missing.find(s => !s.locked) || missing[0] || null;

  const subtitle = (
    <span>
      {desc}
      {tip && <> <Tip T={T} text={tip}/></>}
    </span>
  );

  if (!onb || missing.length === 0) {
    return (
      <DSEmpty T={T} icon={icon} title={title} subtitle={subtitle}
        action={onb ? (
          <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap" }}>
            {extraAction}
          </div>
        ) : extraAction}/>
    );
  }

  return (
    <Card T={T} padding="xl" className="gh-section" style={{ textAlign:"center" }}>
      {icon ? <div style={{ fontSize:42, marginBottom:DS.sp.md, opacity:0.8 }}>{icon}</div> : null}
      <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, marginBottom:DS.sp.xs }}>{title}</div>
      <div style={{ fontSize:DS.font.md, color:T.textSm, maxWidth:460, margin:"0 auto", lineHeight:1.55 }}>{subtitle}</div>
      <div style={{ maxWidth:420, margin:"16px auto 0", textAlign:"left", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px" }}>
        <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", letterSpacing:0.6, color:T.textSm, fontWeight:DS.w.bold, marginBottom:8 }}>Para que aparezcan, te falta</div>
        {missing.map(s => (
          <button key={s.id} onClick={() => onb.goStep(s)} disabled={s.locked} style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"7px 8px", background:"transparent", border:"none", borderRadius:DS.r.md, cursor: s.locked ? "default" : "pointer", textAlign:"left", fontFamily:F, opacity: s.locked ? 0.55 : 1 }}
            onMouseEnter={e => { if (!s.locked) e.currentTarget.style.background = T.card; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
            <span style={{ width:22, height:22, borderRadius:"50%", background:T.card, border:`1px solid ${T.border}`, color:T.textSm, fontSize:11, fontWeight:DS.w.bold, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>{s.n}</span>
            <span style={{ flex:1, fontSize:DS.font.base, color:T.text, fontWeight:DS.w.semibold }}>{s.title}</span>
            <span style={{ color:T.accent, fontWeight:DS.w.bold }}>→</span>
          </button>
        ))}
      </div>
      <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginTop:DS.sp.lg }}>
        {first && <Btn T={T} variant="solid" onClick={() => onb.goStep(first)} disabled={first.locked}>{first.cta} →</Btn>}
        <Btn T={T} variant="secondary" onClick={() => onb.goTab?.("inicio")}>Ver mi plan de acción</Btn>
        {extraAction}
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Tips (?) listos para pegar en pantallas de otros archivos.
//   Planes (cabecera / editor de packs):   <PackTip T={T}/>
//   Diseño del widget (WidgetDesigner):    <WidgetDesignTip T={T}/>
//   Integraciones → card Mercado Pago:     <MpTokenTip T={T}/>
//   Integraciones → card Shopify:          <ShopifyAppTip T={T}/>  (con link a la guía si pasás goTab)
// ═══════════════════════════════════════════════════════════════════
export function PackTip({ T: Tp, label = "¿Qué es un pack?" }) { const Tt = useT(); const T = Tp || Tt; return <Tip T={T} label={label} text={TIPS.pack}/>; }
export function WidgetDesignTip({ T: Tp, label = "¿Cómo funciona el diseño?" }) { const Tt = useT(); const T = Tp || Tt; return <Tip T={T} label={label} text={TIPS.widgetDesign}/>; }
export function MpTokenTip({ T: Tp, label = "¿De dónde saco el token?" }) { const Tt = useT(); const T = Tp || Tt; return <Tip T={T} label={label} text={TIPS.mpToken}/>; }
export function ShopifyAppTip({ T: Tp, label = "¿Qué es la app personalizada?", goTab }) {
  const Tt = useT(); const T = Tp || Tt;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
      <Tip T={T} label={label} text={TIPS.shopifyApp}/>
      {goTab && <a href="#/config/ayuda?s=shopify" onClick={e => { e.preventDefault(); goGuideSection(goTab, "shopify"); }} style={{ fontSize:DS_.font.sm, color:T.accent, fontWeight:DS_.w.semibold, textDecoration:"none" }}>Ver guía →</a>}
    </span>
  );
}
