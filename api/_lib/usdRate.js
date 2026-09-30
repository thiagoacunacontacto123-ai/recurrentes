// Cotización del dólar para facturar la comisión (30-sept-2026, Thiago).
//
// La comisión se calcula sobre lo cobrado en PESOS y se factura en dólares, así
// que hace falta un tipo de cambio. La regla que pidió Thiago: **dólar blue, el
// más barato de las fuentes, y el de VENTA (no el de compra)**.
//
// "El más barato" = el número más CHICO de pesos por dólar. Ojo con la
// dirección: menos pesos por dólar ⇒ más dólares de comisión, así que es el que
// juega a favor de Recurrentes. Queda dicho para que nadie lo "arregle" al revés.
//
// Se consulta una vez por día y se guarda en `system/usd_rate` con la fuente y
// la hora. Cada factura se queda con el número que usó (`usd_rate`), así una
// discusión con un comercio se resuelve mirando el documento, no la API de hoy.
//
// Nunca lanza: si las dos fuentes fallan, devuelve la última cotización guardada.
// Sin ninguna (primer día, todo caído) devuelve 0 y el que llama NO factura la
// comisión de ese ciclo — preferimos no cobrar a cobrar con un número inventado.

const FUENTES = [
  { id: "dolarapi", url: "https://dolarapi.com/v1/dolares/blue", venta: (j) => Number(j?.venta) },
  { id: "bluelytics", url: "https://api.bluelytics.com.ar/v2/latest", venta: (j) => Number(j?.blue?.value_sell) },
];
const DOC = "system/usd_rate";
const FRESCO_MS = 20 * 60 * 60 * 1000;   // 20 h: una consulta por día alcanza
const TIMEOUT_MS = 6000;

async function pedir(f) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(f.url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return null;
    const v = f.venta(await r.json());
    // Banda de cordura: una cotización fuera de esto es un error de la fuente
    // (o un JSON que cambió de forma), no un salto del mercado.
    return Number.isFinite(v) && v >= 100 && v <= 100000 ? { id: f.id, venta: Math.round(v) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Consulta las fuentes y devuelve la venta más barata, o null si no hay ninguna. */
export async function fetchBlueVenta() {
  const rs = (await Promise.all(FUENTES.map(pedir))).filter(Boolean);
  if (!rs.length) return null;
  return rs.reduce((a, b) => (b.venta < a.venta ? b : a));
}

/**
 * Cotización a usar hoy. `{ rate, source, at, stale }`. `rate: 0` = no hay
 * número confiable y el ciclo no se factura.
 * `USD_RATE_MANUAL` la pisa (para una emergencia o para un test).
 */
export async function usdRate(db, { nowMs = Date.now(), force = false } = {}) {
  const manual = Number(process.env.USD_RATE_MANUAL);
  if (Number.isFinite(manual) && manual > 0) return { rate: Math.round(manual), source: "manual", at: new Date(nowMs).toISOString(), stale: false };

  const ref = db().doc(DOC);
  let guardado = null;
  try {
    const snap = await ref.get();
    if (snap.exists) guardado = snap.data();
  } catch (e) {
    console.warn("[usdRate] no pude leer la cotización guardada:", e.message);
  }
  const edad = guardado?.at ? nowMs - Date.parse(guardado.at) : Infinity;
  if (!force && guardado?.rate > 0 && edad < FRESCO_MS) {
    return { rate: guardado.rate, source: guardado.source || "cache", at: guardado.at, stale: false };
  }

  const fresco = await fetchBlueVenta();
  if (!fresco) {
    if (guardado?.rate > 0) {
      console.warn("[usdRate] las fuentes no respondieron: uso la última guardada", guardado.rate);
      return { rate: guardado.rate, source: guardado.source || "cache", at: guardado.at, stale: true };
    }
    console.warn("[usdRate] sin cotización: este ciclo no factura comisión");
    return { rate: 0, source: null, at: null, stale: true };
  }
  const at = new Date(nowMs).toISOString();
  try {
    await ref.set({ rate: fresco.venta, source: fresco.id, at, kind: "blue_venta" }, { merge: true });
  } catch (e) {
    console.warn("[usdRate] no pude guardar la cotización:", e.message);
  }
  return { rate: fresco.venta, source: fresco.id, at, stale: false };
}
