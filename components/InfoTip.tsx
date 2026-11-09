'use client';

// Ayuda mínima: un ⓘ que abre un globo. Con mouse se abre al pasar por encima; con
// el dedo, al tocarlo, y se cierra tocando afuera (en iOS un botón tocado no toma
// el foco, así que no alcanza con cerrarlo en `blur`). `type="button"` porque
// también se usa dentro de formularios, donde un botón común los enviaría.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** Qué se explica: va en la etiqueta para lectores de pantalla ("Qué es …"). */
  label: string;
  children: ReactNode;
}

export default function InfoTip({ label, children }: Props) {
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
        className="kpi-info"
        style={{
          width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)',
          background: 'transparent', color: 'var(--muted)', fontSize: 9, lineHeight: 1,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 0, position: 'relative',
        }}
      >
        ⓘ
      </button>
      {abierto && (
        <div
          ref={globo}
          role="tooltip"
          style={{
            position: 'absolute', top: 18, left: 0, zIndex: 20,
            width: 240, maxWidth: 'calc(100vw - 32px)',
            background: 'var(--material)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
            border: '0.5px solid var(--material-borde)', borderRadius: 12,
            padding: '10px 12px', fontSize: 12, lineHeight: 1.45, color: 'var(--text)',
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)', fontWeight: 400, textTransform: 'none',
            letterSpacing: 'normal', whiteSpace: 'normal', textAlign: 'left',
          }}
        >
          {children}
        </div>
      )}
    </span>
  );
}
