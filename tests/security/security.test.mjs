// Tests de la auditoría de seguridad 2026-09-15. Firestore en memoria, sin red.
//   node tests/security/security.test.mjs
// Cada arreglo tiene su test "el agujero está cerrado" + "el camino normal anda".
import { register } from "node:module";
import crypto from "node:crypto";
register("./hooks.mjs", import.meta.url);

process.env.FIREBASE_PROJECT_ID = "test";
process.env.FIREBASE_CLIENT_EMAIL = "test@test";
process.env.FIREBASE_PRIVATE_KEY = "test";
process.env.APP_BASE_URL = "https://www.recurrentesapp.com";
process.env.PORTAL_SECRET = "portal-test-secret";
delete process.env.RESEND_API_KEY;
delete process.env.VERCEL_ENV;

// fetch: nunca a la red. Cada test registra lo que espera.
let fetchImpl = async (url) => { throw new Error("fetch inesperado " + url); };
globalThis.fetch = (url, opts) => fetchImpl(String(url), opts);
const jsonRes = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

const ROOT = new URL("../../", import.meta.url).href;
const imp = (p) => import(ROOT + p);
const { __store, __failGet } = await import("./mocks/store.mjs");
const { _db } = await import("./mocks/store.mjs");

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log("✓ " + msg); } else { fails++; console.log("✗ " + msg); } };

function call(handler, { method = "GET", query = {}, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      _s: 200, _h: {},
      status(c) { this._s = c; return this; },
      setHeader(k, v) { this._h[k.toLowerCase()] = v; return this; },
      json(o) { resolve({ status: this._s, body: o, headers: this._h }); return this; },
      send(s) { resolve({ status: this._s, body: s, headers: this._h }); return this; },
      end(s) { resolve({ status: this._s, body: s, headers: this._h }); return this; },
      writeHead(c, h) { this._s = c; Object.assign(this._h, h || {}); return this; },
    };
    Promise.resolve(handler({ method, query, headers, body, socket: { remoteAddress: "1.2.3.4" } }, res)).catch(reject);
  });
}
const auth = (uid, mid) => ({ authorization: `Bearer tok:${uid}`, ...(mid ? { "x-merchant-id": mid } : {}) });

// ─── Datos: tienda B (dueño B) con equipo: C (solo "planes"), E (con "flujos" y "portal").
const M = (id) => _db.collection("merchants").doc(id);
await M("A").set({ email: "a@test.com" });
await M("B").set({
  email: "b@test.com", ownerUid: "B", teamUids: ["B", "C", "E"],
  teamMembers: {
    B: { role: "owner", secciones: {} },
    C: { email: "c@test.com", role: "member", secciones: { planes: true } },
    E: { email: "e@test.com", role: "member", secciones: { flujos: true, portal: true } },
  },
  mp_access_token: "APP_USR-SECRET-B", shopify_shop: "b.myshopify.com", shopify_token: "shpat_SECRETB",
});
await M("B").collection("charges").doc("ch1").set({ subscriber_id: "s1", amount_ars: 100, created_at: "2026-09-01T00:00:00.000Z" });
await M("B").collection("subscribers").doc("s1").set({ customer_email: "cli@x.com", customer_name: "Cli", status: "active", plan_snapshot: { frequency_days: 30 } });

// ─── 1) requireMerchant: IDOR por X-Merchant-Id (línea base, ya estaba bien) ────
{
  const charges = (await imp("api/charges.js")).default;
  const r1 = await call(charges, { headers: auth("A", "B") });
  ok(r1.status === 403, "IDOR: A no lee cobros de B con X-Merchant-Id");
  const r1q = await call(charges, { headers: auth("A"), query: { merchant_id: "B" } });
  ok(r1q.status === 403, "IDOR: A no lee cobros de B con ?merchant_id");
  const r2 = await call(charges, { headers: auth("B") });
  ok(r2.status === 200 && r2.body.charges.length === 1, "dueño B lee sus cobros");
  const r3 = await call(charges, { headers: auth("C", "B") });
  ok(r3.status === 403, "miembro sin sección 'cobros' → 403");
  const r4 = await call(charges, { headers: { authorization: "Bearer basura" } });
  ok(r4.status === 401, "token inválido → 401");
}

