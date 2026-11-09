'use client';

import { useMemo, useState } from 'react';
import type { DashboardData } from '@/types';
import { tickersDeCartera } from '@/lib/tickersElegibles';
import RentaFijaSection from './RentaFijaSection';
import RentaVariableSection from './RentaVariableSection';
import CarryTradeSection from './CarryTradeSection';
import FciSection from './FciSection';
import RatiosTab from './RatiosTab';
import SubTabs from './SubTabs';

interface Props {
  data: DashboardData;
  hideValues?: boolean;
}

type SubTab = 'fija' | 'variable' | 'carry' | 'fci' | 'ratios';

// `corto`: en mobile las cinco no entran en 360px con el nombre completo.
const SUB_TABS: { id: SubTab; label: string; corto?: string }[] = [
  { id: 'fija',     label: 'Renta fija',     corto: 'Fija' },
  { id: 'variable', label: 'Renta variable', corto: 'Variable' },
  { id: 'carry',    label: 'Carry trade',    corto: 'Carry' },
  { id: 'fci',      label: 'FCI' },
  { id: 'ratios',   label: 'Ratios' },
];

export default function PerformanceTab({ data, hideValues = false }: Props) {
  const { tenenciasPorMes } = data;

  const { tenencias, tickersUsa, tickersFciVariable } = useMemo(() => {
    const meses = Object.keys(tenenciasPorMes).sort();
    const ultimoMes = meses[meses.length - 1];
    return tickersDeCartera(tenenciasPorMes[ultimoMes] ?? []);
  }, [tenenciasPorMes]);

  const [subTab, setSubTab] = useState<SubTab>('fija');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <SubTabs tabs={SUB_TABS} activa={subTab} onChange={setSubTab} />

      {subTab === 'fija' && <RentaFijaSection tenencias={tenencias} />}
      {subTab === 'variable' && <RentaVariableSection tickersUsa={tickersUsa} tenencias={tenencias} tickersFci={tickersFciVariable} hideValues={hideValues} />}
      {subTab === 'carry' && <CarryTradeSection tenencias={tenencias} />}
      {subTab === 'fci' && <FciSection tenencias={tenencias} hideValues={hideValues} />}
      {subTab === 'ratios' && <RatiosTab data={data} />}
    </div>
  );
}
