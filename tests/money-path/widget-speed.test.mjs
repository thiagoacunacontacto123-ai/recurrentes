// Velocidad del widget (Wellfresh tardaba ~4 s en aparecer).
//
// Tres cosas lo sostienen y las tres se prueban acá:
//   1. el bundle se pide POR PRODUCTO, en paralelo con el plan (no en fila);
//   2. las fotos NO viajan adentro del JSON: salen como URL cacheable
//      (`view=img`). Eran el 70% del peso —130 KB de 185— y nada se pintaba
//      hasta que llegaba entero (27-sept-2026, Thiago);
//   3. public?action=plan tampoco manda fotos base64 al widget (sí al checkout).
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget } = await loadApi("api/widget.js");
const { default: pub } = await loadApi("api/public.js");
const IMG = "data:image/png;base64," + "QUJD".repeat(8000);   // ~24 KB, como las de verdad
beforeEach(() => {
  createWorld();
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_variant: "v12" }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan({ pricing_mode: "packs", packs: [
    { qty: 1, price_ars: 100, image: IMG, gifts: [{ title: "Guía", image: IMG, virtual: true }] },
    { qty: 2, price_ars: 180, image: IMG },
  ] }));
});

test("view=bundle: la foto sale como URL, no adentro del JSON — que es lo que lo hacía lento", async () => {
  const r = await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", product: "7001", v: "2" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.v, 2);
  assert.equal(r.body.assets.length, 1, "una sola entrada por foto, aunque el HTML la repita");
  assert.ok(!r.body.payload.includes("data:image"), "ni una foto adentro del payload");
  assert.ok(!JSON.stringify(r.body).includes("data:image"), "ni en toda la respuesta: eso era el 70% del peso");

  // Cada asset es una URL a NUESTRO dominio, con el hash que la hace cacheable.
  const url = r.body.assets[0];
  assert.match(url, /view=img/);
  assert.match(url, new RegExp(`plan=${PLAN_ID}`));
  assert.match(url, /[?&]i=0(&|$)/);
  assert.match(url, /[?&]h=[0-9a-f]{8}/, "el hash es lo que avisa que la foto cambió");

  const copias = (r.body.payload.match(/__RCIMG0__/g) || []).length;
  assert.ok(copias >= 4, `la foto aparece ${copias} veces como token (estados + packs)`);

  const r1 = await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", plan: PLAN_ID } });
  const pesoViejo = JSON.stringify(r1.body).length, pesoNuevo = JSON.stringify(r.body).length;
  assert.ok(pesoNuevo * 3 < pesoViejo, `pesa ${pesoNuevo} contra ${pesoViejo}: tiene que ser MUCHO menos, no un poco`);

  // Mismo unpack que hace widget.js: donde iba el data:image ahora va la URL.
  const txt = r.body.payload.replace(/__RCIMG(\d+)__/g, (m, i) => r.body.assets[Number(i)]);
  const o = JSON.parse(txt);
  assert.equal(o.plan_id, PLAN_ID);
  assert.ok(o.bundle.states["sub:0"].includes(url), "el HTML reconstruido apunta a la foto");
  assert.equal(o.bundle.packs[0].image, url);
});

test("view=img devuelve la foto de verdad, cacheada para siempre", async () => {
  const b = await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", product: "7001", v: "2" } });
  const u = new URL(b.body.assets[0], "https://x.test");

  const r = await invoke(widget, { method: "GET", query: { merchant: MID, view: "img", plan: PLAN_ID, i: "0", h: u.searchParams.get("h") } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["content-type"], "image/png");
  // Un año e immutable: se puede porque el hash cambia si cambia la foto.
  assert.match(String(r.headers["cache-control"]), /max-age=31536000/);
  assert.match(String(r.headers["cache-control"]), /immutable/);
  // Y son los bytes de la foto, no el data:image.
  const esperado = Buffer.from(IMG.slice(IMG.indexOf(";base64,") + 8), "base64");
  assert.equal(Buffer.from(r.body).length, esperado.length);
  assert.ok(Buffer.from(r.body).equals(esperado), "los bytes son los de la foto");
});

test("view=img no sirve cualquier cosa que le pidan", async () => {
  const q = (over) => invoke(widget, { method: "GET", query: { merchant: MID, view: "img", plan: PLAN_ID, i: "0", ...over } });
  assert.equal((await q({ i: "9" })).statusCode, 404, "un índice que no existe");
  assert.equal((await q({ i: "999" })).statusCode, 400, "un índice absurdo ni se consulta");
  assert.equal((await q({ i: "-1" })).statusCode, 400, "índice negativo");
  assert.equal((await q({ i: "abc" })).statusCode, 400, "índice que no es número");
  assert.equal((await q({ plan: "../otro" })).statusCode, 400, "id de plan raro");
  assert.equal((await q({ plan: "noexiste" })).statusCode, 404, "plan que no existe");
});

test("si la foto cambia, cambia el hash: nadie se queda con la vieja", async () => {
  const antes = (await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", product: "7001", v: "2" } })).body.assets[0];
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan({ pricing_mode: "packs", packs: [
    { qty: 1, price_ars: 100, image: "data:image/png;base64," + "WFla".repeat(8000) },
  ] }));
  const despues = (await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", product: "7001", v: "2" } })).body.assets[0];
  assert.notEqual(antes, despues, "la URL tiene que cambiar, si no el navegador sirve la vieja un año");
});

test("public?action=plan: al widget sin fotos base64; al checkout (checkout=1) completas", async () => {
  const w = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, product: "7001" } });
  assert.equal(w.body.plan.packs[0].image, null); assert.equal(w.body.plan.packs[0].gifts[0].image, null);
  assert.equal(w.body.plan.packs.length, 2, "la lista completa (los índices no se corren)");
  const c = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, product: "7001", checkout: "1" } });
  assert.equal(c.body.plan.packs[0].image, IMG);
});
