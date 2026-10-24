'use client';

import { useMemo } from 'react';
import type { ResumenRow, TenenciaActual } from '@/types';
import { fmtUSD, fmtARS, fmtPct, type Moneda } from '@/lib/parser';
import {
  PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, MONEDA_COLOR,
  RENTA_COLOR, GEO_COLOR, MONEDA_LABEL, RENTA_LABEL, GEO_LABEL,
  colorPorCategoria,
} from '@/lib/constants';
import {
  Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell,
} from 'recharts';

interface Props {
  resumenSeries: ResumenRow[];
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  mesesDisponibles: string[];
  totalPorMes: Record<string, number>;
  hideValues: boolean;
  moneda?: Moneda;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function signo(n: number) { return n >= 0 ? '▲' : '▼'; }

function VariacionBadge({ value, pct, fmt }: { value: number; pct: number; fmt: (n: number) => string }) {
  const color = value >= 0 ? 'var(--up)' : 'var(--down)';
  return (
    <span style={{ color, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
      {signo(value)} {fmt(Math.abs(value))} ({fmtPct(pct)})
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: 'var(--primary)',
      margin: 0, padding: '16px 0 8px',
      borderBottom: '1px solid var(--border)',
    }}>{children}</h3>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: '14px 18px',
      ...style,
    }}>{children}</div>
  );
}


// ── dimensiones ───────────────────────────────────────────────────────────────

type DimKey = 'TIPO' | 'RIESGO' | 'MONEDA' | 'RENTA' | 'SECTOR_GEO';

function getLabel(dim: DimKey, key: string): string {
  if (dim === 'RIESGO') return RIESGO_LABEL[Number(key)] ?? key;
  if (dim === 'MONEDA') return MONEDA_LABEL[key] ?? key;
  if (dim === 'RENTA')  return RENTA_LABEL[key]  ?? key;
  if (dim === 'SECTOR_GEO') return GEO_LABEL[key] ?? key;
  return key;
}

function getColor(dim: DimKey, key: string): string {
  if (dim === 'TIPO')   return PALETA_TIPO[key] ?? colorPorCategoria(key);
  if (dim === 'RIESGO') return RIESGO_COLOR[RIESGO_LABEL[Number(key)] ?? key] ?? colorPorCategoria(key);
  if (dim === 'MONEDA') return MONEDA_COLOR[key] ?? colorPorCategoria(key);
  if (dim === 'RENTA')  return RENTA_COLOR[key]  ?? colorPorCategoria(key);
  if (dim === 'SECTOR_GEO') return GEO_COLOR[key] ?? colorPorCategoria(key);
  return colorPorCategoria(key);
}

