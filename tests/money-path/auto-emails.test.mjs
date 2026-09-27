// Los tres mails automáticos, editables (27-sept-2026, Thiago).
//
// Activación, pago rechazado y baja salen SIEMPRE y no se pueden apagar, pero
// el texto es del comerciante. Lo que esto protege:
//   1. Al que NO los edita no le cambia nada. Son mails que ya salen hace meses:
//      nadie se despierta con otro texto porque nosotros movimos una plantilla.
//   2. Al que los edita le sale SU texto, con sus variables reemplazadas.
//   3. "Volver al texto original" borra lo suyo de verdad.
import "../helpers/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld, loadApi, MID, luminaMerchant } from "../helpers/world.mjs";
import { invoke } from "../helpers/http.mjs";
import { seedDoc, rawGet } from "../helpers/fake-firestore.mjs";

const { default: merchantApi } = await loadApi("api/merchant.js");
const { emailSubscriptionActivated, emailPaymentFailed, emailSubscriptionCancelled } = await loadApi("api/_lib/email.js");
const { resolveAutoEmail, sanitizeAutoEmails, AUTO_EMAILS } = await loadApi("shared/platform/flows.js");

let W;
beforeEach(() => { W = createWorld(); });
afterEach(() => { try { W.restore?.(); } catch (_) {} });

const guardar = (b) => invoke(merchantApi, { method: "PATCH", query: { action: "save-settings" }, headers: { authorization: `Bearer test:${MID}` }, body: b });
const ultimo = () => W.resend.toCustomer().at(-1);
const activar = (merchant) => emailSubscriptionActivated({
  to: "ana@cliente.test", customerName: "Ana Díaz", productTitle: "Café de especialidad 250 g",
  frequencyDays: 30, amount: 9480, portalUrl: "https://x.test/portal", merchant,
});

test("sin editar nada sale el mail de siempre, palabra por palabra", async () => {
  await activar(luminaMerchant());
  const m = ultimo();
  assert.match(m.subject, /Suscripción activa/);
  assert.match(m.html, /Recibimos la confirmación de tu pago/);
  // El de fábrica trae el recuadro de resumen: si esto desaparece, le cambiamos
  // el mail a todas las tiendas sin que nadie lo pidiera.
  assert.match(m.html, /Resumen:/);
});

test("editado: sale SU texto, con las variables reemplazadas", async () => {
  const merchant = luminaMerchant({ auto_emails: { activation: {
    subject: "Bienvenida a {{marca}}, {{nombre}}",
    body: "Hola {{nombre}}!\n\nYa tenés {{producto}} andando: {{monto}} {{frecuencia}}.",
    cta_label: "Ver mi suscripción",
  } } });
  await activar(merchant);
  const m = ultimo();
  assert.match(m.subject, /^Bienvenida a .+, Ana Díaz$/, m.subject);
  assert.match(m.html, /Ya tenés Café de especialidad 250 g andando/);
  assert.match(m.html, /\$\s?9\.480/, "el monto va formateado");
  assert.match(m.html, /cada 30 días/);
  assert.match(m.html, /Ver mi suscripción/);
  assert.ok(!/Resumen:/.test(m.html), "ya no sale el de fábrica");
});

test("los tres se pueden editar, no solo el de la confirmación", async () => {
  const merchant = luminaMerchant({ auto_emails: {
    payment_failed: { subject: "Ojo con tu pago", body: "No pudimos cobrar {{producto}}." },
    cancellation: { subject: "Te vamos a extrañar", body: "Cancelamos {{producto}}.", cta_label: "" },
  } });
  await emailPaymentFailed({ to: "ana@cliente.test", customerName: "Ana", productTitle: "Café", portalUrl: "https://x.test/p", merchant });
  assert.equal(ultimo().subject, "Ojo con tu pago");
  await emailSubscriptionCancelled({ to: "ana@cliente.test", customerName: "Ana", productTitle: "Café", merchant });
  assert.equal(ultimo().subject, "Te vamos a extrañar");
  assert.ok(!/href/.test(ultimo().html.split("Cancelamos")[1] || ""), "sin botón si lo dejó vacío");
});

test("un mail automático NO lleva link de baja: no es publicidad", async () => {
  // Darse de baja del aviso de que te rechazaron el pago no tiene sentido, y
  // encima lo pediría justo cuando más necesita enterarse.
  await emailPaymentFailed({ to: "ana@cliente.test", customerName: "Ana", productTitle: "Café", portalUrl: "https://x.test/p",
    merchant: luminaMerchant({ auto_emails: { payment_failed: { subject: "Ojo", body: "Texto" } } }) });
  const m = ultimo();
  assert.ok(!/action=unsub/.test(m.html), "sin link de baja en el cuerpo");
  assert.ok(!(m.headers && m.headers["List-Unsubscribe"]), "ni en las cabeceras");
});

test("el panel guarda el texto y 'volver al original' lo borra", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant());
  let r = await guardar({ auto_emails: { activation: { subject: "  Mi   asunto ", body: "Mi cuerpo", cta_label: "Ver" } } });
  assert.equal(r.statusCode, 200, JSON.stringify(r.body));
  assert.equal(rawGet(`merchants/${MID}`).auto_emails.activation.subject, "Mi asunto", "se limpian los espacios de más");

  r = await guardar({ auto_emails: null });
  assert.equal(r.statusCode, 200);
  assert.equal(rawGet(`merchants/${MID}`).auto_emails, null, "volvió al de fábrica");
});

test("no se puede inventar un mail automático que no existe", async () => {
  seedDoc(`merchants/${MID}`, luminaMerchant());
  const r = await guardar({ auto_emails: { renovacion: { subject: "x", body: "y" } } });
  assert.equal(r.statusCode, 400);
  assert.match(r.body.error, /no existe/i);
  assert.equal(rawGet(`merchants/${MID}`).auto_emails, undefined);
});

test("editar solo el asunto deja el cuerpo de fábrica (es parcial)", () => {
  const t = resolveAutoEmail("activation", { auto_emails: { activation: { subject: "Solo el asunto" } } });
  assert.equal(t.subject, "Solo el asunto");
  assert.equal(t.body, AUTO_EMAILS.find(m => m.id === "activation").body);
  assert.equal(t.editado, true);
});

test("el saneo corta los largos y no deja pasar cualquier cosa", () => {
  const r = sanitizeAutoEmails({ activation: { subject: "a".repeat(500), body: "b".repeat(5000), cta_label: "c".repeat(200) } });
  assert.equal(r.auto_emails.activation.subject.length, 150);
  assert.equal(r.auto_emails.activation.body.length, 2000);
  assert.equal(r.auto_emails.activation.cta_label.length, 40);
  assert.equal(sanitizeAutoEmails(null).auto_emails, null);
  assert.ok(sanitizeAutoEmails([]).error, "una lista no es un objeto de mails");
  // Todo vacío = como si no hubiera editado nada.
  assert.equal(sanitizeAutoEmails({ activation: { subject: "  ", body: "" } }).auto_emails, null);
});
