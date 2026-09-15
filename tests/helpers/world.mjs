// Mundo de prueba "Lumina": merchant legacy (físico + Shopify + Mercado Pago, SIN
// business_type/channel/payment_provider, sin flujos, sin Klaviyo, sin Meta) con
// su plan, y los servicios falsos (MP, Shopify, Resend) conectados al router.
import "./register.mjs";
import { resetFirestore, seedDoc, rawGet, rawList } from "./fake-firestore.mjs";
import { createFetchRouter } from "./fetch-router.mjs";
import { createFakeMp, createFakeShopify, createFakeResend } from "./fakes.mjs";

export const ROOT = new URL("../../", import.meta.url);
/** import() de un módulo del proyecto por ruta relativa a la raíz (misma instancia que usa la app). */
export const loadApi = (rel) => import(new URL(rel, ROOT).href);

export const MID = "lumina_uid_test";
export const SHOP = "lumina-test.myshopify.com";
export const SHOP_TOKEN = "shpat_test_lumina";
export const MP_TOKEN = "APP_USR-test-lumina";
export const MP_USER_ID = 123456789;
export const PLAN_ID = "plan_capsulas";
export const PRODUCT_ID = "7001";
export const VARIANT_ID = "4001";
export const VARIANT_PRICE = 12000;
export const PRODUCT_TITLE = "Cápsulas LuminaLabs";
export const APP = "https://www.recurrentesapp.com";

export function luminaMerchant(overrides = {}) {
  return {
    email: "hola@lumina.test",
    store_name: "LuminaLabs",
    widget_color: "#10b981",
    created_at: "2026-06-01T12:00:00.000Z", // antes del corte → tarifas legacy de Lumina
    shopify_shop: SHOP,
    shopify_token: SHOP_TOKEN,
    shopify_connected_at: "2026-06-01T12:05:00.000Z",
    mp_access_token: MP_TOKEN,
    mp_user_id: MP_USER_ID,
    mp_public_key: "APP_USR-pub-test",
    mp_connected_at: "2026-06-01T12:10:00.000Z",
    ...overrides,
  };
}

