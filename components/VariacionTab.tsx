'use client';

// Vista Variación de Tenencias: cuánto cambió cada categoría de la dimensión
// elegida contra el mes anterior.

import { useMemo } from 'react';
import type { TenenciaActual } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import {
  PALETA_TIPO, RIESGO_COLOR, RIESGO_LABEL, MONEDA_COLOR,
  RENTA_COLOR, GEO_COLOR, MONEDA_LABEL, RENTA_LABEL, GEO_LABEL,
  colorPorCategoria,
} from '@/lib/constants';

interface Props {
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  hideValues: boolean;
  moneda: Moneda;
  /** Mes base de la comparación (clave ordenable, ej. "2026-01"). */
  mesSel: string;
  /** Dimensión a mostrar: la del selector común de Tenencias. */
  dim: DimKey;
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

function DimChips({ rows, moneda, hideValues }: { rows: DimRow[]; moneda: Moneda; hideValues: boolean }) {
  // total del grupo para mapear el delta en la misma escala que pctAct
  const totalGrupo = rows.reduce((s, r) => s + r.actual, 0) || 1;

  // actual/anterior ya vienen en la moneda correcta (tenencia_ars o tenencia_usd
  // reales del Sheet, según corresponda) — acá solo se elige el formateador.
  const fmt = (n: number) => formatMoney(n, { currency: moneda, hidden: hideValues });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => {
        const delta    = r.actual - r.anterior;
        const deltaPct = r.anterior > 0 ? (delta / r.anterior) * 100 : 0;
        const varColor = delta >= 0 ? 'var(--up)' : 'var(--down)';
        const deltaPositivo = delta >= 0;
        // Los pp tienen su propio signo: una categoría puede ganar plata y perder
        // participación. Se redondea igual que el texto, para que "+0,0" no salga rojo.
        const deltaPp = r.pctAct - r.pctAnt;
        const ppColor = Math.round(deltaPp * 10) >= 0 ? 'var(--up)' : 'var(--down)';

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
                <span style={{ fontSize: 10, fontWeight: 600, color: ppColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(deltaPp, { pp: true })}
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
                cortaba ("+USD 47,00" se leía "7,00"). La posición es
                `clamp(0, centro − ancho/2, contenedor − ancho)`: dentro de
                `translateX` el `%` es el ancho de la propia etiqueta y `cqw` el
                del contenedor (por eso `containerType`), así que el navegador
                resuelve el clamp sin medir nada en JS. Un intento anterior con
                `left`/`right`/`margin:auto` descentraba: al clamparse un solo
                inset a 0 la caja dejaba de estar centrada en el segmento. */}
            <div style={{ position: 'relative', height: 16, marginTop: 3, overflowX: 'clip', containerType: 'inline-size' }}>
              <span style={{
                position: 'absolute',
                top: 0,
                left: 0,
                transform: `translateX(clamp(0px, ${labelAt}cqw - 50%, 100cqw - 100%))`,
                width: 'max-content',
                fontSize: 10, fontWeight: 700, color: varColor,
                whiteSpace: 'nowrap', lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
              }}>
                {formatMoney(delta, { currency: moneda, sign: true, hidden: hideValues })}{r.anterior > 0 ? ` (${formatPercent(deltaPct)})` : ''}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function VariacionTab({ tenenciasPorMes, hideValues, moneda, mesSel, dim }: Props) {
  const { hayAnterior, rows } = useMemo(
    () => calcVariacion(tenenciasPorMes, mesSel, dim, moneda),
    [tenenciasPorMes, mesSel, dim, moneda],
  );

  return (
    <div className="variacion-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0, paddingBottom: 24 }}>

      {/* ── Variación de la dimensión elegida ────────────────────────────────── */}
      {/* En el primer mes de la serie no hay contra qué comparar: sin este corte
          toda la posición se mostraba como ganancia del mes. */}
      {!hayAnterior ? (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          Es el primer mes de la serie: no hay un mes anterior para comparar.
        </p>
      ) : rows.length > 0 ? (
        <DimChips rows={rows} moneda={moneda} hideValues={hideValues} />
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
          No hay tenencias disponibles para este mes.
        </p>
      )}

    </div>
  );
}

// ── cálculo ───────────────────────────────────────────────────────────────────

function calcVariacion(
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  mesSel: string,
  dim: DimKey,
  moneda: Moneda,
): { hayAnterior: boolean; rows: DimRow[] } {
  const sorted = Object.keys(tenenciasPorMes).sort();
  const idxSel    = sorted.indexOf(mesSel);
  const idxActual = idxSel >= 0 ? idxSel : sorted.length - 1;
  const keyActual = sorted[idxActual];
  const keyAnt    = sorted[idxActual - 1];

  const mapAct = calcTotalDim(tenenciasPorMes[keyActual] ?? [], dim, moneda);
  const mapAnt = calcTotalDim(tenenciasPorMes[keyAnt]    ?? [], dim, moneda);
  const totalAct = Object.values(mapAct).reduce((s, v) => s + v, 0) || 1;
  const totalAnt = Object.values(mapAnt).reduce((s, v) => s + v, 0) || 1;
  const keys = Array.from(new Set([...Object.keys(mapAct), ...Object.keys(mapAnt)]));

  const rows = keys
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

  return { hayAnterior: keyAnt != null, rows };
}
