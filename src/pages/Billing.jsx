import React, { useState, useEffect } from "react";
import { apiPost } from "../lib/api.js";
import { DS as DS_ } from "../ui/theme.js";
import { Card, BtnSolid, Badge, Callout, toast } from "../ui/components.jsx";
import { PRICING_TIERS, TIER_BY_ID, FREE_SUBSCRIBERS, PLAN_FEATURES, tierRangeLabel } from "../../shared/platform/pricing.js";
import { WhatsAppUsageLine } from "./WhatsAppIntegration.jsx";

// Planes del SaaS (lo que paga el comerciante). Tramos y precios en
// shared/platform/pricing.js: el precio sale de los SUSCRIPTORES ACTIVOS, los
// primeros 5 son gratis y todo lo demás está incluido en todos los planes.
// Sin cobro automático todavía: "Activar plan" manda un pedido
// (POST merchant?action=plan-request) y lo confirmamos a mano. Nunca se corta nada.

const F = "'Inter',system-ui,sans-serif";
const fmtN = (n) => Number(n || 0).toLocaleString("es-AR");
const fmtDia = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? new Date(t).toLocaleDateString("es-AR", { day: "numeric", month: "long" }) : "—"; };

export function planLabel(id) {
  if (TIER_BY_ID[id]) return TIER_BY_ID[id].label;
  if (id === "beta") return "Beta";
  return "Free";
}

function Check({ c }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}><polyline points="20 6 9 17 4 12"/></svg>;
}

// Pedido de activación. El server es idempotente por día (doble clic = un mail).
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

// Pago con tarjeta (Stripe, cuenta de Recurrentes). Solo si el server lo habilitó.
function useSaasStripe(reloadMerchant) {
  const [busy, setBusy] = useState(null);
  async function pay(id) {
    if (busy) return; setBusy("pay");
    try {
      const r = await apiPost("merchant", { plan: id, return_origin: window.location.origin }, { action: "saas-checkout" });
      if (!r?.url) throw new Error(r?.error || "No se pudo abrir el pago");
      window.location.href = r.url;
    } catch (e) { toast(e.message || "No se pudo abrir el pago", "error", 6000); setBusy(null); }
  }
  async function portal() {
    if (busy) return; setBusy("portal");
    try {
      const r = await apiPost("merchant", { return_origin: window.location.origin }, { action: "saas-portal" });
      if (!r?.url) throw new Error(r?.error || "No se pudo abrir el portal de pago");
      window.location.href = r.url;
    } catch (e) { toast(e.message || "No se pudo abrir el portal", "error", 6000); setBusy(null); }
  }
  // Vuelta de Stripe: #/config/facturacion?saas=ok|cancel
  useEffect(() => {
    const q = new URLSearchParams((window.location.hash.split("?")[1]) || "");
    const r = q.get("saas");
    if (!r) return;
    try { window.history.replaceState(null, "", window.location.pathname + "#/config/facturacion"); } catch (_) {}
    if (r === "ok") { toast("¡Plan activado! El pago quedó registrado. Gracias.", "success", 7000); reloadMerchant?.(); }
    else toast("No se completó el pago. Podés intentarlo cuando quieras: nada se corta.", "info", 6000);
    // eslint-disable-next-line
  }, []);
  return { busy, pay, portal };
}

