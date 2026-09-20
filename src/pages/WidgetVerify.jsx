import React, { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Modal, Btn, Callout, toast } from "../ui/components.jsx";
import { writeFlag, widgetKey } from "../lib/onboarding.js";
import { merchantProfile } from "../../shared/platform/profile.js";

// ─── "Activar en mi tienda": verificación en vivo del widget ─────────
// Abrimos la página de un producto con plan en otra pestaña (con ?rec_verify=1) y
// esperamos a que widget.js avise que quedó VISIBLE 3 segundos seguidos
// (merchant?action=widget-verify-status). Recién ahí damos el tilde. Si cargó pero no
// se montó, el widget manda el motivo y lo explicamos acá.
const B = ({ T, children }) => <b style={{ color: T.text }}>{children}</b>;
const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";
const WA = "https://wa.me/5491164117974?text=" + encodeURIComponent("Hola! El widget de Recurrentes no se ve en mi tienda. ¿Me ayudan?");

export const ISSUE_COPY = {
  no_form:    { title: "Cargó, pero no encontró el botón de comprar del tema", body: (T) => <>Tu tema (o una app de bundles / packs) cambió el formulario de compra y el widget no supo dónde ubicarse. Solución rápida: en el tema agregá <code style={{ fontFamily: MONO }}>&lt;div id="recurrentes-mount"&gt;&lt;/div&gt;</code> donde querés la caja. O <a href={WA} target="_blank" rel="noopener" style={{ color: T.accent }}>escribinos por WhatsApp</a> y lo acomodamos nosotros.</> },
  no_product: { title: "Cargó, pero no reconoció el producto", body: () => <>El tema no expone el producto como esperamos. Pasa con temas muy personalizados: escribinos por WhatsApp con el link del producto y lo ajustamos.</> },
  no_plan:    { title: "Cargó, pero ese producto no tiene un plan activo", body: () => <>El widget aparece solo en productos con plan. Fijate que el plan esté activo y sea de ese producto, o elegí otro plan arriba.</> },
  hidden:     { title: "Se montó, pero no se ve", body: () => <>Quedó sin tamaño en la página: otra app o el CSS del tema lo esconde. Suele pasar con apps de bundles que reemplazan el bloque de compra. Probá desactivarla en ese producto o escribinos por WhatsApp.</> },
  error:      { title: "El widget tuvo un error en tu tema y se apagó solo", body: () => <>Tu tienda siguió vendiendo con el botón de siempre (nunca dejamos el producto sin botón de compra). Escribinos por WhatsApp con el link del producto y lo revisamos.</> },
  removed:    { title: "Apareció y el tema lo sacó", body: () => <>El tema volvió a dibujar el bloque de compra por JavaScript y borró el widget. Escribinos por WhatsApp: se resuelve con un ajuste chico.</> },
};

