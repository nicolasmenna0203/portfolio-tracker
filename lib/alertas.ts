// Revisión técnica del mail: docs/decisiones/0039-revision-tecnica-semanal-en-el-mail.md
// Brief de noticias y fundamentales: docs/decisiones/0040-brief-de-noticias-y-fundamentales-escrito-por-una-sesion-programada.md
// Alerta semanal por mail: qué cobros de dividendos, renta, amortización y
// balances caen en los próximos 7 días para la cartera actual, más tres bloques
// de contexto que no frenan el envío si fallan: el brief de noticias y
// fundamentales que escribe una sesión programada (lib/briefSemanal.ts),
// la variación de precios de la semana (lib/variacionSemanal.ts) y la revisión
// técnica contra los niveles del plan (lib/revisionTecnica.ts).
//
// El envío va por `enviarMail` (lib/mail.ts), que usa la API HTTP de Resend
// directamente.

import type { DashboardData, EventoCalendario } from '@/types';
import { fetchCalendarioFinanciero } from './calendario';
import { tickersDeCartera } from './tickersElegibles';
import { calcularVariacionSemanal, type VariacionSemanal, type VariacionActivo } from './variacionSemanal';
import { formatMoney, formatPercent, formatFx } from './format';
import { enviarMail } from './mail';
import { calcularRevisionTecnica, type RevisionTecnica, type EstadoActivo, type Rol } from './revisionTecnica';
import { briefDesdePayload, type BriefSemanal } from './briefSemanal';

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
  /** Niveles del plan tocados y tendencias rotas en la semana (hoja NivelesTecnicos). */
  tecnica?: RevisionTecnica;
  /** Noticias y lectura fundamental de la semana (sesión programada, ADR 0040). */
  brief?: BriefSemanal;
}

