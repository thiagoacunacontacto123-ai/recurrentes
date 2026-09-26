// Datos del registro (paso 1: nombre, WhatsApp, email de contacto) guardados en el
// navegador hasta que exista la sesión. Con Google la sesión es inmediata; con
// contraseña recién después de verificar el mail (el backend responde 403 antes),
// por eso va en localStorage y no en sessionStorage. Dashboard los manda con
// POST /api/merchant?action=save-owner y los borra.
const KEY = "rec_signup_pending";
const MAX_AGE_MS = 14 * 86400000;

export function savePendingSignup(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, at: Date.now() })); } catch (_) {}
}
export function readPendingSignup() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!d || !d.owner_name || !d.owner_whatsapp) return null;
    if (Date.now() - (Number(d.at) || 0) > MAX_AGE_MS) { clearPendingSignup(); return null; }
    return d;
  } catch (_) { return null; }
}
export function clearPendingSignup() {
  try { localStorage.removeItem(KEY); } catch (_) {}
}

// Fuente única compartida con el backend (shared/platform/contact.js). Se
// re-exportan para no tocar los imports que ya existen.
export { normalizeWhatsapp, EMAIL_RE } from "../../shared/platform/contact.js";
