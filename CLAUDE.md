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
META_PIXEL_ID                (pixel PROPIO de Recurrentes, adquisición)
META_CAPI_TOKEN
VITE_META_PIXEL_ID           (el mismo pixel, para el navegador)
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
- **Paso 2 obligatorio al conectar Shopify (2026-09-16)**: al volver del OAuth no se suelta al comerciante en Integraciones: se abre `ShopifyStep2Modal` (snippet + instrucciones) y solo se cierra cuando `widget.js` avisó que cargó en la tienda. El aviso es un beacon `GET /api/public?action=widget-seen&merchant=&host=` (imagen 1×1, 1 vez por sesión del visitante) que escribe `widget_last_seen_at/host` en el merchant (máx. cada 10 min). Se muestra en Config → Shopify → Ajustes y da por hecho el paso "snippet" del onboarding.
- **MP compartido entre tiendas del mismo dueño (2026-09-16)**: `PATCH /api/merchant?action=mp-reuse` `{from_merchant_id}` copia server-side las credenciales de MP de otra tienda propia (queda `mp_method:"manual"`, `mp_shared_from`; sin refresh propio). Botón en Integraciones → Mercado Pago cuando la tienda no tiene MP y otra sí (archivadas excluidas). Usado en DEMO SHOPIFY con la cuenta de DEMO TN/Lumina.
- **Cobro del plan por fecha + Stripe (2026-09-16)**: el plan se cobra cada 30 días desde el primer pago (`plan_activated_at`) y ese día se cobra el tramo que corresponda a los suscriptores activos EN ESE MOMENTO; nunca diferenciales a mitad de ciclo (decisión de Thiago). `buildBilling` devuelve `plan_activated_at/last_paid_at/next_payment_at/billing_method/saas_status/stripe_available`. Con `STRIPE_SAAS_SECRET_KEY` + `STRIPE_SAAS_WEBHOOK_SECRET` (cuenta Stripe de Thiago) el botón "Activar" abre Stripe Checkout (`merchant?action=saas-checkout`), el webhook `/api/public?action=stripe-saas-webhook` activa/renueva/marca past_due, `saas-portal` abre el portal de Stripe, y el cron diario `sync-saas-tiers` (9:00 UTC) mueve la suscripción de Stripe al tramo vigente sin prorrateo (tramo free → cancel_at_period_end). Sin las env, sigue el flujo `plan-request` (te contactamos). Módulo: `api/_lib/saasBilling.js`.
- **Compra única = botón nativo del tema (2026-09-17)**: en modo packs, al elegir "Compra única" el widget esconde su CTA y muestra el Agregar al carrito del tema (más Shop Pay, etc.) con la cantidad del pack: sincroniza el input de cantidad, agrega un hidden `quantity` si el tema no tiene y, en Shopify, intercepta fetch/XHR a `/cart/add` de esa página solo en ese modo para forzar la cantidad (temas tipo Horizon la mandan desde su estado). En "Suscripción" se esconden los botones del tema y manda nuestro CTA → checkout de Recurrentes. Igual en Tiendanube. Verificado en DEMO SHOPIFY (drawer del tema con qty 2).
- **Tiendas internas (2026-09-17)**: las tiendas de Thiago (Lumina + DEMO SHOPIFY + DEMO TN) llevan `internal: true`. `isInternal(m, adminEmails())` en `plans_saas.js` también las detecta si el mail del dueño está en `ADMIN_EMAILS`. Efecto: `isBeta()` las da siempre sin cargo (no pagan plan ni ven "Activar plan") y el Admin las excluye de TODOS los agregados (comercios, MRR, suscripciones activas, MRR del SaaS, altas por día). Se ven con el filtro "Mías" de la tabla (`admin-merchants&internal=1`) y el resumen viene en `overview.internal { count, subs, mrr, names }`.
- **Límite del plan gratis (2026-09-17, Thiago)**: `shared/platform/enforcement.js` (fuente única api/ + panel). Por suscriptores activos: 1–10 ok · 11–15 **gracia** (5 de regalo: barra roja fija que no se cierra + `PlanLimitModal` al entrar, pero widget y checkout siguen vendiendo) · 16+ **bloqueado** (`widget.js` no se pinta y la página queda como antes; `checkout/init` responde 402 `plan_required`; panel en solo lectura: Planes/Widget/Retención/Flujos/Portal cerrados con `PlanBlockedView`, Cobros/Suscripciones/Analíticas/Config abiertos). `buildBilling` devuelve `enforcement/can_sell/grace_left/locked/must_pay/enforcement_copy`. Al que paga (`saasPaid`) no se le muestra nada; `past_due` NO bloquea solo (vuelve a la regla por cantidad). Beta e internas nunca. **Nunca se corta el camino del cobro**: webhooks, cron, órdenes y portal siguen en cualquier estado (2 tests lo prueban en `tests/money-path/plan-limit.test.mjs`). El contador `billing_cache.subs` se recuenta al activar/cambiar de estado una sub (`refreshPlanLimit` en sync.js) y ahí sale el aviso al dueño por WhatsApp desde el número de Recurrentes (`notifyPlanLimit`, plantillas `aviso_plan_gracia` / `aviso_plan_borde` (queda ≤1) / `aviso_plan_bloqueado` (redactadas como aviso de estado de cuenta: la v1 Meta la reclasificó Marketing). El recargo NO se muestra en ningún copy: el panel dice solo el precio por mensaje (Thiago); salen SIEMPRE, sin depender de `alerts_whatsapp_enabled`; dedup 1 por número de suscriptor, bloqueo 1 por día; también por mail). El paso a paso de onboarding ya no se abre solo al entrar.
- **Stripe del SaaS EN VIVO (2026-09-17)**: `STRIPE_SAAS_SECRET_KEY` + `STRIPE_SAAS_WEBHOOK_SECRET` cargadas en Vercel (tipo Secret: no se pueden volver a leer, ni con `vercel env pull`). Webhook "Recurrentes SaaS" con 6 eventos (checkout.session.completed, invoice.paid, invoice.payment_succeeded, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted). Verificado: `saas-checkout` desde DEMO SHOPIFY devolvió un Checkout en checkout.stripe.com (ya existe el producto "Recurrentes · Starter"). Pendiente de Thiago en Stripe: "Acción requerida" / verificar cuenta (sin eso cobra pero no gira), industria SaaS, descripción del producto y descriptor `RECURRENTES`.
- **Número de WhatsApp de Recurrentes EN VIVO (2026-09-17)**: +1 305 686 9014 (Zadarma, recibe SMS; WABA `1377371627894423`, phone id `1319380847922196`), env `WHATSAPP_*` cargadas en Vercel, webhook verificado. Tres ramales: clientes de los comercios (solo con `whatsapp_platform_enabled`, se le cobra al comercio con **+50%**), comercios (`merchantAlerts.js`) y **admin** (`adminAlerts.js`, `notifyAdmin`: registro con número, pago/rebote/baja del plan, gracia/bloqueo; una plantilla por evento `aviso_admin_*` con `aviso_admin` genérica de respaldo; `sendWelcomeWhatsApp` manda `bienvenida_recurrentes` al comercio nuevo; destino `ADMIN_WHATSAPP` o el `owner_whatsapp` del admin; respaldo por mail a `ADMIN_EMAILS`). Las plantillas se crean por API desde Admin (`admin-wa-templates` / `admin-wa-templates-sync`, `waTemplates.js`). Pendiente en Meta: método de pago en la WABA y pasar la app a **En vivo** (en desarrollo solo manda a números de prueba, error 131030).
- **Flujos de WhatsApp (2026-09-18)**: sección propia en Clientes (`src/pages/WhatsAppFlows.jsx`, tab `whatsapp`, debajo de Flujos de email). El comercio NO edita textos: prende/apaga cada una de las 5 plantillas a clientes (`WA_TEMPLATES`; **carrito sin pagar primero**, categoría MARKETING → precio `WHATSAPP_PRICE_USD_MARKETING` default 0,0618, con 1 h de espera; ninguna viene prendida por defecto, el interruptor de Integraciones ya no crea flujos) y ve el gasto del mes y de los 2 anteriores. Cada interruptor es un **flujo de sistema** `wa_template:<name>` con un único paso whatsapp (hereda dedup, opt-out, cobro × 1,50 y message_log del motor); Flows.jsx los filtra. API en `whatsappApi.js`: GET `whatsapp-flows`, POST `whatsapp-template-toggle {name, active}` (dueño; 400 `not_enabled` sin WhatsApp prendido). Sin WhatsApp prendido la sección muestra el cartel a Integraciones con el costo (Meta + 50%). Los miembros la ven con el permiso de "flujos".
- **Afiliados (2026-09-18, portado de Growith)**: `api/_lib/referrals.js`. Cada LOGIN tiene `ref_code`; la landing guarda `?ref=` en `localStorage.rec_ref` (Auth.jsx) y Dashboard lo reclama con `POST merchant?action=ref-claim` (solo cuentas de <30 días sin plan pago; también `save-owner {ref_code}`). En el webhook de Stripe (`checkout.session.completed` e `invoice.paid` de renovación) `creditCommission` acredita al referente del DUEÑO de la tienda el **15% del precio de lista USD del tramo** (`ref_ledger/pago_<id>`, idempotente) y lo empuja como **saldo del cliente en Stripe** (`balance_transactions` negativa) si ya tiene customer; si no, queda en `ref_credit_pending_usd` y se empuja en su primer checkout. Panel: nav **Afiliados** (solo dueños, `src/pages/Referrals.jsx`, `GET ref-me`). **Precio por tienda**: cada tienda paga su tramo según SUS suscriptores (20 y 20 = 49 + 49); no hay descuento por tienda extra.
- **Fuera lo digital, Impultienda, Stripe y Whop (2026-09-19, Thiago)**: "la suscripción a un producto digital no necesita órdenes nuevas, nuestro trabajo es cero". En `profile.js` quedan por compatibilidad con `retired: true` (tipo `digital`) / `status: "retired"` (canal `impultienda`, pasarelas `stripe` y `whop`) y NO se muestran en Integraciones, BusinessProfile, landing ni onboarding; `src/pages/UsdProviders.jsx` se borró (el backend `_lib/providers/` y sus tests siguen, apagados por env). Mobbex sigue como "próximamente". **Ayuda = solo Preguntas** (`GUIDE_SECTIONS` tiene una sola pestaña; las secciones viejas quedan en el código por links viejos). El **Stripe del SaaS** (cobrarle el plan a las tiendas) no tiene nada que ver y sigue igual.
- **Otros bundles: se esconden solos (2026-09-20, Thiago: "todos usan app")**: hasta hoy el widget solo escondía el selector de cantidad NATIVO del tema (Shopify: `quantity-input`/`.quantity__rules`; Tiendanube: hooks `data-store`/`js-*`); una app de bundles (Kaching, Pumper, Selleasy…) o un Liquid propio quedaban duplicados salvo que el comercio pegara el selector en Config → Widget (`widget_hide_selector` / `&hide=`). Ahora `detectForeignBundles()` en `api/widget.js` (dentro del template literal: regex con barras dobles) esconde solo (1) las apps conocidas (`KNOWN_BUNDLES`, ~15) y (2) por heurística dentro del bloque de compra: elementos con clase/id tipo bundle/pack/volume/upsell, o con ≥2 precios + "x2 / unidades / pack / combo / c/u"; nunca toca precio, título, galería, variantes, carrito, drawer, header ni footer. Se aplica en packs (al montar y en cada cambio de modo, los dos modos) y en el clásico (solo en suscripción; compra única restaura). Re-mira a los 0,8/2/4/8 s porque las apps inyectan tarde. El beacon `widget-seen` lleva `hid=<nombres>` → `merchants.widget_verified_hidden`, y el panel lo dice en la tarjeta de verificación. Probado en una página falsa con Kaching + Liquid + bundle en el carrito. **Regla "uno u otro, SIEMPRE"**: a los 3 s de estar visible, `foreignConflict()` mira si sigue a la vista otro selector que no supimos esconder (apps con shadow DOM = elementos custom con `shadowRoot` visibles cerca del form; o un bloque con ≥2 precios + "x2/unidades/pack" medido SIN lo nuestro, sin el form ni la descripción): si lo hay, `restoreTheme("bundle_conflict")` deja SU bundle y apaga el nuestro, y el beacon manda `reason=bundle_conflict&hid=<tag>` → cartel en el panel: "tu integración funciona bien pero usás una app/tema que aún no tenemos; escribinos y te lo dejamos a mano, gratis". Tests en `widget-verify.test.mjs`.
- **Checkout personalizable, estilo Shopify (2026-09-24, Thiago: "que cada persona pueda cambiar su checkout")**: `src/pages/Checkout.jsx` rediseñado: formulario plano a la izquierda (Contacto · Entrega · Envío · Pago, campos con etiqueta flotante), resumen gris a la derecha con el producto, el cupón, las líneas y el Total; en celular el resumen es un acordeón arriba ("Mostrar resumen del pedido · $X") o va antes del botón. El envío NO se cotiza hasta que hay CP o provincia (antes se pintaba el del plan): el resumen dice "Completá tu dirección". **Tema por tienda** en `merchants.checkout_theme` (PARCIAL, solo lo tocado; fuente única `shared/platform/checkoutTheme.js`: `sanitizeCheckoutTheme` / `resolveCheckoutTheme` / `ctaText`): `color` (default = `widget_color`), `bg`, `summary_bg`, `text`, `font` (system | inter | serif, Google Fonts), `radius`, `header_text`, `cta_text` (`{{total}}`), `footer_text`, `show_logo` (store_photo), `show_discount`, `show_trust`, `show_policies` + `policies_text` / `terms_url` / `privacy_url`, `summary_mobile` (top | before_pay). Se guarda por `save-settings { checkout_theme }` ({} = default) y el comprador lo recibe RESUELTO en `public?action=plan&checkout=1 → checkout.theme` (+ `store_logo`). Panel: **Configuración → Checkout** (`src/pages/CheckoutDesigner.jsx`): controles + el checkout REAL en un iframe (`#/checkout?preview=1&theme=<json>` con el primer plan activo; los cambios viajan por `postMessage {type:"rec-checkout-theme"}` sin recargar; en preview no hay eventos, leads ni pago). **El "cargando" gira del color de la tienda**: `AppLoader` acepta `color`; el widget pasa `&color=<acento del checkout>` en TODAS las URLs al checkout (`CHECKOUT_COLOR` en `fbCheckoutQs()` y en el redirect `?view=checkout`, cuyo overlay también usa ese color) y el checkout lo cachea en `localStorage.rec_ck_color_<merchant>` para la próxima visita. Lumina sin tema = defaults con su `widget_color` (test). Tests: `tests/money-path/checkout-theme.test.mjs`.
- **Upsells en el checkout + botón con precio/frecuencia/ahorro (2026-09-25, Thiago)**: (1) **Botón del widget**: en suscripción dice "Suscribirme · $X cada mes" y debajo "Ahorrás $Y en cada envío" (`ctx.ctaText` en `shared/bundle/templates.js`, respeta `savings_label: "x"`; el clásico de `widget.js` con `ctaHtml()`). Lumina lo tiene en su Liquid: hay que pasarle el texto. (2) **"Sumá a tu suscripción"**: la tienda elige hasta 4 planes en Configuración → Checkout (`merchants.checkout_upsells`, `save-settings`); `public?action=plan&checkout=1 → checkout.upsells` los resuelve (`resolveCheckoutUpsells`: activos, con `subscription_price_ars`, distintos al que se compra); el checkout los muestra en el resumen con + Agregar / stepper (máx. 5 c/u) y manda `extras: [{plan_id, qty}]`; `checkout/init` los valida contra el plan (precio y variante del SERVER, nunca del body), los suma a `transaction_amount` y los guarda en `sub.extra_items` + `plan_snapshot.extras_total_ars`; `sync.js` los manda a la orden de Shopify como renglones con precio propio (`extra: true` → `shopify.js` factura esos a su precio y reparte el resto en el producto del plan; con extras no se usa el modo cupón) y `tiendanube.js` igual en `products`. **Nada de modificar el pack después de suscribirse** (Thiago, 25-sept): el portal NO edita extras ni cantidades (se implementó y se sacó el mismo día); pausar, dirección y cancelar siguen. Test en `checkout-theme.test.mjs`. **Demos**: `demos/plantilla-tienda/` (template + `armar.mjs` + README) genera `public/demos/<marca>.html` → `recurrentesapp.com/demos/<marca>.html`; la primera es G4U (`/demos/g4u.html`).
- **Regalos que viajan + pack elegido por modo (2026-09-25, Wellfresh)**: un regalo de pack puede quedar **vinculado a un producto de la tienda** (`gift.shopify_variant_id/shopify_product_id`, se elige con "Elegir de mi tienda" en Planes; los virtuales nunca). Con variante, el regalo VIAJA: en compra única el widget lo suma al carrito (`giftCartItems()` en nuestro cart/add.js, y en el interceptor del tema `addGiftsAfter()` con la propiedad `_Regalo`; sale al precio que tenga en Shopify → el comercio lo pone a $0 o con descuento automático, el selector marca "· $0"), y en suscripción `checkout/init` guarda `sub.gift_items` y `sync.js` (`giftLineItems`) lo manda a la orden a `$0.00` (`li.gift` en shopify.js, fuera del reparto y del modo cupón; `every:"once"` solo en la primera orden; Tiendanube igual en `products`). Sin variante sigue siendo solo de marketing. **Pack elegido por modo**: el bundle payload lleva `hideOnce/hideSub` por pack y widget.js hace `fixIdx()` al iniciar y al cambiar de modo: si el pack elegido no se ve en ese modo, salta al de la misma cantidad o al primero visible (antes la suscripción mandaba el pack default de compra única → "la sub de 2 agrega 3"). Tests: `tests/money-path/gifts.test.mjs`.
- **Carrito propio de la suscripción + botón fijo al pie (2026-09-25, Wellfresh)**: en modo packs, tocar el CTA de suscripción abre un drawer en la tienda (`openCart()` en widget.js, vive en `<body>`, de abajo en celular / lateral en compu) con el pack (label, unidades, "te llega cada X", precio y tachado), sus regalos ("Solo en tu primer envío" si aplica), Subtotal / Ahorrás / Total por envío, y **"Finalizar suscripción · $X"** → `goCheckout()`; "Seguir viendo" cierra. Se apaga con `widget_cart_drawer: false` (Widget → "Carrito de la suscripción"); apagado va directo al checkout como antes. El payload del bundle (`buildBundlePayload().packs`) ahora trae `label/price_sub/price_once/compare_at/freq_label/image/sub_qty/gifts{title,image,every,variant_id,code}`. **Sticky**: `widget_sticky_cta: true` (Widget → "Botón fijo al pie", apagado por defecto; Wellfresh lo tiene prendido) pinta una barra fija abajo con el MISMO texto del CTA del modo actual (sin precio); aparece cuando el widget quedó arriba fuera de pantalla (IntersectionObserver) y al tocarla hace `scrollIntoView` al bundle, no agrega nada. Regalo con `discount_code`: en compra única, después de agregar el regalo el widget visita `/discount/<code>?redirect=/cart` (deja la cookie y el checkout de Shopify lo aplica solo); es la forma de dejarlo gratis sin permisos de descuentos (no tenemos `write_discounts` ni `write_products`). El checkout de Recurrentes lista los regalos del pack en el resumen como "Gratis".
- **Verificación de mail: FUERA (2026-09-19, Thiago)**: `verifyBearer` ya no responde 403 `email_unverified` y el registro no manda el mail de verificación (`send-verification` sigue existiendo pero nadie lo llama). Ese mismo día una cuenta nueva sin verificar veía **pantalla negra**: el `useEffect` de precarga de pestañas quedaba después del `return` anticipado de `VerifyEmailScreen` ("Rendered fewer hooks"). Regla: en Dashboard.jsx TODOS los hooks van antes de los returns anticipados; `main.jsx` envuelve la app en `ErrorBoundary` para que un crash muestre un cartel y no negro.
- **Alta de cuenta (2026-09-18)**: el mail de verificación es PROPIO (`emailVerifyAccount`, Resend, castellano, marca) vía `POST merchant?action=send-verification`; el link lo genera Firebase Admin (`generateEmailVerificationLink`) y vuelve a `#/login?verificado=1`. `send-verification` y `save-owner` aceptan tokens SIN mail verificado (`verifyBearerAny`): el registro guarda nombre/WhatsApp/ref en el servidor al crear la cuenta (no se piden dos veces, y salen el aviso admin + la bienvenida por WhatsApp en el momento). Con datos pendientes en el navegador el Dashboard nunca vuelve a abrir OwnerInfoModal. Onboarding (`onboarding.js`): pasos "Conectar tu tienda" (Shopify o Tiendanube, id `tienda`) y "Conectar tu pasarela" (MP); sin paso de snippet ni de envíos. Integraciones: las plataformas sin conector (WooCommerce, Empretienda, VTEX, Impultienda, desarrollo propio) se muestran "Próximamente" con botón "Pedirlo por WhatsApp" (se conectan a mano). Configuración en celular: secciones como píldoras deslizables.
- **Una tienda por cuenta**: Shopify y Tiendanube (e Impultienda cuando exista) se excluyen. Con una conectada, las otras plataformas NO se muestran en Integraciones, y el backend rechaza conectar la segunda (`code: "channel_taken"` en `shopify.js?action=save-creds` y en `tiendanubeApi` `tn-oauth-start` + `connectStore`, que cubre callback e instalación desde la tienda de apps). Para cambiar de plataforma hay que desvincular primero.
- **WhatsApp**: un solo número de Recurrentes para todas las tiendas (Cloud API de Meta directa, plantillas de utilidad; **regla de escala: un número nuevo cada 100 tiendas con WhatsApp prendido**, ver 2026-09-18); el costo por mensaje se le suma al comerciante con **+50%** (`WHATSAPP_MARKUP` 1,50, desde 2026-09-18), tanto los mensajes a sus clientes como los avisos a él mismo; solo el ramal admin lo paga Recurrentes.

