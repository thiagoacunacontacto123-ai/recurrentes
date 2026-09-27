// Google Calendar directo, sin Calendly (28-sept-2026). La cuenta de servicio de
// Firebase (FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) actúa "en nombre de"
// Thiago con delegación de dominio de Workspace: los eventos quedan en SU
// calendario, con Google Meet, y Google le manda la invitación al cliente.
//
// Env:
//   GCAL_IMPERSONATE  mail de Workspace de Thiago (obligatoria; sin ella, apagado)
//   GCAL_CALENDAR_ID  id del calendario (opcional; default = GCAL_IMPERSONATE)
//   GCAL_CLIENT_EMAIL / GCAL_PRIVATE_KEY  otra cuenta de servicio (opcional; default = la de Firebase)
//   DEMO_HOURS        franja (ver shared/platform/demoSlots.js)
import crypto from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
const SCOPE = "https://www.googleapis.com/auth/calendar";

const env = (k) => String(process.env[k] || "").trim();
export const gcalImpersonate = () => env("GCAL_IMPERSONATE");
export const gcalCalendarId = () => env("GCAL_CALENDAR_ID") || gcalImpersonate();
function creds() {
  const email = env("GCAL_CLIENT_EMAIL") || env("FIREBASE_CLIENT_EMAIL");
  const key = (env("GCAL_PRIVATE_KEY") || process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  return email && key ? { email, key } : null;
}
export const gcalEnabled = () => !!(gcalImpersonate() && creds());

const b64url = (s) => Buffer.from(s).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

// Token de acceso (JWT firmado con la clave de la cuenta de servicio, `sub` =
// el usuario impersonado). Cacheado en memoria mientras dure la función.
let cache = { token: null, exp: 0, sub: null };
export async function gcalToken({ fetchImpl = fetch, now = Date.now() } = {}) {
  const c = creds(); const sub = gcalImpersonate();
  if (!c || !sub) throw new Error("gcal_disabled");
  if (cache.token && cache.sub === sub && cache.exp > now + 60000) return cache.token;
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: c.email, sub, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), c.key);
  const assertion = `${header}.${payload}.${b64url(sig)}`;
  const r = await fetchImpl(TOKEN_URL, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw new Error(`gcal_token ${r.status} ${d.error || ""} ${d.error_description || ""}`.trim());
  cache = { token: d.access_token, exp: now + (Number(d.expires_in) || 3600) * 1000, sub };
  return d.access_token;
}
export const _resetGcalCache = () => { cache = { token: null, exp: 0, sub: null }; };

async function call(path, { method = "GET", body, query, fetchImpl = fetch } = {}) {
  const token = await gcalToken({ fetchImpl });
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const r = await fetchImpl(url.toString(), {
    method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`gcal ${method} ${path} ${r.status}: ${d.error?.message || ""}`.trim());
  return d;
}

// Ocupados del calendario entre dos instantes → [{ start, end }] (ISO).
export async function gcalBusy({ from, to, fetchImpl = fetch } = {}) {
  const id = gcalCalendarId();
  const d = await call("/freeBusy", { method: "POST", fetchImpl, body: {
    timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{ id }],
  } });
  return (d.calendars?.[id]?.busy || []).map((b) => ({ start: b.start, end: b.end }));
}

// Crea el evento con Google Meet e invita al cliente (Google manda la invitación).
// Devuelve { id, htmlLink, meetUrl }.
export async function gcalCreateMeeting({ start, end, summary, description, attendee, fetchImpl = fetch } = {}) {
  const d = await call(`/calendars/${encodeURIComponent(gcalCalendarId())}/events`, {
    method: "POST", fetchImpl, query: { conferenceDataVersion: "1", sendUpdates: "all" },
    body: {
      summary, description,
      start: { dateTime: new Date(start).toISOString() },
      end: { dateTime: new Date(end).toISOString() },
      attendees: attendee?.email ? [{ email: attendee.email, displayName: attendee.name || undefined }] : [],
      conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
      guestsCanModify: false,
    },
  });
  const meetUrl = d.hangoutLink || (d.conferenceData?.entryPoints || []).find((e) => e.entryPointType === "video")?.uri || null;
  return { id: d.id || null, htmlLink: d.htmlLink || null, meetUrl };
}
