import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { leerPerfil, registrarDecision } from './perfilInversor';

// El módulo resuelve la ruta contra process.cwd(), así que cada test corre en
// un directorio temporal propio: no toca el PERFIL-INVERSOR.md real.
let dir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'perfil-'));
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
});

afterEach(() => {
  cwdSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

const RUTA = () => join(dir, 'PERFIL-INVERSOR.md');

describe('leerPerfil', () => {
  it('devuelve el contenido y la guía de uso cuando el archivo existe', async () => {
    writeFileSync(RUTA(), '# Perfil\n\nCrecimiento a largo plazo.\n', 'utf-8');

    const r = await leerPerfil();
    expect(r.existe).toBe(true);
    expect(r.contenido).toContain('Crecimiento a largo plazo');
    expect(r.comoUsarlo).toBeTruthy();
  });

  it('no es un error que el archivo falte: devuelve existe=false y lo explica', async () => {
    const r = await leerPerfil();
    expect(r.existe).toBe(false);
    expect(r.error).toContain('PERFIL-INVERSOR.md');
    expect(r.contenido).toBeUndefined();
  });
});

describe('registrarDecision', () => {
  const entrada = {
    decision: 'Bajar la exposición ARG al 30%',
    razonamiento: 'El carry dejó de compensar el riesgo',
    queLaInvalidaria: 'Que la tasa real vuelva por encima del 10%',
  };

  it('agrega la entrada al final del archivo con la fecha de hoy', async () => {
    writeFileSync(RUTA(), '# Perfil\n\n## Log de decisiones\n', 'utf-8');

    const r = await registrarDecision(entrada);
    expect(r.ok).toBe(true);

    const texto = readFileSync(RUTA(), 'utf-8');
    const hoy = new Date().toISOString().slice(0, 10);
    expect(texto).toContain(`### ${hoy} — Bajar la exposición ARG al 30%`);
    expect(texto).toContain('**Razonamiento:** El carry dejó de compensar el riesgo');
    expect(texto).toContain('**Qué la invalidaría:** Que la tasa real vuelva por encima del 10%');
  });

  it('conserva el contenido previo: es append, nunca reescritura', async () => {
    writeFileSync(RUTA(), '# Perfil\n\n## Objetivo\n\nNo tocar esto.\n', 'utf-8');

    await registrarDecision(entrada);

    const texto = readFileSync(RUTA(), 'utf-8');
    expect(texto).toContain('No tocar esto.');
    expect(texto.indexOf('No tocar esto.')).toBeLessThan(texto.indexOf('Razonamiento'));
  });

  it('acumula varias entradas sin pisarse', async () => {
    writeFileSync(RUTA(), '# Perfil\n', 'utf-8');

    await registrarDecision(entrada);
    await registrarDecision({ ...entrada, decision: 'Segunda decisión' });

    const texto = readFileSync(RUTA(), 'utf-8');
    expect(texto).toContain('Bajar la exposición ARG al 30%');
    expect(texto).toContain('Segunda decisión');
  });

  // El filtro que evita que el log se llene de observaciones de conversación:
  // si no hay condición que invalide la decisión, no es una decisión.
  it.each(['decision', 'razonamiento', 'queLaInvalidaria'])(
    'rechaza la entrada si falta %s, sin escribir nada',
    async (campo) => {
      writeFileSync(RUTA(), '# Perfil\n', 'utf-8');
      const original = readFileSync(RUTA(), 'utf-8');

      const r = await registrarDecision({ ...entrada, [campo]: '' });
      expect(r.ok).toBe(false);
      expect(r.error).toContain('obligatorios');
      expect(readFileSync(RUTA(), 'utf-8')).toBe(original);
    },
  );

  it('rechaza campos que son solo espacios', async () => {
    writeFileSync(RUTA(), '# Perfil\n', 'utf-8');

    const r = await registrarDecision({ ...entrada, queLaInvalidaria: '   ' });
    expect(r.ok).toBe(false);
  });

  it('falla con un mensaje claro si el archivo no existe', async () => {
    const r = await registrarDecision(entrada);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('No existe');
    expect(existsSync(RUTA())).toBe(false);
  });
});
