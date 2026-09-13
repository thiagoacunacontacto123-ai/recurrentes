import React from "react";

// Editor de "Precios y packs" del plan (alta y edición). Vive fuera de
// Dashboard.jsx para no engordarlo. Contrato de datos: shared/bundle/SPEC.md.
//
// Filas editables (strings para que los inputs no peleen con el usuario):
//   { qty, price_ars, compare_at_ars, label, badge, frequency_days, sub_price_ars, default }
// serializePacks() las convierte al formato del backend.

export const PACKS_MAX = 6;

const fmt = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

export function pricingModeOf(plan) {
  if (!plan) return "theme";
  if (plan.pricing_mode === "packs" || plan.pricing_mode === "theme") return plan.pricing_mode;
  return Array.isArray(plan.packs) && plan.packs.length > 0 ? "packs" : "theme";
}

export function emptyPackRow(qty = 1) {
  return { qty: String(qty), price_ars: "", compare_at_ars: "", label: "", badge: "", frequency_days: "", sub_price_ars: "", default: false };
}

// Plan guardado → filas del editor.
export function packsFromPlan(plan) {
  const arr = Array.isArray(plan?.packs) ? plan.packs : [];
  return arr.slice(0, PACKS_MAX).map(p => ({
    qty: String(p.qty ?? 1),
    price_ars: p.price_ars != null ? String(p.price_ars) : "",
    compare_at_ars: p.compare_at_ars != null ? String(p.compare_at_ars) : "",
    label: p.label || "",
    badge: p.badge || "",
    frequency_days: p.frequency_days != null ? String(p.frequency_days) : "",
    sub_price_ars: p.sub_price_ars != null ? String(p.sub_price_ars) : "",
    default: p.default === true,
  }));
}

// 1·2·3 automáticos a partir del precio base: 0 / 15 / 25 % off por cantidad.
export function autoPacks(basePrice) {
  const b = Math.round(num(basePrice));
  const mk = (qty, off, label, badge, def) => ({
    qty: String(qty),
    price_ars: String(Math.round(b * qty * (1 - off / 100))),
    compare_at_ars: "",
    label, badge, frequency_days: "", sub_price_ars: "", default: def,
  });
  return [
    mk(1, 0, "1 unidad", "", false),
    mk(2, 15, "2 unidades", "Más elegido", true),
    mk(3, 25, "3 unidades", "Mejor precio", false),
  ];
}

// Valores derivados de una fila (los "auto" del SPEC) para el cálculo en vivo.
export function derivePack(row, ctx) {
  const { basePrice, discountPct, frequencyDays, freqScales, rows } = ctx;
  const qty = Math.max(1, int(row.qty));
  const price = num(row.price_ars);
  const unit1 = rows?.find(r => int(r.qty) === 1 && num(r.price_ars) > 0);
  const baseUnit = num(basePrice) > 0 ? num(basePrice) : (unit1 ? num(unit1.price_ars) : price / qty);
  const compareAt = num(row.compare_at_ars) > 0 ? num(row.compare_at_ars) : Math.round(baseUnit * qty);
  const subPrice = num(row.sub_price_ars) > 0 ? Math.round(num(row.sub_price_ars)) : Math.round(price * (1 - (num(discountPct) || 0) / 100));
  const freqDays = int(row.frequency_days) > 0 ? int(row.frequency_days) : (freqScales ? Math.max(1, int(frequencyDays)) * qty : Math.max(1, int(frequencyDays)));
  const savingsPct = compareAt > 0 && subPrice > 0 ? Math.max(0, Math.round((1 - subPrice / compareAt) * 100)) : 0;
  const perUnitSub = qty > 0 ? Math.round(subPrice / qty) : subPrice;
  return { qty, price, compareAt, subPrice, freqDays, savingsPct, perUnitSub };
}

