# Auditoría Recurrentes — 2026-09-12

Análisis de código (no de datos vivos: la lectura de Firestore prod quedó bloqueada por permisos). 4 frentes: cobros/segundos pagos, widget+órdenes Shopify, carrito abandonado+mails, seguridad+multi-merchant. Objetivo: llevar la app a público.

Estado base: 12 funciones serverless (Pro, cron */2 min OK), sin `maxDuration` en ninguna, sin `CRON_SECRET` en env locales, sin `firestore.indexes.json`, MP por token pegado (no OAuth), Shopify con app por merchant (client id/secret propios).

---

## P0 — FRAUDE / PLATA (arreglar antes de cualquier otra cosa)

1. **El cliente fija el precio.** `api/checkout/init.js:190-196` (`base_price`, `sub_discount` hasta 90%), `:233-239` (`shipping_method.price`), `:178-181` (`frequency_days`). Endpoint público, CORS *. POST con `base_price:100, sub_discount:90, shipping:{price:0}` → plan MP de $10 → orden Shopify PAGA por el producto completo, con recibo y despacho. **Fix:** ignorar esos campos del body; server calcula desde `plan` (packs qty→precio definidos por merchant, tarifas de envío validadas contra Shopify/plan); `frequency_days` solo si el plan lo permite.

2. **Enganchar un pago ajeno = orden gratis.** `api/_lib/sync.js:421-437` `linkPaymentToSubscriber` solo chequea `status==="approved"`, no compara `preapproval_id`/`external_reference`/monto con el sub. Cualquiera con su `portal_token` llama `GET /api/checkout/init?sub=X&token=Y&payment_id=<pago aprobado ajeno del merchant>` → sub active + orden a su dirección. Además si Shopify falla igual marca `active`+`last_charge_at` (`:492-499`) → el pago real después no manda activación ni CAPI. **Fix:** exigir `payment.preapproval_id` ∈ preapprovals del `mp_preapproval_plan_id` del sub y `transaction_amount === plan_snapshot.total_per_charge_ars`; no marcar active si `shopifyError`.

3. **Phishing con la marca del merchant vía captura de leads.** `init.js:104,121` guarda `fb.event_source_url` del body; `abandoned.js:107-111` lo usa como CTA del mail. POST `{capture:true, merchant_id, plan_id:"x", customer:{email:víctima}, fb:{event_source_url:"https://evil"}}` → 3 mails desde `luminalabs-arg.com` con botón a evil. Sin rate limit, sin captcha, `plan_id` no validado (cae a `{}`). Hoy dormido por el kill switch, pero explota al prenderlo. **Fix:** reconstruir recover_url server-side (o validar host == `shopify_shop`), exigir plan existente y activo, rate limit IP+merchant, honeypot/Turnstile.

4. **Cupón forjable y perpetuo.** `?code=ULTIMACHANCE15` en la URL aplica 15% sin pasar por el flujo y va al `transaction_amount` del preapproval → descuento de por vida en cada renovación (`init.js:204-226`, `widget.js:1167-1172`). **Fix:** token firmado ligado al lead (no código en claro), flag `first_charge_only`.

---

## P1 — COBROS QUE SE PIERDEN O SE DUPLICAN

5. **Webhook de preapproval no resuelve subs del flujo de plan.** `webhook.js:396-429` busca por `mp_preapproval_id` o `external_reference` (que MP NO propaga; init.js:407 lo admite). Falta el fallback por `preapproval_plan_id` que sí existe en `processPaymentForMerchant:161-167`. Consecuencias: (a) el forzado del primer cobro por webhook NO corre en el primer evento → depende del polling de CheckoutSuccess o del cron; (b) cancelaciones/pausas desde la app de MP no llegan → sub sigue `active`, MRR inflado. `hintMid` se ignora y se iteran todos los merchants. **Fix:** agregar `where("mp_preapproval_plan_id","==",pre.preapproval_plan_id)` y usar `hintMid`.

6. **Forzado de start_date puede cobrar doble.** `sync.js:173` fuerza si `approvedPayments.length===0` sin mirar `in_process`/`pending` ni `last_charge_at`/órdenes; `webhook.js:465` no setea `sync_force_attempted` cuando el PUT falla. Escenarios: pago en revisión antifraude → segundo cobro; sub activa vieja + search de MP que falla → cobro anticipado. **Fix:** forzar solo si `allPayments.length===0 && !last_charge_at && shopify_orders.length===0`; marcar intento aunque falle.

