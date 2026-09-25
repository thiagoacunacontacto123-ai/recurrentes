# Plantilla: demo "tu tienda en versión suscripción"

Base para armar en minutos la demo de una marca (primera: G4U, 25-sept-2026). Es UN solo
HTML sin dependencias (las fotos van por URL al CDN de la tienda), pensado para celular y compu.

Qué trae: header con nav (en celular, fila deslizable), bloque de intro de suscripción, la
página del producto (galería, bullets, packs 1/4/8 con precio de suscripción), **armá tu pack**
como el de la app de bundles de G4U (casilleros "Suma otro producto" + modal "Elegí un
producto"), frecuencia (15 días / mes / 2 meses), **carrito** (frecuencia editable, cantidad de
packs, upsells "Sumá a tu suscripción"), **checkout** con el diseño de Recurrentes en los
colores de la marca (envío al cargar dirección, Mercado Pago marcado, "Pagar suscripción · $X")
y pantalla de "suscripción activa". Todo de mentira: no cobra ni guarda nada.

## Armar una demo nueva
1. Colores y letra: `:root` del template (`--wine`, `--cream`, `--rose`…) y el `<link>` de Google Fonts.
2. Datos: un `assets.json` con `logo`, `gallery` (fotos del producto), `items` (catálogo para el pack:
   handle, título, subtítulo, precio, foto) e `icons` (los 4 del bloque de beneficios). Para Shopify:
   `https://tienda/products/<handle>.js` y `https://tienda/products.json?limit=250` (públicos).
3. Textos: bullets, acordeón, testimonios y footer están en el HTML (buscá "G4U").
4. `node demos/plantilla-tienda/armar.mjs demos/plantilla-tienda/<marca>.assets.json public/demos/<marca>.html`
   → queda en `https://www.recurrentesapp.com/demos/<marca>.html` al pushear.

Reglas que salieron de G4U: el pack de 1 viene preseleccionado; el primer casillero trae el
producto de la página; los packs del catálogo (combos) no entran al selector; nada de fotos
embebidas en base64 (los artefactos de claude.ai quedaban en blanco y pesan 1 MB).
