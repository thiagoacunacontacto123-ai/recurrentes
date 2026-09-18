// Pestañas del panel que no se destruyen (Thiago, 18-sept: "que todo cargue rápido sin
// perder que esté todo actualizado"). Dashboard deja montadas las pestañas ya visitadas
// (volver es instantáneo) y avisa con este evento cuándo una vuelve a mostrarse; cada
// página escucha y vuelve a pedir su data EN SILENCIO (sin spinner, se reemplaza al llegar).
import { useEffect, useRef } from "react";

export const TAB_SHOWN_EVENT = "rec:tab-shown";

export function emitTabShown(tab) {
  try { window.dispatchEvent(new CustomEvent(TAB_SHOWN_EVENT, { detail: { tab } })); } catch (_) {}
}

// useTabRefresh("cobros", () => loadAll({ silent: true }))
//   · no dispara en el primer montaje (la página ya carga sola)
//   · como mucho una vez cada 5 s por pestaña (ida y vuelta rápida no spamea)
export function useTabRefresh(tabIds, fn, { minAgeMs = 1500, throttleMs = 5000 } = {}) {
  const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
  const fnRef = useRef(fn); fnRef.current = fn;
  const mountedAt = useRef(Date.now());
  const lastRun = useRef(0);
  useEffect(() => {
    const onShown = (e) => {
      if (!ids.includes(e.detail?.tab)) return;
      const now = Date.now();
      if (now - mountedAt.current < minAgeMs || now - lastRun.current < throttleMs) return;
      lastRun.current = now;
      try { fnRef.current?.(); } catch (_) {}
    };
    window.addEventListener(TAB_SHOWN_EVENT, onShown);
    return () => window.removeEventListener(TAB_SHOWN_EVENT, onShown);
    // eslint-disable-next-line
  }, [ids.join("|")]);
}