// ─── 2) Flujos: permiso de equipo "flujos" (antes cualquier miembro los editaba) ─
{
  const merchant = (await imp("api/merchant.js")).default;
  const noSec = await call(merchant, { headers: auth("C", "B"), query: { action: "flows" } });
  ok(noSec.status === 403, "miembro sin 'flujos' no lista flujos");
  const noSave = await call(merchant, { method: "POST", headers: auth("C", "B"), query: { action: "flow-save" }, body: { flow: { name: "x", trigger: "activated", steps: [{ type: "email", subject: "Hola", body: "Hola" }] } } });
  ok(noSave.status === 403, "miembro sin 'flujos' no crea flujos");
  ok((await M("B").collection("flows").get()).size === 0, "…y no se escribió nada");
  const withSec = await call(merchant, { headers: auth("E", "B"), query: { action: "flows" } });
  ok(withSec.status === 200 && Array.isArray(withSec.body.flows), "miembro con 'flujos' lista flujos");
  const owner = await call(merchant, { headers: auth("B"), query: { action: "flows" } });
  ok(owner.status === 200, "dueño lista flujos");
  const outsider = await call(merchant, { headers: auth("A", "B"), query: { action: "flows" } });
  ok(outsider.status === 403, "ajeno no lista flujos de B");
}

// ─── 3) Stats: Registro (mails de clientes) exige sección 'portal' ──────────────
{
  const stats = (await imp("api/stats.js")).default;
  const c = await call(stats, { headers: auth("C", "B"), query: { action: "activity" } });
  ok(c.status === 403, "miembro sin 'portal' no ve el Registro (mails de clientes)");
  const a = await call(stats, { headers: auth("C", "B"), query: { action: "analytics" } });
  ok(a.status === 403, "miembro sin 'analiticas' no ve Analíticas");
  const e = await call(stats, { headers: auth("E", "B"), query: { action: "activity" } });
  ok(e.status === 200 && Array.isArray(e.body.cobros), "miembro con 'portal' ve el Registro");
  const b = await call(stats, { headers: auth("B"), query: { action: "activity" } });
  ok(b.status === 200, "dueño ve el Registro");
}

// ─── 4) Planes: POST crea el plan (antes ReferenceError: merchantProfile) ───────
{
  const plans = (await imp("api/plans.js")).default;
  let mpBody = null;
  fetchImpl = async (url, opts) => {
    if (url === "https://api.mercadopago.com/preapproval_plan") { mpBody = JSON.parse(opts.body); return jsonRes({ id: "pp_1", init_point: "https://mp/x" }); }
    throw new Error("fetch inesperado " + url);
  };
  const r = await call(plans, { method: "POST", headers: auth("B"), body: { shopify_product_id: "1", shopify_variant_id: "2", product_title: "Crema", frequency_days: 30, discount_pct: 10, base_price_ars: 1000 } });
  ok(r.status === 200 && r.body.plan?.mp_preapproval_plan_id === "pp_1", `crear plan responde 200 (status ${r.status}${r.body?.error ? " " + r.body.error : ""})`);
  ok(mpBody?.auto_recurring?.transaction_amount === 900, "monto del plan MP = base − descuento (900)");
  const rc = await call(plans, { method: "POST", headers: auth("A", "B"), body: {} });
  ok(rc.status === 403, "ajeno no crea planes en B");
}

// ─── 5) Envíos públicos: sin detalle interno en el error ────────────────────────
{
  const shopify = (await imp("api/shopify.js")).default;
  fetchImpl = async () => { throw new Error("boom https://b.myshopify.com/admin?token=shpat_SECRETB"); };
  const r = await call(shopify, { query: { action: "shipping-rates", merchant: "B", province: "CABA" } });
  ok(r.status === 200 && Array.isArray(r.body.rates), "shipping-rates responde con rates []");
  ok(!JSON.stringify(r.body).includes("shpat_") && !JSON.stringify(r.body).includes("myshopify.com/admin"), "shipping-rates no filtra el error crudo");
}

