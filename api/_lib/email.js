// Email transaccional con Resend. Si RESEND_API_KEY no está seteado, las
// funciones son no-ops (no rompen el flow) — emails es feature opcional.
//
// Todos los templates aceptan `merchant` (doc del comerciante) y derivan de él
// from / brand / accent / reply_to. Los params explícitos ganan sobre merchant.
// El cliente final ve la MARCA de la tienda; "Recurrentes" solo en un footer chico.
//
// Doc: https://resend.com/docs/api-reference/emails/send-email
import { fetchWithTimeout } from "./http.js";
import { appBaseUrl } from "./config.js";
import { signToken } from "./token.js";

const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_FROM = "Recurrentes <[email protected]>";

// Nombre visible de un "Nombre <mail@dom>".
export function fromName(from) {
  return String(from || "").split("<")[0].trim().replace(/^["']|["']$/g, "");
}
// Dirección de un "Nombre <mail@dom>" (o el string si ya es un mail pelado).
export function fromAddress(from) {
  const s = String(from || "").trim();
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}
// Remitente por defecto de la plataforma (env EMAIL_FROM o el hardcodeado).
export function platformFrom() { return process.env.EMAIL_FROM || DEFAULT_FROM; }

// Marca efectiva del merchant (sin escribir nada): lo que cargó en Configuración,
// si no el nombre de la tienda (propio o el de Shopify), si no el myshopify.
export function effectiveBrand(merchant) {
  const m = merchant || {};
  return String(m.email_brand || m.store_name || m.shop_name || fromName(m.email_from) || m.shopify_shop || "").trim();
}
// Remitente efectivo: el propio si lo cargó; si no "<Marca> <dirección de la
// plataforma>". El DOMINIO del remitente sigue siendo el nuestro (EMAIL_FROM)
// hasta que exista Resend multi-merchant (dominios verificados por tienda);
// lo único que personalizamos es el nombre visible.
export function effectiveFrom(merchant) {
  const m = merchant || {};
  if (m.email_from) return m.email_from;
  const brand = effectiveBrand(m);
  const addr = fromAddress(platformFrom());
  return brand && addr ? `${brand.replace(/[<>"]/g, "")} <${addr}>` : platformFrom();
}

// Resuelve remitente/marca: explícito > merchant > env > default.
// El acento del mail es SIEMPRE widget_color (email_accent se retiró 2026-09-13).
function resolveSender({ merchant, from, brand, accent, replyTo } = {}) {
  const f = from || effectiveFrom(merchant);
  return {
    from: f,
    brand: brand || effectiveBrand(merchant) || fromName(f) || "Tu tienda",
    accent: accent || merchant?.widget_color || "",
    replyTo: replyTo || merchant?.email_reply_to || merchant?.shop_email || undefined,
    // Mail de atención al cliente de la tienda: va al pie de cada mail automático
    // (los mails salen de una dirección de Recurrentes que no recibe respuestas).
    support: replyTo || merchant?.email_reply_to || merchant?.shop_email || "",
  };
}

// HTML → texto plano simple (alternativa text/plain para deliverability).
export function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "")
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, txt) => `${txt} (${href})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h\d|li|tr|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Tags de Resend: solo ASCII letras/números/_/- en name y value.
function tagVal(v) { return String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100) || "na"; }

// `headers` extra (ej. List-Unsubscribe). `tags` = { tipo: valor }.
// Devuelve { ok:true, id } | { ok:false, error } | { skipped:true }. NUNCA lanza.
async function sendEmail({ from, to, subject, html, text, replyTo, headers, tags }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] skip (RESEND_API_KEY no configurada) — to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  const payload = {
    from: from || process.env.EMAIL_FROM || DEFAULT_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text: text || htmlToText(html),
    ...(replyTo ? { reply_to: replyTo } : {}),
    ...(headers && Object.keys(headers).length ? { headers } : {}),
    ...(tags && Object.keys(tags).length ? { tags: Object.entries(tags).map(([name, value]) => ({ name: tagVal(name), value: tagVal(value) })) } : {}),
  };
  try {
    const r = await fetchWithTimeout(RESEND_API, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, 10000);
    const raw = await r.text().catch(() => "");
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch (_) { data = { message: raw.slice(0, 300) }; }
    if (!r.ok) {
      const error = `Resend ${r.status}: ${data.message || data.name || raw.slice(0, 300) || "error"}`;
      console.error(`[email] error to=${to} subject="${subject}" status=${r.status} body=${raw.slice(0, 500)}`);
      return { ok: false, error, status: r.status };
    }
    return { ok: true, id: data.id };
  } catch (e) {
    console.error(`[email] network error to=${to} subject="${subject}":`, e.message);
    return { ok: false, error: `network: ${e.message}` };
  }
}

// Template base. Mantener simple — inline styles, dark mode friendly,
// markup mínimo (Gmail/Outlook). Todo lo que viene del merchant/cliente se escapa.
function baseTemplate({ title, body, ctaLabel, ctaUrl, footerNote, brand, accent, unsubUrl, support, automatic = true }) {
  const brandName = brand || "Tu tienda";
  // Pie de todos los mails: aviso de mail automático + a dónde escribir (mail de la tienda).
  const sup = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(String(support || "").trim()) ? String(support).trim() : "";
  const autoLine = sup
    ? `Este es un mail automático, por favor no lo respondas. Si necesitás ayuda, escribí a <a href="mailto:${escapeAttr(sup)}" style="color:#374151;">${escapeHtml(sup)}</a>.`
    : "Este es un mail automático, por favor no lo respondas.";
  const footer = [footerNote, automatic ? autoLine : ""].filter(Boolean).join("<br/><br/>");
  const col = /^#[0-9a-fA-F]{3,8}$/.test(String(accent || "")) ? accent : "#10b981";
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="padding:24px 28px 12px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:800;color:${col};">${escapeHtml(brandName)}</div>
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#111827;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#374151;">${body}</div>
      ${ctaUrl && ctaLabel ? `
        <p style="margin:24px 0 0;">
          <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:${col};color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:700;font-size:14px;">${escapeHtml(ctaLabel)}</a>
        </p>
      ` : ""}
    </td></tr>
    ${footer ? `<tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${footer}</td></tr>` : ""}
  </table>
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#9ca3af;">
    ${escapeHtml(brandName)}
    ${unsubUrl ? ` · <a href="${escapeAttr(unsubUrl)}" style="color:#9ca3af;">No quiero recibir más estos mails</a>` : ""}
    <br/><span style="font-size:10px;">Enviado con Recurrentes</span>
  </div>
</body></html>`;
}

