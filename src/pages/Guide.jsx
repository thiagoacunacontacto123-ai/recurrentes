import React, { useState, useEffect } from "react";
import { DS, useT } from "../ui/theme.js";
import { Card, Btn, Callout, PageHeader, SubTabs, toast } from "../ui/components.jsx";
import { WHATSAPP_SOPORTE, useOnb, goConfigSection, goPlanesWidget } from "../lib/onboarding.js";
import { SHOPIFY_SCOPES } from "../../shared/platform/shopify.js";
import { ShopifyConnectSteps, ShopifyTroubleshoot, TutorialVideo } from "./ShopifyConnect.jsx";

// ─────────────────────────────────────────────────────────────────
// Guía escrita dentro de la app. Vive en Configuración → Ayuda (embedded);
// también acepta #/dashboard/guia?s=<sección> (ruta vieja).
// Sin imágenes: cada paso tiene "capturas de texto" (ruta de menús y
// pantallas dibujadas con cajas) para que se pueda seguir sin salir.
// Contenido base: MERCHANT_GUIDE.md del repo + flujo real de la app.
// ─────────────────────────────────────────────────────────────────

const MONO = "ui-monospace, SFMono-Regular, Menlo, 'Cascadia Code', monospace";
const F = "'Inter',system-ui,sans-serif";

export const GUIDE_SECTIONS = [
  { id:"inicio",  label:"Empezar" },
  { id:"shopify", label:"Shopify" },
  { id:"mp",      label:"Mercado Pago" },
  { id:"planes",  label:"Planes y packs" },
  { id:"diseno",  label:"Widget" },
  { id:"snippet", label:"Pegar el snippet" },
  { id:"pagina",  label:"La página del checkout" },
  { id:"probar",  label:"Probar" },
  { id:"tienda",  label:"Tienda y envíos" },
  { id:"faq",     label:"Preguntas" },
];

function readHashSec() {
  try {
    const q = new URLSearchParams((window.location.hash.split("?")[1]) || "");
    const s = q.get("s");
    return GUIDE_SECTIONS.some(x => x.id === s) ? s : null;
  } catch (_) { return null; }
}

export default function GuidePage({ merchant, goTab, embedded = false, initial }) {
  const T = useT();
  const onb = useOnb();
  const [sec, setSec] = useState(() => initial || readHashSec() || "inicio");
  useEffect(() => {
    const onHash = () => { const s = readHashSec(); if (s) setSec(s); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const go = (id) => { setSec(id); try { if (!embedded) window.history.replaceState(null, "", `${window.location.pathname}#/dashboard/guia?s=${id}`); window.scrollTo({ top: 0, behavior: "smooth" }); } catch (_) {} };
  const origin = typeof window !== "undefined" ? window.location.origin : "https://recurrentesapp.com";
  const mid = merchant?.id || "<tu-id>";
  const ctx = { T, go, goTab, onb, origin, mid, merchant };

  const Body = ({
    inicio: SecInicio, shopify: SecShopify, mp: SecMp, planes: SecPlanes, diseno: SecDiseno,
    snippet: SecSnippet, pagina: SecPagina, probar: SecProbar, tienda: SecTienda, faq: SecFaq,
  })[sec] || SecInicio;

  return (
    <div style={{ fontFamily:"inherit", color:T.text }}>
      {!embedded && (
        <PageHeader T={T} title="Guía" subtitle="Todo lo que necesitás para dejar Recurrentes andando en tu tienda, paso a paso y sin salir de la app."
          right={<a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer" style={{ ...btnLink(T), textDecoration:"none" }}>💬 Soporte por WhatsApp</a>}/>
      )}
      <div style={{ marginBottom:DS.sp.lg, overflowX:"auto" }} className="no-scrollbar">
        <SubTabs T={T} tabs={GUIDE_SECTIONS} active={sec} onChange={go}/>
      </div>
      <div className="gh-accordion" key={sec}>
        <Body {...ctx}/>
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, marginTop:DS.sp.xl, flexWrap:"wrap" }}>
        {(() => { const i = GUIDE_SECTIONS.findIndex(x => x.id === sec); const prev = GUIDE_SECTIONS[i - 1], next = GUIDE_SECTIONS[i + 1]; return (<>
          <div>{prev && <Btn T={T} variant="secondary" size="sm" onClick={() => go(prev.id)}>← {prev.label}</Btn>}</div>
          <div>{next && <Btn T={T} variant="secondary" size="sm" onClick={() => go(next.id)}>{next.label} →</Btn>}</div>
        </>); })()}
      </div>
      <div style={{ marginTop:DS.sp.xl, fontSize:DS.font.md, color:T.textSm, textAlign:"center", lineHeight:1.6 }}>
        ¿Te trabaste en algún paso? <a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer" style={{ color:T.accent, fontWeight:DS.w.semibold }}>Escribinos por WhatsApp</a> y lo resolvemos con vos.
      </div>
    </div>
  );
}

// ─── Piezas de la guía ──────────────────────────────────────────────
function btnLink(T) { return { display:"inline-flex", alignItems:"center", gap:6, padding:"7px 12px", borderRadius:DS.r.md, border:`1px solid ${T.border}`, color:T.textMd, fontSize:DS.font.sm, fontWeight:DS.w.semibold, fontFamily:F }; }

function Sec({ T, title, sub, children, right }) {
  return (
    <Card T={T} style={{ marginBottom:DS.sp.lg }}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:12, flexWrap:"wrap", marginBottom:DS.sp.md }}>
        <div style={{ flex:1, minWidth:220 }}>
          <div style={{ fontSize:DS.font.xl, fontWeight:DS.w.bold, color:T.text, letterSpacing:-0.3 }}>{title}</div>
          {sub && <div style={{ fontSize:DS.font.base, color:T.textSm, marginTop:4, lineHeight:1.55 }}>{sub}</div>}
        </div>
        {right && <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>{right}</div>}
      </div>
      {children}
    </Card>
  );
}
function P({ T, children, style = {} }) { return <p style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.65, margin:"0 0 10px", ...style }}>{children}</p>; }
function B({ T, children }) { return <strong style={{ color:T.text }}>{children}</strong>; }
function Code({ T, children }) { return <code style={{ fontFamily:MONO, fontSize:12, background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:4, padding:"1px 5px", color:T.text }}>{children}</code>; }
function A({ T, href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color:T.accent, fontWeight:DS.w.semibold }}>{children}</a>; }

