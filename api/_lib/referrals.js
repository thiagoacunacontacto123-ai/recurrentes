// Programa de afiliados de Recurrentes (portado de Growith, 2026-09-18).
//
// Cada CUENTA (doc del login, merchants/{uid}) tiene un código único `ref_code`.
// Quien se registra desde recurrentesapp.com/?ref=CODIGO queda vinculado
// (`ref_by` = uid del referente, solo cuentas nuevas). Cada vez que un pago del
// plan de una tienda del referido se confirma en Stripe (primer pago o
// renovación), el referente gana REF_PCT del precio de lista USD del tramo como
// crédito. El crédito se aplica como SALDO DEL CLIENTE en Stripe (balance
// transaction negativa): descuenta solo sus próximas facturas, renovaciones
// incluidas. Si el referente todavía no tiene cliente en Stripe, queda pendiente
// (`ref_credit_pending_usd`) y se empuja cuando paga por primera vez.
//
// Idempotencia: un doc por pago en merchants/{referente}/ref_ledger/pago_{key}.
// Nunca lanza desde los enganches (best-effort): un problema acá no puede romper
// el webhook de Stripe.
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase.js";
import { TIER_BY_ID } from "../../shared/platform/pricing.js";

export const REF_PCT = 0.15;
export const REF_CODE_RE = /^[A-Z0-9]{6,12}$/;
// Solo cuentas nuevas pueden vincularse (evita "referir" clientes que ya pagan).
export const REF_CLAIM_MAX_AGE_DAYS = 30;

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const nowIso = () => new Date().toISOString();
const genCode = () => Array.from(randomBytes(8)).map(b => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");
const M = (uid) => db().collection("merchants").doc(String(uid));

// Uid del LOGIN dueño de una tienda (las tiendas extra `m_…` apuntan con ownerUid).
export const ownerUidOf = (mid, m) => String(m?.ownerUid || mid);

// Comisión en USD por un pago confirmado de un tramo (precio de lista, no el monto crudo).
export function commissionUsd(tierId) {
  const usd = Number(TIER_BY_ID[tierId]?.usd) || 0;
  return r2(usd * REF_PCT);
}

// Asegura que la cuenta tenga código (lo crea la primera vez que abre Afiliados).
export async function ensureRefCode(uid) {
  const ref = M(uid);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : {};
  if (cur.ref_code) return cur.ref_code;
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const clash = await db().collection("merchants").where("ref_code", "==", code).limit(1).get();
    if (clash.empty) { await ref.set({ ref_code: code, ref_code_at: nowIso() }, { merge: true }); return code; }
  }
  throw new Error("No se pudo generar el código, reintentá.");
}

// Vincula una cuenta nueva a su referente. → { ok } | { ok:false, error }
export async function claimReferral(uid, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!REF_CODE_RE.test(code)) return { ok: false, error: "codigo_invalido" };
  const ref = M(uid);
  const d = (await ref.get()).data() || {};
  if (d.ref_by) return { ok: true, already: true };
  if (String(d.ref_code || "").toUpperCase() === code) return { ok: false, error: "codigo_propio" };
  const ageMs = Date.now() - (Date.parse(d.created_at || "") || Date.now());
  if (ageMs > REF_CLAIM_MAX_AGE_DAYS * 86400000 || d.plan_activated) return { ok: false, error: "cuenta_no_nueva" };
  const owner = await db().collection("merchants").where("ref_code", "==", code).limit(1).get();
  if (owner.empty) return { ok: false, error: "codigo_inexistente" };
  const refUid = owner.docs[0].id;
  if (refUid === uid) return { ok: false, error: "codigo_propio" };
  await ref.set({ ref_by: refUid, ref_by_at: nowIso() }, { merge: true });
  return { ok: true };
}

