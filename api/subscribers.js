// /api/subscribers — CRUD de suscriptores del merchant logueado.
//
//   GET                                  → lista de subs. Filtros:
//        status=active|paused|payment_failed|pending|cancelled|unpaid
//          (unpaid = pending sin last_charge_at, últimos 30 días, dedup por email)
//        plan_id=<id> · q=<texto> (email / nombre / teléfono, en memoria) · email=<texto>
//   GET /api/subscribers?id=<subId>      → detalle de un sub
//   GET ?action=abandoned                → alias de status=unpaid (respuesta legacy { abandoned, count })
//   GET ?action=export                   → CSV de suscriptores
//   PATCH /api/subscribers?id=<subId>    → actualizar estado (pause | resume | cancel | resync)
//   POST ?action=sync|simulate-charge|link-payment|retry-order|reprice
//
// Las acciones pause/cancel se reflejan en MP via mpUpdatePreapproval.
import { FieldValue } from "firebase-admin/firestore";
import { db, requireMerchant } from "./_lib/firebase.js";
import { mpUpdatePreapproval, mpGetPreapproval } from "./_lib/mp.js";
import { syncSubscriber } from "./_lib/sync.js";
import { API_VERSION } from "./_lib/shopify.js";
import { fetchWithTimeout } from "./_lib/http.js";
import { logEmail } from "./_lib/emaillog.js";
import { klaviyoEnabled, klaviyoLifecycle, KLAVIYO_METRICS } from "./_lib/klaviyo.js";

const nowIso = () => new Date().toISOString();

// Busca en MP el preapproval de un sub que no tiene mp_preapproval_id (flujo
// de plan: MP crea el preapproval solo y no siempre nos llega el id). Filtra
// por preapproval_plan_id + authorized; desempata por payer_email. Si lo
// encuentra lo persiste y lo devuelve; si no, null.
async function ensurePreapprovalId(merchant, subRef, sub) {
  if (sub.mp_preapproval_id) return sub.mp_preapproval_id;
  if (!merchant.mp_access_token) return null;
  const planId = sub.mp_preapproval_plan_id || sub.mp_adhoc_plan_id || null;
  const headers = { Authorization: `Bearer ${merchant.mp_access_token}` };
  const urls = [];
  if (planId) urls.push(`https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${encodeURIComponent(planId)}&status=authorized`);
  if (sub.customer_email) urls.push(`https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(sub.customer_email)}&status=authorized`);
  for (const url of urls) {
    try {
      const r = await fetchWithTimeout(url, { headers }, 8000);
      if (!r.ok) continue;
      const s = await r.json().catch(() => ({}));
      const results = (s?.results || []).filter(p => p.status === "authorized");
      if (!results.length) continue;
      const email = String(sub.customer_email || "").toLowerCase();
      const hit = results.find(p => String(p.payer_email || "").toLowerCase() === email && (!planId || p.preapproval_plan_id === planId))
        || results.find(p => !planId || p.preapproval_plan_id === planId)
        || null;
      if (hit) {
        await subRef.update({ mp_preapproval_id: hit.id, mp_preapproval_status: hit.status, updated_at: nowIso() });
        return hit.id;
      }
    } catch (_) {}
  }
  return null;
}

