export const isProd = () => process.env.VERCEL_ENV === "production";

// URL pública de la app (sin barra final). En prod es obligatoria.
export function appBaseUrl() {
  const u = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  if (!u && isProd()) console.error("[config] APP_BASE_URL no seteada en producción");
  return u;
}

// Secreto para firmar tokens (portal, unsub, state de OAuth). Sin fallback
// hardcodeado: en prod, si falta, fallamos cerrado.
export function signingSecret() {
  const s = process.env.PORTAL_SECRET || process.env.MP_WEBHOOK_SECRET || "";
  if (!s) {
    if (isProd()) throw new Error("PORTAL_SECRET/MP_WEBHOOK_SECRET no configurado");
    return "dev-only-insecure-secret";
  }
  return s;
}
