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

// Qué plataforma tiene (para pedir el acceso correcto). Primero lo conectado; si no,
// lo que dijo en el formulario de demo (demo_plataforma); si no, se piden las dos.
const plataformaDe = (m) => m?.shopify_token || m?.shopify_shop ? "shopify"
  : m?.tiendanube_token || m?.tn_store_id ? "tiendanube"
  : (m?.channel === "shopify" || m?.channel === "tiendanube") ? m.channel
  : (m?.demo_plataforma === "shopify" || m?.demo_plataforma === "tiendanube") ? m.demo_plataforma : null;

const ACCESO_SHOPIFY = "En Shopify: Configuración → Usuarios y permisos → Agregar personal, con el mail soporte@recurrentesapp.com y estos permisos: Temas, Productos, Pedidos, Clientes, Aplicaciones y canales de venta, y Configuración. (Si preferís, pasame el dominio .myshopify.com y te mando una solicitud de colaborador para que solo la aceptes.)";
const ACCESO_TIENDANUBE = "En Tiendanube: Configuración → Usuarios → Invitar usuario, con el mail soporte@recurrentesapp.com y acceso a Productos, Ventas, Diseño (para tocar el tema) y Aplicaciones.";

// Desde el 28-sept-2026 la instalación la hace Thiago (se cobra, ver INSTALL_RANGE): el
// cliente solo da accesos y datos. Por eso los `mensaje` piden accesos, no "conectá vos".
export const SETUP_STEPS = [
  {
    id: "contacto",
    title: "Datos de contacto",
    pide: "Nombre, WhatsApp y email de quien maneja la tienda.",
    mensaje: "Tu nombre, tu WhatsApp y el mail de contacto de la tienda (a ese mail van los avisos de cada cobro).",
    hace: "Quedan en la cuenta y son a dónde salen los avisos de cobro.",
    done: (m) => tiene(m.owner_whatsapp) && (tiene(m.contact_email) || tiene(m.email)),
  },
  {
    id: "acceso",
    title: "Contraseña de su cuenta de Recurrentes",
    pide: "Que ponga su contraseña con el link que le llegó por mail (Crear cuenta desde el pedido de demo se lo manda). Con eso puede aprobar Mercado Pago con su usuario.",
    mensaje: "Tu acceso a Recurrentes: entrá al link de abajo y poné tu contraseña (es tu registro; después entrás con tu mail y esa clave). Con eso vas a poder aprobar la conexión de Mercado Pago con tu usuario.",
    hace: "El link de poner contraseña se genera en el conector (botón \"Generar link\") y va en el mensaje; también se le puede reenviar por mail.",
    // Opcional para el progreso: si conecta MP en la llamada con vos, no hace falta que entre solo.
    manual: true, opcional: true,
  },
  {
    id: "tienda",
    title: "Acceso a la tienda",
    pide: (m) => {
      const p = plataformaDe(m);
      return p === "shopify" ? "Acceso de staff a su Shopify (Temas, Productos, Pedidos, Clientes, Apps y canales, Configuración) o el dominio .myshopify.com para mandarle la solicitud de colaborador."
        : p === "tiendanube" ? "Que invite a soporte@recurrentesapp.com como usuario de su Tiendanube (Productos, Ventas, Diseño, Aplicaciones)."
        : "Acceso a la tienda: staff en Shopify o usuario invitado en Tiendanube (según cuál tenga).";
    },
    mensaje: (m) => {
      const p = plataformaDe(m);
      const cual = p === "shopify" ? ACCESO_SHOPIFY : p === "tiendanube" ? ACCESO_TIENDANUBE : `${ACCESO_SHOPIFY}\n\n${ACCESO_TIENDANUBE}`;
      return `Acceso a tu tienda, para que la instalación la haga yo y no tengas que tocar nada:\n\n${cual}\n\nSolo uso ese acceso para dejar la suscripción instalada y ajustarla.`;
    },
    hace: "Con el acceso: conectar la tienda desde su cuenta (Shopify: crear la app en dev.shopify.com, pegar dominio + Client ID + Secret y correr el OAuth con TODOS los permisos; Tiendanube: instalar la app). Pegar el snippet en el tema.",
    done: (m) => tiene(m.shopify_token) || tiene(m.tiendanube_token),
  },
  {
    id: "permisos",
    title: "Permisos completos de la app",
    pide: () => `Nada del cliente: los revisás vos. La app tiene que quedar con ${SHOPIFY_REQUIRED_SCOPE_IDS.join(", ")}; read_discounts y write_discounts solo si quiere traer sus cupones y dejar regalos gratis.`,
    hace: "Si falta alguno, Shopify responde 403 en la mitad de las cosas. Se arregla reconectando con la lista completa.",
    done: (m) => (tiene(m.shopify_token) || tiene(m.tiendanube_token)) && scopesFaltantes(m).length === 0,
  },
  {
    id: "mp",
    title: "Mercado Pago conectado",
    pide: "Que entre con su usuario de Recurrentes, toque Conectar con Mercado Pago y apruebe con la cuenta donde quiere cobrar. Es lo único que no podés hacer vos: MP le pide su clave.",
    mensaje: "Conectar tu Mercado Pago (es lo único que tiene que hacerse con tu usuario, porque Mercado Pago te pide tu clave):\n1. Entrá al link de abajo con tu usuario de Recurrentes.\n2. En Mercado Pago tocá \"Conectar con Mercado Pago\".\n3. Iniciá sesión con la cuenta donde querés que caiga la plata y aprobá.\nSon 2 minutos. Si querés lo hacemos juntos por videollamada.",
    hace: "Es la cuenta donde cae la plata de sus clientes. Nunca es la tuya. Si ya tiene otra tienda con MP conectado, se reusa desde Integraciones.",
    done: (m) => tiene(m.mp_access_token),
  },
  {
    id: "plan",
    title: "Planes y packs armados",
    pide: "Qué producto(s) van por suscripción, cada cuánto, con qué descuento, qué packs (x1 / x2 / x3) y si hay regalo en el primer envío. Logo y colores si no están en la tienda.",
    mensaje: "Para armarte los planes decime:\n· qué producto(s) van por suscripción\n· cada cuánto le llega al cliente (cada 30 días, cada 15…)\n· qué descuento le das por suscribirse\n· si querés packs (x1, x2, x3) y a qué precio cada uno\n· si hay un regalo en el primer envío\nY, si no están en la tienda, tu logo y tus colores.",
    hace: "Se crean en Planes, con los packs, regalos y el checkout con su marca.",
    done: (m, ctx) => (ctx?.planes_activos || 0) > 0,
  },
  {
    id: "widget",
    title: "Widget andando en la tienda",
    pide: "Nada: se hace con el acceso que ya te dio.",
    hace: "Pegar el snippet en el tema (y la página de checkout en su dominio si la contrató), y usar \"Activar en mi tienda\" hasta que el widget avise que se pintó.",
    done: (m) => tiene(m.widget_verified_at) || tiene(m.widget_last_seen_at),
  },
  {
    id: "marca",
    title: "Mails con su marca",
    pide: "A qué dirección quiere que le respondan sus clientes.",
    mensaje: "¿A qué mail querés que te escriban tus clientes cuando respondan los avisos automáticos? Los mails salen con tu marca y ese es el de respuesta.",
    hace: "Configuración → Marca. Sin ese mail los flujos no se activan.",
    done: (m) => tiene(m.email_reply_to) || tiene(m.shop_email),
  },
  {
    id: "meta",
    title: "Pixel de Meta (opcional)",
    pide: "Pixel ID + token de la API de Conversiones, o que sume a soporte@recurrentesapp.com como socio con acceso al pixel en Business Manager.",
    mensaje: "Si hacés Meta Ads, para que las suscripciones se atribuyan a tus campañas necesito:\n· el ID de tu pixel (Business Manager → Orígenes de datos → tu pixel)\n· un token de la API de Conversiones (en ese mismo pixel: Configuración → Generar token de acceso)\nO, si preferís, sumá a soporte@recurrentesapp.com como socio con acceso al pixel y lo saco yo.",
    hace: "Se carga en Integraciones → Meta Ads. Con eso las compras de la suscripción se le atribuyen a sus campañas.",
    opcional: true,
    done: (m) => tiene(m.meta_pixel_id),
  },
  {
    id: "cobro",
    title: "Primer cobro real",
    pide: "Nada. Es la prueba de que quedó andando: compra de prueba con vos en la llamada.",
    hace: "Verificar que el cobro creó la orden en la tienda y que le llegó el mail de bienvenida.",
    done: (m, ctx) => (ctx?.subs || 0) > 0,
  },
  {
    id: "pago",
    title: "Cobrada la instalación (pago único)",
    pide: "El pago único de la instalación (USD 100 a 200), con todo terminado y funcionando.",
    mensaje: "Quedó todo andando: ya viste el cobro y el pedido en tu tienda. Te paso los datos para el pago único de la instalación que hablamos.",
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

// A dónde va el cliente en cada paso (link del panel). Se arma con la base del sitio.
export const SETUP_STEP_LINK = {
  acceso: "/#/login",
  tienda: "/#/config/integraciones",
  permisos: "/#/config/integraciones",
  mp: "/#/config/integraciones",
  plan: "/#/dashboard/planes",
  marca: "/#/config/marca",
  meta: "/#/config/integraciones",
};

// El mensaje de UN paso, listo para pegar en WhatsApp (28-sept-2026, Thiago: "todos los
// mensajes que tenga que mandar a un cliente para activar su tienda"): saludo, qué
// necesito, el link exacto y el cierre. Sin `mensaje` (pasos nuestros) devuelve null.
// `link` pisa el del paso (ej.: el link de poner contraseña, que se genera en el Admin).
export function mensajePaso(step, { nombre = "", baseUrl = "https://www.recurrentesapp.com", link: linkOverride = null } = {}) {
  if (!step?.mensaje) return null;
  const hola = nombre ? `Hola ${String(nombre).split(" ")[0]}! ` : "Hola! ";
  const link = linkOverride || (SETUP_STEP_LINK[step.id] ? `${String(baseUrl).replace(/\/$/, "")}${SETUP_STEP_LINK[step.id]}` : null);
  return `${hola}Para seguir con la instalación necesito esto de tu lado:\n\n${step.mensaje}`
    + (link ? `\n\nEntrás acá: ${link}` : "")
    + `\n\nCualquier duda me escribís por acá. Con eso sigo yo.`;
}

// El mensaje para pedirle al cliente SOLO lo que falta. Se copia del panel y se
// manda por WhatsApp: es la razón de ser de todo esto, no tener que acordarse
// de qué accesos pedir en cada caso.
export function pedidoDeAccesos(setup, { nombre = "" } = {}) {
  // Solo los pasos que dependen del cliente: los que no tienen `mensaje` son
  // cosas nuestras (montar el widget, esperar el primer cobro) y no se piden.
  const faltan = setup.steps.filter(s => !s.done && !s.opcional && s.mensaje && s.id !== "pago");
  const hola = nombre ? `Hola ${String(nombre).split(" ")[0]}! ` : "Hola! ";
  if (!faltan.length) return `${hola}Ya tengo todo lo que necesito de tu lado. Sigo yo y te aviso cuando esté andando.`;
  return `${hola}La instalación la hago yo; de tu lado necesito solo esto:\n\n`
    + faltan.map((s, i) => `${i + 1}. ${s.mensaje}`).join("\n\n")
    + `\n\nCon eso sigo yo y te aviso apenas esté funcionando.`;
}

// Los permisos de Shopify con el motivo, para explicarlos sin abrir el código.
export const SHOPIFY_PERMISOS = SHOPIFY_SCOPES.map(s => ({ id: s.id, why: s.why, opcional: s.optional === true }));
