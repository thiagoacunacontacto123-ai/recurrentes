# Recurrentes — Contexto para Claude Code

## Qué es este proyecto
SaaS de gestión de suscripciones con cobro recurrente en Mercado Pago para tiendas Shopify. Cada comerciante conecta su Shopify + su MP, crea planes por producto, y Recurrentes se encarga de generar las órdenes Shopify cada vez que MP cobra una suscripción.

**Iniciado 2026-05-31 por Thiago.** Pivot desde Growith (que sigue activo en paralelo).

## Stack
- **Frontend**: React + Vite (SPA), src/App.jsx + src/pages/
- **Backend**: Vercel serverless functions en `/api/*.js`
- **DB**: Firebase Firestore
- **Auth**: Firebase Auth (email/password para comerciantes)
- **Pagos**: Mercado Pago Subscriptions (Preapproval API)
- **Integración tiendas**: Shopify Admin API (OAuth + REST)
- **Deploy**: Vercel autodeploy en push a `main`
- **Repo**: TBD (no creado en GitHub aún)

## Estructura
```
/
├── api/                    Serverless functions
│   ├── _lib/               helpers (firebase, mp, shopify)
│   ├── shopify/            OAuth + sync productos
│   ├── mp/                 OAuth (opcional), webhook, preapproval
│   ├── plans.js            CRUD planes de suscripción
│   ├── checkout/init.js    checkout init para clientes finales
│   ├── subscribers.js
│   └── widget.js           sirve el JS embebible
├── src/                    React admin
│   ├── App.jsx
│   ├── pages/
│   ├── lib/
│   └── main.jsx
├── public/
├── index.html
├── vite.config.js
├── vercel.json
└── package.json
```

## Modelo de datos (Firestore)

```
merchants/{uid}                    ← usuario comerciante (matchea Firebase Auth uid)
  email, displayName, plan, created_at,
  shopify_shop, shopify_token, shopify_connected_at,
  mp_user_id, mp_access_token, mp_public_key, mp_connected_at

merchants/{uid}/plans/{planId}     ← planes de suscripción
  shopify_product_id, shopify_variant_id, product_title, product_image,
  frequency_days,         // 7, 15, 30, etc
  discount_pct,           // descuento % vs compra única
  units_per_shipment,     // unidades por envío
  mp_preapproval_plan_id, // id del plan en MP
  base_price_ars, subscription_price_ars,
  active, created_at, updated_at

merchants/{uid}/subscribers/{subId} ← clientes con sub activa
  customer_email, customer_name, customer_phone, customer_address,
  plan_id, mp_preapproval_id,
  status,                  // active, paused, cancelled, payment_failed
  next_charge_at, last_charge_at,
  shopify_orders[],        // ids de órdenes Shopify generadas
  created_at, updated_at

merchants/{uid}/charges/{chargeId} ← log de cobros recurrentes
  subscriber_id, mp_payment_id, amount_ars, status,
  shopify_order_id, error,
  created_at
```

## Variables de entorno (Vercel — nunca en código)

```
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
VITE_FIREBASE_API_KEY        (web SDK, prefijo VITE_)
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
MP_APP_ID
MP_CLIENT_SECRET
MP_REDIRECT_URI
SHOPIFY_API_KEY
SHOPIFY_API_SECRET
SHOPIFY_SCOPES
SHOPIFY_REDIRECT_URI
APP_BASE_URL
MP_WEBHOOK_SECRET
```

## Flujo end-to-end

### Onboarding del comerciante
1. Signup en `recurrentes.app` (Firebase Auth)
2. Dashboard pide conectar Shopify → OAuth → guarda `shopify_token` en `merchants/{uid}`
3. Pide conectar MP → opciones:
   - **MVP**: pegar Access Token manualmente
   - **F2**: OAuth de MP para que sea más limpio
4. Lista productos Shopify, comerciante elige uno y crea plan de suscripción
5. Recurrentes crea el `preapproval_plan` en MP via API
6. Genera snippet `<script src="recurrentes-app.vercel.app/widget.js?merchant={uid}">` para que el comerciante pegue en su theme

