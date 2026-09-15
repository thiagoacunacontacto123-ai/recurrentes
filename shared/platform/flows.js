// Flujos de email propios de Recurrentes — definición compartida (api/ + src/).
// Un flujo = un disparador + pasos en orden: "esperar" o "mandar un mail".
// El motor vive en api/_lib/flows.js; el editor en src/pages/Flows.jsx.
//
// Cada disparador define cuándo alguien SIGUE en el flujo (keep / avoid): antes
// de cada mail el motor relee la suscripción y, si ya no corresponde (pagó,
// recuperó la tarjeta, se reactivó…), la saca. `goal` marca qué salida cuenta
// como "recuperado" en las métricas.

export const FLOW_MAX_FLOWS = 30;
export const FLOW_MAX_STEPS = 12;
export const FLOW_MAX_EMAILS = 6;
export const FLOW_MAX_WAIT_DAYS = 90;

export const FLOW_TRIGGERS = [
  { id:"checkout_started", label:"Checkout sin pagar", icon:"🛒", desc:"Dejó sus datos en el checkout de suscripción y no terminó de pagar.",
    exit:"Sale apenas paga, o si ya tiene otra suscripción activa.", keep:["pending"], goal:"paid", marketing:true, cta:"checkout" },
  { id:"activated", label:"Nueva suscripción", icon:"🎉", desc:"Se aprobó el primer cobro. Ideal para bienvenida y consejos de uso.",
    exit:"Sale si cancela.", avoid:["cancelled"], cta:"portal" },
  { id:"upcoming_charge", label:"Próximo cobro", icon:"📅", desc:"Unos días antes de cada renovación.",
    exit:"Sale si la suscripción deja de estar activa.", keep:["active"], cta:"portal", days:true },
  { id:"renewed", label:"Renovación cobrada", icon:"🔁", desc:"Cada cobro después del primero.",
    exit:"Sale si cancela.", avoid:["cancelled"], cta:"portal" },
  { id:"payment_failed", label:"Pago rechazado", icon:"💳", desc:"Mercado Pago no pudo cobrar una renovación.",
    exit:"Sale cuando el pago se recupera, o si cancela.", keep:["payment_failed"], goal:"recovered", cta:"portal" },
  { id:"paused", label:"Suscripción pausada", icon:"⏸", desc:"Pausó desde el portal o la pausaste vos desde el panel.",
    exit:"Sale cuando la reactiva.", keep:["paused"], cta:"portal" },
  { id:"resumed", label:"Suscripción reactivada", icon:"▶", desc:"Volvió a activar una suscripción pausada.",
    exit:"Sale si vuelve a pausar o cancela.", keep:["active"], cta:"portal" },
  { id:"cancelled", label:"Suscripción cancelada", icon:"👋", desc:"Para intentar recuperarlo más adelante (win-back).",
    exit:"Sale si se vuelve a suscribir.", keep:["cancelled"], goal:"winback", marketing:true, cta:"checkout" },
];
export const TRIGGER_BY_ID = Object.fromEntries(FLOW_TRIGGERS.map(t => [t.id, t]));

// Variables que el comerciante puede usar en asunto, mensaje y botón: {{nombre}}.
export const FLOW_VARIABLES = [
  { key:"nombre",        label:"Nombre",            sample:"Ana" },
  { key:"producto",      label:"Producto",          sample:"Cápsulas LuminaLabs" },
  { key:"monto",         label:"Monto por cobro",   sample:"$9.480" },
  { key:"marca",         label:"Tu marca",          sample:"Tu marca" },
  { key:"proximo_cobro", label:"Fecha próximo cobro", sample:"15 de octubre" },
  { key:"link_portal",   label:"Link del portal",   sample:"https://recurrentesapp.com/#/portal" },
  { key:"link_checkout", label:"Link para retomar", sample:"https://tu-tienda.com/products/tu-producto" },
];

export const CTA_OPTIONS = [
  { id:"none",     label:"Sin botón" },
  { id:"portal",   label:"Portal del cliente" },
  { id:"checkout", label:"Retomar / volver a suscribirse" },
];

export const WAIT_UNITS = { minutes: 60e3, hours: 3600e3, days: 86400e3 };
export const WAIT_UNIT_LABEL = { minutes:["minuto","minutos"], hours:["hora","horas"], days:["día","días"] };

