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
  { id: "charge", label: "Cobrar igual", desc: "La orden entra y te avisamos para que repongas. Es lo que pasa hoy." },
  { id: "pause",  label: "No cobrar y pausar", desc: "Se saltea esa renovación y le avisamos al cliente. Vuelve sola cuando reponés." },
];

export const STOCK_POLICY_DEFAULT = { source: "store", on_missing: "charge" };

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
export const rateKey = (r) => String(r?.code || "").trim() || String(r?.name || "").trim().toLowerCase();

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
  const nombre = String(rate?.name || "").trim().toLowerCase();
  return !off.includes(k) && !(nombre && off.includes(nombre));
}

/** Filtra una lista de tarifas dejando solo las que el comercio ofrece. */
export const offeredRates = (rates, m) => (Array.isArray(rates) ? rates.filter(r => rateOffered(r, m)) : []);
