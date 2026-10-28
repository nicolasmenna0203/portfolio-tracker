'use client';

// Pestaña Resumen: KPIs agregados de la cartera (total, ganancia, TWR, TIR)
// con selector de período, más la evolución temporal. Extraído de Dashboard.tsx
// para que cada pestaña sea su propio archivo, igual que el resto.

import { useState, useMemo } from 'react';
import type { DashboardData } from '@/types';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import { calcularMetricasPeriodo, PERIODOS, type PeriodoId } from '@/lib/periodo';
import KPICard from './KPICard';
import EvolucionChart from './EvolucionChart';

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
}

export default function ResumenTab({ data, hideValues, moneda }: Props) {
  const { kpis, resumenSeries, tenenciasPorMes, movimientos } = data;

  // Delta de "Total Cartera" vs el mes anterior, en ARS (KPI #1). El total en
  // ARS ya viene calculado en origen con el MEP real de cierre de cada mes.
  const kpisArs = useMemo(() => {
    if (moneda === 'USD') return null;
    const penultimo = resumenSeries[resumenSeries.length - 2];
    const deltaCarteraArs = penultimo != null ? kpis.totalCarteraArs - penultimo.total_cartera_ars : 0;
    return { deltaCarteraArs };
  }, [moneda, resumenSeries, kpis.totalCarteraArs]);

  // Selector de período para Ganancia / TWR / TIR (KPIs 2 a 4). "Máximo" es
  // siempre el punto de partida al entrar a la pestaña (sin persistir en
  // localStorage): coincide con lo que mostraban antes "Rendimiento Neto" y
  // "TIR Anual" sin selector. Ver lib/periodo.ts y
  // docs/decisiones/0022-twr-modified-dietz-encadenado.md
  const [periodo, setPeriodo] = useState<PeriodoId>('max');

  const metricasPeriodo = useMemo(
    () => calcularMetricasPeriodo(resumenSeries, movimientos, periodo),
    [resumenSeries, movimientos, periodo],
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
    ? (moneda === 'ARS' ? 'nominal, sin ajustar por inflación' : 'sobre el período elegido')
    : `${formatPercent(gananciaPct)} sobre ${periodo === 'max' ? 'aportes' : 'el capital invertido'}`
      + (moneda === 'ARS' ? ' · nominal' : '');

  const twrPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.twrAcumuladoPct : metricasPeriodo.twrAcumuladoArsPct)
    : null;
  const twrColor = twrPct == null ? 'var(--muted)' : twrPct >= 0 ? 'var(--up)' : 'var(--down)';

  const tirPeriodoPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.tirAnualPct : metricasPeriodo.tirAnualArsPct)
    : null;
  const tirColor = tirPeriodoPct == null ? 'var(--muted)' : tirPeriodoPct >= 0 ? 'var(--up)' : 'var(--down)';

  // Efecto del timing de aportes: TWR − TIR, ambos anualizados.
  //
  // La TIR siempre es anual por construcción, así que hay que compararla
  // contra el TWR ANUALIZADO, no contra el acumulado que muestra el KPI. En
  // tramos cortos los dos difieren mucho (un TWR acumulado de 0,2% en un mes
  // anualiza a ~2,7%), y mezclarlos daba un signo al revés del que se deduce
  // leyendo los dos KPIs en pantalla.
  //
  // TWR > TIR: el mercado rindió más que tu plata — los aportes entraron, en
  // promedio, antes de los tramos flojos.
  const twrAnualPct = metricasPeriodo
    ? (moneda === 'USD' ? metricasPeriodo.twrAnualizadoPct : metricasPeriodo.twrAnualizadoArsPct)
    : null;
  const efectoTimingPct = twrAnualPct != null && tirPeriodoPct != null ? twrAnualPct - tirPeriodoPct : null;

  return (
    <>
      {/* Selector de período para Ganancia / TWR / TIR (KPIs 2 a 4) */}
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
          subColor={deltaColor}
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
          sub={
            hideValues ? '••••' :
            `mide la inversión, sin el efecto de cuándo aportaste${moneda === 'ARS' ? ' (nominal)' : ''}`
          }
          subColor={twrColor}
          accentColor={twrColor}
        />
        <KPICard
          label="TIR Anual"
          tooltip="XIRR sobre los flujos reales (aportes y retiros) con sus fechas exactas, más el valor actual como flujo terminal. Pondera cuándo entró cada peso."
          value={tirPeriodoPct != null ? formatPercent(tirPeriodoPct, { sign: false }) : 'N/D'}
          sub={
            hideValues ? '••••' :
            `mide tu plata, según cuándo aportaste${moneda === 'ARS' ? ' (nominal)' : ''}`
          }
          subColor={tirColor}
          accentColor={tirColor}
        />
      </div>

      {!hideValues && efectoTimingPct != null && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--muted)' }}>
          Efecto del timing de aportes: TWR {twrAnualPct != null ? formatPercent(twrAnualPct, { sign: false }) : '—'} − TIR {formatPercent(tirPeriodoPct ?? 0, { sign: false })} = {efectoTimingPct >= 0 ? '+' : '−'}{Math.abs(efectoTimingPct).toFixed(1).replace('.', ',')} pts (ambos anualizados)
          {/* TWR > TIR: el momento en que entró y salió tu plata (no la
              gestión de los activos en sí, que es lo que ya mide TWR) te
              perjudicó — en promedio aportaste en momentos menos favorables. */}
          {Math.abs(efectoTimingPct) < 1
            ? ' — el efecto de tus flujos sobre la rentabilidad fue pequeño.'
            : efectoTimingPct >= 0
              ? ' — el momento de tus aportes y retiros te perjudicó: en promedio, entraron en momentos menos favorables.'
              : ' — el momento de tus aportes y retiros te benefició: en promedio, entraron en buenos momentos.'}
        </p>
      )}

      <div className="resumen-chart-wrap" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <EvolucionChart data={resumenSeries} tenenciasPorMes={tenenciasPorMes} hideValues={hideValues} moneda={moneda} />
      </div>
    </>
  );
}
