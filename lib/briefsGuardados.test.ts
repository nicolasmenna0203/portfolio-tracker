import { describe, it, expect } from 'vitest';
import { briefAJson, briefsDesdeGrilla, filaDestino, serializarParaCelda } from './briefsGuardados';
import { parsearBrief, type BriefSemanal } from './briefSemanal';

// Fixtures sintéticas: tickers de la demo, texto inventado.
function brief(fecha: string, extra: Partial<BriefSemanal> = {}): BriefSemanal {
  return {
    fecha,
    resumen: `Resumen de la semana al ${fecha}.`,
    activos: [
      { ticker: 'VTI', rol: 'CORE', noticia: 'Semana tranquila.', fundamentales: '', lectura: 'No cambia nada.', fuentes: [{ titulo: 'Ejemplo', url: 'https://example.com/a' }] },
    ],
    aVigilar: ['Dato de inflación.'],
    ...extra,
  };
}

const ENC = ['FECHA', 'BRIEF', 'GUARDADO'];

describe('briefAJson', () => {
  it('vuelve a la forma que escribe la sesión y parsearBrief la reconstruye igual', () => {
    const b = brief('2026-01-10');
    const json = briefAJson(b);
    expect(json).toHaveProperty('a_vigilar', ['Dato de inflación.']);
    expect(parsearBrief(json)).toEqual(b);
  });
});

describe('serializarParaCelda', () => {
  it('un brief normal entra entero', () => {
    const b = brief('2026-01-10');
    expect(parsearBrief(JSON.parse(serializarParaCelda(b)))).toEqual(b);
  });

  it('si no entra en una celda, primero saca las fuentes y después los últimos activos', () => {
    const largo = 'x'.repeat(480);
    const activos = Array.from({ length: 25 }, (_, i) => ({
      ticker: `T${i}`, rol: 'SATELITE', noticia: largo, fundamentales: largo, lectura: largo,
      fuentes: [1, 2, 3].map((n) => ({ titulo: 't'.repeat(100), url: `https://example.com/${'p'.repeat(300)}/${n}` })),
    }));
    const json = serializarParaCelda(brief('2026-01-10', { activos }));
    expect(json.length).toBeLessThanOrEqual(49_000);
    const leido = parsearBrief(JSON.parse(json))!;
    expect(leido.activos.every((a) => a.fuentes.length === 0)).toBe(true);
    expect(leido.activos[0].ticker).toBe('T0');
    expect(leido.activos.length).toBeGreaterThan(20);
  });
});

describe('briefsDesdeGrilla', () => {
  it('ordena del más nuevo al más viejo y descarta celdas rotas', () => {
    const grid = [
      ENC,
      ['2026-01-03', JSON.stringify(briefAJson(brief('2026-01-03'))), 'x'],
      ['2026-01-10', '{no es json', 'x'],
      ['2026-01-17', JSON.stringify({ fecha: 'mal' }), 'x'],
      ['2026-01-24', JSON.stringify(briefAJson(brief('2026-01-24'))), 'x'],
      [],
    ];
    expect(briefsDesdeGrilla(grid).map((b) => b.fecha)).toEqual(['2026-01-24', '2026-01-03']);
  });

  it('con dos filas de la misma fecha gana la de más abajo', () => {
    const viejo = brief('2026-01-10', { resumen: 'Primera versión.' });
    const nuevo = brief('2026-01-10', { resumen: 'Segunda versión.' });
    const grid = [ENC, ['2026-01-10', JSON.stringify(briefAJson(viejo))], ['2026-01-10', JSON.stringify(briefAJson(nuevo))]];
    expect(briefsDesdeGrilla(grid)).toEqual([nuevo]);
  });

  it('una hoja vacía o solo con encabezado no tiene briefs', () => {
    expect(briefsDesdeGrilla([])).toEqual([]);
    expect(briefsDesdeGrilla([ENC])).toEqual([]);
  });
});

describe('filaDestino', () => {
  it('reemplaza la fila de la misma fecha', () => {
    expect(filaDestino([['FECHA'], ['2026-01-03'], ['2026-01-10']], '2026-01-03')).toBe(2);
  });
  it('si la fecha no está, va debajo de la última', () => {
    expect(filaDestino([['FECHA'], ['2026-01-03'], ['2026-01-10']], '2026-01-17')).toBe(4);
  });
  it('en una hoja recién creada va en la fila 2', () => {
    expect(filaDestino([['FECHA']], '2026-01-03')).toBe(2);
    expect(filaDestino([], '2026-01-03')).toBe(2);
  });
});
