// Qué archivos mensuales ya están cargados, para los íconos junto al botón de carga.
//
// Se controla solo el último mes cerrado: es el que hay que cargar ahora, y el
// resumen de un mes recién existe cuando ese mes terminó. Un archivo cuenta como
// cargado si su hoja tiene alguna fila con fecha de ese mes, el mismo criterio con
// el que los uploaders detectan un mes duplicado.
//
// Consecuencia aceptada: un mes real sin movimientos o sin acreditaciones no deja
// filas (el uploader lo rechaza por no encontrar nada), así que su ícono queda
// pendiente hasta que termine el mes siguiente.

import { parseFechaDia, toMesKey } from './parser';
import { sumarMeses } from './finanzasPersonales';
import type { EstadoCargas } from '@/types';

/** "YYYY-MM" del mes en curso, en hora de Argentina (Vercel corre en UTC). */
export function mesEnCurso(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
  }).format(ahora).slice(0, 7);
}

/** "YYYY-MM" del mes anterior al actual. */
export function ultimoMesCerrado(ahora: Date): string {
  const [y, m] = mesEnCurso(ahora).split('-').map(Number);
  return toMesKey(Date.UTC(y, m - 2, 1));
}

/**
 * Mes que se propone al cargar tenencias: el siguiente al último cargado, sin pasar
 * del mes en curso. Sin nada cargado, el último mes cerrado.
 */
export function proximoMesACargar(mesesCargados: string[], ahora: Date): string {
  if (mesesCargados.length === 0) return ultimoMesCerrado(ahora);
  const siguiente = sumarMeses([...mesesCargados].sort().at(-1)!, 1);
  const enCurso = mesEnCurso(ahora);
  return siguiente < enCurso ? siguiente : enCurso;
}

function tieneFilasDelMes(fechas: string[], mes: string): boolean {
  return fechas.some((f) => {
    const ts = parseFechaDia(f);
    return ts != null && toMesKey(ts) === mes;
  });
}

export function armarEstadoCargas(
  fechas: { tenencias: string[]; movimientos: string[]; haberes: string[] },
  ahora: Date,
): EstadoCargas {
  const mes = ultimoMesCerrado(ahora);
  return {
    mes,
    tenencias: tieneFilasDelMes(fechas.tenencias, mes),
    movimientos: tieneFilasDelMes(fechas.movimientos, mes),
    haberes: tieneFilasDelMes(fechas.haberes, mes),
  };
}
