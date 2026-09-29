// Logística de la suscripción: qué envíos se ofrecen y qué hacer sin stock.
// Fuente única del panel (src/pages/Logistics.jsx) y del backend (api/*).
//
// 28-sept-2026 (Thiago, pedido de G4U). Dos cosas que hasta hoy no se podían
// decidir por tienda:
//   1. Los envíos de la tienda se traen todos, pero el comercio puede no querer
//      ofrecerlos TODOS en la suscripción (ej: sucursales sí en la compra
//      única, pero en la suscripción solo el domicilio). Se apagan de a uno.
//      Ojo: esto manda solo en NUESTRO checkout; lo que muestra el checkout de
//      la tienda para una compra común no lo tocamos.
//   2. Qué pasa cuando en la renovación no hay stock.

// ── Stock ───────────────────────────────────────────────────────────────────
// `source`: de dónde se mira el stock.
//   store → el inventario de la tienda (lo normal).
//   own   → la suscripción no mira stock: se despacha igual (para el que
//           reserva aparte lo de sus suscriptores y no lo publica en la tienda).
export const STOCK_SOURCES = [
  { id: "store", label: "Miramos el stock de tu tienda", desc: "Como en cualquier venta." },
  { id: "own",   label: "No miramos stock", desc: "Se despacha siempre, aunque tu tienda esté en cero." },
];

// `on_missing`: qué se hace cuando falta. En los dos casos la orden SE CREA:
// el cobro ya se hizo y una orden que no existe es plata cobrada sin pedido.
export const STOCK_ON_MISSING = [
  { id: "pause",  label: "No cobrar", desc: "Se saltea esa renovación, le avisamos al cliente y vuelve sola cuando reponés. Es lo que hacemos salvo que lo cambies." },
  { id: "charge", label: "Cobrar igual", desc: "La orden entra aunque el stock quede en negativo y te avisamos para que repongas." },
];

// 28-sept-2026 (Thiago): "la idea es nunca cobrar para no entregar". El default
// pasa a ser NO cobrar: si el producto no está, esa renovación se saltea y se
// avisa. El que quiera cobrar igual y despachar en negativo lo elige.
export const STOCK_POLICY_DEFAULT = { source: "store", on_missing: "pause" };

const ids = (list) => new Set(list.map(o => o.id));

/** Lo que se guarda en el merchant. `null` = default (el de hoy). */
export function sanitizeStockPolicy(raw) {
  if (raw == null) return { stock_policy: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "stock_policy debe ser un objeto" };
  const source = String(raw.source || "").trim();
  const onMissing = String(raw.on_missing || "").trim();
  if (source && !ids(STOCK_SOURCES).has(source)) return { error: `source inválido: ${source}` };
  if (onMissing && !ids(STOCK_ON_MISSING).has(onMissing)) return { error: `on_missing inválido: ${onMissing}` };
  const out = {};
  if (source && source !== STOCK_POLICY_DEFAULT.source) out.source = source;
  if (onMissing && onMissing !== STOCK_POLICY_DEFAULT.on_missing) out.on_missing = onMissing;
  // Todo igual al default = como si no hubiera nada guardado.
  return { stock_policy: Object.keys(out).length ? out : null };
}

/** Lo que usa el código: siempre completo. */
export function resolveStockPolicy(m) {
  const saved = m && typeof m.stock_policy === "object" && m.stock_policy ? m.stock_policy : {};
  return {
    source: ids(STOCK_SOURCES).has(saved.source) ? saved.source : STOCK_POLICY_DEFAULT.source,
    on_missing: ids(STOCK_ON_MISSING).has(saved.on_missing) ? saved.on_missing : STOCK_POLICY_DEFAULT.on_missing,
  };
}

/** ¿Hay que mirar el stock antes de crear la orden? Solo si cambia algo. */
export function stockCheckNeeded(m) {
  const p = resolveStockPolicy(m);
  return p.source === "store" && p.on_missing === "pause";
}

// Cuántas horas antes de la renovación se mira el stock. No puede ser "10
// minutos": Mercado Pago cobra en algún momento del día y si llegamos tarde, ya
// cobró. Mirar temprano no cuesta nada porque si el comercio repone antes de la
// fecha, la suscripción se reactiva sola en la siguiente pasada del cron.
export const STOCK_WATCH_HOURS_DEFAULT = 12;

// ── Envíos ──────────────────────────────────────────────────────────────────
// Por defecto se ofrecen TODOS los métodos de la tienda, igual que antes de que
// esto existiera (Thiago, 28-sept: "que de default esté como está ahora"). Lo
// único que se guarda es la lista de los que el comercio NO quiere en la
// suscripción — por ejemplo las sucursales, que para un envío recurrente son un
// dolor de cabeza. Vacía = todo como siempre.
//
// Se guarda por `code` cuando la tarifa tiene uno (es lo estable) y si no por
// nombre en minúsculas. Sirve igual para las tarifas guardadas (Tiendanube) que
// para las que Shopify cotiza en vivo, que no se guardan en ningún lado.
// Las tarifas de una app de envíos vienen por SUCURSAL: el mismo servicio
// aparece una vez por cada punto de retiro cercano al CP que se consultó
// (`envialo:andreani:andreani_pickup:ship:12218`, donde lo último es la
// sucursal). Apagar "Andreani HOP Paraguay 4194" no serviría de nada: el que
// compra desde otro barrio ve otras sucursales.
//
// Por eso se agrupa por SERVICIO: el code sin su último segmento, o el nombre
// antes del guión largo. Apagás "Andreani Punto de Retiro" y se van todas.
// 28-sept-2026 (Thiago: "que se agrupen").
export function rateKey(r) {
  const code = String(r?.code || "").trim();
  if (code.includes(":")) {
    const partes = code.split(":");
    return partes.length > 2 ? partes.slice(0, -1).join(":") : code;
  }
  const name = String(r?.name || "").trim();
  const corte = name.split(/\s+[—–-]\s+/)[0];
  return (code || corte || name).toLowerCase();
}

