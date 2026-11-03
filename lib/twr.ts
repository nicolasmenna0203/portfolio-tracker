/**
 * TWR (Time-Weighted Return) — rendimiento puro de la cartera, sin el efecto
 * de cuándo ni cuánto aportaste. Se calcula encadenando un Modified Dietz por
 * mes: cada flujo del mes se pondera por los días que estuvo invertido dentro
 * de ese mes (fecha exacta, no un promedio mensual).
 *
 * Por qué Modified Dietz y no un TWR diario real: el Sheet tiene valuaciones
 * mensuales, no diarias. Encadenar Modified Dietz por mes es la aproximación
 * estándar cuando no hay valuación en cada fecha de flujo — la UI lo declara
 * con un tooltip ⓘ porque es una aproximación, no el TWR exacto que calcula
 * un bróker con valuación diaria.
 *
 * Reemplaza dos implementaciones previas que daban resultados distintos bajo
 * el mismo nombre "TWR": la de BenchmarksTab.tsx (que no pesaba los flujos por
 * fecha) y el total crudo rebasado a 100 de comparar_benchmarks (que no
 * descontaba aportes). Ver docs/decisiones/0022-twr-modified-dietz-encadenado.md
 */

export interface FlujoDelMes {
  /** Timestamp ms del flujo. */
  fecha: number;
  /** Monto con signo: positivo ingreso, negativo salida. */
  monto: number;
}

export interface MesValuacion {
  /** Timestamp ms del mes (primer día, UTC) — define el mes calendario del tramo que termina acá. */
  fechaTs: number;
  /** Valuación total al cierre de este mes. */
  total: number;
}

export interface PuntoTWR {
  /** Índice encadenado, base 100 en el primer mes de la serie. */
  indice: number;
  /** Retorno del tramo (mes), null en el primer punto (no hay tramo previo). */
  retornoMes: number | null;
}

/**
 * Modified Dietz para un solo tramo (un mes):
 * r = (valorFin − valorInicio − Σflujos) / (valorInicio + Σ(flujo × peso))
 * donde peso = fracción de días del mes que el flujo estuvo invertido.
 *
 * Devuelve null si el denominador es 0 (sin capital invertido en el tramo):
 * no hay forma de calcular un retorno porcentual sobre una base nula.
 */
function modifiedDietz(
  valorInicio: number,
  valorFin: number,
  flujos: FlujoDelMes[],
  inicioTramo: number,
  finTramoExclusive: number,
): number | null {
  const diasTramo = (finTramoExclusive - inicioTramo) / 86_400_000;
  let sumaFlujos = 0;
  let sumaPonderada = 0;
  for (const f of flujos) {
    const diasInvertido = (finTramoExclusive - f.fecha) / 86_400_000;
    const peso = diasTramo > 0 ? diasInvertido / diasTramo : 0;
    sumaFlujos += f.monto;
    sumaPonderada += f.monto * peso;
  }
  const denominador = valorInicio + sumaPonderada;
  if (denominador === 0) return null;
  return (valorFin - valorInicio - sumaFlujos) / denominador;
}

/**
 * Encadena Modified Dietz mes a mes sobre una serie de valuaciones mensuales
 * y flujos con fecha exacta. `valuaciones` debe venir ordenada cronológicamente
 * y sin huecos (un punto por mes consecutivo) — es responsabilidad de quien
 * llama recortar el rango antes de pasarlo.
 */
export function construirTWR(
  valuaciones: MesValuacion[],
  flujos: FlujoDelMes[],
): PuntoTWR[] {
  if (valuaciones.length === 0) return [];

  const puntos: PuntoTWR[] = [{ indice: 100, retornoMes: null }];
  let indice = 100;

  for (let i = 1; i < valuaciones.length; i++) {
    const prev = valuaciones[i - 1];
    const cur = valuaciones[i];

    const d = new Date(cur.fechaTs);
    const inicioTramo = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const finTramoExclusive = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);

    const flujosDelTramo = flujos.filter(
      (f) => f.fecha >= inicioTramo && f.fecha < finTramoExclusive,
    );

    const r = modifiedDietz(prev.total, cur.total, flujosDelTramo, inicioTramo, finTramoExclusive);
    if (r != null) indice = indice * (1 + r);
    puntos.push({ indice, retornoMes: r });
  }

  return puntos;
}

/** TWR acumulado en % desde el primer punto de la serie hasta el último. */
export function twrAcumuladoPct(puntos: PuntoTWR[]): number | null {
  if (puntos.length === 0) return null;
  return (puntos[puntos.length - 1].indice / 100 - 1) * 100;
}

/**
 * TWR anualizado: compone el acumulado a razón de 365,25 días (misma
 * convención que la XIRR en lib/finance.ts, para que ambas sean comparables
 * en el mismo eje de tiempo).
 */
export function twrAnualizadoPct(
  puntos: PuntoTWR[],
  diasTranscurridos: number,
): number | null {
  if (puntos.length === 0 || diasTranscurridos <= 0) return null;
  const factorTotal = puntos[puntos.length - 1].indice / 100;
  if (factorTotal <= 0) return null; // pérdida total: no tiene raíz real con exponente fraccionario
  const anios = diasTranscurridos / 365.25;
  return (Math.pow(factorTotal, 1 / anios) - 1) * 100;
}
