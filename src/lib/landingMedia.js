// Medios de la landing (se sirven desde public/ por el CDN de Vercel, con caché
// inmutable definida en vercel.json).
//
// Video: el recorrido completo (19:36) en la resolución de la grabación,
// 1658x1080 H.264 CRF 23 con `tune stillimage` (es captura de pantalla: texto
// fino y poco movimiento, así se ve nítido con poco bitrate) = 94 MB. El índice
// va al principio (faststart), así que arranca en menos de un segundo: con
// preload="none" el navegador baja solo los primeros segundos por Range, el peso
// total no afecta el inicio. Sin selector de calidad (Thiago, 17-sept).
// Poster: miniatura 3D propia (SVG compuesto → JPG, 147 KB).
export const LANDING_VIDEO_URL = "/landing/recurrentes-demo-alta.mp4";
export const LANDING_VIDEO_POSTER = "/landing/recurrentes-demo-poster.jpg";
export const LANDING_VIDEO_DURATION = "20 min";
