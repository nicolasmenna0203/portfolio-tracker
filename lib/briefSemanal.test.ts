import { describe, it, expect } from 'vitest';
import { parsearBrief, briefVigente, briefDesdePayload } from './briefSemanal';

// Brief sintético: tickers y textos inventados.
const valido = {
  fecha: '2026-07-25',
  resumen: 'Resumen de la semana.',
  activos: [
    { ticker: 'zzz', rol: 'satelite', noticia: 'Pasó algo.', fundamentales: '', lectura: 'Nada que hacer.', fuentes: [{ titulo: 'Nota', url: 'https://example.com/a' }] },
  ],
  a_vigilar: ['Dato de empleo el viernes'],
};

describe('parsearBrief', () => {
  it('normaliza ticker y rol y conserva los campos', () => {
    const b = parsearBrief(valido)!;
    expect(b.fecha).toBe('2026-07-25');
    expect(b.activos[0]).toMatchObject({ ticker: 'ZZZ', rol: 'SATELITE', noticia: 'Pasó algo.', lectura: 'Nada que hacer.' });
    expect(b.aVigilar).toEqual(['Dato de empleo el viernes']);
  });

  it('sin fecha válida, o sin resumen ni activos, no es un brief', () => {
    expect(parsearBrief({ ...valido, fecha: 'ayer' })).toBeNull();
    expect(parsearBrief({ fecha: '2026-07-25', resumen: '', activos: [] })).toBeNull();
    expect(parsearBrief('texto')).toBeNull();
    expect(parsearBrief(null)).toBeNull();
  });

  it('descarta links que no son http(s) y activos sin contenido', () => {
    const b = parsearBrief({
      ...valido,
      activos: [
        { ticker: 'AAA', noticia: 'x', fuentes: [{ titulo: 'malo', url: 'javascript:alert(1)' }, { url: 'https://example.com/b' }] },
        { ticker: 'BBB', noticia: '', fundamentales: '', lectura: '' },
        { noticia: 'sin ticker' },
      ],
    })!;
    expect(b.activos.map((a) => a.ticker)).toEqual(['AAA']);
    expect(b.activos[0].fuentes).toEqual([{ titulo: 'example.com', url: 'https://example.com/b' }]);
  });

  it('recorta textos demasiado largos', () => {
    const b = parsearBrief({ ...valido, resumen: 'a'.repeat(5000) })!;
    expect(b.resumen.length).toBeLessThanOrEqual(900);
    expect(b.resumen.endsWith('…')).toBe(true);
  });
});

describe('briefVigente', () => {
  const b = parsearBrief(valido)!; // 2026-07-25, sábado
  it('el brief del sábado vale para el mail del domingo', () => {
    expect(briefVigente(b, new Date('2026-07-26T15:00:00Z'))).toBe(true);
  });
  it('el de la semana anterior ya no', () => {
    expect(briefVigente(b, new Date('2026-08-02T15:00:00Z'))).toBe(false);
  });
});

describe('briefDesdePayload', () => {
  it('devuelve el brief si es de esta semana, null si no vino o es viejo', () => {
    expect(briefDesdePayload(valido, new Date('2026-07-26T15:00:00Z'))?.fecha).toBe('2026-07-25');
    expect(briefDesdePayload(null, new Date('2026-07-26T15:00:00Z'))).toBeNull();
    expect(briefDesdePayload(valido, new Date('2026-08-09T15:00:00Z'))).toBeNull();
  });
});
