// Límite del plan gratis: qué pasa cuando una tienda pasa los 10 suscriptores
// sin pagar. Fuente ÚNICA compartida por api/* (widget, checkout, panel) y el
// front (barra de aviso, pantalla de bloqueo), así los tres nunca discrepan.
//
// Decisión de Thiago (17-sept-2026), tres estados por SUSCRIPTORES ACTIVOS:
//
//   1–10   ok      → todo normal, sin avisos.
//   11–15  grace   → 5 suscriptores de regalo. Aviso grande y permanente en el
//                    panel, pero NADA se corta: el widget anda, el checkout
//                    toma suscripciones nuevas y los cobros siguen.
//   16+    blocked → se apaga la venta: el widget desaparece de la tienda (queda
//                    como estaba antes) y el checkout no acepta suscripciones
//                    nuevas. El panel queda en solo lectura con la pantalla de pago.
//
// LO QUE NUNCA SE CORTA, en ningún estado: los cobros de las suscripciones que
// YA están activas, las órdenes que se crean con cada cobro, el portal del
// cliente y los webhooks de MP. Si cortáramos eso, el que pierde plata es el
// cliente final del comerciante y el daño no se puede revertir. Bloquear es
// "no entran ventas nuevas", no "dejamos de cobrarle a los que ya pagaron".
import { FREE_SUBSCRIBERS, tierFor } from "./pricing.js";

// Suscriptores de gracia por encima del tramo gratis antes de bloquear.
export const GRACE_SUBSCRIBERS = 5;
// Techo de la gracia: con este número todavía cobra; pasándolo, se bloquea.
export const GRACE_LIMIT = FREE_SUBSCRIBERS + GRACE_SUBSCRIBERS;   // 15

export const ENF_OK = "ok";
export const ENF_GRACE = "grace";
export const ENF_BLOCKED = "blocked";

// Estado de una tienda según sus suscriptores activos y si tiene plan al día.
//
// `paid` = tiene un plan pago vigente (o es beta/interna, que nunca pagan).
// Con `paid` no hay aviso ni bloqueo por cantidad: el cobro del tramo lo maneja
// el ciclo de Stripe (sync-saas-tiers mueve el precio al tramo vigente).
//
// Un plan que quedó en past_due (le rebotó la tarjeta) NO bloquea solo: vuelve
// a la regla por cantidad, así el que tiene 12 suscriptores y le falló el cobro
// cae en gracia y no se queda sin venta de un día para el otro.
export function enforcementFor({ activeSubscribers = 0, paid = false } = {}) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  const tier = tierFor(n);
  const over = Math.max(0, n - FREE_SUBSCRIBERS);           // cuántos pasan el gratis
  const graceLeft = Math.max(0, GRACE_LIMIT - n);           // cuántos más antes del bloqueo

  if (paid || tier.usd === 0) {
    return { state: ENF_OK, subs: n, tier: tier.id, tier_usd: tier.usd, over: 0, grace_left: GRACE_SUBSCRIBERS, grace_limit: GRACE_LIMIT, free: FREE_SUBSCRIBERS, sell: true, panel: "full" };
  }
  if (n > GRACE_LIMIT) {
    return { state: ENF_BLOCKED, subs: n, tier: tier.id, tier_usd: tier.usd, over, grace_left: 0, grace_limit: GRACE_LIMIT, free: FREE_SUBSCRIBERS, sell: false, panel: "readonly" };
  }
  return { state: ENF_GRACE, subs: n, tier: tier.id, tier_usd: tier.usd, over, grace_left: graceLeft, grace_limit: GRACE_LIMIT, free: FREE_SUBSCRIBERS, sell: true, panel: "full" };
}

// ¿Puede entrar una suscripción NUEVA? (widget visible + checkout acepta)
export const canSellSubscriptions = (enf) => !!enf && enf.sell !== false;

// Texto del aviso, en la voz del producto: dice qué pasa y cuánto margen queda.
// Mismo copy en el panel y en el aviso de WhatsApp, así no se contradicen.
export function enforcementCopy(enf) {
  if (!enf || enf.state === ENF_OK) return null;
  const s = (n) => Number(n).toLocaleString("es-AR");
  if (enf.state === ENF_BLOCKED) {
    return {
      title: "Tu widget está apagado",
      body: `Llegaste a ${s(enf.subs)} suscriptores activos y el plan gratis cubre hasta ${s(enf.free)}. Ya no entran suscripciones nuevas: el widget no se muestra en tu tienda y tu página de producto quedó como estaba antes. Activá el plan y vuelve a funcionar al instante.`,
      // Lo que sigue andando, dicho explícito: es la duda que todos tienen.
      keeps: `Tus ${s(enf.subs)} suscriptores siguen cobrándose normal y cada cobro sigue generando su orden. No perdiste ninguno.`,
      cta: "Activar plan",
    };
  }
  const q = enf.grace_left;
  return {
    title: q === 0
      ? "Con un suscriptor más se apaga tu widget"
      : `Te ${q === 1 ? "queda" : "quedan"} ${s(q)} ${q === 1 ? "suscriptor" : "suscriptores"} antes de que se apague tu widget`,
    body: `Tenés ${s(enf.subs)} suscriptores activos y el plan gratis cubre hasta ${s(enf.free)}. Te damos ${s(GRACE_SUBSCRIBERS)} de regalo para que no pares de vender, hasta ${s(enf.grace_limit)}. Si lo pasás sin activar el plan, el widget deja de mostrarse en tu tienda y no entran suscripciones nuevas.`,
    keeps: "Los suscriptores que ya tenés se siguen cobrando igual, pase lo que pase.",
    cta: "Activar plan",
  };
}
