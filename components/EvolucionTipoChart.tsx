'use client';

import { useState } from 'react';
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
import type { TenenciaActual } from '@/types';
import { PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL, MONEDA_COLOR, RENTA_COLOR, GEO_COLOR, colorPorCategoria } from '@/lib/constants';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';

interface Props {
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  mesesDisponibles: string[];
  dim?: Dim;
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
    const entry: Record<string, any> = { fecha: mesesDisponibles[i] ?? key };
    for (const g of groups) {
      entry[g] = rows
        .filter((r) => getGroupLabel(r, dim) === g)
        .reduce((s, r) => s + r[campo], 0);
    }
    return entry;
  });
}

function TooltipContent({ active, payload, label, mode, hideValues, moneda }: any) {
  if (!active || !payload?.length) return null;

  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  const nominalTotal = payload.reduce((s: number, p: any) => s + (p.value ?? 0), 0);
  const rows = [...payload].reverse().filter((p: any) => (p.value ?? 0) > 0);

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
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
      {rows.map((p: any) => {
        const pct = nominalTotal > 0 ? (p.value / nominalTotal) * 100 : 0;
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

export default function EvolucionTipoChart({ tenenciasPorMes, mesesDisponibles, dim: dimProp, mesSel, onMesClick, hideValues, moneda = 'USD' }: Props) {
  const [dimLocal, setDimLocal] = useState<Dim>('TIPO');
  const dim = dimProp ?? dimLocal;
  const [mode, setMode] = useState<Mode>('nominal');
  const isMobile = useIsMobile();

  const groupsSet = new Set<string>();
  for (const rows of Object.values(tenenciasPorMes)) {
    const src = dim === 'SECTOR_GEO'
      ? rows.filter(r => r.RENTA === 'VAR' || r.RENTA === 'VARIABLE')
      : rows;
    for (const r of src) groupsSet.add(getGroupLabel(r, dim));
  }
  const groups = Array.from(groupsSet).sort();
  const data   = buildData(tenenciasPorMes, mesesDisponibles, dim, groups, moneda);

  const yFormatter = mode === 'pct'
    ? (v: number) => formatPercent(v * 100, { sign: false, decimals: 0 })
    : (v: number) => formatMoney(v, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'compact', compactShort: isMobile, hidden: hideValues });

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px 8px',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header + controles */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexShrink: 0, flexWrap: 'wrap' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-sec)', margin: 0, flexShrink: 0 }}>
          {dimProp
            ? `Evolución · ${DIMS.find(d => d.key === dimProp)?.label ?? dimProp}`
            : 'Evolución por'}
        </p>

        {/* Tabs de dimensión — solo si no viene controlado externamente */}
        {!dimProp && (
          <div style={{ display: 'flex', gap: 3, flex: 1, minWidth: 0, flexWrap: 'wrap' }}>
            {DIMS.map((d) => (
              <button
                key={d.key}
                onClick={() => setDimLocal(d.key)}
                style={{
                  padding: '3px 10px',
                  borderRadius: 20,
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: dim === d.key ? 'var(--primary)' : 'var(--border)',
                  background: dim === d.key ? 'var(--primary-dim)' : 'transparent',
                  color: dim === d.key ? 'var(--primary)' : 'var(--muted)',
                  transition: 'all 0.12s',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        {/* Toggle USD / % */}
        <div style={{
          display: 'flex',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          {(['nominal', 'pct'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className="modo-toggle-btn"
              aria-pressed={mode === m}
              style={{
                padding: '3px 12px',
                fontSize: 11,
                fontWeight: 500,
                cursor: 'pointer',
                border: 'none',
                outline: 'none',
                background: mode === m ? 'var(--primary)' : 'transparent',
                color: mode === m ? '#000' : 'var(--muted)',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {m === 'nominal' ? 'USD' : '%'}
            </button>
          ))}
        </div>
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
          <Tooltip content={(props) => <TooltipContent {...props} mode={mode} hideValues={hideValues} moneda={moneda} />} />
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
