// ── Operaciones de edición sobre el catálogo de gastos ──────────────────────
//
// Módulo puro: recibe la lista y devuelve la lista nueva, sin tocar la original
// (la UI guarda la lista entera, ver lib/gastosFijos.ts). Está separado del
// componente para poder testear las reglas de vigencia, que son lo delicado.
//
// Convenciones (todas deliberadas):
// - **Corregir no es lo mismo que cambiar.** Editar el monto de un gasto puede
//   significar "lo había cargado mal" (se corrige en todos los meses) o "subió
//   desde marzo" (los meses anteriores siguen con el monto viejo). El segundo
//   caso parte la fila en dos: la vieja queda con `hasta` el mes anterior al
//   cambio y la nueva arranca en `desde`. Sin esto, cada aumento de alquiler
//   reescribiría el historial y el "sin asignar" de los meses pasados.
// - **Nombre y categoría son del concepto, no de la versión.** Al partir una fila
//   los dos tramos comparten nombre y categoría; solo cambia lo económico
//   (monto, moneda, frecuencia). Y editarlos en un período los cambia en todos:
//   si no, ese período se separaría en otro gasto.
// - **La baja no borra.** Poner `hasta` conserva el gasto en los meses en que
//   estuvo vigente. Borrar es para lo que se cargó por error.
// - **Un concepto son varios períodos.** Cada tramo sigue siendo una fila del
//   Sheet (un cambio de monto, o un gasto que se corta y vuelve, son filas con
//   el mismo nombre y categoría), pero `agruparPorConcepto` los junta para que la
//   UI muestre un gasto con su línea de tiempo, no una "baja" por cada aumento.
//   Decisión: docs/decisiones/0027-gastos-con-periodos-agrupados-por-concepto.md

import type { GastoFijo } from '@/types';
import { gastoVigenteEn, mesAnterior } from './finanzasPersonales';
import { CATEGORIA_SIN, normalizarTexto } from './gastosCategorias';

/** Campos que cambian cuánto pesa el gasto en un mes (y por lo tanto admiten "desde cuándo"). */
type CampoEconomico = 'monto' | 'moneda' | 'frecuencia';
const CAMPOS_ECONOMICOS: CampoEconomico[] = ['monto', 'moneda', 'frecuencia'];

export type CambiosGasto = Partial<Omit<GastoFijo, 'desde' | 'hasta'>> & {
  /** `null` borra el valor (volver a "desde siempre" / "sin baja"); `undefined` lo deja como está. */
  desde?: string | null;
  hasta?: string | null;
};

export interface OpcionesEdicion {
  /**
   * Mes desde el que rige un cambio económico. Si falta, o si no cae dentro de
   * la vigencia del gasto, el cambio es una corrección y vale para todos los meses.
   */
  cambioDesde?: string;
}

/** Aplica los cambios a una fila. `null` en desde/hasta los quita. */
function aplicar(g: GastoFijo, c: CambiosGasto): GastoFijo {
  const { desde, hasta, ...resto } = c;
  const out: GastoFijo = { ...g, ...resto };
  if (desde !== undefined) {
    if (desde === null) delete out.desde; else out.desde = desde;
  }
  if (hasta !== undefined) {
    if (hasta === null) delete out.hasta; else out.hasta = hasta;
  }
  return out;
}

export function cambiaLoEconomico(g: GastoFijo, c: CambiosGasto): boolean {
  return CAMPOS_ECONOMICOS.some((k) => c[k] !== undefined && c[k] !== g[k]);
}

/**
 * Edita el gasto en `indice`. Si cambia lo económico y se indica `cambioDesde`
 * dentro de su vigencia, parte la fila en dos (ver header); si no, edita en el
 * lugar. Un índice fuera de rango devuelve la lista sin cambios.
 */
export function editarGasto(
  gastos: GastoFijo[],
  indice: number,
  cambios: CambiosGasto,
  { cambioDesde }: OpcionesEdicion = {},
): GastoFijo[] {
  const orig = gastos[indice];
  if (!orig) return gastos;

  const editado = aplicar(orig, cambios);
  const dentroDeVigencia =
    cambioDesde != null &&
    (editado.desde == null || cambioDesde > editado.desde) &&
    (editado.hasta == null || cambioDesde <= editado.hasta);

  const clave = claveConcepto(orig);
  const lista = claveConcepto(editado) === clave
    ? gastos
    : gastos.map((g) => (claveConcepto(g) === clave ? { ...g, nombre: editado.nombre, categoria: editado.categoria } : g));

  if (!cambiaLoEconomico(orig, cambios) || !dentroDeVigencia) {
    return lista.map((g, i) => (i === indice ? editado : g));
  }

  // Tramo viejo: conserva lo económico original y termina el mes anterior al cambio.
  const viejo: GastoFijo = {
    ...orig,
    nombre: editado.nombre,
    categoria: editado.categoria,
    hasta: mesAnterior(cambioDesde!),
  };
  if (editado.desde) viejo.desde = editado.desde; else delete viejo.desde;
  // Tramo nuevo: lo económico editado, desde el mes del cambio, con la baja si había.
  const nuevo: GastoFijo = { ...editado, desde: cambioDesde! };

  return [...lista.slice(0, indice), viejo, nuevo, ...lista.slice(indice + 1)];
}

