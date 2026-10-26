// Alerta semanal por mail: qué cobros de dividendos, renta, amortización y
// balances caen en los próximos 7 días para la cartera actual.
//
// El envío usa la API HTTP de Resend directamente (fetch, sin el paquete
// `resend`) siguiendo la misma convención que el resto de lib/ (Yahoo,
// bonistas.com) de no sumar SDKs para un solo POST.

import type { DashboardData, EventoCalendario } from '@/types';
import { fetchCalendarioFinanciero } from './calendario';
import { tickersDeCartera } from './tickersElegibles';
import { calcularVariacionSemanal, type VariacionSemanal, type VariacionActivo } from './variacionSemanal';
import { formatMoney, formatPercent, formatFx } from './format';

const TIPO_LABEL: Record<EventoCalendario['tipo'], string> = {
  dividendo: 'Dividendo',
  'dividendo-fut': 'Dividendo (confirmado)',
  earnings: 'Balance',
  renta: 'Renta',
  amortizacion: 'Amortización',
};

/** Nombre legible de cada TIPO del Sheet para los encabezados de sección. */
const TIPO_ACTIVO_LABEL: Record<string, string> = {
  ACCIONES: 'Acciones',
  ETF: 'ETFs',
  BONOS: 'Bonos y ONs',
  FCI: 'Fondos comunes',
  ARGY: 'Activos argentinos',
  CRIPTO: 'Cripto',
  ALTS: 'Alternativos',
  OTRO: 'Otros',
};

export interface AlertaSemanal {
  desde: string; // YYYY-MM-DD
  hasta: string; // YYYY-MM-DD
  eventos: EventoCalendario[];
  /** Suma de montoEstimado en USD (ignora eventos sin monto o en otra moneda). */
  totalUsdEstimado: number;
  /** Variación de precio de los últimos 7 días por activo y tipo. */
  variacion?: VariacionSemanal;
}

function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Calcula los eventos de calendario financiero de la cartera actual que caen
 * en los próximos `dias` días (por defecto 7, desde hoy inclusive). El cron
 * dispara domingo 21hs ART (lunes 00:00 UTC), así que `hoy` cae en el lunes y
 * el rango por defecto queda lunes→domingo de la semana que arranca.
 */
export async function calcularAlertaSemanal(
  data: DashboardData,
  dias = 7,
): Promise<AlertaSemanal> {
  const meses = Object.keys(data.tenenciasPorMes).sort();
  const ultimoMes = meses[meses.length - 1];
  const items = data.tenenciasPorMes[ultimoMes] ?? [];
  const { tickersUsa, tickersArg, tenencias } = tickersDeCartera(items);

  const hoy = new Date();
  const desde = fmtFecha(hoy);
  const hastaDate = new Date(hoy);
  hastaDate.setUTCDate(hastaDate.getUTCDate() + dias - 1);
  const hasta = fmtFecha(hastaDate);

  // El rango puede cruzar fin de año (ej. 28-dic a 4-ene); fetchCalendarioFinanciero
  // no asume año calendario, así que pasar desde/hasta directo alcanza.
  const { eventos } = await fetchCalendarioFinanciero(tickersUsa, tickersArg, desde, hasta, tenencias);

  const totalUsdEstimado = eventos.reduce((s, e) => {
    if (e.montoEstimado != null && (e.monedaMonto ?? 'USD') === 'USD') return s + e.montoEstimado;
    return s;
  }, 0);

  // La variación mira 7 días hacia atrás (mercado ya ocurrido), a diferencia de
  // los eventos que miran hacia adelante. Si falla, el mail sale igual con los
  // cobros: es información complementaria, no el motivo del envío.
  let variacion: VariacionSemanal | undefined;
  try {
    variacion = await calcularVariacionSemanal(items, dias);
  } catch {
    variacion = undefined;
  }

  return { desde, hasta, eventos, totalUsdEstimado, variacion };
}

