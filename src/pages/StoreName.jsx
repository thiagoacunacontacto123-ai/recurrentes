import React, { useState } from "react";
import ReactDOM from "react-dom";
import { apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, Field, InputStyle, Hint, Spinner } from "../ui/components.jsx";

// "¿Cómo se llama tu tienda?" (Thiago, 19-sept-2026): aparece una vez, apenas entra una
// cuenta nueva. Si lo cierra o toca afuera, la tienda queda como "Mi tienda" y no se
// vuelve a preguntar (la puede renombrar en Configuración → Tiendas, foto incluida).
const KEY = (mid) => `rec_store_named_${mid}`;
export const storeNameAsked = (mid) => { try { return localStorage.getItem(KEY(mid)) === "1"; } catch (_) { return false; } };
export const markStoreNameAsked = (mid) => { try { localStorage.setItem(KEY(mid), "1"); } catch (_) {} };

export function StoreNameModal({ T, merchant, onSaved, onClose }) {
  const iS = InputStyle(T);
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const close = () => { markStoreNameAsked(merchant.id); onClose?.(); };

  async function save() {
    const n = name.trim().replace(/\s+/g, " ").slice(0, 60);
    if (n.length < 2) return setErr("Ponele un nombre de al menos 2 letras.");
    setSaving(true); setErr("");
    const d = await apiPost("merchant", { merchant_id: merchant.id, name: n }, { action: "store-rename" }).catch(e => ({ error: e.message }));
    setSaving(false);
    if (d?.error) return setErr(d.error);
    markStoreNameAsked(merchant.id);
    onSaved?.(n);
  }

  return ReactDOM.createPortal(
    <div role="dialog" aria-modal="true" aria-label="Nombre de tu tienda" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      style={{ position:"fixed", inset:0, zIndex:2000, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(0,0,0,0.6)", backdropFilter:"blur(4px)", padding:16 }}>
      <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:16, width:"100%", maxWidth:420, padding:"24px 26px", boxSizing:"border-box", fontFamily:"'Inter',system-ui,sans-serif", position:"relative" }}>
        <button type="button" onClick={close} aria-label="Cerrar" style={{ position:"absolute", top:10, right:12, background:"transparent", border:"none", color:T.textSm, fontSize:18, cursor:"pointer" }}>✕</button>
        <div style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.3 }}>¿Cómo se llama tu tienda?</div>
        <div style={{ fontSize:DS.font.md, color:T.textSm, marginTop:4, marginBottom:16, lineHeight:1.5 }}>Así la ves en el menú y en los avisos. Si la salteás queda como "Mi tienda".</div>
        <Field T={T} label="Nombre de la tienda"><input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Café Norte" maxLength={60} style={iS} autoFocus onKeyDown={e => { if (e.key === "Enter") save(); }}/></Field>
        <Hint T={T}>La foto y el color los elegís después en Configuración → Tiendas.</Hint>
        {err && <div style={{ background:T.redBg, border:`1px solid ${T.red}55`, borderRadius:8, padding:"9px 12px", fontSize:13, color:T.red, marginBottom:12, lineHeight:1.45 }}>{err}</div>}
        <div style={{ display:"flex", gap:8, marginTop:6 }}>
          <Btn T={T} variant="secondary" onClick={close} disabled={saving} style={{ flex:1, justifyContent:"center" }}>Después</Btn>
          <Btn T={T} variant="solid" onClick={save} disabled={saving} style={{ flex:2, justifyContent:"center" }}>{saving ? <><Spinner size={12}/> Guardando…</> : "Guardar"}</Btn>
        </div>
      </div>
    </div>,
    document.body
  );
}
