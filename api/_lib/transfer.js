// Transferir una tienda a OTRA cuenta (otro login, otro email).
//
// Se usa desde /api/merchant (sin funciones nuevas), ANTES de requireMerchant:
// cada acción hace su propia autenticación.
//   POST ?action=transfer-start   { merchant_id, email, keep_access }  (solo el DUEÑO real)
//   POST ?action=transfer-cancel  { merchant_id }                       (solo el DUEÑO real)
//   GET  ?action=transfer-info    &t=<token>   (con o sin sesión; la página #/transferir)
//   POST ?action=transfer-accept  { t }        (login con el MISMO email, verificado)
//   POST ?action=transfer-decline { t }        (login con el MISMO email)
//
// Datos:
//   store_transfers/{sha256(token)}  → { merchant_id, from_uid, from_email, to_email,
//       keep_access, status: pending|accepted|declined|cancelled|expired,
//       created_at, expires_at, events[] }. El token crudo NUNCA se guarda.
//   merchants/{mid}.transfer_pending → { id, to_email, keep_access, created_at,
//       expires_at, by_uid, by_email } (una sola activa por tienda; el panel la muestra).
//   audit_log/{auto}                 → un registro por evento (solo Admin SDK).
//
// Aceptar (transacción): ownerUid/ownerEmail/email = la cuenta nueva; teamMembers
// y teamUids se reescriben (el dueño anterior queda como miembro con TODAS las
// secciones o sale, según eligió); el resto del equipo, planes, suscriptores,
// cobros, tokens de Shopify/MP, billing y plan quedan en la tienda (mismo id →
// widget, webhooks de MP y external_reference siguen andando).
//
// Tienda PRINCIPAL (merchants/{uid} sin ownerUid, caso Lumina): el doc se queda
// con su id (re-keyear rompería el camino del cobro) y recibe ownerUid = nuevo
// dueño. Ese doc era además el PERFIL del login original: sus campos de perfil
// (stores[], active_merchant_id) se mudan a profiles/{uid}. El login original
// queda SIN tienda (no se le crea una automáticamente): el panel le muestra
// "tu tienda fue transferida" y puede crear otra o entrar a las que tenga.
// getOrCreateMerchant nunca recrea ni pisa ese doc (existe).
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, requireUser, optionalUser, clearMerchantCache, getOrCreateMerchant } from "./firebase.js";
import { sha256hex } from "./token.js";
import { rateLimit, clientIp } from "./ratelimit.js";
import { appBaseUrl } from "./config.js";
import { emailStoreTransfer, emailStoreTransferResult } from "./email.js";

export const TRANSFER_TTL_DAYS = 7;
const CANONICAL_URL = "https://www.recurrentesapp.com";
const COL = "store_transfers";
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const emailLower = (v) => String(v || "").trim().toLowerCase();
const iso = (ms) => new Date(ms).toISOString();
const fail = (status, message, code) => Object.assign(new Error(message), { status, code });

export const transferTokenId = (token) => sha256hex(`store-transfer:${token}`);
export function transferAcceptUrl(token) {
  return `${appBaseUrl() || CANONICAL_URL}/#/transferir?t=${encodeURIComponent(token)}`;
}
// "thiago@gmail.com" → "th***@gmail.com"
export function maskEmail(e) {
  const [u, d] = emailLower(e).split("@");
  if (!u || !d) return "";
  return `${u.slice(0, Math.min(2, u.length))}***@${d}`;
}
// Dueño REAL de la tienda: ownerUid, o el propio id si falta (caso clásico).
export const trueOwnerUid = (mid, d) => String(d?.ownerUid || mid);

const merchants = () => db().collection("merchants");
const transfers = () => db().collection(COL);
const profiles = () => db().collection("profiles");

// Resumen de la transferencia pendiente para el panel del dueño.
export function publicPending(p, now = Date.now()) {
  if (!p || !p.id) return null;
  return {
    to_email: p.to_email || "",
    keep_access: p.keep_access === true,
    created_at: p.created_at || null,
    expires_at: p.expires_at || null,
    expired: !(Date.parse(p.expires_at) > now),
  };
}

// Registro de auditoría. Nunca lanza.
async function audit(ev) {
  try { await db().collection("audit_log").add({ ...ev, at: new Date().toISOString(), area: "store_transfer" }); }
  catch (e) { console.warn("[transfer] audit:", e.message); }
}

