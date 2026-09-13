// /api/public — endpoint PÚBLICO consolidado (sin auth Firebase).
//
// Combina dos endpoints previos (plan.js + sub.js) en un solo archivo para
// quedar dentro del límite de 12 funciones serverless del plan Hobby de
// Vercel. El router interno discrimina por `?action=`.
//
//   GET  ?action=plan&merchant=<uid>&product=<shopify_product_id>[&variant=<id>]
//        → devuelve el plan ACTIVO para ese producto (prioriza el de la variante).
//
//   GET  ?action=sub&token=<JWT>
//        → detalle de la sub + historial de cargos (customer portal).
//
//   POST ?action=sub&token=<JWT>  body { action: "pause"|"resume"|"cancel" }
//        → pause / resume / cancel desde el portal del cliente.
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
// Seguridad: las acciones de sub validan un token firmado HMAC (token.js, secreto
// de config.signingSecret(), sin fallback hardcodeado). Se mantiene la verificación
// de tokens legacy firmados con MP_WEBHOOK_SECRET (compare timing-safe).
import crypto from "node:crypto";
import { db } from "./_lib/firebase.js";
import { mpUpdatePreapproval, mpGetPreapproval } from "./_lib/mp.js";
import { signToken, verifyToken, timingSafeEqualStr } from "./_lib/token.js";
import { signingSecret } from "./_lib/config.js";
import { rateLimit, clientIp } from "./_lib/ratelimit.js";
import { setUnsubscribed } from "./_lib/unsub.js";
import { emailSubscriptionCancelled } from "./_lib/email.js";
import { logEmail } from "./_lib/emaillog.js";

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
  return res.status(400).json({ error: "action debe ser plan | sub | discount | unsub | update-address" });
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
  if (!merchantId || !productId) {
    return res.status(400).json({ error: "Faltan merchant o product" });
  }
  try {
    const col = db().collection("merchants").doc(merchantId).collection("plans");
    let doc = null;
    // Primero el plan de la variante exacta; si no hay, el del producto.
    if (variantId) {
      const qv = await col.where("shopify_variant_id", "==", variantId).where("active", "==", true).limit(1).get();
      if (!qv.empty) doc = qv.docs[0];
    }
    if (!doc) {
      const q = await col.where("shopify_product_id", "==", productId).where("active", "==", true).limit(1).get();
      if (!q.empty) doc = q.docs[0];
    }
    if (!doc) return res.json({ plan: null });
    const data = doc.data();
    return res.json({
      plan: {
        id: doc.id,
        shopify_product_id: data.shopify_product_id,
        shopify_variant_id: data.shopify_variant_id,
        product_title: data.product_title,
        frequency_days: data.frequency_days,
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
      },
      charges,
      merchant_store_url: storeUrl,
      merchant_brand: (merchant && (merchant.email_brand || merchant.displayName || merchant.shop_name)) || null,
    });
  }

  if (req.method === "POST") {
    const { action: subAction } = req.body || {};
    if (!["pause", "resume", "cancel"].includes(subAction)) {
      return res.status(400).json({ error: "action debe ser pause | resume | cancel" });
    }
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Suscripción no encontrada" });
    const sub = subSnap.data();

    const merchantSnap = await db().collection("merchants").doc(merchantId).get();
    const merchant = merchantSnap.data() || {};
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
      ...(subAction === "cancel" ? { cancelled_at: now, cancelled_by: "customer" } : {}),
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
    return res.json({ ok: true, status: localStatus });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
