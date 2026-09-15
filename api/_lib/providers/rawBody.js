// Body CRUDO del request, para verificar firmas de webhooks (Stripe y Whop
// firman los bytes exactos que mandan; un JSON re-serializado no sirve).
//
// Los helpers de Vercel (@vercel/node) leen el body antes del handler pero lo
// "restauran": volver a escuchar data/end re-emite los bytes originales (mismo
// criterio que api/shopify/webhooks.js). Si ya vino como Buffer/string lo usamos
// directo. Timeout para no colgar nunca la función.
export function readRawBody(req, { timeoutMs = 5000 } = {}) {
  if (req?.rawBody != null) return Promise.resolve(Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(String(req.rawBody)));
  if (Buffer.isBuffer(req?.body)) return Promise.resolve(req.body);
  if (typeof req?.body === "string") return Promise.resolve(Buffer.from(req.body));
  if (typeof req?.on !== "function") return Promise.reject(new Error("body crudo no disponible"));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error("timeout leyendo body")), timeoutMs);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

export const envOn = (name) => ["1", "true", "yes", "on"].includes(String(process.env[name] || "").trim().toLowerCase());

// Epoch (segundos) o ISO → ISO. null si no hay fecha.
export function toIso(v) {
  if (v == null || v === "") return null;
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