// "Captura de texto": la ruta de menús que hay que tocar.
function Crumb({ T, path }) {
  const parts = Array.isArray(path) ? path : String(path).split("›").map(s => s.trim());
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap", margin:"6px 0 10px" }}>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <span style={{ fontSize:DS.font.sm, fontWeight:DS.w.semibold, color: i === parts.length - 1 ? T.accent : T.textMd, background: i === parts.length - 1 ? T.accentSolid + "16" : T.surface, border:`1px solid ${i === parts.length - 1 ? T.accentSolid + "55" : T.border}`, borderRadius:6, padding:"3px 8px", whiteSpace:"nowrap" }}>{p}</span>
          {i < parts.length - 1 && <span style={{ color:T.textSm, fontSize:12 }}>›</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
// Pantalla dibujada: marco con barra de título y "campos".
function Screen({ T, title, rows = [] }) {
  return (
    <div style={{ border:`1px solid ${T.border}`, borderRadius:DS.r.lg, overflow:"hidden", margin:"8px 0 12px", background:T.surface }}>
      <div style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 10px", borderBottom:`1px solid ${T.borderL}`, background:T.bg }}>
        <span style={{ width:8, height:8, borderRadius:"50%", background:T.red + "88" }}/><span style={{ width:8, height:8, borderRadius:"50%", background:T.yellow + "88" }}/><span style={{ width:8, height:8, borderRadius:"50%", background:T.green + "88" }}/>
        <span style={{ marginLeft:8, fontSize:DS.font.sm, color:T.textSm, fontWeight:DS.w.semibold }}>{title}</span>
      </div>
      <div style={{ padding:"10px 12px", display:"flex", flexDirection:"column", gap:6 }}>
        {rows.map((r, i) => typeof r === "string"
          ? <div key={i} style={{ fontSize:DS.font.md, color:T.textMd, lineHeight:1.5 }}>{r}</div>
          : <div key={i} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
              <span style={{ fontSize:DS.font.sm, color:T.textSm, minWidth:130 }}>{r.label}</span>
              <span style={{ flex:1, minWidth:160, fontSize:DS.font.md, color: r.hl ? T.accent : T.text, fontFamily: r.mono ? MONO : F, background:T.card, border:`1px solid ${r.hl ? T.accentSolid + "66" : T.borderL}`, borderRadius:6, padding:"5px 8px", wordBreak:"break-all" }}>{r.value}</span>
              {r.btn && <span style={{ fontSize:DS.font.sm, fontWeight:DS.w.bold, color:"#fff", background:T.accentSolid, borderRadius:6, padding:"5px 10px" }}>{r.btn}</span>}
            </div>
        )}
      </div>
    </div>
  );
}
function Steps({ T, items }) {
  return (
    <ol style={{ margin:"0 0 12px", paddingLeft:0, listStyle:"none", display:"flex", flexDirection:"column", gap:10 }}>
      {items.map((it, i) => (
        <li key={i} style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
          <span style={{ width:24, height:24, borderRadius:"50%", background:T.accentSolid + "1a", color:T.accent, fontSize:12, fontWeight:DS.w.bold, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1 }}>{i + 1}</span>
          <div style={{ flex:1, minWidth:0, fontSize:DS.font.base, color:T.textMd, lineHeight:1.6 }}>{it}</div>
        </li>
      ))}
    </ol>
  );
}
function CodeBlock({ T, code, label = "Copiar" }) {
  const [ok, setOk] = useState(false);
  async function copy() { try { await navigator.clipboard.writeText(code); setOk(true); toast("Copiado", "success"); setTimeout(() => setOk(false), 1500); } catch (_) { toast("Seleccioná el texto y copialo a mano", "warning"); } }
  return (
    <div style={{ position:"relative", margin:"8px 0 12px" }}>
      <pre style={{ background:T.bg, border:`1px solid ${T.border}`, borderRadius:DS.r.lg, padding:"12px 96px 12px 14px", fontSize:DS.font.md, fontFamily:MONO, overflowX:"auto", margin:0, color:T.accent, lineHeight:1.55, whiteSpace:"pre-wrap", wordBreak:"break-all" }}>{code}</pre>
      <button onClick={copy} style={{ position:"absolute", top:8, right:8, background:T.card, border:`1px solid ${T.border}`, borderRadius:6, color:T.textMd, fontSize:DS.font.sm, fontWeight:DS.w.semibold, padding:"4px 9px", cursor:"pointer", fontFamily:F }}>{ok ? "✓ Copiado" : label}</button>
    </div>
  );
}
function StepStatus({ T, onb, id }) {
  const s = onb?.steps?.find(x => x.id === id);
  if (!s) return null;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:DS.font.sm, fontWeight:DS.w.bold, color: s.done ? T.green : T.yellow, background: (s.done ? T.green : T.yellow) + "16", border:`1px solid ${(s.done ? T.green : T.yellow)}44`, borderRadius:99, padding:"3px 10px" }}>
      {s.done ? "✓ Paso listo" : `Paso ${s.n} pendiente`}
    </span>
  );
}

