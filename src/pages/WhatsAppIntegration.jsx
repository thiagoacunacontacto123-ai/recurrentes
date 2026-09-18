import React, { useState, useEffect } from "react";
import { apiGet, apiPost } from "../lib/api.js";
import { DS } from "../ui/theme.js";
import { Btn, Field, InputStyle, Spinner, Callout, Hint, CheckLine, DSToggle, appConfirm, toast } from "../ui/components.jsx";
import { MONO, fmtDateShort } from "./_shared.jsx";
import { FLOW_VARIABLES } from "../../shared/platform/flows.js";
import { WA_TEMPLATES } from "../../shared/platform/whatsapp.js";

// ─── WhatsApp (Configuración → Integraciones → Mensajes) ─────────────
// Por defecto: UN interruptor, "Avisos por WhatsApp desde el número de Recurrentes"
// (POST /api/merchant?action=whatsapp-platform). El comerciante no configura nada de Meta:
// los avisos salen del número de Recurrentes a nombre de su tienda y el costo se suma a su plan.
// Avanzado: "¿Preferís usar tu propio número?" abre el modal de siempre (Phone number ID +
// WABA ID + token permanente → whatsapp-save). Backend: _lib/whatsappApi.js.
// Integrations.jsx le pasa sus piezas (Row, Modal, Steps…) por `ui` para verse igual.

const F = "'Inter',system-ui,sans-serif";
const QUALITY = { GREEN: ["Alta", "green"], YELLOW: ["Media", "yellow"], RED: ["Baja", "red"] };
const varLabel = (k) => FLOW_VARIABLES.find(v => v.key === k)?.label || k;
// US$ con 2 a 4 decimales (un aviso cuesta centavos).
export const fmtUsdSmall = (n) => "US$ " + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fmtUsd2 = (n) => "US$ " + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "WhatsApp este mes: N avisos · US$ X (se suma a tu plan)". La usan esta fila y Facturación.
export function WhatsAppUsageLine({ T, merchant, style = {} }) {
  const sender = merchant?.whatsapp_sender || null;
  const [u, setU] = useState(null);
  useEffect(() => {
    if (!sender) return;
    let alive = true;
    apiGet("merchant", { action: "whatsapp-usage" }).then(d => { if (alive && d && !d.error) setU(d.usage || null); }).catch(() => {});
    return () => { alive = false; };
  }, [sender]);
  if (!sender) return null;
  const n = u?.wa_sent || 0;
  const text = sender === "platform"
    ? <>WhatsApp este mes: <b style={{ color: T.text }}>{n.toLocaleString("es-AR")} aviso{n === 1 ? "" : "s"}</b> · <b style={{ color: T.text }}>{fmtUsd2(u?.wa_cost_usd)}</b> (se suma a tu plan)</>
    : <>WhatsApp este mes: <b style={{ color: T.text }}>{n.toLocaleString("es-AR")} aviso{n === 1 ? "" : "s"}</b> desde tu número (los paga tu cuenta de Meta)</>;
  return <div style={{ fontSize: DS.font.sm, color: T.textMd, lineHeight: 1.5, ...style }}>{u ? text : <span style={{ color: T.textSm }}>WhatsApp este mes: cargando…</span>}</div>;
}

export function WhatsAppRow({ T, merchant, onChange, ui }) {
  const m = merchant || {};
  // Con número propio conectado se muestra la fila avanzada de siempre.
  if (m.whatsapp_connected) return <OwnNumberRow T={T} merchant={m} onChange={onChange} ui={ui}/>;
  return <PlatformRow T={T} merchant={m} onChange={onChange} ui={ui}/>;
}

