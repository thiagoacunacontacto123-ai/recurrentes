// A dónde mandamos a alguien que quiere hablar con nosotros. Un solo lugar:
// estaba suelto en Integrations.jsx y al sumar #/demo iba por el segundo.
//
// Calendly EN VIVO desde el 26-sept-2026: evento "Reunión de 30 minutos" con
// Google Meet, de la cuenta soporte@recurrentesapp.com. Con esto cargado, todos
// los botones que antes abrían WhatsApp abren el calendario, acá y en
// Integraciones. Vaciarlo vuelve todo a WhatsApp sin tocar ninguna pantalla.
export const AGENDA_URL = "https://calendly.com/soporte-recurrentesapp/30min";

// El número de Thiago: instalaciones, ayuda al conectar y la demo.
export const WA_CONTACTO = "5491164117974";

export const waLink = (texto) => `https://wa.me/${WA_CONTACTO}?text=${encodeURIComponent(texto)}`;

/** Agenda si ya existe; si no, WhatsApp con el mensaje que le corresponda. */
export const agendaOWhatsapp = (texto) => AGENDA_URL || waLink(texto);
