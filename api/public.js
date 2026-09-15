// /api/public — endpoint PÚBLICO consolidado (sin auth Firebase).
//
// Combina dos endpoints previos (plan.js + sub.js) en un solo archivo para
// quedar dentro del límite de 12 funciones serverless del plan Hobby de
// Vercel. El router interno discrimina por `?action=`.
//
//   GET  ?action=plan&merchant=<uid>&product=<shopify_product_id>[&variant=<id>][&plan=<planId>]
//        → devuelve el plan ACTIVO para ese producto (prioriza el de la variante).
//          `plan=<id>` tiene prioridad (embed del checkout con ?plan=&pack=): se
//          valida que exista bajo el merchant y esté activo; si no, cae a product/variant.
//          Incluye pricing_mode / packs / frequency_scales_with_qty (ver shared/bundle/SPEC.md).
//
//   GET  ?action=sub&token=<JWT>
//        → detalle de la sub + historial de cargos (customer portal).
//
//   POST ?action=sub&token=<JWT>  body { action: "pause"|"resume"|"cancel",
//                                        reason_code?, reason?, comment? }
//        → pause / resume / cancel desde el portal del cliente. En cancel, el motivo
//          se guarda en el sub (cancel_reason_code/cancel_reason/cancel_comment) y en
//          merchants/{mid}/cancellations/{subId}.
//
//   POST ?action=pause-offer&token=<JWT>  body { cycles: 1..3 }
//        → oferta de retención: pausa la sub N ciclos (MP status paused) y guarda
//          resume_at; el cron la reactiva sola al vencer. Marca retention_saved.
//
//   POST ?action=update-address&token=<JWT>  body { shipping_address, customer_phone }
//        → el cliente actualiza su dirección/teléfono desde el portal.
//
//   GET  ?action=discount&merchant=<uid>&code=<X>   ó   &rc=<token de recupero>
//        → valida un código de descuento (preview; el real se aplica en checkout/init).
//
//   GET|POST ?action=unsub&t=<token {m,e}>
//        → baja de mails de marketing (link del footer / List-Unsubscribe one-click).
//
//   GET|POST ?action=wa-webhook[&merchant=<id>]
//        → webhook de WhatsApp Cloud API (verificación de Meta, estados de entrega y
//          respuestas "BAJA"). Firma X-Hub-Signature-256. Ver _lib/whatsappWebhook.js.
//
// Seguridad: las acciones de sub validan un token firmado HMAC (token.js, secreto
// de config.signingSecret(), sin fallback hardcodeado). Se mantiene la verificación
// de tokens legacy firmados con MP_WEBHOOK_SECRET (compare timing-safe).
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./_lib/firebase.js";
import { retentionFor, RETENTION_REASON_CODES, RETENTION_MAX_PAUSE_CYCLES } from "./_lib/retention.js";
import { mpUpdatePreapproval, mpGetPreapproval } from "./_lib/mp.js";
import { signToken, verifyToken, timingSafeEqualStr } from "./_lib/token.js";
import { signingSecret } from "./_lib/config.js";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";
import { setUnsubscribed } from "./_lib/unsub.js";
import { emailSubscriptionCancelled } from "./_lib/email.js";
import { logEmail } from "./_lib/emaillog.js";
import { planPacks, planPricingMode } from "./_lib/packs.js";
import { klaviyoEnabled, klaviyoLifecycle, KLAVIYO_METRICS } from "./_lib/klaviyo.js";
import { emitFlowEvent } from "./_lib/flows.js";
import { handleWhatsappWebhook } from "./_lib/whatsappWebhook.js";
import { merchantProfile } from "../shared/platform/profile.js";

