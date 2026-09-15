import { useState, useEffect, useMemo } from "react";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Btn, DSBadge, DSToggle, DSEmpty, Spinner, DSTable, CellStack, PageHeader, Field, InputStyle, Hint, Loading, toast } from "../ui/components.jsx";
import { KpiCard, Segmented, BarList, Panel } from "../ui/charts.jsx";
import { goPlanesWidget, goConfigSection } from "../lib/onboarding.js";
import { MONO, fmtDateShort, copyText, hashQuery } from "./_shared.jsx";
import { merchantProfile } from "../../shared/platform/profile.js";

const DAY = 86400000;
const KLAVIYO = "#8b5cf6";
const fmtN = (n) => Math.round(Number(n) || 0).toLocaleString("es-AR");

// Secciones (píldoras): #/dashboard/portal?sec=apariencia|mensajes|registro
// (el alias viejo "actividad" ya apunta a ?sec=registro).
const SECS = ["acciones", "apariencia", "mensajes", "registro"];
const readSec = () => { const s = hashQuery().get("sec"); return SECS.includes(s) ? s : "acciones"; };

// Acciones que el cliente puede hacer solo. La dirección solo aplica si el negocio envía algo.
const portalActions = (profile) => [
  { key:"allow_pause",   icon:"⏸", title:"Pausar la suscripción", desc:"Salta los próximos cobros y la retoma cuando quiera." },
  { key:"allow_cancel",  icon:"✕", title:"Cancelar",               desc:"Pasa por el flujo de retención si lo activaste." },
  ...(profile.caps.shipping ? [{ key:"allow_address", icon:"📍", title:"Cambiar la dirección", desc: profile.caps.orders ? `Se usa en las próximas órdenes de ${profile.channelInfo.label}.` : "Se usa en los próximos envíos." }] : []),
  { key:"allow_date",    icon:"📅", title:"Cambiar la fecha de cobro", desc:"Adelantar o atrasar el próximo cobro.", soon:true },
  { key:"allow_skip",    icon:"⏭", title: profile.caps.shipping ? "Saltar un envío" : "Saltar un ciclo", desc:"Se saltea un ciclo sin pausar.", soon:true },
];

async function saveSettings(body) {
  const r = await apiPatch("merchant", body, { action: "save-settings" });
  if (r?.error) throw new Error(typeof r.error === "string" ? r.error : "Error del servidor");
  return r;
}

const SaveBtn = ({ T, dirty, saving, onClick }) => (
  <>
    {dirty && <DSBadge T={T} color={T.yellow} size="sm">Cambios sin guardar</DSBadge>}
    <Btn T={T} variant="solid" size="sm" onClick={onClick} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>
  </>
);

