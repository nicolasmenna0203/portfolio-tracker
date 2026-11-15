'use client';

import { useState, useMemo, useRef } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { DashboardData } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, formatNumber, formatMesKey } from '@/lib/format';
import { toMesKey } from '@/lib/parser';
import { tasaCartera, sumarMeses, type ResumenFlujo } from '@/lib/finanzasPersonales';
import KPICard from './KPICard';
import Segmented from './Segmented';

interface Props {
  data: DashboardData;
  hideValues: boolean;
  /** Flujo mensual en USD (ingreso, gastos, aporte real); null mientras carga. */
  flujo: ResumenFlujo | null;
}

/**
 * De dónde sale la tasa de la proyección. 'manual' es el slider; las otras dos
 * usan el TWR anualizado de la propia cartera (ver
 * docs/decisiones/0023-tasa-de-cartera-para-proyecciones.md).
 */
type TasaModo = 'manual' | '12m' | 'max';

interface Params {
  aporte: number;
  tasa: number;
  horizonte: number;
  objetivo: number;
  /** Ausente en lo guardado antes de existir el modo: se lee como 'manual'. */
  tasaModo?: TasaModo;
}

const TASA_MODOS: { id: TasaModo; label: string }[] = [
  { id: 'manual', label: 'Manual' },
  { id: '12m',    label: 'Cartera 12m' },
  { id: 'max',    label: 'Cartera total' },
];

// Por encima de esto la tasa observada es casi seguro un tramo bueno del mercado
// y no algo sostenible a años vista; se avisa, no se recorta.
const TASA_ALTA_PCT = 25;

// ── Controles persistidos ─────────────────────────────────────────────────────

const PARAMS_KEY = 'proyecciones_params_v1';

function loadParams(): Params | null {
  try {
    const s = localStorage.getItem(PARAMS_KEY);
    if (s) return JSON.parse(s) as Params;
  } catch {}
  return null;
}

function saveParams(p: Params) {
  try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)); } catch {}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step, fmt, onChange,
}: {
  label: string; value: number; min: number; max: number;
  step: number; fmt: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 13, color: 'var(--text-sec)' }}>
          {label}
        </span>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(value)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={fmt(value)}
        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(min)}</span>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(max)}</span>
      </div>
    </div>
  );
}

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tooltip-panel">
      <p className="tooltip-titulo">{label}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} className="tooltip-fila">
            <span><span className="tooltip-marca" style={{ background: p.color }} />{p.name}</span>
            <span>{formatMoney(p.value, { currency: 'USD' })}</span>
          </p>
        )
      ))}
    </div>
  );
}

// ── Proyección compuesta ──────────────────────────────────────────────────────