export const renderVars = (text, vars) =>
  String(text || "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""));

export const waitMs = (step) => Math.max(0, Number(step?.amount) || 0) * (WAIT_UNITS[step?.unit] || WAIT_UNITS.hours);

export function fmtWait(step) {
  const n = Math.max(0, Number(step?.amount) || 0);
  const [one, many] = WAIT_UNIT_LABEL[step?.unit] || WAIT_UNIT_LABEL.hours;
  return `${n} ${n === 1 ? one : many}`;
}

let _seq = 0;
export const newStepId = () => "s" + Date.now().toString(36) + (_seq++).toString(36);

// "2 mails · en 1 día" — resumen para las listas.
export function flowSummary(flow) {
  const steps = Array.isArray(flow?.steps) ? flow.steps : [];
  const emails = steps.filter(s => s.type === "email").length;
  const total = steps.filter(s => s.type === "wait").reduce((a, s) => a + waitMs(s), 0);
  const span = total >= WAIT_UNITS.days ? `${Math.round(total / WAIT_UNITS.days)} día${Math.round(total / WAIT_UNITS.days) === 1 ? "" : "s"}`
    : total >= WAIT_UNITS.hours ? `${Math.round(total / WAIT_UNITS.hours)} h`
    : total > 0 ? `${Math.round(total / WAIT_UNITS.minutes)} min` : "al instante";
  return `${emails} mail${emails === 1 ? "" : "s"} · ${span}`;
}

// Plantilla inicial de cada disparador (el comerciante la edita antes de activar).
export function defaultFlow(triggerId) {
  const T = TRIGGER_BY_ID[triggerId];
  const W = (amount, unit) => ({ id:newStepId(), type:"wait", amount, unit });
  const E = (subject, body, cta_label = "", cta = "none") => ({ id:newStepId(), type:"email", subject, body, cta, cta_label });
  const steps = {
    checkout_started: [
      W(1, "hours"),
      E("¿Te quedó algo pendiente, {{nombre}}?", "Vimos que empezaste tu suscripción a {{producto}} pero no llegaste a terminar el pago.\n\nTe la guardamos: retomás en 1 clic, justo donde la dejaste.", "Terminar mi suscripción", "checkout"),
      W(1, "days"),
      E("Tu {{producto}} te sigue esperando", "Seguís a tiempo de suscribirte a {{producto}}. Te llega solo en cada ciclo y cancelás cuando quieras.", "Retomar", "checkout"),
    ],
    activated: [
      W(3, "days"),
      E("¿Cómo te está yendo con {{producto}}?", "Hola {{nombre}}, ya pasaron unos días desde que te suscribiste.\n\nDesde tu portal podés pausar, cambiar la dirección o cancelar cuando quieras, sin escribirnos.", "Ir a mi portal", "portal"),
    ],
    upcoming_charge: [
      E("Tu próximo cobro es el {{proximo_cobro}}", "Hola {{nombre}}, te avisamos que el {{proximo_cobro}} se renueva tu suscripción a {{producto}} por {{monto}}.\n\nSi necesitás pausar o cambiar algo, lo hacés desde tu portal.", "Ver mi suscripción", "portal"),
    ],
    renewed: [
      E("¡Gracias por seguir con nosotros!", "Hola {{nombre}}, ya procesamos la renovación de {{producto}}. Gracias por seguir eligiéndonos."),
    ],
    payment_failed: [
      W(2, "days"),
      E("Seguimos sin poder cobrar tu {{producto}}", "Hola {{nombre}}, Mercado Pago todavía no pudo cobrar tu suscripción. Actualizá tu tarjeta en 1 minuto para no perderla.", "Actualizar mi tarjeta", "portal"),
      W(3, "days"),
      E("Último aviso sobre tu suscripción", "Si no actualizás el medio de pago, tu suscripción a {{producto}} se va a cancelar.", "Actualizar mi tarjeta", "portal"),
    ],
    paused: [
      E("Tu suscripción quedó en pausa", "Hola {{nombre}}, pausamos tu suscripción a {{producto}}. Cuando quieras retomarla, entrá a tu portal.", "Ir a mi portal", "portal"),
    ],
    resumed: [
      E("¡Qué bueno tenerte de vuelta!", "Hola {{nombre}}, reactivamos tu suscripción a {{producto}}. Tu próximo cobro es el {{proximo_cobro}}.", "Ver mi suscripción", "portal"),
    ],
    cancelled: [
      W(14, "days"),
      E("Te extrañamos, {{nombre}}", "Hace unos días cancelaste tu suscripción a {{producto}}. Si querés volver, te la dejamos lista en 1 clic.", "Volver a suscribirme", "checkout"),
    ],
  }[triggerId] || [];
  const flow = { name: T ? T.label : "Nuevo flujo", trigger: triggerId, active: false, steps };
  if (T?.days) flow.days_before = 3;
  return flow;
}

// Valida y limpia un flujo que viene del panel → { flow } | { error }.
export function sanitizeFlow(input) {
  const f = input || {};
  const T = TRIGGER_BY_ID[f.trigger];
  if (!T) return { error: "Elegí un disparador válido" };
  const name = String(f.name || "").trim().slice(0, 80) || T.label;
  const raw = Array.isArray(f.steps) ? f.steps : [];
  if (raw.length > FLOW_MAX_STEPS) return { error: `Máximo ${FLOW_MAX_STEPS} pasos por flujo` };
  const steps = [];
  let emails = 0;
  for (const s of raw) {
    const id = /^[a-z0-9]{2,32}$/i.test(String(s?.id || "")) ? String(s.id) : newStepId();
    if (s?.type === "wait") {
      const unit = WAIT_UNITS[s.unit] ? s.unit : "hours";
      const amount = Math.max(1, Math.floor(Number(s.amount) || 0));
      if (amount * WAIT_UNITS[unit] > FLOW_MAX_WAIT_DAYS * WAIT_UNITS.days) return { error: `Una espera no puede superar ${FLOW_MAX_WAIT_DAYS} días` };
      steps.push({ id, type: "wait", amount, unit });
    } else if (s?.type === "email") {
      const subject = String(s.subject || "").trim().slice(0, 150);
      const body = String(s.body || "").trim().slice(0, 5000);
      if (!subject) return { error: `El mail ${emails + 1} necesita un asunto` };
      if (!body) return { error: `El mail ${emails + 1} necesita un mensaje` };
      const cta = CTA_OPTIONS.some(c => c.id === s.cta) ? s.cta : "none";
      const cta_label = cta === "none" ? "" : (String(s.cta_label || "").trim().slice(0, 40) || (cta === "portal" ? "Ir a mi portal" : "Retomar"));
      steps.push({ id, type: "email", subject, body, cta, cta_label });
      emails++;
    }
  }
  if (!emails) return { error: "El flujo necesita al menos un mail" };
  if (emails > FLOW_MAX_EMAILS) return { error: `Máximo ${FLOW_MAX_EMAILS} mails por flujo` };
  const flow = { name, trigger: T.id, active: f.active === true, steps };
  if (T.days) flow.days_before = Math.min(14, Math.max(1, Math.floor(Number(f.days_before) || 3)));
  return { flow };
}
