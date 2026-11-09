'use client';

// Pestaña Tenencias: composición de la cartera en un mes dado, con dos
// vistas — Composición (treemap + evolución) y Rebalanceo (cambio vs. mes
// anterior y metas de % editables, en las mismas barras). Extraído de
// Dashboard.tsx para que cada pestaña sea su propio archivo, igual que el resto.
//
// Mes y dimensión son los mismos en las dos vistas: viven acá, en una sola
// barra que no cambia de forma ni pierde la selección al pasar de una a otra.
//
// El filtro por tipo (click en un grupo del Treemap) es un zoom de Composición:
// afecta a sus dos gráficos y su pill solo se ve ahí. Rebalanceo no lo aplica porque sus "pp" son participación sobre el total y las metas son %
// de la cartera entera (filtrada daría, por ejemplo, 100% real contra 30% de
// objetivo).

import { useState, useMemo } from 'react';
import type { DashboardData, TenenciaActual } from '@/types';
import type { Moneda } from '@/lib/format';
import TreemapChart from './TreemapChart';
import EvolucionTipoChart from './EvolucionTipoChart';
import MonthSlider from './MonthSlider';
import RebalanceoTab from './RebalanceoTab';
import SubTabs from './SubTabs';
import Segmented from './Segmented';

const DIMS_TENENCIAS = [
  { key: 'TIPO',       label: 'Tipo de activo', corto: 'Tipo' },
  { key: 'RIESGO',     label: 'Riesgo'            },
  { key: 'MONEDA',     label: 'Moneda'            },
  { key: 'RENTA',      label: 'Renta'             },
  { key: 'SECTOR_GEO', label: 'Región'            },
] as const;
type DimTenencias = typeof DIMS_TENENCIAS[number]['key'];

const VISTAS_TENENCIAS = [
  { id: 'composicion', label: 'Composición' },
  { id: 'rebalanceo',  label: 'Rebalanceo'  },
] as const;
type VistaTenencias = typeof VISTAS_TENENCIAS[number]['id'];

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
}

export default function TenenciasTab({ data, hideValues, moneda }: Props) {
  const { tenenciasPorMes, mesesDisponibles } = data;

  const [mesSel, setMesSel] = useState(mesesDisponibles[mesesDisponibles.length - 1] ?? '');
  const [dimTenencias, setDimTenencias] = useState<DimTenencias>('TIPO');
  const [vistaTenencias, setVistaTenencias] = useState<VistaTenencias>('composicion');
  const [filtroTipo, setFiltroTipo] = useState<string | null>(null);

  const mesKey = (() => {
    const idx = mesesDisponibles.indexOf(mesSel);
    const sorted = Object.keys(tenenciasPorMes).sort();
    return sorted[idx] ?? sorted[sorted.length - 1] ?? '';
  })();

  const tenenciasMesRaw: TenenciaActual[] = tenenciasPorMes[mesKey] ?? [];

  const tenenciasMes = useMemo(
    () => (filtroTipo ? tenenciasMesRaw.filter(t => t.TIPO === filtroTipo) : tenenciasMesRaw),
    [tenenciasMesRaw, filtroTipo],
  );

  const tenenciasPorMesFiltradas = useMemo(() => {
    if (!filtroTipo) return tenenciasPorMes;
    return Object.fromEntries(
      Object.entries(tenenciasPorMes).map(([mes, items]) => [mes, items.filter(t => t.TIPO === filtroTipo)]),
    );
  }, [tenenciasPorMes, filtroTipo]);

  return (
    <>
      <SubTabs tabs={VISTAS_TENENCIAS} activa={vistaTenencias} onChange={setVistaTenencias} />

      {/* Barra de controles de la vista: selector de mes + dimensión */}
      <div className="tenencias-controles" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', flexShrink: 0 }}>

        {/* Botón Último a la izquierda */}
        {mesesDisponibles.indexOf(mesSel) < mesesDisponibles.length - 1 && (
          <button
            className="pill-touch"
            onClick={() => setMesSel(mesesDisponibles[mesesDisponibles.length - 1])}
            style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--primary)',
              background: 'var(--primary-dim)', color: 'var(--primary)',
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >‹ Último</button>
        )}

        {/* MonthSlider centrado */}
        <div className="tenencias-slider" style={{ flex: 1 }}>
          <MonthSlider
            meses={mesesDisponibles}
            selected={mesSel}
            onSelect={setMesSel}
          />
        </div>

        {/* Separador */}
        <div className="tenencias-sep" style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

        {/* Selector de dimensión unificado — fila deslizable en mobile. */}
        <Segmented
          opciones={DIMS_TENENCIAS.map((d) => ({ id: d.key, label: d.label, corto: 'corto' in d ? d.corto : undefined }))}
          activa={dimTenencias}
          onChange={setDimTenencias}
          chico
          etiqueta="Agrupar por"
          className="dim-selector"
        />

      </div>

      {vistaTenencias === 'composicion' && filtroTipo && (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <button
            className="pill-touch"
            onClick={() => setFiltroTipo(null)}
            aria-label={`Quitar filtro ${filtroTipo}`}
            style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              cursor: 'pointer', border: '1px solid var(--primary)',
              background: 'var(--primary-dim)', color: 'var(--primary)',
              whiteSpace: 'nowrap',
            }}
          >{filtroTipo} ×</button>
        </div>
      )}

      {vistaTenencias === 'composicion' && (
        /* Treemap + Evolución por — mismo tamaño */
        <div className="tenencias-grid">
          <TreemapChart
            tenencias={tenenciasMes}
            dim={dimTenencias}
            filtroTipo={filtroTipo}
            onFiltroTipo={(t) => setFiltroTipo(prev => prev === t ? null : t)}
            hideValues={hideValues}
            moneda={moneda}
          />
          <EvolucionTipoChart
            tenenciasPorMes={tenenciasPorMesFiltradas}
            mesesDisponibles={mesesDisponibles}
            dim={dimTenencias}
            mesSel={mesSel}
            onMesClick={(fecha) => { if (mesesDisponibles.includes(fecha)) setMesSel(fecha); }}
            hideValues={hideValues}
            moneda={moneda}
          />
        </div>
      )}

      {vistaTenencias === 'rebalanceo' && (
        <RebalanceoTab
          tenenciasPorMes={tenenciasPorMes}
          hideValues={hideValues}
          moneda={moneda}
          mesSel={mesKey}
          dim={dimTenencias}
        />
      )}
    </>
  );
}
