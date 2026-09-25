import React, { useState, useEffect, useMemo, useRef } from "react";
import { apiGet, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, InputStyle, Spinner, Callout, toast } from "../ui/components.jsx";
import { Panel, Segmented } from "../ui/charts.jsx";
import { CHECKOUT_THEME_DEFAULTS, CHECKOUT_FONTS, CHECKOUT_FONT_IDS, resolveCheckoutTheme } from "../../shared/platform/checkoutTheme.js";
import { CART_TEXT_DEFAULTS, CART_TOGGLE_DEFAULTS, resolveCartSettings, cartCss, cartShellHtml, cartBodyHtml, cartCtaText } from "../../shared/bundle/cart.js";
import { buildBundleVM } from "../../shared/bundle/viewmodel.js";

// ─── Editor del carrito de la suscripción (Catálogo → Carrito) ─────────────────
// Todo lo que sale en el drawer se edita acá y se ve en vivo a la derecha. Se guarda
// PARCIAL en merchants.cart_settings (solo lo que difiere del default); el widget lo
// recibe resuelto (api/widget.js → CART_TEXTS / CART_THEME). 25-sept-2026, Thiago.
const CART_FIELDS = [
  ["title", "Título del carrito", "Tu suscripción"],
  ["item_sub", "Renglón bajo el nombre del pack", "{{qty}} · te llega {{freq}}"],
  ["gift_once", "Aclaración del regalo que va solo la primera vez", "Solo en tu primer envío"],
  ["gift_always", "Aclaración del regalo que va siempre (vacío = nada)", ""],
  ["row_subtotal", "Fila Subtotal", "Subtotal"],
  ["row_save", "Fila Ahorro", "Ahorrás en cada envío"],
  ["row_ship", "Fila Envío", "Envío"],
  ["ship_value", "Texto del envío", "Se calcula en el siguiente paso"],
  ["row_total", "Fila Total", "Total por envío"],
  ["note", "Nota al pie del resumen", "Se renueva solo {{freq}}. Pausás…"],
  ["cta", "Botón", "Finalizar suscripción · {{total}}"],
  ["more", "Link para seguir viendo", "Seguir viendo"],
  ["footer", "Renglón de seguridad", "🔒 Pago 100% seguro con Mercado Pago"],
];
const CART_TOGGLES = [
  ["show_gifts", "Regalos del pack", "Las franjas “+ GRATIS …” dentro del carrito"],
  ["show_compare", "Precio tachado", "El precio de comparación al lado del precio del pack"],
  ["show_save", "Fila “Ahorrás”", "Cuánto ahorra por envío (solo si hay tachado)"],
  ["show_ship", "Fila “Envío”", "Con el texto de envío de arriba"],
  ["show_note", "Nota al pie", "El texto de renovación / pausar / cancelar"],
  ["show_footer", "Renglón de seguridad", "Debajo de “Seguir viendo”"],
];
const fmtArs = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const escHtml = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function samplePack(plans, merchant) {
  const plan = (plans || []).find(p => p.active !== false && Array.isArray(p.packs) && p.packs.length) || null;
  if (plan) {
    try {
      const vm = buildBundleVM({ plan, merchant });
      const p = vm.packs.find(x => !x.hideSub) || vm.packs[0];
      if (p) return { label: p.label, qty: p.qty, sub_qty: p.subQty || p.qty, price_sub: p.priceSub, price_once: p.priceOnce, compare_at: p.compareAt || 0, freq_label: p.freqLabel || "", image: p.image || plan.product_image || null,
        gifts: (p.gifts || []).map(g => ({ title: g.title, image: g.image, every: g.every || "always" })) };
    } catch (_) {}
  }
  return { label: "Pack 2 unidades", qty: 2, sub_qty: 2, price_sub: 53991, price_once: 59990, compare_at: 99980, freq_label: "mes", image: null, gifts: [{ title: "+ GRATIS: Regalo de ejemplo", every: "once" }] };
}

