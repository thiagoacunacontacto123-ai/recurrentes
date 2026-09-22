import React, { useState, useMemo } from "react";
import { apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, Field, InputStyle, Spinner, PageHeader, Callout, Hint, CheckLine, appAlert, toast } from "../ui/components.jsx";
import PacksEditor, { packsFromPlan, serializePacks, validatePacks, pricingModeOf } from "./PacksEditor.jsx";
import { BundlePreview, SAMPLE_PLAN } from "./WidgetDesigner.jsx";
import { fmtARS, fmtFreq, SurfaceBox, MONO, copyText } from "./_shared.jsx";
import { merchantProfile, hostedCheckoutUrl } from "../../shared/platform/profile.js";
import { planExample } from "../lib/onboarding.js";
import { deliveryApplies, normalizeDigitalDelivery, DELIVERY_MESSAGE_MAX, DELIVERY_SEND_ON, DELIVERY_SEND_ON_LABELS } from "../../shared/platform/delivery.js";

// Vista previa del mail de entrega digital (mismo contenido que emailDigitalDelivery).
function DeliveryEmailPreview({ T, brand, color, title, url, message }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#10b981";
  return (
    <div style={{ marginTop:12 }}>
      <div style={{ fontSize:DS.font.sm, fontWeight:DS.w.semibold, color:T.textMd, marginBottom:6 }}>Así le llega el mail</div>
      <div style={{ background:"#f5f7f6", borderRadius:DS.r.xl, padding:12, border:`1px solid ${T.borderL}` }}>
        <div style={{ background:"#fff", border:"1px solid #e5e7eb", borderRadius:12, overflow:"hidden", color:"#1f2937" }}>
          <div style={{ padding:"11px 16px", borderBottom:"1px solid #e5e7eb", fontSize:15, fontWeight:800, color:accent, overflowWrap:"anywhere" }}>{brand}</div>
          <div style={{ padding:"14px 16px", fontSize:13, lineHeight:1.55 }}>
            <div style={{ fontSize:15, fontWeight:700, color:"#111827", marginBottom:8, overflowWrap:"anywhere" }}>Ya podés entrar a {title}</div>
            <div>Hola Ana,</div>
            <div style={{ marginTop:6 }}>Tu suscripción a <b>{title}</b> ya está activa. Entrás con el botón de abajo.</div>
            {message.trim() && <div style={{ background:"#f9fafb", border:"1px solid #e5e7eb", borderRadius:10, padding:10, margin:"10px 0 0", whiteSpace:"pre-wrap", overflowWrap:"anywhere" }}>{message.trim()}</div>}
            <div style={{ display:"inline-block", marginTop:12, background:accent, color:"#fff", padding:"9px 16px", borderRadius:10, fontWeight:700, fontSize:13 }}>Acceder a tu contenido</div>
            {url && <div style={{ marginTop:8, fontSize:10.5, color:"#6b7280", overflowWrap:"anywhere" }}>{url}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// Título de bloque dentro de un formulario (con línea arriba). Plans.jsx la re-exporta.
export function FormSection({ T, title, right, children, first }) {
  return (
    <div style={{ marginTop: first ? 0 : 16, paddingTop: first ? 0 : 14, borderTop: first ? "none" : `1px solid ${T.borderL}` }}>
      {(title || right) && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:10 }}>
          <div style={{ fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Frecuencias típicas (chips): semanal para clases, mensual para cuotas, etc.
const FREQ_PRESETS = [7, 15, 30, 60, 90, 365];

// Link público de suscripción de un plan (checkout hosteado) con copiar / abrir /
// compartir por WhatsApp. Lo usan el editor y la grilla de Planes.
export function SubscriptionLinkBox({ T, merchantId, planId, title }) {
  const url = hostedCheckoutUrl(window.location.origin, merchantId, planId);
  const wa = `https://wa.me/?text=${encodeURIComponent(`${title ? title + ": " : ""}${url}`)}`;
  return (
    <div>
      <div style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:"10px 12px", fontFamily:MONO, fontSize:DS.font.sm, color:T.accent, lineHeight:1.5, overflowWrap:"anywhere" }}>{url}</div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
        <Btn T={T} variant="solid" size="sm" onClick={() => copyText(url, "Link copiado")}>Copiar link</Btn>
        <Btn T={T} variant="secondary" size="sm" onClick={() => window.open(url, "_blank", "noopener")}>Abrir</Btn>
        <Btn T={T} variant="secondary" size="sm" onClick={() => window.open(wa, "_blank", "noopener")}>Compartir por WhatsApp</Btn>
      </div>
    </div>
  );
}

// Mini checkout (vista previa del link): lo que ve el cliente al abrirlo.
function LinkCheckoutPreview({ T, title, image, price, frequency, color, kindLabel, storeName }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color || "") ? color : "#10b981";
  return (
    <div style={{ background:"#f6f6f7", borderRadius:DS.r.xl, padding:14, border:`1px solid ${T.borderL}` }}>
      {storeName && <div style={{ fontSize:13, fontWeight:800, color:"#1a1a1a", marginBottom:10, overflowWrap:"anywhere" }}>{storeName}</div>}
      <div style={{ background:"#fff", border:"1px solid #e5e5e7", borderRadius:12, padding:14, color:"#1a1a1a" }}>
        <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:12 }}>
          {image ? <img src={image} alt="" style={{ width:44, height:44, borderRadius:9, objectFit:"cover", border:"1px solid #eee", flexShrink:0 }}/> : <div style={{ width:44, height:44, borderRadius:9, background:accent + "1a", display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>🔁</div>}
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:9.5, fontWeight:800, color:accent, textTransform:"uppercase", letterSpacing:0.5 }}>{kindLabel} · {fmtFreq(frequency)}</div>
            <div style={{ fontSize:13.5, fontWeight:700, lineHeight:1.3, overflowWrap:"anywhere" }}>{title}</div>
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", borderTop:"1px solid #eee", paddingTop:10, fontSize:14 }}><b>Total {fmtFreq(frequency)}</b><b>{fmtARS(price)}</b></div>
        <div style={{ marginTop:12, padding:"11px", borderRadius:10, background:accent, color:"#fff", fontWeight:700, fontSize:13.5, textAlign:"center" }}>Suscribirme y pagar {fmtARS(price)}</div>
        <div style={{ marginTop:8, fontSize:10.5, color:"#888", lineHeight:1.45, textAlign:"center" }}>Se renueva sola. Pausás o cancelás cuando quieras.</div>
      </div>
    </div>
  );
}

// Editor de plan a pantalla completa (alta y edición), estilo Recharge:
// izquierda el formulario, derecha la vista previa EN VIVO.
//   · Con tienda (Shopify): el producto sale del catálogo; vista previa del widget con packs.
//   · Sin tienda (servicios, digitales, link): nombre + precio a mano; vista previa del
//     checkout del link y, al guardar, el link para compartir.
// Guardar = mismo POST /api/plans (alta) o PATCH /api/plans?id= (edición).
//
// Props: plan (null = nuevo) · products (shopify?action=products) · merchant ·
//        onBack() · onSaved() · onGoWidget() (link a Planes → Widget)
export default function PlanEditor({ plan, products = [], merchant, onBack, onSaved, onGoWidget }) {
  const T = useT();
  const iS = InputStyle(T);
  const isEdit = !!plan;
  const m = merchant || {};
  const profile = useMemo(() => merchantProfile(m), [m]);
  // Ítem manual: el merchant no tiene catálogo (o el plan se creó así).
  const manual = !profile.caps.catalog || plan?.item_source === "manual";
  const showPacks = profile.caps.packs && !manual;
  const showShipping = profile.caps.shipping;
  const isService = profile.businessType === "service";

  // ── producto / variante (catálogo) ────────────────────────────────────
  const [productId, setProductId] = useState("");
  const [variantId, setVariantId] = useState("");
  const product = products.find(p => String(p.id) === String(productId));
  const variant = product?.variants?.find(v => String(v.id) === String(variantId));
  // En edición: la variante actual del plan en Shopify (para mostrar su precio de hoy).
  const shopifyVariant = useMemo(() => {
    if (!isEdit || manual) return null;
    const p = products.find(x => String(x.id) === String(plan.shopify_product_id));
    return p?.variants?.find(v => String(v.id) === String(plan.shopify_variant_id)) || null;
  }, [isEdit, manual, plan, products]);
  const shopifyPrice = shopifyVariant ? Number(shopifyVariant.price) || 0 : null;

  // ── ítem manual (sin tienda) ──────────────────────────────────────────
  const [itemTitle, setItemTitle] = useState(plan?.product_title || "");
  const [itemImage, setItemImage] = useState(plan?.product_image || "");
  const [manualPrice, setManualPrice] = useState(plan?.base_price_ars || "");

  // ── términos ──────────────────────────────────────────────────────────
  const [frequency, setFrequency] = useState(plan?.frequency_days ?? 30);
  const [discount, setDiscount] = useState(plan?.discount_pct ?? (manual ? 0 : 15));
  const [units, setUnits] = useState(plan?.units_per_shipment ?? 1);
  // Precio normal (edición): el guardado en el plan; si está en 0, el de Shopify.
  const [editBasePrice, setEditBasePrice] = useState(() => (Number(plan?.base_price_ars) > 0 ? plan.base_price_ars : (shopifyPrice || 0)));
  // Envío por defecto del plan (solo se usa si no hay envíos del checkout)
  const [shippingPrice, setShippingPrice] = useState(plan?.shipping_price_ars ?? 0);
  const [freeShipFrom, setFreeShipFrom] = useState(plan?.free_shipping_from_ars ?? 0);
  const [shippingName, setShippingName] = useState(plan?.shipping_method_name ?? "Envío a domicilio");
  // Avanzado (modo tema)
  const [qtyTiers, setQtyTiers] = useState(plan?.qty_discount_tiers ? plan.qty_discount_tiers.map(t=>({min_qty:t.min_qty,discount_pct:t.discount_pct})) : []);
  const [allowCustomFreq, setAllowCustomFreq] = useState(plan?.allow_custom_frequency === true);
  const [maxPackDisc, setMaxPackDisc] = useState(plan?.max_pack_discount_pct ?? 35);
  const [advOpen, setAdvOpen] = useState(false);
  // Precios y packs (shared/bundle/SPEC.md). Plan nuevo con widget → packs (recomendado).
  const [pricingMode, setPricingMode] = useState(isEdit ? pricingModeOf(plan) : (showPacks ? "packs" : "theme"));
  const [packs, setPacks] = useState(() => packsFromPlan(plan));
  const [freqScales, setFreqScales] = useState(plan ? plan.frequency_scales_with_qty !== false : true);
  const [saving, setSaving] = useState(false);
  // Entrega digital (solo negocios sin envío): link + mensaje que mandamos por mail al cobrar.
  const showDelivery = deliveryApplies(profile);
  const dd0 = plan?.digital_delivery || {};
  const [ddEnabled, setDdEnabled] = useState(dd0.enabled === true);
  const [ddTouched, setDdTouched] = useState(!!plan?.digital_delivery);
  const [ddUrl, setDdUrl] = useState(dd0.url || "");
  const [ddMessage, setDdMessage] = useState(dd0.message || "");
  const [ddSendOn, setDdSendOn] = useState(Array.isArray(dd0.send_on) && dd0.send_on.length ? dd0.send_on : ["activation"]);
  const ddPayload = () => ({ enabled: ddEnabled, url: ddUrl.trim(), message: ddMessage.trim(), send_on: ddSendOn });

  const basePrice = isEdit ? (parseFloat(editBasePrice) || 0) : manual ? (parseFloat(manualPrice) || 0) : (Number(variant?.price) || 0);
  const discountNum = isService && manual ? 0 : Math.max(0, Math.min(80, parseInt(discount, 10) || 0));
  const freqNum = Math.max(1, parseInt(frequency, 10) || 30);
  const subPrice = Math.round(basePrice * (1 - discountNum / 100));
  const title = manual
    ? (itemTitle.trim() || (isEdit ? plan.product_title : "Nuevo plan"))
    : isEdit ? plan.product_title : (product ? product.title + (variant && variant.title !== "Default Title" ? ` — ${variant.title}` : "") : "Nuevo plan");
  const effectiveMode = showPacks ? pricingMode : "theme";

  // Envíos del checkout (Configuración → Tienda): si hay, el cliente elige entre esos.
  const checkoutRates = Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : [];
  const hasCheckoutRates = checkoutRates.length > 0;
  // Tienda conectada = los envíos salen SOLOS de la tienda (21-sept, Thiago).
  // El checkout cotiza contra el proveedor de envíos del comerciante igual que
  // una venta común, así que el plan no pregunta ningún costo de envío: cargarlo
  // a mano solo servía para que compitiera con el real y saliera un precio que la
  // tienda no cobra. Sin tienda (ítem manual / venta por link) se siguen pidiendo.
  const enviosDeLaTienda = profile.channel === "shopify" || profile.channel === "tiendanube";
  const goStoreSettings = () => { try { window.location.hash = "#/config/checkout"; } catch (_) {} };

  // ── borrador para la vista previa del widget ──────────────────────────
  const draftPacks = useMemo(() => serializePacks(packs), [packs]);
  const draftPlan = useMemo(() => {
    const base = {
      ...(plan || {}),
      id: plan?.id || "draft",
      product_title: title,
      product_image: isEdit ? plan.product_image : product?.image,
      pricing_mode: "packs",
      base_price_ars: basePrice,
      discount_pct: discountNum,
      frequency_days: freqNum,
      frequency_scales_with_qty: freqScales !== false,
    };
    if (draftPacks.length) return { ...base, packs: draftPacks };
    return { ...base, packs: SAMPLE_PLAN.packs, _samplePacks: true };
  }, [plan, title, isEdit, product, basePrice, discountNum, freqNum, freqScales, draftPacks]);

  // ── tiers (modo tema) ─────────────────────────────────────────────────
  function addTier() {
    const last = qtyTiers[qtyTiers.length - 1];
    setQtyTiers([...qtyTiers, { min_qty: last ? last.min_qty + 1 : 2, discount_pct: last ? Math.min(50, last.discount_pct + 5) : 5 }]);
  }
  const updateTier = (i, field, val) => setQtyTiers(ts => ts.map((t, j) => j === i ? { ...t, [field]: parseInt(val) || 0 } : t));
  const removeTier = (i) => setQtyTiers(ts => ts.filter((_, j) => j !== i));

  // ── guardar (mismo contrato que siempre) ──────────────────────────────
  function termsPayload() {
    const tiers = qtyTiers.filter(t => t.min_qty >= 2 && t.discount_pct > 0).sort((a, b) => a.min_qty - b.min_qty);
    return {
      pricing_mode: effectiveMode,
      packs: showPacks ? serializePacks(packs) : [],
      frequency_scales_with_qty: freqScales !== false,
      frequency_days: freqNum,
      discount_pct: discountNum,
      units_per_shipment: Math.max(1, parseInt(units, 10) || 1),
      // Con tienda conectada el envío lo pone la tienda: se guarda en 0 para que
      // la tarifa del plan no le gane a la real en el checkout.
      shipping_price_ars: (showShipping && !enviosDeLaTienda) ? (parseFloat(shippingPrice) || 0) : 0,
      free_shipping_from_ars: (showShipping && !enviosDeLaTienda) ? (parseFloat(freeShipFrom) || 0) : 0,
      shipping_method_name: String(shippingName || "").trim() || "Envío a domicilio",
      qty_discount_tiers: showPacks ? tiers : [],
      allow_custom_frequency: showPacks ? allowCustomFreq : false,
      max_pack_discount_pct: parseInt(maxPackDisc, 10) || 0,
      ...(showDelivery ? { digital_delivery: normalizeDigitalDelivery(ddPayload()).value } : {}),
    };
  }
  const manualFields = () => ({ product_title: itemTitle.trim(), product_image: itemImage.trim() || null });
  async function save() {
    if (effectiveMode === "packs") {
      const perr = validatePacks(packs);
      if (perr) return toast(perr, "warning", 5000);
    }
    if (showDelivery) {
      const dErr = normalizeDigitalDelivery(ddPayload()).error;
      if (dErr) return toast(dErr, "warning", 5000);
    }
    if (manual && !itemTitle.trim()) return toast("Poné un nombre al plan", "warning");
    if (manual && itemImage.trim() && !/^https:\/\//i.test(itemImage.trim())) return toast("La imagen tiene que ser un link https://", "warning");
    if (isEdit) {
      if (!(basePrice > 0)) return toast(manual ? "El precio tiene que ser mayor a 0" : "El precio normal tiene que ser mayor a 0", "warning");
      setSaving(true);
      const d = await apiPatch("plans", { ...termsPayload(), base_price_ars: basePrice, ...(manual ? manualFields() : {}) }, { id: plan.id });
      setSaving(false);
      if (d?.error) return toast("Error: " + d.error, "error", 6000);
      toast("Plan guardado", "success");
      if (d?.note) await appAlert(d.note, { title:"Aviso" });
      onSaved?.();
      return;
    }
    if (manual) {
      if (!(basePrice > 0)) return toast("El precio tiene que ser mayor a 0", "warning");
    } else if (!productId || !variantId) return toast("Elegí producto y variante", "warning");
    setSaving(true);
    const d = await apiPost("plans", manual ? {
      ...termsPayload(),
      ...manualFields(),
      base_price_ars: basePrice,
    } : {
      ...termsPayload(),
      shopify_product_id: productId,
      shopify_variant_id: variantId,
      product_title: title,
      product_image: product?.image,
      base_price_ars: basePrice,
    });
    setSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(manual ? "Plan creado: ya tenés tu link para compartir" : "Plan creado", "success");
    onSaved?.(d?.plan);
  }

  const canSave = !saving && (isEdit || (manual ? (!!itemTitle.trim() && basePrice > 0) : !!variantId));
  const smallNum = { ...iS, padding:"6px 8px", fontSize:DS.font.md, width:64, marginBottom:0 };
  const small = { fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 };
  const linkBtn = { background:"transparent", border:"none", color:T.accent, fontWeight:DS.w.semibold, cursor:"pointer", fontFamily:"inherit", fontSize:DS.font.sm, padding:0 };
  const saveBtn = <Btn T={T} variant="solid" onClick={save} disabled={!canSave}>{saving ? <><Spinner size={13}/> {isEdit ? "Guardando…" : "Creando…"}</> : (isEdit ? "Guardar cambios" : "Crear plan")}</Btn>;
  const priceLabel = manual ? (isService ? "Precio de la cuota ($)" : "Precio de cada cobro ($)") : "Precio normal ($)";

  return (
    <div>
      <PageHeader T={T} back="Volver a planes" onBack={onBack} title={isEdit ? "Editar plan" : "Nuevo plan"}
        subtitle={isEdit ? plan.product_title : manual
          ? `Nombre, precio y cada cuántos días se cobra (ej: "${planExample(profile)}"). Al guardar te damos el link para compartir.`
          : `Convertí un producto de ${profile.channelInfo.label} en suscripción recurrente. Lo que cargás se ve a la derecha al instante.`}
        right={<><Btn T={T} variant="secondary" onClick={onBack}>Cancelar</Btn>{saveBtn}</>}/>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0, 1.25fr) minmax(300px, 1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        {/* ── Columna izquierda: formulario ─────────────────────────── */}
        <Card T={T}>
          {manual ? (
            <>
              <Field T={T} label="Nombre del plan" required>
                <input value={itemTitle} onChange={e=>setItemTitle(e.target.value)} maxLength={120} style={iS} placeholder={planExample(profile)}/>
              </Field>
              <Field T={T} label={<>Imagen <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(link https://, opcional)</span></>}>
                <input value={itemImage} onChange={e=>setItemImage(e.target.value)} style={iS} placeholder="https://…/foto.jpg"/>
              </Field>
              <Field T={T} label={priceLabel} required>
                <input type="number" min="0" value={isEdit ? editBasePrice : manualPrice} onChange={e=>isEdit ? setEditBasePrice(e.target.value) : setManualPrice(e.target.value)} style={iS} placeholder="0"/>
              </Field>
            </>
          ) : isEdit ? (
            <>
              <Field T={T} label="Producto">
                <div style={{ ...iS, display:"flex", alignItems:"center", gap:10, background:T.surface, color:T.textMd, cursor:"default" }}>
                  {plan.product_image && <img src={plan.product_image} alt="" style={{ width:26, height:26, borderRadius:6, objectFit:"cover" }}/>}
                  <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{plan.product_title}</span>
                </div>
              </Field>
              <Hint T={T}>El producto/variante no se cambia acá. Para otro producto, creá un plan nuevo.</Hint>
              <Field T={T} label="Precio normal ($)">
                <input type="number" min="0" value={editBasePrice} onChange={e=>setEditBasePrice(e.target.value)} style={iS} placeholder="0"/>
              </Field>
              {shopifyPrice != null && (
                <Hint T={T}>
                  Precio en {profile.channelInfo.label}: <strong style={{ color:T.text }}>{fmtARS(shopifyPrice)}</strong>
                  {Math.round(shopifyPrice) !== Math.round(basePrice) && <> · <button type="button" style={linkBtn} onClick={()=>setEditBasePrice(shopifyPrice)}>usar</button></>}
                </Hint>
              )}
            </>
          ) : (
            <>
              <Field T={T} label={`Producto ${profile.channelInfo.label}`} required>
                <select value={productId} onChange={e=>{
                  const pid = e.target.value;
                  setProductId(pid);
                  // Una sola variante: se elige sola. Varias: la primera, que es
                  // la que el tema muestra por defecto y de donde sale el precio.
                  const prod = products.find(x => String(x.id) === String(pid));
                  setVariantId(prod?.variants?.[0]?.id ? String(prod.variants[0].id) : "");
                }} style={iS}>
                  <option value="">— Elegí —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
              </Field>
              {/* El plan cubre TODAS las variantes del producto (22-sept): el
                  cliente elige el sabor en la página y esa es la que se le
                  factura. Con una sola variante se elige sola y no se pregunta
                  nada; con varias, solo se avisa. La variante guardada queda
                  como respaldo para los casos en que el tema no la informe. */}
              {product && product.variants.length > 1 && (
                <Hint T={T}>
                  Este producto tiene <strong style={{ color:T.text }}>{product.variants.length} variantes</strong> y
                  el plan las cubre todas: tu cliente elige la suya en la página y esa es la que recibe.
                  {variant ? <> El precio de los packs sale de <strong style={{ color:T.text }}>{variant.title}</strong>.</> : null}
                </Hint>
              )}
              {variant && <Hint T={T}>Precio normal (de {profile.channelInfo.label}): <strong style={{ color:T.text }}>{fmtARS(basePrice)}</strong>. Es la base de los packs y del descuento.</Hint>}
            </>
          )}

          <div style={{ display:"flex", gap:6, flexWrap:"wrap", margin:"2px 0 8px" }} role="group" aria-label="Frecuencias típicas">
            {FREQ_PRESETS.map(d => {
              const on = freqNum === d;
              return (
                <button key={d} type="button" onClick={()=>setFrequency(d)} aria-pressed={on}
                  style={{ padding:"5px 11px", borderRadius:99, border:`1px solid ${on ? T.accentSolid : T.border}`, background: on ? T.accentSolid + "18" : "transparent", color: on ? T.accent : T.textMd, fontSize:DS.font.sm, fontWeight:DS.w.semibold, cursor:"pointer", fontFamily:"inherit" }}>
                  {fmtFreq(d).replace(/^./, c => c.toUpperCase())}
                </button>
              );
            })}
          </div>
          <div style={{ display:"grid", gridTemplateColumns: isService && manual ? "1fr" : "1fr 1fr", gap:"0 12px" }}>
            <Field T={T} label="Frecuencia (días)">
              <input type="number" min="1" value={frequency} onChange={e=>setFrequency(e.target.value)} style={iS}/>
            </Field>
            {!(isService && manual) && (
              <Field T={T} label={manual ? "Descuento por suscribirse (%)" : "Descuento por suscripción (%)"}>
                <input type="number" min="0" max="80" value={discount} onChange={e=>setDiscount(e.target.value)} style={iS}/>
              </Field>
            )}
          </div>

          {/* ─── Precios y packs (modo packs | tema) — solo con widget en la tienda ─── */}
          {showPacks && (
            <PacksEditor
              mode={pricingMode} onModeChange={setPricingMode}
              packs={packs} onPacksChange={setPacks}
              products={products} productImage={product?.image || null} toast={toast}
              basePrice={basePrice} discountPct={discount} frequencyDays={frequency}
              freqScales={freqScales} onFreqScalesChange={setFreqScales}
            />
          )}

          {/* ─── Envío (solo negocios con envío) ─────────────────────── */}
          {showShipping && (
            <FormSection T={T} title="Envío">
              {enviosDeLaTienda ? (
                <SurfaceBox T={T}>
                  <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.55 }}>
                    Se usan <strong style={{ color:T.text }}>los envíos de tu tienda</strong>, los mismos que cobrás en una venta común.
                    {" "}Cuando el cliente pone su código postal, el checkout los cotiza y él elige.
                    {hasCheckoutRates ? <> También ofrecés los que cargaste a mano ({checkoutRates.slice(0, 3).map(r => r.name).join(" · ")}{checkoutRates.length > 3 ? ` · +${checkoutRates.length - 3}` : ""}), en <button type="button" style={linkBtn} onClick={goStoreSettings}>Configuración → Checkout →</button></> : null}
                  </div>
                </SurfaceBox>
              ) : (
                <>
                  <Callout T={T} tone="info" style={{ marginBottom:12 }} right={<Btn T={T} variant="secondary" size="sm" type="button" onClick={goStoreSettings}>Cargar envíos →</Btn>}>
                    <strong style={{ color:T.text }}>Envío por defecto de este plan.</strong> Si cargás envíos del checkout en Configuración → Tienda{profile.channel === "shopify" ? " (o los importás de Shopify)" : ""}, el cliente elige entre esos y estos campos dejan de usarse.
                  </Callout>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
                    <Field T={T} label="Costo de envío ($)">
                      <input type="number" min="0" value={shippingPrice} onChange={e=>setShippingPrice(e.target.value)} style={iS} placeholder="0"/>
                    </Field>
                    <Field T={T} label="Envío gratis desde ($)">
                      <input type="number" min="0" value={freeShipFrom} onChange={e=>setFreeShipFrom(e.target.value)} style={iS} placeholder="0 = nunca gratis"/>
                    </Field>
                  </div>
                  <Field T={T} label={profile.channel === "shopify" ? "Nombre del método (lo que ve el cliente en Shopify)" : "Nombre del método (lo que ve el cliente)"}>
                    <input type="text" value={shippingName} onChange={e=>setShippingName(e.target.value)} style={iS} placeholder="Envío a domicilio"/>
                  </Field>
                </>
              )}
            </FormSection>
          )}

          {/* ─── Entrega digital (negocios sin envío: digitales, servicios) ─── */}
          {showDelivery && (
            <FormSection T={T} title="Qué recibe tu cliente">
              <div style={{ ...small, marginBottom:10 }}>Pegá el link a tu contenido, carpeta de Drive o área de {profile.vocab.customers}. Se lo mandamos por mail apenas se cobra la suscripción.</div>
              <CheckLine T={T} checked={ddEnabled} onChange={(v)=>{ setDdTouched(true); setDdEnabled(v); }} style={{ marginBottom:12, color:T.text }}>Mandar el acceso por mail</CheckLine>
              <Field T={T} label="Link de acceso">
                <input value={ddUrl} inputMode="url" onChange={e=>{ const v = e.target.value; setDdUrl(v); if (!ddTouched && v.trim()) setDdEnabled(true); }} style={iS} placeholder="https://drive.google.com/…"/>
              </Field>
              <Field T={T} label={<>Mensaje <span style={{ color:T.textSm, fontWeight:DS.w.regular, textTransform:"none" }}>(opcional · {ddMessage.length}/{DELIVERY_MESSAGE_MAX})</span></>}>
                <textarea value={ddMessage} rows={3} onChange={e=>setDdMessage(e.target.value.slice(0, DELIVERY_MESSAGE_MAX))} style={{ ...iS, resize:"vertical", minHeight:72, fontFamily:"inherit" }} placeholder="Ej: Entrás con el mail con el que pagaste. Cualquier duda, escribinos por WhatsApp."/>
              </Field>
              <div style={{ fontSize:DS.font.sm, fontWeight:DS.w.semibold, color:T.textMd, marginBottom:6 }}>Cuándo se manda</div>
              {DELIVERY_SEND_ON.map(k => (
                <CheckLine key={k} T={T} checked={ddSendOn.includes(k)} style={{ marginBottom:6, color:T.text }}
                  onChange={(v)=>setDdSendOn(s => v ? [...new Set([...s, k])] : s.filter(x => x !== k))}>{DELIVERY_SEND_ON_LABELS[k]}</CheckLine>
              ))}
              {ddEnabled && ddSendOn.length === 0 && <Hint T={T}>Sin ninguna opción marcada, lo mandamos cuando se activa.</Hint>}
              {ddEnabled && (
                <DeliveryEmailPreview T={T} brand={m.email_brand || m.store_name || m.shop_name || "Tu tienda"} color={m.widget_color}
                  title={title} url={normalizeDigitalDelivery({ url: ddUrl }).value?.url || ddUrl.trim()} message={ddMessage}/>
              )}
            </FormSection>
          )}

          {/* ─── Avanzado (solo modo tema con widget: en packs cada pack ya trae precio/frecuencia) ── */}
          {showPacks && pricingMode === "theme" && (
            <FormSection T={T} title={<button type="button" onClick={()=>setAdvOpen(o=>!o)} style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontFamily:"inherit", fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text, display:"inline-flex", alignItems:"center", gap:6 }}><span style={{ display:"inline-block", transition:"transform .15s", transform: advOpen ? "rotate(90deg)" : "none" }}>▸</span> Avanzado</button>}
              right={!advOpen && <span style={small}>frecuencia libre, tope de descuento, niveles por cantidad, unidades</span>}>
              {advOpen && (
                <div className="gh-accordion">
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px", alignItems:"end" }}>
                    <Field T={T} label="Unidades por envío (default al abrir)">
                      <input type="number" min="1" value={units} onChange={e=>setUnits(e.target.value)} style={iS}/>
                    </Field>
                    <Field T={T} label="Tope de descuento por pack (%)">
                      <input type="number" min="0" max="80" value={maxPackDisc} onChange={e=>setMaxPackDisc(e.target.value)} style={iS}/>
                    </Field>
                  </div>
                  <CheckLine T={T} checked={allowCustomFreq} onChange={setAllowCustomFreq} style={{ marginBottom:14, color:T.text }}>El cliente puede elegir otra frecuencia</CheckLine>

                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginBottom:8 }}>
                    <div style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.text }}>Descuentos por cantidad</div>
                    <Btn T={T} variant="secondary" size="sm" onClick={addTier} type="button">+ Agregar nivel</Btn>
                  </div>
                  {qtyTiers.length === 0 ? (
                    <SurfaceBox T={T}><div style={small}>Sin niveles. Agregá uno para premiar a quien pida más paquetes (ej: desde 3 paquetes, 10% off extra).</div></SurfaceBox>
                  ) : (
                    <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                      {qtyTiers.map((t, i) => (
                        <div key={i} style={{ display:"flex", gap:8, alignItems:"center", background:T.surface, border:`1px solid ${T.borderL}`, padding:"7px 10px", borderRadius:DS.r.md, flexWrap:"wrap" }}>
                          <span style={{ ...small, whiteSpace:"nowrap" }}>Desde</span>
                          <input type="number" min="2" max="10" value={t.min_qty} onChange={e=>updateTier(i, "min_qty", e.target.value)} style={smallNum}/>
                          <span style={{ ...small, whiteSpace:"nowrap" }}>paquetes → descuento</span>
                          <input type="number" min="1" max="80" value={t.discount_pct} onChange={e=>updateTier(i, "discount_pct", e.target.value)} style={{ ...smallNum, width:56 }}/>
                          <span style={small}>%</span>
                          <button onClick={()=>removeTier(i)} type="button" title="Quitar" style={{ marginLeft:"auto", background:"transparent", border:"none", color:T.textSm, fontSize:14, cursor:"pointer", padding:"0 4px", fontFamily:"inherit" }}
                            onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </FormSection>
          )}

          {effectiveMode === "theme" && basePrice > 0 && (
            <SurfaceBox T={T} style={{ marginTop:14 }}>
              {discountNum > 0 && (
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, fontSize:DS.font.md }}>
                  <span style={{ color:T.textSm }}>Precio normal:</span>
                  <span style={{ fontWeight:DS.w.semibold, color:T.text }}>{fmtARS(basePrice)}</span>
                </div>
              )}
              <div style={{ display:"flex", justifyContent:"space-between", gap:10, flexWrap:"wrap", fontSize:DS.font.md }}>
                <span style={{ color:T.accent, fontWeight:DS.w.bold }}>{manual ? "Se cobra:" : "Precio suscripción base:"}</span>
                <span style={{ fontWeight:DS.w.black, color:T.accent, fontSize:DS.font.lg }}>{fmtARS(subPrice)} cada {freqNum} días</span>
              </div>
            </SurfaceBox>
          )}

          <div style={{ display:"flex", gap:8, justifyContent:"flex-end", marginTop:18, paddingTop:14, borderTop:`1px solid ${T.borderL}` }}>
            <Btn T={T} variant="secondary" onClick={onBack}>Cancelar</Btn>
            {saveBtn}
          </div>
        </Card>

        {/* ── Columna derecha: vista previa en vivo ─────────────────── */}
        <Card T={T} style={{ position:"sticky", top:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:10, flexWrap:"wrap", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 }}>Vista previa en vivo</div>
              <div style={small}>{showPacks ? "Así se ve en tu tienda con el diseño global." : "Así lo ve tu cliente al abrir el link."}</div>
            </div>
            {showPacks && onGoWidget && <button type="button" style={linkBtn} onClick={onGoWidget}>Cambiar diseño →</button>}
          </div>
          {!showPacks ? (
            <>
              <LinkCheckoutPreview T={T} title={title} image={itemImage.trim() || plan?.product_image} price={subPrice} frequency={freqNum}
                color={m.widget_color} kindLabel={isService ? "Membresía" : "Suscripción"} storeName={m.store_name || m.shop_name}/>
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.text, marginBottom:6 }}>Link para compartir</div>
                {isEdit
                  ? <SubscriptionLinkBox T={T} merchantId={m.id} planId={plan.id} title={plan.product_title}/>
                  : <div style={small}>Aparece acá cuando guardes el plan. Lo pegás en Instagram, WhatsApp, tu web o lo imprimís como QR.</div>}
              </div>
            </>
          ) : pricingMode === "theme" ? (
            <Callout T={T} tone="info">
              Este plan toma precio, cantidad y frecuencia <strong style={{ color:T.text }}>de tu tema</strong>: el widget solo agrega el toggle Suscripción / Compra única. El selector de packs no aplica acá.
            </Callout>
          ) : (
            <>
              {!basePrice && !isEdit && <div style={{ ...small, marginBottom:8 }}>Elegí un producto para ver tus precios. Mientras tanto, datos de ejemplo.</div>}
              {draftPlan._samplePacks && basePrice > 0 && <div style={{ ...small, marginBottom:8 }}>Todavía no hay packs: mostramos 3 de ejemplo. Tocá "Generar 1·2·3".</div>}
              <BundlePreview plan={draftPlan} merchant={m} minHeight={200}/>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
