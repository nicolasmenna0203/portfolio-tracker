// Decisión y alternativas descartadas: docs/decisiones/0021-fuente-secundaria-para-12-meses-de-fci-rezagado.md
//
// ── VCP histórico de FCI vía argentinadatos.com, para completar 12 meses ───
//
// api.pub.cafci.org.ar/pb_get (lib/fciCocos.ts) es un snapshot: siempre la
// planilla de HOY, sin parámetro de fecha que cambie la respuesta (probado:
// ?fecha=, ?date=, ?d= devuelven exactamente los mismos bytes). Cuando un
// fondo viene rezagado, sus columnas de variación quedan vacías y no hay forma
// de completarlas desde esa fuente.
//
// api.argentinadatos.com/v1/finanzas/fci/{categoria}/{anio}/{mes}/{dia} (la
// misma API que ya usa lib/precios.ts para el MEP) expone un espejo diario de
// la planilla CAFCI con historia real. No es una fuente independiente — en los
// días que sí tiene la fila completa, el VCP coincide con el de CAFCI al
// centavo — pero permite mirar hacia atrás, que es lo que CAFCI no deja hacer.
//
// El espejo es irregular: muchos días devuelven solo unas pocas filas (un
// scrape parcial, no "no hubo operación"), y el día exacto que se necesita casi
// nunca está completo. Por eso esto NO intenta reconstruir series continuas ni
// cerrar mes/año calendario (ahí el hueco típico es de 2-3 semanas, demasiado
// para buscar "cerca"): se usa solo para 12 meses, buscando hacia atrás y
// adelante desde la fecha objetivo con una tolerancia acotada, lo bastante
// chica para que el rendimiento no quede atado a una ventana notoriamente
// distinta de un año.

const BASE_URL = 'https://api.argentinadatos.com/v1/finanzas/fci';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

// Filas mínimas para considerar el snapshot de un día "completo" en vez de un
// scrape parcial. El universo de FCI por categoría ronda cientos a miles de
// fondos; un día con 10 filas no es que casi no operó nadie, es que el scraper
// no llegó a guardar el resto.
const FILAS_MINIMAS_SNAPSHOT_COMPLETO = 500;

const TOLERANCIA_DIAS = 5;

interface FilaFciHistorico {
  fondo: string;
  fecha: string; // "YYYY-MM-DD"
  vcp: number;
}

const cache = new Map<string, { vcp: number | null; ts: number }>();
const CACHE_MS = 6 * 60 * 60 * 1000; // mismo TTL que la planilla CAFCI

function fechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchSnapshot(categoria: string, fecha: string): Promise<FilaFciHistorico[] | null> {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const url = `${BASE_URL}/${categoria}/${anio}/${mes}/${dia}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null; // 404: no hay snapshot para ese día
    const filas: FilaFciHistorico[] = await res.json();
    if (!Array.isArray(filas) || filas.length < FILAS_MINIMAS_SNAPSHOT_COMPLETO) return null;
    return filas;
  } catch {
    return null;
  }
}

/**
 * VCP de `nombreFondo` en la fecha más cercana a `fechaObjetivo` (± `TOLERANCIA_DIAS`
 * días), dentro de `categoria`. Prueba primero la fecha exacta y después se aleja
 * de a un día a la vez hacia ambos lados, devolviendo el primer snapshot completo
 * donde aparece el fondo. `null` si no hay ninguno dentro de la tolerancia.
 */
async function vcpCercanoA(categoria: string, nombreFondo: string, fechaObjetivo: string): Promise<number | null> {
  const clave = `${categoria}|${nombreFondo}|${fechaObjetivo}`;
  const hit = cache.get(clave);
  if (hit && Date.now() - hit.ts < CACHE_MS) return hit.vcp;

  const base = new Date(fechaObjetivo + 'T12:00:00Z');
  let resultado: number | null = null;

  for (let offset = 0; offset <= TOLERANCIA_DIAS && resultado == null; offset++) {
    const signos = offset === 0 ? [0] : [-1, 1];
    for (const signo of signos) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + offset * signo);
      const filas = await fetchSnapshot(categoria, fechaISO(d));
      const fila = filas?.find((f) => f.fondo === nombreFondo);
      if (fila) { resultado = fila.vcp; break; }
    }
  }

  cache.set(clave, { vcp: resultado, ts: Date.now() });
  return resultado;
}

/**
 * Rendimiento de 12 meses de `nombreFondo`, calculado como VCP(hoy) / VCP(hace
 * 12 meses) − 1, ambos puntos buscados con tolerancia en el espejo de
 * argentinadatos. `null` si no se encuentra alguno de los dos puntos dentro de
 * la tolerancia, o si `vcpHoy` no es positivo.
 *
 * Es un cálculo de respaldo: solo se usa cuando CAFCI no publicó la columna
 * de 12 meses para el fondo (ver `FciMetric.rendimiento12Meses` en fciCocos.ts).
 */
export async function rendimiento12MesesVia(
  categoria: string,
  nombreFondo: string,
  vcpHoy: number,
  fechaHoy: string,
): Promise<number | null> {
  if (!(vcpHoy > 0)) return null;

  const haceUnAnio = new Date(fechaHoy + 'T12:00:00Z');
  haceUnAnio.setUTCFullYear(haceUnAnio.getUTCFullYear() - 1);

  const vcpHaceUnAnio = await vcpCercanoA(categoria, nombreFondo, fechaISO(haceUnAnio));
  if (vcpHaceUnAnio == null || !(vcpHaceUnAnio > 0)) return null;

  return vcpHoy / vcpHaceUnAnio - 1;
}
