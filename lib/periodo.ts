/**
 * Recorte de la serie mensual y los movimientos a un período, para los KPIs
 * de Resumen (selector "1 mes / YTD / 12 meses / Máximo"). TWR y ganancia se
 * calculan solo sobre el tramo elegido; la TIR del período toma el valor de
 * cartera al arranque del tramo como si fuera un flujo más (un "aporte"
 * implícito de todo lo que ya estaba invertido), que es la forma estándar de
 * acotar una XIRR a una ventana sin tener que reconstruir el historial previo.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0022-twr-modified-dietz-encadenado.md
 */
import { xirr, type Cashflow } from './finance';
import { construirTWR, twrAcumuladoPct, twrAnualizadoPct } from './twr';
import type { ResumenRow, MovimientoRow } from '@/types';

export type PeriodoId = '1m' | 'ytd' | '12m' | 'max';

export const PERIODOS: { id: PeriodoId; label: string }[] = [
  { id: '1m', label: '1 mes' },
  { id: 'ytd', label: 'YTD' },
  { id: '12m', label: '12 meses' },
  { id: 'max', label: 'Máximo' },
];

/**
 * Primer índice de `resumenSeries` a incluir en el tramo, según el período.
 *
 * El punto devuelto es la **base** de la cadena, no el primer mes que se mide:
 * cada fila de `resumenSeries` es la valuación al CIERRE de su mes, así que el
 * rendimiento del mes M surge de comparar el cierre de M-1 contra el de M. Un
 * tramo de k meses necesita k+1 puntos. Arrancar YTD en el primer mes del año
 * (en vez del cierre de diciembre) se comía el rendimiento de enero entero.
 */
function indiceInicio(resumenSeries: ResumenRow[], periodo: PeriodoId): number {
  const n = resumenSeries.length;
  if (n === 0) return 0;
  const ultimo = resumenSeries[n - 1];

  if (periodo === 'max') return 0;

  if (periodo === '1m') return Math.max(0, n - 2);

  if (periodo === '12m') return Math.max(0, n - 13);

  // YTD: el cierre de diciembre del año anterior es la base, de modo que
  // enero sea el primer mes medido.
  const anioUltimo = new Date(ultimo.fechaTs).getUTCFullYear();
  for (let i = 0; i < n; i++) {
    if (new Date(resumenSeries[i].fechaTs).getUTCFullYear() === anioUltimo) {
      return Math.max(0, i - 1);
    }
  }
  return 0;
}

export interface MetricasPeriodo {
  /**
   * Mes BASE del tramo: su valuación de cierre es el punto de partida de la
   * cadena, y el primer mes medido es el siguiente. Para YTD de 2026, acá
   * viene "dic-25" y el tramo mide de enero en adelante.
   */
  desdeFecha: string;
  twrAcumuladoPct: number | null;
  twrAnualizadoPct: number | null;
  /** TWR en ARS nominal — mismo tramo, flujos y valuaciones en pesos. */
  twrAcumuladoArsPct: number | null;
  twrAnualizadoArsPct: number | null;
  /** Ganancia del tramo: valuación final − valuación inicial − aportes netos externos del tramo. */
  gananciaUsd: number;
  gananciaArs: number;
  /**
   * Ganancia como % del capital que la generó. El denominador NO es el mismo
   * en todos los períodos: sobre la serie completa es el total aportado, pero
   * en un tramo acotado hay que sumarle lo que ya estaba invertido al arrancar
   * — si no, un YTD con pocos aportes daría un porcentaje disparatado.
   * `null` si el capital base es 0 o negativo (no hay sobre qué calcular).
   */
  gananciaPctUsd: number | null;
  gananciaPctArs: number | null;
  /** Capital base usado como denominador de gananciaPct, para poder mostrarlo. */
  capitalBaseUsd: number;
  capitalBaseArs: number;
  tirAnualPct: number | null;
  tirAnualArsPct: number | null;
}