// Devuelve string de error o null.
export function validatePacks(rows) {
  if (!rows.length) return "Agregá al menos un pack (o pasá a modo \"Mi tema manda el precio\").";
  if (rows.length > PACKS_MAX) return `Máximo ${PACKS_MAX} packs.`;
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const n = i + 1;
    const qty = int(r.qty);
    if (!(qty >= 1)) return `Pack ${n}: la cantidad tiene que ser 1 o más.`;
    if (seen.has(qty)) return `Pack ${n}: ya hay otro pack con cantidad ${qty}.`;
    seen.add(qty);
    const price = num(r.price_ars);
    if (!(price > 0)) return `Pack ${n}: el precio del pack tiene que ser mayor a 0.`;
    if (r.compare_at_ars !== "" && num(r.compare_at_ars) < price) return `Pack ${n}: el precio tachado no puede ser menor al precio del pack.`;
    if (r.sub_price_ars !== "" && !(num(r.sub_price_ars) > 0)) return `Pack ${n}: el precio de suscripción tiene que ser mayor a 0.`;
    if (r.frequency_days !== "" && !(int(r.frequency_days) >= 1)) return `Pack ${n}: la frecuencia tiene que ser 1 día o más.`;
  }
  return null;
}

// Filas → formato del backend (SPEC). Ordena por cantidad y garantiza un solo default.
export function serializePacks(rows) {
  const out = rows
    .filter(r => int(r.qty) >= 1 && num(r.price_ars) > 0)
    .map(r => ({
      qty: int(r.qty),
      price_ars: Math.round(num(r.price_ars)),
      compare_at_ars: r.compare_at_ars !== "" && num(r.compare_at_ars) > 0 ? Math.round(num(r.compare_at_ars)) : null,
      label: (r.label || "").trim() || `${int(r.qty)} ${int(r.qty) === 1 ? "unidad" : "unidades"}`,
      badge: (r.badge || "").trim() || null,
      frequency_days: r.frequency_days !== "" && int(r.frequency_days) >= 1 ? int(r.frequency_days) : null,
      sub_price_ars: r.sub_price_ars !== "" && num(r.sub_price_ars) > 0 ? Math.round(num(r.sub_price_ars)) : null,
      default: r.default === true,
    }))
    .sort((a, b) => a.qty - b.qty);
  if (out.length && !out.some(p => p.default)) out[0].default = true;
  let seenDefault = false;
  out.forEach(p => { if (p.default) { if (seenDefault) p.default = false; seenDefault = true; } });
  return out;
}

// ── estilos locales (CSS vars del dashboard) ─────────────────────────────
const lbl = { display:"block", fontSize:10, fontWeight:600, color:"var(--text-sm)", marginBottom:3, textTransform:"uppercase", letterSpacing:0.4 };
const inp = { width:"100%", background:"var(--card)", border:"1px solid var(--border)", color:"var(--text)", borderRadius:8, padding:"7px 9px", fontSize:12, outline:"none", fontFamily:"inherit", boxSizing:"border-box" };
const btnSm = { background:"var(--card)", border:"1px solid var(--border)", color:"var(--text-md)", borderRadius:7, padding:"5px 10px", fontSize:11, cursor:"pointer", fontFamily:"inherit", fontWeight:600 };

