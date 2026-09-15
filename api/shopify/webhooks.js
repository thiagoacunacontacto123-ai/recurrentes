// POST /api/shopify/webhooks — webhooks de Shopify:
//   app/uninstalled, customers/data_request, customers/redact, shop/redact.
//
// Firma: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(secret, raw body)).
//   1) Probamos SHOPIFY_API_SECRET (app única, si existe) SIN leer Firestore.
//   2) Si no, buscamos los merchants con ese shop y probamos el
//      shopify_client_secret de cada uno (la app que creó el comerciante).
// Sin firma válida → 401 y no se toca nada.
//
// A quién le aplica (nunca a otros merchants):
//   · firmó la app única      → merchants con ese shop SIN app propia;
//   · firmó la app de un merchant → merchants con ese shop y ESE mismo secret.
// La tienda sale del cuerpo firmado (shop_domain / myshopify_domain). El header
// X-Shopify-Shop-Domain NO está firmado: si no coincide con el cuerpo → 401.
//
// app/uninstalled y shop/redact borran el token. Antes probamos el token actual
// contra Shopify: si todavía funciona, el aviso es viejo o repetido (la tienda
// reinstaló / reconectó) y NO borramos nada. Si no se puede saber → 503 para que
// Shopify reintente más tarde.
//
// Cada pedido queda en merchants/{mid}/gdpr_requests/{id} (id determinístico por
// cuerpo → los reintentos de Shopify no duplican ni rehacen trabajo terminado).
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../_lib/firebase.js";
import { timingSafeEqualStr, sha256hex } from "../_lib/token.js";
import { fetchWithTimeout } from "../_lib/http.js";
import { API_VERSION } from "../_lib/shopify.js";

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const normShop = (s) => String(s || "").trim().toLowerCase();
const DAY = 24 * 3600 * 1000;

// Necesitamos el body CRUDO para el HMAC. Los helpers de Vercel (@vercel/node)
// leen el body antes del handler pero lo "restauran": volver a escuchar
// data/end re-emite los bytes originales. Si por alguna razón ya vino como
// Buffer/string en req.body lo usamos directo. Timeout para no colgar nunca.
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

const sig = (secret, raw) => crypto.createHmac("sha256", secret).update(raw).digest("base64");
const signedBy = (secret, raw, given) => { try { return timingSafeEqualStr(sig(secret, raw), given); } catch (_) { return false; } };

async function merchantsByShop(shop) {
  const q = await db().collection("merchants").where("shopify_shop", "==", shop).limit(10).get();
  return q.docs;
}

// → { app:"env" } | { app:"own", secret, docs } | { error } | null (firma inválida)
async function authenticate(raw, given, headerShop) {
  if (!given) return null;
  const envSecret = process.env.SHOPIFY_API_SECRET;
  if (envSecret && signedBy(envSecret, raw, given)) return { app: "env" };
  if (!SHOP_RE.test(headerShop)) return null;
  let docs;
  try { docs = await merchantsByShop(headerShop); }
  catch (e) { console.error("[shopify/webhooks] lookup merchant:", e.message); return { error: "lookup" }; }
  for (const d of docs) {
    const s = d.data()?.shopify_client_secret;
    if (s && signedBy(s, raw, given)) return { app: "own", secret: s, docs };
  }
  return null;
}

async function targetsFor(auth, shop) {
  if (auth.app === "own") return auth.docs.filter(d => d.data()?.shopify_client_secret === auth.secret);
  return (await merchantsByShop(shop)).filter(d => !d.data()?.shopify_client_secret);
}

// "none" (no hay token) · "alive" (Shopify lo acepta) · "dead" (401/404) · "unknown".
async function tokenState(shop, token) {
  if (!token) return "none";
  try {
    const r = await fetchWithTimeout(`https://${shop}/admin/api/${API_VERSION}/shop.json?fields=id`, {
      headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
    }, 6000);
    if (r.ok) return "alive";
    if (r.status === 401 || r.status === 404) return "dead";
    return "unknown";
  } catch (_) { return "unknown"; }
}

