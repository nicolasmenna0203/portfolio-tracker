import type { BondPerformance, GrupoBono, GrupoPonderado, PerformanceResponse, SensibilidadTir } from '@/types';
import { fetchBondMetrics } from './bondMetrics';
import {
  calcularMetricasProvinciales,
  parsearBonosCalculoPropio,
  RANGO_BONOS_CALCULO_PROPIO,
  type CondicionesBono,
} from './bonosProvinciales';
import { preciosBonosPorSimbolo } from './precios';
import { readSheet } from './sheets';

const GRUPOS: GrupoBono[] = ['USD', 'CER', 'ARS_TASA', 'DOLLAR_LINKED', 'BOPREAL'];
const SHOCKS = [1, 2, 3, 5, 10];

/**
 * Aproximación de primer orden de la sensibilidad de la TIR a un shock de
 * precio, vía duration modificada: ΔTIR ≈ Δprecio% / duration.
 *
 * Decisión y alternativas descartadas:
 * docs/decisiones/0006-sensibilidad-sin-convexidad.md
 *
 * Ignora
 * convexidad (error creciente en shocks grandes o duration muy corta), pero
 * es la fórmula estándar de renta fija y, a diferencia de los campos
 * tir_up/tir_down de bonistas.com, su cálculo es verificable.
 */
function calcularSensibilidad(tir: number, duration: number): SensibilidadTir[] {
  if (duration <= 0) return [];
  return SHOCKS.map((shock) => ({
    shock,
    tirDown: tir + (shock / 100) / duration,
    tirUp: tir - (shock / 100) / duration,
  }));
}

/** Bonos de la hoja BonosCalculoPropio (ver lib/bonosProvinciales.ts). */
async function leerBonosCalculoPropio(): Promise<CondicionesBono[]> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) return [];
  return parsearBonosCalculoPropio(await readSheet(id, RANGO_BONOS_CALCULO_PROPIO));
}

/**
 * Junta el universo de bonos mapeados (TIR, TNA, duration, paridad) con las
 * tenencias actuales de la cartera, y calcula TIR/duration ponderada por
 * grupo — nunca mezclando USD con ARS ni CER con tasa fija en pesos, porque
 * son tasas en monedas/índices distintos y promediarlas sería engañoso.
 */
export async function fetchPerformance(
  tenencias: Record<string, number> = {},
): Promise<PerformanceResponse> {
  // Los provinciales/consolidación no están en bonistas: sus métricas se
  // calculan acá desde el flujo de fondos + precio de data912. Si la hoja o esa
  // fuente fallan no se cae toda la sección, simplemente no aparecen esos puntos.
  const [metricsMap, provinciales] = await Promise.all([
    fetchBondMetrics(),
    leerBonosCalculoPropio()
      .then(async (condiciones) =>
        calcularMetricasProvinciales(
          condiciones,
          await preciosBonosPorSimbolo(condiciones.map((c) => c.simboloPrecio)),
        ),
      )
      .catch((e) => {
        console.warn('Bonos de cálculo propio:', e instanceof Error ? e.message : e);
        return [];
      }),
  ]);

  // Un ticker calculado acá nunca pisa a uno de bonistas: si en algún momento
  // bonistas empieza a cubrir provinciales, su dato (misma convención que el
  // resto de la curva) tiene prioridad y esta lista queda inerte.
  const soloNuevos = provinciales.filter((p) => !metricsMap.has(p.ticker));

  const bonos: BondPerformance[] = [...metricsMap.values(), ...soloNuevos]
    .map((m) => {
      const tenenciaUsd = tenencias[m.tickerCartera ?? m.ticker];
      return {
        ...m,
        sensibilidad: calcularSensibilidad(m.tir, m.modifiedDuration),
        ...(tenenciaUsd ? { tenenciaUsd } : {}),
      };
    })
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const carteraPorGrupo: GrupoPonderado[] = [];
  for (const grupo of GRUPOS) {
    const enCartera = bonos.filter((b) => b.grupo === grupo && b.tenenciaUsd);
    const tenenciaTotalUsd = enCartera.reduce((s, b) => s + (b.tenenciaUsd ?? 0), 0);
    if (tenenciaTotalUsd === 0) continue;

    const tirPonderada = enCartera.reduce((s, b) => s + b.tir * (b.tenenciaUsd ?? 0), 0) / tenenciaTotalUsd;
    const durationPonderada = enCartera.reduce((s, b) => s + b.modifiedDuration * (b.tenenciaUsd ?? 0), 0) / tenenciaTotalUsd;

    carteraPorGrupo.push({ grupo, tirPonderada, durationPonderada, tenenciaTotalUsd });
  }

  return { bonos, carteraPorGrupo, generatedAt: Date.now() };
}
