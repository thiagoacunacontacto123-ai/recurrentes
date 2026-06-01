// GET /api/shopify/oauth-callback?code=…&shop=…&hmac=…&state=…
//
// Shopify nos redirige acá tras autorizar. El `state` que mandamos tiene
// formato "<uid>:<nonce>". Extraemos el uid, buscamos las creds del merchant
// en Firestore, validamos HMAC con SU client_secret, intercambiamos `code`
// por access_token llamando a Shopify con SUS creds, y lo guardamos.
//
// Cada merchant usa su propia app → no hay creds centrales involucradas.
import crypto from "node:crypto";
import { db } from "../_lib/firebase.js";

export default async function handler(req, res) {
  const { code, shop, state, hmac } = req.query;
  if (!code || !shop || !state) return res.status(400).send("Faltan parámetros");

  // Extraer uid del state ("uid:nonce")
  const [uid, nonce] = String(state).split(":");
  if (!uid) return res.status(400).send("State inválido");

  // Validar nonce contra cookie
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieState = cookies.shopify_oauth_state || "";
  if (cookieState !== state) {
    return res.status(403).send("State inválido — el flow OAuth no coincide con la sesión actual. Volvé a Recurrentes y reiniciá la conexión.");
  }

  // Cargar creds del merchant
  const merchantSnap = await db().collection("merchants").doc(uid).get();
  if (!merchantSnap.exists) return res.status(404).send("Merchant no encontrado");
  const merchant = merchantSnap.data();
  const clientId = merchant.shopify_client_id;
  const clientSecret = merchant.shopify_client_secret;
  if (!clientId || !clientSecret) {
    return res.status(400).send("Faltan Client ID/Secret. Volvé a configurar en Recurrentes.");
  }

  // Validar HMAC con el secret del merchant
  try {
    const params = { ...req.query };
    delete params.hmac;
    delete params.signature;
    const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&");
    const calc = crypto.createHmac("sha256", clientSecret).update(message).digest("hex");
    if (calc !== hmac) {
      return res.status(403).send("HMAC inválido — la request no viene de Shopify o el Client Secret está mal copiado.");
    }
  } catch (e) {
    return res.status(500).send(`Error validando HMAC: ${e.message}`);
  }

  // Intercambiar code → access_token
  let tokenData;
  try {
    const r = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    });
    tokenData = await r.json();
    if (!r.ok || tokenData.error) {
      return res.status(400).send(`Shopify error: ${tokenData.error || r.status}. ¿El Client Secret es correcto?`);
    }
  } catch (e) {
    return res.status(500).send(`Network error: ${e.message}`);
  }

  // Guardar access_token en el merchant
  try {
    await db().collection("merchants").doc(uid).set({
      shopify_shop: String(shop),
      shopify_token: tokenData.access_token,
      shopify_scope: tokenData.scope,
      shopify_connected_at: new Date().toISOString(),
      shopify_method: "oauth_dev_dashboard",
    }, { merge: true });
  } catch (e) {
    return res.status(500).send(`Error guardando token: ${e.message}`);
  }

  // Redirect al dashboard con flag de éxito
  const baseUrl = process.env.APP_BASE_URL || "";
  res.writeHead(302, { Location: `${baseUrl}/#/dashboard?shopify_ok=1` });
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
