// /api/merchant
//
//   GET    → doc del merchant logueado (con tokens enmascarados)
//   PATCH  ?action=save-mp-token  body { access_token }
//          → guarda el access_token de MP del merchant (modo paste, MVP).
//            Valida contra /users/me antes de persistir; si el token no es
//            legítimo tira 400 sin escribir nada.
//
// Antes el save-mp-token vivía en /api/mp/save-token.js — se consolidó acá
// para entrar en el límite de 12 funciones del plan Hobby de Vercel.
import { db, requireAuth, getOrCreateMerchant } from "./_lib/firebase.js";
import { mpMe } from "./_lib/mp.js";
import { emailAbandonedCheckout } from "./_lib/email.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const uid = await requireAuth(req, res);
  if (!uid) return;

  if (req.method === "GET") {
    try {
      const merchant = await getOrCreateMerchant(uid, null);
      // No devolvemos tokens raw — solo flags de "conectado".
      const safe = {
        id: merchant.id,
        email: merchant.email,
        plan: merchant.plan,
        created_at: merchant.created_at,
        shopify_shop: merchant.shopify_shop || null,
        shopify_token: merchant.shopify_token ? "•••••" : null,
        shopify_connected_at: merchant.shopify_connected_at || null,
        mp_user_id: merchant.mp_user_id || null,
        mp_access_token: merchant.mp_access_token ? "•••••" : null,
        mp_connected_at: merchant.mp_connected_at || null,
        // Meta CAPI: solo flags/pixel (nunca el token)
        meta_pixel_id: merchant.meta_pixel_id || null,
        meta_connected: !!(merchant.meta_pixel_id && merchant.meta_capi_token),
        meta_connected_at: merchant.meta_connected_at || null,
        // Settings del widget (UX del toggle Sub/Única)
        widget_mode_order:   merchant.widget_mode_order   || "sub_first", // "sub_first" | "once_first"
        widget_mode_default: merchant.widget_mode_default || "sub",       // "sub" | "once"
        widget_color:        merchant.widget_color        || "#10b981",   // hex del color principal del widget
        widget_sub_title:    merchant.widget_sub_title    || "Suscripción",
        widget_sub_subtitle: merchant.widget_sub_subtitle || "",         // vacío = usar default con frecuencia del plan
        widget_once_title:    merchant.widget_once_title    || "Compra única",
        widget_once_subtitle: merchant.widget_once_subtitle || "Comprá una vez al precio normal.",
        widget_disclaimer_text: merchant.widget_disclaimer_text || "",   // vacío = usar default explicativo
        // Códigos de descuento del merchant (para el checkout de suscripción)
        discount_codes: Array.isArray(merchant.discount_codes) ? merchant.discount_codes : [],
      };
      return res.json({ merchant: safe });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "PATCH" || req.method === "POST") {
    const action = String(req.query.action || "");
    if (action === "save-mp-token")        return saveMpToken(uid, req, res);
    if (action === "save-widget-settings") return saveWidgetSettings(uid, req, res);
    if (action === "save-meta")            return saveMeta(uid, req, res);
    if (action === "save-discount-codes")  return saveDiscountCodes(uid, req, res);
    if (action === "test-email")           return testEmail(uid, req, res);
    if (action === "backfill-email-log")   return backfillEmailLog(uid, req, res);
    return res.status(400).json({ error: "action no reconocida" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

async function saveMeta(uid, req, res) {
  // Guarda el Pixel ID + token de la API de Conversiones (CAPI) del merchant,
  // para reportar a Meta la PRIMERA venta de cada suscripción (server-side).
  // Pasar strings vacíos desconecta (borra las credenciales).
  const { meta_pixel_id, meta_capi_token } = req.body || {};
  const pixel = (typeof meta_pixel_id === "string" ? meta_pixel_id : "").replace(/\D/g, "").slice(0, 32);
  const token = (typeof meta_capi_token === "string" ? meta_capi_token : "").trim().slice(0, 500);
  try {
    await db().collection("merchants").doc(uid).set({
      meta_pixel_id: pixel,
      meta_capi_token: token,
      meta_connected_at: pixel && token ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    // No devolvemos el token (sensible) — solo si quedó conectado.
    return res.json({ ok: true, meta_connected: !!(pixel && token), meta_pixel_id: pixel });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function saveWidgetSettings(uid, req, res) {
  // Setea preferencias UX del widget storefront a nivel merchant. Aplica a
  // TODOS los planes del merchant — si necesitan plan-por-plan en F2, se
  // mueve a doc del plan.
  const { widget_mode_order, widget_mode_default, widget_color, widget_sub_title, widget_sub_subtitle, widget_once_title, widget_once_subtitle, widget_disclaimer_text } = req.body || {};
  const validOrder = ["sub_first", "once_first"];
  const validDefault = ["sub", "once"];
  const order = validOrder.includes(widget_mode_order) ? widget_mode_order : "sub_first";
  const def = validDefault.includes(widget_mode_default) ? widget_mode_default : "sub";
  // Color: hex válido (#RRGGBB), si no fallback al verde
  const colorOk = typeof widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(widget_color.trim());
  const color = colorOk ? widget_color.trim() : "#10b981";
  // Textos: trim + cap a 60 / 120 chars
  const subTitle = (typeof widget_sub_title === "string" ? widget_sub_title : "").trim().slice(0, 60) || "Suscripción";
  const subSubtitle = (typeof widget_sub_subtitle === "string" ? widget_sub_subtitle : "").trim().slice(0, 120);
  const onceTitle = (typeof widget_once_title === "string" ? widget_once_title : "").trim().slice(0, 60) || "Compra única";
  const onceSubtitle = (typeof widget_once_subtitle === "string" ? widget_once_subtitle : "").trim().slice(0, 120) || "Comprá una vez al precio normal.";
  // Disclaimer banner — texto libre, cap a 800 chars. "" = usar default armado.
  const disclaimerText = (typeof widget_disclaimer_text === "string" ? widget_disclaimer_text : "").trim().slice(0, 800);
  try {
    await db().collection("merchants").doc(uid).set({
      widget_mode_order: order,
      widget_mode_default: def,
      widget_color: color,
      widget_sub_title: subTitle,
      widget_sub_subtitle: subSubtitle,
      widget_once_title: onceTitle,
      widget_once_subtitle: onceSubtitle,
      widget_disclaimer_text: disclaimerText,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    return res.json({ ok: true, widget_mode_order: order, widget_mode_default: def, widget_color: color, widget_sub_title: subTitle, widget_sub_subtitle: subSubtitle, widget_once_title: onceTitle, widget_once_subtitle: onceSubtitle, widget_disclaimer_text: disclaimerText });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function backfillEmailLog(uid, req, res) {
  // Reconstrucción ONE-TIME del historial de mails en email_log a partir de datos
  // reales, para que la tab Actividad no arranque vacía:
  //  · activation → un mail por cada sub que se activó (tiene orden Shopify).
  //  · abandoned  → un mail por cada sub con abandoned_email_sent_at (flujo viejo 1 paso).
  // Idempotente: saltea subs que ya tienen una entrada de ese tipo en email_log.
  try {
    const mRef = db().collection("merchants").doc(uid);
    const [subsSnap, logSnap] = await Promise.all([
      mRef.collection("subscribers").get(),
      mRef.collection("email_log").get(),
    ]);
    // Sets de lo ya logueado (real o backfill previo) para no duplicar.
    const haveActivation = new Set(), haveAbandoned = new Set();
    logSnap.docs.forEach(d => {
      const l = d.data();
      if (!l.subscriber_id) return;
      if (l.type === "activation") haveActivation.add(l.subscriber_id);
      if (l.type === "abandoned") haveAbandoned.add(l.subscriber_id);
    });

    const batchWrites = [];
    let activation = 0, abandoned = 0;
    for (const doc of subsSnap.docs) {
      const s = doc.data();
      const id = doc.id;
      const activated = (s.shopify_orders || []).length > 0 || s.status === "active" || !!s.last_charge_at;
      if (activated && s.customer_email && !haveActivation.has(id)) {
        batchWrites.push({
          type: "activation", subscriber_id: id, to: s.customer_email,
          customer_name: s.customer_name || null, product_title: s.plan_snapshot?.product_title || null,
          step: null, coupon: null, status: "sent", error: null,
          created_at: s.last_charge_at || s.updated_at || s.created_at || new Date().toISOString(),
          backfilled: true,
        });
        activation++;
      }
      if (s.abandoned_email_sent_at && s.customer_email && !haveAbandoned.has(id)) {
        batchWrites.push({
          type: "abandoned", subscriber_id: id, to: s.customer_email,
          customer_name: s.customer_name || null, product_title: s.plan_snapshot?.product_title || null,
          step: s.abandoned_step || 1, coupon: null, status: "sent", error: null,
          created_at: s.abandoned_email_sent_at, backfilled: true,
        });
        abandoned++;
      }
    }
    // Escribir en lotes de 400 (límite batch Firestore = 500).
    const col = mRef.collection("email_log");
    for (let i = 0; i < batchWrites.length; i += 400) {
      const batch = db().batch();
      for (const w of batchWrites.slice(i, i + 400)) batch.set(col.doc(), w);
      await batch.commit();
    }
    return res.json({ ok: true, activation_logged: activation, abandoned_logged: abandoned, total: batchWrites.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function testEmail(uid, req, res) {
  // Envía el mail de carrito abandonado de PRUEBA a una dirección, para verificar
  // que Resend + el remitente + la marca quedaron bien antes de mandarlo a clientes.
  const to = String(req.body?.to || "").trim();
  if (!to) return res.status(400).json({ error: "Falta 'to'" });
  const step = Math.min(3, Math.max(1, parseInt(req.body?.step, 10) || 1));
  const COUPONS = { 1: { code: null, pct: 0 }, 2: { code: "VUELVO5", pct: 5 }, 3: { code: "ULTIMACHANCE15", pct: 15 } };
  const cp = COUPONS[step];
  const merchant = await getOrCreateMerchant(uid, null);
  const brand = merchant?.email_brand || (process.env.EMAIL_FROM || "").split("<")[0].trim().replace(/^["']|["']$/g, "") || "";
  let recoverUrl = "https://www.luminalabs-arg.com/pages/suscripcion-form";
  if (cp.code) recoverUrl += "?code=" + encodeURIComponent(cp.code);
  // name opcional: si mandan name:"" se ve el saludo sin nombre ("¡Hola! 👋").
  const customerName = req.body?.name !== undefined ? String(req.body.name) : "Nombre de prueba";
  const r = await emailAbandonedCheckout({
    to,
    customerName,
    productTitle: "Cápsulas LuminaLabs",
    amount: 50992,
    recoverUrl,
    brand,
    accent: merchant?.widget_color || "",
    from: merchant?.email_from || undefined,
    step,
    couponCode: cp.code,
    couponPct: cp.pct,
  });
  if (r?.skipped) return res.status(400).json({ error: "RESEND_API_KEY no configurada (o no tomó el redeploy todavía)" });
  if (r?.error) return res.status(502).json({ error: r.error });
  return res.json({ ok: true, id: r.id, step, coupon: cp.code, from: merchant?.email_from || process.env.EMAIL_FROM || null, brand });
}

async function saveDiscountCodes(uid, req, res) {
  // Guarda los códigos de descuento del merchant para el checkout de suscripción.
  // Formato: [{ code, type:"percent"|"fixed", value, active }]. Se sanitiza todo.
  const { discount_codes } = req.body || {};
  const arr = Array.isArray(discount_codes) ? discount_codes : [];
  const clean = arr.map(c => ({
    code: String(c.code || "").trim().toUpperCase().slice(0, 40),
    type: c.type === "fixed" ? "fixed" : "percent",
    value: Math.max(0, parseFloat(c.value) || 0),
    active: c.active !== false,
  })).filter(c => c.code && c.value > 0).slice(0, 100);
  try {
    await db().collection("merchants").doc(uid).set({
      discount_codes: clean,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    return res.json({ ok: true, discount_codes: clean });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function saveMpToken(uid, req, res) {
  const { access_token } = req.body || {};
  if (!access_token?.trim()) return res.status(400).json({ error: "Falta access_token" });

  let me;
  try {
    me = await mpMe(access_token.trim());
  } catch (e) {
    return res.status(400).json({ error: `Token inválido: ${e.message}` });
  }

  try {
    await db().collection("merchants").doc(uid).set({
      mp_access_token: access_token.trim(),
      mp_user_id: me.id || null,
      mp_email: me.email || null,
      mp_country: me.country_id || null,
      mp_connected_at: new Date().toISOString(),
    }, { merge: true });
    return res.json({ ok: true, mp_user_id: me.id, email: me.email });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
