'use client';

// Ayuda mínima: un ⓘ que abre un globo. Con mouse se abre al pasar por encima; con
// el dedo, al tocarlo, y se cierra tocando afuera (en iOS un botón tocado no toma
// el foco, así que no alcanza con cerrarlo en `blur`). `type="button"` porque
// también se usa dentro de formularios, donde un botón común los enviaría.
//
// Es la única ayuda contextual del dashboard: las guías de los gráficos y las
// notas de método pasan por acá en vez de armar cada una su propio popover.
// Estilos en globals.css (.info-btn, .info-globo).

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Qué se explica: va en la etiqueta para lectores de pantalla ("Qué es …"). */
  label: string;
  children: ReactNode;
  /** Ancho del globo en px. Por defecto 250; las guías de gráfico piden más. */
  ancho?: number;
}

export default function InfoTip({ label, children, ancho = 250 }: Props) {
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const globo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const alTocar = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAbierto(false);
    };
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('pointerdown', alTocar);
    document.addEventListener('keydown', alTeclear);
    return () => {
      document.removeEventListener('pointerdown', alTocar);
      document.removeEventListener('keydown', alTeclear);
    };
  }, [abierto]);

  // El globo sale alineado al ⓘ: si eso lo deja fuera de lo visible (una tarjeta de
  // la columna derecha en el celular), se corre hacia adentro. El límite es el borde
  // del contenedor con scroll, no el de la pantalla: pasarse lo recorta y le agrega
  // una barra de scroll horizontal, y la parte final del texto queda inalcanzable.
  useLayoutEffect(() => {
    const el = globo.current;
    if (!abierto || !el) return;
    let limite = window.innerWidth - 8;
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (getComputedStyle(p).overflowX === 'visible') continue;
      limite = Math.min(limite, p.getBoundingClientRect().left + p.clientWidth - 8);
      break;
    }
    const exceso = el.getBoundingClientRect().right - limite;
    if (exceso > 0) el.style.transform = `translateX(${-exceso}px)`;
  }, [abierto]);

  return (
    <span
      ref={raiz}
      style={{ position: 'relative', flexShrink: 0, display: 'inline-flex' }}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setAbierto(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAbierto(false); }}
    >
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        onBlur={() => setAbierto(false)}
        aria-label={`Qué es ${label}`}
        aria-expanded={abierto}
        className="info-btn"
      >
        {/* Un solo círculo: el carácter "ⓘ" dentro de un botón con borde se
            veía como dos anillos concéntricos. */}
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6.75" stroke="currentColor" strokeWidth="1.2" />
          <circle cx="8" cy="5" r="0.9" fill="currentColor" />
          <path d="M8 7.4v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      {abierto && (
        <div ref={globo} role="tooltip" className="tooltip-panel info-globo" style={{ width: ancho }}>
          {children}
        </div>
      )}
    </span>
  );
}
