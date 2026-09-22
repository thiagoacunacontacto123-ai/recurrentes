// Plan de acción del comerciante nuevo — cálculo compartido de los pasos.
// Lo consumen: el wizard de bienvenida (Onboarding.jsx), la card "Tu plan de
// acción" de Inicio, el badge/quehaceres del sidebar (Shell.jsx), los estados
// vacíos de cada sección y la Guía.
//
// Los pasos se ADAPTAN al perfil del negocio (shared/platform/profile.js):
//   · físico + Shopify: integraciones (tienda + MP + Meta) · plan con packs ·
//     diseño del widget · ver la caja en la tienda.
//   · sin tienda (servicios, digitales, link): integraciones (MP) · plan ·
//     compartir el link.
//
// Estado de cada paso:
//   - calculado desde `merchant` (business_type, shopify_token, mp_access_token,
//     store_domain, checkout_shipping_rates, klaviyo_connected, widget_variant/color/radius)
//   - GET /api/plans para "primer plan"
//   - localStorage para los manuales (snippet pegado, diseño elegido, link
//     compartido, Klaviyo "más tarde"), siempre por tienda: rec_onb_<algo>_<merchantId>.
// Mismo criterio que Growith: localStorage para lo que el usuario marca a mano,
// el doc del merchant para lo que se puede verificar.
import React from "react";
import { apiGet } from "./api.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { SHOPIFY_SCOPE_IDS } from "../../shared/platform/shopify.js";

export const WHATSAPP_SOPORTE = "https://wa.me/5491164117974";
// Pasos del perfil histórico (físico + Shopify). El total real sale de computeSteps().
// 22-sept: tienda + pasarela + Meta se unificaron en "integraciones" y se fue
// "verificar el email" (ya no se verifica desde el 19-sept), así que el perfil
// Shopify quedó en 4 pasos: integraciones · plan · diseño · activar.
// El total real siempre sale de computeSteps(); esto es el respaldo.
export const TOTAL_PASOS = 4;

// ─── Claves de localStorage (todas por tienda) ─────────────────────────
export const widgetKey       = (mid) => `rec_onb_widget_${mid || "default"}`;        // snippet pegado (manual)
export const designKey       = (mid) => `rec_onb_design_${mid || "default"}`;        // "me quedo con este diseño" (manual)
export const linkKey         = (mid) => `rec_onb_link_${mid || "default"}`;          // link de suscripción compartido (manual)
export const klaviyoLaterKey = (mid) => `rec_onb_klaviyo_later_${mid || "default"}`; // Klaviyo "más tarde"
export const seenKey         = (mid) => `rec_onb_seen_${mid || "default"}`;          // ya vio el wizard de bienvenida
export const doneKeyLegacy   = (mid) => `rec_onb_done_${mid || "default"}`;          // clave vieja (equivale a seen)
export const planHiddenKey   = (mid) => `rec_onb_plan_hidden_${mid || "default"}`;   // ocultó la card de Inicio (solo si está todo listo)
export const quehaceresOffKey= (mid) => `rec_quehaceres_off_${mid || "default"}`;    // cerró la cajita del sidebar

export function readFlag(key) { try { return localStorage.getItem(key) === "1"; } catch (_) { return false; } }
export function writeFlag(key, v) { try { if (v) localStorage.setItem(key, "1"); else localStorage.removeItem(key); } catch (_) {} }

// ─── Navegación a pantallas concretas ──────────────────────────────────
// Configuración lee `#/config/<sección>` (Settings.jsx) → primero cambiamos de
// tab y después seteamos el hash (dispara hashchange si Settings ya está montado).
export function goConfigSection(goTab, sec) {
  try { goTab?.("configuracion"); } catch (_) {}
  try { setTimeout(() => { window.location.hash = `#/config/${sec}`; }, 0); } catch (_) {}
}
// La Guía vive en Configuración → Ayuda y lee `?s=<sección>` del hash.
export function goGuideSection(goTab, sec) {
  try { goTab?.("configuracion"); } catch (_) {}
  try { setTimeout(() => { window.location.hash = `#/config/ayuda${sec ? `?s=${sec}` : ""}`; }, 0); } catch (_) {}
}
// Planes → sub-tab Widget (diseñador): `#/dashboard/planes?sub=widget`.
export function goPlanesWidget(goTab) {
  try { goTab?.("planes"); } catch (_) {}
  try { setTimeout(() => { window.location.hash = "#/dashboard/widget"; }, 0); } catch (_) {}
}

