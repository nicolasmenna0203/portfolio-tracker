export interface ResumenRow {
  fecha: string;       // "Mar-2024"
  fechaTs: number;     // timestamp ms
  aportes: number;
  /** Suma de monto_ars de cada movimiento del mes (cada uno al MEP de su propio día), no aportes * MEP de cierre de mes. */
  aportes_ars: number;
  acumulado: number;
  /** Suma de monto_neto_ars de todos los movimientos hasta el fin de este mes (cada uno al MEP de su día). */
  acumulado_ars: number;
  total_cartera: number;
  total_cartera_ars: number;
  rendimiento: number;
}

export interface MovimientoRow {
  fecha: number;       // timestamp ms
  monto_usd: number;
  /** Monto en ARS al MEP del día exacto del movimiento (columna Monto (ARS) del Sheet). */
  monto_ars: number;
  tipo: 'ingreso' | 'salida';
  monto_neto: number;  // positivo = ingreso, negativo = salida
  /** monto_neto convertido a ARS con el MEP del día exacto (signo según ingreso/salida). */
  monto_neto_ars: number;
}

export interface ActivoRow {
  TICKER: string;
  BROKER: string;
  TIPO: string;
  RIESGO: number;
  SECTOR_GEO: string;
  RENTA: string;
  MONEDA: string;
}

export interface TenenciaRow {
  ticker: string;
  tenencia_ars: number;
  tenencia_usd: number;
  fechaTs: number;  // timestamp ms
  fechaMes: string; // "YYYY-MM"
}

export interface TenenciaActual extends TenenciaRow {
  TIPO: string;
  RIESGO: number;
  SECTOR_GEO: string;
  RENTA: string;
  MONEDA: string;
}

export interface KPIData {
  totalCartera: number;
  totalCarteraArs: number;
  aporteAcumulados: number;
  rendimientoNeto: number;
  rendimientoPct: number;
  deltaCartera: number;
  tirAnual: number | null;
  fechaStr: string;
}

export interface DashboardData {
  kpis: KPIData;
  resumenSeries: ResumenRow[];
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  mesesDisponibles: string[];              // ["Mar-2024", ...] ordered
  totalPorMes: Record<string, number>;     // "YYYY-MM" → total_cartera (USD)
  totalPorMesArs: Record<string, number>;  // "YYYY-MM" → total_cartera_ars
  movimientos: MovimientoRow[];            // aportes/retiros, orden cronológico
}

// ── Benchmarks ────────────────────────────────────────────────────────────────

export type BenchmarkId = 'sp500' | 'inflacion' | 'mep' | 'btc' | 'oro';

export interface BenchmarkPoint {
  mesKey: string;   // "YYYY-MM"
  fecha: string;    // "Mar-2025"
  valor: number;    // índice base 100
}

export interface BenchmarkSeries {
  id: BenchmarkId;
  label: string;
  puntos: BenchmarkPoint[];
  error?: string;   // presente si esta fuente puntual falló
}

export interface BenchmarksResponse {
  baseMesKey: string;
  series: BenchmarkSeries[];
  generatedAt: number;
}

// ── FX (dólar MEP absoluto) ─────────────────────────────────────────────────

export interface FxResponse {
  puntos: { mesKey: string; valorArs: number }[];
  generatedAt: number;
  error?: string;
}

// ── Calendario: Noticias ─────────────────────────────────────────────────────

export interface NoticiaItem {
  titulo: string;
  link: string;
  fuente: string;      // "Yahoo Finance" | "Ámbito"
  fecha: number;        // timestamp ms
  ticker?: string;       // ausente en noticias generales (Ámbito)
}

export interface NoticiasResponse {
  noticias: NoticiaItem[];
  errores: string[];
  generatedAt: number;
}

// ── Calendario: Eventos (earnings/dividendos) ────────────────────────────────

export type EventoTipo =
  | 'dividendo'        // dividendo ya pagado (histórico Yahoo)
  | 'dividendo-fut'    // dividendo futuro confirmado (Nasdaq)
  | 'earnings'         // balance / reporte de resultados (Yahoo)
  | 'renta'            // cupón de interés de bono/ON ARG (bonistas)
  | 'amortizacion';    // devolución de capital de bono/ON ARG (bonistas)

export interface EventoCalendario {
  ticker: string;
  tipo: EventoTipo;
  fecha: string;        // "YYYY-MM-DD"
  detalle?: string;      // ej. "EPS est. 1.52" o "0.24 USD/acción"
  montoEstimado?: number; // cobro estimado según tenencia actual (USD)
  monedaMonto?: string;   // moneda del montoEstimado (ej. "USD", "ARS")
}

/** Dividend yield trailing 12 meses de una posición, para mostrar como dato. */
export interface YieldTicker {
  ticker: string;
  /** Yield bruto que publica el emisor, sin retenciones (0.0701 = 7.01%).
   *  Deliberadamente inconsistente con `cobroAnual`, que sí va neto: el yield
   *  se muestra como en cualquier screener para poder compararlo. */
  yieldAnual: number;
  pagos: number;        // cantidad de pagos en 12m
  cobroAnual?: number;  // neto estimado a cobrar al año según tenencia (USD)
}

