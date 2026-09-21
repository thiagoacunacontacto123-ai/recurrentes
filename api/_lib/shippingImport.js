// Traer los envíos de la tienda SOLOS, sin que el comerciante toque nada.
//
// 21-sept-2026 (Thiago): "todas las tiendas a partir de hoy que se pasen todos
// sus datos de envío, total tenemos los permisos". Antes esto era un botón en
// Configuración → Checkout que casi nadie apretaba: el comerciante conectaba la
// tienda, creaba el plan y su checkout quedaba con el envío que hubiera cargado
// a mano en el plan (o ninguno). Caso Glowtherm.
//
// Ahora corre solo al conectar Shopify o Tiendanube. Es best-effort: si falla,
// la conexión NO se rompe — el checkout igual cotiza en vivo contra la tienda
// en cada compra, esto es para que el panel muestre las tarifas desde el día 1
// y para las tiendas que no tienen app de envíos.
//
// NUNCA pisa lo que el comerciante ya eligió: si `checkout_shipping_rates` tiene
// algo, se respeta.

import { db } from "./firebase.js";

const MAX_RATES = 6;

// Normaliza y deduplica lo que devuelva cada plataforma.
function limpiar(lista) {
  const seen = new Set();
  const out = [];
  for (const r of lista || []) {
    const name = String(r?.name || "").trim().slice(0, 250);
    const price = Math.round(Number(r?.price));
    if (!name || !Number.isInteger(price) || price < 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const code = String(r?.code || "").trim().slice(0, 50);
    out.push({ name, price, ...(code ? { code } : {}) });
    if (out.length >= MAX_RATES) break;
  }
  return out;
}

/**
 * Importa los envíos de la tienda al doc del merchant, si todavía no tiene.
 * Devuelve { imported: n } o { skipped: "<motivo>" }. Nunca lanza.
 */
export async function autoImportShippingRates(merchantId, merchant, { force = false } = {}) {
  try {
    const m = merchant || {};
    if (!force && Array.isArray(m.checkout_shipping_rates) && m.checkout_shipping_rates.length) {
      return { skipped: "ya tiene tarifas" };
    }
    let rates = [];
    let source = "";
    if (m.shopify_shop && m.shopify_token) {
      const { shopifyRatesForPanel } = await import("./shopify.js");
      const r = await shopifyRatesForPanel(m);
      rates = limpiar(r.rates);
      source = "shopify";
    } else if (m.tiendanube_store_id && m.tiendanube_token) {
      const tn = await import("./tiendanube.js");
      if (typeof tn.tnShippingRates === "function") {
        rates = limpiar(await tn.tnShippingRates(m.tiendanube_store_id, m.tiendanube_token));
        source = "tiendanube";
      } else {
        return { skipped: "tiendanube sin lector de tarifas" };
      }
    } else {
      return { skipped: "sin tienda conectada" };
    }
    // Sin tarifas fijas = la tienda cotiza con una app de envíos (carrier
    // dinámico). No es un error: el checkout las va a pedir en vivo por CP.
    if (!rates.length) return { skipped: "tarifas dinámicas" };

    await db().collection("merchants").doc(merchantId).set({
      checkout_shipping_rates: rates,
      checkout_shipping_rates_source: source,
      checkout_shipping_rates_imported_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { merge: true });
    return { imported: rates.length, rates, source };
  } catch (e) {
    // Best-effort: que no se caiga la conexión de la tienda por esto.
    console.warn(`[shippingImport] ${merchantId}:`, e.message);
    return { skipped: "error", error: e.message };
  }
}
