// Puesta en marcha de un cliente — la checklist que se ve en Admin → ficha del
// comercio (26-sept-2026, Thiago: "la integración de absolutamente todo,
// organizable desde mi panel de admin").
//
// Por qué acá y no en un instructivo: un documento se desactualiza el día que
// cambia un scope o se suma una plataforma, y nadie lo relee. Esto se calcula
// con los datos reales del comercio, así que si algo ya está hecho aparece
// tildado solo, y si falta un permiso lo dice con el nombre exacto que hay que
// pedir. La lista de scopes sale de shared/platform/shopify.js, que es la misma
// que usa el OAuth: no puede quedar desfasada.
//
// Cada paso tiene:
//   pide    → qué hace falta, en tercera persona: es lo que lee Thiago en la ficha
//   mensaje → lo MISMO pero escrito al cliente, de vos. Es lo que se copia y se
//             manda. Van separados a propósito: un texto pensado para la
//             checklist interna, pegado en un WhatsApp, se lee como un machete
//             ("que entre a su cuenta…") y queda pésimo.
//   hace    → qué hace Thiago una vez que lo tiene
//   done    → detector automático sobre el doc del comercio. null = a mano.
import { SHOPIFY_SCOPES, SHOPIFY_REQUIRED_SCOPE_IDS } from "./shopify.js";

const tiene = (v) => typeof v === "string" && v.trim().length > 0;

// Permisos que faltan en la tienda conectada. [] = están todos.
export function scopesFaltantes(m) {
  if (!m?.shopify_token) return [];
  const otorgados = String(m.shopify_scopes || "").split(",").map(s => s.trim()).filter(Boolean);
  // Sin el dato (conexión vieja, antes de que lo guardáramos) no inventamos que falta nada.
  if (!otorgados.length) return [];
  return SHOPIFY_REQUIRED_SCOPE_IDS.filter(id => !otorgados.includes(id));
}

export const SETUP_STEPS = [
  {
    id: "contacto",
    title: "Datos de contacto",
    pide: "Nombre, WhatsApp y email de quien maneja la tienda.",
    mensaje: "Tu nombre, tu WhatsApp y el mail de contacto.",
    hace: "Quedan en la cuenta y son a dónde salen los avisos de cobro.",
    done: (m) => tiene(m.owner_whatsapp) && (tiene(m.contact_email) || tiene(m.email)),
  },
  {
    id: "tienda",
    title: "Tienda conectada",
    pide: "Que te sume como STAFF de su Shopify con permisos de Aplicaciones y Canales de venta, o que esté en la llamada para hacer el OAuth él mismo. En Tiendanube, que instale la app desde el link que le pasás.",
    mensaje: "Acceso a tu tienda. En Shopify: sumame como usuario del staff con permiso de Aplicaciones y Canales de venta (Configuración → Usuarios), o quedate en la llamada y lo conectamos juntos en dos minutos. En Tiendanube: instalás la app desde el link que te paso y listo.",
    hace: "Shopify: crea la app en dev.shopify.com, pega dominio + Client ID + Secret y corre el OAuth. Tiendanube: un clic.",
    done: (m) => tiene(m.shopify_token) || tiene(m.tiendanube_token),
  },
  {
    id: "permisos",
    title: "Permisos completos",
    // La lista sale del mismo archivo que el OAuth: si mañana se agrega un scope,
    // este texto lo dice solo.
    pide: () => `Los permisos de la app: ${SHOPIFY_REQUIRED_SCOPE_IDS.join(", ")}. Los dos opcionales (read_discounts y write_discounts) solo si quiere traer sus cupones y dejar los regalos gratis.`,
    mensaje: () => `Que la app quede con todos los permisos: ${SHOPIFY_REQUIRED_SCOPE_IDS.join(", ")}. Son los que necesita para leer tus productos, crear la orden de cada cobro y cotizar tus envíos. Si además querés traer tus cupones y dejar regalos gratis, sumá read_discounts y write_discounts.`,
    hace: "Si falta alguno, Shopify responde 403 en la mitad de las cosas. Se arregla reconectando con la lista completa.",
    done: (m) => (tiene(m.shopify_token) || tiene(m.tiendanube_token)) && scopesFaltantes(m).length === 0,
  },
  {
    id: "mp",
    title: "Mercado Pago conectado",
    pide: "Que entre a su cuenta de Mercado Pago y apruebe la conexión, o el Access Token de producción si prefiere pegarlo.",
    mensaje: "Conectar tu Mercado Pago: entrás con tu cuenta y aprobás la conexión desde el panel. La plata de tus clientes cae siempre en tu cuenta, nunca pasa por la nuestra.",
    hace: "Es la cuenta donde cae la plata de sus clientes. Nunca es la tuya.",
    done: (m) => tiene(m.mp_access_token),
  },
  {
    id: "plan",
    title: "Al menos un plan activo",
    pide: "Qué producto vende por suscripción, cada cuánto y con qué descuento. Y los packs, si quiere x1 / x2 / x3.",
    mensaje: "Decime qué producto querés vender por suscripción, cada cuánto le llega al cliente y qué descuento le das por suscribirse. Si querés packs (x1, x2, x3), también los precios de cada uno.",
    hace: "Se crea en Planes, con los packs y los regalos.",
    done: (m, ctx) => (ctx?.planes_activos || 0) > 0,
  },
  {
    id: "widget",
    title: "Widget andando en la tienda",
    pide: "Nada: se hace con el acceso que ya te dio.",
    hace: "Pegar el snippet en el tema y usar \"Activar en mi tienda\" hasta que el widget avise que se pintó.",
    done: (m) => tiene(m.widget_verified_at) || tiene(m.widget_last_seen_at),
  },
  {
    id: "marca",
    title: "Mails con su marca",
    pide: "A qué dirección quiere que le respondan sus clientes.",
    mensaje: "A qué dirección de mail querés que te escriban tus clientes cuando respondan los avisos. Los mails salen con tu marca.",
    hace: "Configuración → Marca. Sin ese mail los flujos no se activan.",
    done: (m) => tiene(m.email_reply_to) || tiene(m.shop_email),
  },
  {
    id: "meta",
    title: "Pixel de Meta (opcional)",
    pide: "Su Pixel ID y un token de la API de Conversiones, desde Business Manager → Orígenes de datos.",
    mensaje: "Si hacés Meta Ads: tu Pixel ID y un token de la API de Conversiones (Business Manager → Orígenes de datos). Con eso las compras por suscripción se le atribuyen a tus campañas.",
    hace: "Con eso las compras de la suscripción se le atribuyen a sus campañas.",
    opcional: true,
    done: (m) => tiene(m.meta_pixel_id),
  },
  {
    id: "cobro",
    title: "Primer cobro real",
    pide: "Nada. Es la prueba de que quedó andando.",
    hace: "Verificar que el cobro creó la orden en la tienda.",
    done: (m, ctx) => (ctx?.subs || 0) > 0,
  },
  {
    id: "pago",
    title: "Cobrada la instalación (USD 100)",
    pide: "El pago, una vez que está todo terminado y funcionando.",
    hace: "Se tilda a mano cuando entró.",
    manual: true,
  },
];

