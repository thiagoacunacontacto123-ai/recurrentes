// WhatsApp (Cloud API oficial de Meta) — definición compartida (api/ + src/).
//
// - normalizePhoneAR: teléfono → E.164 (+549… para celulares de Argentina).
//   Mismo criterio que normalizeWhatsapp (api/merchant.js / src/lib/signup.js en
//   main) y además entiende el "15" y el "54" sin 9: 11 15 6411-7974 → +5491164117974.
// - WA_TEMPLATES: las plantillas que Recurrentes sugiere mandar a aprobar a Meta
//   (categoría UTILITY, es_AR), con su texto exacto y qué dato va en cada {{n}}.
// - sanitizeWhatsappStep: valida el paso "whatsapp" de un flujo (lo usa sanitizeFlow).
//
// Sin imports de flows.js a propósito (flows.js importa de acá: nada circular).

export const WA_DEFAULT_LANG = "es_AR";
export const WA_MAX_VARS = 10;
export const WA_TEMPLATE_NAME_RE = /^[a-z0-9_]{1,512}$/;
export const WA_LANG_RE = /^[a-z]{2,3}(_[A-Z]{2,3})?$/;

// Códigos de idioma de plantillas de Meta (ojo: México es es_MEX, no es_MX).
export const WA_LANGS = [
  { id: "es_AR", label: "Español (Argentina)" },
  { id: "es",    label: "Español" },
  { id: "es_MEX", label: "Español (México)" },
  { id: "es_ES", label: "Español (España)" },
  { id: "en_US", label: "Inglés (EE.UU.)" },
  { id: "pt_BR", label: "Portugués (Brasil)" },
];

// Respuestas del cliente que cuentan como baja / alta de los avisos por WhatsApp
// (el webhook las mira en los mensajes entrantes y en los botones de respuesta rápida).
export const WA_OPTOUT_RE = /^\s*(baja|stop|parar|basta|no\s+quiero(\s+m[aá]s)?|desuscribir(me)?|cancelar\s+avisos)\s*[.!]*\s*$/i;
export const WA_OPTIN_RE = /^\s*(alta|start|volver|quiero\s+avisos)\s*[.!]*\s*$/i;

// ── Teléfonos ──────────────────────────────────────────────────────
// Número nacional argentino de 10 dígitos (área + abonado) a partir de lo que
// escriba la gente: saca el 0 de larga distancia y el 15 de celular.
function arNational(n) {
  if (n.startsWith("0")) n = n.slice(1);
  if (n.length === 12) {
    // área (2 a 4 dígitos) + 15 + abonado. CABA/AMBA = 11.
    for (const a of n.startsWith("11") ? [2] : [3, 4, 2]) {
      if (n.slice(a, a + 2) === "15") return n.slice(0, a) + n.slice(a + 2);
    }
    return null;
  }
  return n.length === 10 ? n : null;
}

// → "+5491164117974" | "+14155551234" | null
export function normalizePhoneAR(raw) {
  const s = String(raw || "").trim();
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  const intl = s.startsWith("+") || d.startsWith("00");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54") && (intl || d.length >= 12)) {
    let n = d.slice(2);
    if (n.startsWith("9")) n = n.slice(1);
    n = arNational(n);
    return n ? "+549" + n : null;
  }
  if (intl) return d.length >= 8 && d.length <= 15 ? "+" + d : null;   // otro país, con su código
  const n = arNational(d);
  if (n) return "+549" + n;
  if (d.length >= 11 && d.length <= 15) return "+" + d;                 // otro país sin "+"
  return null;
}

// "to" que espera la Cloud API: solo dígitos con código de país.
export const waRecipient = (raw) => { const e = normalizePhoneAR(raw); return e ? e.slice(1) : null; };

// +5491164117974 → +54911••••7974 (para logs y pantallas).
export function maskPhone(e164) {
  const s = String(e164 || "");
  if (s.length < 9) return s ? "••••" : "";
  return s.slice(0, 6) + "••••" + s.slice(-4);
}

