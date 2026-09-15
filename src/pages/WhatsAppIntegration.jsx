import React, { useState } from "react";
import { apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, Field, InputStyle, Spinner, Callout, Hint, CheckLine, appConfirm, toast } from "../ui/components.jsx";
import { MONO, fmtDateShort } from "./_shared.jsx";
import { FLOW_VARIABLES } from "../../shared/platform/flows.js";
import { WA_TEMPLATES } from "../../shared/platform/whatsapp.js";

// ─── WhatsApp (Configuración → Integraciones → Mensajes) ─────────────
// Fila + modal para conectar la API oficial de WhatsApp (Cloud API de Meta) pegando
// Phone number ID + WABA ID + token permanente. Backend: /api/merchant?action=whatsapp-*
// (_lib/whatsappApi.js). Integrations.jsx le pasa sus piezas (Row, Modal, Steps…) por
// `ui` para verse igual que el resto sin duplicarlas.
// Futuro: "Conectar en 1 clic" con Embedded Signup de Meta (hace falta que Recurrentes
// sea Tech Provider); ver WHATSAPP.md.

const F = "'Inter',system-ui,sans-serif";
const QUALITY = { GREEN: ["Alta", "green"], YELLOW: ["Media", "yellow"], RED: ["Baja", "red"] };
const varLabel = (k) => FLOW_VARIABLES.find(v => v.key === k)?.label || k;

