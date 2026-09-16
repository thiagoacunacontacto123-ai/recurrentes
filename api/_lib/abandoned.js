// Flujo de carrito abandonado de suscripción — RETIRADO 2026-09-13.
import { appBaseUrl } from "./config.js";
//
// La secuencia propia de 3 mails (P1 15 min / P2 2 hs con cupón / P3 24 hs) fue
// reemplazada por la integración con Klaviyo (_lib/klaviyo.js): cada lead del
// checkout se manda como evento "Checkout Started" y el comerciante arma el
// recupero en sus propios flujos. Los mails transaccionales (activación, pago
// fallido, cancelación) siguen saliendo desde Recurrentes.
//
// Este módulo queda por los helpers que otros archivos siguen usando:
//   · computeRecoverUrl / recoverTarget / merchantHosts → link para retomar el
//     checkout (lo usa checkout/init para el evento de Klaviyo).
//   · resolveCoupons / abandonedStatusForEmail → compat.
// `sendAbandonedEmails` se mantiene exportada pero NO hace nada (retorna 0).
import { db } from "./firebase.js";
import { isUnsubscribed } from "./unsub.js";
import { signToken, sha256hex } from "./token.js";

const norm = (e) => String(e || "").trim().toLowerCase();
// Cupones por defecto del flujo viejo (solo compat de resolveCoupons).
const DEFAULT_COUPONS = { step2: { code: "VUELVO5", pct: 5 }, step3: { code: "ULTIMACHANCE15", pct: 15 } };
const emailStateRef = (merchantId, email) =>
  db().collection("merchants").doc(merchantId).collection("abandoned_emails").doc(sha256hex(norm(email)));

// ─── Cupones ────────────────────────────────────────────────────
// Devuelve { 2: {code,pct}|null, 3: {code,pct}|null }. Nunca promete un cupón que
// no exista/esté inactivo en merchant.discount_codes. El % sale del código real.
export function resolveCoupons(merchant) {
  const codes = Array.isArray(merchant?.discount_codes) ? merchant.discount_codes : [];
  const cfg = merchant?.abandoned_coupons && typeof merchant.abandoned_coupons === "object" ? merchant.abandoned_coupons : DEFAULT_COUPONS;
  const pick = (want) => {
    const code = String(want?.code || "").trim().toUpperCase();
    if (!code) return null;
    const hit = codes.find(c => String(c?.code || "").trim().toUpperCase() === code && c.active !== false);
    if (!hit) return null;
    const type = hit.type || "percent";
    const pct = type === "percent" ? Math.max(0, Math.min(90, parseFloat(hit.value) || 0)) : (parseFloat(want?.pct) || 0);
    return { code, pct };
  };
  return { 2: pick(cfg.step2), 3: pick(cfg.step3) };
}

