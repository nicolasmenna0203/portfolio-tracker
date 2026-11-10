// Decisión y alternativas descartadas: docs/decisiones/0035-bloqueo-con-passkey-en-cada-apertura.md
//
// ── Passkeys registradas ────────────────────────────────────────────────────
//
// Las passkeys con las que se puede entrar o desbloquear la app. Viven en la
// hoja `Passkeys` del Sheet, no en una variable de entorno: así el alta se hace
// desde el dashboard sin redeploy, y la baja es borrar la fila.
//
// Nada de esto es secreto: el id identifica la credencial y la clave pública
// solo sirve para verificar firmas. La clave privada nunca sale del
// dispositivo (o del llavero de iCloud). Lo que sí importa es que nadie pueda
// agregar una fila sin estar autenticado: la única ruta que escribe acá exige
// sesión (app/api/auth/passkey/registro).
//
// ── Layout de la hoja ───────────────────────────────────────────────────────
//
//        A     B              C            D
//   1  ID    CLAVE_PUBLICA  DISPOSITIVO  CREADA
//   2  ...   ...            iPhone       2026-11-10
//
// Se agrega con append, no se reescribe entera: el ADR 0029 no aplica, pero
// una lectura fallida tampoco se toma como "sin passkeys": falla el ingreso
// con un error en vez de decir que la passkey no existe.

import { google } from 'googleapis';
import { getAuth, getAuthWrite, esHojaInexistente } from './sheets';

export const HOJA = 'Passkeys';

const ENCABEZADO = ['ID', 'CLAVE_PUBLICA', 'DISPOSITIVO', 'CREADA'];

export interface Passkey {
  id: string;
  clavePublica: string;
  dispositivo: string;
  creada: string;
}

// Largos mínimos en base64url: WebAuthn exige ids de credencial de 16 bytes o
// más (22 caracteres), y una clave P-256 en SPKI son 91 bytes (122). Sirven
// para que una fila con las celdas corridas no se lea como passkey.
const ID_VALIDO = /^[A-Za-z0-9_-]{22,}$/;
const CLAVE_VALIDA = /^[A-Za-z0-9_-]{120,}$/;

/** Descarta filas malformadas (editadas a mano, celdas corridas). */
export function normalizarPasskey(fila: unknown[]): Passkey | null {
  const id = String(fila[0] ?? '').trim();
  const clavePublica = String(fila[1] ?? '').trim();
  if (!ID_VALIDO.test(id) || !CLAVE_VALIDA.test(clavePublica)) return null;
  return {
    id,
    clavePublica,
    dispositivo: String(fila[2] ?? '').trim(),
    creada: String(fila[3] ?? '').trim(),
  };
}

/** Nombre del dispositivo para la columna DISPOSITIVO, sacado del user agent. */
export function nombreDispositivo(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent)) return 'iPad';
  if (/Macintosh/.test(userAgent)) return 'Mac';
  if (/Android/.test(userAgent)) return 'Android';
  if (/Windows/.test(userAgent)) return 'Windows';
  return 'Otro';
}

function spreadsheetId(): string {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');
  return id;
}

/** Lee las passkeys. Sin la hoja todavía, lista vacía; cualquier otro error falla. */
export async function leerPasskeys(): Promise<Passkey[]> {
  let grid: unknown[][];
  try {
    const sheets = google.sheets({ version: 'v4', auth: getAuth() });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: spreadsheetId(),
      range: `${HOJA}!A2:D100`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    grid = (res.data.values ?? []) as unknown[][];
  } catch (err) {
    if (esHojaInexistente(err)) return [];
    throw err;
  }
  return grid.map(normalizarPasskey).filter((p): p is Passkey => p !== null);
}

/** Agrega una passkey. Crea la hoja con su encabezado si falta. */
export async function agregarPasskey(p: Passkey): Promise<void> {
  const id = spreadsheetId();
  const sheets = google.sheets({ version: 'v4', auth: getAuthWrite() });

  const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
  if (!meta.data.sheets?.some((s) => s.properties?.title === HOJA)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: HOJA } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${HOJA}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [ENCABEZADO] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: id,
    range: `${HOJA}!A:D`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[p.id, p.clavePublica, p.dispositivo, p.creada]] },
  });
}
