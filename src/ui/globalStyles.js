// CSS global de Recurrentes — copiado del sistema de animaciones/transiciones
// de Growith (keyframes `rec-*`, clases `.gh-*`, helpers responsive) y
// recoloreado a verde. Import side-effect: `import "./ui/globalStyles.js"`.
if (typeof document !== "undefined" && !document.getElementById("rec-global-css")) {
  const s = document.createElement("style");
  s.id = "rec-global-css";
  s.textContent = `
    /* ═══════════════════════════════════════════
       RECURRENTES — SISTEMA DE ANIMACIONES GLOBAL
       Todos los movimientos de la app pasan por acá.
       Durations: fast=120ms | normal=200ms | slow=320ms
       Easing: ease = cubic-bezier(0.4,0,0.2,1)
               spring = cubic-bezier(0.22,1,0.36,1)  — overshoots leve, se siente vivo
               bounce = cubic-bezier(0.34,1.56,0.64,1) — más rebote, para elementos pequeños
    ═══════════════════════════════════════════ */

    /* ── Keyframes: entradas ── */
    @keyframes rec-spin       { to { transform: rotate(360deg); } }
    @keyframes rec-fadeIn     { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
    @keyframes rec-fadeInFast { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:translateY(0)} }
    @keyframes rec-fadeInDown { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }
    @keyframes rec-fadeInLeft { from{opacity:0;transform:translateX(8px)} to{opacity:1;transform:translateX(0)} }
    @keyframes rec-overlayIn  { from{opacity:0} to{opacity:1} }
    @keyframes rec-scaleIn    { from{opacity:0;transform:scale(0.97)} to{opacity:1;transform:scale(1)} }
    @keyframes rec-popIn      { from{opacity:0;transform:scale(0.93) translateY(5px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes rec-dropdownIn { from{opacity:0;transform:scale(0.97) translateY(-4px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes rec-modalIn    { from{opacity:0;transform:scale(0.96) translateY(10px)} to{opacity:1;transform:scale(1) translateY(0)} }
    @keyframes rec-panelRight { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
    @keyframes rec-panelUp    { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
    @keyframes rec-slideIn    { from{opacity:0;transform:translateX(-6px)} to{opacity:1;transform:translateX(0)} }
    @keyframes slideInRight       { from{opacity:0;transform:translateX(100%)} to{opacity:1;transform:translateX(0)} }
    @keyframes rec-bounceIn   { 0%{opacity:0;transform:scale(0.4)} 55%{opacity:1;transform:scale(1.1)} 75%{transform:scale(0.94)} 100%{transform:scale(1)} }
    @keyframes rec-shimmer    { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    @keyframes rec-skeleton   { 0%,100%{opacity:0.4} 50%{opacity:0.8} }
    /* Nombre legacy que usa el componente Skeleton — global para que el shimmer
       corra en TODAS las secciones (antes solo existía en 2 styles locales) */
    @keyframes skeleton           { 0%{background-position:200% 0} 100%{background-position:-200% 0} }

    /* ── Keyframes: salidas ── */
    @keyframes rec-fadeOut    { from{opacity:1;transform:translateY(0)} to{opacity:0;transform:translateY(4px)} }
    @keyframes rec-scaleOut   { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(0.96)} }
    @keyframes rec-overlayOut { from{opacity:1} to{opacity:0} }

    /* ── Keyframes: toasts ── */
    @keyframes rec-toast-in  { from{opacity:0;transform:translateY(14px) scale(0.94)} to{opacity:1;transform:translateY(0) scale(1)} }
    @keyframes rec-toast-out { from{opacity:1;transform:translateY(0) scale(1)} to{opacity:0;transform:translateY(-8px) scale(0.96)} }

    /* ── Keyframes: transición de página ── */
    @keyframes rec-pageEnter {
      from { opacity:0; transform:translateY(5px) scale(0.999); }
      to   { opacity:1; transform:none; }
    }

    /* ══════════════════════════════════════
       CLASES DE ANIMACIÓN — usar con className
    ══════════════════════════════════════ */

    /* Páginas y secciones */
    .gh-page        { animation: rec-pageEnter 0.28s cubic-bezier(0.22,1,0.36,1) both; }
    .gh-tab-content { animation: rec-fadeInFast 0.18s cubic-bezier(0.22,1,0.36,1) both; }
    .gh-section     { animation: rec-fadeIn 0.22s cubic-bezier(0.22,1,0.36,1) both; }

    /* Overlays / backdrops de modales */
    .gh-overlay, .gh-modal-backdrop {
      animation: rec-overlayIn 0.2s ease both;
    }
    .gh-overlay-closing { animation: rec-overlayOut 0.18s ease both; }

    /* Contenido de modales */
    .gh-modal   { animation: rec-modalIn 0.26s cubic-bezier(0.22,1,0.36,1) both; }
    .gh-modal-closing { animation: rec-scaleOut 0.18s ease both; }
    /* El contenido de cualquier overlay entra con scale+lift aunque no tenga
       clase propia — cubre todos los modales existentes de una sola vez */
    .gh-overlay > :first-child { animation: rec-modalIn 0.26s cubic-bezier(0.22,1,0.36,1) both; }

    /* Dropdowns, popovers, menus contextuales */
    .gh-dropdown {
      animation: rec-dropdownIn 0.16s cubic-bezier(0.22,1,0.36,1) both;
      transform-origin: top center;
    }
    .gh-dropdown-up {
      animation: rec-popIn 0.16s cubic-bezier(0.22,1,0.36,1) both;
      transform-origin: bottom center;
    }

    /* Paneles laterales */
    .gh-panel-right { animation: rec-panelRight 0.28s cubic-bezier(0.22,1,0.36,1) both; }
    .gh-panel-up    { animation: rec-panelUp 0.24s cubic-bezier(0.22,1,0.36,1) both; }

    /* Accordion / detalle expandible */
    .gh-accordion   { animation: rec-fadeIn 0.2s cubic-bezier(0.22,1,0.36,1) both; }

    /* Items de lista y cards */
    .gh-list-item  { animation: rec-fadeInFast 0.18s cubic-bezier(0.22,1,0.36,1) both; }
    .gh-card-enter { animation: rec-popIn 0.22s cubic-bezier(0.22,1,0.36,1) both; }

    /* Valor de KPI — entra con un fade+lift cada vez que cambia (key=value) */
    .gh-kpi-value  { animation: rec-fadeIn 0.3s cubic-bezier(0.22,1,0.36,1) both; }

    /* ══════════════════════════════════════
       TRANSICIONES GLOBALES DE ELEMENTOS
    ══════════════════════════════════════ */

    /* Botones — press + hover */
    button, a[role="button"] {
      transition: filter 0.14s ease, transform 0.14s cubic-bezier(0.34,1.4,0.64,1),
                  background 0.14s ease, border-color 0.14s ease,
                  box-shadow 0.16s ease, opacity 0.14s ease !important;
    }
    button:not(:disabled):hover  { filter: brightness(1.08); transform: translateY(-1px); }
    /* Al apretar NO se achica: con scale(.95) el botón se corría debajo del dedo y el click se perdía
       (Thiago, 25-sept-2026). Solo oscurece un poco. */
    button:not(:disabled):active { transform: translateY(0px) !important; filter: brightness(0.90) !important; transition-duration: 0.06s !important; }
    button:disabled { cursor: not-allowed !important; opacity: 0.38 !important; }

    /* Links */
    a { transition: opacity 0.14s ease, color 0.14s ease !important; }
    a:active { opacity: 0.65 !important; transition-duration: 0.06s !important; }

    /* Inputs */
    input, textarea, select {
      transition: border-color 0.16s ease, box-shadow 0.18s ease, background 0.16s ease !important;
    }
    input:focus, textarea:focus, select:focus {
      box-shadow: 0 0 0 3px rgba(16,185,129,0.18) !important;
      outline: none !important;
    }

    /* Cards clicables */
    .gh-clickable {
      transition: background 0.15s ease, border-color 0.15s ease,
                  transform 0.2s cubic-bezier(0.22,1,0.36,1),
                  box-shadow 0.18s ease !important;
      cursor: pointer;
    }
    .gh-clickable:hover  { transform: translateY(-2px) !important; box-shadow: 0 6px 20px rgba(0,0,0,0.12) !important; }
    .gh-clickable:active { transform: translateY(0) !important; filter: brightness(0.96) !important; transition-duration: 0.07s !important; }

    /* Filas de tabla — hover sutil en TODAS las tablas de datos.
       Sin !important: si la fila trae background inline (zebra, selección), gana el inline. */
    tbody tr { transition: background 0.12s ease; }
    tbody tr:hover { background: var(--gh-surface, rgba(16,185,129,0.05)); }
    .gh-row { transition: background 0.12s ease !important; cursor: pointer; }
    .gh-row:hover  { background: var(--gh-surface, rgba(16,185,129,0.06)) !important; }
    .gh-row:active { background: var(--gh-card, rgba(16,185,129,0.10))    !important; }

    /* Kanban cards */
    .gh-kanban-card {
      transition: transform 0.2s cubic-bezier(0.22,1,0.36,1),
                  box-shadow 0.18s ease, border-color 0.14s ease !important;
    }
    .gh-kanban-card:hover { transform: translateY(-2px) !important; box-shadow: 0 6px 24px rgba(0,0,0,0.18) !important; }

    /* Tabs */
    .gh-tab {
      transition: background 0.14s ease, color 0.14s ease,
                  border-color 0.14s ease, transform 0.14s ease !important;
    }
    .gh-tab:hover  { transform: translateY(-1px) !important; }
    .gh-tab:active { transform: translateY(0) !important; filter: brightness(0.92) !important; }

    /* Chips / filtros */
    .gh-chip {
      transition: background 0.14s ease, border-color 0.14s ease,
                  color 0.14s ease, transform 0.16s cubic-bezier(0.22,1,0.36,1),
                  box-shadow 0.14s ease !important;
    }
    .gh-chip:hover  { transform: translateY(-1px) !important; }
    .gh-chip:active { transform: translateY(0) !important; filter: brightness(0.92) !important; }

    /* Toggle switch */
    .gh-toggle        { transition: background 0.2s ease !important; cursor: pointer; }
    .gh-toggle-thumb  { transition: left 0.22s cubic-bezier(0.34,1.3,0.64,1) !important; }

    /* Smooth scroll */
    html { scroll-behavior: auto; }
    @media (prefers-reduced-motion: no-preference) { html:focus-within { scroll-behavior: smooth; } }
    body { transition: background 0.22s ease !important; }

    /* Selección de texto */
    ::selection { background: rgba(16,185,129,0.30); color: inherit; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 10px; height: 10px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--gh-scrollbar, rgba(255,255,255,0.08)); border-radius: 8px; border: 2px solid transparent; background-clip: padding-box; }
    ::-webkit-scrollbar-thumb:hover { background: var(--gh-scrollbar-hov, rgba(255,255,255,0.15)); background-clip: padding-box; }

    /* Focus rings */
    *:focus { outline: none; }
    button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, a:focus-visible {
      outline: 2px solid rgba(16,185,129,0.55);
      outline-offset: 2px;
      border-radius: 4px;
    }

    /* Hover helpers */
    .gh-hover-surface:hover { background: var(--gh-surface) !important; }
    .gh-hover-card:hover    { background: var(--gh-card)    !important; }
    .gh-hover-bg:hover      { background: var(--gh-bg)      !important; }

    /* Accordion height transition helper */
    .gh-collapse-content {
      overflow: hidden;
      transition: max-height 0.28s cubic-bezier(0.22,1,0.36,1),
                  opacity 0.22s ease;
    }

    /* Stagger helpers (nth-child delays) */
    .gh-stagger > *:nth-child(1)  { animation-delay: 0ms; }
    .gh-stagger > *:nth-child(2)  { animation-delay: 35ms; }
    .gh-stagger > *:nth-child(3)  { animation-delay: 70ms; }
    .gh-stagger > *:nth-child(4)  { animation-delay: 105ms; }
    .gh-stagger > *:nth-child(5)  { animation-delay: 140ms; }
    .gh-stagger > *:nth-child(6)  { animation-delay: 175ms; }
    .gh-stagger > *:nth-child(n+7){ animation-delay: 200ms; }

    /* ══════════════════════════════════════
       BASE + RESPONSIVE (del effect global de Growith)
    ══════════════════════════════════════ */
    *{box-sizing:border-box;}
    body{
      margin:0;overflow-x:clip;
      font-family:'Inter',system-ui,sans-serif;
      -webkit-font-smoothing:antialiased;
      -moz-osx-font-smoothing:grayscale;
      text-rendering:optimizeLegibility;
    }
    input,button,select,textarea{font-family:inherit;}
    .mobile-only{display:none!important;}
    .no-scrollbar::-webkit-scrollbar{display:none;}
    .no-scrollbar{scrollbar-width:none;-ms-overflow-style:none;}
    @media(max-width:768px){
      .hide-mobile{display:none!important;}
      .mobile-only{display:flex!important;}
      /* Topbar de sección en celu: título en una línea y TODOS los controles
         en la línea de abajo (sin scroll cortado ni "⋯"). */
      .gh-topbar-row{height:auto!important;flex-wrap:wrap!important;padding:10px 0!important;gap:8px 16px!important;}
      .gh-topbar-ctl{width:100%!important;flex-wrap:wrap!important;overflow:visible!important;padding:0!important;}
      .gh-topbar-ctl>div{flex-wrap:wrap!important;max-width:100%!important;}
      /* Sub-tabs: siempre visibles, deslizables si no entran (y sin sticky,
         porque el topbar ya no mide 64px fijos en celu). */
      .gh-apptabs{position:static!important;overflow-x:auto!important;-webkit-overflow-scrolling:touch;}
      .stack-mobile{flex-direction:column!important;grid-template-columns:1fr!important;}
      .full-mobile{width:100%!important;min-width:0!important;}
      .pad-mobile{padding:12px 14px!important;}
      .font-mobile{font-size:13px!important;}
      .main-content{padding-bottom:68px!important;}
      .kpi-grid{grid-template-columns:repeat(2,1fr)!important;}
      .home-wrap{padding:16px 14px 80px!important;}
    }
    @media(min-width:769px){
      .main-content{padding-bottom:0!important;}
    }
    /* Scrollbar delgado y discreto */
    ::-webkit-scrollbar{width:5px;height:5px;}
    ::-webkit-scrollbar-track{background:transparent;}
    ::-webkit-scrollbar-thumb{background:rgba(127,127,127,0.18);border-radius:99px;}
    ::-webkit-scrollbar-thumb:hover{background:rgba(127,127,127,0.32);}
  `;
  document.head.appendChild(s);
}
export {};
