// Checkout adentro de la tienda (27-sept-2026, Thiago: "que quede 100% dentro
// de la misma web del cliente").
//
// La página del comercio mete el checkout REAL en un iframe. Es un solo
// checkout que mantener: lo que mejoremos mañana ya está ahí. Lo que esto
// protege:
//   1. El script se sirve y arma el iframe apuntando a NUESTRO checkout, con el
//      merchant puesto por nosotros (no depende de que lo pegue bien).
//   2. Solo le cree la altura al checkout, no a cualquiera que postee al padre.
//   3. Embebido se ve EXACTAMENTE igual que en nuestro dominio: el encabezado
//      y el pie del checkout van también (la página del comercio no agrega nada).
import "../helpers/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, luminaMerchant, capsulasPlan } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc } from "../helpers/fake-firestore.mjs";

const { default: widget } = await loadApi("api/widget.js");

beforeEach(() => { createWorld(); seedDoc(`merchants/${MID}`, luminaMerchant()); });

const embed = () => invoke(widget, { method: "GET", query: { merchant: MID, view: "embed" } });

test("el script COMPILA (una comilla mal y la página del comercio se rompe entera)", async () => {
  // Pasó de verdad: el mensaje de error llevaba comillas sin escapar y el
  // navegador tiraba "missing ) after argument list" — el checkout no se
  // montaba y el comercio no tenía idea de por qué (27-sept-2026).
  const js = (await embed()).body;
  assert.doesNotThrow(() => new Function(js), "el script servido tiene que parsear");
});