function fmtFechaLegible(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00Z');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

/** Fecha corta dd/mm/aaaa para el encabezado del mail. */
function fmtFechaLarga(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00Z');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function fmtMonto(monto: number, moneda = 'USD'): string {
  return `≈ ${formatMoney(monto, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'price' })}`;
}

// ── Design tokens del mail ───────────────────────────────────────────────────
//
// Hexadecimales literales, no variables CSS: los clientes de mail (Gmail,
// Outlook) descartan :root/var() y todo tiene que ir inline. Se toma el tema
// claro de la app (globals.css, "Prestige") porque el fondo del cliente de
// mail no es controlable y el claro es el que se ve bien en ambos.
//
// UP/DOWN son una versión levemente más profunda del par --up/--down de la
// app: validado con el script de la skill dataviz (banda de luminosidad,
// chroma, separación CVD deutan/protan ΔE 8.4, contraste ≥3:1 sobre blanco).
// Aun así el signo nunca depende solo del color — siempre lo acompañan la
// flecha ▲/▼ y el número con signo.
const C = {
  bg: '#f7f4ec',
  card: '#ffffff',
  cardAlt: '#faf8f2',
  border: '#e6dfcd',
  borderStrong: '#ddd3ba',
  text: '#322c22',
  textSec: '#675e4d',
  muted: '#8a7d6a',
  accent: '#9a7038',
  up: '#1f7a55',
  down: '#c33f27',
  upSoft: '#e3f0ea',
  downSoft: '#f8e5e0',
};

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

function fmtPct(v: number | null, decimales = 2): string {
  if (v == null) return '—';
  return formatPercent(v * 100, { decimals: decimales });
}

function colorDe(v: number | null): string {
  if (v == null) return C.muted;
  return v >= 0 ? C.up : C.down;
}

function flechaDe(v: number | null): string {
  if (v == null) return '·';
  return v >= 0 ? '▲' : '▼';
}

/**
 * Barra divergente en HTML puro (tabla anidada), sin SVG ni imágenes: los
 * clientes de mail bloquean scripts y muchos no cargan SVG inline, pero un
 * `<td>` con width en % y background-color se renderiza en todos.
 *
 * El eje 0 queda al centro: las caídas crecen hacia la izquierda y las subidas
 * hacia la derecha, de modo que el signo se lee por posición además de por color.
 * `escala` es el valor absoluto que ocupa media barra (el máximo del grupo).
 */
function barraDivergente(v: number | null, escala: number): string {
  const celdaVacia = (w: number) => `<td style="width:${w}%;font-size:0;line-height:0">&nbsp;</td>`;
  if (v == null || escala <= 0) {
    return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed">
      <tr><td style="height:8px;font-size:0;line-height:0;border-left:1px solid ${C.borderStrong}">&nbsp;</td></tr></table>`;
  }
  // Media barra = 50% del ancho; el largo se recorta por si un outlier supera la escala.
  const largo = Math.min(50, (Math.abs(v) / escala) * 50);
  const relleno = 50 - largo;
  const color = v >= 0 ? C.up : C.down;
  const negativo = v < 0;

  const barra = `<td style="width:${largo}%;height:8px;font-size:0;line-height:0;background-color:${color};border-radius:${negativo ? '3px 0 0 3px' : '0 3px 3px 0'}">&nbsp;</td>`;
  const eje = `<td style="width:1px;height:8px;font-size:0;line-height:0;background-color:${C.borderStrong}">&nbsp;</td>`;

  const celdas = negativo
    ? [celdaVacia(relleno), barra, eje, celdaVacia(50)]
    : [celdaVacia(50), eje, barra, celdaVacia(relleno)];

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;table-layout:fixed">
    <tr>${celdas.join('')}</tr></table>`;
}

/**
 * Tarjeta de KPI grande (número héroe) usada en la fila superior del mail.
 *
 * La separación entre tarjetas se hace con una celda espaciadora entre ellas y
 * no con margin negativo en el contenedor: Outlook (motor Word) descarta los
 * márgenes negativos y la fila se desborda del ancho de 640px.
 */
function kpiCard(label: string, valor: string, color: string, sub?: string): string {
  return `<td width="32%" valign="top">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;background-color:${C.card};border:1px solid ${C.border};border-radius:10px">
      <tr><td style="padding:14px 16px">
        <div style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};padding-bottom:6px">${esc(label)}</div>
        <div style="font-family:${FONT};font-size:24px;font-weight:700;color:${color};line-height:1.1">${valor}</div>
        ${sub ? `<div style="font-family:${FONT};font-size:11px;color:${C.textSec};padding-top:4px">${sub}</div>` : ''}
      </td></tr>
    </table>
  </td>`;
}

/** Celda espaciadora entre tarjetas (ver nota en kpiCard). */
const ESPACIADOR = `<td width="2%" style="font-size:0;line-height:0">&nbsp;</td>`;

/** Sección de un tipo de activo: encabezado con promedio + una fila por activo. */
function seccionTipo(grupo: VariacionSemanal['grupos'][number]): string {
  const label = TIPO_ACTIVO_LABEL[grupo.tipo] ?? grupo.tipo;

  // La escala de las barras es local al grupo: comparar un bono (±0,5%) contra
  // una acción (±8%) en la misma escala aplastaría al bono contra el eje.
  const escala = Math.max(
    0.005,
    ...grupo.activos.flatMap((a) => [Math.abs(a.variacionUsd ?? 0), Math.abs(a.variacionArs ?? 0)]),
  );

  const filas = grupo.activos.map((a: VariacionActivo, i) => {
    const fondo = i % 2 === 1 ? C.cardAlt : C.card;
    const detalle = a.nota
      ? `<span style="font-family:${FONT};font-size:10px;color:${C.muted}">${esc(a.nota)}</span>`
      : '';
    return `<tr>
      <td style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border}">
        <div style="font-family:${MONO};font-size:13px;font-weight:700;color:${C.text}">${esc(a.ticker)}</div>
        ${detalle}
      </td>
      <td style="padding:9px 8px;background-color:${fondo};border-top:1px solid ${C.border};width:34%">
        ${barraDivergente(a.variacionUsd, escala)}
      </td>
      <td align="right" style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border};white-space:nowrap">
        <span style="font-family:${MONO};font-size:13px;font-weight:700;color:${colorDe(a.variacionUsd)}">${flechaDe(a.variacionUsd)} ${fmtPct(a.variacionUsd)}</span>
      </td>
      <td align="right" style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border};white-space:nowrap">
        <span style="font-family:${MONO};font-size:13px;font-weight:700;color:${colorDe(a.variacionArs)}">${flechaDe(a.variacionArs)} ${fmtPct(a.variacionArs)}</span>
      </td>
    </tr>`;
  }).join('');

  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:18px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">
    <tr>
      <td colspan="2" style="padding:10px 12px;background-color:${C.cardAlt}">
        <span style="font-family:${FONT};font-size:13px;font-weight:700;color:${C.text}">${esc(label)}</span>
        <span style="font-family:${FONT};font-size:11px;color:${C.muted}">&nbsp;·&nbsp;${grupo.activos.length} activo${grupo.activos.length === 1 ? '' : 's'}</span>
      </td>
      <td align="right" style="padding:10px 12px;background-color:${C.cardAlt};white-space:nowrap">
        <span style="font-family:${FONT};font-size:10px;color:${C.muted}">PROM USD&nbsp;</span>
        <span style="font-family:${MONO};font-size:12px;font-weight:700;color:${colorDe(grupo.promedioUsd)}">${fmtPct(grupo.promedioUsd)}</span>
      </td>
      <td align="right" style="padding:10px 12px;background-color:${C.cardAlt};white-space:nowrap">
        <span style="font-family:${FONT};font-size:10px;color:${C.muted}">PROM ARS&nbsp;</span>
        <span style="font-family:${MONO};font-size:12px;font-weight:700;color:${colorDe(grupo.promedioArs)}">${fmtPct(grupo.promedioArs)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:5px 12px;background-color:${C.card};border-top:1px solid ${C.border}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">ACTIVO</span></td>
      <td style="padding:5px 8px;background-color:${C.card};border-top:1px solid ${C.border}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">7 DÍAS (USD)</span></td>
      <td align="right" style="padding:5px 12px;background-color:${C.card};border-top:1px solid ${C.border}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">USD</span></td>
      <td align="right" style="padding:5px 12px;background-color:${C.card};border-top:1px solid ${C.border}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">ARS</span></td>
    </tr>
    ${filas}
  </table>`;
}

/** Bloque completo de variación semanal (KPIs + una sección por tipo). */
function bloqueVariacion(v: VariacionSemanal): string {
  if (v.grupos.length === 0) return '';

  const mepSub = v.mepPrevio != null && v.mepActual != null
    ? `${formatFx(v.mepPrevio)} → ${formatFx(v.mepActual)}`
    : 'sin dato';

  // Promedio simple de todos los activos con dato, transversal a los tipos.
  const todas = v.grupos.flatMap((g) => g.activos);
  const prom = (xs: (number | null)[]) => {
    const d = xs.filter((x): x is number => x != null);
    return d.length === 0 ? null : d.reduce((s, x) => s + x, 0) / d.length;
  };
  const promUsd = prom(todas.map((a) => a.variacionUsd));
  const promArs = prom(todas.map((a) => a.variacionArs));

  return `
  <tr><td style="padding:26px 24px 0 24px">
    <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.text}">Variación semanal de precios</div>
    <div style="font-family:${FONT};font-size:12px;color:${C.textSec};padding-top:3px">Últimos 7 días · ${fmtFechaLegible(v.desde)} → ${fmtFechaLegible(v.hasta)}</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:14px;table-layout:fixed">
      <tr>
        ${kpiCard('Cartera USD', `${flechaDe(promUsd)} ${fmtPct(promUsd)}`, colorDe(promUsd), 'promedio simple')}
        ${ESPACIADOR}
        ${kpiCard('Cartera ARS', `${flechaDe(promArs)} ${fmtPct(promArs)}`, colorDe(promArs), 'promedio simple')}
        ${ESPACIADOR}
        ${kpiCard('Dólar MEP', `${flechaDe(v.variacionMep)} ${fmtPct(v.variacionMep)}`, colorDe(v.variacionMep), mepSub)}
      </tr>
    </table>

    ${v.grupos.map(seccionTipo).join('')}

    <div style="font-family:${FONT};font-size:11px;color:${C.muted};padding-top:12px;line-height:1.5">
      La variación en pesos no es la de dólares corrida por el MEP: cada una se calcula sobre la serie
      en su moneda nativa, convirtiendo ambos extremos con el MEP de su propia fecha.
    </div>
  </td></tr>`;
}

/** Bloque de cobros/eventos de la semana entrante. */
function bloqueEventos(alerta: AlertaSemanal): string {
  const { eventos, totalUsdEstimado } = alerta;

  const encabezado = `
    <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.text}">Cobros y eventos de la semana</div>
    <div style="font-family:${FONT};font-size:12px;color:${C.textSec};padding-top:3px">Próximos 7 días · ${fmtFechaLegible(alerta.desde)} → ${fmtFechaLegible(alerta.hasta)}</div>`;

  if (eventos.length === 0) {
    return `<tr><td style="padding:26px 24px 0 24px">
      ${encabezado}
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:12px;border:1px solid ${C.border};border-radius:10px">
        <tr><td style="padding:18px;text-align:center;font-family:${FONT};font-size:13px;color:${C.muted};background-color:${C.card};border-radius:10px">
          Sin dividendos, renta, amortizaciones ni balances programados.
        </td></tr>
      </table>
    </td></tr>`;
  }

  const filas = eventos.map((e, i) => {
    const fondo = i % 2 === 1 ? C.cardAlt : C.card;
    const monto = e.montoEstimado != null ? fmtMonto(e.montoEstimado, e.monedaMonto) : '—';
    return `<tr>
      <td style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border};white-space:nowrap"><span style="font-family:${FONT};font-size:12px;color:${C.textSec}">${esc(fmtFechaLegible(e.fecha))}</span></td>
      <td style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border}"><span style="font-family:${MONO};font-size:13px;font-weight:700;color:${C.text}">${esc(e.ticker)}</span></td>
      <td style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border}">
        <span style="font-family:${FONT};font-size:11px;font-weight:600;color:${C.accent}">${esc(TIPO_LABEL[e.tipo])}</span>
        ${e.detalle ? `<div style="font-family:${FONT};font-size:10px;color:${C.muted};padding-top:2px">${esc(e.detalle)}</div>` : ''}
      </td>
      <td align="right" style="padding:9px 12px;background-color:${fondo};border-top:1px solid ${C.border};white-space:nowrap"><span style="font-family:${MONO};font-size:13px;font-weight:700;color:${C.text}">${esc(monto)}</span></td>
    </tr>`;
  }).join('');

  return `<tr><td style="padding:26px 24px 0 24px">
    ${encabezado}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:12px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">
      <tr>
        <td style="padding:7px 12px;background-color:${C.cardAlt}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">FECHA</span></td>
        <td style="padding:7px 12px;background-color:${C.cardAlt}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">TICKER</span></td>
        <td style="padding:7px 12px;background-color:${C.cardAlt}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">CONCEPTO</span></td>
        <td align="right" style="padding:7px 12px;background-color:${C.cardAlt}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">MONTO EST.</span></td>
      </tr>
      ${filas}
      <tr>
        <td colspan="3" style="padding:10px 12px;background-color:${C.cardAlt};border-top:2px solid ${C.borderStrong}"><span style="font-family:${FONT};font-size:12px;font-weight:700;color:${C.text}">Total estimado</span></td>
        <td align="right" style="padding:10px 12px;background-color:${C.cardAlt};border-top:2px solid ${C.borderStrong};white-space:nowrap"><span style="font-family:${MONO};font-size:14px;font-weight:700;color:${C.accent}">≈ ${formatMoney(totalUsdEstimado, { currency: 'USD', mode: 'price' })}</span></td>
      </tr>
    </table>
  </td></tr>`;
}

/** Versión texto plano, para clientes que no renderizan HTML. */
function armarTexto(alerta: AlertaSemanal): string {
  const lineas: string[] = [];
  const v = alerta.variacion;

  if (v && v.grupos.length > 0) {
    lineas.push(`VARIACIÓN SEMANAL (${v.desde} → ${v.hasta})`, '');
    lineas.push(`Dólar MEP: ${fmtPct(v.variacionMep)}${v.mepActual != null ? ` (a ${formatFx(v.mepActual)})` : ''}`, '');
    for (const g of v.grupos) {
      const label = TIPO_ACTIVO_LABEL[g.tipo] ?? g.tipo;
      lineas.push(`${label} — prom. USD ${fmtPct(g.promedioUsd)} · ARS ${fmtPct(g.promedioArs)}`);
      for (const a of g.activos) {
        lineas.push(`  ${a.ticker.padEnd(10)} USD ${fmtPct(a.variacionUsd).padStart(8)}  ARS ${fmtPct(a.variacionArs).padStart(8)}${a.nota ? `  (${a.nota})` : ''}`);
      }
      lineas.push('');
    }
  }

  lineas.push(`COBROS Y EVENTOS (${alerta.desde} → ${alerta.hasta})`, '');
  if (alerta.eventos.length === 0) {
    lineas.push('Sin dividendos, renta, amortizaciones ni balances programados.');
  } else {
    for (const e of alerta.eventos) {
      const monto = e.montoEstimado != null ? fmtMonto(e.montoEstimado, e.monedaMonto) : '—';
      lineas.push(`${fmtFechaLegible(e.fecha)}  ${e.ticker.padEnd(8)}  ${TIPO_LABEL[e.tipo].padEnd(24)}  ${monto}`);
    }
    lineas.push('', `Total estimado: ≈ ${formatMoney(alerta.totalUsdEstimado, { currency: 'USD', mode: 'price' })}`);
  }

  return lineas.join('\n');
}

/** Asunto + cuerpo (texto plano y HTML) del mail, listos para pasarle a cualquier proveedor. */
export function armarContenidoMail(alerta: AlertaSemanal): { asunto: string; texto: string; html: string } {
  const { eventos, totalUsdEstimado, variacion } = alerta;

  // El asunto lidera con el movimiento de la cartera cuando hay dato de mercado
  // (es lo que cambia todas las semanas); los cobros quedan como complemento.
  const partes: string[] = [];
  if (variacion && variacion.grupos.length > 0) {
    const todas = variacion.grupos.flatMap((g) => g.activos).map((a) => a.variacionUsd).filter((x): x is number => x != null);
    if (todas.length > 0) {
      const promUsd = todas.reduce((s, x) => s + x, 0) / todas.length;
      partes.push(`cartera ${fmtPct(promUsd, 1)} USD`);
    }
    if (variacion.variacionMep != null) partes.push(`MEP ${fmtPct(variacion.variacionMep, 1)}`);
  }
  if (eventos.length > 0) {
    partes.push(`${eventos.length} evento${eventos.length === 1 ? '' : 's'} (≈ ${formatMoney(totalUsdEstimado, { currency: 'USD', mode: 'price' })})`);
  }
  const asunto = partes.length > 0
    ? `Portfolio — ${partes.join(' · ')}`
    : 'Portfolio — sin cobros esta semana';

  const html = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${C.bg};margin:0;padding:0">
  <tr><td align="center" style="padding:24px 12px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="640" style="border-collapse:collapse;max-width:640px;width:100%;background-color:${C.bg}">

      <tr><td style="padding:0 0 18px 0">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background-color:${C.text};border-radius:12px">
          <tr><td style="padding:22px 24px 18px 24px">
            <div style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#e7dcc4">📊&nbsp; Resumen semanal · Portafolio</div>
            <div style="font-family:${FONT};font-size:12px;color:#b8ac91;padding-top:6px">🗓️&nbsp; ${esc(fmtFechaLarga(alerta.desde))}</div>
          </td></tr>
          <tr><td style="padding:0 24px 3px 24px"><div style="height:3px;background-color:${C.accent};border-radius:0 0 3px 3px;font-size:0;line-height:0">&nbsp;</div></td></tr>
        </table>
      </td></tr>

      ${variacion ? bloqueVariacion(variacion) : ''}
      ${bloqueEventos(alerta)}

      <tr><td style="padding:22px 24px 8px 24px">
        <div style="border-top:1px solid ${C.border};padding-top:12px;font-family:${FONT};font-size:11px;color:${C.muted};line-height:1.6">
          Montos estimados según la tenencia del último mes cargado; los dividendos van netos de retención.
          Precios de Yahoo Finance, data912 y CAFCI; MEP de argentinadatos.
          ${variacion && variacion.errores.length > 0 ? `<br>Fuentes con error esta semana: ${esc(variacion.errores.join('; '))}` : ''}
        </div>
      </td></tr>

    </table>
  </td></tr>
</table>`.trim();

  return { asunto, texto: armarTexto(alerta), html };
}

// Remitente por defecto de Resend cuando no hay dominio propio verificado.
// Solo puede mandar al mismo mail con el que te registraste en Resend.
const REMITENTE_DEFAULT = 'onboarding@resend.dev';

/**
 * Envía la alerta semanal por mail vía la API de Resend.
 * Requiere RESEND_API_KEY. Opcionalmente RESEND_FROM si se verificó un
 * dominio propio en Resend (si no, se usa el remitente sandbox de Resend,
 * que solo entrega al mail con el que te registraste ahí).
 */
export async function enviarAlertaSemanal(destinatario: string, alerta: AlertaSemanal): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY no configurada.');
  }

  const { asunto, html, texto } = armarContenidoMail(alerta);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || REMITENTE_DEFAULT,
      to: [destinatario],
      subject: asunto,
      html,
      text: texto,
    }),
  });

  if (!res.ok) {
    const detalle = await res.text().catch(() => '');
    throw new Error(`Resend: HTTP ${res.status} ${detalle}`);
  }
}
