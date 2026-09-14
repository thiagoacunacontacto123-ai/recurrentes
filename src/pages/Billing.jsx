import React, { useState } from "react";
import { apiPost } from "../lib/api.js";
import { DS as DS_ } from "../ui/theme.js";
import { Card, BtnSecondary, BtnSolid, Badge, toast } from "../ui/components.jsx";

// Planes del SaaS (lo que paga el comerciante). Espejo de api/_lib/plans_saas.js
// — duplicado a propósito: el front no importa nada de api/. Sin Stripe todavía:
// "Elegir plan" manda un pedido (POST merchant?action=plan-request) y se activa a mano.

const F = "'Inter',system-ui,sans-serif";

export const PLANS = [
  {
    id: "starter", label: "Starter", usd: 29, orders_limit: 20,
    tagline: "Para arrancar con las primeras suscripciones.",
    features: [
      "Hasta 20 pedidos de suscripción por mes",
      "Widget de suscripción en tu Shopify",
      "Cobros automáticos con Mercado Pago",
      "Una orden Shopify por cada cobro",
      "Portal del suscriptor",
      "Recupero de carritos vía Klaviyo",
    ],
  },
  {
    id: "growth", label: "Growth", usd: 69, orders_limit: 100, featured: true,
    tagline: "Para tiendas que ya venden por suscripción todos los días.",
    features: [
      "Hasta 100 pedidos de suscripción por mes",
      "Todo lo de Starter",
      "Varias tiendas en un solo login",
      "Equipo con permisos por sección",
      "Meta Conversions API",
      "Soporte prioritario",
    ],
  },
  {
    id: "pro", label: "Pro", usd: 99, orders_limit: null,
    tagline: "Más de 100 pedidos por mes, sin techo.",
    features: [
      "Pedidos de suscripción ilimitados",
      "Todo lo de Growth",
      "Onboarding asistido 1 a 1",
      "Soporte por WhatsApp",
    ],
  },
];
export const PLAN_BY_ID = Object.fromEntries(PLANS.map(p => [p.id, p]));

export function planLabel(id) {
  if (PLAN_BY_ID[id]) return PLAN_BY_ID[id].label;
  if (id === "beta") return "Beta";
  return "Prueba gratis";
}

// Plan sugerido según los pedidos del mes en curso.
export function suggestPlan(ordersThisMonth) {
  const n = Number(ordersThisMonth) || 0;
  if (n <= 20) return "starter";
  if (n <= 100) return "growth";
  return "pro";
}

const fmtDia = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleDateString("es-AR", { day: "numeric", month: "long" }) : "—"; };

function Check({ c }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><polyline points="20 6 9 17 4 12"/></svg>;
}

// Pedido de plan (compartido por PlanPage y PlanWall). El server es idempotente
// por día, así que el doble clic no manda dos mails.
function usePlanRequest(reloadMerchant) {
  const [loadingId, setLoadingId] = useState(null);
  async function choose(id) {
    if (loadingId) return;
    setLoadingId(id);
    try {
      const r = await apiPost("merchant", { plan: id }, { action: "plan-request" });
      if (!r?.ok || r?.error) throw new Error(r?.error || "No se pudo enviar el pedido");
      toast(r.already ? "Ya recibimos tu pedido hoy. Te contactamos a la brevedad." : (r.message || "Pedido enviado"), "success", 6500);
      if (reloadMerchant) await reloadMerchant();
    } catch (e) { toast(e.message || "No se pudo enviar el pedido", "error", 6000); }
    setLoadingId(null);
  }
  return { loadingId, choose };
}

