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

async function authHeaders() {
  const u = auth.currentUser;
  if (!u) return {};
  const token = await u.getIdToken();
  const h = { Authorization: `Bearer ${token}` };
  const mid = getActiveMerchantId(u.uid);
  if (mid) h["X-Merchant-Id"] = mid;
  return h;
}

// Si el backend rechaza la tienda activa guardada (borrada, movida o nos
// sacaron del equipo) volvemos al doc propio y recargamos UNA vez (sessionStorage
// evita el loop). Sin esto, un header viejo deja el dashboard en 403 para siempre.
async function handleResponse(r, sentMid, uid) {
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
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

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  const h = await authHeaders();
  const r = await fetch(url, { headers: { ...h } });
  return handleResponse(r, h["X-Merchant-Id"], auth.currentUser?.uid);
}

export async function apiSend(path, method, body = null, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  const h = await authHeaders();
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...h },
    body: body ? JSON.stringify(body) : undefined,
  });
  return handleResponse(r, h["X-Merchant-Id"], auth.currentUser?.uid);
}

export const apiPost = (p, b, q) => apiSend(p, "POST", b, q);
export const apiPatch = (p, b, q) => apiSend(p, "PATCH", b, q);
export const apiDelete = (p, q) => apiSend(p, "DELETE", null, q);
