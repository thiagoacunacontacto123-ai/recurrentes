import React from "react";
import ReactDOM from "react-dom";
import { DS } from "../ui/theme.js";
import { toast } from "../ui/components.jsx";

export const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
export const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
export const fmtDateShort = (iso) => { try { return new Date(iso).toLocaleString("es-AR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" }); } catch (_) { return "—"; } };
export const fmtDateOnly = (iso) => { try { return new Date(iso).toLocaleDateString("es-AR"); } catch (_) { return "—"; } };
export const fmtDateTime = (iso) => { try { return new Date(iso).toLocaleString("es-AR"); } catch (_) { return "—"; } };
export const fmtDayMonth = (iso) => { try { return new Date(iso).toLocaleDateString("es-AR", { day:"2-digit", month:"short" }); } catch (_) { return "—"; } };
export const fmtPct = (n, d = 1) => (typeof n === "number" && isFinite(n) ? `${n.toFixed(d).replace(/\.0$/, "")}%` : "—");

// "hace 3 h" / "hace 2 días" — para "Última actividad".
export function fmtAgo(iso) {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (!isFinite(ms)) return "—";
    const m = Math.round(ms / 60000);
    if (m < 1) return "recién";
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  } catch (_) { return "—"; }
}

// Frecuencia legible: 7 → "semanal", 30 → "mensual", otro → "cada N días".
export function fmtFreq(days) {
  const d = Number(days) || 0;
  if (!d) return "—";
  if (d === 7) return "semanal";
  if (d === 14 || d === 15) return "quincenal";
  if (d === 30) return "mensual";
  if (d === 60) return "bimestral";
  if (d === 90) return "trimestral";
  if (d === 180) return "semestral";
  if (d === 365) return "anual";
  return `cada ${d} días`;
}

// ─── Links externos ────────────────────────────────────────────────────
export const portalUrl = (sub) => sub?.portal_token ? `${window.location.origin}/#/portal?token=${encodeURIComponent(sub.portal_token)}` : null;
export const mpPaymentUrl = (paymentId) => paymentId ? `https://www.mercadopago.com.ar/activities/detail/${encodeURIComponent(paymentId)}` : null;
export const mpPreapprovalUrl = (preapprovalId) => preapprovalId ? `https://www.mercadopago.com.ar/subscriptions/${encodeURIComponent(preapprovalId)}` : null;
// Cobros sin tienda (servicios, link de pago) guardan un comprobante interno
// "rec_<payment_id>" en lugar del id de orden: no hay orden a la que linkear.
export const isInternalOrderId = (orderId) => String(orderId || "").startsWith("rec_");
export const shopifyOrderUrl = (shop, orderId) => (shop && orderId && !isInternalOrderId(orderId)) ? `https://${shop}/admin/orders/${orderId}` : null;
// Texto corto para mostrar el id de orden / comprobante en tablas y avisos.
export const orderLabel = (orderId) => !orderId ? "—" : isInternalOrderId(orderId) ? "Cobro registrado" : `#${orderId}`;

export async function copyText(text, okMsg = "Copiado") {
  if (!text) return toast("Nada para copiar", "warning");
  try { await navigator.clipboard.writeText(String(text)); toast(okMsg, "success"); }
  catch (_) { toast("No se pudo copiar", "warning"); }
}

