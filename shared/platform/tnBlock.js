// Bloque de suscripción en HTML puro para la descripción de un producto de
// Tiendanube. SIN JavaScript, a propósito.
//
// Por qué existe: Tiendanube solo inyecta los scripts de las apps aprobadas en su
// tienda de aplicaciones, y cerró las vías nativas para que el comerciante pegue
// uno (los "códigos externos para la tienda" se dieron de baja en 2024; en
// descripciones y páginas de contenido borra los <script> por seguridad; el
// código del tema se edita solo por FTP y no en todos los planes).
//
// Lo que sí acepta —verificado contra la API con la tienda demo— es HTML con
// estilos en línea, enlaces, ids, clases, data-attributes y comentarios. Así que
// el selector se arma con eso y el botón lleva al checkout de Recurrentes.
//
// Con el scope write_products lo escribimos nosotros en la descripción del
// producto: el comerciante no pega nada. Los marcadores permiten actualizarlo o
// sacarlo sin tocar el resto de su descripción.

export const RC_START = "<!-- recurrentes:inicio -->";
export const RC_END = "<!-- recurrentes:fin -->";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

/** "mes" · "2 meses" · "semana" · "15 días" — igual que el resto del producto. */
export function freqText(days) {
  const d = parseInt(days, 10) || 30;
  if (d === 7) return "semana";
  if (d === 14 || d === 15) return d + " días";
  if (d === 30 || d === 31) return "mes";
  if (d % 30 === 0) return (d / 30) + " meses";
  if (d % 7 === 0) return (d / 7) + " semanas";
  return d + " días";
}

/**
 * HTML del bloque. `checkoutUrl` es el link público al checkout con el plan.
 * Todo con estilos en línea: Tiendanube no permite <style> ni <script>.
 */
export function tnSubscriptionBlock({ plan, planId, checkoutUrl, brandColor = "#10b981" }) {
  const price = Number(plan?.subscription_price_ars) || 0;
  const base = Number(plan?.base_price_ars) || 0;
  const off = Math.round(Number(plan?.discount_pct) || 0);
  const freq = freqText(plan?.frequency_days);
  const color = /^#[0-9a-f]{6}$/i.test(String(brandColor)) ? brandColor : "#10b981";
  const ahorro = off > 0 && base > price;

  return [
    RC_START,
    `<div id="recurrentes-plan-${esc(planId)}" class="recurrentes-bloque" style="border:2px solid ${esc(color)};border-radius:14px;padding:18px;margin:18px 0;font-family:inherit;line-height:1.45">`,
    `<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${esc(color)};margin-bottom:6px">Suscribite y recibilo siempre</div>`,
    `<div style="font-size:22px;font-weight:800;color:#111">${money(price)} <span style="font-size:15px;font-weight:600;color:#666">por ${esc(freq)}</span>`,
    ahorro ? ` <span style="font-size:15px;color:#888;text-decoration:line-through;margin-left:6px">${money(base)}</span>` : "",
    ahorro ? ` <span style="display:inline-block;background:${esc(color)};color:#fff;font-size:13px;font-weight:700;border-radius:999px;padding:2px 10px;margin-left:6px">${off}% OFF</span>` : "",
    `</div>`,
    `<div style="font-size:14px;color:#555;margin:8px 0 14px">Se cobra automáticamente cada ${esc(freq)} con Mercado Pago. Pausalo o cancelalo cuando quieras, sin llamar a nadie.</div>`,
    `<a href="${esc(checkoutUrl)}" style="display:inline-block;background:${esc(color)};color:#fff;font-size:16px;font-weight:700;padding:13px 26px;border-radius:9px;text-decoration:none">Suscribirme</a>`,
    `<div style="font-size:12px;color:#888;margin-top:10px">Pago seguro con Mercado Pago · Suscripciones gestionadas por Recurrentes</div>`,
    `</div>`,
    RC_END,
  ].filter(Boolean).join("\n");
}

/** Saca un bloque nuestro de una descripción, dejando el resto intacto. */
export function stripBlock(html) {
  const s = String(html || "");
  const i = s.indexOf(RC_START);
  const j = s.indexOf(RC_END);
  if (i === -1 || j === -1 || j < i) return s;
  return (s.slice(0, i) + s.slice(j + RC_END.length)).replace(/\n{3,}/g, "\n\n").trim();
}

/** Inserta o reemplaza el bloque al final de la descripción del comerciante. */
export function upsertBlock(html, bloque) {
  const limpio = stripBlock(html);
  return limpio ? `${limpio}\n\n${bloque}` : bloque;
}

export const hasBlock = (html) => String(html || "").includes(RC_START);