// ── Parámetros de plantilla ────────────────────────────────────────
// Meta rechaza parámetros vacíos, con saltos de línea / tabs o con más de 4
// espacios seguidos. Cap de 1024 caracteres por parámetro de cuerpo.
export function waParamText(v, fallback = "-") {
  const t = String(v ?? "").replace(/[ ]*[\r\n\t]+[\s]*/g, " ").replace(/ {4,}/g, "   ").trim().slice(0, 1024);
  return t || fallback;
}

// Qué poner si el dato del cliente falta (un parámetro vacío hace fallar el envío).
export const WA_VAR_FALLBACK = {
  nombre: "cliente",
  producto: "tu suscripción",
  monto: "el monto de tu plan",
  marca: "la tienda",
  proximo_cobro: "los próximos días",
  link_portal: "",
  link_checkout: "",
  link_checkout: "",
};

// {{1}}, {{2}}… de un texto → cantidad de variables (la más alta).
export function templateVarCount(body) {
  let max = 0;
  String(body || "").replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (_, n) => { max = Math.max(max, Number(n)); return ""; });
  return max;
}

// Texto de la plantilla con los datos puestos (vista previa del panel y tests).
export function renderTemplateBody(body, varsMap, values) {
  return String(body || "").replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (m, n) => {
    const key = varsMap?.[n];
    if (!key) return m;
    return waParamText(values?.[key], WA_VAR_FALLBACK[key] || "-");
  });
}

// Lista ordenada de valores para los parámetros {{1}}..{{n}} del cuerpo.
export function templateParams(varsMap, values) {
  const n = Object.keys(varsMap || {}).filter(k => /^\d{1,2}$/.test(k)).reduce((a, k) => Math.max(a, Number(k)), 0);
  const out = [];
  for (let i = 1; i <= n; i++) {
    const key = varsMap[String(i)];
    out.push(waParamText(values?.[key], WA_VAR_FALLBACK[key] || "-"));
  }
  return out;
}

// ── Paso "whatsapp" de un flujo ─────────────────────────────────────
//   { id, type:"whatsapp", template, lang, vars: { "1":"nombre", "2":"producto", … } }
// Las variables tienen que ser consecutivas desde {{1}} (Meta las pide en orden).
export function sanitizeWhatsappStep(s, allowedKeys, n = 1) {
  const template = String(s?.template || "").trim().toLowerCase();
  if (!template) return { error: `El WhatsApp ${n} necesita el nombre de una plantilla aprobada` };
  if (!WA_TEMPLATE_NAME_RE.test(template)) return { error: `El nombre de plantilla del WhatsApp ${n} solo lleva minúsculas, números y guión bajo` };
  const lang = WA_LANG_RE.test(String(s?.lang || "")) ? String(s.lang) : WA_DEFAULT_LANG;
  const raw = s?.vars && typeof s.vars === "object" && !Array.isArray(s.vars) ? s.vars : {};
  const nums = Object.keys(raw).filter(k => /^\d{1,2}$/.test(k)).map(Number).sort((a, b) => a - b);
  if (nums.length > WA_MAX_VARS) return { error: `El WhatsApp ${n} admite hasta ${WA_MAX_VARS} variables` };
  const vars = {};
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) return { error: `Las variables del WhatsApp ${n} tienen que ir en orden: {{1}}, {{2}}, {{3}}…` };
    const key = String(raw[String(nums[i])] || "");
    if (!allowedKeys.includes(key)) return { error: `Elegí qué dato va en {{${nums[i]}}} del WhatsApp ${n}` };
    vars[String(nums[i])] = key;
  }
  return { step: { type: "whatsapp", template, lang, vars } };
}

