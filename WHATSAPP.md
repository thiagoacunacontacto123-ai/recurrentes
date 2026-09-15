# WhatsApp — avisos a clientes finales (Cloud API oficial de Meta)

Estado: listo detrás de configuración. No sale nada hasta que Thiago carga las variables del número de Recurrentes en Vercel **y** una tienda prende "Avisos por WhatsApp". Lumina queda igual: su widget sirve el mismo JS byte a byte y el camino del cobro no lee nada nuevo.

## Dos formas de mandar

| | Número de Recurrentes (por defecto) | Número propio (avanzado) |
|---|---|---|
| Qué hace la tienda | Prende un interruptor en Integraciones → WhatsApp y tilda el consentimiento | Pega Phone number ID + WABA ID + token permanente ("¿Preferís usar tu propio número?") |
| Desde qué número sale | Uno solo, de Recurrentes, a nombre de cada tienda | El suyo |
| Plantillas | Solo las 4 de Recurrentes (llevan el nombre de la tienda) | Cualquiera aprobada en su WABA |
| Quién paga a Meta | Recurrentes, y se lo cobra a la tienda con **10% arriba** a fin de mes | La tienda, directo a Meta |
| Uso del mes | Se cuenta con costo | Se cuenta a costo 0 |

Prioridad (`waSender` en `api/_lib/whatsapp.js`): **número propio > número de Recurrentes > nada**. El de Recurrentes solo se usa si `merchant.whatsapp_platform_enabled === true` y están `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN`.

## Cómo funciona

- **Interruptor:** `POST /api/merchant?action=whatsapp-platform { enabled, optin_confirmed }` (solo el dueño). Al prenderlo guarda `whatsapp_platform_enabled` + `whatsapp_platform_optin_at` y, si la tienda no tiene ningún flujo con WhatsApp, crea y activa **"Aviso de próximo cobro por WhatsApp"** (3 días antes). El GET del merchant devuelve solo booleanos y precio: `whatsapp_platform_available`, `whatsapp_platform_enabled`, `whatsapp_sender` ("own" | "platform" | null), `whatsapp_price_usd`, `whatsapp_charge_usd`.
- **Envío:** `sendTemplate()` hace `POST https://graph.facebook.com/v25.0/{phone-number-id}/messages` con `type:"template"` y parámetros de cuerpo posicionales. La versión se cambia con `WHATSAPP_GRAPH_VERSION`.
- **Flujos:** paso `{ type:"whatsapp", template, lang, vars }`. Con el número de Recurrentes el motor ignora el mapeo del paso y usa el de la plantilla de Recurrentes (así el nombre de la tienda va siempre); una plantilla que no sea de Recurrentes se saltea. Sale solo si hay quién mande, el cliente tiene teléfono y no se dio de baja. Sin quién mande: **cero lecturas** de Firestore. Cada envío queda en `merchants/{id}/message_log` con `sender`.
- **Opt-in del cliente:** con WhatsApp prendido, el checkout hosteado (`#/checkout`) y el checkout / widget de la tienda muestran "Quiero que me avisen por WhatsApp antes de cada cobro", marcada por defecto. `checkout/init` guarda `whatsapp_optin` (+ `whatsapp_optin_at`) solo si el campo viene en el body. `whatsapp_optin:false` o `whatsapp_optout:true` = no sale.
- **Bajas:** `BAJA` / `STOP` → `merchants/{id}/wa_optouts/{sha256(teléfono)}`. Si lo responde al número de Recurrentes, además `wa_platform_optouts/{sha}` (baja de todo el número) y en cada tienda que le escribió. `ALTA` lo revierte.
- **Respuesta automática (número de Recurrentes):** cualquier otro mensaje del cliente recibe **una vez cada 24 h** (transacción en `wa_contacts/{sha}`) un texto libre, gratis dentro de la ventana de servicio: "Hola. Este número solo envía avisos automáticos de {tienda}. Para consultas escribí a {mail}. Si no querés recibir más avisos, respondé BAJA." La tienda sale de `wa_contacts` (a quién le escribimos por qué tienda); el mail es `email_reply_to` o, si falta, `shop_email`. Si le escribieron varias tiendas o ninguna, va un mensaje genérico.
- **Webhook:** `/api/public?action=wa-webhook` (no suma funciones). Verificación GET con `WHATSAPP_VERIFY_TOKEN`. Los POST llevan firma `X-Hub-Signature-256`: el número de Recurrentes solo acepta `WHATSAPP_APP_SECRET`. Los estados (sent → delivered → read / failed) del número de Recurrentes encuentran la tienda por `wa_platform_msgs/{sha(wamid)}`.
- **Uso y cobro:** cada envío OK suma con `FieldValue.increment` en `merchants/{mid}/usage/{AAAA-MM}` `{ wa_sent, wa_cost_usd, wa_platform_sent | wa_own_sent }` y, si es del número de Recurrentes, en `admin_usage/{AAAA-MM}` `{ wa_sent, wa_cost_usd, wa_meta_cost_usd, merchants.{mid}.… }`. Mes en hora de Argentina. `wa_cost_usd` = precio de Meta × `WHATSAPP_MARKUP` (1,10, en `shared/platform/pricing.js`).
- **Panel:** Integraciones → WhatsApp (interruptor + precio + consentimiento + "¿Preferís usar tu propio número?"), Configuración → Facturación ("WhatsApp este mes: N avisos · US$ X (se suma a tu plan)"), Flujos (sugerencia y "+ WhatsApp" también con el número de Recurrentes; si está apagado, aviso que lleva a Integraciones → WhatsApp) y `#/admin` (tarjeta "WhatsApp este mes", columna por comercio y línea en la ficha).

