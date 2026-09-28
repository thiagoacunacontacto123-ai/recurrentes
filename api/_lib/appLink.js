// Link de acceso único del comercio (28-sept-2026, Thiago: "que cada tienda tenga su link de
// login único en su app de Shopify, así desde Shopify siempre ven su Recurrentes").
//
// `merchants/{mid}.app_link_key` es una clave larga y aleatoria. La URL
// https://www.recurrentesapp.com/#/entrar?m=<mid>&k=<clave> se pega como "App URL" en la
// app privada de Shopify (o en un favorito) y abre el panel YA LOGUEADO: el navegador
// canjea la clave por un token de Firebase (`public?action=app-login`) y entra como el
// dueño de la tienda. Quien tenga el link entra: por eso se genera por tienda, se puede
// regenerar cuando se quiera (la anterior deja de servir) y nunca va en mails masivos.
import crypto from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { db, clearMerchantCache } from "./firebase.js";
import { appBaseUrl } from "./config.js";

const newKey = () => crypto.randomBytes(24).toString("hex");
export const appLinkUrl = (mid, key) => `${appBaseUrl().replace(/\/$/, "")}/#/entrar?m=${encodeURIComponent(mid)}&k=${encodeURIComponent(key)}`;

// Devuelve la URL; si la tienda todavía no tiene clave, la crea. `reset` la regenera.
export async function ensureAppLink(mid, { reset = false } = {}) {
  const ref = db().collection("merchants").doc(String(mid));
  const snap = await ref.get();
  if (!snap.exists) return null;
  let key = snap.data()?.app_link_key;
  if (reset || typeof key !== "string" || key.length < 32) {
    key = newKey();
    await ref.set({ app_link_key: key, app_link_created_at: new Date().toISOString() }, { merge: true });
    clearMerchantCache(String(mid));
  }
  return { url: appLinkUrl(String(mid), key), created_at: snap.data()?.app_link_created_at || null };
}

// Canje: { m, k } → token de Firebase para el DUEÑO de la tienda, o null.
export async function appLoginToken({ m, k } = {}) {
  const mid = String(m || "").trim(), key = String(k || "").trim();
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(mid) || !/^[a-f0-9]{48}$/.test(key)) return null;
  const snap = await db().collection("merchants").doc(mid).get();
  if (!snap.exists) return null;
  const d = snap.data() || {};
  const real = String(d.app_link_key || "");
  if (real.length !== key.length || !crypto.timingSafeEqual(Buffer.from(real), Buffer.from(key))) return null;
  if (d.deleted === true || d.archived_at) return null;
  const uid = d.ownerUid || mid;   // tienda extra → entra el dueño del login; principal → ella misma
  const token = await getAuth().createCustomToken(uid, { rec_app_link: mid });
  return { token, merchant_id: mid, uid };
}
