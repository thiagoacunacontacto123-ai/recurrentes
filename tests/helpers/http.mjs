// req/res mínimos con la forma que usan los handlers de Vercel (Node).
export function mockReq({ method = "GET", query = {}, body, headers = {} } = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = v;
  return { method, query, body, headers: h, socket: { remoteAddress: "10.0.0.1" } };
}

export function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    send(s) { this.body = s; this.ended = true; return this; },
    end(s) { if (s !== undefined) this.body = s; this.ended = true; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    getHeader(k) { return this.headers[String(k).toLowerCase()]; },
    redirect(code, url) { if (url === undefined) { url = code; code = 302; } this.statusCode = code; this.headers.location = url; this.ended = true; return this; },
  };
}

/** Ejecuta un handler y devuelve el res (statusCode, headers, body). */
export async function invoke(handler, reqOpts) {
  const req = mockReq(reqOpts);
  const res = mockRes();
  await handler(req, res);
  return res;
}
