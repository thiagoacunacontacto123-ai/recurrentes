// /api/shopify — endpoint consolidado para operaciones de Shopify del merchant.
//
// Combina tres endpoints previos (save-creds, oauth-start, products) en un
// solo archivo. El callback OAuth queda en su path original
// (/api/shopify/oauth-callback) porque está hardcodeado en la app Shopify
// del merchant — no se puede mover sin que actualicen su Dev Dashboard.
//
//   GET  ?action=oauth-start   (auth) → { url } del consent de Shopify
//   GET  ?action=products      (auth) → lista productos del merchant
//   POST ?action=save-creds    (auth) → guarda client_id + secret + shop
//        body { shop, client_id?, client_secret?, access_token? }. Si viene
//        `access_token` (custom app), se valida contra shop.json y se guarda
//        junto con los datos de la tienda (shop_*, store_domain, …).
//   GET  ?action=shipping-rates (público, rate-limited) → tarifas de envío
//   GET  ?action=shipping-rates-admin (auth, dueño) → tarifas de Shopify para
//        importarlas al panel: { rates:[{name,price,code,source:"shopify"}], note? }
import { db, requireMerchant } from "./_lib/firebase.js";
import { shListProducts, shGetShippingRates, shQuoteShippingRates, shGetShopInfo, buildShopInfoPatch, shopifyRatesForPanel, shAccessScopes } from "./_lib/shopify.js";
import { signToken } from "./_lib/token.js";
import { appBaseUrl } from "./_lib/config.js";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";
import { oauthScopes } from "../shared/platform/shopify.js";
import { tiendanubeApi, tnActionFromPath } from "./_lib/tiendanubeApi.js";

const productsCache = new Map();
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "");
  // Tiendanube (tn-*): _lib/tiendanubeApi.js. También /api/tiendanube/{callback,webhooks} (vercel.json).
  if (action.startsWith("tn-") || (!action && tnActionFromPath(req.url))) return tiendanubeApi(action || tnActionFromPath(req.url), req, res);
  if (action === "oauth-start") return handleOauthStart(req, res);
  if (action === "products")    return handleProducts(req, res);
  if (action === "save-creds")  return handleSaveCreds(req, res);
  if (action === "shipping-rates") return handleShippingRates(req, res);
  if (action === "shipping-rates-admin") return handleShippingRatesAdmin(req, res);
  return res.status(400).json({ error: "action debe ser oauth-start | products | save-creds | shipping-rates | shipping-rates-admin" });
}