export function WidgetVerifyModal({ merchant, plans = [], onClose, onVerified }) {
  const T = useT();
  const m = merchant || {};
  const tn = merchantProfile(m).channel === "tiendanube";
  const storePlans = (Array.isArray(plans) ? plans : []).filter(p => p && p.active !== false && p.item_source !== "manual" && p.shopify_product_id);
  const [planId, setPlanId] = useState(storePlans[0]?.id || "");
  const [phase, setPhase] = useState("idle"); // idle | opening | waiting | ok | issue | timeout
  const [result, setResult] = useState(null);
  const [url, setUrl] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const MAX_S = 75;
  async function start() {
    if (phase === "opening" || phase === "waiting") return;
    setResult(null); setUrl(null); setElapsed(0); setPhase("opening");
    // La pestaña se abre en el mismo clic (si no, el navegador la bloquea) y se le pone la URL después.
    let w = null;
    try { w = window.open("about:blank", "_blank"); } catch (_) {}
    const since = new Date().toISOString();
    const r = await apiGet("merchant", { action: "widget-verify-url", plan: planId || "" });
    if (!alive.current) return;
    if (!r || r.error) {
      try { w && w.close(); } catch (_) {}
      setPhase("idle");
      toast(r?.error || "No pudimos armar el link del producto.", "error", 7000);
      return;
    }
    setUrl(r.url);
    if (w) { try { w.location = r.url; } catch (_) {} }
    else toast("Tu navegador bloqueó la pestaña: tocá “Abrir el producto”.", "warning", 6000);
    setPhase("waiting");
    const t0 = Date.now();
    while (alive.current) {
      await new Promise(res => setTimeout(res, 2500));
      if (!alive.current) return;
      setElapsed(Math.round((Date.now() - t0) / 1000));
      let st = null;
      try { st = await apiGet("merchant", { action: "widget-verify-status", since }); } catch (_) {}
      if (st?.verified) { setResult(st); setPhase("ok"); writeFlag(widgetKey(m.id), true); toast("¡El widget se ve en tu tienda!", "success"); onVerified?.(st.verified); return; }
      if (st?.issue) { setResult(st); setPhase("issue"); return; }
      if (Date.now() - t0 > MAX_S * 1000) { setResult(st || {}); setPhase("timeout"); return; }
    }
  }

  const sel = { width: "100%", padding: "9px 12px", borderRadius: 10, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: DS.font.base };
  const nice = (h) => !h ? "tu tienda" : /shopifypreview\.com$/.test(h) ? "la vista previa de tu tema" : h;
  const busy = phase === "opening" || phase === "waiting";

  return (
    <Modal T={T} open onClose={onClose} width={720} title="Activar el widget en tu tienda"
      subtitle="Abrimos un producto tuyo en otra pestaña y confirmamos que la caja de suscripción se ve de verdad. Dejá esa pestaña abierta unos segundos."
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: DS.font.sm, color: T.textSm }}>{phase === "ok" ? "Listo: tus clientes ya ven la suscripción en ese producto." : url ? <a href={url} target="_blank" rel="noopener" style={{ color: T.accent }}>Abrir el producto de nuevo ↗</a> : "Tarda unos 10 segundos."}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {phase !== "ok" && <Btn T={T} variant="solid" disabled={busy || !storePlans.length} onClick={start}>{busy ? "Mirando tu tienda…" : phase === "idle" ? "Abrir mi tienda y verificar" : "Probar de nuevo"}</Btn>}
            <Btn T={T} variant={phase === "ok" ? "solid" : "secondary"} onClick={onClose}>{phase === "ok" ? "Listo ✓" : "Cerrar"}</Btn>
          </div>
        </div>
      }>
      <div style={{ display: "grid", gap: 14 }}>
        {storePlans.length ? (
          <label style={{ display: "grid", gap: 6, fontSize: DS.font.sm, color: T.textMd }}>
            <span>Producto con plan para probar</span>
            <select value={planId} onChange={e => setPlanId(e.target.value)} disabled={busy} style={sel}>
              {storePlans.map(p => <option key={p.id} value={p.id}>{p.product_title || p.id}</option>)}
            </select>
          </label>
        ) : (
          <Callout T={T} tone="warning" title="Primero creá un plan con un producto de tu tienda">El widget aparece solo en los productos que tienen plan. Creá uno en Planes y volvé acá.</Callout>
        )}

        {busy && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10 }}>
            <span aria-hidden="true" style={{ width: 18, height: 18, border: `2px solid ${T.border}`, borderTopColor: T.accent, borderRadius: "50%", flexShrink: 0, animation: "rc-verify-spin .8s linear infinite" }}/>
            <div style={{ fontSize: DS.font.sm, color: T.textMd }}><B T={T}>{phase === "opening" ? "Abriendo tu producto…" : `Mirando tu tienda… ${elapsed}s`}</B> El widget tiene que quedar 3 segundos visible en la página. No cierres la otra pestaña todavía.</div>
            <style>{`@keyframes rc-verify-spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {phase === "ok" && result?.verified && (
          <Callout T={T} tone="success" title="✓ El widget se ve en tu tienda">
            Lo vimos {result.verified.ms ? `${Math.round(result.verified.ms / 1000)} segundos ` : ""}en <B T={T}>{nice(result.verified.host)}{result.verified.path || ""}</B>. La caja de suscripción ya está activa para tus clientes en todos los productos con plan.
          </Callout>
        )}
        {phase === "issue" && result?.issue && (() => { const c = ISSUE_COPY[result.issue.reason] || { title: "El widget no se pudo mostrar", body: () => <>Escribinos por WhatsApp con el link del producto y lo revisamos.</> }; return (
          <Callout T={T} tone="warning" title={c.title}>{c.body(T)}</Callout>
        ); })()}
        {phase === "timeout" && (
          result?.loaded
            ? <Callout T={T} tone="warning" title="El widget cargó, pero no llegamos a verlo en pantalla">Puede que hayas cerrado la pestaña antes de los 3 segundos, o que la página tardara en armarse. Tocá <B T={T}>Probar de nuevo</B> y dejá la pestaña del producto abierta hasta que acá aparezca el tilde.</Callout>
            : <Callout T={T} tone="danger" title="No vimos el widget en tu tienda">
                {tn
                  ? <>Fijate que la app <B T={T}>Recurrentes</B> figure instalada en tu Tiendanube (Mi Tiendanube → Aplicaciones). Si está y sigue sin verse, <a href={WA} target="_blank" rel="noopener" style={{ color: T.accent }}>escribinos por WhatsApp</a>.</>
                  : <>El snippet no está cargando en ese producto. Fijate que la línea esté en <B T={T}>theme.liquid del tema activo</B> (Tienda online → Temas → ⋯ → Editar código) y que hayas tocado <B T={T}>Guardar</B>. Si tenés varios temas, el que dice <B T={T}>Actual</B>. Si está bien y sigue sin verse, <a href={WA} target="_blank" rel="noopener" style={{ color: T.accent }}>escribinos por WhatsApp</a>.</>}
              </Callout>
        )}
      </div>
    </Modal>
  );
}

// Botón que abre el modal. Úsalo en Widget y en Planes.
export function WidgetVerifyButton({ merchant, plans = [], onVerified, variant = "secondary", size = "md", children, style = {} }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn T={T} variant={variant} size={size} type="button" onClick={() => setOpen(true)} style={style}>{children || "Activar en mi tienda"}</Btn>
      {open && <WidgetVerifyModal merchant={merchant} plans={plans} onClose={() => setOpen(false)} onVerified={onVerified}/>}
    </>
  );
}

// Estado del widget en la tienda (arriba del diseñador): verificado / con problema / nunca.
export function WidgetStatusCard({ merchant, plans = [], onVerified, style = {} }) {
  const T = useT();
  const m = merchant || {};
  const v = m.widget_verified_at || "";
  const issue = m.widget_last_issue && (!v || m.widget_last_issue.at > v) ? m.widget_last_issue : null;
  const when = (iso) => { try { return new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); } catch (_) { return ""; } };
  const tone = issue ? "warning" : v ? "success" : "info";
  const title = issue ? (ISSUE_COPY[issue.reason]?.title || "El widget no se pudo mostrar") : v ? "✓ El widget se ve en tu tienda" : "Todavía no verificaste que el widget se vea en tu tienda";
  const body = issue
    ? <>Lo detectamos el {when(issue.at)} en <B T={T}>{issue.host}{issue.path || ""}</B>. Tocá “Activar en mi tienda” para volver a probar y ver cómo arreglarlo.</>
    : v ? <>Verificado el {when(v)} en <B T={T}>{m.widget_verified_host}{m.widget_verified_path || ""}</B>.{m.widget_verified_hidden ? <> Había otro selector de packs (<B T={T}>{m.widget_verified_hidden}</B>) y lo ocultamos: en ese producto manda el de Recurrentes.</> : null} Si cambiás el tema o instalás una app de bundles, volvé a verificar.</>
    : <>Abrimos un producto tuyo y confirmamos que la caja de suscripción aparece de verdad (3 segundos en pantalla). Es la única forma de estar seguros de que tus clientes la ven.</>;
  return (
    <Callout T={T} tone={tone} title={title} style={{ marginBottom: 14, ...style }}
      right={<WidgetVerifyButton merchant={m} plans={plans} onVerified={onVerified} variant={v && !issue ? "secondary" : "solid"} size="sm">{v && !issue ? "Verificar de nuevo" : "Activar en mi tienda"}</WidgetVerifyButton>}>
      {body}
    </Callout>
  );
}
