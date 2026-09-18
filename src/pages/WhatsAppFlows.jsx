// Flujos de WhatsApp — Clientes → Flujos de WhatsApp.
// A diferencia de los flujos de mail, acá el comercio NO edita textos: las
// plantillas son de Recurrentes (Meta las aprobó) y solo prende o apaga cada
// una. Abajo ve cuánto lleva gastado en mensajes este mes y los anteriores.
// Sin WhatsApp prendido: cartel que lo manda a Integraciones, con el costo claro.
import React, { useEffect, useState } from "react";
import { apiGet, apiPost } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { PageHeader, Callout, Btn, DSToggle, DSBadge, Loading, Spinner, toast } from "../ui/components.jsx";
import { WA_GREEN } from "./FlowsWhatsApp.jsx";

const F = "'Inter',system-ui,sans-serif";
const fmtUsd = (n) => { const v = Number(n) || 0; return v < 0.01 && v > 0 ? `US$ ${v.toFixed(4).replace(/0+$/, "")}` : `US$ ${v.toFixed(2)}`; };
const fmtN = (n) => Number(n || 0).toLocaleString("es-AR");
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mesLabel = (ym) => { const [y, m] = String(ym).split("-"); return `${MESES[(+m || 1) - 1]} ${y}`; };
const WHEN = {
  upcoming_charge: (d) => `${d || 3} días antes de cada cobro`,
  payment_failed: () => "cuando Mercado Pago rechaza una renovación",
  activated: () => "cuando se activa la suscripción (primer pago)",
  renewed: () => "cada vez que se cobra una renovación",
};

export default function WhatsAppFlowsPage({ merchant, goConfig }) {
  const T = useT();
  const isOwner = !merchant?.role || merchant.role === "owner";
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(null); // nombre de la plantilla que se está cambiando

  async function load() {
    const d = await apiGet("merchant", { action: "whatsapp-flows" }).catch(e => ({ error: e.message }));
    if (d?.error) setErr(d.error); else { setData(d); setErr(""); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [merchant?.id]);

  async function toggle(t) {
    if (!isOwner) return toast("Solo el dueño de la tienda puede prender o apagar los avisos", "warning");
    setBusy(t.name);
    try {
      const r = await apiPost("merchant", { name: t.name, active: !t.active }, { action: "whatsapp-template-toggle" });
      if (r?.error) { toast(r.error, "error", 7000); if (r.code === "not_enabled") load(); }
      else { setData(r); toast(!t.active ? `“${t.title}” prendido` : `“${t.title}” apagado`, "success"); }
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setBusy(null); }
  }

  const header = <PageHeader T={T} title="Flujos de WhatsApp" subtitle="Avisos automáticos a tus clientes por WhatsApp, desde el número de Recurrentes y a nombre de tu tienda. Prendés los que querés; los textos ya están aprobados por Meta."/>;
  if (err) return <div>{header}<Callout T={T} tone="danger" title="No pudimos cargar esta sección">{err}</Callout></div>;
  if (!data) return <div>{header}<Loading T={T}/></div>;

  const charge = data.charge_usd;
  const pct = Math.round((Number(data.markup || 1) - 1) * 100);

  // ── Sin WhatsApp prendido: cartel a Integraciones, con el costo dicho de frente ──
  if (!data.enabled) {
    return (
      <div>
        {header}
        <Callout T={T} tone="info" title={data.available ? "Prendé WhatsApp para usar estos avisos" : "WhatsApp todavía no está disponible"}
          right={data.available ? <Btn T={T} variant="solid" size="sm" onClick={() => goConfig?.("integraciones")}>Ir a Integraciones →</Btn> : null}>
          {data.available ? (
            <>
              Se prende con un interruptor en <strong style={{ color: T.text }}>Integraciones → WhatsApp</strong>, sin configurar nada. Después volvés acá y elegís qué avisos mandar.<br/>
              <strong style={{ color: T.text }}>Costo:</strong> cada mensaje cuesta <strong style={{ color: T.text }}>{fmtUsd(charge)}</strong> (lo que cobra Meta más {pct}%) y se suma a tu plan a fin de mes. Solo pagás los que salen: si no tenés cobros, no gastás nada.
            </>
          ) : "Estamos terminando de habilitar el número de Recurrentes con Meta. Mientras tanto podés conectar tu propio número desde Integraciones → WhatsApp."}
        </Callout>
        <TemplateList T={T} data={data} disabled onToggle={() => goConfig?.("integraciones")} busy={null}/>
      </div>
    );
  }

  return (
    <div>
      {header}
      <UsageCards T={T} data={data} pct={pct}/>
      <TemplateList T={T} data={data} onToggle={toggle} busy={busy} isOwner={isOwner}/>
      <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 14, lineHeight: 1.5 }}>
        Los mensajes salen del número de Recurrentes con el nombre de tu tienda, solo a clientes que dejaron su teléfono. Quien responde <strong style={{ color: T.textMd }}>BAJA</strong> deja de recibirlos. Si un cliente escribe, le contestamos solos que te escriba a tu mail de atención.
        {data.sender === "own" && <> Estás usando <strong style={{ color: T.textMd }}>tu propio número</strong>: Meta te cobra a vos directo y acá no se suma nada.</>}
      </div>
    </div>
  );
}

