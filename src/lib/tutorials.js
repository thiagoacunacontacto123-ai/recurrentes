// Videos tutoriales del panel. Mientras la constante esté vacía, el panel
// muestra un recuadro "Video paso a paso — próximamente" en su lugar.
//
// Para cargar el video de Shopify, pegá UNA de estas opciones:
//   · YouTube:  "https://www.youtube.com/watch?v=XXXXXXXXXXX"  (o youtu.be/…, /shorts/…)
//   · Loom:     "https://www.loom.com/share/XXXXXXXX"
//   · Vimeo:    "https://vimeo.com/123456789"
//   · Archivo:  "/shopify-tutorial.mp4"  (subido a la carpeta public/ del repo)
// VACÍO A PROPÓSITO desde el 25-sept-2026 (Thiago). El video del 18-sept quedó
// viejo —la app cambió mucho desde entonces— y además repite todo el tiempo que
// es gratis, justo cuando la instalación pasó a cobrarse USD 100. Mostrar un
// tutorial desactualizado que promete otro precio es peor que no mostrar nada.
// El archivo sigue en el bucket (recurrentes-16fbd-tutorials) por si se quiere
// recuperar; para volver a mostrarlo alcanza con pegar la URL nueva acá.
export const SHOPIFY_TUTORIAL_URL = "";

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