function ModeOption({ active, title, desc, tag, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{textAlign:"left",background:active?"rgba(16,185,129,0.08)":"var(--surface)",border:`1.5px solid ${active?"var(--green)":"var(--border)"}`,borderRadius:10,padding:"10px 12px",cursor:"pointer",fontFamily:"inherit",color:"var(--text)",display:"flex",gap:10,alignItems:"flex-start"}}>
      <span style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${active?"var(--green)":"var(--border)"}`,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
        {active && <span style={{width:8,height:8,borderRadius:"50%",background:"var(--green)"}}/>}
      </span>
      <span style={{minWidth:0}}>
        <span style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:12,fontWeight:700}}>{title}</span>
          {tag && <span style={{fontSize:9,fontWeight:700,padding:"1px 6px",borderRadius:4,background:active?"var(--green)":"var(--border)",color:active?"#fff":"var(--text-md)",textTransform:"uppercase",letterSpacing:0.4}}>{tag}</span>}
        </span>
        <span style={{display:"block",fontSize:11,color:"var(--text-sm)",lineHeight:1.45,marginTop:2}}>{desc}</span>
      </span>
    </button>
  );
}

export default function PacksEditor({ mode, onModeChange, packs, onPacksChange, basePrice, discountPct, frequencyDays, freqScales, onFreqScalesChange }) {
  const ctx = { basePrice, discountPct, frequencyDays, freqScales, rows: packs };
  const error = mode === "packs" ? validatePacks(packs) : null;

  const upd = (i, k, v) => onPacksChange(packs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  const setDefault = (i) => onPacksChange(packs.map((r, j) => ({ ...r, default: j === i })));
  const remove = (i) => onPacksChange(packs.filter((_, j) => j !== i));
  const add = () => {
    if (packs.length >= PACKS_MAX) return;
    const used = new Set(packs.map(r => int(r.qty)));
    let q = 1; while (used.has(q)) q++;
    const row = emptyPackRow(q);
    if (num(basePrice) > 0) row.price_ars = String(Math.round(num(basePrice) * q));
    onPacksChange([...packs, { ...row, default: packs.length === 0 }]);
  };
  const generate = () => {
    if (!(num(basePrice) > 0)) return;
    onPacksChange(autoPacks(basePrice));
  };

  const freqAutoPh = (row) => {
    const q = Math.max(1, int(row.qty));
    const f = Math.max(1, int(frequencyDays));
    return `auto (${freqScales ? f * q : f})`;
  };
  const subAutoPh = (row) => {
    const p = num(row.price_ars);
    return p > 0 ? `auto (${Math.round(p * (1 - (num(discountPct) || 0) / 100)).toLocaleString("es-AR")})` : "auto";
  };

  return (
    <div style={{marginTop:18,paddingTop:14,borderTop:"1px solid var(--border)"}}>
      <div style={{fontSize:13,fontWeight:700,color:"var(--text)",marginBottom:8}}>Precios y packs</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:8}}>
        <ModeOption active={mode === "packs"} tag="Recomendado" title="Packs de Recurrentes" desc="Recurrentes arma el selector de packs en tu tienda (1·2·3 unidades, compra única o suscripción)." onClick={()=>onModeChange("packs")}/>
        <ModeOption active={mode === "theme"} tag="Avanzado" title="Mi tema manda el precio" desc="El widget solo agrega el toggle de suscripción; precio, cantidad y frecuencia salen de tu tema." onClick={()=>onModeChange("theme")}/>
      </div>

      {mode === "packs" && (
        <div style={{marginTop:12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
            <button type="button" onClick={generate} disabled={!(num(basePrice) > 0)} title={num(basePrice) > 0 ? "" : "Elegí primero el producto (necesito el precio base)"} style={{...btnSm,opacity:num(basePrice)>0?1:0.5,cursor:num(basePrice)>0?"pointer":"not-allowed"}}>✨ Generar 1·2·3 automáticamente</button>
            <button type="button" onClick={add} disabled={packs.length >= PACKS_MAX} style={{...btnSm,opacity:packs.length>=PACKS_MAX?0.5:1}}>+ Agregar pack</button>
            <span style={{fontSize:10,color:"var(--text-sm)",marginLeft:"auto"}}>{packs.length}/{PACKS_MAX}</span>
          </div>

          {packs.length === 0 ? (
            <div style={{fontSize:11,color:"var(--text-sm)",padding:"10px 12px",background:"var(--surface)",borderRadius:8,lineHeight:1.5}}>
              Sin packs todavía. Tocá "Generar 1·2·3" (0 / 15 / 25 % off por cantidad sobre el precio base) o agregá uno a mano.
            </div>
          ) : (
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {packs.map((r, i) => {
                const d = derivePack(r, ctx);
                return (
                  <div key={i} style={{background:"var(--surface)",border:`1px solid ${r.default?"rgba(16,185,129,0.5)":"var(--border)"}`,borderRadius:10,padding:"10px 12px"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(105px, 1fr))",gap:8}}>
                      <div><label style={lbl}>Cantidad</label><input type="number" min="1" max="99" value={r.qty} onChange={e=>upd(i,"qty",e.target.value)} style={inp}/></div>
                      <div><label style={lbl}>Precio del pack ($)</label><input type="number" min="0" value={r.price_ars} onChange={e=>upd(i,"price_ars",e.target.value)} style={inp} placeholder="compra única"/></div>
                      <div><label style={lbl}>Precio tachado ($)</label><input type="number" min="0" value={r.compare_at_ars} onChange={e=>upd(i,"compare_at_ars",e.target.value)} style={inp} placeholder={`auto (${d.compareAt.toLocaleString("es-AR")})`}/></div>
                      <div><label style={lbl}>Frecuencia (días)</label><input type="number" min="1" value={r.frequency_days} onChange={e=>upd(i,"frequency_days",e.target.value)} style={inp} placeholder={freqAutoPh(r)}/></div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(105px, 1fr))",gap:8,marginTop:8}}>
                      <div><label style={lbl}>Etiqueta</label><input type="text" value={r.label} onChange={e=>upd(i,"label",e.target.value)} style={inp} placeholder={`${d.qty} ${d.qty===1?"pote":"potes"}`} maxLength={40}/></div>
                      <div><label style={lbl}>Badge</label><input type="text" value={r.badge} onChange={e=>upd(i,"badge",e.target.value)} style={inp} placeholder="Más elegido" maxLength={24}/></div>
                      <div><label style={lbl}>Precio suscripción ($)</label><input type="number" min="0" value={r.sub_price_ars} onChange={e=>upd(i,"sub_price_ars",e.target.value)} style={inp} placeholder={subAutoPh(r)}/></div>
                      <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
                        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"var(--text-md)",cursor:"pointer",whiteSpace:"nowrap",paddingBottom:8}}>
                          <input type="radio" name="rc-pack-default" checked={r.default === true} onChange={()=>setDefault(i)} style={{accentColor:"var(--green)"}}/>
                          Por defecto
                        </label>
                        <button type="button" onClick={()=>remove(i)} title="Quitar pack" style={{marginLeft:"auto",background:"transparent",border:"none",color:"var(--red)",fontSize:15,cursor:"pointer",padding:"0 4px 6px"}}>✕</button>
                      </div>
                    </div>
                    <div style={{marginTop:8,fontSize:11,color:"var(--text-md)",display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{color:"var(--accent)",fontWeight:700}}>Suscripción: {fmt(d.subPrice)} cada {d.freqDays} días</span>
                      <span style={{color:"var(--text-sm)"}}>·</span>
                      <span>ahorrás {d.savingsPct}%</span>
                      <span style={{color:"var(--text-sm)"}}>·</span>
                      <span style={{color:"var(--text-sm)"}}>{fmt(d.perUnitSub)} c/u · tachado {fmt(d.compareAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <label style={{display:"flex",alignItems:"center",gap:8,fontSize:12,color:"var(--text-md)",marginTop:12,cursor:"pointer"}}>
            <input type="checkbox" checked={freqScales !== false} onChange={e=>onFreqScalesChange(e.target.checked)} style={{accentColor:"var(--green)"}}/>
            <span>La frecuencia se multiplica por la cantidad <span style={{color:"var(--text-sm)"}}>(2 potes → cada {Math.max(1,int(frequencyDays))*2} días)</span></span>
          </label>

          {error && (
            <div style={{marginTop:10,fontSize:11,color:"var(--red)",padding:"8px 10px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:8}}>
              {error}
            </div>
          )}
        </div>
      )}

      {mode === "theme" && (
        <div style={{marginTop:10,fontSize:11,color:"var(--text-sm)",padding:"8px 10px",background:"var(--surface)",borderRadius:8,lineHeight:1.5}}>
          El precio base, el % de descuento y la frecuencia de arriba mandan. El diseñador del selector de packs no aplica a este plan.
        </div>
      )}
    </div>
  );
}
