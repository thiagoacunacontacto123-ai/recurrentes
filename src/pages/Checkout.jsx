import React, { useState, useEffect, useRef } from "react";
import { resolvePack } from "../../shared/bundle/viewmodel.js";

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

function freqText(days) {
  const d = Number(days) || 0;
  if (d === 7) return "semanal";
  if (d === 14 || d === 15) return "quincenal";
  if (d === 30) return "mensual";
  if (d === 60) return "cada 2 meses";
  if (d === 90) return "cada 3 meses";
  if (d === 180) return "cada 6 meses";
  if (d === 365) return "anual";
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

  const [plan, setPlan] = useState(null);
  const [codeInput, setCodeInput] = useState(codeParam);
  const [discount, setDiscount] = useState(null);   // { code, type, value, first_charge_only, viaRecovery }
  const [codeMsg, setCodeMsg] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(null);

  const [email, setEmail] = useState("");
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
  const [formErr, setFormErr] = useState("");

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
        else { setPlan(d.plan); setCfg(d.checkout || null); }
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
  const accent = colorParam || cfg?.color || "#10b981";
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

  // Métodos de envío: de Shopify (tienda conectada) o los del checkout del merchant.
  const rateTimer = useRef(null);
  useEffect(() => {
    if (!plan || !askAddress) return;
    const fromStore = cfg ? cfg.shipping_from_store === true : true;
    if (!fromStore) {
      const own = Array.isArray(cfg?.shipping_rates) ? cfg.shipping_rates : [];
      setRates(own.length ? own : [planShipping]);
      setRateIdx(0);
      return;
    }
    clearTimeout(rateTimer.current);
    rateTimer.current = setTimeout(async () => {
      setRatesLoading(true);
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
        if (city) q.set("city", city);
        if (address1) q.set("address1", address1);
        const r = await fetch(`/api/shopify?${q.toString()}`);
        const d = await r.json();
        const list = Array.isArray(d.rates) ? d.rates : [];
        setRates(list.length ? list : [planShipping]);
        setRateIdx(0);
      } catch (_) { setRates([planShipping]); setRateIdx(0); }
      finally { setRatesLoading(false); }
    }, 350);
    return () => clearTimeout(rateTimer.current);
    // eslint-disable-next-line
  }, [plan, cfg, province, subtotal, askAddress, zip, city, address1, qty]);

  const shippingSel = askAddress ? (rates[rateIdx] || planShipping) : null;
  const shippingPrice = shippingSel ? (Number(shippingSel.price) || 0) : 0;
  // Descuento validado contra el backend (el server lo vuelve a validar al pagar).
  const discountAmt = discount
    ? (discount.type === "fixed" ? Math.min(subtotal, Math.round(Number(discount.value) || 0)) : Math.round(subtotal * (Math.min(100, Number(discount.value) || 0) / 100)))
    : 0;
  const total = Math.max(0, subtotal - discountAmt) + shippingPrice;

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
    const miss = [];
    if (!EMAIL_RE.test(email.trim())) miss.push("email válido");
    if (!name.trim()) miss.push("nombre");
    if (requirePhone && !phone.trim()) miss.push("teléfono");
    if (requireTaxId && !taxid.trim()) miss.push("DNI o CUIT");
    if (askAddress) {
      if (!address1.trim()) miss.push("calle y número");
      if (!city.trim()) miss.push("ciudad");
      if (!province.trim()) miss.push("provincia");
      if (!zip.trim()) miss.push("código postal");
    }
    if (miss.length) { setFormErr("Completá: " + miss.join(", ") + "."); return; }
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
        customer: { email: email.trim(), name: name.trim(), phone: phone.trim(), tax_id: taxid.trim() },
        ...(cfg?.whatsapp_optin ? { whatsapp_optin: waOptin } : {}),
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
      window.location.href = d.init_point;
    } catch (e) {
      setFormErr(`No pudimos conectar con ${providerLabel}. Revisá tu conexión y reintentá.`);
      setSubmitting(false);
    }
  }

  const st = {
    // colorScheme light: index.css declara `color-scheme: dark` para el panel y el
    // checkout lo heredaba. Chrome entonces pintaba los campos con su paleta
    // oscura (texto blanco, autocompletado gris-azul) sobre una página blanca.
    page: { minHeight: "100vh", background: "#f6f6f7", colorScheme: "light", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: "#1a1a1a", padding: "24px 16px", boxSizing: "border-box" },
    wrap: { maxWidth: 940, margin: "0 auto", display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", gap: 24, alignItems: "start" },
    card: { background: "#fff", border: "1px solid #e5e5e7", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
    h: { fontSize: 15, fontWeight: 700, margin: "0 0 14px" },
    label: { fontSize: 12, fontWeight: 600, color: "#555", margin: "0 0 5px", display: "block" },
    // 16px: iOS Safari hace zoom al enfocar inputs con letra menor.
    input: { width: "100%", padding: "11px 12px", fontSize: 16, border: "1px solid #d6d6d8", borderRadius: 9, boxSizing: "border-box", outline: "none", background: "#fff", color: "#1a1a1a", fontFamily: "inherit" },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    field: { marginBottom: 12 },
    opt: { color: "#aaa", fontWeight: 400 },
  };

  if (loading) return <div style={{ ...st.page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "#777", fontSize: 14 }}>Cargando…</div></div>;
  if (loadErr) return <div style={{ ...st.page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ ...st.card, maxWidth: 420, textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Ups</div><div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>{loadErr}</div></div></div>;

  const freqTxt = freqText(pack ? pack.freqDays : (freqParam || plan.frequency_days));
  const kindLabel = isService ? "Membresía" : "Suscripción";
  const title = titleOverride || plan.product_title;
  const image = img || plan.product_image || "";
  const summary = (
    <div style={st.card}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        {image ? <img src={image} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: "cover", border: "1px solid #eee", flexShrink: 0 }} /> : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>{kindLabel} · {freqTxt}</div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{title}{qty > 1 ? ` × ${qty}` : ""}</div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #eee", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        {askAddress && <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#666" }}>Subtotal{qtyDiscountPct > 0 ? ` (−${qtyDiscountPct}%)` : ""}</span><b>{money(subtotal)}</b></div>}
        {askAddress && <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><span style={{ color: "#666" }}>Envío{shippingSel?.name ? ` · ${shippingSel.name}` : ""}</span><b>{shippingPrice === 0 ? "Gratis" : money(shippingPrice)}</b></div>}
        {discountAmt > 0 && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "#0a8a3f", marginBottom: 6 }}><span>Descuento {discount?.code}</span><span>−{money(discountAmt)}</span></div>}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: askAddress ? "1px solid #eee" : "none", paddingTop: askAddress ? 10 : 0, fontSize: 15 }}><b>Total {freqTxt}</b><b>{money(total)}</b></div>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#888", lineHeight: 1.5 }}>Se cobra {money(total)} ahora y se renueva automáticamente ({freqTxt}). Podés pausar o cancelar cuando quieras.</div>
    </div>
  );

  return (
    <div style={st.page} className="rc-checkout">
      <style>{`@keyframes rc-spin{to{transform:rotate(360deg)}} @media(max-width:760px){ .rc-wrap{grid-template-columns:1fr!important;} .rc-summary{order:-1;} } @media(max-width:420px){ .rc-row2{grid-template-columns:1fr!important;} }
        /* Autocompletado de Chrome: que no pise el fondo blanco ni el color del texto. */
        .rc-checkout input:-webkit-autofill, .rc-checkout select:-webkit-autofill, .rc-checkout input:-webkit-autofill:focus {
          -webkit-text-fill-color:#1a1a1a; -webkit-box-shadow:0 0 0 1000px #fff inset; box-shadow:0 0 0 1000px #fff inset; caret-color:#1a1a1a; transition:background-color 9999s ease-out;
        }
        .rc-checkout input::placeholder { color:#9a9a9e; }`}</style>
      {cfg?.store_name ? (
        <div style={{ maxWidth: 940, margin: "0 auto 16px", fontSize: 17, fontWeight: 800, letterSpacing: -0.2, overflowWrap: "anywhere" }}>{cfg.store_name}</div>
      ) : null}
      <div className="rc-wrap" style={st.wrap}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* Contacto */}
          <div style={st.card}>
            <h3 style={st.h}>{askAddress ? "Contacto" : "Tus datos"}</h3>
            <div style={st.field}><label style={st.label}>Email</label><input style={st.input} type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></div>
            <div className="rc-row2" style={st.row2}>
              <div style={st.field}><label style={st.label}>Nombre y apellido</label><input style={st.input} autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Juan Pérez" /></div>
              <div style={st.field}><label style={st.label}>Teléfono {!requirePhone && <span style={st.opt}>(opcional)</span>}</label><input style={st.input} type="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="11 2345 6789" /></div>
            </div>
            {cfg?.whatsapp_optin && (
              <label style={{ display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13.5, color: "#333", margin: "0 0 14px", cursor: "pointer", lineHeight: 1.4 }}>
                <input type="checkbox" checked={waOptin} onChange={e => setWaOptin(e.target.checked)} style={{ width: 18, height: 18, margin: "1px 0 0", flexShrink: 0, accentColor: accent }} />
                <span>Quiero que me manden notificaciones de mi pedido por email y WhatsApp</span>
              </label>
            )}
            <div style={st.field}><label style={st.label}>DNI o CUIT {!requireTaxId && <span style={st.opt}>(opcional, para la factura)</span>}</label><input style={st.input} inputMode="numeric" value={taxid} onChange={e => setTaxid(e.target.value)} placeholder="20123456789" /></div>
          </div>

          {askAddress && (
            <div style={st.card}>
              <h3 style={st.h}>Entrega</h3>
              <div style={st.field}><label style={st.label}>Calle y número</label><input style={st.input} autoComplete="address-line1" value={address1} onChange={e => setAddress1(e.target.value)} placeholder="Av. Siempreviva 742" /></div>
              <div style={st.field}><label style={st.label}>Piso / depto / referencia <span style={st.opt}>(opcional)</span></label><input style={st.input} autoComplete="address-line2" value={address2} onChange={e => setAddress2(e.target.value)} placeholder="3° B" /></div>
              <div className="rc-row2" style={st.row2}>
                <div style={st.field}><label style={st.label}>Ciudad / Localidad</label><input style={st.input} autoComplete="address-level2" value={city} onChange={e => setCity(e.target.value)} placeholder="San Justo" /></div>
                <div style={st.field}><label style={st.label}>Código postal</label><input style={st.input} autoComplete="postal-code" value={zip} onChange={e => setZip(e.target.value)} placeholder="1754" /></div>
              </div>
              <div style={st.field}><label style={st.label}>Provincia</label>
                <select style={st.input} value={province} onChange={e => setProvince(e.target.value)}>
                  <option value="">Elegí tu provincia…</option>
                  {PROVINCIAS.map(pv => <option key={pv} value={pv}>{pv}</option>)}
                </select>
              </div>
            </div>
          )}

          {askAddress && (
            <div style={st.card}>
              <h3 style={st.h}>Envío</h3>
              {ratesLoading ? <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#888" }}><span aria-hidden="true" style={{ width: 16, height: 16, border: "2px solid #e3e3e5", borderTopColor: accent, borderRadius: "50%", display: "inline-block", flexShrink: 0, animation: "rc-spin .7s linear infinite" }}/>Buscando métodos de envío…</div> : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {rates.map((rt, i) => (
                    <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: `1.5px solid ${i === rateIdx ? accent : "#e0e0e2"}`, borderRadius: 10, cursor: "pointer", background: i === rateIdx ? accent + "0d" : "#fff" }}>
                      <input type="radio" checked={i === rateIdx} onChange={() => setRateIdx(i)} style={{ accentColor: accent }} />
                      <span style={{ flex: 1, fontSize: 13, fontWeight: 500, minWidth: 0 }}>{rt.name}</span>
                      <b style={{ fontSize: 13, color: (Number(rt.price) || 0) === 0 ? "#0a8a3f" : "#1a1a1a" }}>{(Number(rt.price) || 0) === 0 ? "Gratis" : money(rt.price)}</b>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pago */}
          <div style={st.card}>
            <h3 style={st.h}>Pago</h3>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>Pagás con <b>{providerLabel}</b>. {isService ? "La cuota se cobra sola cada período." : "Se renueva sola cada período."}</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input value={codeInput} onChange={e => setCodeInput(e.target.value.toUpperCase())} placeholder="Código de descuento" aria-label="Código de descuento"
                style={{ ...st.input, flex: 1, textTransform: "uppercase" }} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); aplicarCodigo(codeInput); } }}/>
              <button type="button" onClick={() => aplicarCodigo(codeInput)} disabled={codeBusy || !codeInput.trim()}
                style={{ padding: "0 16px", fontSize: 14, fontWeight: 700, color: accent, background: "#fff", border: `1.5px solid ${accent}`, borderRadius: 9, cursor: "pointer", opacity: codeBusy || !codeInput.trim() ? 0.6 : 1 }}>
                {codeBusy ? "…" : "Aplicar"}
              </button>
            </div>
            {codeMsg ? <div style={{ fontSize: 12, color: discount ? "#0a8a3f" : "#b42318", marginTop: -6, marginBottom: 10 }}>{codeMsg}</div> : null}
            {formErr ? <div role="alert" style={{ background: "#fde8e8", border: "1px solid #f5b5b5", color: "#b42318", fontSize: 13, padding: "10px 12px", borderRadius: 9, marginBottom: 12 }}>{formErr}</div> : null}
            <button onClick={pagar} disabled={submitting} style={{ width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, color: "#fff", background: accent, border: "none", borderRadius: 11, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? `Redirigiendo a ${providerLabel}…` : `Suscribirme y pagar ${money(total)}`}
            </button>
          </div>
        </div>

        <div className="rc-summary" style={{ minWidth: 0 }}>{summary}</div>
      </div>
    </div>
  );
}
