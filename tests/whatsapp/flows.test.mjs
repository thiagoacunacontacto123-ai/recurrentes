// Test del motor de flujos de punta a punta con Firestore en memoria y Resend falso.
import { register } from "node:module";
register("./hooks.mjs", import.meta.url);

process.env.APP_BASE_URL = "https://recurrentess.vercel.app";
process.env.RESEND_API_KEY = "re_test";
process.env.EMAIL_FROM = "Recurrentes <hola@recurrentes.app>";
const sent = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes("resend")) { sent.push(JSON.parse(opts.body)); return new Response(JSON.stringify({ id: "em_" + sent.length }), { status: 200 }); }
  throw new Error("fetch inesperado " + url);
};

const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const { db, __reads } = await import(`${R}/api/_lib/firebase.js`);
const flows = await import(`${R}/api/_lib/flows.js`);
const { flowsApi } = await import(`${R}/api/_lib/flowsApi.js`);
const { setUnsubscribed } = await import(`${R}/api/_lib/unsub.js`);
const { defaultFlow } = await import(`${R}/shared/platform/flows.js`);

let fails = 0;
const ok = (c, msg) => { console.log((c ? "✓ " : "✗ ") + msg); if (!c) fails++; };
const call = (action, body, ctx = { merchantId: "m1", uid: "m1", email: "dueno@tienda.com" }) => new Promise((resolve) => {
  const res = { _s: 200, status(c) { this._s = c; return this; }, json(o) { resolve({ status: this._s, ...o }); } };
  flowsApi(ctx, action, { body, query: {} }, res);
});
const M = db().collection("merchants").doc("m1");
await M.set({ email: "dueno@tienda.com", store_name: "LuminaLabs", widget_color: "#10b981", shopify_shop: "lumina.myshopify.com", store_domain: "www.lumina.com" });
const sub = (id, d) => M.collection("subscribers").doc(id).set(d);
const mdoc = async () => (await M.get()).data();
const runs = async () => (await M.collection("flow_runs").get()).docs.map(d => ({ id: d.id, ...d.data() }));
const pastAll = async () => { for (const r of await runs()) if (r.next_at) await M.collection("flow_runs").doc(r.id).update({ next_at: "2000-01-01T00:00:00.000Z" }); };

// 1) Sin flujos activos: el enganche no lee nada (camino del cobro intacto).
{ const m = await mdoc(); const r0 = __reads(); await flows.emitFlowEvent("m1", m, "activated", "sX", { customer_email: "a@x.com" }, { key: "p1" }); ok(__reads() === r0, "sin flujos activos: emitFlowEvent no hace ninguna lectura"); }

// 2) Crear flujos + índice
const c1 = await call("flow-save", { flow: { ...defaultFlow("checkout_started"), active: true } });
const c2 = await call("flow-save", { flow: { ...defaultFlow("payment_failed"), active: true } });
const c3 = await call("flow-save", { flow: { ...defaultFlow("upcoming_charge"), active: true, days_before: 3 } });
ok(c1.ok && c2.ok && c3.ok, "crea 3 flujos");
let m = await mdoc();
ok(JSON.stringify([...m.flows_active_triggers].sort()) === JSON.stringify(["checkout_started", "payment_failed", "upcoming_charge"]) && m.flows_enabled === true, "índice de disparadores activos en el merchant");
const bad = await call("flow-save", { flow: { trigger: "checkout_started", steps: [{ type: "wait", amount: 1, unit: "days" }] } });
ok(bad.status === 400, `rechaza un flujo sin mails ("${bad.error}")`);
const list = await call("flows", {});
ok(list.flows?.length === 3, "lista los flujos");

// 3) Checkout sin pagar → paga → sale como recuperado
await sub("s1", { status: "pending", customer_email: "ana@x.com", customer_name: "Ana Pérez", plan_snapshot: { product_title: "Cápsulas", total_per_charge_ars: 9480 }, recover_path: "/products/capsulas", portal_token: "tok1" });
await flows.emitFlowEvent("m1", m, "checkout_started", "s1", { customer_email: "ana@x.com" }, { key: "s1" });
await flows.emitFlowEvent("m1", m, "checkout_started", "s1", { customer_email: "ana@x.com" }, { key: "s1" });
ok((await runs()).length === 1, "el mismo checkout no entra dos veces");
let out = await flows.runFlowsForMerchant("m1", m);
ok(out.scheduled === 1 && sent.length === 0, "primer paso: espera 1 h, todavía sin mail");
await pastAll(); out = await flows.runFlowsForMerchant("m1", m);
ok(sent.length === 1, "pasada la espera sale el mail 1");
const p = sent[0] || {};
ok(p.subject === "¿Te quedó algo pendiente, Ana?", `asunto con variables ("${p.subject}")`);
ok(String(p.headers?.["List-Unsubscribe"] || "").includes("action=unsub"), "trae List-Unsubscribe (baja en un clic)");
ok(String(p.html || "").includes("https://www.lumina.com/products/capsulas"), "el botón lleva a retomar en la tienda");
ok(String(p.from || "").startsWith("LuminaLabs"), `remitente con la marca ("${p.from}")`);
ok(out.scheduled === 1, "después del mail 1 queda esperando 1 día");
await M.collection("subscribers").doc("s1").update({ status: "active" });
await pastAll(); out = await flows.runFlowsForMerchant("m1", m);
ok(sent.length === 1 && out.exited === 1, "pagó: sale del flujo sin mandar el mail 2");
const f1 = (await M.collection("flows").doc(c1.flow.id).get()).data();
ok(f1.stats.entered === 1 && f1.stats.sent === 1 && f1.stats.converted === 1, `métricas del flujo ${JSON.stringify(f1.stats)}`);

