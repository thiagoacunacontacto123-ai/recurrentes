// Adapter de Mobbex (Argentina, ARS) — suscripciones con tarjeta guardada.
//
// Docs (leídas 2026-09-15):
//   · Autenticación y modo prueba: https://mobbex.dev/en-first-steps
//   · Suscripciones (planes):      https://mobbex.dev/suscripciones
//   · Suscriptores:                https://mobbex.dev/suscriptores
//   · Ejecuciones + webhooks:      https://mobbex.dev/ejecuciones · https://mobbex.dev/webhooks
//   · Códigos de estado:           https://mobbex.dev/codigos-de-estado
//   · SDK oficial (formas reales): https://github.com/mobbexco/php-plugins-sdk
//
// Modelo (igual que el plan ad-hoc de Mercado Pago): por cada checkout creamos
//   1) una suscripción Mobbex con el monto exacto (qty + envío) y el intervalo,
//   2) un suscriptor dentro de ella con reference "mid:sid" y el DNI del cliente.
// El cliente carga la tarjeta en `sourceUrl`; Mobbex cobra solo y avisa al webhook.
//   providerPlanId         = uid de la suscripción Mobbex
//   providerSubscriptionId = "<uid suscripción>:<uid suscriptor>" (los endpoints piden los dos)
//
// Credenciales por merchant: x-access-token (merchant.mobbex_access_token) y
// x-api-key (merchant.mobbex_api_key o, si Recurrentes tiene app propia en Mobbex,
// env MOBBEX_API_KEY). Modo prueba: merchant.mobbex_test o env MOBBEX_TEST=1 → test:true.
//
// Autenticidad del webhook: Mobbex NO firma sus avisos. Usamos (a) el token HMAC
// por merchant en la URL (webhookToken.js, mismo criterio que el plugin oficial
// con ?mobbex_token=) y (b) re-consultamos el suscriptor a la API de Mobbex con
// las credenciales del merchant antes de aceptar el evento.
import { fetchWithTimeout } from "../http.js";
import { verifyProviderWebhookToken } from "./webhookToken.js";

export const MOBBEX_API = "https://api.mobbex.com/p";
const ID = "mobbex";

const envOn = (name) => ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());

class MobbexError extends Error {
  constructor(message, { status = 502, userMessage = null, details = null } = {}) {
    super(message);
    this.name = "MobbexError";
    this.status = status;          // 400 = problema de datos/config (no reintentar), 502 = Mobbex falló
    this.userMessage = userMessage; // texto para mostrar al comprador/comerciante
    this.details = details;
  }
}

export function mobbexCreds(merchant, override = null) {
  const apiKey = String(override?.api_key || merchant?.mobbex_api_key || process.env.MOBBEX_API_KEY || "").trim();
  const accessToken = String(override?.access_token || merchant?.mobbex_access_token || "").trim();
  return { apiKey, accessToken };
}

function headers({ apiKey, accessToken }) {
  return {
    "x-api-key": apiKey,
    "x-access-token": accessToken,
    "content-type": "application/json",
    "cache-control": "no-cache",
  };
}

async function mobbexRequest(creds, method, path, body) {
  if (!creds.apiKey || !creds.accessToken) {
    throw new MobbexError("Mobbex no está conectado (faltan credenciales)", { status: 400, userMessage: "La tienda todavía no terminó de conectar Mobbex. Avisale al vendedor." });
  }
  const r = await fetchWithTimeout(`${MOBBEX_API}${path}`, {
    method,
    headers: headers(creds),
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, 10000);
  const text = await r.text().catch(() => "");
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) {}
  if (!r.ok || !json || json.result === false) {
    const msg = json?.error || json?.message || json?.data?.message || `HTTP ${r.status}`;
    const err = new MobbexError(`Mobbex ${method} ${path}: ${msg}`, { status: r.status === 401 || r.status === 403 ? 400 : 502, details: json });
    err.httpStatus = r.status;
    throw err;
  }
  return json;
}

// Intervalos que acepta Mobbex: 7d, 15d, 1m, 2m, 3m, 6m, 1y. Solo mapeamos
// frecuencias equivalentes; cualquier otra se rechaza (no cobramos con otra cadencia).
export function mobbexInterval(days) {
  const d = parseInt(days, 10);
  if (d === 7) return "7d";
  if (d === 15) return "15d";
  if (d >= 28 && d <= 31) return "1m";
  if (d >= 56 && d <= 62) return "2m";
  if (d >= 84 && d <= 93) return "3m";
  if (d >= 180 && d <= 184) return "6m";
  if (d >= 360 && d <= 366) return "1y";
  return null;
}