// ── Plantillas de Recurrentes (aprobadas en Meta) ──────────────────
// Texto exacto a cargar en WhatsApp Manager → Plantillas de mensajes → Crear.
// Son las que usa el NÚMERO DE RECURRENTES (uno solo, habla por muchas tiendas):
// por eso TODAS llevan el nombre de la tienda como variable. Las mismas sirven
// de sugerencia para quien conecta su propio número.
// Categoría UTILITY (avisos de una suscripción que el cliente ya tiene): son más
// baratas que las de marketing. Sin variables al principio ni al final del cuerpo,
// y sin dos variables pegadas (Meta las rechaza).
export const WA_FOOTER = "Respondé BAJA para no recibir más avisos.";
export const WA_TEMPLATES = [
  {
    // Carrito sin pagar: el que más se usa. Es MARKETING para Meta (recordatorio de
    // compra): cuesta más que las de utilidad; el precio sale por categoría.
    name: "carrito_sin_pagar", category: "MARKETING", lang: "es_AR", trigger: "checkout_started",
    title: "Carrito sin pagar",
    body: "Hola {{1}}, dejaste a medio camino tu suscripción a {{2}} de {{3}}.\n\nSi querés retomarla, este es tu link: {{4}}\n\nSi ya la completaste, ignorá este mensaje.",
    footer: WA_FOOTER,
    vars: { "1": "nombre", "2": "producto", "3": "marca", "4": "link_checkout" },
    samples: ["Ana", "Cápsulas LuminaLabs", "LuminaLabs", "https://www.recurrentesapp.com/#/checkout"],
  },
  {
    name: "aviso_proximo_cobro", category: "UTILITY", lang: "es_AR", trigger: "upcoming_charge",
    title: "Aviso de próximo cobro",
    body: "Hola {{1}}, te escribimos de parte de {{2}}: el {{3}} se renueva tu suscripción a {{4}} por {{5}}.\n\nSi querés pausarla o cambiar algo: {{6}}\n\nEs un aviso automático, no hace falta que respondas.",
    footer: WA_FOOTER,
    vars: { "1": "nombre", "2": "marca", "3": "proximo_cobro", "4": "producto", "5": "monto", "6": "link_portal" },
    samples: ["Ana", "LuminaLabs", "15 de octubre", "Cápsulas LuminaLabs", "$9.480", "https://www.recurrentesapp.com/#/portal"],
  },
  {
    name: "pago_rechazado", category: "UTILITY", lang: "es_AR", trigger: "payment_failed",
    title: "Pago rechazado",
    body: "Hola {{1}}, no pudimos cobrar la renovación de tu suscripción a {{2}} de {{3}}.\n\nPara no perderla, actualizá tu tarjeta desde tu portal: {{4}}\n\nSi ya lo resolviste, ignorá este mensaje.",
    footer: WA_FOOTER,
    vars: { "1": "nombre", "2": "producto", "3": "marca", "4": "link_portal" },
    samples: ["Ana", "Cápsulas LuminaLabs", "LuminaLabs", "https://www.recurrentesapp.com/#/portal"],
  },
  {
    name: "suscripcion_activa", category: "UTILITY", lang: "es_AR", trigger: "activated",
    title: "Suscripción activa",
    body: "¡Hola {{1}}! Tu suscripción a {{2}} de {{3}} ya está activa. Tu próximo cobro es el {{4}}.\n\nDesde tu portal podés pausarla, cambiar la dirección o cancelarla cuando quieras: {{5}}\n\nGracias por sumarte.",
    footer: WA_FOOTER,
    vars: { "1": "nombre", "2": "producto", "3": "marca", "4": "proximo_cobro", "5": "link_portal" },
    samples: ["Ana", "Cápsulas LuminaLabs", "LuminaLabs", "15 de octubre", "https://www.recurrentesapp.com/#/portal"],
  },
  {
    name: "renovacion_cobrada", category: "UTILITY", lang: "es_AR", trigger: "renewed",
    title: "Renovación cobrada",
    body: "Hola {{1}}, te escribimos de parte de {{2}}: ya se cobró la renovación de tu suscripción a {{3}} por {{4}}. Tu próximo cobro es el {{5}}.\n\nTu portal, por si necesitás cambiar algo: {{6}}\n\nGracias por seguir con nosotros.",
    footer: WA_FOOTER,
    vars: { "1": "nombre", "2": "marca", "3": "producto", "4": "monto", "5": "proximo_cobro", "6": "link_portal" },
    samples: ["Ana", "LuminaLabs", "Cápsulas LuminaLabs", "$9.480", "15 de noviembre", "https://www.recurrentesapp.com/#/portal"],
  },
];
export const WA_TEMPLATE_BY_NAME = Object.fromEntries(WA_TEMPLATES.map(t => [t.name, t]));

