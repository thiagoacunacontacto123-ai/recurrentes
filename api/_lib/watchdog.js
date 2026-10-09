// Vigilante (9-oct-2026, Thiago: "que me lleguen WhatsApps si algo se rompe, vamos a
// tener a G4U facturando todo el tiempo"). Corre dentro de los crons de cada 5 min
// (sync-all-pending y run-flows, así uno vigila al otro) y manda UN aviso al admin
// cuando algo se rompe y otro cuando vuelve. Estado en system/watchdog:
//   { [clave]: { since, alerted_at, detail } }   clave = "checkout_failing", "widget_down:<mid>"…
//
// Qué mira (cada 5 min):
//   · checkout_failing   ≥ CHECKOUT_MIN errores de checkout en 10 min (system_errors).
//   · email_failing      ≥ 3 mails rebotados en 1 h.     · whatsapp_failing  ≥ 3 en 1 h.
//   · cron_stale:<name>  un cron obligatorio sin OK más de lo esperado (system/cron_heartbeat).
// Cada hora (minuto < 5):
//   · webhook_silent     más de 24 h sin webhook de MP habiendo suscripciones activas.
//   · mp_token_invalid:<mid>  tienda con el token de MP vencido/revocado (no cobra).
//   · widget_down:<mid>  tienda verificada cuyo widget no se vio en 24 h (tiendas internas,
//                        archivadas o con ventas pausadas no cuentan).
// Se re-avisa a las 24 h si sigue roto. NUNCA lanza: cuelga del cron del cobro.
//
// dailySummary(): resumen de AYER por WhatsApp a las 9:00 AR (cron daily-summary).
import { db } from "./firebase.js";
import { recentErrors, pruneErrors, logError, scrubMessage } from "./errlog.js";
import { EXPECTED_CRONS } from "./health.js";
import { adminEmails } from "./adminAuth.js";
import { isInternal } from "./plans_saas.js";

export const CHECKOUT_MIN = 3;          // errores de checkout en 10 min
export const CHANNEL_MIN = 3;           // mails / WhatsApps rebotados en 1 h
export const WEBHOOK_SILENT_H = 24;
export const WIDGET_SILENT_H = 24;
export const REALERT_H = 24;

const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const ms = (v) => { const t = Date.parse(v || ""); return Number.isFinite(t) ? t : 0; };
const arDay = (t = Date.now()) => new Date(t - 3 * H).toISOString().slice(0, 10);
const hourKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 13);
export const storeLabel = (m, id) => m?.store_name || m?.shop_name || m?.shopify_shop || m?.tiendanube_store_name || m?.email || id;

const STATE_DOC = ["system", "watchdog"];

async function notify(event, { merchantId = "system", store = "Recurrentes", detail, key }) {
  try {
    const { notifyAdmin } = await import("./adminAlerts.js");
    return await notifyAdmin(event, { merchantId, store, detail, key });
  } catch (e) { console.warn("[watchdog] aviso:", scrubMessage(e?.message)); return null; }
}

// Los chequeos devuelven { key, event, merchantId, store, detail } (roto) o null (ok).
// Con la lista completa de lo que está roto, compara contra el estado y avisa.
export async function reconcileState(broken, { now = Date.now(), scope = null } = {}) {
  const ref = db().collection(STATE_DOC[0]).doc(STATE_DOC[1]);
  const snap = await ref.get();
  const state = snap.exists ? (snap.data() || {}) : {};
  const next = { ...state };
  const seen = new Set();
  const out = { alerted: [], recovered: [], open: 0 };
  for (const b of broken) {
    seen.add(b.key);
    const cur = state[b.key];
    const stale = cur?.alerted_at && now - ms(cur.alerted_at) >= REALERT_H * H;
    if (!cur || stale) {
      const r = await notify(b.event, { merchantId: b.merchantId || "system", store: b.store || "Recurrentes", detail: b.detail, key: `${b.key}:${hourKey(now)}` });
      if (r?.ok || r?.skipped) { next[b.key] = { since: cur?.since || iso(now), alerted_at: iso(now), detail: scrubMessage(b.detail), event: b.event, merchant_id: b.merchantId || null }; out.alerted.push(b.key); }
      else if (!cur) next[b.key] = { since: iso(now), alerted_at: null, detail: scrubMessage(b.detail), event: b.event, merchant_id: b.merchantId || null };
    } else {
      next[b.key] = { ...cur, detail: scrubMessage(b.detail) };
    }
  }
  // Lo que estaba roto y ya no aparece en esta pasada: volvió. `scope` limita qué claves
  // puede cerrar esta pasada (los chequeos horarios no se corren cada 5 min).
  for (const [key, cur] of Object.entries(state)) {
    if (seen.has(key)) continue;
    if (scope && !scope(key)) continue;
    delete next[key];
    if (cur?.alerted_at) {
      await notify("recovered", { merchantId: cur.merchant_id || "system", store: cur.merchant_id ? undefined : "Recurrentes", detail: `Volvió a andar: ${labelFor(cur.event)} (${cur.detail || key}). Estuvo roto desde ${fmtAr(cur.since)}.`, key: `${key}:${hourKey(now)}` });
      out.recovered.push(key);
    }
  }
  out.open = Object.keys(next).length;
  await ref.set(next).catch(() => {});
  return out;
}

