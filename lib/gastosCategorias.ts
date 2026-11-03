// ── Categorías de Gastos: lista cerrada y sugerencias ───────────────────────
//
// Decisión y alternativas descartadas: docs/decisiones/0028-cuatro-categorias-de-gastos-por-el-fin-del-gasto.md
//
// Módulo puro (sin googleapis, importable desde el cliente). Los gastos se agrupan
// en cuatro categorías fijas (`CATEGORIAS`), por el fin del gasto y no por cómo se
// paga. Las sugerencias son reglas, sin servicio externo ni modelo: funcionan
// igual en la demo y son predecibles (la misma entrada da siempre la misma).
//
// Dos usos:
//   1. `sugerirCategoria`: al escribir el nombre de un gasto, qué categoría
//      probablemente le corresponde.
//   2. `gastosParaRecategorizar`: gastos con una categoría fuera de la lista (una
//      vieja o escrita a mano en el Sheet) y a cuál de las cuatro moverlos.
//
// `descripcionCategoria` es el texto de ayuda que la UI muestra para cada una.
//
// Convenciones (deliberadas):
// - **Primero lo que el usuario ya hizo.** Si "Cochera" está en "Hogar", una
//   "Cochera depto" nueva cae ahí. El diccionario entra cuando el historial no
//   dice nada. Una categoría fuera de la lista no enseña nada.
// - **Sugerir, no aplicar.** Nada de acá modifica el catálogo; la UI muestra la
//   recomendación y el usuario decide.
// - Las palabras clave son términos genéricos de gasto cotidiano en Argentina
//   (servicios, rubros, algunas marcas masivas). No hay datos de nadie en el
//   diccionario: es lo único que puede estar en un repo público.

import type { GastoFijo } from '@/types';

/** Se guarda cuando una fila no trae categoría. No es una opción: la UI pide elegir una de la lista. */
export const CATEGORIA_SIN = 'Sin categoría';

/** Las únicas categorías que ofrece la UI. */
export const CATEGORIAS: string[] = ['Súper y comida', 'Transporte', 'Hogar', 'Ocio y personal'];

export function esCategoriaDeLista(categoria: string): boolean {
  return CATEGORIAS.includes(categoria);
}

