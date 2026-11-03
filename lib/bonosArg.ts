import type { EventoCalendario } from '@/types';

// Por qué el mapeo es el universo completo y no los bonos de la cartera:
// docs/decisiones/0030-repo-privado-y-espejo-publico.md

// ── Mapeo cartera/BYMA → símbolo de bonistas.com ──────────────────────────────
// Solo se incluyen tickers con match EXACTO contra el dataset de bonistas
// (símbolo idéntico o especie "D"/cable). Meter un ticker mal mapeado mostraría
// el flujo de OTRO bono, así que se prefiere omitir antes que adivinar.
//
// Es el universo completo de bonos del Tesoro con pagos próximos que publica
// bonistas.com/proximos-pagos (initialPayments), generado al 2026-11-03: todas
// las familias salvo ONs y BOPREAL, sin las "piernas" de los duales (_CER). No
// es la lista de bonos de la cartera — el repo es público — y por eso un bono
// que cualquiera tenga queda cubierto sin tocar el código. Un bono nuevo que
// salga a mercado hay que agregarlo acá con el mismo criterio de match exacto.
export const MAPEO_BONOS_ARG: Record<string, string> = {
  // Soberanos USD (especie cable "D")
  AE38: 'AE38D', AL29: 'AL29D', AL30: 'AL30D', AL35: 'AL35D', AL41: 'AL41D',
  AN29: 'AN29D', AO27: 'AO27D', AO28: 'AO28D', AO29: 'AO29D', GD29: 'GD29D',
  GD30: 'GD30D', GD35: 'GD35D', GD38: 'GD38D', GD41: 'GD41D', GD46: 'GD46D',
  // CER (símbolo idéntico)
  CUAP: 'CUAP', DICP: 'DICP', DIP0: 'DIP0', PAP0: 'PAP0', PARP: 'PARP',
  TX26: 'TX26', TX28: 'TX28', TX31: 'TX31', TZX27: 'TZX27', TZX28: 'TZX28',
  TZXA7: 'TZXA7', TZXD6: 'TZXD6', TZXD7: 'TZXD7', TZXD8: 'TZXD8', TZXM7: 'TZXM7',
  TZXM8: 'TZXM8', TZXM9: 'TZXM9', TZXO7: 'TZXO7', TZXS7: 'TZXS7', TZXS8: 'TZXS8',
  TZXY7: 'TZXY7', X30N6: 'X30N6',
  // Duales
  TTD26: 'TTD26', TXMD8: 'TXMD8', TXMD9: 'TXMD9', TXMJ0: 'TXMJ0', TXMJ8: 'TXMJ8',
  TXMJ9: 'TXMJ9',
  // Dollar-linked
  D10Y7: 'D10Y7', D31M7: 'D31M7', TZV27: 'TZV27', TZV28: 'TZV28', TZVD8: 'TZVD8',
  // Tasa fija (Lecap / Boncap)
  S13N6: 'S13N6', S30N6: 'S30N6', T15E7: 'T15E7', T30A7: 'T30A7', T30J7: 'T30J7',
  T31Y7: 'T31Y7', TY30P: 'TY30P',
  // TAMAR / Badlar
  BDC28: 'BDC28', TB27: 'TB27', TMF27: 'TMF27', TMF28: 'TMF28', TMG27: 'TMG27',
  TMG28: 'TMG28', TML27: 'TML27',
};

interface PagoBonista {
  symbol: string;
  fecha: string;        // "YYYY-MM-DD"
  cupon: number;        // renta por 100 nominales
  principal: number;    // amortización por 100 nominales
  saldo: number;        // valor residual tras el pago
  total: number;
  moneda: string;
  bond_family?: string;
}

let cache: { payments: PagoBonista[]; ts: number } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas

