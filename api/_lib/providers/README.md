# Pasarelas de pago (`api/_lib/providers`)

Capa para cobrar suscripciones con pasarelas **distintas de Mercado Pago**.
Mercado Pago no pasa por acá: su checkout, webhook, sync y órdenes siguen en
`checkout/init.js`, `mp/webhook.js` y `_lib/sync.js`. En el registro solo hay un descriptor fino de MP.

| Archivo | Qué hace |
|---|---|
| `index.js` | Registro: `getProvider`, `getEnabledProvider`, `checkoutProviderFor`, `listProviders`, flags |
| `mobbex.js` | Adapter de Mobbex (ARS) |
| `stripe.js`, `whop.js` | Adapters de Stripe y Whop (los hace otro agente). Si el archivo no está, el registro usa un placeholder apagado |
| `webhookToken.js` | Token HMAC para las URLs de webhook (`?mid=&t=`) |
| `webhook.js` | Handler de `POST /api/public?action=provider-webhook&p=<id>&mid=<merchant>&t=<token>` |
| `checkout.js` | Último paso del checkout con una pasarela alternativa (lo llama `checkout/init.js`) |
| `merchantActions.js` | `save-mobbex` / `disconnect-mobbex` y campos seguros para `GET /api/merchant` |
| `../charges/processProviderCharge.js` | Aplica los eventos normalizados: claim atómico → orden o comprobante → status → mails y flujos |

## Flags de entorno

Cada pasarela se prende con `<ID>_ENABLED=1`: `MOBBEX_ENABLED`, `STRIPE_ENABLED`, `WHOP_ENABLED`.
Mercado Pago siempre está prendido.

Con el flag apagado:
- `getEnabledProvider(id)` y `checkoutProviderFor(merchant)` devuelven `null`, así que el checkout va por Mercado Pago como siempre.
- En el panel la pasarela aparece como "Próximamente" y no se pueden guardar claves.
- Los webhooks de suscripciones **ya creadas** se siguen procesando (`webhook.js` usa `getProvider`, no `getEnabledProvider`). Si no, un cobro pagado quedaría sin orden. También se puede desvincular.

`checkoutProviderFor(merchant)` solo devuelve un adapter si se cumplen las dos cosas:
- `merchant.payment_provider` es distinto de `mercadopago`;
- el flag de esa pasarela está prendido.

Un merchant sin el campo (Lumina) devuelve `null` sin cargar ningún adapter.

## Interfaz de un adapter (contrato)

El archivo exporta el adapter como `export default { ... }`. El registro valida al cargarlo que tenga **todas** estas claves (`ADAPTER_KEYS`) y que `id` coincida. Si falta algo, queda un placeholder apagado y se loguea el error.

```js
{
  id: "mobbex",                 // igual al nombre del archivo
  label: "Mobbex",
  currency: "ARS",              // "ARS" | "USD"
  isEnabled(),                  // bool; leer el flag de entorno (<ID>_ENABLED) + lo que necesite

  async createSubscriptionCheckout({
    merchant, merchantId, subscriberId,
    sub,                        // subscriber pending ya guardado (plan_snapshot, customer_*, shipping_address…)
    plan,                       // doc del plan
    amount, currency,           // monto POR COBRO (con qty + envío + cupón), en `currency`
    frequencyDays,
    backUrl,                    // #/checkout-success?sub=&token= (CheckoutSuccess hace polling)
    notificationUrl,            // /api/public?action=provider-webhook&p=<id>&mid=<mid>&t=<token>
    customer,                   // { email, name, phone, tax_id, address }
  }) → { checkoutUrl, providerSubscriptionId | null, providerPlanId | null, raw }
  // Errores: lanzar un Error con `status: 400` + `userMessage` si el problema es de
  // datos o configuración (se muestra al comprador); cualquier otro error → 502 genérico.

  async parseWebhook(req, { getMerchant }) → {
    ok, merchantId, status?, error?,
    events: [{
      type: "charge_approved" | "charge_failed" | "subscription_cancelled"
          | "subscription_paused" | "subscription_resumed",
      providerSubscriptionId,   // mismo formato que devolvió createSubscriptionCheckout
      subscriberRef,            // "mid:sid" (lo que mandamos como reference) o null
      paymentId,                // id del cobro en la pasarela (para charge_*)
      amount, currency, date,   // date ISO
      raw,
    }],
  }
  // Tiene que VERIFICAR AUTENTICIDAD (firma de la pasarela y/o verifyProviderWebhookToken
  // de webhookToken.js). Aviso inválido → { ok: false, status: 401 }. Si lanza,
  // respondemos 500 y la pasarela reintenta.

  async cancel(merchant, providerSubscriptionId),
  async pause(merchant, providerSubscriptionId),
  async resume(merchant, providerSubscriptionId),
  async testCredentials(creds) → { ok, account?, error? },
}
```

### Qué hace el núcleo con los eventos (`processProviderCharge.js`)

