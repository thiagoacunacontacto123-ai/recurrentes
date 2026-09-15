// Registro de canales de venta: qué puede hacer cada canal y qué falta para
// integrarlo. Es una DESCRIPCIÓN, no cambia ningún comportamiento:
// fulfillCharge (_lib/sync.js) sigue decidiendo por profile.channel como siempre.
//
// La fuente de lo que el panel muestra (label, status, tipos, catalog/orders/widget)
// sigue siendo shared/platform/profile.js → CHANNELS. Acá sumamos lo técnico que
// el backend necesita para cablear cada canal: autenticación, cómo se cumple un
// cobro, cómo se concede y revoca el acceso, qué webhooks entran y qué falta.
// tests/delivery/delivery.test.mjs verifica que ambos registros no se desalineen.
//
// ─── Contrato de un adapter (a implementar cuando se cablee) ───────────────
//   fulfill(merchant, subscriberId, sub, params, tag)
//        → { shopifyOrderId, orderStatusUrl, shopifyError }   (mismo contrato que fulfillCharge;
//          el nombre "shopifyOrderId" queda hasta renombrar a genérico, ver CLAUDE.md)
//   onCancel(merchant, subscriberId, sub, reason)   → revocar acceso / cerrar en la tienda (best-effort)
//   listCatalog(merchant)                           → [{ id, title, image, variants:[{ id, title, price }] }]
//   verifyWebhook(req)                              → { ok, event, data } para webhooks entrantes del canal
//
// ─── Cómo cablearlo después (sin romper Lumina) ────────────────────────────
//   1. Implementar fulfill() de un canal nuevo en _lib/channels/<canal>.js y
//      asignarlo acá en CHANNEL_ADAPTERS[<canal>].fulfill.
//   2. En fulfillCharge (sync.js), ANTES del error de "canal no implementado":
//        const ad = getChannelAdapter(channel);
//        if (ad?.fulfill) return ad.fulfill(merchant, subscriberId, sub, params, tag);
//      Dejar las ramas "shopify" y "none" como están (camino del cobro de Lumina).
//   3. onCancel: llamarlo desde los puntos donde una sub pasa a "cancelled"
//      (subscribers.js, public.js, sync.js) con try/catch, sin bloquear la baja.
//   4. Webhooks entrantes: rutear por ?action= en una función existente (p. ej.
//      api/public.js?action=channel-webhook&channel=impultienda), nunca una función nueva.
//   5. Pasar CHANNELS[<canal>].status a "available" en profile.js recién cuando
//      fulfill + tests estén listos.
import { CHANNELS, merchantProfile } from "../../../shared/platform/profile.js";

export const CHANNEL_ADAPTERS = {
  shopify: {
    id: "shopify",
    stage: "live",
    auth: "oauth",                 // app de Shopify por merchant (api/shopify/oauth-callback.js)
    catalog: "api",                // Admin REST /products (_lib/shopify.js)
    fulfillment: "order",          // una orden PAGA por cobro (createShopifyOrderForSub)
    access: "none",                // producto físico o digital entregado por la tienda
    storefront: "widget",          // snippet en el tema (api/widget.js)
    inboundWebhooks: [],           // hoy no escuchamos webhooks de Shopify
    cancelHook: false,             // cancelar no toca la tienda
    digitalDelivery: "if_no_shipping", // _lib/delivery.js si el negocio no tiene envío
    wired: { fulfill: "sync.js#createShopifyOrderForSub", onCancel: null, listCatalog: "shopify.js", verifyWebhook: null },
    needs: [],
  },
  none: {
    id: "none",
    stage: "live",
    auth: "none",
    catalog: "manual",             // nombre + precio cargados en el plan (item_source "manual")
    fulfillment: "internal",       // comprobante interno rec_<payment_id> (profile.internalFulfillmentId)
    access: "email_link",          // _lib/delivery.js manda el link del plan
    storefront: "link",            // #/checkout?merchant=&plan= (Checkout.jsx)
    inboundWebhooks: [],
    cancelHook: false,
    digitalDelivery: "if_no_shipping",
    wired: { fulfill: "sync.js#fulfillCharge(none)", onCancel: null, listCatalog: null, verifyWebhook: null },
    needs: [],
  },
  tiendanube: {
    id: "tiendanube",
    stage: "planned",
    auth: "oauth",                 // app de Partner de Tiendanube
    catalog: "api",                // GET /products
    fulfillment: "order",          // POST /orders con payment_status "paid"
    access: "none",
    storefront: "script",          // Script API (scope "scripts") para inyectar el widget
    inboundWebhooks: ["app/uninstalled", "order/*", "product/*"],
    cancelHook: false,
    digitalDelivery: "if_no_shipping",
    wired: { fulfill: null, onCancel: null, listCatalog: null, verifyWebhook: null },
    needs: ["App de Partner + OAuth", "adapter de órdenes", "widget vía Script API"],
  },
  impultienda: {
    id: "impultienda",
    stage: "research",             // ver docs/IMPULTIENDA.md
    auth: "api_key",               // API REST /v1 con claves itd_… documentada pero NO habilitada (sep-2026)
    catalog: "none",               // no hay forma pública de leer productos desde afuera todavía
    fulfillment: "access_grant",   // cada cobro debería habilitar el acceso/descarga del comprador
    access: "grant_revoke",        // conceder en activación/renovación, revocar al cancelar o rechazar
    storefront: "link",            // hoy: link de suscripción de Recurrentes desde la landing de Impultienda
    inboundWebhooks: ["order.approved", "order.refunded", "order.chargeback", "subscription.activated", "subscription.renewed", "subscription.payment_failed", "subscription.canceled"],
    cancelHook: true,
    digitalDelivery: "interim",    // mientras tanto: channel "none" + entrega digital por mail
    wired: { fulfill: null, onCancel: null, listCatalog: null, verifyWebhook: null },
    needs: [
      "API key por vendedor (u OAuth) para leer productos",
      "endpoint para crear una orden/licencia paga por cobro externo (o conceder acceso por email)",
      "endpoint o webhook para revocar el acceso al cancelar",
      "forma de sumar un botón/script de suscripción en la landing o el checkout",
    ],
  },
};

/** Adapter de un canal por id (o null si no existe). */
export function getChannelAdapter(id) {
  return CHANNEL_ADAPTERS[id] || null;
}

/** Adapter del canal efectivo del merchant (Lumina → shopify). */
export function channelAdapterFor(merchant) {
  return getChannelAdapter(merchantProfile(merchant).channel);
}

/** ¿El canal ya cumple cobros en producción? (hoy: shopify y none). */
export function channelFulfillsCharges(id) {
  const ad = getChannelAdapter(id);
  return !!(ad && ad.stage === "live" && ad.wired.fulfill);
}

/** Resumen para soporte / panel interno: [{ id, label, status, stage, needs }]. */
export function channelsOverview() {
  return Object.keys(CHANNELS).map((id) => {
    const ch = CHANNELS[id];
    const ad = CHANNEL_ADAPTERS[id] || {};
    return { id, label: ch.label, status: ch.status, stage: ad.stage || "unknown", needs: ad.needs || [] };
  });
}
