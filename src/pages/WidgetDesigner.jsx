import { WidgetStatusCard } from "./WidgetVerify.jsx";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Field, InputStyle, Btn, DSToggle, Callout, toast } from "../ui/components.jsx";
import { BUNDLE_VARIANTS, renderBundle } from "../../shared/bundle/templates.js";
import { buildBundleVM } from "../../shared/bundle/viewmodel.js";
import { pricingModeOf } from "./PacksEditor.jsx";
import { WidgetDesignTip } from "./Onboarding.jsx";
import { useOnb } from "../lib/onboarding.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { MONO } from "./_shared.jsx";

// Diseñador del selector de packs (widget bundle) — SOLO diseño global del
// merchant: variante, color, esquinas, textos, orden/modo del toggle e
// instalación del snippet. Los packs se editan en cada plan (PlanEditor).
// Renderiza las variantes REALES de shared/bundle/templates.js en iframes
// aislados del tema del dashboard y guarda todo con merchant?action=save-settings.

export // Sugerencias de las 4 líneas de confianza (solo placeholder: no se guardan).
const TRUST_HINTS = [
  "Cancelás cuando quieras",
  "Envío a todo el país",
  "Pausá o cambiá la fecha desde tu portal",
  "Opcional — escribí otra si querés",
];

const DEFAULT_WIDGET_TEXTS = {
  headline: "Elegí tu pack",
  once_label: "Compra única",
  sub_label: "Suscripción",
  cta_once: "Agregar al carrito",
  cta_sub: "Suscribirme",
  savings_label: "Ahorrás {pct}%",
  per_unit_label: "{price} c/u",
  freq_prefix: "",   // vacío = automático: "Te llegan 2 cada 30 días"
  trust_lines: ["Cancelás cuando quieras", "Envío a todo el país"],
  trust_lines_once: [],
  note_sub: "",
  note_once: "",
  sub_hint: "",
  disc_label: "",
  cta_price: "",
  pack_freq: "",
};

// Los textos, separados por dónde se ven (21-sept-2026, Thiago): lo común, lo
// que solo aparece en suscripción y lo que solo aparece en compra única.
const TEXT_FIELDS = [
  ["headline", "Título"],
  ["savings_label", "Ahorro ({pct} = %)"],
  ["per_unit_label", "Por unidad ({price} = precio)"],
  // Aplica a los dos modos. Una "x" saca el precio del botón. 25-sept-2026.
  ["cta_price", "Precio en el botón (x = sacarlo)"],
];
const TEXT_FIELDS_SUB = [
  ["sub_label", "Etiqueta del modo"],
  ["cta_sub", "Botón"],
  ["freq_prefix", "Prefijo de frecuencia (vacío = automático)"],
  // El renglón chico del cuadro de suscripción cuando está apagado, en los
  // diseños que lo tienen (Foto, Foto + check…). 22-sept-2026, Thiago.
  ["sub_hint", "Renglón del cuadro apagado (vacío = automático)"],
  ["disc_label", "Píldora de descuento ({pct} = el %)"],
  // Una "x" apaga cualquiera de los dos. 25-sept-2026, Thiago.
  ["pack_freq", "Frecuencia dentro del pack (x = sacarla)"],
];
const TEXT_FIELDS_ONCE = [
  ["once_label", "Etiqueta del modo"],
  ["cta_once", "Botón"],
];