// ── Número de Recurrentes ─────────────────────────────────────────
// ¿El checkout / widget ofrece la casilla "Quiero que me avisen por WhatsApp"?
// Sí si la tienda tiene su propio número conectado, o si prendió los avisos desde
// el número de Recurrentes y ese número está configurado (platformAvailable sale
// del backend: acá no se leen variables de entorno).
export function waOptinOffered(m, platformAvailable) {
  if (!m) return false;
  if (m.whatsapp_phone_number_id && m.whatsapp_access_token) return true;
  return m.whatsapp_platform_enabled === true && Boolean(platformAvailable);
}

// Mes de facturación del uso (hora de Argentina): "2026-09".
export const waUsageMonth = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 7);

// ── Avisos al COMERCIANTE (dueño de la tienda) ─────────────────────
// Mismo número de Recurrentes, pero el destinatario es el dueño de la tienda: le
// avisa cuando un cliente se suscribe, pausa, cancela o tiene una renovación
// rechazada. Plantillas UTILITY aparte de WA_TEMPLATES (esas son para clientes y
// las usa el editor de flujos). Api: api/_lib/merchantAlerts.js.
// Configuración en el doc de la tienda:
//   alerts_whatsapp_enabled (bool) · alerts_whatsapp (E.164; vacío = owner_whatsapp)
//   alerts_events { subscribed, paused, cancelled, payment_failed } (faltan = true)
//   alerts_email (bool, falta = true): "también por mail".
export const ALERTS_PANEL_URL = "https://www.recurrentesapp.com/#/dashboard/suscripciones";
// Facturacion: donde activa el plan (avisos del limite del plan gratis).
export const BILLING_PANEL_URL = "https://www.recurrentesapp.com/#/dashboard/configuracion/facturacion";
export const WA_MERCHANT_FOOTER = "Podés apagar estos avisos desde tu panel de Recurrentes.";
export const ALERT_EVENTS = [
  { id: "subscribed",     label: "Alguien se suscribe",               template: "aviso_comercio_alta" },
  { id: "paused",         label: "Alguien pausa su suscripción",      template: "aviso_comercio_pausa" },
  { id: "cancelled",      label: "Alguien cancela su suscripción",    template: "aviso_comercio_baja" },
  { id: "payment_failed", label: "Se rechaza el pago de una renovación", template: "aviso_comercio_pago_rechazado" },
  // El "cachín": Shopify y Tiendanube no suenan para órdenes creadas por API, así
  // que el aviso de cada cobro lo damos nosotros. Llega en segundos (medido: 3 a 5
  // desde que Mercado Pago aprueba) y funciona igual en las tres plataformas.
  { id: "renewed",        label: "Se cobra una renovación",            template: "aviso_comercio_cobro" },
];
export const ALERT_EVENT_IDS = ALERT_EVENTS.map(e => e.id);
// vars: qué dato va en cada {{n}}. Claves: marca, nombre (solo el nombre de pila), producto, monto, link_panel.
export const WA_MERCHANT_TEMPLATES = [
  {
    name: "aviso_comercio_alta", event: "subscribed", category: "UTILITY", lang: "es_AR",
    title: "Nueva suscripción (aviso al comercio)",
    body: "🎉 Nueva suscripción en {{1}}: {{2}} se suscribió a {{3}} por {{4}}.\n\nMirala en tu panel: {{5}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_MERCHANT_FOOTER,
    vars: { "1": "marca", "2": "nombre", "3": "producto", "4": "monto", "5": "link_panel" },
    samples: ["LuminaLabs", "Ana", "Cápsulas LuminaLabs", "$9.480", ALERTS_PANEL_URL],
  },
  {
    name: "aviso_comercio_pausa", event: "paused", category: "UTILITY", lang: "es_AR",
    title: "Suscripción pausada (aviso al comercio)",
    body: "Se pausó una suscripción en {{1}}: la de {{2}} a {{3}}.\n\nMirala en tu panel: {{4}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_MERCHANT_FOOTER,
    vars: { "1": "marca", "2": "nombre", "3": "producto", "4": "link_panel" },
    samples: ["LuminaLabs", "Ana", "Cápsulas LuminaLabs", ALERTS_PANEL_URL],
  },
  {
    name: "aviso_comercio_baja", event: "cancelled", category: "UTILITY", lang: "es_AR",
    title: "Suscripción cancelada (aviso al comercio)",
    body: "Se canceló una suscripción en {{1}}: la de {{2}} a {{3}}.\n\nMirala en tu panel: {{4}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_MERCHANT_FOOTER,
    vars: { "1": "marca", "2": "nombre", "3": "producto", "4": "link_panel" },
    samples: ["LuminaLabs", "Ana", "Cápsulas LuminaLabs", ALERTS_PANEL_URL],
  },
  {
    name: "aviso_comercio_pago_rechazado", event: "payment_failed", category: "UTILITY", lang: "es_AR",
    title: "Renovación rechazada (aviso al comercio)",
    body: "No se pudo cobrar una renovación en {{1}}: el pago de {{2}} por {{3}} ({{4}}) fue rechazado.\n\nMirala en tu panel: {{5}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_MERCHANT_FOOTER,
    vars: { "1": "marca", "2": "nombre", "3": "producto", "4": "monto", "5": "link_panel" },
    samples: ["LuminaLabs", "Ana", "Cápsulas LuminaLabs", "$9.480", ALERTS_PANEL_URL],
  },
  {
    name: "aviso_comercio_cobro", event: "renewed", category: "UTILITY", lang: "es_AR",
    title: "Cobro de renovación (aviso al comercio)",
    body: "💰 Cobro en {{1}}: {{2}} pagó {{3}} de {{4}}. La orden ya está en tu tienda.\n\nMirala en tu panel: {{5}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_MERCHANT_FOOTER,
    vars: { "1": "marca", "2": "nombre", "3": "monto", "4": "producto", "5": "link_panel" },
    samples: ["LuminaLabs", "Ana", "$9.480", "Cápsulas LuminaLabs", ALERTS_PANEL_URL],
  },
];

