// /api/merchant
//
//   GET    → doc del merchant logueado (con tokens enmascarados)
//   PATCH  ?action=save-mp-token  body { access_token }
//          → guarda el access_token de MP del merchant (modo paste, manual).
//            Valida contra /users/me antes de persistir; si el token no es
//            legítimo tira 400 sin escribir nada.
//   PATCH  ?action=save-widget-settings → apariencia del widget (todos los campos)
//   PATCH  ?action=save-settings        → settings operativos (parcial: solo lo que viene)
//   PATCH  ?action=save-discount-codes  → códigos de descuento
//   POST   ?action=test-email           → mail de prueba (solo al dueño, 10/día)
//   POST   ?action=mp-oauth-start       → { url } para conectar MP por OAuth
//   POST   ?action=disconnect-mp | disconnect-shopify
import { FieldValue } from "firebase-admin/firestore";
import { db, requireAuth, getOrCreateMerchant } from "./_lib/firebase.js";
import { mpMe } from "./_lib/mp.js";
import { emailAbandonedCheckout } from "./_lib/email.js";
import { logEmail } from "./_lib/emaillog.js";
import { signToken } from "./_lib/token.js";
import { appBaseUrl } from "./_lib/config.js";
import { rateLimit } from "./_lib/ratelimit.js";

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
        shopify_has_own_app: !!(merchant.shopify_client_id && merchant.shopify_client_secret),
        shopify_env_app: !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),
        mp_user_id: merchant.mp_user_id || null,
        mp_access_token: merchant.mp_access_token ? "•••••" : null,
        mp_connected_at: merchant.mp_connected_at || null,
        mp_method: merchant.mp_method || (merchant.mp_access_token ? "manual" : null),
        mp_oauth_available: !!process.env.MP_APP_ID,
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
        widget_hide_selector: merchant.widget_hide_selector || "",
        widget_checkout_flow: merchant.widget_checkout_flow || "redirect",
        widget_checkout_page_path: merchant.widget_checkout_page_path || "",
        // Códigos de descuento del merchant (para el checkout de suscripción)
        discount_codes: Array.isArray(merchant.discount_codes) ? merchant.discount_codes : [],
        // Settings operativos (mails, abandono, envíos del checkout)
        abandoned_enabled: merchant.abandoned_enabled === true,
        abandoned_coupons: merchant.abandoned_coupons || null,
        email_from: merchant.email_from || "",
        email_brand: merchant.email_brand || "",
        email_reply_to: merchant.email_reply_to || "",
        email_accent: merchant.email_accent || "",
        checkout_shipping_rates: Array.isArray(merchant.checkout_shipping_rates) ? merchant.checkout_shipping_rates : [],
        store_domain: merchant.store_domain || "",
        dev_mode: merchant.dev_mode === true,
        requires_email_verification: merchant.requires_email_verification === true,
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
    if (action === "save-settings")        return saveSettings(uid, req, res);
    if (action === "save-meta")            return saveMeta(uid, req, res);
    if (action === "save-discount-codes")  return saveDiscountCodes(uid, req, res);
    if (action === "test-email")           return testEmail(uid, req, res);
    if (action === "backfill-email-log")   return backfillEmailLog(uid, req, res);
    if (action === "mp-oauth-start")       return mpOauthStart(uid, req, res);
    if (action === "disconnect-mp")        return disconnect(uid, "mp", res);
    if (action === "disconnect-shopify")   return disconnect(uid, "shopify", res);
    return res.status(400).json({ error: "action no reconocida" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ─── OAuth MP: arma la URL de autorización. El callback vive en /api/mp/oauth-callback.
async function mpOauthStart(uid, req, res) {
  const appId = process.env.MP_APP_ID;
  if (!appId) return res.status(400).json({ error: "OAuth MP no configurado" });
  const redirect = process.env.MP_REDIRECT_URI || `${appBaseUrl()}/api/mp/oauth-callback`;
  const state = signToken({ uid }, 600);
  const url = `https://auth.mercadopago.com.ar/authorization?client_id=${encodeURIComponent(appId)}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirect)}`;
  return res.json({ url });
}

// ─── Desconectar: borra tokens y marca la fecha. Las subs siguen en MP.
async function disconnect(uid, which, res) {
  const now = new Date().toISOString();
  const patch = which === "mp"
    ? { mp_access_token: FieldValue.delete(), mp_refresh_token: FieldValue.delete(), mp_token_expires_at: FieldValue.delete(), mp_public_key: FieldValue.delete(), mp_disconnected_at: now }
    : { shopify_token: FieldValue.delete(), shopify_scope: FieldValue.delete(), shopify_disconnected_at: now };
  try {
    await db().collection("merchants").doc(uid).set(patch, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
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

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// "Nombre <mail@dominio>"
const FROM_RE = /^[^<>]{1,60}<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;
const normHost = (v) => String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");

// ─── Settings operativos. PARCIAL: solo escribe las claves que vienen en el
// body, así el front puede guardar una sección sin pisar las demás.
async function saveSettings(uid, req, res) {
  const b = req.body || {};
  const out = {};
  const bad = (msg) => res.status(400).json({ error: msg });

  if ("abandoned_enabled" in b) out.abandoned_enabled = b.abandoned_enabled === true;
  if ("dev_mode" in b) out.dev_mode = b.dev_mode === true;

  if ("abandoned_coupons" in b) {
    if (b.abandoned_coupons == null) out.abandoned_coupons = null;
    else {
      const codes = (await getOrCreateMerchant(uid, null)).discount_codes || [];
      const byCode = Object.fromEntries(codes.map(c => [String(c.code || "").toUpperCase(), c]));
      const clean = {};
      for (const step of ["step2", "step3"]) {
        const c = b.abandoned_coupons[step];
        if (!c || !String(c.code || "").trim()) { clean[step] = null; continue; }
        const code = String(c.code).trim().toUpperCase().slice(0, 40);
        const hit = byCode[code];
        if (!hit) return bad(`El código ${code} no existe en tus códigos de descuento`);
        const pct = Number.isFinite(Number(c.pct)) ? Math.max(0, Math.min(100, parseInt(c.pct, 10) || 0)) : (hit.type === "percent" ? hit.value : 0);
        clean[step] = { code, pct };
      }
      out.abandoned_coupons = clean;
    }
  }

  if ("email_from" in b) {
    const v = String(b.email_from || "").trim();
    if (v && !FROM_RE.test(v)) return bad("email_from debe tener formato: Nombre <mail@dominio>");
    out.email_from = v.slice(0, 120);
  }
  if ("email_brand" in b) out.email_brand = String(b.email_brand || "").trim().slice(0, 40);
  if ("email_reply_to" in b) {
    const v = String(b.email_reply_to || "").trim().toLowerCase();
    if (v && !EMAIL_RE.test(v)) return bad("email_reply_to inválido");
    out.email_reply_to = v.slice(0, 120);
  }
  if ("email_accent" in b) {
    const v = String(b.email_accent || "").trim();
    if (v && !/^#[0-9a-fA-F]{6}$/.test(v)) return bad("email_accent debe ser #RRGGBB");
    out.email_accent = v;
  }
  if ("checkout_shipping_rates" in b) {
    if (!Array.isArray(b.checkout_shipping_rates)) return bad("checkout_shipping_rates debe ser un array");
    if (b.checkout_shipping_rates.length > 6) return bad("Máximo 6 tarifas de envío");
    const rates = [];
    for (const r of b.checkout_shipping_rates) {
      const name = String(r?.name || "").trim().slice(0, 250);
      const price = parseInt(r?.price, 10);
      if (!name) return bad("Cada tarifa necesita nombre");
      if (!Number.isInteger(price) || price < 0) return bad(`Precio inválido en "${name}" (entero ≥ 0)`);
      const code = String(r?.code || "").trim().slice(0, 50);
      rates.push({ name, price, ...(code ? { code } : {}) });
    }
    out.checkout_shipping_rates = rates;
  }
  if ("store_domain" in b) {
    const v = normHost(b.store_domain);
    if (v && !/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(v)) return bad("store_domain debe ser un host (ej: www.mitienda.com)");
    out.store_domain = v;
  }
  if ("widget_hide_selector" in b) out.widget_hide_selector = String(b.widget_hide_selector || "").trim().slice(0, 300);
  if ("widget_checkout_flow" in b) out.widget_checkout_flow = b.widget_checkout_flow === "inline" ? "inline" : "redirect";
  if ("widget_checkout_page_path" in b) {
    const v = String(b.widget_checkout_page_path || "").trim().slice(0, 120);
    if (v && !v.startsWith("/")) return bad("widget_checkout_page_path debe empezar con /");
    out.widget_checkout_page_path = v;
  }

  if (!Object.keys(out).length) return bad("Nada para guardar");
  try {
    await db().collection("merchants").doc(uid).set({ ...out, updated_at: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ...out });
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
    const col = mRef.collection("email_log");
    const [mSnap, subsSnap, logSnap] = await Promise.all([
      mRef.get(),
      mRef.collection("subscribers").get(),
      col.get(),
    ]);
    const m = mSnap.data() || {};
    // Idempotente: borrar la corrida de backfill previa (backfilled:true) y NO
    // pisar mails reales logueados por el sistema (subscriber ya con log real).
    const realActivation = new Set(), realAbandoned = new Set();
    const toDelete = [];
    logSnap.docs.forEach(d => {
      const l = d.data();
      if (l.backfilled === true) { toDelete.push(d.ref); return; }
      if (l.type === "activation" && l.subscriber_id) realActivation.add(l.subscriber_id);
      if (l.type === "abandoned" && l.subscriber_id) realAbandoned.add(l.subscriber_id);
    });

    // Modo CLEAR: solo borrar las entradas reconstruidas (backfilled) y salir.
    // Deja el log con SOLO mails reales enviados por el sistema.
    if (req.body?.clear === true) {
      for (let i = 0; i < toDelete.length; i += 400) {
        const batch = db().batch();
        for (const ref of toDelete.slice(i, i + 400)) batch.delete(ref);
        await batch.commit();
      }
      return res.json({ ok: true, cleared: toDelete.length });
    }

    // Cupones por paso: los configurados por el merchant (si no, sin cupón).
    const COUPON = { 2: m.abandoned_coupons?.step2?.code || null, 3: m.abandoned_coupons?.step3?.code || null };
    const batchWrites = [];
    let activation = 0, abandoned = 0;
    for (const doc of subsSnap.docs) {
      const s = doc.data();
      const id = doc.id;
      const activated = (s.shopify_orders || []).length > 0 || s.status === "active" || !!s.last_charge_at;
      if (activated && s.customer_email && !realActivation.has(id)) {
        batchWrites.push({
          type: "activation", subscriber_id: id, to: s.customer_email,
          customer_name: s.customer_name || null, product_title: s.plan_snapshot?.product_title || null,
          step: null, coupon: null, status: "sent", error: null,
          created_at: s.last_charge_at || s.updated_at || s.created_at || new Date().toISOString(),
          backfilled: true,
        });
        activation++;
      }
      // Abandono: paso = 2/3 si el flujo nuevo mandó cupón; si no, paso 1 (el
      // recordatorio viejo). step 99 = comprador salteado → cuenta como paso 1
      // (igual recibió el recordatorio viejo). Solo si hubo algún envío real.
      const gotAband = s.abandoned_email_sent_at || (s.abandoned_step && s.abandoned_step !== 99);
      if (gotAband && s.customer_email && !realAbandoned.has(id)) {
        const step = (s.abandoned_step === 2 || s.abandoned_step === 3) ? s.abandoned_step : 1;
        batchWrites.push({
          type: "abandoned", subscriber_id: id, to: s.customer_email,
          customer_name: s.customer_name || null, product_title: s.plan_snapshot?.product_title || null,
          step, coupon: COUPON[step] || null, status: "sent", error: null,
          created_at: s.abandoned_step_at || s.abandoned_email_sent_at || s.created_at, backfilled: true,
        });
        abandoned++;
      }
    }
    // Borrar backfill previo + escribir el nuevo, en lotes de 400 (límite 500).
    const ops = toDelete.map(ref => ({ del: ref })).concat(batchWrites.map(w => ({ set: w })));
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db().batch();
      for (const op of ops.slice(i, i + 400)) { if (op.del) batch.delete(op.del); else batch.set(col.doc(), op.set); }
      await batch.commit();
    }
    return res.json({ ok: true, deleted_prev: toDelete.length, activation_logged: activation, abandoned_logged: abandoned, total: batchWrites.length });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function testEmail(uid, req, res) {
  // Envía el mail de carrito abandonado de PRUEBA para verificar que Resend +
  // el remitente + la marca quedaron bien antes de mandarlo a clientes.
  // Solo al mail del merchant o a un mail del dominio de email_from; 10/día.
  const to = String(req.body?.to || "").trim().toLowerCase();
  if (!to || !EMAIL_RE.test(to)) return res.status(400).json({ error: "Falta 'to' (email válido)" });
  const merchant = await getOrCreateMerchant(uid, null);
  const fromDomain = ((merchant.email_from || "").match(/@([^>\s]+)>?$/) || [])[1]?.toLowerCase() || "";
  const ownerEmail = String(merchant.email || "").toLowerCase();
  const toDomain = to.split("@")[1] || "";
  if (to !== ownerEmail && !(fromDomain && toDomain === fromDomain)) {
    return res.status(400).json({ error: "El mail de prueba solo puede ir a tu email de cuenta o a una casilla del dominio de tu remitente" });
  }
  const rl = await rateLimit(`testmail:${uid}`, { limit: 10, windowSec: 86400 });
  if (!rl.ok) return res.status(429).json({ error: "Tope de 10 mails de prueba por día alcanzado" });

  const step = Math.min(3, Math.max(1, parseInt(req.body?.step, 10) || 1));
  const cfg = merchant.abandoned_coupons || {};
  const COUPONS = { 1: { code: null, pct: 0 }, 2: cfg.step2 || { code: null, pct: 0 }, 3: cfg.step3 || { code: null, pct: 0 } };
  const cp = COUPONS[step];
  const brand = merchant.email_brand || (process.env.EMAIL_FROM || "").split("<")[0].trim().replace(/^["']|["']$/g, "") || "";

  // Datos reales del merchant: primer plan activo + dominio de la tienda.
  let productTitle = "Tu producto", amount = 0;
  try {
    const plansSnap = await db().collection("merchants").doc(uid).collection("plans").where("active", "==", true).limit(1).get();
    if (!plansSnap.empty) {
      const p = plansSnap.docs[0].data();
      productTitle = p.product_title || productTitle;
      amount = p.subscription_price_ars || 0;
    }
  } catch (_) {}
  const host = merchant.store_domain || merchant.shopify_shop || "";
  const path = String(merchant.widget_checkout_page_path || "/pages/suscripcion-form").trim();
  let recoverUrl = host ? `https://${host}${path}` : `${appBaseUrl()}/#/dashboard`;
  if (cp.code) recoverUrl += (recoverUrl.includes("?") ? "&" : "?") + "code=" + encodeURIComponent(cp.code);
  // name opcional: si mandan name:"" se ve el saludo sin nombre ("¡Hola! 👋").
  const customerName = req.body?.name !== undefined ? String(req.body.name) : "Nombre de prueba";
  const r = await emailAbandonedCheckout({
    to,
    customerName,
    productTitle,
    amount,
    recoverUrl,
    brand,
    accent: merchant.email_accent || merchant.widget_color || "",
    from: merchant.email_from || undefined,
    step,
    couponCode: cp.code,
    couponPct: cp.pct,
  });
  await logEmail(uid, { type: "abandoned", to, customer_name: customerName, product_title: productTitle, step, coupon: cp.code, status: r?.error ? "error" : (r?.skipped ? "skipped" : "sent"), error: r?.error || null, test: true });
  if (r?.skipped) return res.status(400).json({ error: "RESEND_API_KEY no configurada (o no tomó el redeploy todavía)" });
  if (r?.error) return res.status(502).json({ error: r.error });
  return res.json({ ok: true, id: r.id, step, coupon: cp.code, from: merchant.email_from || process.env.EMAIL_FROM || null, brand, remaining: rl.remaining });
}

async function saveDiscountCodes(uid, req, res) {
  // Guarda los códigos de descuento del merchant para el checkout de suscripción.
  // Formato: [{ code, type:"percent"|"fixed", value, active, recovery_only?, first_charge_only? }].
  //   recovery_only     → solo aplica con token de recupero (mail de abandono).
  //   first_charge_only → descuenta solo el primer cobro; las renovaciones van a precio pleno.
  const { discount_codes } = req.body || {};
  const arr = Array.isArray(discount_codes) ? discount_codes : [];
  const clean = arr.map(c => ({
    code: String(c.code || "").trim().toUpperCase().slice(0, 40),
    type: c.type === "fixed" ? "fixed" : "percent",
    value: Math.max(0, parseFloat(c.value) || 0),
    active: c.active !== false,
    recovery_only: c.recovery_only === true,
    first_charge_only: c.first_charge_only === true,
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

// Modo manual (pegar token). Sigue vigente además del OAuth.
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
      mp_method: "manual",
      mp_disconnected_at: null,
    }, { merge: true });
    return res.json({ ok: true, mp_user_id: me.id, email: me.email });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
