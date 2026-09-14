import { useState, useEffect, useCallback } from "react";
import { apiGet, apiPost, apiDelete } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSEmpty, DSBadge, Modal, PageHeader, Callout, Loading, SubTabs, appConfirm, appAlert, appPrompt, toast } from "../ui/components.jsx";
import { pricingModeOf } from "./PacksEditor.jsx";
import WidgetDesigner, { widgetSnippet } from "./WidgetDesigner.jsx";
import PlanEditor, { FormSection } from "./PlanEditor.jsx";
import { MONO, fmtARS } from "./_shared.jsx";

export { FormSection };

// ─── Planes: sub-pestañas Planes · Widget ────────────────────────
// Rutas: #/dashboard/planes (grilla) · #/dashboard/planes?sub=widget (diseño
// global del widget). Se acepta también el viejo ?designer=1.

const SUBS = [{ id:"planes", label:"Planes" }, { id:"widget", label:"Widget" }];

function readSub() {
  try {
    const h = window.location.hash || "";
    const q = new URLSearchParams(h.split("?")[1] || "");
    if (q.get("sub") === "widget" || q.get("designer") === "1" || /^#\/dashboard\/planes\/widget/.test(h)) return "widget";
  } catch (_) {}
  return "planes";
}

export function PlansPage({ merchant, onMerchantChange }) {
  const T = useT();
  const [sub, setSub] = useState(readSub);
  const [plans, setPlans] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  // editor: null | { plan: null } (nuevo) | { plan } (edición)
  const [editor, setEditor] = useState(null);
  const [embedFor, setEmbedFor] = useState(null);

  const goSub = useCallback((id) => {
    setSub(id);
    try { window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/planes${id === "widget" ? "?sub=widget" : ""}`); } catch (_) {}
  }, []);
  useEffect(() => {
    const onHash = () => { if (/^#\/dashboard\/planes/.test(window.location.hash || "")) setSub(readSub()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function loadAll() {
    setLoading(true);
    const [p, pr] = await Promise.all([apiGet("plans"), apiGet("shopify", { action: "products" })]);
    setPlans(p?.plans || []);
    setProducts(pr?.products || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); }, []);

  // Repreciar TODAS las subs activas del plan al mismo monto (PUT preapproval en MP).
  async function repricePlan(p) {
    const suggested = (p.subscription_price_ars || 0) + (p.shipping_price_ars || 0);
    const v = await appPrompt(
      `Nuevo monto TOTAL por cobro (producto + envío, 1 paquete) que MP va a cobrar a TODAS las subs activas de este plan.\n⚠ Si tenés subs con varios paquetes, repreciarlas una por una desde el detalle del suscriptor.`,
      String(suggested || ""),
      { title: `Repreciar suscriptores de "${p.product_title}"`, placeholder: "Monto en $", okLabel: "Continuar" }
    );
    if (v === null) return;
    const amount = Math.round(Number(v));
    if (!(amount > 0)) return toast("Monto inválido", "warning");
    const ok = await appConfirm(`¿Confirmás repreciar a ${fmtARS(amount)} por cobro? Aplica desde el próximo cobro.`, { title:"Repreciar suscriptores", okLabel:"Sí, repreciar" });
    if (!ok) return;
    const d = await apiPost("subscribers", { plan_id: p.id, new_amount: amount }, { action: "reprice" });
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    appAlert(`✓ Repreciadas: ${d.updated} de ${d.total}` + (d.failed?.length ? `\n✗ Fallaron ${d.failed.length}:\n` + d.failed.slice(0, 5).map(f => `· ${f.id}: ${f.error}`).join("\n") : ""), { title:"Resultado del repricing" });
  }

  async function deactivatePlan(p) {
    const ok = await appConfirm(`Queda inactivo (no se muestra en la storefront) pero los suscriptores actuales siguen cobrando.`, { title:`¿Desactivar plan "${p.product_title}"?`, okLabel:"Desactivar" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id });
    toast("Plan desactivado", "warning");
    loadAll();
  }
  async function hardDeletePlan(p) {
    const ok = await appConfirm(`Esto NO se puede deshacer. El plan se elimina de Firestore.\n\nNota: el preapproval_plan en MP queda intacto — si querés que las subs existentes paren de cobrar, cancelalas también en mercadopago.com.ar/subscriptions.`, { title:`⚠️ Borrar definitivamente el plan "${p.product_title}"`, danger:true, okLabel:"Borrar definitivamente" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id, hard: "1" });
    toast("Plan borrado", "warning");
    loadAll();
  }

  // ── Editor a pantalla completa (reemplaza al viejo NewPlanModal) ──
  if (editor) {
    return (
      <PlanEditor
        plan={editor.plan} products={products} merchant={merchant}
        onBack={()=>setEditor(null)}
        onSaved={()=>{ setEditor(null); loadAll(); }}
        onGoWidget={()=>{ setEditor(null); goSub("widget"); }}
      />
    );
  }

  const iconBtn = { padding:"6px 9px", fontSize:DS.font.sm };
  const tabs = <SubTabs T={T} tabs={SUBS.map(s => s.id === "planes" ? { ...s, count: loading ? null : plans.length } : s)} active={sub} onChange={goSub}/>;

  if (sub === "widget") {
    return (
      <div>
        <PageHeader T={T} title="Widget" subtitle="Cómo se ve el selector de suscripción en tu página de producto. Es global: aplica a todos los planes. Los packs se cargan en cada plan." right={tabs}/>
        {loading ? <Loading T={T}/> : <WidgetDesigner merchant={merchant} plans={plans} onSaved={onMerchantChange} onEditPlan={(p)=>setEditor({ plan: p })}/>}
      </div>
    );
  }

  return (
    <div>
      <PageHeader T={T} title="Planes de suscripción" subtitle="Convertí cualquier producto Shopify en suscripción recurrente."
        right={<>
          {tabs}
          <Btn T={T} variant="solid" onClick={()=>setEditor({ plan: null })}>+ Nuevo plan</Btn>
        </>}/>

      <Callout T={T} tone="warning" style={{ marginBottom:DS.sp.lg }}>
        Cambiar el precio de un plan <strong>no</strong> afecta a las suscripciones existentes (MP mantiene el monto autorizado). Usá <strong>💲 Repreciar</strong> en el plan para actualizarlas.
      </Callout>

      {loading ? (
        <Loading T={T}/>
      ) : plans.length === 0 ? (
        <DSEmpty T={T} icon="🎯" title="Todavía no creaste planes" subtitle="Un plan convierte un producto de tu Shopify en suscripción recurrente." action={<Btn T={T} variant="solid" onClick={()=>setEditor({ plan: null })}>+ Nuevo plan</Btn>}/>
      ) : (
        <div className="gh-stagger" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(330px, 1fr))", gap:DS.sp.lg }}>
          {plans.map(p => (
            <Card key={p.id} T={T} hoverable className="gh-card-enter" padding="md">
              <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:12 }}>
                {p.product_image
                  ? <img src={p.product_image} alt="" style={{ width:52, height:52, borderRadius:DS.r.lg, objectFit:"cover", border:`1px solid ${T.borderL}`, flexShrink:0 }}/>
                  : <div style={{ width:52, height:52, borderRadius:DS.r.lg, background:T.surface, border:`1px solid ${T.borderL}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, flexShrink:0 }}>📦</div>}
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.product_title}>{p.product_title}</div>
                  <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>Cada {p.frequency_days} días · {p.discount_pct||0}% OFF</div>
                  <div style={{ marginTop:6, display:"flex", gap:6, flexWrap:"wrap" }}>
                    {pricingModeOf(p) === "packs"
                      ? <span title="Recurrentes arma el selector de packs en tu tienda"><DSBadge T={T} color={T.accent} size="sm">Packs {(p.packs||[]).map(k=>k.qty).join("·") || "—"}</DSBadge></span>
                      : <span title="El precio, la cantidad y la frecuencia salen de tu tema"><DSBadge T={T} color={T.textSm} size="sm">Precio del tema</DSBadge></span>}
                    {p.active === false && <DSBadge T={T} color={T.yellow} size="sm">Inactivo</DSBadge>}
                  </div>
                </div>
              </div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", padding:"10px 0", borderTop:`1px solid ${T.borderL}`, borderBottom:`1px solid ${T.borderL}` }}>
                <div>
                  <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.semibold, letterSpacing:0.4 }}>Precio sub</div>
                  <div style={{ fontSize:18, fontWeight:DS.w.black, color:T.accent, letterSpacing:-0.4, fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.subscription_price_ars)}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.semibold, letterSpacing:0.4 }}>Precio normal</div>
                  <div style={{ fontSize:DS.font.base, color:T.textMd, textDecoration:"line-through", fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.base_price_ars)}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, marginTop:12, flexWrap:"wrap" }}>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>setEditor({ plan: p })} style={{ flex:1 }}>✏️ Editar</Btn>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>setEmbedFor(p)} style={{ flex:1 }}>📋 Snippet</Btn>
                <Btn T={T} variant="secondary" size="sm" onClick={()=>repricePlan(p)} title="Repreciar suscriptores de este plan" style={iconBtn}>💲</Btn>
                {/* Desactivar (soft): el plan deja de mostrarse pero las subs ya creadas siguen vivas. */}
                <Btn T={T} variant="secondary" size="sm" onClick={()=>deactivatePlan(p)} title="Desactivar (mantiene historial)" style={{ ...iconBtn, color:T.yellow, borderColor:T.yellow+"66" }}>⏸</Btn>
                {/* Borrar definitivamente (hard): elimina el plan de Firestore. El preapproval_plan en MP queda allá. */}
                <Btn T={T} variant="danger" size="sm" onClick={()=>hardDeletePlan(p)} title="Borrar definitivamente" style={iconBtn}>🗑</Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      {embedFor && <EmbedSnippetModal plan={embedFor} merchant={merchant} onClose={()=>setEmbedFor(null)}/>}
    </div>
  );
}

