// Admin → Puesta en marcha: el "conector" (28-sept-2026, Thiago: "un conector donde
// paso los links tipo mensaje: entrá acá, dame este acceso, conectá Mercado Pago…").
//
// Elegís un comercio y sale su checklist con, para cada paso, el mensaje EXACTO para
// mandarle por WhatsApp (con el link del panel ya puesto), qué tenés que hacer vos y el
// tilde. Los pasos y los textos salen de shared/platform/setup.js (los mismos de la
// ficha), y abajo queda el manual con el snippet y la plantilla del checkout.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, Callout, Loading, InputStyle, CellStack, toast } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { copyText, fmtAgo } from "./_shared.jsx";
import { pedidoDeAccesos, mensajePaso, SETUP_STEP_LINK } from "../../shared/platform/setup.js";
import { CopyRow } from "./ShopifyConnect.jsx";
import { MONO } from "./_shared.jsx";
import { themeSnippet, pageCheckoutLiquid } from "../../shared/platform/storeCheckout.js";
import { RECETAS, RECETA_VACIA, recetaPorId, normalizeReceta, resumenReceta } from "../../shared/platform/recetas.js";

const F = "'Inter',system-ui,sans-serif";
const BASE = "https://www.recurrentesapp.com";
const waTo = (url, text) => url ? `${url.split("?")[0]}?text=${encodeURIComponent(text)}` : null;

