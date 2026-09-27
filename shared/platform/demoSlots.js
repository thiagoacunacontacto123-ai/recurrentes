// Horarios disponibles para la demo, sin Calendly (28-sept-2026, Thiago: "Calendly
// es tosco; que el horario sea una opción más del formulario y vaya directo a
// nuestro calendar"). Función pura, compartida por api/ y el navegador.
//
// Todo en hora de Argentina (UTC-3 fijo: no hay horario de verano).
export const DEMO_TZ = "America/Argentina/Buenos_Aires";
export const AR_OFFSET_MIN = -180;
export const DEMO_DURATION_MIN = 15;
export const DEMO_STEP_MIN = 15;
export const DEMO_MIN_LEAD_MIN = 120;   // no se puede reservar para dentro de menos de 2 h
export const DEMO_HORIZON_DAYS = 14;    // se ofrecen 2 semanas hacia adelante

// Franja por defecto: lunes a viernes de 10 a 18. Formato de la env DEMO_HOURS:
// "1-5:10-18" o varias separadas por coma: "1-5:10-13,1-5:15-19,6:10-13".
// Días 0=domingo … 6=sábado. Horas enteras o con media: "10.5-18".
export function parseHours(spec) {
  const out = [];
  for (const part of String(spec || "1-5:10-18").split(",")) {
    const m = part.trim().match(/^(\d)(?:-(\d))?:(\d{1,2}(?:\.5)?)-(\d{1,2}(?:\.5)?)$/);
    if (!m) continue;
    const d1 = +m[1], d2 = m[2] != null ? +m[2] : d1;
    const h1 = parseFloat(m[3]), h2 = parseFloat(m[4]);
    if (d1 > 6 || d2 > 6 || h2 <= h1 || h2 > 24) continue;
    for (let d = d1; d <= d2; d++) out.push({ day: d, from: h1 * 60, to: h2 * 60 });
  }
  return out.length ? out : [{ day: 1, from: 600, to: 1080 }, { day: 2, from: 600, to: 1080 }, { day: 3, from: 600, to: 1080 }, { day: 4, from: 600, to: 1080 }, { day: 5, from: 600, to: 1080 }];
}

// Medianoche (hora AR) del día que contiene `t`, en ms UTC.
function arMidnight(t) {
  const local = t + AR_OFFSET_MIN * 60000;
  const day = Math.floor(local / 86400000) * 86400000;
  return day - AR_OFFSET_MIN * 60000;
}
const arWeekday = (t) => new Date(t + AR_OFFSET_MIN * 60000).getUTCDay();

// Devuelve los inicios posibles (ISO UTC) entre `now` y `now + horizonDays`, en la
// franja `rules`, sin pisar los `busy` [{start,end}] del calendario ni el mínimo
// de anticipación. `blocked` son inicios ya reservados por nosotros (ISO).
export function availableSlots({ now = Date.now(), rules = parseHours(), busy = [], blocked = [],
  durationMin = DEMO_DURATION_MIN, stepMin = DEMO_STEP_MIN, minLeadMin = DEMO_MIN_LEAD_MIN, horizonDays = DEMO_HORIZON_DAYS } = {}) {
  const from = now + minLeadMin * 60000;
  const to = now + horizonDays * 86400000;
  const busyMs = busy.map((b) => [Date.parse(b.start), Date.parse(b.end)]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const blockedMs = new Set(blocked.map((s) => Date.parse(s)).filter(Number.isFinite));
  const out = [];
  for (let day = arMidnight(now); day < to; day += 86400000) {
    const wd = arWeekday(day);
    for (const r of rules) {
      if (r.day !== wd) continue;
      for (let m = r.from; m + durationMin <= r.to; m += stepMin) {
        const start = day + m * 60000, end = start + durationMin * 60000;
        if (start < from || start > to) continue;
        if (blockedMs.has(start)) continue;
        if (busyMs.some(([a, b]) => start < b && end > a)) continue;
        out.push(new Date(start).toISOString());
      }
    }
  }
  return out;
}

// Para el formulario: agrupa por día AR → [{ date: "2026-09-29", label: "lun 29 sep", slots: [{ iso, label: "10:00" }] }]
export function groupSlotsByDay(slots) {
  const days = new Map();
  const fDay = new Intl.DateTimeFormat("es-AR", { timeZone: DEMO_TZ, weekday: "short", day: "numeric", month: "short" });
  const fHour = new Intl.DateTimeFormat("es-AR", { timeZone: DEMO_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  for (const iso of slots) {
    const t = Date.parse(iso);
    const key = new Date(t + AR_OFFSET_MIN * 60000).toISOString().slice(0, 10);
    if (!days.has(key)) days.set(key, { date: key, label: fDay.format(new Date(t)).replace(/\./g, "").replace(",", ""), slots: [] });
    days.get(key).slots.push({ iso, label: fHour.format(new Date(t)) });
  }
  return [...days.values()];
}
