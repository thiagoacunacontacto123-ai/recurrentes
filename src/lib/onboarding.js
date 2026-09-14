// Plan de acción del comerciante nuevo — cálculo compartido de los 8 pasos.
// Lo consumen: el wizard de bienvenida (Onboarding.jsx), la card "Tu plan de
// acción" de Inicio, el badge/quehaceres del sidebar (Shell.jsx), los estados
// vacíos de cada sección y la Guía.
//
// Estado de cada paso:
//   - calculado desde `merchant` (shopify_token, mp_access_token, store_domain,
//     checkout_shipping_rates, klaviyo_connected, widget_variant/color/radius)
//   - GET /api/plans para "primer plan"
//   - localStorage para los manuales (snippet pegado, diseño elegido, Klaviyo
//     "más tarde"), siempre por tienda: rec_onb_<algo>_<merchantId>.
// Mismo criterio que Growith: localStorage para lo que el usuario marca a mano,
// el doc del merchant para lo que se puede verificar.
import React from "react";
import { apiGet } from "./api.js";

export const WHATSAPP_SOPORTE = "https://wa.me/5491164117974";
export const TOTAL_PASOS = 8;

// ─── Claves de localStorage (todas por tienda) ─────────────────────────
export const widgetKey       = (mid) => `rec_onb_widget_${mid || "default"}`;        // snippet pegado (manual)
export const designKey       = (mid) => `rec_onb_design_${mid || "default"}`;        // "me quedo con este diseño" (manual)
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
  try { setTimeout(() => { window.location.hash = "#/dashboard/planes?sub=widget"; }, 0); } catch (_) {}
}

// ─── Íconos (paths SVG 24x24, stroke) de cada paso ─────────────────────
export const STEP_ICONS = {
  email:    "M4 4h16v16H4zM4 4l8 8 8-8",
  shopify:  "M6 2l1.5 4h9L18 2M3 6h18l-1.5 14h-15zM9 10a3 3 0 006 0",
  mp:       "M2 7h20v10H2zM2 11h20M6 15h4",
  plan:     "M12 22a10 10 0 100-20 10 10 0 000 20zM12 18a6 6 0 100-12 6 6 0 000 12zM12 14a2 2 0 100-4 2 2 0 000 4z",
  design:   "M4 4h16v16H4zM4 9h16M9 9v11",
  snippet:  "M16 18l6-6-6-6M8 6l-6 6 6 6",
  settings: "M3 9l1-5h16l1 5M3 9h18v11H3zM9 20v-6h6v6",
  klaviyo:  "M4 4h16v16H4zM4 7l8 6 8-6",
};