7. **`mpFetch` ignora HTTP status → 429/401 se ven como "0 pagos" y degradan active→pending.** `sync.js:26-31, 312-323`. Sub activa desaparece del MRR, entra al loop de pendings y al flujo de abandono (ver 12). Token MP revocado = cron reporta 0 errores y nada se activa. **Fix:** lanzar en `!r.ok`; nunca bajar active→pending si hay órdenes o `last_charge_at`; marcar `merchant.mp_token_invalid_at` en 401.

8. **Rechazos de renovación invisibles.** `webhook.js:42-53` deriva pagos con hint `mid/sid` a `syncSubscriber`, que solo mira `approved` y nunca llama `markPaymentFailed`/mail. TODOS los subs del flujo de plan llevan hint → ningún `payment_failed` se marca ni se avisa. Y si se marca por el camino sin hint, el próximo sync lo devuelve a `active` (`sync.js:318`). El cron nunca sincroniza `payment_failed`/`paused`. **Fix:** en sync mirar el último pago por fecha; rejected posterior a `last_charge_at` → `payment_failed` + mail; agregar al cron con backoff.

9. **Orden duplicada si la función muere entre crear orden y grabar charge.** Sin `maxDuration` (10-15s), Shopify puede tardar 4-5 llamadas; claim TTL 120s → otro proceso reclama y crea 2da orden. `note_attributes.mp_payment_id` nunca se consulta antes de crear. También `shopify_orders:[...sub.shopify_orders,id]` con snapshot viejo pisa IDs (usar `arrayUnion`). Dedup cross-key (`charges/{pre.id}-N` legacy) existe en sync pero no en webhook (`:159`). **Fix:** `maxDuration:300` en webhook/cron, `AbortSignal.timeout` en fetches, buscar orden por `note_attributes` antes de crear, `arrayUnion`, mover dedup cross-key a `chargeclaim.js`.

10. **Dos preapprovals autorizados sobre el mismo plan ad-hoc.** `sync.js:62-76` toma solo el más reciente. Cliente confirma dos veces (o abre el link de recupero que reusa `mp_init_point`) → el otro cobra todos los meses sin orden ni aviso. **Fix:** si hay >1 authorized, cancelar extras en MP y alertar.

11. **Cron: pendings sin límite ni edad, activas al final.** `cron.js:50-63` sincroniza TODOS los pending (incluye leads capture) cada 2 min, luego cancelados 90d, y recién al final activas vencidas → con volumen, las activas y los merchants N+1 nunca se procesan (starvation determinística). `catch` global usa variables declaradas dentro del `try` → ReferenceError → 500 (`cron.js:39-40,151`). `CRON_SECRET` ausente = endpoint público. Lecturas: trae colecciones completas y filtra en memoria (5.000 subs × 720 corridas = 3,6M lecturas/día). **Fix:** activas primero, pendings `!capture && <72h` con límite, `let` fuera del try, secreto obligatorio en prod, queries con rango + `firestore.indexes.json`, fan-out por merchant.

12. **Sub sin `mp_preapproval_id` no se puede cancelar.** `linkPaymentToSubscriber` activa sin guardar `mp_preapproval_id` ni `next_charge_at`; dashboard `subscribers.js:298-322` saltea MP en silencio y marca cancelled solo local → MP sigue cobrando; Portal da "Faltan credenciales". **Fix:** resolver preapproval por plan_id al linkear; en PATCH devolver 409 si no se puede tocar MP.

13. **Cambio de precio del plan no llega a subs vivas.** `plans.js:118-154` no toca MP ni `plan_snapshot`. Con inflación es pérdida silenciosa. **Fix:** acción "repreciar" (`PUT /preapproval/{id}` con nuevo `transaction_amount`) + aviso.

14. Subtotal ≤ 0 o ≤ envío (cupón fijo) → MP cobra, orden imposible para siempre (`init.js:222`, `shopify.js:229-231`). `last_charge_at` se pisa en cada sync sin cobro nuevo (`sync.js:325`). `shopifyAddress` explota si `shipping_address` undefined (`webhook.js:342`, `sync.js:650`).

---

## P1 — ÓRDENES SHOPIFY / COMPRADOR

