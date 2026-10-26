'use client';

import { useRef } from 'react';
import { formatMoney } from '@/lib/format';

interface Props {
  meses: string[];
  selected: string;
  onSelect: (m: string) => void;
  totalMes: number;
  activosMes: number;
  hideValues?: boolean;
}

export default function MonthSlider({ meses, selected, onSelect, totalMes, activosMes, hideValues }: Props) {
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
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', minWidth: 56, textAlign: 'right' }}>
        {selected}
      </span>

      {/* Track */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
        <span className="month-endlabel" style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meses[0]}</span>
        <div
          ref={trackRef}
          onClick={handleTrackClick}
          className="month-track"
          style={{ flex: 1, position: 'relative', height: 20, display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', touchAction: 'none' }}
        >
          <div style={{ position: 'absolute', left: 0, right: 0, height: 2, borderRadius: 2, background: 'var(--border)' }} />
          {meses.map((_, i) => (
            <div key={i} style={{
              position: 'absolute',
              left: `${meses.length > 1 ? (i / (meses.length - 1)) * 100 : 0}%`,
              transform: 'translateX(-50%)',
              width: 3, height: 3, borderRadius: '50%',
              background: 'var(--border)', pointerEvents: 'none', zIndex: 1,
            }} />
          ))}
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
            style={{
              position: 'absolute', left: `${pct}%`, transform: 'translateX(-50%)',
              width: 16, height: 16, borderRadius: '50%', touchAction: 'none',
              background: 'var(--card)', border: '2px solid var(--primary)',
              boxShadow: '0 1px 6px rgba(0,0,0,0.4)',
              cursor: 'grab', zIndex: 3, outline: 'none',
              transition: 'left 0.08s ease',
            }}
          />
        </div>
        <span className="month-endlabel" style={{ fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{meses[meses.length - 1]}</span>
      </div>
    </div>
  );
}