// ─── action=shipping-rates-admin ───────────────────────────────
async function handleShippingRatesAdmin(req, res) {
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (ctx.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede importar envíos." });
  try {
    const snap = await db().collection("merchants").doc(ctx.merchantId).get();
    const m = snap.exists ? snap.data() : {};
    if (!m.shopify_token || !m.shopify_shop) return res.status(400).json({ error: "Conectá Shopify primero", rates: [] });
    const out = await shopifyRatesForPanel(m);
    res.setHeader("Cache-Control", "no-store");
    return res.json(out);
  } catch (e) {
    return res.status(502).json({ error: e.message, rates: [] });
  }
}

// ─── action=shipping-rates ─────────────────────────────────────
// PÚBLICO (lo llama el checkout del cliente final, sin login): devuelve los
// métodos de envío que la tienda tiene configurados en Shopify, para la
// provincia/subtotal del carrito. Recibe merchant por query.
async function handleShippingRates(req, res) {
  const merchantId = String(req.query.merchant || req.query.uid || "");
  if (!merchantId) return res.status(400).json({ error: "Falta merchant" });
  // 60/h por merchant+IP: que nadie queme el bucket de Shopify del merchant.
  const rl = await rateLimit(`rates:${merchantId}:${clientIp(req)}`, { limit: 60, windowSec: 3600 });
  if (!rl.ok) return res.status(429).json({ rates: [], error: "Demasiadas consultas, probá en unos minutos" });
  try {
    const snap = await db().collection("merchants").doc(merchantId).get();
    const m = snap.exists ? snap.data() : null;
    // Tiendanube: sus medios de envío activos (Correo Argentino, OCA, retiro…).
    // No cotiza por CP como Shopify, pero el comprador ve los mismos métodos que
    // vería comprando normal, en vez del envío inventado del plan.
    if (!m?.shopify_token && m?.tiendanube_store_id && m?.tiendanube_token) {
      const { tnShippingRates } = await import("./_lib/tiendanube.js");
      const rates = await tnShippingRates(m.tiendanube_store_id, m.tiendanube_token);
      res.setHeader("Cache-Control", "no-store");
      return res.json({ rates });
    }
    if (!m?.shopify_token || !m?.shopify_shop) return res.json({ rates: [] });
    // El comprador tiene que ver TODO lo que vería en el checkout de la tienda:
    // las opciones que cotiza la app de envíos del comerciante (con sucursales) y
    // también las que él armó a mano (retiro en local, envío propio, moto…).
    //
    // 1) Cotización REAL: con variante y destino, le pedimos a Shopify que cotice
    //    como en su propio checkout. Eso invoca a la app de envíos y devuelve sus
    //    opciones con el `code` y el `source` que después necesita la orden.
    //    `shipping_zones.json` no las tiene: solo trae las manuales.
    // Interruptor por tienda: `shipping_live_quotes` (Configuración → Checkout).
    // APAGADO por defecto — cotizar en vivo cambia lo que ve el comprador y hay
    // que probarlo con la app de envíos de cada tienda antes de confiarle ventas
    // reales. Sin el flag, el comportamiento es el de siempre (tarifas propias).
    // Siempre en vivo: el checkout cotiza con el proveedor de envíos de la tienda, igual
    // que una venta común. No hay interruptor a propósito (Thiago, 16-sept).
    const liveQuotes = true;
    const variant = String(req.query.variant || "").trim();
    const carrier = (liveQuotes && variant)
      ? await shQuoteShippingRates(m.shopify_shop, m.shopify_token, {
          variantId: variant,
          quantity: Number(req.query.qty || 1),
          address: {
            zip: req.query.zip || "",
            city: req.query.city || "",
            province: req.query.province || "",
            address1: req.query.address1 || "",
          },
        })
      : [];

    // 2) Si la cotización en vivo ANDUVO, eso es exactamente lo que Shopify le
    //    muestra al comprador en el checkout de la tienda: ni una opción más.
    //    Antes le sumábamos encima las zonas manuales (`shipping_zones.json`),
    //    y ahí aparecían sucursales que el comerciante ya había sacado de su
    //    app de envíos: él limitaba las sucursales y en Recurrentes salían
    //    todas igual (22-sept-2026, Thiago). Las manuales quedan SOLO como
    //    respaldo para cuando no se pudo cotizar.
    if (carrier.length) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ rates: carrier });
    }

    // 3) Sin cotización (sin CP todavía, app caída, permiso faltante): las
    //    zonas propias del comerciante, que es lo que había antes de todo esto.
    const manuales = await shGetShippingRates(m.shopify_shop, m.shopify_token, {
      province: req.query.province || "",
      subtotal: Number(req.query.subtotal || 0),
    });
    const rates = manuales;
    res.setHeader("Cache-Control", "no-store");
    return res.json({ rates });
  } catch (e) {
    // Endpoint público: el detalle (URL de la tienda, respuesta de Shopify) va al log, no al comprador.
    console.warn(`[shopify/shipping-rates] ${merchantId}:`, e.message);
    return res.json({ rates: [], error: "No pudimos consultar los envíos de la tienda" });
  }
}