// ─── URL de recupero ────────────────────────────────────────────
function cleanHost(v) {
  let h = String(v || "").trim().toLowerCase();
  if (!h) return "";
  h = h.replace(/^https?:\/\//, "").split("/")[0].split("?")[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : "";
}
export function merchantHosts(merchant) {
  const out = [];
  for (const v of [merchant?.store_domain, ...(Array.isArray(merchant?.shopify_domains) ? merchant.shopify_domains : []), merchant?.shopify_shop]) {
    const h = cleanHost(v);
    if (h && !out.includes(h)) out.push(h);
  }
  // El dominio propio (no myshopify) primero: es el que ve el cliente en el mail.
  return [...out.filter(h => !h.endsWith(".myshopify.com")), ...out.filter(h => h.endsWith(".myshopify.com"))];
}

// Path del checkout on-store reconstruido desde el sub (sin host).
// Modo packs (plan_snapshot.pricing_mode === "packs"): ?product=&variant=&plan=&pack=
// (el embed resuelve qty/precio/frecuencia desde el plan). Si no, como siempre.
function rebuildPath(merchant, sub) {
  const ps = sub?.plan_snapshot || {};
  if (!sub?.plan_id) return null;
  const q = new URLSearchParams();
  q.set("merchant", String(sub.merchant_id || merchant?.id || merchant?.uid || ""));
  q.set("plan", String(sub.plan_id));
  const packIdx = parseInt(ps.pack_index, 10);
  if (ps.pricing_mode === "packs" && Number.isInteger(packIdx) && packIdx >= 0) {
    q.set("pack", String(packIdx));
    return `/#/checkout?${q.toString()}`;
  }
  q.set("qty", String(Math.max(1, parseInt(sub.quantity || ps.units_per_shipment || 1, 10) || 1)));
  if (ps.frequency_days) q.set("freq_days", String(ps.frequency_days));
  return `/#/checkout?${q.toString()}`;
}

// Destino base del recupero: { url, allowsQuery }. allowsQuery=false → es el
// init_point de MP (404 si se le agregan params) → no se puede aplicar cupón.
export function recoverTarget(merchant, sub) {
  const hosts = merchantHosts(merchant);
  const host = hosts[0] || "";
  const rp = String(sub?.recover_path || "").trim();
  const app = (appBaseUrl() || "https://www.recurrentesapp.com").replace(/\/$/, "");
  // Checkout de Recurrentes (un solo checkout para todas las tiendas): la query va
  // dentro del hash; computeRecoverUrl sabe meter el ?rc= ahí.
  if (rp.startsWith("/#/checkout")) return { url: `${app}${rp}`, allowsQuery: true };
  if (host && rp.startsWith("/") && !rp.startsWith("//")) return { url: `https://${host}${rp}`, allowsQuery: true };
  const built = rebuildPath(merchant, sub);
  if (built) return { url: `${app}${built}`, allowsQuery: true };
  const esu = String(sub?.fb_data?.event_source_url || "").trim();
  if (esu && hosts.length) {
    try {
      const u = new URL(esu);
      if (hosts.includes(u.hostname.toLowerCase())) return { url: esu, allowsQuery: true };
    } catch (e) { console.warn("[abandoned] event_source_url inválida:", esu.slice(0, 120), e.message); }
  }
  // Sin tienda (link de suscripción): volver al checkout hosteado de Recurrentes.
  // La query vive dentro del hash (#/checkout?…) → no se le puede sumar ?rc=.
  if (sub?.hosted_checkout_url) return { url: String(sub.hosted_checkout_url), allowsQuery: false };
  if (sub?.mp_init_point) return { url: String(sub.mp_init_point), allowsQuery: false };
  return { url: "", allowsQuery: false };
}

// URL final. Con cupón agrega ?rc=<token firmado> (quita code=/rc= previos).
export function computeRecoverUrl(merchant, sub, { code, step, merchantId, email } = {}) {
  const { url, allowsQuery } = recoverTarget(merchant, sub);
  if (!url || !allowsQuery) return url;
  try {
    const rc = code ? signToken({ m: merchantId || sub?.merchant_id || merchant?.id || merchant?.uid || "", e: norm(email || sub?.customer_email), c: String(code).toUpperCase(), s: step || 0 }, 7 * 86400) : null;
    // Checkout de Recurrentes: la query vive DENTRO del hash (#/checkout?...).
    const hashIdx = url.indexOf("#/checkout");
    if (hashIdx !== -1) {
      const [hashPath, hashQs = ""] = url.slice(hashIdx).split("?");
      const hq = new URLSearchParams(hashQs);
      hq.delete("code"); hq.delete("rc");
      if (rc) hq.set("rc", rc);
      const qs = hq.toString();
      return url.slice(0, hashIdx) + hashPath + (qs ? "?" + qs : "");
    }
    const u = new URL(url);
    u.searchParams.delete("code");
    u.searchParams.delete("rc");
    if (rc) u.searchParams.set("rc", rc);
    return u.toString();
  } catch (e) {
    console.warn("[abandoned] no se pudo armar la URL de recupero:", url.slice(0, 120), e.message);
    return url;
  }
}

// ─── Estado por email ───────────────────────────────────────────
export async function abandonedStatusForEmail(merchantId, email) {
  const e = norm(email);
  const out = { email: e, last_step: 0, last_step_at: null, last_subscriber_id: null, unsubscribed: false };
  if (!merchantId || !e) return out;
  try {
    const snap = await emailStateRef(merchantId, e).get();
    if (snap.exists) Object.assign(out, { last_step: snap.data().last_step || 0, last_step_at: snap.data().last_step_at || null, last_subscriber_id: snap.data().last_subscriber_id || null });
  } catch (err) { console.warn("[abandoned] no se pudo leer abandoned_emails:", e, err.message); }
  out.unsubscribed = await isUnsubscribed(merchantId, e);
  return out;
}

// ─── Flujo principal ────────────────────────────────────────────
// Retirado 2026-09-13: reemplazado por Klaviyo (_lib/klaviyo.js). Se mantiene la
// firma para que cron/webhook viejos no rompan; nunca manda nada.
export async function sendAbandonedEmails(_merchantId, _merchant) {
  return 0;
}
