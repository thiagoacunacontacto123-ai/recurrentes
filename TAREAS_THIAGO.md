# Tareas de Thiago — para sellar todo

**Cómo usar esto:** hacé las partes en orden. Donde dice 📸, sacá una captura. Cuando termines, pasame todas las capturas y yo publico y verifico.

**Estado (15-sept):** todo lo nuevo está **publicado** y verificado; Lumina sigue cobrando igual. Hechas: Parte 1, Parte 2 (Mercado Pago en 1 clic) y Parte 3 (mails desde `hola@recurrentesapp.com`). Klaviyo se retiró. WhatsApp quedó listo esperando la configuración de Meta (Parte 7).

Con 🟥 marco lo que hace falta para poder publicar. El resto lo podés hacer cuando quieras.

---

## 🗓️ Mañana (16-sept) — plan del día

Objetivo tuyo: hablar con Impultienda (para Growith y Recurrentes), ver qué onda Meta, y dejar
la app lista para salir con pauta el fin de semana.

### A. Antes que nada: ¿puede entrar un desconocido? (🟥 bloquea la pauta, ≈40 min)

Nadie nunca se registró en Recurrentes desde cero salvo vos. Si la pauta trae gente y el
onboarding se rompe, se quema la plata del anuncio. Hay que probarlo como un extraño:

1. Ventana de incógnito → https://www.recurrentesapp.com → registrarse con un mail nuevo.
2. Seguir el onboarding tal como aparece, sin atajos y sin tocar la base: elegir qué vende,
   conectar una tienda, conectar Mercado Pago, crear un plan.
3. Anotar **cada** punto donde dudaste o algo no se entendió. Eso es lo que hay que arreglar
   antes de gastar en anuncios, no después.
4. Al terminar, borrar esa cuenta de prueba.

### B. Impultienda (reunión)

Objetivo doble: para Growith y para Recurrentes. Lo que necesitamos saber de ellos:
- ¿Tienen API pública o la pueden habilitar? (No encontramos documentación pública.)
- ¿Se puede leer catálogo, crear órdenes pagas e inyectar un script en la tienda?
- ¿Tienen tienda de aplicaciones o las integraciones se acuerdan una por una?
- ¿Con qué pasarelas cobran hoy sus tiendas?
- ¿Aceptan un piloto con una tienda real?

Sin API para crear órdenes, Recurrentes igual les sirve con el **link de suscripción**
(`channel: none`), que ya funciona: cobra por Mercado Pago y registra el comprobante interno.
Es una buena carta si dicen que no hay API todavía.

### C. Meta / WhatsApp (Parte 7)

Está todo codeado y esperando la configuración. Ver el detalle en la Parte 7 más abajo:
8 plantillas, verificación del negocio, token permanente, webhook y 5 variables.
**Meta tarda días en aprobar**, así que conviene arrancarlo mañana aunque no se termine.

### ✅ Cerrado el 16-sept
- **Envíos con proveedor externo**: probado con una suscripción real en Lumina eligiendo un HOP de Andreani → la orden #3048 llegó a Envialo con la sucursal correcta. La cotización en vivo quedó prendida por defecto para toda tienda Shopify.
- **Tiendanube**: widget completo inyectado por Tiendanube (sin homologación), packs, compra única nativa, bloque HTML de respaldo, envío en el fulfillment order.
- **Precios nuevos** (gratis hasta 10, 9 tramos, instalación gratis) en la fuente única y en toda la comunicación.

### D. Cabos sueltos de hoy

| Qué | Por qué importa |
|---|---|
| Widget en Tiendanube: confirmar que se inyecta | El script quedó `active` con la v2 a las 00:17. Si sigue sin aparecer, abrimos ticket con la evidencia |
| Apagar el "modo de desarrollo" del script 10256 | Si queda prendido apuntando a una URL, el día que falle el widget desaparece |
| Cuenta demo para Tiendanube | La piden para homologar: usuario dedicado + contraseña compartible + la contraseña de la tienda demo |
| Suscripción real en DEMO TN | Necesita otra cuenta de Mercado Pago (ya la tenés: la usaste en Lumina el 16-sept). Sirve para la homologación y para el video |
| Número de ticket de Shopify | Llega por mail a la casilla del Partner Dashboard. Pasámelo y lo anoto |
| Video de Shopify → `SHOPIFY_TUTORIAL_URL` | Es lo único que falta de la Parte 4 |
| SPF y `_dmarc` (lo debo yo) | Para poder responder mails como `soporte@recurrentesapp.com` |

### E. Antes de la pauta (checklist)

- [ ] El registro y el onboarding funcionan para alguien de cero (punto A)
- [ ] La landing dice lo que la app hace hoy, sin prometer lo que está "próximamente"
- [ ] Precios visibles y coherentes con `shared/platform/pricing.js`
- [ ] `#/soporte`, `#/terminos` y `#/privacidad` abren bien
- [ ] Un plan nuevo se crea sin errores en una tienda nueva
- [ ] Los mails de los flujos llegan (probar con `flow-test`)
- [ ] El chequeo de salud en Admin está en verde

