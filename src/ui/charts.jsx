// Gráficos y tarjetas de métricas estilo Growith (dashboard): KpiCard con delta
// vs período anterior + sparkline a lo ancho, AreaChart con pestañas y hover,
// Segmented (píldoras). Solo dependen de T / DS / React: reutilizables en
// Inicio, Cobros y Analíticas.
import React from "react";
import { DS } from "./theme.js";

const F = "'Inter',system-ui,sans-serif";

// % de cambio vs el período anterior. null = no hay contra qué comparar.
export function deltaPct(curr, prev) {
  if (prev == null || curr == null) return null;
  if (prev === 0) return curr === 0 ? 0 : null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

// ↑ 37,7% en verde / ↓ 6,2% en rojo. `invert`: bajar es bueno (bajas, fallidos).
export function DeltaBadge({ T, curr, prev, invert = false }) {
  const pct = deltaPct(curr, prev);
  if (pct == null) {
    if (prev === 0 && curr > 0) return <span style={pill(T, invert ? T.red : T.green)}>nuevo</span>;
    return null;
  }
  const flat = Math.abs(pct) < 0.05;
  const good = invert ? pct < 0 : pct > 0;
  const c = flat ? T.textSm : good ? T.green : T.red;
  const txt = `${flat ? "" : pct > 0 ? "↑ " : "↓ "}${Math.abs(pct).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
  return <span style={pill(T, c)} title="vs. el período anterior">{txt}</span>;
}
const pill = (T, c) => ({ display:"inline-flex", alignItems:"center", fontSize:10.5, fontWeight:700, color:c, background:c + "1a", borderRadius:99, padding:"2px 7px", whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" });

// Sparkline con área. viewBox estirable (preserveAspectRatio none) + trazo que
// no escala: ocupa el ancho de la card sin deformar la línea.
export function Sparkline({ vals = [], color, h = 28 }) {
  const n = vals.length;
  if (n < 2) return <div style={{ height: h }}/>;
  const max = Math.max(...vals), min = Math.min(0, ...vals);
  const rng = max - min || 1;
  const x = (i) => (i / (n - 1)) * 100;
  const y = (v) => h - 2 - ((v - min) / rng) * (h - 4);
  const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  return (
    <svg viewBox={`0 0 100 ${h}`} preserveAspectRatio="none" width="100%" height={h} aria-hidden="true" style={{ display:"block" }}>
      <path d={`${line} L100,${h} L0,${h} Z`} fill={color} fillOpacity="0.14"/>
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>
    </svg>
  );
}

// Tarjeta de métrica: etiqueta con punto de color · valor grande · delta · pista ·
// sparkline full-bleed abajo. `hero` = fila principal (más grande).
export function KpiCard({ T, label, value, curr, prev, invert, hint, spark, color, valueColor, hero, onClick, loading }) {
  const c = color || T.accentSolid;
  return (
    <div onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      className={onClick ? "gh-card-click" : undefined}
      style={{ background:`linear-gradient(150deg, ${T.card} 55%, ${c}10)`, border:`1px solid ${T.border}`, borderRadius:12,
        padding: hero ? "15px 17px 0" : "12px 14px 0", minHeight: hero ? 128 : 100, display:"flex", flexDirection:"column",
        overflow:"hidden", cursor: onClick ? "pointer" : "default", fontFamily:F, minWidth:0 }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5, marginBottom:7 }}>
        <span style={{ width:6, height:6, borderRadius:99, background:c, flexShrink:0 }}/>{label}
      </div>
      {loading ? (
        <div style={{ height: hero ? 30 : 23, width:"60%", borderRadius:6, background:T.surface, marginBottom:8 }}/>
      ) : (
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:4 }}>
          <span style={{ fontSize: hero ? 28 : 21, fontWeight:800, color: valueColor || T.text, letterSpacing: hero ? -1 : -0.6, lineHeight:1.05, fontVariantNumeric:"tabular-nums" }}>{value}</span>
          <DeltaBadge T={T} curr={curr} prev={prev} invert={invert}/>
        </div>
      )}
      <div style={{ fontSize:10.5, color:T.textSm, marginBottom:8, minHeight:14 }}>{hint}</div>
      <div style={{ marginTop:"auto", marginLeft: hero ? -17 : -14, marginRight: hero ? -17 : -14, opacity: loading ? 0.3 : 0.95 }}>
        <Sparkline vals={spark || []} color={c} h={hero ? 36 : 26}/>
      </div>
    </div>
  );
}

// Píldoras segmentadas (7 días · 30 días · 90 días). `count` opcional por opción
// → contador al lado de la etiqueta (estados de Suscripciones).
export function Segmented({ T, options, value, onChange, ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display:"inline-flex", alignItems:"center", background:T.bg, border:`1px solid ${T.border}`, borderRadius:99, padding:2, gap:2, height:34, boxSizing:"border-box", flexShrink:0 }}>
      {options.map(o => {
        const act = o.id === value;
        return (
          <button key={o.id} role="radio" aria-checked={act} onClick={() => onChange(o.id)}
            style={{ padding:"0 12px", height:"100%", fontSize:12, fontWeight: act ? 700 : 500, border:"none", borderRadius:99, background: act ? T.card : "transparent",
              color: act ? T.text : T.textSm, cursor:"pointer", fontFamily:F, boxShadow: act ? "0 1px 3px rgba(0,0,0,0.25)" : "none", transition:`all .15s ${DS.ease}`,
              display:"inline-flex", alignItems:"center", gap:6, whiteSpace:"nowrap" }}>
            {o.label}
            {o.count != null && <span style={{ fontSize:10.5, fontWeight:700, padding:"1px 6px", borderRadius:99, background: act ? T.accentSolid + "26" : T.border, color: act ? T.accent : T.textSm, fontVariantNumeric:"tabular-nums" }}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// Gráfico de área/líneas con pestañas y hover (línea vertical + valores del día).
//   tabs: [{ id, label, series:[{ key, label, color, values, fmt }] }]
export function AreaChart({ T, title, total, tabs, dates = [], fmtDate = (d) => d, height = 240 }) {
  const [tabId, setTabId] = React.useState(tabs[0]?.id);
  const [hover, setHover] = React.useState(null);
  const wrapRef = React.useRef(null);
  const tab = tabs.find(t => t.id === tabId) || tabs[0];
  const series = tab?.series || [];
  const n = dates.length;
  const W = 920, H = height, PL = 8, PR = 8, PT = 14, PB = 24;
  const all = series.flatMap(s => s.values);
  const max = Math.max(...all, 1);
  const X = (i) => PL + (n > 1 ? i / (n - 1) : 0) * (W - PL - PR);
  const Y = (v) => PT + (1 - v / max) * (H - PT - PB);
  const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const onMove = (e) => {
    const r = wrapRef.current?.getBoundingClientRect(); if (!r || n < 2) return;
    const i = Math.round((((e.clientX - r.left) / r.width) * W - PL) / (W - PL - PR) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const step = Math.max(1, Math.round((n - 1) / 6));
  const labelIdx = []; for (let i = 0; i < n; i += step) labelIdx.push(i); if (n && labelIdx[labelIdx.length - 1] !== n - 1) labelIdx.push(n - 1);
  return (
    <div style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:12, padding:"14px 16px 10px", fontFamily:F }}>
      <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ minWidth:0 }}>
          <div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5 }}>{title}</div>
          {total != null && <div style={{ fontSize:18, fontWeight:800, color:T.text, letterSpacing:-0.4, fontVariantNumeric:"tabular-nums" }}>{typeof total === "function" ? total(tab) : total}</div>}
        </div>
        <div style={{ display:"inline-flex", background:T.bg, border:`1px solid ${T.border}`, borderRadius:99, padding:2, gap:2 }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTabId(t.id)} aria-pressed={t.id === tab.id}
              style={{ padding:"4px 11px", fontSize:11.5, fontWeight: t.id === tab.id ? 700 : 500, border:"none", borderRadius:99, background: t.id === tab.id ? T.card : "transparent", color: t.id === tab.id ? T.text : T.textSm, cursor:"pointer", fontFamily:F }}>
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginLeft:"auto", alignItems:"center" }}>
          {series.map(s => (
            <span key={s.key} style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11, color:T.textMd }}>
              <span style={{ width:10, height:3, borderRadius:2, background:s.color }}/>{s.label}
              {hover != null && <b style={{ color:T.text, fontVariantNumeric:"tabular-nums" }}>{(s.fmt || String)(s.values[hover] || 0)}</b>}
            </span>
          ))}
          {hover != null && <span style={{ fontSize:11, color:T.textSm }}>{fmtDate(dates[hover])}</span>}
        </div>
      </div>
      <div ref={wrapRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ position:"relative", width:"100%" }}>
        {n < 2 ? (
          <div style={{ height:140, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12.5, color:T.textSm }}>Todavía no hay datos para este período.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }} role="img" aria-label={`${title} · ${tab.label}`}>
            {[0.25, 0.5, 0.75, 1].map(t => <line key={t} x1={PL} x2={W - PR} y1={Y(max * t)} y2={Y(max * t)} stroke={T.border} strokeWidth="1" strokeDasharray="3 4"/>)}
            {series.map((s, si) => (
              <g key={s.key}>
                {si === 0 && <path d={`${path(s.values)} L${X(n - 1)},${H - PB} L${X(0)},${H - PB} Z`} fill={s.color} fillOpacity="0.12"/>}
                <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"/>
              </g>
            ))}
            {hover != null && <line x1={X(hover)} x2={X(hover)} y1={PT} y2={H - PB} stroke={T.textSm} strokeWidth="1" strokeDasharray="2 3"/>}
            {hover != null && series.map(s => <circle key={s.key} cx={X(hover)} cy={Y(s.values[hover] || 0)} r="4" fill={s.color} stroke={T.card} strokeWidth="1.5"/>)}
            {labelIdx.map(i => (
              <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10.5" fill={T.textSm} fontFamily={F}>{fmtDate(dates[i])}</text>
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}
