// Endpoints de Tiendanube, servidos por /api/shopify?action=tn-* (sin función serverless
// nueva). vercel.json expone además dos URLs limpias para cargar en el portal de Partners:
//   /api/tiendanube/callback  → ?action=tn-callback   (URL de redirección de la app)
//   /api/tiendanube/webhooks  → ?action=tn-webhooks   (app/uninstalled + LGPD)
//
//   GET  ?action=tn-oauth-start&store_url=…  (auth, dueño) → { url } de autorización
//   GET  ?action=tn-callback&code=…&state=…  (Tiendanube)  → guarda el token y vuelve al panel
//   GET  ?action=tn-products[&fresh=1]       (auth)        → productos (mismo formato que Shopify)
//   POST ?action=tn-webhooks[&topic=…]       (Tiendanube)  → app/uninstalled, store/redact,
//        customers/redact, customers/data_request (HMAC x-linkedstore-hmac-sha256)
//   POST ?action=tn-claim { claim }          (auth, dueño) → asocia una instalación hecha
//        desde la tienda de apps de Tiendanube (sin state nuestro) a la cuenta logueada
//   POST ?action=tn-install-script           (auth, dueño) → (re)instala widget + webhook
//   POST ?action=tn-disconnect               (auth, dueño) → borra el token (las subs siguen en MP)
import { FieldValue } from "firebase-admin/firestore";
import { db, requireMerchant } from "./firebase.js";
import { signToken, verifyToken, timingSafeEqualStr, sha256hex } from "./token.js";
import { appBaseUrl } from "./config.js";
import {
  tnConfigured, tnAuthorizeUrl, tnExchangeCode, tnGetStore, tnListProducts,
  tnInstallScript, tnUninstallScript, tnEnsureWebhook, tnVerifyWebhook, normalizeStoreUrl,
} from "./tiendanube.js";
import { merchantProfile } from "../../shared/platform/profile.js";

export const TN_ACTIONS = ["tn-oauth-start", "tn-callback", "tn-products", "tn-webhooks", "tn-claim", "tn-install-script", "tn-disconnect", "tn-block"];

// /api/tiendanube/callback | /api/tiendanube/webhooks → acción (por si el rewrite no pasa ?action=).
export function tnActionFromPath(url) {
  const m = String(url || "").match(/\/api\/tiendanube\/(callback|webhooks)\b/);
  return m ? `tn-${m[1]}` : "";
}

const nowIso = () => new Date().toISOString();
const merchants = () => db().collection("merchants");
const isOwner = (ctx) => ctx.merchantId === ctx.uid || ctx.role === "owner" || !!ctx.viaOwner;
const NOT_ENABLED = "Tiendanube todavía no está habilitado en Recurrentes.";
const productsCache = new Map();

export async function tiendanubeApi(action, req, res) {
  if (action === "tn-callback") return handleCallback(req, res);
  if (action === "tn-webhooks") return handleWebhooks(req, res);
  if (action === "tn-oauth-start") return handleOauthStart(req, res);
  if (action === "tn-products") return handleProducts(req, res);
  if (action === "tn-claim") return handleClaim(req, res);
  if (action === "tn-install-script") return handleInstallScript(req, res);
  if (action === "tn-disconnect") return handleDisconnect(req, res);
  if (action === "tn-block") return handleBlock(req, res);
  return res.status(400).json({ error: `action debe ser ${TN_ACTIONS.join(" | ")}` });
}

// ─── Conexión (compartida por callback y claim) ─────────────────────────────

/**
 * Guarda la tienda en el merchant, completa sus datos (GET /store) e instala widget +
 * webhook de desinstalación (best-effort). Devuelve { ok } o { error }.
 */
