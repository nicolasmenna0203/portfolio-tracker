import { describe, it, expect } from 'vitest';
import { xirr, type Cashflow } from './finance';

const DAY = 24 * 3600 * 1000;

describe('xirr', () => {
  it('devuelve null con menos de 2 flujos', () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: Date.now(), amount: -100 }])).toBeNull();
  });

  it('calcula ~100% anual para un flujo que duplica en 1 año', () => {
    const t0 = Date.UTC(2023, 0, 1);
    const flows: Cashflow[] = [
      { date: t0, amount: -1000 },
      { date: t0 + 365 * DAY, amount: 2000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(1.0, 2);
  });

  it('calcula 0% cuando el retiro iguala el aporte', () => {
    const t0 = Date.UTC(2023, 0, 1);
    const flows: Cashflow[] = [
      { date: t0, amount: -1000 },
      { date: t0 + 180 * DAY, amount: 1000 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(0, 2);
  });

  it('maneja múltiples aportes y un valor terminal', () => {
    const t0 = Date.UTC(2023, 0, 1);
    const flows: Cashflow[] = [
      { date: t0, amount: -1000 },
      { date: t0 + 180 * DAY, amount: -1000 },
      { date: t0 + 365 * DAY, amount: 2200 },
    ];
    const r = xirr(flows);
    expect(r).not.toBeNull();
    expect(Number.isFinite(r)).toBe(true);
  });
});
