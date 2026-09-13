import React, { useEffect, useState } from "react";

// Customer portal — público, sin Firebase Auth. El cliente final accede al
// link que le mandamos por email después de activar la sub:
//   https://recurrentes.app/#/portal?token=<JWT>
//
// El JWT está firmado HMAC y contiene { mid, sid, exp }. El backend lo valida
// en cada llamada — acá solo lo reenviamos en cada request.
export default function Portal() {
  const [token, setToken] = useState(null);
  const [data, setData] = useState(null);   // { sub, charges, merchant_brand? }
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [busyAction, setBusyAction] = useState(null);
  const [editingAddr, setEditingAddr] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || window.location.search.slice(1));
    const t = params.get("token");
    if (!t) {
      setErr("Falta el token de acceso. Revisá el link que recibiste por email.");
      setLoading(false);
      return;
    }
    setToken(t);
    load(t);
  }, []);

  async function load(t, silent = false) {
    if (!silent) setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/public?action=sub&token=${encodeURIComponent(t)}`);
      const d = await r.json();
      if (d.error) {
        setErr(d.error);
      } else {
        setData(d);
      }
    } catch (e) {
      setErr("Error de red: " + e.message);
    } finally {
      setLoading(false);
    }
  }

  async function doAction(action) {
    const confirmText = {
      pause: "Pausamos tu suscripción. No se hacen más cobros hasta que la reactives. ¿Confirmás?",
      resume: "Reactivamos tu suscripción y volvés a recibir tus envíos. ¿Confirmás?",
      cancel: "Cancelamos tu suscripción. No se hacen más cobros y no recibís más envíos. Esta acción no se puede deshacer. ¿Confirmás?",
    }[action];
    if (!window.confirm(confirmText)) return;

    setBusyAction(action);
    try {
      const r = await fetch(`/api/public?action=sub&token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      if (d.error) {
        alert("Error: " + d.error);
      } else {
        // Aplicamos el próximo cobro que devuelve MP y recargamos el resto.
        if (d.next_charge_at !== undefined) setData(prev => prev ? { ...prev, sub: { ...prev.sub, next_charge_at: d.next_charge_at, status: d.status || prev.sub.status } } : prev);
        await load(token, true);
      }
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setBusyAction(null);
    }
  }

  if (loading) {
    return <FullScreenCenter><div style={{color:"var(--text-sm)",fontSize:14}}>Cargando tu suscripción…</div></FullScreenCenter>;
  }
  if (err) {
    return (
      <FullScreenCenter>
        <div style={{maxWidth:480,textAlign:"center"}}>
          <div style={{fontSize:46,marginBottom:14}}>🚫</div>
          <h1 style={{fontSize:22,fontWeight:800,margin:"0 0 10px"}}>No pudimos abrir el portal</h1>
          <p style={{fontSize:13,color:"var(--text-md)",lineHeight:1.55}}>{err}</p>
        </div>
      </FullScreenCenter>
    );
  }
  if (!data?.sub) return null;

  const { sub, charges } = data;
  const brand = data.merchant_brand || sub.merchant_brand || "";
  const status = sub.status || "unknown";
  const statusMeta = {
    active:        { label:"Activa",     color:"var(--accent)",     bg:"rgba(16,185,129,0.15)" },
    pending:       { label:"Pendiente",  color:"var(--yellow)",     bg:"rgba(245,158,11,0.15)" },
    paused:        { label:"Pausada",    color:"var(--yellow)",     bg:"rgba(245,158,11,0.15)" },
    cancelled:     { label:"Cancelada",  color:"var(--text-sm)",    bg:"rgba(126,138,147,0.15)" },
    payment_failed:{ label:"Pago falló", color:"var(--red)",        bg:"rgba(239,68,68,0.15)" },
  }[status] || { label: status, color: "var(--text-sm)", bg: "rgba(126,138,147,0.15)" };

  const plan = sub.plan_snapshot || {};
  const formattedNext = sub.next_charge_at ? new Date(sub.next_charge_at).toLocaleDateString("es-AR", { day:"2-digit", month:"long", year:"numeric" }) : null;

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(180deg, var(--bg) 0%, #0d1311 100%)",padding:"32px 20px"}}>
      <div style={{maxWidth:680,margin:"0 auto"}}>
        {/* Header: marca de la tienda si la tenemos, si no Recurrentes */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:22}}>
          <div style={{width:34,height:34,borderRadius:8,background:"linear-gradient(135deg, var(--green), var(--green-dark))",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,boxShadow:"0 2px 8px rgba(16,185,129,0.3)"}}>🔁</div>
          <div>
            <div style={{fontWeight:800,fontSize:18,letterSpacing:-0.3}}>{brand || "Recurrentes"}</div>
            {brand && <div style={{fontSize:10,color:"var(--text-sm)"}}>Suscripciones con Recurrentes</div>}
          </div>
        </div>

        {/* Card principal — estado + plan */}
        <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:"24px 26px",marginBottom:14}}>
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:14,marginBottom:18,flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:4}}>Tu suscripción</div>
              <div style={{fontSize:22,fontWeight:800,letterSpacing:-0.4}}>{plan.product_title || "Suscripción"}</div>
            </div>
            <div style={{fontSize:11,padding:"4px 11px",borderRadius:6,background:statusMeta.bg,color:statusMeta.color,fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>
              {statusMeta.label}
            </div>
          </div>

          {/* Resumen del plan */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))",gap:10,padding:"14px 0",borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)",marginBottom:18}}>
            <Stat label="Total por cobro" value={`$${(plan.total_per_charge_ars||plan.subscription_price_ars||0).toLocaleString("es-AR")}`}/>
            <Stat label="Frecuencia" value={`cada ${plan.frequency_days||"-"} días`}/>
            <Stat label="Paquetes por envío" value={sub.quantity || plan.units_per_shipment || 1}/>
            {formattedNext && status !== "cancelled" && <Stat label={status === "paused" ? "Próximo cobro (al reactivar)" : "Próximo cobro"} value={formattedNext}/>}
          </div>

          {/* Dirección */}
          <div style={{padding:"12px 14px",background:"var(--surface)",borderRadius:10,fontSize:12,color:"var(--text-md)",lineHeight:1.55,marginBottom:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5}}>
              <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5}}>Dirección de envío</div>
              {status !== "cancelled" && (
                <button onClick={()=>setEditingAddr(v=>!v)} style={{...btnSecondary,padding:"4px 10px",fontSize:11}}>{editingAddr ? "Cerrar" : "✏️ Cambiar"}</button>
              )}
            </div>
            {sub.shipping_address?.address1 ? (
              <>
                <div>{sub.shipping_address.address1}{sub.shipping_address.address2?", "+sub.shipping_address.address2:""}</div>
                <div>{sub.shipping_address.city}{sub.shipping_address.province?", "+sub.shipping_address.province:""}{sub.shipping_address.zip?" — CP "+sub.shipping_address.zip:""}</div>
              </>
            ) : <div style={{color:"var(--yellow)"}}>Todavía no tenemos tu dirección — cargala para recibir tus envíos.</div>}
            {editingAddr && (
              <AddressForm sub={sub} token={token} onSaved={async()=>{ setEditingAddr(false); await load(token, true); }}/>
            )}
          </div>

          {/* Acciones */}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {status === "active" && (
              <button onClick={()=>doAction("pause")} disabled={busyAction} style={btnSecondary}>
                {busyAction==="pause"?"Pausando…":"⏸ Pausar"}
              </button>
            )}
            {status === "paused" && (
              <button onClick={()=>doAction("resume")} disabled={busyAction} style={btnPrimary}>
                {busyAction==="resume"?"Reactivando…":"▶ Reactivar"}
              </button>
            )}
            {(status === "active" || status === "paused") && (
              <button onClick={()=>doAction("cancel")} disabled={busyAction} style={btnDanger}>
                {busyAction==="cancel"?"Cancelando…":"✕ Cancelar"}
              </button>
            )}
            {status === "cancelled" && (
              <div style={{fontSize:12,color:"var(--text-sm)",lineHeight:1.5}}>
                Tu suscripción fue cancelada. Si querés volver a suscribirte, andá al producto en la tienda y elegí Suscripción de nuevo.
              </div>
            )}
          </div>
        </div>

        {/* Historial de cargos */}
        {charges?.length > 0 && (
          <div style={{background:"var(--card)",border:"1px solid var(--border)",borderRadius:16,padding:"20px 24px"}}>
            <div style={{fontSize:11,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.5,marginBottom:14}}>Historial de cobros</div>
            {charges.map(c => (
              <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 0",borderBottom:"1px solid var(--border)",gap:10,fontSize:13}}>
                <div>
                  <div style={{fontWeight:600}}>${(c.amount_ars||0).toLocaleString("es-AR")}</div>
                  <div style={{fontSize:11,color:"var(--text-sm)",marginTop:2}}>{new Date(c.created_at).toLocaleDateString("es-AR",{day:"2-digit",month:"long",year:"numeric"})}</div>
                </div>
                <div style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:c.status==="approved"?"rgba(16,185,129,0.15)":"rgba(245,158,11,0.15)",color:c.status==="approved"?"var(--accent)":"var(--yellow)",fontWeight:700,letterSpacing:0.4,textTransform:"uppercase"}}>
                  {c.status==="approved"?"✓ Pagado":c.status}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{fontSize:11,color:"var(--text-sm)",textAlign:"center",marginTop:18}}>
          ¿Necesitás ayuda? Respondé al email que te mandamos cuando se activó tu suscripción.
        </div>
      </div>
    </div>
  );
}

