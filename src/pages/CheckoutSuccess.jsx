import React, { useEffect, useState } from "react";

// Página de GRACIAS que ve el cliente final al volver del checkout de MP.
// MP redirige acá (back_url) con ?sub=<id>&token=<jwt>.
//
// Tres estados, NUNCA decimos "pago confirmado" antes de tener la orden / el cobro registrado:
//   confirming → "Confirmando tu pago con Mercado Pago…" (polling al sync).
//   active     → "¡Listo! Tu suscripción está activa" (llegó la orden o el cobro sin tienda).
//   pending    → tras el timeout: "Tu pago está en proceso. Te avisamos por mail…"
// Los textos se adaptan al negocio (public?action=sub → business): con envío hablamos
// de envíos; en servicios, de cuotas. "Volver a la tienda" solo si hay tienda.
const POLL_MS = 3000;
const MAX_POLLS = 60; // ~3 min: el primer cobro de MP se procesa async (~60s)

export default function CheckoutSuccess() {
  const [portalToken, setPortalToken] = useState(null);
  const [phase, setPhase] = useState("confirming"); // confirming | active | pending
  const [storeUrl, setStoreUrl] = useState(null);
  const [info, setInfo] = useState(null); // { product_title, frequency_days, next_charge_at }
  const [biz, setBiz] = useState(null);   // { type, channel, shipping, provider_label, vocab }

  useEffect(() => {
    const hashQ = window.location.hash.split("?")[1] || "";
    const searchQ = window.location.search.slice(1);
    const hashParams = new URLSearchParams(hashQ);
    const searchParams = new URLSearchParams(searchQ);
    const sid = hashParams.get("sub") || searchParams.get("sub");
    const tkn = hashParams.get("token") || searchParams.get("token");
    const mpPaymentId = searchParams.get("collection_id") || hashParams.get("collection_id");
    const mpStatus = searchParams.get("collection_status") || hashParams.get("collection_status");
    setPortalToken(tkn);
    if (!tkn) { setPhase("pending"); return; }

    let cancelled = false;

    // Polling al sync (respaldo del webhook) hasta que aparezca la orden / el cobro.
    async function poll() {
      for (let i = 0; i < MAX_POLLS && !cancelled; i++) {
        try {
          if (sid) {
            let url = `/api/checkout/init?sub=${encodeURIComponent(sid)}&token=${encodeURIComponent(tkn)}`;
            if (mpPaymentId && mpStatus === "approved") url += `&payment_id=${encodeURIComponent(mpPaymentId)}`;
            const sr = await fetch(url).catch(() => null);
            const sd = sr ? await sr.json().catch(() => null) : null;
            if (sd?.merchant_store_url && !cancelled) setStoreUrl(sd.merchant_store_url);
          }
          const r = await fetch(`/api/public?action=sub&token=${encodeURIComponent(tkn)}`);
          const d = await r.json().catch(() => null);
          if (d?.sub && !cancelled) {
            if (d.merchant_store_url) setStoreUrl(d.merchant_store_url);
            if (d.business) setBiz(d.business);
            setInfo({
              product_title: d.sub.plan_snapshot?.product_title || d.sub.product_title,
              frequency_days: d.sub.plan_snapshot?.frequency_days,
              next_charge_at: d.sub.next_charge_at,
            });
            const hasOrder = !!d.sub.shopify_order_status_url || (d.sub.shopify_orders_count || 0) > 0;
            if (hasOrder && (d.sub.status === "active" || d.sub.shopify_order_status_url)) { setPhase("active"); return; }
          }
        } catch (_) {}
        await new Promise((res) => setTimeout(res, POLL_MS));
      }
      if (!cancelled) setPhase((p) => (p === "active" ? p : "pending"));
    }
    poll();
    return () => { cancelled = true; };
  }, []);

  const freqTxt = (() => {
    const d = info?.frequency_days;
    if (!d) return null;
    if (d === 7) return "cada semana";
    if (d === 30) return "cada mes";
    if (d === 60) return "cada 2 meses";
    if (d === 90) return "cada 3 meses";
    if (d === 365) return "cada año";
    if (d % 30 === 0) return `cada ${d / 30} meses`;
    return `cada ${d} días`;
  })();

  const nextTxt = (() => {
    if (!info?.next_charge_at) return null;
    try {
      const dt = new Date(info.next_charge_at);
      return dt.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
    } catch (_) { return null; }
  })();

  const portalUrl = portalToken ? `#/portal?token=${encodeURIComponent(portalToken)}` : null;
  // Sin datos del negocio todavía → textos históricos (físico con envío).
  const shipping = biz ? biz.shipping !== false : true;
  const isService = biz?.type === "service";
  const provider = biz?.provider_label || "Mercado Pago";
  const kind = isService ? "membresía" : "suscripción";

  const copy = {
    confirming: {
      h1: `Confirmando tu pago con ${provider}…`,
      sub: "Esto puede tardar un minuto. No cierres esta página ni vuelvas a pagar.",
    },
    active: {
      h1: `¡Listo! Tu ${kind} está activa`,
      sub: "Ya está todo en marcha. No tenés que hacer nada más. 💜",
    },
    pending: {
      h1: "Tu pago está en proceso",
      sub: "Te avisamos por mail apenas se confirme; no hace falta que hagas nada.",
    },
  }[phase];

  const steps = shipping
    ? [
        { icon: "📦", text: "Preparamos tu envío y te avisamos por email cuando salga en camino." },
        { icon: "🔁", text: "Se renueva automáticamente. Cancelás cuando quieras." },
      ]
    : [
        { icon: "🔁", text: `La ${kind} se cobra sola ${freqTxt || "cada período"}. Pausás o cancelás cuando quieras.` },
        { icon: "💳", text: "Si algún cobro falla, te avisamos por mail para que actualices la tarjeta." },
      ];

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <div style={S.card} className="tk-card">
        <div style={S.checkWrap}>
          {phase === "active" ? (
            <div style={S.check} className="tk-check">
              <svg viewBox="0 0 52 52" width="46" height="46" aria-hidden="true">
                <path className="tk-check-path" fill="none" stroke="#fff" strokeWidth="5"
                      strokeLinecap="round" strokeLinejoin="round" d="M14 27l8 8 16-18"/>
              </svg>
            </div>
          ) : phase === "confirming" ? (
            <div style={S.spinner} aria-label="Confirmando" />
          ) : (
            <div style={{ ...S.check, background: "linear-gradient(135deg,#f59e0b,#d97706)", boxShadow: "0 12px 26px -8px rgba(217,119,6,.45)" }}>
              <span style={{ fontSize: 34, lineHeight: 1 }}>⏳</span>
            </div>
          )}
        </div>

        <h1 style={S.h1}>{copy.h1}</h1>
        <p style={S.sub}>{copy.sub}</p>

        {(info?.product_title || freqTxt) && (
          <div style={S.detail}>
            {info?.product_title && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>{isService ? "Plan" : "Producto"}</span>
                <b style={S.detailVal}>{info.product_title}</b>
              </div>
            )}
            {freqTxt && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>Se renueva</span>
                <b style={S.detailVal}>{freqTxt}</b>
              </div>
            )}
            {phase === "active" && nextTxt && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>{biz?.vocab?.next || "Próximo envío"}</span>
                <b style={S.detailVal}>{nextTxt}</b>
              </div>
            )}
          </div>
        )}

        {phase === "active" && (
          <>
            <div style={S.mailNote}>
              📩 En unos minutos te llega el email con la confirmación{shipping ? " de tu compra" : ""}.
            </div>
            <div style={S.steps}>
              {steps.map((s, i) => <Step key={i} icon={s.icon} text={s.text} />)}
            </div>
          </>
        )}
        {phase === "pending" && (
          <div style={S.mailNote}>
            📩 Cuando {provider} confirme el cobro te mandamos el email de confirmación con el link para gestionar tu {kind}.
          </div>
        )}

        {storeUrl ? (
          <>
            <a href={storeUrl} style={S.btn} className="tk-btn">Volver a la tienda</a>
            {portalUrl && <a href={portalUrl} style={S.link}>Gestionar mi {kind}</a>}
          </>
        ) : portalUrl ? (
          <a href={portalUrl} style={S.btn} className="tk-btn">Gestionar mi {kind}</a>
        ) : null}

        <p style={S.foot}>Cualquier duda, respondé el email de confirmación y te ayudamos.</p>
      </div>
    </div>
  );
}

