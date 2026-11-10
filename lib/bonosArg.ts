import type { EventoCalendario } from '@/types';

// Por qué el mapeo es el universo completo y no los bonos de la cartera:
// docs/decisiones/0030-repo-privado-y-espejo-publico.md
// De dónde salen los pagos pasados y por qué se registran en el Sheet:
// docs/decisiones/0031-pagos-de-bonos-pasados-desde-la-ficha-y-el-sheet.md
//
// ── Tres fuentes para el flujo de un bono ────────────────────────────────────
//
// - bonistas.com/proximos-pagos: el universo de pagos FUTUROS. Un pago sale de
//   la lista antes de su fecha, así que por sí sola el calendario perdía cada
//   renta y amortización apenas ocurría.
// - La ficha de cada bono en bonistas (`flow_past`): los últimos 4 pagos ya
//   ocurridos, no la historia completa. Cuando el bono vence la ficha deja de
//   existir (redirige a la home) y con ella esos pagos.
// - La hoja `PagosBonos` del Sheet (lib/pagosBonos.ts): lo que el job semanal
//   registró de la cartera. Es la única que conserva los pagos de bonos ya
//   vencidos o vendidos, y la única cuyo monto no se recalcula con la tenencia
//   de hoy.
//
// Si un pago aparece en más de una, gana proximos-pagos (el dato vivo, para
// lo que todavía no pasó), después el Sheet y por último la ficha.

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

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas

/** Moneda en la que se acredita un pago. bonistas distingue "USD MEP" de "USD CABLE"; acá no. */
export type MonedaPago = 'USD' | 'ARS';

/** Un pago de un bono, por 100 nominales, ya traducido al ticker de cartera. */
export interface PagoBono {
  ticker: string;
  fecha: string;        // "YYYY-MM-DD"
  moneda: MonedaPago;
  cupon: number;        // renta por 100 nominales
  principal: number;    // amortización por 100 nominales
  origen: 'proximos' | 'ficha';
}

/** Un pago registrado en la hoja `PagosBonos`, con el cobro estimado el día que se registró. */
export interface PagoRegistrado {
  ticker: string;
  fecha: string;
  moneda: MonedaPago;
  cupon: number;
  principal: number;
  cobroRenta: number | null;
  cobroAmort: number | null;
  registrado: string;   // "YYYY-MM-DD"
}

/**
 * Normaliza la moneda del pago. proximos-pagos la trae explícita ("ARS",
 * "USD", "USD MEP", "USD CABLE"); la ficha no, y ahí se deduce de la familia:
 * dentro del universo mapeado solo los soberanos USD pagan en dólares.
 */
export function monedaCanonica(raw: string | undefined, familia?: string | null): MonedaPago {
  const m = (raw ?? '').trim().toUpperCase();
  if (m.startsWith('USD')) return 'USD';
  if (m === 'ARS') return 'ARS';
  const f = (familia ?? '').toUpperCase();
  return f.startsWith('BONO-USD') || f.startsWith('BOPREAL') ? 'USD' : 'ARS';
}

// ── proximos-pagos ───────────────────────────────────────────────────────────

interface PagoProximo {
  symbol: string;
  fecha: string;        // "YYYY-MM-DD"
  cupon: number;        // renta por 100 nominales
  principal: number;    // amortización por 100 nominales
  saldo: number;        // valor residual al momento del pago
  total: number;
  moneda: string;
  bond_family?: string;
}

let cacheProximos: { payments: PagoProximo[]; ts: number } | null = null;