- **Importar descuentos de la tienda (2026-09-18)**: Configuración → Descuentos → botón "Traer los de Shopify/Tiendanube" (`POST merchant?action=import-discounts`, `_lib/discountImport.js`). Shopify por GraphQL `codeDiscountNodes` (solo activos; requiere el permiso **opcional** `read_discounts`, que va en la lista a pegar y en el OAuth pero NO dispara el aviso "te falta un permiso" → `SHOPIFY_REQUIRED_SCOPE_IDS`); Tiendanube por `GET /coupons` (scope `read_coupons` de la app de Partner). Solo % y $ fijo; 2x1 / envío gratis / por cantidad / de otra app se informan como omitidos. Nunca pisa los códigos que ya estaban; los nuevos entran con las casillas de "+ Agregar". Sin permiso → 403 `scope_missing` con el texto para reconectar.

- **Activar el widget en la tienda (2026-09-18)**: conectar + crear el plan no alcanza (temas con bundles y apps tapan el widget). Botón "Activar en mi tienda" (Widget → tarjeta de estado; Planes → encabezado; paso `activar` del onboarding): `GET merchant?action=widget-verify-url&plan=` arma la URL del producto del plan con `?rec_verify=1` (Shopify: handle vía API; Tiendanube: `canonical_url`), el panel la abre en otra pestaña y hace polling de `widget-verify-status&since=`. widget.js (`report()`/`watchVisible()`) manda el beacon `widget-seen&rendered=1` cuando el widget montado lleva **3 s seguidos con tamaño en la página**, o `rendered=0&reason=no_product|no_form|no_plan|hidden|removed` si no se montó; `handleWidgetSeen` guarda `widget_verified_*` / `widget_last_issue` (throttle 20 s / 60 s, `v=1` fuerza). Módulos: `api/_lib/widgetVerify.js`, `src/pages/WidgetVerify.jsx`. El Paso 2 de Shopify sigue midiendo solo "cargó" (antes del plan no puede renderizar).
- **Avisos al comercio por mail por defecto (2026-09-18)**: `alertsWanted` sale con `alerts_email !== false` (gratis) o `alerts_whatsapp_enabled` (cobrado); el WhatsApp solo se manda con el interruptor prendido. "Se cobra una renovación" viene APAGADO por defecto (`ALERT_EVENTS_OFF_BY_DEFAULT`); alta, pausa, baja y rechazo prendidos. Lumina ahora recibe esos mails (los tests del money-path cuentan `W.resend.toCustomer()`).
- **Panel más corto (2026-09-18)**: fuera Configuración → Negocio (el tipo/canal/pasarela se define solo con lo que conectás en Integraciones; el paso "Contanos qué vendés" del onboarding también se fue) y → Avanzado (modo de prueba). Ayuda: pestañas Empezar · Tienda online (Shopify + snippet, o Tiendanube) · Pasarela · Planes · Widget · Preguntas.

