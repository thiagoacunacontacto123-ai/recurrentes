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
//   GET  ?action=shipping-rates (público, rate-limited) → tarifas de envío
import { db, requireMerchant } from "./_lib/firebase.js";
import { shListProducts, shGetShippingRates } from "./_lib/shopify.js";
import { signToken } from "./_lib/token.js";
import { appBaseUrl } from "./_lib/config.js";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";

const productsCache = new Map();
const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "");
  if (action === "oauth-start") return handleOauthStart(req, res);
  if (action === "products")    return handleProducts(req, res);
  if (action === "save-creds")  return handleSaveCreds(req, res);
  if (action === "shipping-rates") return handleShippingRates(req, res);
  return res.status(400).json({ error: "action debe ser oauth-start | products | save-creds | shipping-rates" });
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
    if (!m?.shopify_token || !m?.shopify_shop) return res.json({ rates: [] });
    const rates = await shGetShippingRates(m.shopify_shop, m.shopify_token, {
      province: req.query.province || "",
      subtotal: Number(req.query.subtotal || 0),
    });
    res.setHeader("Cache-Control", "no-store");
    return res.json({ rates });
  } catch (e) {
    return res.json({ rates: [], error: e.message });
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

  const scopes = process.env.SHOPIFY_SCOPES || "read_products,write_orders,read_orders,read_customers,write_customers,write_draft_orders";
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

  let { shop, client_id, client_secret } = req.body || {};
  const hasEnvApp = !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
  if (!shop?.trim()) return res.status(400).json({ error: "Falta shop (mitienda.myshopify.com)" });
  if (!hasEnvApp && !client_id?.trim()) return res.status(400).json({ error: "Falta Client ID" });
  if (!hasEnvApp && !client_secret?.trim()) return res.status(400).json({ error: "Falta Client Secret" });

  shop = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!SHOP_RE.test(shop)) {
    return res.status(400).json({ error: "Shop inválido — formato: mitienda.myshopify.com" });
  }

  try {
    await db().collection("merchants").doc(merchantId).set({
      shopify_shop: shop,
      shopify_client_id: (client_id || "").trim() || null,
      shopify_client_secret: (client_secret || "").trim() || null,
      shopify_creds_saved_at: new Date().toISOString(),
      shopify_token: null,
    }, { merge: true });
    return res.json({ ok: true, shop });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
