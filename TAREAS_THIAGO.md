# Tareas de Thiago — para sellar todo

**Cómo usar esto:** hacé las partes en orden. Donde dice 📸, sacá una captura. Cuando termines, pasame todas las capturas y yo publico y verifico.

**Estado:** todo lo nuevo está en la rama `integracion`, **sin publicar**. Solo publiqué un arreglo urgente: crear planes nuevos daba error en producción. Lumina no se tocó.

Con 🟥 marco lo que hace falta para poder publicar. El resto lo podés hacer cuando quieras.

---

## 🟥 Parte 1 — Imprescindible para publicar (≈15 min)

### 1.1 Vercel: variables de entorno
Entrá a https://vercel.com/dashboard → proyecto **recurrentess** → **Settings** → **Environment Variables**.

| Variable | Valor | Para qué |
|---|---|---|
| `APP_BASE_URL` | `https://www.recurrentesapp.com` (con www, sin `/` al final) | Links de mails, widget y avisos de Mercado Pago con el dominio nuevo |
| `ADMIN_EMAILS` | `thiagoacunacontacto123@gmail.com,TU_MAIL_DE_LOGIN_ACTUAL` | Entrás al panel de admin (`#/admin`) y al chequeo de salud |
| `PLATFORM_ALERT_EMAIL` | `thiagoacunacontacto123@gmail.com` | Te llega un mail si un cobro se aprobó pero la orden no se pudo crear |

- Si `APP_BASE_URL` ya existe: tocá los tres puntitos → **Edit** → cambiá el valor → **Save**.
- Si no existe: arriba completá **Key** y **Value**, dejá tildado **Production** (y **Preview**) → **Save**.
- Mirá también que en la lista estén `CRON_SECRET` y `PORTAL_SECRET`. No me pases los valores, solo si están o no.

📸 Captura de la lista de variables (los valores se ven ocultos, está bien).

### 1.2 Firebase: publicar las reglas nuevas de la base de datos
Hoy un miembro del equipo de una tienda podría leer las claves de Mercado Pago y de Shopify desde el navegador. Las reglas nuevas lo cierran. El panel ya no lee la base directo, así que no se rompe nada.

1. Entrá a https://console.firebase.google.com/project/recurrentes-16fbd/firestore/rules
2. Borrá todo lo que hay y pegá el contenido del archivo `firestore.rules`. Te lo paso yo por el chat cuando me digas "pasame las reglas".
3. Tocá **Publicar**.

📸 Captura con el cartel de "publicadas".

---

### 1.3 (Opcional) Índice nuevo en Firebase
Hace más rápida la vista "Cobros con error" y el aviso de órdenes que no se crearon. Sin el índice todo funciona igual, solo lee un poco más.
1. Entrá a https://console.firebase.google.com/project/recurrentes-16fbd/firestore/indexes → **Crear índice**.
2. Completá así:
   - ID de colección: `charges`
   - Alcance: **Colección**
   - Campo 1: `shopify_order_id` **Ascendente**
   - Campo 2: `created_at` **Descendente**
3. Tocá **Crear** y esperá unos minutos a que diga "Habilitado".

### 1.4 Chequeo de salud (después de que publique)
Abrí https://www.recurrentesapp.com/api/cron?action=health estando logueado en Recurrentes con tu mail de admin. Muestra, integración por integración, qué variables faltan (nunca los valores) y si los procesos automáticos están corriendo.

📸 Captura de lo que muestra.

---

## Parte 2 — Mercado Pago en 1 clic (≈20 min)
El comerciante toca **"Conectar con Mercado Pago"**, autoriza y vuelve conectado. Ya no tiene que pegar ningún token.

1. Entrá a https://www.mercadopago.com.ar/developers/panel/app → **Crear aplicación**.
   - Tipo de solución: **Pagos online**.
   - ¿Usás una plataforma de e-commerce?: **No**.
   - Producto: **Suscripciones**.
2. Dentro de la aplicación tocá **Editar**:
   - **URL de redireccionamiento**: `https://www.recurrentesapp.com/api/mp/oauth-callback` (exacto).
   - Activá **PKCE**.
   - Dejá tildados los permisos **read**, **write** y **offline_access**. Sin este último no se renueva solo.
