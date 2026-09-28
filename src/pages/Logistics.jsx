// Envíos y Stock de la suscripción (28-sept-2026, Thiago, pedido de G4U).
//
// Dos pantallas, una decisión cada una:
//   · Envíos → de todos los métodos que tiene la tienda, cuáles se le ofrecen
//     al que se suscribe. Por defecto TODOS, igual que antes de que esto
//     existiera: lo único que se guarda es la lista de los apagados. El caso
//     real es sacar las sucursales, que para un envío que se repite todos los
//     meses son un dolor de cabeza.
//   · Stock → qué mira la suscripción y qué hacer si falta en la renovación.
//
// Las reglas viven en shared/platform/logistics.js, las mismas que usa el
// backend para filtrar lo que ve el comprador.
import React, { useCallback, useEffect, useState } from "react";
import { DS, useT } from "../ui/theme.js";
import { Btn, Callout, DSBadge, InputStyle, PageHeader, Spinner, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { apiGet, apiPatch } from "../lib/api.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { STOCK_SOURCES, STOCK_ON_MISSING, resolveStockPolicy, rateKey, rateOffered } from "../../shared/platform/logistics.js";

const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

export default function LogisticsPage({ section = "envios", merchant, onMerchantChange }) {
  const T = useT();
  const m = merchant || {};
  const isOwner = (m.role || "owner") === "owner";
  const profile = merchantProfile(m);

  if (section === "stock") {
    return (
      <>
        <PageHeader T={T} title="Stock" subtitle="Qué pasa si un producto se queda sin unidades justo cuando toca la renovación."/>
        <StockCard T={T} m={m} isOwner={isOwner} onChange={onMerchantChange}/>
      </>
    );
  }
  return (
    <>
      <PageHeader T={T} title="Envíos" subtitle="Los que ve tu cliente al suscribirse. Vienen todos; acá sacás los que no quieras."/>
      {profile.caps.shipping
        ? <ShippingCard T={T} m={m} isOwner={isOwner} profile={profile} onChange={onMerchantChange}/>
        : <Callout T={T} tone="info">Lo que vendés no se envía, así que no hay métodos que configurar.</Callout>}
    </>
  );
}

// ── Envíos ──────────────────────────────────────────────────────────────────
function ShippingCard({ T, m, isOwner, profile, onChange }) {
  const iS = InputStyle(T);
  const esShopify = profile.channel === "shopify" && Boolean(m.shopify_token);
  const guardadas = Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : [];
  const [live, setLive] = useState(null);          // métodos que cotiza Shopify en vivo
  const [cargando, setCargando] = useState(false);
  const [off, setOff] = useState(Array.isArray(m.shipping_off) ? m.shipping_off : []);
  const [precios, setPrecios] = useState(guardadas);
  const [busy, setBusy] = useState("");

  useEffect(() => { setOff(Array.isArray(m.shipping_off) ? m.shipping_off : []); }, [m.shipping_off]);
  useEffect(() => { setPrecios(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []); }, [m.checkout_shipping_rates]);

  // Shopify cotiza en vivo y no guarda nada: para poder apagar un método hay
  // que mostrárselos, así que se los pedimos a la tienda al abrir la pantalla.
  const traerLive = useCallback(async () => {
    if (!esShopify || !isOwner) return;
    setCargando(true);
    const d = await apiGet("shopify", { action: "shipping-rates-admin" });
    setCargando(false);
    if (d?.error) return;
    setLive(Array.isArray(d?.rates) ? d.rates : []);
  }, [esShopify, isOwner]);
  useEffect(() => { traerLive(); }, [traerLive]);

  // La lista que se muestra: lo guardado + lo que cotiza la tienda, sin repetir.
  const vistos = new Set();
  const lista = [];
  for (const r of [...guardadas, ...(live || [])]) {
    const k = rateKey(r);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    lista.push({ ...r, _guardada: guardadas.some(g => rateKey(g) === k) });
  }

  const apagado = (r) => !rateOffered(r, { shipping_off: off });
  const toggle = (r) => {
    const k = rateKey(r);
    setOff(prev => apagado(r) ? prev.filter(x => x !== k && x !== String(r.name || "").toLowerCase()) : [...prev, k]);
  };
  const setPrecio = (r, v) => setPrecios(ps => ps.map(p => rateKey(p) === rateKey(r) ? { ...p, price: v.replace(/\D/g, "") } : p));

  const sucio = JSON.stringify([...off].sort()) !== JSON.stringify([...(m.shipping_off || [])].sort())
    || JSON.stringify(precios.map(p => [p.name, String(p.price)])) !== JSON.stringify(guardadas.map(p => [p.name, String(p.price)]));

  async function guardar() {
    setBusy("save");
    const body = { shipping_off: off };
    // La tarifa entera: adentro viaja el transportista que necesita la app de
    // envíos del comercio. Armar un objeto nuevo acá se lo borra.
    if (precios.length) body.checkout_shipping_rates = precios.map(p => ({ ...p, price: parseInt(p.price, 10) || 0 }));
    const d = await apiPatch("merchant", body, { action: "save-settings" });
    setBusy("");
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Envíos guardados", "success");
    onChange?.();
  }

  const prendidos = lista.filter(r => !apagado(r)).length;

  return (
    <Panel T={T} title="Métodos de envío"
      sub={esShopify ? "Los cotiza tu tienda en el momento." : "Los traemos de tu tienda. El precio lo ponés vos."}
      right={<>
        {sucio && <DSBadge T={T} color={T.yellow} size="sm">Sin guardar</DSBadge>}
        {esShopify && isOwner && <Btn T={T} variant="secondary" size="sm" onClick={traerLive} disabled={cargando}>{cargando ? <><Spinner size={12} color={T.textMd}/> Leyendo…</> : "Actualizar lista"}</Btn>}
      </>}>

      {cargando && !lista.length ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, color:T.textSm, fontSize:DS.font.md, padding:"6px 0" }}>
          <Spinner size={14} color={T.accent}/> Leyendo los envíos de tu tienda…
        </div>
      ) : !lista.length ? (
        <Callout T={T} tone="info">
          Todavía no vemos métodos de envío de tu tienda. No pasa nada: la suscripción usa el envío que tenga cargado
          cada plan. Si acabás de conectar la tienda, probá con <strong style={{ color:T.text }}>Actualizar lista</strong>.
        </Callout>
      ) : (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {lista.map((r, i) => {
              const on = !apagado(r);
              return (
                <label key={rateKey(r) + i} style={{
                  display:"grid", gridTemplateColumns:"22px minmax(0,1fr) auto", gap:12, alignItems:"center",
                  padding:"12px 14px", borderRadius:DS.r.lg, cursor: isOwner ? "pointer" : "default",
                  border:`1px solid ${on ? T.border : T.borderL}`, background: on ? T.surface : "transparent",
                  transition:"background .15s, border-color .15s",
                }}>
                  <input type="checkbox" checked={on} disabled={!isOwner} onChange={() => toggle(r)}
                    aria-label={`Ofrecer ${r.name} en la suscripción`} style={{ accentColor:T.accentSolid, width:17, height:17 }}/>
                  <span style={{ minWidth:0 }}>
                    <span style={{ display:"block", fontSize:DS.font.base, fontWeight:DS.w.bold, color: on ? T.text : T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</span>
                    <span style={{ display:"flex", gap:6, alignItems:"center", marginTop:3, flexWrap:"wrap" }}>
                      {!on && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>No se ofrece en la suscripción</span>}
                      {on && r.carrier_id && <DSBadge T={T} color={T.green} size="sm">etiqueta automática</DSBadge>}
                      {on && r.pickup && <DSBadge T={T} color={T.textSm} size="sm">retiro</DSBadge>}
                      {on && !r._guardada && <DSBadge T={T} color={T.textSm} size="sm">precio en vivo</DSBadge>}
                    </span>
                  </span>
                  {r._guardada && isOwner ? (
                    <input value={r.price ?? 0} onChange={e => setPrecio(r, e.target.value)} inputMode="numeric" aria-label={`Precio de ${r.name}`}
                      onClick={e => e.preventDefault()}
                      style={{ ...iS, marginBottom:0, width:110, padding:"7px 10px", textAlign:"right", fontSize:DS.font.md }}/>
                  ) : (
                    <span style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:T.textMd, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
                      {r.price ? fmtARS(r.price) : "según CP"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          {!prendidos && (
            <Callout T={T} tone="warning" style={{ marginTop:12 }}>
              Apagaste todos. Tu cliente no va a poder elegir envío y la suscripción sale con el del plan.
            </Callout>
          )}

          <div style={{ display:"flex", alignItems:"center", gap:12, marginTop:14, flexWrap:"wrap" }}>
            {isOwner && <Btn T={T} variant="primary" onClick={guardar} disabled={!!busy || !sucio}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar"}</Btn>}
            <span style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>
              Esto cambia solo la <strong style={{ color:T.text }}>suscripción</strong>. Tu checkout normal sigue mostrando todo.
            </span>
          </div>
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
  const sucio = source !== saved.source || onMissing !== saved.on_missing;

  async function guardar() {
    setBusy(true);
    const d = await apiPatch("merchant", { stock_policy: { source, on_missing: onMissing } }, { action: "save-settings" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Stock guardado", "success");
    onChange?.();
  }

  const Opciones = ({ list, value, set, name }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {list.map(o => {
        const on = value === o.id;
        return (
          <label key={o.id} style={{
            display:"flex", gap:11, alignItems:"flex-start", padding:"13px 14px", borderRadius:DS.r.lg, cursor: isOwner ? "pointer" : "default",
            border:`1px solid ${on ? T.accentSolid + "66" : T.border}`, background: on ? T.accentSolid + "0f" : T.surface,
          }}>
            <input type="radio" name={name} checked={on} disabled={!isOwner} onChange={() => set(o.id)} style={{ accentColor:T.accentSolid, marginTop:3 }}/>
            <span style={{ minWidth:0 }}>
              <span style={{ display:"block", fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{o.label}</span>
              <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, marginTop:3, lineHeight:1.5 }}>{o.desc}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
  const rotulo = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"2px 0 9px" };

  return (
    <Panel T={T} title="Si no hay stock en la renovación"
      sub="Hoy se cobra igual. Cambialo si preferís no cobrar algo que no podés mandar."
      right={sucio ? <DSBadge T={T} color={T.yellow} size="sm">Sin guardar</DSBadge> : null}>
      {source === "store" ? (
        <>
          <Opciones list={STOCK_ON_MISSING} value={onMissing} set={setOnMissing} name="stock-missing"/>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:12, lineHeight:1.55 }}>
            Miramos el stock unas horas antes de cada renovación, así la que no se puede mandar no se cobra.
          </div>
        </>
      ) : (
        <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.55 }}>
          No miramos stock: todas las renovaciones se cobran y se despachan.
        </div>
      )}

      {/* De dónde se lee es una decisión de una sola vez: va abajo y chica. */}
      <div style={{ marginTop:18, paddingTop:14, borderTop:`1px solid ${T.borderL}` }}>
        <div style={rotulo}>De dónde sale el stock</div>
        <Opciones list={STOCK_SOURCES} value={source} set={setSource} name="stock-source"/>
      </div>

      {isOwner && (
        <div style={{ marginTop:16 }}>
          <Btn T={T} variant="primary" onClick={guardar} disabled={busy || !sucio}>{busy ? <><Spinner size={12} color={T.accent}/> Guardando…</> : "Guardar"}</Btn>
        </div>
      )}
    </Panel>
  );
}