function calcTotalDim(items: TenenciaActual[], dim: DimKey, moneda: Moneda): Record<string, number> {
  // tenencia_ars/tenencia_usd ya vienen calculados desde el origen (Sheet) para
  // cada mes con su MEP de cierre real — no se recalculan acá.
  const campo = moneda === 'ARS' ? 'tenencia_ars' : 'tenencia_usd';
  const acc: Record<string, number> = {};
  const src = dim === 'SECTOR_GEO'
    ? items.filter(t => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE')
    : items;
  for (const t of src) {
    const k = String(t[dim]);
    acc[k] = (acc[k] ?? 0) + t[campo];
  }
  return acc;
}

// ── fila de variación por dimensión ──────────────────────────────────────────

interface DimRow {
  rawKey: string;
  label: string;
  color: string;
  anterior: number;
  actual: number;
  pctAnt: number;  // participación relativa mes anterior
  pctAct: number;  // participación relativa mes actual
}

function DimChips({ rows, totalAnterior: _, moneda }: { rows: DimRow[]; totalAnterior: number; moneda: Moneda }) {
  // total del grupo para mapear el delta en la misma escala que pctAct
  const totalGrupo = rows.reduce((s, r) => s + r.actual, 0) || 1;

  // actual/anterior ya vienen en la moneda correcta (tenencia_ars o tenencia_usd
  // reales del Sheet, según corresponda) — acá solo se elige el formateador.
  const fmt = moneda === 'ARS' ? fmtARS : fmtUSD;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => {
        const delta    = r.actual - r.anterior;
        const deltaPct = r.anterior > 0 ? (delta / r.anterior) * 100 : 0;
        const varColor = delta >= 0 ? 'var(--up)' : 'var(--down)';
        const deltaPositivo = delta >= 0;

        // barra base: participación actual sobre el total del grupo
        const wAct = Math.min(r.pctAct, 100);
        // variación en la misma escala: |delta| / totalGrupo * 100
        const wDelta = Math.min((Math.abs(delta) / totalGrupo) * 100, 100 - wAct);

        // centro del segmento semitransparente
        const wSegStart = r.anterior > 0
          ? (deltaPositivo ? wAct : Math.max(wAct - wDelta, 0))
          : 0;
        const wSegWidth = r.anterior > 0 ? wDelta : wAct;
        const labelAt   = Math.min(Math.max(wSegStart + wSegWidth / 2, 1), 98);

        return (
          <div key={r.rawKey} style={{
            background: `color-mix(in srgb, ${r.color} 6%, var(--card))`,
            border: `1px solid color-mix(in srgb, ${r.color} 20%, var(--border))`,
            borderRadius: 8,
            padding: '8px 14px 9px',
          }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: r.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-sec)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>{r.label}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1 }}>{fmt(r.actual)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-sec)', lineHeight: 1 }}>{r.pctAct.toFixed(1)}%</span>
              {r.anterior > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: delta >= 0 ? 'var(--up)' : 'var(--down)', lineHeight: 1 }}>
                  {(r.pctAct - r.pctAnt) >= 0 ? '+' : ''}{(r.pctAct - r.pctAnt).toFixed(1)}pp
                </span>
              )}
            </div>

            {/* barra única */}
            <div style={{ position: 'relative', height: 8, borderRadius: 4, overflow: 'hidden', background: `color-mix(in srgb, ${r.color} 8%, var(--border))` }}>
              {/* sólido: solo si hay anterior, hasta wAct menos el delta */}
              {r.anterior > 0 && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${deltaPositivo ? wAct : Math.max(wAct - wDelta, 0)}%`,
                  background: r.color,
                }} />
              )}
              {/* semitransparente verde: crecimiento pegado al extremo de la barra */}
              {deltaPositivo && wDelta > 0 && (
                <div style={{
                  position: 'absolute', left: `${r.anterior > 0 ? wAct : 0}%`, top: 0, height: '100%',
                  width: `${r.anterior > 0 ? wDelta : wAct}%`,
                  background: 'rgba(34,211,160,0.6)',
                }} />
              )}
              {/* semitransparente rojo: reducción al final de la barra */}
              {!deltaPositivo && wDelta > 0 && (
                <div style={{
                  position: 'absolute', left: `${Math.max(wAct - wDelta, 0)}%`, top: 0, height: '100%',
                  width: `${wDelta}%`,
                  background: 'rgba(244,63,94,0.6)',
                }} />
              )}
            </div>

            {/* etiqueta Δ debajo. `overflowX:'clip'`: la etiqueta se centra en
                `left:X%` con translateX(-50%), así que con la barra casi llena
                sobresalía por derecha y hacía crecer el scrollWidth del tab
                (barra horizontal en toda la pestaña). `clip` recorta sin crear
                un contexto de scroll. */}
            <div style={{ position: 'relative', height: 16, marginTop: 3, overflowX: 'clip' }}>
              <span style={{
                position: 'absolute',
                left: `${labelAt}%`, top: 0,
                transform: 'translateX(-50%)',
                fontSize: 10, fontWeight: 700, color: varColor,
                whiteSpace: 'nowrap', lineHeight: '16px',
              }}>
                {deltaPositivo ? '+' : ''}{fmt(delta)}{r.anterior > 0 ? ` (${deltaPositivo ? '+' : ''}${deltaPct.toFixed(1)}%)` : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function InformeTab({
  resumenSeries,
  tenenciasPorMes,
  mesesDisponibles,
  totalPorMes,
  hideValues,
  moneda = 'USD',
}: Props) {
  const puedeAnalizar = resumenSeries.length >= 2;

  const computed = useMemo(() => {
    if (!puedeAnalizar) return null;
    return computeInforme(resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes, moneda);
  }, [resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes, puedeAnalizar, moneda]);

  if (!puedeAnalizar || !computed) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)' }}>
        Se necesitan al menos 2 meses de datos para generar el informe.
      </div>
    );
  }

  const {
    cartAnterior,
    dimVariaciones,
  } = computed;

  const DIMS: { key: DimKey; label: string }[] = [
    { key: 'TIPO',       label: 'Tipo de Activo' },
    { key: 'RIESGO',     label: 'Nivel de Riesgo' },
    { key: 'MONEDA',     label: 'Moneda' },
    { key: 'RENTA',      label: 'Tipo de Renta' },
    { key: 'SECTOR_GEO', label: 'Geografía' },
  ];

  return (
    <div className="informe-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 0, flex: 1, minHeight: 0, paddingBottom: 24 }}>

      {/* ── Variación por dimensión ──────────────────────────────────────────── */}
      {DIMS.map(({ key, label }) => {
        const rows = dimVariaciones[key] ?? [];
        if (!rows.length) return null;
        return (
          <div key={key}>
            <SectionTitle>{label}</SectionTitle>
            <div style={{ marginTop: 10 }}>
              <DimChips rows={rows} totalAnterior={cartAnterior} moneda={moneda} />
            </div>
          </div>
        );
      })}

    </div>
  );
}

// ── cálculo ───────────────────────────────────────────────────────────────────

interface DimVariacionMap {
  TIPO: DimRow[];
  RIESGO: DimRow[];
  MONEDA: DimRow[];
  RENTA: DimRow[];
  SECTOR_GEO: DimRow[];
}

function computeInforme(
  resumenSeries: ResumenRow[],
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  mesesDisponibles: string[],
  totalPorMes: Record<string, number>,
  moneda: Moneda,
) {
  const sorted     = Object.keys(tenenciasPorMes).sort();
  const keyActual  = sorted[sorted.length - 1];
  const keyAnt     = sorted[sorted.length - 2];

  const tenActual  = tenenciasPorMes[keyActual] ?? [];
  const tenAnt     = tenenciasPorMes[keyAnt]    ?? [];

  // Totales de cartera
  const cartActual  = totalPorMes[keyActual] ?? 0;
  const cartAnterior = totalPorMes[keyAnt]   ?? 0;
  const deltaCartera = cartActual - cartAnterior;
  const pctCartera   = cartAnterior > 0 ? (deltaCartera / cartAnterior) * 100 : 0;

  // Aportes y rendimiento desde resumenSeries
  const rowActual  = resumenSeries[resumenSeries.length - 1];
  const rowAnt     = resumenSeries[resumenSeries.length - 2];
  const aportActual  = rowActual?.aportes    ?? 0;
  const aportAnterior = rowAnt?.aportes      ?? 0;
  const deltaAporte  = aportActual - aportAnterior;
  const rendActual   = rowActual?.rendimiento ?? 0;
  const rendAnterior = rowAnt?.rendimiento    ?? 0;
  const deltaRend    = rendActual - rendAnterior;

  // Ganancia pura: variación de cartera descontando aportes netos del mes
  const gananciaPura    = deltaCartera - aportActual;
  const pctGananciaPura = cartAnterior > 0 ? (gananciaPura / cartAnterior) * 100 : 0;

  // Labels de mes
  const mesActual  = mesesDisponibles[mesesDisponibles.length - 1] ?? keyActual;
  const mesAnterior = mesesDisponibles[mesesDisponibles.length - 2] ?? keyAnt;

  // Variación por dimensión con participación relativa
  const DIMS: DimKey[] = ['TIPO', 'RIESGO', 'MONEDA', 'RENTA', 'SECTOR_GEO'];
  const dimVariaciones = {} as DimVariacionMap;

  for (const dim of DIMS) {
    const mapAct = calcTotalDim(tenActual, dim, moneda);
    const mapAnt = calcTotalDim(tenAnt,    dim, moneda);
    const totalAct = Object.values(mapAct).reduce((s, v) => s + v, 0) || 1;
    const totalAnt = Object.values(mapAnt).reduce((s, v) => s + v, 0) || 1;
    const keys = Array.from(new Set([...Object.keys(mapAct), ...Object.keys(mapAnt)]));

    dimVariaciones[dim] = keys
      .map(k => ({
        rawKey:  k,
        label:   getLabel(dim, k),
        color:   getColor(dim, k),
        anterior: mapAnt[k] ?? 0,
        actual:   mapAct[k] ?? 0,
        pctAnt:  ((mapAnt[k] ?? 0) / totalAnt) * 100,
        pctAct:  ((mapAct[k] ?? 0) / totalAct) * 100,
      }))
      .sort((a, b) => b.actual - a.actual);
  }

  return {
    mesActual, mesAnterior,
    keyActual, keyAnt,
    cartActual, cartAnterior, deltaCartera, pctCartera,
    aportActual, aportAnterior, deltaAporte,
    gananciaPura, pctGananciaPura,
    rendActual, rendAnterior, deltaRend,
    dimVariaciones,
  };
}
