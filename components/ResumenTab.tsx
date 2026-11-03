'use client';

// Pestaña Resumen: KPIs agregados de la cartera (total, ganancia, TWR, TIR)
// con selector de período, más la evolución temporal. Extraído de Dashboard.tsx
// para que cada pestaña sea su propio archivo, igual que el resto.
//
// En ARS hay un toggle "Ajustar por inflación": deflacta los campos ARS de la
// serie y de los movimientos con el IPC INDEC (lib/inflacion.ts) ANTES de
// calcular nada, así que KPIs y gráfico leen la misma serie y no hay una
// segunda fórmula. Ver docs/decisiones/0024-ajuste-por-inflacion-con-ipc-indec.md

import { useState, useMemo, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { DashboardData, BenchmarksResponse } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import { calcularMetricasPeriodo, recortarSerie, PERIODOS, type PeriodoId } from '@/lib/periodo';
import { deflactarARS, ultimoMesPublicado, type PuntoIndice } from '@/lib/inflacion';
import KPICard from './KPICard';
import EvolucionChart from './EvolucionChart';

const INFLACION_KEY = 'resumen_inflacion_v1';

function mesKeyDe(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
}

export default function ResumenTab({ data, hideValues, moneda }: Props) {
  const { kpis, resumenSeries, tenenciasPorMes, movimientos } = data;

  // ── Ajuste por inflación (solo ARS) ─────────────────────────────────────
  // El IPC se pide recién al prender el toggle, a la misma ruta que usa la
  // pestaña Benchmarks (en /demo, al espejo sintético).
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';
  const [ajustar, setAjustar] = useState(false);
  const [indice, setIndice] = useState<{ meses: string; puntos: PuntoIndice[] } | null>(null);
  const [errorIpc, setErrorIpc] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(INFLACION_KEY) === '1') setAjustar(true); } catch {}
  }, []);

  function toggleAjuste() {
    setAjustar((prev) => {
      const next = !prev;
      try { localStorage.setItem(INFLACION_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  }

  const mesesKey = useMemo(() => resumenSeries.map((r) => mesKeyDe(r.fechaTs)).join(','), [resumenSeries]);

  useEffect(() => {
    if (moneda !== 'ARS' || !ajustar || mesesKey === '' || indice?.meses === mesesKey) return;
    let cancelado = false;
    setErrorIpc(false);
    fetch(`${apiBase}/benchmarks?meses=${mesesKey}`)
      .then((r) => r.json())
      .then((json: BenchmarksResponse & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        const puntos = json.series.find((s) => s.id === 'inflacion')?.puntos ?? [];
        if (puntos.length === 0) throw new Error('sin datos de inflación');
        if (!cancelado) setIndice({ meses: mesesKey, puntos: puntos.map((p) => ({ mesKey: p.mesKey, valor: p.valor })) });
      })
      .catch(() => { if (!cancelado) setErrorIpc(true); });
    return () => { cancelado = true; };
  }, [moneda, ajustar, mesesKey, apiBase, indice?.meses]);

  const real = useMemo(
    () => (moneda === 'ARS' && ajustar && indice?.meses === mesesKey
      ? deflactarARS(resumenSeries, movimientos, indice.puntos)
      : null),
    [moneda, ajustar, indice, mesesKey, resumenSeries, movimientos],
  );
  const esReal = real != null;
  const serie = real?.resumenSeries ?? resumenSeries;
  const movs = real?.movimientos ?? movimientos;

  const etiquetaMes = (mesKey: string | null) =>
    mesKey == null ? null : resumenSeries.find((r) => mesKeyDe(r.fechaTs) === mesKey)?.fecha ?? mesKey;
  const mesIpc = esReal && indice ? ultimoMesPublicado(indice.puntos) : null;

  // Delta de "Total Cartera" vs el mes anterior, en ARS (KPI #1). El total en
  // ARS ya viene calculado en origen con el MEP real de cierre de cada mes. Con
  // el ajuste activo, el mes anterior va en pesos del último mes: la variación
  // es real.
  const kpisArs = useMemo(() => {
    if (moneda === 'USD') return null;
    const penultimo = serie[serie.length - 2];
    const deltaCarteraArs = penultimo != null ? kpis.totalCarteraArs - penultimo.total_cartera_ars : 0;
    return { deltaCarteraArs };
  }, [moneda, serie, kpis.totalCarteraArs]);

  // Selector de período para Ganancia / TWR / TIR (KPIs 2 a 4) y el gráfico. "Máximo" es
  // siempre el punto de partida al entrar a la pestaña (sin persistir en
  // localStorage): coincide con lo que mostraban antes "Rendimiento Neto" y
  // "TIR Anual" sin selector. Ver lib/periodo.ts y
  // docs/decisiones/0022-twr-modified-dietz-encadenado.md
  const [periodo, setPeriodo] = useState<PeriodoId>('max');

  const metricasPeriodo = useMemo(
    () => calcularMetricasPeriodo(serie, movs, periodo),
    [serie, movs, periodo],
  );

  const deltaColor = kpis.deltaCartera >= 0 ? 'var(--up)' : 'var(--down)';

  const gananciaPeriodoUsd = metricasPeriodo?.gananciaUsd ?? 0;
  const gananciaPeriodoArs = metricasPeriodo?.gananciaArs ?? 0;
  const rendColor = (moneda === 'USD' ? gananciaPeriodoUsd : gananciaPeriodoArs) >= 0 ? 'var(--up)' : 'var(--down)';

  // Subtexto de "Ganancia Acumulada": el % que representa sobre el capital que
  // la generó. En "Máximo" ese capital son los aportes netos; en un tramo
  // acotado también entra lo que ya estaba invertido al arrancar, así que la
  // leyenda lo dice para que el denominador no quede ambiguo.
  const gananciaPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.gananciaPctUsd : metricasPeriodo.gananciaPctArs)
    : null;
  const gananciaSub = gananciaPct == null
    ? 'sobre el período elegido'
    : `${formatPercent(gananciaPct)} sobre ${periodo === 'max' ? 'aportes' : 'el capital invertido'}${esReal ? ' · real' : ''}`;

  const twrPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.twrAcumuladoPct : metricasPeriodo.twrAcumuladoArsPct)
    : null;
  const twrColor = twrPct == null ? 'var(--muted)' : twrPct >= 0 ? 'var(--up)' : 'var(--down)';

  const tirPeriodoPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.tirAnualPct : metricasPeriodo.tirAnualArsPct)
    : null;
  const tirColor = tirPeriodoPct == null ? 'var(--muted)' : tirPeriodoPct >= 0 ? 'var(--up)' : 'var(--down)';

  // TWR anualizado: submétrica del KPI de TWR. La TIR es anual por construcción,
  // así que este es el número del TWR comparable con ella (el acumulado del
  // KPI no lo es: en tramos cortos difieren mucho).
  const twrAnualPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.twrAnualizadoPct : metricasPeriodo.twrAnualizadoArsPct)
    : null;

  return (
    <>
      {/* Selector de período para Ganancia / TWR / TIR (KPIs 2 a 4) y el gráfico */}
      <div className="pill-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {PERIODOS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriodo(p.id)}
            className="pill-touch"
            aria-pressed={periodo === p.id}
            style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid',
              borderColor: periodo === p.id ? 'var(--primary)' : 'var(--border)',
              background: periodo === p.id ? 'var(--primary-dim)' : 'transparent',
              color: periodo === p.id ? 'var(--primary)' : 'var(--muted)',
              transition: 'all 0.12s',
            }}
          >
            {p.label}
          </button>
        ))}
        {moneda === 'ARS' && (
          <button
            onClick={toggleAjuste}
            className="pill-touch"
            aria-pressed={ajustar}
            title="Expresa la serie en pesos constantes del último mes, deflactada con el IPC del INDEC"
            style={{
              marginLeft: 'auto',
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid',
              borderColor: ajustar ? 'var(--primary)' : 'var(--border)',
              background: ajustar ? 'var(--primary-dim)' : 'transparent',
              color: ajustar ? 'var(--primary)' : 'var(--muted)',
              transition: 'all 0.12s',
            }}
          >
            {ajustar ? '✓ ' : ''}Ajustar por inflación
          </button>
        )}
      </div>

      <div className="kpi-grid-resumen">
        <KPICard
          label="Total Cartera"
          tooltip={`Valuación total de la cartera al ${kpis.fechaStr}.`}
          value={
            moneda === 'USD'
              ? formatMoney(kpis.totalCartera, { currency: 'USD', hidden: hideValues })
              : formatMoney(kpis.totalCarteraArs, { currency: 'ARS', hidden: hideValues })
          }
          sub={
            hideValues ? '••••' :
            moneda === 'USD'
              ? `${kpis.deltaCartera >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(kpis.deltaCartera), { currency: 'USD' })} vs mes anterior`
              : kpisArs
                ? `${kpisArs.deltaCarteraArs >= 0 ? '▲' : '▼'} ${formatMoney(Math.abs(kpisArs.deltaCarteraArs), { currency: 'ARS' })} vs mes anterior`
                : 's/d vs mes anterior'
          }
          subColor={moneda === 'ARS' && kpisArs ? (kpisArs.deltaCarteraArs >= 0 ? 'var(--up)' : 'var(--down)') : deltaColor}
          accentColor="var(--primary)"
        />
        <KPICard
          label="Ganancia Acumulada"
          tooltip={
            periodo === 'max'
              ? 'Valuación menos aportes netos (excluye traspasos entre cuentas propias). El % es sobre lo aportado. No pondera cuándo entró cada peso — para eso están TWR y TIR.'
              : 'Lo ganado dentro del período: valuación final menos la del arranque y menos los aportes del tramo. El % es sobre el capital que lo generó (lo que ya estaba invertido más lo aportado en el período).'
          }
          value={
            moneda === 'USD'
              ? formatMoney(gananciaPeriodoUsd, { currency: 'USD', hidden: hideValues, sign: true })
              : formatMoney(gananciaPeriodoArs, { currency: 'ARS', hidden: hideValues, sign: true })
          }
          sub={hideValues ? '••••' : gananciaSub}
          subColor={rendColor}
          accentColor={rendColor}
        />
        <KPICard
          label="Retorno TWR"
          tooltip="Time-Weighted Return: rendimiento puro de la inversión, sin el efecto de cuándo o cuánto aportaste. Se aproxima encadenando Modified Dietz mes a mes (no hay valuación diaria del Sheet)."
          value={twrPct != null ? formatPercent(twrPct, { sign: false }) : 'N/D'}
          sub={esReal ? 'rendimiento real de la cartera' : 'rendimiento de la cartera'}
          subColor={twrColor}
          accentColor={twrColor}
          extra={
            <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>
              TWR anual{' '}
              <span style={{ color: twrColor, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {twrAnualPct != null ? formatPercent(twrAnualPct, { sign: false }) : 'N/D'}
              </span>
            </p>
          }
        />
        <KPICard
          label="TIR Anual"
          tooltip="XIRR sobre los flujos reales (aportes y retiros) con sus fechas exactas, más el valor actual como flujo terminal. Pondera cuándo entró cada peso."
          value={tirPeriodoPct != null ? formatPercent(tirPeriodoPct, { sign: false }) : 'N/D'}
          sub={esReal ? 'rendimiento real del capital' : 'rendimiento del capital'}
          subColor={tirColor}
          accentColor={tirColor}
        />
      </div>

      {moneda === 'ARS' && ajustar && (
        <p style={{ margin: 0, fontSize: 11, color: errorIpc ? 'var(--down)' : 'var(--muted)' }}>
          {errorIpc
            ? 'No se pudo cargar el IPC: se muestran los valores sin ajustar.'
            : !esReal
              ? 'Cargando IPC…'
              : `Valores reales, en pesos de ${etiquetaMes(real.baseMesKey)}. IPC INDEC publicado hasta ${etiquetaMes(mesIpc)}`
                + (mesIpc != null && mesIpc < real.baseMesKey ? '; los meses posteriores no se ajustan.' : '.')}
        </p>
      )}

      {/* `1 0 auto`: crece si sobra alto pero nunca baja de lo que pide el gráfico.
          Con `minHeight: 0` se achicaba en pantallas bajas y el panel de barras
          quedaba fuera de la tarjeta; lo que no entra lo resuelve el scroll del tab. */}
      <div className="resumen-chart-wrap" style={{ flex: '1 0 auto', display: 'flex', flexDirection: 'column' }}>
        <EvolucionChart data={recortarSerie(serie, periodo)} tenenciasPorMes={tenenciasPorMes} hideValues={hideValues} moneda={moneda} />
      </div>
    </>
  );
}
