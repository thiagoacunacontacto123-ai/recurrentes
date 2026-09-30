// Comisión del SaaS (30-sept-2026, Thiago): US$ 99 por mes + un % de TODO lo
// que se cobró en esos 30 días. El % lo define `commissionPct` según cuántos
// suscriptores activos tiene la tienda (1,8 / 1,5 / 1,3).
//
// Cómo funciona el ciclo:
//   · El comercio paga los primeros US$ 99 cuando le dejamos el widget andando
//     (`plan_activated_at`). Eso es el mes 1 por adelantado.
//   · A los 30 días Stripe le cobra los US$ 99 del mes que empieza, y nosotros
//     le sumamos a esa factura el % del mes que TERMINÓ. La comisión siempre va
//     vencida: no se cobra por plata que todavía no entró.
//
// Qué entra en la base: los cobros `approved` del ciclo, menos los que después
// se devolvieron o terminaron en contracargo (`money_back`). Cobrarle comisión
// por una venta que perdió sería sacarle plata dos veces.
//
// Todo queda en `merchants/{mid}/commissions/{YYYY-MM-DD}` (la fecha de inicio
// del ciclo): importe, cotización usada, fuente y el id del ítem de Stripe. Si
// mañana un comercio discute la factura, se mira ese documento y listo.
//
// Idempotente por ciclo: el documento se crea con `create()`, así dos corridas
// del cron no facturan dos veces. Nunca lanza hacia afuera: el camino del cobro
// de los clientes finales no puede depender de esto.
import { FieldValue } from "firebase-admin/firestore";
import { billFor, commissionPct } from "../../shared/platform/pricing.js";
import { usdRate } from "./usdRate.js";

export const CICLO_DIAS = 30;
const CICLO_MS = CICLO_DIAS * 86400000;
// Stripe no acepta ítems de menos de un centavo, y por debajo de US$ 0,50 no
// vale la pena una línea en la factura: se acumula en el ciclo siguiente.
export const MIN_COMISION_USD = 0.5;

const iso = (ms) => new Date(ms).toISOString();
const dia = (ms) => iso(ms).slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Los ciclos ya CERRADOS desde que la tienda activó el plan hasta hoy.
 * Devuelve `[{ id, from, to }]`, del más viejo al más nuevo. El ciclo en curso
 * no entra: se factura cuando termina.
 */
export function ciclosCerrados(plan_activated_at, nowMs = Date.now()) {
  const inicio = Date.parse(plan_activated_at || "");
  if (!Number.isFinite(inicio)) return [];
  const out = [];
  for (let t = inicio; t + CICLO_MS <= nowMs; t += CICLO_MS) {
    out.push({ id: dia(t), from: iso(t), to: iso(t + CICLO_MS) });
    if (out.length >= 24) break;   // tope de cordura: dos años de atraso
  }
  return out;
}

/**
 * Lo cobrado en un ciclo, en pesos. Suma los `approved` y descuenta lo que
 * después se devolvió. Devuelve también el detalle para poder auditarlo.
 */
export async function gmvDelCiclo(db, merchantId, { from, to }) {
  const col = db().collection("merchants").doc(merchantId).collection("charges");
  const snap = await col.where("created_at", ">=", from).where("created_at", "<", to).get();
  let bruto = 0, cobros = 0;
  const pagos = new Map();
  for (const d of snap.docs) {
    const c = d.data();
    if (c.status !== "approved") continue;
    const monto = Math.round(Number(c.amount_ars) || 0);
    if (!(monto > 0)) continue;
    bruto += monto; cobros++;
    if (c.mp_payment_id) pagos.set(String(c.mp_payment_id), monto);
  }
  // Devoluciones y contracargos de ESOS cobros (el aviso ya los tiene anotados).
  let devuelto = 0;
  if (pagos.size) {
    const mb = db().collection("merchants").doc(merchantId).collection("money_back");
    const ids = [...pagos.keys()];
    for (let i = 0; i < ids.length; i += 30) {
      const docs = await mb.firestore.getAll(...ids.slice(i, i + 30).map(id => mb.doc(id)));
      for (const d of docs) if (d.exists) devuelto += pagos.get(d.id) || 0;
    }
  }
  return { gmv_ars: Math.max(0, bruto - devuelto), bruto_ars: bruto, devuelto_ars: devuelto, cobros };
}

/**
 * Factura los ciclos cerrados de una tienda. `stripeCall` se inyecta para poder
 * probar sin red. Si no hay cotización confiable no factura nada: preferimos no
 * cobrar a cobrar con un número inventado.
 */