/**
 * Patch de la tienda al aceptar (puro, testeable). Devuelve { storePatch, profilePatch }.
 * `secciones` = ids de TODAS las secciones del panel (el dueño anterior que se queda
 * como miembro las recibe todas en true).
 */
export function buildAcceptPatch(sid, d, { newUid, newEmail, newName = "", oldUid, oldEmail = "", keep = false, secciones = [], now }) {
  const members = { ...((d.teamMembers && typeof d.teamMembers === "object") ? d.teamMembers : {}) };
  const oldName = members[oldUid]?.name || d.displayName || "";
  delete members[oldUid];
  members[newUid] = { email: newEmail, name: members[newUid]?.name || newName || "", role: "owner", secciones: {}, since: now };
  if (keep) members[oldUid] = { email: oldEmail || "", name: oldName, role: "member", secciones: Object.fromEntries(secciones.map(s => [s, true])), since: now };
  const team = (Array.isArray(d.teamUids) ? d.teamUids.map(String) : []).filter(u => u !== oldUid && u !== newUid);
  team.push(newUid);
  if (keep) team.push(oldUid);

  const storePatch = {
    ownerUid: newUid,
    ownerEmail: newEmail,
    email: newEmail, // los mails/avisos "al dueño" van a la cuenta nueva
    teamMembers: members,
    teamUids: team,
    is_store: sid !== newUid, // deja de ser "principal" salvo que vuelva a su login original
    transfer_pending: FieldValue.delete(),
    transferred_at: now,
    transferred_from_uid: oldUid,
    transferred_to_uid: newUid,
    updated_at: now,
  };
  // Si la cuenta nueva tenía una invitación pendiente a esta tienda, ya no hace falta.
  if (Array.isArray(d.teamInvites)) storePatch.teamInvites = d.teamInvites.filter(i => emailLower(i?.email) !== newEmail);
  if (Array.isArray(d.teamInviteEmails)) storePatch.teamInviteEmails = d.teamInviteEmails.filter(e => emailLower(e) !== newEmail);

  let profilePatch = null;
  if (sid === oldUid) {
    // Tienda PRINCIPAL del login anterior: sus campos de perfil se mudan a profiles/{oldUid}.
    storePatch.stores = FieldValue.delete();
    storePatch.active_merchant_id = FieldValue.delete();
    profilePatch = {
      uid: oldUid,
      email: oldEmail || null,
      stores: (Array.isArray(d.stores) ? d.stores : []).filter(s => s && s.id && s.id !== sid),
      active_merchant_id: d.active_merchant_id && d.active_merchant_id !== sid ? d.active_merchant_id : null,
      primary_transferred: { merchant_id: sid, to_uid: newUid, to_email: newEmail, at: now, kept_access: keep },
      updated_at: now,
    };
  }
  return { storePatch, profilePatch };
}

