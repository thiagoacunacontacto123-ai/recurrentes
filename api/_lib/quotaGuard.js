// Firestore respondiendo "8 RESOURCE_EXHAUSTED: Quota exceeded" = toda la plataforma caída
// (panel, checkout, webhooks). Pasó el 9-oct-2026 y nos enteramos porque Thiago vio el
// panel: la cuenta de facturación de Google estaba en mora y Google frenó en la cuota
// gratis en vez de cobrar. Esto avisa al admin UNA vez por día sin necesitar leer la base
// (el dedup de notifyAdmin es un create(), y las escrituras siguen andando).
const arDay = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

export function isQuotaError(e) {
  if (!e) return false;
  if (Number(e.code) === 8) return true;
  return /RESOURCE_EXHAUSTED|Quota exceeded/i.test(String(e.message || e));
}

// Devuelve true si era un error de cuota (y disparó el aviso). Nunca lanza.
export async function reportQuotaExhausted(where, e) {
  if (!isQuotaError(e)) return false;
  console.error(`[quota] Firestore RESOURCE_EXHAUSTED en ${where}: la plataforma no puede leer la base`);
  try {
    const { notifyAdmin } = await import("./adminAlerts.js");
    await notifyAdmin("firestore_quota", {
      merchantId: "system",
      store: "Recurrentes (toda la plataforma)",
      detail: `Firestore rechaza las lecturas ("Quota exceeded", visto en ${where}). Panel, checkout y webhooks caídos hasta que Google vuelva a cobrar en vez de frenar. Revisar: console.cloud.google.com/billing (pago vencido o tarjeta inválida) o la cuota de la API de Firestore.`,
      key: arDay(),
    });
  } catch (err) { console.warn("[quota] no pude avisar:", err?.message); }
  return true;
}