export async function billCommissionForMerchant({
  db, merchantId, merchant, stripeCall, countActive, nowMs = Date.now(), arrastre = 0,
} = {}) {
  const customer = merchant?.saas_stripe_customer_id;
  const ciclos = ciclosCerrados(merchant?.plan_activated_at, nowMs);
  if (!ciclos.length) return { billed: 0, total_usd: 0 };

  const ref = db().collection("merchants").doc(merchantId);
  const col = ref.collection("commissions");
  let billed = 0, total = 0, acumulado = Number(merchant?.commission_carry_usd) || arrastre || 0;

  for (const ciclo of ciclos) {
    const cref = col.doc(ciclo.id);
    // Idempotencia: el primero que lo crea es el que lo factura.
    try {
      await cref.create({ ...ciclo, started_at: iso(nowMs) });
    } catch {
      continue;   // ya existe → otro pasó por acá
    }
    try {
      const { gmv_ars, bruto_ars, devuelto_ars, cobros } = await gmvDelCiclo(db, merchantId, ciclo);
      const subs = typeof countActive === "function" ? await countActive(merchantId) : 0;
      const { rate, source, stale } = await usdRate(db, { nowMs });
      if (!rate) {
        // Sin cotización: se borra el reclamo para reintentarlo mañana.
        await cref.delete().catch(() => {});
        console.warn(`[commission] ${merchantId} ${ciclo.id}: sin cotización, se reintenta`);
        continue;
      }
      const f = billFor({ merchant, subs, gmvArs: gmv_ars, usdRate: rate });
      const conArrastre = round2(f.commission_usd + acumulado);
      const base = {
        ...ciclo, gmv_ars, bruto_ars, devuelto_ars, cobros, subs,
        pct: f.pct, usd_rate: rate, usd_source: source, usd_stale: !!stale,
        commission_usd: f.commission_usd, carry_in_usd: round2(acumulado),
      };

      // Menos del mínimo de Stripe: se guarda y viaja al ciclo que viene.
      if (conArrastre < MIN_COMISION_USD || !customer) {
        acumulado = conArrastre;
        await cref.set({ ...base, carried_usd: conArrastre, billed_at: null, skipped: customer ? "below_minimum" : "no_customer" }, { merge: true });
        continue;
      }
      const cents = Math.round(conArrastre * 100);
      const item = await stripeCall("POST", "/v1/invoiceitems", {
        customer, currency: "usd", amount: cents,
        description: `Comisión ${f.pct}% · ${ciclo.id} a ${ciclo.to.slice(0, 10)} · ${cobros} cobro${cobros === 1 ? "" : "s"}`,
        "metadata[merchant_id]": merchantId, "metadata[cycle]": ciclo.id, "metadata[kind]": "saas_commission",
        "metadata[gmv_ars]": String(gmv_ars), "metadata[usd_rate]": String(rate),
      });
      await cref.set({ ...base, billed_usd: conArrastre, billed_at: iso(nowMs), stripe_invoice_item_id: item?.id || null }, { merge: true });
      acumulado = 0; billed++; total += conArrastre;
    } catch (e) {
      // El ciclo queda sin `billed_at`: el cron lo reintenta mañana.
      console.warn(`[commission] ${merchantId} ${ciclo.id}:`, e.message);
      await cref.set({ error: String(e.message).slice(0, 200) }, { merge: true }).catch(() => {});
    }
  }
  await ref.set({
    commission_carry_usd: acumulado > 0 ? round2(acumulado) : FieldValue.delete(),
    ...(billed ? { commission_last_billed_at: iso(nowMs) } : {}),
  }, { merge: true }).catch(() => {});
  return { billed, total_usd: round2(total), carry_usd: round2(acumulado) };
}

/** Lo que va acumulado del ciclo EN CURSO, para mostrárselo en el panel. */
export async function cicloEnCurso(db, merchantId, merchant, { nowMs = Date.now(), subs = 0, rate = 0 } = {}) {
  const inicio = Date.parse(merchant?.plan_activated_at || "");
  if (!Number.isFinite(inicio)) return null;
  const vueltas = Math.floor((nowMs - inicio) / CICLO_MS);
  const from = iso(inicio + vueltas * CICLO_MS), to = iso(inicio + (vueltas + 1) * CICLO_MS);
  const { gmv_ars, cobros } = await gmvDelCiclo(db, merchantId, { from, to });
  const f = billFor({ merchant, subs, gmvArs: gmv_ars, usdRate: rate });
  return { from, to, cobros, ...f, pct: commissionPct(subs) };
}
