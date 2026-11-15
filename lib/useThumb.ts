'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

// En el servidor `useLayoutEffect` no corre; se usa el efecto común para no
// depender de eso. En el cliente tiene que ser el de layout: la medida va antes
// del pintado, o el segmento elegido se vería un cuadro en su lugar viejo.
const useEfectoDeLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Segmento elegido que se desliza, para un segmented control.
 *
 * Mide el botón activo (`aria-pressed="true"` o `aria-current="page"`) y deja
 * su posición en `--thumb-x` / `--thumb-w` sobre el contenedor; el CSS dibuja
 * el segmento con un pseudo-elemento y anima el cambio (ver `.seg[data-thumb]`
 * en globals.css). Con CSS solo no se puede: el ancho de cada opción depende de
 * su texto.
 *
 * `clave` es la opción activa: al cambiar se vuelve a medir. También se mide
 * cuando cambia el ancho del contenedor, porque las etiquetas pasan de la
 * versión larga a la corta en el breakpoint mobile y la fuente web llega
 * después del primer pintado.
 */
export function useThumb<T extends HTMLElement>(clave: string) {
  const ref = useRef<T | null>(null);

  useEfectoDeLayout(() => {
    const el = ref.current;
    if (!el) return;

    const medir = () => {
      const activo = el.querySelector<HTMLElement>('[aria-pressed="true"], [aria-current="page"]');
      if (!activo) {
        el.removeAttribute('data-thumb');
        return;
      }
      el.style.setProperty('--thumb-x', `${activo.offsetLeft}px`);
      el.style.setProperty('--thumb-w', `${activo.offsetWidth}px`);
      el.setAttribute('data-thumb', '');
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    for (const hijo of Array.from(el.children)) ro.observe(hijo);
    return () => ro.disconnect();
  }, [clave]);

  return ref;
}