/** Lo que se le muestra al comercio: el servicio, sin la sucursal. */
export function rateLabel(r) {
  const name = String(r?.name || "").trim();
  return name.split(/\s+[—–-]\s+/)[0].trim() || name;
}

export function sanitizeShippingOff(raw) {
  if (raw == null) return { shipping_off: null };
  if (!Array.isArray(raw)) return { error: "shipping_off debe ser una lista" };
  const out = [];
  for (const v of raw) {
    const k = String(v || "").trim().slice(0, 250);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= 30) break;
  }
  return { shipping_off: out.length ? out : null };
}

/** ¿Este envío se le ofrece al que se suscribe? */
export function rateOffered(rate, m) {
  const off = Array.isArray(m?.shipping_off) ? m.shipping_off : [];
  if (!off.length) return true;
  const k = rateKey(rate);
  // Se compara por las dos claves: una tarifa puede llegar con code en un lado
  // y sin code en el otro (la misma "A sucursal" de Shopify en vivo y guardada).
  const nombre = rateLabel(rate).toLowerCase();
  return !off.includes(k) && !(nombre && off.includes(nombre));
}

/** Filtra una lista de tarifas dejando solo las que el comercio ofrece. */
export const offeredRates = (rates, m) => (Array.isArray(rates) ? rates.filter(r => rateOffered(r, m)) : []);

// ── Precio del envío EN LA SUSCRIPCIÓN (29-sept-2026, Thiago) ───────────────
// Apagar métodos no alcanzaba: lo que más se pide es "en mi tienda el envío se
// cobra, pero al que se suscribe se lo regalo". Antes eso obligaba a tocar los
// precios de la tienda, que es justo lo que no se quiere.
//
// `merchants.shipping_prices` = { "<clave del servicio>": { price, free_from } }
//   · price     → lo que paga el suscriptor por ese método (0 = gratis).
//   · free_from → gratis a partir de ese subtotal (0 / ausente = sin corte).
// Sin entrada para un método, se cobra lo que cobra la tienda: el default es
// "todo igual que siempre". La clave es la misma de `shipping_off` (el SERVICIO,
// no la sucursal), así una app de envíos con 20 puntos de retiro se toca una vez.
const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : null; };

export function sanitizeShippingPrices(raw) {
  if (raw == null) return { shipping_prices: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "shipping_prices debe ser un objeto" };
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k || "").trim().slice(0, 250);
    if (!key || !v || typeof v !== "object") continue;
    const price = num(v.price), freeFrom = num(v.free_from);
    // Sin ninguno de los dos no hay nada que pisar: se cae al precio de la tienda.
    if (price == null && !freeFrom) continue;
    out[key] = { ...(price == null ? {} : { price }), ...(freeFrom ? { free_from: freeFrom } : {}) };
    if (Object.keys(out).length >= 40) break;
  }
  return { shipping_prices: Object.keys(out).length ? out : null };
}

/** Lo que el comercio decidió para ESTE método, o null si no tocó nada. */
export function rateOverride(rate, m) {
  const map = m && typeof m.shipping_prices === "object" && m.shipping_prices ? m.shipping_prices : null;
  if (!map) return null;
  // Igual que rateOffered: por clave del servicio o por nombre, porque la misma
  // tarifa llega con code de un lado y sin code del otro.
  return map[rateKey(rate)] || map[rateLabel(rate).toLowerCase()] || null;
}

/** Lo que paga el suscriptor por este envío. Sin override = lo de la tienda. */
export function subRatePrice(rate, m, subtotal = 0) {
  const tienda = Math.max(0, Math.round(Number(rate?.price) || 0));
  const ov = rateOverride(rate, m);
  if (!ov) return tienda;
  if (ov.free_from > 0 && Number(subtotal) >= ov.free_from) return 0;
  return ov.price == null ? tienda : Math.max(0, Math.round(ov.price));
}

/** La lista tal como la tiene que ver y pagar el que se suscribe. */
export function pricedRates(rates, m, subtotal = 0) {
  return (Array.isArray(rates) ? rates : []).map(r => {
    const price = subRatePrice(r, m, subtotal);
    // `price_store` viaja para poder mostrar el tachado ("$5.900 → Gratis").
    return price === Math.max(0, Math.round(Number(r?.price) || 0))
      ? { ...r, price }
      : { ...r, price, price_store: Math.max(0, Math.round(Number(r?.price) || 0)) };
  });
}

/** Lo que se ofrece Y con el precio de la suscripción. Es lo que usa el checkout. */
export const subscriptionRates = (rates, m, subtotal = 0) => pricedRates(offeredRates(rates, m), m, subtotal);
