// /api/cron — endpoint para Vercel Cron Jobs. Lo configuramos en vercel.json
// para que se dispare cada X minutos automáticamente, sin requerir acción
// del merchant ni del cliente.
//
// ?action=sync-all-pending  — iterar todos los merchants, sincronizar todos
//                              sus subscribers en estado "pending" con MP.
//                              Procesa pagos confirmados y crea órdenes Shopify.
//
// Vercel Cron acepta requests SOLO si el header Authorization matchea el
// CRON_SECRET configurado en vercel.json (se inyecta automático). En dev/local
// permitimos sin auth para poder testear con curl.
import { db } from "./_lib/firebase.js";
import { syncSubscriber } from "./_lib/sync.js";

export default async function handler(req, res) {
  // Auth: aceptamos 2 formas para que el endpoint sirva tanto para Vercel
  // Cron (header) como para cron externo (query string, ej cron-job.org).
  //   1. Header Authorization: Bearer <CRON_SECRET>  ← Vercel Cron
  //   2. Query ?token=<CRON_SECRET>                  ← cron externo gratis
  // Si CRON_SECRET no está seteado (dev), permitimos sin auth para testing.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const headerOk = (req.headers.authorization || "") === `Bearer ${cronSecret}`;
    const queryOk = String(req.query.token || "") === cronSecret;
    if (!headerOk && !queryOk) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  const action = String(req.query.action || "sync-all-pending");
  if (action !== "sync-all-pending") {
    return res.status(400).json({ error: "action no reconocida" });
  }

  // Iterar todos los merchants con MP conectado.
  const merchantsSnap = await db().collection("merchants").where("mp_access_token", "!=", "").get();
  const start = Date.now();
  let merchantsProcessed = 0, subsProcessed = 0, activated = 0, errors = 0;

  const now = Date.now();
  for (const m of merchantsSnap.docs) {
    merchantsProcessed += 1;
    const merchantSubs = db().collection("merchants").doc(m.id).collection("subscribers");

    // 1) PENDINGS — la primera activación: el sub se creó, falta confirmar
    //    que MP procesó el primer cobro y bajó el preapproval real.
    const pendings = await merchantSubs.where("status", "==", "pending").get();
    for (const subDoc of pendings.docs) {
      const created = subDoc.data().created_at ? new Date(subDoc.data().created_at).getTime() : 0;
      if (now - created < 60 * 1000) continue;  // muy reciente, esperar al próximo tick

      try {
        const r = await syncSubscriber(m.id, subDoc.id);
        subsProcessed += 1;
        if (r.status === "active") activated += 1;
      } catch (e) {
        errors += 1;
        console.error(`[cron] sync pending ${m.id}/${subDoc.id}:`, e.message);
      }
    }

    // 2) ACTIVAS VENCIDAS — safety net por si el webhook MP no llega. Si
    //    `next_charge_at` ya pasó (MP debería haber cobrado hace rato),
    //    sincronizamos para procesar el cobro nuevo + crear orden Shopify.
    //    Esto cubre el caso de los cobros mensuales 2, 3, N — el evento
    //    primario es el webhook MP, pero si MP falla en notificar, este
    //    cron lo levanta dentro de 1 hora.
    const actives = await merchantSubs.where("status", "==", "active").get();
    for (const subDoc of actives.docs) {
      const data = subDoc.data();
      const nextChargeMs = data.next_charge_at ? new Date(data.next_charge_at).getTime() : 0;
      // Sólo procesamos si next_charge ya pasó hace al menos 5min (margen).
      // Si no tiene next_charge_at, lo skippeamos (estado raro).
      if (!nextChargeMs || nextChargeMs > now - 5 * 60 * 1000) continue;

      try {
        const r = await syncSubscriber(m.id, subDoc.id);
        subsProcessed += 1;
        if (r.charges_processed > 0) activated += 1;
      } catch (e) {
        errors += 1;
        console.error(`[cron] sync active ${m.id}/${subDoc.id}:`, e.message);
      }
    }
  }

  const elapsed = Date.now() - start;
  console.log(`[cron] sync-all-pending: ${merchantsProcessed} merchants, ${subsProcessed} subs, ${activated} activadas, ${errors} errores (${elapsed}ms)`);
  return res.json({
    ok: true,
    merchants_processed: merchantsProcessed,
    subs_processed: subsProcessed,
    activated,
    errors,
    elapsed_ms: elapsed,
  });
}
