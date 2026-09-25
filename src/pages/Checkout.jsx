import React, { useState, useEffect, useRef } from "react";
import { resolvePack } from "../../shared/bundle/viewmodel.js";
import { AppLoader } from "../ui/components.jsx";
import { discountAmountFor } from "../../shared/platform/discounts.js";
import { resolveCheckoutTheme, ctaText } from "../../shared/platform/checkoutTheme.js";

// Checkout propio de Recurrentes (hosteado). Dos entradas:
//   · Link de suscripción (negocios sin tienda: servicios, digitales, venta por link):
//       #/checkout?merchant=<uid>&plan=<planId>
//   · Legacy Shopify (entre el widget del producto y el pago):
//       #/checkout?merchant=<uid>&product=<shopify_product_id>&qty=<n>
//   opcionales de display: &img=<url>&title=<txt>&color=<hex>&qty=<n>
//
// Qué datos pide sale del perfil del negocio (GET public?action=plan&checkout=1 →
// `checkout`, ver shared/platform/profile.js): sin envío no pide dirección ni
// muestra envíos; teléfono y DNI obligatorios solo si el perfil lo exige. Sin
// `checkout` en la respuesta (backend viejo) se comporta como antes (físico).

// Provincia a partir del código postal (4 dígitos, rangos oficiales del Correo). Sirve para
// que los envíos empiecen a cotizar apenas se escribe el CP, sin esperar la provincia; se
// precarga en el selector y el comprador la puede cambiar (25-sept-2026, Thiago).
const CP_RANGOS = [
  [1000, 1499, "Ciudad Autónoma de Buenos Aires"], [1500, 2999, "Buenos Aires"],
  [2000, 2999, "Santa Fe"], [3000, 3099, "Santa Fe"], [3100, 3299, "Entre Ríos"], [3300, 3399, "Misiones"],
  [3400, 3499, "Corrientes"], [3500, 3599, "Chaco"], [3600, 3699, "Formosa"], [3700, 3799, "Chaco"],
  [4000, 4199, "Tucumán"], [4200, 4399, "Santiago del Estero"], [4400, 4599, "Salta"], [4600, 4699, "Jujuy"],
  [4700, 4799, "Catamarca"], [5000, 5299, "Córdoba"], [5300, 5399, "La Rioja"], [5400, 5499, "San Juan"],
  [5500, 5699, "Mendoza"], [5700, 5799, "San Luis"], [5800, 5999, "Córdoba"], [6000, 6299, "Buenos Aires"],
  [6300, 6399, "La Pampa"], [6400, 8199, "Buenos Aires"], [8200, 8299, "Río Negro"], [8300, 8399, "Neuquén"],
  [8400, 8599, "Río Negro"], [9000, 9299, "Chubut"], [9300, 9409, "Santa Cruz"], [9410, 9499, "Tierra del Fuego"],
];
function provinciaPorCP(cp) {
  const m = String(cp || "").match(/(\d{4})/);
  if (!m) return "";
  const n = Number(m[1]);
  // El rango 1500–2999 de Buenos Aires pisa al de Santa Fe (2000–2999): Santa Fe gana ahí.
  if (n >= 2000 && n <= 2999) return "Santa Fe";
  const r = CP_RANGOS.find(([a, b]) => n >= a && n <= b);
  return r ? r[2] : "";
}

const PROVINCIAS = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut",
  "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function qParams() {
  const hash = window.location.hash || "";
  const qs = hash.split("?")[1] || window.location.search.slice(1) || "";
  return new URLSearchParams(qs);
}