// ─── 6) Checkout GET (polling público): error genérico ─────────────────────────
{
  const init = (await imp("api/checkout/init.js")).default;
  const { generatePortalToken } = await imp("api/public.js");
  const tok = generatePortalToken("B", "s1");
  __failGet.add("merchants/B");
  const r = await call(init, { query: { sub: "s1", token: tok } });
  __failGet.clear();
  ok(r.status === 500 && !String(r.body.error).includes("FAILGET"), "sync público no devuelve el error interno");
  const bad = await call(init, { query: { sub: "s1", token: tok + "x" } });
  ok(bad.status === 403, "token de portal adulterado → 403");
  const other = await call(init, { query: { sub: "s2", token: tok } });
  ok(other.status === 403, "token de s1 no sirve para s2");
  // Camino normal (sin token de MP el sync responde status error, pero 200).
  const saved = (await M("B").get()).data();
  await M("B").set({ ...saved, mp_access_token: "" });
  const good = await call(init, { query: { sub: "s1", token: tok } });
  await M("B").set(saved);
  ok(good.status === 200 && good.body.ok === true, "sync público con token válido responde 200");
}

// ─── 7) Checkout POST: tope de largo del email ─────────────────────────────────
{
  const init = (await imp("api/checkout/init.js")).default;
  const long = "a".repeat(250) + "@x.com";
  const r = await call(init, { method: "POST", body: { merchant_id: "ZZ", plan_id: "p", customer: { email: long } } });
  ok(r.status === 400 && /Email/.test(r.body.error), "email de >254 caracteres → 400");
  const n = await call(init, { method: "POST", body: { merchant_id: "ZZ", plan_id: "p", customer: { email: "ok@x.com" } } });
  ok(n.status === 404, "email normal pasa la validación (merchant inexistente → 404)");
}

// ─── 8) Portal: tope de acciones POST por suscripción ──────────────────────────
{
  const pub = (await imp("api/public.js")).default;
  const { generatePortalToken, verifyPortalToken } = await imp("api/public.js");
  const tok = generatePortalToken("B", "s1");
  const body = { shipping_address: { address1: "Calle 123", city: "CABA", province: "CABA", zip: "1000" }, customer_phone: "1122334455" };
  const first = await call(pub, { method: "POST", query: { action: "update-address", token: tok }, body });
  ok(first.status === 200 && first.body.shipping_address?.address1 === "Calle 123", "portal: cambiar dirección anda");
  let last;
  for (let i = 0; i < 29; i++) last = await call(pub, { method: "POST", query: { action: "update-address", token: tok }, body });
  ok(last.status === 200, "portal: 30 acciones en la hora pasan");
  const over = await call(pub, { method: "POST", query: { action: "update-address", token: tok }, body });
  ok(over.status === 429, "portal: la acción 31 en la hora → 429");
  const subPost = await call(pub, { method: "POST", query: { action: "sub", token: tok }, body: { action: "pause" } });
  ok(subPost.status === 429, "portal: pause/cancel comparte el tope");
  const get = await call(pub, { query: { action: "sub", token: tok } });
  ok(get.status === 200 && get.body.sub?.id === "s1", "portal: ver la suscripción (GET) no tiene tope");
  const other = generatePortalToken("B", "s9");
  const ot = await call(pub, { method: "POST", query: { action: "update-address", token: other }, body });
  ok(ot.status === 404, "portal: el tope es por suscripción (otra sub no queda bloqueada)");
  // Tokens de otro tipo no abren el portal.
  const { signToken } = await imp("api/_lib/token.js");
  ok(verifyPortalToken(signToken({ m: "B", e: "cli@x.com" })) === null, "token de baja de mails no sirve como token de portal");
  ok(verifyPortalToken(signToken({ mid: "B", sid: "s1" }, -10)) === null, "token de portal vencido → null");
  const forged = Buffer.from(JSON.stringify({ mid: "B", sid: "s1" })).toString("base64url") + "." + crypto.createHmac("sha256", "otra-clave").update("x").digest("base64url");
  ok(verifyPortalToken(forged) === null, "token firmado con otra clave → null");
}