// ─── Íconos (paths SVG 24x24, stroke) de cada paso ─────────────────────
export const STEP_ICONS = {
  email:    "M4 4h16v16H4zM4 4l8 8 8-8",
  negocio:  "M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6M9 10h.01M15 10h.01",
  shopify:  "M6 2l1.5 4h9L18 2M3 6h18l-1.5 14h-15zM9 10a3 3 0 006 0",
  mp:       "M2 7h20v10H2zM2 11h20M6 15h4",
  plan:     "M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  design:   "M4 4h16v16H4zM4 9h16M9 9v11",
  snippet:  "M16 18l6-6-6-6M8 6l-6 6 6 6",
  link:     "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  settings: "M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6",
  klaviyo:  "M4 4h16v16H4zM4 7l8 6 8-6",
  // 22-sept: tienda + pasarela + Meta son UN paso. Enchufe = "conectar".
  integraciones: "M9 2v6M15 2v6M6 8h12v5a6 6 0 01-12 0zM12 19v3",
  tienda:   "M6 2l1.5 4h9L18 2M3 6h18l-1.5 14h-15zM9 10a3 3 0 006 0",
  meta:     "M12 12c0-3 2-5 4-5s4 2 4 5-2 5-4 5-4-2-4-5zm0 0c0-3-2-5-4-5S4 9 4 12s2 5 4 5 4-2 4-5z",
  activar:  "M9 12l2 2 4-4M12 3a9 9 0 100 18 9 9 0 000-18z",
};

// Ejemplo de plan según el tipo de negocio (textos del onboarding y del editor).
export function planExample(profile) {
  if (profile?.businessType === "service") return "Pase libre mensual";
  if (profile?.businessType === "digital") return "Suscripción mensual";
  return "Café de especialidad cada 15 días";
}

