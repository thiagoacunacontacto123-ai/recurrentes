// Flujo de carrito abandonado de suscripción — SECUENCIA de 3 pasos:
//   Paso 1 → 15 min:  recordatorio simple (sin cupón).
//   Paso 2 → 2 hs:    con cupón (default VUELVO5 5% OFF) si existe en discount_codes.
//   Paso 3 → 24 hs:   última chance (default ULTIMACHANCE15 15% OFF) si existe.
//
// Reglas:
//  · Solo subs en "pending" (iniciaron el checkout y no pagaron).
//  · Máx 3 días de antigüedad (más viejo no se molesta).
//  · El estado se lleva POR EMAIL (no por doc): el paso que corresponde es el
//    máximo de todos los intentos del mismo mail en 30 días + el doc
//    merchants/{uid}/abandoned_emails/{sha256(email)}. Un retry de "Pagar" no
//    reinicia la secuencia.
//  · Sincroniza con MP ANTES de mandar: si autorizó la tarjeta o hay pagos, NO
//    manda (abandoned_step 99). Idem si el mail tiene otra sub active/paused/
//    payment_failed, si compró en Shopify o si se dio de baja (unsubscribes).
//  · Claim atómico por envío (abandoned_claim_step) → cron y webhook no duplican.
//  · Error de Resend NO avanza el paso: cuenta reintentos, a los 3 → step 98.
//  · Link de recupero siempre server-side, cupón firmado en ?rc= (nunca code=).
//
// Se dispara desde el cron + webhook self-heal. Para timing preciso (15min/2h/24h)
// necesita un cron frecuente (Vercel Pro o cron externo cada ~10 min).
import { db } from "./firebase.js";
import { emailAbandonedCheckout } from "./email.js";
import { syncSubscriber } from "./sync.js";
import { shHasRecentPaidOrder } from "./shopify.js";
import { logEmail } from "./emaillog.js";
import { isUnsubscribed } from "./unsub.js";
import { signToken, sha256hex } from "./token.js";

const STEPS = [
  { n: 1, minAgeMs: 15 * 60 * 1000 },
  { n: 2, minAgeMs: 2 * 60 * 60 * 1000 },
  { n: 3, minAgeMs: 24 * 60 * 60 * 1000 },
];
const DEFAULT_COUPONS = { step2: { code: "VUELVO5", pct: 5 }, step3: { code: "ULTIMACHANCE15", pct: 15 } };
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AGE_MS = 3 * DAY_MS;        // más viejo que esto no se molesta
const LOOKBACK_MS = 30 * DAY_MS;      // ventana de herencia por email
const COOLDOWN_MS = 30 * DAY_MS;      // después del paso 3 (o 99) no se re-flujea
const CLAIM_TTL_MS = 5 * 60 * 1000;   // un claim vivo bloquea a otro proceso
const TIME_BUDGET_MS = 40 * 1000;     // cortar antes del timeout de Vercel
const MAX_PER_RUN = 25;
const MAX_ERRORS = 3;
const BLOCKING = new Set(["active", "paused", "payment_failed"]);

