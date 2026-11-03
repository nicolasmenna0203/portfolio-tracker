import { MAPEO_BONOS_ARG } from './bonosArg';
import { readSheet } from './sheets';
import { parsearTickersEspeciales, RANGO_TICKERS_ESPECIALES } from './tickersEspeciales';

// Decisión y alternativas descartadas: docs/decisiones/0004-grupos-de-bono-y-tir-no-comparables.md
//
// ── Métricas de renta fija (TIR, duration, paridad) desde bonistas.com ─────
//
// bonistas.com embebe un array "bondData" (Next.js __NEXT_DATA__) en varias
// de sus páginas de contenido (ej. /bonos-cer-hoy), con el universo completo
// de bonos/ONs que trackean — no solo los de la categoría de esa página.
// Mismo patrón de scraping que ya usa bonosArg.ts para /proximos-pagos.

/** Agrupamiento por tipo de tasa — TIRs de distinto grupo no son comparables entre sí. */
export type GrupoBono = 'USD' | 'CER' | 'ARS_TASA' | 'DOLLAR_LINKED' | 'BOPREAL' | 'ONS_USD';

// Tickers puntuales excluidos a pedido (no una familia entera): hoja
// TickersEspeciales, REGLA=EXCLUIR_BONO. Si la hoja no se puede leer no se
// excluye nada: un bono de más en la curva es mejor que perder la sección.
async function leerExcluidos(): Promise<Set<string>> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) return new Set();
  try {
    return parsearTickersEspeciales(await readSheet(id, RANGO_TICKERS_ESPECIALES)).excluirBono;
  } catch (e) {
    // console.warn va a stderr: el MCP usa stdout para JSON-RPC.
    console.warn('No se pudo leer la hoja TickersEspeciales:', e instanceof Error ? e.message : e);
    return new Set();
  }
}

export interface BondMetric {
  ticker: string;          // símbolo cartera (ej. "GD35") si hay match en MAPEO_BONOS_ARG, si no el de bonistas
  tickerCartera: string | null; // ticker cartera solo si este bono está mapeado (para cruzar tenencias)
  bondFamily: string;
  /** Emisor tal cual lo publica bonistas (ej. "YPF S.A.", "Pampa Energía", "Argentino"). */
  emisor: string | null;
  moneda: string;         // moneda en la que se calculó la TIR (USD o ARS)
  grupo: GrupoBono;        // USD hard-dollar / CER (ajustado inflación, incluye duales CER/TAMAR) / ARS tasa (LECAP, Tamar, Badlar) / dollar-linked / BOPREAL / ONS_USD (corporativas)
  etiqueta: string | null;  // aclaración sobre el grupo (ej. "CER/TAMAR" en duales) cuando el grupo solo no alcanza para describir el instrumento
  tir: number;             // TIR efectiva anual, en tanto por uno
  tna: number;             // tasa nominal anual, en tanto por uno
  modifiedDuration: number; // años
  parity: number | null;    // precio/valor técnico, en tanto por uno (1 = a la par)
  fairValue: number | null;
  lastPrice: number | null;
  vencimiento: string;      // "YYYY-MM-DD"
  diasAlVencimiento: number;
  /** true si TIR/duration se calcularon acá (ver bonosProvinciales.ts) en vez de venir de bonistas. */
  calculoPropio?: boolean;
}

// bonistas.com también trae tir_down_N/tir_up_N (sensibilidad a shocks de
// precio), pero se descartan: no documentan su fórmula y los valores no
// cuadran ni como TIR resultante absoluta ni como delta sobre la TIR base al
// contrastarlos con la aproximación estándar (ΔTIR ≈ Δprecio% / duration
// modificada). La sensibilidad se calcula en su lugar en performance.ts con
// esa fórmula estándar y verificable.
interface BondDataRaw {
  ticker: string;
  bond_family: string | null;
  emisor: string | null;
  index: string | null;
  tir: number | null;
  tna: number | null;
  modified_duration: number | null;
  parity: number | null;
  fair_value: number | null;
  last_price: number | null;
  end_date: string | null;
  days_to_finish: number | null;
}

let cache: { metrics: Map<string, BondMetric>; ts: number } | null = null;
const CACHE_MS = 6 * 60 * 60 * 1000; // 6 horas

