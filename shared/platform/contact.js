// Nombre, WhatsApp y email: cómo se limpian. Fuente ÚNICA para api/ y src/.
//
// Estaba copiado en tres lados (api/merchant.js, src/lib/signup.js y, al sumar el
// formulario de demo, iba por el cuarto). Si un lado normaliza distinto que el
// otro, el mismo teléfono entra como dos contactos diferentes y los avisos por
// WhatsApp salen al número equivocado. 25-sept-2026.

// Argentina sin país: 10 dígitos (área + número) → +549…; con el 0 adelante
// (011 6411 7974) también. Con país, se respeta lo que vino.
export function normalizeWhatsapp(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "549" + d;                                   // AR sin país: 11 6411 7974
  else if (d.length === 11 && d.startsWith("0")) d = "549" + d.slice(1); // 011 6411 7974
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}

// Sin < > para que nadie meta un "Nombre <mail@dominio>" donde va solo el mail.
export const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
