// /api/plans  — CRUD de planes de suscripción del merchant logueado.
//
//   GET    → lista de planes del merchant
//   POST   → crear plan (+ crear preapproval_plan en MP)
//   PATCH  → update plan (active, descuento, etc)
//   DELETE → ?id=<planId>
//
// Packs (ver shared/bundle/SPEC.md y _lib/packs.js): `pricing_mode` ("packs"|"theme"),
// `packs` (≤ 6, validados y ordenados por qty) y `frequency_scales_with_qty`.
// Si vienen packs sin pricing_mode → "packs". Sin packs → "theme" (Lumina: el
// tema manda base/sub_off/freq_days por URL; ese flujo no cambia).
import { db, requireMerchant } from "./_lib/firebase.js";
import { normalizePacks, withPackDefaults, planPricingMode, normalizeMix, normalizeFrequencyOptions } from "./_lib/packs.js";
import { createPlanForMerchant, resolvePricingMode, clampPct } from "./_lib/planCreate.js";
import { merchantProfile } from "../shared/platform/profile.js";
import { normalizeDigitalDelivery } from "../shared/platform/delivery.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res, "planes");
  if (!ctx) return;
  const { merchantId } = ctx;

  const merchantRef = db().collection("merchants").doc(merchantId);
  const plansCol = merchantRef.collection("plans");

  if (req.method === "GET") {
    const snap = await plansCol.orderBy("created_at", "desc").get();
    const plans = snap.docs.map(d => withPackDefaults({ id: d.id, ...d.data() }));
    return res.json({ plans });
  }

  if (req.method === "POST") {
    const r = await createPlanForMerchant({ merchantId, body: req.body || {}, req });
    return res.status(r.status).json(r.json);
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const ref = plansCol.doc(String(id));
    const cur = (await ref.get()).data();
    if (!cur) return res.status(404).json({ error: "Plan no encontrado" });
    const patch = req.body || {};
    // Campos que NO se editan por acá.
    delete patch.id; delete patch.mp_preapproval_plan_id; delete patch.created_at;
    // Normalizar numéricos si vienen.
    const num = (v, min = 0) => Math.max(min, parseFloat(v) || 0);
    const out = {};
    if (patch.product_title != null) out.product_title = String(patch.product_title);
    // Ítems manuales (sin tienda): la imagen se edita acá (en Shopify sale del catálogo).
    if (patch.product_image !== undefined && cur.item_source === "manual") {
      const img = String(patch.product_image || "").trim().slice(0, 500);
      out.product_image = /^https:\/\//i.test(img) ? img : null;
    }
    if (patch.frequency_days != null) out.frequency_days = Math.max(1, parseInt(patch.frequency_days) || cur.frequency_days || 30);
    if (patch.discount_pct != null) out.discount_pct = Math.max(0, Math.min(80, parseInt(patch.discount_pct) || 0));
    if (patch.units_per_shipment != null) out.units_per_shipment = Math.max(1, parseInt(patch.units_per_shipment) || 1);
    if (patch.base_price_ars != null) out.base_price_ars = num(patch.base_price_ars);
    if (patch.shipping_price_ars != null) out.shipping_price_ars = num(patch.shipping_price_ars);
    if (patch.free_shipping_from_ars != null) out.free_shipping_from_ars = num(patch.free_shipping_from_ars);
    if (patch.shipping_method_name != null) out.shipping_method_name = String(patch.shipping_method_name).trim().slice(0, 60) || "Envío a domicilio";
    if (patch.active != null) {
      out.active = !!patch.active;
      // La primera vez que se publica queda anotado, para poder distinguir
      // "nunca salio a la tienda" de "lo apague a proposito". 22-sept-2026.
      if (out.active && !cur.published_at) out.published_at = new Date().toISOString();
    }
    if (patch.allow_custom_frequency != null) out.allow_custom_frequency = patch.allow_custom_frequency === true;
    if (patch.max_pack_discount_pct != null) out.max_pack_discount_pct = clampPct(patch.max_pack_discount_pct, 35);
    // Entrega digital (el envío solo sale para negocios sin envío: _lib/delivery.js).
    if ("digital_delivery" in patch) {
      const dd = normalizeDigitalDelivery(patch.digital_delivery);
      if (dd.error) return res.status(400).json({ error: dd.error });
      out.digital_delivery = dd.value;
    }
    // Packs (bundle). `packs: []` vacía la lista y vuelve a "theme" salvo pricing_mode explícito.
    let packsChanged = false;
    if ("packs" in patch && patch.packs !== undefined) {
      const pk = normalizePacks(patch.packs);
      if (pk.error) return res.status(400).json({ error: pk.error });
      out.packs = pk.packs;
      packsChanged = JSON.stringify(pk.packs) !== JSON.stringify(Array.isArray(cur.packs) ? cur.packs : []);
    }
    if (patch.frequency_scales_with_qty != null) out.frequency_scales_with_qty = patch.frequency_scales_with_qty !== false;
    // "Armá tu pack" y frecuencias a elegir (7-oct-2026, G4U).
    if ("mix" in patch) {
      const r = normalizeMix(patch.mix);
      if (r.error) return res.status(400).json({ error: r.error });
      out.mix = r.mix; packsChanged = true;
    }
    if ("frequency_options" in patch) {
      const r = normalizeFrequencyOptions(patch.frequency_options);
      if (r.error) return res.status(400).json({ error: r.error });
      out.frequency_options = r.options;
    }
    if (patch.pricing_mode != null || out.packs) {
      const effPacks = out.packs || (Array.isArray(cur.packs) ? cur.packs : []);
      // Sin pricing_mode explícito: derivar de los packs resultantes.
      const modeRes = resolvePricingMode(patch.pricing_mode != null ? patch.pricing_mode : undefined, effPacks);
      if (modeRes.error) return res.status(400).json({ error: modeRes.error });
      out.pricing_mode = modeRes.mode;
      if (out.pricing_mode !== planPricingMode(cur)) packsChanged = true;
    }
    if (Array.isArray(patch.qty_discount_tiers)) {
      out.qty_discount_tiers = patch.qty_discount_tiers
        .map(t => ({ min_qty: Math.max(2, parseInt(t.min_qty) || 0), discount_pct: Math.max(0, Math.min(100, parseInt(t.discount_pct) || 0)) }))
        .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
        .sort((a, b) => a.min_qty - b.min_qty);
    }
    // Recalcular precio sub si cambió base o descuento (o cualquiera de los dos).
    const base = out.base_price_ars != null ? out.base_price_ars : (cur.base_price_ars || 0);
    const disc = out.discount_pct != null ? out.discount_pct : (cur.discount_pct || 0);
    if (out.base_price_ars != null || out.discount_pct != null) {
      out.subscription_price_ars = Math.round(base * (1 - disc / 100));
    }
    out.updated_at = new Date().toISOString();
    await ref.update(out);
    const priceChanged = out.base_price_ars != null || out.discount_pct != null || packsChanged;
    return res.json({
      ok: true,
      plan: withPackDefaults({ id, ...cur, ...out }),
      note: packsChanged
        ? "Los cambios de precio no afectan suscripciones existentes"
        : (priceChanged ? "Los cambios de precio no afectan suscripciones existentes; usá Repreciar." : undefined),
    });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    // ?hard=1 → borrado REAL (remove del documento). Sin flag → soft delete
    // (active=false, mantiene historial para suscriptores que ya estaban en
    // este plan).
    if (req.query.hard === "1") {
      // Borrado REAL: solo si NADIE lo está usando. Los cobros salen del
      // plan_snapshot del suscriptor, así que borrarlo no corta la plata, pero deja
      // al comerciante sin el plan del que vienen suscripciones vivas (el checkout
      // de recupero y el widget dejan de encontrarlo). Con suscriptores vivos →
      // 409 y se desactiva como siempre desde el panel.
      const vivos = ["active", "paused", "payment_failed", "pending"];
      const enUso = await merchantRef.collection("subscribers")
        .where("plan_id", "==", String(id)).where("status", "in", vivos).limit(1).get()
        .catch(() => null);
      if (enUso && !enUso.empty) {
        return res.status(409).json({
          error: "Este plan tiene suscripciones vivas: desactivalo en lugar de borrarlo (las suscripciones actuales se siguen cobrando).",
          code: "plan_in_use",
        });
      }
      await plansCol.doc(String(id)).delete();
    } else {
      await plansCol.doc(String(id)).update({ active: false, updated_at: new Date().toISOString() });
    }
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
