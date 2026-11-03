import type { BondPerformance, CarryTradeItem } from '@/types';

/**
 * Carry trade: vender USD al MEP de entrada, comprar el instrumento en pesos,
 * mantenerlo hasta el vencimiento y volver a comprar USD al MEP de salida.
 * Calculado client-side (no vía API) porque el MEP de entrada/salida es un
 * escenario que el usuario ajusta de forma interactiva — recalcular en el
 * cliente evita un roundtrip por cada cambio de input.
 *
 * Universo: bonos a tasa FIJA (LECAP/Boncap, etiqueta "Fija" — se excluyen
 * duales, TAMAR y Badlar, que no tienen una tasa fija comparable en este
 * marco) con vencimiento hasta fin de 2027. Ese horizonte corto es a
 * propósito: son los instrumentos con los que de verdad se arma carry trade
 * de corto/mediano plazo; un dual a 2030 solo estira los ejes de la tabla y
 * el gráfico sin aportar una comparación útil.
 */
const LIMITE_VENCIMIENTO = '2027-12-31';

/** Techo de banda cambiaria oficial (BCRA) y fecha de referencia del dato duro
 * más reciente: $1.879,97 en agosto 2026, tras el esquema de ajuste mensual
 * por inflación (INDEC, con rezago de 2 meses) vigente desde el 2/1/2026.
 * A partir de esta ancla se proyecta hacia adelante con la inflación mensual
 * que ingresa el usuario, porque no hay forma de conocer la inflación futura real. */
const BANDA_ANCLA_TS = Date.UTC(2026, 7, 1); // 2026-08-01
const BANDA_ANCLA_VALOR = 1879.97;

/** Techo de banda proyectado a una fecha futura, componiendo la inflación mensual
 * ingresada desde la ancla conocida. */
function techoBandaProyectado(fechaTs: number, inflacionMensual: number): number {
  const mesesDesdeAncla = (fechaTs - BANDA_ANCLA_TS) / (1000 * 60 * 60 * 24 * 30);
  return BANDA_ANCLA_VALOR * Math.pow(1 + inflacionMensual, mesesDesdeAncla);
}

const TARGETS_FIJOS = { t1400: 1400, t1500: 1500, t1600: 1600 } as const;

function retornoUsd(retornoDirectoArs: number, mepEntrada: number, mepSalida: number): number {
  return ((1 + retornoDirectoArs) * mepEntrada) / mepSalida - 1;
}

export function calcularCarryTrade(
  bonos: BondPerformance[],
  mepEntrada: number | null,
  mepSalida: number | null,
  carryCustom: number | null,
  inflacionMensual: number,
): CarryTradeItem[] {
  return bonos
    .filter((b) => b.grupo === 'ARS_TASA' && b.etiqueta === 'Fija' && b.vencimiento <= LIMITE_VENCIMIENTO)
    .map((b) => {
      const anios = b.diasAlVencimiento / 365;
      const retornoDirectoArs = Math.pow(1 + b.tir, anios) - 1;
      const mepBreakeven = mepEntrada != null ? mepEntrada * (1 + retornoDirectoArs) : NaN;
      const devaluacionBreakeven = mepEntrada != null ? mepBreakeven / mepEntrada - 1 : NaN;
      const retornoDirectoUsd =
        mepEntrada != null && mepSalida != null
          ? retornoUsd(retornoDirectoArs, mepEntrada, mepSalida)
          : null;

      const carryPorTarget: CarryTradeItem['carryPorTarget'] = {
        t1400: mepEntrada != null ? retornoUsd(retornoDirectoArs, mepEntrada, TARGETS_FIJOS.t1400) : null,
        t1500: mepEntrada != null ? retornoUsd(retornoDirectoArs, mepEntrada, TARGETS_FIJOS.t1500) : null,
        t1600: mepEntrada != null ? retornoUsd(retornoDirectoArs, mepEntrada, TARGETS_FIJOS.t1600) : null,
        custom: mepEntrada != null && carryCustom != null ? retornoUsd(retornoDirectoArs, mepEntrada, carryCustom) : null,
      };

      const vtoTs = Date.parse(`${b.vencimiento}T00:00:00Z`);
      const techoBanda = techoBandaProyectado(vtoTs, inflacionMensual);
      const bandaSuperior = mepEntrada != null ? retornoUsd(retornoDirectoArs, mepEntrada, techoBanda) : null;

      const precio = b.lastPrice;
      const prFinish = precio != null ? precio * (1 + retornoDirectoArs) : null;

      return {
        ticker: b.ticker,
        bondFamily: b.bondFamily,
        precio,
        tir: b.tir,
        tna: b.tna,
        vencimiento: b.vencimiento,
        diasAlVencimiento: b.diasAlVencimiento,
        prFinish,
        retornoDirectoArs,
        mepBreakeven,
        devaluacionBreakeven,
        retornoDirectoUsd,
        carryPorTarget,
        bandaSuperior,
        ...(b.tenenciaUsd ? { tenenciaUsd: b.tenenciaUsd } : {}),
      };
    })
    .sort((a, b) => a.diasAlVencimiento - b.diasAlVencimiento);
}

/** Techo de banda proyectado para una fecha dada, expuesto para dibujar la curva
 * del gráfico (no depende de ningún bono puntual). */
export function techoBandaEnFecha(fechaTs: number, inflacionMensual: number): number {
  return techoBandaProyectado(fechaTs, inflacionMensual);
}
