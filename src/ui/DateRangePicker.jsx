import React from "react";
import ReactDOM from "react-dom";
import { DS } from "./theme.js";

// Selector de período — mismo calendario que Growith, con los colores de Recurrentes.
// Trigger tipo píldora con el nombre del preset o el rango; dropdown en portal con
// atajos + calendario (semana Lu→Do, futuro deshabilitado, rango con vista previa).
// Fechas "YYYY-MM-DD" en zona Argentina. En mobile es un bottom sheet.
const F = "'Inter',system-ui,sans-serif";
export const fmtAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
export const hoyAR = () => fmtAR(new Date());
export const diasAtras = (n) => fmtAR(new Date(Date.now() - n * 86400000));
const mesAR = (offset) => { const h = new Date(hoyAR() + "T12:00:00"); return new Date(h.getFullYear(), h.getMonth() + offset, 1); };
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Presets estándar: "Últimos N días" INCLUYE hoy (N-1 hacia atrás).
export const PRESETS_DIAS = [
  { id: "today", label: "Hoy", days: 0 },
  { id: "yest", label: "Ayer", days: -1 },
  { id: "7d", label: "Últimos 7 días", short: "7 días", days: 7 },
  { id: "14d", label: "Últimos 14 días", short: "14 días", days: 14 },
  { id: "30d", label: "Últimos 30 días", short: "30 días", days: 30 },
  { id: "90d", label: "Últimos 90 días", short: "90 días", days: 90 },
  { id: "mes", label: "Este mes", range: () => [ymd(mesAR(0)), hoyAR()] },
  { id: "mes-1", label: "Mes pasado", range: () => { const a = mesAR(-1), b = mesAR(0); b.setDate(0); return [ymd(a), ymd(b)]; } },
];
// Presets para vistas mensuales (Analíticas).
export const PRESETS_MESES = [
  { id: "3m", label: "Últimos 3 meses", short: "3 meses", range: () => [ymd(mesAR(-2)), hoyAR()] },
  { id: "6m", label: "Últimos 6 meses", short: "6 meses", range: () => [ymd(mesAR(-5)), hoyAR()] },
  { id: "12m", label: "Últimos 12 meses", short: "12 meses", range: () => [ymd(mesAR(-11)), hoyAR()] },
  { id: "anio", label: "Este año", range: () => { const h = new Date(hoyAR() + "T12:00:00"); return [`${h.getFullYear()}-01-01`, hoyAR()]; } },
  { id: "anio-1", label: "Año pasado", range: () => { const y = new Date(hoyAR() + "T12:00:00").getFullYear() - 1; return [`${y}-01-01`, `${y}-12-31`]; } },
  { id: "24m", label: "Últimos 24 meses", short: "24 meses", range: () => [ymd(mesAR(-23)), hoyAR()] },
];
export function rangoDePreset(p) {
  if (p.range) return p.range();
  const hoy = hoyAR();
  if (p.days === 0) return [hoy, hoy];
  if (p.days === -1) { const y = diasAtras(1); return [y, y]; }
  return [diasAtras(Math.max(0, p.days - 1)), hoy];
}