3. **Credenciales de producción** → activalas: rubro + sitio `https://www.recurrentesapp.com`. Copiá el **Client ID** y el **Client Secret**.
4. Vercel → Environment Variables → Production:
   - `MP_APP_ID` = Client ID
   - `MP_CLIENT_SECRET` = Client Secret
   - `MP_REDIRECT_URI` = `https://www.recurrentesapp.com/api/mp/oauth-callback`

📸 Captura de la app en MP (sin mostrar el secret) y de las 3 variables en Vercel.

> No encontré en la documentación de MP que haga falta certificación ni aprobación para conectar cuentas de otros vendedores. El programa de partners es opcional. Lo confirmamos con la prueba de la Parte 10.

---

## Parte 3 — Mails desde tu dominio (≈15 min + espera de verificación)
Hoy los mails salen con la dirección genérica de Resend. Con esto salen de `@recurrentesapp.com` y caen menos en spam.

1. Entrá a https://resend.com/domains → **Add domain** → `recurrentesapp.com` → región **São Paulo** (la más cercana).
2. Resend te muestra 3 registros. Andá a Squarespace → **Domains** → `recurrentesapp.com` → **DNS** → **Custom records** → **Add record**, y cargá uno por uno:

| Tipo | Host (poné solo esto) | Prioridad | Valor |
|---|---|---|---|
| MX | `send` | 10 | el que te muestra Resend (feedback-smtp…) |
| TXT | `send` | — | el que te muestra Resend (`v=spf1 include:amazonses.com ~all`) |
| TXT | `resend._domainkey` | — | el que te muestra Resend (empieza con `p=`) |

   En Host no pongas `send.recurrentesapp.com`: solo `send`. Squarespace agrega el resto solo.
3. **DMARC.** Squarespace te dejó un preset "Email Security" con un registro `_dmarc` que dice `p=reject`. No rompe los mails de Resend, pero mientras probamos conviene aflojarlo: editá el registro TXT con host `_dmarc` y poné `v=DMARC1; p=none;`. El registro TXT de `@` que dice `v=spf1 -all` dejalo como está.
4. En Resend tocá **Verify**. Puede tardar de minutos a unas horas.
5. Cuando esté verificado, en Vercel agregá `EMAIL_FROM` = `Recurrentes <hola@recurrentesapp.com>`.

📸 Captura de Resend con el dominio **Verified** y de los registros en Squarespace.

---

## Parte 4 — Shopify
- [ ] **Video:** grabá el paso a paso de crear la app en Shopify y subilo a YouTube como **No listado** (o a Loom). Pasame el link y lo pongo en el modal. Hasta entonces se ve "Video paso a paso — próximamente".
- [ ] Mientras grabás, fijate que los botones de https://dev.shopify.com/dashboard digan lo mismo que los pasos del modal: **Create app**, **Versions**, **Scopes**, **Redirect URLs**, **Release**, **Settings → Credentials**. Si alguno cambió, avisame y lo corrijo.
- [ ] Vercel: si existe la variable `SHOPIFY_SCOPES`, borrala. Ya no hace falta.
- [ ] Opcional, para Lumina: en su app de Shopify creá una **versión nueva** sumando el permiso `read_shipping` → **Release**. Después, en Recurrentes → Integraciones → Shopify → **Reconectar**. Sirve para importar sus tarifas de envío de Shopify; sin esto todo sigue andando como hoy.

---

## Parte 5 — Tiendanube (≈30 min + revisión de Tiendanube)
Mientras no cargues las variables, en el panel sigue diciendo "Próximamente". Cuando las cargues, el comerciante conecta su tienda con un clic, los productos aparecen al crear el plan, el widget se instala solo en su tienda y cada cobro crea la orden paga en Tiendanube.

1. Creá tu cuenta de Partner en https://partners.tiendanube.com → **Crear aplicación**.
2. **Datos básicos → Editar datos** → URL de redirección: `https://www.recurrentesapp.com/api/tiendanube/callback`
3. **Permisos**: ver productos, ver y crear órdenes, crear clientes y scripts (`read_products`, `read_orders`, `write_orders`, `write_customers`, `write_scripts`).
4. **Webhooks LGPD** (privacidad), cargá estas 3 URLs:
   - `https://www.recurrentesapp.com/api/tiendanube/webhooks?topic=store-redact`
   - `https://www.recurrentesapp.com/api/tiendanube/webhooks?topic=customers-redact`
   - `https://www.recurrentesapp.com/api/tiendanube/webhooks?topic=customers-data-request`
