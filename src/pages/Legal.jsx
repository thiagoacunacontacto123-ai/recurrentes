import React from "react";

// ─────────────────────────────────────────────────────────────────
// Páginas legales públicas (#/terminos · #/privacidad).
// Adaptadas de public/terminos.html y public/privacidad.html de Growith
// al producto Recurrentes. BORRADOR: falta revisión legal y completar
// los placeholders [CUIT] y [email de contacto].
// Si el shell no pasa T, se usan las CSS vars de index.css.
// ─────────────────────────────────────────────────────────────────

const ULTIMA_ACTUALIZACION = "septiembre 2026";
const RESPONSABLE = "Thiago Acuña";
const CUIT = "[CUIT]";
const EMAIL_CONTACTO = "[email de contacto]";

const FALLBACK_T = {
  bg: "var(--bg)", surface: "var(--surface)", card: "var(--card)", border: "var(--border)", borderL: "var(--border-light)",
  text: "var(--text)", textMd: "var(--text-md)", textSm: "var(--text-sm)", accent: "var(--accent)", accentSolid: "#10b981",
  yellow: "var(--yellow)", yellowBg: "rgba(245,158,11,0.12)",
};

function useStyles(Tp) {
  const T = Tp || FALLBACK_T;
  return {
    T,
    page: { minHeight: "100vh", background: T.bg, color: T.text, padding: "40px 20px 80px", fontFamily: "'Inter', system-ui, -apple-system, sans-serif" },
    wrap: { maxWidth: 760, margin: "0 auto" },
    back: { fontSize: 12, color: T.accent, textDecoration: "none" },
    h1: { fontSize: 28, fontWeight: 800, margin: "18px 0 4px", letterSpacing: -0.6, lineHeight: 1.15, color: T.text },
    sub: { fontSize: 13, color: T.textSm, marginBottom: 12 },
    draft: { display: "inline-block", fontSize: 12, fontWeight: 700, color: T.yellow, background: T.yellowBg, border: `1px solid ${T.yellow}55`, borderRadius: 8, padding: "6px 10px", margin: "8px 0 28px" },
    h2: { fontSize: 17, fontWeight: 700, margin: "32px 0 8px", letterSpacing: -0.3, color: T.text },
    p: { fontSize: 14, lineHeight: 1.7, color: T.textMd, margin: "0 0 10px" },
    ul: { fontSize: 14, lineHeight: 1.7, color: T.textMd, margin: "0 0 10px", paddingLeft: 22 },
    strong: { color: T.text, fontWeight: 600 },
    a: { color: T.accent },
    box: { background: T.card, border: `1px solid ${T.border}`, borderRadius: 12, padding: "14px 18px", margin: "14px 0", fontSize: 13.5, lineHeight: 1.7, color: T.textMd },
    foot: { marginTop: 40, paddingTop: 16, borderTop: `1px solid ${T.border}`, fontSize: 12, color: T.textSm, display: "flex", gap: 14, flexWrap: "wrap" },
  };
}

