'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { DashboardData, BenchmarksResponse, BenchmarkId } from '@/types';
import { toMesKey } from '@/lib/parser';
import { formatNumber, niceTicks } from '@/lib/format';
import Segmented from './Segmented';
import InfoTip from './InfoTip';
import { Cargando, AvisoError } from './Estados';

interface Props {
  data: DashboardData;
}

type SeriesId = 'cartera' | BenchmarkId;

// Colores de la paleta categórica (SLOTS en lib/constants.ts): la cartera
// propia va en el azul del acento, la serie de referencia; rosa para la
// inflación (costo/alerta a superar), turquesa para el S&P 500, violeta para
// el MEP, naranja para Bitcoin y amarillo para oro. Naranja y amarillo se
// parecen entre sí: por eso la leyenda y los toggles nombran cada serie.
const SERIES_META: Record<SeriesId, { label: string; shortLabel: string; tooltip?: string; color: string; dashed?: boolean }> = {
  cartera:   { label: 'Mi Cartera',              shortLabel: 'Mi Cartera',  color: '#0a84ff' },
  sp500:     { label: 'S&P 500',                 shortLabel: 'S&P 500',    color: '#1e9ab0' },
  inflacion: { label: 'Inflación (IPC INDEC)',   shortLabel: 'Inflación',  tooltip: 'IPC INDEC', color: '#f2385a' },
  mep:       { label: 'Dólar MEP',               shortLabel: 'Dólar MEP', color: '#b455e8' },
  btc:       { label: 'Bitcoin',                 shortLabel: 'Bitcoin',    color: '#d96f00' },
  oro:       { label: 'Oro',                     shortLabel: 'Oro',        color: '#b98a00' },
};

const SERIES_ORDER: SeriesId[] = ['cartera', 'sp500', 'inflacion', 'mep', 'btc', 'oro'];

const VISIBLE_KEY = 'benchmarks_visible_v1';
const MONEDA_CHART_KEY = 'benchmarks_moneda_v1';

function loadMonedaChart(): 'usd' | 'ars' {
  try {
    const s = localStorage.getItem(MONEDA_CHART_KEY);
    if (s === 'usd' || s === 'ars') return s;
  } catch {}
  return 'ars';
}

function loadVisible(): Record<SeriesId, boolean> {
  const defaults = { cartera: true, sp500: true, inflacion: true, mep: true, btc: true, oro: true };
  try {
    const s = localStorage.getItem(VISIBLE_KEY);
    if (s) return { ...defaults, ...JSON.parse(s) };
  } catch {}
  return defaults;
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-panel">
      <p className="tooltip-titulo">{label}</p>
      {/* De mayor a menor: el orden del tooltip es el del gráfico en ese mes. */}
      {[...payload].filter((p) => p.value != null).sort((a, b) => b.value - a.value).map((p) => (
        <p key={p.dataKey} className="tooltip-fila">
          <span><span className="tooltip-marca" style={{ background: p.color }} />{p.name}</span>
          <span>{formatNumber(p.value, { decimals: 1 })}</span>
        </p>
      ))}
    </div>
  );
}