/** Extrae el array bondData embebido en el HTML de cualquier página de contenido de bonistas.com. */
async function fetchBondDataRaw(): Promise<BondDataRaw[]> {
  const res = await fetch('https://bonistas.com/bonos-cer-hoy', {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`bonistas.com: HTTP ${res.status}`);
  const html = await res.text();

  const marker = '"bondData":';
  const start = html.indexOf(marker);
  if (start === -1) throw new Error('bonistas.com: bondData no encontrado');

  const arrStart = html.indexOf('[', start);
  let depth = 0, end = -1;
  for (let i = arrStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end === -1) throw new Error('bonistas.com: array bondData malformado');

  return JSON.parse(html.slice(arrStart, end));
}

/**
 * Mapa ticker → métricas de renta fija (TIR, TNA, duration, paridad,
 * sensibilidad) del universo de deuda pública y obligaciones negociables
 * corporativas hard-dollar que trackea bonistas.com (soberanos +
 * Lecap/Boncap/Bonte-TX/BOPREAL, aunque el dataset los etiquete con emisor
 * "BCRA" sin distinguirlos de letras de regulación monetaria del Central —
 * no hay forma de diferenciarlos con los campos disponibles, y ya varios de
 * esos tickers están confirmados como Tesoro en MAPEO_BONOS_ARG; más ONs de
 * YPF/Pampa/Vista/Tecpetrol/etc. en su propio grupo ONS_USD, nunca mezcladas
 * con la curva soberana), no solo los tickers de MAPEO_BONOS_ARG. bonistas.com
 * no cubre deuda provincial (Buenos Aires u otras) con TIR/duration, así que
 * no puede incluirse desde esta fuente.
 * Cuando el símbolo bonista tiene equivalente en MAPEO_BONOS_ARG, la entrada
 * usa el ticker cartera (ej. "GD35") como clave para poder cruzar tenencias;
 * si no, usa el ticker sin sufijo de especie (ej. "AL41", no "AL41D").
 * Cuando un ticker normalizado aparece más de una vez (ej. sus 3 especies
 * Pesos/D/C, o distinta legislación LA/NY), se queda con el primero tras
 * priorizar la especie mapeada — no hay forma de saber cuál corresponde a la
 * tenencia sin ese dato en el Sheet.
 */
export async function fetchBondMetrics(): Promise<Map<string, BondMetric>> {
  if (cache && Date.now() - cache.ts < CACHE_MS) return cache.metrics;

  const [raw, excluidos] = await Promise.all([fetchBondDataRaw(), leerExcluidos()]);

  // Símbolo bonista → ticker cartera, solo para el subconjunto mapeado.
  const simboloATickerCartera = new Map<string, string>();
  for (const [ticker, simbolo] of Object.entries(MAPEO_BONOS_ARG)) {
    simboloATickerCartera.set(simbolo, ticker);
  }

  // Bonistas no garantiza el orden de aparición de las varias especies de un
  // mismo bono (Pesos/D/C/P) ni de duplicados por legislación distinta — se
  // ordena para que la especie "correcta" gane siempre el `metrics.has` de
  // abajo, no la que azarosamente venga primero en el JSON: 1º la mapeada en
  // MAPEO_BONOS_ARG (la que se usa para cruzar tenencias), 2º entre las no
  // mapeadas, la que no lleva sufijo de especie D/C (ej. TY30P sobre TY30D)
  // — es la que suele usarse como "ticker de pizarra".
  const ordenados = [...raw].sort((a, b) => {
    const aMapeado = simboloATickerCartera.has(a.ticker) ? 0 : 1;
    const bMapeado = simboloATickerCartera.has(b.ticker) ? 0 : 1;
    if (aMapeado !== bMapeado) return aMapeado - bMapeado;
    const aEspecie = /[DC]$/.test(a.ticker) ? 1 : 0;
    const bEspecie = /[DC]$/.test(b.ticker) ? 1 : 0;
    return aEspecie - bEspecie;
  });

  const metrics = new Map<string, BondMetric>();
  const vencimientosVistos = new Set<string>();
  for (const r of ordenados) {
    if (r.tir == null || r.tna == null || r.modified_duration == null) continue;
    // tir=0 y duration=0 a la vez es bonistas marcando "sin dato" (ONs sin
    // cotización), no un bono real a la par con duration cero — nunca aparece
    // duration=0 con tir≠0. Sin este filtro ensucian el scatter en el origen
    // y arrastran la línea de tendencia.
    if (r.tir === 0 && r.modified_duration === 0) continue;
    // Variante del mismo problema con last_price roto (ej. TB27 con
    // last_price=0.01): bonistas no vuelve a poner duration en 0, la fórmula
    // internamente divide por un precio casi nulo y devuelve una duration en
    // los miles de años (4308 en vez de ~1) junto con tir=0 — mismo "sin
    // dato" real, disfrazado. parity < 0.01 (debería rondar 0.3-1.5, 1 = a la
    // par) es la señal confiable: ningún bono con cotización real tiene
    // paridad tan baja.
    if (r.tir === 0 && r.parity != null && r.parity < 0.01) continue;
    // Duration menor a ~73 días (0.2 años): la TIR anualizada de un
    // instrumento a semanas del vencimiento o del próximo cupón amplifica
    // cualquier ruido de precio a valores sin sentido económico (ej. una ON
    // a 18 días con TIR de -145% TNA) aunque el precio esté bien — es un
    // artefacto de la anualización, no información sobre el rendimiento real
    // del instrumento. Se ve sobre todo en ONs de corto plazo; no excluye
    // ningún ticker mapeado a la cartera (verificado contra MAPEO_BONOS_ARG).
    if (r.modified_duration < 0.2) continue;
    // Precio con escala rota en la fuente para esa especie puntual (ej.
    // YMCPO: last_price=46216 cuando fair_value=100 — off por ~460x) deja
    // una paridad implausible (0.30-0.51 en vez de converger a ~1) en un
    // instrumento a meses del vencimiento, lo que arrastra la TIR a valores
    // absurdos (455%). Paridad baja SÍ puede ser legítima en un bono largo
    // castigado (ej. CUAP a CER, parity 0.55 con duration 9.7 años y TIR
    // sana de 9%) — por eso la señal es la combinación con duration corta
    // (<2 años), no la paridad sola: a esa distancia del vencimiento un bono
    // performing converge a la par salvo default real, que el campo
    // `performing` ya descartaría aparte.
    if (r.modified_duration < 2 && r.parity != null && (r.parity < 0.7 || r.parity > 1.3)) continue;
    // bond_family "ONS"/"ONS-CABLE" son obligaciones negociables corporativas
    // (YPF, Pampa, Vista, Tecpetrol...), no emisiones del Estado — van a su
    // propio grupo ONS_USD (ver más abajo), nunca mezcladas con la curva
    // soberana: mismo riesgo de tasa pero distinto riesgo de crédito.
    const esOns = r.bond_family?.startsWith('ONS') ?? false;
    // Tickers con sufijo (_PUT, _CAP, _TAM, _CER) no son bonos comprables de
    // forma independiente: _PUT son opciones (TIR sin relación con duration,
    // ej. -75% u 23%), _CAP trae TIR negativas que no coinciden con su propia
    // short_description, y _TAM/_CER son "piernas" hipotéticas de un dual
    // (qué pagaría si gana esa pata) con TIR siempre en 0 — dato dummy, no
    // calculado. Todos ensuciaban la curva o el universo con ruido.
    if (r.ticker.includes('_')) continue;
    if (r.end_date == null || r.days_to_finish == null) continue;
    // Exclusiones puntuales de tickers específicos (no de toda una familia).
    if (excluidos.has(r.ticker)) continue;
    // BOPREAL: bonistas expone el mismo instrumento bajo 2 familias de
    // ticker — "BPOx7"/"BPOx8" (especie Pesos, sin sufijo D/C) y "BPx7D"/
    // "BPx7C"/"BPx8D"/"BPx8C" (especies D/Cable del mismo bono, sin la "O").
    // Mismo vencimiento y cupón que su par BPOx — no son bonos aparte, así
    // que se descarta la familia sin "O" para no duplicar el universo (se
    // conserva "BPOx7"/"BPOx8", que es la que ya se usaba en pantalla).
    if (/^BP[A-D][78][DC]?$/.test(r.ticker) && !/^BPO/.test(r.ticker)) continue;

    // Cada bono USD hard-dollar cotiza en 3 especies del mismo instrumento
    // (ej. GD35 en Pesos, GD35D en MEP/cable, GD35C en Cable/Contado con
    // Liqui) — mismo flujo de fondos, distinta liquidación. Mostrar las 3
    // duplicaría el bono en la curva/tabla, así que se normaliza al ticker
    // base (sin sufijo D/C) y se usa esa única entrada. Solo D/C son sufijo
    // de especie pura acá — a diferencia de TY30P más abajo, "GD35" sin
    // sufijo también circula como ticker propio (especie Pesos). Las ONs no
    // entran acá aunque también sean index "USS": su sufijo de especie es
    // C/D/O (no solo D/C) y la raíz no siempre es limpia (ej. "MC11D" y
    // "MCC1D" son la misma especie de la misma ON, no comparten prefijo) —
    // van por claveVencimiento más abajo, como el resto de no-USS.
    const tickerBase = esOns ? r.ticker : r.ticker.replace(/[DC]$/, '');

    // Otros bonos/letras (Lecap/Boncap/Bonte-TX/Tamar/BOPREAL/ONs) también
    // tienen especies duplicadas, pero ahí el ticker de la especie USD no
    // sigue el patrón "base + D/C" (ej. TML27 → TML7D, TY30P → TY30D — la P
    // de TY30P es parte del nombre, no un sufijo separable). Se deduplica por emisor + índice + vencimiento en su
    // lugar: si ya se vio una entrada con esa combinación, esta es la
    // especie duplicada y se descarta (prevalece la primera, priorizada por
    // el sort de arriba). No se usa para bonos soberanos USD hard-dollar
    // (index "USS", no ONs): ahí distintos bonos (AL35 vs GD35, distinta
    // legislación) comparten emisor/vencimiento/index legítimamente y el
    // regex de ticker ya los separa bien.
    const tickerCartera = simboloATickerCartera.get(r.ticker) ?? simboloATickerCartera.get(tickerBase) ?? null;
    const claveVencimiento = (esOns || r.index !== 'USS') ? `${r.emisor}|${r.index}|${r.end_date}` : null;
    // Excepción: si ESTE ticker está mapeado a su propio ticker de cartera
    // (ej. dos especies del Discount o del Par ley Arg, que cotizan por
    // separado y se pueden tener como posiciones distintas), no se descarta
    // por colisión de vencimiento aunque la clave ya esté vista: como
    // MAPEO_BONOS_ARG cubre todo el universo, las dos especies quedan en la
    // curva como puntos propios. Si no está mapeado, sí se descarta cuando la
    // clave ya fue vista (haya sido por una entrada mapeada o no).
    if (claveVencimiento && vencimientosVistos.has(claveVencimiento) && tickerCartera == null) continue;

    const ticker = tickerCartera ?? tickerBase;
    if (metrics.has(ticker)) continue;
    if (claveVencimiento) vencimientosVistos.add(claveVencimiento);

    // "USS" = hard dollar (ley cable) → USD. "CER" = ajustado por inflación.
    // "USDL" = dollar-linked: sigue al tipo de cambio, no a la inflación ni a
    // una tasa en pesos — grupo aparte, no comparable con los otros tres.
    // Duales: pagan el máximo entre dos piernas, pero bonistas.com NUNCA
    // separa la TIR de cada pierna — todos los campos candidatos (tir_val,
    // tir_t0, ttir, uptir) vienen null/0 en los 18 registros duales del
    // dataset, solo hay una TIR "efectiva" del instrumento completo (que ya
    // asume qué pata gana). Por eso ningún dual —ni los CER/TAMAR (TXMJ0,
    // TXMJ8, TXMD8, TXMJ9...) ni los Fija/TAMAR— va al grupo CER:
    // mezclarían una TIR no comparable con la de los CER puros (TX31,
    // TZXM8...) y arruinarían la curva/regresión de ese grupo. Todos los
    // duales quedan en ARS_TASA, distinguidos entre sí solo por `etiqueta`
    // ("CER/TAMAR" vs. "Fija/TAMAR").
    //
    // index "DualCER" = CER/TAMAR (ej. TXMJ0). index "Dual" a secas
    // normalmente es Fija/TAMAR, salvo TXMJ9: bonistas le
    // pone index "Dual" y una description de texto "tasa fija y TAMAR" que
    // son ERRATA de carga de esa fuente — TXMJ9 es un dual CER/TAMAR real
    // (paga el máximo entre capital ajustado por CER, o TAMAR + 3% margen;
    // confirmado por prensa especializada, no solo por bonistas). Su
    // bond_family ("DUAL-CER-TAMAR") sí es correcto, así que para
    // desambiguar el caso "Dual" se usa bond_family como señal adicional en
    // vez de confiar ciegamente en index/description.
    const esDualCer = r.index === 'DualCER' || (r.index === 'Dual' && r.bond_family === 'DUAL-CER-TAMAR');
    const esDualFijaTamar = r.index === 'Dual' && !esDualCer;
    // BOPREAL (BCRA, deuda comercial con importadores) cotiza en especie
    // hard-dollar igual que los soberanos (index "USS"), pero es un emisor y
    // un riesgo de crédito distintos — no comparable en la misma curva que
    // GD35/GD46/AL35. bond_family lo identifica sin ambigüedad, pero varía
    // según la especie del ticker ("BOPREAL-PESOS" en BPOx7/BPOx8 sin
    // sufijo, "BOPREAL"/"BOPREAL-CABLE" en la familia BPx7D/BPx7C sin la
    // "O" — ya excluida más arriba por duplicar el mismo instrumento), así
    // que se matchea por prefijo en vez de una lista exacta de valores.
    const esBopreal = r.bond_family?.startsWith('BOPREAL') ?? false;
    // Las ONs (YPF, Pampa, Vista...) cotizan en las mismas especies "USS"/
    // "USDL" que la deuda soberana, pero son otro emisor y otro riesgo de
    // crédito — van a su propio grupo, nunca mezcladas en la curva USD/
    // DOLLAR_LINKED de los soberanos. bonistas no distingue hard-dollar de
    // dollar-linked dentro de ONS (ambas conviven bajo "USS"/"USDL"), así que
    // acá no hace falta partirlas en dos: se agrupan todas en ONS_USD.
    const grupo: GrupoBono =
      esOns ? 'ONS_USD' :
      esBopreal ? 'BOPREAL' :
      r.index === 'USS' ? 'USD' :
      r.index === 'USDL' ? 'DOLLAR_LINKED' :
      r.index === 'CER' ? 'CER' :
      'ARS_TASA';
    // Dentro de ARS_TASA no dual, el `index` distingue el tipo de tasa que
    // rige cada bono — no son comparables entre sí (Lecap a tasa fija vs.
    // Boncap TAMAR vs. Badlar), así que se etiquetan todos, no solo los
    // duales: "Fijo" (Lecap/Boncap, TEM capitalizable) → "Fija", "Tamar"
    // (TAMAR + spread) → "TAMAR", "Badlar" → "Badlar".
    const etiquetaTasa =
      esDualCer ? 'CER/TAMAR' :
      esDualFijaTamar ? 'Fija/TAMAR' :
      grupo === 'ARS_TASA' && r.index === 'Fijo' ? 'Fija' :
      grupo === 'ARS_TASA' && r.index === 'Tamar' ? 'TAMAR' :
      grupo === 'ARS_TASA' && r.index === 'Badlar' ? 'Badlar' :
      null;

    metrics.set(ticker, {
      ticker,
      tickerCartera,
      bondFamily: r.bond_family ?? '',
      emisor: r.emisor,
      moneda: grupo === 'USD' || grupo === 'BOPREAL' || grupo === 'ONS_USD' ? 'USD' : 'ARS',
      grupo,
      etiqueta: etiquetaTasa,
      tir: r.tir,
      tna: r.tna,
      modifiedDuration: r.modified_duration,
      parity: r.parity,
      fairValue: r.fair_value,
      lastPrice: r.last_price,
      vencimiento: r.end_date,
      diasAlVencimiento: r.days_to_finish,
    });
  }

  cache = { metrics, ts: Date.now() };
  return metrics;
}