5. **Scripts → Crear script**: subí el archivo `public/tiendanube-loader.js` (te lo paso si no lo encontrás), con ubicación **store**, evento **onload** y **sin** instalación automática. Anotá el número del script.
6. Vercel → Environment Variables:
   - `TIENDANUBE_APP_ID` = el ID de la app
   - `TIENDANUBE_CLIENT_SECRET` = el secret
   - `TIENDANUBE_CONTACT_EMAIL` = tu mail de soporte (Tiendanube lo pide)
   - `TIENDANUBE_SCRIPT_ID` = el número del script del paso 5
7. Probá con una **tienda de prueba** de Tiendanube: conectar → crear un plan → suscribirte con Mercado Pago → fijate que aparezca la orden paga con la nota RECURRENTE.
8. Cuando ande, mandá la app a **homologación** (revisión) desde el portal de Partners.

📸 Captura de la app en Partners (redirect y permisos) y de la orden de prueba.

> Límites de Tiendanube: las órdenes no tienen etiquetas (usamos la nota interna) y el medio de pago figura como "offline", no como "Mercado Pago". Por ahora los packs no andan en Tiendanube; se usa el selector clásico.

---

## Parte 6 — Impultienda
- [ ] Mandales el mensaje que está en `docs/IMPULTIENDA.md` (sección "Mensaje para el equipo de Impultienda") por el chat de soporte de su panel o por Instagram: https://www.instagram.com/impultienda/
- Lo que encontré: tienen webhooks salientes firmados (solo plan Max), pero su API todavía no está abierta a terceros. Sus suscripciones son con Stripe en dólares, así que **cobrar en pesos con Mercado Pago es justo lo que les falta**.
- Mientras tanto un vendedor de Impultienda ya puede usar Recurrentes. En Configuración → Negocio elige "Productos digitales" y "Sin tienda online". Pone el link de suscripción del plan en un botón de su página, y Recurrentes le manda por mail el acceso al contenido a cada cliente, al suscribirse y en cada renovación.

---

## Parte 7 — WhatsApp a los clientes (cuando quieras; Meta tarda días en verificar)
1. Verificá tu negocio en Meta: https://business.facebook.com/settings/security → "Centro de seguridad" → Verificación.
2. Creá una app tipo **Empresa** en https://developers.facebook.com/apps/ y sumale el producto **WhatsApp**. Creá la cuenta de WhatsApp Business y agregá un número que **no** esté en la app de WhatsApp de tu celular.
3. Token que no vence: https://business.facebook.com/settings/system-users → crear usuario **Administrador** → asignarle la app y la cuenta de WhatsApp → **Generar token** con vencimiento "Nunca" y los permisos `whatsapp_business_messaging`, `whatsapp_business_management` y `business_management`.
4. Cargá un medio de pago en https://business.facebook.com/wa/manage/home/ (Meta cobra cada mensaje, unos centavos de dólar).
5. Mandá a aprobar las 4 plantillas en https://business.facebook.com/wa/manage/message-templates/ → Crear → **Utilidad** → **Español (ARG)**, con el texto exacto de `WHATSAPP.md`.
6. En Recurrentes → Integraciones → WhatsApp → Conectar: pegá los dos identificadores y el token.
7. Webhook: en tu app de Meta → WhatsApp → Configuración → Webhook, pegá la URL y el token que te muestra Integraciones y suscribí el campo **messages**.

---

## Parte 8 — Mobbex (prueba, no urgente)
1. Sacá tus claves de Mobbex (API Key y Access Token): https://ayuda.mobbex.com/credenciales-para-integracion-a-traves-de-api
2. Vercel: `MOBBEX_ENABLED` = `1` **solo en Preview** (no en Production todavía).
3. Probamos juntos con una tienda de prueba, **nunca con Lumina**. Tarjeta de prueba Visa `4507983190082450`, vence 12/34, DNI 12123123, CVV 200 (aprobada) o 400 (rechazada).

---

