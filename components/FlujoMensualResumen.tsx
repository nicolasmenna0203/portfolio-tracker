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
  /** Si los ingresos no se pudieron leer: no es lo mismo que no haberlos cargado. */
  errorIngresos: string | null;
}

const COLOR_GASTOS = '#d9824e';
const COLOR_SIN_ASIGNAR = '#8d7fc7';
const COLOR_AHORRO = 'var(--up)';

export default function FlujoMensualResumen({ resumen, moneda, hideValues, errorIngresos }: Props) {
  const money = (v: number | null) => formatMoney(v, { currency: moneda, hidden: hideValues });
  const pct = (v: number | null) => formatPercent(v, { sign: false, decimals: 0, hidden: hideValues });

  if (resumen.mesesBase === 0 || resumen.ingresoProm == null) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        padding: '12px 18px', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5,
      }}>
        {errorIngresos
          ? 'No se pudieron leer los ingresos: el ratio de inversión y la distribución del ingreso no están disponibles.'
          : <>Sin ingresos cargados todavía: el ratio de inversión y la distribución del ingreso
            necesitan al menos un mes de sueldo. Usá &quot;Cargar&quot; → &quot;Sueldos / Haberes&quot;.</>}
      </div>
    );
  }

  const { ingresoProm, aporteProm, sinAsignar, gastos } = resumen;

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
      <p className="g-eyebrow" style={{ margin: '0 0 -4px' }}>
        Promedio {resumen.mesesBase === 1 ? 'del último mes' : `de los últimos ${resumen.mesesBase} meses`}
      </p>
      <div className="kpi-grid-resumen flujo-kpis">
        <KPICard
          label="Ingreso mensual"
          value={money(ingresoProm)}
          sub="lo que entra por mes"
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
          tooltip="Gasto mensual promedio de los mismos meses cerrados que el ingreso. En cada mes suman solo los gastos vigentes en ese mes (uno cargado hace poco no cuenta antes de su mes de inicio, y uno dado de baja deja de contar), los anuales /12. Los de otra moneda se convierten con el MEP actual. Puede diferir del total mensual de la pestaña Gastos, que es el de este mes."
        />
        <KPICard
          label="Aporte mensual"
          value={money(aporteProm)}
          sub="a la cartera"
          accentColor="var(--up)"
          tooltip="Aportes netos (menos retiros) que entraron a la cartera. Los traspasos entre cuentas propias no cuentan."
        />
        <KPICard
          label="Ratio de inversión"
          value={formatPercent(resumen.ratioInversionPct, { sign: false, hidden: hideValues })}
          sub={sinAsignar != null && sinAsignar >= 0
            ? `sin asignar ≈ ${money(sinAsignar)}`
            : aporte > ingresoProm
              ? 'aportes mayores al ingreso'
              : 'aportes + gastos > ingreso'}
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