export default function AdminOnboarding({ rows = [], initialId = "", onOpenMerchant, onRefresh }) {
  const [verLiquid, setVerLiquid] = useState(false);
  const [nuevo, setNuevo] = useState(false);
  const [nf, setNf] = useState({ nombre: "", email: "", whatsapp: "", store_name: "", plataforma: "shopify" });
  const [pwLink, setPwLink] = useState(null);   // link de contraseña generado para ESTE comercio
  async function crearComercio() {
    if (!nf.email.trim() || !nf.nombre.trim()) return toast("Nombre y email, como mínimo.", "error");
    setBusy("crear");
    const r = await apiPost("stats", nf, { action: "admin-create-account" });
    setBusy("");
    if (!r || r.error) return toast(r?.error || "No se pudo crear la cuenta", "error", 7000);
    toast(r.reused ? "Ya tenía cuenta: se reusó y se le mandó el link." : (r.mail?.ok ? "Cuenta creada y link enviado por mail." : "Cuenta creada. El mail no salió: mandale el link por WhatsApp desde el paso 2."), r.mail?.ok ? "success" : "warning", 7000);
    setPwLink(r.link || null); setNuevo(false); setMid(r.merchant_id); onRefresh?.();
  }
  async function generarLink(send) {
    setBusy("pwlink");
    const r = await apiPost("stats", { merchant_id: mid, send: !!send }, { action: "admin-password-link" });
    setBusy("");
    if (!r || r.error) return toast(r?.error || "No se pudo generar el link", "error");
    setPwLink(r.link); toast(send ? (r.mail?.ok ? "Link nuevo generado y mail enviado." : "Link generado; el mail no salió.") : "Link nuevo generado: ya está en el mensaje.", "success");
  }
  const T = useT();
  const iS = InputStyle(T);
  const [q, setQ] = useState("");
  const [mid, setMid] = useState(initialId || "");
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [abierto, setAbierto] = useState(null);

  useEffect(() => { if (initialId) setMid(initialId); }, [initialId]);

  const opciones = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows.filter(r => !t || `${r.name || ""} ${r.shop || ""} ${r.owner_name || ""} ${r.email || ""} ${r.id}`.toLowerCase().includes(t)).slice(0, 10);
  }, [rows, q]);

  const load = useCallback(async () => {
    if (!mid) { setD(null); return; }
    setD(null); setErr("");
    const r = await apiGet("stats", { action: "admin-merchant", id: mid });
    if (!r || r.error) { setErr(r?.error || "No pudimos cargar el comercio."); return; }
    setD(r);
  }, [mid]);
  useEffect(() => { load(); setPwLink(null); }, [load]);

  async function toggle(step, done) {
    setBusy(step);
    const r = await apiPost("stats", { merchant_id: mid, step, done }, { action: "admin-setup-step" });
    setBusy("");
    if (!r || r.error) return toast(r?.error || "No se pudo guardar", "error");
    await load();
  }

  const m = d?.merchant;
  const setup = d?.setup;
  const nombre = m?.owner_name || "";
  const pct = setup?.total ? Math.round((setup.done / setup.total) * 100) : 0;
  const siguiente = setup?.steps.find(s => !s.done && !s.opcional);
  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"0 0 6px" };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:16, fontFamily:F }}>
      <Panel T={T} title="Conectar una tienda" sub="Elegí el comercio: sale su checklist con el mensaje exacto para mandarle en cada paso, con el link ya puesto.">
        <div style={{ padding:"0 16px 16px" }}>
          <div style={label}>Comercio</div>
          <input value={q} onChange={e => setQ(e.target.value)} style={{ ...iS, fontSize:DS.font.md }} placeholder="Buscar por tienda, dueño, mail o ID…"/>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
            {opciones.map(r => (
              <Btn key={r.id} T={T} size="sm" variant={r.id === mid ? "solid" : "secondary"} onClick={() => setMid(r.id === mid ? "" : r.id)}>
                {r.name || r.shop || r.email || r.id}
              </Btn>
            ))}
            <Btn T={T} size="sm" variant={nuevo ? "solid" : "secondary"} onClick={() => setNuevo(v => !v)}>+ Comercio nuevo</Btn>
            {!opciones.length && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Sin resultados: crealo con "+ Comercio nuevo".</span>}
          </div>
          {nuevo && (
            <div style={{ marginTop:12, padding:12, border:`1px solid ${T.border}`, borderRadius:12, background:T.bg, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))", gap:8 }}>
              <input value={nf.nombre} onChange={e => setNf(f => ({ ...f, nombre: e.target.value }))} placeholder="Nombre y apellido" style={iS}/>
              <input value={nf.email} onChange={e => setNf(f => ({ ...f, email: e.target.value }))} placeholder="Email (será su usuario)" style={iS} inputMode="email"/>
              <input value={nf.whatsapp} onChange={e => setNf(f => ({ ...f, whatsapp: e.target.value }))} placeholder="WhatsApp (+54 9 11…)" style={iS} inputMode="tel"/>
              <input value={nf.store_name} onChange={e => setNf(f => ({ ...f, store_name: e.target.value }))} placeholder="Nombre de la tienda" style={iS}/>
              <select value={nf.plataforma} onChange={e => setNf(f => ({ ...f, plataforma: e.target.value }))} style={iS}>
                {[["shopify","Shopify"],["tiendanube","Tiendanube"],["vtex","VTEX"],["woocommerce","WooCommerce"],["prestashop","PrestaShop"],["propio","Desarrollo propio"],["otra","Otra"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <Btn T={T} variant="solid" size="sm" disabled={busy === "crear"} onClick={crearComercio}>{busy === "crear" ? "Creando…" : "Crear cuenta y mandar el acceso"}</Btn>
              </div>
              <div style={{ gridColumn:"1 / -1", fontSize:DS.font.xs, color:T.textSm, lineHeight:1.5 }}>Se crea la cuenta sin contraseña y le llega el link para ponerla: ese link es su registro. Vos no la ves nunca; para configurarle la tienda usás "Ver como".</div>
            </div>
          )}
        </div>
      </Panel>

      {mid && err && <Callout T={T} tone="danger">{err}</Callout>}
      {mid && !err && !d && <Loading T={T}/>}

      {m && setup && (
        <Panel T={T} title={`${m.name} · ${setup.done} de ${setup.total} pasos`}
          sub={siguiente ? `Siguiente: ${siguiente.title}` : "Puesta en marcha completa."}
          right={<div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn T={T} variant="secondary" size="sm" onClick={() => onOpenMerchant?.(m.id)}>Ver ficha</Btn>
            <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(pedidoDeAccesos(setup, { nombre }), "Pedido completo copiado")}>Copiar todo lo que falta</Btn>
            {m.whatsapp_url && <a href={waTo(m.whatsapp_url, pedidoDeAccesos(setup, { nombre }))} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}><Btn T={T} variant="solid" size="sm">Mandar todo por WhatsApp</Btn></a>}
          </div>}>
          <div style={{ padding:"0 16px 16px" }}>
            <div style={{ height:8, borderRadius:99, background:T.surface, overflow:"hidden", marginBottom:14 }}>
              <div style={{ height:"100%", width:`${pct}%`, background: pct >= 100 ? T.green : T.accentSolid, transition:"width .3s" }}/>
            </div>
            {setup.faltan_scopes?.length > 0 && (
              <Callout T={T} tone="warning" style={{ marginBottom:12 }}>Le faltan permisos en Shopify: <strong>{setup.faltan_scopes.join(", ")}</strong>. Reconectar con la lista completa.</Callout>
            )}
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {setup.steps.map((st, i) => {
                const open = abierto ? abierto === st.id : (siguiente && siguiente.id === st.id);
                const msg = mensajePaso(st, { nombre, baseUrl: BASE, link: st.id === "acceso" ? pwLink : null });
                const link = SETUP_STEP_LINK[st.id] ? BASE + SETUP_STEP_LINK[st.id] : null;
                return (
                  <div key={st.id} style={{ background:T.bg, border:`1px solid ${st.done ? T.green + "55" : open ? T.accentSolid + "66" : T.borderL}`, borderRadius:12, padding:"10px 12px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <button type="button" aria-label={st.done ? "Destildar" : "Tildar"} disabled={busy === st.id} onClick={() => toggle(st.id, !st.done)}
                        style={{ width:22, height:22, borderRadius:7, flexShrink:0, cursor:"pointer", padding:0, border:`1.5px solid ${st.done ? T.green : T.border}`, background: st.done ? T.green : "transparent", color:"#fff", fontSize:13, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        {st.done ? "✓" : ""}
                      </button>
                      <button type="button" onClick={() => setAbierto(open ? "-" : st.id)} style={{ flex:1, minWidth:0, textAlign:"left", background:"none", border:"none", padding:0, cursor:"pointer", fontFamily:F }}>
                        <CellStack T={T} main={<span style={{ color: st.done ? T.textSm : T.text, textDecoration: st.done ? "line-through" : "none" }}>{i + 1}. {st.title}{st.opcional ? " · opcional" : ""}</span>} sub={st.done ? "Listo" : (st.mensaje ? "Depende del cliente" : "Lo hacés vos")}/>
                      </button>
                      {!st.done && st.mensaje && <DSBadge T={T} color={T.yellow} size="sm">Pedir</DSBadge>}
                      {!st.done && !st.mensaje && !st.manual && <DSBadge T={T} color={T.blue} size="sm">Tuyo</DSBadge>}
                    </div>
                    {open && (
                      <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${T.borderL}`, display:"grid", gap:10 }}>
                        {msg && (
                          <div>
                            <div style={label}>Mensaje para el cliente</div>
                            {st.id === "acceso" && !pwLink && <div style={{ fontSize:DS.font.xs, color:T.yellow, marginBottom:6 }}>Tocá "Generar link de contraseña" para que el mensaje lleve el link real (el de abajo es el login genérico).</div>}
                            <pre style={{ margin:0, whiteSpace:"pre-wrap", fontFamily:F, fontSize:DS.font.md, lineHeight:1.5, color:T.text, background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>{msg}</pre>
                            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
                              <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(msg, "Mensaje copiado")}>Copiar mensaje</Btn>
                              {m.whatsapp_url && <a href={waTo(m.whatsapp_url, msg)} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}><Btn T={T} variant="solid" size="sm">Mandar por WhatsApp</Btn></a>}
                              {link && st.id !== "acceso" && <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(link, "Link copiado")}>Copiar solo el link</Btn>}
                              {st.id === "acceso" && <>
                                <Btn T={T} variant="secondary" size="sm" disabled={busy === "pwlink"} onClick={() => generarLink(false)}>{pwLink ? "Generar otro link" : "Generar link de contraseña"}</Btn>
                                <Btn T={T} variant="secondary" size="sm" disabled={busy === "pwlink"} onClick={() => generarLink(true)}>Reenviar por mail</Btn>
                              </>}
                            </div>
                          </div>
                        )}
                        {st.hace && <div style={{ fontSize:DS.font.sm, color:T.textMd, lineHeight:1.5 }}><strong style={{ color:T.text }}>Vos:</strong> {st.hace}</div>}
                        {/* Lo que hay que pegar, con el id de ESTE comercio: el snippet del tema y la
                            plantilla del checkout en su dominio (shared/platform/storeCheckout.js). */}
                        {st.id === "tienda" && (
                          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                            <Btn T={T} variant="secondary" size="sm" disabled={busy === "applink"} onClick={async () => {
                              setBusy("applink");
                              const r = await apiPost("stats", { merchant_id: m.id }, { action: "admin-app-link" });
                              setBusy("");
                              if (!r || r.error) return toast(r?.error || "No se pudo generar", "error");
                              copyText(r.url, "Link de la app copiado: va como App URL en su app de Shopify");
                            }}>Copiar link de la app (App URL, login único)</Btn>
                            <span style={{ fontSize:DS.font.xs, color:T.textSm }}>Se pega como App URL en su app privada de Shopify: desde su admin de Shopify entran ya logueados.</span>
                          </div>
                        )}
                        {st.id === "widget" && (
                          <div style={{ display:"grid", gap:8 }}>
                            <div style={label}>Snippet para el tema (layout/theme.liquid, arriba de &lt;/body&gt;)</div>
                            <CopyRow T={T} text={themeSnippet(m.id)}/>
                            <div style={label}>Checkout en su dominio (opcional): página /pages/checkout-suscripcion</div>
                            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                              <CopyRow T={T} text={pageCheckoutLiquid(m.id)} label="Copiar la plantilla"/>
                              <Btn T={T} variant="secondary" size="sm" onClick={() => setVerLiquid(v => !v)}>{verLiquid ? "Ocultar plantilla" : "Ver plantilla"}</Btn>
                            </div>
                            {verLiquid && <pre style={{ fontFamily:MONO, fontSize:11, lineHeight:1.5, color:T.textMd, background:T.bg, border:`1px solid ${T.border}`, borderRadius:10, padding:12, overflow:"auto", maxHeight:320, margin:0 }}>{pageCheckoutLiquid(m.id)}</pre>}
                          </div>
                        )}
                        {!msg && st.pide && <div style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.5 }}>{st.pide}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize:DS.font.xs, color:T.textSm, marginTop:10 }}>Los pasos con datos reales se tildan solos (tienda, Mercado Pago, plan, widget, primer cobro). El pago de la instalación se tilda a mano. Última actividad: {m.last_activity_at ? fmtAgo(m.last_activity_at) : "—"}.</div>
          </div>
        </Panel>
      )}

      {m && <Configurador T={T} m={m} onDone={load}/>}

    </div>
  );
}

// ─── Configurador de la tienda (7-oct-2026, Thiago: "un configurador de G4U en el admin,
// las variables, los productos, todo lo más automatizado posible") ─────────────────
// Elegís la receta (o armás una), marcás los productos del catálogo real y aplicás: se
// crean los planes que falten (apagados), se actualizan los que ya estaban y quedan los
// ajustes del widget y del checkout. Lo que sigue siendo a mano queda listado abajo.
function Configurador({ T, m, onDone }) {
  const iS = InputStyle(T);
  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"0 0 6px" };
  const guess = useMemo(() => RECETAS.find(r => (m.shop || "").includes(r.tienda) || (m.name || "").toLowerCase().includes(r.id)) || null, [m]);
  const [recetaId, setRecetaId] = useState(guess ? guess.id : "");
  const [r, setR] = useState(() => ({ ...(guess || RECETA_VACIA), packsTxt: (guess || RECETA_VACIA).packs.map(k => k.qty).join(", "), foTxt: (guess || RECETA_VACIA).frequency_options.join(", ") }));
  const [prods, setProds] = useState(null);
  const [busy, setBusy] = useState("");
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => { setRes(null); setErr(""); setProds(null); }, [m.id]);
  function elegirReceta(id) {
    setRecetaId(id);
    const base = recetaPorId(id) || RECETA_VACIA;
    setR({ ...base, packsTxt: base.packs.map(k => k.qty).join(", "), foTxt: base.frequency_options.join(", ") });
  }
  const recetaActual = () => {
    const qtys = String(r.packsTxt || "").split(/[,\s]+/).map(x => parseInt(x, 10)).filter(n => n >= 1);
    const packs = qtys.map((q, i) => ({ qty: q, badge: i === qtys.length - 1 && qtys.length > 1 ? (r.badge_ultimo ?? "Más elegido") : "", default: i === qtys.length - 1 }));
    return { ...r, packs, frequency_options: r.foTxt };
  };
  async function cargarProductos() {
    setBusy("prods"); setErr("");
    const d = await apiPost("stats", { merchant_id: m.id }, { action: "admin-store-products" });
    setBusy("");
    if (!d || d.error) return setErr(d?.error || "No pude leer el catálogo.");
    setProds(d.products || []);
    // Sin receta: arrancan marcados los productos con precio (menos los packs/combos por nombre).
    if (!r.productos.length) setR(x => ({ ...x, productos: (d.products || []).filter(p => !/pack|combo/i.test(p.title || "") && Number(p.variants?.[0]?.price) > 0).map(p => p.handle) }));
  }
  function toggleProd(handle) { setR(x => ({ ...x, productos: x.productos.includes(handle) ? x.productos.filter(h => h !== handle) : [...x.productos, handle] })); }
  async function aplicar() {
    const nr = normalizeReceta(recetaActual());
    if (nr.error) return toast(nr.error, "error");
    setBusy("apply"); setErr(""); setRes(null);
    const d = await apiPost("stats", { merchant_id: m.id, receta: nr.receta }, { action: "admin-apply-recipe" });
    setBusy("");
    if (!d || d.error) return setErr(d?.error || "No se pudo aplicar.");
    setRes(d); onDone?.();
    toast(`${d.creados.length} plan${d.creados.length === 1 ? "" : "es"} creado${d.creados.length === 1 ? "" : "s"} · ${d.actualizados.length} actualizado${d.actualizados.length === 1 ? "" : "s"}`, d.errores.length ? "warning" : "success", 8000);
  }
  const resumen = (() => { const nr = normalizeReceta(recetaActual()); return nr.error ? [nr.error] : resumenReceta(nr.receta, prods || []); })();
  // Lo que devuelve admin-merchant: fechas de conexión (los tokens nunca viajan al panel).
  const listo = !!(m.shopify_connected_at || m.shop) && !!m.mp_connected_at;
  return (
    <Panel T={T} title="Configurador de la tienda" sub="Receta → productos → aplicar. Crea los planes (apagados) y deja el widget y el checkout configurados; lo que sigue a mano queda listado abajo.">
      <div style={{ padding:"0 16px 16px", display:"grid", gap:14 }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
          <div><div style={label}>Receta</div>
            <select value={recetaId} onChange={e => elegirReceta(e.target.value)} style={iS}>
              <option value="">A medida</option>
              {RECETAS.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select></div>
          <div><div style={label}>Packs (unidades, separadas por coma)</div><input value={r.packsTxt} onChange={e => setR(x => ({ ...x, packsTxt: e.target.value }))} style={iS} placeholder="1, 4, 8"/></div>
          <div><div style={label}>Descuento en cada envío (%)</div><input type="number" min="0" max="80" value={r.discount_pct} onChange={e => setR(x => ({ ...x, discount_pct: e.target.value }))} style={iS}/></div>
          <div><div style={label}>Frecuencia base (días)</div><input type="number" min="1" max="365" value={r.frequency_days} onChange={e => setR(x => ({ ...x, frequency_days: e.target.value }))} style={iS}/></div>
          <div><div style={label}>Frecuencias que elige el cliente (días)</div><input value={r.foTxt} onChange={e => setR(x => ({ ...x, foTxt: e.target.value }))} style={iS} placeholder="Vacío = la del pack · ej.: 15, 30, 60"/></div>
          <div><div style={label}>Color del widget y del checkout</div><input value={r.widget?.color || ""} onChange={e => setR(x => ({ ...x, widget: { ...x.widget, color: e.target.value }, checkout: { ...x.checkout, color: e.target.value } }))} style={iS} placeholder="#500322"/></div>
          <div><div style={label}>La ficha arranca en</div>
            <select value={r.widget?.mode_default || "sub"} onChange={e => setR(x => ({ ...x, widget: { ...x.widget, mode_default: e.target.value } }))} style={iS}>
              <option value="sub">Suscripción</option><option value="once">Compra única (la suscripción se abre con el botón / ?rec_modo=sub)</option>
            </select></div>
        </div>
        <div style={{ background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:12, padding:"10px 12px", display:"grid", gap:10 }}>
          <div style={label}>Comunicación con sus clientes (queda lista al aplicar)</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:10 }}>
            <div><div style={label}>Mail de atención (responder a)</div><input value={r.comunicacion?.reply_to || ""} onChange={e => setR(x => ({ ...x, comunicacion: { ...x.comunicacion, reply_to: e.target.value } }))} style={iS} placeholder="hola@latienda.com"/></div>
            <div><div style={label}>Marca en los mails</div><input value={r.comunicacion?.brand || ""} onChange={e => setR(x => ({ ...x, comunicacion: { ...x.comunicacion, brand: e.target.value } }))} style={iS} placeholder="G4U"/></div>
            <div><div style={label}>"Próximo cobro": días antes</div><input type="number" min="1" max="14" value={r.comunicacion?.upcoming_days_before ?? 3} onChange={e => setR(x => ({ ...x, comunicacion: { ...x.comunicacion, upcoming_days_before: e.target.value } }))} style={iS}/></div>
          </div>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:DS.font.sm }}>
            {[["upcoming_charge","Mail de próximo cobro"],["checkout_started","Recupero de carrito"],["activated","Bienvenida a los 3 días"],["payment_failed","Pago rechazado (seguimiento)"],["cancelled","Win-back"]].map(([id, lbl]) => (
              <label key={id} style={{ display:"flex", gap:6, alignItems:"center", cursor:"pointer" }}><input type="checkbox" checked={(r.comunicacion?.flujos || []).includes(id)} onChange={e => setR(x => { const f = new Set(x.comunicacion?.flujos || []); e.target.checked ? f.add(id) : f.delete(id); return { ...x, comunicacion: { ...x.comunicacion, flujos: [...f] } }; })}/> {lbl}</label>
            ))}
          </div>
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:DS.font.sm, alignItems:"center" }}>
            <label style={{ display:"flex", gap:6, alignItems:"center", cursor:"pointer", fontWeight:700 }}><input type="checkbox" checked={r.comunicacion?.whatsapp === true} onChange={e => setR(x => ({ ...x, comunicacion: { ...x.comunicacion, whatsapp: e.target.checked } }))}/> WhatsApp desde el número de Recurrentes (la tienda confirmó que sus clientes aceptan avisos)</label>
            {r.comunicacion?.whatsapp && [["aviso_proximo_cobro","Próximo cobro"],["carrito_sin_pagar","Carrito sin pagar"],["sin_stock","Sin stock"],["pago_rechazado","Pago rechazado"],["suscripcion_activa","Suscripción activa"],["renovacion_cobrada","Renovación cobrada"],["pedido_modificado","Pedido modificado"]].map(([id, lbl]) => (
              <label key={id} style={{ display:"flex", gap:6, alignItems:"center", cursor:"pointer" }}><input type="checkbox" checked={(r.comunicacion?.wa_templates || []).includes(id)} onChange={e => setR(x => { const f = new Set(x.comunicacion?.wa_templates || []); e.target.checked ? f.add(id) : f.delete(id); return { ...x, comunicacion: { ...x.comunicacion, wa_templates: [...f] } }; })}/> {lbl}</label>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", gap:16, flexWrap:"wrap", fontSize:DS.font.sm }}>
          <label style={{ display:"flex", gap:8, alignItems:"center", cursor:"pointer" }}><input type="checkbox" checked={r.mix === true} onChange={e => setR(x => ({ ...x, mix: e.target.checked }))}/> Armá tu pack: mezclar los productos elegidos</label>
          <label style={{ display:"flex", gap:8, alignItems:"center", cursor:"pointer" }}><input type="checkbox" checked={r.widget?.cart_drawer !== false} onChange={e => setR(x => ({ ...x, widget: { ...x.widget, cart_drawer: e.target.checked } }))}/> Carrito de la suscripción</label>
          <label style={{ display:"flex", gap:8, alignItems:"center", cursor:"pointer" }}><input type="checkbox" checked={r.upsells !== false} onChange={e => setR(x => ({ ...x, upsells: e.target.checked }))}/> "Sumá a tu suscripción" con los otros planes</label>
        </div>
        <div>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
            <div style={{ ...label, margin:0 }}>Productos ({r.productos.length} elegidos)</div>
            <Btn T={T} size="sm" variant="secondary" disabled={busy === "prods"} onClick={cargarProductos}>{busy === "prods" ? "Leyendo…" : prods ? "Volver a leer el catálogo" : "Leer el catálogo de la tienda"}</Btn>
          </div>
          {prods ? (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:6 }}>
              {prods.map(p => (
                <label key={p.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 8px", border:`1px solid ${r.productos.includes(p.handle) ? T.accentSolid + "88" : T.borderL}`, borderRadius:10, background:T.bg, cursor:"pointer", fontSize:DS.font.sm }}>
                  <input type="checkbox" checked={r.productos.includes(p.handle)} onChange={() => toggleProd(p.handle)}/>
                  {p.image ? <img src={p.image} alt="" style={{ width:28, height:28, borderRadius:6, objectFit:"cover" }}/> : null}
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={p.title}>{p.title}</span>
                  <span style={{ color:T.textSm, whiteSpace:"nowrap" }}>{Number(p.variants?.[0]?.price) ? `$${Number(p.variants[0].price).toLocaleString("es-AR")}` : "sin precio"}</span>
                </label>
              ))}
            </div>
          ) : <div style={{ fontSize:DS.font.sm, color:T.textSm }}>{r.productos.length ? `La receta trae ${r.productos.length} productos (por handle). Leé el catálogo para verlos con precio y marcar o desmarcar.` : "Leé el catálogo para elegir los productos."}</div>}
        </div>
        <div style={{ background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:12, padding:"10px 12px", fontSize:DS.font.sm, lineHeight:1.6 }}>
          <div style={label}>Lo que va a hacer</div>
          {resumen.map((s, i) => <div key={i}>· {s}</div>)}
        </div>
        {!listo && <Callout T={T} tone="warning">Para aplicar hacen falta Shopify y Mercado Pago conectados (los planes se crean en la cuenta de MP de la tienda).</Callout>}
        {err && <Callout T={T} tone="danger">{err}</Callout>}
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <Btn T={T} variant="solid" disabled={busy === "apply" || !listo} onClick={aplicar}>{busy === "apply" ? "Aplicando…" : "Aplicar receta"}</Btn>
          <span style={{ fontSize:DS.font.xs, color:T.textSm }}>Los planes nacen apagados: se activan desde Planes cuando el widget esté pegado. No toca suscripciones.</span>
        </div>
        {res && (
          <div style={{ background:T.bg, border:`1px solid ${T.green}55`, borderRadius:12, padding:"10px 12px", fontSize:DS.font.sm, lineHeight:1.6 }}>
            <div style={label}>Resultado</div>
            {res.creados.map(p => <div key={p.id}>✓ Creado: {p.producto}</div>)}
            {res.actualizados.map(p => <div key={p.id}>↻ Actualizado: {p.producto}{p.active ? " (activo)" : ""}</div>)}
            {res.errores.map((e, i) => <div key={i} style={{ color:T.red }}>✕ {e.producto}: {e.error}</div>)}
            {res.faltan?.length ? <div style={{ color:T.yellow }}>No están en la tienda: {res.faltan.join(", ")}</div> : null}
            {res.settings?.length ? <div>Ajustes guardados: {res.settings.join(", ")}</div> : null}
            {res.comunicacion?.flujos?.map(f => <div key={f.trigger}>{f.error ? "✕" : "✓"} Flujo {f.trigger}{f.ya ? " (ya estaba)" : f.active === false ? " (creado APAGADO: falta el mail de atención)" : ""}{f.error ? `: ${f.error}` : ""}</div>)}
            {res.comunicacion?.whatsapp ? <div>{res.comunicacion.whatsapp === "prendido" ? "✓ WhatsApp prendido" : "✕ WhatsApp no disponible"}{res.comunicacion.wa?.length ? ` · plantillas: ${res.comunicacion.wa.map(w => w.name + (w.ya ? " (ya)" : w.error ? " ✕" : "")).join(", ")}` : ""}</div> : null}
          </div>
        )}
        {(recetaPorId(recetaId)?.pendientes || []).length ? (
          <div style={{ fontSize:DS.font.sm, color:T.textMd, lineHeight:1.6 }}>
            <div style={label}>Queda a mano</div>
            {recetaPorId(recetaId).pendientes.map((s, i) => <div key={i}>· {s}</div>)}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
