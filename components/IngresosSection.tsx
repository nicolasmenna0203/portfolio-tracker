'use client';

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell,
  ComposedChart, Line, CartesianGrid, ResponsiveContainer,
} from 'recharts';
import type { IngresosResponse, IngresoRow } from '@/types';
import { ratioParaLinea, type MesFlujo } from '@/lib/finanzasPersonales';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import KPICard from './KPICard';

// Los datos los carga FinanzasPersonalesTab (se comparten con Gastos y
// Proyecciones); acá solo se muestran.
interface Props {
  resp: IngresosResponse | null;
  loading: boolean;
  error: string | null;
  /** Ingreso vs aporte por mes, en la moneda del toggle (lib/finanzasPersonales.ts). */
  serie: MesFlujo[];
  hideValues: boolean;
  moneda?: Moneda;
}

// Paleta fija por empleador, asignada en orden de aparición (nunca por índice
// recalculado al filtrar, para que un empleador no cambie de color si otro
// desaparece del set visible).
const EMPLEADOR_COLORS = ['#cfab6e', '#5fb896', '#8d7fc7', '#d9824e', '#6fa8d6', '#c15c4a'];

// Cuántas acreditaciones se muestran antes de pedir "Ver todos".
const PAGE_INGRESOS = 12;

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

function CustomTooltip({ active, payload, label, moneda }: { active?: boolean; payload?: TooltipPayload[]; label?: string; moneda?: Moneda }) {
  if (!active || !payload?.length) return null;
  const currency: Moneda = moneda === 'USD' ? 'USD' : 'ARS';
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontWeight: 600 }}>{label}</p>
      {payload.map((p) => (
        p.value > 0 && (
          <p key={p.dataKey} style={{ margin: '2px 0', color: p.color, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <span>{p.name}</span>
            <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(p.value, { currency })}</strong>
          </p>
        )
      ))}
    </div>
  );
}

/** Una barra del gráfico de inversión: el ingreso del mes partido en lo invertido y el resto. */
interface BarraInversion extends MesFlujo {
  ahorro: number;
  resto: number;
  /** El aporte supera el tope del eje (ver `techo`): la barra se ve cortada. */
  cortada: boolean;
  /** Ratio para la línea; `null` en meses atípicos (ver `ratioParaLinea`). */
  ratioLinea: number | null;
}

function InversionTooltip({ active, payload, moneda }: { active?: boolean; payload?: { payload: BarraInversion }[]; moneda: Moneda }) {
  if (!active || !payload?.length) return null;
  const m = payload[0].payload;
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '10px 14px', fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    }}>
      <p style={{ margin: '0 0 6px', color: 'var(--muted)', fontWeight: 600 }}>
        {m.fecha}{m.cerrado ? '' : ' · en curso'}
      </p>
      <p style={{ margin: '2px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--muted)' }}>Ingreso</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{formatMoney(m.ingreso, { currency: moneda })}</strong>
      </p>
      {/* Retiro neto en rojo y con signo: formatMoney descarta el signo salvo
          que se lo pidan, y un retiro sin "-" se leería como aporte. */}
      <p style={{ margin: '2px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: m.aporte < 0 ? 'var(--down)' : 'var(--up)' }}>
          {m.aporte < 0 ? 'Retiro neto' : 'Aporte a la cartera'}
        </span>
        <strong style={{ fontVariantNumeric: 'tabular-nums', color: m.aporte < 0 ? 'var(--down)' : undefined }}>
          {formatMoney(m.aporte, { currency: moneda, sign: m.aporte < 0 })}
        </strong>
      </p>
      <p style={{ margin: '2px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ color: 'var(--muted)' }}>Ratio de inversión</span>
        <strong style={{ fontVariantNumeric: 'tabular-nums', color: m.aporte < 0 ? 'var(--down)' : undefined }}>
          {formatPercent(m.ratioInversionPct, { sign: false, decimals: 0 })}
        </strong>
      </p>
      {m.aporte < 0 && (
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11 }}>
          Retiro neto: no se dibuja en las barras ni en la línea.
        </p>
      )}
      {m.aporte >= 0 && m.ratioInversionPct != null && m.ratioLinea == null && (
        <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 11 }}>
          Aporte mayor al ingreso: no se dibuja en la línea.
        </p>
      )}
      {m.cortada && (
        <p style={{ margin: '2px 0 0', color: 'var(--muted)', fontSize: 11 }}>Barra cortada: el aporte supera la escala.</p>
      )}
    </div>
  );
}