// Corre fn sobre items con N en paralelo (anonimizar cientos de subs sin pasarse de tiempo).
async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let raw;
  try { raw = await readRaw(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const given = String(req.headers["x-shopify-hmac-sha256"] || "");
  const topic = String(req.headers["x-shopify-topic"] || "");
  const headerShop = normShop(req.headers["x-shopify-shop-domain"]);

  const auth = await authenticate(raw, given, headerShop);
  if (auth?.error) return res.status(503).json({ error: "No se pudo verificar, reintentá" });
  if (!auth) return res.status(401).json({ error: "Firma inválida" });

  let payload = {};
  try { payload = JSON.parse(raw.toString("utf8") || "{}"); } catch (_) {}
  const bodyShop = normShop(payload?.shop_domain || payload?.myshopify_domain);
  if (bodyShop && headerShop && bodyShop !== headerShop) return res.status(401).json({ error: "La tienda no coincide con la firma" });
  // Con la app única el secret es de todos: solo confiamos en la tienda del cuerpo firmado.
  const shop = auth.app === "env" ? bodyShop : (bodyShop || headerShop);
  if (!SHOP_RE.test(shop)) {
    console.warn(`[shopify/webhooks] ${topic} con firma válida pero sin tienda identificable`);
    return res.status(200).json({ ok: true, ignored: true });
  }

  let targets;
  try { targets = await targetsFor(auth, shop); }
  catch (e) { console.error("[shopify/webhooks] targets:", e.message); return res.status(503).json({ error: "No se pudo verificar, reintentá" }); }
  if (!targets.length) {
    console.warn(`[shopify/webhooks] ${topic} de ${shop} sin merchant asociado`);
    return res.status(200).json({ ok: true, ignored: true });
  }

  const reqId = `${topic.replace(/[^a-z0-9]+/gi, "_")}_${sha256hex(raw).slice(0, 24)}`;
  const now = new Date().toISOString();
  const results = [];
  let retry = false;
  for (const doc of targets) {
    try {
      const r = await processTopic({ topic, payload, shop, reqId, now, ref: doc.ref, merchant: doc.data() || {} });
      if (r === "retry") retry = true;
      results.push(r);
    } catch (e) {
      // Firma válida: logueamos y seguimos con el resto; Shopify no reintenta por esto.
      console.error(`[shopify/webhooks] ${topic} ${doc.id} error:`, e.message);
      results.push("error");
    }
  }
  if (retry) return res.status(503).json({ error: "Todavía no se puede confirmar, reintentá más tarde" });
  return res.status(200).json({ ok: true, results });
}

async function processTopic({ topic, payload, shop, reqId, now, ref, merchant }) {
  const reqRef = ref.collection("gdpr_requests").doc(reqId);

  if (topic === "app/uninstalled") {
    const st = await tokenState(shop, merchant.shopify_token);
    // Token vivo: o el aviso llegó antes de que Shopify lo revoque (reintento
    // lo resuelve) o es un aviso viejo repetido (nunca borramos una conexión viva).
    if (st === "alive" || st === "unknown") return "retry";
    await ref.set({ shopify_token: FieldValue.delete(), shopify_scope: FieldValue.delete(), shopify_uninstalled_at: now }, { merge: true });
    return "uninstalled";
  }

  const prev = await reqRef.get();
  if (prev.exists && prev.data()?.status === "done") return "already_done";

  if (topic === "customers/redact") {
    const email = payload?.customer?.email;
    const subs = await findSubsByEmail(ref, email);
    let charges = 0;
    await pool(subs, 8, async (d) => { charges += await anonymizeSubscriber(ref, d, "customers/redact", now); });
    await reqRef.set({
      topic, shop_domain: shop, status: "done",
      customer_id: payload?.customer?.id || null,
      email_hash: email ? sha256hex(String(email).trim().toLowerCase()) : null,
      orders_to_redact: Array.isArray(payload?.orders_to_redact) ? payload.orders_to_redact : [],
      redacted_subscribers: subs.length, redacted_charges: charges,
      created_at: now, done_at: now,
    }, { merge: true });
    return "redacted";
  }

  if (topic === "customers/data_request") {
    // Pendiente: alguien arma la respuesta a mano (Shopify da 30 días). Dejamos
    // referenciado DÓNDE están los datos de ese cliente en este merchant.
    const email = payload?.customer?.email;
    const subs = await findSubsByEmail(ref, email);
    const chargeIds = [];
    for (const d of subs) {
      const ch = await ref.collection("charges").where("subscriber_id", "==", d.id).get();
      ch.docs.forEach(c => chargeIds.push(c.id));
    }
    await reqRef.set({
      topic, shop_domain: shop, status: "pending",
      customer_id: payload?.customer?.id || null,
      customer_email: email || null,
      customer_phone: payload?.customer?.phone || null,
      orders_requested: Array.isArray(payload?.orders_requested) ? payload.orders_requested : [],
      data_request_id: payload?.data_request?.id || null,
      // Qué hay que juntar para responder (rutas dentro de merchants/{mid}):
      refs: { subscribers: subs.map(d => d.id), charges: chargeIds.slice(0, 500) },
      found_subscribers: subs.length,
      data_sources: ["subscribers (datos, dirección, plan, estado)", "charges (cobros y órdenes)", "email_log (mails enviados)"],
      due_at: new Date(Date.parse(now) + 30 * DAY).toISOString(),
      created_at: now,
    }, { merge: true });
    return "pending";
  }

  if (topic === "shop/redact") {
    const st = await tokenState(shop, merchant.shopify_token);
    if (st === "unknown") return "retry";
    if (st === "alive") {
      // La tienda sigue conectada (reinstaló o reconectó con otra app): el pedido es viejo.
      await reqRef.set({ topic, shop_domain: shop, status: "skipped_still_connected", created_at: now }, { merge: true });
      return "skipped_still_connected";
    }
    await ref.set({
      shopify_token: FieldValue.delete(), shopify_scope: FieldValue.delete(), shopify_client_secret: FieldValue.delete(),
      shop_redact_requested_at: now, shop_redacted_at: now,
    }, { merge: true });
    // Solo los clientes que vinieron por Shopify (los de links u otros canales no son datos de Shopify).
    const all = await ref.collection("subscribers").get();
    const subs = all.docs.filter(d => { const x = d.data() || {}; const ch = x.plan_snapshot?.channel; return !x.redacted_at && (!ch || ch === "shopify"); });
    let charges = 0;
    await pool(subs, 8, async (d) => { charges += await anonymizeSubscriber(ref, d, "shop/redact", now); });
    await reqRef.set({ topic, shop_domain: shop, status: "done", redacted_subscribers: subs.length, redacted_charges: charges, created_at: now, done_at: now }, { merge: true });
    return "shop_redacted";
  }

  console.warn(`[shopify/webhooks] topic no manejado: ${topic}`);
  return "unhandled";
}

// Subs del merchant con ese email (tal cual y en minúsculas).
async function findSubsByEmail(merchantRef, rawEmail) {
  const raw = String(rawEmail || "").trim();
  if (!raw) return [];
  const out = new Map();
  for (const e of new Set([raw.toLowerCase(), raw])) {
    const s = await merchantRef.collection("subscribers").where("customer_email", "==", e).get();
    s.docs.forEach(d => out.set(d.id, d));
  }
  return [...out.values()];
}

const anonEmail = (seed) => `redacted+${sha256hex(String(seed || "").trim().toLowerCase()).slice(0, 16)}@example.invalid`;

// Borra los datos personales de un sub (y de sus cobros y mails registrados).
// No toca estado, plan, montos ni ids de MP/Shopify: el historial sigue cuadrando.
// Devuelve cuántos cobros tocó.
async function anonymizeSubscriber(merchantRef, subDoc, reason, now) {
  const d = subDoc.data() || {};
  const anon = anonEmail(d.customer_email || subDoc.id);
  await subDoc.ref.set({
    customer_email: anon, customer_name: null, customer_phone: null,
    shipping_address: null, billing_address: null, customer_address: null,
    customer_tax_id: null, customer_tax_id_kind: null, fb_data: null,
    redacted_at: now, redacted_reason: reason,
  }, { merge: true });
  let n = 0;
  const ch = await merchantRef.collection("charges").where("subscriber_id", "==", subDoc.id).get();
  for (const c of ch.docs) {
    const x = c.data() || {};
    const patch = {};
    if (x.customer_email) patch.customer_email = anon;
    if (x.customer_name) patch.customer_name = null;
    if (x.payer_email) patch.payer_email = null;
    if (Object.keys(patch).length) { await c.ref.set(patch, { merge: true }); n++; }
  }
  const logs = await merchantRef.collection("email_log").where("subscriber_id", "==", subDoc.id).get();
  for (const l of logs.docs) {
    const x = l.data() || {};
    if (x.to || x.customer_name) await l.ref.set({ to: x.to ? anon : null, customer_name: null }, { merge: true });
  }
  return n;
}
