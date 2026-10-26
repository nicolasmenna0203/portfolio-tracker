'use client';

import { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { ResumenRow, TenenciaActual } from '@/types';
import { formatMoney, type Moneda } from '@/lib/format';

interface Props {
  data: ResumenRow[];
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  hideValues?: boolean;
  moneda?: Moneda;
}

function buildData(
  data: ResumenRow[],
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  moneda: Moneda,
) {
  return data.map((row, i) => {
    const d = new Date(row.fechaTs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    // total_cartera_ars, acumulado_ars y aportes_ars ya vienen calculados desde el
    // origen (Sheet) — cada movimiento convertido al MEP de su propio día, no un
    // MEP de cierre de mes aplicado al total. No se recalcula nada acá.
    const totalCartera = moneda === 'ARS' ? row.total_cartera_ars : row.total_cartera;
    const acumulado = moneda === 'ARS' ? row.acumulado_ars : row.acumulado;
    const aportes = moneda === 'ARS' ? row.aportes_ars : row.aportes;

    const prevRow = i > 0 ? data[i - 1] : null;
    const prevTotalCartera = prevRow != null ? (moneda === 'ARS' ? prevRow.total_cartera_ars : prevRow.total_cartera) : null;
    const ganancia = prevTotalCartera !== null
      ? (totalCartera - prevTotalCartera) - aportes
      : null;

    return {
      ...row,
      total_cartera: totalCartera,
      acumulado,
      aportes,
      activos: tenenciasPorMes[key]?.length ?? null,
      ganancia,
    };
  });
}

function TooltipContent({ active, payload, label, hideValues, moneda }: any) {
  if (!active || !payload?.length) return null;

  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  const ORDER = ['total_cartera', 'acumulado', 'ganancia', 'activos'];
  const sorted = [...payload].sort(
    (a, b) => ORDER.indexOf(a.dataKey) - ORDER.indexOf(b.dataKey)
  );

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      minWidth: 160,
    }}>
      <p style={{ fontWeight: 600, color: 'var(--text-sec)', marginBottom: 8, fontSize: 11 }}>{label}</p>
      {sorted.map((p: any) => {
        if (p.value === null || p.value === undefined) return null;
        let display: string;
        let color = p.color;
        if (p.dataKey === 'activos') {
          display = `${p.value} activos`;
        } else if (p.dataKey === 'ganancia') {
          const isPos = p.value >= 0;
          color = isPos ? 'var(--up)' : 'var(--down)';
          display = formatMoney(p.value, { currency, sign: true, hidden: hideValues });
        } else {
          display = formatMoney(p.value, { currency, hidden: hideValues });
        }
        return (
          <p key={p.dataKey} style={{ color, marginBottom: 3, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span style={{ color: 'var(--muted)' }}>{p.name}</span>
            <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{display}</span>
          </p>
        );
      })}
    </div>
  );
}

export default function EvolucionChart({ data, tenenciasPorMes, hideValues, moneda = 'USD' }: Props) {
  const chartData = buildData(data, tenenciasPorMes, moneda);
  const [isMobile, setIsMobile] = useState(false);


  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 16px 8px',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexShrink: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-sec)', margin: 0 }}>
          Evolución de la Cartera
        </p>
        <span style={{ fontSize: 10, color: 'var(--muted)' }}>
          Barras = ganancia pura mensual · Áreas = cartera y aportes
        </span>
      </div>
      <div style={{ flex: 1, minHeight: isMobile ? 0 : 220 }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={chartData}
          margin={{ top: 5, right: isMobile ? 8 : 45, left: isMobile ? 0 : 10, bottom: 0 }}
        >
          <defs>
            <linearGradient id="gradCartera" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#cfab6e" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#cfab6e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradAportes" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#6a9bab" stopOpacity={0.16} />
              <stop offset="95%" stopColor="#6a9bab" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="fecha"
            tick={{ fill: 'var(--muted)', fontSize: isMobile ? 9 : 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="usd"
            tickFormatter={(v) => formatMoney(v, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'compact', hidden: hideValues })}
            tick={{ fill: 'var(--muted)', fontSize: isMobile ? 9 : 11 }}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 38 : 52}
          />
          <YAxis
            yAxisId="gan"
            orientation="left"
            domain={([min, max]: [number, number]) => {
              const absMax = Math.max(Math.abs(min), Math.abs(max), 1);
              const usdMax = Math.max(...chartData.map(d => d.total_cartera));
              return [-absMax, usdMax];
            }}
            hide={true}
          />
          <YAxis
            yAxisId="cnt"
            orientation="right"
            tickFormatter={(v) => String(Math.round(v))}
            tick={{ fill: 'var(--muted)', fontSize: isMobile ? 9 : 11 }}
            tickLine={false}
            axisLine={false}
            width={isMobile ? 22 : 32}
            allowDecimals={false}
          />
          <Tooltip content={<TooltipContent hideValues={hideValues} moneda={moneda} />} />
          <Legend
            iconType="plainline"
            iconSize={16}
            wrapperStyle={{ color: 'var(--text-sec)', fontSize: isMobile ? 10 : 11, paddingTop: 10 }}
          />
          <Bar
            yAxisId="gan"
            dataKey="ganancia"
            name="Ganancia pura"
            maxBarSize={isMobile ? 14 : 20}
            radius={[3, 3, 0, 0]}
          >
            {chartData.map((entry, i) => (
              <Cell
                key={i}
                fill={(entry.ganancia ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'}
                fillOpacity={0.75}
              />
            ))}
          </Bar>
          <Area
            yAxisId="usd"
            type="monotone"
            dataKey="total_cartera"
            name="Total Cartera"
            stroke="#cfab6e"
            strokeWidth={2.5}
            fill="url(#gradCartera)"
            dot={false}
            activeDot={{ r: 5, fill: '#cfab6e', strokeWidth: 0 }}
          />
          <Area
            yAxisId="usd"
            type="monotone"
            dataKey="acumulado"
            name="Aportes Acumulados"
            stroke="#6a9bab"
            strokeWidth={2}
            fill="url(#gradAportes)"
            dot={false}
            activeDot={{ r: 5, fill: '#6a9bab', strokeWidth: 0 }}
          />
          <Line
            yAxisId="cnt"
            type="monotone"
            dataKey="activos"
            name="Activos"
            stroke="#a89b87"
            strokeWidth={1.5}
            strokeDasharray="3 5"
            dot={false}
            activeDot={{ r: 4, fill: '#a89b87', strokeWidth: 0 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