// Tokens viejos (portal / back_url de MP ya emitidos) se firmaron con
// MP_WEBHOOK_SECRET aunque hubiera PORTAL_SECRET. Si el secreto vigente es otro,
// probamos también con el legacy para no romper links ya enviados.
function verifyLegacyPortalToken(token) {
  const legacy = process.env.MP_WEBHOOK_SECRET || "";
  let current = "";
  try { current = signingSecret(); } catch (_) { return null; }
  if (!legacy || legacy === current) return null;
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const calc = crypto.createHmac("sha256", legacy).update(body).digest("base64url");
  if (!timingSafeEqualStr(calc, sig)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (_) { return null; }
}

export function verifyPortalToken(token) {
  const t = String(token || "");
  const p = verifyToken(t) || verifyLegacyPortalToken(t);
  return p && p.mid && p.sid ? p : null;
}

// Generador exportable — lo usa checkout/init para armar el back_url con el portal token.
export function generatePortalToken(merchantId, subscriberId, ttlDays = 180) {
  return signToken({ mid: merchantId, sid: subscriberId }, ttlDays * 86400);
}

// URL pública de la tienda ("Volver a la tienda"): dominio primario cacheado en
// merchant.shopify_domains (no myshopify) o el myshopify. La usa también checkout/init.
const normHost = (h) => String(h || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
export function merchantStoreUrl(merchant) {
  const list = Array.isArray(merchant?.shopify_domains) ? merchant.shopify_domains : [];
  const primary = list.find(d => d && !/\.myshopify\.com$/i.test(d)) || list[0] || merchant?.shopify_shop || "";
  return primary ? `https://${normHost(primary)}` : null;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "");
  if (action === "plan") return handlePlan(req, res);
  if (action === "sub")  return handleSub(req, res);
  if (action === "discount") return handleDiscount(req, res);
  if (action === "unsub") return handleUnsub(req, res);
  if (action === "update-address") return handleUpdateAddress(req, res);
  if (action === "pause-offer") return handlePauseOffer(req, res);
  if (action === "wa-webhook") return handleWhatsappWebhook(req, res);
  return res.status(400).json({ error: "action debe ser plan | sub | discount | unsub | update-address | pause-offer" });
}

// ─── action=unsub ───────────────────────────────────────────────
// t = token firmado con payload { m: merchantId, e: email }. GET (link del
// footer) o POST (List-Unsubscribe-Post one-click). Responde HTML mínimo.
async function handleUnsub(req, res) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).send("Method not allowed");
  const p = verifyToken(String(req.query.t || ""));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const page = (msg) => `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Baja de emails</title></head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;padding:40px 20px;text-align:center;color:#1a1a1a;"><p style="font-size:16px;">${msg}</p></body></html>`;
  if (!p || !p.m || !p.e) return res.status(400).send(page("El link de baja no es válido o venció."));
  try {
    await setUnsubscribed(String(p.m), String(p.e), "link");
    return res.status(200).send(page("Listo, no te vamos a mandar más mails de esta tienda."));
  } catch (e) {
    console.error("[public/unsub] error:", e.message);
    return res.status(500).send(page("No pudimos procesar la baja. Intentá de nuevo más tarde."));
  }
}

// ─── action=discount ───────────────────────────────────────────
// Valida un código de descuento del comerciante (merchant.discount_codes).
// Público: lo llama el checkout cuando el cliente tipea un código. Devuelve
// solo si es válido + su valor; el descuento REAL se re-valida y aplica en
// checkout/init (server-side), así nadie puede falsear el precio.
//  · `rc` = token de recupero firmado {m, e, c}: habilita códigos `recovery_only`.
//  · Los códigos `recovery_only` NO se aceptan por ?code= en claro.
async function handleDiscount(req, res) {
  const merchantId = String(req.query.merchant || "");
  let code = String(req.query.code || "").trim().toUpperCase().slice(0, 40);
  const rcRaw = String(req.query.rc || "");
  if (!merchantId || (!code && !rcRaw)) return res.status(400).json({ error: "Faltan merchant o code" });
  const rl = await rateLimit(`discount:${merchantId}:${clientIp(req)}`, { limit: 30, windowSec: 3600 });
  if (!rl.ok) return res.status(429).json({ valid: false, error: "Demasiados intentos. Esperá unos minutos." });
  let viaRecovery = false;
  if (rcRaw) {
    const rc = verifyToken(rcRaw);
    if (!rc || rc.m !== merchantId || !rc.c) return res.json({ valid: false, error: "El link de recupero venció." });
    code = String(rc.c).trim().toUpperCase().slice(0, 40);
    viaRecovery = true;
  }
  try {
    const snap = await db().collection("merchants").doc(merchantId).get();
    if (!snap.exists) return res.json({ valid: false });
    const codes = Array.isArray(snap.data().discount_codes) ? snap.data().discount_codes : [];
    const hit = codes.find(c => String(c.code || "").trim().toUpperCase() === code && c.active !== false);
    if (!hit || (hit.recovery_only && !viaRecovery)) return res.json({ valid: false });
    return res.json({ valid: true, code, type: hit.type || "percent", value: parseFloat(hit.value) || 0, first_charge_only: hit.first_charge_only === true });
  } catch (e) {
    console.error("[public/discount] error:", e.message);
    return res.status(500).json({ error: "No se pudo validar el código" });
  }
}

