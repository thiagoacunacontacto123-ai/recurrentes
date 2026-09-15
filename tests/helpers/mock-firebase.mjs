// Reemplazo de api/_lib/firebase.js en los tests (lo inyecta hooks.mjs).
//
// `export *` del módulo REAL (con ?real para que el hook no lo redirija): si otro
// agente agrega exports nuevos a firebase.js, los módulos que los importen siguen
// cargando. Lo que se usa en el camino del cobro se pisa acá abajo con versiones
// que apuntan al Firestore en memoria (los exports locales ganan sobre `export *`).
// Nada de acá toca la red ni credenciales.
export * from "../../api/_lib/firebase.js?real";
import { fakeDb } from "./fake-firestore.mjs";

export const __isTestMock = true;
export function initAdmin() { return { name: "[fake-firebase-admin]" }; }
export function db() { return fakeDb; }
export function clearMerchantCache() {}

// Auth de prueba: header `Authorization: Bearer test:<uid>[:<email>]`.
function decode(req) {
  const raw = String(req?.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  const m = raw.match(/^test:([^:]+)(?::(.+))?$/);
  return m ? { uid: m[1], email: m[2] || null, email_verified: true } : null;
}

export async function requireAuth(req, res) {
  const d = decode(req);
  if (!d) { res.status(401).json({ error: "Falta token de auth" }); return null; }
  return d.uid;
}

export async function resolveMerchantAccess(uid, merchantId) {
  const target = String(merchantId || "").trim();
  if (!target) return { ok: false, code: 400, error: "merchant_id requerido" };
  const snap = await fakeDb.collection("merchants").doc(target).get();
  const d = snap.exists ? snap.data() : {};
  if (d.deleted === true) return { ok: false, code: 403, error: "Esta tienda está eliminada." };
  if (target === uid) return { ok: true, role: "owner" };
  if (d.ownerUid && d.ownerUid === uid) return { ok: true, role: "owner", viaOwner: true };
  const member = d.teamMembers?.[uid];
  if (member) return { ok: true, role: member.role === "owner" ? "owner" : "member", viaTeam: true, member };
  if (Array.isArray(d.teamUids) && d.teamUids.includes(uid)) return { ok: true, role: "member", viaTeam: true };
  return { ok: false, code: 403, error: "No tenés acceso a esta tienda." };
}

export async function requireMerchant(req, res, seccion) {
  const d = decode(req);
  if (!d) { res.status(401).json({ error: "Falta token de auth" }); return null; }
  const hdr = req.headers?.["x-merchant-id"];
  const merchantId = String(Array.isArray(hdr) ? hdr[0] : (hdr || "")).trim() || String(req.query?.merchant_id || "").trim() || d.uid;
  const acc = await resolveMerchantAccess(d.uid, merchantId, seccion);
  if (!acc.ok) { res.status(acc.code || 403).json({ error: acc.error, code: "merchant_forbidden" }); return null; }
  return { uid: d.uid, email: d.email, merchantId, role: acc.role, viaOwner: acc.viaOwner === true, viaTeam: acc.viaTeam === true, member: acc.member || null };
}

export async function getOrCreateMerchant(merchantId, email) {
  const ref = fakeDb.collection("merchants").doc(merchantId);
  const snap = await ref.get();
  if (snap.exists) return { id: merchantId, ...snap.data() };
  const created_at = new Date().toISOString();
  const data = { email: email || null, plan: "free", created_at, requires_email_verification: true, ownerUid: merchantId, teamUids: [merchantId], stores: [{ id: merchantId, name: "Mi tienda", color: "#10b981", role: "owner", created_at }], active_merchant_id: merchantId };
  await ref.set(data);
  return { id: merchantId, ...data };
}