export function WhatsAppRow({ T, merchant, onChange, ui }) {
  const { Row, Modal, Steps, CopyCode, A, S, btnStyles } = ui;
  const b = btnStyles(T);
  const iS = InputStyle(T);
  const m = merchant || {};
  const on = Boolean(m.whatsapp_connected);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ phone_number_id: "", waba_id: "", access_token: "", app_secret: "", optin: false });
  const set = (k) => (e) => setF(x => ({ ...x, [k]: typeof e === "boolean" ? e : e.target.value }));
  const ids = (v) => v.replace(/\D/g, "");
  const ready = /^\d{5,25}$/.test(f.phone_number_id) && /^\d{5,25}$/.test(f.waba_id) && f.access_token.trim().length >= 20 && f.optin;
  const openModal = () => {
    setF({ phone_number_id: m.whatsapp_phone_number_id || "", waba_id: m.whatsapp_waba_id || "", access_token: "", app_secret: "", optin: Boolean(m.whatsapp_optin_confirmed_at) });
    setModal(true);
  };
  const close = () => { if (!busy) setModal(false); };

  async function save() {
    if (!ready) return toast("Completá los dos identificadores, el token y la confirmación", "warning");
    setBusy(true);
    const d = await apiPost("merchant", {
      phone_number_id: f.phone_number_id.trim(), waba_id: f.waba_id.trim(), access_token: f.access_token.trim(),
      app_secret: f.app_secret.trim(), optin_confirmed: f.optin,
    }, { action: "whatsapp-save" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 8000);
    toast(`WhatsApp conectado${d.whatsapp_display_phone ? ` (${d.whatsapp_display_phone})` : ""}`, "success");
    setModal(false);
    onChange?.();
  }
  async function disconnect() {
    const ok = await appConfirm("Los pasos de WhatsApp de tus flujos se saltean hasta que vuelvas a conectar. Tu cuenta y tus plantillas en Meta quedan como están.", { title: "¿Desvincular WhatsApp?", danger: true, okLabel: "Desvincular" });
    if (!ok) return;
    const d = await apiPost("merchant", {}, { action: "whatsapp-disconnect" });
    if (d?.error) toast("Error: " + d.error, "error"); else { toast("WhatsApp desvinculado", "warning"); setOpen(false); onChange?.(); }
  }

  const webhookUrl = `${window.location.origin}/api/public?action=wa-webhook&merchant=${encodeURIComponent(m.id || "")}`;
  const q = QUALITY[m.whatsapp_quality];
  const small = { fontSize: DS.font.sm, color: T.textSm, lineHeight: 1.55 };
  const H = ({ children, first }) => <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.9, color: T.textSm, margin: first ? "0 0 8px" : "18px 0 8px" }}>{children}</div>;

  return (
    <>
      <Row T={T} id="whatsapp" label="WhatsApp" optional connected={on} error={on && Boolean(m.whatsapp_last_error)} open={open} onToggle={() => setOpen(o => !o)}
        sub={on ? `${m.whatsapp_display_phone || "Número conectado"}${m.whatsapp_verified_name ? ` · ${m.whatsapp_verified_name}` : ""} · avisos a tus clientes desde los flujos`
          : "Avisale a tus clientes por WhatsApp antes de cada cobro o si el pago falla. API oficial de Meta, con tu propio número."}
        onConnect={openModal} onDisconnect={disconnect}>
        {m.whatsapp_last_error && (
          <Callout T={T} tone="danger" title="Último error de WhatsApp" style={{ marginBottom: 12 }}>
            {m.whatsapp_last_error}{m.whatsapp_last_error_at ? ` · ${fmtDateShort(m.whatsapp_last_error_at)}` : ""}
          </Callout>
        )}
        <div style={{ fontSize: DS.font.md, color: T.textMd, lineHeight: 1.7, marginBottom: 12 }}>
          Número: <S T={T}>{m.whatsapp_display_phone || "—"}</S>{m.whatsapp_verified_name ? <> · {m.whatsapp_verified_name}</> : null}<br/>
          {q && <>Calidad según Meta: <span style={{ color: T[q[1]], fontWeight: 700 }}>{q[0]}</span> · </>}
          {m.whatsapp_connected_at ? `Conectado el ${fmtDateShort(m.whatsapp_connected_at)}` : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="#/dashboard/flujos" style={{ ...b.ghost, textDecoration: "none", display: "inline-block" }}>Usarlo en un flujo →</a>
          <button type="button" style={b.ghost} onClick={openModal}>Cambiar credenciales</button>
        </div>

        <H>Plantillas para mandar a aprobar en Meta</H>
        <div style={small}>
          Fuera de una conversación abierta, WhatsApp solo deja mandar <S T={T}>plantillas aprobadas</S>. Crealas en{" "}
          <A T={T} href="https://business.facebook.com/wa/manage/message-templates/">WhatsApp Manager → Plantillas</A> con
          categoría <S T={T}>Utilidad</S>, idioma <S T={T}>Español (ARG)</S> y exactamente este texto. Meta las revisa en hasta 24 h.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          {WA_TEMPLATES.map(t => (
            <div key={t.name} style={{ border: `1px solid ${T.borderL}`, borderRadius: 10, padding: "10px 12px", background: T.card }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <code style={{ fontFamily: MONO, fontSize: DS.font.sm, fontWeight: 700, color: T.text }}>{t.name}</code>
                <span style={{ ...small, fontSize: 11 }}>{t.title} · Utilidad · es_AR</span>
              </div>
              <CopyCode T={T} text={t.body}/>
              <div style={{ ...small, fontSize: 11, marginTop: 6 }}>
                Pie: “{t.footer}” · {Object.entries(t.vars).map(([n, k]) => `{{${n}}} ${varLabel(k)}`).join(" · ")}
              </div>
            </div>
          ))}
        </div>

        <H>Entregas y bajas (webhook)</H>
        <div style={small}>
          Para ver si cada mensaje se entregó o se leyó, y para dar de baja a quien responda <S T={T}>BAJA</S>: en tu app de{" "}
          <A T={T} href="https://developers.facebook.com/apps/">developers.facebook.com</A> → WhatsApp → Configuración → Webhook → Editar,
          pegá esta URL y el token de verificación, y suscribí el campo <S T={T}>messages</S>.
        </div>
        <div style={{ marginTop: 8 }}><span style={{ ...small, fontWeight: 700 }}>URL de devolución de llamada</span><CopyCode T={T} text={webhookUrl}/></div>
        {m.whatsapp_verify_token && <div style={{ marginTop: 8 }}><span style={{ ...small, fontWeight: 700 }}>Token de verificación</span><CopyCode T={T} text={m.whatsapp_verify_token}/></div>}
        {!m.whatsapp_has_app_secret && (
          <Hint T={T} style={{ marginTop: 10, marginBottom: 0, color: T.yellow }}>
            Falta la clave secreta de tu app de Meta: sin ella no podemos verificar los avisos del webhook. Cargala en “Cambiar credenciales”.
          </Hint>
        )}
        <Hint T={T} style={{ marginTop: 12, marginBottom: 0 }}>
          Meta cobra cada plantilla entregada a la tarjeta de tu cuenta de WhatsApp Business (las de utilidad son las más baratas). Recurrentes no suma costo.
          Próximamente: conectar en 1 clic con tu cuenta de Meta, sin copiar identificadores.
        </Hint>
      </Row>

      {modal && (
        <Modal T={T} title={on ? "Cambiar credenciales de WhatsApp" : "Conectar WhatsApp"} busy={busy} onClose={close} maxWidth={600}
          sub="Con la API oficial de WhatsApp (Cloud API de Meta) y tu propio número. Los avisos salen desde los flujos."
          footer={<>
            <Btn T={T} variant="secondary" onClick={close} disabled={busy}>Cancelar</Btn>
            <Btn T={T} variant="solid" onClick={save} disabled={busy || !ready}>{busy ? <><Spinner size={12}/> Validando…</> : "Conectar"}</Btn>
          </>}>
          <Steps T={T} title="Qué necesitás de Meta (una sola vez)">
            <li>Tu negocio verificado en <A T={T} href="https://business.facebook.com/settings/security">Meta Business</A> (Configuración → Centro de seguridad).</li>
            <li>En <A T={T} href="https://developers.facebook.com/apps/">developers.facebook.com/apps</A> creá una app tipo <S T={T}>Empresa</S> y sumale el producto <S T={T}>WhatsApp</S>. Ahí elegís o creás tu cuenta de WhatsApp Business y agregás un número que <S T={T}>no</S> esté usando la app de WhatsApp del celular.</li>
            <li>En <S T={T}>WhatsApp → Configuración de la API</S> copiá el <S T={T}>identificador del número de teléfono</S> y el <S T={T}>identificador de la cuenta de WhatsApp Business</S>.</li>
            <li>Token que no vence: en <A T={T} href="https://business.facebook.com/settings/system-users">Usuarios del sistema</A> creá uno (Administrador), asignale la app y la cuenta de WhatsApp, y generá un token con vencimiento <S T={T}>Nunca</S> y los permisos <S T={T}>whatsapp_business_messaging</S>, <S T={T}>whatsapp_business_management</S> y <S T={T}>business_management</S>.</li>
            <li>Cargá un medio de pago en <A T={T} href="https://business.facebook.com/wa/manage/home/">WhatsApp Manager</A> y mandá a aprobar las plantillas que te sugerimos.</li>
          </Steps>
          <div className="stack-mobile" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 10px" }}>
            <Field T={T} label="Identificador del número (Phone number ID)">
              <input value={f.phone_number_id} onChange={e => setF(x => ({ ...x, phone_number_id: ids(e.target.value) }))} inputMode="numeric" placeholder="106540352242922" style={{ ...iS, fontFamily: MONO, fontSize: DS.font.md }} autoFocus disabled={busy}/>
            </Field>
            <Field T={T} label="Identificador de la cuenta (WABA ID)">
              <input value={f.waba_id} onChange={e => setF(x => ({ ...x, waba_id: ids(e.target.value) }))} inputMode="numeric" placeholder="102290129340398" style={{ ...iS, fontFamily: MONO, fontSize: DS.font.md }} disabled={busy}/>
            </Field>
          </div>
          <Field T={T} label="Token de acceso permanente">
            <input type="password" value={f.access_token} onChange={set("access_token")} placeholder="EAA…" style={{ ...iS, fontFamily: MONO, fontSize: DS.font.md }} disabled={busy} autoComplete="off"/>
          </Field>
          <Field T={T} label={<>Clave secreta de la app <span style={{ fontWeight: 500, color: T.textSm }}>(opcional: para ver entregas y bajas)</span></>}>
            <input type="password" value={f.app_secret} onChange={set("app_secret")} placeholder={m.whatsapp_has_app_secret ? "•••••• (ya cargada; dejalo vacío para no cambiarla)" : "Configuración de la app → Básica → Clave secreta"} style={{ ...iS, fontFamily: MONO, fontSize: DS.font.md }} disabled={busy} autoComplete="off"/>
          </Field>
          <CheckLine T={T} checked={f.optin} onChange={set("optin")} style={{ color: T.text, margin: "4px 0 12px" }}>
            Mis clientes aceptaron recibir avisos de mi negocio por WhatsApp (por ejemplo, en el checkout o en mis términos) y voy a respetar a quien pida la baja.
          </CheckLine>
          <Hint T={T} style={{ marginTop: 0 }}>
            Lo validamos con Meta sin mandar ningún mensaje, y nunca mostramos el token de vuelta. Los avisos solo salen a clientes con teléfono cargado; quien responde BAJA deja de recibirlos.
          </Hint>
        </Modal>
      )}
    </>
  );
}
