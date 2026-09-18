// Videos tutoriales del panel. Mientras la constante esté vacía, el panel
// muestra un recuadro "Video paso a paso — próximamente" en su lugar.
//
// Para cargar el video de Shopify, pegá UNA de estas opciones:
//   · YouTube:  "https://www.youtube.com/watch?v=XXXXXXXXXXX"  (o youtu.be/…, /shorts/…)
//   · Loom:     "https://www.loom.com/share/XXXXXXXX"
//   · Vimeo:    "https://vimeo.com/123456789"
//   · Archivo:  "/shopify-tutorial.mp4"  (subido a la carpeta public/ del repo)
// Video de Thiago (18-sept): crear la app en Shopify + pegar el snippet, en una sola toma.
// Alojado en Google Cloud Storage del proyecto Firebase (bucket recurrentes-16fbd-tutorials, público de lectura).
export const SHOPIFY_TUTORIAL_URL = "https://storage.googleapis.com/recurrentes-16fbd-tutorials/shopify-instalacion.mp4";

// Convierte la URL en algo que se pueda mostrar: { kind:"iframe"|"video", src } o null.
export function tutorialEmbed(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  let m = u.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (m) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0` };
  m = u.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  if (m) return { kind: "iframe", src: `https://www.loom.com/embed/${m[1]}` };
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}` };
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(u) || u.startsWith("/")) return { kind: "video", src: u };
  return null;
}