export function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
// Saludo que no deja "Hola ," cuando falta el nombre del cliente.
function greet(name) {
  const n = String(name || "").trim();
  return n ? `Hola ${escapeHtml(n)},` : "¡Hola! 👋";
}
// Texto corto y sin HTML para subjects/títulos (se escapan al renderizar).
const plain = (s, max = 120) => String(s || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const fmtArs = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

// ─── Templates ───────────────────────────────────────────────────

export async function emailSubscriptionActivated({ to, customerName, productTitle, frequencyDays, amount, portalUrl, merchant, from, brand, accent, replyTo }) {
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const freq = parseInt(frequencyDays, 10) || 30;
  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent, support: snd.support,
    title: `¡Tu suscripción a ${prodTxt} está activa!`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Recibimos la confirmación de tu pago. Ya estás suscrito a <strong>${escapeHtml(prodTxt)}</strong>.</p>
      <p style="background:#ecfdf5;border:1px solid #10b98133;border-radius:10px;padding:14px;margin:18px 0;">
        <strong>Resumen:</strong><br/>
        <strong>${fmtArs(amount)}</strong> por cobro, cada ${freq} días (envío incluido si corresponde).
      </p>
      <p>En los próximos días vas a recibir tu primer envío con los datos de la dirección que cargaste.</p>
      ${portalUrl ? `<p>Podés pausar, cancelar o cambiar la dirección desde <a href="${escapeAttr(portalUrl)}" style="color:#111827;">tu portal</a>.</p>` : ""}
    `,
    ctaLabel: "Gestionar mi suscripción",
    ctaUrl: portalUrl,
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: `¡Suscripción activa — ${prodTxt}!`, html, tags: { type: "activation" } });
}

// Lista para llamarse desde public.js (portal) y subscribers.js (dashboard).
export async function emailSubscriptionCancelled({ to, customerName, productTitle, merchant, from, brand, accent, replyTo }) {
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent, support: snd.support,
    title: `Cancelamos tu suscripción`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Confirmamos que tu suscripción a <strong>${escapeHtml(prodTxt)}</strong> fue cancelada. No vamos a hacer más cobros.</p>
      <p>Si fue un error o cambiás de idea, podés volver al producto en la tienda y suscribirte de nuevo.</p>
    `,
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: `Tu suscripción a ${prodTxt} fue cancelada`, html, tags: { type: "cancellation" } });
}

