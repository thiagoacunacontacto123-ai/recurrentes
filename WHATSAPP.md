# WhatsApp — avisos a clientes finales (Cloud API oficial de Meta)

Estado: listo detrás de configuración. No manda nada hasta que un comerciante conecta su número **y** activa un flujo con un paso de WhatsApp. Lumina queda igual.

## Cómo funciona

- **Conexión (MVP):** en Configuración → Integraciones → Mensajes → WhatsApp, el comerciante pega su *Phone number ID*, su *WABA ID* y un token permanente (de un usuario del sistema). Opcionalmente pega también el *app secret* de su app de Meta, para que podamos verificar el webhook. Validamos con dos llamadas de solo lectura: `GET /{phone-number-id}` y `GET /{waba-id}/phone_numbers`, y además chequeamos que el número pertenezca a esa WABA. El token se guarda en `merchants/{id}` y el GET solo devuelve `whatsapp_connected` y los datos del número.
- **Envío:** `api/_lib/whatsapp.js` → `sendTemplate()` hace `POST https://graph.facebook.com/v25.0/{phone-number-id}/messages` con `type:"template"` y parámetros de cuerpo posicionales (`{{1}}`, `{{2}}`…). La versión se cambia con `WHATSAPP_GRAPH_VERSION`.
- **Flujos:** hay un paso nuevo, `{ type:"whatsapp", template, lang, vars:{ "1":"nombre", … } }`. Solo sale si hay WhatsApp conectado, el cliente tiene teléfono (`customer_phone`, o el de la dirección de envío) y no se dio de baja. Si no, el paso se saltea y el flujo sigue. Cada envío queda en `merchants/{id}/message_log`, **no** en `email_log`, para no inflar los números de mails del panel.
- **Bajas:** si el cliente responde `BAJA` o `STOP` (con texto o botón), queda registrado en `merchants/{id}/wa_optouts/{sha256(teléfono)}`; si responde `ALTA`, vuelve a recibir. También respetamos `whatsapp_optout: true` y `whatsapp_optin: false` en la suscripción.
- **Webhook:** `/api/public?action=wa-webhook` (no suma funciones). La verificación GET usa `hub.verify_token`. Los POST llevan firma `X-Hub-Signature-256`. El webhook actualiza el estado en `message_log` (sent → delivered → read, o failed) y procesa las bajas.

## Plantillas para aprobar en Meta (categoría Utilidad · idioma Español (ARG) `es_AR`)

Se cargan en WhatsApp Manager → Plantillas de mensajes → Crear → Utilidad → Personalizada. En "Tipo de variable" va **Número**. Cada plantilla lleva pie de página: `Respondé BAJA si no querés recibir más avisos.` El mismo texto está en `shared/platform/whatsapp.js` (`WA_TEMPLATES`) y el panel lo muestra con un botón de copiar.

**`aviso_proximo_cobro`**
```
Hola {{1}}, te escribimos de {{2}}. El {{3}} se renueva tu suscripción a {{4}} por {{5}}.

Si querés pausarla o cambiar algo, entrá a tu portal: {{6}}

Gracias por seguir con nosotros.
```
Ejemplos para Meta: {{1}} Ana · {{2}} LuminaLabs · {{3}} 15 de octubre · {{4}} Cápsulas LuminaLabs · {{5}} $9.480 · {{6}} https://www.recurrentesapp.com/#/portal

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
Hola {{1}}, en {{2}} ya cobramos la renovación de tu suscripción a {{3}} por {{4}}. Tu próximo cobro es el {{5}}.

Tu portal, por si necesitás cambiar algo: {{6}}

Gracias por seguir con nosotros.
```
Ejemplos: Ana · LuminaLabs · Cápsulas LuminaLabs · $9.480 · 15 de noviembre · https://www.recurrentesapp.com/#/portal

Reglas que respetan los cuatro textos:
- no empiezan ni terminan con una variable, y no hay dos variables pegadas;
- no tienen nada promocional: si Meta ve promoción en una plantilla de utilidad, la pasa a Marketing, que es más cara;
- las variables no llevan saltos de línea (el código los limpia).

## Precios y límites (resumen, septiembre 2026)

- **Precio:** desde el 1-7-2025 Meta cobra **por mensaje de plantilla entregado**, ya no por conversación. Las plantillas de utilidad que se mandan dentro de una ventana de 24 h abierta son gratis. Argentina bajó las tarifas de utilidad y autenticación el 1-10-2025, y ahora se puede pagar en ARS. Las tarifas exactas en USD salen de la tabla oficial de Meta, que se descarga desde la página de precios. Referencia de terceros, **no confirmada**: utilidad ≈ USD 0,012 y marketing ≈ USD 0,062.
- **Quién paga:** el comerciante, con la tarjeta de su WABA. Recurrentes no cobra nada extra.
- **Límite de clientes nuevos por día:** 250 personas distintas en 24 h mientras el negocio no está verificado. Después sube a 2.000, 10.000, 100.000 y sin límite, según la calidad y el volumen.

## Futuro: conexión en 1 clic (Embedded Signup)

1. Recurrentes se registra como **Tech Provider** en Meta: app de tipo Empresa, verificación del negocio y revisión de la app con acceso avanzado a `whatsapp_business_management` y `whatsapp_business_messaging`.
2. En el panel se carga el SDK de JS de Facebook y se llama a `FB.login(cb, { config_id: WHATSAPP_ES_CONFIG_ID, response_type: "code", override_default_response_type: true, extras: { setup: {} } })`.
3. El popup de Meta guía al comerciante: crea o elige su WABA, agrega el número y lo verifica por SMS. Al terminar, un evento `message` de tipo `WA_EMBEDDED_SIGNUP` (evento `FINISH`) devuelve `phone_number_id` y `waba_id`.
4. El backend canjea el `code`, que vence en unos 30 s: `GET /oauth/access_token?client_id=WHATSAPP_APP_ID&client_secret=WHATSAPP_APP_SECRET&code=…`. Eso da un token de usuario del sistema de integración del negocio.
5. `POST /{waba-id}/subscribed_apps`: los webhooks del número llegan a la app de Recurrentes, firmados con `WHATSAPP_APP_SECRET`.
6. `POST /{phone-number-id}/register` con `{ messaging_product:"whatsapp", pin:"<6 dígitos>" }`.
7. Se guardan los mismos campos que hoy guarda `whatsapp-save`, así que el resto del código no cambia.

Límite de Embedded Signup: 10 clientes nuevos por semana. Sube a 200 después de la verificación y de la revisión de la app.
