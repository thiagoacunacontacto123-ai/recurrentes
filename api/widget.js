// GET /widget.js?merchant=<uid>
//
// Sirve el JS embebible que el comerciante pega en su theme Shopify.
// Auto-detecta el producto + variante actual, busca el plan, pinta toggle
// Compra única / Suscripción y maneja el flow de checkout MP.
//
// Comportamiento al activar Suscripción:
//   - OCULTA el form completo de compra (selectores de variante/cantidad,
//     botón Add to cart, todo lo que esté dentro del <form action="/cart/add">)
//   - Muestra el botón "Suscribirme" con el precio + frecuencia del plan.
//   - Al volver a Compra única, restaura todo.
//
// El widget detecta cambios de variante en vivo (cuando el cliente cambia
// Pequeña → Grande): refresca el plan asociado y actualiza precio del botón.

// Packs (bundle): si el plan tiene `pricing_mode: "packs"` el widget renderiza
// el selector de packs (shared/bundle/) en vez del toggle de dos cards. El
// plan se conoce recién en el navegador (lo trae fetchPlan), así que el HTML
// de TODOS los estados (modos × packs) se precalcula server-side en
// `?view=bundle&plan=<id>` y el cliente sólo swapea innerHTML.
import { buildBundleVM, planHasPacks, resolvePack, freqLabel, fmtARS } from "../shared/bundle/viewmodel.js";
import { resolveCheckoutTheme } from "../shared/platform/checkoutTheme.js";
import { renderBundle } from "../shared/bundle/templates.js";

// Tarifas de envío del checkout on-store para merchants LEGACY (creados antes
// del corte multi-tienda) que no configuraron `checkout_shipping_rates`: son las
// históricas de Lumina. checkout/init usa la MISMA resolución server-side.
export const DEFAULT_CHECKOUT_SHIPPING_RATES = [
  { name: "Envío a domicilio (Andreani / Flex) — Estándar", price: 0, eta: "3 a 6 días hábiles", code: "" },
  { name: "Envío a Domicilio por Andreani / Flex DESPACHO PRIORITARIO 🚚", price: 5900, eta: "1 a 5 días hábiles", code: "" },
];
// Merchants creados desde esta fecha NO heredan las tarifas de Lumina.
export const LEGACY_SHIPPING_CUTOFF = "2026-09-13";
// Código de la tarifa sintética "envío del plan" (shipping_price_ars +
// free_shipping_from_ars del plan). El embed la manda con este code cuando el
// merchant no tiene lista de tarifas; init.js la resuelve con el envío del plan.
export const PLAN_SHIPPING_CODE = "PLAN";

function merchantCreatedAtIso(m) {
  const v = m?.created_at;
  if (typeof v === "string") return v;
  try { return v?.toDate ? v.toDate().toISOString() : ""; } catch (_) { return ""; }
}
// Legacy = sin created_at (docs viejos) o creado antes del corte.
export function isLegacyMerchant(m) {
  const iso = merchantCreatedAtIso(m);
  return !iso || iso < LEGACY_SHIPPING_CUTOFF;
}
// Lista de tarifas efectiva del merchant:
//   1) checkout_shipping_rates configuradas (saneadas) si hay alguna;
//   2) legacy sin tarifas → DEFAULT_CHECKOUT_SHIPPING_RATES (Lumina);
//   3) merchant nuevo sin tarifas → [] (el checkout usa el envío del plan, code PLAN).
export function resolveCheckoutShippingRates(m) {
  const raw = Array.isArray(m?.checkout_shipping_rates) ? m.checkout_shipping_rates : [];
  const list = raw
    .filter(r => r && typeof r.name === "string" && r.name.trim())
    .map(r => ({ name: r.name.trim().slice(0, 250), price: Math.max(0, Math.round(Number(r.price) || 0)), eta: String(r.eta || "").slice(0, 80), code: String(r.code || "").slice(0, 250) }));
  if (list.length) return list;
  return isLegacyMerchant(m) ? DEFAULT_CHECKOUT_SHIPPING_RATES : [];
}

// Precalcula el selector de packs para TODOS los estados (modo × pack, máx 2×6).
// El navegador no renderiza: sólo swapea `states[mode + ":" + idx]`.
export function buildBundlePayload(plan, merchant) {
  const vm = buildBundleVM({ plan, merchant });
  const states = {};
  let css = "";
  for (const mode of ["once", "sub"]) {
    for (const p of vm.packs) {
      const r = renderBundle(vm, { mode, selectedIdx: p.idx });
      states[mode + ":" + p.idx] = r.html;
      css = r.css; // el CSS no depende del estado
    }
  }
  return {
    css,
    states,
    variant: vm.variant,
    modeDefault: vm.modeDefault,
    defaultIdx: vm.defaultIdx,
    packs: vm.packs.map((p) => ({ idx: p.idx, qty: p.qty, freq_days: p.freqDays })),
  };
}

