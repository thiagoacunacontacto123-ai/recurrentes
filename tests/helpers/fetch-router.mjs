// Router de fetch para los tests: reemplaza globalThis.fetch, registra CADA
// llamada (método, URL, headers, body parseado) y responde con los stubs.
//
// Hosts permitidos (el resto falla como un error de red y queda en `unexpected`):
//   · api.mercadopago.com
//   · <tienda>.myshopify.com/admin/api/…
//   · api.resend.com
// Una llamada a un host permitido SIN stub devuelve 404 y también queda en
// `unexpected`. Los tests terminan con `router.assertClean()`.
import assert from "node:assert/strict";

const ALLOWED = [
  (u) => u.hostname === "api.mercadopago.com",
  (u) => /\.myshopify\.com$/.test(u.hostname) && u.pathname.startsWith("/admin/api/"),
  (u) => u.hostname === "api.resend.com",
  (u) => u.hostname === "api.tiendanube.com",
  (u) => u.hostname === "graph.facebook.com",
];

function headersToObject(h) {
  const out = {};
  if (!h) return out;
  if (typeof h.forEach === "function" && !Array.isArray(h)) { h.forEach((v, k) => { out[String(k).toLowerCase()] = v; }); return out; }
  for (const [k, v] of Array.isArray(h) ? h : Object.entries(h)) out[String(k).toLowerCase()] = v;
  return out;
}

function toResponse(out = {}) {
  const status = out.status ?? 200;
  const headers = { "content-type": "application/json", ...(out.headers || {}) };
  const body = out.text !== undefined ? out.text : JSON.stringify(out.json ?? {});
  return new Response(status === 204 ? null : body, { status, headers });
}

export function createFetchRouter() {
  const routes = [];
  const failures = [];
  const calls = [];
  const unexpected = [];

  const matchOf = (r, url, method) => {
    if (r.method !== "*" && r.method !== method) return null;
    if (typeof r.host === "string" ? url.hostname !== r.host : !r.host.test(url.hostname)) return null;
    return url.pathname.match(r.path);
  };

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input?.url || String(input));
    const method = String(init.method || "GET").toUpperCase();
    const bodyText = init.body == null ? null : String(init.body);
    let json;
    try { json = bodyText ? JSON.parse(bodyText) : undefined; } catch { json = undefined; }
    const call = {
      method, url: url.href, host: url.hostname, path: url.pathname,
      query: Object.fromEntries(url.searchParams), headers: headersToObject(init.headers), body: bodyText, json,
    };
    calls.push(call);
    if (!ALLOWED.some(fn => fn(url))) {
      unexpected.push({ ...call, reason: "host no permitido en tests" });
      throw new TypeError(`fetch failed (test): host no permitido ${url.hostname}`);
    }
    for (const f of failures) {
      if (f.times <= 0) continue;
      const m = matchOf(f, url, method);
      if (m) { f.times--; call.injectedFailure = true; return toResponse(typeof f.out === "function" ? f.out(call, m) : f.out); }
    }
    for (const r of routes) {
      const m = matchOf(r, url, method);
      if (!m) continue;
      const out = await r.handler(call, m);
      call.status = out?.status ?? 200;
      return toResponse(out);
    }
    unexpected.push({ ...call, reason: "sin stub" });
    return toResponse({ status: 404, json: { message: `sin stub en tests: ${method} ${url.pathname}`, error: "not_found", status: 404 } });
  }

  const router = {
    calls,
    unexpected,
    /** Registra un stub. host: string exacto o RegExp; path: RegExp sobre pathname. */
    on(method, host, path, handler) { routes.push({ method, host, path, handler }); return router; },
    /** Las próximas `times` llamadas que matcheen responden `out` ({status, json}) antes que los stubs. */
    failNext(method, host, path, out, times = 1) { failures.push({ method, host, path, out, times }); return router; },
    install() { globalThis.fetch = fetchImpl; return router; },
    reset() { calls.length = 0; unexpected.length = 0; failures.length = 0; return router; },
    /** Llamadas filtradas: host (string|RegExp), método y path (RegExp). */
    find({ host, method, path } = {}) {
      return calls.filter(c => (!method || c.method === method)
        && (!host || (typeof host === "string" ? c.host === host : host.test(c.host)))
        && (!path || path.test(c.path)));
    },
    assertClean() {
      assert.deepEqual(unexpected.map(c => `${c.method} ${c.url} (${c.reason})`), [], "hubo fetch inesperados");
    },
  };
  return router;
}