const norm = (e) => String(e || "").trim().toLowerCase();
const ts = (v) => { const t = v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
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
function rebuildPath(merchant, sub) {
  const ps = sub?.plan_snapshot || {};
  if (!ps.shopify_product_id) return null;
  const base = String(merchant?.widget_checkout_page_path || "/pages/suscripcion-form").trim();
  const q = new URLSearchParams();
  q.set("product", String(ps.shopify_product_id));
  if (ps.shopify_variant_id) q.set("variant", String(ps.shopify_variant_id));
  q.set("qty", String(Math.max(1, parseInt(sub.quantity || ps.units_per_shipment || 1, 10) || 1)));
  if (ps.frequency_days) q.set("freq_days", String(ps.frequency_days));
  return `${base.startsWith("/") ? base : "/" + base}?${q.toString()}`;
}

// Destino base del recupero: { url, allowsQuery }. allowsQuery=false → es el
// init_point de MP (404 si se le agregan params) → no se puede aplicar cupón.
export function recoverTarget(merchant, sub) {
  const hosts = merchantHosts(merchant);
  const host = hosts[0] || "";
  const rp = String(sub?.recover_path || "").trim();
  if (host && rp.startsWith("/") && !rp.startsWith("//")) return { url: `https://${host}${rp}`, allowsQuery: true };
  const built = host ? rebuildPath(merchant, sub) : null;
  if (built) return { url: `https://${host}${built}`, allowsQuery: true };
  const esu = String(sub?.fb_data?.event_source_url || "").trim();
  if (esu && hosts.length) {
    try {
      const u = new URL(esu);
      if (hosts.includes(u.hostname.toLowerCase())) return { url: esu, allowsQuery: true };
    } catch (e) { console.warn("[abandoned] event_source_url inválida:", esu.slice(0, 120), e.message); }
  }
  if (sub?.mp_init_point) return { url: String(sub.mp_init_point), allowsQuery: false };
  return { url: "", allowsQuery: false };
}

// URL final. Con cupón agrega ?rc=<token firmado> (quita code=/rc= previos).
export function computeRecoverUrl(merchant, sub, { code, step, merchantId, email } = {}) {
  const { url, allowsQuery } = recoverTarget(merchant, sub);
  if (!url || !allowsQuery) return url;
  try {
    const u = new URL(url);
    u.searchParams.delete("code");
    u.searchParams.delete("rc");
    if (code) {
      const m = merchantId || sub?.merchant_id || merchant?.id || merchant?.uid || "";
      const e = norm(email || sub?.customer_email);
      u.searchParams.set("rc", signToken({ m, e, c: String(code).toUpperCase(), s: step || 0 }, 7 * 86400));
    }
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

async function setEmailState(merchantId, email, step, subId) {
  try {
    await emailStateRef(merchantId, email).set({
      email: norm(email), last_step: step, last_step_at: new Date().toISOString(), last_subscriber_id: subId || null,
    }, { merge: true });
  } catch (e) { console.warn("[abandoned] no se pudo guardar abandoned_emails:", norm(email), e.message); }
}

// Marca "no molestar más" en el doc + estado por email.
async function markDone(merchantId, ref, email, extra = {}) {
  try { await ref.update({ abandoned_step: 99, abandoned_step_at: new Date().toISOString(), ...extra }); }
  catch (e) { console.warn("[abandoned] no se pudo marcar 99:", ref.id, e.message); }
  await setEmailState(merchantId, email, 99, ref.id);
}

// Claim atómico: solo un proceso (cron o webhook) manda cada paso.
async function claimStep(ref, target) {
  const now = Date.now();
  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return false;
      const d = snap.data();
      if ((d.abandoned_step || 0) >= target) return false;
      if (d.abandoned_claim_step === target && now - ts(d.abandoned_claim_at) < CLAIM_TTL_MS) return false;
      tx.update(ref, { abandoned_claim_step: target, abandoned_claim_at: new Date(now).toISOString() });
      return true;
    });
  } catch (e) {
    console.warn("[abandoned] claim falló:", ref.id, e.message);
    return false;
  }
}

// ¿El mail tiene alguna sub que lo bloquee (active/paused/payment_failed)?
async function hasBlockingSub(merchantId, rawEmail) {
  const col = db().collection("merchants").doc(merchantId).collection("subscribers");
  const variants = [...new Set([String(rawEmail || "").trim(), norm(rawEmail)].filter(Boolean))];
  for (const v of variants) {
    const q = await col.where("customer_email", "==", v).get();
    if (q.docs.some(d => BLOCKING.has(d.data().status))) return true;
  }
  return false;
}

