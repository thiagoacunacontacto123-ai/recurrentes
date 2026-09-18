// /api/merchant
//
//   GET    → doc del merchant ACTIVO (con tokens enmascarados) + role/is_primary
//   GET    ?action=me          → idem GET
//   GET    ?action=workspace   → tiendas del PERFIL (propias + equipo) y la activa
//   GET    ?action=members     → miembros + invitaciones de la tienda activa (solo dueño)
//   GET    ?action=refresh-shop → (dueño) relee shop.json de Shopify y actualiza
//          shopify_domains / store_domain (respeta manual) / store_name (si vacío) /
//          shop_name / shop_email / shop_currency / shop_country / shop_timezone.
//          Devuelve { ok, shop:{…}, patch:{…} }.
//   PATCH  ?action=save-mp-token  body { access_token }
//          → guarda el access_token de MP del merchant (modo paste, manual).
//            Valida contra /users/me antes de persistir; si el token no es
//            legítimo tira 400 sin escribir nada.
//   PATCH  ?action=save-widget-settings → apariencia del widget (PARCIAL: merge de lo que viene)
//   PATCH  ?action=save-settings        → settings operativos (parcial: solo lo que viene)
//          (acepta `retention`, `widget_texts`, los legacy widget_*_title/subtitle/
//          disclaimer → se mapean a widget_texts; `email_accent` se ignora: el mail usa widget_color)
//   POST   ?action=import-shipping-rates { rates? } → importa los envíos de Shopify a
//          checkout_shipping_rates (máx 6, dedup por nombre) → { rates, note? }
//   PATCH  ?action=save-discount-codes  → códigos de descuento
//   POST   ?action=test-email           → mail de prueba (activación; solo al dueño, 10/día)
//   POST   ?action=mp-oauth-start       → { url } para conectar MP por OAuth
//   POST   ?action=disconnect-mp | disconnect-shopify
//   Klaviyo (solo dueño; reemplaza al recupero de carritos propio, retirado 2026-09-13):
//   POST   ?action=save-klaviyo       { api_key, send_orders? } → valida la Private API Key y la guarda
//   POST   ?action=disconnect-klaviyo
//   POST   ?action=klaviyo-test       → manda un "Checkout Started" de prueba al mail del dueño
//   (save-settings acepta `klaviyo_send_orders`; `abandoned_enabled` / `abandoned_coupons` se ignoran)
//   POST   ?action=save-owner    { owner_name, owner_whatsapp, contact_email } → datos de contacto del dueño del LOGIN (se piden al registrarse)
//   POST   ?action=plan-request  { plan: "starter"|"growth"|"pro" } → pide un plan del SaaS (mail al admin)
//   Flujos de email propios (_lib/flowsApi.js): GET ?action=flows · POST ?action=flow-save | flow-delete | flow-test
//   WhatsApp Cloud API (_lib/whatsappApi.js): GET ?action=whatsapp-templates · POST ?action=whatsapp-save | whatsapp-disconnect | whatsapp-test
//
//   Multi-tienda (actúan sobre el PERFIL = uid del token, no sobre la tienda activa):
//   POST   ?action=store-create   { name, color }             → crea merchants/m_xxx
//   POST   ?action=store-activate { merchant_id }             → setea active_merchant_id
//   POST   ?action=store-rename   { merchant_id, name, color, photo? }
//   POST   ?action=store-delete   { merchant_id }             → soft delete (30 días)
//   POST   ?action=account-delete { confirm:"ELIMINAR" }
//   Equipo (sobre la tienda ACTIVA, solo dueño):
//   POST   ?action=member-invite  { email, name, secciones? }
//   POST   ?action=member-update  { member_uid, secciones }
//   POST   ?action=member-remove  { member_uid | email }
//   Transferir una tienda a otra cuenta (_lib/transfer.js; auth propia, antes de requireMerchant):
//   POST   ?action=transfer-start   { merchant_id, email, keep_access } · transfer-cancel { merchant_id }
//   GET    ?action=transfer-info&t= · POST transfer-accept { t } · transfer-decline { t }
//
// Todas las requests pasan por requireMerchant: el merchant activo sale del
// header X-Merchant-Id (o el uid del login si no viene → sin cambios para
// cuentas históricas como Lumina).
import { FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { db, requireMerchant, resolveMerchantAccess, clearMerchantCache, getOrCreateMerchant } from "./_lib/firebase.js";
import { mpMe } from "./_lib/mp.js";
import { emailSubscriptionActivated, emailTeamInvite, emailPlanRequest, effectiveBrand, effectiveFrom } from "./_lib/email.js";
import { shGetShopInfo, buildShopInfoPatch, shopifyRatesForPanel } from "./_lib/shopify.js";
import { REASON_CODE_RE, retentionFor } from "./_lib/retention.js";
import { PLAN_BY_ID, buildBilling } from "./_lib/plans_saas.js";
import { saasStripeAvailable, createSaasCheckout, createSaasPortal } from "./_lib/saasBilling.js";
import { BILLABLE_STATUSES } from "../shared/platform/pricing.js";
import { logEmail } from "./_lib/emaillog.js";
import { signToken } from "./_lib/token.js";
import { appBaseUrl } from "./_lib/config.js";
import { rateLimit } from "./_lib/ratelimit.js";
import { klaviyoEnabled, klaviyoValidateKey, klaviyoCheckoutStarted } from "./_lib/klaviyo.js";
import { merchantProfile, validateProfilePatch } from "../shared/platform/profile.js";
import { flowsApi } from "./_lib/flowsApi.js";
import { mobbexSafeFields, saveMobbex, disconnectMobbex } from "./_lib/providers/merchantActions.js";
import { startMpOauth, mpOauthConfigured, mpConnectionStatus } from "./_lib/mpOauth.js";
import { whatsappApi } from "./_lib/whatsappApi.js";
import { whatsappSafe } from "./_lib/whatsapp.js";
import { merchantAlertsApi, alertsSafe } from "./_lib/merchantAlerts.js";
import { transferApi, publicPending } from "./_lib/transfer.js";
import { providerFlags, providerConnectAction, PROVIDER_CONNECT_ACTIONS, STRIPE_CALLBACK_ACTION, stripeConnectCallback } from "./_lib/providers/stripeWhopApi.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Stripe Connect vuelve acá sin Bearer (redirect del navegador): el merchant sale del state firmado.
  if (req.method === "GET" && String(req.query?.action || "") === STRIPE_CALLBACK_ACTION) return stripeConnectCallback(req, res);
  // Transferir tienda a otra cuenta (_lib/transfer.js): cada acción hace su propia auth.
  const qAction = String(req.query?.action || "");
  if (qAction.startsWith("transfer-")) return transferApi(req, res, { secciones: SECCIONES, storeName: storeDisplayName });
  // Acciones de PERFIL: andan aunque la tienda principal del login haya sido transferida (ctx sin tienda).
  const ctx = await requireMerchant(req, res, undefined, { allowNoStore: NO_STORE_ACTIONS.includes(qAction) });
  if (!ctx) return;
  // uid = login (perfil). merchantId = tienda activa (== uid si no hay header).
  const { uid, merchantId } = ctx;

  if (req.method === "GET") {
    const gAction = String(req.query.action || "");
    if (gAction === "workspace") return workspace(ctx, req, res);
    if (gAction === "members")   return membersList(ctx, req, res);
    if (gAction === "refresh-shop") return refreshShop(ctx, res);
    if (gAction === "flows") return flowsApi(ctx, "flows", req, res);
    if (gAction === "whatsapp-templates" || gAction === "whatsapp-usage") return whatsappApi(ctx, gAction, req, res);
    if (gAction && gAction !== "me") return res.status(400).json({ error: "action no reconocida" });
    try {
      // El doc del perfil se crea acá (primer login). Tiendas ajenas/extra ya existen
      // (requireMerchant las validó), así que el create solo aplica a merchantId === uid.
      const merchant = await getOrCreateMerchant(merchantId, merchantId === uid ? ctx.email : null);
      // Plan del SaaS (trial/beta/starter/growth/pro) + pedidos del mes. Solo dashboard.
      const billing = await billingFor(merchantId, merchant);
      // Datos de contacto del dueño del LOGIN (doc de perfil merchants/{uid}); se piden al registrarse.
      const ownerDoc = merchant.id === uid ? merchant : ((await db().collection("merchants").doc(uid).get().catch(() => null))?.data() || {});
      // No devolvemos tokens raw — solo flags de "conectado".
      const safe = {
        id: merchant.id,
        email: merchant.email,
        plan: merchant.plan,
        created_at: merchant.created_at,
        billing,
        // Multi-tienda
        role: ctx.role,                                  // "owner" | "member"
        is_primary: merchant.is_store !== true,          // doc principal de un login (no m_xxx)
        is_self: merchant.id === uid,                    // es MI doc de perfil
        store_name: merchant.store_name || "",
        store_color: merchant.store_color || merchant.widget_color || "#10b981",
        store_photo: merchant.store_photo || null,
        owner_name: ownerDoc.owner_name || "",
        owner_whatsapp: ownerDoc.owner_whatsapp || "",
        contact_email: ownerDoc.contact_email || "",
        owner_info_missing: !ownerDoc.owner_whatsapp,
        owner_uid: merchant.ownerUid || merchant.id,
        member_secciones: ctx.role === "member" ? (ctx.member?.secciones ? cleanSecciones(ctx.member.secciones) : null) : null, // null = acceso total (legacy)
        shopify_shop: merchant.shopify_shop || null,
        shopify_token: merchant.shopify_token ? "•••••" : null,
        shopify_connected_at: merchant.shopify_connected_at || null,
        // Última vez que widget.js cargó en la tienda (beacon) → verificación de la instalación.
        internal: merchant.internal === true,   // tienda propia: sin cargo, fuera de los números del Admin
        widget_installed_ack: merchant.widget_installed_ack === true,   // widget ya puesto (ej. desarrollo a medida): no mostrar el aviso del snippet
        widget_last_seen_at: merchant.widget_last_seen_at || null,
        widget_last_seen_host: merchant.widget_last_seen_host || null,
        shopify_has_own_app: !!(merchant.shopify_client_id && merchant.shopify_client_secret),
        shopify_env_app: !!(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET),
        shopify_scope: merchant.shopify_scope || null,   // permisos que dio Shopify (no es secreto): el panel sugiere reconectar si falta alguno
        // Datos de la tienda leídos de shop.json (OAuth / save-creds / refresh-shop).
        shop_name: merchant.shop_name || null,
        shop_email: merchant.shop_email || null,
        shop_currency: merchant.shop_currency || null,
        shop_country: merchant.shop_country || null,
        shop_timezone: merchant.shop_timezone || null,
        shop_info_at: merchant.shop_info_at || null,
        shopify_domains: Array.isArray(merchant.shopify_domains) ? merchant.shopify_domains : [],
        mp_user_id: merchant.mp_user_id || null,
        mp_email: merchant.mp_email || null,
        mp_country: merchant.mp_country || null,
        mp_access_token: merchant.mp_access_token ? "•••••" : null,
        mp_connected_at: merchant.mp_connected_at || null,
        mp_method: merchant.mp_method || (merchant.mp_access_token ? "manual" : null),
        mp_oauth_available: mpOauthConfigured(),
        // OAuth: modo (prueba/producción), vencimiento y si hay que reconectar (_lib/mpOauth.js). Sin tokens.
        mp_live_mode: typeof merchant.mp_live_mode === "boolean" ? merchant.mp_live_mode : null,
        mp_token_expires_at: merchant.mp_method === "oauth" ? (merchant.mp_token_expires_at || null) : null,
        ...mpConnectionStatus(merchant),
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
        // "templates" (diseñador) | "custom" (desarrollo a medida). Vacío = según la cuenta.
        widget_source: merchant.widget_source || "",
        // "redirect" (botón → página de checkout on-store) | "inline". "page" legacy = redirect.
        widget_checkout_flow: normCheckoutFlow(merchant.widget_checkout_flow),
        widget_checkout_page_path: merchant.widget_checkout_page_path || "",
        // Widget de packs (bundle) — ver shared/bundle/SPEC.md
        widget_variant: WIDGET_VARIANT_RE.test(String(merchant.widget_variant || "")) ? merchant.widget_variant : "v01",
        // widget_texts guardados; si están vacíos, derivados de los textos legacy
        // (widget_sub_title → sub_label, etc.) para que el diseñador único arranque
        // con lo que el comerciante ya tenía.
        widget_texts: mergedWidgetTexts(merchant),
        widget_show_compare: merchant.widget_show_compare !== false,
        widget_show_per_unit: merchant.widget_show_per_unit !== false,
        widget_radius: Number.isInteger(merchant.widget_radius) ? Math.max(0, Math.min(32, merchant.widget_radius)) : 14,
        // Códigos de descuento del merchant (para el checkout de suscripción)
        discount_codes: Array.isArray(merchant.discount_codes) ? merchant.discount_codes : [],
        // Klaviyo (recupero de carritos + eventos de suscripción). NUNCA la key.
        klaviyo_connected: klaviyoEnabled(merchant),
        klaviyo_org: klaviyoEnabled(merchant) ? (merchant.klaviyo_org || "") : "",
        klaviyo_connected_at: klaviyoEnabled(merchant) ? (merchant.klaviyo_connected_at || null) : null,
        klaviyo_send_orders: merchant.klaviyo_send_orders === true,
        klaviyo_last_error: klaviyoEnabled(merchant) ? (merchant.klaviyo_last_error || null) : null,
        klaviyo_last_error_at: klaviyoEnabled(merchant) ? (merchant.klaviyo_last_error_at || null) : null,
        // Settings operativos (mails, envíos del checkout). El recupero de carritos
        // propio (abandoned_enabled / abandoned_coupons) se retiró el 2026-09-13.
        email_from: merchant.email_from || "",
        email_brand: merchant.email_brand || "",
        email_reply_to: merchant.email_reply_to || "",
        // Defaults derivados (calculados, NO se escriben). El dominio del remitente
        // sigue siendo el nuestro (EMAIL_FROM) hasta Resend multi-merchant; solo
        // personalizamos el nombre visible (ver _lib/email.js effectiveFrom).
        email_brand_effective: effectiveBrand(merchant),
        email_from_effective: effectiveFrom(merchant),
        store_domain_effective: effectiveStoreDomain(merchant),
        checkout_shipping_rates: Array.isArray(merchant.checkout_shipping_rates) ? merchant.checkout_shipping_rates : [],
        store_domain: merchant.store_domain || "",
        store_domain_source: merchant.store_domain_source === "manual" || merchant.store_domain_source === "shopify" ? merchant.store_domain_source : (merchant.store_domain ? "manual" : null),
        // Retención al cancelar (portal): motivos + oferta de pausa. Defaults si no configuró.
        retention: retentionFor(merchant),
        portal: {
          allow_pause: merchant.portal?.allow_pause !== false,
          allow_cancel: merchant.portal?.allow_cancel !== false,
          allow_address: merchant.portal?.allow_address !== false,
        },
        portal_welcome: merchant.portal_welcome || "",
        dev_mode: merchant.dev_mode === true,
        requires_email_verification: merchant.requires_email_verification === true,
        // Perfil del negocio (shared/platform/profile.js). null = histórico → físico + Shopify + MP.
        business_type: merchant.business_type || null,
        channel: merchant.channel || null,
        payment_provider: merchant.payment_provider || null,
        // Mobbex (pasarela alternativa, env MOBBEX_ENABLED): solo flags, nunca las claves.
        ...mobbexSafeFields(merchant),
        // WhatsApp Cloud API (_lib/whatsapp.js): flags y datos del número, NUNCA el token.
        ...whatsappSafe(merchant),
        // Avisos para el dueño (alta / pausa / baja / pago rechazado) — _lib/merchantAlerts.js.
        ...alertsSafe(merchant, ownerDoc),
        // Super-admin (ADMIN_EMAILS, validado en requireMerchant): habilita #/admin.
        // admin_view = "ver como" activo (solo lectura).
        is_admin: ctx.is_admin === true,
        admin_view: ctx.admin_view === true,
        // Stripe / Whop (USD): flags de env + estado de conexión. Nunca claves.
        ...(await providerFlags(merchant)),
        // Tiendanube (api/_lib/tiendanube.js). `tiendanube_enabled` = existe la app de Partner
        // (env): habilita el canal en el panel (shared/platform/profile.js channelAvailable).
        tiendanube_enabled: !!(process.env.TIENDANUBE_APP_ID && process.env.TIENDANUBE_CLIENT_SECRET),
        tiendanube_store_id: merchant.tiendanube_store_id || null,
        tiendanube_token: merchant.tiendanube_token ? "•••••" : null,
        tiendanube_store_name: merchant.tiendanube_store_name || null,
        tiendanube_store_url: merchant.tiendanube_store_url || null,
        tiendanube_connected_at: merchant.tiendanube_connected_at || null,
        tiendanube_script_configured: !!process.env.TIENDANUBE_SCRIPT_ID,
        tiendanube_script_installed: !!merchant.tiendanube_script_installed_at,
        tiendanube_script_error: merchant.tiendanube_script_error || null,
      };
      return res.json({ merchant: safe });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "PATCH" || req.method === "POST") {
    const action = String(req.query.action || "");
    // Integraciones: solo el dueño (propio o viaOwner). Un miembro del equipo no
    // conecta/desconecta MP ni Shopify de una tienda ajena.
    const ownerOnly = ["save-mp-token", "mp-reuse", "saas-checkout", "saas-portal", "mp-oauth-start", "disconnect-mp", "disconnect-shopify", "save-meta", "save-klaviyo", "disconnect-klaviyo", "klaviyo-test", "import-shipping-rates"];
    if (ownerOnly.includes(action) && ctx.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
    // El perfil del negocio (tipo / canal / pasarela) cambia cómo se cumple cada cobro: solo el dueño.
    if (action === "save-settings" && ctx.role !== "owner" && ["business_type", "channel", "payment_provider"].some(k => k in (req.body || {}))) {
      return res.status(403).json({ error: "Solo el dueño de la tienda puede cambiar el tipo de negocio." });
    }

    // Mobbex (api/_lib/providers): credenciales de la pasarela, solo el dueño.
    if ((action === "save-mobbex" || action === "disconnect-mobbex") && ctx.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
    if (action === "save-mobbex")          return saveMobbex(merchantId, req, res);
    if (action === "disconnect-mobbex")    return disconnectMobbex(merchantId, res);
    if (action === "save-mp-token")        return saveMpToken(merchantId, req, res);
    if (action === "mp-reuse")             return mpReuse(ctx, merchantId, req, res);
    if (action === "save-klaviyo" || action === "klaviyo-test") return res.status(410).json({ error: "Klaviyo ya no está disponible: los mails los manda Recurrentes (Flujos de email)." });
    if (action === "disconnect-klaviyo")   return disconnectKlaviyo(merchantId, res);
    if (action === "save-widget-settings") return saveWidgetSettings(merchantId, req, res);
    if (action === "save-settings")        return saveSettings(merchantId, req, res);
    if (action === "import-shipping-rates") return importShippingRates(merchantId, req, res);
    if (action === "save-meta")            return saveMeta(merchantId, req, res);
    if (action === "save-discount-codes")  return saveDiscountCodes(merchantId, req, res);
    if (action === "test-email")           return testEmail(merchantId, req, res);
    if (action === "backfill-email-log")   return backfillEmailLog(merchantId, req, res);
    if (action === "mp-oauth-start")       return mpOauthStart(ctx, req, res);
    if (action === "disconnect-mp")        return disconnect(merchantId, "mp", res);
    if (action === "disconnect-shopify")   return disconnect(merchantId, "shopify", res);
    if (action === "plan-request")         return planRequest(ctx, merchantId, req, res);
    if (action === "saas-checkout")        return saasCheckout(ctx, merchantId, req, res);
    if (action === "saas-portal")          return saasPortal(ctx, merchantId, req, res);
    if (action === "save-owner")           return saveOwner(ctx, req, res);
    if (action.startsWith("flow-"))        return flowsApi(ctx, action, req, res);
    if (action.startsWith("whatsapp-"))    return whatsappApi(ctx, action, req, res);
    if (action.startsWith("alerts-"))      return merchantAlertsApi(ctx, action, req, res); // avisos para el dueño (solo dueño)
    if (PROVIDER_CONNECT_ACTIONS.has(action)) return providerConnectAction(ctx, action, req, res); // Stripe / Whop (solo dueño)

    // Multi-tienda / equipo
    if (action === "store-create")   return storeCreate(ctx, req, res);
    if (action === "store-activate") return storeActivate(ctx, req, res);
    if (action === "store-rename")   return storeRename(ctx, req, res);
    if (action === "store-delete")   return storeDelete(ctx, req, res);
    if (action === "account-delete") return accountDelete(ctx, req, res);
    if (action === "member-invite")  return memberInvite(ctx, req, res);
    if (action === "member-update")  return memberUpdate(ctx, req, res);
    if (action === "member-remove")  return memberRemove(ctx, req, res);
    return res.status(400).json({ error: "action no reconocida" });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ─── Billing del SaaS (tramos por suscriptores activos) ─────────────────────
// El precio sale de los SUSCRIPTORES ACTIVOS de la tienda (status active o
// payment_failed; ver shared/platform/pricing.js). Solo informa al dashboard:
// el widget, el checkout, los webhooks y el cron NUNCA miran esto.
const BILLING_CACHE_MS = 5 * 60 * 1000;

// Cuenta los suscriptores activos con una agregación count() (no baja los docs).
// Cache 5 min en el doc (`billing_cache.subs`) para no contar en cada GET.
export async function activeSubscribers(merchantId, merchant) {
  const c = merchant.billing_cache;
  if (c && Number.isFinite(Number(c.subs)) && c.at && Date.now() - Date.parse(c.at) < BILLING_CACHE_MS) return Number(c.subs);
  const ref = db().collection("merchants").doc(merchantId);
  const agg = await ref.collection("subscribers").where("status", "in", BILLABLE_STATUSES).count().get();
  const subs = Number(agg.data().count) || 0;
  ref.set({ billing_cache: { subs, at: new Date().toISOString() } }, { merge: true }).catch(e => console.warn("[billing] cache:", e.message));
  return subs;
}

// Nunca tira: si falla el conteo, usa el último cache (o 0) y sigue.
async function billingFor(merchantId, merchant) {
  let subs = 0;
  try { subs = await activeSubscribers(merchantId, merchant); }
  catch (e) { console.warn("[billing] count:", e.message); subs = Number(merchant?.billing_cache?.subs) || 0; }
  return buildBilling(merchant, subs, { stripeAvailable: saasStripeAvailable() });
}

// POST ?action=saas-checkout { plan } → URL de Stripe Checkout (suscripción mensual
// del tramo). Solo con STRIPE_SAAS_SECRET_KEY; si no, el panel usa plan-request.
async function saasCheckout(ctx, merchantId, req, res) {
  if (!saasStripeAvailable()) return res.status(400).json({ error: "El pago con tarjeta todavía no está habilitado. Usá Activar plan y te contactamos." });
  const plan = String(req.body?.plan || "").trim().toLowerCase();
  if (!PLAN_BY_ID[plan]) return res.status(400).json({ error: "Plan inválido." });
  try {
    const merchant = await getOrCreateMerchant(merchantId, null);
    const url = await createSaasCheckout({ merchantId, merchant, tierId: plan, email: merchant.email || ctx.email || "", returnOrigin: req.body?.return_origin });
    return res.json({ ok: true, url });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}
// POST ?action=saas-portal → portal de facturación de Stripe (tarjeta, facturas, baja).
async function saasPortal(ctx, merchantId, req, res) {
  try {
    const merchant = await getOrCreateMerchant(merchantId, null);
    if (!merchant.saas_stripe_customer_id) return res.status(400).json({ error: "Esta cuenta no paga con tarjeta todavía." });
    const url = await createSaasPortal({ merchant, returnOrigin: req.body?.return_origin });
    return res.json({ ok: true, url });
  } catch (e) { return res.status(500).json({ error: e.message }); }
}

// POST ?action=plan-request { plan } → guarda plan_requested(+_at) y avisa al
// admin por mail. Idempotente por día (mismo plan pedido hoy → no reenvía).
async function planRequest(ctx, merchantId, req, res) {
  const plan = String(req.body?.plan || "").trim().toLowerCase();
  const p = PLAN_BY_ID[plan];
  if (!p) return res.status(400).json({ error: `Plan inválido. Opciones: ${Object.keys(PLAN_BY_ID).join(", ")}.` });
  const OK_MSG = "Te contactamos en el día para activarlo. Mientras tanto tu cuenta sigue funcionando.";
  try {
    const ref = db().collection("merchants").doc(merchantId);
    const merchant = await getOrCreateMerchant(merchantId, null);
    const now = new Date().toISOString();
    if (merchant.plan_requested === plan && String(merchant.plan_requested_at || "").slice(0, 10) === now.slice(0, 10)) {
      return res.json({ ok: true, already: true, plan, message: OK_MSG });
    }
    const rl = await rateLimit(`planreq:${merchantId}`, { limit: 10, windowSec: 86400 });
    if (!rl.ok) return res.status(429).json({ error: "Ya recibimos varios pedidos hoy. Te contactamos a la brevedad." });

    const billing = await billingFor(merchantId, merchant);
    await ref.set({ plan_requested: plan, plan_requested_at: now, plan_requested_by: ctx.email || null }, { merge: true });

    const adminRaw = String(process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || "");
    const to = (adminRaw.match(/<([^>]+)>/) || [])[1] || adminRaw.trim();
    let mail = { skipped: true };
    if (to) {
      mail = await emailPlanRequest({
        to,
        merchantEmail: merchant.email || ctx.email || "",
        merchantId,
        storeName: merchant.store_name || merchant.shopify_shop || "",
        plan, planLabel: p.label, usd: p.usd,
        activeSubscribers: billing.active_subscribers,
        currentPlan: billing.plan_label,
        requesterEmail: ctx.email || "",
      });
      if (mail?.error) console.error("[plan-request] mail:", mail.error);
    } else {
      console.warn("[plan-request] sin ADMIN_EMAIL/EMAIL_FROM: quedó solo en Firestore (plan_requested)");
    }
    return res.json({ ok: true, plan, message: OK_MSG, mail_sent: mail?.ok === true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── OAuth MP: arma la URL de autorización (state firmado {mid, uid} + nonce de un
// solo uso + PKCE S256, ver _lib/mpOauth.js). El callback vive en /api/mp/oauth-callback.
// body { return_origin? } → a qué dominio volver (solo los nuestros).
async function mpOauthStart(ctx, req, res) {
  try {
    const r = await startMpOauth({ mid: ctx.merchantId, uid: ctx.uid, returnTo: req.body?.return_origin });
    if (r.error) return res.status(400).json({ error: r.error });
    return res.json({ url: r.url });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Desconectar: borra tokens y marca la fecha. Las subs siguen en MP.
async function disconnect(merchantId, which, res) {
  const now = new Date().toISOString();
  const patch = which === "mp"
    ? { mp_access_token: FieldValue.delete(), mp_refresh_token: FieldValue.delete(), mp_token_expires_at: FieldValue.delete(), mp_public_key: FieldValue.delete(), mp_disconnected_at: now,
        mp_live_mode: FieldValue.delete(), mp_scope: FieldValue.delete(), mp_reconnect_required_at: FieldValue.delete(), mp_reconnect_reason: FieldValue.delete(),
        mp_token_invalid_at: FieldValue.delete(), mp_token_error: FieldValue.delete(), mp_token_refresh_error: FieldValue.delete(), mp_token_refresh_error_at: FieldValue.delete() }
    : { shopify_token: FieldValue.delete(), shopify_scope: FieldValue.delete(), shopify_disconnected_at: now };
  try {
    await db().collection("merchants").doc(merchantId).set(patch, { merge: true });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Klaviyo ─────────────────────────────────────────────────────────────────
// POST ?action=save-klaviyo { api_key, send_orders? } → valida la Private API Key
// contra GET /accounts/ y la guarda. Nunca se devuelve la key al front.
async function saveKlaviyo(merchantId, req, res) {
  const key = String(req.body?.api_key || "").trim();
  if (!key) return res.status(400).json({ error: "Pegá tu Private API Key de Klaviyo (empieza con pk_)" });
  const v = await klaviyoValidateKey(key);
  if (!v.ok) return res.status(400).json({ error: v.error || "Klaviyo no aceptó la clave" });
  const now = new Date().toISOString();
  try {
    await db().collection("merchants").doc(merchantId).set({
      klaviyo_api_key: key,
      klaviyo_org: v.organization || "",
      klaviyo_account_id: v.account_id || null,
      klaviyo_connected_at: now,
      klaviyo_disconnected_at: null,
      klaviyo_last_error: null, klaviyo_last_error_at: null, klaviyo_last_error_status: null,
      ...(typeof req.body?.send_orders === "boolean" ? { klaviyo_send_orders: req.body.send_orders } : {}),
      updated_at: now,
    }, { merge: true });
    clearMerchantCache(merchantId);
    return res.json({ ok: true, klaviyo_connected: true, klaviyo_org: v.organization || "", klaviyo_connected_at: now });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// POST ?action=disconnect-klaviyo → borra la key; los eventos dejan de salir.
async function disconnectKlaviyo(merchantId, res) {
  try {
    await db().collection("merchants").doc(merchantId).set({
      klaviyo_api_key: FieldValue.delete(),
      klaviyo_org: FieldValue.delete(),
      klaviyo_account_id: FieldValue.delete(),
      klaviyo_last_error: FieldValue.delete(), klaviyo_last_error_at: FieldValue.delete(), klaviyo_last_error_status: FieldValue.delete(),
      klaviyo_disconnected_at: new Date().toISOString(),
    }, { merge: true });
    clearMerchantCache(merchantId);
    return res.json({ ok: true, klaviyo_connected: false });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// POST ?action=klaviyo-test → "Checkout Started" de prueba ($value 1, extra.test)
// al mail del dueño, con el primer plan activo como producto. 20/día.
async function klaviyoTest(merchantId, req, res) {
  const merchant = await getOrCreateMerchant(merchantId, null);
  if (!klaviyoEnabled(merchant)) return res.status(400).json({ error: "Conectá Klaviyo primero" });
  const to = String(merchant.email || "").trim().toLowerCase();
  if (!to || !EMAIL_RE.test(to)) return res.status(400).json({ error: "La cuenta no tiene un email válido para la prueba" });
  const rl = await rateLimit(`klaviyotest:${merchantId}`, { limit: 20, windowSec: 86400 });
  if (!rl.ok) return res.status(429).json({ error: "Tope de 20 eventos de prueba por día alcanzado" });

  let plan = null;
  try {
    const ps = await db().collection("merchants").doc(merchantId).collection("plans").where("active", "==", true).limit(1).get();
    if (!ps.empty) plan = { id: ps.docs[0].id, ...ps.docs[0].data() };
  } catch (_) {}
  const host = merchant.store_domain || merchant.shopify_shop || "";
  const path = String(merchant.widget_checkout_page_path || "/pages/suscripcion-form").trim();
  const recoverUrl = host ? `https://${host}${path}` : appBaseUrl();
  const fakeSub = {
    customer_email: to,
    customer_name: "Prueba Recurrentes",
    plan_id: plan?.id || null,
    quantity: 1,
    plan_snapshot: {
      product_title: plan?.product_title || "Producto de prueba",
      shopify_product_id: plan?.shopify_product_id || null,
      shopify_variant_id: plan?.shopify_variant_id || null,
      frequency_days: parseInt(plan?.frequency_days) || 30,
      total_per_charge_ars: 1, subtotal_ars: 1, shipping_price_ars: 0,
    },
  };
  const r = await klaviyoCheckoutStarted(merchant, merchantId, `test_${Date.now()}`, fakeSub, {
    recoverUrl, imageUrl: plan?.product_image || null, stage: "test", test: true,
  });
  if (!r?.ok) return res.status(502).json({ error: r?.error || "Klaviyo rechazó el evento", status: r?.status || null });
  return res.json({ ok: true, status: r.status, metric: "Checkout Started", to, remaining: rl.remaining });
}

async function saveMeta(merchantId, req, res) {
  // Guarda el Pixel ID + token de la API de Conversiones (CAPI) del merchant,
  // para reportar a Meta la PRIMERA venta de cada suscripción (server-side).
  // Pasar strings vacíos desconecta (borra las credenciales).
  const { meta_pixel_id, meta_capi_token } = req.body || {};
  const pixel = (typeof meta_pixel_id === "string" ? meta_pixel_id : "").replace(/\D/g, "").slice(0, 32);
  const token = (typeof meta_capi_token === "string" ? meta_capi_token : "").trim().slice(0, 500);
  try {
    await db().collection("merchants").doc(merchantId).set({
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

async function saveWidgetSettings(merchantId, req, res) {
  // Preferencias UX del widget storefront a nivel merchant. PARCIAL desde
  // 2026-09-13: solo se escriben las claves que vienen en el body (antes pisaba
  // todo con defaults). Los textos legacy también se espejan en widget_texts
  // (sub_label / once_label / trust_lines) para el diseñador único.
  const b = req.body || {};
  const out = {};
  if ("widget_mode_order" in b) out.widget_mode_order = ["sub_first", "once_first"].includes(b.widget_mode_order) ? b.widget_mode_order : "sub_first";
  if ("widget_mode_default" in b) out.widget_mode_default = ["sub", "once"].includes(b.widget_mode_default) ? b.widget_mode_default : "sub";
  if ("widget_color" in b) {
    const colorOk = typeof b.widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.widget_color.trim());
    out.widget_color = colorOk ? b.widget_color.trim() : "#10b981";
  }
  // Textos: trim + cap a 60 / 120 chars. Vacío en título = default.
  if ("widget_sub_title" in b) out.widget_sub_title = (typeof b.widget_sub_title === "string" ? b.widget_sub_title : "").trim().slice(0, 60) || "Suscripción";
  if ("widget_sub_subtitle" in b) out.widget_sub_subtitle = (typeof b.widget_sub_subtitle === "string" ? b.widget_sub_subtitle : "").trim().slice(0, 120);
  if ("widget_once_title" in b) out.widget_once_title = (typeof b.widget_once_title === "string" ? b.widget_once_title : "").trim().slice(0, 60) || "Compra única";
  if ("widget_once_subtitle" in b) out.widget_once_subtitle = (typeof b.widget_once_subtitle === "string" ? b.widget_once_subtitle : "").trim().slice(0, 120) || "Comprá una vez al precio normal.";
  // Disclaimer banner — texto libre, cap a 800 chars. "" = usar default armado.
  if ("widget_disclaimer_text" in b) out.widget_disclaimer_text = (typeof b.widget_disclaimer_text === "string" ? b.widget_disclaimer_text : "").trim().slice(0, 800);
  if (!Object.keys(out).length) return res.status(400).json({ error: "Nada para guardar" });
  try {
    const ref = db().collection("merchants").doc(merchantId);
    const current = (await ref.get()).data() || {};
    // Espejo en widget_texts (merge con lo guardado) si vino algún texto legacy.
    const legacy = legacyWidgetTexts({ ...current, ...out }) || {};
    const hasLegacyKey = LEGACY_WIDGET_TEXT_KEYS.some(k => k in out);
    let mergedTexts = hasLegacyKey ? mergeWidgetTexts(sanitizeWidgetTexts(current.widget_texts).texts, legacy, { legacyOverrides: true }) : undefined;
    if (mergedTexts) {
      if ("widget_sub_title" in out && !legacy.sub_label) delete mergedTexts.sub_label;
      if ("widget_once_title" in out && !legacy.once_label) delete mergedTexts.once_label;
      if (!Object.keys(mergedTexts).length) mergedTexts = null;
    }
    await ref.set({
      ...out,
      ...(mergedTexts !== undefined ? { widget_texts: mergedTexts } : {}),
      updated_at: new Date().toISOString(),
    }, { merge: true });
    const merged = { ...current, ...out };
    return res.json({
      ok: true,
      widget_mode_order: merged.widget_mode_order || "sub_first",
      widget_mode_default: merged.widget_mode_default || "sub",
      widget_color: merged.widget_color || "#10b981",
      widget_sub_title: merged.widget_sub_title || "Suscripción",
      widget_sub_subtitle: merged.widget_sub_subtitle || "",
      widget_once_title: merged.widget_once_title || "Compra única",
      widget_once_subtitle: merged.widget_once_subtitle || "Comprá una vez al precio normal.",
      widget_disclaimer_text: merged.widget_disclaimer_text || "",
      ...(mergedTexts !== undefined ? { widget_texts: mergedTexts } : {}),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
// "Nombre <mail@dominio>"
const FROM_RE = /^[^<>]{1,60}<([^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)>$/;
const normHost = (v) => String(v || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");

// Widget de packs (bundle) — ver shared/bundle/SPEC.md.
const WIDGET_VARIANT_RE = /^v(0[1-9]|10)$/;
const WIDGET_TEXT_KEYS = ["headline", "once_label", "sub_label", "cta_once", "cta_sub", "savings_label", "per_unit_label", "freq_prefix"];
const WIDGET_TEXT_MAX = 80, WIDGET_TRUST_MAX = 60, WIDGET_TRUST_LINES_MAX = 4;
// Sanea `widget_texts`: solo claves conocidas, strings ≤ 80 (vacío = usar default
// → se omite), trust_lines ≤ 4 strings ≤ 60. Devuelve { texts } (null si nada) o { error }.
function sanitizeWidgetTexts(input) {
  if (input == null) return { texts: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "widget_texts debe ser un objeto" };
  const texts = {};
  for (const k of WIDGET_TEXT_KEYS) {
    if (!(k in input) || input[k] == null) continue;
    if (typeof input[k] !== "string") return { error: `widget_texts.${k} debe ser texto` };
    const v = input[k].trim().slice(0, WIDGET_TEXT_MAX);
    if (v) texts[k] = v;
  }
  if ("trust_lines" in input && input.trust_lines != null) {
    if (!Array.isArray(input.trust_lines)) return { error: "widget_texts.trust_lines debe ser un array" };
    const lines = input.trust_lines
      .filter(l => typeof l === "string")
      .map(l => l.trim().slice(0, WIDGET_TRUST_MAX))
      .filter(Boolean)
      .slice(0, WIDGET_TRUST_LINES_MAX);
    texts.trust_lines = lines; // [] explícito = sin líneas de confianza
  }
  return { texts: Object.keys(texts).length ? texts : null };
}

// ─── Textos legacy del widget → widget_texts ───────────────────────────────
// widget_sub_title → sub_label · widget_once_title → once_label ·
// widget_sub_subtitle / widget_once_subtitle / widget_disclaimer_text → trust_lines.
// Solo se toman los valores que el comerciante cambió (≠ defaults históricos).
const LEGACY_WIDGET_TEXT_KEYS = ["widget_sub_title", "widget_once_title", "widget_sub_subtitle", "widget_once_subtitle", "widget_disclaimer_text"];
const LEGACY_WIDGET_DEFAULTS = { widget_sub_title: "Suscripción", widget_once_title: "Compra única", widget_once_subtitle: "Comprá una vez al precio normal." };
function legacyWidgetTexts(m) {
  const pick = (k) => { const v = typeof m?.[k] === "string" ? m[k].trim() : ""; return v && v !== LEGACY_WIDGET_DEFAULTS[k] ? v : ""; };
  const out = {};
  const sub = pick("widget_sub_title"); if (sub) out.sub_label = sub.slice(0, WIDGET_TEXT_MAX);
  const once = pick("widget_once_title"); if (once) out.once_label = once.slice(0, WIDGET_TEXT_MAX);
  const lines = [pick("widget_sub_subtitle"), pick("widget_once_subtitle"), pick("widget_disclaimer_text")]
    .filter(Boolean).map(l => l.slice(0, WIDGET_TRUST_MAX)).slice(0, WIDGET_TRUST_LINES_MAX);
  if (lines.length) out.trust_lines = lines;
  return Object.keys(out).length ? out : null;
}
// Merge de textos: `over` pisa `base` clave por clave (trust_lines completo).
function mergeWidgetTexts(base, over, { legacyOverrides = false } = {}) {
  if (!base && !over) return null;
  const out = { ...(base || {}) };
  for (const [k, v] of Object.entries(over || {})) {
    if (!legacyOverrides && k in out) continue; // sin override: solo completa lo que falta
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
// GET: widget_texts guardados o, si están vacíos, los derivados de los legacy.
function mergedWidgetTexts(m) {
  const saved = sanitizeWidgetTexts(m?.widget_texts).texts;
  return saved || legacyWidgetTexts(m);
}

// "page" (nombre viejo) = "redirect". Cualquier otra cosa que no sea "inline" → redirect.
function normCheckoutFlow(v) { return v === "inline" ? "inline" : "redirect"; }

// Dominio efectivo de la tienda (sin escribir): el manual/importado, si no el
// dominio propio cacheado de Shopify (no myshopify), si no el myshopify.
function effectiveStoreDomain(m) {
  const own = normHost(m?.store_domain);
  if (own) return own;
  const list = (Array.isArray(m?.shopify_domains) ? m.shopify_domains : []).map(normHost).filter(Boolean);
  return list.find(h => !/\.myshopify\.com$/.test(h)) || list[0] || normHost(m?.shopify_shop) || "";
}

// ─── Retención al cancelar (portal del cliente) ────────────────────────────
// Defaults + lectura en _lib/retention.js (los comparte api/public.js).
// Valida el `retention` del body (parcial: se mergea con lo guardado). { value } | { error }.
function sanitizeRetention(input, current) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "retention debe ser un objeto" };
  const out = { ...retentionFor(current) };
  if ("enabled" in input) out.enabled = input.enabled !== false;
  if ("offer_pause" in input) out.offer_pause = input.offer_pause !== false;
  if ("pause_cycles" in input) {
    const c = Number(input.pause_cycles);
    if (!Number.isInteger(c) || c < 1 || c > 3) return { error: "retention.pause_cycles debe ser 1, 2 o 3" };
    out.pause_cycles = c;
  }
  if ("offer_discount_pct" in input) {
    const n = Number(input.offer_discount_pct);
    if (!Number.isInteger(n) || n < 0 || n > 90) return { error: "retention.offer_discount_pct debe ser un entero entre 0 y 90 (0 = sin oferta)" };
    out.offer_discount_pct = n;
  }
  if ("reasons" in input) {
    if (!Array.isArray(input.reasons)) return { error: "retention.reasons debe ser un array" };
    if (input.reasons.length > 8) return { error: "Máximo 8 motivos" };
    const seen = new Set();
    const reasons = [];
    for (const r of input.reasons) {
      const code = String(r?.code || "").trim();
      if (!REASON_CODE_RE.test(code)) return { error: `retention.reasons: código inválido "${code}" (usá minúsculas, números y _)` };
      if (seen.has(code)) continue;
      seen.add(code);
      const label = String(r?.label || "").trim().slice(0, 80);
      if (!label) return { error: `retention.reasons: falta label para "${code}"` };
      reasons.push({ code, label });
    }
    if (!reasons.length) return { error: "retention.reasons no puede quedar vacío" };
    out.reasons = reasons;
  }
  return { value: out };
}

// ─── Settings operativos. PARCIAL: solo escribe las claves que vienen en el
// body, así el front puede guardar una sección sin pisar las demás.
async function saveSettings(merchantId, req, res) {
  const b = req.body || {};
  const out = {};
  const bad = (msg) => res.status(400).json({ error: msg });
  // Doc actual (lazy, una sola lectura): lo usan store_domain, widget_texts legacy y retention.
  let _cur = null;
  const getCur = async () => { if (!_cur) _cur = (await db().collection("merchants").doc(merchantId).get()).data() || {}; return _cur; };

  // Retirados 2026-09-13 (recupero de carritos → Klaviyo): se aceptan y se ignoran
  // para no romper fronts viejos que todavía los manden.
  // email_accent también se retiró (2026-09-13): el mail usa widget_color.
  const ignored = ["abandoned_enabled", "abandoned_coupons", "email_accent"].filter(k => k in b);
  if ("dev_mode" in b) out.dev_mode = b.dev_mode === true;
  // Klaviyo: mandar también "Placed Order" (solo si su Klaviyo NO está conectado a Shopify).
  if ("klaviyo_send_orders" in b) out.klaviyo_send_orders = b.klaviyo_send_orders === true;

  // Perfil del negocio (shared/platform/profile.js): tipo, canal y pasarela. Dejar
  // Shopify con la tienda conectada corta la creación de órdenes → se confirma
  // explícitamente (409 confirm_channel_change → el panel pregunta y reenvía).
  if (["business_type", "channel", "payment_provider"].some(k => k in b)) {
    const cur = await getCur();
    const r = validateProfilePatch(cur, b);
    if (r.error) return bad(r.error);
    const before = merchantProfile(cur);
    if (before.channel === "shopify" && r.value.channel !== "shopify" && cur.shopify_token && b.confirm_channel_change !== true) {
      return res.status(409).json({
        code: "confirm_channel_change",
        error: "Tu Shopify está conectado. Si dejás de usarlo, los próximos cobros NO van a crear órdenes en Shopify: quedan como cobros registrados en Recurrentes. Las suscripciones siguen cobrando igual.",
      });
    }
    Object.assign(out, r.value);
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
    // Cargado a mano → refresh-shop no lo pisa. Vacío → vuelve a tomarse de Shopify.
    // Si el front reenvía el mismo valor que ya vino de Shopify, sigue siendo "shopify".
    const cur = await getCur();
    const unchanged = v && normHost(cur.store_domain) === v && cur.store_domain_source === "shopify";
    out.store_domain_source = v ? (unchanged ? "shopify" : "manual") : null;
  }
  if ("store_name" in b) out.store_name = String(b.store_name || "").trim().slice(0, 60);
  if ("widget_hide_selector" in b) out.widget_hide_selector = String(b.widget_hide_selector || "").trim().slice(0, 300);
  if ("widget_source" in b) out.widget_source = b.widget_source === "custom" ? "custom" : "templates";
  // "page" (nombre viejo del front) se acepta y se guarda como "redirect".
  if ("widget_checkout_flow" in b) out.widget_checkout_flow = normCheckoutFlow(b.widget_checkout_flow);
  if ("widget_checkout_page_path" in b) {
    const v = String(b.widget_checkout_page_path || "").trim().slice(0, 120);
    if (v && !v.startsWith("/")) return bad("widget_checkout_page_path debe empezar con /");
    out.widget_checkout_page_path = v;
  }
  // Widget de packs (bundle)
  if ("widget_variant" in b) {
    const v = String(b.widget_variant || "").trim().toLowerCase();
    if (!WIDGET_VARIANT_RE.test(v)) return bad("widget_variant debe ser v01..v10");
    out.widget_variant = v;
  }
  // Textos legacy del widget viejo: se guardan tal cual (el widget clásico los
  // sigue leyendo) Y se mapean a widget_texts (sub_label / once_label / trust_lines).
  const legacyIn = {};
  if ("widget_sub_title" in b) legacyIn.widget_sub_title = String(b.widget_sub_title ?? "").trim().slice(0, 60) || "Suscripción";
  if ("widget_once_title" in b) legacyIn.widget_once_title = String(b.widget_once_title ?? "").trim().slice(0, 60) || "Compra única";
  if ("widget_sub_subtitle" in b) legacyIn.widget_sub_subtitle = String(b.widget_sub_subtitle ?? "").trim().slice(0, 120);
  if ("widget_once_subtitle" in b) legacyIn.widget_once_subtitle = String(b.widget_once_subtitle ?? "").trim().slice(0, 120);
  if ("widget_disclaimer_text" in b) legacyIn.widget_disclaimer_text = String(b.widget_disclaimer_text ?? "").trim().slice(0, 800);
  Object.assign(out, legacyIn);
  if ("widget_texts" in b || Object.keys(legacyIn).length) {
    let texts = null;
    if ("widget_texts" in b) {
      const t = sanitizeWidgetTexts(b.widget_texts);
      if (t.error) return bad(t.error);
      texts = t.texts;
    } else {
      // Solo legacy: partimos de lo guardado para no perder claves del diseñador.
      texts = sanitizeWidgetTexts((await getCur()).widget_texts).texts;
    }
    if (Object.keys(legacyIn).length) {
      // El legacy pisa lo guardado (es lo que el comerciante acaba de escribir),
      // pero NO lo que vino explícito en widget_texts en este mismo body.
      const legacy = legacyWidgetTexts(legacyIn) || {};
      texts = "widget_texts" in b ? mergeWidgetTexts(texts, legacy) : mergeWidgetTexts(texts, legacy, { legacyOverrides: true });
      // Título vuelto al default → se quita el espejo (no queda un label viejo colgado).
      if (!("widget_texts" in b) && texts) {
        if ("widget_sub_title" in legacyIn && !legacy.sub_label) delete texts.sub_label;
        if ("widget_once_title" in legacyIn && !legacy.once_label) delete texts.once_label;
        if (!Object.keys(texts).length) texts = null;
      }
    }
    out.widget_texts = texts;
  }
  if ("retention" in b) {
    const r = sanitizeRetention(b.retention, await getCur());
    if (r.error) return bad(r.error);
    out.retention = r.value;
  }
  // Portal del cliente: qué puede hacer el cliente + mensaje de bienvenida.
  if ("portal" in b) {
    const pIn = (b.portal && typeof b.portal === "object" && !Array.isArray(b.portal)) ? b.portal : {};
    const curP = (await getCur()).portal || {};
    out.portal = {
      allow_pause: "allow_pause" in pIn ? pIn.allow_pause !== false : curP.allow_pause !== false,
      allow_cancel: "allow_cancel" in pIn ? pIn.allow_cancel !== false : curP.allow_cancel !== false,
      allow_address: "allow_address" in pIn ? pIn.allow_address !== false : curP.allow_address !== false,
    };
  }
  if ("portal_welcome" in b) out.portal_welcome = String(b.portal_welcome || "").slice(0, 300);
  // Color y modos del widget también por save-settings (un solo Guardar en el diseñador).
  if ("widget_mode_order" in b) out.widget_mode_order = ["sub_first", "once_first"].includes(b.widget_mode_order) ? b.widget_mode_order : "sub_first";
  if ("widget_mode_default" in b) out.widget_mode_default = ["sub", "once"].includes(b.widget_mode_default) ? b.widget_mode_default : "sub";
  if ("widget_color" in b && typeof b.widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(b.widget_color.trim())) out.widget_color = b.widget_color.trim();
  if ("widget_show_compare" in b) out.widget_show_compare = b.widget_show_compare !== false;
  if ("widget_show_per_unit" in b) out.widget_show_per_unit = b.widget_show_per_unit !== false;
  if ("widget_radius" in b) {
    const r = Number(b.widget_radius);
    if (!Number.isInteger(r) || r < 0 || r > 32) return bad("widget_radius debe ser un entero entre 0 y 32");
    out.widget_radius = r;
  }

  if (!Object.keys(out).length) return ignored.length ? res.json({ ok: true, ignored }) : bad("Nada para guardar");
  try {
    await db().collection("merchants").doc(merchantId).set({ ...out, updated_at: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, ...out, ...(ignored.length ? { ignored } : {}) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// POST ?action=import-shipping-rates  body { rates?: [{name, price, code?}] }
// Importa los métodos de envío de Shopify a checkout_shipping_rates (los que usa
// el checkout on-store). Si el body trae `rates` (selección del merchant en el
// panel) se guardan esas; si no, se leen de Shopify. Máx 6, dedup por nombre.
// Sin tarifas en Shopify (carrier dinámico) → { rates: [], note } sin escribir.
async function importShippingRates(merchantId, req, res) {
  try {
    const ref = db().collection("merchants").doc(merchantId);
    const merchant = (await ref.get()).data() || {};
    let source;
    if (Array.isArray(req.body?.rates)) {
      source = { rates: req.body.rates.map(r => ({ name: r?.name, price: r?.price, code: r?.code })) };
    } else {
      if (!merchant.shopify_token || !merchant.shopify_shop) return res.status(400).json({ error: "Conectá Shopify primero", rates: [] });
      source = await shopifyRatesForPanel(merchant);
    }
    const seen = new Set();
    const rates = [];
    for (const r of source.rates || []) {
      const name = String(r?.name || "").trim().slice(0, 250);
      const price = Math.round(Number(r?.price));
      if (!name || !Number.isInteger(price) || price < 0) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const code = String(r?.code || "").trim().slice(0, 50);
      rates.push({ name, price, ...(code ? { code } : {}) });
      if (rates.length >= 6) break;
    }
    if (!rates.length) return res.json({ ok: true, rates: [], note: source.note || "Tu tienda usa tarifas dinámicas (carrier). Cargalas a mano.", imported: 0 });
    await ref.set({ checkout_shipping_rates: rates, checkout_shipping_rates_source: "shopify", checkout_shipping_rates_imported_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { merge: true });
    return res.json({ ok: true, rates, imported: rates.length });
  } catch (e) {
    return res.status(500).json({ error: e.message, rates: [] });
  }
}

// GET ?action=refresh-shop → relee shop.json y actualiza los datos de la tienda
// (respeta store_domain manual y store_name ya cargado). Solo dueño.
async function refreshShop(ctx, res) {
  if (ctx.role !== "owner") return res.status(403).json({ error: "Solo el dueño de la tienda puede actualizar los datos de Shopify." });
  try {
    const ref = db().collection("merchants").doc(ctx.merchantId);
    const merchant = (await ref.get()).data() || {};
    if (!merchant.shopify_token || !merchant.shopify_shop) return res.status(400).json({ error: "Conectá Shopify primero" });
    let info;
    try { info = await shGetShopInfo(merchant.shopify_shop, merchant.shopify_token); }
    catch (e) { return res.status(502).json({ error: `Shopify no respondió: ${e.message}` }); }
    const patch = buildShopInfoPatch(merchant, info);
    await ref.set({ ...patch, updated_at: new Date().toISOString() }, { merge: true });
    const merged = { ...merchant, ...patch };
    return res.json({
      ok: true,
      shop: info,
      patch,
      shop_name: merged.shop_name || null, shop_email: merged.shop_email || null, shop_currency: merged.shop_currency || null,
      shop_country: merged.shop_country || null, shop_timezone: merged.shop_timezone || null,
      store_name: merged.store_name || "", store_domain: merged.store_domain || "", store_domain_source: merged.store_domain_source || null,
      store_domain_effective: effectiveStoreDomain(merged),
      shopify_domains: merged.shopify_domains || [],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

async function backfillEmailLog(merchantId, req, res) {
  // Reconstrucción ONE-TIME del historial de mails en email_log a partir de datos
  // reales, para que la tab Actividad no arranque vacía:
  //  · activation → un mail por cada sub que se activó (tiene orden Shopify).
  //  · abandoned  → un mail por cada sub con abandoned_email_sent_at (flujo viejo 1 paso).
  // Idempotente: saltea subs que ya tienen una entrada de ese tipo en email_log.
  try {
    const mRef = db().collection("merchants").doc(merchantId);
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

async function testEmail(merchantId, req, res) {
  // Envía el mail de ACTIVACIÓN de PRUEBA para verificar que Resend + el remitente
  // + la marca quedaron bien antes de que salga a clientes. (Antes mandaba el mail
  // de carrito abandonado; ese flujo se retiró el 2026-09-13 → Klaviyo.)
  // Solo al mail del merchant o a un mail del dominio de email_from; 10/día.
  const to = String(req.body?.to || "").trim().toLowerCase();
  if (!to || !EMAIL_RE.test(to)) return res.status(400).json({ error: "Falta 'to' (email válido)" });
  const merchant = await getOrCreateMerchant(merchantId, null);
  const fromDomain = ((merchant.email_from || "").match(/@([^>\s]+)>?$/) || [])[1]?.toLowerCase() || "";
  const ownerEmail = String(merchant.email || "").toLowerCase();
  const toDomain = to.split("@")[1] || "";
  if (to !== ownerEmail && !(fromDomain && toDomain === fromDomain)) {
    return res.status(400).json({ error: "El mail de prueba solo puede ir a tu email de cuenta o a una casilla del dominio de tu remitente" });
  }
  const rl = await rateLimit(`testmail:${merchantId}`, { limit: 10, windowSec: 86400 });
  if (!rl.ok) return res.status(429).json({ error: "Tope de 10 mails de prueba por día alcanzado" });

  const brand = effectiveBrand(merchant) || (process.env.EMAIL_FROM || "").split("<")[0].trim().replace(/^["']|["']$/g, "") || "";

  // Datos reales del merchant: primer plan activo.
  let productTitle = "Tu producto", amount = 0, frequencyDays = 30;
  try {
    const plansSnap = await db().collection("merchants").doc(merchantId).collection("plans").where("active", "==", true).limit(1).get();
    if (!plansSnap.empty) {
      const p = plansSnap.docs[0].data();
      productTitle = p.product_title || productTitle;
      amount = p.subscription_price_ars || 0;
      frequencyDays = parseInt(p.frequency_days) || 30;
    }
  } catch (_) {}
  // name opcional: si mandan name:"" se ve el saludo sin nombre.
  const customerName = req.body?.name !== undefined ? String(req.body.name) : "Nombre de prueba";
  const r = await emailSubscriptionActivated({
    to,
    customerName,
    productTitle,
    frequencyDays,
    amount,
    portalUrl: `${appBaseUrl()}/#/portal`,
    merchant,
    brand,
    accent: merchant.widget_color || "",
    from: effectiveFrom(merchant),
  });
  await logEmail(merchantId, { type: "activation", to, customer_name: customerName, product_title: productTitle, status: r?.error ? "error" : (r?.skipped ? "skipped" : "sent"), error: r?.error || null, test: true });
  if (r?.skipped) return res.status(400).json({ error: "RESEND_API_KEY no configurada (o no tomó el redeploy todavía)" });
  if (r?.error) return res.status(502).json({ error: r.error });
  return res.json({ ok: true, id: r.id, type: "activation", from: effectiveFrom(merchant) || null, brand, remaining: rl.remaining });
}

async function saveDiscountCodes(merchantId, req, res) {
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
    await db().collection("merchants").doc(merchantId).set({
      discount_codes: clean,
      updated_at: new Date().toISOString(),
    }, { merge: true });
    return res.json({ ok: true, discount_codes: clean });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Modo manual (pegar token). Sigue vigente además del OAuth.
async function saveMpToken(merchantId, req, res) {
  const { access_token } = req.body || {};
  if (!access_token?.trim()) return res.status(400).json({ error: "Falta access_token" });

  let me;
  try {
    me = await mpMe(access_token.trim());
  } catch (e) {
    return res.status(400).json({ error: `Token inválido: ${e.message}` });
  }

  try {
    await db().collection("merchants").doc(merchantId).set({
      mp_access_token: access_token.trim(),
      mp_user_id: me.id || null,
      mp_email: me.email || null,
      mp_country: me.country_id || null,
      mp_connected_at: new Date().toISOString(),
      mp_method: "manual",
      mp_disconnected_at: null,
      // Token pegado: se descarta lo de OAuth (si no, el cron lo "renovaría" con el refresh viejo).
      mp_refresh_token: FieldValue.delete(),
      mp_token_expires_at: FieldValue.delete(),
      mp_token_refreshed_at: FieldValue.delete(),
      mp_live_mode: FieldValue.delete(),
      mp_scope: FieldValue.delete(),
      mp_token_invalid_at: FieldValue.delete(),
      mp_token_error: FieldValue.delete(),
      mp_token_refresh_error: FieldValue.delete(),
      mp_token_refresh_error_at: FieldValue.delete(),
      mp_reconnect_required_at: FieldValue.delete(),
      mp_reconnect_reason: FieldValue.delete(),
    }, { merge: true });
    return res.json({ ok: true, mp_user_id: me.id, email: me.email });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Usar la cuenta de Mercado Pago de OTRA tienda del mismo dueño (tiendas extra,
// demos). Copia las credenciales del lado del servidor: nunca pasan por el
// navegador. Queda como "manual" (sin refresh propio): si la tienda origen
// renueva por OAuth, esta sigue con el access token copiado hasta que venza.
async function mpReuse(ctx, merchantId, req, res) {
  const from = String(req.body?.from_merchant_id || "").trim();
  if (!from || from === merchantId) return res.status(400).json({ error: "Elegí otra de tus tiendas." });
  try {
    const srcSnap = await db().collection("merchants").doc(from).get();
    const src = srcSnap.exists ? srcSnap.data() : null;
    const srcOwner = src ? String(src.ownerUid || from) : null;
    if (!src || src.deleted === true || srcOwner !== ctx.uid) return res.status(403).json({ error: "Esa tienda no es tuya." });
    if (!src.mp_access_token) return res.status(400).json({ error: "Esa tienda no tiene Mercado Pago conectado." });
    await db().collection("merchants").doc(merchantId).set({
      mp_access_token: src.mp_access_token,
      mp_user_id: src.mp_user_id || null,
      mp_email: src.mp_email || null,
      mp_country: src.mp_country || null,
      mp_public_key: src.mp_public_key || null,
      mp_live_mode: src.mp_live_mode === false ? false : FieldValue.delete(),
      mp_connected_at: new Date().toISOString(),
      mp_method: "manual",
      mp_shared_from: from,
      mp_disconnected_at: null,
      mp_refresh_token: FieldValue.delete(),
      mp_token_expires_at: FieldValue.delete(),
      mp_token_refreshed_at: FieldValue.delete(),
      mp_scope: FieldValue.delete(),
      mp_token_invalid_at: FieldValue.delete(),
      mp_token_error: FieldValue.delete(),
      mp_token_refresh_error: FieldValue.delete(),
      mp_token_refresh_error_at: FieldValue.delete(),
      mp_reconnect_required: FieldValue.delete(),
      mp_reconnect_required_at: FieldValue.delete(),
      mp_reconnect_reason: FieldValue.delete(),
    }, { merge: true });
    return res.json({ ok: true, mp_user_id: src.mp_user_id || null, email: src.mp_email || null, from_name: src.store_name || null });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-TIENDA + EQUIPO
//
// Modelo (portado de Growith, simplificado):
//   merchants/{uid}   → perfil + tienda principal del login. Campos de perfil:
//                       stores[] (cache de mis tiendas), active_merchant_id.
//   merchants/m_xxx   → tienda extra: is_store:true, ownerUid, ownerEmail,
//                       store_name/store_color/store_photo, teamUids, teamMembers.
//   Cualquier tienda: teamUids[], teamMembers{uid:{email,name,role,secciones,since}},
//                     teamInvites[{email,name,secciones,ts}], teamInviteEmails[].
//   Soft delete: deleted, deleted_at, purge_at (+30d), deleted_by. La purga real
//   (subcolecciones) NO está implementada acá (TODO cron).
// ═══════════════════════════════════════════════════════════════════════════

const SECCIONES = ["inicio", "suscripciones", "cobros", "planes", "widget", "retencion", "flujos", "portal", "analiticas", "configuracion"];
// Secciones viejas (antes de la reestructura 2026-09-14) → nuevas. Los permisos
// ya guardados con ids viejos se traducen al leer y al escribir.
export const LEGACY_SECCION = { suscriptores: "suscripciones", carritos: "suscripciones", abandonados: "suscripciones", actividad: "portal", integraciones: "configuracion", plan: "configuracion", guia: "configuracion" };
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_STORES_BETA = 5;
const PURGE_DAYS = 30;
const nowIso = () => new Date().toISOString();
const purgeAtIso = () => new Date(Date.now() + PURGE_DAYS * 86400000).toISOString();
const emailLower = (v) => String(v || "").trim().toLowerCase();
const isStoreId = (id) => /^m_[a-z0-9]+$/i.test(String(id || ""));
// Acciones de perfil que funcionan sin tienda (login cuya principal fue transferida).
const NO_STORE_ACTIONS = ["workspace", "store-create", "store-activate", "account-delete"];

// Solo claves válidas con `true` (un miembro nunca recibe secciones inventadas).
function cleanSecciones(obj) {
  // Acepta objeto {inicio:true} o array ["inicio","cobros"] (el front manda array).
  const src = Array.isArray(obj)
    ? Object.fromEntries(obj.map(k => [String(k), true]))
    : ((obj && typeof obj === "object") ? obj : {});
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    if (v !== true) continue;
    const nk = LEGACY_SECCION[k] || k;
    if (SECCIONES.includes(nk)) out[nk] = true;
  }
  return out;
}

// Nombre visible de una tienda: nombre propio > marca de mails > shop de Shopify > default.
function storeDisplayName(d) {
  return d?.store_name || d?.email_brand || d?.shopify_shop || "Mi tienda";
}
function storeEntry(id, d, { role, uid, member }) {
  return {
    id,
    name: storeDisplayName(d),
    color: (typeof d?.store_color === "string" && HEX_RE.test(d.store_color)) ? d.store_color : (d?.widget_color || "#10b981"),
    photo: d?.store_photo || null,
    role,                                   // "owner" | "member"
    is_primary: d?.is_store !== true,       // doc principal de un login (no m_xxx)
    is_self: id === uid,                    // es MI doc de perfil
    owner_uid: d?.ownerUid || id,
    owner_email: d?.ownerEmail || d?.email || null,
    shopify_shop: d?.shopify_shop || null,
    mp_connected: !!d?.mp_access_token,
    archived: !!d?.archived_at,             // tiendas archivadas (ej. INDATROPIC): fuera de los atajos
    // Miembro: permisos por sección (null = acceso total legacy vía teamUids sin teamMembers).
    secciones: role === "member" ? (member ? cleanSecciones(member.secciones) : null) : null,
    // Transferir a otra cuenta: solo el dueño REAL (ownerUid, o el propio id si falta).
    can_transfer: role === "owner" && String(d?.ownerUid || id) === uid,
    transfer_pending: role === "owner" ? publicPending(d?.transfer_pending) : null,
  };
}

// Guards comunes de las acciones de PERFIL (store-*, account-delete): el actor
// es SIEMPRE el uid del token; un miembro operando sobre una tienda ajena
// (viaTeam) no gestiona el perfil desde ahí (misma regla que Growith).
async function profileGuard(ctx, res, { allowViaTeam = false } = {}) {
  // Tienda principal TRANSFERIDA a otra cuenta: merchants/{uid} ya no es suyo. Su
  // perfil (tiendas, tienda activa) vive en profiles/{uid}; el doc ajeno nunca se escribe.
  const mine = (await db().collection("merchants").doc(ctx.uid).get()).data() || {};
  if (mine.ownerUid && mine.ownerUid !== ctx.uid) {
    const pRef = db().collection("profiles").doc(ctx.uid);
    const p = (await pRef.get()).data() || {};
    if (p.deleted === true) { res.status(403).json({ error: "Esta cuenta está eliminada." }); return null; }
    return { myRef: pRef, my: { ...p, moved: true }, moved: true };
  }
  if (ctx.viaTeam && !allowViaTeam) {
    res.status(403).json({ error: "Cambiá a tu propia tienda para gestionar tu perfil." });
    return null;
  }
  const myRef = db().collection("merchants").doc(ctx.uid);
  const my = mine;
  if (my.deleted === true) { res.status(403).json({ error: "Esta cuenta está eliminada." }); return null; }
  return { myRef, my };
}

// Entrada de `stores[]` del perfil. Si el perfil viejo (Lumina) no tiene el
// array, lo inicializamos con su tienda principal para no perderla del cache.
function profileStores(uid, my) {
  const list = Array.isArray(my.stores) ? my.stores.filter(s => s && s.id) : [];
  if (!my.moved && !list.some(s => s.id === uid)) { // perfil sin principal (transferida): no la re-agrega
    list.unshift({ id: uid, name: storeDisplayName(my), color: my.store_color || my.widget_color || "#10b981", role: "owner", created_at: my.created_at || nowIso() });
  }
  return list;
}

// ─── GET ?action=workspace ──────────────────────────────────────────────────
// Tiendas del PERFIL logueado + tienda activa. También hace el "claim": si hay
// invitaciones pendientes para el email del token, se convierten en membresía.
async function workspace(ctx, req, res) {
  const { uid } = ctx;
  const col = db().collection("merchants");
  const myEmail = emailLower(ctx.email);
  try {
    // Asegura el doc del perfil (primer login) con los campos multi-tienda.
    await getOrCreateMerchant(uid, myEmail || null);

    // 1) Invitaciones pendientes por email → membresía real (transacción por tienda).
    let claimed = 0;
    if (myEmail) {
      const qi = await col.where("teamInviteEmails", "array-contains", myEmail).get();
      for (const doc of qi.docs) {
        if (doc.id === uid) continue;
        await db().runTransaction(async tx => {
          const s = await tx.get(doc.ref); const d = s.data() || {};
          if (d.deleted === true) return;
          const invites = Array.isArray(d.teamInvites) ? d.teamInvites : [];
          const inv = invites.find(i => emailLower(i.email) === myEmail);
          if (!inv) return;
          tx.update(doc.ref, {
            teamMembers: { ...(d.teamMembers || {}), [uid]: { email: myEmail, name: inv.name || "", role: "member", secciones: cleanSecciones(inv.secciones), since: nowIso() } },
            teamUids: FieldValue.arrayUnion(uid),
            teamInvites: invites.filter(i => emailLower(i.email) !== myEmail),
            teamInviteEmails: FieldValue.arrayRemove(myEmail),
          });
          claimed++;
        }).catch(e => console.warn("[workspace] claim invite:", doc.id, e.message));
        clearMerchantCache(doc.id);
      }
    }

    // 2) Tiendas: la propia + donde soy dueño (ownerUid) + donde soy equipo (teamUids).
    const myRef = col.doc(uid);
    const my = (await myRef.get()).data() || {};
    const selfMoved = !!(my.ownerUid && my.ownerUid !== uid);
    const selfDeleted = my.deleted === true;
    // Principal transferida: la tienda activa elegida vive en profiles/{uid} (no en el doc ajeno).
    const prof = selfMoved ? ((await db().collection("profiles").doc(uid).get()).data() || {}) : my;
    const stores = [];
    const seen = new Set();
    if (!selfMoved && !selfDeleted) { stores.push(storeEntry(uid, my, { role: "owner", uid })); seen.add(uid); }
    const [qTeam, qOwn] = await Promise.all([
      col.where("teamUids", "array-contains", uid).get(),
      col.where("ownerUid", "==", uid).get(),
    ]);
    for (const doc of [...qOwn.docs, ...qTeam.docs]) {
      if (seen.has(doc.id)) continue;
      const d = doc.data() || {};
      if (d.deleted === true) continue;
      const m = (d.teamMembers || {})[uid] || null;
      const role = (d.ownerUid === uid || m?.role === "owner") ? "owner" : "member";
      stores.push(storeEntry(doc.id, d, { role, uid, member: m }));
      seen.add(doc.id);
    }

    // 3) Activa: la guardada en el perfil si sigue en la lista; si no, la propia; si no, la primera.
    let active = prof.active_merchant_id && stores.some(s => s.id === prof.active_merchant_id) ? prof.active_merchant_id : null;
    if (!active) active = (stores.find(s => s.is_self) || stores.find(s => s.role === "owner") || stores[0])?.id || (selfMoved ? null : uid);

    return res.json({
      ok: true,
      stores,
      active_merchant_id: active,
      uid,
      email: myEmail || null,
      self_moved: selfMoved,
      self_deleted: selfDeleted,
      primary_transferred: selfMoved ? (prof.primary_transferred || { merchant_id: uid }) : null,
      claimed_invites: claimed,
      max_stores: MAX_STORES_BETA,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST ?action=store-create { name, color } ──────────────────────────────
async function storeCreate(ctx, req, res) {
  const g = await profileGuard(ctx, res); if (!g) return;
  const { uid } = ctx; const { myRef, my } = g;
  const body = req.body || {};
  const name = String(body.name || "").trim().slice(0, 60);
  const color = HEX_RE.test(String(body.color || "")) ? body.color : "#10b981";
  if (!name) return res.status(400).json({ error: "Poné un nombre para la tienda." });
  try {
    // Límite beta: tiendas extra vivas (por query, no por el cache stores[]).
    const own = await db().collection("merchants").where("ownerUid", "==", uid).get();
    const vivas = own.docs.filter(d => d.id !== uid && d.data()?.deleted !== true).length;
    if (vivas >= MAX_STORES_BETA) return res.status(400).json({ error: `Máximo ${MAX_STORES_BETA} tiendas por cuenta durante la beta.` });

    const newId = "m_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const created_at = nowIso();
    const email = emailLower(my.email || ctx.email) || null;
    await db().collection("merchants").doc(newId).set({
      is_store: true,
      store_name: name,
      store_color: color,
      email,                       // mails/test-email usan `email` como "dueño"
      ownerUid: uid,
      ownerEmail: email,
      teamUids: [uid],
      teamMembers: { [uid]: { email, name: my.displayName || "", role: "owner", secciones: {}, since: created_at } },
      plan: "free", // gratis hasta 5 suscriptores activos (shared/platform/pricing.js)
      created_at,
      requires_email_verification: false,
    });
    const entry = { id: newId, name, color, role: "owner", created_at };
    const list = profileStores(uid, my).filter(s => s.id !== newId);
    list.push(entry);
    await myRef.set({ stores: list, active_merchant_id: newId }, { merge: true });
    clearMerchantCache(newId);
    return res.json({ ok: true, store: { ...entry, is_primary: false, is_self: false, photo: null, shopify_shop: null, mp_connected: false }, active_merchant_id: newId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST ?action=store-activate { merchant_id } ────────────────────────────
// Un miembro puede cambiar de tienda aunque esté parado en una ajena (viaTeam ok).
async function storeActivate(ctx, req, res) {
  const g = await profileGuard(ctx, res, { allowViaTeam: true }); if (!g) return;
  const { uid } = ctx; const { myRef } = g;
  const target = String(req.body?.merchant_id || "").trim();
  if (!target) return res.status(400).json({ error: "Falta merchant_id" });
  try {
    const acc = await resolveMerchantAccess(uid, target);
    if (!acc.ok) return res.status(acc.code || 403).json({ error: acc.error });
    await myRef.set({ active_merchant_id: target }, { merge: true });
    return res.json({ ok: true, active_merchant_id: target, role: acc.role });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST ?action=store-rename { merchant_id, name, color, photo? } ─────────
async function storeRename(ctx, req, res) {
  const g = await profileGuard(ctx, res); if (!g) return;
  const { uid } = ctx; const { myRef, my } = g;
  const body = req.body || {};
  const tid = String(body.merchant_id || uid).trim();
  const name = String(body.name || "").trim().slice(0, 60);
  const color = HEX_RE.test(String(body.color || "")) ? body.color : null;
  if (!name) return res.status(400).json({ error: "Poné un nombre." });
  // Foto: data URL chica (el front la reduce a ~160px) o "" para quitarla.
  let photoPatch = {};
  if (typeof body.photo === "string") {
    if (body.photo === "") photoPatch = { store_photo: null };
    else if (/^data:image\/(jpeg|png|webp);base64,/.test(body.photo) && body.photo.length <= 120000) photoPatch = { store_photo: body.photo };
    else return res.status(400).json({ error: "Foto inválida (JPG/PNG/WebP y liviana)." });
  }
  try {
    const tRef = db().collection("merchants").doc(tid);
    const d = tid === uid && !g.moved ? my : (await tRef.get()).data(); // transferida → se lee el doc real (ya no es suyo)
    const isOwner = tid === uid ? !(d?.ownerUid && d.ownerUid !== uid) : d?.ownerUid === uid;
    if (!d || !isOwner || d.deleted === true) return res.status(403).json({ error: "Solo el dueño puede renombrar la tienda." });
    await tRef.set({ store_name: name, ...(color ? { store_color: color } : {}), ...photoPatch, updated_at: nowIso() }, { merge: true });
    const list = profileStores(uid, my).map(s => s.id === tid ? { ...s, name, ...(color ? { color } : {}) } : s);
    await myRef.set({ stores: list }, { merge: true });
    return res.json({ ok: true, store: { id: tid, name, color: color || d.store_color || null, photo: "store_photo" in photoPatch ? photoPatch.store_photo : (d.store_photo || null) } });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST ?action=store-delete { merchant_id } ──────────────────────────────
// Solo tiendas EXTRA (m_...). Soft delete 30 días; la purga real queda TODO.
async function storeDelete(ctx, req, res) {
  const g = await profileGuard(ctx, res); if (!g) return;
  const { uid } = ctx; const { myRef, my } = g;
  const tid = String(req.body?.merchant_id || "").trim();
  if (!tid) return res.status(400).json({ error: "Falta merchant_id" });
  if (tid === uid || !isStoreId(tid)) return res.status(400).json({ error: "La tienda principal no se puede eliminar; eliminá la cuenta." });
  try {
    const tRef = db().collection("merchants").doc(tid);
    const d = (await tRef.get()).data();
    if (!d || d.ownerUid !== uid) return res.status(403).json({ error: "Solo el dueño puede eliminar la tienda." });
    if (d.deleted === true) return res.json({ ok: true, purge_at: d.purge_at || null, already: true });
    const purge_at = purgeAtIso();
    await tRef.set({ deleted: true, deleted_at: nowIso(), purge_at, deleted_by: uid }, { merge: true });
    const list = profileStores(uid, my).map(s => s.id === tid ? { ...s, deleted: true } : s);
    const patch = { stores: list };
    if (my.active_merchant_id === tid) patch.active_merchant_id = g.moved ? null : uid;
    await myRef.set(patch, { merge: true });
    clearMerchantCache(tid);
    // TODO: cron de purga real (subcolecciones plans/subscribers/charges/email_log) al vencer purge_at.
    return res.json({ ok: true, purge_at, active_merchant_id: patch.active_merchant_id || my.active_merchant_id || uid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── POST ?action=account-delete { confirm:"ELIMINAR" } ─────────────────────
async function accountDelete(ctx, req, res) {
  const g = await profileGuard(ctx, res); if (!g) return;
  const { uid } = ctx; const { myRef, my } = g;
  if (String(req.body?.confirm || "") !== "ELIMINAR") return res.status(400).json({ error: "Escribí ELIMINAR para confirmar." });
  try {
    const col = db().collection("merchants");
    const now = nowIso();
    const purge_at = purgeAtIso();
    // ⚠️ NO cancelamos las suscripciones de MP de los clientes finales de este
    // merchant: MP seguiría cobrando con el token del merchant y Recurrentes ya
    // no generaría órdenes. Hay que avisarle al merchant que las cancele desde
    // MP / desde Suscriptores ANTES de borrar la cuenta.
    // TODO: recorrer subscribers status=active de cada tienda y mpCancelPreapproval(...)
    //       (o al menos pausar) antes de marcar deleted.
    console.warn(`[account-delete] ${uid}: NO se cancelan suscripciones MP de clientes finales (TODO)`);

    // 1) Tiendas extra propias → soft delete.
    const own = await col.where("ownerUid", "==", uid).get();
    for (const doc of own.docs) {
      if (doc.id === uid) continue;
      await doc.ref.set({ deleted: true, deleted_at: now, purge_at, deleted_by: uid }, { merge: true }).catch(() => {});
      clearMerchantCache(doc.id);
    }
    // 2) Mi doc principal (si sigue siendo mío) → soft delete.
    if (!(my.ownerUid && my.ownerUid !== uid)) {
      await myRef.set({ deleted: true, deleted_at: now, purge_at, deleted_by: uid }, { merge: true });
    }
    // 3) Salir de los equipos ajenos donde figuro.
    const qs = await col.where("teamUids", "array-contains", uid).get();
    for (const doc of qs.docs) {
      const d = doc.data() || {};
      if (doc.id === uid || d.ownerUid === uid) continue;
      const members = { ...(d.teamMembers || {}) }; delete members[uid];
      // update (no set+merge): con merge el mapa teamMembers se fusiona y el miembro quitado quedaba.
      await doc.ref.update({ teamMembers: members, teamUids: FieldValue.arrayRemove(uid) }).catch(() => {});
      clearMerchantCache(doc.id);
    }
    // 4) Borrar el login. La purga total de datos queda TODO (cron) a los 30 días.
    try { await getAuth().deleteUser(uid); } catch (e) { console.warn("[account-delete] deleteUser:", e.message); }
    clearMerchantCache(uid);
    return res.json({ ok: true, purge_at });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// ─── Equipo (sobre la tienda ACTIVA, solo dueño) ─────────────────────────────
function teamGuard(ctx, res) {
  if (ctx.role !== "owner") { res.status(403).json({ error: "Solo el dueño de la tienda administra el equipo." }); return false; }
  return true;
}

// GET ?action=members → { members:[{uid,email,name,role,secciones,since}], invites:[{email,name,secciones,ts}] }
async function membersList(ctx, req, res) {
  if (!teamGuard(ctx, res)) return;
  try {
    const d = (await db().collection("merchants").doc(ctx.merchantId).get()).data() || {};
    const ownerUid = d.ownerUid || ctx.merchantId;
    const members = Object.entries(d.teamMembers || {})
      .filter(([mu, m]) => mu !== ownerUid && m?.role !== "owner")
      .map(([mu, m]) => ({ uid: mu, email: m.email || "", name: m.name || "", role: "member", secciones: cleanSecciones(m.secciones), since: m.since || null }));
    // Legacy: uids en teamUids sin entrada en teamMembers (acceso total).
    for (const mu of (Array.isArray(d.teamUids) ? d.teamUids : [])) {
      if (mu === ownerUid || members.some(m => m.uid === mu)) continue;
      members.push({ uid: mu, email: "", name: "", role: "member", secciones: null, since: null, legacy: true });
    }
    const invites = (Array.isArray(d.teamInvites) ? d.teamInvites : []).map(i => ({ email: i.email, name: i.name || "", secciones: cleanSecciones(i.secciones), ts: i.ts || null }));
    return res.json({ ok: true, members, invites, secciones: SECCIONES, merchant_id: ctx.merchantId });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// POST ?action=member-invite { email, name?, secciones? }
async function memberInvite(ctx, req, res) {
  if (!teamGuard(ctx, res)) return;
  const body = req.body || {};
  const email = emailLower(body.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Email inválido" });
  // Cada invitación manda un mail CON LA MARCA DE RECURRENTES a un email
  // arbitrario. Sin tope, una cuenta sirve para spamear desde nuestro dominio y
  // quemar la reputación del remitente (que es compartida por todas las tiendas).
  const rl = await rateLimit(`invite:${ctx.merchantId}`, { limit: 20, windowSec: 86400 });
  if (!rl.ok) return res.status(429).json({ error: "Demasiadas invitaciones por hoy. Probá mañana o escribinos." });
  const secciones = cleanSecciones(body.secciones);
  const name = String(body.name || "").trim().slice(0, 60);
  const ref = db().collection("merchants").doc(ctx.merchantId);
  let storeName = "", merchantDoc = {};
  try {
    await db().runTransaction(async tx => {
      const s = await tx.get(ref); const d = s.data() || {};
      merchantDoc = d;
      storeName = storeDisplayName(d);
      if (emailLower(d.email) === email || emailLower(d.ownerEmail) === email) throw Object.assign(new Error("Ese email es el del dueño de la tienda."), { status: 400 });
      const yaMiembro = Object.values(d.teamMembers || {}).some(m => emailLower(m?.email) === email);
      if (yaMiembro) throw Object.assign(new Error("Ese email ya es miembro."), { status: 400 });
      const invites = (Array.isArray(d.teamInvites) ? d.teamInvites : []).filter(i => emailLower(i.email) !== email);
      // teamInvites vive DENTRO del doc del merchant (tope duro de 1 MB en
      // Firestore): sin límite, invitar en loop puede dejar el doc inservible y
      // con él toda la tienda. 50 invitaciones pendientes es mucho más que
      // cualquier equipo real.
      if (invites.length >= 50) throw Object.assign(new Error("Hay demasiadas invitaciones pendientes. Cancelá las que no uses antes de invitar a alguien más."), { status: 400 });
      invites.push({ email, name, secciones, ts: Date.now(), invited_by: ctx.uid });
      tx.set(ref, { teamInvites: invites, teamInviteEmails: FieldValue.arrayUnion(email) }, { merge: true });
    });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  // Mail con botón para que la persona entre con ESTE mismo email. Si Resend
  // falla, la invitación igual queda activa (el claim es por email al login).
  const mailRes = await emailTeamInvite({
    to: email,
    inviterEmail: ctx.email || merchantDoc.email || "",
    storeName,
    merchant: merchantDoc,
    appUrl: `${appBaseUrl()}/#/login`,
  });
  return res.json({ ok: true, email, name, secciones, mail: mailRes && mailRes.ok ? "enviado" : "no_enviado" });
}

// POST ?action=member-update { member_uid, secciones }
async function memberUpdate(ctx, req, res) {
  if (!teamGuard(ctx, res)) return;
  const memberUid = String(req.body?.member_uid || "").trim();
  const secciones = cleanSecciones(req.body?.secciones);
  if (!memberUid) return res.status(400).json({ error: "Falta member_uid" });
  const ref = db().collection("merchants").doc(ctx.merchantId);
  try {
    await db().runTransaction(async tx => {
      const s = await tx.get(ref); const d = s.data() || {};
      const members = { ...(d.teamMembers || {}) };
      const ownerUid = d.ownerUid || ctx.merchantId;
      if (memberUid === ownerUid || members[memberUid]?.role === "owner") throw Object.assign(new Error("No se pueden editar los permisos del dueño."), { status: 400 });
      const team = Array.isArray(d.teamUids) ? d.teamUids : [];
      if (!members[memberUid] && !team.includes(memberUid)) throw Object.assign(new Error("Miembro no encontrado."), { status: 404 });
      // Legacy (solo en teamUids): al editar permisos pasa a tener entrada con secciones.
      members[memberUid] = { email: "", name: "", role: "member", since: nowIso(), ...(members[memberUid] || {}), secciones };
      tx.set(ref, { teamMembers: members, teamUids: FieldValue.arrayUnion(memberUid) }, { merge: true });
    });
    clearMerchantCache(ctx.merchantId);
    return res.json({ ok: true, member_uid: memberUid, secciones });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

// POST ?action=member-remove { member_uid | email }
async function memberRemove(ctx, req, res) {
  if (!teamGuard(ctx, res)) return;
  const memberUid = String(req.body?.member_uid || "").trim();
  const email = emailLower(req.body?.email);
  if (!memberUid && !email) return res.status(400).json({ error: "Falta member_uid o email" });
  const ref = db().collection("merchants").doc(ctx.merchantId);
  try {
    await db().runTransaction(async tx => {
      const s = await tx.get(ref); const d = s.data() || {};
      const ownerUid = d.ownerUid || ctx.merchantId;
      const members = { ...(d.teamMembers || {}) };
      const upd = {};
      const removeUids = [];
      if (memberUid) {
        if (memberUid === ownerUid || members[memberUid]?.role === "owner") throw Object.assign(new Error("No se puede quitar al dueño."), { status: 400 });
        delete members[memberUid];
        removeUids.push(memberUid);
      }
      if (email) {
        // Quitar también un miembro por email (si no vino uid) + su invitación pendiente.
        if (!memberUid) {
          for (const [mu, m] of Object.entries(members)) {
            if (emailLower(m?.email) === email && mu !== ownerUid && m?.role !== "owner") { delete members[mu]; removeUids.push(mu); }
          }
        }
        upd.teamInvites = (Array.isArray(d.teamInvites) ? d.teamInvites : []).filter(i => emailLower(i.email) !== email);
        upd.teamInviteEmails = FieldValue.arrayRemove(email);
      }
      if (removeUids.length) { upd.teamMembers = members; upd.teamUids = FieldValue.arrayRemove(...removeUids); }
      // update (no set+merge): con merge el mapa teamMembers se fusiona y el miembro quitado conservaba acceso.
      tx.update(ref, upd);
    });
    clearMerchantCache(ctx.merchantId);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}

// ─── POST ?action=save-owner ─────────────────────────────────────────
// Nombre, WhatsApp y email de contacto del dueño del LOGIN. Van en el doc de perfil
// (merchants/{uid}), no en la tienda activa: son de la persona, sirven para soporte
// y avisos. Primero getOrCreateMerchant: si el doc de perfil no existe (miembro de
// un equipo sin tienda propia) se crea completo y no un doc a medias.
function normalizeWhatsapp(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10) d = "549" + d;                                   // AR sin país: 11 6411 7974
  else if (d.length === 11 && d.startsWith("0")) d = "549" + d.slice(1); // 011 6411 7974
  if (d.length < 10 || d.length > 15) return null;
  return "+" + d;
}
async function saveOwner(ctx, req, res) {
  const b = req.body || {};
  const name = String(b.owner_name || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const wa = normalizeWhatsapp(b.owner_whatsapp);
  const email = String(b.contact_email || "").trim().toLowerCase().slice(0, 120);
  if (name.length < 2) return res.status(400).json({ error: "Ingresá tu nombre" });
  if (!wa) return res.status(400).json({ error: "Ingresá un WhatsApp válido, con código de área" });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Ingresá un email de contacto válido" });
  await getOrCreateMerchant(ctx.uid, ctx.email || null);
  const prev = (await db().collection("merchants").doc(ctx.uid).get()).data() || {};
  await db().collection("merchants").doc(ctx.uid).set({ owner_name: name, owner_whatsapp: wa, contact_email: email, owner_info_at: new Date().toISOString() }, { merge: true });
  // Ramal admin: alguien dejó su número por primera vez → aviso a Thiago para ir
  // a hablarle. Solo la primera vez (dedup "first") y nunca por el propio admin.
  if (!prev.owner_whatsapp) {
    try {
      const { isAdminEmail } = await import("./_lib/adminAuth.js");
      if (!isAdminEmail(ctx.email)) {
        const { notifyAdmin } = await import("./_lib/adminAlerts.js");
        await notifyAdmin("signup", { merchantId: ctx.uid, store: `${name} (${prev.store_name || prev.shopify_shop || email})`, detail: `WhatsApp ${wa} · ${email}`, key: "first" });
      }
    } catch (e) { console.warn("[save-owner] admin alert:", e.message); }
  }
  return res.json({ ok: true, owner_name: name, owner_whatsapp: wa, contact_email: email });
}
