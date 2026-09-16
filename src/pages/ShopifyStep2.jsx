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
      <code style={{ flex: 1, minWidth: 0, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12, background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", color: T.text, overflowX: "auto", whiteSpace: "nowrap" }}>{text}</code>
      <Btn T={T} variant={ok ? "success" : "solid"} onClick={copy} style={{ flexShrink: 0 }}>{ok ? "Copiado ✓" : "Copiar"}</Btn>
    </div>
  );
}

export default function ShopifyStep2Modal({ merchant, onDone }) {
  const T = useT();
  const m = merchant || {};
  const snippet = widgetSnippet(m);
  const openedAt = useRef(new Date().toISOString());
  const [seen, setSeen] = useState(null);     // { at, host } cuando el widget cargó después de abrir este paso
  const [elapsed, setElapsed] = useState(0);
  const [checking, setChecking] = useState(false);

  // Cada 4 s miramos si widget.js ya avisó desde la tienda.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        setChecking(true);
        const d = await apiGet("merchant");
        if (!alive) return;
        const at = d?.widget_last_seen_at || "";
        if (at && at > openedAt.current) { setSeen({ at, host: d.widget_last_seen_host || "" }); }
      } catch (_) {} finally { if (alive) setChecking(false); }
    };
    tick();
    const iv = setInterval(() => { tick(); setElapsed(e => e + 4); }, 4000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  useEffect(() => { if (seen) { writeFlag(widgetKey(m.id), true); toast("¡El widget ya carga en tu tienda!", "success"); } }, [seen, m.id]);

  const step = { display: "flex", gap: 10, alignItems: "flex-start", fontSize: DS.font.base, color: T.textMd, lineHeight: 1.6 };
  const num = (n) => <span style={{ width: 22, height: 22, borderRadius: "50%", background: T.accentSolid + "1a", color: T.accent, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>{n}</span>;

  return (
    <Modal T={T} open onClose={() => toast("Terminá este paso para seguir: sin el widget en la tienda, la suscripción no se ve.", "warning", 4000)}
      width={640} title="Shopify conectado ✓ · Paso 2 de 2: poné el widget en tu tienda"
      subtitle="Una sola línea, una sola vez. Cuando la pegues, abrí un producto de tu tienda y acá aparece el tilde verde."
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {!seen && elapsed >= 90
            ? <button type="button" onClick={() => { toast("Quedó pendiente: lo verificamos cuando abras un producto de tu tienda.", "info", 5000); onDone(); }} style={{ background: "transparent", border: "none", color: T.textSm, fontSize: DS.font.sm, cursor: "pointer", textDecoration: "underline", fontFamily: "inherit" }}>Lo verifico más tarde</button>
            : <span style={{ fontSize: DS.font.sm, color: T.textSm }}>{seen ? "Todo listo." : "El botón se habilita cuando veamos el widget en tu tienda."}</span>}
          <Btn T={T} variant="solid" disabled={!seen} onClick={onDone}>Terminar → crear mi primer plan</Btn>
        </div>
      }>
      <div style={{ display: "grid", gap: 14 }}>
        <div style={step}>{num(1)}<div>Copiá tu snippet:<div style={{ marginTop: 8 }}><CopyLine T={T} text={snippet}/></div></div></div>
        <div style={step}>{num(2)}<div>En Shopify: <B T={T}>Tienda online → Temas → Personalizar</B>. Arriba, en el selector de plantillas, elegí <B T={T}>Productos → Producto predeterminado</B>.</div></div>
        <div style={step}>{num(3)}<div>En la barra izquierda, dentro de <B T={T}>Información del producto</B>, tocá <B T={T}>+ Agregar bloque → Liquid personalizado</B>, pegá el snippet y arrastrá el bloque <B T={T}>debajo del botón "Agregar al carrito"</B>.</div></div>
        <div style={step}>{num(4)}<div>Tocá <B T={T}>Guardar</B> (arriba a la derecha) y <B T={T}>abrí cualquier producto de tu tienda</B> en otra pestaña. Con eso alcanza: no hace falta tener un plan todavía.</div></div>

        {seen ? (
          <Callout T={T} tone="success" title="¡El widget ya carga en tu tienda!">
            Lo vimos en <B T={T}>{seen.host || "tu tienda"}</B> hace un momento. Ya podés crear tu primer plan: el selector de suscripción va a aparecer solo en los productos que tengan plan activo.
          </Callout>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, border: `2px solid ${T.border}`, borderTopColor: T.accent, borderRadius: "50%", flexShrink: 0, animation: "rc-step2-spin .8s linear infinite" }}/>
            <div style={{ fontSize: DS.font.sm, color: T.textMd, lineHeight: 1.5 }}>
              <b style={{ color: T.text }}>Esperando que el widget cargue en tu tienda…</b><br/>
              Guardá el tema y abrí un producto. Revisamos cada 4 segundos{checking ? " ·" : ""}{elapsed >= 40 ? " · Si ya lo hiciste, recargá la página del producto sin caché (Cmd/Ctrl + Shift + R) y fijate que el bloque esté en la plantilla de producto que usa tu tienda." : ""}
            </div>
            <style>{`@keyframes rc-step2-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}
      </div>
    </Modal>
  );
}
