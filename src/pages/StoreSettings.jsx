import React, { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, InputStyle, Spinner, Callout, Hint, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { MONO, SurfaceBox } from "./_shared.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";
import { DiscountCodesCard } from "./OperationalSettings.jsx";

// ─── Configuración → Checkout (antes "Tienda") ────────────────────
// Lo que ve el cliente al suscribirse:
//   · "Envíos del checkout": importar de Shopify (GET shopify?action=
//     shipping-rates-admin → elegir → POST merchant?action=import-shipping-rates
//     { rates }) o editar a mano (máx 6) → PATCH save-settings { checkout_shipping_rates }.
//   · "Códigos de descuento" (OperationalSettings.jsx).
// Los datos de la tienda (solo lectura, de Shopify) viven en Configuración → Tiendas
// (StoreDataSection):
//   · Actualizar desde Shopify → GET merchant?action=refresh-shop
//   · Editar dominio (caso raro) → PATCH save-settings { store_domain } (el
//     backend marca store_domain_source:"manual"; vacío → vuelve a Shopify)

const MAX_RATES = 6;
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

export default function CheckoutSettings({ merchant, onChange }) {
  const T = useT();
  const m = merchant || {};
  const isOwner = (m.role || "owner") === "owner";
  // Perfil del negocio: sin envío (servicios, digitales) no hay tarifas que configurar.
  const profile = merchantProfile(m);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      {/* Los envíos ya no se configuran acá: el checkout usa los mismos métodos y
          precios que la tienda tiene para una venta normal (cotización en vivo, se
          activa en Integraciones → Shopify → Ajustes). Esta sección es solo descuentos. */}
      <DiscountCodesCard merchant={m} onChange={onChange}/>
    </div>
  );
}

// Datos de la tienda activa (Configuración → Tiendas).
export function StoreDataSection({ merchant, onChange }) {
  const T = useT();
  const m = merchant || {};
  return <StoreDataCard T={T} m={m} isOwner={(m.role || "owner") === "owner"} onChange={onChange} profile={merchantProfile(m)}/>;
}

