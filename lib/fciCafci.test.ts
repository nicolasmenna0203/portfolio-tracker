import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { readSheetMock } = vi.hoisted(() => ({ readSheetMock: vi.fn() }));
vi.mock('./sheets', () => ({ readSheet: readSheetMock }));

const FILAS_FONDOS = [
  { TICKER: 'FDOUNO',   NOMBRE_CAFCI: 'Fondo Demo Uno - Clase A',    RENTA_VARIABLE: 'NO', CATEGORIA_HISTORICO: '' },
  { TICKER: 'FDODOS',  NOMBRE_CAFCI: 'Fondo Demo Dos - Clase A', RENTA_VARIABLE: 'NO', CATEGORIA_HISTORICO: '' },
  { TICKER: 'FDOTRES', NOMBRE_CAFCI: 'Fondo Demo Tres - Clase A',   RENTA_VARIABLE: 'NO', CATEGORIA_HISTORICO: 'rentaFija' },
  { TICKER: 'FDOCUATRO',   NOMBRE_CAFCI: 'Fondo Demo Cuatro - Clase A',     RENTA_VARIABLE: 'NO', CATEGORIA_HISTORICO: '' },
  { TICKER: 'FDOCINCO',   NOMBRE_CAFCI: 'Fondo Demo Cinco - Clase A',       RENTA_VARIABLE: 'SI', CATEGORIA_HISTORICO: '' },
];

beforeEach(() => {
  vi.stubEnv('SPREADSHEET_ID', 'sheet-de-test');
  readSheetMock.mockReset();
  readSheetMock.mockResolvedValue(FILAS_FONDOS);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── Fixture: .xlsx mínimo construido a mano (ZIP sin comprimir + XML de una sola hoja) ──
// Mismo formato de fila/celda que la Planilla Diaria real de CAFCI: celdas de
// texto inline (t="str"), columna A nombre de fondo+clase, B moneda, D horizonte,
// E fecha, F VCP, H var% diaria, J/K/L rendimientos, O patrimonio.

function crc32(buf: Buffer): number {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function buildXlsxFixture(sheetXml: string): Buffer {
  const content = Buffer.from(sheetXml, 'utf8');
  const name = Buffer.from('xl/worksheets/sheet1.xml', 'utf8');
  const crc = crc32(content);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(0, 8); // stored, sin compresión
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(content.length, 18);
  localHeader.writeUInt32LE(content.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const local = Buffer.concat([localHeader, name, content]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10); // stored
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // localHeaderOffset
  const centralEntry = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, centralEntry, eocd]);
}

function celda(ref: string, valor: string, esTexto: boolean): string {
  return esTexto
    ? `<c r="${ref}" t="str"><v>${valor}</v></c>`
    : `<c r="${ref}"><v>${valor}</v></c>`;
}

const SHEET_XML =
  '<?xml version="1.0"?><worksheet><sheetData>' +
  '<row r="8">' +
  celda('A8', 'Fondo', true) + celda('B8', 'Moneda', true) +
  '</row>' +
  '<row r="12">' +
  celda('A12', 'Fondo Demo Uno - Clase A', true) +
  celda('B12', 'ARS', true) +
  celda('D12', 'Med', true) +
  celda('E12', '30/07/26', true) +
  celda('F12', '2000.5', false) +
  celda('H12', '0.05', false) +
  celda('J12', '1.6', false) +
  celda('K12', '14', false) +
  celda('L12', '32', false) +
  celda('O12', '123456789.12', false) +
  '</row>' +
  // Fondo rezagado: la planilla real lo publica con la fecha del día hábil
  // anterior y TODAS las columnas de comparación vacías (sin VCP previo, sin
  // variación diaria, sin mes/año/12m). Trae solo VCP y patrimonio.
  '<row r="34">' +
  celda('A34', 'Fondo Demo Tres - Clase A', true) +
  celda('B34', 'USD', true) +
  celda('D34', 'Lar', true) +
  celda('E34', '29/07/26', true) +
  celda('F34', '1100', false) +
  celda('O34', '98765432.1', false) +
  '</row>' +
  // Fondo de acciones del broker: el Sheet lo clasifica como renta variable,
  // así que sale por fetchFciMetricsRentaVariable, no por fetchFciMetrics.
  '<row r="99">' +
  celda('A99', 'Fondo Demo Cinco - Clase A', true) +
  celda('B99', 'ARS', true) +
  celda('D99', 'Lar', true) +
  celda('E99', '30/07/26', true) +
  celda('F99', '1500.25', false) +
  celda('H99', '3.7', false) +
  celda('J99', '4.2', false) +
  celda('K99', '0.5', false) +
  celda('L99', '46', false) +
  celda('O99', '55555555.55', false) +
  '</row>' +
  '<row r="9000">' +
  celda('A9000', 'Otro Fondo Ajeno - Clase A', true) +
  celda('F9000', '1000', false) +
  '</row>' +
  '</sheetData></worksheet>';

function stubPlanilla(): void {
  const xlsxBuf = buildXlsxFixture(SHEET_XML);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
  }));
}

