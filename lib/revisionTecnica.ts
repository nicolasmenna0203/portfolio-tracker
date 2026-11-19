// Decisión y alternativas descartadas: docs/decisiones/0039-revision-tecnica-semanal-en-el-mail.md
//
// ── Revisión técnica semanal ────────────────────────────────────────────────
//
// El bloque "Revisión técnica" del mail del domingo: para cada activo con
// niveles cargados, dice en lenguaje llano si en la semana tocó un nivel de
// compra o de venta del plan, si perforó alguno, y si se rompió su tendencia
// de fondo. El mail lo lee alguien que no hace análisis técnico: cada evento
// sale ya traducido a "qué dice el plan", no como señal de trading.
//
// De dónde sale cada cosa:
//
// - **Niveles horizontales** (compra S1-S3, venta R1-R3): una fila por nivel.
//   Vienen de `niveles.json` en la rama `datos-semanales` del repo privado, que
//   el workflow del domingo manda en el cuerpo del POST (ADR 0040); si no
//   vinieron, de la hoja `NivelesTecnicos` del Sheet. No están en el código
//   porque dicen qué activos hay en la cartera, y el código se publica. El
//   código no los reescribe.
// - **Líneas de tendencia**: se recalculan acá cada semana sobre la serie
//   semanal ajustada de Yahoo, con la misma regla con la que se dibujan en el
//   gráfico. No se guardan en ningún lado: guardar los dos puntos de cada línea
//   obligaría a sincronizar el Sheet con el gráfico, y la regla es determinística.
//
// La serie es la ajustada por dividendos (adjclose) porque los niveles se
// fijaron sobre el gráfico con precios ajustados; con el close crudo, un ETF
// que paga dividendo quedaría corrido respecto de sus propias líneas.

import { google } from 'googleapis';
import { getAuth, esHojaInexistente } from './sheets';
import { aliasYahoo } from './tickersElegibles';
import { mapConLimite } from './concurrencia';

export const HOJA = 'NivelesTecnicos';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

/**
 * Qué lugar ocupa el activo en el plan. Decide cómo se traduce un nivel tocado:
 * llegar a un nivel de compra significa "adelantar el aporte" en el núcleo,
 * "comprar el tramo" en un satélite y "nada" en una posición que se está
 * vendiendo.
 */
export const ROLES = ['CORE', 'SATELITE', 'LEGADO', 'CONSOLIDAR', 'RADAR'] as const;
export type Rol = (typeof ROLES)[number];

export interface NivelTecnico {
  /** Símbolo de Yahoo (o su forma natural, que resuelve `aliasYahoo`). */
  ticker: string;
  rol: Rol;
  /** S1, S2, S3 (compra) o R1, R2, R3 (venta). */
  nivel: string;
  lado: 'COMPRA' | 'VENTA';
  precio: number;
  nota: string;
}

// ── Lectura de la hoja ──────────────────────────────────────────────────────

/**
 * Precio escrito a mano en el Sheet: acepta "64,5" y "1.325" (formato
 * argentino) además de "64.5". Un número con punto y exactamente tres
 * decimales en grupos ("1.325", "98.000") se toma como separador de miles,
 * que es como lo muestra el Sheet en locale argentino.
 */
