import { achicarImagen } from "../lib/imagen.js";
import React from "react";
import { DS, useT } from "../ui/theme.js";
import { Btn, InputStyle, CheckLine, Callout, DSBadge } from "../ui/components.jsx";
import { PackTip } from "./Onboarding.jsx";

// Editor de "Precios y packs" del plan (alta y edición). Vive fuera de
// Dashboard.jsx para no engordarlo. Contrato de datos: shared/bundle/SPEC.md.
//
// Filas editables (strings para que los inputs no peleen con el usuario):
//   { qty, price_ars, compare_at_ars, label, badge, frequency_days, sub_price_ars, default }
// serializePacks() las convierte al formato del backend.

// 12 = 6 por columna (22-sept-2026): los packs de compra unica y los de
// suscripcion son bloques distintos y conviven en la misma lista.
export const PACKS_MAX = 12;

const fmt = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

export function pricingModeOf(plan) {
  if (!plan) return "theme";
  if (plan.pricing_mode === "packs" || plan.pricing_mode === "theme") return plan.pricing_mode;
  return Array.isArray(plan.packs) && plan.packs.length > 0 ? "packs" : "theme";
}

// Las dos columnas del editor (22-sept-2026, Thiago): la cantidad de bloques
// NO tiene por que ser la misma en cada modo. Suscripcion va a la izquierda,
// que es lo que queremos vender.
const COLUMNAS = [
  { id: "once", title: "Compra única", corto: "compra única", ve: (r) => r.hide_once !== true,
    vacio: "Sin bloques de compra única: tu cliente solo va a poder suscribirse." },
  { id: "sub",  title: "Suscripción",  corto: "suscripción",  ve: (r) => r.hide_sub !== true,
    vacio: "Sin bloques de suscripción: el widget no va a ofrecer suscribirse." },
];

export function emptyPackRow(qty = 1) {
  return { qty: String(qty), price_ars: "", compare_at_ars: "", label: "", note: "", note_once: "", badge: "", frequency_days: "", sub_price_ars: "", image: "", gifts: [], default: false, hide_once: false, hide_sub: false, sub_qty: "", freq_unit: "dias" };
}

// Plan guardado → filas del editor.
export function packsFromPlan(plan) {
  const arr = Array.isArray(plan?.packs) ? plan.packs : [];
  // Un pack visible en LAS DOS columnas es un solo dato mostrado dos veces: al
  // editarle el badge (o cualquier campo) cambiaban los dos a la vez. Al abrir
  // el plan se parte en dos bloques independientes, uno por columna, para que
  // cada uno se edite por su cuenta. 22-sept-2026, Thiago.
  const separados = [];
  for (const p of arr) {
    const enOnce = p.hide_once !== true, enSub = p.hide_sub !== true;
    if (enOnce && enSub) {
      separados.push({ ...p, hide_sub: true, hide_once: false });
      separados.push({ ...p, hide_once: true, hide_sub: false, default: false });
    } else {
      separados.push(p);
    }
  }
  return separados.slice(0, PACKS_MAX).map(p => ({
    qty: String(p.qty ?? 1),
    price_ars: p.price_ars != null ? String(p.price_ars) : "",
    compare_at_ars: p.compare_at_ars != null ? String(p.compare_at_ars) : "",
    label: p.label || "",
    note: p.note || "",
    note_once: p.note_once || "",
    badge: p.badge || "",
    frequency_days: p.frequency_days != null ? String(p.frequency_days) : "",
    sub_price_ars: p.sub_price_ars != null ? String(p.sub_price_ars) : "",
    image: p.image || "",
    gifts: Array.isArray(p.gifts) ? p.gifts.slice(0, 3).map(g => ({
      title: g?.title || "",
      image: g?.image || "",
      compare_at_ars: g?.compare_at_ars != null ? String(g.compare_at_ars) : "",
      virtual: g?.virtual === true,
      note: g?.note || "",
      every: g?.every === "once" ? "once" : "always",
    })) : [],
    default: p.default === true,
    hide_once: p.hide_once === true,
    hide_sub: p.hide_sub === true,
    sub_qty: p.sub_qty != null ? String(p.sub_qty) : "",
    freq_unit: p.freq_unit === "meses" ? "meses" : "dias",
  }));
}