export interface CalendarioResponse {
  eventos: EventoCalendario[];
  yields: YieldTicker[];
  errores: string[];
  generatedAt: number;
}

// ── Performance (renta fija): TIR, duration, paridad ─────────────────────────

export interface SensibilidadTir {
  shock: number;    // % de shock de precio (1, 2, 3, 5, 10)
  tirDown: number;   // TIR aproximada si el precio cae `shock`%: TIR + shock%/duration
  tirUp: number;      // TIR aproximada si el precio sube `shock`%: TIR - shock%/duration
}

/** Agrupamiento por tipo de tasa — TIRs de distinto grupo no son comparables entre sí. */
export type GrupoBono = 'USD' | 'CER' | 'ARS_TASA' | 'DOLLAR_LINKED' | 'BOPREAL' | 'ONS_USD';

export interface BondPerformance {
  ticker: string;
  /** Ticker cartera (ej. "AL30") si este bono está en MAPEO_BONOS_ARG; null si es del universo ampliado. */
  tickerCartera: string | null;
  bondFamily: string;
  /** Emisor tal cual lo publica bonistas (ej. "YPF S.A.", "Pampa Energía"); null en provinciales/consolidación, donde ya va en bondFamily. */
  emisor: string | null;
  moneda: string;              // moneda en la que se calculó la TIR (USD o ARS)
  grupo: GrupoBono;             // USD hard-dollar / CER (ajustado inflación, incluye duales CER/TAMAR) / ARS tasa / dollar-linked
  /** Aclaración sobre el grupo (ej. "CER/TAMAR" en duales) cuando el grupo solo no alcanza para describir el instrumento. */
  etiqueta: string | null;
  tir: number;                  // TIR efectiva anual, en tanto por uno
  tna: number;                  // tasa nominal anual, en tanto por uno
  modifiedDuration: number;     // años
  parity: number | null;
  fairValue: number | null;
  lastPrice: number | null;
  vencimiento: string;      // "YYYY-MM-DD"
  diasAlVencimiento: number;
  sensibilidad: SensibilidadTir[];
  /**
   * true si TIR y duration las calculó el dashboard desde el flujo de fondos
   * (bonos provinciales y de consolidación, que bonistas.com no cubre) en vez
   * de tomarlas de bonistas. Distinta convención de cálculo y, en los de tasa
   * variable, proyección de la tasa actual a futuro: la UI lo aclara para que
   * no se lean como equivalentes al resto de la curva.
   */
  calculoPropio?: boolean;
  /** Presente solo si el ticker está en la cartera actual. */
  tenenciaUsd?: number;
}

/** TIR y duration ponderadas por tenencia, calculadas solo dentro del mismo grupo. */
export interface GrupoPonderado {
  grupo: GrupoBono;
  tirPonderada: number;
  durationPonderada: number;
  tenenciaTotalUsd: number;
}

export interface PerformanceResponse {
  bonos: BondPerformance[];
  /** Una entrada por grupo con posiciones en cartera; ausente si no hay tenencia en ese grupo. */
  carteraPorGrupo: GrupoPonderado[];
  generatedAt: number;
}

// ── FCI del broker (VCP, rendimientos), vía planilla diaria de CAFCI ───

export interface FciPerformance {
  ticker: string;
  nombreFondo: string;
  moneda: string;
  horizonte: string;
  vcp: number;
  /**
   * `null` cuando la planilla de CAFCI no publica la columna para esa fila
   * (fondos con un día de rezago vienen sin ninguna comparación). Se muestra
   * "s/d", nunca 0,0%.
   */
  variacionDiaria: number | null;
  rendimientoMes: number | null;
  rendimientoAnio: number | null;
  rendimiento12Meses: number | null;
  patrimonio: number;
  fecha: string;
  /** La fila viene con fecha anterior a la última publicada en la planilla. */
  rezagado: boolean;
  /** Presente solo si el ticker está en la cartera actual. */
  tenenciaUsd?: number;
}

export interface FciResponse {
  fondos: FciPerformance[];
  generatedAt: number;
}

// ── Carry trade (LECAP/Boncap/duales/Tamar/Badlar en pesos vs. dólar MEP) ────

export interface CarryTradeItem {
  ticker: string;
  bondFamily: string;
  precio: number | null;      // último precio conocido, en ARS
  tir: number;               // TIR efectiva anual en pesos, tanto por uno
  tna: number;
  vencimiento: string;        // "YYYY-MM-DD"
  diasAlVencimiento: number;
  /** Precio proyectado al vencimiento: precio * (1+retornoDirectoArs). null si no hay precio. */
  prFinish: number | null;
  /** Retorno directo en pesos si se mantiene hasta el vencimiento: (1+TIR)^(días/365) - 1. */
  retornoDirectoArs: number;
  /** Tipo de cambio MEP al cual, si se devalúa por encima, el carry pierde contra quedarse en dólares. */
  mepBreakeven: number;
  /** Devaluación implícita entre el MEP de entrada y el breakeven, en tanto por uno. */
  devaluacionBreakeven: number;
  /** Retorno directo en USD dado el MEP de entrada/salida ingresados por el usuario; null si no hay MEP cargado. */
  retornoDirectoUsd: number | null;
  /** Retorno en USD por escenario de MEP de salida fijo (1400/1500/1600) y el target custom; null sin MEP de entrada. */
  carryPorTarget: Record<'t1400' | 't1500' | 't1600' | 'custom', number | null>;
  /** Retorno en USD si el MEP de salida termina en el techo de banda cambiaria proyectado a esa fecha; null sin MEP de entrada. */
  bandaSuperior: number | null;
  tenenciaUsd?: number;
}