// ─── Avisos del LÍMITE DEL PLAN GRATIS ──────────────────────────────────────
// Son sobre la CUENTA del comerciante (no sobre sus clientes), así que salen
// SIEMPRE: no dependen de alerts_whatsapp_enabled ni de alerts_events. Si le
// vamos a apagar el widget, se tiene que enterar.
// Los tres repiten la frase clave: los suscriptores que ya tiene se siguen cobrando.
// Pie de los avisos del plan: NO se pueden apagar (son sobre la cuenta), así que
// no podemos prometer lo mismo que en los avisos de clientes.
export const WA_PLAN_FOOTER = "Sobre tu plan de Recurrentes. Este aviso no se puede apagar.";
export const WA_PLAN_TEMPLATES = [
  // Redactadas como AVISO DE ESTADO DE CUENTA (categoría Utilidad). La primera
  // versión ("te damos 5 de regalo", "no pares de vender") Meta la reclasificó como
  // Marketing (5× más cara y con reglas más duras): por eso los nombres nuevos.
  {
    name: "aviso_plan_gracia", event: "plan_grace", category: "UTILITY", lang: "es_AR",
    title: "Pasaste el plan gratis (aviso al comercio)",
    body: "Aviso sobre el estado de tu cuenta de Recurrentes: {{1}} tiene {{2}} suscriptores activos y tu plan gratis incluye hasta {{3}}.\n\nEstás dentro del período de tolerancia de {{4}} suscriptores. Si lo superás sin tener un plan activo, el widget dejará de mostrarse en tu tienda y no entrarán suscripciones nuevas. Tus suscriptores actuales se siguen cobrando con normalidad.\n\nPara evitar la interrupción, completá la activación del plan en tu panel: {{5}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_PLAN_FOOTER,
    vars: { "1": "marca", "2": "subs", "3": "free", "4": "gracia", "5": "link_panel" },
    samples: ["LuminaLabs", "11", "10", "5", BILLING_PANEL_URL],
  },

  {
    name: "aviso_plan_borde", event: "plan_last_call", category: "UTILITY", lang: "es_AR",
    title: "Un suscriptor más y se apaga (aviso al comercio)",
    body: "Aviso sobre el estado de tu cuenta de Recurrentes: {{1}} tiene {{2}} suscriptores activos y llegó al límite del período de tolerancia.\n\nCon la próxima suscripción, el widget dejará de mostrarse en tu tienda y no entrarán suscripciones nuevas. Tus suscriptores actuales se siguen cobrando con normalidad.\n\nPara evitar la interrupción, completá la activación del plan en tu panel: {{3}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_PLAN_FOOTER,
    vars: { "1": "marca", "2": "subs", "3": "link_panel" },
    samples: ["LuminaLabs", "15", BILLING_PANEL_URL],
  },
  {
    name: "aviso_plan_bloqueado", event: "plan_blocked", category: "UTILITY", lang: "es_AR",
    title: "Widget apagado (aviso al comercio)",
    body: "Aviso sobre el estado de tu cuenta de Recurrentes: el widget de {{1}} está desactivado. La tienda llegó a {{2}} suscriptores activos sin un plan activo y no entran suscripciones nuevas. Tu página de producto quedó como estaba antes.\n\nTus suscriptores actuales se siguen cobrando con normalidad y cada cobro sigue generando su orden.\n\nPara reactivarlo, completá la activación del plan en tu panel: {{3}}\n\nEs un aviso automático de Recurrentes.",
    footer: WA_PLAN_FOOTER,
    vars: { "1": "marca", "2": "subs", "3": "link_panel" },
    samples: ["LuminaLabs", "16", BILLING_PANEL_URL],
  },
];
export const WA_PLAN_TEMPLATE_BY_EVENT = Object.fromEntries(WA_PLAN_TEMPLATES.map(t => [t.event, t]));
export const PLAN_ALERT_EVENTS = WA_PLAN_TEMPLATES.map(t => t.event);