const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const digits = (s) => String(s ?? "").replace(/[^0-9]/g, "");

// Fecha del SEGUNDO cobro: el primero lo hace `charge_on_first_source` apenas el
// cliente carga la tarjeta. Así nunca hay dos cobros el mismo día (ver README).
function secondChargeDate(frequencyDays, now = new Date()) {
  const d = new Date(now.getTime() + Math.max(1, parseInt(frequencyDays, 10) || 30) * 86400000);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear() };
}

export function buildSubscriptionBody({ merchantId, subscriberId, sub, plan, amount, currency, frequencyDays, backUrl, notificationUrl, test }) {
  const interval = mobbexInterval(frequencyDays);
  const title = clip(sub?.plan_snapshot?.product_title || plan?.product_title || "Suscripción", 80);
  const qty = parseInt(sub?.quantity, 10) || 1;
  return {
    total: Math.round(Number(amount) * 100) / 100,
    setupFee: 0,
    currency,
    type: "dynamic",
    name: title,
    description: clip(`${title}${qty > 1 ? ` × ${qty}` : ""} — cada ${parseInt(frequencyDays, 10)} días`, 200),
    interval,
    trial: 0,
    limit: 0,
    return_url: backUrl,
    webhook: notificationUrl,
    reference: `rec:${merchantId}:${subscriberId}`,
    features: ["charge_on_first_source"],
    test: !!test,
  };
}

export function buildSubscriberBody({ merchantId, subscriberId, amount, frequencyDays, customer, test, now }) {
  return {
    customer: {
      email: clip(customer?.email, 120),
      name: clip(customer?.name, 120),
      identification: digits(customer?.tax_id),
      ...(customer?.phone ? { phone: clip(customer.phone, 40) } : {}),
    },
    startDate: secondChargeDate(frequencyDays, now),
    reference: `${merchantId}:${subscriberId}`,
    total: Math.round(Number(amount) * 100) / 100,
    test: !!test,
  };
}

const isTest = (merchant) => merchant?.mobbex_test === true || envOn("MOBBEX_TEST");

export function splitProviderSubscriptionId(id) {
  const [sid, suid] = String(id || "").split(":");
  if (!sid || !suid) throw new MobbexError(`id de suscripción Mobbex inválido: ${id}`, { status: 400 });
  return { sid, suid };
}

// ── Webhook: cuerpo JSON o form-urlencoded con claves anidadas data[payment][id] ──
function setDeep(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    if (o[k] == null || typeof o[k] !== "object") o[k] = {};
    o = o[k];
  }
  o[path[path.length - 1]] = value;
}
const bracketPath = (key) => String(key).replace(/\]/g, "").split("[").filter((p) => p !== "");

export function parseMobbexBody(body) {
  let b = body;
  if (b && typeof b === "object" && typeof b.length === "number" && typeof b.toString === "function" && !Array.isArray(b)) b = b.toString("utf8"); // Buffer
  if (typeof b === "string") {
    const s = b.trim();
    if (s.startsWith("{")) { try { return JSON.parse(s); } catch (_) { return {}; } }
    const out = {};
    for (const [k, v] of new URLSearchParams(s)) setDeep(out, bracketPath(k), v);
    return out;
  }
  if (!b || typeof b !== "object") return {};
  // Objeto ya parseado por Vercel: si vino urlencoded, las claves son planas "data[payment][id]".
  if (Object.keys(b).some((k) => k.includes("["))) {
    const out = {};
    for (const [k, v] of Object.entries(b)) setDeep(out, bracketPath(k), v);
    return out;
  }
  // JSON con `data` como string (algunos plugins lo reenvían así).
  if (typeof b.data === "string" && b.data.trim().startsWith("{")) {
    try { return { ...b, data: JSON.parse(b.data) }; } catch (_) {}
  }
  return b;
}

// Códigos de estado de pago (https://mobbex.dev/codigos-de-estado).
export function paymentOutcome(code) {
  const c = parseInt(String(code ?? "").trim(), 10);
  if (!Number.isFinite(c)) return "unknown";
  if (c === 200) return "approved";
  if ((c >= 400 && c <= 419) || c === 500 || (c >= 601 && c <= 610)) return "rejected";
  return "pending"; // 1/2/3/100/201/210/299/3xx/600: en proceso, validación o liquidación
}

