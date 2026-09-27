// Tienda de EJEMPLO "Tostado" (26-sept-2026, Thiago: "una landing de compra única
// con una marca inventada, que quede linda"). No es una tienda real ni un
// comercio: es la ficha de producto de una marca de café ficticia con el widget
// REAL de Recurrentes funcionando (se cambia el modo y el pack). El botón de
// "Suscribirme" muestra cómo sigue (checkout con la marca) y lleva a pedir demo.
import React, { useEffect, useState } from "react";
import { InteractiveWidget, SAMPLE_PLANS, PRODUCT_ART, PartnerBadges } from "./LandingMotion.jsx";
import { RecLogo } from "../ui/Shell.jsx";

const F = "'Inter',system-ui,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";
const C = "#6b3f2a", CREAM = "#f6f1ea", INK = "#1f1511";
const fmtARS = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const MERCHANT = { widget_variant: "v13", widget_color: C, widget_radius: 12, widget_mode_default: "once", widget_mode_order: "once_first", widget_show_per_unit: true,
  widget_texts: { headline: "Elegí tu pack", sub_label: "Suscribirme y ahorrar", sub_hint: "Te llega solo cada mes · pausás o cancelás cuando quieras", cta_once: "Agregar al carrito" } };
// Checkout REAL en vista previa (Thiago, 26-sept: "que esto sea el checkout real"):
// el plan es de nuestra tienda de pruebas (RECURRENTES, ex DEMO SHOPIFY) y el
// tema lleva los colores de Tostado. preview=1 = sin eventos, leads ni pago.
const CHECKOUT_PREVIEW = "#/checkout?merchant=m_mu4jn3fj2x06fm&plan=gyU6BCDtNFZAm9aEo2qQ&preview=1&theme=" + encodeURIComponent(JSON.stringify({ color: C, header_text: "TOSTADO", font: "serif", radius: 12 }));

// 27-sept-2026 (Thiago): la tienda de ejemplo pasa a ser la demo COMPLETA armada con la
// plantilla de G4U (demos/plantilla-tienda → public/demos/tostado.html): intro, producto,
// armá tu pack, carrito, checkout y portal. Esta ruta solo redirige ahí.
export default function TostadoStore() {
  useEffect(() => { try { window.location.replace("/demos/tostado.html"); } catch (_) {} }, []);
  return <div style={{ minHeight: "100vh", background: CREAM, display: "grid", placeItems: "center", fontFamily: F, color: INK }}><a href="/demos/tostado.html" style={{ color: C, fontWeight: 700 }}>Abriendo la tienda de ejemplo…</a></div>;
}