// ─── Secciones ──────────────────────────────────────────────────────
function SecInicio({ T, go, goTab }) {
  return (
    <>
      <Sec T={T} title="Cómo funciona Recurrentes" sub="Leé esto primero: son 2 minutos y después cada paso tiene sentido.">
        <P T={T}>Recurrentes agrega <B T={T}>suscripciones con cobro automático</B> a tu tienda Shopify usando <B T={T}>tu cuenta de Mercado Pago</B>. Vos creás un <B T={T}>plan</B> por producto (frecuencia, descuento y packs), pegás <B T={T}>un snippet</B> en tu theme y el cliente ve el selector de suscripción en la página de producto.</P>
        <P T={T}>Cuando el cliente se suscribe, paga en Mercado Pago. Cada vez que MP cobra (la primera vez y cada renovación), Recurrentes <B T={T}>crea una orden en tu Shopify</B> con el producto, la cantidad del pack, la dirección y el envío. Vos la despachás como cualquier otra.</P>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(150px, 1fr))", gap:8, margin:"12px 0 4px" }}>
          {[["1","Cliente elige pack","en tu página de producto"],["2","Paga en MP","se crea la suscripción"],["3","MP cobra cada período","automático, con reintentos"],["4","Orden en Shopify","vos despachás"]].map(([n, t, d]) => (
            <div key={n} style={{ background:T.surface, border:`1px solid ${T.borderL}`, borderRadius:DS.r.lg, padding:"10px 12px" }}>
              <div style={{ fontSize:DS.font.xs, fontWeight:DS.w.bold, color:T.accent }}>PASO {n}</div>
              <div style={{ fontSize:DS.font.base, fontWeight:DS.w.bold, color:T.text, marginTop:2 }}>{t}</div>
              <div style={{ fontSize:DS.font.sm, color:T.textSm, marginTop:2 }}>{d}</div>
            </div>
          ))}
        </div>
      </Sec>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:DS.sp.lg }}>
        <Btn T={T} variant="solid" size="sm" onClick={() => go("shopify")}>Empezar por Shopify →</Btn>
        <Btn T={T} variant="secondary" size="sm" onClick={() => goTab?.("inicio")}>Ver mi plan de acción en Inicio</Btn>
      </div>
    </>
  );
}

