// api/_lib/planCreate.js — el alta de un plan (lo que hacía POST /api/plans).
// Separado del handler para que el Admin pueda crear planes por receta (7-oct-2026,
// G4U) por el MISMO camino que el panel: validaciones, plan plantilla en Mercado
// Pago, nace apagado. Devuelve { status, json } y el handler lo responde tal cual.
import { db } from "./firebase.js";
import { mpCreatePreapprovalPlan, mpReason } from "./mp.js";
import { appBaseUrl } from "./config.js";
import { normalizePacks, resolvePack, defaultPackIndex, withPackDefaults, normalizeMix, normalizeFrequencyOptions } from "./packs.js";
import { merchantProfile } from "../../shared/platform/profile.js";
import { normalizeDigitalDelivery } from "../../shared/platform/delivery.js";

export async function createPlanForMerchant({ merchantId, merchant: merchantIn = null, body: bodyIn, req = null }) {
  const merchantRef = db().collection("merchants").doc(merchantId);
  const plansCol = merchantRef.collection("plans");
    const body = bodyIn || {};
    const {
      shopify_product_id, shopify_variant_id, product_title, product_image,
      frequency_days, discount_pct, units_per_shipment, base_price_ars,
      // Nuevos: envío y descuentos por cantidad
      shipping_price_ars, free_shipping_from_ars, shipping_method_name,
      qty_discount_tiers, // [{ min_qty, discount_pct }]
      allow_custom_frequency, max_pack_discount_pct,
      // Packs (bundle)
      pricing_mode, packs, frequency_scales_with_qty,
    } = body;
    const merchant = merchantIn || ((await merchantRef.get()).data() || {});
    // Perfil del negocio (shared/platform/profile.js): con tienda, el plan sale de
    // un producto del catálogo; sin tienda (servicios, link de suscripción) es un
    // ítem cargado a mano (nombre + precio), sin packs y sin envío si no aplica.
    const profile = merchantProfile(merchant);
    const manualItem = !profile.caps.catalog;
    if (manualItem) {
      if (!String(product_title || "").trim()) return { status: 400, json: ({ error: "Poné un nombre al plan" }) };
      if (!(parseFloat(base_price_ars) > 0)) return { status: 400, json: ({ error: "El precio tiene que ser mayor a 0" }) };
    } else if (!shopify_product_id || !shopify_variant_id || !product_title) {
      return { status: 400, json: ({ error: "Faltan datos del producto" }) };
    }
    if (!frequency_days || frequency_days < 1)
      return { status: 400, json: ({ error: "frequency_days inválido" }) };

    // Packs: validar + resolver pricing_mode. Los packs viven en el widget de la
    // tienda: sin widget el plan es siempre precio simple ("theme").
    const pk = profile.caps.packs ? normalizePacks(packs) : { packs: [] };
    if (pk.error) return { status: 400, json: ({ error: pk.error }) };
    const modeRes = profile.caps.packs ? resolvePricingMode(pricing_mode, pk.packs) : { mode: "theme" };
    if (modeRes.error) return { status: 400, json: ({ error: modeRes.error }) };
    const packsMode = modeRes.mode === "packs";
    // "Armá tu pack" y frecuencias a elegir (7-oct-2026, G4U): solo con widget en la tienda.
    const mixRes = profile.caps.packs ? normalizeMix(body.mix) : { mix: null };
    if (mixRes.error) return { status: 400, json: { error: mixRes.error } };
    const foRes = normalizeFrequencyOptions(body.frequency_options);
    if (foRes.error) return { status: 400, json: { error: foRes.error } };
    // Entrega digital (solo negocios sin envío; shared/platform/delivery.js). Se
    // valida antes de crear el plan en MP para no dejar planes huérfanos.
    const ddRes = !profile.caps.shipping && body.digital_delivery != null ? normalizeDigitalDelivery(body.digital_delivery) : { value: null };
    if (ddRes.error) return { status: 400, json: ({ error: ddRes.error }) };

    if (!merchant.mp_access_token) return { status: 400, json: ({ error: "Conectá MP primero" }) };

    // En modo packs, si no mandan base_price_ars lo tomamos del pack de 1 unidad
    // (o precio/qty del pack más chico): es la referencia del precio tachado.
    let basePriceNum = parseFloat(base_price_ars) || 0;
    if (packsMode && !(basePriceNum > 0)) basePriceNum = unitPriceFromPacks(pk.packs);
    const discountNum = parseInt(discount_pct) || 0;
    const subscription_price_ars = Math.round(basePriceNum * (1 - discountNum / 100));
    // Monto del plan "plantilla" en MP (el real se crea ad-hoc por sub en checkout/init).
    const planDraft = { packs: pk.packs, discount_pct: discountNum, base_price_ars: basePriceNum, frequency_days: parseInt(frequency_days), frequency_scales_with_qty: frequency_scales_with_qty !== false };
    const defPack = packsMode ? resolvePack(planDraft, defaultPackIndex(planDraft)) : null;
    const mpAmount = defPack ? defPack.subPrice : subscription_price_ars;
    if (!(mpAmount > 0)) return { status: 400, json: ({ error: "El precio de suscripción tiene que ser mayor a 0" }) };

    // Crear preapproval_plan en MP. MP exige back_url HTTPS: sale de APP_BASE_URL.
    const baseUrl = appBaseUrl();
    if (!/^https:\/\//.test(baseUrl)) return { status: 500, json: ({ error: "APP_BASE_URL debe ser https para crear planes en MP" }) };
    const backUrl = `${baseUrl}/#/checkout-success`;
    const planBody = {
      // MP corta el reason en 60 chars: mas largo = HTTP 400 y no se crea el
      // plan. Se recorta el titulo, nunca el "cada N dias". 22-sept-2026.
      reason: mpReason(product_title, ` — cada ${frequency_days} días`),
      auto_recurring: {
        frequency: parseInt(frequency_days),
        frequency_type: "days",
        transaction_amount: mpAmount,
        currency_id: "ARS",
      },
      back_url: backUrl,
      // SOLO credit_card. Débito y dinero en cuenta NO sirven para cobros
      // recurrentes en MP — el primer pago anda pero el segundo mes falla
      // porque débito requiere autorización del titular cada vez y el saldo
      // en cuenta no se renueva automáticamente. Sin este filtro MP muestra
      // todos los métodos en el checkout y los clientes que eligen débito
      // quedan con sub que cancela sola al primer cobro recurrente.
      payment_methods_allowed: {
        payment_types: [{ id: "credit_card" }],
        payment_methods: [],
      },
    };
    let mpPlan;
    try {
      mpPlan = await mpCreatePreapprovalPlan(merchant.mp_access_token, planBody);
    } catch (e) {
      return { status: 502, json: ({ error: `MP: ${e.message}` }) };
    }

    // Normalizar tiers de descuento por cantidad: array de { min_qty, discount_pct }
    // ordenado por min_qty ascendente. Si no viene array válido, queda [].
    const tiers = Array.isArray(qty_discount_tiers)
      ? qty_discount_tiers
          .map(t => ({
            min_qty: Math.max(2, parseInt(t.min_qty) || 0),
            discount_pct: Math.max(0, Math.min(100, parseInt(t.discount_pct) || 0)),
          }))
          .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
          .sort((a, b) => a.min_qty - b.min_qty)
      : [];

    const planRef = plansCol.doc();
    const data = {
      // Ítem manual (sin tienda): sin ids de Shopify; el checkout lo resuelve por plan id.
      shopify_product_id: manualItem ? null : String(shopify_product_id),
      shopify_variant_id: manualItem ? null : String(shopify_variant_id),
      item_source: manualItem ? "manual" : profile.channel,
      product_title: manualItem ? String(product_title).trim().slice(0, 120) : product_title,
      product_image: product_image || null,
      frequency_days: parseInt(frequency_days),
      discount_pct: discountNum,
      units_per_shipment: parseInt(units_per_shipment) || 1,
      base_price_ars: basePriceNum,
      subscription_price_ars,
      // Packs (bundle)
      pricing_mode: modeRes.mode,
      packs: pk.packs,
      frequency_scales_with_qty: frequency_scales_with_qty !== false,
      mix: mixRes.mix,
      frequency_options: foRes.options,
      // Envío (sin envío en el perfil — servicios, digitales — queda en 0)
      shipping_price_ars: profile.caps.shipping ? Math.max(0, parseFloat(shipping_price_ars) || 0) : 0,
      free_shipping_from_ars: profile.caps.shipping ? Math.max(0, parseFloat(free_shipping_from_ars) || 0) : 0, // 0 = nunca gratis
      shipping_method_name: (shipping_method_name || "Envío a domicilio").trim().slice(0, 60),
      // Descuentos por cantidad
      qty_discount_tiers: tiers,
      // El cliente puede elegir otra frecuencia (default no) / tope de descuento por pack.
      allow_custom_frequency: allow_custom_frequency === true,
      max_pack_discount_pct: clampPct(max_pack_discount_pct, 35),
      mp_preapproval_plan_id: mpPlan.id,
      ...(ddRes.value ? { digital_delivery: ddRes.value } : {}),
      // Un plan nuevo NACE APAGADO (22-sept-2026, Thiago: "me da miedo que ya se
      // ponga cuando todavia no estoy mirando la tienda"). El widget solo sirve
      // planes con active:true, asi que hasta que el comerciante toque
      // "Activar en mi tienda" su pagina de producto sigue exactamente igual.
      // Los planes que ya existian no se tocan: esto es solo el alta.
      active: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await planRef.set(data);
    // Adquisición: el primer plan de la cuenta → StartTrial a nuestro pixel (una sola vez).
    try { const { trackAcquisition } = await import("./acquisition.js"); await trackAcquisition(merchantId, "first_plan", { req }); } catch (_) {}
    return { status: 200, json: ({ ok: true, plan: withPackDefaults({ id: planRef.id, ...data }) }) };
}

// pricing_mode: explícito ("packs"|"theme") o derivado de los packs.
// "packs" explícito sin packs → error (el checkout no tendría qué cobrar).
export function resolvePricingMode(explicit, packs) {
  const has = Array.isArray(packs) && packs.length > 0;
  if (explicit == null || explicit === "") return { mode: has ? "packs" : "theme" };
  const m = String(explicit).toLowerCase();
  if (m !== "packs" && m !== "theme") return { error: 'pricing_mode debe ser "packs" o "theme"' };
  if (m === "packs" && !has) return { error: "Modo packs requiere al menos un pack" };
  return { mode: m };
}

// Precio unitario de referencia a partir de los packs (pack de 1 o precio/qty del más chico).
export function unitPriceFromPacks(packs) {
  if (!Array.isArray(packs) || !packs.length) return 0;
  const one = packs.find(p => p.qty === 1);
  if (one) return one.price_ars;
  const min = packs[0];
  return Math.round(min.price_ars / Math.max(1, min.qty));
}

// Entero 0-80 con default.
export function clampPct(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(80, n)) : def;
}
