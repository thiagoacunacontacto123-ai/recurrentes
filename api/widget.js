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
  var MODE_ORDER = ${JSON.stringify(widgetModeOrder)};
  var MODE_DEFAULT = ${JSON.stringify(widgetModeDefault)};
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
      subPanel.style.display = "block";
      widget.querySelector('[data-rec-mode="once"]').style.borderColor = "#d1d5db";
      widget.querySelector('[data-rec-mode="once"]').style.background = "#fff";
      widget.querySelector('[data-rec-mode="sub"]').style.borderColor = "${COL}";
      widget.querySelector('[data-rec-mode="sub"]').style.background = "${COL_BG_VERY_LIGHT}";
    } else {
      if (form) form.style.display = form.dataset.recPrevDisplay || "";
      hideExternalBuyButtons(false);
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

    if (missing.length || emailInvalid || taxidInvalid) {
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
      var errMsg;
      if (emailInvalid) errMsg = "El email no parece válido. Revisá que tenga formato nombre@dominio.com.";
      else if (taxidInvalid) errMsg = "DNI o CUIL inválido. DNI son 7-8 dígitos, CUIL/CUIT son 11 dígitos.";
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

    fetch(API_BASE + "/api/checkout/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        merchant_id: MERCHANT_ID,
        plan_id: plan.id,
        quantity: qty,
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
    if (!mountPoint && !form) {
      log("No hay mount point ni form/cart/add. Widget no se monta.");
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
