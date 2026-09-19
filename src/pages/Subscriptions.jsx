import React, { useState, useEffect, useMemo } from "react";
import { useTabRefresh } from "../lib/tabs.js";
import { apiGet, apiPost, apiPatch, apiDelete, apiSend } from "../lib/api.js";
import { auth } from "../lib/firebase.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, BtnSecondary, DSBadge, Modal, Field, InputStyle, Spinner, DSTable, CellStack, PageHeader, SubTabs, Hint, Loading, appConfirm, appAlert, appPrompt, toast } from "../ui/components.jsx";
import { KpiCard, Segmented } from "../ui/charts.jsx";
import { OnbEmpty } from "./Onboarding.jsx";
import { TIPS } from "../lib/onboarding.js";
import { MONO, fmtARS, fmtDateShort, fmtDateOnly, fmtDateTime, fmtDayMonth, fmtAgo, fmtFreq, SurfaceBox, KV, ExtLink, RowMenu, portalUrl, mpPaymentUrl, mpPreapprovalUrl, shopifyOrderUrl, orderLabel, copyText, hashQuery } from "./_shared.jsx";

// Estado de una suscripción → color del DS.
function subStatusMeta(T, status, orderCount = 0) {
  const cancelledLabel = orderCount > 0 ? `Cancelada · ${orderCount} cobro${orderCount > 1 ? "s" : ""} OK` : "Cancelada";
  return ({
    active:         { label:"Activa",        color:T.green },
    paused:         { label:"Pausada",       color:T.yellow },
    pending:        { label:"Sin pagar",     color:T.blue },
    cancelled:      { label:cancelledLabel,  color:orderCount > 0 ? T.green : T.textSm },
    payment_failed: { label:"Pago fallido",  color:T.red },
  })[status] || { label: status || "—", color: T.textSm };
}

export function StatusBadge({ status, orderCount = 0, size = "sm" }) {
  const T = useT();
  const m = subStatusMeta(T, status, orderCount);
  return <DSBadge T={T} color={m.color} size={size}>{m.label}</DSBadge>;
}

// Monto por cobro y cantidad, tolerante a snapshots viejos.
function subAmounts(s) {
  const plan = s?.plan_snapshot || {};
  const qty = s?.quantity || plan.units_per_shipment || 1;
  const unit = plan.subscription_price_ars || 0;
  const total = plan.total_per_charge_ars || (unit * qty);
  return { plan, qty, unit, total };
}

