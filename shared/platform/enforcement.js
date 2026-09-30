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
// 30-sept-2026 (Thiago): **se van los límites automáticos por cantidad**. Las
// cuentas las crea él, así que no hace falta un portero: una tienda puede tener
// mil suscriptores sin que nada se corte solo. Si alguna se atrasa con el plan,
// él le corta la entrada a mano desde el Admin (`sales_paused`), que es lo único
// que ahora deja a `sell` en false. El resto es un aviso, no un bloqueo.
//
// Por qué: el cartel automático aparecía SIEMPRE —él le pasa el link, la tienda
// crece y a los pocos días le saltaba el aviso— y terminaba siendo ruido que
// tapaba el panel de alguien que ya estaba pagando o por pagar.
export function enforcementFor({ activeSubscribers = 0, paid = false, legacyFree = false, pastDueSince = null, salesPaused = false, nowMs = Date.now() } = {}) {
  const n = Math.max(0, Math.floor(Number(activeSubscribers) || 0));
  const base = { subs: n, tier: null, tier_usd: 0, over: 0, grace_left: 0, grace_limit: 0, free: legacyFree ? FREE_SUBSCRIBERS : 0, legacy_free: !!legacyFree };

  // Corte a mano desde el Admin: lo único que apaga la venta.
  if (salesPaused) return { ...base, state: ENF_BLOCKED, sell: false, panel: "full", paused_by_admin: true };

  // Paga (o es beta / interna): nada que avisar.
  if (paid) return { ...base, state: ENF_OK, sell: true, panel: "full", paid: true };

  // Le rebotó la tarjeta: se le avisa, pero sigue vendiendo.
  const fallo = Date.parse(pastDueSince || "");
  if (Number.isFinite(fallo)) {
    const diasRestantes = Math.max(0, Math.ceil((fallo + PAST_DUE_GRACE_DAYS * 86400000 - nowMs) / 86400000));
    return { ...base, state: ENF_GRACE, days_left: diasRestantes, past_due: true, sell: true, panel: "full" };
  }

  // Sin plan todavía. Las tiendas del modelo viejo (Wellfresh) ni se enteran
  // hasta pasar sus 10; al resto se le pide activar, pero sin cortarle nada.
  if (legacyFree && n <= FREE_SUBSCRIBERS) return { ...base, state: ENF_OK, sell: true, panel: "full" };
  return { ...base, state: ENF_GRACE, sell: true, panel: "full" };
}

// ¿Puede entrar una suscripción NUEVA? (widget visible + checkout acepta)
export const canSellSubscriptions = (enf) => !!enf && enf.sell !== false;

// Texto del aviso, en la voz del producto: dice qué pasa y cuánto margen queda.
// Mismo copy en el panel y en el aviso de WhatsApp, así no se contradicen.
export function enforcementCopy(enf) {
  if (!enf || enf.state === ENF_OK) return null;
  const s = (n) => Number(n).toLocaleString("es-AR");

  // Corte a mano: es el único caso en que de verdad no entran ventas nuevas.
  if (enf.state === ENF_BLOCKED) {
    return {
      title: "Pausamos el ingreso de suscriptores nuevos",
      body: "Tu widget no se está mostrando en la tienda y el checkout no acepta suscripciones nuevas. Escribinos y lo destrabamos en el momento.",
      keeps: enf.subs > 0
        ? `Tus ${s(enf.subs)} suscriptores siguen cobrándose normal y cada cobro sigue generando su orden. No perdiste ninguno.`
        : "Nada de lo que configuraste se pierde: planes, widget y flujos quedan como los dejaste.",
      cta: "Escribinos",
    };
  }
  if (enf.past_due) {
    const d = enf.days_left;
    return {
      title: "No pudimos cobrar tu plan",
      body: d > 0
        ? `Lo reintentamos solo estos ${s(d)} día${d === 1 ? "" : "s"}. Nada se corta mientras tanto, pero conviene actualizar la tarjeta para no quedarte sin el soporte y los avisos.`
        : "Lo reintentamos varias veces y no entró. Nada se corta, pero escribinos para arreglarlo.",
      keeps: "Los suscriptores que ya tenés se siguen cobrando igual, pase lo que pase.",
      cta: "Actualizar tarjeta",
    };
  }
  // Todavía no activó el plan: es un recordatorio, no un bloqueo.
  return {
    title: "Empezá tu plan mensual",
    body: `Ya está todo instalado y funcionando. El plan son US$ ${SAAS_BASE_USD} por mes más una comisión de lo que cobrás, y se activa con tarjeta en un minuto.`,
    keeps: "Mientras tanto no se corta nada: seguís vendiendo y cobrando normal.",
    cta: "Activar plan",
  };
}
