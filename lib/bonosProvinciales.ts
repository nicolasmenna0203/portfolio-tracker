import type { GrupoBono } from '@/types';
import type { BondMetric } from './bondMetrics';

// Decisión y alternativas descartadas: docs/decisiones/0001-tir-duration-propias-bonos-provinciales.md
//
// ── Bonos sin cobertura en bonistas.com: TIR y duration calculadas acá ───────
//
// bonistas.com —la fuente de toda la curva de renta fija— no trackea deuda
// provincial ni los Bonos de Consolidación: su dataset (907 registros al
// 2026-08-06) solo tiene emisores "Argentina", "BCRA" y ONs corporativas. Se
// relevaron las alternativas y ninguna sirve como fuente directa:
//
//   · data912 (ya usada en precios.ts): tiene precio de esos bonos, pero ni
//     TIR ni duration.
//   · IAMC (informe diario de títulos públicos): es el único que publica TIR
//     Y duration de provinciales, pero las tablas del PDF son imágenes
//     escaneadas (231 objetos de imagen, streams de texto vacíos) → haría
//     falta OCR, demasiado frágil para un dato que se muestra como preciso.
//   · Rava: solo OHLCV histórico.
//   · Docta y argen.bond: publican TIR y paridad server-rendered, pero
//     NINGUNO expone la duration modificada sin login (la vista de curva de
//     argen.bond redirige a /users/sign_in).
//
// Por eso acá se arma el flujo de fondos de cada bono a partir de sus
// condiciones de emisión y se calculan TIR y duration modificada con las
// fórmulas estándar. Este módulo es solo el motor: QUÉ bonos se calculan y sus
// condiciones viven en la hoja BonosCalculoPropio del Sheet, no en el código,
// porque la lista dice qué hay en la cartera y el código se publica (ver
// docs/decisiones/0030-repo-privado-y-espejo-publico.md).
//
// ADVERTENCIA DE COMPARABILIDAD: estas TIRs no salen del mismo cálculo que
// las de bonistas (que asume su propia convención de settlement y proyección
// de tasas). Además en un bono de tasa variable (TAMAR, Badlar) la "TIR" no es
// un dato observable sino una proyección que supone la tasa actual constante
// hasta el vencimiento — si la tasa se mueve, el rendimiento realizado cambia.
// Por eso van marcados con `calculoPropio: true`, para que la UI pueda
// aclararlo y no se lean como equivalentes a la TIR de un soberano de bonistas.

export const RANGO_BONOS_CALCULO_PROPIO = 'BonosCalculoPropio!A:N';

/** Un pago del bono: cupón + amortización por 100 nominales, en fecha cierta. */
interface FlujoPago {
  fecha: string;   // "YYYY-MM-DD"
  cupon: number;
  amortizacion: number;
}