export function parsearPrecio(raw: string): number | null {
  let s = String(raw ?? '').trim().replace(/\s/g, '').replace(/^USD/i, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Filas de la hoja (encabezados Ticker, Rol, Nivel, Precio, Nota) → niveles.
 * Una fila inválida se omite con un aviso en vez de tirar la lectura entera:
 * un typo en un nivel no tiene que dejar el mail sin el resto del bloque.
 */
export function parsearNiveles(filas: Record<string, string>[]): { niveles: NivelTecnico[]; avisos: string[] } {
  const niveles: NivelTecnico[] = [];
  const avisos: string[] = [];
  const campo = (f: Record<string, string>, nombre: string) => {
    const clave = Object.keys(f).find((k) => k.trim().toUpperCase() === nombre);
    return clave ? f[clave].trim() : '';
  };
  filas.forEach((f, i) => {
    const ticker = campo(f, 'TICKER').toUpperCase();
    if (!ticker) return; // fila vacía
    const rol = campo(f, 'ROL').toUpperCase() as Rol;
    const nivel = campo(f, 'NIVEL').toUpperCase();
    const precio = parsearPrecio(campo(f, 'PRECIO'));
    const fila = i + 2; // +1 por el encabezado, +1 porque el Sheet cuenta desde 1
    if (!(ROLES as readonly string[]).includes(rol)) {
      avisos.push(`${HOJA} fila ${fila}: rol "${campo(f, 'ROL')}" desconocido`);
      return;
    }
    if (!/^[SR][1-9]$/.test(nivel)) {
      avisos.push(`${HOJA} fila ${fila}: nivel "${campo(f, 'NIVEL')}" no es S1-S9 ni R1-R9`);
      return;
    }
    if (precio == null) {
      avisos.push(`${HOJA} fila ${fila}: precio "${campo(f, 'PRECIO')}" inválido`);
      return;
    }
    niveles.push({ ticker, rol, nivel, lado: nivel.startsWith('S') ? 'COMPRA' : 'VENTA', precio, nota: campo(f, 'NOTA') });
  });
  return { niveles, avisos };
}

/**
 * Lee la hoja. Si no existe devuelve `null` (el bloque simplemente no sale);
 * cualquier otro error se propaga: ver docs/decisiones/0029-lectura-fallida-no-es-lista-vacia.md
 */
export async function leerNivelesTecnicos(): Promise<{ niveles: NivelTecnico[]; avisos: string[] } | null> {
  const id = process.env.SPREADSHEET_ID;
  if (!id) throw new Error('Falta env var SPREADSHEET_ID');
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: id,
      range: `${HOJA}!A1:E`,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = res.data.values ?? [];
    if (rows.length < 2) return { niveles: [], avisos: [] };
    const [headers, ...data] = rows as string[][];
    const filas = data.map((row) => Object.fromEntries(headers.map((h, i) => [String(h), String(row[i] ?? '')])));
    return parsearNiveles(filas);
  } catch (err) {
    if (esHojaInexistente(err)) return null;
    throw err;
  }
}

// ── Serie semanal ───────────────────────────────────────────────────────────

export interface VelaSemanal {
  /** Unix segundos del inicio de la vela (lunes). */
  t: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Velas semanales de 3 años, ajustadas por dividendos y splits. Yahoo da el
 * adjclose pero no el high/low ajustado: se ajustan con el mismo factor de la
 * vela (adjclose/close), que es como lo hace el gráfico.
 */
export async function serieSemanal(ticker: string): Promise<VelaSemanal[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(aliasYahoo(ticker))}?range=3y&interval=1wk&events=div%2Csplit`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Yahoo ${ticker}: HTTP ${res.status}`);
  const json = await res.json();
  const r = json?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const adj: (number | null)[] = r?.indicators?.adjclose?.[0]?.adjclose ?? [];
  const velas: VelaSemanal[] = [];
  ts.forEach((t, i) => {
    const close = q.close?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    if (typeof close !== 'number' || typeof high !== 'number' || typeof low !== 'number' || close <= 0) return;
    const ajustado = typeof adj[i] === 'number' && adj[i]! > 0 ? adj[i]! : close;
    const f = ajustado / close;
    velas.push({ t, high: high * f, low: low * f, close: ajustado });
  });
  return velas;
}