export const WATCH_LABEL = {
  checkout_failing: "Checkout fallando",
  email_failing: "Mails rebotando",
  whatsapp_failing: "WhatsApp rebotando",
  cron_stale: "Un proceso automático dejó de correr",
  webhook_silent: "Mercado Pago no manda webhooks",
  mp_token_invalid: "Token de Mercado Pago vencido en una tienda",
  widget_down: "Widget caído en una tienda",
  order_failed: "Cobró y la orden no se creó",
  firestore_quota: "Firestore sin cuota",
};
const labelFor = (ev) => WATCH_LABEL[ev] || ev || "algo";
const fmtAr = (v) => { const t = ms(v); return t ? new Date(t - 3 * H).toISOString().slice(0, 16).replace("T", " ") : "?"; };

// ── Chequeos de cada 5 min ──────────────────────────────────────────
export function checkErrorBursts(errors, now = Date.now()) {
  const broken = [];
  const inWindow = (kind, winMs) => errors.filter(e => e.kind === kind && now - ms(e.at) <= winMs);
  const co = inWindow("checkout", 10 * 60e3);
  if (co.length >= CHECKOUT_MIN) {
    const stores = [...new Set(co.map(e => e.merchant_id).filter(Boolean))];
    broken.push({ key: "checkout_failing", event: "checkout_failing", detail: `${co.length} compradores no pudieron suscribirse en 10 min${stores.length ? ` (tiendas: ${stores.length})` : ""}. Último: ${co[0].message}` });
  }
  const em = inWindow("email", H);
  if (em.length >= CHANNEL_MIN) broken.push({ key: "email_failing", event: "email_failing", detail: `${em.length} mails no salieron en 1 h. Último: ${em[0].message}` });
  const wa = inWindow("whatsapp", H);
  if (wa.length >= CHANNEL_MIN) broken.push({ key: "whatsapp_failing", event: "whatsapp_failing", detail: `${wa.length} WhatsApps no salieron en 1 h. Último: ${wa[0].message}` });
  return broken;
}

export function checkCrons(hb, now = Date.now()) {
  const broken = [];
  for (const [name, exp] of Object.entries(EXPECTED_CRONS)) {
    if (exp.soft) continue;
    const h = hb?.[name];
    if (!h?.last_ok_at) continue;                       // nunca corrió: eso lo dice el tablero, no un WhatsApp
    const since = (now - ms(h.last_ok_at)) / 60e3;
    if (since > exp.stale_after_min) broken.push({ key: `cron_stale:${name}`, event: "cron_stale", detail: `${name} lleva ${Math.round(since)} min sin terminar bien (corre cada ${exp.every_min} min).` });
  }
  return broken;
}

// ── Chequeos horarios ───────────────────────────────────────────────
export async function checkWebhookSilence(now = Date.now()) {
  const wh = (await db().collection("system").doc("webhooks_last").get()).data() || {};
  const last = ms(wh.mp?.last_at);
  if (!last || now - last < WEBHOOK_SILENT_H * H) return null;
  const any = await db().collectionGroup("subscribers").where("status", "==", "active").limit(1).get();
  if (any.empty) return null;
  return { key: "webhook_silent", event: "webhook_silent", detail: `Hace ${Math.round((now - last) / H)} h que no llega ningún webhook de Mercado Pago y hay suscripciones activas. Revisar la app de MP (webhooks) y recurrentess.vercel.app.` };
}

