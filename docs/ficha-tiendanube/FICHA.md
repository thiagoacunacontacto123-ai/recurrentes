# Ficha para la Tienda de aplicaciones de Tiendanube

App 42443 · handle sugerido `recurrentes` · redactado 2026-09-15.
Todo lo de acá va en Partners → Aplicaciones → 42443 → **Datos de publicación → Editar datos**.
Las imágenes están en esta misma carpeta y copiadas en `~/Downloads/ficha-tiendanube/`.

> **Antes de mandar a homologación**, recordar que desde el 5 de junio de 2026 Tiendanube exige
> NubeSDK (ver `MAILS-APP-STORES.md`). Esta ficha se puede cargar y enviar igual: sirve para
> entrar en la cola y que contesten, no para que aprueben sola.

## Datos básicos

| Campo | Valor |
|---|---|
| Nombre | Recurrentes |
| App handle | `recurrentes` |
| Descripción corta (51/64) | Suscripciones con cobro automático por Mercado Pago |
| Categoría | Ventas / Otros (la más cercana a suscripciones; Tiendanube no tiene categoría propia) |
| Países | Argentina |
| Idioma | Español |
| Mail de soporte | soporte@recurrentesapp.com |
| Sitio | https://www.recurrentesapp.com |
| Instalación | https://www.recurrentesapp.com |
| Términos | https://www.recurrentesapp.com/#/terminos |
| Privacidad | https://www.recurrentesapp.com/#/privacidad |
| Formas de cobro | **Gratis** (facturamos nosotros) — ver nota abajo |
| Prueba gratis | vacío (no hay trial) |
| Nombre de la app | Recurrentes (11/35) |

## Formas de cobro: por qué "Gratis"

El formulario de Tiendanube ofrece Gratis / Pago único / Pago mensual recurrente, y aclara:
"Si desea utilizar su propio sistema de facturación, elija la opción gratuita". El pago mensual
por Tiendanube acepta **un solo monto en ARS** y "de este importe se deducirán los impuestos y
la comisión de Tiendanube".

No sirve para Recurrentes: los precios son en USD y por tramos de suscriptores activos
(`shared/platform/pricing.js`), y ya facturamos nosotros (plan-request + `plan_activated`).
Por eso va **Gratis**, que en ese formulario significa "Tiendanube no cobra la instalación",
y los tramos se explican en la descripción larga.

## Descripción larga

### Introducción

Vender una vez está bien. Que te compren solos todos los meses es otra cosa.

Recurrentes convierte cualquier producto de tu Tiendanube en una suscripción que se cobra
automáticamente con Mercado Pago. El cliente elige suscribirse en la página del producto, y
cada período Mercado Pago le cobra y la orden aparece paga en tu tienda, lista para despachar.

### ¿Qué es Recurrentes?

Una app argentina para tiendas argentinas. Mercado Pago es el medio de pago que usa todo el
mundo acá y el único que permite débito automático local, así que armamos las suscripciones
alrededor de eso en lugar de pedirte que tus clientes paguen de otra forma.

No reemplaza tu checkout ni te cambia la operación: tus órdenes siguen siendo órdenes de
Tiendanube, con la nota RECURRENTE para que las distingas de las compras únicas.

### ¿Cómo funciona?

1. Conectás tu Tiendanube y tu Mercado Pago, cada uno con un clic.
2. Elegís un producto de tu catálogo y creás el plan: cada cuántos días se cobra, qué
   descuento tiene frente a la compra única y cuántas unidades van por envío.
3. En la página del producto aparece el selector "Compra única / Suscripción". El cliente
   elige, completa sus datos y autoriza el pago recurrente en Mercado Pago.
4. Cada período, Mercado Pago cobra solo. Nosotros escuchamos el cobro y creamos la orden
   paga en tu tienda automáticamente.

### Funciones

- **Planes por producto**: frecuencia libre (7, 15, 30 días o la que quieras), descuento por
  suscripción, unidades por envío y descuentos por cantidad.
- **Packs**: armá combos de varias unidades con su propio precio.
- **Portal del cliente**: tus suscriptores pausan, reactivan o cancelan solos, sin escribirte.
- **Flujos de mail propios**: aviso antes de cada cobro, bienvenida, pago rechazado,
  recuperación. Salen con tu mail de atención al cliente al pie.