// Carrito de suscripción abandonado — secuencia de 3 pasos:
//   step 1 (15 min): recordatorio simple, sin cupón.
//   step 2 (2 hs):  con cupón (ej. VUELVO5 5% OFF) — o sin cupón si no existe.
//   step 3 (24 hs): última chance con cupón mayor — o sin cupón si no existe.
// Es marketing: con `merchantId` agrega List-Unsubscribe (one-click) + link de baja.
export async function emailAbandonedCheckout({ to, customerName, productTitle, amount, recoverUrl, brand, accent, from, replyTo, merchant, merchantId, step, couponCode, couponPct }) {
  step = step || 1;
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const prod = escapeHtml(prodTxt);
  const code = String(couponCode || "").trim();
  const pct = Math.max(0, Number(couponPct) || 0);
  const box = (inner) => `<p style="background:#f0fdf4;border:1px solid #10b98133;border-radius:10px;padding:14px;margin:18px 0;">${inner}</p>`;
  // Texto del beneficio: "% OFF" solo si tenemos un porcentaje real.
  const offTxt = pct ? `${pct}% OFF` : "un descuento extra";
  let subject, title, extra, ctaLabel;

  if (step === 2 && code) {
    subject = `Te guardamos tu ${prodTxt} + un regalito 🎁`;
    title = `Seguís a tiempo — y con un extra 🎁`;
    extra = box(`Usá el código <strong>${escapeHtml(code)}</strong> y te llevás <strong>${offTxt}</strong>.<br/>Ya te lo dejamos aplicado en el link — retomás con tu pack elegido.`);
    ctaLabel = pct ? `Retomar con ${pct}% OFF` : "Retomar con descuento";
  } else if (step === 3 && code) {
    subject = pct ? `⏰ Última chance: ${pct}% OFF en tu ${prodTxt}` : `⏰ Última chance para tu ${prodTxt}`;
    title = pct ? `Última oportunidad: ${pct}% OFF ⏰` : `Última oportunidad ⏰`;
    extra = box(`Es tu <strong>última chance</strong>. Con el código <strong>${escapeHtml(code)}</strong> te llevás <strong>${offTxt}</strong>.<br/>Ya está aplicado en el link, con tu pack elegido. No lo dejes pasar. 💜`);
    ctaLabel = pct ? `Aprovechar ${pct}% OFF` : "Aprovechar el descuento";
  } else if (step === 2) {
    subject = `Te guardamos tu ${prodTxt} 👀`;
    title = `Seguís a tiempo de retomar tu ${prodTxt}`;
    extra = box(`Tu pack sigue reservado. Retomás el pago en 1 clic, justo donde lo dejaste.`);
    ctaLabel = "Retomar mi compra";
  } else if (step === 3) {
    subject = `⏰ Última chance para tu ${prodTxt}`;
    title = `Última oportunidad ⏰`;
    extra = box(`Es tu <strong>última chance</strong>: después de hoy ya no te lo reservamos. Retomás en 1 clic con tu pack elegido. 💜`);
    ctaLabel = "Retomar mi compra";
  } else {
    subject = `¿Te olvidaste de algo? Tu ${prodTxt} quedó pendiente`;
    title = `Te quedó tu ${prodTxt} a mitad de camino 👀`;
    extra = box(`Retomás el pago en 1 clic, justo donde lo dejaste — con tu pack ya elegido.`);
    ctaLabel = "Retomar mi compra";
  }

  // Baja (Ley 25.326 + Gmail/Yahoo): header one-click + link en el footer.
  let unsubUrl = null, headers;
  if (merchantId) {
    try {
      const base = appBaseUrl();
      const token = signToken({ m: merchantId, e: String(to || "").trim().toLowerCase() });
      unsubUrl = `${base}/api/public?action=unsub&t=${encodeURIComponent(token)}`;
      headers = { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    } catch (e) {
      // Sin secreto de firma no mandamos marketing sin baja (fail closed).
      console.error("[email] no se pudo firmar el link de baja:", e.message);
      return { ok: false, error: `unsub token: ${e.message}` };
    }
  }

  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent, support: snd.support, title, unsubUrl,
    body: `
      <p>${greet(customerName)}</p>
      <p>Vimos que empezaste tu suscripción a <strong>${prod}</strong> pero no llegaste a terminar el pago.</p>
      ${extra}
      <p>Te llega cómodo a tu casa y cancelás cuando quieras. 💜</p>
    `,
    ctaLabel,
    ctaUrl: recoverUrl,
    footerNote: "Si ya lo compraste o no te interesa, ignorá este mail. 🙌",
  });
  return sendEmail({
    from: snd.from, replyTo: snd.replyTo, to, subject, html, headers,
    tags: { type: "abandoned", step: String(step), ...(merchantId ? { merchant: merchantId } : {}) },
  });
}

