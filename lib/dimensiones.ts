// Cómo se agrupa la cartera en cada dimensión de composición (tipo de activo,
// riesgo, moneda, tipo de renta, geografía): qué etiqueta lleva cada tenencia y
// qué tenencias entran.
//
// Es un módulo aparte, sin dependencias de servidor, porque lo usan a la vez la
// vista Rebalanceo, el hook que carga los objetivos y la tool
// `objetivos_composicion` del MCP. Los objetivos se guardan en el Sheet por
// etiqueta: si cada uno etiquetara a su manera, una categoría dejaría de cruzar
// con su objetivo y se mostraría "sin objetivo" en silencio (ADR 0017).

import type { TenenciaActual } from '@/types';
import { RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL } from './constants';

/** Dimensiones por las que se agrupa la cartera y se puede fijar un objetivo. */
export const DIMENSIONES = ['TIPO', 'RIESGO', 'MONEDA', 'RENTA', 'SECTOR_GEO'] as const;
export type Dimension = (typeof DIMENSIONES)[number];

export const SIN_DATO = 'Sin dato';

/** Etiqueta de la categoría de `t` en `dim`: la que se muestra y la clave del objetivo. */
export function etiquetaCategoria(t: TenenciaActual, dim: Dimension): string {
  if (dim === 'RIESGO') return RIESGO_LABEL[Number(t.RIESGO)] ?? SIN_DATO;
  const raw = t[dim];
  if (raw == null || raw === '') return SIN_DATO;
  if (dim === 'MONEDA')     return MONEDA_LABEL[raw] ?? raw;
  if (dim === 'RENTA')      return RENTA_LABEL[raw]  ?? raw;
  if (dim === 'SECTOR_GEO') return GEO_LABEL[raw]    ?? raw;
  return raw;
}

/** Geografía solo tiene sentido para renta variable; el resto de las dimensiones usa toda la cartera. */
export function tenenciasDeDimension(tenencias: TenenciaActual[], dim: Dimension): TenenciaActual[] {
  return dim === 'SECTOR_GEO'
    ? tenencias.filter(t => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE')
    : tenencias;
}

/** Suma de `campo` por etiqueta, sobre las tenencias que entran en `dim`. */
export function sumarPorCategoria(
  tenencias: TenenciaActual[],
  dim: Dimension,
  campo: 'tenencia_usd' | 'tenencia_ars',
): Record<string, number> {
  const acc: Record<string, number> = {};
  for (const t of tenenciasDeDimension(tenencias, dim)) {
    const cat = etiquetaCategoria(t, dim);
    acc[cat] = (acc[cat] ?? 0) + t[campo];
  }
  return acc;
}

/** Participación (0-100) de cada etiqueta en `dim`, en USD. Vacío si no hay tenencias. */
export function participacionPorCategoria(tenencias: TenenciaActual[], dim: Dimension): Record<string, number> {
  const montos = sumarPorCategoria(tenencias, dim, 'tenencia_usd');
  const total = Object.values(montos).reduce((s, v) => s + v, 0);
  if (total === 0) return {};
  return Object.fromEntries(Object.entries(montos).map(([cat, v]) => [cat, (v / total) * 100]));
}
