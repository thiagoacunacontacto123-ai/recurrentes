// Fotos que sube el comerciante desde el panel (packs y regalos del widget).
//
// Se achican EN EL NAVEGADOR antes de mandarlas: entran como data URL en el
// doc del plan (Firestore tiene un tope duro de 1 MB por documento), así que
// una foto de 4 MB del celular tiene que salir de acá pesando unos pocos KB.
//
// No hay bucket de imágenes: el plan guarda la data URL y el widget la pinta
// tal cual. Por eso el límite de lado y la calidad son conservadores.

const MAX_LADO = 400;      // suficiente para la miniatura del pack (96px en pantalla, x2 por densidad)
const MAX_BYTES = 120000;  // ~120 KB por foto: con 6 packs y 3 regalos el plan sigue lejos del MB

/**
 * Achica una imagen elegida por el usuario y la devuelve como data URL.
 * Mantiene la proporción (a diferencia de la foto de perfil, que se recorta
 * cuadrada): el frasco o el combo se tienen que ver enteros.
 * Lanza un Error con texto listo para mostrar si algo no cierra.
 */
export function achicarImagen(file, { maxLado = MAX_LADO, maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    const tipoOk = /^image\/(jpeg|png|webp|gif|heic|heif)/i.test(file?.type || "")
      || /\.(jpe?g|png|webp)$/i.test(file?.name || "");
    if (!tipoOk) return reject(new Error("Elegí una imagen (JPG, PNG o WebP)"));

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        const ctx = c.getContext("2d");
        // Fondo blanco: un PNG con transparencia sobre JPG sale negro.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);

        // Bajamos calidad hasta entrar en el tope; si ni al 40% entra, avisamos.
        let out = "";
        for (const q of [0.85, 0.7, 0.55, 0.4]) {
          out = c.toDataURL("image/jpeg", q);
          if (out.length <= maxBytes) return resolve(out);
        }
        reject(new Error("La imagen es muy pesada. Probá con una más chica."));
      } catch (e) { reject(new Error("No pudimos procesar esa imagen")); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No pudimos leer esa imagen")); };
    img.src = url;
  });
}

/** ¿Es una foto que podemos pintar? data URL propia o link https de la tienda. */
export const esImagenValida = (v) =>
  typeof v === "string" && (/^data:image\//i.test(v) || /^https:\/\//i.test(v));
