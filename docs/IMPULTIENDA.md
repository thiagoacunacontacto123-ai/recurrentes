# Impultienda — investigación y plan de integración

Investigación del 2026-09-15, hecha solo con páginas públicas de impultienda.ar: la landing, el centro de ayuda y las páginas de documentación para desarrolladores (webhooks y API). No usamos su API ni sus servidores.

## Resumen

- **Impultienda Digital** (ZOUT TECH LLC, Miami) es un SaaS para vender ebooks, cursos y productos digitales. Ofrece checkout con upsells 1-click e IA que arma la tienda y los ebooks. Cobra con Mercado Pago (solo cuentas de Argentina), Stripe, PayPal, Whop, dLocal Go y transferencia. Dicen tener "+145.000 ventas procesadas".
- **Tiene webhooks salientes desde sep-2026**, solo en el plan Max. Hay de órdenes y de suscripciones, van firmados y se reintentan.
- **La API REST (`/v1`, claves `itd_…`) está documentada pero NO habilitada.** No se puede generar una API key ni crear productos u órdenes desde afuera. Tampoco hay conector oficial de Zapier ni tienda de apps.
- **Sus suscripciones nativas parecen ser solo con Stripe** (en USD). El ejemplo de la documentación trae `processor_subscription_id: "sub_…"`. No encontramos suscripciones con Mercado Pago en pesos. **Ahí está nuestro lugar: cobro recurrente en pesos con MP para vendedores argentinos.**
- **Hoy ya se puede usar Recurrentes con vendedores de Impultienda** vendiendo por link, con la entrega digital nueva (ver "Opciones que funcionan hoy"). La integración de verdad necesita que Impultienda nos habilite acceso.

## Qué encontramos

| Tema | Qué hay | Fuente |
|---|---|---|
| Entrega del producto | PDF subido o **link externo** (Drive, Dropbox, WeTransfer, área de miembros). El comprador lo recibe en el "mail de entrega". Las descargas exigen pago aprobado. | Centro de ayuda |
| Reembolsos | Con MP, PayPal, Whop y dLocal Go, el reembolso **corta el link de descarga solo**. Con Stripe no (hay que pedirle a soporte). | Centro de ayuda |
| "Solo checkout" | Landing afuera (Shopify, systeme.io, HTML propio) y el botón apunta al checkout de Impultienda. | Centro de ayuda |
| Webhooks de órdenes | `order.created`, `order.approved`, `order.rejected`, `order.refunded`, `order.chargeback` y `order.abandoned` (opcional). Payload con orden, montos, moneda, ítems (`main`/`upsell`/`bonus`), email del comprador, `subscription_id` y tienda. | Documentación para desarrolladores |
| Webhooks de suscripciones | `subscription.activated`, `.renewed`, `.payment_failed` y `.canceled`. La clave de acceso es `customer_email`; también trae `status` (trialing/active/past_due/canceled), `billing_interval` y `current_period_end`. | Documentación de webhooks |
| Seguridad de webhooks | `X-Impultienda-Signature` = HMAC-SHA256 (hex) de `timestamp.cuerpo`, más `X-Impultienda-Timestamp` (anti-replay de 5 min). Reintentos durante ~32 h. `payload.id` sirve para idempotencia. Se configuran por cuenta, no por tienda. | Documentación para desarrolladores |
| API REST | `GET /v1/orders` (filtros, cursor, 120 req/min, plan Max). **No habilitada todavía.** No permite crear productos ni tiendas. | Centro de ayuda + documentación |
| Automatización | n8n y Make recibiendo sus webhooks. Sin conector de Zapier. Export a Excel. | Centro de ayuda |
| Conector para Claude (MCP) | Solo lectura (ventas, visitas, carritos). Se está habilitando por etapas. | Página de autorización |
| Otros | Dominio propio (plan Pro), Pixel de Meta con CAPI, Utmify, Clarity y una app de iOS para vendedores (métricas; no permite comprar). | Landing, App Store |
| No encontrado | Tienda de apps de terceros, inyección de scripts por API, OAuth para socios, creación de órdenes externas, revocar acceso por API. | — |

## Qué necesita Recurrentes de Impultienda

1. **Leer el catálogo**: productos del vendedor (id, nombre, precio, imagen) para crear planes sin cargar nada a mano.
2. **Registrar cada cobro**: crear una orden (o licencia) **pagada** por cada cuota que cobramos con MP, para que Impultienda mande su mail de entrega con descarga protegida. También sirve un endpoint que "conceda acceso a este email para este producto".
3. **Revocar el acceso** cuando la suscripción se cancela o queda morosa: un endpoint de revocación, o poder marcar esa orden como cancelada o reembolsada (que ya corta el link solo).
4. **Mostrar el botón "Suscribirme"** en la landing o el checkout: un script inyectable, un bloque HTML o un "producto con link externo" que redirija a nuestro link de suscripción.
5. **Autenticación**: OAuth para socios o una API key por vendedor, con permisos mínimos (productos de lectura, órdenes de escritura).
6. **Webhooks hacia nosotros** (ya existen): `order.refunded` y `order.chargeback` para enterarnos si el vendedor devuelve una cuota.
7. **Una tienda de prueba** (sandbox) para testear sin ventas reales.

## Diseño propuesto

