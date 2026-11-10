import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PagoRegistrado } from './bonosArg';

// Pagos de bonos desde tres fuentes (ADR 0031): proximos-pagos (futuros), la
// ficha de cada bono (últimos pagos) y la hoja PagosBonos. bonistas se simula
// con HTML sintético del mismo formato; los montos son ficticios.

const HOY = '2026-08-15';

function htmlProximos(pagos: object[]): string {
  const next = { props: { pageProps: { initialPayments: pagos } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></html>`;
}

function htmlFicha(familia: string, flowPast: object[]): string {
  const next = { props: { pageProps: { bondData: { bond: { bond_family: familia }, flow: [], flow_past: flowPast } } } };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script></html>`;
}

/** Home de bonistas: lo que devuelve la URL de un bono vencido. */
const HTML_HOME = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { pageJson: {} } } })}</script></html>`;

type Respuestas = Record<string, string | number>; // URL (sufijo) → HTML o status HTTP

function stubFetch(respuestas: Respuestas) {
  const fetchMock = vi.fn(async (url: string) => {
    const clave = Object.keys(respuestas).find((k) => url.endsWith(k));
    const r = clave ? respuestas[clave] : 404;
    if (typeof r === 'number') return new Response('', { status: r });
    return new Response(r, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Los caches del módulo duran 6 horas: cada test importa una instancia limpia.
async function cargar() {
  vi.resetModules();
  return import('./bonosArg');
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('monedaCanonica', () => {
  it('une USD MEP y USD CABLE en USD', async () => {
    const { monedaCanonica } = await cargar();
    expect(monedaCanonica('USD MEP')).toBe('USD');
    expect(monedaCanonica('USD CABLE')).toBe('USD');
    expect(monedaCanonica('ARS')).toBe('ARS');
  });

  it('sin moneda explícita la deduce de la familia', async () => {
    const { monedaCanonica } = await cargar();
    expect(monedaCanonica(undefined, 'BONO-USD-LDNY')).toBe('USD');
    expect(monedaCanonica(undefined, 'BONO-CER')).toBe('ARS');
    expect(monedaCanonica('', null)).toBe('ARS');
  });
});

describe('parsearFichaBono', () => {
  it('lee flow_past y la familia', async () => {
    const { parsearFichaBono } = await cargar();
    const r = parsearFichaBono(htmlFicha('BONO-USD-LDA', [
      { cupon: 0.5, fecha: '2026-01-09', principal: 4, saldo: 100, total: 4.5 },
      { cupon: 'x', fecha: 'malformada', principal: 0 },
    ]));
    expect(r).toEqual({ familia: 'BONO-USD-LDA', pasados: [{ fecha: '2026-01-09', cupon: 0.5, principal: 4 }] });
  });

  it('un bono vencido (redirige a la home) no tiene ficha: null, no error', async () => {
    const { parsearFichaBono } = await cargar();
    expect(parsearFichaBono(HTML_HOME)).toBeNull();
    expect(parsearFichaBono('<html>sin datos</html>')).toBeNull();
  });
});

describe('fetchBonosArg', () => {
  const PROXIMOS = htmlProximos([
    { symbol: 'AL35D', fecha: '2026-09-09', cupon: 2, principal: 0, saldo: 100, total: 2, moneda: 'USD MEP', bond_family: 'BONO-USD-LDA' },
    { symbol: 'TX31', fecha: '2026-11-30', cupon: 1, principal: 10, saldo: 100, total: 11, moneda: 'ARS', bond_family: 'BONO-CER' },
  ]);
  const FICHA_AL35 = htmlFicha('BONO-USD-LDA', [
    { cupon: 2, fecha: '2026-03-09', principal: 0, saldo: 100, total: 2 },
    { cupon: 2, fecha: '2025-09-09', principal: 0, saldo: 100, total: 2 },
  ]);

  it('suma los pagos pasados de la ficha a los futuros de proximos-pagos', async () => {
    stubFetch({ '/proximos-pagos': PROXIMOS, '/AL35D': FICHA_AL35, '/TX31': htmlFicha('BONO-CER', []) });
    const { fetchBonosArg } = await cargar();

    const { eventos, errores } = await fetchBonosArg(
      ['AL35', 'TX31'], '2026-01-01', '2026-12-31',
      { AL35: 1000, TX31: 500 }, { AL35: 50 }, { TX31: 1250 }, 1250, [], HOY,
    );

    expect(errores).toEqual([]);
    expect(eventos.map((e) => [e.ticker, e.tipo, e.fecha])).toEqual([
      ['AL35', 'renta', '2026-03-09'],
      ['AL35', 'renta', '2026-09-09'],
      ['TX31', 'renta', '2026-11-30'],
      ['TX31', 'amortizacion', '2026-11-30'],
    ]);
    // factor = tenencia / precio por 100 = 1000 / 50 = 20; moneda normalizada.
    expect(eventos[0]).toMatchObject({ montoEstimado: 40, monedaMonto: 'USD' });
    // ARS: factor = 500 × 1250 / 1250 = 500.
    expect(eventos[3]).toMatchObject({ montoEstimado: 5000, monedaMonto: 'ARS' });
    expect(eventos.every((e) => e.estimadoAl === undefined)).toBe(true);
  });

  it('un rango enteramente futuro no pide fichas', async () => {
    const fetchMock = stubFetch({ '/proximos-pagos': PROXIMOS });
    const { fetchBonosArg } = await cargar();
    await fetchBonosArg(['AL35'], '2027-01-01', '2027-12-31', {}, {}, {}, null, [], HOY);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('un pago registrado pisa al de la ficha y conserva su monto y fecha de estimación', async () => {
    stubFetch({ '/proximos-pagos': PROXIMOS, '/AL35D': FICHA_AL35 });
    const { fetchBonosArg } = await cargar();
    const registrado: PagoRegistrado = {
      ticker: 'AL35', fecha: '2026-03-09', moneda: 'USD', cupon: 2, principal: 0,
      cobroRenta: 33, cobroAmort: null, registrado: '2026-03-02',
    };

    const { eventos } = await fetchBonosArg(
      ['AL35'], '2026-01-01', '2026-06-30', { AL35: 1000 }, { AL35: 50 }, {}, null, [registrado], HOY,
    );

    expect(eventos).toEqual([
      expect.objectContaining({ fecha: '2026-03-09', montoEstimado: 33, estimadoAl: '2026-03-02' }),
    ]);
  });

  it('muestra los registrados de bonos que ya no están en la cartera', async () => {
    stubFetch({ '/proximos-pagos': PROXIMOS });
    const { fetchBonosArg } = await cargar();
    const vencido: PagoRegistrado = {
      ticker: 'ZZZ27', fecha: '2026-06-30', moneda: 'ARS', cupon: 0, principal: 150,
      cobroRenta: null, cobroAmort: 9000, registrado: '2026-06-22',
    };

    const { eventos } = await fetchBonosArg([], '2026-01-01', '2026-12-31', {}, {}, {}, null, [vencido], HOY);

    expect(eventos).toEqual([
      expect.objectContaining({ ticker: 'ZZZ27', tipo: 'amortizacion', montoEstimado: 9000, monedaMonto: 'ARS' }),
    ]);
  });

  it('para un pago futuro gana proximos-pagos sobre el registrado', async () => {
    stubFetch({ '/proximos-pagos': PROXIMOS, '/AL35D': FICHA_AL35 });
    const { fetchBonosArg } = await cargar();
    const anticipado: PagoRegistrado = {
      ticker: 'AL35', fecha: '2026-09-09', moneda: 'USD', cupon: 1.9, principal: 0,
      cobroRenta: 1, cobroAmort: null, registrado: '2026-09-01',
    };

    const { eventos } = await fetchBonosArg(
      ['AL35'], '2026-09-01', '2026-09-30', { AL35: 1000 }, { AL35: 50 }, {}, null, [anticipado], HOY,
    );

    expect(eventos).toEqual([expect.objectContaining({ fecha: '2026-09-09', montoEstimado: 40 })]);
    expect(eventos[0].estimadoAl).toBeUndefined();
  });

  it('si fallan las fuentes de bonistas, los registrados salen igual y el error se informa', async () => {
    stubFetch({ '/proximos-pagos': 503, '/AL35D': 500 });
    const { fetchBonosArg } = await cargar();
    const registrado: PagoRegistrado = {
      ticker: 'AL35', fecha: '2026-03-09', moneda: 'USD', cupon: 2, principal: 0,
      cobroRenta: 33, cobroAmort: null, registrado: '2026-03-02',
    };

    const { eventos, errores } = await fetchBonosArg(
      ['AL35'], '2026-01-01', '2026-12-31', {}, {}, {}, null, [registrado], HOY,
    );

    expect(eventos).toHaveLength(1);
    expect(errores).toEqual([
      'bonistas.com ficha AL35D: HTTP 500',
      'bonistas.com: HTTP 503',
    ]);
  });
});