// ─── Página: Portal del cliente — estilo Growith: KPIs arriba y las cuatro
// partes (acciones · apariencia · mensajes · registro) en píldoras.
export function CustomerPortalPage({ merchant, reloadMerchant, goTab }) {
  const T = useT();
  const profile = useMemo(() => merchantProfile(merchant), [merchant]);
  const [sec, setSec] = useState(readSec);
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);

  async function loadActivity() {
    setLoading(true);
    const d = await apiGet("stats", { action: "activity" }).catch(() => null);
    setActivity(d && !d.error ? d : {});
    setLoading(false);
  }
  useEffect(() => { loadActivity(); }, []);
  // Links internos que cambian solo el hash (ej. el alias viejo "actividad" → ?sec=registro) con la página abierta.
  useEffect(() => {
    const onHash = () => { if (/^#\/dashboard\/portal/.test(window.location.hash || "")) setSec(readSec()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const goSec = (id) => {
    setSec(id);
    try { window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/portal${id === "acciones" ? "" : "?sec=" + id}`); } catch (_) {}
  };

  // Sin secuencia propia de abandono: esos mails históricos no se muestran.
  const mails = useMemo(() => (activity?.mails || []).filter(m => m.type !== "abandoned"), [activity]);
  const sent = useMemo(() => mails.filter(m => m.status !== "error"), [mails]);
  const mailErrors = mails.length - sent.length;
  const ks = activity?.klaviyo_summary || {};
  const klaviyo = Boolean(merchant?.klaviyo_connected);
  // Mails enviados por día, últimos 30 (para la sparkline).
  const spark = useMemo(() => {
    const days = Array(30).fill(0), now = Date.now();
    for (const m of sent) { const d = Math.floor((now - Date.parse(m.created_at || "")) / DAY); if (d >= 0 && d < 30) days[29 - d]++; }
    return days;
  }, [sent]);
  const sent30 = spark.reduce((a, b) => a + b, 0);

  const saved = merchant?.portal || {};
  const actions = portalActions(profile).filter(a => !a.soon);
  const enabled = actions.filter(a => saved[a.key] !== false);
  const first = loading && !activity;

  const tabs = [
    { id:"acciones",   label:"Acciones" },
    { id:"apariencia", label:"Apariencia" },
    { id:"mensajes",   label:"Mensajes" },
    { id:"registro",   label:"Registro", count: first ? null : mails.length },
  ];

  return (
    <div>
      <PageHeader T={T} title="Portal del cliente" subtitle="Lo que tus clientes pueden hacer solos desde el link que reciben por mail, cómo se ve, y los mensajes que les mandamos."/>

      <div className="kpi-grid" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap:10, marginBottom:16 }}>
        <KpiCard T={T} label="Acciones habilitadas" value={`${enabled.length} de ${actions.length}`} color={T.accentSolid}
          hint={enabled.length ? enabled.map(a => a.title.split(" ")[0].toLowerCase()).join(" · ") : "el cliente no puede hacer nada solo"} onClick={() => goSec("acciones")}/>
        <KpiCard T={T} loading={first} label="Mails enviados · 30 días" value={fmtN(sent30)} spark={spark} color={T.accentSolid}
          hint={`${fmtN(mails.length)} en el registro`} onClick={() => goSec("registro")}/>
        <KpiCard T={T} loading={first} label="Eventos a Klaviyo" value={klaviyo ? fmtN(ks.sent) : "—"} color={KLAVIYO}
          hint={klaviyo ? (ks.error ? `${fmtN(ks.error)} con error` : "todos enviados") : "Klaviyo sin conectar"} onClick={() => goSec("registro")}/>
        <KpiCard T={T} loading={first} label="Envíos con error" value={fmtN(mailErrors + (Number(ks.error) || 0))} valueColor={mailErrors + (Number(ks.error) || 0) ? T.red : T.text} color={T.red}
          hint="mails y eventos que no salieron" onClick={() => goSec("registro")}/>
      </div>

      <div style={{ marginBottom:14, maxWidth:"100%", overflowX:"auto" }}>
        <Segmented T={T} options={tabs} value={sec} onChange={goSec} ariaLabel="Sección del portal"/>
      </div>

      {/* Todas quedan montadas (solo se ocultan) para no perder cambios sin guardar al cambiar de píldora. */}
      <div hidden={sec !== "acciones"}><ActionsSection T={T} merchant={merchant} profile={profile} reloadMerchant={reloadMerchant}/></div>
      <div hidden={sec !== "apariencia"}><AppearanceSection T={T} merchant={merchant} profile={profile} reloadMerchant={reloadMerchant} goTab={goTab}/></div>
      <div hidden={sec !== "mensajes"}><MessagesSection T={T} merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab}/></div>
      <div hidden={sec !== "registro"}><RegistroSection T={T} merchant={merchant} activity={activity} mails={mails} loading={loading} reload={loadActivity} goTab={goTab}/></div>
    </div>
  );
}

// ─── (a) Acciones permitidas ───────────────────────────────────────
function ActionsSection({ T, merchant, profile, reloadMerchant }) {
  const saved = merchant?.portal || {};
  const init = () => ({ allow_pause: saved.allow_pause !== false, allow_cancel: saved.allow_cancel !== false, allow_address: saved.allow_address !== false });
  const [v, setV] = useState(init);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setV(init()); setDirty(false); /* eslint-disable-next-line */ }, [merchant?.id, merchant?.portal]);

  async function save() {
    setSaving(true);
    try { await saveSettings({ portal: v }); toast("Acciones del portal guardadas", "success"); setDirty(false); reloadMerchant?.(); }
    catch (e) { toast("No se pudo guardar: " + e.message, "error", 6000); }
    finally { setSaving(false); }
  }
  return (
    <Panel T={T} title="Acciones permitidas" sub="Qué puede hacer el cliente por su cuenta. Lo que apagues, lo tiene que pedir por mail."
      right={<SaveBtn T={T} dirty={dirty} saving={saving} onClick={save}/>}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(min(100%, 260px), 1fr))", gap:10 }}>
        {portalActions(profile).map(a => {
          const on = a.soon ? false : v[a.key] !== false;
          return (
            <div key={a.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:`1px solid ${on ? T.accent + "55" : T.border}`, borderRadius:12, background: on ? T.accent + "08" : T.surface, opacity: a.soon ? 0.6 : 1 }}>
              <span aria-hidden="true" style={{ fontSize:18, width:26, textAlign:"center" }}>{a.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text, display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>{a.title}{a.soon && <DSBadge T={T} color={T.yellow} size="sm">próximamente</DSBadge>}</div>
                <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{a.desc}</div>
              </div>
              {a.soon ? <DSToggle T={T} active={false} onToggle={() => {}}/> : <DSToggle T={T} active={on} onToggle={() => { setV({ ...v, [a.key]: !on }); setDirty(true); }}/>}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

// ─── (b) Apariencia y textos ───────────────────────────────────────
function AppearanceSection({ T, merchant, profile, reloadMerchant, goTab }) {
  const iS = InputStyle(T);
  const [brand, setBrand] = useState(merchant?.email_brand || merchant?.email_brand_effective || "");
  const [welcome, setWelcome] = useState(merchant?.portal_welcome || "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setBrand(merchant?.email_brand || merchant?.email_brand_effective || ""); setWelcome(merchant?.portal_welcome || ""); setDirty(false); }, [merchant?.id, merchant?.email_brand, merchant?.email_brand_effective, merchant?.portal_welcome]);
  const color = merchant?.widget_color || "#10b981";
  const example = `${window.location.origin}/#/portal?token=…`;
  const portal = merchant?.portal || {};
  const previewBtns = [
    profile.caps.shipping && portal.allow_address !== false && "Cambiar dirección",
    portal.allow_pause !== false && "Pausar",
    portal.allow_cancel !== false && "Cancelar",
  ].filter(Boolean).slice(0, 2);

  async function save() {
    setSaving(true);
    try { await saveSettings({ email_brand: brand.trim(), portal_welcome: welcome.trim().slice(0, 240) }); toast("Apariencia guardada", "success"); setDirty(false); reloadMerchant?.(); }
    catch (e) { toast("No se pudo guardar: " + e.message, "error", 6000); }
    finally { setSaving(false); }
  }
  return (
    <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.2fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
      <Panel T={T} title="Apariencia y textos" sub="El portal usa tu marca y el color del widget." right={<SaveBtn T={T} dirty={dirty} saving={saving} onClick={save}/>}>
        <Field T={T} label="Nombre de marca"><input value={brand} onChange={e => { setBrand(e.target.value); setDirty(true); }} placeholder={merchant?.email_brand_effective || merchant?.store_name || "Mi marca"} maxLength={60} style={iS}/></Field>
        <Hint T={T}>Aparece en el título del portal y como remitente de los mails.</Hint>
        <Field T={T} label="Color">
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <span style={{ width:34, height:34, borderRadius:DS.r.md, background:color, border:`1px solid ${T.border}`, flexShrink:0 }}/>
            <code style={{ fontFamily:MONO, fontSize:DS.font.md, color:T.text }}>{color}</code>
            {profile.caps.widget && <Btn T={T} variant="secondary" size="sm" onClick={() => goPlanesWidget(goTab)}>Cambiar en Planes → Widget</Btn>}
          </div>
        </Field>
        <Hint T={T}>{profile.caps.widget ? "Es el mismo color del widget, para que el portal se vea igual que tu tienda." : "Es el color de tu marca en el checkout y el portal."}</Hint>
        <Field T={T} label="Mensaje de bienvenida">
          <textarea value={welcome} onChange={e => { setWelcome(e.target.value); setDirty(true); }} maxLength={240} rows={3} placeholder="Ej: ¡Hola! Acá manejás tu suscripción. Cualquier duda escribinos por WhatsApp." style={{ ...iS, resize:"vertical", minHeight:70 }}/>
        </Field>
        <Hint T={T}>Se muestra arriba de todo en el portal. {welcome.length}/240 caracteres.</Hint>
        <Field T={T} label="Link de ejemplo">
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            <code style={{ ...iS, fontFamily:MONO, fontSize:DS.font.sm, color:T.textMd, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, minWidth:0, display:"block" }}>{example}</code>
            <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(`${window.location.origin}/#/portal`, "Link copiado")}>Copiar</Btn>
          </div>
        </Field>
        <Hint T={T}>Cada cliente recibe su link con token propio en el mail de activación. También lo copiás desde la ficha de cada suscripción.</Hint>
      </Panel>

      {/* Vista previa en vivo */}
      <div style={{ border:`1px solid ${T.border}`, borderRadius:12, overflow:"hidden", background:T.bg }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 12px", background:T.surface, borderBottom:`1px solid ${T.borderL}` }}>
          <span style={{ fontSize:10, color:T.textSm, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>Vista previa · portal</span>
        </div>
        <div style={{ height:6, background:color }}/>
        <div style={{ padding:16 }}>
          <div style={{ fontSize:15, fontWeight:800, color:T.text }}>{brand || merchant?.email_brand_effective || merchant?.store_name || "Tu marca"}</div>
          <div style={{ fontSize:11, color:T.textSm, marginBottom:10 }}>Mi suscripción</div>
          {(welcome || "").trim() && <div style={{ fontSize:12, color:T.textMd, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:8, padding:"8px 10px", marginBottom:10, lineHeight:1.5, overflowWrap:"anywhere" }}>{welcome}</div>}
          <div style={{ background:T.card, border:`1px solid ${T.borderL}`, borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
            <div style={{ fontSize:12, fontWeight:700, color:T.text }}>{profile.caps.shipping ? "Producto de ejemplo × 2" : `Tu ${profile.vocab.item || "plan"}`}</div>
            <div style={{ fontSize:11, color:T.textSm }}>Próximo cobro 15 oct · $12.500 mensual</div>
          </div>
          {previewBtns.length > 0 ? (
            <div style={{ display:"flex", gap:6 }}>
              {previewBtns.map((b, i) => (
                <span key={b} style={{ flex:1, textAlign:"center", padding:"7px 0", borderRadius:8, fontSize:11, fontWeight: i === 0 ? 700 : 600, ...(i === 0 ? { background:color, color:"#fff" } : { border:`1px solid ${T.border}`, color:T.textMd }) }}>{b}</span>
              ))}
            </div>
          ) : <div style={{ fontSize:11, color:T.textSm }}>Sin acciones habilitadas: el cliente solo ve su suscripción.</div>}
        </div>
      </div>
    </div>
  );
}

// ─── (c) Mensajes a tus clientes ───────────────────────────────────
const NOTIFS = (klaviyo) => [
  { key:"activation",     label:"Activación",     desc:"Confirma la suscripción y manda el link del portal.", channel: klaviyo ? "both" : "mail", metric:"Subscription Activated" },
  { key:"upcoming",       label:"Próximo cobro",  desc:"Aviso unos días antes de la renovación.", channel:"mail", soon:true },
  { key:"payment_failed", label:"Pago fallido",   desc:"Pide actualizar la tarjeta desde el portal.", channel: klaviyo ? "both" : "mail", metric:"Subscription Payment Failed" },
  { key:"cancellation",   label:"Cancelación",    desc:"Confirma la baja.", channel: klaviyo ? "both" : "mail", metric:"Subscription Cancelled" },
  { key:"invitation",     label:"Invitación",     desc:"Link del portal cuando lo pedís desde la ficha.", channel:"mail" },
];

function MessagesSection({ T, merchant, reloadMerchant, goTab }) {
  const iS = InputStyle(T);
  const klaviyo = Boolean(merchant?.klaviyo_connected);
  const [replyTo, setReplyTo] = useState(merchant?.email_reply_to || "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(null);
  useEffect(() => { setReplyTo(merchant?.email_reply_to || ""); setDirty(false); }, [merchant?.id, merchant?.email_reply_to]);

  async function save() {
    setSaving(true);
    try { await saveSettings({ email_reply_to: replyTo.trim() }); toast("Guardado", "success"); setDirty(false); reloadMerchant?.(); }
    catch (e) { toast("No se pudo guardar: " + e.message, "error", 6000); }
    finally { setSaving(false); }
  }
  async function testEmail() {
    setTesting("mail");
    try {
      const r = await apiPost("merchant", {}, { action: "test-email" });
      if (r?.error) throw new Error(r.error);
      toast(`Mail de prueba enviado a ${r.to || merchant?.email || "tu cuenta"}`, "success", 5000);
    } catch (e) { toast("No se pudo enviar: " + e.message, "error", 6000); }
    finally { setTesting(null); }
  }
  async function testKlaviyo() {
    setTesting("klaviyo");
    try {
      const r = await apiPost("merchant", {}, { action: "klaviyo-test" });
      if (r?.error) throw new Error(r.error);
      toast("Evento de prueba enviado a Klaviyo (Checkout Started)", "success", 5000);
    } catch (e) { toast("Klaviyo: " + e.message, "error", 6000); }
    finally { setTesting(null); }
  }

  const channelCell = (n) => (
    <span style={{ display:"inline-flex", gap:4, flexWrap:"wrap" }}>
      {(n.channel === "mail" || n.channel === "both") && <DSBadge T={T} color={T.accent} size="sm">Mail de Recurrentes</DSBadge>}
      {n.channel === "both" && <DSBadge T={T} color={KLAVIYO} size="sm">Klaviyo</DSBadge>}
    </span>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      <Panel T={T} title="Notificaciones" flush
        sub={klaviyo ? "Los mails básicos los manda Recurrentes y además cada evento llega a tu Klaviyo." : "Los mails básicos los manda Recurrentes. Conectá Klaviyo para mandarlos con tu diseño y sumar SMS."}
        right={!klaviyo && <Btn T={T} variant="secondary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Conectar Klaviyo</Btn>}>
        <DSTable T={T} rows={NOTIFS(klaviyo)} rowKey={n => n.key} dense minWidth={620} style={{ border:"none", borderRadius:0, boxShadow:"none", borderTop:`1px solid ${T.border}` }} columns={[
          { key:"n", label:"Notificación", render: n => <CellStack T={T} main={<>{n.label}{n.soon && <> <DSBadge T={T} color={T.yellow} size="sm">próximamente</DSBadge></>}</>} sub={n.desc}/> },
          { key:"c", label:"Canal", render: channelCell },
          { key:"m", label:"Métrica Klaviyo", hideMobile:true, render: n => n.metric && klaviyo ? <code style={{ fontFamily:MONO, fontSize:DS.font.xs, color:T.textMd }}>{n.metric}</code> : <span style={{ color:T.textSm }}>—</span> },
          { key:"s", label:"Estado", align:"right", nowrap:true, render: n => n.soon ? <DSBadge T={T} color={T.textSm} size="sm">pronto</DSBadge> : <DSBadge T={T} color={T.green} size="sm">● activa</DSBadge> },
        ]}/>
      </Panel>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        <Panel T={T} title="Remitente" sub="Quién figura en los mails y a dónde llegan las respuestas." right={<SaveBtn T={T} dirty={dirty} saving={saving} onClick={save}/>}>
          <Field T={T} label="Remitente"><div style={{ ...iS, display:"flex", alignItems:"center", color:T.textMd }}>{merchant?.email_from_effective || merchant?.email_brand_effective || "Recurrentes"}</div></Field>
          <Hint T={T}>El nombre es la marca que cargás en Apariencia. Los mails salen desde el dominio de Recurrentes.</Hint>
          <Field T={T} label="Responder a (reply-to)"><input type="email" value={replyTo} onChange={e => { setReplyTo(e.target.value); setDirty(true); }} placeholder={merchant?.email || "hola@mitienda.com"} style={iS}/></Field>
          <Hint T={T}>Cuando el cliente responde el mail, le llega a esta casilla.</Hint>
        </Panel>
        <Panel T={T} title="Probar" sub={<>Te mandamos el mail de activación de ejemplo a <strong style={{ color:T.text }}>{merchant?.email || "tu cuenta"}</strong>, con tu marca y remitente actuales.</>}>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn T={T} variant="primary" size="sm" onClick={testEmail} disabled={!!testing}>{testing === "mail" ? <><Spinner size={11} color={T.accent}/> Enviando…</> : "Enviar mail de prueba a mi cuenta"}</Btn>
            {klaviyo && <Btn T={T} variant="secondary" size="sm" onClick={testKlaviyo} disabled={!!testing}>{testing === "klaviyo" ? <><Spinner size={11} color={T.textMd}/> Enviando…</> : "Probar evento Klaviyo"}</Btn>}
          </div>
        </Panel>
      </div>
    </div>
  );
}

// ─── (d) Registro: mails enviados + eventos Klaviyo (GET /api/stats?action=activity) ──
function RegistroSection({ T, merchant, activity, mails, loading, reload, goTab }) {
  const [type, setType] = useState("all");
  const klaviyo = Boolean(merchant?.klaviyo_connected);
  const MAIL_LABEL = {
    activation:     { t:"Activación",   c:T.green,  e:"✅" },
    payment_failed: { t:"Pago fallido", c:T.yellow, e:"⚠️" },
    cancellation:   { t:"Cancelación",  c:T.red,    e:"🚫" },
    invitation:     { t:"Invitación",   c:T.blue,   e:"🔗" },
    flow:           { t:"Flujos",       c:T.accent, e:"🔁" },
    delivery:       { t:"Entrega digital", c:T.blue, e:"📚" },
  };
  const mailLabel = (m) => m.type === "flow" ? { ...MAIL_LABEL.flow, t: m.flow_name || "Flujo" } : (MAIL_LABEL[m.type] || { t: m.type || "Mail", c:T.textMd, e:"📧" });
  const events = activity?.klaviyo_events || [];
  const ks = activity?.klaviyo_summary || {};
  const count = (fn) => mails.filter(fn).length;
  const errors = count(m => m.status === "error");
  const filters = [
    { id:"all", label:"Todos", count: mails.length },
    ...Object.entries(MAIL_LABEL).filter(([k]) => mails.some(m => m.type === k)).map(([k, L]) => ({ id:k, label:L.t, count: count(m => m.type === k) })),
    ...(errors ? [{ id:"error", label:"Con error", count: errors }] : []),
  ];
  const shown = mails.filter(m => type === "all" || (type === "error" ? m.status === "error" : m.type === type));
  const byType = Object.entries(MAIL_LABEL).map(([k, L]) => ({ key:k, label:`${L.e} ${L.t}`, value: count(m => m.type === k && m.status !== "error") })).filter(r => r.value > 0);
  const dateCol = { key:"fecha", label:"Fecha", nowrap:true, render: r => <span style={{ color:T.textSm, fontSize:DS.font.sm, fontVariantNumeric:"tabular-nums" }}>{fmtDateShort(r.created_at)}</span> };

  if (loading && !activity) return <Loading T={T}/>;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1.3fr) minmax(0,1fr)", gap:DS.sp.lg, alignItems:"start" }}>
        <Panel T={T} title="Mails por tipo" sub="Lo que salió de Recurrentes (últimos 200 del registro)."
          right={<Btn T={T} variant="secondary" size="sm" onClick={reload} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"} Actualizar</Btn>}>
          <BarList T={T} rows={byType} color={T.accentSolid} empty="Todavía no se envió ningún mail."/>
        </Panel>
        <Panel T={T} title="Klaviyo" sub={klaviyo ? "Eventos que le mandamos a tu cuenta para tus flows." : "Conectalo para mandar los mails con tu diseño y sumar SMS."}
          right={!klaviyo && <Btn T={T} variant="secondary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Conectar</Btn>}>
          <div style={{ display:"flex", gap:22, flexWrap:"wrap" }}>
            <div><div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5 }}>Enviados</div><div style={{ fontSize:22, fontWeight:800, color: klaviyo ? KLAVIYO : T.textSm, fontVariantNumeric:"tabular-nums" }}>{klaviyo ? fmtN(ks.sent) : "—"}</div></div>
            <div><div style={{ fontSize:10, fontWeight:700, color:T.textSm, textTransform:"uppercase", letterSpacing:0.5 }}>Con error</div><div style={{ fontSize:22, fontWeight:800, color: ks.error ? T.red : T.textSm, fontVariantNumeric:"tabular-nums" }}>{klaviyo ? fmtN(ks.error) : "—"}</div></div>
          </div>
        </Panel>
      </div>

      <Panel T={T} title="Mails enviados" sub="Cada mail que le mandamos a tus clientes." flush>
        {mails.length === 0 ? (
          <div style={{ padding:"0 16px 16px" }}><DSEmpty T={T} icon="📭" title="Todavía no se envió ningún mail" subtitle="Aparecen acá a medida que Recurrentes los manda: activación, pago fallido y cancelación."/></div>
        ) : (
          <>
            <div style={{ padding:"0 16px 12px", maxWidth:"100%", overflowX:"auto" }}>
              <Segmented T={T} options={filters} value={type} onChange={setType} ariaLabel="Filtrar mails por tipo"/>
            </div>
            <DSTable T={T} rows={shown} rowKey={m => m.id} minWidth={620} dense style={{ border:"none", borderRadius:0, boxShadow:"none", borderTop:`1px solid ${T.border}` }} emptyText="No hay mails de este tipo." columns={[
              dateCol,
              { key:"tipo", label:"Mail", nowrap:true, render: m => { const L = mailLabel(m); return (
                <span style={{ display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:L.c }}>{L.e} {L.t}</span>
                  {m.status === "error" ? <span title={m.error || ""}><DSBadge T={T} color={T.red} size="sm">error</DSBadge></span> : null}
                </span>); } },
              { key:"cliente", label:"Cliente", render: m => <CellStack T={T} main={m.customer_name || "—"} sub={m.to}/> },
              { key:"producto", label:"Producto", hideMobile:true, render: m => <span style={{ color:T.textSm }}>{m.product_title || "—"}</span> },
            ]}/>
          </>
        )}
      </Panel>

      {events.length > 0 && (
        <Panel T={T} title="Eventos a Klaviyo" sub="Últimos 200 eventos mandados a tu cuenta." flush>
          <DSTable T={T} rows={events} rowKey={k => k.id} minWidth={620} dense style={{ border:"none", borderRadius:0, boxShadow:"none", borderTop:`1px solid ${T.border}` }} columns={[
            dateCol,
            { key:"metrica", label:"Evento", nowrap:true, render: k => <span style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text }}>{k.metric || "—"}</span> },
            { key:"email", label:"Cliente", render: k => <CellStack T={T} main={k.email || "—"} sub={k.customer_name || ""}/> },
            { key:"estado", label:"Estado", align:"right", nowrap:true, render: k => k.status === "error"
                ? <span title={k.error || ""}><DSBadge T={T} color={T.red} size="sm">✕ error{k.http_status ? ` ${k.http_status}` : ""}</DSBadge></span>
                : <DSBadge T={T} color={T.green} size="sm">✓ enviado</DSBadge> },
          ]}/>
        </Panel>
      )}
    </div>
  );
}