// Alias para el Dashboard (import histórico).
export const PlansTab = PlansPage;

export function EmbedSnippetModal({ plan, merchant, onClose }) {
  const T = useT();
  const snippet = widgetSnippet(merchant);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try { await navigator.clipboard.writeText(snippet); setCopied(true); toast("Snippet copiado", "success"); setTimeout(()=>setCopied(false),2000); } catch(_) { toast("No se pudo copiar — seleccioná el texto y copialo a mano", "warning"); }
  }

  return (
    <Modal T={T} open onClose={onClose} title="Código para tu tienda" subtitle={plan?.product_title} width={620}
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose}>Cerrar</Btn>
        <Btn T={T} variant="solid" onClick={copy}>{copied ? "✓ Copiado" : "📋 Copiar snippet"}</Btn>
      </>}>
      <div style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.6, marginBottom:14 }}>
        Pegá esto en el theme de tu Shopify, dentro de la página de producto (Online Store → Themes → Personalizar → bloque "Liquid personalizado" debajo del botón de compra, o en templates/product.json).
      </div>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:"12px 14px", fontSize:DS.font.md, fontFamily:MONO, overflowX:"auto", margin:0, color:T.accent, lineHeight:1.5 }}>{snippet}</pre>
      <Callout T={T} tone="info" style={{ marginTop:14 }}>
        El widget detecta automáticamente el producto que el cliente está viendo. Si hay plan activo para ese producto, muestra el toggle Compra única / Suscripción. Si no hay plan, no aparece nada. El mismo snippet sirve para todos los planes.
      </Callout>
    </Modal>
  );
}
