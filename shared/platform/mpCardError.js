// Los rechazos de tarjeta de Mercado Pago, en castellano y para el COMPRADOR.
//
// Llegan de dos lados y los dos terminan acá, para que el texto sea el mismo:
//   · el NAVEGADOR, cuando el SDK no puede armar el token (mp.fields.createCardToken).
//     Ahí MP dice exactamente qué campo está mal: es el caso más común y el más
//     fácil de arreglar para el que está comprando.
//   · el SERVIDOR, cuando MP rechaza el alta de la suscripción (POST /preapproval).
//     Ahí ya es la tarjeta, el banco o el antifraude.
//
// Dos reglas:
//   1. Cada texto termina en algo que el comprador puede HACER. "Pago rechazado"
//      a secas es una pared: no sabe si reintentar, cambiar de tarjeta o irse.
//   2. Nunca sale el código crudo de MP (CC_VAL_433, cc_rejected_*, E301): no se
//      entiende y encima asusta.

export const MP_CARD_FALLBACK = "No pudimos cobrar con esa tarjeta. Probá con otra, o pagá con tu cuenta de Mercado Pago.";

// ─── Navegador: el token no se pudo armar ───────────────────────────────────
// Códigos del SDK v2. Los manda en `cause: [{ code, description }]`.
const TOKEN_CODES = {
  205: "Ingresá el número de la tarjeta.",
  208: "Ingresá el mes de vencimiento.",
  209: "Ingresá el año de vencimiento.",
  212: "Ingresá tu DNI o CUIT.",
  213: "Ingresá tu DNI o CUIT.",
  214: "Ingresá tu DNI o CUIT.",
  220: "No reconocemos esa tarjeta. Revisá el número.",
  221: "Ingresá el nombre del titular, como figura en la tarjeta.",
  224: "Ingresá el código de seguridad.",
  316: "El nombre del titular no es válido: escribilo como figura en la tarjeta.",
  322: "Revisá tu DNI o CUIT.",
  323: "Revisá tu DNI o CUIT.",
  324: "Revisá tu DNI o CUIT.",
  325: "El mes de vencimiento no es válido.",
  326: "El año de vencimiento no es válido.",
  E301: "El número de tarjeta no es válido. Revisalo.",
  E302: "El código de seguridad no es válido.",
};
const TOKEN_FALLBACK = "No pudimos validar la tarjeta. Revisá el número, el vencimiento y el código.";

// El SDK tira el error de varias formas según la versión y el navegador: a veces
// un array de causas, a veces un objeto con `cause`, a veces solo un mensaje.
function causas(e) {
  if (!e) return [];
  if (Array.isArray(e)) return e;
  if (Array.isArray(e.cause)) return e.cause;
  if (Array.isArray(e.causes)) return e.causes;
  if (e.cause && typeof e.cause === "object") return [e.cause];
  return [];
}

export function mpTokenErrorText(e) {
  for (const c of causas(e)) {
    const txt = TOKEN_CODES[String(c?.code || "").trim()];
    if (txt) return txt;
  }
  // Sin código reconocido, el texto de MP viene en inglés: no se lo mostramos.
  return TOKEN_FALLBACK;
}

// ─── Servidor: MP rechazó el alta de la suscripción ─────────────────────────
const DECLINE = [
  [/insufficient|fondos/i,                      "La tarjeta no tiene fondos suficientes. Probá con otra."],
  [/security_code|cvv/i,                        "Revisá el código de seguridad de la tarjeta."],
  [/bad_filled_date|expiration|vencim/i,        "Revisá la fecha de vencimiento de la tarjeta."],
  [/call_for_authorize/i,                       "Tu banco tiene que autorizar este pago. Llamalos y volvé a intentar."],
  [/card_disabled|disabled_card/i,              "La tarjeta está inhabilitada. Hablá con tu banco o usá otra."],
  [/max_attempts/i,                             "Llegaste al límite de intentos con esa tarjeta. Probá con otra."],
  [/duplicated/i,                               "Ese pago ya se hizo. Revisá tu correo antes de reintentar."],
  [/not_supported|invalid_payment_type/i,       "Esa tarjeta no sirve para suscripciones. Probá con una de crédito."],
  // Antifraude: la tarjeta puede estar perfecta y MP igual decir que no. Pasa
  // sobre todo con la tarjeta del propio dueño de la tienda.
  [/CC_VAL_433|high_risk|blacklist/i,           "Mercado Pago no aprobó esta tarjeta por seguridad. Probá con otra tarjeta de crédito, o pagá con tu cuenta de Mercado Pago."],
  [/bad_filled|invalid_card|card token|token/i, "Revisá los datos de la tarjeta: número, vencimiento y código."],
];

export function mpDeclineText(e) {
  const txt = `${e?.mp_code || ""} ${e?.mp_message || ""} ${e?.message || ""}`;
  for (const [re, msg] of DECLINE) if (re.test(txt)) return msg;
  return MP_CARD_FALLBACK;
}