export async function emailPaymentFailed({ to, customerName, productTitle, portalUrl, merchant, from, brand, accent, replyTo }) {
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent, support: snd.support,
    title: `Tu pago no se pudo procesar`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Intentamos cobrar tu suscripción a <strong>${escapeHtml(prodTxt)}</strong> y no fue posible. Suele pasar por:</p>
      <ul style="padding-left:18px;line-height:1.7;">
        <li>Tarjeta vencida o con saldo insuficiente</li>
        <li>Tope diario alcanzado</li>
        <li>Tarjeta bloqueada por seguridad</li>
      </ul>
      <p>Lo bueno: lo arreglás en 1 minuto desde tu cuenta de Mercado Pago. Vamos a reintentar el cobro automáticamente en las próximas 48 horas.</p>
    `,
    ctaLabel: "Ver detalle de mi suscripción",
    ctaUrl: portalUrl,
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: `Hubo un problema con tu pago — ${prodTxt}`, html, tags: { type: "payment_failed" } });
}

// ─── Entrega digital (ebooks, cursos, membresías) ─────────────────
// Link + mensaje que carga el comerciante en el plan (shared/platform/delivery.js).
// event: "activation" (primer cobro) | "renewal" (cada renovación, si el plan lo pide).
// Lo manda api/_lib/delivery.js (dedupe por pago + email_log type "delivery").
export async function emailDigitalDelivery({ to, customerName, productTitle, url, message, event = "activation", portalUrl, merchant, from, brand, accent, replyTo }) {
  const link = String(url || "").trim();
  if (!/^https?:\/\//i.test(link)) return { ok: false, error: "link de entrega inválido" };
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const prod = escapeHtml(prodTxt);
  const renewal = event === "renewal";
  const msg = String(message || "").trim().slice(0, 500);
  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent, support: snd.support,
    title: renewal ? `Tu acceso a ${prodTxt} de este período` : `Ya podés entrar a ${prodTxt}`,
    body: `
      <p>${greet(customerName)}</p>
      <p>${renewal
        ? `Se renovó tu suscripción a <strong>${prod}</strong>. Acá tenés tu acceso.`
        : `Tu suscripción a <strong>${prod}</strong> ya está activa. Entrás con el botón de abajo.`}</p>
      ${msg ? `<p style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:18px 0;">${escapeHtml(msg).replace(/\n/g, "<br/>")}</p>` : ""}
      <p style="font-size:12px;color:#6b7280;">Si el botón no funciona, copiá este link en tu navegador:<br/><a href="${escapeAttr(link)}" style="color:#6b7280;word-break:break-all;">${escapeHtml(link)}</a></p>
      ${portalUrl ? `<p>Podés pausar o cancelar tu suscripción desde <a href="${escapeAttr(portalUrl)}" style="color:#111827;">tu portal</a>.</p>` : ""}
    `,
    ctaLabel: "Acceder a tu contenido",
    ctaUrl: link,
    footerNote: "Guardá este mail: es tu acceso.",
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: renewal ? `Tu acceso a ${prodTxt} de este período` : `Tu acceso a ${prodTxt}`, html, tags: { type: "delivery", event: renewal ? "renewal" : "activation" } });
}

// ─── Equipo: invitación a una tienda ─────────────────────────────
// Lo recibe la persona invitada por el dueño desde Configuración → Equipo. El
// claim es por email: tiene que crear su cuenta / loguearse en Recurrentes con
// ESTE mismo mail y la invitación se convierte en membresía al entrar.
export async function emailTeamInvite({ to, inviterEmail, storeName, merchant, appUrl, from, brand, accent, replyTo }) {
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const store = plain(storeName, 60) || snd.brand || "una tienda";
  const inviter = plain(inviterEmail, 120);
  const link = appUrl || `${appBaseUrl()}/#/login`;
  const title = `Te invitaron a ${store} en Recurrentes`;
  const body = `
    <p>${inviter ? `<b>${escapeHtml(inviter)}</b> te invitó` : "Te invitaron"} a formar parte del equipo de <b>${escapeHtml(store)}</b> en Recurrentes.</p>
    <p>Para aceptar, entrá a Recurrentes e iniciá sesión (o creá tu cuenta) usando <b>este mismo email</b>: <b>${escapeHtml(to)}</b>. Si usás otra dirección, la invitación no se va a reconocer.</p>
    <p style="margin-top:14px;color:#6b7280;font-size:13px;">Si no esperabas esta invitación, podés ignorar este mail.</p>`;
  const html = baseTemplate({
    title,
    body,
    ctaLabel: "Aceptar invitación",
    ctaUrl: link,
    brand: "Recurrentes",
    accent: snd.accent,
    footerNote: `Invitación enviada desde la cuenta de ${escapeHtml(store)}.`,
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo || inviterEmail || undefined, to, subject: title, html, tags: { type: "team_invite" } });
}