// ── Ingresos (haberes/sueldos por empleador, ARS/USD) ────────────────────────

export interface IngresoRow {
  fecha: number;        // timestamp ms
  fechaStr: string;      // "DD/MM/YYYY" como viene del Sheet
  empleador: string;
  montoArs: number;
  montoUsd: number;
}

export interface IngresosPorMes {
  mesKey: string;         // "YYYY-MM"
  fecha: string;          // "Mar-2024"
  totalArs: number;
  totalUsd: number;
  rows: IngresoRow[];
}

export interface IngresosResponse {
  ingresos: IngresoRow[];
  porMes: IngresosPorMes[];
  empleadores: string[];
  generatedAt: number;
}

// ── Gastos fijos (suscripciones/seguros recurrentes) ─────────────────────────

export type FrecuenciaGasto = 'mensual' | 'anual';

export interface GastoFijo {
  nombre: string;
  monto: number;
  moneda: 'ARS' | 'USD';
  frecuencia: FrecuenciaGasto;
  categoria: string;
}

export interface GastosFijosResponse {
  gastos: GastoFijo[];
  generatedAt: number;
}

// ── Performance (renta variable): fundamentals, variación, histórico ─────────

export interface StockPerformance {
  ticker: string;
  nombre?: string;
  px: number;
  /** Variaciones en tanto por uno (0.0123 = 1.23%); null si no se pudo calcular. */
  variacion1d: number | null;
  variacion1m: number | null;
  variacionYtd: number | null;
  variacion1a: number | null;
  /** trailingPE con fallback a forwardPE; null si Yahoo no publica ninguno (ej. ganancias negativas). */
  peRatio: number | null;
  marketCap: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  /** Preferido: yieldAnual trailing-12m real de datosAcciones(); fallback al forward yield de Yahoo. */
  dividendYield: number | null;
  /** Presente solo si el ticker está en la cartera actual. */
  tenenciaUsd?: number;
  /**
   * Presente solo en las posiciones de renta variable que son fondos CAFCI
   * (ej. un fondo de acciones del broker). Ahí `px` es el VCP del fondo en
   * `fciMoneda`, no un precio de mercado en USD, y las variaciones son los
   * rendimientos que publica la planilla: diaria, mes (en variacion1m), año
   * (en variacionYtd) y 12 meses (en variacion1a). No tienen P/E, market cap,
   * rango de 52 semanas ni yield.
   */
  esFci?: boolean;
  /** Moneda del VCP cuando `esFci` (ARS o USD); el resto de las filas va en USD. */
  fciMoneda?: string;
  /** Fecha del dato de la planilla cuando `esFci` ("DD/MM/AA"). */
  fciFecha?: string;
  /** La planilla publica este fondo con rezago y sin columnas de variación. */
  fciRezagado?: boolean;
}

export interface PerformanceVariableResponse {
  acciones: StockPerformance[];
  generatedAt: number;
}

export interface PrecioHistoricoPunto {
  fecha: string; // "YYYY-MM-DD"
  close: number;
}

export type RangoHistorico = '1m' | '6m' | '1a' | '5a' | '10a';

export interface HistoricoResponse {
  ticker: string;
  rango: RangoHistorico;
  puntos: PrecioHistoricoPunto[];
  generatedAt: number;
}

// ── Composición de ETFs sectoriales ───────────────────────────────────────────

export interface SectorHolding {
  symbol: string;
  nombre: string;
  /** Peso en tanto por uno (0.2058 = 20.58%). */
  peso: number;
}

export interface SectorHoldingsInfo {
  ticker: string;
  gestora: string | null;
  /** Expense ratio anual en tanto por uno; null si Yahoo no lo publica. */
  expenseRatio: number | null;
  holdings: SectorHolding[];
}

// ── Ratios entre dos activos ─────────────────────────────────────────────────

/** Serie del par A/B más sus métricas. Los indicadores se calculan en el cliente. */
export interface RatioResponse {
  activoA: string;
  activoB: string;
  rango: RangoHistorico;
  /** Alineada por fecha: solo las fechas presentes en ambas series. Ver lib/ratios.ts. */
  puntos: { fecha: string; ratio: number; pxA: number; pxB: number }[];
  estadisticas: {
    actual: number;
    minimo: number;
    maximo: number;
    promedio: number;
    percentil: number | null;
    variacion: number;
    zScore: number | null;
    correlacion: number | null;
    beta: number | null;
  } | null;
  generatedAt: number;
}
