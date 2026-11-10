import { beforeEach, describe, expect, it, vi } from 'vitest';

// Nasdaq indexa su calendario por fecha EX-dividendo; el calendario ubica cada
// dividendo en su fecha de PAGO. Respuestas sintéticas con el formato de Nasdaq.

const AHORA = new Date('2026-11-09T12:00:00Z'); // lunes

function fila(symbol: string, ex: string, pago: string, rate = 0.5) {
  const us = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${m}/${d}/${y}`;
  };
  return { symbol, companyName: '', dividend_Ex_Date: us(ex), payment_Date: us(pago), dividend_Rate: rate, announcement_Date: '' };
}

function stubNasdaq(porFechaEx: Record<string, object[]>) {
  const fetchMock = vi.fn(async (url: string) => {
    const fecha = new URL(url).searchParams.get('date')!;
    return new Response(JSON.stringify({ data: { calendar: { rows: porFechaEx[fecha] ?? [] } } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function cargar() {
  vi.resetModules(); // el cache por día es del módulo
  return import('./dividendosFuturos');
}

beforeEach(() => vi.unstubAllGlobals());

describe('diasABarrer', () => {
  it('arranca DIAS_ATRAS_EX antes de hoy y saltea fines de semana', async () => {
    const { diasABarrer, DIAS_ATRAS_EX } = await cargar();
    const dias = diasABarrer('2026-11-09', '2026-11-15', AHORA);
    expect(dias[0] >= new Date(AHORA.getTime() - DIAS_ATRAS_EX * 86_400_000).toISOString().slice(0, 10)).toBe(true);
    expect(dias[0] < '2026-11-09').toBe(true);
    expect(dias.at(-1)).toBe('2026-11-13'); // viernes; sábado y domingo no
    expect(dias.every((d) => ![0, 6].includes(new Date(d + 'T00:00:00Z').getUTCDay()))).toBe(true);
  });

  it('un rango de pago ya lejano no barre nada', async () => {
    const { diasABarrer } = await cargar();
    expect(diasABarrer('2025-01-01', '2025-12-31', AHORA)).toEqual([]);
  });
});

describe('fetchDividendosFuturos', () => {
  it('encuentra un dividendo con fecha ex pasada y pago esta semana (caso de la alerta semanal)', async () => {
    stubNasdaq({ '2026-10-28': [fila('KO', '2026-10-28', '2026-11-12')] });
    const { fetchDividendosFuturos } = await cargar();

    const evs = await fetchDividendosFuturos(['KO'], '2026-11-09', '2026-11-15', { KO: 1000 }, { KO: 50 }, AHORA);

    expect(evs).toEqual([expect.objectContaining({
      ticker: 'KO', tipo: 'dividendo-fut', fecha: '2026-11-12', fechaEx: '2026-10-28', monedaMonto: 'USD',
    })]);
  });

  it('uno ya pagado sale como dividendo, en su fecha de pago', async () => {
    stubNasdaq({ '2026-10-15': [fila('KO', '2026-10-15', '2026-11-02')] });
    const { fetchDividendosFuturos } = await cargar();

    const evs = await fetchDividendosFuturos(['KO'], '2026-01-01', '2026-12-31', {}, {}, AHORA);

    expect(evs).toEqual([expect.objectContaining({ tipo: 'dividendo', fecha: '2026-11-02', detalle: 'Pagado · ex 15/10' })]);
  });

  it('filtra por fecha de pago, no por fecha ex', async () => {
    stubNasdaq({ '2026-11-10': [fila('KO', '2026-11-10', '2026-12-01')] });
    const { fetchDividendosFuturos } = await cargar();

    expect(await fetchDividendosFuturos(['KO'], '2026-11-09', '2026-11-15', {}, {}, AHORA)).toEqual([]);
  });
});