// ─── action=plan ───────────────────────────────────────────────
async function handlePlan(req, res) {
  const merchantId = String(req.query.merchant || "");
  const productId = String(req.query.product || "");
  const variantId = String(req.query.variant || "");
  const planId = String(req.query.plan || "").trim().slice(0, 80);
  if (!merchantId || (!productId && !planId)) {
    return res.status(400).json({ error: "Faltan merchant o product" });
  }
  try {
    const col = db().collection("merchants").doc(merchantId).collection("plans");
    let doc = null;
    // 1) plan por id (pertenece al merchant por estar bajo su subcolección) y activo.
    if (planId && /^[A-Za-z0-9_-]+$/.test(planId)) {
      const ds = await col.doc(planId).get();
      if (ds.exists && ds.data().active === true) doc = ds;
      else console.warn("[public/plan] plan por id no disponible:", { merchantId, planId, exists: ds.exists });
    }
    // 2) el plan de la variante exacta; si no hay, el del producto.
    if (!doc && variantId) {
      const qv = await col.where("shopify_variant_id", "==", variantId).where("active", "==", true).limit(1).get();
      if (!qv.empty) doc = qv.docs[0];
    }
    if (!doc && productId) {
      const q = await col.where("shopify_product_id", "==", productId).where("active", "==", true).limit(1).get();
      if (!q.empty) doc = q.docs[0];
    }
    if (!doc) return res.json({ plan: null });
    const data = doc.data();
    // ?checkout=1 (checkout hosteado #/checkout): qué datos pedir según el perfil del
    // negocio. Solo en ese caso leemos el merchant (el widget de producto no lo necesita).
    let checkout;
    if (String(req.query.checkout || "") === "1") {
      const mSnap = await db().collection("merchants").doc(merchantId).get();
      const m = mSnap.exists ? mSnap.data() : {};
      const p = merchantProfile(m);
      checkout = {
        business_type: p.businessType,
        channel: p.channel,
        ask_address: p.caps.requireAddress,
        require_phone: p.caps.requirePhone,
        require_tax_id: p.caps.requireTaxId,
        shipping_from_store: p.channel === "shopify",
        provider: p.paymentProvider,
        provider_label: p.providerInfo.label,
        currency: p.currency,
        store_name: m.store_name || m.shop_name || m.email_brand || "",
        color: /^#[0-9a-fA-F]{6}$/.test(String(m.widget_color || "")) ? m.widget_color : "#10b981",
        shipping_rates: p.caps.shipping && Array.isArray(m.checkout_shipping_rates) ? m.checkout_shipping_rates : [],
        vocab: p.vocab,
      };
    }
    return res.json({
      ...(checkout ? { checkout } : {}),
      plan: {
        id: doc.id,
        shopify_product_id: data.shopify_product_id,
        shopify_variant_id: data.shopify_variant_id,
        product_title: data.product_title,
        product_image: data.product_image || null,
        frequency_days: data.frequency_days,
        // Packs (bundle): el widget/embed renderiza el selector y manda pack_index.
        pricing_mode: planPricingMode(data),
        packs: planPacks(data),
        frequency_scales_with_qty: data.frequency_scales_with_qty !== false,
        // El checkout sólo respeta una frecuencia custom de la URL si el plan lo permite.
        allow_custom_frequency: data.allow_custom_frequency === true,
        discount_pct: data.discount_pct,
        units_per_shipment: data.units_per_shipment,
        base_price_ars: data.base_price_ars,
        subscription_price_ars: data.subscription_price_ars,
        // Nuevos: envío y descuentos por cantidad — el widget los usa para
        // recalcular total en vivo cuando el cliente cambia qty.
        shipping_price_ars: data.shipping_price_ars || 0,
        free_shipping_from_ars: data.free_shipping_from_ars || 0,
        shipping_method_name: data.shipping_method_name || "Envío a domicilio",
        qty_discount_tiers: Array.isArray(data.qty_discount_tiers) ? data.qty_discount_tiers : [],
      },
    });
  } catch (e) {
    console.error("[public/plan] error:", e.message);
    return res.status(500).json({ error: "No se pudo cargar el plan" });
  }
}

