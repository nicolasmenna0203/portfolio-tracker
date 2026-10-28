'use client';

import { useState, useMemo } from 'react';
import {
  ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import type { DashboardData } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, formatNumber } from '@/lib/format';

interface Props {
  data: DashboardData;
  hideValues: boolean;
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
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--primary)', fontVariantNumeric: 'tabular-nums' }}>
          {fmt(value)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: 'var(--primary)', cursor: 'pointer' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(min)}</span>
        <span style={{ fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmt(max)}</span>
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
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
    }}>
      <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        p.value != null && (
          <p key={p.dataKey} style={{ margin: '2px 0', color: p.color }}>
            {p.name}: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.value, { currency: 'USD' })}</strong>
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

// ── Etiqueta de mes relativo ──────────────────────────────────────────────────

function labelMesFuturo(mesOffset: number, ultimaFecha: string): string {
  const mesesES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // ultimaFecha es tipo "Mar-2025"
  const partes = ultimaFecha.split('-');
  const mesesMap: Record<string, number> = {
    Ene: 0, Feb: 1, Mar: 2, Abr: 3, May: 4, Jun: 5,
    Jul: 6, Ago: 7, Sep: 8, Oct: 9, Nov: 10, Dic: 11,
  };
  const mesInicial = mesesMap[partes[0]] ?? 0;
  const anioInicial = parseInt(partes[1]) || new Date().getFullYear();
  const total = mesInicial + mesOffset;
  const mes = total % 12;
  const anio = anioInicial + Math.floor(total / 12);
  return `${mesesES[mes]}-${anio}`;
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function ProyeccionesTab({ data, hideValues }: Props) {
  const { kpis, resumenSeries } = data;
  const isMobile = useIsMobile();
  const totalActual = kpis.totalCartera;

  const ultimaFecha = resumenSeries[resumenSeries.length - 1]?.fecha ?? '';

  // ── Controles (persistidos en localStorage)
  const PARAMS_KEY = 'proyecciones_params_v1';
  function loadParams() {
    try {
      const s = localStorage.getItem(PARAMS_KEY);
      if (s) return JSON.parse(s) as { aporte: number; tasa: number; horizonte: number; objetivo: number };
    } catch {}
    return null;
  }
  function saveParams(p: { aporte: number; tasa: number; horizonte: number; objetivo: number }) {
    try { localStorage.setItem(PARAMS_KEY, JSON.stringify(p)); } catch {}
  }

  const saved = loadParams();
  const [aporte,    setAporte]    = useState(saved?.aporte    ?? 500);
  const [tasa,      setTasa]      = useState(saved?.tasa      ?? 10);
  const [horizonte, setHorizonte] = useState(saved?.horizonte ?? 60);
  const [objetivo,  setObjetivo]  = useState(saved?.objetivo  ?? (Math.round(totalActual * 2 / 1000) * 1000 || 100000));

  function updateAporte(v: number)    { setAporte(v);    saveParams({ aporte: v,    tasa, horizonte, objetivo }); }
  function updateTasa(v: number)      { setTasa(v);      saveParams({ aporte, tasa: v,      horizonte, objetivo }); }
  function updateHorizonte(v: number) { setHorizonte(v); saveParams({ aporte, tasa, horizonte: v, objetivo }); }
  function updateObjetivo(v: number)  { setObjetivo(v);  saveParams({ aporte, tasa, horizonte, objetivo: v }); }

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
    buildProyeccion(totalActual, aporte, tasa, horizonte),
  [totalActual, aporte, tasa, horizonte]);

  // ── Datos combinados para el gráfico
  const chartData = useMemo(() => {
    const hist = historico.map(h => ({ ...h, proyectado: undefined as number | undefined }));
    // Punto de unión: el último histórico también tiene valor proyectado = totalActual
    if (hist.length > 0) {
      hist[hist.length - 1].proyectado = Math.round(totalActual);
    }
    const future = proyeccion.map((p, i) => ({
      label: labelMesFuturo(i + 1, ultimaFecha),
      real: undefined as number | undefined,
      proyectado: p.proyectado,
    }));
    return [...hist, ...future];
  }, [historico, proyeccion, totalActual, ultimaFecha]);

  // ── Cuándo se alcanza el objetivo
  const mesObjetivo = useMemo(() => {
    if (objetivo <= totalActual) return 0;
    const idx = proyeccion.findIndex(p => p.proyectado >= objetivo);
    return idx === -1 ? null : idx + 1;
  }, [proyeccion, objetivo, totalActual]);

  const labelMesObj = mesObjetivo != null && mesObjetivo > 0
    ? labelMesFuturo(mesObjetivo, ultimaFecha)
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
  const cadaNPuntos = Math.max(1, Math.floor(totalPuntos / 8));

  return (
    <div className="proy-root scroll-y" style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minHeight: 0 }}>

      {/* ── Fila principal: controles + KPIs ──────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>

        {/* Panel de controles */}
        <div className="proy-controles" style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '18px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          minWidth: 240,
          flex: '0 0 260px',
        }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Parámetros
          </p>
          <SliderRow
            label="Aporte mensual"
            value={aporte} min={0} max={5000} step={50}
            fmt={v => formatMoney(v, { currency: 'USD' })}
            onChange={updateAporte}
          />
          <SliderRow
            label="Tasa anual estimada"
            value={tasa} min={1} max={30} step={0.5}
            fmt={v => formatPercent(v, { sign: false })}
            onChange={updateTasa}
          />
          <SliderRow
            label="Horizonte"
            value={horizonte} min={6} max={120} step={6}
            fmt={v => v >= 12 ? `${formatNumber(v / 12, { decimals: 1 })} años` : `${v} meses`}
            onChange={updateHorizonte}
          />
          <SliderRow
            label="Objetivo de capital"
            value={objetivo} min={10000} max={1000000} step={5000}
            fmt={v => formatMoney(v, { currency: 'USD' })}
            onChange={updateObjetivo}
          />
        </div>

        {/* KPIs de proyección — grilla 2×2 (1 columna en mobile: ver
            `.proy-kpis` en globals.css, donde a dos columnas los montos de 6
            cifras no entran y se cortan). */}
        <div className="proy-kpis" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, flex: 1 }}>

          {/* Capital proyectado */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Capital proyectado
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(finalProyectado, { currency: 'USD', hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              en {horizonte >= 12 ? `${formatNumber(horizonte / 12, { decimals: 1 })} años` : `${horizonte} meses`}
            </p>
          </div>

          {/* Ganancia total */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Ganancia total
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: interesGenerado >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(interesGenerado, { currency: 'USD', sign: true, hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              {hideValues
                ? '••••'
                : `cartera hoy ${formatMoney(totalActual, { currency: 'USD' })} + aportes ${formatMoney(aportesTotales, { currency: 'USD' })} + interés ${formatMoney(interesGenerado, { currency: 'USD' })}`}
            </p>
          </div>

          {/* Objetivo */}
          <div style={{
            background: 'var(--card)',
            border: `1px solid ${labelMesObj ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 12, padding: '14px 18px',
            display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
              Objetivo {hideValues ? '' : formatMoney(objetivo, { currency: 'USD' })}
            </p>
            {objetivo <= totalActual ? (
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--up)' }}>¡Ya alcanzado!</p>
            ) : labelMesObj ? (
              <>
                <p style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--primary)', letterSpacing: '-0.03em' }}>
                  {labelMesObj}
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                  en {mesObjetivo! >= 12 ? `${formatNumber(mesObjetivo! / 12, { decimals: 1 })} años` : `${mesObjetivo} meses`}
                </p>
              </>
            ) : (
              <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--muted)' }}>Fuera del horizonte</p>
            )}
          </div>

          {/* Hoy */}
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)' }}>
              Cartera hoy
            </p>
            <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(totalActual, { currency: 'USD', hidden: hideValues })}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
              al {kpis.fechaStr}
            </p>
          </div>
        </div>
      </div>

      {/* ── Gráfico histórico + proyección ────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '18px 20px 10px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--primary)' }}>
            Evolución histórica + Proyección
          </p>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', marginRight: 5 }} />Cartera real</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#6a9bab', marginRight: 5 }} />Proyección</span>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              interval={cadaNPuntos - 1}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => formatMoney(v, { currency: 'USD', mode: 'compact', compactShort: isMobile, hidden: hideValues })}
              width={isMobile ? 40 : 52}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Línea histórica */}
            <Line
              type="monotone"
              dataKey="real"
              name="Cartera real"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={false}
              connectNulls={false}
            />

            {/* Área proyectada */}
            <Area
              type="monotone"
              dataKey="proyectado"
              name="Proyección"
              stroke="#6a9bab"
              strokeWidth={2}
              strokeDasharray="5 4"
              fill="#6a9bab18"
              dot={false}
              connectNulls={false}
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
  );
}
