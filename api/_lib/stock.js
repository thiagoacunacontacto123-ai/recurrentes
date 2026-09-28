// Qué hacer cuando en la renovación no hay stock (28-sept-2026, pedido de G4U).
//
// La regla la elige el comercio en Ventas → Logística. Por defecto no cambia
// nada de lo de siempre: la orden se crea y listo.
//
// Dos cosas que este módulo NO hace nunca, a propósito:
//   · No decide si la orden se crea. El dinero ya entró: una orden que no
//     existe es plata cobrada sin pedido. Corre DESPUÉS de crearla.
//   · No lanza. Si la tienda no contesta o el dato no está, se sigue como
//     siempre — preferimos no pausar de más que cortarle la venta a alguien
//     por una consulta que falló.
import { resolveStockPolicy, stockCheckNeeded } from "../../shared/platform/logistics.js";
import { mpUpdatePreapproval } from "./mp.js";

/**
 * Unidades disponibles del producto de la suscripción, o null si no se puede
 * saber (sin seguimiento de inventario, sin permiso, API caída). null = seguir.
 */
async function disponible(merchant, sub) {
  const snap = sub?.plan_snapshot || {};
  try {
    if (merchant.shopify_shop && merchant.shopify_token && snap.shopify_variant_id) {
      const r = await fetch(`https://${merchant.shopify_shop}/admin/api/2024-10/variants/${encodeURIComponent(snap.shopify_variant_id)}.json?fields=id,inventory_quantity,inventory_management`, {
        headers: { "X-Shopify-Access-Token": merchant.shopify_token },
      });
      if (!r.ok) return null;
      const v = (await r.json())?.variant || {};
      // Sin seguimiento de inventario en Shopify = stock infinito.
      if (!v.inventory_management) return null;
      const n = Number(v.inventory_quantity);
      return Number.isFinite(n) ? n : null;
    }
    if (merchant.tiendanube_store_id && merchant.tiendanube_token) {
      const variantId = snap.tiendanube_variant_id || snap.shopify_variant_id;
      const productId = snap.tiendanube_product_id || snap.shopify_product_id;
      if (!variantId || !productId) return null;
      const r = await fetch(`https://api.tiendanube.com/v1/${merchant.tiendanube_store_id}/products/${productId}/variants/${variantId}`, {
        headers: { Authentication: `bearer ${merchant.tiendanube_token}`, "User-Agent": "Recurrentes (hola@recurrentesapp.com)" },
      });
      if (!r.ok) return null;
      const v = await r.json();
      // stock null en Tiendanube = "sin límite".
      if (v?.stock === null || v?.stock === undefined) return null;
      const n = Number(v.stock);
      return Number.isFinite(n) ? n : null;
    }
  } catch (e) {
    console.warn("[stock] no pude leer el inventario:", e.message);
  }
  return null;
}

/**
 * Corre después de crear la orden del cobro. Si el comercio pidió pausar y el
 * producto quedó sin unidades, pausa la suscripción para que NO se cobre la
 * próxima y devuelve qué pasó. Nunca lanza.
 *
 * Devuelve null si no había nada que hacer.
 */
export async function applyStockPolicy({ db, merchant, merchantId, subscriberId, sub, tag = "sync" }) {
  try {
    if (!merchantId || !stockCheckNeeded(merchant)) return null;
    const pedidas = Number(sub?.quantity || sub?.plan_snapshot?.units_per_shipment || 1) || 1;
    const hay = await disponible(merchant, sub);
    if (hay === null || hay >= pedidas) return null;

    // Pausada en Mercado Pago = no se intenta el próximo cobro. Si MP no
    // responde, no tocamos nada: mejor un cobro de más que un estado mentido.
    if (!merchant.mp_access_token || !sub?.mp_preapproval_id) return null;
    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: "paused" });
    } catch (e) {
      console.error(`[${tag}] sin stock: no pude pausar en MP sub=${subscriberId}:`, e.message);
      return { missing: true, paused: false, available: hay, needed: pedidas };
    }
    const now = new Date().toISOString();
    await db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId).set({
      status: "paused",
      paused_reason: "sin_stock",
      paused_at: now,
      updated_at: now,
    }, { merge: true });
    console.warn(`[${tag}] sin stock (${hay}/${pedidas}): suscripción ${subscriberId} pausada`);
    // Mismo aviso que cualquier pausa: si el comercio tiene el flujo de
    // "Suscripción pausada", al cliente le llega. No inventamos un mail nuevo.
    try {
      const { emitFlowEvent } = await import("./flows.js");
      await emitFlowEvent(merchantId, merchant, "paused", subscriberId, { ...sub, status: "paused" }, { key: now });
    } catch (e) { console.warn(`[${tag}] aviso de pausa por stock:`, e.message); }
    return { missing: true, paused: true, available: hay, needed: pedidas };
  } catch (e) {
    console.warn(`[${tag}] política de stock:`, e.message);
    return null;
  }
}

export { resolveStockPolicy, stockCheckNeeded };
