// Shopify — datos compartidos de la conexión (fuente ÚNICA para api/* y src/*).
//
// Cada comerciante conecta su tienda con una app que crea él mismo en el
// Dev Dashboard de Shopify (dev.shopify.com/dashboard): dominio .myshopify.com +
// Client ID + Client Secret → OAuth → token. No hay app pública ni App Store.
//
// Lo usan:
//   · api/shopify.js (?action=oauth-start) → scopes que pedimos en el OAuth.
//   · src/pages/Integrations.jsx y ShopifyConnect.jsx → modal guiado (copiar scopes).
//   · src/pages/Guide.jsx y src/lib/onboarding.js → textos de ayuda.
//
// Si cambiás esta lista, las tiendas ya conectadas conservan sus permisos viejos
// (no se fuerza reconexión): el panel sugiere "Reconectar" cuando falta alguno.

// Permisos (scopes) que Recurrentes necesita, con el motivo en criollo.
export const SHOPIFY_SCOPES = [
  { id: "read_products",   why: "Leer tus productos y variantes para armar los planes." },
  { id: "read_orders",     why: "Revisar órdenes ya creadas y no duplicar ninguna." },
  { id: "write_orders",    why: "Crear la orden paga en tu tienda con cada cobro." },
  { id: "read_customers",  why: "Buscar si el cliente ya existe en tu tienda." },
  { id: "write_customers", why: "Crear o actualizar el cliente con su dirección." },
  { id: "read_shipping",   why: "Leer tus tarifas de envío para el checkout." },
  // 21-sept-2026: VUELVE. Estaba sacado con el comentario "no se usa en ningún
  // lado", pero la cotización en vivo (shQuoteShippingRates → draftOrderCalculate)
  // lo exige: sin él Shopify responde ACCESS_DENIED y el comprador se queda sin
  // envíos. Se notó en Glowtherm, que no tiene tarifas fijas —solo app de
  // envíos— así que la cotización era su única fuente.
  { id: "write_draft_orders", why: "Cotizar tus envíos reales igual que en tu checkout." },
  // Opcional: solo lo usa el botón "Traer los descuentos de Shopify" (Configuración →
  // Descuentos). Si falta, todo lo demás anda y NO mostramos el aviso de permisos.
  { id: "read_discounts",  why: "Traer tus códigos de descuento al checkout de suscripción.", optional: true },
  // Opcional (25-sept-2026, Wellfresh): el botón "Hacerlo gratis en Shopify" crea un
  // descuento automático "comprá el pack, llevate el regalo gratis". Sin este permiso el
  // regalo se agrega al carrito al precio de la tienda.
  { id: "write_discounts", why: "Crear el descuento automático que deja tus regalos gratis en compra única.", optional: true },
];
export const SHOPIFY_GIFT_SCOPE = "write_discounts";

export const SHOPIFY_SCOPE_IDS = SHOPIFY_SCOPES.map(s => s.id);
// Sin los opcionales: es lo que el panel exige para decir "te falta un permiso".
export const SHOPIFY_REQUIRED_SCOPE_IDS = SHOPIFY_SCOPES.filter(s => !s.optional).map(s => s.id);
export const SHOPIFY_DISCOUNTS_SCOPE = "read_discounts";
// Lo que se pega en Shopify → Scopes (separado por comas, sin espacios).
export const SHOPIFY_SCOPES_STRING = SHOPIFY_SCOPE_IDS.join(",");

export const SHOPIFY_DEV_DASHBOARD_URL = "https://dev.shopify.com/dashboard";
export const SHOPIFY_REDIRECT_PATH = "/api/shopify/oauth-callback";
export const shopifyRedirectUrl = (origin) => `${String(origin || "").replace(/\/+$/, "")}${SHOPIFY_REDIRECT_PATH}`;

const splitScopes = (s) => String(s || "").split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);

// Lista final para el OAuth: la compartida + lo que agregue la env SHOPIFY_SCOPES
// (sin duplicados). La env ya no puede SACAR permisos necesarios (antes, una env
// vieja sin read_shipping dejaba sin envíos a las tiendas nuevas).
export function oauthScopes(extra = "") {
  const out = [...SHOPIFY_SCOPE_IDS];
  for (const s of splitScopes(extra)) if (!out.includes(s)) out.push(s);
  return out.join(",");
}

// Permisos de `required` que NO están en `granted` (el `scope` que devolvió
// Shopify al conectar). write_X incluye read_X. Sin dato (tiendas viejas o token
// pegado a mano) devuelve [] → nunca molestamos sin estar seguros.
export function missingShopifyScopes(granted, required = SHOPIFY_REQUIRED_SCOPE_IDS) {
  const have = splitScopes(granted);
  if (!have.length) return [];
  return required.filter(r => !have.includes(r) && !(r.startsWith("read_") && have.includes("write_" + r.slice(5))));
}