/**
 * Da de baja un gasto: deja de contar después de `ultimoMes` (inclusive). Si el
 * gasto todavía no había empezado a contar en ese mes no hay nada que conservar
 * y se elimina.
 */
export function darDeBaja(gastos: GastoFijo[], indice: number, ultimoMes: string): GastoFijo[] {
  const g = gastos[indice];
  if (!g) return gastos;
  if (g.desde && ultimoMes < g.desde) return gastos.filter((_, i) => i !== indice);
  return gastos.map((x, i) => (i === indice ? { ...x, hasta: ultimoMes } : x));
}

// ── Períodos de un mismo gasto ───────────────────────────────────────────────

/** Una fila del catálogo con su posición (las operaciones de edición trabajan por índice). */
export interface TramoGasto { g: GastoFijo; idx: number }

export type EstadoConcepto = 'activo' | 'programado' | 'baja';

export interface Concepto {
  clave: string;
  nombre: string;
  categoria: string;
  /** Ordenados por inicio: el que no tiene `desde` (desde siempre) va primero. */
  tramos: TramoGasto[];
  /** El tramo que representa al concepto hoy: el vigente; si no hay, el próximo programado; si no, el último. */
  actual: TramoGasto;
  estado: EstadoConcepto;
}

/** Mismo nombre (sin tildes ni mayúsculas) y misma categoría = mismo gasto en otro período. */
export function claveConcepto(g: Pick<GastoFijo, 'nombre' | 'categoria'>): string {
  return `${normalizarTexto(g.nombre)}|${g.categoria}`;
}

/**
 * Junta las filas que son el mismo gasto en distintos períodos. Un concepto está
 * 'activo' si algún tramo cuenta en `mesActual`, 'programado' si no pero hay uno
 * que arranca después, y 'baja' si todos terminaron: así un aumento de monto (el
 * tramo viejo termina, el nuevo sigue) no deja al gasto "dado de baja".
 * Respeta el orden en que aparece cada concepto en el catálogo.
 */
export function agruparPorConcepto(gastos: GastoFijo[], mesActual: string): Concepto[] {
  const porClave = new Map<string, TramoGasto[]>();
  gastos.forEach((g, idx) => {
    const k = claveConcepto(g);
    if (!porClave.has(k)) porClave.set(k, []);
    porClave.get(k)!.push({ g, idx });
  });

  return Array.from(porClave.entries()).map(([clave, lista]) => {
    const tramos = [...lista].sort((a, b) => (a.g.desde ?? '').localeCompare(b.g.desde ?? '') || a.idx - b.idx);
    const vigente = tramos.find((t) => gastoVigenteEn(t.g, mesActual));
    const programado = tramos.find((t) => t.g.desde != null && t.g.desde > mesActual);
    const estado: EstadoConcepto = vigente ? 'activo' : programado ? 'programado' : 'baja';
    const actual = vigente ?? programado ?? tramos[tramos.length - 1];
    return { clave, nombre: actual.g.nombre, categoria: actual.g.categoria, tramos, actual, estado };
  });
}

/**
 * Tramos del mismo gasto que cuentan en algún mes de la vigencia candidata. Si
 * se solapan, en esos meses se suman los dos: casi siempre es un error (un
 * aumento tendría que cortar el tramo anterior), pero no se bloquea. `excluir` es
 * la fila que se está editando.
 */
export function periodosSolapados(
  gastos: GastoFijo[],
  candidato: Pick<GastoFijo, 'nombre' | 'categoria'> & { desde?: string | null; hasta?: string | null },
  excluir?: GastoFijo,
): GastoFijo[] {
  const clave = claveConcepto(candidato);
  const FIN = '9999-99';
  return gastos.filter((g) =>
    g !== excluir
    && claveConcepto(g) === clave
    && (candidato.desde ?? '') <= (g.hasta ?? FIN)
    && (g.desde ?? '') <= (candidato.hasta ?? FIN));
}

/**
 * Corta los períodos que se pisan con el candidato: cada uno termina el mes anterior
 * a su inicio. `null` si no hay nada que cortar o si cortar perdería meses: el
 * candidato arranca antes que uno de ellos, o termina antes y dejaría sin gasto los
 * meses siguientes (un precio temporal, por ejemplo).
 */
export function cortarSolapados(
  gastos: GastoFijo[],
  candidato: Pick<GastoFijo, 'nombre' | 'categoria'> & { desde?: string | null; hasta?: string | null },
): GastoFijo[] | null {
  const { desde, hasta } = candidato;
  const solapados = periodosSolapados(gastos, candidato);
  if (!desde || solapados.length === 0) return null;
  const sePuede = solapados.every((g) =>
    (g.desde ?? '') < desde && (hasta == null || (g.hasta != null && g.hasta <= hasta)));
  if (!sePuede) return null;
  const fin = mesAnterior(desde);
  return gastos.map((g) => (solapados.includes(g) ? { ...g, hasta: fin } : g));
}

/** Renombra una categoría en todos los gastos. Si `a` ya existe, las dos quedan fusionadas. */
export function renombrarCategoria(gastos: GastoFijo[], de: string, a: string): GastoFijo[] {
  const destino = a.trim() || CATEGORIA_SIN;
  return gastos.map((g) => (g.categoria === de ? { ...g, categoria: destino } : g));
}