// Escalera de tramos (10 escalones → 2 filas de 5 en desktop, 2 columnas en
// mobile). `current` resalta el tramo del comerciante.
// La usan Configuración → Facturación y la landing.
export function PricingTable({ T, current }) {
  return (
    <div style={{ fontFamily: F }}>
      <style>{`
        .rec-pricing-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;}
        @media(max-width:1000px){ .rec-pricing-grid{grid-template-columns:repeat(3,minmax(0,1fr));} }
        @media(max-width:700px){ .rec-pricing-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;} }
      `}</style>
      <div className="rec-pricing-grid">
        {PRICING_TIERS.map(t => {
          const on = current === t.id;
          const free = t.usd === 0;
          return (
            <div key={t.id} style={{ position: "relative", background: on ? T.accentSolid + "12" : T.card, border: `1.5px solid ${on ? T.accentSolid : free ? T.accentSolid + "55" : T.border}`, borderRadius: 14, padding: "14px 14px 13px", display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: T.text }}>{t.label}</span>
                {on && <Badge T={T} colors={{ bg: T.accentSolid + "1a", dot: T.accent }}>Tu plan</Badge>}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginTop: 4 }}>
                {free
                  ? <span style={{ fontSize: 26, fontWeight: 900, color: T.accent, letterSpacing: -0.8, lineHeight: 1.05 }}>Gratis</span>
                  : <><span style={{ fontSize: 12, fontWeight: 700, color: T.textSm }}>USD</span><span style={{ fontSize: 26, fontWeight: 900, color: T.text, letterSpacing: -0.8, lineHeight: 1.05, fontVariantNumeric: "tabular-nums" }}>{t.usd}</span><span style={{ fontSize: 11, color: T.textSm }}>/mes</span></>}
              </div>
              <div style={{ fontSize: 12, color: on ? T.accent : T.textMd, fontWeight: 600, lineHeight: 1.4 }}>{tierRangeLabel(t)}</div>
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 14, background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: T.textSm, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 }}>Todo incluido en todos los planes</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "8px 18px" }}>
          {PLAN_FEATURES.map(f => (
            <div key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12.5, lineHeight: 1.45, color: T.textMd }}><Check c={T.accent}/>{f}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Card de estado: suscriptores activos, tramo actual y cuánto falta para el siguiente.
function StatusCard({ T, billing, loadingId, onActivate, stripe }) {
  const b = billing || {};
  const beta = b.plan === "beta";
  const n = b.active_subscribers || 0;
  const max = b.tier_max;
  const pct = max ? Math.min(100, Math.round((n / max) * 100)) : 100;
  const edge = b.needs_activation ? T.yellow : T.accentSolid;
  const next = b.next_tier;
  const tier = TIER_BY_ID[b.tier] || TIER_BY_ID.free;
  return (
    <Card T={T} padding="lg" style={{ marginBottom: 16, borderLeft: `3px solid ${edge}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 17, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>
          {beta ? "Tu plan de Recurrentes: cuenta beta" : `Tu plan de Recurrentes: ${b.plan_label || tier.label}`}
        </span>
        {beta
          ? <Badge T={T} colors={{ bg: T.accentSolid + "1a", dot: T.accent }}>Sin cargo durante la beta</Badge>
          : <Badge T={T} colors={{ bg: edge + "1a", dot: edge }}>{b.plan_usd ? `USD ${b.plan_usd}/mes` : "Gratis"}</Badge>}
      </div>
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, color: T.textMd, marginBottom: 6 }}>
          <span>Suscriptores activos</span>
          <strong style={{ color: T.text, fontVariantNumeric: "tabular-nums" }}>{fmtN(n)}{max && !beta ? ` / ${fmtN(max)}` : ""}</strong>
        </div>
        {!beta && max ? (
          <div style={{ height: 8, borderRadius: 99, background: T.borderL, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: pct >= 100 ? T.yellow : T.accentSolid, borderRadius: 99, transition: "width .3s" }}/>
          </div>
        ) : null}
        <div style={{ fontSize: 12, color: T.textSm, marginTop: 8, lineHeight: 1.5 }}>
          {beta
            ? "Tu cuenta es de la beta: no pagás mientras dure. Cuando termine te avisamos con tiempo."
            : next ? `Hasta ${fmtN(max)} suscriptores seguís en ${tier.label}. Desde el ${fmtN(next.min)} pasás a ${next.label} (USD ${next.usd}/mes).` : "Estás en el último tramo: sin techo de suscriptores."}
        </div>
      </div>
      {!beta && b.activated_plan && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          {[["Plan activo", `${planLabel(b.activated_plan)} · USD ${TIER_BY_ID[b.activated_plan]?.usd || 0}/mes`], ["Activado el", fmtDia(b.plan_activated_at)], ["Último pago", fmtDia(b.last_paid_at)], ["Próximo cobro", fmtDia(b.next_payment_at)]].map(([k, v]) => (
            <div key={k} style={{ background: T.surface, border: `1px solid ${T.borderL}`, borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: T.textSm }}>{k}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginTop: 2 }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {!beta && b.activated_plan && (
        <div style={{ fontSize: 12, color: T.textSm, marginTop: 10, lineHeight: 1.55, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>Se cobra cada {b.cycle_days || 30} días desde tu primer pago. Ese día pagás el tramo que corresponda a tus suscriptores activos en ese momento: si creciste, el tramo nuevo entra en ese cobro, sin cargos a mitad de mes.</span>
          {b.billing_method === "stripe" && stripe && <button onClick={stripe.portal} disabled={!!stripe.busy} style={{ ...BtnSolid(T), padding: "7px 12px", fontSize: 12, opacity: stripe.busy ? 0.6 : 1 }}>{stripe.busy === "portal" ? "Abriendo…" : "Tarjeta y facturas"}</button>}
        </div>
      )}
      {b.saas_status === "past_due" && (
        <Callout T={T} tone="danger" title="El último cobro de tu plan fue rechazado" style={{ marginTop: 12 }}
          right={stripe && b.billing_method === "stripe" && <button onClick={stripe.portal} style={{ ...BtnSolid(T), padding: "8px 14px", fontSize: 12.5 }}>Actualizar tarjeta</button>}>
          Nada se corta. Actualizá la tarjeta y Stripe lo reintenta solo.
        </Callout>
      )}
      {b.needs_activation && (
        <Callout T={T} tone="warning" title={`Te corresponde el plan ${tier.label}`} style={{ marginTop: 14 }}
          right={b.stripe_available && stripe
            ? <button onClick={() => stripe.pay(b.tier)} disabled={!!stripe.busy} style={{ ...BtnSolid(T), padding: "8px 14px", fontSize: 12.5, opacity: stripe.busy ? 0.6 : 1 }}>{stripe.busy === "pay" ? "Abriendo el pago…" : `Activar ${tier.label} · USD ${tier.usd}/mes`}</button>
            : onActivate && <button onClick={() => onActivate(b.tier)} disabled={!!loadingId || b.plan_requested === b.tier} style={{ ...BtnSolid(T), padding: "8px 14px", fontSize: 12.5, opacity: loadingId || b.plan_requested === b.tier ? 0.6 : 1 }}>{loadingId ? "Enviando…" : b.plan_requested === b.tier ? "Pedido enviado ✓" : `Activar ${tier.label}`}</button>}>
          Tenés {fmtN(n)} suscriptores activos ({tierRangeLabel(tier).toLowerCase()}). Nada se corta.{" "}
          {b.stripe_available ? <>Pagás con tarjeta, en dólares, y desde ahí se cobra cada 30 días el tramo que te corresponda ese día. {onActivate && <button onClick={() => onActivate(b.tier)} disabled={!!loadingId} style={{ background: "none", border: "none", color: T.textMd, textDecoration: "underline", cursor: "pointer", fontFamily: F, fontSize: 12, padding: 0 }}>{b.plan_requested === b.tier ? "Pedido enviado ✓" : "Prefiero coordinarlo por otro medio"}</button>}</> : "Activalo y te contactamos para coordinar el pago."}
        </Callout>
      )}
      {b.plan_requested && (
        <div style={{ marginTop: 12, fontSize: 12, color: T.textMd, background: T.accentSolid + "10", border: `1px solid ${T.accentSolid}33`, borderRadius: 10, padding: "8px 12px" }}>
          Pediste el plan <b style={{ color: T.text }}>{planLabel(b.plan_requested)}</b> el {fmtDia(b.plan_requested_at)}. Te contactamos para activarlo.
        </div>
      )}
    </Card>
  );
}

const FAQS = [
  { q: "¿Qué es un suscriptor activo?", a: "Un cliente con su suscripción cobrando: activa o con un pago fallido que Mercado Pago está reintentando. Pausados, cancelados y los que nunca pagaron no cuentan." },
  { q: "¿Qué pasa si paso de tramo?", a: "Nada se corta: los cobros, las órdenes y el panel siguen. Te avisamos y activás el plan que corresponde." },
  { q: "¿Cómo se paga?", a: "Con tarjeta, en dólares, sin contrato. Se cobra cada 30 días desde tu primer pago, y ese día pagás el tramo que corresponda a tus suscriptores activos en ese momento. Si creciste, el tramo nuevo entra en ese cobro; nunca cobramos diferenciales a mitad de mes. Si bajás de 10 suscriptores, dejás de pagar." },
];

// Configuración → Facturación ("Tu plan de Recurrentes").
export function PlanPage({ T, DS = DS_, merchant, reloadMerchant }) {
  const billing = merchant?.billing || {};
  const { loadingId, choose } = usePlanRequest(reloadMerchant);
  const stripe = useSaasStripe(reloadMerchant);
  return (
    <div style={{ fontFamily: F, maxWidth: 980 }}>
      <StatusCard T={T} billing={billing} loadingId={loadingId} onActivate={choose} stripe={stripe}/>
      {merchant?.whatsapp_sender && (
        <Card T={T} padding="md" style={{ marginBottom: 16 }}>
          <WhatsAppUsageLine T={T} merchant={merchant}/>
        </Card>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 14px" }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: -0.3 }}>Pagás según tus suscriptores activos</span>
        <span style={{ fontSize: 12, color: T.textSm }}>Los primeros {FREE_SUBSCRIBERS} son gratis · en dólares · sin contrato</span>
      </div>
      <PricingTable T={T} current={billing.plan === "beta" ? null : billing.tier}/>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%, 250px),1fr))", gap: 12, marginTop: 24 }}>
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

// Franja arriba del contenido: aparece solo cuando le corresponde un tramo pago
// que todavía no activó. Informativa: nunca bloquea.
export function BillingBanner({ T, billing, onGo }) {
  const b = billing || {};
  if (!b.needs_activation) return null;
  const tier = TIER_BY_ID[b.tier];
  if (!tier) return null;
  return (
    <div style={{ background: T.yellowBg, borderBottom: `1px solid ${T.yellow}44`, padding: "9px 24px", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", fontSize: 12.5, color: T.text, fontFamily: F }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: T.yellow, flexShrink: 0 }}/>
      <span><strong>{fmtN(b.active_subscribers)} suscriptores activos</strong> · te corresponde {tier.label} (USD {tier.usd}/mes)</span>
      <span style={{ color: T.textSm }}>·</span>
      <button onClick={onGo} style={{ background: "none", border: "none", color: T.yellow, fontWeight: 700, cursor: "pointer", fontFamily: F, fontSize: 12.5, padding: 0, textDecoration: "underline", textUnderlineOffset: 2 }}>{b.plan_requested === b.tier ? "Ver pedido" : "Activar plan"}</button>
    </div>
  );
}
