# Plantilla: demo "tu tienda en versión suscripción"

Base para armar en minutos la demo de una marca (primera: **G4U**, 25-sept-2026,
`https://www.recurrentesapp.com/demos/g4u.html`). Es UN solo HTML sin dependencias (las fotos
van por URL al CDN de la tienda), pensado primero para **celular** (el 95% compra desde ahí).

## Cómo se arma (5 pasos, ~20 min)
1. **Datos públicos de Shopify** (sin login): `https://tienda/products/<handle>.js` (galería, precio,
   descripción) y `https://tienda/products.json?limit=250` (catálogo). Colores y letra: mirar el
   `page.html` (`#hex` más repetidos, `font-family`). Logo: `img.header__heading-logo`.
2. **Reseñas tal cual**: si usan Revie, la página trae un `<script data-rvw2-list>` con TODAS las
   reseñas en JSON (nombre, estrellas, texto, fecha, foto) y `data-rvw2-data` con el promedio.
   Se leen desde el navegador (renderizado con JS) y van a `assets.json` como `reviews`.
   Fotos: host `revie-media.b-cdn.net/<...>.jpg?height=200&quality=90`.
3. `<marca>.assets.json`: `logo`, `gallery`, `items` (catálogo para el pack: handle, título,
   subtítulo, precio, foto), `icons` (bloque de beneficios), `reviews`, `testimonials`.
4. Textos en el HTML (buscar "G4U"): bullets, acordeón (mismas preguntas que la tienda),
   marquesina, footer, envíos (los mismos métodos y precios que ven hoy en su checkout).
5. `node demos/plantilla-tienda/armar.mjs demos/plantilla-tienda/<marca>.assets.json public/demos/<marca>.html`
   → al pushear queda en `recurrentesapp.com/demos/<marca>.html`. Copia en
   `~/Downloads/Recurrentes - Contenido IG/Demos/`.

## Qué trae la demo (y por qué)
- Header igual al de la tienda (en celular: hamburguesa + logo centrado + carrito, nav debajo),
  **marquesina** arriba (sus avisos, una frase cada ~3 s), **sello** "demo.recurrentes para <logo>"
  abajo a la izquierda en verde Recurrentes.
