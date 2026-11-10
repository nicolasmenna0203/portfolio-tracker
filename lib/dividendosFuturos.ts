import type { EventoCalendario } from '@/types';
import { netoDividendo } from './retenciones';
import { mapConLimite } from './concurrencia';

// Nasdaq expone un calendario de dividendos confirmados por día, sin auth.
// Requiere User-Agent de browser.
//
// El parámetro `date` es la fecha EX-DIVIDENDO, no la de pago: entre una y
// otra suelen pasar 1 a 4 semanas. Por eso el barrido arranca DIAS_ATRAS_EX
// antes de hoy y se filtra por fecha de pago. Si arrancara hoy, un dividendo
// desaparecería apenas pasa su fecha ex, justo en las semanas en que el cobro
// está por llegar (y la alerta semanal, que mira 7 días, no vería casi
// ninguno). Las empresas confirman el próximo dividendo ~1-2 meses antes, así
// que hacia adelante alcanza con un horizonte corto.
const NASDAQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HORIZONTE_DIAS = 75;
/** Máxima distancia entre fecha ex y fecha de pago que se cubre. */
export const DIAS_ATRAS_EX = 45;
const CONCURRENCIA = 12;
const DIA_MS = 86_400_000;
/** Un día futuro puede sumar anuncios; uno pasado ya no cambia. */
const TTL_FUTURO_S = 6 * 60 * 60;
const TTL_PASADO_S = 30 * 24 * 60 * 60;

interface NasdaqRow {
  symbol: string;
  companyName: string;
  dividend_Ex_Date: string;   // "M/D/YYYY"
  payment_Date: string;       // "M/D/YYYY"
  dividend_Rate: number;
  announcement_Date: string;
}

// Cache en memoria por fecha ex consultada, con vencimiento: los días futuros
// se vuelven a pedir porque las empresas siguen anunciando.
const cacheDia = new Map<string, { rows: NasdaqRow[]; vence: number }>();

function toIso(fecha: string): string | null {
  // "8/10/2026" → "2026-08-10"
  const m = fecha?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function fetchDiaNasdaq(fechaIso: string, hoy: string): Promise<NasdaqRow[]> {
  const cacheado = cacheDia.get(fechaIso);
  if (cacheado && cacheado.vence > Date.now()) return cacheado.rows;
  const ttl = fechaIso < hoy ? TTL_PASADO_S : TTL_FUTURO_S;
  try {
    const url = `https://api.nasdaq.com/api/calendar/dividends?date=${fechaIso}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': NASDAQ_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: ttl },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows: NasdaqRow[] = json?.data?.calendar?.rows ?? [];
    cacheDia.set(fechaIso, { rows, vence: Date.now() + ttl * 1000 });
    return rows;
  } catch {
    // Un día que falla no se cachea: se reintenta en la próxima consulta.
    return [];
  }
}

/** Fechas ex a consultar para cobrar pagos en [desde, hasta]. Sin fines de semana: no hay fechas ex. */
export function diasABarrer(desde: string, hasta: string, ahora: Date): string[] {
  const hoyTs = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const desdeTs = Date.parse(desde + 'T00:00:00Z');
  const hastaTs = Date.parse(hasta + 'T00:00:00Z');
  const inicio = Math.max(hoyTs, desdeTs) - DIAS_ATRAS_EX * DIA_MS;
  const fin = Math.min(hoyTs + HORIZONTE_DIAS * DIA_MS, hastaTs);
  const dias: string[] = [];
  for (let t = inicio; t <= fin; t += DIA_MS) {
    const dow = new Date(t).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    dias.push(new Date(t).toISOString().slice(0, 10));
  }
  return dias;
}

/**
 * Dividendos confirmados por Nasdaq para los tickers dados, ubicados en su
 * FECHA DE PAGO dentro de [desde, hasta]. Cubre los que ya pasaron su fecha
 * ex pero todavía no se pagaron, y los pagados hace poco (DIAS_ATRAS_EX): los
 * que ya se cobraron salen como `dividendo`, los pendientes como
 * `dividendo-fut`. Cada evento lleva `fechaEx` para que el calendario
 * descarte el mismo dividendo del histórico de Yahoo, que lo fecha en la ex.
 */
export async function fetchDividendosFuturos(
  tickers: string[],
  desde: string,
  hasta: string,
  tenencias: Record<string, number> = {},
  precios: Record<string, number> = {},
  ahora: Date = new Date(),
): Promise<EventoCalendario[]> {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  if (wanted.size === 0) return [];

  const hoy = ahora.toISOString().slice(0, 10);
  const dias = diasABarrer(desde, hasta, ahora);
  const resultados = await mapConLimite(dias, CONCURRENCIA, (d) => fetchDiaNasdaq(d, hoy));

  const eventos: EventoCalendario[] = [];
  const vistos = new Set<string>(); // dedup por ticker+fechaPago

  for (const rows of resultados) {
    for (const r of rows) {
      const sym = r.symbol?.toUpperCase();
      if (!sym || !wanted.has(sym)) continue;
      const pagoIso = toIso(r.payment_Date);
      if (!pagoIso || pagoIso < desde || pagoIso > hasta) continue;

      const key = `${sym}|${pagoIso}`;
      if (vistos.has(key)) continue;
      vistos.add(key);

      // cobro neto ≈ (tenencia_usd / precio_acción) × dividendo_por_acción, menos retenciones
      const tenenciaUsd = tenencias[sym];
      const precio = precios[sym];
      const montoEstimado = tenenciaUsd && precio && r.dividend_Rate
        ? netoDividendo((tenenciaUsd / precio) * r.dividend_Rate)
        : undefined;
      const fechaEx = toIso(r.dividend_Ex_Date);
      const pagado = pagoIso < hoy;
      const exCorta = fechaEx ? ` · ex ${fechaEx.slice(8, 10)}/${fechaEx.slice(5, 7)}` : '';

      eventos.push({
        ticker: sym,
        tipo: pagado ? 'dividendo' : 'dividendo-fut',
        fecha: pagoIso,
        detalle: `${pagado ? 'Pagado' : 'Confirmado'}${exCorta}`,
        ...(fechaEx ? { fechaEx } : {}),
        ...(montoEstimado != null ? { montoEstimado, monedaMonto: 'USD' } : {}),
      });
    }
  }

  return eventos;
}