// ═══════════════════════════════════════════════════════════════════
// Acciones sobre un suscriptor — UNA sola implementación que usan el menú ⋮
// de la tabla y la ficha. Mismas llamadas a la API que siempre.
//   ctx: { setBusy(actionId|null), refresh(), onClose() }
// ═══════════════════════════════════════════════════════════════════
export async function performSubAction(sub, action, ctx = {}) {
  const setBusy = ctx.setBusy || (() => {});
  const refresh = ctx.refresh || (async () => {});
  const onClose = ctx.onClose || (() => {});
  const { total } = subAmounts(sub);

  if (action === "portal-link") {
    const url = portalUrl(sub);
    if (!url) return toast("Este suscriptor todavía no tiene link de portal (se genera al activarse).", "warning", 5000);
    return copyText(url, "Link del portal copiado");
  }
  if (action === "delete") {
    const ok = await appConfirm(
      `Esto elimina el subscriber + todos sus charges de Firestore.\n` +
      `Intenta cancelar en MP (si todavía está activo); si MP da error lo ignora.\n\n` +
      `NO se puede deshacer.`,
      { title:"⚠️ ¿Borrar definitivamente este subscriber?", danger:true, okLabel:"Borrar definitivamente" }
    );
    if (!ok) return;
    setBusy("delete");
    try {
      const r = await apiDelete("subscribers", { id: sub.id });
      if (r?.error) { toast("Error: " + r.error, "error", 6000); setBusy(null); }
      else { toast(`Subscriber borrado · ${r.charges_deleted || 0} charges asociados eliminados`, "success", 5000); onClose(); }
    } catch (e) { toast("Error: " + e.message, "error"); setBusy(null); }
    return;
  }
  if (action === "reprice") {
    const v = await appPrompt(`Hoy paga ${fmtARS(total)}. Se actualiza en Mercado Pago y aplica desde el próximo cobro.`, String(total || ""), { title:"Nuevo monto TOTAL por cobro para este suscriptor", placeholder:"Monto en $", okLabel:"Repreciar" });
    if (v === null) return;
    const amount = Math.round(Number(v));
    if (!(amount > 0)) return toast("Monto inválido", "warning");
    setBusy("reprice");
    try {
      const d = await apiPost("subscribers", { id: sub.id, new_amount: amount }, { action: "reprice" });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.failed?.length) toast("No se pudo repreciar: " + d.failed[0].error, "error", 6000);
      else toast(`Repreciado a ${fmtARS(amount)} por cobro`, "success");
      await refresh();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (action === "simulate-charge") {
    const ok = await appConfirm("Va a crear una orden Shopify nueva como si MP hubiera cobrado el siguiente mes, SIN cobrar plata real. Solo para testear que el flow de cobros recurrentes funciona.", { title:"¿Simular el próximo cobro recurrente?", okLabel:"Simular" });
    if (!ok) return;
    setBusy("simulate-charge");
    try {
      const d = await apiPost("subscribers", {}, { action: "simulate-charge", id: sub.id });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.status === "ok") await appAlert(`Cobro #${d.charge_number}\nOrden Shopify: #${d.shopify_order_id}\nMonto: ${fmtARS(d.amount_ars)}`, { title:"✓ Cobro simulado" });
      else toast(`Falló: ${d.shopify_error || d.error || "desconocido"}`, "error", 7000);
      await refresh();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (action === "link-payment") {
    const paymentId = await appPrompt(
      "Lo ves en mercadopago.com.ar → Actividad → click sobre el cobro de este cliente.\n\nEsto crea la orden Shopify usando ese payment_id específico (escape hatch para cuando MP no nos devuelve el payment por search).",
      "", { title:"Pegá el ID del pago de MP (N.° de operación)", placeholder:"1234567890", okLabel:"Linkear" }
    );
    if (!paymentId || !paymentId.trim()) return;
    setBusy("link-payment");
    try {
      const d = await apiPost("subscribers", { payment_id: paymentId.trim() }, { action: "link-payment", id: sub.id });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.status === "linked") await appAlert(`Payment ${paymentId} linkeado.\nOrden Shopify: #${d.shopify_order_id || "(error)"}\nMonto: ${fmtARS(d.amount_ars)}` + (d.shopify_error ? `\n\n⚠️ Shopify: ${d.shopify_error}` : ""), { title:"✓ Payment linkeado" });
      else if (d.status === "already_linked") await appAlert(`Este payment ya estaba linkeado.\nOrden Shopify: #${d.shopify_order_id}`, { title:"Ya estaba linkeado" });
      else await appAlert(`Resultado: ${d.status || "?"}\n${d.error || ""}`, { title:"Resultado" });
      await refresh();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (action === "retry-order") {
    const paymentId = ctx.paymentId;
    if (!paymentId) return toast("Este cobro no tiene payment_id asociado.", "warning");
    const ok = await appConfirm("Se vuelve a intentar crear la orden con el mismo payment_id.", { title:`¿Reintentar la orden Shopify del cobro MP ${paymentId}?`, okLabel:"Reintentar" });
    if (!ok) return;
    setBusy("retry-order");
    try {
      const d = await apiPost("subscribers", { id: sub.id, payment_id: String(paymentId) }, { action: "retry-order" });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else if (d.shopify_order_id) toast(`Orden Shopify #${d.shopify_order_id} creada`, "success");
      else toast(`No se pudo crear la orden: ${d.shopify_error || d.error || d.status || "sin detalle"}`, "error", 7000);
      await refresh();
    } catch (e) { toast("Error: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (action === "sync") {
    // Escape hatch: forzar lookup en MP para subs que quedaron pending
    // porque el webhook MP no llegó. NO debería usarse en operación normal.
    setBusy("sync");
    try {
      const d = await apiPost("subscribers", {}, { action: "sync", id: sub.id });
      if (d?.error) toast("Error: " + d.error, "error", 6000);
      else {
        let msg = "Estado del subscriber: " + (d.status || "?").toUpperCase();
        msg += `\nPreapproval MP: ${d.mp_preapproval_status || "?"}`;
        msg += `\nPayments encontrados: ${d.payments_found ?? 0} (${d.payments_approved ?? 0} aprobados)`;
        if (d.charges_processed > 0 && d.shopify_order_id) msg += `\n\n✓ Orden Shopify creada: #${d.shopify_order_id}`;
        else if (d.charges_processed > 0) msg += `\n\n⚠ Se procesaron ${d.charges_processed} cobros pero la orden Shopify NO se pudo crear.`;
        else if (d.forced_charge) msg += "\n\n🚀 Forzamos a MP a cobrar AHORA. Esperá 1-3 min y volvé a sincronizar — el payment debería aparecer y se va a crear la orden Shopify automáticamente.";
        else if (d.payments_approved === 0 && d.status === "pending") msg += "\n\nMP todavía NO procesó el primer cobro. Esto a veces tarda 5-30 min después de pagar. Esperá y reintentá.";
        else if (d.status === "active") msg += "\n\n(sin cambios — todo procesado previamente)";
        if (d.shopify_errors && d.shopify_errors.length > 0) msg += "\n\n⚠️ Errores Shopify:\n" + d.shopify_errors.join("\n");
        await appAlert(msg, { title:"Sincronización con MP" });
      }
      await refresh();
    } catch (e) { toast("Error de red: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (action === "resync") {
    // "Marcar como activa": fuerza local → active y best-effort linkea el
    // preapproval activo de MP.
    setBusy("resync");
    try {
      const r = await apiPatch("subscribers", { action: "resync" }, { id: sub.id });
      if (r?.error) toast("Error: " + r.error, "error", 6000);
      else {
        let msg = "";
        if (r.mp_preapproval_linked) {
          msg += `Linkeada al preapproval MP: ${r.mp_preapproval_id}`;
          if (r.next_charge_at) msg += `\nPróximo cobro: ${new Date(r.next_charge_at).toLocaleString("es-AR")}`;
        } else {
          msg += "No encontramos preapproval activo en MP via search, pero igual está activa localmente. Cuando MP cobre el próximo mes, el webhook va a llegar con external_reference y va a crear la orden Shopify normal.";
        }
        await appAlert(msg, { title:"✓ Sub marcada como ACTIVA" });
        await refresh();
      }
    } catch (e) { toast("Error de red: " + e.message, "error"); }
    finally { setBusy(null); }
    return;
  }
  if (!["pause", "resume", "cancel"].includes(action)) return;
  const ok = await appConfirm({
    pause: "No se cobra más hasta reactivar.",
    resume: "Vuelve a cobrarse en la próxima fecha.",
    cancel: "No se puede deshacer.",
  }[action], {
    title: { pause:"¿Pausar esta suscripción?", resume:"¿Reactivar esta suscripción?", cancel:"¿Cancelar definitivamente esta suscripción?" }[action],
    danger: action === "cancel",
    okLabel: { pause:"Pausar", resume:"Reactivar", cancel:"Sí, cancelar" }[action],
  });
  if (!ok) return;
  setBusy(action);
  const r = await apiPatch("subscribers", { action }, { id: sub.id });
  setBusy(null);
  if (r?.error) toast("Error: " + r.error, "error", 6000);
  else {
    toast({ pause:"Suscripción pausada", resume:"Suscripción reactivada", cancel:"Suscripción cancelada" }[action], action === "cancel" ? "warning" : "success");
    await refresh();
  }
}

// ═══════════════════════════════════════════════════════════════════
// Página: Suscripciones — estilo Growith (Envíos): KPIs con sparkline arriba,
// barra de estados con contadores + búsqueda + filtro por plan, tabla densa
// paginada (25 por página). Mismas acciones y ficha que antes.
// ═══════════════════════════════════════════════════════════════════
const STATUS_TABS = [
  { id:"active",         label:"Activas",       statKey:"active" },
  { id:"paused",         label:"Pausadas",      statKey:"paused" },
  { id:"payment_failed", label:"Pago fallido",  statKey:"payment_failed" },
  { id:"unpaid",         label:"Sin pagar",     statKey:null },
  { id:"cancelled",      label:"Canceladas",    statKey:"cancelled" },
];
const EMPTY_COPY = {
  active:         ["👥", "Todavía no tenés suscripciones activas", "Cuando un cliente complete el pago en Mercado Pago, aparece acá automáticamente."],
  paused:         ["⏸", "No hay suscripciones pausadas", "Las que pauses vos o el cliente desde el portal aparecen acá."],
  payment_failed: ["⚠️", "No hay pagos fallidos", "Cuando Mercado Pago rechace una renovación, la suscripción cae acá para que la sigas."],
  unpaid:         ["🛒", "No hay checkouts sin pagar", "Clientes que iniciaron la suscripción y todavía no pagaron (últimos 30 días)."],
  cancelled:      ["🚫", "No hay canceladas", "Las suscripciones canceladas por vos o por el cliente quedan acá con su historial."],
};
const PAGE_SIZE = 25;
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");
// "hoy" · "mañana" · "en 5 días" · "atrasado" (próximo cobro).
function fmtIn(iso) {
  const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return "";
  const d = Math.ceil((t - Date.now()) / 86400000);
  if (d < 0) return "atrasado";
  if (d === 0) return "hoy";
  if (d === 1) return "mañana";
  return `en ${d} días`;
}
// Iniciales en un círculo del color del estado.
function Avatar({ T, name, color }) {
  const ini = String(name || "").trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
  return <span aria-hidden="true" style={{ width:30, height:30, borderRadius:99, background:color + "22", color, fontSize:11, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center", flexShrink:0, letterSpacing:0.3 }}>{ini}</span>;
}
const SearchIcon = ({ color }) => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke={color} strokeWidth="1.6"/><path d="M11 11l3.5 3.5" stroke={color} strokeWidth="1.6" strokeLinecap="round"/></svg>
);

export function SubscriptionsPage({ devMode = false, shop = null }) {
  const T = useT();
  const iS = InputStyle(T);
  const [status, setStatus] = useState(() => { const s = hashQuery().get("status"); return STATUS_TABS.some(t => t.id === s) ? s : "active"; });
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState(null);
  const [counts, setCounts] = useState({});
  const [period, setPeriod] = useState(null);
  const [busyRow, setBusyRow] = useState(null);

  async function loadCounts() {
    const d = await apiGet("stats");
    if (d && !d.error) { setCounts(c => ({ ...c, ...(d.totals || {}) })); setPeriod(d.period || null); }
  }
  async function load(st = status, { silent = false } = {}) {
    if (!silent) setLoading(true);
    const params = { status: st };
    if (search.trim()) params.q = search.trim();
    const d = await apiGet("subscribers", params);
    const list = d?.error ? [] : (d?.subscribers || d?.items || d?.unpaid || []);
    setSubs(list);
    if (st === "unpaid") setCounts(c => ({ ...c, unpaid: d?.count ?? d?.total ?? list.length }));
    setLoading(false);
  }
  useEffect(() => { loadCounts(); }, []);
  useEffect(() => { load(status); /* eslint-disable-next-line */ }, [status]);
  useTabRefresh("suscripciones", () => { loadCounts(); load(status, { silent: true }); });
  useEffect(() => { setPage(0); }, [status, search, plan]);

  const planTitle = (s) => subAmounts(s).plan.product_title || s.product_title || "";
  const planOptions = useMemo(() => [...new Set(subs.map(planTitle).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [subs]);

  // Filtro client-side por nombre/email/teléfono + plan.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.filter(s => {
      if (plan && planTitle(s) !== plan) return false;
      if (!q) return true;
      return [s.customer_email, s.email, s.customer_name, s.name, s.customer_phone].some(v => String(v || "").toLowerCase().includes(q));
    });
  }, [subs, search, plan]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pg = Math.min(page, pages - 1);
  const rows = filtered.slice(pg * PAGE_SIZE, (pg + 1) * PAGE_SIZE);

  // CSV: fetch con Bearer (apiGet parsea JSON) → blob → descarga.
  async function exportCsv() {
    try {
      const token = await auth.currentUser?.getIdToken();
      const params = new URLSearchParams({ action: "export", status });
      const r = await fetch(`/api/subscribers?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) { const d = await r.json().catch(() => ({})); return toast("Error: " + (d.error || r.status), "error"); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `suscripciones-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("CSV exportado", "success");
    } catch (e) { toast("Error: " + e.message, "error"); }
  }

  function rowAction(s, action) {
    return performSubAction(s, action, { setBusy: (id) => setBusyRow(id ? s.id : null), refresh: async () => { await load(); loadCounts(); } });
  }
  function changeStatus(id) {
    setStatus(id);
    try { window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/suscripciones?status=${id}`); } catch (_) {}
  }

  const tabs = STATUS_TABS.map(t => ({ id:t.id, label:t.label, count: t.statKey ? counts[t.statKey] : counts.unpaid }));
  const isUnpaid = status === "unpaid";
  const k = period?.kpis || {};
  const ser = period?.series || {};

  const clienteCol = { key:"cliente", label:"Cliente", render: s => {
    const name = s.customer_name || s.name;
    const email = s.customer_email || s.email;
    return (
      <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
        <Avatar T={T} name={name || email} color={subStatusMeta(T, s.status).color}/>
        <CellStack T={T} main={name || email} sub={name ? email : (s.customer_phone || "")}/>
      </div>
    );
  } };
  const planCol = { key:"plan", label:"Plan / pack", render: s => { const { plan, qty } = subAmounts(s); return <CellStack T={T} main={<>{plan.product_title || s.product_title || "—"}{qty > 1 && <span style={{ color:T.accent }}> × {qty}</span>}</>} sub={plan.pack_label || (qty > 1 ? `pack de ${qty}` : null)}/>; } };
  const montoCol = { key:"monto", label:"Por cobro", align:"right", nowrap:true, render: s => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(subAmounts(s).total || s.value_ars)}</span> };

  const columns = isUnpaid ? [
    clienteCol, planCol, montoCol,
    { key:"act", label:"Última actividad", nowrap:true, hideMobile:true, render: s => { const ts = s.last_activity_at || s.updated_at || s.created_at; return <span title={ts ? fmtDateTime(ts) : ""} style={{ color:T.textSm, fontSize:DS.font.sm }}>{ts ? fmtAgo(ts) : "—"}</span>; } },
    { key:"alta", label:"Inició", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{s.created_at ? fmtDateShort(s.created_at) : "—"}</span> },
    { key:"acciones", label:"", align:"right", nowrap:true, render: s => (
      <div style={{ display:"inline-flex", gap:6, alignItems:"center" }} onClick={e => e.stopPropagation()}>
        {s.recover_url && <a href={s.recover_url} target="_blank" rel="noreferrer" title={s.recover_url} style={{ ...BtnSecondary(T), textDecoration:"none", padding:"5px 10px", fontSize:DS.font.sm }}>Ver checkout →</a>}
        {busyRow === s.id ? <Spinner size={12} color={T.textMd}/> : <RowMenu T={T} items={[
          { label:"Ver", icon:"👁", onClick: () => setDetail(s) },
          { label:"Sincronizar con MP", icon:"⟳", onClick: () => rowAction(s, "sync") },
          { label:"Borrar", icon:"🗑", danger:true, onClick: () => rowAction(s, "delete") },
        ]}/>}
      </div>) },
  ] : [
    clienteCol, planCol,
    { key:"freq", label:"Frecuencia", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textMd }}>{fmtFreq(s.plan_snapshot?.frequency_days)}</span> },
    // Fecha del primer cobro (o del alta, para las viejas sin el campo). Sin esta
    // columna la fecha del próximo cobro se leía como si fuera la del alta.
    { key:"primer", label:"Primer pago", nowrap:true, render: s => { const ts = s.first_charge_at || s.created_at; return ts ? <CellStack T={T} main={fmtDayMonth(ts)} sub={fmtDateShort(ts)}/> : <span style={{ color:T.textSm }}>—</span>; } },
    { key:"next", label:"Próximo cobro", nowrap:true, render: s => (s.status === "active" && s.next_charge_at)
      ? <CellStack T={T} main={fmtDayMonth(s.next_charge_at)} sub={fmtIn(s.next_charge_at)}/>
      : <span style={{ color:T.textSm }}>—</span> },
    { key:"cobros", label:"Cobros", align:"right", nowrap:true, hideMobile:true, render: s => <span style={{ color:T.textMd, fontVariantNumeric:"tabular-nums" }}>{s.charges_count ?? (s.shopify_orders || []).length}</span> },
    { key:"estado", label:"Estado", nowrap:true, render: s => <StatusBadge status={s.status} orderCount={(s.shopify_orders || []).length}/> },
    montoCol,
    { key:"acciones", label:"", align:"right", nowrap:true, width:40, render: s => (
      <div onClick={e => e.stopPropagation()} style={{ display:"inline-flex" }}>
        {busyRow === s.id ? <Spinner size={12} color={T.textMd}/> : <RowMenu T={T} items={[
          { label:"Ver", icon:"👁", onClick: () => setDetail(s) },
          { label:"Pausar", icon:"⏸", hidden: s.status !== "active", onClick: () => rowAction(s, "pause") },
          { label:"Reactivar", icon:"▶", hidden: s.status !== "paused", onClick: () => rowAction(s, "resume") },
          { label:"Sincronizar con MP", icon:"⟳", onClick: () => rowAction(s, "sync") },
          { label:"Copiar link del portal", icon:"🔗", onClick: () => rowAction(s, "portal-link") },
          { label:"Reintentar orden", icon:"↻", hidden: !(s.last_failed_payment_id || s.retry_payment_id), onClick: () => performSubAction(s, "retry-order", { paymentId: s.last_failed_payment_id || s.retry_payment_id, setBusy: (id) => setBusyRow(id ? s.id : null), refresh: load }) },
          { label:"Cancelar", icon:"✕", danger:true, hidden: !["active", "paused", "payment_failed"].includes(s.status), onClick: () => rowAction(s, "cancel") },
        ]}/>}
      </div>) },
  ];

  const [emptyIcon, emptyTitle, emptyDesc] = EMPTY_COPY[status] || EMPTY_COPY.active;
  const pill = { ...iS, width:"auto", height:34, borderRadius:99, fontSize:DS.font.md, boxSizing:"border-box" };
  const from = filtered.length ? pg * PAGE_SIZE + 1 : 0;
  const to = Math.min(filtered.length, (pg + 1) * PAGE_SIZE);

  return (
    <div>
      <PageHeader T={T} title="Suscripciones" subtitle="Todas las suscripciones de tu negocio. Tocá una fila para abrir la ficha."
        right={<>
          <Btn T={T} variant="secondary" size="sm" onClick={exportCsv} style={{ height:34 }}>⬇ Exportar CSV</Btn>
          <Btn T={T} variant="secondary" size="sm" onClick={() => { load(); loadCounts(); }} disabled={loading} style={{ height:34 }}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>
        </>}/>

      {/* KPIs (últimos 30 días vs los 30 anteriores) — tocás una y filtra la tabla */}
      <div className="kpi-grid" style={{ display:"grid", gap:10, marginBottom:18 }}>
        <KpiCard T={T} loading={!period} label="Activas" value={fmtN(counts.active)} curr={k.activas?.value} prev={k.activas?.prev}
          hint="vs. hace 30 días" spark={ser.activas} color={T.green} onClick={() => changeStatus("active")}/>
        <KpiCard T={T} loading={!period} label="Ingreso recurrente" value={fmtARS(k.mrr?.value)} curr={k.mrr?.value} prev={k.mrr?.prev}
          hint="MRR · lo que cobrás por mes" spark={ser.mrr} color={T.accentSolid} valueColor={T.accent}/>
        <KpiCard T={T} loading={!period} label="Pago fallido" value={fmtN(counts.payment_failed)}
          hint="MP reintenta solo" spark={ser.fallidos} color={T.red} valueColor={(counts.payment_failed || 0) > 0 ? T.red : T.text} onClick={() => changeStatus("payment_failed")}/>
        <KpiCard T={T} loading={!period} label="Bajas · 30 días" value={fmtN(k.bajas?.value)} curr={k.bajas?.value} prev={k.bajas?.prev} invert
          hint={`Churn ${(k.churn_pct ?? 0).toLocaleString("es-AR")}%`} spark={ser.bajas} color={T.textSm} onClick={() => changeStatus("cancelled")}/>
      </div>

      {/* Barra: estados con contadores · búsqueda · plan · conteo */}
      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ maxWidth:"100%", overflowX:"auto" }}>
          <Segmented T={T} options={tabs} value={status} onChange={changeStatus} ariaLabel="Estado de la suscripción"/>
        </div>
        <div style={{ position:"relative", flex:"0 1 240px", minWidth:170 }}>
          <span style={{ position:"absolute", left:11, top:"50%", transform:"translateY(-50%)", display:"flex", pointerEvents:"none" }}><SearchIcon color={T.textSm}/></span>
          <input type="search" aria-label="Buscar suscripciones" placeholder="Buscar nombre, email o teléfono…" value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === "Enter") load(); }}
            style={{ ...pill, width:"100%", padding:"0 12px 0 30px" }}/>
        </div>
        {planOptions.length > 1 && (
          <select aria-label="Filtrar por plan" value={plan} onChange={e => setPlan(e.target.value)} style={{ ...pill, padding:"0 12px", maxWidth:220, cursor:"pointer" }}>
            <option value="">Todos los planes</option>
            {planOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
        <span style={{ marginLeft:"auto", fontSize:DS.font.sm, color:T.textSm, fontVariantNumeric:"tabular-nums", whiteSpace:"nowrap" }}>
          {loading ? "cargando…" : `${fmtN(filtered.length)} suscripci${filtered.length === 1 ? "ón" : "ones"}${pages > 1 ? ` · pág. ${pg + 1}/${pages}` : ""}`}
        </span>
      </div>

      {loading ? (
        <Loading T={T}/>
      ) : filtered.length === 0 ? (
        (search.trim() || plan)
          ? <div style={{ padding:"36px 12px", textAlign:"center", color:T.textSm, fontSize:DS.font.base, border:`1px dashed ${T.border}`, borderRadius:12 }}>
              Ninguna suscripción coincide con el filtro. <button onClick={() => { setSearch(""); setPlan(""); }} style={{ background:"none", border:"none", color:T.accent, cursor:"pointer", fontWeight:700, fontFamily:"inherit", fontSize:"inherit" }}>Limpiar filtros</button>
            </div>
          : <OnbEmpty section="suscripciones" icon={emptyIcon} title={emptyTitle} desc={emptyDesc} tip={status === "active" ? TIPS.subscribersEmpty : undefined}/>
      ) : (
        <DSTable T={T} dense columns={columns} rows={rows} rowKey={s => s.id} onRowClick={s => setDetail(s)} minWidth={isUnpaid ? 760 : 880}
          footer={<>
            <span style={{ fontVariantNumeric:"tabular-nums" }}>{from}–{to} de {fmtN(filtered.length)}{search.trim() ? ` · filtro "${search.trim()}"` : ""}{plan ? ` · ${plan}` : ""}</span>
            {pages > 1 && (
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <Btn T={T} variant="secondary" size="sm" disabled={pg === 0} onClick={() => setPage(pg - 1)}>‹ Anterior</Btn>
                <span style={{ fontVariantNumeric:"tabular-nums" }}>{pg + 1} / {pages}</span>
                <Btn T={T} variant="secondary" size="sm" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>Siguiente ›</Btn>
              </div>
            )}
          </>}/>
      )}

      {detail && <SubscriberDetailModal sub={detail} devMode={devMode} shop={shop} onClose={() => { setDetail(null); load(); loadCounts(); }}/>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Ficha del suscriptor — 2 columnas estilo Recharge.
//   Izquierda: Productos / pack · Próximos cobros · Historial · Timeline
//   Derecha:   Cliente · Dirección · Pago (MP) · Plan · Detalles
// ═══════════════════════════════════════════════════════════════════
export function SubscriberDetailModal({ sub, onClose, devMode = false, shop = null }) {
  const T = useT();
  const [data, setData] = useState({ subscriber: sub, charges: [] });
  const [busyAction, setBusyAction] = useState(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet("subscribers", { id: sub.id }).then(d => { if (d?.subscriber) setData(d); setLoading(false); });
  }, [sub.id]);

  async function refresh() {
    const refreshed = await apiGet("subscribers", { id: sub.id });
    if (refreshed?.subscriber) setData(refreshed);
  }
  const s = data.subscriber;
  const doAction = (action, extra = {}) => performSubAction(s, action, { setBusy: setBusyAction, refresh, onClose, ...extra });

  const charges = data.charges || [];
  const status = s?.status || "unknown";
  const { plan, qty, unit, total } = subAmounts(s);
  const busy = !!busyAction;
  const act = ({ id, variant = "secondary", label, busyLabel, ...rest }) => (
    <Btn T={T} variant={variant} size="sm" onClick={() => doAction(id)} disabled={busy} {...rest}>
      {busyAction === id ? <><Spinner size={11} color={variant === "solid" ? "#fff" : T.textMd}/> {busyLabel}</> : label}
    </Btn>
  );
  const addr = s.shipping_address || {};
  const portal = portalUrl(s);
  const okCharges = charges.filter(c => !c.error);

  // Próximos cobros: el próximo real + proyección de los 2 siguientes.
  const upcoming = useMemo(() => {
    if (status !== "active" || !s.next_charge_at) return [];
    const freq = Number(plan.frequency_days) || 30;
    const base = new Date(s.next_charge_at);
    if (!isFinite(base)) return [];
    return [0, 1, 2].map(i => ({ date: new Date(base.getTime() + i * freq * 86400000).toISOString(), amount: total, projected: i > 0 }));
  }, [status, s.next_charge_at, plan.frequency_days, total]);

  // Timeline: eventos del doc + cobros, de más nuevo a más viejo.
  const timeline = useMemo(() => {
    const ev = [];
    const push = (at, label, color, sub) => { if (at) ev.push({ at, label, color, sub }); };
    push(s.created_at, "Checkout iniciado", T.blue);
    push(s.activated_at || (okCharges.length ? okCharges[okCharges.length - 1]?.created_at : null), "Suscripción activada", T.green);
    push(s.paused_at, "Pausada", T.yellow);
    push(s.resumed_at, "Reactivada", T.green);
    push(s.payment_failed_at, "Pago rechazado por MP", T.red);
    push(s.cancelled_at, "Cancelada", T.red, s.cancel_reason_label || s.cancel_reason || s.cancellation_reason || null);
    for (const c of charges) push(c.created_at, c.error ? `Cobro con error · ${fmtARS(c.amount_ars)}` : `Cobro OK · ${fmtARS(c.amount_ars)}`, c.error ? T.red : T.accent, c.shopify_order_id ? (orderLabel(c.shopify_order_id).startsWith("#") ? `Orden ${orderLabel(c.shopify_order_id)}` : orderLabel(c.shopify_order_id)) : (c.error || null));
    return ev.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  }, [s, charges]);

  const chargeCols = [
    { key:"fecha", label:"Fecha", nowrap:true, render: c => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateTime(c.created_at)}</span> },
    { key:"monto", label:"Monto", nowrap:true, render: c => <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums" }}>{fmtARS(c.amount_ars)}</span> },
    { key:"mp", label:"MP", nowrap:true, render: c => c.mp_payment_id ? <ExtLink T={T} href={mpPaymentUrl(c.mp_payment_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{c.mp_payment_id}</ExtLink> : <span style={{ color:T.textSm }}>—</span> },
    { key:"orden", label:"Shopify", nowrap:true, render: c => c.shopify_order_id
        ? <ExtLink T={T} href={shopifyOrderUrl(shop, c.shopify_order_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{orderLabel(c.shopify_order_id)}</ExtLink>
        : (c.error && c.mp_payment_id
            ? <Btn T={T} variant="secondary" size="sm" disabled={busy} onClick={() => doAction("retry-order", { paymentId: c.mp_payment_id })} style={{ padding:"3px 8px", fontSize:DS.font.xs }}>{busyAction === "retry-order" ? <Spinner size={10} color={T.textMd}/> : "↻ Reintentar orden"}</Btn>
            : <span style={{ color:T.textSm }}>—</span>) },
    { key:"estado", label:"Estado", align:"right", nowrap:true, render: c => <span title={c.error || ""} style={{ cursor:c.error ? "help" : "default" }}><DSBadge T={T} color={c.error ? T.red : T.green} size="sm">{c.error ? "✗ Error" : "✓ OK"}</DSBadge></span> },
  ];

  const colTitle = (t) => <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", color:T.textSm, fontWeight:DS.w.semibold, letterSpacing:0.6, margin:"0 0 8px" }}>{t}</div>;

  return (
    <Modal T={T} open onClose={onClose} width={960} title={s.customer_name || s.customer_email}
      subtitle={<>{s.customer_email}{s.customer_phone ? ` · ${s.customer_phone}` : ""}</>}>

      {/* Cabecera: estado + acciones */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, flexWrap:"wrap" }}>
        <StatusBadge status={status} orderCount={(s?.shopify_orders || []).length} size="md"/>
        <span style={{ fontSize:DS.font.sm, color:T.textSm }}>desde {s.created_at ? fmtDateOnly(s.created_at) : "—"}</span>
        {s.next_charge_at && status === "active" && <span style={{ fontSize:DS.font.sm, color:T.textSm }}>· próximo cobro {fmtDateOnly(s.next_charge_at)}</span>}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {status === "active" && act({ id: "pause", label: "⏸ Pausar", busyLabel: "Pausando…" })}
        {status === "paused" && act({ id: "resume", variant: "primary", label: "▶ Reactivar", busyLabel: "Reactivando…" })}
        {act({ id: "sync", variant: "primary", label: "⟳ Sincronizar con MP", busyLabel: "Sincronizando…" })}
        {(status === "cancelled" || status === "paused" || status === "pending") && act({ id: "resync", variant: "success", label: "✓ Marcar como activa (sigue en MP)", busyLabel: "Marcando…" })}
        {act({ id: "link-payment", label: "🔗 Linkear payment ID", busyLabel: "Linkeando…" })}
        {(status === "active" || status === "paused") && act({ id: "reprice", label: "💲 Repreciar", busyLabel: "Repreciando…" })}
        {portal && <Btn T={T} variant="secondary" size="sm" onClick={() => doAction("portal-link")}>🔗 Copiar link del portal</Btn>}
        {status === "active" && devMode && act({ id: "simulate-charge", label: "🧪 Simular próximo cobro", busyLabel: "Simulando…" })}
        {(status === "active" || status === "paused" || status === "payment_failed") && act({ id: "cancel", variant: "danger", label: "✕ Cancelar", busyLabel: "Cancelando…" })}
        {act({ id: "delete", variant: "danger", label: "🗑 Borrar definitivamente", busyLabel: "Borrando…", style: { background:T.red + "26" } })}
      </div>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.5fr) minmax(0,1fr)", gap:16, alignItems:"start" }}>
        {/* ── Columna izquierda ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:14, minWidth:0 }}>
          <SurfaceBox T={T} title="Productos / pack">
            <div style={{ display:"flex", gap:12, alignItems:"center" }}>
              {plan.product_image ? <img src={plan.product_image} alt="" style={{ width:44, height:44, borderRadius:DS.r.md, objectFit:"cover", border:`1px solid ${T.borderL}`, flexShrink:0 }}/> : <div style={{ width:44, height:44, borderRadius:DS.r.md, background:T.card, border:`1px solid ${T.borderL}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>📦</div>}
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text }}>{plan.product_title || "—"}{plan.variant_title ? <span style={{ color:T.textSm, fontWeight:DS.w.medium }}> · {plan.variant_title}</span> : null}</div>
                <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{qty} unidad{qty === 1 ? "" : "es"} × {fmtARS(unit)}{plan.pack_label ? ` · ${plan.pack_label}` : ""}{plan.shipping_price_ars ? ` · envío ${fmtARS(plan.shipping_price_ars)}` : ""}</div>
              </div>
              <div style={{ textAlign:"right", flexShrink:0 }}>
                <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.black, color:T.accent, fontVariantNumeric:"tabular-nums" }}>{fmtARS(total)}</div>
                <div style={{ fontSize:DS.font.xs, color:T.textSm }}>{fmtFreq(plan.frequency_days)}</div>
              </div>
            </div>
          </SurfaceBox>

          <div>
            {colTitle("Próximos cobros")}
            {upcoming.length === 0 ? (
              <SurfaceBox T={T}><div style={{ fontSize:DS.font.md, color:T.textSm, textAlign:"center" }}>{status === "active" ? "Sin fecha de próximo cobro (sincronizá con MP)." : "Sin cobros programados."}</div></SurfaceBox>
            ) : (
              <SurfaceBox T={T} style={{ padding:"4px 14px" }}>
                {upcoming.map((u, i) => (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"8px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, fontSize:DS.font.md }}>
                    <span style={{ color: u.projected ? T.textSm : T.text }}>{fmtDateOnly(u.date)}{u.projected ? <span style={{ fontSize:DS.font.xs, marginLeft:6 }}>(estimado)</span> : <DSBadge T={T} color={T.accent} size="sm" >próximo</DSBadge>}</span>
                    <span style={{ fontWeight:DS.w.bold, fontVariantNumeric:"tabular-nums", color: u.projected ? T.textMd : T.text }}>{fmtARS(u.amount)}</span>
                  </div>
                ))}
              </SurfaceBox>
            )}
          </div>

          <div>
            {colTitle(`Historial de cobros${charges.length ? ` · ${charges.length}` : ""}`)}
            {loading ? <Loading T={T}/> : charges.length === 0 ? (
              <SurfaceBox T={T}><div style={{ fontSize:DS.font.md, color:T.textSm, textAlign:"center" }}>Sin cobros todavía</div></SurfaceBox>
            ) : (
              <DSTable T={T} columns={chargeCols} rows={charges} rowKey={c => c.id} dense minWidth={480} style={{ boxShadow:"none" }}/>
            )}
          </div>

          <div>
            {colTitle("Timeline")}
            <SurfaceBox T={T} style={{ padding:"6px 14px" }}>
              {timeline.length === 0 ? <div style={{ fontSize:DS.font.md, color:T.textSm, textAlign:"center", padding:"6px 0" }}>Sin eventos</div> : timeline.slice(0, 30).map((e, i) => (
                <div key={i} style={{ display:"flex", gap:10, alignItems:"flex-start", padding:"7px 0", borderTop: i === 0 ? "none" : `1px solid ${T.borderL}` }}>
                  <span style={{ width:8, height:8, borderRadius:"50%", background:e.color, marginTop:5, flexShrink:0, boxShadow:`0 0 0 3px ${e.color}22` }}/>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:DS.font.md, color:T.text, fontWeight:DS.w.medium }}>{e.label}</div>
                    {e.sub && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:1 }}>{e.sub}</div>}
                  </div>
                  <span style={{ fontSize:DS.font.xs, color:T.textSm, whiteSpace:"nowrap" }}>{fmtDateShort(e.at)}</span>
                </div>
              ))}
            </SurfaceBox>
          </div>
        </div>

        {/* ── Columna derecha ── */}
        <div style={{ display:"flex", flexDirection:"column", gap:14, minWidth:0 }}>
          <SurfaceBox T={T} title="Cliente">
            <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text }}>{s.customer_name || "—"}</div>
            <div style={{ fontSize:DS.font.md, color:T.textMd, marginTop:2, wordBreak:"break-all" }}>{s.customer_email}</div>
            {s.customer_phone && <div style={{ fontSize:DS.font.md, color:T.textMd }}>{s.customer_phone}</div>}
            {s.customer_tax_id && <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>DNI/CUIT {s.customer_tax_id}</div>}
            {s.shopify_customer_id && shop && <div style={{ marginTop:6, fontSize:DS.font.sm }}><ExtLink T={T} href={`https://${shop}/admin/customers/${s.shopify_customer_id}`}>Ver en Shopify</ExtLink></div>}
          </SurfaceBox>

          <SurfaceBox T={T} title="Dirección de envío" right={<Btn T={T} variant="ghost" size="sm" onClick={() => setEditingAddress(true)} style={{ padding:"2px 8px" }}>✏️ Editar</Btn>}>
            <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.5 }}>
              {addr.address1
                ? <>{addr.address1}{addr.address2 ? ", " + addr.address2 : ""}<br/>{addr.city}{addr.province ? ", " + addr.province : ""}{addr.zip ? " — CP " + addr.zip : ""}</>
                : <span style={{ color:T.red, fontWeight:DS.w.bold }}>⚠️ Sin dirección — editá para arreglar</span>}
            </div>
          </SurfaceBox>

          <SurfaceBox T={T} title="Pago (Mercado Pago)">
            <KV T={T} k="Suscripción MP" v={s.mp_preapproval_id ? <ExtLink T={T} href={mpPreapprovalUrl(s.mp_preapproval_id)} style={{ fontFamily:MONO, fontSize:DS.font.sm }}>{s.mp_preapproval_id}</ExtLink> : "—"}/>
            <KV T={T} k="Estado en MP" v={s.mp_preapproval_status || "—"}/>
            <KV T={T} k="Medio de pago" v={s.payment_method_label || (s.card_brand ? `${s.card_brand}${s.card_last4 ? " •••• " + s.card_last4 : ""}` : "Tarjeta de crédito")}/>
            <KV T={T} k="Último cobro" v={s.last_charge_at ? fmtDateOnly(s.last_charge_at) : (okCharges[0]?.created_at ? fmtDateOnly(okCharges[0].created_at) : "—")}/>
            <KV T={T} k="Cobros OK" v={okCharges.length}/>
          </SurfaceBox>

          <SurfaceBox T={T} title="Plan">
            <KV T={T} k="Frecuencia" v={fmtFreq(plan.frequency_days)}/>
            <KV T={T} k="Cantidad" v={qty}/>
            <KV T={T} k="Precio unitario" v={fmtARS(unit)}/>
            {plan.discount_pct ? <KV T={T} k="Descuento" v={`${plan.discount_pct}%`}/> : null}
            {plan.shipping_price_ars != null ? <KV T={T} k="Envío" v={plan.shipping_price_ars ? fmtARS(plan.shipping_price_ars) : "Gratis"}/> : null}
            <KV T={T} k="Total por cobro" v={<strong style={{ color:T.accent }}>{fmtARS(total)}</strong>}/>
          </SurfaceBox>

          <SurfaceBox T={T} title="Detalles">
            <KV T={T} k="ID" v={s.id} mono/>
            <KV T={T} k="Plan ID" v={s.plan_id || "—"} mono/>
            <KV T={T} k="Alta" v={s.created_at ? fmtDateTime(s.created_at) : "—"}/>
            <KV T={T} k="Actualizado" v={s.updated_at ? fmtDateTime(s.updated_at) : "—"}/>
            {(s.cancel_reason_label || s.cancel_reason) && <KV T={T} k="Motivo de baja" v={s.cancel_reason_label || s.cancel_reason}/>}
            <KV T={T} k="Portal" v={portal ? <button onClick={() => doAction("portal-link")} style={{ background:"transparent", border:"none", color:T.accent, cursor:"pointer", fontWeight:DS.w.semibold, fontSize:DS.font.md, padding:0, fontFamily:"inherit" }}>Copiar link</button> : "—"}/>
          </SurfaceBox>
        </div>
      </div>

      {editingAddress && (
        <EditAddressModal sub={s} onClose={() => setEditingAddress(false)} onSaved={async () => { setEditingAddress(false); await refresh(); }}/>
      )}
    </Modal>
  );
}

