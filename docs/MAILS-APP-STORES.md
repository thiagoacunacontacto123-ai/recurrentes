# Mails para llegar a las app stores (redactados 2026-09-15)

Datos reales para no exagerar nada:
- Recurrentes: SaaS argentino de suscripciones con cobro recurrente en Mercado Pago.
- Hoy: 1 tienda real en producción (LuminaLabs, Shopify) con 32 suscripciones activas desde junio 2026, y una app de Tiendanube (ID 42443) recién aprobada para desarrollo.
- Modelo: el comerciante conecta su Shopify (app creada por él) o su Tiendanube (app de Partner), y su cuenta de Mercado Pago. MP cobra la renovación y Recurrentes crea la orden ya pagada en la tienda.
- Precio del SaaS: por suscriptores activos, en USD (Free hasta 5 · 29 · 69 · 99 · 149 · 299).

---

## 1) Tiendanube — socios@tiendanube.com

**Asunto:** Recurrentes (app 42443) — consulta antes de enviar a homologación

Hola, ¿cómo están?

Soy Thiago Acuña, desarrollador de **Recurrentes** (app 42443 en el portal de Partners).

Recurrentes permite que una tienda venda por suscripción con cobro automático en
**Mercado Pago**: el cliente elige el producto y cada cuántos días lo quiere recibir,
paga una vez y después se le cobra solo. Con cada cobro, Recurrentes crea en la tienda
la **orden ya pagada** (`POST /orders` con `payment_status: paid`), y el comerciante
solo despacha. El cliente puede pausar, cambiar la dirección o cancelar desde un portal
propio, sin escribirle a la tienda.

Antes de enviar la app a homologación quería confirmar tres cosas con ustedes:

1. **Cobro del servicio.** Recurrentes le cobra al comerciante una suscripción mensual
   por cantidad de suscriptores activos. ¿Puede cobrarse por fuera de Tiendanube, o para
   estar publicada en la tienda de aplicaciones tenemos que cobrar a través de ustedes?
2. **Órdenes pagas por API.** Queremos confirmar que crear la orden con
   `payment_status: paid` por cada cobro hecho en Mercado Pago es el uso correcto de la
   API para una app publicada, y si prefieren que informemos algo en particular en la
   orden (hoy dejamos nota interna y `extra` con el id del pago de MP, porque las órdenes
   no admiten etiquetas y el medio de pago queda como "offline").
3. **Homologación.** ¿Hay algún requisito o checklist además de los webhooks de
   privacidad y los permisos, y cuánto suele demorar la revisión?

Un dato de contexto: Tiendanube ya tiene suscripciones nativas, pero (según la
documentación) solo con Pago Nube, tarjeta de crédito y desde el plan Impulso.
Nuestro espacio es el comerciante que quiere cobrar con **Mercado Pago**, aceptar
débito, y manejar variantes y packs.

Quedo a disposición para lo que necesiten.

Gracias,
Thiago Acuña — Recurrentes
soporte@recurrentesapp.com · https://www.recurrentesapp.com

---

## 2) Shopify — autorización por escrito (Partner support)

Enviar desde el Partner Dashboard → Support, o a partners@shopify.com.
En inglés, que es como responden más rápido.

**Subject:** Written authorization request — recurring charges via Mercado Pago in Argentina (API Terms 2.3.18)

Hello,

My name is Thiago Acuña. I run **Recurrentes** (https://www.recurrentesapp.com), an
Argentine app that lets merchants sell subscriptions.

I am writing to request **express written authorization** under section 2.3.18 of the
Shopify API Terms of Service, and guidance regarding App Store requirement 1.1.2.

**What the app does.** The merchant connects their own Shopify store and their own
**Mercado Pago** account. Mercado Pago charges the recurring payment (the customer
authorizes it once), and Recurrentes then creates the corresponding **paid order** in
the merchant's store through the Admin API, so the merchant fulfils it normally. We do
not touch the one-time checkout: a regular purchase still goes through Shopify Checkout.

**Why we cannot do this inside Shopify Checkout.** Shopify's native subscriptions only
support Shopify Payments, PayPal Express, Authorize.net, Adyen and Stripe. Shopify
Payments is not available in Argentina, and Mercado Pago — which is the dominant payment
method here, and the only one most Argentine customers use for recurring debit — is not
supported for subscriptions. So for an Argentine merchant there is today no compliant way
to sell a subscription charged in pesos.

**What we are asking.** Written authorization to keep charging the recurring payment in
the merchant's own Mercado Pago account and registering each charge as a paid order via
the Admin API, for merchants who explicitly connect the app to their store. Every
merchant installs their own app (we are not listed on the App Store), each charge is
authorized by the customer in Mercado Pago, and the merchant sees every order and charge
in their Shopify admin.

We are a small team: 1 live merchant today, with 32 active subscriptions since June 2026.
We would rather ask than assume, and we will follow whatever path you tell us is correct —
including the Payments Platform route, which I am applying to separately.

Happy to share the technical details, the exact API calls we make and a demo store.

Thank you,
Thiago Acuña — Recurrentes
soporte@recurrentesapp.com

---

## 3) Shopify — Payments Platform (proveedor de pagos)

Formulario oficial: https://www.shopify.com/paymentsplatformapplication
Si el formulario pide un resumen, pegar esto. Si no, mandarlo como mail de seguimiento.

**Subject:** Payments Platform application — Mercado Pago recurring payments for Argentina (Recurrentes)

Hello,

I would like to apply to the Shopify Payments Platform (Payments Apps API) with
**Recurrentes** (https://www.recurrentesapp.com), from Argentina.

**What we want to build.** A payments app that lets Argentine merchants accept
**Mercado Pago** inside Shopify Checkout, with card vaulting so it can also be used for
**subscriptions** (Shopify's Subscription APIs). Today Argentine merchants have no way to
sell subscriptions in their own currency: Shopify Payments is not available here, and
Mercado Pago is not supported as a subscription gateway, even though it is the payment
method most local customers use.

**Where we are.** We already run subscriptions for Argentine merchants: Mercado Pago
charges the recurring payment and we create the paid order through the Admin API. It works,
but we know that model does not fit App Store requirement 1.1.2, which is exactly why we
want to move into the Payments Platform instead of growing outside the rules.

**Current scale, honestly.** 1 live merchant, 32 active subscriptions since June 2026,
growing. We understand general availability requires around 50 stores and USD 1M
processed, so what we are asking for now is the path: whether we can start in a limited /
early-access capacity, what the requirements are, and what we should have ready
(PCI, entity, MP certification) by the time we reach that volume.

**Why it matters for Shopify.** Argentine ecommerce is large and subscriptions are
essentially unavailable here. The merchants asking us for this are today either not selling
subscriptions at all, or leaving Shopify for local platforms that do support recurring
charges.

I can share technical documentation, our current integration and a demo.

Thank you,
Thiago Acuña — Recurrentes
soporte@recurrentesapp.com
