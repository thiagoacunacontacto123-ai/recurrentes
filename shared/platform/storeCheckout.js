// Instalación de una tienda: la fuente única de lo que hay que pegar.
//
// Lo usa el manual del Admin (Instalación) y de acá sale `docs/page-checkout.liquid`
// (un test compara los dos, así no se separan nunca). La idea es no tener que
// pedirle a nadie —ni a Claude— que arme el snippet a mano cada vez que entra
// una tienda: se elige el comercio en el Admin y sale listo para copiar.
export const APP_BASE = "https://www.recurrentesapp.com";

// El <script> que va en layout/theme.liquid, arriba de </body>. Es el widget:
// pinta la suscripción en las fichas de producto.
export function themeSnippet(merchantId, base = APP_BASE) {
  return `<script src="${base}/api/widget?merchant=${merchantId}"></script>`;
}

// La plantilla de la página de checkout en el dominio de la tienda.
export function pageCheckoutLiquid(merchantId = "MERCHANT_ID", base = APP_BASE) {
  const mid = merchantId, b = base;
  return `{%- comment -%}
  Recurrentes · checkout dentro de la tienda (plantilla de página).

  Qué hace: deja la página con NUESTRO checkout y nada más. Tapa el header, el
  pie, popups, barras pegajosas y cualquier cosa que el tema meta después de
  cargar, igual que el checkout de Shopify. El dominio sigue siendo el de la
  tienda.

  Adentro va el checkout de verdad (el mismo de #/checkout, con su encabezado,
  su pie y su tema): uno solo que mantener. Acá NO se agrega nada alrededor —
  ni logo ni "seguir comprando" — porque el checkout ya los trae.

  Cómo se instala (una vez por tienda):
    1. Online Store → Themes → ⋯ → Edit code
    2. Templates → Add a new template → tipo "page", formato "liquid",
       nombre: recurrentes-checkout      (queda page.recurrentes-checkout.liquid)
       (o, más rápido: una sección "Custom Liquid" en la página, y esconder las
       demás secciones de esa plantilla)
    3. Pegar TODO esto y reemplazar ${mid} por el id de la tienda.
    4. Pages → crear la página (ej. "Suscripción") → Template: recurrentes-checkout
       → Content: VACÍO → Visibility: Visible.
    5. En el panel de Recurrentes, Widget → "Checkout en mi tienda" con el
       /pages/<handle> de esa página.

  No cambiar el id "recurrentes-checkout": ahí se monta el checkout.
{%- endcomment -%}

<style>
  /* 1) Nada del tema en esta página */
  .shopify-section-group-header-group,
  .shopify-section-group-footer-group,
  .rec-ck-off { display: none !important; }

  /* 2) La página, limpia. display:block porque muchos temas ponen el body en
     grid o flex y ahí lo nuestro se encoge al ancho del contenido (a Wellfresh
     le quedaba una columna de 400 px en el medio de la pantalla). */
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body { display: block !important; overflow-x: hidden; }
  main, #MainContent, .main-content, .shopify-section { margin: 0 !important; padding: 0 !important; }

  /* 3) El checkout, de punta a punta: el ancho lo maneja él, como en nuestro
     dominio. Nada de max-width acá o el resumen gris no llega al borde. */
  .rec-ck-page { width: 100% !important; max-width: none; margin: 0; padding: 0;
                 box-sizing: border-box; justify-self: stretch; grid-column: 1 / -1; flex: 1 1 auto; }
</style>

<div class="rec-ck-page" id="rec-ck-page">
  <div id="recurrentes-checkout"></div>
</div>

<script>
  /* El tema mete barras, popups y botones flotantes DESPUÉS de cargar, y cada
     tema los llama distinto. En vez de adivinar nombres de clases: sacamos
     nuestro bloque a la raíz y apagamos todo lo que quede al lado. Se repite
     unas cuantas veces porque las apps inyectan tarde. */
  (function () {
    function limpiar() {
      var yo = document.getElementById("rec-ck-page");
      if (!yo) return;
      /* Se mueve una sola vez (el chequeo del padre): mover un nodo reinicia
         lo que tenga adentro. */
      if (yo.parentNode !== document.body) document.body.appendChild(yo);
      var hijos = document.body.children;
      for (var i = 0; i < hijos.length; i++) {
        var n = hijos[i], t = n.tagName;
        if (n === yo || t === "SCRIPT" || t === "STYLE" || t === "LINK" || t === "NOSCRIPT") continue;
        n.classList.add("rec-ck-off");
      }
      document.body.style.padding = "0";
      document.body.style.margin = "0";
    }
    limpiar();
    document.addEventListener("DOMContentLoaded", limpiar);
    window.addEventListener("load", limpiar);
    [300, 900, 2000, 4000].forEach(function (ms) { setTimeout(limpiar, ms); });
  })();
</script>

<script src="${b}/api/widget?merchant=${mid}&view=embed" defer></script>
`;
}