## Precio (consultado el 2026-09-15)

- Meta cobra **por plantilla entregada** (desde el 1-7-2025). Las de utilidad dentro de una ventana de 24 h abierta por el cliente son gratis, igual que las respuestas de servicio. Argentina bajó utilidad y autenticación el 1-10-2025. La tabla vigente es del **1-7-2026**, pero el valor exacto solo está en el CSV "USD rates" de https://developers.facebook.com/docs/whatsapp/pricing.
- Valor usado: **USD 0,0120 por plantilla de utilidad** (Argentina). Fuente: ominiflow.com/whatsapp-api-pricing/argentina (actualizada 2026-09-12, cita a Meta; marketing 0,0618, autenticación 0,0220). **No confirmado contra el CSV oficial.** Si el CSV dice otra cosa, se carga `WHATSAPP_PRICE_USD_UTILITY` en Vercel y listo, sin deploy de código.
- A la tienda: 0,0120 × 1,10 = **USD 0,0132 por aviso**.
- Límite de clientes nuevos por día del número: 250 personas distintas en 24 h mientras el negocio no está verificado; después 2.000, 10.000, 100.000 y sin límite, según calidad y volumen. **Es un solo número para todas las tiendas.**

## Plantillas para aprobar en Meta (cuenta de Recurrentes · categoría Utilidad · Español (ARG) `es_AR`)

WhatsApp Manager → Plantillas de mensajes → Crear → **Utilidad** → Personalizada. Nombre exacto, cuerpo exacto, "Tipo de variable": **Número**. Pie de página en las cuatro: `Respondé BAJA para no recibir más avisos.` Sin encabezado ni botones. El texto es el mismo que `WA_TEMPLATES` en `shared/platform/whatsapp.js`.

**`aviso_proximo_cobro`**
```
Hola {{1}}, te escribimos de parte de {{2}}: el {{3}} se renueva tu suscripción a {{4}} por {{5}}.

Si querés pausarla o cambiar algo: {{6}}

Es un aviso automático, no hace falta que respondas.
```
Ejemplos: {{1}} Ana · {{2}} LuminaLabs · {{3}} 15 de octubre · {{4}} Cápsulas LuminaLabs · {{5}} $9.480 · {{6}} https://www.recurrentesapp.com/#/portal

**`pago_rechazado`**
```
Hola {{1}}, no pudimos cobrar la renovación de tu suscripción a {{2}} de {{3}}.

Para no perderla, actualizá tu tarjeta desde tu portal: {{4}}

Si ya lo resolviste, ignorá este mensaje.
```
Ejemplos: Ana · Cápsulas LuminaLabs · LuminaLabs · https://www.recurrentesapp.com/#/portal

**`suscripcion_activa`**
```
¡Hola {{1}}! Tu suscripción a {{2}} de {{3}} ya está activa. Tu próximo cobro es el {{4}}.

Desde tu portal podés pausarla, cambiar la dirección o cancelarla cuando quieras: {{5}}

Gracias por sumarte.
```
Ejemplos: Ana · Cápsulas LuminaLabs · LuminaLabs · 15 de octubre · https://www.recurrentesapp.com/#/portal

