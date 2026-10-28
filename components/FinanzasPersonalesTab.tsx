'use client';

// Router de sub-pestañas de finanzas personales (no de cartera de inversión):
// Ingresos, Gastos Fijos y Proyecciones de ahorro. Mismo patrón que
// PerformanceTab para las sub-secciones de instrumentos.

import { useState } from 'react';
import type { DashboardData } from '@/types';
import type { Moneda } from '@/lib/format';
import IngresosSection from './IngresosSection';
import GastosFijosSection from './GastosFijosSection';
import ProyeccionesTab from './ProyeccionesTab';

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
  mepActual: number | null;
}

type SubTab = 'ingresos' | 'gastos-fijos' | 'proyecciones';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'ingresos',     label: 'Ingresos'     },
  { id: 'gastos-fijos', label: 'Gastos Fijos' },
  { id: 'proyecciones', label: 'Proyecciones' },
];

export default function FinanzasPersonalesTab({ data, hideValues, moneda, mepActual }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('ingresos');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div className="pill-row" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {SUB_TABS.map((t) => {
          const activo = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className="pill-touch"
              aria-pressed={activo}
              style={{
                padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', border: '1px solid',
                borderColor: activo ? 'var(--primary)' : 'var(--border)',
                background: activo ? 'var(--primary-dim)' : 'transparent',
                color: activo ? 'var(--primary)' : 'var(--muted)',
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === 'ingresos' && <IngresosSection hideValues={hideValues} moneda={moneda} />}
      {subTab === 'gastos-fijos' && <GastosFijosSection hideValues={hideValues} moneda={moneda} mepActual={mepActual} />}
      {subTab === 'proyecciones' && <ProyeccionesTab data={data} hideValues={hideValues} />}
    </div>
  );
}
