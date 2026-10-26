'use client';

import { useEffect, useMemo, useState } from 'react';
import type { DashboardData, EventoTipo, EventoCalendario, YieldTicker } from '@/types';
import { useCalendario } from '@/lib/useCalendario';
import { tickersDeCartera } from '@/lib/tickersElegibles';
import { RETENCION_USA, IMPUESTO_CHEQUE, FACTOR_NETO_DIVIDENDO } from '@/lib/retenciones';
import { formatMoney, formatPercent } from '@/lib/format';

interface Props {
  data: DashboardData;
}

const TIPO_EVENTO_META: Record<EventoTipo, { label: string; color: string }> = {
  dividendo:      { label: 'Dividendo',        color: '#6a9bab' },
  'dividendo-fut':{ label: 'Div. confirmado',  color: '#7fb0c2' },
  earnings:       { label: 'Balance',          color: '#c15c4a' },
  renta:          { label: 'Renta',            color: '#5fb896' },
  amortizacion:   { label: 'Amortización',     color: '#cfab6e' },
};

// Tipos agrupados para los filtros (dividendo histórico + futuro se filtran juntos).
const FILTROS_TIPO: { label: string; tipos: EventoTipo[] }[] = [
  { label: 'Balances',      tipos: ['earnings'] },
  { label: 'Dividendos',    tipos: ['dividendo', 'dividendo-fut'] },
  { label: 'Renta',         tipos: ['renta'] },
  { label: 'Amortización',  tipos: ['amortizacion'] },
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
function fmtMonto(monto: number, moneda?: string): string {
  return `≈ ${formatMoney(monto, { currency: moneda === 'ARS' ? 'ARS' : 'USD' })}`;
}

/** Los dividendos se muestran netos de retención; los flujos de bonos ARG, completos. */
function esDividendo(tipo: EventoTipo): boolean {
  return tipo === 'dividendo' || tipo === 'dividendo-fut';
}

/** Explica de dónde sale el monto mostrado, según lleve retención o no. */
function tooltipMonto(tipo: EventoTipo): string {
  if (esDividendo(tipo)) {
    return `Neto estimado a acreditar, según tu tenencia y el precio de mercado actual.\n`
      + `Ya descontado: ${formatPercent(RETENCION_USA * 100, { sign: false, decimals: 0 })} de retención de EE.UU. + ${formatPercent(IMPUESTO_CHEQUE * 100, { sign: false })} de débitos y créditos `
      + `(llega el ${formatPercent(FACTOR_NETO_DIVIDENDO * 100, { sign: false })} del bruto).\n`
      + `No incluye la comisión del depositario (Comafi, ~1-2%).`;
  }
  return 'Cobro estimado según tu tenencia y el precio de mercado actual.\nSin retención de origen: los bonos ARG se acreditan completos.';
}

/** true cuando el viewport es de celular. Los logos del calendario reciben su
 *  tamaño por prop (no por CSS), así que hace falta saberlo en JS. */
function useEsMobile(): boolean {
  const [esMobile, setEsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const sync = () => setEsMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return esMobile;
}

function Pill({ label, active, color, onClick }: {
  label: string; active: boolean; color?: string; onClick: () => void;
}) {
  const c = color ?? 'var(--primary)';
  return (
    <button
      onClick={onClick}
      className="pill-touch"
      aria-pressed={active}
      style={{
        padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
        cursor: 'pointer', border: '1px solid',
        borderColor: active ? c : 'var(--border)',
        background: active ? `${c}22` : 'transparent',
        color: active ? c : 'var(--muted)',
        transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
      }}
    >{label}</button>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {children}
    </div>
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
        width: size, height: size, borderRadius: '50%', background: 'var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.4, fontWeight: 700, color: 'var(--muted)', flexShrink: 0,
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
      onError={() => setError(true)}
      style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'contain', background: '#fff' }}
    />
  );
}

// Los bonos ARG (renta/amortización) no tienen logo de empresa; el resto sí.
function tickerConLogo(tipo: EventoTipo): boolean {
  return tipo !== 'renta' && tipo !== 'amortizacion';
}