// El manual, en orden. Cada paso dice qué hacer y qué tiene que pasar para
// darlo por bueno (si no, uno cree que instaló y quedó a medias).
export const INSTALL_STEPS = [
  {
    id: "cuenta",
    title: "1 · Cuenta y tienda conectada",
    body: [
      "El comercio se registra (o le creás la cuenta desde el pedido de demo) y conecta Shopify o Tiendanube desde Integraciones.",
      "Una tienda por cuenta: con una conectada, las otras plataformas no se ofrecen.",
    ],
    check: "En Integraciones la tienda figura conectada.",
  },
  {
    id: "pasarela",
    title: "2 · Mercado Pago",
    body: [
      "Conectar con el botón de Mercado Pago (OAuth), NO pegando el token a mano.",
      "El OAuth es el único que deja la public key, y sin public key no se puede cobrar con la tarjeta adentro del checkout.",
      "Si el dueño ya tiene otra tienda con MP conectado, se puede reusar desde Integraciones.",
    ],
    check: "En Integraciones dice conectado y en la ficha del Admin aparece la public key.",
  },
  {
    id: "plan",
    title: "3 · Un plan activo",
    body: [
      "Crear el plan del producto que se va a vender por suscripción (packs, regalos, frecuencia y descuento).",
      "Sin plan activo el widget no se pinta: no tiene qué ofrecer.",
    ],
    check: "El plan figura activo en Planes.",
  },
  {
    id: "snippet",
    title: "4 · El widget en el tema",
    body: [
      "Tienda online → Temas → ⋯ → Editar código → layout/theme.liquid, pegar el <script> justo arriba de </body>.",
      "Una sola vez para toda la tienda. Aparece solo en los productos que tienen plan.",
    ],
    check: "Abrir una ficha de producto: se tiene que ver el bloque de suscripción. En el panel, Widget avisa que el widget carga.",
  },
  {
    id: "pagina",
    title: "5 · El checkout en el dominio de la tienda (opcional)",
    body: [
      "Crear una página (ej. \"Checkout suscripción\") con la plantilla Liquid de abajo, en Visible y con el contenido vacío.",
      "Se puede pegar como plantilla del tema (Add a new template → page → liquid) o como sección Custom Liquid de esa página, escondiendo las demás secciones.",
      "Después, en el panel: Widget → Cambiar → \"Checkout en tu dominio\" con el /pages/<handle>.",
      "Sin esto el botón lleva al checkout en recurrentesapp.com, que funciona igual.",
    ],
    check: "Entrar a la página con ?plan=<id>&pack=0: se tiene que ver el checkout completo, ancho completo, sin nada del tema alrededor.",
  },
  {
    id: "prueba",
    title: "6 · Probarlo de punta a punta",
    body: [
      "Ficha de producto → Suscripción → CTA → checkout. Completar dirección y mirar que los envíos coticen de verdad.",
      "Pagar con tarjeta y, aparte, probar \"Con tu cuenta de Mercado Pago\": tiene que saltar toda la página a Mercado Pago, no abrirse adentro del recuadro.",
      "Después del pago: la suscripción queda activa y se crea la orden en la tienda.",
    ],
    check: "La suscripción aparece activa y la orden existe en la tienda.",
  },
];