// ── Líneas de tendencia ─────────────────────────────────────────────────────
//
// Misma regla con la que se dibujan en el gráfico (por eso los números son
// fijos y no parámetros): ventana de 156 velas semanales (3 años) y pivotes de
// ±3 velas.
//
// - Alcista: desde el mínimo de la ventana, la línea hacia el mínimo local
//   posterior (al menos 8 velas después, sin contar las 3 últimas, que todavía
//   no pueden confirmarse como pivote) con la menor pendiente positiva. Por
//   construcción ningún pivote posterior queda debajo: es el piso de la
//   tendencia de fondo.
// - Bajista: solo si el máximo de la ventana tiene más de 6 velas y el precio
//   cayó más de 10% desde ahí. Desde el máximo, hacia el máximo local posterior
//   (al menos 4 velas después) con la pendiente menos negativa: el techo de la
//   caída.
//
// Una pendiente con el signo "equivocado" (alcista que baja, bajista que sube)
// no es una tendencia y no se informa.

const VENTANA = 156;
const PIVOTE = 3;

export interface Linea {
  /** Valor de la línea en la última vela y en la anterior. */
  valor: number;
  valorPrevio: number;
}

export interface Tendencias {
  alcista?: Linea;
  bajista?: Linea;
}

export function calcularTendencias(serie: VelaSemanal[]): Tendencias {
  const w = serie.slice(-VENTANA);
  const m = w.length;
  if (m < 20) return {};
  const ultima = w[m - 1];
  const penultima = w[m - 2];

  let iL = 0;
  let iH = 0;
  w.forEach((v, i) => {
    if (v.low < w[iL].low) iL = i;
    if (v.high > w[iH].high) iH = i;
  });

  const esPivoteBajo = (i: number) => {
    for (let j = Math.max(0, i - PIVOTE); j <= Math.min(m - 1, i + PIVOTE); j++) if (w[j].low < w[i].low) return false;
    return true;
  };
  const esPivoteAlto = (i: number) => {
    for (let j = Math.max(0, i - PIVOTE); j <= Math.min(m - 1, i + PIVOTE); j++) if (w[j].high > w[i].high) return false;
    return true;
  };
  const linea = (t0: number, p0: number, pendiente: number): Linea => ({
    valor: p0 + pendiente * (ultima.t - t0),
    valorPrevio: p0 + pendiente * (penultima.t - t0),
  });

  const out: Tendencias = {};

  let mejorPendiente = Infinity;
  for (let j = iL + 8; j < m - PIVOTE; j++) {
    if (!esPivoteBajo(j)) continue;
    const p = (w[j].low - w[iL].low) / (w[j].t - w[iL].t);
    if (p < mejorPendiente) mejorPendiente = p;
  }
  if (Number.isFinite(mejorPendiente) && mejorPendiente > 0) {
    out.alcista = linea(w[iL].t, w[iL].low, mejorPendiente);
  }

  if (iH < m - 6 && ultima.close < w[iH].high * 0.9) {
    let pendiente = -Infinity;
    for (let j = iH + 4; j < m - PIVOTE; j++) {
      if (!esPivoteAlto(j)) continue;
      const p = (w[j].high - w[iH].high) / (w[j].t - w[iH].t);
      if (p > pendiente) pendiente = p;
    }
    if (Number.isFinite(pendiente) && pendiente < 0) {
      out.bajista = linea(w[iH].t, w[iH].high, pendiente);
    }
  }

  return out;
}

// ── Evaluación semanal ──────────────────────────────────────────────────────

/**
 * Margen para dar un nivel por perforado: dos cierres semanales seguidos más
 * de 2% del otro lado. Arbitrario: menos que eso es ruido de una semana; con
 * un solo cierre, un pinchazo que se recupera el lunes contaría como ruptura.
 */
const MARGEN_RUPTURA = 0.02;

export type TipoEvento =
  | 'toco_compra'
  | 'toco_venta'
  | 'perforo_compra'
  | 'supero_venta'
  | 'rompio_alcista'
  | 'supero_bajista';

export interface EventoTecnico {
  tipo: TipoEvento;
  /** Nivel involucrado (S2, R1...) o null si es una línea de tendencia. */
  nivel: string | null;
  precio: number;
  /** Qué significa para el plan, en lenguaje llano. */
  mensaje: string;
}

