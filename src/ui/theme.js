// Sistema de tema de Recurrentes — copiado del DS de Growith y recoloreado a
// la marca verde. `T` es el objeto de tokens activo (DARK o LIGHT); `DS` son
// las escalas (spacing, radios, tipografía, sombras) compartidas.
import React from "react";

export const DARK = {
  isDark:   true,
  bg:       "#0a0f0d",
  surface:  "#11171a",
  card:     "#161e22",
  border:   "#1f2a30",
  borderL:  "#1a2328",
  text:     "#f0f4f5",
  textMd:   "#c1cbd1",
  textSm:   "#7e8a93",
  accent:   "#34d399",
  accentSolid:"#10b981",
  green:    "#34d399",
  greenBg:  "#052e16",
  yellow:   "#fbbf24",
  yellowBg: "#1c1400",
  red:      "#f87171",
  redBg:    "#1f0707",
  purple:   "#10b981",
  purpleBg: "rgba(16,185,129,0.12)",
  blue:     "#60a5fa",
  blueBg:   "#0a1628",
  orange:   "#fb923c",
  orangeBg: "#1c0a00",
  input:    "#0e1417",
  inputBorder:"#283036",
  badge: (dot) => ({ bg: dot+"18", border: dot+"33" }),
};

export const LIGHT = {
  isDark:   false,
  bg:       "#f3f6f5",
  surface:  "#fafcfb",
  card:     "#ffffff",
  border:   "#e2e8e5",
  borderL:  "#eef2f0",
  text:     "#0b1210",
  textMd:   "#4b5a55",
  textSm:   "#8a9791",
  accent:   "#059669",
  accentSolid:"#10b981",
  green:    "#059669",
  greenBg:  "#ecfdf5",
  yellow:   "#ca8a04",
  yellowBg: "#fefce8",
  red:      "#dc2626",
  redBg:    "#fef2f2",
  purple:   "#059669",
  purpleBg: "#ecfdf5",
  blue:     "#2563eb",
  blueBg:   "#eff6ff",
  orange:   "#ea580c",
  orangeBg: "#fff7ed",
  input:    "#ffffff",
  inputBorder:"#d3dcd8",
  badge: (dot) => ({ bg: dot+"18", border: dot+"33" }),
};

// ═══════════════════════════════════════════════════════════════════
// DESIGN SYSTEM — tokens centralizados
// ═══════════════════════════════════════════════════════════════════
export const DS = {
  // Spacing scale
  sp: { xs:4, sm:8, md:12, lg:16, xl:20, "2xl":24, "3xl":32, "4xl":48 },
  // Border radius scale
  r: { sm:6, md:8, lg:10, xl:14, "2xl":16, full:9999 },
  // Typography scale
  font: { xs:10, sm:11, md:12, base:13, lg:14, xl:16, "2xl":20, "3xl":26, "4xl":34 },
  // Font weights
  w: { regular:400, medium:500, semibold:600, bold:700, black:800 },
  // Shadows
  shadow: {
    sm: "0 1px 2px rgba(0,0,0,0.04)",
    md: "0 2px 8px rgba(0,0,0,0.08)",
    lg: "0 8px 24px rgba(0,0,0,0.12)",
    xl: "0 16px 48px rgba(0,0,0,0.18)",
  },
  // Easing
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
};

// Verde oscuro de la marca (gradientes / hover del botón sólido)
export const GREEN_DARK = "#059669";

// Espeja el tema activo a las CSS custom properties que usan las pantallas
// que NO reciben T (tabs del dashboard viejo, Portal, Checkout) — así todo
// cambia de tema junto.
export function applyThemeToRoot(T) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const set = (k, v) => root.style.setProperty(k, v);
  set("--bg", T.bg);
  set("--surface", T.surface);
  set("--card", T.card);
  set("--border", T.border);
  set("--border-light", T.inputBorder);
  set("--text", T.text);
  set("--text-md", T.textMd);
  set("--text-sm", T.textSm);
  set("--accent", T.accent);
  set("--green", T.accentSolid);
  set("--green-dark", GREEN_DARK);
  set("--green-bg", T.isDark ? "rgba(16,185,129,0.14)" : "#ecfdf5");
  set("--red", T.red);
  set("--yellow", T.yellow);
  // Alias usados por el CSS global copiado de Growith (hover de filas, etc.)
  set("--gh-bg", T.bg);
  set("--gh-surface", T.surface);
  set("--gh-card", T.card);
  set("--gh-border", T.border);
  set("--gh-scrollbar", T.isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.12)");
  set("--gh-scrollbar-hov", T.isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.22)");
  root.style.colorScheme = T.isDark ? "dark" : "light";
  try { document.body.style.background = T.bg; document.body.style.color = T.text; } catch (_) {}
}

export const THEME_KEY = "rec_theme";

export function readStoredDark() {
  try { return localStorage.getItem(THEME_KEY) !== "light"; } catch (_) { return true; }
}

// Hook de tema: estado + persistencia + espejo a :root. Al desmontar vuelve al
// tema oscuro por defecto (Portal/Checkout son dark-only y no usan este hook).
export function useTheme() {
  const [darkMode, setDarkMode] = React.useState(readStoredDark);
  const T = darkMode ? DARK : LIGHT;
  React.useEffect(() => {
    applyThemeToRoot(T);
    try { localStorage.setItem(THEME_KEY, darkMode ? "dark" : "light"); } catch (_) {}
  }, [darkMode]);
  React.useEffect(() => () => applyThemeToRoot(DARK), []);
  return { darkMode, setDarkMode, T, toggleDark: () => setDarkMode(d => !d) };
}
