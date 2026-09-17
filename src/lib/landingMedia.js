// Medios de la landing (se sirven desde public/ por el CDN de Vercel, con caché
// inmutable definida en vercel.json).
//
// Dos calidades del mismo recorrido (19:36), las dos con el índice al principio
// (faststart) para que arranquen en menos de un segundo: el navegador baja solo
// los primeros segundos gracias a preload="none" + Range.
//   · normal: 1382x900, CRF 28 · 62 MB — la que carga por defecto.
//   · alta:   1658x1080 nativo (resolución de la grabación), CRF 23 · 94 MB —
//              el texto del panel se lee nítido. Es el techo práctico: GitHub
//              rechaza archivos de más de 100 MB.
// Las dos con `tune stillimage` (es captura de pantalla: texto fino, poco
// movimiento), que da mucha definición con poco bitrate.
export const LANDING_VIDEO_SOURCES = [
  { id: "normal", label: "Normal", hint: "Carga más rápido", url: "/landing/recurrentes-demo.mp4" },
  { id: "alta", label: "Alta", hint: "Calidad original, se lee todo", url: "/landing/recurrentes-demo-alta.mp4" },
];
export const LANDING_VIDEO_URL = LANDING_VIDEO_SOURCES[0].url;
export const LANDING_VIDEO_POSTER = "/landing/recurrentes-demo-poster.jpg";
export const LANDING_VIDEO_DURATION = "20 min";
