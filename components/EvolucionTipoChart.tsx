'use client';

import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { TenenciaActual } from '@/types';
import { PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL, MONEDA_COLOR, RENTA_COLOR, GEO_COLOR, colorPorCategoria } from '@/lib/constants';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import Segmented from './Segmented';

interface Props {
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  mesesDisponibles: string[];
  dim: Dim;
  mesSel?: string;
  onMesClick?: (fecha: string) => void;
  hideValues?: boolean;
  moneda?: Moneda;
}

const DIMS = [
  { key: 'TIPO',       label: 'Tipo de Activo'      },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'     },
  { key: 'MONEDA',     label: 'Tipo de Moneda'      },
  { key: 'RENTA',      label: 'Tipo de Renta'       },
  { key: 'SECTOR_GEO', label: 'Sector Geográfico'   },
] as const;

type Dim  = typeof DIMS[number]['key'];
type Mode = 'nominal' | 'pct';

function getGroupLabel(r: TenenciaActual, dim: Dim): string {
  switch (dim) {
    case 'RIESGO':     return RIESGO_LABEL[r.RIESGO]     ?? 'Sin dato';
    case 'RENTA':      return RENTA_LABEL[r.RENTA]       ?? r.RENTA      ?? 'Sin dato';
    case 'SECTOR_GEO': return GEO_LABEL[r.SECTOR_GEO]   ?? r.SECTOR_GEO ?? 'Sin dato';
    case 'MONEDA':     return MONEDA_LABEL[r.MONEDA]     ?? r.MONEDA     ?? 'Sin dato';
    default:           return r.TIPO ?? 'Sin dato';
  }
}

function getColor(group: string, dim: Dim): string {
  if (dim === 'TIPO')       return PALETA_TIPO[group]   ?? colorPorCategoria(group);
  if (dim === 'RIESGO')     return RIESGO_COLOR[group]  ?? colorPorCategoria(group);
  if (dim === 'MONEDA')     return MONEDA_COLOR[group]  ?? colorPorCategoria(group);
  if (dim === 'RENTA')      return RENTA_COLOR[group]   ?? colorPorCategoria(group);
  if (dim === 'SECTOR_GEO') return GEO_COLOR[group]     ?? colorPorCategoria(group);
  return colorPorCategoria(group);
}

function buildData(
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  mesesDisponibles: string[],
  dim: Dim,
  groups: string[],
  moneda: Moneda,
) {
  // tenencia_ars/tenencia_usd ya vienen calculados desde el origen (Sheet) para
  // cada mes con su MEP de cierre real — no se recalculan acá.
  const campo = moneda === 'ARS' ? 'tenencia_ars' : 'tenencia_usd';
  const sortedKeys = Object.keys(tenenciasPorMes).sort();
  return sortedKeys.map((key, i) => {
    const allRows = tenenciasPorMes[key] ?? [];
    const rows = dim === 'SECTOR_GEO'
      ? allRows.filter(r => r.RENTA === 'VAR' || r.RENTA === 'VARIABLE')
      : allRows;
    const entry: Record<string, string | number> = { fecha: mesesDisponibles[i] ?? key };
    for (const g of groups) {
      entry[g] = rows
        .filter((r) => getGroupLabel(r, dim) === g)
        .reduce((s, r) => s + r[campo], 0);
    }
    return entry;
  });
}

type PropsTooltip = TooltipProps<number, string> & { mode?: Mode; hideValues?: boolean; moneda?: Moneda };

function TooltipContent({ active, payload, label, mode, hideValues, moneda }: PropsTooltip) {
  if (!active || !payload?.length) return null;

  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  const nominalTotal = payload.reduce((s, p) => s + (p.value ?? 0), 0);
  const rows = [...payload].reverse().filter((p) => (p.value ?? 0) > 0);

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      minWidth: 160,
    }}>
      <p style={{ fontWeight: 600, color: 'var(--text-sec)', marginBottom: 6, fontSize: 11 }}>{label}</p>
      {mode === 'nominal' && (
        <p style={{ color: 'var(--muted)', marginBottom: 6, fontSize: 11 }}>
          Total: {formatMoney(nominalTotal, { currency, hidden: hideValues })}
        </p>
      )}
      {rows.map((p) => {
        const pct = nominalTotal > 0 ? ((p.value ?? 0) / nominalTotal) * 100 : 0;
        const display = (mode === 'pct' || hideValues)
          ? formatPercent(pct, { sign: false })
          : `${formatMoney(p.value, { currency })} · ${formatPercent(pct, { sign: false })}`;
        return (
          <p key={p.dataKey} style={{ color: p.color, marginBottom: 2, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: 'var(--muted)', marginRight: 6 }}>{p.name}:</span>
            {display}
          </p>
        );
      })}
    </div>
  );
}

