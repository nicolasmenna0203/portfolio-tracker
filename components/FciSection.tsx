'use client';

import { useMemo, useState } from 'react';
import type { FciPerformance } from '@/types';
import { useFci } from '@/lib/useFci';
import { PALETA_TIPO } from '@/lib/constants';
import KPICard from './KPICard';

interface Props {
  tenencias: Record<string, number>;
}

const COLOR_FCI = PALETA_TIPO.FCI;

/** "s/d" cuando CAFCI no publicó la columna: 0,0% afirmaría que el fondo no rindió nada. */
function fmtPct1(v: number | null): string {
  if (v == null) return 's/d';
  return `${(v * 100).toFixed(1)}%`;
}

function colorPct(v: number | null): string {
  if (v == null) return 'var(--muted)';
  return v >= 0 ? '#1baf7a' : '#ef553b';
}

function fmtVcp(v: number, moneda: string): string {
  return `${moneda === 'USD' ? 'US$' : '$'}${v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtUsd(v: number): string {
  return `US$${v.toLocaleString('es-AR', { maximumFractionDigits: 0 })}`;
}

type SortKey = 'ticker' | 'variacionDiaria' | 'rendimientoMes' | 'rendimientoAnio' | 'rendimiento12Meses';

export default function FciSection({ tenencias }: Props) {
  const { data, loading, error } = useFci(tenencias);

  const [sortKey, setSortKey] = useState<SortKey>('rendimiento12Meses');
  const [sortDesc, setSortDesc] = useState(true);

  const fondos = data?.fondos ?? [];

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

  const cabecera = (key: SortKey, label: string) => (
    <th
      onClick={() => toggleSort(key)}
      style={{
        cursor: 'pointer', textAlign: 'right', padding: '8px 10px',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
        color: sortKey === key ? 'var(--primary)' : 'var(--muted)', whiteSpace: 'nowrap',
      }}
    >
      {label}{sortKey === key ? (sortDesc ? ' ▼' : ' ▲') : ''}
    </th>
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Cargando FCI del broker…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid #ef553b', borderRadius: 10,
        padding: '10px 14px', fontSize: 12, color: '#ef553b',
      }}>
        Error cargando FCI: {error}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      <div className="kpi-grid">
        <KPICard
          label="En Cartera (FCI)"
          value={fmtUsd(totalEnCartera)}
          sub={`${fondos.filter((f) => f.tenenciaUsd).length} de ${fondos.length} fondos con posición`}
          accentColor={COLOR_FCI}
        />
      </div>

      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12,
        overflowX: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead style={{ position: 'sticky', top: 0, background: 'var(--card)', zIndex: 1 }}>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th onClick={() => toggleSort('ticker')} style={{ cursor: 'pointer', textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: sortKey === 'ticker' ? 'var(--primary)' : 'var(--muted)' }}>
                Fondo{sortKey === 'ticker' ? (sortDesc ? ' ▼' : ' ▲') : ''}
              </th>
              <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>VCP</th>
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
                <td style={{ padding: '7px 10px', color: 'var(--text)' }}>
                  <span style={{ fontWeight: 700 }}>{f.ticker}{f.tenenciaUsd ? ' ★' : ''}</span>
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted)' }}>{f.moneda}</span>
                  {f.rezagado && (
                    <span
                      title={`CAFCI publica este fondo al ${f.fecha}, un día hábil detrás del resto de la planilla, y sin las columnas de variación. Por eso los rendimientos van "s/d".`}
                      style={{
                        marginLeft: 6, fontSize: 9, fontWeight: 700, cursor: 'help',
                        padding: '1px 5px', borderRadius: 4, whiteSpace: 'nowrap',
                        color: '#d98a0b', background: '#d98a0b22',
                      }}
                    >al {f.fecha}</span>
                  )}
                  <div style={{ fontSize: 10, color: 'var(--muted)' }}>{f.nombreFondo}</div>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--text-sec)' }}>{fmtVcp(f.vcp, f.moneda)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: colorPct(f.variacionDiaria) }}>{fmtPct1(f.variacionDiaria)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: f.rendimientoMes == null ? 'var(--muted)' : 'var(--text-sec)' }}>{fmtPct1(f.rendimientoMes)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', color: f.rendimientoAnio == null ? 'var(--muted)' : 'var(--text-sec)' }}>{fmtPct1(f.rendimientoAnio)}</td>
                <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: f.rendimiento12Meses == null ? 'var(--muted)' : 'var(--text)' }}>{fmtPct1(f.rendimiento12Meses)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ margin: 0, fontSize: 10, color: 'var(--muted)' }}>
        Fuente: Planilla Diaria pública de CAFCI (Cámara Argentina de Fondos Comunes de Inversión), fondos gestionados por Cocos Asset Management S.A.
        {fondos.some((f) => f.rezagado) && ' Los fondos marcados con fecha vienen un día hábil detrás en la planilla y sin columnas de variación: sus rendimientos figuran como "s/d" hasta que CAFCI los publique.'}
      </p>
    </div>
  );
}