**`renovacion_cobrada`**
```
Hola {{1}}, te escribimos de parte de {{2}}: ya se cobró la renovación de tu suscripción a {{3}} por {{4}}. Tu próximo cobro es el {{5}}.

Tu portal, por si necesitás cambiar algo: {{6}}

Gracias por seguir con nosotros.
```
Ejemplos: Ana · LuminaLabs · Cápsulas LuminaLabs · $9.480 · 15 de noviembre · https://www.recurrentesapp.com/#/portal

Reglas que respetan los cuatro textos:
- todos llevan el nombre de la tienda como variable (un número habla por muchas tiendas);
- no empiezan ni terminan con una variable, y no hay dos variables pegadas;
- nada promocional: si Meta ve promoción en una de utilidad, la pasa a Marketing (5 veces más cara);
- las variables no llevan saltos de línea (el código los limpia).

## Avisos al comercio ("Avisos para vos")

El mismo número de Recurrentes le avisa al **dueño de la tienda** (no al cliente) cuando un cliente se suscribe, pausa, cancela o le rechazan el pago de una renovación. No hace falta que la tienda haya prendido los avisos a clientes.

- **Dónde:** Configuración → Avisos para vos (solo el dueño). `POST /api/merchant?action=alerts-save { enabled, whatsapp, events, email }` · `alerts-test` (10 por día).
- **Datos (doc de la tienda):** `alerts_whatsapp_enabled`, `alerts_whatsapp` (E.164; vacío = `owner_whatsapp` de la tienda o del login dueño `merchants/{ownerUid}`), `alerts_events { subscribed, paused, cancelled, payment_failed }` (los que faltan cuentan como prendidos), `alerts_email` ("también por mail", prendido por defecto).
- **Cuándo sale:** alta → `notifyActivation`; pago rechazado → `sendPaymentFailedEmail` (solo al pasar a `payment_failed`, no en cada reintento); pausa / baja → portal, panel, `handlePreapproval` del webhook, `syncSubscriber` y pasarelas alternativas (solo si pasa desde un estado que cobra). Dedup en `merchants/{mid}/alert_log/{evento}:{sid}:{clave}` con `create()` (clave: `first` para el alta, id del pago para el rechazo, día de Argentina para pausa / baja).
- **Costo cero si está apagado:** sin `alerts_whatsapp_enabled: true` (o sin WhatsApp de Recurrentes ni `RESEND_API_KEY`) no lee ni escribe nada.
- **Mail de respaldo:** si no hay WhatsApp (env sin cargar, plantilla sin aprobar, error de Meta) sale el mismo texto por mail a `contact_email` (o el mail de la cuenta), con el pie de siempre. Con "también por mail" sale siempre por los dos.
- **Uso:** cada WhatsApp OK suma en `merchants/{mid}/usage/{AAAA-MM}` como cualquier aviso (precio × 1,10) y además en `wa_alerts_sent` / `wa_alerts_cost_usd`. Registro en `message_log` con `type: "merchant_alert"`.

### Plantillas para aprobar (Utilidad · Español (ARG) `es_AR`)

Pie en las cuatro: `Podés apagar estos avisos desde tu panel de Recurrentes.` Sin encabezado ni botones. Mismo texto que `WA_MERCHANT_TEMPLATES` en `shared/platform/whatsapp.js`.

**`aviso_comercio_alta`**
```
🎉 Nueva suscripción en {{1}}: {{2}} se suscribió a {{3}} por {{4}}.

Mirala en tu panel: {{5}}

Es un aviso automático de Recurrentes.
```
Ejemplos: LuminaLabs · Ana · Cápsulas LuminaLabs · $9.480 · https://www.recurrentesapp.com/#/dashboard/suscripciones

**`aviso_comercio_pausa`**
```
Se pausó una suscripción en {{1}}: la de {{2}} a {{3}}.

Mirala en tu panel: {{4}}

Es un aviso automático de Recurrentes.
```
Ejemplos: LuminaLabs · Ana · Cápsulas LuminaLabs · https://www.recurrentesapp.com/#/dashboard/suscripciones