export async function checkMerchants(now = Date.now()) {
  const broken = [];
  const admins = adminEmails();
  const skip = (m) => m.archived_at || m.sales_paused || isInternal(m, admins);
  const tok = await db().collection("merchants").where("mp_token_invalid_at", "!=", null).limit(100).get();
  for (const d of tok.docs) {
    const m = d.data() || {};
    if (!m.mp_token_invalid_at || skip(m)) continue;
    broken.push({ key: `mp_token_invalid:${d.id}`, event: "mp_token_invalid", merchantId: d.id, store: storeLabel(m, d.id), detail: `El token de Mercado Pago está vencido o revocado desde ${fmtAr(m.mp_token_invalid_at)}: no cobra ni activa. Hay que reconectar MP desde Integraciones.` });
  }
  const seen = await db().collection("merchants").where("widget_last_seen_at", "<=", iso(now - WIDGET_SILENT_H * H)).limit(100).get();
  for (const d of seen.docs) {
    const m = d.data() || {};
    if (!m.widget_verified_at || !m.widget_last_seen_at || skip(m)) continue;
    broken.push({ key: `widget_down:${d.id}`, event: "widget_down", merchantId: d.id, store: storeLabel(m, d.id), detail: `El widget no se vio en la tienda desde ${fmtAr(m.widget_last_seen_at)} (${Math.round((now - ms(m.widget_last_seen_at)) / H)} h). Puede ser tema cambiado, snippet borrado o tienda sin visitas.` });
  }
  return broken;
}

// ── Entrada ─────────────────────────────────────────────────────────
// Nunca lanza. `hourly` fuerza los chequeos horarios (tests).
export async function runWatchdog({ now = Date.now(), minute = new Date(now).getMinutes(), hourly = null } = {}) {
  try {
    const doHourly = hourly ?? minute < 5;
    const [errors, hbSnap] = await Promise.all([
      recentErrors({ now, sinceMs: H, limit: 300 }).catch(() => []),
      db().collection("system").doc("cron_heartbeat").get().catch(() => null),
    ]);
    const broken = [...checkErrorBursts(errors, now), ...checkCrons(hbSnap?.exists ? hbSnap.data() : {}, now)];
    if (doHourly) {
      const ws = await checkWebhookSilence(now).catch(() => null);
      if (ws) broken.push(ws);
      broken.push(...(await checkMerchants(now).catch(() => [])));
    }
    const HOURLY = /^(webhook_silent|mp_token_invalid:|widget_down:)/;
    const r = await reconcileState(broken, { now, scope: doHourly ? null : (k) => !HOURLY.test(k) });
    return { ok: true, hourly: doHourly, errors_1h: errors.length, ...r };
  } catch (e) {
    console.warn("[watchdog]", scrubMessage(e?.message));
    await logError("watchdog", e, { kind: "cron" });
    return { ok: false, error: scrubMessage(e?.message) };
  }
}

// ── Resumen diario (ayer, hora Argentina) ───────────────────────────
const fmtArs = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

async function chargesYesterday(start, end) {
  // Intenta el collectionGroup (necesita índice CG en created_at); si Firestore lo
  // rechaza, recorre tienda por tienda (es una vez por día).
  try {
    const s = await db().collectionGroup("charges").where("created_at", ">=", start).where("created_at", "<", end).limit(1000).get();
    return s.docs.map(d => ({ mid: d.ref.parent.parent.id, ...d.data() }));
  } catch (_) {
    const out = [];
    const ms_ = await db().collection("merchants").limit(300).get();
    for (const m of ms_.docs) {
      if (m.data()?.archived_at) continue;
      const s = await db().collection(`merchants/${m.id}/charges`).where("created_at", ">=", start).where("created_at", "<", end).limit(300).get();
      for (const d of s.docs) out.push({ mid: m.id, ...d.data() });
    }
    return out;
  }
}

