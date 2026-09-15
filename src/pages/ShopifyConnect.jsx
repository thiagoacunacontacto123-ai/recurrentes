import React, { useState } from "react";
import { DS } from "../ui/theme.js";
import { Callout, toast } from "../ui/components.jsx";
import { SHOPIFY_SCOPES, SHOPIFY_SCOPES_STRING, SHOPIFY_DEV_DASHBOARD_URL, shopifyRedirectUrl, missingShopifyScopes } from "../../shared/platform/shopify.js";
import { SHOPIFY_TUTORIAL_URL, tutorialEmbed } from "../lib/tutorials.js";
import { WHATSAPP_SOPORTE } from "../lib/onboarding.js";

// ─── Conectar Shopify con la app del comerciante — piezas del modal guiado ──
// Las usan Integrations.jsx (modal "Conectar Shopify") y Guide.jsx (Ayuda →
// Shopify), así los pasos y los errores se escriben en UN solo lugar.
// Shopify (Dev Dashboard) está en inglés: cada botón va en inglés y en negrita,
// con lo que significa entre paréntesis.

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const F = "'Inter',system-ui,sans-serif";
const currentOrigin = () => { try { return window.location.origin; } catch (_) { return "https://www.recurrentesapp.com"; } };

const B = ({ T, children }) => <strong style={{ color:T.text }}>{children}</strong>;
const A = ({ T, href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color:T.accent, fontWeight:DS.w.semibold, textDecoration:"underline" }}>{children}</a>;
const Mono = ({ T, children }) => <code style={{ fontFamily:MONO, fontSize:11, background:T.bg, border:`1px solid ${T.borderL}`, borderRadius:4, padding:"1px 5px", color:T.text, wordBreak:"break-all" }}>{children}</code>;
// Botón de Shopify en inglés + qué significa.
export const En = ({ T, en, es }) => <><strong style={{ color:T.text }}>{en}</strong>{es && <span style={{ color:T.textSm }}> ({es})</span>}</>;

// Texto + botón Copiar (con "✓ Copiado").
export function CopyRow({ T, text, label = "Copiar" }) {
  const [ok, setOk] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setOk(true); toast("Copiado", "success"); setTimeout(() => setOk(false), 1600); }
    catch (_) { toast("No se pudo copiar: seleccioná el texto y copialo a mano", "warning"); }
  };
  return (
    <div style={{ display:"flex", gap:6, alignItems:"center", marginTop:6 }}>
      <code style={{ flex:1, minWidth:0, background:T.bg, border:`1px solid ${T.borderL}`, padding:"7px 9px", borderRadius:6, fontSize:11, color:T.accent, wordBreak:"break-all", fontFamily:MONO, lineHeight:1.45, userSelect:"all" }}>{text}</code>
      <button type="button" onClick={copy} aria-label={`${label}: ${text}`}
        style={{ fontSize:11, fontWeight:700, padding:"6px 10px", borderRadius:6, border:`1px solid ${ok ? T.green + "66" : T.border}`, background: ok ? T.green + "14" : "transparent", color: ok ? T.green : T.textMd, cursor:"pointer", fontFamily:F, flexShrink:0, minWidth:78, whiteSpace:"nowrap" }}>{ok ? "✓ Copiado" : label}</button>
    </div>
  );
}

// ─── Video tutorial (o recuadro "próximamente" si todavía no hay URL) ──
export function TutorialVideo({ T, url = SHOPIFY_TUTORIAL_URL, title = "Video paso a paso", caption }) {
  const e = tutorialEmbed(url);
  if (!e) return null;
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ borderRadius:12, overflow:"hidden", border:`1px solid ${T.border}`, background:"#000" }}>
        {e.kind === "iframe"
          ? <div style={{ position:"relative", paddingTop:"56.25%" }}>
              <iframe src={e.src} title={title} loading="lazy" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowFullScreen style={{ position:"absolute", inset:0, width:"100%", height:"100%", border:0 }}/>
            </div>
          : <video src={e.src} controls preload="none" playsInline style={{ width:"100%", display:"block", maxHeight:340, background:"#000" }}>Tu navegador no puede reproducir el video.</video>}
      </div>
      <div style={{ fontSize:11, color:T.textSm, marginTop:6, textAlign:"center" }}>{caption || "▶ Tutorial paso a paso · abajo el detalle escrito"}</div>
    </div>
  );
}

// Lista numerada estilo Growith (círculo con el número).
function NumSteps({ T, items }) {
  return (
    <ol style={{ margin:0, padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:12 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display:"flex", gap:11, alignItems:"flex-start" }}>
          <span aria-hidden="true" style={{ width:22, height:22, borderRadius:"50%", background:T.accentSolid + "1a", color:T.accent, fontSize:11, fontWeight:800, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>{i + 1}</span>
          <div style={{ flex:1, minWidth:0 }}>{it}</div>
        </li>
      ))}
    </ol>
  );
}

