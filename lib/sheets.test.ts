import { beforeEach, describe, expect, it, vi } from 'vitest';

// fetchDashboardData contra un Sheet simulado con datos ficticios.

const hojas = vi.hoisted(() => ({ valores: {} as Record<string, string[][]> }));

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: class {}, JWT: class {} },
    sheets: () => ({
      spreadsheets: {
        values: {
          get: async ({ range }: { range: string }) => ({ data: { values: hojas.valores[range.split('!')[0]] ?? [] } }),
        },
      },
    }),
  },
}));

import { fetchDashboardData } from './sheets';

function sheet(movimientos: string[][]) {
  hojas.valores = {
    Activos: [['TICKER', 'BROKER', 'TIPO', 'RIESGO', 'SECTOR GEO', 'RENTA', 'MONEDA'], ['KO', 'X', 'CEDEAR', '2', 'USA', 'Variable', 'USD']],
    Movimientos: [['Fecha', 'Monto (USD)', 'Monto (ARS)', 'Ingreso/Salida'], ...movimientos],
    Tenencias: [
      ['Ticker', 'Tenencia (ARS)', 'Tenencia (USD)', 'Fecha'],
      ['KO', '1000000', '1000', '31/01/2025'],
      ['KO', '1100000', '1100', '28/02/2025'],
    ],
  };
}

beforeEach(() => {
  process.env.SPREADSHEET_ID = 'sheet-de-prueba';
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'sa@example.com', private_key: 'clave-ficticia' });
});

describe('fetchDashboardData: movimientos', () => {
  it('un tipo que no es ingreso ni salida falla con la fila, en vez de tomarlo como salida', async () => {
    sheet([
      ['10/01/2025', '1000', '1000000', 'Ingreso'],
      ['10/02/2025', '50', '50000', 'Ingrso'],
    ]);
    await expect(fetchDashboardData()).rejects.toThrow('Movimientos, fila 3');
  });

  it('acepta mayúsculas y espacios', async () => {
    sheet([[' 10/01/2025', '1000', '1000000', ' INGRESO ']]);
    const d = await fetchDashboardData();
    expect(d.movimientos[0].monto_neto).toBe(1000);
  });

  it('la TIR fecha el valor final al cierre del último mes, no hoy (ADR 0032)', async () => {
    sheet([['01/01/2025', '1000', '1000000', 'Ingreso']]);
    const d = await fetchDashboardData();
    // 1000 → 1100 entre el 1/1 y el 28/2/2025: ~10% en 58 días, muy por encima
    // de lo que daría estirar ese 10% hasta hoy.
    expect(d.kpis.tirAnual!).toBeGreaterThan(70);
  });
});