### Compra del cliente final
1. Cliente visita producto Shopify (e.g. `/products/foo`)
2. Widget detecta merchant via param o data-attribute del script
3. Pinta toggle Compra única / Suscripción
4. Si Suscripción → cambia botón "Add to cart" por "Suscribirme"
5. Click → POST `/api/checkout/init` con `{merchant_id, plan_id, customer_data, shipping_address}`
6. Backend:
   - Crea `preapproval` (no `preapproval_plan` — ese ya existe, este es la suscripción del cliente)
   - Guarda subscriber pending en Firestore
   - Devuelve `init_point` URL de MP
7. Frontend redirige al cliente a MP

### Activación de la suscripción
1. Cliente paga en MP → MP envía webhook `payment.created` con `preapproval_id`
2. `/api/mp/webhook` busca el subscriber por `mp_preapproval_id`, lo marca `active`
3. Crea orden Shopify (status: paid, line_items con variant_id, dirección del subscriber)
4. Guarda `shopify_order_id` en `charges/`
5. Email opcional al cliente: "Tu suscripción está activa"

### Cobros recurrentes
1. Cada N días MP cobra automáticamente
2. Webhook `payment.created` con `preapproval_id` del mismo subscriber
3. Misma lógica: crear orden Shopify nueva, sumar a `shopify_orders[]`
4. Si falla el cobro: marca subscriber `payment_failed`, alerta al merchant

### Cancelación / pausa
1. Merchant en dashboard toca "Cancelar" sobre un subscriber
2. Recurrentes llama MP API: `PUT preapproval/{id}` con `status: cancelled`
3. Marca subscriber `cancelled`, no más cobros

## Decisiones de diseño

- **Multi-tenant desde día 1** — la app es SaaS, no para 1 sólo cliente. Cada merchant tiene su scope completo aislado en `merchants/{uid}/*`.
- **MP Access Token paste para MVP**, OAuth después — más simple para arrancar.
- **Widget JS standalone** vs Shopify App Block — empezamos con script, después app store si arranca.
- **No cobrar el primer pago aparte**: el preapproval con `auto_recurring.start_date = ahora` cobra inmediatamente Y se queda como recurrente. Una sola integración.

## Reglas de trabajo
- Antes de tocar: `git pull origin main`
- Variables sensibles en Vercel env vars, NUNCA en código
- Commits estilo Growith: `feat:` / `fix:` / `docs:` / `ux:` / `perf:`
- API serverless en `/api/`, importable como ES modules con `export default async function handler(req, res)`
- Tests manuales con cuentas MP TEST + Shopify dev store

## Estado actual

### Implementado (MVP completo + iteración del 2026-05-31 noche)

**Stack y estructura**
- ✅ React + Vite + Vercel serverless + Firebase Admin/Auth + Firestore
- ✅ 12 funciones serverless (límite Vercel Hobby) — endpoints consolidados con `?action=` cuando hizo falta

**Frontend (admin)**
- ✅ Landing con signup/login Firebase Auth
- ✅ Dashboard 5 tabs: Inicio (KPIs) / Integraciones / Planes / Suscriptores / Cobros
- ✅ **Customer Portal** (`#/portal?token=<JWT>`) — público, JWT firmado HMAC, pause/cancel sin login
- ✅ **CheckoutSuccess** con polling al sync + redirect a Thank You de Shopify