// ─── Pasos para crear la app en el Dev Dashboard de Shopify ──
// where: "modal" (los campos están abajo) | "guide" (hay que ir a Integraciones).
export function ShopifyConnectSteps({ T, origin, where = "modal" }) {
  const base = origin || currentOrigin();
  const redirect = shopifyRedirectUrl(base);
  const pasteWhere = where === "modal" ? <>pegalos en los campos 2 y 3 de acá abajo</> : <>pegalos en Recurrentes → <B T={T}>Configuración → Integraciones → Shopify</B></>;
  return (
    <div style={{ padding:"14px 16px", background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:10, marginBottom:18, fontSize:12, color:T.textMd, lineHeight:1.7 }}>
      <div style={{ fontWeight:700, color:T.text, marginBottom:8 }}>Crear tu app en Shopify (3 minutos)</div>
      <ol style={{ margin:0, paddingLeft:18, display:"flex", flexDirection:"column", gap:9 }}>
        <li>Entrá a <A T={T} href={SHOPIFY_DEV_DASHBOARD_URL}>dev.shopify.com/dashboard</A> → <B T={T}>Create app</B> → nombre <B T={T}>Recurrentes</B>.</li>
        <li>Entrá a la app → <B T={T}>Versiones → Crear versión</B>. Ahí adentro está todo lo de los pasos 3 y 4.</li>
        <li>En <B T={T}>Alcances (scopes)</B> pegá TODOS estos de una (van separados por comas):
          <CopyRow T={T} text={SHOPIFY_SCOPES_STRING}/>
        </li>
        <li>En <B T={T}>URL de redireccionamiento</B> pegá exactamente esta:
          <CopyRow T={T} text={redirect}/>
        </li>
        <li><B T={T}>Lanzá la versión:</B> tocá <B T={T}>"Publicar" / "Lanzar"</B> (arriba a la derecha). Aparece un cartel pidiendo el <B T={T}>nombre de la versión</B> → dejalo <B T={T}>en blanco</B> y tocá de nuevo <B T={T}>"Lanzar" / "Avanzar"</B>. Con eso la versión interna de tu app queda lista.</li>
        <li>Ahora sí, en <B T={T}>Configuración → Credenciales</B> copiá el <B T={T}>Client ID</B> y el <B T={T}>Client Secret</B> (tocá el ojito para verlo) → {pasteWhere}.</li>
      </ol>
    </div>
  );
}

// Aviso suave sobre las claves pegadas (no bloquea).
export function shopifyCredsWarning(clientId, secret) {
  const a = String(clientId || "").trim(), b = String(secret || "").trim();
  if (a && /^shp[a-z]{2}_/i.test(a)) return "Eso parece la clave secreta (empieza con shp…). En el campo 2 va el Client ID, que es el otro código.";
  if (a && b && a === b) return "El Client ID y el Secret son dos códigos distintos: fijate de no haber pegado el mismo dos veces.";
  if (/\s/.test(a) || /\s/.test(b)) return "Hay espacios en el medio del código: copialo de nuevo desde Shopify.";
  if (a && a.length < 20) return "El Client ID parece incompleto: copialo entero desde Settings → Credentials.";
  return "";
}

