// Checkout con una pasarela ALTERNATIVA (Mobbex/Stripe/Whop). Lo llama
// api/checkout/init.js SOLO cuando checkoutProviderFor(merchant) devuelve un
// adapter (merchant con payment_provider ≠ mercadopago y flag de entorno prendido).
// Para Mercado Pago (Lumina y todos hoy) este archivo ni se carga.
//
// Recibe el subscriber pending YA guardado por init.js (misma validación, precio,
// envío y cupones que MP) y solo cambia el último paso: en vez de crear el plan
// ad-hoc en MP, le pide al adapter el link de pago.
import { providerWebhookUrl } from "./webhookToken.js";
import { emitFlowEvent } from "../flows.js";

export async function startProviderCheckout(adapter, ctx) {
  const {
    res, merchantRef, merchantId, merchant, subRef, subData, plan,
    freqDays, totalPerCharge, portalToken, backUrl, baseUrl, track,
  } = ctx;
  const subscriberId = subRef.id;
  const notificationUrl = baseUrl ? providerWebhookUrl(baseUrl, adapter.id, merchantId) : null;

  // Marca la sub con su pasarela ANTES de ir a la pasarela: el webhook solo acepta
  // eventos de subs con payment_provider === adapter.id.
  await subRef.update({ payment_provider: adapter.id, provider_currency: adapter.currency, portal_token: portalToken });

  let out;
  try {
    out = await adapter.createSubscriptionCheckout({
      merchant,
      merchantId,
      subscriberId,
      sub: subData,
      plan,
      amount: totalPerCharge,
      currency: adapter.currency,
      frequencyDays: freqDays,
      backUrl,
      notificationUrl,
      customer: {
        email: subData.customer_email,
        name: subData.customer_name,
        phone: subData.customer_phone || null,
        tax_id: subData.customer_tax_id || null,
        address: subData.shipping_address || null,
      },
    });
    if (!out?.checkoutUrl) throw new Error(`${adapter.label} no devolvió el link de pago`);
  } catch (e) {
    const detail = String(e?.message || e).slice(0, 500);
    console.error(`[checkout/init] ${adapter.id} checkout falló:`, { merchantId, subscriberId, detail });
    await subRef.update({ status: "error", error: detail }).catch(() => {});
    await merchantRef.set({ [`${adapter.id}_last_error`]: detail, [`${adapter.id}_last_error_at`]: new Date().toISOString() }, { merge: true }).catch(() => {});
    // 400 = dato del comprador/config (mensaje claro); resto = la pasarela falló.
    if (e?.status === 400 && e.userMessage) return res.status(400).json({ error: e.userMessage });
    return res.status(502).json({ error: e?.userMessage || `La tienda tiene un problema con ${adapter.label}. Avisale al vendedor e intentá más tarde.` });
  }

  const update = {
    provider_checkout_url: out.checkoutUrl,
    provider_plan_id: out.providerPlanId || null,
    provider_subscription_id: out.providerSubscriptionId || null,
  };
  await subRef.update(update);

  const full = { ...subData, ...update, payment_provider: adapter.id, portal_token: portalToken };
  if (typeof track === "function") await track(full);
  await emitFlowEvent(merchantId, merchant, "checkout_started", subscriberId, full, { key: subscriberId });

  return res.json({
    ok: true,
    subscriber_id: subscriberId,
    init_point: out.checkoutUrl,
    provider: adapter.id,
    portal_token: portalToken,
  });
}
