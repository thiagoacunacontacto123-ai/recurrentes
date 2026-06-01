# Checklist de producción — Recurrentes

Lo que tenés que hacer mañana **en orden** para dejar todo andando y pushear a GitHub.

---

## 1. Verificar el último deploy (5 min)

Asegurarte que el último deploy incluye el sync-pending (la última feature del 31/may noche).

```bash
cd ~/Downloads/recurrentes
npx vercel deploy --prod
```

Esperá `✓ Production: https://recurrentess-xxxxx.vercel.app` + `Ready in Xs`. Si falla, mandame el log.

---

## 2. Limpiar datos de prueba (2 min)

Si todavía hay subs de prueba dando vueltas:

```bash
node scripts/cleanup-subs.mjs
```

Y aparte, **cancelar las subs en MP** entrando a https://www.mercadopago.com.ar/subscriptions

---

## 3. Configurar webhook a nivel cuenta MP (CRÍTICO — 5 min)

Esto hace que MP avise INSTANTÁNEAMENTE de cada cobro futuro, sin que dependas del polling del dashboard.

1. Andá a https://www.mercadopago.com.ar/developers/panel/notifications/webhooks
2. Click **"Configurar notificaciones"** (o editar si ya hay algo)
3. URL del webhook: `https://recurrentess.vercel.app/api/mp/webhook`
4. Eventos a marcar:
   - ✅ Pagos (`payment`)
   - ✅ Planes de suscripción (`subscription_preapproval`)
   - ✅ Suscripciones (`subscription_authorized_payment`)
5. Guardar
6. (Opcional) Hacer click en "Probar" — debería responder 200

Sin esto, las suscripciones se procesan solo cuando el cliente toca "Volver al sitio del vendedor" o vos abrís Dashboard → Suscriptores.

---

## 4. Test final end-to-end (10 min)

Verificar que TODO el flow funciona antes del push:

1. **Modo incógnito** + tu producto Shopify
2. Tocar "Suscribirme" con datos reales + tarjeta **de otra persona** (no la tuya — MP bloquea autocompra)
3. Pagar
4. Tocar "Volver al sitio del vendedor" en MP
5. Verificar:
   - ✅ Te redirige a la **Thank You page de Shopify** (`https://inditropic-arg.com/.../orders/...`)
   - ✅ En **Shopify Admin → Pedidos** aparece la orden con tag **RECURRENTE**, dirección + items + estado Pagado
   - ✅ En **Recurrentes → Dashboard → Suscriptores** aparece como **🟢 Activa**
   - ✅ En **Recurrentes → Dashboard → Cobros** aparece el charge con monto + status `approved`
6. **Cancelar la sub** desde Dashboard → Suscriptores → modal del sub → ✕ Cancelar (para no seguir cobrando)
7. Verificar en MP que la sub quedó cancelada

---

## 5. Crear repo en GitHub + push (5 min)

```bash
cd ~/Downloads/recurrentes

# Inicializar git (si no está)
git init -b main
git add .
git status   # ⚠️ confirmar que .env.local NO está en la lista
git commit -m "feat: Recurrentes MVP — Shopify subscriptions con MP recurrente

- React + Vite + Vercel serverless + Firebase Admin/Auth + Firestore
- Multi-tenant: cada merchant conecta su Shopify + MP
- Dashboard 5 tabs: Inicio / Integraciones / Planes / Suscriptores / Cobros
- Customer Portal público con JWT firmado HMAC
- Widget JS embebible para storefront Shopify (toggle Sub/Única + qty)
- Checkout vía preapproval_plan ad-hoc (estilo GreenDog) — filtra débito + saldo
- Sync manual con MP via _lib/sync.js (no depende de webhook MP)
- Envío configurable con threshold gratis + tiers de descuento por qty
- Orden Shopify con tag RECURRENTE + shipping_lines custom"

# Después en github.com → New repository → recurrentes → no agregar README
git remote add origin https://github.com/TU_USER/recurrentes.git
git push -u origin main
```

Una vez pusheado, podés conectarlo a Vercel para auto-deploys en cada push: Vercel → Settings → Git → Connected Git Repository.

---

## 6. Onboarding del SIGUIENTE merchant (no urgente — F2)

Por ahora para sumar otro comerciante el flow es manual:

1. El merchant crea cuenta en `recurrentess.vercel.app` con Firebase Auth
2. Va a Integraciones → completa Shopify Client ID + Secret + Shop + tu Access Token MP
3. Crea plan en Planes
4. Pega snippet en su theme Shopify
5. Listo

Para F2 podés sumar:
- Setup wizard guiado paso-a-paso post-signup
- Onboarding email
- Billing del SaaS (cobrar a los merchants por usar Recurrentes — Stripe Subscriptions o MP)
- Cron de sync automático cada 5-10 min (sin requerir abrir dashboard ni configurar webhook MP)

---

## Issues conocidos (no bloquean producción)

1. **MP no redirige automático** post-pago — el cliente queda en "¡Listo!" con botón "Volver al sitio del vendedor".
   - **Workaround**: si toca el botón, sync funciona. Si NO toca, el sync se dispara cuando vos abrís Dashboard → Suscriptores.
   - **Fix definitivo F2**: webhook MP nivel cuenta (paso 3 acá arriba).

2. **MP muestra "Dinero en cuenta" como fallback opcional** en el checkout review aunque filtremos crédito.
   - **Fix definitivo F2**: pasar a checkout transparente con MP SDK JS para tokenizar tarjeta en nuestro sitio.

3. **Plan Hobby Vercel = 12 funciones serverless máximo**. Estamos al límite. Si necesitamos más endpoints, hay que:
   - Consolidar (juntar endpoints con `?action=`), o
   - Pasar a Vercel Pro ($20/mes).

---

## Soporte

Si algo falla, el flow de diagnóstico es:

1. **Logs Vercel**: https://vercel.com/thiago24/recurrentess/logs — ahí ves qué pasa en cada endpoint
2. **Logs Firestore**: Firebase Console → Firestore → ver collection `merchants/<uid>/subscribers` para ver estado real
3. **Logs MP**: mercadopago.com.ar → Actividad — ver si MP cobró o no
4. **Botón "⟳ Sincronizar con MP"** en el modal del subscriber pending — fuerza re-procesamiento manual

---

## Comandos rápidos

```bash
# Deploy a producción
npx vercel deploy --prod

# Dev local (después de tener todas las env vars)
set -a && source .env.local && set +a && npx vercel dev

# Limpiar subs de prueba en Firestore
node scripts/cleanup-subs.mjs

# Subir env vars a Vercel desde .env.local
bash subir-vars.sh
```