export default function DateRangePicker({ T, since, until, onChange, presets, labelText, align = "right" }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top: 0, right: 10, left: 10 });
  const wrapRef = React.useRef(null);
  const ddRef = React.useRef(null);
  const [tmpStart, setTmpStart] = React.useState(null);
  const [hoverDay, setHoverDay] = React.useState(null);
  const initialMonth = (() => { const d = since ? new Date(since + "T00:00:00") : new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); })();
  const [viewMonth, setViewMonth] = React.useState(initialMonth);
  const toggleOpen = () => setOpen(o => {
    const n = !o;
    if (n && wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect();
      const w = Math.min(340, window.innerWidth - 20);
      setPos({ top: r.bottom + 6, right: Math.max(10, Math.min(window.innerWidth - r.right, window.innerWidth - w - 10)), left: Math.max(10, Math.min(r.left, window.innerWidth - w - 10)) });
      const base = until || since;
      if (base) { const d = new Date(base + "T00:00:00"); if (!isNaN(d)) setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1)); }
      setTmpStart(null); setHoverDay(null);
    }
    return n;
  });
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target) && !(ddRef.current && ddRef.current.contains(e.target))) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const PRESETS = presets || PRESETS_DIAS;
  function applyPreset(p) { const [s, u] = rangoDePreset(p); onChange(s, u, p.id); setOpen(false); }
  function presetActivo(p) { if (!since || !until) return false; try { const [s, u] = rangoDePreset(p); return s === since && u === until; } catch (_) { return false; } }
  function clickDay(str) {
    if (!tmpStart) { setTmpStart(str); return; }
    let s = tmpStart, u = str; if (s > u) [s, u] = [u, s];
    onChange(s, u, null); setTmpStart(null); setHoverDay(null); setOpen(false);
  }
  // Grilla del mes (Lu..Do)
  const year = viewMonth.getFullYear(), month = viewMonth.getMonth();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push({ y: year, m: month - 1, d: daysInPrev - firstDow + 1 + i, out: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ y: year, m: month, d, out: false });
  let nd = 1; while (cells.length % 7 !== 0 || cells.length < 42) { cells.push({ y: year, m: month + 1, d: nd++, out: true }); if (cells.length >= 42) break; }
  const fmtCell = (c) => { const y = c.m < 0 ? c.y - 1 : c.m > 11 ? c.y + 1 : c.y; const m = ((c.m % 12) + 12) % 12; return `${y}-${String(m + 1).padStart(2, "0")}-${String(c.d).padStart(2, "0")}`; };
  const hoyStr = hoyAR();
  const monthName = viewMonth.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const compacto = typeof window !== "undefined" && window.innerWidth < 640;
  const fmtNum = (s) => { const d = new Date(s + "T00:00:00"); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const presetLabel = (!compacto && PRESETS.find(p => presetActivo(p))?.label) || null;
  const label = labelText || (since && until
    ? (compacto ? (since === until ? fmtNum(since) : `${fmtNum(since)} – ${fmtNum(until)}`)
      : presetLabel || (since === until
        ? new Date(since + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })
        : `${new Date(since + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" })} – ${new Date(until + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric" })}`))
    : "Período");
  const btn = { background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: DS.r.md, padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: F };
  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block", fontFamily: F, flexShrink: 0 }}>
      <button type="button" onClick={toggleOpen} aria-haspopup="dialog" aria-expanded={open} title={since && until ? `${new Date(since + "T00:00:00").toLocaleDateString("es-AR")} — ${new Date(until + "T00:00:00").toLocaleDateString("es-AR")}` : "Elegir período"}
        style={{ display: "inline-flex", alignItems: "center", gap: compacto ? 6 : 8, height: 34, padding: compacto ? "0 12px" : "0 14px", boxSizing: "border-box", background: T.bg, border: `1px solid ${open ? T.accentSolid + "88" : T.border}`, borderRadius: 99, fontSize: 12, fontWeight: 600, color: T.text, cursor: "pointer", fontFamily: F, whiteSpace: "nowrap" }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textSm} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>{label}</span> <span style={{ color: T.textSm, fontSize: 10 }}>▾</span>
      </button>
      {open && ReactDOM.createPortal((() => {
        const esMobile = typeof window !== "undefined" && window.innerWidth < 640;
        const sheet = esMobile
          ? { position: "fixed", left: 10, right: 10, bottom: 10, zIndex: 1000, background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16, boxShadow: "0 -10px 44px rgba(0,0,0,0.45)", boxSizing: "border-box", maxHeight: "78vh", overflowY: "auto" }
          : { position: "fixed", top: pos.top, ...(align === "left" ? { left: pos.left } : { right: pos.right }), zIndex: 1000, background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, boxShadow: "0 14px 40px rgba(0,0,0,0.35)", width: "min(340px,calc(100vw - 20px))", boxSizing: "border-box", maxHeight: "calc(100vh - 120px)", overflowY: "auto" };
        return (<>
          {esMobile && <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,0.45)" }}/>}
          <div ref={ddRef} role="dialog" aria-label="Elegir período" style={sheet}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${esMobile ? 2 : 3}, 1fr)`, gap: esMobile ? 8 : 6, marginBottom: 10 }}>
              {PRESETS.map(p => { const act = presetActivo(p); return (
                <button key={p.id} type="button" onClick={() => applyPreset(p)} style={{ padding: esMobile ? "10px 10px" : "6px 10px", fontSize: esMobile ? 12 : 11, fontWeight: act ? 700 : 500, border: `1px solid ${act ? T.accentSolid : T.border}`, borderRadius: 8, background: act ? T.accentSolid + "1c" : T.surface, color: act ? T.accent : T.textMd, cursor: "pointer", fontFamily: F, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.label}>{p.short || p.label}</button>
              ); })}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <button type="button" aria-label="Mes anterior" onClick={() => setViewMonth(new Date(year, month - 1, 1))} style={btn}>‹</button>
              <span style={{ fontSize: 13, fontWeight: 700, color: T.text, textTransform: "capitalize" }}>{monthName}</span>
              <button type="button" aria-label="Mes siguiente" onClick={() => setViewMonth(new Date(year, month + 1, 1))} style={btn}>›</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
              {["Lu", "Ma", "Mi", "Ju", "Vi", "Sa", "Do"].map(d => <div key={d} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: T.textSm, letterSpacing: 0.3, padding: 4 }}>{d}</div>)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
              {cells.map((c, i) => {
                const str = fmtCell(c);
                const isToday = str === hoyStr;
                const isStart = str === since, isEnd = str === until;
                const isPreview = tmpStart && hoverDay && ((str >= tmpStart && str <= hoverDay) || (str >= hoverDay && str <= tmpStart));
                const isInRange = !tmpStart && since && until && str >= since && str <= until;
                const isTmp = tmpStart && str === tmpStart;
                const dis = c.out || str > hoyStr;
                const sel = isStart || isEnd || isTmp;
                return (
                  <button key={i} type="button" disabled={dis} onClick={() => !dis && clickDay(str)} onMouseEnter={() => { if (!dis && tmpStart) setHoverDay(str); }}
                    style={{ padding: esMobile ? "10px 0" : "7px 0", fontSize: esMobile ? 13 : 12, borderRadius: 6, border: isToday ? `1px solid ${T.accentSolid}66` : "1px solid transparent",
                      background: sel ? T.accentSolid : (isInRange || isPreview) ? T.accentSolid + "22" : "transparent", color: sel ? "#fff" : T.text, cursor: dis ? "default" : "pointer",
                      fontWeight: sel ? 700 : 500, fontFamily: F, opacity: dis ? 0.3 : 1 }}>{c.d}</button>
                );
              })}
            </div>
            {tmpStart && <div style={{ marginTop: 8, padding: "6px 10px", background: T.accentSolid + "15", border: `1px solid ${T.accentSolid}33`, borderRadius: 7, fontSize: 11, color: T.textMd }}>Inicio: {new Date(tmpStart + "T00:00:00").toLocaleDateString("es-AR")} — elegí la fecha final</div>}
          </div>
        </>);
      })(), document.body)}
    </div>
  );
}