// ─── Router ────────────────────────────────────────────────────────────────
export async function transferApi(req, res, deps = {}) {
  const action = String(req.query?.action || "");
  try {
    if (action === "transfer-info")    return await info(req, res);
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    if (action === "transfer-start")   return await start(req, res, deps);
    if (action === "transfer-cancel")  return await cancel(req, res);
    if (action === "transfer-accept")  return await accept(req, res, deps);
    if (action === "transfer-decline") return await decline(req, res);
    return res.status(400).json({ error: "action no reconocida" });
  } catch (e) {
    if (res.headersSent) return;
    return res.status(e.status || 500).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
}

// POST ?action=transfer-start { merchant_id, email, keep_access }
async function start(req, res, deps) {
  const u = await requireUser(req, res); if (!u) return;
  const uid = u.uid, myEmail = emailLower(u.email);
  const b = req.body || {};
  const mid = String(b.merchant_id || "").trim();
  const to = emailLower(b.email);
  const keep = b.keep_access === true;
  if (!mid) throw fail(400, "Falta merchant_id");
  if (!EMAIL_RE.test(to) || to.length > 200) throw fail(400, "Poné un email válido.");
  if (to === myEmail) throw fail(400, "Ese es tu propio email. Poné el de la cuenta que va a recibir la tienda.");
  const rl = await rateLimit(`transfer-start:${uid}`, { limit: 10, windowSec: 86400 });
  if (!rl.ok) throw fail(429, "Hiciste muchos intentos hoy. Probá de nuevo mañana.");

  const ref = merchants().doc(mid);
  const token = crypto.randomBytes(32).toString("base64url");
  const id = transferTokenId(token);
  const nowMs = Date.now();
  const created_at = iso(nowMs), expires_at = iso(nowMs + TRANSFER_TTL_DAYS * 86400000);
  const pending = { id, to_email: to, keep_access: keep, created_at, expires_at, by_uid: uid, by_email: myEmail || null };
  const nameOf = deps.storeName || ((d) => d?.store_name || d?.shopify_shop || "Mi tienda");
  let storeName = "", replaced = null;
  await db().runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw fail(404, "No encontramos esa tienda.");
    const d = s.data() || {};
    if (d.deleted === true) throw fail(400, "Esta tienda está eliminada.");
    if (trueOwnerUid(mid, d) !== uid) throw fail(403, "Solo el dueño de la tienda puede transferirla.");
    const p = d.transfer_pending;
    if (p?.id && Date.parse(p.expires_at) > nowMs) throw fail(409, `Ya hay una transferencia pendiente a ${p.to_email}. Cancelala antes de iniciar otra.`, "transfer_pending");
    storeName = nameOf(d);
    if (p?.id) { replaced = p.id; tx.set(transfers().doc(p.id), { status: "expired", closed_at: created_at }, { merge: true }); }
    tx.create(transfers().doc(id), {
      merchant_id: mid, from_uid: uid, from_email: myEmail || null, to_email: to, keep_access: keep,
      status: "pending", created_at, expires_at, store_name: storeName, is_primary: d.is_store !== true,
      events: [{ type: "created", at: created_at, by: uid }],
    });
    tx.update(ref, { transfer_pending: pending });
  });
  clearMerchantCache(mid);
  await audit({ type: "transfer_started", merchant_id: mid, transfer_id: id, actor_uid: uid, actor_email: myEmail || null, to_email: to, keep_access: keep, replaced_expired: replaced, ip: clientIp(req) });

  const url = transferAcceptUrl(token);
  const mail = await emailStoreTransfer({ to, fromEmail: myEmail, storeName, acceptUrl: url, expiresAt: expires_at });
  const sent = mail?.ok === true;
  // Si el mail no salió, le damos el link al dueño para que se lo pase a mano
  // (igual hace falta entrar con el email destino para aceptar).
  return res.json({ ok: true, transfer: publicPending(pending), mail: sent ? "enviado" : "no_enviado", ...(sent ? {} : { accept_url: url }) });
}

// POST ?action=transfer-cancel { merchant_id }
async function cancel(req, res) {
  const u = await requireUser(req, res); if (!u) return;
  const uid = u.uid;
  const mid = String(req.body?.merchant_id || "").trim();
  if (!mid) throw fail(400, "Falta merchant_id");
  const ref = merchants().doc(mid);
  const now = new Date().toISOString();
  let tid = null;
  await db().runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists) throw fail(404, "No encontramos esa tienda.");
    const d = s.data() || {};
    if (trueOwnerUid(mid, d) !== uid) throw fail(403, "Solo el dueño de la tienda puede cancelar la transferencia.");
    const p = d.transfer_pending;
    if (!p?.id) throw fail(404, "No hay ninguna transferencia pendiente para esta tienda.", "no_pending");
    tid = p.id;
    const trRef = transfers().doc(p.id);
    const tr = await tx.get(trRef);
    tx.update(ref, { transfer_pending: FieldValue.delete() });
    if (tr.exists && tr.data()?.status === "pending") {
      tx.set(trRef, { status: "cancelled", closed_at: now, events: FieldValue.arrayUnion({ type: "cancelled", at: now, by: uid }) }, { merge: true });
    }
  });
  clearMerchantCache(mid);
  await audit({ type: "transfer_cancelled", merchant_id: mid, transfer_id: tid, actor_uid: uid, actor_email: emailLower(u.email) || null, ip: clientIp(req) });
  return res.json({ ok: true });
}

// Lee la transferencia del token + estado efectivo (vencida / reemplazada).
async function loadTransfer(token) {
  if (!TOKEN_RE.test(token)) return null;
  const id = transferTokenId(token);
  const snap = await transfers().doc(id).get();
  if (!snap.exists) return null;
  const tr = snap.data() || {};
  let status = tr.status || "pending";
  if (status === "pending") {
    if (!(Date.parse(tr.expires_at) > Date.now())) status = "expired";
    else {
      const m = (await merchants().doc(tr.merchant_id).get()).data() || {};
      if (m.deleted === true || m.transfer_pending?.id !== id) status = "cancelled";
    }
  }
  return { id, tr, status };
}