// ─── Aviso INTERNO (al admin de Recurrentes): un merchant pidió activar un plan.
// `to` = ADMIN_EMAIL (o EMAIL_FROM). Reply-To = mail del merchant para contestar directo.
export async function emailPlanRequest({ to, merchantEmail, merchantId, storeName, plan, planLabel, usd, activeSubscribers, currentPlan, requesterEmail }) {
  const store = plain(storeName, 60) || "(tienda sin nombre)";
  const label = plain(planLabel || plan, 40);
  const title = `Pedido de plan ${label} · ${store}`;
  const row = (k, v) => `<tr><td style="padding:4px 10px 4px 0;color:#6b7280;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827;font-weight:600;">${escapeHtml(v || "—")}</td></tr>`;
  const body = `
    <p><b>${escapeHtml(store)}</b> pidió activar el plan <b>${escapeHtml(label)}</b>${usd ? ` (USD ${escapeHtml(String(usd))}/mes)` : ""}.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;margin:8px 0 14px;">
      ${row("Merchant", merchantId)}
      ${row("Email de la cuenta", merchantEmail)}
      ${requesterEmail && requesterEmail !== merchantEmail ? row("Pedido por", requesterEmail) : ""}
      ${row("Plan actual", currentPlan)}
      ${row("Suscriptores activos", String(activeSubscribers ?? 0))}
      ${row("Fecha", new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" }))}
    </table>
    <p>Contestá este mail para coordinar el pago. Para activarlo, seteá <code>plan: "${escapeHtml(plan)}"</code> en <code>merchants/${escapeHtml(merchantId)}</code>.</p>`;
  const html = baseTemplate({
    title,
    body,
    ctaLabel: merchantEmail ? "Escribirle al merchant" : undefined,
    ctaUrl: merchantEmail ? `mailto:${merchantEmail}?subject=${encodeURIComponent(`Recurrentes · plan ${label}`)}` : undefined,
    brand: "Recurrentes",
    accent: "#10b981",
    footerNote: "Aviso interno de Recurrentes (plan-request).",
    automatic: false, // este sí se contesta: el reply-to es el mail del comerciante
  });
  return sendEmail({ from: process.env.EMAIL_FROM || DEFAULT_FROM, replyTo: merchantEmail || undefined, to, subject: title, html, tags: { type: "plan_request", plan } });
}

