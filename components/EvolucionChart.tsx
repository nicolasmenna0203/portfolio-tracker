'use client';

// Evolución de la cartera con un toggle entre dos vistas, una a la vez:
// - Capital: áreas de total de la cartera y aportes acumulados, más la cantidad
//   de activos como línea punteada sobre un eje derecho propio.
// - Rendimientos: ganancia pura de cada mes en barras, más la ganancia acumulada
//   del período como línea sobre un eje derecho propio.
//
// Son vistas separadas porque juntas no funcionaban: las barras en la escala de
// la valuación medían pocos píxeles, y en dos paneles apilados ninguno tenía
// alto suficiente. Por lo mismo la ganancia acumulada no comparte eje con las
// barras: al crecer las aplastaba otra vez.
//
// `data` llega recortada al período elegido, con el mes base como primer punto
// (lib/periodo.ts). Capital lo dibuja porque es de donde arranca la curva;
// Rendimientos no, porque ese mes queda fuera del tramo y no tiene barra.

import { useState } from 'react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { ResumenRow, TenenciaActual } from '@/types';
import { useIsMobile } from '@/lib/useIsMobile';
import { formatMoney, type Moneda } from '@/lib/format';
import Segmented from './Segmented';

interface Props {
  data: ResumenRow[];
  tenenciasPorMes: Record<string, TenenciaActual[]>;
  hideValues?: boolean;
  moneda?: Moneda;
}

type Vista = 'capital' | 'rendimientos';

const VISTAS: { id: Vista; label: string }[] = [
  { id: 'capital', label: 'Capital' },
  { id: 'rendimientos', label: 'Rendimientos' },
];

// Cartera en el azul de la paleta categórica y aportes en el naranja: el par
// de mayor separación, también con daltonismo (ver lib/constants.ts).
const COLOR_CARTERA = '#0a84ff';
const COLOR_APORTES = '#d96f00';
const COLOR_ACTIVOS = 'var(--text-sec)';
const COLOR_ACUMULADA = 'var(--text-sec)';

function buildData(
  data: ResumenRow[],
  tenenciasPorMes: Record<string, TenenciaActual[]>,
  moneda: Moneda,
) {
  return data.map((row, i) => {
    const d = new Date(row.fechaTs);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

    // total_cartera_ars, acumulado_ars y aportes_ars ya vienen calculados desde el
    // origen (Sheet) — cada movimiento convertido al MEP de su propio día, no un
    // MEP de cierre de mes aplicado al total. No se recalcula nada acá.
    const totalCartera = moneda === 'ARS' ? row.total_cartera_ars : row.total_cartera;
    const acumulado = moneda === 'ARS' ? row.acumulado_ars : row.acumulado;
    const aportes = moneda === 'ARS' ? row.aportes_ars : row.aportes;

    const prevRow = i > 0 ? data[i - 1] : null;
    const prevTotalCartera = prevRow != null ? (moneda === 'ARS' ? prevRow.total_cartera_ars : prevRow.total_cartera) : null;
    const ganancia = prevTotalCartera !== null
      ? (totalCartera - prevTotalCartera) - aportes
      : null;

    return {
      ...row,
      total_cartera: totalCartera,
      acumulado,
      aportes,
      activos: tenenciasPorMes[key]?.length ?? null,
      ganancia,
    };
  });
}

// Ticks del eje X con paso regular. El `interval` automático de Recharts
// descarta etiquetas según el ancho de cada texto y deja huecos irregulares
// (ago, oct, nov, … con sep salteado). Acá el paso es fijo (1, 2, 3, 4, 6 o 12
// meses) y se ancla en el último mes, para que la fecha más reciente siempre
// tenga etiqueta.
function ticksMeses(fechas: string[], maxEtiquetas: number): string[] {
  const n = fechas.length;
  if (n <= maxEtiquetas) return fechas;
  const crudo = Math.ceil((n - 1) / (maxEtiquetas - 1));
  const paso = [1, 2, 3, 4, 6, 12].find((p) => p >= crudo) ?? 12;
  return fechas.filter((_, i) => (n - 1 - i) % paso === 0);
}

