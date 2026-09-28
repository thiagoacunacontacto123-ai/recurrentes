// Pedido de demo — la puerta de entrada desde el 25-sept-2026 (Thiago).
//
// Por qué existe: las dos tiendas que funcionan (Glow Derm y Well Fresh) salieron
// las dos con Thiago haciendo la integración a mano, y los 4 leads que trajo el
// primer creativo de Meta se registraron solos y no conectaron nada (3 de 4
// contestaron "sin ventas"). El autoservicio no cierra: la venta es demo +
// puesta en marcha paga. Este formulario reemplaza al "Empezar gratis" como
// camino principal de la landing; el registro sigue existiendo (lo necesita la
// instalación desde la app store de Tiendanube) pero queda en segundo plano.
//
// Las dos casillas NO son letra chica: son el filtro. El que no acepta pagar los
// USD 100 no manda el formulario, y por eso cada envío ya es un lead calificado
// (de ahí que el evento RegistroCalificado salga de acá, sin mirar el volumen).
//
// Fuente ÚNICA: la usa src/pages/Demo.jsx para pintar y api/public.js para validar.

// Nicho y tamaño del catálogo en vez del nombre de la marca (27-sept-2026, Thiago:
// "para no ser tan invasivo"): la gente no quiere decir su marca antes de la llamada.
// La lista es larga a propósito ("que no falte ninguno") y va ordenada por cuántas tiendas
// de cada rubro venden por suscripción en Argentina (Thiago); "Otro" al final.
export const DEMO_NICHO = [
  { id: "suplementos",   label: "Suplementos y vitaminas" },
  { id: "cosmetica",     label: "Cosmética y skincare" },
  { id: "mascotas",      label: "Mascotas (alimento y accesorios)" },
  { id: "cafe",          label: "Café" },
  { id: "yerba_te",      label: "Yerba mate, té e infusiones" },
  { id: "alimentos",     label: "Alimentos y snacks" },
  { id: "dietetica",     label: "Dietética y productos naturales" },
  { id: "bebidas",       label: "Bebidas (vinos, cervezas, jugos)" },
  { id: "cuidado_personal", label: "Cuidado personal e higiene" },
  { id: "limpieza",      label: "Limpieza del hogar" },
  { id: "bebes",         label: "Bebés y maternidad" },
  { id: "salud",         label: "Salud y farmacia" },
  { id: "fitness",       label: "Fitness y deportes" },
  { id: "ropa",          label: "Indumentaria y calzado" },
  { id: "lenceria",      label: "Lencería y ropa interior" },
  { id: "perfumeria",    label: "Perfumería" },
  { id: "bienestar",     label: "Bienestar (velas, aromas, sahumerios)" },
  { id: "accesorios",    label: "Accesorios y joyería" },
  { id: "hogar",         label: "Hogar y decoración" },
  { id: "jardin",        label: "Jardín y plantas" },
  { id: "optica",        label: "Óptica y anteojos" },
  { id: "sex_shop",      label: "Sex shop" },
  { id: "libreria",      label: "Librería y papelería" },
  { id: "libros",        label: "Libros y revistas" },
  { id: "juguetes",      label: "Juguetes y juegos" },
  { id: "tecnologia",    label: "Tecnología y electrónica" },
  { id: "arte",          label: "Arte, manualidades e insumos" },
  { id: "automotor",     label: "Automotor y motos" },
  { id: "flores",        label: "Flores y regalos" },
  { id: "servicios",     label: "Servicios y membresías" },
  { id: "otro",          label: "Otro" },
];

export const DEMO_CATALOGO = [
  { id: "uni",    label: "Un solo producto" },
  { id: "2_5",    label: "Entre 2 y 5 productos" },
  { id: "5_15",   label: "Entre 5 y 15 productos" },
  { id: "15_mas", label: "Más de 15 productos" },
];

// Qué quiere en su web (27-sept-2026): el widget en la ficha, una página aparte, o las dos.
export const DEMO_MODALIDAD = [
  { id: "widget",  label: "Widget en la ficha: compra única + suscripción" },
  { id: "pagina",  label: "Una página aparte de suscripción" },
  { id: "ambos",   label: "Las dos: widget y página de suscripción" },
  { id: "no_se",   label: "No lo tengo claro, lo vemos en la llamada" },
];