// Bloque de textos de UN modo (suscripción o compra única): sus etiquetas, sus
// líneas de confianza y una nota libre. Los dos modos usan el mismo componente
// para que no se desincronicen.
function ModoTextos({ T, titulo, campos, texts, setText, inputS, lineas, campoLineas, setTrust, hints, notaKey, notaPlaceholder }) {
  const arr = Array.isArray(lineas) ? lineas : [];
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:"14px 14px 4px", marginBottom:12, background:T.surface }}>
      <div style={{ fontSize:DS.font.md, fontWeight:DS.w.semibold, color:T.text, marginBottom:10 }}>{titulo}</div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        {campos.map(([k, label]) => (
          <Field key={k} T={T} label={label}>
            <input type="text" value={texts[k] ?? ""} onChange={e=>setText(k, e.target.value)} style={inputS}
              placeholder={k === "freq_prefix" ? "Te llegan 2 cada…" : DEFAULT_WIDGET_TEXTS[k]} maxLength={80}/>
          </Field>
        ))}
      </div>
      <Field T={T} label="Líneas con tilde (hasta 4)">
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {[0,1,2,3].map(i => (
            <input key={i} type="text" value={arr[i] ?? ""} onChange={e=>setTrust(i, e.target.value, campoLineas)}
              style={{ ...inputS, marginBottom:0 }}
              placeholder={arr[i] ? "" : (hints[i] || "Opcional — escribí otra si querés")} maxLength={80}/>
          ))}
        </div>
        <p style={{ margin:"6px 0 0", fontSize:DS.font.sm, color:T.textSm, lineHeight:1.45 }}>
          Aparecen con un tilde debajo del botón. Las vacías no se muestran.
        </p>
      </Field>
      <Field T={T} label="Texto libre debajo">
        <input type="text" value={texts[notaKey] ?? ""} onChange={e=>setText(notaKey, e.target.value)}
          style={inputS} placeholder={notaPlaceholder} maxLength={200}/>
      </Field>
    </div>
  );
}

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

