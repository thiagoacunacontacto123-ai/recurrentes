// Flujo de carrito abandonado de suscripción.
//
// Busca subs en "pending" (iniciaron el checkout y NO pagaron) de un merchant,
// con una antigüedad de 1h a 3 días, sin orden y a las que todavía no se les
// mandó el mail de recupero. Deduplica por email (solo el intento más reciente)
// y les manda UN mail con el link para retomar el pago.
//
// Se dispara desde el cron (1×/día en Hobby) y desde el webhook self-heal (cada
// venta nueva) → así, con tráfico, los mails salen a las pocas horas sin depender
// de un cron frecuente. Idempotente: marca `abandoned_email_sent_at`.
import { db } from "./firebase.js";
import { emailAbandonedCheckout } from "./email.js";
import { syncSubscriber } from "./sync.js";

const MIN_AGE_MS = 60 * 60 * 1000;          // 1 hora (le dimos tiempo a completar)
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // 3 días (más viejo no vale la pena)

export async function sendAbandonedEmails(merchantId, merchant) {
  const now = Date.now();
  const snap = await db().collection("merchants").doc(merchantId).collection("subscribers")
    .where("status", "==", "pending").get();

  // Dedup por email → el intento MÁS RECIENTE (si reintentó varias veces).
  const byEmail = {};
  for (const doc of snap.docs) {
    const s = doc.data();
    if (s.abandoned_email_sent_at) continue;             // ya se le mandó
    if ((s.shopify_orders || []).length > 0) continue;   // ya convirtió
    const email = (s.customer_email || "").trim();
    if (!email) continue;
    const created = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (!created) continue;
    const age = now - created;
    if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;
    const k = email.toLowerCase();
    if (!byEmail[k] || s.created_at > byEmail[k].s.created_at) byEmail[k] = { ref: doc.ref, s };
  }

  // Tope por corrida para no exceder el timeout (el resto sale en la próxima).
  const candidates = Object.values(byEmail)
    .sort((a, b) => (a.s.created_at || "").localeCompare(b.s.created_at || "")) // más viejos primero
    .slice(0, 12);

  let sent = 0;
  for (const { ref, s } of candidates) {
    // SEGURIDAD: sincronizamos con MP ANTES de mandar. Si en realidad PAGÓ y quedó
    // trabada en pending (webhook perdido), el sync le crea la orden y la pasa a
    // active → NO le mandamos el mail de abandono (nunca molestamos a quien pagó).
    try {
      const r = await syncSubscriber(merchantId, ref.id);
      if (r && (r.status === "active" || (r.charges_processed || 0) > 0 || r.shopify_order_id)) continue;
    } catch (_) {}
    try {
      const r = await emailAbandonedCheckout({
        to: s.customer_email,
        customerName: s.customer_name,
        productTitle: s.plan_snapshot?.product_title || "tu suscripción",
        amount: s.plan_snapshot?.total_per_charge_ars || 0,
        // Link de recupero: el CHECKOUT on-store con su pack ya cargado (la URL
        // desde donde inició, guardada en fb_data), NO el link de MP (uso único +
        // feo). Fallback al init_point de MP solo si no tenemos la del checkout.
        recoverUrl: s.fb_data?.event_source_url || s.mp_init_point || "",
        // La marca del header sale del nombre en EMAIL_FROM (ej. "LuminaLabs
        // <hola@...>") o de merchant.email_brand — así el cliente NO ve "Recurrentes".
        brand: merchant?.email_brand || (process.env.EMAIL_FROM || "").split("<")[0].trim().replace(/^["']|["']$/g, "") || "",
        accent: merchant?.widget_color || "",
        from: merchant?.email_from || undefined,
      });
      // Si Resend NO está configurado (skipped), NO marcamos → se reintenta cuando
      // se configure. Si se envió (o hubo error real), marcamos para no repetir.
      if (!r?.skipped) {
        await ref.update({ abandoned_email_sent_at: new Date().toISOString() });
        if (!r?.error) sent++;
      }
    } catch (_) {}
  }
  return sent;
}