// Empuja a Stripe (saldo del cliente) el crédito pendiente de una cuenta que ya tiene
// customer. `stripeCall(method, path, params)` lo inyecta saasBilling (evita import circular).
export async function pushPendingCredit(uid, stripeCall) {
  const ref = M(uid);
  try {
    const d = (await ref.get()).data() || {};
    const pending = r2(d.ref_credit_pending_usd);
    const cus = d.saas_stripe_customer_id;
    if (pending <= 0 || !cus || typeof stripeCall !== "function") return { pushed: 0 };
    await stripeCall("POST", `/v1/customers/${encodeURIComponent(cus)}/balance_transactions`, { amount: -Math.round(pending * 100), currency: "usd", description: "Crédito del programa de afiliados de Recurrentes" });
    await ref.set({ ref_credit_pending_usd: 0, ref_credit_applied_usd: r2((Number(d.ref_credit_applied_usd) || 0) + pending), ref_credit_pushed_at: nowIso() }, { merge: true });
    await ref.collection("ref_ledger").doc(`push_${Date.now()}`).set({ type: "push", usd: -pending, at: nowIso() });
    return { pushed: pending };
  } catch (e) { console.warn("[referrals] push:", e.message); return { pushed: 0, error: e.message }; }
}

// Un pago del plan se confirmó para la tienda `mid` (doc `m`): acredita al referente
// del DUEÑO de esa tienda. Idempotente por `key` (id de sesión o factura de Stripe).
export async function creditCommission({ mid, merchant, tierId, key, kind = "pago", stripeCall }) {
  try {
    if (!mid || !key) return null;
    const payerUid = ownerUidOf(mid, merchant);
    const payer = payerUid === mid ? (merchant || {}) : ((await M(payerUid).get()).data() || {});
    const refUid = String(payer.ref_by || "");
    if (!refUid || refUid === payerUid) return null;
    const usd = commissionUsd(tierId);
    if (usd <= 0) return null;
    const refDoc = M(refUid);
    const ledger = refDoc.collection("ref_ledger").doc(`pago_${String(key).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)}`);
    try {
      await ledger.create({ type: "commission", kind, from_uid: payerUid, from_store: merchant?.store_name || merchant?.shopify_shop || mid, tier: tierId, usd, at: nowIso() });
    } catch (e) { if (e?.code === 6 || /already exists/i.test(e?.message || "")) return { ok: false, skipped: true, reason: "duplicate" }; throw e; }
    await refDoc.set({ ref_earned_usd: FieldValue.increment(usd), ref_credit_pending_usd: FieldValue.increment(usd), ref_last_commission_at: nowIso() }, { merge: true });
    const push = await pushPendingCredit(refUid, stripeCall);
    return { ok: true, usd, ref_uid: refUid, pushed: push?.pushed || 0 };
  } catch (e) { console.warn("[referrals] credit:", e.message); return { ok: false, error: e.message }; }
}

// Datos del panel Afiliados de una cuenta (y alta del código si no existe).
export async function referralsOverview(uid, { baseUrl = "https://www.recurrentesapp.com" } = {}) {
  const code = await ensureRefCode(uid);
  const d = (await M(uid).get()).data() || {};
  const [refs, ledgerSnap] = await Promise.all([
    db().collection("merchants").where("ref_by", "==", String(uid)).limit(200).get(),
    M(uid).collection("ref_ledger").orderBy("at", "desc").limit(40).get(),
  ]);
  const referidos = refs.docs.map(r => {
    const u = r.data() || {};
    const paga = !!u.plan_activated && u.saas_status !== "cancelled";
    return { store: u.store_name || u.shopify_shop || "Cuenta nueva", email_masked: String(u.email || "").replace(/^(.{2}).*(@.*)$/, "$1…$2"), paga, plan: paga ? (TIER_BY_ID[u.plan_activated]?.label || u.plan_activated) : null, since: u.ref_by_at || u.created_at || null };
  }).sort((a, b) => String(b.since || "").localeCompare(String(a.since || "")));
  const ledger = ledgerSnap.docs.map(l => { const x = l.data(); return { type: x.type, kind: x.kind || null, from_store: x.from_store || null, tier: x.tier || null, usd: r2(x.usd), at: x.at || null }; });
  return {
    ok: true, code, link: `${baseUrl.replace(/\/$/, "")}/?ref=${code}`, pct: Math.round(REF_PCT * 100),
    earned_usd: r2(d.ref_earned_usd), pending_usd: r2(d.ref_credit_pending_usd), applied_usd: r2(d.ref_credit_applied_usd),
    has_stripe_customer: !!d.saas_stripe_customer_id,
    referidos, activos: referidos.filter(r => r.paga).length, ledger,
  };
}