// 1·2·3 automáticos a partir del precio base: 0 / 15 / 25 % off por cantidad.
export function autoPacks(basePrice) {
  const b = Math.round(num(basePrice));
  // Cada bloque pertenece a UNA sola columna (22-sept-2026, Thiago): si el
  // mismo pack se muestra en las dos, editar el badge de uno cambia el del
  // otro, porque es el mismo dato. Se generan dos juegos independientes.
  const mk = (qty, off, label, badge, def, col) => ({
    qty: String(qty),
    price_ars: String(Math.round(b * qty * (1 - off / 100))),
    compare_at_ars: "",
    label, note: "", note_once: "", badge, frequency_days: "", sub_price_ars: "", image: "", gifts: [], default: def,
    hide_once: col === "sub", hide_sub: col === "once", sub_qty: "", freq_unit: "dias",
  });
  return [
    // Compra única
    mk(1, 0, "1 unidad", "", false, "once"),
    mk(2, 15, "2 unidades", "Más elegido", true, "once"),
    mk(3, 25, "3 unidades", "Mejor precio", false, "once"),
    // Suscripción (las mismas cantidades, pero su propio bloque)
    mk(1, 0, "1 unidad", "", false, "sub"),
    mk(2, 15, "2 unidades", "Más elegido", false, "sub"),
    mk(3, 25, "3 unidades", "Mejor precio", false, "sub"),
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
  // La cantidad no se repite DENTRO de cada lista, pero sí puede estar en las
  // dos: un bloque de 2 en compra única y otro de 2 en suscripción son bloques
  // distintos. Antes se chequeaba contra todos juntos y no dejaba. 22-sept-2026.
  const vistoOnce = new Set(), vistoSub = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]; const n = i + 1;
    const qty = int(r.qty);
    if (!(qty >= 1)) return `Pack ${n}: la cantidad tiene que ser 1 o más.`;
    if (r.hide_once !== true) {
      if (vistoOnce.has(qty)) return `Pack ${n}: ya hay otro bloque de compra única con cantidad ${qty}.`;
      vistoOnce.add(qty);
    }
    if (r.hide_sub !== true) {
      if (vistoSub.has(qty)) return `Pack ${n}: ya hay otro bloque de suscripción con cantidad ${qty}.`;
      vistoSub.add(qty);
    }
    // En un bloque de SOLO suscripcion el precio vive en sub_price_ars: exigir
    // price_ars ahi no dejaba guardar. 22-sept-2026.
    const soloSub = r.hide_once === true;
    const price = num(soloSub && !(num(r.price_ars) > 0) ? r.sub_price_ars : r.price_ars);
    if (!(price > 0)) return `Pack ${n}: ${soloSub ? "el precio de suscripción" : "el precio del pack"} tiene que ser mayor a 0.`;
    if (r.compare_at_ars !== "" && num(r.compare_at_ars) < price) return `Pack ${n}: el precio tachado no puede ser menor al precio del pack.`;
    if (r.sub_price_ars !== "" && !(num(r.sub_price_ars) > 0)) return `Pack ${n}: el precio de suscripción tiene que ser mayor a 0.`;
    if (r.frequency_days !== "" && !(int(r.frequency_days) >= 1)) return `Pack ${n}: la frecuencia tiene que ser 1 día o más.`;
  }
  return null;
}