15. **Envíos hardcodeados de Lumina para TODOS.** `widget.js:880-882` Andreani/Flex $0 + prioritario $5.900; `fetchRates` muerto (`:948-989`). Otro merchant ofrece envíos que no existen y así quedan en cada orden recurrente. **Fix:** `merchant.checkout_shipping_rates` editable o reactivar `fetchRates`.
16. **Widget fuerza mensual.** `widget.js:769` manda `freq_value=1&freq_type=months` fijo → plan de 60 días cobra cada 30. **Fix:** no mandar `freq_*`.
17. **Órdenes no descuentan stock.** `shopify.js:269-321` sin `inventory_behaviour` → sobreventa. **Fix:** `decrement_ignoring_policy`.
18. **"phone has already been taken" pierde la orden.** `shopify.js:172-184` reintenta solo normalizando. **Fix:** 3er intento sin `phone` en customer.
19. **"Simular próximo cobro" crea orden REAL paga con mail al cliente** (`sync.js:547-648`, `send_receipt:true`, botón en Dashboard.jsx:1336). **Fix:** flag dev, `send_receipt:false`, tag SIMULADA.
20. **CheckoutSuccess miente "pago confirmado"** al instante y a los 3 min no dice nada; sin botón volver a la tienda (`CheckoutSuccess.jsx:96-97, 188`). **Fix:** estados Confirmando/Listo/Te avisamos por mail + link tienda/portal.
21. Doble sub/plan al volver de MP y retocar Pagar (`init.js:254-261` solo reusa leads capture). `action=plan` ignora variante (`public.js:96-100`). Error crudo de MP al comprador (`init.js:398`, `widget.js:1117`). Centavos: `toFixed(2)`×qty ≠ total; descuento no viaja como `discount_codes` (`shopify.js:220-237`). `c.error` invisible en dashboard, sin "Reintentar orden"/CSV/reembolso (`Dashboard.jsx:1362`). Portal sin cambiar dirección/fecha; `next_charge_at` obsoleto tras pausar (`public.js:181-193`). Textos contradictorios débito/saldo (`widget.js:254` vs `Checkout.jsx:235`). Inputs <16px fuera del embed (`widget.js:431`, `Checkout.jsx:155`). Customer search puede matchear parcial (`shopify.js:130`).

---

## P1 — CARRITO ABANDONADO Y MAILS

22. **Kill switch OFF sin forma de prenderlo.** `abandoned.js:36` exige `abandoned_enabled===true`; nadie lo escribe (ni endpoint ni UI). Hoy NO sale ningún mail de abandono salvo Firestore a mano. Solo `test-email` (`merchant.js:209-239`) manda, sin gate ni log ni tope.
23. **Causa probable del "suscriptores reales trabados":** authorized→pending (ver 7) + `abandoned.js:93` ignora `mp_preapproval_status` → cliente que autorizó tarjeta recibe "abandonaste" + cupón. **Fix:** cortar si `mp_preapproval_status==="authorized"` o `payments_found>0` (incl. `in_process`).
24. **Retry de Pagar rompe la secuencia.** `init.js:254-325` `set()` pisa `abandoned_step`/`created_at` → P1 otra vez; segundo doc bloqueado por cooldown → nunca P2/P3. **Fix:** `update()` preservando, heredar paso por email.
25. **Mail de activación no sale por `linkPaymentToSubscriber`** (camino más común: vuelve de MP con `collection_id`) → nunca recibe link al portal (`sync.js:405-530`). **Fix:** replicar bloque `sync.js:363-383`.
26. **Mail de cancelación es código muerto** (`email.js:100-111`, sin llamadas). **payment_failed nunca se dispara** (ver 8).
27. **Sin baja/List-Unsubscribe/reply-to/texto plano** (`email.js:8-39,154`). P2/P3 son marketing con cupón: Gmail/Yahoo + Ley 25.326 exigen baja. **Fix:** headers `List-Unsubscribe` one-click, link footer, `unsubscribed_at`.
28. **Error de Resend avanza el paso igual** (`abandoned.js:128-129`), `catch(_){}`, Actividad excluye errores (`stats.js:171`). **Fix:** no avanzar si error, contador de reintentos, mostrar.
29. Suscriptor activo recibe cupón (no se consulta subs active por email; Shopify ventana 14d). Compró con otro mail → lead recibe los 3. Race cron vs webhook (sin claim) → doble envío. `?code=` duplicado (P3 aplica VUELVO5). Cooldown se pierde si el doc deja de ser pending. Link de recupero → 404 de MP si falta `fb_data` (`abandoned.js:107` + `init.js:405`). Cupones hardcodeados VUELVO5/ULTIMACHANCE15 sin verificar que existan en `discount_codes`. Email sin trim/lowercase en Pagar (`init.js:271`). `shHasRecentPaidOrder` usa `?email=` no documentado (sospecha).
30. **Todo sale como Lumina:** `EMAIL_FROM` global, transaccionales sin `from/brand` (`email.js:22,80-98,159-176`), `merchant.email_from/email_brand` se leen pero no hay setter, `merchant.js:219,226` URL y producto de Lumina en test-email.

