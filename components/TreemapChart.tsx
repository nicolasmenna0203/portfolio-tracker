'use client';

import { Treemap, ResponsiveContainer, Tooltip, type TooltipContentProps } from 'recharts';
import type { TenenciaActual } from '@/types';
import { PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL, MONEDA_COLOR, RENTA_COLOR, GEO_COLOR, colorPorCategoria } from '@/lib/constants';
import { formatMoney, type Moneda } from '@/lib/format';

interface Props {
  tenencias: TenenciaActual[];
  dim: Dim;
  filtroTipo?: string | null;
  onFiltroTipo?: (tipo: string) => void;
  hideValues?: boolean;
  moneda?: Moneda;
}

type Dim = 'TIPO' | 'RIESGO' | 'MONEDA' | 'RENTA' | 'SECTOR_GEO';

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

/** Lo que recharts le inyecta a cada celda del Treemap, más el filtro propio. */
interface PropsCelda {
  x?: number; y?: number; width?: number; height?: number;
  name?: string; value?: number; depth?: number;
  root?: { value?: number };
  group?: string; color?: string; fillOpacity?: number;
  filtroActivo?: string | null;
}

function CustomCell({ x = 0, y = 0, width, height, name = '', value = 0, depth, root, group, color, fillOpacity: fo, filtroActivo }: PropsCelda) {
  if (depth === 0 || !width || !height || width < 4 || height < 4) return <g />;

  const groupName  = depth === 1 ? name : group;
  const cellColor  = color ?? '#8e8e93';
  const total      = root?.value ?? 1;
  const pct        = Math.round((value / total) * 100);
  const dimmed     = filtroActivo != null && groupName !== filtroActivo;

  if (depth === 1) {
    const label = width > 80 ? `${name}  ${pct}%` : name;
    return (
      <g style={{ cursor: 'pointer' }}>
        {/* Base oscura en los dos temas bajo los tickers translúcidos: sobre
            el blanco del tema claro las celdas livianas quedaban casi blancas
            y el ticker en blanco no se leía. Con la base, el texto blanco
            contrasta siempre, como en el mapa de calor de Bolsa. En oscuro la
            base es el mismo --card de antes. */}
        <rect x={x} y={y} width={width} height={height} fill="var(--mapa-base)" fillOpacity={dimmed ? 0.25 : 1} rx={6} />
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

  // Ticker. 0,72 em por carácter es el ancho de una mayúscula en seminegrita;
  // con 0,65 y sin margen, en celdas angostas (celular) el texto se recortaba
  // ("VWO" se leía "VWC"). Si ni a 8 px entra, no se dibuja: el tooltip lo nombra.
  const ANCHO_CARACTER = 0.72;
  const fontSize = Math.max(8, Math.min(12, (width - 6) / (name.length * ANCHO_CARACTER)));
  const entra = name.length * fontSize * ANCHO_CARACTER <= width - 4 && height > fontSize + 4;
  return (
    <g style={{ cursor: 'pointer' }}>
      <rect
        x={x + 1} y={y + 1} width={width - 2} height={height - 2}
        fill={cellColor} fillOpacity={dimmed ? 0.12 : (fo ?? 0.7)}
        stroke="var(--card)" strokeWidth={1.5}
        rx={4}
      />
      {entra && (
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

// recharts 3: el `content` del Tooltip recibe TooltipContentProps; Partial porque el
// elemento se crea sin esas props y recharts las inyecta al clonarlo.
type PropsTooltip = Partial<TooltipContentProps<number, string>> & { hideValues?: boolean; moneda?: Moneda };

function TooltipContent({ active, payload, hideValues, moneda }: PropsTooltip) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  return (
    <div style={{
      background: 'var(--material)', backdropFilter: 'saturate(180%) blur(20px)', WebkitBackdropFilter: 'saturate(180%) blur(20px)',
      border: '0.5px solid var(--material-borde)',
      borderRadius: 12, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
    }}>
      <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{d.name}</p>
      <p style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{formatMoney(d.value, { currency, hidden: hideValues })}</p>
      {d.group && <p style={{ color: d.color ?? 'var(--muted)', marginTop: 2, fontSize: 11 }}>{d.group}</p>}
    </div>
  );
}

export default function TreemapChart({ tenencias, dim, filtroTipo, onFiltroTipo, hideValues, moneda = 'USD' }: Props) {
  // Sector Geográfico solo aplica a renta variable
  const tenenciasFiltradas = dim === 'SECTOR_GEO'
    ? tenencias.filter(t => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE')
    : tenencias;

  const data = buildData(tenenciasFiltradas, dim, moneda);

  // El filtro activo es el del grupo seleccionado externamente (filtroTipo) cuando dim=TIPO,
  // o null para otras dims (los filtros cross-chart siguen siendo solo por TIPO por ahora)
  const filtroActivo = dim === 'TIPO' ? filtroTipo : null;

  function handleClick(node: { group?: string; name?: string }) {
    if (!onFiltroTipo || dim !== 'TIPO') return;
    const tipo = node?.group ?? node?.name;
    if (tipo) onFiltroTipo(tipo);
  }

  return (
    <div style={{
      background: 'var(--card)',
      border: filtroTipo ? '1px solid var(--primary)' : '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '12px 14px 10px',
      transition: 'border-color 0.15s',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
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
