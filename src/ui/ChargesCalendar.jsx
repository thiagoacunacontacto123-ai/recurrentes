// Calendario de próximos cobros — un año a la vista, mes por mes. Cada día con
// cobros muestra el monto que entra; al tocarlo se abre el detalle de ese día.
// Los cobros más allá del próximo de cada suscripción son proyectados (MP solo
// confirma el siguiente), así que se marcan como estimados.
import { useState, useMemo, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import { DS } from "./theme.js";

const MESES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const DIAS = ["L","M","M","J","V","S","D"];
const AR_OFFSET = 3 * 3600 * 1000; // UTC-3, sin horario de verano en AR
const NIVELES = [0.13, 0.24, 0.36, 0.5];  // verde del día más flojo al más fuerte

// Clave YYYY-MM-DD del día en zona Argentina (así un cobro de las 23:30 no se
// corre al día siguiente como haría toISOString() en UTC).
export const dayKeyAR = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t - AR_OFFSET).toISOString().slice(0, 10) : ""; };
export const hoyKeyAR = () => new Date(Date.now() - AR_OFFSET).toISOString().slice(0, 10);

const fmtMoneyShort = (n) => {
  const v = Math.round(Number(n) || 0);
  if (v >= 1000000) return "$" + (v / 1000000).toFixed(v >= 10000000 ? 0 : 1).replace(".0", "") + "M";
  if (v >= 1000) return "$" + Math.round(v / 1000) + "k";
  return "$" + v.toLocaleString("es-AR");
};

// Grilla de un mes: arranca en lunes, 6 semanas fijas para que no salte de alto.
function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month, 1));
  const lead = (first.getUTCDay() + 6) % 7; // lunes = 0
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(year, month, 1 - lead + i));
    cells.push({ key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month });
  }
  return cells;
}

