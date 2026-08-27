import React, { useState, useEffect, useRef } from "react";

// Checkout propio de Recurrentes — página que va ENTRE el bundle (widget en el
// producto) y el pago de Mercado Pago. Junta contacto + dirección, ofrece los
// métodos de envío configurados en Shopify (venta común) y arma la suscripción.
//
// URL: #/checkout?merchant=<uid>&product=<shopify_product_id>&qty=<n>
//   opcionales de display: &img=<url>&title=<txt>&color=<hex>

const PROVINCIAS = [
  "Buenos Aires", "Ciudad Autónoma de Buenos Aires", "Catamarca", "Chaco", "Chubut",
  "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja",
  "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis",
  "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán",
];

const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

function qParams() {
  const hash = window.location.hash || "";
  const qs = hash.split("?")[1] || window.location.search.slice(1) || "";
  return new URLSearchParams(qs);
}

export default function Checkout() {
  const p = qParams();
  const merchant = p.get("merchant") || "";
  const product = p.get("product") || "";
  const qty = Math.max(1, Math.min(10, parseInt(p.get("qty")) || 1));
  const img = p.get("img") || "";
  const titleOverride = p.get("title") || "";
  const accent = p.get("color") || "#10b981";

  const [plan, setPlan] = useState(null);
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

  const [rates, setRates] = useState([]);
  const [rateIdx, setRateIdx] = useState(0);
  const [ratesLoading, setRatesLoading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState("");

  // Cargar el plan activo del producto.
  useEffect(() => {
    if (!merchant || !product) { setLoadErr("Faltan datos del producto. Volvé a la tienda e intentá de nuevo."); setLoading(false); return; }
    let ok = true;
    (async () => {
      try {
        const r = await fetch(`/api/public?action=plan&merchant=${encodeURIComponent(merchant)}&product=${encodeURIComponent(product)}`);
        const d = await r.json();
        if (!ok) return;
        if (d.error || !d.plan) { setLoadErr("No encontramos una suscripción activa para este producto."); }
        else setPlan(d.plan);
      } catch (e) { if (ok) setLoadErr("No pudimos cargar el plan. Revisá tu conexión."); }
      finally { if (ok) setLoading(false); }
    })();
    return () => { ok = false; };
  }, [merchant, product]);

  // Cálculo de precios (mismo criterio que checkout/init).
  const unitPrice = plan?.subscription_price_ars || 0;
  const tiers = Array.isArray(plan?.qty_discount_tiers) ? plan.qty_discount_tiers : [];
  let qtyDiscountPct = 0;
  for (const t of tiers) if (qty >= (t.min_qty || 0)) qtyDiscountPct = t.discount_pct || 0;
  const subtotal = Math.round(unitPrice * qty * (1 - qtyDiscountPct / 100));

  // Fallback de envío del plan (si Shopify no expone métodos).
  const planShippingFree = (plan?.free_shipping_from_ars || 0) > 0 && subtotal >= (plan?.free_shipping_from_ars || 0);
  const planShipping = {
    name: plan?.shipping_method_name || "Envío a domicilio",
    price: planShippingFree ? 0 : (plan?.shipping_price_ars || 0),
    free: planShippingFree || (plan?.shipping_price_ars || 0) === 0,
  };

  // Traer métodos de envío de Shopify al cambiar provincia/subtotal (debounced).
  const rateTimer = useRef(null);
  useEffect(() => {
    if (!plan) return;
    clearTimeout(rateTimer.current);
    rateTimer.current = setTimeout(async () => {
      setRatesLoading(true);
      try {
        const r = await fetch(`/api/shopify?action=shipping-rates&merchant=${encodeURIComponent(merchant)}&province=${encodeURIComponent(province)}&subtotal=${subtotal}`);
        const d = await r.json();
        const list = Array.isArray(d.rates) ? d.rates : [];
        setRates(list.length ? list : [planShipping]);
        setRateIdx(0);
      } catch (_) { setRates([planShipping]); setRateIdx(0); }
      finally { setRatesLoading(false); }
    }, 350);
    return () => clearTimeout(rateTimer.current);
    // eslint-disable-next-line
  }, [plan, province, subtotal]);

  const shippingSel = rates[rateIdx] || planShipping;
  const total = subtotal + (Number(shippingSel?.price) || 0);

  async function pagar() {
    setFormErr("");
    const miss = [];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) miss.push("email válido");
    if (!name.trim()) miss.push("nombre");
    if (!phone.trim()) miss.push("teléfono");
    if (!address1.trim()) miss.push("calle y número");
    if (!city.trim()) miss.push("ciudad");
    if (!province.trim()) miss.push("provincia");
    if (!zip.trim()) miss.push("código postal");
    if (miss.length) { setFormErr("Completá: " + miss.join(", ") + "."); return; }
    setSubmitting(true);
    try {
      const r = await fetch("/api/checkout/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant_id: merchant,
          plan_id: plan.id,
          quantity: qty,
          customer: { email: email.trim(), name: name.trim(), phone: phone.trim(), tax_id: taxid.trim() },
          shipping_address: {
            address1: address1.trim(), address2: address2.trim(), city: city.trim(),
            province: province.trim(), zip: zip.trim(), country: "Argentina",
            first_name: name.trim().split(" ")[0] || "", last_name: name.trim().split(" ").slice(1).join(" ") || "",
            phone: phone.trim(),
          },
          shipping_method: { name: shippingSel.name, price: Number(shippingSel.price) || 0 },
        }),
      });
      const d = await r.json();
      if (d.error) { setFormErr(d.error); setSubmitting(false); return; }
      window.location.href = d.init_point;
    } catch (e) {
      setFormErr("No pudimos conectar con Mercado Pago. Revisá tu conexión y reintentá.");
      setSubmitting(false);
    }
  }

  const st = {
    page: { minHeight: "100vh", background: "#f6f6f7", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", color: "#1a1a1a", padding: "24px 16px" },
    wrap: { maxWidth: 940, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 360px", gap: 24, alignItems: "start" },
    card: { background: "#fff", border: "1px solid #e5e5e7", borderRadius: 14, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
    h: { fontSize: 15, fontWeight: 700, margin: "0 0 14px" },
    label: { fontSize: 12, fontWeight: 600, color: "#555", margin: "0 0 5px", display: "block" },
    input: { width: "100%", padding: "11px 12px", fontSize: 14, border: "1px solid #d6d6d8", borderRadius: 9, boxSizing: "border-box", outline: "none", background: "#fff", fontFamily: "inherit" },
    row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
    field: { marginBottom: 12 },
  };

  if (loading) return <div style={{ ...st.page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ color: "#777", fontSize: 14 }}>Cargando checkout…</div></div>;
  if (loadErr) return <div style={{ ...st.page, display: "flex", alignItems: "center", justifyContent: "center" }}><div style={{ ...st.card, maxWidth: 420, textAlign: "center" }}><div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Ups</div><div style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>{loadErr}</div></div></div>;

  const freqTxt = plan.frequency_days === 30 ? "mensual" : plan.frequency_days === 60 ? "cada 2 meses" : plan.frequency_days === 90 ? "cada 3 meses" : `cada ${plan.frequency_days} días`;
  const summary = (
    <div style={st.card}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        {img ? <img src={img} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: "cover", border: "1px solid #eee" }} /> : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: 0.5 }}>Suscripción · {freqTxt}</div>
          <div style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>{titleOverride || plan.product_title} × {qty}</div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid #eee", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#666" }}>Subtotal{qtyDiscountPct > 0 ? ` (−${qtyDiscountPct}%)` : ""}</span><b>{money(subtotal)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#666" }}>Envío{shippingSel?.name ? ` · ${shippingSel.name}` : ""}</span><b>{(Number(shippingSel?.price) || 0) === 0 ? "Gratis" : money(shippingSel.price)}</b></div>
        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid #eee", paddingTop: 10, fontSize: 15 }}><b>Total {freqTxt}</b><b>{money(total)}</b></div>
      </div>
      <div style={{ marginTop: 12, fontSize: 11, color: "#888", lineHeight: 1.5 }}>Se cobra {money(total)} ahora y se renueva automáticamente {freqTxt}. Podés cancelar cuando quieras.</div>
    </div>
  );

  return (
    <div style={st.page}>
      <style>{`@media(max-width:760px){ .rc-wrap{grid-template-columns:1fr!important;} .rc-summary{order:-1;} }`}</style>
      <div className="rc-wrap" style={st.wrap}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Contacto */}
          <div style={st.card}>
            <h3 style={st.h}>Contacto</h3>
            <div style={st.field}><label style={st.label}>Email</label><input style={st.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="tu@email.com" /></div>
            <div style={st.row2}>
              <div style={st.field}><label style={st.label}>Nombre y apellido</label><input style={st.input} value={name} onChange={e => setName(e.target.value)} placeholder="Juan Pérez" /></div>
              <div style={st.field}><label style={st.label}>Teléfono</label><input style={st.input} value={phone} onChange={e => setPhone(e.target.value)} placeholder="11 2345 6789" /></div>
            </div>
            <div style={st.field}><label style={st.label}>DNI o CUIT <span style={{ color: "#aaa", fontWeight: 400 }}>(opcional, para la factura)</span></label><input style={st.input} value={taxid} onChange={e => setTaxid(e.target.value)} placeholder="20123456789" /></div>
          </div>

          {/* Entrega */}
          <div style={st.card}>
            <h3 style={st.h}>Entrega</h3>
            <div style={st.field}><label style={st.label}>Calle y número</label><input style={st.input} value={address1} onChange={e => setAddress1(e.target.value)} placeholder="Av. Siempreviva 742" /></div>
            <div style={st.field}><label style={st.label}>Piso / depto / referencia <span style={{ color: "#aaa", fontWeight: 400 }}>(opcional)</span></label><input style={st.input} value={address2} onChange={e => setAddress2(e.target.value)} placeholder="3° B" /></div>
            <div style={st.row2}>
              <div style={st.field}><label style={st.label}>Ciudad / Localidad</label><input style={st.input} value={city} onChange={e => setCity(e.target.value)} placeholder="San Justo" /></div>
              <div style={st.field}><label style={st.label}>Código postal</label><input style={st.input} value={zip} onChange={e => setZip(e.target.value)} placeholder="1754" /></div>
            </div>
            <div style={st.field}><label style={st.label}>Provincia</label>
              <select style={st.input} value={province} onChange={e => setProvince(e.target.value)}>
                <option value="">Elegí tu provincia…</option>
                {PROVINCIAS.map(pv => <option key={pv} value={pv}>{pv}</option>)}
              </select>
            </div>
          </div>

          {/* Envío */}
          <div style={st.card}>
            <h3 style={st.h}>Envío</h3>
            {ratesLoading ? <div style={{ fontSize: 13, color: "#888" }}>Buscando métodos de envío…</div> : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rates.map((rt, i) => (
                  <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", border: `1.5px solid ${i === rateIdx ? accent : "#e0e0e2"}`, borderRadius: 10, cursor: "pointer", background: i === rateIdx ? accent + "0d" : "#fff" }}>
                    <input type="radio" checked={i === rateIdx} onChange={() => setRateIdx(i)} style={{ accentColor: accent }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{rt.name}</span>
                    <b style={{ fontSize: 13, color: (Number(rt.price) || 0) === 0 ? "#0a8a3f" : "#1a1a1a" }}>{(Number(rt.price) || 0) === 0 ? "Gratis" : money(rt.price)}</b>
                  </label>
                ))}
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>Los métodos salen de tu tienda. Elegí tu provincia para verlos exactos.</div>
              </div>
            )}
          </div>

          {/* Pago */}
          <div style={st.card}>
            <h3 style={st.h}>Pago</h3>
            <div style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>Vas a completar el pago de forma segura en <b>Mercado Pago</b> (tarjeta, débito o dinero en cuenta).</div>
            {formErr ? <div style={{ background: "#fde8e8", border: "1px solid #f5b5b5", color: "#b42318", fontSize: 13, padding: "10px 12px", borderRadius: 9, marginBottom: 12 }}>{formErr}</div> : null}
            <button onClick={pagar} disabled={submitting} style={{ width: "100%", padding: "14px", fontSize: 15, fontWeight: 700, color: "#fff", background: accent, border: "none", borderRadius: 11, cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Redirigiendo a Mercado Pago…" : `Suscribirme y pagar ${money(total)}`}
            </button>
          </div>
        </div>

        <div className="rc-summary">{summary}</div>
      </div>
    </div>
  );
}
