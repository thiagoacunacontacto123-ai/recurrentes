// POST /api/shopify/webhooks — webhooks obligatorios de Shopify:
//   app/uninstalled, customers/data_request, customers/redact, shop/redact.
//
// Firma: X-Shopify-Hmac-Sha256 = base64(HMAC-SHA256(secret, raw body)).
// Probamos con SHOPIFY_API_SECRET (app única) y, si falla, con el
// shopify_client_secret del merchant dueño de X-Shopify-Shop-Domain.
// Firma válida → siempre 200 (aunque no haya nada que hacer). Inválida → 401.
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "../_lib/firebase.js";
import { timingSafeEqualStr, sha256hex } from "../_lib/token.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let raw;
  try { raw = await readRaw(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  const given = String(req.headers["x-shopify-hmac-sha256"] || "");
  const topic = String(req.headers["x-shopify-topic"] || "");
  const shopDomain = String(req.headers["x-shopify-shop-domain"] || "").toLowerCase();

  // Resolver merchant por dominio (puede no existir: app única recién instalada).
  let merchantRef = null, merchant = null;
  if (shopDomain) {
    try {
      const q = await db().collection("merchants").where("shopify_shop", "==", shopDomain).limit(1).get();
      if (!q.empty) { merchantRef = q.docs[0].ref; merchant = q.docs[0].data(); }
    } catch (e) { console.error("[shopify/webhooks] lookup merchant:", e.message); }
  }

  const secrets = [process.env.SHOPIFY_API_SECRET, merchant?.shopify_client_secret].filter(Boolean);
  const valid = given && secrets.some(s => timingSafeEqualStr(sig(s, raw), given));
  if (!valid) return res.status(401).json({ error: "Firma inválida" });

  let payload = {};
  try { payload = JSON.parse(raw.toString("utf8") || "{}"); } catch (_) {}
  const now = new Date().toISOString();

  try {
    if (!merchantRef) {
      console.warn(`[shopify/webhooks] ${topic} de ${shopDomain} sin merchant asociado`);
      return res.status(200).json({ ok: true, ignored: true });
    }

    if (topic === "app/uninstalled") {
      await merchantRef.set({ shopify_token: FieldValue.delete(), shopify_uninstalled_at: now }, { merge: true });
    } else if (topic === "customers/redact") {
      const email = String(payload?.customer?.email || "").trim().toLowerCase();
      const n = email ? await redactCustomer(merchantRef, email) : 0;
      await merchantRef.collection("gdpr_requests").add({ topic, shop_domain: shopDomain, customer_id: payload?.customer?.id || null, email_hash: email ? sha256hex(email) : null, redacted_subscribers: n, created_at: now });
    } else if (topic === "shop/redact") {
      await merchantRef.set({ shop_redact_requested_at: now }, { merge: true });
    } else if (topic === "customers/data_request") {
      await merchantRef.collection("gdpr_requests").add({
        topic, shop_domain: shopDomain,
        customer_id: payload?.customer?.id || null,
        customer_email: payload?.customer?.email || null,
        orders_requested: payload?.orders_requested || [],
        data_request_id: payload?.data_request?.id || null,
        status: "pending", created_at: now,
      });
    } else {
      console.warn(`[shopify/webhooks] topic no manejado: ${topic}`);
    }
  } catch (e) {
    // Firma válida: respondemos 200 igual para que Shopify no reintente eternamente.
    console.error(`[shopify/webhooks] ${topic} error:`, e.message);
  }
  return res.status(200).json({ ok: true });
}

// Anonimiza subs (y charges asociados) de ese email dentro del merchant.
async function redactCustomer(merchantRef, email) {
  const anon = `redacted+${sha256hex(email).slice(0, 16)}@example.invalid`;
  const snap = await merchantRef.collection("subscribers").where("customer_email", "==", email).get();
  let n = 0;
  for (const d of snap.docs) {
    await d.ref.set({
      customer_email: anon, customer_name: null, customer_phone: null, shipping_address: null,
      customer_tax_id: null, fb_data: null, redacted_at: new Date().toISOString(),
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
