// Bloque de suscripción en la descripción del producto de Tiendanube.
// Es el reemplazo del widget mientras Tiendanube no inyecte nuestro script (solo
// lo hace con apps aprobadas). Va en HTML con estilos en línea porque es lo único
// que deja pasar en una descripción: los <script> los borra por seguridad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tnSubscriptionBlock, upsertBlock, stripBlock, hasBlock, freqText, RC_START, RC_END } from "../../shared/platform/tnBlock.js";

const PLAN = { subscription_price_ars: 85, base_price_ars: 100, discount_pct: 15, frequency_days: 30 };
const URL_CK = "https://www.recurrentesapp.com/#/checkout?merchant=m1&plan=p1";
const bloque = (over = {}) => tnSubscriptionBlock({ plan: { ...PLAN, ...over.plan }, planId: "p1", checkoutUrl: URL_CK, ...over });

test("el bloque no lleva JavaScript ni <style>: Tiendanube los borra", () => {
  const b = bloque();
  assert.ok(!/<script/i.test(b), "sin <script>");
  assert.ok(!/<style/i.test(b), "sin <style>");
  assert.ok(!/\son\w+=/i.test(b), "sin handlers inline tipo onclick");
});

test("muestra precio, frecuencia, descuento y el link al checkout", () => {
  const b = bloque();
  assert.ok(b.includes("$85"), "el precio de la suscripción");
  assert.ok(b.includes("por mes"), "la frecuencia en palabras");
  assert.ok(b.includes("15% OFF") && b.includes("$100"), "el descuento y el precio tachado");
  assert.ok(b.includes("recurrentesapp.com/#/checkout"), "el botón lleva al checkout");
});

test("sin descuento no inventa un precio tachado", () => {
  const b = bloque({ plan: { discount_pct: 0, base_price_ars: 85 } });
  assert.ok(!b.includes("OFF"), "no muestra un OFF que no existe");
  assert.ok(!b.includes("line-through"), "no tacha nada");
});

test("escapa el HTML de lo que viene de afuera", () => {
  const b = tnSubscriptionBlock({ plan: PLAN, planId: 'p"><img src=x>', checkoutUrl: 'https://x/?a="><script>' });
  assert.ok(!/<img/i.test(b) && !/<script/i.test(b), "nada inyectable sobrevive");
  assert.ok(b.includes("&quot;") || b.includes("&gt;"), "quedó escapado");
});

test("upsert conserva la descripción del comerciante y strip la devuelve intacta", () => {
  const mia = "<p>Gomitas ricas, hechas en Argentina.</p>";
  const con = upsertBlock(mia, bloque());
  assert.ok(con.startsWith(mia), "la descripción del comerciante queda primero y completa");
  assert.ok(hasBlock(con));
  assert.equal(stripBlock(con), mia, "sacarlo devuelve exactamente lo que había");
});

test("upsert dos veces no duplica el bloque", () => {
  const uno = upsertBlock("<p>hola</p>", bloque());
  const dos = upsertBlock(uno, bloque({ plan: { subscription_price_ars: 99 } }));
  assert.equal(dos.split(RC_START).length - 1, 1, "un solo bloque");
  assert.equal(dos.split(RC_END).length - 1, 1);
  assert.ok(dos.includes("$99"), "y quedó el precio nuevo");
  assert.ok(dos.startsWith("<p>hola</p>"));
});

test("descripción vacía: el bloque queda solo, sin saltos de más", () => {
  const b = bloque();
  assert.equal(upsertBlock("", b), b);
  assert.equal(upsertBlock(null, b), b);
  assert.equal(stripBlock(b), "");
});

test("strip sobre una descripción sin bloque no toca nada", () => {
  assert.equal(stripBlock("<p>solo mi texto</p>"), "<p>solo mi texto</p>");
  assert.equal(hasBlock("<p>solo mi texto</p>"), false);
});

test("frecuencias en palabras", () => {
  assert.equal(freqText(7), "semana");
  assert.equal(freqText(15), "15 días");
  assert.equal(freqText(30), "mes");
  assert.equal(freqText(60), "2 meses");
  assert.equal(freqText(21), "3 semanas");
  assert.equal(freqText(undefined), "mes");
});

// ─── Compra única dentro del bloque ─────────────────────────────────────────
test("con variante y precio base, incluye la compra única como formulario nativo de Tiendanube", () => {
  const b = tnSubscriptionBlock({ plan: { ...PLAN, shopify_variant_id: "1597700160" }, planId: "p1", checkoutUrl: URL_CK });
  assert.ok(b.includes('action="/comprar/"'), "postea al mismo endpoint que el botón del tema");
  assert.ok(b.includes('name="add_to_cart" value="1597700160"'), "con la variante del plan");
  assert.ok(b.includes('name="quantity" value="1"'));
  assert.ok(b.includes("Comprar una vez") && b.includes("Suscribirme"), "las dos opciones");
  assert.ok(b.includes("Compra única") && b.includes("$100"), "muestra el precio de lista de la compra única");
});

test("sin variante no inventa una compra única (plan manual o sin catálogo)", () => {
  const b = tnSubscriptionBlock({ plan: PLAN, planId: "p1", checkoutUrl: URL_CK });
  assert.ok(!b.includes("<form"), "sin formulario");
  assert.ok(!b.includes("Comprar una vez"));
  assert.ok(b.includes("Suscribirme"), "pero la suscripción sigue");
});

test("la variante se sanea a dígitos: no se puede inyectar en el value", () => {
  const b = tnSubscriptionBlock({ plan: { ...PLAN, shopify_variant_id: '12"><script>x</script>' }, planId: "p1", checkoutUrl: URL_CK });
  assert.ok(b.includes('value="12"'), "solo quedan los dígitos");
  assert.ok(!/<script/i.test(b));
});