export async function connectStore(merchantId, { store_id, access_token, scope }) {
  const ref = merchants().doc(merchantId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "Cuenta no encontrada" };
  const m = snap.data();
  const storeId = String(store_id);
  // Una tienda a la vez: con Shopify conectado no se conecta Tiendanube (y al revés).
  if (m.shopify_token) {
    return { error: "Esta cuenta ya tiene Shopify conectado. Desvinculá Shopify antes de conectar Tiendanube: cada tienda de Recurrentes trabaja con una sola plataforma." };
  }
  if (m.tiendanube_token && m.tiendanube_store_id && String(m.tiendanube_store_id) !== storeId) {
    return { error: "Esta cuenta ya tiene otra tienda de Tiendanube conectada. Desvinculala primero desde Integraciones." };
  }
  // El token nuevo invalida el anterior: si otra cuenta tenía esta misma tienda, se lo sacamos
  // (así los webhooks y los cobros apuntan a una sola cuenta).
  try {
    const others = await merchants().where("tiendanube_store_id", "==", storeId).limit(5).get();
    for (const d of others.docs) {
      if (d.id !== merchantId && d.data().tiendanube_token) {
        await d.ref.set({ tiendanube_token: FieldValue.delete(), tiendanube_replaced_at: nowIso() }, { merge: true });
      }
    }
  } catch (e) { console.warn("[tiendanube] limpieza de otras cuentas:", e.message); }

  let info = null;
  try { info = await tnGetStore(storeId, access_token); }
  catch (e) { console.warn(`[tiendanube] GET /store falló (${merchantId}):`, e.message); }

  const patch = {
    tiendanube_store_id: storeId,
    tiendanube_token: access_token,
    tiendanube_scope: scope || null,
    tiendanube_connected_at: nowIso(),
    tiendanube_uninstalled_at: null,
    tiendanube_disconnected_at: null,
    ...(info ? {
      tiendanube_store_name: info.name || null,
      tiendanube_store_url: info.url || null,
      tiendanube_domains: info.domains,
      tiendanube_store_email: info.email || null,
      tiendanube_currency: info.currency || null,
      tiendanube_country: info.country || null,
    } : {}),
  };
  if (!String(m.store_name || "").trim() && info?.name) patch.store_name = info.name.slice(0, 60);
  // Canal: una cuenta nueva (sin Shopify conectado ni venta por link) pasa a vender con
  // Tiendanube. Si ya vende con Shopify o por link, no tocamos nada: lo cambia en
  // Configuración → Negocio (o con "Usar Tiendanube como mi tienda" en Integraciones).
  const prof = merchantProfile(m);
  if (!m.shopify_token && prof.businessType !== "service" && (!m.channel || m.channel === "shopify" || m.channel === "tiendanube")) {
    patch.channel = "tiendanube";
  }
  await ref.set(patch, { merge: true });
  const setup = await setupStore(merchantId, storeId, access_token);
  return { ok: true, store: info, channel: patch.channel || prof.channel, ...setup };
}

// Webhook de desinstalación + script del widget. Graba el resultado en el merchant.
async function setupStore(merchantId, storeId, token) {
  const out = {};
  const patch = {};
  const base = appBaseUrl();
  if (base) {
    try {
      await tnEnsureWebhook(storeId, token, "app/uninstalled", `${base}/api/tiendanube/webhooks`);
      patch.tiendanube_webhooks_at = nowIso();
      patch.tiendanube_webhook_error = null;
      out.webhook = true;
    } catch (e) {
      patch.tiendanube_webhook_error = String(e.message).slice(0, 300);
      out.webhook_error = e.message;
    }
  }
  const scriptId = process.env.TIENDANUBE_SCRIPT_ID;
  if (scriptId) {
    try {
      await tnInstallScript(storeId, token, { scriptId, params: { merchant: merchantId } });
      patch.tiendanube_script_installed_at = nowIso();
      patch.tiendanube_script_error = null;
      out.script = true;
    } catch (e) {
      patch.tiendanube_script_error = String(e.message).slice(0, 300);
      out.script_error = e.message;
    }
  }
  if (Object.keys(patch).length) await merchants().doc(merchantId).set(patch, { merge: true });
  return out;
}

