// Stock por producto en los packs armados (9-oct-2026, G4U + Thiago: "si pido pan 1 y
// pan 2 y de pan 2 no hay, que me cobre y mande solo pan 1 hasta que vuelva").
//
// Regla:
//   · Falta un producto del pack → se saca SOLO ese (o se baja su cantidad a lo que
//     hay), el monto en Mercado Pago baja, y queda "en espera" en `pack_held_items`.
//   · Vuelve el stock → se vuelve a sumar solo y el monto vuelve. Nadie toca nada.
//   · Faltan TODOS → pausa como siempre (stock.js), con el mail de sin stock.
//   · El cliente puede, desde el portal, reemplazar lo que falta por otro producto
//     ("drop_held"): ahí deja de esperarse.
// Siempre: MP primero; si MP no acepta, no se toca nada local. Rastro en pack_changes
// (by: "stock"). Avisos: mail "stock_hold" la primera vez que se saca algo y
// "stock_restored" cuando vuelve (los dos editables en Flujos de email).
// Nunca lanza: cuelga del camino del cobro.
import { mpUpdatePreapproval } from "./mp.js";
import { mixTitle } from "./packs.js";
import { newTotal, packReason, MAX_PACK_CHANGES_KEPT } from "./packChange.js";

const r0 = (n) => Math.round(Number(n) || 0);
const vid = (i) => String(i?.shopify_variant_id || "");

// Inventario por variante en Shopify: Map(vid → unidades | null). null = sin
// seguimiento de inventario (infinito) o no se pudo saber (se sigue como siempre).
export async function inventarioPorVariante(merchant, vids) {
  const out = new Map();
  if (!(merchant?.shopify_shop && merchant?.shopify_token)) return out;
  for (const v of [...new Set((vids || []).map(String).filter(Boolean))]) {
    try {
      const r = await fetch(`https://${merchant.shopify_shop}/admin/api/2024-10/variants/${encodeURIComponent(v)}.json?fields=id,inventory_quantity,inventory_management`, {
        headers: { "X-Shopify-Access-Token": merchant.shopify_token },
      });
      if (!r.ok) { out.set(v, null); continue; }
      const d = (await r.json())?.variant || {};
      const n = Number(d.inventory_quantity);
      out.set(v, d.inventory_management && Number.isFinite(n) ? n : null);
    } catch (_) { out.set(v, null); }
  }
  return out;
}

// Pura: con lo que lleva hoy, lo que espera y el inventario, decide el pack nuevo.
// → { active, held, removed, restored, changed, allOut }
export function planPackStock(sub, inventory) {
  const activeIn = Array.isArray(sub?.pack_items) ? sub.pack_items : [];
  const heldIn = Array.isArray(sub?.pack_held_items) ? sub.pack_held_items : [];
  const inv = (v) => (inventory instanceof Map ? inventory.get(v) : inventory?.[v]);
  const active = [];
  const held = [];
  const removed = [];
  const restored = [];
  // 1) Lo que lleva: si no alcanza, baja la cantidad o sale.
  for (const it of activeIn) {
    const v = vid(it); const qty = Math.max(1, r0(it.qty) || 1); const n = inv(v);
    if (n == null || n >= qty) { active.push({ ...it, qty }); continue; }
    const keep = Math.max(0, r0(n));
    if (keep > 0) active.push({ ...it, qty: keep });
    held.push({ ...it, qty: qty - keep });
    removed.push({ title: it.title, qty: qty - keep, shopify_variant_id: v });
  }
  // 2) Lo que esperaba: si ya hay para lo que lleva + lo que espera, vuelve.
  for (const it of heldIn) {
    const v = vid(it); const want = Math.max(1, r0(it.qty) || 1); const n = inv(v);
    const yaLleva = active.filter(a => vid(a) === v).reduce((a, b) => a + b.qty, 0);
    if (n == null || n >= yaLleva + want) {
      const cur = active.find(a => vid(a) === v);
      if (cur) cur.qty += want; else active.push({ ...it, qty: want });
      restored.push({ title: it.title, qty: want, shopify_variant_id: v });
    } else {
      // Vuelve en parte si hay algo (y no es lo que ya lleva).
      const libre = Math.max(0, r0(n) - yaLleva);
      if (libre > 0) {
        const cur = active.find(a => vid(a) === v);
        if (cur) cur.qty += libre; else active.push({ ...it, qty: libre });
        restored.push({ title: it.title, qty: libre, shopify_variant_id: v });
        held.push({ ...it, qty: want - libre });
      } else held.push({ ...it, qty: want });
    }
  }
  // Un mismo producto no aparece dos veces en espera.
  const heldMerged = [];
  for (const h of held) { const cur = heldMerged.find(x => vid(x) === vid(h)); if (cur) cur.qty += h.qty; else heldMerged.push({ ...h }); }
  const changed = removed.length > 0 || restored.length > 0;
  return { active, held: heldMerged, removed, restored, changed, allOut: active.length === 0 };
}

function totalsFor(sub, items, discountPct) {
  const list = items.reduce((a, i) => a + r0(i.price_ars) * (r0(i.qty) || 1), 0);
  const disc = Math.max(0, Math.min(90, Number(discountPct) || 0));
  const subTotal = Math.round(list * (1 - disc / 100));
  const { subtotal, total } = newTotal(sub, subTotal);
  return { list, subTotal, subtotal, total, savingsPct: list > 0 ? Math.round((1 - subTotal / list) * 100) : 0 };
}

async function discountFor(db, merchantId, sub) {
  try {
    if (sub?.plan_id) {
      const p = (await db().collection("merchants").doc(merchantId).collection("plans").doc(String(sub.plan_id)).get()).data();
      if (p && Number.isFinite(Number(p.discount_pct))) return Number(p.discount_pct);
    }
  } catch (_) {}
  return Number(sub?.plan_snapshot?.qty_discount_pct) || 0;
}

