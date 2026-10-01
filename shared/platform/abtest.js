// Prueba A/B del widget (30-sept-2026, pedido de Wellfresh: "50% del tráfico con
// la oferta preseleccionada y 50% sin").
//
// POR QUÉ NO SE HACE CON DOS LINKS. La idea natural es armar un link con la
// variante B y mandar la mitad de la pauta ahí. No sirve: solo parte el tráfico
// que uno manda. El que llega por Google, por el link del perfil de Instagram o
// por un link viejo que alguien guardó cae SIEMPRE en la misma variante, y la
// muestra queda sesgada justo con la gente que más convierte (la que ya te
// conocía). Los números no se pueden comparar.
//
// Lo que sí sirve: el widget tira una moneda en la MISMA URL y se acuerda de lo
// que le tocó a esa persona (localStorage). Si no se acordara, el que vuelve
// vería otra variante y el test no mediría nada.
//
// Qué cambia la variante B: hoy solo con qué modo arranca la ficha, que es
// exactamente la pregunta de Wellfresh. Está armado como lista para poder sumar
// otras (color del botón, textos) sin tocar el widget.

export const AB_CAMBIOS = [
  {
    id: "mode_default",
    label: "Con qué opción arranca",
    desc: "A arranca como lo tenés configurado; B arranca con la otra.",
    valores: [
      { id: "sub", label: "Suscripción" },
      { id: "once", label: "Compra única" },
    ],
  },
];
const CAMBIO_BY_ID = Object.fromEntries(AB_CAMBIOS.map(c => [c.id, c]));

/** Lo que se guarda en `merchants.ab_test`. `null` = sin prueba corriendo. */
export function sanitizeAbTest(raw) {
  if (raw == null) return { ab_test: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { error: "ab_test debe ser un objeto" };
  if (raw.on !== true) return { ab_test: null };
  const cambio = String(raw.cambio || "mode_default");
  const def = CAMBIO_BY_ID[cambio];
  if (!def) return { error: `cambio inválido: ${cambio}` };
  const valor = String(raw.valor || "");
  if (!def.valores.some(v => v.id === valor)) return { error: `valor inválido para ${cambio}: ${valor}` };
  return { ab_test: { on: true, cambio, valor, started_at: raw.started_at || new Date().toISOString() } };
}

/** `null` si no hay prueba; si hay, qué pisa la variante B. */
export function resolveAbTest(merchant) {
  const t = merchant?.ab_test;
  if (!t || t.on !== true) return null;
  const def = CAMBIO_BY_ID[t.cambio];
  if (!def || !def.valores.some(v => v.id === t.valor)) return null;
  return { cambio: t.cambio, valor: t.valor, started_at: t.started_at || null, label: def.label };
}

/** "a" | "b" saneada: lo que llega del navegador no se cree de más. */
export const abVariant = (v) => (String(v || "").toLowerCase() === "b" ? "b" : String(v || "").toLowerCase() === "a" ? "a" : null);

/**
 * El resultado, listo para mostrar. Con el reparto 50/50 las dos variantes
 * reciben prácticamente la misma cantidad de visitas, así que alcanza con
 * comparar CUÁNTAS suscripciones trajo cada una: no hace falta contar visitas
 * (que además, con la caché de la CDN, no podríamos contar bien).
 */
export function abResultado({ a = 0, b = 0 } = {}) {
  const total = a + b;
  const dif = a > 0 ? Math.round(((b - a) / a) * 100) : (b > 0 ? 100 : 0);
  return {
    a, b, total,
    ganadora: total < AB_MINIMO ? null : b > a ? "b" : a > b ? "a" : null,
    dif_pct: dif,
    // Debajo de esto cualquier diferencia es ruido: con 5 contra 8 no hay nada
    // que decidir, y mostrar un ganador ahí hace que el comercio cambie su
    // tienda por casualidad.
    suficiente: total >= AB_MINIMO,
  };
}
// Mínimo de suscripciones entre las dos para decir algo. No es un cálculo de
// significancia: es un piso honesto para no sugerir conclusiones de la nada.
export const AB_MINIMO = 40;