// ─── action=update-address ─────────────────────────────────────
// El cliente cambia su dirección de envío / teléfono desde el portal. Mismas
// validaciones que el checkout (address1, city, province, zip, phone).
async function handleUpdateAddress(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.query.token || req.body?.token;
  const payload = verifyPortalToken(String(token || ""));
  if (!payload) return res.status(403).json({ error: "Token inválido o expirado" });
  const { mid: merchantId, sid: subscriberId } = payload;
  const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return res.status(404).json({ error: "Suscripción no encontrada" });
  const sub = subSnap.data();
  try {
    const m = (await db().collection("merchants").doc(merchantId).get()).data() || {};
    if (m.portal?.allow_address === false) return res.status(403).json({ error: "Esta tienda no permite cambiar la dirección desde el portal. Escribile a la tienda." });
  } catch (_) {}

  const addr = (req.body && typeof req.body.shipping_address === "object" && req.body.shipping_address) || {};
  const phone = String(req.body?.customer_phone ?? sub.customer_phone ?? "").trim().slice(0, 40);
  const missing = [];
  if (!String(addr.address1 || "").trim()) missing.push("calle + número");
  if (!String(addr.city || "").trim()) missing.push("ciudad");
  if (!String(addr.province || "").trim()) missing.push("provincia");
  if (!String(addr.zip || "").trim()) missing.push("código postal");
  if (!phone) missing.push("teléfono");
  if (missing.length) return res.status(400).json({ error: `Falta: ${missing.join(", ")}.` });
  if (!/\d/.test(String(addr.address1))) return res.status(400).json({ error: "La dirección tiene que tener calle y número." });

  const prev = sub.shipping_address || {};
  const shipping_address = {
    address1:   String(addr.address1).trim().slice(0, 250),
    address2:   String(addr.address2 ?? prev.address2 ?? "").trim().slice(0, 250),
    city:       String(addr.city).trim().slice(0, 120),
    province:   String(addr.province).trim().slice(0, 120),
    zip:        String(addr.zip).trim().slice(0, 20),
    country:    String(addr.country || prev.country || "Argentina").trim().slice(0, 60),
    first_name: prev.first_name || String(sub.customer_name || "").split(" ")[0] || "",
    last_name:  prev.last_name || String(sub.customer_name || "").split(" ").slice(1).join(" ") || "",
    phone,
  };
  await subRef.update({ shipping_address, customer_phone: phone, updated_at: new Date().toISOString() });
  return res.json({ ok: true, shipping_address, customer_phone: phone });
}

