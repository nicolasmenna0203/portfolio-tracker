import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DashboardData, EventoCalendario } from '@/types';
import type { VariacionSemanal } from './variacionSemanal';

const fetchCalendarioFinancieroMock = vi.fn();
const calcularVariacionSemanalMock = vi.fn();

vi.mock('./calendario', () => ({
  fetchCalendarioFinanciero: (...args: unknown[]) => fetchCalendarioFinancieroMock(...args),
}));

// La variación pega contra Yahoo/data912/CAFCI/argentinadatos: se mockea para
// que los tests de `calcularAlertaSemanal` no salgan a la red.
vi.mock('./variacionSemanal', () => ({
  calcularVariacionSemanal: (...args: unknown[]) => calcularVariacionSemanalMock(...args),
}));

// La revisión técnica lee el Sheet y Yahoo: se mockea por la misma razón.
const calcularRevisionTecnicaMock = vi.fn();
vi.mock('./revisionTecnica', () => ({
  calcularRevisionTecnica: (...args: unknown[]) => calcularRevisionTecnicaMock(...args),
}));

// Import dinámico después del mock para que vitest lo intercepte correctamente.
const { calcularAlertaSemanal, armarContenidoMail, enviarAlertaSemanal, inicioVentana } = await import('./alertas');

function dataConTenencia(ticker: string, tenenciaUsd: number, extra: Partial<DashboardData['tenenciasPorMes'][string][number]> = {}): DashboardData {
  return {
    kpis: {} as DashboardData['kpis'],
    resumenSeries: [],
    tenenciasPorMes: {
      '2026-07': [
        {
          ticker,
          tenencia_ars: 0,
          tenencia_usd: tenenciaUsd,
          fechaTs: Date.UTC(2026, 6, 1),
          fechaMes: '2026-07',
          TIPO: 'ACCION',
          RIESGO: 3,
          SECTOR_GEO: 'USA',
          RENTA: 'Variable',
          MONEDA: 'USD',
          ...extra,
        },
      ],
    },
    mesesDisponibles: ['Jul-2026'],
    totalPorMes: { '2026-07': tenenciaUsd },
    totalPorMesArs: { '2026-07': 0 },
    movimientos: [],
  };
}

beforeEach(() => {
  fetchCalendarioFinancieroMock.mockReset();
  calcularVariacionSemanalMock.mockReset();
  calcularRevisionTecnicaMock.mockReset();
  calcularRevisionTecnicaMock.mockResolvedValue(null);
  calcularVariacionSemanalMock.mockResolvedValue({
    desde: '2026-07-20', hasta: '2026-07-27', grupos: [],
    mepActual: null, mepPrevio: null, variacionMep: null, errores: [],
  });
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 6, 27)); // 2026-07-27, lunes
});

afterEach(() => {
  vi.useRealTimers();
});

describe('calcularAlertaSemanal', () => {
  it('pide el calendario para el rango [hoy, hoy+6d] con los tickers de la cartera', async () => {
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos: [], yields: [], errores: [], generatedAt: Date.now() });

    const data = dataConTenencia('AAPL', 1000);
    await calcularAlertaSemanal(data, 7);

    expect(fetchCalendarioFinancieroMock).toHaveBeenCalledWith(
      ['AAPL'],
      [],
      '2026-07-27',
      '2026-08-02',
      { AAPL: 1000 },
    );
  });

  it('suma solo los montos en USD para el total estimado', async () => {
    const eventos: EventoCalendario[] = [
      { ticker: 'AAPL', tipo: 'dividendo', fecha: '2026-07-28', montoEstimado: 10, monedaMonto: 'USD' },
      { ticker: 'GD35', tipo: 'renta', fecha: '2026-07-29', montoEstimado: 5000, monedaMonto: 'ARS' },
      { ticker: 'JPM', tipo: 'earnings', fecha: '2026-07-30' }, // sin monto
    ];
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos, yields: [], errores: [], generatedAt: Date.now() });

    const data = dataConTenencia('AAPL', 1000);
    const alerta = await calcularAlertaSemanal(data, 7);

    expect(alerta.totalUsdEstimado).toBe(10);
    expect(alerta.eventos).toHaveLength(3);
  });

  it('usa el último mes disponible cuando hay varios', async () => {
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos: [], yields: [], errores: [], generatedAt: Date.now() });

    const data = dataConTenencia('AAPL', 1000);
    data.tenenciasPorMes['2026-06'] = [
      { ticker: 'VIEJO', tenencia_ars: 0, tenencia_usd: 999, fechaTs: 0, fechaMes: '2026-06', TIPO: 'ACCION', RIESGO: 1, SECTOR_GEO: 'USA', RENTA: 'Variable', MONEDA: 'USD' },
    ];

    await calcularAlertaSemanal(data, 7);

    // Solo el ticker del mes más reciente (2026-07), no "VIEJO" de 2026-06.
    expect(fetchCalendarioFinancieroMock).toHaveBeenCalledWith(
      ['AAPL'], [], '2026-07-27', '2026-08-02', { AAPL: 1000 },
    );
  });
});

