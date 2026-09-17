// Medios de la landing.
// Video: 19:36, 1382x900 H.264 (CRF 28, tune stillimage porque es captura de
// pantalla: texto nítido con poco bitrate) = 62 MB a ~420 kbps, con el índice al
// principio (faststart). Arranca en <1 s igual que la versión chica: el navegador
// baja solo los primeros segundos (preload="none" + Range de Vercel), no el archivo.
// Poster: miniatura 3D propia (SVG compuesto → JPG, 147 KB).
// Se sirven desde public/ por el CDN de Vercel con caché inmutable (vercel.json).
// Si la URL está vacía, la sección de video no se muestra.
export const LANDING_VIDEO_URL = "/landing/recurrentes-demo.mp4";
export const LANDING_VIDEO_POSTER = "/landing/recurrentes-demo-poster.jpg";
export const LANDING_VIDEO_DURATION = "20 min";