**`aviso_comercio_baja`**
```
Se canceló una suscripción en {{1}}: la de {{2}} a {{3}}.

Mirala en tu panel: {{4}}

Es un aviso automático de Recurrentes.
```
Ejemplos: LuminaLabs · Ana · Cápsulas LuminaLabs · https://www.recurrentesapp.com/#/dashboard/suscripciones

**`aviso_comercio_pago_rechazado`**
```
No se pudo cobrar una renovación en {{1}}: el pago de {{2}} por {{3}} ({{4}}) fue rechazado.

Mirala en tu panel: {{5}}

Es un aviso automático de Recurrentes.
```
Ejemplos: LuminaLabs · Ana · Cápsulas LuminaLabs · $9.480 · https://www.recurrentesapp.com/#/dashboard/suscripciones

## Tareas de Thiago

1. **Verificar el negocio** en Meta Business: https://business.facebook.com/settings/security → Centro de seguridad → Verificación (sube el límite de 250 clientes nuevos por día).
2. **Cuenta de WhatsApp Business (WABA) de Recurrentes:** https://developers.facebook.com/apps/ → crear app tipo **Empresa** → sumar el producto **WhatsApp** → crear o elegir la WABA de Recurrentes.
3. **Número (lo más barato):** un **chip prepago nuevo** de cualquier compañía, o un fijo que reciba llamadas, que **no** esté en la app de WhatsApp. WhatsApp Manager → Números de teléfono → Agregar → verificar por SMS o llamada. Nombre visible: "Recurrentes" (Meta lo aprueba). No hace falta BSP (sin Twilio ni Botmaker).
4. **Token permanente:** https://business.facebook.com/settings/system-users → usuario del sistema **Administrador** → asignarle la app y la WABA → Generar token, vencimiento **Nunca**, permisos `whatsapp_business_messaging`, `whatsapp_business_management` y `business_management`.
5. **Medio de pago** en https://business.facebook.com/wa/manage/home/ → Configuración de pagos (se puede en ARS desde abril de 2026).
6. **Plantillas:** cargar las 4 de arriba, con el nombre y el texto exactos, categoría Utilidad, Español (ARG), el pie y los ejemplos.
7. **Webhook:** en la app → WhatsApp → Configuración → Webhook → URL `https://www.recurrentesapp.com/api/public?action=wa-webhook` y como token de verificación el mismo texto que pongas en `WHATSAPP_VERIFY_TOKEN`. Suscribir el campo **messages**.
8. **Vercel** (Production): `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WABA_ID`, `WHATSAPP_APP_SECRET` (Configuración de la app → Básica → Clave secreta) y `WHATSAPP_VERIFY_TOKEN`. Opcional: `WHATSAPP_PRICE_USD_UTILITY` con el precio de utilidad para Argentina del CSV oficial.
9. **Probar:** prender los avisos en una tienda de prueba → Flujos → paso de WhatsApp → "Probar" a tu celular. Responder "hola" (tiene que llegar la respuesta automática) y "BAJA".
10. **A fin de mes:** `#/admin` → "WhatsApp este mes" y la columna por comercio muestran cuánto cobrarle a cada uno (ya con el 10%).

## Futuro: conexión en 1 clic del número propio (Embedded Signup)

1. Recurrentes se registra como **Tech Provider** en Meta: app de tipo Empresa, verificación del negocio y revisión de la app con acceso avanzado a `whatsapp_business_management` y `whatsapp_business_messaging`.
2. En el panel se carga el SDK de JS de Facebook y se llama a `FB.login(cb, { config_id: WHATSAPP_ES_CONFIG_ID, response_type: "code", override_default_response_type: true, extras: { setup: {} } })`.
3. El popup de Meta guía al comerciante: crea o elige su WABA, agrega el número y lo verifica por SMS. Al terminar, un evento `message` de tipo `WA_EMBEDDED_SIGNUP` (evento `FINISH`) devuelve `phone_number_id` y `waba_id`.
4. El backend canjea el `code`, que vence en unos 30 s: `GET /oauth/access_token?client_id=WHATSAPP_APP_ID&client_secret=WHATSAPP_APP_SECRET&code=…`.
5. `POST /{waba-id}/subscribed_apps` y `POST /{phone-number-id}/register` con `{ messaging_product:"whatsapp", pin:"<6 dígitos>" }`.
6. Se guardan los mismos campos que hoy guarda `whatsapp-save`, así que el resto del código no cambia.
