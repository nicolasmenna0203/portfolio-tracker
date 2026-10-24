// Construye un DashboardData 100% sintético para /demo, con la misma forma que
// arma `fetchDashboardData()` en lib/sheets.ts pero sin tocar Google Sheets.
//
// 13 meses de historia con tenencias por activo, aportes mensuales coherentes
// con el crecimiento de la cartera, y KPIs (incluida la TIR) calculados con el
// mismo `xirr` que usa el dashboard real, para que Resumen/Tenencias/Informe
// reciban datos consistentes entre sí.

import { xirr, type Cashflow } from '@/lib/finance';
import { formatMesLabel, toMesKey } from '@/lib/parser';
import { TODOS_ACTIVOS } from './universo';
import type {
  DashboardData,
  ResumenRow,
  TenenciaActual,
  KPIData,
  MovimientoRow,
} from '@/types';

const MESES_HISTORIA = 13;

export function buildDemoDashboardData(): DashboardData {
  const hoy = Date.now();

  // Primer día de mes (UTC) del mes actual, y de ahí para atrás.
  const hoyD = new Date(hoy);
  const mesesTs: number[] = [];
  for (let i = MESES_HISTORIA - 1; i >= 0; i--) {
    mesesTs.push(Date.UTC(hoyD.getUTCFullYear(), hoyD.getUTCMonth() - i, 1));
  }

  // ── Tenencias por mes ────────────────────────────────────────────────────
  // Cada activo crece con una tendencia leve + ruido determinístico mes a mes,
  // partiendo de una fracción de su tenenciaBaseUsd en el primer mes hasta
  // llegar a tenenciaBaseUsd en el último.
  const tenenciasPorMes: Record<string, TenenciaActual[]> = {};
  const totalPorMes: Record<string, number> = {};
  const totalPorMesArs: Record<string, number> = {};

  // MEP sintético: arranca ~1050 y sube con tendencia + ruido leve hasta ~1450 hoy.
  const mepPorMesArr: number[] = mesesTs.map((_, i) => {
    const progreso = i / (MESES_HISTORIA - 1);
    const base = 1050 + progreso * 400;
    const ruido = Math.sin(i * 1.7) * 25;
    return Math.round(base + ruido);
  });

  mesesTs.forEach((ts, i) => {
    const mesKey = toMesKey(ts);
    const progreso = (i + 1) / MESES_HISTORIA; // 0 < progreso <= 1, activo recién incorporado pesa menos al principio
    const mep = mepPorMesArr[i];

    const items: TenenciaActual[] = TODOS_ACTIVOS.map((a, idx) => {
      // Curva de crecimiento suave con ruido determinístico por activo+mes.
      const ruido = Math.sin(idx * 3.1 + i * 0.9) * 0.06;
      const factor = Math.max(0.15, progreso + ruido);
      const tenenciaUsd = Math.round(a.tenenciaBaseUsd * factor);
      const tenenciaArs = Math.round(tenenciaUsd * mep);
      return {
        ticker: a.TICKER,
        tenencia_ars: tenenciaArs,
        tenencia_usd: tenenciaUsd,
        fechaTs: ts,
        fechaMes: mesKey,
        TIPO: a.TIPO,
        RIESGO: a.RIESGO,
        SECTOR_GEO: a.SECTOR_GEO,
        RENTA: a.RENTA,
        MONEDA: a.MONEDA,
      };
    }).filter((t) => t.tenencia_usd > 0);

    items.sort((x, y) => y.tenencia_usd - x.tenencia_usd);
    tenenciasPorMes[mesKey] = items;
    totalPorMes[mesKey] = items.reduce((s, t) => s + t.tenencia_usd, 0);
    totalPorMesArs[mesKey] = items.reduce((s, t) => s + t.tenencia_ars, 0);
  });

  // ── Movimientos (aportes mensuales) ──────────────────────────────────────
  // Un aporte por mes, coherente con el crecimiento de cartera: aproximadamente
  // la diferencia de valor entre meses consecutivos, moderada para dejar lugar
  // a rendimiento (si todo el crecimiento fuera aporte, el rendimiento sería 0).
  const mesesOrdenados = Object.keys(totalPorMes).sort();
  const cashflows: Cashflow[] = [];
  const aportesPorMes: Record<string, number> = {};
  const aportesArsPorMes: Record<string, number> = {};
  const movimientos: MovimientoRow[] = [];

  mesesOrdenados.forEach((mk, i) => {
    const ts = mesesTs[i];
    const mep = mepPorMesArr[i];
    let aporteUsd: number;
    if (i === 0) {
      // Aporte inicial: una fracción del total del primer mes (el resto se
      // interpreta como rendimiento acumulado previo a la ventana visible).
      aporteUsd = Math.round(totalPorMes[mk] * 0.7);
    } else {
      const delta = totalPorMes[mk] - totalPorMes[mesesOrdenados[i - 1]];
      // Entre 40% y 75% del delta mensual es aporte nuevo; el resto es rendimiento.
      const ruido = 0.4 + ((Math.sin(i * 2.3) + 1) / 2) * 0.35;
      aporteUsd = Math.round(delta * ruido);
    }
    // Los aportes son siempre positivos para que la cartera crezca de forma
    // creíble; un mes con caída de mercado igual puede tener aporte nuevo.
    aporteUsd = Math.max(50, aporteUsd);

    aportesPorMes[mk] = aporteUsd;
    aportesArsPorMes[mk] = Math.round(aporteUsd * mep);
    const fechaMovimiento = ts + 15 * 24 * 3600 * 1000;
    cashflows.push({ date: fechaMovimiento, amount: -aporteUsd });
    movimientos.push({
      fecha: fechaMovimiento,
      monto_usd: aporteUsd,
      monto_ars: aportesArsPorMes[mk],
      tipo: 'ingreso',
      monto_neto: aporteUsd,
      monto_neto_ars: aportesArsPorMes[mk],
    });
  });

  // ── Resumen series ────────────────────────────────────────────────────────
  let acumulado = 0;
  let acumuladoArs = 0;
  const resumenSeries: ResumenRow[] = mesesOrdenados.map((mk, i) => {
    const ts = mesesTs[i];
    acumulado += aportesPorMes[mk];
    acumuladoArs += aportesArsPorMes[mk];
    const total_cartera = totalPorMes[mk];
    const total_cartera_ars = totalPorMesArs[mk];
    return {
      fecha: formatMesLabel(ts),
      fechaTs: ts,
      aportes: aportesPorMes[mk],
      aportes_ars: aportesArsPorMes[mk],
      acumulado,
      acumulado_ars: acumuladoArs,
      total_cartera,
      total_cartera_ars,
      rendimiento: total_cartera - acumulado,
    };
  });

  const mesesDisponibles = mesesOrdenados.map((mk) => {
    const [y, m] = mk.split('-').map(Number);
    return formatMesLabel(Date.UTC(y, m - 1, 1));
  });

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const ultimo = resumenSeries[resumenSeries.length - 1];
  const penultimo = resumenSeries[resumenSeries.length - 2];

  const tirFlows: Cashflow[] = [...cashflows, { date: hoy, amount: ultimo.total_cartera }];
  const tirRaw = xirr(tirFlows);

  const kpis: KPIData = {
    totalCartera: ultimo.total_cartera,
    totalCarteraArs: ultimo.total_cartera_ars,
    aporteAcumulados: ultimo.acumulado,
    rendimientoNeto: ultimo.rendimiento,
    rendimientoPct: ultimo.acumulado > 0 ? (ultimo.rendimiento / ultimo.acumulado) * 100 : 0,
    deltaCartera: penultimo != null ? ultimo.total_cartera - penultimo.total_cartera : 0,
    tirAnual: tirRaw != null ? tirRaw * 100 : null,
    fechaStr: ultimo.fecha,
  };

  return {
    kpis,
    resumenSeries,
    tenenciasPorMes,
    mesesDisponibles,
    totalPorMes,
    totalPorMesArs,
    movimientos,
  };
}
