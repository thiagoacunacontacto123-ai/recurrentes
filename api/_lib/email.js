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
function baseTemplate({ title, body, ctaLabel, ctaUrl, footerNote }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f5f7f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="padding:24px 28px 12px;border-bottom:1px solid #e5e7eb;">
      <div style="font-size:20px;font-weight:800;color:#10b981;">🔁 Recurrentes</div>
    </td></tr>
    <tr><td style="padding:24px 28px;">
      <h1 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#111827;">${escapeHtml(title)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#374151;">${body}</div>
      ${ctaUrl && ctaLabel ? `
        <p style="margin:24px 0 0;">
          <a href="${escapeAttr(ctaUrl)}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:11px 22px;border-radius:10px;font-weight:700;font-size:14px;">${escapeHtml(ctaLabel)}</a>
        </p>
      ` : ""}
    </td></tr>
    ${footerNote ? `<tr><td style="padding:14px 28px;background:#f9fafb;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280;">${footerNote}</td></tr>` : ""}
  </table>
  <div style="text-align:center;margin-top:14px;font-size:11px;color:#9ca3af;">Recurrentes — gestión de suscripciones recurrentes</div>
</body></html>`;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

// ─── Templates ───────────────────────────────────────────────────

export async function emailSubscriptionActivated({ to, customerName, productTitle, frequencyDays, amount, portalUrl }) {
  const html = baseTemplate({
    title: `¡Tu suscripción a ${productTitle} está activa!`,
    body: `
      <p>Hola ${escapeHtml(customerName || "")},</p>
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
      <p>Hola ${escapeHtml(customerName || "")},</p>
      <p>Confirmamos que <strong>${escapeHtml(productTitle)}</strong> fue cancelada. No vamos a hacer más cobros.</p>
      <p>Si fue un error o cambiás de idea, podés volver al producto en la tienda y suscribirte de nuevo.</p>
    `,
    footerNote: "¿Querés contarnos por qué cancelaste? Respondé a este email — nos ayuda a mejorar.",
  });
  return sendEmail({ to, subject: `Tu suscripción a ${productTitle} fue cancelada`, html });
}

export async function emailPaymentFailed({ to, customerName, productTitle, portalUrl }) {
  const html = baseTemplate({
    title: `Tu pago no se pudo procesar`,
    body: `
      <p>Hola ${escapeHtml(customerName || "")},</p>
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
