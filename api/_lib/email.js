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
    replyTo: replyTo || merchant?.email_reply_to || undefined,
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
function baseTemplate({ title, body, ctaLabel, ctaUrl, footerNote, brand, accent, unsubUrl }) {
  const brandName = brand || "Tu tienda";
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
    ${footerNote ? `<tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${footerNote}</td></tr>` : ""}
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
    brand: snd.brand, accent: snd.accent,
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
    footerNote: "Si no reconocés esta compra, respondé a este email.",
  });
  return sendEmail({ from: snd.from, replyTo: snd.replyTo, to, subject: `¡Suscripción activa — ${prodTxt}!`, html, tags: { type: "activation" } });
}

// Lista para llamarse desde public.js (portal) y subscribers.js (dashboard).
export async function emailSubscriptionCancelled({ to, customerName, productTitle, merchant, from, brand, accent, replyTo }) {
  const snd = resolveSender({ merchant, from, brand, accent, replyTo });
  const prodTxt = plain(productTitle) || "tu suscripción";
  const html = baseTemplate({
    brand: snd.brand, accent: snd.accent,
    title: `Cancelamos tu suscripción`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Confirmamos que tu suscripción a <strong>${escapeHtml(prodTxt)}</strong> fue cancelada. No vamos a hacer más cobros.</p>
      <p>Si fue un error o cambiás de idea, podés volver al producto en la tienda y suscribirte de nuevo.</p>
    `,
    footerNote: "¿Querés contarnos por qué cancelaste? Respondé a este email — nos ayuda a mejorar.",
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
    brand: snd.brand, accent: snd.accent, title, unsubUrl,
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
    brand: snd.brand, accent: snd.accent,
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
export async function emailPlanRequest({ to, merchantEmail, merchantId, storeName, plan, planLabel, usd, ordersThisMonth, currentPlan, requesterEmail }) {
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
      ${row("Pedidos este mes", String(ordersThisMonth ?? 0))}
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
  });
  return sendEmail({ from: process.env.EMAIL_FROM || DEFAULT_FROM, replyTo: merchantEmail || undefined, to, subject: title, html, tags: { type: "plan_request", plan } });
}
