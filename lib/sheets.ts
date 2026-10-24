// Lectura del Google Sheet (fuente de verdad) y armado del modelo del dashboard.
//
// Decisión sobre la valuación en pesos (MEP por fecha, no un MEP único):
// docs/decisiones/0007-mep-mensual-no-mep-unico.md

import { google } from 'googleapis';
import {
  parseArgNum,
  parseFechaDia,
  formatMesLabel,
  toMesKey,
} from './parser';
import { xirr, Cashflow } from './finance';
import type {
  DashboardData,
  ResumenRow,
  MovimientoRow,
  ActivoRow,
  TenenciaRow,
  TenenciaActual,
  KPIData,
} from '@/types';

// ── Auth ─────────────────────────────────────────────────────────────────────

export function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta env var GOOGLE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
}

// ── Raw sheet reader ──────────────────────────────────────────────────────────

export async function readSheet(
  spreadsheetId: string,
  range: string
): Promise<Record<string, string>[]> {
  const auth = getAuth();
  const sheetsApi = google.sheets({ version: 'v4', auth });
  const res = await sheetsApi.spreadsheets.values.get({
    spreadsheetId,
    range,
    valueRenderOption: 'FORMATTED_VALUE', // strings con formato argentino
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) return [];
  const [headers, ...data] = rows;
  return data.map((row) =>
    Object.fromEntries(
      headers.map((h: string, i: number) => [h.trim(), (row[i] ?? '').trim()])
    )
  );
}

// ── Data fetching and processing ──────────────────────────────────────────────

export async function fetchDashboardData(): Promise<DashboardData> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const [rawActivos, rawMovimientos, rawTenencias] =
    await Promise.all([
      readSheet(id, 'Activos!A:G'),
      readSheet(id, 'Movimientos!A:D'),
      readSheet(id, 'Tenencias!A:D'),
    ]);

  // ── Activos ────────────────────────────────────────────────────────────────
  const activos: ActivoRow[] = rawActivos.map((r) => ({
    TICKER: r['TICKER'] ?? r['Ticker'] ?? '',
    BROKER: r['BROKER'] ?? r['Broker'] ?? '',
    TIPO: r['TIPO'] ?? r['Tipo'] ?? '',
    RIESGO: parseArgNum(r['RIESGO'] ?? r['Riesgo']) ?? 0,
    SECTOR_GEO: r['SECTOR GEO'] ?? r['Sector Geo'] ?? '',
    RENTA: r['RENTA'] ?? r['Renta'] ?? '',
    MONEDA: r['MONEDA'] ?? r['Moneda'] ?? '',
  }));

  const activoMap = new Map(activos.map((a) => [a.TICKER, a]));

  // ── Movimientos ────────────────────────────────────────────────────────────
  // monto_ars viene de la columna Monto (ARS), calculada al MEP del día exacto de
  // cada movimiento (no un MEP de cierre de mes) — más preciso para agregar aportes.
  const movimientos: MovimientoRow[] = rawMovimientos
    .map((r) => {
      const ts = parseFechaDia(r['Fecha'] ?? r['FECHA'] ?? '');
      const monto = parseArgNum(r['Monto (USD)'] ?? r['MONTO (USD)']);
      const montoArs = parseArgNum(r['Monto (ARS)'] ?? r['MONTO (ARS)']) ?? 0;
      const tipo = (r['Ingreso/Salida'] ?? r['INGRESO/SALIDA'] ?? '')
        .trim()
        .toLowerCase() as 'ingreso' | 'salida';
      if (!ts || monto == null) return null;
      const monto_neto = tipo === 'ingreso' ? monto : -Math.abs(monto);
      const monto_neto_ars = tipo === 'ingreso' ? montoArs : -Math.abs(montoArs);
      return { fecha: ts, monto_usd: monto, monto_ars: montoArs, tipo, monto_neto, monto_neto_ars };
    })
    .filter(Boolean) as MovimientoRow[];

  movimientos.sort((a, b) => a.fecha - b.fecha);


  // ── Tenencias ──────────────────────────────────────────────────────────────
  // Tenencia (ARS) ya viene completa en el Sheet para toda fila con tenencia_usd > 0
  // (las cargas vía PDF del broker la traen calculada; el histórico legacy se completó
  // una vez con scripts/backfill-ars.ts usando el MEP del día exacto de cada fila).
  const tenencias: TenenciaRow[] = rawTenencias
    .map((r) => {
      const ts = parseFechaDia(r['Fecha'] ?? r['FECHA'] ?? '');
      const ticker = r['Ticker'] ?? r['TICKER'] ?? '';
      const usd = parseArgNum(r['Tenencia (USD)'] ?? r['TENENCIA (USD)']);
      if (!ts || !ticker) return null;
      return {
        ticker,
        tenencia_ars: parseArgNum(r['Tenencia (ARS)'] ?? r['TENENCIA (ARS)']) ?? 0,
        tenencia_usd: usd ?? 0,
        fechaTs: ts,
        fechaMes: toMesKey(ts),
      };
    })
    .filter(Boolean) as TenenciaRow[];

  // ── Join Tenencias + Activos ───────────────────────────────────────────────
  const tenenciasConActivos: TenenciaActual[] = tenencias
    .map((t) => {
      const a = activoMap.get(t.ticker);
      return {
        ...t,
        TIPO: a?.TIPO ?? 'OTRO',
        RIESGO: a?.RIESGO ?? 0,
        SECTOR_GEO: a?.SECTOR_GEO ?? '',
        RENTA: a?.RENTA ?? '',
        MONEDA: a?.MONEDA ?? '',
      };
    })
    .filter((t) => t.tenencia_usd > 0);

  // Agrupar tenencias por mes ("YYYY-MM")
  const tenenciasPorMes: Record<string, TenenciaActual[]> = {};
  for (const t of tenenciasConActivos) {
    if (!tenenciasPorMes[t.fechaMes]) tenenciasPorMes[t.fechaMes] = [];
    tenenciasPorMes[t.fechaMes].push(t);
  }
  // Ordenar cada snapshot por tenencia_usd desc
  for (const k of Object.keys(tenenciasPorMes)) {
    tenenciasPorMes[k].sort((a, b) => b.tenencia_usd - a.tenencia_usd);
  }

  // total_cartera por mes: suma de tenencias USD
  const totalPorMes: Record<string, number> = {};
  for (const [mes, items] of Object.entries(tenenciasPorMes)) {
    totalPorMes[mes] = items.reduce((sum, t) => sum + t.tenencia_usd, 0);
  }

  // total_cartera_ars por mes: suma de tenencias ARS (dato congelado del Sheet, sin conversión)
  const totalPorMesArs: Record<string, number> = {};
  for (const [mes, items] of Object.entries(tenenciasPorMes)) {
    totalPorMesArs[mes] = items.reduce((sum, t) => sum + t.tenencia_ars, 0);
  }

  // ── Resumen series: acumulado y aportes desde movimientos ─────────────────
  // Todos los meses con tenencias, ordenados
  const mesesOrdenados = Object.keys(totalPorMes).sort();

  const resumenSeries: ResumenRow[] = mesesOrdenados.map((mes) => {
    const [y, m] = mes.split('-').map(Number);
    const fechaTs = Date.UTC(y, m - 1, 1);
    const messiguiente = Date.UTC(y, m, 1);

    // Movimientos del mes
    const movDelMes = movimientos.filter(
      (mv) => mv.fecha >= fechaTs && mv.fecha < messiguiente
    );
    const aportesMes = movDelMes.reduce((sum, mv) => sum + mv.monto_neto, 0);
    // Cada movimiento ya viene convertido al MEP de su propio día — sumarlos así
    // es más preciso que convertir el total del mes con un único MEP de cierre.
    const aportesMesArs = movDelMes.reduce((sum, mv) => sum + mv.monto_neto_ars, 0);

    // Acumulado: todos los movimientos hasta el fin de este mes
    const movHastaFinMes = movimientos.filter((mv) => mv.fecha < messiguiente);
    const acumuladoAcum = movHastaFinMes.reduce((sum, mv) => sum + mv.monto_neto, 0);
    const acumuladoAcumArs = movHastaFinMes.reduce((sum, mv) => sum + mv.monto_neto_ars, 0);

    const total_cartera = totalPorMes[mes] ?? 0;
    const total_cartera_ars = totalPorMesArs[mes] ?? 0;
    return {
      fecha: formatMesLabel(fechaTs),
      fechaTs,
      aportes: aportesMes,
      aportes_ars: aportesMesArs,
      acumulado: acumuladoAcum,
      acumulado_ars: acumuladoAcumArs,
      total_cartera,
      total_cartera_ars,
      rendimiento: total_cartera - acumuladoAcum,
    };
  });

  // Meses disponibles en Tenencias, ordenados
  const mesesDisponibles = Object.keys(tenenciasPorMes)
    .sort()
    .map((k) => {
      const [y, m] = k.split('-').map(Number);
      const ts = Date.UTC(y, m - 1, 1);
      return formatMesLabel(ts);
    });

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const ultimo = resumenSeries[resumenSeries.length - 1];
  const penultimo = resumenSeries[resumenSeries.length - 2];

  const tirFlows: Cashflow[] = [
    ...movimientos.map((mv) => ({
      date: mv.fecha,
      amount: -mv.monto_neto,
    })),
    { date: Date.now(), amount: ultimo.total_cartera },
  ];
  const tirRaw = xirr(tirFlows);

  const kpis: KPIData = {
    totalCartera: ultimo.total_cartera,
    totalCarteraArs: ultimo.total_cartera_ars,
    aporteAcumulados: ultimo.acumulado,
    rendimientoNeto: ultimo.rendimiento,
    rendimientoPct:
      ultimo.acumulado > 0
        ? (ultimo.rendimiento / ultimo.acumulado) * 100
        : 0,
    deltaCartera: ultimo.total_cartera - penultimo.total_cartera,
    tirAnual: tirRaw != null ? tirRaw * 100 : null,
    fechaStr: ultimo.fecha,
  };

  return {
    kpis,
    resumenSeries,
    tenenciasPorMes,
    mesesDisponibles,
    totalPorMes,
    totalPorMesArs,
    movimientos,
  };
}