// ── Número de Recurrentes: un interruptor ──
function PlatformRow({ T, merchant: m, onChange, ui }) {
  const { Row, A, S } = ui;
  const available = Boolean(m.whatsapp_platform_available);
  const enabled = Boolean(m.whatsapp_platform_enabled) && available;
  const isOwner = !m.role || m.role === "owner";
  const [open, setOpen] = useState(!enabled && available);
  const [optin, setOptin] = useState(Boolean(m.whatsapp_platform_optin_at));
  const [busy, setBusy] = useState(false);
  const [ownModal, setOwnModal] = useState(false);
  const small = { fontSize: DS.font.sm, color: T.textSm, lineHeight: 1.55 };
  const price = fmtUsdSmall(m.whatsapp_charge_usd);

  async function toggle() {
    if (!isOwner) return toast("Solo el dueño de la tienda puede prender o apagar los avisos", "warning");
    if (!available) return;
    const next = !enabled;

    if (!next && !await appConfirm("Tus clientes dejan de recibir los avisos por WhatsApp. Tus flujos quedan como están y los podés volver a prender cuando quieras.", { title: "¿Apagar los avisos por WhatsApp?", okLabel: "Apagar" })) return;
    setBusy(true);
    // Prenderlo es el consentimiento (se guarda la fecha): sin casilla ni botón aparte.
    const d = await apiPost("merchant", { enabled: next, optin_confirmed: true }, { action: "whatsapp-platform" });
    setBusy(false);
    if (d?.error) return toast("Error: " + d.error, "error", 7000);
    toast(next ? "Avisos por WhatsApp prendidos. Elegí cuáles mandar en Flujos de WhatsApp." : "Avisos por WhatsApp apagados", next ? "success" : "info", 6000);
    onChange?.();
  }

  const sub = !available
    ? "Avisos por WhatsApp desde el número de Recurrentes. Muy pronto: estamos terminando de habilitar el número."
    : enabled ? `Prendido · tus clientes reciben los avisos a nombre de tu tienda · ${price} por aviso`
    : "Avisos por WhatsApp desde el número de Recurrentes. Sin configurar nada: lo prendés y listo.";

  const action = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        style={{ fontSize: 12, padding: "7px 12px", borderRadius: 8, border: `1px solid ${T.border}`, background: "transparent", color: T.textMd, cursor: "pointer", fontFamily: F, fontWeight: 600 }}>
        Detalles {open ? "▴" : "▾"}
      </button>
      <span title={!isOwner ? "Solo el dueño de la tienda" : !available ? "Muy pronto" : enabled ? "Apagar" : "Prender"}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: !available || !isOwner || busy ? 0.5 : 1, pointerEvents: !available || busy ? "none" : "auto" }}>
        {busy ? <Spinner size={12} color={T.textMd}/> : null}
        <DSToggle T={T} active={enabled} onToggle={toggle}/>
      </span>
    </span>
  );

  return (
    <>
      <Row T={T} id="whatsapp" label="WhatsApp" optional ready={enabled} sub={sub} action={action} open={open}>
        <div style={{ fontSize: DS.font.md, fontWeight: 700, color: T.text, marginBottom: 6 }}>Avisos por WhatsApp desde el número de Recurrentes</div>
        <div style={{ ...small, marginBottom: 10 }}>
          Cuando lo prendés, elegís en <a href="#/dashboard/whatsapp" style={{ color: T.accent, fontWeight: 700, textDecoration: "none" }}>Flujos de WhatsApp</a> qué avisos mandar: <S T={T}>carrito sin pagar</S>, <S T={T}>próximo cobro</S>, <S T={T}>pago rechazado</S>, <S T={T}>suscripción activa</S> y <S T={T}>renovación cobrada</S>. Ninguno viene prendido.
          Salen desde el número de Recurrentes, siempre con el nombre de tu tienda. Si un cliente responde, le contestamos solos que escriba a tu mail de atención al cliente.
        </div>
        <div style={{ ...small, marginBottom: 12 }}>
          Precio: <S T={T}>desde {price} por aviso</S>. <S T={T}>Se suma a tu plan a fin de mes.</S> Solo le llega a quien dejó su teléfono y no pidió la baja: quien responde BAJA deja de recibirlos.
        </div>
        {enabled && <WhatsAppUsageLine T={T} merchant={m} style={{ marginBottom: 12 }}/>}
        {!available && <Hint T={T} style={{ marginTop: 0 }}>Estamos terminando de habilitar el número de Recurrentes con Meta. Mientras tanto podés usar tu propio número.</Hint>}
      </Row>
      {ownModal && <OwnNumberModal T={T} merchant={m} onChange={onChange} ui={ui} onClose={() => setOwnModal(false)}/>}
    </>
  );
}

