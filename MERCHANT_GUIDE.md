# Cómo conectar tu Mercado Pago a Recurrentes

Esta guía es para los **comerciantes** que usan Recurrentes para gestionar suscripciones de su Shopify.

## Por qué necesitás una app de MP Developers

Para que Recurrentes cobre suscripciones recurrentes en tu nombre, necesitamos un **Access Token** de tu cuenta de Mercado Pago con el producto "Suscripciones" habilitado. Eso solo se obtiene creando una "aplicación" en el panel de developers de MP — pero **es tuya, queda en tu cuenta, nadie más la ve**. Es un paso técnico de 5 minutos.

⚠ **Tu Access Token es SECRETO**. Es como una llave de tu caja registradora — nunca lo compartas en redes, screenshots públicos ni con nadie que no sea Recurrentes.

## Pasos (5 minutos)

### 1. Entrá al panel de developers de MP

Con tu cuenta MP **de comercio** (la que cobra), entrá a:

👉 [https://www.mercadopago.com.ar/developers/panel/app](https://www.mercadopago.com.ar/developers/panel/app)

Si te pide loguearte, hacelo con tu mail+clave de MP (mismas que usás para mercadopago.com.ar).

### 2. Crear aplicación

Click en **"Crear aplicación"** (botón violeta arriba a la derecha).

Completá:

- **Nombre**: `Recurrentes` (o lo que vos quieras — es solo para identificarla en tu panel)
- **¿Qué productos vas a integrar?** marcá:
  - ✅ **Suscripciones (preapproval)** ← esta es la importante
  - ✅ Checkout Pro (opcional)
- **Actividad principal**: el rubro de tu negocio
- **Modelo de integración**: "Plataforma propia" o el que te aplique

Click **Crear**.

### 3. Copiar el Access Token

Te abre el panel de la app. En la sidebar izquierda → click **`Credenciales de prueba`** (modo TEST).

Vas a ver dos campos:
- **Public Key** (`APP_USR-...`) — no la necesitamos
- **Access Token** (`TEST-...`) — **este es el que vas a usar** ← copiá

### 4. Pegar en Recurrentes

Entrá a tu dashboard de Recurrentes → tab **Integraciones** → click **"Pegar Access Token"** → pegás el `TEST-...` → Guardar.

Listo. Recurrentes valida el token contra MP y queda conectado.

### 5. Cuando estés listo para cobrar real (producción)

Cuando termines de testear con MP TEST y quieras procesar pagos reales:

1. Volvé al panel de MP Developers → tu app
2. Click **`Credenciales de producción`**
3. Si te pide completar datos de la cuenta / validar email, hacelo
4. Copiá el Access Token de producción (empieza con `APP_USR-` sin el `TEST-`)
5. En Recurrentes → Integraciones → **Cambiar Access Token** → pegá el nuevo

## Preguntas frecuentes

**¿Recurrentes puede ver mi clave?**  
Sí — el Access Token se guarda encriptado en nuestra base de datos para poder hacer llamadas a MP en tu nombre. **Es como darle la llave del banco al contador**: necesario para que opere, pero la cuidamos al máximo. Si en algún momento querés revocarlo, podés regenerar el token desde MP y dejaríamos de tener acceso.

**¿Si cancelo mi cuenta de Recurrentes, qué pasa con mis suscripciones activas?**  
Las suscripciones siguen funcionando en MP (los cobros recurrentes los procesa MP, no nosotros). Pero ya no se van a generar órdenes en Shopify automáticamente. Te recomendamos pausar las subs antes de irte.

**¿Si MP se cae, qué pasa?**  
Tus datos (suscriptores, planes, historial) viven en Recurrentes, no se pierden. Los cobros recurrentes los reanuda MP automáticamente cuando vuelve — tiene retry automático de 96 horas. Solo se demoraría una eventual creación de nueva sub durante la caída.

**¿Puedo usar la misma app de MP para mi tienda física y Recurrentes?**  
Sí. La app de Developers no interfiere con tu cuenta normal. Tu Access Token sirve para todo lo que tenga habilitado.

**¿Otros usuarios de Recurrentes pueden ver mi Access Token?**  
No. Cada merchant en Recurrentes está aislado en su propio espacio en la base de datos (multi-tenant). Tu token solo lo usamos para procesar tus suscripciones, nunca lo mostramos a otros merchants ni a clientes finales.