```
Landing de Impultienda ──botón/script──▶ Checkout de Recurrentes (#/checkout?merchant&plan)
                                                │  preapproval MP (pesos, tarjeta)
                                                ▼
                MP cobra ─▶ api/mp/webhook.js / _lib/sync.js ─▶ fulfillCharge
                                                │  channel "impultienda"
                                                ▼
                  adapter impultienda.fulfill ─▶ POST /v1/orders (paid, email, producto)
                                                │  Impultienda manda su mail de entrega
                                                ▼
     cancelación / moroso ─▶ adapter.onCancel ─▶ revocar acceso (o marcar la orden reembolsada)
     order.refunded / chargeback (webhook entrante) ─▶ api/public.js?action=channel-webhook
```

1. **Conectar**: en Integraciones el vendedor pega su API key `itd_…` (o hace OAuth). La guardamos en `merchants/{uid}` (`impultienda_key`, `impultienda_store_id`), igual que el token de MP. No hace falta ninguna variable de entorno nueva: la clave es de cada vendedor. El secreto de sus webhooks también va por vendedor.
2. **Plan**: se elige el producto del catálogo. El plan guarda `item_source: "impultienda"` e `impultienda_product_id`.
3. **Venta**: el botón de su landing lleva a nuestro checkout hosteado. El resto del flujo de MP no cambia.
4. **Cobro**: `fulfillCharge` delega en el adapter (ver `api/_lib/channels/index.js`, sección "Cómo cablearlo después"). El id de la orden de Impultienda ocupa el lugar de `shopifyOrderId`, así que chargeclaim, `shopify_orders[]` y `last_charge_at` quedan iguales. Si falla, queda el error visible, como con Shopify.
5. **Baja**: `onCancel` se llama con try/catch desde los puntos donde una suscripción pasa a `cancelled`, sin bloquear la baja.
6. **Webhooks entrantes**: se agrega un `?action=` en una función existente (no una nueva) y se verifica la firma HMAC.
7. **Activar**: `CHANNELS.impultienda.status = "available"` en `shared/platform/profile.js` solo con el adapter y los tests listos.

El registro `api/_lib/channels/index.js` ya describe este canal (`stage: "research"`, qué necesita, qué webhooks trae) sin cambiar el comportamiento actual.

## Opciones que funcionan hoy (sin Impultienda)

**A. Link de suscripción + entrega digital (disponible ya):**
1. En Recurrentes: Configuración → Negocio → **Productos digitales** y **Sin tienda online**.
2. Planes → Nuevo plan: nombre, precio y cada cuántos días se cobra.
3. En **"Qué recibe tu cliente"**: el link al contenido (Drive, área de miembros, carpeta, link de descarga) y un mensaje corto. Se elige si se manda al activarse y/o en cada renovación.
4. Se copia el **link de suscripción** del plan y se pone en la landing de Impultienda (botón o bloque con link externo), en la bio o en WhatsApp.
5. Con cada cobro, el cliente recibe el mail "Acceder a tu contenido". Queda en Clientes → Registro de mails como "Entrega digital".

Límites: el link es el mismo para todos y **no se corta al cancelar**. Sirve para:
- contenido que cambia cada mes (el vendedor actualiza el link del plan antes de la renovación; la entrega siempre usa el plan actual);
- un área de miembros con usuario y contraseña que el vendedor administra;
- bonus o comunidades donde no importa que el link circule.

**B. Mixto:** si el vendedor tiene plan Max en Impultienda, vende al exterior en USD con las suscripciones de Impultienda (Stripe) y en pesos con Recurrentes (MP).

## Mensaje para el equipo de Impultienda

Para mandar por el widget de soporte del panel de Impultienda o por Instagram ([@impultienda](https://www.instagram.com/impultienda/)):

> Hola, equipo de Impultienda. ¿Cómo están?
>
> Soy Thiago, fundador de Recurrentes (www.recurrentesapp.com), una plataforma argentina de suscripciones con cobro automático en Mercado Pago.
>
> Vemos que muchos vendedores de ebooks y cursos quieren cobrar una cuota mensual **en pesos**, y por lo que leímos, hoy las suscripciones de Impultienda salen por Stripe. Nosotros ya cobramos suscripciones con Mercado Pago (tarjeta, en pesos, con portal para pausar o cancelar) y nos gustaría sumarnos como opción para sus vendedores, sin competir con su checkout.
>
> Para hacerlo bien necesitaríamos:
> 1. Acceso a la API (o una clave de socio) para leer los productos del vendedor.
> 2. Poder registrar una venta pagada (o dar acceso a un email) cada vez que cobramos una cuota, así el comprador recibe la entrega de Impultienda como siempre.
> 3. Poder quitar ese acceso cuando la suscripción se cancela.
> 4. Una forma de poner el botón "Suscribirme" en la landing o el checkout.
>
> ¿Les interesa charlarlo? Podemos arrancar con una prueba chica con 2 o 3 vendedores y ver juntos un esquema de comisión o referidos.
>
> ¡Gracias!
> Thiago · Recurrentes

## Fuentes

- Landing: https://impultienda.ar/
- Centro de ayuda y documentación para desarrolladores: dentro de https://impultienda.ar (la FAQ nombra `/docs/webhooks`)
- App de iOS para vendedores: https://apps.apple.com/app/id6800140857
- Instagram: https://www.instagram.com/impultienda/
