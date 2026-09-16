# Los dos problemas del negocio (16-sept)

## 1. Tiendanube sin widget

**Estado:** el script 10256 quedó `active` con la v2 (00:17 del 16-sept) y el archivo que sirve
Tiendanube es idéntico byte por byte al nuestro (md5 `50b3f8a1…`). Lo que falta es que lo
inyecte en el storefront.

Si después de 10 minutos el HTML del producto sigue sin traer `apps-scripts`, el problema es de
Tiendanube y hay ticket con evidencia: script `active`, versión 2, asociado a la tienda con
`params: { merchant: … }`, y el HTML sin el tag.

**Camino de fondo: portar a NubeSDK.** Resuelve dos cosas de una:
- Es el mecanismo que Tiendanube sostiene para UI en el storefront (los scripts planos son el
  camino viejo).
- Es requisito obligatorio de homologación desde el 5 de junio de 2026.

O sea que el trabajo de NubeSDK no es "un requisito burocrático más": es también la forma de
que el widget deje de depender de un mecanismo que ya está de salida.

---

## 2. Que los envíos salgan tal cual los tiene el comerciante

**La pregunta era si hace falta API con cada proveedor (Andreani, Correo, etc.). No.** Eso solo
haría falta si quisiéramos *comprar etiquetas*. Para mostrar y cobrar el envío alcanza con
preguntarle a la plataforma, que ya tiene todo configurado.

### Shopify

La Admin API expone `GET /shipping_zones.json`: zonas + tarifas por precio y por peso, tal como
las configuró el comerciante. Ya lo usamos (`merchant?action=import-shipping-rates` →
`checkout_shipping_rates`). Con esa tabla se calcula la tarifa exacta del lado nuestro.

### Tiendanube

La API **no tiene endpoint de cotización**: solo `GET /shipping_carriers` y
`/shipping_carriers/{id}/options` (nombres, códigos, días y costos extra). Las tarifas las
calculan los carriers por *callback*: la plataforma le pregunta a la app del proveedor, no al
revés.

Pero el storefront sí tiene el calculador que usa el propio comprador:

```js
window.urls = { "shippingUrl": "{{ store.shipping_calculator_url }}" }
LS.calculateShippingAjax(zipcode, shippingUrl, container)
```

Le mandás el código postal (y la variante, en página de producto) y devuelve las opciones reales
con sus precios, renderizadas por el backend de Tiendanube. Son exactamente las que vería el
cliente en el checkout de la tienda.

**Nuestro widget corre en el storefront**, así que puede llamarlo sin permisos extra ni
integraciones.

### Arquitectura propuesta

1. El envío se cotiza **en el widget**, en la tienda, con el calculador propio de la plataforma
   (Tiendanube) o con la tabla de zonas importada (Shopify).
2. El cliente elige la opción ahí mismo; le pasamos a `checkout/init` el código, el nombre y el
   precio de esa opción.
3. Mercado Pago autoriza el total (producto + envío).
4. Al crear la orden mandamos ese mismo `shipping_line` con su nombre y costo → el comerciante
   despacha con su flujo normal, sin diferencias con una venta suelta.

Con eso "se mantiene todo": las mismas opciones, los mismos precios, el mismo despacho.

### La limitación honesta

Mercado Pago autoriza un **monto fijo** por suscripción. Si el comerciante cambia sus tarifas o
el carrier aumenta, el monto autorizado no se actualiza solo: hay que repreciar la suscripción
(ya existe "Repreciar" en el menú del plan). No es un problema del diseño, es de cómo funciona
el débito automático, pero conviene decirlo en la interfaz para que el comerciante no se lleve
una sorpresa.

Alternativa para evaluar: envío incluido en el precio del plan (muy común en suscripciones), que
elimina el problema de raíz. Se puede ofrecer como opción del plan.

---

## Tiendanube: el mismo problema, otros nombres (investigado 16-sept)

### Lo que encontramos

`POST /orders` acepta solo campos planos: `shipping`, `shipping_option` (un nombre
lindo, no un código), `shipping_cost_customer`, `shipping_pickup_type`. **No acepta
código de carrier, referencia ni sucursal.** Y de hecho, en la orden de prueba
Tiendanube descartó incluso lo que sí le mandamos: `shipping_option` y
`shipping_cost_customer` no quedaron guardados.

El envío vive en otra entidad: el **Fulfillment Order**. Nuestra orden de prueba
(2071590736) lo tiene vacío:

```json
"shipping": {
  "type": "ship",
  "carrier": { "carrier_id": null, "code": "any", "name": null, "app_id": null },
  "option":  { "name": null, "code": "", "reference": null },
  "consumer_cost": { "value": 0 },
  "pickup_details": null
}
```

Esos son los campos equivalentes a `code`/`source` de Shopify:
`carrier.code`, `option.code`, `option.reference` y `pickup_details.location_id`
para el punto de retiro.

### Restricciones (verificadas contra la API, no supuestas)

- Las apps **no pueden crear** fulfillment orders: solo `GET` y `PATCH`. El envío
  se define al crear la orden… pero `POST /orders` no acepta esos campos.
- El `PATCH /orders/{id}/fulfillment-orders/{fid}` **sí** acepta el objeto
  `shipping`, y exige `carrier` junto con `option`:
  `422 { "shipping.carrier": ["must be a non-empty object"] }`.
- Tenemos los scopes necesarios (`read/write_fulfillment_orders`).
- La API **no cotiza**: `GET /shipping_carriers` + `/options` solo listan lo
  instalado. Las tarifas las calculan los carriers por callback.

### Camino propuesto (dos pasos, distinto de Shopify)

1. **Cotizar** con el calculador del storefront (`window.urls.shippingUrl` +
   `LS.calculateShippingAjax`), que devuelve las opciones reales del comerciante.
   Eso vive en el widget, que corre dentro de la tienda.
2. **Crear la orden** como hoy y, inmediatamente después, **`PATCH` al fulfillment
   order** con `shipping.carrier` + `shipping.option` + `pickup_details` para que
   la app de envíos la vea completa.

### Por qué no está codeado todavía

La tienda demo no tiene **ningún carrier instalado** (`GET /shipping_carriers` →
`[]`), así que no hay forma de validar el `PATCH` con datos reales: no sabemos qué
espera exactamente un carrier de Tiendanube en `carrier.code` / `option.reference`.
Codear el PATCH a ciegas es cómo se llegó al bug de Shopify.

**Lo que hace falta antes:** instalar un carrier en la tienda demo (Envíopack,
Zippin o el que sea gratis de probar), hacer una compra por el checkout normal, y
leer su fulfillment order. Con ese ejemplo real, el PATCH se escribe en una hora y
con tests, igual que el de Shopify.
