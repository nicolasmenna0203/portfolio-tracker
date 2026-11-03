export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { fetchMepPorFecha } from '@/lib/benchmarks';
import { exigirFinDeMes } from '@/lib/tenenciasPdf';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseArgNum(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
}

function formatFecha(ddmmyyyy: string): string {
  // "06-04-2026" → "06/04/2026"
  return ddmmyyyy.replace(/-/g, '/');
}

// ── Parser ────────────────────────────────────────────────────────────────────

interface MovimientoRow {
  fecha: string;       // "DD/MM/YYYY"
  montoUSD: number;    // siempre positivo
  // ARS tal cual figura en el PDF, cuando la fila es nativamente en ARS (Orden De
  // Pago / Recibo De Cobro sin sufijo Usd/Dolares). null si la fila es en USD —
  // en ese caso el ARS se calcula con el MEP de fetchMepPorFecha en el POST confirm.
  montoArsOriginal: number | null;
  tipo: 'Ingreso' | 'Salida';
}

interface ParsedMovimientos {
  mesKey: string;      // "YYYY-MM"
  rows: MovimientoRow[];
}

function parseMovimientosText(fullText: string): ParsedMovimientos {
  // ── 1. Encontrar sección INCREMENTOS/DECREMENTOS ───────────────────────────
  const sectionStart = fullText.indexOf('INCREMENTOS/DECREMENTOS DE LA INVERSION');
  if (sectionStart === -1) throw new Error('No se encontró sección INCREMENTOS/DECREMENTOS en el PDF');

  // Termina en la línea "INCREMENTO DE LA INVERSION" o "MOVIMIENTOS"
  const sectionEnd = fullText.indexOf('INCREMENTO DE LA INVERSION', sectionStart);
  const section = sectionEnd > 0
    ? fullText.slice(sectionStart, sectionEnd)
    : fullText.slice(sectionStart, sectionStart + 3000);

  // ── 2. Extraer mes del encabezado "Desde DD-MM-YYYY- Hasta DD-MM-YYYY" ─────
  const hastaMatch = fullText.match(/Hasta\s+(\d{2}-\d{2}-(\d{4}))/i);
  // Un período parcial marcaría el mes como cargado y bloquearía el resumen completo.
  if (hastaMatch) exigirFinDeMes(hastaMatch[1]);
  const mesKey = hastaMatch
    ? `${hastaMatch[2]}-${hastaMatch[1].split('-')[1]}`
    : '';

  // ── 3. Parsear filas ───────────────────────────────────────────────────────
  // Patrón de línea en sección INCREMENTOS:
  // "06-04-2026 Orden De Pago - 14484527 ARS 1.427,88 -900.000,00 -630,31*"
  // "07-04-2026 Recibo De Cobro - 14627953 ARS 1.431,03 1.600.000,00 1.118,08*"
  // "13-07-2026 Orden De Pago Usd - 20740274 USD 1.519,59 -37.989,75* -25"
  // "11-08-2026 Recibo De Cobro Dolares - 22825906 USD 1.523,59 101.943,41* 66,91"
  // Columnas: FECHA LIQ | COMPROBANTE | ESPECIE | TIPO DE CAMBIO | ARS | USD
  // ESPECIE varía (ARS, USD, "Dólar estadounidense", etc.) — no se puede fijar en el regex.
  // El monto USD es siempre el último número de la línea (puede tener * al final)

  const rows: MovimientoRow[] = [];

  // unpdf no garantiza saltos de línea limpios por fila (el texto de una fila puede
  // quedar corrido con el de la siguiente). Por eso no anclamos por fin de línea:
  // cada fila arranca con "DD-MM-YYYY", así que partimos la sección en bloques que
  // van desde una fecha hasta la próxima (o el final de la sección).
  const dateSplitRegex = /(?=\d{2}-\d{2}-\d{4}\s)/g;
  const chunks = section.split(dateSplitRegex).filter((c) => /^\d{2}-\d{2}-\d{4}\s/.test(c));

  // Dentro de cada bloque: fecha + tipo (Orden De Pago / Recibo De Cobro, con o sin
  // sufijo Usd/Dolares) + comprobante, luego la fila cierra con el par
  // "ARS_MONTO USD_MONTO*?" (ese orden siempre, según el encabezado de columnas).
  // No se puede anclar con $: el chunk puede arrastrar el header de la página
  // siguiente pegado al final sin espacio útil de por medio.
  // Se capturan ambos montos: cuando la fila es nativamente en ARS (sin sufijo
  // Usd/Dolares), el ARS del PDF es la fuente de verdad y no debe recalcularse
  // reconvirtiendo el USD con un MEP de otro día/fuente (ver montoArsOriginal).
  const chunkRegex = /^(\d{2}-\d{2}-\d{4})\s+(Orden De Pago(?:\s+Usd)?|Recibo De Cobro(?:\s+Dolares)?)\s+-\s+\d+[\s\S]*?\s+[-\d.,]+\s+([-\d.,]+)\*?\s+([-\d.,]+)\*?(?:\s|$)/i;

  for (const chunk of chunks) {
    const m = chunkRegex.exec(chunk.trim());
    if (!m) continue;

    const fecha = formatFecha(m[1]);
    const concepto = m[2].toLowerCase();
    const esNativoUsd = /usd|dolares/.test(concepto);
    const arsRaw = Math.abs(parseArgNum(m[3]));
    const usdRaw = Math.abs(parseArgNum(m[4]));

    if (usdRaw === 0 || isNaN(usdRaw)) continue;

    rows.push({
      fecha,
      montoUSD: usdRaw,
      montoArsOriginal: !esNativoUsd && !isNaN(arsRaw) && arsRaw > 0 ? arsRaw : null,
      // Orden De Pago   (ARS o Usd)     = el broker te paga = retiro = entrada a tu bolsillo → Salida (TIR: +)
      // Recibo De Cobro (ARS o Dolares) = vos depositás = aporte = salida de tu bolsillo → Ingreso (TIR: -)
      tipo: concepto.includes('recibo') ? 'Ingreso' : 'Salida',
    });
  }

  if (rows.length === 0) throw new Error('No se encontraron movimientos de ingreso/retiro en el PDF');

  return { mesKey, rows };
}