// Paso "redondo" (1, 2, 2,5, 5 × 10^k) que no baja de `crudo`. Con el cálculo
// automático de Recharts salían saltos como 6,5 / 13 / 19,5 mil.
function pasoRedondo(crudo: number): number {
  const pot = 10 ** Math.floor(Math.log10(crudo));
  return [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= crudo) ?? 10 * pot;
}

// Máximo y ticks redondos para un eje de valuación, que arranca en 0.
function ejeValuacion(max: number, intervalos = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const paso = pasoRedondo(max / intervalos);
  const cant = Math.ceil(max / paso);
  return { max: cant * paso, ticks: Array.from({ length: cant + 1 }, (_, i) => i * paso) };
}

// Eje de la vista Rendimientos: múltiplos de un paso redondo, siempre con el 0,
// porque hay meses negativos y las barras crecen desde ahí.
function ejeRendimientos(valores: number[], intervalos = 4): { dominio: [number, number]; ticks: number[] } {
  const min = Math.min(0, ...valores);
  const max = Math.max(0, ...valores);
  if (min === max) return { dominio: [0, 1], ticks: [0, 1] };
  const paso = pasoRedondo((max - min) / intervalos);
  const desde = Math.floor(min / paso);
  const hasta = Math.ceil(max / paso);
  return {
    dominio: [desde * paso, hasta * paso],
    ticks: Array.from({ length: hasta - desde + 1 }, (_, i) => (desde + i) * paso),
  };
}

// Eje derecho de la vista Rendimientos: el de las barras multiplicado por un
// factor redondo (1, 2 o 5 × 10^k). Así el 0 de los dos ejes queda a la misma
// altura y sus ticks caen sobre las mismas líneas de grilla. Con escalas
// independientes un mes en 0 y una acumulada en 0 quedarían a alturas distintas.
function ejeAcumulada(
  barras: { dominio: [number, number]; ticks: number[] },
  valores: number[],
): { dominio: [number, number]; ticks: number[] } {
  const [abajo, arriba] = barras.dominio;
  const crudo = Math.max(
    arriba > 0 ? Math.max(0, ...valores) / arriba : 0,
    abajo < 0 ? Math.min(0, ...valores) / abajo : 0,
  );
  if (!(crudo > 0)) return barras;
  const pot = 10 ** Math.floor(Math.log10(crudo));
  const factor = [1, 2, 5, 10].map((m) => m * pot).find((f) => f >= crudo) ?? 10 * pot;
  return { dominio: [abajo * factor, arriba * factor], ticks: barras.ticks.map((t) => t * factor) };
}

// Guía de lectura de cada vista, en el popover del ⓘ del título.
const GUIA: Record<Vista, { marca: React.ReactNode; titulo: string; texto: string }[]> = {
  capital: [
    {
      marca: <span style={{ width: 14, height: 0, borderTop: `2px solid ${COLOR_CARTERA}` }} />,
      titulo: 'Área azul',
      texto: 'Total de la cartera al cierre de cada mes.',
    },
    {
      marca: <span style={{ width: 14, height: 0, borderTop: `2px solid ${COLOR_APORTES}` }} />,
      titulo: 'Área naranja',
      texto: 'Aportes acumulados. La distancia entre las dos áreas es la ganancia acumulada.',
    },
    {
      marca: <span style={{ width: 14, height: 0, borderTop: `2px dotted ${COLOR_ACTIVOS}` }} />,
      titulo: 'Línea punteada',
      texto: 'Cantidad de activos en cartera cada mes. Se lee en el eje derecho; el izquierdo es el valor.',
    },
  ],
  rendimientos: [
    {
      marca: <span style={{ width: 8, height: 12, background: 'var(--up)', opacity: 0.8, borderRadius: 2 }} />,
      titulo: 'Barras',
      texto: 'Ganancia pura del mes: lo que varió la cartera menos lo aportado ese mes. Verde si ganó, rojo si perdió.',
    },
    {
      marca: <span style={{ width: 14, height: 0, borderTop: `2px solid ${COLOR_ACUMULADA}` }} />,
      titulo: 'Línea',
      texto: 'Ganancia acumulada: la suma de las barras desde el inicio del período. Se lee en el eje derecho.',
    },
  ],
};

