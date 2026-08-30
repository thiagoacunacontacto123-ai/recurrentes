// Email transaccional con Resend. Si RESEND_API_KEY no está seteado, las
// funciones son no-ops (no rompen el flow) — emails es feature opcional.
//
// Doc: https://resend.com/docs/api-reference/emails/send-email

const RESEND_API = "https://api.resend.com/emails";

async function sendEmail({ from, to, subject, html, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[email] skip (RESEND_API_KEY no configurada) — to=${to} subject="${subject}"`);
    return { skipped: true };
  }
  try {
    const r = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: from || process.env.EMAIL_FROM || "Recurrentes <[email protected]>",
        to: Array.isArray(to) ? to : [to],
        subject,
        html,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error(`[email] error ${r.status}:`, data);
      return { error: data.message || `HTTP ${r.status}` };
    }
    return { id: data.id };
  } catch (e) {
    console.error("[email] network error:", e.message);
    return { error: e.message };
  }
}

// Template base. Mantener simple — inline styles, dark mode friendly,
// markup mínimo (Gmail/Outlook).
function baseTemplate({ title, body, ctaLabel, ctaUrl, footerNote, brand, accent }) {
  const brandName = brand || "🔁 Recurrentes";
  const col = accent || "#10b981";
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
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#9ca3af;">${brand ? escapeHtml(brand) : "Recurrentes — gestión de suscripciones recurrentes"}</div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
// Saludo que no deja "Hola ," cuando falta el nombre del cliente.
function greet(name) {
  const n = String(name || "").trim();
  return n ? `Hola ${escapeHtml(n)},` : "¡Hola! 👋";
}
function escapeAttr(s) { return escapeHtml(s); }

// ─── Templates ───────────────────────────────────────────────────

export async function emailSubscriptionActivated({ to, customerName, productTitle, frequencyDays, amount, portalUrl }) {
  const html = baseTemplate({
    title: `¡Tu suscripción a ${productTitle} está activa!`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Recibimos la confirmación de tu pago. Ya estás suscrito a <strong>${escapeHtml(productTitle)}</strong>.</p>
      <p style="background:#ecfdf5;border:1px solid #10b98133;border-radius:10px;padding:14px;margin:18px 0;">
        <strong>Resumen:</strong><br/>
        $${(amount||0).toLocaleString("es-AR")} cada ${frequencyDays} días<br/>
        Cancelá o pausá cuando quieras desde el link de abajo.
      </p>
      <p>En los próximos días vas a recibir tu primer envío con los datos de la dirección que cargaste.</p>
    `,
    ctaLabel: "Gestionar mi suscripción",
    ctaUrl: portalUrl,
    footerNote: "Si no reconocés esta compra, respondé a este email.",
  });
  return sendEmail({ to, subject: `¡Suscripción activa — ${productTitle}!`, html });
}

export async function emailSubscriptionCancelled({ to, customerName, productTitle }) {
  const html = baseTemplate({
    title: `Cancelamos tu suscripción`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Confirmamos que <strong>${escapeHtml(productTitle)}</strong> fue cancelada. No vamos a hacer más cobros.</p>
      <p>Si fue un error o cambiás de idea, podés volver al producto en la tienda y suscribirte de nuevo.</p>
    `,
    footerNote: "¿Querés contarnos por qué cancelaste? Respondé a este email — nos ayuda a mejorar.",
  });
  return sendEmail({ to, subject: `Tu suscripción a ${productTitle} fue cancelada`, html });
}

// Carrito de suscripción abandonado — secuencia de 3 pasos:
//   step 1 (15 min): recordatorio simple, sin cupón.
//   step 2 (2 hs):  con cupón (ej. VUELVO5 5% OFF).
//   step 3 (24 hs): última chance con cupón mayor (ej. ULTIMACHANCE15 15% OFF).
// brand/accent/from muestran la marca de la tienda (no "Recurrentes").
export async function emailAbandonedCheckout({ to, customerName, productTitle, amount, recoverUrl, brand, accent, from, step, couponCode, couponPct }) {
  step = step || 1;
  // Si no tenemos el nombre, saludamos sin dejar "Hola ," colgado.
  const nm = String(customerName || "").trim();
  const greeting = nm ? `Hola ${escapeHtml(nm)},` : "¡Hola! 👋";
  const prod = escapeHtml(productTitle);
  const box = (inner) => `<p style="background:#f0fdf4;border:1px solid #10b98133;border-radius:10px;padding:14px;margin:18px 0;">${inner}</p>`;
  let subject, title, extra, ctaLabel;

  if (step === 2) {
    subject = `Te guardamos tu ${productTitle} + un regalito 🎁`;
    title = `Seguís a tiempo — y con un extra 🎁`;
    extra = box(`Usá el código <strong>${escapeHtml(couponCode || "")}</strong> y te llevás <strong>${couponPct || 0}% OFF extra</strong>.<br/>Ya te lo dejamos aplicado en el link — retomás con tu pack elegido.`);
    ctaLabel = `Retomar con ${couponPct || 0}% OFF`;
  } else if (step === 3) {
    subject = `⏰ Última chance: ${couponPct || 0}% OFF en tu ${productTitle}`;
    title = `Última oportunidad: ${couponPct || 0}% OFF ⏰`;
    extra = box(`Es tu <strong>última chance</strong>. Con el código <strong>${escapeHtml(couponCode || "")}</strong> te llevás <strong>${couponPct || 0}% OFF</strong>.<br/>Ya está aplicado en el link, con tu pack elegido. No lo dejes pasar. 💜`);
    ctaLabel = `Aprovechar ${couponPct || 0}% OFF`;
  } else {
    subject = `¿Te olvidaste de algo? Tu ${productTitle} quedó pendiente`;
    title = `Te quedó tu ${productTitle} a mitad de camino 👀`;
    extra = box(`Retomás el pago en 1 clic, justo donde lo dejaste — con tu pack ya elegido.`);
    ctaLabel = "Retomar mi compra";
  }

  const html = baseTemplate({
    brand: brand || "", accent, title,
    body: `
      <p>${greeting}</p>
      <p>Vimos que empezaste tu suscripción a <strong>${prod}</strong> pero no llegaste a terminar el pago.</p>
      ${extra}
      <p>Te llega cómodo a tu casa y cancelás cuando quieras. 💜</p>
    `,
    ctaLabel,
    ctaUrl: recoverUrl,
    footerNote: "Si ya lo compraste o no te interesa, ignorá este mail. 🙌",
  });
  return sendEmail({ from, to, subject, html });
}

export async function emailPaymentFailed({ to, customerName, productTitle, portalUrl }) {
  const html = baseTemplate({
    title: `Tu pago no se pudo procesar`,
    body: `
      <p>${greet(customerName)}</p>
      <p>Intentamos cobrar tu suscripción a <strong>${escapeHtml(productTitle)}</strong> y no fue posible. Suele pasar por:</p>
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
  return sendEmail({ to, subject: `Hubo un problema con tu pago — ${productTitle}`, html });
}