- Bloque de intro de suscripción (Puentify style): beneficios + 3 pasos.
- Página del producto **tal cual la de ellos** + "· Suscripción" grande en el título, packs con
  precio de suscripción y tachado, **armá tu pack** como su app de bundles (casilleros "Suma otro
  producto" dentro del pack + modal "Elegí un producto"), frecuencia (15 días / mes / 2 meses).
- **Carrito** (drawer): pack · N ítems, frecuencia editable, "Sumá a tu suscripción" (upsells),
  "Finalizar suscripción" / "Seguir viendo".
- **Checkout** con el diseño real de Recurrentes en sus colores (envío al cargar dirección, Mercado
  Pago con logo marcado, "Pagar suscripción · $X", "← Volver a la tienda", logo Recurrentes al pie).
- Pantalla "suscripción activa" → **portal del suscriptor** (`#portal`) en sus colores, con las
  acciones REALES del portal: pausar/reactivar, cambiar dirección (modal con "se usa desde tu
  próximo envío"), cancelar con motivos y oferta de pausa. Nada de prompt/confirm del navegador.
- Reseñas: carrusel de citas + bloque **Revie idéntico** (RESEÑAS, 4.97, "Reviews por Whatsapp by
  revie", 3 por página con paginación).

## Reglas que salieron de G4U (Thiago)
- En computadora, la galería del producto queda **fija (sticky)** mientras se desliza la descripción, como
  en Shopify; las reseñas de Revie NO son parte del producto: van centradas debajo, como sección de la landing.
- Todo tiene que verse **perfecto en celular**: márgenes de 20 px a los costados en TODAS las
  secciones (ojo: el padding de una sección pisa el del `.wrap`), nada pegado a los bordes.
- El pack de 1 viene preseleccionado; el primer casillero trae el producto de la página; los
  combos del catálogo no entran al selector.
- **Nada de modificar el pack después de suscribirse** (ni en portal, ni carrito, ni checkout):
  solo pausar, dirección y cancelar. Sin "saltar envío" (el portal real no lo tiene).
- Botones: "Suscribirme · $X cada mes" + "Ahorrás $Y en cada envío"; "Pagar suscripción · $X";
  "Finalizar suscripción". Sin subtítulos inventados en las frecuencias.
- Sin fotos embebidas en base64 (pesan 1 MB y los artefactos de claude.ai quedaban en blanco): se
  publica en nuestro dominio, `public/demos/`.
- Envíos en la demo = los que la tienda ya muestra (tarifa plana, sin sucursales).

- `main` (opcional) en el assets.json: handle del producto de la página; en el modal de armá-tu-pack va primero, como en la app de bundles de la tienda.

## Emily Cosmetic (3-oct-2026) — el pack es el TIEMPO, no la cantidad
`emily.template.html` + `emily.assets.json` → `public/demos/emily.html`.

Su ficha vende packs de **1 / 3 / 6 cremas** con la app **Kaching Bundles** (6x3 $126.900,
3x2 $76.900, 1 $39.500) más add-on del sérum y regalos (3.ª crema, guía, sorteo de botas).
Para suscripción eso NO se copia tal cual (Thiago, 3-oct): **un pote rinde 30 días**, así que
el pack es el tiempo de tratamiento — **1 crema = 1 mes · 2 cremas = 2 meses** — y nadie se
compromete a 6 meses de una. La frecuencia la define el plan: no hay selector aparte, igual
que nuestro widget en modo packs.

Diferencias con la plantilla de G4U:
- **Sin armá-tu-pack**: no hay casilleros ni modal de elegir producto (acá es un solo producto).
- **Regalos del primer envío** dentro de la tarjeta del plan, en el carrito y en el checkout, a
  $0 y con el tachado: 1 crema → Guía de cuidado corporal; 2 cremas → Guía + Cepillo Corporal.
  Son productos REALES de su tienda, así que pueden viajar en la orden (`gift.shopify_variant_id`).
- **Sin bloque de Revie** (no la usan): sus 4 reseñas van en el carrusel de citas.
- Paleta: botón rosa `#e49aa7` (su "COMPRAR AHORA"), bordó `#6e2437` del título de su hero,
  header BLANCO con el logo rosa, Montserrat, radio 8 px.
- Envío gratis a todo el país en todos los planes (es lo que dicen sus packs hoy).

**Ojo si después se instala el widget en su ficha**: Kaching está en `KNOWN_BUNDLES`, así que
`detectForeignBundles()` lo esconde solo. Eso es lo que queremos, pero hay que avisarle al
comercio: el 6x3 y el 3x2 de compra única dejan de verse en esa página.

**4-oct-2026 · la ficha es un CLON de la de ellos** (`emilycosmetic.ar/products/crema-anticelulitis-emily`):
mismas secciones, orden, textos, colores y fotos (clases `e-*` en `emily.template.html`); lo único
distinto es el bundle (planes 1 crema / 2 cremas con el formato de sus tarjetas, sérum como casillero
a $23.730, regalos en renglones a $0) y los textos que lo nombran. Carrito, checkout y portal no cambian.

## G4U (7-oct-2026) — catálogo + 9 fichas en versión suscripción
Thiago: "el link madre del catálogo de productos versión suscripción, y de ahí cada producto".
- `g4u.relevar.mjs` baja de g4u-ar.com (sin login) los 9 productos sueltos en orden de más vendidos
  (precio de hoy, galería, reseñas de Revie tal cual) → `g4u.productos.json`. Los packs/combos no entran.
- `g4u.armar.mjs` genera `public/demos/g4u.html` (catálogo, clon de su /collections/all con precio de
  suscripción y botón "Suscribirme" por tarjeta) y `public/demos/g4u-<producto>.html` con `template.html`,
  que ahora toma lo del producto de `A.*` (title, price, main, gallery, reviews, review_summary, mismo,
  iwt_text, catalog_url, page_title); sin esos campos sigue siendo el pan de molde.
- `g4u.assets.json` quedó solo con lo de la marca (logo, íconos, testimonios).
- Envío gratis desde $95.000 (su tienda lo subió de 85 a 95). Regla de todas las demos: ícono del
  carrito que reabre el carrito y cartelito verde en los links sin destino.
- Pasos de instalación/diseño para Thiago: `docs/g4u-suscripcion-pasos.txt`.
