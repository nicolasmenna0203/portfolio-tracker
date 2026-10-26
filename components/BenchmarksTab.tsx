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
// dorado de marca para la cartera propia, verde salvia para el mercado USD
// (S&P 500), terracota para inflación (costo/alerta a superar), lavanda para
// el MEP, naranja para Bitcoin, azul grisáceo para oro — antes "Oro" y "Mi
// Cartera" eran dos amarillos casi idénticos; oro pasa a un tono frío y a
// trazo punteado para que no compita visualmente con el dorado de la cartera.
const SERIES_META: Record<SeriesId, { label: string; shortLabel: string; tooltip?: string; color: string; dashed?: boolean }> = {
  cartera:   { label: 'Mi Cartera',              shortLabel: 'Mi Cartera',  color: '#cfab6e' },
  sp500:     { label: 'S&P 500',                 shortLabel: 'S&P 500',    color: '#5fb896' },
  inflacion: { label: 'Inflación (IPC INDEC)',   shortLabel: 'Inflación',  tooltip: 'IPC INDEC', color: '#c15c4a' },
  mep:       { label: 'Dólar MEP',               shortLabel: 'Dólar MEP', color: '#8d7fc7' },
  btc:       { label: 'Bitcoin',                 shortLabel: 'Bitcoin',    color: '#d9824e' },
  oro:       { label: 'Oro',                     shortLabel: 'Oro',        color: '#7a93a8', dashed: true },
};

const SERIES_ORDER: SeriesId[] = ['cartera', 'sp500', 'inflacion', 'mep', 'btc', 'oro'];

const VISIBLE_KEY = 'benchmarks_visible_v1';

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

  // Cartera como índice TWR (Time-Weighted Return) base 100: encadena el
  // rendimiento puro de cada mes — (total_fin - aportes_del_mes) / total_inicio —
  // para neutralizar el efecto de cuánto/cuándo aportaste y dejar solo el
  // rendimiento de mercado, comparable con los benchmarks externos.
  const carteraBase100 = useMemo(() => {
    const map = new Map<string, number>();
    if (resumenSeries.length === 0) return map;

    let indice = 100;
    map.set(toMesKey(resumenSeries[0].fechaTs), indice);
    for (let i = 1; i < resumenSeries.length; i++) {
      const anterior = resumenSeries[i - 1].total_cartera;
      const actual = resumenSeries[i].total_cartera;
      const aportesMes = resumenSeries[i].aportes;
      if (anterior > 0) {
        const rendimientoMes = (actual - aportesMes) / anterior;
        indice = indice * rendimientoMes;
      }
      map.set(toMesKey(resumenSeries[i].fechaTs), indice);
    }
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

  // Todo el gráfico se expresa en ARS: cada serie en USD (cartera TWR, S&P500,
  // oro, BTC) se multiplica por la devaluación acumulada del MEP antes de
  // re-indexar a 100, para que sea comparable en la misma moneda que la
  // inflación (que ya está en ARS). Si el MEP no tiene dato ese mes, se omite
  // el punto en vez de mostrar un valor engañoso. El propio MEP se muestra tal
  // cual (índice de devaluación del peso), sin pasar por la conversión.
  const chartData = useMemo(() => {
    const seriesExternas = resp?.series ?? [];
    return resumenSeries.map((r) => {
      const mesKey = toMesKey(r.fechaTs);
      const fx = factorMep.get(mesKey);

      const carteraUsd = carteraBase100.get(mesKey);
      const row: Record<string, number | string | undefined> = {
        mesKey,
        fecha: r.fecha,
        cartera: carteraUsd != null && fx != null ? carteraUsd * fx : undefined,
      };
      for (const s of seriesExternas) {
        if (s.id === 'inflacion' || s.id === 'mep') {
          row[s.id] = s.puntos.find((p) => p.mesKey === mesKey)?.valor; // ya en ARS / índice propio
          continue;
        }
        const valUsd = s.puntos.find((p) => p.mesKey === mesKey)?.valor;
        row[s.id] = valUsd != null && fx != null ? valUsd * fx : undefined;
      }
      return row;
    });
  }, [resumenSeries, carteraBase100, factorMep, resp]);

  const seriesConError = useMemo(() => {
    const map = new Map<BenchmarkId, string>();
    for (const s of resp?.series ?? []) {
      if (s.error) map.set(s.id, s.error);
    }
    return map;
  }, [resp]);

  const seriesActivas = useMemo(
    () => SERIES_ORDER.filter((id) => visible[id] && !seriesConError.get(id as BenchmarkId)),
    [visible, seriesConError],
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

      {/* ── Toggles de series: nombre corto + valor final (reemplaza la leyenda al pie) ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {SERIES_ORDER.map((id) => {
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
              Base 100 = {resumenSeries[0]?.fecha ?? 'primer mes'} · en ARS · cartera en TWR
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
                  position: 'absolute', top: 24, right: 0, zIndex: 10, width: 240,
                  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
                  padding: '10px 12px', fontSize: 11, lineHeight: 1.5, color: 'var(--text-sec)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                }}>
                  Cartera/S&P 500/Oro/Bitcoin se convierten a ARS vía dólar MEP para ser comparables con la inflación.
                  Dólar MEP muestra la devaluación del peso. Mi Cartera excluye el efecto de aportes/retiros (TWR,
                  Time-Weighted Return): aísla el rendimiento de mercado de cuánto o cuándo aportaste.
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