export default function BenchmarksTab({ data }: Props) {
  const { resumenSeries } = data;

  const [visible, setVisible] = useState<Record<SeriesId, boolean>>(loadVisible);
  const [resp, setResp] = useState<BenchmarksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  function toggle(id: SeriesId) {
    setVisible((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }

  const mesesCartera = useMemo(() => resumenSeries.map((r) => toMesKey(r.fechaTs)), [resumenSeries]);

  useEffect(() => {
    if (mesesCartera.length === 0) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/benchmarks?meses=${mesesCartera.join(',')}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setResp(json as BenchmarksResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mesesCartera.join(','), apiBase]);

  // Cartera como índice TWR (Time-Weighted Return) base 100: el mismo índice
  // Modified Dietz encadenado que calcula lib/twr.ts y usa Resumen — no una
  // cuenta propia. Antes esta pestaña tenía su propia aproximación (sin
  // pesar los flujos por fecha exacta), que daba un número distinto al de
  // Resumen bajo el mismo nombre "Mi Cartera". Ver
  // docs/decisiones/0022-twr-modified-dietz-encadenado.md
  const carteraBase100 = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of resumenSeries) map.set(toMesKey(r.fechaTs), r.twrIndiceUsd);
    return map;
  }, [resumenSeries]);

  // Vista de moneda del gráfico: 'ars' convierte todo a pesos nominales vía
  // MEP (incluye inflación, que solo tiene sentido en pesos); 'usd' muestra
  // cada serie en su moneda nativa y omite inflación (no es un valor en
  // dólares). Las dos parten de la misma base 100 en el mismo mes — ver
  // docs/decisiones/0007-mep-mensual-no-mep-unico.md sobre por qué ARS ≠ USD
  // reescalado (el MEP se mueve distinto que cualquier activo).
  const [monedaChart, setMonedaChartState] = useState<'usd' | 'ars'>(loadMonedaChart);
  function setMonedaChart(next: 'usd' | 'ars') {
    setMonedaChartState(next);
    try { localStorage.setItem(MONEDA_CHART_KEY, next); } catch {}
  }

  // Cartera en TWR ARS: el mismo índice Modified Dietz pero con flujos y
  // valuaciones en pesos (ver lib/twr.ts) — no la versión en USD multiplicada
  // por el MEP, que es solo una aproximación cuando no hay flujos de por medio.
  const carteraBase100Ars = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of resumenSeries) map.set(toMesKey(r.fechaTs), r.twrIndiceArs);
    return map;
  }, [resumenSeries]);

  // Factor de conversión USD→ARS por mes, relativo al mes base (MEP indexado / 100).
  // Ej: si el MEP subió 30% desde el mes base, factorMep(mes) = 1.30.
  const factorMep = useMemo(() => {
    const map = new Map<string, number>();
    const mepSeries = resp?.series.find((s) => s.id === 'mep');
    for (const p of mepSeries?.puntos ?? []) map.set(p.mesKey, p.valor / 100);
    return map;
  }, [resp]);

  // En vista ARS, cada serie en USD (S&P500, oro, BTC) se multiplica por la
  // devaluación acumulada del MEP antes de re-indexar a 100, para que sea
  // comparable en la misma moneda que la inflación. La cartera usa su propio
  // índice TWR en ARS, no una conversión del TWR en USD. En vista USD, cada
  // serie queda en su moneda nativa y la inflación (que no tiene valor en
  // dólares) no se muestra. Si el MEP no tiene dato ese mes, se omite el
  // punto en vez de mostrar un valor engañoso.
  const chartData = useMemo(() => {
    const seriesExternas = resp?.series ?? [];
    return resumenSeries.map((r) => {
      const mesKey = toMesKey(r.fechaTs);
      const fx = factorMep.get(mesKey);

      const row: Record<string, number | string | undefined> = { mesKey, fecha: r.fecha };

      if (monedaChart === 'ars') {
        row.cartera = carteraBase100Ars.get(mesKey);
        for (const s of seriesExternas) {
          if (s.id === 'inflacion' || s.id === 'mep') {
            row[s.id] = s.puntos.find((p) => p.mesKey === mesKey)?.valor; // ya en ARS / índice propio
            continue;
          }
          const valUsd = s.puntos.find((p) => p.mesKey === mesKey)?.valor;
          row[s.id] = valUsd != null && fx != null ? valUsd * fx : undefined;
        }
      } else {
        row.cartera = carteraBase100.get(mesKey);
        for (const s of seriesExternas) {
          if (s.id === 'inflacion') continue; // sin valor en USD
          row[s.id] = s.puntos.find((p) => p.mesKey === mesKey)?.valor;
        }
      }
      return row;
    });
  }, [resumenSeries, carteraBase100, carteraBase100Ars, factorMep, resp, monedaChart]);

  const seriesConError = useMemo(() => {
    const map = new Map<BenchmarkId, string>();
    for (const s of resp?.series ?? []) {
      if (s.error) map.set(s.id, s.error);
    }
    return map;
  }, [resp]);

  const seriesActivas = useMemo(
    () => SERIES_ORDER.filter(
      (id) => visible[id] && !seriesConError.get(id as BenchmarkId) && !(monedaChart === 'usd' && id === 'inflacion'),
    ),
    [visible, seriesConError, monedaChart],
  );

  // Último valor conocido de cada serie activa, para mostrarlo en el chip
  // (reemplaza a la leyenda al pie, que duplicaba la información de los chips).
  const ultimoValor = useMemo(() => {
    const map = new Map<SeriesId, number>();
    for (const id of SERIES_ORDER) {
      for (let i = chartData.length - 1; i >= 0; i--) {
        const v = chartData[i][id];
        if (typeof v === 'number') { map.set(id, v); break; }
      }
    }
    return map;
  }, [chartData]);

  // Dominio del eje Y: min/max de las series visibles + ~5% de margen,
  // redondeado a valores "lindos" (niceTicks) e incluyendo siempre 100 (la
  // línea base). Se recalcula cada vez que se activan/desactivan chips, en
  // vez de depender del auto-domain de recharts (que arrancaba en 0 aunque
  // los datos fueran de 85 a 230, dejando un tercio del área vacío).
  const { yDomain, yTicks } = useMemo(() => {
    const valores: number[] = [100];
    for (const row of chartData) {
      for (const id of seriesActivas) {
        const v = row[id];
        if (typeof v === 'number') valores.push(v);
      }
    }
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const margen = (max - min) * 0.05 || 5;
    const ticks = niceTicks(min - margen, max + margen, 6);
    return { yDomain: [ticks[0], ticks[ticks.length - 1]] as [number, number], yTicks: ticks };
  }, [chartData, seriesActivas]);

  // Ticks del eje X cada 3 meses (trimestral), siempre incluyendo el primero
  // y el último punto de datos para que la serie más reciente quede rotulada.
  const xTicks = useMemo(() => {
    if (chartData.length === 0) return [];
    const idxs = new Set<number>();
    for (let i = 0; i < chartData.length; i += 3) idxs.add(i);
    idxs.add(chartData.length - 1);
    return Array.from(idxs).sort((a, b) => a - b).map((i) => chartData[i].fecha as string);
  }, [chartData]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      {/* ── Toggles de series + moneda del gráfico ──────────────────────────── */}
      <div style={{ display: 'flex', gap: '8px 12px', flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
        <Segmented
          opciones={[
            { id: 'ars' as const, label: 'ARS', title: 'Todo en pesos nominales; incluye la inflación' },
            { id: 'usd' as const, label: 'USD', title: 'Cada serie en su moneda; la inflación no se muestra' },
          ]}
          activa={monedaChart}
          onChange={setMonedaChart}
          chico
          etiqueta="Moneda del gráfico"
        />
        <div className="chips" role="group" aria-label="Series del gráfico">
        {SERIES_ORDER.filter((id) => !(monedaChart === 'usd' && id === 'inflacion')).map((id) => {
          const meta = SERIES_META[id];
          const err = id !== 'cartera' ? seriesConError.get(id as BenchmarkId) : undefined;
          const isVisible = visible[id];
          const valor = ultimoValor.get(id);
          return (
            <button
              key={id}
              onClick={() => toggle(id)}
              disabled={!!err}
              type="button"
              className="chip"
              aria-pressed={isVisible && !err}
              title={err ? `No se pudo cargar: ${err}` : meta.tooltip}
              style={{ '--chip-color': err ? 'var(--muted)' : meta.color } as React.CSSProperties}
            >
              <span className="chip-punto" />
              {meta.shortLabel}
              {err ? <span aria-hidden="true">sin datos</span> : valor != null && (
                <strong>{formatNumber(valor, { decimals: 0 })}</strong>
              )}
            </button>
          );
        })}
        </div>
      </div>

      {/* ── Estado de carga / error global ────────────────────────────────── */}
      {loading && <Cargando etiqueta="Cargando benchmarks" alto={300} />}
      {error && <AvisoError titulo="No se pudieron cargar los benchmarks">{error}</AvisoError>}

      {/* ── Gráfico ────────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="card bench-chart-card" style={{ paddingBottom: 8, flex: 1, minHeight: 280, display: 'flex', flexDirection: 'column' }}>
          <div className="card-cabecera" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <p className="card-titulo">Rendimiento relativo</p>
                <InfoTip label="cómo se calcula el índice" ancho={300}>
                  {monedaChart === 'ars'
                    ? 'En ARS nominal: cartera, S&P 500, oro y Bitcoin se convierten a pesos con el dólar MEP para compararlos con la inflación (IPC INDEC), que solo existe en pesos. El dólar MEP muestra la devaluación del peso.'
                    : 'En USD: cada serie en su moneda, sin convertir. La inflación argentina no tiene valor en dólares y no se muestra; para verla, pasá a ARS.'}
                  {' '}Mi Cartera es TWR (Time-Weighted Return): aísla el rendimiento de mercado del efecto de cuánto o cuándo aportaste. Es una aproximación por Modified Dietz mensual (no hay valuación diaria), igual al TWR de Resumen.
                </InfoTip>
              </div>
              <p className="card-sub">
                Índice base 100 en {resumenSeries[0]?.fecha ?? 'el primer mes'}, en {monedaChart === 'ars' ? 'pesos nominales' : 'dólares'}
              </p>
            </div>
          </div>
          <div style={{ flex: 1, minHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  ticks={xTicks}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                  padding={{ left: 8, right: 8 }}
                />
                <YAxis
                  domain={yDomain}
                  ticks={yTicks}
                  tickFormatter={(v) => formatNumber(v, { decimals: 0 })}
                  tick={{ fill: 'var(--muted)', fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <ReferenceLine y={100} stroke="var(--muted)" strokeDasharray="3 4" strokeOpacity={0.5} />
                <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'var(--border)' }} />
                {[...seriesActivas]
                  // "cartera" se dibuja último (queda al frente, nunca tapada por los benchmarks)
                  .sort((a, b) => (a === 'cartera' ? 1 : b === 'cartera' ? -1 : 0))
                  .map((id) => (
                    <Line
                      key={id}
                      type="monotone"
                      dataKey={id}
                      name={SERIES_META[id].label}
                      stroke={SERIES_META[id].color}
                      strokeWidth={id === 'cartera' ? 3 : 1.75}
                      strokeOpacity={id === 'cartera' ? 1 : 0.85}
                      strokeDasharray={SERIES_META[id].dashed ? '5 4' : undefined}
                      dot={false}
                      animationDuration={300}
                      connectNulls
                      activeDot={{ r: id === 'cartera' ? 5 : 4, fill: SERIES_META[id].color, stroke: 'var(--card)', strokeWidth: 2 }}
                    />
                  ))}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
