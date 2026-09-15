// Acciones del panel para las credenciales de pasarelas alternativas (Mobbex hoy).
// Las enchufa api/merchant.js:
//   PATCH|POST /api/merchant?action=save-mobbex        { access_token, api_key?, test? }  (solo dueño)
//   PATCH|POST /api/merchant?action=disconnect-mobbex                                  (solo dueño)
//   GET  /api/merchant → ...mobbexSafeFields(merchant)   (flags, NUNCA las claves)
import { FieldValue } from "firebase-admin/firestore";
import { db, clearMerchantCache } from "../firebase.js";
import { getEnabledProvider, providerFlagOn } from "./index.js";

export function mobbexSafeFields(merchant) {
  const m = merchant || {};
  const connected = !!(m.mobbex_access_token && (m.mobbex_api_key || process.env.MOBBEX_API_KEY));
  return {
    mobbex_available: providerFlagOn("mobbex"),              // env MOBBEX_ENABLED=1
    mobbex_platform_key: !!process.env.MOBBEX_API_KEY,         // Recurrentes tiene app propia: el comerciante solo pega su Access Token
    mobbex_connected: connected,
    mobbex_test: m.mobbex_test === true,
    mobbex_connected_at: connected ? (m.mobbex_connected_at || null) : null,
    mobbex_last_error: connected ? (m.mobbex_last_error || null) : null,
    mobbex_last_error_at: connected ? (m.mobbex_last_error_at || null) : null,
  };
}

export async function saveMobbex(merchantId, req, res) {
  const adapter = await getEnabledProvider("mobbex");
  if (!adapter) return res.status(400).json({ error: "Mobbex todavía no está disponible." });
  const accessToken = String(req.body?.access_token || "").trim();
  const apiKey = String(req.body?.api_key || "").trim();
  const test = req.body?.test === true;
  if (!accessToken) return res.status(400).json({ error: "Pegá tu Access Token de Mobbex" });
  if (!apiKey && !process.env.MOBBEX_API_KEY) return res.status(400).json({ error: "Pegá tu API Key de Mobbex" });
  if (accessToken.length > 300 || apiKey.length > 300) return res.status(400).json({ error: "Esa clave es demasiado larga" });

  const v = await adapter.testCredentials({ access_token: accessToken, ...(apiKey ? { api_key: apiKey } : {}) });
  if (!v?.ok) return res.status(400).json({ error: v?.error || "Mobbex no aceptó las credenciales" });

  const now = new Date().toISOString();
  try {
    await db().collection("merchants").doc(merchantId).set({
      mobbex_access_token: accessToken,
      mobbex_api_key: apiKey ? apiKey : FieldValue.delete(),
      mobbex_test: test,
      mobbex_connected_at: now,
      mobbex_disconnected_at: null,
      mobbex_last_error: null, mobbex_last_error_at: null,
      updated_at: now,
    }, { merge: true });
    clearMerchantCache(merchantId);
    return res.json({ ok: true, mobbex_connected: true, mobbex_test: test, mobbex_connected_at: now });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

// Desvincular funciona aunque el flag esté apagado (el comerciante tiene que poder borrar sus claves).
export async function disconnectMobbex(merchantId, res) {
  try {
    await db().collection("merchants").doc(merchantId).set({
      mobbex_access_token: FieldValue.delete(),
      mobbex_api_key: FieldValue.delete(),
      mobbex_last_error: FieldValue.delete(), mobbex_last_error_at: FieldValue.delete(),
      mobbex_disconnected_at: new Date().toISOString(),
    }, { merge: true });
    clearMerchantCache(merchantId);
    return res.json({ ok: true, mobbex_connected: false });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
