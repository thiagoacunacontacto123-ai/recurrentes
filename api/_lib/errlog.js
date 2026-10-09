// Registro central de errores (9-oct-2026, Thiago: "monitorear todo desde el Admin y
// que me lleguen WhatsApps si algo se rompe"). Hasta hoy cada catch hacía console.error
// y nadie lo leía: Firestore estuvo caído horas y nos enteramos porque Thiago abrió
// el panel.
//
//   logError(where, e, { kind, merchantId, detail })
//     kind: "checkout" (el comprador no pudo suscribirse) · "order" (cobró y la orden
//           no se creó) · "webhook" · "cron" · "email" · "whatsapp" · "mp" · "store"
//           (Shopify/Tiendanube) · "public" (plan/widget) · "other".
//     Escribe system_errors/{id} { at, kind, where, merchant_id, code, message }.
//     El mensaje pasa por scrub (nada de tokens) y se corta a 300.
//     NUNCA lanza y NO lee nada: cuelga de todos los caminos, incluido el del cobro.
//
//   recentErrors({ sinceMs, limit }) → últimos errores (para el vigilante y el Admin).
//   countByKind(docs) → { kind: n }.
//   pruneErrors(now)  → borra los de más de 30 días (lo corre el resumen diario).
//
// Consulta: un solo where("at", ">=") + orderBy("at") (índice simple, sin composite).
import { db } from "./firebase.js";

export const ERROR_KINDS = ["checkout", "order", "webhook", "cron", "email", "whatsapp", "mp", "store", "public", "other"];
export const ERRORS_COL = "system_errors";
export const KEEP_DAYS = 30;

const iso = (ms) => new Date(ms).toISOString();
const SECRET_RE = /(APP_USR-[A-Za-z0-9-]+|TEST-[A-Za-z0-9-]+|shpat_[A-Za-z0-9]+|shpca_[A-Za-z0-9]+|re_[A-Za-z0-9_]+|sk_(live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|EAA[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]+)/g;
export const scrubMessage = (s) => String(s ?? "").replace(SECRET_RE, "[secreto]").replace(/\s+/g, " ").trim().slice(0, 300);

export function errorCode(e) {
  if (!e) return null;
  const c = e.code ?? e.status ?? e.statusCode ?? null;
  return c == null ? null : String(c).slice(0, 40);
}

// Devuelve la entrada escrita (o null). Nunca lanza.
export async function logError(where, e, { kind = "other", merchantId = null, detail = null, now = Date.now() } = {}) {
  try {
    const k = ERROR_KINDS.includes(kind) ? kind : "other";
    const entry = {
      at: iso(now),
      kind: k,
      where: String(where || "?").slice(0, 80),
      merchant_id: merchantId ? String(merchantId).slice(0, 80) : null,
      code: errorCode(e),
      message: scrubMessage(e?.message || e || "error"),
      ...(detail ? { detail: scrubMessage(detail) } : {}),
    };
    await db().collection(ERRORS_COL).add(entry);
    return entry;
  } catch (err) {
    console.warn("[errlog] no pude registrar:", scrubMessage(err?.message));
    return null;
  }
}

// Últimos errores desde `sinceMs` (default 24 h), más nuevos primero.
export async function recentErrors({ now = Date.now(), sinceMs = 24 * 3600e3, limit = 200 } = {}) {
  const snap = await db().collection(ERRORS_COL).where("at", ">=", iso(now - sinceMs)).orderBy("at", "desc").limit(limit).get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function countByKind(docs = []) {
  const out = {};
  for (const d of docs) out[d.kind || "other"] = (out[d.kind || "other"] || 0) + 1;
  return out;
}

// Borra los de más de KEEP_DAYS (hasta 300 por corrida). Nunca lanza.
export async function pruneErrors(now = Date.now()) {
  try {
    const snap = await db().collection(ERRORS_COL).where("at", "<", iso(now - KEEP_DAYS * 86400e3)).limit(300).get();
    if (snap.empty) return 0;
    const batch = db().batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    return snap.size;
  } catch (e) { console.warn("[errlog] prune:", scrubMessage(e?.message)); return 0; }
}

// Envoltorio para handlers serverless: un throw sin atrapar dejaba a Vercel
// respondiendo un 500 pelado y a nosotros sin enterarnos. Ahora se registra y se
// responde JSON. `kind` dice de qué camino es.
export function withErrorLog(handler, { where, kind = "other", message = "Algo falló de nuestro lado. Probá de nuevo en unos segundos." } = {}) {
  return async function wrapped(req, res) {
    try {
      return await handler(req, res);
    } catch (e) {
      const mid = req?.body?.merchant_id || req?.query?.merchant || req?.query?.merchant_id || null;
      await logError(where, e, { kind, merchantId: mid, detail: `${req?.method || ""} ${String(req?.query?.action || "")}`.trim() });
      try { const { reportQuotaExhausted } = await import("./quotaGuard.js"); await reportQuotaExhausted(where, e); } catch (_) {}
      if (res && !res.headersSent && typeof res.status === "function") return res.status(500).json({ error: message });
      throw e;
    }
  };
}
