import { readSheet } from './sheets';
import { parseArgNum, parseFechaDia, formatMesLabel, toMesKey } from './parser';
import type { IngresoRow, IngresosPorMes, IngresosResponse } from '@/types';

export async function fetchIngresos(): Promise<IngresosResponse> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const rawIngresos = await readSheet(id, 'Ingresos!A:D');

  const ingresos: IngresoRow[] = rawIngresos
    .map((r) => {
      const fechaStr = r['Fecha'] ?? r['FECHA'] ?? '';
      const ts = parseFechaDia(fechaStr);
      const empleador = r['Empleador'] ?? r['EMPLEADOR'] ?? '';
      if (!ts || !empleador) return null;
      return {
        fecha: ts,
        fechaStr,
        empleador,
        montoArs: parseArgNum(r['Monto ARS'] ?? r['MONTO ARS']) ?? 0,
        montoUsd: parseArgNum(r['Monto USD'] ?? r['MONTO USD']) ?? 0,
      };
    })
    .filter(Boolean) as IngresoRow[];

  ingresos.sort((a, b) => a.fecha - b.fecha);

  // ── Agrupar por mes ────────────────────────────────────────────────────────
  const porMesMap = new Map<string, IngresoRow[]>();
  for (const ing of ingresos) {
    const mesKey = toMesKey(ing.fecha);
    if (!porMesMap.has(mesKey)) porMesMap.set(mesKey, []);
    porMesMap.get(mesKey)!.push(ing);
  }

  const porMes: IngresosPorMes[] = Array.from(porMesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mesKey, rows]) => {
      const [y, m] = mesKey.split('-').map(Number);
      return {
        mesKey,
        fecha: formatMesLabel(Date.UTC(y, m - 1, 1)),
        totalArs: rows.reduce((s, r) => s + r.montoArs, 0),
        totalUsd: rows.reduce((s, r) => s + r.montoUsd, 0),
        rows,
      };
    });

  const empleadores = Array.from(new Set(ingresos.map((i) => i.empleador))).sort();

  return { ingresos, porMes, empleadores, generatedAt: Date.now() };
}