// ─── Aviso INTERNO al equipo de Recurrentes (Thiago) ────────────────────────
// Una sola plantilla genérica para todo el ramal admin (registro con número,
// pago del plan, baja, gracia/bloqueo): Meta aprueba 1 y cualquier evento nuevo
// entra sin plantilla nueva. Va al WhatsApp del dueño de la cuenta admin.
export const WA_ADMIN_FOOTER = "Aviso interno de Recurrentes.";
export const WA_ADMIN_TEMPLATE = {
  name: "aviso_admin", event: "admin", category: "UTILITY", lang: "es_AR",
  title: "Aviso interno al equipo de Recurrentes",
  body: "Recurrentes · aviso interno: {{1}}.\n\nTienda: {{2}}\nDetalle: {{3}}\n\nAbrir el panel: {{4}}\n\nEs un aviso automático para el equipo de Recurrentes.",
  footer: WA_ADMIN_FOOTER,
  vars: { "1": "evento", "2": "tienda", "3": "detalle", "4": "link_panel" },
  samples: ["Pagó el plan", "LuminaLabs", "Starter · USD 49 · primer pago", "https://www.recurrentesapp.com/#/dashboard/admin"],
};
export const ADMIN_PANEL_URL = "https://www.recurrentesapp.com/#/dashboard/admin";