// Tiendanube: id de tienda → merchant conectado (el más reciente con token). "" si no hay.
async function merchantIdForTiendanubeStore(storeId) {
  if (!/^\d{1,15}$/.test(storeId)) return "";
  try {
    const { db } = await import("./_lib/firebase.js");
    const q = await db().collection("merchants").where("tiendanube_store_id", "==", storeId).limit(5).get();
    const withToken = q.docs.filter(d => d.data().tiendanube_token);
    return (withToken[0] || q.docs[0])?.id || "";
  } catch (_) { return ""; }
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300, stale-while-revalidate=600"); // s-maxage: la CDN de Vercel lo sirve sin ejecutar la función
  res.setHeader("Access-Control-Allow-Origin", "*");

  let merchantId = String(req.query.merchant || "");
  // Tiendanube: el loader (public/tiendanube-loader.js) puede mandar solo el id de la tienda.
  if (!merchantId && req.query.tn_store) merchantId = await merchantIdForTiendanubeStore(String(req.query.tn_store));
  const apiBase = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
  // Selector(es) CSS extra a ocultar en modo suscripción — para tiendas con un
  // buy box CUSTOM (bundles/quantity-breaks propios) que el widget no reconoce
  // solo. El merchant lo pasa en el <script src> con &hide=<selector> (varios
  // separados por coma). Fallback: setting widget_hide_selector del merchant.
  let hideSelector = String(req.query.hide || "");

  if (!merchantId) {
    return res.send(`console.error("[Recurrentes] Falta merchant en el <script src>. Usá ?merchant=<uid>");`);
  }

  // Leemos los settings UX del merchant para embeberlos en el JS servido. Si
  // el doc no existe o falta config, defaults sensatos.
  let widgetModeOrder = "sub_first";
  let widgetModeDefault = "sub";
  let widgetColor = "#10b981";
  let checkoutColor = "#10b981"; // acento del checkout (tema propio o el del widget): loader y &color= en la URL
  let widgetSubTitle = "Suscripción";
  let widgetSubSubtitle = ""; // "" → usa default con frecuencia
  let widgetOnceTitle = "Compra única";
  let widgetOnceSubtitle = "Comprá una vez al precio normal.";
  let widgetDisclaimerText = ""; // "" → usa default
  // "redirect" (antes "page") = el botón lleva a un checkout propio (contacto/
  // dirección/envíos de Shopify) antes de MP. "inline" = form dentro del widget
  // (comportamiento viejo). Un `widget_checkout_flow: "page"` guardado se trata
  // como "redirect" (solo "inline" cambia el flujo).
  let checkoutFlow = "redirect";
  // Path de la PÁGINA de checkout on-store que el merchant creó en Shopify (con el
  // embed pegado). El botón del producto redirige ahí, en el dominio de la tienda.
  let checkoutPagePath = "/pages/suscripcion-form";
  // Tarifas de envío del checkout (editables por el merchant). Sólo name/price/eta/code.
  // [] = sin lista → el embed ofrece el envío del plan (code PLAN).
  let checkoutShippingRates = [];
  let liveShippingQuotes = false; // true con tienda conectada: cotiza con el proveedor de envíos de la tienda
  // Doc crudo del merchant (widget_variant, widget_texts, etc. los lee buildBundleVM).
  let merchantDoc = null;
  let sellBlocked = false;   // pasó el límite del plan gratis sin pagar
  try {
    const { db } = await import("./_lib/firebase.js");
    const snap = await db().collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const m = snap.data();
      merchantDoc = m;
      // Límite del plan gratis: con más de 15 suscriptores activos y sin plan al
      // día, el widget NO se pinta (la página queda como estaba antes). Usamos el
      // contador cacheado en el doc (billing_cache) para no contar en cada vista
      // de producto; lo refresca el panel y el cron. Si no hay cache, no bloquea:
      // nunca apagamos la venta de nadie por una duda nuestra.
      try {
        const { enforcementOf } = await import("./_lib/plans_saas.js");
        const cached = Number(m?.billing_cache?.subs);
        if (Number.isFinite(cached)) sellBlocked = !enforcementOf(m, cached).sell;
      } catch (e) { console.warn("[widget] enforcement:", e.message); }
      if (m.widget_mode_order === "once_first") widgetModeOrder = "once_first";
      if (m.widget_mode_default === "once") widgetModeDefault = "once";
      if (typeof m.widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.widget_color)) widgetColor = m.widget_color;
      checkoutColor = resolveCheckoutTheme(m.checkout_theme, { widgetColor }).color;
      if (typeof m.widget_sub_title === "string" && m.widget_sub_title.trim()) widgetSubTitle = m.widget_sub_title.trim();
      if (typeof m.widget_sub_subtitle === "string") widgetSubSubtitle = m.widget_sub_subtitle;
      if (typeof m.widget_once_title === "string" && m.widget_once_title.trim()) widgetOnceTitle = m.widget_once_title.trim();
      if (typeof m.widget_once_subtitle === "string" && m.widget_once_subtitle.trim()) widgetOnceSubtitle = m.widget_once_subtitle.trim();
      if (typeof m.widget_disclaimer_text === "string") widgetDisclaimerText = m.widget_disclaimer_text;
      if (!hideSelector && typeof m.widget_hide_selector === "string") hideSelector = m.widget_hide_selector;
      // widget_checkout_flow "inline" ya no existe (16-sept): un solo checkout, el de Recurrentes.
      if (typeof m.widget_checkout_page_path === "string" && m.widget_checkout_page_path.trim()) checkoutPagePath = m.widget_checkout_page_path.trim();
      checkoutShippingRates = resolveCheckoutShippingRates(m);
      liveShippingQuotes = true; // siempre en vivo, sin interruptor: cada venta igual a una venta común
    }
  } catch (_) {}
  // WhatsApp: casilla "Quiero que me avisen por WhatsApp" SOLO si la tienda tiene quién mande
  // (número propio o número de Recurrentes prendido). Sin esos campos (Lumina) no se importa
  // nada y el JS servido queda idéntico byte a byte.
  let waOptin = false;
  if (merchantDoc && (merchantDoc.whatsapp_platform_enabled === true || merchantDoc.whatsapp_phone_number_id)) {
    try { const { waSender } = await import("./_lib/whatsapp.js"); waOptin = Boolean(waSender(merchantDoc)); } catch (_) {}
  }

  // ─── Calcular paleta derivada del color del merchant (server-side) ─────
  // Reemplazan los verdes hardcodeados originales del widget. Así se ve
  // consistente para cualquier color base que elija el merchant.
  function shade(hex, pct) {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + pct));
    const g = Math.max(0, Math.min(255, ((n >>  8) & 255) + pct));
    const b = Math.max(0, Math.min(255, (n & 255) + pct));
    return `rgb(${r}, ${g}, ${b})`;
  }
  function alphaColor(hex, a) {
    const n = parseInt(hex.replace("#", ""), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  if (checkoutColor === "#10b981" && widgetColor !== "#10b981") checkoutColor = widgetColor;
  const COL = widgetColor;

  // ?view=bundle&plan=<planId> → JSON con el selector de packs PRECALCULADO:
  //   { bundle: { css, states: { "sub:0": html, "once:0": html, ... }, variant,
  //               modeDefault, defaultIdx, packs: [{ idx, qty }] } }
  // El widget del producto lo pide después de fetchPlan cuando el plan es de
  // packs; el navegador no renderiza nada, sólo swapea el HTML del estado.
  // `bundle: null` si el plan no existe / no está activo / no tiene packs.
  // Límite del plan gratis pasado sin pagar: el widget no se pinta y la página de
  // producto queda EXACTA a como estaba antes de instalarnos (no escondemos el
  // botón del tema, no tocamos nada). Las suscripciones que ya cobran siguen
  // cobrando: esto solo corta las ventas nuevas.
  if (sellBlocked) {
    if (String(req.query.view || "") === "bundle") {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
      return res.json({ bundle: null, blocked: true });
    }
    // Cache corta: al activar el plan el widget tiene que volver enseguida.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
    return res.send(`console.warn("[Recurrentes] Suscripciones en pausa: activá tu plan en https://www.recurrentesapp.com para volver a recibir suscripciones.");`);
  }

  if (String(req.query.view || "") === "bundle") {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
    const planId = String(req.query.plan || "").trim().slice(0, 80);
    if (!planId || !/^[A-Za-z0-9_-]+$/.test(planId)) return res.status(400).json({ error: "Falta plan" });
    try {
      const { db } = await import("./_lib/firebase.js");
      const ds = await db().collection("merchants").doc(merchantId).collection("plans").doc(planId).get();
      if (!ds.exists || ds.data().active === false) return res.json({ bundle: null });
      const plan = { id: ds.id, ...ds.data() };
      if (!planHasPacks(plan)) return res.json({ bundle: null });
      return res.json({ bundle: buildBundlePayload(plan, merchantDoc || {}) });
    } catch (e) {
      console.error("[widget/bundle] error:", e.message);
      return res.status(500).json({ error: "No se pudo armar el selector de packs" });
    }
  }

  // ?view=checkout → sirve el CHECKOUT ON-STORE (página de Shopify del merchant),
  // en vez del widget del producto. Corre en el dominio de la tienda, así puede
  // pedir los envíos REALES por CP a Shopify (/cart/shipping_rates.json) y va a MP.
  if (String(req.query.view || "") === "checkout") {
    // Cache corta para el checkout: así un deploy nuevo (ej. cambios de captura de
    // carrito) se propaga en ≤60s a la storefront, en vez de quedar 5 min viejo.
    res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60, stale-while-revalidate=120");
    // Un solo checkout (16-sept): la página on-store ya no muestra el formulario;
    // manda al checkout de Recurrentes con los mismos parámetros (merchant, product,
    // variant, qty, freq_days, base, sub_off, code…). Cubre a Lumina (su tema arma la
    // URL a /pages/suscripcion-form) y a cualquier página vieja con el embed pegado.
    // ?legacy=1 sirve el embed viejo, por si hay que compararlo.
    if (String(req.query.legacy || "") !== "1") {
      return res.send(`(function(){
  var base = ${JSON.stringify(apiBase)};
  var url;
  try {
    var q = new URLSearchParams(window.location.search);
    if (!q.get("merchant")) q.set("merchant", ${JSON.stringify(merchantId)});
    if (!q.get("color")) q.set("color", ${JSON.stringify(checkoutColor)});
    url = base + "/#/checkout?" + q.toString();
  } catch (e) { url = base + "/#/checkout?merchant=" + ${JSON.stringify(encodeURIComponent(merchantId))}; }
  // Tapa la página del comercio al instante (mismo color y logo que el checkout).
  try {
    var o = document.createElement("div");
    o.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;background:#0c1512;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;font-family:'Inter',system-ui,sans-serif");
    o.innerHTML = '<svg width="52" height="52" viewBox="0 0 32 32" style="display:block;animation:rc-go 1.1s linear infinite"><defs><linearGradient id="rcGoG" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${shade(checkoutColor, 35)}"/><stop offset="100%" stop-color="${shade(checkoutColor, -25)}"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="url(#rcGoG)"/><path d="M22.5 13.2A7.2 7.2 0 1 0 23.2 18" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M22.9 8.6v5.1h-5.1" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
      '<div style="font-size:13px;font-weight:600;color:#8fb3a7">Abriendo el checkout seguro…</div>' +
      '<style>@keyframes rc-go{to{transform:rotate(360deg)}}</style>';
    (document.body || document.documentElement).appendChild(o);
  } catch (e) {}
  window.location.replace(url);
})();`);
    }
    return res.send(buildCheckoutEmbed({ merchantId, apiBase, color: widgetColor, shippingRates: checkoutShippingRates, waOptin, liveQuotes: liveShippingQuotes }));
  }

  const COL_DARK = shade(widgetColor, -35);           // gradient end (botones)
  const COL_TEXT_DARK = shade(widgetColor, -70);      // títulos sobre fondo claro
  const COL_TEXT_MEDIUM = shade(widgetColor, -50);    // textos secundarios
  const COL_BG_VERY_LIGHT = alphaColor(widgetColor, 0.06); // bg muy clarito
  const COL_BG_LIGHT = alphaColor(widgetColor, 0.14);      // bg de la card seleccionada
  const COL_BORDER = alphaColor(widgetColor, 0.42);        // bordes light

  const script = `(function(){
  "use strict";
  var MERCHANT_ID = ${JSON.stringify(merchantId)};
  var API_BASE = ${JSON.stringify(apiBase)};
  // Aviso "el widget cargó en la tienda" (1 vez por sesión del visitante). Con esto
  // el panel verifica solo la instalación (Paso 2 después de conectar Shopify).
  try {
    var seenKey = "rec_seen_" + MERCHANT_ID;
    var lastSeen = parseInt(sessionStorage.getItem(seenKey) || "0", 10) || 0;
    if (Date.now() - lastSeen > 2 * 60 * 1000) {
      sessionStorage.setItem(seenKey, String(Date.now()));
      new Image().src = API_BASE + "/api/public?action=widget-seen&merchant=" + encodeURIComponent(MERCHANT_ID) + "&host=" + encodeURIComponent(location.hostname) + "&_=" + Date.now();
    }
  } catch (e) {}
  // Verificación en vivo (panel → "Activar en mi tienda"): además de "cargó", avisamos si
  // el widget quedó VISIBLE 3 s seguidos en la página de producto, o por qué no se montó
  // (sin formulario de compra, sin producto, oculto por otra app, sacado por el tema).
  // Con ?rec_verify=1 en la URL (la abre el panel) el aviso sale siempre; si no, 1 vez
  // cada 2 min por producto y estado, para no llenar de escrituras.
  var VERIFY = false;
  try { VERIFY = location.search.indexOf("rec_verify=1") !== -1; } catch (e) {}
  function report(state, extra) {
    try {
      var key = "rec_rep_" + MERCHANT_ID + "_" + state + "_" + ((extra && extra.product) || "");
      var last = parseInt(sessionStorage.getItem(key) || "0", 10) || 0;
      if (!VERIFY && Date.now() - last < 2 * 60 * 1000) return;
      sessionStorage.setItem(key, String(Date.now()));
      var q = "&rendered=" + (state === "ok" ? "1" : "0") + (state === "ok" ? "" : "&reason=" + encodeURIComponent(state)) + (VERIFY ? "&v=1" : "");
      var keys = ["product", "plan", "ms", "mode", "hid"];
      for (var i = 0; i < keys.length; i++) if (extra && extra[keys[i]] != null) q += "&" + keys[i] + "=" + encodeURIComponent(String(extra[keys[i]]));
      q += "&path=" + encodeURIComponent(location.pathname.slice(0, 200));
      new Image().src = API_BASE + "/api/public?action=widget-seen&merchant=" + encodeURIComponent(MERCHANT_ID) + "&host=" + encodeURIComponent(location.hostname) + q + "&_=" + Date.now();
    } catch (e) {}
  }
  // Mira el widget ya montado: 3 s seguidos con tamaño en la página → "ok"; si en 10 s
  // nunca aparece → "hidden" (otra app o el CSS del tema lo dejó sin tamaño); si el tema
  // lo saca del DOM → "removed".
  function watchVisible(el, extra) {
    var visibleMs = 0, elapsed = 0, step = 500;
    var t = setInterval(function () {
      elapsed += step;
      var vis = false;
      try {
        if (!document.body.contains(el)) { clearInterval(t); restoreTheme("removed"); report("removed", extra); return; }
        var r = el.getBoundingClientRect();
        vis = r.width > 20 && r.height > 20 && el.offsetParent !== null;
      } catch (e) {}
      visibleMs = vis ? visibleMs + step : 0;
      if (visibleMs >= 3000) {
        clearInterval(t); extra.ms = visibleMs;
        try {
          var subOn = document.body.classList.contains("rec-bundle-active") || document.body.classList.contains("rec-sub-active");
          var conflict = subOn ? foreignConflict(document.querySelector('form[action*="/cart/add"]') || (typeof tnProductForm === "function" ? tnProductForm() : null)) : [];
          if (conflict.length) {
            extra.hid = (conflict[0].className || conflict[0].tagName || "").toString().slice(0, 80);
            restoreTheme("bundle_conflict"); report("bundle_conflict", extra); return;
          }
        } catch (e) {}
        report("ok", extra); return;
      }
      if (elapsed >= 10000) { clearInterval(t); restoreTheme("hidden"); report("hidden", extra); }
    }, step);
  }
  // ─── Red de seguridad (Thiago, 18-sept): NUNCA dejar la tienda en el limbo ───
  // Si algo nuestro falla después de esconder el botón de compra del tema (error de
  // JS, plan que no carga, widget sin tamaño o sacado por el tema), volvemos todo a
  // como estaba y escondemos lo nuestro: el cliente siempre tiene el "Agregar al
  // carrito" nativo. Nunca lanza.
  function restoreTheme(reason) {
    try {
      document.querySelectorAll("[data-rec-prev-display]").forEach(function (el) { el.style.display = el.dataset.recPrevDisplay || ""; delete el.dataset.recPrevDisplay; });
      var st = document.getElementById("rc-bundle-hide-style"); if (st && st.parentNode) st.parentNode.removeChild(st);
      document.body.classList.remove("rec-bundle-active"); document.body.classList.remove("rec-sub-active");
      document.querySelectorAll("[data-rec-root]").forEach(function (el) { el.style.display = "none"; });
      document.querySelectorAll(".recurrentes-bloque").forEach(function (el) { el.style.display = ""; });
      log("Tema restaurado: " + reason);
    } catch (e) {}
  }
  function guarded(fn, where) {
    return function () {
      try { return fn.apply(this, arguments); }
      catch (e) { log("Error en " + where + ":", e && e.message); restoreTheme(where); report("error", { reason_detail: where }); }
    };
  }
  // Atribución de Meta: cookies _fbp/_fbc (o fbclid) y la URL del producto viajan al
  // checkout de Recurrentes por la URL, así AddToCart / InitiateCheckout / Purchase
  // (API de Conversiones) se atribuyen al anuncio correcto.
  function fbCheckoutQs() {
    try {
      function ck(n){ var m = document.cookie.match(new RegExp("(^|;\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[2]) : ""; }
      var fbp = ck("_fbp"), fbc = ck("_fbc");
      if (!fbc) { var f = new URLSearchParams(window.location.search).get("fbclid"); if (f) fbc = "fb.1." + Date.now() + "." + f; }
      var q = "";
      if (fbp) q += "&fbp=" + encodeURIComponent(fbp);
      if (fbc) q += "&fbc=" + encodeURIComponent(fbc);
      q += "&src=" + encodeURIComponent((location.origin + location.pathname).slice(0, 300));
      q += "&color=" + encodeURIComponent(CHECKOUT_COLOR); // el cargando del checkout sale del color de la tienda desde el primer instante
      return q;
    } catch (e) { return ""; }
  }
  var HIDE_SELECTOR = ${JSON.stringify(hideSelector)};
  var MODE_ORDER = ${JSON.stringify(widgetModeOrder)};
  var MODE_DEFAULT = ${JSON.stringify(widgetModeDefault)};
  var CHECKOUT_FLOW = ${JSON.stringify(checkoutFlow)};
  var CHECKOUT_PAGE_PATH = ${JSON.stringify(checkoutPagePath)};
  var WIDGET_COLOR = ${JSON.stringify(widgetColor)};
  var CHECKOUT_COLOR = ${JSON.stringify(checkoutColor)};
  var SUB_TITLE = ${JSON.stringify(widgetSubTitle)};
  var SUB_SUBTITLE = ${JSON.stringify(widgetSubSubtitle)};
  var ONCE_TITLE = ${JSON.stringify(widgetOnceTitle)};
  var ONCE_SUBTITLE = ${JSON.stringify(widgetOnceSubtitle)};
  var DISCLAIMER_TEXT = ${JSON.stringify(widgetDisclaimerText)};
  var DEBUG = ${process.env.NODE_ENV !== "production" ? "true" : "false"};
  var log = function(){ if (DEBUG) console.log.apply(console, ["[Recurrentes]"].concat([].slice.call(arguments))); };

  // ─── Tiendanube (Nuvemshop) ───────────────────────────────────
  // La tienda expone window.LS (LS.store; en la página de producto LS.product y
  // LS.variants). Solo aplica si NO hay Shopify en la página: en Shopify todo
  // lo de abajo queda apagado y la detección de siempre no cambia.
  // Los temas viejos exponen LS; los nuevos (morelia y compañía) pueden no hacerlo,
  // así que también valen la bandera del loader y el dominio de la tienda.
  var IS_TN = !window.Shopify && !window.ShopifyAnalytics && (
    !!(window.LS && window.LS.store) ||
    window.__RECURRENTES_TN === true ||
    /(^|\\.)(mitiendanube\\.com|nuvemshop\\.com\\.br|tiendanube\\.com)$/.test(window.location.hostname)
  );
  function tnProductId() {
    if (!IS_TN) return null;
    try { if (window.LS && window.LS.product && window.LS.product.id) return String(window.LS.product.id); } catch(e) {}
    // El loader ya resolvió el id (meta / JSON-LD / data-attribute) antes de traernos.
    try { if (window.__RECURRENTES_TN_PRODUCT) return String(window.__RECURRENTES_TN_PRODUCT); } catch(e) {}
    try {
      var m = document.querySelector('meta[property="product:id"], meta[property="og:product_id"]');
      if (m && m.content) return String(m.content);
    } catch(e) {}
    try {
      var nodes = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < nodes.length; i++) {
        var data; try { data = JSON.parse(nodes[i].textContent || "null"); } catch(e) { continue; }
        var list = Array.isArray(data) ? data : (data && data["@graph"] ? data["@graph"] : [data]);
        for (var j = 0; j < list.length; j++) {
          var it = list[j];
          if (!it || String(it["@type"] || "") !== "Product") continue;
          var id = it.productID || it.sku || (it.offers && it.offers.sku) || "";
          if (id) return String(id);
        }
      }
    } catch(e) {}
    return null;
  }
  function tnVariants() {
    try { var v = window.LS.variants; if (typeof v === "string") v = JSON.parse(v); return Array.isArray(v) ? v : []; } catch(e) { return []; }
  }
  // Variante elegida: única → esa; si no, comparamos los selects variation[N] del tema
  // con option0..2 de LS.variants. Sin match → null (el plan se busca por producto).
  function tnVariantId(form) {
    var list = tnVariants();
    if (list.length === 1 && list[0] && list[0].id) return String(list[0].id);
    try {
      var sels = form ? form.querySelectorAll('select[name^="variation"]') : [];
      var vals = [];
      for (var i = 0; i < sels.length; i++) vals.push(String(sels[i].value));
      if (!vals.length) return null;
      for (var j = 0; j < list.length; j++) {
        var v = list[j], match = true;
        for (var k = 0; k < vals.length; k++) if (String(v["option" + k] == null ? "" : v["option" + k]) !== vals[k]) { match = false; break; }
        if (match && v.id) return String(v.id);
      }
    } catch(e) {}
    return null;
  }
  // Handle del producto desde la URL: /productos/<handle>/ — lo único que
  // TODOS los temas de Tiendanube tienen igual. Con esto el backend nos dice el
  // id y la variante, así el widget no depende de LS.product ni del tema.
  function tnHandleFromUrl() {
    try {
      var m = String(window.location.pathname).match(/\\/productos\\/([^\\/?#]+)/i);
      return m ? decodeURIComponent(m[1]) : "";
    } catch(e) { return ""; }
  }
  function tnResolveProduct() {
    var handle = tnHandleFromUrl();
    if (!handle) return Promise.resolve(null);
    var url = API_BASE + "/api/public?action=tn-product&merchant=" + encodeURIComponent(MERCHANT_ID) + "&handle=" + encodeURIComponent(handle);
    return fetch(url).then(function(r){ return r.json(); })
      .then(function(d){ return d && d.product ? d.product : null; })
      .catch(function(){ return null; });
  }

  // El formulario de compra del TEMA. Excluimos explícitamente:
  //  · los formularios del carrito / mini-carrito (también postean a /comprar o
  //    /carrito): montarse ahí ponía el widget dentro del cajón del carrito;
  //  · nuestro propio bloque HTML (.rc-once), que también postea a /comprar/.
  function tnProductForm() {
    // 1) Selectores inequívocos del formulario de producto: el carrito nunca los usa.
    var directo = document.querySelector('form.js-product-form, form#product_form, form[data-store="product-form"], form[data-component="product-form"]');
    if (directo) return directo;
    // 2) Genérico por action=/comprar: acá SÍ hay que filtrar, porque el carrito y
    //    nuestro propio bloque HTML también postean ahí.
    var list = document.querySelectorAll('form[action*="/comprar"]');
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var inCart = false;
      try {
        if (f.classList && f.classList.contains("rc-once")) continue;
        if (f.closest && (f.closest(".recurrentes-bloque") || f.closest('[class*="cart"], [id*="cart"], [class*="carrito"], [id*="carrito"], [data-store*="cart"]'))) inCart = true;
      } catch(e) {}
      if (inCart) continue;
      // Un formulario de producto de verdad tiene el input de la variante o el botón de agregar.
      if (!f.querySelector('[name="add_to_cart"], [name="variant_id"], [name="variant"], .js-variation-option, .js-addtocart')) continue;
      return f;
    }
    return null;
  }
  // Suscribirse en Tiendanube: checkout de Recurrentes (#/checkout) con plan + cantidad.
  function tnCheckoutUrl(plan, qty) {
    return API_BASE + "/#/checkout?merchant=" + encodeURIComponent(MERCHANT_ID) + "&plan=" + encodeURIComponent(plan.id) + "&qty=" + (parseInt(qty, 10) || 1) + fbCheckoutQs();
  }

  // ─── Detección del cliente logueado en Shopify ────────────────
  // Si el shopper tiene cuenta en la tienda y está logueado, podemos
  // sacar su email + nombre de varias fuentes que distintos themes exponen.
  // Devuelve { email, name } o nulls si no hay sesión.
  function detectShopifyCustomer() {
    var out = { email: null, name: null, phone: null };
    try {
      // 1) Theme moderno: meta inyectado por el theme con cliente actual
      if (window.__st && window.__st.cid) {
        if (window.__st.ce) out.email = String(window.__st.ce);
      }
      // 2) ShopifyAnalytics.meta.page.customerId + customer
      var an = window.ShopifyAnalytics;
      if (an && an.meta && an.meta.page) {
        if (!out.email && an.meta.page.customerEmail) out.email = String(an.meta.page.customerEmail);
      }
      // 3) Inputs hidden del form de checkout (themes que prerellenan)
      var emailInput = document.querySelector('input[name="checkout[email]"], input[name="customer[email]"], input[type="email"]');
      if (emailInput && emailInput.value && !out.email) out.email = String(emailInput.value);
      // 4) Meta tag custom (algunos themes ponen <meta name="customer-email">)
      var em = document.querySelector('meta[name="customer-email"]');
      if (em && em.content && !out.email) out.email = String(em.content);
    } catch(e){}
    return out;
  }

  // ─── Detección de producto + variante actual ──────────────────

  function detectProductId() {
    var tnId = tnProductId(); // null fuera de Tiendanube
    if (tnId) return tnId;
    try {
      if (window.ShopifyAnalytics && ShopifyAnalytics.meta && ShopifyAnalytics.meta.product) {
        return String(ShopifyAnalytics.meta.product.id);
      }
    } catch(e) {}
    try {
      var m = document.querySelector('meta[property="product:id"]');
      if (m && m.content) return String(m.content);
    } catch(e) {}
    try {
      var d = document.querySelector('[data-product-id]');
      if (d && d.dataset.productId) return String(d.dataset.productId);
    } catch(e) {}
    return null;
  }

  function detectVariantId(form) {
    if (IS_TN) return tnVariantId(form);
    // 1) input hidden 'id' dentro del form de Add to cart (estándar Shopify)
    if (form) {
      var idInput = form.querySelector('input[name="id"], select[name="id"]');
      if (idInput && idInput.value) return String(idInput.value);
    }
    // 2) URL param ?variant=
    try {
      var url = new URL(window.location.href);
      var v = url.searchParams.get("variant");
      if (v) return String(v);
    } catch(e) {}
    // 3) ShopifyAnalytics.meta — primer variant del array
    try {
      var p = window.ShopifyAnalytics && ShopifyAnalytics.meta && ShopifyAnalytics.meta.product;
      if (p && p.variants && p.variants[0]) return String(p.variants[0].id);
    } catch(e) {}
    return null;
  }

  // ─── DOM ──────────────────────────────────────────────────────

  function findProductForm() {
    if (IS_TN) return tnProductForm();
    return document.querySelector('form[action*="/cart/add"]');
  }

  function fetchPlan(productId, variantId) {
    // El backend filtra por product_id; si no hay match exacto, devuelve null.
    // Si en F2 sumamos planes por variante específica, agregaríamos &variant=.
    var url = API_BASE + "/api/public?action=plan&merchant=" + encodeURIComponent(MERCHANT_ID) + "&product=" + encodeURIComponent(productId);
    if (variantId) url += "&variant=" + encodeURIComponent(variantId);
    return fetch(url).then(function(r){ return r.json(); }).catch(function(){ return { plan: null }; });
  }

  // ─── Packs (bundle) ───────────────────────────────────────────
  // ¿El plan se vende por packs? (misma regla que shared/bundle/viewmodel.js)
  function planHasPacks(plan) {
    if (!plan) return false;
    if (String(plan.pricing_mode || "").toLowerCase() === "theme") return false;
    return Array.isArray(plan.packs) && plan.packs.length > 0;
  }
  // HTML precalculado de todos los estados del selector (ver ?view=bundle).
  function fetchBundle(planId) {
    var url = API_BASE + "/api/widget?merchant=" + encodeURIComponent(MERCHANT_ID) + "&view=bundle&plan=" + encodeURIComponent(planId);
    return fetch(url).then(function(r){ return r.json(); }).catch(function(){ return { bundle: null }; });
  }

  // ─── Render ───────────────────────────────────────────────────

  function buildWidget(plan) {
    var wrap = document.createElement("div");
    wrap.id = "recurrentes-widget";
    wrap.style.cssText = "border:1px solid #d1d5db;border-radius:10px;padding:14px 16px;margin:14px 0;font-family:inherit;background:#fafafa;";

    // Cards de cada modo. MODE_DEFAULT decide cuál arranca seleccionada;
    // MODE_ORDER decide en qué orden se renderean.
    var defIsSub = MODE_DEFAULT === "sub";
    var subSelectedAttrs = defIsSub ? 'checked' : '';
    var onceSelectedAttrs = defIsSub ? '' : 'checked';
    var subBorder = defIsSub ? '${COL}' : '#d1d5db';
    var subBg = defIsSub ? '${COL_BG_VERY_LIGHT}' : '#fff';
    var onceBorder = defIsSub ? '#d1d5db' : '${COL}';
    var onceBg = defIsSub ? '#fff' : '${COL_BG_VERY_LIGHT}';

    var subCard = '\
      <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border:2px solid ' + subBorder + ';border-radius:8px;cursor:pointer;background:' + subBg + ';" data-rec-mode="sub">\
        <input type="radio" name="recurrentes-mode" value="sub" ' + subSelectedAttrs + ' style="margin:2px 0 0 0;"/>\
        <div style="flex:1">\
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">\
            <strong style="font-size:14px;">' + escapeHtml(SUB_TITLE) + '</strong>\
            <span style="background:${COL};color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700;letter-spacing:0.3px;">' + (plan.discount_pct||0) + '% OFF</span>\
          </div>\
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">' + (SUB_SUBTITLE ? escapeHtml(SUB_SUBTITLE) : ("Recibilo cada " + escapeHtml(plan.frequency_days) + " días. Cancelá cuando quieras.")) + '</div>\
        </div>\
      </label>\
    ';
    var onceCard = '\
      <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border:2px solid ' + onceBorder + ';border-radius:8px;cursor:pointer;background:' + onceBg + ';" data-rec-mode="once">\
        <input type="radio" name="recurrentes-mode" value="once" ' + onceSelectedAttrs + ' style="margin:2px 0 0 0;"/>\
        <div style="flex:1"><strong style="font-size:14px;">' + escapeHtml(ONCE_TITLE) + '</strong><div style="font-size:12px;color:#6b7280;margin-top:2px;">' + escapeHtml(ONCE_SUBTITLE) + '</div></div>\
      </label>\
    ';

    var cards = MODE_ORDER === "sub_first" ? (subCard + '<div style="height:8px"></div>' + onceCard) : (onceCard + '<div style="height:8px"></div>' + subCard);
    wrap.innerHTML = '<div style="font-size:11px;font-weight:700;color:#6b7280;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:10px;">Modo de compra</div>' + cards;
    return wrap;
  }

  // Arma el bloque del disclaimer al final del panel. Si el merchant
  // configuró DISCLAIMER_TEXT custom, lo usamos literal (con escape de HTML).
  // Si no, armamos el texto default con frecuencia + descuento del plan.
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function buildDisclaimerHTML(plan, initialCalc, unitPrice, defaultQty) {
    var title = DISCLAIMER_TEXT ? "Información de tu suscripción" : "Cómo funciona tu suscripción";
    var body;
    if (DISCLAIMER_TEXT) {
      body = '<div style="white-space:pre-wrap;">' + escapeHtml(DISCLAIMER_TEXT) + '</div>';
    } else {
      var discountLine = (plan.discount_pct || 0) > 0
        ? 'Como suscriptor, ya tenés <strong>' + plan.discount_pct + '% off</strong> sobre el precio normal — la suscripción conviene más que la compra única. '
        : '';
      body = '<div style="margin-bottom:4px;">Te suscribís a un <strong>pago recurrente con Mercado Pago</strong>. Se cobra automáticamente cada <strong>' + escapeHtml(plan.frequency_days) + ' días</strong>. Pagás con Mercado Pago (tarjeta de crédito, débito o dinero en cuenta según disponibilidad).</div>'
           + '<div style="margin-top:6px;color:${COL_TEXT_MEDIUM};">' + discountLine + 'Cancelás cuando quieras desde el portal del cliente (link te llega por email al activar).</div>';
    }
    var savingHTML = '';
    if (initialCalc.qty_discount_pct > 0) {
      var saved = Math.round(unitPrice * defaultQty) - initialCalc.subtotal;
      savingHTML = '<div id="rec-disclaimer-saving" style="color:${COL};font-weight:700;margin-top:6px;">Ahorrás $' + saved.toLocaleString("es-AR") + ' por llevar ' + defaultQty + ' paquetes (' + initialCalc.qty_discount_pct + '% off por cantidad).</div>';
    } else {
      savingHTML = '<div id="rec-disclaimer-saving" style="display:none;color:${COL};font-weight:700;margin-top:6px;"></div>';
    }
    return '<div style="margin-top:14px;padding:12px 14px;background:#fff;border:1px solid ${COL_BORDER};border-radius:10px;font-size:11.5px;color:${COL_TEXT_DARK};line-height:1.6;">'
      + '<div style="font-weight:700;margin-bottom:6px;font-size:12px;display:flex;align-items:center;gap:6px;"><span style="font-size:13px;">ℹ️</span> ' + title + '</div>'
      + body
      + savingHTML
      + '</div>';
  }

  function buildSubscribePanel(plan) {
    // Panel reemplaza al form de compra cuando está en modo Suscripción.
    // Incluye summary del plan + selector de cantidad + form de datos + botón.
    var defaultQty = plan.units_per_shipment || 1;
    var unitPrice = plan.subscription_price_ars || 0;
    var tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
    var shippingPrice = plan.shipping_price_ars || 0;
    var freeShipFrom = plan.free_shipping_from_ars || 0;

    // Calcula desglose para una qty dada: subtotal con descuento por qty,
    // costo de envío (si aplica), discount % aplicado, total final.
    function calcBreakdown(q) {
      var qDisc = 0;
      for (var i = 0; i < tiers.length; i++) if (q >= tiers[i].min_qty) qDisc = tiers[i].discount_pct;
      var subt = Math.round(unitPrice * q * (1 - qDisc / 100));
      var ship = (freeShipFrom > 0 && subt >= freeShipFrom) ? 0 : shippingPrice;
      return { subtotal: subt, shipping: ship, qty_discount_pct: qDisc, total: subt + ship };
    }
    var initialCalc = calcBreakdown(defaultQty);
    var initialTotal = initialCalc.total;

    var panel = document.createElement("div");
    panel.id = "recurrentes-sub-panel";
    panel.dataset.unitPrice = String(unitPrice);
    panel.dataset.qty = String(defaultQty);
    panel.dataset.frequency = String(plan.frequency_days);
    panel.style.cssText = "display:none;border:1px solid ${COL};background:linear-gradient(180deg, ${COL_BG_VERY_LIGHT} 0%, ${COL_BG_LIGHT} 100%);border-radius:12px;padding:16px 18px;margin:14px 0;font-family:inherit;";
    panel.innerHTML = '\
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;gap:10px;">\
        <div>\
          <div style="font-size:11px;color:${COL_TEXT_MEDIUM};text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">' + escapeHtml(SUB_TITLE.toUpperCase()) + '</div>\
          <div style="font-size:15px;font-weight:700;color:${COL_TEXT_DARK};margin-top:2px;">' + escapeHtml(plan.product_title) + '</div>\
        </div>\
        <div style="text-align:right;">\
          <div id="rec-total" style="font-size:20px;font-weight:800;color:${COL};line-height:1;">$' + initialTotal.toLocaleString("es-AR") + '</div>\
          <div style="font-size:11px;color:${COL_TEXT_MEDIUM};margin-top:3px;">cada ' + plan.frequency_days + ' días</div>\
        </div>\
      </div>\
      <div style="background:#fff;border:1px solid ${COL_BORDER};border-radius:10px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:10px;">\
        <div>\
          <div style="font-size:12px;font-weight:700;color:${COL_TEXT_DARK};">¿Cuántos paquetes por envío?</div>\
          <div id="rec-qty-detail" style="font-size:11px;color:${COL_TEXT_MEDIUM};margin-top:2px;">$' + unitPrice.toLocaleString("es-AR") + ' c/u</div>\
        </div>\
        <div style="display:flex;align-items:center;gap:6px;">\
          <button id="rec-qty-minus" type="button" style="width:30px;height:30px;border:1px solid ${COL};background:#fff;color:${COL};border-radius:6px;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;line-height:1;">−</button>\
          <input id="rec-qty" type="number" min="1" max="10" value="' + defaultQty + '" style="width:46px;text-align:center;border:1px solid ${COL_BORDER};border-radius:6px;padding:5px;font-size:14px;font-weight:700;color:${COL_TEXT_DARK};background:#fff;font-family:inherit;"/>\
          <button id="rec-qty-plus" type="button" style="width:30px;height:30px;border:1px solid ${COL};background:#fff;color:${COL};border-radius:6px;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;line-height:1;">+</button>\
        </div>\
      </div>\
      <div id="rec-inline-fields"' + (CHECKOUT_FLOW === "redirect" ? ' style="display:none;"' : '') + '>\
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-bottom:8px;">\
        <input id="rec-name" type="text" placeholder="Nombre completo" style="' + inputStyle + '"/>\
        <input id="rec-email" type="email" placeholder="Email" style="' + inputStyle + '"/>\
        <input id="rec-phone" type="tel" placeholder="Teléfono" style="' + inputStyle + '"/>\
        <input id="rec-zip" type="text" placeholder="Código postal" style="' + inputStyle + '"/>\
      </div>${waOptin ? waOptinHtml(COL, "rec") : ""}\
      <input id="rec-taxid" type="text" inputmode="numeric" placeholder="DNI o CUIL / CUIT (solo números)" style="' + inputStyle + ';width:100%;margin-bottom:8px;"/>\
      <input id="rec-address" type="text" placeholder="Dirección de envío (calle + número)" style="' + inputStyle + ';width:100%;margin-bottom:8px;"/>\
      <input id="rec-address2" type="text" placeholder="Piso / departamento (opcional)" style="' + inputStyle + ';width:100%;margin-bottom:8px;"/>\
      <input id="rec-city" type="text" placeholder="Ciudad / Localidad" style="' + inputStyle + ';width:100%;margin-bottom:8px;"/>\
      <select id="rec-province" style="' + inputStyle + ';width:100%;margin-bottom:14px;cursor:pointer;">\
        <option value="">Provincia…</option>\
        <option value="Buenos Aires">Buenos Aires</option>\
        <option value="Ciudad Autónoma de Buenos Aires">Ciudad Autónoma de Buenos Aires (CABA)</option>\
        <option value="Catamarca">Catamarca</option>\
        <option value="Chaco">Chaco</option>\
        <option value="Chubut">Chubut</option>\
        <option value="Córdoba">Córdoba</option>\
        <option value="Corrientes">Corrientes</option>\
        <option value="Entre Ríos">Entre Ríos</option>\
        <option value="Formosa">Formosa</option>\
        <option value="Jujuy">Jujuy</option>\
        <option value="La Pampa">La Pampa</option>\
        <option value="La Rioja">La Rioja</option>\
        <option value="Mendoza">Mendoza</option>\
        <option value="Misiones">Misiones</option>\
        <option value="Neuquén">Neuquén</option>\
        <option value="Río Negro">Río Negro</option>\
        <option value="Salta">Salta</option>\
        <option value="San Juan">San Juan</option>\
        <option value="San Luis">San Luis</option>\
        <option value="Santa Cruz">Santa Cruz</option>\
        <option value="Santa Fe">Santa Fe</option>\
        <option value="Santiago del Estero">Santiago del Estero</option>\
        <option value="Tierra del Fuego">Tierra del Fuego</option>\
        <option value="Tucumán">Tucumán</option>\
      </select>\
      </div>\
      <div id="rec-breakdown" style="background:#fff;border:1px solid ${COL_BORDER};border-radius:10px;padding:11px 14px;margin-bottom:10px;font-size:12px;line-height:1.7;color:${COL_TEXT_DARK};">\
        <div style="display:flex;justify-content:space-between;align-items:baseline;">\
          <span>Subtotal</span>\
          <span><span id="rec-bd-subtotal-strike" style="display:' + (initialCalc.qty_discount_pct > 0 ? 'inline' : 'none') + ';color:#9ca3af;text-decoration:line-through;font-weight:500;margin-right:6px;">$' + (unitPrice * defaultQty).toLocaleString("es-AR") + '</span><strong id="rec-bd-subtotal">$' + initialCalc.subtotal.toLocaleString("es-AR") + '</strong></span>\
        </div>\
        <div id="rec-bd-discount-row" style="display:' + (initialCalc.qty_discount_pct > 0 ? 'flex' : 'none') + ';justify-content:space-between;color:${COL};font-weight:700;"><span>Descuento por cantidad</span><span id="rec-bd-discount">−' + initialCalc.qty_discount_pct + '%</span></div>\
        <div style="display:flex;justify-content:space-between;"><span>Envío</span><strong id="rec-bd-shipping">' + (initialCalc.shipping > 0 ? '$' + initialCalc.shipping.toLocaleString("es-AR") : 'GRATIS') + '</strong></div>\
        <div style="display:flex;justify-content:space-between;border-top:1px solid ${COL_BG_LIGHT};margin-top:6px;padding-top:6px;font-size:13px;"><span><strong>Total por envío</strong></span><strong id="rec-bd-total" style="color:${COL};">$' + initialCalc.total.toLocaleString("es-AR") + '</strong></div>\
      </div>\
      <div id="rec-error-box" style="display:none;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;padding:10px 12px;border-radius:8px;font-size:12px;font-weight:600;line-height:1.4;margin-bottom:10px;"></div>\
      <button id="recurrentes-subscribe-btn" type="button" style="width:100%;background:linear-gradient(135deg,${COL},${COL_DARK});color:#fff;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 12px rgba(16,185,129,0.3);">\
        Suscribirme — $' + initialTotal.toLocaleString("es-AR") + ' cada ' + plan.frequency_days + ' días\
      </button>\
      <div style="font-size:11px;color:${COL_TEXT_MEDIUM};text-align:center;margin-top:10px;line-height:1.5;">Serás redirigido al checkout seguro de Mercado Pago</div>\
      ' + buildDisclaimerHTML(plan, initialCalc, unitPrice, defaultQty) + '\
    ';

    // Wire up del selector de cantidad
    var qtyInput = panel.querySelector("#rec-qty");
    var minusBtn = panel.querySelector("#rec-qty-minus");
    var plusBtn = panel.querySelector("#rec-qty-plus");
    var totalEl = panel.querySelector("#rec-total");
    var subBtn = panel.querySelector("#recurrentes-subscribe-btn");

    function updateTotal() {
      var q = Math.max(1, Math.min(10, parseInt(qtyInput.value) || 1));
      qtyInput.value = q;
      panel.dataset.qty = String(q);
      var bd = calcBreakdown(q);
      totalEl.textContent = "$" + bd.total.toLocaleString("es-AR");
      subBtn.textContent = "Suscribirme — $" + bd.total.toLocaleString("es-AR") + " cada " + plan.frequency_days + " días";
      // Actualizar el desglose
      var bdSub = panel.querySelector("#rec-bd-subtotal");
      var bdSubStrike = panel.querySelector("#rec-bd-subtotal-strike");
      var bdDiscRow = panel.querySelector("#rec-bd-discount-row");
      var bdDisc = panel.querySelector("#rec-bd-discount");
      var bdShip = panel.querySelector("#rec-bd-shipping");
      var bdTotal = panel.querySelector("#rec-bd-total");
      if (bdSub) bdSub.textContent = "$" + bd.subtotal.toLocaleString("es-AR");
      // Precio tachado: subtotal SIN descuento por cantidad, solo si hay descuento aplicado.
      if (bdSubStrike) {
        var subtotalRaw = Math.round(unitPrice * q);
        bdSubStrike.textContent = "$" + subtotalRaw.toLocaleString("es-AR");
        bdSubStrike.style.display = bd.qty_discount_pct > 0 ? "inline" : "none";
      }
      if (bdDiscRow) bdDiscRow.style.display = bd.qty_discount_pct > 0 ? "flex" : "none";
      if (bdDisc) bdDisc.textContent = "−" + bd.qty_discount_pct + "%";
      if (bdShip) bdShip.textContent = bd.shipping > 0 ? "$" + bd.shipping.toLocaleString("es-AR") : "GRATIS";
      if (bdTotal) bdTotal.textContent = "$" + bd.total.toLocaleString("es-AR");
      // Actualizar disclaimer dinámico (ahorro por qty)
      var savingEl = panel.querySelector("#rec-disclaimer-saving");
      if (savingEl) {
        if (bd.qty_discount_pct > 0) {
          var saved = Math.round(unitPrice * q) - bd.subtotal;
          savingEl.textContent = "Ahorrás $" + saved.toLocaleString("es-AR") + " por llevar " + q + " paquetes (" + bd.qty_discount_pct + "% off por cantidad).";
          savingEl.style.display = "block";
        } else {
          savingEl.style.display = "none";
        }
      }
    }
    minusBtn.addEventListener("click", function(){ qtyInput.value = Math.max(1, parseInt(qtyInput.value)-1); updateTotal(); });
    plusBtn.addEventListener("click", function(){ qtyInput.value = Math.min(10, parseInt(qtyInput.value)+1); updateTotal(); });
    qtyInput.addEventListener("input", updateTotal);
    qtyInput.addEventListener("change", updateTotal);

    return panel;
  }

  // width:100% + min-width:0 son clave para mobile: sin esos dos atributos,
  // los inputs dentro del grid 2-cols toman su min-content (basado en el
  // placeholder) y "estiran" el grid hacia la derecha, rompiendo la card.
  // font-size 16px: iOS Safari hace zoom al enfocar inputs con letra menor.
  var inputStyle = "padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:16px;font-family:inherit;outline:none;background:#fff;color:#111827;box-sizing:border-box;width:100%;min-width:0;max-width:100%;";

  // ─── Acciones ─────────────────────────────────────────────────

  function setSubMode(active, form, widget, subPanel) {
    if (active) {
      // Ocultamos TODO el form de compra (variantes + add to cart + qty).
      if (form && form.style.display !== "none") {
        form.dataset.recPrevDisplay = form.style.display || "";
        form.style.display = "none";
      }
      hideExternalBuyButtons(true);
      hideCustomSelector(true);
      try { hideForeignBundles(true, form); keepHidingForeign(form, null); } catch (e) {}
      try { document.body.classList.add("rec-sub-active"); } catch(e){}
      subPanel.style.display = "block";
      widget.querySelector('[data-rec-mode="once"]').style.borderColor = "#d1d5db";
      widget.querySelector('[data-rec-mode="once"]').style.background = "#fff";
      widget.querySelector('[data-rec-mode="sub"]').style.borderColor = "${COL}";
      widget.querySelector('[data-rec-mode="sub"]').style.background = "${COL_BG_VERY_LIGHT}";
    } else {
      if (form) form.style.display = form.dataset.recPrevDisplay || "";
      hideExternalBuyButtons(false);
      hideCustomSelector(false);
      try { hideForeignBundles(false, form); } catch (e) {}
      try { document.body.classList.remove("rec-sub-active"); } catch(e){}
      subPanel.style.display = "none";
      widget.querySelector('[data-rec-mode="once"]').style.borderColor = "${COL}";
      widget.querySelector('[data-rec-mode="once"]').style.background = "${COL_BG_VERY_LIGHT}";
      widget.querySelector('[data-rec-mode="sub"]').style.borderColor = "#d1d5db";
      widget.querySelector('[data-rec-mode="sub"]').style.background = "#fff";
    }

    // Emitir evento custom — themes/bundles custom escuchan esto para
    // ocultar/mostrar sus propias secciones (packs, upsells, CTA propio, etc).
    try {
      document.dispatchEvent(new CustomEvent("recurrentes:mode-change", {
        detail: { mode: active ? "sub" : "once", subPanel: subPanel },
      }));
    } catch (_) {}
  }
  setSubMode = guarded(setSubMode, "modo");

  // Oculta el buy box CUSTOM del merchant (bundles/quantity-breaks propios) en
  // modo suscripción. Selector(es) vienen de &hide= en el <script src>.
  function hideCustomSelector(hide) {
    if (!HIDE_SELECTOR) return;
    var sels = HIDE_SELECTOR.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
    sels.forEach(function(sel){
      var nodes;
      try { nodes = document.querySelectorAll(sel); } catch(e){ return; }
      nodes.forEach(function(el){
        if (hide) {
          if (el.style.display !== "none") {
            el.dataset.recPrevDisplay = el.style.display || "";
            el.style.display = "none";
          }
        } else if (el.dataset.recPrevDisplay !== undefined) {
          el.style.display = el.dataset.recPrevDisplay;
          delete el.dataset.recPrevDisplay;
        }
      });
    });
  }

  // ─── Otros selectores de packs / bundles (20-sept-2026, Thiago: "todos usan app") ───
  // Si la tienda ya tiene un bundle de una app (Kaching, Pumper, Selleasy, Bundler,
  // Fast Bundle, Vitals, PickyStory…), el nativo del tema o un Liquid propio, lo
  // escondemos nosotros: manda nuestro selector. Dos redes: (1) selectores conocidos
  // de las apps más usadas; (2) heurística en el bloque de compra: algo que no es
  // nuestro ni el form, con nombre tipo bundle/pack/volume/upsell o con varios
  // precios + "x2 / unidades / pack / combo". Nunca tocamos el precio del producto.
  var KNOWN_BUNDLES = [
    ["Kaching Bundles", "kaching-bundles, .kaching-bundles, .kaching-bundles__block, [class^='kaching-']"],
    ["Pumper Bundles", "pumper-bundles, .pumper-bundles, #pumper-bundles, .pb-bundles, [class^='pumper-']"],
    ["Selleasy", ".lb-bundle-widget, .lb-upsell-widget, #logbase-widget, .selleasy-widget, [class^='lb-bundle']"],
    ["Bundler", ".bundler-target-element, #bundler-app, .bundler-widget, [class^='bundler-']"],
    ["Fast Bundle", "fast-bundle, .fast-bundle, #fast-bundle, [class^='fast-bundle']"],
    ["Bundle Bear", ".bundle-bear, #bundle-bear, [class^='bundle-bear']"],
    ["PickyStory", "pickystory-deal, .pickystory-container, [class^='pickystory']"],
    ["Vitals", ".vtl-quantity-breaks, .vtl-bundle, .vtl-vd, .vtl-bundles-widget"],
    ["Wide Bundles", "wide-bundles, .wide-bundles, #wide-bundles"],
    ["Simple Bundles", "simple-bundles-widget, .simple-bundles, #simple-bundles"],
    ["Rapi Bundle", "rapi-bundles, .rapi-bundle, [class^='rapi-bundle']"],
    ["Monster Upsells", ".monster-upsells, #monster-upsells"],
    ["Bundle Builder", ".bundle-builder, #bundle-builder"],
    ["Rebuy", ".rebuy-widget"],
    ["Packs del tema", "volume-pricing, .volume-pricing, quantity-rules, .quantity__rules, .price-per-item, .quantity-discount"]
  ];
  var FOREIGN_SKIP = '#recurrentes-widget, [data-rec-root], .recurrentes-bloque, .rc-once, [class*="cart" i], [id*="cart" i], [class*="drawer" i], [class*="carrito" i], header, footer, nav';
  var foreignFound = {}, lastForeignLog = null; // nombre → true (para el reporte al panel)
  function isOurs(el) { return !!(el.closest && (el.closest("#recurrentes-widget, [data-rec-root], .recurrentes-bloque, .rc-once"))); }
  function buyArea(form) {
    var sel = '.product__info-wrapper, .product__info-container, .product__info, .product-single__meta, .product-info, [id^="ProductInfo"], [class*="product-info"], [class*="product__info"], [class*="product-details"], [data-store="product-info"], .js-product-detail, .product-form-container';
    var a = null;
    try { a = form ? form.closest(sel) : document.querySelector(sel); } catch (e) {}
    if (!a && form) a = (form.parentElement && form.parentElement.parentElement) || form.parentElement;
    return a || document.body;
  }
  function outermost(list) {
    return list.filter(function (el) { return !list.some(function (o) { return o !== el && o.contains(el); }); });
  }
  function detectForeignBundles(form) {
    var found = [];
    var bad = function (el) { return !el || isOurs(el) || el === form || (form && el.contains(form)) || (el.closest && el.closest(FOREIGN_SKIP) && !el.matches(FOREIGN_SKIP.split(",")[0])); };
    // (1) apps conocidas, en toda la página menos carrito/header/footer
    KNOWN_BUNDLES.forEach(function (k) {
      var nodes = []; try { nodes = document.querySelectorAll(k[1]); } catch (e) {}
      nodes.forEach(function (el) { if (bad(el)) return; if (el.closest(FOREIGN_SKIP)) return; found.push(el); foreignFound[k[0]] = true; });
    });
    // (2) heurística dentro del bloque de compra
    var area = buyArea(form);
    var cands = []; try { cands = area.querySelectorAll('[class*="bundle" i], [id*="bundle" i], [class*="quantity-break" i], [class*="qty-break" i], [class*="volume-disc" i], [class*="upsell" i], [class*="pack-select" i], [class*="packs" i]'); } catch (e) {}
    cands.forEach(function (el) { if (bad(el) || el.closest(FOREIGN_SKIP)) return; if (/price/i.test(el.className || "")) return; found.push(el); foreignFound["bloque de packs"] = true; });
    var customs = []; try { customs = area.querySelectorAll("*"); } catch (e) {}
    for (var ci = 0; ci < customs.length && ci < 600; ci++) { var ce = customs[ci]; if (ce.tagName.indexOf("-") < 0 || bad(ce) || ce.closest(FOREIGN_SKIP)) continue; if (/bundle|pack|upsell|deal|offer|volume|qty|quantity|combo|tier/i.test(ce.tagName) && !/quantity-input|variant|price/i.test(ce.tagName)) { found.push(ce); foreignFound["bloque de packs"] = true; } }
    var boxes = []; try { boxes = area.querySelectorAll("div, section, ul, fieldset"); } catch (e) {}
    var n = 0;
    for (var i = 0; i < boxes.length && n < 400; i++, n++) {
      var el = boxes[i];
      if (bad(el) || el.closest(FOREIGN_SKIP) || /price|precio|title|titulo|description|descripcion|media|gallery|variant|swatch/i.test((el.className || "") + " " + (el.id || ""))) continue;
      var t = (el.textContent || "").replace(/\\s+/g, " ").trim();
      if (t.length < 12 || t.length > 700) continue;
      var prices = t.match(/\\$\\s?\\d[\\d.,]*/g) || [];
      if (prices.length < 2) continue;
      if (!/(\\bx\\s?\\d|\\d\\s?(u\\.|un\\b|unid|unidades)|\\bpack\\b|\\bcombo\\b|c\\/u|cada uno|por unidad|llev[aá]\\s?\\d)/i.test(t)) continue;
      if (el.querySelector("form, input[type=submit], button[name=add]")) continue;
      found.push(el); foreignFound["bloque de packs"] = true;
    }
    found = outermost(found.filter(function (el, i, arr) { return arr.indexOf(el) === i; }));
    return found;
  }
  function hideForeignBundles(hide, form) {
    var els = hide ? detectForeignBundles(form) : document.querySelectorAll("[data-rec-foreign]");
    els.forEach(function (el) {
      if (hide) {
        if (el.dataset.recForeign) return;
        el.dataset.recForeign = "1";
        if (el.style.display !== "none") { el.dataset.recPrevDisplay = el.style.display || ""; el.style.display = "none"; }
      } else {
        delete el.dataset.recForeign;
        if (el.dataset.recPrevDisplay !== undefined) { el.style.display = el.dataset.recPrevDisplay; delete el.dataset.recPrevDisplay; }
      }
    });
    var names = foreignNames();
    if (hide && names && names !== lastForeignLog) { lastForeignLog = names; log("Otro selector de packs oculto: " + names + " — manda el de Recurrentes"); }
    return els.length;
  }
  // Regla de Thiago (20-sept): SIEMPRE uno u otro, nunca los dos ni ninguno. Si con el
  // widget montado queda a la vista otro selector de packs que no supimos esconder
  // (una app que envuelve el form, un tema raro…), dejamos la tienda como estaba
  // (su bundle) y avisamos al panel con "bundle_conflict".
  function foreignConflict(form) {
    var hits = [];
    var visible = function (el) { try { var r = el.getBoundingClientRect(); return r.width * r.height > 1200 && el.offsetParent !== null && getComputedStyle(el).visibility !== "hidden"; } catch (e) { return false; } };
    var skip = function (el) { return !el || isOurs(el) || el.dataset.recForeign || el.closest(FOREIGN_SKIP) || el.closest("[data-rec-foreign]"); };
    var NOISE = /price|precio|title|titulo|description|descripcion|media|gallery|swatch|variant|breadcrumb|review|rating|share|social/i;
    // Texto del bloque SIN lo nuestro, sin el form (variantes, cantidad, botón), sin
    // descripción/precio/galería: lo que queda es lo que ve el cliente como "otro selector".
    var residual = function (el) {
      var c = el.cloneNode(true);
      var rm = []; try { rm = c.querySelectorAll('#recurrentes-widget, [data-rec-root], .recurrentes-bloque, .rc-once, form, select, option, label, script, style, [data-rec-foreign]'); } catch (e) {}
      rm.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
      var all = c.querySelectorAll("*");
      for (var i = 0; i < all.length; i++) { var n = all[i]; if (NOISE.test((n.className || "") + " " + (n.id || "")) && n.parentNode) n.parentNode.removeChild(n); }
      return (c.textContent || "").replace(/\\s+/g, " ").trim();
    };
    var area = buyArea(form);
    var byName = []; try { byName = area.querySelectorAll(KNOWN_BUNDLES.map(function (k) { return k[1]; }).join(", ") + ', [class*="bundle" i], [id*="bundle" i], [class*="quantity-break" i], [class*="qty-break" i], [class*="volume-disc" i], [class*="upsell" i], [class*="pack-select" i]'); } catch (e) {}
    byName.forEach(function (el) { if (skip(el) || !visible(el)) return; if (/price/i.test(el.className || "")) return; hits.push(el); });
    // Apps con shadow DOM (no se puede leer lo que muestran): si hay un elemento
    // custom visible con shadow root dentro del bloque de compra y no es nuestro, es otro selector.
    var alls = []; try { alls = area.querySelectorAll("*"); } catch (e) {}
    // Un custom element es inline por defecto: su rect puede dar 0 aunque adentro dibuje un bloque.
    var visibleCE = function (el) {
      try {
        if (!el.isConnected || getComputedStyle(el).display === "none") return false;
        if (visible(el)) return true;
        var kids = el.shadowRoot ? el.shadowRoot.children : [];
        for (var k = 0; k < kids.length; k++) { if (kids[k].tagName === "STYLE" || kids[k].tagName === "SCRIPT") continue; var r = kids[k].getBoundingClientRect(); if (r.width * r.height > 1200) return true; }
        return false;
      } catch (e) { return false; }
    };
    for (var si = 0; si < alls.length && si < 600; si++) { var se = alls[si]; if (se.tagName.indexOf("-") < 0 || !se.shadowRoot || skip(se) || !visibleCE(se)) continue; if (/quantity-input|variant-selects|variant-radios|product-form|price|media|gallery|modal|deferred|slider|share|localization|menu|header|drawer|cart/i.test(se.tagName)) continue; hits.push(se); }
    var boxes = []; try { boxes = area.querySelectorAll("div, section, ul, fieldset"); } catch (e) {}
    for (var i = 0; i < boxes.length && i < 150; i++) {
      var el = boxes[i];
      if (skip(el) || !visible(el) || NOISE.test((el.className || "") + " " + (el.id || ""))) continue;
      var t = residual(el);
      if (t.length < 12 || t.length > 700) continue;
      if ((t.match(/(\\$|\\bARS)\\s?\\d[\\d.,]*/g) || []).length < 2) continue;
      if (!/(\\bx\\s?\\d|\\d\\s?(u\\.|un\\b|unid|unidades)|\\bpack\\b|\\bcombo\\b|c\\/u|cada uno|por unidad|llev[aá]\\s?\\d)/i.test(t)) continue;
      hits.push(el);
    }
    return hits.length ? outermost(hits) : [];
  }
  function foreignNames() { var k = Object.keys(foreignFound); return k.length ? k.join(", ").slice(0, 120) : null; }
  // Las apps inyectan tarde: re-mirar un rato después de montar.
  function keepHidingForeign(form, extraForReport) {
    [800, 2000, 4000, 8000].forEach(function (ms) {
      setTimeout(function () {
        try {
          if (!document.body.classList.contains("rec-bundle-active") && !document.body.classList.contains("rec-sub-active")) return;
          var before = foreignNames();
          hideForeignBundles(true, form);
          if (extraForReport && foreignNames() !== before) extraForReport.hid = foreignNames();
        } catch (e) {}
      }, ms);
    });
  }

  function hideExternalBuyButtons(hide) {
    // Botones de pago alternativos que Shopify renderea afuera del form:
    // dynamic checkout, Shop Pay, Apple Pay, Google Pay, etc.
    var selectors = [
      '.shopify-payment-button',
      '[data-shopify="payment-button"]',
      '.product-form__buy-buttons',
      '.shopify-buy-button',
    ];
    selectors.forEach(function(sel){
      document.querySelectorAll(sel).forEach(function(el){
        if (hide) {
          if (el.style.display !== "none") {
            el.dataset.recPrevDisplay = el.style.display || "";
            el.style.display = "none";
          }
        } else {
          if (el.dataset.recPrevDisplay !== undefined) {
            el.style.display = el.dataset.recPrevDisplay;
            delete el.dataset.recPrevDisplay;
          }
        }
      });
    });
  }

  function startSubscribe(plan, subPanel) {
    var fields = {
      name:    subPanel.querySelector("#rec-name"),
      email:   subPanel.querySelector("#rec-email"),
      phone:   subPanel.querySelector("#rec-phone"),
      taxid:   subPanel.querySelector("#rec-taxid"),
      zip:     subPanel.querySelector("#rec-zip"),
      address: subPanel.querySelector("#rec-address"),
      city:    subPanel.querySelector("#rec-city"),
      province: subPanel.querySelector("#rec-province"),
    };
    var values = {};
    Object.keys(fields).forEach(function(k){ values[k] = (fields[k]?.value || "").trim(); });
    // Sanitizar tax_id: solo dígitos (admite que el cliente meta guiones/espacios)
    values.taxid = values.taxid.replace(/[^0-9]/g, "");

    // Limpiar estados previos de error en todos los campos
    Object.keys(fields).forEach(function(k){
      if (fields[k]) fields[k].style.borderColor = "#d1d5db";
    });
    var errBox = subPanel.querySelector("#rec-error-box");
    if (errBox) errBox.style.display = "none";

    // Validar campos requeridos: name, email, taxid, address, city.
    var missing = [];
    if (!values.name)    missing.push("name");
    if (!values.email)   missing.push("email");
    if (!values.taxid)   missing.push("taxid");
    if (!values.phone)    missing.push("phone");
    if (!values.address)  missing.push("address");
    if (!values.city)     missing.push("city");
    if (!values.province) missing.push("province");
    if (!values.zip)      missing.push("zip");

    var emailInvalid = values.email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(values.email);
    // DNI: 7-8 dígitos. CUIL/CUIT: 11 dígitos. Cualquier otro largo es inválido.
    var taxidInvalid = values.taxid && !(values.taxid.length === 7 || values.taxid.length === 8 || values.taxid.length === 11);
    // Dirección: tiene que ser calle + número REAL. Rechazamos lo que no tiene
    // ningún número (ej. "Casa") y la basura típica del autofill de Google/Android
    // ("Unnamed Road"), que dejaba envíos sin dirección utilizable.
    var addrNorm = (values.address || "").trim().toLowerCase();
    var addressInvalid = values.address && (!/\\d/.test(values.address) || /unnamed\\s*road|sin\\s*nombre|unnamed/.test(addrNorm));

    if (missing.length || emailInvalid || taxidInvalid || addressInvalid) {
      missing.forEach(function(k){
        if (fields[k]) {
          fields[k].style.borderColor = "#ef4444";
          fields[k].style.background = "#fef2f2";
        }
      });
      if (emailInvalid && fields.email) {
        fields.email.style.borderColor = "#ef4444";
        fields.email.style.background = "#fef2f2";
      }
      if (taxidInvalid && fields.taxid) {
        fields.taxid.style.borderColor = "#ef4444";
        fields.taxid.style.background = "#fef2f2";
      }
      if (addressInvalid && fields.address) {
        fields.address.style.borderColor = "#ef4444";
        fields.address.style.background = "#fef2f2";
      }
      var errMsg;
      if (emailInvalid) errMsg = "El email no parece válido. Revisá que tenga formato nombre@dominio.com.";
      else if (taxidInvalid) errMsg = "DNI o CUIL inválido. DNI son 7-8 dígitos, CUIL/CUIT son 11 dígitos.";
      else if (addressInvalid) errMsg = "Poné tu dirección completa con calle Y número (ej: Av. Corrientes 1234). No sirve solo 'Casa' ni direcciones sin número.";
      else errMsg = "Completá los campos en rojo para continuar.";
      showFormError(subPanel, errMsg);
      // Listener one-shot que limpia el rojo cuando el usuario empieza a tipear
      Object.keys(fields).forEach(function(k){
        var el = fields[k];
        if (!el) return;
        var handler = function(){ el.style.borderColor = "#d1d5db"; el.style.background = "#fff"; el.removeEventListener("input", handler); };
        el.addEventListener("input", handler);
      });
      return;
    }

    var name = values.name, email = values.email, phone = values.phone, taxid = values.taxid;
    var zip = values.zip, address1 = values.address, city = values.city;

    var btn = subPanel.querySelector("#recurrentes-subscribe-btn");
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.8";
      btn.style.cursor = "wait";
      btn.innerHTML = '<span style="display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,0.3);border-top-color:#fff;border-radius:50%;animation:rec-spin 0.7s linear infinite;vertical-align:middle;margin-right:8px;"></span>Conectando con Mercado Pago…';
      // Inyectar keyframes una sola vez
      if (!document.getElementById("rec-spin-style")) {
        var st = document.createElement("style");
        st.id = "rec-spin-style";
        st.textContent = "@keyframes rec-spin{to{transform:rotate(360deg);}}";
        document.head.appendChild(st);
      }
    }

    var qty = parseInt(subPanel.dataset.qty) || (plan.units_per_shipment || 1);

    // ── Datos de atribución de Meta (para que la venta se atribuya al AD correcto) ──
    // fbc = click ID del anuncio (cookie _fbc, o se construye del fbclid de la URL).
    // fbp = ID del navegador (cookie _fbp). Se mandan al backend para incluirlos en
    // el evento Purchase de la API de Conversiones. Sin esto, Meta solo matchea por
    // email/tel (atribución débil).
    var fbData = (function(){
      function cookie(n){ var m = document.cookie.match(new RegExp("(^|;\\\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[2]) : ""; }
      var fbp = cookie("_fbp");
      var fbc = cookie("_fbc");
      if (!fbc) {
        try {
          var p = new URLSearchParams(window.location.search);
          var fbclid = p.get("fbclid");
          if (fbclid) fbc = "fb.1." + Date.now() + "." + fbclid;
        } catch(e){}
      }
      return { fbp: fbp, fbc: fbc, event_source_url: window.location.href, user_agent: navigator.userAgent };
    })();

    fetch(API_BASE + "/api/checkout/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        plan_id: plan.id,
        quantity: qty,
        fb: fbData,${waOptin ? waOptinBodyJs("rec") : ""}
        customer: { email: email, name: name, phone: phone, tax_id: taxid },
        shipping_address: {
          address1: address1,
          city: city,
          province: values.province,
          zip: zip,
          country: "Argentina",
          first_name: (name || "").split(" ")[0] || "",
          last_name: (name || "").split(" ").slice(1).join(" ") || "",
          phone: phone || "",
        },
      }),
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) {
        showFormError(subPanel, d.error);
        if (btn) { btn.disabled = false; btn.textContent = "Reintentar"; btn.style.opacity = "1"; btn.style.cursor = "pointer"; }
        return;
      }
      window.location.href = d.init_point;
    }).catch(function(e){
      showFormError(subPanel, "No pudimos conectarnos con Mercado Pago. Revisá tu conexión y reintentá.");
      if (btn) { btn.disabled = false; btn.textContent = "Reintentar"; btn.style.opacity = "1"; btn.style.cursor = "pointer"; }
    });
  }

  // Muestra mensaje de error inline (banner rojo arriba del botón).
  // Suplanta el alert() de browser que rompe la estética del widget.
  function showFormError(subPanel, msg) {
    var box = subPanel.querySelector("#rec-error-box");
    if (!box) return;
    box.textContent = msg;
    box.style.display = "block";
    // Scroll al banner si está fuera de viewport
    try { box.scrollIntoView({ behavior: "smooth", block: "center" }); } catch(_) {}
  }

  // ─── Init ─────────────────────────────────────────────────────

  function init() {
    // Guard: solo cargar el widget en páginas de producto individual.
    // Sin esto se renderiza en /collections, homepage, etc — porque las cards
    // de producto del listado tienen data-product-id y form de "add to cart",
    // y el script las confunde con la página del producto.
    var isProductPage = /\\/products\\//.test(window.location.pathname) ||
      (window.ShopifyAnalytics && ShopifyAnalytics.meta && ShopifyAnalytics.meta.page && ShopifyAnalytics.meta.page.pageType === "product") ||
      !!tnProductId() ||
      (IS_TN && /\\/productos\\//.test(window.location.pathname)); // Tiendanube
    if (!isProductPage) { log("No es página de producto, widget no carga"); return; }

    var productId = detectProductId();
    var form = findProductForm();
    var variantId = form ? detectVariantId(form) : null;

    // Tiendanube: si el tema no expuso el producto, lo resolvemos por el handle
    // de la URL contra el catálogo de la tienda y volvemos a entrar. Un solo
    // reintento, para que un handle sin match no deje el widget en bucle.
    if (!productId && IS_TN && !init._tnRetry) {
      init._tnRetry = true;
      log("Tiendanube: el tema no expone el producto, lo busco por el handle de la URL");
      tnResolveProduct().then(function (p) {
        if (!p || !p.id) { log("El handle de la URL no matcheó ningún producto"); return; }
        window.__RECURRENTES_TN_PRODUCT = p.id;
        if (p.variant_id) window.__RECURRENTES_TN_VARIANT = p.variant_id;
        init();
      });
      return;
    }
    if (!productId) { log("No se detectó productId — widget no carga"); report("no_product"); return; }
    if (!variantId && IS_TN && window.__RECURRENTES_TN_VARIANT) variantId = String(window.__RECURRENTES_TN_VARIANT);

    // Mount point custom: si el theme tiene <div id="recurrentes-mount"></div>
    // en algún lugar específico (ej dentro de un bundle Liquid custom),
    // insertamos ahí en lugar de encima del form. Útil para themes con bundle
    // custom que NO usan el <form action="/cart/add"> estándar.
    var mountPoint = document.getElementById("recurrentes-mount");
    // Buy box custom (bundle propio): si el merchant pasó &hide=, el widget se
    // monta JUSTO ARRIBA de ese bloque, así el toggle Sub/Única queda antes del
    // bundle y no debajo del botón de compra.
    var hideAnchor = null;
    if (HIDE_SELECTOR) {
      try { hideAnchor = document.querySelector(HIDE_SELECTOR.split(",")[0].trim()); } catch(e){}
    }
    // En Tiendanube los temas nuevos no siempre tienen un <form> reconocible.
    // Antes de rendirnos, buscamos un ancla razonable del bloque de compra.
    if (!mountPoint && !form && !hideAnchor && IS_TN) {
      var sel = ['[data-store="product-info"]', ".js-product-detail", ".product-info",
                 '[data-component="product-info"]', "main h1", "h1"];
      for (var i = 0; i < sel.length; i++) {
        var cand = null;
        try { cand = document.querySelector(sel[i]); } catch(e) {}
        if (cand && cand.closest('[class*="cart"], [id*="cart"], [class*="carrito"], [id*="carrito"]')) cand = null;
        if (cand) { hideAnchor = cand; log("Tiendanube: monto sobre " + sel[i]); break; }
      }
    }
    if (!mountPoint && !form && !hideAnchor) {
      log("No hay mount point ni form/cart/add ni hide anchor. Widget no se monta.");
      report("no_form", { product: productId });
      return;
    }
    // Tiendanube: si el script llegó a inyectarse, el bloque HTML que pusimos en
    // la descripción (el plan B sin JavaScript) queda repetido. Lo escondemos.
    if (IS_TN) {
      try { document.querySelectorAll(".recurrentes-bloque").forEach(function (el) { el.style.display = "none"; }); } catch(e) {}
    }

    // ─── Modo PACKS: selector de packs precalculado (shared/bundle) ───
    // "sub" → nuestro CTA lleva al checkout de Recurrentes con plan+pack.
    // "once" → se muestra el botón nativo del tema (Shopify y Tiendanube) con la
    // cantidad del pack; nuestro CTA de compra única queda oculto.
    function mountBundle(plan, bundle) {
      var host = document.createElement("div");
      host.id = "recurrentes-widget";
      host.className = "rc-bundle-host";
      host.setAttribute("data-rec-root", "1");
      var styleEl = document.createElement("style");
      styleEl.setAttribute("data-rc-bundle-css", "");
      styleEl.textContent = bundle.css || "";
      var root = document.createElement("div");
      host.appendChild(styleEl);
      host.appendChild(root);
      if (mountPoint) mountPoint.appendChild(host);
      else if (hideAnchor && hideAnchor.parentNode) hideAnchor.parentNode.insertBefore(host, hideAnchor);
      else form.parentNode.insertBefore(host, form);
      var watchExtra = { product: productId, plan: plan.id, mode: "bundle" };
      try { hideForeignBundles(true, form); watchExtra.hid = foreignNames(); } catch (e) {}
      keepHidingForeign(form, watchExtra);
      watchVisible(host, watchExtra);

      var state = { mode: bundle.modeDefault === "once" ? "once" : "sub", idx: parseInt(bundle.defaultIdx, 10) || 0 };
      if (bundle.states[state.mode + ":" + state.idx] === undefined) state.idx = 0;
      var viaKeyboard = false;

      function paint() {
        root.innerHTML = bundle.states[state.mode + ":" + state.idx] || "";
        host.setAttribute("data-rc-mode", state.mode);
      }
      function packQty() {
        var list = bundle.packs || [];
        for (var i = 0; i < list.length; i++) if (list[i].idx === state.idx) return Math.max(1, parseInt(list[i].qty, 10) || 1);
        return 1;
      }
      // Tiendanube, modo packs: el pack decide la cantidad y el precio, así que el
      // precio, el selector de cantidad y el botón del tema sobran mientras la
      // suscripción está activa. En compra única se hace al revés: se esconde
      // NUESTRO botón y vuelve el "Agregar al carrito" nativo (mini-carrito y
      // todo), con la cantidad del pack ya cargada en el input del tema.
      // Selectores: los hooks que Tiendanube expone para apps en sus temas
      // (data-store="product-buy-button", data-store="product-price-<id>",
      // data-component="product.quantity") más las clases js-* del tema base.
      var TN_THEME_PRICE = '[data-store^="product-price"], .js-product-price, .js-price-display, .js-compare-price-display';
      var TN_THEME_QTY   = '[data-component="product.quantity"], .js-quantity-container, .js-quantity, .js-quantity-input, .js-quantity-up, .js-quantity-down';
      var TN_THEME_BUY   = '[data-store="product-buy-button"], .js-addtocart, form.js-product-form [type="submit"], form#product_form [type="submit"]';
      var NOT_OURS = ':not(#recurrentes-widget *):not(.recurrentes-bloque *):not(.rc-once *)';
      function withNotOurs(list) {
        return list.split(",").map(function (x) { return "body.rec-bundle-active " + x.trim() + NOT_OURS; }).join(",");
      }
      function syncThemeQty() {
        // La cantidad del tema = la del pack, para que el botón nativo agregue lo
        // correcto (Tiendanube y Shopify: en compra única manda el botón del tema).
        var q = packQty();
        window.__recPackQty = q;
        var inputs = document.querySelectorAll('.js-quantity-input, input[name^="quantity"]');
        var found = 0;
        for (var i = 0; i < inputs.length; i++) {
          var inp = inputs[i];
          if (inp.closest && (inp.closest("#recurrentes-widget") || inp.closest(".rc-once"))) continue;
          found++;
          if (String(inp.value) !== String(q)) {
            inp.value = q;
            try { inp.dispatchEvent(new Event("input", { bubbles: true })); inp.dispatchEvent(new Event("change", { bubbles: true })); } catch(e) {}
          }
        }
        // Shopify: temas sin input de cantidad en el DOM (Horizon y derivados mandan
        // 1 por defecto). Le sumamos al form un hidden "quantity" con la del pack:
        // el submit del tema usa FormData(form) y lo incluye.
        if (!found && !IS_TN && form && (form.getAttribute("action") || "").indexOf("/cart/add") !== -1) {
          var h = form.querySelector('input[type="hidden"][name="quantity"][data-rc-qty]');
          if (!h) { h = document.createElement("input"); h.type = "hidden"; h.name = "quantity"; h.setAttribute("data-rc-qty", "1"); form.appendChild(h); }
          h.value = q;
        }
      }
      // Shopify, compra única: algunos temas (Horizon y derivados) arman el pedido
      // a /cart/add desde su propio estado y mandan cantidad 1 aunque el form tenga
      // otra. Interceptamos SOLO las llamadas a /cart/add de esta página mientras
      // la compra única está activa y ponemos la cantidad del pack. El tema sigue
      // manejando la respuesta (mini-carrito, drawer, redirect: lo suyo).
      (function patchCartAdd() {
        if (IS_TN || window.__recCartPatched) return;
        window.__recCartPatched = true;
        function onceActive() { return document.body.classList.contains("rec-bundle-active") && !document.body.classList.contains("rec-sub-active") && (window.__recPackQty || 0) > 1; }
        function isCartAdd(url) { url = String(url || ""); return url.indexOf("/cart/add") !== -1; }
        function fixBody(body) {
          var q = String(window.__recPackQty);
          try {
            if (body instanceof FormData) { body.set("quantity", q); return body; }
            if (body instanceof URLSearchParams) { body.set("quantity", q); return body; }
            if (typeof body === "string") {
              var t = body.trim();
              if (t.charAt(0) === "{") {
                var j = JSON.parse(t);
                if (Array.isArray(j.items)) { for (var i = 0; i < j.items.length; i++) j.items[i].quantity = window.__recPackQty; }
                else j.quantity = window.__recPackQty;
                return JSON.stringify(j);
              }
              var p = new URLSearchParams(body); p.set("quantity", q); return p.toString();
            }
          } catch (e) {}
          return body;
        }
        var of = window.fetch;
        if (of) window.fetch = function (input, init) {
          try {
            var url = typeof input === "string" ? input : (input && input.url) || "";
            if (isCartAdd(url) && onceActive() && init && init.body) init.body = fixBody(init.body);
          } catch (e) {}
          return of.apply(this, arguments);
        };
        var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (m, url) { this.__recUrl = url; return XO.apply(this, arguments); };
        XMLHttpRequest.prototype.send = function (body) {
          try { if (isCartAdd(this.__recUrl) && onceActive() && body) body = fixBody(body); } catch (e) {}
          return XS.call(this, body);
        };
      })();

      function applyMode() {
        // Suscripción: se esconden los botones de compra del tema (no el form
        // entero, para no perder el selector de variantes), el buy box custom
        // (&hide=) y los botones de pago rápido (Shop Pay, etc.); manda nuestro CTA.
        // Compra única (Thiago, 17-sept): al revés, igual que en Tiendanube. Se
        // esconde NUESTRO CTA y vuelve el "Agregar al carrito" nativo del tema con
        // todo lo que tenga abajo (Shop Pay, Apple Pay…), con la cantidad del pack
        // ya cargada en el input del tema. Así el carrito/mini-carrito es el de
        // siempre en cualquier tema. El selector de cantidad del tema queda oculto
        // en los dos modos: la cantidad la decide el pack.
        hideExternalBuyButtons(state.mode === "sub");
        hideCustomSelector(true);
        try { hideForeignBundles(true, form); } catch (e) {}
        if (!document.getElementById("rc-bundle-hide-style")) {
          var st = document.createElement("style");
          st.id = "rc-bundle-hide-style";
          st.textContent =
            'body.rec-bundle-active form[action*="/cart/add"] quantity-input,body.rec-bundle-active form[action*="/cart/add"] .product-form__quantity,body.rec-bundle-active form[action*="/cart/add"] .quantity__rules{display:none !important}' +
            'body.rec-bundle-active.rec-sub-active form[action*="/cart/add"] button[name="add"],body.rec-bundle-active.rec-sub-active form[action*="/cart/add"] [type="submit"]{display:none !important}' +
            'body.rec-bundle-active:not(.rec-sub-active) #recurrentes-widget [data-rc-action="cta"]{display:none !important}';
          if (IS_TN) {
            st.textContent +=
              // siempre en modo packs: precio y cantidad del tema
              withNotOurs(TN_THEME_PRICE) + "{display:none !important}" +
              withNotOurs(TN_THEME_QTY) + "{display:none !important}" +
              // en suscripción: el botón del tema; en compra única: el nuestro
              withNotOurs(TN_THEME_BUY).replace(/body\.rec-bundle-active /g, "body.rec-bundle-active.rec-sub-active ") + "{display:none !important}" +
              // compra única: el botón nativo ocupa todo el ancho (su columna solía
              // compartir la fila con el selector de cantidad, que ahora está oculto)
              withNotOurs(TN_THEME_BUY).replace(/body\.rec-bundle-active /g, "body.rec-bundle-active:not(.rec-sub-active) ") + "{width:100% !important;max-width:100% !important;flex:1 1 100% !important;margin-left:0 !important;margin-right:0 !important}" +
              TN_THEME_BUY.split(",").map(function (x) { return "body.rec-bundle-active:not(.rec-sub-active) *:has(> " + x.trim() + NOT_OURS + ")"; }).join(",") + "{width:100% !important;max-width:100% !important;flex:0 0 100% !important;padding-left:0 !important;padding-right:0 !important}";
          }
          document.head.appendChild(st);
        }
        try {
          document.body.classList.add("rec-bundle-active");
          document.body.classList.toggle("rec-sub-active", state.mode === "sub");
        } catch(e){}
        syncThemeQty();
        try {
          document.dispatchEvent(new CustomEvent("recurrentes:mode-change", { detail: { mode: state.mode, packIndex: state.idx, qty: packQty(), bundle: true } }));
        } catch(e){}
      }
      function showErr(msg) {
        var box = root.querySelector(".rc-err");
        if (box) { box.textContent = msg; box.classList.add("is-on"); }
      }
      function setBusy(busy, label) {
        var btn = root.querySelector('[data-rc-action="cta"]');
        if (!btn) return;
        btn.disabled = !!busy;
        if (busy) { btn.setAttribute("data-rc-label", btn.innerHTML); btn.textContent = label || "Un momento…"; }
        else if (btn.getAttribute("data-rc-label")) { btn.innerHTML = btn.getAttribute("data-rc-label"); btn.removeAttribute("data-rc-label"); }
      }
      function goCheckout() {
        // Tiendanube no tiene página de checkout en la tienda: el pack va al
        // checkout de Recurrentes con su índice (el server resuelve precio,
        // cantidad y frecuencia del pack, igual que en el checkout on-store).
        // Un solo checkout para todas las tiendas: el de Recurrentes. El server
        // resuelve precio, cantidad y frecuencia del pack por su índice.
        setBusy(true, "Abriendo el checkout…");
        window.location.href = API_BASE + "/#/checkout?merchant=" + encodeURIComponent(MERCHANT_ID) +
          "&plan=" + encodeURIComponent(plan.id) + "&pack=" + encodeURIComponent(state.idx) +
          (variantId ? "&variant=" + encodeURIComponent(variantId) : "") + fbCheckoutQs();
      }
      function addToCart() {
        // La del selector primero: si el cliente cambió de sabor, va ese.
        var vid = variantId || plan.shopify_variant_id;
        if (!vid) { showErr("No pudimos identificar la variante. Recargá la página."); return; }
        // Tiendanube no tiene /cart/add.js: agregamos con el MISMO POST que usa el
        // formulario del tema (/comprar/ con add_to_cart + quantity). Cae en la
        // página del carrito con el pack cargado, igual que el botón nativo cuando
        // el tema no usa carrito AJAX.
        if (IS_TN) {
          setBusy(true, "Agregando al carrito…");
          var f = document.createElement("form");
          f.method = "post"; f.action = "/comprar/"; f.style.display = "none";
          [["add_to_cart", String(vid)], ["quantity", String(packQty())]].forEach(function (kv) {
            var i = document.createElement("input"); i.type = "hidden"; i.name = kv[0]; i.value = kv[1]; f.appendChild(i);
          });
          document.body.appendChild(f);
          f.submit();
          return;
        }
        var rootPath = (window.Shopify && Shopify.routes && Shopify.routes.root) || "/";
        setBusy(true, "Agregando al carrito…");
        fetch(rootPath + "cart/add.js", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json" },
          body: JSON.stringify({ items: [{ id: parseInt(vid, 10) || vid, quantity: packQty() }] }),
        }).then(function(r){
          if (!r.ok) throw new Error("cart/add " + r.status);
          window.location.href = rootPath + "cart";
        }).catch(function(e){
          log("cart/add falló", e);
          setBusy(false);
          showErr("No pudimos agregar el pack al carrito. Probá de nuevo.");
        });
      }
      function handle(el) {
        // Un click puede tocar varias acciones anidadas (ej. la celda "sub"
        // dentro de la fila del pack en la variante Tabla): se aplican todas.
        var changed = false, cta = false, lastAct = "";
        for (var n = el; n && n !== root; n = n.parentNode) {
          var act = n.getAttribute && n.getAttribute("data-rc-action");
          if (!act) continue;
          var v = n.getAttribute("data-rc-value");
          if (act === "pack") {
            var i = parseInt(v, 10);
            if (i >= 0 && bundle.states[state.mode + ":" + i] !== undefined && i !== state.idx) { state.idx = i; changed = true; }
            lastAct = lastAct || act;
          } else if (act === "mode") {
            if ((v === "sub" || v === "once") && v !== state.mode) { state.mode = v; changed = true; }
            lastAct = lastAct || act;
          } else if (act === "cta") {
            cta = true;
          }
        }
        if (changed) {
          paint();
          applyMode();
          if (viaKeyboard) {
            var f = root.querySelector('[data-rc-action="' + lastAct + '"][aria-checked="true"]');
            if (f && f.focus) f.focus();
          }
        }
        if (cta) { if (state.mode === "sub") goCheckout(); else addToCart(); }
      }
      root.addEventListener("click", function(e){
        var el = e.target && e.target.closest ? e.target.closest("[data-rc-action]") : null;
        if (!el || !root.contains(el)) return;
        viaKeyboard = false;
        handle(el);
      });
      root.addEventListener("keydown", function(e){
        if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
        var el = e.target && e.target.closest ? e.target.closest("[data-rc-action]") : null;
        if (!el || el.tagName === "BUTTON") return; // los <button> ya disparan click
        e.preventDefault();
        viaKeyboard = true;
        handle(el);
      });
      // bfcache: al volver con "atrás" el botón puede quedar en "Agregando…".
      window.addEventListener("pageshow", function(){ setBusy(false); });

      paint();
      applyMode();

      // Cambio de variante en vivo → nuevo plan (con o sin packs).
      var idInput = form ? form.querySelector('input[name="id"]') : null;
      if (idInput) {
        var obs = new MutationObserver(function(){
          var nv = idInput.value;
          if (!nv || nv === variantId) return;
          variantId = nv;
          fetchPlan(productId, nv).then(function(d2){
            if (!d2 || !d2.plan) { restoreTheme("variante sin plan"); return; }
            plan = d2.plan;
            if (!planHasPacks(plan)) { restoreTheme("variante sin packs"); log("variante sin packs — el widget clásico no se monta en caliente"); return; }
            fetchBundle(plan.id).then(function(b2){
              if (!b2 || !b2.bundle) { restoreTheme("variante sin bundle"); return; }
              bundle = b2.bundle;
              styleEl.textContent = bundle.css || "";
              state = { mode: state.mode, idx: parseInt(bundle.defaultIdx, 10) || 0 };
              host.style.display = "";
              paint();
              applyMode();
            });
          });
        });
        obs.observe(idInput, { attributes: true, attributeFilter: ["value"] });
      }
      log("Bundle montado — plan", plan.id, "variante", bundle.variant, "packs", (bundle.packs || []).length);
    }

    fetchPlan(productId, variantId).then(guarded(function(d){
      if (d.error || !d.plan) { log("Sin plan para producto", productId, d); if (VERIFY) report("no_plan", { product: productId }); return; }
      var plan = d.plan;

      // Plan por PACKS → selector de packs precalculado en el server. Si por
      // algún motivo no hay bundle renderizable, cae al widget clásico.
      if (planHasPacks(plan)) {
        fetchBundle(plan.id).then(function(b){
          if (b && b.bundle && b.bundle.states) { guarded(mountBundle, "packs")(plan, b.bundle); return; }
          log("Plan con packs pero sin bundle renderizable — fallback al widget clásico", b);
          guarded(mountLegacy, "clasico")(plan);
        });
        return;
      }
      guarded(mountLegacy, "clasico")(plan);

      // ─── Widget clásico (plan "theme": dos cards + panel de suscripción) ───
      function mountLegacy(plan) {
      var widget = buildWidget(plan);
      var subPanel = buildSubscribePanel(plan);
      widget.setAttribute("data-rec-root", "1"); subPanel.setAttribute("data-rec-root", "1");
      if (mountPoint) {
        mountPoint.appendChild(widget);
        mountPoint.appendChild(subPanel);
      } else if (hideAnchor && hideAnchor.parentNode) {
        // Arriba del buy box custom: subPanel primero, después el toggle, así
        // quedan en orden [toggle] → [panel de suscripción] → [bundle].
        hideAnchor.parentNode.insertBefore(subPanel, hideAnchor);
        hideAnchor.parentNode.insertBefore(widget, subPanel);
      } else {
        form.parentNode.insertBefore(widget, form);
        form.parentNode.insertBefore(subPanel, form);
      }
      watchVisible(widget, { product: productId, plan: plan.id, mode: "legacy" });

      // Autofill con datos del cliente Shopify si está logueado.
      var customer = detectShopifyCustomer();
      if (customer.email) {
        var emailField = subPanel.querySelector("#rec-email");
        if (emailField) emailField.value = customer.email;
      }
      if (customer.name) {
        var nameField = subPanel.querySelector("#rec-name");
        if (nameField) nameField.value = customer.name;
      }

      // Estado inicial: usa MODE_DEFAULT del merchant ("sub" o "once").
      // Si default = sub, mostramos directamente el panel de suscripción
      // (oculta el form de compra). Si default = once, queda como compra
      // normal y el cliente puede cambiar al toggle de sub.
      if (MODE_DEFAULT === "sub") {
        setSubMode(true, form, widget, subPanel);
      }

      widget.addEventListener("change", function(e){
        if (e.target.name === "recurrentes-mode") {
          setSubMode(e.target.value === "sub", form, widget, subPanel);
        }
      });

      subPanel.querySelector("#recurrentes-subscribe-btn").addEventListener("click", function(){
        {
          // Modo checkout ON-STORE: el botón lleva a la PÁGINA de Shopify del
          // merchant (misma tienda), con producto/variante/cantidad. Esa página
          // tiene el embed (?view=checkout) que junta datos + envíos reales por
          // CP de Shopify y va a MP. Igual que Puentify (/pages/suscripcion-form).
          var qEl = subPanel.querySelector("#rec-qty");
          var q = parseInt(qEl ? qEl.value : (subPanel.dataset.qty || 1)) || 1;
          // Un solo checkout para todas las tiendas: el de Recurrentes (Thiago,
          // 16-sept). La página on-store de Shopify (/pages/suscripcion-form) deja
          // de usarse: menos pasos de instalación y una sola experiencia que
          // mantenemos nosotros (envíos en vivo, marca, etc.).
          window.location.href = API_BASE + "/#/checkout?merchant=" + encodeURIComponent(MERCHANT_ID) +
            "&plan=" + encodeURIComponent(plan.id) +
            "&qty=" + q +
            "&freq_days=" + encodeURIComponent(plan.frequency_days || 30) +
            // La del SELECTOR primero (22-sept): un plan cubre todas las
            // variantes del producto, así que el que elige frutilla se lleva
            // frutilla. La del plan queda de respaldo.
            "&variant=" + encodeURIComponent(variantId || plan.shopify_variant_id || "") + fbCheckoutQs();
          return;
        }
        startSubscribe(plan, subPanel);
      });

      // Si el cliente cambia variante (Pequeña ↔ Grande), refrescamos el plan
      // para reflejar el precio correcto. Usamos MutationObserver sobre el
      // input hidden id del form.
      var idInput = form.querySelector('input[name="id"]');
      if (idInput) {
        var observer = new MutationObserver(function(){
          var newVariant = idInput.value;
          if (newVariant && newVariant !== variantId) {
            variantId = newVariant;
            log("variante cambió a", newVariant, "— refrescando plan");
            // Re-fetch + actualizar precio en panel. Si no hay plan para la
            // nueva variante, ocultamos todo el widget.
            fetchPlan(productId, newVariant).then(function(d2){
              if (!d2 || !d2.plan) {
                widget.style.display = "none";
                subPanel.style.display = "none";
                setSubMode(false, form, widget, subPanel);
                return;
              }
              widget.style.display = "block";
              // Actualizar precios en el panel
              var newPlan = d2.plan;
              var btn = subPanel.querySelector("#recurrentes-subscribe-btn");
              if (btn) btn.textContent = "Suscribirme — $" + (newPlan.subscription_price_ars||0).toLocaleString("es-AR") + " cada " + newPlan.frequency_days + " días";
              plan = newPlan;
            });
          }
        });
        observer.observe(idInput, { attributes: true, attributeFilter: ["value"] });
        // Algunos themes setean value via JS sin disparar mutation — escuchamos change también
        idInput.addEventListener("change", function(){
          var newVariant = idInput.value;
          if (newVariant !== variantId) {
            observer.takeRecords();
            variantId = newVariant;
          }
        });
      }

      log("Widget montado — producto", productId, "variante", variantId, "plan", plan.id);
      } // mountLegacy
    }, "plan")).catch(function (e) { log("fetchPlan:", e && e.message); restoreTheme("fetchPlan"); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", guarded(init, "init"));
  } else {
    guarded(init, "init")();
  }
})();`;

  return res.send(script);
}

// ─────────────────────────────────────────────────────────────────────────
// CHECKOUT ON-STORE — se sirve con ?view=checkout. El merchant crea una página
// en Shopify (ej. /pages/suscripcion-form) y pega:
//   <div id="recurrentes-checkout"></div>
//   <script src="https://<recurrentes>/api/widget?merchant=<uid>&view=checkout"></script>
// El widget del producto redirige a esa página con ?product=&variant=&qty=.
// Como corre en el dominio de la tienda, usa /cart/shipping_rates.json para
// traer los envíos REALES por CP (los mismos del checkout normal) y termina en MP.
// ─────────────────────────────────────────────────────────────────────────
// ── WhatsApp: casilla de opt-in (solo si la tienda tiene WhatsApp prendido) ──
// Fragmentos que se INSERTAN en el JS servido; con waOptin=false no se inserta nada.
// Sin comillas simples ni barras: van dentro de strings '…' del JS del widget.
export const WA_OPTIN_LABEL = "Quiero que me manden notificaciones de mi pedido por email y WhatsApp";
export function waOptinHtml(color, prefix) {
  const c = /^#[0-9a-fA-F]{6}$/.test(String(color || "")) ? color : "#10b981";
  return `<label id="${prefix}-wa-optin-row" style="display:flex;align-items:flex-start;gap:8px;font-size:13px;color:#374151;margin:10px 0 12px;cursor:pointer;line-height:1.4;"><input id="${prefix}-wa-optin" type="checkbox" checked style="width:18px;height:18px;margin:1px 0 0;flex-shrink:0;accent-color:${c};"/><span>${WA_OPTIN_LABEL}</span></label>`;
}
export const waOptinBodyJs = (prefix) => ` whatsapp_optin: (function(){ var c = document.getElementById("${prefix}-wa-optin"); return c ? !!c.checked : true; })(),`;
// Exactamente lo que se inserta en cada vista (lo usan los tests para comprobar que,
// sacando estos fragmentos, el JS es el mismo que sin WhatsApp).
export function waOptinSnippets(color) {
  return {
    product: [waOptinHtml(color, "rec"), waOptinBodyJs("rec")],
    checkout: [` + '${waOptinHtml(color, "rc")}'`, waOptinBodyJs("rc")],
  };
}

function buildCheckoutEmbed({ merchantId, apiBase, color, shippingRates, waOptin = false, liveQuotes = false }) {
  return `(function(){
  "use strict";
  var MERCHANT_ID = ${JSON.stringify(merchantId)};
  var API_BASE = ${JSON.stringify(apiBase)};
  var COL = ${JSON.stringify(color || "#10b981")};
  var SHIPPING_RATES = ${JSON.stringify(Array.isArray(shippingRates) ? shippingRates : [])};
  var LIVE_QUOTES = ${liveQuotes ? "true" : "false"};
  var PLAN_RATE_CODE = ${JSON.stringify(PLAN_SHIPPING_CODE)};
  if (!MERCHANT_ID) { console.error("[Recurrentes checkout] falta ?merchant en el <script>"); return; }

  var q = new URLSearchParams(window.location.search);
  var PRODUCT = q.get("product") || q.get("product_id") || "";
  var VARIANT = q.get("variant") || q.get("variant_id") || "";
  var QTY = Math.max(1, Math.min(10, parseInt(q.get("qty") || q.get("quantity") || "1", 10) || 1));
  // Frecuencia efectiva (días). El bundle la manda ya calculada (ej. "N potes cada
  // N×2 meses" → freq_days = 60·qty). Si viene freq_value/freq_type los convierte.
  var FREQ_DAYS = (function(){
    var d = parseInt(q.get("freq_days") || "", 10);
    if (d >= 1 && d <= 365) return d;
    var v = parseInt(q.get("freq_value") || "", 10), t = q.get("freq_type") || "";
    if (v >= 1) { if (t === "months") return v * 30; if (t === "days") return v; if (t === "weeks") return v * 7; }
    return 0; // 0 = usar la del plan
  })();
  // Precio del PACK (compra única) y % de descuento de suscripción — el bundle los
  // manda para cobrar pack × (1 − descuento). Descuento fijo por bundle.
  var BASE = Math.round(parseFloat(q.get("base") || "0")) || 0;
  var SUB_OFF = (function(){ var d = parseFloat(q.get("sub_off")); return (isFinite(d) && d >= 0 && d <= 90) ? d : null; })();
  // PACKS: ?plan=<id>&pack=<idx> (widget de packs). El resumen sale del pack del
  // plan (NO se leen base/sub_off/qty/freq_days de la URL) y el init recibe
  // { plan_id, pack_index }; el server toma precio/qty/frecuencia del pack.
  var PLAN_ID = (q.get("plan") || "").trim();
  var PACK_IDX = (function(){ var s = (q.get("pack") || "").trim(); return /^\\d{1,3}$/.test(s) ? parseInt(s, 10) : -1; })();
  var PACK_MODE = !!(PLAN_ID && PACK_IDX >= 0);
  var PACK = null; // pack resuelto cuando llega el plan: { qty, priceOnce, priceSub, freqDays, label }
  // Misma fórmula que el server (shared/bundle/viewmodel.js), inyectada tal cual.
  var resolvePack = ${resolvePack.toString()};
  var freqLabel = ${freqLabel.toString()};
  var fmtARS = ${fmtARS.toString()};
  // Cupón de recupero firmado (?rc=<token>) que traen los mails de abandono. El
  // server lo verifica; acá sólo lo reenviamos y leemos el email del payload para
  // prellenar (tiene que coincidir con el del checkout).
  var RC_TOKEN = q.get("rc") || "";
  var RC_EMAIL = (function(){
    try { var p = RC_TOKEN.split(".")[0]; if (!p) return ""; var j = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); return String(j.e || ""); } catch (e) { return ""; }
  })();

  var mount = document.getElementById("recurrentes-checkout");
  if (!mount) { mount = document.createElement("div"); mount.id = "recurrentes-checkout"; document.body.appendChild(mount); }

  var plan = null, rateIdx = 0, submitting = false, ratesMsg = "";
  var RC_DISC = { code: "", pct: 0 }; // código de descuento aplicado (ej. HOLA5 → 5)
  // Código que viene dentro del token de recupero (payload.c), sólo para mostrarlo.
  var RC_DISC_RC_CODE = (function(){
    try { var p = RC_TOKEN.split(".")[0]; if (!p) return ""; var j = JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))); return String(j.c || "").toUpperCase(); } catch (e) { return ""; }
  })();
  // Meta "InitiateCheckout" (pago iniciado): se dispara UNA vez, apenas carga el
  // checkout (no al tocar Pagar), con el Pixel del navegador de la tienda.
  var _icFired = false;
  function fireIC(){
    if (_icFired) return; _icFired = true;
    try { var p = prices(); if (window.fbq) window.fbq("track", "InitiateCheckout", { value: p.total || 0, currency: "ARS", num_items: QTY }); } catch(e){}
  }
  // ENVÍOS FIJOS para la suscripción: los configura el merchant
  // (checkout_shipping_rates) o el default histórico (merchants legacy). Si el
  // merchant no tiene lista, la única opción es el ENVÍO DEL PLAN (code PLAN:
  // shipping_price_ars, gratis desde free_shipping_from_ars). El server sólo
  // acepta el nombre/code y toma el precio de SU lista / del plan (nunca del navegador).
  // Con cotización en vivo no mostramos los envíos fijos ni un segundo: hasta que el
  // cliente cargue C.P. y provincia, el bloque explica qué falta.
  var rates = LIVE_QUOTES ? [] : SHIPPING_RATES;
  if (LIVE_QUOTES) ratesMsg = "Completá C.P. y provincia para ver los envíos disponibles.";
  function planRate(){ return { name: (plan && plan.shipping_method_name) || "Envío a domicilio", price: (plan && plan.shipping_price_ars) || 0, code: PLAN_RATE_CODE }; }
  // Precio efectivo de una tarifa para un subtotal dado (la del plan respeta "gratis desde $X").
  function ratePrice(rt, subtotal){
    if (rt && rt.code === PLAN_RATE_CODE && plan) {
      var freeFrom = parseFloat(plan.free_shipping_from_ars) || 0;
      return (freeFrom > 0 && subtotal >= freeFrom) ? 0 : (Number(rt.price) || 0);
    }
    return Number(rt && rt.price) || 0;
  }
  var sumOpen = !(typeof window !== "undefined" && window.innerWidth < 760);  // resumen: abierto en desktop, colapsado en mobile

  function money(n){ return "$" + Math.round(Number(n) || 0).toLocaleString("es-AR"); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","'":"&#39;"}[c]; }); }
  function val(id){ var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  // Atribución de Meta: cookies _fbp/_fbc (o fbclid de la URL) para que el evento
  // InitiateCheckout + Purchase se atribuyan al anuncio correcto.
  function fbData(){
    function ck(n){ var m = document.cookie.match(new RegExp("(^|;\\\\s*)" + n + "=([^;]+)")); return m ? decodeURIComponent(m[2]) : ""; }
    var fbp = ck("_fbp"), fbc = ck("_fbc");
    if (!fbc) { try { var f = new URLSearchParams(window.location.search).get("fbclid"); if (f) fbc = "fb.1." + Date.now() + "." + f; } catch(e){} }
    return { fbp: fbp, fbc: fbc, event_source_url: window.location.href, user_agent: navigator.userAgent };
  }
  // Error por campo estilo Shopify: borde rojo + mensaje debajo del input.
  function setBad(id, msg){ var el = document.getElementById(id), e = document.getElementById(id + "-e"); if (el) { el.style.borderColor = "#d33"; el.style.boxShadow = "0 0 0 2px rgba(221,51,51,.12)"; } if (e) { e.textContent = msg; e.style.display = "block"; } }
  function clrBad(id){ var el = document.getElementById(id), e = document.getElementById(id + "-e"); if (el) { el.style.borderColor = "#d6d6d8"; el.style.boxShadow = "none"; } if (e) { e.style.display = "none"; } }
  var RC_FIELDS = ["rc-email","rc-name","rc-last","rc-tax","rc-phone","rc-addr","rc-city","rc-prov","rc-zip"];
  function errBox(msg){ return '<div style="max-width:420px;margin:60px auto;text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif;"><div style="font-size:15px;font-weight:700;margin-bottom:8px;">Ups</div><div style="font-size:13px;color:#666;line-height:1.5;">' + esc(msg) + '</div></div>'; }

  function prices(){
    if (!plan) return { subtotal:0, disc:0, ship:0, shipName:"", total:0, loading:true };
    var disc, subtotal;
    if (PACK) {
      // Pack del plan: precio de suscripción del pack, tal cual lo define el
      // merchant (el server cobra lo mismo desde el plan, no desde acá).
      subtotal = PACK.priceSub;
      disc = PACK.priceOnce > 0 && PACK.priceSub < PACK.priceOnce ? Math.round((1 - PACK.priceSub / PACK.priceOnce) * 100) : 0;
    } else if (BASE > 0) {
      // Bundle con descuento fijo: cobra pack × (1 − descuento). El descuento
      // nunca supera el del plan (mismo tope que aplica el server).
      var maxOff = Math.max(0, Math.min(90, parseFloat(plan.discount_pct) || 0));
      disc = (SUB_OFF != null) ? Math.min(SUB_OFF, maxOff) : maxOff;
      subtotal = Math.round(BASE * (1 - disc / 100));
    } else {
      var unit = plan.subscription_price_ars || 0;
      var tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
      disc = 0; var bestMin = -1; for (var i=0;i<tiers.length;i++){ var mq = parseInt(tiers[i].min_qty)||0; if (QTY >= mq && mq > bestMin) { bestMin = mq; disc = parseFloat(tiers[i].discount_pct)||0; } }
      subtotal = Math.round(unit * QTY * (1 - disc/100));
    }
    // Código de descuento (ej. HOLA5): se aplica sobre el subtotal del producto.
    var codeOff = 0;
    if (RC_DISC.pct > 0) { codeOff = Math.round(subtotal * RC_DISC.pct / 100); subtotal = subtotal - codeOff; }
    var sel = rates[rateIdx] || planRate();
    var shipCost = ratePrice(sel, subtotal);
    return { subtotal: subtotal, disc: disc, codeOff: codeOff, codePct: RC_DISC.pct, code: RC_DISC.code, ship: shipCost, shipName: sel.name, total: subtotal + shipCost };
  }
  // Días hábiles (lun-vie) entre hoy y una fecha ISO — para el "X a Y días hábiles".
  function bizDaysUntil(iso){
    var target = new Date(iso); target.setHours(0,0,0,0);
    var d = new Date(); d.setHours(0,0,0,0);
    var n = 0, guard = 0;
    while (d < target && guard < 400) { d.setDate(d.getDate() + 1); var g = d.getDay(); if (g !== 0 && g !== 6) n++; guard++; }
    return n;
  }
  // Fallback del tiempo de envío: lo saca del NOMBRE de la tarifa. Sirve para las
  // tarifas planas (Flex, prioritario) que la API AJAX no devuelve con delivery_range
  // pero que suelen tener el tiempo en el nombre ("24/48hs", "1 a 4 días", etc.).
  function etaFromName(nm){
    var s = String(nm || "").toLowerCase();
    var m = s.match(/(\\d+)\\s*[a\\/\\-]\\s*(\\d+)\\s*(hs?|horas?|d[ií]as?)/);
    if (m) return m[1] + " a " + m[2] + " " + (/h/.test(m[3]) ? "hs" : "días hábiles");
    m = s.match(/(\\d+)\\s*(hs?|horas?|d[ií]as?)\\b/);
    if (m) return m[1] + " " + (/h/.test(m[2]) ? "hs" : "días hábiles");
    return "";
  }
  // Frecuencia efectiva: la de la URL sólo si el plan permite frecuencia custom o
  // coincide con la del plan (misma regla que el server).
  function effFreqDays(){
    if (PACK) return PACK.freqDays;
    var pf = parseInt(plan.frequency_days, 10) || 30;
    if (FREQ_DAYS >= 1 && (plan.allow_custom_frequency === true || FREQ_DAYS === pf)) return FREQ_DAYS;
    if (FREQ_DAYS >= 1 && FREQ_DAYS % pf === 0 && FREQ_DAYS / pf <= 12) return FREQ_DAYS; // múltiplo (pack N)
    return pf;
  }
  function freqTxt(){ var d = effFreqDays(); if (PACK) { var fl = freqLabel(d); return "cada " + (fl || (d + " días")); } if (d===30) return "mensual"; if (d===60) return "cada 2 meses"; if (d===90) return "cada 3 meses"; if (d % 30 === 0) return "cada " + (d/30) + " meses"; return "cada " + d + " días"; }

  // Traer envíos reales de Shopify por CP. Corre en el dominio de la tienda:
  // agrega la variante al carrito, pide las tarifas, y saca la variante que
  // agregó (deja el carrito como estaba). Si falla, cae al envío del plan.
  var rateTimer = null;
  function fetchRates(){
    var zip = val("rc-zip"), prov = val("rc-prov"), city = val("rc-city");
    if (!zip || !prov) { ratesMsg = "Completá C.P. y provincia para ver el envío."; renderRates(); return; }
    ratesMsg = "Buscando opciones de envío…"; renderRates();
    var addr = "shipping_address%5Bzip%5D=" + encodeURIComponent(zip) + "&shipping_address%5Bcountry%5D=Argentina&shipping_address%5Bprovince%5D=" + encodeURIComponent(prov) + "&shipping_address%5Bcity%5D=" + encodeURIComponent(city);
    var addBody = JSON.stringify({ items: [{ id: parseInt(VARIANT,10), quantity: QTY }] });
    var doFetch = function(){
      return fetch("/cart/shipping_rates.json?" + addr).then(function(r){ return r.json(); });
    };
    fetch("/cart/add.js", { method:"POST", headers:{"Content-Type":"application/json"}, body: addBody })
      .then(doFetch)
      .then(function(d){
        var list = (d.shipping_rates || []).map(function(sr){
          // Tiempo de entrega estimado (como en el checkout de Shopify): lo calcula
          // desde delivery_range (rango de fechas del carrier) en días hábiles.
          var eta = "";
          var r = sr.delivery_range;
          if (Object.prototype.toString.call(r) === "[object Array]" && r.length >= 2 && r[0] && r[1]) {
            try {
              var lo = bizDaysUntil(r[0]), hi = bizDaysUntil(r[1]);
              if (hi < lo) { var t = lo; lo = hi; hi = t; }
              if (lo >= 1) eta = (lo === hi) ? (lo + " días hábiles") : (lo + " a " + hi + " días hábiles");
            } catch (e) {}
          }
          var nm = sr.presentment_name || sr.name;
          if (!eta) eta = etaFromName(nm);  // fallback: tiempo dentro del nombre (Flex, etc.)
          // Guardamos también el CODE real de la tarifa: las apps de envío (Envialo,
          // etc.) matchean el método/sucursal por ese code + nombre exacto.
          return { name: nm, price: parseFloat(sr.price) || 0, eta: eta, code: sr.code || "" };
        });
        rates = list.length ? list : [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }];
        rateIdx = 0; ratesMsg = "";
        // sacar la variante que agregamos (no queremos tocar el carrito real)
        fetch("/cart/change.js", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: parseInt(VARIANT,10), quantity: 0 }) }).catch(function(){});
        renderRates(); renderSummary();
      })
      .catch(function(){ rates = [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }]; rateIdx = 0; ratesMsg = ""; renderRates(); renderSummary(); });
  }
  // Cotización en vivo (Configuración → Shopify → Ajustes): le pedimos a nuestra
  // API los envíos reales de la tienda para esta dirección. Devuelve las opciones
  // del proveedor (Envialo, Andreani…) con su code/source —las que la app de envíos
  // sabe despachar, sucursales incluidas— más las tarifas manuales del comerciante.
  // Sin la bandera, quedan los envíos fijos de siempre (SHIPPING_RATES).
  function fetchLiveRates(){
    var zip = val("rc-zip"), prov = val("rc-prov"), city = val("rc-city"), addr1 = val("rc-addr1") || val("rc-address1") || "";
    if (!zip || !prov) { ratesMsg = "Completá C.P. y provincia para ver los envíos disponibles."; renderRates(); renderSummary(); return; }
    ratesMsg = "Buscando opciones de envío…"; renderRates();
    var u = API_BASE + "/api/shopify?action=shipping-rates&merchant=" + encodeURIComponent(MERCHANT_ID)
      + "&variant=" + encodeURIComponent(VARIANT) + "&qty=" + encodeURIComponent(QTY)
      + "&zip=" + encodeURIComponent(zip) + "&city=" + encodeURIComponent(city) + "&province=" + encodeURIComponent(prov)
      + "&address1=" + encodeURIComponent(addr1) + "&subtotal=" + encodeURIComponent(plan ? prices().subtotal : 0);
    fetch(u).then(function(r){ return r.json(); }).then(function(d){
      var list = (d && d.rates ? d.rates : []).map(function(rt){
        return { name: rt.name, price: Number(rt.price) || 0, eta: etaFromName(rt.name), code: rt.code || "", source: rt.source || "" };
      });
      if (!list.length) list = SHIPPING_RATES.length ? SHIPPING_RATES.slice() : [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }];
      rates = list; rateIdx = 0; ratesMsg = "";
      renderRates(); renderSummary();
    }).catch(function(){
      rates = SHIPPING_RATES.length ? SHIPPING_RATES.slice() : [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }];
      rateIdx = 0; ratesMsg = ""; renderRates(); renderSummary();
    });
  }
  function onAddrChange(){
    if (!LIVE_QUOTES) return; // envíos fijos: no se re-consulta
    clearTimeout(rateTimer);
    rateTimer = setTimeout(fetchLiveRates, 400);
  }

  function renderRates(){
    var box = document.getElementById("rc-rates"); if (!box) return;
    if (ratesMsg) {
      // Mientras cotizamos, un spinner al lado del texto (misma animación que el resumen).
      var spin = /^Buscando/.test(ratesMsg) ? '<span style="width:14px;height:14px;border:2px solid #e3e3e5;border-top-color:' + COL + ';border-radius:50%;display:inline-block;flex-shrink:0;animation:rc-spin .7s linear infinite;"></span>' : '';
      box.innerHTML = '<div style="display:flex;align-items:center;gap:9px;font-size:13px;color:#888;padding:10px 0;">' + spin + '<span>' + esc(ratesMsg) + '</span></div>';
      return;
    }
    var curSub = plan ? prices().subtotal : 0;
    box.innerHTML = rates.map(function(rt,i){
      var shown = ratePrice(rt, curSub);
      var free = shown === 0;
      return '<label style="display:flex;align-items:flex-start;gap:10px;padding:11px 13px;border:1.5px solid ' + (i===rateIdx?COL:"#e0e0e2") + ';border-radius:10px;cursor:pointer;margin-bottom:8px;background:' + (i===rateIdx?(COL+"0d"):"#fff") + ';">'
        + '<input type="radio" name="rc-rate" ' + (i===rateIdx?"checked":"") + ' data-i="' + i + '" style="accent-color:' + COL + ';margin-top:2px;"/>'
        + '<span style="flex:1;min-width:0;"><span style="display:block;font-size:13px;font-weight:500;line-height:1.35;">' + esc(rt.name) + '</span>'
        + (rt.eta ? '<span style="display:block;font-size:11.5px;color:#888;margin-top:2px;">' + esc(rt.eta) + '</span>' : '') + '</span>'
        + '<b style="font-size:13px;color:' + (free?"#0a8a3f":"#1a1a1a") + ';white-space:nowrap;">' + (free?"Gratis":money(shown)) + '</b></label>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll('input[name="rc-rate"]'), function(inp){
      inp.addEventListener("change", function(){ rateIdx = parseInt(inp.getAttribute("data-i"),10)||0; renderRates(); renderSummary(); });
    });
  }
  function renderSummary(){
    var el = document.getElementById("rc-summary"); if (!el) return;
    // Plan todavía cargando → spinner en lugar de precios vacíos.
    if (!plan) { el.innerHTML = '<div style="display:flex;align-items:center;gap:10px;font-size:13px;color:#888;padding:6px 2px;"><span style="width:16px;height:16px;border:2px solid #e3e3e5;border-top-color:' + COL + ';border-radius:50%;display:inline-block;animation:rc-spin .7s linear infinite;"></span>Cargando resumen del pedido…</div>'; return; }
    var p = prices();
    var body =
      '<div style="display:flex;gap:12px;align-items:center;margin:14px 0;">'
      + '<div style="min-width:0;"><div style="font-size:10px;font-weight:800;color:' + COL + ';text-transform:uppercase;letter-spacing:.5px;">Suscripción · ' + esc(freqTxt()) + '</div>'
      + '<div style="font-size:14px;font-weight:700;line-height:1.3;">' + (PACK && PACK.label ? esc(PACK.label) + ' · ' : '') + esc(plan.product_title) + ' × ' + QTY + '</div>'
      + (PACK && PACK.priceOnce > PACK.priceSub ? '<div style="font-size:11.5px;color:#888;margin-top:2px;">Precio del pack ' + esc(fmtARS(PACK.priceOnce)) + ' · con suscripción ' + esc(fmtARS(PACK.priceSub)) + '</div>' : '')
      + '</div></div>'
      + '<div style="border-top:1px solid #eee;padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;">'
      + '<div style="display:flex;justify-content:space-between;"><span style="color:#666;">Subtotal' + (p.disc>0?(" (−"+p.disc+"%)"):"") + '</span><b>' + money(p.subtotal + (p.codeOff||0)) + '</b></div>'
      + ((p.codeOff||0) > 0 ? '<div style="display:flex;justify-content:space-between;"><span style="color:#0a8a3f;">Código ' + esc(p.code) + ' (−' + p.codePct + '%)</span><b style="color:#0a8a3f;">−' + money(p.codeOff) + '</b></div>' : '')
      + '<div style="display:flex;justify-content:space-between;"><span style="color:#666;">Envío' + (p.shipName?(" · "+esc(p.shipName)):"") + '</span><b>' + (p.ship===0?"Gratis":money(p.ship)) + '</b></div>'
      + '<div style="display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:10px;font-size:15px;"><b>Total ' + esc(freqTxt()) + '</b><b>' + money(p.total) + '</b></div></div>'
      + '<div style="margin-top:12px;font-size:11px;color:#888;line-height:1.5;">Se cobra ' + money(p.total) + ' ahora y se renueva automáticamente ' + esc(freqTxt()) + '. Cancelás cuando quieras.</div>';
    el.innerHTML =
      '<button id="rc-sum-head" type="button" style="width:100%;display:flex;align-items:center;gap:9px;background:none;border:none;padding:0;cursor:pointer;font-family:inherit;color:#1a1a1a;text-align:left;">'
      + '<span style="transition:transform .2s;transform:rotate(' + (sumOpen?90:0) + 'deg);font-size:11px;color:#999;">▶</span>'
      + '<span style="font-size:13px;font-weight:700;flex:1;">' + (sumOpen ? "Ocultar resumen" : "Mostrar resumen del pedido") + '</span>'
      + '<b style="font-size:15px;">' + money(p.total) + '</b></button>'
      + '<div style="display:' + (sumOpen?"block":"none") + ';">' + body + '</div>';
    var head = document.getElementById("rc-sum-head");
    if (head) head.addEventListener("click", function(){ sumOpen = !sumOpen; renderSummary(); });
  }

  // Valida un código de descuento contra la cuenta del comerciante y lo aplica.
  function applyDiscount(){
    var el = document.getElementById("rc-disc"), msg = document.getElementById("rc-disc-msg");
    var code = ((el && el.value) || "").trim().toUpperCase();
    if (!code) return;
    var btn = document.getElementById("rc-disc-btn"); if (btn){ btn.disabled = true; btn.textContent = "…"; }
    // Si el código es el del token de recupero, validamos con rc (los códigos
    // recovery_only sólo se aceptan así). Si el cliente tipea otro, va en claro.
    var useRc = RC_TOKEN && RC_DISC_RC_CODE && code === RC_DISC_RC_CODE;
    fetch(API_BASE + "/api/public?action=discount&merchant=" + encodeURIComponent(MERCHANT_ID) + (useRc ? "&rc=" + encodeURIComponent(RC_TOKEN) : "&code=" + encodeURIComponent(code)))
      .then(function(r){ return r.json(); })
      .then(function(d){
        if (btn){ btn.disabled = false; btn.textContent = "Aplicar"; }
        if (d && d.valid && (d.type || "percent") === "percent" && Number(d.value) > 0) {
          RC_DISC = { code: String(d.code || code), pct: Number(d.value) || 0, rc: !!useRc };
          if (msg){ msg.style.display = "block"; msg.style.color = "#0a8a3f"; msg.textContent = "✓ Código " + RC_DISC.code + " aplicado — " + d.value + "% OFF"; }
        } else {
          RC_DISC = { code: "", pct: 0 };
          if (msg){ msg.style.display = "block"; msg.style.color = "#d33"; msg.textContent = "Código inválido o vencido."; }
        }
        renderSummary();
      })
      .catch(function(){ if (btn){ btn.disabled = false; btn.textContent = "Aplicar"; } if (msg){ msg.style.display = "block"; msg.style.color = "#d33"; msg.textContent = "No se pudo validar. Reintentá."; } });
  }

  // Captura de carrito abandonado ANTES de Pagar: apenas el cliente escribe un
  // email válido, avisamos al backend con lo que haya (mail + nombre/tel si están)
  // + el link de recupero (esta misma URL con el pack). Si después no paga, el
  // flujo de abandono lo agarra igual. No bloquea nada, es fire-and-forget.
  var LEAD_SIG = ""; // última firma enviada, para no repetir en cada blur
  function captureLead(){
    if (!plan) return;
    var email = val("rc-email");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    var name = (val("rc-name") + " " + val("rc-last")).trim();
    var phone = val("rc-phone");
    var sig = email + "|" + name + "|" + phone;
    if (sig === LEAD_SIG) return; // nada nuevo desde la última vez
    LEAD_SIG = sig;
    try {
      fetch(API_BASE + "/api/checkout/init", {
        method:"POST", headers:{"Content-Type":"application/json"}, keepalive:true,
        body: JSON.stringify({
          merchant_id: MERCHANT_ID, plan_id: plan.id, capture: true,
          pack_index: (PACK_MODE ? PACK_IDX : undefined),
          quantity: QTY, frequency_days: (PACK_MODE ? undefined : effFreqDays()), shopify_variant_id: VARIANT || undefined,
          base_price: (!PACK_MODE && BASE > 0 ? BASE : undefined), sub_discount: (!PACK_MODE && SUB_OFF != null ? SUB_OFF : undefined),
          rc_hp_9: val("rc-website"),
          fb: fbData(),
          customer: { email: email, name: name, phone: phone }
        })
      }).catch(function(){});
    } catch(e){}
  }

  function pagar(){
    if (!plan) return; // plan aún cargando — evitamos submit sin datos
    var box = document.getElementById("rc-err"); box.style.display = "none";
    RC_FIELDS.forEach(clrBad);
    var email = val("rc-email"), name = (val("rc-name") + " " + val("rc-last")).trim(), phone = val("rc-phone");
    var firstBad = null;
    function mark(id, msg){ setBad(id, msg); if (!firstBad) firstBad = id; }
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) mark("rc-email", "Introducí un correo electrónico válido");
    if (!val("rc-name")) mark("rc-name", "Introducí un nombre");
    if (!val("rc-last")) mark("rc-last", "Introducí un apellido");
    if (!val("rc-tax")) mark("rc-tax", "Introducí tu DNI / CUIL");
    if (!phone) mark("rc-phone", "Introducí un número de teléfono");
    if (!val("rc-addr")) mark("rc-addr", "Introducí una dirección");
    if (!val("rc-zip")) mark("rc-zip", "Introducí un código postal");
    if (!val("rc-city")) mark("rc-city", "Introducí una localidad");
    if (!val("rc-prov")) mark("rc-prov", "Elegí una provincia");
    if (firstBad) { var fe = document.getElementById(firstBad); if (fe) { if (fe.scrollIntoView) fe.scrollIntoView({ behavior: "smooth", block: "center" }); try { fe.focus(); } catch (e) {} } return; }
    if (submitting) return; submitting = true;
    var btn = document.getElementById("rc-pay"); if (btn){ btn.disabled = true; btn.textContent = "Redirigiendo a Mercado Pago…"; }
    var sel = rates[rateIdx] || planRate();
    fetch(API_BASE + "/api/checkout/init", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        merchant_id: MERCHANT_ID, plan_id: plan.id, quantity: QTY, frequency_days: (PACK_MODE ? undefined : effFreqDays()),
        pack_index: (PACK_MODE ? PACK_IDX : undefined),
        shopify_variant_id: VARIANT || undefined,
        base_price: (!PACK_MODE && BASE > 0 ? BASE : undefined), sub_discount: (!PACK_MODE && SUB_OFF != null ? SUB_OFF : undefined),
        discount_code: (RC_DISC.code || undefined),
        recovery_token: (RC_DISC.rc && RC_TOKEN) ? RC_TOKEN : undefined,
        rc_hp_9: val("rc-website"),
        fb: fbData(),${waOptin ? waOptinBodyJs("rc") : ""}
        customer: { email: email, name: name, phone: phone, tax_id: val("rc-tax") },
        shipping_address: {
          address1: val("rc-addr"), address2: val("rc-addr2"), city: val("rc-city"),
          province: val("rc-prov"), zip: val("rc-zip"), country: "Argentina",
          first_name: val("rc-name"), last_name: val("rc-last"), phone: phone
        },
        shipping_method: { name: sel.name, price: Number(sel.price) || 0, code: sel.code || "" }
      })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { box.textContent = d.error; box.style.display = "block"; submitting = false; if(btn){ btn.disabled=false; btn.textContent="Pagar"; } return; }
      window.location.href = d.init_point;
    }).catch(function(){ box.textContent = "No pudimos conectar con Mercado Pago. Reintentá."; box.style.display = "block"; submitting = false; if(btn){ btn.disabled=false; btn.textContent="Pagar"; } });
  }

  var PROV = ["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];

  function render(){
    // font-size 16px a propósito: iOS Safari hace zoom automático al enfocar un
    // input con letra <16px. Con 16px NO zoomea (y se ve bien igual en desktop).
    var inp = "width:100%;padding:11px 12px;font-size:16px;border:1px solid #d6d6d8;border-radius:9px;box-sizing:border-box;outline:none;background:#fff;font-family:inherit;";
    var card = "background:#fff;border:1px solid #e8e8ea;border-radius:14px;padding:20px;margin-bottom:16px;";
    var lbl = "font-size:12px;font-weight:600;color:#555;margin:0 0 5px;display:block;";
    var h = "font-size:15px;font-weight:700;margin:0 0 14px;";
    var eslot = function(id){ return '<div class="rc-e" id="' + id + '-e" style="display:none;color:#d33;font-size:11.5px;margin-top:4px;font-weight:600;"></div>'; };
    mount.innerHTML =
      '<div style="max-width:940px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">'
      + '<div class="rc-grid" style="display:grid;grid-template-columns:1fr 340px;gap:22px;align-items:start;">'
      + '<div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Contacto</h3>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Email</label><input id="rc-email" type="email" style="' + inp + '" placeholder="tu@email.com"/>' + eslot("rc-email") + '</div>'
          // Honeypot anti-bots: oculto, sin tab, sin autocompletar. Si viene lleno, el server lo ignora.
          + '<div style="position:absolute;left:-9999px;top:-9999px;height:0;overflow:hidden;" aria-hidden="true"><input id="rc-website" name="rc_hp_9" type="text" tabindex="-1" autocomplete="off" style="display:none;"/></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div><label style="' + lbl + '">Nombre</label><input id="rc-name" style="' + inp + '" placeholder="Juan"/>' + eslot("rc-name") + '</div><div><label style="' + lbl + '">Apellido</label><input id="rc-last" style="' + inp + '" placeholder="Pérez"/>' + eslot("rc-last") + '</div></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label style="' + lbl + '">Teléfono</label><input id="rc-phone" style="' + inp + '" placeholder="11 2345 6789"/>' + eslot("rc-phone") + '</div><div><label style="' + lbl + '">DNI / CUIL</label><input id="rc-tax" style="' + inp + '" placeholder="20123456789"/>' + eslot("rc-tax") + '</div></div>'${waOptin ? ` + '${waOptinHtml(color, "rc")}'` : ""}
        + '</div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Entrega</h3>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">País / Región</label><input value="Argentina" disabled style="' + inp + 'background:#f4f4f5;color:#555;"/></div>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Calle y número</label><input id="rc-addr" style="' + inp + '" placeholder="Av. Siempreviva 742"/>' + eslot("rc-addr") + '</div>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Piso / depto <span style="color:#aaa;font-weight:400;">(opc.)</span></label><input id="rc-addr2" style="' + inp + '" placeholder="3° B"/></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div><label style="' + lbl + '">C.P.</label><input id="rc-zip" style="' + inp + '" placeholder="1754"/>' + eslot("rc-zip") + '</div><div><label style="' + lbl + '">Localidad</label><input id="rc-city" style="' + inp + '" placeholder="San Justo"/>' + eslot("rc-city") + '</div></div>'
          + '<div><label style="' + lbl + '">Provincia</label><select id="rc-prov" style="' + inp + 'cursor:pointer;"><option value="">Elegí tu provincia…</option>' + PROV.map(function(p){ return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("") + '</select>' + eslot("rc-prov") + '</div>'
        + '</div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Envío</h3><div id="rc-rates"></div></div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Pago</h3>'
          + '<div style="font-size:13px;color:#555;margin-bottom:12px;">Pagás con <b>Mercado Pago</b> (tarjeta de crédito, débito o dinero en cuenta según disponibilidad).</div>'
          + '<div style="display:flex;gap:8px;margin-bottom:8px;">'
            + '<input id="rc-disc" placeholder="Código de descuento" style="' + inp + 'text-transform:uppercase;"/>'
            + '<button id="rc-disc-btn" type="button" style="flex-shrink:0;padding:0 16px;font-size:13px;font-weight:700;color:' + COL + ';background:#fff;border:1.5px solid ' + COL + ';border-radius:9px;cursor:pointer;font-family:inherit;">Aplicar</button>'
          + '</div>'
          + '<div id="rc-disc-msg" style="display:none;font-size:12px;font-weight:600;margin-bottom:12px;"></div>'
          + '<div id="rc-err" style="display:none;background:#fde8e8;border:1px solid #f5b5b5;color:#b42318;font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:12px;"></div>'
          + '<button id="rc-pay" style="width:100%;padding:14px;font-size:15px;font-weight:700;color:#fff;background:' + COL + ';border:none;border-radius:11px;cursor:pointer;">Pagar</button>'
        + '</div>'
      + '</div>'
      + '<div class="rc-summary-wrap" style="' + card + '"><div id="rc-summary"></div></div>'
      + '</div></div>'
      + '<style>@media(max-width:760px){.rc-grid{grid-template-columns:1fr!important;}.rc-summary-wrap{order:-1;}#recurrentes-checkout input,#recurrentes-checkout select{font-size:16px!important;}}@keyframes rc-spin{to{transform:rotate(360deg)}}</style>';

    document.getElementById("rc-pay").addEventListener("click", pagar);
    var _db = document.getElementById("rc-disc-btn"); if (_db) _db.addEventListener("click", applyDiscount);
    var _di = document.getElementById("rc-disc"); if (_di) _di.addEventListener("keydown", function(e){ if (e.key === "Enter") { e.preventDefault(); applyDiscount(); } });
    // Cupón por URL: ?rc=<token firmado> (mails de abandono nuevos) o ?code=X en
    // claro (legacy). Lo autocompleta y aplica solo. Con rc también prellenamos el
    // email del lead (el cupón sólo vale para ese email).
    try {
      if (RC_EMAIL) { var _em = document.getElementById("rc-email"); if (_em && !_em.value) _em.value = RC_EMAIL; }
      var _uc = RC_DISC_RC_CODE || new URLSearchParams(window.location.search).get("code");
      if (_uc && _di) { _di.value = _uc.trim().toUpperCase(); applyDiscount(); }
    } catch (e) {}
    // Captura de lead: apenas el mail queda válido (blur) → registra el carrito.
    // Nombre/apellido/teléfono también disparan para ir enriqueciendo el lead.
    ["rc-email","rc-name","rc-last","rc-phone"].forEach(function(id){
      var el = document.getElementById(id);
      if (el) el.addEventListener("blur", captureLead);
    });
    ["rc-zip","rc-prov","rc-city"].forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener("change", onAddrChange); el.addEventListener("input", onAddrChange); } });
    // Al escribir, se limpia el error de ese campo (como Shopify).
    RC_FIELDS.forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener("input", function(){ clrBad(id); }); el.addEventListener("change", function(){ clrBad(id); }); } });
    // C.P., DNI/CUIL y Teléfono: SOLO números. inputmode numérico (teclado
    // numérico en celular) + filtro que borra cualquier caracter no numérico al
    // tipear o pegar.
    ["rc-zip","rc-tax","rc-phone"].forEach(function(id){ var el=document.getElementById(id); if(el){ el.setAttribute("inputmode","numeric"); el.addEventListener("input", function(){ var v=el.value.replace(/[^0-9]/g,""); if(v!==el.value) el.value=v; }); } });
    renderRates(); renderSummary();
  }

  if (!PRODUCT && !PLAN_ID) { mount.innerHTML = errBox("Faltan datos del producto en la URL. Volvé a la tienda e intentá de nuevo."); return; }
  // Pintamos el formulario YA, sin esperar el plan → mata la pantalla blanca y el
  // cliente puede empezar a completar sus datos de contacto/entrega mientras el
  // plan carga en paralelo. El resumen muestra un spinner hasta que el plan llega
  // (ms después) y ahí se hidratan precios + envío. Antes esto esperaba el fetch
  // completo antes de dibujar nada → pantalla blanca de varios segundos en frío.
  render();
  // Con ?plan=<id> el backend busca por id (prioridad); product/variant van igual.
  fetch(API_BASE + "/api/public?action=plan&merchant=" + encodeURIComponent(MERCHANT_ID) + "&product=" + encodeURIComponent(PRODUCT) + (VARIANT ? "&variant=" + encodeURIComponent(VARIANT) : "") + (PLAN_ID ? "&plan=" + encodeURIComponent(PLAN_ID) : ""))
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (!d || !d.plan) { mount.innerHTML = errBox("No encontramos una suscripción activa para este producto."); return; }
      plan = d.plan;
      if (PACK_MODE) {
        PACK = resolvePack(plan, PACK_IDX);
        if (!PACK) { mount.innerHTML = errBox("El pack elegido ya no está disponible. Volvé a la tienda y elegilo de nuevo."); return; }
        QTY = PACK.qty;
      }
      if (!rates.length) { rates = [planRate()]; rateIdx = 0; }
      renderRates(); renderSummary(); fireIC();
    })
    .catch(function(){ mount.innerHTML = errBox("No pudimos cargar el plan. Revisá tu conexión."); });
})();`;
}
