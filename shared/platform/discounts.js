// Descuentos al COMPRADOR final (no confundir con pricing.js, que es lo que le
// cobramos al comerciante por usar Recurrentes).
//
// Fuente ÚNICA del tope de descuento, compartida por el checkout hosteado
// (src/pages/Checkout.jsx), el widget y el server (api/checkout/init.js).
//
// 21-sept-2026: existía para nacer. El 90 estaba escrito a mano en seis lugares
// y el checkout hosteado capeaba en 100: con el código GROWITH (99 %) sobre un
// pack de $59.492 el comprador veía "Total $595" y Mercado Pago le cobraba
// $5.949 — el server capeaba a 90 y el cliente no. El comprador se entera
// DESPUÉS de tocar Pagar, ya en MP. Nunca más dos números distintos.

/** Tope de descuento sobre el precio de lista, en %. */
export const MAX_DISCOUNT_PCT = 90;

/** Normaliza un % de descuento al rango permitido (0…MAX_DISCOUNT_PCT). */
export function clampDiscountPct(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DISCOUNT_PCT, n);
}

/**
 * Lo que se descuenta de un subtotal por un código.
 * Misma cuenta en el navegador y en el server: si difieren, el comprador ve un
 * precio y paga otro.
 *   code = { type: "percent" | "fixed", value }
 */
export function discountAmountFor(subtotal, code) {
  const sub = Math.max(0, Math.round(Number(subtotal) || 0));
  if (!code || !sub) return 0;
  if ((code.type || "percent") === "fixed") {
    return Math.min(sub, Math.max(0, Math.round(Number(code.value) || 0)));
  }
  return Math.round(sub * (clampDiscountPct(code.value) / 100));
}
