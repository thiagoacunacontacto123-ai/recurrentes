// Cambiar el pedido de una suscripción de pack (9-oct-2026, pedido de G4U: "que el
// cliente saque un pan y se le cobre lo que corresponde, o agregue y se le cobre").
//
// El cliente elige desde el portal qué productos del plan lleva y cuántos (mínimo 1).
// El precio es Σ(lista × cantidad) con el descuento del plan, como en "Armá tu pack"
// (los precios fijos del pack no aplican a los mixtos); el envío y los extras del
// checkout quedan como estaban. Después:
//   1. PUT /preapproval { auto_recurring.transaction_amount } en Mercado Pago: aplica
//      al PRÓXIMO cobro (la doc oficial: "Modificar monto").
//   2. sub.pack_items nuevos → sync.js manda un renglón por producto a la orden y
//      shopify.js reparte el cobro en proporción al precio de lista. Nada más cambia.
//   3. Queda el rastro en sub.pack_changes[] (quién, cuándo, de qué a qué).
// Si MP no acepta el monto, no se toca nada local: mejor el pack viejo con el
// cobro viejo que un pack nuevo cobrado mal.
//
// Pisa la regla del 25-sept ("nada de modificar el pack después de suscribirse",
// era por Wellfresh): G4U lo pide y Thiago lo aprobó el 9-oct.
import { FieldValue } from "firebase-admin/firestore";
import { mixCatalog, resolveMixSelection, mixTitle } from "./packs.js";
import { mpUpdatePreapproval, mpReason } from "./mp.js";

export const MAX_PACK_UNITS = 50;
export const MAX_PACK_CHANGES_KEPT = 30;

const r0 = (n) => Math.round(Number(n) || 0);

// Lo que el portal necesita para pintar "Tu pedido": catálogo del plan, lo que lleva
// hoy, descuento y las partes fijas del total. `null` si la sub no es de pack mixto.
export function packEditState(sub, plan, { allowed = true } = {}) {
  const items = Array.isArray(sub?.pack_items) ? sub.pack_items : [];
  if (!items.length || !plan) return null;
  const catalog = mixCatalog(plan).map(c => ({ shopify_variant_id: c.shopify_variant_id, shopify_product_id: c.shopify_product_id || null, title: c.title, image: c.image || null, price_ars: r0(c.price_ars) }));
  const snap = sub.plan_snapshot || {};
  return {
    items: items.map(i => ({ shopify_variant_id: String(i.shopify_variant_id), title: i.title, image: i.image || null, qty: Math.max(1, r0(i.qty) || 1), price_ars: r0(i.price_ars) })),
    catalog,
    discount_pct: Math.max(0, Math.min(90, Number(plan.discount_pct) || 0)),
    shipping_price_ars: r0(snap.shipping_price_ars),
    extras_total_ars: r0(snap.extras_total_ars),
    max_units: MAX_PACK_UNITS,
    editable: allowed && catalog.length > 0 && ["active", "paused"].includes(sub.status),
    changes: Array.isArray(sub.pack_changes) ? sub.pack_changes.slice(-5) : [],
  };
}

// El total por cobro con el pack nuevo, con las MISMAS partes fijas que el checkout
// guardó (envío y extras). El cupón de % permanente del snapshot se respeta.
export function newTotal(sub, subTotal) {
  const snap = sub?.plan_snapshot || {};
  const codePct = sub?.discount_first_charge_only ? 0 : Math.max(0, Math.min(90, Number(snap.discount_code_pct) || 0));
  const subtotal = codePct ? Math.round(subTotal * (1 - codePct / 100)) : subTotal;
  return { subtotal, total: subtotal + r0(snap.shipping_price_ars) + r0(snap.extras_total_ars) };
}