// ─── 9) webhookguard: firma x-signature + confirmación de disputas ─────────────
{
  const g = await imp("api/_lib/webhookguard.js");
  const secret = "mp-signing-secret";
  const ts = String(Math.floor(Date.now() / 1000));
  const sign = (manifest) => crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  const req = (h) => ({ headers: h });
  const v1 = sign(`id:abc123;request-id:req-1;ts:${ts};`);
  ok(g.checkMpSignature(req({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" }), "ABC123", { secret }).status === "valid", "firma válida (data.id alfanumérico en minúsculas)");
  const v1b = sign(`id:12345;ts:${ts};`);
  ok(g.checkMpSignature(req({ "x-signature": `ts=${ts},v1=${v1b}` }), "12345", { secret }).status === "valid", "firma válida sin x-request-id (parte omitida)");
  ok(g.checkMpSignature(req({ "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": "req-1" }), "999", { secret }).status === "invalid", "firma de otro data.id → invalid");
  ok(g.checkMpSignature(req({}), "1", { secret }).status === "unsigned", "sin header → unsigned");
  ok(g.checkMpSignature(req({ "x-signature": "basura" }), "1", { secret }).status === "malformed", "header roto → malformed");
  ok(g.checkMpSignature(req({}), "1", {}).status === "no_secret", "sin clave → no_secret");
  const old = String(Math.floor(Date.now() / 1000) - 3600);
  const st = g.checkMpSignature(req({ "x-signature": `ts=${old},v1=${sign(`id:1;ts:${old};`)}` }), "1", { secret });
  ok(st.status === "valid" && st.stale === true, "ts viejo: válida pero marcada stale (no se rechaza)");
  ok(g.mpSignatureDecision({ status: "invalid" }, false).reject === false, "modo loguear: firma inválida NO se rechaza");
  ok(g.mpSignatureDecision({ status: "unsigned" }, false).log === "unsigned", "modo loguear: sin firma queda en el log");
  ok(g.mpSignatureDecision({ status: "invalid" }, true).reject === true && g.mpSignatureDecision({ status: "unsigned" }, true).reject === true, "MP_WEBHOOK_ENFORCE=1: inválida o sin firma se rechaza");
  ok(g.mpSignatureDecision({ status: "valid" }, true).reject === false && g.mpSignatureDecision({ status: "no_secret" }, true).reject === false, "enforce: válida o sin clave pasa");
  process.env.MP_WEBHOOK_ENFORCE = "1"; ok(g.mpWebhookEnforced() === true, "MP_WEBHOOK_ENFORCE=1 se lee"); delete process.env.MP_WEBHOOK_ENFORCE;
  ok(g.mpWebhookEnforced() === false, "sin MP_WEBHOOK_ENFORCE: no rechaza");
  // Disputas
  ok(g.disputeConfirmed("fraud", { status: "approved" }) === false, "aviso de fraude falso sobre pago aprobado → NO cancelar");
  ok(g.disputeConfirmed("chargeback", { status: "approved" }) === false, "contracargo falso sobre pago aprobado → NO cancelar");
  ok(g.disputeConfirmed("claim", { status: "approved" }) === false, "reclamo falso sobre pago aprobado → NO pausar");
  ok(g.disputeConfirmed("chargeback", { status: "charged_back" }) === true, "contracargo real → sí");
  ok(g.disputeConfirmed("claim", { status: "in_mediation" }) === true, "reclamo en mediación → sí");
  ok(g.disputeConfirmed("claim", { status: "approved" }, { claimFound: true }) === true, "reclamo encontrado en /v1/claims → sí");
  ok(g.disputeConfirmed("fraud", { status: "rejected", status_detail: "cc_rejected_high_risk" }) === true, "fraude con status_detail de riesgo → sí");
}

console.log(`\n${passes} ok, ${fails} fallas`);
process.exit(fails ? 1 : 0);
