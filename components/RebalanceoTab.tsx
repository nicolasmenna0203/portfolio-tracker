'use client';

// Vista Rebalanceo de Tenencias: cuánto cambió cada categoría de la dimensión
// elegida contra el mes anterior, y a qué distancia está de su % objetivo.
//
// Antes eran dos vistas separadas (Variación y Objetivo) con las mismas
// categorías y la misma barra de participación; juntas se lee en una sola fila
// hacia dónde se movió cada categoría y hacia dónde se la quiere llevar. El
// objetivo es una marca sobre esa barra: las dos están en la misma escala (% de
// la cartera, o de la renta variable en Sector Geográfico). Los sliders se
// muestran solo en modo edición, para que la vista de lectura no sea un formulario.
//
// La carga y el guardado de los objetivos viven en `lib/useObjetivos.ts`; cómo
// se agrupa cada dimensión, en `lib/dimensiones.ts`, compartido con el hook y el
// MCP para que cada fila cruce con su objetivo.

import { useMemo, useState } from 'react';
import type { TenenciaActual } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import { useObjetivos, type ObjetivoDim } from '@/lib/useObjetivos';
import { sumarPorCategoria, type Dimension } from '@/lib/dimensiones';
import {
  PALETA_TIPO, RIESGO_COLOR, MONEDA_COLOR, RENTA_COLOR, GEO_COLOR,
  colorPorCategoria,
} from '@/lib/constants';
import { AvisoError, Vacio } from './Estados';

interface Props {
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  hideValues: boolean;
  moneda: Moneda;
  /** Mes base de la comparación (clave ordenable, ej. "2026-01"). */
  mesSel: string;
  /** Dimensión a mostrar: la del selector común de Tenencias. */
  dim: Dimension;
}

// ── colores ───────────────────────────────────────────────────────────────────

// Las filas se agrupan por etiqueta (`lib/dimensiones.ts`), y cada mapa de
// colores tiene también las etiquetas además de los códigos del Sheet.
const COLORES: Record<Dimension, Record<string, string>> = {
  TIPO: PALETA_TIPO, RIESGO: RIESGO_COLOR, MONEDA: MONEDA_COLOR, RENTA: RENTA_COLOR, SECTOR_GEO: GEO_COLOR,
};

function getColor(dim: Dimension, cat: string): string {
  return COLORES[dim][cat] ?? colorPorCategoria(cat);
}

// ── fila de variación por dimensión ──────────────────────────────────────────

interface DimRow {
  label: string;
  color: string;
  anterior: number;
  actual: number;
  pctAnt: number;  // participación relativa mes anterior
  pctAct: number;  // participación relativa mes actual
}

interface ChipsProps {
  rows: DimRow[];
  moneda: Moneda;
  hideValues: boolean;
  /** Sin mes anterior (primer mes de la serie) no se muestra ninguna variación. */
  hayAnterior: boolean;
  /** `null` mientras los objetivos no cargaron: no se dibuja marca ni slider. */
  objetivos: ObjetivoDim | null;
  editando: boolean;
  onObjetivo: (cat: string, val: number) => void;
}

