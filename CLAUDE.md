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

## Multiplataforma: perfil del negocio (desde 2026-09-14)

Recurrentes deja de ser solo "Shopify + MP". Cada merchant tiene un **perfil** en su doc (`shared/platform/profile.js`, fuente única para `api/*` y `src/*`):

| Campo | Valores | Default histórico |
|---|---|---|
| `business_type` | `physical` · `digital` (ebooks, cursos) · `service` (gimnasios, clases, membresías) | `physical` |
| `channel` | `shopify` · `tiendanube` (próximamente) · `impultienda` (ebooks, próximamente) · `none` (link de suscripción) | `shopify` |
| `payment_provider` | `mercadopago` · `stripe` (próximamente) | `mercadopago` |

- `merchantProfile(m)` devuelve `caps` (shipping, requireAddress/Phone/TaxId, catalog, orders, widget, link, packs), `ready`, `missing` y `vocab` (suscriptor/socio, producto/membresía…). **Merchants sin los campos (Lumina) = físico + Shopify + MP: comportamiento idéntico.**
- Cobro → `fulfillCharge()` en `_lib/sync.js`: `shopify` crea la orden como siempre; `none` registra el comprobante interno `rec_<payment_id>` en el lugar del id de orden (así chargeclaim / `shopify_orders[]` / `last_charge_at` no cambian). Canales "soon" devuelven error visible.
- Sin tienda: planes con `item_source:"manual"` (nombre + precio), link público `#/checkout?merchant=<id>&plan=<id>` (Checkout.jsx), sin dirección/envío si el tipo no tiene envío.
- Se elige en Configuración → Negocio (`save-settings` con `business_type/channel/payment_provider`, solo dueño; dejar Shopify con token pide `confirm_channel_change`).
- Pendiente: adapters Tiendanube / Impultienda / Stripe, moneda por merchant (todo asume ARS), renombrar `shopify_orders`/`shopify_order_id` a genéricos.

## Decisiones del 2026-09-15 (Thiago)
- **Klaviyo retirado**: `klaviyoEnabled()` devuelve siempre false (todo envío es no-op) y no aparece en ningún lado del panel. Recupero, avisos y "pagos completados" van por **Flujos de email** propios (Resend). No se crean carritos ni borradores en Shopify/Tiendanube/Impultienda: todo queda en Recurrentes.
- **Mails**: salen de `Recurrentes <hola@recurrentesapp.com>` (dominio verificado en Resend; ese dominio NO recibe mails). Todos llevan al pie "mail automático, no lo respondas · escribí a <email_reply_to de la tienda>"; los flujos no se activan sin ese mail.
- **Un solo checkout (2026-09-16)**: TODAS las suscripciones se completan en el checkout de Recurrentes (`#/checkout`), Lumina incluida. La página on-store de Shopify (`/pages/suscripcion-form`, `widget_checkout_flow/page_path`) queda obsoleta; el embed `?view=checkout` se sigue sirviendo solo por si alguna página vieja lo tiene pegado. Menos pasos de instalación y una sola experiencia (envíos en vivo, descuentos, recupero) que mantenemos nosotros.
- **Una tienda por cuenta**: Shopify y Tiendanube (e Impultienda cuando exista) se excluyen. Con una conectada, las otras plataformas NO se muestran en Integraciones, y el backend rechaza conectar la segunda (`code: "channel_taken"` en `shopify.js?action=save-creds` y en `tiendanubeApi` `tn-oauth-start` + `connectStore`, que cubre callback e instalación desde la tienda de apps). Para cambiar de plataforma hay que desvincular primero.
- **WhatsApp**: un solo número de Recurrentes para todas las tiendas (Cloud API de Meta directa, plantillas de utilidad); el costo por mensaje se le suma al comerciante con +10%.

