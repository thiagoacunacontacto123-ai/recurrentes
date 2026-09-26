// Recordatorio de la demo, 2 horas antes — desde Resend, con nuestra marca.
//
// Por qué existe (26-sept-2026, Thiago): los recordatorios automáticos de
// Calendly son de plan pago, y el mail de confirmación que sí manda el gratis
// es de ellos y no se puede maquillar. Sin recordatorio, en demos agendadas en
// frío no se presenta entre el 30% y el 50%: cada ausente cuesta más que el
// abono mensual de Calendly.
//
// De dónde sale la hora: el calendario está incrustado en #/demo, así que
// cuando alguien reserva, Calendly avisa por postMessage con el URI del evento.
// El navegador nos lo manda y acá lo resolvemos contra la API de Calendly
// (token personal, disponible en el plan gratis) para sacar start_time y el
// link del Meet. Sin CALENDLY_TOKEN todo sigue andando: el lead se marca como
// agendado igual, solo que sin recordatorio.
import { db } from "./firebase.js";
import { emailDemoRecordatorio } from "./email.js";

const API = "https://api.calendly.com";
export const calendlyToken = () => String(process.env.CALENDLY_TOKEN || "").trim();

// URI de evento que da Calendly: https://api.calendly.com/scheduled_events/<uuid>
const EVENT_URI_RE = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]{6,60}$/;

// Lee el evento reservado. Devuelve { startsAt, meetUrl, cancelUrl } o null.
// Nunca lanza: si Calendly no responde, el lead queda agendado sin recordatorio.
export async function leerEventoCalendly(eventUri, { fetchImpl = fetch } = {}) {
  const tok = calendlyToken();
  if (!tok || !EVENT_URI_RE.test(String(eventUri || ""))) return null;
  try {
    const r = await fetchImpl(eventUri, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) { console.warn("[demo-reminder] calendly", r.status); return null; }
    const d = await r.json();
    const e = d?.resource || {};
    const startsAt = typeof e.start_time === "string" ? e.start_time : null;
    if (!startsAt || !Number.isFinite(Date.parse(startsAt))) return null;
    return {
      startsAt,
      meetUrl: e.location?.join_url || e.location?.location || null,
      cancelUrl: e.uri ? null : null,
    };
  } catch (err) {
    console.warn("[demo-reminder] calendly:", err.message);
    return null;
  }
}

// Hora legible para el mail, en horario de Argentina (es donde vive el cliente
// y donde está Thiago; mostrar UTC sería mandarlo a hacer la cuenta).
export function horaAR(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(t));
}

export const VENTANA_MIN = 120;   // se manda 2 h antes
const TOLERANCIA_MIN = 45;        // el cron corre cada 5 min; margen por si se atrasa
const MAX_POR_CORRIDA = 20;

// Los que tienen la demo dentro de las próximas 2 h y todavía no recibieron el
// recordatorio. Una sola consulta sobre demo_leads.
export async function enviarRecordatorios({ now = Date.now() } = {}) {
  const desde = new Date(now).toISOString();
  const hasta = new Date(now + VENTANA_MIN * 60000).toISOString();
  let snap;
  try {
    snap = await db().collection("demo_leads")
      .where("meeting_at", ">=", desde).where("meeting_at", "<=", hasta)
      .orderBy("meeting_at").limit(MAX_POR_CORRIDA).get();
  } catch (e) {
    // Falta el índice (meeting_at) → se avisa y no se rompe el cron.
    console.warn("[demo-reminder] consulta:", e.message);
    return { ok: false, error: e.message, enviados: 0 };
  }

  let enviados = 0, saltados = 0;
  for (const doc of snap.docs) {
    const l = doc.data() || {};
    if (l.reminder_sent_at) { saltados++; continue; }
    // Demasiado tarde: si el cron estuvo caído, no le mandamos un "nos vemos en
    // un rato" a alguien cuya llamada ya pasó.
    const faltan = (Date.parse(l.meeting_at) - now) / 60000;
    if (faltan < -TOLERANCIA_MIN) { saltados++; continue; }
    try {
      const r = await emailDemoRecordatorio({
        to: l.email, nombre: l.nombre, marca: l.marca,
        hora: horaAR(l.meeting_at), meetUrl: l.meeting_url || null, reagendarUrl: l.reschedule_url || null,
      });
      // El flag va SIEMPRE, salga o no el mail: con Resend caído, reintentar
      // cada 5 minutos serían 24 mails al mismo cliente cuando vuelva.
      await doc.ref.set({ reminder_sent_at: new Date(now).toISOString(), reminder_ok: r?.ok === true }, { merge: true });
      if (r?.ok) enviados++;
    } catch (e) {
      console.warn("[demo-reminder] envío:", e.message);
      await doc.ref.set({ reminder_sent_at: new Date(now).toISOString(), reminder_ok: false }, { merge: true }).catch(() => {});
    }
  }
  return { ok: true, enviados, saltados, mirados: snap.size };
}
