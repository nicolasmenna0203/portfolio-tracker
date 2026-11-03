// Universo sintético de la cartera de demostración: mismos tickers, tipos,
// riesgos y monedas usados en TODAS las fixtures de /demo y /api/demo/*, para
// que Tenencias, Performance, Calendario, etc. cuenten la misma
// historia coherente en vez de datos inconexos por sección.
//
// Todos los tickers son de compañías/instrumentos públicos reales (CEDEARs y
// ETFs conocidos) o de bonos argentinos genéricos ya listados en bonistas.com:
// no revelan nada de la cartera real, que nunca se lee desde acá. Ninguno está
// en la cartera: un ticker propio en la demo la insinúa aunque los montos sean
// ficticios (docs/decisiones/0030-repo-privado-y-espejo-publico.md).
//
// Los montos (tenencias, y en fixtures.ts ingresos, gastos y cobros) son
// deliberadamente chicos, de juguete: la demo se muestra a terceros y no tiene
// que sugerir ningún orden de magnitud cercano al de la cartera real.

import type { ActivoRow, GrupoBono } from '@/types';

export interface DemoActivo extends ActivoRow {
  /** Tenencia base en USD al mes más reciente — se escala hacia atrás para el histórico. */
  tenenciaBaseUsd: number;
  /** Precio de referencia actual, para generar series de precio coherentes. */
  precioBase: number;
}

// ── CEDEARs / ETFs (renta variable, USD) ────────────────────────────────────
export const ACTIVOS_VARIABLE: DemoActivo[] = [
  { TICKER: 'AAPL', BROKER: 'Broker Demo', TIPO: 'ACCIONES', RIESGO: 3, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 210, precioBase: 227 },
  { TICKER: 'JPM',  BROKER: 'Broker Demo', TIPO: 'ACCIONES', RIESGO: 3, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 195, precioBase: 250 },
  { TICKER: 'KO',   BROKER: 'Broker Demo', TIPO: 'ACCIONES', RIESGO: 2, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 90, precioBase: 63 },
  { TICKER: 'WMT',  BROKER: 'Broker Demo', TIPO: 'ACCIONES', RIESGO: 2, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 130, precioBase: 95 },
  { TICKER: 'VTI',  BROKER: 'Broker Demo', TIPO: 'ETF',      RIESGO: 2, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 260, precioBase: 300 },
  { TICKER: 'XLF',  BROKER: 'Broker Demo', TIPO: 'ETF',      RIESGO: 3, SECTOR_GEO: 'EU', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 155, precioBase: 52 },
  { TICKER: 'VWO',  BROKER: 'Broker Demo', TIPO: 'ETF',      RIESGO: 3, SECTOR_GEO: 'EMER', RENTA: 'VAR', MONEDA: 'USD', tenenciaBaseUsd: 60, precioBase: 48 },
];

// ── Bonos argentinos hard-dollar (USD, cartera "ARGY") ──────────────────────
export const ACTIVOS_BONOS_USD: DemoActivo[] = [
  { TICKER: 'AL35', BROKER: 'Broker Demo', TIPO: 'ARGY', RIESGO: 4, SECTOR_GEO: 'ARG', RENTA: 'FIJA', MONEDA: 'USD', tenenciaBaseUsd: 120, precioBase: 68 },
  { TICKER: 'GD35', BROKER: 'Broker Demo', TIPO: 'ARGY', RIESGO: 4, SECTOR_GEO: 'ARG', RENTA: 'FIJA', MONEDA: 'USD', tenenciaBaseUsd: 95, precioBase: 71 },
];

// ── Bonos en pesos (CER / tasa) ──────────────────────────────────────────────
export const ACTIVOS_BONOS_ARS: DemoActivo[] = [
  { TICKER: 'TX31', BROKER: 'Broker Demo', TIPO: 'ARGY', RIESGO: 3, SECTOR_GEO: 'ARG', RENTA: 'FIJA', MONEDA: 'CER', tenenciaBaseUsd: 45, precioBase: 1850 },
];

// ── FCI ───────────────────────────────────────────────────────────────────
export const ACTIVOS_FCI: DemoActivo[] = [
  { TICKER: 'FDEMO', BROKER: 'Broker Demo', TIPO: 'FCI', RIESGO: 1, SECTOR_GEO: 'ARG', RENTA: 'FIJA', MONEDA: 'USD', tenenciaBaseUsd: 75, precioBase: 1820 },
];

export const TODOS_ACTIVOS: DemoActivo[] = [
  ...ACTIVOS_VARIABLE,
  ...ACTIVOS_BONOS_USD,
  ...ACTIVOS_BONOS_ARS,
  ...ACTIVOS_FCI,
];

export const ACTIVO_MAP = new Map(TODOS_ACTIVOS.map((a) => [a.TICKER, a]));

// ── Universo ampliado de bonos ARG para la pestaña Performance (renta fija) ──
// No todos están en cartera — bonistas.com también trae el universo completo
// para comparar. Solo AL35/GD35/TX31 tienen tenenciaUsd asociada.
export interface DemoBono {
  ticker: string;
  tickerCartera: string | null;
  bondFamily: string;
  emisor: string | null;
  grupo: GrupoBono;
  moneda: string;
  tirBase: number;      // TIR efectiva anual, tanto por uno
  tnaBase: number;
  durationBase: number; // años
  vencimiento: string;  // "YYYY-MM-DD"
  tenenciaUsd?: number;
}

