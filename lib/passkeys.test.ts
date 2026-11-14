import { describe, it, expect } from 'vitest';
import { normalizarPasskey } from './passkeys';

// Sintéticos, con el largo de un id de 16 bytes y una clave SPKI P-256.
const ID = 'AQIDBAUGBwgJCgsMDQ4PEA';
const CLAVE = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(86);

describe('normalizarPasskey', () => {
  it('lee una fila completa', () => {
    expect(normalizarPasskey([ID, CLAVE, 'iPhone', '2026-01-02'])).toEqual({
      id: ID, clavePublica: CLAVE, dispositivo: 'iPhone', creada: '2026-01-02',
    });
  });

  it('descarta filas sin id o clave en base64url (editadas a mano, celdas corridas)', () => {
    expect(normalizarPasskey([])).toBeNull();
    expect(normalizarPasskey(['', CLAVE])).toBeNull();
    expect(normalizarPasskey([ID, 'no es base64url'])).toBeNull();
    expect(normalizarPasskey([CLAVE, 'iPhone', '2026-01-02'])).toBeNull();
    expect(normalizarPasskey(['iPhone', '2026-01-02'])).toBeNull();
  });
});
