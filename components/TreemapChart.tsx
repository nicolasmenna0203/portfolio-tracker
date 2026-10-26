'use client';

import { useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { TenenciaActual } from '@/types';
import { PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL, MONEDA_COLOR, RENTA_COLOR, GEO_COLOR, colorPorCategoria } from '@/lib/constants';
import { formatMoney, type Moneda } from '@/lib/format';

interface Props {
  tenencias: TenenciaActual[];
  totalCartera: number;
  dim?: Dim;
  filtroTipo?: string | null;
  onFiltroTipo?: (tipo: string) => void;
  hideValues?: boolean;
  moneda?: Moneda;
}

const DIMS = [
  { key: 'TIPO',       label: 'Tipo de Activo'    },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'   },
  { key: 'MONEDA',     label: 'Tipo de Moneda'    },
  { key: 'RENTA',      label: 'Tipo de Renta'     },
  { key: 'SECTOR_GEO', label: 'Sector Geográfico' },
] as const;

type Dim = typeof DIMS[number]['key'];

function getGroupLabel(t: TenenciaActual, dim: Dim): string {
  switch (dim) {
    case 'RIESGO':     return RIESGO_LABEL[t.RIESGO]     ?? 'Sin dato';
    case 'RENTA':      return RENTA_LABEL[t.RENTA]       ?? t.RENTA      ?? 'Sin dato';
    case 'SECTOR_GEO': return GEO_LABEL[t.SECTOR_GEO]   ?? t.SECTOR_GEO ?? 'Sin dato';
    case 'MONEDA':     return MONEDA_LABEL[t.MONEDA]     ?? t.MONEDA     ?? 'Sin dato';
    default:           return t.TIPO ?? 'Sin dato';
  }
}

function getGroupColor(group: string, dim: Dim): string {
  if (dim === 'TIPO')       return PALETA_TIPO[group]   ?? colorPorCategoria(group);
  if (dim === 'RIESGO')     return RIESGO_COLOR[group]  ?? colorPorCategoria(group);
  if (dim === 'MONEDA')     return MONEDA_COLOR[group]  ?? colorPorCategoria(group);
  if (dim === 'RENTA')      return RENTA_COLOR[group]   ?? colorPorCategoria(group);
  if (dim === 'SECTOR_GEO') return GEO_COLOR[group]     ?? colorPorCategoria(group);
  return colorPorCategoria(group);
}

function buildData(tenencias: TenenciaActual[], dim: Dim, moneda: Moneda) {
  // tenencia_ars/tenencia_usd ya vienen calculados desde el origen (Sheet) para
  // cada mes — no se recalculan acá con ningún MEP.
  const campo = moneda === 'ARS' ? 'tenencia_ars' : 'tenencia_usd';
  // Construir mapa de grupos → tickers
  const groupMap = new Map<string, Map<string, number>>();
  for (const t of tenencias) {
    const g = getGroupLabel(t, dim);
    if (!groupMap.has(g)) groupMap.set(g, new Map());
    const tickers = groupMap.get(g)!;
    tickers.set(t.ticker, (tickers.get(t.ticker) ?? 0) + t[campo]);
  }

  // Asignar color por índice de grupo
  const groups = Array.from(groupMap.entries()).sort(([, a], [, b]) => {
    const sumA = Array.from(a.values()).reduce((s, v) => s + v, 0);
    const sumB = Array.from(b.values()).reduce((s, v) => s + v, 0);
    return sumB - sumA;
  });

  return groups.map(([group, tickers]) => {
    const baseColor = getGroupColor(group, dim);
    const sorted = Array.from(tickers.entries()).sort(([, a], [, b]) => b - a);
    const maxVal = sorted[0]?.[1] ?? 1;
    const minVal = sorted[sorted.length - 1]?.[1] ?? 0;
    const range  = maxVal - minVal || 1;
    return {
      name: group,
      color: baseColor,
      children: sorted.map(([ticker, usd]) => {
        // mayor valor → más oscuro (0.82), menor → más claro (0.38)
        const opacity = 0.82 - ((usd - minVal) / range) * 0.44;
        return { name: ticker, value: usd, group, color: baseColor, fillOpacity: opacity };
      }),
    };
  });
}

function CustomCell({ x, y, width, height, name, value, depth, root, group, color, fillOpacity: fo, filtroActivo }: any) {
  if (depth === 0 || !width || !height || width < 4 || height < 4) return <g />;

  const groupName  = depth === 1 ? name : group;
  const cellColor  = color ?? '#8a7d6a';
  const total      = root?.value ?? 1;
  const pct        = Math.round((value / total) * 100);
  const dimmed     = filtroActivo != null && groupName !== filtroActivo;

  if (depth === 1) {
    const label = width > 80 ? `${name}  ${pct}%` : name;
    return (
      <g style={{ cursor: 'pointer' }}>
        <rect
          x={x} y={y} width={width} height={height}
          fill={cellColor} fillOpacity={dimmed ? 0.03 : 0.1}
          stroke={cellColor} strokeWidth={filtroActivo === name ? 2 : 1}
          strokeOpacity={dimmed ? 0.15 : 0.7}
          rx={6}
        />
        {width > 40 && (
          <g>
            {/* Banda sólida de color del grupo — siempre opaca */}
            <rect
              x={x} y={y} width={width} height={26}
              fill={cellColor} fillOpacity={dimmed ? 0.18 : 0.9}
              rx={6}
            />
            {/* Redondear solo esquinas inferiores de la banda */}
            <rect
              x={x} y={y + 14} width={width} height={12}
              fill={cellColor} fillOpacity={dimmed ? 0.18 : 0.9}
            />
            <text
              x={x + 8} y={y + 13}
              fill="#fff" fillOpacity={dimmed ? 0.45 : 1}
              fontSize={11} fontWeight="800" dominantBaseline="middle"
              style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.7))' }}
            >
              {label}
            </text>
          </g>
        )}
      </g>
    );
  }

  // Ticker
  const fontSize = Math.max(8, Math.min(12, width / (name.length * 0.65)));
  return (
    <g style={{ cursor: 'pointer' }}>
      <rect
        x={x + 1} y={y + 1} width={width - 2} height={height - 2}
        fill={cellColor} fillOpacity={dimmed ? 0.12 : (fo ?? 0.7)}
        stroke="var(--bg)" strokeWidth={1.5}
        rx={3}
      />
      {width > 26 && height > 16 && (
        <text
          x={x + width / 2} y={y + height / 2}
          textAnchor="middle" dominantBaseline="central"
          fill="#fff" fillOpacity={dimmed ? 0.3 : 1}
          fontSize={fontSize} fontWeight="600"
        >
          {name}
        </text>
      )}
    </g>
  );
}

