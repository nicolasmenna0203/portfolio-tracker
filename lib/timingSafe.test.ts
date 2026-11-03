import { describe, it, expect } from 'vitest';
import { equalsSeguro } from './timingSafe';

describe('equalsSeguro', () => {
  it('true para strings idénticos', () => {
    expect(equalsSeguro('hunter2', 'hunter2')).toBe(true);
  });

  it('false para strings distintos del mismo largo', () => {
    expect(equalsSeguro('hunter2', 'hunter3')).toBe(false);
  });

  it('false para strings de distinto largo', () => {
    expect(equalsSeguro('abc', 'abcd')).toBe(false);
    expect(equalsSeguro('abcd', 'abc')).toBe(false);
  });

  it('true para dos strings vacíos', () => {
    expect(equalsSeguro('', '')).toBe(true);
  });

  it('false comparando contra vacío', () => {
    expect(equalsSeguro('x', '')).toBe(false);
  });

  it('soporta unicode (no solo ASCII)', () => {
    expect(equalsSeguro('contraseña', 'contraseña')).toBe(true);
    expect(equalsSeguro('contraseña', 'contrasena')).toBe(false);
  });
});
