// Velocidad del widget (25-sept-2026, Wellfresh tardaba ~4 s): el bundle se pide por producto
// (en paralelo con el plan) y en v=2 las fotos base64 viajan UNA sola vez (tokens __RCIMGn__);
// public?action=plan no manda las fotos base64 al widget (sí al checkout).
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget } = await loadApi("api/widget.js");
const { default: pub } = await loadApi("api/public.js");
const IMG = "data:image/png;base64," + "QUJD".repeat(300);
beforeEach(() => {
  createWorld();
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_variant: "v12" }));
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan({ pricing_mode: "packs", packs: [
    { qty: 1, price_ars: 100, image: IMG, gifts: [{ title: "Guía", image: IMG, virtual: true }] },
    { qty: 2, price_ars: 180, image: IMG },
  ] }));
});

test("view=bundle por producto (+v=2): resuelve el plan, empaqueta la foto una sola vez y el cliente la reconstruye", async () => {
  const r = await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", product: "7001", v: "2" } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.v, 2); assert.equal(r.body.assets.length, 1, "una sola copia de la foto");
  assert.ok(!r.body.payload.includes("data:image"), "el payload no repite la foto");
  const copias = (r.body.payload.match(/__RCIMG0__/g) || []).length;
  assert.ok(copias >= 4, `la foto aparece ${copias} veces como token (estados + packs)`);
  const r1 = await invoke(widget, { method: "GET", query: { merchant: MID, view: "bundle", plan: PLAN_ID } });
  const pesoViejo = JSON.stringify(r1.body).length, pesoNuevo = JSON.stringify(r.body).length;
  assert.ok(pesoNuevo < pesoViejo, `v=2 pesa ${pesoNuevo} vs ${pesoViejo} sin empaquetar`);
  // mismo unpack que hace widget.js
  const txt = r.body.payload.replace(/__RCIMG(\d+)__/g, (m, i) => r.body.assets[Number(i)]);
  const o = JSON.parse(txt);
  assert.equal(o.plan_id, PLAN_ID);
  assert.ok(o.bundle.states["sub:0"].includes(IMG), "el HTML reconstruido tiene la foto");
  assert.equal(o.bundle.packs[0].image, IMG);
  // sin v=2 (widget.js viejo en caché): respuesta de siempre
  assert.ok(r1.body.bundle && r1.body.bundle.states["sub:0"].includes(IMG));
});

test("public?action=plan: al widget sin fotos base64; al checkout (checkout=1) completas", async () => {
  const w = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, product: "7001" } });
  assert.equal(w.body.plan.packs[0].image, null); assert.equal(w.body.plan.packs[0].gifts[0].image, null);
  assert.equal(w.body.plan.packs.length, 2, "la lista completa (los índices no se corren)");
  const c = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, product: "7001", checkout: "1" } });
  assert.equal(c.body.plan.packs[0].image, IMG);
});
