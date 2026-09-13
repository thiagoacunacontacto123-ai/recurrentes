import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { apiGet, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Field, InputStyle, Btn, DSToggle, Callout, toast } from "../ui/components.jsx";
import { BUNDLE_VARIANTS, renderBundle } from "../../shared/bundle/templates.js";
import { buildBundleVM } from "../../shared/bundle/viewmodel.js";
import PacksEditor, { pricingModeOf, packsFromPlan, autoPacks, validatePacks, serializePacks } from "./PacksEditor.jsx";
import { WidgetDesignTip } from "./Onboarding.jsx";

// Diseñador del selector de packs (widget bundle). Renderiza las variantes
// REALES de shared/bundle/templates.js en iframes aislados del tema del
// dashboard y guarda la config visual en el merchant (save-settings).

export const DEFAULT_WIDGET_TEXTS = {
  headline: "Elegí tu pack",
  once_label: "Compra única",
  sub_label: "Suscripción",
  cta_once: "Agregar al carrito",
  cta_sub: "Suscribirme",
  savings_label: "Ahorrás {pct}%",
  per_unit_label: "{price} c/u",
  freq_prefix: "Te llega cada",
  trust_lines: ["Cancelás cuando quieras", "Envío a todo el país"],
};

const TEXT_FIELDS = [
  ["headline", "Título"],
  ["once_label", "Etiqueta compra única"],
  ["sub_label", "Etiqueta suscripción"],
  ["cta_once", "Botón compra única"],
  ["cta_sub", "Botón suscripción"],
  ["savings_label", "Ahorro ({pct} = %)"],
  ["per_unit_label", "Por unidad ({price} = precio)"],
  ["freq_prefix", "Prefijo de frecuencia"],
];

// ── Ayuda de los desarrolladores por WhatsApp ────────────────────────
export const DEV_WHATSAPP = "5491164117974";

export function devWhatsAppUrl(merchant) {
  const m = merchant || {};
  const who = m.store_name || m.shopify_shop || m.email || "una tienda";
  const text = "Hola! Soy " + who + " y quiero que me vinculen el selector de packs de Recurrentes en mi tienda.";
  return `https://wa.me/${DEV_WHATSAPP}?text=${encodeURIComponent(text)}`;
}

const WA_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.8-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5-.1-.2-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.2-.3-.3-.6-.4zM12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>
);

// Botón verde "Escribir por WhatsApp" (abre en pestaña nueva).
export function WhatsAppBtn({ merchant, children = "Escribir por WhatsApp", size = "md", style = {} }) {
  const pad = size === "sm" ? "6px 12px" : "10px 16px";
  const fs = size === "sm" ? DS.font.sm : DS.font.base;
  return (
    <a href={devWhatsAppUrl(merchant)} target="_blank" rel="noopener noreferrer" className="gh-clickable"
      style={{display:"inline-flex",alignItems:"center",gap:7,background:"#25D366",color:"#fff",border:"1px solid #1ebe5d",borderRadius:DS.r.md,padding:pad,fontSize:fs,fontWeight:DS.w.semibold,textDecoration:"none",whiteSpace:"nowrap",boxShadow:"0 4px 14px rgba(37,211,102,0.30)",letterSpacing:"0.01em",...style}}>
      {WA_ICON}{children}
    </a>
  );
}

