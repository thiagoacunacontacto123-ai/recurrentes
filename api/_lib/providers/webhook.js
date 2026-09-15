// POST /api/public?action=provider-webhook&p=<pasarela>&mid=<merchant>&t=<token>
//
// Webhook ÚNICO para las pasarelas alternativas (Mobbex hoy; Stripe/Whop cuando
// estén sus adapters). Mercado Pago sigue en /api/mp/webhook (no pasa por acá).
//
//   1. adapter.parseWebhook verifica autenticidad y normaliza a eventos.
//   2. processProviderEvents los aplica (claim atómico → orden/comprobante → status → mails/flujos).
//
// El flag <ID>_ENABLED apaga checkouts nuevos y la conexión desde el panel, pero
// los avisos de suscripciones YA creadas se siguen procesando (si no, un cobro
// pagado quedaría sin orden). Sin adapter instalado → 404.
//
// Respuestas: 200 si se procesó o se ignoró a propósito · 401/400 aviso inválido
// (la pasarela no debería reintentar) · 500 error inesperado (que reintente; el
// claim atómico evita órdenes duplicadas).
import { db } from "../firebase.js";
import { getProvider } from "./index.js";
import { processProviderEvents } from "../charges/processProviderCharge.js";

async function getMerchant(merchantId) {
  if (!merchantId || !/^[A-Za-z0-9_-]{1,128}$/.test(String(merchantId))) return null;
  const snap = await db().collection("merchants").doc(String(merchantId)).get();
  return snap.exists ? snap.data() : null;
}

export async function handleProviderWebhook(req, res) {
  // Healthchecks (GET/HEAD) → 200.
  if (req.method !== "POST") return res.status(200).json({ ok: true });
  const providerId = String(req.query?.p || "").trim().toLowerCase();
  if (!providerId || providerId === "mercadopago") return res.status(404).json({ error: "pasarela no soportada acá" });
  const adapter = await getProvider(providerId);
  if (!adapter || adapter.placeholder) return res.status(404).json({ error: "pasarela no disponible" });

  let parsed;
  try {
    parsed = await adapter.parseWebhook(req, { getMerchant });
  } catch (e) {
    console.error(`[provider-webhook] ${providerId} parse falló:`, e.message);
    return res.status(500).json({ error: "no se pudo verificar el aviso" });
  }
  // Log sin PII: solo tipos e ids.
  console.log("[provider-webhook] received", JSON.stringify({
    provider: providerId, ok: !!parsed?.ok, mid: parsed?.merchantId || null,
    events: (parsed?.events || []).map((e) => ({ type: e.type, psid: e.providerSubscriptionId || null, pid: e.paymentId || null })),
    ignored: parsed?.ignored || undefined, error: parsed?.ok ? undefined : parsed?.error,
  }));
  if (!parsed?.ok) return res.status(parsed?.status || 400).json({ error: parsed?.error || "aviso inválido" });
  if (!parsed.events?.length) return res.status(200).json({ ok: true, processed: 0 });

  const merchant = await getMerchant(parsed.merchantId);
  if (!merchant) return res.status(200).json({ ok: true, processed: 0, warning: "merchant no encontrado" });

  try {
    const results = await processProviderEvents({ providerId, merchantId: parsed.merchantId, merchant, events: parsed.events });
    return res.status(200).json({ ok: true, processed: results.length, results: results.map((r) => ({ type: r.type, status: r.status })) });
  } catch (e) {
    console.error(`[provider-webhook] ${providerId} proceso falló:`, e.message);
    return res.status(500).json({ error: "error procesando el aviso" });
  }
}
