'use client';

// Decisión y alternativas descartadas: docs/decisiones/0018-ratios-alineados-por-fecha-e-indicadores-en-el-cliente.md
//
// Ratios entre dos activos: serie del par A/B, indicadores técnicos sobre esa
// serie, y la lista de pares guardados.
//
// Los indicadores se calculan acá y no en el servidor a propósito: cambiar el
// período de una media móvil es una interacción de tanteo (se prueba 20, 50,
// 200 en segundos) y recalcular sobre la serie que ya está en memoria es
// instantáneo, mientras que un round-trip por cada ajuste haría la pestaña
// inusable. El servidor provee la serie; el cliente la interroga.

import { useState, useEffect, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  ComposedChart, Line, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { DashboardData, RangoHistorico, RatioResponse } from '@/types';
import type { RatioGuardado } from '@/lib/ratiosGuardados';
import { tickersDeCartera } from '@/lib/tickersElegibles';
import { sma, ema, bollinger, retornos, correlacionMovil } from '@/lib/ratios';
import { formatNumber, formatPercent, formatFechaEje } from '@/lib/format';
import Segmented from './Segmented';
import InfoTip from './InfoTip';
import { AvisoError } from './Estados';

// Referencias de mercado que no están en la cartera pero son el denominador
// natural de casi cualquier análisis: medir una posición contra el mercado, el
// oro o la tasa larga es lo que separa "subió" de "subió más que todo lo demás".
//
// Las dos cripto están en pares porque ETH/BTC es la lectura estándar del
// sector: casi todo lo cripto se mueve con BTC (ETH/BTC da correlación ~0,9 y
// beta ~1,3 a 6 meses), así que contra USD ambas cuentan la misma historia y
// una contra otra muestra cuál le está ganando.
const BENCHMARKS: { ticker: string; label: string }[] = [
  { ticker: 'SPY',     label: 'S&P 500 (SPY)' },
  { ticker: 'ACWI',    label: 'Mundo (ACWI)' },
  { ticker: 'QQQ',     label: 'Nasdaq 100 (QQQ)' },
  { ticker: 'GLD',     label: 'Oro (GLD)' },
  { ticker: 'TLT',     label: 'Bonos largos USA (TLT)' },
  { ticker: 'BTC-USD', label: 'Bitcoin' },
  { ticker: 'ETH-USD', label: 'Ethereum' },
  { ticker: 'EEM',     label: 'Emergentes (EEM)' },
];

const RANGOS: { id: RangoHistorico; label: string }[] = [
  { id: '1m', label: '1M' },
  { id: '6m', label: '6M' },
  { id: '1a', label: '1A' },
  { id: '5a', label: '5A' },
  { id: '10a', label: '10A' },
];

// Períodos ofrecidos como atajo. Son las ventanas convencionales del análisis
// técnico: 20 (un mes bursátil), 50 y 200 (los cruces que más se miran).
const PERIODOS = [0, 20, 50, 200];

const COLOR = {
  ratio:     '#0a84ff',
  sma1:      '#1e9ab0',
  sma2:      '#b455e8',
  banda:     '#f2385a',
  correl:    '#d96f00',
} as const;

type TipoMedia = 'sma' | 'ema';

interface Props {
  data: DashboardData;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

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
      <p className="tooltip-titulo">{label ? formatFechaEje(label, true, true) : ''}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} className="tooltip-fila">
            <span><span className="tooltip-marca" style={{ background: p.color }} />{p.name}</span>
            <span>{formatNumber(p.value, { decimals: 4 })}</span>
          </p>
        )
      ))}
    </div>
  );
}

// ── Tarjeta de métrica ───────────────────────────────────────────────────────

function Metrica({ label, valor, color, hint }: { label: string; valor: string; color?: string; hint?: string }) {
  return (
    <div className="kpi-card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <p className="kpi-label">{label}</p>
        {hint && <InfoTip label={label}>{hint}</InfoTip>}
      </div>
      <p className="kpi-value" style={{ fontSize: 20, ...(color ? { color } : null) }}>{valor}</p>
    </div>
  );
}

// ── Selector de activo ───────────────────────────────────────────────────────

