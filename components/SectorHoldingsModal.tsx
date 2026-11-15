'use client';

import { useEffect } from 'react';
import { useSectorHoldings } from '@/lib/useSectorHoldings';
import { formatPercent } from '@/lib/format';

interface Props {
  ticker: string;
  label: string;
  onClose: () => void;
}

function fmtPct1(v: number): string {
  return formatPercent(v * 100);
}

/** Panel modal con la composición (top holdings, gestora, expense ratio) de un ETF sectorial. */
export default function SectorHoldingsModal({ ticker, label, onClose }: Props) {
  const { data, loading, error } = useSectorHoldings(ticker);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-velo" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sector-titulo"
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 14 }}>
          <div>
            <h2 id="sector-titulo" className="sheet-titulo">{label}</h2>
            <p className="card-sub">Composición de {ticker}</p>
          </div>
          {/* Foco inicial acá: Enter o Esc cierran sin buscar el botón. */}
          <button type="button" onClick={onClose} aria-label="Cerrar" className="cerrar-btn" autoFocus>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M2 2l8 8M10 2l-8 8" />
            </svg>
          </button>
        </div>

        {loading && (
          <span className="skeleton" role="status" aria-label="Cargando composición" style={{ height: 220, borderRadius: 10 }} />
        )}
        {error && (
          <p className="nota" role="alert" style={{ color: 'var(--down)' }}>No se pudo cargar la composición: {error}</p>
        )}

        {!loading && !error && data && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginBottom: 10, fontSize: 13, color: 'var(--muted)' }}>
              {data.gestora && <span>Gestora <strong style={{ fontWeight: 600, color: 'var(--text)' }}>{data.gestora}</strong></span>}
              {data.expenseRatio != null && <span>Costo anual <strong style={{ fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct1(data.expenseRatio)}</strong></span>}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ borderBottom: '0.5px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '6px 0', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Empresa</th>
                  <th style={{ textAlign: 'right', padding: '6px 0', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.symbol} style={{ borderBottom: '0.5px solid var(--border)' }}>
                    <td style={{ padding: '8px 0' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{h.symbol}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{h.nombre}</div>
                    </td>
                    <td style={{ padding: '8px 0', textAlign: 'right', color: 'var(--text)', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPct1(h.peso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.holdings.length === 0 && (
              <p className="card-sub">Este ETF no publica su composición.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