// ─── Flujos de email (texto escrito por el comerciante) ─────────────
// Párrafos separados por línea en blanco; los links sueltos quedan clickeables.
// Siempre con baja (header one-click + link al pie): son mails de relación/marketing.
// test=true → prueba desde el editor (va al propio comerciante, sin link de baja).
export async function emailFlowStep({ to, subject, bodyText, ctaLabel, ctaUrl, merchant, merchantId, test = false, tags }) {
  const snd = resolveSender({ merchant });
  const col = /^#[0-9a-fA-F]{3,8}$/.test(String(snd.accent || "")) ? snd.accent : "#10b981";
  const linkify = (s) => s.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" style="color:${col};">${u}</a>`);
  const body = String(bodyText || "").trim().split(/\n{2,}/).filter(Boolean)
    .map(p => `<p style="margin:0 0 12px;">${linkify(escapeHtml(p.trim())).replace(/\n/g, "<br/>")}</p>`).join("");
  let unsubUrl = null, headers;
  if (merchantId && !test) {
    try {
      const token = signToken({ m: merchantId, e: String(to || "").trim().toLowerCase() });
      unsubUrl = `${appBaseUrl()}/api/public?action=unsub&t=${encodeURIComponent(token)}`;
      headers = { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    } catch (e) {
      // Sin secreto de firma no mandamos sin baja (fail closed).
      console.error("[email] flujo: no se pudo firmar el link de baja:", e.message);
      return { ok: false, error: `unsub token: ${e.message}` };
    }
  }
  const html = baseTemplate({ brand: snd.brand, accent: snd.accent, support: snd.support, title: plain(subject, 150), body, ctaLabel: ctaUrl ? ctaLabel : "", ctaUrl, unsubUrl });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: plain(subject, 180), html, headers,
    tags: { type: "flow", ...(tags || {}), ...(merchantId ? { merchant: merchantId } : {}) } });
}