// GET ?action=transfer-info&t=<token> — con o sin sesión. Sin sesión el email
// destino va enmascarado (el link igual solo le llegó a esa casilla).
async function info(req, res) {
  const rl = await rateLimit(`transfer-info:${clientIp(req)}`, { limit: 60, windowSec: 3600 });
  if (!rl.ok) throw fail(429, "Demasiados intentos. Esperá un rato y probá de nuevo.");
  const token = String(req.query?.t || "").trim();
  const t = await loadTransfer(token);
  if (!t) throw fail(404, "El link no es válido. Pedile a quien te pasa la tienda que te mande uno nuevo.", "invalid");
  const u = await optionalUser(req);
  const myEmail = u ? emailLower(u.email) : "";
  const match = u ? myEmail === t.tr.to_email : null;
  return res.json({
    ok: true,
    status: t.status,
    store_name: t.tr.store_name || "una tienda",
    from_email: t.tr.from_email || null,
    to_email: match ? t.tr.to_email : maskEmail(t.tr.to_email),
    keep_access: t.tr.keep_access === true,
    is_primary: t.tr.is_primary === true,
    expires_at: t.tr.expires_at || null,
    logged_in: !!u,
    your_email: u ? (u.email || null) : null,
    email_match: match,
    email_verified: u ? u.email_verified === true : null,
  });
}

const STATUS_MSG = {
  accepted: "Esta transferencia ya fue aceptada.",
  declined: "Esta transferencia fue rechazada.",
  cancelled: "Esta transferencia fue cancelada por el dueño de la tienda.",
  expired: "Esta transferencia venció. Pedile al dueño que te mande una nueva.",
};

// POST ?action=transfer-accept { t }
async function accept(req, res, deps) {
  const u = await requireUser(req, res); if (!u) return;
  const uid = u.uid, email = emailLower(u.email);
  const token = String(req.body?.t || "").trim();
  if (!TOKEN_RE.test(token)) throw fail(404, "El link no es válido.", "invalid");
  const rl = await rateLimit(`transfer-accept:${uid}`, { limit: 20, windowSec: 3600 });
  if (!rl.ok) throw fail(429, "Demasiados intentos. Esperá un rato y probá de nuevo.");
  const id = transferTokenId(token);
  const trRef = transfers().doc(id);
  const now = new Date().toISOString();
  let done = null;
  await db().runTransaction(async tx => {
    // Todas las lecturas antes de las escrituras (regla de Firestore).
    const trSnap = await tx.get(trRef);
    if (!trSnap.exists) throw fail(404, "El link no es válido.", "invalid");
    const tr = trSnap.data() || {};
    const sid = String(tr.merchant_id || "");
    const sRef = merchants().doc(sid);
    const sSnap = await tx.get(sRef);
    const backHome = sid === uid; // la tienda vuelve al login cuyo uid es su id
    const homeProf = backHome ? await tx.get(profiles().doc(uid)) : null;

    if (tr.status !== "pending") throw fail(409, STATUS_MSG[tr.status] || "Esta transferencia ya no está disponible.", tr.status || "closed");
    if (!(Date.parse(tr.expires_at) > Date.now())) throw fail(410, STATUS_MSG.expired, "expired");
    if (!email || email !== tr.to_email) throw fail(403, `Esta transferencia es para ${maskEmail(tr.to_email)}. Entraste con ${email || "otra cuenta"}: cerrá sesión y entrá con ese email.`, "email_mismatch");
    if (u.email_verified !== true) throw fail(403, "Verificá tu email antes de aceptar la tienda. Te mandamos un link a tu casilla.", "email_unverified");
    if (!sSnap.exists) throw fail(404, "La tienda ya no existe.", "store_missing");
    const d = sSnap.data() || {};
    if (d.deleted === true) throw fail(410, "La tienda fue eliminada.", "store_deleted");
    if (d.transfer_pending?.id !== id) throw fail(409, STATUS_MSG.cancelled, "cancelled");
    const oldUid = trueOwnerUid(sid, d);
    if (oldUid !== tr.from_uid) throw fail(409, "La tienda cambió de dueño desde que te mandaron el link. Pedí uno nuevo.", "owner_changed");
    if (oldUid === uid) throw fail(400, "Ya sos el dueño de esta tienda.", "same_owner");

    const { storePatch, profilePatch } = buildAcceptPatch(sid, d, {
      newUid: uid, newEmail: email, newName: u.name || "", oldUid, oldEmail: tr.from_email || "",
      keep: tr.keep_access === true, secciones: deps.secciones || [], now,
    });
    if (backHome) {
      // Vuelve a ser su doc de perfil: recupera la tienda activa / cache guardados en profiles/{uid}.
      const hp = homeProf?.exists ? (homeProf.data() || {}) : {};
      storePatch.active_merchant_id = hp.active_merchant_id || sid;
      if (Array.isArray(hp.stores)) storePatch.stores = hp.stores.filter(s => s && s.id && s.id !== sid);
      if (homeProf?.exists) tx.set(profiles().doc(uid), { primary_transferred: FieldValue.delete(), returned_at: now }, { merge: true });
    }
    tx.update(sRef, storePatch);
    if (profilePatch) tx.set(profiles().doc(oldUid), profilePatch, { merge: true });
    tx.update(trRef, { status: "accepted", accepted_at: now, accepted_by_uid: uid, closed_at: now, events: FieldValue.arrayUnion({ type: "accepted", at: now, by: uid }) });
    done = { sid, oldUid, tr, storeName: tr.store_name || "tu tienda" };
  });
  clearMerchantCache(done.sid);
  await audit({ type: "transfer_accepted", merchant_id: done.sid, transfer_id: id, actor_uid: uid, actor_email: email, from_uid: done.oldUid, keep_access: done.tr.keep_access === true, ip: clientIp(req) });

  // Tienda activa de la cuenta nueva = la recibida (en su perfil; nunca en un doc ajeno).
  if (done.sid !== uid) {
    try {
      const mine = await getOrCreateMerchant(uid, email);
      const moved = mine?.ownerUid && mine.ownerUid !== uid;
      await (moved ? profiles().doc(uid) : merchants().doc(uid)).set({ active_merchant_id: done.sid }, { merge: true });
    } catch (e) { console.warn("[transfer] active_merchant_id:", e.message); }
  }
  if (done.tr.from_email) {
    await emailStoreTransferResult({ to: done.tr.from_email, kind: "accepted", storeName: done.storeName, toEmail: email, keptAccess: done.tr.keep_access === true });
  }
  return res.json({ ok: true, merchant_id: done.sid, store_name: done.storeName });
}