describe('armarContenidoMail', () => {
  it('arma un mensaje distinto cuando no hay eventos', () => {
    const { asunto, texto } = armarContenidoMail({ desde: '2026-07-27', hasta: '2026-08-03', eventos: [], totalUsdEstimado: 0 });
    expect(asunto).toContain('sin cobros');
    expect(texto).toContain('Sin dividendos, renta, amortizaciones ni balances');
  });

  it('incluye cada evento y el total en el texto plano', () => {
    const eventos: EventoCalendario[] = [
      { ticker: 'AAPL', tipo: 'dividendo', fecha: '2026-07-28', montoEstimado: 12.5, monedaMonto: 'USD' },
    ];
    const { asunto, texto, html } = armarContenidoMail({ desde: '2026-07-27', hasta: '2026-08-03', eventos, totalUsdEstimado: 12.5 });

    expect(asunto).toContain('1 evento');
    expect(asunto).toContain('12,50');
    expect(texto).toContain('AAPL');
    expect(texto).toContain('Dividendo');
    expect(html).toContain('AAPL');
    expect(html).toContain('<table');
  });

  it('pluraliza "eventos" cuando hay más de uno', () => {
    const eventos: EventoCalendario[] = [
      { ticker: 'AAPL', tipo: 'dividendo', fecha: '2026-07-28' },
      { ticker: 'JPM', tipo: 'earnings', fecha: '2026-07-29' },
    ];
    const { asunto } = armarContenidoMail({ desde: '2026-07-27', hasta: '2026-08-03', eventos, totalUsdEstimado: 0 });
    expect(asunto).toContain('2 eventos');
  });

  describe('bloque de variación semanal', () => {
    const variacion: VariacionSemanal = {
      desde: '2026-07-27',
      hasta: '2026-08-03',
      mepActual: 1523,
      mepPrevio: 1500,
      variacionMep: 23 / 1500,
      errores: [],
      grupos: [
        {
          tipo: 'ACCIONES',
          tenenciaUsd: 3000,
          promedioUsd: 0.02,
          promedioArs: 0.035,
          activos: [
            { ticker: 'AAPL', tipo: 'ACCIONES', tenenciaUsd: 2000, precioUsd: 210, precioUsdPrevio: 200, precioArs: 319830, precioArsPrevio: 300000, variacionUsd: 0.05, variacionArs: 0.0661 },
            { ticker: 'JPM', tipo: 'ACCIONES', tenenciaUsd: 1000, precioUsd: 495, precioUsdPrevio: 500, precioArs: 753885, precioArsPrevio: 750000, variacionUsd: -0.01, variacionArs: 0.0052 },
          ],
        },
        {
          tipo: 'FCI',
          tenenciaUsd: 500,
          promedioUsd: null,
          promedioArs: null,
          activos: [
            { ticker: 'FDOUNO', tipo: 'FCI', tenenciaUsd: 500, precioUsd: null, precioUsdPrevio: null, precioArs: 1.23, precioArsPrevio: null, variacionUsd: null, variacionArs: null, nota: 'sin serie 7d (día 0.12%)' },
          ],
        },
      ],
    };

    const alertaConVariacion = { desde: '2026-07-27', hasta: '2026-08-03', eventos: [], totalUsdEstimado: 0, variacion };

    it('lidera el asunto con la variación de cartera y del MEP', () => {
      const { asunto } = armarContenidoMail(alertaConVariacion);
      // Promedio simple de +5% y -1% = +2%.
      expect(asunto).toContain('cartera +2,0% USD');
      expect(asunto).toContain('MEP +1,5%');
    });

    it('agrupa los activos por tipo con su promedio en USD y ARS', () => {
      const { html } = armarContenidoMail(alertaConVariacion);
      expect(html).toContain('Acciones');
      expect(html).toContain('Fondos comunes');
      expect(html).toContain('AAPL');
      expect(html).toContain('+5,00%');
      expect(html).toContain('-1,00%');
      expect(html).toContain('+6,61%');
    });

    it('muestra el movimiento del dólar con sus dos puntas', () => {
      const { html } = armarContenidoMail(alertaConVariacion);
      expect(html).toContain('Dólar MEP');
      expect(html).toContain('1.500');
      expect(html).toContain('1.523');
    });

    it('marca los activos sin serie de 7 días en vez de mostrarlos en cero', () => {
      const { html, texto } = armarContenidoMail(alertaConVariacion);
      expect(html).toContain('sin serie 7d');
      // Un "—" y no un "+0.00%": no hay dato, no es que no se movió.
      expect(texto).toContain('FDOUNO');
      expect(texto).toMatch(/FDOUNO\s+USD\s+—/);
    });

    it('no rompe el mail si no hay datos de variación', () => {
      const { html, asunto } = armarContenidoMail({ desde: '2026-07-27', hasta: '2026-08-03', eventos: [], totalUsdEstimado: 0 });
      expect(html).toContain('Cobros y eventos');
      expect(html).not.toContain('Variación semanal');
      expect(asunto).toContain('sin cobros');
    });

    it('reporta las fuentes que fallaron en el pie', () => {
      const { html } = armarContenidoMail({
        ...alertaConVariacion,
        variacion: { ...variacion, errores: ['MEP: HTTP 503'] },
      });
      expect(html).toContain('Fuentes con error');
      expect(html).toContain('MEP: HTTP 503');
    });
  });
});

