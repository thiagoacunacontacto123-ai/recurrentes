import React, { useEffect, useState } from "react";

// Página de GRACIAS que ve el cliente final al volver del checkout de MP.
// MP redirige acá (back_url) con ?sub=<id>&token=<jwt>.
//
// CLAVE: MP solo redirige DESPUÉS de que el pago fue aprobado. O sea, llegar
// a esta página ya significa "pagado". Por eso mostramos la confirmación
// LINDA al instante — nada de pantalla de "procesando".
//
// La orden Shopify se crea server-side (webhook MP). Igual, como respaldo,
// disparamos un sync SILENCIOSO en segundo plano (por si el webhook tarda o
// no está configurado) — pero el cliente NUNCA ve un spinner: ve su gracias.
export default function CheckoutSuccess() {
  const [portalToken, setPortalToken] = useState(null);
  const [info, setInfo] = useState(null); // { product_title, frequency_days, next_charge_at }

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
    if (!tkn) return;

    let cancelled = false;

    // Respaldo del webhook: dispara el sync unas cuantas veces en silencio para
    // asegurar que la orden Shopify se cree, aunque el webhook MP no esté. No
    // bloquea NADA de la UI — el cliente ya ve su página de gracias.
    async function backgroundSync() {
      for (let i = 0; i < 8 && !cancelled; i++) {
        try {
          if (sid) {
            let url = `/api/checkout/init?sub=${encodeURIComponent(sid)}&token=${encodeURIComponent(tkn)}`;
            if (mpPaymentId && mpStatus === "approved") url += `&payment_id=${encodeURIComponent(mpPaymentId)}`;
            await fetch(url).catch(() => {});
          }
          const r = await fetch(`/api/public?action=sub&token=${encodeURIComponent(tkn)}`);
          const d = await r.json().catch(() => null);
          if (d?.sub && !cancelled) {
            setInfo({
              product_title: d.sub.plan_snapshot?.product_title || d.sub.product_title,
              frequency_days: d.sub.plan_snapshot?.frequency_days,
              next_charge_at: d.sub.next_charge_at,
            });
            if (d.sub.shopify_order_status_url) return; // orden ya creada, listo
          }
        } catch (_) {}
        await new Promise((res) => setTimeout(res, 2500));
      }
    }
    backgroundSync();
    return () => { cancelled = true; };
  }, []);

  const freqTxt = (() => {
    const d = info?.frequency_days;
    if (!d) return null;
    if (d === 30) return "cada mes";
    if (d === 60) return "cada 2 meses";
    if (d === 90) return "cada 3 meses";
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

  return (
    <div style={S.page}>
      <style>{CSS}</style>
      <div style={S.card} className="tk-card">
        <div style={S.checkWrap}>
          <div style={S.check} className="tk-check">
            <svg viewBox="0 0 52 52" width="46" height="46" aria-hidden="true">
              <path className="tk-check-path" fill="none" stroke="#fff" strokeWidth="5"
                    strokeLinecap="round" strokeLinejoin="round" d="M14 27l8 8 16-18"/>
            </svg>
          </div>
        </div>

        <h1 style={S.h1}>¡Gracias por tu suscripción!</h1>
        <p style={S.sub}>Tu pago fue confirmado. Ya estás suscripto y no tenés que hacer nada más. 💜</p>

        {(info?.product_title || freqTxt) && (
          <div style={S.detail}>
            {info?.product_title && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>Producto</span>
                <b style={S.detailVal}>{info.product_title}</b>
              </div>
            )}
            {freqTxt && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>Se renueva</span>
                <b style={S.detailVal}>{freqTxt}</b>
              </div>
            )}
            {nextTxt && (
              <div style={S.detailRow}>
                <span style={S.detailLabel}>Próximo envío</span>
                <b style={S.detailVal}>{nextTxt}</b>
              </div>
            )}
          </div>
        )}

        <div style={S.mailNote}>
          📩 En <b>2 a 10 minutos</b> te va a llegar el email con la confirmación de tu compra.
        </div>

        <div style={S.steps}>
          <Step icon="📦" text="Preparamos tu envío y te avisamos por email cuando salga en camino." />
          <Step icon="🔁" text="Se renueva automáticamente. Cancelás cuando quieras." />
        </div>

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
  foot: { fontSize: 12, color: "#95a29c", lineHeight: 1.5, margin: "16px 0 0" },
};
