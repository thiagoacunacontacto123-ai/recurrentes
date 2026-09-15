// Super-admins de Recurrentes (panel #/admin y "ver como").
// La lista vive SOLO en la env ADMIN_EMAILS (emails separados por coma, sin
// distinguir mayúsculas). No hay lista de respaldo en el código: si la env
// falta o está vacía, nadie es admin.
// Sin imports a propósito: lo usan _lib/firebase.js (requireMerchant) y _lib/admin.js.
// (Ojo: ADMIN_EMAIL, en singular, es otra cosa: a quién le llega el mail de plan-request.)

export function adminEmails() {
  return String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && adminEmails().includes(e);
}

// Token de Firebase YA verificado (verifyIdToken): el email tiene que estar en
// ADMIN_EMAILS y verificado (email_verified === true). Un login con el mismo
// email pero sin verificar NO es admin.
export function isAdminToken(decoded) {
  return !!decoded && decoded.email_verified === true && isAdminEmail(decoded.email);
}
