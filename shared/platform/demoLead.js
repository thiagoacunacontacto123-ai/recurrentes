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
];

// Cada cuánto le vuelve a comprar un cliente HOY, sin suscripciones. Es el dato
// que dice si el producto es suscribible y con qué frecuencia arrancar.
export const DEMO_RECURRENCIA = [
  { id: "no_vuelve",  label: "Casi no vuelven: compran una vez" },
  { id: "1_mes",      label: "Todos los meses, más o menos" },
  { id: "2_3_meses",  label: "Cada 2 o 3 meses" },
  { id: "4_6_meses",  label: "Cada 4 a 6 meses" },
  { id: "no_se",      label: "No lo tengo medido" },
];

// Las dos confirmaciones. Obligatorias las dos: sin ellas no se manda.
export const DEMO_CONFIRMACIONES = [
  {
    id: "confirma_llamada",
    text: "Entiendo que el equipo de Recurrentes le da un trato 100% empático y personalizado a cada cliente, así que si reservo una llamada me voy a presentar.",
  },
  {
    id: "confirma_pago",
    text: "Entiendo que integrar la opción de suscripción —y la página de suscripción, si la necesito— es un trabajo que lleva horas, y que puede generar mucha ganancia sin depender de conseguir clientes nuevos. Por eso, si avanzo con Recurrentes, pago USD 100 una sola vez, recién cuando la integración esté 100% terminada, al detalle de cómo la quiero, y funcionando.",
  },
];

const ids = (list) => list.map((o) => o.id);
export const DEMO_PEDIDOS_IDS = ids(DEMO_PEDIDOS);
export const DEMO_OBJETIVO_IDS = ids(DEMO_OBJETIVO);
export const DEMO_RECURRENCIA_IDS = ids(DEMO_RECURRENCIA);

export const labelDe = (list, id) => list.find((o) => o.id === id)?.label || "";

const txt = (v, max) => String(v ?? "").trim().replace(/\s+/g, " ").slice(0, max);

// Valida lo que manda el navegador. Devuelve { value } o { error } (texto que se
// le muestra al visitante, en castellano).
export function sanitizeDemoLead(input, { emailRe, normalizeWhatsapp } = {}) {
  const b = input && typeof input === "object" ? input : {};
  const nombre = txt(b.nombre, 80);
  if (nombre.length < 2) return { error: "Ingresá tu nombre." };
  const marca = txt(b.marca, 120);
  if (marca.length < 2) return { error: "Ingresá el nombre de tu marca o el link de tu tienda." };
  const whatsapp = normalizeWhatsapp ? normalizeWhatsapp(b.whatsapp) : txt(b.whatsapp, 25);
  if (!whatsapp) return { error: "Ingresá tu WhatsApp con código de área (ej: 11 6411 7974)." };
  const email = txt(b.email, 160).toLowerCase();
  if (emailRe && !emailRe.test(email)) return { error: "Ingresá un email válido." };

  const pedidos = txt(b.pedidos, 20);
  if (!DEMO_PEDIDOS_IDS.includes(pedidos)) return { error: "Contanos cuántos pedidos vendés por día." };
  const objetivo = txt(b.objetivo, 20);
  if (!DEMO_OBJETIVO_IDS.includes(objetivo)) return { error: "Contanos qué querés lograr con las suscripciones." };
  const recurrencia = txt(b.recurrencia, 20);
  if (!DEMO_RECURRENCIA_IDS.includes(recurrencia)) return { error: "Contanos cada cuánto te vuelve a comprar un cliente hoy." };

  // Las dos casillas son el filtro entero: sin ellas no hay lead.
  for (const c of DEMO_CONFIRMACIONES) {
    if (b[c.id] !== true) return { error: "Para reservar la llamada tenés que marcar las dos casillas." };
  }

  return {
    value: {
      nombre, marca, whatsapp, email,
      pedidos, objetivo, recurrencia,
      confirma_llamada: true, confirma_pago: true,
    },
  };
}

// Una línea con todo lo que contestó, para el aviso a Thiago por WhatsApp/mail.
export function resumenDemoLead(lead) {
  return [
    labelDe(DEMO_PEDIDOS, lead.pedidos),
    "recompra hoy: " + labelDe(DEMO_RECURRENCIA, lead.recurrencia).toLowerCase(),
    labelDe(DEMO_OBJETIVO, lead.objetivo).toLowerCase(),
    "ACEPTA PAGAR USD 100",
  ].filter(Boolean).join(" · ");
}
