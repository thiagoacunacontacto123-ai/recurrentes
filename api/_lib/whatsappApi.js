// Endpoints de WhatsApp vía /api/merchant (no suma funciones serverless):
//   GET  ?action=whatsapp-templates   → { templates:[…] } plantillas de la WABA propia, o las de
//        Recurrentes si la tienda manda desde el número de Recurrentes (editor de flujos)
//   GET  ?action=whatsapp-usage       → { usage:{ month, wa_sent, wa_cost_usd, … }, charge_usd, sender }
//   POST ?action=whatsapp-platform    { enabled, optin_confirmed } → prende / apaga los avisos desde
//        el número de Recurrentes. Al prenderlo crea (una vez) el flujo "Aviso de próximo cobro".
//   POST ?action=whatsapp-save        { phone_number_id, waba_id, access_token, app_secret?, optin_confirmed }
//        → número PROPIO (avanzado): valida con llamadas de solo lectura a Meta y guarda
//   POST ?action=whatsapp-disconnect
//   POST ?action=whatsapp-test        { template, lang, vars, to } → esa plantilla con datos de ejemplo (10/día)
// Prender / conectar / desconectar / probar: solo el dueño de la tienda.
import crypto from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db, clearMerchantCache } from "./firebase.js";
import { rateLimit } from "./ratelimit.js";
import { appBaseUrl } from "./config.js";
import { effectiveBrand } from "./email.js";
import {
  waValidateCredentials, waListTemplates, sendTemplate, bodyComponents, logWaMessage, whatsappEnabled, whatsappSafe, recordWaError,
  waSender, platformWaAvailable, resolveStepTemplate, afterWaSend, getWaUsage, waPriceUsd,
} from "./whatsapp.js";
import { syncFlowsIndex } from "./flows.js";
import { normalizePhoneAR, templateParams, sanitizeWhatsappStep, WA_TEMPLATES, templateVarCount } from "../../shared/platform/whatsapp.js";
import { FLOW_VARIABLES, FLOW_MAX_FLOWS, defaultWhatsappFlow, sanitizeFlow } from "../../shared/platform/flows.js";
import { waChargeUsd } from "../../shared/platform/pricing.js";

const OWNER_ONLY = ["whatsapp-save", "whatsapp-disconnect", "whatsapp-test", "whatsapp-platform"];
const mRef = (mid) => db().collection("merchants").doc(mid);
const clearCache = (mid) => { try { clearMerchantCache?.(mid); } catch (_) {} };

// Plantillas de Recurrentes con la misma forma que las de la WABA (las aprueba Thiago en su cuenta).
const platformTemplates = () => WA_TEMPLATES.map(t => ({
  name: t.name, language: t.lang, status: "APPROVED", category: t.category, body: t.body, footer: t.footer,
  var_count: templateVarCount(t.body), unsupported: false, platform: true,
}));

// Al prender el número de Recurrentes: si la tienda no tiene ningún flujo con WhatsApp,
// crea y activa "Aviso de próximo cobro por WhatsApp" (3 días antes). Así un solo interruptor alcanza.
async function ensurePlatformFlow(mid, uid) {
  const col = mRef(mid).collection("flows");
  const snap = await col.get();
  if (snap.docs.some(d => (d.data()?.steps || []).some(s => s?.type === "whatsapp"))) return null;
  if (snap.size >= FLOW_MAX_FLOWS) return null;
  const { flow, error } = sanitizeFlow({ ...defaultWhatsappFlow(), active: true });
  if (error) return null;
  const now = new Date().toISOString();
  const ref = col.doc();
  await ref.set({ ...flow, stats: { entered: 0, sent: 0, completed: 0, exited: 0, converted: 0 }, created_at: now, updated_at: now, created_by: uid || null, created_from: "whatsapp_platform" });
  await syncFlowsIndex(mid);
  return ref.id;
}