// ─── action=tn-oauth-start ──────────────────────────────────────────────────
async function handleOauthStart(req, res) {
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (!isOwner(ctx)) return res.status(403).json({ error: "Solo el dueño de la tienda puede conectar Tiendanube." });
  if (!tnConfigured()) return res.status(400).json({ error: NOT_ENABLED });
  // Una tienda a la vez: con Shopify conectado no se conecta Tiendanube (y al revés).
  const mSnap = await merchants().doc(ctx.merchantId).get();
  if (mSnap.exists && mSnap.data().shopify_token) {
    return res.status(400).json({ error: "Ya tenés Shopify conectado. Desvinculá Shopify antes de conectar Tiendanube: cada tienda de Recurrentes trabaja con una sola plataforma.", code: "channel_taken" });
  }
  const storeUrl = normalizeStoreUrl(req.query.store_url || req.body?.store_url || "");
  const state = signToken({ uid: ctx.uid, mid: ctx.merchantId, tn: 1 }, 600);
  res.setHeader("Set-Cookie", `tn_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  if (storeUrl) {
    try { await merchants().doc(ctx.merchantId).set({ tiendanube_store_hint: storeUrl }, { merge: true }); } catch (_) {}
  }
  return res.json({ url: tnAuthorizeUrl(state, storeUrl) });
}

// ─── action=tn-callback ─────────────────────────────────────────────────────
function backToPanel(res, query) {
  res.setHeader("Set-Cookie", "tn_oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
  res.writeHead(302, { Location: `${appBaseUrl()}/#/config/integraciones?${query}` });
  res.end();
}

async function handleCallback(req, res) {
  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  if (!tnConfigured()) return res.status(400).send(NOT_ENABLED);
  if (!code) return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent("Tiendanube no mandó el código de autorización. Probá de nuevo.")}`);

  // State firmado (10 min) emitido por tn-oauth-start. Sin state válido = instalación
  // iniciada desde la tienda de apps de Tiendanube → queda pendiente hasta que la
  // cuenta logueada la reclame (tn-claim).
  let payload = state ? verifyToken(state) : null;
  if (payload && payload.tn !== 1) payload = null;
  if (state && !payload) {
    return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent("La autorización venció o no es válida. Volvé a tocar Conectar.")}`);
  }
  const cookies = parseCookies(req.headers?.cookie || "");
  if (payload && cookies.tn_oauth_state && !timingSafeEqualStr(cookies.tn_oauth_state, state)) {
    return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent("La autorización no coincide con tu sesión. Volvé a tocar Conectar.")}`);
  }

  let tok;
  try { tok = await tnExchangeCode(code); }
  catch (e) { return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent(e.message)}`); }

  if (!payload) {
    await db().collection("tiendanube_installs").doc(tok.store_id).set({
      store_id: tok.store_id, access_token: tok.access_token, scope: tok.scope, created_at: nowIso(),
    });
    const claim = signToken({ tn_claim: tok.store_id }, 1800);
    return backToPanel(res, `tn_claim=${encodeURIComponent(claim)}`);
  }

  const merchantId = String(payload.mid || payload.uid);
  try {
    const r = await connectStore(merchantId, tok);
    if (r.error) return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent(r.error)}`);
  } catch (e) {
    return backToPanel(res, `tiendanube=error&msg=${encodeURIComponent("No pudimos guardar la conexión: " + e.message)}`);
  }
  return backToPanel(res, "tiendanube=ok");
}

// ─── action=tn-claim ────────────────────────────────────────────────────────
async function handleClaim(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (!isOwner(ctx)) return res.status(403).json({ error: "Solo el dueño de la tienda puede conectar Tiendanube." });
  const p = verifyToken(String(req.body?.claim || ""));
  if (!p?.tn_claim) return res.status(400).json({ error: "El link de instalación venció. Volvé a instalar la app desde Tiendanube o tocá Conectar." });
  const ref = db().collection("tiendanube_installs").doc(String(p.tn_claim));
  const snap = await ref.get();
  if (!snap.exists) return res.status(404).json({ error: "No encontramos esa instalación. Tocá Conectar en Integraciones." });
  const inst = snap.data();
  const r = await connectStore(ctx.merchantId, inst);
  if (r.error) return res.status(409).json({ error: r.error });
  await ref.delete();
  return res.json({ ok: true, store_name: r.store?.name || null, channel: r.channel });
}

// ─── action=tn-products ─────────────────────────────────────────────────────
async function handleProducts(req, res) {
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  const { merchantId } = ctx;
  const fresh = req.query.fresh === "1";
  const c = productsCache.get(merchantId);
  if (!fresh && c && Date.now() - c.ts < 60 * 1000) return res.json({ products: c.products, _cached: true });
  const snap = await merchants().doc(merchantId).get();
  const m = snap.exists ? snap.data() : {};
  if (!m.tiendanube_token || !m.tiendanube_store_id) return res.status(400).json({ error: "Conectá Tiendanube primero" });
  try {
    const products = await tnListProducts(m.tiendanube_store_id, m.tiendanube_token);
    productsCache.set(merchantId, { products, ts: Date.now() });
    return res.json({ products });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}

// ─── action=tn-install-script ───────────────────────────────────────────────
async function handleInstallScript(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (!isOwner(ctx)) return res.status(403).json({ error: "Solo el dueño de la tienda puede instalar el widget." });
  const snap = await merchants().doc(ctx.merchantId).get();
  const m = snap.exists ? snap.data() : {};
  if (!m.tiendanube_token || !m.tiendanube_store_id) return res.status(400).json({ error: "Conectá Tiendanube primero" });
  if (!process.env.TIENDANUBE_SCRIPT_ID) return res.status(400).json({ error: "El widget automático para Tiendanube todavía no está habilitado." });
  const out = await setupStore(ctx.merchantId, m.tiendanube_store_id, m.tiendanube_token);
  if (out.script_error) return res.status(502).json({ error: `Tiendanube no aceptó el widget: ${out.script_error}` });
  return res.json({ ok: true, ...out });
}

// ─── action=tn-block ────────────────────────────────────────────────────────
// POST { plan_id, on }  (auth, dueño) → escribe o saca el bloque de suscripción
// en la DESCRIPCIÓN del producto de Tiendanube.
//
// Es el reemplazo del widget mientras Tiendanube no inyecte nuestro script (solo
// lo hace con apps aprobadas). Como tenemos write_products, lo ponemos nosotros:
// el comerciante no pega código en ningún lado. Es HTML con estilos en línea, sin
// JavaScript, que es lo único que Tiendanube deja pasar en una descripción.
async function handleBlock(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (!isOwner(ctx)) return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
  const planId = String(req.body?.plan_id || "").trim();
  const on = req.body?.on !== false;
  if (!planId) return res.status(400).json({ error: "Falta plan_id" });
  const ref = merchants().doc(ctx.merchantId);
  const m = (await ref.get()).data() || {};
  if (!m.tiendanube_token || !m.tiendanube_store_id) return res.status(400).json({ error: "Conectá Tiendanube primero." });
  const planSnap = await ref.collection("plans").doc(planId).get();
  if (!planSnap.exists) return res.status(404).json({ error: "No encontré el plan" });
  const plan = planSnap.data();
  const productId = plan.shopify_product_id;   // id del producto de la tienda (campo histórico)
  if (!productId) return res.status(400).json({ error: "El plan no está atado a un producto del catálogo." });

  try {
    const { tnGetProductDescription, tnSetProductDescription } = await import("./tiendanube.js");
    const { tnSubscriptionBlock, upsertBlock, stripBlock } = await import("../../shared/platform/tnBlock.js");
    const actual = await tnGetProductDescription(m.tiendanube_store_id, m.tiendanube_token, productId);
    let next;
    if (on) {
      const base = appBaseUrl() || "https://www.recurrentesapp.com";
      const checkoutUrl = `${base}/#/checkout?merchant=${encodeURIComponent(ctx.merchantId)}&plan=${encodeURIComponent(planId)}`;
      next = upsertBlock(actual.html, tnSubscriptionBlock({ plan, planId, checkoutUrl, brandColor: m.widget_color || "#10b981" }));
    } else {
      next = stripBlock(actual.html);
    }
    await tnSetProductDescription(m.tiendanube_store_id, m.tiendanube_token, productId, next, actual.lang);
    await ref.collection("plans").doc(planId).set({ tiendanube_block_at: on ? nowIso() : null }, { merge: true });
    productsCache.delete(ctx.merchantId);
    return res.json({ ok: true, on });
  } catch (e) {
    return res.status(502).json({ error: `Tiendanube no aceptó el cambio: ${e.message}` });
  }
}