// ── Gasto: este mes grande, los anteriores chicos ────────────────────────────
function UsageCards({ T, data, pct }) {
  const u = data.usage || {};
  const prev = (data.months || []).slice(1);
  const own = data.sender === "own";
  const card = { background: T.card, border: `1px solid ${T.border}`, borderRadius: 14, padding: "14px 16px", minWidth: 0 };
  const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: T.textSm };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10, marginBottom: 18 }}>
      <div style={{ ...card, borderColor: T.accentSolid + "66" }}>
        <div style={lbl}>Este mes · {mesLabel(u.month)}</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: T.text, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{own ? "US$ 0" : fmtUsd(u.wa_cost_usd)}</div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 2 }}>{fmtN(u.wa_sent)} mensaje{u.wa_sent === 1 ? "" : "s"}{u.wa_alerts_sent ? ` · ${fmtN(u.wa_alerts_sent)} son avisos a vos` : ""}</div>
      </div>
      <div style={card}>
        <div style={lbl}>Precio por mensaje</div>
        <div style={{ fontSize: 26, fontWeight: 900, color: T.text, letterSpacing: -0.5, fontVariantNumeric: "tabular-nums", marginTop: 4 }}>{own ? "US$ 0" : fmtUsd(data.charge_usd)}</div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 2 }}>{own ? "Tu número: Meta te cobra a vos" : `Meta ${fmtUsd(data.price_usd)} + ${pct}% · se suma a tu plan a fin de mes`}</div>
      </div>
      <div style={card}>
        <div style={lbl}>Meses anteriores</div>
        {prev.length === 0 ? <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 6 }}>—</div> : prev.map(m => (
          <div key={m.month} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: DS.font.sm, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: T.textMd }}>{mesLabel(m.month)} · {fmtN(m.wa_sent)} msj</span>
            <strong style={{ color: T.text }}>{own ? "US$ 0" : fmtUsd(m.wa_cost_usd)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Las 4 plantillas con su interruptor y su texto tal cual sale ─────────────
function TemplateList({ T, data, onToggle, busy, disabled = false, isOwner = true }) {
  const [open, setOpen] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {(data.templates || []).map(t => {
        const on = t.active && !disabled;
        const isOpen = open === t.name;
        return (
          <div key={t.name} style={{ background: T.card, border: `1px solid ${on ? WA_GREEN + "88" : T.border}`, borderRadius: 14, padding: "12px 14px", opacity: disabled ? 0.75 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: WA_GREEN + "1f", color: WA_GREEN, display: "grid", placeItems: "center", flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.4 8.4 0 01-8.5 8.4 8.4 8.4 0 01-4-1L3 21l2.1-5.4A8.4 8.4 0 1121 11.5z"/></svg>
              </span>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: DS.font.base, fontWeight: 800, color: T.text }}>{t.title}</div>
                <div style={{ fontSize: DS.font.sm, color: T.textSm }}>Se manda {(WHEN[t.trigger] || (() => "automáticamente"))(t.days_before)}.{t.sent ? ` · ${fmtN(t.sent)} enviado${t.sent === 1 ? "" : "s"}` : ""}</div>
              </div>
              <button type="button" onClick={() => setOpen(isOpen ? null : t.name)} style={{ fontSize: 12, padding: "6px 10px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMd, cursor: "pointer", fontFamily: F, fontWeight: 600 }}>
                {isOpen ? "Ocultar texto" : "Ver texto"}
              </button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                {on && <DSBadge T={T} color={WA_GREEN} size="sm">Prendido</DSBadge>}
                {busy === t.name ? <Spinner size={12} color={T.textMd}/> : null}
                <span title={!isOwner ? "Solo el dueño de la tienda" : disabled ? "Prendé WhatsApp en Integraciones" : (on ? "Apagar" : "Prender")} style={{ opacity: !isOwner ? 0.5 : 1 }}>
                  <DSToggle T={T} active={on} onToggle={() => onToggle?.(t)}/>
                </span>
              </span>
            </div>
            {isOpen && (
              <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-start" }}>
                <div style={{ maxWidth: 420, background: T.isDark ? "#0b141a" : "#e7f6ea", border: `1px solid ${T.border}`, borderRadius: 12, padding: "10px 12px", fontSize: 13, lineHeight: 1.45, color: T.isDark ? "#e9edef" : "#111", whiteSpace: "pre-wrap", fontFamily: F }}>
                  {t.preview}
                  {t.footer && <div style={{ marginTop: 8, fontSize: 11, color: T.textSm }}>{t.footer}</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: DS.font.xs, color: T.textSm, padding: "0 2px" }}>Los textos los define Recurrentes y los aprueba Meta: no se pueden editar. "Ana" y los montos son un ejemplo; a cada cliente le llegan sus datos.</div>
    </div>
  );
}