export interface EstadoActivo {
  ticker: string;
  rol: Rol;
  cierre: number;
  cierrePrevio: number;
  compraCercana: { nivel: string; precio: number; distancia: number } | null;
  ventaCercana: { nivel: string; precio: number; distancia: number } | null;
  tendencia: 'alcista' | 'rota' | 'sin_dato';
  eventos: EventoTecnico[];
}

const QUE_HACER_COMPRA: Record<Rol, string> = {
  CORE: 'según el plan, conviene adelantar el aporte del mes a este activo',
  SATELITE: 'según el plan, corresponde comprar el tramo de ese nivel',
  RADAR: 'se cumplió su condición de entrada; en el plan entra solo reemplazando otra posición',
  LEGADO: 'el plan no compra más: es una referencia para no vender por debajo de este precio',
  CONSOLIDAR: 'el plan no compra más: es una referencia para no vender por debajo de este precio',
};

const QUE_HACER_VENTA: Record<Rol, string> = {
  CORE: 'solo se recorta si el activo pesa más de lo previsto en la cartera',
  SATELITE: 'según el plan, se recorta hasta volver al peso objetivo',
  RADAR: 'es solo referencia: no está en la cartera',
  LEGADO: 'según el plan, es zona de venta de esta posición',
  CONSOLIDAR: 'según el plan, es zona para pasar esta posición al núcleo',
};

function fmt(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: n >= 100 ? 0 : 2 });
}

/**
 * Estado de un activo en la última vela semanal contra sus niveles y sus
 * líneas de tendencia. Pura: recibe la serie ya bajada.
 */
export function evaluarActivo(ticker: string, rol: Rol, niveles: NivelTecnico[], serie: VelaSemanal[]): EstadoActivo | null {
  if (serie.length < 3) return null;
  const v = serie[serie.length - 1];
  const prev = serie[serie.length - 2];
  const prev2 = serie[serie.length - 3];
  const eventos: EventoTecnico[] = [];

  for (const n of niveles) {
    if (n.lado === 'COMPRA') {
      // "Tocó": venía de arriba y la semana llegó al nivel.
      if (prev.close > n.precio && v.low <= n.precio) {
        eventos.push({ tipo: 'toco_compra', nivel: n.nivel, precio: n.precio, mensaje: `llegó a su nivel de compra ${n.nivel} (USD ${fmt(n.precio)}): ${QUE_HACER_COMPRA[rol]}.` });
      }
      const debajo = (c: number) => c < n.precio * (1 - MARGEN_RUPTURA);
      if (debajo(v.close) && debajo(prev.close) && !debajo(prev2.close)) {
        eventos.push({ tipo: 'perforo_compra', nivel: n.nivel, precio: n.precio, mensaje: `cerró dos semanas seguidas por debajo de su nivel ${n.nivel} (USD ${fmt(n.precio)}): ese piso no aguantó y el próximo nivel pasa a ser la referencia.` });
      }
    } else {
      if (prev.close < n.precio && v.high >= n.precio) {
        eventos.push({ tipo: 'toco_venta', nivel: n.nivel, precio: n.precio, mensaje: `llegó a su nivel de venta ${n.nivel} (USD ${fmt(n.precio)}): ${QUE_HACER_VENTA[rol]}.` });
      }
      const encima = (c: number) => c > n.precio * (1 + MARGEN_RUPTURA);
      if (encima(v.close) && encima(prev.close) && !encima(prev2.close)) {
        eventos.push({ tipo: 'supero_venta', nivel: n.nivel, precio: n.precio, mensaje: `cerró dos semanas seguidas por encima de su nivel ${n.nivel} (USD ${fmt(n.precio)}): superó ese techo y el próximo nivel pasa a ser la referencia.` });
      }
    }
  }

  const t = calcularTendencias(serie);
  if (t.alcista && prev.close >= t.alcista.valorPrevio && v.close < t.alcista.valor) {
    eventos.push({ tipo: 'rompio_alcista', nivel: null, precio: t.alcista.valor, mensaje: `cerró por debajo de su tendencia de fondo (la línea pasa por USD ${fmt(t.alcista.valor)}): la suba de largo plazo se cortó; conviene no adelantar compras y esperar sus niveles.` });
  }
  if (t.bajista && prev.close <= t.bajista.valorPrevio && v.close > t.bajista.valor) {
    eventos.push({ tipo: 'supero_bajista', nivel: null, precio: t.bajista.valor, mensaje: `cerró por encima de la línea de su caída (USD ${fmt(t.bajista.valor)}): es una primera señal de que la baja puede estar terminando.` });
  }

  const compras = niveles.filter((n) => n.lado === 'COMPRA' && n.precio <= v.close).sort((a, b) => b.precio - a.precio);
  const ventas = niveles.filter((n) => n.lado === 'VENTA' && n.precio >= v.close).sort((a, b) => a.precio - b.precio);
  const cercano = (n: NivelTecnico | undefined) => (n ? { nivel: n.nivel, precio: n.precio, distancia: n.precio / v.close - 1 } : null);

  return {
    ticker,
    rol,
    cierre: v.close,
    cierrePrevio: prev.close,
    compraCercana: cercano(compras[0]),
    ventaCercana: cercano(ventas[0]),
    tendencia: t.alcista ? (v.close >= t.alcista.valor ? 'alcista' : 'rota') : 'sin_dato',
    eventos,
  };
}

