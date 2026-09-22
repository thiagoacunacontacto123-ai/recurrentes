// Cobro del plan de Recurrentes al COMERCIANTE por Stripe (cuenta de Thiago).
//
// Modelo (decisión 2026-09-16): suscripción mensual en Stripe por el tramo que le
// corresponde al activar. El ciclo es por fecha: cada renovación cobra el tramo que
// corresponda a los suscriptores activos EN ESE MOMENTO. No hay diferenciales a
// mitad de ciclo: el cron diario `sync-saas-tiers` alinea el precio de la
// suscripción con el tramo actual (sin prorrateo), así la próxima factura sale por
// el tramo vigente. Si baja al tramo gratis, la suscripción se cancela al fin del
// período; si vuelve a crecer, activa de nuevo.
//
// Env (Vercel): STRIPE_SAAS_SECRET_KEY (sk_live_…), STRIPE_SAAS_WEBHOOK_SECRET
// (whsec_… del endpoint /api/public?action=stripe-saas-webhook). Sin la clave, todo
// esto es no-op y el panel sigue con "Activar plan → te contactamos".
//
// Campos en merchants/{mid}: saas_stripe_customer_id, saas_stripe_subscription_id,
// saas_stripe_price_tier, saas_status (active|past_due|cancelled), saas_last_paid_at,
// saas_current_period_end, plan_activated, plan_activated_at.
import { db } from "./firebase.js";
import { appBaseUrl } from "./config.js";
import { PRICING_TIERS, TIER_BY_ID, tierFor, tierPriceFor } from "../../shared/platform/pricing.js";
import { formEncode, verifyStripeSignature } from "./providers/stripe.js";
import { readRawBody } from "./providers/rawBody.js";
import { notifyAdmin } from "./adminAlerts.js";
import { creditCommission, pushPendingCredit, ownerUidOf } from "./referrals.js";
import { billWaUsage } from "./waBilling.js";

const storeLabel = (m, mid) => m?.store_name || m?.shopify_shop || m?.email || mid;

const API = "https://api.stripe.com";
export const saasStripeAvailable = () => !!String(process.env.STRIPE_SAAS_SECRET_KEY || "").trim();

