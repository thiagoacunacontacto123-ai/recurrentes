// De qué anuncio vino cada cuenta nueva (Meta Ads de Recurrentes, 19-sept-2026).
//
// La landing guarda UNA vez (primer toque) los utm_* y el fbclid del link, más la
// página de entrada y el referrer, en localStorage. Al registrarse, save-owner los manda
// al servidor (merchants/{uid}.acquisition) junto con las cookies _fbp/_fbc del pixel, y
// con eso el backend reporta los 4 pasos a Meta por servidor y el Admin arma la tabla
// "registros → conectaron → plan → pagan" por anuncio.
const KEY = "rec_utm";
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid"];
const cut = (s, n = 200) => String(s || "").slice(0, n);

function cookie(name) {
  try {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return m ? decodeURIComponent(m[1]) : null;
  } catch (_) { return null; }
}

// Llamar al cargar el sitio público. Primer toque gana: si ya había una atribución
// guardada con UTM, no se pisa (así el anuncio que trajo a la persona no se pierde
// aunque después entre por Google).
export function captureAttribution() {
  try {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const hashQs = new URLSearchParams((window.location.hash.split("?")[1] || ""));
    const get = (k) => url.searchParams.get(k) || hashQs.get(k);
    const found = {};
    for (const k of UTM) { const v = get(k); if (v) found[k] = cut(v); }
    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
    const hasUtm = Object.keys(found).length > 0;
    if (prev && (prev.utm_source || prev.utm_campaign || prev.fbclid)) return; // ya hay un anuncio de origen
    if (!hasUtm && prev) return;                                                // ya hay un origen orgánico guardado
    const ref = cut(document.referrer || "");
    const ownRef = ref && ref.includes(window.location.host);
    if (!hasUtm && !ref) return; // entrada directa sin nada que anotar
    localStorage.setItem(KEY, JSON.stringify({
      ...found,
      landing: cut(url.pathname + (url.search || "") + (url.hash || "")),
      referrer: ownRef ? "" : ref,
      at: new Date().toISOString(),
    }));
  } catch (_) {}
}

// Lo que se manda al servidor con save-owner: lo guardado + las cookies del pixel.
export function readAttribution() {
  let a = null;
  try { a = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {}
  const fbp = cookie("_fbp"), fbc = cookie("_fbc");
  const out = { ...(a || {}) };
  delete out.at;
  if (fbp) out.fbp = fbp;
  if (fbc) out.fbc = fbc;
  return Object.keys(out).length ? out : null;
}

export function clearAttribution() { try { localStorage.removeItem(KEY); } catch (_) {} }

// ── Pixel de Meta en el sitio (PageView por navegación + eventos con event_id) ──
// Se prende solo con VITE_META_PIXEL_ID. El evento de registro se manda también desde
// acá con el MISMO event_id que el servidor (acq_registered_<uid>) → Meta deduplica y
// se queda con la mejor versión (la del navegador tiene la cookie, la nuestra el mail).
export const PIXEL_ID = String(import.meta.env?.VITE_META_PIXEL_ID || "").trim();
let pixelReady = false;
export function initPixel() {
  if (!PIXEL_ID || pixelReady || typeof window === "undefined") return;
  pixelReady = true;
  try {
    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", PIXEL_ID);
    window.fbq("track", "PageView");
  } catch (_) {}
}
export function pixelPageView() {
  try { if (pixelReady && window.fbq) window.fbq("track", "PageView"); } catch (_) {}
}
export function pixelTrack(eventName, params = {}, eventId = null) {
  try { if (pixelReady && window.fbq) window.fbq("track", eventName, params, eventId ? { eventID: eventId } : undefined); } catch (_) {}
}