// ─── Cálculo de pasos ──────────────────────────────────────────────────
// Devuelve [{ id, n, title, short, done, locked, lockedMsg, manual, tab,
//             configSec, guideSec, needs:[…] }]
export function computeSteps({ merchant, user, plansCount }) {
  const m = merchant || {};
  const mid = m.id || null;
  const shopifyOk = Boolean(m.shopify_token);
  const mpOk = Boolean(m.mp_access_token);
  const integ = shopifyOk && mpOk;
  const planOk = (Number(plansCount) || 0) > 0;
  // Si el merchant cargó, el backend ya validó el mail (403 email_unverified si no).
  const emailOk = user?.emailVerified === true || Boolean(m.id);
  const color = String(m.widget_color || "#10b981").toLowerCase();
  const designOk = readFlag(designKey(mid))
    || (m.widget_variant && m.widget_variant !== "v01")
    || (color !== "#10b981")
    || (Number.isInteger(m.widget_radius) && m.widget_radius !== 14);
  const snippetOk = readFlag(widgetKey(mid));
  const settingsOk = Boolean(m.store_domain) && Array.isArray(m.checkout_shipping_rates) && m.checkout_shipping_rates.length > 0;
  const klaviyoOk = Boolean(m.klaviyo_connected || m.klaviyo_api_key || m.klaviyo_public_key);
  const klaviyoLater = readFlag(klaviyoLaterKey(mid));

  return [
    { id:"email", n:1, done:emailOk, title:"Verificar tu email",
      short:"Confirmá tu casilla para que podamos avisarte de cobros y fallas.",
      why:"Te mandamos avisos de cobros fallidos, cancelaciones y novedades de tu cuenta a este mail.",
      needs:["Acceso a la casilla con la que te registraste"],
      tab:"configuracion", configSec:"cuenta", cta:"Ver mi cuenta" },
    { id:"shopify", n:2, done:shopifyOk, title:"Conectar Shopify",
      short:"Para leer tus productos y crear una orden en tu tienda con cada cobro.",
      why:"Recurrentes lee tu catálogo para armar los planes y crea una orden en Shopify cada vez que Mercado Pago cobra una suscripción. Sin esto no hay envíos.",
      needs:["Ser dueño o staff con permisos de la tienda","Crear una app personalizada en Shopify (5 min, la guía te lleva paso a paso)","Tu dominio tu-tienda.myshopify.com"],
      tab:"configuracion", configSec:"integraciones", guideSec:"shopify", cta:"Conectar Shopify" },
    { id:"mp", n:3, done:mpOk, title:"Conectar Mercado Pago",
      short:"Es la cuenta que cobra: la plata va directo a vos.",
      why:"Las suscripciones se crean y se cobran en TU cuenta de Mercado Pago. Recurrentes solo las da de alta y escucha los pagos.",
      needs:["Tu cuenta de Mercado Pago de comercio (la que cobra)","El Access Token de producción (APP_USR-…) desde el panel de developers"],
      tab:"configuracion", configSec:"integraciones", guideSec:"mp", cta:"Conectar Mercado Pago" },
    { id:"plan", n:4, done:planOk, locked:!integ, lockedMsg:"Primero conectá Shopify y Mercado Pago.", title:"Crear tu primer plan con packs",
      short:"Elegí un producto, la frecuencia, el descuento y los packs (x1, x2, x3…).",
      why:"Un plan convierte un producto de tu Shopify en suscripción. Los packs son las cantidades que ofrecés en el mismo selector (1, 2 o 3 unidades) con su precio cada uno.",
      needs:["Shopify y Mercado Pago conectados","Saber cada cuántos días querés cobrar y qué descuento dar"],
      tab:"planes", guideSec:"planes", cta:"Crear mi primer plan" },
    { id:"design", n:5, done:designOk, manual:true, manualLabel:"Me quedo con este diseño", manualKey:designKey(mid), title:"Elegir el diseño del widget",
      short:"10 diseños del selector de packs, con tu color y tus textos.",
      why:"El widget es lo que ve tu cliente en la página de producto. Elegí uno de los 10 diseños con vista previa real, ajustá el color, las esquinas y los textos.",
      needs:["El color principal de tu marca (hex)","Un plan creado para ver la vista previa con tus packs (opcional)"],
      tab:"planes", planesSub:"widget", guideSec:"diseno", cta:"Abrir el diseñador" },
    { id:"snippet", n:6, done:snippetOk, manual:true, manualLabel:"Ya lo pegué en mi tienda", manualKey:widgetKey(mid), title:"Pegar el snippet en tu tienda",
      short:"Una línea de código en tu theme y el widget aparece solo en los productos con plan.",
      why:"El snippet carga el widget en tu página de producto. Detecta el producto que se está viendo y, si tiene plan, muestra el selector de suscripción.",
      needs:["Acceso a Online Store → Themes → Edit code (o al editor de temas)","El snippet lo copiás desde Planes → </> Código"],
      tab:"planes", guideSec:"snippet", cta:"Cómo pegarlo" },
    { id:"settings", n:7, done:settingsOk, title:"Configurar tienda y envíos",
      short:"Dominio público de tu tienda y las tarifas de envío del checkout.",
      why:"El dominio arma los links de los mails y del portal del cliente. Las tarifas de envío son las que el cliente elige en el checkout de suscripción y se repiten en cada orden.",
      needs:["El dominio público (ej: www.mitienda.com)","Nombre y precio de cada opción de envío (hasta 6)"],
      tab:"configuracion", configSec:"tienda", guideSec:"tienda", cta:"Configurar tienda" },
    { id:"klaviyo", n:8, done:klaviyoOk || klaviyoLater, optional:true, later:klaviyoLater && !klaviyoOk, manual:true, manualLabel:"Más tarde", manualKey:klaviyoLaterKey(mid), title:"Conectar Klaviyo (opcional)",
      short:"Para recuperar checkouts sin pagar y mandar los mails con tu marca.",
      why:"Recurrentes manda a Klaviyo los eventos de suscripción (checkout iniciado, activada, cancelada, pago fallido). Con eso armás flows de recupero y de retención. Si no usás Klaviyo, los mails básicos los manda Recurrentes.",
      needs:["Una cuenta de Klaviyo (plan gratis alcanza)","Su API key privada (Settings → API keys)"],
      tab:"configuracion", configSec:"integraciones", guideSec:"klaviyo", cta:"Conectar Klaviyo" },
  ];
}

