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
import { formatNumber, formatPercent } from '@/lib/format';

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
  ratio:     '#cfab6e',
  sma1:      '#5fb896',
  sma2:      '#8d7fc7',
  banda:     '#c15c4a',
  correl:    '#d9824e',
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
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(p.value, { decimals: 4 })}</strong>
          </p>
        )
      ))}
    </div>
  );
}

// ── Tarjeta de métrica ───────────────────────────────────────────────────────

function Metrica({ label, valor, color, hint }: { label: string; valor: string; color?: string; hint?: string }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '10px 14px', minWidth: 0,
    }}>
      <p style={{
        display: 'flex', alignItems: 'center', gap: 4,
        fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--muted)', margin: 0,
      }}>
        {label}
        {hint && <InfoHint texto={hint} />}
      </p>
      <p style={{ fontSize: 17, fontWeight: 700, color: color ?? 'var(--text)', margin: '3px 0 0', fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </p>
    </div>
  );
}

// Ícono de info con tooltip propio: un `title` nativo no tiene ningún
// indicio visual de que existe, así que nadie hace hover para descubrirlo.
// El ícono hace explícito que hay una explicación disponible.
function InfoHint({ texto }: { texto: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      tabIndex={0}
      role="button"
      aria-label={texto}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      style={{ position: 'relative', display: 'inline-flex', cursor: 'help' }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="7" stroke="var(--muted)" strokeWidth="1.3" />
        <circle cx="8" cy="4.6" r="0.9" fill="var(--muted)" />
        <path d="M8 7.2v4.6" stroke="var(--muted)" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      {visible && (
        <span style={{
          position: 'absolute', bottom: 'calc(100% + 6px)', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '8px 10px', fontSize: 11, fontWeight: 400, letterSpacing: 'normal', textTransform: 'none',
          color: 'var(--text-sec)', width: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          zIndex: 10, pointerEvents: 'none',
        }}>
          {texto}
        </span>
      )}
    </span>
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 150 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        {label}
      </span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: '7px 10px', borderRadius: 8, fontSize: 13,
          background: 'var(--card)', color: 'var(--text)',
          border: '1px solid var(--border)', cursor: 'pointer',
        }}
      >
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

  useEffect(() => {
    fetch(`${apiBase}/ratios-guardados`)
      .then((r) => r.json())
      .then((json) => { if (!json.error) setGuardados(json.ratios ?? []); })
      .catch(() => { /* la lista vacía es un estado válido, no vale romper la pestaña */ });
  }, [apiBase]);

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
        <span style={{ fontSize: 20, color: 'var(--muted)', paddingBottom: 6 }}>/</span>
        <SelectorActivo label="Contra" valor={activoB} onChange={setActivoB} cartera={tickersCartera} />

        <button
          onClick={() => { setActivoA(activoB); setActivoB(activoA); }}
          title="Invertir el par"
          style={{
            padding: '7px 12px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
            background: 'transparent', color: 'var(--muted)',
            border: '1px solid var(--border)',
          }}
        >⇄</button>

        <div style={{ width: 1, height: 32, background: 'var(--border)' }} />

        {/* Rango */}
        <div className="scroll-x" style={{ display: 'flex', gap: 3 }}>
          {RANGOS.map((r) => (
            <button
              key={r.id}
              className="pill-touch"
              onClick={() => setRango(r.id)}
              style={{
                padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: rango === r.id ? 'var(--primary)' : 'var(--border)',
                background: rango === r.id ? 'var(--primary-dim)' : 'transparent',
                color: rango === r.id ? 'var(--primary)' : 'var(--muted)',
                transition: 'all 0.12s',
              }}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── Indicadores ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        flexShrink: 0, fontSize: 11, color: 'var(--muted)',
      }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {(['sma', 'ema'] as TipoMedia[]).map((t) => (
            <button
              key={t}
              className="pill-touch"
              onClick={() => setTipoMedia(t)}
              style={{
                padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: tipoMedia === t ? 'var(--primary)' : 'var(--border)',
                background: tipoMedia === t ? 'var(--primary-dim)' : 'transparent',
                color: tipoMedia === t ? 'var(--primary)' : 'var(--muted)',
              }}
            >{t.toUpperCase()}</button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: COLOR.sma1, fontWeight: 700 }}>▬</span> Media 1
          <select
            value={periodo1}
            onChange={(e) => setPeriodo1(Number(e.target.value))}
            style={{
              padding: '3px 6px', borderRadius: 6, fontSize: 11,
              background: 'var(--card)', color: 'var(--text)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            {PERIODOS.map((n) => <option key={n} value={n}>{n === 0 ? 'off' : n}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ color: COLOR.sma2, fontWeight: 700 }}>▬</span> Media 2
          <select
            value={periodo2}
            onChange={(e) => setPeriodo2(Number(e.target.value))}
            style={{
              padding: '3px 6px', borderRadius: 6, fontSize: 11,
              background: 'var(--card)', color: 'var(--text)',
              border: '1px solid var(--border)', cursor: 'pointer',
            }}
          >
            {PERIODOS.map((n) => <option key={n} value={n}>{n === 0 ? 'off' : n}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={verBandas} onChange={(e) => setVerBandas(e.target.checked)} />
          Bandas de Bollinger
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={verCorrel} onChange={(e) => setVerCorrel(e.target.checked)} />
          Correlación móvil
        </label>
      </div>

      {/* ── Métricas del par ──────────────────────────────────────────────── */}
      {est && (
        <div style={{
          display: 'grid', gap: 8, flexShrink: 0,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
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
      <div style={{
        flex: 1, minHeight: 280,
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '14px 10px 6px',
        display: 'flex', flexDirection: 'column',
      }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-sec)', margin: '0 0 6px 10px' }}>
          {par} · evolución del ratio
          {est && (
            <span style={{ color: 'var(--muted)', fontWeight: 400, fontVariantNumeric: 'tabular-nums' }}>
              {' '}· mín {formatNumber(est.minimo, { decimals: 3 })} · prom {formatNumber(est.promedio, { decimals: 3 })} · máx {formatNumber(est.maximo, { decimals: 3 })}
            </span>
          )}
        </p>

        {loading && <p style={{ color: 'var(--muted)', fontSize: 13, margin: 'auto' }}>Cargando…</p>}
        {error && <p style={{ color: 'var(--down)', fontSize: 13, margin: 'auto' }}>{error}</p>}
        {!loading && !error && serieChart.length === 0 && (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 'auto' }}>
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
                tick={{ fontSize: 10, fill: 'var(--muted)' }}
                minTickGap={40}
                stroke="var(--border)"
              />
              <YAxis
                yAxisId="ratio"
                tick={{ fontSize: 10, fill: 'var(--muted)' }}
                domain={['auto', 'auto']}
                stroke="var(--border)"
                width={58}
              />
              {verCorrel && (
                // Eje propio y fijo en -1..1: la correlación no comparte escala
                // con el ratio, meterlas en el mismo eje aplasta una de las dos.
                <YAxis
                  yAxisId="correl"
                  orientation="right"
                  domain={[-1, 1]}
                  ticks={[-1, 0, 1]}
                  tick={{ fontSize: 10, fill: 'var(--muted)' }}
                  stroke="var(--border)"
                  width={32}
                />
              )}
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />

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
          style={{
            flex: 1, minWidth: 200, padding: '7px 12px', borderRadius: 8, fontSize: 12,
            background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)',
          }}
        />
        <button
          onClick={guardarActual}
          disabled={guardando || !activoA || !activoB || activoA === activoB}
          style={{
            padding: '7px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: guardando ? 'default' : 'pointer',
            background: 'var(--primary-dim)', color: 'var(--primary)',
            border: '1px solid var(--primary)', opacity: guardando ? 0.6 : 1,
          }}
        >
          {guardando ? 'Guardando…' : yaGuardado ? 'Actualizar par' : 'Guardar par'}
        </button>
        {errorGuardar && (
          <span style={{ fontSize: 11, color: 'var(--down)' }}>{errorGuardar}</span>
        )}
      </div>

      {/* ── Pares guardados ───────────────────────────────────────────────── */}
      {guardados.length > 0 && (
        <div style={{ flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 6px' }}>
            Pares guardados
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {guardados.map((g) => {
              const activo = g.activoA === activoA && g.activoB === activoB;
              return (
                <div
                  key={`${g.activoA}/${g.activoB}`}
                  title={g.nota || undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '4px 6px 4px 12px', borderRadius: 20,
                    border: '1px solid', fontSize: 11, fontWeight: 600,
                    borderColor: activo ? 'var(--primary)' : 'var(--border)',
                    background: activo ? 'var(--primary-dim)' : 'transparent',
                    color: activo ? 'var(--primary)' : 'var(--text-sec)',
                  }}
                >
                  <button
                    onClick={() => cargar(g)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'inherit', fontSize: 11, fontWeight: 600, padding: 0,
                    }}
                  >
                    {g.activoA}/{g.activoB}
                    <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {g.rango}</span>
                  </button>
                  <button
                    onClick={() => borrar(g)}
                    aria-label={`Borrar ${g.activoA}/${g.activoB}`}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--muted)', fontSize: 13, lineHeight: 1, padding: '0 2px',
                    }}
                  >×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
