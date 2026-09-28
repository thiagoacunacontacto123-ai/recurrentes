// Costos de operar Recurrentes, para el Admin → Costos (28-sept-2026, Thiago: "todos los
// costos de la aplicación, el cron, todos los que se me escapan; y si un día estoy
// ultra usando Vercel, que aparezca la advertencia").
//
// Dos partes:
//   · Fijos: una lista editable (system/admin_costs.items) con USD por mes. Los defaults
//     son ESTIMADOS y quedan marcados así hasta que Thiago los confirma.
//   · Calculados: invocaciones de los crons por mes (de vercel.json, el mismo archivo
//     que Vercel lee), el uso de WhatsApp del mes (admin_usage) y avisos cuando algo
//     se acerca a un límite del plan.
import { createRequire } from "node:module";
import { db } from "./firebase.js";
import { waUsageMonth } from "../../shared/platform/whatsapp.js";

const DOC = ["system", "admin_costs"];

export const DEFAULT_ITEMS = [
  { id: "vercel",     label: "Vercel (Pro)",                     usd_month: 20, note: "Hosting, funciones y crons. Hobby no permite crons cada 5 min.", estimado: true },
  { id: "firebase",   label: "Firebase (Firestore, Blaze)",      usd_month: 0,  note: "Pago por uso: lecturas y escrituras. Con pocas tiendas entra en el gratis.", estimado: true },
  { id: "dominio",    label: "Dominio recurrentesapp.com",       usd_month: 2,  note: "Squarespace, se paga por año.", estimado: true },
  { id: "workspace",  label: "Google Workspace (soporte@)",      usd_month: 7,  note: "La casilla que agenda las demos.", estimado: true },
  { id: "zadarma",    label: "Número de WhatsApp (Zadarma)",     usd_month: 3,  note: "+1 305 686 9014.", estimado: true },
  { id: "resend",     label: "Resend (mails)",                   usd_month: 0,  note: "Gratis hasta 3.000 mails por mes; después USD 20.", estimado: true },
  { id: "meta_wa",    label: "WhatsApp Cloud API (Meta)",        usd_month: 0,  note: "Se calcula abajo con el uso real del mes.", calculado: "whatsapp" },
];

// Vercel Pro: lo que incluye antes de cobrar aparte (documentación pública de Vercel,
// sept-2026; si cambian, cambiar acá).
export const VERCEL_PRO = { invocations_month: 1_000_000, crons: 40, cron_min_interval_min: 1 };
export const VERCEL_HOBBY = { invocations_month: 100_000, crons: 2, cron_min_interval_min: 1440 };

// Corridas por día de una expresión cron simple ("*/5 * * * *", "17 * * * *", "0 9 * * *").
export function cronRunsPerDay(expr) {
  const [min, hour] = String(expr || "").trim().split(/\s+/);
  const stepMin = /^\*\/(\d+)$/.exec(min || "");
  const stepHour = /^\*\/(\d+)$/.exec(hour || "");
  if (stepMin) return Math.floor(1440 / Number(stepMin[1]));
  if (hour === "*") return 24;           // "17 * * * *" → una vez por hora
  if (stepHour) return Math.floor(24 / Number(stepHour[1]));
  return 1;                              // "0 9 * * *" → diario
}

export function cronsReport(crons = []) {
  const rows = crons.map((c) => {
    const action = (String(c.path || "").match(/action=([a-z-]+)/) || [])[1] || c.path;
    const perDay = cronRunsPerDay(c.schedule);
    return { action, schedule: c.schedule, runs_day: perDay, runs_month: perDay * 30 };
  });
  const total = rows.reduce((t, r) => t + r.runs_month, 0);
  const minInterval = rows.length ? Math.min(...rows.map((r) => 1440 / Math.max(1, r.runs_day))) : 1440;
  return { rows, runs_month: total, count: rows.length, min_interval_min: minInterval };
}

function readVercelCrons() {
  try {
    const require = createRequire(import.meta.url);
    const v = require("../../vercel.json");
    return Array.isArray(v?.crons) ? v.crons : [];
  } catch (_) { return []; }
}

