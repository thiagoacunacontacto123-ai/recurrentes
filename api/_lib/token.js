import crypto from "crypto";
import { signingSecret } from "./config.js";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

function hmac(data, secret) {
  return crypto.createHmac("sha256", secret).update(data).digest();
}

export function timingSafeEqualStr(a, b) {
  const A = Buffer.from(String(a || ""));
  const B = Buffer.from(String(b || ""));
  if (A.length !== B.length) return false;
  return crypto.timingSafeEqual(A, B);
}

// Token firmado: base64url(json).base64url(hmac). `ttlSec` opcional.
export function signToken(payload, ttlSec) {
  const body = { ...payload };
  if (ttlSec) body.exp = Math.floor(Date.now() / 1000) + ttlSec;
  const p = b64u(JSON.stringify(body));
  const sig = b64u(hmac(p, signingSecret()));
  return `${p}.${sig}`;
}

// Devuelve el payload o null si la firma es inválida / expiró.
export function verifyToken(token) {
  try {
    const [p, sig] = String(token || "").split(".");
    if (!p || !sig) return null;
    const expected = hmac(p, signingSecret());
    const given = unb64u(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    const body = JSON.parse(unb64u(p).toString("utf8"));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch (_) {
    return null;
  }
}

export const sha256hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
