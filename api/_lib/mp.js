// Helpers Mercado Pago — wrapping de la API REST. Usamos fetch nativo de
// Node 18+ (Vercel runtime) con timeout (10s). Todas las llamadas toman el
// accessToken del merchant y LANZAN un Error cuando MP responde !ok, con
// `err.status` = HTTP status para que el caller distinga 401/403 (token) de
// 429/5xx (transitorio). Nunca devuelven "vacío" ante un error HTTP.
import { fetchWithTimeout } from "./http.js";

const MP_BASE = "https://api.mercadopago.com";
const MP_TIMEOUT_MS = 10000;

async function call(method, path, accessToken, body = null) {
  const r = await fetchWithTimeout(`${MP_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  }, MP_TIMEOUT_MS);
  const text = await r.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!r.ok || (data && data.error && !data.id)) {
    // Mensaje con path + status + snippet del body (sin tirar el body completo al log).
    const snippet = String(text || "").replace(/\s+/g, " ").slice(0, 200);
    const msg = data?.message || data?.error || "";
    const err = new Error(`MP ${method} ${path}: HTTP ${r.status}${msg ? " " + msg : ""}${snippet ? " — " + snippet : ""}`);
    err.status = r.status;
    err.mp_error = data?.error || null;
    throw err;
  }
  return data;
}

// ¿El error es de credenciales (token vencido/revocado)? 401/403.
// El `reason` del plan es lo que el cliente ve en su resumen de Mercado Pago, y
// MP lo corta en 60 caracteres: mas largo = HTTP 400 "Reason has more than 60
// characters" y no se puede crear el plan NI suscribir a nadie.
// Caso Wellfresh (22-sept-2026): "Well Fresh™ | Gotas naturales para el mal
// aliento" son 49 chars y con el sufijo se iba a 64 (y a 89 en el checkout).
// Se recorta el TITULO, nunca el sufijo: el "cada 30 dias" es lo que le dice al
// cliente que es recurrente y tiene que quedar si o si.
export const MP_REASON_MAX = 60;
export function mpReason(titulo, sufijo = "") {
  // `sufijo` se toma TAL CUAL (con su espacio inicial si lo trae): es parte del
  // formato final, no un texto del comerciante.
  const suf = String(sufijo || "");
  const t = String(titulo || "").trim().replace(/\s+/g, " ");
  if (!suf) return t.slice(0, MP_REASON_MAX);
  const libre = MP_REASON_MAX - suf.length;
  // Si el sufijo solo ya no entra, mandamos lo que entre de el.
  if (libre <= 1) return suf.trim().slice(0, MP_REASON_MAX);
  const corto = t.length <= libre ? t : t.slice(0, libre - 1).trimEnd() + "\u2026";
  return (corto + suf).slice(0, MP_REASON_MAX);
}

export const isMpAuthError = (e) => !!e && (e.status === 401 || e.status === 403);

// GET genérico (path con query ya armada). Lanza en !ok.
export const mpGet = (token, path) => call("GET", path, token);

// /users/me — sirve para validar que el token sea legítimo y traer info
// del comerciante (id, country, sandbox flag).
export const mpMe = (token) => call("GET", "/users/me", token);

// Preapproval Plan — plantilla de plan (frecuencia, monto) que se referencia
// desde el Preapproval del cliente. Crear UNO por plan de Recurrentes.
// Doc: https://www.mercadopago.com.ar/developers/es/reference/subscriptions/_preapproval_plan/post
export const mpCreatePreapprovalPlan = (token, plan) =>
  call("POST", "/preapproval_plan", token, plan);

// Cancelar un preapproval_plan ad-hoc huérfano (lead que nunca autorizó).
export const mpCancelPreapprovalPlan = (token, id) =>
  call("PUT", `/preapproval_plan/${id}`, token, { status: "cancelled" });

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

// Búsqueda de preapprovals por plan ad-hoc (1:1 con el subscriber en el flujo de plan).
export const mpSearchPreapprovalsByPlan = (token, planId) =>
  call("GET", `/preapproval/search?preapproval_plan_id=${encodeURIComponent(planId)}`, token);

// Búsqueda de preapprovals genérica: params = { external_reference, status, ... }.
export const mpSearchPreapprovals = (token, params = {}) =>
  call("GET", `/preapproval/search?${new URLSearchParams(params).toString()}`, token);

// Búsqueda de pagos: params = { preapproval_id | external_reference | range/begin_date/end_date, sort, criteria, limit }.
export const mpSearchPayments = (token, params = {}) =>
  call("GET", `/v1/payments/search?${new URLSearchParams(params).toString()}`, token);

// Búsqueda de authorized_payments (cobros de suscripción) por preapproval.
export const mpSearchAuthorizedPayments = (token, preapprovalId) =>
  call("GET", `/authorized_payments/search?preapproval_id=${encodeURIComponent(preapprovalId)}`, token);

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

// Refresh del token OAuth de MP. Devuelve { access_token, refresh_token, expires_in, user_id }.
// Requiere MP_APP_ID + MP_CLIENT_SECRET en env. Lanza si falla.
export async function mpRefreshToken(refreshToken) {
  const clientId = process.env.MP_APP_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("MP_APP_ID/MP_CLIENT_SECRET no configurados");
  if (!refreshToken) throw new Error("refresh_token vacío");
  const r = await fetchWithTimeout(`${MP_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  }, MP_TIMEOUT_MS);
  const text = await r.text().catch(() => "");
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = {}; }
  if (!r.ok || !data.access_token) {
    const err = new Error(`MP POST /oauth/token: HTTP ${r.status} ${data?.message || data?.error || ""} — ${String(text).replace(/\s+/g, " ").slice(0, 200)}`);
    err.status = r.status;
    err.mp_error = data?.error || null; // invalid_grant = el vendedor revocó / venció → reconectar
    throw err;
  }
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    expires_in: data.expires_in,
    user_id: data.user_id,
    public_key: data.public_key,
    live_mode: data.live_mode,
  };
}

// Resolución universal: prueba primero /v1/payments y si falla /authorized_payments.
// Devuelve un objeto normalizado con { id, status, transaction_amount,
// external_reference, preapproval_id } sin importar de qué endpoint vino.
// Un 401/403 se propaga (token inválido): no tiene sentido seguir probando.
export async function mpResolvePaymentLike(token, id) {
  // 1) Intento como payment normal
  try {
    const p = await mpGetPayment(token, id);
    if (p?.id) return p;
  } catch (e) { if (isMpAuthError(e)) throw e; }
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
        } catch (e) { if (isMpAuthError(e)) throw e; }
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
  } catch (e) { if (isMpAuthError(e)) throw e; }
  return null;
}