// Los pasos, el video y "¿Algo falló?" salen de ShopifyConnect.jsx (los mismos del
// modal de Integraciones); los permisos, de shared/platform/shopify.js.
function SecShopify({ T, onb, goTab, origin }) {
  return (
    <>
      <Sec T={T} title="Conectar Shopify con tu propia app" sub="Recurrentes entra a tu tienda con una app que creás vos en el panel de desarrolladores de Shopify. Es tuya: la controlás vos y la podés borrar cuando quieras. Lleva 5 minutos y se hace una sola vez."
        right={<><StepStatus T={T} onb={onb} id="shopify"/><Btn T={T} variant="primary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Ir a Integraciones →</Btn></>}>
        <Callout T={T} tone="info" style={{ marginBottom:12 }}>Si en Configuración → Integraciones la conexión de Shopify <B T={T}>no</B> te pide Client ID ni Secret, Recurrentes ya tiene una app configurada: solo pegá tu dominio <Code T={T}>tu-tienda.myshopify.com</Code>, tocá <B T={T}>Autorizar en Shopify</B> e instalá. Podés saltear el resto de esta sección.</Callout>
        <TutorialVideo T={T}/>
        <ShopifyConnectSteps T={T} origin={origin} where="guide"/>
        <P T={T}>En Recurrentes, <B T={T}>Conectar Shopify</B> te pide tres datos:</P>
        <Screen T={T} title="Recurrentes › Configuración › Integraciones › Conectar Shopify" rows={[{ label:"1 · Dominio", value:"tu-tienda.myshopify.com", mono:true }, { label:"2 · Client ID", value:"a1b2c3d4e5f6…", mono:true }, { label:"3 · Client Secret", value:"shpss_••••••••••••", mono:true, btn:"Autorizar en Shopify →" }]}/>
        <ShopifyTroubleshoot T={T} origin={origin} defaultOpen/>
      </Sec>
      <Sec T={T} title="Qué hace Recurrentes en tu Shopify">
        <P T={T}><B T={T}>Lee</B> productos y variantes (para armar planes), <B T={T}>crea</B> órdenes pagas con etiqueta <Code T={T}>RECURRENTE</Code> cada cobro, <B T={T}>crea o actualiza</B> el cliente con su dirección y <B T={T}>lee</B> tus tarifas de envío y los datos de la tienda (nombre, dominio, moneda, mail). No toca stock, precios ni temas.</P>
        <Screen T={T} title="Permisos que pide Recurrentes" rows={SHOPIFY_SCOPES.map(s => ({ label:s.id, value:s.why }))}/>
      </Sec>
    </>
  );
}

function SecMp({ T, onb, goTab }) {
  return (
    <>
      <Sec T={T} title="Conectar Mercado Pago" sub="Necesitamos el Access Token de tu cuenta de MP (la que cobra) con el producto Suscripciones habilitado. Se obtiene creando una aplicación en el panel de developers de MP: es tuya y queda en tu cuenta."
        right={<><StepStatus T={T} onb={onb} id="mp"/><Btn T={T} variant="primary" size="sm" onClick={() => goConfigSection(goTab, "integraciones")}>Ir a Integraciones →</Btn></>}>
        <Callout T={T} tone="warning" title="Tu Access Token es SECRETO" style={{ marginBottom:12 }}>Es como la llave de tu caja registradora. No lo compartas por redes, capturas ni con nadie que no sea Recurrentes. Si sospechás que se filtró, regeneralo desde MP y volvé a pegarlo.</Callout>
        <Steps T={T} items={[
          <>Con tu cuenta MP <B T={T}>de comercio</B> entrá a <A T={T} href="https://www.mercadopago.com.ar/developers/panel/app">mercadopago.com.ar/developers/panel/app</A>.<Crumb T={T} path="Mercado Pago › Developers › Tus integraciones"/></>,
          <>Tocá <B T={T}>Crear aplicación</B> y completá:
            <Screen T={T} title="MP Developers › Crear aplicación" rows={[{ label:"Nombre", value:"Recurrentes" }, { label:"Producto", value:"☑ Suscripciones (preapproval)  ·  ☐ Checkout Pro (opcional)", hl:true }, { label:"Modelo", value:"Plataforma propia / el que te aplique" }]}/>
          </>,
          <>En la app, andá a <B T={T}>Credenciales de producción</B>. Si te pide completar datos de la cuenta o validar el mail, hacelo.<Crumb T={T} path="Tu aplicación › Credenciales de producción"/></>,
          <>Copiá el <B T={T}>Access Token</B> (empieza con <Code T={T}>APP_USR-</Code>). La Public Key no hace falta.
            <Screen T={T} title="MP Developers › Credenciales de producción" rows={[{ label:"Public Key", value:"APP_USR-abcd…  (no la necesitamos)", mono:true }, { label:"Access Token", value:"APP_USR-1234567890-••••••", mono:true, hl:true, btn:"Copiar" }]}/>
          </>,
          <>En Recurrentes → <B T={T}>Configuración → Integraciones → Mercado Pago → Pegar Access Token</B>, pegalo y guardá. Validamos el token contra MP y queda conectado; vas a ver el mail de la cuenta de MP en la card.</>,
        ]}/>
        <P T={T}><B T={T}>¿Querés probar antes sin plata real?</B> En la misma app de MP, <B T={T}>Credenciales de prueba</B> te da un token <Code T={T}>TEST-</Code>. Sirve para ver el circuito, pero con ese token ningún cliente real va a poder pagar. Cuando estés listo, pegá el de producción con <B T={T}>Cambiar Access Token</B>.</P>
        <P T={T}>Si aparece el botón <B T={T}>Conectar Mercado Pago (OAuth)</B>, es la alternativa sin copiar nada: te lleva a MP a autorizar a Recurrentes.</P>
      </Sec>
    </>
  );
}

function SecPlanes({ T, onb, goTab }) {
  return (
    <>
      <Sec T={T} title="Planes: qué son y cómo crear el primero" sub="Un plan convierte un producto de tu Shopify en suscripción. Definís cada cuánto se cobra, qué descuento tiene y qué packs se ofrecen."
        right={<><StepStatus T={T} onb={onb} id="plan"/><Btn T={T} variant="primary" size="sm" onClick={() => goTab?.("planes")}>Ir a Planes →</Btn></>}>
        <Steps T={T} items={[
          <>Andá a <B T={T}>Planes → + Nuevo plan</B> y elegí el producto (y la variante si tiene). Se lista tu catálogo de Shopify.<Crumb T={T} path="Recurrentes › Planes › + Nuevo plan"/></>,
          <>Elegí la <B T={T}>frecuencia</B> en días (30 = mensual, 15 = quincenal, 60 = bimestral). Es cada cuánto MP cobra y cada cuánto se genera una orden.</>,
          <>Poné el <B T={T}>descuento por suscribirse</B> (%) respecto del precio de compra única. Es el incentivo: 10-15% suele funcionar.</>,
          <>Armá los <B T={T}>packs</B> (ver abajo). Mientras cargás, a la derecha ves la <B T={T}>vista previa en vivo</B> del widget con tus precios.</>,
          <>Envío: si cargaste <B T={T}>envíos del checkout</B> en Configuración → Tienda, el cliente elige entre esos. Si no, el plan tiene un envío por defecto (precio, "gratis desde $X" y nombre).</>,
          <>Guardá. Recurrentes crea el plan de suscripción en tu MP y lo deja <B T={T}>activo</B>. Ya podés copiar el snippet desde <B T={T}>📋 Snippet</B>.</>,
        ]}/>
      </Sec>
      <Sec T={T} title="Packs: la clave del ticket promedio">
        <P T={T}>Un <B T={T}>pack</B> es una cantidad del mismo producto ofrecida en el selector: <B T={T}>x1, x2, x3</B>… Cada pack tiene su <B T={T}>precio total</B> y, opcionalmente, un <B T={T}>precio tachado</B> (para mostrar el ahorro), una <B T={T}>etiqueta</B> ("Más elegido", "Mejor precio") y una frecuencia propia. El cliente elige el pack y se suscribe a esa cantidad: cada cobro genera una orden con esas unidades.</P>
        <Screen T={T} title="Ejemplo de packs para un producto de $10.000" rows={[
          { label:"Pack x1", value:"$9.000  (tachado $10.000)  ·  cada 30 días" },
          { label:"Pack x2  ★ Más elegido", value:"$17.000  (tachado $20.000)  ·  $8.500 c/u", hl:true },
          { label:"Pack x3", value:"$24.000  (tachado $30.000)  ·  $8.000 c/u" },
        ]}/>
        <P T={T}>Consejos: 2 o 3 packs alcanzan; marcá uno como <B T={T}>default</B> (el que arranca seleccionado) y que el precio por unidad baje a medida que sube la cantidad. Podés editar los packs de un plan en cualquier momento sin afectar a los suscriptores que ya están cobrándose.</P>
      </Sec>
    </>
  );
}

function SecDiseno({ T, onb, goTab }) {
  return (
    <Sec T={T} title="Widget: cómo se ve el selector" sub="El widget es el selector de packs que ve tu cliente en la página de producto. Hay 10 diseños con vista previa real usando tus planes. Vive en Planes → Widget."
      right={<><StepStatus T={T} onb={onb} id="design"/><Btn T={T} variant="primary" size="sm" onClick={() => goPlanesWidget(goTab)}>Abrir Planes → Widget →</Btn></>}>
      <Steps T={T} items={[
        <>Entrá a <B T={T}>Planes → pestaña Widget</B>.<Crumb T={T} path="Recurrentes › Planes › Widget"/></>,
        <>En la <B T={T}>galería</B> mirá los 10 diseños (v01 a v10) renderizados con tus packs. Tocá <B T={T}>Usar este</B> en el que más pegue con tu tienda.</>,
        <>Ajustá el <B T={T}>color de acento</B> (el hex de tu marca), el <B T={T}>radio de esquinas</B>, si se muestran los <B T={T}>precios tachados</B> y el <B T={T}>precio por unidad</B>, cuál opción aparece primero y cuál arranca seleccionada (suscripción o compra única).</>,
        <>Editá los <B T={T}>textos</B>: título, etiquetas del toggle, botones y líneas de confianza. Todo con vista previa al instante.</>,
        <>Tocá <B T={T}>Guardar diseño</B>. Se aplica a todos los productos con plan, sin volver a tocar el snippet. Abajo tenés el snippet para copiar y la casilla "Ya lo pegué".</>,
      ]}/>
      <Callout T={T} tone="info">El diseño es global para la tienda; los packs y precios salen de cada plan (Planes → Editar). Si un producto no tiene plan activo, el widget directamente no se muestra ahí.</Callout>
    </Sec>
  );
}

function SecSnippet({ T, onb, goTab, origin, mid }) {
  const snippet = `<script src="${origin}/widget.js?merchant=${mid}" defer></script>`;
  return (
    <>
      <Sec T={T} title="Pegar el snippet en tu tienda" sub="Una línea de código, una sola vez. Elegí la forma que te resulte más cómoda: como bloque Custom Liquid (sin tocar código) o en templates/product.json (editor de código)."
        right={<><StepStatus T={T} onb={onb} id="snippet"/>{onb && !onb.steps?.find(s => s.id === "snippet")?.done && <Btn T={T} variant="success" size="sm" onClick={() => onb.setManual(onb.steps.find(s => s.id === "snippet"), true)}>Ya lo pegué ✓</Btn>}</>}>
        <P T={T}>Tu snippet (también lo copiás desde <B T={T}>Planes → 📋 Snippet</B> o desde <B T={T}>Planes → Widget → Instalación</B>):</P>
        <CodeBlock T={T} code={snippet} label="Copiar snippet"/>
        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"14px 0 6px" }}>Opción A · Bloque Custom Liquid (recomendada, sin código)</div>
        <Steps T={T} items={[
          <>En Shopify: <B T={T}>Online Store → Themes → Personalizar</B>. Arriba, en el selector de plantillas, elegí <B T={T}>Productos → Producto predeterminado</B>.<Crumb T={T} path="Shopify › Online Store › Themes › Personalizar › Productos › Producto predeterminado"/></>,
          <>En la barra izquierda, dentro de la sección <B T={T}>Información del producto</B>, tocá <B T={T}>+ Agregar bloque → Liquid personalizado</B> (Custom Liquid).</>,
          <>Pegá el snippet en el cuadro de texto del bloque y arrastralo <B T={T}>debajo del botón "Agregar al carrito"</B> (o justo arriba, donde quieras que aparezca el selector).
            <Screen T={T} title="Shopify › Personalizar › Bloque Liquid personalizado" rows={[{ label:"Liquid personalizado", value:snippet, mono:true, hl:true }]}/>
          </>,
          <>Tocá <B T={T}>Guardar</B> arriba a la derecha. Listo: el widget aparece en los productos con plan activo.</>,
        ]}/>
        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"14px 0 6px" }}>Opción B · Editar templates/product.json (editor de código)</div>
        <Steps T={T} items={[
          <><B T={T}>Online Store → Themes → ⋯ → Editar código</B>. En la carpeta <Code T={T}>templates</Code> abrí <Code T={T}>product.json</Code>.<Crumb T={T} path="Shopify › Themes › Editar código › templates › product.json"/></>,
          <>Dentro de <Code T={T}>"sections" → "main" → "blocks"</Code> agregá un bloque de tipo <Code T={T}>custom_liquid</Code> con el snippet, y sumá su id al array <Code T={T}>block_order</Code> después de <Code T={T}>buy_buttons</Code>:</>,
        ]}/>
        <CodeBlock T={T} code={`"recurrentes": {\n  "type": "custom_liquid",\n  "settings": {\n    "custom_liquid": "${snippet.replace(/"/g, '\\"')}"\n  }\n}`} label="Copiar bloque"/>
        <Callout T={T} tone="warning" title="Ojo con las comillas">En product.json el snippet va dentro de un string JSON: las comillas internas tienen que ir escapadas (<Code T={T}>\"</Code>), como en el bloque de arriba. Si el archivo no guarda, es eso.</Callout>
        <P T={T} style={{ marginTop:12 }}>¿Theme viejo (product.liquid) o quieren ponerlo en otro lado? Pegalo dentro del <Code T={T}>&lt;form action="/cart/add"&gt;</Code>, al final. Funciona igual.</P>
      </Sec>
      <Sec T={T} title="Cómo saber si quedó bien">
        <Steps T={T} items={[
          <>Abrí en tu tienda un producto <B T={T}>que tenga plan activo</B> en Recurrentes.</>,
          <>Debajo (o arriba) del botón de compra tenés que ver el selector <B T={T}>Suscripción / Compra única</B> con tus packs.</>,
          <>Si no aparece: revisá que el plan esté activo, que el snippet esté en la plantilla de producto correcta (algunos themes usan varias) y recargá sin caché (Ctrl/Cmd + Shift + R).</>,
        ]}/>
      </Sec>
    </>
  );
}

