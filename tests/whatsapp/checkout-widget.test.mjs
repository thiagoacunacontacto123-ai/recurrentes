// WhatsApp en el checkout y el widget: la casilla "Quiero que me avisen por WhatsApp" solo
// aparece si la tienda tiene WhatsApp prendido; el widget de Lumina (sin WhatsApp) queda
// IDÉNTICO byte a byte; checkout/init guarda whatsapp_optin solo si viene en el body.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { createWorld, loadApi, MID, PLAN_ID, ADDRESS, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget, waOptinSnippets, WA_OPTIN_LABEL } = await loadApi("api/widget.js");
const { default: init } = await loadApi("api/checkout/init.js");
const { default: pub } = await loadApi("api/public.js");

const PLATFORM = { WHATSAPP_PHONE_NUMBER_ID: "700800900100", WHATSAPP_ACCESS_TOKEN: "EAAplatformTOKEN1234567890abcdefXYZ" };
const setPlatformEnv = (on) => { for (const [k, v] of Object.entries(PLATFORM)) { if (on) process.env[k] = v; else delete process.env[k]; } };

let W;
beforeEach(() => { W = createWorld(); setPlatformEnv(false); });
afterEach(() => { setPlatformEnv(false); W.router.assertClean(); });

const get = async (query) => (await invoke(widget, { method: "GET", query })).body;
// El on-store sin legacy=1 es solo un redirect al checkout alojado (sin casilla ni formulario).
const views = { product: { merchant: MID }, checkout: { merchant: MID, view: "checkout", legacy: "1" } };
const strip = (js, parts) => parts.reduce((s, p) => s.split(p).join(""), js);

test("widget de Lumina: sin WhatsApp prendido el JS no cambia (aunque el número de Recurrentes esté configurado)", async () => {
  for (const [name, q] of Object.entries(views)) {
    const base = await get(q);
    assert.ok(!/wa-optin|whatsapp_optin/.test(base), `${name}: Lumina no tiene la casilla`);
    setPlatformEnv(true);
    const withEnv = await get(q);
    seedDoc(`merchants/${MID}`, luminaMerchant({ whatsapp_platform_enabled: false }));
    const explicitOff = await get(q);
    setPlatformEnv(false);
    assert.equal(withEnv, base, `${name}: las env del número de Recurrentes no cambian el JS de Lumina`);
    assert.equal(explicitOff, base, `${name}: whatsapp_platform_enabled=false no cambia el JS`);
    seedDoc(`merchants/${MID}`, luminaMerchant());
  }
  assert.equal(W.router.calls.length, 0, "servir el widget no llama a ninguna API externa");
});

test("widget con WhatsApp prendido: suma SOLO la casilla (sacándola, el JS es el de siempre)", async () => {
  const base = { product: await get(views.product), checkout: await get(views.checkout) };
  setPlatformEnv(true);
  seedDoc(`merchants/${MID}`, luminaMerchant({ whatsapp_platform_enabled: true }));
  const snips = waOptinSnippets(luminaMerchant().widget_color);
  for (const name of ["product", "checkout"]) {
    const js = await get(views[name]);
    assert.ok(js.includes(WA_OPTIN_LABEL), `${name}: muestra la casilla`);
    assert.ok(js.includes("whatsapp_optin:"), `${name}: manda whatsapp_optin a checkout/init`);
    assert.ok(snips[name].every(s => js.includes(s)), `${name}: los fragmentos insertados están tal cual`);
    assert.equal(strip(js, snips[name]), base[name], `${name}: fuera de la casilla, idéntico`);
    new vm.Script(js, { filename: `widget-${name}.js` });
  }
  // Prendido pero sin el número de Recurrentes configurado: nada cambia.
  setPlatformEnv(false);
  assert.equal(await get(views.checkout), base.checkout);
});

test("checkout hosteado: public?action=plan&checkout=1 dice si mostrar la casilla", async () => {
  const q = { action: "plan", merchant: MID, plan: PLAN_ID, checkout: "1" };
  const off = await invoke(pub, { method: "GET", query: q });
  assert.equal(off.statusCode, 200);
  assert.equal(off.body.checkout.whatsapp_optin, false, "Lumina: sin casilla");
  setPlatformEnv(true);
  seedDoc(`merchants/${MID}`, luminaMerchant({ whatsapp_platform_enabled: true }));
  const on = await invoke(pub, { method: "GET", query: q });
  assert.equal(on.body.checkout.whatsapp_optin, true, "con WhatsApp prendido: casilla");
  const noCheckout = await invoke(pub, { method: "GET", query: { action: "plan", merchant: MID, plan: PLAN_ID } });
  assert.equal(noCheckout.body.checkout, undefined, "el widget de producto (sin checkout=1) no cambia");
});

const body = (over = {}) => ({
  merchant_id: MID, plan_id: PLAN_ID, quantity: 1,
  customer: { email: "dani@cliente.test", name: "Dani Gómez", phone: "1144440000", tax_id: "20301234567" },
  shipping_address: { ...ADDRESS },
  ...over,
});
const post = (b) => invoke(init, { method: "POST", query: {}, body: b, headers: { "x-forwarded-for": "190.1.2.3" } });

test("checkout/init guarda whatsapp_optin (true / false) solo si viene en el body", async () => {
  const yes = await post(body({ whatsapp_optin: true }));
  assert.equal(yes.statusCode, 200, JSON.stringify(yes.body));
  const sYes = W.sub(yes.body.subscriber_id);
  assert.equal(sYes.whatsapp_optin, true);
  assert.ok(sYes.whatsapp_optin_at);

  const no = await post(body({ whatsapp_optin: false, customer: { email: "otro@cliente.test", name: "Otro Cliente", phone: "1155550000", tax_id: "20301234568" } }));
  assert.equal(no.statusCode, 200, JSON.stringify(no.body));
  assert.equal(W.sub(no.body.subscriber_id).whatsapp_optin, false);

  const none = await post(body({ customer: { email: "tercero@cliente.test", name: "Tercer Cliente", phone: "1166660000", tax_id: "20301234569" } }));
  assert.equal(none.statusCode, 200, JSON.stringify(none.body));
  const sNone = W.sub(none.body.subscriber_id);
  assert.ok(!("whatsapp_optin" in sNone) && !("whatsapp_optin_at" in sNone), "widget de Lumina (sin el campo): el doc queda igual que antes");
});