type PropsTooltip = TooltipProps<number, string> & { hideValues?: boolean; moneda?: Moneda };

function TooltipContent({ active, payload, label, hideValues, moneda }: PropsTooltip) {
  if (!active || !payload?.length) return null;

  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  const ORDER = ['total_cartera', 'acumulado', 'activos', 'ganancia', 'ganancia_acumulada'];
  const sorted = [...payload].sort(
    (a, b) => ORDER.indexOf(String(a.dataKey)) - ORDER.indexOf(String(b.dataKey))
  );

  const Fila = ({ nombre, marca, valor, color }: { nombre: string; marca?: string; valor: string; color?: string }) => (
    <p style={{ marginBottom: 3, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        {marca && <span style={{ width: 8, height: 8, borderRadius: 2, background: marca, flexShrink: 0 }} />}
        {nombre}
      </span>
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: color ?? 'var(--text)' }}>{valor}</span>
    </p>
  );

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      minWidth: 160,
    }}>
      <p style={{ fontWeight: 600, color: 'var(--text-sec)', marginBottom: 8, fontSize: 11 }}>{label}</p>
      {sorted.map((p) => {
        if (p.value === null || p.value === undefined) return null;
        const esGanancia = p.dataKey === 'ganancia' || p.dataKey === 'ganancia_acumulada';
        const polaridad = p.value >= 0 ? 'var(--up)' : 'var(--down)';
        return (
          <Fila
            key={p.dataKey}
            nombre={p.name ?? ''}
            marca={p.dataKey === 'ganancia' ? polaridad : p.color}
            color={esGanancia ? polaridad : undefined}
            valor={p.dataKey === 'activos'
              ? String(p.value)
              : formatMoney(p.value, { currency, sign: esGanancia, hidden: hideValues })}
          />
        );
      })}
    </div>
  );
}

