// Editor del carrito de la suscripción (Catálogo → Carrito, 25-sept-2026): textos, qué se
// muestra y colores en merchants.cart_settings; el widget los recibe resueltos y las
// funciones de render viajan al navegador idénticas al módulo compartido.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";
import { sanitizeCartSettings, resolveCartSettings, cartBodyHtml, cartCtaText, CART_TEXT_DEFAULTS } from "../../shared/bundle/cart.js";

const { default: merchantApi } = await loadApi("api/merchant.js");
const { default: widget } = await loadApi("api/widget.js");
beforeEach(() => { createWorld(); });
const esc = (s) => String(s), fmt = (n) => "$" + n;

test("sanitize: solo claves conocidas, topes, colores válidos; resolve: defaults + lo guardado, colores del checkout salvo override", () => {
  const ok = sanitizeCartSettings({ texts: { title: "  Tu   pedido ", nada: "x" }, show_ship: false, color: "#B06571", raro: 1 });
  assert.deepEqual(ok.settings, { texts: { title: "Tu pedido" }, show_ship: false, color: "#b06571" });
  assert.ok(sanitizeCartSettings({ bg: "rojo" }).error);
  const r = resolveCartSettings(ok.settings, { color: "#10b981", color_on: "#ffffff", bg: "#ffffff", text: "#111111" });
  assert.equal(r.texts.title, "Tu pedido"); assert.equal(r.texts.cta, CART_TEXT_DEFAULTS.cta);
  assert.equal(r.toggles.show_ship, false); assert.equal(r.theme.color, "#10b981", "use_checkout_theme (default) manda");
  const r2 = resolveCartSettings({ ...ok.settings, use_checkout_theme: false }, { color: "#10b981" });
  assert.equal(r2.theme.color, "#b06571"); assert.equal(r2.theme.on, "#ffffff");
});

test("render: variables {{qty}}/{{freq}}/{{total}}, regalos con aclaración, filas apagadas", () => {
  const TXT = { ...CART_TEXT_DEFAULTS, show_ship: false, show_compare: false, gift_always: "En cada envío" };
  const html = cartBodyHtml({ label: "Pack 3", qty: 3, price_sub: 180, compare_at: 300, freq_label: "mes", gifts: [{ title: "Raspador", every: "once" }, { title: "Guía", every: "always" }] }, TXT, fmt, esc, "");
  assert.ok(html.includes("3 unidades · te llega cada mes"));
  assert.ok(html.includes("Solo en tu primer envío") && html.includes("En cada envío"));
  assert.ok(!html.includes("Envío</span>"), "fila envío apagada");
  assert.ok(!html.includes("<s>"), "sin tachado");
  assert.ok(html.includes("Ahorrás en cada envío") && html.includes("$120"));
  assert.equal(cartCtaText(TXT, "$180"), "Finalizar suscripción · $180");
});

test("save-settings guarda parcial y el widget lo emite resuelto; las funciones llegan idénticas", async () => {
  const r = await invoke(merchantApi, { method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` }, body: { cart_settings: { texts: { title: "Tu pedido", cta: "Continuar · {{total}}" }, show_compare: false } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  const me = await invoke(merchantApi, { method: "GET", query: {}, headers: { authorization: `Bearer test:${MID}` } });
  assert.deepEqual(me.body.merchant.cart_settings, { texts: { title: "Tu pedido", cta: "Continuar · {{total}}" }, show_compare: false });
  const w = await invoke(widget, { method: "GET", query: { merchant: MID } });
  const m = w.body.match(/var CART_TEXTS = (\{[^\n]*\});/); assert.ok(m, "CART_TEXTS emitido");
  const t = JSON.parse(m[1]);
  assert.equal(t.title, "Tu pedido"); assert.equal(t.show_compare, false); assert.equal(t.row_total, "Total por envío");
  const i = w.body.indexOf("var cartBodyHtml = "); const src = cartBodyHtml.toString();
  assert.equal(w.body.slice(i + 19, i + 19 + src.length), src, "la función viaja tal cual (regex intactas)");
  new Function(w.body);
  // {} = volver al default
  const reset = await invoke(merchantApi, { method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` }, body: { cart_settings: {} } });
  assert.equal(reset.statusCode, 200);
  assert.equal((await invoke(merchantApi, { method: "GET", query: {}, headers: { authorization: `Bearer test:${MID}` } })).body.merchant.cart_settings, null);
});