// ─── action=tn-disconnect ───────────────────────────────────────────────────
async function handleDisconnect(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const ctx = await requireMerchant(req, res);
  if (!ctx) return;
  if (!isOwner(ctx)) return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
  const ref = merchants().doc(ctx.merchantId);
  const snap = await ref.get();
  const m = snap.exists ? snap.data() : {};
  // Best-effort: sacamos el widget de la tienda antes de olvidar el token.
  if (m.tiendanube_token && m.tiendanube_store_id && process.env.TIENDANUBE_SCRIPT_ID && m.tiendanube_script_installed_at) {
    try { await tnUninstallScript(m.tiendanube_store_id, m.tiendanube_token, process.env.TIENDANUBE_SCRIPT_ID); }
    catch (e) { console.warn("[tiendanube] no pude sacar el script:", e.message); }
  }
  await ref.set({
    tiendanube_token: FieldValue.delete(),
    tiendanube_scope: FieldValue.delete(),
    tiendanube_script_installed_at: FieldValue.delete(),
    tiendanube_disconnected_at: nowIso(),
  }, { merge: true });
  productsCache.delete(ctx.merchantId);
  return res.json({ ok: true });
}

// ─── action=tn-webhooks ─────────────────────────────────────────────────────
// Body CRUDO para el HMAC (mismo método que api/shopify/webhooks.js).
function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error("timeout leyendo body")), 5000);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

