'use client';

// Selector de mes: un slider con un paso por mes. Estilos en globals.css
// (.month-*): el thumb necesita `:focus-visible` y `:active`, que con estilos
// inline no se pueden expresar (el foco de teclado no se veía).

import { useRef } from 'react';

interface Props {
  meses: string[];
  selected: string;
  onSelect: (m: string) => void;
}

export default function MonthSlider({ meses, selected, onSelect }: Props) {
  const idx      = meses.indexOf(selected);
  const pct      = meses.length > 1 ? (idx / (meses.length - 1)) * 100 : 0;
  const trackRef = useRef<HTMLDivElement>(null);

  function getRatioFromEvent(clientX: number): number {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function selectFromRatio(ratio: number) {
    onSelect(meses[Math.round(ratio * (meses.length - 1))]);
  }

  function handleTrackClick(e: React.MouseEvent<HTMLDivElement>) {
    selectFromRatio(getRatioFromEvent(e.clientX));
  }

  function handleThumbMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    function onMouseMove(ev: MouseEvent) { selectFromRatio(getRatioFromEvent(ev.clientX)); }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function handleThumbTouchStart() {
    // `passive: false` permite el preventDefault que evita que la página
    // scrollee mientras se arrastra el thumb.
    function onTouchMove(ev: TouchEvent) {
      ev.preventDefault();
      selectFromRatio(getRatioFromEvent(ev.touches[0].clientX));
    }
    function onTouchEnd() {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    }
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowLeft'  && idx > 0)                onSelect(meses[idx - 1]);
    if (e.key === 'ArrowRight' && idx < meses.length - 1) onSelect(meses[idx + 1]);
    if (e.key === 'Home')                                  onSelect(meses[0]);
    if (e.key === 'End')                                   onSelect(meses[meses.length - 1]);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

      {/* Mes seleccionado */}
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', minWidth: 56, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {selected}
      </span>

      {/* Track */}
      {/* gap mayor que el radio del thumb (11px): en los extremos sobresale del
          track y tapaba la primera letra de la etiqueta. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
        <span className="month-endlabel" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meses[0]}</span>
        <div
          ref={trackRef}
          onClick={handleTrackClick}
          className="month-track"
        >
          <div className="month-pista" />
          <div className="month-relleno" style={{ width: `${pct}%` }} />
          <div
            tabIndex={0}
            role="slider"
            aria-valuemin={0}
            aria-valuemax={meses.length - 1}
            aria-valuenow={idx}
            aria-valuetext={selected}
            className="month-thumb"
            aria-label="Mes seleccionado"
            onMouseDown={handleThumbMouseDown}
            onTouchStart={handleThumbTouchStart}
            onKeyDown={handleKeyDown}
            style={{ left: `${pct}%` }}
          />
        </div>
        <span className="month-endlabel" style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meses[meses.length - 1]}</span>
      </div>
    </div>
  );
}
