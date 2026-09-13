import React, { useState, useEffect, useMemo } from "react";
import { apiGet } from "../lib/api.js";
import { BtnPrimary, BtnSecondary } from "../ui/components.jsx";

// ─────────────────────────────────────────────────────────────────
// Onboarding — 5 pasos para un comerciante nuevo. Chasis portado del
// OnboardingWizard de Growith; el contenido es de Recurrentes.
// El estado "hecho" de cada paso se calcula desde `merchant` (no se
// guarda): así el wizard sigue siendo útil si el comerciante vuelve.
//   1. Conectar Shopify        → merchant.shopify_token
//   2. Conectar Mercado Pago   → merchant.mp_access_token
//   3. Crear el primer plan    → plansCount > 0 (prop o GET /api/plans)
//   4. Pegar el widget         → localStorage rec_onb_widget_<merchant.id>
//   5. Tienda y mails          → merchant.store_domain && merchant.email_brand
// `onDone()` lo llama "Omitir por ahora" y "Listo"; el shell persiste
// rec_onb_done_<merchantId>.
// ─────────────────────────────────────────────────────────────────

const FALLBACK_T = {
  isDark: true, bg: "var(--bg)", surface: "var(--surface)", card: "var(--card)",
  border: "var(--border)", borderL: "var(--border-light)", text: "var(--text)",
  textMd: "var(--text-md)", textSm: "var(--text-sm)", accent: "#10b981", accentSolid: "#10b981",
  green: "#10b981", greenBg: "rgba(16,185,129,0.12)", yellow: "#f59e0b", yellowBg: "rgba(245,158,11,0.12)",
  red: "#ef4444", redBg: "rgba(239,68,68,0.10)", input: "var(--surface)", inputBorder: "var(--border-light)",
};
const FALLBACK_DS = {
  sp: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, "3xl": 32 },
  r: { sm: 6, md: 8, lg: 10, xl: 14, "2xl": 16, full: 9999 },
  font: { xs: 10, sm: 11, md: 12, base: 13, lg: 14, xl: 16, "2xl": 20, "3xl": 26 },
  w: { regular: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
};

export const widgetKey = (merchantId) => `rec_onb_widget_${merchantId || "default"}`;

function readWidgetDone(merchantId) {
  try { return localStorage.getItem(widgetKey(merchantId)) === "1"; } catch (_) { return false; }
}