export async function costsReport({ now = Date.now() } = {}) {
  const [snap, usage] = await Promise.all([
    db().collection(DOC[0]).doc(DOC[1]).get().catch(() => null),
    db().collection("admin_usage").doc(waUsageMonth(new Date(now))).get().catch(() => null),
  ]);
  const saved = snap?.exists ? (snap.data() || {}) : {};
  const savedItems = Array.isArray(saved.items) ? saved.items : [];
  const items = DEFAULT_ITEMS.map((d) => {
    const s = savedItems.find((x) => x.id === d.id);
    return s ? { ...d, ...s, estimado: false } : { ...d };
  });
  for (const s of savedItems) if (!items.some((i) => i.id === s.id)) items.push({ ...s, estimado: false });

  const u = usage?.exists ? (usage.data() || {}) : {};
  const wa = { month: waUsageMonth(new Date(now)), sent: Number(u.wa_sent) || 0, meta_cost_usd: Number(u.wa_meta_cost_usd) || 0, billed_usd: Number(u.wa_cost_usd) || 0 };
  const metaItem = items.find((i) => i.calculado === "whatsapp");
  if (metaItem) metaItem.usd_month = Math.round(wa.meta_cost_usd * 100) / 100;

  const crons = cronsReport(readVercelCrons());
  const plan = saved.vercel_plan === "hobby" ? "hobby" : "pro";
  const limits = plan === "hobby" ? VERCEL_HOBBY : VERCEL_PRO;

  // Avisos: lo que se acerca a un límite o no cierra con el plan.
  const warnings = [];
  if (crons.count > limits.crons) warnings.push(`Tenés ${crons.count} crons y el plan ${plan === "hobby" ? "Hobby" : "Pro"} de Vercel permite ${limits.crons}.`);
  if (crons.min_interval_min < limits.cron_min_interval_min) warnings.push(`Hay crons cada ${crons.min_interval_min} min: en Hobby solo corren una vez por día. Hace falta Pro.`);
  const pct = limits.invocations_month ? crons.runs_month / limits.invocations_month : 0;
  if (pct >= 0.8) warnings.push(`Los crons solos usan el ${Math.round(pct * 100)}% de las invocaciones incluidas (${crons.runs_month.toLocaleString("es-AR")} de ${limits.invocations_month.toLocaleString("es-AR")}). Lo que pase de ahí se cobra aparte.`);
  if (wa.meta_cost_usd > 50) warnings.push(`WhatsApp ya lleva USD ${wa.meta_cost_usd.toFixed(2)} este mes en Meta (se les cobra a las tiendas con recargo, pero la factura la paga Recurrentes).`);

  const fixed = items.filter((i) => !i.calculado).reduce((t, i) => t + (Number(i.usd_month) || 0), 0);
  const total = fixed + wa.meta_cost_usd;
  return {
    items, vercel_plan: plan, limits,
    crons: { ...crons, pct_of_included: Math.round(pct * 1000) / 10 },
    whatsapp: wa,
    totals: { fixed_usd_month: Math.round(fixed * 100) / 100, total_usd_month: Math.round(total * 100) / 100 },
    warnings,
    updated_at: saved.updated_at || null,
  };
}

// Guarda la lista (solo lo editable: label, usd_month, note) y el plan de Vercel.
export async function saveCosts(admin, body = {}) {
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((i) => ({
    id: String(i.id || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || null,
    label: String(i.label || "").trim().slice(0, 80),
    usd_month: Math.max(0, Math.min(100000, Number(i.usd_month) || 0)),
    note: String(i.note || "").trim().slice(0, 200),
  })).filter((i) => i.id && i.label);
  const vercel_plan = body.vercel_plan === "hobby" ? "hobby" : "pro";
  await db().collection(DOC[0]).doc(DOC[1]).set({ items, vercel_plan, updated_at: new Date().toISOString(), updated_by: admin?.email || null }, { merge: true });
  return { ok: true };
}
