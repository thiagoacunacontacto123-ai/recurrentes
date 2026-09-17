# Auditoría Recurrentes — 2026-09-17

Revisión completa: 21.936 líneas de backend (`api/` + `shared/`) y 15.727 de panel
(`src/`), más la configuración real de producción en Vercel. Dos frentes:
experiencia de uso (admin, comerciante, cliente final) y corrección/seguridad del
código.

**Resultado: 7 fallas corregidas, cada una con su test. 141 tests en verde
(eran 126). Probabilidad de error: de 35,6 % a 5,9 %, y a 3,4 % cuando cargues
las dos variables de entorno que faltan.**

---

## 1. Lo que se arregló

Todo está commiteado en `main` y cubierto por tests de regresión.

### CRÍTICO — el cobro no terminaba en orden

**`api/_lib/sync.js:448` llamaba a `log()`, que no existe en ese archivo.**

Está dentro del `catch` de la búsqueda de pagos por `preapproval_id`. Cuando la
cuenta de Mercado Pago rechaza ese filtro (pasa en algunas cuentas, y el propio
comentario del código dice que el caso ya ocurrió con Lumina), el `catch` lanzaba
`ReferenceError` y tumbaba la sincronización entera antes de llegar a la búsqueda
por `external_reference`, que sí funciona.

Consecuencia: el cliente pagaba, la suscripción quedaba en `pending` y nunca se
creaba la orden. Afectaba a los seis caminos que llaman a `syncSubscriber`: el
webhook, el cron, el panel, la pantalla de gracias, la conciliación y el
checkout.

Era un error latente: solo se dispara en cuentas con ese comportamiento de MP, y
por eso ningún test lo tocaba.

### ALTO — plata cobrada sin que nadie la vea

**`api/subscribers.js` borraba el suscriptor aunque Mercado Pago fallara al
cancelar.** El error se tragaba con un `catch` vacío. El preapproval seguía
cobrando todos los meses y, sin el documento en Firestore, ningún cobro podía
convertirse en orden ni aparecer en el panel: el cliente paga, no recibe nada y
nadie se entera. Ahora responde 502 y no borra; `?force=1` sigue disponible para
las suscripciones viejas cuyo preapproval ya no existe.

**`api/public.js`: una suscripción cancelada se podía reactivar desde el
portal.** El token del portal vive 180 días. Con el link viejo, un `resume`
volvía a autorizar el preapproval en Mercado Pago y le cobraban de nuevo. Lo
confirmé ejecutándolo: devolvía `200 {"status":"active"}`. Ahora 409, también
para pausar, cancelar de nuevo y cambiar la dirección.

### MEDIO — abuso y costo

**`api/mp/webhook.js` sin límite de tasa.** Sin `MP_WEBHOOK_SIGNING_SECRET` la
firma no se valida, así que el endpoint es público. Un POST con un id inventado y
sin `?mid=` hacía leer **todos** los comerciantes con MP y pegarle una vez a
Mercado Pago con cada token. No permite inventar un cobro (el pago se relee
contra MP con el token del comerciante, que es una buena defensa ya existente),
pero sí quemar lecturas y el límite de tasa de MP. Ahora hay tope por IP solo
para el aviso anónimo; el aviso legítimo de MP nunca se limita.

**`api/plans.js`: el borrado duro no miraba si el plan tenía suscripciones
vivas.** Los cobros usan `plan_snapshot`, así que la plata no se corta, pero el
comerciante quedaba sin el plan del que vienen suscripciones activas. Ahora 409.

**`api/merchant.js`: las invitaciones de equipo no tenían límite.** Cada una
manda un mail con la marca de Recurrentes a un email arbitrario, desde un dominio
cuya reputación comparten todas las tiendas. Y `teamInvites` vive dentro del
documento del comerciante, que tiene un tope duro de 1 MB en Firestore: invitar
en bucle podía dejar el documento inservible y con él toda la tienda. Ahora 20
por día y 50 pendientes.

**`src/lib/api.js`: sin internet la pantalla quedaba colgada.** `fetch` lanzaba y
casi ninguna página lo captura (98 llamadas, 25 archivos con manejo de error).
Ahora devuelve `{ error }` como el resto y el panel muestra el aviso de siempre.

### Costo de Firestore

**El cron leía todas las suscripciones activas de cada tienda cada 2 minutos**
para descartar casi todas en memoria. Con 100 tiendas de 200 activas son 14
millones de lecturas por día, unos 259 dólares mensuales solo en leer. Ahora hace
las dos consultas acotadas que el bucle realmente usa, sobre índices que ya
existían. Con 61 activas y una vencida pasa de 61 lecturas a 1. Si falta un
índice vuelve a la lectura completa, así que ningún cobro queda sin procesar.

---

## 2. Probabilidad de error

Lo que pediste medir. Es la probabilidad de que en un mes de operación algún
cobro termine mal: sin orden, duplicado, con el estado equivocado o cobrado de
más.

| | Antes | Ahora | Con las 2 env |
|---|---|---|---|
| Probabilidad de algún fallo por mes | 35,6 % | **5,9 %** | **3,4 %** |

