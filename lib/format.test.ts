import { describe, it, expect } from 'vitest';
import { formatMoney, formatPercent, formatNumber, formatFx, formatMonto, valorSegunMoneda, niceTicks } from './format';

describe('formatMoney', () => {
  it('usa separador de miles es-AR (punto) y código de moneda con prefijo', () => {
    expect(formatMoney(25766, { currency: 'USD' })).toBe('USD 25.766');
    expect(formatMoney(39819198, { currency: 'ARS' })).toBe('ARS 39.819.198');
  });

  it('mode full: sin decimales para montos >= 100', () => {
    expect(formatMoney(6009, { currency: 'USD' })).toBe('USD 6.009');
  });

  it('mode full: 2 decimales con coma para montos menores a 100', () => {
    expect(formatMoney(0.08, { currency: 'USD' })).toBe('USD 0,08');
  });

  it('mode price: siempre 2 decimales', () => {
    expect(formatMoney(1495.51, { currency: 'ARS', mode: 'price' })).toBe('ARS 1.495,51');
    expect(formatMoney(137, { currency: 'ARS', mode: 'price' })).toBe('ARS 137,00');
  });

  it('mode compact: notación compacta para ejes', () => {
    expect(formatMoney(26000, { currency: 'USD', mode: 'compact' })).toMatch(/^USD 26/);
  });

  it('sign: antepone +/- antes del código de moneda', () => {
    expect(formatMoney(975, { currency: 'USD', sign: true })).toBe('+USD 975');
    expect(formatMoney(-1131, { currency: 'USD', sign: true })).toBe('-USD 1.131');
  });

  it('hidden: enmascara el número pero mantiene el código de moneda', () => {
    expect(formatMoney(25766, { currency: 'USD', hidden: true })).toBe('USD ••••');
  });

  it('null/NaN: devuelve "s/d" con el código de moneda', () => {
    expect(formatMoney(null, { currency: 'USD' })).toBe('USD s/d');
    expect(formatMoney(undefined, { currency: 'ARS' })).toBe('ARS s/d');
    expect(formatMoney(NaN, { currency: 'USD' })).toBe('USD s/d');
  });
});

describe('formatPercent', () => {
  it('1 decimal con coma', () => {
    expect(formatPercent(19.2, { sign: false })).toBe('19,2%');
  });

  it('sign: antepone + a positivos por default', () => {
    expect(formatPercent(19.2)).toBe('+19,2%');
    expect(formatPercent(-13.5)).toBe('-13,5%');
  });

  it('pp: puntos porcentuales', () => {
    expect(formatPercent(3.5, { pp: true })).toBe('+3,5 pp');
  });

  it('hidden y null/NaN', () => {
    expect(formatPercent(10, { hidden: true })).toBe('••••');
    expect(formatPercent(null)).toBe('s/d');
    expect(formatPercent(NaN)).toBe('s/d');
  });
});

describe('formatNumber', () => {
  it('miles es-AR sin decimales por default', () => {
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('decimales configurables', () => {
    expect(formatNumber(0.7134, { decimals: 4 })).toBe('0,7134');
  });

  it('compact', () => {
    expect(formatNumber(1500000, { compact: true })).toMatch(/1,5/);
  });

  it('hidden y null/NaN', () => {
    expect(formatNumber(10, { hidden: true })).toBe('••••');
    expect(formatNumber(null)).toBe('s/d');
    expect(formatNumber(NaN)).toBe('s/d');
  });
});

describe('formatFx', () => {
  it('etiqueta explícita ARS/USD', () => {
    expect(formatFx(1500)).toBe('1.500 ARS/USD');
  });

  it('hidden y null', () => {
    expect(formatFx(1500, { hidden: true })).toBe('••••');
    expect(formatFx(null)).toBe('s/d');
  });
});

describe('formatMonto', () => {
  it('en USD devuelve el monto directo', () => {
    expect(formatMonto(100, 'USD', 1500)).toBe('USD 100');
  });

  it('en ARS convierte con el MEP dado', () => {
    expect(formatMonto(100, 'ARS', 1500)).toBe('ARS 150.000');
  });

  it('en ARS sin MEP conocido devuelve s/d', () => {
    expect(formatMonto(100, 'ARS', null)).toBe('ARS s/d');
  });
});

describe('valorSegunMoneda', () => {
  it('elige USD o ARS según el parámetro', () => {
    expect(valorSegunMoneda(100, 150000, 'USD')).toBe(100);
    expect(valorSegunMoneda(100, 150000, 'ARS')).toBe(150000);
  });
});

describe('niceTicks', () => {
  it('genera pasos redondos que incluyen el rango', () => {
    const ticks = niceTicks(6.5, 19.5, 5);
    expect(ticks[0]).toBeLessThanOrEqual(6.5);
    expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(19.5);
    // todos los pasos entre ticks consecutivos son iguales (grilla uniforme)
    const steps = new Set<number>();
    for (let i = 1; i < ticks.length; i++) steps.add(Math.round((ticks[i] - ticks[i - 1]) * 1e6) / 1e6);
    expect(steps.size).toBe(1);
  });

  it('nunca produce pasos irregulares que generen etiquetas engañosas', () => {
    const ticks = niceTicks(0, 26000, 5);
    for (const t of ticks) expect(t % (ticks[1] - ticks[0])).toBeCloseTo(0, 6);
  });
});
