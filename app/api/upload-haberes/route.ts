export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { parseHaberesText, type HaberRow } from '@/lib/haberes';
import { fetchMepPorFecha } from '@/lib/benchmarks';

// ── Auth ──────────────────────────────────────────────────────────────────────

function getAuthWrite() {
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

/** "DD/MM/YYYY" → timestamp UTC, para poder ordenar cronológicamente. */
function fechaATimestamp(fechaStr: string): number {
  const [dd, mm, yyyy] = fechaStr.split('/');
  return Date.UTC(+yyyy, +mm - 1, +dd);
}

// ── GET: filas y empleadores ya cargados en Ingresos ──────────────────────────

/** Normaliza una fecha a "YYYY-MM-DD" (acepta "DD/MM/YYYY" o "YYYY-MM-DD") para comparar filas. */
function normalizarFecha(f: string): string | null {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(f)) {
    const [dd, mm, yyyy] = f.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(f)) return f;
  return null;
}

/**
 * Clave de dedupe de una fila: fecha normalizada + montos, SIN el empleador.
 * El nombre del empleador no es confiable para comparar: el usuario puede
 * estandarizarlo al confirmar (ej. "CUIT 30222222222" → "EMPRESA DOS SRL"),
 * y el parser vuelve a extraer el nombre crudo del PDF en la próxima carga,
 * que ya no coincide con el guardado. Fecha exacta + monto exacto identifican
 * el pago igual de bien y no cambian aunque el nombre se edite después.
 */
function claveFila(fecha: string, montoArs: string, montoUsd: string): string {
  const fechaNorm = normalizarFecha(fecha) ?? fecha;
  return `${fechaNorm}|${montoArs}|${montoUsd}`;
}

export async function GET() {
  try {
    const id = process.env.SPREADSHEET_ID;
    if (!id) return NextResponse.json({ error: 'Falta SPREADSHEET_ID' }, { status: 500 });

    const auth = getAuthWrite();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: 'Ingresos!A:D',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const dataRows = (res.data.values ?? []).slice(1).filter((r) => r[0]);
    const empleadoresConocidos = Array.from(new Set(dataRows.map((r) => r[1] ?? '').filter(Boolean)));
    const filasExistentes = new Set(
      dataRows.map((r) => claveFila(r[0] ?? '', r[2] ?? '0', r[3] ?? '0'))
    );

    return NextResponse.json({
      filasExistentes: Array.from(filasExistentes),
      empleadoresConocidos,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// ── POST: parse (action=parse) o confirm (action=confirm) ────────────────────

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? 'parse';

    // ── CONFIRM: recibe filas ya parseadas (y editadas por el usuario) y sube ──
    if (action === 'confirm') {
      const body = await req.json() as { rows: HaberRow[] };
      if (!Array.isArray(body.rows) || body.rows.length === 0) {
        return NextResponse.json({ error: 'No hay filas para subir' }, { status: 400 });
      }

      const id = process.env.SPREADSHEET_ID!;
      const auth = getAuthWrite();
      const sheets = google.sheets({ version: 'v4', auth });

      // Se reescribe el rango completo (en vez de `append`) para que la hoja
      // quede siempre ordenada por fecha ascendente, sin importar el orden en
      // que se cargan los PDFs — un resumen de un mes anterior cargado después
      // de uno posterior debe insertarse en su posición, no al final.
      const existing = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: 'Ingresos!A2:D',
        valueRenderOption: 'FORMATTED_VALUE',
      });
      const filasExistentes = (existing.data.values ?? []).filter((r) => r[0]);

      // El nombre del empleador siempre se guarda en mayúsculas, sin importar
      // cómo lo haya tipeado el usuario en el formulario de estandarización.
      const filasNuevas = body.rows.map((r) => [
        r.fecha,
        r.empleador.toUpperCase(),
        formatArgentino(r.montoArs),
        formatArgentino(r.montoUsd),
      ]);

      const todasLasFilas = [...filasExistentes, ...filasNuevas].sort(
        (a, b) => fechaATimestamp(a[0]) - fechaATimestamp(b[0])
      );

      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `Ingresos!A2:D${todasLasFilas.length + 1}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: todasLasFilas },
      });

      return NextResponse.json({
        ok: true,
        filas: filasNuevas.length,
        rows: body.rows,
      });
    }

    // ── PARSE: extrae datos del PDF sin subir al sheet ────────────────────
    const formData = await req.formData();
    const file = formData.get('pdf') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió PDF' }, { status: 400 });

    const pdfBytes = await file.arrayBuffer();
    const { extractText } = await import('unpdf');
    const { text: fullText } = await extractText(new Uint8Array(pdfBytes), { mergePages: true });

    let parsed;
    try {
      parsed = parseHaberesText(fullText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Error parseando PDF: ${msg}` }, { status: 400 });
    }

    const getRes = await GET();
    const getBody = await getRes.json();
    const filasExistentes = new Set<string>(getBody.filasExistentes ?? []);
    const empleadoresConocidos: string[] = getBody.empleadoresConocidos ?? [];

    // ── Conversión ARS→USD con el MEP del día exacto de cada acreditación ──
    const fechasArs = Array.from(new Set(
      parsed.rows.filter((r) => r.montoArs > 0).map((r) => {
        const [dd, mm, yyyy] = r.fecha.split('/');
        return `${yyyy}-${mm}-${dd}`;
      })
    ));
    let mepPorFecha: Record<string, number> = {};
    try {
      mepPorFecha = await fetchMepPorFecha(fechasArs);
    } catch {
      // Si falla la fuente de MEP, se sube igual sin conversión (montoUsd queda en 0).
    }

    const rowsConUsd: HaberRow[] = parsed.rows.map((r) => {
      if (r.montoArs <= 0) return r;
      const [dd, mm, yyyy] = r.fecha.split('/');
      const mep = mepPorFecha[`${yyyy}-${mm}-${dd}`];
      return mep ? { ...r, montoUsd: r.montoArs / mep } : r;
    });

    // Excluir del preview las filas que ya están cargadas (misma fecha+monto exactos,
    // no el mes entero — así un pago nuevo de otro empleador el mismo mes no se bloquea).
    const rowsNuevas = rowsConUsd.filter((r) => {
      const clave = claveFila(r.fecha, formatArgentino(r.montoArs), formatArgentino(r.montoUsd));
      return !filasExistentes.has(clave);
    });

    if (rowsNuevas.length === 0) {
      return NextResponse.json(
        { error: 'Todas las acreditaciones detectadas en este PDF ya están cargadas en Ingresos.' },
        { status: 409 }
      );
    }

    // ── Empleadores nuevos: no están (case-insensitive) entre los ya cargados ──
    const conocidosNorm = new Set(empleadoresConocidos.map((e) => e.toLowerCase()));
    const empleadoresDetectados = Array.from(new Set(rowsNuevas.map((r) => r.empleador)));
    const empleadoresNuevos = empleadoresDetectados.filter((e) => !conocidosNorm.has(e.toLowerCase()));

    return NextResponse.json({
      preview: true,
      filas: rowsNuevas.length,
      rows: rowsNuevas,
      empleadores: empleadoresDetectados,
      empleadoresNuevos,
      omitidas: rowsConUsd.length - rowsNuevas.length,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
