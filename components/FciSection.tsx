'use client';

import { useMemo, useState } from 'react';
import type { FciPerformance } from '@/types';
import { useFci } from '@/lib/useFci';
import { PALETA_TIPO } from '@/lib/constants';
import { formatMoney, formatPercent } from '@/lib/format';
import KPICard from './KPICard';
import ThOrden from './ThOrden';
import { Cargando, AvisoError, Vacio } from './Estados';

interface Props {
  tenencias: Record<string, number>;
  hideValues?: boolean;
}

const COLOR_FCI = PALETA_TIPO.FCI;

/** "s/d" cuando CAFCI no publicó la columna: 0,0% afirmaría que el fondo no rindió nada. */
function fmtPct1(v: number | null): string {
  return formatPercent(v == null ? null : v * 100, { sign: false });
}

function colorPct(v: number | null): string {
  if (v == null) return 'var(--muted)';
  return v >= 0 ? 'var(--up)' : 'var(--down)';
}

function fmtVcp(v: number, moneda: string): string {
  return formatMoney(v, { currency: moneda === 'USD' ? 'USD' : 'ARS', mode: 'price' });
}

type SortKey = 'ticker' | 'variacionDiaria' | 'rendimientoMes' | 'rendimientoAnio' | 'rendimiento12Meses';

export default function FciSection({ tenencias, hideValues = false }: Props) {
  const { data, loading, error } = useFci(tenencias);

  const [sortKey, setSortKey] = useState<SortKey>('rendimiento12Meses');
  const [sortDesc, setSortDesc] = useState(true);

  // Memo: `?? []` daría un array nuevo en cada render y rompería los memos que dependen de esto.
  const fondos = useMemo(() => data?.fondos ?? [], [data]);

  const totalEnCartera = useMemo(
    () => fondos.reduce((s, f) => s + (f.tenenciaUsd ?? 0), 0),
    [fondos],
  );

  const fondosOrdenados = useMemo(() => {
    const copia = [...fondos];
    copia.sort((a, b) => {
      if (sortKey === 'ticker') {
        const cmp = a.ticker.localeCompare(b.ticker);
        return sortDesc ? -cmp : cmp;
      }
      // Los fondos sin dato (null) van siempre al final, en cualquier sentido
      // de orden: son ausencia de dato, no el valor más bajo.
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return a.ticker.localeCompare(b.ticker);
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDesc ? bv - av : av - bv;
    });
    return copia;
  }, [fondos, sortKey, sortDesc]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDesc((d) => !d);
    else { setSortKey(key); setSortDesc(true); }
  }

  const cabecera = (key: SortKey, label: string, align: 'left' | 'right' = 'right') => (
    <ThOrden clave={key} label={label} activa={sortKey} desc={sortDesc} onOrden={toggleSort} align={align} />
  );

  if (loading) {
    return (
      <Cargando etiqueta="Cargando fondos" kpis={1} alto={200} />
    );
  }

  if (error) {
    return (
      <AvisoError titulo="No se pudieron cargar los fondos">{error}</AvisoError>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      <div className="kpi-grid">
        <KPICard
          label="En cartera"
          value={formatMoney(totalEnCartera, { currency: 'USD', hidden: hideValues })}
          sub={`${fondos.filter((f) => f.tenenciaUsd).length} de ${fondos.length} fondos con posición`}
        />
      </div>

      {fondos.length === 0 && <Vacio>La planilla de CAFCI no trajo fondos para mostrar.</Vacio>}
      <div className="tabla-wrap" hidden={fondos.length === 0}>
        <table className="tabla-datos" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {cabecera('ticker', 'Fondo', 'left')}
              <th style={{ textAlign: 'right', padding: '10px 12px', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>VCP</th>
              {cabecera('variacionDiaria', 'Var. diaria')}
              {cabecera('rendimientoMes', 'Mes')}
              {cabecera('rendimientoAnio', 'Año')}
              {cabecera('rendimiento12Meses', '12 meses')}
            </tr>
          </thead>
          <tbody>
            {fondosOrdenados.map((f: FciPerformance) => (
              <tr
                key={f.ticker}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  background: f.tenenciaUsd ? `${COLOR_FCI}11` : 'transparent',
                }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--text)' }}>
                  <span style={{ fontWeight: 700 }}>{f.ticker}{f.tenenciaUsd ? ' ★' : ''}</span>
                  <span style={{ marginLeft: 6, fontSize: 12, color: 'var(--muted)' }}>{f.moneda}</span>
                  {f.rezagado && (
                    <span
                      title={`CAFCI publica este fondo al ${f.fecha}, un día hábil detrás del resto de la planilla, y sin las columnas de variación. Por eso los rendimientos van "s/d".`}
                      className="etiqueta"
                      style={{ cursor: 'help', '--etiqueta-color': 'var(--warn)' } as React.CSSProperties}
                    >al {f.fecha}</span>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{f.nombreFondo}</div>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{fmtVcp(f.vcp, f.moneda)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: colorPct(f.variacionDiaria), fontVariantNumeric: 'tabular-nums' }}>{fmtPct1(f.variacionDiaria)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: f.rendimientoMes == null ? 'var(--muted)' : 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct1(f.rendimientoMes)}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: f.rendimientoAnio == null ? 'var(--muted)' : 'var(--text-sec)', fontVariantNumeric: 'tabular-nums' }}>{fmtPct1(f.rendimientoAnio)}</td>
                <td
                  style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: f.rendimiento12Meses == null ? 'var(--muted)' : 'var(--text)', fontVariantNumeric: 'tabular-nums' }}
                  title={f.rendimiento12MesesEstimado
                    ? 'Estimado: CAFCI no publica esta columna para el fondo (viene rezagado). Se calculó con el VCP de hoy y el de hace 12 meses de una fuente secundaria (espejo de la planilla), no es la cifra que publica CAFCI para los demás fondos.'
                    : undefined}
                >
                  {fmtPct1(f.rendimiento12Meses)}{f.rendimiento12MesesEstimado ? ' ~' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="nota">
        Fuente: Planilla Diaria pública de CAFCI (Cámara Argentina de Fondos Comunes de Inversión), fondos del broker.
        {fondos.some((f) => f.rezagado) && ' Los fondos marcados con fecha vienen un día hábil detrás en la planilla y sin columnas de variación: sus rendimientos figuran como "s/d" hasta que CAFCI los publique.'}
        {fondos.some((f) => f.rendimiento12MesesEstimado) && ' El 12 meses marcado con "~" es estimado de una fuente secundaria, no la cifra que publica CAFCI.'}
      </p>
    </div>
  );
}
