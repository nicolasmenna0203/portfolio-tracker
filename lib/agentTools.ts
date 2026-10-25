/**
 * Capa de herramientas compartida para asistentes de IA.
 *
 * Define las funciones que un modelo puede invocar sobre los datos de la
 * cartera, junto con sus schemas JSON.
 *
 * Único consumidor hoy: `mcp/server.ts` (MCP server para Claude Desktop /
 * Claude Code). `components/ChatBot.tsx` NO usa esta capa — no hace tool
 * calling ni llama a ninguna API route; si alguna vez se le agrega, este es
 * el módulo del que tiene que colgar.
 *
 * Cada herramienta devuelve datos crudos (números, no strings formateados):
 * el modelo redacta la prosa, el código provee los hechos. Formatear acá
 * obligaría al modelo a re-parsear texto para comparar o sumar.
 *
 * El SYSTEM_PROMPT del final propaga al modelo las reglas de interpretación
 * que, ignoradas, producen respuestas equivocadas:
 *   - dividendos netos y qué excluye ese neto → docs/decisiones/0002-*.md
 *   - TIR no comparables entre grupos de tasa → docs/decisiones/0004-*.md
 *   - el MEP de cada mes, no un MEP único     → docs/decisiones/0007-*.md
 *   - la serie de la cartera incluye aportes  → docs/decisiones/0013-*.md
 */

import { fetchDashboardData } from './sheets';
import { RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL } from './constants';
import { tickersDeCartera } from './tickersElegibles';
import { fetchCalendarioFinanciero } from './calendario';
import { fetchPerformance } from './performance';
import { fetchFciPerformance } from './fci';
import { fetchPerformanceVariable } from './performanceVariable';
import { fetchBenchmarks } from './benchmarks';
import { FACTOR_NETO_DIVIDENDO } from './retenciones';
import { leerPerfil, registrarDecision } from './perfilInversor';
import { leerObjetivos, esDimension, DIMENSIONES, type Dimension } from './objetivos';
import { leerRatios, esRango, normalizarTicker } from './ratiosGuardados';
import { fetchHistoricoTicker } from './performanceVariable';
import { serieRatio, estadisticas } from './ratios';
import type { DashboardData, TenenciaActual } from '@/types';

// ── Cache de proceso ──────────────────────────────────────────────────────────
// Una consulta suele disparar varias tool calls seguidas. Sin esto cada una
// vuelve a repetir el mismo trabajo: leer el Sheet, o peor, pegarle de nuevo a
// Yahoo/bonistas/CAFCI, que tardan segundos.
//
// Dos TTLs porque las fuentes tienen naturaleza distinta: el Sheet es local y
// barato de releer; las APIs externas son lentas y sus datos (TIR de bonos,
// fundamentals, calendario de dividendos) no se mueven dentro de un cuarto de
// hora de análisis.

const TTL_SHEET_MS = 60_000;
const TTL_EXTERNO_MS = 15 * 60_000;

const cacheExterno = new Map<string, { valor: unknown; ts: number }>();
let cacheSheet: { data: DashboardData; ts: number } | null = null;

async function getData(): Promise<DashboardData> {
  if (cacheSheet && Date.now() - cacheSheet.ts < TTL_SHEET_MS) return cacheSheet.data;
  const data = await fetchDashboardData();
  cacheSheet = { data, ts: Date.now() };
  return data;
}

/** Memoiza el resultado de una fuente externa lenta bajo una clave estable. */
async function cacheado<T>(clave: string, fn: () => Promise<T>): Promise<T> {
  const hit = cacheExterno.get(clave);
  if (hit && Date.now() - hit.ts < TTL_EXTERNO_MS) return hit.valor as T;
  const valor = await fn();
  cacheExterno.set(clave, { valor, ts: Date.now() });
  return valor;
}

/** Invalida todos los caches. Para tests y para forzar relectura tras subir un archivo. */
export function invalidarCacheAgente(): void {
  cacheSheet = null;
  cacheExterno.clear();
}

/**
 * Deriva del último mes de cartera los insumos que piden los módulos de
 * mercado: tickers USA elegibles, tickers de bonos ARG mapeados, y el valor USD
 * de cada posición. Mismo criterio que usa el dashboard y el job de alertas.
 *
 * El modelo no tiene que pasar estas listas — se calculan de la cartera real.
 */
