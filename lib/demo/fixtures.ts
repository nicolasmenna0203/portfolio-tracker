// Fixtures sintéticas para el resto de los endpoints /api/demo/*: benchmarks,
// calendario, fci, fx, ingresos, noticias, objetivos, performance,
// performance-variable, ratios-guardados. Todas usan el mismo universo de
// `lib/demo/universo.ts` para ser coherentes con Tenencias/Performance.
//
// Fechas relativas a `Date.now()` (nunca hardcodeadas) para que no queden
// vencidas con el paso del tiempo.

import type {
  BenchmarkId,
  BenchmarkSeries,
  CalendarioResponse,
  EventoCalendario,
  YieldTicker,
  FciResponse,
  FciPerformance,
  IngresosResponse,
  IngresoRow,
  IngresosPorMes,
  NoticiaItem,
  PerformanceResponse,
  BondPerformance,
  GrupoPonderado,
  GrupoBono,
  StockPerformance,
  PerformanceVariableResponse,
  SensibilidadTir,
  GastosFijosResponse,
} from '@/types';
import type { ObjetivosPorDimension } from '@/lib/objetivos';
import type { RatioGuardado } from '@/lib/ratiosGuardados';
import { rngFromString } from './rng';
import {
  ACTIVOS_VARIABLE,
  UNIVERSO_BONOS,
  UNIVERSO_FCI,
  EMPLEADORES_DEMO,
} from './universo';

const DIA_MS = 24 * 3600 * 1000;

// ── Gastos (catálogo mensual, no serie temporal) ─────────────────────────────