// ─── action=sub ────────────────────────────────────────────────
async function handleSub(req, res) {
  const token = req.query.token || req.body?.token;
  const payload = verifyPortalToken(String(token || ""));
  if (!payload) return res.status(403).json({ error: "Token inválido o expirado" });

  const { mid: merchantId, sid: subscriberId } = payload;
  const subRef = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);

  if (req.method === "GET") {
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Suscripción no encontrada" });
    const sub = subSnap.data();
    const chargesSnap = await db().collection("merchants").doc(merchantId).collection("charges")
      .where("subscriber_id", "==", subscriberId).get();
    const charges = chargesSnap.docs
      .map(d => ({ id: d.id, amount_ars: d.data().amount_ars, status: d.data().status, created_at: d.data().created_at }))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    let storeUrl = null, merchant = null;
    try { const m = await db().collection("merchants").doc(merchantId).get(); merchant = m.exists ? m.data() : null; storeUrl = merchantStoreUrl(merchant); } catch (_) {}
    return res.json({
      sub: {
        id: subscriberId,
        status: sub.status,
        customer_email: sub.customer_email,
        customer_name: sub.customer_name,
        customer_phone: sub.customer_phone || null,
        plan_snapshot: sub.plan_snapshot,
        shipping_address: sub.shipping_address,
        quantity: sub.quantity || null,
        next_charge_at: sub.next_charge_at || null,
        last_charge_at: sub.last_charge_at || null,
        created_at: sub.created_at,
        shopify_orders_count: Array.isArray(sub.shopify_orders) ? sub.shopify_orders.length : 0,
        // URL pública de Thank You de Shopify — CheckoutSuccess.jsx hace
        // polling acá y redirige al cliente cuando la orden ya fue creada.
        shopify_order_status_url: sub.last_shopify_order_status_url || null,
        // Pausa por oferta de retención: fecha en que el cron la reactiva sola.
        resume_at: sub.resume_at || null,
        cancel_reason_code: sub.cancel_reason_code || null,
      },
      charges,
      merchant_store_url: storeUrl,
      merchant_brand: (merchant && (merchant.email_brand || merchant.store_name || merchant.shop_name || merchant.displayName)) || null,
      // Config de retención (motivos + si se ofrece pausa) para el modal de cancelar.
      retention: retentionFor(merchant),
      // Qué puede hacer el cliente desde el portal + mensaje de bienvenida.
      portal: {
        allow_pause: merchant?.portal?.allow_pause !== false,
        allow_cancel: merchant?.portal?.allow_cancel !== false,
        allow_address: merchant?.portal?.allow_address !== false,
      },
      portal_welcome: merchant?.portal_welcome || "",
      // Perfil del negocio: la pantalla de gracias y el portal adaptan los textos
      // (envío vs cuota, "Volver a la tienda" solo si hay tienda).
      business: (() => {
        const p = merchantProfile(merchant || {});
        return { type: p.businessType, channel: p.channel, shipping: p.caps.shipping, provider_label: p.providerInfo.label, vocab: p.vocab };
      })(),
    });
  }

  if (req.method === "POST") {
    const { action: subAction } = req.body || {};
    if (!["pause", "resume", "cancel"].includes(subAction)) {
      return res.status(400).json({ error: "action debe ser pause | resume | cancel" });
    }
    // Motivo de cancelación (opcional): reason_code ∈ RETENTION_REASON_CODES,
    // reason ≤ 120, comment ≤ 500. Un código inválido se descarta (no rompe la baja).
    const rcRaw = String(req.body?.reason_code || "").trim();
    const cancelReason = String(req.body?.reason || "").trim().slice(0, 120) || null;
    const cancelComment = String(req.body?.comment || "").trim().slice(0, 500) || null;
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Suscripción no encontrada" });
    const sub = subSnap.data();

    const merchantSnap = await db().collection("merchants").doc(merchantId).get();
    const merchant = merchantSnap.data() || {};
    // Acciones que el comerciante deshabilitó en Portal del cliente.
    const perms = merchant.portal || {};
    if (subAction === "pause" && perms.allow_pause === false) return res.status(403).json({ error: "Esta tienda no permite pausar desde el portal. Escribile a la tienda." });
    if (subAction === "cancel" && perms.allow_cancel === false) return res.status(403).json({ error: "Esta tienda no permite cancelar desde el portal. Escribile a la tienda." });
    // Motivo válido = uno de los configurados por la tienda (o "otro"); si no, se descarta.
    const validCodes = new Set([...retentionFor(merchant).reasons.map(r => r.code), "otro"]);
    const cancelReasonCode = validCodes.has(rcRaw) ? rcRaw : null;
    if (!merchant.mp_access_token || !sub.mp_preapproval_id) {
      return res.status(400).json({ error: "Faltan credenciales para gestionar la suscripción" });
    }

    const mpStatusMap = { pause: "paused", resume: "authorized", cancel: "cancelled" };
    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: mpStatusMap[subAction] });
    } catch (e) {
      console.error("[public/sub] MP update falló:", subAction, e.message);
      return res.status(502).json({ error: "No pudimos actualizar la suscripción en Mercado Pago. Intentá de nuevo en unos minutos." });
    }

    const localStatus = subAction === "cancel" ? "cancelled" : subAction === "pause" ? "paused" : "active";
    const now = new Date().toISOString();
    const update = {
      status: localStatus,
      updated_at: now,
      ...(subAction === "cancel" ? {
        cancelled_at: now, cancelled_by: "customer",
        ...(cancelReasonCode ? { cancel_reason_code: cancelReasonCode } : {}),
        ...(cancelReason ? { cancel_reason: cancelReason } : {}),
        ...(cancelComment ? { cancel_comment: cancelComment } : {}),
        resume_at: FieldValue.delete(),
      } : {}),
      // Reactivación manual: se cancela la reactivación automática pendiente.
      ...(subAction === "resume" ? { resume_at: FieldValue.delete() } : {}),
    };
    // Tras pausar/reactivar, releemos el preapproval para no dejar next_charge_at viejo.
    if (subAction !== "cancel") {
      try {
        const pre = await mpGetPreapproval(merchant.mp_access_token, sub.mp_preapproval_id);
        if (pre) {
          update.next_charge_at = pre.next_payment_date || null;
          update.mp_preapproval_status = pre.status || null;
        }
      } catch (e) { console.warn("[public/sub] mpGetPreapproval falló:", e.message); }
    } else {
      update.mp_preapproval_status = "cancelled";
    }
    await subRef.update(update);

    // Registro de cancelación para analíticas (merchants/{mid}/cancellations/{subId}).
    // saved:false; pasa a true si después acepta la oferta de pausa (pause-offer).
    if (subAction === "cancel") {
      try {
        await db().collection("merchants").doc(merchantId).collection("cancellations").doc(subscriberId).set({
          subscriber_id: subscriberId,
          reason_code: cancelReasonCode || "sin_motivo",
          reason: cancelReason,
          comment: cancelComment,
          amount_ars: sub.plan_snapshot?.total_per_charge_ars || sub.plan_snapshot?.subscription_price_ars || 0,
          plan_title: sub.plan_snapshot?.product_title || null,
          plan_id: sub.plan_id || null,
          customer_email: sub.customer_email || null,
          cancelled_by: "customer",
          created_at: now,
          saved: false,
        }, { merge: true });
      } catch (e) { console.warn("[public/sub] cancellations:", e.message); }
    }

    // Klaviyo: Subscription Cancelled / Paused / Resumed (best-effort, nunca bloquea).
    if (klaviyoEnabled(merchant)) {
      try {
        const metric = subAction === "cancel" ? KLAVIYO_METRICS.CANCELLED : subAction === "pause" ? KLAVIYO_METRICS.PAUSED : KLAVIYO_METRICS.RESUMED;
        const cancelProps = subAction === "cancel" ? { cancel_reason_code: cancelReasonCode || null, cancel_reason: cancelReason || null } : {};
        await klaviyoLifecycle(merchant, merchantId, metric, subscriberId, { ...sub, ...update }, {
          uniqueSuffix: now, nextChargeAt: update.next_charge_at, properties: { source: "portal", ...cancelProps },
        });
      } catch (e) { console.warn("[public/sub] klaviyo falló:", e.message); }
    }
    // Flujos de email propios (cancelada / pausada / reactivada desde el portal). No-op sin flujos activos.
    await emitFlowEvent(merchantId, merchant, subAction === "cancel" ? "cancelled" : subAction === "pause" ? "paused" : "resumed", subscriberId, { ...sub, ...update }, { key: now });

    // Mail de cancelación (best-effort) + log para la actividad del dashboard.
    if (subAction === "cancel" && sub.customer_email) {
      const productTitle = sub.plan_snapshot?.product_title || "tu suscripción";
      try {
        const r = await emailSubscriptionCancelled({ to: sub.customer_email, customerName: sub.customer_name, productTitle, merchant });
        await logEmail(merchantId, {
          type: "cancellation", subscriber_id: subscriberId, to: sub.customer_email,
          customer_name: sub.customer_name, product_title: productTitle,
          status: r?.skipped ? "skipped" : (r?.error ? "error" : "sent"), error: r?.error || null,
        });
      } catch (e) {
        console.warn("[public/sub] mail de cancelación falló:", e.message);
        await logEmail(merchantId, { type: "cancellation", subscriber_id: subscriberId, to: sub.customer_email, customer_name: sub.customer_name, product_title: productTitle, status: "error", error: e.message });
      }
    }
    return res.json({ ok: true, status: localStatus, ...(subAction === "cancel" ? { cancel_reason_code: cancelReasonCode } : {}) });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ─── action=pause-offer ────────────────────────────────────────
