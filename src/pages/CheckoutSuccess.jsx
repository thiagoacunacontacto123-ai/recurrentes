import React, { useEffect, useState, useRef } from "react";

// Página que ve el cliente final cuando vuelve del checkout de MP (toca
// "Volver al sitio del vendedor"). MP redirige acá con ?sub=<id>&token=<jwt>.
//
// Diseño: el ÚNICO trigger que crea la orden Shopify es el webhook MP. Esta
// página NO dispara sync — solo consulta el estado del subscriber en Firestore
// (que ya fue actualizado por el webhook si MP confirmó el pago).
//
// Si el webhook ya procesó: redirigimos al cliente a la Thank You page de
// Shopify. Si todavía no llegó (ms de delay): mostramos confirmación con link
// al portal — el cliente ya tiene certeza de que su sub está OK, y la orden
// Shopify llegará en segundos (la verá en su email cuando despachemos).
export default function CheckoutSuccess() {
  const [subId, setSubId] = useState(null);
  const [portalToken, setPortalToken] = useState(null);
  const [stage, setStage] = useState("waiting"); // waiting | redirecting | done
  const [secs, setSecs] = useState(0);
  const pollRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    // MP redirige al back_url con query params en la URL "normal" (no hash):
    //   ?collection_id=<payment_id>&collection_status=approved&preference_id=...
    // ADEMÁS, nosotros le pasamos a MP el back_url con sub y token en hash:
    //   /#/checkout-success?sub=X&token=Y
    // Al volver, ambos params coexisten. Leemos ambos sources.
    const hashQ = window.location.hash.split("?")[1] || "";
    const searchQ = window.location.search.slice(1);
    const hashParams = new URLSearchParams(hashQ);
    const searchParams = new URLSearchParams(searchQ);
    const sid = hashParams.get("sub") || searchParams.get("sub");
    const tkn = hashParams.get("token") || searchParams.get("token");
    // collection_id = payment_id en MP — viene directo, sin necesidad de search
    const mpPaymentId = searchParams.get("collection_id") || hashParams.get("collection_id");
    const mpStatus = searchParams.get("collection_status") || hashParams.get("collection_status");
    setSubId(sid);
    setPortalToken(tkn);

    if (!tkn) {
      setStage("done");
      return;
    }

    // Polling activo: cada 2s dispara un sync con MP (a través del endpoint
    // público autenticado con portal token) — busca el preapproval, procesa
    // pagos aprobados, crea la orden Shopify. Después de cada sync, consulta
    // el estado y si tenemos shopify_order_status_url, redirige al cliente.
    // Esto es el camino "rápido" — el cron diario es solo fallback final.
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // 60 × 2s = 120s (2 min)

    async function poll() {
      attempts += 1;
      try {
        // 1) Disparar sync — pasamos hint del payment_id si MP nos lo dio en
        //    la URL via ?collection_id. Eso le permite al sync hacer GET
        //    directo a /v1/payments/{id} sin buscar (más rápido + confiable).
        if (sid) {
          let url = `/api/checkout/init?sub=${encodeURIComponent(sid)}&token=${encodeURIComponent(tkn)}`;
          if (mpPaymentId && mpStatus === "approved") {
            url += `&payment_id=${encodeURIComponent(mpPaymentId)}`;
          }
          await fetch(url).catch(()=>{});
        }
        // 2) Verificar estado actualizado
        const r = await fetch(`/api/public?action=sub&token=${encodeURIComponent(tkn)}`);
        const d = await r.json();
        if (d?.sub?.shopify_order_status_url) {
          setStage("redirecting");
          setTimeout(() => { window.location.replace(d.sub.shopify_order_status_url); }, 600);
          return;
        }
      } catch (_) {}
      if (attempts >= MAX_ATTEMPTS) {
        setStage("done");
        return;
      }
      pollRef.current = setTimeout(poll, 2000);
    }

    pollRef.current = setTimeout(poll, 1000);
    tickRef.current = setInterval(() => setSecs(s => s + 1), 1000);

    return () => {
      clearTimeout(pollRef.current);
      clearInterval(tickRef.current);
    };
  }, []);

  if (stage === "waiting") {
    return (
      <Container>
        <Spinner/>
        <h1 style={H1}>Procesando tu suscripción…</h1>
        <p style={P}>
          Estamos confirmando tu pago con Mercado Pago. En unos segundos te llevamos a tu pedido.
        </p>
        <div style={{fontSize:11,color:"var(--text-sm)",marginTop:18,opacity:0.7}}>{secs}s</div>
      </Container>
    );
  }
  if (stage === "redirecting") {
    return (
      <Container>
        <CheckIcon/>
        <h1 style={H1}>¡Listo!</h1>
        <p style={P}>Te llevamos a tu pedido en la tienda…</p>
      </Container>
    );
  }
  // stage === "done" — webhook tardó más de 24s, mostramos confirmación
  return (
    <Container>
      <CheckIcon/>
      <h1 style={H1}>¡Suscripción activa!</h1>
      <p style={P}>
        Recibimos la confirmación de tu pago. Vas a recibir un email con los datos de tu suscripción y tu primer envío en breve.
      </p>
      {subId && (
        <div style={{padding:"14px 16px",background:"var(--surface)",borderRadius:10,fontSize:12,color:"var(--text-sm)",marginBottom:18,fontFamily:"'Cascadia Code',monospace"}}>
          ID de suscripción:<br/>
          <span style={{color:"var(--accent)",fontWeight:700,wordBreak:"break-all"}}>{subId}</span>
        </div>
      )}
      {portalToken && (
        <a href={`/#/portal?token=${portalToken}`} style={{display:"block",background:"linear-gradient(135deg, var(--green), var(--green-dark))",border:"none",color:"#fff",padding:"12px",borderRadius:10,fontSize:14,fontWeight:700,textDecoration:"none",boxShadow:"0 4px 12px rgba(16,185,129,0.3)"}}>
          Gestionar mi suscripción →
        </a>
      )}
      <div style={{fontSize:11,color:"var(--text-sm)",marginTop:18,lineHeight:1.55}}>
        Si tenés dudas o querés pausar/cancelar, podés hacerlo desde el link de "Gestionar mi suscripción" que también te llega por email.
      </div>
    </Container>
  );
}

function Container({ children }) {
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(180deg, var(--bg) 0%, #0d1311 100%)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{maxWidth:520,width:"100%",background:"var(--card)",border:"1px solid rgba(16,185,129,0.4)",borderRadius:16,padding:"40px 36px",textAlign:"center"}}>
        {children}
      </div>
    </div>
  );
}
function Spinner() {
  return (
    <>
      <div style={{width:60,height:60,margin:"0 auto 18px",border:"4px solid rgba(16,185,129,0.2)",borderTopColor:"var(--accent)",borderRadius:"50%",animation:"rec-spin-success 0.9s linear infinite"}}/>
      <style>{`@keyframes rec-spin-success{to{transform:rotate(360deg);}}`}</style>
    </>
  );
}
function CheckIcon() {
  return (
    <div style={{width:72,height:72,borderRadius:"50%",background:"linear-gradient(135deg, var(--green), var(--green-dark))",margin:"0 auto 18px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:38,boxShadow:"0 6px 20px rgba(16,185,129,0.3)",color:"#fff"}}>
      ✓
    </div>
  );
}
const H1 = { fontSize:26,fontWeight:800,margin:"0 0 10px",letterSpacing:-0.5 };
const P  = { fontSize:14,color:"var(--text-md)",lineHeight:1.6,margin:"0 0 26px" };