// Filas → formato del backend (SPEC). Ordena por cantidad y garantiza un solo default.
export function serializePacks(rows) {
  const out = rows
    // Un bloque de suscripcion guarda su precio en sub_price_ars y deja
    // price_ars vacio: filtrar por price_ars lo descartaba en silencio y al
    // recargar volvia el pack compartido (parecia que el badge "se copiaba").
    // 22-sept-2026, Thiago.
    .filter(r => int(r.qty) >= 1 && (num(r.price_ars) > 0 || num(r.sub_price_ars) > 0))
    .map(r => ({
      qty: int(r.qty),
      // El backend exige price_ars >= 1. En un bloque de solo suscripcion, si
      // no hay precio de lista se usa el de suscripcion como base.
      price_ars: Math.round(num(r.price_ars) > 0 ? num(r.price_ars) : num(r.sub_price_ars)),
      compare_at_ars: r.compare_at_ars !== "" && num(r.compare_at_ars) > 0 ? Math.round(num(r.compare_at_ars)) : null,
      label: (r.label || "").trim() || `${int(r.qty)} ${int(r.qty) === 1 ? "unidad" : "unidades"}`,
      note: (r.note || "").trim(),
      note_once: (r.note_once || "").trim(),
      badge: (r.badge || "").trim() || null,
      frequency_days: r.frequency_days !== "" && int(r.frequency_days) >= 1 ? int(r.frequency_days) : null,
      sub_price_ars: r.sub_price_ars !== "" && num(r.sub_price_ars) > 0 ? Math.round(num(r.sub_price_ars)) : null,
      // Foto del pack y regalos: los usan los diseños Foto (v11) y Foto + regalos (v12).
      image: (r.image || "").trim() || null,
      gifts: (Array.isArray(r.gifts) ? r.gifts : [])
        .filter(g => (g?.title || "").trim())
        .slice(0, 3)
        .map(g => ({
          title: (g.title || "").trim(),
          image: (g.image || "").trim() || null,
          compare_at_ars: g.compare_at_ars !== "" && num(g.compare_at_ars) > 0 ? Math.round(num(g.compare_at_ars)) : null,
          // Regalo que no es un producto de la tienda (ebook, sorteo): se
          // muestra en el widget y NO viaja en la caja. 22-sept-2026.
          virtual: g.virtual === true,
          note: (g.note || "").trim(),
          every: g.every === "once" ? "once" : "always",
        })),
      default: r.default === true,
      // En qué modo se muestra este pack, y la cantidad propia de suscripción.
      hide_once: r.hide_once === true,
      hide_sub: r.hide_sub === true,
      sub_qty: r.sub_qty !== "" && int(r.sub_qty) >= 1 ? int(r.sub_qty) : null,
      freq_unit: r.freq_unit === "meses" ? "meses" : "dias",
    }))
    .sort((a, b) => a.qty - b.qty);
  if (out.length && !out.some(p => p.default)) out[0].default = true;
  let seenDefault = false;
  out.forEach(p => { if (p.default) { if (seenDefault) p.default = false; seenDefault = true; } });
  return out;
}