// Cuánto vende hoy. En pedidos POR DÍA (Thiago): el que vende lo piensa así,
// no en pedidos por mes.
export const DEMO_PEDIDOS = [
  { id: "menos_1", label: "Menos de 1 por día" },
  { id: "1_5",     label: "Entre 1 y 5 por día" },
  { id: "5_15",    label: "Entre 5 y 15 por día" },
  { id: "15_50",   label: "Entre 15 y 50 por día" },
  { id: "50_mas",  label: "Más de 50 por día" },
];

export const DEMO_OBJETIVO = [
  { id: "recompra",     label: "Que mis clientes vuelvan a comprar solos" },
  { id: "ingreso_fijo", label: "Tener un ingreso fijo todos los meses" },
  { id: "ticket",       label: "Vender packs más grandes (más plata por venta)" },
  { id: "dejar_manual", label: "Dejar de perseguir la recompra a mano" },
  // La de siempre (25-sept-2026, Thiago): el que quiere las cuatro no tiene que
  // elegir una y dejar afuera el resto.
  { id: "todas",        label: "Todas las anteriores" },
];

// Qué PORCENTAJE de sus clientes le vuelve a comprar hoy, sin suscripciones
// (25-sept-2026, Thiago: "la pregunta era cuánto es tu tasa de clientes
// recurrentes actualmente"). Es el dato que dice si hay algo que convertir en
// suscripción: con 3% de recompra no hay nada que automatizar; con 30% sí.
export const DEMO_RECURRENCIA = [
  { id: "menos_10", label: "Menos del 10%" },
  { id: "10_25",    label: "Entre el 10% y el 25%" },
  { id: "25_50",    label: "Entre el 25% y el 50%" },
  { id: "mas_50",   label: "Más del 50%" },
  { id: "no_se",    label: "No lo tengo medido" },
];

// Las dos confirmaciones. Obligatorias las dos: sin ellas no se manda.
export const DEMO_CONFIRMACIONES = [
  {
    id: "confirma_llamada",
    text: "Entiendo que el equipo de Recurrentes le da un trato 100% empático y personalizado a cada cliente, así que si reservo una llamada me voy a presentar.",
  },
  {
    id: "confirma_pago",
    // Redactada como COMPROMISO en primera persona, no como dato ("pago USD
    // 100"): el que marca esto se está comprometiendo, y es lo único que
    // separa al que va a avanzar del que mira. 25-sept-2026, Thiago.
    text: "Entiendo que integrar la opción de suscripción —y la página de suscripción, si la necesito— es un trabajo que lleva horas, y que puedo conseguir mucha ganancia sin depender de clientes nuevos. Por eso, si avanzo con Recurrentes, voy a realizar el pago de USD 100 del costo de integración, una sola vez, recién con la integración terminada, al detalle de cómo la quiero, y funcionando.",
  },
];

// Las tres preguntas, con su texto EXACTO. De acá las pinta el formulario y de
// acá sale el aviso que le llega a Thiago (25-sept-2026: "que me repita la
// pregunta con su respuesta"): si alguna vez se cambia una, cambia en los dos
// lados a la vez y el aviso nunca miente sobre lo que se le preguntó.
export const DEMO_PREGUNTAS = [
  { id: "nicho",       label: "¿De qué nicho es tu marca?",                  options: DEMO_NICHO,       error: "Contanos de qué nicho es tu marca." },
  { id: "catalogo",    label: "¿Cuántos productos tiene tu marca?",          options: DEMO_CATALOGO,    error: "Contanos cuántos productos tiene tu marca." },
  { id: "pedidos",     label: "¿Cuántos pedidos vendés por día?",            options: DEMO_PEDIDOS,     error: "Contanos cuántos pedidos vendés por día." },
  { id: "recurrencia", label: "¿Cuál es tu tasa de clientes recurrentes hoy?", options: DEMO_RECURRENCIA, error: "Contanos qué tasa de clientes recurrentes tenés hoy." },
  { id: "objetivo",    label: "¿Qué querés lograr con las suscripciones?",   options: DEMO_OBJETIVO,    error: "Contanos qué querés lograr con las suscripciones." },
  { id: "modalidad",   label: "¿Qué modalidad de suscripción querés en tu web?", options: DEMO_MODALIDAD, error: "Contanos qué modalidad querés en tu web." },
];

