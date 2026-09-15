// Firebase Admin singleton — reusado entre invocaciones de la misma instancia
// serverless de Vercel. Inicializa con credentials del env (FIREBASE_*).
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { trialEndFrom } from "./plans_saas.js";

let app;
export function initAdmin() {
  if (app || getApps().length) {
    app = getApps()[0] || app;
    return app;
  }
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  // En Vercel el env multilínea viene con \n literales, hay que reemplazar.
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Faltan credenciales FIREBASE_* en env");
  }
  app = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return app;
}

export function db() {
  initAdmin();
  return getFirestore();
}

// Verifica el Bearer token y devuelve el token decodificado (uid, email,
// email_verified). Responde 401/403 y devuelve null si no pasa.
// Merchants nuevos (requires_email_verification) necesitan email verificado
// → 403 code "email_unverified". Los viejos siguen igual.
async function verifyBearer(req, res) {
  initAdmin();
  const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!auth) {
    res.status(401).json({ error: "Falta token de auth" });
    return null;
  }
  let decoded;
  try {
    decoded = await getAuth().verifyIdToken(auth);
  } catch (e) {
    res.status(401).json({ error: "Token inválido" });
    return null;
  }
  if (decoded.email_verified === false) {
    try {
      const snap = await db().collection("merchants").doc(decoded.uid).get();
      if (snap.exists && snap.data()?.requires_email_verification === true) {
        res.status(403).json({ error: "Verificá tu email para continuar", code: "email_unverified" });
        return null;
      }
    } catch (_) { /* si Firestore falla, no bloqueamos por esto */ }
  }
  return decoded;
}

// Verifica el Bearer token del header Authorization y devuelve el uid.
// Tira 401 si falta o es inválido — handlers deben llamar requireAuth(req,res)
// y usar el uid para scopear todas las queries de Firestore.
// (Intacto para quien solo necesite el uid del login; requireMerchant lo extiende.)
export async function requireAuth(req, res) {
  const decoded = await verifyBearer(req, res);
  return decoded ? decoded.uid : null;
}

// Como requireAuth pero devuelve el token decodificado completo ({ uid, email,
// email_verified }) — lo usa la transferencia de tiendas (_lib/transfer.js).
export async function requireUser(req, res) {
  return verifyBearer(req, res);
}

