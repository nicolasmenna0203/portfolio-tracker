/**
 * Backfill puntual: completa la columna ARS en las hojas Tenencias y Movimientos
 * del Google Sheet, usando el dólar MEP del día exacto de cada fila (fuente:
 * ArgentinaDatos, con fallback al día hábil más cercano hacia atrás — lib/benchmarks.ts).
 *
 * Por qué el MEP del día exacto y no uno único:
 * docs/decisiones/0007-mep-mensual-no-mep-unico.md
 *
 * - Tenencias!B (Tenencia (ARS)): completa solo las filas vacías/0, sin tocar
 *   las que ya traían un valor real cargado (ej. activos en pesos).
 * - Movimientos: agrega la columna D "Monto (ARS)" si no existe, y la completa
 *   para todas las filas usando el MEP de la columna A (Fecha).
 *
 * Uso: npx tsx scripts/backfill-ars.ts [--dry-run]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { google } from 'googleapis';
import { parseArgNum, parseFechaDia } from '../lib/parser';
import { fetchMepPorFecha } from '../lib/benchmarks';

// Carga manual de .env (sin depender del paquete `dotenv`, que no está instalado):
// evita el parsing de shell que rompe el JSON multilínea de la service account.
function loadEnvFile() {
  const path = join(__dirname, '..', '.env');
  const content = readFileSync(path, 'utf-8');
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta env var GOOGLE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

function formatArgentino(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${dec}`;
}

function tsToFechaIso(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

async function backfillTenencias(sheets: ReturnType<typeof google.sheets>, id: string) {
  console.log('\n── Tenencias ──────────────────────────────────────');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Tenencias!A:D',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) { console.log('Hoja vacía, nada que hacer.'); return; }

  const [header, ...data] = rows;
  // Columnas esperadas: Ticker | Tenencia (ARS) | Tenencia (USD) | Fecha
  const idxArs = header.findIndex((h) => /tenencia\s*\(ars\)/i.test(h));
  const idxUsd = header.findIndex((h) => /tenencia\s*\(usd\)/i.test(h));
  const idxFecha = header.findIndex((h) => /fecha/i.test(h));
  if (idxArs === -1 || idxUsd === -1 || idxFecha === -1) {
    throw new Error(`No se encontraron las columnas esperadas en Tenencias. Headers: ${header.join(', ')}`);
  }

  // Detectar filas a completar y sus fechas
  type Faltante = { rowIndex: number; fechaIso: string; usd: number };
  const faltantes: Faltante[] = [];
  data.forEach((row, i) => {
    const arsActual = parseArgNum(row[idxArs]);
    const usd = parseArgNum(row[idxUsd]) ?? 0;
    const fechaStr = row[idxFecha] ?? '';
    const ts = parseFechaDia(fechaStr);
    if ((arsActual == null || arsActual === 0) && usd > 0 && ts != null) {
      faltantes.push({ rowIndex: i, fechaIso: tsToFechaIso(ts), usd });
    }
  });

  console.log(`Total filas: ${data.length} · Filas a completar: ${faltantes.length}`);
  if (faltantes.length === 0) { console.log('Nada que completar.'); return; }

  const fechasUnicas = Array.from(new Set(faltantes.map((f) => f.fechaIso)));
  const mepPorFecha = await fetchMepPorFecha(fechasUnicas);

  const sinMep = fechasUnicas.filter((f) => mepPorFecha[f] == null);
  if (sinMep.length > 0) {
    console.warn(`Advertencia: sin cotización MEP para ${sinMep.length} fecha(s): ${sinMep.slice(0, 10).join(', ')}${sinMep.length > 10 ? '...' : ''}`);
  }

  // Preparar updates de celda individual (columna ARS, fila i+2 por header+1-index)
  const updates: { range: string; values: string[][] }[] = [];
  let completadas = 0;
  const colLetter = String.fromCharCode(65 + idxArs); // A=0 → 'A'
  for (const f of faltantes) {
    const mep = mepPorFecha[f.fechaIso];
    if (mep == null) continue;
    const ars = f.usd * mep;
    const sheetRow = f.rowIndex + 2; // +1 por header, +1 por 1-index
    updates.push({ range: `Tenencias!${colLetter}${sheetRow}`, values: [[formatArgentino(ars)]] });
    completadas++;
  }

  console.log(`Se completarán ${completadas} de ${faltantes.length} filas (resto sin cotización MEP disponible).`);
  if (DRY_RUN) {
    console.log('DRY RUN — no se escribe nada. Muestra de las primeras 10 filas a actualizar:');
    for (const u of updates.slice(0, 10)) console.log(`  ${u.range} = ${u.values[0][0]}`);
    return;
  }

  // batchUpdate en tandas de 500 para no exceder límites de la API
  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: chunk,
      },
    });
    console.log(`Escritas ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  console.log('Tenencias: listo.');
}

async function backfillMovimientos(sheets: ReturnType<typeof google.sheets>, id: string) {
  console.log('\n── Movimientos ────────────────────────────────────');
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Movimientos!A:D',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = res.data.values ?? [];
  if (rows.length < 2) { console.log('Hoja vacía, nada que hacer.'); return; }

  const [header, ...data] = rows;
  // Columnas esperadas: Fecha | Monto (USD) | Ingreso/Salida | [Monto (ARS)]
  const idxFecha = header.findIndex((h) => /fecha/i.test(h));
  const idxUsd = header.findIndex((h) => /monto\s*\(usd\)/i.test(h));
  let idxArs = header.findIndex((h) => /monto\s*\(ars\)/i.test(h));
  if (idxFecha === -1 || idxUsd === -1) {
    throw new Error(`No se encontraron las columnas esperadas en Movimientos. Headers: ${header.join(', ')}`);
  }

  const necesitaHeaderNuevo = idxArs === -1;
  if (necesitaHeaderNuevo) {
    idxArs = header.length; // se agrega al final
    console.log(`Columna "Monto (ARS)" no existe — se agregará en la columna ${String.fromCharCode(65 + idxArs)}.`);
  }

  type Faltante = { rowIndex: number; fechaIso: string; usd: number };
  const faltantes: Faltante[] = [];
  data.forEach((row, i) => {
    const arsActual = necesitaHeaderNuevo ? null : parseArgNum(row[idxArs]);
    const usd = parseArgNum(row[idxUsd]) ?? 0;
    const fechaStr = row[idxFecha] ?? '';
    const ts = parseFechaDia(fechaStr);
    if ((arsActual == null || arsActual === 0) && usd > 0 && ts != null) {
      faltantes.push({ rowIndex: i, fechaIso: tsToFechaIso(ts), usd });
    }
  });

  console.log(`Total filas: ${data.length} · Filas a completar: ${faltantes.length}`);

  const fechasUnicas = Array.from(new Set(faltantes.map((f) => f.fechaIso)));
  const mepPorFecha = fechasUnicas.length > 0 ? await fetchMepPorFecha(fechasUnicas) : {};

  const sinMep = fechasUnicas.filter((f) => mepPorFecha[f] == null);
  if (sinMep.length > 0) {
    console.warn(`Advertencia: sin cotización MEP para ${sinMep.length} fecha(s): ${sinMep.slice(0, 10).join(', ')}${sinMep.length > 10 ? '...' : ''}`);
  }

  const colLetter = String.fromCharCode(65 + idxArs);
  const updates: { range: string; values: string[][] }[] = [];

  if (necesitaHeaderNuevo) {
    updates.push({ range: `Movimientos!${colLetter}1`, values: [['Monto (ARS)']] });
  }

  let completadas = 0;
  for (const f of faltantes) {
    const mep = mepPorFecha[f.fechaIso];
    if (mep == null) continue;
    const ars = f.usd * mep;
    const sheetRow = f.rowIndex + 2;
    updates.push({ range: `Movimientos!${colLetter}${sheetRow}`, values: [[formatArgentino(ars)]] });
    completadas++;
  }

  console.log(`Se completarán ${completadas} de ${faltantes.length} filas (resto sin cotización MEP disponible).`);
  if (DRY_RUN) {
    console.log('DRY RUN — no se escribe nada. Muestra de las primeras 10 actualizaciones:');
    for (const u of updates.slice(0, 10)) console.log(`  ${u.range} = ${u.values[0][0]}`);
    return;
  }

  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        valueInputOption: 'USER_ENTERED',
        data: chunk,
      },
    });
    console.log(`Escritas ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }
  console.log('Movimientos: listo.');
}

async function main() {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  if (DRY_RUN) console.log('=== DRY RUN — no se escribirá nada en el Sheet ===');

  await backfillTenencias(sheets, id);
  await backfillMovimientos(sheets, id);

  console.log('\nListo.');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