// Una plantilla por evento del ramal admin (Thiago las quiso específicas). Si alguna
// todavía no está aprobada, adminAlerts.js cae a la genérica `aviso_admin`.
// Variables iguales en todas: {{1}} tienda · {{2}} detalle · {{3}} link al Admin.
const AV = { "1": "tienda", "2": "detalle", "3": "link_panel" };
export const WA_ADMIN_TEMPLATES = [
  {
    name: "aviso_admin_registro", event: "signup", category: "UTILITY", lang: "es_AR",
    title: "Nuevo registro (aviso interno)",
    body: "Recurrentes · nueva cuenta: {{1}} acaba de registrarse y dejó su WhatsApp.\n\nDatos: {{2}}\n\nAbrir el Admin para contactarla: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["Ana Pérez (Tienda Sol)", "WhatsApp +54 9 11 5555-0000 · ana@tiendasol.com", ADMIN_PANEL_URL],
  },
  {
    name: "aviso_admin_pago", event: "plan_paid", category: "UTILITY", lang: "es_AR",
    title: "Pago del plan (aviso interno)",
    body: "Recurrentes · cobro del plan: {{1}} pagó su plan.\n\nDetalle: {{2}}\n\nAbrir el Admin: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["LuminaLabs", "Starter · USD 49 · primer pago", ADMIN_PANEL_URL],
  },
  {
    name: "aviso_admin_rebote", event: "plan_past_due", category: "UTILITY", lang: "es_AR",
    title: "Rebote del pago del plan (aviso interno)",
    body: "Recurrentes · pago del plan rechazado: a {{1}} le rebotó el cobro del plan en Stripe.\n\nDetalle: {{2}}\n\nAbrir el Admin: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["LuminaLabs", "USD 49 · Stripe reintenta solo", ADMIN_PANEL_URL],
  },
  {
    name: "aviso_admin_baja", event: "plan_cancelled", category: "UTILITY", lang: "es_AR",
    title: "Baja del plan (aviso interno)",
    body: "Recurrentes · baja del plan: {{1}} canceló su plan.\n\nDetalle: {{2}}\n\nAbrir el Admin: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["LuminaLabs", "Baja de la suscripción al plan en Stripe", ADMIN_PANEL_URL],
  },
  {
    name: "aviso_admin_gracia", event: "plan_grace", category: "UTILITY", lang: "es_AR",
    title: "Tienda en gracia (aviso interno)",
    body: "Recurrentes · estado de cuenta: {{1}} pasó los 10 suscriptores sin plan pago y está en el período de tolerancia.\n\nDetalle: {{2}}\n\nAbrir el Admin: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["LuminaLabs", "12 suscriptores activos sin plan pago", ADMIN_PANEL_URL],
  },
  {
    name: "aviso_admin_bloqueo", event: "plan_blocked", category: "UTILITY", lang: "es_AR",
    title: "Tienda bloqueada (aviso interno)",
    body: "Recurrentes · estado de cuenta: el widget de {{1}} quedó desactivado por superar el límite sin plan pago.\n\nDetalle: {{2}}\n\nAbrir el Admin: {{3}}\n\nAviso automático para el equipo de Recurrentes.",
    footer: WA_ADMIN_FOOTER,
    vars: AV,
    samples: ["LuminaLabs", "16 suscriptores activos sin plan pago", ADMIN_PANEL_URL],
  },
];
// "Al borde" usa la misma plantilla que "en gracia" (cambia el detalle).
export const WA_ADMIN_TEMPLATE_BY_EVENT = Object.fromEntries(WA_ADMIN_TEMPLATES.map(t => [t.event, t]));
WA_ADMIN_TEMPLATE_BY_EVENT.plan_last_call = WA_ADMIN_TEMPLATE_BY_EVENT.plan_grace;

// Bienvenida al COMERCIO recién registrado (confirmación de cuenta, Utilidad). Sale
// una vez, desde el número de Recurrentes, sin costo para él.
export const WA_WELCOME_FOOTER = "Mensaje automático de Recurrentes.";
export const WA_WELCOME_TEMPLATE = {
  name: "bienvenida_recurrentes", event: "welcome", category: "UTILITY", lang: "es_AR",
  title: "Bienvenida al comercio (cuenta creada)",
  body: "Hola {{1}}, ya quedó creada tu cuenta en Recurrentes.\n\nDesde tu panel conectás tu tienda y Mercado Pago, y en unos minutos empezás a vender por suscripción: {{2}}\n\nSi necesitás una mano con la puesta en marcha, respondé este mensaje y te ayudamos.",
  footer: WA_WELCOME_FOOTER,
  vars: { "1": "nombre", "2": "link_panel" },
  samples: ["Ana", "https://www.recurrentesapp.com/#/dashboard"],
};
export const DASHBOARD_URL = "https://www.recurrentesapp.com/#/dashboard";