export default function EvolucionChart({ data, tenenciasPorMes, hideValues, moneda = 'USD' }: Props) {
  const chartData = buildData(data, tenenciasPorMes, moneda);
  const isMobile = useIsMobile();
  const [vista, setVista] = useState<Vista>('capital');
  const [guiaAbierta, setGuiaAbierta] = useState(false);

  const currency: Moneda = moneda === 'ARS' ? 'ARS' : 'USD';
  let suma = 0;
  const datosBarras = chartData
    .filter((d) => d.ganancia != null)
    .map((d) => ({ ...d, ganancia_acumulada: (suma += d.ganancia ?? 0) }));
  const xTicks = ticksMeses(
    (vista === 'capital' ? chartData : datosBarras).map((d) => d.fecha),
    isMobile ? 5 : 12,
  );
  const eje = ejeValuacion(Math.max(...chartData.map((d) => Math.max(d.total_cartera, d.acumulado))));
  const ejeR = ejeRendimientos(datosBarras.map((d) => d.ganancia ?? 0));
  const ejeA = ejeAcumulada(ejeR, datosBarras.map((d) => d.ganancia_acumulada));

  // Los ejes van sin código de moneda ("26 K", no "USD 26 mil"): con el prefijo el
  // texto se partía en dos líneas y la etiqueta de arriba quedaba cortada. La
  // moneda está en el título.
  const tickStyle = { fill: 'var(--muted)', fontSize: isMobile ? 10 : 11 };
  const fmtEje = (v: number) =>
    hideValues ? '••••' : formatMoney(v, { currency, mode: 'compact', compactShort: true, sign: v < 0 });

  const margen = { top: 10, right: 8, left: 0, bottom: 0 };
  const ejeX = {
    dataKey: 'fecha',
    tick: tickStyle,
    tickLine: false,
    axisLine: false,
    ticks: xTicks,
    interval: 0,
    tickMargin: 6,
  } as const;
  const ejeY = {
    tickFormatter: fmtEje,
    tick: tickStyle,
    tickLine: false,
    axisLine: false,
    width: isMobile ? 40 : 52,
    interval: 0,
  } as const;
  const grilla = <CartesianGrid stroke="var(--border-subtle)" vertical={false} />;
  const tooltip = (
    <Tooltip
      content={<TooltipContent hideValues={hideValues} moneda={moneda} />}
      cursor={{ stroke: 'var(--border)', fill: 'var(--border-subtle)', fillOpacity: 0.5 }}
    />
  );

  const leyenda = vista === 'capital'
    ? [
        { label: 'Total cartera', marca: <span style={{ width: 16, height: 0, borderTop: `2px solid ${COLOR_CARTERA}` }} /> },
        { label: 'Aportes acumulados', marca: <span style={{ width: 16, height: 0, borderTop: `2px solid ${COLOR_APORTES}` }} /> },
        { label: 'Activos (eje der.)', marca: <span style={{ width: 16, height: 0, borderTop: `2px dotted ${COLOR_ACTIVOS}` }} /> },
      ]
    : [
        {
          label: 'Ganancia del mes',
          marca: (
            <span style={{ display: 'inline-flex', gap: 2 }}>
              <span style={{ width: 6, height: 10, borderRadius: 2, background: 'var(--up)' }} />
              <span style={{ width: 6, height: 10, borderRadius: 2, background: 'var(--down)' }} />
            </span>
          ),
        },
        { label: 'Ganancia acumulada (eje der.)', marca: <span style={{ width: 16, height: 0, borderTop: `2px solid ${COLOR_ACUMULADA}` }} /> },
      ];

  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '14px 16px 8px',
      display: 'flex',
      flexDirection: 'column',
      flex: '1 0 auto',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px', marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
          <p style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text-sec)', margin: 0 }}>
            Evolución de la Cartera
            <span style={{ fontWeight: 500, color: 'var(--muted)', marginLeft: 6 }}>· {currency}</span>
          </p>
          <button
            onClick={() => setGuiaAbierta((v) => !v)}
            onBlur={() => setGuiaAbierta(false)}
            aria-label="Cómo leer el gráfico"
            aria-expanded={guiaAbierta}
            className="kpi-info"
            style={{
              width: 14, height: 14, borderRadius: '50%', border: '1px solid var(--border)',
              background: 'transparent', color: 'var(--muted)', fontSize: 9, lineHeight: 1,
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: 0, flexShrink: 0,
            }}
          >
            ⓘ
          </button>
          {guiaAbierta && (
            <div style={{
              position: 'absolute', top: 22, left: 0, zIndex: 10,
              width: 300, maxWidth: 'calc(100vw - 48px)',
              background: 'var(--card)', border: '1px solid var(--border-subtle)', borderRadius: 8,
              padding: '10px 12px', fontSize: 11, lineHeight: 1.45, color: 'var(--text-sec)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)', fontWeight: 400,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              {GUIA[vista].map((g) => (
                <div key={g.titulo} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 16, flexShrink: 0, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {g.marca}
                  </span>
                  <span>
                    <strong style={{ color: 'var(--text)', fontWeight: 600 }}>{g.titulo}.</strong> {g.texto}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <Segmented opciones={VISTAS} activa={vista} onChange={setVista} chico etiqueta="Vista del gráfico" />

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: '4px 14px', marginLeft: isMobile ? 0 : 'auto',
          fontSize: isMobile ? 10 : 11, color: 'var(--text-sec)',
        }}>
          {leyenda.map((l) => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
              {l.marca}
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* El contenedor del chart va absoluto porque el alto de este div sale del
          flex y un `height: 100%` no siempre resuelve contra eso. */}
      <div style={{ flex: '1 0 auto', minHeight: isMobile ? 200 : 260, position: 'relative' }}>
        <div style={{ position: 'absolute', inset: 0 }}>
          <ResponsiveContainer width="100%" height="100%">
            {vista === 'capital' ? (
              <ComposedChart data={chartData} margin={margen}>
                <defs>
                  <linearGradient id="gradCartera" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLOR_CARTERA} stopOpacity={0.16} />
                    <stop offset="95%" stopColor={COLOR_CARTERA} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradAportes" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={COLOR_APORTES} stopOpacity={0.12} />
                    <stop offset="95%" stopColor={COLOR_APORTES} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {grilla}
                <XAxis {...ejeX} />
                <YAxis {...ejeY} yAxisId="valor" domain={[0, eje.max]} ticks={eje.ticks} />
                <YAxis
                  yAxisId="activos"
                  orientation="right"
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={false}
                  width={isMobile ? 22 : 30}
                  allowDecimals={false}
                  interval={0}
                />
                {tooltip}
                <Area
                  yAxisId="valor"
                  type="monotone"
                  dataKey="total_cartera"
                  name="Total cartera"
                  stroke={COLOR_CARTERA}
                  strokeWidth={2}
                  fill="url(#gradCartera)"
                  dot={false}
                  activeDot={{ r: 5, fill: COLOR_CARTERA, stroke: 'var(--card)', strokeWidth: 2 }}
                />
                <Area
                  yAxisId="valor"
                  type="monotone"
                  dataKey="acumulado"
                  name="Aportes acumulados"
                  stroke={COLOR_APORTES}
                  strokeWidth={2}
                  fill="url(#gradAportes)"
                  dot={false}
                  activeDot={{ r: 5, fill: COLOR_APORTES, stroke: 'var(--card)', strokeWidth: 2 }}
                />
                <Line
                  yAxisId="activos"
                  type="monotone"
                  dataKey="activos"
                  name="Activos"
                  stroke={COLOR_ACTIVOS}
                  strokeWidth={2}
                  strokeDasharray="2 4"
                  dot={false}
                  activeDot={{ r: 4, fill: COLOR_ACTIVOS, stroke: 'var(--card)', strokeWidth: 2 }}
                />
              </ComposedChart>
            ) : (
              <ComposedChart data={datosBarras} margin={margen}>
                {grilla}
                <XAxis {...ejeX} />
                <YAxis {...ejeY} yAxisId="barras" domain={ejeR.dominio} ticks={ejeR.ticks} />
                <YAxis
                  {...ejeY}
                  yAxisId="acumulada"
                  orientation="right"
                  domain={ejeA.dominio}
                  ticks={ejeA.ticks}
                  width={isMobile ? 36 : 44}
                />
                <ReferenceLine yAxisId="barras" y={0} stroke="var(--border)" />
                {tooltip}
                <Bar yAxisId="barras" dataKey="ganancia" name="Ganancia del mes" maxBarSize={isMobile ? 14 : 24} radius={[4, 4, 0, 0]}>
                  {datosBarras.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={(entry.ganancia ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'}
                      fillOpacity={0.8}
                    />
                  ))}
                </Bar>
                {/* Con un solo mes ("1 mes") una línea no dibuja nada: va el punto. */}
                <Line
                  yAxisId="acumulada"
                  type="monotone"
                  dataKey="ganancia_acumulada"
                  name="Ganancia acumulada"
                  stroke={COLOR_ACUMULADA}
                  strokeWidth={2}
                  dot={datosBarras.length === 1 ? { r: 4, fill: COLOR_ACUMULADA, stroke: 'var(--card)', strokeWidth: 2 } : false}
                  activeDot={{ r: 5, fill: COLOR_ACUMULADA, stroke: 'var(--card)', strokeWidth: 2 }}
                />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