function CartEditor({ T, iS, merchant, plans, onChange }) {
  const m = merchant || {};
  const saved = (m.cart_settings && typeof m.cart_settings === "object") ? m.cart_settings : {};
  const checkoutTheme = useMemo(() => m.checkout_theme_resolved || resolveCheckoutTheme(m.checkout_theme, { widgetColor: m.widget_color }), [m.checkout_theme_resolved, m.checkout_theme, m.widget_color]);
  const fromSaved = (s) => ({ texts: { ...CART_TEXT_DEFAULTS, ...(s.texts || {}) }, toggles: { ...CART_TOGGLE_DEFAULTS, ...Object.fromEntries(Object.keys(CART_TOGGLE_DEFAULTS).filter(k => typeof s[k] === "boolean").map(k => [k, s[k]])) }, colors: { color: s.color || "", bg: s.bg || "", text: s.text || "" } });
  const [draft, setDraft] = useState(() => fromSaved(saved));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(fromSaved(saved)); /* eslint-disable-next-line */ }, [m.id, JSON.stringify(saved)]);

  // Solo lo que difiere del default viaja al server.
  const diff = useMemo(() => {
    const out = {}; const texts = {};
    for (const k of Object.keys(CART_TEXT_DEFAULTS)) if ((draft.texts[k] ?? "") !== CART_TEXT_DEFAULTS[k]) texts[k] = draft.texts[k] === "" ? "x" : draft.texts[k];
    if (Object.keys(texts).length) out.texts = texts;
    for (const k of Object.keys(CART_TOGGLE_DEFAULTS)) if (draft.toggles[k] !== CART_TOGGLE_DEFAULTS[k]) out[k] = draft.toggles[k];
    if (!draft.toggles.use_checkout_theme) for (const k of ["color", "bg", "text"]) if (/^#[0-9a-fA-F]{6}$/.test(draft.colors[k] || "")) out[k] = draft.colors[k].toLowerCase();
    return out;
  }, [draft]);
  const dirty = JSON.stringify(diff) !== JSON.stringify(saved);

  // Vista previa: el MISMO render que el widget.
  const resolved = useMemo(() => {
    const r = resolveCartSettings(diff, checkoutTheme);
    // Un texto vaciado se apaga ("x" en el diff → "" acá).
    for (const k of Object.keys(r.texts)) if (r.texts[k] === "x") r.texts[k] = "";
    return r;
  }, [diff, checkoutTheme]);
  const pack = useMemo(() => samplePack(plans, { ...m, widget_variant: m.widget_variant }), [plans, m]);
  const previewHtml = useMemo(() => {
    const TXT = { ...resolved.texts, ...resolved.toggles };
    let shell = cartShellHtml(TXT, escHtml);
    const body = cartBodyHtml(pack, TXT, fmtArs, escHtml, "");
    shell = shell.replace('<div class="rc-cart-b"></div>', '<div class="rc-cart-b">' + body + "</div>")
      .replace('<button type="button" class="rc-cart-go"></button>', '<button type="button" class="rc-cart-go">' + escHtml(cartCtaText(TXT, fmtArs(pack.price_sub))) + "</button>");
    return shell;
  }, [resolved, pack]);
  const previewCss = useMemo(() => cartCss(resolved.theme)
    // en el panel el drawer se ve quieto, sin overlay ni animación
    .replace(".rc-cart{position:absolute;top:0;right:0;bottom:0;width:min(420px,100%);", ".rc-cart{position:relative;width:100%;max-width:380px;min-height:560px;border-radius:14px;overflow:hidden;")
    .replace("transform:translateX(100%);transition:transform .3s cubic-bezier(.22,1,.36,1);", "")
    .replace("@media (max-width:520px){.rc-cart{width:min(420px,92%)}}", ""), [resolved.theme]);

  const setText = (k, v) => setDraft(d => ({ ...d, texts: { ...d.texts, [k]: v } }));
  const setToggle = (k, v) => setDraft(d => ({ ...d, toggles: { ...d.toggles, [k]: v } }));
  const setColor = (k, v) => setDraft(d => ({ ...d, colors: { ...d.colors, [k]: v } }));

  async function save(settings) {
    setSaving(true);
    const d = await apiPatch("merchant", { cart_settings: settings }, { action: "save-settings" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(Object.keys(settings).length ? "Carrito guardado. Ya lo ven tus clientes." : "El carrito volvió al diseño por defecto.");
    onChange?.();
  }
  const sec = { fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 };

  return (
    <Panel T={T} title="Textos y diseño del carrito" sub="Todo lo que ve tu cliente al tocar Suscribirme. A la derecha, tal cual sale en tu tienda."
      right={<div style={{ display:"flex", gap:8, alignItems:"center" }}>
        <Btn T={T} variant="secondary" size="sm" onClick={() => setDraft(fromSaved({}))} disabled={saving || !Object.keys(diff).length}>Volver al default</Btn>
        <Btn T={T} variant="solid" size="sm" onClick={() => save(diff)} disabled={saving || !dirty}>{saving ? <><Spinner size={12}/> Guardando…</> : "Guardar"}</Btn>
      </div>}>
      <div className="rc-ckd" style={{ display:"grid", gridTemplateColumns:"minmax(280px, 420px) minmax(0, 1fr)", gap:DS.sp.xl, padding:"0 16px 16px", alignItems:"start" }}>
        <div style={{ minWidth:0 }}>
          <div style={sec}>Textos</div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:4, lineHeight:1.45 }}>{"{{qty}}"} = cantidad, {"{{freq}}"} = frecuencia (“cada mes”), {"{{total}}"} = monto. Dejá un campo vacío para sacar ese texto.</div>
          {CART_FIELDS.map(([k, label, ph]) => (
            <div key={k}>
              <Lbl T={T}>{label}</Lbl>
              {k === "note"
                ? <textarea value={draft.texts[k]} onChange={e => setText(k, e.target.value)} rows={3} maxLength={300} placeholder={ph} style={{ ...iS, resize:"vertical", lineHeight:1.45 }}/>
                : <input value={draft.texts[k]} onChange={e => setText(k, e.target.value)} placeholder={ph} maxLength={k === "footer" ? 80 : 60} style={iS}/>}
            </div>
          ))}
          <div style={{ ...sec, marginTop:18 }}>Qué se muestra</div>
          {CART_TOGGLES.map(([k, label, hint]) => <Toggle key={k} T={T} label={label} hint={hint} on={draft.toggles[k]} onChange={v => setToggle(k, v)}/>)}
          <div style={{ ...sec, marginTop:18 }}>Colores</div>
          <Toggle T={T} label="Usar los colores del checkout" hint="Acento, fondo y texto iguales a Catálogo → Checkout (recomendado: todo combina solo)" on={draft.toggles.use_checkout_theme} onChange={v => setToggle("use_checkout_theme", v)}/>
          {!draft.toggles.use_checkout_theme && (<>
            <ColorRow T={T} label="Color principal" hint="Botón y ahorro" value={draft.colors.color || checkoutTheme.color} fallback={checkoutTheme.color} onChange={v => setColor("color", v)}/>
            <ColorRow T={T} label="Fondo" hint="Fondo del carrito" value={draft.colors.bg || checkoutTheme.bg} fallback={checkoutTheme.bg} onChange={v => setColor("bg", v)}/>
            <ColorRow T={T} label="Texto" hint="Color del texto" value={draft.colors.text || checkoutTheme.text} fallback={checkoutTheme.text} onChange={v => setColor("text", v)}/>
          </>)}
        </div>
        <div className="rc-ckd-prev" style={{ position:"sticky", top:16 }}>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginBottom:8 }}>Vista previa en vivo{pack.label ? ` · ${pack.label}` : ""}. Los datos salen de tu primer plan con packs.</div>
          <div style={{ background:T.isDark ? "rgba(255,255,255,0.04)" : "#eef0f2", borderRadius:16, padding:18, display:"flex", justifyContent:"center" }}>
            <style>{previewCss}</style>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }}/>
          </div>
        </div>
      </div>
    </Panel>
  );
}

