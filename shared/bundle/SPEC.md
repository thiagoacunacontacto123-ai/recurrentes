# Widget de packs (bundle) — especificación compartida

## Modelo de datos

### Plan (`merchants/{mid}/plans/{id}`)
- `pricing_mode`: `"packs"` | `"theme"`. Default: `"packs"` si `packs.length > 0`, si no `"theme"` (compat Lumina: el tema manda base/sub_off/freq_days).
- `packs`: array ordenado (máx 6) de
  `{ qty:int>=1, price_ars:int, compare_at_ars:int|null, label:string, badge:string|null, frequency_days:int|null, sub_price_ars:int|null, default:bool }`
  - `price_ars` = precio del pack en COMPRA ÚNICA.
  - `sub_price_ars` = precio del pack en SUSCRIPCIÓN. Si null → `round(price_ars × (1 − discount_pct/100))`.
  - `compare_at_ars` = precio tachado. Si null → `base_price_ars × qty` (o `price_ars` del pack de qty 1 × qty).
  - `frequency_days` = override. Si null → `frequency_scales_with_qty ? plan.frequency_days × qty : plan.frequency_days`.
- `discount_pct` (ya existe) = % de descuento de suscripción sobre el pack.
- `frequency_scales_with_qty`: bool, default `true`.

### Merchant (`merchants/{mid}`) — configuración visual del widget
- `widget_variant`: `"v01"`..`"v10"` (default `"v01"`).
- `widget_color` (ya existe, #hex acento).
- `widget_texts`: `{ headline, once_label, sub_label, cta_once, cta_sub, savings_label, per_unit_label, freq_prefix, trust_lines: string[] }`
  Defaults: headline "Elegí tu pack", once_label "Compra única", sub_label "Suscripción", cta_once "Agregar al carrito",
  cta_sub "Suscribirme", savings_label "Ahorrás {pct}%", per_unit_label "{price} c/u", freq_prefix "Te llega cada",
  trust_lines ["Cancelás cuando quieras", "Envío a todo el país"].
- `widget_show_compare` (bool, default true), `widget_show_per_unit` (bool, default true), `widget_radius` (int px, default 14),
  `widget_mode_default` (ya existe: "sub"|"once"), `widget_mode_order` (ya existe).

## Contrato del módulo compartido `shared/bundle/`
- `templates.js` exporta:
  - `BUNDLE_VARIANTS = [{ id:"v01", name, description }, ... 10 ]`
  - `renderBundle(vm, state) → { html, css }` — strings puros, sin dependencias, sin JS embebido. `state = { mode:"sub"|"once", selectedIdx:number }`.
    Todo elemento clickeable lleva `data-rc-action="mode" data-rc-value="sub|once"`, `data-rc-action="pack" data-rc-value="<idx>"`, `data-rc-action="cta"`. El CSS va scopeado bajo `.rc-bundle[data-variant="vXX"]`.
- `viewmodel.js` exporta `buildBundleVM({ plan, merchant }) → vm` con:
  `{ variant, accent, radius, texts, showCompare, showPerUnit, modeDefault, modeOrder, packs:[{ idx, qty, label, badge, priceOnce, priceSub, compareAt, savingsPct, perUnitSub, perUnitOnce, freqDays, freqLabel, isDefault }], currency:"ARS" }`
  y helpers `fmtARS(n)`, `freqLabel(days)`.

## Flujo
- Widget (página de producto, `api/widget.js`): si `pricing_mode === "packs"` renderiza el selector con `renderBundle` y maneja estado en el cliente (re-render al click).
  - `once` → `POST /cart/add.js { id: variant_id, quantity: qty }` y abre `/cart`.
  - `sub` → redirige a `${checkoutPagePath}?merchant=&product=&variant=&plan=<planId>&pack=<idx>` (SIN base/sub_off/qty/freq_days).
- Embed checkout: lee `plan` + `pack`; muestra resumen desde el plan (GET public?action=plan devuelve `packs`); POST `/api/checkout/init` con `{ plan_id, pack_index }`.
- Server (`init.js`): si el plan es `packs` → subtotal = `sub_price` del pack; qty = pack.qty; frecuencia = del pack; ignora base/sub_off/frequency_days del body. `recover_path` incluye `plan` y `pack`.
