// ── Paleta categórica ────────────────────────────────────────────────────────
// Tonos de sistema de Apple, re-escalonados para que entren en la banda de
// luminosidad de un gráfico sobre los dos fondos (#1c1c1e y #ffffff): el
// naranja y el amarillo de sistema puros son demasiado claros en oscuro y
// casi invisibles sobre blanco.
//
// El orden importa: validado con el script de la skill dataviz
// (validate_palette.js) en los dos modos, cada slot con el siguiente pasa la
// separación para daltonismo (ΔE ≥ 8) y para visión normal (ΔE ≥ 15). Por eso
// cada dimensión toma los slots en el orden alfabético de sus categorías, que
// es el orden de apilado de los gráficos: los vecinos son siempre pares
// validados. No-adyacentes pueden parecerse (azul y violeta, naranja y
// amarillo): los gráficos llevan leyenda y etiquetas.
//
// Ningún slot es verde ni rojo: esos colores son --up/--down.
export const SLOTS = [
  '#0a84ff', // 1 azul
  '#d96f00', // 2 naranja
  '#1e9ab0', // 3 turquesa
  '#b455e8', // 4 violeta
  '#b98a00', // 5 amarillo
  '#5e5ce6', // 6 índigo
  '#f2385a', // 7 rosa
] as const;
const GRIS = '#8e8e93'; // "otro": neutro, fuera de la secuencia

export const PALETA_TIPO: Record<string, string> = {
  ACCIONES: SLOTS[0],
  ACCION:   SLOTS[0], // alias
  ARGY:     SLOTS[1],
  ETF:      SLOTS[2],
  FCI:      SLOTS[3],
  CRIPTO:   SLOTS[4],
  BONOS:    SLOTS[5],
  ALTS:     SLOTS[6],
  OTRO:     GRIS,
};

// Paleta de respaldo para categorías sin color asignado arriba (ej. un TIPO
// nuevo en el Sheet). Se elige por hash del nombre, no por índice de aparición,
// para que la misma categoría tenga siempre el mismo color sin importar en qué
// gráfico o en qué orden aparezca (Treemap, EvolucionTipoChart, RebalanceoTab, etc).
const FALLBACK_PALETTE = [...SLOTS, GRIS];

export function colorPorCategoria(nombre: string): string {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) {
    hash = (hash * 31 + nombre.charCodeAt(i)) | 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

// De frío a cálido, en una secuencia validada aparte (el orden de riesgo no es
// el alfabético).
export const RIESGO_COLOR: Record<string, string> = {
  'CONSERVADOR':   SLOTS[2], // turquesa
  'MODERADO':      SLOTS[5], // índigo
  'MODERADO-ALTO': SLOTS[1], // naranja
  'AGRESIVO':      SLOTS[3], // violeta
};

export const RIESGO_LABEL: Record<number, string> = {
  1: 'CONSERVADOR',
  2: 'MODERADO',
  3: 'MODERADO-ALTO',
  4: 'AGRESIVO',
};

export const RENTA_LABEL: Record<string, string> = {
  'VAR': 'VARIABLE',
};

export const GEO_LABEL: Record<string, string> = {
  'EU':   'EEUU',
  'EMER': 'EMERGENTES',
  'GLO':  'GLOBAL',
  'DES':  'DESARROLLADOS',
};

export const MONEDA_LABEL: Record<string, string> = {
  'BAD': 'BADLAR',
};

export const MONEDA_COLOR: Record<string, string> = {
  'BAD':    SLOTS[0],
  'BADLAR': SLOTS[0], // alias
  'CER':    SLOTS[1],
  'DL':     SLOTS[2],
  'PESO':   SLOTS[3],
  'ARS':    SLOTS[3], // alias
  'USD':    SLOTS[4],
  'USDC':   SLOTS[5],
};

export const RENTA_COLOR: Record<string, string> = {
  'FIJA':     SLOTS[0],
  'VARIABLE': SLOTS[1],
  'VAR':      SLOTS[1],
};

export const GEO_COLOR: Record<string, string> = {
  'ARG':           SLOTS[0],
  'DES':           SLOTS[1],
  'DESARROLLADOS': SLOTS[1],
  'EMER':          SLOTS[2],
  'EMERGENTES':    SLOTS[2],
  'EU':            SLOTS[3],
  'EEUU':          SLOTS[3],
  'GLO':           SLOTS[4],
  'GLOBAL':        SLOTS[4],
};