// 4) Baja de mails
await sub("s2", { status: "pending", customer_email: "baja@x.com", customer_name: "Beto", plan_snapshot: { product_title: "Cápsulas" } });
await setUnsubscribed("m1", "baja@x.com");
await flows.emitFlowEvent("m1", m, "checkout_started", "s2", { customer_email: "baja@x.com" });
await flows.runFlowsForMerchant("m1", m); await pastAll(); await flows.runFlowsForMerchant("m1", m);
ok(!sent.some(s => String(s.to).includes("baja@x.com")), "respeta a quien se dio de baja");

// 5) Pago rechazado → tarjeta actualizada
await sub("s3", { status: "payment_failed", customer_email: "caro@x.com", customer_name: "Caro", last_payment_failed_id: "p9", plan_snapshot: { product_title: "Pack" }, portal_token: "t3" });
await flows.emitFlowEvent("m1", m, "payment_failed", "s3", { customer_email: "caro@x.com" }, { key: "p9" });
await flows.runFlowsForMerchant("m1", m); await pastAll();
let before = sent.length; await flows.runFlowsForMerchant("m1", m);
ok(sent.length === before + 1 && String(sent.at(-1).html).includes("/#/portal?token=t3"), "pago rechazado: mail con el link a su portal");
await M.collection("subscribers").doc("s3").update({ status: "active" });
await pastAll(); out = await flows.runFlowsForMerchant("m1", m);
ok(out.exited === 1, "actualizó la tarjeta: sale del flujo");

// 6) Próximo cobro (tick de :00)
const realMin = Date.prototype.getMinutes; Date.prototype.getMinutes = function () { return 0; };
await sub("s4", { status: "active", customer_email: "dani@x.com", customer_name: "Dani", next_charge_at: new Date(Date.now() + 3 * 86400e3).toISOString(), plan_snapshot: { product_title: "Cápsulas", total_per_charge_ars: 9480 } });
before = sent.length; out = await flows.runFlowsForMerchant("m1", m);
ok(out.entered === 1 && sent.length === before + 1, "próximo cobro: entra y sale el aviso");
ok(String(sent.at(-1).subject).startsWith("Tu próximo cobro es el ") && String(sent.at(-1).html).includes("$9.480"), `aviso con fecha y monto ("${sent.at(-1).subject}")`);
out = await flows.runFlowsForMerchant("m1", m);
ok(out.entered === 0, "no vuelve a entrar en el mismo ciclo de cobro");
Date.prototype.getMinutes = realMin;

// 7) Pausar el flujo → las corridas en espera salen
await sub("s5", { status: "pending", customer_email: "eli@x.com", plan_snapshot: {} });
await flows.emitFlowEvent("m1", m, "checkout_started", "s5", { customer_email: "eli@x.com" });
await call("flow-save", { flow: { ...c1.flow, active: false } });
await pastAll(); out = await flows.runFlowsForMerchant("m1", await mdoc());
ok(out.exited >= 1, "flujo pausado: la corrida en espera sale");
ok(!(await mdoc()).flows_active_triggers.includes("checkout_started"), "el flujo pausado sale del índice");

// 8) Mail de prueba
const t = await call("flow-test", { trigger: "payment_failed", step: c2.flow.steps.find(s => s.type === "email") });
ok(t.ok && t.to === "dueno@tienda.com", "la prueba va al mail del login");
ok(String(sent.at(-1).subject).startsWith("[Prueba]") && !sent.at(-1).headers, "la prueba no lleva link de baja");

// 9) Registro
const logs = (await M.collection("email_log").get()).docs.map(d => d.data());
ok(logs.length === 3 && logs.every(l => l.type === "flow" && l.flow_name && l.status === "sent"), `email_log: ${logs.length} mails type "flow" con el nombre del flujo`);

// 10) Borrar
const del = await call("flow-delete", { id: c3.flow.id });
ok(del.ok && !(await mdoc()).flows_active_triggers.includes("upcoming_charge"), "borrar saca el disparador del índice");

console.log(fails ? `\n${fails} FALLA(S)` : "\nTODO OK");
process.exit(fails ? 1 : 0);
