// A dónde mandamos a alguien que quiere hablar con nosotros. Un solo lugar:
// estaba suelto en Integrations.jsx y al sumar #/demo iba por el segundo.
//
// CUANDO ESTÉ EL CALENDLY: pegá la URL en AGENDA_URL y listo. Todos los botones
// que hoy abren WhatsApp pasan solos a abrir el calendario — no hay que tocar
// ninguna pantalla. Ejemplo: "https://calendly.com/thiago-recurrentes/demo".
// Vacío = se sigue coordinando por WhatsApp.
export const AGENDA_URL = "";

// El número de Thiago: instalaciones, ayuda al conectar y la demo.
export const WA_CONTACTO = "5491164117974";

export const waLink = (texto) => `https://wa.me/${WA_CONTACTO}?text=${encodeURIComponent(texto)}`;

/** Agenda si ya existe; si no, WhatsApp con el mensaje que le corresponda. */
export const agendaOWhatsapp = (texto) => AGENDA_URL || waLink(texto);