---

## P2 — SEGURIDAD / MULTI-TENANT (bloqueadores para público)

Bien: todos los endpoints de merchant usan `verifyIdToken` y scopean por uid del token; no hay IDOR entre merchants; Dashboard no escribe Firestore desde el cliente; `claimCharge` correcto.

31. **MP: no existe OAuth.** `api/mp/` solo webhook. Token pegado a mano (`merchant.js:263-286`); `MP_APP_ID/SECRET/REDIRECT_URI` en env sin usar. Sin refresh. **Fix:** `mp?action=oauth-start|callback`, guardar refresh_token+expires_at+user_id, cron de refresh.
32. **Webhook MP sin firma `x-signature`** (`webhook.js:19-36`) y resuelve merchant iterando TODOS con un GET a MP cada uno (`:112,404,516`). 50 merchants = 50 llamadas por evento dentro de 10-15s. **Fix:** validar HMAC, mapa `mp_user_id→uid`, resolver por `body.user_id`.
33. **Shopify: app por merchant, sin webhooks GDPR ni app/uninstalled, REST 2024-10 (fuera de soporte).** `oauth-start` sin auth acepta `?uid=` público (`shopify.js:56-83`); callback no valida `shop` contra `*.myshopify.com` ni contra `merchant.shopify_shop`, HMAC no timing-safe (`oauth-callback.js:13-25,54,73-79`) → posible hijack de integración. **Fix:** una app Recurrentes con OAuth propio (state firmado), regex shop, igualdad con merchant, `timingSafeEqual`, 4 webhooks, GraphQL versión vigente.
34. **Secretos en claro en Firestore** (`mp_access_token`, `shopify_token`, `shopify_client_secret`, `meta_capi_token`) y `MERCHANT_GUIDE.md:63` promete "encriptado". **Fix:** AES-256-GCM envelope, corregir guía, botón desconectar.
35. **Rules permiten write al dueño** (`firestore.rules:21-27`) → merchant setea `plan:"pro"`, `abandoned_enabled`, `email_from`, inventa charges. **Fix:** `allow write: if false`.
36. **Portal token:** fallback secret hardcodeado (`public.js:24`), compare no timing-safe (`:38`), TTL 365d, viaja por query. **Fix:** fallar sin `PORTAL_SECRET`, `timingSafeEqual`, TTL 30-90d, versionado.
37. **Sin rate limit en públicos:** `public?action=discount` (fuerza bruta de códigos), `shopify?action=shipping-rates` (quema bucket Shopify del merchant), `checkout/init` (crea planes MP ilimitados).
38. **Onboarding inexistente:** signup sin verificación de email, sin App Check, sin ToS/privacidad, `plan:"free"` no se usa, sin billing del SaaS, sin borrado de cuenta.
39. Menores: PII completa en logs (`webhook.js:28-34,215`); XSS self en widget por `innerHTML` sin escape (`widget.js:220-302`); CORS * en endpoints auth; URLs hardcodeadas (`recurrentess.vercel.app`, `recurrentes.app`, `localhost:3000`); `stats` lee todo por request; público y privado mezclados en la misma función.

---

## ORDEN SUGERIDO

**Semana 1 (plata + seguridad de hoy, sin tocar UX):** #1 #2 #4 · #5 #6 #7 #8 · #9 (maxDuration + arrayUnion + timeout) · #11 (let, secreto, orden del cron) · #12.
**Semana 2 (operación Lumina sana):** #17 #18 #19 #20 · #23 #24 #25 #26 #28 · toggle `abandoned_enabled` + settings de mail en UI · #13 repreciar.
**Semana 3-4 (abrir a público):** #31 #32 #33 #34 #35 #36 #37 #38 · #15 #16 #30 desacoplar Lumina · #27 baja legal · índices + queries con rango.

Pendiente de verificar con datos vivos (no pude leer Firestore prod): cuántas subs active sin orden, cuántos leads pending acumulados, si `abandoned_enabled` está en true para Lumina, si hay charges approved sin orden o con error, cuántas subs tienen ≥2 órdenes (2do cobro real funcionando).