function buildProyeccion(
  totalActual: number,
  aporteMensual: number,
  tasaAnual: number,
  horizonteMeses: number,
): { mes: number; proyectado: number }[] {
  const tasaMensual = Math.pow(1 + tasaAnual / 100, 1 / 12) - 1;
  const puntos: { mes: number; proyectado: number }[] = [];
  let acum = totalActual;
  for (let i = 1; i <= horizonteMeses; i++) {
    acum = acum * (1 + tasaMensual) + aporteMensual;
    puntos.push({ mes: i, proyectado: Math.round(acum) });
  }
  return puntos;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ProyeccionesTab({ data, hideValues, flujo }: Props) {
  const { kpis, resumenSeries } = data;
  const isMobile = useIsMobile();
  const totalActual = kpis.totalCartera;

  // Mes del último cierre: de ahí se cuentan los meses de la proyección. Sale del
  // timestamp y no del rótulo `fecha`, que es texto para mostrar.
  const ultimoMes = toMesKey(resumenSeries[resumenSeries.length - 1]?.fechaTs ?? Date.now());
  const labelMesFuturo = (mesOffset: number) => formatMesKey(sumarMeses(ultimoMes, mesOffset));

  // ── Controles (persistidos en localStorage). Se leen una sola vez: esto corre en
  // cada movimiento de un slider.
  const [saved] = useState(loadParams);
  const [aporte,    setAporte]    = useState(saved?.aporte    ?? 500);
  const [tasa,      setTasa]      = useState(saved?.tasa      ?? 10);
  const [horizonte, setHorizonte] = useState(saved?.horizonte ?? 60);
  const [objetivo,  setObjetivo]  = useState(saved?.objetivo  ?? (Math.round(totalActual * 2 / 1000) * 1000 || 100000));
  const [tasaModo,  setTasaModo]  = useState<TasaModo>(saved?.tasaModo ?? 'manual');

  // Un solo punto de guardado: cada control cambia un campo y persiste el resto tal cual.
  function actualizar(cambio: Partial<Params>) {
    const next: Params = { aporte, tasa, horizonte, objetivo, tasaModo, ...cambio };
    setAporte(next.aporte); setTasa(next.tasa); setHorizonte(next.horizonte);
    setObjetivo(next.objetivo); setTasaModo(next.tasaModo ?? 'manual');
    saveParams(next);
  }
  const updateAporte    = (v: number)    => actualizar({ aporte: v });
  const updateTasa      = (v: number)    => actualizar({ tasa: v });
  const updateHorizonte = (v: number)    => actualizar({ horizonte: v });
  const updateObjetivo  = (v: number)    => actualizar({ objetivo: v });
  const updateTasaModo  = (v: TasaModo)  => actualizar({ tasaModo: v });

  // ── Tasa observada de la cartera (TWR anualizado en USD) en las dos ventanas
  const tasa12m = useMemo(() => tasaCartera(resumenSeries, data.movimientos, '12m'), [resumenSeries, data.movimientos]);
  const tasaMax = useMemo(() => tasaCartera(resumenSeries, data.movimientos, 'max'), [resumenSeries, data.movimientos]);
  const tasaObservada = tasaModo === '12m' ? tasa12m : tasaModo === 'max' ? tasaMax : null;
  // Si el modo guardado ya no tiene datos (serie recortada), se cae al slider.
  const usaCartera = tasaObservada != null;
  const tasaEfectiva = tasaObservada?.twrAnualPct ?? tasa;

  // ── Aporte real (promedio de meses cerrados) como punto de partida
  const aporteReal = flujo?.aporteProm != null && flujo.aporteProm > 0 ? flujo.aporteProm : null;
  const aporteRealRedondeado = aporteReal != null ? Math.round(aporteReal / 50) * 50 : null;
  // Tope del slider: debe abarcar el aporte real y el valor guardado, pero NO
  // depender del valor que se está arrastrando (si no, el tope se movería bajo el
  // dedo). Por eso usa el aporte con el que arrancó el componente, no el actual.
  const aporteInicial = useRef(aporte).current;
  const aporteMax = Math.max(5000, Math.ceil(aporteInicial / 500) * 500, Math.ceil((aporteReal ?? 0) * 2 / 500) * 500);


  // ── Datos históricos normalizados para el gráfico
  const historico = useMemo(() =>
    resumenSeries.map(r => ({
      label: r.fecha,
      real: Math.round(r.total_cartera),
      proyectado: undefined as number | undefined,
    })),
  [resumenSeries]);

  // ── Proyección futura
  const proyeccion = useMemo(() =>
    buildProyeccion(totalActual, aporte, tasaEfectiva, horizonte),
  [totalActual, aporte, tasaEfectiva, horizonte]);

  // ── Datos combinados para el gráfico
  const chartData = useMemo(() => {
    const hist = historico.map(h => ({ ...h, proyectado: undefined as number | undefined }));
    // Punto de unión: el último histórico también tiene valor proyectado = totalActual
    if (hist.length > 0) {
      hist[hist.length - 1].proyectado = Math.round(totalActual);
    }
    const future = proyeccion.map((p, i) => ({
      label: formatMesKey(sumarMeses(ultimoMes, i + 1)),
      real: undefined as number | undefined,
      proyectado: p.proyectado,
    }));
    return [...hist, ...future];
  }, [historico, proyeccion, totalActual, ultimoMes]);

  // ── Cuándo se alcanza el objetivo
  const mesObjetivo = useMemo(() => {
    if (objetivo <= totalActual) return 0;
    const idx = proyeccion.findIndex(p => p.proyectado >= objetivo);
    return idx === -1 ? null : idx + 1;
  }, [proyeccion, objetivo, totalActual]);

  const labelMesObj = mesObjetivo != null && mesObjetivo > 0
    ? labelMesFuturo(mesObjetivo)
    : null;

  const finalProyectado = proyeccion[proyeccion.length - 1]?.proyectado ?? totalActual;
  const aportesTotales = aporte * horizonte;
  // El capital proyectado se descompone en tres partes disjuntas:
  //   capital = cartera hoy + aportes acumulados + interés generado
  // La "ganancia" es solo la tercera: lo que aportás es plata tuya que cambiás
  // de lugar, no una ganancia. Antes acá se mostraba (final - totalActual), que
  // incluía los aportes y por eso duplicaba la cifra.
  const interesGenerado = finalProyectado - totalActual - aportesTotales;

  // ── Ticks del eje X (mostrar cada N puntos para no saturar)
  const totalPuntos = chartData.length;
  const cadaNPuntos = Math.max(1, Math.floor(totalPuntos / (isMobile ? 5 : 8)));
  const textoHorizonte = horizonte >= 12 ? `${formatNumber(horizonte / 12, { decimals: 1 })} años` : `${horizonte} meses`;

  return (
    <div className="proy-root">

      {/* Parámetros a la izquierda; a la derecha el resultado y el gráfico, que
          así se ve cambiar mientras se mueve un slider (ver .proy-layout). */}
      <div className="proy-layout">

        {/* Panel de controles */}
        <div className="card proy-controles">
          <p className="card-titulo">Parámetros</p>
          {/* Solo en el celular: los resultados quedan una pantalla más abajo, y mover
              un slider sin ver qué cambia no sirve de nada. */}
          <div className="proy-resultado-fijo" role="status">
            <span>En {textoHorizonte}: <strong>{formatMoney(finalProyectado, { currency: 'USD', hidden: hideValues })}</strong></span>
            <span>
              Objetivo: <strong>{objetivo <= totalActual ? 'alcanzado' : labelMesObj ?? 'fuera del horizonte'}</strong>
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <SliderRow
              label="Aporte mensual"
              value={aporte} min={0} max={aporteMax} step={50}
              fmt={v => formatMoney(v, { currency: 'USD', hidden: hideValues })}
              onChange={updateAporte}
            />
            {/* El aporte real sale de Ingresos + movimientos (lib/finanzasPersonales.ts). */}
            {aporteRealRedondeado != null && flujo && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <button
                  type="button"
                  className="g-btn chico tintado"
                  onClick={() => updateAporte(aporteRealRedondeado)}
                  disabled={aporte === aporteRealRedondeado}
                  style={{ alignSelf: 'flex-start', whiteSpace: 'normal', textAlign: 'left', padding: '5px 11px' }}
                >
                  {aporte === aporteRealRedondeado
                    ? 'Es tu aporte real'
                    : `Usar mi aporte real, ${formatMoney(aporteRealRedondeado, { currency: 'USD', hidden: hideValues })}`}
                </button>
                {flujo.ratioInversionPct != null && flujo.ingresoProm != null && !hideValues && (
                  <span className="card-sub">
                    Invertís {formatPercent(flujo.ratioInversionPct, { sign: false, decimals: 0 })} del ingreso de{' '}
                    {formatMoney(flujo.ingresoProm, { currency: 'USD' })}/mes (prom. {flujo.mesesBase} meses cerrados).
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Tasa: manual o la observada de la propia cartera. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ fontSize: 13, color: 'var(--text-sec)' }}>
              Tasa anual estimada
            </span>
            <Segmented
              opciones={TASA_MODOS.map((m) => ({
                id: m.id,
                label: m.label,
                disabled: m.id !== 'manual' && (m.id === '12m' ? tasa12m : tasaMax) == null,
              }))}
              activa={usaCartera ? tasaModo : 'manual'}
              onChange={updateTasaModo}
              chico
              etiqueta="Origen de la tasa"
              style={{ alignSelf: 'stretch', display: 'flex' }}
              className="seg-parejo"
            />

            {tasaObservada == null ? (
              <SliderRow
                label="Tasa manual"
                value={tasa} min={1} max={30} step={0.5}
                fmt={v => formatPercent(v, { sign: false })}
                onChange={updateTasa}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent(tasaObservada.twrAnualPct, { sign: false, hidden: hideValues })}
                </span>
                <span className="card-sub">
                  TWR anualizado en USD, {tasaObservada.meses} meses desde {tasaObservada.desdeFecha}.
                  {tasaObservada.tirAnualPct != null && !hideValues && (
                    <> TIR del mismo tramo, solo de referencia: {formatPercent(tasaObservada.tirAnualPct, { sign: false })}.</>
                  )}
                </span>
                {(tasaObservada.meses < 12 || tasaObservada.twrAnualPct > TASA_ALTA_PCT) && (
                  <span className="card-sub" style={{ color: 'var(--warn)' }}>
                    {tasaObservada.meses < 12
                      ? 'Menos de 12 meses de historia: anualizar extrapola un tramo corto.'
                      : 'Tasa alta: proyectarla a años asume que el tramo bueno se repite. Tomalo como techo.'}
                  </span>
                )}
              </div>
            )}
          </div>

          <SliderRow
            label="Horizonte"
            value={horizonte} min={6} max={120} step={6}
            fmt={v => v >= 12 ? `${formatNumber(v / 12, { decimals: 1 })} años` : `${v} meses`}
            onChange={updateHorizonte}
          />
          <SliderRow
            label="Objetivo de capital"
            value={objetivo} min={10000} max={1000000} step={5000}
            fmt={v => formatMoney(v, { currency: 'USD', hidden: hideValues })}
            onChange={updateObjetivo}
          />
        </div>

        <div className="proy-resultado">
          {/* En mobile la primera y la última van a todo el ancho (.kpi-grid): el
              capital proyectado es la cifra principal y la ganancia lleva el
              desglose, que en media tarjeta se cortaba. */}
          <div className="kpi-grid proy-kpis">
            <KPICard
              label="Capital proyectado"
              value={formatMoney(finalProyectado, { currency: 'USD', hidden: hideValues })}
              sub={`en ${textoHorizonte}`}
            />
            <KPICard
              label={`Objetivo${hideValues ? '' : ` de ${formatMoney(objetivo, { currency: 'USD' })}`}`}
              value={objetivo <= totalActual ? 'Alcanzado' : labelMesObj ?? 'Fuera del horizonte'}
              vacio={objetivo > totalActual && !labelMesObj}
              sub={objetivo <= totalActual
                ? 'la cartera ya lo supera'
                : labelMesObj
                  ? `en ${mesObjetivo! >= 12 ? `${formatNumber(mesObjetivo! / 12, { decimals: 1 })} años` : `${mesObjetivo} meses`}`
                  : 'probá con más plazo o más aporte'}
              subColor={objetivo <= totalActual ? 'var(--up)' : undefined}
            />
            <KPICard
              label="Cartera hoy"
              value={formatMoney(totalActual, { currency: 'USD', hidden: hideValues })}
              sub={`al ${kpis.fechaStr}`}
            />
            <KPICard
              label="Ganancia proyectada"
              tooltip="Solo el interés generado. Lo que aportás es plata tuya que cambia de lugar, no una ganancia: capital proyectado = cartera de hoy + aportes + interés."
              value={formatMoney(interesGenerado, { currency: 'USD', sign: true, hidden: hideValues })}
              sub={hideValues
                ? '••••'
                : `más ${formatMoney(aportesTotales, { currency: 'USD' })} de aportes`}
            />
          </div>

          {/* ── Gráfico histórico + proyección ──────────────────────────────── */}
          <div className="card" style={{ paddingBottom: 8 }}>
            <div className="card-cabecera" style={{ justifyContent: 'space-between' }}>
              <p className="card-titulo">Evolución y proyección</p>
              <div className="leyenda">
                <span><span style={{ width: 14, height: 2, borderRadius: 1, background: 'var(--primary)' }} />Cartera real</span>
                <span><span style={{ width: 14, height: 0, borderTop: '2px dashed #5e5ce6' }} />Proyección</span>
              </div>
            </div>

        <ResponsiveContainer width="100%" height={isMobile ? 260 : 300}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              interval={cadaNPuntos - 1}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => (hideValues ? '••••' : formatMoney(v, { currency: 'USD', mode: 'compact', compactShort: isMobile }))}
              width={isMobile || hideValues ? 40 : 60}
            />
            <Tooltip content={hideValues ? () => null : <CustomTooltip />} />

            {/* Sin animación: el gráfico se recalcula en cada paso de un slider, y
                reanimarlo mientras se arrastra lo vuelve lento e ilegible. */}
            {/* Línea histórica */}
            <Line
              type="monotone"
              dataKey="real"
              name="Cartera real"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />

            {/* Área proyectada */}
            <Area
              type="monotone"
              dataKey="proyectado"
              name="Proyección"
              stroke="#5e5ce6"
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="#5e5ce618"
              dot={false}
              connectNulls={false}
              isAnimationActive={false}
            />

            {/* Línea del objetivo */}
            {objetivo > 0 && (
              <ReferenceLine
                y={objetivo}
                stroke="var(--primary)"
                strokeDasharray="4 3"
                strokeOpacity={0.5}
                label={{
                  value: hideValues ? 'Objetivo' : `Objetivo ${formatMoney(objetivo, { currency: 'USD' })}`,
                  position: 'insideTopRight',
                  fontSize: 10,
                  fill: 'var(--primary)',
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
          </div>
        </div>
      </div>

    </div>
  );
}
