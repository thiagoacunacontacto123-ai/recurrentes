// Webhook de WhatsApp Cloud API → /api/public?action=wa-webhook (sin función nueva).
//
//   GET  (verificación de Meta al configurar el webhook)
//        hub.mode=subscribe & hub.verify_token=<token> & hub.challenge=<n> → responde el challenge.
//        Token válido: WHATSAPP_VERIFY_TOKEN (app de Recurrentes) o el whatsapp_verify_token
//        de la tienda si la URL trae &merchant=<id> (comerciante con su propia app de Meta).
//   POST (eventos) — firma X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(body crudo, app secret).
//        Secretos aceptados: WHATSAPP_APP_SECRET y el whatsapp_app_secret de la tienda dueña del
//        número (value.metadata.phone_number_id). Firma inválida → 401.
//        - statuses[]: sent / delivered / read / failed → actualiza message_log (sin retroceder).
//        - messages[]: "BAJA" / "STOP" (texto o botón) → baja de avisos por WhatsApp; "ALTA" la saca.
//        Siempre 200 si la firma es válida (Meta reintenta ante errores).
import { db } from "./firebase.js";
import { timingSafeEqualStr } from "./token.js";
import { verifyWaSignature, setWhatsappOptOut, messageLogId, scrub } from "./whatsapp.js";
import { WA_OPTOUT_RE, WA_OPTIN_RE, normalizePhoneAR } from "../../shared/platform/whatsapp.js";

const RANK = { sent: 1, delivered: 2, read: 3, failed: 4 };

// Body crudo (mismo criterio que api/shopify/webhooks.js).
function readRaw(req) {
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body);
  if (typeof req.body === "string") return Promise.resolve(Buffer.from(req.body));
  return new Promise((resolve, reject) => {
    const chunks = [];
    const t = setTimeout(() => reject(new Error("timeout leyendo body")), 5000);
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => { clearTimeout(t); resolve(Buffer.concat(chunks)); });
    req.on("error", (e) => { clearTimeout(t); reject(e); });
  });
}

async function merchantByPhoneId(phoneId) {
  if (!phoneId) return null;
  const q = await db().collection("merchants").where("whatsapp_phone_number_id", "==", String(phoneId)).limit(1).get();
  return q.empty ? null : { id: q.docs[0].id, ref: q.docs[0].ref, data: q.docs[0].data() || {} };
}

export async function handleWhatsappWebhook(req, res) {
  if (req.method === "GET") {
    const q = req.query || {};
    const mode = String(q["hub.mode"] || "");
    const token = String(q["hub.verify_token"] || "");
    const challenge = String(q["hub.challenge"] || "");
    let ok = false;
    if (mode === "subscribe" && token) {
      const envTok = process.env.WHATSAPP_VERIFY_TOKEN || "";
      if (envTok && timingSafeEqualStr(envTok, token)) ok = true;
      else if (/^[A-Za-z0-9_-]{1,64}$/.test(String(q.merchant || ""))) {
        const snap = await db().collection("merchants").doc(String(q.merchant)).get().catch(() => null);
        const mt = snap?.exists ? String(snap.data()?.whatsapp_verify_token || "") : "";
        ok = Boolean(mt) && timingSafeEqualStr(mt, token);
      }
    }
    if (!ok) return res.status(403).json({ error: "verify_token inválido" });
    res.setHeader("Content-Type", "text/plain");
    return res.status(200).end(challenge.replace(/[^\w.-]/g, "").slice(0, 200));
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let raw;
  try { raw = await readRaw(req); } catch (e) { return res.status(400).json({ error: e.message }); }
  let payload = {};
  try { payload = JSON.parse(raw.toString("utf8") || "{}"); } catch (_) { return res.status(400).json({ error: "JSON inválido" }); }
  if (payload.object !== "whatsapp_business_account") return res.status(200).json({ ok: true, ignored: true });

  const sigHeader = req.headers["x-hub-signature-256"];
  const changes = [];
  for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) if (ch?.field === "messages" && ch.value) changes.push(ch.value);
  }

  // Firma: con el secreto de la app de Recurrentes o con el de la tienda dueña del número.
  const merchants = {};
  for (const v of changes) {
    const pid = v?.metadata?.phone_number_id;
    if (pid && !(pid in merchants)) merchants[pid] = await merchantByPhoneId(pid).catch(() => null);
  }
  const secrets = [process.env.WHATSAPP_APP_SECRET, ...Object.values(merchants).map(m => m?.data?.whatsapp_app_secret)];
  if (!verifyWaSignature(raw, sigHeader, secrets)) return res.status(401).json({ error: "Firma inválida" });

  const out = { statuses: 0, optouts: 0, optins: 0 };
  for (const v of changes) {
    const m = merchants[v?.metadata?.phone_number_id];
    if (!m) continue;
    // Si la firma vino del secreto de OTRA tienda, no tocamos esta.
    const own = [process.env.WHATSAPP_APP_SECRET, m.data.whatsapp_app_secret];
    if (!verifyWaSignature(raw, sigHeader, own)) continue;
    try {
      for (const st of Array.isArray(v.statuses) ? v.statuses : []) {
        if (!st?.id || !RANK[st.status]) continue;
        const ref = m.ref.collection("message_log").doc(messageLogId(st.id));
        const cur = await ref.get();
        if (!cur.exists) continue;
        const prev = cur.data()?.status;
        if ((RANK[prev] || 0) >= RANK[st.status] && st.status !== "failed") continue;
        const err = Array.isArray(st.errors) && st.errors[0] ? st.errors[0] : null;
        await ref.update({
          status: st.status,
          [`${st.status}_at`]: st.timestamp ? new Date(Number(st.timestamp) * 1000).toISOString() : new Date().toISOString(),
          ...(err ? { error: scrub(err.error_data?.details || err.title || err.message || ""), error_code: err.code ?? null } : {}),
          ...(st.pricing?.category ? { pricing_category: st.pricing.category, billable: st.pricing.billable !== false } : {}),
          updated_at: new Date().toISOString(),
        });
        out.statuses++;
      }
      for (const msg of Array.isArray(v.messages) ? v.messages : []) {
        const text = msg?.type === "text" ? msg.text?.body : msg?.type === "button" ? (msg.button?.text || msg.button?.payload) : msg?.type === "interactive" ? (msg.interactive?.button_reply?.title || "") : "";
        const phone = normalizePhoneAR("+" + String(msg?.from || ""));
        if (!phone || !text) continue;
        if (WA_OPTOUT_RE.test(text)) { await setWhatsappOptOut(m.id, phone, { optout: true, reason: "respondió baja" }); out.optouts++; }
        else if (WA_OPTIN_RE.test(text)) { await setWhatsappOptOut(m.id, phone, { optout: false }); out.optins++; }
      }
    } catch (e) {
      console.warn(`[wa-webhook] ${m.id}:`, scrub(e.message));
    }
  }
  return res.status(200).json({ ok: true, ...out });
}