- **Video de Shopify (2026-09-18)**: `SHOPIFY_TUTORIAL_URL` apunta al mp4 de Thiago en GCS (`gs://recurrentes-16fbd-tutorials/shopify-instalacion.mp4`, público de lectura; el proyecto no tenía Firebase Storage, el bucket lo creó la service account). Un solo video cubre crear la app + pegar el snippet: `ResumableVideo` (ShopifyConnect.jsx) guarda el minuto en localStorage y lo retoma en el Paso 2 (`StoreStep2Modal`) y en Ayuda. Integraciones: sin la franja "Tu negocio"; sin tienda conectada, Shopify y Tiendanube dicen las dos "Necesaria" (se conecta una).

- **Embudo a Meta (2026-09-18)**: además del Purchase, `checkout/init` manda `AddToCart` al abrir el checkout (`{event:"view"}` desde Checkout.jsx, sin guardar nada) e `InitiateCheckout` al dejar el mail (lead, `capture:true`, que ahora el checkout hosteado sí registra en el blur del mail) y al tocar Pagar (mismo `event_id rec_ic_<sub>` → Meta deduplica). `metaFunnel()` en `_lib/meta.js` es best-effort. El widget pasa `fbp/fbc/src` por la URL del checkout (`fbCheckoutQs()`), Checkout.jsx los manda en `fb` y quedan en `fb_data` (con IP) para el Purchase. Copy en Integraciones, onboarding y landing (fila "Meta Ads").
- **Widget a prueba de fallas (2026-09-18, Thiago: "nadie en el limbo")**: `restoreTheme()` en widget.js devuelve el tema a como estaba (display previo de lo que escondimos, saca `rc-bundle-hide-style` y las clases `rec-*`, esconde nuestras raíces `[data-rec-root]`) y `guarded()` envuelve init, los montajes, `setSubMode` y el callback del plan. Se dispara ante excepción, widget sin tamaño 10 s ("hidden"), sacado del DOM ("removed") o variante sin plan. Motivo `error` en el beacon.
- **Fix link "carrito sin pagar" (2026-09-18)**: en modo clásico `recover_path` salía sin `?merchant=` → el checkout decía "Faltan datos" (mail y WhatsApp). Ahora siempre lleva merchant y `recoverTarget` lo completa para las subs viejas.