export function calcularMetricasPeriodo(
  resumenSeries: ResumenRow[],
  movimientos: MovimientoRow[],
  periodo: PeriodoId,
): MetricasPeriodo | null {
  if (resumenSeries.length === 0) return null;

  const i0 = indiceInicio(resumenSeries, periodo);
  const tramo = resumenSeries.slice(i0);
  if (tramo.length === 0) return null;

  const inicio = tramo[0];
  const fin = tramo[tramo.length - 1];

  // Movimientos del tramo: desde el mes SIGUIENTE al punto base. El mes base
  // aporta solo su valuación de cierre (el capital con el que arranca la
  // cadena); sus propios flujos ya quedaron reflejados en ese cierre, así que
  // incluirlos los contaría dos veces.
  //
  // Para la serie completa no hay mes previo: el tramo empieza con la cartera
  // en cero, así que entran todos los movimientos desde el primer día.
  const esSerieCompleta = i0 === 0;
  const d0 = new Date(inicio.fechaTs);
  const desdeTs = esSerieCompleta
    ? inicio.fechaTs
    : Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, 1);

  const movTramo = movimientos.filter((mv) => mv.fecha >= desdeTs);
  const movExternos = movTramo.filter((mv) => mv.clasificacion === 'externo');

  const aportesNetosUsd = movExternos.reduce((s, mv) => s + mv.monto_neto, 0);
  const aportesNetosArs = movExternos.reduce((s, mv) => s + mv.monto_neto_ars, 0);

  // Ganancia del tramo. Mismo criterio que la TIR de abajo: si el tramo es
  // TODA la serie, el valor inicial no es capital previo — ya está creado por
  // los aportes del propio tramo, así que restarlo además de los aportes
  // descuenta dos veces el primer aporte. Sobre la serie completa la ganancia
  // es simplemente `valuación − aportes netos`, igual que kpis.rendimientoNeto.
  const baseUsd = esSerieCompleta ? 0 : inicio.total_cartera;
  const baseArs = esSerieCompleta ? 0 : inicio.total_cartera_ars;

  const gananciaUsd = fin.total_cartera - baseUsd - aportesNetosUsd;
  const gananciaArs = fin.total_cartera_ars - baseArs - aportesNetosArs;

  // Capital que generó esa ganancia: lo que ya estaba invertido al arrancar el
  // tramo (0 en la serie completa) más lo aportado durante el tramo. Sobre la
  // serie completa queda en los aportes netos, igual que el viejo
  // "% sobre aportes" de kpis.rendimientoPct.
  const capitalBaseUsd = baseUsd + aportesNetosUsd;
  const capitalBaseArs = baseArs + aportesNetosArs;
  const gananciaPctUsd = capitalBaseUsd > 0 ? (gananciaUsd / capitalBaseUsd) * 100 : null;
  const gananciaPctArs = capitalBaseArs > 0 ? (gananciaArs / capitalBaseArs) * 100 : null;

  // TWR del tramo: se re-basa a 100 en el mes de arranque, usando TODOS los
  // movimientos del tramo (interno + externo, un flujo es un flujo para TWR).
  // En USD y en ARS (flujos y valuaciones en pesos, no una conversión del TWR
  // en USD) — ver lib/twr.ts.
  const twrUsdTramo = construirTWR(
    tramo.map((r) => ({ fechaTs: r.fechaTs, total: r.total_cartera })),
    movTramo.map((mv) => ({ fecha: mv.fecha, monto: mv.monto_neto })),
  );
  const twrArsTramo = construirTWR(
    tramo.map((r) => ({ fechaTs: r.fechaTs, total: r.total_cartera_ars })),
    movTramo.map((mv) => ({ fecha: mv.fecha, monto: mv.monto_neto_ars })),
  );
  const diasTramo = (fin.fechaTs - inicio.fechaTs) / 86_400_000;
  const twrAcum = twrAcumuladoPct(twrUsdTramo);
  const twrAnual = diasTramo > 0 ? twrAnualizadoPct(twrUsdTramo, diasTramo) : twrAcum;
  const twrAcumArs = twrAcumuladoPct(twrArsTramo);
  const twrAnualArs = diasTramo > 0 ? twrAnualizadoPct(twrArsTramo, diasTramo) : twrAcumArs;

  // TIR del período. Si el tramo arranca en el primer punto de TODA la serie
  // (período "Máximo"), no hay capital previo invisible: los movimientos
  // reales ya explican el 100% del capital, así que se usan tal cual (mismo
  // criterio que kpis.tirAnual en lib/sheets.ts). Si el tramo arranca a mitad
  // de la historia (1 mes / YTD / 12 meses), el valor de cartera al arranque
  // SÍ representa capital que no está en los movimientos del tramo — entra
  // como un flujo negativo (aporte implícito), la forma estándar de acotar
  // una XIRR a una ventana sin reconstruir el historial previo.
  const tirFlows: Cashflow[] = esSerieCompleta
    ? [
        ...movExternos.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto })),
        { date: Date.now(), amount: fin.total_cartera },
      ]
    : [
        { date: inicio.fechaTs, amount: -inicio.total_cartera },
        ...movExternos.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto })),
        { date: Date.now(), amount: fin.total_cartera },
      ];
  const tirRaw = tirFlows.length >= 2 ? xirr(tirFlows) : null;

  const tirFlowsArs: Cashflow[] = esSerieCompleta
    ? [
        ...movExternos.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto_ars })),
        { date: Date.now(), amount: fin.total_cartera_ars },
      ]
    : [
        { date: inicio.fechaTs, amount: -inicio.total_cartera_ars },
        ...movExternos.map((mv) => ({ date: mv.fecha, amount: -mv.monto_neto_ars })),
        { date: Date.now(), amount: fin.total_cartera_ars },
      ];
  const tirRawArs = tirFlowsArs.length >= 2 ? xirr(tirFlowsArs) : null;

  return {
    desdeFecha: inicio.fecha,
    twrAcumuladoPct: twrAcum,
    twrAnualizadoPct: twrAnual,
    twrAcumuladoArsPct: twrAcumArs,
    twrAnualizadoArsPct: twrAnualArs,
    gananciaUsd,
    gananciaArs,
    gananciaPctUsd,
    gananciaPctArs,
    capitalBaseUsd,
    capitalBaseArs,
    tirAnualPct: tirRaw != null ? tirRaw * 100 : null,
    tirAnualArsPct: tirRawArs != null ? tirRawArs * 100 : null,
  };
}
