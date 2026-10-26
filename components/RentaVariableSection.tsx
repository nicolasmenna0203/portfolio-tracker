'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer,
} from 'recharts';
import type { RangoHistorico, StockPerformance } from '@/types';
import { usePerformanceVariable } from '@/lib/usePerformanceVariable';
import { useHistoricoTicker } from '@/lib/useHistoricoTicker';
import { formatMoney, formatPercent, formatNumber, CURRENCY_PREFIX } from '@/lib/format';
import { PALETA_TIPO } from '@/lib/constants';
import KPICard from './KPICard';
import SectoresMercado from './SectoresMercado';

interface Props {
  tickersUsa: string[];
  tenencias: Record<string, number>;
  /** Posiciones de renta variable que son fondos CAFCI: su precio es el VCP de la planilla. */
  tickersFci?: string[];
}

const RANGOS: { id: RangoHistorico; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '6m', label: '6M' },
  { id: '1a', label: '1A' },
  { id: '5a', label: '5A' },
  { id: '10a', label: '10A' },
];

/** Precio de acciones/CEDEARs/ETFs: siempre cotiza en USD en el proveedor de precios. */
function fmtPx(v: number): string {
  return formatMoney(v, { currency: 'USD', mode: 'price' });
}

/** Los fondos cotizan por VCP, que puede estar en pesos: la moneda tiene que ir explícita. */
function fmtPrecio(a: StockPerformance): string {
  if (!a.esFci) return fmtPx(a.px);
  return formatMoney(a.px, { currency: a.fciMoneda === 'USD' ? 'USD' : 'ARS', mode: 'price' });
}

function fmtPct1(v: number): string {
  return formatPercent(v * 100);
}

function colorVar(v: number | null): string {
  if (v == null) return 'var(--muted)';
  return v >= 0 ? 'var(--up)' : 'var(--down)';
}

/** Market cap con sufijos T/B/M: caso de dominio específico de capitalización
 * bursátil, no un monto de cartera, así que no pasa por formatMoney — pero
 * respeta la misma convención es-AR (coma decimal) y el prefijo de moneda
 * centralizado en vez de un "$" literal. */
function fmtCompact(v: number): string {
  const prefijo = CURRENCY_PREFIX.USD;
  if (v >= 1e12) return `${prefijo} ${formatNumber(v / 1e12, { decimals: 2 })}T`;
  if (v >= 1e9) return `${prefijo} ${formatNumber(v / 1e9, { decimals: 2 })}B`;
  if (v >= 1e6) return `${prefijo} ${formatNumber(v / 1e6, { decimals: 1 })}M`;
  return formatMoney(v, { currency: 'USD' });
}

type SortKey = 'ticker' | 'variacion1d' | 'variacionYtd' | 'peRatio' | 'marketCap' | 'dividendYield';

interface ChartTooltipPayload {
  payload: { fecha: string; close: number };
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: ChartTooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '8px 12px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ margin: '0 0 2px', color: 'var(--muted)', fontSize: 11 }}>{p.fecha}</p>
      <p style={{ margin: 0, fontWeight: 700, color: 'var(--text)' }}>{fmtPx(p.close)}</p>
    </div>
  );
}

