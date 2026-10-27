import { describe, it, expect } from 'vitest';
import { construirTWR, twrAcumuladoPct, twrAnualizadoPct, type MesValuacion, type FlujoDelMes } from './twr';

describe('construirTWR', () => {
  it('sin flujos, el TWR acumulado coincide con el retorno simple', () => {
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2024, 0, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 1, 1), total: 1100 },
      { fechaTs: Date.UTC(2024, 2, 1), total: 1210 },
    ];
    const puntos = construirTWR(valuaciones, []);
    const retornoSimple = (1210 / 1000 - 1) * 100;
    expect(twrAcumuladoPct(puntos)!).toBeCloseTo(retornoSimple, 6);
  });

  it('un aporte a mitad de mes no cambia el TWR si el resto rinde 0%', () => {
    // Convención de lib/sheets.ts: el timestamp de cada punto es el día 1 DEL
    // MISMO mes que valúa (ago-24 → 1-ago representa el cierre de agosto), no
    // el mes siguiente. El primer punto es el arranque de la serie; el tramo
    // medido en el segundo punto es abril, el propio mes de su timestamp.
    // 1000 al inicio, entra un aporte de 500 el día 16 de abril (30 días),
    // y el total final es exactamente 1000 + 500 = 1500: cero rendimiento real.
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2024, 2, 1), total: 1000 }, // marzo: punto de arranque
      { fechaTs: Date.UTC(2024, 3, 1), total: 1500 }, // abril: tramo medido
    ];
    const flujos: FlujoDelMes[] = [{ fecha: Date.UTC(2024, 3, 16), monto: 500 }];
    const puntos = construirTWR(valuaciones, flujos);
    expect(twrAcumuladoPct(puntos)!).toBeCloseTo(0, 4);
  });

  it('pondera el flujo por los días que estuvo invertido, no por el monto bruto', () => {
    // Aporte el último día de enero: casi no participa del rendimiento del mes.
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 11, 1), total: 1000 }, // diciembre: arranque
      { fechaTs: Date.UTC(2024, 0, 1), total: 1600 },  // enero: +100 aporte + 500 rendimiento sobre 1000
    ];
    const flujos: FlujoDelMes[] = [{ fecha: Date.UTC(2024, 0, 31), monto: 100 }];
    const puntos = construirTWR(valuaciones, flujos);
    // Con el flujo pesando ~1/31 del mes, el retorno debe quedar muy cerca de 50% (500/1000).
    expect(twrAcumuladoPct(puntos)!).toBeCloseTo(50, 0);
  });

  it('un retiro total sin pérdida de por medio no mueve el índice (rindió 0%, no perdió todo)', () => {
    // El capital que quedó invertido antes del retiro rindió exactamente 0%:
    // el índice TWR mide tasa de retorno, no "cuánto queda", así que debe
    // quedar en 100, no caer a 0 junto con el valor final de la cartera.
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 11, 1), total: 1000 }, // diciembre: arranque
      { fechaTs: Date.UTC(2024, 0, 1), total: 0 },     // enero: retiro total
    ];
    const flujos: FlujoDelMes[] = [{ fecha: Date.UTC(2024, 0, 15), monto: -1000 }];
    const puntos = construirTWR(valuaciones, flujos);
    expect(puntos[puntos.length - 1].indice).toBeCloseTo(100, 6);
  });

  it('una pérdida total en el tramo lleva el índice a 0', () => {
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 11, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 0, 1), total: 0 }, // sin flujos: pérdida total real
    ];
    const puntos = construirTWR(valuaciones, []);
    expect(puntos[puntos.length - 1].indice).toBeCloseTo(0, 6);
  });
});