// Las 3 cards. Con `onChoose` el CTA pide el plan; sin él (landing) es un link a #/registro.
export function PricingCards({ T, current, requested, loadingId, onChoose, ctaLabel }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 14, alignItems: "start", fontFamily: F }}>
      {PLANS.map(pl => {
        const esActual = current === pl.id;
        const pedido = requested === pl.id;
        const cargando = loadingId === pl.id;
        const btn = pl.featured ? BtnSolid(T) : BtnSecondary(T);
        const btnStyle = { ...btn, width: "100%", justifyContent: "center", padding: "10px 16px", fontSize: 13, boxSizing: "border-box" };
        return (
          <Card key={pl.id} T={T} padding="lg" style={{ position: "relative", border: `1px solid ${esActual ? T.accentSolid + "aa" : pl.featured ? T.accentSolid + "66" : T.border}`, boxShadow: pl.featured ? "0 10px 36px rgba(16,185,129,0.14)" : undefined }}>
            {(esActual || pl.featured) && (
              <span style={{ position: "absolute", top: 14, right: 14 }}>
                <Badge T={T} colors={{ bg: T.accentSolid + "1a", dot: T.accent }}>{esActual ? "Tu plan" : "Más elegido"}</Badge>
              </span>
            )}
            <div style={{ fontSize: 15, fontWeight: 800, color: T.text }}>{pl.label}</div>
            <div style={{ fontSize: 12, color: T.textSm, minHeight: 34, lineHeight: 1.5, margin: "2px 0 12px" }}>{pl.tagline}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 34, fontWeight: 900, color: T.text, letterSpacing: -1, lineHeight: 1 }}>USD {pl.usd}</span>
              <span style={{ fontSize: 12, color: T.textSm }}>/ mes</span>
            </div>
            <div style={{ fontSize: 12, color: T.accent, fontWeight: 600, marginTop: 8, marginBottom: 14 }}>
              {pl.orders_limit ? `Hasta ${pl.orders_limit} pedidos por mes` : "Pedidos ilimitados"}
            </div>
            {onChoose ? (
              <button onClick={() => onChoose(pl.id)} disabled={!!loadingId || esActual} style={{ ...btnStyle, opacity: (loadingId && !cargando) || esActual ? 0.6 : 1, cursor: esActual ? "default" : "pointer" }}>
                {cargando ? "Enviando…" : esActual ? "Plan actual" : pedido ? "Pedido enviado ✓" : (ctaLabel || "Elegir plan")}
              </button>
            ) : (
              <a href="#/registro" style={{ ...btnStyle, textDecoration: "none" }}>{ctaLabel || "Probar 7 días gratis"}</a>
            )}
            <div style={{ borderTop: `1px solid ${T.borderL}`, marginTop: 16, paddingTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {pl.features.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, lineHeight: 1.45, color: i === 0 ? T.text : T.textMd, fontWeight: i === 0 ? 600 : 400 }}>
                  <Check c={T.accent}/>{f}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// Card de estado: plan actual, días de prueba o pedidos usados / límite.
function StatusCard({ T, billing }) {
  const b = billing || {};
  const trial = b.plan === "trial";
  const beta = b.plan === "beta";
  const lim = b.orders_limit;
  const used = b.orders_this_month || 0;
  const pct = lim ? Math.min(100, Math.round(used / lim * 100)) : 0;
  const barColor = pct >= 100 ? T.red : pct >= 80 ? T.yellow : T.accentSolid;
  const edge = trial ? (b.trial_expired ? T.red : b.trial_days_left <= 2 ? T.yellow : T.accentSolid) : b.limit_reached ? T.yellow : T.accentSolid;
  const n = b.trial_days_left ?? 0;
  return (
    <Card T={T} padding="lg" style={{ marginBottom: 16, borderLeft: `3px solid ${edge}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
          {trial ? "Tu plan de Recurrentes: prueba gratis con todo incluido" : beta ? "Tu plan de Recurrentes: cuenta beta" : `Tu plan de Recurrentes: ${b.plan_label || planLabel(b.plan)}`}
        </span>
        {trial && !b.trial_expired && <Badge T={T} colors={{ bg: edge + "1a", dot: edge }}>{n} día{n === 1 ? "" : "s"} restante{n === 1 ? "" : "s"}</Badge>}
        {trial && b.trial_expired && <Badge T={T} colors={{ bg: T.red + "1a", dot: T.red }}>Prueba terminada</Badge>}
        {beta && <Badge T={T} colors={{ bg: T.accentSolid + "1a", dot: T.accent }}>Sin límite de pedidos</Badge>}
        {!trial && !beta && <Badge T={T} colors={{ bg: T.green + "1a", dot: T.green }}>Activo</Badge>}
        {trial && <span style={{ fontSize: 12, color: T.textSm, marginLeft: "auto" }}>Termina el {fmtDia(b.trial_end)}</span>}
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textMd, marginBottom: 6 }}>
          <span>Pedidos de suscripción este mes</span>
          <strong style={{ color: T.text }}>{used}{lim ? ` / ${lim}` : ""}</strong>
        </div>
        {lim ? (
          <div style={{ height: 8, borderRadius: 99, background: T.borderL, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: barColor, borderRadius: 99, transition: "width .3s" }}/>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: T.textSm }}>{trial ? "Durante la prueba no hay límite. Después elegís el plan según cuántos pedidos generás por mes." : "Sin límite de pedidos."}</div>
        )}
        {b.limit_reached && <div style={{ fontSize: 12, color: T.yellow, marginTop: 8, fontWeight: 600 }}>Llegaste al límite de tu plan este mes. Pasá al siguiente para no quedarte corto.</div>}
      </div>
      {b.plan_requested && (
        <div style={{ marginTop: 12, fontSize: 12, color: T.textMd, background: T.accentSolid + "10", border: `1px solid ${T.accentSolid}33`, borderRadius: 10, padding: "8px 12px" }}>
          Pediste el plan <b style={{ color: T.text }}>{planLabel(b.plan_requested)}</b> el {fmtDia(b.plan_requested_at)}. Te contactamos para activarlo.
        </div>
      )}
    </Card>
  );
}

const FAQS = [
  { q: "¿Qué cuenta como pedido?", a: "Cada orden de suscripción que Recurrentes genera en tu Shopify (cobro aprobado → orden). Las compras únicas no cuentan." },
  { q: "¿Qué pasa si me paso del límite?", a: "Nada se corta: los cobros y las órdenes siguen. Te avisamos para que pases al plan siguiente." },
  { q: "¿Cómo se paga?", a: "Por ahora te contactamos al elegir un plan y lo activamos a mano. El pago con tarjeta llega pronto." },
];

// Configuración → Facturación ("Tu plan de Recurrentes"). También la usa el PlanWall.
export function PlanPage({ T, DS = DS_, merchant, reloadMerchant }) {
  const billing = merchant?.billing || {};
  const { loadingId, choose } = usePlanRequest(reloadMerchant);
  const tienePago = !!PLAN_BY_ID[billing.plan];
  return (
    <div style={{ fontFamily: F, maxWidth: 980 }}>
      <StatusCard T={T} billing={billing}/>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 14px" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>{tienePago ? "Cambiar tu plan de Recurrentes" : "Elegí tu plan de Recurrentes"}</span>
        <span style={{ fontSize: 12, color: T.textSm }}>En dólares · sin contrato · cancelás cuando quieras</span>
      </div>
      <PricingCards T={T} current={tienePago ? billing.plan : null} requested={billing.plan_requested} loadingId={loadingId} onChoose={choose}/>
      <div style={{ marginTop: 16, fontSize: 12, color: T.textSm, lineHeight: 1.6, textAlign: "center" }}>
        Pagos con tarjeta: próximamente. Al elegir un plan te contactamos para activarlo.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))", gap: 12, marginTop: 24 }}>
        {FAQS.map(f => (
          <div key={f.q} style={{ background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: DS.r.lg, padding: "12px 14px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: T.text, marginBottom: 4 }}>{f.q}</div>
            <div style={{ fontSize: 12, color: T.textSm, lineHeight: 1.55 }}>{f.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Franja arriba del contenido: días de prueba (amarillo en los últimos 2) o
// límite de pedidos alcanzado en Starter/Growth.
export function TrialBanner({ T, billing, onGo }) {
  const b = billing || {};
  let text = null, cta = "Ver tu plan de Recurrentes", warn = false, extra = "";
  if (b.limit_reached && PLAN_BY_ID[b.plan]) {
    text = `Llegaste al límite de ${b.orders_limit} pedidos este mes`; cta = "Mejorar plan"; warn = true;
  } else if (b.plan === "trial" && !b.trial_expired) {
    const n = b.trial_days_left ?? 0;
    text = n <= 0 ? "Tu prueba termina hoy" : `Te quedan ${n} día${n === 1 ? "" : "s"} de prueba`;
    warn = n <= 2; extra = " · Todo habilitado";
  }
  if (!text) return null;
  const color = warn ? T.yellow : T.accent;
  return (
    <div style={{ background: warn ? T.yellowBg : T.accentSolid + "12", borderBottom: `1px solid ${color}44`, padding: "9px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: T.text, fontFamily: F }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: color, flexShrink: 0 }}/>
      <span><strong>{text}</strong>{extra}</span>
      <span style={{ color: T.textSm }}>·</span>
      <button onClick={onGo} style={{ background: "none", border: "none", color, fontWeight: 700, cursor: "pointer", fontFamily: F, fontSize: 12.5, padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>{cta}</button>
    </div>
  );
}

// Pantalla completa cuando `billing.locked` (prueba vencida). Se monta en lugar
// del contenido, con el sidebar visible. Los cobros de los clientes siguen.
export function PlanWall({ T, DS = DS_, merchant, reloadMerchant, onLogout }) {
  const billing = merchant?.billing || {};
  const { loadingId, choose } = usePlanRequest(reloadMerchant);
  const n = billing.orders_this_month || 0;
  const sug = PLAN_BY_ID[suggestPlan(n)];
  return (
    <div className="pad-mobile" style={{ flex: 1, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 32px 64px", fontFamily: F }}>
      <div style={{ maxWidth: 940, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 26 }}>
          <div style={{ width: 68, height: 68, borderRadius: "50%", background: T.accentSolid + "18", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          </div>
          <div style={{ display: "inline-flex", marginBottom: 12 }}>
            <Badge T={T} colors={{ bg: T.yellow + "1a", dot: T.yellow }}>Prueba de {7} días finalizada</Badge>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: T.text, letterSpacing: -0.6, margin: "0 0 8px", lineHeight: 1.2 }}>Tu prueba de 7 días terminó</h1>
          <p style={{ fontSize: 13.5, color: T.textMd, lineHeight: 1.6, maxWidth: 560, margin: "0 auto" }}>
            Elegí un plan para seguir usando el panel. <strong style={{ color: T.text }}>Los cobros de tus clientes siguen funcionando</strong>: el widget, Mercado Pago y las órdenes en Shopify no se cortan.
          </p>
          {n > 0 && sug && (
            <p style={{ fontSize: 12.5, color: T.textSm, margin: "10px auto 0" }}>
              Este mes generaste <strong style={{ color: T.text }}>{n} pedido{n === 1 ? "" : "s"}</strong> de suscripción → te queda bien <strong style={{ color: T.accent }}>{sug.label}</strong>.
            </p>
          )}
          {billing.plan_requested && (
            <div style={{ display: "inline-block", marginTop: 12, fontSize: 12.5, color: T.textMd, background: T.accentSolid + "10", border: `1px solid ${T.accentSolid}33`, borderRadius: 10, padding: "8px 14px" }}>
              Ya pediste el plan <b style={{ color: T.text }}>{planLabel(billing.plan_requested)}</b>. Te contactamos en el día para activarlo.
            </div>
          )}
        </div>
        <PricingCards T={T} requested={billing.plan_requested} loadingId={loadingId} onChoose={choose}/>
        <div style={{ textAlign: "center", marginTop: 18, fontSize: 12, color: T.textSm, lineHeight: 1.6 }}>
          Pagos con tarjeta: próximamente. Al elegir un plan te contactamos para activarlo.
        </div>
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button onClick={onLogout} style={{ ...BtnSecondary(T), borderRadius: DS.r.md }}>Cerrar sesión</button>
        </div>
      </div>
    </div>
  );
}