export default function RentaVariableSection({ tickersUsa, tenencias, tickersFci = [] }: Props) {
  const { data: perf, loading, error } = usePerformanceVariable(tickersUsa, tenencias, tickersFci);

  const [sortKey, setSortKey] = useState<SortKey>('variacion1d');
  const [sortDesc, setSortDesc] = useState(true);
  const [tickerSel, setTickerSel] = useState<string | null>(null);
  const [rango, setRango] = useState<RangoHistorico>('1a');
  const preseleccionado = useRef(false);

  const acciones = perf?.acciones ?? [];

  // Al cargar, preseleccionar el ticker con mayor tenencia (el más relevante de la
  // cartera) para no dejar el gráfico en blanco al entrar al tab.
  useEffect(() => {
    if (preseleccionado.current || acciones.length === 0) return;
    // Los fondos no tienen serie de precios en el proveedor, así que no pueden
    // quedar preseleccionados: el gráfico se quedaría vacío al entrar al tab.
    const graficables = acciones.filter((a) => !a.esFci);
    if (graficables.length === 0) return;
    preseleccionado.current = true;
    const conTenencia = graficables.filter((a) => a.tenenciaUsd != null);
    const base = conTenencia.length > 0 ? conTenencia : graficables;
    const top = [...base].sort((a, b) => (b.tenenciaUsd ?? 0) - (a.tenenciaUsd ?? 0))[0];
    setTickerSel(top.ticker);
  }, [acciones]);

  const { data: historico, loading: loadingHist } = useHistoricoTicker(tickerSel, rango);

  const valorTotalCartera = useMemo(
    () => acciones.reduce((s, a) => s + (a.tenenciaUsd ?? 0), 0),
    [acciones],
  );

  const hayFci = acciones.some((a) => a.esFci);

  const accionesOrdenadas = useMemo(() => {
    const copia = [...acciones];
    copia.sort((a, b) => {
      let cmp: number;
      if (sortKey === 'ticker') cmp = a.ticker.localeCompare(b.ticker);
      else {
        const av = a[sortKey];
        const bv = b[sortKey];
        cmp = (av ?? -Infinity) - (bv ?? -Infinity);
      }
      return sortDesc ? -cmp : cmp;
    });
    return copia;
  }, [acciones, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const cabecera = (key: SortKey, label: string, title?: string) => (
    <th
      onClick={() => toggleSort(key)}
      title={title}
      style={{
        cursor: title ? 'help' : 'pointer', textAlign: 'right', padding: '8px 10px',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: sortKey === key ? 'var(--primary)' : 'var(--muted)', whiteSpace: 'nowrap',
      }}
    >
      {label}{sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando métricas de renta variable…</p>
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

  if (acciones.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '24px', fontSize: 13, color: 'var(--muted)', textAlign: 'center',
      }}>
        No hay acciones, CEDEARs ni ETFs en tu cartera actual.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* ── KPIs de renta variable ────────────────────────────────────────── */}
      <div className="kpi-grid">
        <KPICard
          label="Valor en cartera"
          value={formatMoney(valorTotalCartera, { currency: 'USD' })}
          sub={`${acciones.filter((a) => a.tenenciaUsd).length} de ${acciones.length} posiciones${hayFci ? ' · incluye fondos (VCP de CAFCI)' : ''}`}
          accentColor="var(--primary)"
        />
      </div>

      {/* ── Gráfico histórico de precio ──────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '14px 16px 8px', minHeight: 320, display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 10, flexShrink: 0 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-sec)', margin: 0 }}>
              Histórico de precio {tickerSel ? `· ${tickerSel}` : ''}
            </p>
            <span style={{ fontSize: 10, color: 'var(--muted)' }}>
              Precio de cierre · elegí un ticker en la tabla
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {RANGOS.map((r) => {
              const activo = rango === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setRango(r.id)}
                  className="pill-touch"
                  aria-pressed={activo}
                  style={{
                    padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                    cursor: 'pointer', border: '1px solid',
                    borderColor: activo ? 'var(--primary)' : 'var(--border)',
                    background: activo ? 'var(--primary-dim)' : 'transparent',
                    color: activo ? 'var(--primary)' : 'var(--muted)',
                  }}
                >{r.label}</button>
              );
            })}
          </div>
        </div>
        <div style={{ height: 280, position: 'relative' }}>
          {loadingHist && (
            <p style={{ position: 'absolute', inset: 0, margin: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
              Cargando histórico…
            </p>
          )}
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={historico?.puntos ?? []} margin={{ top: 5, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="rvPrecioFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border-subtle)" vertical={false} />
              <XAxis
                dataKey="fecha" tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false} axisLine={false}
                minTickGap={40}
              />
              <YAxis
                dataKey="close" domain={['auto', 'auto']}
                tickFormatter={(v) => fmtPx(v)}
                tick={{ fill: 'var(--muted)', fontSize: 11 }}
                tickLine={false} axisLine={false} width={56}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--border)', strokeDasharray: '3 3' }} />
              <Area
                type="monotone" dataKey="close"
                stroke="var(--primary)" strokeWidth={2}
                fill="url(#rvPrecioFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Tabla de fundamentals ────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: sortKey === 'ticker' ? 'var(--primary)' : 'var(--muted)' }}>
                Ticker{sortKey === 'ticker' ? (sortDesc ? ' ▼' : ' ▲') : ''}
              </th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Precio</th>
              {cabecera('variacion1d', 'Var. 1D')}
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Var. 1M</th>
              {cabecera('variacionYtd', 'Var. YTD')}
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Var. 1A</th>
              {cabecera('peRatio', 'P/E')}
              {cabecera('marketCap', 'Market Cap')}
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>Rango 52s</th>
              {cabecera('dividendYield', 'Yield')}
            </tr>
          </thead>
          <tbody>
            {accionesOrdenadas.map((a: StockPerformance) => {
              const activo = a.ticker === tickerSel;
              return (
                <tr
                  key={a.ticker}
                  onClick={() => { if (!a.esFci) setTickerSel(a.ticker); }}
                  style={{
                    borderBottom: '1px solid var(--border-subtle)',
                    background: activo ? 'var(--primary-dim)' : a.tenenciaUsd ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent',
                    cursor: a.esFci ? 'default' : 'pointer',
                  }}
                >
                  <td style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--text)' }}>
                    {a.ticker}{a.tenenciaUsd ? ' ★' : ''}
                    {a.esFci && (
                      <span
                        title={`Fondo común de inversión (${a.nombre ?? 'CAFCI'}). No cotiza en el proveedor de precios: el valor es el VCP de la planilla de CAFCI${a.fciFecha ? ` al ${a.fciFecha}` : ''}, en ${a.fciMoneda ?? 'su moneda'}, y las variaciones son los rendimientos publicados (mes, año y 12 meses).`}
                        style={{
                          marginLeft: 6, fontSize: 9, fontWeight: 700, cursor: 'help',
                          padding: '1px 5px', borderRadius: 4, verticalAlign: 'middle',
                          color: PALETA_TIPO.FCI, background: `${PALETA_TIPO.FCI}22`,
                        }}
                      >FCI</span>
                    )}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtPrecio(a)}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: colorVar(a.variacion1d), fontVariantNumeric: 'tabular-nums' }}>{a.variacion1d != null ? fmtPct1(a.variacion1d) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: colorVar(a.variacion1m), fontVariantNumeric: 'tabular-nums' }}>{a.variacion1m != null ? fmtPct1(a.variacion1m) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: colorVar(a.variacionYtd), fontVariantNumeric: 'tabular-nums' }}>{a.variacionYtd != null ? fmtPct1(a.variacionYtd) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: colorVar(a.variacion1a), fontVariantNumeric: 'tabular-nums' }}>{a.variacion1a != null ? fmtPct1(a.variacion1a) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{a.peRatio != null ? formatNumber(a.peRatio, { decimals: 1 }) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{a.marketCap != null ? fmtCompact(a.marketCap) : '—'}</td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    {a.fiftyTwoWeekLow != null && a.fiftyTwoWeekHigh != null ? `${fmtPx(a.fiftyTwoWeekLow)} – ${fmtPx(a.fiftyTwoWeekHigh)}` : '—'}
                  </td>
                  <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{a.dividendYield != null ? fmtPct1(a.dividendYield) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hayFci && (
        <p style={{ margin: 0, fontSize: 10, color: 'var(--muted)' }}>
          Las filas marcadas <strong>FCI</strong> son fondos comunes de inversión: no cotizan en el proveedor de precios, así que el
          valor es el VCP de la Planilla Diaria de CAFCI (en la moneda del fondo) y las columnas de variación son los rendimientos
          publicados de mes, año y 12 meses. No tienen P/E, market cap, rango de 52 semanas ni gráfico de precio.
        </p>
      )}

      {/* ── Sectores del mercado ──────────────────────────────────────────── */}
      <SectoresMercado />
    </div>
  );
}
