// A dónde mandamos a alguien que quiere hablar con nosotros. Un solo lugar:
// estaba suelto en Integrations.jsx y al sumar #/demo iba por el segundo.
//
// Calendly EN VIVO desde el 26-sept-2026: evento "DEMO RECURRENTES:
// Suscripciones en tu ecommerce (15min)" con Google Meet, de la cuenta
// soporte@recurrentesapp.com.
//
// OJO: el final de la URL sale del NOMBRE del evento en Calendly. Al renombrarlo
// de 30 a 15 minutos, /30min pasó a devolver 404 y el botón de la demo quedó
// roto sin que nada avisara. Si se vuelve a renombrar, hay que actualizar acá. Con esto cargado, todos
// los botones que antes abrían WhatsApp abren el calendario, acá y en
// Integraciones. Vaciarlo vuelve todo a WhatsApp sin tocar ninguna pantalla.
export const AGENDA_URL = "https://calendly.com/soporte-recurrentesapp/15min";

// El número de Thiago: instalaciones, ayuda al conectar y la demo.
export const WA_CONTACTO = "5491164117974";

export const waLink = (texto) => `https://wa.me/${WA_CONTACTO}?text=${encodeURIComponent(texto)}`;

/** Agenda si ya existe; si no, WhatsApp con el mensaje que le corresponda. */
export const agendaOWhatsapp = (texto) => AGENDA_URL || waLink(texto);

// El link del calendario CON los datos que la persona ya nos dio.
//
// Los pedimos en nuestro formulario y no en Calendly a propósito: así el que
// llena y después no reserva igual queda como lead, y las casillas de
// compromiso filtran antes de ocuparte una hora. Pero entonces Calendly le
// volvía a pedir nombre y mail, y eso es doble carga y queda mal. Calendly
// acepta prellenarlos por la URL (name, email) y también los utm_*, así que
// el que reserva solo elige el horario y de paso sabés de qué anuncio salió.
export function agendaUrl({ nombre, email, attribution } = {}) {
  if (!AGENDA_URL) return null;
  const q = new URLSearchParams();
  if (nombre) q.set("name", String(nombre).trim().slice(0, 80));
  if (email) q.set("email", String(email).trim().slice(0, 160));
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = attribution?.[k];
    if (v) q.set(k, String(v).slice(0, 100));
  }
  const qs = q.toString();
  return qs ? `${AGENDA_URL}?${qs}` : AGENDA_URL;
}