// ─── action=oauth-start ────────────────────────────────────────
// Requiere auth (Bearer). Devuelve { url } y el front redirige. El `state`
// es un token firmado {uid, mid, shop} (10 min) + cookie de respaldo: el callback
// no confía en ningún uid que venga suelto por query.
async function handleOauthStart(req, res) {
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { uid, merchantId } = ctx;
  // Solo el DUEÑO conecta integraciones (un miembro del equipo no).
  if (merchantId !== uid && !(ctx.role === "owner" || ctx.viaOwner)) return res.status(403).json({ error: "Solo el dueño de la tienda puede conectar Shopify." });

  const merchantSnap = await db().collection("merchants").doc(merchantId).get();
  if (!merchantSnap.exists) return res.status(404).json({ error: "Merchant no encontrado" });
  const merchant = merchantSnap.data();

  const shop = String(merchant.shopify_shop || "").toLowerCase();
  // App única de Recurrentes (env) si el merchant no cargó una app propia.
  const clientId = merchant.shopify_client_id || process.env.SHOPIFY_API_KEY || "";
  if (!shop || !SHOP_RE.test(shop)) return res.status(400).json({ error: "Shop inválido — formato: mitienda.myshopify.com" });
  if (!clientId) {
    return res.status(400).json({ error: "Falta configurar las credenciales: completá Client ID + Secret + Shop en Integraciones → Shopify y volvé a tocar \"Conectar tienda\"." });
  }

  // Lista compartida (shared/platform/shopify.js) + extras de la env SHOPIFY_SCOPES.
  const scopes = oauthScopes(process.env.SHOPIFY_SCOPES);
  const redirect = `${appBaseUrl() || "http://localhost:3000"}/api/shopify/oauth-callback`;

  // `mid` = merchant destino (tienda activa); `uid` se mantiene por compat con el callback.
  const state = signToken({ uid, mid: merchantId, shop }, 600);
  res.setHeader("Set-Cookie", `shopify_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

  const url = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
  return res.json({ url });
}

// ─── action=products ───────────────────────────────────────────
async function handleProducts(req, res) {
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { merchantId } = ctx;

  const fresh = req.query.fresh === "1";
  const TTL = 60 * 1000;
  if (!fresh && productsCache.has(merchantId)) {
    const c = productsCache.get(merchantId);
    if (Date.now() - c.ts < TTL) return res.json({ products: c.products, _cached: true });
  }

  const merchantSnap = await db().collection("merchants").doc(merchantId).get();
  const merchant = merchantSnap.data() || {};
  if (!merchant.shopify_token || !merchant.shopify_shop)
    return res.status(400).json({ error: "Conectá Shopify primero" });

  try {
    const raw = await shListProducts(merchant.shopify_shop, merchant.shopify_token);
    const products = raw.map(p => ({
      id: String(p.id),
      title: p.title,
      handle: p.handle,
      status: p.status,
      image: p.image?.src || null,
      variants: (p.variants || []).map(v => ({
        id: String(v.id),
        title: v.title,
        price: parseFloat(v.price) || 0,
        sku: v.sku || "",
        inventory_quantity: v.inventory_quantity ?? null,
      })),
    }));
    productsCache.set(merchantId, { products, ts: Date.now() });
    return res.json({ products });
  } catch (e) {
    // Permiso sin aprobar (caso Wellfresh, 22-sept-2026): Shopify contesta
    // "requires merchant approval for read_products scope". Antes salia como un
    // 502 cualquiera y el panel mostraba un selector VACIO, sin decir nada: el
    // comerciante creia que no tenia productos. Se marca aparte para que el
    // panel pueda explicarlo y mandarlo a reconectar.
    const msg = String(e.message || "");
    if (/requires merchant approval|access denied|read_products/i.test(msg)) {
      // Le preguntamos a Shopify que permisos tiene REALMENTE el token: si no
      // tiene NINGUNO (caso Wellfresh: el OAuth aprobo pero no otorgo nada) el
      // aviso tiene que ser otro, porque no alcanza con tildar read_products.
      let scopes = [];
      try {
        const m2 = (await db().collection("merchants").doc(merchantId).get()).data() || {};
        scopes = await shAccessScopes(m2.shopify_shop, m2.shopify_token);
      } catch (_) {}
      return res.status(403).json({
        error: "Tu app de Shopify todavía no tiene permiso para leer los productos.",
        code: "scope_missing", scope: "read_products",
        scopes_granted: scopes.length, products: [],
      });
    }
    return res.status(502).json({ error: e.message });
  }
}

// ─── action=save-creds ─────────────────────────────────────────
// client_id/secret son opcionales si Recurrentes tiene app única en env
// (SHOPIFY_API_KEY/SECRET): en ese caso alcanza con el shop.
async function handleSaveCreds(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { uid, merchantId } = ctx;
  if (merchantId !== uid && !(ctx.role === "owner" || ctx.viaOwner)) return res.status(403).json({ error: "Solo el dueño de la tienda puede configurar Shopify." });

  let { shop, client_id, client_secret, access_token } = req.body || {};
  const hasEnvApp = !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
  const token = typeof access_token === "string" ? access_token.trim() : "";
  if (!shop?.trim()) return res.status(400).json({ error: "Falta shop (mitienda.myshopify.com)" });
  // Con token de custom app no hacen falta client_id/secret (no hay OAuth).
  if (!token && !hasEnvApp && !client_id?.trim()) return res.status(400).json({ error: "Falta Client ID" });
  if (!token && !hasEnvApp && !client_secret?.trim()) return res.status(400).json({ error: "Falta Client Secret" });

  shop = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!SHOP_RE.test(shop)) {
    return res.status(400).json({ error: "Shop inválido — formato: mitienda.myshopify.com" });
  }

  const merchantSnap = await db().collection("merchants").doc(merchantId).get();
  const merchant = merchantSnap.exists ? merchantSnap.data() : {};
  // Una tienda a la vez: con Tiendanube conectado no se conecta Shopify (y al revés).
  if (merchant.tiendanube_token) {
    return res.status(400).json({ error: "Ya tenés Tiendanube conectado. Desvinculá Tiendanube antes de conectar Shopify: cada tienda de Recurrentes trabaja con una sola plataforma.", code: "channel_taken" });
  }

  // Token pegado (custom app / Admin API access token): lo validamos contra
  // shop.json antes de guardar nada. Si es válido, guardamos token + datos de la
  // tienda (shopify_domains, store_domain, store_name, shop_*).
  let shopInfoPatch = {};
  if (token) {
    if (!/^shp(at|ca|pa|ss)_[A-Za-z0-9]+$/.test(token) && token.length < 20) return res.status(400).json({ error: "access_token inválido" });
    try {
      const info = await shGetShopInfo(shop, token);
      shopInfoPatch = buildShopInfoPatch(merchant, info);
    } catch (e) {
      return res.status(400).json({ error: `Shopify no aceptó el token: ${e.message}` });
    }
  }

  try {
    await db().collection("merchants").doc(merchantId).set({
      shopify_shop: shop,
      shopify_client_id: (client_id || "").trim() || null,
      shopify_client_secret: (client_secret || "").trim() || null,
      shopify_creds_saved_at: new Date().toISOString(),
      ...(token ? {
        shopify_token: token,
        shopify_connected_at: new Date().toISOString(),
        shopify_method: "custom_app_token",
        shopify_uninstalled_at: null,
        shopify_disconnected_at: null,
        ...shopInfoPatch,
      } : { shopify_token: null }),
    }, { merge: true });
    if (token) { try { const { trackAcquisition } = await import("./_lib/acquisition.js"); await trackAcquisition(merchantId, "store_connected", { req }); } catch (_) {} }
    // Los envíos de la tienda entran solos (21-sept, Thiago): el comerciante no
    // tiene que ir a cargarlos. Best-effort, no rompe la conexión si falla.
    if (token) { try { const { autoImportShippingRates } = await import("./_lib/shippingImport.js"); await autoImportShippingRates(merchantId, { ...merchant, shopify_shop: shop, shopify_token: token }); } catch (_) {} }
    return res.json({ ok: true, shop, connected: !!token, ...(token ? { shop_name: shopInfoPatch.shop_name || null, store_domain: shopInfoPatch.store_domain || merchant.store_domain || null } : {}) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