export default function EvolucionTipoChart({ tenenciasPorMes, mesesDisponibles, dim, mesSel, onMesClick, hideValues, moneda = 'USD' }: Props) {
  const [mode, setMode] = useState<Mode>('nominal');
  const isMobile = useIsMobile();

  // Memo: arrastrar el selector de mes re-renderiza por cada paso y la serie no
  // depende del mes elegido; recorrer todo el histórico en cada uno es gratuito.
  const { groups, data } = useMemo(() => {
    const groupsSet = new Set<string>();
    for (const rows of Object.values(tenenciasPorMes)) {
      const src = dim === 'SECTOR_GEO'
        ? rows.filter(r => r.RENTA === 'VAR' || r.RENTA === 'VARIABLE')
        : rows;
      for (const r of src) groupsSet.add(getGroupLabel(r, dim));
    }
    const groups = Array.from(groupsSet).sort();
    return { groups, data: buildData(tenenciasPorMes, mesesDisponibles, dim, groups, moneda) };
  }, [tenenciasPorMes, mesesDisponibles, dim, moneda]);

  const yFormatter = mode === 'pct'
    ? (v: number) => formatPercent(v * 100, { sign: false, decimals: 0 })
    : (v: number) => formatMoney(v, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'compact', compactShort: isMobile, hidden: hideValues });

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '14px 16px 8px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header + controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-sec)', margin: 0, flexShrink: 0 }}>
          Evolución · {DIMS.find(d => d.key === dim)?.label ?? dim}
        </p>

        {/* Toggle moneda / % */}
        <Segmented
          opciones={[{ id: 'nominal' as Mode, label: moneda }, { id: 'pct' as Mode, label: '%' }]}
          activa={mode}
          onChange={setMode}
          chico
          etiqueta="Unidad"
        />
      </div>

      <div style={{ flex: 1, minHeight: 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          stackOffset={mode === 'pct' ? 'expand' : 'none'}
          margin={{ top: 4, right: 10, left: 10, bottom: 0 }}
          onClick={onMesClick ? (e) => { if (e?.activeLabel) onMesClick(e.activeLabel); } : undefined}
          style={{ cursor: onMesClick ? 'pointer' : 'default' }}
        >
          <defs>
            {groups.map((g) => (
              <linearGradient key={g} id={`gradG-${g}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={getColor(g, dim)} stopOpacity={0.45} />
                <stop offset="95%" stopColor={getColor(g, dim)} stopOpacity={0.05} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="fecha"
            tick={{ fill: 'var(--muted)', fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={yFormatter}
            tick={{ fill: 'var(--muted)', fontSize: isMobile ? 9 : 11 }}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 40 : 52}
            domain={mode === 'pct' ? [0, 1] : undefined}
          />
          <Tooltip content={<TooltipContent mode={mode} hideValues={hideValues} moneda={moneda} />} />
          {mesSel && (
            <ReferenceLine
              x={mesSel}
              stroke="var(--primary)"
              strokeWidth={1.5}
              strokeDasharray="3 4"
              label={{ value: mesSel, fill: 'var(--primary)', fontSize: 10, position: 'insideTopRight' }}
            />
          )}
          <Legend
            iconType="circle"
            iconSize={7}
            wrapperStyle={{ color: 'var(--text-sec)', fontSize: 11, paddingTop: 10 }}
          />
          {groups.map((g) => (
            <Area
              key={g}
              type="monotone"
              dataKey={g}
              name={g}
              stackId="1"
              stroke={getColor(g, dim)}
              strokeWidth={1.5}
              fill={`url(#gradG-${g})`}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
