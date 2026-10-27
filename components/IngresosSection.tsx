'use client';

import { useState, useEffect, useMemo } from 'react';
import { usePathname } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend,
  CartesianGrid, ResponsiveContainer,
} from 'recharts';
import type { IngresosResponse, IngresoRow } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, type Moneda } from '@/lib/format';
import KPICard from './KPICard';

interface Props {
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

export default function IngresosSection({ hideValues, moneda = 'ARS' }: Props) {
  const [resp, setResp] = useState<IngresosResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verTodos, setVerTodos] = useState(false);
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${apiBase}/ingresos`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error);
        setResp(json as IngresosResponse);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [apiBase]);

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
