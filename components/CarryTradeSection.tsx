'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Scatter, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
} from 'recharts';
import type { CarryTradeItem } from '@/types';
import { usePerformance } from '@/lib/usePerformance';
import { calcularCarryTrade, techoBandaEnFecha } from '@/lib/carryTrade';
import { formatMesLabel } from '@/lib/parser';
import { formatMoney, formatPercent, formatFx } from '@/lib/format';
import Segmented from './Segmented';
import ThOrden from './ThOrden';
import { Cargando, AvisoError, Vacio } from './Estados';

interface Props {
  tenencias: Record<string, number>;
}

function fmtPct1(v: number): string {
  return formatPercent(v * 100, { sign: false });
}

function fmtPct2(v: number): string {
  return formatPercent(v * 100, { sign: false, decimals: 2 });
}

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

type SortKey = 'ticker' | 'diasAlVencimiento' | 'tir' | 'retornoDirectoArs' | 'mepBreakeven' | 'devaluacionBreakeven';

type ModoTasa = 'directa' | 'tir';

/** Escala divergente verde↔rojo (paleta dataviz: --up/--down del tema) para el
 * heatmap de retorno por escenario de MEP de salida — polaridad (gana/pierde
 * contra el dólar), no magnitud, así que diverge desde 0, no un solo hue. */
function colorHeatmap(v: number | null): string {
  if (v == null || Number.isNaN(v)) return 'transparent';
  const clamp = Math.max(-0.25, Math.min(0.25, v));
  const t = clamp / 0.25; // -1..1
  if (t >= 0) {
    // 0 → 1: neutro hacia verde (--up)
    const alpha = 0.12 + t * 0.72;
    return `rgba(95, 184, 150, ${alpha.toFixed(2)})`;
  }
  const alpha = 0.12 + -t * 0.72;
  return `rgba(217, 112, 90, ${alpha.toFixed(2)})`;
}

function colorHeatmapTexto(v: number | null): string {
  if (v == null || Number.isNaN(v)) return 'var(--muted)';
  return Math.abs(v) > 0.06 ? '#ffffff' : 'var(--text)';
}

interface ScatterShapeProps {
  cx?: number;
  cy?: number;
  payload?: CarryTradeItem;
}

// Ancho aproximado del label en px por caracter a fontSize 11 bold, y margen
// del <ComposedChart> (right: 20) — igual criterio que RentaFijaSection: sin
// clampear contra el borde real del área de plot, el label del punto más a
// la derecha (el vencimiento más lejano) queda cortado o pegado al borde.
const ANCHO_POR_CARACTER = 6.2;
const CHART_MARGEN_DER = 20;

/** Punto del scatter con el ticker como label directo, siempre visible (no
 * solo al hover) — así se lee de un vistazo qué instrumento es cada punto,
 * igual que en la referencia de diseño. */
function crearBreakevenPoint(chartWidth: number) {
  return function BreakevenPoint(props: unknown) {
    const { cx, cy, payload } = props as ScatterShapeProps;
    if (cx == null || cy == null || !payload) return <g />;
    const anchoLabel = payload.ticker.length * ANCHO_POR_CARACTER;
    const limiteDer = (chartWidth || Infinity) - CHART_MARGEN_DER;
    // Si el label centrado se saliera del área visible, se ancla a la
    // derecha del punto en vez de centrado, para que quede adentro.
    const seSaleDerecha = cx + anchoLabel / 2 > limiteDer;
    return (
      <g>
        <circle cx={cx} cy={cy} r={4} fill="#eb6834" />
        <text
          x={seSaleDerecha ? Math.min(cx, limiteDer - anchoLabel) + anchoLabel : cx}
          y={cy - 10}
          textAnchor={seSaleDerecha ? 'end' : 'middle'}
          fontSize={11}
          fontWeight={700}
          fill="var(--text-sec)"
        >
          {payload.ticker}
        </text>
      </g>
    );
  };
}

type PuntoBono = CarryTradeItem & { fechaTs: number; techoBandaVto: number };
type PuntoBanda = { fechaTs: number; techoBanda: number };

interface TooltipPayload {
  payload: PuntoBono | PuntoBanda;
}

function esCarryItem(p: TooltipPayload['payload']): p is PuntoBono {
  return 'ticker' in p;
}

function CarryTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  // El tooltip compartido del ComposedChart dispara con el payload de ambas
  // series (bono y curva de banda) cuando coinciden en X — se prioriza el
  // bono si está presente, y si no, se muestra el valor de la banda sola
  // (ej. al pasar el mouse sobre un tramo de la línea sin ningún bono cerca).
  const itemBono = payload.find((p) => esCarryItem(p.payload));
  const b = itemBono?.payload as PuntoBono | undefined;
  const itemBanda = payload.find((p) => !esCarryItem(p.payload))?.payload as PuntoBanda | undefined;

  return (
    <div className="tooltip-panel">
      {b ? (
        <>
          <p style={{ fontWeight: 600 }}>{b.ticker}</p>
          <p className="tooltip-titulo" style={{ fontWeight: 400 }}>Vence el {fmtFecha(b.vencimiento)}, en {b.diasAlVencimiento} días</p>
          <p className="tooltip-fila"><span>TIR en pesos</span><span>{fmtPct1(b.tir)}</span></p>
          <p className="tooltip-fila"><span>Retorno directo en pesos</span><span>{fmtPct1(b.retornoDirectoArs)}</span></p>
          {!Number.isNaN(b.mepBreakeven) && (
            <p className="tooltip-fila"><span>MEP breakeven</span><span>{formatFx(b.mepBreakeven, { decimals: 2 })} ({fmtPct1(b.devaluacionBreakeven)})</span></p>
          )}
          <p className="tooltip-fila">
            <span><span className="tooltip-marca" style={{ background: '#2a78d6' }} />Techo de la banda</span>
            <span>{formatFx(b.techoBandaVto, { decimals: 2 })}</span>
          </p>
          {b.tenenciaUsd != null && <p className="tooltip-nota" style={{ color: 'var(--primary)' }}>En cartera</p>}
        </>
      ) : itemBanda ? (
        <>
          <p className="tooltip-titulo">{formatMesLabel(itemBanda.fechaTs)}</p>
          <p className="tooltip-fila">
            <span><span className="tooltip-marca" style={{ background: '#2a78d6' }} />Techo de la banda</span>
            <span>{formatFx(itemBanda.techoBanda, { decimals: 2 })}</span>
          </p>
        </>
      ) : null}
    </div>
  );
}

