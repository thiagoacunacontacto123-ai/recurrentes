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
  // La compra única es el MISMO formulario que usa el tema para agregar al
  // carrito (POST /comprar/ con la variante y la cantidad): Tiendanube lo acepta
  // en la descripción y se comporta idéntico al botón nativo. Así el bloque es la
  // caja de compra completa y el botón del tema pasa a ser redundante.
  const variant = String(plan?.tiendanube_variant_id || plan?.shopify_variant_id || "").replace(/\D/g, "");
  const conUnica = !!variant && base > 0;

  const opcion = (titulo, precio, detalle, activa) => [
    `<div style="flex:1 1 180px;min-width:0;border:2px solid ${activa ? esc(color) : "#ddd"};border-radius:12px;padding:12px 14px;background:${activa ? "#fff" : "#fafafa"}">`,
    `<div style="font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:${activa ? esc(color) : "#777"}">${titulo}</div>`,
    `<div style="font-size:20px;font-weight:800;color:#111;margin-top:2px">${precio}</div>`,
    `<div style="font-size:13px;color:#666;margin-top:2px">${detalle}</div>`,
    `</div>`,
  ].join("");

  return [
    RC_START,
    `<div id="recurrentes-plan-${esc(planId)}" class="recurrentes-bloque" style="border:2px solid ${esc(color)};border-radius:14px;padding:18px;margin:18px 0;font-family:inherit;line-height:1.45">`,
    `<div style="font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${esc(color)};margin-bottom:10px">Elegí cómo comprarlo</div>`,
    `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px">`,
    opcion(
      "Suscripción" + (ahorro ? ` · ${off}% OFF` : ""),
      `${money(price)} <span style="font-size:14px;font-weight:600;color:#666">por ${esc(freq)}</span>` + (ahorro ? ` <span style="font-size:14px;color:#999;text-decoration:line-through">${money(base)}</span>` : ""),
      `Te llega cada ${esc(freq)}. Pausás o cancelás cuando quieras.`,
      true,
    ),
    conUnica ? opcion("Compra única", money(base), "Una sola vez, sin renovación.", false) : "",
    `</div>`,
    `<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">`,
    `<a href="${esc(checkoutUrl)}" style="display:inline-block;background:${esc(color)};color:#fff;font-size:16px;font-weight:700;padding:13px 26px;border-radius:9px;text-decoration:none">Suscribirme</a>`,
    conUnica ? [
      `<form method="post" action="/comprar/" class="rc-once" style="display:inline;margin:0">`,
      `<input type="hidden" name="add_to_cart" value="${esc(variant)}">`,
      `<input type="hidden" name="quantity" value="1">`,
      `<button type="submit" style="background:#fff;color:#111;font-size:16px;font-weight:700;padding:12px 24px;border:2px solid #111;border-radius:9px;cursor:pointer">Comprar una vez</button>`,
      `</form>`,
    ].join("") : "",
    `</div>`,
    `<div style="font-size:12px;color:#888;margin-top:12px">Pago seguro con Mercado Pago · Suscripciones gestionadas por Recurrentes</div>`,
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