// ─── Cálculo de pasos ──────────────────────────────────────────────────
// Devuelve [{ id, n, title, short, done, locked, lockedMsg, manual, tab,
//             configSec, guideSec, needs:[…] }]
export function computeSteps({ merchant, user, plansCount }) {
  const m = merchant || {};
  const mid = m.id || null;
  const p = merchantProfile(m);
  const v = p.vocab;
  const shopifyOk = Boolean(m.shopify_token);
  const mpOk = Boolean(m.mp_access_token);
  const planOk = (Number(plansCount) || 0) > 0;
  // Negocio: lo eligió, o es un merchant histórico que ya conectó Shopify (físico).
  const color = String(m.widget_color || "#10b981").toLowerCase();
  const designOk = readFlag(designKey(mid))
    || (m.widget_variant && m.widget_variant !== "v01")
    || (color !== "#10b981")
    || (Number.isInteger(m.widget_radius) && m.widget_radius !== 14);
  const snippetOk = readFlag(widgetKey(mid)) || !!m.widget_last_seen_at || m.widget_installed_ack === true;
  const linkOk = readFlag(linkKey(mid));
  const ratesOk = Array.isArray(m.checkout_shipping_rates) && m.checkout_shipping_rates.length > 0;
  // El dominio sale de Shopify (store_domain_effective) o se carga a mano (store_domain).
  const settingsOk = p.channel === "shopify" ? Boolean(m.store_domain_effective || m.store_domain) && ratesOk : ratesOk;
  const lockedMsg = p.missing.length ? `Primero conectá ${p.missing.join(" y ")}.` : "";

  const steps = [];
  // "Verificar tu email" se fue (22-sept, Thiago). La verificación de mail ya
  // se había sacado el 19-sept (verifyBearer no responde 403 email_unverified
  // y el registro no manda el mail), así que este paso nacía siempre en "Listo":
  // ocupaba un renglón, sumaba al contador y no pedía nada.


  // Tienda + pasarela + Meta en UN SOLO paso (22-sept, Thiago: "total es toda
  // la misma parte de integraciones"). Eran tres pasos que mandaban a la misma
  // pantalla, así que el plan de acción se veía largo sin serlo.
  // Queda listo cuando están las dos necesarias; Meta es opcional y no traba.
  const tnOk = Boolean(m.tiendanube_token || m.tiendanube_connected_at || m.tiendanube_store_id);
  const tiendaOk = shopifyOk || tnOk;
  const metaOk = Boolean(m.meta_connected || m.meta_pixel_id);
  const necesitaTienda = p.channel === "shopify" || p.channel === "tiendanube";
  {
    const faltan = [];
    if (necesitaTienda && !tiendaOk) faltan.push("tu tienda");
    if (!mpOk) faltan.push("Mercado Pago");
    const listo = !faltan.length;
    steps.push({
      id:"integraciones",
      done: listo,
      title:"Conectar tus integraciones",
      short: listo
        ? (metaOk ? "Tienda, Mercado Pago y Meta Ads conectados." : "Tienda y Mercado Pago conectados. Meta Ads es opcional.")
        : `Tu tienda y Mercado Pago${necesitaTienda ? "" : ""}. Meta Ads es opcional. Falta ${faltan.join(" y ")}.`,
      why:"Recurrentes lee tus productos para armar los planes y crea una orden en tu tienda cada vez que Mercado Pago cobra. Mercado Pago es la cuenta que cobra: la plata va directo a vos. Meta Ads solo si hacés publicidad, para que tus campañas cuenten las suscripciones como ventas.",
      needs:[
        necesitaTienda ? "Tu tienda: Tiendanube instalás la app y listo · Shopify te guiamos con el video (5 min)" : null,
        "Mercado Pago: autorizás con un clic, con la cuenta que cobra",
        "Meta Ads (opcional): Pixel ID y token de la API de Conversiones",
      ].filter(Boolean),
      tab:"configuracion", configSec:"integraciones",
      guideSec: p.channel === "shopify" ? "shopify" : undefined,
      cta: listo ? "Ver integraciones" : "Conectar",
    });
  }

  if (p.caps.catalog) {
    steps.push({ id:"plan", done:planOk, locked:!p.ready, lockedMsg, title: p.caps.packs ? "Crear tu primer plan con packs" : "Crear tu primer plan",
      short:"Elegí un producto, su duración, el descuento y los packs (x1, x2, x3…).",
      why:"Un plan convierte un producto de tu tienda en suscripción. Los packs son las cantidades que ofrecés en el mismo selector (1, 2 o 3 unidades) con su precio cada uno.",
      needs:[`${p.channelInfo.label} y ${p.providerInfo.label} conectados`,"Saber cada cuántos días querés cobrar y qué descuento dar"],
      tab:"planes", guideSec:"planes", cta:"Crear mi primer plan" });
  } else {
    steps.push({ id:"plan", done:planOk, locked:!p.ready, lockedMsg, title:`Crear tu primer plan`,
      short:`Nombre, precio y cada cuántos días se cobra. Ej: "${planExample(p)}".`,
      why:`Un plan es lo que tus ${v.customers} pagan de forma recurrente. No necesitás tienda: lo cargás acá y Recurrentes te da el link para cobrarlo.`,
      needs:[`${p.providerInfo.label} conectado`,"El precio y cada cuántos días querés cobrar"],
      tab:"planes", cta:"Crear mi primer plan" });
  }

  if (p.caps.widget) {
    steps.push({ id:"design", done:designOk, manual:true, manualLabel:"Me quedo con este diseño", manualKey:designKey(mid), title:"Elegir el diseño del widget",
      short:"10 diseños del selector de packs, con tu color y tus textos.",
      why:"El widget es lo que ve tu cliente en la página de producto. Elegí uno de los 10 diseños con vista previa real, ajustá el color, las esquinas y los textos.",
      needs:["El color principal de tu marca (hex)","Un plan creado para ver la vista previa con tus packs (opcional)"],
      tab:"planes", planesSub:"widget", guideSec:"diseno", cta:"Abrir el diseñador" });
    // 22-sept (Thiago): esto era una verificación que esperaba el aviso del
    // widget y a veces no llegaba nunca. Ahora es simple: abrís tu producto y
    // mirás. Se marca a mano, como el resto de los pasos manuales.
    // Lo importante es el aviso del bundle duplicado, que es lo que de verdad
    // pasa cuando la caja no se ve.
    steps.push({ id:"activar", done: !!m.widget_verified_at || readFlag(widgetKey(mid)),
      manual:true, manualLabel:"Ya la vi en mi tienda", manualKey:widgetKey(mid),
      locked:!planOk, lockedMsg:"Primero creá un plan.", title:"Ver la caja en tu tienda",
      short:"Abrí un producto con plan y fijate que aparezca la caja de suscripción.",
      why:"Si ves DOS selectores de packs (el tuyo y el nuestro), es porque tenés otra app de bundles ocupando ese lugar: desactivá su widget en ese producto y queda solo el de Recurrentes. Si no aparece ninguno, escribinos y lo miramos.",
      needs:["Un plan activo con un producto de tu tienda","Si tenés otra app de bundles (Kaching, Pumper, Selleasy…), desactivá su widget"],
      tab:"planes", planesSub:"widget", cta:"Abrir mi producto" });
  } else {
    steps.push({ id:"link", done:linkOk, manual:true, manualLabel:"Ya lo compartí", manualKey:linkKey(mid), locked:!planOk, lockedMsg:"Primero creá un plan.", title:"Compartir tu link de suscripción",
      short:"Pegalo en tu bio de Instagram, en WhatsApp, en tu web o imprimilo como QR.",
      why:`Cada plan tiene su link: tu cliente entra, deja sus datos y paga con ${p.providerInfo.label}. Desde ahí se cobra solo cada período y lo ves en Suscripciones.`,
      needs:["Un plan creado","Dónde publicarlo: Instagram, WhatsApp, tu web o el mostrador"],
      tab:"planes", cta:"Ver mis links" });
  }

  // Sin paso de snippet (Shopify lo hace el paso 2 al conectar; Tiendanube lo pone solo) ni de
  // envíos/descuentos: son opcionales y viven en Configuración (Thiago, 18-sept).
  return steps.map((s, i) => ({ ...s, n: i + 1 }));
}