export default function OnboardingWizard({ T: Tp, DS: DSp, merchant, goTab, onDone, plansCount: plansCountProp }) {
  const T = Tp || FALLBACK_T;
  const DS = DSp || FALLBACK_DS;
  const m = merchant || {};
  const mid = m.id || m.merchant_id || null;

  const shopifyOk = Boolean(m.shopify_token);
  const mpOk = Boolean(m.mp_access_token);
  const settingsOk = Boolean(m.store_domain && m.email_brand);

  // Planes: prop explícita > merchant.plans_count > consulta a /api/plans.
  const [plansFetched, setPlansFetched] = useState(null);
  useEffect(() => {
    if (typeof plansCountProp === "number" || typeof m.plans_count === "number") return;
    if (!shopifyOk || !mpOk) { setPlansFetched(0); return; } // sin integraciones no hay planes posibles
    let alive = true;
    apiGet("plans").then(d => { if (alive) setPlansFetched(Array.isArray(d?.plans) ? d.plans.length : 0); })
      .catch(() => { if (alive) setPlansFetched(0); });
    return () => { alive = false; };
    // eslint-disable-next-line
  }, [mid, shopifyOk, mpOk, plansCountProp, m.plans_count]);
  const plansCount = typeof plansCountProp === "number" ? plansCountProp
    : typeof m.plans_count === "number" ? m.plans_count
    : (plansFetched ?? 0);
  const planOk = plansCount > 0;

  const [widgetOk, setWidgetOk] = useState(() => readWidgetDone(mid));
  useEffect(() => { setWidgetOk(readWidgetDone(mid)); }, [mid]);
  function toggleWidget(v) {
    setWidgetOk(v);
    try { if (v) localStorage.setItem(widgetKey(mid), "1"); else localStorage.removeItem(widgetKey(mid)); } catch (_) {}
  }

  const go = (tab) => { try { goTab?.(tab); } catch (_) {} };

  const STEPS = useMemo(() => [
    {
      id: "shopify", done: shopifyOk,
      title: "Conectá tu Shopify",
      short: "Para leer tus productos y crear las órdenes de cada cobro.",
      body: (
        <>
          <p style={pStyle(T, DS)}>Recurrentes necesita permiso para leer tus productos y crear una orden en tu tienda cada vez que Mercado Pago cobra una suscripción.</p>
          <p style={pStyle(T, DS)}>Vas a necesitar una <strong style={{ color: T.text }}>app personalizada</strong> en tu Shopify (Configuración → Apps → Desarrollar apps) con su <strong style={{ color: T.text }}>Client ID</strong> y <strong style={{ color: T.text }}>Client Secret</strong>. En Integraciones hay una guía paso a paso con los permisos exactos; son 5 minutos.</p>
        </>
      ),
      cta: "Ir a Integraciones", onCta: () => go("integraciones"),
    },
    {
      id: "mp", done: mpOk,
      title: "Conectá Mercado Pago",
      short: "Es la cuenta que cobra: el dinero va directo a vos.",
      body: (
        <>
          <p style={pStyle(T, DS)}>Los cobros recurrentes los procesa tu propia cuenta de Mercado Pago. Recurrentes no toca la plata: solo crea las suscripciones y escucha los pagos.</p>
          <p style={pStyle(T, DS)}>Si está disponible, usá <strong style={{ color: T.text }}>"Conectar con Mercado Pago"</strong> y autorizás sin copiar nada. Si no, pegá el <strong style={{ color: T.text }}>Access Token de producción</strong> de una aplicación creada en tu panel de MP Developers con "Suscripciones" habilitado. Podés arrancar con el token de prueba (TEST-…) y cambiarlo después.</p>
        </>
      ),
      cta: "Ir a Integraciones", onCta: () => go("integraciones"),
    },
    {
      id: "plan", done: planOk,
      title: "Creá tu primer plan",
      short: "Elegís un producto, cada cuánto se cobra y con qué descuento.",
      body: (
        <>
          <p style={pStyle(T, DS)}>Un plan convierte un producto de tu Shopify en suscripción: frecuencia (cada 30, 60, 90 días), precio o descuento respecto del precio normal y, si querés, envío incluido.</p>
          <p style={pStyle(T, DS)}>{planOk ? `Ya tenés ${plansCount} plan${plansCount === 1 ? "" : "es"} creado${plansCount === 1 ? "" : "s"}.` : "Empezá con tu producto más vendido; después podés crear todos los que quieras."}</p>
        </>
      ),
      cta: planOk ? "Ver planes" : "Crear plan", onCta: () => go("planes"),
      locked: !(shopifyOk && mpOk), lockedMsg: "Primero conectá Shopify y Mercado Pago.",
    },
    {
      id: "widget", done: widgetOk,
      title: "Pegá el widget en tu theme",
      short: "Es lo que muestra la opción \"Suscribirme\" en la página del producto.",
      body: (
        <>
          <p style={pStyle(T, DS)}>En Planes, cada plan tiene un botón <strong style={{ color: T.text }}>"Código para tu tienda"</strong> con un snippet. Se pega una sola vez en el <code style={codeStyle(T)}>theme.liquid</code> de tu tema (antes de <code style={codeStyle(T)}>&lt;/body&gt;</code>) y a partir de ahí el widget aparece solo en los productos que tengan plan.</p>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: DS.font.base, color: T.text, marginTop: 6, userSelect: "none" }}>
            <input type="checkbox" checked={widgetOk} onChange={e => toggleWidget(e.target.checked)} style={{ width: 16, height: 16, accentColor: T.accentSolid }} />
            Ya lo pegué en mi tema
          </label>
        </>
      ),
      cta: "Ir al snippet", onCta: () => go("planes"),
    },
    {
      id: "settings", done: settingsOk,
      title: "Configurá tu tienda y los mails",
      short: "Dominio de la tienda y nombre del remitente de los avisos.",
      body: (
        <>
          <p style={pStyle(T, DS)}>Con el <strong style={{ color: T.text }}>dominio de tu tienda</strong> armamos los links del checkout y del portal del suscriptor. Con el <strong style={{ color: T.text }}>nombre de marca del remitente</strong> firmamos los mails de bienvenida, cobro y recupero.</p>
          <p style={pStyle(T, DS)}>Ahí también definís envíos del checkout, códigos de descuento y el recupero automático de carritos abandonados.</p>
        </>
      ),
      cta: "Ir a Configuración", onCta: () => go("configuracion"),
    },
  ], [T, DS, shopifyOk, mpOk, planOk, plansCount, widgetOk, settingsOk]);

  const doneCount = STEPS.filter(s => s.done).length;
  const allDone = doneCount === STEPS.length;
  const firstPending = STEPS.findIndex(s => !s.done);
  const [open, setOpen] = useState(() => (firstPending === -1 ? 0 : firstPending));
  // Cuando se completa el paso abierto, saltamos al siguiente pendiente.
  useEffect(() => {
    if (STEPS[open]?.done && firstPending !== -1) setOpen(firstPending);
    // eslint-disable-next-line
  }, [doneCount]);

  const pct = Math.round((doneCount / STEPS.length) * 100);

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", fontFamily: "inherit", color: T.text }}>
      <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: DS.r.xl, padding: "26px 28px 20px", boxShadow: "0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: DS.font["3xl"], fontWeight: DS.w.black, letterSpacing: -0.8, lineHeight: 1.15, color: T.text }}>
              {allDone ? "Todo listo" : "Poné en marcha tus suscripciones"}
            </div>
            <div style={{ fontSize: DS.font.lg, color: T.textMd, marginTop: 6, lineHeight: 1.55 }}>
              {allDone
                ? "Tu tienda ya acepta suscripciones. Desde acá en adelante todo pasa solo: cobros, órdenes y avisos."
                : "Cinco pasos, la mayoría de un click. Podés hacerlos en cualquier orden y volver cuando quieras."}
            </div>
          </div>
          <button onClick={() => onDone?.()} style={{ background: "transparent", border: "none", color: T.textSm, cursor: "pointer", fontSize: DS.font.md, padding: "6px 4px", fontFamily: "inherit", fontWeight: DS.w.semibold, flexShrink: 0 }}>
            {allDone ? "Cerrar" : "Omitir por ahora"}
          </button>
        </div>

        {/* Barra de progreso */}
        <div style={{ marginTop: 18, marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: DS.font.sm, color: T.textSm, fontWeight: DS.w.semibold, marginBottom: 6 }}>
            <span>Progreso</span><span>{doneCount}/{STEPS.length}</span>
          </div>
          <div style={{ height: 6, borderRadius: 99, background: T.border, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: `linear-gradient(90deg, ${T.accentSolid}, ${T.green})`, borderRadius: 99, transition: `width 0.4s ${DS.ease}` }} />
          </div>
        </div>

        {/* Pasos */}
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column" }}>
          {STEPS.map((s, i) => {
            const isOpen = open === i;
            return (
              <div key={s.id} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderL}` }}>
                <button onClick={() => setOpen(isOpen ? -1 : i)}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "13px 4px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: T.text }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: DS.font.base, fontWeight: DS.w.bold,
                    background: s.done ? T.accentSolid : (isOpen ? T.accentSolid + "18" : T.surface), color: s.done ? "#fff" : (isOpen ? T.accent : T.textSm), border: s.done ? "none" : `1px solid ${isOpen ? T.accentSolid + "66" : T.border}`, transition: `all 0.2s ${DS.ease}` }}>
                    {s.done ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg> : i + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: DS.font.lg, fontWeight: DS.w.semibold, color: s.done ? T.textMd : T.text, textDecoration: s.done ? "line-through" : "none", textDecorationColor: T.textSm }}>{s.title}</div>
                    {!isOpen && <div style={{ fontSize: DS.font.md, color: T.textSm, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.done ? "Listo" : s.short}</div>}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.textSm} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}><polyline points="6 9 12 15 18 9" /></svg>
                </button>
                {isOpen && (
                  <div style={{ padding: "0 4px 16px 46px" }}>
                    {s.body}
                    {s.locked && !s.done && <div style={{ fontSize: DS.font.sm, color: T.yellow, marginBottom: 8 }}>{s.lockedMsg}</div>}
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                      <button onClick={s.onCta} disabled={s.locked && !s.done} style={{ ...(s.done ? BtnSecondary(T) : BtnPrimary(T)), fontSize: DS.font.base, padding: "9px 18px", opacity: (s.locked && !s.done) ? 0.5 : 1 }}>
                        {s.cta} →
                      </button>
                      {!s.done && i < STEPS.length - 1 && (
                        <button onClick={() => setOpen(i + 1)} style={{ background: "transparent", border: "none", color: T.textSm, cursor: "pointer", fontSize: DS.font.md, padding: "8px 6px", fontFamily: "inherit" }}>Después</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {allDone && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.borderL}`, display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => onDone?.()} style={{ ...BtnPrimary(T), fontSize: DS.font.base, padding: "10px 22px" }}>Ir al panel →</button>
          </div>
        )}
      </div>
    </div>
  );
}

const pStyle = (T, DS) => ({ fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6, margin: "0 0 10px" });
const codeStyle = (T) => ({ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: 4, padding: "1px 5px", color: T.text });