// Cambiar dirección de envío — POST public?action=update-address (token en query + body).
function AddressForm({ sub, token, onSaved }) {
  const a = sub.shipping_address || {};
  const [f, setF] = useState({ address1: a.address1 || "", address2: a.address2 || "", city: a.city || "", province: a.province || "", zip: a.zip || "", phone: a.phone || sub.customer_phone || "" });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF(prev => ({ ...prev, [k]: e.target.value }));

  async function save() {
    if (!f.address1.trim()) return alert("Falta la dirección (calle y número)");
    if (!f.city.trim()) return alert("Falta la ciudad");
    if (!f.province) return alert("Falta la provincia");
    if (!f.zip.trim()) return alert("Falta el código postal");
    if (!f.phone.trim()) return alert("Falta el teléfono");
    setSaving(true);
    try {
      const r = await fetch(`/api/public?action=update-address&token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Shape que espera public.js: { shipping_address:{...}, customer_phone }.
        body: JSON.stringify({ token, shipping_address: { address1: f.address1, address2: f.address2, city: f.city, province: f.province, zip: f.zip }, customer_phone: f.phone }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) { alert("Error: " + (d.error || `HTTP ${r.status}`)); return; }
      alert("✓ Dirección actualizada. Se usa en tus próximos envíos.");
      onSaved?.();
    } catch (e) {
      alert("Error: " + e.message);
    } finally { setSaving(false); }
  }

  return (
    <div style={{marginTop:12,display:"grid",gap:8}}>
      <input value={f.address1} onChange={set("address1")} placeholder="Calle y número *" style={inp}/>
      <input value={f.address2} onChange={set("address2")} placeholder="Piso / depto (opcional)" style={inp}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
        <input value={f.city} onChange={set("city")} placeholder="Ciudad *" style={inp}/>
        <input value={f.zip} onChange={set("zip")} placeholder="Código postal *" style={inp}/>
      </div>
      <select value={f.province} onChange={set("province")} style={inp}>
        <option value="">Provincia *</option>
        {PROVINCIAS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <input value={f.phone} onChange={set("phone")} placeholder="Teléfono *" style={inp}/>
      <button onClick={save} disabled={saving} style={{...btnPrimary,opacity:saving?0.6:1}}>{saving ? "Guardando…" : "Guardar dirección"}</button>
    </div>
  );
}

const PROVINCIAS = ["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];

function Stat({ label, value }) {
  return (
    <div>
      <div style={{fontSize:10,color:"var(--text-sm)",textTransform:"uppercase",fontWeight:700,letterSpacing:0.4,marginBottom:4}}>{label}</div>
      <div style={{fontSize:14,fontWeight:700,color:"var(--text)"}}>{value}</div>
    </div>
  );
}

function FullScreenCenter({ children }) {
  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",padding:24,background:"linear-gradient(180deg, var(--bg) 0%, #0d1311 100%)"}}>
      {children}
    </div>
  );
}

// 16px: evita el zoom automático de iOS al enfocar inputs.
const inp = { width:"100%", background:"var(--card)", border:"1px solid var(--border)", color:"var(--text)", borderRadius:8, padding:"10px 12px", fontSize:16, outline:"none", fontFamily:"inherit", boxSizing:"border-box" };
const btnBase = {
  border: "none", padding: "9px 16px", borderRadius: 9, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const btnPrimary = { ...btnBase, background: "linear-gradient(135deg, var(--green), var(--green-dark))", color: "#fff", boxShadow: "0 2px 8px rgba(16,185,129,0.25)" };
const btnSecondary = { ...btnBase, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" };
const btnDanger = { ...btnBase, background: "transparent", color: "var(--red)", border: "1px solid rgba(239,68,68,0.4)" };
