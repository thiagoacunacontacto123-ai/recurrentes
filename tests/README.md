# Tests del camino del cobro (red de seguridad de Lumina)

Qué protegen: que un cobro de Mercado Pago siga terminando en **una** orden paga en
Shopify, con el mail correcto, sin importar lo que cambie en el resto del código.

## Cómo correrlos

```bash
npm test
```

Requisitos: Node 22 o más nuevo (usa `node:test` y `module.registerHooks`) y las
dependencias instaladas (`npm install`). No usa internet, ni Firebase, ni cuentas de
MP o Shopify. Tarda un par de segundos.

Un solo archivo: `node --test tests/money-path/webhook-payment.test.mjs`
Ver los `console.log` del código: `RECURRENTES_TEST_VERBOSE=1 npm test`

## Qué cubre (tests/money-path/)

| Archivo | Qué prueba |
|---|---|
| `webhook-payment.test.mjs` | `api/mp/webhook.js`: renovación → 1 orden con line items / envío / tags `RECURRENTE` / cliente / dirección / DNI; charge escrito; reentrega y 3 entregas en paralelo → 1 orden (chargeclaim); primer cobro → activa + mail de activación (Resend) + email_log; renovación → suma a `shopify_orders` y mueve `last_charge_at`; rechazo → `payment_failed` + 1 mail por payment id; sin dirección → `FALTA-DIRECCION`; centavos; sub cancelada; Shopify caído y reintento; dedup contra Shopify; varios merchants; firma `x-signature`. |
| `sync.test.mjs` | `syncSubscriber` (búsqueda por plan ad-hoc, orden, activación, idempotencia), atajo `?mid&sid` del webhook, forzar el primer cobro una sola vez, token de MP inválido (401), renovación rechazada. |
| `checkout-init.test.mjs` | `POST /api/checkout/init` de Lumina: precio validado contra Shopify, monto / frecuencia / `back_url` / `notification_url` del plan de MP (desde `APP_BASE_URL`), sub `pending`, tarifas legacy, reuso del plan, validaciones, cascada de medios de pago, MP caído. |
| `portal.test.mjs` | `api/public.js?action=sub`: pausar / reactivar / cancelar con token de portal, tokens viejos (MP_WEBHOOK_SECRET), token inválido, MP caído, tienda que no permite cancelar. |
| `flows-hook.test.mjs` | `emitFlowEvent` hace **cero** lecturas si la tienda no tiene flujos; con flujos, el webhook engancha activación / renovación / rechazo. |
| `widget.test.mjs` | `api/widget.js` sirve JavaScript válido con `API_BASE` = `APP_BASE_URL`, el merchant y las tarifas legacy. |
| `infra.test.mjs` | Chequea el propio andamiaje (Firestore en memoria, router de fetch). |

## Cómo funciona (tests/helpers/)

- `register.mjs` — lo importa cada test primero. Con hooks de módulos de Node cambia
  `api/_lib/firebase.js` por `mock-firebase.mjs` y `firebase-admin/firestore` por
  `mock-firestore-admin.mjs`; pisa las variables de entorno con valores falsos; bloquea
  la red; silencia los logs.
- `fake-firestore.mjs` — Firestore en memoria: queries, `set` con merge, `update` con
  paths con punto, `FieldValue` (delete, increment, arrayUnion, arrayRemove,
  serverTimestamp), `Timestamp`, `count()`, `batch()`, `collectionGroup` y
  `runTransaction` **serializable** (reintenta si otro escribió lo que leyó, como el
  SDK real). Un `undefined` en un write **lanza**, igual que en producción.
- `fetch-router.mjs` — reemplaza `fetch`. Solo deja pasar `api.mercadopago.com`,
  `*.myshopify.com/admin/api` y `api.resend.com`; todo lo demás (Meta, Klaviyo…) falla
  y el test se cae con `router.assertClean()`.
- `fakes.mjs` — Mercado Pago, Shopify y Resend falsos con estado; guardan cada payload.
- `world.mjs` — el merchant "Lumina" legacy (sin `business_type` / `channel` /
  `payment_provider`), su plan, suscriptores y pagos de ejemplo.

Para un test nuevo: `import "../helpers/register.mjs"`, después
`const W = createWorld()` y cargá el módulo con `await loadApi("api/…")`.

## Si un test falla después de un cambio

Leé el nombre del test: dice qué comportamiento del cobro cambió. Si el cambio fue a
propósito, actualizá el test en el mismo commit y explicá por qué. Si no, es una
regresión: no se mergea.