describe('revisión técnica en el mail (ADR 0039)', () => {
  const base = { desde: '2026-07-27', hasta: '2026-08-02', eventos: [], totalUsdEstimado: 0 };
  const activo = (eventos: { tipo: 'toco_compra'; nivel: string; precio: number; mensaje: string }[]) => ({
    ticker: 'ZZZ', rol: 'SATELITE' as const, cierre: 50, cierrePrevio: 55,
    compraCercana: { nivel: 'S2', precio: 45, distancia: -0.1 },
    ventaCercana: { nivel: 'R1', precio: 60, distancia: 0.2 },
    tendencia: 'rota' as const, eventos,
  });

  it('sin la hoja de niveles, el mail sale sin el bloque', () => {
    const { html, texto } = armarContenidoMail({ ...base });
    expect(html).not.toContain('Revisión técnica');
    expect(texto).not.toContain('REVISIÓN TÉCNICA');
  });

  it('sin niveles tocados dice que no hace falta hacer nada', () => {
    const { html, texto, asunto } = armarContenidoMail({ ...base, tecnica: { activos: [activo([])], avisos: [] } });
    expect(html).toContain('Revisión técnica');
    expect(html).toContain('no hace falta hacer nada');
    expect(texto).toContain('ZZZ');
    expect(asunto).not.toContain('técnico');
  });

  it('lista el mensaje de cada evento y lo cuenta en el asunto', () => {
    const ev = { tipo: 'toco_compra' as const, nivel: 'S1', precio: 50, mensaje: 'llegó a su nivel de compra S1 (USD 50): según el plan, corresponde comprar el tramo de ese nivel.' };
    const { html, texto, asunto } = armarContenidoMail({ ...base, tecnica: { activos: [activo([ev])], avisos: [] } });
    expect(html).toContain('Llegó a su nivel de compra S1');
    expect(texto).toContain('ZZZ (Satélite): llegó a su nivel de compra S1');
    expect(asunto).toContain('1 aviso técnico');
  });

  it('si la revisión falla, calcularAlertaSemanal sigue y devuelve los cobros', async () => {
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos: [], yields: [], errores: [], generatedAt: Date.now() });
    calcularRevisionTecnicaMock.mockRejectedValue(new Error('Yahoo caído'));
    const alerta = await calcularAlertaSemanal(dataConTenencia('AAPL', 1000), 7);
    expect(alerta.tecnica).toBeUndefined();
    expect(alerta.eventos).toEqual([]);
  });
});

