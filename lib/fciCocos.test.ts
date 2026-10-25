import { describe, it, expect, vi, afterEach } from 'vitest';

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
  '<row r="2789">' +
  celda('A2789', 'Cocos Rendimiento - Clase A', true) +
  celda('B2789', 'ARS', true) +
  celda('D2789', 'Med', true) +
  celda('E2789', '30/07/26', true) +
  celda('F2789', '11459.416', false) +
  celda('H2789', '0.052', false) +
  celda('J2789', '1.614', false) +
  celda('K2789', '14.276', false) +
  celda('L2789', '32.188', false) +
  celda('O2789', '266846461064.28', false) +
  '</row>' +
  // Fondo rezagado: la planilla real lo publica con la fecha del día hábil
  // anterior y TODAS las columnas de comparación vacías (sin VCP previo, sin
  // variación diaria, sin mes/año/12m). Trae solo VCP y patrimonio.
  '<row r="1834">' +
  celda('A1834', 'Cocos Dólares Plus - Clase A', true) +
  celda('B1834', 'USD', true) +
  celda('D1834', 'Lar', true) +
  celda('E1834', '29/07/26', true) +
  celda('F1834', '1061.516', false) +
  celda('O1834', '269865984.44', false) +
  '</row>' +
  // Fondo de acciones del broker: el Sheet lo clasifica como renta variable,
  // así que sale por fetchFciMetricsRentaVariable, no por fetchFciMetrics.
  '<row r="99">' +
  celda('A99', 'Cocos Acciones - Clase A', true) +
  celda('B99', 'ARS', true) +
  celda('D99', 'Lar', true) +
  celda('E99', '30/07/26', true) +
  celda('F99', '1432.901', false) +
  celda('H99', '3.780', false) +
  celda('J99', '4.254', false) +
  celda('K99', '0.547', false) +
  celda('L99', '46.560', false) +
  celda('O99', '4556874110.51', false) +
  '</row>' +
  '<row r="9000">' +
  celda('A9000', 'Otro Fondo No-Cocos - Clase A', true) +
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

  it('parsea VCP y rendimientos del fondo mapeado, ignorando fondos de otras gestoras', async () => {
    const xlsxBuf = buildXlsxFixture(SHEET_XML);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => xlsxBuf.buffer.slice(xlsxBuf.byteOffset, xlsxBuf.byteOffset + xlsxBuf.byteLength),
    }));

    const { fetchFciMetrics } = await import('./fciCocos');
    const metrics = await fetchFciMetrics();

    expect(metrics.size).toBe(2); // COCORMA y COCOUSDPA; COCOACCA no es de tipo FCI y los otros 2 no están en el fixture
    const rma = metrics.get('COCORMA');
    expect(rma).toBeDefined();
    expect(rma?.nombreFondo).toBe('Cocos Rendimiento - Clase A');
    expect(rma?.moneda).toBe('ARS');
    expect(rma?.vcp).toBeCloseTo(11459.416);
    expect(rma?.variacionDiaria).toBeCloseTo(0.00052);
    expect(rma?.rendimientoMes).toBeCloseTo(0.01614);
    expect(rma?.rendimiento12Meses).toBeCloseTo(0.32188);
    expect(rma?.patrimonio).toBeCloseTo(266846461064.28);
  });

  it('propaga error si la respuesta HTTP no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { fetchFciMetrics } = await import('./fciCocos');
    await expect(fetchFciMetrics()).rejects.toThrow('503');
  });

  // Regresión: con celdas vacías leídas como 0, un fondo en dólares mostraba
  // 0,0% en diaria/mes/año/12m — un dato falso y verosímil a la vez.
  it('deja los rendimientos en null (no en 0) cuando la planilla no los publica', async () => {
    stubPlanilla();
    const { fetchFciMetrics } = await import('./fciCocos');
    const plus = (await fetchFciMetrics()).get('COCOUSDPA');

    expect(plus).toBeDefined();
    expect(plus?.vcp).toBeCloseTo(1061.516); // el VCP sí viene
    expect(plus?.variacionDiaria).toBeNull();
    expect(plus?.rendimientoMes).toBeNull();
    expect(plus?.rendimientoAnio).toBeNull();
    expect(plus?.rendimiento12Meses).toBeNull();
  });

  // Regresión: COCOUSDPA llega sin 12 meses de CAFCI (rezagado), pero el VCP
  // de hace 12 meses existe en el espejo de argentinadatos. Antes de este test
  // el fondo quedaba en "s/d" para esa columna aunque el dato fuera obtenible.
  it('completa el 12 meses de un fondo rezagado con el espejo de argentinadatos, y lo marca como estimado', async () => {
    const FONDO_PLUS = 'Cocos Dólares Plus - Clase A';
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
      // COCOUSDPA en el fixture (fila 1834) tiene fecha 29/07/26: hace 12 meses es 2025-07-29.
      if (url.includes('/rentaFija/2025/7/29')) {
        return { ok: true, status: 200, json: async () => [...relleno, { fondo: FONDO_PLUS, fecha: '2025-07-29', vcp: 1014.23 }] };
      }
      return { ok: false, status: 404 };
    }));

    const { fetchFciMetrics } = await import('./fciCocos');
    const plus = (await fetchFciMetrics()).get('COCOUSDPA');

    expect(plus?.variacionDiaria).toBeNull();     // sigue sin dato: esta fuente solo completa 12 meses
    expect(plus?.rendimientoMes).toBeNull();
    expect(plus?.rendimientoAnio).toBeNull();
    expect(plus?.vcp).toBeCloseTo(1061.516);
    expect(plus?.rendimiento12Meses).toBeCloseTo(1061.516 / 1014.23 - 1, 6);
    expect(plus?.rendimiento12MesesEstimado).toBe(true);

    // Un fondo que ya tiene 12 meses de CAFCI no se toca ni se marca como estimado.
    const rma = (await fetchFciMetrics()).get('COCORMA');
    expect(rma?.rendimiento12MesesEstimado).toBe(false);
  });

  it('marca como rezagado solo al fondo con fecha anterior a la última de la planilla', async () => {
    stubPlanilla();
    const { fetchFciMetrics } = await import('./fciCocos');
    const metrics = await fetchFciMetrics();

    expect(metrics.get('COCOUSDPA')?.rezagado).toBe(true);  // 29/07, la planilla va al 30/07
    expect(metrics.get('COCOUSDPA')?.fecha).toBe('29/07/26');
    expect(metrics.get('COCORMA')?.rezagado).toBe(false);
  });

  it('distingue un 0 informado de una celda vacía', async () => {
    const xml = SHEET_XML.replace(
      celda('H2789', '0.052', false),
      celda('H2789', '0.000', false),
    );
    const buf = buildXlsxFixture(xml);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    }));

    const { fetchFciMetrics } = await import('./fciCocos');
    // Un 0 que la planilla sí informa se conserva como 0, no se vuelve null:
    // "no se movió" es un dato, "no lo publicaron" es otro.
    expect((await fetchFciMetrics()).get('COCORMA')?.variacionDiaria).toBe(0);
  });
});

describe('fetchFciMetricsRentaVariable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('devuelve el fondo de acciones y lo deja fuera del conjunto de FCI', async () => {
    stubPlanilla();
    const { fetchFciMetrics, fetchFciMetricsRentaVariable } = await import('./fciCocos');

    const variable = await fetchFciMetricsRentaVariable();
    const acca = variable.get('COCOACCA');
    expect(acca?.nombreFondo).toBe('Cocos Acciones - Clase A');
    expect(acca?.moneda).toBe('ARS');
    expect(acca?.vcp).toBeCloseTo(1432.901);
    expect(acca?.variacionDiaria).toBeCloseTo(0.0378);
    expect(acca?.rendimientoMes).toBeCloseTo(0.04254);
    expect(acca?.rendimiento12Meses).toBeCloseTo(0.4656);

    // La pestaña de FCI tiene que seguir contando solo los fondos de tipo FCI.
    expect((await fetchFciMetrics()).has('COCOACCA')).toBe(false);
  });
});
