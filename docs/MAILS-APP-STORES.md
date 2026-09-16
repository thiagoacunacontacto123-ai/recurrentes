# Mails para llegar a las app stores (redactados 2026-09-15)

## Estado de las gestiones (actualizar cuando contesten)

| Gestión | Canal | Enviado | Estado |
|---|---|---|---|
| Tiendanube: 3 preguntas antes de homologación | mail a socios@tiendanube.com | 15-sept 22:24 | esperando respuesta |
| Shopify: autorización escrita (API Terms 2.3.18) | chat de Partner support (agente Mark) | 15-sept 22:30 | dijo que lo dirige a App Review / políticas → **falta número de ticket** |
| Shopify: Payments Platform | formulario oficial | 15-sept | enviado, responden sin plazo definido |

Seguimiento sugerido: si en **7 días** no contestan, insistir. Tiendanube por el mismo hilo;
Shopify pidiendo el estado del ticket en el chat del Partner Dashboard.

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

**OJO (probado 2026-09-15): `partners@shopify.com` NO se atiende desde 2018** — contesta un robot
y te manda al formulario. Usar:
- Formulario (abre ticket, queda por escrito): https://partners.shopify.com/current/support/form
  → categoría **Apps / App development / API**.
- Alternativas: chat en vivo del Partner Dashboard, o 1-866-752-0324 (24/7, en inglés).
- El formulario tiene un campo de texto corto: pegar la **versión corta** de más abajo. Si podés
  adjuntar o pegar más, va la versión larga.

### Versión CORTA (para el formulario)

**Subject:** Written authorization request — recurring charges via Mercado Pago (API Terms 2.3.18)

I run Recurrentes (https://www.recurrentesapp.com), an Argentine app that lets merchants sell
subscriptions. I am requesting **express written authorization under API Terms section 2.3.18**,
and guidance on App Store requirement 1.1.2.

How it works: the merchant connects their own store and their own **Mercado Pago** account.
Mercado Pago charges the recurring payment (the customer authorizes it once in Mercado Pago),
and we then create the matching **paid order** via the Admin API so the merchant fulfils it.
One-time purchases are untouched and still go through Shopify Checkout.

Why we cannot do it inside Shopify Checkout: native subscriptions only support Shopify Payments,
PayPal Express, Authorize.net, Adyen and Stripe. **Shopify Payments does not exist in Argentina**
and Mercado Pago — the dominant local payment method, and the only one most Argentine customers
will use for recurring debit — is not supported for subscriptions. So an Argentine merchant has
no compliant way to sell a subscription in pesos today.

What I am asking: written authorization to keep charging in the merchant's own Mercado Pago
account and registering each charge as a paid order via the Admin API, for merchants who install
the app themselves (we are not listed on the App Store). Every charge is authorized by the
customer and visible to the merchant.

Scale, honestly: 1 live merchant, 32 active subscriptions since June 2026. I would rather ask
than assume, and I will follow whichever path you tell me is correct — I am applying to the
Payments Platform separately.

Happy to share the exact API calls and a demo store.
Thiago Acuña — soporte@recurrentesapp.com

### Versión LARGA (si hay lugar, o para el mail de seguimiento)

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

---

## 3-bis) Shopify Payments Platform — respuestas campo por campo (formulario de Google, 2026-09-15)

- **Partner Account Name:** el nombre de tu organización en el Partner Dashboard (arriba a la izquierda). Si es "Recurrentes", poné `Recurrentes`.
- **Shopify Partner ID:** `4957008` (sale de la URL del dashboard: partners.shopify.com/4957008).
- **Main Contact Full Name:** `Thiago Acuña`
- **Main Contact Email:** `soporte@recurrentesapp.com`
- **Emergency Support Contact Name:** `Thiago Acuña`
- **Emergency Support Contact Email:** `thiagoacunacontacto123@gmail.com` (el personal, para que nunca rebote)

**Business model / differentiator:**
```
Recurrentes is an Argentine app that lets merchants sell subscriptions: the customer buys once
and is then charged automatically every N days, and each charge becomes a paid order in the
merchant's store, ready to fulfil. Customers self-serve pause, address change and cancellation
from their own portal.

Our differentiator is geography, not features: Shopify's native subscriptions only work with
Shopify Payments, PayPal Express, Authorize.net, Adyen or Stripe. Shopify Payments does not
exist in Argentina, and Mercado Pago — the payment method most Argentine customers actually use,
and effectively the only one they will authorize for recurring debit — is not supported for
subscriptions. So Argentine Shopify merchants cannot sell subscriptions in pesos at all today.

We want to close that gap properly: a payments app that accepts Mercado Pago inside Shopify
Checkout with card vaulting, so subscriptions run on Shopify's own Subscription APIs instead of
outside the checkout.
```

**How many merchants do you currently have?**
```
1 live merchant in production (32 active subscriptions since June 2026). We are pre-launch: the
product works end to end and we are onboarding the first cohort of Argentine merchants now.
```

**Estimated annual total GMV:** `≈ USD 5,000 in recurring charges processed today (small: one live merchant, launching now).`

**Estimated annual GMV on Shopify:** `The same ≈ USD 5,000 — 100% of what we process today is for a Shopify merchant.`

**TAM:**
```
Argentina, subscription/recurring commerce. We do not have a reliable public figure for the
number of Argentine Shopify stores, so we prefer not to guess: what we can say is that
subscription commerce here is close to nonexistent because no local gateway supports it, and our
initial target is Argentine merchants selling consumables (supplements, coffee, pet food,
cosmetics). Mercado Pago is the dominant payment method in the country. Happy to share our
bottom-up estimate and pipeline if useful.
```

**Website:** `https://www.recurrentesapp.com`
**Countries:** `Argentina (Mercado Pago Argentina). Uruguay, Chile and Mexico later, same provider.`
**Payment methods:** tildar **Credit Cards / Debit Cards**, **Digital Wallets** y **Other:** `Mercado Pago (wallet balance + saved cards, via Mercado Pago's subscription APIs)`

**Pricing model for merchants:**
```
SaaS subscription, not per transaction: free up to 5 active subscribers, then USD 29 / 69 / 99 /
149 / 299 per month by active subscriber count. We take no cut of the transaction; Mercado Pago's
own processing fee is paid by the merchant to Mercado Pago.
```

**Status page:** `We don't have a public status page yet. We monitor with an internal health endpoint (/api/cron?action=health) and alerting, and we will publish a public status page before launching a payments app.`

**Pitch deck:** opcional, se puede dejar vacío (o subir uno después).
**Internal Shopify referral:** vacío.
**Las 3 confirmaciones:** Yes, Yes, Yes. La segunda dice que revisaste las dev docs de Payments Apps API: leelas por encima antes de tildar (el link está en el formulario).
