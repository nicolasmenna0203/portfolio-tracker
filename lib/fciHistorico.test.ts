import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Fixture: filas mínimas que exige FILAS_MINIMAS_SNAPSHOT_COMPLETO ────────
// El espejo de argentinadatos devuelve un array de filas por categoría/fecha.
// Un snapshot "completo" real trae cientos/miles de fondos; para no generar
// eso en cada test se rellena con filas de relleno sin el fondo buscado.

const FONDO = 'Cocos Dólares Plus - Clase A';

function filaRelleno(i: number) {
  return { fondo: `Fondo Relleno ${i}`, fecha: '2026-10-22', vcp: 100 + i };
}

function snapshotCompleto(filas: { fondo: string; fecha: string; vcp: number }[]) {
  const relleno = Array.from({ length: 500 }, (_, i) => filaRelleno(i));
  return [...relleno, ...filas];
}

function mockFetchPorUrl(respuestas: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [patron, cuerpo] of Object.entries(respuestas)) {
      if (url.includes(patron)) {
        if (cuerpo === null) return { ok: false, status: 404 };
        return { ok: true, status: 200, json: async () => cuerpo };
      }
    }
    return { ok: false, status: 404 };
  });
}

describe('rendimiento12MesesVia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('calcula el rendimiento cuando encuentra el VCP de hace 12 meses en la fecha exacta', async () => {
    vi.stubGlobal('fetch', mockFetchPorUrl({
      '/rentaFija/2025/10/22': snapshotCompleto([{ fondo: FONDO, fecha: '2025-10-22', vcp: 1014.23 }]),
    }));

    const { rendimiento12MesesVia } = await import('./fciHistorico');
    const rend = await rendimiento12MesesVia('rentaFija', FONDO, 1061.516, '2026-10-22');

    expect(rend).not.toBeNull();
    expect(rend!).toBeCloseTo(1061.516 / 1014.23 - 1, 6);
  });

  it('busca hacia atrás y adelante dentro de la tolerancia si la fecha exacta no tiene snapshot completo', async () => {
    vi.stubGlobal('fetch', mockFetchPorUrl({
      '/rentaFija/2025/10/22': { error: 'Not found' }, // 404: sin snapshot ese día
      '/rentaFija/2025/10/21': snapshotCompleto([{ fondo: FONDO, fecha: '2025-10-21', vcp: 1013.5 }]),
    }));

    const { rendimiento12MesesVia } = await import('./fciHistorico');
    const rend = await rendimiento12MesesVia('rentaFija', FONDO, 1061.516, '2026-10-22');

    expect(rend).not.toBeNull();
    expect(rend!).toBeCloseTo(1061.516 / 1013.5 - 1, 6);
  });

  it('devuelve null si no encuentra el fondo dentro de la tolerancia de días', async () => {
    // Todas las fechas devuelven 404 o snapshots sin el fondo: nunca aparece.
    vi.stubGlobal('fetch', mockFetchPorUrl({
      '/rentaFija/': snapshotCompleto([]), // completo pero sin el fondo buscado
    }));

    const { rendimiento12MesesVia } = await import('./fciHistorico');
    const rend = await rendimiento12MesesVia('rentaFija', FONDO, 1061.516, '2026-10-22');

    expect(rend).toBeNull();
  });

  it('descarta un snapshot parcial (pocas filas) aunque el fondo esté presente', async () => {
    // Solo 3 filas: es un scrape incompleto, no "casi no hay fondos ese día".
    vi.stubGlobal('fetch', mockFetchPorUrl({
      '/rentaFija/': [{ fondo: FONDO, fecha: '2025-10-22', vcp: 1014.23 }],
    }));

    const { rendimiento12MesesVia } = await import('./fciHistorico');
    const rend = await rendimiento12MesesVia('rentaFija', FONDO, 1061.516, '2026-10-22');

    expect(rend).toBeNull();
  });

  it('devuelve null si vcpHoy no es positivo', async () => {
    vi.stubGlobal('fetch', mockFetchPorUrl({ '/rentaFija/': snapshotCompleto([{ fondo: FONDO, fecha: '2025-10-22', vcp: 1014.23 }]) }));
    const { rendimiento12MesesVia } = await import('./fciHistorico');
    expect(await rendimiento12MesesVia('rentaFija', FONDO, 0, '2026-10-22')).toBeNull();
    expect(await rendimiento12MesesVia('rentaFija', FONDO, -5, '2026-10-22')).toBeNull();
  });

  it('nunca pide más días de los que la tolerancia permite', async () => {
    const fetchMock = mockFetchPorUrl({}); // todo 404: nada se encuentra nunca
    vi.stubGlobal('fetch', fetchMock);

    const { rendimiento12MesesVia } = await import('./fciHistorico');
    await rendimiento12MesesVia('rentaFija', FONDO, 1061.516, '2026-10-22');

    // offset 0 + (±1..±5) = 11 intentos como máximo para ese único punto.
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(11);
  });
});
