# Recurrentes

App de gestión de suscripciones para tiendas Shopify con cobro recurrente en Mercado Pago.

## Qué hace

1. El **comerciante** se loguea en Recurrentes, conecta su Shopify (OAuth) y su Mercado Pago (Access Token).
2. Elige uno de sus productos Shopify y crea un **plan de suscripción** (frecuencia, descuento, unidades por envío).
3. Recurrentes le da un **script JS** que pega en su theme Shopify.
4. En la página del producto aparece un toggle **⚪ Compra única / 🔘 Suscripción**.
   - **Compra única** → flujo normal de "Agregar al carrito".
   - **Suscripción** → botón cambia a "Suscribirme" → redirige al checkout de MP (preapproval).
5. Cuando MP confirma el pago, Recurrentes recibe webhook y **crea una orden paga en Shopify** con los datos del bundle.
6. En cada cobro recurrente posterior, **se genera una nueva orden Shopify automáticamente**.

## Stack

- **Frontend**: React + Vite (SPA en `/dist`)
- **Backend**: Vercel serverless functions en `/api/*`
- **Auth + DB**: Firebase (Firestore + Auth)
- **Pagos**: Mercado Pago Subscriptions (Preapproval API)
- **Tiendas**: Shopify Admin API (OAuth + REST)

## Estructura

```
/
├── api/                    Vercel serverless functions
│   ├── _lib/               helpers compartidos (firebase, mp, shopify)
│   ├── shopify/            OAuth + sync productos
│   ├── mp/                 OAuth + webhook + preapproval
│   ├── plans.js            CRUD planes de suscripción
│   ├── checkout/           checkout init para clientes finales
│   ├── subscribers.js      gestión de subs activos
│   └── widget.js           sirve el JS del widget storefront
├── src/                    React admin app
│   ├── App.jsx
│   ├── pages/              landing, signup, dashboard, plans, subscribers
│   ├── lib/                firebase client, api wrapper
│   └── main.jsx
├── public/
│   └── widget/             assets del widget storefront
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── README.md
```

## Setup local

1. `npm install`
2. Copiar `.env.example` a `.env.local` y completar credenciales (ver guía abajo)
3. `npm run dev` — admin en http://localhost:5173

## Credenciales necesarias (orden de configuración)

### 1) Firebase (5 min)
- Crear proyecto en console.firebase.google.com
- Habilitar Authentication (Email/Password)
- Habilitar Firestore (modo producción)
- En Project Settings → Service accounts → Generate new private key (JSON) → pegar en `FIREBASE_*`
- En Project Settings → General → SDK setup → pegar config web en `VITE_FIREBASE_*`

### 2) Mercado Pago (5-10 min)
- Crear app en developers.mercadopago.com.ar → Tus integraciones → Crear aplicación
- Productos: "Pagos online" + "Suscripciones"
- Pegar credenciales TEST en `.env.local`
- Para LIVE, repetir con credenciales de producción una vez aprobada

### 3) Shopify (10 min, solo cuando empecemos OAuth flow)
- Partners account en partners.shopify.com
- Crear Public App
- Scopes: `read_products, write_orders, read_customers`
- Pegar API Key + Secret en `.env.local`

## Deploy

- Repo en GitHub → conectar a Vercel
- En Vercel → Settings → Environment Variables → pegar todas las del `.env.example`
- Push a `main` → autodeploy

## Flujo end-to-end

```
Merchant signup → Connect Shopify → Connect MP → Create plan
                                                       │
                                                       ▼
                                            Get widget snippet
                                                       │
                                                       ▼
Customer visits product → Widget loads → Toggles "Suscripción"
                                                       │
                                                       ▼
Click "Suscribirme" → POST /api/checkout/init → MP preapproval link
                                                       │
                                                       ▼
                                            Customer pays in MP
                                                       │
                                                       ▼
              MP webhook → /api/mp/webhook → Create Shopify order
                                                       │
                                                       ▼
                                  Subscriber listed in admin dashboard
                                                       │
                                                       ▼ (cada N días)
                MP cobra → webhook → nueva orden Shopify automática
```
