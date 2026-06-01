# Setup de Recurrentes (para el dueño de la plataforma — Thiago)

Esta guía es para vos, NO para los comerciantes que usen Recurrentes. Los merchants solo van a hacer click "Conectar Shopify" + pegar Access Token MP.

## Paso 1 — Firebase (10 min)

1. Entrá a [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → "recurrentes-app".
2. **Authentication** → Get started → Sign-in method → habilitá **Email/Password**.
3. **Firestore Database** → Create database → start in **production mode** → región `southamerica-east1`.
4. **Project Settings (engranaje arriba a la izq)** → **Service accounts** → **Generate new private key** → descargá el JSON.
5. Abrí ese JSON, vas a usar 3 campos:
   - `project_id`
   - `client_email`
   - `private_key` (cuidado con los `\n`)
6. **Project Settings** → **General** → bajá hasta **Your apps** → **Web** (`</>`) → registrá app web "Recurrentes Web" → copiá el config object (apiKey, authDomain, etc).
7. Pegá todo en `.env.local` (basado en `.env.example`).

## Paso 2 — Shopify Partners (15 min)

1. Creá cuenta en [partners.shopify.com](https://partners.shopify.com) (gratis).
2. **Apps** → **Create app** → **Public app**.
   - App name: "Recurrentes"
   - URL: `https://recurrentes-app.vercel.app` (cambiamos después del primer deploy)
   - Redirect URLs: `https://recurrentes-app.vercel.app/api/shopify/oauth-callback`
3. **App setup**:
   - Distribution: Custom distribution (mientras no querás App Store)
   - Embedded in Shopify admin: NO (somos external)
4. Copiá **API key** y **API secret key** al `.env.local` (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`).
5. Para testear: en Partners → **Stores** → **Add store** → **Development store** → creá una tienda de prueba con productos demo.

## Paso 3 — Mercado Pago Developers (5 min)

1. Entrá a [mercadopago.com.ar/developers](https://www.mercadopago.com.ar/developers) y logueate con tu cuenta MP **de comercio** (la que cobra).
2. Click en **`Integraciones`** arriba a la derecha (al lado de "Tu cuenta"). Si te trae a docs.mercadopago.com — buscá el link "Tus integraciones" en el header, o entrá directo a https://www.mercadopago.com.ar/developers/panel/app.
3. **Crear aplicación** (botón violeta arriba a la derecha).
   - **Nombre**: `Recurrentes` (o como vos quieras)
   - **¿Qué productos vas a integrar?** → marcá:
     - ✅ **Suscripciones (preapproval)** ← KEY
     - ✅ Checkout Pro (opcional, para futuros pagos one-shot)
   - **Actividad principal**: lo que sea (ej. "Tecnología")
   - **Modelo de integración**: "Plataforma propia" o el que aplique
4. **Crear aplicación**.
5. Te abre el panel de la app. En la sidebar izquierda click **`Credenciales de prueba`** (TEST).
6. Copiá el **Access Token TEST** — empieza con `TEST-...`. Es el único valor que necesitás para empezar.
7. Después, en el Dashboard de Recurrentes → tab **Integraciones** → botón **"Pegar Access Token"** → pegás el TEST y guardás.
8. Para LIVE (producción), repetís el paso 5 con la pestaña **Credenciales de producción** y pegás el de ahí cuando estés listo para cobrar real.

**Sobre `MP_APP_ID` / `MP_CLIENT_SECRET` en el `.env`**: dejá en blanco. Son para OAuth (F2 — que vos como SaaS conectes la cuenta del merchant en vez de pegar token). Para el MVP cada merchant pega su propio Access Token, así no hace falta.

**Sobre `MP_WEBHOOK_SECRET`**: poné cualquier string random largo, ej.
```
MP_WEBHOOK_SECRET=recurrentes_2026_xK9aL2mP8qR4tY6uW3vN1bX5cZ7d
```
Se usa para firmar los tokens JWT del customer portal — NO tiene que coincidir con nada de MP, es solo nuestro secret interno.

## Paso 4 — Vercel deploy (5 min)

1. Push del repo a GitHub.
2. En [vercel.com/new](https://vercel.com/new) → import del repo.
3. **Environment Variables** → pegá todas las del `.env.example` con sus valores reales.
4. **Deploy**.
5. Tomá la URL final (algo como `recurrentes-app.vercel.app`) y volvé al `.env` para actualizar `APP_BASE_URL`, `SHOPIFY_REDIRECT_URI`, `MP_REDIRECT_URI` con ese dominio.
6. Re-deploy.
7. En Shopify Partners → tu app → actualizá los Redirect URLs con el dominio Vercel final.

## Paso 5 — Probar end-to-end

1. Andá a tu Vercel URL → "Crear cuenta" → signup con tu email.
2. **Conectar Shopify** → ingresá `tu-dev-store.myshopify.com` → autorizá.
3. **Conectar MP** → pegá tu Access Token TEST.
4. **Planes** → elegí un producto → frecuencia 7 días → 15% descuento → crear.
5. Tomá el snippet `<script src="...">` y pegalo en el theme de tu dev store (Online Store → Themes → Customize → Theme code → product template → al final del `<form action="/cart/add">`).
6. Visitá la página del producto → debería aparecer el toggle Compra única / Suscripción.
7. Click "Suscribirme" → redirect a MP TEST → pagás con tarjeta de prueba.
8. Volvés a Recurrentes → **Suscriptores** → debería estar el nuevo subscriber.
9. En tu Shopify dev store → **Orders** → debería estar la orden generada automáticamente.

## Cuentas / credentials que necesito de vos

Cuando termines los pasos 1-3, mandame **los valores** del `.env` (sin las private keys completas — esos los pegás directo en Vercel). Yo verifico que esté todo y deployamos.

Para test inicial alcanza con:
- Firebase config (apiKey + projectId del web SDK)
- Firebase Admin (clientEmail + privateKey)
- Shopify API Key + Secret
- Tu Access Token MP TEST

LIVE se configura después cuando estés listo para clientes reales.