- **Cobro del uso de WhatsApp (2026-09-18, OK de Thiago)**: `api/_lib/waBilling.js`. `recordWaUsage` acumula `merchant.wa_unbilled_usd`. Con plan pago (`saas_stripe_customer_id`) el cron diario `bill-wa-usage` (9:30 UTC) crea un `invoiceitem` en Stripe por cada mes CERRADO sin `billed_at` (descripción "WhatsApp · <mes> · N mensajes", sin recargo visible) → sale en la próxima factura del plan; al activar el plan (`checkout.session.completed`) se facturan los meses pendientes y al darse de baja (`customer.subscription.deleted`) se factura todo, mes en curso incluido, y se emite la factura ya (`/v1/invoices` auto_advance). Sin plan: al llegar a **US$ 5** (`WA_FREE_CAP_USD`) → `wa_paused_for_billing` (waSender devuelve null, avisos al comercio solo por mail, cartel rojo en Flujos de WhatsApp) + mail `wa_paused`; se destraba al **cargar una tarjeta sin plan** (`POST merchant?action=wa-card-setup` → Stripe Checkout modo `setup`; el webhook guarda el customer + default payment method y factura lo pendiente) o al activar el plan. Solo tarjeta (customer sin suscripción): los ítems van a una factura propia con `auto_advance`, respetando el mínimo de Stripe (US$ 0,50: por debajo se acumula al mes siguiente). El webhook ahora **confirma BAJA/ALTA** con un texto. **Plan en un clic**: si la tienda ya tiene tarjeta guardada (la cargó para WhatsApp o pagó antes) y no tiene suscripción, `saas-checkout` crea la suscripción de Stripe directo (`createSaasSubscriptionWithCard`, `payment_behavior: error_if_incomplete`) y activa el plan sin Checkout; si la tarjeta rebota o no hay tarjeta, cae a Checkout. `activatePlan()` es el bloque común (campos, aviso admin, afiliados, facturar WhatsApp pendiente).