test("sirve el script que arma el iframe con el checkout real", async () => {
  const r = await embed();
  assert.equal(r.statusCode, 200);
  assert.match(String(r.headers["content-type"]), /javascript/);
  const js = r.body;
  assert.match(js, /recurrentes-checkout/, "busca el div que pegó el comerciante");
  assert.match(js, /\/#\/checkout\?/, "apunta al checkout de verdad, no a una copia");
  assert.match(js, /q\.set\("merchant", MERCHANT\)/, "el merchant lo ponemos nosotros");
  assert.match(js, /q\.set\("embed", "1"\)/, "y le avisa al checkout que va embebido");
  assert.match(js, new RegExp(`var MERCHANT = "${MID}"`));
});

test("el alto solo se lo cree al checkout, no a cualquiera", async () => {
  // La página del comercio puede tener otros scripts, y cualquiera puede
  // postearle al padre. Sin el chequeo de origen, uno podría estirar o aplastar
  // el checkout a gusto.
  const js = (await embed()).body;
  assert.match(js, /e\.origin !== BASE/, "chequea de dónde vino el mensaje");
  assert.match(js, /rec-checkout-height/);
  assert.match(js, /h > 200 && h < 20000/, "y que el alto tenga sentido");
});

test("no tapa la página: el iframe no trae scroll propio", async () => {
  const js = (await embed()).body;
  assert.match(js, /scrolling = "no"/);
  assert.match(js, /width:100%/);
  assert.ok(!/height:\s*100vh/.test(js), "no fuerza el alto de la pantalla");
});

test("el iframe arranca en blanco, no en negro", async () => {
  // El fondo de la app es oscuro; sin esto, mientras carga (y abajo del
  // checkout) quedaba una franja negra adentro de la página del comercio.
  const js = (await embed()).body;
  assert.match(js, /background:#fff/);
});

test("se cachea en la CDN: es el mismo script para toda la tienda", async () => {
  const r = await embed();
  assert.match(String(r.headers["cache-control"]), /s-maxage=300/);
});

test("sin el div, avisa en la consola y no rompe la página del comercio", async () => {
  const js = (await embed()).body;
  assert.match(js, /console\.error\(/);
  assert.match(js, /if \(!host\)[\s\S]{0,140}return;/, "sale sin tocar nada más");
});

// ── A dónde manda el botón "Suscribirme" ───────────────────────────────────
// Sin página propia sigue yendo al checkout de Recurrentes (lo de siempre, y
// nadie tiene la página todavía). Con página propia, al dominio de la tienda.
test("sin página propia, el botón sigue yendo al checkout de Recurrentes", async () => {
  seedDoc(`merchants/${MID}/plans/plan_1`, capsulasPlan());
  const js = (await invoke(widget, { method: "GET", query: { merchant: MID } })).body;
  assert.match(js, /var CHECKOUT_ON_STORE = false/);
  assert.match(js, /return API_BASE \+ "\/#\/checkout\?" \+ qs/);
});

test("con página propia, el botón va a la página de la tienda", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant({ widget_checkout_page_path: "pages/checkout-suscripcion" }));
  seedDoc(`merchants/${MID}/plans/plan_1`, capsulasPlan());
  const js = (await invoke(widget, { method: "GET", query: { merchant: MID } })).body;
  assert.match(js, /var CHECKOUT_ON_STORE = true/);
  assert.match(js, /var CHECKOUT_PAGE_PATH = "\/pages\/checkout-suscripcion"/, "le pone la barra de adelante");
  // Y no queda ningún destino al dominio nuestro salteando el helper.
  assert.ok(!/location\.href = API_BASE \+ "\/#\/checkout/.test(js), "todos los destinos pasan por ckUrl");
});

test("mientras carga, el cargando es del color de la tienda", async () => {
  // Antes se veía un hueco en blanco entre el bundle y el checkout y parecía
  // que el botón no había hecho nada (27-sept-2026, Thiago).
  const js = (await embed()).body;
  assert.match(js, /Abriendo el checkout seguro/);
  assert.match(js, /rc-go 1\.1s linear infinite/, "el logo gira, como en el resto");
  assert.ok(!/stop-color="#10b981"/.test(js), "no sale el verde nuestro: usa el de la tienda");
  // El iframe se pinta siempre: uno que nace escondido puede quedar en blanco.
  assert.match(js, /f\.style\.cssText = "width:100%;border:0;display:block/);
  assert.match(js, /position:absolute;inset:0;background:#fff/, "el cargando va ENCIMA del iframe");
  assert.match(js, /setTimeout\(mostrar, 8000\)/, "y si el checkout nunca avisa, se muestra igual");
});

test("salir a Mercado Pago rompe el marco: no se carga adentro del iframe", async () => {
  // MP responde con X-Frame-Options: adentro del iframe el comprador veía la
  // hoja rota de Chrome con el carrito ya hecho (27-sept-2026, Wellfresh).
  const js = (await embed()).body;
  assert.match(js, /rec-checkout-redirect/);
  assert.match(js, /if \(BASE && e\.origin !== BASE\) return;[\s\S]{0,200}rec-checkout-redirect|rec-checkout-redirect[\s\S]{0,200}e\.origin !== BASE/,
    "solo le hacemos caso al checkout");
  assert.match(js, /u\.indexOf\("https:\/\/"\) !== 0/, "y solo a una URL https");
});

test("en el navegador de Instagram / Facebook no arma el iframe: manda directo al checkout de Recurrentes", async () => {
  const r = await embed();
  const js = r.body;
  assert.match(js, /Instagram\|FBAN\|FBAV\|FB_IAB\|Messenger/, "detecta el in-app por user agent");
  // El salto va ANTES de crear el iframe y sin embed=1 (es el checkout entero, no el marco).
  const salto = js.indexOf("window.location.replace(BASE");
  const iframe = js.indexOf("createElement(\"iframe\")");
  const embedFlag = js.indexOf("q.set(\"embed\", \"1\")");
  assert.ok(salto > 0 && iframe > 0 && salto < iframe, "el salto está antes del iframe");
  assert.ok(embedFlag > salto, "embed=1 se pone después del salto: el in-app no lo lleva");
});
