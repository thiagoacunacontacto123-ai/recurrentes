// /api/subscribers — CRUD de suscriptores del merchant logueado.
//
//   GET                                  → lista de subs (con filtros opcionales)
//   GET /api/subscribers?id=<subId>      → detalle de un sub
//   PATCH /api/subscribers?id=<subId>    → actualizar estado (pause | resume | cancel)
//
// Las acciones pause/cancel se reflejan en MP via mpUpdatePreapproval.
import { db, requireAuth } from "./_lib/firebase.js";
import { mpUpdatePreapproval, mpGetPreapproval } from "./_lib/mp.js";
import { syncSubscriber } from "./_lib/sync.js";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  const uid = await requireAuth(req, res);
  if (!uid) return;

  const merchantRef = db().collection("merchants").doc(uid);
  const subsCol = merchantRef.collection("subscribers");

  // POST ?action=sync&id=X — sincronización MANUAL de UN sub específico. Solo
  // se usa como escape hatch desde el modal de detalle (botón "⟳ Sincronizar"),
  // para el caso raro en que el webhook MP haya fallado. El trigger normal de
  // activación de subs es siempre el webhook MP a nivel cuenta del merchant.
  if (req.method === "POST" && req.query.action === "sync" && req.query.id) {
    try {
      const r = await syncSubscriber(uid, String(req.query.id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // PATCH ?action=update-address&id=SUB
  // Edita el shipping_address del sub Y propaga el cambio a TODAS las
  // órdenes Shopify asociadas (las que ya se crearon + las que se generen
  // en futuros cobros recurrentes).
  if (req.method === "PATCH" && req.query.action === "update-address" && req.query.id) {
    const { address1, address2, city, province, zip, phone, customer_name, tax_id } = req.body || {};
    if (!address1?.trim()) return res.status(400).json({ error: "Falta dirección (address1)" });
    if (!city?.trim())     return res.status(400).json({ error: "Falta ciudad" });
    if (!zip?.trim())      return res.status(400).json({ error: "Falta código postal" });
    if (!province?.trim()) return res.status(400).json({ error: "Falta provincia" });

    const subRef = subsCol.doc(String(req.query.id));
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
    const sub = subSnap.data();

    // Sanitizar tax_id si vino — solo dígitos. DNI 7-8, CUIT/CUIL 11.
    let cleanTaxId = null;
    let cleanTaxIdKind = sub.customer_tax_id_kind || "DNI";
    if (typeof tax_id === "string") {
      cleanTaxId = tax_id.replace(/[^0-9]/g, "");
      if (cleanTaxId && !(cleanTaxId.length === 7 || cleanTaxId.length === 8 || cleanTaxId.length === 11)) {
        return res.status(400).json({ error: "DNI o CUIL/CUIT inválido (7-8 dígitos para DNI, 11 para CUIL/CUIT)" });
      }
      cleanTaxIdKind = cleanTaxId.length === 11 ? "CUIT" : "DNI";
    }

    const newAddr = {
      address1: address1.trim(),
      address2: (address2 || "").trim(),
      city: city.trim(),
      province: province.trim(),
      zip: zip.trim(),
      country: "Argentina",
      phone: (phone || sub.customer_phone || "").trim(),
      first_name: (customer_name || sub.customer_name || "").split(" ")[0] || "",
      last_name: (customer_name || sub.customer_name || "").split(" ").slice(1).join(" ") || "",
      company: cleanTaxId || sub.customer_tax_id || "", // DNI/CUIT visible en Shopify
    };

    const subUpdates = {
      shipping_address: newAddr,
      ...(customer_name ? { customer_name: customer_name.trim() } : {}),
      ...(phone ? { customer_phone: phone.trim() } : {}),
      ...(cleanTaxId ? { customer_tax_id: cleanTaxId, customer_tax_id_kind: cleanTaxIdKind } : {}),
      updated_at: new Date().toISOString(),
    };
    await subRef.update(subUpdates);

    // Propagar a las órdenes Shopify ya creadas — PUT /orders/{id}.json
    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};
    const orderIds = sub.shopify_orders || [];
    const updatedOrders = [];
    const failedOrders = [];
    if (merchant.shopify_token && merchant.shopify_shop && orderIds.length > 0) {
      for (const orderId of orderIds) {
        try {
          const url = `https://${merchant.shopify_shop}/admin/api/2024-10/orders/${orderId}.json`;
          const r = await fetch(url, {
            method: "PUT",
            headers: {
              "X-Shopify-Access-Token": merchant.shopify_token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              order: {
                id: orderId,
                shipping_address: newAddr,
                billing_address: newAddr,
              },
            }),
          });
          if (r.ok) updatedOrders.push(orderId);
          else failedOrders.push({ orderId, status: r.status });
        } catch (e) {
          failedOrders.push({ orderId, error: e.message });
        }
      }
    }

    return res.json({ ok: true, updated_orders: updatedOrders, failed_orders: failedOrders });
  }

  // POST ?action=simulate-charge&id=SUB
  // Simula el próximo cobro recurrente — crea charge + orden Shopify sin
  // pasar por MP. Útil para validar que el flow del 2do, 3er, N-ésimo cobro
  // funciona, sin esperar 30 días reales ni gastar plata real.
  if (req.method === "POST" && req.query.action === "simulate-charge" && req.query.id) {
    try {
      const { simulateNextCharge } = await import("./_lib/sync.js");
      const r = await simulateNextCharge(uid, String(req.query.id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST ?action=link-payment&id=SUB&payment_id=PID
  // Escape hatch para cuando MP indexa mal y el sync no encuentra el payment
  // pero el merchant lo ve en su panel. Pega el ID y procesamos directo.
  if (req.method === "POST" && req.query.action === "link-payment" && req.query.id) {
    const { payment_id } = req.body || {};
    if (!payment_id) return res.status(400).json({ error: "Falta payment_id" });
    try {
      const { linkPaymentToSubscriber } = await import("./_lib/sync.js");
      const r = await linkPaymentToSubscriber(uid, String(req.query.id), String(payment_id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method === "GET") {
    const id = req.query.id;
    if (id) {
      const snap = await subsCol.doc(String(id)).get();
      if (!snap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
      // Traemos también el historial de cargos del subscriber
      const chargesSnap = await merchantRef.collection("charges")
        .where("subscriber_id", "==", String(id))
        .get();
      const charges = chargesSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      return res.json({ subscriber: { id: snap.id, ...snap.data() }, charges });
    }
    // Listar con filtros: status, plan_id, email
    let q = subsCol;
    if (req.query.status) q = q.where("status", "==", String(req.query.status));
    if (req.query.plan_id) q = q.where("plan_id", "==", String(req.query.plan_id));
    const snap = await q.get();
    let subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (req.query.email) {
      const emailQ = String(req.query.email).toLowerCase();
      subs = subs.filter(s => (s.customer_email || "").toLowerCase().includes(emailQ));
    }
    subs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return res.json({ subscribers: subs });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const { action } = req.body || {};
    if (!["pause", "resume", "cancel"].includes(action)) {
      return res.status(400).json({ error: "action debe ser pause | resume | cancel" });
    }

    const subRef = subsCol.doc(String(id));
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
    const sub = subSnap.data();

    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};

    const mpStatusMap = { pause: "paused", resume: "authorized", cancel: "cancelled" };
    const newMpStatus = mpStatusMap[action];

    // Intentamos sincronizar con MP (best effort). Si falla — ej "You can not
    // modify a cancelled preapproval" porque ya está cancelado allá — igual
    // actualizamos el estado local. La sincronización falla solo si no hay
    // token MP o preapproval_id, en cuyo caso seguimos con el cambio local.
    if (merchant.mp_access_token && sub.mp_preapproval_id) {
      try {
        await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: newMpStatus });
      } catch (e) {
        console.warn(`[subscribers] MP update falló (${e.message}). Continúa con cambio local.`);
        // No abortamos — seguimos con el cambio local.
      }
    }

    const localStatus = action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "active";
    await subRef.update({
      status: localStatus,
      updated_at: new Date().toISOString(),
      ...(action === "cancel" ? { cancelled_at: new Date().toISOString() } : {}),
    });
    return res.json({ ok: true, status: localStatus });
  }

  // DELETE /api/subscribers?id=X — borra el subscriber del Firestore
  // definitivamente. Best effort: si MP todavía tiene la sub activa, intenta
  // cancelarla; si MP da error (ya cancelada, etc), ignora y borra igual.
  // Útil para limpiar tests / subs basura sin tener que tocar Firestore.
  if (req.method === "DELETE") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const subRef = subsCol.doc(String(id));
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
    const sub = subSnap.data();
    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};

    // Best effort: cancelar en MP por las dudas
    if (merchant.mp_access_token && sub.mp_preapproval_id && sub.status !== "cancelled") {
      try {
        await mpUpdatePreapproval(merchant.mp_access_token, sub.mp_preapproval_id, { status: "cancelled" });
      } catch (_) {}
    }

    // Borrar también los charges asociados
    const chargesSnap = await merchantRef.collection("charges").where("subscriber_id", "==", String(id)).get();
    for (const c of chargesSnap.docs) await c.ref.delete();

    await subRef.delete();
    return res.json({ ok: true, deleted: true, charges_deleted: chargesSnap.size });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
