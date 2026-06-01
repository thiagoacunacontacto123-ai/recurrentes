// Wrapper para llamar a /api/* con el token de Firebase Auth.
// Cada endpoint del backend valida el token con el Admin SDK antes de actuar.
import { auth } from "./firebase.js";

async function authHeaders() {
  const u = auth.currentUser;
  if (!u) return {};
  const token = await u.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

export async function apiGet(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, { headers: { ...(await authHeaders()) } });
  return r.json();
}

export async function apiSend(path, method, body = null, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `/api/${path}${qs ? `?${qs}` : ""}`;
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export const apiPost = (p, b, q) => apiSend(p, "POST", b, q);
export const apiPatch = (p, b, q) => apiSend(p, "PATCH", b, q);
export const apiDelete = (p, q) => apiSend(p, "DELETE", null, q);