**Backend / API**
- `_lib/firebase.js` — Admin SDK init + requireAuth + getOrCreateMerchant
- `_lib/mp.js` — wrappers a /users/me, /preapproval_plan, /preapproval, /payment
- `_lib/shopify.js` — products, customers, orders (con `shipping_lines` custom + tag "RECURRENTE")
- `_lib/email.js` — Resend (opcional, no-op si falta key)
- `_lib/sync.js` — **sincronización manual de subscriber con MP** (busca preapproval por external_reference, procesa charges, crea order Shopify, dispara email)
- `merchant.js` — GET safe + PATCH `?action=save-mp-token` + PATCH `?action=save-widget-settings`
- `plans.js` — CRUD planes con shipping config + tiers de descuento por qty
- `subscribers.js` — list/detail/patch + GET `?action=sync-pending` (sincroniza todos pendings al abrir tab)
- `charges.js` — GET con totales
- `checkout/init.js` — POST crea preapproval_plan ad-hoc + GET sincroniza subscriber con MP (sync con portal token)
- `public.js` — GET `?action=plan|sub` + POST sub actions (pause/resume/cancel) — consolidado de public/{plan,sub}
- `shopify.js` — GET `?action=oauth-start|products` + POST `?action=save-creds` — consolidado de shopify/{oauth-start,products,save-creds}
- `shopify/oauth-callback.js` — endpoint dedicado (URL hardcodeada en app Shopify del merchant)
- `mp/webhook.js` — idempotente, resuelve subscriber por external_reference o preapproval_id
- `widget.js` — JS embebible con toggle Sub/Única configurable, qty selector con tiers, desglose live (subtotal/envío/total), banner informativo

**Flow de pago**
- Cliente toca "Suscribirme" → backend crea `preapproval_plan` ad-hoc en MP con monto ajustado por qty + `payment_methods_allowed: [credit_card]`
- Redirige a `https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_plan_id=X&external_reference=mid:sid&payer_email=...&back_url=...`
- Cliente confirma en MP → MP crea preapproval automáticamente con external_reference heredado
- Cliente toca "Volver al sitio del vendedor" (MP no redirige automático) → CheckoutSuccess hace polling cada 2s al sync
- O alternativa: merchant abre Dashboard → Suscriptores → auto-sincroniza todos pendings
- O alternativa: botón manual "⟳ Sincronizar con MP" en modal del subscriber

**Features de plan (configurables en `+ Nuevo plan`)**
- Frecuencia (días), descuento base %, unidades default por envío
- Envío: precio, threshold "envío gratis desde $X", nombre custom del método
- Descuentos por cantidad: tiers configurables [{ min_qty, discount_pct }]

**Widget storefront features**
- Toggle Sub/Única configurable a nivel merchant: orden (cuál aparece primero) + default (cuál arranca seleccionada)
- Quantity selector con recálculo live de subtotal/envío/total
- Precio tachado cuando aplica descuento por cantidad
- Banner informativo: explica recurrencia + frecuencia + crédito-only + ahorro vs compra única
- Hide-form-on-sub: oculta el form Shopify (variantes + qty + Add to cart + Shop Pay) cuando está en modo sub
- Autofill email/nombre del cliente Shopify logueado
- Validación con bordes rojos + banner inline (no `alert()`)

### Estado del repo (al cierre 2026-05-31 noche)
- App deployada a Vercel: `https://recurrentess.vercel.app` (alias canónico)
- Sin repo de GitHub aún — pendiente push del user
- `.env.local` con Firebase + MP_WEBHOOK_SECRET (NO commitear)
- 11 env vars subidas a Vercel + `APP_BASE_URL`

### Pendiente para producción (pre-push)
- [ ] Verificar último deploy con sync-pending: `npx vercel deploy --prod`
- [ ] Configurar webhook a nivel cuenta MP (instantáneo, no requiere polling): https://www.mercadopago.com.ar/developers → Tu app → Webhooks → URL `https://recurrentess.vercel.app/api/mp/webhook` → eventos Subscriptions + Payments
- [ ] Crear repo en GitHub + push (.gitignore ya contempla .env*)
- [ ] Verificar firestore.rules publicadas en Firebase Console
- [ ] Test end-to-end: pago real con OTRA cuenta MP, verificar orden Shopify + tag RECURRENTE + redirect Thank You

### Out of scope (próximas iteraciones / F2)
- **Cron Vercel** que llame sync-pending periódicamente (sin que el merchant abra dashboard)
- **Checkout transparente MP SDK JS** — para filtrar débito/saldo a nivel UI (no solo plan)
- Bundles tipo mix & match (Tipo 3)
- Shopify App Block (App Store oficial)
- Multi-tenant onboarding self-service (signup → setup wizard guiado)
- Billing del SaaS (cobrar a los merchants por usar Recurrentes)
- Métricas MRR / churn en Dashboard
- OAuth MP en lugar de paste-token (F2)