- **Subscriber**: se resuelve por `subscriberRef` (`mid:sid`) o por `provider_subscription_id`. Solo se aceptan subs con `payment_provider === <id>`, así que un evento de Mobbex nunca toca una sub de MP.
- **`charge_approved`**:
  1. El id del cobro es `<id>_<paymentId>` (por ejemplo `mobbex_ABC123`): es el doc en `charges/` y va en `mp_payment_id` (nombre histórico).
  2. `claimCharge` hace un claim atómico: si el aviso llega dos veces, se cumple una sola vez.
  3. `fulfillCharge` crea la orden Shopify o el comprobante `rec_<id>`.
  4. Actualiza el subscriber: `status` (no revive una cancelada ni una pausada), `last_charge_at`, `shopify_orders[]`, `next_charge_at` estimado.
  5. Llama a `notifyActivation` (el primer cobro) o `notifyRenewal`: mails, Meta, Klaviyo, flujos.
- **`charge_failed`**: `applyPaymentFailed`. Deduplica por id y solo marca subs recurrentes.
- **cancelled / paused / resumed**: cambian el status local y disparan `emitFlowEvent`. Un "resumed" solo reactiva una sub pausada.

Campos que escribe el checkout en el subscriber:
`payment_provider`, `provider_currency`, `provider_checkout_url`, `provider_plan_id`, `provider_subscription_id`.

En el charge escribe:
`provider`, `provider_payment_id`, `provider_subscription_id`, `amount`, `currency`, `amount_ars` (solo si la moneda es ARS), `paid_at`, `amount_mismatch?`.

## Mobbex

Docs: https://mobbex.dev (suscripciones, suscriptores, ejecuciones, webhooks, códigos de estado) y el SDK oficial https://github.com/mobbexco/php-plugins-sdk.

- **Credenciales por merchant**: `x-access-token` va en `merchant.mobbex_access_token`. `x-api-key` va en `merchant.mobbex_api_key`, o sale de env `MOBBEX_API_KEY` si Recurrentes tiene una app propia en Mobbex.
- **Modo prueba**: `merchant.mobbex_test` o env `MOBBEX_TEST=1` manda `test: true`. En prueba, Mobbex devuelve la moneda como `"TEST"`, y nosotros la tomamos como ARS.
- **Checkout**: se hacen dos llamadas.
  1. `POST /p/subscriptions` crea un plan ad-hoc con el monto exacto. Lleva `type: "dynamic"`, el `interval` (7d, 15d, 1m, 2m, 3m, 6m o 1y), `webhook: notificationUrl`, `reference: "rec:mid:sid"` y `features: ["charge_on_first_source"]`.
  2. `POST /p/subscriptions/{sid}/subscriber` crea el suscriptor con `customer.identification` (el DNI es obligatorio), `reference: "mid:sid"`, `total` y `startDate`. Mobbex devuelve `sourceUrl`, que es el `checkoutUrl`.
  - Solo se aceptan frecuencias equivalentes a esos intervalos. Cualquier otra da un 400 con un mensaje claro.
- **Primer cobro**: `charge_on_first_source` cobra apenas el cliente carga la tarjeta. `startDate` es la fecha del **segundo** cobro (hoy + frecuencia), así nunca hay dos cobros el mismo día. ⚠️ Esto hay que verificarlo en sandbox antes de producción.
- **Ids**:
  - `providerPlanId` es el uid de la suscripción.
  - `providerSubscriptionId` es `"<uid suscripción>:<uid suscriptor>"`.
- **Acciones**:
  - pausar: `POST …/subscriber/{suid}/action/suspend`
  - reactivar: `POST …/action/activate`
  - cancelar: `DELETE …/action/delete`. Mobbex no tiene "cancel".
- **Webhook**:
  - Llega como JSON o form-urlencoded (`data[payment][id]`); `parseMobbexBody` soporta los dos.
  - `subscription:execution` con `payment.status.code` 200 es `charge_approved`. Los códigos 400–419, 500 y 601–610 son `charge_failed`. El resto (en proceso o liquidación) se ignora.
  - `subscription:execution:error` es `charge_failed`.
  - `subscription:subscriber:suspended` es un paused, y `…:active` es un resumed.
- **Autenticidad**: Mobbex no firma sus webhooks. Por eso hacemos dos cosas:
  1. Validamos el token HMAC del merchant que va en la URL (el mismo criterio que el `?mobbex_token=` del plugin oficial).
  2. Re-consultamos `GET /p/subscriptions/{sid}/subscriber/{suid}` con las credenciales del merchant. El suscriptor tiene que existir en su cuenta y tener una reference `mid:*`.
- **Validar credenciales**: `GET /p/subscriptions?page=0`. No hay un endpoint documentado de "quién soy".

## Cómo se enchufa Stripe / Whop

1. Crear `api/_lib/providers/stripe.js` (o `whop.js`) con `export default adapter` que cumpla el contrato de arriba. `id` tiene que ser `"stripe"` o `"whop"`, y `isEnabled()` tiene que leer `STRIPE_ENABLED` o `WHOP_ENABLED`.
2. Para autenticar el webhook, verificar la firma propia de la pasarela (Stripe-Signature, secreto de Whop). Si la firma necesita el body crudo, ver la nota de body parsing en el reporte del lead. Si además se quiere el token por merchant, usar `verifyProviderWebhookToken(id, mid, t)`.
3. Monedas: el núcleo guarda `amount` + `currency`. Todavía no hay precios en USD por plan; `checkout/init` pasa el total en pesos y `currency: adapter.currency`. **Pendiente: moneda por merchant/plan antes de prender una pasarela en USD.**
