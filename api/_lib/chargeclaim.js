// Reclamo ATÓMICO de un cobro MP para que UN SOLO proceso cree la orden Shopify.
//
// El problema: webhook.js (que MP puede entregar 2+ veces), el polling de
// CheckoutSuccess (sync.js) y el self-heal pueden correr sobre el MISMO pago casi
// al mismo tiempo. El patrón "leer charges/{payment.id} → si no existe, crear
// orden" NO es atómico: los dos leen "no existe" antes de que cualquiera escriba
// → los dos crean la orden Shopify (DUPLICADA).
//
// La solución: una transacción de Firestore serializa el acceso al doc
// charges/{payment.id}. El primero que entra lo "reclama" (escribe claim_at); el
// resto ve el claim y se saltea. Recién cuando el ganador termina de crear la
// orden, escribe shopify_order_id → a partir de ahí el skip es permanente.
import { db } from "./firebase.js";

// Ventana del claim. Si un proceso reclamó pero murió antes de escribir la orden
// (timeout de función, crash), pasado este tiempo otro proceso puede reintentar
// para no dejar la venta trabada sin orden.
const CLAIM_TTL_MS = 120 * 1000;

/**
 * @returns {Promise<{proceed:boolean, existingOrderId?:string, chargeRef:any}>}
 *  - proceed=false + existingOrderId → el pago YA tiene su orden: no hacer nada.
 *  - proceed=false sin existingOrderId → otro proceso la está creando ahora: skip.
 *  - proceed=true → ganaste el claim: creá la orden y después chargeRef.set(...) con shopify_order_id.
 */
export async function claimCharge(merchantRef, paymentId, meta = {}) {
  const chargeRef = merchantRef.collection("charges").doc(String(paymentId));
  const now = Date.now();
  return await db().runTransaction(async (tx) => {
    const snap = await tx.get(chargeRef);
    if (snap.exists) {
      const d = snap.data();
      if (d.shopify_order_id) return { proceed: false, existingOrderId: d.shopify_order_id, chargeRef };
      const claimAt = d.claim_at ? Date.parse(d.claim_at) : 0;
      if (claimAt && (now - claimAt) < CLAIM_TTL_MS) return { proceed: false, chargeRef };
      // charge sin orden y claim vencido/inexistente → reintentar (recupera de fallo previo)
    }
    tx.set(chargeRef, { ...meta, mp_payment_id: String(paymentId), claim_at: new Date().toISOString() }, { merge: true });
    return { proceed: true, chargeRef };
  });
}