describe('coherencia ARS = USD × MEP', () => {
  it('sin flujos, el índice TWR en ARS iguala exactamente al índice en USD multiplicado por la devaluación del MEP', () => {
    // Sin flujos, Modified Dietz es un retorno simple: r_ars = Vf_ars/Vi_ars - 1 =
    // (Vf_usd·mep_f)/(Vi_usd·mep_i) - 1, que factoriza exacto contra r_usd y el
    // ratio de MEP entre el primer y el último mes, sin importar el camino que
    // tomó el MEP en el medio.
    const mepPorMes = [1000, 1150, 1080, 1300, 1450];
    const valuacionesUsd: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 11, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 0, 1), total: 1050 },
      { fechaTs: Date.UTC(2024, 1, 1), total: 1100 },
      { fechaTs: Date.UTC(2024, 2, 1), total: 980 },
      { fechaTs: Date.UTC(2024, 3, 1), total: 1200 },
    ];
    const valuacionesArs: MesValuacion[] = valuacionesUsd.map((v, i) => ({
      fechaTs: v.fechaTs,
      total: v.total * mepPorMes[i],
    }));

    const twrUsd = construirTWR(valuacionesUsd, []);
    const twrArs = construirTWR(valuacionesArs, []);

    const ratioIndices = twrArs[twrArs.length - 1].indice / twrUsd[twrUsd.length - 1].indice;
    const ratioMep = mepPorMes[mepPorMes.length - 1] / mepPorMes[0];

    expect(ratioIndices).toBeCloseTo(ratioMep, 6);
  });

  it('con flujos, la identidad deja de ser exacta: el desacople crece con la volatilidad del MEP', () => {
    // La identidad ARS = USD × MEP solo vale exacto SIN flujos (test de
    // arriba). Con flujos se rompe por construcción: el flujo convierte al MEP
    // de SU día exacto, mientras el stock de cada mes usa un MEP único de ese
    // mes — dos cortes de tiempo distintos dentro del mismo mes.
    //
    // Este test documenta la magnitud real del error en vez de esconderla con
    // un escenario de devaluación suave. El MEP de abajo replica la
    // volatilidad observada en la serie real (saltos de ±20-30% mes a mes),
    // donde el desacople llega a varios puntos. No es un bug a corregir: es el
    // límite de valuar stock mensual y flujo diario con la misma etiqueta de
    // "pesos". Ver docs/decisiones/0022-twr-modified-dietz-encadenado.md
    const mepPorMes = [1269, 1206, 1140, 1067, 1413]; // tramo real ago-24→feb-25
    const valuacionesUsd: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 11, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 0, 1), total: 1050 },
      { fechaTs: Date.UTC(2024, 1, 1), total: 1600 }, // con aporte
      { fechaTs: Date.UTC(2024, 2, 1), total: 1550 },
      { fechaTs: Date.UTC(2024, 3, 1), total: 1700 },
    ];
    const valuacionesArs: MesValuacion[] = valuacionesUsd.map((v, i) => ({
      fechaTs: v.fechaTs,
      total: v.total * mepPorMes[i],
    }));

    const flujosUsd: FlujoDelMes[] = [{ fecha: Date.UTC(2024, 1, 10), monto: 500 }];
    const flujosArs: FlujoDelMes[] = [{ fecha: Date.UTC(2024, 1, 10), monto: 500 * mepPorMes[2] }];

    const twrUsd = construirTWR(valuacionesUsd, flujosUsd);
    const twrArs = construirTWR(valuacionesArs, flujosArs);

    const ratioIndices = twrArs[twrArs.length - 1].indice / twrUsd[twrUsd.length - 1].indice;
    const ratioMep = mepPorMes[mepPorMes.length - 1] / mepPorMes[0];
    const desacoplePts = Math.abs(ratioIndices - ratioMep) * 100;

    // Con esta volatilidad el desacople es de varios puntos, no de décimas.
    // El techo de 25 pts es un guardarraíl contra una regresión gruesa (un
    // signo invertido, una moneda cruzada), no una medida de precisión.
    expect(desacoplePts).toBeGreaterThan(1);
    expect(desacoplePts).toBeLessThan(25);
  });
});

describe('twrAnualizadoPct', () => {
  it('anualiza 100% en un año a ~100%', () => {
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2023, 0, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 0, 1), total: 2000 },
    ];
    const puntos = construirTWR(valuaciones, []);
    const anual = twrAnualizadoPct(puntos, 365.25);
    expect(anual!).toBeCloseTo(100, 0);
  });

  it('anualiza un retorno de 2 años a su tasa anual compuesta', () => {
    const valuaciones: MesValuacion[] = [
      { fechaTs: Date.UTC(2022, 0, 1), total: 1000 },
      { fechaTs: Date.UTC(2024, 0, 1), total: 1210 }, // +21% en 2 años = 10% anual compuesto
    ];
    const puntos = construirTWR(valuaciones, []);
    const anual = twrAnualizadoPct(puntos, 2 * 365.25);
    expect(anual!).toBeCloseTo(10, 0);
  });
});
