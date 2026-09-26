// Páginas de SEO — el contenido, separado del armado (seo/armar.mjs).
//
// Por qué existen (26-sept-2026, Thiago: "quiero trabajar el SEO primero"):
// el panel es una SPA con rutas por numeral (#/demo). Google NO indexa lo que
// va después del #, así que para él todo recurrentesapp.com es UNA sola página,
// y encima el HTML le llega vacío porque el texto lo pinta React. Escribir
// contenido adentro de la SPA es tirar el trabajo: no hay dónde ponerlo.
//
// Estas páginas son HTML de verdad, con el texto adentro, cada una con su URL.
// Se sirven desde public/ (Vercel las encuentra antes que el catch-all de la
// SPA) y con cleanUrls quedan sin el .html.
//
// Para editar un texto: tocá acá y corré `npm run seo`. No se edita el HTML
// generado, que se pisa en cada corrida.

export const SITIO = "https://www.recurrentesapp.com";

// Cada página: slug (la URL), title y description (lo que se ve en Google),
// h1, intro, bloques de contenido y las preguntas del final.
export const PAGINAS = [
  {
    slug: "suscripciones-shopify",
    title: "Suscripciones en Shopify con Mercado Pago | Recurrentes",
    description: "Vendé por suscripción en tu Shopify cobrando con Mercado Pago. El cliente se suscribe una vez, se le cobra solo y la orden se crea sola en tu tienda. Gratis hasta 10 suscriptores.",
    h1: "Suscripciones en Shopify, cobrando con Mercado Pago",
    intro: "Shopify no tiene suscripciones con Mercado Pago. Las apps de suscripción del App Store cobran con Shopify Payments o Stripe, que en Argentina no le sirven a casi nadie. Recurrentes resuelve justo eso: tu cliente se suscribe en la ficha de producto y Mercado Pago le cobra cada período, con la plata cayendo en tu cuenta.",
    bloques: [
      { h: "Cómo funciona", p: "Pegás un snippet en tu tema y aparece el selector de packs en la página de producto: compra única o suscripción, con los descuentos y las frecuencias que definas. Cuando alguien se suscribe, Mercado Pago le cobra automáticamente en la fecha que corresponde y Recurrentes crea la orden paga en tu Shopify, con la dirección y el envío, lista para despachar." },
      { h: "Por qué Mercado Pago y no una tarjeta internacional", p: "En Argentina la mayoría de tus compradores paga con tarjeta local o con dinero en la cuenta de Mercado Pago. Una app que solo acepte Shopify Payments te deja afuera a la mayor parte del mercado. Recurrentes usa la cuenta de Mercado Pago que ya tenés, así que no cambiás de pasarela ni esperás acreditaciones nuevas." },
      { h: "Qué se puede configurar", p: "Packs de 1, 2 o 3 unidades con precio propio y precio tachado; el descuento por suscribirse; cada cuánto se repite el envío; regalos por pack; más de diez diseños del selector con los colores de tu marca; y los mails y mensajes de WhatsApp automáticos que le llegan a tu cliente con tu nombre, no con el nuestro." },
      { h: "Qué pasa con las órdenes y el stock", p: "Cada cobro aprobado genera una orden en tu Shopify igual que una compra normal: descuenta stock, dispara los mails de tu tienda y aparece en tus reportes. No hay planillas ni pedidos cargados a mano." },
    ],
    faq: [
      ["¿Necesito una app del App Store de Shopify?", "No. La conexión se hace con una app privada que creás vos en el panel de desarrolladores de Shopify, en dos pasos guiados. Si preferís, lo dejamos andando nosotros en una llamada."],
      ["¿Cuánto cuesta?", "Es gratis hasta 10 suscriptores activos. Después pagás según cuántos clientes tengas cobrando, desde USD 99 por mes, y nunca cobramos comisión por venta. La puesta en marcha tiene un costo único de USD 100."],
      ["¿Mis clientes pueden cancelar solos?", "Sí. Cada suscriptor tiene un portal propio donde pausa, cambia la dirección o cancela sin escribirte."],
    ],
  },
  {
    slug: "suscripciones-tiendanube",
    title: "Suscripciones en Tiendanube con Mercado Pago | Recurrentes",
    description: "Cobrá suscripciones en tu Tiendanube con Mercado Pago, con packs, variantes y descuentos. El cobro es automático y la orden se crea sola.",
    h1: "Suscripciones en Tiendanube, con Mercado Pago",
    intro: "Tiendanube tiene suscripciones nativas, pero con límites que dejan afuera a muchas tiendas: solo funcionan con Pago Nube y tarjeta de crédito, piden plan Impulso o superior, no admiten variantes y solo permiten un producto con suscripción por carrito. Recurrentes cubre exactamente lo que queda afuera.",
    bloques: [
      { h: "Qué podés hacer que la suscripción nativa no permite", p: "Cobrar con la cuenta de Mercado Pago que ya usás, vender variantes (sabores, talles, colores), armar packs de varias unidades con precio propio, y tener más de un producto por suscripción en el mismo carrito." },
      { h: "Cómo se instala", p: "Instalás la app desde tu panel de Tiendanube y el selector aparece en la ficha de producto. Cada cobro de Mercado Pago genera la orden paga en tu tienda, con la dirección del cliente y el envío que corresponda." },
      { h: "Qué ve tu cliente", p: "En la misma página del producto elige entre comprar una vez o suscribirse, con el descuento y la frecuencia a la vista. Después recibe los avisos de cada cobro por mail y WhatsApp, con tu marca, y tiene un portal para pausar o cancelar cuando quiera." },
    ],
    faq: [
      ["¿Sirve si estoy en el plan más básico de Tiendanube?", "Sí. Recurrentes no depende del plan de Tiendanube ni de Pago Nube."],
      ["¿Puedo usar débito?", "Depende de lo que habilite Mercado Pago para suscripciones en tu cuenta. La suscripción nativa de Tiendanube solo acepta crédito."],
      ["¿Cuánto cuesta?", "Gratis hasta 10 suscriptores activos, después desde USD 99 por mes y sin comisión por venta. La puesta en marcha sale USD 100, una vez."],
    ],
  },
  {
    slug: "suscripciones-ecommerce",
    title: "Cómo vender por suscripción en tu ecommerce (Argentina) | Recurrentes",
    description: "Guía para pasar tu ecommerce a un modelo de suscripción en Argentina: qué productos sirven, cómo elegir la frecuencia y el descuento, y cómo se cobra en automático.",
    h1: "Cómo vender por suscripción en tu ecommerce",
    intro: "Si tus clientes te vuelven a comprar el mismo producto cada mes o cada dos, estás pagando publicidad dos veces por la misma venta. Una suscripción convierte esa recompra en algo que pasa solo. Esto es lo que hay que resolver para hacerlo en Argentina.",
    bloques: [
      { h: "Qué productos sirven", p: "Los que se consumen y se terminan en un plazo previsible: suplementos, café, cosmética, productos de limpieza, alimento para mascotas, higiene personal. La pregunta que ordena todo es cada cuánto se le acaba a tu cliente: esa es la frecuencia de la suscripción." },
      { h: "Qué descuento poner", p: "Entre 10% y 20% suele alcanzar. El cliente no se suscribe solo por el precio: se suscribe por no quedarse sin el producto. Un descuento más alto te come el margen sin mover la conversión, y encima te ata a venderle barato para siempre." },
      { h: "Cómo se cobra sin que hagas nada", p: "Con la suscripción de Mercado Pago. El cliente autoriza una vez el cobro recurrente y, en cada período, Mercado Pago le debita y avisa. Recurrentes escucha ese aviso y crea la orden en tu tienda, con dirección y envío, lista para despachar." },
      { h: "Qué mirar después", p: "Los tres números de una suscripción son cuántos se suman por mes, cuántos se van (churn) y cuánto factura cada uno antes de irse. Si se van más de los que entran, el problema casi nunca es el precio: es la frecuencia mal elegida o un producto que no se consume tan rápido como creías." },
    ],
    faq: [
      ["¿Necesito cambiar de plataforma?", "No. Funciona sobre tu Shopify o tu Tiendanube actual."],
      ["¿Y si mi producto no se consume?", "La suscripción no va a funcionar. Antes de armarla, mirá qué porcentaje de tus clientes ya te vuelve a comprar solo: si es menos del 10%, primero hay que trabajar la recompra."],
    ],
  },
  {
    slug: "alternativa-a-puentify",
    title: "Alternativa a Puentify: suscripciones para ecommerce argentino | Recurrentes",
    description: "Buscás una alternativa a Puentify para cobrar suscripciones en tu tienda. Qué mirar antes de elegir y qué hace Recurrentes: Shopify y Tiendanube, Mercado Pago, packs y 0% de comisión.",
    h1: "¿Buscás una alternativa a Puentify?",
    intro: "Puentify y Recurrentes resuelven el mismo problema de fondo: cobrar suscripciones en un ecommerce argentino. No vamos a hablar por ellos, así que acá va lo que conviene comparar antes de decidir y, abajo, qué hace Recurrentes en concreto para que lo midas contra cualquier opción.",
    bloques: [
      { h: "Qué comparar antes de elegir", p: "Cuatro cosas cambian el resultado más que cualquier otra: si cobra comisión por venta además del abono; si funciona en la plataforma que ya usás; si soporta packs y variantes o solo un producto suelto; y si la orden se crea sola en tu tienda o alguien la tiene que cargar a mano. Pedí ver las cuatro funcionando antes de firmar." },
      { h: "Qué hace Recurrentes", p: "Funciona sobre Shopify y Tiendanube, cobra con la cuenta de Mercado Pago que ya tenés y no cobra comisión por venta: el abono es lo único que pagás, y es gratis hasta 10 suscriptores activos. Cada cobro aprobado genera la orden paga en tu tienda con dirección, envío y stock descontado." },
      { h: "Packs y variantes", p: "El selector de la ficha de producto admite packs de varias unidades con precio y precio tachado propios, variantes, regalos por pack, y una frecuencia distinta por pack. El cliente elige en la misma página, sin pasos intermedios." },
      { h: "Quién lo pone a andar", p: "La instalación la hacemos nosotros: dejamos la conexión, el selector y los planes funcionando en tu tienda, con una puesta en marcha de USD 100 que se paga recién cuando está terminada y andando." },
    ],
    faq: [
      ["¿Cobran comisión por venta?", "No. Solo el abono mensual, que arranca en cero hasta 10 suscriptores activos."],
      ["¿Puedo migrar suscriptores que ya tengo en otra herramienta?", "Las autorizaciones de cobro de Mercado Pago no se transfieren entre aplicaciones: cada suscriptor tiene que volver a autorizar. Lo que sí se puede es acompañar esa migración con un flujo de mails para que no se te caiga nadie en el camino."],
    ],
  },

  // ── Mercado Pago: el término núcleo ──────────────────────────────────────
  {
    slug: "suscripciones-mercado-pago",
    title: "Suscripciones con Mercado Pago para tu tienda | Recurrentes",
    description: "Cómo cobrar suscripciones con Mercado Pago en tu ecommerce: qué se puede, qué tarjetas acepta, qué pasa si un cobro falla y cómo se conecta con Shopify o Tiendanube.",
    h1: "Suscripciones con Mercado Pago",
    intro: "Mercado Pago tiene cobro recurrente desde hace años, pero no viene enchufado a tu tienda: la API existe y nadie la usa por vos. Esto es lo que se puede hacer hoy y qué hace falta para que cada cobro termine en una orden despachada.",
    bloques: [
      { h: "Qué es una suscripción en Mercado Pago", p: "Es una autorización: tu cliente aprueba una vez que le cobres cada cierta cantidad de días, y desde ahí Mercado Pago debita solo, sin pedirle nada. No es un link de pago que se manda todos los meses ni una transferencia que hay que perseguir. La plata cae en tu cuenta de Mercado Pago, igual que cualquier venta." },
      { h: "Qué medios de pago acepta", p: "Tarjeta de crédito y, según lo que tenga habilitado tu cuenta, dinero disponible en la cuenta de Mercado Pago. El débito no siempre está disponible para cobro recurrente: es una decisión de Mercado Pago sobre cada cuenta, no de la tienda ni de la herramienta que uses." },
      { h: "Qué pasa cuando un cobro falla", p: "Mercado Pago reintenta por su cuenta durante unos días antes de dar la suscripción por caída. Lo importante es enterarte: el suscriptor queda marcado y le podés escribir para que cambie la tarjeta antes de perderlo. Sin eso, un rechazo se transforma en una baja silenciosa." },
      { h: "Lo que falta, y es donde entra Recurrentes", p: "Mercado Pago cobra, pero no sabe nada de tu tienda: no crea la orden, no descuenta stock, no arma el envío ni le avisa a tu cliente. Recurrentes escucha cada cobro aprobado y genera la orden paga en tu Shopify o Tiendanube con la dirección y el envío que corresponda." },
    ],
    faq: [
      ["¿Necesito una cuenta especial de Mercado Pago?", "No. Se usa la cuenta que ya tenés. Se conecta desde el panel en un clic."],
      ["¿La plata pasa por Recurrentes?", "Nunca. El cobro es de tu cuenta de Mercado Pago a tu cuenta. No cobramos comisión por venta."],
      ["¿Mi cliente puede cancelar?", "Sí, desde su portal o desde su propia cuenta de Mercado Pago. Las dos formas quedan reflejadas en tu panel."],
    ],
  },
  {
    slug: "cobro-recurrente-mercado-pago",
    title: "Cobro recurrente en Mercado Pago: cómo funciona | Recurrentes",
    description: "Cada cuánto cobra, qué ve tu cliente, qué pasa con los rechazos y cómo se pausa o cancela un cobro recurrente de Mercado Pago.",
    h1: "Cómo funciona el cobro recurrente de Mercado Pago",
    intro: "Si ya decidiste vender por suscripción, lo que sigue son las preguntas del día a día: cuándo cae la plata, qué ve el cliente en su resumen y qué hacer cuando un cobro rebota. Esto es el mecanismo, sin vueltas.",
    bloques: [
      { h: "Cuándo se cobra", p: "El primer cobro sale en el momento en que el cliente autoriza. Los siguientes, cada N días contados desde ese día: si se suscribió un 12 con frecuencia de 30 días, el próximo cae el 11 o 12 del mes siguiente. No hay fecha fija de corte para todos: cada suscriptor tiene su propio calendario." },
      { h: "Qué ve tu cliente", p: "En su resumen de tarjeta aparece el nombre de tu cuenta de Mercado Pago, no el nuestro. Y en su cuenta de Mercado Pago ve la suscripción listada, con la opción de cancelarla cuando quiera. Eso no se puede evitar, y es sano: la alternativa es que desconozca el cargo y termine en un contracargo." },
      { h: "Qué hacer con un rechazo", p: "Casi siempre es una tarjeta vencida o sin límite, no un cliente que se quiere ir. Lo que recupera ese cobro es escribirle en el momento, con el link para actualizar la tarjeta. Recurrentes marca la suscripción como rechazada y dispara el aviso por mail y WhatsApp automáticamente." },
      { h: "Pausar en lugar de cancelar", p: "Cuando alguien quiere cortar, ofrecerle pausar uno o dos ciclos salva una parte de las bajas: el que se va de viaje o le sobró producto no quiere irse, quiere saltear un envío. La pausa deja la autorización viva y se reactiva sola en la fecha que elija." },
    ],
    faq: [
      ["¿Puedo cambiar el precio de una suscripción activa?", "Cambiar el monto de una autorización ya aprobada es limitado y arriesgado: lo más prolijo es dar de baja la vieja y ofrecer la nueva. Por eso conviene pensar bien el precio antes de lanzar."],
      ["¿Cuánto tarda en acreditarse?", "Lo mismo que cualquier venta tuya en Mercado Pago: depende del plazo de acreditación que tengas configurado en tu cuenta."],
    ],
  },
  {
    slug: "debito-automatico-para-mi-tienda",
    title: "Débito automático para tu tienda online | Recurrentes",
    description: "Cómo cobrarle automáticamente todos los meses a tus clientes sin ser una empresa de servicios: qué es, en qué se diferencia del débito bancario y cómo se activa.",
    h1: "Débito automático para tu tienda online",
    intro: "Muchos comerciantes lo buscan así: «quiero que se le debite solo». No hace falta ser una prepaga ni un gimnasio grande para tenerlo, y no es el débito automático del banco. Es más simple y lo activás vos.",
    bloques: [
      { h: "No es el débito automático del banco", p: "El débito en cuenta bancaria (CBU) lo tramita el banco, pide papeles y está pensado para servicios. Lo que usás en un ecommerce es una autorización de cobro recurrente sobre la tarjeta, a través de Mercado Pago. Se activa desde tu cuenta, sin trámite, y el cliente la aprueba en dos toques." },
      { h: "Qué necesitás para tenerlo", p: "Una cuenta de Mercado Pago y un producto que tu cliente consuma con cierta regularidad. Nada más. El cliente elige suscribirse en la ficha de producto y desde ahí se le cobra cada período." },
      { h: "Qué gana tu cliente y qué ganás vos", p: "Él deja de acordarse de volver a comprar y suele pagar un poco menos. Vos dejás de pagar publicidad dos veces por el mismo cliente y sabés cuánto vas a facturar el mes que viene. El ingreso deja de depender de cuánta gente entre hoy a tu tienda." },
    ],
    faq: [
      ["¿Le puedo cobrar sin que se entere?", "No, y no querrías: el cliente autoriza explícitamente y ve la suscripción en su cuenta de Mercado Pago. Un cargo que no reconoce termina en contracargo, que es peor que perder la venta."],
      ["¿Sirve para un servicio y no un producto?", "Sí. Gimnasios, clases y membresías usan el mismo mecanismo; lo único que cambia es que no hay envío."],
    ],
  },

  // ── Plataforma + Mercado Pago: las más específicas y las que más cierran ──
  {
    slug: "shopify-suscripciones-mercado-pago",
    title: "Shopify con suscripciones y Mercado Pago | Recurrentes",
    description: "Por qué las apps de suscripción de Shopify no sirven en Argentina y cómo cobrar suscripciones con Mercado Pago en tu tienda Shopify.",
    h1: "Shopify + suscripciones + Mercado Pago",
    intro: "Si buscaste una app de suscripciones en el App Store de Shopify ya te topaste con el problema: todas cobran con Shopify Payments o Stripe. En Argentina eso deja afuera a la mayoría de tus compradores. Acá va por qué pasa y cuál es la salida.",
    bloques: [
      { h: "Por qué las apps del App Store no te sirven", p: "Shopify tiene una API de suscripciones, pero está atada a las pasarelas que soportan cobro recurrente dentro de su ecosistema. Mercado Pago no es una de ellas. Por eso podés instalar la app, configurarla entera, y descubrir recién al final que no podés cobrar." },
      { h: "Cómo se resuelve", p: "El selector de suscripción va en la ficha de producto y el cobro se hace por fuera, con la suscripción de Mercado Pago. Cuando el cobro se aprueba, la orden se crea en tu Shopify como una compra paga normal: descuenta stock, dispara tus mails y aparece en tus reportes." },
      { h: "Qué ve tu cliente", p: "En la misma página del producto elige comprar una vez o suscribirse, con el descuento y la frecuencia a la vista, y los packs si los tenés. El botón de tu tema sigue funcionando para la compra suelta: no se reemplaza tu checkout, se suma una opción." },
      { h: "Qué hace falta de tu lado", p: "Conectar la tienda con una app privada que creás vos en el panel de desarrolladores de Shopify, conectar tu Mercado Pago y armar el plan. Si preferís no tocar nada, lo dejamos andando nosotros en una llamada de 15 minutos." },
    ],
    faq: [
      ["¿Pierdo Shop Pay o las cuotas?", "No. La compra única sigue pasando por el checkout de Shopify con todos los medios que ya tenías. Lo que cambia es solo la opción de suscripción."],
      ["¿Funciona con variantes?", "Sí: sabores, talles y colores, y también packs de varias unidades con precio propio."],
    ],
  },
  {
    slug: "tiendanube-suscripciones-mercado-pago",
    title: "Tiendanube con suscripciones y Mercado Pago | Recurrentes",
    description: "Las suscripciones nativas de Tiendanube solo funcionan con Pago Nube, crédito y plan Impulso. Cómo cobrar con Mercado Pago, con variantes y packs.",
    h1: "Tiendanube + suscripciones + Mercado Pago",
    intro: "Tiendanube sumó suscripciones nativas, y para algunas tiendas alcanzan. Para el resto, los límites aparecen rápido. Si chocaste con alguno, esto es lo que se puede hacer.",
    bloques: [
      { h: "Dónde están los límites de la nativa", p: "Funciona solo con Pago Nube y tarjeta de crédito, pide plan Impulso o superior, no admite variantes y solo deja un producto con suscripción por carrito. Si vendés sabores o talles, si querés cobrar con tu Mercado Pago, o si armás packs, quedás afuera por diseño." },
      { h: "Qué cambia con Recurrentes", p: "Cobrás con la cuenta de Mercado Pago que ya usás, vendés variantes, armás packs de varias unidades con precio y precio tachado propios, y podés tener más de un producto por suscripción. No depende de tu plan de Tiendanube." },
      { h: "Cómo se instala", p: "Instalás la app desde tu panel de Tiendanube y el selector aparece en la ficha de producto. Cada cobro aprobado crea la orden paga en tu tienda, con la dirección del cliente y el envío correspondiente." },
    ],
    faq: [
      ["¿Puedo tener las dos, la nativa y esta?", "Técnicamente sí, pero no conviene: dos selectores en la misma ficha confunden al comprador y no vas a saber cuál vendió."],
      ["¿Sirve en el plan más económico?", "Sí. No depende del plan de Tiendanube ni de Pago Nube."],
    ],
  },

  // ── Argentina ────────────────────────────────────────────────────────────
  {
    slug: "suscripciones-argentina",
    title: "Suscripciones en Argentina: qué se puede cobrar y con qué | Recurrentes",
    description: "Panorama de las suscripciones para negocios argentinos: qué pasarelas permiten cobro recurrente, qué plataformas lo soportan y qué queda afuera.",
    h1: "Suscripciones en Argentina: el panorama real",
    intro: "Vender por suscripción en Argentina tiene sus propias reglas, y casi todo lo que se lee en internet está escrito para otro mercado. Esto es lo que funciona acá, en septiembre de 2026.",
    bloques: [
      { h: "Con qué se cobra", p: "Mercado Pago es la opción realista: es donde ya está tu comprador y su API de suscripciones funciona. Stripe no abre cuentas a comercios argentinos, así que solo entra si tenés una sociedad afuera, y en ese caso cada tarjeta argentina te sale más cara por ser internacional. Las pasarelas locales alternativas están en distintos estados de madurez." },
      { h: "Qué plataformas lo soportan", p: "Shopify tiene API de suscripciones pero atada a pasarelas que no incluyen Mercado Pago. Tiendanube tiene suscripciones nativas con límites fuertes (solo Pago Nube, crédito, sin variantes). WooCommerce y Empretienda no traen nada nativo. En los cuatro casos, el cobro recurrente con Mercado Pago hay que resolverlo por fuera." },
      { h: "El problema que nadie menciona", p: "Cobrar es la mitad del trabajo. La otra mitad es que cada cobro se convierta en una orden en tu tienda, con stock, dirección y envío. Si eso no pasa solo, alguien va a cargar pedidos a mano todos los meses, y ahí la suscripción deja de ser un negocio y pasa a ser una tarea." },
      { h: "Qué mirar antes de elegir herramienta", p: "Si cobra comisión por venta además del abono; si soporta variantes y packs; si genera la orden sola; y qué pasa cuando un cobro se rechaza. Esas cuatro definen si escala o si te da trabajo." },
    ],
    faq: [
      ["¿Se puede cobrar con débito?", "Depende de lo que Mercado Pago habilite en tu cuenta para cobro recurrente. No es algo que decida la herramienta."],
      ["¿Necesito facturar distinto?", "Cada cobro es una venta como cualquier otra a efectos de facturación. Consultalo con tu contador según tu condición."],
    ],
  },
  {
    slug: "vender-por-suscripcion-argentina",
    title: "¿Te conviene vender por suscripción? Los números | Recurrentes",
    description: "Cuándo conviene pasar tu tienda a suscripción: qué tasa de recompra necesitás, cuánto descuento poner y cómo se mide si funciona.",
    h1: "¿Te conviene vender por suscripción?",
    intro: "La suscripción no sirve para todos los productos ni para todas las tiendas. Antes de armarla, estos son los números que dicen si vale la pena en tu caso. Si no dan, mejor saberlo ahora.",
    bloques: [
      { h: "El número que decide: tu recompra actual", p: "Mirá qué porcentaje de tus clientes ya te vuelve a comprar sin que hagas nada. Si es menos del 10%, la suscripción no va a arreglar eso: el problema está en el producto o en la experiencia, y una suscripción solo lo va a hacer más visible. Del 20% para arriba, tenés con qué trabajar: esa gente ya decidió que le sirve." },
      { h: "Qué descuento poner", p: "Entre 10% y 20% suele alcanzar. El cliente no se suscribe por el precio, se suscribe por no quedarse sin el producto. Un descuento más alto te come el margen sin mover la conversión, y te ata a venderle barato para siempre." },
      { h: "Cómo se mide si funciona", p: "Tres números: cuántos suscriptores entran por mes, cuántos se van (churn) y cuánto factura cada uno antes de irse. Si se van más de los que entran, casi nunca es el precio: es la frecuencia mal elegida. Le estás mandando producto antes de que termine el anterior." },
      { h: "Cuánto cuesta arrancar", p: "El abono de Recurrentes es gratis hasta 10 suscriptores activos y no cobramos comisión por venta, así que podés validar sin poner plata por adelantado. La puesta en marcha sale USD 100 una sola vez, y se paga recién cuando está funcionando." },
    ],
    faq: [
      ["¿Cuánto tarda en verse el resultado?", "El primer mes ves cuántos se suscriben. El número que importa —cuántos siguen— recién se ve en el tercer o cuarto cobro."],
      ["¿Y si me arrepiento?", "Las suscripciones activas siguen cobrándose; podés dejar de ofrecer nuevas cuando quieras. Nadie queda atado."],
    ],
  },
  {
    slug: "suscripciones-ecommerce-argentina",
    title: "Qué rubros funcionan con suscripción en Argentina | Recurrentes",
    description: "Suplementos, café, cosmética, mascotas y limpieza: qué rubros del ecommerce argentino funcionan con suscripción, con qué frecuencia y por qué.",
    h1: "Qué rubros funcionan con suscripción",
    intro: "La pregunta no es si tu rubro «puede» tener suscripción: es cada cuánto se le termina el producto a tu cliente. Si eso es previsible, funciona. Estos son los rubros donde mejor anda en Argentina y con qué frecuencia arrancar.",
    bloques: [
      { h: "Suplementos y vitaminas", p: "El caso más limpio: el envase dura exactamente lo que dice la etiqueta. Si son 60 cápsulas a dos por día, son 30 días. La frecuencia se calcula sola y el cliente entiende de inmediato por qué le conviene. Acá los packs de 2 y 3 meses funcionan muy bien." },
      { h: "Café y alimentos de consumo diario", p: "Entre 15 y 30 días según el tamaño. El riesgo es mandar de más: si el cliente acumula dos paquetes sin abrir, se da de baja. Conviene arrancar con la frecuencia más larga y dejar que él la acorte." },
      { h: "Cosmética y cuidado personal", p: "De 30 a 60 días, según el producto. Son rubros con mucha recompra pero también con mucha tentación de probar otra marca: acá el descuento por suscribirse y algún regalo en el primer envío hacen más diferencia que en otros rubros." },
      { h: "Mascotas y limpieza", p: "Alimento para mascotas es de los mejores: el consumo es constante y previsible, y quedarse sin es un problema real. Productos de limpieza funcionan parecido, con frecuencias más largas y packs grandes." },
      { h: "Dónde no funciona", p: "Indumentaria, electrónica, decoración y todo lo que se compra por impulso o por única vez. Si tu cliente no tiene una razón para necesitarlo otra vez en una fecha previsible, no hay suscripción que lo arregle." },
    ],
    faq: [
      ["¿Y si mi producto dura distinto según el cliente?", "Dejá que elija la frecuencia entre dos o tres opciones, y que pueda pausar. Eso resuelve casi toda la variación."],
      ["¿Conviene ofrecer packs?", "Sí. Un pack de 2 o 3 unidades sube lo que factura cada cliente y baja la cantidad de envíos, que es donde se te va el margen."],
    ],
  },

  // ── Competencia ──────────────────────────────────────────────────────────
  {
    slug: "puentify",
    title: "Puentify y Recurrentes: qué mirar antes de elegir | Recurrentes",
    description: "Si estás evaluando Puentify para cobrar suscripciones en tu tienda, esto es lo que conviene comparar y qué hace Recurrentes en concreto.",
    h1: "¿Estás evaluando Puentify?",
    intro: "Puentify y Recurrentes resolvemos el mismo problema: cobrar suscripciones en un ecommerce argentino. No vamos a hablar por ellos —para eso está su sitio—, así que acá va qué conviene comparar y qué hacemos nosotros, para que lo midas con los mismos criterios.",
    bloques: [
      { h: "Las cuatro preguntas que cambian el resultado", p: "¿Cobra comisión por cada venta además del abono? ¿Funciona en la plataforma que ya usás? ¿Soporta variantes y packs, o solo un producto suelto? ¿La orden se crea sola en tu tienda o alguien la carga a mano? Pedí ver las cuatro funcionando en una demo, con tus productos, antes de decidir." },
      { h: "Qué hace Recurrentes", p: "Funciona sobre Shopify y Tiendanube, cobra con la cuenta de Mercado Pago que ya tenés y no cobra comisión por venta. Es gratis hasta 10 suscriptores activos y después arranca en USD 99 por mes. Cada cobro aprobado genera la orden paga en tu tienda con dirección, envío y stock descontado." },
      { h: "Packs, variantes y regalos", p: "El selector de la ficha de producto admite packs de varias unidades con precio y precio tachado propios, variantes (sabores, talles, colores), regalos por pack y una frecuencia distinta para cada pack. El cliente elige todo en la misma página." },
      { h: "Quién lo pone a andar", p: "La instalación la hacemos nosotros: dejamos la conexión, el selector y los planes funcionando. Cuesta USD 100 una sola vez y se paga recién cuando está terminada y andando como la querés." },
    ],
    faq: [
      ["¿Puedo probar antes de pagar?", "Sí. Es gratis hasta 10 suscriptores activos, así que podés validar con clientes reales antes de que te cueste un peso."],
      ["¿Puedo migrar suscriptores que ya tengo?", "Las autorizaciones de cobro de Mercado Pago no se transfieren entre aplicaciones: cada suscriptor tiene que volver a autorizar. Lo que sí se puede es acompañar la migración con mails automáticos para no perder gente en el camino."],
    ],
  },
  {
    slug: "puentify-precios",
    title: "Cuánto cuesta cobrar suscripciones: cómo comparar | Recurrentes",
    description: "Abono, comisión por venta e instalación: cómo comparar el costo real de una herramienta de suscripciones y cuánto cuesta Recurrentes.",
    h1: "Cuánto cuesta cobrar suscripciones (y cómo comparar)",
    intro: "Comparar precios de herramientas de suscripción es difícil porque cada una cobra distinto. Acá va cómo hacer la cuenta bien y cuánto cuesta Recurrentes, con los números puestos.",
    bloques: [
      { h: "El abono es la parte fácil de comparar", p: "Es un número fijo por mes. Lo que hay que mirar es de qué depende: si sube por cantidad de suscriptores, por facturación o por funciones. Un abono que sube con tus suscriptores es más justo al principio y más caro cuando funcionás; uno fijo es al revés." },
      { h: "La comisión por venta es donde se esconde la plata", p: "Un 2% suena a poco. Sobre 100 suscriptores que pagan 30.000 pesos por mes, son 60.000 pesos mensuales que se van además del abono. Y crece justo cuando te empieza a ir bien. Hacé esa cuenta con tus números antes de elegir: es la diferencia más grande entre dos herramientas que parecen iguales." },
      { h: "La instalación", p: "Dejar el selector andando en un tema de Shopify, con packs y descuentos, lleva horas de trabajo real. Algunas herramientas te lo cobran, otras te lo dejan a vos. Ninguna de las dos está mal; lo que está mal es enterarte después." },
      { h: "Cuánto cuesta Recurrentes", p: "Gratis hasta 10 suscriptores activos. De 11 a 50, USD 99 por mes; de 51 a 100, USD 199; de 101 a 300, USD 399. Cero comisión por venta, siempre. La instalación sale USD 100 una sola vez y se paga cuando está terminada y funcionando." },
    ],
    faq: [
      ["¿Por qué cobran por suscriptores y no un fijo?", "Porque al principio no tenés ninguno y no tiene sentido que pagues. Cuando pagás, ya te está entrando plata de esos suscriptores."],
      ["¿Hay costo por los mails y los WhatsApp?", "Los mails están incluidos. Los WhatsApp a tus clientes se cobran por mensaje, porque los cobra Meta; el precio está a la vista en el panel y viene apagado por defecto."],
    ],
  },

  // ── El problema, en criollo ──────────────────────────────────────────────
  {
    slug: "como-cobrar-todos-los-meses-a-mis-clientes",
    title: "Cómo cobrarle todos los meses a tus clientes | Recurrentes",
    description: "Dejá de perseguir la recompra: cómo hacer que tu cliente autorice un cobro mensual automático y que cada cobro se convierta en un pedido listo para despachar.",
    h1: "Cómo cobrarle todos los meses a tus clientes",
    intro: "Si tenés clientes que te compran lo mismo una y otra vez, y cada vez tenés que volver a venderles —el anuncio, el mensaje, el recordatorio—, esto es para vos. La venta se puede hacer una sola vez y repetirse sola.",
    bloques: [
      { h: "Lo que hacés hoy", p: "Pagás publicidad para traer al mismo cliente de nuevo. Le escribís por WhatsApp para recordarle que se le está por terminar. Conciliás transferencias a mano. Cargás el pedido otra vez. Y arrancás el mes sin saber cuánto vas a facturar." },
      { h: "Lo que cambia", p: "Tu cliente autoriza una vez que le cobres cada tanto. Desde ahí, Mercado Pago le debita en la fecha que corresponde y el pedido se crea solo en tu tienda, listo para despachar. Vos no tocás nada y él no tiene que acordarse de nada." },
      { h: "Por dónde se empieza", p: "Elegís un producto —el que más se repite— y definís cada cuánto se le termina al cliente y qué descuento le das por suscribirse. Con eso alcanza para lanzar. Lo demás se ajusta con los primeros suscriptores." },
      { h: "Qué pasa si se quiere ir", p: "Cancela desde su portal, sin escribirte. Suena mal y es lo contrario: la alternativa es que desconozca el cargo en la tarjeta, que es peor para vos. Y antes de la baja se le puede ofrecer pausar un ciclo, que recupera a una buena parte." },
    ],
    faq: [
      ["¿Tengo que cambiar de plataforma?", "No. Funciona sobre tu Shopify o tu Tiendanube actual."],
      ["¿Cuánto tarda en estar andando?", "La puesta en marcha la hacemos nosotros y suele quedar lista el mismo día que nos das los accesos."],
    ],
  },
  {
    slug: "suscripciones-sin-comision-por-venta",
    title: "Suscripciones sin comisión por venta | Recurrentes",
    description: "Cuánto te cuesta realmente una comisión del 1% o 2% sobre tus suscripciones, y por qué en Recurrentes solo pagás el abono.",
    h1: "Suscripciones sin comisión por venta",
    intro: "Casi todas las herramientas de suscripción cobran un porcentaje de cada cobro, además del abono mensual. Suena a poco hasta que lo multiplicás por doce meses y por la cantidad de clientes que querés tener.",
    bloques: [
      { h: "La cuenta que conviene hacer", p: "Tomá tu ticket promedio, multiplicalo por la cantidad de suscriptores que querés tener en un año, y sacale el porcentaje. Con 100 suscriptores que pagan 30.000 pesos por mes, un 2% son 60.000 pesos mensuales. Al año, 720.000 pesos que se van sin que nadie haga nada nuevo por vos." },
      { h: "Por qué la comisión duele más que el abono", p: "El abono es previsible y lo podés presupuestar. La comisión crece exactamente cuando te está yendo bien, así que te castiga el éxito: cuanto mejor vendés, más pagás, aunque el trabajo de la herramienta sea el mismo con 10 que con 500 suscriptores." },
      { h: "Qué cobramos nosotros", p: "El abono, y nada más. Gratis hasta 10 suscriptores activos, y después según cuántos tengas cobrando: USD 99 de 11 a 50, USD 199 de 51 a 100. Cero por ciento de cada venta, siempre. La única otra cosa es la instalación, USD 100 una sola vez." },
      { h: "Lo que sí te va a cobrar alguien", p: "Mercado Pago cobra su comisión por procesar el pago, como en cualquier venta tuya. Eso no lo evita ninguna herramienta y no pasa por nosotros: es la relación entre tu cuenta y Mercado Pago." },
    ],
    faq: [
      ["¿Hay costos ocultos?", "Los WhatsApp a tus clientes se cobran por mensaje porque los cobra Meta, vienen apagados y el precio está a la vista en el panel. Los mails están incluidos."],
      ["¿El precio sube si vendo más caro?", "No. Depende de cuántos suscriptores activos tengas, no de cuánto factures."],
    ],
  },
];
