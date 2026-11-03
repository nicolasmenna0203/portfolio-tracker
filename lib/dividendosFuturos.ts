import type { EventoCalendario } from '@/types';
import { netoDividendo } from './retenciones';

// Nasdaq expone un calendario de dividendos confirmados por día, sin auth.
// Requiere User-Agent de browser. Las empresas confirman el próximo dividendo
// ~1-2 meses antes, así que solo tiene sentido barrer un horizonte corto.
const NASDAQ_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const HORIZONTE_DIAS = 75;

interface NasdaqRow {
  symbol: string;
  companyName: string;
  dividend_Ex_Date: string;   // "M/D/YYYY"
  payment_Date: string;       // "M/D/YYYY"
  dividend_Rate: number;
  announcement_Date: string;
}

// Cache por día ya consultado (formato YYYY-MM-DD → filas). Los días pasados no cambian.
const cacheDia = new Map<string, NasdaqRow[]>();

function toIso(fecha: string): string | null {
  // "8/10/2026" → "2026-08-10"
  const m = fecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function fetchDiaNasdaq(fechaIso: string): Promise<NasdaqRow[]> {
  if (cacheDia.has(fechaIso)) return cacheDia.get(fechaIso)!;
  try {
    const url = `https://api.nasdaq.com/api/calendar/dividends?date=${fechaIso}`;
    const res = await fetch(url, { headers: { 'User-Agent': NASDAQ_UA, Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const rows: NasdaqRow[] = json?.data?.calendar?.rows ?? [];
    cacheDia.set(fechaIso, rows);
    return rows;
  } catch {
    return [];
  }
}

/**
 * Dividendos FUTUROS confirmados (por fecha de pago) para los tickers dados,
 * barriendo el calendario de Nasdaq desde hoy hasta HORIZONTE_DIAS adelante,
 * acotado al rango [desde, hasta] pedido.
 */
export async function fetchDividendosFuturos(
  tickers: string[],
  desde: string,
  hasta: string,
  tenencias: Record<string, number> = {},
  precios: Record<string, number> = {},
): Promise<EventoCalendario[]> {
  const wanted = new Set(tickers.map((t) => t.toUpperCase()));
  if (wanted.size === 0) return [];

  const hoy = new Date();
  const dias: string[] = [];
  for (let i = 0; i <= HORIZONTE_DIAS; i++) {
    const d = new Date(hoy.getTime() + i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    if (iso >= desde && iso <= hasta) dias.push(iso);
  }

  const resultados = await Promise.all(dias.map((d) => fetchDiaNasdaq(d)));

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

      eventos.push({
        ticker: sym,
        tipo: 'dividendo-fut',
        fecha: pagoIso,
        detalle: 'Confirmado',
        ...(montoEstimado != null ? { montoEstimado, monedaMonto: 'USD' } : {}),
      });
    }
  }

  return eventos;
}