export default function CarryTradeSection({ tenencias }: Props) {
  const { data: perf, loading, error } = usePerformance(tenencias);

  // Ancho real del gráfico, para clampear el label del punto más a la
  // derecha contra el borde del área de plot (mismo patrón que RentaFija).
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setChartWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [mepStr, setMepStr] = useState('1500');
  const mepEntrada = mepStr.trim() === '' ? null : Number(mepStr);

  const [carryCustomStr, setCarryCustomStr] = useState('1350');
  const carryCustom = carryCustomStr.trim() === '' ? null : Number(carryCustomStr);

  const [inflacionStr, setInflacionStr] = useState('1');
  const inflacionMensual = (inflacionStr.trim() === '' ? 1 : Number(inflacionStr)) / 100;

  const [modoTasa, setModoTasa] = useState<ModoTasa>('directa');

  const [sortKey, setSortKey] = useState<SortKey>('diasAlVencimiento');
  const [sortDesc, setSortDesc] = useState(false);

  const items = useMemo(
    () => calcularCarryTrade(perf?.bonos ?? [], mepEntrada, null, carryCustom, inflacionMensual),
    [perf, mepEntrada, carryCustom, inflacionMensual],
  );

  const itemsOrdenados = useMemo(() => {
    const copia = [...items];
    copia.sort((a, b) => {
      const cmp = sortKey === 'ticker' ? a.ticker.localeCompare(b.ticker) : a[sortKey] - b[sortKey];
      return sortDesc ? -cmp : cmp;
    });
    return copia;
  }, [items, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(false); }
  }

  // Columnas de carry por escenario de MEP de salida, ordenadas de menor a
  // mayor valor — así "Carry custom" se ubica entre las columnas fijas que le
  // corresponden según dónde cae (ej. custom=1450 queda entre 1400 y 1500) en
  // vez de vivir siempre en una posición fija sin relación con su valor.
  const columnasCarry = useMemo(() => {
    const fijas: { key: 't1400' | 't1500' | 't1600'; mep: number; label: string }[] = [
      { key: 't1400', mep: 1400, label: 'Carry 1400' },
      { key: 't1500', mep: 1500, label: 'Carry 1500' },
      { key: 't1600', mep: 1600, label: 'Carry 1600' },
    ];
    const columnas: { key: 't1400' | 't1500' | 't1600' | 'custom'; label: string; custom: boolean }[] =
      fijas.map((f) => ({ key: f.key, label: f.label, custom: false }));
    if (carryCustom != null) {
      const idx = fijas.findIndex((f) => carryCustom < f.mep);
      const entrada = { key: 'custom' as const, label: `Carry ${formatFx(carryCustom, { decimals: 2 })} (propio)`, custom: true };
      if (idx === -1) columnas.push(entrada);
      else columnas.splice(idx, 0, entrada);
    }
    return columnas;
  }, [carryCustom]);

  const cabecera = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <ThOrden clave={key} label={label} activa={sortKey} desc={sortDesc} onOrden={toggleSort} align={align} />
  );

  const puntosScatter = useMemo(
    () => items
      .filter((i) => !Number.isNaN(i.mepBreakeven))
      .map((i) => {
        const fechaTs = Date.parse(`${i.vencimiento}T00:00:00Z`);
        return { ...i, fechaTs, techoBandaVto: techoBandaEnFecha(fechaTs, inflacionMensual) };
      }),
    [items, inflacionMensual],
  );

  const maxFechaChart = useMemo(() => {
    if (puntosScatter.length === 0) return null;
    return Math.max(...puntosScatter.map((p) => p.fechaTs));
  }, [puntosScatter]);

  // Tope real del eje X, con ~8% de aire a la derecha del último vencimiento
  // — mismo criterio que el eje de duration en Renta Fija: sin este margen el
  // punto/label más a la derecha (el vencimiento más lejano) queda pegado
  // contra el borde del área de plot.
  const dominioFechaX = useMemo((): [number, number] => {
    if (puntosScatter.length === 0 || maxFechaChart == null) return [0, 1];
    const minTs = Math.min(...puntosScatter.map((p) => p.fechaTs));
    const padding = (maxFechaChart - minTs) * 0.08;
    return [minTs, maxFechaChart + padding];
  }, [puntosScatter, maxFechaChart]);

  // Curva de banda superior proyectada: una línea continua desde hoy hasta el
  // tope de fecha del gráfico, para mostrar la trayectoria del techo de banda
  // cambiaria, no solo su valor en cada vencimiento puntual.
  const curvaBanda = useMemo(() => {
    if (maxFechaChart == null) return [];
    const hoyTs = Date.now();
    if (maxFechaChart <= hoyTs) return [];
    const pasos = 40;
    return Array.from({ length: pasos + 1 }, (_, i) => {
      const ts = hoyTs + ((maxFechaChart - hoyTs) * i) / pasos;
      return { fechaTs: ts, techoBanda: techoBandaEnFecha(ts, inflacionMensual) };
    });
  }, [maxFechaChart, inflacionMensual]);

  // Dominio del eje Y ajustado al breakeven de los bonos Y a la curva de
  // banda superior (que crece más rápido que el breakeven de corto plazo) —
  // si solo se mira el breakeven, la banda se sale del dominio y la línea
  // queda cortada apenas empieza a crecer.
  const dominioBreakeven = useMemo((): [number, number] => {
    if (puntosScatter.length === 0) return [0, 1];
    const valores = [
      ...puntosScatter.map((p) => p.mepBreakeven),
      ...curvaBanda.map((p) => p.techoBanda),
    ];
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const padding = (max - min) * 0.12 || max * 0.05;
    return [min - padding, max + padding];
  }, [puntosScatter, curvaBanda]);

  if (loading) {
    return (
      <Cargando etiqueta="Cargando instrumentos de carry trade" alto={300} />
    );
  }

  if (error) {
    return (
      <AvisoError titulo="No se pudieron cargar los instrumentos">{error}</AvisoError>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── Barra de control: FX spot + modo + carry custom ──────────────── */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-sec)', lineHeight: 1.5, maxWidth: '78ch' }}>
          Vender USD al MEP de entrada, comprar el instrumento en pesos y mantenerlo hasta el vencimiento,
          para volver a comprar USD al MEP de salida. El <strong>MEP breakeven</strong> es el tipo de cambio al
          que el carry deja de ganarle a quedarse directamente en dólares.
        </p>
        <div style={{ display: 'flex', gap: '10px 18px', flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="campo-etiqueta">
            MEP de entrada
            <input
              type="number" inputMode="decimal" placeholder="ej. 1517,67"
              value={mepStr}
              onChange={(e) => setMepStr(e.target.value)}
              className="campo"
              style={{ width: 96, fontWeight: 600 }}
            />
          </label>

          <Segmented
            opciones={[{ id: 'directa' as ModoTasa, label: 'Tasa directa' }, { id: 'tir' as ModoTasa, label: 'TIR' }]}
            activa={modoTasa}
            onChange={setModoTasa}
            chico
            etiqueta="Tasa de la tabla"
          />

          <label className="campo-etiqueta" style={{ marginLeft: 'auto' }}>
            MEP de salida propio
            <input
              type="number" inputMode="decimal" placeholder="1350"
              value={carryCustomStr}
              onChange={(e) => setCarryCustomStr(e.target.value)}
              className="campo"
              style={{ width: 96, fontWeight: 600 }}
            />
          </label>
          <label className="campo-etiqueta">
            Inflación mensual de la banda
            <input
              type="number" inputMode="decimal" step="0.1" placeholder="1"
              value={inflacionStr}
              onChange={(e) => setInflacionStr(e.target.value)}
              className="campo"
              style={{ width: 64, fontWeight: 600 }}
            />
            %
          </label>
        </div>
      </div>

      {/* Sin instrumentos la tabla quedaba en una fila de encabezados y el gráfico
          en ejes sin sentido ("1 ARS/USD"): se dice qué falta. */}
      {items.length === 0 && (
        <Vacio titulo="No hay instrumentos para analizar">
          El carry trade se arma con letras y bonos a tasa fija en pesos, y hoy la fuente de mercado no trajo ninguno.
        </Vacio>
      )}

      {/* ── Tabla: precio, retorno directo y heatmap de carry por escenario ─ */}
      <div className="tabla-wrap" hidden={items.length === 0}>
        <table className="tabla-datos" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {cabecera('ticker', 'Ticker', 'left')}
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Precio</th>
              {cabecera('diasAlVencimiento', 'Días al vto.')}
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Vto.</th>
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Valor final</th>
              {cabecera(modoTasa === 'directa' ? 'retornoDirectoArs' : 'tir', modoTasa === 'directa' ? 'Retorno directo' : 'TIR')}
              {columnasCarry.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600,
                    color: c.custom ? 'var(--primary)' : 'var(--muted)',
                  }}
                >{c.label}</th>
              ))}
              <th
                title="Retorno en USD si el MEP de salida termina en el techo de banda cambiaria proyectado a esa fecha con la inflación mensual asumida."
                style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)', cursor: 'help' }}
              >Banda superior</th>
            </tr>
          </thead>
          <tbody>
            {itemsOrdenados.map((i) => (
              <tr
                key={i.ticker}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: i.tenenciaUsd ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent',
                }}
              >
                <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--text)' }}>
                  {i.ticker}{i.tenenciaUsd ? ' ★' : ''}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                  {i.precio != null ? formatMoney(i.precio, { currency: 'ARS', mode: 'price' }) : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{i.diasAlVencimiento}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-sec)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtFecha(i.vencimiento)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                  {i.prFinish != null ? formatMoney(i.prFinish, { currency: 'ARS', mode: 'price' }) : '—'}
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtPct1(modoTasa === 'directa' ? i.retornoDirectoArs : i.tir)}
                </td>
                {columnasCarry.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                      background: colorHeatmap(i.carryPorTarget[c.key]), color: colorHeatmapTexto(i.carryPorTarget[c.key]),
                    }}
                  >
                    {i.carryPorTarget[c.key] != null ? fmtPct1(i.carryPorTarget[c.key]!) : '—'}
                  </td>
                ))}
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', background: colorHeatmap(i.bandaSuperior), color: colorHeatmapTexto(i.bandaSuperior) }}>
                  {i.bandaSuperior != null ? fmtPct1(i.bandaSuperior) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Curva de breakeven: MEP breakeven vs. vencimiento + banda proyectada ── */}
      <div className="card" hidden={items.length === 0} style={{ paddingBottom: 8, minHeight: 320, flexDirection: 'column' }}>
        <div className="card-cabecera" style={{ display: 'block' }}>
          <p className="card-titulo">Curva de breakeven</p>
          <p className="card-sub">
            Cada punto naranja es el MEP breakeven de un instrumento a su vencimiento. La línea es el techo de la banda,
            proyectado con una inflación mensual del {fmtPct2(inflacionMensual)}.
          </p>
        </div>
        <div ref={chartWrapRef} style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 20, right: 20, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--border-subtle)" />
              <XAxis
                type="number" dataKey="fechaTs" name="Vencimiento"
                domain={dominioFechaX} allowDataOverflow
                tickFormatter={formatMesLabel}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false} axisLine={false}
              />
              <YAxis
                type="number" dataKey="mepBreakeven" name="MEP breakeven"
                tickFormatter={(v) => formatFx(v)}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false} axisLine={false} width={64}
                domain={dominioBreakeven} allowDataOverflow
              />
              <Tooltip content={<CarryTooltip />} cursor={{ stroke: 'var(--border-subtle)' }} />
              {curvaBanda.length > 0 && (
                <Line
                  type="monotone" data={curvaBanda} dataKey="techoBanda" xAxisId={0}
                  stroke="#2a78d6" strokeWidth={2} dot={false}
                  activeDot={{ r: 4, fill: '#2a78d6', stroke: 'var(--card)', strokeWidth: 2 }}
                  isAnimationActive={false} legendType="none" name="Banda superior proyectada"
                />
              )}
              <Scatter
                data={puntosScatter}
                dataKey="mepBreakeven"
                fill="#eb6834"
                shape={crearBreakevenPoint(chartWidth)}
                isAnimationActive={false}
                name="MEP breakeven"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
