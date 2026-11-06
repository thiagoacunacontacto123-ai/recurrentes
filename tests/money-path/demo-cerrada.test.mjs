// (d) El pedido de demo está CERRADO (6-nov-2026, Thiago: "ya me fui de ese
// nicho"). Reemplaza a demo-lead.test.mjs y demo-gcal.test.mjs.
//
// Lo que protege: que las cuatro acciones públicas de demo respondan 410 y no
// escriban NADA ni hablen con Google, incluso con el cuerpo que antes era
// válido. Si alguien reabre una por descuido, esto lo caza: volverían a
// entrar leads de un negocio que ya no se vende, y a agendarse llamadas que
// nadie va a atender.
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { rawPaths } from "../helpers/fake-firestore.mjs";

const handler = (await loadApi("api/public.js")).default;

// El mismo cuerpo que antes creaba un lead: ahora no tiene que crear nada.
const LEAD_OK = {
  nombre: "Ana Díaz", marca: "Glow Derm", whatsapp: "2664 006599", email: "ana@glowderm.test",
  plataforma: "shopify", nicho: "cosmetica", catalogo: "2_5", pedidos: "5_15",
  objetivo: "recompra", recurrencia: "25_50", modalidad: "ambos",
  confirma_llamada: true, confirma_pago: true,
};

beforeEach(() => { createWorld(); });

test("(d) las cuatro acciones de demo responden 410 y no escriben nada", async () => {
  const antes = rawPaths().length;
  for (const [action, method, body] of [
    ["demo-lead", "POST", LEAD_OK],
    ["demo-book", "POST", { lead_id: "x", start: new Date(Date.now() + 864e5).toISOString() }],
    ["demo-booked", "POST", { lead_id: "x" }],
    ["demo-slots", "GET", null],
  ]) {
    const r = await invoke(handler, { method, query: { action }, body });
    assert.equal(r.statusCode, 410, `${action} debería estar cerrada`);
    assert.match(String(r.body?.error || ""), /demo/i);
  }
  // Ni un documento nuevo: ningún lead, ninguna reserva.
  assert.equal(rawPaths().length, antes, "no se escribió nada en Firestore");
  assert.equal(rawPaths().filter((p) => p.startsWith("demo_leads/")).length, 0);
});

test("(d) el cron de recordatorios no lee ni manda nada", async () => {
  const { default: cron } = await loadApi("api/cron.js");
  const antes = rawPaths().length;
  const r = await new Promise((resolve) => {
    const res = { _s: 200, status(c) { this._s = c; return this; }, setHeader() {}, json(o) { resolve({ status: this._s, body: o }); } };
    cron({ method: "GET", headers: { authorization: "Bearer cs_test" }, query: { action: "demo-reminders" } }, res);
  });
  assert.equal(r.status, 200);
  assert.equal(r.body?.retired, true, "debería decir que está retirado");
  assert.equal(rawPaths().length, antes, "no tocó Firestore");
});