const listado = (arr) => (arr || []).map(x => `${x.title} ×${x.qty}`).join(", ");

async function avisar(kind, { merchant, merchantId, subscriberId, sub, removed, restored, total, now, tag }) {
  try {
    const { emailPackStock } = await import("./email.js");
    const { portalUrlFor } = await import("./sync.js");
    if (sub?.customer_email) {
      await emailPackStock(kind, {
        to: sub.customer_email, customerName: sub.customer_name, productTitle: sub.plan_snapshot?.product_title,
        amount: total, frequencyDays: sub.plan_snapshot?.frequency_days, quantity: sub.quantity,
        faltantes: listado(kind === "stock_hold" ? removed : restored), portalUrl: portalUrlFor({ ...sub, id: subscriberId }), merchant,
      });
    }
  } catch (e) { console.warn(`[${tag}] mail ${kind}:`, e.message); }
  try {
    const { emitFlowEvent } = await import("./flows.js");
    await emitFlowEvent(merchantId, merchant, kind, subscriberId, sub, { key: now });
  } catch (e) { console.warn(`[${tag}] flujo ${kind}:`, e.message); }
}

/**
 * Aplica el stock por producto a una sub de pack. `inventory` opcional (ya leído).
 * → null (no es pack / nada que hacer) | { changed, removed, restored, allOut, total }
 *   allOut: true = no quedó nada: el que llama pausa (stock.js). No se toca nada en ese caso.
 */
export async function applyPackStock({ db, merchant, merchantId, subscriberId, sub, inventory = null, now = new Date().toISOString(), tag = "stock" }) {
  try {
    if (!Array.isArray(sub?.pack_items) || !sub.pack_items.length) return null;
    const vids = [...sub.pack_items, ...(sub.pack_held_items || [])].map(vid);
    const inv = inventory || await inventarioPorVariante(merchant, vids);
    const p = planPackStock(sub, inv);
    if (p.allOut) return { changed: false, removed: p.removed, restored: [], allOut: true, total: r0(sub.plan_snapshot?.total_per_charge_ars) };
    if (!p.changed) return { changed: false, removed: [], restored: [], allOut: false, total: r0(sub.plan_snapshot?.total_per_charge_ars) };
    if (!merchant?.mp_access_token || !sub.mp_preapproval_id) return null;

    const disc = await discountFor(db, merchantId, sub);
    const t = totalsFor(sub, p.active, disc);
    const units = p.active.reduce((a, i) => a + i.qty, 0);
    const before = { items: sub.pack_items.map(i => ({ shopify_variant_id: vid(i), title: i.title, qty: r0(i.qty) || 1 })), total: r0(sub.plan_snapshot?.total_per_charge_ars) };
    const after = { items: p.active.map(i => ({ shopify_variant_id: vid(i), title: i.title, qty: i.qty })), total: t.total };
    const freq = Number(sub.plan_snapshot?.frequency_days) || 30;
    try {
      await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, {
        reason: packReason(p.active, units, freq),
        ...(after.total !== before.total ? { auto_recurring: { transaction_amount: after.total, currency_id: "ARS" } } : {}),
      });
    } catch (e) {
      console.error(`[${tag}] stock del pack: MP no aceptó el monto sub=${subscriberId}:`, e.message);
      return null;   // nada local: mejor el pack viejo con el cobro viejo
    }
    const note = [p.removed.length ? `sin stock: ${listado(p.removed)}` : "", p.restored.length ? `volvió: ${listado(p.restored)}` : ""].filter(Boolean).join(" · ");
    const change = { at: now, by: "stock", note: note.slice(0, 200), from: before, to: after };
    const kept = (Array.isArray(sub.pack_changes) ? sub.pack_changes : []).slice(-(MAX_PACK_CHANGES_KEPT - 1));
    // update() y no set(merge): las claves con punto ("plan_snapshot.total_per_charge_ars")
    // solo son rutas de campo en update; en set quedan como un campo literal con punto.
    await db().collection("merchants").doc(merchantId).collection("subscribers").doc(subscriberId).update({
      pack_items: p.active,
      pack_held_items: p.held,
      quantity: units,
      "plan_snapshot.product_title": mixTitle(p.active, units),
      "plan_snapshot.units_per_shipment": units,
      "plan_snapshot.subscription_price_ars": t.subTotal,
      "plan_snapshot.subtotal_ars": t.subtotal,
      "plan_snapshot.total_per_charge_ars": t.total,
      "plan_snapshot.qty_discount_pct": t.savingsPct,
      pack_changes: [...kept, change],
      pack_changed_at: now,
      stock_hold_at: p.held.length ? (sub.stock_hold_at || now) : null,
      updated_at: now,
    });
    const fresh = { ...sub, pack_items: p.active, pack_held_items: p.held, quantity: units, plan_snapshot: { ...sub.plan_snapshot, product_title: mixTitle(p.active, units), total_per_charge_ars: t.total } };
    if (p.removed.length) await avisar("stock_hold", { merchant, merchantId, subscriberId, sub: fresh, removed: p.removed, restored: p.restored, total: t.total, now, tag });
    else if (p.restored.length) await avisar("stock_restored", { merchant, merchantId, subscriberId, sub: fresh, removed: [], restored: p.restored, total: t.total, now, tag });
    console.warn(`[${tag}] stock del pack sub=${subscriberId}: ${note} → $${t.total}`);
    return { changed: true, removed: p.removed, restored: p.restored, allOut: false, total: t.total };
  } catch (e) {
    console.warn(`[${tag}] stock del pack:`, e.message);
    return null;
  }
}
