/**
 * Ajuste por inflación de la serie en ARS: lleva cada valuación y cada flujo a
 * pesos constantes del último mes de la serie, para que ganancia, TWR y TIR en
 * pesos midan poder de compra y no pesos corrientes.
 *
 * Es una transformación de los DATOS, no una fórmula nueva: se deflactan los
 * campos ARS de `resumenSeries` y `movimientos` y se pasan tal cual a
 * `calcularMetricasPeriodo` y al gráfico. El TWR y la XIRR sobre flujos en
 * pesos constantes dan el rendimiento real sin tocar lib/twr.ts ni
 * lib/finance.ts.
 *
 * Nivel de precios:
 * - Una valuación mensual es el cierre de su mes → se usa el índice IPC de ese
 *   mes tal cual.
 * - Un flujo con fecha exacta se ubica dentro del mes interpolando de forma
 *   geométrica entre el índice del mes anterior y el de su mes (la inflación
 *   se compone, no se suma). El IPC es mensual: no hay dato diario.
 * - Meses fuera del índice se acotan al primero/último disponible. El índice
 *   que llega de /api/benchmarks repite el último valor publicado en los meses
 *   que el INDEC todavía no publicó, o sea que esos meses quedan SIN ajustar
 *   (inflación cero). `ultimoMesPublicado` lo detecta para avisarlo en la UI.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0024-ajuste-por-inflacion-con-ipc-indec.md
 */
import { construirTWR } from './twr';
import type { MovimientoRow, ResumenRow } from '@/types';

export interface PuntoIndice {
  /** "YYYY-MM" */
  mesKey: string;
  /** Nivel del índice de precios al cierre de ese mes (la escala no importa, solo el cociente). */
  valor: number;
}

function mesKeyDe(ts: number): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mesKeyAnterior(mesKey: string): string {
  const [y, m] = mesKey.split('-').map(Number);
  return mesKeyDe(Date.UTC(y, m - 2, 1));
}

/**
 * Último mes con un IPC realmente publicado, o null si no se puede determinar.
 * Los meses sin publicar vienen como una cola de valores idénticos al último
 * publicado (el índice real nunca se repite exacto de un mes al siguiente).
 */
export function ultimoMesPublicado(indice: PuntoIndice[]): string | null {
  if (indice.length === 0) return null;
  let i = indice.length - 1;
  while (i > 0 && indice[i].valor === indice[i - 1].valor) i--;
  return indice[i].mesKey;
}

export interface SerieARSReal {
  resumenSeries: ResumenRow[];
  movimientos: MovimientoRow[];
  /** Mes en cuyos pesos quedó expresado todo (el último de la serie). */
  baseMesKey: string;
}

/**
 * Devuelve `resumenSeries` y `movimientos` con los campos ARS en pesos
 * constantes del último mes. Los campos en USD no se tocan. `null` si no hay
 * serie o el índice no alcanza para ajustar.
 */
export function deflactarARS(
  resumenSeries: ResumenRow[],
  movimientos: MovimientoRow[],
  indice: PuntoIndice[],
): SerieARSReal | null {
  if (resumenSeries.length === 0 || indice.length === 0) return null;

  const ordenado = [...indice].sort((a, b) => a.mesKey.localeCompare(b.mesKey));
  const porMes = new Map(ordenado.map((p) => [p.mesKey, p.valor]));
  const primero = ordenado[0];
  const ultimo = ordenado[ordenado.length - 1];

  const nivelCierre = (mesKey: string): number => {
    if (mesKey <= primero.mesKey) return primero.valor;
    if (mesKey >= ultimo.mesKey) return ultimo.valor;
    return porMes.get(mesKey) ?? ultimo.valor;
  };

  const nivelEnFecha = (ts: number): number => {
    const d = new Date(ts);
    const mesKey = mesKeyDe(ts);
    const diasMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    const fraccion = (d.getUTCDate() - 1) / diasMes;
    const previo = nivelCierre(mesKeyAnterior(mesKey));
    const cierre = nivelCierre(mesKey);
    return previo * Math.pow(cierre / previo, fraccion);
  };

  const baseMesKey = mesKeyDe(resumenSeries[resumenSeries.length - 1].fechaTs);
  const nivelBase = nivelCierre(baseMesKey);

  const movs: MovimientoRow[] = movimientos.map((mv) => {
    const k = nivelBase / nivelEnFecha(mv.fecha);
    return { ...mv, monto_ars: mv.monto_ars * k, monto_neto_ars: mv.monto_neto_ars * k };
  });

  const filas: ResumenRow[] = resumenSeries.map((r) => {
    const d = new Date(r.fechaTs);
    const mesIni = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const mesSig = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const k = nivelBase / nivelCierre(mesKeyDe(r.fechaTs));
    return {
      ...r,
      total_cartera_ars: r.total_cartera_ars * k,
      // Mismo criterio que lib/sheets.ts, con los flujos ya deflactados.
      aportes_ars: movs
        .filter((mv) => mv.fecha >= mesIni && mv.fecha < mesSig)
        .reduce((s, mv) => s + mv.monto_neto_ars, 0),
      acumulado_ars: movs
        .filter((mv) => mv.fecha < mesSig)
        .reduce((s, mv) => s + mv.monto_neto_ars, 0),
    };
  });

  const twrArs = construirTWR(
    filas.map((r) => ({ fechaTs: r.fechaTs, total: r.total_cartera_ars })),
    movs.map((mv) => ({ fecha: mv.fecha, monto: mv.monto_neto_ars })),
  );
  filas.forEach((r, i) => { r.twrIndiceArs = twrArs[i].indice; });

  return { resumenSeries: filas, movimientos: movs, baseMesKey };
}
