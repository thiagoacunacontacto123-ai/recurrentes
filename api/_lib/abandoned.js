// Flujo de carrito abandonado de suscripción — SECUENCIA de 3 pasos:
//   Paso 1 → 15 min:  recordatorio simple (sin cupón).
//   Paso 2 → 2 hs:    con cupón VUELVO5 (5% OFF).
//   Paso 3 → 24 hs:   última chance con ULTIMACHANCE15 (15% OFF).
//
// Reglas:
//  · Solo subs en "pending" (iniciaron el checkout y no pagaron).
//  · Máx 3 días de antigüedad (más viejo no se molesta).
//  · Sincroniza con MP ANTES de mandar: si en realidad pagó la suscripción, le
//    crea la orden y NO le manda nada.
//  · Chequea Shopify: si el cliente YA compró (suscripción o COMPRA ÚNICA), NO
//    le manda nada.
//  · Un mail por PASO (marca `abandoned_step` = 1/2/3). Nunca repite un paso.
//  · Backfill: un sub viejo (ej. 2 días) salta directo al paso que corresponde
//    por su edad (no manda los 3 de golpe).
//
// Se dispara desde el cron + webhook self-heal. Para timing preciso (15min/2h/24h)
// necesita un cron frecuente (Vercel Pro o cron externo cada ~10 min).
import { db } from "./firebase.js";
import { emailAbandonedCheckout } from "./email.js";
import { syncSubscriber } from "./sync.js";
import { shHasRecentPaidOrder } from "./shopify.js";
import { logEmail } from "./emaillog.js";

const STEPS = [
  { n: 1, minAgeMs: 15 * 60 * 1000,      coupon: null,              pct: 0 },
  { n: 2, minAgeMs: 2 * 60 * 60 * 1000,  coupon: "VUELVO5",         pct: 5 },
  { n: 3, minAgeMs: 24 * 60 * 60 * 1000, coupon: "ULTIMACHANCE15",  pct: 15 },
];
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export async function sendAbandonedEmails(merchantId, merchant) {
  const now = Date.now();
  const snap = await db().collection("merchants").doc(merchantId).collection("subscribers")
    .where("status", "==", "pending").get();

  // Elegir candidatos: por cada email, el intento más reciente que tenga un PASO
  // pendiente (target > abandoned_step ya enviado).
  // También registramos, por email, la última vez que recibió un mail del flujo
  // (en cualquier intento) → para el cooldown de 30 días.
  const byEmail = {};
  const lastFlow = {}; // email → { at, subId }
  for (const doc of snap.docs) {
    const s = doc.data();
    const email = (s.customer_email || "").trim();
    if (!email) continue;
    const k0 = email.toLowerCase();
    if (s.abandoned_step_at && (!lastFlow[k0] || s.abandoned_step_at > lastFlow[k0].at)) {
      lastFlow[k0] = { at: s.abandoned_step_at, subId: doc.id };
    }
    if ((s.shopify_orders || []).length > 0) continue;
    const created = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (!created) continue;
    const age = now - created;
    if (age > MAX_AGE_MS) continue;

    let target = 0;
    for (const st of STEPS) if (age >= st.minAgeMs) target = st.n;
    if (target === 0) continue;                 // < 15 min: todavía no
    const done = s.abandoned_step || 0;
    if (target <= done) continue;               // ese paso (o más) ya se mandó

    const k = email.toLowerCase();
    if (!byEmail[k] || s.created_at > byEmail[k].s.created_at) byEmail[k] = { ref: doc.ref, s, target };
  }

  const candidates = Object.values(byEmail)
    .sort((a, b) => (a.s.created_at || "").localeCompare(b.s.created_at || ""))
    .slice(0, 12);

  const fromName = (process.env.EMAIL_FROM || "").split("<")[0].trim().replace(/^["']|["']$/g, "");
  const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
  let sent = 0;

  for (const { ref, s, target } of candidates) {
    // 0) COOLDOWN 30 días: si este es un intento NUEVO (aún sin ningún paso) pero
    //    esta persona ya recibió el flujo en OTRO intento hace <30 días → no re-flujea.
    //    (La progresión del mismo intento no se bloquea: sólo cuenta otro sub.)
    const own = s.abandoned_step || 0;
    const lf = lastFlow[(s.customer_email || "").toLowerCase()];
    if (own === 0 && lf && lf.subId !== ref.id && (now - new Date(lf.at).getTime()) < COOLDOWN_MS) continue;

    // 1) ¿Pagó la SUSCRIPCIÓN y quedó trabada? Sync → si pagó, crea orden y no emaila.
    try {
      const r = await syncSubscriber(merchantId, ref.id);
      if (r && (r.status === "active" || (r.charges_processed || 0) > 0 || r.shopify_order_id)) continue;
    } catch (_) {}
    // 2) ¿Ya compró en Shopify (suscripción O compra única)? → no emailar. Marcamos
    //    para no volver a intentarlo con esta persona.
    try {
      if (merchant?.shopify_shop && merchant?.shopify_token &&
          await shHasRecentPaidOrder(merchant.shopify_shop, merchant.shopify_token, s.customer_email)) {
        await ref.update({ abandoned_step: 99, abandoned_bought: true });
        continue;
      }
    } catch (_) {}

    const step = STEPS.find(x => x.n === target) || STEPS[0];
    const baseUrl = s.fb_data?.event_source_url || s.mp_init_point || "";
    // El cupón se aplica solo en el checkout via ?code= (el widget lo autocompleta).
    const recoverUrl = (step.coupon && baseUrl)
      ? baseUrl + (baseUrl.includes("?") ? "&" : "?") + "code=" + encodeURIComponent(step.coupon)
      : baseUrl;

    try {
      const r = await emailAbandonedCheckout({
        to: s.customer_email,
        customerName: s.customer_name,
        productTitle: s.plan_snapshot?.product_title || "tu suscripción",
        amount: s.plan_snapshot?.total_per_charge_ars || 0,
        recoverUrl,
        brand: merchant?.email_brand || fromName || "",
        accent: merchant?.widget_color || "",
        from: merchant?.email_from || undefined,
        step: target,
        couponCode: step.coupon,
        couponPct: step.pct,
      });
      // Si Resend no está configurado (skipped), NO marcamos → reintenta al configurar.
      if (!r?.skipped) {
        await ref.update({ abandoned_step: target, abandoned_step_at: new Date().toISOString() });
        await logEmail(merchantId, {
          type: "abandoned", subscriber_id: ref.id, to: s.customer_email,
          customer_name: s.customer_name, product_title: s.plan_snapshot?.product_title,
          step: target, coupon: step.coupon, status: r?.error ? "error" : "sent", error: r?.error || null,
        });
        if (!r?.error) sent++;
      }
    } catch (_) {}
  }
  return sent;
}
