// GET /api/mp/oauth-callback?code=…&state=…   (o ?error=access_denied si cancela)
//
// Mercado Pago nos redirige acá tras autorizar (flow iniciado en
// merchant?action=mp-oauth-start). Toda la lógica vive en _lib/mpOauth.js:
// state firmado + nonce de un solo uso + PKCE, canje del code y guardado.
// Público (sin Bearer): la tienda sale del state, nunca de la query.
// Vuelve al panel con #/dashboard?mp=ok[&warn=…] o ?mp=error&reason=<código>
// (los textos para el comerciante están en src/lib/mpOauth.js).
import { appBaseUrl } from "../_lib/config.js";
import { handleMpOauthCallback } from "../_lib/mpOauth.js";

export default async function handler(req, res) {
  let out;
  try {
    out = await handleMpOauthCallback(req.query || {});
  } catch (e) {
    console.error("[mp-oauth] callback:", e?.message || e);
    out = { reason: "save", returnTo: appBaseUrl() };
  }
  const qs = new URLSearchParams(out.reason === "ok" ? { mp: "ok" } : { mp: "error", reason: out.reason });
  if (out.warn?.length) qs.set("warn", out.warn.join(","));
  if (out.detail) qs.set("msg", out.detail);
  res.writeHead(302, {
    Location: `${out.returnTo || appBaseUrl()}/#/dashboard?${qs.toString()}`,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end();
}
