import { useState, useEffect, useCallback, useMemo } from "react";
import { useTabRefresh } from "../lib/tabs.js";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, InputStyle, DSEmpty, DSBadge, Modal, PageHeader, Callout, Loading, SubTabs, appConfirm, appAlert, appPrompt, toast } from "../ui/components.jsx";
import { pricingModeOf } from "./PacksEditor.jsx";
import WidgetDesigner, { widgetSnippet } from "./WidgetDesigner.jsx";
import { WidgetVerifyButton } from "./WidgetVerify.jsx";
import PlanEditor, { FormSection, SubscriptionLinkBox } from "./PlanEditor.jsx";
import { MONO, fmtARS, fmtFreq, RowMenu } from "./_shared.jsx";
import { Segmented } from "../ui/charts.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";
import { TIPS, readFlag, widgetKey } from "../lib/onboarding.js";

export { FormSection };

// ─── Planes: sub-pestañas Planes · Widget ────────────────────────
// Rutas: #/dashboard/planes (grilla) · #/dashboard/planes?sub=widget (diseño
// global del widget). Se acepta también el viejo ?designer=1.
// Se adapta al perfil del negocio (shared/platform/profile.js):
//   · con tienda (Shopify): producto del catálogo + widget con packs + snippet.
//   · sin tienda (servicios, digitales, link): ítem cargado a mano + link de suscripción.

const TYPE_EMOJI = { physical: "📦", digital: "📚", service: "🏋️" };

