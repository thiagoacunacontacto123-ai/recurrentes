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

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const merchantId = String(req.query.merchant || "");
  const apiBase = process.env.APP_BASE_URL || "";
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
  let widgetSubTitle = "Suscripción";
  let widgetSubSubtitle = ""; // "" → usa default con frecuencia
  let widgetOnceTitle = "Compra única";
  let widgetOnceSubtitle = "Comprá una vez al precio normal.";
  let widgetDisclaimerText = ""; // "" → usa default
  // "page" = el botón lleva a un checkout propio (contacto/dirección/envíos de
  // Shopify) antes de MP. "inline" = form dentro del widget (comportamiento viejo).
  let checkoutFlow = "page";
  // Path de la PÁGINA de checkout on-store que el merchant creó en Shopify (con el
  // embed pegado). El botón del producto redirige ahí, en el dominio de la tienda.
  let checkoutPagePath = "/pages/suscripcion-form";
  try {
    const { db } = await import("./_lib/firebase.js");
    const snap = await db().collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const m = snap.data();
      if (m.widget_mode_order === "once_first") widgetModeOrder = "once_first";
      if (m.widget_mode_default === "once") widgetModeDefault = "once";
      if (typeof m.widget_color === "string" && /^#[0-9a-fA-F]{6}$/.test(m.widget_color)) widgetColor = m.widget_color;
      if (typeof m.widget_sub_title === "string" && m.widget_sub_title.trim()) widgetSubTitle = m.widget_sub_title.trim();
      if (typeof m.widget_sub_subtitle === "string") widgetSubSubtitle = m.widget_sub_subtitle;
      if (typeof m.widget_once_title === "string" && m.widget_once_title.trim()) widgetOnceTitle = m.widget_once_title.trim();
      if (typeof m.widget_once_subtitle === "string" && m.widget_once_subtitle.trim()) widgetOnceSubtitle = m.widget_once_subtitle.trim();
      if (typeof m.widget_disclaimer_text === "string") widgetDisclaimerText = m.widget_disclaimer_text;
      if (!hideSelector && typeof m.widget_hide_selector === "string") hideSelector = m.widget_hide_selector;
      if (m.widget_checkout_flow === "inline") checkoutFlow = "inline";
      if (typeof m.widget_checkout_page_path === "string" && m.widget_checkout_page_path.trim()) checkoutPagePath = m.widget_checkout_page_path.trim();
    }
  } catch (_) {}

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
  const COL = widgetColor;

  // ?view=checkout → sirve el CHECKOUT ON-STORE (página de Shopify del merchant),
  // en vez del widget del producto. Corre en el dominio de la tienda, así puede
  // pedir los envíos REALES por CP a Shopify (/cart/shipping_rates.json) y va a MP.
  if (String(req.query.view || "") === "checkout") {
    return res.send(buildCheckoutEmbed({ merchantId, apiBase, color: widgetColor }));
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
  var HIDE_SELECTOR = ${JSON.stringify(hideSelector)};
  var MODE_ORDER = ${JSON.stringify(widgetModeOrder)};
  var MODE_DEFAULT = ${JSON.stringify(widgetModeDefault)};
  var CHECKOUT_FLOW = ${JSON.stringify(checkoutFlow)};
  var CHECKOUT_PAGE_PATH = ${JSON.stringify(checkoutPagePath)};
  var WIDGET_COLOR = ${JSON.stringify(widgetColor)};
  var SUB_TITLE = ${JSON.stringify(widgetSubTitle)};
  var SUB_SUBTITLE = ${JSON.stringify(widgetSubSubtitle)};
  var ONCE_TITLE = ${JSON.stringify(widgetOnceTitle)};
  var ONCE_SUBTITLE = ${JSON.stringify(widgetOnceSubtitle)};
  var DISCLAIMER_TEXT = ${JSON.stringify(widgetDisclaimerText)};
  var DEBUG = ${process.env.NODE_ENV !== "production" ? "true" : "false"};
  var log = function(){ if (DEBUG) console.log.apply(console, ["[Recurrentes]"].concat([].slice.call(arguments))); };

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
    return document.querySelector('form[action*="/cart/add"]');
  }

  function fetchPlan(productId, variantId) {
    // El backend filtra por product_id; si no hay match exacto, devuelve null.
    // Si en F2 sumamos planes por variante específica, agregaríamos &variant=.
    var url = API_BASE + "/api/public?action=plan&merchant=" + encodeURIComponent(MERCHANT_ID) + "&product=" + encodeURIComponent(productId);
    if (variantId) url += "&variant=" + encodeURIComponent(variantId);
    return fetch(url).then(function(r){ return r.json(); }).catch(function(){ return { plan: null }; });
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
            <strong style="font-size:14px;">' + SUB_TITLE + '</strong>\
            <span style="background:${COL};color:#fff;font-size:10px;padding:2px 7px;border-radius:4px;font-weight:700;letter-spacing:0.3px;">' + (plan.discount_pct||0) + '% OFF</span>\
          </div>\
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">' + (SUB_SUBTITLE || ("Recibilo cada " + plan.frequency_days + " días. Cancelá cuando quieras.")) + '</div>\
        </div>\
      </label>\
    ';
    var onceCard = '\
      <label style="display:flex;align-items:flex-start;gap:10px;padding:11px 12px;border:2px solid ' + onceBorder + ';border-radius:8px;cursor:pointer;background:' + onceBg + ';" data-rec-mode="once">\
        <input type="radio" name="recurrentes-mode" value="once" ' + onceSelectedAttrs + ' style="margin:2px 0 0 0;"/>\
        <div style="flex:1"><strong style="font-size:14px;">' + ONCE_TITLE + '</strong><div style="font-size:12px;color:#6b7280;margin-top:2px;">' + ONCE_SUBTITLE + '</div></div>\
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
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      body = '<div style="margin-bottom:4px;">Te suscribís a un <strong>pago recurrente con Mercado Pago</strong>. Se cobra automáticamente cada <strong>' + plan.frequency_days + ' días</strong> en tu tarjeta de <strong>crédito</strong> (no aceptamos débito ni saldo, porque MP solo permite débitos automáticos con tarjeta de crédito).</div>'
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
          <div style="font-size:11px;color:${COL_TEXT_MEDIUM};text-transform:uppercase;font-weight:700;letter-spacing:0.5px;">' + SUB_TITLE.toUpperCase() + '</div>\
          <div style="font-size:15px;font-weight:700;color:${COL_TEXT_DARK};margin-top:2px;">' + plan.product_title + '</div>\
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
      <div id="rec-inline-fields"' + (CHECKOUT_FLOW === "page" ? ' style="display:none;"' : '') + '>\
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;margin-bottom:8px;">\
        <input id="rec-name" type="text" placeholder="Nombre completo" style="' + inputStyle + '"/>\
        <input id="rec-email" type="email" placeholder="Email" style="' + inputStyle + '"/>\
        <input id="rec-phone" type="tel" placeholder="Teléfono" style="' + inputStyle + '"/>\
        <input id="rec-zip" type="text" placeholder="Código postal" style="' + inputStyle + '"/>\
      </div>\
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
  var inputStyle = "padding:9px 11px;border:1px solid #d1d5db;border-radius:7px;font-size:13px;font-family:inherit;outline:none;background:#fff;color:#111827;box-sizing:border-box;width:100%;min-width:0;max-width:100%;";

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
        fb: fbData,
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
      (window.ShopifyAnalytics && ShopifyAnalytics.meta && ShopifyAnalytics.meta.page && ShopifyAnalytics.meta.page.pageType === "product");
    if (!isProductPage) { log("No es página de producto, widget no carga"); return; }

    var productId = detectProductId();
    if (!productId) { log("No se detectó productId — widget no carga"); return; }
    var form = findProductForm();
    var variantId = form ? detectVariantId(form) : null;

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
    if (!mountPoint && !form && !hideAnchor) {
      log("No hay mount point ni form/cart/add ni hide anchor. Widget no se monta.");
      return;
    }

    fetchPlan(productId, variantId).then(function(d){
      if (d.error || !d.plan) { log("Sin plan para producto", productId, d); return; }
      var plan = d.plan;

      var widget = buildWidget(plan);
      var subPanel = buildSubscribePanel(plan);
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
        if (CHECKOUT_FLOW === "page") {
          // Modo checkout ON-STORE: el botón lleva a la PÁGINA de Shopify del
          // merchant (misma tienda), con producto/variante/cantidad. Esa página
          // tiene el embed (?view=checkout) que junta datos + envíos reales por
          // CP de Shopify y va a MP. Igual que Puentify (/pages/suscripcion-form).
          var qEl = subPanel.querySelector("#rec-qty");
          var q = parseInt(qEl ? qEl.value : (subPanel.dataset.qty || 1)) || 1;
          var u = window.location.origin + CHECKOUT_PAGE_PATH +
            "?product=" + encodeURIComponent(plan.shopify_product_id) +
            "&variant=" + encodeURIComponent(plan.shopify_variant_id || variantId || "") +
            "&qty=" + q +
            "&freq_value=1&freq_type=months";
          window.location.href = u;
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
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
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
function buildCheckoutEmbed({ merchantId, apiBase, color }) {
  return `(function(){
  "use strict";
  var MERCHANT_ID = ${JSON.stringify(merchantId)};
  var API_BASE = ${JSON.stringify(apiBase)};
  var COL = ${JSON.stringify(color || "#10b981")};
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

  var mount = document.getElementById("recurrentes-checkout");
  if (!mount) { mount = document.createElement("div"); mount.id = "recurrentes-checkout"; document.body.appendChild(mount); }

  var plan = null, rates = [], rateIdx = 0, submitting = false, ratesMsg = "Completá C.P. y provincia para ver el envío.";

  function money(n){ return "$" + Math.round(Number(n) || 0).toLocaleString("es-AR"); }
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]; }); }
  function val(id){ var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function errBox(msg){ return '<div style="max-width:420px;margin:60px auto;text-align:center;font-family:-apple-system,Segoe UI,Roboto,sans-serif;"><div style="font-size:15px;font-weight:700;margin-bottom:8px;">Ups</div><div style="font-size:13px;color:#666;line-height:1.5;">' + esc(msg) + '</div></div>'; }

  function prices(){
    var unit = plan.subscription_price_ars || 0;
    var tiers = Array.isArray(plan.qty_discount_tiers) ? plan.qty_discount_tiers : [];
    var disc = 0; for (var i=0;i<tiers.length;i++){ if (QTY >= (tiers[i].min_qty||0)) disc = tiers[i].discount_pct||0; }
    var subtotal = Math.round(unit * QTY * (1 - disc/100));
    var sel = rates[rateIdx] || { name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) };
    return { subtotal: subtotal, disc: disc, ship: Number(sel.price)||0, shipName: sel.name, total: subtotal + (Number(sel.price)||0) };
  }
  function effFreqDays(){ return (FREQ_DAYS >= 1) ? FREQ_DAYS : (plan.frequency_days || 30); }
  function freqTxt(){ var d = effFreqDays(); if (d===30) return "mensual"; if (d===60) return "cada 2 meses"; if (d===90) return "cada 3 meses"; if (d % 30 === 0) return "cada " + (d/30) + " meses"; return "cada " + d + " días"; }

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
        var list = (d.shipping_rates || []).map(function(sr){ return { name: sr.presentment_name || sr.name, price: parseFloat(sr.price) || 0 }; });
        rates = list.length ? list : [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }];
        rateIdx = 0; ratesMsg = "";
        // sacar la variante que agregamos (no queremos tocar el carrito real)
        fetch("/cart/change.js", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ id: parseInt(VARIANT,10), quantity: 0 }) }).catch(function(){});
        renderRates(); renderSummary();
      })
      .catch(function(){ rates = [{ name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) }]; rateIdx = 0; ratesMsg = ""; renderRates(); renderSummary(); });
  }
  function onAddrChange(){ clearTimeout(rateTimer); rateTimer = setTimeout(fetchRates, 500); }

  function renderRates(){
    var box = document.getElementById("rc-rates"); if (!box) return;
    if (ratesMsg) { box.innerHTML = '<div style="font-size:13px;color:#888;padding:10px 0;">' + esc(ratesMsg) + '</div>'; return; }
    box.innerHTML = rates.map(function(rt,i){
      var free = (Number(rt.price)||0) === 0;
      return '<label style="display:flex;align-items:center;gap:10px;padding:11px 13px;border:1.5px solid ' + (i===rateIdx?COL:"#e0e0e2") + ';border-radius:10px;cursor:pointer;margin-bottom:8px;background:' + (i===rateIdx?(COL+"0d"):"#fff") + ';">'
        + '<input type="radio" name="rc-rate" ' + (i===rateIdx?"checked":"") + ' data-i="' + i + '" style="accent-color:' + COL + ';"/>'
        + '<span style="flex:1;font-size:13px;font-weight:500;">' + esc(rt.name) + '</span>'
        + '<b style="font-size:13px;color:' + (free?"#0a8a3f":"#1a1a1a") + ';">' + (free?"Gratis":money(rt.price)) + '</b></label>';
    }).join("");
    Array.prototype.forEach.call(box.querySelectorAll('input[name="rc-rate"]'), function(inp){
      inp.addEventListener("change", function(){ rateIdx = parseInt(inp.getAttribute("data-i"),10)||0; renderRates(); renderSummary(); });
    });
  }
  function renderSummary(){
    var el = document.getElementById("rc-summary"); if (!el) return; var p = prices();
    el.innerHTML =
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:14px;">'
      + '<div style="min-width:0;"><div style="font-size:10px;font-weight:800;color:' + COL + ';text-transform:uppercase;letter-spacing:.5px;">Suscripción · ' + esc(freqTxt()) + '</div>'
      + '<div style="font-size:14px;font-weight:700;line-height:1.3;">' + esc(plan.product_title) + ' × ' + QTY + '</div></div></div>'
      + '<div style="border-top:1px solid #eee;padding-top:12px;display:flex;flex-direction:column;gap:8px;font-size:13px;">'
      + '<div style="display:flex;justify-content:space-between;"><span style="color:#666;">Subtotal' + (p.disc>0?(" (−"+p.disc+"%)"):"") + '</span><b>' + money(p.subtotal) + '</b></div>'
      + '<div style="display:flex;justify-content:space-between;"><span style="color:#666;">Envío' + (p.shipName?(" · "+esc(p.shipName)):"") + '</span><b>' + (p.ship===0?"Gratis":money(p.ship)) + '</b></div>'
      + '<div style="display:flex;justify-content:space-between;border-top:1px solid #eee;padding-top:10px;font-size:15px;"><b>Total ' + esc(freqTxt()) + '</b><b>' + money(p.total) + '</b></div></div>'
      + '<div style="margin-top:12px;font-size:11px;color:#888;line-height:1.5;">Se cobra ' + money(p.total) + ' ahora y se renueva automáticamente ' + esc(freqTxt()) + '. Cancelás cuando quieras.</div>';
  }

  function pagar(){
    var box = document.getElementById("rc-err"); box.style.display = "none";
    var miss = [];
    var email = val("rc-email"), name = (val("rc-name") + " " + val("rc-last")).trim(), phone = val("rc-phone");
    if (!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)) miss.push("email válido");
    if (!val("rc-name")) miss.push("nombre");
    if (!val("rc-last")) miss.push("apellido");
    if (!val("rc-tax")) miss.push("DNI / CUIL");
    if (!phone) miss.push("teléfono");
    if (!val("rc-addr")) miss.push("calle y número");
    if (!val("rc-city")) miss.push("localidad");
    if (!val("rc-prov")) miss.push("provincia");
    if (!val("rc-zip")) miss.push("código postal");
    if (miss.length) { box.textContent = "Completá: " + miss.join(", ") + "."; box.style.display = "block"; return; }
    if (submitting) return; submitting = true;
    var btn = document.getElementById("rc-pay"); if (btn){ btn.disabled = true; btn.textContent = "Redirigiendo a Mercado Pago…"; }
    var sel = rates[rateIdx] || { name: (plan.shipping_method_name||"Envío"), price: (plan.shipping_price_ars||0) };
    fetch(API_BASE + "/api/checkout/init", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        merchant_id: MERCHANT_ID, plan_id: plan.id, quantity: QTY, frequency_days: effFreqDays(),
        customer: { email: email, name: name, phone: phone, tax_id: val("rc-tax") },
        shipping_address: {
          address1: val("rc-addr"), address2: val("rc-addr2"), city: val("rc-city"),
          province: val("rc-prov"), zip: val("rc-zip"), country: "Argentina",
          first_name: val("rc-name"), last_name: val("rc-last"), phone: phone
        },
        shipping_method: { name: sel.name, price: Number(sel.price) || 0 }
      })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.error) { box.textContent = d.error; box.style.display = "block"; submitting = false; if(btn){ btn.disabled=false; btn.textContent="Pagar"; } return; }
      window.location.href = d.init_point;
    }).catch(function(){ box.textContent = "No pudimos conectar con Mercado Pago. Reintentá."; box.style.display = "block"; submitting = false; if(btn){ btn.disabled=false; btn.textContent="Pagar"; } });
  }

  var PROV = ["Buenos Aires","Ciudad Autónoma de Buenos Aires","Catamarca","Chaco","Chubut","Córdoba","Corrientes","Entre Ríos","Formosa","Jujuy","La Pampa","La Rioja","Mendoza","Misiones","Neuquén","Río Negro","Salta","San Juan","San Luis","Santa Cruz","Santa Fe","Santiago del Estero","Tierra del Fuego","Tucumán"];

  function render(){
    var inp = "width:100%;padding:11px 12px;font-size:14px;border:1px solid #d6d6d8;border-radius:9px;box-sizing:border-box;outline:none;background:#fff;font-family:inherit;";
    var card = "background:#fff;border:1px solid #e8e8ea;border-radius:14px;padding:20px;margin-bottom:16px;";
    var lbl = "font-size:12px;font-weight:600;color:#555;margin:0 0 5px;display:block;";
    var h = "font-size:15px;font-weight:700;margin:0 0 14px;";
    mount.innerHTML =
      '<div style="max-width:940px;margin:0 auto;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">'
      + '<div class="rc-grid" style="display:grid;grid-template-columns:1fr 340px;gap:22px;align-items:start;">'
      + '<div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Contacto</h3>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Email</label><input id="rc-email" type="email" style="' + inp + '" placeholder="tu@email.com"/></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div><label style="' + lbl + '">Nombre</label><input id="rc-name" style="' + inp + '" placeholder="Juan"/></div><div><label style="' + lbl + '">Apellido</label><input id="rc-last" style="' + inp + '" placeholder="Pérez"/></div></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;"><div><label style="' + lbl + '">Teléfono</label><input id="rc-phone" style="' + inp + '" placeholder="11 2345 6789"/></div><div><label style="' + lbl + '">DNI / CUIL</label><input id="rc-tax" style="' + inp + '" placeholder="20123456789"/></div></div>'
        + '</div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Entrega</h3>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">País / Región</label><input value="Argentina" disabled style="' + inp + 'background:#f4f4f5;color:#555;"/></div>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Calle y número</label><input id="rc-addr" style="' + inp + '" placeholder="Av. Siempreviva 742"/></div>'
          + '<div style="margin-bottom:12px;"><label style="' + lbl + '">Piso / depto <span style="color:#aaa;font-weight:400;">(opc.)</span></label><input id="rc-addr2" style="' + inp + '" placeholder="3° B"/></div>'
          + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;"><div><label style="' + lbl + '">C.P.</label><input id="rc-zip" style="' + inp + '" placeholder="1754"/></div><div><label style="' + lbl + '">Localidad</label><input id="rc-city" style="' + inp + '" placeholder="San Justo"/></div></div>'
          + '<div><label style="' + lbl + '">Provincia</label><select id="rc-prov" style="' + inp + 'cursor:pointer;"><option value="">Elegí tu provincia…</option>' + PROV.map(function(p){ return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("") + '</select></div>'
        + '</div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Envío</h3><div id="rc-rates"></div></div>'
        + '<div style="' + card + '"><h3 style="' + h + '">Pago</h3>'
          + '<div style="font-size:13px;color:#555;margin-bottom:12px;">Vas a completar el pago de forma segura en <b>Mercado Pago</b>.</div>'
          + '<div id="rc-err" style="display:none;background:#fde8e8;border:1px solid #f5b5b5;color:#b42318;font-size:13px;padding:10px 12px;border-radius:9px;margin-bottom:12px;"></div>'
          + '<button id="rc-pay" style="width:100%;padding:14px;font-size:15px;font-weight:700;color:#fff;background:' + COL + ';border:none;border-radius:11px;cursor:pointer;">Pagar</button>'
        + '</div>'
      + '</div>'
      + '<div class="rc-summary-wrap" style="' + card + 'position:sticky;top:16px;"><div id="rc-summary"></div></div>'
      + '</div></div>'
      + '<style>@media(max-width:760px){.rc-grid{grid-template-columns:1fr!important;}.rc-summary-wrap{order:-1;}}</style>';

    document.getElementById("rc-pay").addEventListener("click", pagar);
    ["rc-zip","rc-prov","rc-city"].forEach(function(id){ var el=document.getElementById(id); if(el){ el.addEventListener("change", onAddrChange); el.addEventListener("input", onAddrChange); } });
    renderRates(); renderSummary();
  }

  if (!PRODUCT) { mount.innerHTML = errBox("Faltan datos del producto en la URL. Volvé a la tienda e intentá de nuevo."); return; }
  fetch(API_BASE + "/api/public?action=plan&merchant=" + encodeURIComponent(MERCHANT_ID) + "&product=" + encodeURIComponent(PRODUCT))
    .then(function(r){ return r.json(); })
    .then(function(d){ if (!d || !d.plan) { mount.innerHTML = errBox("No encontramos una suscripción activa para este producto."); return; } plan = d.plan; render(); })
    .catch(function(){ mount.innerHTML = errBox("No pudimos cargar el plan. Revisá tu conexión."); });
})();`;
}
