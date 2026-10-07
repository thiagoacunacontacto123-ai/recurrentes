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
    const packVids = Array.isArray(sub?.pack_items) ? [...new Set(sub.pack_items.map(x => String(x?.shopify_variant_id || "")).filter(Boolean))] : [];
    if (merchant.shopify_shop && merchant.shopify_token && (snap.shopify_variant_id || packVids.length)) {
      // "Armá tu pack" (7-oct-2026): se mira cada producto del pack y manda el que menos tiene.
      const vids = packVids.length ? packVids : [String(snap.shopify_variant_id)];
      let min = null;
      for (const vid of vids) {
        const r = await fetch(`https://${merchant.shopify_shop}/admin/api/2024-10/variants/${encodeURIComponent(vid)}.json?fields=id,inventory_quantity,inventory_management`, {
          headers: { "X-Shopify-Access-Token": merchant.shopify_token },
        });
        if (!r.ok) return null;
        const v = (await r.json())?.variant || {};
        // Sin seguimiento de inventario en Shopify = stock infinito (ese no cuenta).
        if (!v.inventory_management) continue;
        const n = Number(v.inventory_quantity);
        if (Number.isFinite(n)) min = min == null ? n : Math.min(min, n);
      }
      return min;
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

// ─── Antes del cobro ────────────────────────────────────────────────────────
// 28-sept-2026 (Thiago): "el 15 me quedé sin stock; el 17 toca la renovación de
// esa señora — que no se procese y se le avise".
//
// A Mercado Pago no se le puede decir "esta vez no cobres": la única palanca es
// dejar el preapproval en `paused` ANTES de la fecha. Por eso esto no puede
// correr 10 minutos antes: MP cobra en algún momento del día y si llegamos
// tarde, cobró. Miramos con varias horas de anticipación (`STOCK_WATCH_HOURS`)
// y, por las dudas, `applyStockPolicy` sigue como red después del cobro.
//
// Y al revés: cuando el comercio repone, la suscripción vuelve sola. Si no,
// "se pausa por stock" sería una cancelación disfrazada.
const HOURS = () => {
  const n = Number(process.env.STOCK_WATCH_HOURS);
  return Number.isFinite(n) && n > 0 && n <= 72 ? n : 12;
};
const PAUSA_STOCK = "sin_stock";

// El aviso al cliente es OBLIGATORIO: se le está corriendo la fecha de un cobro
// que esperaba. Sale el mail transaccional (editable en Flujos de email, no se
// puede apagar), el WhatsApp si la tienda lo tiene prendido, y además se emite
// el evento por si el comercio armó un flujo propio con más pasos.
async function avisarSinStock(merchant, merchantId, subscriberId, sub, now, tag) {
  try {
    const { emailOutOfStock } = await import("./email.js");
    const { portalUrlFor } = await import("./sync.js");
    const portalUrl = portalUrlFor({ ...sub, id: subscriberId });
    if (sub?.customer_email) {
      await emailOutOfStock({
        to: sub.customer_email, customerName: sub.customer_name,
        productTitle: sub.plan_snapshot?.product_title, portalUrl, merchant,
      });
    }
  } catch (e) { console.warn(`[${tag}] mail de sin stock:`, e.message); }
  try {
    const { emitFlowEvent } = await import("./flows.js");
    await emitFlowEvent(merchantId, merchant, "out_of_stock", subscriberId, { ...sub, status: "paused" }, { key: now });
  } catch (e) { console.warn(`[${tag}] aviso de sin stock:`, e.message); }
}

async function pausar(db, merchant, merchantId, subscriberId, sub, tag) {
  await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: "paused" });
  const now = new Date().toISOString();
  await db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId).set({
    status: "paused", paused_reason: PAUSA_STOCK, paused_at: now, updated_at: now,
  }, { merge: true });
  await avisarSinStock(merchant, merchantId, subscriberId, sub, now, tag);
  console.warn(`[${tag}] sin stock antes del cobro: ${subscriberId} pausada`);
}

async function reactivar(db, merchant, merchantId, subscriberId, sub, tag) {
  await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: "authorized" });
  const now = new Date().toISOString();
  await db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId).set({
    status: "active", paused_reason: null, resumed_at: now, updated_at: now,
  }, { merge: true });
  try {
    const { emitFlowEvent } = await import("./flows.js");
    await emitFlowEvent(merchantId, merchant, "resumed", subscriberId, { ...sub, status: "active" }, { key: now });
  } catch (e) { console.warn(`[${tag}] aviso de reactivación:`, e.message); }
  console.warn(`[${tag}] volvió el stock: ${subscriberId} reactivada`);
}

/**
 * Revisa las suscripciones de UN comercio: pausa las que están por cobrarse sin
 * stock y reactiva las que se pausaron por eso y ya tienen. Nunca lanza.
 * `subs` = [{ id, ...datos }] ya leídas por quien llama.
 */
export async function stockWatchForMerchant({ db, merchant, merchantId, subs, nowMs = Date.now(), tag = "stock-watch" }) {
  const out = { revisadas: 0, pausadas: 0, reactivadas: 0 };
  if (!stockCheckNeeded(merchant) || !merchant?.mp_access_token) return out;
  const limite = nowMs + HOURS() * 3600e3;
  for (const sub of subs || []) {
    if (!sub?.mp_preapproval_id) continue;
    const pedidas = Number(sub.quantity || sub.plan_snapshot?.units_per_shipment || 1) || 1;
    try {
      if (sub.status === "paused" && sub.paused_reason === PAUSA_STOCK) {
        out.revisadas++;
        const hay = await disponible(merchant, sub);
        if (hay !== null && hay < pedidas) continue;      // sigue sin stock
        await reactivar(db, merchant, merchantId, sub.id, sub, tag);
        out.reactivadas++;
        continue;
      }
      if (sub.status !== "active") continue;
      const t = Date.parse(sub.next_charge_at || "");
      if (!Number.isFinite(t) || t > limite) continue;    // todavía falta
      out.revisadas++;
      const hay = await disponible(merchant, sub);
      if (hay === null || hay >= pedidas) continue;
      await pausar(db, merchant, merchantId, sub.id, sub, tag);
      out.pausadas++;
    } catch (e) {
      console.warn(`[${tag}] sub ${sub.id}:`, e.message);
    }
  }
  return out;
}
