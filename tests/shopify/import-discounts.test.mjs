// Importar códigos de descuento de la tienda (api/_lib/discountImport.js,
// POST /api/merchant?action=import-discounts). Firestore en memoria + fetch falso.
import { register } from "node:module";
register("../providers/hooks.mjs", import.meta.url);

const R = new URL("../../", import.meta.url).pathname;
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.TIENDANUBE_CONTACT_EMAIL = "hola@recurrentesapp.com";

const calls = [];
let shopifyMode = "ok"; // ok | denied
let tnStatus = 200;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const page1 = { codeDiscountNodes: { pageInfo: { hasNextPage: true, endCursor: "c1" }, nodes: [
  { codeDiscount: { __typename: "DiscountCodeBasic", title: "Bienvenida", status: "ACTIVE", codes: { nodes: [{ code: "bienvenida10" }] }, customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.1 } } } },
  { codeDiscount: { __typename: "DiscountCodeBasic", title: "Fijo", status: "ACTIVE", codes: { nodes: [{ code: "MENOS1500" }, { code: "MENOS1500B" }] }, customerGets: { value: { __typename: "DiscountAmount", amount: { amount: "1500.0", currencyCode: "ARS" } } } } },
  { codeDiscount: { __typename: "DiscountCodeBxgy", title: "2x1", codes: { nodes: [{ code: "DOSXUNO" }] } } },
] } };
const page2 = { codeDiscountNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [
  { codeDiscount: { __typename: "DiscountCodeFreeShipping", title: "Envío", codes: { nodes: [{ code: "ENVIOGRATIS" }] } } },
  { codeDiscount: { __typename: "DiscountCodeBasic", title: "Por cantidad", status: "ACTIVE", codes: { nodes: [{ code: "PACK" }] }, customerGets: { value: { __typename: "DiscountOnQuantity" } } } },
  { codeDiscount: { __typename: "DiscountCodeBasic", title: "Ya cargado", status: "ACTIVE", codes: { nodes: [{ code: "VIEJO" }] }, customerGets: { value: { __typename: "DiscountPercentage", percentage: 0.5 } } } },
] } };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, method: opts.method || "GET", body: opts.body || "" });
  if (u.includes("/admin/api/") && u.endsWith("/graphql.json")) {
    if (shopifyMode === "denied") return json({ errors: [{ message: "Access denied for codeDiscountNodes field. Required access: `read_discounts` access scope." }] });
    const vars = JSON.parse(opts.body).variables || {};
    return json({ data: vars.after === "c1" ? page2 : page1 });
  }
  if (u.startsWith("https://api.tiendanube.com/") && u.includes("/coupons?")) {
    if (tnStatus !== 200) return json({ code: tnStatus, message: "Forbidden", description: "Missing scope read_coupons" }, tnStatus);
    return json([
      { id: 1, code: "verano20", type: "percentage", value: "20.00", valid: true, end_date: null },
      { id: 2, code: "MENOS500", type: "absolute", value: "500.00", valid: true, end_date: "2099-01-01" },
      { id: 3, code: "ENVIO", type: "shipping", value: "0", valid: true },
      { id: 4, code: "VENCIDO", type: "percentage", value: "15.00", valid: true, end_date: "2020-01-01" },
      { id: 5, code: "AGOTADO", type: "percentage", value: "15.00", valid: true, max_uses: 3, used: 3 },
    ]);
  }
  throw new Error("fetch inesperado " + u);
};