// POST ?action=transfer-decline { t }
async function decline(req, res) {
  const u = await requireUser(req, res); if (!u) return;
  const uid = u.uid, email = emailLower(u.email);
  const token = String(req.body?.t || "").trim();
  if (!TOKEN_RE.test(token)) throw fail(404, "El link no es válido.", "invalid");
  const id = transferTokenId(token);
  const trRef = transfers().doc(id);
  const now = new Date().toISOString();
  let done = null;
  await db().runTransaction(async tx => {
    const trSnap = await tx.get(trRef);
    if (!trSnap.exists) throw fail(404, "El link no es válido.", "invalid");
    const tr = trSnap.data() || {};
    const sRef = merchants().doc(String(tr.merchant_id || ""));
    const sSnap = await tx.get(sRef);
    if (tr.status !== "pending") throw fail(409, STATUS_MSG[tr.status] || "Esta transferencia ya no está disponible.", tr.status || "closed");
    if (!email || email !== tr.to_email) throw fail(403, `Esta transferencia es para ${maskEmail(tr.to_email)}. Entrá con ese email para responderla.`, "email_mismatch");
    if (sSnap.exists && sSnap.data()?.transfer_pending?.id === id) tx.update(sRef, { transfer_pending: FieldValue.delete() });
    tx.update(trRef, { status: "declined", declined_at: now, closed_at: now, events: FieldValue.arrayUnion({ type: "declined", at: now, by: uid }) });
    done = { sid: tr.merchant_id, tr };
  });
  clearMerchantCache(done.sid);
  await audit({ type: "transfer_declined", merchant_id: done.sid, transfer_id: id, actor_uid: uid, actor_email: email, ip: clientIp(req) });
  if (done.tr.from_email) {
    await emailStoreTransferResult({ to: done.tr.from_email, kind: "declined", storeName: done.tr.store_name, toEmail: email });
  }
  return res.json({ ok: true });
}
