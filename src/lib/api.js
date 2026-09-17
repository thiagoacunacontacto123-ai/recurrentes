// Wrapper para llamar a /api/* con el token de Firebase Auth.
// Cada endpoint del backend valida el token con el Admin SDK antes de actuar.
//
// Multi-tienda: además del Bearer, mandamos `X-Merchant-Id` con la tienda
// activa del perfil (guardada en localStorage por uid). Sin header, el backend
// opera sobre merchants/{uid} (comportamiento histórico).
import { auth } from "./firebase.js";

const LS_KEY = (uid) => "rec_merchant_" + uid;

// Tienda activa guardada para este login (null si nunca eligió → el backend usa el uid).
export function getActiveMerchantId(uid) {
  if (!uid) return null;
  try { return localStorage.getItem(LS_KEY(uid)) || null; } catch (_) { return null; }
}

// Guarda la tienda activa del login. `mid` vacío/null → vuelve al default (uid).
export function setActiveMerchantId(uid, mid) {
  if (!uid) return;
  try {
    if (mid) localStorage.setItem(LS_KEY(uid), String(mid));
    else localStorage.removeItem(LS_KEY(uid));
  } catch (_) {}
}

// "Ver como" del super-admin (#/admin → ficha → "Ver como este comercio").
// sessionStorage: dura solo en esta pestaña. El backend acepta X-Admin-As SOLO
// si el login está en ADMIN_EMAILS con email verificado, y solo para lecturas.
const ADMIN_AS_KEY = "rec_admin_as";
export function getAdminAs() {
  try { const v = JSON.parse(sessionStorage.getItem(ADMIN_AS_KEY) || "null"); return v && v.id ? v : null; } catch (_) { return null; }
}
export function setAdminAs(v) {
  try {
    if (v && v.id) sessionStorage.setItem(ADMIN_AS_KEY, JSON.stringify({ id: String(v.id), name: String(v.name || "") }));
    else sessionStorage.removeItem(ADMIN_AS_KEY);
  } catch (_) {}
}

async function authHeaders() {
  const u = auth.currentUser;
  if (!u) return {};
  const token = await u.getIdToken();
  const h = { Authorization: `Bearer ${token}` };
  const mid = getActiveMerchantId(u.uid);
  const as = getAdminAs();
  if (as) h["X-Admin-As"] = as.id;
  else if (mid) h["X-Merchant-Id"] = mid;
  return h;
}

// Si el backend rechaza la tienda activa guardada (borrada, movida o nos
// sacaron del equipo) volvemos al doc propio y recargamos UNA vez (sessionStorage
// evita el loop). Sin esto, un header viejo deja el dashboard en 403 para siempre.
async function handleResponse(r, sentMid, uid) {
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  // "Ver como" rechazado (ya no es admin o el comercio no existe): salimos del modo.
  if ((r.status === 403 || r.status === 404) && d?.code === "admin_forbidden" && getAdminAs()) {
    setAdminAs(null);
    try { window.location.reload(); } catch (_) {}
    return d;
  }
  if (r.status === 403 && d?.code === "merchant_forbidden" && sentMid && uid) {
    setActiveMerchantId(uid, null);
    try {
      if (!sessionStorage.getItem("rec_mid_reset")) {
        sessionStorage.setItem("rec_mid_reset", "1");
        window.location.reload();
      }
    } catch (_) {}
  } else if (r.ok) {
    try { sessionStorage.removeItem("rec_mid_reset"); } catch (_) {}
  }
  return d;
}

// Sin internet (o con el servidor caído) `fetch` LANZA y el error sube a la
// página: casi ninguna llama dentro de try/catch, así que la pantalla se quedaba
// cargando para siempre, sin decir nada. Devolvemos el mismo shape que el resto
// ({ error }) para que el panel muestre el aviso de siempre.
const OFFLINE = "No pudimos conectarnos. Revisá tu conexión e intentá de nuevo.";

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  try {
    const h = await authHeaders();
    const r = await fetch(url, { headers: { ...h } });
    return await handleResponse(r, h["X-Merchant-Id"], auth.currentUser?.uid);
  } catch (e) {
    console.warn("[api] GET", path, e?.message || e);
    return { error: OFFLINE, code: "network_error" };
  }
}

export async function apiSend(path, method, body = null, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  try {
    const h = await authHeaders();
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json", ...h },
      body: body ? JSON.stringify(body) : undefined,
    });
    return await handleResponse(r, h["X-Merchant-Id"], auth.currentUser?.uid);
  } catch (e) {
    console.warn("[api]", method, path, e?.message || e);
    return { error: OFFLINE, code: "network_error" };
  }
}

export const apiPost = (p, b, q) => apiSend(p, "POST", b, q);
export const apiPatch = (p, b, q) => apiSend(p, "PATCH", b, q);
export const apiDelete = (p, q) => apiSend(p, "DELETE", null, q);