// Datos de atribución de Meta. El widget los pasa por la URL (fbp/fbc de las cookies de
// la tienda + src = página del producto); si no vienen, probamos las cookies de acá y el
// fbclid. Van a checkout/init para AddToCart / InitiateCheckout / Purchase (CAPI).
function fbAttribution(p) {
  const cookie = (n) => { try { const m = document.cookie.match(new RegExp("(^|;\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[2]) : ""; } catch (_) { return ""; } };
  let fbc = p.get("fbc") || cookie("_fbc");
  if (!fbc) { const id = p.get("fbclid"); if (id) fbc = "fb.1." + Date.now() + "." + id; }
  let src = p.get("src") || "";
  if (!src) { try { src = document.referrer || window.location.href; } catch (_) { src = ""; } }
  return { fbp: p.get("fbp") || cookie("_fbp"), fbc, event_source_url: src, user_agent: (typeof navigator !== "undefined" && navigator.userAgent) || "" };
}
const viewId = () => { try { return crypto.randomUUID().replace(/-/g, ""); } catch (_) { return String(Date.now()) + Math.random().toString(36).slice(2, 8); } };

// Campo con etiqueta flotante (estilo Shopify). Vive fuera del componente: si se
// definiera adentro, React lo trataría como un tipo nuevo en cada render y el input
// perdería el foco a cada tecla.
// `error`: texto debajo del campo + borde rojo (estilo Shopify, 25-sept-2026). `onFix` se llama
// al tipear para sacar el error apenas el comprador corrige.
const Field = ({ label, children, error, onFix }) => (
  <div className={"rc-f" + (error ? " is-err" : "")} onInput={error ? onFix : undefined} onChange={error ? onFix : undefined}>
    {children}<label>{label}</label>
    {error ? <div className="rc-fe" role="alert">{error}</div> : null}
  </div>
);
// Desliza hasta el primer campo con error (el de más arriba) y le da el foco: en celular el
// botón queda abajo de todo y el comprador no ve qué le falta.
function scrollToFirstError() {
  requestAnimationFrame(() => {
    try {
      const el = document.querySelector(".rc-ck .rc-f.is-err, .rc-ck .rc-fe[data-f]");
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.querySelector("input,select")?.focus({ preventScroll: true });
    } catch (_) {}
  });
}

// "cada 30 días" o "cada mes", según cómo lo configuró la tienda en el widget (freq_unit
// del pack: días o meses). Sin unidad → días, salvo que sea exactamente 1 mes.
function freqText(days, unit) {
  const d = Number(days) || 0;
  if (d <= 0) return "";
  if (unit === "meses") {
    const m = Math.max(1, Math.round(d / 30));
    return m === 1 ? "cada mes" : `cada ${m} meses`;
  }
  if (d === 1) return "cada día";
  if (d === 7) return "cada semana";
  return `cada ${d} días`;
}

export default function Checkout() {
  const p = qParams();
  const merchant = p.get("merchant") || "";
  const product = p.get("product") || "";
  const planParam = p.get("plan") || "";
  const qtyParam = Math.max(1, Math.min(10, parseInt(p.get("qty")) || 1));
  // Planes en modo packs (Tiendanube y link directo): ?pack=<índice>. El pack fija
  // cantidad, precio y frecuencia; el server lo vuelve a resolver en checkout/init.
  const packParam = p.get("pack");
  // Frecuencia elegida en el widget (modo tema: 30/60/120 días según el pack) y
  // código de descuento o link de recupero (?code= / ?rc=) que antes tomaba el
  // checkout dentro de la tienda.
  const freqParam = Math.max(0, parseInt(p.get("freq_days")) || 0);
  const codeParam = (p.get("code") || "").trim().toUpperCase();
  const rcParam = p.get("rc") || "";
  // Modelo bundle del tema (Lumina y páginas viejas): variante exacta, precio del
  // pack (`base`, total por qty) y descuento de suscripción (`sub_off`). El server
  // los vuelve a validar contra el precio de la tienda.
  const variantParam = p.get("variant") || "";
  const baseParam = Math.max(0, Math.round(parseFloat(p.get("base")) || 0));
  const subOffParam = Math.max(0, Math.min(90, parseFloat(p.get("sub_off")) || 0));
  const packIdx = packParam == null || packParam === "" ? null : Math.max(0, parseInt(packParam, 10) || 0);
  const img = p.get("img") || "";
  const titleOverride = p.get("title") || "";
  const colorParam = /^#[0-9a-fA-F]{6}$/.test(p.get("color") || "") ? p.get("color") : "";
  // Vista previa del diseñador (Configuración → Checkout): ?preview=1&theme=<json>. No manda
  // eventos, no registra leads y el botón de pagar no paga. El diseñador también empuja
  // cambios en vivo por postMessage ({ type:"rec-checkout-theme", theme }).
  const isPreview = p.get("preview") === "1";
  const [previewTheme, setPreviewTheme] = useState(() => { try { return isPreview && p.get("theme") ? JSON.parse(p.get("theme")) : null; } catch (_) { return null; } });
  useEffect(() => {
    if (!isPreview) return;
    const onMsg = (e) => { if (e.origin !== window.location.origin) return; if (e.data && e.data.type === "rec-checkout-theme" && e.data.theme && typeof e.data.theme === "object") setPreviewTheme(e.data.theme); };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [isPreview]);
  // Acento para el "cargando" ANTES de tener el tema: el que pasó el widget en la URL, o
  // el que quedó guardado de la última visita a esta tienda. Así el logo ya gira del
  // color de la tienda desde el primer instante (Thiago, 24-sept).
  const cachedColor = (() => { try { const v = localStorage.getItem("rec_ck_color_" + merchant); return /^#[0-9a-fA-F]{6}$/.test(v || "") ? v : ""; } catch (_) { return ""; } })();
  const [showSummary, setShowSummary] = useState(false);
  // Extras ("Sumá a tu suscripción"): { plan_id: qty }. El server vuelve a validar precio y plan.
  const [extras, setExtras] = useState({});

  const [plan, setPlan] = useState(null);
  const [codeInput, setCodeInput] = useState(codeParam);
  const [discount, setDiscount] = useState(null);   // { code, type, value, first_charge_only, viaRecovery }
  const [codeMsg, setCodeMsg] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [email, setEmail] = useState("");
  // "Pago iniciado": apenas deja un mail válido registramos el lead (carrito sin pagar +
  // Meta InitiateCheckout). Una vez por mail; el server reusa el lead y no duplica.
  const leadSent = useRef("");
  function captureLead() {
    const em = email.trim().toLowerCase();
    if (isPreview || !plan || !EMAIL_RE.test(em) || leadSent.current === em) return;
    leadSent.current = em;
    try {
      const body = {
        merchant_id: merchant, plan_id: plan.id, capture: true, quantity: qty,
        ...(pack ? { pack_index: pack.idx } : {}),
        ...(!pack && freqParam ? { frequency_days: freqParam } : {}),
        ...(!pack && baseParam > 0 ? { base_price: baseParam, sub_discount: subOffParam } : {}),
        customer: { email: em, name: name.trim(), phone: phone.trim() },
        fb: fbAttribution(qParams()),
      };
      fetch("/api/checkout/init", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true, body: JSON.stringify(body) }).catch(() => {});
    } catch (_) {}
  }
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [taxid, setTaxid] = useState("");
  const [address1, setAddress1] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [zip, setZip] = useState("");
  const [address2, setAddress2] = useState("");
  // WhatsApp: casilla marcada por defecto, solo si la tienda tiene los avisos prendidos.
  const [waOptin, setWaOptin] = useState(true);

  const [rates, setRates] = useState([]);
  const [rateIdx, setRateIdx] = useState(0);
  const [ratesLoading, setRatesLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const redirected = useRef(false);
  // Si el comprador se va a Mercado Pago y vuelve con "atrás", el navegador restaura la
  // página tal cual quedó (bfcache) con el botón en "Redirigiendo…". Al volver a mostrarse,
  // el botón vuelve a decir Pagar por si se arrepiente de arrepentirse (25-sept-2026, Thiago).
  useEffect(() => {
    const back = () => { setSubmitting(false); redirected.current = false; };
    const onShow = (e) => { if (e.persisted) back(); };
    // Solo después de haber mandado al comprador a MP: si cambia de pestaña mientras el pedido
    // todavía se está creando, el botón sigue bloqueado (evita dos pedidos).
    const onVis = () => { if (document.visibilityState === "visible" && redirected.current) back(); };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pageshow", onShow); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  const [formErr, setFormErr] = useState("");
  const [errs, setErrs] = useState({}); // por campo: { email: "Ingresá un email válido", ... }
  const fix = (k) => () => setErrs(e => (e[k] ? Object.fromEntries(Object.entries(e).filter(([kk]) => kk !== k)) : e));

  // Cargar el plan activo (por id o por producto) + qué pedir según el negocio.
  useEffect(() => {
    if (!merchant || (!product && !planParam)) { setLoadErr("Faltan datos de la suscripción. Volvé al link que te pasaron e intentá de nuevo."); setLoading(false); return; }
    let ok = true;
    (async () => {
      try {
        const q = new URLSearchParams({ action: "plan", merchant, checkout: "1" });
        if (planParam) q.set("plan", planParam); else q.set("product", product);
        if (variantParam) q.set("variant", variantParam);
        const r = await fetch(`/api/public?${q.toString()}`);
        const d = await r.json();
        if (!ok) return;
        if (d.error || !d.plan) setLoadErr("Esta suscripción no está disponible. Puede que el plan se haya pausado.");
        else if (d.plan.pricing_mode === "packs" && (packIdx == null || !resolvePack(d.plan, packIdx))) setLoadErr("Este plan se contrata desde la página del producto en la tienda.");
        else {
          setPlan(d.plan); setCfg(d.checkout || null);
          try { const c = d.checkout?.theme?.color; if (c) localStorage.setItem("rec_ck_color_" + merchant, c); } catch (_) {}
          // Meta "carrito" (AddToCart): se abrió el checkout. Best-effort, sin esperar.
          if (!isPreview) try {
            const pk = d.plan.pricing_mode === "packs" && packIdx != null ? resolvePack(d.plan, packIdx) : null;
            const value = pk ? Number(pk.total_ars || pk.price_ars || 0) : Number(d.plan.subscription_price_ars || 0) * qtyParam;
            fetch("/api/checkout/init", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
              body: JSON.stringify({ event: "view", merchant_id: merchant, plan_id: d.plan.id, view_id: viewId(), value, fb: fbAttribution(qParams()) }) }).catch(() => {});
          } catch (_) {}
        }
      } catch (e) { if (ok) setLoadErr("No pudimos cargar la suscripción. Revisá tu conexión."); }
      finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; };
  }, [merchant, product, planParam, packIdx, variantParam]);

  // Sin `checkout` (backend viejo) → comportamiento histórico: pide todo.
  const askAddress = cfg ? cfg.ask_address !== false : true;
  const requirePhone = cfg ? cfg.require_phone !== false : true;
  const requireTaxId = cfg ? cfg.require_tax_id === true : false;
  const providerLabel = cfg?.provider_label || "Mercado Pago";
  // Tema: el resuelto por el server (o solo defaults + lo que manda el diseñador en la vista previa).
  const theme = isPreview
    ? resolveCheckoutTheme(null, { widgetColor: cfg?.color, preview: previewTheme || {} })
    : (cfg?.theme || resolveCheckoutTheme(null, { widgetColor: colorParam || cfg?.color }));
  const accent = theme.color;
  const isService = cfg?.business_type === "service";

  // Cálculo de precios (mismo criterio que checkout/init).
  const pack = plan && plan.pricing_mode === "packs" && packIdx != null ? resolvePack(plan, packIdx) : null;
  const qty = pack ? pack.qty : qtyParam;
  const unitPrice = plan?.subscription_price_ars || 0;
  const tiers = Array.isArray(plan?.qty_discount_tiers) ? plan.qty_discount_tiers : [];
  let qtyDiscountPct = 0;
  for (const t of tiers) if (qty >= (t.min_qty || 0)) qtyDiscountPct = t.discount_pct || 0;
  const subtotal = pack ? pack.priceSub : baseParam > 0 ? Math.round(baseParam * (1 - subOffParam / 100)) : Math.round(unitPrice * qty * (1 - qtyDiscountPct / 100));

  // Envío por defecto del plan (si no hay otros métodos).
  const planShippingFree = (plan?.free_shipping_from_ars || 0) > 0 && subtotal >= (plan?.free_shipping_from_ars || 0);
  const planShipping = {
    name: plan?.shipping_method_name || "Envío a domicilio",
    price: planShippingFree ? 0 : (plan?.shipping_price_ars || 0),
    free: planShippingFree || (plan?.shipping_price_ars || 0) === 0,
  };

  // Última opción cuando la tienda no devuelve ninguna tarifa: un envío
  // estándar en 0. Nunca se muestra junto a las reales, solo en su lugar.
  const FALLBACK_RATE = { name: "Envío a domicilio", price: 0, _fallback: true };
  // Métodos de envío: de Shopify (tienda conectada) o los del checkout del merchant.
  const rateTimer = useRef(null);
  const rateSeq = useRef(0); // descarta respuestas viejas que llegan después de una más nueva
  // Provincia sugerida por el CP: se aplica si el comprador no eligió una a mano.
  const provinceAuto = useRef(false);
  useEffect(() => {
    const sug = provinciaPorCP(zip);
    if (!sug) return;
    if (!province || provinceAuto.current) { if (province !== sug) setProvince(sug); provinceAuto.current = true; }
    // eslint-disable-next-line
  }, [zip]);
  const onProvince = (v) => { provinceAuto.current = false; setProvince(v); };
  // Calle y localidad viajan en la cotización pero no la disparan (antes recotizaba a cada tecla).
  const addrRef = useRef({ city, address1 }); addrRef.current = { city, address1 };
  useEffect(() => {
    if (!plan || !askAddress) return;
    const fromStore = cfg ? cfg.shipping_from_store === true : true;
    if (!fromStore) {
      const own = Array.isArray(cfg?.shipping_rates) ? cfg.shipping_rates : [];
      setRates(own.length ? own : [planShipping]);
      setRateIdx(0);
      return;
    }
    // Con cotización en vivo (Shopify, hay variante) se pide UNA sola vez, con el CP completo
    // (4 dígitos): antes, con el CP a medio escribir o solo la provincia, salía la tarifa manual
    // ("Envío gratis") y 3 s después las sucursales reales: confusión total (Thiago, 25-sept).
    // Sin variante (tarifas manuales por provincia) alcanza con la provincia, como siempre.
    const live = !!plan?.shopify_variant_id;
    const zipOk = /\d{4}/.test(zip);
    if (live ? !zipOk : (!zip && !province)) { setRates([]); setRateIdx(0); setRatesLoading(false); return; }
    clearTimeout(rateTimer.current);
    const seq = ++rateSeq.current;
    setRatesLoading(true); // el "Buscando…" arranca ya, y no se suelta hasta la respuesta final
    rateTimer.current = setTimeout(async () => {
      try {
        // Con variante + CP, el backend le pide la cotización a Shopify y trae
        // las opciones de la app de envíos del comerciante (sucursales incluidas),
        // con el código que después necesita la orden. Sin eso, tarifas manuales.
        const q = new URLSearchParams({
          action: "shipping-rates", merchant, province, subtotal: String(subtotal),
          qty: String(qty || 1),
        });
        if (plan?.shopify_variant_id) q.set("variant", String(plan.shopify_variant_id));
        if (zip) q.set("zip", zip);
        if (addrRef.current.city) q.set("city", addrRef.current.city);
        if (addrRef.current.address1) q.set("address1", addrRef.current.address1);
        const r = await fetch(`/api/shopify?${q.toString()}`);
        const d = await r.json();
        const list = Array.isArray(d.rates) ? d.rates : [];
        // Si la tienda no devolvió ninguna tarifa (permiso faltante, API caída,
        // app de envíos que no cotiza a ese CP) mostramos UNA sola opción
        // estándar. El precio va en 0 —es lo que el backend cobra cuando no
        // pudo matchear una tarifa real— y el comerciante lo coordina al
        // despachar. Antes acá se pintaba el envío del plan, que le mostraba al
        // comprador un precio que la tienda no cobra (caso Glowtherm, 21-sept).
        // Tiendanube marca `unpriced` los medios que cotiza por código postal
        // (Correo Argentino, sucursales): llegan sin precio y mostrarlos sería
        // ofrecer envío gratis. Se caen, y si no queda ninguno con precio va el
        // envío a domicilio estándar, que el comercio coordina al despachar.
        // 22-sept-2026, Thiago.
        const conPrecio = list.filter(r => !r.unpriced);
        if (seq !== rateSeq.current) return; // llegó tarde: ya hay un pedido más nuevo en curso
        setRates(conPrecio.length ? conPrecio : [FALLBACK_RATE]);
        setRateIdx(0);
      } catch (_) { if (seq !== rateSeq.current) return; setRates([FALLBACK_RATE]); setRateIdx(0); }
      finally { if (seq === rateSeq.current) setRatesLoading(false); }
    }, 350);
    return () => clearTimeout(rateTimer.current);
    // eslint-disable-next-line
  }, [plan, cfg, province, subtotal, askAddress, zip, qty]);

  const shippingSel = askAddress ? (rates[rateIdx] || planShipping) : null;
  const shippingPrice = shippingSel && rates.length ? (Number(shippingSel.price) || 0) : 0;
  // Descuento validado contra el backend (el server lo vuelve a validar al pagar).
  // La cuenta la hace el módulo compartido, la MISMA que corre en el server.
  // Antes acá el % se capeaba en 100 y en el server en 90: con un código del
  // 99 % el comprador veía $595 y MP le cobraba $5.949 (21-sept).
  const discountAmt = discountAmountFor(subtotal, discount);
  const upsells = Array.isArray(cfg?.upsells) ? cfg.upsells : [];
  const extrasList = upsells.filter(u => (extras[u.plan_id] || 0) > 0).map(u => ({ ...u, qty: extras[u.plan_id] }));
  const extrasTotal = extrasList.reduce((a, u) => a + u.price_ars * u.qty, 0);
  const total = Math.max(0, subtotal - discountAmt) + shippingPrice + extrasTotal;
  const setExtra = (id, d) => setExtras(e => ({ ...e, [id]: Math.max(0, Math.min(5, (e[id] || 0) + d)) }));

  async function aplicarCodigo(code, rc) {
    const c = String(code || "").trim().toUpperCase();
    if (!c && !rc) return;
    setCodeBusy(true); setCodeMsg("");
    try {
      const q = new URLSearchParams({ action: "discount", merchant });
      if (rc) q.set("rc", rc); else q.set("code", c);
      const r = await fetch(`/api/public?${q.toString()}`);
      const d = await r.json();
      if (d.valid) { setDiscount({ ...d, viaRecovery: !!rc }); setCodeInput(d.code || c); setCodeMsg(`Código ${d.code || c} aplicado${d.first_charge_only ? " · solo en el primer cobro" : ""}.`); }
      else { setDiscount(null); setCodeMsg(d.error || "Ese código no es válido."); }
    } catch (_) { setCodeMsg("No pudimos validar el código. Probá de nuevo."); }
    finally { setCodeBusy(false); }
  }
  useEffect(() => { if (merchant && (rcParam || codeParam)) aplicarCodigo(codeParam, rcParam); /* eslint-disable-next-line */ }, [merchant]);

  async function pagar() {
    setFormErr("");
    if (isPreview) { setFormErr("Esto es una vista previa: el botón no cobra."); return; }
    const miss = {};
    if (!EMAIL_RE.test(email.trim())) miss.email = "Ingresá un email válido";
    if (!name.trim()) miss.name = "Ingresá tu nombre y apellido";
    if (requirePhone && !phone.trim()) miss.phone = "Ingresá tu teléfono";
    if (requireTaxId && !taxid.trim()) miss.taxid = "Ingresá tu DNI o CUIT";
    if (askAddress) {
      if (!address1.trim()) miss.address1 = "Ingresá la calle y el número";
      if (!zip.trim()) miss.zip = "Ingresá el código postal";
      if (!city.trim()) miss.city = "Ingresá la localidad";
      if (!province.trim()) miss.province = "Elegí la provincia";
      if (!rates.length && zip.trim() && province.trim()) miss.ship = ratesLoading ? "Esperá a que carguen las opciones de envío" : "Elegí un método de envío";
    }
    setErrs(miss);
    if (Object.keys(miss).length) { scrollToFirstError(); return; }
    setSubmitting(true);
    try {
      const body = {
        merchant_id: merchant,
        plan_id: plan.id,
        quantity: qty,
        ...(pack ? { pack_index: pack.idx } : {}),
        ...(!pack && freqParam ? { frequency_days: freqParam } : {}),
        ...(!pack && baseParam > 0 ? { base_price: baseParam, sub_discount: subOffParam } : {}),
        ...(discount?.code ? { discount_code: discount.code } : {}),
        ...(discount?.viaRecovery && rcParam ? { recovery_token: rcParam } : {}),
        // La variante que venía en la URL (la que eligió en la página del
        // producto). Sin esto el backend usa la del plan y el que compró
        // frutilla recibía la variante por defecto (22-sept).
        ...(variantParam ? { shopify_variant_id: variantParam } : {}),
        ...(extrasList.length ? { extras: extrasList.map(u => ({ plan_id: u.plan_id, qty: u.qty })) } : {}),
        customer: { email: email.trim(), name: name.trim(), phone: phone.trim(), tax_id: taxid.trim() },
        ...(cfg?.whatsapp_optin ? { whatsapp_optin: waOptin } : {}),
        fb: fbAttribution(qParams()),
      };
      if (askAddress) {
        body.shipping_address = {
          address1: address1.trim(), address2: address2.trim(), city: city.trim(),
          province: province.trim(), zip: zip.trim(), country: "Argentina",
          first_name: name.trim().split(" ")[0] || "", last_name: name.trim().split(" ").slice(1).join(" ") || "",
          phone: phone.trim(),
        };
        body.shipping_method = { name: shippingSel.name, price: shippingPrice, ...(shippingSel.code ? { code: shippingSel.code } : {}) };
      }
      const r = await fetch("/api/checkout/init", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.error) { setFormErr(d.error); setSubmitting(false); return; }
      redirected.current = true;
      window.location.href = d.init_point;
    } catch (e) {
      setFormErr(`No pudimos conectar con ${providerLabel}. Revisá tu conexión y reintentá.`);
      setSubmitting(false);
    }
  }

  const R = theme.radius;
  const font = theme.font_stack;
  const pageBase = { minHeight: "100vh", background: theme.bg, color: theme.text, colorScheme: theme.dark ? "dark" : "light", fontFamily: font, boxSizing: "border-box" };
  const loaderColor = colorParam || cachedColor || "#10b981";

  // Misma animación de carga que el tablero (logo girando), del color de la tienda.
  if (loading) return <div style={{ ...pageBase, display: "flex", alignItems: "center", justifyContent: "center", background: cachedColor || colorParam ? theme.bg : "#ffffff" }}><AppLoader T={{ textSm: "#777" }} text="Preparando tu suscripción…" minHeight="70vh" color={loaderColor}/></div>;
  if (loadErr) return <div style={{ ...pageBase, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}><div style={{ maxWidth: 420, textAlign: "center", border: `1px solid ${theme.border}`, borderRadius: R + 6, padding: 24, background: theme.input_bg }}><div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Ups</div><div style={{ fontSize: 14, color: theme.text_muted, lineHeight: 1.5 }}>{loadErr}</div></div></div>;

  const freqTxt = freqText(pack ? pack.freqDays : (freqParam || plan.frequency_days), pack ? pack.freqUnit : plan.freq_unit);
  const kindLabel = isService ? "Membresía" : "Suscripción";
  const title = titleOverride || plan.product_title;
  const image = img || plan.product_image || "";
  const storeName = theme.header_text || cfg?.store_name || "";
  const logo = theme.show_logo ? (cfg?.store_logo || "") : "";
  const footerTxt = theme.footer_text || `Se cobra ${money(total)} ahora y se renueva automáticamente ${freqTxt}. Podés pausar o cancelar cuando quieras.`;
  const cta = submitting ? `Redirigiendo a ${providerLabel}…` : ctaText(theme, money(total));
  const policiesTxt = theme.policies_text || "Al pagar aceptás los términos y la política de privacidad.";
  // "← Volver a la tienda": a la página del producto de donde vino (el widget la pasa en &src=) o a la tienda.
  const backUrl = (() => { const s = p.get("src") || ""; if (/^https?:\/\//.test(s)) return s; return cfg?.store_url || ""; })();

  const line = (l, v, opts = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14, color: opts.color || theme.text, ...(opts.style || {}) }}>
      <span style={{ color: opts.color || theme.text_muted, minWidth: 0 }}>{l}</span><span style={{ fontWeight: opts.bold ? 600 : 500, whiteSpace: "nowrap" }}>{v}</span>
    </div>
  );

  const discountBox = theme.show_discount && (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div className="rc-f" style={{ flex: 1, marginBottom: 0 }}>
          <input value={codeInput} onChange={e => setCodeInput(e.target.value.toUpperCase())} placeholder=" " aria-label="Código de descuento" style={{ textTransform: "uppercase" }}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aplicarCodigo(codeInput); } }}/>
          <label>Código de descuento</label>
        </div>
        <button type="button" onClick={() => aplicarCodigo(codeInput)} disabled={codeBusy || !codeInput.trim()} className="rc-apply">{codeBusy ? "…" : "Aplicar"}</button>
      </div>
      {codeMsg ? <div style={{ fontSize: 13, color: discount ? "#0a8a3f" : "#c0392b", marginTop: 8 }}>{codeMsg}</div> : null}
      {discount?.code ? <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, background: theme.color_tint, color: theme.text, padding: "5px 10px", borderRadius: 999 }}>🏷 {discount.code}</div> : null}
    </div>
  );

  const summaryBody = (
    <>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          {image ? <img src={image} alt="" style={{ width: 64, height: 64, borderRadius: Math.min(R + 2, 12), objectFit: "cover", border: `1px solid ${theme.border_soft}`, background: "#fff", display: "block" }}/> : <div style={{ width: 64, height: 64, borderRadius: Math.min(R + 2, 12), background: theme.color_tint }}/>}
          {qty > 1 ? <span style={{ position: "absolute", top: -8, right: -8, minWidth: 22, height: 22, padding: "0 6px", borderRadius: 999, background: theme.text_muted, color: "#fff", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{qty}</span> : null}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere" }}>{title}</div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12, fontWeight: 600, color: theme.color, background: theme.color_tint, padding: "3px 9px", borderRadius: 999 }}>{kindLabel}</div>
          <div style={{ fontSize: 13, color: theme.text_muted, marginTop: 6 }}>Frecuencia: {freqTxt}</div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: "nowrap" }}>{money(subtotal)}</div>
      </div>
      {upsells.length ? (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${theme.border_soft}` }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Sumá a tu suscripción</div>
          <div style={{ fontSize: 12.5, color: theme.text_muted, marginBottom: 10, lineHeight: 1.45 }}>Llegan con cada envío. Los sacás cuando quieras.</div>
          {upsells.map(u => { const q = extras[u.plan_id] || 0; return (
            <div key={u.plan_id} style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, border: `1.5px solid ${q ? theme.color : theme.border_soft}`, borderRadius: R + 4, marginBottom: 8, background: q ? theme.color_tint : theme.input_bg }}>
              {u.image ? <img src={u.image} alt="" style={{ width: 52, height: 52, borderRadius: Math.min(R + 2, 10), objectFit: "cover", background: "#fff", flexShrink: 0 }}/> : <div style={{ width: 52, height: 52, borderRadius: 10, background: theme.color_tint, flexShrink: 0 }}/>}
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.title}</div>
                <div style={{ color: "#0a8a3f", fontWeight: 600, fontSize: 13 }}>{money(u.price_ars)}{u.compare_ars ? <s style={{ color: theme.text_muted, fontWeight: 400, marginLeft: 6 }}>{money(u.compare_ars)}</s> : null}</div>
              </div>
              {q ? (
                <div style={{ display: "inline-flex", alignItems: "center", border: `1.5px solid ${theme.border}`, borderRadius: R, overflow: "hidden", background: theme.input_bg }}>
                  <button type="button" onClick={() => setExtra(u.plan_id, -1)} aria-label="Sacar uno" style={{ width: 32, height: 32, border: "none", background: "transparent", color: theme.color, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>−</button>
                  <b style={{ minWidth: 22, textAlign: "center", fontSize: 13 }}>{q}</b>
                  <button type="button" onClick={() => setExtra(u.plan_id, 1)} aria-label="Sumar uno" style={{ width: 32, height: 32, border: "none", background: "transparent", color: theme.color, fontSize: 16, fontWeight: 700, cursor: "pointer" }}>+</button>
                </div>
              ) : (
                <button type="button" onClick={() => setExtra(u.plan_id, 1)} style={{ background: theme.color, color: theme.color_on, border: "none", borderRadius: R, padding: "9px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>+ Agregar</button>
              )}
            </div>
          ); })}
        </div>
      ) : null}
      {discountBox}
      <div style={{ borderTop: `1px solid ${theme.border_soft}`, margin: "18px 0 14px" }}/>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {line(<>Producto{qtyDiscountPct > 0 ? ` (−${qtyDiscountPct}%)` : ""}</>, money(subtotal))}
        {askAddress && line(<>Envío{rates.length && shippingSel?.name ? ` · ${shippingSel.name}` : ""}</>, !rates.length ? <span style={{ color: theme.text_muted, fontWeight: 400 }}>Completá tu dirección</span> : (shippingPrice === 0 ? "Gratis" : money(shippingPrice)))}
        {discountAmt > 0 && line(<>Descuento {discount?.code}</>, `−${money(discountAmt)}`, { color: "#0a8a3f" })}
        {extrasList.map(u => line(<>{u.qty} × {u.title}</>, money(u.price_ars * u.qty)))}
      </div>
      <div style={{ borderTop: `1px solid ${theme.border_soft}`, margin: "14px 0" }}/>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Total</span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}><span style={{ fontSize: 12, color: theme.text_muted }}>ARS</span><span style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.3 }}>{money(total)}</span></span>
      </div>
      <div style={{ fontSize: 12, color: theme.text_muted, lineHeight: 1.5, marginTop: 10 }}>{footerTxt}</div>
    </>
  );

  const chevron = <span aria-hidden="true" style={{ position: "absolute", right: 14, top: 20, width: 8, height: 8, borderRight: `1.5px solid ${theme.text_muted}`, borderBottom: `1.5px solid ${theme.text_muted}`, transform: "rotate(45deg)", pointerEvents: "none" }}/>;

  const payBlock = (
    <section>
      <h2 className="rc-h2">Pago</h2>
      {/* Única opción por ahora (hasta Mobbex): se ve elegida, como un método de envío. */}
      <div className="rc-opts"><label className="rc-opt on" style={{ cursor: "default" }}>
        <input type="radio" checked readOnly aria-label={providerLabel}/>
        <img src="/brand/mercadopago.png" alt="" style={{ width: 30, height: 30, borderRadius: 7, objectFit: "contain", flexShrink: 0 }}/>
        <div style={{ fontSize: 14, lineHeight: 1.45, minWidth: 0 }}><b style={{ fontWeight: 600 }}>{providerLabel}</b><div style={{ color: theme.text_muted, fontSize: 13 }}>{isService ? `La cuota se cobra sola ${freqTxt}.` : `Se cobra ${freqTxt}, sin que hagas nada.`}</div></div>
      </label></div>
      {theme.summary_mobile === "before_pay" ? <div className="rc-inline-summary">{summaryBody}</div> : null}
      {formErr ? <div role="alert" style={{ background: "#fde8e8", border: "1px solid #f5b5b5", color: "#b42318", fontSize: 14, padding: "11px 13px", borderRadius: R, marginTop: 14 }}>{formErr}</div> : null}
      <button onClick={pagar} disabled={submitting} className="rc-pay">{cta}</button>
      {theme.show_policies ? (
        <div style={{ fontSize: 12, color: theme.text_muted, lineHeight: 1.5, marginTop: 12, textAlign: "center" }}>
          {policiesTxt}
          {(theme.terms_url || theme.privacy_url) ? <span style={{ display: "block", marginTop: 4 }}>
            {theme.terms_url ? <a href={theme.terms_url} target="_blank" rel="noopener" style={{ color: theme.color }}>Términos y condiciones</a> : null}
            {theme.terms_url && theme.privacy_url ? " · " : ""}
            {theme.privacy_url ? <a href={theme.privacy_url} target="_blank" rel="noopener" style={{ color: theme.color }}>Política de privacidad</a> : null}
          </span> : null}
        </div>
      ) : null}
      {theme.show_trust ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 12.5, color: theme.text_muted, marginTop: 14 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          {askAddress ? `Envío automático ${freqTxt}` : `Renovación automática ${freqTxt}`} · Pago seguro con {providerLabel}
        </div>
      ) : null}
    </section>
  );

  return (
    <div style={pageBase} className="rc-ck">
      {theme.font_url ? <link rel="stylesheet" href={theme.font_url}/> : null}
      <style>{`
        @keyframes rc-spin{to{transform:rotate(360deg)}}
        .rc-ck *{box-sizing:border-box}
        .rc-shell{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);min-height:100vh}
        .rc-main{display:flex;justify-content:flex-end;padding:34px 40px 64px;min-width:0}
        .rc-main>div{width:100%;max-width:580px;min-width:0}
        .rc-side{background:${theme.summary_bg};border-left:1px solid ${theme.border_soft};padding:34px 40px 64px;min-width:0}
        .rc-side>div{width:100%;max-width:440px;position:sticky;top:34px}
        .rc-mobile-summary{display:none}
        .rc-inline-summary{display:none}
        .rc-h2{font-size:21px;font-weight:600;margin:0 0 14px;letter-spacing:-0.2px}
        .rc-sec{margin-top:34px}
        .rc-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
        .rc-3{display:grid;grid-template-columns:1fr 1.4fr 1.4fr;gap:12px}
        .rc-f{position:relative;margin-bottom:12px;min-width:0}
        .rc-f input,.rc-f select{width:100%;height:52px;padding:22px 13px 6px;font-size:16px;line-height:1.2;border:1px solid ${theme.border};border-radius:${R}px;background:${theme.input_bg};color:${theme.text};font-family:inherit;outline:none;-webkit-appearance:none;appearance:none;transition:border-color .12s,box-shadow .12s}
        .rc-f select{padding-right:36px}
        .rc-f label{position:absolute;left:14px;top:16px;font-size:15px;color:${theme.text_muted};pointer-events:none;transition:top .12s,font-size .12s;white-space:nowrap;max-width:calc(100% - 28px);overflow:hidden;text-overflow:ellipsis}
        .rc-f input:focus+label,.rc-f input:not(:placeholder-shown)+label,.rc-f select+label{top:7px;font-size:11.5px}
        .rc-f input:focus,.rc-f select:focus{border-color:${theme.color};box-shadow:0 0 0 1px ${theme.color}}
        .rc-f.is-err input,.rc-f.is-err select{border-color:#d92d20;box-shadow:0 0 0 1px #d92d20}
        .rc-f.is-err label{color:#d92d20}
        .rc-fe{color:#d92d20;font-size:13px;line-height:1.35;margin-top:6px;padding-left:2px}
        .rc-ck input::placeholder{color:transparent}
        .rc-ck input:-webkit-autofill,.rc-ck select:-webkit-autofill,.rc-ck input:-webkit-autofill:focus{-webkit-text-fill-color:${theme.text};-webkit-box-shadow:0 0 0 1000px ${theme.dark ? "#1c1c1c" : "#fff"} inset;box-shadow:0 0 0 1000px ${theme.dark ? "#1c1c1c" : "#fff"} inset;caret-color:${theme.text};transition:background-color 9999s ease-out}
        .rc-opts{border:1px solid ${theme.border};border-radius:${R}px;overflow:hidden;background:${theme.input_bg}}
        .rc-opt{display:flex;align-items:center;gap:12px;padding:15px 16px;cursor:pointer;border-top:1px solid ${theme.border_soft};font-size:14px}
        .rc-opt:first-child{border-top:none}
        .rc-opt.on{background:${theme.color_tint};box-shadow:inset 0 0 0 1px ${theme.color}}
        .rc-opt input{accent-color:${theme.color};width:18px;height:18px;margin:0;flex-shrink:0}
        .rc-check{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.4;cursor:pointer;margin:2px 0 14px}
        .rc-check input{width:18px;height:18px;margin:1px 0 0;flex-shrink:0;accent-color:${theme.color}}
        .rc-apply{padding:0 18px;height:52px;font-size:15px;font-weight:600;color:${theme.text};background:${theme.dark ? "rgba(255,255,255,0.08)" : "#e8e8e8"};border:none;border-radius:${R}px;cursor:pointer;font-family:inherit;flex-shrink:0}
        .rc-apply:disabled{opacity:.55;cursor:default}
        .rc-pay{width:100%;height:58px;margin-top:16px;font-size:17px;font-weight:600;color:${theme.color_on};background:${theme.color};border:none;border-radius:${R}px;cursor:pointer;font-family:inherit;letter-spacing:-0.1px;transition:filter .12s}
        .rc-pay:hover{filter:brightness(.94)}
        .rc-pay:disabled{opacity:.7;cursor:wait}
        .rc-foot{margin-top:40px;padding-top:16px;border-top:1px solid ${theme.border_soft};font-size:12px;color:${theme.text_muted};display:flex;gap:14px;flex-wrap:wrap}
        .rc-foot a{color:${theme.text_muted}}
        @media(max-width:900px){
          .rc-shell{grid-template-columns:1fr}
          .rc-side{display:none}
          .rc-main{justify-content:center;padding:0 20px 48px}
          .rc-mobile-summary{display:${theme.summary_mobile === "top" ? "block" : "none"};background:${theme.summary_bg};border-bottom:1px solid ${theme.border_soft};margin:0 -20px 8px;padding:0 20px}
          .rc-inline-summary{display:block;background:${theme.summary_bg};border:1px solid ${theme.border_soft};border-radius:${R}px;padding:18px;margin-top:16px}
          .rc-sec{margin-top:28px}
          .rc-h2{font-size:19px}
          .rc-3{grid-template-columns:1fr 1fr}
          .rc-3>:last-child{grid-column:1 / -1}
        }
        @media(max-width:420px){ .rc-2{grid-template-columns:1fr} }
      `}</style>
      <div className="rc-shell">
        <div className="rc-main">
          <div>
            {/* Encabezado: logo + nombre (o el texto que puso la tienda) */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "22px 0 6px", minHeight: 56 }}>
              {logo ? <img src={logo} alt="" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/> : null}
              {theme.header_logo
                ? <img src={theme.header_logo} alt={storeName} style={{ display: "block", maxHeight: 48, maxWidth: 220, width: "auto", height: "auto", objectFit: "contain" }}/>
                : <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{storeName}</div>}
            </div>

            {/* Celular: resumen desplegable arriba (como Shopify) */}
            <div className="rc-mobile-summary">
              <button type="button" onClick={() => setShowSummary(v => !v)} aria-expanded={showSummary}
                style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "14px 0", background: "transparent", border: "none", fontFamily: "inherit", color: theme.color, fontSize: 14, cursor: "pointer" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>{showSummary ? "Ocultar" : "Mostrar"} resumen del pedido <span aria-hidden="true" style={{ display: "inline-block", width: 7, height: 7, borderRight: `1.5px solid ${theme.color}`, borderBottom: `1.5px solid ${theme.color}`, transform: showSummary ? "rotate(-135deg) translate(-1px,-1px)" : "rotate(45deg) translateY(-2px)" }}/></span>
                <b style={{ color: theme.text, fontSize: 18, fontWeight: 700 }}>{money(total)}</b>
              </button>
              {showSummary ? <div style={{ paddingBottom: 18 }}>{summaryBody}</div> : null}
            </div>

            <section className="rc-sec" style={{ marginTop: 22 }}>
              <h2 className="rc-h2">{askAddress ? "Contacto" : "Tus datos"}</h2>
              <Field label="Correo electrónico" error={errs.email} onFix={fix("email")}><input type="email" autoComplete="email" placeholder=" " value={email} onChange={e => setEmail(e.target.value)} onBlur={captureLead}/></Field>
              {cfg?.whatsapp_optin ? (
                <label className="rc-check"><input type="checkbox" checked={waOptin} onChange={e => setWaOptin(e.target.checked)}/><span>Quiero recibir novedades de mi pedido por email y WhatsApp</span></label>
              ) : null}
            </section>

            <section className="rc-sec">
              <h2 className="rc-h2">{askAddress ? "Entrega" : "Quién se suscribe"}</h2>
              <Field label="Nombre y apellido" error={errs.name} onFix={fix("name")}><input autoComplete="name" placeholder=" " value={name} onChange={e => setName(e.target.value)}/></Field>
              <div className="rc-2">
                <Field label={requirePhone ? "Teléfono" : "Teléfono (opcional)"} error={errs.phone} onFix={fix("phone")}><input type="tel" autoComplete="tel" placeholder=" " value={phone} onChange={e => setPhone(e.target.value)}/></Field>
                <Field label={requireTaxId ? "DNI o CUIT" : "DNI o CUIT (opcional)"} error={errs.taxid} onFix={fix("taxid")}><input inputMode="numeric" placeholder=" " value={taxid} onChange={e => setTaxid(e.target.value)}/></Field>
              </div>
              {askAddress ? (<>
                <Field label="Calle y número" error={errs.address1} onFix={fix("address1")}><input autoComplete="address-line1" placeholder=" " value={address1} onChange={e => setAddress1(e.target.value)}/></Field>
                <Field label="Piso, depto o referencia (opcional)"><input autoComplete="address-line2" placeholder=" " value={address2} onChange={e => setAddress2(e.target.value)}/></Field>
                <div className="rc-3">
                  <Field label="C.P." error={errs.zip} onFix={fix("zip")}><input autoComplete="postal-code" inputMode="numeric" placeholder=" " value={zip} onChange={e => setZip(e.target.value)}/></Field>
                  <Field label="Localidad" error={errs.city} onFix={fix("city")}><input autoComplete="address-level2" placeholder=" " value={city} onChange={e => setCity(e.target.value)}/></Field>
                  <div className={"rc-f" + (errs.province ? " is-err" : "")} onChange={errs.province ? fix("province") : undefined}>
                    <select value={province} onChange={e => onProvince(e.target.value)} aria-label="Provincia">
                      <option value=""></option>
                      {PROVINCIAS.map(pv => <option key={pv} value={pv}>{pv}</option>)}
                    </select>
                    <label>Provincia</label>
                    {chevron}
                    {errs.province ? <div className="rc-fe" role="alert">{errs.province}</div> : null}
                  </div>
                </div>
              </>) : null}
            </section>

            {askAddress ? (
              <section className="rc-sec">
                <h2 className="rc-h2">Envío</h2>
                {errs.ship ? <div className="rc-fe" data-f="ship" role="alert" style={{ marginBottom: 8 }}>{errs.ship}</div> : null}
                {ratesLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: theme.text_muted, padding: "14px 16px", border: `1px solid ${theme.border}`, borderRadius: R }}><span aria-hidden="true" style={{ width: 16, height: 16, border: `2px solid ${theme.border}`, borderTopColor: theme.color, borderRadius: "50%", display: "inline-block", flexShrink: 0, animation: "rc-spin .7s linear infinite" }}/>Buscando métodos de envío…</div>
                ) : !rates.length ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: theme.text_muted, padding: "14px 16px", background: theme.dark ? "rgba(255,255,255,0.05)" : "#f5f5f5", borderRadius: R }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 8h.01M11 12h1v4h1"/></svg>
                    {province && !/\d{4}/.test(zip) ? "Completá el código postal para ver las opciones de envío." : "Completá tu dirección para ver las opciones de envío."}
                  </div>
                ) : (
                  <div className="rc-opts">
                    {rates.map((rt, i) => (
                      <label key={i} className={"rc-opt" + (i === rateIdx ? " on" : "")}>
                        <input type="radio" checked={i === rateIdx} onChange={() => setRateIdx(i)}/>
                        <span style={{ flex: 1, minWidth: 0 }}>{rt.name}</span>
                        <b style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{(Number(rt.price) || 0) === 0 ? "Gratis" : money(rt.price)}</b>
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 13, color: theme.text_muted, marginTop: 10, lineHeight: 1.5 }}>Recibís un mail con los detalles de tu envío al confirmar la compra.</div>
              </section>
            ) : null}

            <div className="rc-sec">{payBlock}</div>

            <div className="rc-foot">
              {backUrl ? <a href={backUrl}>← Volver a la tienda</a> : null}
              {theme.show_policies && theme.terms_url ? <a href={theme.terms_url} target="_blank" rel="noopener">Términos</a> : null}
              {theme.show_policies && theme.privacy_url ? <a href={theme.privacy_url} target="_blank" rel="noopener">Privacidad</a> : null}
              <a href="https://www.recurrentesapp.com" target="_blank" rel="noopener" style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
                <span>Con tecnología de</span>
                <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden="true" style={{ display: "block", flexShrink: 0 }}>
                  <defs><linearGradient id="rcFootLogo" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#34d399"/><stop offset="100%" stopColor="#059669"/></linearGradient></defs>
                  <circle cx="16" cy="16" r="16" fill="url(#rcFootLogo)"/>
                  <path d="M22.5 13.2A7.2 7.2 0 1 0 23.2 18" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round"/>
                  <path d="M22.9 8.6v5.1h-5.1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontWeight: 700, color: theme.text }}>Recurrentes</span>
              </a>
            </div>
          </div>
        </div>

        <aside className="rc-side"><div>{summaryBody}</div></aside>
      </div>
    </div>
  );
}
