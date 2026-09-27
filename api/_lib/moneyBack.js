// Plata que volvió sobre un cobro que YA generó la orden en la tienda:
// contracargo, reclamo perdido, fraude o devolución.
//
// El problema: la orden queda PAGA en Shopify / Tiendanube y nadie la toca.
// Nosotros no podemos cancelarla (el permiso de órdenes que pide la app alcanza
// para crearlas, no para cancelar las ajenas) y Mercado Pago no le avisa a la
// tienda. Si el comercio no se entera, despacha un pedido que no cobró — y esa
// plata ya no vuelve (27-sept-2026, Thiago: "lo intenté en Growith y no pude").
//
// Así que lo anotamos acá y el panel se lo pone adelante hasta que él lo marque
// resuelto. Es un aviso, no una acción: lo único que podemos hacer es que se
// entere a tiempo.
import { db } from "./firebase.js";

const col = (mid) => db().collection("merchants").doc(mid).collection("money_back");

// Motivos, del más grave al más común. El texto es el que ve el comerciante.
export const MONEY_BACK_KINDS = {
  chargeback: { label: "Contracargo", detail: "El cliente desconoció el pago en su tarjeta y Mercado Pago le devolvió la plata." },
  fraud:      { label: "Fraude",      detail: "Mercado Pago marcó el pago como fraudulento y lo devolvió." },
  claim:      { label: "Reclamo",     detail: "El cliente abrió un reclamo en Mercado Pago por este cobro." },
  refunded:   { label: "Devolución",  detail: "El pago se devolvió: puede haberlo hecho Mercado Pago o vos desde su panel." },
};
export const esMoneyBack = (k) => Object.prototype.hasOwnProperty.call(MONEY_BACK_KINDS, k);

// ¿El estado de un pago de MP significa que la plata volvió?
export function kindFromPaymentStatus(status) {
  const s = String(status || "").toLowerCase();
  if (s === "charged_back") return "chargeback";
  if (s === "refunded") return "refunded";
  return null;
}

// Anota el aviso. Idempotente por pago: el webhook de MP repite el mismo evento
// varias veces y el comerciante no puede ver el mismo pedido tres veces.
// NUNCA lanza: esto cuelga del camino del cobro y no puede romperlo.
export async function flagMoneyBack(merchantId, { paymentId, kind, subscriberId = null, amount = 0, sub = null } = {}) {
  try {
    if (!merchantId || !paymentId || !esMoneyBack(kind)) return null;
    const ref = col(merchantId).doc(String(paymentId));
    const previo = await ref.get();
    // Ya anotado: solo puede EMPEORAR el motivo (un reclamo que termina en
    // contracargo), nunca volver atrás ni reabrirse si él ya lo resolvió.
    if (previo.exists) {
      const d = previo.data() || {};
      if (d.kind !== kind && (kind === "chargeback" || kind === "fraud")) {
        await ref.set({ kind, updated_at: new Date().toISOString() }, { merge: true });
      }
      return ref.id;
    }

    // La orden a cancelar sale del cobro que generó ese pago.
    let shopifyOrderId = null, chargeAmount = 0;
    try {
      const q = await db().collection("merchants").doc(merchantId).collection("charges")
        .where("mp_payment_id", "==", String(paymentId)).limit(1).get();
      if (!q.empty) {
        const c = q.docs[0].data() || {};
        shopifyOrderId = c.shopify_order_id || null;
        chargeAmount = Number(c.amount_ars) || 0;
      }
    } catch (_) {}

    await ref.set({
      payment_id: String(paymentId),
      kind,
      subscriber_id: subscriberId || null,
      customer_name: sub?.customer_name || null,
      customer_email: sub?.customer_email || null,
      product_title: sub?.plan_snapshot?.product_title || null,
      amount_ars: Number(amount) || chargeAmount,
      shopify_order_id: shopifyOrderId,
      status: "open",
      created_at: new Date().toISOString(),
    });
    console.log(`[money-back] ${kind} pago ${paymentId} → orden ${shopifyOrderId || "(sin orden)"} de ${merchantId}`);
    return ref.id;
  } catch (e) {
    console.warn("[money-back] no pude anotar el aviso:", e?.message || e);
    return null;
  }
}

// Los que el comerciante todavía no resolvió. Tope chico: es un cartel, no una
// tabla; si tiene 50 contracargos el problema es otro.
export async function listMoneyBack(merchantId, { limit = 20 } = {}) {
  try {
    const q = await col(merchantId).where("status", "==", "open").limit(limit).get();
    const items = q.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Más nuevos primero. Se ordena acá para no pedir otro índice por tienda.
    items.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    return items;
  } catch (e) {
    console.warn("[money-back] no pude listar:", e?.message || e);
    return [];
  }
}

// "Ya lo resolví": saca el cartel. No borramos el registro — sirve de historial
// y evita que el mismo evento de MP lo vuelva a levantar.
export async function resolveMoneyBack(merchantId, paymentId) {
  const ref = col(merchantId).doc(String(paymentId || ""));
  const snap = await ref.get();
  if (!snap.exists) return { error: "Ese aviso ya no existe" };
  await ref.set({ status: "done", done_at: new Date().toISOString() }, { merge: true });
  return { ok: true };
}