async function insumosDeCartera() {
  const data = await getData();
  const mesKey = ultimoMesKey(data);
  return {
    mesKey,
    ...tickersDeCartera(data.tenenciasPorMes[mesKey] ?? []),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Último mes con tenencias cargadas, en formato "YYYY-MM". */
function ultimoMesKey(data: DashboardData): string {
  const keys = Object.keys(data.tenenciasPorMes).sort();
  return keys[keys.length - 1] ?? '';
}

/**
 * Resuelve el mes a usar. Acepta "YYYY-MM" o undefined (= último disponible).
 * Devuelve null si el mes pedido no existe, para que la herramienta pueda
 * decir qué meses sí hay en vez de responder con una cartera vacía.
 */
function resolverMes(data: DashboardData, mes?: string): string | null {
  if (!mes) return ultimoMesKey(data);
  return data.tenenciasPorMes[mes] ? mes : null;
}

function agrupar(
  tenencias: TenenciaActual[],
  clave: (t: TenenciaActual) => string,
): { categoria: string; usd: number; pct: number }[] {
  const total = tenencias.reduce((s, t) => s + t.tenencia_usd, 0);
  const acc: Record<string, number> = {};
  for (const t of tenencias) {
    const k = clave(t);
    acc[k] = (acc[k] ?? 0) + t.tenencia_usd;
  }
  return Object.entries(acc)
    .map(([categoria, usd]) => ({
      categoria,
      usd: round(usd),
      pct: total > 0 ? round((usd / total) * 100) : 0,
    }))
    .sort((a, b) => b.usd - a.usd);
}

/** Redondea a 2 decimales. Evita ruido de coma flotante en el JSON del modelo. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convierte un filtro "YYYY-MM" al timestamp del borde del mes: el inicio del
 * día 1 con `fin: false`, el final del último día con `fin: true` (ambos
 * inclusive). Devuelve null si el filtro viene vacío o mal formado, que las
 * tools interpretan como "sin límite de ese lado".
 *
 * Compartido por las tools que aceptan rango: si cada una define el suyo,
 * basta con que alguien corrija una para que dos respuestas sobre el mismo
 * período dejen de coincidir.
 */
function limiteMes(mesKey: string | undefined, fin: boolean): number | null {
  if (!mesKey) return null;
  const [y, m] = mesKey.split('-').map(Number);
  if (!y || !m) return null;
  return fin ? Date.UTC(y, m, 0, 23, 59, 59) : Date.UTC(y, m - 1, 1);
}

// ── Implementaciones ──────────────────────────────────────────────────────────

async function resumenCartera() {
  const data = await getData();
  const { kpis } = data;
  const mesKey = ultimoMesKey(data);
  const tenencias = data.tenenciasPorMes[mesKey] ?? [];

  return {
    fecha_valuacion: kpis.fechaStr,
    mes_key: mesKey,
    total_cartera_usd: round(kpis.totalCartera),
    total_cartera_ars: round(kpis.totalCarteraArs),
    aportes_acumulados_usd: round(kpis.aporteAcumulados),
    rendimiento_neto_usd: round(kpis.rendimientoNeto),
    rendimiento_pct: round(kpis.rendimientoPct),
    delta_vs_mes_anterior_usd: round(kpis.deltaCartera),
    tir_anual_pct: kpis.tirAnual == null ? null : round(kpis.tirAnual),
    cantidad_activos: tenencias.length,
    meses_con_datos: data.mesesDisponibles.length,
    primer_mes: data.mesesDisponibles[0] ?? null,
    ultimo_mes: data.mesesDisponibles[data.mesesDisponibles.length - 1] ?? null,
  };
}

async function listarTenencias({ mes }: { mes?: string }) {
  const data = await getData();
  const mesKey = resolverMes(data, mes);
  if (!mesKey) {
    return {
      error: `No hay tenencias para el mes "${mes}".`,
      meses_disponibles: Object.keys(data.tenenciasPorMes).sort(),
    };
  }

  const tenencias = data.tenenciasPorMes[mesKey] ?? [];
  const total = tenencias.reduce((s, t) => s + t.tenencia_usd, 0);

  return {
    mes_key: mesKey,
    total_usd: round(total),
    posiciones: [...tenencias]
      .sort((a, b) => b.tenencia_usd - a.tenencia_usd)
      .map((t) => ({
        ticker: t.ticker,
        usd: round(t.tenencia_usd),
        ars: round(t.tenencia_ars),
        pct_cartera: total > 0 ? round((t.tenencia_usd / total) * 100) : 0,
        tipo: t.TIPO,
        riesgo: RIESGO_LABEL[t.RIESGO] ?? String(t.RIESGO),
        geografia: GEO_LABEL[t.SECTOR_GEO] ?? t.SECTOR_GEO,
        renta: RENTA_LABEL[t.RENTA] ?? t.RENTA,
        moneda: t.MONEDA,
      })),
  };
}

async function distribucion({
  criterio,
  mes,
}: {
  criterio: 'tipo' | 'riesgo' | 'geografia' | 'renta' | 'moneda';
  mes?: string;
}) {
  const data = await getData();
  const mesKey = resolverMes(data, mes);
  if (!mesKey) {
    return {
      error: `No hay tenencias para el mes "${mes}".`,
      meses_disponibles: Object.keys(data.tenenciasPorMes).sort(),
    };
  }

  const tenencias = data.tenenciasPorMes[mesKey] ?? [];
  const claves: Record<string, (t: TenenciaActual) => string> = {
    tipo:       (t) => t.TIPO || 'SIN DATO',
    riesgo:     (t) => RIESGO_LABEL[t.RIESGO] ?? 'SIN DATO',
    geografia:  (t) => GEO_LABEL[t.SECTOR_GEO] ?? (t.SECTOR_GEO || 'SIN DATO'),
    renta:      (t) => RENTA_LABEL[t.RENTA] ?? (t.RENTA || 'SIN DATO'),
    moneda:     (t) => t.MONEDA || 'SIN DATO',
  };

  return {
    mes_key: mesKey,
    criterio,
    grupos: agrupar(tenencias, claves[criterio]),
  };
}

/**
 * Composición real de la cartera contra los objetivos fijados en el dashboard,
 * con el desvío de cada categoría.
 *
 * Las etiquetas y el criterio de filtrado replican los de la pestaña de
 * Proyecciones (`components/ProyeccionesTab.tsx`), que es donde se cargan los
 * objetivos: si no coincidieran, las categorías no cruzarían y el desvío sería
 * inventado. En particular, geografía se calcula solo sobre renta variable,
 * igual que en la UI.
 */
async function objetivosComposicion({ dimension }: { dimension?: string }) {
  const [data, objetivos] = await Promise.all([getData(), leerObjetivos()]);
  const mesKey = resolverMes(data, undefined);
  if (!mesKey) return { error: 'No hay tenencias cargadas.' };

  const tenencias = data.tenenciasPorMes[mesKey] ?? [];

  const etiqueta: Record<Dimension, (t: TenenciaActual) => string> = {
    TIPO:       (t) => t.TIPO || 'Sin dato',
    RIESGO:     (t) => RIESGO_LABEL[Number(t.RIESGO)] ?? 'Sin dato',
    MONEDA:     (t) => MONEDA_LABEL[t.MONEDA] ?? t.MONEDA ?? 'Sin dato',
    RENTA:      (t) => RENTA_LABEL[t.RENTA] ?? t.RENTA ?? 'Sin dato',
    SECTOR_GEO: (t) => GEO_LABEL[t.SECTOR_GEO] ?? t.SECTOR_GEO ?? 'Sin dato',
  };

  const pedidas = dimension && esDimension(dimension.toUpperCase())
    ? [dimension.toUpperCase() as Dimension]
    : [...DIMENSIONES];

  const salida = pedidas.map((dim) => {
    // Geografía solo aplica a renta variable — mismo filtro que la UI.
    const src = dim === 'SECTOR_GEO'
      ? tenencias.filter((t) => t.RENTA === 'VAR' || t.RENTA === 'VARIABLE')
      : tenencias;
    const total = src.reduce((s, t) => s + t.tenencia_usd, 0);

    const realPct: Record<string, number> = {};
    for (const t of src) {
      const cat = etiqueta[dim](t);
      realPct[cat] = (realPct[cat] ?? 0) + (total > 0 ? (t.tenencia_usd / total) * 100 : 0);
    }

    const obj = objetivos[dim] ?? {};
    const categorias = [...new Set([...Object.keys(realPct), ...Object.keys(obj)])].sort();

    return {
      dimension: dim,
      tiene_objetivos: Object.keys(obj).length > 0,
      total_usd: Math.round(total * 100) / 100,
      categorias: categorias.map((cat) => {
        const real = Math.round((realPct[cat] ?? 0) * 10) / 10;
        const objetivo = obj[cat] ?? null;
        return {
          categoria: cat,
          real_pct: real,
          objetivo_pct: objetivo,
          // Positivo = sobreponderado respecto al objetivo.
          desvio_pp: objetivo == null ? null : Math.round((real - objetivo) * 10) / 10,
          ajuste_usd: objetivo == null ? null : Math.round(((objetivo - real) / 100) * total * 100) / 100,
        };
      }),
    };
  });

  return {
    mes_key: mesKey,
    dimensiones: salida,
    nota:
      'desvio_pp positivo = la categoría pesa más que su objetivo. ajuste_usd es cuánto ' +
      'habría que mover (positivo = comprar, negativo = vender) para alcanzarlo. Las ' +
      'dimensiones con tiene_objetivos=false no tienen objetivo fijado: no infieras uno.',
  };
}

/**
 * Ratio A/B: fuerza relativa entre dos activos.
 *
 * Sin argumentos devuelve los pares que el usuario guardó en el dashboard —
 * con su nota, que es el motivo por el que los sigue. Con `activo_a`/`activo_b`
 * calcula el par pedido aunque no esté guardado, para poder explorar.
 */
async function ratioActivos({
  activo_a, activo_b, rango,
}: { activo_a?: string; activo_b?: string; rango?: string }) {
  const guardados = await leerRatios();

  // Sin par explícito: catálogo de lo que el usuario decidió seguir.
  if (!activo_a && !activo_b) {
    return {
      pares_guardados: guardados.map((g) => ({
        par: `${g.activoA}/${g.activoB}`,
        activo_a: g.activoA,
        activo_b: g.activoB,
        rango: g.rango,
        nota: g.nota,
        creado: g.creado,
      })),
      nota:
        guardados.length === 0
          ? 'El usuario todavía no guardó ningún par. Podés pedir uno con activo_a y activo_b.'
          : 'Estos son los pares que el usuario sigue. La nota dice por qué le importa cada uno. ' +
            'Volvé a llamar con activo_a y activo_b para ver la serie y las métricas de uno.',
    };
  }

  const a = normalizarTicker(activo_a);
  const b = normalizarTicker(activo_b);
  if (!a || !b) return { error: 'Hacen falta activo_a y activo_b, ambos símbolos válidos.' };
  if (a === b) return { error: 'El ratio de un activo contra sí mismo es la constante 1.' };

  const rangoFinal = rango && esRango(rango) ? rango : '1a';

  const [ha, hb] = await Promise.all([
    fetchHistoricoTicker(a, rangoFinal),
    fetchHistoricoTicker(b, rangoFinal),
  ]);
  const serie = serieRatio(ha.puntos, hb.puntos);
  const est = estadisticas(serie);

  if (est == null) {
    return { error: `No hay fechas en común entre ${a} y ${b} en el rango ${rangoFinal}.` };
  }

  const guardado = guardados.find((g) => g.activoA === a && g.activoB === b);

  return {
    par: `${a}/${b}`,
    rango: rangoFinal,
    puntos_serie: serie.length,
    ratio_actual: round(est.actual),
    minimo: round(est.minimo),
    maximo: round(est.maximo),
    promedio: round(est.promedio),
    percentil: est.percentil == null ? null : round(est.percentil),
    z_score: est.zScore == null ? null : round(est.zScore),
    variacion_pct: round(est.variacion * 100),
    correlacion: est.correlacion == null ? null : round(est.correlacion),
    beta: est.beta == null ? null : round(est.beta),
    guardado: guardado != null,
    nota_usuario: guardado?.nota || null,
    nota:
      'ratio_actual = precio de A dividido precio de B. variacion_pct es cuánto rindió A por ' +
      'encima de B en el período (positivo = A le ganó a B). percentil ubica el ratio de hoy ' +
      'dentro del rango mín-máx del período. z_score son desvíos estándar respecto del promedio: ' +
      '|z| > 2 es un extremo estadístico, no una señal de compra. correlacion y beta se calculan ' +
      'sobre los retornos diarios de ambos activos.',
  };
}

async function evolucionMensual({ desde, hasta }: { desde?: string; hasta?: string }) {
  const data = await getData();

  // resumenSeries usa "Mar-2024"; los filtros usan "YYYY-MM" (fechaTs es la
  // única referencia común entre ambos formatos).
  const desdeTs = limiteMes(desde, false);
  const hastaTs = limiteMes(hasta, true);

  const serie = data.resumenSeries
    .filter((r) => (desdeTs == null || r.fechaTs >= desdeTs)
                && (hastaTs == null || r.fechaTs <= hastaTs))
    .map((r) => ({
      fecha: r.fecha,
      total_cartera_usd: round(r.total_cartera),
      total_cartera_ars: round(r.total_cartera_ars),
      aportes_del_mes_usd: round(r.aportes),
      aportes_acumulados_usd: round(r.acumulado),
      rendimiento_usd: round(r.rendimiento),
    }));

  if (serie.length === 0) {
    return { error: 'No hay meses en ese rango.', puntos: [] };
  }

  const ordenadaPorRendimiento = [...serie].sort(
    (a, b) => b.rendimiento_usd - a.rendimiento_usd,
  );
  const primero = serie[0];
  const ultimo = serie[serie.length - 1];

  return {
    puntos: serie,
    mejor_mes: ordenadaPorRendimiento[0],
    peor_mes: ordenadaPorRendimiento[ordenadaPorRendimiento.length - 1],
    variacion_periodo_usd: round(ultimo.total_cartera_usd - primero.total_cartera_usd),
  };
}

async function listarMovimientos({ desde, hasta }: { desde?: string; hasta?: string }) {
  const data = await getData();

  const desdeTs = limiteMes(desde, false);
  const hastaTs = limiteMes(hasta, true);

  const movimientos = data.movimientos.filter(
    (mv) => (desdeTs == null || mv.fecha >= desdeTs)
         && (hastaTs == null || mv.fecha <= hastaTs),
  );

  const totalPorTipo = { ingreso: 0, salida: 0 };
  for (const mv of movimientos) totalPorTipo[mv.tipo] += mv.monto_neto;

  return {
    cantidad: movimientos.length,
    total_neto_usd: round(movimientos.reduce((s, mv) => s + mv.monto_neto, 0)),
    total_ingresos_usd: round(totalPorTipo.ingreso),
    total_salidas_usd: round(Math.abs(totalPorTipo.salida)),
    movimientos: movimientos.map((mv) => ({
      fecha: new Date(mv.fecha).toISOString().slice(0, 10),
      tipo: mv.tipo,
      monto_usd: round(mv.monto_usd),
      monto_ars: round(mv.monto_ars),
      monto_neto_usd: round(mv.monto_neto),
      monto_neto_ars: round(mv.monto_neto_ars),
    })),
    nota:
      'monto_ars y monto_neto_ars están convertidos al MEP del día exacto de cada movimiento, no a un MEP único. monto_neto es positivo para ingresos y negativo para salidas.',
  };
}

async function historicoTicker({ ticker }: { ticker: string }) {
  const data = await getData();
  const buscado = ticker.trim().toUpperCase();

  const puntos = Object.keys(data.tenenciasPorMes)
    .sort()
    .map((mesKey) => {
      const t = data.tenenciasPorMes[mesKey].find(
        (x) => x.ticker.toUpperCase() === buscado,
      );
      if (!t) return null;
      const totalMes = data.tenenciasPorMes[mesKey].reduce(
        (s, x) => s + x.tenencia_usd, 0,
      );
      return {
        mes_key: mesKey,
        usd: round(t.tenencia_usd),
        ars: round(t.tenencia_ars),
        pct_cartera: totalMes > 0 ? round((t.tenencia_usd / totalMes) * 100) : 0,
      };
    })
    .filter(Boolean);

  if (puntos.length === 0) {
    const tickersConocidos = [
      ...new Set(
        Object.values(data.tenenciasPorMes).flat().map((t) => t.ticker),
      ),
    ].sort();
    return {
      error: `El ticker "${ticker}" no aparece en ningún mes de la cartera.`,
      tickers_disponibles: tickersConocidos,
    };
  }

  return { ticker: buscado, puntos };
}

async function metricasConcentracion({ mes }: { mes?: string }) {
  const data = await getData();
  const mesKey = resolverMes(data, mes);
  if (!mesKey) {
    return {
      error: `No hay tenencias para el mes "${mes}".`,
      meses_disponibles: Object.keys(data.tenenciasPorMes).sort(),
    };
  }

  const tenencias = data.tenenciasPorMes[mesKey] ?? [];
  const total = tenencias.reduce((s, t) => s + t.tenencia_usd, 0);
  if (total <= 0) return { error: 'La cartera no tiene valuación en ese mes.' };

  const pesos = tenencias
    .map((t) => ({ ticker: t.ticker, w: t.tenencia_usd / total }))
    .sort((a, b) => b.w - a.w);

  // HHI sobre pesos en porcentaje: 10.000 = un solo activo.
  // Umbrales antitrust habituales (1500 / 2500) usados como referencia grosera.
  const hhi = pesos.reduce((s, p) => s + Math.pow(p.w * 100, 2), 0);

  const topN = (n: number) =>
    round(pesos.slice(0, n).reduce((s, p) => s + p.w, 0) * 100);

  return {
    mes_key: mesKey,
    cantidad_posiciones: pesos.length,
    top1_pct: topN(1),
    top3_pct: topN(3),
    top5_pct: topN(5),
    hhi: Math.round(hhi),
    hhi_interpretacion:
      hhi < 1500 ? 'diversificada' : hhi < 2500 ? 'concentracion moderada' : 'concentrada',
    posiciones_ordenadas: pesos.map((p) => ({
      ticker: p.ticker,
      pct: round(p.w * 100),
    })),
  };
}

// ── Módulos de mercado (fuentes externas) ─────────────────────────────────────

async function calendarioCobros({ meses }: { meses: number }) {
  const { tickersUsa, tickersArg, tenencias } = await insumosDeCartera();
  if (tickersUsa.length === 0 && tickersArg.length === 0) {
    return { error: 'No hay tickers elegibles en la cartera para consultar el calendario.' };
  }

  const hoy = new Date();
  const desde = hoy.toISOString().slice(0, 10);
  const fin = new Date(hoy);
  fin.setMonth(fin.getMonth() + meses);
  const hasta = fin.toISOString().slice(0, 10);

  const clave = `calendario:${desde}:${hasta}:${tickersUsa.join(',')}:${tickersArg.join(',')}`;
  const res = await cacheado(clave, () =>
    fetchCalendarioFinanciero(tickersUsa, tickersArg, desde, hasta, tenencias),
  );

  // Los cobros vienen en monedas distintas: dividendos de CEDEARs/ETFs en USD,
  // cupones de bonos ARG en pesos. Sumarlos juntos daría un número sin sentido,
  // y sumar solo una moneda haría parecer que no se cobra nada en la otra.
  const totalPorMoneda: Record<string, number> = {};
  for (const e of res.eventos) {
    if (e.montoEstimado == null) continue;
    const moneda = e.monedaMonto ?? 'USD';
    totalPorMoneda[moneda] = (totalPorMoneda[moneda] ?? 0) + e.montoEstimado;
  }
  for (const k of Object.keys(totalPorMoneda)) {
    totalPorMoneda[k] = round(totalPorMoneda[k]);
  }

  return {
    ventana: { desde, hasta, meses },
    criterio_montos:
      'Los montos son NETOS estimados. Dividendos de acciones/ETFs USA (incluidos vía CEDEAR) llevan 30% de retención de origen más 0,6% de impuesto al cheque (factor 0,694). No descuenta la comisión del depositario, que varía por CEDEAR y no tiene fuente pública confiable, así que el neto real puede ser 1-2% menor. Renta y amortización de bonos ARG van al 100%, sin retención.',
    total_estimado_por_moneda: totalPorMoneda,
    nota_totales:
      'Los totales están separados por moneda y NO se pueden sumar entre sí sin convertir al MEP. Si no aparece una moneda, es que no hay cobros estimados en esa moneda en la ventana consultada.',
    cantidad_eventos: res.eventos.length,
    eventos: res.eventos.map((e) => ({
      ticker: e.ticker,
      tipo: e.tipo,
      fecha: e.fecha,
      detalle: e.detalle ?? null,
      monto_neto_estimado: e.montoEstimado == null ? null : round(e.montoEstimado),
      moneda: e.monedaMonto ?? null,
    })),
    yields: res.yields.map((y) => ({
      ticker: y.ticker,
      yield_anual_bruto_pct: round(y.yieldAnual * 100),
      pagos_ultimos_12m: y.pagos,
      cobro_anual_neto_usd: y.cobroAnual == null ? null : round(y.cobroAnual),
    })),
    nota_yield:
      'yield_anual_bruto_pct es el yield que publica el emisor, SIN retenciones — comparable con cualquier screener. cobro_anual_neto_usd sí va neto según la tenencia actual. Son deliberadamente inconsistentes entre sí.',
    errores: res.errores,
  };
}

async function rentaFijaBonos() {
  const { tenencias } = await insumosDeCartera();
  const res = await cacheado('performance-bonos', () => fetchPerformance(tenencias));

  // El universo de bonistas trae ~900 bonos; al modelo solo le sirven los que
  // están en cartera más un puñado comparable, o el JSON tapa el contexto.
  const enCartera = res.bonos.filter((b) => b.tenenciaUsd != null);

  return {
    nota_comparabilidad:
      'Las TIR solo son comparables dentro del mismo grupo: USD (hard dollar soberano), CER (ajusta por inflación), ARS_TASA (tasa fija en pesos), DOLLAR_LINKED, BOPREAL y ONS_USD (obligaciones negociables corporativas hard dollar, distinto riesgo de crédito que la deuda soberana). Comparar la TIR de un bono CER contra uno USD no significa nada, y tampoco comparar un soberano USD contra una ON ONS_USD aunque ambas sean hard dollar.',
    cartera_por_grupo: res.carteraPorGrupo.map((g) => ({
      grupo: g.grupo,
      tir_ponderada_pct: round(g.tirPonderada * 100),
      duration_ponderada_anios: round(g.durationPonderada),
      tenencia_total_usd: round(g.tenenciaTotalUsd),
    })),
    bonos_en_cartera: enCartera.map((b) => ({
      ticker: b.tickerCartera ?? b.ticker,
      grupo: b.grupo,
      etiqueta: b.etiqueta,
      moneda: b.moneda,
      tir_pct: round(b.tir * 100),
      tna_pct: round(b.tna * 100),
      duration_modificada_anios: round(b.modifiedDuration),
      paridad_pct: b.parity == null ? null : round(b.parity * 100),
      ultimo_precio: b.lastPrice,
      vencimiento: b.vencimiento,
      dias_al_vencimiento: b.diasAlVencimiento,
      tenencia_usd: round(b.tenenciaUsd ?? 0),
    })),
    bonos_fuera_de_cartera_disponibles: res.bonos.length - enCartera.length,
  };
}

async function rentaFijaFci() {
  const { tenencias } = await insumosDeCartera();
  const res = await cacheado('fci', () => fetchFciPerformance(tenencias));

  const enCartera = res.fondos.filter((f) => f.tenenciaUsd != null);
  const lista = enCartera.length > 0 ? enCartera : res.fondos;

  // null = CAFCI no publicó la columna para esa fila (fondo con un día de
  // rezago). No se convierte a 0: el modelo tiene que poder decir "sin dato".
  const pct = (v: number | null) => (v == null ? null : round(v * 100));

  return {
    fuente: 'Planilla pública diaria de CAFCI (fondos del broker).',
    solo_en_cartera: enCartera.length > 0,
    nota_rendimientos:
      'Un rendimiento en null significa que la planilla no lo informa para ese fondo (viene con un día de rezago y sin columnas de comparación), no que haya rendido 0%. Decí "sin dato" y, si importa, que el dato es al día que indica fecha_dato. Si rendimiento_12m_estimado=true, el rendimiento_12m_pct no sale de CAFCI sino que se calculó con una fuente secundaria (VCP de hoy vs. hace 12 meses): aclaralo si lo mencionás, no lo presentes igual que el resto.',
    fondos: lista.map((f) => ({
      ticker: f.ticker,
      nombre: f.nombreFondo,
      moneda: f.moneda,
      horizonte: f.horizonte,
      vcp: f.vcp,
      variacion_diaria_pct: pct(f.variacionDiaria),
      rendimiento_mes_pct: pct(f.rendimientoMes),
      rendimiento_anio_pct: pct(f.rendimientoAnio),
      rendimiento_12m_pct: pct(f.rendimiento12Meses),
      rendimiento_12m_estimado: f.rendimiento12MesesEstimado,
      patrimonio: f.patrimonio,
      fecha_dato: f.fecha,
      dato_rezagado: f.rezagado,
      tenencia_usd: f.tenenciaUsd == null ? null : round(f.tenenciaUsd),
    })),
  };
}

async function rentaVariableAcciones() {
  const { tickersUsa, tenencias, tickersFciVariable } = await insumosDeCartera();
  if (tickersUsa.length === 0 && tickersFciVariable.length === 0) {
    return { error: 'No hay acciones ni ETFs elegibles en la cartera.' };
  }

  const clave = `perf-variable:${tickersUsa.join(',')}|${tickersFciVariable.join(',')}`;
  const res = await cacheado(clave, () => fetchPerformanceVariable(tickersUsa, tenencias, tickersFciVariable));

  const pct = (v: number | null) => (v == null ? null : round(v * 100));

  return {
    nota: 'Variaciones de precio de mercado del activo subyacente, no del valor de tu tenencia (que además depende de cuándo compraste y de cuántas unidades tenés).',
    nota_fondos:
      'Las posiciones con es_fci=true son fondos comunes de inversión que la cartera clasifica como renta variable: no cotizan en el proveedor de precios, así que "precio" es el VCP en moneda_vcp (puede ser ARS, no USD) y las variaciones de 1 mes / YTD / 1 año son los rendimientos de mes, año y 12 meses que publica CAFCI. No tienen P/E, market cap ni rango de 52 semanas. No compares su VCP contra el precio en USD de una acción.',
    acciones: res.acciones.map((a) => ({
      ticker: a.ticker,
      nombre: a.nombre ?? null,
      precio: a.px,
      variacion_1d_pct: pct(a.variacion1d),
      variacion_1m_pct: pct(a.variacion1m),
      variacion_ytd_pct: pct(a.variacionYtd),
      variacion_1a_pct: pct(a.variacion1a),
      pe_ratio: a.peRatio,
      market_cap: a.marketCap,
      minimo_52s: a.fiftyTwoWeekLow,
      maximo_52s: a.fiftyTwoWeekHigh,
      dividend_yield_pct: pct(a.dividendYield),
      tenencia_usd: a.tenenciaUsd == null ? null : round(a.tenenciaUsd),
      ...(a.esFci
        ? { es_fci: true, moneda_vcp: a.fciMoneda ?? null, fecha_dato: a.fciFecha ?? null, dato_rezagado: a.fciRezagado ?? false }
        : {}),
    })),
  };
}

async function compararBenchmarks() {
  const data = await getData();
  const mesesCartera = Object.keys(data.tenenciasPorMes).sort();
  if (mesesCartera.length === 0) return { error: 'No hay meses de cartera para comparar.' };

  const series = await cacheado(`benchmarks:${mesesCartera[0]}:${mesesCartera.length}`, () =>
    fetchBenchmarks(mesesCartera),
  );

  // La cartera se rebasea a 100 en el mismo mes que los benchmarks, si no la
  // comparación no significa nada.
  const baseTotal = data.totalPorMes[mesesCartera[0]] ?? 0;
  const serieCartera = mesesCartera.map((m) => ({
    mesKey: m,
    valor: baseTotal > 0 ? round(((data.totalPorMes[m] ?? 0) / baseTotal) * 100) : 0,
  }));

  const ultimo = (pts: { valor: number }[]) =>
    pts.length > 0 ? round(pts[pts.length - 1].valor) : null;

  return {
    base: `Todas las series están en índice base 100 en ${mesesCartera[0]}. NO son precios: un valor de 130 significa +30% desde esa fecha.`,
    advertencia_cartera:
      'La serie de la cartera sigue su valuación total, que sube por aportes nuevos además de por rendimiento. Para medir rendimiento puro usá resumen_cartera (rendimiento_pct) o evolucion_mensual, no esta comparación.',
    mes_base: mesesCartera[0],
    cartera: { puntos: serieCartera, valor_final: ultimo(serieCartera) },
    benchmarks: series.map((s) => ({
      id: s.id,
      label: s.label,
      valor_final: ultimo(s.puntos),
      puntos: s.puntos.map((p) => ({ mesKey: p.mesKey, valor: round(p.valor) })),
      error: s.error ?? null,
    })),
  };
}

// ── Registro de herramientas ──────────────────────────────────────────────────

/** Input crudo de una tool call. Viene de un modelo: nunca asumir su forma. */
type ToolInput = Record<string, unknown>;

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  run: (input: ToolInput) => Promise<unknown>;
}

/** Lee un string opcional del input, tolerando null y tipos inesperados. */
function optStr(input: ToolInput, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

const MES_PROP = {
  type: 'string' as const,
  description:
    'Mes a consultar en formato "YYYY-MM" (ej. "2026-07"). Si se omite, usa el último mes disponible.',
};

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: 'resumen_cartera',
    description:
      'Devuelve los KPIs generales de la cartera al último mes: valuación total en USD y ARS, aportes acumulados, rendimiento neto y porcentual, variación contra el mes anterior, TIR anual y cantidad de activos. Usar como primer paso ante cualquier pregunta general sobre cómo va la cartera.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => resumenCartera(),
  },
  {
    name: 'listar_tenencias',
    description:
      'Lista todas las posiciones de un mes con su valuación en USD y ARS, su peso porcentual en la cartera y sus atributos (tipo, riesgo, geografía, renta, moneda). Usar cuando la pregunta sea sobre activos puntuales, cuáles pesan más, o para inspeccionar la composición en detalle.',
    inputSchema: {
      type: 'object',
      properties: { mes: MES_PROP },
      additionalProperties: false,
    },
    run: (input) => listarTenencias({ mes: optStr(input, 'mes') }),
  },
  {
    name: 'distribucion',
    description:
      'Agrupa la cartera de un mes según un criterio y devuelve el monto y porcentaje de cada categoría. Usar para preguntas sobre diversificación, exposición geográfica, mezcla renta fija/variable o composición por moneda.',
    inputSchema: {
      type: 'object',
      properties: {
        criterio: {
          type: 'string',
          enum: ['tipo', 'riesgo', 'geografia', 'renta', 'moneda'],
          description: 'Dimensión por la cual agrupar las tenencias.',
        },
        mes: MES_PROP,
      },
      required: ['criterio'],
      additionalProperties: false,
    },
    run: async (input) => {
      const criterio = optStr(input, 'criterio');
      const validos = ['tipo', 'riesgo', 'geografia', 'renta', 'moneda'] as const;
      if (!criterio || !validos.includes(criterio as (typeof validos)[number])) {
        return {
          error: `El parámetro "criterio" es obligatorio y debe ser uno de: ${validos.join(', ')}.`,
        };
      }
      return distribucion({
        criterio: criterio as (typeof validos)[number],
        mes: optStr(input, 'mes'),
      });
    },
  },
  {
    name: 'evolucion_mensual',
    description:
      'Serie mensual de valuación total, aportes y rendimiento, más el mejor y peor mes del período. Usar para preguntas sobre evolución en el tiempo, crecimiento, o qué mes anduvo mejor o peor. Acepta un rango opcional.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Mes inicial "YYYY-MM" (inclusive). Opcional.' },
        hasta: { type: 'string', description: 'Mes final "YYYY-MM" (inclusive). Opcional.' },
      },
      additionalProperties: false,
    },
    run: (input) =>
      evolucionMensual({ desde: optStr(input, 'desde'), hasta: optStr(input, 'hasta') }),
  },
  {
    name: 'listar_movimientos',
    description:
      'Lista los movimientos de dinero (aportes y retiros) cargados en el Sheet, con fecha, tipo, y monto en USD y ARS al MEP del día exacto. Incluye el total neto, de ingresos y de salidas del período. Usar para preguntas sobre cuánto se aportó o retiró, cuándo, o para auditar los movimientos que explican la evolución de la cartera. Acepta un rango opcional.',
    inputSchema: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'Mes inicial "YYYY-MM" (inclusive). Opcional.' },
        hasta: { type: 'string', description: 'Mes final "YYYY-MM" (inclusive). Opcional.' },
      },
      additionalProperties: false,
    },
    run: (input) =>
      listarMovimientos({ desde: optStr(input, 'desde'), hasta: optStr(input, 'hasta') }),
  },
  {
    name: 'historico_ticker',
    description:
      'Evolución mes a mes de la tenencia de un ticker puntual: monto en USD/ARS y su peso en la cartera. Usar cuando la pregunta sea sobre cómo evolucionó una posición específica. Si el ticker no existe, devuelve la lista de tickers válidos.',
    inputSchema: {
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Símbolo del activo, ej. "AAPL" o "AL30".' },
      },
      required: ['ticker'],
      additionalProperties: false,
    },
    run: async (input) => {
      const ticker = optStr(input, 'ticker');
      if (!ticker) return { error: 'El parámetro "ticker" es obligatorio.' };
      return historicoTicker({ ticker });
    },
  },
  {
    name: 'metricas_concentracion',
    description:
      'Métricas de concentración de la cartera: peso del top 1/3/5, índice HHI con su interpretación, y todas las posiciones ordenadas por peso. Usar para preguntas sobre riesgo de concentración, diversificación o rebalanceo.',
    inputSchema: {
      type: 'object',
      properties: { mes: MES_PROP },
      additionalProperties: false,
    },
    run: (input) => metricasConcentracion({ mes: optStr(input, 'mes') }),
  },

  // ── Mercado: consultan fuentes externas (Yahoo, bonistas.com, CAFCI, Nasdaq).
  // Más lentas que las anteriores; los resultados se cachean 15 minutos.

  {
    name: 'calendario_cobros',
    description:
      'Próximos cobros de la cartera: dividendos de acciones/ETFs, cupones de renta y amortización de bonos ARG, y fechas de balances. Incluye el monto neto estimado según la tenencia actual y el dividend yield de cada posición. Usar para preguntas sobre cuánto se va a cobrar, cuándo, o qué posiciones pagan renta. Los tickers se derivan solos de la cartera.',
    inputSchema: {
      type: 'object',
      properties: {
        meses: {
          type: 'integer',
          minimum: 1,
          maximum: 24,
          description: 'Cuántos meses hacia adelante mirar. Por defecto 3.',
        },
      },
      additionalProperties: false,
    },
    run: (input) => {
      const raw = input.meses;
      const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : 3;
      return calendarioCobros({ meses: Math.min(24, Math.max(1, n)) });
    },
  },
  {
    name: 'renta_fija_bonos',
    description:
      'Métricas de los bonos argentinos en cartera: TIR, TNA, duration modificada, paridad, precio y vencimiento, más la TIR y duration ponderadas por grupo de tasa. Usar para preguntas sobre rendimiento de bonos, riesgo de tasa, duration o vencimientos. Las TIR solo son comparables dentro del mismo grupo.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => rentaFijaBonos(),
  },
  {
    name: 'renta_fija_fci',
    description:
      'Rendimientos de los fondos comunes de inversión del broker: VCP, variación diaria, y rendimiento del mes, del año y de 12 meses. Prioriza los fondos que están en cartera. Usar para preguntas sobre cómo rinden los FCI.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => rentaFijaFci(),
  },
  {
    name: 'renta_variable_acciones',
    description:
      'Fundamentals y variaciones de las acciones y ETFs en cartera: precio, variación a 1 día/1 mes/YTD/1 año, P/E, market cap, mínimo y máximo de 52 semanas y dividend yield. Usar para preguntas sobre cómo vienen las acciones, cuáles subieron o bajaron, o si alguna está cara o barata.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => rentaVariableAcciones(),
  },
  {
    name: 'comparar_benchmarks',
    description:
      'Compara la evolución de la cartera contra S&P 500, inflación argentina, dólar MEP, Bitcoin y oro, todo en índice base 100 desde el primer mes con datos. Usar para preguntas del tipo "¿le gano a la inflación?" o "¿me hubiera convenido comprar dólares?". Ojo: la serie de la cartera incluye aportes nuevos, no es rendimiento puro.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => compararBenchmarks(),
  },
  {
    name: 'objetivos_composicion',
    description:
      'Compara la composición real de la cartera contra los objetivos de asignación que el usuario fijó en la pestaña Proyecciones del dashboard, por tipo de activo, riesgo, moneda, tipo de renta y geografía. Devuelve el desvío en puntos porcentuales y cuántos USD habría que mover para alcanzar cada objetivo. Usar SIEMPRE que la pregunta sea sobre rebalanceo, si algo se fue de peso, o si la cartera está donde debería estar: el usuario rebalancea por peso contra estos objetivos, así que opinar sin leerlos es opinar sin el criterio. Si una dimensión tiene tiene_objetivos=false, no hay objetivo fijado y no hay que inferir uno.',
    inputSchema: {
      type: 'object',
      properties: {
        dimension: {
          type: 'string',
          enum: ['TIPO', 'RIESGO', 'MONEDA', 'RENTA', 'SECTOR_GEO'],
          description: 'Dimensión puntual a consultar. Si se omite, devuelve las cinco.',
        },
      },
      additionalProperties: false,
    },
    run: (input) => objetivosComposicion({ dimension: optStr(input, 'dimension') }),
  },
  {
    name: 'ratio_activos',
    description:
      'Fuerza relativa entre dos activos: la serie del ratio A/B y sus métricas (ratio actual, mínimo, máximo, promedio, percentil, z-score, correlación y beta). Sin argumentos devuelve los pares que el usuario guardó en la pestaña Ratios del dashboard, con la nota de por qué sigue cada uno. Usar cuando la pregunta sea sobre si un activo le viene ganando a otro, si un par está estirado o barato contra su historia, o para comparar dos posiciones entre sí.',
    inputSchema: {
      type: 'object',
      properties: {
        activo_a: { type: 'string', description: 'Numerador del ratio, ej. "SPY". Omitir para listar los pares guardados.' },
        activo_b: { type: 'string', description: 'Denominador del ratio, ej. "GLD".' },
        rango: { type: 'string', description: 'Ventana: "1m", "6m", "1a", "5a" o "10a". Por defecto "1a".' },
      },
      additionalProperties: false,
    },
    run: (input) => ratioActivos({
      activo_a: optStr(input, 'activo_a'),
      activo_b: optStr(input, 'activo_b'),
      rango: optStr(input, 'rango'),
    }),
  },
  {
    name: 'perfil_inversor',
    description:
      'Devuelve el perfil del inversor: objetivo, horizonte, criterios de venta, postura sobre la exposición argentina, cómo reacciona ante caídas, y el log de decisiones tomadas. Es el marco para interpretar los datos, no datos de la cartera. Llamala SIEMPRE antes de dar una lectura interpretativa (si conviene rebalancear, si está muy concentrado, si un bono está caro): sin esto el análisis es genérico y puede contradecir criterios que el usuario ya definió.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: () => leerPerfil(),
  },
  {
    name: 'registrar_aprendizaje',
    description:
      'Agrega una decisión al log del perfil del inversor, de forma permanente. Usar SOLO cuando el usuario expresa un criterio de decisión duradero o toma una decisión concreta sobre su cartera con su razonamiento (ej. "no vendo aunque suba, salvo que se rompa la tesis", "voy a bajar ARG al 30% antes de fin de año"). NO usar para observaciones de la conversación, preguntas que hizo, estados de ánimo sobre el mercado, ni conclusiones tuyas: eso llena el archivo de ruido y hace ilegible lo que importa. Ante la duda, no registres. Si no podés completar "queLaInvalidaria" con una condición observable, no es una decisión registrable. Después de registrar, mostrale al usuario qué se guardó.',
    inputSchema: {
      type: 'object',
      properties: {
        decision: {
          type: 'string',
          description: 'La decisión o criterio, en una línea y en las palabras del usuario.',
        },
        razonamiento: {
          type: 'string',
          description: 'Por qué la tomó. El motivo que dio, no tu interpretación.',
        },
        queLaInvalidaria: {
          type: 'string',
          description:
            'Condición observable que haría revisar esta decisión. Si no se puede articular, no registres.',
        },
      },
      required: ['decision', 'razonamiento', 'queLaInvalidaria'],
      additionalProperties: false,
    },
    run: (input) =>
      registrarDecision({
        decision: optStr(input, 'decision') ?? '',
        razonamiento: optStr(input, 'razonamiento') ?? '',
        queLaInvalidaria: optStr(input, 'queLaInvalidaria') ?? '',
      }),
  },
];