// Card de ayuda (se muestra UNA sola vez: al pie de Planes → Widget).
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
  // Compra única arranca sin líneas: si no las carga, se ve como siempre.
  out.trust_lines_once = Array.isArray(src.trust_lines_once) ? src.trust_lines_once.slice(0, 4).map(s => String(s || "")) : [];
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
    // OJO: documentElement.scrollHeight en un iframe nunca baja del alto del
    // propio iframe, así que con eso el marco solo podía crecer (en celular
    // quedaba ~1000 px de blanco después de un layout angosto). Medimos el
    // contenido real: #rc-root + el padding del body.
    const root = doc.getElementById("rc-root");
    const pad = 12; // body{padding:6px} arriba y abajo (FRAME_DOC)
    const content = root ? Math.ceil(root.getBoundingClientRect().height + pad) : 0;
    const h = Math.max(minHeight, content || Math.ceil(doc.body.scrollHeight || 0));
    setHeight(h);
  }, [minHeight]);

  const onLoad = useCallback(() => {
    const doc = ref.current?.contentDocument;
    if (!doc) return;
    if (interactive) {
      // En el celular el `click` dentro del iframe llega tarde o no llega: el
      // navegador espera a descartar que el toque sea un scroll o un doble tap
      // (22-sept-2026, Thiago: "en celular no funciona tocarlo"). Así que se
      // escucha el TOQUE y se resuelve ahí mismo; el click posterior se ignora
      // para no ejecutar la acción dos veces.
      let ultimoToque = 0;
      const disparar = (el) => {
        onActionRef.current?.(el.getAttribute("data-rc-action"), el.getAttribute("data-rc-value"));
      };
      const blanco = (e) => {
        const t = e.target;
        return t && t.closest ? t.closest("[data-rc-action]") : null;
      };
      // Dónde empezó el dedo: si se movió, fue scroll y no se cuenta como toque.
      let desde = null;
      doc.addEventListener("touchstart", (e) => {
        const t = e.touches && e.touches[0];
        desde = t ? { x: t.clientX, y: t.clientY, el: blanco(e) } : null;
      }, { passive: true });
      doc.addEventListener("touchend", (e) => {
        const ini = desde; desde = null;
        if (!ini || !ini.el) return;
        const t = e.changedTouches && e.changedTouches[0];
        if (t && Math.hypot(t.clientX - ini.x, t.clientY - ini.y) > 12) return; // arrastró: era scroll
        e.preventDefault();
        ultimoToque = Date.now();
        disparar(ini.el);
      });
      doc.addEventListener("click", (e) => {
        if (Date.now() - ultimoToque < 700) return;   // ya lo resolvió el toque
        const el = blanco(e);
        if (!el) return;
        e.preventDefault();
        disparar(el);
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
    // También el iframe en sí: al cambiar su ancho (rotar el celular, columna
    // que se estira) el contenido reflowa y hay que remedir al instante.
    if (ref.current) ro.observe(ref.current);
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

// Vista previa interactiva (toggle sub/única + click en packs) de UN plan con el
// diseño de UN merchant. La usan el diseñador (diseño global) y el PlanEditor
// (borrador del plan). `plan` puede ser un borrador sin guardar.
export function BundlePreview({ plan, merchant, minHeight = 200, maxWidth = 440, footer = true, style = {} }) {
  const T = useT();
  const vm = useMemo(() => safeVM(plan, merchant), [plan, merchant]);
  const modeDefault = merchant?.widget_mode_default === "once" ? "once" : "sub";
  const [pv, setPv] = useState({ mode: modeDefault, selectedIdx: defaultIdx(vm) });
  useEffect(() => { setPv(s => ({ ...s, mode: modeDefault })); }, [modeDefault]);
  const packsKey = (vm?.packs || []).map(p => `${p.qty}:${p.isDefault ? 1 : 0}`).join("|");
  useEffect(() => { setPv(s => ({ ...s, selectedIdx: defaultIdx(vm) })); }, [plan?.id, packsKey]); // eslint-disable-line
  const onAction = useCallback((action, value) => {
    if (action === "mode" && (value === "sub" || value === "once")) setPv(s => ({ ...s, mode: value }));
    else if (action === "pack") setPv(s => ({ ...s, selectedIdx: Math.max(0, parseInt(value, 10) || 0) }));
    else if (action === "cta") toast(pv.mode === "sub" ? "En la tienda: va al checkout de suscripción" : "En la tienda: agrega al carrito", "success");
  }, [pv.mode]);
  // `selectedIdx` es el indice REAL del pack en plan.packs, no la posicion en la
  // lista visible: desde que un pack puede estar escondido en un modo, capearlo
  // con packs.length elegia otro bloque. Se valida contra los ids que existen.
  const safe = useMemo(() => {
    const ids = (vm?.packs || []).map(p => p.idx);
    return { ...pv, selectedIdx: ids.includes(pv.selectedIdx) ? pv.selectedIdx : (ids[0] ?? 0) };
  }, [pv, vm]);
  const out = useMemo(() => safeRender(vm, safe), [vm, safe]);
  const texts = vm?.texts || DEFAULT_WIDGET_TEXTS;
  return (
    <div style={style}>
      {vm?._error && <Callout T={T} tone="danger" style={{marginBottom:10}}>No se pudo armar la vista previa: {vm._error}</Callout>}
      {/* minWidth: por debajo de ~300px el bundle corta el texto palabra por
          palabra y no se entiende como va a quedar. Si la columna es mas
          angosta, que scrollee horizontal antes que deformarse. 22-sept-2026. */}
      <div style={{background:"#fff",borderRadius:12,border:`1px solid ${T.border}`,padding:10,maxWidth,minWidth:300,margin:"0 auto"}}>
        <BundleFrame html={out.html} css={out.css} interactive onAction={onAction} minHeight={minHeight}/>
      </div>
      {footer && (
        <div style={{fontSize:DS.font.sm,color:T.textSm,marginTop:8,textAlign:"center"}}>
          Modo: <strong>{safe.mode === "sub" ? texts.sub_label : texts.once_label}</strong> · pack #{((vm?.packs || []).findIndex(p => p.idx === safe.selectedIdx) + 1) || 1} · tocá los packs y el toggle
        </div>
      )}
    </div>
  );
}

// Snippet del widget para la tienda del merchant.
export function widgetSnippet(merchant) {
  const base = typeof window !== "undefined" ? window.location.origin : "https://recurrentesapp.com";
  return `<script src="${base}/widget.js?merchant=${merchant?.id || "<tu-id>"}" defer></script>`;
}

// ── Diseñador (diseño global) ─────────────────────────────────────────
// onEditPlan(plan): abre el PlanEditor de ese plan (para tocar sus packs).
export default function WidgetDesigner({ merchant, plans = [], onSaved, onEditPlan }) {
  const T = useT();
  const inputS = InputStyle(T);
  const m = merchant || {};
  const onb = useOnb();

  // ── borrador ──────────────────────────────────────────────────────────
  const [variant, setVariant] = useState(m.widget_variant || "v01");
  const [color, setColor] = useState(m.widget_color || "#10b981");
  const [radius, setRadius] = useState(Number.isFinite(+m.widget_radius) ? +m.widget_radius : 14);
  // Tamaño: 100 = como se ve hoy. 80…120 (± 20 %).
  const [scale, setScale] = useState(Number.isFinite(+m.widget_scale) ? +m.widget_scale : 100);
  const [boxScale, setBoxScale] = useState(Number.isFinite(+m.widget_box_scale) ? +m.widget_box_scale : 100);
  // Grosor del borde de las tarjetas: 100 = el de siempre, hasta 300. 22-sept-2026.
  const [borderScale, setBorderScale] = useState(Number.isFinite(+m.widget_border_scale) ? +m.widget_border_scale : 100);
  const [edgeToEdge, setEdgeToEdge] = useState(m.widget_edge_to_edge === true);
  const [texts, setTexts] = useState(() => normTexts(m.widget_texts));
  const [showCompare, setShowCompare] = useState(m.widget_show_compare !== false);
  const [showPerUnit, setShowPerUnit] = useState(m.widget_show_per_unit !== false);
  const [modeDefault, setModeDefault] = useState(m.widget_mode_default || "sub");
  const [modeOrder, setModeOrder] = useState(m.widget_mode_order || "sub_first");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setVariant(m.widget_variant || "v01");
    setColor(m.widget_color || "#10b981");
    setRadius(Number.isFinite(+m.widget_radius) ? +m.widget_radius : 14);
    setScale(Number.isFinite(+m.widget_scale) ? +m.widget_scale : 100);
    setBoxScale(Number.isFinite(+m.widget_box_scale) ? +m.widget_box_scale : 100);
    setBorderScale(Number.isFinite(+m.widget_border_scale) ? +m.widget_border_scale : 100);
    setEdgeToEdge(m.widget_edge_to_edge === true);
    setTexts(normTexts(m.widget_texts));
    setShowCompare(m.widget_show_compare !== false);
    setShowPerUnit(m.widget_show_per_unit !== false);
    setModeDefault(m.widget_mode_default || "sub");
    setModeOrder(m.widget_mode_order || "sub_first");
    // eslint-disable-next-line
  }, [m.id]);

  // ── plan de la vista previa (solo lectura: los packs se editan en el plan) ──
  // Los planes SIN PUBLICAR tambien valen para la vista previa (22-sept-2026,
  // Thiago): desde que nacen apagados, filtrar por activos dejaba al comerciante
  // mirando datos de ejemplo mientras elige el diseno de SU plan. Primero los
  // publicados, y entre ellos el mas viejo (el primero que creo).
  const activePlans = useMemo(() => {
    const todos = (Array.isArray(plans) ? plans : []).filter(Boolean);
    const orden = (p) => String(p.created_at || "");
    const pub = todos.filter(p => p.active !== false).sort((a, b) => orden(a).localeCompare(orden(b)));
    const sin = todos.filter(p => p.active === false).sort((a, b) => orden(a).localeCompare(orden(b)));
    return [...pub, ...sin];
  }, [plans]);
  const packPlans = useMemo(() => activePlans.filter(p => pricingModeOf(p) === "packs" && Array.isArray(p.packs) && p.packs.length > 0), [activePlans]);
  const [planId, setPlanId] = useState(null);
  useEffect(() => {
    if (planId === "sample" || activePlans.some(p => p.id === planId)) return;
    setPlanId(packPlans[0]?.id || activePlans[0]?.id || "sample");
  }, [activePlans, packPlans, planId]);
  const selectedPlan = planId && planId !== "sample" ? (activePlans.find(p => p.id === planId) || null) : null;
  const selMode = selectedPlan ? pricingModeOf(selectedPlan) : null;

  const previewPlan = useMemo(() => {
    if (!selectedPlan) return SAMPLE_PLAN;
    if (selMode === "packs" && Array.isArray(selectedPlan.packs) && selectedPlan.packs.length) return selectedPlan;
    return { ...selectedPlan, pricing_mode: "packs", packs: SAMPLE_PLAN.packs, _samplePacks: true };
  }, [selectedPlan, selMode]);
  const usingSample = previewPlan === SAMPLE_PLAN;
  const samplePacks = usingSample || previewPlan._samplePacks === true;

  const draftMerchant = useMemo(() => ({
    ...m,
    widget_variant: variant,
    widget_color: color,
    widget_radius: radius,
    widget_scale: scale,
    widget_box_scale: boxScale,
    widget_border_scale: borderScale,
    widget_edge_to_edge: edgeToEdge,
    widget_texts: texts,
    widget_show_compare: showCompare,
    widget_show_per_unit: showPerUnit,
    widget_mode_default: modeDefault,
    widget_mode_order: modeOrder,
  }), [m, variant, color, radius, texts, showCompare, showPerUnit, modeDefault, modeOrder]);

  // Galería: cada variante con el mismo vm pero su propio id.
  const galleryVM = useMemo(() => safeVM(previewPlan, draftMerchant), [previewPlan, draftMerchant]);
  const galleryIdx = defaultIdx(galleryVM);
  const gallery = useMemo(() => (BUNDLE_VARIANTS || []).map(v => ({ ...v, ...safeRender({ ...galleryVM, variant: v.id }, { mode: "sub", selectedIdx: galleryIdx }) })), [galleryVM, galleryIdx]);

  // ── guardar: TODO por save-settings ───────────────────────────────────
  async function save() {
    const colorHex = color.trim();
    if (!/^#[0-9a-f]{6}$/i.test(colorHex)) { toast("El color tiene que ser #RRGGBB", "error"); return; }
    setSaving(true);
    const payload = {
      widget_variant: variant,
      widget_color: colorHex,
      widget_radius: Math.max(0, Math.min(32, Math.round(radius))),
      widget_scale: Math.max(80, Math.min(120, Math.round(scale))),
      widget_box_scale: Math.max(80, Math.min(120, Math.round(boxScale))),
      widget_border_scale: Math.max(100, Math.min(300, Math.round(borderScale))),
      widget_edge_to_edge: edgeToEdge,
      widget_texts: {
        ...texts,
        trust_lines: (texts.trust_lines || []).map(s => s.trim()).filter(Boolean).slice(0, 4),
        trust_lines_once: (texts.trust_lines_once || []).map(s => s.trim()).filter(Boolean).slice(0, 4),
      },
      widget_show_compare: !!showCompare,
      widget_show_per_unit: !!showPerUnit,
      widget_mode_default: modeDefault,
      widget_mode_order: modeOrder,
    };
    const d = await apiPatch("merchant", payload, { action: "save-settings" });
    if (!d?.error) setSavedSource(source);
    if (d?.error) { setSaving(false); toast("Error: " + d.error, "error", 6000); return; }
    // Tolerancia a backend viejo: si save-settings no procesó color/modo (no los
    // devuelve en el eco), los mandamos por save-widget-settings (parcial).
    const echoed = d && "widget_color" in d && "widget_mode_default" in d && "widget_mode_order" in d;
    if (!echoed) {
      const w = await apiPatch("merchant", {
        widget_color: colorHex,
        widget_mode_default: modeDefault,
        widget_mode_order: modeOrder,
        widget_sub_title: m.widget_sub_title || texts.sub_label || "Suscripción",
        widget_once_title: m.widget_once_title || texts.once_label || "Compra única",
        widget_sub_subtitle: m.widget_sub_subtitle || "",
        widget_once_subtitle: m.widget_once_subtitle || "Comprá una vez al precio normal.",
        widget_disclaimer_text: m.widget_disclaimer_text || "",
      }, { action: "save-widget-settings" });
      if (w?.error) { setSaving(false); toast("Diseño guardado, pero falló color/modo: " + w.error, "error", 6000); onSaved?.(); return; }
    }
    setSaving(false);
    toast("Diseño del widget guardado · en tu tienda en ~5 min", "success");
    onSaved?.();
  }
  function resetTexts() { setTexts(normTexts(null)); toast("Textos restablecidos (guardá para aplicar)", "success"); }
  const setText = (k, v) => setTexts(t => ({ ...t, [k]: v }));
  // `campo` es trust_lines (suscripción) o trust_lines_once (compra única).
  const setTrust = (i, v, campo = "trust_lines") => setTexts(t => {
    const arr = [...(t[campo] || [])]; arr[i] = v; return { ...t, [campo]: arr };
  });


  const selectedVariant = (BUNDLE_VARIANTS || []).find(v => v.id === variant);
  const galleryPending = !!selectedPlan && selMode === "theme" && packPlans.length === 0;
  const sectionH = { fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, marginBottom:8, letterSpacing:-0.2 };
  const small = { fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 };
  const linkBtn = { background:"transparent", border:"none", color:T.accent, fontWeight:DS.w.semibold, cursor:"pointer", fontFamily:"inherit", fontSize:DS.font.sm, padding:0 };

  // Sin las integraciones no hay diseñador (22-sept, Thiago): no hay productos
  // que leer ni vista previa real, y lo que se guarde acá no se ve en ningún
  // lado. El paso del plan de acción ya lo trababa; esto cierra la entrada por
  // el menú lateral. Va DESPUÉS de todos los hooks (regla de Dashboard.jsx:
  // ningún return anticipado antes de los hooks).
  const perfil = merchantProfile(m);
  if (!perfil.ready) {
    return (
      <Callout T={T} tone="warning" title="Primero conectá tus integraciones"
        right={<Btn T={T} variant="solid" size="sm" onClick={() => { try { window.location.hash = "#/config/integraciones"; } catch (_) {} }}>Ir a Integraciones →</Btn>}>
        El diseñador muestra tus productos y tus precios de verdad. Conectá {perfil.missing.join(" y ")} y volvé: vas a poder ver cómo queda la caja con tus packs.
      </Callout>
    );
  }

  return (
    <div>
      {(m.shopify_token || m.tiendanube_token) && <WidgetStatusCard merchant={m} plans={activePlans} onVerified={onSaved}/>}

      {/* ── Vista previa + personalización ─────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:16,alignItems:"start"}}>
        <Card T={T} style={{position:"sticky",top:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={sectionH}>Vista previa</div>
              <div style={small}>{selectedVariant ? `${selectedVariant.name} · ${selectedVariant.id}` : variant}</div>
              {/* 22-sept (Thiago): mas de uno entra aca creyendo que esta viendo
                  su tienda y que desde aca se tocan los precios. Se aclara al
                  lado del titulo: esto es una maqueta y solo cambia el aspecto. */}
              <div style={{...small,marginTop:4,maxWidth:340,lineHeight:1.45}}>
                No es tu tienda: es una maqueta para elegir <strong style={{color:T.textMd}}>colores, formato y textos</strong>.
                Los precios, los packs y la frecuencia salen de cada plan.
              </div>
            </div>
            {activePlans.length > 0 && (
              <select value={selectedPlan ? selectedPlan.id : "sample"} onChange={e=>setPlanId(e.target.value)} style={{...inputS,width:"auto",maxWidth:240,padding:"7px 10px",fontSize:12,marginBottom:0}}>
                {activePlans.map(p => <option key={p.id} value={p.id}>{p.product_title}{p.active === false ? " · sin publicar" : ""}{pricingModeOf(p) === "theme" ? " · precio del tema" : ""}</option>)}
                <option value="sample">Datos de ejemplo</option>
              </select>
            )}
          </div>
          {usingSample && <div style={{...small,marginBottom:8}}>Datos de ejemplo: 3 packs (44.990 / 59.990 / 74.990, 10% off, cada 60 días).{activePlans.length === 0 && " Creá un plan para verlo con tus precios."}</div>}
          {!usingSample && samplePacks && <div style={{...small,marginBottom:8}}>Este plan {selMode === "theme" ? "usa el precio del tema" : "todavía no tiene packs"}: mostramos 3 de ejemplo.</div>}
          <BundlePreview plan={previewPlan} merchant={draftMerchant} minHeight={200}/>
          {selectedPlan && onEditPlan && (
            <div style={{marginTop:10,textAlign:"center"}}>
              <button type="button" onClick={()=>onEditPlan(selectedPlan)} style={linkBtn}>Editar packs de este plan →</button>
            </div>
          )}
        </Card>

        <Card T={T}>
          <div style={sectionH}>Personalización</div>

          <Field T={T} label="Color de acento">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#10b981"} onChange={e=>setColor(e.target.value)} style={{width:44,height:36,border:`1px solid ${T.border}`,borderRadius:8,padding:2,background:"transparent",cursor:"pointer"}}/>
              <input type="text" value={color} onChange={e=>setColor(e.target.value)} style={{...inputS,maxWidth:130,fontFamily:MONO,fontSize:12,marginBottom:0}} placeholder="#10b981"/>
              <div style={{flex:1,height:36,borderRadius:8,background:color}}/>
            </div>
          </Field>

          <Field T={T} label={`Radio de bordes · ${radius}px`}>
            <input type="range" min="0" max="32" step="1" value={radius} onChange={e=>setRadius(parseInt(e.target.value,10)||0)} style={{width:"100%",accentColor:T.accentSolid}}/>
          </Field>

          <Field T={T} label={`Tamaño de la letra · ${scale === 100 ? "normal" : (scale > 100 ? "+" : "") + (scale - 100) + "%"}`}>
            <input type="range" min="80" max="120" step="5" value={scale} onChange={e=>setScale(parseInt(e.target.value,10)||100)} style={{width:"100%",accentColor:T.accentSolid}}/>
          </Field>

          <Field T={T} label={`Alto de los recuadros · ${boxScale === 100 ? "normal" : (boxScale > 100 ? "+" : "") + (boxScale - 100) + "%"}`}>
            <input type="range" min="80" max="120" step="5" value={boxScale} onChange={e=>setBoxScale(parseInt(e.target.value,10)||100)} style={{width:"100%",accentColor:T.accentSolid}}/>
          </Field>

          <Field T={T} label={`Grosor de los bordes · ${borderScale === 100 ? "normal" : "×" + (borderScale / 100).toFixed(1).replace(/\.0$/, "")}`}>
            <input type="range" min="100" max="300" step="25" value={borderScale} onChange={e=>setBorderScale(parseInt(e.target.value,10)||100)} style={{width:"100%",accentColor:T.accentSolid}}/>
          </Field>

          <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",padding:"2px 0 10px"}}>
            <input type="checkbox" checked={edgeToEdge} onChange={e=>setEdgeToEdge(e.target.checked)} style={{marginTop:3,accentColor:T.accentSolid,width:16,height:16,flexShrink:0}}/>
            <span>
              <span style={{fontSize:DS.font.md,fontWeight:600,color:T.text}}>Pegado a los bordes</span>
              <span style={{display:"block",fontSize:DS.font.sm,color:T.textSm,lineHeight:1.45,marginTop:2}}>
                Ocupa todo el ancho del espacio donde está, sin aire a los costados. Útil si en tu tema queda angosto.
              </span>
            </span>
          </label>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 10px"}}>
            <Field T={T} label="Cuál aparece primero">
              <select value={modeOrder} onChange={e=>setModeOrder(e.target.value)} style={inputS}>
                <option value="sub_first">Suscripción primero</option>
                <option value="once_first">Compra única primero</option>
              </select>
            </Field>
            <Field T={T} label="Cuál arranca seleccionada">
              <select value={modeDefault} onChange={e=>setModeDefault(e.target.value)} style={inputS}>
                <option value="sub">Suscripción</option>
                <option value="once">Compra única</option>
              </select>
            </Field>
          </div>
          <div style={{display:"flex",gap:18,flexWrap:"wrap",marginBottom:14}}>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.textMd}}>Precio tachado <DSToggle T={T} active={showCompare} onToggle={()=>setShowCompare(v=>!v)}/></label>
            <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:T.textMd}}>Precio por unidad <DSToggle T={T} active={showPerUnit} onToggle={()=>setShowPerUnit(v=>!v)}/></label>
          </div>

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",margin:"6px 0 8px"}}>
            <div style={{fontSize:12,fontWeight:700,color:T.text}}>Textos</div>
            <Btn T={T} variant="secondary" size="sm" type="button" onClick={resetTexts}>Restablecer textos</Btn>
          </div>
          {/* Dejar un campo vacío NO alcanza: el widget cae al texto por defecto
              y vuelve a aparecer. Con una "x" se apaga de verdad (21-sept). */}
          <p style={{margin:"0 0 10px",fontSize:DS.font.sm,color:T.textSm,lineHeight:1.5}}>
            ¿Querés que un texto no aparezca? Poné una <strong style={{color:T.text}}>x</strong> sola
            en ese campo y esa parte desaparece del widget. Vacío vuelve al texto por defecto.
          </p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:"0 10px"}}>
            {TEXT_FIELDS.map(([k, label]) => (
              <Field key={k} T={T} label={label}>
                <input type="text" value={texts[k] ?? ""} onChange={e=>setText(k, e.target.value)} style={inputS}
              placeholder={k === "freq_prefix" ? "Te llegan 2 cada…" : DEFAULT_WIDGET_TEXTS[k]} maxLength={80}/>
              </Field>
            ))}
          </div>

          {/* Suscripción y compra única, cada uno con lo suyo (Thiago, 21-sept):
              antes estaba todo mezclado en una lista y no se entendía qué texto
              iba a ver el cliente en cada modo. */}
          <ModoTextos
            T={T} titulo="Cuando elige suscripción" campos={TEXT_FIELDS_SUB}
            texts={texts} setText={setText} inputS={inputS}
            lineas={texts.trust_lines} campoLineas="trust_lines" setTrust={setTrust}
            hints={TRUST_HINTS} notaKey="note_sub"
            notaPlaceholder="Ej: Te la mandamos a tu casa cada mes, sin que hagas nada."
          />
          <ModoTextos
            T={T} titulo="Cuando elige compra única" campos={TEXT_FIELDS_ONCE}
            texts={texts} setText={setText} inputS={inputS}
            lineas={texts.trust_lines_once} campoLineas="trust_lines_once" setTrust={setTrust}
            hints={["Ej: Envío en 48 horas", "Ej: Pagás una sola vez", "Opcional", "Opcional"]}
            notaKey="note_once"
            notaPlaceholder="Ej: Comprás una vez, sin renovación automática."
          />

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
          <Callout T={T} tone="info" style={{marginBottom:12}}>El diseño que elijas se aplica cuando algún plan esté en modo packs (Planes → Editar → Precios y packs).</Callout>
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

