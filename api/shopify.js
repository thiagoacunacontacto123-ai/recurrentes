// /api/shopify — endpoint consolidado para operaciones de Shopify del merchant.
//
// Combina tres endpoints previos (save-creds, oauth-start, products) en un
// solo archivo para entrar dentro del límite de 12 funciones del plan Hobby
// de Vercel. El callback OAuth queda en su path original
// (/api/shopify/oauth-callback) porque está hardcodeado en la app Shopify
// del merchant — no se puede mover sin que actualicen su Dev Dashboard.
//
//   GET  ?action=oauth-start&uid=<uid>   → redirige al consent de Shopify
//   GET  ?action=products                → lista productos del merchant
//   POST ?action=save-creds              → guarda client_id + secret + shop
//
// Todos los endpoints (excepto oauth-start, que recibe uid por query
// para que funcione como redirect desde el browser) requieren Firebase Auth.
import { db, requireAuth } from "./_lib/firebase.js";
import { shListProducts } from "./_lib/shopify.js";

const productsCache = new Map();

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "");
  if (action === "oauth-start") return handleOauthStart(req, res);
  if (action === "products")    return handleProducts(req, res);
  if (action === "save-creds")  return handleSaveCreds(req, res);
  return res.status(400).json({ error: "action debe ser oauth-start | products | save-creds" });
}

// ─── action=oauth-start ────────────────────────────────────────
// Acceso sin Bearer — el merchant lo abre via window.location desde el browser.
// Validamos por uid en query + merchant doc existente en Firestore.
async function handleOauthStart(req, res) {
  const uid = req.query.uid;
  if (!uid) return res.status(400).send("Falta uid del merchant");

  const merchantSnap = await db().collection("merchants").doc(String(uid)).get();
  if (!merchantSnap.exists) return res.status(404).send("Merchant no encontrado");
  const merchant = merchantSnap.data();

  const shop = merchant.shopify_shop;
  const clientId = merchant.shopify_client_id;
  if (!shop || !clientId) {
    return res.status(400).send(`
      <h2>Falta configurar las credenciales</h2>
      <p>Volvé a Recurrentes → Integraciones → Shopify, completá Client ID + Secret + Shop y volvé a hacer click en "Conectar tienda".</p>
    `);
  }

  const scopes = "read_products,write_orders,read_orders,read_customers,write_customers,write_draft_orders";
  const redirect = `${process.env.APP_BASE_URL || "http://localhost:3000"}/api/shopify/oauth-callback`;

  // State opaco — incluye uid para mapear el callback al merchant.
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const state = `${uid}:${nonce}`;
  res.setHeader("Set-Cookie", `shopify_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);

  const url = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(redirect)}&state=${encodeURIComponent(state)}`;
  res.writeHead(302, { Location: url });
  res.end();
}

// ─── action=products ───────────────────────────────────────────
async function handleProducts(req, res) {
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const fresh = req.query.fresh === "1";
  const TTL = 60 * 1000;
  if (!fresh && productsCache.has(uid)) {
    const c = productsCache.get(uid);
    if (Date.now() - c.ts < TTL) return res.json({ products: c.products, _cached: true });
  }

  const merchantSnap = await db().collection("merchants").doc(uid).get();
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
    productsCache.set(uid, { products, ts: Date.now() });
    return res.json({ products });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

// ─── action=save-creds ─────────────────────────────────────────
async function handleSaveCreds(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const uid = await requireAuth(req, res);
  if (!uid) return;

  let { shop, client_id, client_secret } = req.body || {};
  if (!shop?.trim()) return res.status(400).json({ error: "Falta shop (mitienda.myshopify.com)" });
  if (!client_id?.trim()) return res.status(400).json({ error: "Falta Client ID" });
  if (!client_secret?.trim()) return res.status(400).json({ error: "Falta Client Secret" });

  shop = shop.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    return res.status(400).json({ error: "Shop inválido — formato: mitienda.myshopify.com" });
  }

  try {
    await db().collection("merchants").doc(uid).set({
      shopify_shop: shop,
      shopify_client_id: client_id.trim(),
      shopify_client_secret: client_secret.trim(),
      shopify_creds_saved_at: new Date().toISOString(),
      shopify_token: null,
    }, { merge: true });
    return res.json({ ok: true, shop });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