export const SETUP_STEP_IDS = SETUP_STEPS.map(s => s.id);

// Estado de cada paso para un comercio. `manual` = los ids que Thiago tildó
// (admin_merchants/{mid}.setup). ctx = { planes_activos, subs }.
export function buildSetup(m, { manual = [], ctx = {} } = {}) {
  const hechos = new Set(Array.isArray(manual) ? manual : []);
  const steps = SETUP_STEPS.map((s) => ({
    id: s.id,
    title: s.title,
    pide: typeof s.pide === "function" ? s.pide(m) : s.pide,
    mensaje: typeof s.mensaje === "function" ? s.mensaje(m) : (s.mensaje || null),
    hace: s.hace,
    opcional: s.opcional === true,
    manual: s.manual === true,
    done: s.manual === true ? hechos.has(s.id) : (hechos.has(s.id) || !!s.done?.(m || {}, ctx)),
  }));
  // El progreso ignora los opcionales: no tener el pixel de Meta no deja a
  // nadie a medio instalar.
  const cuentan = steps.filter(s => !s.opcional);
  return {
    steps,
    done: cuentan.filter(s => s.done).length,
    total: cuentan.length,
    faltan_scopes: scopesFaltantes(m || {}),
  };
}

// El mensaje para pedirle al cliente SOLO lo que falta. Se copia del panel y se
// manda por WhatsApp: es la razón de ser de todo esto, no tener que acordarse
// de qué accesos pedir en cada caso.
export function pedidoDeAccesos(setup, { nombre = "" } = {}) {
  // Solo los pasos que dependen del cliente: los que no tienen `mensaje` son
  // cosas nuestras (montar el widget, esperar el primer cobro) y no se piden.
  const faltan = setup.steps.filter(s => !s.done && !s.opcional && !s.manual && s.mensaje);
  const hola = nombre ? `Hola ${String(nombre).split(" ")[0]}! ` : "Hola! ";
  if (!faltan.length) return `${hola}Ya tengo todo lo que necesito de tu lado. Sigo yo y te aviso cuando esté andando.`;
  return `${hola}Para dejar las suscripciones andando en tu tienda necesito esto de tu lado:\n\n`
    + faltan.map((s, i) => `${i + 1}. ${s.mensaje}`).join("\n\n")
    + `\n\nCon eso sigo yo y te aviso apenas esté funcionando.`;
}

// Los permisos de Shopify con el motivo, para explicarlos sin abrir el código.
export const SHOPIFY_PERMISOS = SHOPIFY_SCOPES.map(s => ({ id: s.id, why: s.why, opcional: s.optional === true }));
