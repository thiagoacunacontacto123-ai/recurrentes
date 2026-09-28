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

    </div>
  );
}