## Integraciones y panel (tanda del 2026-09-15, rama `integracion`)
Todo apagado por env hasta que Thiago configure cada consola (ver `TAREAS_THIAGO.md`). `npm test` corre todas las suites (money-path de Lumina incluida) con Firestore en memoria y red bloqueada.
- **MP OAuth 1 clic**: `_lib/mpOauth.js` (PKCE S256, state firmado en `oauth_states`, refresh 7 días antes en cron, `invalid_grant` → "Reconectar"). Pegar token sigue como alternativa.
- **Shopify**: app creada por el comerciante (dominio + Client ID + secret) con guía `ShopifyConnect.jsx` + video (`src/lib/tutorials.js`). Scopes únicos en `shared/platform/shopify.js`. Webhooks de compliance con HMAC antes de leer Firestore.
- **Tiendanube**: `_lib/tiendanube.js` + `_lib/tiendanubeApi.js` vía `/api/shopify?action=tn-*` (rewrites `/api/tiendanube/callback|webhooks`). `fulfillCharge` rama tiendanube; `channelAvailable()` en profile.js (env `TIENDANUBE_APP_ID`+`TIENDANUBE_CLIENT_SECRET`).
- **Pasarelas alternativas**: registro `_lib/providers/` (mobbex, stripe, whop) + `_lib/charges/processProviderCharge.js` + webhook `/api/public?action=provider-webhook&p=<id>`. Flags `MOBBEX_ENABLED` / `STRIPE_ENABLED` / `WHOP_ENABLED`. En profile.js siguen "soon" (falta habilitarlos por env y la moneda USD).
- **Entrega digital**: `plan.digital_delivery` → mail con link al activar/renovar (`_lib/delivery.js`, no-op con envío).
- **WhatsApp**: Cloud API de Meta, paso `whatsapp` en flujos, `message_log`, webhook `/api/public?action=wa-webhook` (BAJA/ALTA). Plantillas en `WHATSAPP.md`.
  - **Número de Recurrentes (por defecto, 2026-09-15)**: un solo número (env `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_WABA_ID`) manda por todas las tiendas con `whatsapp_platform_enabled: true` (interruptor en Integraciones, `?action=whatsapp-platform`; crea el flujo "Aviso de próximo cobro"). `waSender()`: propio > Recurrentes > nada (nada = cero lecturas). Solo plantillas de Recurrentes (llevan el nombre de la tienda). Uso en `merchants/{mid}/usage/{AAAA-MM}` y `admin_usage/{AAAA-MM}` con `WHATSAPP_MARKUP` 1,10 (`pricing.js`); precio `WHATSAPP_PRICE_USD_UTILITY` (default 0,012). Casilla de opt-in en checkout/widget solo con WhatsApp prendido (Lumina: widget idéntico). Respuesta automática 1 vez cada 24 h (`wa_contacts`).
  - **Avisos al comercio (2026-09-15)**: el mismo número le avisa al DUEÑO cuando un cliente se suscribe / pausa / cancela / le rechazan una renovación (`_lib/merchantAlerts.js`, `notifyMerchantWhatsApp` + `notifyMerchantStatusChange`; plantillas `aviso_comercio_*` en `WA_MERCHANT_TEMPLATES`). Config en Configuración → Avisos para vos (`alerts_whatsapp_enabled`, `alerts_whatsapp` → si falta `owner_whatsapp` del dueño, `alerts_events`, `alerts_email`). Sin `alerts_whatsapp_enabled` = cero lecturas. Dedup en `alert_log` con create(). Sin WhatsApp (o si falla) sale por mail. Uso como `merchant_alert` (× 1,10).