export function buildGastosFijos(): GastosFijosResponse {
  return {
    gastos: [
      { nombre: 'Streaming video', monto: 4500, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Suscripciones' },
      { nombre: 'Streaming música', monto: 2900, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Suscripciones' },
      { nombre: 'Nube / almacenamiento', monto: 3, moneda: 'USD', frecuencia: 'mensual', categoria: 'Suscripciones' },
      { nombre: 'Seguro auto', monto: 45000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Seguros' },
      { nombre: 'Seguro hogar', monto: 180, moneda: 'USD', frecuencia: 'anual', categoria: 'Seguros' },
      { nombre: 'Gimnasio', monto: 15000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Otros' },
      { nombre: 'Supermercado', monto: 380000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Comida' },
      { nombre: 'Salidas y delivery', monto: 140000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Comida' },
      { nombre: 'Transporte', monto: 70000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Transporte' },
      { nombre: 'Luz, gas e internet', monto: 95000, moneda: 'ARS', frecuencia: 'mensual', categoria: 'Servicios' },
    ],
    generatedAt: Date.now(),
  };
}

// ── Benchmarks (índice base 100) ─────────────────────────────────────────────

const BENCHMARK_DEFS: { id: BenchmarkId; label: string; driftMensual: number; volMensual: number }[] = [
  { id: 'sp500',     label: 'S&P 500',              driftMensual: 0.010, volMensual: 0.035 },
  { id: 'inflacion', label: 'Inflación (CER)',      driftMensual: 0.022, volMensual: 0.006 },
  { id: 'mep',       label: 'Dólar MEP',            driftMensual: 0.028, volMensual: 0.02 },
  { id: 'btc',       label: 'Bitcoin',              driftMensual: 0.02,  volMensual: 0.13 },
  { id: 'oro',       label: 'Oro',                  driftMensual: 0.009, volMensual: 0.03 },
];

export function buildBenchmarks(mesesCartera: string[]): BenchmarkSeries[] {
  const meses = mesesCartera.length > 0 ? mesesCartera : mesesRelativos(13);
  return BENCHMARK_DEFS.map((def) => {
    const rng = rngFromString(`bench:${def.id}`);
    let valor = 100;
    const puntos = meses.map((mesKey, i) => {
      const [y, m] = mesKey.split('-').map(Number);
      const fechaTs = Date.UTC(y, m - 1, 1);
      // El primer punto queda en 100 (base); a partir del segundo, aplicamos drift+ruido.
      if (i > 0) {
        const retorno = def.driftMensual + (rng() - 0.5) * 2 * def.volMensual;
        valor = valor * (1 + retorno);
      }
      return {
        mesKey,
        fecha: formatMesLabelLocal(fechaTs),
        valor: Math.round(valor * 100) / 100,
      };
    });
    return { id: def.id, label: def.label, puntos };
  });
}

function formatMesLabelLocal(ts: number): string {
  const d = new Date(ts);
  const mes = d.toLocaleString('es-AR', { month: 'short', timeZone: 'UTC' });
  const anio = String(d.getUTCFullYear()).slice(2);
  return `${mes}-${anio}`;
}

function mesesRelativos(cantidad: number): string[] {
  const hoy = new Date();
  const out: string[] = [];
  for (let i = cantidad - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

// ── FX (MEP histórico absoluto) ──────────────────────────────────────────────

export function buildFx(desdeMesKey: string): { mesKey: string; valorArs: number }[] {
  const [yDesde, mDesde] = desdeMesKey.split('-').map(Number);
  const desdeTs = Date.UTC(yDesde, mDesde - 1, 1);
  const hoy = new Date();
  const hastaTs = Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1);

  const meses: string[] = [];
  let cursor = desdeTs;
  while (cursor <= hastaTs) {
    const d = new Date(cursor);
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    cursor = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  if (meses.length === 0) meses.push(desdeMesKey);

  const rng = rngFromString(`fx:${desdeMesKey}`);
  return meses.map((mesKey, i) => {
    const progreso = meses.length > 1 ? i / (meses.length - 1) : 1;
    const base = 1050 + progreso * 400;
    const ruido = (rng() - 0.5) * 40;
    return { mesKey, valorArs: Math.round(base + ruido) };
  });
}

// ── Calendario financiero: eventos + yields ─────────────────────────────────

export function buildCalendario(): CalendarioResponse {
  const hoy = Date.now();
  const eventos: EventoCalendario[] = [
    // Earnings próximos (Yahoo)
    { ticker: 'AAPL', tipo: 'earnings', fecha: fechaISO(hoy + 6 * DIA_MS), detalle: 'EPS est. 1.62' },
    { ticker: 'MSFT', tipo: 'earnings', fecha: fechaISO(hoy + 14 * DIA_MS), detalle: 'EPS est. 3.10' },
    { ticker: 'GOOGL', tipo: 'earnings', fecha: fechaISO(hoy + 21 * DIA_MS), detalle: 'EPS est. 2.05' },
    // Dividendos futuros confirmados (Nasdaq)
    { ticker: 'KO', tipo: 'dividendo-fut', fecha: fechaISO(hoy + 10 * DIA_MS), detalle: '0.51 USD/acción', montoEstimado: 14.6, monedaMonto: 'USD' },
    { ticker: 'AAPL', tipo: 'dividendo-fut', fecha: fechaISO(hoy + 25 * DIA_MS), detalle: '0.26 USD/acción', montoEstimado: 4.8, monedaMonto: 'USD' },
    // Dividendos ya pagados (histórico Yahoo, últimos ~30 días)
    { ticker: 'MSFT', tipo: 'dividendo', fecha: fechaISO(hoy - 12 * DIA_MS), detalle: '0.83 USD/acción' },
    { ticker: 'SPY',  tipo: 'dividendo', fecha: fechaISO(hoy - 20 * DIA_MS), detalle: '1.75 USD/acción' },
    // Renta (cupón) y amortización de bonos ARG (bonistas)
    { ticker: 'AL30', tipo: 'renta', fecha: fechaISO(hoy + 4 * DIA_MS), detalle: 'Cupón semestral', montoEstimado: 84, monedaMonto: 'USD' },
    { ticker: 'GD35', tipo: 'renta', fecha: fechaISO(hoy + 18 * DIA_MS), detalle: 'Cupón semestral', montoEstimado: 66.5, monedaMonto: 'USD' },
    { ticker: 'TX26', tipo: 'amortizacion', fecha: fechaISO(hoy + 29 * DIA_MS), detalle: 'Amortización parcial', montoEstimado: 90, monedaMonto: 'ARS' },
  ];

  const yields: YieldTicker[] = [
    { ticker: 'AAPL', yieldAnual: 0.0044, pagos: 4, cobroAnual: 13.3 },
    { ticker: 'MSFT', yieldAnual: 0.0072, pagos: 4, cobroAnual: 24.8 },
    { ticker: 'KO',   yieldAnual: 0.0307, pagos: 4, cobroAnual: 38.3 },
    { ticker: 'SPY',  yieldAnual: 0.0119, pagos: 4, cobroAnual: 43.6 },
  ];

  return { eventos, yields, errores: [], generatedAt: hoy };
}

function fechaISO(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

// ── Noticias ──────────────────────────────────────────────────────────────

export function buildNoticias(): { noticias: NoticiaItem[]; errores: string[] } {
  const hoy = Date.now();
  const noticias: NoticiaItem[] = [
    { titulo: 'Apple presenta resultados trimestrales por encima de lo esperado', link: '#', fuente: 'Yahoo Finance', fecha: hoy - 1 * DIA_MS, ticker: 'AAPL' },
    { titulo: 'Microsoft anuncia expansión de su segmento de nube', link: '#', fuente: 'Yahoo Finance', fecha: hoy - 2 * DIA_MS, ticker: 'MSFT' },
    { titulo: 'El S&P 500 marca nuevo máximo histórico impulsado por tecnológicas', link: '#', fuente: 'Yahoo Finance', fecha: hoy - 2 * DIA_MS, ticker: 'SPY' },
    { titulo: 'El Gobierno licitó deuda en pesos y logró refinanciar la totalidad de vencimientos', link: '#', fuente: 'Ámbito', fecha: hoy - 3 * DIA_MS },
    { titulo: 'El dólar MEP cerró la semana con leve suba', link: '#', fuente: 'Ámbito', fecha: hoy - 4 * DIA_MS },
    { titulo: 'Coca-Cola eleva su proyección de ventas para el año', link: '#', fuente: 'Yahoo Finance', fecha: hoy - 5 * DIA_MS, ticker: 'KO' },
    { titulo: 'Bonos soberanos argentinos operan con subas tras señales fiscales', link: '#', fuente: 'Ámbito', fecha: hoy - 6 * DIA_MS },
    { titulo: 'Alphabet invierte en infraestructura de inteligencia artificial', link: '#', fuente: 'Yahoo Finance', fecha: hoy - 7 * DIA_MS, ticker: 'GOOGL' },
  ];
  return { noticias, errores: [] };
}

// ── FCI ──────────────────────────────────────────────────────────────────

export function buildFci(tenencias: Record<string, number>): FciResponse {
  const hoy = Date.now();
  const fondos: FciPerformance[] = UNIVERSO_FCI.map((f) => {
    const rng = rngFromString(`fci:${f.ticker}`);
    const rendimientoMes = 0.01 + rng() * 0.02;
    const rendimientoAnio = rendimientoMes * 10 + rng() * 0.05;
    const tenenciaUsd = tenencias[f.ticker] ?? f.tenenciaUsd;
    return {
      ticker: f.ticker,
      nombreFondo: f.nombreFondo,
      moneda: f.moneda,
      horizonte: f.horizonte,
      vcp: Math.round(f.vcpBase * 100) / 100,
      variacionDiaria: Math.round((rendimientoMes / 20) * 10000) / 10000,
      rendimientoMes: Math.round(rendimientoMes * 10000) / 10000,
      rendimientoAnio: Math.round(rendimientoAnio * 10000) / 10000,
      rendimiento12Meses: Math.round((rendimientoAnio * 1.05) * 10000) / 10000,
      patrimonio: Math.round((50_000_000 + rng() * 200_000_000) * 100) / 100,
      fecha: fechaISO(hoy),
      rezagado: false, // la demo publica todos los fondos al mismo día
      rendimiento12MesesEstimado: false,
      ...(tenenciaUsd != null ? { tenenciaUsd } : {}),
    };
  });
  return { fondos, generatedAt: hoy };
}

// ── Ingresos ─────────────────────────────────────────────────────────────

export function buildIngresos(): IngresosResponse {
  const hoy = new Date();
  const MESES_INGRESOS = 8;
  const ingresos: IngresoRow[] = [];
  const porMes: IngresosPorMes[] = [];

  for (let i = MESES_INGRESOS - 1; i >= 0; i--) {
    const fechaMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - i, 5));
    const mesKey = `${fechaMes.getUTCFullYear()}-${String(fechaMes.getUTCMonth() + 1).padStart(2, '0')}`;
    const rng = rngFromString(`ingreso:${mesKey}`);
    const rows: IngresoRow[] = [];

    const montoArs1 = Math.round((1_800_000 + rng() * 300_000) / 1000) * 1000;
    const mep = 1050 + ((MESES_INGRESOS - 1 - i) / (MESES_INGRESOS - 1)) * 300;
    rows.push({
      fecha: fechaMes.getTime(),
      fechaStr: `${String(fechaMes.getUTCDate()).padStart(2, '0')}/${String(fechaMes.getUTCMonth() + 1).padStart(2, '0')}/${fechaMes.getUTCFullYear()}`,
      empleador: EMPLEADORES_DEMO[0],
      montoArs: montoArs1,
      montoUsd: Math.round((montoArs1 / mep) * 100) / 100,
    });

    // Cada 3 meses, un segundo ingreso de la otra "empresa" ficticia.
    if (i % 3 === 0) {
      const montoArs2 = Math.round((450_000 + rng() * 150_000) / 1000) * 1000;
      rows.push({
        fecha: fechaMes.getTime() + 10 * DIA_MS,
        fechaStr: `${String(fechaMes.getUTCDate() + 10).padStart(2, '0')}/${String(fechaMes.getUTCMonth() + 1).padStart(2, '0')}/${fechaMes.getUTCFullYear()}`,
        empleador: EMPLEADORES_DEMO[1],
        montoArs: montoArs2,
        montoUsd: Math.round((montoArs2 / mep) * 100) / 100,
      });
    }

    ingresos.push(...rows);
    const totalArs = rows.reduce((s, r) => s + r.montoArs, 0);
    const totalUsd = rows.reduce((s, r) => s + r.montoUsd, 0);
    porMes.push({
      mesKey,
      fecha: formatMesLabelLocal(fechaMes.getTime()),
      totalArs,
      totalUsd,
      rows,
    });
  }

  return { ingresos, porMes, empleadores: EMPLEADORES_DEMO, generatedAt: Date.now() };
}

// ── Objetivos de composición ─────────────────────────────────────────────

export function buildObjetivos(): ObjetivosPorDimension {
  return {
    TIPO: { ACCIONES: 30, ETF: 30, ARGY: 25, FCI: 15 },
    RIESGO: { CONSERVADOR: 20, MODERADO: 35, 'MODERADO-ALTO': 30, AGRESIVO: 15 },
    MONEDA: { USD: 70, CER: 15, ARS: 15 },
    RENTA: { VARIABLE: 60, FIJA: 40 },
    SECTOR_GEO: { EU: 45, ARG: 30, EMER: 15, GLO: 10 },
  };
}

// ── Ratios guardados ─────────────────────────────────────────────────────

export function buildRatiosGuardados(): RatioGuardado[] {
  const hoy = new Date().toISOString().slice(0, 10);
  return [
    { activoA: 'AAPL', activoB: 'SPY', rango: '1a', nota: 'Fuerza relativa de Apple contra el mercado', sma1: 20, sma2: 50, bollinger: true, creado: hoy },
    { activoA: 'AL30', activoB: 'GD35', rango: '6m', nota: 'Comparación de paridad entre legislación local y NY', sma1: 20, sma2: 0, bollinger: false, creado: hoy },
    { activoA: 'QQQ', activoB: 'SPY', rango: '1a', nota: 'Nasdaq vs. mercado amplio', sma1: 50, sma2: 200, bollinger: true, creado: hoy },
  ];
}

// ── Performance (renta fija: bonos) ─────────────────────────────────────

function calcularSensibilidad(tir: number, duration: number): SensibilidadTir[] {
  return [1, 2, 3, 5, 10].map((shock) => ({
    shock,
    tirDown: tir + shock / 100 / duration,
    tirUp: tir - shock / 100 / duration,
  }));
}

export function buildPerformance(tenencias: Record<string, number>): PerformanceResponse {
  const hoy = Date.now();
  const bonos: BondPerformance[] = UNIVERSO_BONOS.map((b) => {
    const rng = rngFromString(`bono:${b.ticker}`);
    const tir = b.tirBase + (rng() - 0.5) * 0.006;
    const duration = b.durationBase;
    const diasAlVencimiento = Math.max(1, Math.round((new Date(b.vencimiento).getTime() - hoy) / DIA_MS));
    const tenenciaUsd = tenencias[b.ticker] ?? b.tenenciaUsd;
    const esCalculoPropio = b.grupo === 'CER' && b.ticker.startsWith('TX'); // ejemplo de bono provincial-like calculado propio
    return {
      ticker: b.ticker,
      tickerCartera: b.tickerCartera,
      bondFamily: b.bondFamily,
      emisor: b.emisor,
      moneda: b.moneda,
      grupo: b.grupo,
      etiqueta: null,
      tir: Math.round(tir * 10000) / 10000,
      tna: Math.round(b.tnaBase * 10000) / 10000,
      modifiedDuration: Math.round(duration * 100) / 100,
      parity: b.grupo === 'USD' || b.grupo === 'ONS_USD' ? Math.round((70 + rng() * 20) * 100) / 100 : null,
      fairValue: null,
      lastPrice: Math.round((100 - duration * 3 + rng() * 5) * 100) / 100,
      vencimiento: b.vencimiento,
      diasAlVencimiento,
      sensibilidad: calcularSensibilidad(tir, duration),
      ...(esCalculoPropio ? { calculoPropio: true } : {}),
      ...(tenenciaUsd != null ? { tenenciaUsd } : {}),
    };
  });

  // carteraPorGrupo: ponderado por tenencia dentro de cada grupo con posiciones.
  const gruposConTenencia = new Map<GrupoBono, { tirPeso: number; durPeso: number; total: number }>();
  for (const b of bonos) {
    if (!b.tenenciaUsd) continue;
    const actual = gruposConTenencia.get(b.grupo) ?? { tirPeso: 0, durPeso: 0, total: 0 };
    actual.tirPeso += b.tir * b.tenenciaUsd;
    actual.durPeso += b.modifiedDuration * b.tenenciaUsd;
    actual.total += b.tenenciaUsd;
    gruposConTenencia.set(b.grupo, actual);
  }
  const carteraPorGrupo: GrupoPonderado[] = Array.from(gruposConTenencia.entries()).map(([grupo, v]) => ({
    grupo,
    tirPonderada: Math.round((v.tirPeso / v.total) * 10000) / 10000,
    durationPonderada: Math.round((v.durPeso / v.total) * 100) / 100,
    tenenciaTotalUsd: Math.round(v.total * 100) / 100,
  }));

  return { bonos, carteraPorGrupo, generatedAt: hoy };
}

// ── Performance (renta variable: acciones/CEDEARs) ────────────────────────

export function buildPerformanceVariable(tickersUsa: string[], tenencias: Record<string, number>): PerformanceVariableResponse {
  const hoy = Date.now();
  const universo = ACTIVOS_VARIABLE.filter((a) => tickersUsa.length === 0 || tickersUsa.includes(a.TICKER));
  const base = universo.length > 0 ? universo : ACTIVOS_VARIABLE;

  const acciones: StockPerformance[] = base.map((a) => {
    const rng = rngFromString(`stock:${a.TICKER}`);
    const px = a.precioBase * (0.97 + rng() * 0.06);
    const tenenciaUsd = tenencias[a.TICKER];
    return {
      ticker: a.TICKER,
      nombre: NOMBRES_STOCK[a.TICKER] ?? a.TICKER,
      px: Math.round(px * 100) / 100,
      variacion1d: Math.round((rng() - 0.5) * 0.04 * 10000) / 10000,
      variacion1m: Math.round((rng() - 0.4) * 0.12 * 10000) / 10000,
      variacionYtd: Math.round((rng() - 0.3) * 0.3 * 10000) / 10000,
      variacion1a: Math.round((rng() - 0.3) * 0.45 * 10000) / 10000,
      peRatio: Math.round((15 + rng() * 25) * 100) / 100,
      marketCap: Math.round((50_000_000_000 + rng() * 2_500_000_000_000)),
      fiftyTwoWeekLow: Math.round(px * 0.78 * 100) / 100,
      fiftyTwoWeekHigh: Math.round(px * 1.22 * 100) / 100,
      dividendYield: a.TICKER === 'KO' ? 0.0307 : a.TICKER === 'AAPL' ? 0.0044 : a.TICKER === 'MSFT' ? 0.0072 : null,
      ...(tenenciaUsd != null ? { tenenciaUsd } : {}),
    };
  });

  return { acciones, generatedAt: hoy };
}

const NOMBRES_STOCK: Record<string, string> = {
  AAPL: 'Apple Inc.',
  MSFT: 'Microsoft Corp.',
  KO: 'The Coca-Cola Co.',
  GOOGL: 'Alphabet Inc.',
  SPY: 'SPDR S&P 500 ETF',
  QQQ: 'Invesco QQQ Trust',
  EEM: 'iShares MSCI Emerging Markets ETF',
};
