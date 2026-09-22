// (i) Cambiar de plataforma: Tiendanube → Shopify y al revés.
//
// 22-sept-2026 (Thiago): "configuré en Tiendanube, lo desactivé y ahí no vuelve
// a aparecer Shopify". El `channel` quedaba guardado en el doc y merchantProfile
// lo respetaba aunque esa tienda ya no estuviera conectada, así que la pantalla
// de Integraciones seguía mostrando solo la plataforma vieja.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadApi } from "../helpers/world.mjs";

const { merchantProfile } = await loadApi("shared/platform/profile.js");
const canal = (doc) => merchantProfile(doc).channel;

test("(i) el canal sigue a lo que está conectado, no a lo que quedó guardado", () => {
  // Se desvinculó Tiendanube y se conectó Shopify: manda Shopify.
  assert.equal(canal({ channel: "tiendanube", shopify_token: "x" }), "shopify");
  // Y al revés.
  assert.equal(canal({ channel: "shopify", tiendanube_token: "x" }), "tiendanube");
});

test("(i) con la plataforma guardada CONECTADA no se toca nada", () => {
  assert.equal(canal({ channel: "tiendanube", tiendanube_token: "x" }), "tiendanube");
  assert.equal(canal({ channel: "shopify", shopify_token: "x" }), "shopify");
});

test("(i) sin canal guardado elige por lo que haya conectado", () => {
  assert.equal(canal({}), "shopify", "sin nada, el default histórico");
  assert.equal(canal({ shopify_token: "x" }), "shopify");
  assert.equal(canal({ tiendanube_token: "x" }), "tiendanube", "con TN conectada no asume Shopify");
});

test("(i) desvincular borra el canal: no queda pegado a la plataforma vieja", async () => {
  const src = await import("node:fs").then(fs => fs.promises.readFile("api/merchant.js", "utf8"));
  assert.ok(/shopify_disconnected_at: now,\s*\n\s*channel: FieldValue\.delete\(\)/.test(src),
    "disconnect de Shopify tiene que soltar el channel");
  const tn = await import("node:fs").then(fs => fs.promises.readFile("api/_lib/tiendanubeApi.js", "utf8"));
  assert.ok(/tiendanube_disconnected_at: nowIso\(\),[\s\S]{0,260}channel: FieldValue\.delete\(\)/.test(tn),
    "disconnect de Tiendanube tiene que soltar el channel");
});

test("(i) un negocio de servicios no se ve afectado", () => {
  assert.equal(canal({ business_type: "service" }), "none");
  assert.equal(canal({ business_type: "service", channel: "tiendanube", shopify_token: "x" }), "none");
});