// ── Número propio (avanzado): modal para conectar ──
function OwnNumberModal({ T, merchant: m, onChange, ui, onClose }) {
  const { Modal, Steps, A, S } = ui;
  const iS = InputStyle(T);
  const on = Boolean(m.whatsapp_connected);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ phone_number_id: m.whatsapp_phone_number_id || "", waba_id: m.whatsapp_waba_id || "", access_token: "", app_secret: "", optin: Boolean(m.whatsapp_optin_confirmed_at) });
  const set = (k) => (e) => setF(x => ({ ...x, [k]: typeof e === "boolean" ? e : e.target.value }));
  const ids = (v) => v.replace(/\D/g, "");
  const ready = /^\d{5,25}$/.test(f.phone_number_id) && /^\d{5,25}$/.test(f.waba_id) && f.access_token.trim().length >= 20 && f.optin;
  const close = () => { if (!busy) onClose(); };

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
    onClose();
    onChange?.();
  }

  return (
    <Modal T={T} title={on ? "Cambiar credenciales de WhatsApp" : "Usar tu propio número de WhatsApp"} busy={busy} onClose={close} maxWidth={600}
      sub="Avanzado: con la API oficial de WhatsApp (Cloud API de Meta) y tu propio número. Pagás los mensajes directo a Meta. Si lo conectás, se usa en lugar del número de Recurrentes."
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
  );
}

// ── Número propio conectado (avanzado) ──
function OwnNumberRow({ T, merchant: m, onChange, ui }) {
  const { Row, CopyCode, A, S, btnStyles } = ui;
  const b = btnStyles(T);
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(false);

  async function disconnect() {
    const ok = await appConfirm("Los pasos de WhatsApp de tus flujos se saltean hasta que vuelvas a conectar (o prendas los avisos desde el número de Recurrentes). Tu cuenta y tus plantillas en Meta quedan como están.", { title: "¿Desvincular WhatsApp?", danger: true, okLabel: "Desvincular" });
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
      <Row T={T} id="whatsapp" label="WhatsApp" optional connected error={Boolean(m.whatsapp_last_error)} open={open} onToggle={() => setOpen(o => !o)}
        sub={`${m.whatsapp_display_phone || "Número conectado"}${m.whatsapp_verified_name ? ` · ${m.whatsapp_verified_name}` : ""} · tu propio número · avisos a tus clientes desde los flujos`}
        onDisconnect={disconnect}>
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
        <WhatsAppUsageLine T={T} merchant={m} style={{ marginBottom: 12 }}/>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href="#/dashboard/flujos" style={{ ...b.ghost, textDecoration: "none", display: "inline-block" }}>Usarlo en un flujo →</a>
          <button type="button" style={b.ghost} onClick={() => setModal(true)}>Cambiar credenciales</button>
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
          Con tu propio número, Meta cobra cada plantilla entregada a la tarjeta de tu cuenta de WhatsApp Business (las de utilidad son las más baratas). Recurrentes no suma costo.
          Si desvinculás tu número, podés prender los avisos desde el número de Recurrentes.
        </Hint>
      </Row>
      {modal && <OwnNumberModal T={T} merchant={m} onChange={onChange} ui={ui} onClose={() => setModal(false)}/>}
    </>
  );
}