// ─── Modal para editar la dirección de un subscriber ──────────────
// Edita el shipping_address y propaga el cambio a TODAS las órdenes Shopify
// ya creadas + las que se generen en cobros recurrentes futuros.
const PROVINCIAS_AR = ["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];

export function EditAddressModal({ sub, onClose, onSaved }) {
  const T = useT();
  const iS = InputStyle(T);
  const a = sub?.shipping_address || {};
  const [name, setName]         = React.useState(sub?.customer_name || "");
  const [phone, setPhone]       = React.useState(sub?.customer_phone || a.phone || "");
  const [taxId, setTaxId]       = React.useState(sub?.customer_tax_id || "");
  const [address1, setAddress1] = React.useState(a.address1 || "");
  const [address2, setAddress2] = React.useState(a.address2 || "");
  const [city, setCity]         = React.useState(a.city || "");
  const [province, setProvince] = React.useState(a.province || "");
  const [zip, setZip]           = React.useState(a.zip || "");
  const [saving, setSaving]     = React.useState(false);

  async function save() {
    if (!address1.trim()) return toast("Falta dirección (calle + número)", "warning");
    if (!city.trim())     return toast("Falta ciudad", "warning");
    if (!province)        return toast("Falta provincia", "warning");
    if (!zip.trim())      return toast("Falta código postal", "warning");
    const cleanTax = (taxId || "").replace(/[^0-9]/g, "");
    if (cleanTax && !(cleanTax.length === 7 || cleanTax.length === 8 || cleanTax.length === 11)) {
      return toast("DNI o CUIL/CUIT inválido. DNI son 7-8 dígitos, CUIL/CUIT son 11.", "warning", 5000);
    }
    setSaving(true);
    const r = await apiSend("subscribers", "PATCH",
      { address1, address2, city, province, zip, phone, customer_name: name, tax_id: cleanTax },
      { action: "update-address", id: sub.id }
    );
    setSaving(false);
    if (r?.error) { toast("Error: " + r.error, "error", 6000); return; }
    if (r.failed_orders?.length) {
      await appAlert(`Dirección actualizada en Recurrentes.` + (r.updated_orders?.length ? `\n📦 ${r.updated_orders.length} órdenes Shopify actualizadas.` : "") + `\n⚠️ ${r.failed_orders.length} órdenes Shopify fallaron al actualizar (verificá manual en Shopify Admin).`, { title:"Dirección guardada con avisos" });
    } else {
      toast("Dirección actualizada" + (r.updated_orders?.length ? ` · ${r.updated_orders.length} órdenes Shopify actualizadas` : ""), "success", 5000);
    }
    onSaved?.();
  }

  return (
    <Modal T={T} open onClose={onClose} title="Editar dirección" width={540} zIndex={1100}
      subtitle="Los cambios se aplican al sub y a todas las órdenes Shopify ya creadas + las que se generen en cobros futuros."
      footer={<>
        <Btn T={T} variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Btn>
        <Btn T={T} variant="solid" onClick={save} disabled={saving}>{saving ? <><Spinner size={13}/> Guardando…</> : "Guardar y sincronizar con Shopify"}</Btn>
      </>}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        <Field T={T} label="Nombre completo"><input type="text" value={name} onChange={e => setName(e.target.value)} style={iS}/></Field>
        <Field T={T} label="Teléfono"><input type="tel" value={phone} onChange={e => setPhone(e.target.value)} style={iS}/></Field>
      </div>
      <Field T={T} label="DNI o CUIL / CUIT (solo números)">
        <input type="text" inputMode="numeric" value={taxId} onChange={e => setTaxId(e.target.value.replace(/[^0-9]/g, ""))} style={iS} placeholder="12345678 ó 20123456789"/>
      </Field>
      <Hint T={T}>7-8 dígitos para DNI · 11 dígitos para CUIL/CUIT. Se guarda como "Company" en la orden Shopify para facturación.</Hint>
      <Field T={T} label="Dirección (calle + número)" required><input type="text" value={address1} onChange={e => setAddress1(e.target.value)} style={iS} placeholder="Av. Corrientes 1234"/></Field>
      <Field T={T} label="Departamento / piso (opcional)"><input type="text" value={address2} onChange={e => setAddress2(e.target.value)} style={iS} placeholder="Depto 4B"/></Field>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 12px" }}>
        <Field T={T} label="Ciudad" required><input type="text" value={city} onChange={e => setCity(e.target.value)} style={iS}/></Field>
        <Field T={T} label="Código postal" required><input type="text" value={zip} onChange={e => setZip(e.target.value)} style={iS}/></Field>
      </div>
      <Field T={T} label="Provincia" required>
        <select value={province} onChange={e => setProvince(e.target.value)} style={iS}>
          <option value="">— Seleccioná —</option>
          {PROVINCIAS_AR.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>
    </Modal>
  );
}

// Compat: alias del nombre viejo por si algún archivo lo sigue importando.
export const SubscribersTab = SubscriptionsPage;