function readSub(widgetOn) {
  if (!widgetOn) return "planes";
  try {
    const h = window.location.hash || "";
    const q = new URLSearchParams(h.split("?")[1] || "");
    if (q.get("sub") === "widget" || q.get("designer") === "1" || /^#\/dashboard\/planes\/widget/.test(h)) return "widget";
  } catch (_) {}
  return "planes";
}

const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
// Ingreso mensual de una suscripción: total por cobro normalizado a 30 días (mismo criterio que /api/stats).
const mrrOfSub = (s) => {
  const qty = s.quantity || s.plan_snapshot?.units_per_shipment || 1;
  const per = s.plan_snapshot?.total_per_charge_ars || ((s.plan_snapshot?.subscription_price_ars || 0) * qty);
  return per * (30 / (s.plan_snapshot?.frequency_days || 30));
};
const SORT_KEY = "rec_plans_sort";
const SORTS = [
  { id:"subs", label:"Más suscripciones" },
  { id:"mrr",  label:"Mayor ingreso" },
  { id:"name", label:"Nombre (A-Z)" },
  { id:"new",  label:"Más nuevos" },
];
const readSort = () => { try { const s = localStorage.getItem(SORT_KEY); return SORTS.some(x => x.id === s) ? s : "subs"; } catch (_) { return "subs"; } };
const SearchIcon = ({ color }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.6"/><path d="M11 11l3.5 3.5" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>
);

// Sección "Widget" del menú (Catálogo → Widget, #/dashboard/widget). Reusa PlansPage
// fijada en la sub-vista del diseñador.
export function WidgetTab({ merchant, onMerchantChange }) {
  return <PlansPage merchant={merchant} onMerchantChange={onMerchantChange} forceSub="widget"/>;
}

export function PlansPage({ merchant, onMerchantChange, forceSub = null }) {
  const T = useT();
  const iS = InputStyle(T);
  const profile = useMemo(() => merchantProfile(merchant), [merchant]);
  const widgetOn = profile.caps.widget;
  const [sub, setSub] = useState(() => forceSub || readSub(widgetOn));
  const [plans, setPlans] = useState([]);
  const [products, setProducts] = useState([]);
  // Por que vino vacio el catalogo (permiso sin aprobar, API caida): sin esto
  // el selector de producto quedaba vacio y mudo. 22-sept-2026, caso Wellfresh.
  const [catalogError, setCatalogError] = useState(null);
  const [activeSubs, setActiveSubs] = useState([]);
  const [failedSubs, setFailedSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  // Arranca en "Todos": desde que los planes nacen apagados (22-sept-2026), con
  // el filtro en "Activos" el que acabas de crear no aparecia en ningun lado.
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(readSort);
  // editor: null | { plan: null } (nuevo) | { plan } (edición)
  const [editor, setEditor] = useState(null);
  const [linkFor, setLinkFor] = useState(null);
  const [justCreated, setJustCreated] = useState(null); // plan recién creado con tienda: ofrecemos ir al widget
  // Desde Widget → "Editar packs de este plan" llega #/dashboard/planes?edit=<id>:
  // abrimos ese plan en el editor apenas cargan los planes.
  const [pendingEdit, setPendingEdit] = useState(() => {
    try { return new URLSearchParams((window.location.hash || "").split("?")[1] || "").get("edit") || null; } catch (_) { return null; }
  });
  useEffect(() => {
    if (forceSub || !pendingEdit || loading) return;
    const p = plans.find(x => x.id === pendingEdit);
    setPendingEdit(null);
    try { window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/planes`); } catch (_) {}
    if (p) setEditor({ plan: p });
  }, [forceSub, pendingEdit, loading, plans]);

  // Planes y Widget son dos secciones del menú: navegar entre ellas cambia el hash
  // (Dashboard lo escucha). Las URLs viejas (#/dashboard/planes?sub=widget) redirigen.
  const goSub = useCallback((id) => {
    try { window.location.hash = id === "widget" ? "#/dashboard/widget" : "#/dashboard/planes"; } catch (_) {}
  }, []);
  useEffect(() => {
    if (!forceSub && widgetOn && readSub(widgetOn) === "widget") goSub("widget");
  }, [forceSub, widgetOn, goSub]);

  async function loadAll({ silent = false } = {}) {
    if (!silent) setLoading(true);
    // El catálogo solo existe con tienda conectada (Shopify); sin tienda los planes son manuales.
    // Las suscripciones activas / con pago fallido dan las métricas por plan (sin tocar el backend).
    const [p, pr, act, fail] = await Promise.all([
      apiGet("plans"),
      profile.caps.catalog ? apiGet("shopify", { action: profile.channel === "tiendanube" ? "tn-products" : "products" }) : Promise.resolve({ products: [] }),
      apiGet("subscribers", { status: "active" }).catch(() => null),
      apiGet("subscribers", { status: "payment_failed" }).catch(() => null),
    ]);
    setPlans(p?.plans || []);
    setProducts(pr?.products || []);
    setCatalogError(pr?.error ? { error: pr.error, code: pr.code, scope: pr.scope, scopes_granted: pr.scopes_granted } : null);
    setActiveSubs(act?.subscribers || []);
    setFailedSubs(fail?.subscribers || []);
    setLoading(false);
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [profile.caps.catalog]);
  useTabRefresh(forceSub === "widget" ? "widget" : "planes", () => loadAll({ silent: true }));

  // Repreciar TODAS las subs activas del plan al mismo monto (PUT preapproval en MP).
  async function repricePlan(p) {
    const suggested = (p.subscription_price_ars || 0) + (p.shipping_price_ars || 0);
    const v = await appPrompt(
      profile.caps.shipping
        ? `Nuevo monto TOTAL por cobro (producto + envío, 1 paquete) que MP va a cobrar a TODAS las subs activas de este plan.\n⚠ Si tenés subs con varios paquetes, repreciarlas una por una desde el detalle del suscriptor.`
        : `Nuevo monto por cobro que ${profile.providerInfo.label} va a cobrar a TODAS las suscripciones activas de este plan.`,
      String(suggested || ""),
      { title: `Repreciar ${profile.vocab.customers} de "${p.product_title}"`, placeholder: "Monto en $", okLabel: "Continuar" }
    );
    if (v === null) return;
    const amount = Math.round(Number(v));
    if (!(amount > 0)) return toast("Monto inválido", "warning");
    const ok = await appConfirm(`¿Confirmás repreciar a ${fmtARS(amount)} por cobro? Aplica desde el próximo cobro.`, { title:"Repreciar suscripciones", okLabel:"Sí, repreciar" });
    if (!ok) return;
    const d = await apiPost("subscribers", { plan_id: p.id, new_amount: amount }, { action: "reprice" });
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    appAlert(`✓ Repreciadas: ${d.updated} de ${d.total}` + (d.failed?.length ? `\n✗ Fallaron ${d.failed.length}:\n` + d.failed.slice(0, 5).map(f => `· ${f.id}: ${f.error}`).join("\n") : ""), { title:"Resultado del repricing" });
    loadAll();
  }

  async function deactivatePlan(p) {
    const ok = await appConfirm(widgetOn
      ? `Queda inactivo (no se muestra en la storefront) pero los suscriptores actuales siguen cobrando.`
      : `Queda inactivo (el link deja de aceptar suscripciones nuevas) pero las suscripciones actuales siguen cobrando.`,
      { title:`¿Desactivar plan "${p.product_title}"?`, okLabel:"Desactivar" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id });
    toast("Plan desactivado", "warning");
    loadAll();
  }
  // Publicar: recien acá el plan aparece en la tienda. Los planes nacen
  // apagados (22-sept-2026, Thiago) para poder revisarlos antes.
  async function publishPlan(p) {
    const d = await apiPatch("plans", { active: true }, { id: p.id });
    if (d?.error) { toast("Error: " + d.error, "error", 6000); return; }
    toast("Publicado: aparece en tu tienda en ~5 min", "success");
    loadAll();
  }
  async function hardDeletePlan(p) {
    const ok = await appConfirm(`Esto NO se puede deshacer. El plan se elimina de Firestore.\n\nNota: el preapproval_plan en MP queda intacto — si querés que las subs existentes paren de cobrar, cancelalas también en mercadopago.com.ar/subscriptions.`, { title:`⚠️ Borrar definitivamente el plan "${p.product_title}"`, danger:true, okLabel:"Borrar definitivamente" });
    if (!ok) return;
    await apiDelete("plans", { id: p.id, hard: "1" });
    toast("Plan borrado", "warning");
    loadAll();
  }

  // Métricas por plan: activas, ingreso mensual y pagos fallidos (por plan_id).
  const byPlan = useMemo(() => {
    const m = {};
    const row = (id) => (m[id] = m[id] || { active: 0, mrr: 0, failed: 0 });
    for (const s of activeSubs) if (s.plan_id) { const r = row(String(s.plan_id)); r.active++; r.mrr += mrrOfSub(s); }
    for (const s of failedSubs) if (s.plan_id) row(String(s.plan_id)).failed++;
    return m;
  }, [activeSubs, failedSubs]);
  const totalMrr = useMemo(() => activeSubs.reduce((t, s) => t + mrrOfSub(s), 0), [activeSubs]);
  const stat = (p) => byPlan[String(p.id)] || { active: 0, mrr: 0, failed: 0 };

  const activeCount = plans.filter(p => p.active !== false).length;
  const inactiveCount = plans.length - activeCount;

  const q = search.trim().toLowerCase();
  const list = useMemo(() => {
    const rows = plans.filter(p => (filter === "all" || (filter === "active" ? p.active !== false : p.active === false))
      && (!q || String(p.product_title || "").toLowerCase().includes(q)));
    const cmp = {
      subs: (a, b) => stat(b).active - stat(a).active || stat(b).mrr - stat(a).mrr,
      mrr:  (a, b) => stat(b).mrr - stat(a).mrr,
      name: (a, b) => String(a.product_title || "").localeCompare(String(b.product_title || "")),
      new:  (a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")),
    }[sort];
    return rows.sort(cmp);
  }, [plans, filter, q, sort, byPlan]);
  const pickSort = (s) => { setSort(s); try { localStorage.setItem(SORT_KEY, s); } catch (_) {} };

  // ── Editor a pantalla completa (reemplaza al viejo NewPlanModal) ──
  if (editor) {
    return (
      <PlanEditor
        plan={editor.plan} products={products} merchant={merchant} catalogError={catalogError}
        onBack={()=>setEditor(null)}
        onSaved={(np)=>{
          const wasNew = !editor.plan; setEditor(null); loadAll();
          // Sin tienda (venta por link): lo que necesita es el link. Con tienda:
          // el paso siguiente es el widget. 21-sept-2026 (Thiago): "le expliqué
          // que era por dos partes separadas" — el comerciante crea el plan y
          // pregunta por los colores, porque nada le dice que eso vive en otro lado.
          if (wasNew && np?.id && !widgetOn) setLinkFor(np);
          else if (wasNew && np?.id) setJustCreated(np);
        }}
        onGoWidget={()=>{ setEditor(null); goSub("widget"); }}
      />
    );
  }

  const tabs = null; // Planes y Widget ya son secciones separadas del menú

  if (widgetOn && sub === "widget") {
    return (
      <div>
        <PageHeader T={T} title="Widget" subtitle="Cómo se ve el selector de suscripción en tu página de producto. Es global: aplica a todos los planes. Los packs se cargan en cada plan." right={tabs}/>
        {loading ? <Loading T={T}/> : <WidgetDesigner merchant={merchant} plans={plans} onSaved={onMerchantChange} onEditPlan={(p)=>{ try { window.location.hash = `#/dashboard/planes?edit=${encodeURIComponent(p.id)}`; } catch (_) {} }}/>}
      </div>
    );
  }

  const subtitle = profile.caps.catalog
    ? `Convertí cualquier producto de ${profile.channelInfo.label} en suscripción recurrente.`
    : `Cada plan es ${profile.vocab.item === "membresía" ? "una membresía" : "una suscripción"} con su propio link para compartir. No hace falta tienda online.`;
  const filterTabs = [
    { id:"active", label:"Activos", count: activeCount },
    ...(inactiveCount ? [{ id:"inactive", label:"Inactivos", count: inactiveCount }] : []),
    { id:"all", label:"Todos", count: plans.length },
  ];
  const pill = { ...iS, width:"auto", height:34, borderRadius:99, fontSize:DS.font.md, boxSizing:"border-box" };
  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5 };

  return (
    <div>
      {/* Cerró el Paso 2 de Shopify sin verificar el widget → recordatorio hasta que lo veamos en la tienda. */}
      {profile.channel === "shopify" && merchant?.shopify_shop && !merchant?.widget_last_seen_at && !merchant?.widget_installed_ack && !readFlag(widgetKey(merchant?.id)) && (
        <Callout T={T} tone="warning" title="Falta el paso 2: el widget todavía no está en tu tienda" style={{ marginBottom:16 }}
          right={<Btn T={T} variant="solid" size="sm" onClick={() => { try { window.location.hash = "#/dashboard/planes?store_step2=shopify"; } catch (_) {} }}>Abrir el paso 2</Btn>}>
          Sin la línea del widget en theme.liquid, tus clientes no ven la suscripción en los productos. Son 3 pasos.
        </Callout>
      )}
      <PageHeader T={T} title="Planes de suscripción" subtitle={subtitle}
        right={<>
          {tabs}
          {profile.caps.widget && (merchant?.shopify_token || merchant?.tiendanube_token) && plans.length > 0 && (
            <WidgetVerifyButton merchant={merchant} plans={plans} onVerified={onMerchantChange}>{merchant?.widget_verified_at ? "✓ Activo en mi tienda" : "Activar en mi tienda"}</WidgetVerifyButton>
          )}
          <Btn T={T} variant="solid" onClick={()=>setEditor({ plan: null })}>+ Nuevo plan</Btn>
        </>}/>

      {loading ? (
        <Loading T={T}/>
      ) : plans.length === 0 ? (
        <DSEmpty T={T} icon={TYPE_EMOJI[profile.businessType] || "🎯"} title="Todavía no creaste planes"
          subtitle={profile.caps.catalog ? "Un plan convierte un producto de tu tienda en suscripción recurrente." : `Cargá tu primer plan (ej: nombre, precio y cada cuántos días se cobra) y compartí el link con tus ${profile.vocab.customers}.`}
          action={<Btn T={T} variant="solid" onClick={()=>setEditor({ plan: null })}>+ Nuevo plan</Btn>}/>
      ) : (
        <>
          {/* Barra: estado · búsqueda · orden · conteo */}
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:10 }}>
            <Segmented T={T} options={filterTabs} value={filter} onChange={setFilter} ariaLabel="Estado del plan"/>
            <div style={{ position:"relative", flex:"0 1 240px", minWidth:160 }}>
              <span style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", display:"flex", pointerEvents:"none" }}><SearchIcon color={T.textSm}/></span>
              <input type="search" aria-label="Buscar planes" placeholder="Buscar plan…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...pill, width:"100%", padding:"0 12px 0 30px" }}/>
            </div>
            <select aria-label="Ordenar planes" value={sort} onChange={e => pickSort(e.target.value)} style={{ ...pill, padding:"0 12px", cursor:"pointer" }}>
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <span style={{ marginLeft:"auto", fontSize:DS.font.sm, color:T.textSm, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>{fmtN(list.length)} plan{list.length === 1 ? "" : "es"}</span>
          </div>

          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginBottom:14, lineHeight:1.5 }}>
            Cambiar el precio de un plan <strong style={{ color:T.textMd }}>no</strong> cambia lo que pagan las suscripciones existentes ({profile.providerInfo.label} mantiene el monto autorizado). Para actualizarlas usá <strong style={{ color:T.textMd }}>Repreciar</strong> en el menú ⋮ del plan.
          </div>

          {list.length === 0 ? (
            <div style={{ padding:"36px 12px", textAlign:"center", color:T.textSm, fontSize:DS.font.base, border:`1px dashed ${T.border}`, borderRadius:12 }}>
              Ningún plan coincide con el filtro. <button onClick={() => { setSearch(""); setFilter("all"); }} style={{ background:"none", border:"none", color:T.accent, cursor:"pointer", fontWeight:700, fontFamily:"inherit", fontSize:"inherit" }}>Ver todos</button>
            </div>
          ) : (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap:12 }}>
              {list.map(p => {
                const manualPlan = p.item_source === "manual" || !p.shopify_variant_id;
                const esTiendanube = profile.channel === "tiendanube";
                const hasDiscount = (p.discount_pct || 0) > 0;
                const st = stat(p);
                const share = totalMrr ? Math.round((st.mrr / totalMrr) * 100) : 0;
                const off = p.active === false;
                return (
                  <article key={p.id} style={{ background:`linear-gradient(150deg, ${T.card} 60%, ${T.accentSolid}0c)`, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 14px 12px", display:"flex", flexDirection:"column", gap:12, minWidth:0, opacity: off ? 0.72 : 1 }}>
                    {/* Encabezado: imagen · nombre · frecuencia · badges · menú */}
                    <div style={{ display:"flex", alignItems:"flex-start", gap:12 }}>
                      {p.product_image
                        ? <img src={p.product_image} alt="" style={{ width:48, height:48, borderRadius:10, objectFit:"cover", border:`1px solid ${T.borderL}`, flexShrink:0 }}/>
                        : <div aria-hidden="true" style={{ width:48, height:48, borderRadius:10, background:T.surface, border:`1px solid ${T.borderL}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:21, flexShrink:0 }}>{TYPE_EMOJI[profile.businessType] || "📦"}</div>}
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14.5, fontWeight:800, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", letterSpacing:-0.2 }} title={p.product_title}>{p.product_title}</div>
                        <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{fmtFreq(p.frequency_days).replace(/^./, c => c.toUpperCase())}{hasDiscount ? ` · ${p.discount_pct}% OFF` : ""}</div>
                        <div style={{ marginTop:6, display:"flex", gap:6, flexWrap:"wrap" }}>
                          {manualPlan
                            ? <span title="Se vende con su link de suscripción"><DSBadge T={T} color={T.accent} size="sm">Link de suscripción</DSBadge></span>
                            : pricingModeOf(p) === "packs"
                              ? <span title="Recurrentes arma el selector de packs en tu tienda"><DSBadge T={T} color={T.accent} size="sm">Packs {(p.packs||[]).map(k=>k.qty).join("·") || "—"}</DSBadge></span>
                              : <span title="El precio, la cantidad y la frecuencia salen de tu tema"><DSBadge T={T} color={T.textSm} size="sm">Precio del tema</DSBadge></span>}
                          {off && <DSBadge T={T} color={T.yellow} size="sm">{p.published_at ? "Inactivo" : "Sin publicar"}</DSBadge>}
                          {st.failed > 0 && <span title="Suscripciones de este plan con el último cobro rechazado"><DSBadge T={T} color={T.red} size="sm">{st.failed} con pago fallido</DSBadge></span>}
                        </div>
                      </div>
                      <RowMenu T={T} label={`Acciones de ${p.product_title}`} items={[
                        { label:"Repreciar suscripciones", icon:"💲", onClick: () => repricePlan(p) },
                        { label:"Publicar en mi tienda", icon:"▶", hidden: !off, onClick: () => publishPlan(p) },
                        { label:"Desactivar plan", icon:"⏸", hidden: off, onClick: () => deactivatePlan(p) },
                        { label:"Borrar definitivamente", icon:"🗑", danger:true, onClick: () => hardDeletePlan(p) },
                      ]}/>
                    </div>

                    {/* Números: precio · activas · por mes */}
                    <div style={{ display:"grid", gridTemplateColumns:"1.15fr 0.8fr 1.15fr", gap:8, padding:"10px 0", borderTop:`1px solid ${T.borderL}`, borderBottom:`1px solid ${T.borderL}` }}>
                      <div style={{ minWidth:0 }}>
                        <div style={label}>{manualPlan ? "Se cobra" : "Precio sub"}</div>
                        <div style={{ fontSize:17, fontWeight:800, color:T.accent, letterSpacing:-0.4, fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.subscription_price_ars)}</div>
                        {hasDiscount && p.base_price_ars > 0 && <div style={{ fontSize:DS.font.xs, color:T.textSm, textDecoration:"line-through", fontVariantNumeric:"tabular-nums" }}>{fmtARS(p.base_price_ars)}</div>}
                      </div>
                      <div>
                        <div style={label}>Activas</div>
                        <div style={{ fontSize:17, fontWeight:800, color: st.active ? T.text : T.textSm, fontVariantNumeric:"tabular-nums" }}>{fmtN(st.active)}</div>
                      </div>
                      <div style={{ minWidth:0 }}>
                        <div style={label}>Por mes</div>
                        <div style={{ fontSize:17, fontWeight:800, color: st.mrr ? T.text : T.textSm, letterSpacing:-0.4, fontVariantNumeric:"tabular-nums" }}>{fmtARS(st.mrr)}</div>
                      </div>
                    </div>

                    {/* Participación en el ingreso recurrente */}
                    <div title={`${share}% del ingreso recurrente de todos los planes`}>
                      <div style={{ display:"flex", justifyContent:"space-between", fontSize:DS.font.xs, color:T.textSm, marginBottom:5 }}>
                        <span>Del ingreso recurrente</span><span style={{ fontWeight:700, color:T.textMd, fontVariantNumeric:"tabular-nums" }}>{share}%</span>
                      </div>
                      <div style={{ height:5, background:T.border, borderRadius:99, overflow:"hidden" }}>
                        <div style={{ width:`${share}%`, height:"100%", background:T.accentSolid, borderRadius:99 }}/>
                      </div>
                    </div>

                    <div style={{ display:"flex", gap:6 }}>
                      <Btn T={T} variant="secondary" size="sm" onClick={()=>setEditor({ plan: p })} style={{ flex:1, justifyContent:"center" }}>Editar</Btn>
                      {manualPlan
                        ? <Btn T={T} variant="secondary" size="sm" onClick={()=>setLinkFor(p)} style={{ flex:1, justifyContent:"center" }}>🔗 Link</Btn>
                        : esTiendanube
                          ? <BotonBloqueTn T={T} plan={p} onDone={loadAll}/>
                          : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}

      {linkFor && <SubscriptionLinkModal plan={linkFor} merchant={merchant} profile={profile} onClose={()=>setLinkFor(null)}/>}
      {justCreated && (
        <Modal T={T} title="Tu plan quedó guardado, sin publicar" onClose={()=>setJustCreated(null)} maxWidth={460}
          footer={
            <div style={{ display:"flex", gap:8, justifyContent:"flex-end", flexWrap:"wrap" }}>
              <Btn T={T} variant="secondary" onClick={()=>setJustCreated(null)}>Después lo veo</Btn>
              <Btn T={T} variant="solid" onClick={()=>{ setJustCreated(null); goSub("widget"); }}>Elegir el diseño →</Btn>
            </div>
          }>
          {/* 22-sept-2026, Thiago: "me da miedo que ya se ponga cuando todavía
              no estoy mirando la tienda". El plan nace apagado y se publica
              cuando él quiere. */}
          <p style={{ margin:0, fontSize:DS.font.base, color:T.textMd, lineHeight:1.6 }}>
            <strong style={{color:T.text}}>{justCreated.product_title || "Tu plan"}</strong> todavía
            <strong style={{color:T.text}}> no se ve en tu tienda</strong>: la página de ese producto sigue exactamente como está hoy.
          </p>
          <p style={{ margin:"10px 0 0", fontSize:DS.font.base, color:T.textMd, lineHeight:1.6 }}>
            Elegí el diseño y los textos en <strong style={{color:T.text}}>Widget</strong>, mirá cómo queda en la vista previa, y
            cuando estés conforme tocá <strong style={{color:T.text}}>Publicar en mi tienda</strong> en el menú del plan.
          </p>
          <div style={{ marginTop:14 }}>
            <Btn T={T} variant="secondary" size="sm" onClick={()=>{ const p = justCreated; setJustCreated(null); publishPlan(p); }}>
              Publicar ahora
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Alias para el Dashboard (import histórico).
export const PlansTab = PlansPage;

// ── Tiendanube: poner o sacar el bloque de suscripción ──────────────────────
// Tiendanube solo inyecta scripts de apps aprobadas, y cerró las vías nativas
// para pegar uno a mano (ver Guía → Poner el widget en tu Tiendanube). Pero sí
// acepta HTML con estilos en línea en la descripción del producto, y tenemos
// permiso de escritura: el bloque lo ponemos nosotros, el comerciante no toca
// código. Al sacarlo, su descripción queda exactamente como estaba.
function BotonBloqueTn({ T, plan, onDone }) {
  const [busy, setBusy] = useState(false);
  const puesto = Boolean(plan.tiendanube_block_at);

  async function toggle() {
    if (puesto) {
      const ok = await appConfirm("Sacamos el bloque de suscripción de la descripción del producto. Tu descripción queda como estaba.", { title: "¿Sacar de la tienda?", okLabel: "Sacar" });
      if (!ok) return;
    }
    setBusy(true);
    const d = await apiPost("shopify", { plan_id: plan.id, on: !puesto }, { action: "tn-block" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    toast(puesto ? "Lo sacamos del producto" : "Listo: ya se ve en la página del producto", "success");
    onDone?.();
  }

  // Re-aplica el bloque con los datos actuales del plan (precio, descuento,
  // frecuencia). El endpoint hace upsert, así que no duplica.
  async function actualizar() {
    setBusy(true);
    const d = await apiPost("shopify", { plan_id: plan.id, on: true }, { action: "tn-block" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    toast("Bloque actualizado en la página del producto", "success");
    onDone?.();
  }

  if (!puesto) {
    return (
      <Btn T={T} variant="primary" size="sm" disabled={busy} onClick={toggle} style={{ flex:1, justifyContent:"center" }}
        title="Mostrar la suscripción en la página del producto">
        {busy ? "Guardando…" : "Poner en la tienda"}
      </Btn>
    );
  }
  return (
    <div style={{ flex:1, display:"flex", gap:4, minWidth:0 }}>
      <Btn T={T} variant="secondary" size="sm" disabled={busy} onClick={toggle} style={{ flex:1, justifyContent:"center" }}
        title="Sacar el bloque de la descripción del producto">
        {busy ? "Guardando…" : "✓ En la tienda"}
      </Btn>
      <Btn T={T} variant="secondary" size="sm" disabled={busy} onClick={actualizar} title="Volver a generar el bloque con el precio y la frecuencia actuales del plan">↻</Btn>
    </div>
  );
}

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

// Link de suscripción de un plan (negocios sin tienda): copiar, abrir, WhatsApp.
export function SubscriptionLinkModal({ plan, merchant, profile, onClose }) {
  const T = useT();
  return (
    <Modal T={T} open onClose={onClose} title="Link de suscripción" subtitle={plan?.product_title} width={620}
      footer={<Btn T={T} variant="secondary" onClick={onClose}>Listo</Btn>}>
      <div style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.6, marginBottom:14 }}>
        Compartí este link donde estén tus {profile?.vocab?.customers || "clientes"}: bio de Instagram, WhatsApp, mails, tu web o impreso como QR en el mostrador. Quien entra deja sus datos, paga con {profile?.providerInfo?.label || "Mercado Pago"} y queda suscripto.
      </div>
      <SubscriptionLinkBox T={T} merchantId={merchant?.id} planId={plan?.id} title={plan?.product_title}/>
      <Callout T={T} tone="info" style={{ marginTop:14 }}>{TIPS.subscriptionLink}</Callout>
    </Modal>
  );
}