export function capsulasPlan(overrides = {}) {
  return {
    shopify_product_id: PRODUCT_ID,
    shopify_variant_id: VARIANT_ID,
    product_title: PRODUCT_TITLE,
    product_image: "https://cdn.shopify.test/capsulas.jpg",
    frequency_days: 30,
    discount_pct: 10,
    units_per_shipment: 1,
    base_price_ars: VARIANT_PRICE,
    subscription_price_ars: 10800,
    shipping_price_ars: 1500,
    free_shipping_from_ars: 0,
    shipping_method_name: "Envío a domicilio",
    qty_discount_tiers: [],
    active: true,
    created_at: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

export const ADDRESS = {
  address1: "Av. Siempreviva 742",
  address2: "3B",
  city: "CABA",
  province: "Buenos Aires",
  zip: "1414",
  country: "Argentina",
};

/** Snapshot del plan tal como lo guarda checkout/init para una sub de `qty` unidades. */
export function snapshot({ qty = 1, shipping = 1500, methodName = "Envío a domicilio", methodCode = "" } = {}) {
  const subtotal = 10800 * qty;
  return {
    shopify_variant_id: VARIANT_ID,
    shopify_product_id: PRODUCT_ID,
    product_title: PRODUCT_TITLE,
    frequency_days: 30,
    subscription_price_ars: 10800,
    units_per_shipment: qty,
    subtotal_ars: subtotal,
    shipping_price_ars: shipping,
    shipping_method_name: methodName,
    shipping_method_code: methodCode,
    qty_discount_pct: 0,
    discount_code: null,
    discount_code_pct: 0,
    total_per_charge_ars: subtotal + shipping,
  };
}

/** Suscriptor base (renovación: activo, con un cobro y una orden previa). */
export function subscriber(overrides = {}) {
  const name = overrides.customer_name || "Ana Pérez";
  const phone = overrides.customer_phone || "1155550000";
  return {
    customer_email: "ana@cliente.test",
    customer_name: name,
    customer_phone: phone,
    customer_tax_id: "30123456",
    customer_tax_id_kind: "DNI",
    shipping_address: { ...ADDRESS, first_name: name.split(" ")[0], last_name: name.split(" ").slice(1).join(" "), phone },
    plan_id: PLAN_ID,
    quantity: 1,
    plan_snapshot: snapshot({ qty: 1 }),
    status: "active",
    capture: false,
    mp_preapproval_plan_id: "plan_adhoc_ana",
    mp_preapproval_id: "pre_ana",
    mp_preapproval_status: "authorized",
    next_charge_at: "2026-09-15T13:00:00.000Z",
    last_charge_at: "2026-08-16T13:00:00.000Z",
    shopify_orders: [5550001],
    created_at: "2026-07-17T13:00:00.000Z",
    updated_at: "2026-08-16T13:00:00.000Z",
    ...overrides,
  };
}

/** Pago de MP con la forma de un cobro de suscripción (sin external_reference: el flujo de plan no lo propaga). */
export function mpPayment({ id, status = "approved", amount, preapprovalId, externalReference = null, dateCreated, dateApproved, statusDetail, fee = 1386 } = {}) {
  const created = dateCreated || new Date(Date.now() - 60_000).toISOString().replace("Z", "-00:00");
  return {
    id: Number(id),
    status,
    status_detail: statusDetail || (status === "approved" ? "accredited" : "cc_rejected_insufficient_amount"),
    transaction_amount: amount,
    currency_id: "ARS",
    external_reference: externalReference,
    date_created: created,
    date_approved: status === "approved" ? (dateApproved || created) : null,
    operation_type: "recurring_payment",
    payment_type_id: "credit_card",
    metadata: { preapproval_id: preapprovalId },
    point_of_interaction: { type: "SUBSCRIPTIONS", transaction_data: { subscription_id: preapprovalId } },
    fee_details: status === "approved" ? [{ type: "mercadopago_fee", amount: fee, fee_payer: "collector" }] : [],
    payer: { id: 987654, email: "comprador@mp.test" },
  };
}

export function mpPreapproval({ id, planId, status = "authorized", amount = 12300, frequency = 30, nextPaymentDate = "2026-10-15T10:00:00.000-03:00", dateCreated } = {}) {
  return {
    id,
    preapproval_plan_id: planId,
    status,
    external_reference: null,
    payer_id: 987654,
    date_created: dateCreated || new Date(Date.now() - 5 * 60_000).toISOString(),
    next_payment_date: nextPaymentDate,
    auto_recurring: { frequency, frequency_type: "days", transaction_amount: amount, currency_id: "ARS", start_date: "2026-09-15T10:00:00.000-03:00" },
  };
}

/** Request del webhook de MP tal como llega a nivel cuenta (sin ?mid&sid). */
export function mpWebhookReq(paymentId, { type = "payment", userId = MP_USER_ID, query = {}, headers = {} } = {}) {
  return {
    method: "POST",
    headers,
    query: { "data.id": String(paymentId), type, ...query },
    body: {
      action: "payment.created", api_version: "v1", data: { id: String(paymentId) },
      date_created: new Date().toISOString(), id: 120000000001, live_mode: true, type,
      ...(userId == null ? {} : { user_id: String(userId) }),
    },
  };
}

/** Arma el mundo: Firestore vacío + Lumina + plan + fakes de MP/Shopify/Resend. */
export function createWorld({ merchant = luminaMerchant(), plan = capsulasPlan() } = {}) {
  resetFirestore();
  const router = createFetchRouter().install();
  const mp = createFakeMp(router);
  const shopify = createFakeShopify(router, { shop: SHOP, token: SHOP_TOKEN, variants: { [VARIANT_ID]: VARIANT_PRICE } });
  const resend = createFakeResend(router);
  if (merchant) seedDoc(`merchants/${MID}`, merchant);
  if (plan) seedDoc(`merchants/${MID}/plans/${PLAN_ID}`, plan);
  return {
    router, mp, shopify, resend,
    seedSub: (id, data) => seedDoc(`merchants/${MID}/subscribers/${id}`, data),
    sub: (id) => rawGet(`merchants/${MID}/subscribers/${id}`),
    subs: () => rawList(`merchants/${MID}/subscribers`),
    charge: (id) => rawGet(`merchants/${MID}/charges/${id}`),
    charges: () => rawList(`merchants/${MID}/charges`),
    emailLog: () => rawList(`merchants/${MID}/email_log`).map(d => d.data),
    merchant: () => rawGet(`merchants/${MID}`),
    shopifyCalls: () => router.find({ host: SHOP }),
  };
}

/** note_attributes de una orden → { name: value }. */
export const noteMap = (order) => Object.fromEntries((order.note_attributes || []).map(a => [a.name, a.value]));