/** Una fila de la hoja BonosCalculoPropio, ya validada. */
export interface CondicionesBono {
  ticker: string;
  nombre: string;
  grupo: GrupoBono;
  etiqueta: string;
  moneda: string;
  vencimiento: string;
  /** Símbolo en data912 del que sale el precio limpio en ARS por 100 VN. */
  simboloPrecio: string;
  /**
   * Tasa nominal anual del cupón, en tanto por uno, proyectada constante
   * hasta el vencimiento.
   *
   * ORIGEN DEL NÚMERO: no tiene por qué ser el dato oficial del emisor —las
   * condiciones de emisión completas no suelen estar publicadas de forma
   * scrapeable— sino la tasa CALIBRADA para que la TIR que sale de este flujo
   * coincida con la que publican Docta y argen.bond en una fecha dada (la
   * columna NOTA de la hoja dice cuál). Así el cupón corriente de un bono a
   * tasa variable, que cambia en cada período y no tiene fuente pública
   * confiable, queda anclado a un tercero: sirve para ubicar el bono en la
   * curva, no como valuación independiente.
   */
  tnaCupon: number;
  /** Pagos por año (4 = trimestral, 2 = semestral). */
  pagosPorAnio: number;
  /**
   * Primera fecha de pago de cupón futura. A partir de ahí se generan las
   * fechas siguientes cada 12/pagosPorAnio meses hasta el vencimiento: los
   * cupones se pagan en TODAS esas fechas, amortice o no capital en ellas
   * (un bullet paga cupón cada trimestre y recién amortiza al final).
   */
  primerCupon: string;
  /**
   * Fechas en las que amortiza capital, con el % del nominal original. Suma
   * 100 en un bono que todavía no devolvió capital, y menos en uno que ya
   * amortizó una parte antes de `primerCupon` (esos pagos no se cargan). En
   * un bullet es una sola entrada al vencimiento.
   */
  amortizaciones: { fecha: string; porcentaje: number }[];
  /**
   * Valor técnico por 100 nominales (capital ajustado + cupón corrido) a la
   * fecha de calibración.
   *
   * Es imprescindible para los bonos con capital indexado (CER, o uno de
   * consolidación que arrastra capital ajustado): cotizan muy por encima de
   * 100 sin estar sobre la par. El flujo de fondos de acá se arma en
   * nominales, de modo que compararlo contra el precio sucio daría una TIR sin
   * sentido (dio −0,66% y −59% en los dos casos que lo motivaron). Se descuenta
   * entonces contra la PARIDAD (precio / valor técnico), que expresa el precio
   * en las mismas unidades que el flujo nominal.
   *
   * NOTA: es un dato de fecha fija, no live. El valor técnico crece con el
   * CER/la tasa devengada, así que la paridad se desactualiza lentamente y
   * la TIR pierde precisión con el correr de las semanas. Se prefiere esto
   * a no mostrar el bono, pero por eso van marcados `calculoPropio`.
   */
  valorTecnico: number;
  /**
   * TIR publicada por terceros (Docta / argen.bond) a la fecha de
   * calibración, solo como registro del control de sanidad — nunca se
   * muestra ni se usa como valor.
   */
  tirReferencia: number | null;
}

const GRUPOS_VALIDOS: GrupoBono[] = ['USD', 'CER', 'ARS_TASA', 'DOLLAR_LINKED', 'BOPREAL', 'ONS_USD'];
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Número plano de la hoja: "0.289" (cargado por API, texto RAW) o "0,289"
 * (tipeado a mano con la configuración es-AR). No acepta separador de miles:
 * ninguno de estos campos llega a mil, y "1.234" sería ambiguo.
 */