function SelectorActivo({
  valor, onChange, cartera, label,
}: {
  valor: string;
  onChange: (v: string) => void;
  cartera: string[];
  label: string;
}) {
  return (
    <label className="campo-etiqueta columna" style={{ flex: '1 1 150px', maxWidth: 240 }}>
      {label}
      <select className="campo" value={valor} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Mi cartera">
          {cartera.map((t) => <option key={t} value={t}>{t}</option>)}
        </optgroup>
        <optgroup label="Referencias de mercado">
          {BENCHMARKS.map((b) => <option key={b.ticker} value={b.ticker}>{b.label}</option>)}
        </optgroup>
      </select>
    </label>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function RatiosTab({ data }: Props) {
  const { tenenciasPorMes } = data;

  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  // Universo de la cartera: tickers cotizables del último mes con datos.
  const tickersCartera = useMemo(() => {
    const meses = Object.keys(tenenciasPorMes).sort();
    const ultimo = meses[meses.length - 1];
    if (!ultimo) return [];
    return tickersDeCartera(tenenciasPorMes[ultimo] ?? []).tickersUsa;
  }, [tenenciasPorMes]);

  const [activoA, setActivoA] = useState('');
  const [activoB, setActivoB] = useState('SPY');
  const [rango, setRango] = useState<RangoHistorico>('1a');
  const [tipoMedia, setTipoMedia] = useState<TipoMedia>('sma');
  const [periodo1, setPeriodo1] = useState(20);
  const [periodo2, setPeriodo2] = useState(50);
  const [verBandas, setVerBandas] = useState(true);
  const [verCorrel, setVerCorrel] = useState(true);
  const [nota, setNota] = useState('');

  // Primer ticker de la cartera como valor inicial de A, una vez que se sabe
  // cuál es (las tenencias llegan del server component).
  useEffect(() => {
    if (!activoA && tickersCartera.length > 0) setActivoA(tickersCartera[0]);
  }, [tickersCartera, activoA]);

  const [resp, setResp] = useState<RatioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pares guardados
  const [guardados, setGuardados] = useState<RatioGuardado[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  // Guardar reemplaza la lista entera: hasta tenerla leída no se puede guardar, o se
  // pisarían los pares que no llegaron (ADR 0029). El análisis sigue funcionando.
  const [estadoLista, setEstadoLista] = useState<'cargando' | 'ok' | 'error'>('cargando');
  const [intentoLista, setIntentoLista] = useState(0);

  useEffect(() => {
    let cancelado = false;
    setEstadoLista('cargando');
    fetch(`${apiBase}/ratios-guardados`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        if (cancelado) return;
        setGuardados(json.ratios ?? []);
        setEstadoLista('ok');
      })
      .catch(() => { if (!cancelado) setEstadoLista('error'); });
    return () => { cancelado = true; };
  }, [apiBase, intentoLista]);

  useEffect(() => {
    if (!activoA || !activoB || activoA === activoB) { setResp(null); return; }
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/ratio?a=${encodeURIComponent(activoA)}&b=${encodeURIComponent(activoB)}&rango=${rango}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setResp(json as RatioResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [activoA, activoB, rango, apiBase]);

  // ── Serie del gráfico con los indicadores aplicados ────────────────────────

  const serieChart = useMemo(() => {
    if (!resp || resp.puntos.length === 0) return [];

    const valores = resp.puntos.map((p) => p.ratio);
    const fn = tipoMedia === 'sma' ? sma : ema;
    const media1 = periodo1 > 0 ? fn(valores, periodo1) : null;
    const media2 = periodo2 > 0 ? fn(valores, periodo2) : null;
    // Las bandas se calculan sobre el período de la primera media para que el
    // centro de las bandas y la media visible sean la misma línea; con dos
    // períodos distintos el gráfico mostraría dos "centros" contradictorios.
    const bandas = verBandas && periodo1 > 0 ? bollinger(valores, periodo1) : null;

    // La correlación móvil vive sobre retornos, que tienen un punto menos que
    // los precios: se desplaza uno para que cada fecha muestre la correlación
    // que termina en ese día, no la del día siguiente.
    const correl = verCorrel
      ? correlacionMovil(
          retornos(resp.puntos.map((p) => p.pxA)),
          retornos(resp.puntos.map((p) => p.pxB)),
          Math.max(periodo1 || 20, 5),
        )
      : null;

    return resp.puntos.map((p, i) => ({
      fecha: p.fecha,
      ratio: p.ratio,
      media1: media1?.[i] ?? null,
      media2: media2?.[i] ?? null,
      bandaSup: bandas?.superior[i] ?? null,
      bandaInf: bandas?.inferior[i] ?? null,
      correlacion: correl ? (i === 0 ? null : correl[i - 1]) : null,
    }));
  }, [resp, tipoMedia, periodo1, periodo2, verBandas, verCorrel]);

  const est = resp?.estadisticas ?? null;

  // ── Guardar / cargar / borrar ──────────────────────────────────────────────

  const persistir = useCallback(async (lista: RatioGuardado[]) => {
    setGuardando(true);
    setErrorGuardar(null);
    try {
      const res = await fetch(`${apiBase}/ratios-guardados`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ratios: lista }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      // Se toma la lista que devolvió el servidor, ya normalizada: si algo se
      // descartó al guardar, la pantalla lo refleja en vez de mostrar un par
      // que en el Sheet no quedó. En /demo el POST es un no-op fake-success
      // (json.ratios no viene), así que se conserva la lista local tal cual.
      setGuardados(json.ratios ?? lista);
    } catch (e) {
      setErrorGuardar(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  }, [apiBase]);

  function guardarActual() {
    const nuevo: RatioGuardado = {
      activoA, activoB, rango, nota: nota.trim(),
      sma1: periodo1, sma2: periodo2, bollinger: verBandas,
      creado: guardados.find((g) => g.activoA === activoA && g.activoB === activoB)?.creado
        ?? new Date().toISOString().slice(0, 10),
    };
    const resto = guardados.filter((g) => !(g.activoA === activoA && g.activoB === activoB));
    persistir([...resto, nuevo]);
  }

  function cargar(g: RatioGuardado) {
    setActivoA(g.activoA);
    setActivoB(g.activoB);
    setRango(g.rango);
    setPeriodo1(g.sma1);
    setPeriodo2(g.sma2);
    setVerBandas(g.bollinger);
    setNota(g.nota);
  }

  function borrar(g: RatioGuardado) {
    persistir(guardados.filter((x) => !(x.activoA === g.activoA && x.activoB === g.activoB)));
  }

  const yaGuardado = guardados.some((g) => g.activoA === activoA && g.activoB === activoB);
  const par = `${activoA}/${activoB}`;

  const colorVar = est == null ? 'var(--muted)' : est.variacion >= 0 ? 'var(--up)' : 'var(--down)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      {/* ── Controles: par, rango, indicadores ────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <SelectorActivo label="Activo" valor={activoA} onChange={setActivoA} cartera={tickersCartera} />
        <span aria-hidden="true" style={{ fontSize: 20, color: 'var(--muted)', paddingBottom: 5 }}>/</span>
        <SelectorActivo label="Contra" valor={activoB} onChange={setActivoB} cartera={tickersCartera} />

        <button
          type="button"
          className="app-bar-btn"
          onClick={() => { setActivoA(activoB); setActivoB(activoA); }}
          title="Invertir el par"
          aria-label="Invertir el par"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4" />
          </svg>
        </button>

        {/* Rango */}
        <Segmented opciones={RANGOS} activa={rango} onChange={setRango} chico etiqueta="Rango" style={{ alignSelf: 'flex-end', marginBottom: 2 }} />
      </div>

      {/* ── Indicadores ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px 16px', flexWrap: 'wrap',
        flexShrink: 0,
      }}>
        <Segmented
          opciones={[{ id: 'sma' as TipoMedia, label: 'SMA' }, { id: 'ema' as TipoMedia, label: 'EMA' }]}
          activa={tipoMedia}
          onChange={setTipoMedia}
          chico
          etiqueta="Tipo de media"
        />

        <label className="campo-etiqueta">
          <span aria-hidden="true" style={{ width: 12, height: 3, borderRadius: 2, background: COLOR.sma1 }} />
          Media 1
          <select className="campo chico" value={periodo1} onChange={(e) => setPeriodo1(Number(e.target.value))}>
            {PERIODOS.map((n) => <option key={n} value={n}>{n === 0 ? 'No' : `${n} días`}</option>)}
          </select>
        </label>

        <label className="campo-etiqueta">
          <span aria-hidden="true" style={{ width: 12, height: 3, borderRadius: 2, background: COLOR.sma2 }} />
          Media 2
          <select className="campo chico" value={periodo2} onChange={(e) => setPeriodo2(Number(e.target.value))}>
            {PERIODOS.map((n) => <option key={n} value={n}>{n === 0 ? 'No' : `${n} días`}</option>)}
          </select>
        </label>

        <button type="button" role="switch" aria-checked={verBandas} onClick={() => setVerBandas((v) => !v)} className="switch chico">
          <span className="switch-pista" aria-hidden="true" />
          Bandas de Bollinger
        </button>

        <button type="button" role="switch" aria-checked={verCorrel} onClick={() => setVerCorrel((v) => !v)} className="switch chico">
          <span className="switch-pista" aria-hidden="true" />
          Correlación móvil
        </button>
      </div>

      {/* ── Métricas del par ──────────────────────────────────────────────── */}
      {est && (
        <div style={{
          display: 'grid', gap: 10, flexShrink: 0,
          gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
        }}>
          <Metrica
            label="Ratio actual"
            valor={formatNumber(est.actual, { decimals: 4 })}
            hint={`Precio de ${activoA} dividido precio de ${activoB}, al último dato disponible`}
          />
          <Metrica
            label={`Var. ${rango}`}
            valor={formatPercent(est.variacion * 100)}
            color={colorVar}
            hint={`Cuánto rindió ${activoA} por encima (o por debajo) de ${activoB} en el período`}
          />
          <Metrica
            label="Percentil"
            valor={est.percentil == null ? 's/d' : formatPercent(est.percentil, { sign: false, decimals: 0 })}
            hint="Dónde está el ratio hoy dentro del rango mín-máx del período. 100% = máximo del período"
          />
          <Metrica
            label="Z-Score"
            valor={est.zScore == null ? 's/d' : formatNumber(est.zScore, { decimals: 2 })}
            color={est.zScore != null && Math.abs(est.zScore) > 2 ? 'var(--down)' : undefined}
            hint="Desvíos estándar respecto del promedio del período. |z| > 2 es un extremo estadístico"
          />
          <Metrica
            label="Correlación"
            valor={est.correlacion == null ? 's/d' : formatNumber(est.correlacion, { decimals: 2 })}
            hint="Correlación de los retornos diarios de ambos activos en el período"
          />
          <Metrica
            label="Beta"
            valor={est.beta == null ? 's/d' : formatNumber(est.beta, { decimals: 2 })}
            hint={`Cuánto se mueve ${activoA} por cada 1% que se mueve ${activoB}`}
          />
        </div>
      )}

      {/* ── Gráfico ───────────────────────────────────────────────────────── */}
      <div className="card" style={{ flex: 1, minHeight: 300, paddingBottom: 8, display: 'flex', flexDirection: 'column' }}>
        <div className="card-cabecera" style={{ display: 'block' }}>
          <p className="card-titulo">
            Evolución del ratio
            <span className="dato">{par}</span>
          </p>
          {est && (
            <p className="card-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>
              Mínimo {formatNumber(est.minimo, { decimals: 3 })}, promedio {formatNumber(est.promedio, { decimals: 3 })}, máximo {formatNumber(est.maximo, { decimals: 3 })}
            </p>
          )}
        </div>

        {loading && <span className="skeleton" role="status" aria-label="Cargando el ratio" style={{ flex: 1, minHeight: 200, borderRadius: 10, marginBottom: 8 }} />}
        {error && <div style={{ margin: 'auto' }}><AvisoError titulo="No se pudo calcular el ratio">{error}</AvisoError></div>}
        {!loading && !error && serieChart.length === 0 && (
          <p className="vacio" style={{ margin: 'auto' }}>
            {activoA === activoB
              ? 'Elegí dos activos distintos.'
              : 'Sin datos en común para este par en el rango elegido.'}
          </p>
        )}

        {!loading && !error && serieChart.length > 0 && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={serieChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                tickFormatter={(f) => formatFechaEje(f, rango === '1m' || rango === '6m')}
                minTickGap={40}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="ratio"
                tick={{ fontSize: 11, fill: 'var(--muted)' }}
                domain={['auto', 'auto']}
                tickFormatter={(v) => formatNumber(v, { decimals: 2 })}
                tickLine={false}
                axisLine={false}
                width={48}
              />
              {verCorrel && (
                // Eje propio y fijo en -1..1: la correlación no comparte escala
                // con el ratio, meterlas en el mismo eje aplasta una de las dos.
                <YAxis
                  yAxisId="correl"
                  orientation="right"
                  domain={[-1, 1]}
                  ticks={[-1, 0, 1]}
                  tick={{ fontSize: 11, fill: 'var(--muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={28}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: 'var(--text-sec)', paddingTop: 6 }} />

              {est?.promedio != null && (
                <ReferenceLine
                  yAxisId="ratio"
                  y={est.promedio}
                  stroke="var(--muted)"
                  strokeDasharray="4 4"
                  label={{ value: 'prom', fontSize: 9, fill: 'var(--muted)', position: 'insideTopRight' }}
                />
              )}

              {verBandas && periodo1 > 0 && (
                <>
                  <Line yAxisId="ratio" type="monotone" dataKey="bandaSup" name="Banda sup."
                    stroke={COLOR.banda} strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                  <Line yAxisId="ratio" type="monotone" dataKey="bandaInf" name="Banda inf."
                    stroke={COLOR.banda} strokeWidth={1} strokeDasharray="3 3" dot={false} connectNulls />
                </>
              )}

              <Line yAxisId="ratio" type="monotone" dataKey="ratio" name={par}
                stroke={COLOR.ratio} strokeWidth={2} dot={false} />

              {periodo1 > 0 && (
                <Line yAxisId="ratio" type="monotone" dataKey="media1"
                  name={`${tipoMedia.toUpperCase()} ${periodo1}`}
                  stroke={COLOR.sma1} strokeWidth={1.4} dot={false} connectNulls />
              )}
              {periodo2 > 0 && (
                <Line yAxisId="ratio" type="monotone" dataKey="media2"
                  name={`${tipoMedia.toUpperCase()} ${periodo2}`}
                  stroke={COLOR.sma2} strokeWidth={1.4} dot={false} connectNulls />
              )}
              {verCorrel && (
                <Line yAxisId="correl" type="monotone" dataKey="correlacion" name="Correlación"
                  stroke={COLOR.correl} strokeWidth={1} dot={false} connectNulls opacity={0.7} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Guardar el par ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <input
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder={`Por qué seguís ${par}…`}
          maxLength={200}
          aria-label={`Nota sobre el par ${par}`}
          className="campo"
          style={{ flex: 1, minWidth: 200 }}
        />
        <button
          type="button"
          className="g-btn tintado"
          onClick={guardarActual}
          disabled={guardando || estadoLista !== 'ok' || !activoA || !activoB || activoA === activoB}
        >
          {guardando ? 'Guardando…' : yaGuardado ? 'Actualizar par' : 'Guardar par'}
        </button>
        {errorGuardar && (
          <span role="alert" style={{ fontSize: 13, color: 'var(--down)' }}>No se pudo guardar: {errorGuardar}</span>
        )}
        {estadoLista === 'error' && (
          <span role="alert" style={{ fontSize: 13, color: 'var(--down)' }}>
            No se pudieron leer los pares guardados: guardar queda desactivado para no pisarlos.{' '}
            <button type="button" className="g-btn chico" onClick={() => setIntentoLista((n) => n + 1)}>Reintentar</button>
          </span>
        )}
      </div>

      {/* ── Pares guardados ───────────────────────────────────────────────── */}
      {guardados.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <p className="card-titulo" style={{ margin: '4px 0 8px' }}>Pares guardados</p>
          <div className="chips">
            {guardados.map((g) => {
              const activo = g.activoA === activoA && g.activoB === activoB;
              return (
                <span
                  key={`${g.activoA}/${g.activoB}`}
                  title={g.nota || undefined}
                  className="chip"
                  aria-pressed={activo}
                  style={{ padding: '0 4px 0 0', cursor: 'default' }}
                >
                  <button
                    type="button"
                    onClick={() => cargar(g)}
                    aria-pressed={activo}
                    style={{
                      alignSelf: 'stretch', background: 'none', border: 'none', cursor: 'pointer',
                      color: 'inherit', font: 'inherit', padding: '0 4px 0 12px', borderRadius: 999,
                    }}
                  >
                    {g.activoA}/{g.activoB}
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}> {g.rango.toUpperCase()}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => borrar(g)}
                    aria-label={`Borrar ${g.activoA}/${g.activoB}`}
                    className="cerrar-btn"
                    style={{ width: 22, height: 22, background: 'transparent' }}
                  >
                    <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                      <path d="M2 2l8 8M10 2l-8 8" />
                    </svg>
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