function fmtFecha(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Primer día de la ventana de la alerta. El cron corre el domingo (hora
 * argentina) y el mail es la agenda de la semana que arranca: si corre en
 * domingo, la ventana empieza el lunes; si no (disparo manual), hoy. Se mira
 * la hora argentina porque el disparo de la tarde del domingo ya es lunes en UTC.
 */
export function inicioVentana(ahora: Date): Date {
  const tz = 'America/Argentina/Buenos_Aires';
  const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(ahora);
  const dia = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(ahora);
  const inicio = new Date(fecha + 'T00:00:00Z');
  if (dia === 'Sun') inicio.setUTCDate(inicio.getUTCDate() + 1);
  return inicio;
}

/**
 * Datos semanales que no salen del Sheet: el workflow los lee de la rama
 * `datos-semanales` del repo privado y los manda en el cuerpo del POST
 * (ADR 0040). Llegan crudos: los valida cada módulo.
 */
export interface DatosSemanales {
  brief?: unknown;
  niveles?: unknown;
}

/**
 * Calcula los eventos de calendario financiero de la cartera actual que caen
 * en los `dias` días (por defecto 7) desde `inicioVentana`: lunes→domingo de
 * la semana que arranca. El horario del cron: docs/decisiones/0033-alerta-semanal-con-disparo-de-respaldo-el-domingo.md
 */
export async function calcularAlertaSemanal(
  data: DashboardData,
  dias = 7,
  datos: DatosSemanales = {},
): Promise<AlertaSemanal> {
  const meses = Object.keys(data.tenenciasPorMes).sort();
  const ultimoMes = meses[meses.length - 1];
  const items = data.tenenciasPorMes[ultimoMes] ?? [];
  const { tickersUsa, tickersArg, tenencias } = tickersDeCartera(items);

  const hoy = inicioVentana(new Date());
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

  // La revisión técnica tampoco frena el mail: sin niveles, o con Yahoo caído,
  // el bloque no sale. Ver docs/decisiones/0039-revision-tecnica-semanal-en-el-mail.md
  let tecnica: RevisionTecnica | undefined;
  try {
    tecnica = (await calcularRevisionTecnica(datos.niveles)) ?? undefined;
  } catch {
    tecnica = undefined;
  }

  // El brief lo escribe una sesión programada el sábado: si no lo dejó, o es de
  // otra semana, el mail sale sin el bloque.
  const brief = briefDesdePayload(datos.brief) ?? undefined;

  return { desde, hasta, eventos, totalUsdEstimado, variacion, tecnica, brief };
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
// claro de la app (globals.css, superficies agrupadas de Apple) porque el
// fondo del cliente de mail no es controlable y el claro es el que se ve bien
// en ambos.
//
// UP/DOWN son el par --up/--down del tema claro de la app: validado con el
// script de la skill dataviz (banda de luminosidad, chroma, separación CVD
// deutan ΔE 8.4, contraste ≥3:1 sobre blanco).
// Aun así el signo nunca depende solo del color — siempre lo acompañan la
// flecha ▲/▼ y el número con signo.
const C = {
  bg: '#f2f2f7',
  card: '#ffffff',
  cardAlt: '#f9f9fb',
  border: '#e8e8ed',
  borderStrong: '#d8d8dc',
  text: '#1d1d1f',
  textSec: '#6e6e73',
  muted: '#7c7c80',
  accent: '#007aff',
  up: '#1a8a5a',
  down: '#d70015',
  upSoft: '#e5f3ec',
  downSoft: '#fde7e9',
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

// ── Revisión técnica ─────────────────────────────────────────────────────────
//
// Lo lee alguien que no hace análisis técnico: los eventos ya vienen
// traducidos a "qué dice el plan" desde lib/revisionTecnica.ts, y la tabla usa
// palabras ("nivel de compra") en vez de jerga ("soporte S2").

const ROL_LABEL: Record<Rol, string> = {
  CORE: 'Núcleo',
  SATELITE: 'Satélite',
  LEGADO: 'Satélite con salida',
  CONSOLIDAR: 'A consolidar',
  RADAR: 'Radar',
};

function fmtNivelCercano(n: EstadoActivo['compraCercana']): string {
  if (!n) return '—';
  return `${n.nivel} · ${formatMoney(n.precio, { currency: 'USD', mode: 'price' })} (${fmtPct(n.distancia, 1)})`;
}

const TENDENCIA_LABEL: Record<EstadoActivo['tendencia'], string> = {
  alcista: '▲ en pie',
  rota: '▼ cortada',
  sin_dato: '—',
};

function bloqueTecnico(r: RevisionTecnica): string {
  if (r.activos.length === 0) return '';
  const conEventos = r.activos.filter((a) => a.eventos.length > 0);

  const avisos = conEventos.length === 0
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:12px;border:1px solid ${C.border};border-radius:10px">
        <tr><td style="padding:16px;text-align:center;font-family:${FONT};font-size:13px;color:${C.textSec};background-color:${C.card};border-radius:10px">
          Ningún activo llegó a un nivel del plan ni cortó su tendencia esta semana: no hace falta hacer nada.
        </td></tr>
      </table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:12px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">
        ${conEventos.flatMap((a) => a.eventos.map((e) => ({ a, e }))).map(({ a, e }, i) => `<tr>
          <td valign="top" style="padding:10px 12px;background-color:${i % 2 === 1 ? C.cardAlt : C.card};border-top:${i === 0 ? '0' : `1px solid ${C.border}`};white-space:nowrap">
            <span style="font-family:${MONO};font-size:13px;font-weight:700;color:${C.text}">${esc(a.ticker)}</span>
            <div style="font-family:${FONT};font-size:10px;color:${C.muted};padding-top:2px">${esc(ROL_LABEL[a.rol])}</div>
          </td>
          <td style="padding:10px 12px;background-color:${i % 2 === 1 ? C.cardAlt : C.card};border-top:${i === 0 ? '0' : `1px solid ${C.border}`}">
            <span style="font-family:${FONT};font-size:13px;color:${C.text};line-height:1.5">${esc(e.mensaje.charAt(0).toUpperCase() + e.mensaje.slice(1))}</span>
          </td>
        </tr>`).join('')}
      </table>`;

  const th = (t: string, align = 'left') => `<td${align === 'right' ? ' align="right"' : ''} style="padding:7px 10px;background-color:${C.cardAlt}"><span style="font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:.05em;color:${C.muted}">${t}</span></td>`;
  const filas = r.activos.map((a, i) => {
    const fondo = i % 2 === 1 ? C.cardAlt : C.card;
    // Las columnas de niveles pueden partirse en dos renglones: en el ancho de un
    // teléfono, con las cinco columnas sin cortar, la tabla se sale del mail.
    const td = (contenido: string, align = 'left', partir = false) => `<td${align === 'right' ? ' align="right"' : ''} style="padding:8px 10px;background-color:${fondo};border-top:1px solid ${C.border};${partir ? '' : 'white-space:nowrap'}">${contenido}</td>`;
    const colorTend = a.tendencia === 'alcista' ? C.up : a.tendencia === 'rota' ? C.down : C.muted;
    return `<tr>
      ${td(`<span style="font-family:${MONO};font-size:12px;font-weight:700;color:${C.text}">${esc(a.ticker)}</span><div style="font-family:${FONT};font-size:10px;color:${C.muted}">${esc(ROL_LABEL[a.rol])}</div>`)}
      ${td(`<span style="font-family:${MONO};font-size:12px;color:${C.text}">${formatMoney(a.cierre, { currency: 'USD', mode: 'price' })}</span>`, 'right')}
      ${td(`<span style="font-family:${FONT};font-size:11px;color:${C.textSec}">${esc(fmtNivelCercano(a.compraCercana))}</span>`, 'left', true)}
      ${td(`<span style="font-family:${FONT};font-size:11px;color:${C.textSec}">${esc(fmtNivelCercano(a.ventaCercana))}</span>`, 'left', true)}
      ${td(`<span style="font-family:${FONT};font-size:11px;font-weight:600;color:${colorTend}">${TENDENCIA_LABEL[a.tendencia]}</span>`)}
    </tr>`;
  }).join('');

  return `<tr><td style="padding:26px 24px 0 24px">
    <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.text}">Revisión técnica</div>
    <div style="font-family:${FONT};font-size:12px;color:${C.textSec};padding-top:3px">Cierre de la semana contra los niveles del plan</div>
    ${avisos}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:14px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">
      <tr>${th('ACTIVO')}${th('CIERRE', 'right')}${th('PRÓX. COMPRA')}${th('PRÓX. VENTA')}${th('TENDENCIA')}</tr>
      ${filas}
    </table>
    <div style="font-family:${FONT};font-size:11px;color:${C.muted};padding-top:10px;line-height:1.5">
      Nivel de compra: precio donde el plan dice comprar o sumar. Nivel de venta: precio donde el plan dice vender o recortar.
      Tendencia: la dirección de fondo del precio en los últimos años; "cortada" quiere decir que el precio cayó por debajo de esa línea.
      Precios semanales ajustados por dividendos.
      ${r.avisos.length > 0 ? `<br>Avisos: ${esc(r.avisos.join('; '))}` : ''}
    </div>
  </td></tr>`;
}

function textoTecnico(r: RevisionTecnica): string[] {
  if (r.activos.length === 0) return [];
  const lineas = ['REVISIÓN TÉCNICA (cierre de la semana)', ''];
  const eventos = r.activos.flatMap((a) => a.eventos.map((e) => `${a.ticker} (${ROL_LABEL[a.rol]}): ${e.mensaje}`));
  if (eventos.length === 0) lineas.push('Ningún activo llegó a un nivel del plan ni cortó su tendencia: no hace falta hacer nada.');
  else lineas.push(...eventos);
  lineas.push('');
  for (const a of r.activos) {
    lineas.push(`  ${a.ticker.padEnd(10)} ${formatMoney(a.cierre, { currency: 'USD', mode: 'price' }).padStart(12)}  compra ${fmtNivelCercano(a.compraCercana)}  ·  venta ${fmtNivelCercano(a.ventaCercana)}  ·  ${TENDENCIA_LABEL[a.tendencia]}`);
  }
  if (r.avisos.length > 0) lineas.push('', `Avisos: ${r.avisos.join('; ')}`);
  lineas.push('');
  return lineas;
}

// ── Brief de noticias y fundamentales ───────────────────────────────────────
//
// Texto que redactó un modelo (ADR 0040): todo pasa por esc() y los links ya
// vienen filtrados a http(s) por parsearBrief.

function bloqueBrief(b: BriefSemanal): string {
  const tarjetas = b.activos.map((a, i) => {
    const filas = [
      a.noticia ? `<div style="font-family:${FONT};font-size:13px;color:${C.text};line-height:1.5"><b>Qué pasó:</b> ${esc(a.noticia)}</div>` : '',
      a.fundamentales ? `<div style="font-family:${FONT};font-size:13px;color:${C.text};line-height:1.5;padding-top:4px"><b>Números:</b> ${esc(a.fundamentales)}</div>` : '',
      a.lectura ? `<div style="font-family:${FONT};font-size:13px;color:${C.text};line-height:1.5;padding-top:4px"><b>Para tu plan:</b> ${esc(a.lectura)}</div>` : '',
      a.fuentes.length > 0
        ? `<div style="font-family:${FONT};font-size:11px;color:${C.muted};padding-top:6px">${a.fuentes.map((f) => `<a href="${esc(f.url)}" style="color:${C.accent};text-decoration:none">${esc(f.titulo)}</a>`).join(' · ')}</div>`
        : '',
    ].join('');
    return `<tr><td style="padding:12px 14px;background-color:${i % 2 === 1 ? C.cardAlt : C.card};border-top:${i === 0 ? '0' : `1px solid ${C.border}`}">
      <span style="font-family:${MONO};font-size:13px;font-weight:700;color:${C.text}">${esc(a.ticker)}</span>
      ${a.rol ? `<span style="font-family:${FONT};font-size:10px;color:${C.muted}">&nbsp;·&nbsp;${esc(ROL_LABEL[a.rol as Rol] ?? a.rol)}</span>` : ''}
      <div style="padding-top:6px">${filas}</div>
    </td></tr>`;
  }).join('');

  return `<tr><td style="padding:26px 24px 0 24px">
    <div style="font-family:${FONT};font-size:15px;font-weight:700;color:${C.text}">Lo importante de la semana</div>
    <div style="font-family:${FONT};font-size:12px;color:${C.textSec};padding-top:3px">Noticias y fundamentales · al ${esc(fmtFechaLegible(b.fecha))}</div>
    ${b.resumen ? `<div style="font-family:${FONT};font-size:14px;color:${C.text};line-height:1.55;padding-top:12px">${esc(b.resumen)}</div>` : ''}
    ${tarjetas ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;margin-top:14px;border:1px solid ${C.border};border-radius:10px;overflow:hidden">${tarjetas}</table>` : ''}
    ${b.aVigilar.length > 0 ? `<div style="font-family:${FONT};font-size:12px;color:${C.textSec};padding-top:12px;line-height:1.6"><b>Para mirar la semana que viene:</b> ${b.aVigilar.map(esc).join(' · ')}</div>` : ''}
    <div style="font-family:${FONT};font-size:11px;color:${C.muted};padding-top:10px;line-height:1.5">
      Redactado por una sesión de Claude a partir de noticias y datos públicos. Es análisis, no asesoramiento financiero.
    </div>
  </td></tr>`;
}

function textoBrief(b: BriefSemanal): string[] {
  const lineas = [`LO IMPORTANTE DE LA SEMANA (al ${b.fecha})`, ''];
  if (b.resumen) lineas.push(b.resumen, '');
  for (const a of b.activos) {
    lineas.push(`${a.ticker}${a.rol ? ` (${ROL_LABEL[a.rol as Rol] ?? a.rol})` : ''}`);
    if (a.noticia) lineas.push(`  Qué pasó: ${a.noticia}`);
    if (a.fundamentales) lineas.push(`  Números: ${a.fundamentales}`);
    if (a.lectura) lineas.push(`  Para tu plan: ${a.lectura}`);
    for (const f of a.fuentes) lineas.push(`  ${f.titulo}: ${f.url}`);
    lineas.push('');
  }
  if (b.aVigilar.length > 0) lineas.push(`Para mirar la semana que viene: ${b.aVigilar.join(' · ')}`, '');
  lineas.push('Redactado por una sesión de Claude a partir de noticias y datos públicos. Es análisis, no asesoramiento financiero.', '');
  return lineas;
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

  if (alerta.brief) lineas.push(...textoBrief(alerta.brief));

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

  if (alerta.tecnica) lineas.push(...textoTecnico(alerta.tecnica));

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
  const avisosTecnicos = alerta.tecnica?.activos.reduce((s, a) => s + a.eventos.length, 0) ?? 0;
  if (avisosTecnicos > 0) partes.push(`${avisosTecnicos} aviso${avisosTecnicos === 1 ? '' : 's'} técnico${avisosTecnicos === 1 ? '' : 's'}`);
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

      ${alerta.brief ? bloqueBrief(alerta.brief) : ''}
      ${variacion ? bloqueVariacion(variacion) : ''}
      ${alerta.tecnica ? bloqueTecnico(alerta.tecnica) : ''}
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

/** Envía la alerta semanal por mail. */
export async function enviarAlertaSemanal(destinatario: string, alerta: AlertaSemanal): Promise<void> {
  await enviarMail(destinatario, armarContenidoMail(alerta));
}
