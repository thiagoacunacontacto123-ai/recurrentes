import { useState, useEffect } from "react";
import { apiGet, apiPost, apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSBadge, DSToggle, DSEmpty, Spinner, DSTable, CellStack, PageHeader, CardHeader, SectionTitle, Field, InputStyle, Hint, StatCard, Loading, toast } from "../ui/components.jsx";
import { goPlanesWidget, goConfigSection } from "../lib/onboarding.js";
import { MONO, fmtDateShort, SurfaceBox, copyText } from "./_shared.jsx";

// ─── Página: Portal del cliente ────────────────────────────────────
export function CustomerPortalPage({ merchant, reloadMerchant, goTab }) {
  const T = useT();
  return (
    <div>
      <PageHeader T={T} title="Portal del cliente" subtitle="Lo que tus clientes pueden hacer solos desde el link que reciben por mail: pausar, cancelar, cambiar la dirección. Y los mensajes que les mandamos."/>
      <ActionsCard T={T} merchant={merchant} reloadMerchant={reloadMerchant}/>
      <AppearanceCard T={T} merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab}/>
      <MessagesCard T={T} merchant={merchant} reloadMerchant={reloadMerchant} goTab={goTab}/>
    </div>
  );
}

async function saveSettings(body) {
  const r = await apiPatch("merchant", body, { action: "save-settings" });
  if (r?.error) throw new Error(typeof r.error === "string" ? r.error : "Error del servidor");
  return r;
}

// ─── (a) Acciones permitidas ───────────────────────────────────────
const PORTAL_ACTIONS = [
  { key:"allow_pause",   icon:"⏸", title:"Pausar la suscripción",  desc:"Salta los próximos cobros y la retoma cuando quiera." },
  { key:"allow_cancel",  icon:"✕", title:"Cancelar",                desc:"Pasa por el flujo de retención si lo activaste." },
  { key:"allow_address", icon:"📍", title:"Cambiar la dirección",   desc:"Se actualiza en las órdenes futuras de Shopify." },
  { key:"allow_date",    icon:"📅", title:"Cambiar la fecha de cobro", desc:"Adelantar o atrasar el próximo cobro.", soon:true },
  { key:"allow_skip",    icon:"⏭", title:"Saltar un envío",         desc:"Se saltea un ciclo sin pausar.", soon:true },
];

