// GET /api/mp/oauth-callback?code=…&state=…
//
// Mercado Pago nos redirige acá tras autorizar (flow iniciado en
// merchant?action=mp-oauth-start). Validamos el `state` firmado {uid},
// canjeamos el code por tokens y guardamos todo en merchants/{uid}.
// Público (sin Bearer): el uid sale del state, nunca de la query.
import { db } from "../_lib/firebase.js";
import { verifyToken } from "../_lib/token.js";
import { appBaseUrl } from "../_lib/config.js";
import { fetchWithTimeout } from "../_lib/http.js";

export default async function handler(req, res) {
  const back = (qs) => { res.writeHead(302, { Location: `${appBaseUrl()}/#/dashboard?${qs}` }); res.end(); };
  const fail = (msg) => back(`mp=error&msg=${encodeURIComponent(msg)}`);

  const { code, state, error, error_description } = req.query || {};
  if (error) return fail(String(error_description || error));
  if (!code || !state) return fail("Faltan parámetros");

  const payload = verifyToken(String(state));
  if (!payload?.uid) return fail("State inválido o vencido. Volvé a intentar desde Integraciones.");
  const uid = String(payload.uid);

  const clientId = process.env.MP_APP_ID;
  const clientSecret = process.env.MP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return fail("OAuth MP no configurado");
  const redirect = process.env.MP_REDIRECT_URI || `${appBaseUrl()}/api/mp/oauth-callback`;

  let tok;
  try {
    const r = await fetchWithTimeout("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code: String(code), redirect_uri: redirect }),
    }, 10000);
    tok = await r.json().catch(() => ({}));
    if (!r.ok || !tok.access_token) return fail(tok.message || tok.error || `MP HTTP ${r.status}`);
  } catch (e) {
    return fail(`Error de red: ${e.message}`);
  }

  try {
    const now = Date.now();
    await db().collection("merchants").doc(uid).set({
      mp_access_token: tok.access_token,
      mp_refresh_token: tok.refresh_token || null,
      mp_token_expires_at: new Date(now + (Number(tok.expires_in) || 0) * 1000).toISOString(),
      mp_user_id: tok.user_id != null ? String(tok.user_id) : null,
      mp_public_key: tok.public_key || null,
      mp_connected_at: new Date(now).toISOString(),
      mp_method: "oauth",
      mp_disconnected_at: null,
    }, { merge: true });
  } catch (e) {
    return fail(`Error guardando token: ${e.message}`);
  }
  return back("mp=ok");
}