function numeroPlano(s: string | undefined): number | null {
  const t = (s ?? '').trim();
  if (!t || (t.includes('.') && t.includes(','))) return null;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** "2027-04-30:100; 2028-04-28:50" → [{fecha, porcentaje}, ...] */
function parsearAmortizaciones(s: string): { fecha: string; porcentaje: number }[] | null {
  const out: { fecha: string; porcentaje: number }[] = [];
  for (const par of s.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [fecha, pct] = par.split(':').map((x) => x.trim());
    const porcentaje = numeroPlano(pct);
    if (!FECHA_RE.test(fecha ?? '') || porcentaje == null || porcentaje <= 0) return null;
    out.push({ fecha, porcentaje });
  }
  return out.length > 0 ? out : null;
}

/**
 * Filas de la hoja BonosCalculoPropio → condiciones de cada bono. Una fila con
 * cualquier campo inválido se descarta entera con un aviso: un flujo mal
 * armado daría una TIR que la UI mostraría como precisa, y es preferible que
 * el bono no aparezca.
 */
export function parsearBonosCalculoPropio(filas: Record<string, string>[]): CondicionesBono[] {
  const out: CondicionesBono[] = [];
  for (const f of filas) {
    const ticker = (f['TICKER'] ?? '').trim().toUpperCase();
    if (!ticker) continue;
    const grupo = (f['GRUPO'] ?? '').trim().toUpperCase() as GrupoBono;
    const vencimiento = (f['VENCIMIENTO'] ?? '').trim();
    const primerCupon = (f['PRIMER_CUPON'] ?? '').trim();
    const tnaCupon = numeroPlano(f['TNA_CUPON']);
    const pagosPorAnio = numeroPlano(f['PAGOS_POR_ANIO']);
    const valorTecnico = numeroPlano(f['VALOR_TECNICO']);
    const amortizaciones = parsearAmortizaciones(f['AMORTIZACIONES'] ?? '');
    const sumaAmort = amortizaciones?.reduce((s, a) => s + a.porcentaje, 0) ?? 0;

    if (
      !GRUPOS_VALIDOS.includes(grupo) ||
      !FECHA_RE.test(vencimiento) || !FECHA_RE.test(primerCupon) ||
      tnaCupon == null || tnaCupon < 0 ||
      pagosPorAnio == null || ![1, 2, 4, 12].includes(pagosPorAnio) ||
      valorTecnico == null || valorTecnico <= 0 ||
      amortizaciones == null || sumaAmort > 100 + 1e-6
    ) {
      // console.warn va a stderr: el MCP usa stdout para JSON-RPC.
      console.warn(`BonosCalculoPropio: fila de ${ticker} inválida, se omite`);
      continue;
    }

    out.push({
      ticker,
      nombre: (f['NOMBRE'] ?? '').trim() || ticker,
      grupo,
      etiqueta: (f['ETIQUETA'] ?? '').trim(),
      moneda: (f['MONEDA'] ?? '').trim().toUpperCase() || 'ARS',
      vencimiento,
      simboloPrecio: (f['SIMBOLO_PRECIO'] ?? '').trim().toUpperCase() || ticker,
      tnaCupon,
      pagosPorAnio,
      primerCupon,
      amortizaciones,
      valorTecnico,
      tirReferencia: numeroPlano(f['TIR_REFERENCIA']),
    });
  }
  return out;
}

const DIAS_ANIO = 365;

/** Suma `meses` a una fecha "YYYY-MM-DD" conservando el día (clamp a fin de mes). */
function sumarMeses(fecha: string, meses: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const total = (m - 1) + meses;
  const anio = a + Math.floor(total / 12);
  const mes = (total % 12 + 12) % 12;
  // Día 31 en un mes de 30 cae al último día real de ese mes, como hace el
  // calendario de pagos de cualquier bono.
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${anio}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/**
 * Arma el flujo futuro por 100 nominales. El cupón se paga en TODAS las
 * fechas del calendario (generado desde `primerCupon` cada 12/pagosPorAnio
 * meses hasta el vencimiento) devengado sobre el saldo residual vigente; la
 * amortización se suma solo en las fechas donde efectivamente amortiza.
 *
 * Separar ambos calendarios es lo que distingue un bullet —que paga cupón
 * cada trimestre y devuelve el capital recién al final— de uno con
 * amortización escalonada.
 *
 * Solo se devuelven los pagos posteriores a `hoy`: los ya cobrados no entran
 * en la TIR de quien compra hoy. El saldo residual, en cambio, se descuenta
 * desde el principio para que el cupón de los períodos futuros se calcule
 * sobre el capital que realmente queda vivo.
 */
function construirFlujo(c: CondicionesBono, hoy: Date): FlujoPago[] {
  const cuponPorPeriodo = c.tnaCupon / c.pagosPorAnio;
  const pasoMeses = 12 / c.pagosPorAnio;
  const amortPorFecha = new Map(c.amortizaciones.map((a) => [a.fecha, a.porcentaje]));

  // El calendario se genera hacia adelante desde el primer cupón, pero la
  // última fecha se fuerza al vencimiento: en varios bonos el día del ciclo
  // no coincide con el del vencimiento (ej. paga los 30 y vence el 28), y
  // sin este ajuste el pago final —el que trae el 100% del capital— quedaría
  // fuera del flujo y la TIR se calcularía solo sobre los cupones.
  const fechas: string[] = [];
  for (let f = c.primerCupon; f < c.vencimiento; f = sumarMeses(f, pasoMeses)) {
    fechas.push(f);
  }
  fechas.push(c.vencimiento);

  const flujo: FlujoPago[] = [];
  let saldo = 100;

  for (const fecha of fechas) {
    const cupon = saldo * cuponPorPeriodo;
    const amortizacion = amortPorFecha.get(fecha) ?? 0;
    if (new Date(fecha + 'T00:00:00Z') > hoy) {
      flujo.push({ fecha, cupon, amortizacion });
    }
    saldo -= amortizacion;
  }
  return flujo;
}

/** Valor presente del flujo a una tasa efectiva anual dada. */
function valorPresente(flujo: FlujoPago[], tasa: number, hoy: Date): number {
  let vp = 0;
  for (const p of flujo) {
    const años = (new Date(p.fecha + 'T00:00:00Z').getTime() - hoy.getTime()) / (DIAS_ANIO * 86400000);
    if (años <= 0) continue;
    vp += (p.cupon + p.amortizacion) / Math.pow(1 + tasa, años);
  }
  return vp;
}

/**
 * TIR efectiva anual por bisección sobre el precio limpio. Se usa bisección y
 * no Newton-Raphson porque el flujo es siempre positivo (la función de VP es
 * monótona decreciente en la tasa), así que la bisección converge siempre y
 * no depende de una semilla ni puede divergir.
 */
function calcularTir(flujo: FlujoPago[], precio: number, hoy: Date): number | null {
  if (flujo.length === 0 || precio <= 0) return null;

  let lo = -0.99;
  let hi = 100; // 10.000% anual: techo holgado para tasas en pesos
  if (valorPresente(flujo, hi, hoy) > precio) return null; // ni al techo cierra

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (valorPresente(flujo, mid, hoy) > precio) lo = mid;
    else hi = mid;
  }
  const tir = (lo + hi) / 2;
  return Number.isFinite(tir) ? tir : null;
}

/**
 * Duration de Macaulay (años, ponderada por VP de cada pago) convertida a
 * duration modificada = Macaulay / (1 + TIR). Es la misma métrica que expone
 * bonistas.com como `modified_duration`, así que los puntos quedan sobre el
 * mismo eje X que el resto de la curva.
 */
function calcularDurationModificada(flujo: FlujoPago[], tir: number, hoy: Date): number | null {
  let vpTotal = 0;
  let sumaPonderada = 0;

  for (const p of flujo) {
    const años = (new Date(p.fecha + 'T00:00:00Z').getTime() - hoy.getTime()) / (DIAS_ANIO * 86400000);
    if (años <= 0) continue;
    const vp = (p.cupon + p.amortizacion) / Math.pow(1 + tir, años);
    vpTotal += vp;
    sumaPonderada += vp * años;
  }
  if (vpTotal <= 0) return null;

  const macaulay = sumaPonderada / vpTotal;
  return macaulay / (1 + tir);
}

/**
 * Métricas de los bonos que bonistas.com no cubre (provinciales y Bonos de
 * Consolidación), calculadas desde el flujo de fondos y el precio limpio de
 * data912. Devuelve solo los bonos con precio disponible: sin precio no hay
 * TIR posible, y es preferible omitir el punto antes que inventarlo.
 *
 * `precios` es el mapa símbolo→precio ARS por 100 VN que ya arma precios.ts
 * (data912 `/live/arg_bonds`), para no repetir el request.
 */
export function calcularMetricasProvinciales(
  condiciones: CondicionesBono[],
  precios: Record<string, number>,
  ahora: Date = new Date(),
): BondMetric[] {
  const out: BondMetric[] = [];

  for (const c of condiciones) {
    const precio = precios[c.simboloPrecio];
    if (precio == null || precio <= 0) continue;

    // El flujo está en nominales (base 100), así que el precio hay que
    // llevarlo a esa misma base: paridad × 100. En un bono sin capital
    // ajustado (VT ≈ 100) esto es casi el precio; en uno que arrastra
    // indexación, es la única forma de que la TIR tenga sentido.
    const paridad = precio / c.valorTecnico;
    const flujo = construirFlujo(c, ahora);
    const tir = calcularTir(flujo, paridad * 100, ahora);
    if (tir == null) continue;

    const duration = calcularDurationModificada(flujo, tir, ahora);
    if (duration == null || duration <= 0) continue;

    const diasAlVencimiento = Math.round(
      (new Date(c.vencimiento + 'T00:00:00Z').getTime() - ahora.getTime()) / 86400000,
    );

    out.push({
      ticker: c.ticker,
      tickerCartera: c.ticker,
      bondFamily: c.nombre,
      // No hay un campo de emisor separado del nombre acá (a diferencia de
      // bonistas): `nombre` ya lo incluye, así que no hace falta duplicarlo.
      emisor: null,
      moneda: c.moneda,
      grupo: c.grupo,
      etiqueta: c.etiqueta,
      tir,
      // TNA equivalente a la TIR efectiva, con la capitalización del bono.
      tna: (Math.pow(1 + tir, 1 / c.pagosPorAnio) - 1) * c.pagosPorAnio,
      modifiedDuration: duration,
      // Paridad = precio / valor técnico, la misma definición que usa
      // bonistas para el resto de la curva. El VT es de fecha fija (ver
      // `valorTecnico`), así que se va desactualizando de a poco.
      parity: paridad,
      fairValue: null,
      lastPrice: precio,
      vencimiento: c.vencimiento,
      diasAlVencimiento,
      calculoPropio: true,
    });
  }

  return out;
}
