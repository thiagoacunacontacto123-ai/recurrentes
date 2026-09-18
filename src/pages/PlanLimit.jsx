// Avisos y bloqueo del límite del plan gratis (11–15 = gracia, 16+ = bloqueado).
// El estado lo calcula el backend (shared/platform/enforcement.js) y llega en
// merchant.billing: enforcement, can_sell, grace_left, enforcement_copy.
//
// Tres piezas:
//   PlanLimitBar    barra roja fija arriba, no se puede cerrar (gracia y bloqueo)
//   PlanLimitModal  cartel grande al entrar; se cierra pero vuelve cada sesión
//   PlanBlockedView pantalla de pago que reemplaza las secciones de edición
//
// Lo que SIEMPRE dice el copy: los suscriptores que ya tiene se siguen cobrando.
// Es la primera duda del comerciante y si no la contestamos, entra en pánico.
import React, { useState, useEffect } from "react";
import { DS } from "../ui/theme.js";
import { Card, Btn, Spinner, toast } from "../ui/components.jsx";
import { apiPost } from "../lib/api.js";
import { TIER_BY_ID } from "../../shared/platform/pricing.js";

const F = "'Inter',system-ui,sans-serif";
const fmtN = (n) => Number(n || 0).toLocaleString("es-AR");

export const isGrace = (b) => b?.enforcement === "grace";
export const isBlocked = (b) => b?.enforcement === "blocked";
export const showsPlanLimit = (b) => isGrace(b) || isBlocked(b);

// "Ver planes": va a Facturación y baja hasta la tabla de planes (si ya estaba ahí,
// igual baja: antes no pasaba nada y parecía roto).
export function goToPlans(onGo) {
  try { onGo?.(); } catch (_) {}
  let tries = 0;
  const tick = () => {
    const el = document.querySelector("[data-pricing-table]");
    if (el) { el.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (++tries < 20) setTimeout(tick, 100);
  };
  setTimeout(tick, 50);
}

// Arranca el pago: Stripe Checkout si está configurado, si no el pedido a mano.
export function usePlanCheckout(billing, tierId) {
  const [busy, setBusy] = useState(false);
  const tier = tierId || billing?.tier || null;
  async function pay() {
    if (busy || !tier) return;
    setBusy(true);
    try {
      if (billing?.stripe_available) {
        const r = await apiPost("merchant", { plan: tier, return_origin: window.location.origin }, { action: "saas-checkout" });
        if (r?.url) { window.location.href = r.url; return; }
        toast(r?.error || "No se pudo abrir el pago", "error", 6000);
      } else {
        const r = await apiPost("merchant", { plan: tier }, { action: "plan-request" });
        if (r?.error) toast(r.error, "error", 6000);
        else toast("Listo, te contactamos para activarlo.", "success", 6000);
      }
    } catch (e) { toast("Error: " + e.message, "error", 6000); }
    finally { setBusy(false); }
  }
  return { pay, busy, tier };
}

// ─── Barra fija arriba ───────────────────────────────────────────────────────
// No se puede cerrar a propósito: es el recordatorio permanente que pidió Thiago.
export function PlanLimitBar({ T, billing, onGo }) {
  const b = billing || {};
  if (!showsPlanLimit(b)) return null;
  const blocked = isBlocked(b);
  const q = Number(b.grace_left) || 0;
  const tier = TIER_BY_ID[b.tier];
  const msg = blocked
    ? <>Tu widget está <strong>apagado</strong>: llegaste a {fmtN(b.active_subscribers)} suscriptores y no entran suscripciones nuevas.</>
    : q === 0
      ? <>Con <strong>un suscriptor más</strong> se apaga tu widget. Tenés {fmtN(b.active_subscribers)} de {fmtN(b.grace_limit)}.</>
      : <>Te {q === 1 ? "queda" : "quedan"} <strong>{fmtN(q)} {q === 1 ? "suscriptor" : "suscriptores"}</strong> antes de que se apague tu widget. Tenés {fmtN(b.active_subscribers)} de {fmtN(b.grace_limit)}.</>;
  return (
    <>
      <style>{`@keyframes rec-pl-pulse{0%,100%{opacity:1}50%{opacity:.45}}`}</style>
      <div role="alert" style={{
        background: blocked ? T.red : T.redBg,
        borderBottom: `1px solid ${T.red}`,
        padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center",
        gap: 10, flexWrap: "wrap", fontSize: 12.5, fontFamily: F,
        color: blocked ? "#fff" : T.text, position: "sticky", top: 0, zIndex: 30,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: blocked ? "#fff" : T.red, flexShrink: 0, animation: "rec-pl-pulse 1.6s ease-in-out infinite" }}/>
        <span>{msg}</span>
        <button onClick={onGo} style={{
          background: blocked ? "#fff" : T.red, color: blocked ? T.red : "#fff",
          border: "none", borderRadius: 99, padding: "5px 13px", fontWeight: 800,
          cursor: "pointer", fontFamily: F, fontSize: 12, flexShrink: 0,
        }}>
          {tier ? `Activar ${tier.label} · USD ${tier.usd}/mes` : "Activar plan"}
        </button>
      </div>
    </>
  );
}

// ─── Cartel grande al entrar ─────────────────────────────────────────────────
// Se puede cerrar (en gracia todavía tiene que poder operar su negocio) pero
// vuelve en cada sesión nueva, y en bloqueo vuelve siempre.
export function PlanLimitModal({ T, billing, merchantId, onGo }) {
  const b = billing || {};
  const blocked = isBlocked(b);
  const copy = b.enforcement_copy || null;
  // Sale CADA vez que entra al panel (Thiago, 18-sept): se puede cerrar para operar,
  // pero en la próxima carga vuelve. Sin memoria por sesión.
  const [open, setOpen] = useState(() => showsPlanLimit(b));
  const { pay, busy, tier } = usePlanCheckout(b);
  if (!showsPlanLimit(b) || !open || !copy) return null;
  const t = TIER_BY_ID[tier];
  const close = () => setOpen(false);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18, fontFamily: F }}>
      <Card T={T} padding="xl" style={{ maxWidth: 520, width: "100%", border: `2px solid ${T.red}`, textAlign: "center" }}>
        <div style={{ width: 46, height: 46, borderRadius: 99, background: T.redBg, border: `1px solid ${T.red}55`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", fontSize: 22 }}>⚠️</div>
        <div style={{ fontSize: DS.font["2xl"], fontWeight: DS.w.black, color: T.text, letterSpacing: -0.4, lineHeight: 1.2, margin: "0 0 10px" }}>{copy.title}</div>
        <p style={{ fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6, margin: "0 0 12px" }}>{copy.body}</p>
        {/* Lo que sigue andando: contesta la duda antes de que la haga. */}
        <div style={{ background: T.greenBg, border: `1px solid ${T.accent}44`, borderRadius: 10, padding: "10px 12px", fontSize: DS.font.sm, color: T.textMd, lineHeight: 1.5, margin: "0 0 18px", textAlign: "left", display: "flex", gap: 8 }}>
          <span style={{ flexShrink: 0 }}>✓</span><span>{copy.keeps}</span>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn T={T} variant="solid" onClick={pay} disabled={busy} style={{ background: T.red, borderColor: T.red }}>
            {busy ? <Spinner size={13} color="#fff"/> : (t ? `Activar ${t.label} · USD ${t.usd}/mes` : copy.cta)}
          </Btn>
          <Btn T={T} variant="secondary" onClick={() => { close(); goToPlans(onGo); }}>Ver planes</Btn>
          {!blocked && <Btn T={T} variant="ghost" onClick={close} style={{ color: T.textSm }}>Seguir por ahora</Btn>}
        </div>
        {blocked && (
          <button onClick={close} style={{ marginTop: 14, background: "none", border: "none", color: T.textSm, fontSize: DS.font.sm, cursor: "pointer", fontFamily: F, textDecoration: "underline", textUnderlineOffset: 2 }}>
            Ver mis cobros
          </button>
        )}
      </Card>
    </div>
  );
}

