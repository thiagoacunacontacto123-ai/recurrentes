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
  { id: "store", label: "El inventario de mi tienda", desc: "Se mira el stock que tenés cargado en la tienda, como en cualquier venta." },
  { id: "own",   label: "La suscripción no mira stock", desc: "Se despacha igual aunque la tienda esté en cero: lo usás si guardás aparte el stock de tus suscriptores." },
];

// `on_missing`: qué se hace cuando falta. En los dos casos la orden SE CREA:
// el cobro ya se hizo y una orden que no existe es plata cobrada sin pedido.
export const STOCK_ON_MISSING = [
  {
    id: "charge",
    label: "Crear la orden igual y avisarme",
    desc: "La orden entra como siempre (el stock puede quedar en negativo) y te avisamos para que repongas. Es lo que pasa hoy.",
  },
  {
    id: "pause",
    label: "Crear la orden y pausar la suscripción",
    desc: "La orden de este cobro entra igual, pero la suscripción queda en pausa para que no se cobre la próxima. Si tenés prendido el flujo \"Suscripción pausada\", al cliente le llega el aviso. La reactivás cuando tengas stock.",
  },
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
/** Una tarifa apagada no se le ofrece al que se suscribe. */
export const rateOff = (r) => r?.off === true;
