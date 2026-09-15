// Log estructurado: una línea JSON por evento { level, event, ts, ...campos }.
// Sirve para filtrar en Vercel Logs por `event` / `merchantId` / ids.
//
// NUNCA loguea PII ni secretos: se descartan las claves que parecen datos
// personales o credenciales (email, name, phone, address, token, secret, key…)
// y en los valores de texto se tapan los mails. Pasale solo ids y estados.
//
//   log("fulfill.retry.ok", { merchantId, subscriberId, paymentId, orderId });
//   logWarn("fulfill.retry.skip", { merchantId, paymentId, reason: "claim" });
const DROP_KEY = /(token|secret|password|passwd|authorization|api_?key|private|cookie|email|phone|name|address|dni|cuit|tax|card)/i;
const EMAIL_RE = /[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g;
const MAX_STR = 300;

function clean(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === "string") return v.replace(EMAIL_RE, "[email]").slice(0, MAX_STR);
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Error) return clean(v.message, depth);
  if (depth > 2) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map(x => clean(x, depth + 1));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP_KEY.test(k)) continue;
      out[k] = clean(x, depth + 1);
    }
    return out;
  }
  return String(v).slice(0, MAX_STR);
}

export function log(event, fields = {}, level = "info") {
  try {
    const line = JSON.stringify({ level, event: String(event), ts: new Date().toISOString(), ...clean(fields || {}) });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch (_) { /* un log nunca rompe el flujo */ }
}
export const logWarn = (event, fields) => log(event, fields, "warn");
export const logError = (event, fields) => log(event, fields, "error");
export const __cleanForTest = clean;
