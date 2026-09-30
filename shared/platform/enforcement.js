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
import { FREE_SUBSCRIBERS, tierFor, hasLegacyFreeTier, SAAS_BASE_USD } from "./pricing.js";

// Suscriptores de gracia por encima del tramo gratis antes de bloquear.
export const GRACE_SUBSCRIBERS = 5;
// Techo de la gracia: con este número todavía cobra; pasándolo, se bloquea.
export const GRACE_LIMIT = FREE_SUBSCRIBERS + GRACE_SUBSCRIBERS;   // 15

// Días que sigue vendiendo una tienda a la que le rebotó la tarjeta. Un rechazo
// del banco no puede dejar a nadie sin vender de un día para el otro: Stripe
// reintenta solo durante la semana y recién ahí se corta (30-sept-2026).
export const PAST_DUE_GRACE_DAYS = 7;

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
export function enforcementFor({ activeSubscribers = 0, paid = false, legacyFree = false, pastDueSince = null, nowMs = Date.now() } = {}) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  const tier = tierFor(n);
  const base = { subs: n, tier: tier.id, tier_usd: tier.usd, free: legacyFree ? FREE_SUBSCRIBERS : 0, grace_limit: legacyFree ? GRACE_LIMIT : 0, legacy_free: !!legacyFree };

  // Paga (o es beta / interna): nada que avisar.
  if (paid) return { ...base, state: ENF_OK, over: 0, grace_left: legacyFree ? GRACE_SUBSCRIBERS : 0, sell: true, panel: "full", paid: true };

  // Le rebotó la tarjeta hace poco: sigue vendiendo mientras Stripe reintenta.
  const fallo = Date.parse(pastDueSince || "");
  if (Number.isFinite(fallo)) {
    const diasRestantes = Math.max(0, Math.ceil((fallo + PAST_DUE_GRACE_DAYS * 86400000 - nowMs) / 86400000));
    if (diasRestantes > 0) {
      return { ...base, state: ENF_GRACE, over: 0, grace_left: 0, days_left: diasRestantes, past_due: true, sell: true, panel: "full" };
    }
  }

  // ── Tiendas del modelo viejo (`legacy_free_tier`) ─────────────────────────
  // Wellfresh y las que venían con el plan gratis: se les respeta hasta 10 y al
  // llegar a 11 entran al modelo nuevo (30-sept-2026, Thiago).
  if (legacyFree) {
    const over = Math.max(0, n - FREE_SUBSCRIBERS);
    if (n <= FREE_SUBSCRIBERS) return { ...base, state: ENF_OK, over: 0, grace_left: GRACE_SUBSCRIBERS, sell: true, panel: "full" };
    if (n > GRACE_LIMIT) return { ...base, state: ENF_BLOCKED, over, grace_left: 0, sell: false, panel: "readonly" };
    return { ...base, state: ENF_GRACE, over, grace_left: Math.max(0, GRACE_LIMIT - n), sell: true, panel: "full" };
  }

  // ── Modelo nuevo: no hay plan gratis ──────────────────────────────────────
  // Sin plan activo no entran suscripciones nuevas. Las que ya están se siguen
  // cobrando igual: bloquear es "no entran ventas", nunca "dejamos de cobrar".
  return { ...base, state: ENF_BLOCKED, over: n, grace_left: 0, sell: false, panel: "readonly" };
}

// ¿Puede entrar una suscripción NUEVA? (widget visible + checkout acepta)
export const canSellSubscriptions = (enf) => !!enf && enf.sell !== false;

// Texto del aviso, en la voz del producto: dice qué pasa y cuánto margen queda.
// Mismo copy en el panel y en el aviso de WhatsApp, así no se contradicen.
export function enforcementCopy(enf) {
  if (!enf || enf.state === ENF_OK) return null;
  const s = (n) => Number(n).toLocaleString("es-AR");

  // Modelo nuevo (sin plan gratis): el widget se enciende cuando activa el plan.
  if (enf.state === ENF_BLOCKED && !enf.legacy_free) {
    return {
      title: "Activá tu plan para empezar a vender",
      body: `El plan son US$ ${SAAS_BASE_USD} por mes más una comisión de lo que cobrás, y se activa al instante. Hasta que lo actives, el widget no se muestra en tu tienda y tu página de producto queda como estaba.`,
      keeps: enf.subs > 0
        ? `Tus ${s(enf.subs)} suscriptores siguen cobrándose normal y cada cobro sigue generando su orden. No perdiste ninguno.`
        : "Nada de lo que ya configuraste se pierde: planes, widget y flujos quedan como los dejaste.",
      cta: "Activar plan",
    };
  }
  if (enf.state === ENF_BLOCKED) {
    return {
      title: "Tu widget está apagado",
      body: `Llegaste a ${s(enf.subs)} suscriptores activos y tu plan cubre hasta ${s(enf.free)}. Ya no entran suscripciones nuevas: el widget no se muestra en tu tienda y tu página de producto quedó como estaba antes. Activá el plan y vuelve a funcionar al instante.`,
      keeps: `Tus ${s(enf.subs)} suscriptores siguen cobrándose normal y cada cobro sigue generando su orden. No perdiste ninguno.`,
      cta: "Activar plan",
    };
  }
  if (enf.past_due) {
    const d = enf.days_left;
    return {
      title: d === 1 ? "Te queda 1 día para actualizar tu tarjeta" : `Te quedan ${s(d)} días para actualizar tu tarjeta`,
      body: "No pudimos cobrar tu plan. Lo reintentamos solo estos días; si no entra, el widget deja de mostrarse en tu tienda y no entran suscripciones nuevas.",
      keeps: "Los suscriptores que ya tenés se siguen cobrando igual, pase lo que pase.",
      cta: "Actualizar tarjeta",
    };
  }
  const q = enf.grace_left;
  return {
    title: q === 0
      ? "Con un suscriptor más se apaga tu widget"
      : `Te ${q === 1 ? "queda" : "quedan"} ${s(q)} ${q === 1 ? "suscriptor" : "suscriptores"} antes de que se apague tu widget`,
    body: `Tenés ${s(enf.subs)} suscriptores activos y tu plan cubre hasta ${s(enf.free)}. Al llegar a ${s(enf.free + 1)} empezás con el sistema nuevo: US$ ${SAAS_BASE_USD} por mes más una comisión de lo que cobrás. Te damos ${s(GRACE_SUBSCRIBERS)} de margen, hasta ${s(enf.grace_limit)}, para que no pares de vender.`,
    keeps: "Los suscriptores que ya tenés se siguen cobrando igual, pase lo que pase.",
    cta: "Activar plan",
  };
}
