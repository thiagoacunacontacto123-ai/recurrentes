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
import AdminInstall from "./AdminInstall.jsx";

const F = "'Inter',system-ui,sans-serif";
const BASE = "https://www.recurrentesapp.com";
const waTo = (url, text) => url ? `${url.split("?")[0]}?text=${encodeURIComponent(text)}` : null;

export default function AdminOnboarding({ rows = [], initialId = "", onOpenMerchant }) {
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
  useEffect(() => { load(); }, [load]);

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
            {!opciones.length && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Sin resultados. Si todavía no tiene cuenta, creala desde Registros → Pedidos de demo.</span>}
          </div>
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
                const msg = mensajePaso(st, { nombre, baseUrl: BASE });
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
                            <pre style={{ margin:0, whiteSpace:"pre-wrap", fontFamily:F, fontSize:DS.font.md, lineHeight:1.5, color:T.text, background:T.card, border:`1px solid ${T.border}`, borderRadius:10, padding:"10px 12px" }}>{msg}</pre>
                            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
                              <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(msg, "Mensaje copiado")}>Copiar mensaje</Btn>
                              {m.whatsapp_url && <a href={waTo(m.whatsapp_url, msg)} target="_blank" rel="noopener noreferrer" style={{ textDecoration:"none" }}><Btn T={T} variant="solid" size="sm">Mandar por WhatsApp</Btn></a>}
                              {link && <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(link, "Link copiado")}>Copiar solo el link</Btn>}
                            </div>
                          </div>
                        )}
                        {st.hace && <div style={{ fontSize:DS.font.sm, color:T.textMd, lineHeight:1.5 }}><strong style={{ color:T.text }}>Vos:</strong> {st.hace}</div>}
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

      <AdminInstall rows={rows} initialId={mid}/>
    </div>
  );
}
