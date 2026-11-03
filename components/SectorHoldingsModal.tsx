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
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 100, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '16px 18px', maxWidth: 420, width: '100%', maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>{label}</p>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{ticker} · composición</span>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              border: 'none', background: 'transparent', color: 'var(--muted)',
              fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
            }}
          >×</button>
        </div>

        {loading && (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando composición…</p>
        )}
        {error && (
          <p style={{ margin: 0, fontSize: 12, color: '#ef553b' }}>Error cargando composición: {error}</p>
        )}

        {!loading && !error && data && (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11, color: 'var(--muted)' }}>
              {data.gestora && <span>Gestora: <strong style={{ color: 'var(--text-sec)' }}>{data.gestora}</strong></span>}
              {data.expenseRatio != null && <span>Expense ratio: <strong style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct1(data.expenseRatio)}</strong></span>}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Holding</th>
                  <th style={{ textAlign: 'right', padding: '4px 6px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {data.holdings.map((h) => (
                  <tr key={h.symbol} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 6px' }}>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{h.symbol}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{h.nombre}</div>
                    </td>
                    <td style={{ padding: '6px 6px', textAlign: 'right', color: 'var(--text-sec)', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPct1(h.peso)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.holdings.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Sin holdings publicados para este ETF.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
