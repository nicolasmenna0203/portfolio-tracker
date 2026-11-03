import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TenenciaActual } from '@/types';

const fetchFciMetricsMock = vi.fn();
vi.mock('./fciCafci', () => ({
  fetchFciMetrics: () => fetchFciMetricsMock(),
}));

const { calcularVariacionSemanal } = await import('./variacionSemanal');

function tenencia(ticker: string, extra: Partial<TenenciaActual> = {}): TenenciaActual {
  return {
    ticker,
    tenencia_ars: 0,
    tenencia_usd: 1000,
    fechaTs: Date.UTC(2026, 6, 1),
    fechaMes: '2026-07',
    TIPO: 'ACCION',
    RIESGO: 3,
    SECTOR_GEO: 'USA',
    RENTA: 'Variable',
    MONEDA: 'USD',
    ...extra,
  };
}

/** Serie diaria de MEP como la devuelve argentinadatos. */
function respMep(puntos: [string, number][]) {
  return { ok: true, json: async () => puntos.map(([fecha, venta]) => ({ casa: 'bolsa', compra: venta - 5, venta, fecha })) };
}

/** Serie diaria de closes como la devuelve el chart de Yahoo. */
function respYahoo(puntos: [string, number][]) {
  return {
    ok: true,
    json: async () => ({
      chart: {
        result: [{
          timestamp: puntos.map(([f]) => Date.parse(f + 'T00:00:00Z') / 1000),
          indicators: { quote: [{ close: puntos.map(([, c]) => c) }] },
        }],
      },
    }),
  };
}

/** Serie diaria OHLC como la devuelve data912 /historical/bonds. */
function respData912(puntos: [string, number][]) {
  return { ok: true, json: async () => puntos.map(([date, c]) => ({ date, o: c, h: c, l: c, c, v: 1000, dr: 0, sa: 0.4 })) };
}

beforeEach(() => {
  fetchFciMetricsMock.mockReset();
  fetchFciMetricsMock.mockResolvedValue(new Map());
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 7, 6)); // 2026-08-06
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Enruta cada fetch según la URL, así el orden de las llamadas no importa. */
function ruteo(handlers: { mep?: unknown; yahoo?: unknown; data912?: Record<string, unknown> }) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes('argentinadatos')) return Promise.resolve(handlers.mep ?? { ok: false, status: 503 });
    if (url.includes('yahoo')) return Promise.resolve(handlers.yahoo ?? { ok: false, status: 404 });
    if (url.includes('data912')) {
      const simbolo = url.split('/').pop() as string;
      const h = handlers.data912?.[simbolo];
      return Promise.resolve(h ?? { ok: false, status: 404 });
    }
    return Promise.resolve({ ok: false, status: 404 });
  });
}