const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(200).end();
  // Multi-tienda: merchantId = tienda activa (header X-Merchant-Id) o el uid del login.
  const ctx = await requireMerchant(req, res, "suscripciones");
  if (!ctx) return;
  const { merchantId } = ctx;

  const merchantRef = db().collection("merchants").doc(merchantId);
  const subsCol = merchantRef.collection("subscribers");

  // POST ?action=sync&id=X — sincronización MANUAL de UN sub específico. Solo
  // se usa como escape hatch desde el modal de detalle (botón "⟳ Sincronizar"),
  // para el caso raro en que el webhook MP haya fallado. El trigger normal de
  // activación de subs es siempre el webhook MP a nivel cuenta del merchant.
  if (req.method === "POST" && req.query.action === "sync" && req.query.id) {
    try {
      const r = await syncSubscriber(merchantId, String(req.query.id));
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
      updated_at: nowIso(),
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
          const url = `https://${merchant.shopify_shop}/admin/api/${API_VERSION}/orders/${orderId}.json`;
          const r = await fetchWithTimeout(url, {
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
          }, 10000);
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
      const r = await simulateNextCharge(merchantId, String(req.query.id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST ?action=link-payment&id=SUB  (body { payment_id })
  // POST ?action=retry-order          (body { id, payment_id })
  // Escape hatch para cuando MP indexa mal y el sync no encuentra el payment
  // pero el merchant lo ve en su panel, o para reintentar la orden Shopify de
  // un charge que quedó con error. Pega el ID y procesamos directo.
  if (req.method === "POST" && (req.query.action === "link-payment" || req.query.action === "retry-order")) {
    const { payment_id, id: bodyId } = req.body || {};
    const subId = String(req.query.id || bodyId || "");
    if (!subId) return res.status(400).json({ error: "Falta id" });
    if (!payment_id) return res.status(400).json({ error: "Falta payment_id" });
    try {
      const { linkPaymentToSubscriber } = await import("./_lib/sync.js");
      const r = await linkPaymentToSubscriber(merchantId, subId, String(payment_id));
      return res.json({ ok: true, ...r });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST ?action=reprice  body { id, new_amount } | { plan_id, new_amount }
  // Cambia el monto del preapproval en MP (PUT auto_recurring.transaction_amount)
  // para una sub o para todas las activas de un plan (máx 200). Solo si MP
  // confirma se actualiza plan_snapshot.total_per_charge_ars.
  if (req.method === "POST" && req.query.action === "reprice") {
    const { id, plan_id } = req.body || {};
    const newAmount = Math.round(Number(req.body?.new_amount) || 0);
    if (!(newAmount > 0)) return res.status(400).json({ error: "new_amount debe ser > 0" });
    if (!id && !plan_id) return res.status(400).json({ error: "Falta id o plan_id" });
    const merchant = (await merchantRef.get()).data() || {};
    if (!merchant.mp_access_token) return res.status(400).json({ error: "Conectá Mercado Pago primero" });

    let docs;
    if (id) {
      const s = await subsCol.doc(String(id)).get();
      if (!s.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
      docs = [s];
    } else {
      const q = await subsCol.where("plan_id", "==", String(plan_id)).where("status", "==", "active").limit(200).get();
      docs = q.docs;
    }
    let updated = 0;
    const failed = [];
    for (const d of docs) {
      const sub = d.data();
      try {
        const preId = await ensurePreapprovalId(merchant, d.ref, sub);
        if (!preId) throw new Error("sin mp_preapproval_id (no se ubicó en MP)");
        await mpUpdatePreapproval(merchant.mp_access_token, preId, { auto_recurring: { transaction_amount: newAmount, currency_id: "ARS" } });
        await d.ref.update({
          "plan_snapshot.total_per_charge_ars": newAmount,
          repriced_at: nowIso(),
          repriced_from: sub.plan_snapshot?.total_per_charge_ars ?? null,
          updated_at: nowIso(),
        });
        updated++;
      } catch (e) {
        failed.push({ id: d.id, error: e.message });
      }
    }
    return res.json({ ok: true, updated, failed, total: docs.length, new_amount: newAmount });
  }

  // ── Checkouts SIN PAGAR (status=unpaid; ?action=abandoned es el alias legacy) ──
  // Suscriptores en "pending" (iniciaron el checkout y NO pagaron) de hace +45 min
  // (les dimos tiempo a completar) y hasta 30 días atrás, sin orden ni cobro.
  // Deduplicados por email (queda el intento MÁS RECIENTE). El link de recupero
  // solo se devuelve si apunta a un dominio de la tienda.
  const listUnpaid = async () => {
    const now = Date.now();
    const minAgeMs = 45 * 60 * 1000;
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
    const [snap, mSnap] = await Promise.all([subsCol.where("status", "==", "pending").get(), merchantRef.get()]);
    const merchant = mSnap.data() || {};
    const okHosts = new Set([
      ...(Array.isArray(merchant.shopify_domains) ? merchant.shopify_domains : []),
      merchant.store_domain, merchant.shopify_shop,
    ].map(h => String(h || "").toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")).filter(Boolean));
    const safeUrl = (u) => {
      try { const x = new URL(String(u || "")); return x.protocol === "https:" && okHosts.has(x.host.toLowerCase()) ? x.toString() : null; }
      catch (_) { return null; }
    };
    const rows = [];
    for (const doc of snap.docs) {
      const s = doc.data();
      const created = s.created_at ? new Date(s.created_at).getTime() : 0;
      if (!created) continue;
      const age = now - created;
      if (age < minAgeMs || age > maxAgeMs) continue;
      if (s.last_charge_at) continue;
      if ((s.shopify_orders || []).length > 0) continue;
      if (s.abandoned_step === 99) continue; // ya compró por otro lado
      if (s.mp_preapproval_status === "authorized") continue; // tarjeta autorizada: no es abandono
      rows.push({ doc, s, recover_url: safeUrl(s.fb_data?.event_source_url) });
    }
    const byEmail = {};
    for (const r of rows) {
      const k = (r.s.customer_email || "").toLowerCase();
      if (!byEmail[k] || (r.s.created_at || "") > (byEmail[k].s.created_at || "")) byEmail[k] = r;
    }
    return Object.values(byEmail).sort((a, b) => (b.s.created_at || "").localeCompare(a.s.created_at || ""));
  };

  if (req.method === "GET" && req.query.action === "abandoned") {
    const list = (await listUnpaid()).map(({ doc, s, recover_url }) => ({
      id: doc.id,
      email: s.customer_email || null,
      name: s.customer_name || null,
      phone: s.customer_phone || null,
      product_title: s.plan_snapshot?.product_title || null,
      quantity: s.quantity || 1,
      value_ars: s.plan_snapshot?.total_per_charge_ars || s.plan_snapshot?.subscription_price_ars || 0,
      frequency_days: s.plan_snapshot?.frequency_days || null,
      created_at: s.created_at,
      abandoned_step: s.abandoned_step || 0,
      abandoned_step_at: s.abandoned_step_at || null,
      capture: s.capture === true,
      recover_url,
    }));
    return res.json({ abandoned: list, count: list.length });
  }

  // ── GET ?action=export — CSV de suscriptores (opcional ?status=) ──────────
  if (req.method === "GET" && req.query.action === "export") {
    let subs;
    if (String(req.query.status || "") === "unpaid") {
      subs = (await listUnpaid()).map(({ doc, s }) => ({ id: doc.id, ...s }));
    } else {
      let q = subsCol;
      if (req.query.status) q = q.where("status", "==", String(req.query.status));
      const snap = await q.get();
      subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    subs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    const header = ["id", "email", "nombre", "telefono", "estado", "plan", "cantidad", "monto_por_cobro", "frecuencia_dias", "proximo_cobro", "ultimo_cobro", "ordenes", "alta"];
    const lines = [header.join(";")];
    for (const s of subs) {
      lines.push([
        s.id, s.customer_email, s.customer_name, s.customer_phone, s.status,
        s.plan_snapshot?.product_title, s.quantity || s.plan_snapshot?.units_per_shipment || 1,
        s.plan_snapshot?.total_per_charge_ars ?? s.plan_snapshot?.subscription_price_ars ?? "",
        s.plan_snapshot?.frequency_days, s.next_charge_at, s.last_charge_at,
        (s.shopify_orders || []).length, s.created_at,
      ].map(csvCell).join(";"));
    }
    const fname = `suscriptores-${nowIso().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send("\uFEFF" + lines.join("\n"));
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
    // Listar con filtros: status, plan_id, email, q
    const STATUSES = ["active", "paused", "payment_failed", "pending", "cancelled", "unpaid"];
    const status = String(req.query.status || "").trim();
    if (status && !STATUSES.includes(status)) return res.status(400).json({ error: `status debe ser ${STATUSES.join(" | ")}` });
    let subs;
    if (status === "unpaid") {
      // Sin pagar = pending sin cobro, últimos 30 días, dedup por email (ver listUnpaid).
      subs = (await listUnpaid()).map(({ doc, s, recover_url }) => ({ id: doc.id, ...s, recover_url, unpaid: true }));
      if (req.query.plan_id) subs = subs.filter(s => String(s.plan_id || "") === String(req.query.plan_id));
    } else {
      let q = subsCol;
      if (status) q = q.where("status", "==", status);
      if (req.query.plan_id) q = q.where("plan_id", "==", String(req.query.plan_id));
      const snap = await q.get();
      subs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
    if (req.query.email) {
      const emailQ = String(req.query.email).toLowerCase();
      subs = subs.filter(s => (s.customer_email || "").toLowerCase().includes(emailQ));
    }
    // q = búsqueda libre por email / nombre / teléfono (en memoria, sin acentos).
    const qText = String(req.query.q || "").trim().toLowerCase();
    if (qText) {
      const fold = (v) => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const needle = fold(qText);
      subs = subs.filter(s => fold(s.customer_email).includes(needle) || fold(s.customer_name).includes(needle) || fold(s.customer_phone).replace(/\D/g, "").includes(needle.replace(/\D/g, "") || "\u0000"));
    }
    subs.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return res.json({ subscribers: subs, count: subs.length, ...(status ? { status } : {}), ...(qText ? { q: qText } : {}) });
  }

  if (req.method === "PATCH") {
    const id = req.query.id;
    if (!id) return res.status(400).json({ error: "Falta id" });
    const { action } = req.body || {};
    if (!["pause", "resume", "cancel", "resync"].includes(action)) {
      return res.status(400).json({ error: "action debe ser pause | resume | cancel | resync" });
    }

    const subRef = subsCol.doc(String(id));
    const subSnap = await subRef.get();
    if (!subSnap.exists) return res.status(404).json({ error: "Subscriber no encontrado" });
    const sub = subSnap.data();

    const merchantSnap = await merchantRef.get();
    const merchant = merchantSnap.data() || {};

    // ── RESYNC: reconciliar estado local con la verdad de MP. Útil cuando
    // el local quedó "cancelled" por un error de cancel anterior pero la sub
    // en MP sigue activa (cobrando recurrencias mensuales). Le devuelve la
    // verdad al merchant y, si MP la tiene activa, restablece el sub.
    if (action === "resync") {
      // FORZAR LOCAL → "active" (sin importar lo que diga MP search). Esta
      // acción es "marcar como activa": el merchant ya verificó manualmente
      // en su panel MP que la sub sigue cobrando, y nos dice "anexá esto
      // a la suscripción real". Cuando MP cobre el próximo mes, el webhook
      // va a llegar con external_reference=mid:sid y matchea por ahí.
      //
      // Best-effort: si encontramos un preapproval authorized en MP, también
      // guardamos su mp_preapproval_id para que sea otra ruta de match en el
      // webhook (más confiable). Pero si no lo encontramos, igual marcamos
      // active y confiamos en external_reference.
      const extRef = `${merchantId}:${id}`;
      let linkedPreapproval = null;
      let nextChargeAt = sub.next_charge_at || null;

      if (merchant.mp_access_token) {
        const headers = { Authorization: `Bearer ${merchant.mp_access_token}` };
        // Search por external_reference + plan + payer_email; nos quedamos con
        // el primer authorized que encontremos.
        const queries = [
          `https://api.mercadopago.com/preapproval/search?external_reference=${encodeURIComponent(extRef)}`,
          sub.mp_preapproval_plan_id ? `https://api.mercadopago.com/preapproval/search?preapproval_plan_id=${encodeURIComponent(sub.mp_preapproval_plan_id)}&status=authorized` : null,
          sub.customer_email ? `https://api.mercadopago.com/preapproval/search?payer_email=${encodeURIComponent(sub.customer_email)}` : null,
        ].filter(Boolean);
        for (const url of queries) {
          try {
            const r = await fetchWithTimeout(url, { headers }, 8000);
            const s = await r.json().catch(() => ({}));
            const authorized = (s?.results || []).find(p => p.status === "authorized");
            if (authorized) {
              linkedPreapproval = authorized;
              nextChargeAt = authorized.next_payment_date || nextChargeAt;
              break;
            }
          } catch (_) {}
        }
      }

      await subRef.update({
        status: "active",
        ...(linkedPreapproval ? { mp_preapproval_id: linkedPreapproval.id, mp_preapproval_status: "authorized" } : {}),
        ...(nextChargeAt ? { next_charge_at: nextChargeAt } : {}),
        cancelled_at: null,
        updated_at: nowIso(),
      });

      return res.json({
        ok: true,
        status: "active",
        mp_preapproval_id: linkedPreapproval?.id || sub.mp_preapproval_id || null,
        mp_preapproval_linked: !!linkedPreapproval,
        next_charge_at: nextChargeAt,
      });
    }

    const mpStatusMap = { pause: "paused", resume: "authorized", cancel: "cancelled" };
    const newMpStatus = mpStatusMap[action];

    // Sincronizar con MP. Antes era "best effort silencioso" — eso causó que
    // local quedara cancelled mientras MP seguía cobrando recurrencias. Ahora:
    //   - Sin mp_preapproval_id lo buscamos en MP; si no aparece y la sub ya
    //     estuvo activa → 409 (no tocamos local).
    //   - Si MP confirma el update → seguimos con cambio local.
    //   - Si MP dice "ya está en ese estado" → seguimos (idempotente).
    //   - Si MP devuelve OTRO error → ABORTAMOS y le decimos al merchant.
    let mpSynced = false;
    let preData = null;
    if (merchant.mp_access_token) {
      const preId = await ensurePreapprovalId(merchant, subRef, sub);
      if (!preId) {
        // Lead que nunca autorizó: no hay nada en MP, permitimos el cambio local.
        const neverActive = sub.status === "pending" && !sub.last_charge_at && !(sub.shopify_orders || []).length;
        if (!neverActive) {
          return res.status(409).json({ error: "No se pudo ubicar la suscripción en Mercado Pago; no se cambió el estado local" });
        }
      } else {
        try {
          await mpUpdatePreapproval(merchant.mp_access_token, preId, { status: newMpStatus });
          mpSynced = true;
        } catch (e) {
          const msg = String(e.message || "");
          // MP es idempotente sobre cancelled — si decimos "cancel" sobre algo
          // ya cancelled, devuelve error pero igual está en el estado objetivo.
          const alreadyTarget = /already|cancelled preapproval|paused preapproval|same status/i.test(msg);
          if (!alreadyTarget) {
            console.error(`[subscribers] MP update falló (${msg}). ABORT — no cambiamos local.`);
            return res.status(502).json({
              error: `Mercado Pago no confirmó el cambio: ${msg}. El sub NO se modificó localmente. Probá "Volver a sincronizar con MP" para reconciliar.`,
            });
          }
          console.warn(`[subscribers] MP ya estaba en target status (${msg}) — continuamos con cambio local.`);
          mpSynced = true;
        }
        // Releer el preapproval para guardar next_charge_at real + status MP.
        try { preData = await mpGetPreapproval(merchant.mp_access_token, preId); } catch (_) {}
      }
    }

    const localStatus = action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "active";
    const nextChargeAt = preData?.next_payment_date || null;
    const localUpdate = {
      status: localStatus,
      updated_at: nowIso(),
      ...(preData?.status ? { mp_preapproval_status: preData.status } : {}),
      ...(action !== "cancel" && nextChargeAt ? { next_charge_at: nextChargeAt } : {}),
      ...(action === "cancel" ? { cancelled_at: nowIso(), cancelled_by: "merchant" } : {}),
      ...(action === "resume" ? { cancelled_at: null } : {}),
      // Cancelar o reactivar a mano anula la reactivación automática de una pausa por retención.
      ...(action === "cancel" || action === "resume" ? { resume_at: FieldValue.delete() } : {}),
    };
    await subRef.update(localUpdate);

    // Klaviyo: Subscription Cancelled / Paused / Resumed (best-effort, nunca bloquea).
    if (klaviyoEnabled(merchant)) {
      try {
        const metric = action === "cancel" ? KLAVIYO_METRICS.CANCELLED : action === "pause" ? KLAVIYO_METRICS.PAUSED : KLAVIYO_METRICS.RESUMED;
        await klaviyoLifecycle(merchant, merchantId, metric, String(id), { ...sub, ...localUpdate }, {
          uniqueSuffix: localUpdate.updated_at, nextChargeAt: action !== "cancel" && nextChargeAt ? nextChargeAt : undefined, properties: { source: "dashboard" },
        });
      } catch (e) { console.warn("[subscribers] klaviyo falló:", e.message); }
    }

    // Mail de cancelación (best-effort) + log.
    if (action === "cancel" && sub.customer_email) {
      let r = null;
      try {
        const { emailSubscriptionCancelled } = await import("./_lib/email.js");
        r = await emailSubscriptionCancelled({
          to: sub.customer_email,
          customerName: sub.customer_name || "",
          productTitle: sub.plan_snapshot?.product_title || "tu suscripción",
          merchant,
        });
      } catch (e) { r = { error: e.message }; }
      await logEmail(merchantId, {
        type: "cancellation", subscriber_id: String(id), to: sub.customer_email,
        customer_name: sub.customer_name || null, product_title: sub.plan_snapshot?.product_title || null,
        status: r?.error ? "error" : (r?.skipped ? "skipped" : "sent"), error: r?.error || null,
      });
    }

    return res.json({ ok: true, status: localStatus, mp_synced: mpSynced, next_charge_at: nextChargeAt || sub.next_charge_at || null, mp_preapproval_status: preData?.status || null });
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
