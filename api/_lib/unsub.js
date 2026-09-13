// Bajas de mails de marketing (carrito abandonado). Por merchant + email.
// Doc: merchants/{uid}/unsubscribes/{sha256(email)}
import { db } from "./firebase.js";
import { sha256hex } from "./token.js";

const norm = (e) => String(e || "").trim().toLowerCase();

export async function isUnsubscribed(merchantId, email) {
  const e = norm(email);
  if (!merchantId || !e) return false;
  try {
    const snap = await db().collection("merchants").doc(merchantId).collection("unsubscribes").doc(sha256hex(e)).get();
    return snap.exists;
  } catch (_) { return false; }
}

export async function setUnsubscribed(merchantId, email, reason = "link") {
  const e = norm(email);
  if (!merchantId || !e) return false;
  await db().collection("merchants").doc(merchantId).collection("unsubscribes").doc(sha256hex(e)).set({
    email: e, reason, created_at: new Date().toISOString(),
  }, { merge: true });
  return true;
}