// Descarga un CSV armado en el cliente. rows: array de arrays.
export function downloadCsv(filename, header, rows) {
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [header, ...rows].map(r => r.map(esc).join(","));
  const blob = new Blob(["﻿" + lines.join("\n")], { type:"text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Query string del hash actual (#/dashboard/x?status=unpaid → {status:"unpaid"}).
export function hashQuery() {
  try { return new URLSearchParams((window.location.hash.split("?")[1]) || ""); } catch (_) { return new URLSearchParams(); }
}

// Panel gris (surface) para agrupar datos de solo lectura.
export function SurfaceBox({ T, title, right, children, style = {} }) {
  return (
    <div style={{ background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px", ...style }}>
      {(title || right) && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:8 }}>
          <div style={{ fontSize:DS.font.xs, color:T.textSm, textTransform:"uppercase", fontWeight:DS.w.bold, letterSpacing:0.5 }}>{title}</div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Fila "etiqueta · valor" para las cajas de la ficha.
export function KV({ T, k, v, mono }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", gap:12, padding:"5px 0", borderTop:`1px solid ${T.borderL}`, fontSize:DS.font.md }}>
      <span style={{ color:T.textSm, flexShrink:0 }}>{k}</span>
      <span style={{ color:T.text, textAlign:"right", minWidth:0, overflow:"hidden", textOverflow:"ellipsis", fontFamily: mono ? MONO : undefined, fontSize: mono ? DS.font.sm : undefined }}>{v ?? "—"}</span>
    </div>
  );
}

// Link externo chico con flecha.
export function ExtLink({ T, href, children, style = {} }) {
  if (!href) return <span style={{ color:T.textSm }}>{children}</span>;
  return <a href={href} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color:T.accent, fontWeight:DS.w.semibold, textDecoration:"none", whiteSpace:"nowrap", ...style }}>{children} ↗</a>;
}

// ─── Menú ⋮ de acciones por fila (portal, se cierra con click afuera/Esc) ──
//   items: [{ label, onClick, danger, disabled, hidden }]
export function RowMenu({ T, items = [], label = "Acciones" }) {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ top:0, left:0 });
  const btnRef = React.useRef(null);
  const ddRef = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (btnRef.current?.contains(e.target) || ddRef.current?.contains(e.target)) return; setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc); document.addEventListener("keydown", onKey); window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);
  const visible = items.filter(i => i && !i.hidden);
  if (visible.length === 0) return null;
  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      const w = 220;
      setPos({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), w });
    }
    setOpen(o => !o);
  };
  return (
    <>
      <button ref={btnRef} onClick={toggle} title={label} aria-label={label}
        style={{ width:30, height:30, borderRadius:DS.r.md, border:`1px solid ${open ? T.accent : T.border}`, background: open ? T.accent + "14" : "transparent", color: open ? T.accent : T.textMd, cursor:"pointer", fontSize:16, lineHeight:1, display:"inline-flex", alignItems:"center", justifyContent:"center", padding:0, fontWeight:700 }}>⋮</button>
      {open && ReactDOM.createPortal(
        <div ref={ddRef} className="gh-dropdown" onClick={e => e.stopPropagation()} style={{ position:"fixed", top:pos.top, left:pos.left, width:pos.w, zIndex:1300, background:T.card, border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:4, boxShadow:"0 12px 32px rgba(0,0,0,.35)", fontFamily:"'Inter',system-ui,sans-serif" }}>
          {visible.map((it, i) => (
            <button key={i} disabled={it.disabled} onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick?.(); }}
              style={{ display:"flex", alignItems:"center", gap:8, width:"100%", padding:"8px 10px", background:"transparent", border:"none", borderRadius:DS.r.md, cursor: it.disabled ? "default" : "pointer", textAlign:"left", fontSize:DS.font.md, color: it.danger ? T.red : T.text, fontWeight:DS.w.medium, opacity: it.disabled ? 0.5 : 1, fontFamily:"inherit" }}
              onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = it.danger ? T.red + "14" : T.surface; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>
              {it.icon && <span style={{ width:16, textAlign:"center", opacity:0.85 }}>{it.icon}</span>}
              <span style={{ flex:1 }}>{it.label}</span>
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Semanas para agrupar próximos cobros ──────────────────────────────
// Devuelve índice de semana (0 = esta, 1 = próxima…) y etiqueta.
export function weekBucket(iso) {
  const d = new Date(iso); if (!isFinite(d)) return { idx: 99, label: "Sin fecha" };
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  const idx = days < 0 ? 0 : Math.floor(days / 7);
  const label = idx === 0 ? "Esta semana" : idx === 1 ? "Próxima semana" : idx < 5 ? `En ${idx} semanas` : "Más adelante";
  return { idx: Math.min(idx, 5), label };
}