function DimChips({ rows, moneda, hideValues, hayAnterior, objetivos, editando, onObjetivo }: ChipsProps) {
  // total del grupo para mapear el delta en la misma escala que pctAct
  const totalGrupo = rows.reduce((s, r) => s + r.actual, 0) || 1;

  // actual/anterior ya vienen en la moneda correcta (tenencia_ars o tenencia_usd
  // reales del Sheet, según corresponda) — acá solo se elige el formateador.
  const fmt = (n: number) => formatMoney(n, { currency: moneda, hidden: hideValues });

  return (
    <div className="card reb-lista">
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
        const wDelta = hayAnterior ? Math.min((Math.abs(delta) / totalGrupo) * 100, 100 - wAct) : 0;

        // centro del segmento semitransparente
        const wSegStart = r.anterior > 0
          ? (deltaPositivo ? wAct : Math.max(wAct - wDelta, 0))
          : 0;
        const wSegWidth = r.anterior > 0 ? wDelta : wAct;
        const labelAt   = Math.min(Math.max(wSegStart + wSegWidth / 2, 1), 98);

        // objetivo: misma escala que la barra (% del grupo)
        const pctObj = objetivos?.[r.label] ?? 0;
        const tieneObjetivo = objetivos != null && pctObj > 0;
        const diffObj = r.pctAct - pctObj;
        const enRango = Math.abs(diffObj) <= 3;
        const diffColor = enRango ? 'var(--up)' : Math.abs(diffObj) <= 8 ? 'var(--warn)' : 'var(--down)';

        return (
          <div key={r.label} className="reb-fila">
            {/* header: categoría y variación a la izquierda, objetivo a la derecha */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, rowGap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: r.color, flexShrink: 0, alignSelf: 'center' }} />
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>{r.label}</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-display)' }}>{fmt(r.actual)}</span>
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{formatPercent(r.pctAct, { sign: false })}</span>
              {hayAnterior && r.anterior > 0 && (
                <span style={{ fontSize: 12, fontWeight: 600, color: ppColor, fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(deltaPp, { pp: true })}
                </span>
              )}
              {objetivos != null && (
                <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  Objetivo <strong style={{ fontWeight: 600, color: tieneObjetivo ? 'var(--text)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                    {tieneObjetivo ? formatPercent(pctObj, { sign: false, decimals: 0 }) : '—'}
                  </strong>
                  {tieneObjetivo && (
                    <span style={{
                      fontSize: 12, fontWeight: 600, color: diffColor,
                      background: enRango ? 'var(--up-dim)' : Math.abs(diffObj) <= 8 ? 'var(--warn-dim)' : 'var(--down-dim)',
                      padding: '2px 7px', borderRadius: 6,
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {enRango ? 'En rango' : formatPercent(diffObj, { pp: true })}
                    </span>
                  )}
                </span>
              )}
            </div>

            {/* barra única */}
            <div style={{ position: 'relative', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--track)' }}>
              {/* sólido: hasta wAct menos el delta (sin mes anterior, toda la barra) */}
              {(r.anterior > 0 || !hayAnterior) && (
                <div style={{
                  position: 'absolute', left: 0, top: 0, height: '100%',
                  width: `${deltaPositivo ? wAct : Math.max(wAct - wDelta, 0)}%`,
                  background: r.color,
                }} />
              )}
              {/* semitransparente verde: crecimiento pegado al extremo de la barra */}
              {hayAnterior && deltaPositivo && wSegWidth > 0 && (
                <div style={{
                  position: 'absolute', left: `${r.anterior > 0 ? wAct : 0}%`, top: 0, height: '100%',
                  width: `${wSegWidth}%`,
                  background: 'color-mix(in srgb, var(--up) 65%, transparent)',
                }} />
              )}
              {/* semitransparente rojo: reducción al final de la barra */}
              {hayAnterior && !deltaPositivo && wDelta > 0 && (
                <div style={{
                  position: 'absolute', left: `${Math.max(wAct - wDelta, 0)}%`, top: 0, height: '100%',
                  width: `${wDelta}%`,
                  background: 'color-mix(in srgb, var(--down) 65%, transparent)',
                }} />
              )}
              {/* marca del objetivo: línea vertical sobre la barra */}
              {tieneObjetivo && (
                <div style={{
                  position: 'absolute', left: `${Math.min(99, pctObj)}%`, top: 0, bottom: 0,
                  width: 2, background: 'var(--text)', opacity: 0.7,
                  transform: 'translateX(-50%)',
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
            {hayAnterior && (
              <div style={{ position: 'relative', height: 16, marginTop: 5, overflowX: 'clip', containerType: 'inline-size' }}>
                <span style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  transform: `translateX(clamp(0px, ${labelAt}cqw - 50%, 100cqw - 100%))`,
                  width: 'max-content',
                  fontSize: 12, fontWeight: 500, color: varColor,
                  whiteSpace: 'nowrap', lineHeight: '16px', fontVariantNumeric: 'tabular-nums',
                }}>
                  {formatMoney(delta, { currency: moneda, sign: true, hidden: hideValues })}{r.anterior > 0 ? ` (${formatPercent(deltaPct)})` : ''}
                </span>
              </div>
            )}

            {editando && objetivos != null && (
              <input
                type="range" min={0} max={100} step={1}
                value={pctObj}
                onChange={e => onObjetivo(r.label, Number(e.target.value))}
                aria-label={`Objetivo de ${r.label}`}
                style={{ width: '100%', marginTop: 6, accentColor: r.color }}
                className="slider-cat"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function RebalanceoTab({ tenenciasPorMes, hideValues, moneda, mesSel, dim }: Props) {
  const { hayAnterior, rows } = useMemo(
    () => calcVariacion(tenenciasPorMes, mesSel, dim, moneda),
    [tenenciasPorMes, mesSel, dim, moneda],
  );

  const { objetivosPorDim, setObjetivo, estado, errorCarga, reintentar } =
    useObjetivos(tenenciasPorMes[mesSel] ?? []);
  const [editando, setEditando] = useState(false);

  const objetivos = objetivosPorDim?.[dim] ?? null;
  const suma  = Object.values(objetivos ?? {}).reduce((s, v) => s + v, 0);
  const resta = Math.max(0, 100 - suma);
  const sumaColor = suma > 100 ? 'var(--down)' : suma === 100 ? 'var(--up)' : 'var(--muted)';

  return (
    <div className="rebalanceo-root" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Objetivos: edición y estado del guardado ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={`g-btn chico${editando ? ' primario' : ' tintado'}`}
          onClick={() => setEditando(e => !e)}
          disabled={!objetivosPorDim}
          aria-pressed={editando}
        >
          {editando ? 'Listo' : 'Editar objetivos'}
        </button>
        {objetivosPorDim && (
          <span style={{ fontSize: 13, fontWeight: 500, color: sumaColor, fontVariantNumeric: 'tabular-nums' }}>
            {suma > 100
              ? `Los objetivos se pasan ${formatPercent(suma - 100, { sign: false, decimals: 0 })} del 100%`
              : suma === 100
              ? 'Los objetivos suman 100%'
              : `Queda ${formatPercent(resta, { sign: false, decimals: 0 })} sin asignar`}
          </span>
        )}
        {estado !== 'inicial' && (
          <span role="status" style={{ fontSize: 13, color: estado === 'error' ? 'var(--down)' : 'var(--muted)' }}>
            {estado === 'guardando' ? 'Guardando…'
              : estado === 'guardado' ? 'Guardado'
              : 'No se pudo guardar'}
          </span>
        )}
      </div>

      {errorCarga && (
        <AvisoError titulo="No se pudieron leer los objetivos" onReintentar={reintentar}>
          La edición queda desactivada para no pisar lo que hay en el Sheet.
        </AvisoError>
      )}

      {/* En el primer mes de la serie no hay contra qué comparar: sin este corte
          toda la posición se mostraba como ganancia del mes. Las filas se
          muestran igual, sin variación, porque los objetivos sí aplican. */}
      {!hayAnterior && rows.length > 0 && (
        <p className="nota">
          Es el primer mes de la serie: no hay un mes anterior para comparar.
        </p>
      )}

      {rows.length > 0 ? (
        <DimChips
          rows={rows}
          moneda={moneda}
          hideValues={hideValues}
          hayAnterior={hayAnterior}
          objetivos={objetivos}
          editando={editando}
          onObjetivo={(cat, val) => setObjetivo(dim, cat, val)}
        />
      ) : (
        <Vacio>No hay tenencias cargadas para este mes.</Vacio>
      )}

    </div>
  );
}

// ── cálculo ───────────────────────────────────────────────────────────────────

function calcVariacion(
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  mesSel: string,
  dim: Dimension,
  moneda: Moneda,
): { hayAnterior: boolean; rows: DimRow[] } {
  const sorted = Object.keys(tenenciasPorMes).sort();
  const idxSel    = sorted.indexOf(mesSel);
  const idxActual = idxSel >= 0 ? idxSel : sorted.length - 1;
  const keyActual = sorted[idxActual];
  const keyAnt    = sorted[idxActual - 1];

  // tenencia_ars/tenencia_usd ya vienen calculados desde el origen (Sheet) para
  // cada mes con su MEP de cierre real — no se recalculan acá.
  const campo = moneda === 'ARS' ? 'tenencia_ars' : 'tenencia_usd';
  const mapAct = sumarPorCategoria(tenenciasPorMes[keyActual] ?? [], dim, campo);
  const mapAnt = sumarPorCategoria(tenenciasPorMes[keyAnt]    ?? [], dim, campo);
  const totalAct = Object.values(mapAct).reduce((s, v) => s + v, 0) || 1;
  const totalAnt = Object.values(mapAnt).reduce((s, v) => s + v, 0) || 1;
  const keys = Array.from(new Set([...Object.keys(mapAct), ...Object.keys(mapAnt)]));

  const rows = keys
    .map(k => ({
      label:   k,
      color:   getColor(dim, k),
      anterior: mapAnt[k] ?? 0,
      actual:   mapAct[k] ?? 0,
      pctAnt:  ((mapAnt[k] ?? 0) / totalAnt) * 100,
      pctAct:  ((mapAct[k] ?? 0) / totalAct) * 100,
    }))
    .sort((a, b) => b.actual - a.actual);

  return { hayAnterior: keyAnt != null, rows };
}
