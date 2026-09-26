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
];