export function summarize(steps) {
  // Los pasos opcionales (Meta Ads) se muestran pero no cuentan como pendientes.
  const counted = steps.filter(s => !s.optional);
  const done = counted.filter(s => s.done).length;
  const pendingSteps = counted.filter(s => !s.done);
  const nextStep = pendingSteps.find(s => !s.locked) || pendingSteps[0] || null;
  return { done, total: counted.length, pending: pendingSteps.length, pendingSteps, nextStep, allDone: pendingSteps.length === 0 };
}


// ─── Hook: estado vivo del plan de acción ──────────────────────────────
export function useOnboarding({ merchant, user, goTab }) {
  const mid = merchant?.id || null;
  const [plansCount, setPlansCount] = React.useState(null);
  const [tick, setTick] = React.useState(0);
  const shopifyOk = Boolean(merchant?.shopify_token), mpOk = Boolean(merchant?.mp_access_token);

  React.useEffect(() => {
    if (!mid) return;
    let alive = true;
    apiGet("plans").then(d => { if (alive) setPlansCount(Array.isArray(d?.plans) ? d.plans.length : 0); })
      .catch(() => { if (alive) setPlansCount(0); });
    return () => { alive = false; };
  }, [mid, shopifyOk, mpOk, tick]);

  // Otras pestañas/ventanas o el mismo tab pueden tocar las flags manuales.
  React.useEffect(() => {
    const onStorage = (e) => { if (!e || !e.key || /^rec_onb_/.test(e.key)) setTick(t => t + 1); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const steps = React.useMemo(() => computeSteps({ merchant, user, plansCount: plansCount ?? 0 }), [merchant, user, plansCount, tick]);
  const sum = React.useMemo(() => summarize(steps), [steps]);

  const refresh = React.useCallback(() => setTick(t => t + 1), []);
  const setManual = React.useCallback((step, v) => { if (step?.manualKey) { writeFlag(step.manualKey, v); setTick(t => t + 1); } }, []);
  const goStep = React.useCallback((step) => {
    if (!step) return;
    if (step.configSec) return goConfigSection(goTab, step.configSec);
    if (step.planesSub === "widget") return goPlanesWidget(goTab);
    if (step.id === "snippet") return goGuideSection(goTab, "snippet");
    try { goTab?.(step.tab); } catch (_) {}
  }, [goTab]);
  const goGuide = React.useCallback((sec) => goGuideSection(goTab, sec), [goTab]);

  const seen = readFlag(seenKey(mid)) || readFlag(doneKeyLegacy(mid));
  const markSeen = React.useCallback(() => { writeFlag(seenKey(mid), true); setTick(t => t + 1); }, [mid]);

  return { mid, steps, ...sum, ready: plansCount !== null, plansCount: plansCount ?? 0, refresh, setManual, goStep, goGuide, goTab, seen, markSeen };
}

// ─── Contexto: el shell provee, las tabs consumen (estados vacíos, card) ──
export const OnboardingContext = React.createContext(null);
export function useOnb() { return React.useContext(OnboardingContext); }

// Qué pasos hacen falta para que aparezca algo en cada sección. Los ids que no
// existen en el perfil del merchant (ej. "shopify" en un gimnasio) se ignoran solos.
export const SECTION_NEEDS = {
  suscripciones:["tienda", "mp", "plan", "link"],
  analiticas:   ["tienda", "mp", "plan", "link"],
  retencion:    ["tienda", "mp", "plan", "snippet", "link"],
  portal:       ["tienda", "mp", "plan", "snippet", "link", "settings"],
  suscriptores: ["tienda", "mp", "plan", "snippet", "link"],
  carritos:     ["tienda", "mp", "plan", "snippet", "link"],
  abandonados:  ["tienda", "mp", "plan", "snippet", "link"],
  cobros:       ["tienda", "mp", "plan", "snippet", "link"],
  actividad:    ["tienda", "mp", "plan", "snippet", "link", "settings"],
};

// ─── Textos de tips contextuales (?) ───────────────────────────────────
export const TIPS = {
  pack: "Un pack es una cantidad del mismo producto que ofrecés en el selector: x1, x2, x3… Cada pack tiene su precio (y opcionalmente su precio tachado y una etiqueta tipo \"Más elegido\"). El cliente elige el pack y se suscribe a esa cantidad: cada cobro genera una orden con esas unidades.",
  widgetDesign: "El diseño del widget es global para tu tienda: elegís 1 de los 10 layouts, tu color, las esquinas y los textos. Los packs y precios NO se cargan acá, salen de cada plan. La vista previa usa tus planes reales.",
  mpToken: "El Access Token de PRODUCCIÓN empieza con APP_USR-. Lo sacás en mercadopago.com.ar/developers → Tus integraciones → tu aplicación → Credenciales de producción. Tiene que ser de la cuenta que cobra, con el producto Suscripciones habilitado. Nunca lo compartas: es la llave de tu caja.",
  shopifyApp: `Recurrentes entra a tu Shopify con una app que creás vos en dev.shopify.com/dashboard → Create app (crear app). Le pegás los permisos (${SHOPIFY_SCOPE_IDS.join(", ")}) y la URL de redirección, tocás Release (publicar la versión) y copiás el Client ID y el Secret acá. En Conectar Shopify tenés el paso a paso con todo para copiar.`,
  subscriptionLink: "Cada plan tiene un link propio a un checkout de Recurrentes: el cliente deja sus datos, paga y queda suscripto. Funciona en Instagram, WhatsApp, mails, tu web o impreso como QR. No necesitás tienda online.",
  subscribersEmpty: "Un suscriptor aparece acá recién cuando completó el pago en Mercado Pago. Mientras no pague figura en Suscripciones → Sin pagar.",
  chargesEmpty: "Cada cobro que procesa Mercado Pago (el primero y las renovaciones) queda acá. Con tienda conectada, con su orden; si la orden falla, podés reintentarla desde la fila.",
};
