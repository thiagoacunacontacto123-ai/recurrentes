// Que el "La tienda tiene un problema con Mercado Pago" casi no exista, y que
// cuando exista nos enteremos nosotros antes que un cliente (5-oct-2026, Thiago).
//
// El caso real: el 5-oct a las 14:40 MP rechazó los tres intentos del plan con
// `invalid_field_content` y un comprador de Lumina se comió el cartel rojo.
// CINCUENTA SEGUNDOS después el MISMO pedido salió bien. Era transitorio y no
// había nada que reintentara, ni nadie a quien avisarle.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, PLAN_ID, ADDRESS, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet, rawList } from "../helpers/fake-firestore.mjs";

const { default: init } = await loadApi("api/checkout/init.js");
const { mpReasonAscii, isMpContentError } = await loadApi("api/_lib/mp.js");

const CONTENIDO = { status: 400, json: { message: "Request contains invalid or disallowed content", code: "invalid_field_content", status: 400 } };
const PLAN_RE = /^\/preapproval_plan$/;

let W;
beforeEach(() => {
  W = createWorld();
  seedDoc(`merchants/${MID}`, luminaMerchant());
  seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, capsulasPlan());
});
afterEach(() => { W.router.assertClean(); });

const post = () => invoke(init, {
  method: "POST", query: {}, headers: { "x-forwarded-for": "190.1.2.3" },
  body: {
    merchant_id: MID, plan_id: PLAN_ID, quantity: 1,
    customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "30111222" },
    shipping_address: { ...ADDRESS },
  },
});

// ── 1. Lo transitorio se arregla solo ──────────────────────────────────────
test("(a) MP falla la cascada entera y a los segundos anda: el comprador NO ve nada", async () => {
  W.router.failNext("POST", "api.mercadopago.com", PLAN_RE, CONTENIDO, 3);   // la cascada completa
  const r = await post();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.init_point, "se suscribe igual");
  assert.equal(rawGet(`merchants/${MID}`).mp_plan_rescued_by, "reintento");
});

// ── 2. El filtro de contenido de MP ────────────────────────────────────────
test("(b) si MP se queja del contenido, el reason va en ASCII y entra", async () => {
  W.router.failNext("POST", "api.mercadopago.com", PLAN_RE, CONTENIDO, 6);   // cascada + reintento
  const r = await post();
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(rawGet(`merchants/${MID}`).mp_plan_rescued_by, "reason_ascii");
  const reason = W.mp.plansCreated.at(-1).body.reason;
  assert.ok(!/[×—…á]/.test(reason), `quedó algo raro: ${reason}`);
  assert.match(reason, /cada 30 dias/, "sigue diciendo que es recurrente");
});

test("(c) el helper de ASCII no rompe el sentido del texto", () => {
  assert.equal(mpReasonAscii("Cápsulas LuminaLabs × 1 — cada 30 días"), "Capsulas LuminaLabs x 1 - cada 30 dias");
  assert.ok(isMpContentError({ status: 400, message: "HTTP 400 invalid_field_content" }));
  assert.ok(!isMpContentError({ status: 400, message: "Reason has more than 60 characters" }), "un 400 por largo NO es contenido");
  assert.ok(!isMpContentError({ status: 401, message: "invalid_field_content" }), "un 401 es el token, no el contenido");
});

// ── 3. Cuando ya no hay nada que hacer ─────────────────────────────────────
test("(d) MP caído de verdad: 502 limpio, el sub en error y el aviso al admin", async () => {
  process.env.ADMIN_EMAILS = "thiago@recurrentes.test";
  W.router.failNext("POST", "api.mercadopago.com", PLAN_RE, CONTENIDO, 50);
  const r = await post();
  assert.equal(r.statusCode, 502);
  assert.doesNotMatch(r.body.error, /invalid_field_content/, "al comprador no le mostramos el error crudo de MP");

  const [sub] = rawList(`merchants/${MID}/subscribers`);
  assert.equal(sub.data.status, "error");
  assert.ok(rawGet(`merchants/${MID}`).mp_last_error, "queda para verlo en el panel");

  // El aviso: queda anotado en el log de avisos del admin.
  const log = rawList("system/admin_alerts/log");
  const mio = log.map(x => x.data).find(x => x.event === "mp_plan_error");
  assert.ok(mio, "tiene que haber salido el aviso: no nos podemos enterar por un cliente");
  assert.equal(mio.merchant_id, MID);
  delete process.env.ADMIN_EMAILS;
});

test("(e) una tienda rota no manda 200 avisos: uno por hora", async () => {
  process.env.ADMIN_EMAILS = "thiago@recurrentes.test";
  for (let i = 0; i < 3; i++) {
    W.router.failNext("POST", "api.mercadopago.com", PLAN_RE, CONTENIDO, 50);
    const r = await post();
    assert.equal(r.statusCode, 502);
  }
  const avisos = rawList("system/admin_alerts/log").map(x => x.data).filter(x => x.event === "mp_plan_error");
  assert.equal(avisos.length, 1, `salieron ${avisos.length} avisos por la misma tienda en la misma hora`);
  delete process.env.ADMIN_EMAILS;
});

// ── 4. Lo que NO puede cambiar ─────────────────────────────────────────────
test("(f) cuando MP anda bien es UNA sola llamada: el rescate no cuesta nada", async () => {
  const r = await post();
  assert.equal(r.statusCode, 200);
  assert.equal(W.mp.plansCreated.length, 1, "ni una llamada de más en el camino feliz");
  assert.equal(rawGet(`merchants/${MID}`).mp_plan_rescued_by, undefined, "no hubo nada que rescatar");
  assert.match(W.mp.plansCreated[0].body.reason, /Cápsulas/, "con MP sano el texto queda lindo, con acentos");
});
