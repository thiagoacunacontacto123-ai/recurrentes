# Pendientes que dependen de Thiago — 2026-09-13

## Deploy 2 (beta pública: shell nuevo + multi-tienda + equipo)
- **Firestore → Rules:** volver a pegar `firestore.rules` y publicar (cambió: ahora un miembro de equipo puede leer la tienda a la que fue invitado).
- `git push origin main` y esperar el deploy.
- Entrar al dashboard de Lumina y verificar que todo se ve igual (tabs, integraciones, planes). Si algo falla: Vercel → Deployments → Instant Rollback al anterior.
- Probar el registro con un mail nuevo (modo incógnito): verificar mail → onboarding → conectar Shopify (app custom) y MP (token) → crear plan → pegar snippet.
- Legales: `src/pages/Legal.jsx` tiene un borrador con `[CUIT]` y `[email de contacto]` para completar.
- Opcional para OAuth de MP en la beta: cargar `MP_APP_ID` y `MP_CLIENT_SECRET` en Vercel y agregar el redirect en la app de MP.

## Deploy 1 (auditoría) — ya hecho el 2026-09-13
El código de la auditoría quedó commiteado y deployado. Lo que sigue pendiente de aquella lista:

## Antes del deploy (5 min)
1. **Vercel → Environment Variables (Production):**
   - `CRON_SECRET` = string largo aleatorio (sin esto el cron acepta solo al cron interno de Vercel; con esto queda cerrado).
   - `PORTAL_SECRET` (opcional; si no está usa `MP_WEBHOOK_SECRET`, que ya existe). NO cambiar `MP_WEBHOOK_SECRET`: rompe los links del portal que ya se mandaron.
   - `MP_WEBHOOK_SIGNING_SECRET` = "Clave secreta" del panel de webhooks de MP (Tus integraciones → app → Webhooks). Hasta que esté, el webhook acepta sin firma (igual que hoy).
   - `APP_BASE_URL` ya existe; confirmar que es `https://recurrentess.vercel.app` (o el dominio final).
2. **Firestore:** publicar `firestore.rules` (Console → Rules → pegar → Publish) y crear los índices de `firestore.indexes.json` (Console → Indexes, o `firebase deploy --only firestore:indexes` si instalás el CLI). Sin índices el dashboard sigue andando (hay fallbacks), pero conviene.
3. **Firestore → política TTL** sobre la colección `ratelimits`, campo `expires_at` (opcional, evita basura).

## Deploy
4. `git push origin main` (autodeploy) o `npx vercel deploy --prod`. Hacerlo en horario de pocas ventas y mirar los logs 15 min. Verificar: un checkout de prueba completo (packs 1, 2 y 3 dan $40.491 / $53.991 / $67.491 + envío, cada 60/120/180 días, igual que antes).

## Después del deploy (dashboard → Configuración)
5. Cargar **tarifas de envío del checkout** (hoy usa las 2 de siempre por default), **dominio de la tienda** (`luminalabs-arg.com`), **remitente/marca de mails** (`LuminaLabs <soporte@luminalabs-arg.com>`, marca "LuminaLabs").
6. Recién ahí prender **Carrito abandonado** (toggle) y elegir los cupones de los pasos 2 y 3. Antes de prender, probar los 3 pasos con "Probar mail".
7. Marcar los cupones de recupero como `recovery_only` si no querés que circulen por URL.

## Para abrir a público (requieren cuentas/decisiones tuyas)
8. **Mercado Pago OAuth:** en la app de MP Developers agregar Redirect URL `https://<APP_BASE_URL>/api/mp/oauth-callback`; el código ya está (`MP_APP_ID`/`MP_CLIENT_SECRET` ya existen en env).
9. **Shopify app única:** crear la app en Partners con redirect `https://<APP_BASE_URL>/api/shopify/oauth-callback`, scopes `read_products,write_orders,read_customers,write_customers,read_shipping`, y registrar los webhooks `app/uninstalled`, `customers/data_request`, `customers/redact`, `shop/redact` → `https://<APP_BASE_URL>/api/shopify/webhooks`. Cargar `SHOPIFY_API_KEY/SECRET` en Vercel (ya existen las vars).
10. **Resend multi-merchant:** decidir remitente por merchant (dominio verificado de cada uno vs. subdominio propio).
11. **Legal:** escribir Términos y Privacidad (hay páginas placeholder en `#/terminos` y `#/privacidad`).
12. **Billing del SaaS:** cómo le cobrás a los merchants (Stripe o MP). No hay nada de esto en el código.
13. **Cifrado de tokens en Firestore:** requiere una clave (`SECRETS_KEY`) + migración; lo dejé para hacerlo con vos.

## Cambios de comportamiento que tenés que saber
- Órdenes Shopify ahora **descuentan stock** y van con `taxes_included: true`.
- API de Shopify pinneada a `2025-07` (antes 2024-10, fuera de soporte).
- Token del portal dura 180 días (antes 365). Los viejos siguen validando.
- "Simular próximo cobro" solo aparece con `dev_mode` activado y ya no manda mail ni crea orden pagada.
- Texto del checkout: "Pagás con Mercado Pago (tarjeta de crédito, débito o dinero en cuenta según disponibilidad)".
- Cupón con `first_charge_only`: el primer cobro va con descuento y el preapproval se sube al precio completo después del primer pago.