export interface RevisionTecnica {
  activos: EstadoActivo[];
  /** Avisos de filas inválidas del Sheet y tickers sin serie. */
  avisos: string[];
}

const ORDEN_ROL: Record<Rol, number> = { CORE: 0, SATELITE: 1, LEGADO: 2, CONSOLIDAR: 3, RADAR: 4 };

/**
 * Filas que llegaron como JSON (array de objetos con Ticker, Rol, Nivel,
 * Precio, Nota) → niveles. Los valores se pasan a string para reusar el mismo
 * parser que la hoja: un precio puede venir como número o como "64,5".
 */
export function nivelesDesdePayload(raw: unknown): { niveles: NivelTecnico[]; avisos: string[] } | null {
  if (!Array.isArray(raw)) return null;
  const filas = raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v == null ? '' : String(v)])));
  return parsearNiveles(filas);
}

/**
 * Arma la revisión completa. Los niveles salen de `nivelesCrudos` (el JSON del
 * POST) y, si no vinieron, de la hoja; sin ninguno de los dos devuelve `null`
 * y el mail sale sin el bloque. `bajarSerie` se inyecta para los tests.
 */
export async function calcularRevisionTecnica(
  nivelesCrudos?: unknown,
  bajarSerie: (ticker: string) => Promise<VelaSemanal[]> = serieSemanal,
): Promise<RevisionTecnica | null> {
  const leido = nivelesDesdePayload(nivelesCrudos) ?? (await leerNivelesTecnicos());
  if (!leido || (leido.niveles.length === 0 && leido.avisos.length === 0)) return null;
  return revisarNiveles(leido.niveles, leido.avisos, bajarSerie);
}

export async function revisarNiveles(
  niveles: NivelTecnico[],
  avisosPrevios: string[],
  bajarSerie: (ticker: string) => Promise<VelaSemanal[]>,
): Promise<RevisionTecnica> {
  const avisos = [...avisosPrevios];
  const porTicker = new Map<string, NivelTecnico[]>();
  for (const n of niveles) porTicker.set(n.ticker, [...(porTicker.get(n.ticker) ?? []), n]);

  const resultados = await mapConLimite([...porTicker.entries()], 4, async ([ticker, ns]) => {
    try {
      return evaluarActivo(ticker, ns[0].rol, ns, await bajarSerie(ticker));
    } catch (err) {
      avisos.push(`${ticker}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  });

  const activos = resultados
    .filter((r): r is EstadoActivo => r != null)
    .sort((a, b) => ORDEN_ROL[a.rol] - ORDEN_ROL[b.rol] || a.ticker.localeCompare(b.ticker));
  return { activos, avisos };
}
