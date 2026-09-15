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