async function stripe(method, path, params) {
  const key = String(process.env.STRIPE_SAAS_SECRET_KEY || "").trim();
  if (!key) throw new Error("Stripe (SaaS) no está configurado: falta STRIPE_SAAS_SECRET_KEY");
  const headers = { Authorization: `Bearer ${key}` };
  let url = `${API}${path}`, body;
  if (params && (method === "GET" || method === "DELETE")) { const qs = formEncode(params).toString(); if (qs) url += `?${qs}`; }
  else if (params) { headers["Content-Type"] = "application/x-www-form-urlencoded"; body = formEncode(params).toString(); }
  const r = await fetch(url, { method, headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(data?.error?.message || `Stripe HTTP ${r.status}`); e.status = r.status; e.code = data?.error?.code || null; throw e; }
  return data;
}

// Precio mensual por tramo, creado una vez y cacheado en system/stripe_saas_prices.
// `merchant` entra para respetar su `legacy_pricing`: las tiendas anteriores al
// aumento del 22-sept pagan la mitad. El precio de Stripe se cachea por monto,
// así que conviven el de lista y el heredado sin pisarse.
async function ensurePrice(tierId, merchant) {
  const tier = TIER_BY_ID[tierId];
  if (!tier || !tier.usd) throw new Error(`Tramo inválido: ${tierId}`);
  const usd = tierPriceFor(tier, merchant);
  if (!usd) throw new Error(`Precio en 0 para ${tierId}`);
  const ref = db().collection("system").doc("stripe_saas_prices");
  const snap = await ref.get();
  const cache = snap.exists ? (snap.data() || {}) : {};
  const mode = /^sk_test_/.test(String(process.env.STRIPE_SAAS_SECRET_KEY || "")) ? "test" : "live";
  const key = `${mode}:${tierId}:${usd}`;
  if (cache[key]) return cache[key];
  const nombre = usd === tier.usd ? `Recurrentes · ${tier.label}` : `Recurrentes · ${tier.label} (precio anterior)`;
  const product = await stripe("POST", "/v1/products", { name: nombre, metadata: { tier: tierId, app: "recurrentes" } });
  const price = await stripe("POST", "/v1/prices", { product: product.id, currency: "usd", unit_amount: usd * 100, recurring: { interval: "month" }, metadata: { tier: tierId, usd: String(usd) } });
  await ref.set({ [key]: price.id }, { merge: true });
  return price.id;
}

const base = (origin) => (String(origin || "").startsWith(appBaseUrl()) ? origin : appBaseUrl()).replace(/\/$/, "");

export async function createSaasCheckout({ merchantId, merchant, tierId, email, returnOrigin }) {
  const price = await ensurePrice(tierId, merchant);
  const b = base(returnOrigin);
  const params = {
    mode: "subscription",
    "line_items[0][price]": price, "line_items[0][quantity]": 1,
    client_reference_id: merchantId,
    success_url: `${b}/#/config/facturacion?saas=ok`,
    cancel_url: `${b}/#/config/facturacion?saas=cancel`,
    allow_promotion_codes: "true",
    metadata: { merchant_id: merchantId, tier: tierId },
    "subscription_data[metadata][merchant_id]": merchantId,
    "subscription_data[metadata][tier]": tierId,
    "subscription_data[description]": `Plan ${TIER_BY_ID[tierId].label} de Recurrentes · ${merchant.store_name || merchant.shopify_shop || merchantId}`,
  };
  if (merchant.saas_stripe_customer_id) params.customer = merchant.saas_stripe_customer_id;
  else if (email) params.customer_email = email;
  const session = await stripe("POST", "/v1/checkout/sessions", params);
  return session.url;
}

// Tarjeta sin plan (Thiago, 18-sept): Checkout de Stripe en modo "setup". Al completarse, el
// webhook guarda el customer + la tarjeta como default y factura el uso de WhatsApp pendiente.
export async function createWaCardSetup({ merchantId, merchant, email, returnOrigin }) {
  const b = base(returnOrigin);
  const params = {
    mode: "setup",
    "payment_method_types[0]": "card",
    client_reference_id: merchantId,
    success_url: `${b}/#/dashboard/whatsapp?tarjeta=ok`,
    cancel_url: `${b}/#/dashboard/whatsapp?tarjeta=cancel`,
    "metadata[merchant_id]": merchantId, "metadata[kind]": "wa_card",
  };
  if (merchant.saas_stripe_customer_id) params.customer = merchant.saas_stripe_customer_id;
  else if (email) params.customer_email = email;
  const session = await stripe("POST", "/v1/checkout/sessions", params);
  return session.url;
}

export async function createSaasPortal({ merchant, returnOrigin }) {
  const s = await stripe("POST", "/v1/billing_portal/sessions", { customer: merchant.saas_stripe_customer_id, return_url: `${base(returnOrigin)}/#/config/facturacion` });
  return s.url;
}

// Deja la tienda con el plan activo después del primer pago (Checkout o suscripción directa):
// campos del merchant, aviso admin, comisión de afiliados y facturación del WhatsApp pendiente.
async function activatePlan({ mid, sub, subId, customer, tier, key, now = new Date().toISOString() }) {
  const ref = db().collection("merchants").doc(mid);
  const cur = (await ref.get()).data() || {};
  await ref.set({
    saas_stripe_customer_id: customer, saas_stripe_subscription_id: subId, saas_stripe_price_tier: tier,
    saas_status: "active", saas_last_paid_at: now, saas_current_period_end: tsIso(sub?.current_period_end),
    plan_activated: tier || cur.plan_activated || null, plan_activated_at: cur.plan_activated_at || now,
    plan_requested: null, plan_requested_at: null,
  }, { merge: true });
  // Adquisición: primer pago → Purchase (US$ del tramo) a NUESTRO pixel, una sola vez.
  try { const { trackAcquisition } = await import("./acquisition.js"); await trackAcquisition(mid, "paid", { value: TIER_BY_ID[tier]?.usd, tier }); } catch (_) {}
  // Ramal admin: alguien pagó el plan por primera vez.
  await notifyAdmin("plan_paid", { merchantId: mid, store: storeLabel(cur, mid), detail: `${TIER_BY_ID[tier]?.label || tier || "plan"} · USD ${TIER_BY_ID[tier]?.usd ?? "?"} · primer pago`, key });
  // Afiliados: comisión al referente del dueño, y si el que paga tenía crédito
  // pendiente propio, ya tiene customer en Stripe → se empuja como saldo.
  await creditCommission({ mid, merchant: cur, tierId: tier, key, kind: "primer_pago", stripeCall: stripe });
  const payerUid = ownerUidOf(mid, cur);
  if (payerUid !== mid) await db().collection("merchants").doc(payerUid).set({ saas_stripe_customer_id: customer }, { merge: true }).catch(() => {});
  await pushPendingCredit(payerUid, stripe);
  // WhatsApp: meses cerrados sin facturar → ítems de la próxima factura; y si estaba
  // pausado por el tope del plan gratis, se destraba.
  await billWaUsage(mid, { ...cur, saas_stripe_customer_id: customer, saas_stripe_subscription_id: subId }, stripe).catch(e => console.warn("[saas] wa usage:", e.message));
}

// Con tarjeta ya guardada (la cargó para WhatsApp, o pagó antes): activar el plan en UN clic,
// sin pasar por Checkout (Thiago, 18-sept: "como una persona normal que pasó los 10").
// → { activated:true, tier } | null (sin tarjeta guardada → el llamador abre Checkout).
// Si la tarjeta rebota, Stripe responde error y esto LANZA: el llamador cae a Checkout.
export async function createSaasSubscriptionWithCard({ merchantId, merchant, tierId }) {
  const customer = merchant?.saas_stripe_customer_id;
  if (!customer || merchant?.saas_stripe_subscription_id) return null;
  const c = await stripe("GET", `/v1/customers/${customer}`).catch(() => null);
  const pm = idOf(c?.invoice_settings?.default_payment_method) || idOf(c?.default_source);
  if (!pm) return null;
  const price = await ensurePrice(tierId, merchant);
  const sub = await stripe("POST", "/v1/subscriptions", {
    customer, "items[0][price]": price, default_payment_method: pm,
    payment_behavior: "error_if_incomplete",
    "metadata[merchant_id]": merchantId, "metadata[tier]": tierId,
    description: `Plan ${TIER_BY_ID[tierId].label} de Recurrentes · ${merchant.store_name || merchant.shopify_shop || merchantId}`,
  });
  await activatePlan({ mid: merchantId, sub, subId: sub.id, customer, tier: tierId, key: `sub_${sub.id}` });
  return { activated: true, tier: tierId, subscription_id: sub.id };
}

// ─── Webhook /api/public?action=stripe-saas-webhook ─────────────────────────
const tsIso = (sec) => (Number.isFinite(Number(sec)) && Number(sec) > 0 ? new Date(Number(sec) * 1000).toISOString() : null);
const idOf = (v) => (v && typeof v === "object" ? v.id : v) || null;

async function merchantBySubscription(subId) {
  if (!subId) return null;
  const q = await db().collection("merchants").where("saas_stripe_subscription_id", "==", String(subId)).limit(1).get();
  return q.empty ? null : q.docs[0];
}
async function tierOfSubscription(sub) {
  const fromMeta = sub?.metadata?.tier;
  if (TIER_BY_ID[fromMeta]) return fromMeta;
  const price = sub?.items?.data?.[0]?.price;
  if (TIER_BY_ID[price?.metadata?.tier]) return price.metadata.tier;
  return null;
}

export async function handleSaasWebhook(req, res) {
  const secret = String(process.env.STRIPE_SAAS_WEBHOOK_SECRET || "").trim();
  if (!secret) return res.status(503).json({ error: "webhook no configurado" });
  let raw;
  try { raw = await readRawBody(req); } catch (e) { return res.status(400).json({ error: "body" }); }
  const sig = verifyStripeSignature(raw, req.headers["stripe-signature"], secret);
  if (!sig.ok) { console.warn("[saas-webhook] firma inválida:", sig.reason); return res.status(400).json({ error: "firma inválida" }); }
  let event; try { event = JSON.parse(raw.toString("utf8")); } catch (_) { return res.status(400).json({ error: "json" }); }
  const now = new Date().toISOString();
  const obj = event.data?.object || {};
  try {
    // Idempotencia por evento.
    const evRef = db().collection("system").doc("stripe_saas_events").collection("seen").doc(String(event.id || ""));
    if (event.id) { const seen = await evRef.get(); if (seen.exists) return res.json({ ok: true, dup: true }); await evRef.set({ type: event.type, at: now }); }

    if (event.type === "checkout.session.completed" && obj.mode === "subscription") {
      const mid = obj.client_reference_id || obj.metadata?.merchant_id;
      if (mid) {
        const subId = idOf(obj.subscription);
        const sub = subId ? await stripe("GET", `/v1/subscriptions/${subId}`) : null;
        const tier = (await tierOfSubscription(sub)) || obj.metadata?.tier || null;
        await activatePlan({ mid: String(mid), sub, subId, customer: idOf(obj.customer), tier, key: `cs_${obj.id || event.id}`, now });
      }
    } else if (event.type === "checkout.session.completed" && obj.mode === "setup") {
      // Tarjeta cargada sin plan (createWaCardSetup): default del customer + facturar WhatsApp pendiente.
      const mid = obj.client_reference_id || obj.metadata?.merchant_id;
      const customer = idOf(obj.customer);
      if (mid && customer) {
        const siId = idOf(obj.setup_intent);
        const si = siId ? await stripe("GET", `/v1/setup_intents/${siId}`).catch(() => null) : null;
        const pm = idOf(si?.payment_method);
        if (pm) await stripe("POST", `/v1/customers/${customer}`, { "invoice_settings[default_payment_method]": pm }).catch(e => console.warn("[saas-webhook] default pm:", e.message));
        const ref = db().collection("merchants").doc(String(mid));
        const cur = (await ref.get()).data() || {};
        await ref.set({ saas_stripe_customer_id: customer, wa_card_on_file: true, wa_card_added_at: now }, { merge: true });
        await billWaUsage(String(mid), { ...cur, saas_stripe_customer_id: customer }, stripe).catch(e => console.warn("[saas-webhook] wa usage (tarjeta):", e.message));
      }
    } else if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
      const subId = idOf(obj.subscription) || idOf(obj.parent?.subscription_details?.subscription);
      const doc = await merchantBySubscription(subId);
      if (doc) {
        const line = obj.lines?.data?.[0];
        const tier = TIER_BY_ID[line?.price?.metadata?.tier] ? line.price.metadata.tier : (doc.data().saas_stripe_price_tier || doc.data().plan_activated);
        await doc.ref.set({ saas_status: "active", saas_last_paid_at: tsIso(obj.status_transitions?.paid_at) || now, saas_current_period_end: tsIso(line?.period?.end), plan_activated: tier || null, saas_last_invoice_url: obj.hosted_invoice_url || null }, { merge: true });
        // Ramal admin: cobro del plan (primer pago o renovación). Dedup por factura.
        if (obj.billing_reason !== "subscription_create") {
          await notifyAdmin("plan_paid", { merchantId: doc.id, store: storeLabel(doc.data(), doc.id), detail: `Renovación ${TIER_BY_ID[tier]?.label || tier || ""} · USD ${Math.round((Number(obj.amount_paid) || 0) / 100)}`, key: `in_${obj.id || event.id}` });
          // Afiliados: cada renovación también comisiona (15% del precio de lista, para siempre).
          await creditCommission({ mid: doc.id, merchant: doc.data(), tierId: tier, key: `in_${obj.id || event.id}`, kind: "renovacion", stripeCall: stripe });
        }
      }
    } else if (event.type === "invoice.payment_failed") {
      const subId = idOf(obj.subscription) || idOf(obj.parent?.subscription_details?.subscription);
      const doc = await merchantBySubscription(subId);
      if (doc) {
        await doc.ref.set({ saas_status: "past_due", saas_payment_failed_at: now }, { merge: true });
        // Ramal admin: le rebotó la tarjeta del plan (Stripe reintenta solo; con 16+ vuelve a la regla por cantidad).
        await notifyAdmin("plan_past_due", { merchantId: doc.id, store: storeLabel(doc.data(), doc.id), detail: `Stripe rechazó el cobro del plan · USD ${Math.round((Number(obj.amount_due) || 0) / 100)} · reintenta solo`, key: `in_${obj.id || event.id}` });
      }
    } else if (event.type === "customer.subscription.updated") {
      const doc = await merchantBySubscription(obj.id);
      if (doc) await doc.ref.set({ saas_current_period_end: tsIso(obj.current_period_end), saas_cancel_at_period_end: !!obj.cancel_at_period_end, saas_stripe_price_tier: (await tierOfSubscription(obj)) || doc.data().saas_stripe_price_tier || null }, { merge: true });
    } else if (event.type === "customer.subscription.deleted") {
      const doc = await merchantBySubscription(obj.id);
      if (doc) {
        // Si canceló a mitad de período (Stripe la borró ya), lo que pagó sigue valiendo
        // hasta el fin del período: plan_activated queda y saasPaid mira saas_paid_until.
        // El cron sync-saas-tiers lo limpia cuando vence.
        const endMs = Number(obj.current_period_end) * 1000;
        const paidUntil = Number.isFinite(endMs) && endMs > Date.now() + 60000 ? new Date(endMs).toISOString() : null;
        await doc.ref.set({ saas_status: "cancelled", saas_cancelled_at: now, saas_stripe_subscription_id: null, saas_current_period_end: null, saas_paid_until: paidUntil, ...(paidUntil ? {} : { plan_activated: null }) }, { merge: true });
        // WhatsApp: se factura todo lo pendiente (mes en curso incluido) ahora mismo.
        await billWaUsage(doc.id, doc.data(), stripe, { includeCurrent: true, finalizeNow: true }).catch(e => console.warn("[saas-webhook] wa usage final:", e.message));
        // Ramal admin: se dio de baja del plan.
        await notifyAdmin("plan_cancelled", { merchantId: doc.id, store: storeLabel(doc.data(), doc.id), detail: "Baja de la suscripción al plan en Stripe", key: `sub_${obj.id}` });
      }
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error("[saas-webhook]", event.type, e.message);
    return res.status(500).json({ error: e.message });
  }
}

// ─── Cron diario: alinear el precio de cada suscripción con el tramo actual ───
// Sin prorrateo: la próxima factura sale por el tramo vigente ese día.
export async function syncSaasTiers({ countActive }) {
  if (!saasStripeAvailable()) return { skipped: "no_stripe" };
  // Cancelados cuyo período pagado ya venció: recién ahora pierden el plan.
  try {
    const exp = await db().collection("merchants").where("saas_status", "==", "cancelled").where("saas_paid_until", "<=", new Date().toISOString()).get();
    for (const d of exp.docs) if (d.data().plan_activated) await d.ref.set({ plan_activated: null, saas_paid_until: null }, { merge: true });
  } catch (e) { console.warn("[sync-saas-tiers] vencidos:", e.message); }
  const q = await db().collection("merchants").where("saas_status", "in", ["active", "past_due"]).get();
  const out = { checked: 0, changed: 0, to_free: 0, errors: 0 };
  for (const d of q.docs) {
    const m = d.data(); const subId = m.saas_stripe_subscription_id;
    if (!subId || m.archived_at || m.deleted) continue;
    out.checked++;
    try {
      const n = await countActive(d.id, m);
      const tier = tierFor(n);
      const current = m.saas_stripe_price_tier || m.plan_activated || null;
      if (tier.usd === 0) {
        if (!m.saas_cancel_at_period_end) { await stripe("POST", `/v1/subscriptions/${subId}`, { cancel_at_period_end: "true" }); await d.ref.set({ saas_cancel_at_period_end: true }, { merge: true }); out.to_free++; }
        continue;
      }
      if (tier.id === current && !m.saas_cancel_at_period_end) continue;
      const sub = await stripe("GET", `/v1/subscriptions/${subId}`);
      const item = sub.items?.data?.[0];
      if (!item) continue;
      const price = await ensurePrice(tier.id, m);
      await stripe("POST", `/v1/subscriptions/${subId}`, { "items[0][id]": item.id, "items[0][price]": price, proration_behavior: "none", cancel_at_period_end: "false", "metadata[tier]": tier.id });
      await d.ref.set({ saas_stripe_price_tier: tier.id, saas_cancel_at_period_end: false, saas_tier_synced_at: new Date().toISOString() }, { merge: true });
      out.changed++;
    } catch (e) { out.errors++; console.warn("[sync-saas-tiers]", d.id, e.message); }
  }
  return out;
}
// Para módulos que necesitan hablar con Stripe sin importar todo esto (referrals.js recibe esta función).
export const stripeRequest = stripe;