// ─── Pantalla de bloqueo (reemplaza las secciones de edición) ────────────────
// Thiago: bloqueado = pago + lectura de sus cobros. Editar planes, widget y
// flujos no: para eso paga. Cobros y Suscripciones siguen en lectura.
export function PlanBlockedView({ T, billing, title, onGo, onGoCobros }) {
  const b = billing || {};
  const copy = b.enforcement_copy || {};
  const { pay, busy, tier } = usePlanCheckout(b);
  const t = TIER_BY_ID[tier];
  return (
    <div style={{ maxWidth: 560, margin: "32px auto", textAlign: "center", fontFamily: F }}>
      <Card T={T} padding="xl" style={{ border: `2px solid ${T.red}` }}>
        <div style={{ fontSize: 34, marginBottom: 10 }}>🔒</div>
        <div style={{ fontSize: DS.font["2xl"], fontWeight: DS.w.black, color: T.text, letterSpacing: -0.4, margin: "0 0 10px" }}>
          {title ? `${title} está bloqueado` : copy.title || "Activá tu plan"}
        </div>
        <p style={{ fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6, margin: "0 0 12px" }}>
          {copy.body || "Pasaste el límite del plan gratis. Activá tu plan para volver a recibir suscripciones."}
        </p>
        {copy.keeps && (
          <div style={{ background: T.greenBg, border: `1px solid ${T.accent}44`, borderRadius: 10, padding: "10px 12px", fontSize: DS.font.sm, color: T.textMd, lineHeight: 1.5, margin: "0 0 18px", textAlign: "left", display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>✓</span><span>{copy.keeps}</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn T={T} variant="solid" onClick={pay} disabled={busy} style={{ background: T.red, borderColor: T.red }}>
            {busy ? <Spinner size={13} color="#fff"/> : (t ? `Activar ${t.label} · USD ${t.usd}/mes` : "Activar plan")}
          </Btn>
          <Btn T={T} variant="secondary" onClick={() => goToPlans(onGo)}>Ver planes</Btn>
          {onGoCobros && <Btn T={T} variant="ghost" onClick={onGoCobros} style={{ color: T.textSm }}>Ver mis cobros</Btn>}
        </div>
      </Card>
    </div>
  );
}