// ─── Flujo principal ────────────────────────────────────────────
export async function sendAbandonedEmails(merchantId, merchant) {
  // KILL SWITCH: el flujo solo corre si el merchant lo habilitó explícitamente
  // (abandoned_enabled === true). Por defecto está APAGADO.
  if (!merchant || merchant.abandoned_enabled !== true) return 0;
  const start = Date.now();
  const now = start;
  const col = db().collection("merchants").doc(merchantId).collection("subscribers");
  // pending = candidatos; error/cancelled solo para heredar paso/cooldown por mail.
  const snap = await col.where("status", "in", ["pending", "error", "cancelled"]).get();

  // Agrupar por email (normalizado).
  const byEmail = new Map(); // email → { docs:[{ref,s}], maxStep, lastStepAt, oldest, anchor, blocked }
  for (const doc of snap.docs) {
    const s = doc.data();
    const email = norm(s.customer_email);
    if (!email) continue;
    const created = ts(s.created_at);
    if (!created || now - created > LOOKBACK_MS) continue;
    let g = byEmail.get(email);
    if (!g) { g = { docs: [], maxStep: 0, lastStepAt: 0, oldest: 0, anchor: 0, blocked: false }; byEmail.set(email, g); }
    const step = s.abandoned_step || 0;
    if (step > g.maxStep) g.maxStep = step;
    if (ts(s.abandoned_step_at) > g.lastStepAt) g.lastStepAt = ts(s.abandoned_step_at);
    if (s.abandoned_unsubscribed) g.blocked = true;
    if (s.status !== "pending") continue;
    if ((s.shopify_orders || []).length > 0 || s.mp_preapproval_status === "authorized") { g.blocked = true; continue; }
    g.docs.push({ ref: doc.ref, s, created });
    if (!g.oldest || created < g.oldest) g.oldest = created;
    // Heartbeat: si el lead siguió activo en el checkout, el reloj arranca ahí.
    const hb = ts(s.last_capture_at) || (s.capture === true ? ts(s.updated_at) : 0);
    if (hb > g.anchor) g.anchor = hb;
  }

  const candidates = [];
  for (const [email, g] of byEmail) {
    if (!g.docs.length || g.blocked) continue;
    if (g.maxStep >= 98) continue;                       // 99 = no molestar, 98 = error
    const anchor = Math.max(g.oldest, g.anchor);
    const age = now - anchor;
    if (age > MAX_AGE_MS) continue;
    let target = 0;
    for (const st of STEPS) if (age >= st.minAgeMs) target = st.n;
    if (target === 0 || target <= g.maxStep) continue;   // < 15 min o ese paso ya salió
    // Doc a usar: el intento más reciente (tiene el recover_path/init_point actual).
    g.docs.sort((a, b) => b.created - a.created);
    candidates.push({ email, ref: g.docs[0].ref, s: g.docs[0].s, target, anchor, maxStep: g.maxStep });
  }
  candidates.sort((a, b) => a.anchor - b.anchor);

  const coupons = resolveCoupons(merchant);
  let sent = 0, processed = 0;

  for (const c of candidates) {
    if (processed >= MAX_PER_RUN) break;
    if (Date.now() - start > TIME_BUDGET_MS) { console.warn(`[abandoned] ${merchantId}: corte por tiempo (${processed} procesados)`); break; }
    const { email, ref, s } = c;
    let { target } = c;
    processed++;

    // Estado por email (cubre docs que dejaron de ser pending) + cooldown 30 días.
    const st = await abandonedStatusForEmail(merchantId, email);
    if (st.unsubscribed) {
      try { await ref.update({ abandoned_unsubscribed: true }); } catch (e) { console.warn("[abandoned] update unsub falló:", ref.id, e.message); }
      continue;
    }
    const stRecent = st.last_step && now - ts(st.last_step_at) < COOLDOWN_MS;
    if (stRecent && st.last_step >= 3) continue;         // 3 ó 99 en <30 días → cooldown
    if (stRecent && st.last_step >= target) continue;    // ese paso ya salió por otro doc

    // (a) Sync MP: si autorizó / hay pagos / ya está activa → no molestar.
    if (!s.capture) {
      try {
        const r = await syncSubscriber(merchantId, ref.id);
        if (r && (BLOCKING.has(r.status) || r.mp_preapproval_status === "authorized" || (r.payments_found || 0) > 0 ||
                  (r.charges_processed || 0) > 0 || r.shopify_order_id)) {
          await markDone(merchantId, ref, email, { abandoned_reason: "mp_" + (r.mp_preapproval_status || r.status || "paid") });
          continue;
        }
      } catch (e) { console.warn("[abandoned] sync falló:", ref.id, e.message); }
    }
    // (b) Otra sub del mismo mail activa/pausada/con pago fallido → no molestar.
    try {
      if (await hasBlockingSub(merchantId, s.customer_email)) { await markDone(merchantId, ref, email, { abandoned_reason: "other_sub" }); continue; }
    } catch (e) { console.warn("[abandoned] query subs por email falló:", email, e.message); }
    // (d) Ya compró en Shopify (suscripción o compra única) en la ventana del plan.
    try {
      const days = Math.max(14, parseInt(s.plan_snapshot?.frequency_days, 10) || 0);
      if (merchant.shopify_shop && merchant.shopify_token &&
          await shHasRecentPaidOrder(merchant.shopify_shop, merchant.shopify_token, s.customer_email, days)) {
        await markDone(merchantId, ref, email, { abandoned_bought: true, abandoned_reason: "shopify_order" });
        continue;
      }
    } catch (e) { console.warn("[abandoned] shHasRecentPaidOrder falló:", email, e.message); }

    // Claim atómico (cron vs webhook).
    if (!(await claimStep(ref, target))) continue;

    // Cupón + URL. Si el destino es el init_point de MP no se puede aplicar → sin cupón.
    const { allowsQuery, url: baseUrl } = recoverTarget(merchant, s);
    const cp = allowsQuery ? (coupons[target] || null) : null;
    if (!baseUrl) console.warn(`[abandoned] ${ref.id}: sin URL de recupero (mail sale sin botón)`);
    const recoverUrl = computeRecoverUrl(merchant, s, { code: cp?.code, step: target, merchantId, email });

    let r;
    try {
      r = await emailAbandonedCheckout({
        to: s.customer_email,
        customerName: s.customer_name,
        productTitle: s.plan_snapshot?.product_title || "tu suscripción",
        amount: s.plan_snapshot?.total_per_charge_ars || 0,
        recoverUrl,
        merchant, merchantId,
        step: target,
        couponCode: cp?.code || null,
        couponPct: cp?.pct || 0,
      });
    } catch (e) {
      r = { ok: false, error: `throw: ${e.message}` };
    }

    const logBase = {
      type: "abandoned", subscriber_id: ref.id, to: s.customer_email,
      customer_name: s.customer_name, product_title: s.plan_snapshot?.product_title,
      step: target, coupon: cp?.code || null,
    };
    if (r?.skipped) {
      // Resend no configurado: soltar el claim, NO marcar → reintenta al configurar.
      try { await ref.update({ abandoned_claim_step: null }); } catch (e) { console.warn("[abandoned] release claim falló:", ref.id, e.message); }
      continue;
    }
    if (r?.ok === false || r?.error) {
      const errs = (s.abandoned_error_count || 0) + 1;
      const patch = { abandoned_error_count: errs, abandoned_last_error: String(r.error || "error").slice(0, 300), abandoned_claim_step: null };
      if (errs >= MAX_ERRORS) { patch.abandoned_step = 98; patch.abandoned_step_at = new Date().toISOString(); }
      try { await ref.update(patch); } catch (e) { console.warn("[abandoned] update error falló:", ref.id, e.message); }
      if (errs >= MAX_ERRORS) await setEmailState(merchantId, email, 98, ref.id);
      await logEmail(merchantId, { ...logBase, status: "error", error: r.error });
      console.error(`[abandoned] ${merchantId}/${ref.id} paso ${target} → ${s.customer_email}: ${r.error} (intento ${errs})`);
      continue;
    }
    try {
      await ref.update({ abandoned_step: target, abandoned_step_at: new Date().toISOString(), abandoned_claim_step: null, abandoned_error_count: 0, abandoned_last_error: null });
    } catch (e) { console.warn("[abandoned] update step falló:", ref.id, e.message); }
    await setEmailState(merchantId, email, target, ref.id);
    await logEmail(merchantId, { ...logBase, status: "sent", provider_id: r.id || null });
    sent++;
  }
  return sent;
}
