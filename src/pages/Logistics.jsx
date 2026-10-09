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
import { apiGet, apiPatch, apiPost } from "../lib/api.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { STOCK_SOURCES, STOCK_ON_MISSING, resolveStockPolicy, rateKey, rateLabel, rateOffered, rateOverride, subRatePrice } from "../../shared/platform/logistics.js";

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
      <PageHeader T={T} title="Envíos" subtitle="Los que ve tu cliente al suscribirse, y lo que le cobrás por cada uno. Vienen igual que en tu tienda."/>
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
  // Lo que paga el SUSCRIPTOR por cada método. Vacío = lo que cobra la tienda.
  const [subs, setSubs] = useState(m.shipping_prices && typeof m.shipping_prices === "object" ? m.shipping_prices : {});
  const [busy, setBusy] = useState("");

  useEffect(() => { setOff(Array.isArray(m.shipping_off) ? m.shipping_off : []); }, [m.shipping_off]);
  useEffect(() => { setPrecios(Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : []); }, [m.checkout_shipping_rates]);
  useEffect(() => { setSubs(m.shipping_prices && typeof m.shipping_prices === "object" ? m.shipping_prices : {}); }, [m.shipping_prices]);

  // Shopify cotiza en vivo y no guarda nada: para poder apagar un método hay
  // que mostrárselos, así que se los pedimos a la tienda al abrir la pantalla.
  const [nota, setNota] = useState("");
  const traerLive = useCallback(async () => {
    if (!isOwner) return;
    setCargando(true);
    // Shopify cotiza en vivo (no guarda nada), Tiendanube devuelve sus medios:
    // en los dos casos hay que ir a preguntarle a la tienda.
    const d = esShopify
      ? await apiGet("shopify", { action: "shipping-rates-admin" })
      : await apiPost("merchant", {}, { action: "import-shipping-rates" });
    setCargando(false);
    if (d?.error) { setNota(d.error); return; }
    setNota(d?.note || "");
    setLive(Array.isArray(d?.rates) ? d.rates : []);
    if (!esShopify && Array.isArray(d?.rates) && d.rates.length) onChange?.();
  }, [esShopify, isOwner, onChange]);
  useEffect(() => { traerLive(); }, [traerLive]);

  // Lo guardado + lo que cotiza la tienda, agrupado por SERVICIO: las apps de
  // envío devuelven una fila por sucursal cercana al CP que se consultó, y
  // apagar una sucursal suelta no sirve (el que compra de otro barrio ve otras).
  const porServicio = new Map();
  for (const r of [...guardadas, ...(live || [])]) {
    const k = rateKey(r);
    if (!k) continue;
    const prev = porServicio.get(k);
    if (prev) { prev._sucursales++; if (Number(r.price) > 0 && !Number(prev.price)) prev.price = r.price; continue; }
    porServicio.set(k, { ...r, name: rateLabel(r), _sucursales: 1, _guardada: guardadas.some(g => rateKey(g) === k) });
  }
  const lista = [...porServicio.values()];

  const apagado = (r) => !rateOffered(r, { shipping_off: off });
  const toggle = (r) => {
    const k = rateKey(r);
    setOff(prev => apagado(r) ? prev.filter(x => x !== k && x !== String(r.name || "").toLowerCase()) : [...prev, k]);
  };

  const setPrecio = (r, v) => setPrecios(ps => ps.map(p => rateKey(p) === rateKey(r) ? { ...p, price: v.replace(/\D/g, "") } : p));

  // ── Lo que paga el suscriptor por cada método ──────────────────────────────
  // Tres opciones y nada más: lo mismo que tu tienda (default), gratis, u otro
  // precio. "Gratis desde" queda como extra para el que cobra hasta cierto monto.
  const ov = (r) => rateOverride(r, { shipping_prices: subs });
  const modoDe = (r) => { const o = ov(r); if (!o) return "tienda"; if (o.price === 0 && !o.free_from) return "gratis"; return "otro"; };
  const setOv = (r, patch) => setSubs(prev => {
    const k = rateKey(r), next = { ...prev };
    if (patch == null) delete next[k]; else next[k] = { ...(next[k] || {}), ...patch };
    return next;
  });
  const setModo = (r, modo) => {
    if (modo === "tienda") return setOv(r, null);
    if (modo === "gratis") return setOv(r, { price: 0, free_from: 0 });
    setOv(r, { price: ov(r)?.price ?? Math.round(Number(r.price) || 0) });
  };
  const todosGratis = () => setSubs(Object.fromEntries(lista.map(r => [rateKey(r), { price: 0, free_from: 0 }])));

  const limpio = (o) => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, o[k]?.price ?? null, o[k]?.free_from ?? 0]));
  const sucio = JSON.stringify([...off].sort()) !== JSON.stringify([...(m.shipping_off || [])].sort())
    || JSON.stringify(precios.map(p => [p.name, String(p.price)])) !== JSON.stringify(guardadas.map(p => [p.name, String(p.price)]))
    || limpio(subs) !== limpio(m.shipping_prices);

  async function guardar() {
    setBusy("save");
    const body = { shipping_off: off, shipping_prices: Object.keys(subs).length ? subs : null };
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
      sub="Lo que ves es lo que paga el que se suscribe. Sin tocar nada, cobra lo mismo que tu tienda."
      right={<>
        {sucio && <DSBadge T={T} color={T.yellow} size="sm">Sin guardar</DSBadge>}
        {isOwner && !!lista.length && <Btn T={T} variant="secondary" size="sm" onClick={todosGratis}>Poner todos gratis</Btn>}
        {isOwner && <Btn T={T} variant="secondary" size="sm" onClick={traerLive} disabled={cargando}>{cargando ? <><Spinner size={12} color={T.textMd}/> Leyendo…</> : "Actualizar lista"}</Btn>}
      </>}>

      {cargando && !lista.length ? (
        <div style={{ display:"flex", alignItems:"center", gap:8, color:T.textSm, fontSize:DS.font.md, padding:"6px 0" }}>
          <Spinner size={14} color={T.accent}/> Leyendo los envíos de tu tienda…
        </div>
      ) : !lista.length ? (
        <Callout T={T} tone="info">
          {nota || "Tu tienda no tiene métodos de envío configurados. Cargalos en tu tienda y tocá Actualizar lista, o agregá uno acá a mano."}
          {" "}Mientras tanto la suscripción usa el envío que tenga cargado cada plan.
        </Callout>
      ) : (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {lista.map((r, i) => {
              const on = !apagado(r);
              const modo = modoDe(r);
              const tienda = Math.round(Number(r.price) || 0);
              const paga = subRatePrice(r, { shipping_prices: subs });
              const desde = ov(r)?.free_from || 0;
              return (
                <div key={rateKey(r) + i} style={{
                  padding:"12px 14px", borderRadius:DS.r.lg,
                  border:`1px solid ${on ? T.border : T.borderL}`, background: on ? T.surface : "transparent",
                  transition:"background .15s, border-color .15s",
                }}>
                  <div style={{ display:"grid", gridTemplateColumns:"22px minmax(0,1fr) auto", gap:12, alignItems:"center" }}>
                    <input type="checkbox" checked={on} disabled={!isOwner} onChange={() => toggle(r)}
                      aria-label={`Ofrecer ${r.name} en la suscripción`} style={{ accentColor:T.accentSolid, width:17, height:17, cursor: isOwner ? "pointer" : "default" }}/>
                    <span style={{ minWidth:0 }}>
                      <span style={{ display:"block", fontSize:DS.font.base, fontWeight:DS.w.bold, color: on ? T.text : T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.name}</span>
                      <span style={{ display:"flex", gap:6, alignItems:"center", marginTop:3, flexWrap:"wrap" }}>
                        {!on && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>No se ofrece en la suscripción</span>}
                        {on && r.carrier_id && <DSBadge T={T} color={T.green} size="sm">etiqueta automática</DSBadge>}
                        {on && r.pickup && <DSBadge T={T} color={T.textSm} size="sm">retiro</DSBadge>}
                        {on && r._sucursales > 1 && <DSBadge T={T} color={T.textSm} size="sm">{r._sucursales} sucursales</DSBadge>}
                      </span>
                    </span>
                    {/* Lo que paga el que se suscribe. El de la tienda va tachado al lado. */}
                    <span style={{ textAlign:"right", whiteSpace:"nowrap" }}>
                      <span style={{ display:"block", fontSize:DS.font.md, fontWeight:DS.w.bold, color: paga ? T.text : T.green, fontVariantNumeric:"tabular-nums" }}>
                        {r._guardada || tienda || modo !== "tienda" ? (paga ? fmtARS(paga) : "Gratis") : "según CP"}
                      </span>
                      {modo !== "tienda" && tienda > 0 && paga !== tienda && (
                        <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm, textDecoration:"line-through" }}>{fmtARS(tienda)} en tu tienda</span>
                      )}
                      {modo === "tienda" && (r._guardada || tienda > 0) && (
                        <span style={{ display:"block", fontSize:DS.font.sm, color:T.textSm }}>igual que tu tienda</span>
                      )}
                    </span>
                  </div>

                  {on && isOwner && (
                    <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginTop:10, paddingLeft:34 }}>
                      {[["tienda","Lo de tu tienda"],["gratis","Gratis"],["otro","Otro precio"]].map(([id, label]) => (
                        <button key={id} type="button" onClick={() => setModo(r, id)} style={{
                          border:`1px solid ${modo === id ? T.accentSolid : T.borderL}`, background: modo === id ? T.greenBg : "transparent",
                          color: modo === id ? T.accent : T.textMd, borderRadius:999, padding:"5px 12px",
                          fontSize:DS.font.sm, fontWeight:DS.w.bold, cursor:"pointer",
                        }}>{label}</button>
                      ))}
                      {modo === "otro" && (
                        <input value={ov(r)?.price ?? ""} onChange={e => setOv(r, { price: parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 })}
                          inputMode="numeric" aria-label={`Lo que cobrás por ${r.name} en la suscripción`} placeholder="0"
                          style={{ ...iS, marginBottom:0, width:100, padding:"6px 10px", textAlign:"right", fontSize:DS.font.sm }}/>
                      )}
                      {modo === "otro" && (
                        <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:DS.font.sm, color:T.textSm }}>
                          gratis desde
                          <input value={desde || ""} onChange={e => setOv(r, { free_from: parseInt(e.target.value.replace(/\D/g, ""), 10) || 0 })}
                            inputMode="numeric" aria-label={`Envío gratis de ${r.name} desde`} placeholder="sin corte"
                            style={{ ...iS, marginBottom:0, width:110, padding:"6px 10px", textAlign:"right", fontSize:DS.font.sm }}/>
                        </span>
                      )}
                      {r._guardada && (
                        <span style={{ display:"flex", alignItems:"center", gap:6, fontSize:DS.font.sm, color:T.textSm, marginLeft:"auto" }}>
                          en tu tienda
                          <input value={r.price ?? 0} onChange={e => setPrecio(r, e.target.value)} inputMode="numeric" aria-label={`Precio de ${r.name} en tu tienda`}
                            style={{ ...iS, marginBottom:0, width:100, padding:"6px 10px", textAlign:"right", fontSize:DS.font.sm }}/>
                        </span>
                      )}
                    </div>
                  )}
                </div>
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
              Esto cambia solo la <strong style={{ color:T.text }}>suscripción</strong>. Tu checkout normal sigue cobrando lo de siempre.
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
      sub={source !== "store" ? "No miramos stock: se cobra y se despacha siempre." : onMissing === "charge" ? "Hoy se cobra igual aunque no haya stock. Cambialo si preferís no cobrar algo que no podés mandar." : "Hoy, si no hay stock, esa renovación no se cobra: se pausa antes y vuelve sola cuando reponés."}
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
