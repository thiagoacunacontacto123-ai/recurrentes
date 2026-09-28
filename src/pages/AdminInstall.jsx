// Admin → Instalación: el manual y lo que hay que pegar, ya armado.
//
// Existe para no volver a preguntar "¿cuál era el liquid?" y para que el paso a
// paso quede en un lugar fijo en vez de en un chat (27-sept-2026, Thiago).
// Elegís el comercio de la lista y salen su snippet y su plantilla con el id
// puesto; los textos salen de shared/platform/storeCheckout.js, que es también
// de donde sale docs/page-checkout.liquid.
import React, { useMemo, useState } from "react";
import { DS, useT } from "../ui/theme.js";
import { Btn, InputStyle } from "../ui/components.jsx";
import { Panel } from "../ui/charts.jsx";
import { CopyRow } from "./ShopifyConnect.jsx";
import { MONO } from "./_shared.jsx";
import { INSTALL_STEPS, themeSnippet, pageCheckoutLiquid } from "../../shared/platform/storeCheckout.js";

export default function AdminInstall({ rows = [] }) {
  const T = useT();
  const iS = InputStyle(T);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [mid, setMid] = useState("");

  // La lista que ya trajo el Admin: no hace falta pedir nada nuevo.
  const opciones = useMemo(() => {
    const t = q.trim().toLowerCase();
    return rows
      .filter(r => !t || `${r.name || ""} ${r.shop || ""} ${r.email || ""} ${r.id}`.toLowerCase().includes(t))
      .slice(0, 8);
  }, [rows, q]);

  const elegido = rows.find(r => r.id === mid);
  const id = mid || "MERCHANT_ID";
  const nombre = elegido ? (elegido.name || elegido.shop || elegido.email || elegido.id) : null;

  const label = { fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.6, margin:"14px 0 6px" };

  return (
    <Panel T={T} title="Instalación de una tienda"
      sub="El paso a paso y lo que hay que pegar, con el id del comercio ya puesto."
      style={{ marginBottom:16 }}
      right={<Btn T={T} variant="secondary" size="sm" onClick={() => setAbierto(v => !v)}>{abierto ? "Ocultar ▴" : "Abrir manual ▾"}</Btn>}>
      {!abierto ? (
        <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.55 }}>
          Seis pasos: cuenta y tienda · Mercado Pago por OAuth · un plan activo · el widget en el tema ·
          la página de checkout en su dominio (opcional) · probarlo de punta a punta.
        </div>
      ) : (
        <>
          <div style={label}>Para qué comercio</div>
          <input value={q} onChange={e => setQ(e.target.value)} style={{ ...iS, fontSize:DS.font.md }} placeholder="Buscar por nombre, tienda o mail…"/>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:8 }}>
            {opciones.map(r => (
              <Btn key={r.id} T={T} size="sm" variant={r.id === mid ? "solid" : "secondary"} onClick={() => setMid(r.id === mid ? "" : r.id)}>
                {r.name || r.shop || r.email || r.id}
              </Btn>
            ))}
            {!opciones.length && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>Sin resultados. Sin elegir ninguno, sale con <code style={{ fontFamily:MONO }}>MERCHANT_ID</code> para reemplazar a mano.</span>}
          </div>
          <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:8 }}>
            {nombre ? <>Armado para <b style={{ color:T.text }}>{nombre}</b> · <code style={{ fontFamily:MONO }}>{id}</code></> : <>Todavía sin comercio elegido.</>}
          </div>

          <ol style={{ margin:"18px 0 0", padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:14 }}>
            {INSTALL_STEPS.map(p => (
              <li key={p.id} style={{ border:`1px solid ${T.border}`, borderRadius:12, padding:"12px 14px", background:T.surface }}>
                <div style={{ fontSize:DS.font.base, fontWeight:800, color:T.text }}>{p.title}</div>
                <ul style={{ margin:"6px 0 0", paddingLeft:18, display:"flex", flexDirection:"column", gap:4, fontSize:DS.font.md, color:T.textMd, lineHeight:1.5 }}>
                  {p.body.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
                <div style={{ fontSize:DS.font.sm, color:T.green, marginTop:8 }}>✓ {p.check}</div>
                {p.id === "snippet" && <div style={{ marginTop:10 }}><CopyRow T={T} text={themeSnippet(id)}/></div>}
                {p.id === "pagina" && (
                  <div style={{ marginTop:10 }}>
                    <CopyRow T={T} text={pageCheckoutLiquid(id)} label="Copiar la plantilla"/>
                    <details style={{ marginTop:8 }}>
                      <summary style={{ cursor:"pointer", fontSize:DS.font.sm, color:T.textSm }}>Ver la plantilla entera</summary>
                      <pre style={{ fontFamily:MONO, fontSize:11, lineHeight:1.5, color:T.textMd, background:T.bg, border:`1px solid ${T.border}`, borderRadius:10, padding:12, overflow:"auto", maxHeight:320, marginTop:8 }}>{pageCheckoutLiquid(id)}</pre>
                    </details>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Panel>
  );
}
