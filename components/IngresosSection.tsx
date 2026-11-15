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
import InfoTip from './InfoTip';
import { Cargando, AvisoError, Vacio } from './Estados';

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
const EMPLEADOR_COLORS = ['#0a84ff', '#d96f00', '#1e9ab0', '#b455e8', '#b98a00', '#f2385a'];

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
    <div className="tooltip-panel">
      <p className="tooltip-titulo">{label}</p>
      {payload.map((p) => (
        p.value > 0 && (
          <p key={p.dataKey} className="tooltip-fila">
            <span><span className="tooltip-marca" style={{ background: p.color }} />{p.name}</span>
            <span>{formatMoney(p.value, { currency })}</span>
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
    <div className="tooltip-panel">
      <p className="tooltip-titulo">
        {m.fecha}{m.cerrado ? '' : ' (en curso)'}
      </p>
      <p className="tooltip-fila">
        <span>Ingreso</span>
        <span>{formatMoney(m.ingreso, { currency: moneda })}</span>
      </p>
      {/* Retiro neto en rojo y con signo: formatMoney descarta el signo salvo
          que se lo pidan, y un retiro sin "-" se leería como aporte. */}
      <p className="tooltip-fila">
        <span>
          <span className="tooltip-marca" style={{ background: m.aporte < 0 ? 'var(--down)' : 'var(--up)' }} />
          {m.aporte < 0 ? 'Retiro neto' : 'Aporte a la cartera'}
        </span>
        <span style={m.aporte < 0 ? { color: 'var(--down)' } : undefined}>
          {formatMoney(m.aporte, { currency: moneda, sign: m.aporte < 0 })}
        </span>
      </p>
      <p className="tooltip-fila">
        <span>Ratio de inversión</span>
        <span style={m.aporte < 0 ? { color: 'var(--down)' } : undefined}>
          {formatPercent(m.ratioInversionPct, { sign: false, decimals: 0 })}
        </span>
      </p>
      {m.aporte < 0 && (
        <p className="tooltip-nota">Retiro neto: no se dibuja en las barras ni en la línea.</p>
      )}
      {m.aporte >= 0 && m.ratioInversionPct != null && m.ratioLinea == null && (
        <p className="tooltip-nota">Aporte mayor al ingreso: no se dibuja en la línea.</p>
      )}
      {m.cortada && (
        <p className="tooltip-nota">Barra cortada: el aporte supera la escala.</p>
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
  // — así la posición geométrica del tick siempre coincide con su barra. El último
  // mes siempre se rotula, y el anterior a él se saltea si quedarían pegados.
  const maxEtiquetas = isMobile ? 5 : 8;
  const xTickStep = chartData.length > maxEtiquetas ? Math.ceil(chartData.length / maxEtiquetas) : 1;
  // Con los montos ocultos el eje muestra solo los puntos, sin la moneda: con el
  // prefijo ("USD ••••") la etiqueta no entraba en el ancho y se leía "D ••••".
  const ejeMonto = (v: number) =>
    hideValues ? '••••' : formatMoney(v, { currency: moneda === 'ARS' ? 'ARS' : 'USD', mode: 'compact', compactShort: isMobile });
  const etiquetaMes = (value: string, index: number) => {
    const ultimo = chartData.length - 1;
    return index === ultimo || (index % xTickStep === 0 && ultimo - index >= xTickStep) ? value : '';
  };

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
      <Cargando etiqueta="Cargando ingresos" kpis={3} alto={280} />
    );
  }

  if (error) {
    return (
      <AvisoError titulo="No se pudieron leer los ingresos">{error}</AvisoError>
    );
  }

  if (!resp || resp.ingresos.length === 0) {
    return (
      <Vacio titulo="Todavía no hay ingresos cargados">
        Subí un resumen de cuenta desde Cargar datos, en la sección Sueldos / Haberes.
      </Vacio>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-grid">
        <KPICard
          label={`Total acumulado en ${moneda}`}
          value={moneda === 'ARS'
            ? formatMoney(kpis!.totalArs, { currency: 'ARS', hidden: hideValues })
            : formatMoney(kpis!.totalUsd, { currency: 'USD', hidden: hideValues })}
          sub={`${resp.empleadores.length} empleador${resp.empleadores.length !== 1 ? 'es' : ''}`}
        />
        <KPICard
          label={`Total acumulado en ${moneda === 'ARS' ? 'USD' : 'ARS'}`}
          value={hideValues
            ? formatMoney(null, { currency: moneda === 'ARS' ? 'USD' : 'ARS', hidden: true })
            : moneda === 'ARS'
              ? (kpis!.totalUsd > 0 ? formatMoney(kpis!.totalUsd, { currency: 'USD' }) : 's/d')
              : formatMoney(kpis!.totalArs, { currency: 'ARS' })}
          sub={`equivalente en ${moneda === 'ARS' ? 'USD' : 'ARS'}`}
        />
        <KPICard
          label="Último mes"
          value={kpis!.ultimoMesPrincipal != null
            ? formatMoney(kpis!.ultimoMesPrincipal, { currency: moneda === 'ARS' ? 'ARS' : 'USD', hidden: hideValues })
            : 's/d'}
          sub={kpis!.ultimoMes?.fecha ?? ''}
        />
      </div>

      <div className="card" style={{ flex: 1, minHeight: 340, display: 'flex', flexDirection: 'column' }}>
        <p className="card-titulo" style={{ marginBottom: 12 }}>
          Ingresos por mes
          <span className="dato">{moneda}</span>
        </p>
        <ResponsiveContainer width="100%" height={280} minHeight={280}>
          <BarChart data={chartData} barCategoryGap="20%">
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="mes"
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              interval={0}
              tickFormatter={etiquetaMes}
            />
            <YAxis
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={ejeMonto}
              width={isMobile || hideValues ? 40 : 60}
            />
            <Tooltip content={hideValues ? () => null : <CustomTooltip moneda={moneda} />} />
            {resp.empleadores.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--text-sec)', paddingTop: 6 }} />}
            {resp.empleadores.map((emp) => (
              <Bar key={emp} dataKey={emp} stackId="ingresos" fill={empleadorColor.get(emp)} maxBarSize={56} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, margin: '0 0 12px' }}>
          <span className="g-etiqueta">
            <p className="card-titulo">
              Cuánto del ingreso se invierte
              <span className="dato">{moneda}</span>
            </p>
            <InfoTip label="este gráfico">
              Cada barra es el ingreso del mes; lo verde es lo que entró a la cartera (menos retiros) y
              la línea es ese aporte sobre el ingreso. Un retiro neto no se dibuja y un aporte mayor al
              ingreso (venta de un bien, por ejemplo) no tiene punto en la línea: el valor real está
              al tocar la barra.
            </InfoTip>
          </span>
          <div className="leyenda">
            <span><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--up)' }} />Invertido</span>
            <span><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--muted)', opacity: 0.35 }} />Resto del ingreso</span>
            <span><span style={{ width: 14, height: 2, borderRadius: 1, background: 'var(--primary)' }} />Ratio (eje der.)</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220} minHeight={220}>
          <ComposedChart data={barras} barCategoryGap="25%">
            <CartesianGrid stroke="var(--border-subtle)" vertical={false} />
            <XAxis
              dataKey="fecha"
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              interval={0}
              tickFormatter={etiquetaMes}
            />
            <YAxis
              yAxisId="monto"
              domain={[0, techo ?? 'auto']}
              allowDataOverflow
              tick={{ fontSize: isMobile ? 9 : 11, fill: 'var(--muted)' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={ejeMonto}
              width={isMobile || hideValues ? 40 : 60}
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
      </div>

      <div className="card">
        <p className="card-titulo" style={{ marginBottom: 6 }}>Acreditaciones</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {visibles.map((r, i) => (
            <div
              key={i}
              className="ingreso-fila"
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0', borderBottom: i === visibles.length - 1 ? 0 : '0.5px solid var(--border)',
                fontSize: 14,
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: empleadorColor.get(r.empleador) ?? 'var(--primary)',
              }} />
              <span className="ingreso-fecha" style={{ color: 'var(--text-sec)', width: 92, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{r.fechaStr}</span>
              {/* `minWidth:0` deja que el nombre se recorte con ellipsis en vez
                  de empujar el monto fuera de la tarjeta (ver globals.css). */}
              <span className="ingreso-empleador" style={{ color: 'var(--text)', fontWeight: 500, flex: 1, minWidth: 0 }}>{r.empleador}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {r.montoArs > 0
                  ? formatMoney(r.montoArs, { currency: 'ARS', hidden: hideValues })
                  : formatMoney(r.montoUsd, { currency: 'USD', hidden: hideValues })}
              </span>
            </div>
          ))}
        </div>

        {ingresosRecientes.length > PAGE_INGRESOS && (
          <button
            type="button"
            className="g-btn tintado"
            onClick={() => setVerTodos((v) => !v)}
            aria-expanded={verTodos}
            style={{ marginTop: 12, width: '100%' }}
          >
            {verTodos
              ? 'Ver menos'
              : `Ver las ${ingresosRecientes.length} acreditaciones`}
          </button>
        )}
      </div>
    </div>
  );
}
