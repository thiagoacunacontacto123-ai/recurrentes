// /api/public — endpoint PÚBLICO consolidado (sin auth Firebase).
//
// Combina dos endpoints previos (plan.js + sub.js) en un solo archivo para
// quedar dentro del límite de 12 funciones serverless del plan Hobby de
// Vercel. El router interno discrimina por `?action=plan|sub`.
//
//   GET  ?action=plan&merchant=<uid>&product=<shopify_product_id>
//        → devuelve el plan ACTIVO para ese producto (lo consume el widget
//          en la storefront del comerciante).
//
//   GET  ?action=sub&token=<JWT>
//        → detalle de la sub + historial de cargos (customer portal).
//
//   POST ?action=sub&token=<JWT>  body { action: "pause"|"resume"|"cancel" }
//        → pause / resume / cancel desde el portal del cliente.
//
// Seguridad: las acciones de sub validan un JWT firmado HS256 con
// MP_WEBHOOK_SECRET. Las consultas de plan son por merchant_id + product_id
// (datos públicos) y sólo exponen campos seguros del plan (sin tokens).
import crypto from "node:crypto";
import { db } from "./_lib/firebase.js";
import { mpUpdatePreapproval } from "./_lib/mp.js";

const SECRET = process.env.MP_WEBHOOK_SECRET || process.env.PORTAL_SECRET || "fallback-secret-please-change";

// JWT simple (HS256) sin libs externas — payload + sig.
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyPortalToken(token) {
  return verifyToken(token);
}
function verifyToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const calc = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (calc !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (_) { return null; }
}

// Generador exportable — lo usa checkout/init para armar el back_url con el portal token.
export function generatePortalToken(merchantId, subscriberId, ttlDays = 365) {
  return signToken({
    mid: merchantId,
    sid: subscriberId,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const action = String(req.query.action || "");
  if (action === "plan") return handlePlan(req, res);
  if (action === "sub")  return handleSub(req, res);
  return res.status(400).json({ error: "action debe ser plan | sub" });
}

// ─── action=plan ───────────────────────────────────────────────
async function handlePlan(req, res) {
  const merchantId = String(req.query.merchant || "");
  const productId = String(req.query.product || "");
  if (!merchantId || !productId) {
    return res.status(400).json({ error: "Faltan merchant o product" });
  }
  try {
    const q = await db().collection("merchants").doc(merchantId).collection("plans")
      .where("shopify_product_id", "==", productId)
      .where("active", "==", true)
      .limit(1)
      .get();
    if (q.empty) return res.json({ plan: null });
    const doc = q.docs[0];
    const data = doc.data();
    return res.json({
      plan: {
        id: doc.id,
        shopify_product_id: data.shopify_product_id,
        shopify_variant_id: data.shopify_variant_id,
        product_title: data.product_title,
        frequency_days: data.frequency_days,
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
    return res.status(500).json({ error: e.message });
  }
}

// ─── action=sub ────────────────────────────────────────────────
async function handleSub(req, res) {
  const token = req.query.token || req.body?.token;
  const payload = verifyToken(String(token || ""));
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
    return res.json({
      sub: {
        id: subscriberId,
        status: sub.status,
        customer_email: sub.customer_email,
        customer_name: sub.customer_name,
        plan_snapshot: sub.plan_snapshot,
        shipping_address: sub.shipping_address,
        quantity: sub.quantity || null,
        next_charge_at: sub.next_charge_at || null,
        last_charge_at: sub.last_charge_at || null,
        created_at: sub.created_at,
        // URL pública de Thank You de Shopify — CheckoutSuccess.jsx hace
        // polling acá y redirige al cliente cuando la orden ya fue creada.
        shopify_order_status_url: sub.last_shopify_order_status_url || null,
      },
      charges,
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
      return res.status(502).json({ error: `MP: ${e.message}` });
    }

    const localStatus = subAction === "cancel" ? "cancelled" : subAction === "pause" ? "paused" : "active";
    await subRef.update({
      status: localStatus,
      updated_at: new Date().toISOString(),
      ...(subAction === "cancel" ? { cancelled_at: new Date().toISOString(), cancelled_by: "customer" } : {}),
    });
    return res.json({ ok: true, status: localStatus });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
