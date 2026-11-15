'use client';

import { useState } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { usePerformanceVariable } from '@/lib/usePerformanceVariable';
import { useHistoricoTicker } from '@/lib/useHistoricoTicker';
import { formatPercent } from '@/lib/format';
import type { RangoHistorico } from '@/types';
import SectorHoldingsModal from './SectorHoldingsModal';
import Segmented from './Segmented';

// ETFs SPDR Select Sector: cada uno trackea uno de los 11 sectores GICS del
// S&P 500. Es el proxy sectorial más líquido y estándar de mercado, por eso
// se usa acá en vez de armar una canasta propia de tickers por sector.
const SECTORES: { ticker: string; label: string }[] = [
  { ticker: 'XLE', label: 'Energía' },
  { ticker: 'XLK', label: 'Tecnología' },
  { ticker: 'SMH', label: 'Semiconductores' },
  { ticker: 'XLV', label: 'Salud' },
  { ticker: 'XLF', label: 'Financiero' },
  { ticker: 'XLI', label: 'Industrial' },
  { ticker: 'XLY', label: 'Consumo discrecional' },
  { ticker: 'XLP', label: 'Consumo básico' },
  { ticker: 'XLU', label: 'Utilities' },
  { ticker: 'XLB', label: 'Materiales' },
  { ticker: 'XLRE', label: 'Real Estate' },
  { ticker: 'XLC', label: 'Comunicaciones' },
];

const TICKERS_SECTORES = SECTORES.map((s) => s.ticker);

// No hay rango "YTD" nativo en el histórico por puntos (RangoHistorico solo
// tiene 1m/6m/1a/5a/10a) — el YTD de la tabla sale de otra fuente
// (datosAcciones). Acá "YTD" usa 1a como aproximación visual del sparkline.
const RANGOS: { id: RangoHistorico; label: string; variacionKey: 'variacionYtd' | 'variacion1a' }[] = [
  { id: '1a', label: 'YTD', variacionKey: 'variacionYtd' },
  { id: '5a', label: '5A', variacionKey: 'variacion1a' },
  { id: '10a', label: '10A', variacionKey: 'variacion1a' },
];

function fmtPct1(v: number): string {
  return formatPercent(v * 100);
}

function colorVar(v: number | null): string {
  if (v == null) return 'var(--muted)';
  return v >= 0 ? 'var(--up)' : 'var(--down)';
}

function SectorCard({
  ticker, label, rango, variacion, onClick,
}: {
  ticker: string;
  label: string;
  rango: RangoHistorico;
  variacion: number | null;
  onClick: () => void;
}) {
  const { data: historico, loading } = useHistoricoTicker(ticker, rango);
  const puntos = historico?.puntos ?? [];
  const color = colorVar(variacion);
  const gradientId = `sparkline-${ticker}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} (${ticker}): ver composición`}
      className="sector-card"
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{ticker}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums' }}>
          {variacion != null ? fmtPct1(variacion) : '—'}
        </span>
      </span>
      <span style={{ display: 'block', height: 40, marginTop: 2 }}>
        {!loading && puntos.length > 1 && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={puntos} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis dataKey="close" domain={['auto', 'auto']} hide />
              <Area
                type="monotone" dataKey="close"
                stroke={color} strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </span>
    </button>
  );
}

/**
 * Mini panel de ETFs sectoriales (SPDR Select Sector) para ubicar la cartera
 * dentro del ciclo de mercado. Reutiliza los mismos endpoints que el resto de
 * RentaVariableSection — estos ETFs no forman parte de la cartera, se piden
 * sin tenencias asociadas.
 */
export default function SectoresMercado() {
  const [rango, setRango] = useState<RangoHistorico>('1a');
  const [sectorAbierto, setSectorAbierto] = useState<{ ticker: string; label: string } | null>(null);
  const { data, loading, error } = usePerformanceVariable(TICKERS_SECTORES, {});
  const porTicker = new Map((data?.acciones ?? []).map((a) => [a.ticker, a]));
  const variacionKey = RANGOS.find((r) => r.id === rango)?.variacionKey ?? 'variacionYtd';

  return (
    <div className="card">
      <div className="card-cabecera" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <p className="card-titulo">Sectores del mercado</p>
          <p className="card-sub">ETFs SPDR Select Sector. Tocá uno para ver qué tiene adentro.</p>
        </div>
        <Segmented opciones={RANGOS} activa={rango} onChange={setRango} chico etiqueta="Rango" />
      </div>

      {loading && (
        <span className="skeleton" role="status" aria-label="Cargando sectores" style={{ height: 196, borderRadius: 12 }} />
      )}
      {error && (
        <p className="nota" role="alert" style={{ color: 'var(--down)' }}>No se pudieron cargar los sectores: {error}</p>
      )}

      {!loading && !error && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8,
        }}>
          {SECTORES.map(({ ticker, label }) => (
            <SectorCard
              key={ticker}
              ticker={ticker}
              label={label}
              rango={rango}
              variacion={porTicker.get(ticker)?.[variacionKey] ?? null}
              onClick={() => setSectorAbierto({ ticker, label })}
            />
          ))}
        </div>
      )}

      {sectorAbierto && (
        <SectorHoldingsModal
          ticker={sectorAbierto.ticker}
          label={sectorAbierto.label}
          onClose={() => setSectorAbierto(null)}
        />
      )}
    </div>
  );
}