- **Panel instantáneo (2026-09-18, Thiago)**: las pestañas visitadas quedan MONTADAS (Dashboard `mountedTabs`, render con `hidden`; `PageView` con key fija) → volver es inmediato; al volver a mostrarse, cada página refresca su data en silencio (`useTabRefresh(tab, () => load({ silent:true }))` en `src/lib/tabs.js`, evento `rec:tab-shown`, salta el primer montaje y como mucho 1 vez cada 5 s) y el merchant se relee como mucho 1 vez por minuto. Suscripciones, Cobros y Planes se precargan solas a los 300/600/900 ms de la primera pantalla (`PREFETCH_TABS`). La tienda de muestra RECURRENTES (`PREWARM_MERCHANTS`) monta TODAS las pestañas de entrada.

- **Escala a 1000 tiendas (2026-09-18, "ok mandale a todo")**: (1) **Cron en modo global**: `sync-all-pending` ya no recorre tienda por tienda (~5 consultas por tienda cada 2 min; con ~250 tiendas se quedaba sin los 4 min de presupuesto). `collectDueGlobal()` en `api/cron.js` hace UNA tanda de `collectionGroup("subscribers")` (activas vencidas / recientes / sin fecha, `payment_failed`, pendings <72 h, pausadas con `resume_at` vencido, canceladas cada 30 min, huérfanos por hora) para todas las tiendas a la vez, agrupa por tienda, lee los merchants con `getAll` y aplica los mismos filtros y topes por tienda que antes (`cancelOrphanPlan` / `resumeFromRetention` son helpers compartidos por los dos modos). Requiere los 4 índices COLLECTION_GROUP de `firestore.indexes.json` (status + next_charge_at / updated_at / created_at / resume_at): si falta alguno Firestore tira FAILED_PRECONDITION y **cae solo al recorrido por tienda** (también con `CRON_GLOBAL=0`). `system/cron_last.mode` dice `global` o `per-merchant`. Tests en `tests/money-path/cron-global.test.mjs`. **Lo mismo para `run-flows`** (`collectDueRunsGlobal` en flows.js: `collectionGroup("flow_runs")` status=waiting + next_at vencido, índice CG flow_runs status+next_at; la búsqueda de "próximo cobro" corre 5 min de cada 30 solo en tiendas con `flows_active_triggers` array-contains `upcoming_charge`, rotadas) **y `retry-fulfillment`** (`collectFailedGlobal` en fulfillretry.js: CG charges shopify_order_id+created_at desc y CG fulfill_issues status+updated_at; `watchMerchant` acepta `failed`/`openDocs` precargados). Los tres responden `mode` y caen al recorrido por tienda sin índices o con `CRON_GLOBAL=0`. En `recordWaUsage` el incremento de `wa_unbilled_usd` (lo que se cobra) va antes que el agregado `admin_usage` (best-effort). (2) **Caché en la CDN de Vercel**: `widget.js` (`s-maxage=300`, 60 en bundle/bloqueado/checkout) y `public?action=plan` (`s-maxage=60`) y `tn-product` llevan `s-maxage` + `stale-while-revalidate`: la CDN los sirve sin ejecutar la función ni leer Firestore; un cambio de plan tarda ≤60 s en verse. (3) **Números de WhatsApp: regla de Thiago = un número nuevo (comprado afuera, tipo Zadarma) cada 100 tiendas con WhatsApp prendido.** Hoy el código maneja UN solo sender (`WHATSAPP_PHONE_NUMBER_ID`); cuando haya que sumar el segundo número hay que implementar el pool de senders (asignar `wa_sender_id` por tienda y elegir el número en `waSender()`), no antes.
- **Adquisición propia · Meta Ads (2026-09-19, Thiago: "hacé lo de la sección 1")**: hasta hoy el sitio no medía NADA de nuestra captación (los eventos de `metaFunnel` van al pixel de cada tienda). Ahora: (1) **pixel propio** en la SPA (`src/lib/attribution.js` → `initPixel()` con `VITE_META_PIXEL_ID`, PageView por navegación, y `CompleteRegistration` desde el navegador con `event_id acq_registered_<uid>`); (2) **4 eventos por servidor** a nuestro pixel (`api/_lib/acquisition.js`, env `META_PIXEL_ID` + `META_CAPI_TOKEN`, opcional `META_TEST_EVENT_CODE`): `registered` → CompleteRegistration (save-owner), `store_connected` → Lead (shopify save-creds / oauth-callback / tiendanube connectStore), `first_plan` → StartTrial (plans.js POST), `paid` → Purchase con el US$ del tramo (saasBilling `activatePlan`). Una vez por paso y por cuenta (flag `acquisition.<paso>_at` en el doc del LOGIN, tiendas extra acreditan al `ownerUid`), PII hasheada, tiendas internas y admins afuera, sin env se anota el paso igual; (3) **de qué anuncio vino**: la landing guarda el primer toque (`utm_*`, `fbclid`, landing, referrer) en `localStorage.rec_utm` (`captureAttribution()`), el registro lo manda en `save-owner { attribution }` con las cookies `_fbp/_fbc`, y `POST merchant?action=attribution` lo anota para cuentas que ya existían (Dashboard, 1 vez por sesión); queda en `merchants/{uid}.acquisition` (+ ip y user-agent para el match de Meta); (4) **Admin → Más métricas → "Adquisición · Meta Ads"**: registros → conectaron → plan → pagan y US$/mes **por anuncio** (`utm_content`), 30/90 días/todo (`acquisitionSummary`, `overview.acquisition`). Convención de links: `?utm_source=meta&utm_medium=paid&utm_campaign=<campaña>&utm_content=<RC-A1-H2>`. Tests: `tests/money-path/acquisition.test.mjs`.