// Todas las plantillas que Recurrentes necesita aprobadas en su WABA (clientes +
// comercios + límite del plan + admin). Las crea por API admin-wa-templates-sync.
export const WA_ALL_TEMPLATES = [...WA_TEMPLATES, ...WA_MERCHANT_TEMPLATES, ...WA_PLAN_TEMPLATES, WA_ADMIN_TEMPLATE, ...WA_ADMIN_TEMPLATES, WA_WELCOME_TEMPLATE];

export const WA_MERCHANT_TEMPLATE_BY_EVENT = Object.fromEntries([...WA_MERCHANT_TEMPLATES, ...WA_PLAN_TEMPLATES, WA_ADMIN_TEMPLATE, WA_WELCOME_TEMPLATE].map(t => [t.event, t]));
const ALERT_FALLBACK = { marca: "tu tienda", nombre: "un cliente", producto: "tu plan", monto: "el monto del plan", link_panel: ALERTS_PANEL_URL, subs: "varios", free: "10", gracia: "5", evento: "novedad", tienda: "una tienda", detalle: "-", nombre: "hola" };

// Qué eventos avisa la tienda (los que faltan cuentan como prendidos).
export function alertEventsOf(m) {
  const e = m?.alerts_events && typeof m.alerts_events === "object" ? m.alerts_events : {};
  return Object.fromEntries(ALERT_EVENT_IDS.map(id => [id, e[id] !== false]));
}
// "ana maría pérez" → "Ana". Solo el nombre de pila (privacidad y texto corto).
export function alertFirstName(full) {
  const w = String(full || "").trim().split(/\s+/)[0] || "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : "";
}
// Valores de {{1}}..{{n}} de la plantilla del evento (sin vacíos: Meta los rechaza).
export function alertParams(event, values) {
  const t = WA_MERCHANT_TEMPLATE_BY_EVENT[event];
  if (!t) return [];
  return Object.keys(t.vars).sort((a, b) => Number(a) - Number(b)).map(n => waParamText(values?.[t.vars[n]], ALERT_FALLBACK[t.vars[n]] || "-"));
}
// ¿Es un aviso del límite del plan? (van al panel de facturación, salen siempre)
export const isPlanAlert = (event) => PLAN_ALERT_EVENTS.includes(event);

// Texto del aviso con los datos puestos (mail de respaldo y vista previa).
export function renderMerchantAlert(event, values) {
  const t = WA_MERCHANT_TEMPLATE_BY_EVENT[event];
  if (!t) return "";
  const p = alertParams(event, values);
  return t.body.replace(/\{\{\s*(\d{1,2})\s*\}\}/g, (m, n) => p[Number(n) - 1] ?? m);
}

// Respuesta automática cuando un cliente le escribe al número de Recurrentes
// (mensaje de servicio, gratis dentro de las 24 h que abre el cliente).
export function waAutoReplyText({ store, email } = {}) {
  const s = String(store || "").trim();
  const e = String(email || "").trim();
  const baja = " Si no querés recibir más avisos, respondé BAJA.";
  if (s && e) return `Hola. Este número solo envía avisos automáticos de ${s}. Para consultas escribí a ${e}.${baja}`;
  if (s) return `Hola. Este número solo envía avisos automáticos de ${s}. Para consultas, escribile directamente a la tienda.${baja}`;
  return `Hola. Este número solo envía avisos automáticos de las tiendas que usan Recurrentes. Para consultas, escribile directamente a la tienda donde te suscribiste.${baja}`;
}