export const labelDe = (list, id) => list.find((o) => o.id === id)?.label || "";

const txt = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// Valida lo que manda el navegador. Devuelve { value } o { error, field } (texto que se
// le muestra al visitante, en castellano, y el id del campo que falla: el formulario
// marca ESE campo en rojo y desliza hasta él, como el checkout; 27-sept-2026).
export function sanitizeDemoLead(input, { emailRe, normalizeWhatsapp } = {}) {
  const b = input && typeof input === "object" ? input : {};
  const nombre = txt(b.nombre, 80);
  if (nombre.length < 2) return { error: "Ingresá tu nombre.", field: "nombre" };
  const whatsapp = normalizeWhatsapp ? normalizeWhatsapp(b.whatsapp) : txt(b.whatsapp, 25);
  if (!whatsapp) return { error: "Ingresá tu WhatsApp con código de área (ej: 11 2345 6789).", field: "whatsapp" };
  const email = txt(b.email, 160).toLowerCase();
  if (emailRe && !emailRe.test(email)) return { error: "Ingresá un email válido.", field: "email" };

  const respuestas = {};
  for (const q of DEMO_PREGUNTAS) {
    const v = txt(b[q.id], 20);
    if (!q.options.some((o) => o.id === v)) return { error: q.error, field: q.id };
    respuestas[q.id] = v;
  }

  // Las dos casillas son el filtro entero: sin ellas no hay lead.
  for (const c of DEMO_CONFIRMACIONES) {
    if (b[c.id] !== true) return { error: "Marcá esta casilla para reservar la llamada.", field: c.id };
  }

  // `marca` ya no se pregunta: queda como etiqueta "nicho · catálogo" para el Admin y los avisos.
  const marca = `${labelDe(DEMO_NICHO, respuestas.nicho)} · ${labelDe(DEMO_CATALOGO, respuestas.catalogo)}`;
  return {
    value: {
      nombre, marca, whatsapp, email,
      ...respuestas,
      confirma_llamada: true, confirma_pago: true,
    },
  };
}

// El aviso a Thiago: cada PREGUNTA con su respuesta, tal cual las vio el que
// llenó el formulario.
//
// Va todo en UNA línea a propósito: Meta no acepta saltos de línea dentro de
// una variable de plantilla y los aplasta a espacios (waParamText), así que un
// "\n" acá no se vería como salto sino como un texto corrido sin separación.
// Por eso el separador es " · " y la pregunta queda pegada a su respuesta.
// Etiquetas cortas por pregunta para el aviso por WhatsApp, una por línea.
export const DEMO_PREGUNTA_CORTA = { nicho: "Nicho", catalogo: "Productos", pedidos: "Pedidos por día", recurrencia: "Recompra hoy", objetivo: "Objetivo", modalidad: "Modalidad" };
// Las variables de la plantilla `aviso_admin_demo` (shared/platform/whatsapp.js):
// nombre · contacto · r1..r6 (una respuesta por variable, sin saltos de línea adentro).
export function demoLeadWaVars(lead) {
  const out = {
    nombre: lead.nombre || "-",
    contacto: `WhatsApp ${lead.whatsapp || "-"} · ${lead.email || "-"}`,
  };
  DEMO_PREGUNTAS.forEach((q, i) => { out[`r${i + 1}`] = `${DEMO_PREGUNTA_CORTA[q.id] || q.label}: ${labelDe(q.options, lead[q.id]) || "-"}`; });
  return out;
}

export function resumenDemoLead(lead) {
  const partes = DEMO_PREGUNTAS.map((q) => `${q.label} ${labelDe(q.options, lead[q.id]) || "-"}`);
  partes.push("¿Acepta pagar los USD 100 de la integración? SÍ");
  return partes.join(" · ");
}