function TooltipContent({ active, payload, hideValues, moneda }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{d.name}</p>
      <p style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.value, { currency, hidden: hideValues })}</p>
      {d.group && <p style={{ color: d.color ?? 'var(--muted)', marginTop: 2, fontSize: 11 }}>{d.group}</p>}
    </div>
  );
}

export default function TreemapChart({ tenencias, dim: dimProp, filtroTipo, onFiltroTipo, hideValues, moneda = 'USD' }: Props) {
  const [dimLocal, setDimLocal] = useState<Dim>('TIPO');
  const dim = dimProp ?? dimLocal;

  // Sector Geográfico solo aplica a renta variable
  const tenenciasFiltradas = dim === 'SECTOR_GEO'
    ? tenencias.filter(t => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE')
    : tenencias;

  const data = buildData(tenenciasFiltradas, dim, moneda);

  // El filtro activo es el del grupo seleccionado externamente (filtroTipo) cuando dim=TIPO,
  // o null para otras dims (los filtros cross-chart siguen siendo solo por TIPO por ahora)
  const filtroActivo = dim === 'TIPO' ? filtroTipo : null;

  function handleClick(node: any) {
    if (!onFiltroTipo || dim !== 'TIPO') return;
    const tipo = node?.group ?? node?.name;
    if (tipo) onFiltroTipo(tipo);
  }

  return (
    <div style={{
      background: 'var(--card)',
      border: filtroTipo ? '1px solid var(--primary)' : '1px solid var(--border)',
      borderRadius: 12,
      padding: '12px 14px 10px',
      transition: 'border-color 0.15s',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      {/* Header: título + selector local (solo si dim no viene de afuera) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <p style={{
          fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
          color: filtroTipo ? 'var(--primary)' : 'var(--text-sec)',
          margin: 0, flexShrink: 0, transition: 'color 0.15s',
        }}>
          Distribución
          {filtroTipo && dim === 'TIPO' && <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--primary)' }}>· {filtroTipo}</span>}
          {dim === 'SECTOR_GEO' && <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--muted)', fontSize: 11 }}>· solo Renta Variable</span>}
        </p>
        {!dimProp && (
          <div style={{ display: 'flex', gap: 4 }}>
            {DIMS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDimLocal(d.key)}
                style={{
                  padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: dim === d.key ? 'var(--primary)' : 'var(--border)',
                  background: dim === d.key ? 'var(--primary-dim)' : 'transparent',
                  color: dim === d.key ? 'var(--primary)' : 'var(--muted)',
                  transition: 'all 0.12s',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={data}
            dataKey="value"
            content={<CustomCell filtroActivo={filtroActivo} />}
            onClick={handleClick}
          >
            <Tooltip content={<TooltipContent hideValues={hideValues} moneda={moneda} />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