/** Extrae el array initialPayments embebido en el HTML de bonistas.com/proximos-pagos. */
async function fetchPagosProximos(): Promise<PagoProximo[]> {
  if (cacheProximos && Date.now() - cacheProximos.ts < CACHE_MS) return cacheProximos.payments;

  const res = await fetch('https://bonistas.com/proximos-pagos', {
    headers: { 'User-Agent': USER_AGENT },
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

  const payments: PagoProximo[] = JSON.parse(html.slice(arrStart, end));
  cacheProximos = { payments, ts: Date.now() };
  return payments;
}

// ── Ficha del bono (flow_past) ───────────────────────────────────────────────

export interface FlujoFicha {
  familia: string | null;
  pasados: { fecha: string; cupon: number; principal: number }[];
}

const cacheFichas = new Map<string, { flujo: FlujoFicha | null; ts: number }>();

/**
 * Lee `bondData.flow_past` del `__NEXT_DATA__` de la ficha de un bono. Devuelve
 * null si la página no trae bondData: es lo que pasa con un bono vencido, cuya
 * URL redirige a la home. No es un error, el bono ya no tiene ficha.
 */
export function parsearFichaBono(html: string): FlujoFicha | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let bondData: { bond?: { bond_family?: unknown }; flow_past?: unknown } | undefined;
  try {
    bondData = JSON.parse(m[1])?.props?.pageProps?.bondData;
  } catch {
    throw new Error('bonistas.com: __NEXT_DATA__ de la ficha malformado');
  }
  if (!bondData) return null;

  const crudos = Array.isArray(bondData.flow_past) ? bondData.flow_past : [];
  const pasados: FlujoFicha['pasados'] = [];
  for (const p of crudos as Record<string, unknown>[]) {
    const fecha = String(p?.fecha ?? '');
    const cupon = Number(p?.cupon ?? 0);
    const principal = Number(p?.principal ?? 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(cupon) || !Number.isFinite(principal)) continue;
    pasados.push({ fecha, cupon, principal });
  }
  const familia = typeof bondData.bond?.bond_family === 'string' ? bondData.bond.bond_family : null;
  return { familia, pasados };
}

async function fetchFichaBono(simbolo: string): Promise<FlujoFicha | null> {
  const cacheado = cacheFichas.get(simbolo);
  if (cacheado && Date.now() - cacheado.ts < CACHE_MS) return cacheado.flujo;

  const res = await fetch(
    `https://bonistas.com/bono-cotizacion-rendimiento-precio-hoy/${encodeURIComponent(simbolo)}`,
    { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) throw new Error(`bonistas.com ficha ${simbolo}: HTTP ${res.status}`);
  const flujo = parsearFichaBono(await res.text());
  cacheFichas.set(simbolo, { flujo, ts: Date.now() });
  return flujo;
}

// ── Pagos de bonistas, combinados ────────────────────────────────────────────

const claveDe = (p: { ticker: string; fecha: string }) => `${p.ticker}|${p.fecha}`;

/**
 * Pagos de los `tickers` (de cartera) en [desde, hasta], de proximos-pagos y,
 * si el rango incluye días anteriores a `hoy`, del `flow_past` de cada ficha.
 * Una fuente que falla no tira el resto: su error va en `errores`.
 */
export async function pagosDeBonistas(
  tickers: string[],
  desde: string,
  hasta: string,
  hoy: string,
): Promise<{ pagos: PagoBono[]; errores: string[] }> {
  // Símbolo bonista → ticker original, solo para los tickers pedidos que tengan mapeo.
  const simboloATicker = new Map<string, string>();
  for (const t of tickers) {
    const sym = MAPEO_BONOS_ARG[t.toUpperCase()];
    if (sym) simboloATicker.set(sym, t.toUpperCase());
  }
  if (simboloATicker.size === 0) return { pagos: [], errores: [] };

  const porClave = new Map<string, PagoBono>();
  const errores: string[] = [];

  if (desde < hoy) {
    const simbolos = [...simboloATicker.keys()];
    const fichas = await Promise.allSettled(simbolos.map(fetchFichaBono));
    fichas.forEach((r, i) => {
      if (r.status === 'rejected') {
        errores.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
        return;
      }
      if (!r.value) return;
      const ticker = simboloATicker.get(simbolos[i])!;
      for (const p of r.value.pasados) {
        if (p.fecha < desde || p.fecha > hasta || p.fecha >= hoy) continue;
        const pago: PagoBono = {
          ticker, fecha: p.fecha, moneda: monedaCanonica(undefined, r.value.familia),
          cupon: p.cupon, principal: p.principal, origen: 'ficha',
        };
        porClave.set(claveDe(pago), pago);
      }
    });
  }

  // Si proximos-pagos falla, los pasados (fichas y Sheet) se muestran igual.
  let proximos: PagoProximo[] = [];
  try {
    proximos = await fetchPagosProximos();
  } catch (e) {
    errores.push(e instanceof Error ? e.message : String(e));
  }

  for (const p of proximos) {
    const ticker = simboloATicker.get(p.symbol);
    if (!ticker) continue;
    if (p.fecha < desde || p.fecha > hasta) continue;
    const pago: PagoBono = {
      ticker, fecha: p.fecha, moneda: monedaCanonica(p.moneda, p.bond_family),
      cupon: p.cupon, principal: p.principal, origen: 'proximos',
    };
    porClave.set(claveDe(pago), pago); // pisa a la ficha: es el dato vivo
  }

  const pagos = [...porClave.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { pagos, errores };
}

/**
 * Factor de escala = nominales/100 de la posición, o null si falta algún dato.
 *
 * nominales ≈ tenencia / precio_por_100 × 100, y el flujo de bonistas ya viene
 * "por 100 nominales", así que cobro = factor × monto_por_100.
 *
 * Para bonos que pagan en ARS (CER, duales, dollar-linked, Lecap/Boncap), los
 * nominales se calculan con el precio en pesos del símbolo base (`preciosArs`,
 * no la especie "D"/cable) y la tenencia convertida a pesos vía `mep` — usar el
 * precio USD-cable ahí daría un factor equivocado porque esos bonos no siempre
 * cotizan en esa especie. El pago resultante queda en ARS, como paga realmente
 * el bono, no convertido a USD.
 */
export function factorNominales(
  ticker: string,
  moneda: MonedaPago,
  tenencias: Record<string, number>,
  precios: Record<string, number>,
  preciosArs: Record<string, number>,
  mep: number | null,
): number | null {
  const tenenciaUsd = tenencias[ticker];
  if (!tenenciaUsd) return null;
  if (moneda === 'ARS') {
    const precioArs = preciosArs[ticker];
    return precioArs && mep ? (tenenciaUsd * mep) / precioArs : null;
  }
  const precio = precios[ticker];
  return precio ? tenenciaUsd / precio : null;
}

function eventosDe(
  p: { ticker: string; fecha: string; moneda: MonedaPago; cupon: number; principal: number },
  cobroRenta: number | null,
  cobroAmort: number | null,
  estimadoAl?: string,
): EventoCalendario[] {
  const eventos: EventoCalendario[] = [];
  const extra = estimadoAl ? { estimadoAl } : {};
  if (p.cupon > 0) {
    eventos.push({
      ticker: p.ticker,
      tipo: 'renta',
      fecha: p.fecha,
      detalle: `Renta ${p.cupon.toFixed(2)} ${p.moneda}/100 VN`,
      ...(cobroRenta != null ? { montoEstimado: cobroRenta, monedaMonto: p.moneda } : {}),
      ...extra,
    });
  }
  if (p.principal > 0) {
    eventos.push({
      ticker: p.ticker,
      tipo: 'amortizacion',
      fecha: p.fecha,
      detalle: `Amort. ${p.principal.toFixed(2)} ${p.moneda}/100 VN`,
      ...(cobroAmort != null ? { montoEstimado: cobroAmort, monedaMonto: p.moneda } : {}),
      ...extra,
    });
  }
  return eventos;
}

/**
 * Eventos de renta y amortización en [desde, hasta]: los de bonistas para los
 * `tickers` de la cartera, más todos los `registrados` en el Sheet de ese rango,
 * estén o no en la cartera de hoy (un bono vencido o vendido sigue ahí).
 *
 * El cobro de un pago de bonistas se estima con la tenencia y el precio de hoy;
 * el de uno registrado es el que se estimó el día del registro (`estimadoAl`).
 */
export async function fetchBonosArg(
  tickers: string[],
  desde: string,
  hasta: string,
  tenencias: Record<string, number> = {},
  precios: Record<string, number> = {},
  preciosArs: Record<string, number> = {},
  mep: number | null = null,
  registrados: PagoRegistrado[] = [],
  hoy: string = new Date().toISOString().slice(0, 10),
): Promise<{ eventos: EventoCalendario[]; errores: string[] }> {
  const { pagos, errores } = await pagosDeBonistas(tickers, desde, hasta, hoy);

  type Fuente = { pago: PagoBono } | { registrado: PagoRegistrado };
  const porClave = new Map<string, Fuente>();
  for (const pago of pagos) porClave.set(claveDe(pago), { pago });
  for (const r of registrados) {
    if (r.fecha < desde || r.fecha > hasta) continue;
    const previo = porClave.get(claveDe(r));
    if (previo && 'pago' in previo && previo.pago.origen === 'proximos') continue;
    porClave.set(claveDe(r), { registrado: r });
  }

  const eventos: EventoCalendario[] = [];
  for (const f of porClave.values()) {
    if ('registrado' in f) {
      const r = f.registrado;
      eventos.push(...eventosDe(r, r.cobroRenta, r.cobroAmort, r.registrado));
    } else {
      const p = f.pago;
      const factor = factorNominales(p.ticker, p.moneda, tenencias, precios, preciosArs, mep);
      eventos.push(...eventosDe(
        p,
        factor != null ? factor * p.cupon : null,
        factor != null ? factor * p.principal : null,
      ));
    }
  }
  eventos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  return { eventos, errores };
}