- **Admin**: `ADMIN_EMAILS` (email verificado), `/api/stats?action=admin-*`, `#/admin`, "ver como" solo lectura con `X-Admin-As` + `admin_audit`.
- **Transferir tienda**: `_lib/transfer.js` (`/api/merchant?action=transfer-*`, `#/transferir`), `profiles/{uid}` para logins cuya principal se transfirió.
- **Confiabilidad**: `GET /api/cron?action=health` (CRON_SECRET o admin), heartbeat en `system/cron_heartbeat`, cron `retry-fulfillment` (alerta siempre; reintento solo con `FULFILL_RETRY_ENABLED=1`).
- **Conciliación con MP**: cron `?action=reconcile-mp` (cada hora, min 17) → `_lib/reconcile.js`. Agrupa tiendas por `mp_user_id` (saltea `archived_at`), lista los preapprovals de la cuenta 1 vez y cruza por id / `mid:sid` / plan ad-hoc: relink, estado según MP (nunca baja `payment_failed`), fantasmas → pending, renovaciones `recurring_payment` de 45 días sin `charges/{id}` → sync/link (máx 20). Resumen en `system/reconcile_last` (health + Admin), auditoría en `merchants/{mid}/reconcile_log`. `RECONCILE_DRY_RUN=1` solo informa.
- **Seguridad**: `firestore.rules` cierra toda lectura cliente de `merchants/*` (el panel usa el SDK web solo para Auth). Disputas de MP solo actúan si el pago releído las confirma (`_lib/webhookguard.js`).

## Foco y comunicación (desde 2026-09-14)
Tiendas online de **Argentina**: Shopify hoy; Tiendanube e Impultienda (tienda de ebooks) próximos. La landing habla de ecommerce argentino. Los tipos digital/servicio y la venta por link siguen en el producto, pero no son el foco comercial.

## Planes del SaaS (desde 2026-09-14)
Precio por **suscriptores activos** (`status` active o payment_failed), fuente única en `shared/platform/pricing.js`. **Escala del 2026-09-16:** Free hasta 10 · Starter USD 49 (11–50) · Growth 99 (51–100) · Scale 199 (101–300) · Pro 349 (301–1000) · Business 499 (1001–2000) · Enterprise 749 (2001–5000) · Max 999 (5001–10000) · Unlimited 1999 (10001–20000) · Ultra 2999 (+20000). Instalación gratis. (Escala anterior: Free hasta 5 · Starter USD 29 (6–30) · Growth 69 (31–100) · Scale 99 (101–300) · Pro 149 (301–1000) · Unlimited 299 (+1000). Todo incluido en todos. Sin prueba de 7 días ni bloqueo del panel: si le corresponde un tramo pago muestra aviso y "Activar plan" (plan-request); lo confirmamos a mano con `plan_activated: "<tier>"` en el merchant. Cuentas creadas antes de 2026-09-13 sin plan pago = **beta** (Lumina), sin cargo.

## Integraciones evaluadas (investigación 2026-09-14)
- **Tiendanube**: API confirmada para leer productos, crear órdenes pagas (`POST /orders`, `payment_status: paid`) e inyectar scripts (app de Partner, scope `scripts`). **Tiene suscripciones nativas** (solo Pago Nube + crédito, plan Impulso+, sin variantes, 1 producto con suscripción por carrito): nuestro espacio es MP / débito, variantes y packs.
- **Impultienda**: sin API pública ni app store encontrada → pedirles acceso.
- **Pasarelas elegidas (Thiago, 2026-09-14): Mercado Pago, Mobbex, Stripe y Whop** — el resto (Pagos360, Payway, Getnet, Nave, PayPal, Ualá Bis, MODO) queda afuera por ahora.
  - Mobbex: API de suscripciones + tokenización + plugins Shopify/TN (multi-comercio por OAuth no confirmado).
  - Stripe: para **digitales y ventas al exterior en USD** (Impultienda, cursos, infoproductos). No abre cuentas a comercios argentinos: se usa con una cuenta Stripe afuera (ej. empresa en EE.UU.). El foco es Argentina, pero muchos venden afuera.
  - Whop: API con planes recurrentes, webhooks (cobro, fallo, alta, baja, reembolso) y cuentas conectadas tipo Connect. Sirve para **digitales al exterior en USD** (Impultienda); no cobra en pesos a compradores locales y lo físico está verde. Comisión 2,7% + USD 0,30 + 0,5% recurrente. Probar alta y retiro con una cuenta argentina real antes de invertir.
- **Después del cobro**: factura ARCA (TusFacturas con webhook, Facturante en TN, Xubio, Contabilium), WhatsApp (Twilio / Botmaker), logística (Zipnova con OAuth multi-cliente, Andreani, Correo Argentino, Envia, Enviopack), email (Perfit, Doppler).
- **Gimnasios** (investigación 2026-09-14, datos de mercado mayormente de blogs de proveedores): GymGestión, GymSmartAccess y LumiaFIT ya cobran con suscripciones MP y cortan el acceso por mora → competencia, sin API pública. Fitco está en AR pero con MP solo cobra pagos únicos (hueco). Wodify tiene API (suspender/reactivar socios) pero no se confirmó uso en AR. Acceso: domina ZKTeco (huella/facial); también QR sin hardware. Integración sugerida: webhook de salida + `GET estado-socio` (al día / moroso, sale de `active`/`payment_failed`) + pase QR en el portal.
- Prioridad sugerida: 1) app Tiendanube · 2) Mobbex · 3) factura ARCA por cobro · 4) Stripe y Whop para digitales al exterior · 5) avisos por WhatsApp.

