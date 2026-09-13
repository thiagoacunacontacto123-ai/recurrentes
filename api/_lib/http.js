// fetch con timeout. Vercel corta la función a los N segundos; sin timeout un
// fetch colgado a MP/Shopify deja el proceso muerto a mitad de una orden.
export async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error(`timeout ${ms}ms: ${url}`)), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Reintento con backoff para 429/5xx. `fn` debe devolver un Response.
export async function fetchRetry(url, opts = {}, { ms = 8000, retries = 2 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetchWithTimeout(url, opts, ms);
      if (r.status !== 429 && r.status < 500) return r;
      last = r;
      const ra = parseFloat(r.headers.get("retry-after") || "0");
      const wait = Math.min(4000, ra > 0 ? ra * 1000 : 400 * Math.pow(2, i));
      await new Promise((res) => setTimeout(res, wait));
    } catch (e) {
      last = e;
      if (i === retries) throw e;
      await new Promise((res) => setTimeout(res, 300 * Math.pow(2, i)));
    }
  }
  if (last instanceof Response) return last;
  throw last;
}
