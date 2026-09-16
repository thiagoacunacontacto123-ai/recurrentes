/*
 * Recurrentes — loader del widget para Tiendanube.
 *
 * Este archivo NO lo sirve Recurrentes: se sube tal cual en el portal de Partners
 * (partners.tiendanube.com → tu app → Scripts → Agregar versión → subir este .js
 * → Deploy a testing → Deploy a producción). Tiendanube lo carga en cada página de
 * la tienda con los query_params que manda Recurrentes (merchant=<id de la cuenta>).
 * Solo en páginas de producto trae el widget real desde recurrentesapp.com.
 *
 * Los temas viejos exponen window.LS (LS.store / LS.product). Los nuevos (morelia y
 * compañía) pueden no exponerlo, así que la detección de "página de producto" tiene
 * varias fuentes y el id del producto se le pasa al widget por window.
 */
(function () {
  if (window.__recurrentesTnLoader) return;
  window.__recurrentesTnLoader = true;
  var BASE = "https://www.recurrentesapp.com";

  function param(src, k) {
    var m = String(src || "").match(new RegExp("[?&]" + k + "=([^&#]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }

  // ─── Id del producto: LS → meta → JSON-LD → data-attribute ───────────────
  function fromLS() {
    try { return (window.LS && window.LS.product && window.LS.product.id) ? String(window.LS.product.id) : ""; } catch (e) { return ""; }
  }
  function fromMeta() {
    try {
      var m = document.querySelector('meta[property="product:id"], meta[property="og:product_id"]');
      return m && m.content ? String(m.content) : "";
    } catch (e) { return ""; }
  }
  function fromJsonLd() {
    try {
      var nodes = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < nodes.length; i++) {
        var data;
        try { data = JSON.parse(nodes[i].textContent || "null"); } catch (e) { continue; }
        var list = Array.isArray(data) ? data : (data && data["@graph"] ? data["@graph"] : [data]);
        for (var j = 0; j < list.length; j++) {
          var it = list[j];
          if (!it || String(it["@type"] || "") !== "Product") continue;
          var id = it.productID || it.sku || (it.offers && it.offers.sku) || "";
          if (id) return String(id);
        }
      }
    } catch (e) {}
    return "";
  }
  function fromDom() {
    try {
      var d = document.querySelector('[data-product-id], [data-store-product-id]');
      if (!d) return "";
      return String(d.getAttribute("data-product-id") || d.getAttribute("data-store-product-id") || "");
    } catch (e) { return ""; }
  }

  var productId = fromLS() || fromMeta() || fromJsonLd() || fromDom();
  // Sin id no podemos buscar el plan; pero si la URL es de producto seguimos igual,
  // porque el widget tiene sus propias fuentes y puede encontrarlo más tarde.
  var looksProduct = /\/productos\//.test(window.location.pathname) || !!productId;
  if (!looksProduct) return;

  var me = (document.currentScript && document.currentScript.src) || "";
  if (!param(me, "merchant")) {
    var ss = document.getElementsByTagName("script");
    for (var i = 0; i < ss.length; i++) {
      if (param(ss[i].src, "merchant")) { me = ss[i].src; break; }
    }
  }
  var merchant = param(me, "merchant");
  var store = param(me, "store") || (function () {
    try { return (window.LS && window.LS.store && window.LS.store.id) ? String(window.LS.store.id) : ""; } catch (e) { return ""; }
  })();
  var q = merchant ? "merchant=" + encodeURIComponent(merchant) : (store ? "tn_store=" + encodeURIComponent(store) : "");
  if (!q) return;

  // Banderas para el widget: que sepa que es Tiendanube aunque no haya LS.
  window.__RECURRENTES_TN = true;
  if (productId) window.__RECURRENTES_TN_PRODUCT = productId;

  var s = document.createElement("script");
  s.async = true;
  s.src = BASE + "/widget.js?" + q;
  (document.head || document.body).appendChild(s);
})();