export function summarize(steps) {
  const done = steps.filter(s => s.done).length;
  const pendingSteps = steps.filter(s => !s.done);
  const nextStep = pendingSteps.find(s => !s.locked) || pendingSteps[0] || null;
  return { done, total: steps.length, pending: pendingSteps.length, pendingSteps, nextStep, allDone: pendingSteps.length === 0 };
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

// Qué pasos hacen falta para que aparezca algo en cada sección.
export const SECTION_NEEDS = {
  suscripciones:["shopify", "mp", "plan", "snippet"],
  analiticas:   ["shopify", "mp", "plan", "snippet"],
  retencion:    ["shopify", "mp", "plan", "snippet"],
  portal:       ["shopify", "mp", "plan", "snippet", "settings"],
  suscriptores: ["shopify", "mp", "plan", "snippet"],
  carritos:     ["shopify", "mp", "plan", "snippet"],
  abandonados:  ["shopify", "mp", "plan", "snippet"],
  cobros:       ["shopify", "mp", "plan", "snippet"],
  actividad:    ["shopify", "mp", "plan", "snippet", "settings"],
};

// ─── Textos de tips contextuales (?) ───────────────────────────────────
export const TIPS = {
  pack: "Un pack es una cantidad del mismo producto que ofrecés en el selector: x1, x2, x3… Cada pack tiene su precio (y opcionalmente su precio tachado y una etiqueta tipo \"Más elegido\"). El cliente elige el pack y se suscribe a esa cantidad: cada cobro genera una orden con esas unidades.",
  widgetDesign: "El diseño del widget es global para tu tienda: elegís 1 de los 10 layouts, tu color, las esquinas y los textos. Los packs y precios NO se cargan acá, salen de cada plan. La vista previa usa tus planes reales.",
  mpToken: "El Access Token de PRODUCCIÓN empieza con APP_USR-. Lo sacás en mercadopago.com.ar/developers → Tus integraciones → tu aplicación → Credenciales de producción. Tiene que ser de la cuenta que cobra, con el producto Suscripciones habilitado. Nunca lo compartas: es la llave de tu caja.",
  shopifyApp: "Recurrentes entra a tu Shopify con una app personalizada que creás vos en dev.shopify.com/dashboard → Crear app. Le das los permisos read_products, write_orders, read_customers, write_customers y read_shipping, y copiás el Client ID y el Secret acá. La guía tiene el paso a paso con la Redirect URL exacta.",
  subscribersEmpty: "Un suscriptor aparece acá recién cuando completó el pago en Mercado Pago. Mientras no pague figura en Suscripciones → Sin pagar.",
  chargesEmpty: "Cada cobro que procesa Mercado Pago (el primero y las renovaciones) queda acá con su orden de Shopify. Si la orden falla, podés reintentarla desde la fila.",
};