// Card de ayuda reutilizable (diseñador del widget y tab Planes).
// context: "widget" | "plans" — solo informativo (data-attr).
export function DevHelpCard({ merchant, context = "widget", style = {} }) {
  const T = useT();
  return (
    <Card T={T} className={`rc-devhelp rc-devhelp-${context}`} style={{marginTop:20,borderColor:"#25D36655",background:`linear-gradient(135deg, ${T.card}, ${T.greenBg})`,...style}}>
      <div style={{display:"flex",gap:14,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{width:44,height:44,borderRadius:DS.r.lg,background:"#25D36622",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>🛠️</div>
        <div style={{flex:1,minWidth:220}}>
          <div style={{fontSize:DS.font.lg,fontWeight:DS.w.bold,color:T.text,letterSpacing:-0.2}}>¿No te convence ninguno o no sabés configurarlo?</div>
          <div style={{fontSize:DS.font.sm,color:T.textSm,lineHeight:1.5,marginTop:2}}>Hablá con los desarrolladores y te lo vinculan como quieras en tu tienda en 10 minutos, sin costo en la beta.</div>
        </div>
        <WhatsAppBtn merchant={merchant}/>
      </div>
    </Card>
  );
}

// Plan de ejemplo cuando el merchant no tiene ninguno en modo packs.
export const SAMPLE_PLAN = {
  id: "sample",
  product_title: "Producto de ejemplo",
  pricing_mode: "packs",
  base_price_ars: 44990,
  discount_pct: 10,
  frequency_days: 60,
  frequency_scales_with_qty: true,
  packs: [
    { qty: 1, price_ars: 44990, compare_at_ars: null, label: "1 unidad", badge: null, frequency_days: null, sub_price_ars: null, default: false },
    { qty: 2, price_ars: 59990, compare_at_ars: null, label: "2 unidades", badge: "Más elegido", frequency_days: null, sub_price_ars: null, default: true },
    { qty: 3, price_ars: 74990, compare_at_ars: null, label: "3 unidades", badge: "Mejor precio", frequency_days: null, sub_price_ars: null, default: false },
  ],
};

function normTexts(t) {
  const src = t && typeof t === "object" ? t : {};
  const out = { ...DEFAULT_WIDGET_TEXTS, ...src };
  out.trust_lines = Array.isArray(src.trust_lines) ? src.trust_lines.slice(0, 4).map(s => String(s || "")) : [...DEFAULT_WIDGET_TEXTS.trust_lines];
  return out;
}

function defaultIdx(vm) {
  const i = (vm?.packs || []).findIndex(p => p.isDefault);
  return i >= 0 ? i : 0;
}

// Documento base del iframe: una sola vez; después se escribe html/css adentro
// para no recargar el frame (y no perder el foco / parpadear) en cada cambio.
const FRAME_DOC = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style id="rc-base">html,body{margin:0;padding:0;background:transparent}body{font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;padding:6px;box-sizing:border-box}*{box-sizing:border-box}</style>
<style id="rc-css"></style></head><body><div id="rc-root"></div></body></html>`;

// Vista previa aislada. interactive=true delega clicks en data-rc-action.
export function BundleFrame({ html, css, interactive = false, onAction, minHeight = 120, style = {} }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState(minHeight);
  const onActionRef = useRef(onAction);
  onActionRef.current = onAction;

  const measure = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc || !doc.body) return;
    const h = Math.max(minHeight, Math.ceil(doc.documentElement.scrollHeight || doc.body.scrollHeight || 0));
    setHeight(h);
  }, [minHeight]);

  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    if (interactive) {
      doc.addEventListener("click", (e) => {
        const el = e.target && e.target.closest ? e.target.closest("[data-rc-action]") : null;
        if (!el) return;
        e.preventDefault();
        onActionRef.current?.(el.getAttribute("data-rc-action"), el.getAttribute("data-rc-value"));
      });
    }
    setReady(true);
  }, [interactive]);

  useEffect(() => {
    if (!ready) return;
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    const cssEl = doc.getElementById("rc-css");
    const root = doc.getElementById("rc-root");
    if (cssEl) cssEl.textContent = css || "";
    if (root) root.innerHTML = html || "";
    if (!interactive) { doc.body.style.pointerEvents = "none"; doc.body.style.userSelect = "none"; }
    measure();
    const t1 = setTimeout(measure, 60);
    const t2 = setTimeout(measure, 400);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [ready, html, css, interactive, measure]);

  useEffect(() => {
    if (!ready || typeof ResizeObserver === "undefined") return;
    const doc = ref.current?.contentDocument;
    if (!doc?.body) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(doc.body);
    return () => ro.disconnect();
  }, [ready, measure]);

  return (
    <iframe
      ref={ref}
      title="Vista previa del selector"
      srcDoc={FRAME_DOC}
      onLoad={onLoad}
      sandbox="allow-same-origin"
      scrolling="no"
      style={{ width:"100%", border:"none", display:"block", height, background:"transparent", pointerEvents: interactive ? "auto" : "none", ...style }}
    />
  );
}

function safeRender(vm, state) {
  try { return renderBundle(vm, state) || { html: "", css: "" }; }
  catch (e) { return { html: `<div style="font:12px/1.4 system-ui;color:#b91c1c;padding:8px">No se pudo renderizar: ${String(e?.message || e)}</div>`, css: "" }; }
}

function safeVM(plan, merchant) {
  try { return buildBundleVM({ plan, merchant }); }
  catch (e) { return { variant: merchant?.widget_variant || "v01", packs: [], texts: normTexts(merchant?.widget_texts), _error: e?.message || String(e) }; }
}

export default function WidgetDesigner({ merchant, plans = [], onSaved, onPlansChanged }) {
  const T = useT();
  const inputS = InputStyle(T);
  const m = merchant || {};

  // ── borrador ──────────────────────────────────────────────────────────
  const [variant, setVariant] = useState(m.widget_variant || "v01");
  const [color, setColor] = useState(m.widget_color || "#10b981");
  const [radius, setRadius] = useState(Number.isFinite(+m.widget_radius) ? +m.widget_radius : 14);
  const [texts, setTexts] = useState(() => normTexts(m.widget_texts));
  const [showCompare, setShowCompare] = useState(m.widget_show_compare !== false);
  const [showPerUnit, setShowPerUnit] = useState(m.widget_show_per_unit !== false);
  const [modeDefault, setModeDefault] = useState(m.widget_mode_default || "sub");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVariant(m.widget_variant || "v01");
    setColor(m.widget_color || "#10b981");
    setRadius(Number.isFinite(+m.widget_radius) ? +m.widget_radius : 14);
    setTexts(normTexts(m.widget_texts));
    setShowCompare(m.widget_show_compare !== false);
    setShowPerUnit(m.widget_show_per_unit !== false);
    setModeDefault(m.widget_mode_default || "sub");
    // eslint-disable-next-line
  }, [m.id]);

  // ── planes (copia local: al guardar packs los recargamos acá mismo) ────
  const [plansState, setPlansState] = useState(() => Array.isArray(plans) ? plans : []);
  useEffect(() => { setPlansState(Array.isArray(plans) ? plans : []); }, [plans]);
  const activePlans = useMemo(() => plansState.filter(p => p && p.active !== false), [plansState]);
  const packPlans = useMemo(() => activePlans.filter(p => pricingModeOf(p) === "packs" && Array.isArray(p.packs) && p.packs.length > 0), [activePlans]);

  // Plan seleccionado: id real o "sample". Default: primero en packs → primero activo → ejemplo.
  const [planId, setPlanId] = useState(null);
  useEffect(() => {
    if (planId === "sample" || activePlans.some(p => p.id === planId)) return;
    setPlanId(packPlans[0]?.id || activePlans[0]?.id || "sample");
  }, [activePlans, packPlans, planId]);
  const selectedPlan = planId && planId !== "sample" ? (activePlans.find(p => p.id === planId) || null) : null;
  const selMode = selectedPlan ? pricingModeOf(selectedPlan) : null;

  // ── borrador de packs del plan seleccionado ───────────────────────────
  const [rows, setRows] = useState([]);
  const [discount, setDiscount] = useState("");
  const [freqScales, setFreqScales] = useState(true);
  const [packsOn, setPacksOn] = useState(false);   // plan en modo tema → tocó "Pasar a packs"
  const [dirty, setDirty] = useState(false);
  const [savingPacks, setSavingPacks] = useState(false);
  const draftKey = selectedPlan ? `${selectedPlan.id}|${selectedPlan.updated_at || ""}` : "none";
  useEffect(() => {
    if (!selectedPlan) { setRows([]); setDiscount(""); setFreqScales(true); setPacksOn(false); setDirty(false); return; }
    setRows(packsFromPlan(selectedPlan));
    setDiscount(String(selectedPlan.discount_pct ?? 0));
    setFreqScales(selectedPlan.frequency_scales_with_qty !== false);
    setPacksOn(pricingModeOf(selectedPlan) === "packs");
    setDirty(false);
    // eslint-disable-next-line
  }, [draftKey]);

  const unitPackPrice = (p) => { const u = (p?.packs || []).find(k => Number(k.qty) === 1); return u ? Number(u.price_ars) || 0 : 0; };
  const basePrice = selectedPlan ? (Number(selectedPlan.base_price_ars) > 0 ? Number(selectedPlan.base_price_ars) : unitPackPrice(selectedPlan)) : 0;
  const draftPacks = useMemo(() => serializePacks(rows), [rows]);
  const discountNum = Math.max(0, Math.min(80, parseInt(discount, 10) || 0));

  const changeRows = (r) => { setRows(r); setDirty(true); };
  const changeDiscount = (v) => { setDiscount(v); setDirty(true); };
  const changeFreqScales = (v) => { setFreqScales(v); setDirty(true); };
  function switchToPacks() {
    setPacksOn(true);
    if (!rows.length && basePrice > 0) setRows(autoPacks(basePrice));
    setDirty(true);
  }

  async function savePacks() {
    if (!selectedPlan) return;
    const err = validatePacks(rows);
    if (err) { toast(err, "warning", 5000); return; }
    setSavingPacks(true);
    const payload = {
      pricing_mode: "packs",
      packs: serializePacks(rows),
      frequency_scales_with_qty: freqScales !== false,
      discount_pct: discountNum,
    };
    const d = await apiPatch("plans", payload, { id: selectedPlan.id });
    if (d?.error) { setSavingPacks(false); toast("Error: " + d.error, "error", 6000); return; }
    // Recargar planes y refrescar la vista previa con los packs reales.
    const fresh = await apiGet("plans").catch(() => null);
    const list = Array.isArray(fresh?.plans) ? fresh.plans : null;
    if (list) { setPlansState(list); onPlansChanged?.(list); }
    else if (d?.plan) setPlansState(ps => ps.map(p => p.id === selectedPlan.id ? { ...p, ...d.plan } : p));
    setSavingPacks(false);
    setDirty(false);
    toast("Packs guardados · en tu tienda en ~5 min", "success");
    if (d?.note) toast(d.note, "warning", 5000);
  }

  // ── plan de la vista previa: refleja el borrador ANTES de guardar ─────
  const previewPlan = useMemo(() => {
    if (!selectedPlan) return SAMPLE_PLAN;
    const base = { ...selectedPlan, pricing_mode: "packs", discount_pct: discountNum, frequency_scales_with_qty: freqScales !== false };
    if (draftPacks.length) return { ...base, packs: draftPacks };
    return { ...base, packs: SAMPLE_PLAN.packs, _samplePacks: true };
  }, [selectedPlan, draftPacks, discountNum, freqScales]);
  const usingSample = previewPlan === SAMPLE_PLAN;
  const samplePacks = usingSample || previewPlan._samplePacks === true;

  const draftMerchant = useMemo(() => ({
    ...m,
    widget_variant: variant,
    widget_color: color,
    widget_radius: radius,
    widget_texts: texts,
    widget_show_compare: showCompare,
    widget_show_per_unit: showPerUnit,
    widget_mode_default: modeDefault,
  }), [m, variant, color, radius, texts, showCompare, showPerUnit, modeDefault]);

  const vm = useMemo(() => safeVM(previewPlan, draftMerchant), [previewPlan, draftMerchant]);

  // ── estado interactivo de la vista previa grande ──────────────────────
  const [pvState, setPvState] = useState({ mode: modeDefault, selectedIdx: 0 });
  useEffect(() => { setPvState(s => ({ ...s, mode: modeDefault })); }, [modeDefault]);
  useEffect(() => { setPvState(s => ({ ...s, selectedIdx: defaultIdx(vm) })); }, [previewPlan?.id]); // eslint-disable-line
  const onAction = useCallback((action, value) => {
    if (action === "mode" && (value === "sub" || value === "once")) setPvState(s => ({ ...s, mode: value }));
    else if (action === "pack") setPvState(s => ({ ...s, selectedIdx: Math.max(0, parseInt(value, 10) || 0) }));
    else if (action === "cta") toast(pvState.mode === "sub" ? "En la tienda: va al checkout de suscripción" : "En la tienda: agrega al carrito", "success");
  }, [pvState.mode]);
  const pvSafe = useMemo(() => ({ ...pvState, selectedIdx: Math.min(pvState.selectedIdx, Math.max(0, (vm?.packs?.length || 1) - 1)) }), [pvState, vm]);
  const big = useMemo(() => safeRender(vm, pvSafe), [vm, pvSafe]);

  // Galería: cada variante con el mismo vm pero su propio id.
  const galleryIdx = defaultIdx(vm);
  const gallery = useMemo(() => (BUNDLE_VARIANTS || []).map(v => ({ ...v, ...safeRender({ ...vm, variant: v.id }, { mode: "sub", selectedIdx: galleryIdx }) })), [vm, galleryIdx]);

  // ── guardar ───────────────────────────────────────────────────────────
  async function save() {
    const colorOk = /^#[0-9a-f]{6}$/i.test(color.trim());
    if (!colorOk) { toast("El color tiene que ser #RRGGBB", "error"); return; }
    setSaving(true);
    // 1) Config del selector de packs → save-settings (parcial: solo estas claves).
    const payload = {
      widget_variant: variant,
      widget_radius: Math.max(0, Math.min(32, Math.round(radius))),
      widget_texts: { ...texts, trust_lines: texts.trust_lines.map(s => s.trim()).filter(Boolean).slice(0, 4) },
      widget_show_compare: !!showCompare,
      widget_show_per_unit: !!showPerUnit,
    };
    const d = await apiPatch("merchant", payload, { action: "save-settings" });
    if (d?.error) { setSaving(false); toast("Error: " + d.error, "error", 6000); return; }
    // 2) Color y modo por defecto viven en save-widget-settings, que pisa TODO
    //    lo que no se manda → reenviamos los demás valores actuales del merchant.
    if (color.trim() !== (m.widget_color || "#10b981") || modeDefault !== (m.widget_mode_default || "sub")) {
      const w = await apiPatch("merchant", {
        widget_mode_order: m.widget_mode_order || "sub_first",
        widget_mode_default: modeDefault,
        widget_color: color.trim(),
        widget_sub_title: m.widget_sub_title || "Suscripción",
        widget_sub_subtitle: m.widget_sub_subtitle || "",
        widget_once_title: m.widget_once_title || "Compra única",
        widget_once_subtitle: m.widget_once_subtitle || "Comprá una vez al precio normal.",
        widget_disclaimer_text: m.widget_disclaimer_text || "",
      }, { action: "save-widget-settings" });
      if (w?.error) { setSaving(false); toast("Diseño guardado, pero falló color/modo: " + w.error, "error", 6000); onSaved?.(); return; }
    }
    setSaving(false);
    toast("Diseño del selector guardado", "success");
    onSaved?.();
  }
  function resetTexts() { setTexts(normTexts(null)); toast("Textos restablecidos (guardá para aplicar)", "success"); }
  const setText = (k, v) => setTexts(t => ({ ...t, [k]: v }));
  const setTrust = (i, v) => setTexts(t => { const arr = [...t.trust_lines]; arr[i] = v; return { ...t, trust_lines: arr }; });

  const selectedVariant = (BUNDLE_VARIANTS || []).find(v => v.id === variant);
  // Cuenta vinculada a mano por los devs (beta legada o integración a medida) con el plan en modo tema.
  const externallyLinked = !!selectedPlan && selMode === "theme" && (m.billing?.plan === "beta" || m.custom_integration === true);
  // La galería recién aplica cuando haya algún plan en modo packs.
  const galleryPending = !!selectedPlan && selMode === "theme" && packPlans.length === 0;
  const sectionH = { fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, marginBottom:8, letterSpacing:-0.2 };
  const small = { fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 };
  const goPlans = () => { try { window.location.hash = "#/dashboard/planes"; } catch (_) {} };

  return (
    <div>
      {externallyLinked && (
        <Callout T={T} tone="info" style={{marginBottom:14}} right={<WhatsAppBtn merchant={m} size="sm"/>}>
          Tu tienda está vinculada de manera externa por los desarrolladores. El selector que ves en tu producto es un desarrollo a medida; cualquier cambio pedilo por WhatsApp.
        </Callout>
      )}
      {vm?._error && (
        <Callout T={T} tone="danger" style={{marginBottom:14}}>No se pudo armar la vista previa: {vm._error}</Callout>
      )}

      {/* ── Tus packs (editor inline del plan seleccionado) ───────────── */}
      <Card T={T} style={{marginBottom:16}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap",marginBottom:activePlans.length ? 12 : 6}}>
          <div style={{flex:1,minWidth:200}}>
            <div style={sectionH}>Tus packs</div>
            <div style={small}>Lo que cargás acá se ve al instante en la vista previa. Guardá para publicarlo en tu tienda.</div>
          </div>
          {activePlans.length > 0 && (
            <select value={selectedPlan ? selectedPlan.id : "sample"} onChange={e=>setPlanId(e.target.value)} style={{...inputS,width:"auto",maxWidth:260,padding:"7px 10px",fontSize:12}}>
              {activePlans.map(p => <option key={p.id} value={p.id}>{p.product_title}{pricingModeOf(p) === "theme" ? " · precio del tema" : ""}</option>)}
              <option value="sample">Datos de ejemplo</option>
            </select>
          )}
        </div>

        {activePlans.length === 0 ? (
          <div style={{display:"flex",gap:12,alignItems:"center",flexWrap:"wrap",padding:"12px 14px",background:T.surface,border:`1px dashed ${T.border}`,borderRadius:DS.r.lg}}>
            <div style={{flex:1,minWidth:200}}>
              <div style={{fontSize:DS.font.base,fontWeight:DS.w.bold,color:T.text}}>Todavía no tenés planes</div>
              <div style={small}>Un plan convierte un producto de tu tienda en suscripción. Los packs se cargan sobre un plan.</div>
            </div>
            <Btn T={T} variant="solid" type="button" onClick={goPlans}>Creá tu primer plan</Btn>
          </div>
        ) : !selectedPlan ? (
          <div style={small}>Estás viendo datos de ejemplo. Elegí un plan arriba para cargar sus packs.</div>
        ) : (selMode === "theme" && !packsOn) ? (
          <Callout T={T} tone="warning" right={<Btn T={T} variant="solid" size="sm" type="button" onClick={switchToPacks}>Pasar a packs</Btn>}>
            Este plan hoy toma el precio desde el tema de tu tienda. Al guardar packs acá, el widget pasa a mostrar este selector.
          </Callout>
        ) : (
          <div>
            {selMode === "theme" && (
              <Callout T={T} tone="info" style={{marginBottom:12}}>El plan sigue en modo tema hasta que toques "Guardar packs".</Callout>
            )}
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:"0 12px",alignItems:"end"}}>
              <Field T={T} label="% de descuento por suscripción">
                <input type="number" min="0" max="80" value={discount} onChange={e=>changeDiscount(e.target.value)} style={inputS}/>
              </Field>
              <div style={{...small,marginBottom:14}}>
                Precio base <strong style={{color:T.text}}>{basePrice > 0 ? "$" + Math.round(basePrice).toLocaleString("es-AR") : "—"}</strong> · frecuencia cada <strong style={{color:T.text}}>{selectedPlan.frequency_days || 30} días</strong>
                <span> · se cambian desde Planes → Editar.</span>
              </div>
            </div>
            <PacksEditor
              compact mode="packs" radioName="rc-wd-pack-default"
              packs={rows} onPacksChange={changeRows}
              basePrice={basePrice} discountPct={discount} frequencyDays={selectedPlan.frequency_days || 30}
              freqScales={freqScales} onFreqScalesChange={changeFreqScales}
            />
            <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginTop:12}}>
              <Btn T={T} variant="solid" type="button" onClick={savePacks} disabled={savingPacks || (!dirty && selMode === "packs")}>{savingPacks ? "Guardando…" : "Guardar packs"}</Btn>
              {dirty
                ? <span style={{...small,color:T.yellow,fontWeight:DS.w.semibold}}>Cambios sin guardar · la vista previa ya los muestra</span>
                : <span style={small}>Se envía a <code style={{fontSize:11}}>PATCH /api/plans?id={selectedPlan.id}</code> en modo packs.</span>}
            </div>
          </div>
        )}
      </Card>

      {/* ── Vista previa grande + panel ─────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:16,alignItems:"start"}}>
        <Card T={T} style={{position:"sticky",top:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={sectionH}>Vista previa</div>
              <div style={small}>{selectedVariant ? `${selectedVariant.name} · ${selectedVariant.id}` : variant} · tocá los packs y el toggle</div>
            </div>
            <div style={{fontSize:12,color:T.textMd,fontWeight:DS.w.semibold,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={selectedPlan ? selectedPlan.product_title : "Datos de ejemplo"}>{selectedPlan ? selectedPlan.product_title : "Datos de ejemplo"}</div>
          </div>
          {usingSample && <div style={{...small,marginBottom:8}}>Datos de ejemplo: 3 packs (44.990 / 59.990 / 74.990, 10% off, cada 60 días).</div>}
          {!usingSample && samplePacks && <div style={{...small,marginBottom:8}}>Este plan todavía no tiene packs: mostramos 3 de ejemplo hasta que cargues los tuyos arriba.</div>}
          {!usingSample && !samplePacks && dirty && <div style={{...small,marginBottom:8,color:T.yellow}}>Mostrando tus packs sin guardar.</div>}
          <div style={{background:"#fff",borderRadius:12,border:`1px solid ${T.border}`,padding:10,maxWidth:440,margin:"0 auto"}}>
            <BundleFrame html={big.html} css={big.css} interactive onAction={onAction} minHeight={200}/>
          </div>
          <div style={{...small,marginTop:8,textAlign:"center"}}>Modo: <strong>{pvState.mode === "sub" ? texts.sub_label : texts.once_label}</strong> · pack #{pvState.selectedIdx + 1}</div>
        </Card>

        <Card T={T}>
          <div style={sectionH}>Personalización</div>

          <Field T={T} label="Color de acento">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#10b981"} onChange={e=>setColor(e.target.value)} style={{width:44,height:36,border:`1px solid ${T.border}`,borderRadius:8,padding:2,background:"transparent",cursor:"pointer"}}/>
              <input type="text" value={color} onChange={e=>setColor(e.target.value)} style={{...inputS,maxWidth:130,fontFamily:"monospace",fontSize:12}} placeholder="#10b981"/>
              <div style={{flex:1,height:36,borderRadius:8,background:color}}/>
            </div>
          </Field>

          <Field T={T} label={`Radio de bordes · ${radius}px`}>
            <input type="range" min="0" max="32" step="1" value={radius} onChange={e=>setRadius(parseInt(e.target.value,10)||0)} style={{width:"100%",accentColor:T.accentSolid}}/>
          </Field>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field T={T} label="Modo por defecto">
              <select value={modeDefault} onChange={e=>setModeDefault(e.target.value)} style={inputS}>
                <option value="sub">Suscripción</option>
                <option value="once">Compra única</option>
              </select>
            </Field>
            <div style={{display:"flex",flexDirection:"column",gap:10,paddingTop:2}}>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,fontSize:12,color:T.textMd}}>Precio tachado <DSToggle T={T} active={showCompare} onToggle={()=>setShowCompare(v=>!v)}/></label>
              <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,fontSize:12,color:T.textMd}}>Precio por unidad <DSToggle T={T} active={showPerUnit} onToggle={()=>setShowPerUnit(v=>!v)}/></label>
            </div>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"6px 0 8px"}}>
            <div style={{fontSize:12,fontWeight:700,color:T.text}}>Textos</div>
            <Btn T={T} variant="secondary" size="sm" type="button" onClick={resetTexts}>Restablecer textos</Btn>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:"0 10px"}}>
            {TEXT_FIELDS.map(([k, label]) => (
              <Field key={k} T={T} label={label}>
                <input type="text" value={texts[k] ?? ""} onChange={e=>setText(k, e.target.value)} style={inputS} placeholder={DEFAULT_WIDGET_TEXTS[k]} maxLength={80}/>
              </Field>
            ))}
          </div>
          <Field T={T} label="Líneas de confianza (hasta 4)">
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[0,1,2,3].map(i => (
                <input key={i} type="text" value={texts.trust_lines[i] ?? ""} onChange={e=>setTrust(i, e.target.value)} style={inputS} placeholder={DEFAULT_WIDGET_TEXTS.trust_lines[i] || (i === 2 ? "Pausá o cambiá la fecha desde tu portal" : "")} maxLength={80}/>
              ))}
            </div>
          </Field>

          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <Btn T={T} variant="solid" type="button" onClick={save} disabled={saving}>{saving ? "Guardando…" : "Guardar diseño"}</Btn>
            <WidgetDesignTip T={T}/>
            <span style={small}>Visible en la tienda en ~5 min (caché del widget).</span>
          </div>
        </Card>
      </div>

      {/* ── Galería de variantes ────────────────────────────────────── */}
      <div style={{marginTop:20}}>
        <div style={sectionH}>Elegí un diseño</div>
        <div style={{...small,marginBottom:12}}>Vista previa real de cada variante con tus packs y colores. Tocá "Usar este" y después guardá.</div>
        {galleryPending && (
          <Callout T={T} tone="info" style={{marginBottom:12}}>El diseño que elijas se va a aplicar cuando pases el plan a packs (arriba, en "Tus packs").</Callout>
        )}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))",gap:14}}>
          {gallery.map(v => {
            const active = v.id === variant;
            return (
              <div key={v.id} onClick={()=>setVariant(v.id)} className="gh-clickable" style={{background:T.card,border:`2px solid ${active?T.accentSolid:T.border}`,borderRadius:DS.r.xl,overflow:"hidden",cursor:"pointer",boxShadow:active?`0 0 0 4px ${T.accentSolid}26`:"0 1px 2px rgba(0,0,0,0.06), 0 3px 10px rgba(0,0,0,0.04)",transition:"border-color 0.15s, box-shadow 0.15s",display:"flex",flexDirection:"column"}}>
                <div style={{background:"#fff",padding:8,borderBottom:`1px solid ${T.borderL}`,maxHeight:380,overflow:"hidden",position:"relative"}}>
                  <BundleFrame html={v.html} css={v.css} minHeight={160}/>
                  {active && <div style={{position:"absolute",top:8,right:8,background:galleryPending ? T.textSm : T.accentSolid,color:"#fff",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:6,letterSpacing:0.3}}>{galleryPending ? "ELEGIDO" : "EN USO"}</div>}
                </div>
                <div style={{padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text}}>{v.name || v.id} <span style={{fontSize:10,color:T.textSm,fontWeight:500}}>{v.id}</span></div>
                    <div style={{fontSize:11,color:T.textSm,lineHeight:1.45}}>{v.description || ""}</div>
                  </div>
                  <Btn T={T} variant={active ? "primary" : "secondary"} size="sm" type="button" onClick={(e)=>{e.stopPropagation(); setVariant(v.id);}}>{active ? "✓ Elegido" : "Usar este"}</Btn>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DevHelpCard merchant={m} context="widget"/>
    </div>
  );
}
