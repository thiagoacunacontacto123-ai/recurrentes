// Tema del checkout hosteado (24-sept-2026, Thiago: "que cada persona pueda cambiar su
// checkout"). Se guarda parcial por save-settings { checkout_theme }, el comprador recibe el
// tema RESUELTO en public?action=plan&checkout=1, y sin personalizar el acento es el color
// del widget. Lumina (sin tema) recibe exactamente los defaults con su color.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";
import { sanitizeCheckoutTheme, resolveCheckoutTheme, CHECKOUT_THEME_DEFAULTS, onColor, ctaText } from "../../shared/platform/checkoutTheme.js";

const { default: merchantApi } = await loadApi("api/merchant.js");
const { default: pub } = await loadApi("api/public.js");
const { default: widget } = await loadApi("api/widget.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { try { W.restore?.(); } catch (_) {} });

const guardar = (body) => invoke(merchantApi, { method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` }, body });
const plan = () => invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, plan: PLAN_ID, checkout: "1" } });

test("sanitize: solo claves conocidas, colores #RRGGBB, topes y links http", () => {
  const ok = sanitizeCheckoutTheme({ color: "#FF5500", font: "serif", radius: 99, header_text: "  Mi   tienda  ", show_discount: false, terms_url: "https://x.com/t", extra: "no" });
  assert.deepEqual(ok.theme, { color: "#ff5500", font: "serif", radius: 24, header_text: "Mi tienda", show_discount: false, terms_url: "https://x.com/t" });
  assert.ok(sanitizeCheckoutTheme({ color: "rojo" }).error, "color inválido");
  assert.ok(sanitizeCheckoutTheme({ font: "comic" }).error, "font inválida");
  assert.ok(sanitizeCheckoutTheme({ terms_url: "javascript:alert(1)" }).error, "link no http");
  assert.deepEqual(sanitizeCheckoutTheme({}).theme, {}, "vacío = nada");
  assert.equal(sanitizeCheckoutTheme(null).theme, null);
});

test("resolve: defaults + el color del widget como acento; el preview pisa; colores derivados", () => {
  const t = resolveCheckoutTheme(null, { widgetColor: "#123456" });
  assert.equal(t.color, "#123456");
  assert.equal(t.font, "system");
  assert.equal(t.color_on, "#ffffff", "botón oscuro → texto blanco");
  assert.equal(onColor("#ffff00"), "#111111", "botón claro → texto negro");
  const t2 = resolveCheckoutTheme({ color: "#ff5500", radius: 12 }, { widgetColor: "#123456", preview: { radius: 0 } });
  assert.equal(t2.color, "#ff5500"); assert.equal(t2.radius, 0, "preview manda");
  assert.equal(ctaText({ cta_text: "Pagar {{total}} hoy" }, "$100"), "Pagar $100 hoy");
  assert.equal(ctaText({ cta_text: "Confirmar" }, "$100"), "Confirmar $100");
  assert.equal(ctaText({}, "$100"), "Pagar suscripción · $100");
});

test("Lumina sin tema: el comprador recibe los defaults con el color de su widget", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_color: "#ab12cd" }));
  const r = await plan();
  assert.equal(r.statusCode, 200);
  const th = r.body.checkout.theme;
  assert.equal(th.color, "#ab12cd");
  for (const k of Object.keys(CHECKOUT_THEME_DEFAULTS)) if (k !== "color") assert.equal(th[k], CHECKOUT_THEME_DEFAULTS[k], `default ${k}`);
  assert.ok(th.font_stack && th.color_on && th.border, "colores derivados");
  assert.equal(r.body.checkout.color, "#ab12cd", "el campo viejo `color` sigue");
});

test("guardar por save-settings: parcial, validado, y el comprador lo ve resuelto", async () => {
  const bad = await guardar({ checkout_theme: { color: "verde" } });
  assert.equal(bad.statusCode, 400);
  const r = await guardar({ checkout_theme: { color: "#ff5500", font: "inter", show_policies: true, terms_url: "https://lumina.test/terminos", cta_text: "Pagar {{total}}", radius: 0 } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepEqual(W.merchant().checkout_theme, { color: "#ff5500", font: "inter", show_policies: true, terms_url: "https://lumina.test/terminos", cta_text: "Pagar {{total}}", radius: 0 });
  const th = (await plan()).body.checkout.theme;
  assert.equal(th.color, "#ff5500"); assert.equal(th.font, "inter"); assert.equal(th.radius, 0); assert.equal(th.show_policies, true);
  assert.equal(th.bg, "#ffffff", "lo no tocado sigue en default");
  assert.ok(String(th.font_url).includes("Inter"), "Inter trae su Google Font");
  // GET merchant expone lo guardado y lo resuelto para el diseñador
  const me = await invoke(merchantApi, { method: "GET", query: {}, headers: { authorization: `Bearer test:${MID}` } });
  assert.equal(me.body.merchant.checkout_theme.color, "#ff5500");
  assert.equal(me.body.merchant.checkout_theme_resolved.font_stack.includes("Inter"), true);
  // {} = volver al default
  const reset = await guardar({ checkout_theme: {} });
  assert.equal(reset.statusCode, 200);
  assert.equal(W.merchant().checkout_theme, null);
});

test("widget: el acento del checkout viaja en la URL (&color=) para que el cargando ya salga del color de la tienda", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_color: "#ab12cd", checkout_theme: { color: "#ff5500" } }));
  const res = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(res.body.includes('var CHECKOUT_COLOR = "#ff5500";'), "color del tema del checkout");
  assert.ok(res.body.includes('q += "&color=" + encodeURIComponent(CHECKOUT_COLOR)'), "en fbCheckoutQs (todas las URLs al checkout)");
  const ck = await invoke(widget, { method: "GET", query: { merchant: MID, view: "checkout" } });
  assert.ok(ck.body.includes('q.set("color", "#ff5500")'), "el redirect on-store también");
  // sin tema: el del widget
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_color: "#ab12cd" }));
  const res2 = await invoke(widget, { method: "GET", query: { merchant: MID } });
  assert.ok(res2.body.includes('var CHECKOUT_COLOR = "#ab12cd";'));
});