export async function whatsappApi(ctx, action, req, res) {
  const mid = ctx.merchantId;
  if (OWNER_ONLY.includes(action) && ctx.role && ctx.role !== "owner") {
    return res.status(403).json({ error: "Solo el dueño de la tienda puede administrar las integraciones." });
  }
  try {
    if (action === "whatsapp-templates") {
      const merchant = (await mRef(mid).get()).data() || {};
      const sender = waSender(merchant);
      if (!sender) return res.json({ templates: [], connected: false });
      if (sender.mode === "platform") return res.json({ templates: platformTemplates(), connected: true, platform: true });
      const r = await waListTemplates(merchant);
      if (!r.ok) {
        await recordWaError(mid, merchant, r);
        return res.status(502).json({ error: r.error, code: r.code });
      }
      return res.json({ templates: r.templates, connected: true });
    }

    if (action === "whatsapp-usage") {
      const merchant = (await mRef(mid).get()).data() || {};
      const usage = await getWaUsage(mid);
      const price = waPriceUsd();
      return res.json({ usage, sender: waSender(merchant)?.mode || null, price_usd: price, charge_usd: waChargeUsd(price) });
    }

    if (action === "whatsapp-platform") {
      const b = req.body || {};
      const enabled = b.enabled === true;
      if (enabled && !platformWaAvailable()) return res.status(400).json({ error: "Los avisos desde el número de Recurrentes todavía no están disponibles. Te avisamos apenas estén." });
      if (enabled && b.optin_confirmed !== true) return res.status(400).json({ error: "Confirmá que tus clientes aceptaron recibir avisos por WhatsApp al suscribirse" });
      const cur = (await mRef(mid).get()).data() || {};
      const now = new Date().toISOString();
      const patch = enabled
        ? { whatsapp_platform_enabled: true, whatsapp_platform_optin_at: now, whatsapp_platform_enabled_at: now, updated_at: now }
        : { whatsapp_platform_enabled: false, whatsapp_platform_disabled_at: now, updated_at: now };
      await mRef(mid).set(patch, { merge: true });
      clearCache(mid);
      let flowId = null;
      if (enabled) { try { flowId = await ensurePlatformFlow(mid, ctx.uid); } catch (e) { console.warn(`[whatsapp-api] flujo ${mid}:`, e.message); } }
      return res.json({ ok: true, flow_created: Boolean(flowId), flow_id: flowId, ...whatsappSafe({ ...cur, ...patch }) });
    }

    if (action === "whatsapp-save") {
      const b = req.body || {};
      if (b.optin_confirmed !== true) return res.status(400).json({ error: "Confirmá que tus clientes aceptaron recibir avisos por WhatsApp" });
      const phone_number_id = String(b.phone_number_id || "").trim();
      const waba_id = String(b.waba_id || "").trim();
      const token = String(b.access_token || "").trim();
      const app_secret = String(b.app_secret || "").trim();
      if (app_secret && !/^[a-f0-9]{32}$/i.test(app_secret)) return res.status(400).json({ error: "La clave secreta de la app son 32 caracteres (letras a-f y números)" });
      const v = await waValidateCredentials({ phone_number_id, waba_id, token });
      if (!v.ok) return res.status(400).json({ error: v.error });
      // Un número de WhatsApp = una tienda (el webhook resuelve la tienda por el número).
      const dup = await db().collection("merchants").where("whatsapp_phone_number_id", "==", phone_number_id).limit(3).get();
      if (dup.docs.some(d => d.id !== mid)) return res.status(409).json({ error: "Ese número de WhatsApp ya está conectado a otra tienda de Recurrentes." });
      if (String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").trim() === phone_number_id) return res.status(409).json({ error: "Ese es el número de Recurrentes: para usarlo prendé los avisos desde el interruptor." });
      const cur = (await mRef(mid).get()).data() || {};
      const now = new Date().toISOString();
      const patch = {
        whatsapp_phone_number_id: phone_number_id,
        whatsapp_waba_id: waba_id,
        whatsapp_access_token: token,
        whatsapp_display_phone: v.display_phone_number || "",
        whatsapp_verified_name: v.verified_name || "",
        whatsapp_quality: v.quality_rating || null,
        whatsapp_connected_at: now,
        whatsapp_disconnected_at: null,
        whatsapp_optin_confirmed_at: now,
        whatsapp_verify_token: cur.whatsapp_verify_token || crypto.randomBytes(18).toString("hex"),
        whatsapp_last_error: null, whatsapp_last_error_at: null,
        updated_at: now,
      };
      if (app_secret) patch.whatsapp_app_secret = app_secret;
      await mRef(mid).set(patch, { merge: true });
      clearCache(mid);
      return res.json({ ok: true, ...whatsappSafe({ ...cur, ...patch }) });
    }

    if (action === "whatsapp-disconnect") {
      await mRef(mid).set({
        whatsapp_phone_number_id: FieldValue.delete(),
        whatsapp_waba_id: FieldValue.delete(),
        whatsapp_access_token: FieldValue.delete(),
        whatsapp_app_secret: FieldValue.delete(),
        whatsapp_display_phone: FieldValue.delete(),
        whatsapp_verified_name: FieldValue.delete(),
        whatsapp_quality: FieldValue.delete(),
        whatsapp_last_error: FieldValue.delete(), whatsapp_last_error_at: FieldValue.delete(),
        whatsapp_disconnected_at: new Date().toISOString(),
      }, { merge: true });
      clearCache(mid);
      return res.json({ ok: true, whatsapp_connected: false });
    }

    if (action === "whatsapp-test") {
      const b = req.body || {};
      const chk = sanitizeWhatsappStep({ template: b.template, lang: b.lang, vars: b.vars }, FLOW_VARIABLES.map(v => v.key));
      if (chk.error) return res.status(400).json({ error: chk.error });
      const to = normalizePhoneAR(b.to);
      if (!to) return res.status(400).json({ error: "Poné un WhatsApp válido, con código de área (ej: 11 6411 7974)" });
      const merchant = (await mRef(mid).get()).data() || {};
      const sender = waSender(merchant);
      if (!sender) return res.status(400).json({ error: "Prendé los avisos por WhatsApp primero (Configuración → Integraciones → WhatsApp)" });
      const tpl = resolveStepTemplate(sender, chk.step);
      if (!tpl) return res.status(400).json({ error: "Desde el número de Recurrentes solo salen las plantillas de Recurrentes" });
      const rl = await rateLimit(`watest:${mid}`, { limit: 10, windowSec: 86400 });
      if (!rl.ok) return res.status(429).json({ error: "Tope de 10 mensajes de prueba por día alcanzado" });
      const sample = Object.fromEntries(FLOW_VARIABLES.map(v => [v.key, v.sample]));
      const vars = { ...sample, marca: effectiveBrand(merchant) || sample.marca, link_portal: `${appBaseUrl()}/#/portal` };
      const r = await sendTemplate({ sender, to, template: tpl.template, lang: tpl.lang, components: bodyComponents(templateParams(tpl.vars, vars)) });
      await logWaMessage(mid, { type: "test", sender: sender.mode, to, template: tpl.template, lang: tpl.lang, status: r.ok ? "sent" : "error", error: r.ok ? null : r.error, error_code: r.ok ? null : r.code, provider_id: r.ok ? r.id : null });
      await afterWaSend(mid, merchant, sender, to, r);
      if (!r.ok) return res.status(502).json({ error: r.error, code: r.code });
      return res.json({ ok: true, to: r.to, id: r.id });
    }

    return res.status(400).json({ error: "action de WhatsApp no reconocida" });
  } catch (e) {
    console.error(`[whatsapp-api] ${action} ${mid}:`, e.message);
    return res.status(500).json({ error: "No pudimos completar la acción de WhatsApp. Probá de nuevo." });
  }
}

// (whatsappEnabled se reexporta para quien lo importaba desde acá antes)
export { whatsappEnabled };
