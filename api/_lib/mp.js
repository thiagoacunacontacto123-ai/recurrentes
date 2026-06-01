// Helpers Mercado Pago — wrapping de la API REST. Usamos fetch nativo de
// Node 18+ (Vercel runtime). Todas las llamadas toman el accessToken del
// merchant y manejan errores devolviendo objetos con `.error` cuando fallan.

const MP_BASE = "https://api.mercadopago.com";

async function call(method, path, accessToken, body = null) {
  const r = await fetch(`${MP_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    const msg = data.message || data.error || `HTTP ${r.status}`;
    throw new Error(`MP ${method} ${path}: ${msg}`);
  }
  return data;
}

// /users/me — sirve para validar que el token sea legítimo y traer info
// del comerciante (id, country, sandbox flag).
export const mpMe = (token) => call("GET", "/users/me", token);

// Preapproval Plan — plantilla de plan (frecuencia, monto) que se referencia
// desde el Preapproval del cliente. Crear UNO por plan de Recurrentes.
// Doc: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval_plan/post
export const mpCreatePreapprovalPlan = (token, plan) =>
  call("POST", "/preapproval_plan", token, plan);

// Preapproval — la suscripción de UN cliente al plan. Se crea cuando el
// cliente toca "Suscribirme". Devuelve init_point para redirigirlo.
// Doc: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval/post
export const mpCreatePreapproval = (token, preapproval) =>
  call("POST", "/preapproval", token, preapproval);

// Get/Update/Cancel preapproval (para pause / cancel desde el admin).
export const mpGetPreapproval = (token, id) =>
  call("GET", `/preapproval/${id}`, token);

export const mpUpdatePreapproval = (token, id, patch) =>
  call("PUT", `/preapproval/${id}`, token, patch);

export const mpCancelPreapproval = (token, id) =>
  call("PUT", `/preapproval/${id}`, token, { status: "cancelled" });

// Pago individual — lo usamos en el webhook para resolver detalles del
// payment cuando llega un evento `payment.created` con un `id`.
export const mpGetPayment = (token, id) =>
  call("GET", `/v1/payments/${id}`, token);

// Authorized payment — endpoint específico para cobros de suscripciones MP.
// Cuando MP cobra el primer mes de una sub, manda webhook tipo "payment" pero
// el ID puede ser de un `authorized_payment` no de un `payment` normal.
// Acá lo resolvemos. authorized_payment tiene una propiedad `payment` adentro
// con el id del payment real (si MP ya lo procesó).
export const mpGetAuthorizedPayment = (token, id) =>
  call("GET", `/authorized_payments/${id}`, token);

// Resolución universal: prueba primero /v1/payments y si falla /authorized_payments.
// Devuelve un objeto normalizado con { id, status, transaction_amount,
// external_reference, preapproval_id } sin importar de qué endpoint vino.
export async function mpResolvePaymentLike(token, id) {
  // 1) Intento como payment normal
  try {
    const p = await mpGetPayment(token, id);
    if (p?.id) return p;
  } catch (_) {}
  // 2) Intento como authorized_payment
  try {
    const ap = await mpGetAuthorizedPayment(token, id);
    if (ap?.id) {
      // Si el authorized_payment ya tiene payment_id, traemos el payment full
      // para tener transaction_amount + datos de tarjeta + etc.
      if (ap.payment?.id) {
        try {
          const real = await mpGetPayment(token, ap.payment.id);
          if (real?.id) return real;
        } catch (_) {}
      }
      // Si no hay payment todavía, devolvemos el authorized_payment normalizado.
      return {
        id: ap.id,
        status: ap.payment?.status || ap.status,
        transaction_amount: ap.transaction_amount,
        external_reference: ap.external_reference,
        preapproval_id: ap.preapproval_id,
        date_created: ap.date_created,
        _from: "authorized_payment",
      };
    }
  } catch (_) {}
  return null;
}
