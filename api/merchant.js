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
        // Settings del widget (UX del toggle Sub/Única)
        widget_mode_order:   merchant.widget_mode_order   || "sub_first", // "sub_first" | "once_first"
        widget_mode_default: merchant.widget_mode_default || "sub",       // "sub" | "once"
        widget_color:        merchant.widget_color        || "#10b981",   // hex del color principal del widget
        widget_sub_title:    merchant.widget_sub_title    || "Suscripción",
        widget_sub_subtitle: merchant.widget_sub_subtitle || "",         // vacío = usar default con frecuencia del plan
        widget_once_title:    merchant.widget_once_title    || "Compra única",
        widget_once_subtitle: merchant.widget_once_subtitle || "Comprá una vez al precio normal.",
        widget_disclaimer_text: merchant.widget_disclaimer_text || "",   // vacío = usar default explicativo
      };
      return res.json({ merchant: safe });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "PATCH" || req.method === "POST") {
    const action = String(req.query.action || "");
    if (action === "save-mp-token")       return saveMpToken(uid, req, res);
    if (action === "save-widget-settings") return saveWidgetSettings(uid, req, res);
    return res.status(400).json({ error: "action no reconocida" });
  }

  return res.status(405).json({ error: "Method not allowed" });
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
