// Retención al cancelar (portal del cliente): motivos de baja + oferta de pausa.
// merchant.retention = { enabled, offer_pause, offer_discount_pct, reasons:[{code,label}] }.
// Defaults compatibles: un merchant sin el campo tiene TODO habilitado con los 5
// motivos estándar y sin oferta de descuento (offer_discount_pct 0 = sin oferta;
// hoy es solo informativo: el portal no aplica descuentos automáticos).
export const RETENTION_REASON_CODES = ["precio", "stock", "no_uso", "calidad", "otro"];
export const RETENTION_DEFAULT_REASONS = [
  { code: "precio",  label: "Me resulta caro" },
  { code: "stock",   label: "Todavía tengo producto" },
  { code: "no_uso",  label: "Ya no lo uso" },
  { code: "calidad", label: "No me convenció el producto" },
  { code: "otro",    label: "Otro motivo" },
];
export const RETENTION_DEFAULTS = { enabled: true, offer_pause: true, offer_discount_pct: 0, reasons: RETENTION_DEFAULT_REASONS };
export const RETENTION_MAX_PAUSE_CYCLES = 3;
// Códigos de motivo: libres (el comerciante agrega los suyos), formato slug.
export const REASON_CODE_RE = /^[a-z0-9_]{1,32}$/;

export function retentionFor(m) {
  const r = m?.retention && typeof m.retention === "object" ? m.retention : {};
  const reasons = Array.isArray(r.reasons) && r.reasons.length
    ? r.reasons.filter(x => x && REASON_CODE_RE.test(String(x.code || ""))).map(x => ({ code: x.code, label: String(x.label || "").trim().slice(0, 80) || RETENTION_DEFAULT_REASONS.find(d => d.code === x.code)?.label || x.code }))
    : RETENTION_DEFAULT_REASONS;
  return {
    enabled: r.enabled !== false,
    offer_pause: r.offer_pause !== false,
    offer_discount_pct: Number.isInteger(r.offer_discount_pct) ? Math.max(0, Math.min(90, r.offer_discount_pct)) : 0,
    // Ciclos de pausa que se ofrecen por defecto en el portal (1..3).
    pause_cycles: Number.isInteger(r.pause_cycles) ? Math.max(1, Math.min(RETENTION_MAX_PAUSE_CYCLES, r.pause_cycles)) : 1,
    reasons: reasons.length ? reasons : RETENTION_DEFAULT_REASONS,
  };
}