describe('brief de noticias en el mail (ADR 0040)', () => {
  const base = { desde: '2026-07-27', hasta: '2026-08-02', eventos: [], totalUsdEstimado: 0 };
  const brief = {
    fecha: '2026-07-25',
    resumen: 'Semana tranquila <b>para</b> la cartera.',
    activos: [{
      ticker: 'ZZZ', rol: 'SATELITE', noticia: 'Presentó resultados.', fundamentales: 'Ganancia por acción arriba de lo esperado.',
      lectura: 'No cambia el plan.', fuentes: [{ titulo: 'Nota', url: 'https://example.com/nota' }],
    }],
    aVigilar: ['Balance de YYY el jueves'],
  };

  it('va primero en el mail, escapado y con la aclaración de que no es asesoramiento', () => {
    const { html, texto } = armarContenidoMail({ ...base, brief });
    expect(html).toContain('Lo importante de la semana');
    expect(html).toContain('Semana tranquila &lt;b&gt;para&lt;/b&gt; la cartera.');
    expect(html).toContain('href="https://example.com/nota"');
    expect(html).toContain('no asesoramiento financiero');
    expect(texto.indexOf('LO IMPORTANTE DE LA SEMANA')).toBe(0);
    expect(texto).toContain('Para tu plan: No cambia el plan.');
  });

  it('toma el brief y los niveles del POST, y descarta un brief de otra semana', async () => {
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos: [], yields: [], errores: [], generatedAt: Date.now() });
    const niveles = [{ Ticker: 'ZZZ', Rol: 'SATELITE', Nivel: 'S1', Precio: 50 }];
    const vigente = await calcularAlertaSemanal(dataConTenencia('AAPL', 1000), 7, { brief, niveles });
    expect(vigente.brief?.resumen).toContain('Semana tranquila');
    expect(calcularRevisionTecnicaMock).toHaveBeenCalledWith(niveles);

    const viejo = await calcularAlertaSemanal(dataConTenencia('AAPL', 1000), 7, { brief: { ...brief, fecha: '2026-07-10' } });
    expect(viejo.brief).toBeUndefined();
  });

  it('un brief con forma inválida no corta el mail', async () => {
    fetchCalendarioFinancieroMock.mockResolvedValue({ eventos: [], yields: [], errores: [], generatedAt: Date.now() });
    const alerta = await calcularAlertaSemanal(dataConTenencia('AAPL', 1000), 7, { brief: 'texto suelto' });
    expect(alerta.brief).toBeUndefined();
  });
});

describe('enviarAlertaSemanal', () => {
  const alertaVacia = { desde: '2026-07-27', hasta: '2026-08-03', eventos: [], totalUsdEstimado: 0 };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    process.env.RESEND_API_KEY = 'test-key';
    delete process.env.RESEND_FROM;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM;
  });

  it('tira error claro si falta RESEND_API_KEY', async () => {
    delete process.env.RESEND_API_KEY;
    await expect(enviarAlertaSemanal('x@example.com', alertaVacia)).rejects.toThrow('RESEND_API_KEY');
  });

  it('llama a la API de Resend con el remitente sandbox por defecto', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await enviarAlertaSemanal('destino@example.com', alertaVacia);

    expect(fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.from).toBe('onboarding@resend.dev');
    expect(body.to).toEqual(['destino@example.com']);
    expect(body.subject).toContain('sin cobros');
  });

  it('usa RESEND_FROM si está configurado', async () => {
    process.env.RESEND_FROM = 'Portfolio <alertas@midominio.com>';
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    await enviarAlertaSemanal('destino@example.com', alertaVacia);

    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.from).toBe('Portfolio <alertas@midominio.com>');
  });

  it('propaga un error legible si Resend responde con error', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"invalid to"}',
    });

    await expect(enviarAlertaSemanal('x@example.com', alertaVacia)).rejects.toThrow(/Resend: HTTP 422/);
  });
});

describe('inicioVentana (ADR 0033)', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  it('un disparo del domingo al mediodía arranca la semana el lunes', () => {
    expect(iso(inicioVentana(new Date('2026-11-15T15:23:00Z')))).toBe('2026-11-16');
  });

  it('el domingo a la noche ya es lunes en UTC, pero se mira la hora argentina', () => {
    expect(iso(inicioVentana(new Date('2026-11-16T01:30:00Z')))).toBe('2026-11-16');
  });

  it('un disparo manual en otro día arranca hoy', () => {
    expect(iso(inicioVentana(new Date('2026-11-10T15:00:00Z')))).toBe('2026-11-10');
  });
});