// ─── Configuración → Checkout: el diseñador del checkout hosteado ─────────────
// (Thiago, 24-sept-2026: "que cada persona pueda cambiar su checkout: colores, textos,
// letra, si aparecen las políticas, el descuento… todo configurable").
// La vista previa es el checkout REAL en un iframe (#/checkout?preview=1) con el primer
// plan activo; cada cambio se le empuja por postMessage, sin recargar. Se guarda solo lo
// que el comerciante tocó (PATCH save-settings { checkout_theme }); sin personalizar, el
// acento es el color del widget.

const HEX = /^#[0-9a-fA-F]{6}$/;

function ColorRow({ T, label, hint, value, fallback, onChange }) {
  const v = HEX.test(value || "") ? value : fallback;
  return (
    <label style={{ display:"flex", alignItems:"center", gap:12, padding:"9px 0", borderBottom:`1px solid ${T.borderL}` }}>
      <input type="color" value={v} onChange={e => onChange(e.target.value)} style={{ width:38, height:32, border:`1px solid ${T.border}`, borderRadius:8, padding:2, background:"transparent", cursor:"pointer", flexShrink:0 }}/>
      <span style={{ flex:1, minWidth:0 }}>
        <span style={{ display:"block", fontSize:DS.font.md, fontWeight:600, color:T.text }}>{label}</span>
        {hint ? <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:1 }}>{hint}</span> : null}
      </span>
      <span style={{ fontFamily:"ui-monospace,Menlo,monospace", fontSize:DS.font.sm, color:T.textSm }}>{v}</span>
    </label>
  );
}
function Toggle({ T, label, hint, on, onChange }) {
  return (
    <label style={{ display:"flex", alignItems:"flex-start", gap:10, padding:"9px 0", borderBottom:`1px solid ${T.borderL}`, cursor:"pointer" }}>
      <input type="checkbox" checked={!!on} onChange={e => onChange(e.target.checked)} style={{ width:18, height:18, marginTop:1, accentColor:T.accentSolid, flexShrink:0 }}/>
      <span style={{ minWidth:0 }}>
        <span style={{ display:"block", fontSize:DS.font.md, fontWeight:600, color:T.text }}>{label}</span>
        {hint ? <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:1, lineHeight:1.4 }}>{hint}</span> : null}
      </span>
    </label>
  );
}
const Lbl = ({ T, children }) => <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"14px 0 6px" }}>{children}</div>;