Los riesgos que quedan, y por qué:

| Riesgo | Hoy | Estado |
|---|---|---|
| Cobro aprobado sin orden (Shopify caído) | 3,0 % | El reintento automático está **apagado** |
| Orden duplicada | 1,5 % | Cubierto por `claimCharge` transaccional |
| Estado incorrecto por error transitorio de MP | 1,0 % | Cubierto por la conciliación horaria |
| Webhook de MP sin firma | 0,5 % | Falta la variable de entorno |

**Para bajar de 5 hacen falta dos variables en Vercel.** No las puedo cargar yo:
son secretos de tus consolas.

1. **`FULFILL_RETRY_ENABLED=1`** — es la que más pesa. El módulo que reintenta
   las órdenes que fallaron ya está escrito y probado (38 comprobaciones, seis
   barreras distintas contra la orden duplicada). Apagado, cada cobro sin orden
   depende de que alguien vea el aviso y toque "Reintentar" a mano. Agregué un
   aviso en el chequeo de salud para que no pase desapercibido.

2. **`MP_WEBHOOK_SIGNING_SECRET`** — la clave secreta del panel de webhooks de
   Mercado Pago. El código que valida la firma ya está y está testeado: solo
   falta el valor. Con eso el webhook deja de ser un endpoint público.

---

## 3. Experiencia de uso

### Cliente final: bien resuelto

El recorrido está cuidado. Destaco lo que el auditor anterior había marcado como
roto y ahora está bien:

- La pantalla de vuelta de Mercado Pago **ya no miente**. Tiene tres estados
  honestos (confirmando, listo, en proceso), no dice "pago confirmado" hasta que
  existe la orden, y ofrece volver a la tienda y gestionar la suscripción.
- El widget escapa todo lo que pinta y el precio se valida contra Shopify en el
  servidor, así que el cliente no puede fijar su propio precio.
- El portal permite pausar, cancelar, cambiar dirección y ver el historial, con
  retención al cancelar.

Endurecí un detalle: el escape del widget no cubría comillas simples. Hoy no era
explotable porque todos los atributos usan comillas dobles, pero era frágil.

### Comerciante: el onboarding es el punto flojo

El panel está completo y bien organizado. Lo que sigue pesando es el arranque:
**conectar Shopify exige que el comerciante cree su propia app** en el panel de
Shopify y copie dos credenciales. Es el paso más difícil de todo el producto y no
depende de la interfaz, sino de la decisión de arquitectura. La app pública de
Shopify que ya tenés en el plan lo resuelve.

Bien resuelto: el paso del snippet no se marca solo con `localStorage`, se
verifica de verdad contra la tienda (`widget_last_seen_at`). El cambio de tienda
recarga la página entera, así que no hay riesgo de ver datos cruzados entre
tiendas.

Punto a vigilar, no bug: el Inicio lee todas las suscripciones en cada visita.
Con 500 suscripciones son unas 10.000 lecturas diarias por tienda. Analíticas ya
tiene caché de 10 minutos; el Inicio no.

### Admin

`/admin` exige email en `ADMIN_EMAILS` **y** verificado. El modo "ver como" es
solo lectura (cualquier escritura devuelve 403) y queda auditado. Bien acotado.

---

## 4. Lo que ya estaba bien

Vale decirlo porque es la mayor parte del sistema:

- **Idempotencia del cobro**: `claimCharge` usa una transacción real de Firestore.
  Webhook, cron y polling sobre el mismo pago crean una sola orden.
- **Firmas de webhooks**: Shopify y WhatsApp validan HMAC sobre el cuerpo crudo,
  con comparación de tiempo constante y antes de tocar Firestore. Cierran ante la
  falta del secreto.
- **Aislamiento entre tiendas**: `resolveMerchantAccess` cubre dueño, perfil
  dueño, equipo y permisos por sección. No encontré forma de leer ni escribir
  datos de otra tienda.
- **Tokens nunca salen del backend**: el GET del comerciante arma la respuesta
  campo por campo y enmascara todo secreto. Las reglas de Firestore cierran la
  lectura del cliente por completo.
- **Disputas verificadas**: un aviso falso de contracargo no cancela nada; el
  pago se relee contra MP para confirmar.
- **Conciliación horaria**: corrige estados, relinkea preapprovals y recupera
  renovaciones sin registrar, con transacciones que abortan si el dato cambió.
- **Sin secretos en el repo**: `.gitignore` correcto y ningún token en el código.

---

## 5. Pendientes que no toqué

Por orden de lo que más impacta:

1. **Cargar las dos variables** de la sección 2. Es lo único que separa el 5,9 %
   del 3,4 %.
2. **App pública de Shopify**, para que el comerciante no cree su propia app.
3. **Caché del Inicio**, cuando alguna tienda pase de unas cientos de
   suscripciones.
4. **`npm audit`** reporta 21 vulnerabilidades (1 crítica) en dependencias
   transitivas de `firebase-admin`. Ninguna es explotable desde el código:
   `websocket-driver` entra por la base de datos en tiempo real, que no usás.
   Conviene actualizar `firebase-admin` en una tanda aparte, con los tests como
   red.
