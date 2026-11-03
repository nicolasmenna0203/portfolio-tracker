export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { parseResumenBroker, ultimoDiaDelMes, type ParsedPDF, type ParsedRow } from '@/lib/tenenciasPdf';
import { mesEnCurso, proximoMesACargar } from '@/lib/estadoCargas';
import { esMesKey } from '@/lib/finanzasPersonales';

// ── Auth Sheets (write) ───────────────────────────────────────────────────────

function getAuthWrite() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Falta env var GOOGLE_SERVICE_ACCOUNT_JSON');
  const credentials = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatArgentino(n: number): string {
  const [int, dec] = n.toFixed(2).split('.');
  const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFmt},${dec}`;
}

// ── Leer tickers de la hoja Activos ──────────────────────────────────────────

// El broker más frecuente en Activos es el valor inicial del formulario de altas.
async function fetchActivos(): Promise<{ tickers: Set<string>; brokerPorDefecto: string }> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) return { tickers: new Set(), brokerPorDefecto: '' };
  const auth = getAuthWrite();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: id,
    range: 'Activos!A:B',
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = (res.data.values ?? []).slice(1);
  const tickers = rows.map((r) => (r[0] ?? '').trim()).filter(Boolean);

  const usos = new Map<string, number>();
  for (const r of rows) {
    const broker = (r[1] ?? '').trim();
    if (broker) usos.set(broker, (usos.get(broker) ?? 0) + 1);
  }
  const brokerPorDefecto = [...usos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

  return { tickers: new Set(tickers), brokerPorDefecto };
}

// ── GET: meses ya cargados ────────────────────────────────────────────────────

export async function GET() {
  try {
    const id = process.env.SPREADSHEET_ID;
    if (!id) return NextResponse.json({ error: 'Falta SPREADSHEET_ID' }, { status: 500 });

    const auth = getAuthWrite();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: 'Tenencias!D:D',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rows = res.data.values ?? [];
    const fechas = rows.slice(1).map((r) => r[0] ?? '').filter(Boolean);

    const mesesCargados = new Set<string>();
    for (const f of fechas) {
      let d: Date | null = null;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(f)) {
        const [dd, mm2, yyyy2] = f.split('/');
        d = new Date(Date.UTC(+yyyy2, +mm2 - 1, +dd));
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        const [yyyy2, mm2, dd] = f.split('-');
        d = new Date(Date.UTC(+yyyy2, +mm2 - 1, +dd));
      }
      if (d) mesesCargados.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    return NextResponse.json({ mesesCargados: Array.from(mesesCargados) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: parse / add-activos / confirm ──────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? 'parse';

    // ── ADD-ACTIVOS: sube activos nuevos a la hoja Activos ────────────────
    if (action === 'add-activos') {
      interface NuevoActivo {
        ticker: string;
        broker: string;
        tipo: string;
        riesgo: string;
        sectorGeo: string;
        renta: string;
        moneda: string;
      }
      const body = await req.json() as { activos: NuevoActivo[] };
      if (!Array.isArray(body.activos) || body.activos.length === 0) {
        return NextResponse.json({ ok: true, filas: 0 });
      }

      const id = process.env.SPREADSHEET_ID!;
      const auth = getAuthWrite();
      const sheets = google.sheets({ version: 'v4', auth });

      const sheetRows = body.activos.map((a) => [
        a.ticker,
        a.broker,
        a.tipo,
        a.riesgo,
        a.sectorGeo,
        a.renta,
        a.moneda,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: 'Activos!A:G',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: sheetRows },
      });

      return NextResponse.json({ ok: true, filas: sheetRows.length });
    }

    // ── CONFIRM: recibe datos ya parseados y sube al sheet ────────────────
    if (action === 'confirm') {
      const body = await req.json() as {
        mesKey: string;
        dolarMep: number;
        rows: ParsedRow[];
      };
      if (!esMesKey(body.mesKey)) {
        return NextResponse.json({ error: 'Mes inválido' }, { status: 400 });
      }
      const fechaStr = ultimoDiaDelMes(body.mesKey);

      // Re-verificar que el mes no esté ya cargado
      const getRes = await GET();
      const getBody = await getRes.json();
      if ((getBody.mesesCargados as string[]).includes(body.mesKey)) {
        return NextResponse.json({ error: `El mes ${body.mesKey} ya está cargado en Tenencias.` }, { status: 409 });
      }

      const id = process.env.SPREADSHEET_ID!;
      const auth = getAuthWrite();
      const sheets = google.sheets({ version: 'v4', auth });

      const sheetRows = body.rows.map((r) => [
        r.ticker,
        formatArgentino(r.tenenciaARS),
        formatArgentino(r.tenenciaUSD),
        fechaStr,
      ]);

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: 'Tenencias!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: sheetRows },
      });

      return NextResponse.json({
        ok: true,
        mes: body.mesKey,
        fecha: fechaStr,
        filas: sheetRows.length,
        dolarMep: body.dolarMep,
      });
    }

    // ── PARSE: extrae datos del PDF sin subir al sheet ────────────────────
    const formData = await req.formData();
    const file = formData.get('pdf') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió PDF' }, { status: 400 });

    const pdfBytes = await file.arrayBuffer();
    const { extractText } = await import('unpdf');
    const { text: fullText } = await extractText(new Uint8Array(pdfBytes), { mergePages: true });

    let parsed: ParsedPDF;
    try {
      parsed = parseResumenBroker(fullText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Error parseando PDF: ${msg}` }, { status: 400 });
    }

    // El duplicado se controla contra el mes que elija el usuario en la vista previa.
    const getRes = await GET();
    const getBody = await getRes.json();
    if (!getRes.ok) return NextResponse.json({ error: getBody.error }, { status: 500 });

    // Detectar tickers que no están en la lista maestra de Activos
    const { tickers: tickersActivos, brokerPorDefecto } = await fetchActivos();
    const activosFaltantes = parsed.rows
      .map((r) => r.ticker)
      .filter((t) => !tickersActivos.has(t));

    const ahora = new Date();
    const mesProximo = proximoMesACargar(getBody.mesesCargados, ahora);

    return NextResponse.json({
      preview: true,
      mes: mesProximo, // valor inicial del selector; el usuario lo puede cambiar
      mesProximo,
      mesActual: mesEnCurso(ahora),
      mesesCargados: getBody.mesesCargados,
      fechaCierre: parsed.fecha,
      dolarMep: parsed.dolarMep,
      filas: parsed.rows.length,
      rows: parsed.rows,
      saldos: parsed.saldos,
      totalPosicionArs: parsed.totalPosicionArs,
      pendienteLiquidacionArs: parsed.pendienteLiquidacionArs,
      activosFaltantes,
      brokerPorDefecto,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
