// Logística: los envíos que se ofrecen al suscribirse y qué hacer sin stock.
//
// 28-sept-2026 (Thiago, pedido de G4U). Dos decisiones que antes no existían:
//   · Los envíos de la tienda entran todos, pero acá el comercio elige cuáles
//     quiere ofrecer EN LA SUSCRIPCIÓN. Ejemplo real: en la compra única deja
//     Correo Argentino y las sucursales, y en la suscripción solo el domicilio
//     de Andreani. Lo que muestra el checkout de su tienda no se toca.
//   · Qué pasa si en la renovación no hay stock.
//
// Las reglas viven en shared/platform/logistics.js (las mismas que usa el
// backend); acá solo se eligen.
import React, { useEffect, useState } from "react";
import { DS, useT } from "../ui/theme.js";
import { Btn, Callout, DSBadge, InputStyle, PageHeader, Spinner, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { apiPatch } from "../lib/api.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { STOCK_SOURCES, STOCK_ON_MISSING, resolveStockPolicy } from "../../shared/platform/logistics.js";

const MAX_RATES = 6;
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

export default function LogisticsPage({ merchant, onMerchantChange }) {
  const T = useT();
  const m = merchant || {};
  const isOwner = (m.role || "owner") === "owner";
  const profile = merchantProfile(m);
  return (
    <>
      <PageHeader T={T} title="Logística" subtitle="Los envíos que ve tu cliente al suscribirse y qué hacer cuando no hay stock."/>
      <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
        {profile.caps.shipping && <RatesCard T={T} m={m} isOwner={isOwner} onChange={onMerchantChange}/>}
        <StockCard T={T} m={m} isOwner={isOwner} onChange={onMerchantChange}/>
      </div>
    </>
  );
}

// ── Envíos ──────────────────────────────────────────────────────────────────
function RatesCard({ T, m, isOwner, onChange }) {
  const iS = InputStyle(T);
  const guardadas = Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : [];
  const [rates, setRates] = useState(guardadas);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRates(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []); }, [m.checkout_shipping_rates]);

  const norm = (rs) => JSON.stringify(rs.map(r => [String(r.name || "").trim(), parseInt(r.price, 10) || 0, r.off === true]));
  const dirty = norm(rates) !== norm(guardadas);
  const prendidas = rates.filter(r => r.off !== true).length;

  async function save() {
    // La tarifa entera: adentro viaja el transportista que necesita la app de
    // envíos del comercio. Armar un objeto nuevo acá se lo borra.
    const clean = rates
      .map(r => ({ ...r, name: String(r.name || "").trim(), price: parseInt(r.price, 10) || 0 }))
      .filter(r => r.name);
    setBusy(true);
    const d = await apiPatch("merchant", { checkout_shipping_rates: clean }, { action: "save-settings" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Envíos guardados", "success");
    onChange?.();
  }
  const upd = (i, k, v) => setRates(rs => rs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const inl = { ...iS, padding:"7px 10px", fontSize:DS.font.md, marginBottom:0, minWidth:0 };

  return (
    <Panel T={T} title="Envíos de la suscripción"
      sub="Los traemos solos de tu tienda al conectarla. Acá elegís cuáles se le ofrecen al que se suscribe y a qué precio. Tu checkout normal no cambia: podés dejar las sucursales para la compra única y en la suscripción solo el envío a domicilio."
      right={<>
        {dirty && <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>}
        {isOwner && rates.length < MAX_RATES && (
          <Btn T={T} variant="secondary" size="sm" type="button" onClick={() => setRates(rs => [...rs, { name:"", price:0 }])}>+ Agregar</Btn>
        )}
      </>}>
      {!rates.length ? (
        <Callout T={T} tone="warning">
          Todavía no hay envíos cargados. Si tu tienda está conectada, los traemos solos; si no aparecieron, agregá uno
          con el botón de arriba. Mientras tanto, las suscripciones salen con el envío por defecto de cada plan.
        </Callout>
      ) : (
        <>
          {!prendidas && (
            <Callout T={T} tone="warning" style={{ marginBottom:12 }}>
              Apagaste todos: tu cliente no va a poder elegir ningún envío y se usa el del plan. Dejá al menos uno prendido.
            </Callout>
          )}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {rates.map((r, i) => {
              const on = r.off !== true;
              return (
                <div key={i} style={{
                  display:"grid", gridTemplateColumns:"28px minmax(0,1fr) 120px auto", gap:10, alignItems:"center",
                  padding:"10px 12px", borderRadius:DS.r.lg, border:`1px solid ${on ? T.border : T.borderL}`,
                  background: on ? T.surface : "transparent", opacity: on ? 1 : 0.6,
                }}>
                  <input type="checkbox" checked={on} disabled={!isOwner} aria-label={`Ofrecer ${r.name || "este envío"} en la suscripción`}
                    onChange={e => upd(i, "off", !e.target.checked)} style={{ accentColor:T.accentSolid, width:18, height:18 }}/>
                  <input value={r.name || ""} disabled={!isOwner} onChange={e => upd(i, "name", e.target.value)} placeholder="Nombre del envío" style={inl}/>
                  <input value={r.price ?? 0} disabled={!isOwner} onChange={e => upd(i, "price", e.target.value.replace(/\D/g, ""))}
                    inputMode="numeric" aria-label="Precio" style={{ ...inl, textAlign:"right" }}/>
                  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                    {r.carrier_id && <DSBadge T={T} color={T.green} size="sm" title="Sale con el transportista de tu tienda">etiqueta automática</DSBadge>}
                    {r.pickup && <DSBadge T={T} color={T.textSm} size="sm">retiro</DSBadge>}
                    {isOwner && <Btn T={T} variant="ghost" size="sm" type="button" onClick={() => setRates(rs => rs.filter((_, j) => j !== i))} style={{ color:T.textSm }}>✕</Btn>}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:10, lineHeight:1.5 }}>
            Los que dicen <strong style={{ color:T.text }}>etiqueta automática</strong> salen en la orden con el
            transportista que ya usás, así tu app de envíos los despacha como cualquier venta. Precio {fmtARS(0)} = envío gratis.
          </div>
          {isOwner && (
            <div style={{ marginTop:12 }}>
              <Btn T={T} variant="primary" onClick={save} disabled={busy || !dirty}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar envíos"}</Btn>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Stock ───────────────────────────────────────────────────────────────────
function StockCard({ T, m, isOwner, onChange }) {
  const saved = resolveStockPolicy(m);
  const [source, setSource] = useState(saved.source);
  const [onMissing, setOnMissing] = useState(saved.on_missing);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const s = resolveStockPolicy(m); setSource(s.source); setOnMissing(s.on_missing); }, [m.stock_policy]);
  const dirty = source !== saved.source || onMissing !== saved.on_missing;

  async function save() {
    setBusy(true);
    const d = await apiPatch("merchant", { stock_policy: { source, on_missing: onMissing } }, { action: "save-settings" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Stock guardado", "success");
    onChange?.();
  }

  const Opt = ({ list, value, set, name }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {list.map(o => {
        const on = value === o.id;
        return (
          <label key={o.id} style={{
            display:"flex", gap:10, alignItems:"flex-start", padding:"11px 12px", borderRadius:DS.r.lg, cursor: isOwner ? "pointer" : "default",
            border:`1px solid ${on ? T.accentSolid + "66" : T.border}`, background: on ? T.accentSolid + "0f" : T.surface,
          }}>
            <input type="radio" name={name} checked={on} disabled={!isOwner} onChange={() => set(o.id)} style={{ accentColor:T.accentSolid, marginTop:2 }}/>
            <span style={{ minWidth:0 }}>
              <span style={{ display:"block", fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{o.label}</span>
              <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:2, lineHeight:1.45 }}>{o.desc}</span>
            </span>
          </label>
        );
      })}
    </div>
  );

  return (
    <Panel T={T} title="Stock"
      sub="Qué mira la suscripción y qué hacer cuando un producto se queda sin unidades justo en la renovación."
      right={dirty ? <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge> : null}>
      <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"2px 0 8px" }}>De dónde se lee</div>
      <Opt list={STOCK_SOURCES} value={source} set={setSource} name="stock-source"/>

      {source === "store" && (
        <>
          <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"18px 0 8px" }}>Cuando no hay stock</div>
          <Opt list={STOCK_ON_MISSING} value={onMissing} set={setOnMissing} name="stock-missing"/>
          <Callout T={T} tone="info" style={{ marginTop:12 }}>
            En los dos casos <strong style={{ color:T.text }}>la orden de ese cobro se crea igual</strong>: el dinero ya
            entró y una orden que no existe es plata cobrada sin pedido. Lo que cambia es qué pasa después.
          </Callout>
        </>
      )}

      {isOwner && (
        <div style={{ marginTop:14 }}>
          <Btn T={T} variant="primary" onClick={save} disabled={busy || !dirty}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar stock"}</Btn>
        </div>
      )}
    </Panel>
  );
}