function DiaCelda({
  dia, eventosDia, esHoy, logoSize, maxLogos, yieldPorTicker,
}: {
  dia: number | null;
  eventosDia?: EventoCalendario[];
  esHoy: boolean;
  logoSize: number;
  maxLogos: number;
  yieldPorTicker: Map<string, YieldTicker>;
}) {
  if (dia === null) {
    return <div className="cal-dia-vacio" style={{ minHeight: 88, borderRadius: 8 }} />;
  }

  // Solo los dividendos con monto entran al detalle: son los que tienen yield asociado.
  const conMonto = (eventosDia ?? []).filter(
    (e) => esDividendo(e.tipo) && e.montoEstimado != null && e.montoEstimado > 0,
  );

  return (
    <div className="cal-dia" style={{
      minHeight: 88, borderRadius: 8, padding: '6px 6px',
      border: esHoy ? '1px solid var(--primary)' : '1px solid var(--border)',
      background: esHoy ? 'color-mix(in srgb, var(--primary) 10%, var(--card))' : 'var(--card)',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span className="cal-dia-num" style={{
        fontSize: 11, fontWeight: esHoy ? 800 : 600,
        color: esHoy ? 'var(--primary)' : 'var(--muted)',
      }}>
        {dia}
      </span>
      {eventosDia && eventosDia.length > 0 && (
        <div className="cal-dia-logos" style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
          {eventosDia.slice(0, maxLogos).map((e, i) => {
            const meta = TIPO_EVENTO_META[e.tipo];
            const montoTxt = e.montoEstimado != null && e.montoEstimado > 0
              ? ` ${fmtMonto(e.montoEstimado, e.monedaMonto)}${esDividendo(e.tipo) ? ' neto' : ''}`
              : '';
            const y = yieldPorTicker.get(e.ticker);
            const yieldTxt = y && esDividendo(e.tipo)
              ? `\nYield 12m: ${formatPercent(y.yieldAnual * 100, { sign: false, decimals: 2 })} · ${fmtMonto(y.cobroAnual ?? 0, 'USD')}/año`
              : '';
            const tip = `${e.ticker}: ${meta.label}${e.detalle ? ` (${e.detalle})` : ''}${montoTxt}${yieldTxt}`;
            const dot = Math.max(6, Math.round(logoSize * 0.3));
            return (
              <div key={i} title={tip} className="cal-dia-logo" style={{ position: 'relative' }}>
                <LogoTicker ticker={e.ticker} conLogo={tickerConLogo(e.tipo)} size={logoSize} />
                <span className="cal-dia-dot" style={{
                  position: 'absolute', bottom: -1, right: -1, width: dot, height: dot,
                  borderRadius: '50%', background: meta.color, border: '1.5px solid var(--card)',
                }} />
              </div>
            );
          })}
          {/* En mobile no entran todos los logos: el resto se cuenta acá y se
              lee completo en la lista de eventos de abajo. */}
          {eventosDia.length > maxLogos && (
            <span style={{
              fontSize: Math.max(8, Math.round(logoSize * 0.38)), fontWeight: 700,
              color: 'var(--muted)', alignSelf: 'center', lineHeight: 1,
            }}>
              +{eventosDia.length - maxLogos}
            </span>
          )}
        </div>
      )}

      {/* Monto y yield del día, bajo los logos. En pantalla chica se ocultan por
          CSS: la celda no da el ancho y el dato queda en la lista de abajo. */}
      {conMonto.length > 0 && (
        <div className="cal-dia-montos" style={{ display: 'flex', flexDirection: 'column', gap: 1, marginTop: 'auto' }}>
          {conMonto.slice(0, 2).map((e, i) => {
            const y = yieldPorTicker.get(e.ticker);
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 4, lineHeight: 1.25 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMonto(e.montoEstimado!, e.monedaMonto)}
                </span>
                {y && (
                  <span
                    title={`Yield 12m de ${e.ticker}: ${formatPercent(y.yieldAnual * 100, { sign: false, decimals: 2 })} · ${fmtMonto(y.cobroAnual ?? 0, 'USD')}/año`}
                    style={{ fontSize: 9, fontWeight: 700, color: TIPO_EVENTO_META.dividendo.color, whiteSpace: 'nowrap' }}
                  >
                    {formatPercent(y.yieldAnual * 100, { sign: false })}
                  </span>
                )}
              </div>
            );
          })}
          {conMonto.length > 2 && (
            <span style={{ fontSize: 9, color: 'var(--muted)', lineHeight: 1.25 }}>
              +{conMonto.length - 2} más
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function CalendarioTab({ data }: Props) {
  const { tenenciasPorMes } = data;

  const esMobile = useEsMobile();
  const logoSize = esMobile ? 18 : 30;
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
  const [filtroTipos, setFiltroTipos] = useState<EventoTipo[] | null>(null);

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

  return (
    <div className="cal-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={irMesAnterior}
            className="cal-nav-btn"
            aria-label="Mes anterior"
            style={{
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)',
              borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13,
            }}
          >‹</button>
          <p className="cal-header-mes" style={{ margin: 0, fontSize: 16, fontWeight: 700, minWidth: 150, textAlign: 'center' }}>
            {MESES_LABEL[mesIdx]} {year}
          </p>
          <button
            onClick={irMesSiguiente}
            className="cal-nav-btn"
            aria-label="Mes siguiente"
            style={{
              border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)',
              borderRadius: 8, padding: '4px 10px', cursor: 'pointer', fontSize: 13,
            }}
          >›</button>
          {!esMesActual && (
            <Pill label="Hoy" active={false} onClick={irHoy} />
          )}
        </div>

        <div className="filtro-tickers" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Pill label="Todos" active={filtroTipos === null} onClick={() => setFiltroTipos(null)} />
          {FILTROS_TIPO.map((f) => {
            const activo = filtroTipos !== null && f.tipos.every((t) => filtroTipos.includes(t)) && filtroTipos.length === f.tipos.length;
            return (
              <Pill
                key={f.label}
                label={f.label}
                active={activo}
                color={TIPO_EVENTO_META[f.tipos[0]].color}
                onClick={() => setFiltroTipos((prev) =>
                  prev !== null && prev.length === f.tipos.length && f.tipos.every((t) => prev.includes(t)) ? null : f.tipos,
                )}
              />
            );
          })}
        </div>
      </div>

      {tickersDisponibles.length > 0 && (
        <div className="filtro-tickers" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
          <Pill label="Todos" active={filtroTicker === null} onClick={() => setFiltroTicker(null)} />
          {tickersDisponibles.map((t) => (
            <Pill key={t} label={t} active={filtroTicker === t} onClick={() => setFiltroTicker((prev) => prev === t ? null : t)} />
          ))}
        </div>
      )}

      {loadingEventos ? (
        <Card>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando eventos de {year}…</p>
        </Card>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
            <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {DIAS_SEMANA.map((d) => (
                <div key={d} style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textAlign: 'center' }}>{d}</div>
              ))}
            </div>
            <div className="cal-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
              {celdas.map((dia, i) => {
                const key = dia !== null ? `${year}-${String(mesIdx + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}` : '';
                return (
                  <DiaCelda
                    key={i}
                    dia={dia}
                    eventosDia={dia !== null ? eventosPorDia.get(key) : undefined}
                    esHoy={key === hoyKey}
                    logoSize={logoSize}
                    maxLogos={maxLogos}
                    yieldPorTicker={yieldPorTicker}
                  />
                );
              })}
            </div>
          </div>

          <Card>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
                Eventos de {MESES_LABEL[mesIdx]}
              </p>
              {Object.keys(totalMesPorMoneda).length > 0 && (
                <p
                  title={`Neto estimado a acreditar este mes según tu tenencia y precios actuales.\n\nDividendos: ya descontada la retención del ${formatPercent(RETENCION_USA * 100, { sign: false, decimals: 0 })} de EE.UU. (sin tratado de doble imposición con Argentina) y el ${formatPercent(IMPUESTO_CHEQUE * 100, { sign: false })} de débitos y créditos → llega el ${formatPercent(FACTOR_NETO_DIVIDENDO * 100, { sign: false })} del bruto.\nNo incluye la comisión del depositario (Comafi, ~1-2%), así que el neto real puede ser algo menor.\n\nRenta y amortización de bonos ARG: sin retención, al 100%.`}
                  style={{ margin: 0, fontSize: 12, fontWeight: 700, color: 'var(--text)' }}
                >
                  A cobrar (neto):{' '}
                  {Object.entries(totalMesPorMoneda)
                    .map(([moneda, total]) => fmtMonto(total, moneda))
                    .join('  ·  ')}
                  <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}>
                    · dividendos con {formatPercent(RETENCION_USA * 100, { sign: false, decimals: 0 })} de retención descontado
                  </span>
                  {cobroAnualTotal > 0 && (
                    <span
                      title={'Proyección anual de dividendos: tenencia actual × yield de los últimos 12 meses, ya neta de retenciones.\nAsume que se repiten igual el año próximo — no son pagos confirmados.'}
                      style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 6 }}
                    >
                      · {fmtMonto(cobroAnualTotal, 'USD')}/año ({formatPercent(yieldCartera * 100, { sign: false, decimals: 2 })} de la cartera)
                    </span>
                  )}
                </p>
              )}
            </div>
            {eventosDelMes.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Sin eventos este mes para los tickers actuales.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {eventosDelMes.map((e, i) => {
                  const meta = TIPO_EVENTO_META[e.tipo];
                  return (
                    <div key={i} className="cal-evento-fila" style={{
                      display: 'flex', alignItems: 'center', gap: 10, fontSize: 12,
                      padding: '6px 0', borderBottom: '1px solid var(--border-subtle)',
                    }}>
                      <LogoTicker ticker={e.ticker} conLogo={tickerConLogo(e.tipo)} size={20} />
                      <span style={{ color: 'var(--muted)', minWidth: 80, flexShrink: 0 }}>{fmtFechaEvento(e.fecha)}</span>
                      <span style={{ fontWeight: 700, color: 'var(--text)', minWidth: 56 }}>{e.ticker}</span>
                      <span style={{
                        fontSize: 10, fontWeight: 700, color: meta.color, background: `${meta.color}22`,
                        padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap',
                      }}>{meta.label}</span>
                      {e.detalle && <span style={{ color: 'var(--muted)' }}>{e.detalle}</span>}
                      {esDividendo(e.tipo) && yieldPorTicker.has(e.ticker) && (
                        <span
                          title={`Yield de los últimos 12 meses · ${fmtMonto(yieldPorTicker.get(e.ticker)!.cobroAnual ?? 0, 'USD')}/año`}
                          style={{
                            fontSize: 10, fontWeight: 700, color: TIPO_EVENTO_META.dividendo.color,
                            border: `1px solid ${TIPO_EVENTO_META.dividendo.color}55`,
                            padding: '1px 6px', borderRadius: 10, whiteSpace: 'nowrap',
                          }}
                        >
                          {formatPercent(yieldPorTicker.get(e.ticker)!.yieldAnual * 100, { sign: false, decimals: 2 })}
                        </span>
                      )}
                      {e.montoEstimado != null && e.montoEstimado > 0 && (
                        <span
                          className="cal-evento-monto"
                          title={tooltipMonto(e.tipo)}
                          style={{ marginLeft: 'auto', fontWeight: 700, color: meta.color, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                        >
                          {fmtMonto(e.montoEstimado, e.monedaMonto)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </>
      )}

      {errorEventos && (
        <p style={{ margin: 0, fontSize: 11, color: '#ef553b' }}>Algunos eventos no pudieron cargarse: {errorEventos}</p>
      )}
    </div>
  );
}
