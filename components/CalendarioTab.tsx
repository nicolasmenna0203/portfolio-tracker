'use client';

import { useMemo, useState } from 'react';
import type { DashboardData, EventoTipo, EventoCalendario, YieldTicker } from '@/types';
import { useCalendario } from '@/lib/useCalendario';
import { tickersDeCartera } from '@/lib/tickersElegibles';
import { RETENCION_USA, IMPUESTO_CHEQUE, FACTOR_NETO_DIVIDENDO } from '@/lib/retenciones';
import { formatMoney, formatPercent } from '@/lib/format';
import { useIsMobile } from '@/lib/useIsMobile';
import Segmented from './Segmented';
import { Cargando } from './Estados';

interface Props {
  data: DashboardData;
  hideValues?: boolean;
}

const TIPO_EVENTO_META: Record<EventoTipo, { label: string; color: string }> = {
  dividendo:      { label: 'Dividendo',        color: '#0a84ff' },
  'dividendo-fut':{ label: 'Div. confirmado',  color: '#5e5ce6' },
  earnings:       { label: 'Balance',          color: '#d96f00' },
  renta:          { label: 'Renta',            color: '#1e9ab0' },
  amortizacion:   { label: 'Amortización',     color: '#b455e8' },
};

// Tipos agrupados para el filtro (dividendo histórico + futuro se filtran juntos).
// Es una opción a la vez, así que va en un segmented control; `null` = todos.
type FiltroTipo = 'todos' | 'balances' | 'dividendos' | 'renta' | 'amortizacion';
const FILTROS_TIPO: { id: FiltroTipo; label: string; corto?: string; tipos: EventoTipo[] | null }[] = [
  { id: 'todos',        label: 'Todos',        tipos: null },
  { id: 'balances',     label: 'Balances',     tipos: ['earnings'] },
  { id: 'dividendos',   label: 'Dividendos',   tipos: ['dividendo', 'dividendo-fut'] },
  { id: 'renta',        label: 'Renta',        tipos: ['renta'] },
  { id: 'amortizacion', label: 'Amortización', corto: 'Amort.', tipos: ['amortizacion'] },
];

const MESES_LABEL = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