// Login OPCIONAL: token decodificado si viene un Bearer válido, null si no.
// Nunca responde nada (para endpoints que funcionan con o sin sesión).
export async function optionalUser(req) {
  const tok = (req.headers?.authorization || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try { initAdmin(); return await getAuth().verifyIdToken(tok); } catch (_) { return null; }
}

// ─── Multi-tienda ──────────────────────────────────────────────────────────
// Un PERFIL (login, uid de Firebase Auth) puede operar sobre varios MERCHANTS:
//   · merchants/{uid}      → su tienda principal (caso clásico: Lumina).
//   · merchants/m_xxx      → tiendas extra creadas por el perfil (ownerUid = uid).
//   · merchants/{otro}     → tiendas ajenas donde figura en teamMembers/teamUids.
// El front dice sobre cuál opera con el header `X-Merchant-Id` (o ?merchant_id).
// Sin header → merchantId = uid (comportamiento histórico, sin migración).

// Cache de meta de acceso por instancia caliente (60s): evita una lectura de
// Firestore por request en los endpoints que se llaman muchas veces seguidas.
const _merchantMeta = new Map(); // merchantId -> { at, exists, ownerUid, deleted, team, members }
async function merchantMeta(merchantId) {
  const hit = _merchantMeta.get(merchantId);
  if (hit && Date.now() - hit.at < 60000) return hit;
  let exists = false, ownerUid = null, deleted = false, team = [], members = {};
  try {
    const snap = await db().collection("merchants").doc(merchantId).get();
    if (snap.exists) {
      const d = snap.data() || {};
      exists = true;
      // ownerUid ausente = el doc es dueño de sí mismo (caso clásico).
      ownerUid = d.ownerUid ? String(d.ownerUid) : null;
      deleted = d.deleted === true;
      team = Array.isArray(d.teamUids) ? d.teamUids.map(String) : [];
      // Miembros con permisos POR SECCIÓN: { uid: { email, name, role, secciones:{planes:true,...} } }
      members = (d.teamMembers && typeof d.teamMembers === "object") ? d.teamMembers : {};
    }
  } catch (_) {}
  const meta = { at: Date.now(), exists, ownerUid, deleted, team, members };
  if (_merchantMeta.size > 500) _merchantMeta.clear();
  _merchantMeta.set(merchantId, meta);
  return meta;
}

/** Invalida el cache de un merchant (tras editar miembros/permisos/borrar). */
export function clearMerchantCache(merchantId) { _merchantMeta.delete(merchantId); }

/**
 * ¿Puede `uid` operar sobre `merchantId`? No responde nada: devuelve
 *   { ok:true, role:"owner"|"member", viaOwner?, viaTeam?, member? }
 *   { ok:false, code, error }
 * `seccion` (opcional): para miembros con permisos por sección exige
 * member.secciones[seccion] === true. Dueños no tienen restricción.
 */
export async function resolveMerchantAccess(uid, merchantId, seccion) {
  const target = String(merchantId || "").trim();
  if (!target) return { ok: false, code: 400, error: "merchant_id requerido" };
  const meta = await merchantMeta(target);
  // Tienda principal MOVIDA/transferida a otro perfil (merchants/{uid} con
  // ownerUid = otro): el login original ya no es dueño de su propio doc. Solo
  // sigue entrando si el nuevo dueño lo dejó como miembro del equipo (abajo).
  const movedSelf = target === uid && !!meta.ownerUid && meta.ownerUid !== uid;
  const TRANSFERRED = { ok: false, code: 403, transferred: true, error: "Esta tienda fue transferida a otra cuenta. Este usuario ya no tiene acceso." };
  if (meta.deleted) return movedSelf ? TRANSFERRED : { ok: false, code: 403, error: "Esta tienda está eliminada." };
  if (target === uid && !movedSelf) return { ok: true, role: "owner" };
  if (!meta.exists) return { ok: false, code: 403, error: "No tenés acceso a esta tienda." };
  // Perfil DUEÑO de esta tienda (multi-tienda): acceso total.
  if (meta.ownerUid && meta.ownerUid === uid) return { ok: true, role: "owner", viaOwner: true };
  const member = meta.members ? meta.members[uid] : null;
  if (member) {
    if (member.role === "owner") return { ok: true, role: "owner", viaOwner: true, member };
    // Permisos guardados con ids viejos (suscriptores/actividad/…) siguen valiendo.
    const LEGACY_OF = { suscripciones: ["suscriptores", "carritos", "abandonados"], portal: ["actividad"], configuracion: ["integraciones", "plan", "guia"] };
    const secs = member.secciones || null;
    const hasSec = !secs || Object.keys(secs).length === 0 || secs[seccion] === true || (LEGACY_OF[seccion] || []).some(k => secs[k] === true);
    if (seccion && !hasSec) {
      return { ok: false, code: 403, error: "Tu cuenta no tiene acceso a esta sección. Pedile al dueño que te la habilite desde Equipo." };
    }
    return { ok: true, role: "member", viaTeam: true, member };
  }
  if (meta.team.includes(uid)) return { ok: true, role: "member", viaTeam: true }; // legacy: acceso total
  if (movedSelf) return TRANSFERRED;
  console.warn(`[auth] ${uid} intentó operar sobre ${target}`);
  return { ok: false, code: 403, error: "No tenés acceso a esta tienda." };
}

/**
 * requireAuth + resolución del merchant activo. Devuelve
 *   { uid, email, merchantId, role, viaOwner?, viaTeam?, member? }
 * o null (ya respondió 401/403). merchantId sale de `X-Merchant-Id`,
 * `?merchant_id` o, si no viene, del uid (comportamiento histórico).
 *
 * Login cuya tienda principal fue transferida (merchants/{uid} ya es de otro)
 * y que no quedó como miembro: responde 403 con reason "store_transferred"
 * (el panel muestra "tu tienda fue transferida"). Con opts.allowNoStore
 * (acciones de PERFIL: workspace, store-create…) devuelve un ctx SIN tienda:
 * { uid, email, merchantId: null, role: null, noStore: true }.
 */
export async function requireMerchant(req, res, seccion, opts = {}) {
  const decoded = await verifyBearer(req, res);
  if (!decoded) return null;
  const uid = decoded.uid;
  const hdr = req.headers["x-merchant-id"];
  const fromHeader = String(Array.isArray(hdr) ? hdr[0] : (hdr || "")).trim();
  const fromQuery = String(req.query?.merchant_id || "").trim();
  const merchantId = fromHeader || fromQuery || uid;
  const acc = await resolveMerchantAccess(uid, merchantId, seccion);
  if (!acc.ok) {
    if (acc.transferred === true && merchantId === uid && opts.allowNoStore === true) {
      return { uid, email: decoded.email || null, merchantId: null, role: null, viaOwner: false, viaTeam: false, member: null, noStore: true };
    }
    res.status(acc.code || 403).json({ error: acc.error, code: "merchant_forbidden", ...(acc.transferred ? { reason: "store_transferred" } : {}) });
    return null;
  }
  return {
    uid,
    email: decoded.email || null,
    merchantId,
    role: acc.role,
    viaOwner: acc.viaOwner === true,
    viaTeam: acc.viaTeam === true,
    member: acc.member || null,
  };
}

// Devuelve el doc del merchant, creándolo si no existe.
// Estructura: merchants/{merchantId} = { email, displayName, plan, created_at, ... }
// Los merchants nuevos nacen con los campos multi-tienda (ownerUid = su propio
// id, teamUids, stores[], active_merchant_id). Los viejos (Lumina) no los tienen
// y todo funciona igual: ownerUid ausente = dueño de sí mismo.
// Transferencias (_lib/transfer.js): si merchants/{uid} fue transferido, el doc
// EXISTE (con ownerUid = el nuevo dueño) → acá solo se lee, nunca se recrea ni
// se pisa. El login original queda sin tienda (su perfil pasa a profiles/{uid}).
export async function getOrCreateMerchant(merchantId, email) {
  const ref = db().collection("merchants").doc(merchantId);
  const snap = await ref.get();
  if (snap.exists) return { id: merchantId, ...snap.data() };
  const created_at = new Date().toISOString();
  const data = {
    email: email || null,
    // Plan del SaaS: gratis hasta 5 suscriptores activos; después, el tramo que
    // corresponda (shared/platform/pricing.js). Ya no hay prueba con vencimiento.
    plan: "free",
    created_at,
    // Solo cuentas nuevas: exigimos verificar el mail antes de operar.
    requires_email_verification: true,
    // Multi-tienda
    ownerUid: merchantId,
    teamUids: [merchantId],
    stores: [{ id: merchantId, name: "Mi tienda", color: "#10b981", role: "owner", created_at }],
    active_merchant_id: merchantId,
  };
  await ref.set(data);
  clearMerchantCache(merchantId);
  return { id: merchantId, ...data };
}