---

## 🟥 Parte 1 — Imprescindible para publicar (≈15 min)

### 1.1 Vercel: variables de entorno
Entrá a https://vercel.com/dashboard → proyecto **recurrentess** → **Settings** → **Environment Variables**.

| Variable | Valor | Para qué |
|---|---|---|
| `APP_BASE_URL` | `https://www.recurrentesapp.com` (con www, sin `/` al final) | Links de mails, widget y avisos de Mercado Pago con el dominio nuevo |
| `ADMIN_EMAILS` | `thiagoacunacontacto123@gmail.com` | Entrás al panel de admin (`#/admin`) y al chequeo de salud (con esa cuenta de Google) |
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
Entrá a https://www.recurrentesapp.com/#/admin con tu cuenta de Google `thiagoacunacontacto123@gmail.com`. Arriba de todo está la tarjeta **"Salud del sistema"**: dice si falta alguna variable (nunca muestra los valores), si la base de datos responde y si los procesos automáticos están corriendo. "Ver detalle por integración" lo muestra integración por integración. Los procesos pueden figurar "Atrasado" durante los primeros 10 minutos después de publicar.

📸 Captura de lo que muestra.

---

## ✅ Parte 2 — Mercado Pago en 1 clic (HECHO y probado el 15-sept)
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

## ✅ Parte 3 — Mails desde tu dominio (HECHO el 15-sept: dominio verificado en Resend, `EMAIL_FROM` = `Recurrentes <hola@recurrentesapp.com>`)
_Quedó hecho con los registros nuevos de Resend (1 TXT + 2 CNAME). Lo de abajo queda como referencia._
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

## 🔔 Hoy — Avisos para vos (2 min)
Recurrentes te avisa cuando un cliente se suscribe, pausa, cancela o le rechazan una renovación. Por WhatsApp cuando Meta apruebe las plantillas (Parte 7); mientras tanto, por mail.
1. Entrá a Recurrentes con la cuenta de Lumina → **Configuración → Avisos para vos**.
2. Prendelo, revisá tu WhatsApp y dejá tildado **"También por mail"**.
3. Tocá **"Enviarme una prueba"** y fijate que te llegue.

📸 Captura del aviso de prueba.

---

## Parte 4 — Shopify
- [x] **Explicación:** quedó igual a la de Growith (15-sept).
- [ ] **Video (mañana):** grabá el paso a paso y subilo a YouTube como **No listado** (o a Loom). Pasame el link y lo pongo. Hasta entonces el recuadro del video no aparece.
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
5. **Scripts → Crear script**: subí el archivo `tiendanube-loader.js` (te lo dejé en Descargas), con ubicación **Store**, **instalación automática apagada** (así el script recibe el id de la cuenta por tienda) y NubeSDK apagado. Anotá el número del script.
   - **Evento: `onfirstinteraction`** (decisión de Thiago, 15-sept: alcanza de sobra). `onload` necesita aprobación previa de Tiendanube por mail y no vale la pena: con onfirstinteraction el selector aparece apenas el visitante baja o toca algo.
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

## 📌 Pendiente para otro día — responder como soporte@recurrentesapp.com
Ya tenés el **reenvío** listo: lo que le escriban a `soporte@recurrentesapp.com` te llega a tu Gmail (Squarespace → Domains → Email → Email forwarding). Eso es solo para **recibir**.
- [ ] Para **responder** con esa dirección desde Gmail hay que aflojar antes 2 registros del DNS: el `TXT` de `@` (hoy `v=spf1 -all`, hay que sumar Google) y el `_dmarc` (hoy `p=reject` estricto). Sin eso, los mails que mandes como `soporte@` caen en spam o rebotan. Pedime "pasame lo del DNS para responder como soporte" y te doy los valores exactos.
- Recordatorio: si algún día querés casilla propia de verdad (no reenvío), la opción gratis es Zoho Mail con dominio propio.

---

## Parte 6 — Impultienda
- [ ] Mandales el mensaje que está en `docs/IMPULTIENDA.md` (sección "Mensaje para el equipo de Impultienda") por el chat de soporte de su panel o por Instagram: https://www.instagram.com/impultienda/
- Lo que encontré: tienen webhooks salientes firmados (solo plan Max), pero su API todavía no está abierta a terceros. Sus suscripciones son con Stripe en dólares, así que **cobrar en pesos con Mercado Pago es justo lo que les falta**.
- Mientras tanto un vendedor de Impultienda ya puede usar Recurrentes. En Configuración → Negocio elige "Productos digitales" y "Sin tienda online". Pone el link de suscripción del plan en un botón de su página, y Recurrentes le manda por mail el acceso al contenido a cada cliente, al suscribirse y en cada renovación.

---