/** Texto en minúscula, sin tildes ni puntuación, espacios colapsados. */
export function normalizarTexto(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Diccionario ──────────────────────────────────────────────────────────────

interface Rubro {
  /** Una de `CATEGORIAS`. */
  categoria: string;
  /** Qué entra en la categoría, para la ayuda de la UI. */
  descripcion: string;
  /** Nombres de categorías viejas o equivalentes (normalizados) que caen en esta. */
  alias: string[];
  /** Palabras o frases (normalizadas) que delatan el rubro en el nombre de un gasto. */
  claves: string[];
}

// Un rubro por categoría. El orden importa: gana el primer rubro que coincide. Por
// eso "Ocio y personal" va último: "seguro" solo cae ahí si no aparece antes el fin
// del seguro ("Seguro auto" es Transporte, "Seguro hogar" es Hogar).
const RUBROS: Rubro[] = [
  {
    categoria: 'Súper y comida',
    descripcion: 'Supermercado, verdulería, almacén, viandas y reposición diaria: limpieza, perfumería, kiosco.',
    alias: ['comida', 'comidas', 'alimentos', 'alimentacion', 'super', 'supermercado', 'despensa'],
    claves: [
      'supermercado', 'super', 'verduleria', 'carniceria', 'panaderia', 'almacen', 'mercado',
      'coto', 'carrefour', 'jumbo', 'changomas', 'vea', 'comida', 'viandas', 'almuerzo',
      'kiosco', 'limpieza', 'perfumeria',
    ],
  },
  {
    categoria: 'Transporte',
    descripcion: 'Nafta, transporte público, apps de viaje, peajes, cochera, mecánico, patente y seguro del auto.',
    alias: ['movilidad', 'auto', 'autos'],
    claves: [
      'nafta', 'combustible', 'sube', 'colectivo', 'subte', 'tren', 'uber', 'cabify', 'peaje',
      'estacionamiento', 'cochera', 'transporte', 'taxi', 'mecanico', 'neumaticos', 'lavadero',
      'auto', 'moto', 'patente',
    ],
  },
  {
    categoria: 'Hogar',
    descripcion: 'Alquiler, expensas, luz, gas, agua, internet, celular, impuestos de la propiedad, equipamiento y seguro del hogar.',
    alias: ['vivienda', 'casa', 'alquileres', 'servicio', 'servicios', 'servicios publicos', 'facturas', 'equipamiento'],
    claves: [
      'alquiler', 'expensas', 'hipoteca', 'cuota hipotecaria', 'consorcio', 'portero',
      'luz', 'gas', 'agua', 'internet', 'wifi', 'fibra', 'cable', 'telefono', 'celular', 'linea movil',
      'edenor', 'edesur', 'metrogas', 'aysa', 'fibertel', 'telecentro', 'movistar', 'claro',
      'abl', 'inmobiliario', 'tasa municipal', 'municipal',
      'muebles', 'electrodomesticos', 'hogar', 'decoracion', 'ferreteria', 'jardineria', 'empleada', 'domestica',
    ],
  },
  {
    categoria: 'Ocio y personal',
    descripcion: 'Salidas, delivery, suscripciones, gimnasio, salud, educación, ropa, viajes, mascotas, impuestos personales y otros seguros.',
    alias: [
      'ocio', 'personal', 'salidas', 'entretenimiento', 'esparcimiento', 'salud', 'medicina', 'salud y bienestar',
      'educacion', 'estudios', 'deporte', 'deportes', 'fitness', 'viaje', 'viajes', 'vacaciones', 'ropa',
      'indumentaria', 'mascota', 'mascotas', 'seguro', 'seguros', 'polizas', 'impuesto', 'impuestos', 'tasas', 'tributos',
      'suscripciones', 'suscripcion', 'subscripciones', 'subscripcion', 'membresias',
    ],
    claves: [
      'restaurante', 'resto', 'bar', 'cafe', 'cafeteria', 'delivery', 'rappi', 'pedidosya', 'salidas',
      'cine', 'teatro', 'boliche', 'recital', 'entretenimiento', 'ocio', 'helado', 'regalo',
      'suscripcion', 'membresia', 'streaming', 'netflix', 'spotify', 'disney', 'hbo', 'youtube',
      'prime', 'icloud', 'apple', 'dropbox', 'chatgpt', 'claude', 'openai', 'github', 'nube', 'almacenamiento',
      'musica', 'video', 'gimnasio', 'gym', 'club', 'pilates', 'yoga', 'natacion', 'crossfit',
      'ropa', 'calzado', 'zapatillas', 'indumentaria',
      'vuelo', 'pasaje', 'hotel', 'viaje', 'vacaciones', 'airbnb', 'aerolinea', 'millas',
      'prepaga', 'obra social', 'medico', 'medicina', 'farmacia', 'medicamentos', 'dentista',
      'odontologo', 'psicologo', 'terapia', 'kinesiologo', 'oculista', 'optica', 'analisis', 'salud',
      'colegio', 'escuela', 'universidad', 'facultad', 'curso', 'idiomas', 'ingles', 'clases',
      'capacitacion', 'libros', 'matricula', 'jardin', 'guarderia',
      'padel', 'futbol', 'deporte',
      'veterinario', 'veterinaria', 'mascota', 'perro', 'gato', 'balanceado',
      'seguro', 'poliza', 'cobertura',
      'monotributo', 'impuesto', 'ganancias', 'bienes personales', 'iibb', 'ingresos brutos',
      'arba', 'afip', 'arca', 'contador', 'autonomos',
    ],
  },
];

/** Qué entra en una categoría de la lista; `null` si está fuera de la lista. */
export function descripcionCategoria(categoria: string): string | null {
  return RUBROS.find((r) => r.categoria === categoria)?.descripcion ?? null;
}

/** La categoría de la lista que equivale a un nombre viejo o escrito distinto, o `null`. */
function categoriaEquivalente(categoria: string): string | null {
  const n = normalizarTexto(categoria);
  const rubro = RUBROS.find((r) => normalizarTexto(r.categoria) === n || r.alias.includes(n));
  return rubro ? rubro.categoria : null;
}

// ── Coincidencia de palabras ─────────────────────────────────────────────────

const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'por', 'para', 'con', 'un', 'una',
  'mensual', 'anual', 'cuota', 'pago', 'plan',
]);

/**
 * Palabras que dicen cómo se paga, no para qué: dos gastos que solo comparten una
 * de estas no se parecen ("Seguro hogar" no hereda la categoría de "Seguro auto").
 */
const NO_ACERCAN = new Set(['seguro', 'seguros', 'poliza', 'polizas']);

