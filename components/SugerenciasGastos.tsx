'use client';

// Recomendaciones para ordenar las categorías de Gastos: mover lo que quedó con una
// categoría fuera de la lista (una vieja, "Otros", "Sin categoría" o escrita a mano
// en el Sheet) a una de las cuatro. Hay una sugerencia por gasto, aunque tenga varios
// períodos: se mueven todos juntos. Solo propone: cada botón arma la lista nueva y la
// devuelve por `onAplicar`; guardar es cosa de GastosSection. De dónde salen las
// sugerencias: lib/gastosCategorias.ts

import { useMemo } from 'react';
import type { GastoFijo } from '@/types';
import { gastosParaRecategorizar, type RecategorizarSugerencia } from '@/lib/gastosCategorias';

interface Props {
  gastos: GastoFijo[];
  saving: boolean;
  onAplicar: (lista: GastoFijo[]) => void;
}

export default function SugerenciasGastos({ gastos, saving, onAplicar }: Props) {
  const recategorizar = useMemo(() => gastosParaRecategorizar(gastos), [gastos]);

  const total = recategorizar.length;
  if (total === 0) return null;

  function mover(sugerencias: RecategorizarSugerencia[]) {
    const destino = new Map(sugerencias.flatMap((r) => r.indices.map((i) => [i, r.sugerencia.categoria] as const)));
    onAplicar(gastos.map((g, i) => (destino.has(i) ? { ...g, categoria: destino.get(i)! } : g)));
  }

  return (
    <details open className="g-card">
      <summary className="g-resumen">
        Sugerencias para ordenar las categorías <span style={{ color: 'var(--muted)', fontWeight: 400 }}>({total})</span>
      </summary>

      <div style={{ marginTop: 8 }}>
        {recategorizar.map((r) => (
          <div key={r.indices[0]} className="g-sugerencia">
            <span className="texto">
              <strong style={{ color: 'var(--text)' }}>{r.gasto.nombre}</strong>
              {r.indices.length > 1 && ` (${r.indices.length} períodos)`} está en «{r.gasto.categoria}».
              Sugerida: <strong style={{ color: 'var(--text)' }}>{r.sugerencia.categoria}</strong> ({r.sugerencia.motivo}).
            </span>
            <button
              type="button"
              className="g-btn chico"
              disabled={saving}
              onClick={() => mover([r])}
            >Mover</button>
          </div>
        ))}

        {recategorizar.length > 1 && (
          <div style={{ paddingTop: 10 }}>
            <button type="button" className="g-btn chico" disabled={saving} onClick={() => mover(recategorizar)}>
              Mover los {recategorizar.length} a su categoría sugerida
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
