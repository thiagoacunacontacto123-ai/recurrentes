// Registro de pasarelas de pago (payment providers). Ver README.md de esta carpeta.
//
//   getProvider(id)          → adapter (siempre devuelve algo para ids conocidos;
//                              si el archivo no está o no carga, un placeholder apagado)
//   getEnabledProvider(id)   → adapter solo si su flag de entorno está prendido y
//                              adapter.isEnabled() da true; si no, null
//   checkoutProviderFor(m)   → adapter de la pasarela alternativa del merchant, o
//                              null = camino histórico de Mercado Pago (checkout/init)
//
// Mercado Pago está registrado como un descriptor FINITO que apunta al código de
// siempre (api/_lib/mp.js, checkout/init.js, mp/webhook.js, sync.js) sin cambiarlo:
// el checkout y los webhooks de MP NO pasan por acá.
//
// Flags de entorno: <ID>_ENABLED=1 (MOBBEX_ENABLED, STRIPE_ENABLED, WHOP_ENABLED).
// Con el flag apagado la pasarela no se usa en ningún lado (checkout, webhook, panel).
import { mpMe, mpUpdatePreapproval } from "../mp.js";

export const PROVIDER_IDS = ["mercadopago", "mobbex", "stripe", "whop"];

// Lo que TODO adapter tiene que exponer (el registro valida al cargar).
export const ADAPTER_KEYS = ["id", "label", "currency", "isEnabled", "createSubscriptionCheckout", "parseWebhook", "cancel", "pause", "resume", "testCredentials"];

export const EVENT_TYPES = ["charge_approved", "charge_failed", "subscription_cancelled", "subscription_paused", "subscription_resumed"];

export function envFlag(name) {
  const v = String(process.env[name] || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}
export const flagName = (id) => `${String(id || "").toUpperCase()}_ENABLED`;
// Flag de entorno de la pasarela (MP siempre prendido).
export function providerFlagOn(id) {
  return id === "mercadopago" ? true : envFlag(flagName(id));
}

// ── Mercado Pago: descriptor fino sobre el código existente ─────────────────
const mercadopago = {
  id: "mercadopago",
  label: "Mercado Pago",
  currency: "ARS",
  isEnabled: () => true,
  async createSubscriptionCheckout() {
    throw new Error("not used: MP path stays in checkout/init");
  },
  async parseWebhook() {
    throw new Error("not used: MP webhooks stay in api/mp/webhook.js");
  },
  async cancel(merchant, providerSubscriptionId) {
    return mpUpdatePreapproval(merchant?.mp_access_token, providerSubscriptionId, { status: "cancelled" });
  },
  async pause(merchant, providerSubscriptionId) {
    return mpUpdatePreapproval(merchant?.mp_access_token, providerSubscriptionId, { status: "paused" });
  },
  async resume(merchant, providerSubscriptionId) {
    return mpUpdatePreapproval(merchant?.mp_access_token, providerSubscriptionId, { status: "authorized" });
  },
  async testCredentials(creds) {
    try {
      const me = await mpMe(String(creds?.access_token || "").trim());
      return { ok: true, account: { id: me?.id ?? null, email: me?.email || null, country: me?.country_id || null } };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};

// ── Adapters en archivos propios (se cargan a demanda) ───────────────────────
// Los imports son literales para que el bundler de Vercel incluya los archivos
// cuando existan. Si ./stripe.js o ./whop.js todavía no están, queda el placeholder.
const LOADERS = {
  mobbex: () => import("./mobbex.js"),
  stripe: () => import("./stripe.js"),
  whop: () => import("./whop.js"),
};
const META = {
  mobbex: { label: "Mobbex", currency: "ARS" },
  stripe: { label: "Stripe", currency: "USD" },
  whop: { label: "Whop", currency: "USD" },
};

// Placeholder apagado: misma forma que un adapter, todo lanza "no disponible".
function placeholder(id, reason) {
  const off = async () => { throw new Error(`${META[id]?.label || id} no está disponible (${reason})`); };
  return {
    id,
    label: META[id]?.label || id,
    currency: META[id]?.currency || "ARS",
    isEnabled: () => false,
    createSubscriptionCheckout: off,
    parseWebhook: off,
    cancel: off,
    pause: off,
    resume: off,
    testCredentials: async () => ({ ok: false, error: `${META[id]?.label || id} no está disponible (${reason})` }),
    placeholder: true,
  };
}

export function missingAdapterKeys(adapter) {
  if (!adapter || typeof adapter !== "object") return ADAPTER_KEYS.slice();
  return ADAPTER_KEYS.filter((k) => {
    if (k === "id" || k === "label" || k === "currency") return !adapter[k];
    return typeof adapter[k] !== "function";
  });
}

const cache = new Map();

export async function getProvider(id) {
  const key = String(id || "").trim().toLowerCase();
  if (key === "mercadopago") return mercadopago;
  if (!LOADERS[key]) return null;
  if (cache.has(key)) return cache.get(key);
  let adapter;
  try {
    const mod = await LOADERS[key]();
    const cand = mod?.default || mod?.adapter || null;
    const missing = missingAdapterKeys(cand);
    if (missing.length) {
      console.error(`[providers] adapter ${key} incompleto, falta: ${missing.join(", ")}`);
      adapter = placeholder(key, "adapter incompleto");
    } else if (cand.id !== key) {
      console.error(`[providers] adapter ${key} declara id=${cand.id}`);
      adapter = placeholder(key, "id inválido");
    } else {
      adapter = cand;
    }
  } catch (e) {
    const notInstalled = e?.code === "ERR_MODULE_NOT_FOUND" && String(e.message || "").includes(`${key}.js`);
    if (!notInstalled) console.error(`[providers] no pude cargar ${key}:`, e.message);
    adapter = placeholder(key, notInstalled ? "adapter no instalado" : "error al cargar");
  }
  cache.set(key, adapter);
  return adapter;
}

// Adapter listo para usar: flag de entorno prendido + adapter.isEnabled().
export async function getEnabledProvider(id) {
  const key = String(id || "").trim().toLowerCase();
  if (!providerFlagOn(key)) return null;
  const adapter = await getProvider(key);
  if (!adapter) return null;
  try { return adapter.isEnabled() ? adapter : null; } catch (_) { return null; }
}

export async function listProviders() {
  const out = [];
  for (const id of PROVIDER_IDS) {
    const a = await getProvider(id);
    let enabled = false;
    try { enabled = providerFlagOn(id) && !!a?.isEnabled(); } catch (_) {}
    out.push({ id, label: a?.label || id, currency: a?.currency || "ARS", enabled, installed: !!a && !a.placeholder });
  }
  return out;
}

/**
 * Pasarela ALTERNATIVA con la que cobra este merchant, o null = Mercado Pago de
 * siempre. Solo devuelve algo si el merchant tiene `payment_provider` distinto de
 * mercadopago Y esa pasarela está prendida por env. Merchants sin el campo
 * (Lumina) → null sin cargar ningún adapter.
 */
export async function checkoutProviderFor(merchant) {
  const raw = String(merchant?.payment_provider || "").trim().toLowerCase();
  if (!raw || raw === "mercadopago") return null;
  return getEnabledProvider(raw);
}

// Solo para tests: limpia el cache de adapters cargados.
export function __resetProvidersCache() { cache.clear(); }