function SecPagina({ T, onb, goTab, origin, mid }) {
  const path = "/pages/suscripcion-form";
  return (
    <>
      <Sec T={T} title="La página del checkout" sub="Una página de tu tienda donde el cliente completa sus datos y elige el envío. El widget lo manda ahí al tocar Suscribirme."
        right={<Btn T={T} variant="primary" size="sm" onClick={() => goConfigSection(goTab, "avanzado")}>Ir a Avanzado →</Btn>}>
        <Callout T={T} tone="info" title="¿Por qué hace falta una página?">
          El checkout de Shopify no soporta pagos recurrentes con Mercado Pago. Así que el cliente completa
          sus datos en esta página de tu tienda —con tu diseño y tu dominio— y desde ahí va a Mercado Pago a
          autorizar el cobro. Se crea una sola vez y sirve para todos tus planes.
        </Callout>

        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"16px 0 6px" }}>1 · Creá la página</div>
        <Steps T={T} items={[
          <>En Shopify: <B T={T}>Online Store → Pages → Add page</B>.<Crumb T={T} path="Shopify › Online Store › Pages › Add page"/></>,
          <>Título: <B T={T}>Suscripción</B>. Eso genera el handle <Code T={T}>suscripcion</Code> y la URL <Code T={T}>{path}</Code>. Si Shopify te pone otro handle, corregilo abajo en <B T={T}>Search engine listing → Edit</B>.</>,
          <>Contenido: <B T={T}>dejalo vacío</B>. El formulario lo pinta Recurrentes.</>,
          <>En <B T={T}>Theme template</B>, dejá <Code T={T}>page</Code> por ahora. Si tu theme tiene una plantilla de página sin barra lateral ni comentarios, elegí esa.</>,
          <>Tocá <B T={T}>Save</B>.</>,
        ]}/>

        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"16px 0 6px" }}>2 · Dejala limpia</div>
        <P T={T}>Acá está la parte que más se pasa por alto: la página hereda todo lo que tu theme le pone alrededor,
          y eso distrae justo cuando el cliente está por pagar. En <B T={T}>Personalizar</B>, con la página de
          Suscripción abierta en el selector de plantillas, saca o oculta:</P>
        <Steps T={T} items={[
          <>El <B T={T}>título de la página</B> (suele ser un bloque de la sección principal): el formulario ya tiene su propio encabezado.</>,
          <>Los <B T={T}>anuncios y barras promocionales</B> de arriba, si tenés. Un "3 cuotas sin interés" en una página de suscripción confunde.</>,
          <>Los bloques de <B T={T}>productos recomendados</B>, "también te puede gustar" y newsletter: acá solo sacan al cliente del pago.</>,
          <>El <B T={T}>buscador y el menú grande</B>, si tu theme te deja. Dejá el logo, que ancla la confianza.</>,
          <>Los <B T={T}>comentarios</B>, si la plantilla de página los trae.</>,
        ]}/>
        <Callout T={T} tone="warning" title="Lo que NO hay que sacar">
          Dejá el <B T={T}>logo</B>, el <B T={T}>pie con tus datos de contacto</B> y los links a tus <B T={T}>políticas</B> (devoluciones, privacidad).
          Es una página donde alguien está por dejar sus datos y autorizar un débito automático: si parece despojada
          o ajena a tu tienda, abandona. La idea es quitar distracciones, no quitar confianza.
        </Callout>

        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"16px 0 6px" }}>3 · Pegá el mismo snippet</div>
        <P T={T}>Sí, el mismo de la página de producto. El script detecta dónde está: en un producto pinta el selector, y en esta página pinta el formulario.</P>
        <CodeBlock T={T} code={`<script src="${origin}/widget.js?merchant=${mid}" defer></script>`} label="Copiar snippet"/>
        <Steps T={T} items={[
          <>En <B T={T}>Personalizar</B>, con la página de Suscripción abierta, agregá un bloque <B T={T}>Liquid personalizado</B> dentro de la sección principal.</>,
          <>Pegá el snippet y <B T={T}>Guardar</B>.</>,
        ]}/>

        <div style={{ fontSize:DS.font.lg, fontWeight:DS.w.bold, color:T.text, margin:"16px 0 6px" }}>4 · Decile a Recurrentes dónde está</div>
        <Steps T={T} items={[
          <>En Recurrentes: <B T={T}>Configuración → Avanzado</B>.<Crumb T={T} path="Recurrentes › Configuración › Avanzado"/></>,
          <>En <B T={T}>ruta de la página del checkout</B> poné <Code T={T}>{path}</Code> — o la ruta real, si tu handle quedó distinto.
            <Screen T={T} title="Recurrentes › Configuración › Avanzado" rows={[{ label:"Ruta de la página", value:path, mono:true, hl:true }]}/>
          </>,
          <>Guardá. Desde ahí, el botón <B T={T}>Suscribirme</B> del widget lleva a esa página.</>,
        ]}/>
        <Callout T={T} tone="warning" title="Si la ruta no coincide">
          Es el error más común: la página existe pero con otro handle
          (<Code T={T}>/pages/suscripcion-form</Code> vs <Code T={T}>/pages/suscripcion</Code>) y el botón lleva a un 404.
          Abrí la página en tu tienda, copiá la URL del navegador y pegá exactamente esa ruta.
        </Callout>
      </Sec>

      <Sec T={T} title="Cómo saber si quedó bien">
        <Steps T={T} items={[
          <>Abrí <Code T={T}>tu-tienda.com{path}</Code> directo en el navegador: tenés que ver el formulario, no una página en blanco.</>,
          <>Si ves la página vacía, el snippet no está en ESA página (fijate que lo pegaste con la plantilla de la página abierta, no con la de producto).</>,
          <>Entrá a un producto con plan activo, tocá <B T={T}>Suscribirme</B> y confirmá que caiga en esta página con el producto y el precio correctos.</>,
        ]}/>
      </Sec>
    </>
  );
}