// Oferta de retención desde el portal: en vez de cancelar, pausar N ciclos.
//   body { cycles: 1..3 } → MP status paused + resume_at = now + cycles × frequency_days.
//   El cron (api/cron.js) la vuelve a authorized cuando resume_at vence.
//   Marca retention_saved:true en el sub y saved:true en cancellations/{subId} si existía.
async function handlePauseOffer(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const token = req.query.token || req.body?.token;
  const payload = verifyPortalToken(String(token || ""));
  if (!payload) return res.status(403).json({ error: "Token inválido o expirado" });
  const { mid: merchantId, sid: subscriberId } = payload;
  const cycles = parseInt(req.body?.cycles, 10);
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > RETENTION_MAX_PAUSE_CYCLES) {
    return res.status(400).json({ error: `cycles debe ser un entero entre 1 y ${RETENTION_MAX_PAUSE_CYCLES}` });
  }
  const mRef = db().collection("merchants").doc(merchantId);
  const subRef = mRef.collection("subscribers").doc(subscriberId);
  const [subSnap, mSnap] = await Promise.all([subRef.get(), mRef.get()]);
  if (!subSnap.exists) return res.status(404).json({ error: "Suscripción no encontrada" });
  const sub = subSnap.data();
  const merchant = mSnap.data() || {};
  const retention = retentionFor(merchant);
  if (!retention.enabled || !retention.offer_pause) return res.status(400).json({ error: "Esta tienda no ofrece pausar la suscripción." });
  if (!["active", "payment_failed", "paused"].includes(sub.status)) return res.status(400).json({ error: "La suscripción no se puede pausar en su estado actual." });
  if (!merchant.mp_access_token || !sub.mp_preapproval_id) return res.status(400).json({ error: "Faltan credenciales para gestionar la suscripción" });

  if (sub.status !== "paused") {
    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: "paused" });
    } catch (e) {
      if (!/already|paused preapproval|same status/i.test(String(e.message || ""))) {
        console.error("[public/pause-offer] MP update falló:", e.message);
        return res.status(502).json({ error: "No pudimos pausar la suscripción en Mercado Pago. Intentá de nuevo en unos minutos." });
      }
    }
  }
  const freqDays = Math.max(1, parseInt(sub.plan_snapshot?.frequency_days, 10) || 30);
  const now = new Date();
  const resumeAt = new Date(now.getTime() + cycles * freqDays * 86400000).toISOString();
  const nowIso = now.toISOString();
  const update = {
    status: "paused",
    mp_preapproval_status: "paused",
    resume_at: resumeAt,
    pause_cycles: cycles,
    paused_at: nowIso,
    paused_by: "customer",
    pause_source: "retention_offer",
    retention_saved: true,
    retention_saved_at: nowIso,
    updated_at: nowIso,
  };
  await subRef.update(update);
  // Si ya había registrado una cancelación (abrió el modal, eligió motivo y después
  // aceptó la pausa), la marcamos como salvada.
  try {
    const cRef = mRef.collection("cancellations").doc(subscriberId);
    const c = await cRef.get();
    if (c.exists) await cRef.set({ saved: true, saved_at: nowIso, saved_via: "pause", pause_cycles: cycles }, { merge: true });
  } catch (e) { console.warn("[public/pause-offer] cancellations:", e.message); }

  if (klaviyoEnabled(merchant)) {
    try {
      await klaviyoLifecycle(merchant, merchantId, KLAVIYO_METRICS.PAUSED, subscriberId, { ...sub, ...update }, {
        uniqueSuffix: nowIso, nextChargeAt: resumeAt, properties: { source: "portal", retention_offer: true, pause_cycles: cycles, resume_at: resumeAt },
      });
    } catch (e) { console.warn("[public/pause-offer] klaviyo falló:", e.message); }
  }
  await emitFlowEvent(merchantId, merchant, "paused", subscriberId, { ...sub, ...update }, { key: nowIso });
  return res.json({ ok: true, status: "paused", resume_at: resumeAt, cycles, frequency_days: freqDays });
}