export default function IngresosSection({ resp, loading, error, serie, hideValues, moneda = 'ARS' }: Props) {
  const [verTodos, setVerTodos] = useState(false);
  const isMobile = useIsMobile();

  const empleadorColor = useMemo(() => {
    const map = new Map<string, string>();
    (resp?.empleadores ?? []).forEach((emp, i) => map.set(emp, EMPLEADOR_COLORS[i % EMPLEADOR_COLORS.length]));
    return map;
  }, [resp]);

  // Monto de un ingreso en la moneda pedida. montoUsd ya viene calculado desde
  // el origen (carga del PDF) con el MEP del día exacto de esa acreditación —
  // no se recalcula acá con un MEP distinto, sería menos preciso que el dato real.
  function montoEn(r: IngresoRow, m: Moneda): number {
    return m === 'ARS' ? r.montoArs : r.montoUsd;
  }

  // Serie mensual: una barra apilada por empleador, reactiva al toggle USD/ARS del header.
  const chartData = useMemo(() => {
    if (!resp) return [];
    return resp.porMes.map((m) => {
      const row: Record<string, number | string> = { mes: m.fecha };
      for (const emp of resp.empleadores) {
        row[emp] = m.rows.filter((r) => r.empleador === emp).reduce((s, r) => s + montoEn(r, moneda), 0);
      }
      return row;
    });
  }, [resp, moneda]);

  // Cada cuántas barras mostrar una etiqueta en el eje X: con muchos meses,
  // mostrar todas las etiquetas las superpone. En vez de pasarle a Recharts una
  // lista de `ticks` explícita (que en un eje de categorías puede desalinear el
  // texto respecto a la barra que corresponde), se deja que Recharts posicione
  // cada tick según su índice real y solo se vacía el texto de los que no tocan
  // — así la posición geométrica del tick siempre coincide con su barra.
  const xTickStep = chartData.length > 8 ? Math.ceil(chartData.length / 8) : 1;

  // Gráfico de inversión: cada barra mide el ingreso del mes (lo invertido abajo,
  // el resto arriba) en el eje izquierdo; el ratio aportes/ingreso es una línea
  // en el eje derecho, fijo en 0–100%. Los dos ejes arrancan en 0, así que el
  // cero es común. Lo que cae fuera de ese rango no se dibuja:
  // - Retiro neto (aporte < 0): la parte verde queda en 0 y la barra muestra el
  //   ingreso completo; el aporte negativo solo figura en el tooltip.
  // - Ratio fuera de 0–100% (aporte mayor al ingreso, ver `ratioParaLinea`): sin
  //   punto en la línea. La escala de monto se acota a 1,3× el mayor ingreso para
  //   que un aporte extraordinario no aplaste a los demás; la barra queda cortada
  //   y el tooltip lo avisa.
  const { barras, techo } = useMemo(() => {
    const maxIngreso = Math.max(0, ...serie.map((m) => m.ingreso));
    const techo = maxIngreso > 0 ? maxIngreso * 1.3 : undefined;
    const barras: BarraInversion[] = serie.map((m) => {
      const invertido = Math.max(0, m.aporte);
      return {
        ...m,
        ahorro: invertido,
        resto: Math.max(0, m.ingreso - invertido),
        cortada: techo != null && m.aporte > techo,
        ratioLinea: ratioParaLinea(m),
      };
    });
    return { barras, techo };
  }, [serie]);

  // Las acreditaciones se muestran de a tandas en flujo normal: un contenedor
  // con alto fijo + overflow robaba el gesto de scroll a la pestaña (dos
  // scrollbars pegadas y la página no scrolleaba con el cursor encima).
  const ingresosRecientes = useMemo(
    () => [...(resp?.ingresos ?? [])].reverse(),
    [resp],
  );
  const visibles = verTodos ? ingresosRecientes : ingresosRecientes.slice(0, PAGE_INGRESOS);

  const kpis = useMemo(() => {
    if (!resp || resp.ingresos.length === 0) return null;
    const totalArs = resp.ingresos.reduce((s, r) => s + r.montoArs, 0);
    const totalUsd = resp.ingresos.reduce((s, r) => s + r.montoUsd, 0);
    const ultimoMes = resp.porMes[resp.porMes.length - 1];
    const ultimoMesPrincipal = ultimoMes
      ? ultimoMes.rows.reduce((s, r) => s + montoEn(r, moneda), 0)
      : null;
    return { totalArs, totalUsd, ultimoMes, ultimoMesPrincipal };
  }, [resp, moneda]);

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Cargando ingresos...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 8, padding: '14px 18px', margin: 12,
      }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: '#ef4444', margin: '0 0 4px' }}>Error</p>
        <p style={{ fontSize: 13, color: 'var(--text)', margin: 0 }}>{error}</p>
      </div>
    );
  }

  if (!resp || resp.ingresos.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
        Todavía no hay ingresos cargados. Usá &quot;Cargar&quot; → &quot;Sueldos / Haberes&quot; para subir un resumen de cuenta.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-grid">
        <KPICard
          label={`Total acumulado (${moneda})`}
          value={moneda === 'ARS'
            ? formatMoney(kpis!.totalArs, { currency: 'ARS', hidden: hideValues })
            : formatMoney(kpis!.totalUsd, { currency: 'USD', hidden: hideValues })}
          sub={`${resp.empleadores.length} empleador${resp.empleadores.length !== 1 ? 'es' : ''}`}
          accentColor="var(--primary)"
        />
        <KPICard
          label={`Total acumulado (${moneda === 'ARS' ? 'USD' : 'ARS'})`}
          value={hideValues
            ? formatMoney(null, { currency: moneda === 'ARS' ? 'USD' : 'ARS', hidden: true })
            : moneda === 'ARS'
              ? (kpis!.totalUsd > 0 ? formatMoney(kpis!.totalUsd, { currency: 'USD' }) : 's/d')
              : formatMoney(kpis!.totalArs, { currency: 'ARS' })}
          sub={`equivalente en ${moneda === 'ARS' ? 'USD' : 'ARS'}`}
          accentColor="var(--primary)"
        />
        <KPICard
          label="Último mes"
          value={kpis!.ultimoMesPrincipal != null
            ? formatMoney(kpis!.ultimoMesPrincipal, { currency: moneda === 'ARS' ? 'ARS' : 'USD', hidden: hideValues })
            : 's/d'}
          sub={kpis!.ultimoMes?.fecha ?? ''}
          accentColor="var(--up)"
        />
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px', flex: 1, minHeight: 340,
        display: 'flex', flexDirection: 'column',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 12px', flexShrink: 0 }}>
          Ingresos por mes y empleador ({moneda})
        </p>
        <ResponsiveContainer width="100%" height={280} minHeight={280}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              interval={0}
              tickFormatter={(value, index) => {
                const esUltimo = index === chartData.length - 1;
                return (index % xTickStep === 0 || esUltimo) ? value : '';
              }}
            />
            <YAxis
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatMoney(v, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'compact', compactShort: isMobile, hidden: hideValues })}
              width={isMobile ? 40 : (hideValues ? 40 : 56)}
            />
            <Tooltip content={hideValues ? () => null : <CustomTooltip moneda={moneda} />} />
            {resp.empleadores.length > 1 && <Legend wrapperStyle={{ fontSize: 12, textTransform: 'uppercase' }} />}
            {resp.empleadores.map((emp) => (
              <Bar key={emp} dataKey={emp} stackId="ingresos" fill={empleadorColor.get(emp)} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 12px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: 0 }}>
            Ratio de inversión sobre ingresos, por mes ({moneda})
          </p>
          <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--up)', marginRight: 5 }} />Invertido (aporte)</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--muted)', opacity: 0.35, marginRight: 5 }} />Resto del ingreso</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 2, background: 'var(--primary)', marginRight: 5, verticalAlign: 'middle' }} />Ratio de inversión (%)</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220} minHeight={220}>
          <ComposedChart data={barras} barCategoryGap="25%">
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="fecha"
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={{ stroke: 'var(--border)' }}
              tickLine={false}
              interval={0}
              tickFormatter={(value, index) => {
                const esUltimo = index === barras.length - 1;
                return (index % xTickStep === 0 || esUltimo) ? value : '';
              }}
            />
            <YAxis
              yAxisId="monto"
              domain={[0, techo ?? 'auto']}
              allowDataOverflow
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => formatMoney(v, { currency: moneda, mode: 'compact', compactShort: isMobile, hidden: hideValues })}
              width={isMobile ? 40 : (hideValues ? 40 : 56)}
            />
            <YAxis
              yAxisId="ratio"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${v}%`}
              width={isMobile ? 34 : 40}
            />
            <Tooltip cursor={{ fill: 'var(--border-subtle)', opacity: 0.4 }} content={hideValues ? () => null : <InversionTooltip moneda={moneda} />} />
            {/* El mes en curso va más claro: su ingreso suele estar incompleto. */}
            <Bar yAxisId="monto" dataKey="ahorro" stackId="mes" fill="var(--up)">
              {barras.map((m) => <Cell key={m.mesKey} fillOpacity={m.cerrado ? 1 : 0.45} />)}
            </Bar>
            <Bar yAxisId="monto" dataKey="resto" stackId="mes" fill="var(--muted)" radius={[3, 3, 0, 0]}>
              {barras.map((m) => <Cell key={m.mesKey} fillOpacity={m.cerrado ? 0.35 : 0.15} />)}
            </Bar>
            {/* Sin connectNulls: un mes atípico deja un corte visible en vez de
                una línea que lo salta como si no hubiera pasado nada. */}
            <Line
              yAxisId="ratio"
              type="monotone"
              dataKey="ratioLinea"
              stroke="var(--primary)"
              strokeWidth={2}
              dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)', lineHeight: 1.45 }}>
          Cada barra es el ingreso del mes; lo verde es lo que entró a la cartera (menos
          retiros) y la línea es ese aporte sobre el ingreso. Ambos ejes arrancan en 0: un
          retiro neto no se dibuja y un aporte mayor al ingreso (venta de un bien, por
          ejemplo) no tiene punto en la línea; en el tooltip figura el valor real.
        </p>
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '16px 20px',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 12px' }}>
          Detalle de acreditaciones
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibles.map((r, i) => (
            <div
              key={i}
              className="ingreso-fila"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)',
                fontSize: 13,
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: empleadorColor.get(r.empleador) ?? 'var(--primary)',
              }} />
              <span className="ingreso-fecha" style={{ color: 'var(--muted)', width: 90, flexShrink: 0 }}>{r.fechaStr}</span>
              {/* `minWidth:0` deja que el nombre se recorte con ellipsis en vez
                  de empujar el monto fuera de la tarjeta (ver globals.css). */}
              <span className="ingreso-empleador" style={{ color: 'var(--text)', fontWeight: 600, flex: 1, minWidth: 0, textTransform: 'uppercase' }}>{r.empleador}</span>
              <span style={{ color: 'var(--up)', fontWeight: 600, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {r.montoArs > 0
                  ? formatMoney(r.montoArs, { currency: 'ARS', hidden: hideValues })
                  : formatMoney(r.montoUsd, { currency: 'USD', hidden: hideValues })}
              </span>
            </div>
          ))}
        </div>

        {ingresosRecientes.length > PAGE_INGRESOS && (
          <button
            onClick={() => setVerTodos((v) => !v)}
            style={{
              marginTop: 10, width: '100%', padding: '9px 12px',
              background: 'transparent', border: '1px solid var(--border)',
              borderRadius: 8, cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: 'var(--primary)',
            }}
          >
            {verTodos
              ? 'Ver menos'
              : `Ver todos (${ingresosRecientes.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
