'use client';

// Pestaña Tenencias: composición de la cartera en un mes dado, con tres
// vistas — Composición (treemap + evolución), Variación vs. mes anterior
// y Objetivo (metas de % editables). Extraído de Dashboard.tsx para que
// cada pestaña sea su propio archivo, igual que el resto.
//
// Los filtros cruzados (filtroTipo, filtroRiesgo, etc.) quedan controlados
// desde Dashboard.tsx porque sus pills se muestran en el header, fuera de
// esta pestaña — acá solo se leen para filtrar y se setean desde el Treemap.

import { useState, useMemo } from 'react';
import type { DashboardData, TenenciaActual } from '@/types';
import type { Moneda } from '@/lib/format';
import { RIESGO_LABEL, RENTA_LABEL, GEO_LABEL, MONEDA_LABEL } from '@/lib/constants';
import TreemapChart from './TreemapChart';
import EvolucionTipoChart from './EvolucionTipoChart';
import MonthSlider from './MonthSlider';
import InformeTab from './InformeTab';
import ObjetivosComposicion from './ObjetivosComposicion';

const DIMS_TENENCIAS = [
  { key: 'TIPO',       label: 'Tipo de Activo'    },
  { key: 'RIESGO',     label: 'Nivel de Riesgo'   },
  { key: 'MONEDA',     label: 'Tipo de Moneda'    },
  { key: 'RENTA',      label: 'Tipo de Renta'     },
  { key: 'SECTOR_GEO', label: 'Sector Geográfico' },
] as const;
type DimTenencias = typeof DIMS_TENENCIAS[number]['key'];

interface Props {
  data: DashboardData;
  hideValues: boolean;
  moneda: Moneda;
  filtroTipo: string | null;
  setFiltroTipo: (fn: (prev: string | null) => string | null) => void;
  filtroRiesgo: string | null;
  filtroMoneda: string | null;
  filtroRenta: string | null;
  filtroGeo: string | null;
}

export default function TenenciasTab({
  data, hideValues, moneda,
  filtroTipo, setFiltroTipo, filtroRiesgo, filtroMoneda, filtroRenta, filtroGeo,
}: Props) {
  const { kpis, resumenSeries, tenenciasPorMes, mesesDisponibles, totalPorMes } = data;

  const [mesSel, setMesSel] = useState(mesesDisponibles[mesesDisponibles.length - 1] ?? '');
  const [dimTenencias, setDimTenencias] = useState<DimTenencias>('TIPO');
  const [vistaTenencias, setVistaTenencias] = useState<'composicion' | 'variacion' | 'objetivo'>('composicion');

  const mesKey = (() => {
    const idx = mesesDisponibles.indexOf(mesSel);
    const sorted = Object.keys(tenenciasPorMes).sort();
    return sorted[idx] ?? sorted[sorted.length - 1] ?? '';
  })();

  const tenenciasMesRaw: TenenciaActual[] = tenenciasPorMes[mesKey] ?? [];
  const totalMes = totalPorMes[mesKey] ?? kpis.totalCartera;

  const tenenciasMes = useMemo(() => {
    let items = tenenciasMesRaw;
    if (filtroTipo)   items = items.filter(t => t.TIPO === filtroTipo);
    if (filtroRiesgo) items = items.filter(t => (RIESGO_LABEL[t.RIESGO] ?? 'Sin dato') === filtroRiesgo);
    if (filtroMoneda) items = items.filter(t => (MONEDA_LABEL[t.MONEDA] ?? t.MONEDA) === filtroMoneda);
    if (filtroRenta)  items = items.filter(t => (RENTA_LABEL[t.RENTA] ?? t.RENTA) === filtroRenta);
    if (filtroGeo)    items = items.filter(t => (GEO_LABEL[t.SECTOR_GEO] ?? t.SECTOR_GEO) === filtroGeo);
    return items;
  }, [tenenciasMesRaw, filtroTipo, filtroRiesgo, filtroMoneda, filtroRenta, filtroGeo]);

  return (
    <>
      {/* Barra de controles: selector de mes centrado + dimensión + filtros activos */}
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
            totalMes={totalMes}
            activosMes={tenenciasMes.length}
            hideValues={hideValues}
          />
        </div>

        {/* Separador */}
        <div className="tenencias-sep" style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

        {/* Selector de dimensión unificado — fila deslizable en mobile.
            Solo aplica a la vista Composición (el Treemap la usa); en
            Variación y Objetivo cada una maneja sus propias dimensiones. */}
        {vistaTenencias === 'composicion' && (
          <div className="dim-selector scroll-x" style={{ display: 'flex', gap: 3, flexWrap: 'wrap', flexShrink: 0 }}>
            {DIMS_TENENCIAS.map((d) => (
              <button
                key={d.key}
                className="pill-touch"
                onClick={() => setDimTenencias(d.key)}
                style={{
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                  cursor: 'pointer', border: '1px solid',
                  borderColor: dimTenencias === d.key ? 'var(--primary)' : 'var(--border)',
                  background: dimTenencias === d.key ? 'var(--primary-dim)' : 'transparent',
                  color: dimTenencias === d.key ? 'var(--primary)' : 'var(--muted)',
                  transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >{d.label}</button>
            ))}
          </div>
        )}

        {/* Separador */}
        <div className="tenencias-sep" style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

        {/* Toggle Composición / Variación vs. mes anterior / Objetivo */}
        <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
          {([
            { id: 'composicion', label: 'Composición' },
            { id: 'variacion',   label: 'Variación'   },
            { id: 'objetivo',    label: 'Objetivo'     },
          ] as const).map((v) => (
            <button
              key={v.id}
              className="pill-touch"
              onClick={() => setVistaTenencias(v.id)}
              style={{
                padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500,
                cursor: 'pointer', border: '1px solid',
                borderColor: vistaTenencias === v.id ? 'var(--primary)' : 'var(--border)',
                background: vistaTenencias === v.id ? 'var(--primary-dim)' : 'transparent',
                color: vistaTenencias === v.id ? 'var(--primary)' : 'var(--muted)',
                transition: 'all 0.12s', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >{v.label}</button>
          ))}
        </div>

      </div>

      {vistaTenencias === 'composicion' && (
        /* Treemap + Evolución por — mismo tamaño */
        <div className="tenencias-grid">
          <TreemapChart
            tenencias={tenenciasMes}
            totalCartera={totalMes}
            dim={dimTenencias}
            filtroTipo={filtroTipo}
            onFiltroTipo={(t) => setFiltroTipo(prev => prev === t ? null : t)}
            hideValues={hideValues}
            moneda={moneda}
          />
          <EvolucionTipoChart
            tenenciasPorMes={tenenciasPorMes}
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
        <InformeTab
          resumenSeries={resumenSeries}
          tenenciasPorMes={tenenciasPorMes}
          mesesDisponibles={mesesDisponibles}
          totalPorMes={totalPorMes}
          hideValues={hideValues}
          moneda={moneda}
          mesSel={mesKey}
        />
      )}

      {vistaTenencias === 'objetivo' && (
        <ObjetivosComposicion tenencias={tenenciasMes} />
      )}
    </>
  );
}
