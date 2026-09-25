// Widget en Tiendanube vs Shopify: corre el JS servido por api/widget.js en un sandbox
// (node:vm) con un window/document falsos. Correr: node tests/tiendanube/widget.test.mjs
import { register } from "node:module";
import vm from "node:vm";
register("./hooks.mjs", import.meta.url);
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";

const ROOT = new URL("../../", import.meta.url).href;
const { db } = await import(ROOT + "api/_lib/firebase.js");
const handler = (await import(ROOT + "api/widget.js")).default;
const get = (query) => new Promise(r => handler({ query }, { setHeader() {}, status() { return this; }, json: o => r(JSON.stringify(o)), send: t => r(String(t)) }));
let fails = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fails++; };

const script = await get({ merchant: "m1" });
try { new Function(script); ok(true, "el JS servido compila"); } catch (e) { ok(false, "syntax: " + e.message); }

// Corre el widget con un window falso; devuelve las URLs que pidió (fetchPlan).
function run(win) {
  const fetched = [];
  const doc = {
    readyState: "complete", cookie: "",
    querySelector: (s) => (win.__q ? win.__q(s) : null),
    querySelectorAll: () => [],
    getElementById: (id) => (id === "recurrentes-mount" ? { appendChild() {} } : null),
    body: { classList: { add() {}, remove() {}, toggle() {} } }, head: { appendChild() {} },
    createElement: () => ({ style: {}, dataset: {}, setAttribute() {}, appendChild() {}, querySelector() { return null; }, addEventListener() {} }),
    addEventListener() {},
  };
  Object.assign(win, {
    window: win, document: doc, console: { log() {}, warn() {}, error() {} },
    URL, JSON, parseInt, String, encodeURIComponent, setTimeout,
    MutationObserver: class { observe() {} takeRecords() {} }, CustomEvent: class {},
    fetch: (u) => { fetched.push(String(u)); return Promise.resolve({ json: () => Promise.resolve({ plan: null }) }); },
  });
  vm.runInNewContext(script, win);
  return fetched;
}

// Tiendanube: LS.product + LS.variants (JSON string), sin Shopify en la página.
const tnForm = { querySelector: () => null, querySelectorAll: () => [], parentNode: { insertBefore() {} }, style: {}, dataset: {} };
const f1 = run({
  LS: { store: { id: 9001 }, product: { id: 11 }, variants: JSON.stringify([{ id: 555, option0: "Molido" }]) },
  location: { pathname: "/productos/cafe-1kg/", href: "https://cafedelsur.com.ar/productos/cafe-1kg/", origin: "https://cafedelsur.com.ar" },
  __q: (s) => (s.includes("js-product-form") ? tnForm : null),
});
ok(f1.length === 2 && f1.some(u => /action=plan&merchant=m1&product=11&variant=555/.test(u)) && f1.some(u => /view=bundle&v=2&product=11&variant=555/.test(u)), "Tiendanube: detecta producto 11 y variante 555 (plan + bundle en paralelo) → " + (f1.join(" | ") || "sin fetch"));

// Tiendanube con varias variantes: la elegida en los selects variation[N].
const multiForm = { ...tnForm, querySelectorAll: (s) => (s.includes("variation") ? [{ value: "En grano" }] : []) };
const f1b = run({
  LS: { store: { id: 9001 }, product: { id: 11 }, variants: [{ id: 555, option0: "Molido" }, { id: 556, option0: "En grano" }] },
  location: { pathname: "/productos/cafe-1kg/", href: "https://x/productos/cafe-1kg/", origin: "https://x" },
  __q: (s) => (s.includes("js-product-form") ? multiForm : null),
});
ok(f1b.length >= 1 && f1b.some(u => /action=plan.*product=11&variant=556/.test(u)), "Tiendanube: variante elegida en el select (556) → " + f1b.join(" | "));

// Tiendanube fuera de la página de producto → no carga.
const f2 = run({ LS: { store: { id: 9001 } }, location: { pathname: "/", href: "https://x/", origin: "https://x" } });
ok(f2.length === 0, "Tiendanube fuera de producto: no pide plan");

// Shopify (aunque haya un LS suelto): detección de siempre.
const shForm = { querySelector: (q) => (q.includes('name="id"') ? { value: "7" } : null), parentNode: { insertBefore() {} }, style: {}, dataset: {} };
const f3 = run({
  Shopify: {}, ShopifyAnalytics: { meta: { product: { id: 99, variants: [{ id: 7 }] }, page: { pageType: "product" } } },
  LS: { store: {}, product: { id: 11 } },
  location: { pathname: "/products/x", href: "https://s.myshopify.com/products/x", origin: "https://s.myshopify.com" },
  __q: (s) => (s.includes("/cart/add") ? shForm : null),
});
ok(f3.length === 2 && f3.every(u => /product=99&variant=7/.test(u)), "Shopify sin cambios: producto 99 y variante 7 del form (plan + bundle) → " + (f3.join(" | ") || "sin fetch"));

// ?tn_store=<id> → merchant conectado a esa tienda.
await db().collection("merchants").doc("m_tn").set({ tiendanube_store_id: "9001", tiendanube_token: "tok" });
ok((await get({ tn_store: "9001" })).includes('var MERCHANT_ID = "m_tn"'), "?tn_store=9001 → widget del merchant m_tn");
ok(/Falta merchant/.test(await get({ tn_store: "abc" })), "tn_store inválido → mismo error de siempre");

console.log(fails ? `\n${fails} FALLARON` : "\nwidget OK");
process.exit(fails ? 1 : 0);