## Parte 7 — WhatsApp desde el número de Recurrentes (cuando quieras; Meta tarda días en verificar)
Un solo número tuyo manda los avisos de todas las tiendas. Los comerciantes solo prenden un interruptor. Checklist completa y textos exactos en `WHATSAPP.md` → "Tareas de Thiago".
1. Verificá tu negocio en Meta: https://business.facebook.com/settings/security → "Centro de seguridad" → Verificación.
2. Creá una app tipo **Empresa** en https://developers.facebook.com/apps/ y sumale el producto **WhatsApp**. Creá la cuenta de WhatsApp Business (WABA) de Recurrentes.
3. Número: el más barato es un **chip prepago nuevo** (o un número fijo que reciba llamada de voz) que **no** esté en la app de WhatsApp. Lo agregás en WhatsApp Manager → Números y lo verificás por SMS o llamada.
4. Token que no vence: https://business.facebook.com/settings/system-users → usuario **Administrador** → asignarle la app y la WABA → **Generar token** con vencimiento "Nunca" y los permisos `whatsapp_business_messaging`, `whatsapp_business_management` y `business_management`.
5. Medio de pago en https://business.facebook.com/wa/manage/home/ (Meta cobra cada aviso entregado; se lo trasladamos a cada tienda con 10% arriba).
6. Mandá a aprobar las **8 plantillas** en https://business.facebook.com/wa/manage/message-templates/ → Crear → **Utilidad** → **Español (ARG)**, con el texto exacto de `WHATSAPP.md`: las 4 para los clientes de las tiendas (`aviso_proximo_cobro`, `pago_rechazado`, `suscripcion_activa`, `renovacion_cobrada`) y las 4 de avisos para los comerciantes (`aviso_comercio_alta`, `aviso_comercio_pausa`, `aviso_comercio_baja`, `aviso_comercio_pago_rechazado`). No cargues las variables del paso 8 hasta que estén aprobadas.
7. Webhook: en tu app de Meta → WhatsApp → Configuración → Webhook → URL `https://www.recurrentesapp.com/api/public?action=wa-webhook` + el mismo texto que pongas en `WHATSAPP_VERIFY_TOKEN`; suscribí el campo **messages**.
8. Vercel: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` (y opcional `WHATSAPP_PRICE_USD_UTILITY` con el precio real del CSV de Meta).

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


## Cobrar el plan de Recurrentes con Stripe (tu cuenta) — HECHO el 2026-09-17

✅ Clave secreta y secreto del webhook cargados en Vercel (tipo Secret) · ✅ webhook "Recurrentes SaaS" con los 6 eventos · ✅ redeploy · ✅ verificado: "Activar Starter · USD 49/mes" abre Stripe Checkout de verdad (probado desde DEMO SHOPIFY, ya existe el producto "Recurrentes · Starter" en tu Stripe).

Cómo cobra: suscripción mensual en Stripe. Cada día a las 9:00 UTC el cron `sync-saas-tiers` mueve cada suscripción al tramo que le corresponde por suscriptores activos, sin prorrateo → la próxima factura sale por el tramo vigente. Si baja a ≤10 suscriptores, se cancela al fin del período. Rechazos → "past_due" con aviso y botón "Actualizar tarjeta".

### Lo que te falta a vos en Stripe (sin esto cobra pero no te gira la plata)
1. **La barra amarilla "Acción requerida"** → "Consulta la tarea" y completá lo que pida. Es lo más importante: sin verificar la cuenta, Stripe cobra y retiene.
2. Configuración → **Empresa** → Editar: **Industria** = Software como servicio (SaaS) (sacar "Tiendas multiservicio"); **Descripción del producto** = "Software de gestión de suscripciones para tiendas online de Argentina. Les cobramos a los comercios una suscripción mensual por usar la plataforma, según su cantidad de suscriptores activos. El primer cobro es al activar el plan y después se renueva cada 30 días."; **Descripción del cargo en el extracto** = `RECURRENTES`.
3. **Customer portal**: https://dashboard.stripe.com/settings/billing/portal → activarlo (guardar con lo que viene por defecto alcanza). Lo usa el botón "Tarjeta y facturas" del panel; sin activarlo, ese botón da error.
4. Podés borrar la clave secreta vieja (`sk_live_…vmcW`) desde los tres puntos en Claves de API: no se usó en ningún lado.

### WhatsApp: 3 plantillas nuevas para aprobar en Meta
Los avisos del límite del plan gratis al dueño de la tienda. Mientras Meta no las apruebe, el aviso sale por mail igual (no se pierde). Textos exactos en `shared/platform/whatsapp.js` → `WA_PLAN_TEMPLATES`. Categoría UTILITY, idioma es_AR:
- `aviso_plan_limite` (pasó los 10: "te damos 5 de regalo")
- `aviso_plan_ultimo` (llegó a 14 o 15: "con uno más se apaga")
- `aviso_plan_bloqueado` (16+: "tu widget está apagado")
