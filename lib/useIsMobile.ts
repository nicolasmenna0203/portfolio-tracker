'use client';

import { useEffect, useState } from 'react';

/** Mismo breakpoint que el bloque mobile de `app/globals.css`. */
export const MOBILE_QUERY = '(max-width: 768px)';

/**
 * `true` cuando el viewport entra en el breakpoint mobile.
 *
 * Los gráficos (Recharts) no se pueden ajustar solo con CSS: el ancho de los
 * ejes, el tamaño de las barras y los márgenes son props de JS. Este hook
 * centraliza la consulta que antes estaba duplicada en cada componente.
 *
 * Arranca en `false` a propósito: en el servidor no hay `window`, y devolver
 * `false` hace que el HTML del SSR coincida con el del primer render del
 * cliente (si no, React tira un error de hidratación). El valor real se aplica
 * en el efecto, antes del primer pintado útil.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
