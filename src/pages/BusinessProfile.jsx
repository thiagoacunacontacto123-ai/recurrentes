import React, { useState, useEffect, useMemo } from "react";
import { apiPatch } from "../lib/api.js";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, DSBadge, CardHeader, Callout, Spinner, appConfirm, toast } from "../ui/components.jsx";
import { BUSINESS_TYPES, CHANNELS, PAYMENT_PROVIDERS, merchantProfile, channelAvailable } from "../../shared/platform/profile.js";

// ─── Configuración → Negocio ─────────────────────────────────────
// Qué vende el comerciante, dónde lo vende y con qué cobra (shared/platform/
// profile.js). Con esto el panel, el onboarding y el checkout se adaptan solos:
// servicios no piden dirección, sin tienda se vende con un link, etc.
// Guarda con PATCH merchant?action=save-settings { business_type, channel,
// payment_provider }. Si deja de usar Shopify con la tienda conectada, el backend
// pide confirmación (409 confirm_channel_change): dejan de crearse órdenes.
//
// compact=true (wizard de bienvenida): solo el tipo de negocio; el canal y la
// pasarela toman el default del tipo.

const TYPE_IDS = ["physical", "digital", "service"];

function OptionCard({ T, selected, disabled, emoji, title, desc, badge, onClick }) {
  return (
    <button type="button" onClick={disabled ? undefined : onClick} disabled={disabled} aria-pressed={selected}
      style={{
        display:"flex", flexDirection:"column", alignItems:"flex-start", gap:6, textAlign:"left", width:"100%",
        padding:"14px 14px 13px", borderRadius:DS.r.xl, cursor: disabled ? "not-allowed" : "pointer", fontFamily:"inherit",
        background: selected ? T.accentSolid + "12" : T.card,
        border: `1.5px solid ${selected ? T.accentSolid : T.border}`,
        boxShadow: selected ? `0 0 0 3px ${T.accentSolid}1f` : "none",
        opacity: disabled ? 0.55 : 1, transition:"border-color .12s, box-shadow .12s, background .12s", height:"100%",
      }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, width:"100%" }}>
        <span style={{ fontSize:22, lineHeight:1 }} aria-hidden="true">{emoji}</span>
        <span style={{ flex:1, minWidth:0, fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text }}>{title}</span>
        {badge}
        {selected && !badge && (
          <span style={{ width:18, height:18, borderRadius:"50%", background:T.accentSolid, color:"#fff", display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, flexShrink:0 }}>✓</span>
        )}
      </div>
      <span style={{ fontSize:DS.font.sm, color:T.textSm, lineHeight:1.45 }}>{desc}</span>
    </button>
  );
}

function StepLabel({ T, n, children, sub }) {
  return (
    <div style={{ margin:"18px 0 10px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ width:22, height:22, borderRadius:"50%", background:T.surface, border:`1px solid ${T.border}`, color:T.textMd, fontSize:11, fontWeight:DS.w.bold, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>{n}</span>
        <span style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text }}>{children}</span>
      </div>
      {sub && <div style={{ fontSize:DS.font.sm, color:T.textSm, margin:"4px 0 0 30px", lineHeight:1.5 }}>{sub}</div>}
    </div>
  );
}

const grid = { display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:10 };

// Canal que queda al cambiar de tipo: el mismo si le sirve, si no el primero disponible.
function channelForType(typeId, current, merchant) {
  const c = CHANNELS[current];
  if (c && channelAvailable(current, merchant) && c.types.includes(typeId)) return current;
  return typeId === "physical" ? "shopify" : "none";
}

// Lo que cambia en el panel con esta combinación (resumen legible).
export function profileEffects(p) {
  const v = p.vocab;
  const out = [];
  out.push(p.caps.widget
    ? `Vendés desde la página de producto de ${p.channelInfo.label} con el widget de suscripción.`
    : "Vendés con un link de suscripción: lo pegás en Instagram, WhatsApp, tu web o un QR.");
  out.push(p.caps.orders
    ? `Cada cobro crea una orden en ${p.channelInfo.label}.`
    : `Cada cobro queda registrado en Recurrentes (no hace falta tienda).`);
  out.push(p.caps.shipping
    ? "El checkout pide dirección y ofrece tus envíos."
    : "El checkout pide solo nombre y email: sin dirección ni envío.");
  out.push(`Cobrás en ${p.currency} con ${p.providerInfo.label}. Tus clientes son ${v.customers} y tus planes, ${v.items}.`);
  return out;
}