- **Avisos para vos**: te enteramos cuando alguien se suscribe, pausa o cancela.
- **Panel con lo que importa**: suscriptores activos, ingreso recurrente, cobros y fallos.
- **Reintentos y conciliación**: si un cobro falla lo reintentamos; y cada hora cruzamos todo
  contra Mercado Pago para que nunca te quede un cobro sin su orden.

### Beneficios de instalarla

- Ingreso previsible en lugar de empezar el mes de cero.
- Menos trabajo manual: las órdenes de las renovaciones se crean solas.
- Menos mensajes: el cliente se maneja desde su portal.
- Cobrás con la cuenta de Mercado Pago que ya tenés. La plata entra directo a tu cuenta:
  no pasa por nosotros en ningún momento.

### Planes y precios

Se paga por suscriptores activos, y todas las funciones están en todos los planes.

| Plan | Suscriptores activos | Precio |
|---|---|---|
| Free | hasta 10 | US$ 0 |
| Starter | 11 a 50 | US$ 49/mes |
| Growth | 51 a 100 | US$ 99/mes |
| Scale | 101 a 300 | US$ 199/mes |
| Pro | 301 a 1000 | US$ 349/mes |
| Business | 1001 a 2000 | US$ 499/mes |
| Enterprise | 2001 a 5000 | US$ 749/mes |
| Max | 5001 a 10000 | US$ 999/mes |
| Unlimited | más de 10000 | US$ 1999/mes |

Instalación gratis en todos los planes.

Sin costo de instalación y sin comisión por venta. Las comisiones de Mercado Pago son las de
tu propia cuenta y no las tocamos.

### Cómo integrarla

1. Instalá la app desde la Tienda de aplicaciones.
2. Autorizá el acceso a tu tienda (te lo pide Tiendanube en un paso).
3. Conectá tu Mercado Pago con un clic.
4. Creá tu primer plan sobre un producto y listo: el selector aparece solo en la página de
   ese producto. No hay que tocar el código del tema.

### Soporte

Escribinos a soporte@recurrentesapp.com. Contestamos en días hábiles, de 9 a 18 (hora de
Argentina), en español.

## FAQ

**¿Necesito una cuenta de Mercado Pago?**
Sí, la tuya. La conectás con un clic y la plata de cada cobro entra directo a tu cuenta.

**¿Con qué medios de pago puede pagar mi cliente?**
Tarjeta de crédito, que es lo que Mercado Pago admite para pagos recurrentes autorizados.

**¿Qué pasa si un cobro falla?**
Marcamos la suscripción como "pago rechazado", le avisamos al cliente por mail para que
actualice la tarjeta y reintentamos. Vos lo ves en el panel.

**¿El cliente puede cancelar cuando quiera?**
Sí, desde su portal, sin escribirte. También puede pausar y reactivar.

**¿Las renovaciones generan órdenes en mi tienda?**
Sí. Cada cobro crea una orden paga, con la nota RECURRENTE y la dirección del suscriptor.
Aparecen como pago offline porque el dinero entró por Mercado Pago, no por Tiendanube.

**¿Puedo ofrecer un descuento por suscribirse?**
Sí, lo definís por plan, y también podés dar descuentos por cantidad o armar packs.

**¿Cambia algo en mi checkout?**
No. El selector aparece en la página del producto; el pago recurrente se autoriza en
Mercado Pago. Tu checkout de Tiendanube sigue igual para las compras únicas.

**¿Sirve para servicios o productos digitales?**
Sí. Podés cobrar membresías o entregas digitales; en ese caso no pedimos dirección de envío.

**¿Qué pasa si desinstalo la app?**
Dejamos de crear órdenes. Las suscripciones siguen existiendo en tu Mercado Pago hasta que
las canceles ahí, así que conviene cancelarlas antes si no querés seguir cobrando.

**¿Qué datos de mis clientes usan?**
Nombre, mail, teléfono y dirección de envío, solo para crear la orden y avisarle del cobro.
No los vendemos ni los usamos para otra cosa. Detalle en la política de privacidad.

## Imágenes

| Archivo | Tamaño | Uso |
|---|---|---|
| `icono-600x600.png` | 600×600 | ícono de la app |
| `banner-1-widget.png` | 1600×800 | banner principal |
| `banner-2-como-funciona.png` | 1600×800 | los tres pasos |
| `banner-3-precios.png` | 1600×800 | planes y precios |
