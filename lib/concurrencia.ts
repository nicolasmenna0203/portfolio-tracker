/**
 * Como `Promise.all(items.map(fn))`, pero con a lo sumo `limite` llamadas en
 * vuelo a la vez. Para barridos contra una API externa (un request por día)
 * que en frío dispararían decenas de requests simultáneos al mismo host.
 * Conserva el orden de `items` en el resultado.
 */
export async function mapConLimite<T, R>(
  items: T[],
  limite: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, trabajador));
  return out;
}