## Flujos de email propios (desde 2026-09-15)

Recurrentes manda sus propios mails automáticos (Resend, `api/_lib/email.js`); Klaviyo queda opcional.
- **Definición compartida**: `shared/platform/flows.js` — disparadores (`checkout_started`, `activated`, `upcoming_charge` con `days_before`, `renewed`, `payment_failed`, `paused`, `resumed`, `cancelled`), variables (`{{nombre}}`, `{{producto}}`, `{{monto}}`, `{{marca}}`, `{{proximo_cobro}}`, `{{link_portal}}`, `{{link_checkout}}`), plantilla inicial por disparador y `sanitizeFlow`.
- **Datos**: `merchants/{mid}/flows/{id}` { name, trigger, active, steps[{type:"wait",amount,unit}|{type:"email",subject,body,cta,cta_label}], stats } · `merchants/{mid}/flow_runs/{runId}` (copia de los pasos al entrar, `step`, `next_at` solo mientras espera, status waiting/completed/exited/error). runId determinístico → el mismo evento no entra dos veces.
- **Motor** `api/_lib/flows.js`: `emitFlowEvent` (no lee NADA si `merchant.flows_active_triggers` no incluye el disparador → Lumina sin flujos = cero cambios en el camino del cobro; nunca lanza) y `runFlowsForMerchant` (cron `/api/cron?action=run-flows` cada 5 min). Antes de cada mail relee la suscripción: sale si pagó / recuperó la tarjeta / se reactivó (keep/avoid/goal por disparador), o si se dio de baja (`unsubscribes`). Cada mail lleva List-Unsubscribe + link de baja y queda en `email_log` (type "flow", flow_name).
- **Enganches**: `sync.js` notifyActivation / notifyRenewal / sendPaymentFailedEmail (cubre webhook + sync), `subscribers.js` (panel), `public.js` (portal + pausa por retención), `checkout/init.js` (lead y Pagar).
- **API** (sin funciones nuevas): `/api/merchant?action=flows` (GET) · `flow-save` · `flow-delete` · `flow-test` (POST, `_lib/flowsApi.js`); guardar recalcula `flows_active_triggers` / `flows_enabled`.
- **Panel**: `src/pages/Flows.jsx` (menú Clientes → Flujos de email; permiso de equipo "flujos").
- Los mails transaccionales de siempre (activación, pago rechazado, cancelación) siguen saliendo aparte.

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
- **Dominio propio desde 2026-09-15: `https://recurrentesapp.com`** (Squarespace → Vercel: A `@` + CNAME `www`). `https://recurrentess.vercel.app` sigue vivo y NO se da de baja: webhooks de MP de las suscripciones de Lumina, widget pegado en su tema, links de mails ya enviados y redirect de su app de Shopify apuntan ahí.
- App deployada a Vercel: `https://recurrentess.vercel.app` (alias original)
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
