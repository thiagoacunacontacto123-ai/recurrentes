// Guardas PURAS para el webhook de Mercado Pago (sin Firestore ni red).
// Hoy api/mp/webhook.js no las usa todavía: el cableado va como propuesta (ver
// auditoría de seguridad 2026-09-15) para no tocar el camino del cobro de Lumina.
//
// 1) Firma x-signature (https://www.mercadopago.com.ar/developers → Webhooks →
//    "Validar origen de la notificación"):
//      x-signature: "ts=<epoch>,v1=<hex>"   x-request-id: <uuid>
//      manifest = "id:<data.id de la query>;request-id:<x-request-id>;ts:<ts>;"
//      (partes ausentes se omiten; data.id alfanumérico va en minúsculas)
//      v1 = HMAC-SHA256(manifest, clave secreta de "Tus integraciones") en hex.
//    Las notificaciones que llegan al notification_url de cada preapproval
//    (?mid=&sid=, las de Lumina) pueden venir SIN firma: por eso el modo por
//    defecto es "verificar y loguear" y solo MP_WEBHOOK_ENFORCE=1 rechaza.
//
// 2) Disputas: un aviso chargeback / claim / fraud se puede falsificar (sin firma
//    el endpoint es público). Antes de pausar o CANCELAR en MP, el pago releído
//    con el token del merchant tiene que mostrar la disputa de verdad.
import crypto from "node:crypto";
import { timingSafeEqualStr } from "./token.js";

export function parseMpSignature(header) {
  const parts = {};
  for (const kv of String(header || "").split(",")) {
    const i = kv.indexOf("=");
    if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  return { ts: parts.ts || "", v1: parts.v1 || "" };
}

export function mpSignatureManifest({ dataId, requestId, ts }) {
  let m = "";
  if (dataId) {
    const id = String(dataId);
    m += `id:${/^[a-z0-9]+$/i.test(id) ? id.toLowerCase() : id};`;
  }
  if (requestId) m += `request-id:${requestId};`;
  if (ts) m += `ts:${ts};`;
  return m;
}

const hdr = (req, name) => {
  const v = req?.headers?.[name];
  return String(Array.isArray(v) ? v[0] : (v || ""));
};

/**
 * Verifica la firma de una notificación de MP. No lanza nunca.
 * Devuelve { status, stale? }:
 *   "no_secret" (sin clave cargada) · "unsigned" (sin x-signature) ·
 *   "malformed" (header sin ts/v1) · "invalid" (no coincide) · "valid".
 * `stale`: ts más viejo que `toleranceSec` (solo informativo: MP reintenta
 * notificaciones viejas y no documenta una ventana, así que no se rechaza por esto).
 */
export function checkMpSignature(req, dataId, { secret, nowMs = Date.now(), toleranceSec = 600 } = {}) {
  try {
    if (!secret) return { status: "no_secret" };
    const raw = hdr(req, "x-signature");
    if (!raw) return { status: "unsigned" };
    const { ts, v1 } = parseMpSignature(raw);
    if (!ts || !v1) return { status: "malformed" };
    const manifest = mpSignatureManifest({ dataId, requestId: hdr(req, "x-request-id"), ts });
    const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
    if (!timingSafeEqualStr(expected, v1.toLowerCase())) return { status: "invalid" };
    // ts de MP: segundos (docs) o milisegundos (algunos ejemplos). Aceptamos ambos.
    const tsNum = Number(ts);
    const tsMs = tsNum > 1e12 ? tsNum : tsNum * 1000;
    const stale = Number.isFinite(tsMs) && Math.abs(nowMs - tsMs) > toleranceSec * 1000;
    return { status: "valid", stale };
  } catch (_) {
    return { status: "malformed" };
  }
}

/**
 * ¿Rechazar? Modo por defecto (enforce falso): NUNCA rechaza, solo loguea — así
 * se puede cargar la clave y mirar los logs sin riesgo para Lumina.
 * enforce=true: rechaza todo lo que no sea "valid" (salvo "no_secret").
 */
export function mpSignatureDecision(check, enforce) {
  const s = check?.status || "malformed";
  if (s === "no_secret" || s === "valid") return { reject: false, log: s === "valid" && check.stale ? "valid_stale" : null };
  return { reject: !!enforce, log: s };
}

export const mpWebhookEnforced = () => String(process.env.MP_WEBHOOK_ENFORCE || "").trim() === "1";

/**
 * ¿El pago (releído de MP con el token del merchant) confirma la disputa?
 *   chargeback → status charged_back.
 *   claim      → status in_mediation (reclamo abierto), charged_back o refunded.
 *   fraud      → status charged_back / refunded, o status_detail de fraude/riesgo.
 * `claimFound`: el id resolvió en /v1/claims de ESE merchant (reclamo real).
 */
export function disputeConfirmed(kind, payment, { claimFound = false } = {}) {
  if (claimFound) return true;
  const st = String(payment?.status || "").toLowerCase();
  const det = String(payment?.status_detail || "").toLowerCase();
  if (kind === "chargeback") return st === "charged_back";
  if (kind === "claim") return st === "in_mediation" || st === "charged_back" || st === "refunded";
  if (kind === "fraud") return st === "charged_back" || st === "refunded" || /fraud|high_risk|blacklist/.test(det);
  return false;
}