function fmtFechaEvento(fecha: string): string {
  const d = new Date(fecha + 'T00:00:00Z');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Formatea el cobro estimado, ej. "≈ USD 4,23" o "≈ ARS 1.240". */
function fmtMonto(monto: number, moneda: string | undefined, hidden: boolean): string {
  return `≈ ${formatMoney(monto, { currency: moneda === 'ARS' ? 'ARS' : 'USD', hidden })}`;
}

/** Los dividendos se muestran netos de retención; los flujos de bonos ARG, completos. */
function esDividendo(tipo: EventoTipo): boolean {
  return tipo === 'dividendo' || tipo === 'dividendo-fut';
}

/** Explica de dónde sale el monto mostrado, según lleve retención o no. */
function tooltipMonto(tipo: EventoTipo, estimadoAl?: string): string {
  if (estimadoAl) {
    return `Cobro estimado con la tenencia y el precio del ${fmtFechaEvento(estimadoAl)}, cuando se registró el pago.\nSin retención de origen: los bonos ARG se acreditan completos.`;
  }
  if (esDividendo(tipo)) {
    return `Neto estimado a acreditar, según tu tenencia y el precio de mercado actual.\n`
      + `Ya descontado: ${formatPercent(RETENCION_USA * 100, { sign: false, decimals: 0 })} de retención de EE.UU. + ${formatPercent(IMPUESTO_CHEQUE * 100, { sign: false })} de débitos y créditos `
      + `(llega el ${formatPercent(FACTOR_NETO_DIVIDENDO * 100, { sign: false })} del bruto).\n`
      + `No incluye la comisión del depositario local (~1-2%).`;
  }
  return 'Cobro estimado según tu tenencia y el precio de mercado actual.\nSin retención de origen: los bonos ARG se acreditan completos.';
}

function Chevron({ haciaAtras = false }: { haciaAtras?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={haciaAtras ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
    </svg>
  );
}

/** Genera las celdas (con padding de días de otros meses) para una grilla de semanas lunes-domingo. */
function celdasDelMes(year: number, mesIdx: number): (number | null)[] {
  const primerDia = new Date(Date.UTC(year, mesIdx, 1));
  const diasEnMes = new Date(Date.UTC(year, mesIdx + 1, 0)).getUTCDate();
  const offset = (primerDia.getUTCDay() + 6) % 7; // lunes=0..domingo=6

  const celdas: (number | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(d);
  while (celdas.length % 7 !== 0) celdas.push(null);
  return celdas;
}

// Logos de acciones/ETF vía Financial Modeling Prep (URL pública directa por ticker,
// sin API key). Los bonos ARG no tienen logo: caen al fallback de inicial.
function logoUrlDe(ticker: string): string {
  return `https://financialmodelingprep.com/image-stock/${encodeURIComponent(ticker)}.png`;
}

function LogoTicker({ ticker, conLogo, size }: { ticker: string; conLogo: boolean; size: number }) {
  const [error, setError] = useState(false);
  if (!conLogo || error) {
    return (
      <div style={{
        width: size, height: size, borderRadius: '50%', background: 'var(--chip-hover)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, fontWeight: 600, color: 'var(--text-sec)', flexShrink: 0,
      }}>
        {ticker[0]}
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={logoUrlDe(ticker)}
      alt={ticker}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
      style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'contain', background: '#fff' }}
    />
  );
}

// Los bonos ARG (renta/amortización) no tienen logo de empresa; el resto sí.
function tickerConLogo(tipo: EventoTipo): boolean {
  return tipo !== 'renta' && tipo !== 'amortizacion';
}

// El logo es el protagonista de la celda (ocupa ~65% de su ancho) y el número
// de día pasa a una esquina chica superpuesta: lo primero que se lee en un
// día con evento es "qué ticker paga", no la fecha. Con 2+ eventos el segundo
// logo se solapa (no se achica la grilla); a partir del tercero se cuenta.
function DiaCelda({
  dia, eventosDia, esHoy, esFinde, logoSize, maxLogos, yieldPorTicker, hideValues,
}: {
  dia: number | null;
  eventosDia?: EventoCalendario[];
  esHoy: boolean;
  esFinde: boolean;
  logoSize: number;
  maxLogos: number;
  yieldPorTicker: Map<string, YieldTicker>;
  hideValues: boolean;
}) {
  // Las celdas de relleno llevan la misma línea de arriba: el renglón de la
  // semana se lee entero aunque el mes empiece un jueves.
  if (dia === null) return <div className="cal-dia" aria-hidden="true" />;

  const hayEventos = eventosDia != null && eventosDia.length > 0;

  return (
    <div className="cal-dia" data-hoy={esHoy ? '' : undefined} data-finde={esFinde ? '' : undefined}>
      <span className="cal-dia-num">{dia}</span>
      {hayEventos && (
        <div className="cal-dia-logos">
          {eventosDia.slice(0, maxLogos).map((e, i) => {
            const meta = TIPO_EVENTO_META[e.tipo];
            const montoTxt = e.montoEstimado != null && e.montoEstimado > 0
              ? ` ${fmtMonto(e.montoEstimado, e.monedaMonto, hideValues)}${esDividendo(e.tipo) ? ' neto' : ''}`
              : '';
            const y = yieldPorTicker.get(e.ticker);
            const yieldTxt = y && esDividendo(e.tipo)
              ? `\nYield 12m: ${formatPercent(y.yieldAnual * 100, { sign: false, decimals: 2 })} · ${fmtMonto(y.cobroAnual ?? 0, 'USD', hideValues)}/año`
              : '';
            const tip = `${e.ticker}: ${meta.label}${e.detalle ? ` (${e.detalle})` : ''}${montoTxt}${yieldTxt}`;
            const dot = Math.max(8, Math.round(logoSize * 0.3));
            return (
              <div
                key={i}
                title={tip}
                className="cal-dia-logo"
                style={{ position: 'relative', marginLeft: i > 0 ? -Math.round(logoSize * 0.3) : 0, zIndex: maxLogos - i }}
              >
                <LogoTicker ticker={e.ticker} conLogo={tickerConLogo(e.tipo)} size={logoSize} />
                <span className="cal-dia-dot" style={{
                  position: 'absolute', bottom: -1, right: -1, width: dot, height: dot,
                  borderRadius: '50%', background: meta.color, border: '2px solid var(--card)',
                }} />
              </div>
            );
          })}
          {eventosDia.length > maxLogos && (
            <span className="cal-dia-mas">+{eventosDia.length - maxLogos}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarioTab({ data, hideValues = false }: Props) {
  const { tenenciasPorMes } = data;

  const esMobile = useIsMobile();
  const logoSize = esMobile ? 20 : 30;
  const maxLogos = esMobile ? 3 : 12;

  const hoy = useMemo(() => new Date(), []);
  const [year, setYear] = useState(hoy.getUTCFullYear());
  const [mesIdx, setMesIdx] = useState(hoy.getUTCMonth());

  const irMesAnterior = () => {
    if (mesIdx === 0) { setMesIdx(11); setYear((y) => y - 1); }
    else setMesIdx((m) => m - 1);
  };
  const irMesSiguiente = () => {
    if (mesIdx === 11) { setMesIdx(0); setYear((y) => y + 1); }
    else setMesIdx((m) => m + 1);
  };
  const irHoy = () => { setYear(hoy.getUTCFullYear()); setMesIdx(hoy.getUTCMonth()); };
  const esMesActual = year === hoy.getUTCFullYear() && mesIdx === hoy.getUTCMonth();

  // Tickers USA elegibles, bonos ARG mapeados y tenencia USD de cada posición
  // del último mes. Misma regla que usa el job server-side de alertas
  // semanales (`lib/tickersElegibles.ts`), centralizada para no desalinearse.
  const { tickersUsa: tickersActivos, tickersArg, tenencias } = useMemo(() => {
    const meses = Object.keys(tenenciasPorMes).sort();
    const ultimoMes = meses[meses.length - 1];
    return tickersDeCartera(tenenciasPorMes[ultimoMes] ?? []);
  }, [tenenciasPorMes]);

  const { eventos, yields, loadingEventos, errorEventos } = useCalendario(tickersActivos, year, tickersArg, tenencias);

  // Proyección anual de dividendos: suma del cobro neto de cada posición que paga.
  const cobroAnualTotal = useMemo(
    () => yields.reduce((s, y) => s + (y.cobroAnual ?? 0), 0),
    [yields],
  );

  // Yield efectivo de la cartera: cuánto rinde el total invertido, no solo lo que paga.
  const yieldCartera = useMemo(() => {
    const total = Object.values(tenencias).reduce((s, v) => s + v, 0);
    return total > 0 ? cobroAnualTotal / total : 0;
  }, [cobroAnualTotal, tenencias]);

  const [filtroTicker, setFiltroTicker] = useState<string | null>(null);
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>('todos');
  const filtroTipos = FILTROS_TIPO.find((f) => f.id === filtroTipo)?.tipos ?? null;

  const tickersDisponibles = useMemo(() => {
    const set = new Set<string>();
    for (const e of eventos) set.add(e.ticker);
    return [...set].sort();
  }, [eventos]);

  const eventosFiltrados = useMemo(
    () => eventos.filter((e) =>
      (!filtroTicker || e.ticker === filtroTicker) &&
      (!filtroTipos || filtroTipos.includes(e.tipo)),
    ),
    [eventos, filtroTicker, filtroTipos],
  );

  const eventosPorDia = useMemo(() => {
    const map = new Map<string, EventoCalendario[]>();
    for (const e of eventosFiltrados) {
      const arr = map.get(e.fecha) ?? [];
      arr.push(e);
      map.set(e.fecha, arr);
    }
    return map;
  }, [eventosFiltrados]);

  const hoyKey = useMemo(() => hoy.toISOString().slice(0, 10), [hoy]);

  const celdas = useMemo(() => celdasDelMes(year, mesIdx), [year, mesIdx]);

  const eventosDelMes = useMemo(
    () => eventosFiltrados
      .filter((e) => e.fecha.startsWith(`${year}-${String(mesIdx + 1).padStart(2, '0')}`))
      .sort((a, b) => a.fecha.localeCompare(b.fecha)),
    [eventosFiltrados, year, mesIdx],
  );

  // Yield por ticker, para anotarlo en la celda del día que paga.
  const yieldPorTicker = useMemo(
    () => new Map(yields.map((y) => [y.ticker, y])),
    [yields],
  );

  // Total estimado a cobrar en el mes, agrupado por moneda (los balances no suman).
  const totalMesPorMoneda = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of eventosDelMes) {
      if (e.montoEstimado != null && e.montoEstimado > 0) {
        const m = e.monedaMonto || 'USD';
        acc[m] = (acc[m] ?? 0) + e.montoEstimado;
      }
    }
    return acc;
  }, [eventosDelMes]);

  // Próximo cobro: cualquier evento con monto (dividendo, renta o amortización
  // de bonos ARG) más cercano desde hoy — balances no cuentan, no son cobro.
  // Busca sobre todos los eventos cargados (año actual + siguiente, ver
  // useCalendario), sin importar qué mes esté mirando la grilla.
  const proximoCobro = useMemo(() => {
    return eventosFiltrados
      .filter((e) => e.tipo !== 'earnings' && e.montoEstimado != null && e.montoEstimado > 0 && e.fecha >= hoyKey)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))[0] ?? null;
  }, [eventosFiltrados, hoyKey]);

  return (
    <div className="cal-root" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px 12px' }}>
        <div className="cal-nav">
          <button type="button" onClick={irMesAnterior} className="app-bar-btn" aria-label="Mes anterior">
            <Chevron haciaAtras />
          </button>
          <p className="cal-header-mes" aria-live="polite">
            {MESES_LABEL[mesIdx]} {year}
          </p>
          <button type="button" onClick={irMesSiguiente} className="app-bar-btn" aria-label="Mes siguiente">
            <Chevron />
          </button>
          {!esMesActual && (
            <button type="button" className="chip accion" onClick={irHoy} style={{ marginLeft: 4 }}>Hoy</button>
          )}
        </div>

        <Segmented
          opciones={FILTROS_TIPO}
          activa={filtroTipo}
          onChange={setFiltroTipo}
          chico
          etiqueta="Tipo de evento"
          className="seg-ancho"
        />
      </div>

      {tickersDisponibles.length > 0 && (
        <div className="chips" role="group" aria-label="Filtrar por activo">
          <button type="button" className="chip" aria-pressed={filtroTicker === null} onClick={() => setFiltroTicker(null)}>Todos</button>
          {tickersDisponibles.map((t) => (
            <button
              key={t}
              type="button"
              className="chip"
              aria-pressed={filtroTicker === t}
              onClick={() => setFiltroTicker((prev) => prev === t ? null : t)}
            >{t}</button>
          ))}
        </div>
      )}

      {loadingEventos ? (
        <Cargando etiqueta={`Cargando eventos de ${year}`} kpis={3} alto={300} />
      ) : (
        <>
          {/* ── Resumen: responde "¿cuánto cobro y cuándo es lo próximo?" sin
              escanear la grilla. Los 3 bloques se muestran siempre que haya
              algo que mostrar; si no hay próximo cobro ni cobro anual, no
              tiene sentido ocupar el espacio con ceros. */}
          {(proximoCobro || Object.keys(totalMesPorMoneda).length > 0 || cobroAnualTotal > 0) && (
            <div className="cal-resumen-row">
              <div className={`card cal-resumen${proximoCobro ? ' destacado' : ''}`}>
                <span className="cal-resumen-label">Próximo cobro</span>
                {proximoCobro ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <LogoTicker ticker={proximoCobro.ticker} conLogo={tickerConLogo(proximoCobro.tipo)} size={32} />
                    <div style={{ minWidth: 0 }}>
                      <p className="cal-resumen-valor" style={{ fontSize: 17 }}>
                        {proximoCobro.ticker}
                        <span style={{ fontWeight: 400, color: 'var(--text-sec)' }}> el {fmtFechaEvento(proximoCobro.fecha)}</span>
                      </p>
                      <p className="card-sub" style={{ margin: 0 }}>
                        {fmtMonto(proximoCobro.montoEstimado!, proximoCobro.monedaMonto, hideValues)}
                        {esDividendo(proximoCobro.tipo) ? ' neto' : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="card-sub">Sin cobros próximos a la vista</p>
                )}
              </div>

              <div className="card cal-resumen">
                <span className="cal-resumen-label">A cobrar este mes</span>
                {Object.keys(totalMesPorMoneda).length > 0 ? (
                  <>
                    <p
                      title={`Neto estimado a acreditar este mes según tu tenencia y precios actuales.\n\nDividendos: ya descontada la retención del ${formatPercent(RETENCION_USA * 100, { sign: false, decimals: 0 })} de EE.UU. y el ${formatPercent(IMPUESTO_CHEQUE * 100, { sign: false })} de débitos y créditos → llega el ${formatPercent(FACTOR_NETO_DIVIDENDO * 100, { sign: false })} del bruto.\nNo incluye la comisión del depositario.\n\nRenta y amortización de bonos ARG: sin retención, al 100%.`}
                      className="cal-resumen-valor"
                    >
                      {Object.entries(totalMesPorMoneda).map(([moneda, total]) => fmtMonto(total, moneda, hideValues)).join(' + ')}
                    </p>
                    <span className="card-sub" style={{ margin: 0 }}>neto estimado</span>
                  </>
                ) : (
                  <p className="card-sub">Sin cobros este mes</p>
                )}
              </div>

              <div className="card cal-resumen">
                <span className="cal-resumen-label">Proyección anual</span>
                {cobroAnualTotal > 0 ? (
                  <>
                    <p
                      title="Tenencia actual × yield de los últimos 12 meses, ya neto de retenciones. Asume que se repiten igual el año próximo — no son pagos confirmados."
                      className="cal-resumen-valor"
                      style={{ color: 'var(--up)' }}
                    >
                      {/* "≈ +USD 120", no "+≈ USD": el signo va pegado al monto. */}
                      ≈ {formatMoney(cobroAnualTotal, { currency: 'USD', sign: true, hidden: hideValues })}
                    </p>
                    <span className="card-sub" style={{ margin: 0 }}>
                      por año, {formatPercent(yieldCartera * 100, { sign: false, decimals: 2 })} de la cartera
                    </span>
                  </>
                ) : (
                  <p className="card-sub">Sin proyección disponible</p>
                )}
              </div>
            </div>
          )}

          <div className="card cal-mes">
            <div className="cal-grid" aria-hidden="true">
              {DIAS_SEMANA.map((d) => (
                <div key={d} className="cal-semana-dia">{d}</div>
              ))}
            </div>
            <div className="cal-grid">
              {celdas.map((dia, i) => {
                const key = dia !== null ? `${year}-${String(mesIdx + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : '';
                return (
                  <DiaCelda
                    key={i}
                    dia={dia}
                    eventosDia={dia !== null ? eventosPorDia.get(key) : undefined}
                    esHoy={key === hoyKey}
                    esFinde={i % 7 >= 5}
                    logoSize={logoSize}
                    maxLogos={maxLogos}
                    yieldPorTicker={yieldPorTicker}
                    hideValues={hideValues}
                  />
                );
              })}
            </div>
          </div>

          <div className="card">
            <p className="card-titulo" style={{ marginBottom: 4 }}>Eventos de {MESES_LABEL[mesIdx].toLowerCase()}</p>
            {eventosDelMes.length === 0 ? (
              <p className="card-sub">No hay eventos este mes con los filtros elegidos.</p>
            ) : (
              <div>
                {eventosDelMes.map((e, i) => {
                  const meta = TIPO_EVENTO_META[e.tipo];
                  return (
                    <div key={i} className="cal-evento-fila">
                      <LogoTicker ticker={e.ticker} conLogo={tickerConLogo(e.tipo)} size={24} />
                      <span style={{ fontWeight: 600, color: 'var(--text)', minWidth: 52 }}>{e.ticker}</span>
                      <span style={{ color: 'var(--text-sec)', minWidth: 96, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtFechaEvento(e.fecha)}</span>
                      <span className="etiqueta" style={{ marginLeft: 0, '--etiqueta-color': meta.color } as React.CSSProperties}>{meta.label}</span>
                      {e.detalle && <span style={{ color: 'var(--muted)' }}>{e.detalle}</span>}
                      {esDividendo(e.tipo) && yieldPorTicker.has(e.ticker) && (
                        <span
                          title={`Yield de los últimos 12 meses, ${fmtMonto(yieldPorTicker.get(e.ticker)!.cobroAnual ?? 0, 'USD', hideValues)} por año`}
                          style={{ color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                        >
                          rinde {formatPercent(yieldPorTicker.get(e.ticker)!.yieldAnual * 100, { sign: false, decimals: 2 })}
                        </span>
                      )}
                      {e.montoEstimado != null && e.montoEstimado > 0 && (
                        <span
                          className="cal-evento-monto"
                          title={tooltipMonto(e.tipo, e.estimadoAl)}
                          style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                        >
                          {fmtMonto(e.montoEstimado, e.monedaMonto, hideValues)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}

      {errorEventos && (
        <p className="nota" role="alert" style={{ color: 'var(--down)' }}>Algunos eventos no se pudieron cargar: {errorEventos}</p>
      )}
    </div>
  );
}