function Frame({ T, title, children }) {
  const s = useStyles(T);
  return (
    <div style={s.page}>
      <div style={s.wrap}>
        <a href="#/" style={s.back}>← Volver a Recurrentes</a>
        <h1 style={s.h1}>{title}</h1>
        <div style={s.sub}>Recurrentes — última actualización: {ULTIMA_ACTUALIZACION}</div>
        <div style={s.draft}>Borrador — versión beta, sujeto a revisión legal</div>
        {children}
        <div style={s.foot}>
          <a href="#/terminos" style={s.a}>Términos y condiciones</a>
          <a href="#/privacidad" style={s.a}>Política de privacidad</a>
          <span>Contacto: {EMAIL_CONTACTO}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Términos y condiciones ─────────────────────────────────────
export function TerminosPage({ T }) {
  const s = useStyles(T);
  const S = ({ children }) => <strong style={s.strong}>{children}</strong>;
  return (
    <Frame T={T} title="Términos y condiciones">
      <p style={s.p}>
        <S>Recurrentes</S> ("el servicio", "la aplicación") es una herramienta de gestión de suscripciones para tiendas Shopify: permite convertir productos en planes recurrentes, cobrarlos a través de Mercado Pago, generar las órdenes correspondientes en la tienda y administrar suscriptores, cobros y avisos por mail. Al crear una cuenta aceptás estos términos.
      </p>

      <h2 style={s.h2}>1. Quién presta el servicio</h2>
      <p style={s.p}>
        El servicio es operado por <S>{RESPONSABLE}</S>, persona humana, CUIT {CUIT}, con domicilio en la República Argentina ("el responsable", "nosotros"). Contacto: {EMAIL_CONTACTO}.
      </p>

      <h2 style={s.h2}>2. Etapa beta y gratuidad</h2>
      <p style={s.p}>
        Recurrentes se encuentra en <S>versión beta</S>. Durante esta etapa el servicio se ofrece <S>sin costo</S>. Podemos modificar funciones, imponer límites de uso, introducir planes pagos o discontinuar el servicio avisando con anticipación razonable por el email de tu cuenta. Si en el futuro se cobrara una suscripción, será sin permanencia mínima y con los precios publicados en la aplicación antes de que confirmes el pago.
      </p>

      <h2 style={s.h2}>3. Cuenta y credenciales</h2>
      <p style={s.p}>
        Para usar el servicio tenés que ser mayor de 18 años y titular (o estar autorizado por el titular) de la tienda Shopify y de la cuenta de Mercado Pago que conectás. Sos responsable de la seguridad de tu cuenta y de las credenciales que cargás (Client ID y Client Secret de tu app de Shopify, Access Token de Mercado Pago). Podés desconectar cada integración cuando quieras desde <S>Integraciones</S>; al hacerlo eliminamos el token correspondiente de nuestra base.
      </p>
      <p style={s.p}>
        Si invitás miembros de tu equipo, sos responsable de lo que hagan dentro de tu tienda con los permisos que les diste.
      </p>

      <h2 style={s.h2}>4. Cómo funcionan los cobros</h2>
      <ul style={s.ul}>
        <li>Las suscripciones se crean y se cobran <S>en tu propia cuenta de Mercado Pago</S>. Recurrentes no recibe, retiene ni intermedia dinero: el cobro es una relación entre vos, tu cliente y Mercado Pago.</li>
        <li>Por cada cobro aprobado, Recurrentes crea una orden en tu Shopify para que la prepares y envíes como cualquier venta.</li>
        <li>Los reintentos de cobro, las devoluciones y los contracargos se rigen por las reglas de Mercado Pago. Recurrentes te muestra el estado pero no decide sobre ellos.</li>
        <li>Sos responsable de que tus planes, precios, descuentos, condiciones de envío y cancelación cumplan la normativa de defensa del consumidor que te aplique, y de informarlas a tus clientes.</li>
      </ul>

      <h2 style={s.h2}>5. Tus clientes y sus datos</h2>
      <p style={s.p}>
        Los datos de las personas que se suscriben a tus planes (nombre, email, teléfono, DNI/CUIL, dirección de envío, historial de cobros) son <S>tuyos</S>: los tratamos únicamente por tu cuenta y orden, para operar las suscripciones, según se detalla en la <a href="#/privacidad" style={s.a}>Política de privacidad</a>. Vos sos el responsable ante tus clientes de informarles cómo usás sus datos y de atender sus pedidos de acceso, rectificación o baja; nosotros te damos las herramientas para hacerlo.
      </p>

      <h2 style={s.h2}>6. Uso aceptable</h2>
      <p style={s.p}>
        No está permitido usar Recurrentes para actividades ilegales, para vender productos o servicios prohibidos por Shopify o Mercado Pago, para enviar mails no solicitados, para intentar acceder a datos de otras cuentas, ni para revender el servicio sin autorización escrita. Podemos suspender cuentas que incumplan estos términos, avisando salvo urgencia.
      </p>

      <h2 style={s.h2}>7. Disponibilidad, garantías y límite de responsabilidad</h2>
      <p style={s.p}>
        El servicio se ofrece <S>"tal cual" y "según disponibilidad"</S>, sin garantías de ningún tipo, expresas ni implícitas, incluyendo funcionamiento ininterrumpido, ausencia de errores o adecuación a un fin particular. Recurrentes depende de APIs de terceros (Shopify, Mercado Pago, proveedores de infraestructura y de envío de mails) cuya disponibilidad no controlamos.
      </p>
      <p style={s.p}>
        En la máxima medida permitida por la ley, el responsable no será responsable por lucro cesante, pérdida de ventas, de datos o de clientes, ni por daños indirectos o consecuentes derivados del uso o la imposibilidad de uso del servicio. Si a pesar de lo anterior existiera responsabilidad, quedará limitada al monto total que hayas pagado por el servicio en los 12 meses anteriores al hecho (durante la beta gratuita, ese monto es cero). Nada de lo anterior limita responsabilidades que la ley argentina no permita limitar.
      </p>

      <h2 style={s.h2}>8. Baja de la cuenta</h2>
      <p style={s.p}>
        Podés eliminar tu cuenta cuando quieras desde <S>Configuración → Cuenta</S>. Tus datos quedan inaccesibles de inmediato y se borran definitivamente a los <S>30 días</S>, salvo lo que debamos conservar por obligación legal. Las suscripciones que ya existan en tu Mercado Pago <S>siguen cobrándose</S> hasta que las pauses o canceles desde MP o desde Recurrentes antes de darte de baja.
      </p>

      <h2 style={s.h2}>9. Cambios a estos términos</h2>
      <p style={s.p}>
        Podemos actualizar estos términos. Si el cambio es relevante te avisamos por email o dentro de la aplicación con al menos 15 días de anticipación. Seguir usando el servicio después de esa fecha implica aceptar la nueva versión.
      </p>

      <h2 style={s.h2}>10. Ley aplicable y jurisdicción</h2>
      <p style={s.p}>
        Estos términos se rigen por las leyes de la República Argentina. Para cualquier controversia las partes se someten a los tribunales ordinarios de la <S>Ciudad Autónoma de Buenos Aires</S>, sin perjuicio de los derechos irrenunciables que te correspondan como consumidor, si aplicaran.
      </p>

      <h2 style={s.h2}>11. Contacto</h2>
      <p style={s.p}>{EMAIL_CONTACTO}</p>
    </Frame>
  );
}

// ─── Política de privacidad ─────────────────────────────────────
export function PrivacidadPage({ T }) {
  const s = useStyles(T);
  const S = ({ children }) => <strong style={s.strong}>{children}</strong>;
  return (
    <Frame T={T} title="Política de privacidad">
      <p style={s.p}>
        Esta política describe qué datos personales trata <S>Recurrentes</S>, con qué fin, con quién los comparte y cuáles son tus derechos, conforme a la <S>Ley 25.326 de Protección de los Datos Personales</S> y sus normas complementarias.
      </p>

      <h2 style={s.h2}>1. Responsable del tratamiento</h2>
      <p style={s.p}>
        <S>{RESPONSABLE}</S>, persona humana, CUIT {CUIT}, República Argentina. Contacto para temas de privacidad: {EMAIL_CONTACTO}.
      </p>

      <h2 style={s.h2}>2. Dos tipos de datos, dos roles</h2>
      <div style={s.box}>
        <S>a) Datos del comerciante</S> (vos, que creás la cuenta): acá actuamos como <S>responsables</S> del tratamiento.<br />
        <S>b) Datos de tus clientes finales</S> (las personas que se suscriben a tus planes): acá actuamos como <S>encargados</S> del tratamiento, por tu cuenta y orden. El responsable frente a ellos sos vos.
      </div>

      <h2 style={s.h2}>3. Qué datos tratamos</h2>
      <p style={s.p}><S>Del comerciante:</S></p>
      <ul style={s.ul}>
        <li>Email y nombre, para autenticarte y contactarte por el servicio.</li>
        <li>Credenciales de las integraciones que conectás: Client ID y Client Secret de tu app de Shopify, el token de acceso a tu tienda y el Access Token de Mercado Pago. Se guardan <S>cifrados o con acceso restringido</S> a los procesos del servidor; nunca se muestran a otros usuarios ni a tus clientes.</li>
        <li>Configuración de tu tienda (dominio, remitente de mails, planes, códigos de descuento) y registros técnicos de uso (fecha y hora, dirección IP, errores) para seguridad y soporte.</li>
        <li>Datos de los miembros de equipo que invitás (nombre y email).</li>
      </ul>
      <p style={s.p}><S>De tus clientes finales</S> (tratados por cuenta y orden tuya):</p>
      <ul style={s.ul}>
        <li>Nombre, email, teléfono y DNI/CUIL, necesarios para crear la suscripción en Mercado Pago y la orden en Shopify.</li>
        <li>Dirección de envío, para que puedas despachar cada entrega.</li>
        <li>Historial de suscripciones y cobros (plan, fechas, montos, estado de cada pago) y los avisos por mail que se les envían.</li>
        <li><S>No</S> almacenamos números de tarjeta ni credenciales de pago: eso lo maneja Mercado Pago en sus propios sistemas.</li>
      </ul>

      <h2 style={s.h2}>4. Para qué los usamos</h2>
      <ul style={s.ul}>
        <li>Operar las suscripciones: crearlas, cobrarlas a través de tu Mercado Pago, generar las órdenes en tu Shopify y mostrarte su estado.</li>
        <li>Enviar mails transaccionales a tus clientes en tu nombre (bienvenida, aviso de cobro, problemas de pago, recupero de carritos abandonados si lo activás) y a vos (alertas del servicio).</li>
        <li>Seguridad, prevención de fraude, soporte y mejora del servicio.</li>
      </ul>
      <p style={s.p}>
        <S>No vendemos datos</S> ni los usamos para publicidad de terceros. Los datos de una cuenta solo son visibles para esa cuenta y para los miembros que su dueño invite.
      </p>

      <h2 style={s.h2}>5. Con quién los compartimos</h2>
      <p style={s.p}>Solo con los proveedores necesarios para que el servicio funcione, que actúan bajo sus propias políticas de privacidad y pueden almacenar datos fuera de Argentina, en países con nivel de protección adecuado o bajo cláusulas contractuales apropiadas:</p>
      <ul style={s.ul}>
        <li><S>Google Firebase</S> (Google LLC): autenticación y base de datos.</li>
        <li><S>Vercel</S> (Vercel Inc.): alojamiento de la aplicación y ejecución del servidor.</li>
        <li><S>Mercado Pago</S> (Mercado Libre S.R.L. y afiliadas): creación y cobro de las suscripciones.</li>
        <li><S>Shopify</S> (Shopify Inc.): lectura de productos y creación de órdenes en tu tienda.</li>
        <li><S>Resend</S> (Resend Inc.): envío de mails transaccionales.</li>
      </ul>
      <p style={s.p}>También podemos revelar datos si una autoridad competente lo exige por ley.</p>

      <h2 style={s.h2}>6. Seguridad</h2>
      <p style={s.p}>
        Toda la comunicación viaja cifrada (HTTPS). Los tokens de acceso se guardan con acceso restringido y se usan únicamente desde el servidor. Cada tienda está aislada en su propio espacio de la base de datos. Ningún sistema es infalible: si detectamos un incidente que afecte tus datos, te avisamos a la brevedad.
      </p>

      <h2 style={s.h2}>7. Cuánto tiempo los conservamos</h2>
      <ul style={s.ul}>
        <li>Mientras tu cuenta esté activa.</li>
        <li>Al desconectar una integración, el token correspondiente se elimina de inmediato.</li>
        <li>Al eliminar tu cuenta o una tienda, los datos quedan inaccesibles de inmediato y se <S>borran definitivamente a los 30 días</S>, salvo lo que debamos conservar por obligación legal o para resolver disputas ya iniciadas.</li>
      </ul>

      <h2 style={s.h2}>8. Tus derechos (acceso, rectificación, actualización y supresión)</h2>
      <p style={s.p}>
        Como titular de datos podés ejercer en forma gratuita, a intervalos no inferiores a seis meses salvo interés legítimo, los derechos de <S>acceso, rectificación, actualización y supresión</S> previstos en la Ley 25.326, escribiendo a {EMAIL_CONTACTO} desde el email de tu cuenta. Gran parte de esto lo podés hacer vos mismo desde la aplicación (editar datos, desconectar integraciones, eliminar la cuenta).
      </p>
      <p style={s.p}>
        Si sos <S>cliente final</S> de una tienda que usa Recurrentes, dirigí tu pedido a esa tienda (es la responsable de tus datos); si nos escribís directamente, te ayudamos a canalizarlo y colaboramos con la tienda para cumplirlo.
      </p>
      <div style={s.box}>
        La <S>Agencia de Acceso a la Información Pública</S>, órgano de control de la Ley 25.326, tiene la atribución de atender las denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre protección de datos personales.
      </div>

      <h2 style={s.h2}>9. Mails y baja</h2>
      <p style={s.p}>
        Los mails que enviamos son transaccionales (relacionados con una suscripción o con tu cuenta). Los de recupero de carritos abandonados incluyen un link para <S>no recibir más</S> esa serie; al usarlo, la persona queda excluida de futuros envíos de ese tipo para esa tienda. Vos, como comerciante, podés desactivar el recupero automático desde Configuración.
      </p>

      <h2 style={s.h2}>10. Cookies y almacenamiento local</h2>
      <p style={s.p}>
        Usamos únicamente el almacenamiento necesario para mantener tu sesión iniciada y recordar preferencias de la interfaz (tema, tienda activa, pasos del onboarding). No usamos cookies de publicidad ni de seguimiento de terceros.
      </p>

      <h2 style={s.h2}>11. Cambios a esta política</h2>
      <p style={s.p}>
        Si modificamos esta política de forma relevante te avisamos por email o dentro de la aplicación. La fecha de última actualización figura arriba.
      </p>

      <h2 style={s.h2}>12. Contacto</h2>
      <p style={s.p}>{EMAIL_CONTACTO}</p>
    </Frame>
  );
}

// ─── Selector ───────────────────────────────────────────────────
// kind: "terminos" | "privacidad". Acepta `title` por compatibilidad con
// el placeholder anterior de App.jsx (<LegalPage title="Política de privacidad"/>).
export default function LegalPage({ kind, title, T }) {
  const k = kind || (/privacidad/i.test(title || "") ? "privacidad" : "terminos");
  return k === "privacidad" ? <PrivacidadPage T={T} /> : <TerminosPage T={T} />;
}
export { LegalPage };