function tokens(texto: string): string[] {
  return normalizarTexto(texto)
    .split(' ')
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Un token coincide con una clave si son iguales, es su plural ("seguro" ↔
 * "seguros") o, solo para claves largas, la clave es su prefijo ("suscripcion"
 * ↔ "suscripciones"). Las claves cortas exigen igualdad: por prefijo "gas"
 * agarraría "gastos", "bar" agarraría "barrio" y "mercado" agarraría
 * "mercadolibre".
 */
function tokenCoincide(token: string, clave: string): boolean {
  if (token === clave || token === `${clave}s` || token === `${clave}es`) return true;
  return clave.length >= 8 && token.startsWith(clave);
}

function rubroPorDiccionario(nombre: string): Rubro | null {
  const texto = normalizarTexto(nombre);
  const toks = tokens(nombre);
  for (const r of RUBROS) {
    for (const clave of r.claves) {
      const hit = clave.includes(' ')
        ? ` ${texto} `.includes(` ${clave} `)
        : toks.some((t) => tokenCoincide(t, clave));
      if (hit) return r;
    }
  }
  return null;
}

// ── Sugerencia para un nombre ────────────────────────────────────────────────

export interface SugerenciaCategoria {
  categoria: string;
  /** 'historial': por parecerse a un gasto ya clasificado; 'regla': por el diccionario. */
  origen: 'historial' | 'regla';
  /** Frase que completa "Sugerida …": "por el nombre", "porque se parece a «Seguro auto»". */
  motivo: string;
}

/**
 * Categoría de la lista sugerida para el nombre de un gasto, o `null` si no hay
 * base para opinar. `gastos` es el catálogo actual: de ahí sale el historial.
 */
export function sugerirCategoria(nombre: string, gastos: GastoFijo[]): SugerenciaCategoria | null {
  if (normalizarTexto(nombre).length < 3) return null;

  const clasificados = gastos.filter((g) => esCategoriaDeLista(g.categoria));

  // 1. Historial: nombre igual, o el gasto clasificado con más palabras en común.
  const nombreNorm = normalizarTexto(nombre);
  const igual = clasificados.find((g) => normalizarTexto(g.nombre) === nombreNorm);
  if (igual) return { categoria: igual.categoria, origen: 'historial', motivo: `porque es igual a «${igual.nombre}»` };

  const toks = tokens(nombre).filter((t) => !NO_ACERCAN.has(t));
  let mejor: { gasto: GastoFijo; comunes: number } | null = null;
  for (const g of clasificados) {
    const otros = tokens(g.nombre);
    const comunes = toks.filter((t) => otros.some((o) => tokenCoincide(t, o) || tokenCoincide(o, t))).length;
    if (comunes > 0 && (mejor == null || comunes > mejor.comunes)) mejor = { gasto: g, comunes };
  }
  if (mejor) {
    return { categoria: mejor.gasto.categoria, origen: 'historial', motivo: `porque se parece a «${mejor.gasto.nombre}»` };
  }

  // 2. Diccionario.
  const rubro = rubroPorDiccionario(nombre);
  return rubro ? { categoria: rubro.categoria, origen: 'regla', motivo: 'por el nombre' } : null;
}

// ── Recategorizar lo que quedó fuera de la lista ─────────────────────────────

export interface RecategorizarSugerencia {
  /** Índices en el catálogo de todos los períodos del gasto: se mueven juntos. */
  indices: number[];
  gasto: GastoFijo;
  sugerencia: SugerenciaCategoria;
}

/**
 * Gastos con una categoría fuera de la lista para los que hay una mejor, uno por
 * concepto (mismo nombre y categoría, ver lib/gastosEdicion.ts): si se movieran de
 * a un período, el gasto quedaría partido. Manda el nombre del gasto ("Netflix" en
 * "Servicios" va a Ocio y personal, no a Hogar); si no dice nada, la categoría que
 * tenía.
 */
export function gastosParaRecategorizar(gastos: GastoFijo[]): RecategorizarSugerencia[] {
  const porConcepto = new Map<string, RecategorizarSugerencia | null>();
  gastos.forEach((gasto, indice) => {
    if (esCategoriaDeLista(gasto.categoria)) return;
    const clave = `${normalizarTexto(gasto.nombre)}|${gasto.categoria}`;
    const existente = porConcepto.get(clave);
    if (existente) { existente.indices.push(indice); return; }
    if (existente === null) return;
    const equivalente = categoriaEquivalente(gasto.categoria);
    // El gasto no se aprende a sí mismo: las filas fuera de la lista no cuentan como historial.
    const sugerencia = sugerirCategoria(gasto.nombre, gastos)
      ?? (equivalente && { categoria: equivalente, origen: 'regla' as const, motivo: `porque estaba en «${gasto.categoria}»` });
    porConcepto.set(clave, sugerencia ? { indices: [indice], gasto, sugerencia } : null);
  });
  return Array.from(porConcepto.values()).filter((r): r is RecategorizarSugerencia => r != null);
}