describe('calcularVariacionSemanal', () => {
  it('calcula la variación en USD de una acción sobre el close de hace 7 días', async () => {
    ruteo({
      mep: respMep([['2026-07-30', 1500], ['2026-08-05', 1500]]),
      yahoo: respYahoo([['2026-07-30', 100], ['2026-08-05', 110]]),
    });

    const r = await calcularVariacionSemanal([tenencia('AAPL')]);
    const aapl = r.grupos[0].activos[0];

    expect(aapl.ticker).toBe('AAPL');
    expect(aapl.variacionUsd).toBeCloseTo(0.10, 6);
  });

  it('la variación en ARS combina el movimiento del activo y el del MEP', async () => {
    // Acción plana en USD, pero el MEP sube 10%: en pesos la posición subió 10%.
    ruteo({
      mep: respMep([['2026-07-30', 1000], ['2026-08-05', 1100]]),
      yahoo: respYahoo([['2026-07-30', 100], ['2026-08-05', 100]]),
    });

    const r = await calcularVariacionSemanal([tenencia('AAPL')]);
    const aapl = r.grupos[0].activos[0];

    expect(aapl.variacionUsd).toBeCloseTo(0, 6);
    expect(aapl.variacionArs).toBeCloseTo(0.10, 6);
    expect(r.variacionMep).toBeCloseTo(0.10, 6);
  });

  it('usa el MEP de la fecha de cada punta, no el de hoy en ambas', async () => {
    // Si se usara el MEP de hoy en las dos puntas, la variación ARS daría igual
    // a la USD (+10%). Con el MEP de cada fecha da (110*1200)/(100*1000)-1 = 32%.
    ruteo({
      mep: respMep([['2026-07-30', 1000], ['2026-08-05', 1200]]),
      yahoo: respYahoo([['2026-07-30', 100], ['2026-08-05', 110]]),
    });

    const r = await calcularVariacionSemanal([tenencia('AAPL')]);
    const aapl = r.grupos[0].activos[0];

    expect(aapl.variacionUsd).toBeCloseTo(0.10, 6);
    expect(aapl.variacionArs).toBeCloseTo(0.32, 6);
  });

  it('toma las dos series nativas de un bono ARG (base en ARS, especie D en USD)', async () => {
    // Los cruces ARS/USD (56000/56 y 58800/57 ≈ 1000 y 1032) quedan dentro de
    // la tolerancia contra un MEP de 1000/1030, así que ninguna punta se
    // descarta y cada variación sale de su propia serie.
    ruteo({
      mep: respMep([['2026-07-30', 1000], ['2026-08-05', 1030]]),
      data912: {
        AL35D: respData912([['2026-07-30', 56], ['2026-08-05', 57]]),
        AL35:  respData912([['2026-07-30', 56000], ['2026-08-05', 58800]]),
      },
    });

    const r = await calcularVariacionSemanal([tenencia('AL35', { TIPO: 'BONOS', SECTOR_GEO: 'ARG' })]);
    const al35 = r.grupos[0].activos[0];

    // Cada pata sale de su propia serie, sin pasar por el MEP.
    expect(al35.nota).toBeUndefined();
    expect(al35.variacionUsd).toBeCloseTo(57 / 56 - 1, 6);
    expect(al35.variacionArs).toBeCloseTo(0.05, 6);
  });

  it('deriva la pata faltante de un bono con el MEP de cada fecha', async () => {
    // Sin serie en pesos: la de ARS se reconstruye desde la USD.
    ruteo({
      mep: respMep([['2026-07-30', 1000], ['2026-08-05', 1100]]),
      data912: { AL35D: respData912([['2026-07-30', 50], ['2026-08-05', 50]]) },
    });

    const r = await calcularVariacionSemanal([tenencia('AL35', { TIPO: 'BONOS', SECTOR_GEO: 'ARG' })]);
    const al35 = r.grupos[0].activos[0];

    expect(al35.variacionUsd).toBeCloseTo(0, 6);
    expect(al35.variacionArs).toBeCloseTo(0.10, 6);
  });

  it('descarta el precio de la especie D cuando no cruza contra el MEP', async () => {
    // Caso: la serie en pesos está plana y el MEP casi
    // no se movió, pero el último print de GD35D viene ~4% abajo — una punta
    // vieja de una especie ilíquida. Sin control daría −2,5% en USD.
    ruteo({
      mep: respMep([['2026-07-30', 1500], ['2026-08-05', 1510]]),
      data912: {
        // 87300/58.2 = 1500 (cruza bien) · 88000/56.0 = 1571 vs MEP 1510: +4%.
        GD35D: respData912([['2026-07-30', 58.2], ['2026-08-05', 56.0]]), // último roto
        GD35:  respData912([['2026-07-30', 87300], ['2026-08-05', 88000]]),
      },
    });

    const r = await calcularVariacionSemanal([tenencia('GD35', { TIPO: 'BONOS', SECTOR_GEO: 'ARG' })]);
    const gd35 = r.grupos[0].activos[0];

    // 88000/1510 = 58.28, no 56.0.
    expect(gd35.precioUsd).toBeCloseTo(88000 / 1510, 4);
    expect(gd35.nota).toBe('USD estimado vía MEP');
    // Reconstruida, la variación en USD queda en línea con la de pesos.
    expect(gd35.variacionUsd).toBeGreaterThan(0);
    expect(gd35.variacionArs).toBeCloseTo(88000 / 87300 - 1, 6);
  });

  it('respeta el precio de la especie D cuando el cruce es coherente', async () => {
    // 87000/58 y 88500/59 dan exactamente 1500, el MEP de ambas fechas.
    ruteo({
      mep: respMep([['2026-07-30', 1500], ['2026-08-05', 1500]]),
      data912: {
        GD35D: respData912([['2026-07-30', 58.0], ['2026-08-05', 59.0]]),
        GD35:  respData912([['2026-07-30', 87000], ['2026-08-05', 88500]]),
      },
    });

    const r = await calcularVariacionSemanal([tenencia('GD35', { TIPO: 'BONOS', SECTOR_GEO: 'ARG' })]);
    const gd35 = r.grupos[0].activos[0];

    expect(gd35.precioUsd).toBe(59.0); // el de la fuente, sin tocar
    expect(gd35.nota).toBeUndefined();
  });

  it('marca sin dato el FCI en vez de reportar 0%', async () => {
    fetchFciMetricsMock.mockResolvedValue(new Map([['FDOUNO', {
      ticker: 'FDOUNO', nombreFondo: 'Fondo Demo Uno - Clase A', moneda: 'ARS',
      horizonte: 'Cor', vcp: 1.5, variacionDiaria: 0.0012, rendimientoMes: 0.02,
      rendimientoAnio: 0.3, rendimiento12Meses: 0.5, patrimonio: 1e9, fecha: '2026-08-05',
    }]]));
    ruteo({ mep: respMep([['2026-07-30', 1000], ['2026-08-05', 1000]]) });

    const r = await calcularVariacionSemanal([tenencia('FDOUNO', { TIPO: 'FCI', SECTOR_GEO: 'ARG' })]);
    const fci = r.grupos[0].activos[0];

    expect(fci.variacionUsd).toBeNull();
    expect(fci.variacionArs).toBeNull();
    expect(fci.nota).toContain('sin serie 7d');
  });

  it('agrupa por tipo y promedia de forma simple, sin ponderar por tenencia', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('argentinadatos')) return Promise.resolve(respMep([['2026-07-30', 1000], ['2026-08-05', 1000]]));
      if (url.includes('AAPL')) return Promise.resolve(respYahoo([['2026-07-30', 100], ['2026-08-05', 120]]));
      if (url.includes('JPM')) return Promise.resolve(respYahoo([['2026-07-30', 100], ['2026-08-05', 100]]));
      return Promise.resolve({ ok: false, status: 404 });
    });

    // AAPL pesa 10x más que JPM: si el promedio fuese ponderado daría ~+18%.
    const r = await calcularVariacionSemanal([
      tenencia('AAPL', { tenencia_usd: 10000 }),
      tenencia('JPM', { tenencia_usd: 1000 }),
    ]);

    expect(r.grupos).toHaveLength(1);
    expect(r.grupos[0].tipo).toBe('ACCIONES');
    expect(r.grupos[0].promedioUsd).toBeCloseTo(0.10, 6); // (20% + 0%) / 2
  });

  it('aísla el fallo de un ticker sin tumbar el resto', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes('argentinadatos')) return Promise.resolve(respMep([['2026-07-30', 1000], ['2026-08-05', 1000]]));
      if (url.includes('AAPL')) return Promise.resolve(respYahoo([['2026-07-30', 100], ['2026-08-05', 110]]));
      if (url.includes('JPM')) return Promise.reject(new Error('network'));
      return Promise.resolve({ ok: false, status: 404 });
    });

    const r = await calcularVariacionSemanal([tenencia('AAPL'), tenencia('JPM')]);
    const porTicker = Object.fromEntries(r.grupos[0].activos.map((a) => [a.ticker, a]));

    expect(porTicker.AAPL.variacionUsd).toBeCloseTo(0.10, 6);
    expect(porTicker.JPM.variacionUsd).toBeNull();
    expect(porTicker.JPM.nota).toBe('sin cotización');
  });

  it('sigue devolviendo los activos aunque falle la serie de MEP', async () => {
    ruteo({
      mep: { ok: false, status: 503 },
      yahoo: respYahoo([['2026-07-30', 100], ['2026-08-05', 110]]),
    });

    const r = await calcularVariacionSemanal([tenencia('AAPL')]);

    expect(r.variacionMep).toBeNull();
    expect(r.errores.length).toBeGreaterThan(0);
    expect(r.grupos[0].activos[0].variacionUsd).toBeCloseTo(0.10, 6);
    // Sin MEP no se puede expresar en pesos, pero el dato en USD se mantiene.
    expect(r.grupos[0].activos[0].variacionArs).toBeNull();
  });

  it('ignora posiciones sin tenencia', async () => {
    ruteo({ mep: respMep([['2026-08-05', 1000]]) });
    const r = await calcularVariacionSemanal([tenencia('AAPL', { tenencia_usd: 0 })]);
    expect(r.grupos).toHaveLength(0);
  });
});
