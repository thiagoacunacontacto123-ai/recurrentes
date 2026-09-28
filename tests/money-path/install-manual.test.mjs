// El manual de instalación tiene UNA fuente (27-sept-2026, Thiago: "que quede
// guardado en algún lado, no en un chat").
//
// docs/page-checkout.liquid y lo que muestra el Admin salen del mismo módulo.
// Si alguien toca uno y no el otro, el comercio pega una plantilla vieja.
import "../helpers/register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pageCheckoutLiquid, themeSnippet, INSTALL_STEPS, APP_BASE } from "../../shared/platform/storeCheckout.js";

const raiz = path.resolve(new URL("../..", import.meta.url).pathname);

test("el archivo de docs es exactamente lo que muestra el Admin", () => {
  const doc = fs.readFileSync(path.join(raiz, "docs/page-checkout.liquid"), "utf8");
  assert.equal(pageCheckoutLiquid(), doc, "regenerar docs/page-checkout.liquid desde storeCheckout.js");
});

test("con un comercio elegido, sale su id y ningún marcador suelto", () => {
  const liquid = pageCheckoutLiquid("mid_123");
  assert.match(liquid, /merchant=mid_123&view=embed/);
  assert.ok(!liquid.includes("MERCHANT_ID"), "no queda el marcador para reemplazar a mano");
  assert.ok(liquid.includes(APP_BASE), "apunta a nuestro dominio");
  assert.equal(themeSnippet("mid_123"), `<script src="${APP_BASE}/api/widget?merchant=mid_123"></script>`);
});

test("la plantilla trae lo que la hace funcionar en cualquier tema", () => {
  const liquid = pageCheckoutLiquid("mid_123");
  assert.match(liquid, /id="recurrentes-checkout"/, "el div donde monta el checkout");
  assert.match(liquid, /display: block !important/, "temas con el body en grid o flex");
  assert.match(liquid, /rec-ck-off/, "esconde lo que quede del tema");
});

test("cada paso del manual dice cómo saber que quedó bien", () => {
  assert.ok(INSTALL_STEPS.length >= 5);
  for (const p of INSTALL_STEPS) {
    assert.ok(p.id && p.title, "cada paso con id y título");
    assert.ok(Array.isArray(p.body) && p.body.length, `${p.id}: sin instrucciones`);
    assert.ok(p.check && p.check.length > 10, `${p.id}: sin cómo verificarlo`);
  }
  // Los dos que más se olvidan y dejan la tienda a medias.
  const t = JSON.stringify(INSTALL_STEPS);
  assert.match(t, /OAuth/, "MP se conecta por OAuth: el token pegado no trae la public key");
  assert.match(t, /theme\.liquid/);
});