function SecProbar({ T, goTab }) {
  return (
    <Sec T={T} title="Probar una suscripción de punta a punta" sub="Antes de anunciarlo, hacé una compra de prueba. Recomendamos hacerla con plata real y un producto barato: es la única forma de ver el circuito completo, y después la cancelás.">
      <Steps T={T} items={[
        <>Creá un plan con un producto barato (o un pack x1 de bajo precio) y verificá que el widget se vea en su página.</>,
        <>Desde <B T={T}>otra cuenta de Mercado Pago</B> (no la que cobra: MP no deja pagarte a vos mismo) elegí un pack, tocá <B T={T}>Suscribirme</B>, completá tus datos y el envío, y pagá en MP con tarjeta de crédito o débito.</>,
        <>Al terminar, tocá <B T={T}>Volver al sitio</B>. La pantalla de gracias espera a que MP confirme y te redirige.</>,
        <>En Recurrentes → <B T={T}>Suscripciones</B> aparece la suscripción (si tarda, tocá ↻: la pestaña sincroniza con MP al abrirse).<Crumb T={T} path="Recurrentes › Suscripciones › (tu prueba)"/></>,
        <>En <B T={T}>Cobros</B> ves el primer pago y el número de <B T={T}>orden de Shopify</B> creada. Abrila en Shopify: tiene el producto, la cantidad del pack, la dirección y la etiqueta <Code T={T}>RECURRENTE</Code>.</>,
        <>Revisá el <B T={T}>mail de activación</B> que recibió el cliente (llega al mail que cargó en el checkout) y entrá al <B T={T}>portal</B> desde el link: ahí puede pausar o cancelar.</>,
        <>Para cerrar la prueba: abrí la suscripción en Suscripciones y tocá <B T={T}>Cancelar</B>. En MP podés reembolsar el pago si querés.</>,
      ]}/>
      <Callout T={T} tone="info" title="Modo prueba sin plata">Con un token <Code T={T}>TEST-</Code> de MP y un usuario de prueba de MP podés simular todo sin dinero real. Es más engorroso de armar; si tu producto es barato, la prueba real es más rápida y más fiel.</Callout>
      <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
        <Btn T={T} variant="secondary" size="sm" onClick={() => goTab?.("suscripciones")}>Ver Suscripciones</Btn>
        <Btn T={T} variant="secondary" size="sm" onClick={() => goTab?.("cobros")}>Ver Cobros</Btn>
      </div>
    </Sec>
  );
}