export default function BusinessProfileSection({ merchant, onChange, compact = false, onSaved }) {
  const T = useT();
  const cur = useMemo(() => merchantProfile(merchant), [merchant]);
  const isOwner = (merchant?.role || "owner") === "owner";
  const [type, setType] = useState(cur.businessType);
  const [channel, setChannel] = useState(cur.channel);
  const [provider, setProvider] = useState(cur.paymentProvider);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setType(cur.businessType); setChannel(cur.channel); setProvider(cur.paymentProvider); }, [cur.businessType, cur.channel, cur.paymentProvider]);

  const draft = useMemo(() => merchantProfile({ ...merchant, business_type: type, channel, payment_provider: provider }), [merchant, type, channel, provider]);
  const dirty = !cur.explicit || type !== cur.businessType || channel !== cur.channel || provider !== cur.paymentProvider;

  function pickType(id) {
    setType(id);
    setChannel(ch => channelForType(id, ch, merchant));
  }

  async function save() {
    setSaving(true);
    const body = { business_type: type, channel, payment_provider: provider };
    let d = await apiPatch("merchant", body, { action: "save-settings" });
    if (d?.code === "confirm_channel_change") {
      setSaving(false);
      const ok = await appConfirm(d.error, { title:"¿Dejar de crear órdenes en Shopify?", danger:true, okLabel:"Sí, cambiar" });
      if (!ok) return;
      setSaving(true);
      d = await apiPatch("merchant", { ...body, confirm_channel_change: true }, { action: "save-settings" });
    }
    setSaving(false);
    if (d?.error) return toast("Error: " + d.error, "error", 6000);
    toast("Listo: el panel se adaptó a tu negocio", "success");
    onChange?.();
    onSaved?.();
  }

  const channels = Object.values(CHANNELS).filter(c => c.types.includes(type));
  const providers = Object.values(PAYMENT_PROVIDERS);
  const soon = <DSBadge T={T} color={T.textSm} size="sm">Próximamente</DSBadge>;

  const typePicker = (
    <div style={grid}>
      {TYPE_IDS.map(id => {
        const t = BUSINESS_TYPES[id];
        return <OptionCard key={id} T={T} selected={type === id} disabled={!isOwner} emoji={t.emoji} title={t.label} desc={t.desc} onClick={() => pickType(id)}/>;
      })}
    </div>
  );

  const saveBtn = (
    <Btn T={T} variant="solid" onClick={save} disabled={!isOwner || saving || !dirty}>
      {saving ? <><Spinner size={13}/> Guardando…</> : (cur.explicit ? "Guardar cambios" : "Guardar")}
    </Btn>
  );

  if (compact) {
    return (
      <div>
        {typePicker}
        <div style={{ display:"flex", justifyContent:"flex-end", marginTop:12 }}>{saveBtn}</div>
      </div>
    );
  }

  return (
    <Card T={T}>
      <CardHeader T={T} title="Tu negocio" sub="Elegí qué vendés, dónde y con qué cobrás. El panel, el onboarding y el checkout se adaptan solos."
        badge={cur.explicit ? <DSBadge T={T} color={T.green} size="sm">{cur.type.emoji} {cur.type.short}</DSBadge> : <DSBadge T={T} color={T.yellow} size="sm">Sin definir</DSBadge>}/>
      {!isOwner && <Callout T={T} tone="info" style={{ marginBottom:8 }}>Solo el dueño de la tienda puede cambiar el tipo de negocio.</Callout>}

      <StepLabel T={T} n={1}>¿Qué vendés?</StepLabel>
      {typePicker}

      <StepLabel T={T} n={2} sub="Con tienda, los productos salen de tu catálogo y cada cobro crea una orden. Sin tienda, vendés con un link.">¿Dónde vendés?</StepLabel>
      <div style={grid}>
        {channels.map(c => (
          <OptionCard key={c.id} T={T} selected={channel === c.id} disabled={!isOwner || !channelAvailable(c.id, merchant)} emoji={c.emoji} title={c.label} desc={c.desc}
            badge={!channelAvailable(c.id, merchant) ? soon : null} onClick={() => setChannel(c.id)}/>
        ))}
      </div>

      <StepLabel T={T} n={3} sub="Es la cuenta que cobra: la plata va directo a vos.">¿Con qué cobrás?</StepLabel>
      <div style={grid}>
        {providers.map(pp => (
          <OptionCard key={pp.id} T={T} selected={provider === pp.id} disabled={!isOwner || pp.status !== "available"} emoji={pp.emoji} title={pp.label}
            desc={`${pp.desc} · ${pp.region}`} badge={pp.status !== "available" ? soon : null} onClick={() => setProvider(pp.id)}/>
        ))}
      </div>

      <div style={{ marginTop:18, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"12px 14px" }}>
        <div style={{ fontSize:DS.font.sm, textTransform:"uppercase", letterSpacing:0.6, color:T.textSm, fontWeight:DS.w.bold, marginBottom:8 }}>Así queda tu panel</div>
        {profileEffects(draft).map((e, i) => (
          <div key={i} style={{ display:"flex", gap:8, alignItems:"flex-start", fontSize:DS.font.base, color:T.text, lineHeight:1.5, marginBottom:4 }}>
            <span style={{ color:T.green, fontWeight:800, flexShrink:0 }}>✓</span><span>{e}</span>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", gap:8, flexWrap:"wrap", marginTop:14 }}>
        {dirty && cur.explicit && <Btn T={T} variant="ghost" onClick={() => { setType(cur.businessType); setChannel(cur.channel); setProvider(cur.paymentProvider); }} style={{ color:T.textSm }}>Descartar</Btn>}
        {saveBtn}
      </div>
    </Card>
  );
}
