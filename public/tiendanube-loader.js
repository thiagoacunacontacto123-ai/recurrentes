/*
 * Recurrentes — loader del widget para Tiendanube.
 *
 * Este archivo NO lo sirve Recurrentes: se sube tal cual en el portal de Partners
 * (partners.tiendanube.com → tu app → Scripts → Crear script → subir este .js).
 * Tiendanube lo carga en cada página de la tienda con ?store=<id> y, para las tiendas
 * conectadas, con los query_params que manda Recurrentes (merchant=<id de la cuenta>).
 * Solo en páginas de producto trae el widget real desde recurrentesapp.com.
 */
(function () {
  if (window.__recurrentesTnLoader) return;
  window.__recurrentesTnLoader = true;
  var BASE = "https://www.recurrentesapp.com";
  if (!(window.LS && window.LS.product && window.LS.product.id)) return; // solo producto

  function param(src, k) {
    var m = String(src || "").match(new RegExp("[?&]" + k + "=([^&#]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  var me = (document.currentScript && document.currentScript.src) || "";
  if (!param(me, "merchant")) {
    var ss = document.getElementsByTagName("script");
    for (var i = 0; i < ss.length; i++) {
      if (param(ss[i].src, "merchant") && /tiendanube|nuvemshop/.test(ss[i].src)) { me = ss[i].src; break; }
    }
  }
  var merchant = param(me, "merchant");
  var store = param(me, "store") || (window.LS.store && window.LS.store.id) || "";
  var q = merchant ? "merchant=" + encodeURIComponent(merchant) : (store ? "tn_store=" + encodeURIComponent(store) : "");
  if (!q) return;
  var s = document.createElement("script");
  s.async = true;
  s.src = BASE + "/widget.js?" + q;
  (document.head || document.body).appendChild(s);
})();
