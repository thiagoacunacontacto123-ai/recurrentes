// /api/plans  — CRUD de planes de suscripción del merchant logueado.
//
//   GET    → lista de planes del merchant
//   POST   → crear plan (+ crear preapproval_plan en MP)
//   PATCH  → update plan (active, descuento, etc)
//   DELETE → ?id=<planId>
import { db, requireAuth } from "./_lib/firebase.js";
import { mpCreatePreapprovalPlan } from "./_lib/mp.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const merchantRef = db().collection("merchants").doc(uid);
  const plansCol = merchantRef.collection("plans");

  if (req.method === "GET") {
    const snap = await plansCol.orderBy("created_at", "desc").get();
    const plans = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.json({ plans });
  }

  if (req.method === "POST") {
    const body = req.body || {};
    const {
      shopify_product_id, shopify_variant_id, product_title, product_image,
      frequency_days, discount_pct, units_per_shipment, base_price_ars,
      // Nuevos: envío y descuentos por cantidad
      shipping_price_ars, free_shipping_from_ars, shipping_method_name,
      qty_discount_tiers, // [{ min_qty, discount_pct }]
    } = body;
    if (!shopify_product_id || !shopify_variant_id || !product_title)
      return res.status(400).json({ error: "Faltan datos del producto" });
    if (!frequency_days || frequency_days < 1)
      return res.status(400).json({ error: "frequency_days inválido" });

    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};
    if (!merchant.mp_access_token) return res.status(400).json({ error: "Conectá MP primero" });

    const subscription_price_ars = Math.round(base_price_ars * (1 - (discount_pct || 0) / 100));

    // Crear preapproval_plan en MP.
    // MP exige back_url HTTPS obligatoria. En dev local usamos un placeholder
    // HTTPS válido (recurrentes.app) — el dominio real cuando exista. MP no
    // valida que el dominio resuelva, solo el formato.
    const baseUrl = process.env.APP_BASE_URL || "";
    const isLocalhost = baseUrl.startsWith("http://localhost") || baseUrl.startsWith("http://127.");
    const backUrl = isLocalhost
      ? "https://recurrentes.app/checkout-success"
      : `${baseUrl}/#/checkout-success`;
    const planBody = {
      reason: `${product_title} — cada ${frequency_days} días`,
      auto_recurring: {
        frequency: parseInt(frequency_days),
        frequency_type: "days",
        transaction_amount: subscription_price_ars,
        currency_id: "ARS",
      },
      back_url: backUrl,
      // SOLO credit_card. Débito y dinero en cuenta NO sirven para cobros
      // recurrentes en MP — el primer pago anda pero el segundo mes falla
      // porque débito requiere autorización del titular cada vez y el saldo
      // en cuenta no se renueva automáticamente. Sin este filtro MP muestra
      // todos los métodos en el checkout y los clientes que eligen débito
      // quedan con sub que cancela sola al primer cobro recurrente.
      payment_methods_allowed: {
        payment_types: [{ id: "credit_card" }],
        payment_methods: [],
      },
    };
    let mpPlan;
    try {
      mpPlan = await mpCreatePreapprovalPlan(merchant.mp_access_token, planBody);
    } catch (e) {
      return res.status(502).json({ error: `MP: ${e.message}` });
    }

    // Normalizar tiers de descuento por cantidad: array de { min_qty, discount_pct }
    // ordenado por min_qty ascendente. Si no viene array válido, queda [].
    const tiers = Array.isArray(qty_discount_tiers)
      ? qty_discount_tiers
          .map(t => ({
            min_qty: Math.max(2, parseInt(t.min_qty) || 0),
            discount_pct: Math.max(0, Math.min(100, parseInt(t.discount_pct) || 0)),
          }))
          .filter(t => t.min_qty >= 2 && t.discount_pct > 0)
          .sort((a, b) => a.min_qty - b.min_qty)
      : [];

    const planRef = plansCol.doc();
    const data = {
      shopify_product_id: String(shopify_product_id),
      shopify_variant_id: String(shopify_variant_id),
      product_title,
      product_image: product_image || null,
      frequency_days: parseInt(frequency_days),
      discount_pct: parseInt(discount_pct) || 0,
      units_per_shipment: parseInt(units_per_shipment) || 1,
      base_price_ars: parseFloat(base_price_ars) || 0,
      subscription_price_ars,
      // Envío
      shipping_price_ars: Math.max(0, parseFloat(shipping_price_ars) || 0),
      free_shipping_from_ars: Math.max(0, parseFloat(free_shipping_from_ars) || 0), // 0 = nunca gratis
      shipping_method_name: (shipping_method_name || "Envío a domicilio").trim().slice(0, 60),
      // Descuentos por cantidad
      qty_discount_tiers: tiers,
      mp_preapproval_plan_id: mpPlan.id,
      active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await planRef.set(data);
    return res.json({ ok: true, plan: { id: planRef.id, ...data } });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const patch = req.body || {};
    delete patch.id;
    delete patch.mp_preapproval_plan_id; // no editamos el id de MP
    patch.updated_at = new Date().toISOString();
    await plansCol.doc(String(id)).update(patch);
    return res.json({ ok: true });
  }

  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    // Soft delete: marcamos active=false. Mantenemos historial para suscriptores existentes.
    await plansCol.doc(String(id)).update({ active: false, updated_at: new Date().toISOString() });
    return res.json({ ok: true });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
