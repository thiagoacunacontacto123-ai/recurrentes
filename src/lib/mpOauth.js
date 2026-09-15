// Textos de la conexión con Mercado Pago por OAuth (vuelta del callback y estado
// de la conexión). Los códigos los arma api/_lib/mpOauth.js.

const ERRORS = {
  cancelled: "Cancelaste la autorización en Mercado Pago. Cuando quieras, volvé a tocar Conectar con Mercado Pago.",
  state: "Ese enlace de conexión no es válido. Volvé a tocar Conectar con Mercado Pago.",
  expired: "Pasaron más de 10 minutos desde que tocaste Conectar. Volvé a intentarlo.",
  state_used: "Ese intento ya se usó, o empezaste otro después. Volvé a tocar Conectar con Mercado Pago.",
  code_expired: "Mercado Pago no aceptó la autorización (venció o ya se usó). Volvé a intentarlo.",
  config: "La conexión automática no está bien configurada de nuestro lado. Mientras lo arreglamos, podés pegar tu Access Token.",
  pkce: "La conexión automática no está bien configurada de nuestro lado. Mientras lo arreglamos, podés pegar tu Access Token.",
  rate_limited: "Mercado Pago está recibiendo muchos pedidos. Esperá un minuto y volvé a intentarlo.",
  mp_down: "Mercado Pago no respondió. Probá de nuevo en unos minutos.",
  network: "Mercado Pago no respondió. Probá de nuevo en unos minutos.",
  exchange: "Mercado Pago no nos dio acceso a tu cuenta. Volvé a intentarlo o pegá tu Access Token.",
  save: "Autorizaste bien, pero no pudimos guardar la conexión. Volvé a intentarlo.",
};

const WARNINGS = {
  changed: "Es una cuenta distinta a la anterior: las suscripciones que ya existían siguen cobrándose en la cuenta vieja.",
  test: "Es una cuenta de prueba: los cobros no son reales.",
  country: "La cuenta no es de Argentina: las suscripciones en pesos pueden no funcionar.",
  no_refresh: "Mercado Pago no dio permiso para renovar el acceso solo: en 6 meses vas a tener que reconectar.",
};

// Lee ?mp=ok|error&reason=…&warn=…&msg=… → { text, tone, ms } o null.
export function mpOauthReturnToast(q) {
  const mp = q.get("mp");
  if (mp === "ok") {
    const warns = String(q.get("warn") || "").split(",").map(w => WARNINGS[w]).filter(Boolean);
    return warns.length
      ? { text: `Mercado Pago conectado. ${warns.join(" ")}`, tone: "warning", ms: 10000 }
      : { text: "Mercado Pago conectado. Ya podés cobrar suscripciones.", tone: "success", ms: 5000 };
  }
  if (mp === "error") {
    const reason = q.get("reason");
    const msg = q.get("msg");
    const text = ERRORS[reason]
      || (msg ? `Mercado Pago devolvió un error (${msg}). Volvé a intentarlo.` : "No se pudo conectar Mercado Pago. Volvé a intentarlo.");
    return { text, tone: reason === "cancelled" ? "warning" : "error", ms: 9000 };
  }
  return null;
}

// Por qué hay que reconectar (merchant.mp_reconnect_reason).
export const MP_RECONNECT_COPY = {
  refresh_invalid: "Mercado Pago cortó el acceso de Recurrentes a tu cuenta (se quitó el permiso o venció). Reconectala para que sigamos procesando los cobros.",
  expired: "El acceso a tu cuenta de Mercado Pago venció. Reconectala para que sigamos procesando los cobros.",
};

// Aviso suave (merchant.mp_last_error): MP rechazó el token hace poco.
export const MP_LAST_ERROR_COPY = {
  token_rejected: "Mercado Pago rechazó el acceso a tu cuenta",
  forbidden: "Mercado Pago no nos dejó ver un cobro de tu cuenta",
};