// Valida y calcula sin tocar nada. → { ok, sel, subtotal, total } | { error }
export function planPackChange(sub, plan, rawItems) {
  if (!Array.isArray(sub?.pack_items) || !sub.pack_items.length) return { error: "Esta suscripción no es de un pack armado: no se puede cambiar desde acá." };
  if (!["active", "paused"].includes(sub.status)) return { error: "Solo se puede cambiar el pedido de una suscripción activa o pausada." };
  const want = (Array.isArray(rawItems) ? rawItems : []).map(r => ({ variant_id: String(r?.variant_id ?? r?.shopify_variant_id ?? "").trim(), qty: Math.round(Number(r?.qty)) })).filter(r => r.qty > 0);
  const units = want.reduce((a, r) => a + r.qty, 0);
  if (!want.length || units < 1) return { error: "Tu pedido tiene que tener al menos un producto." };
  if (units > MAX_PACK_UNITS) return { error: `Como mucho ${MAX_PACK_UNITS} unidades por envío.` };
  const sel = resolveMixSelection(plan, { subQty: units }, want);
  if (sel.error) return { error: sel.error };
  const { subtotal, total } = newTotal(sub, sel.subTotal);
  if (!(total > 0)) return { error: "El total quedó en cero." };
  return { ok: true, sel, subtotal, total, units };
}

// Aplica el cambio: MP primero, después Firestore. `by`: "customer" | "merchant" | "stock".
// Devuelve { ok, total, before, after } o { error, code }.
export async function applyPackChange({ db, merchantId, merchant, subscriberId, sub, plan, items, by = "customer", note = null, now = new Date() }) {
  const p = planPackChange(sub, plan, items);
  if (p.error) return { error: p.error, code: "invalid" };
  if (!merchant?.mp_access_token || !sub.mp_preapproval_id) return { error: "Faltan credenciales para actualizar la suscripción.", code: "no_mp" };
  const before = { items: sub.pack_items.map(i => ({ shopify_variant_id: String(i.shopify_variant_id), title: i.title, qty: r0(i.qty) || 1 })), total: r0(sub.plan_snapshot?.total_per_charge_ars) };
  const after = { items: p.sel.items.map(i => ({ shopify_variant_id: i.shopify_variant_id, title: i.title, qty: i.qty })), total: p.total };
  const same = before.total === after.total && JSON.stringify(before.items) === JSON.stringify(after.items);
  if (same) return { ok: true, unchanged: true, total: p.total, before, after };

  // Monto nuevo + la descripción que el cliente ve en su Mercado Pago ("Pack ×2 · …"):
  // si solo cambiara el monto, MP seguiría diciendo "3 panes (×3)" (visto el 9-oct).
  const reason = mpReason(mixTitle(p.sel.items, p.units), ` — cada ${Number(sub.plan_snapshot?.frequency_days) || 30} días`);
  if (after.total !== before.total || JSON.stringify(before.items) !== JSON.stringify(after.items)) {
    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { reason, ...(after.total !== before.total ? { auto_recurring: { transaction_amount: after.total, currency_id: "ARS" } } : {}) });
    } catch (e) {
      return { error: "Mercado Pago no aceptó el cambio de monto. Probá de nuevo en unos minutos.", code: "mp", detail: String(e?.message || e).slice(0, 300) };
    }
  }
  const at = now.toISOString();
  const change = { at, by, ...(note ? { note: String(note).slice(0, 200) } : {}), from: before, to: after };
  const kept = (Array.isArray(sub.pack_changes) ? sub.pack_changes : []).slice(-(MAX_PACK_CHANGES_KEPT - 1));
  const ref = db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId);
  await ref.update({
    pack_items: p.sel.items,
    quantity: p.units,
    "plan_snapshot.product_title": mixTitle(p.sel.items, p.units),
    "plan_snapshot.units_per_shipment": p.units,
    "plan_snapshot.subscription_price_ars": p.sel.subTotal,
    "plan_snapshot.subtotal_ars": p.subtotal,
    "plan_snapshot.total_per_charge_ars": p.total,
    "plan_snapshot.qty_discount_pct": p.sel.savingsPct,
    pack_changes: [...kept, change],
    pack_changed_at: at,
    updated_at: at,
    reprice_error: FieldValue.delete(),
  });
  return { ok: true, total: p.total, before, after };
}
