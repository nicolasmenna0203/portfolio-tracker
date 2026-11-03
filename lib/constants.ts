export const PALETA_TIPO: Record<string, string> = {
  ARGY:     '#8d7fc7', // lavanda
  ETF:      '#5fb896', // verde salvia
  FCI:      '#cfab6e', // dorado
  ACCIONES: '#c15c4a', // terracota
  ACCION:   '#c15c4a', // terracota (alias)
  CRIPTO:   '#d4b95e', // ámbar
  BONOS:    '#6a9bab', // azul apagado
  ALTS:     '#b98fae', // ciruela
  OTRO:     '#8a7d6a', // gris cálido
};

// Paleta de respaldo para categorías sin color asignado arriba (ej. un TIPO
// nuevo en el Sheet). Se elige por hash del nombre, no por índice de aparición,
// para que la misma categoría tenga siempre el mismo color sin importar en qué
// gráfico o en qué orden aparezca (Treemap, EvolucionTipoChart, RebalanceoTab, etc).
const FALLBACK_PALETTE = [
  '#cfab6e', '#6a9bab', '#8d7fc7', '#d4b95e',
  '#c15c4a', '#7fb0c2', '#5fb896', '#b98fae', '#8a7d6a',
];

export function colorPorCategoria(nombre: string): string {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) {
    hash = (hash * 31 + nombre.charCodeAt(i)) | 0;
  }
  return FALLBACK_PALETTE[Math.abs(hash) % FALLBACK_PALETTE.length];
}

export const RIESGO_COLOR: Record<string, string> = {
  'CONSERVADOR':   '#5fb896', // verde salvia
  'MODERADO':      '#6a9bab', // azul apagado
  'MODERADO-ALTO': '#cfab6e', // dorado
  'AGRESIVO':      '#c15c4a', // terracota
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
  'USD':    '#6a9bab', // azul apagado
  'PESO':   '#8d7fc7', // lavanda
  'ARS':    '#8d7fc7', // lavanda (alias)
  'CER':    '#5fb896', // verde salvia
  'DL':     '#cfab6e', // dorado
  'BAD':    '#d4b95e', // ámbar
  'BADLAR': '#d4b95e', // ámbar (alias)
  'USDC':   '#c15c4a', // terracota
};

export const RENTA_COLOR: Record<string, string> = {
  'VARIABLE': '#cfab6e', // dorado
  'VAR':      '#cfab6e',
  'FIJA':     '#6a9bab', // azul apagado
};

export const GEO_COLOR: Record<string, string> = {
  'ARG':           '#8d7fc7', // lavanda
  'EU':            '#5fb896', // verde salvia
  'EEUU':          '#5fb896',
  'EMER':          '#c15c4a', // terracota
  'EMERGENTES':    '#c15c4a',
  'GLO':           '#cfab6e', // dorado
  'GLOBAL':        '#cfab6e',
  'DES':           '#6a9bab', // azul apagado
  'DESARROLLADOS': '#6a9bab',
};
