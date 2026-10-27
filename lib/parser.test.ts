import { describe, it, expect } from 'vitest';
import { parseArgNum, parseFechaDia, parseFechaMes, toMesKey, decodeHtmlEntities } from './parser';

describe('parseArgNum', () => {
  it('pasa un number directamente', () => {
    expect(parseArgNum(1234.5)).toBe(1234.5);
  });

  it('parsea formato argentino con miles y decimales: "1.234,56"', () => {
    expect(parseArgNum('1.234,56')).toBe(1234.56);
  });

  it('parsea miles sin decimales: "50.000"', () => {
    expect(parseArgNum('50.000')).toBe(50000);
  });

  it('parsea decimales sin miles: "12,5"', () => {
    expect(parseArgNum('12,5')).toBe(12.5);
  });

  it('no confunde "1.234" (miles) con "1.2" (decimal con punto)', () => {
    // Regla actual: solo se interpreta como miles si son grupos de 3 dígitos.
    expect(parseArgNum('1.2')).toBe(1.2);
  });

  it('devuelve null para vacío, guion o no numérico', () => {
    expect(parseArgNum('')).toBeNull();
    expect(parseArgNum('-')).toBeNull();
    expect(parseArgNum(null)).toBeNull();
    expect(parseArgNum(undefined)).toBeNull();
    expect(parseArgNum('abc')).toBeNull();
  });

  it('rechaza un número con unidad pegada en vez de adivinar el monto', () => {
    // Caso real: celdas de la columna "Tenencia (ARS)" cargadas con el monto
    // en dólares y la unidad al lado. parseFloat devolvía 1717.8 en silencio
    // y esos dólares se leían como pesos, rompiendo la serie en ARS.
    expect(parseArgNum('1.717,80 USD')).toBeNull();
    expect(parseArgNum('340,07 USD')).toBeNull();
    expect(parseArgNum('1234ARS')).toBeNull();
    expect(parseArgNum('$ 1.234,56')).toBeNull();
    expect(parseArgNum('12,5%')).toBeNull();
  });

  it('ignora espacios y NBSP', () => {
    expect(parseArgNum('1.234,56 ')).toBe(1234.56);
    expect(parseArgNum(' 500 ')).toBe(500);
  });
});

describe('parseFechaDia', () => {
  it('parsea ISO "YYYY-MM-DD"', () => {
    expect(parseFechaDia('2024-07-31')).toBe(Date.UTC(2024, 6, 31));
  });

  it('parsea formato argentino "DD/MM/YYYY"', () => {
    expect(parseFechaDia('31/07/2024')).toBe(Date.UTC(2024, 6, 31));
  });

  it('parsea año de 2 dígitos "DD/MM/YY" asumiendo 2000+', () => {
    expect(parseFechaDia('31/07/24')).toBe(Date.UTC(2024, 6, 31));
  });

  it('devuelve null para vacío o formato desconocido', () => {
    expect(parseFechaDia('')).toBeNull();
    expect(parseFechaDia('31 julio 2024')).toBeNull();
  });
});

describe('parseFechaMes', () => {
  it('parsea "mar-24" con año de 2 dígitos', () => {
    expect(parseFechaMes('mar-24')).toBe(Date.UTC(2024, 2, 1));
  });

  it('parsea "mar-2024" con año completo', () => {
    expect(parseFechaMes('mar-2024')).toBe(Date.UTC(2024, 2, 1));
  });

  it('es case-insensitive', () => {
    expect(parseFechaMes('MAR-24')).toBe(Date.UTC(2024, 2, 1));
  });

  it('devuelve null para mes no reconocido', () => {
    expect(parseFechaMes('xyz-24')).toBeNull();
  });
});

describe('toMesKey', () => {
  it('formatea "YYYY-MM" con mes con padding', () => {
    expect(toMesKey(Date.UTC(2024, 0, 15))).toBe('2024-01');
    expect(toMesKey(Date.UTC(2024, 10, 1))).toBe('2024-11');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodifica el caso real de los titulares de Yahoo', () => {
    expect(decodeHtmlEntities('&quot;Se necesita continuidad&quot;'))
      .toBe('"Se necesita continuidad"');
  });

  it('decodifica las entidades nombradas básicas', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &apos;d&apos;')).toBe("a & b <c> 'd'");
  });

  it('decodifica numéricas decimales y hexadecimales', () => {
    expect(decodeHtmlEntities('&#39;hola&#39; &#x2014; chau')).toBe("'hola' — chau");
  });

  it('deja intactas las entidades desconocidas', () => {
    expect(decodeHtmlEntities('&noexiste; &amp;')).toBe('&noexiste; &');
  });

  it('no toca un texto sin entidades', () => {
    expect(decodeHtmlEntities('YPF sube 3% en Nueva York')).toBe('YPF sube 3% en Nueva York');
  });

  it('decodifica en una sola pasada: no desescapa de más', () => {
    // `&amp;quot;` es un `&quot;` escapado a propósito: debe quedar como texto.
    expect(decodeHtmlEntities('&amp;quot;')).toBe('&quot;');
  });

  it('ignora code points fuera del rango Unicode', () => {
    expect(decodeHtmlEntities('&#99999999;')).toBe('&#99999999;');
  });
});
