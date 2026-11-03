// PRNG determinístico (mulberry32) para que los datos de demo sean reproducibles
// entre requests: el mismo ticker siempre genera la misma serie de precios, sin
// necesidad de persistir nada. Se semilla con un hash del string de entrada
// (ticker, par, etc.) para que cada activo tenga su propia caminata aleatoria.

export function hashSeed(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

/** Devuelve una función generadora [0,1) determinística a partir de una semilla numérica. */
export function mulberry32(seed: number): () => number {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RNG determinístico a partir de un string (ticker, par A/B, etc). */
export function rngFromString(s: string): () => number {
  return mulberry32(hashSeed(s));
}

/** Número pseudoaleatorio con distribución normal estándar (Box-Muller), a partir de un RNG [0,1). */
export function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