// `section`: "theme" (Catálogo → Checkout: diseño) o "cart" (Catálogo → Carrito: los extras
// "Sumá a tu suscripción"). Thiago, 25-sept-2026: el carrito con sus upsells es una pestaña aparte.
export default function CheckoutDesigner({ merchant, onChange, section = "theme" }) {
  const showCart = section === "cart", showTheme = section !== "cart";
  const T = useT();
  const iS = InputStyle(T);
  const m = merchant || {};
  const saved = (m.checkout_theme && typeof m.checkout_theme === "object") ? m.checkout_theme : {};
  const base = useMemo(() => resolveCheckoutTheme(null, { widgetColor: m.widget_color }), [m.widget_color]);

  // Borrador = defaults resueltos + lo guardado. Se guarda solo lo que difiere del default.
  const [draft, setDraft] = useState(() => ({ ...base, ...saved }));
  const [saving, setSaving] = useState(false);
  const [device, setDevice] = useState("desktop");
  const [plans, setPlans] = useState(null);
  const frame = useRef(null);
  useEffect(() => { setDraft({ ...base, ...saved }); /* eslint-disable-next-line */ }, [m.id, JSON.stringify(saved), base.color]);
  useEffect(() => { apiGet("plans").then(d => setPlans(d?.plans || [])).catch(() => setPlans([])); }, [m.id]);

  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  // Logo arriba de todo: se achica en el navegador (máx. 600×200, conserva la transparencia) y
  // se guarda como PNG en el tema (≤ 150 KB; si pesa más, prueba WebP).
  function loadLogo(file) {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const k = Math.min(1, 600 / img.width, 200 / img.height);
        const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL("image/png");
        if (out.length > 200000) out = c.toDataURL("image/webp", 0.9);
        if (out.length > 200000) return toast("El logo pesa demasiado. Probá con uno más chico.", "error", 6000);
        set("header_logo", out);
      } catch (_) { toast("No pudimos leer esa imagen.", "error", 5000); }
      finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast("No pudimos leer esa imagen.", "error", 5000); };
    img.src = url;
  }
  const diff = useMemo(() => {
    const out = {};
    for (const k of Object.keys(CHECKOUT_THEME_DEFAULTS)) if (draft[k] !== undefined && draft[k] !== base[k]) out[k] = draft[k];
    return out;
  }, [draft, base]);
  const dirty = JSON.stringify(diff) !== JSON.stringify(saved);

  const plan = useMemo(() => (plans || []).find(p => p.active !== false) || (plans || [])[0] || null, [plans]);
  const previewUrl = useMemo(() => {
    if (!plan) return "";
    const { header_logo, ...light } = diff;
    const q = new URLSearchParams({ merchant: m.id, plan: plan.id, preview: "1", theme: JSON.stringify(light) });
    if (plan.pricing_mode === "packs" || (Array.isArray(plan.packs) && plan.packs.length)) q.set("pack", "0");
    return `${window.location.origin}${window.location.pathname}#/checkout?${q.toString()}`;
    // La URL no cambia con el borrador: los cambios viajan por postMessage (sin recargar).
    // eslint-disable-next-line
  }, [plan, m.id]);
  useEffect(() => {
    try { frame.current?.contentWindow?.postMessage({ type: "rec-checkout-theme", theme: diff }, window.location.origin); } catch (_) {}
  }, [diff]);

  // Upsells: planes de la tienda que el comprador puede sumar desde el resumen (máx. 4).
  const [ups, setUps] = useState(() => Array.isArray(m.checkout_upsells) ? m.checkout_upsells : []);
  const [upsSaving, setUpsSaving] = useState(false);
  useEffect(() => { setUps(Array.isArray(m.checkout_upsells) ? m.checkout_upsells : []); /* eslint-disable-next-line */ }, [m.id, JSON.stringify(m.checkout_upsells)]);
  const upsDirty = JSON.stringify(ups) !== JSON.stringify(Array.isArray(m.checkout_upsells) ? m.checkout_upsells : []);
  async function saveUps() {
    setUpsSaving(true);
    const d = await apiPatch("merchant", { checkout_upsells: ups }, { action: "save-settings" }).catch(e => ({ error: e.message }));
    setUpsSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(ups.length ? "Listo: tus clientes ya pueden sumarlos en el checkout." : "Sin extras en el checkout.");
    onChange?.(); try { frame.current?.contentWindow?.location.reload(); } catch (_) {}
  }
  async function save(theme) {
    setSaving(true);
    const d = await apiPatch("merchant", { checkout_theme: theme }, { action: "save-settings" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(Object.keys(theme).length ? "Checkout guardado. Ya lo ven tus clientes." : "Volvió al diseño por defecto.");
    onChange?.();
  }

  const sec = { fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.2 };
  const fontOpts = CHECKOUT_FONT_IDS.map(id => ({ id, label: CHECKOUT_FONTS[id].label }));

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      {showCart && <Panel T={T} title="Sumá a tu suscripción (extras en el carrito)" sub="Hasta 4 productos de tu catálogo que el cliente puede agregar a su suscripción desde el resumen. Llegan en cada envío y se cobran con cada renovación."
        right={<Btn T={T} variant="solid" size="sm" onClick={saveUps} disabled={upsSaving || !upsDirty}>{upsSaving ? <><Spinner size={12}/> Guardando…</> : "Guardar extras"}</Btn>}>
        <div style={{ padding:"0 16px 16px" }}>
          {plans === null ? <Spinner size={16}/> : !(plans || []).filter(p => p.active !== false && Number(p.subscription_price_ars) > 0).length
            ? <Callout T={T} tone="info">Creá al menos otro plan (con precio por unidad) para ofrecerlo como extra.</Callout>
            : <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(240px, 1fr))", gap:8 }}>
                {(plans || []).filter(p => p.active !== false && Number(p.subscription_price_ars) > 0).map(p => { const on = ups.includes(p.id); const full = !on && ups.length >= 4; return (
                  <label key={p.id} style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 12px", borderRadius:12, cursor: full ? "not-allowed" : "pointer", border:`1px solid ${on ? T.accentSolid + "66" : T.border}`, background: on ? T.accentSolid + "0f" : T.surface, opacity: full ? .5 : 1 }}>
                    <input type="checkbox" checked={on} disabled={full} onChange={e => setUps(u => e.target.checked ? [...u, p.id].slice(0, 4) : u.filter(x => x !== p.id))} style={{ width:18, height:18, accentColor:T.accentSolid }}/>
                    {p.product_image ? <img src={p.product_image} alt="" style={{ width:36, height:36, borderRadius:8, objectFit:"cover" }}/> : null}
                    <span style={{ minWidth:0 }}><span style={{ display:"block", fontSize:DS.font.md, fontWeight:600, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.product_title || p.name}</span><span style={{ fontSize:DS.font.sm, color:T.textSm }}>${Math.round(Number(p.subscription_price_ars) || 0).toLocaleString("es-AR")} por unidad</span></span>
                  </label>
                ); })}
              </div>}
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:10 }}>Cada extra suma su precio de suscripción por unidad al cobro y va como renglón propio en la orden de tu tienda.</div>
        </div>
      </Panel>}
      {showCart && <CartEditor T={T} iS={iS} merchant={m} plans={plans} onChange={onChange}/>}
      {showTheme && <Panel T={T} title="Diseño del checkout" sub="Lo que ve tu cliente al suscribirse. Si no tocás nada, sale con el color de tu widget."
        right={<div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <Btn T={T} variant="secondary" size="sm" onClick={() => { setDraft({ ...base }); }} disabled={saving || !Object.keys(diff).length}>Volver al default</Btn>
          <Btn T={T} variant="solid" size="sm" onClick={() => save(diff)} disabled={saving || !dirty}>{saving ? <><Spinner size={12}/> Guardando…</> : "Guardar"}</Btn>
        </div>}>
        <div className="rc-ckd" style={{ display:"grid", gridTemplateColumns:"minmax(280px, 380px) minmax(0, 1fr)", gap:DS.sp.xl, padding:"0 16px 16px", alignItems:"start" }}>
          <style>{`@media(max-width:1000px){ .rc-ckd{grid-template-columns:1fr!important;} .rc-ckd-prev{position:static!important;} }`}</style>
          {/* Controles */}
          <div style={{ minWidth:0 }}>
            <div style={sec}>Colores</div>
            <ColorRow T={T} label="Color principal" hint="Botón de pagar, opciones elegidas y el logo que gira al cargar" value={draft.color} fallback={base.color} onChange={v => set("color", v)}/>
            <ColorRow T={T} label="Fondo del formulario" value={draft.bg} fallback={base.bg} onChange={v => set("bg", v)}/>
            <ColorRow T={T} label="Fondo del resumen" hint="La columna gris con el producto y el total" value={draft.summary_bg} fallback={base.summary_bg} onChange={v => set("summary_bg", v)}/>
            <ColorRow T={T} label="Texto" value={draft.text} fallback={base.text} onChange={v => set("text", v)}/>

            <div style={{ ...sec, marginTop:18 }}>Letra y forma</div>
            <Lbl T={T}>Tipografía</Lbl>
            <Segmented T={T} options={fontOpts} value={draft.font} onChange={v => set("font", v)} ariaLabel="Tipografía"/>
            <Lbl T={T}>Bordes redondeados · {draft.radius}px</Lbl>
            <input type="range" min={0} max={24} value={draft.radius} onChange={e => set("radius", Number(e.target.value))} style={{ width:"100%", accentColor:T.accentSolid }}/>

            <div style={{ ...sec, marginTop:18 }}>Textos</div>
            <Lbl T={T}>Arriba de todo</Lbl>
            {draft.header_logo ? (
              <div style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 12px", border:`1px solid ${T.border}`, borderRadius:10, background:T.isDark ? "rgba(255,255,255,0.04)" : "#fafafa" }}>
                <img src={draft.header_logo} alt="" style={{ maxHeight:40, maxWidth:160, objectFit:"contain", display:"block" }}/>
                <span style={{ fontSize:DS.font.sm, color:T.textSm, flex:1 }}>Tu logo va en lugar del texto.</span>
                <Btn T={T} variant="secondary" size="sm" onClick={() => set("header_logo", "")}>Quitar</Btn>
              </div>
            ) : (<>
              <input value={draft.header_text} onChange={e => set("header_text", e.target.value)} placeholder={m.store_name || "Nombre de tu tienda"} maxLength={80} style={iS}/>
              <label style={{ display:"inline-flex", alignItems:"center", gap:6, marginTop:6, fontSize:DS.font.sm, color:T.accentSolid, fontWeight:600, cursor:"pointer" }}>
                <input type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml" style={{ display:"none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadLogo(f); }}/>
                o subí tu logo (PNG con fondo transparente, ideal)
              </label>
            </>)}
            <Lbl T={T}>Botón de pagar</Lbl>
            <input value={draft.cta_text} onChange={e => set("cta_text", e.target.value)} placeholder="Pagar suscripción · {{total}}" maxLength={60} style={iS}/>
            <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:4 }}>{"{{total}}"} se reemplaza por el monto.</div>
            <Lbl T={T}>Debajo del total</Lbl>
            <textarea value={draft.footer_text} onChange={e => set("footer_text", e.target.value)} rows={3} maxLength={300} placeholder="Se cobra $X ahora y se renueva automáticamente. Podés pausar o cancelar cuando quieras." style={{ ...iS, resize:"vertical", lineHeight:1.45 }}/>

            <div style={{ ...sec, marginTop:18 }}>Qué se muestra</div>
            <Toggle T={T} label="Foto de la tienda" hint={m.store_photo ? "La que cargaste en Configuración → Tiendas" : "Cargá una foto en Configuración → Tiendas para verla acá"} on={draft.show_logo} onChange={v => set("show_logo", v)}/>
            <Toggle T={T} label="Código de descuento" hint="La caja para escribir un cupón" on={draft.show_discount} onChange={v => set("show_discount", v)}/>
            <Toggle T={T} label="Renglón de confianza" hint="“Envío automático cada 30 días · Pago seguro con Mercado Pago”, con la frecuencia real del plan" on={draft.show_trust} onChange={v => set("show_trust", v)}/>
            <Toggle T={T} label="Políticas" hint="Links a tus términos y política de privacidad debajo del botón" on={draft.show_policies} onChange={v => set("show_policies", v)}/>
            {draft.show_policies ? (
              <div style={{ paddingLeft:28 }}>
                <Lbl T={T}>Texto</Lbl>
                <input value={draft.policies_text} onChange={e => set("policies_text", e.target.value)} placeholder="Al pagar aceptás los términos y la política de privacidad." maxLength={200} style={iS}/>
                <Lbl T={T}>Link a términos y condiciones</Lbl>
                <input value={draft.terms_url} onChange={e => set("terms_url", e.target.value)} placeholder="https://tutienda.com/pages/terminos" style={iS}/>
                <Lbl T={T}>Link a política de privacidad</Lbl>
                <input value={draft.privacy_url} onChange={e => set("privacy_url", e.target.value)} placeholder="https://tutienda.com/pages/privacidad" style={iS}/>
              </div>
            ) : null}
            <Lbl T={T}>Resumen en celular</Lbl>
            <Segmented T={T} options={[{ id:"top", label:"Arriba, desplegable" }, { id:"before_pay", label:"Antes del botón" }]} value={draft.summary_mobile} onChange={v => set("summary_mobile", v)} ariaLabel="Resumen en celular"/>
          </div>

          {/* Vista previa */}
          <div className="rc-ckd-prev" style={{ position:"sticky", top:12, minWidth:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10, flexWrap:"wrap" }}>
              <Segmented T={T} options={[{ id:"desktop", label:"Computadora" }, { id:"mobile", label:"Celular" }]} value={device} onChange={setDevice} ariaLabel="Dispositivo"/>
              <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Vista previa en vivo{plan ? ` · ${plan.product_title || plan.name || "tu plan"}` : ""}. No cobra.</span>
              {previewUrl ? <a href={previewUrl} target="_blank" rel="noopener" style={{ marginLeft:"auto", fontSize:DS.font.sm, color:T.accent, fontWeight:600 }}>Abrir en una pestaña</a> : null}
            </div>
            {plans === null ? <div style={{ padding:40, textAlign:"center", color:T.textSm }}><Spinner size={16}/></div>
              : !plan ? <Callout T={T} tone="info">Creá un plan en Planes para ver el checkout con un producto real.</Callout>
              : (
                <div style={{ display:"flex", justifyContent:"center", background:T.bg, border:`1px solid ${T.border}`, borderRadius:14, padding: device === "mobile" ? "16px 0" : 0, overflow:"hidden" }}>
                  <iframe ref={frame} title="Vista previa del checkout" src={previewUrl} onLoad={() => { try { frame.current?.contentWindow?.postMessage({ type: "rec-checkout-theme", theme: diff }, window.location.origin); } catch (_) {} }}
                    style={{ width: device === "mobile" ? 390 : "100%", maxWidth:"100%", height: device === "mobile" ? 780 : 820, border: device === "mobile" ? `10px solid #111` : "none", borderRadius: device === "mobile" ? 34 : 0, background:"#fff", display:"block" }}/>
                </div>
              )}
          </div>
        </div>
      </Panel>}
    </div>
  );
}
