// Vinculación con Growith (la otra app de Thiago, gestión para ecommerce; 27-sept-2026).
//
// Para qué: que Growith lea de acá las comisiones EXACTAS de Mercado Pago de cada
// cobro de suscripción (hoy las adivina desde las órdenes de la tienda o las pide a
// MP) y que las dos apps se vean vinculadas en la Configuración de la otra.
//
// Cómo: la tienda genera un código firmado de 10 minutos (`growith-code`, solo el
// dueño) y el navegador lo lleva a growithapp.com; el servidor de Growith lo canjea
// server-to-server (`public?action=growith-link`) por una api_key de solo lectura
// (`rk_…`, guardada acá hasheada). Con esa key Growith pide `growith-charges`. La
// desvinculación puede salir de cualquiera de los dos lados. Sin vincular no cambia
// NADA del camino del cobro: esto solo lee `charges/`.
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { signToken, verifyToken } from "./token.js";

export const GROWITH_URL = "https://www.growithapp.com";
const CODE_TTL_SEC = 600;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

// Código de un solo destino: identifica a ESTA tienda durante 10 minutos.
export function growithCode(merchantId) {
  return signToken({ t: "gh_link", m: merchantId, n: crypto.randomBytes(6).toString("hex") }, CODE_TTL_SEC);
}
export function growithLinkUrl(merchantId, { tenantId = "", storeName = "" } = {}) {
  const u = new URL(GROWITH_URL + "/");
  u.searchParams.set("recurrentes_code", growithCode(merchantId));
  u.searchParams.set("recurrentes_merchant", merchantId);
  if (tenantId) u.searchParams.set("recurrentes_tid", tenantId);
  return u.toString();
}

// Growith canjea el código → api_key. Devuelve { api_key, merchant } o { error, status }.
export async function growithLink({ code, tenant_id, store_name } = {}) {
  const p = verifyToken(code);
  if (!p || p.t !== "gh_link" || !p.m) return { error: "Código inválido o vencido. Volvé a tocar Vincular en Recurrentes.", status: 400 };
  const tid = String(tenant_id || "").trim().slice(0, 120);
  if (!tid) return { error: "Falta tenant_id", status: 400 };
  const ref = db().collection("merchants").doc(p.m);
  const snap = await ref.get();
  if (!snap.exists) return { error: "La tienda no existe", status: 404 };
  const m = snap.data() || {};
  const apiKey = "rk_" + crypto.randomBytes(24).toString("hex");
  const now = new Date().toISOString();
  await ref.set({
    growith_tenant_id: tid,
    growith_store_name: String(store_name || "").trim().slice(0, 120) || null,
    growith_linked_at: now,
    growith_api_key_hash: sha(apiKey),
    growith_unlinked_at: FieldValue.delete(),
  }, { merge: true });
  return { api_key: apiKey, merchant: publicMerchant(p.m, m) };
}

function publicMerchant(id, m) {
  return {
    id,
    store_name: m.store_name || m.shop_name || m.shopify_shop || m.tn_store_name || "",
    channel: m.channel || (m.shopify_token ? "shopify" : m.tn_access_token ? "tiendanube" : "none"),
    shopify_shop: m.shopify_shop || null,
  };
}

// Bearer rk_… → merchant (o null). Una consulta por igualdad sobre el hash.
export async function growithAuth(req) {
  const h = String(req.headers?.authorization || "");
  const mm = /^Bearer\s+(rk_[a-f0-9]{48})$/i.exec(h);
  if (!mm) return null;
  const q = await db().collection("merchants").where("growith_api_key_hash", "==", sha(mm[1])).limit(1).get();
  if (q.empty) return null;
  const d = q.docs[0];
  return { id: d.id, ...(d.data() || {}) };
}

export async function growithUnlink(merchantId) {
  await db().collection("merchants").doc(merchantId).set({
    growith_tenant_id: FieldValue.delete(), growith_store_name: FieldValue.delete(), growith_linked_at: FieldValue.delete(),
    growith_api_key_hash: FieldValue.delete(), growith_unlinked_at: new Date().toISOString(),
  }, { merge: true });
}

// Cobros del período con su comisión real de MP. `from`/`to` = AAAA-MM-DD (inclusive).
// Solo lo que Growith necesita para cruzar por payment_id: nada del cliente.
export async function growithCharges(merchant, { from, to } = {}) {
  const f = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? `${from}T00:00:00.000Z` : new Date(Date.now() - 45 * 86400000).toISOString();
  const t = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? `${to}T23:59:59.999Z` : new Date().toISOString();
  const snap = await db().collection("merchants").doc(merchant.id).collection("charges")
    .where("created_at", ">=", f).where("created_at", "<=", t).orderBy("created_at", "desc").limit(2000).get();
  const charges = [];
  for (const d of snap.docs) {
    const c = d.data() || {};
    if (!c.mp_payment_id) continue;
    charges.push({
      payment_id: String(c.mp_payment_id),
      amount: Number(c.amount_ars) || 0,
      fee: c.mp_fee_real != null ? Number(c.mp_fee_real) : null,   // null en cobros viejos: Growith cae a su cruce con MP
      status: c.status || null,
      order_id: c.shopify_order_id || null,
      subscriber_id: c.subscriber_id || null,
      created_at: c.created_at || null,
    });
  }
  return { merchant: publicMerchant(merchant.id, merchant), from: f, to: t, charges };
}
