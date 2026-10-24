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

interface Props {
  tenencias: Record<string, number>;
}

function fmtPct1(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtPct2(v: number): string {
  return `${(v * 100).toFixed(2)}%`;
}

function fmtArs(v: number): string {
  return v.toLocaleString('es-AR', { maximumFractionDigits: 2 });
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
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      {b ? (
        <>
          <p style={{ margin: '0 0 4px', fontWeight: 700, color: 'var(--text)' }}>{b.ticker}</p>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 11 }}>Vto. {fmtFecha(b.vencimiento)} · {b.diasAlVencimiento} días</p>
          <p style={{ margin: '2px 0', color: 'var(--text-sec)' }}>TIR (ARS): <strong>{fmtPct1(b.tir)}</strong></p>
          <p style={{ margin: '2px 0', color: 'var(--text-sec)' }}>Retorno directo (ARS): <strong>{fmtPct1(b.retornoDirectoArs)}</strong></p>
          {!Number.isNaN(b.mepBreakeven) && (
            <p style={{ margin: '2px 0', color: 'var(--text-sec)' }}>MEP breakeven: <strong>${fmtArs(b.mepBreakeven)}</strong> ({fmtPct1(b.devaluacionBreakeven)})</p>
          )}
          <p style={{ margin: '2px 0', color: '#2a78d6' }}>Banda superior a esa fecha: <strong>${fmtArs(b.techoBandaVto)}</strong></p>
          {b.tenenciaUsd != null && <p style={{ margin: '6px 0 0', color: 'var(--primary)', fontSize: 11 }}>En cartera</p>}
        </>
      ) : itemBanda ? (
        <>
          <p style={{ margin: '0 0 4px', fontWeight: 700, color: '#2a78d6' }}>Banda superior proyectada</p>
          <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontSize: 11 }}>{formatMesLabel(itemBanda.fechaTs)}</p>
          <p style={{ margin: '2px 0', color: 'var(--text-sec)' }}>Techo estimado: <strong>${fmtArs(itemBanda.techoBanda)}</strong></p>
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
      const entrada = { key: 'custom' as const, label: `Carry ${fmtArs(carryCustom)} (custom)`, custom: true };
      if (idx === -1) columnas.push(entrada);
      else columnas.splice(idx, 0, entrada);
    }
    return columnas;
  }, [carryCustom]);

  const cabecera = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <th
      onClick={() => toggleSort(key)}
      style={{
        cursor: 'pointer', textAlign: align, padding: '8px 10px',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: sortKey === key ? 'var(--primary)' : 'var(--muted)', whiteSpace: 'nowrap',
      }}
    >
      {label}{sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : ''}
    </th>
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando instrumentos de carry trade…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid #ef553b', borderRadius: 10,
        padding: '10px 14px', fontSize: 12, color: '#ef553b',
      }}>
        Error cargando performance: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── Barra de control: FX spot + modo + carry custom ──────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text-sec)', lineHeight: 1.5 }}>
          Vender USD al MEP de entrada, comprar el instrumento en pesos y mantenerlo hasta el vencimiento,
          para volver a comprar USD al MEP de salida. El <strong>MEP breakeven</strong> es el tipo de cambio al
          que el carry deja de ganarle a quedarse directamente en dólares.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 10px 4px 12px' }}>
            MEP
            <input
              type="number" inputMode="decimal" placeholder="ej. 1517,67"
              value={mepStr}
              onChange={(e) => setMepStr(e.target.value)}
              style={{ width: 84, padding: '2px 4px', border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 13, fontWeight: 700, outline: 'none' }}
            />
          </label>

          <div style={{ display: 'flex', borderRadius: 20, border: '1px solid var(--border)', overflow: 'hidden', marginLeft: 4 }}>
            {(['directa', 'tir'] as ModoTasa[]).map((m) => (
              <button
                key={m}
                onClick={() => setModoTasa(m)}
                style={{
                  padding: '6px 14px', fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: modoTasa === m ? 'var(--primary)' : 'transparent',
                  color: modoTasa === m ? 'var(--bg)' : 'var(--muted)',
                }}
              >
                {m === 'directa' ? 'Tasa directa' : 'TIR'}
              </button>
            ))}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            Carry custom
            <input
              type="number" inputMode="decimal" placeholder="1350"
              value={carryCustomStr}
              onChange={(e) => setCarryCustomStr(e.target.value)}
              style={{
                width: 90, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 700,
              }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
            Inflación mens. banda
            <input
              type="number" inputMode="decimal" step="0.1" placeholder="1"
              value={inflacionStr}
              onChange={(e) => setInflacionStr(e.target.value)}
              style={{
                width: 60, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg)', color: 'var(--text)', fontSize: 13, fontWeight: 700,
              }}
            />
            %
          </label>
        </div>
      </div>

      {/* ── Tabla: precio, retorno directo y heatmap de carry por escenario ─ */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {cabecera('ticker', 'Ticker', 'left')}
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Precio</th>
              {cabecera('diasAlVencimiento', 'Días al Vto.')}
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Vto.</th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Pr. finish</th>
              {cabecera(modoTasa === 'directa' ? 'retornoDirectoArs' : 'tir', modoTasa === 'directa' ? 'Retorno directo' : 'TIR')}
              {columnasCarry.map((c) => (
                <th
                  key={c.key}
                  style={{
                    textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    color: c.custom ? 'var(--primary)' : 'var(--muted)',
                  }}
                >{c.label}</th>
              ))}
              <th
                title="Retorno en USD si el MEP de salida termina en el techo de banda cambiaria proyectado a esa fecha con la inflación mensual asumida."
                style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', cursor: 'help' }}
              >Banda superior</th>
            </tr>
          </thead>
          <tbody>
            {itemsOrdenados.map((i) => (
              <tr
                key={i.ticker}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: i.tenenciaUsd ? '#1baf7a11' : 'transparent',
                }}
              >
                <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--text)' }}>
                  {i.ticker}{i.tenenciaUsd ? ' ★' : ''}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)' }}>
                  {i.precio != null ? `$${fmtArs(i.precio)}` : '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)' }}>{i.diasAlVencimiento}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>{fmtFecha(i.vencimiento)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)' }}>
                  {i.prFinish != null ? `$${fmtArs(i.prFinish)}` : '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                  {fmtPct1(modoTasa === 'directa' ? i.retornoDirectoArs : i.tir)}
                </td>
                {columnasCarry.map((c) => (
                  <td
                    key={c.key}
                    style={{
                      padding: '7px 10px', textAlign: 'right', fontWeight: 700,
                      background: colorHeatmap(i.carryPorTarget[c.key]), color: colorHeatmapTexto(i.carryPorTarget[c.key]),
                    }}
                  >
                    {i.carryPorTarget[c.key] != null ? fmtPct1(i.carryPorTarget[c.key]!) : '—'}
                  </td>
                ))}
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, background: colorHeatmap(i.bandaSuperior), color: colorHeatmapTexto(i.bandaSuperior) }}>
                  {i.bandaSuperior != null ? fmtPct1(i.bandaSuperior) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Curva de breakeven: MEP breakeven vs. vencimiento + banda proyectada ── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 16px 8px', minHeight: 320, display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ marginBottom: 10 }}>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-sec)', margin: 0 }}>
            Curva de Breakeven Carry Trade
          </p>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
            Bandas proyectadas con inflación del {fmtPct2(inflacionMensual)} · un punto naranja = MEP breakeven por ticker
          </span>
        </div>
        <div ref={chartWrapRef} style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart margin={{ top: 20, right: 20, left: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" />
              <XAxis
                type="number" dataKey="fechaTs" name="Vencimiento"
                domain={dominioFechaX} allowDataOverflow
                tickFormatter={formatMesLabel}
                tick={{ fill: 'var(--muted)', fontSize: 10 }}
                tickLine={false} axisLine={false}
              />
              <YAxis
                type="number" dataKey="mepBreakeven" name="MEP breakeven"
                tickFormatter={(v) => `$${fmtArs(v)}`}
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
