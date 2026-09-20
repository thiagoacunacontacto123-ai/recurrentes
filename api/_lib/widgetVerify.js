// "Activar en mi tienda": el panel abre la página de un producto con plan (con
// ?rec_verify=1) y espera a que widget.js avise que quedó VISIBLE 3 s (beacon
// widget-seen&rendered=1, ver api/public.js handleWidgetSeen). Recién ahí damos el
// tilde. Si el widget cargó pero no se montó, el beacon trae el motivo y se lo
// explicamos al comerciante (temas con bundles, apps que tapan el bloque, etc.).
//
//   GET /api/merchant?action=widget-verify-url&plan=<id>   → { url, host, plan_id, product_title, channel }
//   GET /api/merchant?action=widget-verify-status&since=<iso> → { loaded, verified, issue, last_verified_at }
import { db } from "./firebase.js";
import { shGetProductHandle } from "./shopify.js";
import { tnGetProductHandle } from "./tiendanube.js";
import { merchantStoreUrl } from "../public.js";

// Página de producto para verificar. `planId` → ese plan; si no, el primer plan activo
// con producto de la tienda (los planes manuales no tienen página).
export async function widgetVerifyUrl(merchantId, merchant, planId) {
  const m = merchant || {};
  const plansCol = db().collection("merchants").doc(merchantId).collection("plans");
  let plan = null;
  if (planId) {
    const s = await plansCol.doc(String(planId)).get();
    plan = s.exists ? { id: s.id, ...s.data() } : null;
  }
  if (!plan || plan.item_source === "manual" || !plan.shopify_product_id) {
    const snap = await plansCol.where("active", "==", true).limit(25).get();
    plan = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(p => p.item_source !== "manual" && p.shopify_product_id) || null;
  }
  if (!plan) return { error: "Creá un plan con un producto de tu tienda primero.", code: "no_plan" };
  const base = { plan_id: plan.id, product_title: plan.product_title || null };

  if (m.shopify_token && m.shopify_shop) {
    const store = merchantStoreUrl(m);
    const handle = await shGetProductHandle(m.shopify_shop, m.shopify_token, plan.shopify_product_id);
    if (!handle) return { error: "No encontramos ese producto en Shopify (¿lo borraste o lo despublicaste?). Elegí otro plan.", code: "no_product" };
    const u = new URL(`${store}/products/${handle}`);
    u.searchParams.set("rec_verify", "1");
    return { ...base, url: u.toString(), host: u.host, channel: "shopify" };
  }
  if (m.tiendanube_token && m.tiendanube_store_id) {
    const p = await tnGetProductHandle(m.tiendanube_store_id, m.tiendanube_token, plan.shopify_product_id);
    const storeUrl = String(m.tiendanube_store_url || "").replace(/\/+$/, "");
    const raw = p?.canonical_url || (p?.handle && storeUrl ? `${storeUrl}/productos/${p.handle}/` : null);
    if (!raw) return { error: "No encontramos ese producto en Tiendanube (¿lo borraste?). Elegí otro plan.", code: "no_product" };
    const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    u.searchParams.set("rec_verify", "1");
    return { ...base, url: u.toString(), host: u.host, channel: "tiendanube" };
  }
  return { error: "Conectá tu tienda (Shopify o Tiendanube) primero.", code: "no_store" };
}

// Qué avisó el widget DESPUÉS de `since` (ISO del momento en que el panel abrió la
// tienda). Sin `since` devuelve lo último que haya.
export function widgetVerifyStatus(m, since = "") {
  const after = (iso) => !!iso && (!since || iso > since);
  const verified = after(m?.widget_verified_at) ? {
    at: m.widget_verified_at, host: m.widget_verified_host || null, product: m.widget_verified_product || null,
    plan: m.widget_verified_plan || null, path: m.widget_verified_path || null, mode: m.widget_verified_mode || null,
    hidden: m.widget_verified_hidden || null,
  } : null;
  const issue = m?.widget_last_issue && after(m.widget_last_issue.at) ? m.widget_last_issue : null;
  return { loaded: after(m?.widget_last_seen_at), verified, issue, last_verified_at: m?.widget_verified_at || null };
}

export async function widgetVerifyUrlAction(merchantId, req, res) {
  try {
    const m = (await db().collection("merchants").doc(merchantId).get()).data() || {};
    const r = await widgetVerifyUrl(merchantId, m, req.query.plan);
    return res.status(r.error ? 400 : 200).json(r);
  } catch (e) {
    return res.status(502).json({ error: `Tu tienda no respondió: ${e.message}`, code: "store_error" });
  }
}

export async function widgetVerifyStatusAction(merchantId, req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const m = (await db().collection("merchants").doc(merchantId).get()).data() || {};
    return res.json(widgetVerifyStatus(m, String(req.query.since || "")));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