## Integraciones y panel (tanda del 2026-09-15, rama `integracion`)
Todo apagado por env hasta que Thiago configure cada consola (ver `TAREAS_THIAGO.md`). `npm test` corre todas las suites (money-path de Lumina incluida) con Firestore en memoria y red bloqueada.
- **MP OAuth 1 clic**: `_lib/mpOauth.js` (PKCE S256, state firmado en `oauth_states`, refresh 7 días antes en cron, `invalid_grant` → "Reconectar"). Pegar token sigue como alternativa.
- **Shopify**: app creada por el comerciante (dominio + Client ID + secret) con guía `ShopifyConnect.jsx` + video (`src/lib/tutorials.js`). Scopes únicos en `shared/platform/shopify.js`. Webhooks de compliance con HMAC antes de leer Firestore.
- **Tiendanube**: `_lib/tiendanube.js` + `_lib/tiendanubeApi.js` vía `/api/shopify?action=tn-*` (rewrites `/api/tiendanube/callback|webhooks`). `fulfillCharge` rama tiendanube; `channelAvailable()` en profile.js (env `TIENDANUBE_APP_ID`+`TIENDANUBE_CLIENT_SECRET`).
- **Pasarelas alternativas**: registro `_lib/providers/` (mobbex, stripe, whop) + `_lib/charges/processProviderCharge.js` + webhook `/api/public?action=provider-webhook&p=<id>`. Flags `MOBBEX_ENABLED` / `STRIPE_ENABLED` / `WHOP_ENABLED`. En profile.js siguen "soon" (falta habilitarlos por env y la moneda USD).
- **Entrega digital**: `plan.digital_delivery` → mail con link al activar/renovar (`_lib/delivery.js`, no-op con envío).
- **WhatsApp**: Cloud API de Meta, paso `whatsapp` en flujos, `message_log`, webhook `/api/public?action=wa-webhook` (BAJA/ALTA). Plantillas en `WHATSAPP.md`.
  - **Número de Recurrentes (por defecto, 2026-09-15)**: un solo número (env `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_WABA_ID`) manda por todas las tiendas con `whatsapp_platform_enabled: true` (interruptor en Integraciones, `?action=whatsapp-platform`; crea el flujo "Aviso de próximo cobro"). `waSender()`: propio > Recurrentes > nada (nada = cero lecturas). Solo plantillas de Recurrentes (llevan el nombre de la tienda). Uso en `merchants/{mid}/usage/{AAAA-MM}` y `admin_usage/{AAAA-MM}` con `WHATSAPP_MARKUP` 1,50 (`pricing.js`); precio `WHATSAPP_PRICE_USD_UTILITY` (default 0,012). Casilla de opt-in en checkout/widget solo con WhatsApp prendido (Lumina: widget idéntico). Respuesta automática 1 vez cada 24 h (`wa_contacts`).
  - **Avisos al comercio (2026-09-15)**: el mismo número le avisa al DUEÑO cuando un cliente se suscribe / pausa / cancela / le rechazan una renovación (`_lib/merchantAlerts.js`, `notifyMerchantWhatsApp` + `notifyMerchantStatusChange`; plantillas `aviso_comercio_*` en `WA_MERCHANT_TEMPLATES`). Config en Configuración → Avisos para vos (`alerts_whatsapp_enabled`, `alerts_whatsapp` → si falta `owner_whatsapp` del dueño, `alerts_events`, `alerts_email`). Sin `alerts_whatsapp_enabled` = cero lecturas. Dedup en `alert_log` con create(). Sin WhatsApp (o si falla) sale por mail. Uso como `merchant_alert` (× 1,50, se le cobra al comercio igual que los mensajes a sus clientes).
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