describe('fetchFciMetrics', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('con la hoja de fondos vacía no descarga la planilla y devuelve vacío', async () => {
    readSheetMock.mockResolvedValue([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { fetchFciMetrics } = await import('./fciCafci');
    expect((await fetchFciMetrics()).size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  // Un corte del Sheet no puede leerse como "no tenés fondos": cada consumidor
  // ya maneja el error y lo muestra.
  it('si no se puede leer la hoja de fondos, propaga el error', async () => {
    readSheetMock.mockRejectedValue(new Error('Sheets caído'));
    const { fetchFciMetrics } = await import('./fciCafci');
    await expect(fetchFciMetrics()).rejects.toThrow('Sheets caído');
  });

  it('parsea VCP y rendimientos del fondo mapeado, ignorando fondos de otras gestoras', async () => {
    const xlsxBuf = buildXlsxFixture(SHEET_XML);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
    }));

    const { fetchFciMetrics } = await import('./fciCafci');
    const metrics = await fetchFciMetrics();

    expect(metrics.size).toBe(2); // FDOUNO y FDOTRES; FDOCINCO no es de tipo FCI y los otros 2 no están en el fixture
    const uno = metrics.get('FDOUNO');
    expect(uno).toBeDefined();
    expect(uno?.nombreFondo).toBe('Fondo Demo Uno - Clase A');
    expect(uno?.moneda).toBe('ARS');
    expect(uno?.vcp).toBeCloseTo(2000.5);
    expect(uno?.variacionDiaria).toBeCloseTo(0.0005);
    expect(uno?.rendimientoMes).toBeCloseTo(0.016);
    expect(uno?.rendimiento12Meses).toBeCloseTo(0.32);
    expect(uno?.patrimonio).toBeCloseTo(123456789.12);
  });

  it('propaga error si la respuesta HTTP no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { fetchFciMetrics } = await import('./fciCafci');
    await expect(fetchFciMetrics()).rejects.toThrow('503');
  });

  // Regresión: con celdas vacías leídas como 0, un fondo en dólares mostraba
  // 0,0% en diaria/mes/año/12m — un dato falso y verosímil a la vez.
  it('deja los rendimientos en null (no en 0) cuando la planilla no los publica', async () => {
    stubPlanilla();
    const { fetchFciMetrics } = await import('./fciCafci');
    const tres = (await fetchFciMetrics()).get('FDOTRES');

    expect(tres).toBeDefined();
    expect(tres?.vcp).toBeCloseTo(1100); // el VCP sí viene
    expect(tres?.variacionDiaria).toBeNull();
    expect(tres?.rendimientoMes).toBeNull();
    expect(tres?.rendimientoAnio).toBeNull();
    expect(tres?.rendimiento12Meses).toBeNull();
  });

  // Regresión: FDOTRES llega sin 12 meses de CAFCI (rezagado), pero el VCP
  // de hace 12 meses existe en el espejo de argentinadatos. Antes de este test
  // el fondo quedaba en "s/d" para esa columna aunque el dato fuera obtenible.
  it('completa el 12 meses de un fondo rezagado con el espejo de argentinadatos, y lo marca como estimado', async () => {
    const FONDO_TRES = 'Fondo Demo Tres - Clase A';
    const relleno = Array.from({ length: 500 }, (_, i) => ({ fondo: `Relleno ${i}`, fecha: '2025-07-29', vcp: 100 + i }));
    const xlsxBuf = buildXlsxFixture(SHEET_XML);

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('api.pub.cafci.org.ar')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
        };
      }
      // FDOTRES en el fixture (fila 34) tiene fecha 29/07/26: hace 12 meses es 2025-07-29.
      if (url.includes('/rentaFija/2025/7/29')) {
        return { ok: true, status: 200, json: async () => [...relleno, { fondo: FONDO_TRES, fecha: '2025-07-29', vcp: 1000 }] };
      }
      return { ok: false, status: 404 };
    }));

    const { fetchFciMetrics } = await import('./fciCafci');
    const tres = (await fetchFciMetrics()).get('FDOTRES');

    expect(tres?.variacionDiaria).toBeNull();     // sigue sin dato: esta fuente solo completa 12 meses
    expect(tres?.rendimientoMes).toBeNull();
    expect(tres?.rendimientoAnio).toBeNull();
    expect(tres?.vcp).toBeCloseTo(1100);
    expect(tres?.rendimiento12Meses).toBeCloseTo(1100 / 1000 - 1, 6);
    expect(tres?.rendimiento12MesesEstimado).toBe(true);

    // Un fondo que ya tiene 12 meses de CAFCI no se toca ni se marca como estimado.
    const uno = (await fetchFciMetrics()).get('FDOUNO');
    expect(uno?.rendimiento12MesesEstimado).toBe(false);
  });

  it('marca como rezagado solo al fondo con fecha anterior a la última de la planilla', async () => {
    stubPlanilla();
    const { fetchFciMetrics } = await import('./fciCafci');
    const metrics = await fetchFciMetrics();

    expect(metrics.get('FDOTRES')?.rezagado).toBe(true);  // 29/07, la planilla va al 30/07
    expect(metrics.get('FDOTRES')?.fecha).toBe('29/07/26');
    expect(metrics.get('FDOUNO')?.rezagado).toBe(false);
  });

  it('distingue un 0 informado de una celda vacía', async () => {
    const xml = SHEET_XML.replace(
      celda('H12', '0.05', false),
      celda('H12', '0.000', false),
    );
    const buf = buildXlsxFixture(xml);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }));

    const { fetchFciMetrics } = await import('./fciCafci');
    // Un 0 que la planilla sí informa se conserva como 0, no se vuelve null:
    // "no se movió" es un dato, "no lo publicaron" es otro.
    expect((await fetchFciMetrics()).get('FDOUNO')?.variacionDiaria).toBe(0);
  });
});

describe('fetchFciMetricsRentaVariable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('devuelve el fondo de acciones y lo deja fuera del conjunto de FCI', async () => {
    stubPlanilla();
    const { fetchFciMetrics, fetchFciMetricsRentaVariable } = await import('./fciCafci');

    const variable = await fetchFciMetricsRentaVariable();
    const cinco = variable.get('FDOCINCO');
    expect(cinco?.nombreFondo).toBe('Fondo Demo Cinco - Clase A');
    expect(cinco?.moneda).toBe('ARS');
    expect(cinco?.vcp).toBeCloseTo(1500.25);
    expect(cinco?.variacionDiaria).toBeCloseTo(0.037);
    expect(cinco?.rendimientoMes).toBeCloseTo(0.042);
    expect(cinco?.rendimiento12Meses).toBeCloseTo(0.46);

    // La pestaña de FCI tiene que seguir contando solo los fondos de tipo FCI.
    expect((await fetchFciMetrics()).has('FDOCINCO')).toBe(false);
  });
});
