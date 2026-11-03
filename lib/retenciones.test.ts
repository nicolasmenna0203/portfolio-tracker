import { describe, it, expect } from 'vitest';
import { netoDividendo, FACTOR_NETO_DIVIDENDO, RETENCION_USA, IMPUESTO_CHEQUE } from './retenciones';

describe('netoDividendo', () => {
  it('aplica el factor combinado 0.694 documentado', () => {
    // (1 - 0.30) * (1 - 0.006) = 0.7 * 0.994 = 0.6958
    expect(FACTOR_NETO_DIVIDENDO).toBeCloseTo(0.6958, 4);
  });

  it('descuenta retención USA + impuesto al cheque sobre el bruto', () => {
    expect(netoDividendo(100)).toBeCloseTo(69.58, 2);
  });

  it('es lineal: neto(0) = 0', () => {
    expect(netoDividendo(0)).toBe(0);
  });

  it('usa las constantes documentadas (30% y 0.6%)', () => {
    expect(RETENCION_USA).toBe(0.30);
    expect(IMPUESTO_CHEQUE).toBe(0.006);
  });
});