export const UNIVERSO_BONOS: DemoBono[] = [
  { ticker: 'AL35', tickerCartera: 'AL35', bondFamily: 'Bonar', emisor: null, grupo: 'USD', moneda: 'USD', tirBase: 0.115, tnaBase: 0.0875, durationBase: 5.2, vencimiento: '2035-07-09', tenenciaUsd: 120 },
  { ticker: 'GD35', tickerCartera: 'GD35', bondFamily: 'Global', emisor: null, grupo: 'USD', moneda: 'USD', tirBase: 0.108, tnaBase: 0.0875, durationBase: 4.9, vencimiento: '2035-07-09', tenenciaUsd: 95 },
  { ticker: 'GD46', tickerCartera: null, bondFamily: 'Global', emisor: null, grupo: 'USD', moneda: 'USD', tirBase: 0.102, tnaBase: 0.0750, durationBase: 7.4, vencimiento: '2046-07-09', },
  { ticker: 'AL41', tickerCartera: null, bondFamily: 'Bonar', emisor: null, grupo: 'USD', moneda: 'USD', tirBase: 0.099, tnaBase: 0.0700, durationBase: 6.7, vencimiento: '2041-07-09', },
  { ticker: 'TX31', tickerCartera: 'TX31', bondFamily: 'Boncer', emisor: null, grupo: 'CER', moneda: 'ARS', tirBase: 0.09, tnaBase: 0.045, durationBase: 4.1, vencimiento: '2031-11-30', tenenciaUsd: 45 },
  { ticker: 'TZXM8', tickerCartera: null, bondFamily: 'Boncer', emisor: null, grupo: 'CER', moneda: 'ARS', tirBase: 0.095, tnaBase: 0.05, durationBase: 1.3, vencimiento: '2028-03-31', },
  { ticker: 'TZXS7', tickerCartera: null, bondFamily: 'Boncer', emisor: null, grupo: 'CER', moneda: 'ARS', tirBase: 0.087, tnaBase: 0.042, durationBase: 0.9, vencimiento: '2027-09-30', },
  { ticker: 'S31E6', tickerCartera: null, bondFamily: 'Lecap', emisor: null, grupo: 'ARS_TASA', moneda: 'ARS', tirBase: 0.36, tnaBase: 0.31, durationBase: 0.4, vencimiento: '2026-01-31', },
  { ticker: 'T15D6', tickerCartera: null, bondFamily: 'Boncap', emisor: null, grupo: 'ARS_TASA', moneda: 'ARS', tirBase: 0.34, tnaBase: 0.29, durationBase: 1.3, vencimiento: '2026-12-15', },
  { ticker: 'TZV26', tickerCartera: null, bondFamily: 'Dollar Linked', emisor: null, grupo: 'DOLLAR_LINKED', moneda: 'USD', tirBase: 0.045, tnaBase: 0.04, durationBase: 1.0, vencimiento: '2026-04-30', },
  { ticker: 'BPOA7', tickerCartera: null, bondFamily: 'Bopreal', emisor: null, grupo: 'BOPREAL', moneda: 'USD', tirBase: 0.068, tnaBase: 0.05, durationBase: 0.5, vencimiento: '2027-04-30', },
  { ticker: 'BPOB8', tickerCartera: null, bondFamily: 'Bopreal', emisor: null, grupo: 'BOPREAL', moneda: 'USD', tirBase: 0.075, tnaBase: 0.05, durationBase: 1.4, vencimiento: '2028-10-31', },
  { ticker: 'YMCJO', tickerCartera: null, bondFamily: 'ON YPF', emisor: 'YPF S.A.', grupo: 'ONS_USD', moneda: 'USD', tirBase: 0.079, tnaBase: 0.077, durationBase: 3.2, vencimiento: '2029-07-21', },
  { ticker: 'PNDCO', tickerCartera: null, bondFamily: 'ON Pampa', emisor: 'Pampa Energía', grupo: 'ONS_USD', moneda: 'USD', tirBase: 0.081, tnaBase: 0.079, durationBase: 2.8, vencimiento: '2029-01-24', },
];

// ── FCI ampliados (pestaña Performance/FCI) ──────────────────────────────────
export interface DemoFci {
  ticker: string;
  nombreFondo: string;
  moneda: string;
  horizonte: string;
  vcpBase: number;
  tenenciaUsd?: number;
}

export const UNIVERSO_FCI: DemoFci[] = [
  { ticker: 'FDEMO', nombreFondo: 'Fondo Renta Fija Demo', moneda: 'USD', horizonte: 'Corto plazo', vcpBase: 1820, tenenciaUsd: 75 },
  { ticker: 'FCRECI', nombreFondo: 'Fondo Renta Crecimiento Demo', moneda: 'ARS', horizonte: 'Mediano plazo', vcpBase: 3450 },
  { ticker: 'FLIQD', nombreFondo: 'Fondo Money Market Demo', moneda: 'ARS', horizonte: 'Muy corto plazo', vcpBase: 128 },
];

// ── Empleadores ficticios (pestaña Ingresos) ─────────────────────────────────
export const EMPLEADORES_DEMO = ['Empresa Demo SA', 'Consultora Demo SRL'];