function Step({ icon, text }) {
  return (
    <div style={S.step}>
      <span style={S.stepIcon}>{icon}</span>
      <span style={S.stepText}>{text}</span>
    </div>
  );
}

const CSS = `
@keyframes tk-pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.08)} 100%{transform:scale(1);opacity:1} }
@keyframes tk-draw { to { stroke-dashoffset: 0; } }
@keyframes tk-rise { from{transform:translateY(14px);opacity:0} to{transform:translateY(0);opacity:1} }
@keyframes tk-spin { to { transform: rotate(360deg); } }
.tk-card { animation: tk-rise .5s cubic-bezier(.2,.8,.2,1) both; }
.tk-check { animation: tk-pop .5s cubic-bezier(.2,1.4,.5,1) both; }
.tk-check-path { stroke-dasharray: 60; stroke-dashoffset: 60; animation: tk-draw .5s .35s ease forwards; }
.tk-btn:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -8px rgba(20,30,25,.5); }
`;

const S = {
  page: {
    minHeight: "100vh", width: "100%",
    background: "radial-gradient(1200px 600px at 50% -10%, #eef6f1 0%, #f4f5f7 45%, #eef0f3 100%)",
    display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    boxSizing: "border-box",
  },
  card: {
    maxWidth: 460, width: "100%", background: "#fff", borderRadius: 22,
    padding: "38px 30px 28px", textAlign: "center",
    boxShadow: "0 30px 60px -24px rgba(20,40,30,.28), 0 2px 8px rgba(0,0,0,.04)",
    border: "1px solid #edf0f2", boxSizing: "border-box",
  },
  checkWrap: { display: "flex", justifyContent: "center", marginBottom: 20 },
  check: {
    width: 82, height: 82, borderRadius: "50%",
    background: "linear-gradient(135deg,#12b981,#0a8a54)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 12px 26px -8px rgba(16,150,100,.55)",
  },
  spinner: {
    width: 72, height: 72, borderRadius: "50%", boxSizing: "border-box",
    border: "6px solid #e3ede7", borderTopColor: "#12b981",
    animation: "tk-spin .9s linear infinite",
  },
  h1: { fontSize: 25, fontWeight: 800, color: "#16241d", margin: "0 0 10px", letterSpacing: "-.3px", lineHeight: 1.2 },
  sub: { fontSize: 15, color: "#5c6b64", lineHeight: 1.55, margin: "0 0 24px" },
  mailNote: { background: "#eef6f1", border: "1px solid #d5e8dd", borderRadius: 12, padding: "12px 16px", marginBottom: 22, fontSize: 13.5, color: "#2f5545", lineHeight: 1.5 },
  detail: { background: "#f7faf8", border: "1px solid #e8efeb", borderRadius: 14, padding: "6px 16px", marginBottom: 22 },
  detailRow: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #eef3f0" },
  detailLabel: { fontSize: 13, color: "#7a8983" },
  detailVal: { fontSize: 13.5, color: "#16241d", textAlign: "right" },
  steps: { textAlign: "left", display: "flex", flexDirection: "column", gap: 12, marginBottom: 26 },
  step: { display: "flex", alignItems: "flex-start", gap: 11 },
  stepIcon: { fontSize: 18, lineHeight: "22px", flexShrink: 0 },
  stepText: { fontSize: 13.5, color: "#48564f", lineHeight: 1.5 },
  btn: {
    display: "block", width: "100%", boxSizing: "border-box",
    background: "linear-gradient(135deg,#1e2a24,#0f1713)", color: "#fff",
    padding: "15px 14px", borderRadius: 13, fontSize: 15, fontWeight: 700,
    textDecoration: "none", transition: "transform .12s, box-shadow .12s",
    boxShadow: "0 6px 18px -8px rgba(20,30,25,.5)",
  },
  link: { display: "inline-block", marginTop: 14, fontSize: 13.5, color: "#0a8a54", fontWeight: 600, textDecoration: "underline" },
  foot: { fontSize: 12, color: "#95a29c", lineHeight: 1.5, margin: "16px 0 0" },
};