// ── piezas visuales (tema del DS vía useT) ─────────────────────────────
function ModeOption({ T, active, title, desc, tag, onClick }) {
  return (
    <button type="button" onClick={onClick} className="gh-chip" style={{textAlign:"left",background:active?T.accentSolid+"12":T.surface,border:`1.5px solid ${active?T.accentSolid:T.border}`,borderRadius:DS.r.lg,padding:"10px 12px",cursor:"pointer",fontFamily:"inherit",color:T.text,display:"flex",gap:10,alignItems:"flex-start",boxShadow:active?`0 0 0 3px ${T.accentSolid}1f`:"none"}}>
      <span style={{width:16,height:16,borderRadius:"50%",border:`2px solid ${active?T.accentSolid:T.inputBorder}`,display:"inline-flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:1}}>
        {active && <span style={{width:8,height:8,borderRadius:"50%",background:T.accentSolid}}/>}
      </span>
      <span style={{minWidth:0}}>
        <span style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <span style={{fontSize:DS.font.md,fontWeight:DS.w.bold}}>{title}</span>
          {tag && <DSBadge T={T} color={active?T.accent:T.textSm} size="sm">{tag}</DSBadge>}
        </span>
        <span style={{display:"block",fontSize:DS.font.sm,color:T.textSm,lineHeight:1.45,marginTop:2}}>{desc}</span>
      </span>
    </button>
  );
}

const Lbl = ({ T, children }) => <label style={{display:"block",fontSize:DS.font.xs,fontWeight:DS.w.semibold,color:T.textSm,marginBottom:3,textTransform:"uppercase",letterSpacing:0.4}}>{children}</label>;

// compact=true: solo las filas (sin título ni selector de modo) — lo usa el
// diseñador del widget con mode="packs" fijo.
export default function PacksEditor({ mode, onModeChange, packs, onPacksChange, basePrice, discountPct, frequencyDays, freqScales, onFreqScalesChange, compact = false, radioName = "rc-pack-default", products = [], productImage = null, toast }) {
  const T = useT();
  const inp = { ...InputStyle(T), padding:"7px 9px", fontSize:DS.font.md };
  const ctx = { basePrice, discountPct, frequencyDays, freqScales, rows: packs };
  const error = mode === "packs" ? validatePacks(packs) : null;

  const upd = (i, k, v) => onPacksChange(packs.map((r, j) => j === i ? { ...r, [k]: v } : r));
  // Varios campos a la vez: dos `upd` seguidos pisan el mismo estado.
  const upd2 = (i, patch) => onPacksChange(packs.map((r, j) => j === i ? { ...r, ...patch } : r));
  const setDefault = (i) => onPacksChange(packs.map((r, j) => ({ ...r, default: j === i })));
  // Regalos de un pack (máx. 3): los muestra el diseño "Foto + regalos".
  const updGift = (i, gi, k, v) => onPacksChange(packs.map((r, j) => j === i
    ? { ...r, gifts: (r.gifts || []).map((g, gj) => gj === gi ? { ...g, [k]: v } : g) } : r));
  const addGift = (i) => onPacksChange(packs.map((r, j) => j === i
    ? { ...r, gifts: [...(r.gifts || []), { title: "", image: "", compare_at_ars: "" }] } : r));
  const rmGift = (i, gi) => onPacksChange(packs.map((r, j) => j === i
    ? { ...r, gifts: (r.gifts || []).filter((_, gj) => gj !== gi) } : r));
  // Subir foto desde la compu: se achica en el navegador y viaja como data URL.
  const subirFoto = async (e, aplicar) => {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try { aplicar(await achicarImagen(f)); }
    catch (err) { toast ? toast(err.message, "error") : alert(err.message); }
  };
  // Elegir un producto de la tienda como regalo: trae nombre y foto de una.
  const regaloDesdeProducto = (i, gi, id) => {
    const p = products.find(x => String(x.id) === String(id));
    if (!p) return;
    onPacksChange(packs.map((r, j) => j === i
      ? { ...r, gifts: (r.gifts || []).map((g, gj) => gj === gi
          ? { ...g, title: g.title || p.title, image: p.image || g.image || "" } : g) }
      : r));
  };
  const remove = (i) => onPacksChange(packs.filter((_, j) => j !== i));
  // El pack recien agregado se trae a la vista: como el boton quedo abajo de la
  // lista, sin esto en una lista larga no se nota que se sumo uno.
  const finRef = React.useRef(null);
  const [recien, setRecien] = React.useState(-1);
  React.useEffect(() => {
    if (recien < 0) return;
    finRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    const t = setTimeout(() => setRecien(-1), 1200);
    return () => clearTimeout(t);
  }, [recien]);
  // `col` dice en que columna se agrega: "sub" (solo suscripcion), "once"
  // (solo compra unica) o null (en las dos). 22-sept-2026, Thiago.
  const add = (col = null) => {
    if (packs.length >= PACKS_MAX) return;
    const used = new Set(packs.map(r => int(r.qty)));
    let q = 1; while (used.has(q)) q++;
    const row = emptyPackRow(q);
    if (num(basePrice) > 0) row.price_ars = String(Math.round(num(basePrice) * q));
    if (col === "sub") row.hide_once = true;
    if (col === "once") row.hide_sub = true;
    onPacksChange([...packs, { ...row, default: packs.length === 0 }]);
    setRecien(packs.length);
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

  // Una tarjeta de pack. Se dibuja igual en las dos columnas; `i` es
  // SIEMPRE el indice real en `packs` (con el que cobra el checkout).
  const renderCard = (r, i, col) => {
    // `col` = "sub" | "once": cada seccion muestra SOLO su precio. Antes las dos
    // mostraban "Precio del pack" y "Precio suscripcion" y se repetian.
    const esSub = col === "sub";
                const d = derivePack(r, ctx);
                return (
                  <div key={i} className="gh-list-item" style={{background:T.surface,border:`1px solid ${i===recien?T.accentSolid:r.default?T.accentSolid+"80":T.borderL}`,borderRadius:DS.r.lg,padding:"10px 12px",transition:"border-color .3s"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(96px, 1fr))",gap:8}}>
                      <div><Lbl T={T}>Cantidad</Lbl><input type="number" min="1" max="99" value={r.qty} onChange={e=>upd(i,"qty",e.target.value)} style={inp}/></div>
                      <div><Lbl T={T}>{esSub ? "Precio suscripción ($)" : "Precio del pack ($)"}</Lbl><input type="number" min="0" value={esSub ? (r.sub_price_ars || "") : r.price_ars} onChange={e=>upd(i, esSub ? "sub_price_ars" : "price_ars", e.target.value)} style={inp} placeholder={esSub ? subAutoPh(r) : "lo que paga"}/></div>
                      <div><Lbl T={T}>Precio tachado ($)</Lbl><input type="number" min="0" value={r.compare_at_ars} onChange={e=>upd(i,"compare_at_ars",e.target.value)} style={inp} placeholder={`auto (${d.compareAt.toLocaleString("es-AR")})`}/></div>
                      <div><Lbl T={T}>Frecuencia (días)</Lbl><input type="number" min="1" value={r.frequency_days} onChange={e=>upd(i,"frequency_days",e.target.value)} style={inp} placeholder={freqAutoPh(r)}/></div>
                      {/* Cómo se le muestra al cliente esa frecuencia: "cada 60
                          días" o "cada 2 meses". Solo aplica a los bloques que
                          se ven en suscripción. 24-sept-2026, Thiago. */}
                      {r.hide_sub !== true && (
                        <div><Lbl T={T}>Mostrar como</Lbl>
                          <select value={r.freq_unit || "dias"} onChange={e=>upd(i,"freq_unit",e.target.value)} style={inp}>
                            <option value="dias">Días</option>
                            <option value="meses">Meses</option>
                          </select>
                        </div>
                      )}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(96px, 1fr))",gap:8,marginTop:8}}>
                      <div><Lbl T={T}>Etiqueta</Lbl><input type="text" value={r.label} onChange={e=>upd(i,"label",e.target.value)} style={inp} placeholder={`${d.qty} ${d.qty===1?"pote":"potes"}`} maxLength={40}/></div>
                      <div><Lbl T={T}>Badge</Lbl><input type="text" value={r.badge} onChange={e=>upd(i,"badge",e.target.value)} style={inp} placeholder="Más elegido" maxLength={48}/></div>
                      {esSub && <div><Lbl T={T}>Precio sin descuento ($)</Lbl><input type="number" min="0" value={r.price_ars} onChange={e=>upd(i,"price_ars",e.target.value)} style={inp} placeholder="para calcular el ahorro"/></div>}
                      <div style={{display:"flex",alignItems:"flex-end",gap:8}}>
                        <label style={{display:"flex",alignItems:"center",gap:6,fontSize:DS.font.sm,color:T.textMd,cursor:"pointer",whiteSpace:"nowrap",paddingBottom:8}}>
                          <input type="radio" name={radioName} checked={r.default === true} onChange={()=>setDefault(i)} style={{accentColor:T.accentSolid}}/>
                          Por defecto
                        </label>
                        <button type="button" onClick={()=>remove(i)} title="Quitar pack" style={{marginLeft:"auto",background:"transparent",border:"none",color:T.textSm,fontSize:15,cursor:"pointer",padding:"0 4px 6px",fontFamily:"inherit"}}
                          onMouseEnter={e=>e.currentTarget.style.color=T.red} onMouseLeave={e=>e.currentTarget.style.color=T.textSm}>✕</button>
                      </div>
                    </div>
                    {/* El renglón chico debajo del título del pack ("Máximo
                        Ahorro", "60 cápsulas"). Un bloque de una sola columna
                        lleva un texto; el compartido lleva uno por modo, porque
                        el cliente ve cosas distintas. 24-sept-2026, Thiago. */}
                    {r.hide_once || r.hide_sub ? (
                      <div style={{marginTop:8}}>
                        <Lbl T={T}>Texto debajo del título</Lbl>
                        <input type="text" value={r.hide_sub ? r.note_once : r.note}
                          onChange={e=>upd(i, r.hide_sub ? "note_once" : "note", e.target.value)} style={inp}
                          placeholder={r.hide_sub ? "Ej: 4 potes · Máximo ahorro" : "Ej: tratamiento 4 meses"} maxLength={120}/>
                      </div>
                    ) : (
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:8}}>
                        <div>
                          <Lbl T={T}>Texto en compra única</Lbl>
                          <input type="text" value={r.note_once} onChange={e=>upd(i,"note_once",e.target.value)} style={inp}
                            placeholder="Ej: 4 potes" maxLength={120}/>
                        </div>
                        <div>
                          <Lbl T={T}>Texto en suscripción</Lbl>
                          <input type="text" value={r.note} onChange={e=>upd(i,"note",e.target.value)} style={inp}
                            placeholder="Ej: tratamiento 4 meses" maxLength={120}/>
                        </div>
                      </div>
                    )}
                    {/* Foto del pack y regalos: los dibujan los diseños Foto y Foto + regalos. */}
                    <div style={{marginTop:8}}>
                      <Lbl T={T}>Foto del pack</Lbl>
                      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                        {r.image
                          ? <img src={r.image} alt="" style={{width:42,height:42,objectFit:"contain",borderRadius:6,border:`1px solid ${T.borderL}`,background:"#fff",flex:"none"}}/>
                          : <span style={{width:42,height:42,borderRadius:6,border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",color:T.textSm,fontSize:16,flex:"none"}}>🖼️</span>}
                        <label style={{border:`1px solid ${T.border}`,borderRadius:DS.r.md,padding:"7px 11px",fontSize:DS.font.sm,color:T.textMd,cursor:"pointer",background:T.surface,whiteSpace:"nowrap"}}>
                          {r.image ? "Cambiar" : "Subir foto"}
                          <input type="file" accept="image/*" onChange={e=>subirFoto(e, v=>upd(i,"image",v))} style={{display:"none"}}/>
                        </label>
                        {r.image && <button type="button" onClick={()=>upd(i,"image","")} style={{background:"transparent",border:"none",color:T.textSm,fontSize:DS.font.sm,cursor:"pointer",fontFamily:"inherit"}}>Quitar</button>}
                        {productImage && !r.image && (
                          <button type="button" onClick={()=>upd(i,"image",productImage)} style={{background:"transparent",border:`1px dashed ${T.border}`,borderRadius:DS.r.md,padding:"7px 11px",fontSize:DS.font.sm,color:T.textMd,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap"}}>Usar la del producto</button>
                        )}
                      </div>
                    </div>
                    <div style={{marginTop:8}}>
                      <Lbl T={T}>Regalos de este pack</Lbl>
                      {(r.gifts || []).map((g, gi) => (
                        <div key={gi} style={{border:`1px solid ${T.borderL}`,borderRadius:DS.r.md,padding:"8px 9px",marginBottom:6,background:T.surfaceAlt||"transparent"}}>
                          <div style={{display:"flex",gap:7,alignItems:"center",marginBottom:6}}>
                            {g.image
                              ? <img src={g.image} alt="" style={{width:34,height:34,objectFit:"cover",borderRadius:5,border:`1px solid ${T.borderL}`,background:"#fff",flex:"none"}}/>
                              : <span style={{width:34,height:34,borderRadius:5,border:`1px dashed ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flex:"none"}}>🎁</span>}
                            <input type="text" value={g.title} onChange={e=>updGift(i,gi,"title",e.target.value)} style={{...inp,flex:1}} placeholder="Nombre del regalo" maxLength={80}/>
                            <input type="number" min="0" value={g.compare_at_ars} onChange={e=>updGift(i,gi,"compare_at_ars",e.target.value)} style={{...inp,width:92,flex:"none"}} placeholder="valor $"/>
                            <button type="button" onClick={()=>rmGift(i,gi)} title="Quitar regalo" style={{background:"transparent",border:"none",color:T.textSm,cursor:"pointer",fontSize:14,fontFamily:"inherit",flex:"none"}}>✕</button>
                          </div>
                          {/* Regalo que NO es un producto de la tienda: un ebook
                              que se manda por fuera, un sorteo. 22-sept-2026. */}
                          <CheckLine T={T} checked={g.virtual === true} onChange={v=>updGift(i,gi,"virtual",v)} style={{marginBottom:6}}>
                            No es un producto de mi tienda <span style={{color:T.textSm}}>(ebook, sorteo, acceso…)</span>
                          </CheckLine>
                          {g.virtual && (
                            <input type="text" value={g.note || ""} onChange={e=>updGift(i,gi,"note",e.target.value)}
                              style={{...inp,marginBottom:6}} maxLength={120}
                              placeholder="Aclaración para tu cliente (ej: te llega por mail)"/>
                          )}
                          {/* Cada cuánto viaja el regalo (25-sept-2026, Wellfresh):
                              el raspador es físico y lo mandan solo la primera vez.
                              Solo aplica al bloque de suscripción. */}
                          {r.hide_sub !== true && (
                            <div style={{marginBottom:6}}>
                              <Lbl T={T}>¿En qué envíos va este regalo?</Lbl>
                              <select value={g.every || "always"} onChange={e=>updGift(i,gi,"every",e.target.value)} style={inp}>
                                <option value="always">En todos los envíos</option>
                                <option value="once">Solo en el primero</option>
                              </select>
                            </div>
                          )}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                            {products.length > 0 && !g.virtual && (
                              <select value="" onChange={e=>regaloDesdeProducto(i,gi,e.target.value)} style={{...inp,maxWidth:220}}>
                                <option value="">Elegir de mi tienda…</option>
                                {products.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
                              </select>
                            )}
                            <label style={{border:`1px solid ${T.border}`,borderRadius:DS.r.md,padding:"6px 10px",fontSize:DS.font.sm,color:T.textMd,cursor:"pointer",background:T.surface,whiteSpace:"nowrap"}}>
                              {g.image ? "Cambiar foto" : "Subir foto"}
                              <input type="file" accept="image/*" onChange={e=>subirFoto(e, v=>updGift(i,gi,"image",v))} style={{display:"none"}}/>
                            </label>
                            {g.image && <button type="button" onClick={()=>updGift(i,gi,"image","")} style={{background:"transparent",border:"none",color:T.textSm,fontSize:DS.font.sm,cursor:"pointer",fontFamily:"inherit"}}>Quitar foto</button>}
                          </div>
                        </div>
                      ))}
                      {(r.gifts || []).length < 3 && (
                        <button type="button" onClick={()=>addGift(i)} style={{background:"transparent",border:`1px dashed ${T.border}`,borderRadius:DS.r.md,color:T.textMd,fontSize:DS.font.sm,padding:"6px 10px",cursor:"pointer",fontFamily:"inherit"}}>+ Agregar regalo</button>
                      )}
                    </div>
                    <div style={{marginTop:8,fontSize:DS.font.sm,color:T.textMd,display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                      <span style={{color:T.accent,fontWeight:DS.w.bold}}>Suscripción: {fmt(d.subPrice)} cada {d.freqDays} días</span>
                      <span style={{color:T.textSm}}>·</span>
                      <span>ahorrás {d.savingsPct}%</span>
                      <span style={{color:T.textSm}}>·</span>
                      <span style={{color:T.textSm}}>{fmt(d.perUnitSub)} c/u · tachado {fmt(d.compareAt)}</span>
                    </div>
                  </div>
                );
  };
  return (
    <div style={compact ? {} : {marginTop:16,paddingTop:14,borderTop:`1px solid ${T.borderL}`}}>
      {!compact && (
        <>
          <div style={{fontSize:DS.font.base,fontWeight:DS.w.bold,color:T.text,marginBottom:10,display:"flex",alignItems:"center",gap:8}}>Precios y packs <PackTip T={T}/></div>
          {/* "Mi tema manda el precio" solo se ofrece a quien YA lo está usando
              (22-sept, Thiago): es el caso de Lumina y de nadie más. El que
              necesite algo a medida lo arregla con nosotros, no acá. */}
          {mode === "theme" && (
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))",gap:8}}>
              <ModeOption T={T} active={false} tag="Recomendado" title="Packs de Recurrentes" desc="Recurrentes arma el selector de packs en tu tienda (1·2·3 unidades, compra única o suscripción)." onClick={()=>onModeChange?.("packs")}/>
              <ModeOption T={T} active tag="Avanzado" title="Mi tema manda el precio" desc="El widget solo agrega el toggle de suscripción; precio, cantidad y frecuencia salen de tu tema." onClick={()=>onModeChange?.("theme")}/>
            </div>
          )}
        </>
      )}

      {mode === "packs" && (
        <div style={{marginTop:compact ? 0 : 12}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
            <Btn T={T} variant="secondary" size="sm" type="button" onClick={generate} disabled={!(num(basePrice) > 0)} title={num(basePrice) > 0 ? "" : "Elegí primero el producto (necesito el precio base)"}>✨ Generar 1·2·3 automáticamente</Btn>
            {packs.length === 0 && (
              <Btn T={T} variant="secondary" size="sm" type="button" onClick={()=>add()}>+ Agregar pack</Btn>
            )}
            <span style={{fontSize:DS.font.xs,color:T.textSm,marginLeft:"auto"}}>{packs.length}/{PACKS_MAX}</span>
          </div>

          {packs.length === 0 ? (
            <div style={{fontSize:DS.font.sm,color:T.textSm,padding:"10px 12px",background:T.surface,border:`1px solid ${T.borderL}`,borderRadius:DS.r.md,lineHeight:1.5}}>
              Sin packs todavía. Tocá "Generar 1·2·3" (0 / 15 / 25 % off por cantidad sobre el precio base) o agregá uno a mano.
            </div>
          ) : (
            <div className="stack-mobile" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,alignItems:"start"}}>
              {COLUMNAS.map(col => {
                const visibles = packs.map((r, i) => [r, i]).filter(([r]) => col.ve(r));
                return (
                  <div key={col.id}>
                    {/* Titulo de la seccion: los bloques de compra unica arriba
                        y los de suscripcion abajo, cada uno a ancho completo.
                        22-sept-2026, Thiago. */}
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8,paddingBottom:6,borderBottom:`1px solid ${T.borderL}`}}>
                      <span style={{fontSize:DS.font.base,fontWeight:DS.w.bold,color:T.text}}>{col.title}</span>
                      <span style={{fontSize:DS.font.xs,color:T.textSm}}>{visibles.length} {visibles.length===1?"bloque":"bloques"}</span>
                      <span style={{fontSize:DS.font.xs,color:T.textSm,marginLeft:"auto"}}>
                        {col.id === "once" ? "Lo que ve cuando compra suelto" : "Lo que ve cuando se suscribe"}
                      </span>
                    </div>
                    {/* Los bloques de la seccion, uno debajo del otro: la
                        columna ya es media pantalla. */}
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      {visibles.length === 0 ? (
                        <div style={{fontSize:DS.font.sm,color:T.textSm,padding:"10px 12px",background:T.surface,border:`1px dashed ${T.border}`,borderRadius:DS.r.md,lineHeight:1.5}}>
                          {col.vacio}
                        </div>
                      ) : visibles.map(([r, i]) => renderCard(r, i, col.id))}
                      {packs.length < PACKS_MAX && (
                        <button type="button" onClick={()=>add(col.id)} style={{background:"transparent",border:`1px dashed ${T.border}`,borderRadius:DS.r.lg,color:T.textMd,fontSize:DS.font.sm,padding:"11px 12px",cursor:"pointer",fontFamily:"inherit",textAlign:"center"}}
                          onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accentSolid;e.currentTarget.style.color=T.text;}}
                          onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.color=T.textMd;}}>+ Agregar bloque de {col.corto}</button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <CheckLine T={T} checked={freqScales !== false} onChange={v=>onFreqScalesChange(v)} style={{marginTop:12}}>
            La frecuencia se multiplica por la cantidad <span style={{color:T.textSm}}>(2 potes → cada {Math.max(1,int(frequencyDays))*2} días)</span>
          </CheckLine>

          {error && <Callout T={T} tone="danger" style={{marginTop:10}}>{error}</Callout>}
        </div>
      )}

      {mode === "theme" && !compact && (
        <Callout T={T} tone="info" style={{marginTop:10}}>
          El precio base, el % de descuento y la frecuencia de arriba mandan. El diseñador del selector de packs no aplica a este plan.
        </Callout>
      )}
    </div>
  );
}
