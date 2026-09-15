// Token de autenticidad para los webhooks de pasarelas alternativas.
//
// Algunas pasarelas (Mobbex) no firman sus webhooks. Por eso cada URL de aviso
// que registramos lleva ?mid=<merchant>&t=<token>, donde token es un HMAC de
// (pasarela, merchant) con PROVIDER_WEBHOOK_SECRET (o el secreto de firma de la
// app si no está). Sin el token correcto el webhook se rechaza con 401.
// Las pasarelas que SÍ firman (Stripe, Whop) verifican además su propia firma.
//
// OJO: el token queda guardado en la pasarela (la URL se manda al crear cada
// suscripción). Si se rota el secreto, las suscripciones ya creadas dejan de
// autenticar → rotarlo solo con un plan de migración.
import crypto from "crypto";
import { signingSecret } from "../config.js";
import { timingSafeEqualStr } from "../token.js";

function secret() {
  return process.env.PROVIDER_WEBHOOK_SECRET || signingSecret();
}

export function providerWebhookToken(providerId, merchantId) {
  return crypto.createHmac("sha256", secret())
    .update(`provider-webhook:${String(providerId)}:${String(merchantId)}`)
    .digest("base64url")
    .slice(0, 32);
}

export function verifyProviderWebhookToken(providerId, merchantId, token) {
  if (!providerId || !merchantId || !token) return false;
  return timingSafeEqualStr(providerWebhookToken(providerId, merchantId), String(token));
}

// URL pública del webhook: /api/public?action=provider-webhook&p=<id>&mid=<merchant>&t=<token>
export function providerWebhookUrl(baseUrl, providerId, merchantId) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const q = new URLSearchParams({
    action: "provider-webhook",
    p: String(providerId),
    mid: String(merchantId),
    t: providerWebhookToken(providerId, merchantId),
  });
  return `${base}/api/public?${q.toString()}`;
}
