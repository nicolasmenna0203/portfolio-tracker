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

interface Props {
  data: DashboardData;
}

type SeriesId = 'cartera' | BenchmarkId;

// Colores asignados por lo que cada serie representa, no arbitrarios:
// azul profundo para la cartera propia (contraste frío contra el resto de
// series, que son cálidas: destaca como la serie de referencia), verde salvia
// para el mercado USD (S&P 500), terracota para inflación (costo/alerta a
// superar), lavanda para el MEP, naranja para Bitcoin, ámbar para oro.
const SERIES_META: Record<SeriesId, { label: string; shortLabel: string; tooltip?: string; color: string; dashed?: boolean }> = {
  cartera:   { label: 'Mi Cartera',              shortLabel: 'Mi Cartera',  color: '#4a6fa5' },
  sp500:     { label: 'S&P 500',                 shortLabel: 'S&P 500',    color: '#5fb896' },
  inflacion: { label: 'Inflación (IPC INDEC)',   shortLabel: 'Inflación',  tooltip: 'IPC INDEC', color: '#c15c4a' },
  mep:       { label: 'Dólar MEP',               shortLabel: 'Dólar MEP', color: '#8d7fc7' },
  btc:       { label: 'Bitcoin',                 shortLabel: 'Bitcoin',    color: '#d9824e' },
  oro:       { label: 'Oro',                     shortLabel: 'Oro',        color: '#e8cf8a' },
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
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} style={{ margin: '2px 0', color: p.color, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{p.name}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(p.value, { decimals: 1 })}</strong>
          </p>
        )
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
  function setMonedaChart(updater: (m: 'usd' | 'ars') => 'usd' | 'ars') {
    setMonedaChartState((prev) => {
      const next = updater(prev);
      try { localStorage.setItem(MONEDA_CHART_KEY, next); } catch {}
      return next;
    });
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
    const ticks = niceTicks(min - margen, max + margen, 5);
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

  const [infoAbierto, setInfoAbierto] = useState(false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      {/* ── Toggles de series + moneda del gráfico ──────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
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
              className="pill-touch"
              aria-pressed={isVisible && !err}
              title={err ? `No se pudo cargar: ${err}` : meta.tooltip}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                cursor: err ? 'not-allowed' : 'pointer',
                border: '1px solid',
                borderColor: isVisible && !err ? meta.color : 'var(--border)',
                background: isVisible && !err ? `${meta.color}22` : 'transparent',
                color: err ? 'var(--muted)' : isVisible ? meta.color : 'var(--muted)',
                opacity: err ? 0.5 : 1,
                transition: 'all 0.12s',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: err ? 'var(--muted)' : meta.color, flexShrink: 0 }} />
              {meta.shortLabel}
              {err ? ' ⚠' : valor != null && (
                <strong style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                  {formatNumber(valor, { decimals: 0 })}
                </strong>
              )}
            </button>
          );
        })}

        <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

        <button
          onClick={() => setMonedaChart((m) => (m === 'usd' ? 'ars' : 'usd'))}
          className="pill-touch"
          title="Cambiar la moneda del gráfico. La inflación solo se muestra en ARS."
          style={{
            padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
            cursor: 'pointer', border: '1px solid var(--primary)',
            background: 'var(--primary-dim)', color: 'var(--primary)',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          Ver en {monedaChart === 'usd' ? 'ARS' : 'USD'}
        </button>
      </div>

      {/* ── Estado de carga / error global ────────────────────────────────── */}
      {loading && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando benchmarks…</p>
      )}
      {error && (
        <div style={{
          background: 'var(--card)', border: '1px solid #ef553b', borderRadius: 10,
          padding: '10px 14px', fontSize: 12, color: '#ef553b',
        }}>
          Error cargando benchmarks: {error}
        </div>
      )}

      {/* ── Gráfico ────────────────────────────────────────────────────────── */}
      {!loading && (
        <div className="bench-chart-card" style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '12px 14px 6px',
          flex: 1,
          minHeight: 280,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ marginBottom: 8, flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-sec)', margin: 0 }}>
              Rendimiento Relativo (Índice Base 100)
            </p>
            <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1, minWidth: 0 }}>
              Base 100 = {resumenSeries[0]?.fecha ?? 'primer mes'} · en {monedaChart === 'ars' ? 'ARS nominal' : 'USD'} · cartera en TWR
            </span>
            <span style={{ position: 'relative', flexShrink: 0 }}>
              <button
                onClick={() => setInfoAbierto((v) => !v)}
                onBlur={() => setInfoAbierto(false)}
                aria-label="Más información sobre el cálculo"
                style={{
                  width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border)',
                  background: 'transparent', color: 'var(--muted)', fontSize: 11, lineHeight: 1,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              >
                ⓘ
              </button>
              {infoAbierto && (
                <div style={{
                  position: 'absolute', top: 24, right: 0, zIndex: 10, width: 260,
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 12px', fontSize: 11, lineHeight: 1.5, color: 'var(--text-sec)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                  {monedaChart === 'ars'
                    ? 'Vista en ARS nominal: Cartera/S&P 500/Oro/Bitcoin se convierten a pesos vía dólar MEP para ser comparables con la inflación (IPC INDEC), que solo existe en pesos. Dólar MEP muestra la devaluación del peso.'
                    : 'Vista en USD: cada serie en su moneda nativa, sin convertir. La inflación argentina (IPC) no tiene valor en dólares y no se muestra en esta vista — cambiá a ARS para verla.'}
                  {' '}Mi Cartera es TWR (Time-Weighted Return): aísla el rendimiento de mercado del efecto de cuánto o cuándo aportaste. Es una aproximación por Modified Dietz mensual (no hay valuación diaria), igual al TWR de Resumen.
                </div>
              )}
            </span>
          </div>
          <div style={{ flex: 1, minHeight: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
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
                <Tooltip content={<CustomTooltip />} />
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
                      strokeWidth={id === 'cartera' ? 4 : 2}
                      strokeOpacity={id === 'cartera' ? 1 : 0.75}
                      strokeDasharray={SERIES_META[id].dashed ? '5 4' : undefined}
                      dot={false}
                      animationDuration={300}
                      connectNulls
                      activeDot={{ r: id === 'cartera' ? 6 : 5, fill: SERIES_META[id].color, strokeWidth: 0 }}
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
