// Afiliados — Recurrentes → Afiliados. Portado de Growith (AppReferidos).
// Cada cuenta comparte su link; gana el 15% de cada pago del plan de sus
// referidos, para siempre, como crédito que descuenta sus propias facturas de
// Recurrentes (saldo en Stripe). Solo el dueño de la cuenta.
import React, { useEffect, useState } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { PageHeader, Callout, Btn, Loading, DSBadge, toast } from "../ui/components.jsx";
import { KpiCard, Panel } from "../ui/charts.jsx";

const F = "'Inter',system-ui,sans-serif";
const usd = (n) => `US$ ${(Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fecha = (iso) => { try { return new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" }); } catch (_) { return "—"; } };

export default function ReferralsPage({ merchant }) {
  const T = useT();
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const isOwner = !merchant?.role || merchant.role === "owner";
  useEffect(() => {
    if (!isOwner) return;
    apiGet("merchant", { action: "ref-me" }).then(d => { if (d?.error) setErr(d.error); else setData(d); }).catch(e => setErr(e.message));
  }, [isOwner]);

  const header = <PageHeader T={T} title="Afiliados" subtitle="Compartí tu link y ganá el 15% de cada pago del plan de las tiendas que traigas, para siempre. Se descuenta de tus propias facturas de Recurrentes."/>;
  if (!isOwner) return <div>{header}<Callout T={T} tone="info">Afiliados es del dueño de la cuenta.</Callout></div>;
  if (err) return <div>{header}<Callout T={T} tone="danger" title="No pudimos cargar tus afiliados">{err}</Callout></div>;
  if (!data) return <div>{header}<Loading T={T}/></div>;

  const copy = async () => { try { await navigator.clipboard.writeText(data.link); toast("Link copiado", "success"); } catch (_) { toast("No se pudo copiar; seleccionalo y copialo a mano", "warning"); } };
  const share = `https://wa.me/?text=${encodeURIComponent(`Mirá Recurrentes: suscripciones con cobro automático en Mercado Pago para tu tienda. Registrate con mi link: ${data.link}`)}`;

  return (
    <div style={{ fontFamily: F }}>
      {header}

      {/* El link, grande y a mano */}
      <div style={{ background: `linear-gradient(135deg, ${T.accentSolid}22, ${T.card})`, border: `1px solid ${T.accentSolid}55`, borderRadius: 18, padding: "22px 22px 20px", marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase", color: T.accent, marginBottom: 8 }}>Tu link de afiliado</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ flex: "1 1 320px", minWidth: 0, fontSize: 15, fontWeight: 700, color: T.text, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 10, padding: "10px 12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "ui-monospace, Menlo, monospace" }}>{data.link}</code>
          <Btn T={T} variant="solid" onClick={copy}>Copiar link</Btn>
          <Btn T={T} variant="secondary" onClick={() => window.open(share, "_blank", "noopener")}>Compartir por WhatsApp</Btn>
        </div>
        <div style={{ fontSize: DS.font.sm, color: T.textSm, marginTop: 10, lineHeight: 1.55 }}>
          Quien se registra desde tu link queda vinculado a tu cuenta. Cada vez que paga su plan (el primero y cada renovación), vos ganás el <strong style={{ color: T.text }}>{data.pct}%</strong> en crédito. Tu código: <strong style={{ color: T.text }}>{data.code}</strong>.
        </div>
      </div>

      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10, marginBottom: 14 }}>
        <KpiCard T={T} label="Ganado en total" value={usd(data.earned_usd)} color={T.accentSolid} valueColor={T.accent} hint="15% de cada pago de tus referidos"/>
        <KpiCard T={T} label="Crédito por aplicar" value={usd(data.pending_usd)} color={T.yellow} hint={data.has_stripe_customer ? "se descuenta en tu próxima factura" : "se aplica cuando actives tu plan"}/>
        <KpiCard T={T} label="Ya descontado" value={usd(data.applied_usd)} color={T.green} hint="aplicado a tus facturas de Recurrentes"/>
        <KpiCard T={T} label="Referidos" value={`${data.activos} pagan`} color={T.blue} hint={`${data.referidos.length} registrados con tu link`}/>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 12 }}>
        <Panel T={T} title="Tus referidos" sub="Tiendas que se registraron con tu link." flush>
          {data.referidos.length === 0 ? (
            <div style={{ fontSize: DS.font.sm, color: T.textSm, padding: "22px 16px", textAlign: "center" }}>Todavía no tenés referidos. Compartí tu link y empezá a sumar.</div>
          ) : data.referidos.map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: `1px solid ${T.borderL}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: DS.font.sm, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.store}</div>
                <div style={{ fontSize: DS.font.xs, color: T.textSm }}>{r.email_masked} · desde {fecha(r.since)}</div>
              </div>
              {r.paga ? <DSBadge T={T} color={T.green} size="sm">Paga · {r.plan}</DSBadge> : <DSBadge T={T} color={T.textSm} size="sm">Plan gratis</DSBadge>}
            </div>
          ))}
        </Panel>
        <Panel T={T} title="Movimientos" sub="Comisiones ganadas y crédito aplicado a tus facturas." flush>
          {data.ledger.length === 0 ? (
            <div style={{ fontSize: DS.font.sm, color: T.textSm, padding: "22px 16px", textAlign: "center" }}>Sin movimientos todavía.</div>
          ) : data.ledger.map((l, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", borderTop: `1px solid ${T.borderL}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: DS.font.sm, fontWeight: 700, color: T.text }}>{l.type === "commission" ? `Comisión por ${l.from_store || "un referido"}${l.tier ? ` (${l.tier})` : ""}` : "Crédito aplicado a tus facturas"}</div>
                <div style={{ fontSize: DS.font.xs, color: T.textSm }}>{fecha(l.at)}{l.kind === "renovacion" ? " · renovación" : l.kind === "primer_pago" ? " · primer pago" : ""}</div>
              </div>
              <div style={{ fontSize: DS.font.sm, fontWeight: 800, color: l.usd >= 0 ? T.green : T.textMd, fontVariantNumeric: "tabular-nums" }}>{l.usd >= 0 ? "+" : ""}{usd(l.usd)}</div>
            </div>
          ))}
        </Panel>
      </div>
      <div style={{ fontSize: DS.font.xs, color: T.textSm, marginTop: 12, lineHeight: 1.5 }}>El crédito se calcula sobre el precio de lista en dólares del plan que paga tu referido y se aplica como saldo en tu cuenta de Recurrentes: descuenta tus próximas facturas, renovaciones incluidas. No se retira en efectivo.</div>
    </div>
  );
}
