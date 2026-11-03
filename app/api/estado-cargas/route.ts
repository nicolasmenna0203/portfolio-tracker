import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getAuth } from '@/lib/sheets';
import { armarEstadoCargas } from '@/lib/estadoCargas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Solo la columna de fecha de cada hoja, en un único pedido a la API de Sheets.
const RANGOS = ['Tenencias!D:D', 'Movimientos!A:A', 'Ingresos!A:A'];

export async function GET() {
  try {
    const id = process.env.SPREADSHEET_ID;
    if (!id) return NextResponse.json({ error: 'Falta SPREADSHEET_ID' }, { status: 500 });

    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: id,
      ranges: RANGOS,
      valueRenderOption: 'FORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });

    const [tenencias, movimientos, haberes] = (res.data.valueRanges ?? []).map((r) =>
      (r.values ?? []).slice(1).map((fila) => String(fila[0] ?? '').trim()),
    );

    return NextResponse.json(armarEstadoCargas({
      tenencias: tenencias ?? [],
      movimientos: movimientos ?? [],
      haberes: haberes ?? [],
    }, new Date()));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