function SecTienda({ T, onb, goTab }) {
  return (
    <Sec T={T} title="Tienda y envíos" sub="Los datos de tu tienda salen solos de Shopify y de Mercado Pago. Lo único que conviene revisar son los envíos que el cliente elige al suscribirse."
      right={<><StepStatus T={T} onb={onb} id="settings"/><Btn T={T} variant="primary" size="sm" onClick={() => goConfigSection(goTab, "checkout")}>Ir a Checkout →</Btn></>}>
      <Steps T={T} items={[
        <>Entrá a <B T={T}>Configuración → Tienda</B>.<Crumb T={T} path="Recurrentes › Configuración › Tienda"/></>,
        <>En <B T={T}>Datos de tu tienda</B> vas a ver nombre, dominio público, moneda y mail (de Shopify) y la cuenta de Mercado Pago que cobra. No se cargan a mano: si cambiaste algo en Shopify, tocá <B T={T}>Actualizar desde Shopify</B>. "Editar dominio" es solo para el caso raro de que tu cliente vea otro dominio.</>,
        <>En <B T={T}>Envíos del checkout</B> tocá <B T={T}>Importar de Shopify</B>: te mostramos tus tarifas fijas, elegís cuáles (hasta 6) y tocás <B T={T}>Usar estas</B>. También podés cargarlas a mano (nombre + precio). Son las que el cliente elige al suscribirse y se repiten en cada orden recurrente.
          <Screen T={T} title="Recurrentes › Configuración › Tienda" rows={[{ label:"Dominio público", value:"www.mitienda.com · de Shopify", mono:true, hl:true }, { label:"Cuenta de MP", value:"ventas@mitienda.com" }, { label:"Envío 1", value:"Andreani a domicilio · $4.500" }, { label:"Envío 2", value:"Retiro en local · $0" }]}/>
        </>,
      ]}/>
      <Callout T={T} tone="info">Si hay envíos del checkout, el cliente elige entre esos en todos los planes. Si no cargaste ninguno, cada plan usa su <B T={T}>envío por defecto</B> (se edita en Planes → Editar → Envío). Si tu Shopify usa tarifas dinámicas de un correo, no hay nada para importar: cargalas a mano.</Callout>
    </Sec>
  );
}

