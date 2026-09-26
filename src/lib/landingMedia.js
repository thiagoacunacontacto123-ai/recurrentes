// Medios de la landing (se sirven desde public/ por el CDN de Vercel, con caché
// inmutable definida en vercel.json).
//
// Dos videos verticales (1080x1920, editados en CapCut, 20-sept-2026) que
// reemplazan al recorrido largo de 20 min: en computadora van uno al lado del
// otro, en celular uno debajo del otro. H.264 CRF 20 + faststart: con
// preload="none" el navegador baja solo el principio por Range. Poster: cuadro
// del propio video al segundo 1,5.
// VACÍO desde el 25-sept-2026 (Thiago): los dos quedaron viejos —el panel cambió
// mucho desde el 20-sept— y repiten que todo es gratis, justo cuando la puesta en
// marcha pasó a cobrarse USD 100. La sección se esconde sola con la lista vacía.
// Los archivos siguen en public/landing/: para reponerlos, descomentar y grabar
// de nuevo. Lo que muestra el producto ahora es la demo en vivo (#/demo).
export const LANDING_VIDEOS = [
  // { id: "por-que", url: "/landing/por-que-recurrencia.mp4", poster: "/landing/por-que-recurrencia-poster.jpg",
  //   n: "01", title: "Por qué pasarte a suscripción", sub: "Qué cambia cuando dejás de vender de a una y cobrás todos los meses.", duration: "1:44" },
  // { id: "panel", url: "/landing/panel-por-dentro.mp4", poster: "/landing/panel-por-dentro-poster.jpg",
  //   n: "02", title: "El panel por dentro", sub: "Suscripciones, cobros, analíticas, planes y el widget en tu tienda.", duration: "2:00" },
];
