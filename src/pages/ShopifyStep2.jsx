import React, { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Modal, Btn, Callout, toast } from "../ui/components.jsx";
import { widgetSnippet } from "./WidgetDesigner.jsx";
import { writeFlag, widgetKey } from "../lib/onboarding.js";

// ─── Paso 2 de 2 después de conectar Shopify ──────────────────────
// No soltamos al comerciante en Integraciones con la tienda conectada "a medias":
// acá pega el snippet y esperamos a que widget.js avise que cargó en su tienda
// (beacon → merchant.widget_last_seen_at). Recién con el tilde verde sigue.
const B = ({ T, children }) => <b style={{ color: T.text }}>{children}</b>;

function CopyLine({ T, text }) {
  const [ok, setOk] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1600); }
    catch (_) { toast("No se pudo copiar. Seleccioná el texto y copialo a mano.", "warning"); }
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
      <code style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.text, whiteSpace: "pre-wrap", wordBreak: "break-all", lineHeight: 1.5 }}>{text}</code>
      <Btn T={T} variant={ok ? "success" : "solid"} onClick={copy} style={{ flexShrink: 0 }}>{ok ? "Copiado ✓" : "Copiar"}</Btn>
    </div>
  );
}

export default function StoreStep2Modal({ merchant, channel = "shopify", onDone }) {
  const T = useT();
  const m = merchant || {};
  const tn = channel === "tiendanube";
  const snippet = widgetSnippet(m);
  // Vale cualquier carga del widget en la última hora (reconectar la tienda no lo invalida).
  const openedAt = useRef(new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const niceHost = (h) => !h ? "tu tienda" : /shopifypreview\.com$/.test(h) ? "la vista previa de tu tema" : h;
  // Si el widget ya se vio en la última hora (el merchant ya lo trae), arrancamos en verde.
  const [seen, setSeen] = useState(() => {
    const at = m.widget_last_seen_at || "";
    return at && Date.now() - Date.parse(at) < 60 * 60 * 1000 ? { at, host: m.widget_last_seen_host || "" } : null;
  });
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(0);      // intentos de "Ya lo hice" sin ver el widget

  // Nada automático: el comerciante toca "Ya lo hice" y ahí revisamos (unos 12 s,
  // por si el beacon del widget todavía está viajando).
  async function verify() {
    setChecking(true);
    try {
      for (let i = 0; i < 4; i++) {
        const r = await apiGet("merchant");
        const d = r?.merchant || r || {};   // GET /api/merchant responde { merchant: {...} }
        const at = d.widget_last_seen_at || "";
        if (at && at > openedAt.current) { setSeen({ at, host: d.widget_last_seen_host || "" }); return; }
        if (i < 3) await new Promise(r => setTimeout(r, 3000));
      }
      setFailed(f => f + 1);
    } catch (_) { setFailed(f => f + 1); }
    finally { setChecking(false); }
  }

  useEffect(() => {
    const at = m.widget_last_seen_at || "";
    if (!seen && at && Date.now() - Date.parse(at) < 60 * 60 * 1000) setSeen({ at, host: m.widget_last_seen_host || "" });
  }, [m.widget_last_seen_at, m.widget_last_seen_host, seen]);
  useEffect(() => { if (seen) { writeFlag(widgetKey(m.id), true); toast("¡El widget ya carga en tu tienda!", "success"); } }, [seen, m.id]);

  const step = { display: "flex", gap: 10, alignItems: "flex-start", fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6 };
  const num = (n) => <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.accentSolid + "1a", color: T.accent, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>{n}</span>;

  return (
    <Modal T={T} open onClose={() => toast(tn ? "Terminá este paso para seguir: así sabés cómo aparece la suscripción en tu tienda." : "Terminá este paso para seguir: sin el widget en la tienda, la suscripción no se ve.", "warning", 4000)}
      width={860} title={tn ? "Tiendanube conectada ✓ · Paso 2 de 2: así aparece la suscripción en tu tienda" : "Shopify conectado ✓ · Paso 2 de 2: poné el widget en tu tienda"}
      subtitle={tn ? "No hay que pegar ningún código. Leé cómo funciona, abrí un producto de tu tienda y tocá “Ya lo hice”." : "Una sola línea en theme.liquid, una sola vez para toda la tienda. Cuando la pegues y guardes, tocá “Ya lo hice”."}
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!seen && failed >= 2
            ? <button type="button" onClick={() => { toast("Quedó pendiente: lo verificamos cuando abras un producto de tu tienda.", "info", 5000); onDone(); }} style={{ background: "transparent", border: "none", color: T.textSm, fontSize: DS.font.sm, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Lo verifico más tarde</button>
            : <span style={{ fontSize: DS.font.sm, color: T.textSm }}>{seen ? "Todo listo." : "Cuando termines los 3 pasos, tocá “Ya lo hice”."}</span>}
          <div style={{ display: "flex", gap: 8 }}>
            {!seen && <Btn T={T} variant="solid" disabled={checking} onClick={verify}>{checking ? "Revisando tu tienda…" : "Ya lo hice ✓"}</Btn>}
            <Btn T={T} variant={seen ? "solid" : "secondary"} disabled={!seen} onClick={onDone}>Terminar → crear mi primer plan</Btn>
          </div>
        </div>
      }>
      <div style={{ display: "grid", gap: 14 }}>
        {tn ? (<>
          <div style={step}>{num(1)}<div><B T={T}>No hay que pegar ningún código.</B> Tiendanube ya carga el widget de Recurrentes en tu tienda. Aparece solo en los productos que tengan un <B T={T}>plan activo</B>; en el resto no se ve nada.</div></div>
          <div style={step}>{num(2)}<div>Después de este paso vas a <B T={T}>crear tu primer plan</B>: elegís el producto, cada cuántos días se cobra, el descuento y los packs (x1, x2, x3).</div></div>
          <div style={step}>{num(3)}<div>En la página de ese producto el cliente ve la caja <B T={T}>Suscripción / Compra única</B>. La suscripción va al checkout de Recurrentes y paga con Mercado Pago; la compra única agrega al carrito como siempre.</div></div>
          <div style={step}>{num(4)}<div>Para comprobar ahora que tu tienda ya habla con Recurrentes: <B T={T}>abrí cualquier producto de tu tienda</B> en otra pestaña y tocá “Ya lo hice”. No hace falta tener un plan todavía.</div></div>
          <Callout T={T} tone="info" title="Plan B sin JavaScript">
            Si algún tema no carga scripts, en <B T={T}>Planes → Poner en la tienda</B> escribimos la misma caja como HTML al final de la descripción del producto. Tu descripción no se toca y se saca con un clic.
          </Callout>
        </>) : (<>
          <div style={step}>{num(1)}<div>Copiá tu snippet:<div style={{ marginTop: 8 }}><CopyLine T={T} text={snippet}/></div></div></div>
          <div style={step}>{num(2)}<div>En Shopify: <B T={T}>Tienda online → Temas</B>. En tu tema activo tocá los <B T={T}>tres puntos (⋯) → Editar código</B>.</div></div>
          <div style={step}>{num(3)}<div>En la carpeta <B T={T}>Layout</B> abrí <B T={T}>theme.liquid</B>. Buscá <code style={{ fontFamily: "ui-monospace, Menlo, monospace", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: "1px 5px", color: T.text }}>&lt;/body&gt;</code> (Cmd/Ctrl + F), pegá la línea <B T={T}>justo arriba</B> y tocá <B T={T}>Guardar</B>. Una sola vez: vale para todos los productos, ahora y los que agregues después.</div></div>

        </>)}

        {seen ? (
          <Callout T={T} tone="success" title="¡El widget ya carga en tu tienda!">
            Lo vimos en <B T={T}>{niceHost(seen.host)}</B> hace un momento. Ya podés crear tu primer plan: la caja de suscripción va a aparecer sola en los productos que tengan plan activo.
          </Callout>
        ) : checking ? (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, border: `2px solid ${T.border}`, borderTopColor: T.accent, borderRadius: "50%", flexShrink: 0, animation: "rc-step2-spin .8s linear infinite" }}/>
            <div style={{ fontSize: DS.font.sm, color: T.textMd }}><b style={{ color: T.text }}>Revisando tu tienda…</b> Buscamos el aviso del widget, tarda unos segundos.</div>
            <style>{`@keyframes rc-step2-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : failed > 0 ? (
          <Callout T={T} tone="warning" title="Todavía no vimos el widget en tu tienda">
            {tn
              ? <>Fijate que la app <B T={T}>Recurrentes</B> figure instalada en tu Tiendanube (Mi Tiendanube → Aplicaciones). Después <B T={T}>abrí un producto</B> de tu tienda en otra pestaña, recargalo sin caché (Cmd/Ctrl + Shift + R) y volvé a tocar “Ya lo hice”. Si sigue sin aparecer, escribinos y lo vemos juntos.</>
              : <>Fijate que hayas tocado <B T={T}>Guardar</B> en el editor de código y que la línea esté en <B T={T}>theme.liquid del tema activo</B> (si tenés varios temas, el que dice “Tema actual”). Después <B T={T}>abrí un producto</B> en otra pestaña, recargalo sin caché (Cmd/Ctrl + Shift + R) y volvé a tocar “Ya lo hice”.</>}
          </Callout>
        ) : null}
      </div>
    </Modal>
  );
}