// ─── ¿Algo falló? — acordeón con los errores comunes ──
export function ShopifyTroubleshoot({ T, origin, defaultOpen = false, style = {} }) {
  const base = origin || currentOrigin();
  const [open, setOpen] = useState(defaultOpen);
  const [item, setItem] = useState(null);
  const ITEMS = [
    { q:"Shopify dice que la redirect_uri no está permitida", err:"The redirect_uri is not whitelisted",
      a:<>La <B T={T}>URL de redirección</B> de tu app no es igual a la nuestra. En tu app andá a <En T={T} en="Versions" es="versiones"/> → <En T={T} en="Create version" es="crear versión"/>, en <En T={T} en="Redirect URLs"/> borrá lo que haya y pegá esta, idéntica:<CopyRow T={T} text={shopifyRedirectUrl(base)} label="Copiar URL"/><div style={{ marginTop:6 }}>Tocá <En T={T} en="Release"/> y volvé a tocar Autorizar en Shopify.</div></> },
    { q:"Conectó, pero no veo mis productos o no puedo importar los envíos", err:"requires merchant approval for … scope",
      a:<>A tu app le faltan <B T={T}>permisos</B>. Creá una versión nueva con la lista completa en <En T={T} en="Scopes" es="permisos"/>:<CopyRow T={T} text={SHOPIFY_SCOPES_STRING} label="Copiar permisos"/><div style={{ marginTop:6 }}>Tocá <En T={T} en="Release"/> y después <B T={T}>Reconectar</B> en Recurrentes (Integraciones → Shopify → Ajustes).</div></> },
    { q:"Cambié algo en la app de Shopify y sigue igual",
      a:<>Falta <B T={T}>publicar la versión</B>. En Shopify los permisos y las URLs recién valen cuando tocás <En T={T} en="Release" es="publicar"/>. Fijate en <En T={T} en="Versions" es="versiones"/> que la versión con tus cambios sea la activa, y volvé a tocar Autorizar.</> },
    { q:"Me dice que el dominio no es válido",
      a:<>Pegaste el dominio de tu tienda (ej: <Mono T={T}>mitienda.com.ar</Mono>). Necesitamos el interno de Shopify, que termina en <Mono T={T}>.myshopify.com</Mono>. Lo ves en tu admin de Shopify → <B T={T}>Configuración → Dominios</B> (<En T={T} en="Settings → Domains"/>): es el que dice <B T={T}>predeterminado de Shopify</B>. También sirve escribir solo la primera parte: completamos el resto.</> },
    { q:"Dice «HMAC inválido» o «¿El Client Secret es correcto?»", err:"HMAC inválido",
      a:<>El <B T={T}>Secret</B> no es el de esta app o se copió incompleto. Volvé a <En T={T} en="Settings → Credentials"/>, tocá el ojito, copiá el Secret entero y pegalo de nuevo. Si tenés varias apps, revisá que el Client ID y el Secret sean de la misma. Si tocaste <En T={T} en="Rotate" es="renovar la clave"/>, usá la nueva.</> },
    { q:"Dice «State inválido o vencido»",
      a:<>Pasaron más de 10 minutos o Shopify se abrió en otro navegador. Volvé a tocar <B T={T}>Autorizar en Shopify</B> desde acá, en la misma ventana.</> },
    { q:"Shopify no me deja instalar la app en mi tienda",
      a:<>Casi siempre es porque creaste la app con una cuenta que no es la de tu tienda. Entrá a <A T={T} href={SHOPIFY_DEV_DASHBOARD_URL}>dev.shopify.com</A> con la cuenta dueña de la tienda y creá la app de nuevo desde ahí.</> },
  ];
  return (
    <div style={{ border:`1px solid ${T.borderL}`, borderRadius:10, marginTop:16, overflow:"hidden", ...style }}>
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"11px 14px", border:"none", background:T.surface, color:T.text, fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:F, textAlign:"left" }}>
        <span aria-hidden="true" style={{ width:20, height:20, borderRadius:"50%", background:T.yellow + "22", color:T.yellow, display:"inline-flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, flexShrink:0 }}>?</span>
        <span style={{ flex:1 }}>¿Algo falló?<span style={{ fontWeight:500, color:T.textSm }}> · los errores más comunes y cómo arreglarlos</span></span>
        <span aria-hidden="true" style={{ color:T.textSm }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div style={{ padding:"4px 14px 12px" }}>
          {ITEMS.map((it, i) => {
            const on = item === i;
            return (
              <div key={i} style={{ borderBottom: i < ITEMS.length - 1 ? `1px solid ${T.borderL}` : "none" }}>
                <button type="button" onClick={() => setItem(on ? null : i)} aria-expanded={on}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:8, padding:"10px 0", border:"none", background:"transparent", color:T.text, fontSize:12.5, fontWeight:600, cursor:"pointer", fontFamily:F, textAlign:"left" }}>
                  <span style={{ flex:1 }}>{it.q}</span>
                  <span aria-hidden="true" style={{ color:T.textSm, fontSize:11 }}>{on ? "−" : "+"}</span>
                </button>
                {on && (
                  <div style={{ fontSize:12, color:T.textMd, lineHeight:1.6, padding:"0 0 12px" }}>
                    {it.err && <div style={{ marginBottom:6 }}>Mensaje que ves: <Mono T={T}>{it.err}</Mono></div>}
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
          <div style={{ fontSize:11.5, color:T.textSm, marginTop:10, lineHeight:1.5 }}>
            ¿Seguís trabado? <a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer" style={{ color:T.accent, fontWeight:600 }}>Escribinos por WhatsApp</a> y lo resolvemos juntos.
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Aviso: a la conexión le faltan permisos (ej. read_shipping) ──
// Solo aparece si Shopify nos dijo qué permisos dio (shopify_scope). No fuerza nada.
export function ShopifyScopeNotice({ T, scope, onReconnect, style = {} }) {
  const miss = missingShopifyScopes(scope);
  if (!miss.length) return null;
  const info = SHOPIFY_SCOPES.filter(s => miss.includes(s.id));
  return (
    <Callout T={T} tone="warning" title={miss.length === 1 ? "A tu conexión le falta un permiso" : "A tu conexión le faltan permisos"} style={{ marginBottom:14, ...style }}
      right={onReconnect && <button type="button" onClick={onReconnect} style={{ fontSize:12, padding:"6px 12px", borderRadius:8, border:`1px solid ${T.border}`, background:"transparent", color:T.textMd, fontWeight:600, cursor:"pointer", fontFamily:F, whiteSpace:"nowrap" }}>Reconectar</button>}>
      {info.map(s => <div key={s.id}><Mono T={T}>{s.id}</Mono> · {s.why}</div>)}
      <div style={{ marginTop:6 }}>Lo demás sigue andando. Para sumarlo: en tu app de Shopify creá una versión nueva con la lista completa de <B T={T}>Scopes</B>, tocá <B T={T}>Release</B> y después <B T={T}>Reconectar</B> acá.</div>
    </Callout>
  );
}