/** Extrae el array initialPayments embebido en el HTML de bonistas.com/proximos-pagos. */
async function fetchPagosBonistas(): Promise<PagoBonista[]> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.payments;

  const res = await fetch('https://bonistas.com/proximos-pagos', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`bonistas.com: HTTP ${res.status}`);
  const html = await res.text();

  // El HTML trae "initialPayments":[...] dentro del JSON de __NEXT_DATA__.
  const marker = '"initialPayments":';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('bonistas.com: initialPayments no encontrado');

  // Parseo balanceado del array que arranca en el primer '[' tras el marcador.
  const arrStart = html.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = arrStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('bonistas.com: array initialPayments malformado');

  const payments: PagoBonista[] = JSON.parse(html.slice(arrStart, end));
  cache = { payments, ts: Date.now() };
  return payments;
}

/**
 * Devuelve eventos de renta y amortización de los bonos/ONs ARG de la cartera,
 * dentro del rango [desde, hasta], mapeando cada ticker al símbolo de bonistas.
 *
 * Si se pasan `tenencias` (ticker→USD) y `precios` (ticker→USD por 100 nominales),
 * estima el cobro real: nominales ≈ tenencia_usd / precio_por_100 × 100, y el
 * flujo de bonistas ya viene "por 100 nominales", así que
 * cobro = (tenencia_usd / precio_por_100) × monto_por_100.
 *
 * Para bonos que pagan en ARS (CER, duales, dollar-linked, Lecap/Boncap), los
 * nominales se calculan con el precio en pesos del símbolo base (`preciosArs`,
 * no la especie "D"/cable) y la tenencia convertida a pesos vía `mep` — usar el
 * precio USD-cable ahí daría un factor equivocado porque esos bonos no siempre
 * cotizan en esa especie. El pago resultante queda simulado en ARS, como paga
 * realmente el bono, no convertido a USD.
 */
export async function fetchBonosArg(
  tickers: string[],
  desde: string,
  hasta: string,
  tenencias: Record<string, number> = {},
  precios: Record<string, number> = {},
  preciosArs: Record<string, number> = {},
  mep: number | null = null,
): Promise<EventoCalendario[]> {
  // Símbolo bonista → ticker original, solo para los tickers pedidos que tengan mapeo.
  const simboloATicker = new Map<string, string>();
  for (const t of tickers) {
    const sym = MAPEO_BONOS_ARG[t.toUpperCase()];
    if (sym) simboloATicker.set(sym, t.toUpperCase());
  }
  if (simboloATicker.size === 0) return [];

  const payments = await fetchPagosBonistas();
  const eventos: EventoCalendario[] = [];

  for (const p of payments) {
    const ticker = simboloATicker.get(p.symbol);
    if (!ticker) continue;
    if (p.fecha < desde || p.fecha > hasta) continue;

    const moneda = p.moneda || 'USD';
    const tenenciaUsd = tenencias[ticker];

    // Factor de escala = nominales/100. El precio a usar depende de la moneda
    // del pago: en ARS, el bono suele no cotizar en la especie "D"/cable, así
    // que hace falta el precio en pesos del símbolo base + convertir la
    // tenencia (USD, como la guarda el Sheet) a pesos con el MEP spot.
    let factor: number | null = null;
    if (moneda === 'ARS') {
      const precioArs = preciosArs[ticker];
      if (tenenciaUsd && precioArs && mep) factor = (tenenciaUsd * mep) / precioArs;
    } else {
      const precio = precios[ticker];
      if (tenenciaUsd && precio) factor = tenenciaUsd / precio;
    }

    if (p.cupon > 0) {
      eventos.push({
        ticker,
        tipo: 'renta',
        fecha: p.fecha,
        detalle: `Renta ${p.cupon.toFixed(2)} ${moneda}/100 VN`,
        ...(factor != null ? { montoEstimado: factor * p.cupon, monedaMonto: moneda } : {}),
      });
    }
    if (p.principal > 0) {
      eventos.push({
        ticker,
        tipo: 'amortizacion',
        fecha: p.fecha,
        detalle: `Amort. ${p.principal.toFixed(2)} ${moneda}/100 VN`,
        ...(factor != null ? { montoEstimado: factor * p.principal, monedaMonto: moneda } : {}),
      });
    }
  }

  return eventos;
}
