import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardData, TenenciaActual } from '@/types';

// Registro de pagos de bonos en la hoja PagosBonos (ADR 0031). Google y
// bonistas se simulan: nada de esto toca un Sheet real. Datos ficticios.

const api = vi.hoisted(() => ({
  get: vi.fn(),
  append: vi.fn(),
  batchUpdate: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {}, JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        batchUpdate: api.batchUpdate,
        values: { get: api.get, append: api.append },
      },
    }),
  },
}));

const bonistas = vi.hoisted(() => ({ pagosDeBonistas: vi.fn() }));
vi.mock('./bonosArg', async (original) => ({
  ...(await original<typeof import('./bonosArg')>()),
  pagosDeBonistas: bonistas.pagosDeBonistas,
}));

vi.mock('./precios', () => ({
  preciosBonos: async () => ({ AL35: 50 }),
  preciosBonosArs: async () => ({}),
  mepSpot: async () => 1250,
}));

import { parsearFila, pagosNuevos, registrarPagosBonos } from './pagosBonos';

const AHORA = new Date('2026-08-17T00:00:00Z');

function data(tickers: Record<string, number>): DashboardData {
  const items = Object.entries(tickers).map(([ticker, usd]) => ({
    ticker, tenencia_usd: usd, tenencia_ars: 0, fechaTs: 0, fechaMes: '2026-08',
    TIPO: 'BONO', RIESGO: 1, SECTOR_GEO: 'ARG', RENTA: 'Fija',
  })) as unknown as TenenciaActual[];
  return { tenenciasPorMes: { '2026-07': [], '2026-08': items } } as unknown as DashboardData;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SPREADSHEET_ID = 'sheet-de-prueba';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'service-account@example.com',
    private_key: 'clave-ficticia',
  });
  api.append.mockResolvedValue({});
  api.batchUpdate.mockResolvedValue({});
  bonistas.pagosDeBonistas.mockResolvedValue({
    pagos: [
      { ticker: 'AL35', fecha: '2026-08-10', moneda: 'USD', cupon: 2, principal: 0, origen: 'ficha' },
      { ticker: 'AL35', fecha: '2026-08-24', moneda: 'USD', cupon: 2, principal: 1, origen: 'proximos' },
    ],
    errores: [],
  });
});

describe('parsearFila', () => {
  it('lee números y fechas tal como se escriben', () => {
    expect(parsearFila(['al35', '2026-08-10', 'USD', 2, 0, 40, '', '2026-08-03'])).toEqual({
      ticker: 'AL35', fecha: '2026-08-10', moneda: 'USD', cupon: 2, principal: 0,
      cobroRenta: 40, cobroAmort: null, registrado: '2026-08-03',
    });
  });

  it('acepta coma decimal si la fila se editó a mano', () => {
    expect(parsearFila(['AL35', '2026-08-10', 'USD', '2,5', '0', '', '', ''])).toMatchObject({
      cupon: 2.5, registrado: '2026-08-10',
    });
  });

  it.each([
    [['', '2026-08-10', 'USD', 2, 0]],
    [['AL35', '10/08/2026', 'USD', 2, 0]],
    [['AL35', '2026-08-10', 'USD', 0, 0]],
  ])('descarta filas malformadas: %j', (fila) => {
    expect(parsearFila(fila)).toBeNull();
  });
});

describe('pagosNuevos', () => {
  it('deja afuera lo ya registrado y los duplicados', () => {
    const p = (fecha: string) => ({ ticker: 'AL35', fecha, moneda: 'USD' as const, cupon: 1, principal: 0, origen: 'ficha' as const });
    expect(pagosNuevos([p('2026-01-01'), p('2026-02-01'), p('2026-02-01')], [{ ticker: 'AL35', fecha: '2026-01-01' }]))
      .toEqual([p('2026-02-01')]);
  });
});

describe('registrarPagosBonos', () => {
  it('pide la ventana hacia atrás y adelante, y agrega solo los pagos nuevos', async () => {
    api.get.mockResolvedValue({ data: { values: [
      ['TICKER', 'FECHA', 'MONEDA', 'RENTA_100', 'AMORT_100', 'COBRO_RENTA', 'COBRO_AMORT', 'REGISTRADO'],
      ['AL35', '2026-08-10', 'USD', 2, 0, 38, '', '2026-08-03'],
    ] } });

    const r = await registrarPagosBonos(data({ AL35: 1000 }), AHORA);

    expect(bonistas.pagosDeBonistas).toHaveBeenCalledWith(['AL35'], '2026-08-03', '2026-08-27', '2026-08-17');
    expect(r).toMatchObject({ registrados: 1, errores: [] });
    expect(api.batchUpdate).not.toHaveBeenCalled();
    // factor = 1000 / 50 = 20
    expect(api.append.mock.calls[0][0].requestBody.values).toEqual([
      ['AL35', '2026-08-24', 'USD', 2, 1, 40, 20, '2026-08-16'],
    ]);
  });

  it('si la hoja no existe la crea con encabezado', async () => {
    api.get.mockRejectedValue(new Error('Unable to parse range: PagosBonos!A:H'));

    await registrarPagosBonos(data({ AL35: 1000 }), AHORA);

    expect(api.batchUpdate).toHaveBeenCalledTimes(1);
    const valores = api.append.mock.calls[0][0].requestBody.values;
    expect(valores[0][0]).toBe('TICKER');
    expect(valores).toHaveLength(3);
  });

  it('si no se puede leer lo que hay, no escribe nada (ADR 0029)', async () => {
    api.get.mockRejectedValue(new Error('Quota exceeded for quota metric'));

    await expect(registrarPagosBonos(data({ AL35: 1000 }), AHORA)).rejects.toThrow('Quota exceeded');
    expect(api.append).not.toHaveBeenCalled();
  });

  it('sin bonos en la cartera no consulta nada', async () => {
    const r = await registrarPagosBonos(data({ AAPL: 1000 }), AHORA);
    expect(r.registrados).toBe(0);
    expect(api.get).not.toHaveBeenCalled();
    expect(bonistas.pagosDeBonistas).not.toHaveBeenCalled();
  });
});