// ── GET: meses ya cargados en Movimientos ─────────────────────────────────────

export async function GET() {
  try {
    const id = process.env.SPREADSHEET_ID;
    if (!id) return NextResponse.json({ error: 'Falta SPREADSHEET_ID' }, { status: 500 });

    const auth = getAuthWrite();
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: 'Movimientos!A:A',
      valueRenderOption: 'FORMATTED_VALUE',
    });

    const rawRows = res.data.values ?? [];
    const fechas = rawRows.slice(1).map((r) => r[0] ?? '').filter(Boolean);

    const mesesCargados = new Set<string>();
    for (const f of fechas) {
      let d: Date | null = null;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(f)) {
        const [dd, mm, yyyy] = f.split('/');
        d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(f)) {
        const [yyyy, mm, dd] = f.split('-');
        d = new Date(Date.UTC(+yyyy, +mm - 1, +dd));
      }
      if (d) mesesCargados.add(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
    }

    return NextResponse.json({ mesesCargados: Array.from(mesesCargados) });
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

    // ── CONFIRM: recibe datos ya parseados y sube al sheet ────────────────
    if (action === 'confirm') {
      const body = await req.json() as {
        mesKey: string;
        rows: MovimientoRow[];
      };

      // Re-verificar mes duplicado
      const getRes = await GET();
      const getBody = await getRes.json();
      if (body.mesKey && (getBody.mesesCargados as string[]).includes(body.mesKey)) {
        return NextResponse.json(
          { error: `El mes ${body.mesKey} ya tiene movimientos cargados.` },
          { status: 409 }
        );
      }

      const id = process.env.SPREADSHEET_ID!;
      const auth = getAuthWrite();
      const sheets = google.sheets({ version: 'v4', auth });

      // Conversión USD→ARS con el MEP del día exacto de cada movimiento.
      const fechasIso = Array.from(new Set(body.rows.map((r) => {
        const [dd, mm, yyyy] = r.fecha.split('/');
        return `${yyyy}-${mm}-${dd}`;
      })));
      let mepPorFecha: Record<string, number> = {};
      try {
        mepPorFecha = await fetchMepPorFecha(fechasIso);
      } catch {
        // Si falla la fuente de MEP, se sube igual sin conversión (Monto ARS queda vacío).
      }

      const sheetRows = body.rows.map((r) => {
        const [dd, mm, yyyy] = r.fecha.split('/');
        const mep = mepPorFecha[`${yyyy}-${mm}-${dd}`];
        // Si el PDF ya trae el ARS nativo (fila en ARS), se usa tal cual — reconvertir
        // el USD del PDF (redondeado) con el MEP de esta fuente perdía precisión.
        const montoArs = r.montoArsOriginal ?? (mep ? r.montoUSD * mep : null);
        return [
          r.fecha,
          r.montoUSD.toFixed(2).replace('.', ','),
          r.tipo,
          montoArs != null ? montoArs.toFixed(2).replace('.', ',') : '',
        ];
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: id,
        range: 'Movimientos!A:D',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: sheetRows },
      });

      return NextResponse.json({
        ok: true,
        mes: body.mesKey,
        filas: sheetRows.length,
        movimientos: body.rows,
      });
    }

    // ── PARSE: extrae datos del PDF sin subir al sheet ────────────────────
    const formData = await req.formData();
    const file = formData.get('pdf') as File | null;
    if (!file) return NextResponse.json({ error: 'No se recibió PDF' }, { status: 400 });

    const pdfBytes = await file.arrayBuffer();
    const { extractText } = await import('unpdf');
    const { text: fullText } = await extractText(new Uint8Array(pdfBytes), { mergePages: true });

    let parsed: ParsedMovimientos;
    try {
      parsed = parseMovimientosText(fullText);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `Error parseando PDF: ${msg}` }, { status: 400 });
    }

    // Verificar mes duplicado antes de mostrar preview
    const getRes = await GET();
    const getBody = await getRes.json();
    if (parsed.mesKey && (getBody.mesesCargados as string[]).includes(parsed.mesKey)) {
      return NextResponse.json(
        { error: `El mes ${parsed.mesKey} ya tiene movimientos cargados.` },
        { status: 409 }
      );
    }

    return NextResponse.json({
      preview: true,
      mes: parsed.mesKey,
      filas: parsed.rows.length,
      movimientos: parsed.rows,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