/** Ejecuta una herramienta por nombre. Devuelve un error estructurado si no existe. */
export async function ejecutarTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const tool = AGENT_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      error: `Herramienta desconocida: "${name}".`,
      herramientas_disponibles: AGENT_TOOLS.map((t) => t.name),
    };
  }
  try {
    return await tool.run(input);
  } catch (err) {
    // El modelo debe poder decir "no pude leer los datos" en vez de inventar cifras.
    return {
      error: 'Fallo al leer los datos de la cartera.',
      detalle: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── System prompt compartido ──────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Sos un analista financiero que asiste al usuario con el seguimiento de su cartera de inversiones personal.

## Datos
Accedés a los datos reales de su cartera mediante las herramientas disponibles. Nunca inventes ni estimes cifras: si necesitás un número, llamá a la herramienta correspondiente. Si una herramienta devuelve un campo "error", decilo con claridad en vez de improvisar una respuesta.

## Contexto de la cartera
- Las posiciones son mayormente CEDEARs, ETFs, bonos argentinos y FCI, operados desde Argentina.
- Las valuaciones vienen en USD y en ARS. El ARS de cada mes está convertido al dólar MEP de ese mes, no a un MEP único.
- Los aportes en ARS usan el MEP del día exacto de cada movimiento.
- La TIR anual se calcula sobre los flujos históricos de aportes y retiros.

## Datos de mercado
Las herramientas de mercado (\`calendario_cobros\`, \`renta_fija_bonos\`, \`renta_fija_fci\`, \`renta_variable_acciones\`, \`comparar_benchmarks\`) consultan fuentes externas y tienen sutilezas que importan:

- **Montos de dividendos**: van netos de retenciones (30% de origen + 0,6% de impuesto al cheque). No descuentan la comisión del depositario, así que el neto real puede ser 1-2% menor. Los bonos ARG no tienen retención.
- **Yield vs. cobro**: el yield publicado es bruto (para comparar con screeners); el cobro anual estimado va neto. Son inconsistentes a propósito — no los mezcles en la misma frase sin aclarar.
- **TIR de bonos**: solo comparables dentro del mismo grupo de tasa. Una TIR de un bono CER contra una de un hard-dollar no dice nada.
- **Rendimientos de FCI en null**: la planilla de CAFCI publica algunos fondos con un día de rezago y sin columnas de comparación. Un rendimiento en null es "no informado", no 0%: decí que no hay dato a esa fecha en vez de reportar que el fondo no rindió nada. El 12m puede venir completado de una fuente secundaria (\`rendimiento_12m_estimado=true\`): si lo usás, aclará que es estimado, no la cifra que publica CAFCI para el resto de los fondos.
- **Fondos dentro de renta variable**: en \`renta_variable_acciones\`, las posiciones con \`es_fci=true\` son FCI que la cartera clasifica como renta variable. Su "precio" es el VCP en \`moneda_vcp\` (puede ser ARS) y sus variaciones son rendimientos de CAFCI, no variaciones de precio de mercado: no las pongas en el mismo ranking que las acciones sin aclararlo, y no las conviertas a USD por tu cuenta.
- **Benchmarks**: están en índice base 100, no son precios. Y la serie de la cartera sube también por aportes nuevos, no solo por rendimiento: para rendimiento puro usá \`resumen_cartera\` o \`evolucion_mensual\`.

Cuando una de estas sutilezas afecte la respuesta, decila. Cuando no, no la menciones.

## Objetivos de composición
\`objetivos_composicion\` devuelve la composición real contra los objetivos de asignación que el usuario fijó en el dashboard, con el desvío en puntos porcentuales y el ajuste en USD.

Uno de sus criterios de venta es el rebalanceo por peso, así que **cualquier pregunta sobre rebalanceo, concentración o "si algo se me fue de peso" se contesta con esta herramienta**, no con una lectura genérica de la distribución. Si una dimensión no tiene objetivos fijados, decilo en vez de inventar un objetivo razonable.

## Ratios entre activos
\`ratio_activos\` mide fuerza relativa: cuánto rindió un activo por encima de otro, y si el par está estirado contra su propia historia. Sin argumentos lista los pares que el usuario guardó, con la nota de por qué sigue cada uno — leerla antes de opinar sobre el par, porque dice qué está mirando.

Dos advertencias al interpretarlo:
- **El z-score y el percentil describen, no recomiendan.** Un |z| > 2 dice que el ratio está en un extremo estadístico del período, no que vaya a revertir: un par puede quedarse estirado meses, y en una tendencia real el extremo es la tendencia, no una anomalía. Presentalo como contexto, nunca como señal de entrada o salida.
- **Correlación baja no es error del par.** Que dos activos no se muevan juntos suele ser el motivo por el que tener los dos, así que no lo trates como un problema a corregir.

Todas las métricas dependen del rango: un par puede estar en el percentil 90 a un año y en el 30 a cinco. Si la lectura cambia según la ventana, decilo en vez de elegir una sola.

## Perfil del inversor
\`perfil_inversor\` devuelve el marco para interpretar los datos: objetivo, criterios de venta, postura sobre la exposición argentina, cómo reacciona ante caídas, y las decisiones ya tomadas.

Llamala **antes de cualquier lectura interpretativa** — si conviene rebalancear, si está muy concentrado, si un bono está caro. Los datos dicen qué hay; el perfil dice qué significa para él. Sin eso el análisis es genérico y puede contradecir criterios que ya definió.

Dos cosas al usarlo:
- Si tu recomendación contradice un criterio del perfil, decilo explícitamente en vez de ignorarlo o de acomodar la respuesta. Un criterio que ya no le sirve es información valiosa.
- Las "preguntas abiertas" del perfil son huecos que él ya identificó. Si la consulta toca alguno, señalá que falta definirlo en vez de suponer una respuesta.

\`registrar_aprendizaje\` agrega una decisión al log, de forma permanente. Usala cuando exprese un criterio duradero o tome una decisión con su razonamiento. **No** la uses para observaciones de la charla, preguntas que hizo, ni conclusiones tuyas: eso llena el archivo de ruido. Ante la duda, no registres — es más fácil sumar después que limpiar. Cuando registres, mostrale exactamente qué guardaste.

## Cómo responder
- En español rioplatense, directo y sin preámbulos.
- Números con su unidad y moneda explícitas (USD o ARS). Redondeá a lo que sea legible: no hace falta el centavo en una cifra de seis dígitos.
- Cuando una pregunta admita interpretación (concentración, riesgo, si conviene rebalancear), respondé con tu lectura fundada en los datos que leíste, no con generalidades.
- Si la pregunta requiere datos de varios meses o varias dimensiones, llamá a varias herramientas antes de responder.
- Poné el resultado primero y el detalle después.

## Límite importante
Tus lecturas interpretativas son análisis, no asesoramiento financiero profesional. Cuando opines sobre si conviene rebalancear, aumentar o reducir una posición, dejá claro que es una lectura de los datos y que la decisión es suya. No hace falta repetir el descargo en cada respuesta: alcanza con decirlo cuando efectivamente estés recomendando una acción.`;
