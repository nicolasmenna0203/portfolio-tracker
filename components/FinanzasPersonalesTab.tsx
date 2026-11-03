'use client';

// Router de sub-pestañas de finanzas personales (no de cartera de inversión):
// Ingresos, Gastos y Proyecciones. Mismo patrón que
// PerformanceTab para las sub-secciones de instrumentos.
//
// Este componente es el dueño de los datos: carga ingresos y gastos una vez y
// calcula el flujo mensual (lib/finanzasPersonales.ts) que comparten las tres
// sub-pestañas. La franja de arriba (ingreso → gastos → inversión) se ve en
// todas; Proyecciones recibe el flujo en USD para sugerir el aporte real.

import { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { DashboardData } from '@/types';
import type { Moneda } from '@/lib/format';
import { useFinanzasPersonales } from '@/lib/useFinanzasPersonales';
import { serieFlujoMensual, resumenFlujo } from '@/lib/finanzasPersonales';
import IngresosSection from './IngresosSection';
import GastosSection from './GastosSection';
import ProyeccionesTab from './ProyeccionesTab';
import FlujoMensualResumen from './FlujoMensualResumen';
import SubTabs from './SubTabs';

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
  mepActual: number | null;
}

type SubTab = 'ingresos' | 'gastos' | 'proyecciones';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'ingresos',     label: 'Ingresos'     },
  { id: 'gastos',       label: 'Gastos'       },
  { id: 'proyecciones', label: 'Proyecciones' },
];

export default function FinanzasPersonalesTab({ data, hideValues, moneda, mepActual }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('ingresos');
  const pathname = usePathname();
  const apiBase = pathname?.startsWith('/demo') ? '/api/demo' : '/api';
  const { ingresos, gastos, actualizarGastos, recargar, loading, errorIngresos, errorGastos } = useFinanzasPersonales(apiBase);

  const porMes = ingresos?.porMes;

  // Flujo en la moneda del toggle (lo que se muestra) y siempre en USD
  // (Proyecciones trabaja en dólares, igual que la cartera).
  const serie = useMemo(
    () => serieFlujoMensual(porMes ?? [], data.movimientos, moneda),
    [porMes, data.movimientos, moneda],
  );
  const resumen = useMemo(
    () => resumenFlujo(serie, gastos, moneda, mepActual),
    [serie, gastos, moneda, mepActual],
  );
  const serieUsd = useMemo(
    () => (moneda === 'USD' ? serie : serieFlujoMensual(porMes ?? [], data.movimientos, 'USD')),
    [serie, moneda, porMes, data.movimientos],
  );
  const resumenUsd = useMemo(
    () => (moneda === 'USD' ? resumen : resumenFlujo(serieUsd, gastos, 'USD', mepActual)),
    [resumen, moneda, serieUsd, gastos, mepActual],
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <SubTabs tabs={SUB_TABS} activa={subTab} onChange={setSubTab} />

      {!loading && (
        <FlujoMensualResumen resumen={resumen} moneda={moneda} hideValues={hideValues} errorIngresos={errorIngresos} />
      )}

      {subTab === 'ingresos' && (
        <IngresosSection
          resp={ingresos}
          loading={loading}
          error={errorIngresos}
          serie={serie}
          hideValues={hideValues}
          moneda={moneda}
        />
      )}
      {subTab === 'gastos' && (
        <GastosSection
          gastos={gastos}
          loading={loading}
          loadError={errorGastos}
          onChange={actualizarGastos}
          onReintentar={recargar}
          resumen={resumen}
          hideValues={hideValues}
          moneda={moneda}
          mepActual={mepActual}
        />
      )}
      {subTab === 'proyecciones' && (
        <ProyeccionesTab data={data} hideValues={hideValues} flujo={loading ? null : resumenUsd} />
      )}
    </div>
  );
}