export default function ChargesCalendar({ T, items = [], months = 12, fmtARS, onPickDay = null, loading = false }) {
  const hoy = hoyKeyAR();
  const [anchor] = useState(() => { const [y, m] = hoy.split("-"); return { y: +y, m: +m - 1 }; });
  const [open, setOpen] = useState(null); // clave del día abierto
  const scroller = useRef(null);

  // Cobros agrupados por día en zona AR.
  const byDay = useMemo(() => {
    const map = new Map();
    for (const u of items) {
      const k = dayKeyAR(u.next_charge_at);
      if (!k) continue;
      if (!map.has(k)) map.set(k, { items: [], total: 0 });
      const b = map.get(k); b.items.push(u); b.total += Number(u.amount_ars) || 0;
    }
    return map;
  }, [items]);

  // Con montos parecidos una escala lineal sobre el máximo pinta todos los días
  // igual. Se rankea cada día contra los demás (cuartiles) para que el verde
  // diga de verdad cuál es un día flojo y cuál es un día fuerte.
  const cortes = useMemo(() => {
    const t = [...byDay.values()].map(b => b.total).sort((a, b) => a - b);
    if (!t.length) return null;
    const q = (f) => t[Math.min(t.length - 1, Math.floor(f * t.length))];
    return [q(0.25), q(0.5), q(0.75)];
  }, [byDay]);
  // 4 niveles de verde, del día más flojo al más fuerte.
  const nivel = (total) => !cortes ? 0 : total <= cortes[0] ? 0 : total <= cortes[1] ? 1 : total <= cortes[2] ? 2 : 3;

  const meses = useMemo(() => {
    const out = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(Date.UTC(anchor.y, anchor.m + i, 1));
      const y = d.getUTCFullYear(), m = d.getUTCMonth();
      const cells = monthGrid(y, m);
      const total = cells.reduce((a, c) => a + (c.inMonth ? (byDay.get(c.key)?.total || 0) : 0), 0);
      const count = cells.reduce((a, c) => a + (c.inMonth ? (byDay.get(c.key)?.items.length || 0) : 0), 0);
      out.push({ y, m, cells, total, count });
    }
    return out;
  }, [anchor, months, byDay]);

  // Cierra el detalle con Escape.
  useEffect(() => {
    if (!open) return;
    const h = (e) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  const total = useMemo(() => items.reduce((a, u) => a + (Number(u.amount_ars) || 0), 0), [items]);
  const abierto = open ? byDay.get(open) : null;

  return (
    <div>
      <style>{`
        .rc-cal-scroll { display:grid; grid-template-columns:repeat(3, minmax(0,1fr)); gap:14px; }
        @media (max-width: 1080px) { .rc-cal-scroll { grid-template-columns:repeat(2, minmax(0,1fr)); } }
        /* En celular un mes ocupa el ancho entero: con 2 columnas la celda queda
           de ~18px y el monto del día se pisa con el del día de al lado. */
        @media (max-width: 760px) { .rc-cal-scroll { grid-template-columns:1fr; gap:12px; } }
        .rc-cal-cell { position:relative; border-radius:8px; border:1px solid transparent; padding:3px 1px 2px; min-height:38px; display:flex; flex-direction:column; align-items:center; justify-content:flex-start; gap:1px; background:transparent; font:inherit; cursor:default; overflow:hidden; transition:border-color .12s ease, transform .12s ease; }
        .rc-cal-amount { max-width:100%; overflow:hidden; text-overflow:ellipsis; }
        .rc-cal-count { font-size:8px; line-height:1; }
        /* A 375px no entran 7 montos por fila (quedaban en "$…"): el monto sale
           y la celda queda como mapa de calor. El monto exacto se lee tocando
           el día, y el total de cada mes sigue al pie del mes. */
        @media (max-width: 760px) {
          .rc-cal-cell { min-height:40px; padding:5px 1px 4px; justify-content:center; gap:3px; }
          .rc-cal-amount { display:none; }
          .rc-cal-count { display:none; }
        }
        .rc-cal-cell[data-hit="1"] { cursor:pointer; }
        .rc-cal-cell[data-hit="1"]:hover { transform:translateY(-1px); }
        .rc-cal-cell:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
      `}</style>

      <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginBottom:12 }}>
        <div style={{ fontSize:DS.font.sm, color:T.textSm }}>
          Próximos 12 meses · <strong style={{ color:T.textMd, fontWeight:DS.w.bold }}>{items.length.toLocaleString("es-AR")}</strong> cobro{items.length === 1 ? "" : "s"}
        </div>
        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.black, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(total)}</div>
      </div>

      <div className="rc-cal-scroll" ref={scroller}>
        {meses.map(({ y, m, cells, total: mt, count }) => (
          <div key={`${y}-${m}`} style={{ background:T.card, border:`1px solid ${T.border}`, borderRadius:14, padding:"11px 11px 9px", opacity: loading ? 0.6 : 1 }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:6, marginBottom:8 }}>
              <div style={{ fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text, textTransform:"capitalize" }}>
                {MESES[m]} <span style={{ color:T.textSm, fontWeight:DS.w.medium }}>{y}</span>
              </div>
              <div style={{ fontSize:DS.font.xs, fontWeight:DS.w.bold, color: mt ? T.accent : T.textSm, fontVariantNumeric:"tabular-nums" }}>
                {mt ? fmtMoneyShort(mt) : "—"}
              </div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7, minmax(0,1fr))", gap:2, marginBottom:3 }}>
              {DIAS.map((d, i) => (
                <div key={i} style={{ textAlign:"center", fontSize:9, fontWeight:DS.w.bold, letterSpacing:"0.06em", color:T.textSm, paddingBottom:2 }}>{d}</div>
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(7, minmax(0,1fr))", gap:2 }}>
              {cells.map((c, i) => {
                if (!c.inMonth) return <div key={i} style={{ minHeight:38 }}/>;
                const b = byDay.get(c.key);
                const esHoy = c.key === hoy;
                const hit = !!b;
                const w = b ? NIVELES[nivel(b.total)] : 0;
                return (
                  <button key={i} className="rc-cal-cell" data-hit={hit ? "1" : "0"} type="button"
                    onClick={hit ? () => setOpen(c.key) : undefined} tabIndex={hit ? 0 : -1}
                    aria-label={hit ? `${c.day} de ${MESES[m]}: ${fmtARS(b.total)} en ${b.items.length} cobro${b.items.length === 1 ? "" : "s"}` : undefined}
                    style={{
                      background: b ? (T.isDark ? `rgba(16,185,129,${w})` : `rgba(5,150,105,${w * 0.8})`) : "transparent",
                      borderColor: esHoy ? T.accent : (b ? (T.isDark ? "rgba(52,211,153,0.28)" : "rgba(5,150,105,0.22)") : "transparent"),
                    }}>
                    <span style={{ fontSize:10, lineHeight:1, fontWeight: esHoy ? DS.w.black : (b ? DS.w.bold : DS.w.medium), color: esHoy ? T.accent : (b ? T.text : T.textSm), fontVariantNumeric:"tabular-nums" }}>{c.day}</span>
                    {b && <span className="rc-cal-amount" style={{ fontSize:9, lineHeight:1.1, fontWeight:DS.w.bold, color: T.isDark ? T.accent : T.green, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>{fmtMoneyShort(b.total)}</span>}
                    {b && b.items.length > 1 && <span className="rc-cal-count" style={{ color:T.textSm }}>{b.items.length}</span>}
                  </button>
                );
              })}
            </div>
            {count > 0 && (
              <div style={{ marginTop:7, paddingTop:6, borderTop:`1px solid ${T.borderL}`, fontSize:DS.font.xs, color:T.textSm, display:"flex", justifyContent:"space-between" }}>
                <span>{count} cobro{count === 1 ? "" : "s"}</span>
                <span style={{ fontVariantNumeric:"tabular-nums" }}>{fmtARS(mt)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", marginTop:12, fontSize:DS.font.xs, color:T.textSm }}>
        <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
          <span style={{ display:"inline-flex", gap:2 }}>
            {NIVELES.map((o, i) => (
              <span key={i} style={{ width:11, height:11, borderRadius:3, background: T.isDark ? `rgba(16,185,129,${o})` : `rgba(5,150,105,${o * 0.8})`, border:`1px solid ${T.isDark ? "rgba(52,211,153,0.28)" : "rgba(5,150,105,0.22)"}` }}/>
            ))}
          </span>
          menos → más plata en el día
        </span>
        <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
          <span style={{ width:11, height:11, borderRadius:3, border:`1px solid ${T.accent}` }}/> hoy
        </span>
      </div>

      {/* El desglose va por portal al body: dentro de la página (que anima con
          transform) un position:fixed queda relativo a la página y aparece abajo,
          no en el medio de lo que la persona está viendo (Thiago, 19-sept). */}
      {abierto && ReactDOM.createPortal(
        <>
          <div onClick={() => setOpen(null)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.5)", zIndex:2000 }}/>
          <div role="dialog" aria-modal="true" aria-label={`Cobros del ${open}`}
            style={{ position:"fixed", zIndex:2001, left:"50%", top:"50%", transform:"translate(-50%,-50%)", width:"min(520px, calc(100vw - 28px))", maxHeight:"min(76vh, 620px)", overflowY:"auto", background:T.card, border:`1px solid ${T.border}`, borderRadius:16, boxShadow:"0 18px 50px rgba(0,0,0,0.45)", padding:16 }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:10, marginBottom:12 }}>
              <div>
                <div style={{ fontSize:DS.font.base, fontWeight:DS.w.black, color:T.text }}>
                  {(() => { const [y, m, d] = open.split("-"); return `${+d} de ${MESES[+m - 1]} de ${y}`; })()}
                </div>
                <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{abierto.items.length} cobro{abierto.items.length === 1 ? "" : "s"} programado{abierto.items.length === 1 ? "" : "s"}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.black, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(abierto.total)}</div>
                <button type="button" onClick={() => setOpen(null)} style={{ marginTop:4, background:"transparent", border:"none", color:T.textSm, cursor:"pointer", fontSize:DS.font.sm, padding:0 }}>Cerrar ✕</button>
              </div>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:1 }}>
              {abierto.items.map((u, i) => (
                <div key={(u.subscriber_id || "u") + "-" + i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"9px 2px", borderBottom: i < abierto.items.length - 1 ? `1px solid ${T.borderL}` : "none" }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{u.name || u.email || "—"}</div>
                    <div style={{ fontSize:DS.font.xs, color:T.textSm, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {u.plan_title || "—"}{u.projected ? " · estimado" : ""}
                    </div>
                  </div>
                  <div style={{ fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>{fmtARS(u.amount_ars)}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12, fontSize:DS.font.xs, color:T.textSm, lineHeight:1.45 }}>
              El primer cobro de cada suscripción lo confirma Mercado Pago; los siguientes se estiman con la frecuencia del plan y pueden moverse 1-2 días.
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