function SecFaq({ T }) {
  const QA = [
    ["¿Recurrentes puede ver mi Access Token de MP?", "Sí: se guarda en nuestra base con acceso restringido y solo lo usan los procesos del servidor para llamar a MP en tu nombre. Es como darle la llave del banco al contador. Podés desconectar cuando quieras desde Configuración → Integraciones (borra el token) y, si querés, regenerarlo en MP."],
    ["Si cancelo mi cuenta, ¿qué pasa con las suscripciones activas?", "Siguen funcionando en MP (los cobros los procesa MP, no nosotros), pero ya no se generan órdenes en Shopify. Te recomendamos pausar o cancelar las suscripciones antes de irte."],
    ["¿Y si Mercado Pago se cae?", "Tus datos (suscriptores, planes, historial) viven en Recurrentes y no se pierden. MP reintenta los cobros automáticamente durante 96 horas. Solo se demoraría el alta de una suscripción nueva durante la caída."],
    ["¿Puedo usar la misma app de MP para otras cosas?", "Sí. La aplicación de Developers no interfiere con tu cuenta normal ni con tu posnet o tu tienda física."],
    ["¿Otros usuarios de Recurrentes ven mis datos?", "No. Cada tienda está aislada en su propio espacio (multi-tenant). Tu token, tus planes y tus clientes solo se usan para tus suscripciones."],
    ["¿Qué medios de pago acepta el cliente?", "Tarjeta de crédito y débito y, cuando MP lo permite, dinero en cuenta. El cliente puede pagar con una cuenta de MP distinta al mail que cargó en el checkout."],
    ["¿Cómo cambia un cliente su dirección o pausa la suscripción?", "Desde el portal del cliente (link en cada mail). Vos también podés editar la dirección, pausar, reanudar o cancelar desde Suscripciones → tocar la fila."],
    ["Un cobro salió OK pero la orden de Shopify falló, ¿qué hago?", "En Cobros la fila queda en rojo con el motivo. Corregilo (casi siempre es Shopify desconectado o una variante borrada) y tocá Reintentar orden: se crea con el mismo pago, sin cobrar de nuevo."],
    ["¿Puedo tener más de una tienda?", "Sí: Configuración → Tiendas. Cada tienda tiene su Shopify, su MP, sus planes y su widget. Cambiás de tienda desde el selector del menú."],
  ];
  return (
    <Sec T={T} title="Preguntas frecuentes">
      <div style={{ display:"flex", flexDirection:"column" }}>
        {QA.map(([q, a], i) => (
          <details key={i} style={{ borderTop: i === 0 ? "none" : `1px solid ${T.borderL}`, padding:"10px 0" }}>
            <summary style={{ cursor:"pointer", fontSize:DS.font.base, fontWeight:DS.w.semibold, color:T.text, listStyle:"none", display:"flex", gap:8, alignItems:"center" }}><span style={{ color:T.accent }}>?</span>{q}</summary>
            <div style={{ fontSize:DS.font.base, color:T.textMd, lineHeight:1.65, marginTop:6, paddingLeft:18 }}>{a}</div>
          </details>
        ))}
      </div>
      <div style={{ marginTop:14, padding:"12px 14px", background:T.accentSolid + "10", border:`1px solid ${T.accentSolid}33`, borderRadius:DS.r.lg, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:200, fontSize:DS.font.base, color:T.textMd, lineHeight:1.5 }}><B T={T}>¿No está tu pregunta?</B> Escribinos y te ayudamos a configurar todo.</div>
        <a href={WHATSAPP_SOPORTE} target="_blank" rel="noopener noreferrer" style={{ display:"inline-flex", alignItems:"center", gap:6, background:T.accentSolid, color:"#fff", borderRadius:DS.r.md, padding:"8px 14px", fontSize:DS.font.base, fontWeight:DS.w.bold, textDecoration:"none", fontFamily:F }}>💬 WhatsApp de soporte</a>
      </div>
    </Sec>
  );
}
