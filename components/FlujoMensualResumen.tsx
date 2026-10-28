'use client';

// Franja común a las tres sub-pestañas de finanzas personales: de cada ingreso
// mensual, cuánto se va en gastos cargados, cuánto queda sin asignar y cuánto se
// ahorra (aporte a la cartera). Qué es cada número y por qué se calcula así:
// lib/finanzasPersonales.ts

import type { ResumenFlujo } from '@/lib/finanzasPersonales';
import { formatMoney, formatPercent, type Moneda } from '@/lib/format';
import KPICard from './KPICard';

interface Props {
  resumen: ResumenFlujo;
  moneda: Moneda;
  hideValues: boolean;
}

const COLOR_GASTOS = '#d9824e';
const COLOR_SIN_ASIGNAR = '#8d7fc7';
const COLOR_AHORRO = 'var(--up)';

export default function FlujoMensualResumen({ resumen, moneda, hideValues }: Props) {
  const money = (v: number | null) => formatMoney(v, { currency: moneda, hidden: hideValues });
  const pct = (v: number | null) => formatPercent(v, { sign: false, decimals: 0, hidden: hideValues });

  if (resumen.mesesBase === 0 || resumen.ingresoProm == null) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '12px 18px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5,
      }}>
        Sin ingresos cargados todavía: el ratio de inversión y la distribución del ingreso
        necesitan al menos un mes de sueldo. Usá &quot;Cargar&quot; → &quot;Sueldos / Haberes&quot;.
      </div>
    );
  }

  const { ingresoProm, aporteProm, sinAsignar, gastos } = resumen;
  const sub = `prom. ${resumen.mesesBase} ${resumen.mesesBase === 1 ? 'mes' : 'meses'}`;

  // La barra solo tiene sentido si las tres partes son no negativas y suman el
  // ingreso: con un aporte mayor al ingreso (fondos de otra fuente) o un retiro
  // neto, el residuo "sin asignar" da negativo y la composición deja de ser un
  // reparto del 100%.
  const aporte = aporteProm ?? 0;
  const repartoValido = sinAsignar != null && sinAsignar >= 0 && aporte >= 0 && ingresoProm > 0;
  const partes = repartoValido
    ? [
        { id: 'gastos', label: 'Gastos',       valor: gastos,       color: COLOR_GASTOS },
        { id: 'sin',    label: 'Sin asignar',  valor: sinAsignar!,  color: COLOR_SIN_ASIGNAR },
        { id: 'ahorro', label: 'Invertido',    valor: aporte,       color: COLOR_AHORRO },
      ]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="kpi-grid-resumen">
        <KPICard
          label="Ingreso mensual"
          value={money(ingresoProm)}
          sub={sub}
          accentColor="var(--primary)"
          tooltip="Promedio de los últimos meses cerrados con ingresos cargados. El mes en curso no entra: suele tener el sueldo sin acreditar."
        />
        <KPICard
          label="Gastos"
          value={money(gastos)}
          sub={resumen.gastosIncompleto
            ? 'sin MEP para convertir algún gasto'
            : `${pct(resumen.gastosPct)} del ingreso`}
          accentColor={COLOR_GASTOS}
          tooltip="Total mensual de los gastos cargados en la pestaña Gastos (los anuales /12). Los de otra moneda se convierten con el MEP actual."
        />
        <KPICard
          label="Aporte mensual"
          value={money(aporteProm)}
          sub={`a la cartera · ${sub}`}
          accentColor="var(--up)"
          tooltip="Aportes netos (menos retiros) que entraron a la cartera. Los traspasos entre cuentas propias no cuentan."
        />
        <KPICard
          label="Ratio de inversión"
          value={formatPercent(resumen.ratioInversionPct, { sign: false, hidden: hideValues })}
          sub={sinAsignar != null && sinAsignar >= 0
            ? `sin asignar ≈ ${money(sinAsignar)}`
            : 'aportes mayores al ingreso'}
          accentColor="var(--up)"
          tooltip="Aportes a la cartera sobre ingresos: cuánto del ingreso terminó invertido. Cuenta cualquier aporte, venga del sueldo o de otra fuente (venta de un bien), así que un mes puede pasar el 100%. No es ingreso menos gastos: lo que no cargaste como gasto quedaría contado como inversión. 'Sin asignar' es el residuo: gasto sin cargar más ahorro fuera de la cartera."
        />
      </div>

      {partes.length > 0 && !hideValues && (
        <div style={{
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: '12px 18px',
        }}>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 8px' }}>
            A dónde va cada ingreso
          </p>
          <div
            role="img"
            aria-label={partes.map((p) => `${p.label} ${Math.round((p.valor / ingresoProm) * 100)}%`).join(', ')}
            style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--border)' }}
          >
            {partes.map((p) => (
              <div key={p.id} style={{ width: `${(p.valor / ingresoProm) * 100}%`, background: p.color }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
            {partes.map((p) => (
              <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.color, flexShrink: 0 }} />
                {p.label}{' '}
                <strong style={{ color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatPercent((p.valor / ingresoProm) * 100, { sign: false, decimals: 0 })}
                </strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