// ─── Transferir una tienda a otra cuenta (_lib/transfer.js) ───────────
const fmtDay = (iso) => {
  try { return new Date(iso).toLocaleDateString("es-AR", { day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" }); }
  catch (_) { return ""; }
};

// A la persona que RECIBE la tienda: link para aceptar (vence en 7 días). El
// aceptar exige entrar con este mismo mail. Sale siempre con la marca Recurrentes.
export async function emailStoreTransfer({ to, fromEmail, storeName, acceptUrl, expiresAt }) {
  const store = plain(storeName, 60) || "una tienda";
  const who = plain(fromEmail, 120);
  const title = `Te quieren pasar la tienda ${store} en Recurrentes`;
  const vence = fmtDay(expiresAt);
  const body = `
    <p>${who ? `<b>${escapeHtml(who)}</b> te quiere pasar` : "Te quieren pasar"} la tienda <b>${escapeHtml(store)}</b> en Recurrentes.</p>
    <p>Si aceptás, la tienda pasa a ser tuya con todo lo que tiene: planes, suscriptores, cobros y las conexiones con Shopify y Mercado Pago.</p>
    <p>Para aceptar tenés que entrar con <b>este mismo email</b>: <b>${escapeHtml(to)}</b>. Si todavía no tenés cuenta, la creás desde el link.</p>
    ${vence ? `<p>El link vence el <b>${escapeHtml(vence)}</b>.</p>` : ""}
    <p style="margin-top:14px;color:#6b7280;font-size:13px;">Si no esperabas este mail, ignoralo: no pasa nada hasta que aceptes.</p>`;
  const html = baseTemplate({
    title, body,
    ctaLabel: "Ver la transferencia",
    ctaUrl: acceptUrl,
    brand: "Recurrentes",
    accent: "#10b981",
    footerNote: "Por seguridad, no reenvíes este mail: el link es personal.",
  });
  return sendEmail({ from: platformFrom(), replyTo: fromEmail || undefined, to, subject: title, html, tags: { type: "store_transfer" } });
}

// Al dueño ANTERIOR: la transferencia se aceptó o se rechazó (aviso de seguridad).
export async function emailStoreTransferResult({ to, kind, storeName, toEmail, keptAccess }) {
  const store = plain(storeName, 60) || "tu tienda";
  const dest = plain(toEmail, 120);
  const accepted = kind === "accepted";
  const title = accepted ? `Transferiste ${store}` : `Rechazaron la transferencia de ${store}`;
  const body = accepted
    ? `<p><b>${escapeHtml(dest)}</b> aceptó la transferencia: <b>${escapeHtml(store)}</b> ya es de esa cuenta.</p>
       <p>${keptAccess ? "Seguís entrando a la tienda como miembro del equipo, con acceso a todas las secciones." : "Tu login ya no tiene acceso a esta tienda."}</p>
       <p>Si el Mercado Pago conectado a la tienda es tuyo, los cobros siguen entrando ahí hasta que la nueva cuenta conecte el suyo.</p>
       <p style="margin-top:14px;color:#6b7280;font-size:13px;">Si no fuiste vos, respondé este mail cuanto antes.</p>`
    : `<p><b>${escapeHtml(dest)}</b> rechazó la transferencia de <b>${escapeHtml(store)}</b>. La tienda sigue siendo tuya y no cambió nada.</p>`;
  const html = baseTemplate({ title, body, brand: "Recurrentes", accent: "#10b981" });
  return sendEmail({ from: platformFrom(), to, subject: title, html, tags: { type: accepted ? "store_transfer_accepted" : "store_transfer_declined" } });
}

// ─── Aviso al COMERCIANTE por mail (Configuración → Avisos para vos, _lib/merchantAlerts.js):
// alta / pausa / baja / renovación rechazada. Mismo texto que la plantilla de WhatsApp; es el
// respaldo mientras no hay WhatsApp (o si falla) y la casilla "también por mail".
const ALERT_SUBJECT = { wa_paused: "WhatsApp en pausa: llegaste al tope del plan gratis", subscribed: "Nueva suscripción", paused: "Suscripción pausada", cancelled: "Suscripción cancelada", payment_failed: "Pago rechazado de una renovación" };
export async function emailMerchantAlert({ to, event, text, storeName, customerName, panelUrl, test = false }) {
  const store = plain(storeName, 60) || "tu tienda";
  const who = plain(customerName, 40);
  const title = `${test ? "[Prueba] " : ""}${ALERT_SUBJECT[event] || "Aviso"}${who ? ` de ${who}` : ""} · ${store}`;
  const body = String(text || "").split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("");
  const html = baseTemplate({
    title, body,
    ctaLabel: panelUrl ? "Ver en Recurrentes" : undefined,
    ctaUrl: panelUrl || undefined,
    brand: "Recurrentes", accent: "#10b981",
    footerNote: "Te llega porque prendiste los avisos en Configuración → Avisos para vos. Los podés apagar desde ahí.",
  });
  return sendEmail({ from: platformFrom(), to, subject: title, html, tags: { type: "merchant_alert", event: event || "na" } });
}

// ─── Verificación de mail de una cuenta nueva (reemplaza el mail en inglés de Firebase) ──
export async function emailVerifyAccount({ to, name, link }) {
  const who = plain(name, 40).split(" ")[0];
  const title = "Confirmá tu email para entrar a Recurrentes";
  const body = `
    <p>${who ? `Hola ${escapeHtml(who)}, ` : "Hola, "}ya casi está. Tocá el botón para confirmar que este mail es tuyo y entrar a tu panel.</p>
    <p style="margin-top:14px;color:#6b7280;font-size:13px;">El link vence en unas horas. Si no creaste una cuenta en Recurrentes, ignorá este mail y no pasa nada.</p>`;
  const html = baseTemplate({
    title, body,
    ctaLabel: "Confirmar mi email",
    ctaUrl: link,
    brand: "Recurrentes", accent: "#10b981",
    footerNote: "Recurrentes · suscripciones con cobro automático para tiendas online de Argentina.",
  });
  return sendEmail({ from: platformFrom(), to, subject: title, html, tags: { type: "verify_email" } });
}

// ─── Aviso INTERNO al equipo de Recurrentes (ramal admin) ────────────────────
// Respaldo del WhatsApp al admin (sin número de Recurrentes cargado, plantilla
// sin aprobar o error de Meta). `to` = mails de ADMIN_EMAILS (o ADMIN_EMAIL).
export async function emailAdminAlert({ to, event, text, storeName, panelUrl }) {
  const store = plain(storeName, 60) || "una tienda";
  const title = `[Recurrentes] ${plain(event, 60) || "Aviso"} · ${store}`;
  const body = String(text || "").split(/\n{2,}/).map(p => `<p style="margin:0 0 12px;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("");
  const html = baseTemplate({
    title, body,
    ctaLabel: panelUrl ? "Abrir el Admin" : undefined,
    ctaUrl: panelUrl || undefined,
    brand: "Recurrentes", accent: "#10b981",
    footerNote: "Aviso interno de Recurrentes: te llega porque tu mail está en ADMIN_EMAILS.",
  });
  return sendEmail({ from: platformFrom(), to, subject: title, html, tags: { type: "admin_alert", event: "admin" } });
}

// ─── Aviso al COMERCIANTE: se cobró pero la orden no se creó (_lib/fulfillretry.js).
// Uno solo por cobro (el dedup lo hace el que llama). `platform:true` → versión
// interna para PLATFORM_ALERT_EMAIL, sin datos del cliente.
export async function emailOrderFailedAlert({ to, merchant, merchantId, customerName, productTitle, amount, paymentId, error, panelUrl, retrying = false, needsReview = false, platform = false }) {
  const store = plain(effectiveBrand(merchant) || merchant?.shopify_shop || "", 60) || "tu tienda";
  const prod = plain(productTitle, 80);
  const reason = plain(error, 400) || "sin detalle";
  const title = platform ? `Orden sin crear · ${store}` : "Se cobró una suscripción pero la orden no se creó";
  const row = (k, v) => `<tr><td style="padding:4px 10px 4px 0;color:#6b7280;white-space:nowrap;">${escapeHtml(k)}</td><td style="padding:4px 0;color:#111827;font-weight:600;">${escapeHtml(v || "—")}</td></tr>`;
  const next = needsReview
    ? "Un reintento automático se cortó a mitad. Antes de reintentar, fijate en Shopify si la orden ya existe (buscá el pago en las notas del pedido)."
    : retrying
      ? "Vamos a reintentar solos durante las próximas horas. Si el motivo es de configuración (Shopify desconectado, producto o variante borrados), arreglalo y tocá «Reintentar orden» en Cobros."
      : "Arreglá el motivo (por ejemplo, reconectá Shopify o revisá que el producto exista) y tocá «Reintentar orden» en Cobros.";
  const body = platform ? `
    <p>La tienda <b>${escapeHtml(store)}</b> tiene un cobro aprobado sin orden.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:13px;margin:8px 0 14px;">
      ${row("Merchant", merchantId)}${row("Pago MP", paymentId)}${row("Monto", fmtArs(amount))}${row("Reintento automático", retrying ? "sí" : "no")}
    </table>
    <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;">Motivo: ${escapeHtml(reason)}</p>` : `
    <p>Mercado Pago cobró <b>${fmtArs(amount)}</b>${customerName ? ` a <b>${escapeHtml(plain(customerName, 80))}</b>` : ""}${prod ? ` (${escapeHtml(prod)})` : ""}, pero no pudimos crear la orden en tu tienda.</p>
    <p style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px;">Motivo: ${escapeHtml(reason)}</p>
    <p>${escapeHtml(next)}</p>
    <p style="color:#6b7280;font-size:13px;">Pago de Mercado Pago: ${escapeHtml(String(paymentId || ""))}</p>`;
  const html = baseTemplate({
    title, body,
    ctaLabel: panelUrl ? "Ver cobros con error" : undefined,
    ctaUrl: panelUrl || undefined,
    brand: "Recurrentes", accent: "#10b981",
    footerNote: platform ? "Aviso interno de Recurrentes." : "Te avisamos una sola vez por cobro.",
  });
  return sendEmail({ from: platformFrom(), to, subject: title, html, tags: { type: platform ? "platform_order_alert" : "order_alert" } });
}
