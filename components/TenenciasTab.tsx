'use client';

// Pestaña Tenencias: composición de la cartera en un mes dado, con tres
// vistas — Composición (treemap + evolución), Variación vs. mes anterior
// y Objetivo (metas de % editables). Extraído de Dashboard.tsx para que
// cada pestaña sea su propio archivo, igual que el resto.
//
// Mes y dimensión son los mismos en las tres vistas: viven acá, en una sola
// barra que no cambia de forma ni pierde la selección al pasar de una a otra.
//
// El filtro por tipo (click en un grupo del Treemap) es un zoom de Composición:
// afecta a sus dos gráficos y su pill solo se ve ahí. Objetivo no lo aplica
// porque sus metas son % de la cartera entera (filtrada daría, por ejemplo, 100%
// real contra 30% de objetivo), y Variación tampoco porque sus "pp" son
// participación sobre el total.

import { useState, useMemo } from 'react';
import type { DashboardData, TenenciaActual } from '@/types';
import type { Moneda } from '@/lib/format';
import TreemapChart from './TreemapChart';
import EvolucionTipoChart from './EvolucionTipoChart';
import MonthSlider from './MonthSlider';
import VariacionTab from './VariacionTab';
import ObjetivosComposicion from './ObjetivosComposicion';
import SubTabs from './SubTabs';

const DIMS_TENENCIAS = [
  { key: 'TIPO',       label: 'Tipo de Activo'    },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'   },
  { key: 'MONEDA',     label: 'Tipo de Moneda'    },
  { key: 'RENTA',      label: 'Tipo de Renta'     },
  { key: 'SECTOR_GEO', label: 'Sector Geográfico' },
] as const;
type DimTenencias = typeof DIMS_TENENCIAS[number]['key'];

const VISTAS_TENENCIAS = [
  { id: 'composicion', label: 'Composición' },
  { id: 'variacion',   label: 'Variación'   },
  { id: 'objetivo',    label: 'Objetivo'    },
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
        <div className="dim-selector scroll-x" style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
          {DIMS_TENENCIAS.map((d) => (
            <button
              key={d.key}
              className="pill-touch"
              onClick={() => setDimTenencias(d.key)}
              aria-pressed={dimTenencias === d.key}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                cursor: 'pointer', border: '1px solid',
                borderColor: dimTenencias === d.key ? 'var(--primary)' : 'var(--border)',
                background: dimTenencias === d.key ? 'var(--primary-dim)' : 'transparent',
                color: dimTenencias === d.key ? 'var(--primary)' : 'var(--muted)',
                transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >{d.label}</button>
          ))}
        </div>

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

      {vistaTenencias === 'variacion' && (
        <VariacionTab
          tenenciasPorMes={tenenciasPorMes}
          hideValues={hideValues}
          moneda={moneda}
          mesSel={mesKey}
          dim={dimTenencias}
        />
      )}

      {vistaTenencias === 'objetivo' && (
        <ObjetivosComposicion tenencias={tenenciasMesRaw} dim={dimTenencias} />
      )}
    </>
  );
}