// ── Datos de la tienda (solo lectura) ─────────────────────────────
function StoreDataCard({ T, m, isOwner, onChange, profile }) {
  const iS = InputStyle(T);
  const shopifyOk = Boolean(m.shopify_token);
  // Sin tienda online (servicios, link): los datos se cargan a mano, no hay Shopify del cual leerlos.
  const fromShopify = !profile || profile.channel === "shopify";
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(m.store_name || "");
  useEffect(() => { setNameDraft(m.store_name || ""); }, [m.store_name]);
  async function saveName() {
    const v = String(nameDraft || "").trim().slice(0, 60);
    const d = await apiPatch("merchant", { store_name: v }, { action: "save-settings" });
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Nombre guardado", "success");
    setEditingName(false);
    onChange?.();
  }
  const domain = m.store_domain_effective || m.store_domain || (m.shopify_shop ? m.shopify_shop : "");
  const source = m.store_domain_source || (m.store_domain ? "manual" : (domain ? "shopify" : null));
  const [refreshing, setRefreshing] = useState(false);
  const [editingDomain, setEditingDomain] = useState(false);
  const [domainDraft, setDomainDraft] = useState(m.store_domain || domain || "");
  const [savingDomain, setSavingDomain] = useState(false);
  useEffect(() => { setDomainDraft(m.store_domain || domain || ""); }, [m.store_domain, domain]);

  async function refresh() {
    setRefreshing(true);
    const d = await apiGet("merchant", { action: "refresh-shop" });
    setRefreshing(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Datos actualizados desde Shopify", "success");
    onChange?.();
  }
  async function saveDomain(value) {
    const v = String(value ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
    setSavingDomain(true);
    const d = await apiPatch("merchant", { store_domain: v }, { action: "save-settings" });
    setSavingDomain(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(v ? "Dominio guardado (manual)" : "Dominio: vuelve a tomarse de Shopify", "success");
    setEditingDomain(false);
    onChange?.();
  }

  const rows = [
    ["Nombre", m.store_name || m.shop_name || "—"],
    ["Dominio público", domain ? <span style={{ fontFamily:MONO }}>{domain}</span> : "—", source === "manual" && fromShopify ? <DSBadge T={T} color={T.yellow} size="sm">manual</DSBadge> : source === "shopify" ? <DSBadge T={T} color={T.green} size="sm">de Shopify</DSBadge> : null],
    ["Moneda", m.shop_currency || profile?.currency || "—"],
    [fromShopify ? "Mail de la tienda" : "Mail del negocio", m.shop_email || m.email_reply_to || (fromShopify ? "—" : (m.email || "—"))],
  ];

  return (
    <Panel T={T}
      title={fromShopify ? "Datos de la tienda activa" : "Datos de tu negocio"}
      sub={fromShopify ? "Los tomamos de tu Shopify. No hace falta cargar nada a mano." : "El nombre aparece en el checkout de tus links y en los mails. El dominio es opcional: arma los links de los mails y del portal."}
      right={fromShopify
        ? (isOwner && <Btn T={T} variant="secondary" size="sm" onClick={refresh} disabled={!shopifyOk || refreshing} title={shopifyOk ? "" : "Conectá Shopify primero"}>{refreshing ? <><Spinner size={12} color={T.textMd}/> Actualizando…</> : "↻ Actualizar desde Shopify"}</Btn>)
        : (isOwner && !editingName && <Btn T={T} variant="secondary" size="sm" onClick={()=>setEditingName(true)}>Editar nombre</Btn>)}>
      {!fromShopify && editingName && (
        <div className="gh-accordion" style={{ marginBottom:12, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} maxLength={60} style={{ ...iS, marginBottom:0, flex:"1 1 220px" }} placeholder="Ej: Gimnasio Olimpo" onKeyDown={e=>{ if (e.key === "Enter") saveName(); }}/>
          <Btn T={T} variant="primary" size="sm" onClick={saveName}>Guardar</Btn>
          <Btn T={T} variant="ghost" size="sm" onClick={()=>setEditingName(false)} style={{ color:T.textSm }}>Cancelar</Btn>
        </div>
      )}
      {fromShopify && !shopifyOk && (
        <Callout T={T} tone="warning" style={{ marginBottom:12 }} right={<a href="#/config/integraciones" style={{ color:T.accent, fontWeight:DS.w.bold, fontSize:DS.font.sm, textDecoration:"none" }}>Conectar →</a>}>
          Conectá Shopify en Configuración → Integraciones para traer nombre, dominio, moneda y mail.
        </Callout>
      )}
      <div style={{ border:`1px solid ${T.borderL}`, borderRadius:10, overflow:"hidden" }}>
        {rows.map(([label, value, badge], i) => (
          <div key={label} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", padding:"10px 14px", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, background: i % 2 ? T.surface : "transparent" }}>
            <span style={{ fontSize:DS.font.sm, color:T.textSm, minWidth:150, fontWeight:DS.w.semibold, textTransform:"uppercase", letterSpacing:0.4 }}>{label}</span>
            <span style={{ flex:1, minWidth:160, fontSize:DS.font.base, color:T.text, wordBreak:"break-all" }}>{value}</span>
            {badge}
            {label === "Dominio público" && isOwner && !editingDomain && (
              <button type="button" onClick={()=>setEditingDomain(true)} style={{ background:"transparent", border:"none", color:T.textSm, fontSize:DS.font.sm, cursor:"pointer", fontFamily:"inherit", textDecoration:"underline" }}>Editar dominio</button>
            )}
          </div>
        ))}
      </div>
      {editingDomain && (
        <div className="gh-accordion" style={{ marginTop:12, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px" }}>
          <div style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.text, marginBottom:6 }}>Dominio público (caso raro)</div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5, marginBottom:8 }}>{fromShopify ? "Solo si el dominio que ve tu cliente no es el que figura en Shopify." : "Tu web, si tenés (opcional)."} Sin https://. Se usa en los links de los mails y el portal.</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <input value={domainDraft} onChange={e=>setDomainDraft(e.target.value)} style={{ ...iS, marginBottom:0, flex:"1 1 220px", fontFamily:MONO, fontSize:DS.font.md }} placeholder="www.mitienda.com" onKeyDown={e=>{ if (e.key === "Enter") saveDomain(domainDraft); }}/>
            <Btn T={T} variant="primary" size="sm" onClick={()=>saveDomain(domainDraft)} disabled={savingDomain}>{savingDomain ? "Guardando…" : "Guardar"}</Btn>
            {source === "manual" && fromShopify && <Btn T={T} variant="secondary" size="sm" onClick={()=>saveDomain("")} disabled={savingDomain}>Volver al de Shopify</Btn>}
            <Btn T={T} variant="ghost" size="sm" onClick={()=>setEditingDomain(false)} style={{ color:T.textSm }}>Cancelar</Btn>
          </div>
        </div>
      )}
      {m.shop_info_at && <Hint T={T} style={{ marginTop:10, marginBottom:0 }}>Última lectura de Shopify: {new Date(m.shop_info_at).toLocaleString("es-AR")}.</Hint>}
    </Panel>
  );
}

// ── Envíos del checkout ───────────────────────────────────────────
function ShippingRatesCard({ T, m, isOwner, onChange, profile }) {
  const iS = InputStyle(T);
  const shopifyOk = Boolean(m.shopify_token);
  const fromShopify = profile?.channel === "shopify";
  const savedRates = Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : [];
  const [rates, setRates] = useState(savedRates);
  const [busy, setBusy] = useState("");
  // Importación: lista traída de Shopify pendiente de confirmar
  const [imported, setImported] = useState(null); // { rates:[{name,price,code,source,_on}], note }
  useEffect(() => { setRates(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []); }, [m.checkout_shipping_rates]);
  const norm = (rs) => JSON.stringify(rs.map(r => [String(r.name || "").trim(), parseInt(r.price, 10) || 0, r.code || ""]));
  const dirty = norm(rates) !== norm(savedRates);
  const liveQuotes = m.shipping_live_quotes === true;

  async function toggleLiveQuotes(on) {
    setBusy("live");
    const d = await apiPatch("merchant", { shipping_live_quotes: on }, { action: "save-settings" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast(on ? "Ahora el checkout cotiza con tu proveedor de envíos" : "Volvimos a tus tarifas fijas", "success");
    onChange?.();
  }

  async function fetchFromShopify() {
    setBusy("fetch");
    const d = await apiGet("shopify", { action: "shipping-rates-admin" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    const list = (Array.isArray(d?.rates) ? d.rates : []).map((r, i) => ({ ...r, _on: i < MAX_RATES }));
    setImported({ rates: list, note: d?.note || null });
    if (!list.length) toast(d?.note || "Shopify no devolvió tarifas fijas. Cargalas a mano.", "warning", 6000);
  }
  async function useImported() {
    const sel = (imported?.rates || []).filter(r => r._on).slice(0, MAX_RATES).map(r => ({ name: r.name, price: r.price, code: r.code || "" }));
    if (!sel.length) return toast("Elegí al menos un envío", "warning");
    setBusy("import");
    const d = await apiPost("merchant", { rates: sel }, { action: "import-shipping-rates" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    if (d?.note) toast(d.note, "warning", 6000);
    toast(`Importados ${d?.imported ?? sel.length} envíos de Shopify`, "success");
    setImported(null);
    if (Array.isArray(d?.rates)) setRates(d.rates);
    onChange?.();
  }
  async function saveRates() {
    const clean = rates.map(r => ({ name: String(r.name || "").trim(), price: parseInt(r.price, 10) || 0, code: r.code || "" })).filter(r => r.name);
    setBusy("save");
    const d = await apiPatch("merchant", { checkout_shipping_rates: clean.map(r => ({ name: r.name, price: r.price, ...(r.code ? { code: r.code } : {}) })) }, { action: "save-settings" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Envíos guardados", "success");
    onChange?.();
  }
  const updRate = (i, k, v) => setRates(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const inl = { ...iS, padding:"7px 10px", fontSize:DS.font.md, marginBottom:0, minWidth:0 };
  const selCount = (imported?.rates || []).filter(r => r._on).length;

  return (
    <Panel T={T} title="Envíos del checkout"
      sub="Lo que el cliente elige al suscribirse y queda en cada orden recurrente. Si no cargás ninguno, se usa el envío por defecto de cada plan."
      right={<>
        {dirty && <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>}
        {isOwner && fromShopify && <Btn T={T} variant="secondary" size="sm" onClick={fetchFromShopify} disabled={!shopifyOk || !!busy} title={shopifyOk ? "" : "Conectá Shopify primero"}>{busy === "fetch" ? <><Spinner size={12} color={T.textMd}/> Leyendo…</> : "⬇ Importar de Shopify"}</Btn>}
        {rates.length < MAX_RATES && <Btn T={T} variant="secondary" size="sm" onClick={()=>setRates(rs=>[...rs,{name:"",price:0,code:""}])} type="button">+ Agregar</Btn>}
      </>}>

      {isOwner && fromShopify && shopifyOk && (
        <div style={{ marginBottom:14, background:T.surface, border:`1px solid ${liveQuotes ? T.accentSolid + "55" : T.border}`, borderRadius:DS.r.lg, padding:"12px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap" }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.text }}>
                Cotizar con tu proveedor de envíos
                {liveQuotes && <DSBadge T={T} color={T.accentSolid} size="sm" style={{ marginLeft:8 }}>Activo</DSBadge>}
              </div>
              <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.5 }}>
                Tu cliente ve los mismos métodos y sucursales que en el checkout de Shopify, con el precio del momento,
                y la orden le llega a tu app de envíos igual que una venta suelta. Se suman a las tarifas fijas de abajo.
                <br/><strong>Probalo con una suscripción tuya antes de dejarlo prendido</strong>: tiene que aparecer en tu
                proveedor lista para despachar.
              </div>
            </div>
            <Btn T={T} variant={liveQuotes ? "secondary" : "primary"} size="sm" disabled={!!busy}
              onClick={() => toggleLiveQuotes(!liveQuotes)}>
              {busy === "live" ? <><Spinner size={12} color={T.textMd}/> Guardando…</> : (liveQuotes ? "Desactivar" : "Activar")}
            </Btn>
          </div>
        </div>
      )}

      {imported && (
        <div className="gh-accordion" style={{ marginBottom:14, background:T.surface, border:`1px solid ${T.accentSolid}55`, borderRadius:DS.r.lg, padding:"12px 14px" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:8 }}>
            <div>
              <div style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.text }}>Envíos en tu Shopify</div>
              <div style={{ fontSize:DS.font.sm, color:T.textSm }}>Destildá los que no quieras. Máximo {MAX_RATES}. Reemplazan a la lista de abajo.</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <Btn T={T} variant="solid" size="sm" onClick={useImported} disabled={!!busy || !selCount || selCount > MAX_RATES}>{busy === "import" ? "Importando…" : `Usar estas (${selCount})`}</Btn>
              <Btn T={T} variant="ghost" size="sm" onClick={()=>setImported(null)} style={{ color:T.textSm }}>Cancelar</Btn>
            </div>
          </div>
          {imported.note && <Callout T={T} tone="info" style={{ marginBottom:8 }}>{imported.note}</Callout>}
          {imported.rates.length === 0 ? (
            <div style={{ fontSize:DS.font.sm, color:T.textSm }}>No encontramos tarifas fijas (¿usás tarifas dinámicas de un correo?). Cargalas a mano abajo.</div>
          ) : imported.rates.map((r, i) => (
            <label key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"6px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, cursor:"pointer", fontSize:DS.font.md, color:T.text }}>
              <input type="checkbox" checked={r._on} onChange={e=>setImported(s => ({ ...s, rates: s.rates.map((x, j) => j === i ? { ...x, _on: e.target.checked } : x) }))} style={{ accentColor:T.accentSolid }}/>
              <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis" }}>{r.name}</span>
              <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(r.price)}</span>
              {r.source && <DSBadge T={T} color={T.textSm} size="sm">{r.source}</DSBadge>}
            </label>
          ))}
        </div>
      )}

      {rates.length === 0 && !imported && (
        <SurfaceBox T={T} style={{ marginBottom:12 }}><div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>Sin envíos del checkout: cada plan usa su envío por defecto. {fromShopify ? "Importalos de Shopify (recomendado) o agregalos a mano." : "Agregalos a mano."}</div></SurfaceBox>
      )}
      {rates.map((r, i) => (
        <div key={i} style={{ display:"grid", gridTemplateColumns:"minmax(0,2fr) minmax(0,1fr) minmax(0,1fr) auto", gap:6, alignItems:"center", marginBottom:6 }}>
          <input value={r.name} onChange={e=>updRate(i,"name",e.target.value)} style={inl} aria-label={`Nombre del envío ${i + 1}`} placeholder="Nombre (ej. Andreani a domicilio)"/>
          <input type="number" min="0" value={r.price} onChange={e=>updRate(i,"price",e.target.value)} style={inl} aria-label={`Precio del envío ${i + 1}`} placeholder="Precio $"/>
          <input value={r.code || ""} onChange={e=>updRate(i,"code",e.target.value)} style={inl} aria-label={`Código del envío ${i + 1}`} placeholder="Código (opcional)"/>
          <button type="button" onClick={()=>setRates(rs=>rs.filter((_,j)=>j!==i))} title="Quitar" aria-label={`Quitar ${r.name || "envío"}`} style={{ background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:14, padding:"4px 6px", fontFamily:"inherit", lineHeight:1 }}
            onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
        </div>
      ))}
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginTop:8 }}>
        <Btn T={T} variant="primary" onClick={saveRates} disabled={!!busy || !dirty}>{busy === "save" ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar envíos"}</Btn>
        <span style={{ fontSize:DS.font.sm, color:T.textSm }}>{rates.length}/{MAX_RATES}{m.checkout_shipping_rates_source === "shopify" ? " · importados de Shopify" : ""}</span>
      </div>
    </Panel>
  );
}