export async function buildDailySummary({ now = Date.now() } = {}) {
  const day = arDay(now - 24 * H);                       // ayer, en Argentina
  const start = new Date(`${day}T03:00:00.000Z`).toISOString();   // 00:00 AR
  const end = iso(ms(start) + 24 * H);
  const admins = adminEmails();
  const [charges, activated, pendings, errors, hbSnap] = await Promise.all([
    chargesYesterday(start, end),
    db().collectionGroup("subscribers").where("status", "==", "active").where("created_at", ">=", start).limit(500).get(),
    db().collectionGroup("subscribers").where("status", "==", "pending").where("created_at", ">=", start).limit(500).get(),
    recentErrors({ now, sinceMs: now - ms(start), limit: 500 }).catch(() => []),
    db().collection("system").doc("cron_heartbeat").get().catch(() => null),
  ]);
  const mids = new Set([...charges.map(c => c.mid), ...activated.docs.map(d => d.ref.parent.parent.id), ...pendings.docs.map(d => d.ref.parent.parent.id)]);
  const merchants = {};
  if (mids.size) {
    const refs = [...mids].map(id => db().collection("merchants").doc(id));
    const snaps = await db().getAll(...refs);
    for (const s of snaps) merchants[s.id] = s.exists ? (s.data() || {}) : {};
  }
  const real = (mid) => { const m = merchants[mid]; return m && !isInternal(m, admins); };
  const ch = charges.filter(c => real(c.mid));
  const approved = ch.filter(c => c.status === "approved");
  const sinOrden = approved.filter(c => !c.shopify_order_id);
  const rechazados = ch.filter(c => c.status === "rejected" || c.status === "cancelled").length;
  const total = approved.reduce((a, c) => a + (Number(c.amount_ars) || 0), 0);
  const altas = activated.docs.filter(d => real(d.ref.parent.parent.id) && d.data().created_at < end);
  const carritos = pendings.docs.filter(d => real(d.ref.parent.parent.id) && d.data().created_at < end).length;
  const porTienda = {};
  for (const d of altas) { const id = d.ref.parent.parent.id; porTienda[id] = (porTienda[id] || 0) + 1; }
  const altasTxt = Object.entries(porTienda).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, n]) => `${storeLabel(merchants[id], id)} ${n}`).join(", ");
  const errsByKind = {};
  for (const e of errors) if (ms(e.at) >= ms(start) && ms(e.at) < ms(end)) errsByKind[e.kind] = (errsByKind[e.kind] || 0) + 1;
  const errTotal = Object.values(errsByKind).reduce((a, b) => a + b, 0);
  const hb = hbSnap?.exists ? hbSnap.data() : {};
  const cronsMal = Object.entries(EXPECTED_CRONS).filter(([n, e]) => !e.soft && hb?.[n]?.last_ok_at && (now - ms(hb[n].last_ok_at)) / 60e3 > e.stale_after_min).map(([n]) => n);
  const [d, m, y] = [day.slice(8, 10), day.slice(5, 7), day.slice(0, 4)];
  const parts = [
    `Ayer ${d}/${m}: ${approved.length} cobro${approved.length === 1 ? "" : "s"} aprobado${approved.length === 1 ? "" : "s"} por ${fmtArs(total)}`,
    `órdenes creadas ${approved.length - sinOrden.length}${sinOrden.length ? ` · SIN ORDEN ${sinOrden.length}` : ""}`,
    `rechazados ${rechazados}`,
    `altas ${altas.length}${altasTxt ? ` (${altasTxt})` : ""}`,
    `checkouts sin pagar ${carritos}`,
    errTotal ? `errores ${errTotal} (${Object.entries(errsByKind).map(([k, n]) => `${k} ${n}`).join(", ")})` : "sin errores",
    cronsMal.length ? `OJO crons atrasados: ${cronsMal.join(", ")}` : "procesos OK",
  ];
  return { day, text: parts.join(" · ").slice(0, 900), approved: approved.length, total, sin_orden: sinOrden.length, rechazados, altas: altas.length, carritos, errors: errTotal, crons_mal: cronsMal, year: y };
}

export async function dailySummary({ now = Date.now() } = {}) {
  try {
    const s = await buildDailySummary({ now });
    const r = await notify("daily_summary", { merchantId: "system", store: "Recurrentes", detail: s.text, key: s.day });
    const pruned = await pruneErrors(now);
    return { ok: true, day: s.day, sent: !!(r?.ok || r?.skipped), pruned, summary: s.text };
  } catch (e) {
    await logError("daily-summary", e, { kind: "cron" });
    return { ok: false, error: scrubMessage(e?.message) };
  }
}