## Parte 9 — Stripe y Whop (futuro, para vender en dólares)
- Stripe no abre cuentas a comercios argentinos: hace falta una cuenta afuera, por ejemplo una LLC de EE.UU. con https://stripe.com/atlas.
- Con esa cuenta, en https://dashboard.stripe.com/settings/connect/onboarding-options/oauth prendé OAuth, agregá la Redirect URI `https://www.recurrentesapp.com/api/merchant?action=stripe-connect-callback` y copiá el `client_id` (`ca_…`).
- Webhook: en https://dashboard.stripe.com/webhooks tocá **Create an event destination** → **Connected accounts** → URL `https://www.recurrentesapp.com/api/public?action=provider-webhook&p=stripe`. Eventos: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `customer.subscription.updated`.
- Vercel: `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, y recién después `STRIPE_ENABLED=1`.
- Whop: creá una cuenta en whop.com y probá cobrar y **retirar** con una cuenta argentina. Si anda, `WHOP_ENABLED=1`.

---

## Parte 10 — Pruebas finales (después de que publique)
- [ ] **Crear un plan** nuevo (confirma el arreglo urgente).
- [ ] **Registro nuevo** con otro mail: primero nombre + WhatsApp + mail, después Google o contraseña.
- [ ] **Entrar con Google:** tiene que decir **recurrentesapp.com**, no "recurrentes-16fbd.firebaseapp.com".
- [ ] **Mercado Pago en 1 clic** con **otra** cuenta de MP (no la de Lumina): Integraciones → Conectar con Mercado Pago → Autorizar → vuelve conectado.
- [ ] **Admin:** https://www.recurrentesapp.com/#/admin → "Ver como este comercio" con Lumina → "Salir" en la barra amarilla.
- [ ] **Transferir tienda:** creá una tienda de prueba, transferila a tu otro mail, aceptá desde el link del mail y fijate que la cuenta vieja ya no la vea. **Nunca con Lumina.**

📸 Captura de cada una.

---

## Qué quedó hecho (resumen)
Todo está en la rama `integracion`. Pasan las 68 pruebas automáticas, incluidas las que simulan el circuito de cobro de Lumina de punta a punta.

| Qué | Estado |
|---|---|
| Mercado Pago en 1 clic (con renovación automática y aviso de "Reconectar") | Listo, falta Parte 2 |
| Shopify: guía paso a paso + lugar para tu video + ayuda de errores | Listo, falta el video |
| Tiendanube: conectar, productos, widget automático, orden paga por cobro | Listo, falta Parte 5 |
| Entrega digital (link por mail al suscribirse / renovar) | Listo |
| Impultienda: investigación + mensaje para su equipo | Listo, falta mandarlo |
| Mobbex (pesos) | Listo, apagado hasta probar |
| Stripe y Whop (dólares) | Listo, apagado (futuro) |
| WhatsApp a clientes (en los flujos) | Listo, falta Parte 7 |
| Panel de admin (tus 2 cuentas) con "ver como" | Listo, falta `ADMIN_EMAILS` |
| Transferir una tienda a otra cuenta | Listo |
| Registro en 2 pasos + Google con tu dominio | Listo (retenido hasta `APP_BASE_URL`) |
| Seguridad: claves cerradas, avisos falsos de contracargo bloqueados, límites | Listo, falta publicar reglas |
| Aviso por mail si un cobro no genera su orden + chequeo de salud | Listo |

**Arreglos que ya estaban rotos en producción:**
- Crear un plan daba error. Esto ya está publicado.
- Un miembro quitado del equipo seguía entrando a la tienda.
- Un aviso falso de contracargo podía cancelar la suscripción de un cliente.

## Pendientes y riesgos (para más adelante)
- **Mobbex, Stripe y Whop** todavía no se pueden elegir en Configuración → Negocio. Falta habilitarlos y que la app maneje dólares (hoy todo asume pesos).
- **Mobbex:** el primer cobro no está probado contra Mobbex de verdad. Por eso va primero con una tienda de prueba.
- **Reintento automático de órdenes:** está apagado a propósito. Si Shopify tarda en responder, reintentar podría duplicar una orden. Primero miramos las alertas un par de semanas.
- **Alertas de órdenes sin crear:** al publicar, si Lumina tuvo algún cobro de los últimos 3 días sin orden, le va a llegar un mail de aviso por cada uno. Es esperable.
- **Tiendanube:** hay que confirmar en la tienda de prueba si acepta órdenes sin dirección (servicios o digitales).