const { db } = await import(`${R}api/_lib/firebase.js`);
const lib = await import(`${R}api/_lib/discountImport.js`);
const shared = await import(`${R}shared/platform/shopify.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const M = (id) => db().collection("merchants").doc(id);
const run = (mid) => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); } };
  lib.importDiscountsAction(mid, { body: {}, query: { action: "import-discounts" } }, res);
});

// ── Permisos compartidos ──
ok(shared.SHOPIFY_SCOPE_IDS.includes("read_discounts") && !shared.SHOPIFY_REQUIRED_SCOPE_IDS.includes("read_discounts"), "read_discounts va en el OAuth y en la lista a pegar, pero NO es obligatorio");
ok(shared.missingShopifyScopes("read_products,read_orders,write_orders,write_customers,read_shipping,write_draft_orders").length === 0, "una tienda vieja sin read_discounts no ve el aviso de permisos");
ok(JSON.stringify(shared.missingShopifyScopes("read_products", ["read_discounts"])) === JSON.stringify(["read_discounts"]), "pero el import sí lo detecta como faltante");

// ── Mapeos puros ──
{
  const { codes, skipped } = lib.shopifyDiscountsToCodes([...page1.codeDiscountNodes.nodes, ...page2.codeDiscountNodes.nodes]);
  ok(codes.length === 4 && codes[0].code === "bienvenida10" && codes[0].type === "percent" && codes[0].value === 10, "Shopify: 10 % (percentage 0.1 → 10)");
  ok(codes[1].type === "fixed" && codes[1].value === 1500 && codes[2].code === "MENOS1500B", "Shopify: $ fijo y un descuento con 2 códigos = 2 filas");
  ok(skipped.length === 3 && skipped.map(s => s.reason).join("|") === "promo tipo 2x1|envío gratis|descuento por cantidad", "Shopify: 2x1, envío gratis y por cantidad se omiten con motivo");
  const tn = lib.tiendanubeCouponsToCodes([
    { code: "verano20", type: "percentage", value: "20.00", valid: true },
    { code: "MENOS500", type: "absolute", value: "500.00", valid: true, end_date: "2099-01-01" },
    { code: "ENVIO", type: "shipping", value: "0" },
    { code: "VENCIDO", type: "percentage", value: "15.00", valid: true, end_date: "2020-01-01" },
    { code: "AGOTADO", type: "percentage", value: "15.00", valid: true, max_uses: 3, used: 3 },
  ], "2026-09-18");
  ok(tn.codes.length === 4 && tn.codes[0].type === "percent" && tn.codes[0].value === 20 && tn.codes[1].type === "fixed" && tn.codes[1].value === 500, "Tiendanube: percentage → %, absolute → $ fijo");
  ok(tn.skipped.length === 1 && tn.skipped[0].code === "ENVIO", "Tiendanube: cupón de envío se omite");
  ok(tn.codes[2].active === false && tn.codes[3].active === false, "Tiendanube: vencido y agotado entran apagados");
}
{
  const existing = [{ code: "viejo", type: "percent", value: 5, active: true, recovery_only: true, first_charge_only: true }];
  const r = lib.mergeDiscountCodes(existing, [{ code: "VIEJO", type: "percent", value: 50 }, { code: "nuevo", type: "fixed", value: 100 }]);
  ok(r.imported === 1 && r.already === 1 && r.codes.length === 2, "merge: el que ya estaba cuenta como 'ya estaba', el nuevo se suma");
  ok(r.codes[0].value === 5 && r.codes[0].recovery_only === true && r.codes[0].first_charge_only === true, "merge: NO pisa el valor ni las casillas del código existente");
  ok(r.codes[1].code === "NUEVO" && r.codes[1].recovery_only === false && r.codes[1].first_charge_only === false && r.codes[1].active === true, "merge: el nuevo entra en MAYÚSCULAS con las casillas de '+ Agregar'");
  const many = Array.from({ length: 105 }, (_, i) => ({ code: "C" + i, type: "percent", value: 1 }));
  const r2 = lib.mergeDiscountCodes([], many);
  ok(r2.codes.length === 100 && r2.imported === 100 && r2.dropped === 5, "merge: tope de 100 códigos, el resto se informa como sin lugar");
}

// ── Acción completa: Shopify ──
await M("s1").set({ shopify_shop: "demo.myshopify.com", shopify_token: "tok", shopify_scope: "read_products,write_orders", discount_codes: [] });
await M("s2").set({ shopify_shop: "demo.myshopify.com", shopify_token: "tok", shopify_scope: "read_products,write_orders,read_discounts", discount_codes: [{ code: "VIEJO", type: "percent", value: 5, active: true }] });
await M("nada").set({ store_name: "Sin tienda" });
{
  const r = await run("nada");
  ok(r.status === 400 && r.code === "no_store", "sin tienda conectada → 400 no_store");
  const before = calls.length;
  const r1 = await run("s1");
  ok(r1.status === 403 && r1.code === "scope_missing" && /read_discounts/.test(r1.error) && calls.length === before, "Shopify sin read_discounts → 403 scope_missing sin llamar a Shopify");
  const r2 = await run("s2");
  ok(r2.status === 200 && r2.imported === 3 && r2.already === 1 && r2.found === 4 && r2.skipped.length === 3, "Shopify con permiso: 3 nuevos, 1 ya estaba, 3 omitidos (2 páginas)");
  const d = (await M("s2").get()).data();
  ok(d.discount_codes.length === 4 && d.discount_codes[0].code === "VIEJO" && d.discount_codes[0].value === 5 && d.discount_codes_source === "shopify" && d.discount_codes_imported_at, "queda guardado con el origen y sin tocar el código viejo");
  const at = d.discount_codes_imported_at;
  const r3 = await run("s2");
  ok(r3.status === 200 && r3.imported === 0 && r3.already === 4, "segunda corrida: nada nuevo, todos 'ya estaban'");
  ok((await M("s2").get()).data().discount_codes_imported_at === at, "sin novedades no se reescribe el merchant");
  shopifyMode = "denied";
  const r4 = await run("s2");
  ok(r4.status === 403 && r4.code === "scope_missing", "Shopify responde Access denied → 403 scope_missing");
  shopifyMode = "ok";
}

// ── Acción completa: Tiendanube ──
await M("t1").set({ tiendanube_store_id: 123, tiendanube_token: "tn_tok", tiendanube_scope: "read_products,write_orders,read_coupons" });
await M("t2").set({ tiendanube_store_id: 124, tiendanube_token: "tn_tok", tiendanube_scope: "read_products,write_orders" });
{
  const r = await run("t1");
  ok(r.status === 200 && r.source === "tiendanube" && r.imported === 4 && r.skipped.length === 1, "Tiendanube: 4 cupones (2 apagados) y 1 omitido");
  const d = (await M("t1").get()).data();
  ok(d.discount_codes.find(c => c.code === "VERANO20")?.active === true && d.discount_codes.find(c => c.code === "VENCIDO")?.active === false, "Tiendanube: el vigente entra prendido y el vencido apagado");
  const before = calls.length;
  const r2 = await run("t2");
  ok(r2.status === 403 && r2.code === "scope_missing" && calls.length === before, "Tiendanube sin read_coupons en el scope → 403 sin llamar");
  tnStatus = 403;
  await M("t1").set({ tiendanube_scope: null }, { merge: true });
  const r3 = await run("t1");
  ok(r3.status === 403 && r3.code === "scope_missing", "Tiendanube responde 403 → scope_missing");
  tnStatus = 200;
}
ok(!calls.some(c => c.url.includes("tok") ), "el token nunca viaja en la URL");

console.log(fails ? `\n${fails} fallas` : "\nTodo OK");
if (fails) process.exit(1);
