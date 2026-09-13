// GET /api/shopify/oauth-callback?code=…&shop=…&hmac=…&state=…
//
// Shopify nos redirige acá tras autorizar. El `state` es un token firmado
// {uid, shop} emitido por oauth-start. Validamos firma + expiración, que el
// `shop` sea *.myshopify.com y coincida con el del state (y con el que el
// merchant ya tenía, si tenía), el HMAC de Shopify en tiempo constante, y
// recién ahí intercambiamos `code` por access_token.
//
// Creds: las de la app del merchant (shopify_client_id/secret) o, si no
// cargó ninguna, las de la app única de Recurrentes (SHOPIFY_API_KEY/SECRET).
import crypto from "node:crypto";
import { db } from "../_lib/firebase.js";
import { verifyToken, timingSafeEqualStr } from "../_lib/token.js";
import { appBaseUrl } from "../_lib/config.js";
import { fetchWithTimeout } from "../_lib/http.js";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

export default async function handler(req, res) {
  const { code, shop, state, hmac } = req.query;
  if (!code || !shop || !state || !hmac) return res.status(400).send("Faltan parámetros");

  const shopNorm = String(shop).toLowerCase();
  if (!SHOP_RE.test(shopNorm)) return res.status(400).send("Shop inválido");

  // State firmado (uid + shop, 10 min).
  const payload = verifyToken(String(state));
  if (!payload?.uid || !payload?.shop) {
    return res.status(403).send("State inválido o vencido — volvé a Recurrentes y reiniciá la conexión.");
  }
  if (String(payload.shop).toLowerCase() !== shopNorm) return res.status(403).send("El shop no coincide con el flow iniciado.");
  // Multi-tienda: `mid` = merchant destino (tienda activa al iniciar el flow); sin mid → uid (tokens viejos).
  const uid = String(payload.mid || payload.uid);

  // Cookie de respaldo: si está, tiene que coincidir.
  const cookies = parseCookies(req.headers.cookie || "");
  if (cookies.shopify_oauth_state && !timingSafeEqualStr(cookies.shopify_oauth_state, String(state))) {
    return res.status(403).send("State inválido — el flow OAuth no coincide con la sesión actual. Volvé a Recurrentes y reiniciá la conexión.");
  }

  // Cargar creds del merchant
  const merchantSnap = await db().collection("merchants").doc(uid).get();
  if (!merchantSnap.exists) return res.status(404).send("Merchant no encontrado");
  const merchant = merchantSnap.data();
  if (merchant.shopify_shop && String(merchant.shopify_shop).toLowerCase() !== shopNorm) {
    return res.status(403).send("Esta cuenta ya tiene otra tienda asociada. Desconectala primero desde Integraciones.");
  }
  const ownApp = !!(merchant.shopify_client_id && merchant.shopify_client_secret);
  const clientId = ownApp ? merchant.shopify_client_id : process.env.SHOPIFY_API_KEY;
  const clientSecret = ownApp ? merchant.shopify_client_secret : process.env.SHOPIFY_API_SECRET;
  if (!clientId || !clientSecret) {
    return res.status(400).send("Faltan Client ID/Secret. Volvé a configurar en Recurrentes.");
  }

  // Validar HMAC de Shopify (tiempo constante)
  try {
    const params = { ...req.query };
    delete params.hmac;
    delete params.signature;
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const calc = crypto.createHmac("sha256", clientSecret).update(message).digest("hex");
    if (!timingSafeEqualStr(calc, String(hmac))) {
      return res.status(403).send("HMAC inválido — la request no viene de Shopify o el Client Secret está mal copiado.");
    }
  } catch (e) {
    return res.status(500).send(`Error validando HMAC: ${e.message}`);
  }

  // Intercambiar code → access_token
  let tokenData;
  try {
    const r = await fetchWithTimeout(`https://${shopNorm}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    }, 10000);
    tokenData = await r.json().catch(() => ({}));
    if (!r.ok || tokenData.error || !tokenData.access_token) {
      return res.status(400).send(`Shopify error: ${tokenData.error || r.status}. ¿El Client Secret es correcto?`);
    }
  } catch (e) {
    return res.status(500).send(`Network error: ${e.message}`);
  }

  // Guardar access_token en el merchant
  try {
    await db().collection("merchants").doc(uid).set({
      shopify_shop: shopNorm,
      shopify_token: tokenData.access_token,
      shopify_scope: tokenData.scope,
      shopify_connected_at: new Date().toISOString(),
      shopify_method: ownApp ? "oauth_dev_dashboard" : "oauth_recurrentes_app",
      shopify_uninstalled_at: null,
      shopify_disconnected_at: null,
    }, { merge: true });
  } catch (e) {
    return res.status(500).send(`Error guardando token: ${e.message}`);
  }

  // Limpiar cookie + redirect al dashboard con flag de éxito
  res.setHeader("Set-Cookie", "shopify_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  res.writeHead(302, { Location: `${appBaseUrl()}/#/dashboard?shopify_ok=1` });
  res.end();
}

function parseCookies(s) {
  const out = {};
  s.split(/;\s*/).forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}