function normalizeEvents(body) {
  const type = String(body?.type || "");
  const data = body?.data || {};
  const sid = data.subscription?.uid || null;
  const suid = data.subscriber?.uid || null;
  const base = {
    providerSubscriptionId: sid && suid ? `${sid}:${suid}` : null,
    subscriberRef: data.subscriber?.reference || null,
  };
  const currencyRaw = String(data.payment?.currency?.code || "ARS").toUpperCase();
  const currency = currencyRaw === "TEST" ? "ARS" : currencyRaw; // en modo prueba Mobbex manda "TEST"
  const date = data.payment?.created || data.execution?.created || data.created || new Date().toISOString();
  const payId = data.payment?.id || data.execution?.uid || null;
  const amount = data.payment?.total != null ? Number(data.payment.total) : (data.execution?.total != null ? Number(data.execution.total) : null);

  if (type === "subscription:execution") {
    const outcome = paymentOutcome(data.payment?.status?.code);
    if (outcome === "approved") return [{ type: "charge_approved", ...base, paymentId: payId, amount, currency, date, raw: body }];
    if (outcome === "rejected") return [{ type: "charge_failed", ...base, paymentId: payId, amount, currency, date, raw: body }];
    return [];
  }
  if (type === "subscription:execution:error") {
    return [{ type: "charge_failed", ...base, paymentId: payId, amount, currency, date, raw: body }];
  }
  if (type === "subscription:subscriber:suspended") return [{ type: "subscription_paused", ...base, paymentId: null, amount: null, currency, date, raw: body }];
  if (type === "subscription:subscriber:active") return [{ type: "subscription_resumed", ...base, paymentId: null, amount: null, currency, date, raw: body }];
  // subscription:registration / change_source: la tarjeta quedó cargada; el cobro llega aparte.
  return [];
}

