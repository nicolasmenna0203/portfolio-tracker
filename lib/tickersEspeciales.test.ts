import { describe, it, expect } from 'vitest';
import { parsearTickersEspeciales } from './tickersEspeciales';

describe('parsearTickersEspeciales', () => {
  it('separa los tickers por regla y normaliza mayúsculas y espacios', () => {
    const r = parsearTickersEspeciales([
      { TICKER: ' xmpl ', REGLA: 'cotiza' },
      { TICKER: 'BONOX', REGLA: 'EXCLUIR_BONO' },
    ]);
    expect([...r.cotiza]).toEqual(['XMPL']);
    expect([...r.excluirBono]).toEqual(['BONOX']);
  });

  it('ignora filas sin ticker y reglas desconocidas', () => {
    const r = parsearTickersEspeciales([
      { TICKER: '', REGLA: 'COTIZA' },
      { TICKER: 'OTRO', REGLA: 'INVENTADA' },
    ]);
    expect(r.cotiza.size).toBe(0);
    expect(r.excluirBono.size).toBe(0);
  });
});
