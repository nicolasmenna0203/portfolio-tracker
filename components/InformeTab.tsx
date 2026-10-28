'use client';

import { useMemo } from 'react';
import type { ResumenRow, TenenciaActual } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
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
  /** Mes base de la comparación (clave ordenable, ej. "2026-01"). Default: el último mes disponible. */
  mesSel?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function signo(n: number) { return n >= 0 ? '▲' : '▼'; }

function VariacionBadge({ value, pct, fmt }: { value: number; pct: number; fmt: (n: number) => string }) {
  const color = value >= 0 ? 'var(--up)' : 'var(--down)';
  return (
    <span style={{ color, fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {signo(value)} {fmt(Math.abs(value))} ({formatPercent(pct)})
    </span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
      textTransform: 'uppercase', color: 'var(--primary)',
      /* Sin padding-top: el aire sobre cada título lo da el `gap` de 12px del
         root, igual que en el resto de las pestañas. Con los 16px de antes el
         primer título quedaba a 50px del tope y la pestaña arrancaba más
         abajo que todas las demás. */
      margin: 0, padding: '0 0 8px',
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
  const fmt = (n: number) => formatMoney(n, { currency: moneda });

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
              <span style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{fmt(r.actual)}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-sec)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{formatPercent(r.pctAct, { sign: false })}</span>
              {r.anterior > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, color: delta >= 0 ? 'var(--up)' : 'var(--down)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(r.pctAct - r.pctAnt, { pp: true })}
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

            {/* etiqueta Δ debajo, centrada sobre el segmento de variación.
                `overflowX:'clip'`: con la barra casi llena la etiqueta sobresalía
                por derecha y hacía crecer el scrollWidth del tab (barra
                horizontal en toda la pestaña); `clip` recorta sin crear un
                contexto de scroll.

                El centrado tampoco puede ser `translateX(-50%)` a secas: en un
                grupo chico el segmento arranca cerca de 0% y la mitad izquierda
                de la etiqueta caía fuera del contenedor, donde `clip` la
                cortaba ("+USD 47,00" se leía "7,00"). En vez de posicionar por
                `left`, se usan los tres insets a la vez: `left`/`right` marcan
                el centro deseado y `margin:auto` centra la etiqueta en ese
                punto, pero sin dejar que ningún borde salga del contenedor
                —así el navegador la empuja hacia adentro sola en los extremos—.
                `width:max-content` evita que se comprima al hacerlo, y el
                `50vw` de los insets es solo un valor grande: alcanza para que
                el centrado por `margin:auto` mande salvo contra los bordes. */}
            <div style={{ position: 'relative', height: 16, marginTop: 3, overflowX: 'clip' }}>
              <span style={{
                position: 'absolute',
                top: 0,
                left: `max(0%, ${labelAt}% - 50vw)`,
                right: `max(0%, ${100 - labelAt}% - 50vw)`,
                marginInline: 'auto',
                width: 'max-content', maxWidth: '100%',
                textAlign: 'center',
                fontSize: 10, fontWeight: 700, color: varColor,
                whiteSpace: 'nowrap', lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatMoney(delta, { currency: moneda, sign: true })}{r.anterior > 0 ? ` (${formatPercent(deltaPct)})` : ''}
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
  mesSel,
}: Props) {
  const puedeAnalizar = resumenSeries.length >= 2;

  const computed = useMemo(() => {
    if (!puedeAnalizar) return null;
    return computeInforme(resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes, moneda, mesSel);
  }, [resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes, puedeAnalizar, moneda, mesSel]);

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
    <div className="informe-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, paddingBottom: 24 }}>

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
  mesSel?: string,
) {
  const sorted = Object.keys(tenenciasPorMes).sort();
  // `mesSel` es la clave ordenable del mes elegido en Tenencias (MonthSlider).
  // Sin selección (uso histórico de InformeTab) se compara el último mes
  // disponible contra el anterior.
  const idxSel    = mesSel != null ? sorted.indexOf(mesSel) : sorted.length - 1;
  const idxActual = idxSel >= 0 ? idxSel : sorted.length - 1;
  const keyActual = sorted[idxActual];
  const keyAnt    = sorted[idxActual - 1];

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