const adapter = {
  id: ID,
  label: "Mobbex",
  currency: "ARS",

  isEnabled() {
    return envOn("MOBBEX_ENABLED");
  },

  async createSubscriptionCheckout({ merchant, merchantId, subscriberId, sub, plan, amount, currency, frequencyDays, backUrl, notificationUrl, customer }) {
    if ((currency || "ARS") !== "ARS") throw new MobbexError(`Mobbex solo cobra en ARS (pedido: ${currency})`, { status: 400, userMessage: "Esta tienda cobra en pesos con Mobbex." });
    if (!(Number(amount) > 0)) throw new MobbexError("monto inválido", { status: 400, userMessage: "El total de la suscripción no es válido." });
    if (!mobbexInterval(frequencyDays)) {
      throw new MobbexError(`Mobbex no cobra cada ${frequencyDays} días`, { status: 400, userMessage: `Esta frecuencia (cada ${frequencyDays} días) no está disponible con Mobbex. Probá con 7, 15, 30, 60, 90, 180 o 365 días.` });
    }
    const dni = digits(customer?.tax_id);
    if (!(dni.length >= 7 && dni.length <= 11)) {
      throw new MobbexError("falta DNI del cliente", { status: 400, userMessage: "Para pagar con Mobbex necesitamos tu DNI o CUIT." });
    }
    if (!customer?.email || !customer?.name) throw new MobbexError("faltan email/nombre", { status: 400, userMessage: "Falta tu nombre o email." });
    if (!notificationUrl) throw new MobbexError("falta notificationUrl (APP_BASE_URL)", { status: 400 });

    const creds = mobbexCreds(merchant);
    const test = isTest(merchant);
    const subBody = buildSubscriptionBody({ merchantId, subscriberId, sub, plan, amount, currency: "ARS", frequencyDays, backUrl, notificationUrl, test });
    const s = await mobbexRequest(creds, "POST", "/subscriptions", subBody);
    const subscriptionUid = s?.data?.uid;
    if (!subscriptionUid) throw new MobbexError("Mobbex no devolvió el uid de la suscripción", { details: s });

    const subscriberBody = buildSubscriberBody({ merchantId, subscriberId, amount, frequencyDays, customer, test });
    const r = await mobbexRequest(creds, "POST", `/subscriptions/${encodeURIComponent(subscriptionUid)}/subscriber`, subscriberBody);
    const d = r?.data || {};
    const subscriberUid = d.uid || d.subscriber?.uid;
    const checkoutUrl = d.sourceUrl || d.sourceurl || d.subscriberUrl || d.subscriberurl || null;
    if (!subscriberUid || !checkoutUrl) throw new MobbexError("Mobbex no devolvió el link para cargar la tarjeta", { details: r });

    return {
      checkoutUrl,
      providerSubscriptionId: `${subscriptionUid}:${subscriberUid}`,
      providerPlanId: subscriptionUid,
      raw: { subscription: { uid: subscriptionUid, url: s.data.url || null }, subscriber: { uid: subscriberUid, sourceUrl: checkoutUrl }, test },
    };
  },

  // ?p=mobbex&mid=<merchant>&t=<token HMAC> + cuerpo del aviso.
  async parseWebhook(req, { getMerchant } = {}) {
    const merchantId = String(req?.query?.mid || "");
    const token = String(req?.query?.t || "");
    if (!verifyProviderWebhookToken(ID, merchantId, token)) return { ok: false, status: 401, error: "token inválido", merchantId: null, events: [] };

    const body = parseMobbexBody(req?.body);
    const events = normalizeEvents(body);
    if (!events.length) return { ok: true, merchantId, events: [], ignored: String(body?.type || "sin tipo") };

    // Re-consulta del suscriptor en Mobbex con las credenciales del merchant: el
    // evento tiene que ser de un suscriptor que existe en SU cuenta, con NUESTRA reference.
    const psid = events[0].providerSubscriptionId;
    if (!psid) return { ok: false, status: 400, error: "evento sin subscription/subscriber uid", merchantId, events: [] };
    const merchant = typeof getMerchant === "function" ? await getMerchant(merchantId) : null;
    if (!merchant) return { ok: false, status: 404, error: "merchant no encontrado", merchantId, events: [] };
    const { sid, suid } = splitProviderSubscriptionId(psid);
    let check;
    try {
      check = await mobbexRequest(mobbexCreds(merchant), "GET", `/subscriptions/${encodeURIComponent(sid)}/subscriber/${encodeURIComponent(suid)}`);
    } catch (e) {
      if (e.httpStatus === 404) return { ok: false, status: 401, error: "el suscriptor no existe en la cuenta Mobbex del merchant", merchantId, events: [] };
      throw e; // Mobbex caído / timeout → 500 → Mobbex reintenta
    }
    const cd = check?.data || {};
    const gotUid = cd.subscriber?.uid || cd.uid || null;
    const gotRef = cd.subscriber?.reference || cd.reference || null;
    if ((gotUid && gotUid !== suid) || (gotRef && !String(gotRef).startsWith(`${merchantId}:`))) {
      return { ok: false, status: 401, error: "el suscriptor no coincide con el aviso", merchantId, events: [] };
    }
    // La reference confirmada por la API manda sobre la del cuerpo.
    const confirmedRef = gotRef || null;
    return { ok: true, merchantId, events: events.map((ev) => ({ ...ev, subscriberRef: confirmedRef || ev.subscriberRef })) };
  },

  async cancel(merchant, providerSubscriptionId) {
    const { sid, suid } = splitProviderSubscriptionId(providerSubscriptionId);
    return mobbexRequest(mobbexCreds(merchant), "DELETE", `/subscriptions/${encodeURIComponent(sid)}/subscriber/${encodeURIComponent(suid)}/action/delete`);
  },
  async pause(merchant, providerSubscriptionId) {
    const { sid, suid } = splitProviderSubscriptionId(providerSubscriptionId);
    return mobbexRequest(mobbexCreds(merchant), "POST", `/subscriptions/${encodeURIComponent(sid)}/subscriber/${encodeURIComponent(suid)}/action/suspend`);
  },
  async resume(merchant, providerSubscriptionId) {
    const { sid, suid } = splitProviderSubscriptionId(providerSubscriptionId);
    return mobbexRequest(mobbexCreds(merchant), "POST", `/subscriptions/${encodeURIComponent(sid)}/subscriber/${encodeURIComponent(suid)}/action/activate`);
  },

  // Mobbex no documenta un endpoint de "quién soy": usamos la lectura más liviana
  // (listar suscripciones, página 0). result:true = credenciales válidas.
  async testCredentials(creds) {
    const c = mobbexCreds(null, creds);
    if (!c.accessToken) return { ok: false, error: "Falta el Access Token de Mobbex" };
    if (!c.apiKey) return { ok: false, error: "Falta la API Key de Mobbex" };
    try {
      const r = await mobbexRequest(c, "GET", "/subscriptions?page=0");
      const docs = Array.isArray(r?.data?.docs) ? r.data.docs : Array.isArray(r?.data) ? r.data : [];
      return { ok: true, account: { subscriptions_seen: docs.length, platform_key: !creds?.api_key && !!process.env.MOBBEX_API_KEY } };
    } catch (e) {
      if (e.httpStatus === 401 || e.httpStatus === 403 || e.details?.result === false) return { ok: false, error: "Mobbex rechazó las credenciales. Revisá la API Key y el Access Token." };
      return { ok: false, error: `No pudimos validar con Mobbex: ${e.message}` };
    }
  },
};

export default adapter;
export { MobbexError };
