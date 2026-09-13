// Rate limit simple sobre Firestore (sin Redis). Ventana fija por clave.
// Fail-open: si Firestore falla, dejamos pasar (mejor una venta que un 500).
import { db } from "./firebase.js";
import { Timestamp } from "firebase-admin/firestore";
import { sha256hex } from "./token.js";

export function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "");
  return (xf.split(",")[0] || req.socket?.remoteAddress || "").trim() || "unknown";
}

// key: string identificadora (ej. `capture:${merchantId}:${ip}`)
// limit: máx. eventos por ventana; windowSec: tamaño de ventana.
export async function rateLimit(key, { limit = 30, windowSec = 3600 } = {}) {
  try {
    const bucket = Math.floor(Date.now() / 1000 / windowSec);
    const ref = db().collection("ratelimits").doc(sha256hex(`${key}:${bucket}`).slice(0, 40));
    let count = 0;
    await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      count = (snap.exists ? snap.data().n || 0 : 0) + 1;
      tx.set(ref, { n: count, key: key.slice(0, 120), bucket, expires_at: Timestamp.fromMillis((bucket + 2) * windowSec * 1000) }, { merge: true }); // TTL policy en Firestore sobre expires_at
    });
    return { ok: count <= limit, count, remaining: Math.max(0, limit - count) };
  } catch (e) {
    console.warn("[ratelimit] fail-open:", e.message);
    return { ok: true, count: 0, remaining: limit };
  }
}
