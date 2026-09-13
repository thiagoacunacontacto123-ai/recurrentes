import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { apiPatch } from "../lib/api.js";
import { useTheme } from "../ui/theme.js";
import { Card, Field, InputStyle, BtnPrimary, BtnSecondary, DSToggle, toast } from "../ui/components.jsx";
import { BUNDLE_VARIANTS, renderBundle } from "../../shared/bundle/templates.js";
import { buildBundleVM } from "../../shared/bundle/viewmodel.js";
import { pricingModeOf } from "./PacksEditor.jsx";

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

export default function WidgetDesigner({ merchant, plans = [], onSaved }) {
  const { T } = useTheme();
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

  // ── plan de la vista previa ───────────────────────────────────────────
  const activePlans = useMemo(() => (plans || []).filter(p => p.active !== false), [plans]);
  const packPlans = useMemo(() => activePlans.filter(p => pricingModeOf(p) === "packs" && Array.isArray(p.packs) && p.packs.length > 0), [activePlans]);
  const firstActive = activePlans[0] || null;
  const [planId, setPlanId] = useState(null);
  useEffect(() => { if (planId == null && packPlans.length) setPlanId(packPlans[0].id); }, [packPlans, planId]);
  const previewPlan = useMemo(() => {
    const p = packPlans.find(x => x.id === planId);
    return p || (planId === "sample" || !packPlans.length ? SAMPLE_PLAN : packPlans[0]);
  }, [packPlans, planId]);
  const usingSample = previewPlan === SAMPLE_PLAN;

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
  const big = useMemo(() => safeRender(vm, pvState), [vm, pvState]);

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
  const themeWarning = firstActive && pricingModeOf(firstActive) === "theme";
  const sectionH = { fontSize:13, fontWeight:700, color:T.text, marginBottom:8 };
  const small = { fontSize:11, color:T.textSm, lineHeight:1.5 };

  return (
    <div>
      {themeWarning && (
        <div style={{marginBottom:14,padding:"10px 12px",borderRadius:10,background:"rgba(245,158,11,0.08)",border:"1px solid rgba(245,158,11,0.35)",fontSize:12,color:T.textMd,lineHeight:1.5}}>
          ⚠ <strong style={{color:T.text}}>{firstActive.product_title}</strong> usa el precio de tu tema; pasalo a modo packs (Editar plan → Precios y packs) para usar el selector.
        </div>
      )}
      {vm?._error && (
        <div style={{marginBottom:14,padding:"10px 12px",borderRadius:10,background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.35)",fontSize:12,color:T.red}}>
          No se pudo armar la vista previa: {vm._error}
        </div>
      )}

      {/* ── Vista previa grande + panel ─────────────────────────────── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(300px, 1fr))",gap:16,alignItems:"start"}}>
        <Card T={T} style={{position:"sticky",top:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={sectionH}>Vista previa</div>
              <div style={small}>{selectedVariant ? `${selectedVariant.name} · ${selectedVariant.id}` : variant} · tocá los packs y el toggle</div>
            </div>
            <select value={usingSample ? "sample" : previewPlan.id} onChange={e=>setPlanId(e.target.value)} style={{...inputS,width:"auto",maxWidth:220,padding:"7px 10px",fontSize:12}}>
              {packPlans.map(p => <option key={p.id} value={p.id}>{p.product_title}</option>)}
              <option value="sample">Datos de ejemplo</option>
            </select>
          </div>
          {usingSample && <div style={{...small,marginBottom:8}}>Sin planes en modo packs todavía: mostramos 3 packs de ejemplo (44.990 / 59.990 / 74.990, 10% off, cada 60 días).</div>}
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
            <button type="button" onClick={resetTexts} style={{...BtnSecondary(T),padding:"5px 10px",fontSize:11}}>Restablecer textos</button>
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
            <button type="button" onClick={save} disabled={saving} style={{...BtnPrimary(T),opacity:saving?0.6:1}}>{saving ? "Guardando…" : "Guardar diseño"}</button>
            <span style={small}>Visible en la tienda en ~5 min (caché del widget).</span>
          </div>
        </Card>
      </div>

      {/* ── Galería de variantes ────────────────────────────────────── */}
      <div style={{marginTop:20}}>
        <div style={sectionH}>Elegí un diseño</div>
        <div style={{...small,marginBottom:12}}>Vista previa real de cada variante con tus packs y colores. Tocá "Usar este" y después guardá.</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(300px, 1fr))",gap:14}}>
          {gallery.map(v => {
            const active = v.id === variant;
            return (
              <div key={v.id} onClick={()=>setVariant(v.id)} style={{background:T.card,border:`2px solid ${active?T.accentSolid:T.border}`,borderRadius:14,overflow:"hidden",cursor:"pointer",boxShadow:active?"0 0 0 4px rgba(16,185,129,0.15)":"none",transition:"border-color 0.15s, box-shadow 0.15s",display:"flex",flexDirection:"column"}}>
                <div style={{background:"#fff",padding:8,borderBottom:`1px solid ${T.borderL}`,maxHeight:380,overflow:"hidden",position:"relative"}}>
                  <BundleFrame html={v.html} css={v.css} minHeight={160}/>
                  {active && <div style={{position:"absolute",top:8,right:8,background:T.accentSolid,color:"#fff",fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:6,letterSpacing:0.3}}>EN USO</div>}
                </div>
                <div style={{padding:"10px 12px",display:"flex",alignItems:"center",gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:T.text}}>{v.name || v.id} <span style={{fontSize:10,color:T.textSm,fontWeight:500}}>{v.id}</span></div>
                    <div style={{fontSize:11,color:T.textSm,lineHeight:1.45}}>{v.description || ""}</div>
                  </div>
                  <button type="button" onClick={(e)=>{e.stopPropagation(); setVariant(v.id);}} style={active ? {...BtnPrimary(T),padding:"6px 10px",fontSize:11} : {...BtnSecondary(T),padding:"6px 10px",fontSize:11}}>{active ? "✓ Elegido" : "Usar este"}</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