// Los webhooks LGPD traen solo store_id (+ customer): el tópico sale de ?topic= (una URL
// por tópico en Partners) o, si no vino, de la forma del payload.
const TOPIC_ALIASES = {
  "store-redact": "store/redact", "customers-redact": "customers/redact",
  "customers-data-request": "customers/data_request", "app-uninstalled": "app/uninstalled",
};
export function tnWebhookTopic(payload, queryTopic) {
  if (payload?.event) return String(payload.event);
  const q = String(queryTopic || "").trim();
  if (q) return TOPIC_ALIASES[q] || q;
  if (payload?.data_request || payload?.orders_requested) return "customers/data_request";
  if (payload?.customer || payload?.orders_to_redact) return "customers/redact";
  if (payload?.store_id) return "store/redact";
  return "";
}

async function handleWebhooks(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  let raw;
  try { raw = await readRaw(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  // Si el runtime ya consumió el stream y dejó el JSON parseado, intentamos con él.
  if ((!raw || !raw.length) && req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) raw = Buffer.from(JSON.stringify(req.body));
  const given = String(req.headers?.["x-linkedstore-hmac-sha256"] || req.headers?.["http_x_linkedstore_hmac_sha256"] || "");
  if (!tnVerifyWebhook(raw, given)) return res.status(401).json({ error: "Firma inválida" });

  let payload = {};
  try { payload = JSON.parse(raw.toString("utf8") || "{}"); } catch (_) {}
  const topic = tnWebhookTopic(payload, req.query?.topic);
  const storeId = String(payload.store_id || "");
  const now = nowIso();

  try {
    const found = storeId ? await merchants().where("tiendanube_store_id", "==", storeId).limit(5).get() : { docs: [] };
    const refs = found.docs.map(d => d.ref);
    if (topic === "app/uninstalled") {
      for (const ref of refs) {
        await ref.set({ tiendanube_token: FieldValue.delete(), tiendanube_script_installed_at: FieldValue.delete(), tiendanube_uninstalled_at: now }, { merge: true });
      }
      if (storeId) await db().collection("tiendanube_installs").doc(storeId).delete();
    } else if (topic === "store/redact") {
      for (const ref of refs) {
        await ref.set({
          tiendanube_token: FieldValue.delete(), tiendanube_scope: FieldValue.delete(),
          tiendanube_store_email: FieldValue.delete(), tiendanube_domains: FieldValue.delete(),
          tiendanube_store_url: FieldValue.delete(), tiendanube_script_installed_at: FieldValue.delete(),
          tiendanube_redacted_at: now,
        }, { merge: true });
        await ref.collection("gdpr_requests").add({ source: "tiendanube", topic, store_id: storeId, created_at: now });
      }
      if (storeId) await db().collection("tiendanube_installs").doc(storeId).delete();
    } else if (topic === "customers/redact") {
      const email = String(payload?.customer?.email || "").trim().toLowerCase();
      for (const ref of refs) {
        const n = email ? await redactCustomer(ref, email) : 0;
        await ref.collection("gdpr_requests").add({
          source: "tiendanube", topic, store_id: storeId, customer_id: payload?.customer?.id || null,
          email_hash: email ? sha256hex(email) : null, orders_to_redact: payload?.orders_to_redact || [],
          redacted_subscribers: n, created_at: now,
        });
      }
    } else if (topic === "customers/data_request") {
      for (const ref of refs) {
        await ref.collection("gdpr_requests").add({
          source: "tiendanube", topic, store_id: storeId,
          customer_id: payload?.customer?.id || null, customer_email: payload?.customer?.email || null,
          orders_requested: payload?.orders_requested || [], checkouts_requested: payload?.checkouts_requested || [],
          data_request_id: payload?.data_request?.id || null, status: "pending", created_at: now,
        });
      }
    } else {
      console.warn(`[tiendanube/webhooks] tópico no manejado: ${topic || "(vacío)"} store=${storeId}`);
    }
    if (!refs.length) console.warn(`[tiendanube/webhooks] ${topic} de la tienda ${storeId} sin cuenta asociada`);
  } catch (e) {
    // Firma válida: 200 igual para que Tiendanube no reintente 16 veces.
    console.error(`[tiendanube/webhooks] ${topic} error:`, e.message);
  }
  return res.status(200).json({ ok: true });
}

// Anonimiza subs (y charges asociados) de ese email dentro del merchant (igual que Shopify).
async function redactCustomer(merchantRef, email) {
  const anon = `redacted+${sha256hex(email).slice(0, 16)}@example.invalid`;
  const snap = await merchantRef.collection("subscribers").where("customer_email", "==", email).get();
  let n = 0;
  for (const d of snap.docs) {
    await d.ref.set({
      customer_email: anon, customer_name: null, customer_phone: null, shipping_address: null,
      customer_tax_id: null, fb_data: null, redacted_at: nowIso(),
    }, { merge: true });
    const ch = await merchantRef.collection("charges").where("subscriber_id", "==", d.id).get();
    for (const c of ch.docs) {
      const data = c.data();
      if (data.customer_email || data.customer_name || data.payer_email) {
        await c.ref.set({ customer_email: anon, customer_name: null, payer_email: null }, { merge: true });
      }
    }
    n++;
  }
  return n;
}

function parseCookies(s) {
  const out = {};
  String(s || "").split(/;\s*/).forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) { try { out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); } catch (_) {} }
  });
  return out;
}