function ActionsCard({ T, merchant, reloadMerchant }) {
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
    <Card T={T} style={{ marginBottom:DS.sp.lg }}>
      <CardHeader T={T} icon="🔐" title="Acciones permitidas" sub="Qué puede hacer el cliente por su cuenta. Lo que apagues, lo tiene que pedir por mail."
        right={<Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>}/>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(260px, 1fr))", gap:10 }}>
        {PORTAL_ACTIONS.map(a => {
          const on = a.soon ? false : v[a.key] !== false;
          return (
            <div key={a.key} style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px", border:`1px solid ${on ? T.accent + "55" : T.border}`, borderRadius:DS.r.lg, background: on ? T.accent + "08" : T.surface, opacity: a.soon ? 0.6 : 1 }}>
              <span style={{ fontSize:18, width:26, textAlign:"center" }}>{a.icon}</span>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text, display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>{a.title}{a.soon && <DSBadge T={T} color={T.yellow} size="sm">próximamente</DSBadge>}</div>
                <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{a.desc}</div>
              </div>
              {a.soon ? <DSToggle T={T} active={false} onToggle={() => {}}/> : <DSToggle T={T} active={on} onToggle={() => { setV({ ...v, [a.key]: !on }); setDirty(true); }}/>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── (b) Apariencia y textos ───────────────────────────────────────
function AppearanceCard({ T, merchant, reloadMerchant, goTab }) {
  const iS = InputStyle(T);
  const [brand, setBrand] = useState(merchant?.email_brand || merchant?.email_brand_effective || "");
  const [welcome, setWelcome] = useState(merchant?.portal_welcome || "");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => { setBrand(merchant?.email_brand || merchant?.email_brand_effective || ""); setWelcome(merchant?.portal_welcome || ""); setDirty(false); }, [merchant?.id, merchant?.email_brand, merchant?.email_brand_effective, merchant?.portal_welcome]);
  const color = merchant?.widget_color || "#10b981";
  const example = `${window.location.origin}/#/portal?token=…`;

  async function save() {
    setSaving(true);
    try { await saveSettings({ email_brand: brand.trim(), portal_welcome: welcome.trim().slice(0, 240) }); toast("Apariencia guardada", "success"); setDirty(false); reloadMerchant?.(); }
    catch (e) { toast("No se pudo guardar: " + e.message, "error", 6000); }
    finally { setSaving(false); }
  }
  return (
    <Card T={T} style={{ marginBottom:DS.sp.lg }}>
      <CardHeader T={T} icon="🎨" title="Apariencia y textos" sub="El portal usa tu marca y el color del widget."
        right={<Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>}/>
      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:DS.sp.xl, alignItems:"start" }}>
        <div>
          <Field T={T} label="Nombre de marca"><input value={brand} onChange={e => { setBrand(e.target.value); setDirty(true); }} placeholder={merchant?.email_brand_effective || merchant?.store_name || "Mi marca"} maxLength={60} style={iS}/></Field>
          <Hint T={T}>Aparece en el título del portal y como remitente de los mails.</Hint>
          <Field T={T} label="Color">
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ width:34, height:34, borderRadius:DS.r.md, background:color, border:`1px solid ${T.border}`, flexShrink:0 }}/>
              <code style={{ fontFamily:MONO, fontSize:DS.font.md, color:T.text }}>{color}</code>
              <Btn T={T} variant="secondary" size="sm" onClick={() => goPlanesWidget(goTab)}>Cambiar en Planes → Widget</Btn>
            </div>
          </Field>
          <Hint T={T}>Es el mismo color del widget, para que el portal se vea igual que tu tienda.</Hint>
          <Field T={T} label="Mensaje de bienvenida">
            <textarea value={welcome} onChange={e => { setWelcome(e.target.value); setDirty(true); }} maxLength={240} rows={3} placeholder="Ej: ¡Hola! Acá manejás tu suscripción. Cualquier duda escribinos por WhatsApp." style={{ ...iS, resize:"vertical", minHeight:70 }}/>
          </Field>
          <Hint T={T}>Se muestra arriba de todo en el portal. Máx. 240 caracteres.</Hint>
          <Field T={T} label="Link de ejemplo">
            <div style={{ display:"flex", gap:6, alignItems:"center" }}>
              <code style={{ ...iS, fontFamily:MONO, fontSize:DS.font.sm, color:T.textMd, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, display:"block" }}>{example}</code>
              <Btn T={T} variant="secondary" size="sm" onClick={() => copyText(`${window.location.origin}/#/portal`, "Link copiado")}>Copiar</Btn>
            </div>
          </Field>
          <Hint T={T}>Cada cliente recibe su link con token propio en el mail de activación. También lo copiás desde la ficha de cada suscripción.</Hint>
        </div>
        {/* Mini preview */}
        <div style={{ border:`1px solid ${T.border}`, borderRadius:DS.r.xl, overflow:"hidden", background:T.bg }}>
          <div style={{ height:6, background:color }}/>
          <div style={{ padding:16 }}>
            <div style={{ fontSize:15, fontWeight:800, color:T.text }}>{brand || merchant?.email_brand_effective || merchant?.store_name || "Tu marca"}</div>
            <div style={{ fontSize:11, color:T.textSm, marginBottom:10 }}>Mi suscripción</div>
            {(welcome || "").trim() && <div style={{ fontSize:12, color:T.textMd, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:8, padding:"8px 10px", marginBottom:10, lineHeight:1.5 }}>{welcome}</div>}
            <div style={{ background:T.card, border:`1px solid ${T.borderL}`, borderRadius:10, padding:"10px 12px", marginBottom:8 }}>
              <div style={{ fontSize:12, fontWeight:700, color:T.text }}>Producto de ejemplo × 2</div>
              <div style={{ fontSize:11, color:T.textSm }}>Próximo cobro 15 oct · $12.500 mensual</div>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <span style={{ flex:1, textAlign:"center", padding:"7px 0", borderRadius:8, background:color, color:"#fff", fontSize:11, fontWeight:700 }}>Cambiar dirección</span>
              <span style={{ flex:1, textAlign:"center", padding:"7px 0", borderRadius:8, border:`1px solid ${T.border}`, color:T.textMd, fontSize:11, fontWeight:600 }}>Pausar</span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ─── (c) Mensajes a tus clientes + Registro ────────────────────────
const NOTIFS = (klaviyo) => [
  { key:"activation",     label:"Activación",     desc:"Confirma la suscripción y manda el link del portal.", channel: klaviyo ? "both" : "mail", metric:"Subscription Activated", on:true },
  { key:"upcoming",       label:"Próximo cobro",  desc:"Aviso unos días antes de la renovación.", channel:"mail", on:false, soon:true },
  { key:"payment_failed", label:"Pago fallido",   desc:"Pide actualizar la tarjeta desde el portal.", channel: klaviyo ? "both" : "mail", metric:"Subscription Payment Failed", on:true },
  { key:"cancellation",   label:"Cancelación",    desc:"Confirma la baja.", channel: klaviyo ? "both" : "mail", metric:"Subscription Cancelled", on:true },
  { key:"invitation",     label:"Invitación",     desc:"Link del portal cuando lo pedís desde la ficha.", channel:"mail", on:true },
];

function MessagesCard({ T, merchant, reloadMerchant, goTab }) {
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
      {(n.channel === "both") && <DSBadge T={T} color="#8b5cf6" size="sm">Klaviyo</DSBadge>}
    </span>
  );

  return (
    <Card T={T}>
      <CardHeader T={T} icon="✉️" title="Mensajes a tus clientes" sub={klaviyo ? "Los mails básicos los manda Recurrentes y además cada evento llega a tu Klaviyo." : "Los mails básicos los manda Recurrentes. Conectá Klaviyo para mandarlos con tu diseño y sumar SMS."}
        right={!klaviyo && <Btn T={T} variant="secondary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Conectar Klaviyo</Btn>}/>

      <DSTable T={T} rows={NOTIFS(klaviyo)} rowKey={n => n.key} dense minWidth={620} style={{ marginBottom:DS.sp.lg }} columns={[
        { key:"n", label:"Notificación", render: n => <CellStack T={T} main={<>{n.label}{n.soon && <DSBadge T={T} color={T.yellow} size="sm" >próximamente</DSBadge>}</>} sub={n.desc}/> },
        { key:"c", label:"Canal", render: channelCell },
        { key:"m", label:"Métrica Klaviyo", hideMobile:true, render: n => n.metric && klaviyo ? <code style={{ fontFamily:MONO, fontSize:DS.font.xs, color:T.textMd }}>{n.metric}</code> : <span style={{ color:T.textSm }}>—</span> },
        { key:"s", label:"Estado", align:"right", nowrap:true, render: n => n.soon ? <DSBadge T={T} color={T.textSm} size="sm">pronto</DSBadge> : <DSBadge T={T} color={T.green} size="sm">● activa</DSBadge> },
      ]}/>

      <div className="stack-mobile" style={{ display:"grid", gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)", gap:DS.sp.xl, alignItems:"start" }}>
        <div>
          <SectionTitle T={T} right={<Btn T={T} variant="solid" size="sm" onClick={save} disabled={saving || !dirty}>{saving ? <><Spinner size={11}/> Guardando…</> : "Guardar"}</Btn>}>Remitente</SectionTitle>
          <Field T={T} label="Remitente"><div style={{ ...iS, display:"flex", alignItems:"center", color:T.textMd }}>{merchant?.email_from_effective || merchant?.email_brand_effective || "Recurrentes"}</div></Field>
          <Hint T={T}>El nombre es la marca que cargás en Apariencia. Los mails salen desde el dominio de Recurrentes.</Hint>
          <Field T={T} label="Responder a (reply-to)"><input type="email" value={replyTo} onChange={e => { setReplyTo(e.target.value); setDirty(true); }} placeholder={merchant?.email || "hola@mitienda.com"} style={iS}/></Field>
          <Hint T={T}>Cuando el cliente responde el mail, le llega a esta casilla.</Hint>
        </div>
        <SurfaceBox T={T} title="Probar">
          <div style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.5, marginBottom:10 }}>Te mandamos el mail de activación de ejemplo a <strong style={{ color:T.text }}>{merchant?.email || "tu cuenta"}</strong>, con tu marca y remitente actuales.</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            <Btn T={T} variant="primary" size="sm" onClick={testEmail} disabled={!!testing}>{testing === "mail" ? <><Spinner size={11} color={T.accent}/> Enviando…</> : "Enviar mail de prueba a mi cuenta"}</Btn>
            {klaviyo && <Btn T={T} variant="secondary" size="sm" onClick={testKlaviyo} disabled={!!testing}>{testing === "klaviyo" ? <><Spinner size={11} color={T.textMd}/> Enviando…</> : "Probar evento Klaviyo"}</Btn>}
          </div>
        </SurfaceBox>
      </div>

      <div style={{ height:1, background:T.borderL, margin:`${DS.sp.xl}px 0` }}/>
      <ActivityLog T={T}/>
    </Card>
  );
}

// ─── Registro: mails enviados + eventos Klaviyo (GET /api/stats?action=activity) ──
export function ActivityLog({ T }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    const d = await apiGet("stats", { action: "activity" });
    setData(d && !d.error ? d : {});
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const MAIL_LABEL = {
    activation:     { t:"Activación",   c:T.green,  e:"✅" },
    cancellation:   { t:"Cancelación",  c:T.red,    e:"🚫" },
    payment_failed: { t:"Pago fallido", c:T.yellow, e:"⚠️" },
    invitation:     { t:"Invitación",   c:T.blue,   e:"🔗" },
  };
  const mailLabel = (m) => MAIL_LABEL[m.type] || { t: m.type || "Mail", c:T.textMd, e:"📧" };
  // Sin secuencia propia de abandono: no mostramos esos mails históricos.
  const mails = (data?.mails || []).filter(m => m.type !== "abandoned");
  const events = data?.klaviyo_events || [];
  const ms = data?.mail_summary || {};
  const ks = data?.klaviyo_summary || {};
  const dateCol = { key:"fecha", label:"Fecha", nowrap:true, render: r => <span style={{ color:T.textSm, fontSize:DS.font.sm }}>{fmtDateShort(r.created_at)}</span> };

  return (
    <div>
      <SectionTitle T={T} sub="Lo que efectivamente salió: mails de Recurrentes y eventos mandados a Klaviyo (últimos 200)." right={<Btn T={T} variant="secondary" size="sm" onClick={load} disabled={loading}>{loading ? <Spinner size={12} color={T.textMd}/> : "↻"}</Btn>}>Registro</SectionTitle>
      {loading ? <Loading T={T}/> : (
        <div style={{ display:"flex", flexDirection:"column", gap:DS.sp.lg }}>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
            <StatCard T={T} label="Mails enviados" value={(ms.activation || 0) + (ms.payment_failed || 0) + (ms.cancellation || 0) + (ms.invitation || 0)}/>
            <StatCard T={T} label="Activación" value={ms.activation || 0} color={T.green}/>
            <StatCard T={T} label="Pago fallido" value={ms.payment_failed || 0} color={T.yellow}/>
            <StatCard T={T} label="Cancelación" value={ms.cancellation || 0} color={T.red}/>
            <StatCard T={T} label="Eventos Klaviyo" value={ks.sent || 0} color="#8b5cf6" sub={ks.error ? `${ks.error} con error` : undefined}/>
          </div>
          {mails.length === 0 ? (
            <DSEmpty T={T} icon="📭" title="Todavía no se envió ningún mail" subtitle="Aparecen acá a medida que Recurrentes los manda: activación, pago fallido y cancelación."/>
          ) : (
            <DSTable T={T} rows={mails} rowKey={m => m.id} minWidth={620} dense columns={[
              dateCol,
              { key:"tipo", label:"Mail", nowrap:true, render: m => { const L = mailLabel(m); return (
                <span style={{ display:"inline-flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:DS.font.md, fontWeight:DS.w.bold, color:L.c }}>{L.e} {L.t}</span>
                  {m.status === "error" ? <span title={m.error || ""}><DSBadge T={T} color={T.red} size="sm">error</DSBadge></span> : null}
                </span>); } },
              { key:"cliente", label:"Cliente", render: m => <CellStack T={T} main={m.customer_name || "—"} sub={m.to}/> },
              { key:"producto", label:"Producto", hideMobile:true, render: m => <span style={{ color:T.textSm }}>{m.product_title || "—"}</span> },
            ]}/>
          )}
          {events.length > 0 && (
            <DSTable T={T} rows={events} rowKey={k => k.id} minWidth={620} dense columns={[
              dateCol,
              { key:"metrica", label:"Evento Klaviyo", nowrap:true, render: k => <span style={{ fontFamily:MONO, fontSize:DS.font.sm, fontWeight:DS.w.bold, color:T.text }}>{k.metric || "—"}</span> },
              { key:"email", label:"Cliente", render: k => <CellStack T={T} main={k.email || "—"} sub={k.customer_name || ""}/> },
              { key:"estado", label:"Estado", align:"right", nowrap:true, render: k => k.status === "error"
                  ? <span title={k.error || ""}><DSBadge T={T} color={T.red} size="sm">✕ error{k.http_status ? ` ${k.http_status}` : ""}</DSBadge></span>
                  : <DSBadge T={T} color={T.green} size="sm">✓ enviado</DSBadge> },
            ]}/>
          )}
        </div>
      )}
    </div>
  );
}
