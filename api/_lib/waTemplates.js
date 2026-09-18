// Plantillas de WhatsApp de Recurrentes en Meta, por API (sin cargarlas a mano).
//   listPlatformTemplates() → estado en Meta de cada plantilla de WA_ALL_TEMPLATES
//   syncPlatformTemplates() → crea las que faltan (quedan PENDING hasta que Meta apruebe)
// Usa el número de Recurrentes (env WHATSAPP_WABA_ID + WHATSAPP_ACCESS_TOKEN). Solo admin.
import { platformWaConfig, graphRequest, mapWaError } from "./whatsapp.js";
import { WA_ALL_TEMPLATES } from "../../shared/platform/whatsapp.js";

async function fetchMetaTemplates(cfg) {
  const byName = new Map();
  let path = `${encodeURIComponent(cfg.waba_id)}/message_templates?fields=name,language,status,category,rejected_reason&limit=200`;
  for (let i = 0; i < 5 && path; i++) {
    const r = await graphRequest(path, { token: cfg.token });
    if (!r.ok) throw new Error(mapWaError(r.status, r.data).error || "Meta no devolvió las plantillas");
    for (const t of r.data?.data || []) byName.set(`${t.name}:${t.language}`, t);
    const next = r.data?.paging?.next;
    path = next ? String(next).replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "") : null;
  }
  return byName;
}

// Payload de creación: cuerpo con ejemplos (Meta los exige para aprobar) + pie.
export function templateCreatePayload(t) {
  return {
    name: t.name, language: t.lang, category: t.category || "UTILITY",
    components: [
      { type: "BODY", text: t.body, ...(t.samples?.length ? { example: { body_text: [t.samples] } } : {}) },
      ...(t.footer ? [{ type: "FOOTER", text: t.footer }] : []),
    ],
  };
}

export async function listPlatformTemplates() {
  const cfg = platformWaConfig();
  if (!cfg || !cfg.waba_id) return { available: false, reason: !cfg ? "Falta WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN" : "Falta WHATSAPP_WABA_ID", templates: [] };
  const meta = await fetchMetaTemplates(cfg);
  const templates = WA_ALL_TEMPLATES.map(t => {
    const m = meta.get(`${t.name}:${t.lang}`);
    return { name: t.name, title: t.title, lang: t.lang, category: t.category, status: m ? m.status : "MISSING", rejected_reason: m?.rejected_reason || null };
  });
  return { available: true, waba_id: cfg.waba_id, templates };
}

export async function syncPlatformTemplates() {
  const cfg = platformWaConfig();
  if (!cfg || !cfg.waba_id) return { available: false, created: [], skipped: [], errors: [] };
  const meta = await fetchMetaTemplates(cfg);
  const out = { available: true, waba_id: cfg.waba_id, created: [], skipped: [], errors: [] };
  for (const t of WA_ALL_TEMPLATES) {
    const m = meta.get(`${t.name}:${t.lang}`);
    // Existentes (aprobadas, pendientes o incluso rechazadas) no se pisan: una
    // rechazada se corrige a mano en Meta o se borra y se vuelve a correr esto.
    if (m) { out.skipped.push({ name: t.name, status: m.status }); continue; }
    const r = await graphRequest(`${encodeURIComponent(cfg.waba_id)}/message_templates`, { token: cfg.token, method: "POST", body: templateCreatePayload(t) });
    if (r.ok) out.created.push({ name: t.name, id: r.data?.id || null, status: r.data?.status || "PENDING" });
    else out.errors.push({ name: t.name, error: mapWaError(r.status, r.data).error || "error", code: r.data?.error?.code ?? null, detail: String(r.data?.error?.error_user_msg || r.data?.error?.message || "").slice(0, 300) });
  }
  return out;
}
